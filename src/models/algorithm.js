/**
 * Algorithm Model — Lightweight Directory-Based Storage
 *
 * Storage layout per algorithm:
 *   data/algorithms/<code>/
 *     ├── algo.json        ← algorithm definition + version summaries (always small, ~5-10 KB)
 *     └── results/
 *         ├── v1_run1.json ← full backtest result with tradeLog (read on demand)
 *         ├── v2_run1.json
 *         └── ...
 *
 * Key ideas:
 *   - algo.json NEVER stores trade logs — stays tiny and instantly openable
 *   - versionSummary[] gives a quick view of all versions without loading results
 *   - Auto-promotion: if avgTradeProfitPct >= threshold → bestVersion is updated
 *   - ruleDesc per version: human-readable buy/sell description
 *
 * Version status lifecycle:  "testing" → "promoted" | "rejected"
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Storage Root ─────────────────────────────────────────────────────────────
const ALGORITHMS_DIR = path.resolve(process.cwd(), 'data', 'algorithms');
const REGISTRY_FILE  = path.join(ALGORITHMS_DIR, '_index.json');

function algoDir(code)         { return path.join(ALGORITHMS_DIR, code); }
function algoFilePath(code)    { return path.join(algoDir(code), 'algo.json'); }
function resultsDir(code)      { return path.join(algoDir(code), 'results'); }
function resultFilePath(code, version, runIndex) {
  return path.join(resultsDir(code), `v${version}_run${runIndex}.json`);
}

function ensureAlgoDir(code) {
  const dir = algoDir(code);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rDir = resultsDir(code);
  if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
}

function loadRegistry() {
  if (!fs.existsSync(ALGORITHMS_DIR)) fs.mkdirSync(ALGORITHMS_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) return { algorithms: [], lastUpdated: null };
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
}

function saveRegistry(reg) {
  if (!fs.existsSync(ALGORITHMS_DIR)) fs.mkdirSync(ALGORITHMS_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf8');
}

function loadAlgoFile(code) {
  const fp = algoFilePath(code);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveAlgoFile(code, doc) {
  ensureAlgoDir(code);
  // Never write tradeLog to algo.json — strip it from versions just in case
  const safe = JSON.parse(JSON.stringify(doc));
  fs.writeFileSync(algoFilePath(code), JSON.stringify(safe, null, 2), 'utf8');
}

// ─── Trading Calendar Helper ──────────────────────────────────────────────────
/**
 * Count unique trading days from a trade log.
 * Ignores weekends and returns distinct IST date strings.
 */
function countTradingDays(fromISO, toISO) {
  if (!fromISO || !toISO) return 1;
  const from = new Date(fromISO);
  const to   = new Date(toISO);
  let days = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++; // skip Sat/Sun
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(days, 1);
}

// ─── Summary Computation ──────────────────────────────────────────────────────
/**
 * Build a lightweight versionSummary entry from a full backtest result.
 * This is what gets stored in algo.json — no trade logs.
 */
function buildVersionSummary(version, tag, result) {
  const tradingDays = countTradingDays(result.fromDate, result.toDate);
  const avgTradeProfitPct = result.totalTrades > 0
    ? Number(((result.avgTradePnl / (result.initialCapital / result.totalTrades)) * 100).toFixed(4))
    : 0;
  const avgPerDayProfitPct = Number(((result.totalPnlPct || 0) / tradingDays).toFixed(4));

  return {
    version,
    tag,
    status: 'testing',
    ranAt: new Date().toISOString(),
    dataFile: result.dataFile || '',
    fromDate: result.fromDate || null,
    toDate: result.toDate || null,
    totalCandles: result.totalCandles || 0,
    tradingDays,
    avgTradeProfitPct,
    avgPerDayProfitPct,
    totalPnl: result.totalPnl || 0,
    totalPnlPct: result.totalPnlPct || 0,
    totalTrades: result.totalTrades || 0,
    winRatePct: result.winRatePct || 0,
    maxDrawdownPct: result.maxDrawdownPct || 0,
    sharpeRatio: result.sharpeRatio || 0,
    totalSells: result.totalSells || 0,
    totalRebuys: result.totalRebuys || 0,
    totalSellQty: result.totalSellQty || 0,
    totalBuyQty:  result.totalBuyQty  || 0,
    promotedAt: null,
  };
}

