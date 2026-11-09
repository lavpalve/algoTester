/**
 * scripts/seedAlgorithm.js
 *
 * Seeds the "Asymmetric Multi-Level Grid v1" algorithm with:
 *   - Version 1: Baseline ATR-adaptive grid (no trend filter)
 *   - Version 2: Trend-filtered grid (EMA50 > EMA200 required)
 *   - Expected results for each version
 *
 * Run:  node scripts/seedAlgorithm.js
 */

'use strict';

const Algorithm = require('../src/models/algorithm');
const { runBacktest } = require('../src/backtestEngine');
const { loadCandles, filterCandles, getSummary } = require('../src/dataManager');

const ALGO_CODE = 'asymmetric-multilevel-v1';

async function main() {
  console.log('\n🌱 Seeding algorithm:', ALGO_CODE);

  // ── Clean up existing (for re-seeding) ──
  try {
    Algorithm.deleteAlgorithm(ALGO_CODE);
    console.log('  ↳ Removed existing file (fresh seed)');
  } catch {}

  // ══════════════════════════════════════════════════════════════════════
  //  VERSION 1 — Baseline: ATR-adaptive, no trend filter
  // ══════════════════════════════════════════════════════════════════════

  const doc = Algorithm.createAlgorithm({
    algorithmCode: ALGO_CODE,
    name: 'Asymmetric Multi-Level Grid',
    description: `
      Asymmetric multi-level grid strategy.
      Sells in small lots at step% above buy price.
      Creates tiered rebuy ladders at R1/R2/R3 below the sell price.
      Step size adapts to ATR volatility.
      Protects a core floor of holdings to avoid full exit.
    `.trim(),
    initialVersion: {
      tag: 'v1.0-atr-adaptive',
      notes: 'Baseline: ATR-adaptive step, no trend filter, fixed allocation',

      indicators: [
        { type: 'ATR',  params: { period: 14 }, name: 'ATR14' },
        { type: 'EMA',  source: 'close', params: { period: 50 },  name: 'EMA50'  },
        { type: 'EMA',  source: 'close', params: { period: 200 }, name: 'EMA200' },
        { type: 'CLOSE', name: 'CLOSE' },
      ],

      // Entry/exit conditions (used in future condition-evaluator; not yet live in backtest engine)
      entry: {
        logic: 'OR',
        groups: [
          {
            logic: 'AND',
            conditions: [
              { left: 'CLOSE', operator: 'pct_above', right: { indicator: 'ATR14', factor: 1.5 } },
            ],
          },
        ],
      },
      exit: {
        logic: 'OR',
        groups: [
          { logic: 'AND', conditions: [{ left: 'unrealizedPct', operator: '>=', right: 1.5 }] },
        ],
      },

      riskConfig: {
        stopLossPercent: 15,
        maxConcurrentPositions: 5,
        requireExitCondition: false,
        intradaySquareOffTime: '15:20',
      },

      gridConfig: {
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
      },

      // ── Manual expected results (set BEFORE running backtest) ──
      expectedResults: [
        {
          description: 'Full dataset (Feb–Sep 2026), CEINSYS 1-minute. Expect modest profit in range-bound market.',
          dataFile: 'CEINSYS_INE016Q01014_1minute',
          metrics: {
            totalPnl:        { expected: 5000,  tolerance: 25000, operator: 'approx' },
            maxDrawdownPct:  { expected: 8,     tolerance: 10,    operator: 'lte'    },
            winRatePct:      { expected: 65,    tolerance: 25,    operator: 'approx' },
            totalTrades:     { expected: 20,    tolerance: 40,    operator: 'approx' },
            sharpeRatio:     { expected: 1.0,   tolerance: 2.0,   operator: 'approx' },
          },
        },
      ],
    },
  });

  console.log('  ✅ Version 1 created:', doc.versions[0].tag);

  // ══════════════════════════════════════════════════════════════════════
  //  VERSION 2 — Trend filter: EMA50 > EMA200 gating
  // ══════════════════════════════════════════════════════════════════════

  const v2 = Algorithm.addVersion(ALGO_CODE, {
    tag: 'v2.0-trend-gated',
    notes: 'Added EMA50 > EMA200 trend filter to suppress sells in downtrends',

    indicators: [
      { type: 'ATR',  params: { period: 14 }, name: 'ATR14' },
      { type: 'EMA',  source: 'close', params: { period: 50 },  name: 'EMA50'  },
      { type: 'EMA',  source: 'close', params: { period: 200 }, name: 'EMA200' },
      { type: 'CLOSE', name: 'CLOSE' },
    ],

    riskConfig: {
      stopLossPercent: 15,
      maxConcurrentPositions: 5,
      requireExitCondition: false,
      intradaySquareOffTime: '15:20',
    },

    gridConfig: {
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
      trendFilterEnabled: true,         // KEY CHANGE from v1
      trendEmaFastPeriod: 50,
      trendEmaSlowPeriod: 200,
      maxDrawdownCircuitBreaker: 18,
      maxDailyCycles: 8,
      sessionCutoffTime: '15:10',
      hardStopLossPct: 10.0,
    },

    expectedResults: [
      {
        description: 'Full dataset (Feb–Sep 2026), CEINSYS 1-minute. Trend filter reduces overtrading.',
        dataFile: 'CEINSYS_INE016Q01014_1minute',
        metrics: {
          totalPnl:        { expected: 8000,  tolerance: 25000, operator: 'approx' },
          maxDrawdownPct:  { expected: 6,     tolerance: 8,     operator: 'lte'    },
          winRatePct:      { expected: 70,    tolerance: 20,    operator: 'approx' },
          totalTrades:     { expected: 15,    tolerance: 30,    operator: 'approx' },
          sharpeRatio:     { expected: 1.5,   tolerance: 2.0,   operator: 'approx' },
        },
      },
    ],
  });

  console.log('  ✅ Version 2 created:', v2.tag);

  // ══════════════════════════════════════════════════════════════════════
  //  RUN BACKTESTS (both versions against full dataset)
  // ══════════════════════════════════════════════════════════════════════

  let candles;
  try {
    candles = loadCandles();
    const summary = getSummary();
    if (!candles || candles.length === 0) throw new Error('No candles loaded');
    console.log(`\n📈 Loaded ${candles.length} candles`);
    console.log(`   From: ${summary.from}`);
    console.log(`   To:   ${summary.to}`);
  } catch (err) {
    console.warn('\n⚠️  Could not load real data:', err.message);
    console.warn('   Skipping live backtest. Run: npm run append <dataFile> to add data first.');
    printSummary(doc.algorithmCode);
    return;
  }

  for (const versionNum of [1, 2]) {
    const ver = Algorithm.getVersion(ALGO_CODE, versionNum);
    console.log(`\n▶  Running backtest — ${ver.tag}...`);

    try {
      const result = runBacktest({
        candles,
        gridConfig: ver.gridConfig,
        initialQty: 100,
        initialPrice: candles[0][4], // first close price as entry
        capitalPerShare: 1,
        dataFile: 'CEINSYS_INE016Q01014_1minute',
        notes: `Seed run — ${ver.tag}`,
      });

      Algorithm.attachBacktestResult(ALGO_CODE, versionNum, result);

      console.log(`   ✅ ${ver.tag} result attached`);
      console.log(`      PnL:        ₹${result.totalPnl} (${result.totalPnlPct}%)`);
      console.log(`      Trades:     ${result.totalTrades} | Win Rate: ${result.winRatePct}%`);
      console.log(`      Max DD:     ${result.maxDrawdownPct}%`);
      console.log(`      Sharpe:     ${result.sharpeRatio}`);
      console.log(`      Sells/Rebuys: ${result.totalSells}/${result.totalRebuys}`);
    } catch (err) {
      console.error(`   ❌ Backtest failed for ${ver.tag}:`, err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  COMPARE EXPECTED vs ACTUAL
  // ══════════════════════════════════════════════════════════════════════

  console.log('\n📊 Comparing expected vs actual...');
  for (const versionNum of [1, 2]) {
    const report = Algorithm.compareExpectedVsActual(ALGO_CODE, versionNum);
    console.log(`\n  Version ${versionNum} (${Algorithm.getVersion(ALGO_CODE, versionNum).tag}):`);
    console.log(`  Overall: ${report.overallResult || report.error}`);
    if (report.comparisons) {
      for (const c of report.comparisons) {
        const icon = c.result === 'PASS' ? '✅' : c.result === 'FAIL' ? '❌' : '⚪';
        console.log(`    ${icon} ${c.metric}: expected=${c.expected} actual=${c.actual} → ${c.result}`);
      }
    }
  }

  printSummary(ALGO_CODE);
}

function printSummary(code) {
  console.log('\n─────────────────────────────────────────────────────');
  console.log(`✅ Algorithm '${code}' seeded successfully!`);
  console.log('   data/algorithms/' + code + '.json');
  console.log('   Run backtest: node scripts/seedAlgorithm.js');
  console.log('   Run tests:    npm test');
  console.log('─────────────────────────────────────────────────────\n');
}

main().catch(console.error);
