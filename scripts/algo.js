/**
 * scripts/algo.js — Unified Algorithm CLI
 *
 * Replaces: seedAlgorithm.js, addVersion3.js, addVersion4.js
 *
 * Usage:
 *   node scripts/algo.js create   — Create algorithm with v1
 *   node scripts/algo.js add      — Add next version (prompts for config)
 *   node scripts/algo.js test     — Run backtest on latest/specific version
 *   node scripts/algo.js status   — Print version summary table
 *   node scripts/algo.js compare  — Side-by-side comparison of all versions
 *   node scripts/algo.js reset    — Delete algorithm and re-seed from scratch
 *
 * Flags:
 *   --code <algorithmCode>   default: "asymmetric-grid"
 *   --version <N>            for test: specific version to run
 *   --all                    for test: run all versions
 */

'use strict';

const Algorithm     = require('../src/models/algorithm');
const { runBacktest } = require('../src/backtestEngine');
const { loadCandles } = require('../src/dataManager');
const readline = require('readline');
const { fetchFromMongo, pushToMongo } = require('./mongoSync');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

const TEMPLATES = {
  'simple-grid': {
    stepMode: 'ATR', atrStepMultiplier: 1.5,
    corePositionPct: 70, maxActiveTickets: 5,
    allocationMode: 'ATR_ADAPTIVE',
    rebuyLevels: [
      { levelName: 'R1', depthMultiplier: 1, qtyPct: 50 },
      { levelName: 'R2', depthMultiplier: 2, qtyPct: 50 },
    ],
    maxTicketAgeDays: 30,
    trendFilterEnabled: false,
  },
  'trend-grid': {
    stepMode: 'ATR', atrStepMultiplier: 2.0,
    corePositionPct: 60, maxActiveTickets: 3,
    trendFilterEnabled: true,
    trendEmaFastPeriod: 50, trendEmaSlowPeriod: 200,
    rebuyLevels: [
      { levelName: 'R1', depthMultiplier: 1.5, qtyPct: 35 },
      { levelName: 'R2', depthMultiplier: 3,   qtyPct: 35 },
      { levelName: 'R3', depthMultiplier: 5,   qtyPct: 30 },
    ],
    maxTicketAgeDays: 45,
    hardStopLossPct: 18, maxDrawdownCircuitBreaker: 25,
  },
  'scalp-grid': {
    stepMode: 'ATR', atrStepMultiplier: 1.2,
    corePositionPct: 60, maxActiveTickets: 3,
    allocationMode: 'FIXED',
    rebuyLevels: [
      { levelName: 'R1', depthMultiplier: 1, qtyPct: 33 },
      { levelName: 'R2', depthMultiplier: 2, qtyPct: 33 },
      { levelName: 'R3', depthMultiplier: 3, qtyPct: 34 },
    ],
    maxTicketAgeDays: 20, maxDailyCycles: 10,
    trendFilterEnabled: true,
  },
  'swing-grid': {
    stepMode: 'ATR', atrStepMultiplier: 2.5,
    tradingQtyPerStep: 15, corePositionPct: 50,
    maxActiveTickets: 2,
    rebuyLevels: [
      { levelName: 'R1', depthMultiplier: 2,   qtyPct: 40 },
      { levelName: 'R2', depthMultiplier: 4,   qtyPct: 35 },
      { levelName: 'R3', depthMultiplier: 6.5, qtyPct: 25 },
    ],
    maxTicketAgeDays: 60,
    hardStopLossPct: 20, maxDrawdownCircuitBreaker: 30,
    trendFilterEnabled: true,
  },
  'conservative': {
    stepMode: 'ATR', atrStepMultiplier: 1.5,
    tradingQtyPerStep: 5, corePositionPct: 80,
    maxActiveTickets: 2,
    rebuyLevels: [
      { levelName: 'R1', depthMultiplier: 1, qtyPct: 50 },
      { levelName: 'R2', depthMultiplier: 2, qtyPct: 50 },
    ],
    maxTicketAgeDays: 15,
    hardStopLossPct: 10, maxDrawdownCircuitBreaker: 15,
    maxDailyCycles: 4, sessionCutoffTime: '14:30',
    trendFilterEnabled: true,
  },
};

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CODE = 'asymmetric-grid';