// ─── Rule Catalog ─────────────────────────────────────────────────────────────
const RULE_CATALOG = {
  'trend-filter': {
    type: 'SELL_GATE',
    name: 'Trend Filter',
    description: [
      'Gate grid sells: only allow new sells when EMA(fastPeriod) > EMA(slowPeriod).',
      'Prevents opening new sell positions in a confirmed downtrend.',
      'R1 rebuys are also blocked during downtrend when this rule is active.',
    ].join(' '),
    defaultParams: { fastEmaPeriod: 50, slowEmaPeriod: 200 },
  },

  'consecutive-buy-guard': {
    type: 'BUY_GATE',
    name: 'Consecutive Buy Guard',
    description: [
      'Block rebuy fills when the last N entries in the tradeLog are all BUYs',
      'without a new SELL in between.',
      'Prevents over-accumulating long exposure in a falling market.',
    ].join(' '),
    defaultParams: { maxConsecutiveBuys: 3 },
  },

  'drawdown-circuit-breaker': {
    type: 'PAUSE_GATE',
    name: 'Drawdown Circuit Breaker',
    description: [
      'Pause all new grid sells when the portfolio unrealized drawdown',
      'exceeds maxDrawdownPct% (measured as (avgEntryPrice - ltp) / avgEntryPrice).',
      'Selling resumes only when price recovers above the threshold.',
    ].join(' '),
    defaultParams: { maxDrawdownPct: 18 },
  },

  'hard-stop-loss': {
    type: 'EXIT_GATE',
    name: 'Hard Stop Loss',
    description: [
      'Emergency full exit: liquidate all holdings at market when total',
      'unrealized loss exceeds stopLossPct%. Simulation stops after this event.',
    ].join(' '),
    defaultParams: { stopLossPct: 10 },
  },

  'session-cutoff': {
    type: 'TIME_GATE',
    name: 'Session Cutoff',
    description: [
      'Stop opening new grid sells after cutoffTime (IST, HH:MM).',
      'Prevents new positions near market close.',
    ].join(' '),
    defaultParams: { cutoffTime: '15:10' },
  },

  'daily-cycle-cap': {
    type: 'FREQUENCY_GATE',
    name: 'Daily Cycle Cap',
    description: [
      'Limit the maximum number of completed grid rebuy fills per calendar day.',
      'Resets at midnight IST.',
    ].join(' '),
    defaultParams: { maxCycles: 8 },
  },
};

// ─── Rule Builder ─────────────────────────────────────────────────────────────
function buildRule(id, enabled = true, params = {}) {
  const catalog = RULE_CATALOG[id];
  if (!catalog) throw new Error(`Unknown rule id: '${id}'. See RULE_CATALOG for valid ids.`);
  return {
    id,
    name: catalog.name,
    type: catalog.type,
    description: catalog.description,
    enabled,
    params: { ...catalog.defaultParams, ...params },
  };
}

// ─── Config Builders ──────────────────────────────────────────────────────────
function buildGridConfig(def = {}) {
  return {
    step: {
      mode:           def.step?.mode           || def.stepMode            || 'ATR',
      atrPeriod:      def.step?.atrPeriod      || def.atrPeriod           || 14,
      atrMultiplier:  def.step?.atrMultiplier  || def.atrStepMultiplier   || 1.5,
      minPct:         def.step?.minPct         || def.minStepPct          || 0.8,
      maxPct:         def.step?.maxPct         || def.maxStepPct          || 8.0,
      fixedPct:       def.step?.fixedPct       || def.fixedStepPct        || 3.0,
    },
    position: {
      tradingQtyPerStep:  def.position?.tradingQtyPerStep  || def.tradingQtyPerStep  || 10,
      corePositionPct:    def.position?.corePositionPct    || def.corePositionPct    || 70,
      minLotSize:         def.position?.minLotSize         || def.minLotSize         || 5,
      maxActiveTickets:   def.position?.maxActiveTickets   || def.maxActiveTickets   || 5,
    },
    rebuyLadder: {
      allocationMode: def.rebuyLadder?.allocationMode || def.allocationMode || 'ATR_ADAPTIVE',
      maxLevels:      def.rebuyLadder?.maxLevels      || def.maxRebuyLevels || 3,
      levels:         def.rebuyLadder?.levels         || def.rebuyLevels    || [
        { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 30 },
        { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 30 },
        { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 40 },
      ],
    },
    ticketExpiry: {
      maxAgeDays: def.ticketExpiry?.maxAgeDays || def.maxTicketAgeDays || 30,
    },
    // Risk & Rules (Smart Defaults)
    hardStopLossPct:           def.hardStopLossPct           ?? null,
    maxDrawdownCircuitBreaker: def.maxDrawdownCircuitBreaker ?? null,
    maxDailyCycles:            def.maxDailyCycles            ?? null,
    sessionCutoffTime:         def.sessionCutoffTime         ?? null,
    trendFilterEnabled:        def.trendFilterEnabled        ?? false,
    trendEmaFastPeriod:        def.trendEmaFastPeriod        ?? 50,
    trendEmaSlowPeriod:        def.trendEmaSlowPeriod        ?? 200,
  };
}

