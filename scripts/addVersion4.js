/**
 * scripts/addVersion4.js
 *
 * Version 4 — "Bucket Guard"
 *
 * NEW RULE: maxConsecutiveBuysWithoutSell = 3
 *   If the last 3 trade log entries are all BUYs (rebuys) with no new SELL
 *   in between, block any further rebuy fills.
 *   This prevents the engine from accumulating more position in a falling
 *   market where sells are not happening.
 *
 * Run: node scripts/addVersion4.js
 *  or: npm run v4
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

  console.log(`\n🔧 Adding Version 4 (Bucket Guard) to: ${ALGO_CODE}`);
  console.log(`   Current version: ${doc.currentVersion}`);

  // ── Remove v4 if it already exists (for re-runs) ──
  if (doc.versions.find(v => v.version === 4)) {
    console.log('   ⚠️  Version 4 exists — removing and re-creating...');
    const fs = require('fs');
    const path = require('path');
    const d = Algorithm.findAlgorithm(ALGO_CODE);
    d.versions = d.versions.filter(v => v.version !== 4);
    d.currentVersion = 3;
    fs.writeFileSync(
      path.join(process.cwd(), 'data', 'algorithms', `${ALGO_CODE}.json`),
      JSON.stringify(d, null, 2)
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  VERSION 4 — Bucket Guard
  // ══════════════════════════════════════════════════════════════════════

  const v4 = Algorithm.addVersion(ALGO_CODE, {
    tag: 'v4.0-bucket-guard',
    notes: [
      'New rule: maxConsecutiveBuysWithoutSell = 3',
      '  If the last 3 completed trades in the log are all BUYs (rebuys)',
      '  and no new SELL has happened since, block further rebuy fills.',
      '  This prevents accumulating more long exposure in a falling market',
      '  where the strategy is unable to sell (price not reaching sell targets).',
      '',
      'Other params: same as v1 baseline (ATR-adaptive, no trend filter)',
      '  so we can isolate the effect of the bucket guard alone.',
    ].join('\n'),

    indicators: [
      { type: 'ATR',   params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA',   source: 'close', params: { period: 50  }, name: 'EMA50'  },
      { type: 'EMA',   source: 'close', params: { period: 200 }, name: 'EMA200' },
      { type: 'CLOSE', name: 'CLOSE' },
    ],

    riskConfig: {
      stopLossPercent: 15,
      maxConcurrentPositions: 5,
      requireExitCondition: false,
      intradaySquareOffTime: '15:10',
    },

    gridConfig: {
      // ── Same as v1 baseline ───────────────────────────────────
      stepMode: 'ATR',
      atrPeriod: 14,
      atrStepMultiplier: 1.5,
      minStepPct: 0.8,
      maxStepPct: 8.0,
      tradingQtyPerStep: 10,
      corePositionPct: 70,
      minLotSize: 5,
      maxActiveTickets: 5,
      allocationMode: 'ATR_ADAPTIVE',
      maxRebuyLevels: 3,
      rebuyLevels: [
        { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 30 },
        { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 30 },
        { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 40 },
      ],
      maxTicketAgeDays: 30,
      trendFilterEnabled: false,
      trendEmaFastPeriod: 50,
      trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 18,
      maxDailyCycles: 8,
      sessionCutoffTime: '15:10',
      hardStopLossPct: 10.0,

      // ── NEW RULE ──────────────────────────────────────────────
      // Block new rebuy fills if the last N entries in the tradeLog
      // are all BUYs without a SELL in between.
      // Set to 0 to disable the rule entirely.
      maxConsecutiveBuysWithoutSell: 3,
    },

    expectedResults: [
      {
        description: [
          'Full dataset (Feb–Sep 2026). Bucket guard should reduce overall exposure',
          'when the stock is in a falling phase. Expect fewer trades but better drawdown.',
        ].join(' '),
        dataFile: 'CEINSYS_INE016Q01014_1minute',
        metrics: {
          totalPnl:        { expected: -5000, tolerance: 15000, operator: 'approx' },
          maxDrawdownPct:  { expected: 12,    tolerance: 10,    operator: 'lte'    },
          winRatePct:      { expected: 100,   tolerance: 10,    operator: 'approx' },
          totalTrades:     { expected: 15,    tolerance: 20,    operator: 'approx' },
        },
      },
    ],
  });

  console.log(`   ✅ Version 4 created: ${v4.tag}`);
  console.log(`   Rule: maxConsecutiveBuysWithoutSell = ${v4.gridConfig.maxConsecutiveBuysWithoutSell}`);

  // ── Load candles ──
  let candles;
  try {
    candles = loadCandles();
    if (!candles || candles.length === 0) throw new Error('No candles');
    console.log(`\n📈 Loaded ${candles.length} candles`);
    console.log(`   From: ${candles[0][0]}`);
    console.log(`   To:   ${candles[candles.length - 1][0]}`);
  } catch (err) {
    console.warn('\n⚠️  Could not load data:', err.message);
    process.exit(0);
  }

  // ── Run v4 backtest ──
  console.log('\n▶  Running backtest — v4.0-bucket-guard...');
  const result = runBacktest({
    candles,
    gridConfig: v4.gridConfig,
    initialQty: 100,
    initialPrice: candles[0][4],
    capitalPerShare: 1,
    dataFile: 'CEINSYS_INE016Q01014_1minute',
    notes: 'Version 4 — bucket guard (max 3 consecutive buys)',
  });

  Algorithm.attachBacktestResult(ALGO_CODE, 4, result);

  // ── Print blocked events ──
  const blocked = result.tradeLog.filter(t => t.action === 'REBUY_BLOCKED');
  console.log(`\n🛑 Bucket Guard fired ${blocked.length} times:`);
  for (const b of blocked) {
    console.log(`   ${b.timestamp?.slice(0, 16)}  ltp=₹${b.ltp}  ${b.reason}`);
  }

  // ── Full comparison table ──
  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                    VERSION COMPARISON                               │');
  console.log('├──────────────────┬──────────────┬──────────────┬─────────┬─────────┤');
  console.log('│ Metric           │ v1 (baseline)│ v2 (trend)   │ v3 opt  │ v4 🪣   │');
  console.log('├──────────────────┼──────────────┼──────────────┼─────────┼─────────┤');

  const v1r = Algorithm.getLatestBacktestResult(ALGO_CODE, 1);
  const v2r = Algorithm.getLatestBacktestResult(ALGO_CODE, 2);
  const v3r = Algorithm.getLatestBacktestResult(ALGO_CODE, 3);
  const v4r = result;

  function p(val, sfx = '') {
    if (val === null || val === undefined) return '    N/A  ';
    return `${Number(val).toFixed(2)}${sfx}`.padStart(9);
  }

  console.log(`│ Total PnL (₹)    │${p(v1r?.totalPnl)} │${p(v2r?.totalPnl)} │${p(v3r?.totalPnl)} │${p(v4r.totalPnl)} │`);
  console.log(`│ PnL %            │${p(v1r?.totalPnlPct, '%')} │${p(v2r?.totalPnlPct, '%')} │${p(v3r?.totalPnlPct, '%')} │${p(v4r.totalPnlPct, '%')} │`);
  console.log(`│ Trades (rebuys)  │${p(v1r?.totalTrades)} │${p(v2r?.totalTrades)} │${p(v3r?.totalTrades)} │${p(v4r.totalTrades)} │`);
  console.log(`│ Win Rate %       │${p(v1r?.winRatePct, '%')} │${p(v2r?.winRatePct, '%')} │${p(v3r?.winRatePct, '%')} │${p(v4r.winRatePct, '%')} │`);
  console.log(`│ Max Drawdown %   │${p(v1r?.maxDrawdownPct, '%')} │${p(v2r?.maxDrawdownPct, '%')} │${p(v3r?.maxDrawdownPct, '%')} │${p(v4r.maxDrawdownPct, '%')} │`);
  console.log(`│ Sharpe           │${p(v1r?.sharpeRatio)} │${p(v2r?.sharpeRatio)} │${p(v3r?.sharpeRatio)} │${p(v4r.sharpeRatio)} │`);
  console.log(`│ Sells / Rebuys   │  ${v1r?.totalSells}/${v1r?.totalRebuys}     │  ${v2r?.totalSells}/${v2r?.totalRebuys}     │  ${v3r?.totalSells}/${v3r?.totalRebuys}   │  ${v4r.totalSells}/${v4r.totalRebuys}   │`);
  console.log(`│ Blocked events   │     N/A     │     N/A     │    N/A  │${p(blocked.length)} │`);
  console.log('└──────────────────┴──────────────┴──────────────┴─────────┴─────────┘');

  // ── Expected vs Actual ──
  console.log('\n📊 Expected vs Actual (v4):');
  const report = Algorithm.compareExpectedVsActual(ALGO_CODE, 4);
  for (const c of report.comparisons) {
    const icon = c.result === 'PASS' ? '✅' : '❌';
    console.log(`   ${icon} ${c.metric.padEnd(20)} expected=${String(c.expected).padEnd(8)} actual=${String(c.actual).padEnd(10)} → ${c.result}`);
  }
  console.log(`\n   Overall: ${report.overallResult}`);

  // ── Trade log ──
  console.log('\n📋 v4 Trade Log:');
  for (const t of v4r.tradeLog) {
    if (t.action === 'SELL') {
      console.log(`   SELL  ${t.timestamp?.slice(0, 16)} @ ₹${t.price}  qty=${t.qty}  step=${t.stepPct}%`);
    } else if (t.action === 'BUY') {
      console.log(`     ↳ BUY   ${t.timestamp?.slice(0, 16)} @ ₹${t.price}  ${t.level}  profit=₹${t.profit}`);
    } else if (t.action === 'REBUY_BLOCKED') {
      console.log(`     🛑 BLOCKED ${t.timestamp?.slice(0, 16)} @ ₹${t.ltp}  (${t.consecutiveBuys} consec buys)`);
    } else if (t.action === 'CIRCUIT_BREAKER') {
      console.log(`   ⚡ CIRCUIT_BREAKER ${t.timestamp?.slice(0, 16)} unrealizedPct=${t.unrealizedPct}%`);
    } else if (t.reason === 'STOP_LOSS') {
      console.log(`   🔴 STOP_LOSS ${t.timestamp?.slice(0, 16)} @ ₹${t.price}  loss=₹${t.profit}`);
    }
  }

  console.log(`\n✅ Done! data/algorithms/${ALGO_CODE}.json updated (now has ${doc.currentVersion + 1} versions)`);
  console.log('   Run tests: npm test\n');
}

main().catch(console.error);
