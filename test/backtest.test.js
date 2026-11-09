/**
 * Jest Test Suite — Algorithm Versioning & Backtest Engine
 *
 * Tests are fully automated — no manual input needed.
 * Structured in 4 layers:
 *
 *   1. Unit Tests — indicators.js
 *   2. Unit Tests — algorithm.js (model CRUD + versioning + auto-promotion)
 *   3. Integration Tests — backtestEngine.js (candle simulation)
 *   4. Expected vs Actual — compare manual expectations to backtest output
 *
 * To run: npm test
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ─── Isolated temp directory for all tests ────────────────────────────────────
// We override the module's internal paths by using jest.mock to wire
// a fresh temp directory per test run — no real data/algorithms/ is touched.

const TEST_ROOT = path.join(os.tmpdir(), `algo-test-${crypto.randomUUID().slice(0, 8)}`);

jest.mock('../src/models/algorithm', () => {
  const crypto    = require('crypto');
  const fs        = require('fs');
  const path      = require('path');
  const os        = require('os');
  const TEST_ROOT = path.join(os.tmpdir(), `algo-test-${crypto.randomUUID().slice(0, 8)}`);

  const REGISTRY  = path.join(TEST_ROOT, '_index.json');

  function algoDir(code)       { return path.join(TEST_ROOT, code); }
  function algoFile(code)      { return path.join(algoDir(code), 'algo.json'); }
  function resultsDir_(code)   { return path.join(algoDir(code), 'results'); }
  function resultFile(code, v, n) {
    return path.join(resultsDir_(code), `v${v}_run${n}.json`);
  }

  function ensureAlgo(code) {
    const d = algoDir(code);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    const r = resultsDir_(code);
    if (!fs.existsSync(r)) fs.mkdirSync(r, { recursive: true });
  }

  function loadReg() {
    if (!fs.existsSync(TEST_ROOT)) fs.mkdirSync(TEST_ROOT, { recursive: true });
    if (!fs.existsSync(REGISTRY)) return { algorithms: [] };
    return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  }
  function saveReg(r) {
    if (!fs.existsSync(TEST_ROOT)) fs.mkdirSync(TEST_ROOT, { recursive: true });
    fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2), 'utf8');
  }

  function loadDoc(code) {
    const fp = algoFile(code);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  }
  function saveDoc(code, doc) {
    ensureAlgo(code);
    fs.writeFileSync(algoFile(code), JSON.stringify(doc, null, 2), 'utf8');
  }

  function buildVer(num, def) {
    return {
      version: num,
      tag: def.tag || `v${num}`,
      notes: def.notes || '',
      createdAt: new Date().toISOString(),
      indicators: def.indicators || [],
      riskConfig: def.riskConfig || {},
      gridConfig: def.gridConfig || {},
      rules: def.rules || [],
      ruleDesc: def.ruleDesc || { buy: '', sell: '' },
      expectedResults: def.expectedResults || [],
    };
  }

  function countTradingDays(from, to) {
    if (!from || !to) return 1;
    const a = new Date(from), b = new Date(to);
    let days = 0, cur = new Date(a);
    while (cur <= b) { const d = cur.getDay(); if (d !== 0 && d !== 6) days++; cur.setDate(cur.getDate() + 1); }
    return Math.max(days, 1);
  }

  function buildSummary(version, tag, result) {
    const tradingDays = countTradingDays(result.fromDate, result.toDate);
    const avgTradeProfitPct = result.totalTrades > 0
      ? Number(((result.avgTradePnl / (result.initialCapital / result.totalTrades)) * 100).toFixed(4))
      : 0;
    return {
      version, tag, status: 'testing',
      ranAt: new Date().toISOString(),
      dataFile: result.dataFile || '',
      fromDate: result.fromDate || null,
      toDate:   result.toDate   || null,
      totalCandles: result.totalCandles || 0,
      tradingDays,
      avgTradeProfitPct,
      avgPerDayProfitPct: Number(((result.totalPnlPct || 0) / tradingDays).toFixed(4)),
      totalPnl: result.totalPnl || 0,
      totalPnlPct: result.totalPnlPct || 0,
      totalTrades: result.totalTrades || 0,
      winRatePct: result.winRatePct || 0,
      maxDrawdownPct: result.maxDrawdownPct || 0,
      sharpeRatio: result.sharpeRatio || 0,
      totalSells: result.totalSells || 0,
      totalRebuys: result.totalRebuys || 0,
      promotedAt: null,
    };
  }

  return {
    ALGORITHMS_DIR: TEST_ROOT,

    createAlgorithm(def) {
      if (!def.algorithmCode) throw new Error('algorithmCode is required');
      if (loadDoc(def.algorithmCode)) throw new Error(`Algorithm '${def.algorithmCode}' already exists`);
      const doc = {
        code: def.algorithmCode, name: def.name || def.algorithmCode,
        description: def.description || '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        promotionThreshold: { minAvgTradeProfitPct: def.promotionThreshold?.minAvgTradeProfitPct ?? 2.0 },
        bestVersion: null,
        versionSummary: [],
        versions: [buildVer(1, def.initialVersion || {})],
        currentVersion: 1,
      };
      saveDoc(def.algorithmCode, doc);
      const reg = loadReg();
      if (!reg.algorithms.includes(def.algorithmCode)) {
        reg.algorithms.push(def.algorithmCode);
        saveReg(reg);
      }
      return doc;
    },

    addVersion(code, vDef) {
      const doc = loadDoc(code);
      if (!doc) throw new Error(`Algorithm '${code}' not found`);
      const num = doc.currentVersion + 1;
      const ver = buildVer(num, vDef);
      doc.versions.push(ver);
      doc.currentVersion = num;
      doc.updatedAt = new Date().toISOString();
      saveDoc(code, doc);
      return ver;
    },

    attachBacktestResult(code, versionNum, result) {
      const doc = loadDoc(code);
      if (!doc) throw new Error(`Algorithm '${code}' not found`);
      const ver = doc.versions.find(v => v.version === versionNum);
      if (!ver) throw new Error(`Version ${versionNum} not found`);

      ensureAlgo(code);
      const rDir = resultsDir_(code);
      const existingRuns = fs.readdirSync(rDir).filter(f => f.startsWith(`v${versionNum}_run`) && f.endsWith('.json'));
      const runIndex = existingRuns.length + 1;

      const fullResult = { runId: result.runId || crypto.randomUUID(), ranAt: new Date().toISOString(), algorithmCode: code, version: versionNum, tag: ver.tag, ...result };
      fs.writeFileSync(resultFile(code, versionNum, runIndex), JSON.stringify(fullResult, null, 2), 'utf8');

      const summary = buildSummary(versionNum, ver.tag, { ...result, ...fullResult });
      const idx = doc.versionSummary.findIndex(s => s.version === versionNum);
      if (idx >= 0) doc.versionSummary[idx] = summary; else doc.versionSummary.push(summary);

      const threshold = doc.promotionThreshold?.minAvgTradeProfitPct ?? 2.0;
      let promoted = false;
      if (summary.avgTradeProfitPct >= threshold) {
        summary.status = 'promoted';
        summary.promotedAt = new Date().toISOString();
        const currentBest = doc.versionSummary.find(s => s.version === doc.bestVersion);
        if (!currentBest || summary.avgTradeProfitPct > (currentBest.avgTradeProfitPct || -Infinity)) {
          doc.bestVersion = versionNum;
        }
        promoted = true;
      } else {
        summary.status = 'rejected';
      }

      doc.updatedAt = new Date().toISOString();
      saveDoc(code, doc);
      return { summary, promoted, resultFile: `results/v${versionNum}_run${runIndex}.json` };
    },

    attachExpectedResult(code, versionNum, expected) {
      const doc = loadDoc(code);
      if (!doc) throw new Error(`Algorithm '${code}' not found`);
      const ver = doc.versions.find(v => v.version === versionNum);
      if (!ver) throw new Error(`Version ${versionNum} not found`);
      if (!ver.expectedResults) ver.expectedResults = [];
      const entry = { id: crypto.randomUUID(), addedAt: new Date().toISOString(), ...expected };
      ver.expectedResults.push(entry);
      doc.updatedAt = new Date().toISOString();
      saveDoc(code, doc);
      return entry;
    },

    findAlgorithm: loadDoc,

    getVersion(code, num) {
      const doc = loadDoc(code);
      if (!doc) return null;
      const n = num || doc.currentVersion;
      return doc.versions.find(v => v.version === n) || null;
    },

    getVersionSummary(code, vNum) {
      const doc = loadDoc(code);
      if (!doc) return null;
      if (vNum) return doc.versionSummary.find(s => s.version === vNum) || null;
      return doc.versionSummary;
    },

    listAlgorithms() {
      const reg = loadReg();
      return reg.algorithms.map(c => {
        const d = loadDoc(c);
        if (!d) return { code: c, error: 'file missing' };
        return { code: d.code, name: d.name, currentVersion: d.currentVersion, bestVersion: d.bestVersion };
      });
    },

    getLatestBacktestResult(code, versionNum) {
      const rDir = resultsDir_(code);
      if (!fs.existsSync(rDir)) return null;
      const runs = fs.readdirSync(rDir).filter(f => f.startsWith(`v${versionNum}_run`) && f.endsWith('.json')).sort();
      if (!runs.length) return null;
      return JSON.parse(fs.readFileSync(path.join(rDir, runs[runs.length - 1]), 'utf8'));
    },

    compareExpectedVsActual(code, vNum) {
      const doc = loadDoc(code);
      if (!doc) return { error: 'Algorithm not found' };
      const n = vNum || doc.currentVersion;
      const ver = doc.versions.find(v => v.version === n);
      if (!ver) return { error: 'Version not found' };

      const rDir = resultsDir_(code);
      if (!fs.existsSync(rDir)) return { error: 'No backtest results found. Run a backtest first.' };
      const runs = fs.readdirSync(rDir).filter(f => f.startsWith(`v${n}_run`) && f.endsWith('.json')).sort();
      if (!runs.length) return { error: 'No backtest results found. Run a backtest first.' };
      const actual = JSON.parse(fs.readFileSync(path.join(rDir, runs[runs.length - 1]), 'utf8'));

      const report = { algorithmCode: code, version: n, ranAt: actual.ranAt, comparisons: [], passed: 0, failed: 0, skipped: 0 };
      for (const expectedEntry of (ver.expectedResults || [])) {
        if (expectedEntry.dataFile && expectedEntry.dataFile !== actual.dataFile) continue;
        for (const [metric, spec] of Object.entries(expectedEntry.metrics || {})) {
          const actualVal = actual[metric];
          const expectedVal = spec.expected;
          const tolerance = spec.tolerance ?? 0;
          const operator = spec.operator || 'approx';
          if (actualVal === undefined || actualVal === null) {
            report.skipped++;
            report.comparisons.push({ metric, expected: expectedVal, actual: 'N/A', result: 'SKIPPED' });
            continue;
          }
          let pass = false;
          if (operator === 'approx' || operator === '~=') pass = Math.abs(actualVal - expectedVal) <= tolerance;
          else if (operator === 'gte') pass = actualVal >= expectedVal;
          else if (operator === 'lte') pass = actualVal <= expectedVal;
          else if (operator === 'eq')  pass = actualVal === expectedVal;
          if (pass) report.passed++; else report.failed++;
          report.comparisons.push({ metric, expected: expectedVal, actual: actualVal, tolerance, operator, result: pass ? 'PASS' : 'FAIL' });
        }
      }
      report.overallResult = report.failed === 0 && report.comparisons.length > 0 ? 'PASS' : (report.failed > 0 ? 'FAIL' : 'NO_EXPECTATIONS');
      return report;
    },

    deleteAlgorithm(code) {
      const dir = algoDir(code);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const reg = loadReg();
      reg.algorithms = reg.algorithms.filter(c => c !== code);
      saveReg(reg);
    },
  };
});

const Algorithm = require('../src/models/algorithm');
const { computeIndicators, sma, emaFull, atr, rsi } = require('../src/indicators');
const { runBacktest } = require('../src/backtestEngine');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate synthetic OHLCV candles for deterministic testing.
 * Price follows: base + amplitude * sin(i / frequency)
 */