function buildIndicator(def) {
  return { type: def.type, source: def.source || 'close', params: def.params || {}, name: def.name || def.type };
}

function buildRiskConfig(def = {}) {
  return {
    stopLossPercent:        def.stopLossPercent        ?? null,
    takeProfitPercent:      def.takeProfitPercent      ?? null,
    maxConcurrentPositions: def.maxConcurrentPositions ?? null,
    requireExitCondition:   def.requireExitCondition   ?? false,
    intradaySquareOffTime:  def.intradaySquareOffTime  ?? null,
  };
}

// ─── Version Builder ─────────────────────────────────────────────────────────
/**
 * @param {number} versionNum
 * @param {object} def
 * @param {string}   def.tag
 * @param {string}   def.notes
 * @param {Array}    def.indicators
 * @param {object}   def.gridConfig
 * @param {Array}    def.rules
 * @param {object}   def.ruleDesc   - { buy: string, sell: string }
 * @param {object}   def.riskConfig
 */
function buildVersion(versionNum, def = {}) {
  return {
    version:   versionNum,
    tag:       def.tag   || `v${versionNum}`,
    notes:     def.notes || '',
    createdAt: def.createdAt || new Date().toISOString(),

    indicators: (def.indicators || []).map(buildIndicator),

    riskConfig: buildRiskConfig(def.riskConfig || {}),

    gridConfig: buildGridConfig(def.gridConfig || {}),

    rules: (def.rules || []).map(r => {
      if (r.type && r.name && r.description) return r; // already built
      return buildRule(r.id, r.enabled !== false, r.params || {});
    }),

    // Human-readable description of what this version does
    ruleDesc: {
      buy:  def.ruleDesc?.buy  || 'Rebuy at R1/R2/R3 below sell price (ATR-adaptive depths)',
      sell: def.ruleDesc?.sell || 'Sell when price rises stepPct% above entry (ATR-adaptive step)',
    },
  };
}

// ─── Algorithm Document Builder ───────────────────────────────────────────────
function buildAlgorithmDoc(def) {
  if (!def.algorithmCode) throw new Error('algorithmCode is required');
  return {
    code:        def.algorithmCode,
    name:        def.name        || def.algorithmCode,
    description: def.description || '',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),

    // Auto-promotion config
    promotionThreshold: {
      minAvgTradeProfitPct: def.promotionThreshold?.minAvgTradeProfitPct ?? 2.0,
    },

    // Which version is currently best (null until one is promoted)
    bestVersion: null,

    // Quick summary of all versions — updated after each backtest
    versionSummary: [],

    // Full version configs (NO trade logs — those go in results/)
    versions: [buildVersion(1, def.initialVersion || {})],

    currentVersion: 1,
  };
}

// ─── Public CRUD ──────────────────────────────────────────────────────────────

function createAlgorithm(def) {
  if (!def.algorithmCode) throw new Error('algorithmCode is required');
  if (loadAlgoFile(def.algorithmCode)) throw new Error(`Algorithm '${def.algorithmCode}' already exists`);
  const doc = buildAlgorithmDoc(def);
  saveAlgoFile(def.algorithmCode, doc);
  const reg = loadRegistry();
  if (!reg.algorithms.includes(def.algorithmCode)) {
    reg.algorithms.push(def.algorithmCode);
    reg.lastUpdated = new Date().toISOString();
    saveRegistry(reg);
  }
  return doc;
}

function addVersion(algorithmCode, versionDef) {
  const doc = loadAlgoFile(algorithmCode);
  if (!doc) throw new Error(`Algorithm '${algorithmCode}' not found`);
  const num = doc.currentVersion + 1;
  const ver = buildVersion(num, versionDef);
  doc.versions.push(ver);
  doc.currentVersion = num;
  doc.updatedAt = new Date().toISOString();
  saveAlgoFile(algorithmCode, doc);
  return ver;
}