// ─── Version Definitions ──────────────────────────────────────────────────────
// Add new versions here. Each version is cumulative — document what changed.

const VERSION_DEFINITIONS = [

  // ── Version 1: Baseline ────────────────────────────────────────────────────
  {
    tag:   'v1-baseline',
    notes: 'Baseline ATR-adaptive grid, no trend filter.',

    indicators: [
      { type: 'ATR',   params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA',   source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA',   source: 'close', params: { period: 200 }, name: 'EMA200' },
    ],

    ruleDesc: {
      buy:  'Rebuy at R1/R2/R3 depth below sell price. ATR-adaptive allocation.',
      sell: 'Sell when price rises 1.5×ATR% above entry. No trend filter.',
    },

    riskConfig: {
      stopLossPercent: 15,
      maxConcurrentPositions: 5,
      intradaySquareOffTime: '15:20',
    },

    gridConfig: {
      stepMode: 'ATR', atrPeriod: 14, atrStepMultiplier: 1.5,
      minStepPct: 0.8, maxStepPct: 8.0,
      tradingQtyPerStep: 10, corePositionPct: 70,
      minLotSize: 5, maxActiveTickets: 5,
      allocationMode: 'ATR_ADAPTIVE', maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 30 },
        { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 30 },
        { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 40 },
      ],
      maxTicketAgeDays: 30,
      trendFilterEnabled: false,
      trendEmaFastPeriod: 50, trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 18, maxDailyCycles: 8,
      sessionCutoffTime: '15:10', hardStopLossPct: 10.0,
    },
  },

  // ── Version 2: Trend filter ────────────────────────────────────────────────
  {
    tag:   'v2-trend-filter',
    notes: 'Added EMA50 > EMA200 gate. Suppresses sells in downtrend.',

    indicators: [
      { type: 'ATR', params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA', source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA', source: 'close', params: { period: 200 }, name: 'EMA200' },
    ],

    ruleDesc: {
      buy:  'Rebuy at R1/R2/R3 below sell. R1 blocked in downtrend.',
      sell: 'Sell only when EMA50 > EMA200 (uptrend) AND price 1.5×ATR% above entry.',
    },

    riskConfig: {
      stopLossPercent: 15,
      maxConcurrentPositions: 5,
      intradaySquareOffTime: '15:20',
    },

    gridConfig: {
      stepMode: 'ATR', atrPeriod: 14, atrStepMultiplier: 1.5,
      minStepPct: 0.8, maxStepPct: 8.0,
      tradingQtyPerStep: 10, corePositionPct: 70,
      minLotSize: 5, maxActiveTickets: 5,
      allocationMode: 'ATR_ADAPTIVE', maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 30 },
        { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 30 },
        { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 40 },
      ],
      maxTicketAgeDays: 30,
      trendFilterEnabled: true,
      trendEmaFastPeriod: 50, trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 18, maxDailyCycles: 8,
      sessionCutoffTime: '15:10', hardStopLossPct: 10.0,
    },
  },

  // ── Version 3: Optimized ───────────────────────────────────────────────────
  {
    tag:   'v3-optimized',
    notes: [
      'Wider sell step (2×ATR), deeper rebuy ladder, looser stop.',
      '• atrStepMultiplier: 1.5 → 2.0 (higher sell margin per cycle)',
      '• hardStopLossPct: 10 → 18 (stop was triggering too early in volatility)',
      '• maxDrawdownCircuitBreaker: 18 → 25 (less aggressive pause)',
      '• rebuyLevels: 1x/2x/3.5x → 1.5x/3x/5x (deeper rebuys = better fill prices)',
      '• maxActiveTickets: 5 → 3 (fewer stale open ladders)',
      '• corePositionPct: 70 → 60 (more qty available to trade)',
      '• tradingQtyPerStep: 10 → 15 (larger lot = more PnL per cycle)',
    ].join('\n'),

    indicators: [
      { type: 'ATR', params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA', source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA', source: 'close', params: { period: 200 }, name: 'EMA200' },
    ],

    ruleDesc: {
      buy:  'Rebuy at 1.5x/3x/5x ATR step below sell. Deeper fills than v1/v2.',
      sell: 'Sell only in uptrend (EMA50>EMA200) at 2×ATR% above entry. Wider margin.',
    },

    riskConfig: {
      stopLossPercent: 18,
      maxConcurrentPositions: 3,
      intradaySquareOffTime: '15:10',
    },

    gridConfig: {
      stepMode: 'ATR', atrPeriod: 14, atrStepMultiplier: 2.0,
      minStepPct: 1.0, maxStepPct: 8.0,
      tradingQtyPerStep: 15, corePositionPct: 60,
      minLotSize: 5, maxActiveTickets: 3,
      allocationMode: 'ATR_ADAPTIVE', maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.5, qtyPct: 35 },
        { levelName: 'R2', depthMultiplier: 3.0, qtyPct: 35 },
        { levelName: 'R3', depthMultiplier: 5.0, qtyPct: 30 },
      ],
      maxTicketAgeDays: 45,
      trendFilterEnabled: true,
      trendEmaFastPeriod: 50, trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 25, maxDailyCycles: 6,
      sessionCutoffTime: '15:10', hardStopLossPct: 18.0,
    },
  },

  // ── Version 4: Tighter sell, faster cycle ────────────────────────────────
  {
    tag:   'v4-fast-cycle',
    notes: [
      'Tighter step for more frequent cycles, fixed allocation for predictability.',
      '• atrStepMultiplier: 2.0 → 1.2 (tighter step = more sell triggers)',
      '• allocationMode: ATR_ADAPTIVE → FIXED (predictable rebuy qty)',
      '• maxDailyCycles: 6 → 10 (allow more cycles when market is active)',
      '• maxTicketAgeDays: 45 → 20 (expire stale tickets faster)',
    ].join('\n'),

    indicators: [
      { type: 'ATR', params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA', source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA', source: 'close', params: { period: 200 }, name: 'EMA200' },
    ],

    ruleDesc: {
      buy:  'Rebuy at 1x/2x/3x ATR step. Fixed 33%/33%/33% allocation per level.',
      sell: 'Sell in uptrend at 1.2×ATR% above entry. Faster, more frequent cycles.',
    },

    riskConfig: {
      stopLossPercent: 18,
      maxConcurrentPositions: 3,
      intradaySquareOffTime: '15:10',
    },

    gridConfig: {
      stepMode: 'ATR', atrPeriod: 14, atrStepMultiplier: 1.2,
      minStepPct: 0.5, maxStepPct: 5.0,
      tradingQtyPerStep: 15, corePositionPct: 60,
      minLotSize: 5, maxActiveTickets: 3,
      allocationMode: 'FIXED', maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 33 },
        { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 33 },
        { levelName: 'R3', depthMultiplier: 3.0, qtyPct: 34 },
      ],
      maxTicketAgeDays: 20,
      trendFilterEnabled: true,
      trendEmaFastPeriod: 50, trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 20, maxDailyCycles: 10,
      sessionCutoffTime: '15:10', hardStopLossPct: 15.0,
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const cmd    = args[0];
  const flags  = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return { cmd, flags };
}