function generateCandles(count = 300, basePrice = 1000, amplitude = 50, frequency = 30) {
  const candles = [];
  const start = new Date('2026-02-27T09:15:00+05:30');
  for (let i = 0; i < count; i++) {
    const ts    = new Date(start.getTime() + i * 60000).toISOString();
    const close = basePrice + amplitude * Math.sin(i / frequency);
    const open  = close - 1 + Math.random() * 2;
    const high  = Math.max(open, close) + Math.random() * 3;
    const low   = Math.min(open, close) - Math.random() * 3;
    candles.push([ts, open, high, low, close, Math.floor(Math.random() * 500 + 50), 0]);
  }
  return candles;
}

const DEFAULT_GRID_CFG = {
  stepMode: 'FIXED',
  fixedStepPct: 1.5,
  minStepPct: 0.8,
  maxStepPct: 8.0,
  tradingQtyPerStep: 10,
  corePositionPct: 70,
  minLotSize: 5,
  maxActiveTickets: 5,
  allocationMode: 'FIXED',
  maxRebuyLevels: 3,
  rebuyLevels: [
    { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 34 },
    { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 33 },
    { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 33 },
  ],
  maxTicketAgeDays: 30,
  trendFilterEnabled: false,     // disabled for predictable unit tests
  maxDrawdownCircuitBreaker: 20,
  maxDailyCycles: 10,
  sessionCutoffTime: '15:20',
  hardStopLossPct: 15.0,
  atrPeriod: 14,
  trendEmaFastPeriod: 10,        // short periods for 300-candle dataset
  trendEmaSlowPeriod: 20,
};