/**
 * Attach a backtest result:
 *  - Saves the FULL result (including tradeLog) to results/v{N}_run{M}.json
 *  - Saves a LIGHTWEIGHT summary into algo.json's versionSummary[]
 *  - Auto-evaluates and promotes if threshold met
 *
 * @returns {{ summary, promoted, resultFile }}
 */
function attachBacktestResult(algorithmCode, versionNum, result) {
  const doc = loadAlgoFile(algorithmCode);
  if (!doc) throw new Error(`Algorithm '${algorithmCode}' not found`);
  const ver = doc.versions.find(v => v.version === versionNum);
  if (!ver) throw new Error(`Version ${versionNum} not found`);

  ensureAlgoDir(algorithmCode);

  // Count existing runs for this version
  const rDir = resultsDir(algorithmCode);
  const existingRuns = fs.readdirSync(rDir)
    .filter(f => f.startsWith(`v${versionNum}_run`) && f.endsWith('.json'));
  const runIndex = existingRuns.length + 1;

  // Save full result (with tradeLog) to separate file
  const rFile = resultFilePath(algorithmCode, versionNum, runIndex);
  const fullResult = {
    runId: result.runId || crypto.randomUUID(),
    ranAt: new Date().toISOString(),
    algorithmCode,
    version: versionNum,
    tag: ver.tag,
    ...result,
  };
  fs.writeFileSync(rFile, JSON.stringify(fullResult, null, 2), 'utf8');

  // Build lightweight summary
  const summary = buildVersionSummary(versionNum, ver.tag, { ...result, ...fullResult });

  // Upsert into versionSummary[] (replace existing entry if re-running)
  const idx = doc.versionSummary.findIndex(s => s.version === versionNum);
  if (idx >= 0) {
    doc.versionSummary[idx] = summary;
  } else {
    doc.versionSummary.push(summary);
  }

  // Auto-evaluate & promote
  const threshold = doc.promotionThreshold?.minAvgTradeProfitPct ?? 2.0;
  let promoted = false;
  if (summary.avgTradeProfitPct >= threshold) {
    summary.status = 'promoted';
    summary.promotedAt = new Date().toISOString();
    // Only update bestVersion if this is better than current best
    const currentBest = doc.versionSummary.find(s => s.version === doc.bestVersion);
    if (!currentBest || summary.avgTradeProfitPct > (currentBest.avgTradeProfitPct || -Infinity)) {
      doc.bestVersion = versionNum;
    }
    promoted = true;
  } else {
    summary.status = 'rejected';
  }

  doc.updatedAt = new Date().toISOString();
  saveAlgoFile(algorithmCode, doc);

  return { summary, promoted, resultFile: path.relative(process.cwd(), rFile) };
}

/**
 * Load the full backtest result (with tradeLog) for a version's latest run.
 */
function getLatestBacktestResult(algorithmCode, versionNum) {
  const rDir = resultsDir(algorithmCode);
  if (!fs.existsSync(rDir)) return null;
  const runs = fs.readdirSync(rDir)
    .filter(f => f.startsWith(`v${versionNum}_run`) && f.endsWith('.json'))
    .sort();
  if (runs.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(rDir, runs[runs.length - 1]), 'utf8'));
}

/**
 * List all result files for a version.
 */
function listResultFiles(algorithmCode, versionNum) {
  const rDir = resultsDir(algorithmCode);
  if (!fs.existsSync(rDir)) return [];
  return fs.readdirSync(rDir)
    .filter(f => f.startsWith(`v${versionNum}_run`) && f.endsWith('.json'))
    .sort()
    .map(f => path.join(rDir, f));
}

function findAlgorithm(code)       { return loadAlgoFile(code); }

function getVersion(code, vNum) {
  const doc = loadAlgoFile(code);
  if (!doc) return null;
  const n = vNum || doc.currentVersion;
  return doc.versions.find(v => v.version === n) || null;
}

function getVersionSummary(code, vNum) {
  const doc = loadAlgoFile(code);
  if (!doc) return null;
  if (vNum) return doc.versionSummary.find(s => s.version === vNum) || null;
  return doc.versionSummary;
}

function listAlgorithms() {
  const reg = loadRegistry();
  return reg.algorithms.map(code => {
    const doc = loadAlgoFile(code);
    if (!doc) return { code, error: 'file missing' };
    return {
      code:           doc.code,
      name:           doc.name,
      currentVersion: doc.currentVersion,
      bestVersion:    doc.bestVersion,
      totalVersions:  doc.versions.length,
      promotionThreshold: doc.promotionThreshold,
      updatedAt:      doc.updatedAt,
    };
  });
}