function pad(str, len, right = false) {
  const s = String(str ?? 'N/A');
  return right ? s.padStart(len) : s.padEnd(len);
}

function fmtPnl(val) {
  if (val == null) return pad('N/A', 10, true);
  const n = Number(val).toFixed(0);
  return pad((val >= 0 ? '₹' : '-₹') + Math.abs(n), 10, true);
}

function fmtPct(val, decimals = 2) {
  if (val == null) return pad('N/A', 8, true);
  return pad(Number(val).toFixed(decimals) + '%', 8, true);
}

function fmtNum(val, decimals = 2) {
  if (val == null) return pad('N/A', 8, true);
  return pad(Number(val).toFixed(decimals), 8, true);
}

function statusIcon(status) {
  return { promoted: '🏆', rejected: '❌', testing: '⏳' }[status] || '?';
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdCreate(code) {
  console.log(`\n🌱 Creating algorithm: ${code}`);

  if (Algorithm.findAlgorithm(code)) {
    console.error(`❌ Algorithm '${code}' already exists. Use 'reset' to start over.`);
    process.exit(1);
  }

  const v1def = VERSION_DEFINITIONS[0];
  Algorithm.createAlgorithm({
    algorithmCode: code,
    name: 'Asymmetric Grid Strategy',
    description: [
      'Asymmetric multi-level grid strategy.',
      'Sells in small lots at ATR-adaptive step above entry.',
      'Creates tiered rebuy ladders (R1/R2/R3) below the sell price.',
      'Protects a core floor of holdings to avoid full exit.',
    ].join(' '),
    promotionThreshold: { minAvgTradeProfitPct: 2.0 },
    initialVersion: v1def,
  });

  console.log(`   ✅ Version 1 created: ${v1def.tag}`);
  console.log(`   📁 data/algorithms/${code}/algo.json`);
  console.log('\n   Run backtest: node scripts/algo.js test');
}

function cmdAdd(code) {
  const doc = Algorithm.findAlgorithm(code);
  if (!doc) { console.error(`❌ Algorithm '${code}' not found. Run: node scripts/algo.js create`); process.exit(1); }

  const nextVersion = doc.currentVersion + 1;
  const def = VERSION_DEFINITIONS[nextVersion - 1];
  if (!def) {
    console.error(`❌ No definition for version ${nextVersion} in VERSION_DEFINITIONS[]. Add it to scripts/algo.js.`);
    process.exit(1);
  }

  console.log(`\n➕ Adding v${nextVersion} to: ${code}`);
  Algorithm.addVersion(code, def);
  console.log(`   ✅ Version ${nextVersion} created: ${def.tag}`);
  console.log('\n   Run backtest: node scripts/algo.js test');
}

async function cmdTest(code, versionArg, runAll) {
  const doc = Algorithm.findAlgorithm(code);
  if (!doc) { console.error(`❌ Algorithm '${code}' not found.`); process.exit(1); }

  let versionsToRun;
  if (runAll) {
    versionsToRun = doc.versions.map(v => v.version);
  } else {
    const vNum = versionArg ? parseInt(versionArg) : doc.currentVersion;
    versionsToRun = [vNum];
  }

  // Load candles once
  let candles;
  try {
    candles = loadCandles();
    if (!candles || candles.length === 0) throw new Error('No candles loaded');
    console.log(`\n📈 Loaded ${candles.length} candles`);
  } catch (err) {
    console.error('❌ Could not load candle data:', err.message);
    process.exit(1);
  }

  for (const vNum of versionsToRun) {
    const ver = Algorithm.getVersion(code, vNum);
    if (!ver) { console.warn(`   ⚠️  Version ${vNum} not found, skipping.`); continue; }

    console.log(`\n▶  Testing ${ver.tag} (v${vNum})...`);
    console.log(`   Buy:  ${ver.ruleDesc?.buy}`);
    console.log(`   Sell: ${ver.ruleDesc?.sell}`);

    try {
      const result = runBacktest({
        candles,
        gridConfig:    ver.gridConfig,
        initialQty:    100,
        initialPrice:  candles[0][4],
        capitalPerShare: 1,
        dataFile:      'CEINSYS_INE016Q01014_1minute',
        notes:         `algo.js test run — ${ver.tag}`,
      });

      const { summary, promoted, resultFile } = Algorithm.attachBacktestResult(code, vNum, result);

      console.log(`\n   ${statusIcon(summary.status)} ${summary.status.toUpperCase()}  (threshold: >${doc.promotionThreshold.minAvgTradeProfitPct}% avg trade profit)`);
      console.log(`   ─────────────────────────────────────────`);
      console.log(`   avgTradeProfitPct : ${summary.avgTradeProfitPct}%`);
      console.log(`   avgPerDayProfit   : ${summary.avgPerDayProfitPct}%  (over ${summary.tradingDays} trading days)`);
      console.log(`   totalPnl          : ₹${summary.totalPnl} (${summary.totalPnlPct}%)`);
      console.log(`   trades            : ${summary.totalTrades} | winRate: ${summary.winRatePct}%`);
      console.log(`   maxDrawdown       : ${summary.maxDrawdownPct}%`);
      console.log(`   sells / rebuys    : ${summary.totalSells} / ${summary.totalRebuys}  (qty sold: ${summary.totalSellQty} | qty bought: ${summary.totalBuyQty})`);

      console.log(`   resultFile        : ${resultFile}`);

      if (promoted) {
        console.log(`\n   🏆 PROMOTED! bestVersion is now v${vNum}`);
      }

    } catch (err) {
      console.error(`   ❌ Backtest failed:`, err.message);
    }
  }

  cmdStatus(code);
}

function cmdStatus(code) {
  const doc = Algorithm.findAlgorithm(code);
  if (!doc) { console.error(`❌ Algorithm '${code}' not found.`); process.exit(1); }

  const W = 95;
  console.log(`\n${'─'.repeat(W)}`);
  console.log(` ${doc.name}  [${doc.code}]`);
  console.log(` Promotion threshold: avgTradeProfitPct >= ${doc.promotionThreshold?.minAvgTradeProfitPct}%`);
  console.log(` Best version: ${doc.bestVersion ? `v${doc.bestVersion}` : 'none yet'}`);
  console.log(`${'─'.repeat(W)}`);
  console.log(` ${'Ver'.padEnd(4)} ${'Tag'.padEnd(20)} ${'Status'.padEnd(10)} ${'AvgPft%'.padStart(8)} ${'DayPft%'.padStart(8)} ${'PnL'.padStart(10)} ${'Trades'.padStart(7)} ${'WinR%'.padStart(7)} ${'MaxDD%'.padStart(7)} ${'SellQty'.padStart(8)} ${'BuyQty'.padStart(7)}`);
  console.log(`${'─'.repeat(W)}`);

  for (const s of doc.versionSummary) {
    const icon = statusIcon(s.status);
    const row = [
      ` ${icon} ${String(s.version).padEnd(2)}`,
      s.tag.padEnd(20),
      s.status.padEnd(10),
      fmtPct(s.avgTradeProfitPct),
      fmtPct(s.avgPerDayProfitPct),
      fmtPnl(s.totalPnl),
      String(s.totalTrades ?? 'N/A').padStart(7),
      fmtPct(s.winRatePct),
      fmtPct(s.maxDrawdownPct),
      String(s.totalSellQty ?? 'N/A').padStart(8),
      String(s.totalBuyQty  ?? 'N/A').padStart(7),
    ].join(' ');
    console.log(row);
  }

  const notTested = doc.versions.filter(v => !doc.versionSummary.find(s => s.version === v.version));
  if (notTested.length) {
    for (const v of notTested) {
      console.log(` ⏳ v${String(v.version).padEnd(2)} ${v.tag.padEnd(20)} ${'not tested yet'.padEnd(10)}`);
    }
  }
  console.log(`${'─'.repeat(W)}\n`);

}

function cmdCompare(code) {
  const doc = Algorithm.findAlgorithm(code);
  if (!doc) { console.error(`❌ Algorithm '${code}' not found.`); process.exit(1); }

  console.log(`\n📊 Version Comparison — ${doc.name}`);
  cmdStatus(code);

  // Print ruleDesc for each version
  console.log(' Rule Descriptions:');
  for (const v of doc.versions) {
    console.log(`\n   v${v.version} (${v.tag})`);
    console.log(`     Buy:  ${v.ruleDesc?.buy  || '—'}`);
    console.log(`     Sell: ${v.ruleDesc?.sell || '—'}`);
  }
  console.log('');
}

function cmdReset(code) {
  console.log(`\n🗑️  Resetting algorithm: ${code}`);
  Algorithm.deleteAlgorithm(code);
  console.log(`   ✅ Deleted. Re-create with: node scripts/algo.js create`);
}

const MENU_TEXT = `
  ╔══════════════════════════════════════════════╗
  ║          AlgoTester — Main Menu              ║
  ╠══════════════════════════════════════════════╣
  ║                                              ║
  ║  📦 MANAGE                                   ║
  ║  1. Create new algorithm                     ║
  ║  2. Add version to existing algorithm        ║
  ║  3. List all algorithms & status             ║
  ║                                              ║
  ║  🧪 TEST                                     ║
  ║  4. Run backtest (single version)            ║
  ║  5. Run backtest (all versions)              ║
  ║  6. Compare versions side-by-side            ║
  ║                                              ║
  ║  🔧 OPTIMIZE                                 ║
  ║  7. Optimize a version (guided)              ║
  ║                                              ║
  ║  🚀 DEPLOY                                   ║
  ║  8. Fetch algorithm(s) from MongoDB          ║
  ║  9. Push best version to MongoDB             ║
  ║                                              ║
  ║  🗑️  CLEANUP                                 ║
  ║  10. Reset algorithm (delete everything)     ║
  ║                                              ║
  ║  0. Exit                                     ║
  ╚══════════════════════════════════════════════╝
`;

async function menuCreate() {
  console.log('\n🌱 Create New Algorithm');
  const code = await ask('? Algorithm code (e.g., my-grid-1): ');
  if (!code) { console.log('Canceled.'); return; }

  if (Algorithm.findAlgorithm(code)) {
    console.error(`❌ Algorithm '${code}' already exists.`);
    return;
  }

  console.log('\n? Select strategy template:');
  const tplKeys = Object.keys(TEMPLATES);
  tplKeys.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));
  const tplChoice = await ask(`> (1-${tplKeys.length}): `);
  const tplIndex = parseInt(tplChoice) - 1;
  const templateName = tplKeys[tplIndex];

  if (!templateName) { console.log('Invalid choice.'); return; }

  const qty = await ask('? Trading quantity per step (default 10): ');
  const levels = await ask('? Rebuy levels (how many, default 3): ');

  const gridConfig = { ...TEMPLATES[templateName] };
  if (qty) gridConfig.tradingQtyPerStep = parseInt(qty);
  if (levels) {
    const l = parseInt(levels);
    gridConfig.maxRebuyLevels = l;
    gridConfig.rebuyLevels = [];
    for (let i = 1; i <= l; i++) {
      gridConfig.rebuyLevels.push({
        levelName: `R${i}`,
        depthMultiplier: i * 1.5,
        qtyPct: Math.floor(100 / l)
      });
    }
  }

  Algorithm.createAlgorithm({
    algorithmCode: code,
    name: code,
    description: `Created from template: ${templateName}`,
    initialVersion: {
      tag: 'v1-baseline',
      notes: `Baseline ${templateName}`,
      gridConfig
    }
  });

  console.log(`\n✅ Created "${code}" with ${templateName} template.`);
}

