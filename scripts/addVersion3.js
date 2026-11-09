/**
 * scripts/addVersion3.js
 *
 * Adds Version 3 — "Optimized" to the existing algorithm.
 *
 * Problems fixed vs v1/v2:
 *   1. hardStopLossPct 10 → 18  (stop was too tight, May crash wiped all gains)
 *   2. maxDrawdownCircuitBreaker 18 → 25 (pause threshold too aggressive)
 *   3. atrStepMultiplier 1.5 → 2.0 (wider step = higher sell targets = better margin)
 *   4. rebuyLevels depths deeper (R1=1.5x, R2=3x, R3=5x) → rebuys at better prices
 *   5. maxActiveTickets 5 → 3 (fewer open tickets = less capital tied up in rebuy ladders)
 *   6. corePositionPct 70 → 60 (more available qty to trade per cycle)
 *   7. tradingQtyPerStep 10 → 15 (larger trades to increase realized PnL per cycle)
 *
 * Run: node scripts/addVersion3.js
 */

'use strict';

const Algorithm = require('../src/models/algorithm');
const { runBacktest } = require('../src/backtestEngine');
const { loadCandles, getSummary } = require('../src/dataManager');

const ALGO_CODE = 'asymmetric-multilevel-v1';

async function main() {
  const doc = Algorithm.findAlgorithm(ALGO_CODE);
  if (!doc) {
    console.error(`❌ Algorithm '${ALGO_CODE}' not found. Run: npm run seed first.`);
    process.exit(1);
  }

  console.log(`\n🔧 Adding Version 3 to: ${ALGO_CODE}`);
  console.log(`   Current version: ${doc.currentVersion}`);

  // ── Check v3 doesn't already exist ──
  if (doc.versions.find(v => v.version === 3)) {
    console.log('   ⚠️  Version 3 already exists — removing and re-creating...');
    // Remove v3 from versions array and reset currentVersion
    doc.versions = doc.versions.filter(v => v.version !== 3);
    doc.currentVersion = 2;
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(
      path.join(process.cwd(), 'data', 'algorithms', `${ALGO_CODE}.json`),
      JSON.stringify(doc, null, 2)
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  VERSION 3 — Optimized
  // ══════════════════════════════════════════════════════════════════════

  const v3 = Algorithm.addVersion(ALGO_CODE, {
    tag: 'v3.0-optimized',
    notes: [
      'Optimized based on v1 backtest failure analysis:',
      '  • hardStopLossPct: 10 → 18  (stop triggered too early in May crash)',
      '  • maxDrawdownCircuitBreaker: 18 → 25 (was pausing too aggressively)',
      '  • atrStepMultiplier: 1.5 → 2.0 (wider sell margin per cycle)',
      '  • rebuyLevels: deeper ladder (1.5x / 3x / 5x vs 1x / 2x / 3.5x)',
      '  • maxActiveTickets: 5 → 3 (avoid too many stale open tickets)',
      '  • corePositionPct: 70 → 60 (free up more tradeable qty)',
      '  • tradingQtyPerStep: 10 → 15 (larger lot per cycle = more PnL per trade)',
    ].join('\n'),

    indicators: [
      { type: 'ATR',   params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA',   source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA',   source: 'close', params: { period: 200 }, name: 'EMA200' },
      { type: 'RSI',   source: 'close', params: { period: 14  }, name: 'RSI14'  },
      { type: 'CLOSE', name: 'CLOSE' },
    ],

    riskConfig: {
      stopLossPercent: 18,
      maxConcurrentPositions: 3,
      requireExitCondition: false,
      intradaySquareOffTime: '15:10',
    },

    gridConfig: {
      // ── Step sizing ──────────────────────────────────
      stepMode: 'ATR',
      atrPeriod: 14,
      atrStepMultiplier: 2.0,       // was 1.5 → wider sell margin
      minStepPct: 1.0,              // was 0.8 → floor slightly higher
      maxStepPct: 8.0,

      // ── Position sizing ──────────────────────────────
      tradingQtyPerStep: 15,        // was 10 → larger trade = more realized PnL
      corePositionPct: 60,          // was 70 → more tradeable qty
      minLotSize: 5,
      maxActiveTickets: 3,          // was 5 → fewer open ladders at a time

      // ── Rebuy ladder ─────────────────────────────────
      allocationMode: 'ATR_ADAPTIVE',
      maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.5, qtyPct: 35 },  // was 1.0
        { levelName: 'R2', depthMultiplier: 3.0, qtyPct: 35 },  // was 2.0
        { levelName: 'R3', depthMultiplier: 5.0, qtyPct: 30 },  // was 3.5
      ],
      maxTicketAgeDays: 45,         // was 30 → more time for rebuys to fill

      // ── Trend filter ─────────────────────────────────
      trendFilterEnabled: true,     // keep EMA gate from v2
      trendEmaFastPeriod: 50,
      trendEmaSlowPeriod: 200,

      // ── Circuit breakers ─────────────────────────────
      maxDrawdownCircuitBreaker: 25, // was 18 → less aggressive pause
      maxDailyCycles: 6,             // was 8 → slightly fewer cycles/day
      sessionCutoffTime: '15:10',

      // ── Hard stop ────────────────────────────────────
      hardStopLossPct: 18.0,         // was 10 → KEY FIX: stop was too tight
    },

    expectedResults: [
      {
        description: 'Full dataset (Feb–Sep 2026). Optimized: expect positive PnL, deeper rebuys should survive May crash.',
        dataFile: 'CEINSYS_INE016Q01014_1minute',
        metrics: {
          totalPnl:        { expected: 5000,  tolerance: 15000, operator: 'approx' },
          maxDrawdownPct:  { expected: 15,    tolerance: 10,    operator: 'lte'    },
          winRatePct:      { expected: 70,    tolerance: 30,    operator: 'approx' },
          totalTrades:     { expected: 30,    tolerance: 40,    operator: 'approx' },
          sharpeRatio:     { expected: 2.0,   tolerance: 3.0,   operator: 'approx' },
        },
      },
    ],
  });

  console.log(`   ✅ Version 3 created: ${v3.tag}`);

  // ── Load real candles ──
  let candles;
  try {
    candles = loadCandles();
    if (!candles || candles.length === 0) throw new Error('No candles');
    const summary = getSummary();
    console.log(`\n📈 Loaded ${candles.length} candles`);
    console.log(`   From: ${candles[0][0]}`);
    console.log(`   To:   ${candles[candles.length - 1][0]}`);
  } catch (err) {
    console.warn('\n⚠️  Could not load data:', err.message);
    process.exit(0);
  }

  // ── Run v3 backtest ──
  console.log('\n▶  Running backtest — v3.0-optimized...');
  const result = runBacktest({
    candles,
    gridConfig: v3.gridConfig,
    initialQty: 100,
    initialPrice: candles[0][4],
    capitalPerShare: 1,
    dataFile: 'CEINSYS_INE016Q01014_1minute',
    notes: 'Version 3 optimized run',
  });

  Algorithm.attachBacktestResult(ALGO_CODE, 3, result);

  // ── Print results ──
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│              VERSION COMPARISON                         │');
  console.log('├──────────────────┬──────────────┬──────────────┬────────┤');
  console.log('│ Metric           │ v1 (baseline)│ v2 (trend)   │ v3 ✨  │');
  console.log('├──────────────────┼──────────────┼──────────────┼────────┤');

  const v1r = Algorithm.getLatestBacktestResult(ALGO_CODE, 1);
  const v2r = Algorithm.getLatestBacktestResult(ALGO_CODE, 2);
  const v3r = result;

  function fmt(val, prefix = '', suffix = '') {
    if (val === null || val === undefined) return '  N/A   ';
    return `${prefix}${Number(val).toFixed(2)}${suffix}`.padStart(12);
  }

  console.log(`│ Total PnL (₹)    │${fmt(v1r?.totalPnl)} │${fmt(v2r?.totalPnl)} │${fmt(v3r.totalPnl)} │`);
  console.log(`│ PnL %            │${fmt(v1r?.totalPnlPct, '', '%')} │${fmt(v2r?.totalPnlPct, '', '%')} │${fmt(v3r.totalPnlPct, '', '%')} │`);
  console.log(`│ Total Trades     │${fmt(v1r?.totalTrades)} │${fmt(v2r?.totalTrades)} │${fmt(v3r.totalTrades)} │`);
  console.log(`│ Win Rate %       │${fmt(v1r?.winRatePct, '', '%')} │${fmt(v2r?.winRatePct, '', '%')} │${fmt(v3r.winRatePct, '', '%')} │`);
  console.log(`│ Max Drawdown %   │${fmt(v1r?.maxDrawdownPct, '', '%')} │${fmt(v2r?.maxDrawdownPct, '', '%')} │${fmt(v3r.maxDrawdownPct, '', '%')} │`);
  console.log(`│ Sharpe Ratio     │${fmt(v1r?.sharpeRatio)} │${fmt(v2r?.sharpeRatio)} │${fmt(v3r.sharpeRatio)} │`);
  console.log(`│ Sells / Rebuys   │  ${v1r?.totalSells}/${v1r?.totalRebuys}       │  ${v2r?.totalSells}/${v2r?.totalRebuys}       │  ${v3r.totalSells}/${v3r.totalRebuys}    │`);
  console.log('└──────────────────┴──────────────┴──────────────┴────────┘');

  // ── Expected vs Actual for v3 ──
  console.log('\n📊 Expected vs Actual (v3):');
  const report = Algorithm.compareExpectedVsActual(ALGO_CODE, 3);
  for (const c of report.comparisons) {
    const icon = c.result === 'PASS' ? '✅' : '❌';
    console.log(`   ${icon} ${c.metric.padEnd(18)} expected=${String(c.expected).padEnd(8)} actual=${String(c.actual).padEnd(10)} → ${c.result}`);
  }
  console.log(`\n   Overall: ${report.overallResult}`);

  // ── Trade log summary ──
  console.log('\n📋 v3 Trade Log:');
  for (const t of v3r.tradeLog) {
    if (t.action === 'SELL') {
      console.log(`   SELL  ${t.timestamp?.slice(0, 16)} @ ₹${t.price}  qty=${t.qty}  ${t.reason}`);
    } else if (t.action === 'BUY') {
      console.log(`     ↳ BUY  ${t.timestamp?.slice(0, 16)} @ ₹${t.price}  ${t.level}  profit=₹${t.profit}`);
    } else {
      console.log(`   [${t.action}] ${t.timestamp?.slice(0, 16)} ${t.reason || ''}`);
    }
  }

  console.log(`\n✅ Done! Algorithm file updated: data/algorithms/${ALGO_CODE}.json`);
  console.log('   Run tests: npm test\n');
}

main().catch(console.error);