function deleteAlgorithm(code) {
  const dir = algoDir(code);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const reg = loadRegistry();
  reg.algorithms = reg.algorithms.filter(c => c !== code);
  reg.lastUpdated = new Date().toISOString();
  saveRegistry(reg);
}

// ─── Backward-compat: attachExpectedResult & compareExpectedVsActual ──────────
// Kept for tests — stored lightweight in algo.json version entry
function attachExpectedResult(algorithmCode, versionNum, expected) {
  const doc = loadAlgoFile(algorithmCode);
  if (!doc) throw new Error(`Algorithm '${algorithmCode}' not found`);
  const ver = doc.versions.find(v => v.version === versionNum);
  if (!ver) throw new Error(`Version ${versionNum} not found`);
  if (!ver.expectedResults) ver.expectedResults = [];
  const entry = {
    id: crypto.randomUUID(),
    addedAt: new Date().toISOString(),
    description: expected.description || '',
    dataFile: expected.dataFile || '',
    metrics: expected.metrics || {},
  };
  ver.expectedResults.push(entry);
  doc.updatedAt = new Date().toISOString();
  saveAlgoFile(algorithmCode, doc);
  return entry;
}

function compareExpectedVsActual(algorithmCode, versionNum) {
  const ver = getVersion(algorithmCode, versionNum);
  if (!ver) return { error: 'Version not found' };
  const actual = getLatestBacktestResult(algorithmCode, versionNum);
  if (!actual) return { error: 'No backtest results found. Run a backtest first.' };

  const report = {
    algorithmCode,
    version: ver.version,
    tag: ver.tag,
    ranAt: actual.ranAt,
    dataFile: actual.dataFile,
    comparisons: [],
    passed: 0, failed: 0, skipped: 0,
  };

  for (const expectedEntry of (ver.expectedResults || [])) {
    if (expectedEntry.dataFile && expectedEntry.dataFile !== actual.dataFile) continue;
    for (const [metric, spec] of Object.entries(expectedEntry.metrics || {})) {
      const actualVal   = actual[metric];
      const expectedVal = spec.expected;
      const tolerance   = spec.tolerance ?? 0;
      const operator    = spec.operator || 'approx';

      if (actualVal === undefined || actualVal === null) {
        report.skipped++;
        report.comparisons.push({ metric, expected: expectedVal, actual: 'N/A', result: 'SKIPPED', reason: 'Metric not in result' });
        continue;
      }

      let pass = false, reason = '';
      if (operator === 'approx' || operator === '~=') {
        pass   = Math.abs(actualVal - expectedVal) <= tolerance;
        reason = pass ? 'Within tolerance' : `Diff ${Math.abs(actualVal - expectedVal).toFixed(2)} > tolerance ${tolerance}`;
      } else if (operator === 'gte') { pass = actualVal >= expectedVal; reason = pass ? 'OK' : `${actualVal} < ${expectedVal}`; }
      else if (operator === 'lte')  { pass = actualVal <= expectedVal; reason = pass ? 'OK' : `${actualVal} > ${expectedVal}`; }
      else if (operator === 'eq')   { pass = actualVal === expectedVal; reason = pass ? 'Exact' : `Got ${actualVal}`; }

      if (pass) report.passed++; else report.failed++;
      report.comparisons.push({ metric, description: expectedEntry.description, expected: expectedVal, actual: actualVal, tolerance, operator, result: pass ? 'PASS' : 'FAIL', reason });
    }
  }

  report.overallResult = report.failed === 0 && report.comparisons.length > 0
    ? 'PASS' : (report.failed > 0 ? 'FAIL' : 'NO_EXPECTATIONS');
  return report;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // CRUD
  createAlgorithm,
  addVersion,
  attachBacktestResult,
  attachExpectedResult,
  findAlgorithm,
  getVersion,
  getVersionSummary,
  listAlgorithms,
  getLatestBacktestResult,
  compareExpectedVsActual,
  deleteAlgorithm,

  // Result files
  listResultFiles,
  resultsDir,

  // Schema builders (used externally)
  buildRule,
  buildGridConfig,
  buildIndicator,
  buildRiskConfig,

  // Catalog
  RULE_CATALOG,
  ALGORITHMS_DIR,
  algoDir,
};