async function askAlgorithmCode() {
  const list = Algorithm.listAlgorithms();
  if (list.length === 0) {
    console.log('No algorithms found.');
    return null;
  }
  console.log('\n? Select algorithm:');
  list.forEach((a, i) => console.log(`  ${i + 1}. ${a.code} (versions: ${a.totalVersions})`));
  const choice = await ask(`> (1-${list.length}) or type code: `);
  
  const index = parseInt(choice) - 1;
  if (!isNaN(index) && list[index]) {
    return list[index].code;
  }
  return choice.trim() || null;
}

async function menuAddVersion() {
  const code = await askAlgorithmCode();
  if (!code) return;
  const doc = Algorithm.findAlgorithm(code);
  if (!doc) { console.error('❌ Not found.'); return; }

  console.log('\n? Select strategy template for new version:');
  const tplKeys = Object.keys(TEMPLATES);
  tplKeys.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));
  const tplChoice = await ask(`> (1-${tplKeys.length}): `);
  const tplIndex = parseInt(tplChoice) - 1;
  const templateName = tplKeys[tplIndex];

  if (!templateName) { console.log('Invalid choice.'); return; }

  const gridConfig = { ...TEMPLATES[templateName] };
  const nextVersion = doc.currentVersion + 1;
  Algorithm.addVersion(code, {
    tag: `v${nextVersion}-${templateName}`,
    notes: `Added from template: ${templateName}`,
    gridConfig
  });

  console.log(`\n✅ Version ${nextVersion} created.`);
}