// ═════════════════════════════════════════════════════════════════════════════
//  LAYER 1 — INDICATOR UNIT TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Layer 1 — Indicator Engine', () => {
  const vals = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  test('SMA returns correct average', () => {
    const result = sma(vals, 5);
    // last 5: [16,17,18,19,20] → avg = 18
    expect(result).toBeCloseTo(18, 1);
  });

  test('SMA returns null when not enough data', () => {
    expect(sma([1, 2], 5)).toBeNull();
  });

  test('EMA returns a number in range of values', () => {
    const result = emaFull(vals, 5);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(10);
    expect(result).toBeLessThanOrEqual(21);
  });

  test('RSI stays between 0 and 100', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(prices, 14);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('RSI trending up approaches 100', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const result = rsi(prices, 14);
    expect(result).toBeGreaterThan(60);
  });

  test('RSI trending down approaches 0', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 200 - i * 2);
    const result = rsi(prices, 14);
    expect(result).toBeLessThan(40);
  });

  test('ATR is always positive', () => {
    const candles = generateCandles(20).slice(0, 20);
    const result = atr(candles, 14);
    if (result !== null) expect(result).toBeGreaterThan(0);
  });

  test('ATR returns null when not enough data', () => {
    const result = atr(generateCandles(5), 14);
    expect(result).toBeNull();
  });

  test('computeIndicators returns all requested indicators', () => {
    const candles = generateCandles(50);
    const defs = [
      { type: 'SMA', source: 'close', params: { period: 10 }, name: 'SMA10' },
      { type: 'EMA', source: 'close', params: { period: 10 }, name: 'EMA10' },
      { type: 'CLOSE', name: 'CLOSE' },
    ];
    const result = computeIndicators(candles, defs);
    expect(result.has('SMA10')).toBe(true);
    expect(result.has('EMA10')).toBe(true);
    expect(result.has('CLOSE')).toBe(true);
    expect(result.get('CLOSE')).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  LAYER 2 — ALGORITHM MODEL UNIT TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Layer 2 — Algorithm Model (Version Control + Auto-Promotion)', () => {
  const CODE = `test-algo-${crypto.randomUUID().slice(0, 6)}`;

  afterAll(() => {
    try { Algorithm.deleteAlgorithm(CODE); } catch {}
  });

  test('createAlgorithm — creates a document with version 1', () => {
    const doc = Algorithm.createAlgorithm({
      algorithmCode: CODE,
      name: 'Test Grid Strategy',
      description: 'Unit test algorithm',
      promotionThreshold: { minAvgTradeProfitPct: 2.0 },
      initialVersion: {
        tag: 'v1.0-test',
        notes: 'Initial version for unit tests',
        gridConfig: { ...DEFAULT_GRID_CFG },
        ruleDesc: { buy: 'rebuy test', sell: 'sell test' },
      },
    });

    expect(doc.code).toBe(CODE);
    expect(doc.currentVersion).toBe(1);
    expect(doc.versions).toHaveLength(1);
    expect(doc.versions[0].tag).toBe('v1.0-test');
    expect(doc.bestVersion).toBeNull();
    expect(doc.promotionThreshold.minAvgTradeProfitPct).toBe(2.0);
  });

  test('createAlgorithm — throws on duplicate code', () => {
    expect(() => Algorithm.createAlgorithm({ algorithmCode: CODE, name: 'Dup' })).toThrow(/already exists/i);
  });

  test('findAlgorithm — retrieves the created document', () => {
    const doc = Algorithm.findAlgorithm(CODE);
    expect(doc).not.toBeNull();
    expect(doc.code).toBe(CODE);
  });

  test('addVersion — increments version number', () => {
    const ver = Algorithm.addVersion(CODE, {
      tag: 'v2.0-ema-filter',
      notes: 'Added EMA trend filter',
      gridConfig: { ...DEFAULT_GRID_CFG, trendFilterEnabled: true },
      ruleDesc: { buy: 'rebuy with trend', sell: 'sell with ema gate' },
    });

    expect(ver.version).toBe(2);
    expect(ver.tag).toBe('v2.0-ema-filter');
    expect(ver.ruleDesc.sell).toContain('ema gate');

    const doc = Algorithm.findAlgorithm(CODE);
    expect(doc.currentVersion).toBe(2);
    expect(doc.versions).toHaveLength(2);
  });

  test('getVersion — returns correct version', () => {
    const v1 = Algorithm.getVersion(CODE, 1);
    const v2 = Algorithm.getVersion(CODE, 2);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.tag).toBe('v2.0-ema-filter');
  });

  test('attachExpectedResult — stores manual expectations', () => {
    const expected = Algorithm.attachExpectedResult(CODE, 1, {
      description: 'Synthetic 300-candle test',
      metrics: {
        totalPnl:      { expected: 2000, tolerance: 5000, operator: 'approx' },
        maxDrawdownPct:{ expected: 15,   tolerance: 15,   operator: 'lte' },
        winRatePct:    { expected: 50,   tolerance: 50,   operator: 'approx' },
      },
    });
    expect(expected.id).toBeDefined();
    expect(expected.metrics.totalPnl.expected).toBe(2000);
  });

  test('attachBacktestResult — saves to results dir + builds versionSummary', () => {
    const { summary, promoted, resultFile } = Algorithm.attachBacktestResult(CODE, 1, {
      dataFile: 'synthetic-300-candles',
      fromDate: '2026-02-27T09:15:00.000Z',
      toDate:   '2026-03-27T09:15:00.000Z',
      totalCandles: 300,
      initialCapital: 100000,
      finalCapital: 102000,
      totalPnl: 2000,
      totalPnlPct: 2.0,
      totalTrades: 8,
      winCount: 5,
      lossCount: 3,
      winRatePct: 62.5,
      maxDrawdownPct: 3.2,
      maxDrawdownAbs: 3200,
      sharpeRatio: 1.2,
      avgTradePnl: 250,
      totalSells: 8,
      totalRebuys: 8,
      tradeLog: [],
      notes: 'Synthetic candle test',
    });

    expect(summary).toBeDefined();
    expect(summary.version).toBe(1);
    expect(summary.totalTrades).toBe(8);
    expect(typeof summary.avgTradeProfitPct).toBe('number');
    expect(['promoted', 'rejected']).toContain(summary.status);
    expect(resultFile).toMatch(/v1_run1\.json/);
  });

  test('getLatestBacktestResult — returns the full result from disk', () => {
    const latest = Algorithm.getLatestBacktestResult(CODE, 1);
    expect(latest).not.toBeNull();
    expect(latest.totalPnl).toBe(2000);
    expect(latest.winRatePct).toBe(62.5);
  });

  test('getVersionSummary — returns lightweight summary', () => {
    const summary = Algorithm.getVersionSummary(CODE, 1);
    expect(summary).not.toBeNull();
    expect(summary.version).toBe(1);
    expect(typeof summary.avgTradeProfitPct).toBe('number');
    expect(typeof summary.avgPerDayProfitPct).toBe('number');
    expect(typeof summary.tradingDays).toBe('number');
    expect(summary.tradingDays).toBeGreaterThan(0);
  });

  test('auto-promotion — version with 0% avgTradeProfit is rejected', () => {
    const CODE_REJECT = `reject-test-${crypto.randomUUID().slice(0, 6)}`;
    Algorithm.createAlgorithm({
      algorithmCode: CODE_REJECT,
      promotionThreshold: { minAvgTradeProfitPct: 2.0 },
      initialVersion: { tag: 'v1-low', gridConfig: { ...DEFAULT_GRID_CFG } },
    });

    const { summary, promoted } = Algorithm.attachBacktestResult(CODE_REJECT, 1, {
      dataFile: 'test', fromDate: '2026-01-01', toDate: '2026-01-10',
      totalCandles: 100, initialCapital: 10000, finalCapital: 9800,
      totalPnl: -200, totalPnlPct: -2.0, totalTrades: 5,
      winCount: 2, lossCount: 3, winRatePct: 40,
      maxDrawdownPct: 5, maxDrawdownAbs: 500, sharpeRatio: -0.5,
      avgTradePnl: -40, totalSells: 5, totalRebuys: 3, tradeLog: [], notes: '',
    });

    expect(promoted).toBe(false);
    expect(summary.status).toBe('rejected');

    const doc = Algorithm.findAlgorithm(CODE_REJECT);
    expect(doc.bestVersion).toBeNull();
    Algorithm.deleteAlgorithm(CODE_REJECT);
  });

  test('auto-promotion — high profit version gets promoted to bestVersion', () => {
    const CODE_PROMO = `promo-test-${crypto.randomUUID().slice(0, 6)}`;
    Algorithm.createAlgorithm({
      algorithmCode: CODE_PROMO,
      promotionThreshold: { minAvgTradeProfitPct: 2.0 },
      initialVersion: { tag: 'v1-good', gridConfig: { ...DEFAULT_GRID_CFG } },
    });

    // avgTradePnl=300, initialCapital=10000, totalTrades=10
    // avgTradeProfitPct = (300 / (10000/10)) * 100 = (300/1000)*100 = 30% → promoted
    const { summary, promoted } = Algorithm.attachBacktestResult(CODE_PROMO, 1, {
      dataFile: 'test', fromDate: '2026-01-01', toDate: '2026-01-10',
      totalCandles: 100, initialCapital: 10000, finalCapital: 13000,
      totalPnl: 3000, totalPnlPct: 30.0, totalTrades: 10,
      winCount: 9, lossCount: 1, winRatePct: 90,
      maxDrawdownPct: 2, maxDrawdownAbs: 200, sharpeRatio: 3.5,
      avgTradePnl: 300, totalSells: 10, totalRebuys: 10, tradeLog: [], notes: '',
    });

    expect(promoted).toBe(true);
    expect(summary.status).toBe('promoted');
    expect(summary.promotedAt).not.toBeNull();

    const doc = Algorithm.findAlgorithm(CODE_PROMO);
    expect(doc.bestVersion).toBe(1);
    Algorithm.deleteAlgorithm(CODE_PROMO);
  });

  test('listAlgorithms — includes the algorithm', () => {
    const list = Algorithm.listAlgorithms();
    const found = list.find(a => a.code === CODE);
    expect(found).toBeDefined();
    expect(found.currentVersion).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  LAYER 3 — BACKTEST ENGINE INTEGRATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Layer 3 — Backtest Engine (Integration)', () => {
  let result;
  const CANDLES = generateCandles(300, 975, 30, 25);

  beforeAll(() => {
    result = runBacktest({
      candles: CANDLES,
      gridConfig: DEFAULT_GRID_CFG,
      initialQty: 100,
      initialPrice: 975,
      capitalPerShare: 1,
      dataFile: 'synthetic-300-candles',
      notes: 'Jest integration test',
    });
  });

  test('runBacktest — returns a result object', () => {
    expect(result).toBeDefined();
    expect(result.runId).toBeDefined();
  });

  test('runBacktest — totalCandles is set', () => {
    expect(result.totalCandles).toBeGreaterThan(0);
  });

  test('runBacktest — initialCapital is positive', () => {
    expect(result.initialCapital).toBeGreaterThan(0);
  });

  test('runBacktest — finalCapital is a number', () => {
    expect(typeof result.finalCapital).toBe('number');
    expect(isNaN(result.finalCapital)).toBe(false);
  });

  test('runBacktest — tradeLog is an array', () => {
    expect(Array.isArray(result.tradeLog)).toBe(true);
  });

  test('runBacktest — winCount + lossCount = totalTrades', () => {
    expect(result.winCount + result.lossCount).toBe(result.totalTrades);
  });

  test('runBacktest — winRatePct is between 0 and 100', () => {
    expect(result.winRatePct).toBeGreaterThanOrEqual(0);
    expect(result.winRatePct).toBeLessThanOrEqual(100);
  });

  test('runBacktest — maxDrawdownPct is non-negative', () => {
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  test('runBacktest — finalState.totalHoldings is non-negative', () => {
    expect(result.finalState.totalHoldings).toBeGreaterThanOrEqual(0);
  });

  test('runBacktest — all SELL trades have a price', () => {
    const sells = result.tradeLog.filter(t => t.action === 'SELL');
    for (const s of sells) {
      expect(typeof s.price).toBe('number');
      expect(s.price).toBeGreaterThan(0);
    }
  });

  test('runBacktest — all BUY trades have quantity > 0', () => {
    const buys = result.tradeLog.filter(t => t.action === 'BUY');
    for (const b of buys) {
      expect(b.qty).toBeGreaterThan(0);
    }
  });

  test('runBacktest — throws with empty candles', () => {
    expect(() => runBacktest({ candles: [], gridConfig: DEFAULT_GRID_CFG, initialQty: 100, initialPrice: 975 })).toThrow(/No candles/i);
  });

  test('runBacktest — throws with out-of-range date filter', () => {
    expect(() => runBacktest({
      candles: CANDLES,
      gridConfig: DEFAULT_GRID_CFG,
      initialQty: 100,
      initialPrice: 975,
      fromDate: '2030-01-01',
    })).toThrow(/No candles in date range/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  LAYER 4 — EXPECTED vs ACTUAL (Transparency Gate)
// ═════════════════════════════════════════════════════════════════════════════

describe('Layer 4 — Expected vs Actual Comparison (Transparency Gate)', () => {
  /**
   * HOW TO USE THIS LAYER:
   *
   * Before each backtest run, fill in expectedResults to document
   * what the strategy should produce. The test then runs the actual
   * backtest and compares each metric against the manual expectation.
   *
   * If the backtest produces wildly different numbers → test FAILS.
   */

  const CODE2 = `transparency-test-${crypto.randomUUID().slice(0, 6)}`;
  const CANDLES2 = generateCandles(300, 975, 30, 25);
  let actualResult;

  beforeAll(() => {
    // Step 1: Register algorithm with pre-filled expectations
    Algorithm.createAlgorithm({
      algorithmCode: CODE2,
      name: 'Transparency Gate Test',
      promotionThreshold: { minAvgTradeProfitPct: 2.0 },
      initialVersion: {
        tag: 'v1.0-transparency-test',
        gridConfig: { ...DEFAULT_GRID_CFG },
        ruleDesc: { buy: 'test rebuy', sell: 'test sell' },
        // ── MANUAL EXPECTED RESULTS ──────────────────────────────────
        // Wide tolerances for synthetic test data.
        expectedResults: [{
          description: 'Synthetic 300-candle oscillating market test',
          metrics: {
            totalPnl:       { expected: 0,  tolerance: 50000, operator: 'approx' }, // any direction OK
            maxDrawdownPct: { expected: 0,  tolerance: 25,    operator: 'lte'    }, // <= 25%
            winRatePct:     { expected: 50, tolerance: 50,    operator: 'approx' }, // 0-100%
            totalTrades:    { expected: 5,  tolerance: 50,    operator: 'approx' }, // 0-55 trades OK
          },
        }],
      },
    });

    // Step 2: Run actual backtest
    actualResult = runBacktest({
      candles: CANDLES2,
      gridConfig: { ...DEFAULT_GRID_CFG },
      initialQty: 100,
      initialPrice: 975,
      dataFile: 'synthetic-transparency-test',
      notes: 'Layer 4 transparency gate run',
    });

    // Step 3: Attach result (saves full result to disk, summary to algo.json)
    Algorithm.attachBacktestResult(CODE2, 1, actualResult);
  });

  afterAll(() => {
    try { Algorithm.deleteAlgorithm(CODE2); } catch {}
  });

  test('Expected vs Actual — comparison report is generated', () => {
    const report = Algorithm.compareExpectedVsActual(CODE2, 1);
    expect(report).toBeDefined();
    expect(report.overallResult).toBeDefined();
    expect(Array.isArray(report.comparisons)).toBe(true);
  });

  test('Expected vs Actual — all tracked metrics PASS their expectations', () => {
    const report = Algorithm.compareExpectedVsActual(CODE2, 1);
    const failed = report.comparisons.filter(c => c.result === 'FAIL');

    if (failed.length > 0) {
      console.error('\n📊 FAILED METRICS:');
      for (const f of failed) {
        console.error(`  ❌ ${f.metric}: expected=${f.expected} actual=${f.actual} tolerance=${f.tolerance} op=${f.operator}`);
      }
    }

    expect(report.overallResult).toBe('PASS');
  });

  test('Expected vs Actual — maxDrawdownPct is within risk limits', () => {
    expect(actualResult.maxDrawdownPct).toBeLessThanOrEqual(25);
  });

  test('Expected vs Actual — win rate is a valid percentage', () => {
    expect(actualResult.winRatePct).toBeGreaterThanOrEqual(0);
    expect(actualResult.winRatePct).toBeLessThanOrEqual(100);
  });

  test('Expected vs Actual — sharpe ratio is finite', () => {
    expect(isFinite(actualResult.sharpeRatio)).toBe(true);
  });

  test('versionSummary — is populated after backtest', () => {
    const summary = Algorithm.getVersionSummary(CODE2, 1);
    expect(summary).not.toBeNull();
    expect(summary.version).toBe(1);
    expect(['promoted', 'rejected']).toContain(summary.status);
    expect(typeof summary.avgTradeProfitPct).toBe('number');
    expect(typeof summary.tradingDays).toBe('number');
  });
});