function menuStatusInteractive() {
  const list = Algorithm.listAlgorithms();
  if (list.length === 0) { console.log('No algorithms found.'); return; }
  console.log('\n📊 Available Algorithms:');
  list.forEach(a => console.log(`  - ${a.code} (versions: ${a.totalVersions}, best: v${a.bestVersion || 'none'})`));
}

async function menuTest() {
  const code = await askAlgorithmCode();
  if (!code) return;
  const version = await ask('? Version to test (leave blank for current): ');
  await cmdTest(code, version || undefined, false);
}

async function menuTestAll() {
  const code = await askAlgorithmCode();
  if (!code) return;
  await cmdTest(code, null, true);
}

async function menuCompare() {
  const code = await askAlgorithmCode();
  if (!code) return;
  cmdCompare(code);
}

async function menuReset() {
  const code = await askAlgorithmCode();
  if (!code) return;
  cmdReset(code);
}

async function menuOptimize() {
  console.log('Optimize feature not yet implemented (Phase 4).');
}

async function menuFetchDB() {
  await fetchFromMongo();
}

async function menuDeliverDB() {
  await pushToMongo();
}

async function mainMenu() {
  while (true) {
    console.log(MENU_TEXT);
    const choice = await ask('  Enter number: ');
    switch (choice) {
      case '1': await menuCreate(); break;
      case '2': await menuAddVersion(); break;
      case '3': menuStatusInteractive(); break;
      case '4': await menuTest(); break;
      case '5': await menuTestAll(); break;
      case '6': await menuCompare(); break;
      case '7': await menuOptimize(); break;
      case '8': await menuFetchDB(); break;
      case '9': await menuDeliverDB(); break;
      case '10': await menuReset(); break;
      case '0': process.exit(0);
      default: console.log('Invalid choice.');
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { cmd, flags } = parseArgs();
  if (!cmd) {
    await mainMenu();
  } else {
    // legacy command line execution
    const code = flags.code || DEFAULT_CODE;
    switch (cmd) {
      case 'create':  console.log('Use interactive menu: npm run algo'); break;
      case 'add':     console.log('Use interactive menu: npm run algo'); break;
      case 'test':    await cmdTest(code, flags.version, flags.all === true); break;
      case 'status':  cmdStatus(code); break;
      case 'compare': cmdCompare(code); break;
      case 'reset':   cmdReset(code); break;
      default: console.log('Unknown command.');
    }
  }
}

main().catch(console.error);
