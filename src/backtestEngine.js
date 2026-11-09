/**
 * Asymmetric Multi-Level Grid Strategy — Backtest Engine
 *
 * A complete file-based backtest simulation of the Grid strategy.
 * Replicates the production runGridStrategy() logic but:
 *   - Reads candles from CEINSYS_INE016Q01014_1minute.json (or any data file)
 *   - Simulates all state in memory (no DB)
 *   - Produces rich tradeLog, P&L metrics, and drawdown statistics
 *
 * Designed to be called by the Jest test suite or CLI.
 */

'use strict';

const crypto = require('crypto');
const { normalise } = require('./indicators');
const { EMA, ATR } = require('technicalindicators');

// ─── IST Helpers (matches production) ────────────────────────────────────────

function getISTDateString(isoTimestamp) {
  try {
    const date = new Date(isoTimestamp);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
  } catch {
    return isoTimestamp.slice(0, 10);
  }
}

function getISTTime(isoTimestamp) {
  try {
    const date = new Date(isoTimestamp);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const h = parts.find(p => p.type === 'hour')?.value || '00';
    const mn = parts.find(p => p.type === 'minute')?.value || '00';
    return `${h.padStart(2, '0')}:${mn.padStart(2, '0')}`;
  } catch {
    return '00:00';
  }
}

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

// ─── Volatility Regime Weights ────────────────────────────────────────────────
const VOL_REGIMES = [
  { maxAtrPct: 1.0, weights: [50, 30, 20] },
  { maxAtrPct: 2.0, weights: [40, 30, 30] },
  { maxAtrPct: 3.0, weights: [30, 30, 40] },
  { maxAtrPct: 5.0, weights: [20, 30, 50] },
  { maxAtrPct: Infinity, weights: [10, 30, 60] },
];

// ─── Config Normalizer ────────────────────────────────────────────────────────
/**
 * Normalize a gridConfig object — supports BOTH formats:
 *   1. Legacy flat format: { rebuyLevels, allocationMode, stepMode, tradingQtyPerStep, ... }
 *   2. New nested format:  { step: {...}, position: {...}, rebuyLadder: {...}, ticketExpiry: {...} }
 *
 * Always returns the flat format that the engine reads internally.
 * This means you can pass either format from scripts or tests without changes.
 */
function resolveConfig(cfg) {
  if (!cfg) return {};
  // If already flat (has direct rebuyLevels or stepMode), pass through
  if (cfg.rebuyLevels || cfg.stepMode) return cfg;
  // Nested format — flatten
  const step   = cfg.step   || {};
  const pos    = cfg.position || {};
  const ladder = cfg.rebuyLadder || {};
  const expiry = cfg.ticketExpiry || {};
  return {
    // Step
    stepMode:            step.mode           || 'ATR',
    atrPeriod:           step.atrPeriod      || 14,
    atrStepMultiplier:   step.atrMultiplier  || 1.5,
    minStepPct:          step.minPct         || 0.8,
    maxStepPct:          step.maxPct         || 8.0,
    fixedStepPct:        step.fixedPct       || 3.0,
    // Position
    tradingQtyPerStep:   pos.tradingQtyPerStep  || 10,
    corePositionPct:     pos.corePositionPct    || 70,
    minLotSize:          pos.minLotSize         || 5,
    maxActiveTickets:    pos.maxActiveTickets   || 5,
    // Rebuy ladder
    allocationMode:      ladder.allocationMode  || 'ATR_ADAPTIVE',
    maxRebuyLevels:      ladder.maxLevels       || 3,
    rebuyLevels:         ladder.levels          || [
      { levelName: 'R1', depthMultiplier: 1.0, qtyPct: 30 },
      { levelName: 'R2', depthMultiplier: 2.0, qtyPct: 30 },
      { levelName: 'R3', depthMultiplier: 3.5, qtyPct: 40 },
    ],
    // Ticket expiry
    maxTicketAgeDays:    expiry.maxAgeDays      || 30,
    // Carry through any extra top-level keys (trendFilterEnabled, etc.)
    ...Object.fromEntries(
      Object.entries(cfg).filter(([k]) =>
        !['step', 'position', 'rebuyLadder', 'ticketExpiry'].includes(k)
      )
    ),
  };
}

// ─── Allocation ───────────────────────────────────────────────────────────────

function computeRebuyAllocation(soldQty, atrPct, allocationMode, rebuyLevelDefs) {
  let weights;
  if (allocationMode === 'ATR_ADAPTIVE') {
    const regime = VOL_REGIMES.find(r => atrPct < r.maxAtrPct) || VOL_REGIMES[VOL_REGIMES.length - 1];
    weights = regime.weights.slice(0, rebuyLevelDefs.length);
  } else {
    weights = rebuyLevelDefs.map(l => l.qtyPct);
  }
  const total = weights.reduce((s, w) => s + w, 0);
  const norm = weights.map(w => w / total * 100);
  const allocated = [];
  let remaining = soldQty;
  for (let i = 0; i < norm.length - 1; i++) {
    const qty = Math.max(1, Math.floor(soldQty * norm[i] / 100));
    allocated.push(qty);
    remaining -= qty;
  }
  allocated.push(Math.max(1, remaining));
  return allocated;
}

function buildRebuyLevels(sellPrice, stepPct, soldQty, atrPct, cfg) {
  const defs = (cfg.rebuyLevels || []).slice(0, cfg.maxRebuyLevels || 3);
  const allocation = computeRebuyAllocation(soldQty, atrPct, cfg.allocationMode || 'ATR_ADAPTIVE', defs);
  return defs.map((d, i) => ({
    levelName: d.levelName || `R${i + 1}`,
    depthPct: stepPct * (d.depthMultiplier || 1),
    triggerPrice: Number((sellPrice * (1 - stepPct * (d.depthMultiplier || 1) / 100)).toFixed(2)),
    allocatedQty: allocation[i],
    filledQty: 0,
    fillPrice: null,
    fillDate: null,
    status: 'PENDING',
  }));
}

function weightedAvgEntry(activeLots) {
  let cost = 0, qty = 0;
  for (const lot of activeLots) { cost += lot.entryPrice * lot.quantity; qty += lot.quantity; }
  return qty > 0 ? cost / qty : 0;
}

function consolidateLots(activeLots, minLotSize) {
  const small = activeLots.filter(l => l.quantity < minLotSize && l.source !== 'INITIAL');
  if (small.length < 2) return activeLots;
  let qty = 0, cost = 0;
  for (const l of small) { qty += l.quantity; cost += l.quantity * l.entryPrice; }
  if (qty < 2) return activeLots;
  const ids = new Set(small.map(l => l.lotId));
  const merged = activeLots.filter(l => !ids.has(l.lotId));
  merged.push({
    lotId: crypto.randomUUID(),
    quantity: qty,
    entryPrice: Number((cost / qty).toFixed(2)),
    entryDate: null,
    sellReferencePrice: Number((cost / qty).toFixed(2)),
    source: 'CONSOLIDATED',
    parentTicketId: null,
  });
  return merged;
}

/**
 * Count consecutive BUY trades at the tail of the log with no SELL in between.
 *
 * Example tradeLog tail:  SELL → BUY → BUY → BUY  → returns 3
 *                         SELL → BUY → SELL → BUY  → returns 1
 *                         BUY  → BUY                → returns 2
 *
 * Used to enforce maxConsecutiveBuysWithoutSell:
 *   If we've filled N rebuys in a row without a new sell cycle completing,
 *   the market is trending down and adding more positions is dangerous.
 *   Block new rebuy fills until a new SELL happens.
 */
function countConsecutiveBuys(tradeLog) {
  let count = 0;
  for (let i = tradeLog.length - 1; i >= 0; i--) {
    const action = tradeLog[i].action;
    if (action === 'BUY') {
      count++;
    } else if (action === 'SELL') {
      break; // stop at the last SELL
    }
    // CIRCUIT_BREAKER events are ignored — don't reset the count
  }
  return count;
}

// ─── Metrics Computation ──────────────────────────────────────────────────────

function computeMetrics(tradeLog, initialCapital, finalCapital) {
  // Categorise trade pairs
  const sells = tradeLog.filter(t => t.action === 'SELL' && t.reason !== 'STOP_LOSS' && t.reason !== 'CIRCUIT_BREAKER');
  const rebuys = tradeLog.filter(t => t.action === 'BUY');

  // P&L from each rebuy that has a sell reference
  const trades = [];
  for (const log of tradeLog) {
    if (log.action === 'BUY' && log.profit !== undefined) {
      trades.push({ pnl: log.profit, win: log.profit > 0 });
    }
  }

  const wins = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const totalPnl = finalCapital - initialCapital;
  const totalPnlPct = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;

  // Drawdown
  let peak = initialCapital;
  let maxDD = 0, maxDDAbs = 0;
  let runningCapital = initialCapital;
  for (const log of tradeLog) {
    runningCapital += (log.profit || 0);
    if (runningCapital > peak) peak = runningCapital;
    const dd = peak > 0 ? ((peak - runningCapital) / peak) * 100 : 0;
    const ddAbs = peak - runningCapital;
    if (dd > maxDD) maxDD = dd;
    if (ddAbs > maxDDAbs) maxDDAbs = ddAbs;
  }

  const avgTradePnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;

  // Simple Sharpe (returns / std deviation of daily P&L)
  let sharpe = 0;
  if (trades.length > 1) {
    const pnls = trades.map(t => t.pnl);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  const totalSellQty = sells.reduce((s, t) => s + (t.qty || 0), 0);
  const totalBuyQty  = rebuys.reduce((s, t) => s + (t.qty || 0), 0);

  return {
    totalPnl: Number(totalPnl.toFixed(2)),
    totalPnlPct: Number(totalPnlPct.toFixed(2)),
    totalTrades: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
    maxDrawdownPct: Number(maxDD.toFixed(2)),
    maxDrawdownAbs: Number(maxDDAbs.toFixed(2)),
    sharpeRatio: Number(sharpe.toFixed(4)),
    avgTradePnl: Number(avgTradePnl.toFixed(2)),
    totalSells: sells.length,
    totalRebuys: rebuys.length,
    totalSellQty,
    totalBuyQty,
    finalCapital: Number(finalCapital.toFixed(2)),
  };
}

// ─── Main Backtest Function ───────────────────────────────────────────────────

/**
 * Run a full backtest of the Asymmetric Multi-Level Grid strategy.
 *
 * @param {object} options
 * @param {Array}  options.candles         - Raw candle array (oldest first, array format)
 * @param {object} options.gridConfig      - Strategy configuration (from algorithm version)
 * @param {number} options.initialQty      - Starting position size (shares held)
 * @param {number} options.initialPrice    - Average entry price of initial holdings
 * @param {number} options.capitalPerShare - Notional value per share (for capital calc)
 * @param {string} [options.fromDate]      - ISO date string to start simulation (inclusive)
 * @param {string} [options.toDate]        - ISO date string to end simulation (inclusive)
 * @param {string} [options.dataFile]      - Dataset file name (for logging)
 * @param {string} [options.notes]         - Run notes
 * @returns {object} Backtest result ready for attachBacktestResult()
 */
function runBacktest(options) {
  const {
    candles: rawCandles,
    gridConfig: rawCfg,
    initialQty,
    initialPrice,
    capitalPerShare = 1,
    fromDate,
    toDate,
    dataFile = '',
    notes = '',
  } = options;

  // Normalize nested vs flat gridConfig — engine always uses flat internally
  const cfg = resolveConfig(rawCfg);

  if (!rawCandles || rawCandles.length === 0) {
    throw new Error('No candles provided for backtest');
  }

  // ── Sort chronologically (oldest first) ──
  let candles = [...rawCandles].sort((a, b) => {
    const ta = new Date(Array.isArray(a) ? a[0] : a.timestamp).getTime();
    const tb = new Date(Array.isArray(b) ? b[0] : b.timestamp).getTime();
    return ta - tb;
  });

  // ── Apply date range filter ──
  if (fromDate) {
    const from = new Date(fromDate).getTime();
    candles = candles.filter(c => new Date(Array.isArray(c) ? c[0] : c.timestamp).getTime() >= from);
  }
  if (toDate) {
    const to = new Date(toDate).getTime();
    candles = candles.filter(c => new Date(Array.isArray(c) ? c[0] : c.timestamp).getTime() <= to);
  }

  if (candles.length === 0) {
    throw new Error('No candles in date range for backtest');
  }

  const norm = candles.map(normalise);

  // ── Initial state ──
  const corePositionPct = cfg.corePositionPct || 70;
  const coreFloor = Math.floor(initialQty * corePositionPct / 100);

  let state = {
    totalHoldings: initialQty,
    coreFloor,
    activeLots: [{
      lotId: crypto.randomUUID(),
      quantity: initialQty,
      entryPrice: initialPrice,
      entryDate: norm[0].timestamp,
      sellReferencePrice: initialPrice,
      source: 'INITIAL',
      parentTicketId: null,
    }],
    rebuyTickets: [],
    dailyCycleCount: 0,
    dailyCycleResetDate: getISTDateString(norm[0].timestamp),
    totalCyclesCompleted: 0,
    totalRealizedPnl: 0,
    totalSellCount: 0,
    totalRebuyCount: 0,
    isPaused: false,
  };

  const initialCapital = initialQty * initialPrice * capitalPerShare;
  const tradeLog = [];
  const atrPeriod = cfg.atrPeriod || 14;
  const emaSlowPeriod = cfg.trendEmaSlowPeriod || 200;
  const emaFastPeriod = cfg.trendEmaFastPeriod || 50;
  const minLookback = Math.max(emaSlowPeriod, atrPeriod + 1);

  // ── Pre-compute all indicator series in one pass (O(n) not O(n²)) ──
  const closes  = norm.map(c => c.close);
  const highs   = norm.map(c => c.high);
  const lows    = norm.map(c => c.low);

  const atrSeries   = ATR.calculate({ period: atrPeriod, high: highs, low: lows, close: closes });
  const ema200Series = EMA.calculate({ period: emaSlowPeriod, values: closes });
  const ema50Series  = EMA.calculate({ period: emaFastPeriod, values: closes });

  // Map series values back to candle indices:
  //   technicalindicators returns arrays shorter than input by (period-1)
  //   atrSeries[j]    → candle index j + atrPeriod
  //   ema200Series[j] → candle index j + emaSlowPeriod - 1
  //   ema50Series[j]  → candle index j + emaFastPeriod - 1

  // ── Main loop ──
  for (let i = 1; i < norm.length; i++) {
    const current = norm[i];
    const ltp = current.close;
    const timestamp = current.timestamp;

    // Need enough data for indicators
    if (i < minLookback) continue;

    // ── Look up pre-computed indicator values by candle index ──
    const atrIdx   = i - atrPeriod;                 // ATR series offset
    const e200Idx  = i - (emaSlowPeriod - 1);       // EMA200 series offset
    const e50Idx   = i - (emaFastPeriod - 1);       // EMA50 series offset

    const atrValue = (atrIdx >= 0 && atrSeries[atrIdx] !== undefined)   ? atrSeries[atrIdx]   : 0;
    const ema200   = (e200Idx >= 0 && ema200Series[e200Idx] !== undefined) ? ema200Series[e200Idx] : null;
    const ema50    = (e50Idx >= 0 && ema50Series[e50Idx] !== undefined)   ? ema50Series[e50Idx]   : null;
    const atrPct   = ltp > 0 ? (atrValue / ltp) * 100 : 0;

    // ── Daily counter reset ──
    const todayIST = getISTDateString(timestamp);
    if (state.dailyCycleResetDate !== todayIST) {
      state.dailyCycleCount = 0;
      state.dailyCycleResetDate = todayIST;
    }

    // ── Circuit breaker: unrealized drawdown ──
    const avgEntry = weightedAvgEntry(state.activeLots);
    const unrealizedPct = avgEntry > 0 ? ((ltp - avgEntry) / avgEntry) * 100 : 0;

    if (unrealizedPct <= -(cfg.maxDrawdownCircuitBreaker || 18)) {
      for (const t of state.rebuyTickets) {
        if (t.status === 'ACTIVE') {
          t.levels.forEach(l => { if (l.status === 'PENDING') l.status = 'CANCELLED'; });
          t.status = 'CANCELLED';
        }
      }
      state.isPaused = true;
      tradeLog.push({
        action: 'CIRCUIT_BREAKER',
        timestamp,
        ltp,
        reason: 'Drawdown circuit breaker hit',
        unrealizedPct: Number(unrealizedPct.toFixed(2)),
      });
      continue;
    }

    // ── Session / daily cap ──
    const currentTime = getISTTime(timestamp);
    const pastCutoff = currentTime >= (cfg.sessionCutoffTime || '15:10');
    const dailyCapped = state.dailyCycleCount >= (cfg.maxDailyCycles || 8);

    // ── Trend filter ──
    let trendHealthy = true;
    if (cfg.trendFilterEnabled !== false) {
      trendHealthy = false;
      if (ema200 !== null && ltp > ema200) trendHealthy = true;
      if (ema50 !== null && ema200 !== null && ema50 > ema200) trendHealthy = true;
      if (ema200 === null || ema50 === null) trendHealthy = true;
    }
    state.isPaused = !trendHealthy;

    // ── Adaptive step ──
    let stepPct;
    if ((cfg.stepMode || 'ATR') === 'ATR' && atrValue > 0) {
      const raw = (atrValue * (cfg.atrStepMultiplier || 1.5)) / ltp * 100;
      stepPct = clamp(raw, cfg.minStepPct || 0.8, cfg.maxStepPct || 8.0);
    } else {
      stepPct = cfg.fixedStepPct || 3.0;
    }

    // ── STEP 5: Sell evaluation ──
    let soldThisTick = false;

    if (!pastCutoff && !dailyCapped && trendHealthy && !soldThisTick) {
      const tradingQtyPerStep = cfg.tradingQtyPerStep || 10;
      const maxActiveTickets = cfg.maxActiveTickets || 5;

      let pendingRebuyQty = 0;
      for (const t of state.rebuyTickets) {
        if (t.status === 'ACTIVE') {
          for (const l of t.levels) {
            if (l.status === 'PENDING') pendingRebuyQty += l.allocatedQty;
          }
        }
      }

      const activeTickets = state.rebuyTickets.filter(t => t.status === 'ACTIVE').length;
      const availableToSell = state.totalHoldings - state.coreFloor - pendingRebuyQty;

      if (availableToSell >= tradingQtyPerStep && activeTickets < maxActiveTickets) {
        const sellableLots = state.activeLots
          .filter(l => l.quantity >= tradingQtyPerStep)
          .sort((a, b) => a.sellReferencePrice - b.sellReferencePrice);

        for (const lot of sellableLots) {
          if (soldThisTick) break;
          const sellTarget = lot.sellReferencePrice * (1 + stepPct / 100);

          if (ltp >= sellTarget) {
            const sellQty = Math.min(tradingQtyPerStep, lot.quantity);
            const sellPrice = Number(ltp.toFixed(2));
            const ticketId = crypto.randomUUID();
            const levels = buildRebuyLevels(sellPrice, stepPct, sellQty, atrPct, cfg);

            lot.quantity -= sellQty;
            state.totalHoldings -= sellQty;
            if (lot.quantity <= 0) {
              state.activeLots = state.activeLots.filter(l => l.lotId !== lot.lotId);
            }

            const expiresAt = (() => {
              const d = new Date(timestamp);
              d.setDate(d.getDate() + (cfg.maxTicketAgeDays || 30));
              return d.toISOString();
            })();

            state.rebuyTickets.push({
              ticketId,
              sellPrice,
              sellDate: timestamp,
              soldQty: sellQty,
              sourceLotId: lot.lotId,
              levels,
              atrAtSell: Number(atrValue.toFixed(2)),
              atrPctAtSell: Number(atrPct.toFixed(2)),
              totalFilledQty: 0,
              grossProfit: 0,
              status: 'ACTIVE',
              expiresAt,
            });

            if (lot.quantity > 0) lot.sellReferencePrice = sellPrice;
            state.totalSellCount++;
            soldThisTick = true;

            tradeLog.push({
              action: 'SELL',
              timestamp,
              price: sellPrice,
              qty: sellQty,
              ticketId,
              stepPct: Number(stepPct.toFixed(2)),
              atr: Number(atrValue.toFixed(2)),
              holdings: state.totalHoldings,
              reason: 'GRID_SELL',
              levels: levels.map(l => `${l.levelName}=₹${l.triggerPrice}`).join(', '),
            });
          }
        }
      }
    }

    // ── STEP 6: Rebuy processing ──
    for (const ticket of state.rebuyTickets) {
      if (ticket.status !== 'ACTIVE') continue;

      if (ticket.expiresAt && new Date(timestamp) > new Date(ticket.expiresAt)) {
        ticket.levels.forEach(l => { if (l.status === 'PENDING') l.status = 'EXPIRED'; });
        ticket.status = 'EXPIRED';
        continue;
      }

      for (const level of ticket.levels) {
        if (level.status !== 'PENDING') continue;

        if (cfg.trendFilterEnabled !== false && !trendHealthy && level.levelName === 'R1') continue;

        // ── Consecutive-buy guard ─────────────────────────────────────────────
        // If we've had maxConsecutiveBuysWithoutSell BUYs in a row since the
        // last SELL, stop filling more rebuys until a new sell cycle opens.
        const maxConsecBuys = cfg.maxConsecutiveBuysWithoutSell ?? 3;
        if (maxConsecBuys > 0 && countConsecutiveBuys(tradeLog) >= maxConsecBuys) {
          // Log once per tick (only when first blocked)
          const alreadyLogged = tradeLog.some(
            t => t.action === 'REBUY_BLOCKED' && t.timestamp === timestamp
          );
          if (!alreadyLogged) {
            tradeLog.push({
              action: 'REBUY_BLOCKED',
              timestamp,
              ltp,
              consecutiveBuys: countConsecutiveBuys(tradeLog),
              reason: `Blocked: ${countConsecutiveBuys(tradeLog)} consecutive buys without a sell (limit=${maxConsecBuys})`,
            });
          }
          continue; // skip this level — wait for a new SELL
        }
        // ─────────────────────────────────────────────────────────────────────

        if (ltp <= level.triggerPrice) {
          const rebuyQty = level.allocatedQty;
          const rebuyPrice = Number(ltp.toFixed(2));
          const levelProfit = (ticket.sellPrice - rebuyPrice) * rebuyQty;

          level.status = 'FILLED';
          level.filledQty = rebuyQty;
          level.fillPrice = rebuyPrice;
          level.fillDate = timestamp;

          ticket.totalFilledQty += rebuyQty;
          ticket.grossProfit += levelProfit;

          const allFilled = ticket.levels.every(l => l.status !== 'PENDING');
          if (allFilled) ticket.status = 'EXHAUSTED';

          state.activeLots.push({
            lotId: crypto.randomUUID(),
            quantity: rebuyQty,
            entryPrice: rebuyPrice,
            entryDate: timestamp,
            sellReferencePrice: rebuyPrice,
            source: `REBUY_${level.levelName}`,
            parentTicketId: ticket.ticketId,
          });

          state.totalHoldings += rebuyQty;
          state.totalRebuyCount++;
          state.dailyCycleCount++;
          state.totalCyclesCompleted++;
          state.totalRealizedPnl += levelProfit;

          tradeLog.push({
            action: 'BUY',
            timestamp,
            price: rebuyPrice,
            qty: rebuyQty,
            level: level.levelName,
            ticketId: ticket.ticketId,
            soldAt: ticket.sellPrice,
            profit: Number(levelProfit.toFixed(2)),
            holdings: state.totalHoldings,
            reason: `GRID_REBUY_${level.levelName}`,
          });
        }
      }
    }

    // ── STEP 7: Consolidation ──
    state.activeLots = consolidateLots(state.activeLots, cfg.minLotSize || 5);

    // ── STEP 8: Hard stop-loss ──
    const totalPnlPct = avgEntry > 0 ? ((ltp - avgEntry) / avgEntry) * 100 : 0;
    if (totalPnlPct <= -(cfg.hardStopLossPct || 10.0) && state.totalHoldings > 0) {
      const exitQty = state.totalHoldings;
      const exitLoss = (ltp - avgEntry) * exitQty;
      state.totalRealizedPnl += exitLoss;

      // Cancel all pending tickets
      for (const t of state.rebuyTickets) {
        if (t.status === 'ACTIVE') {
          t.levels.forEach(l => { if (l.status === 'PENDING') l.status = 'CANCELLED'; });
          t.status = 'CANCELLED';
        }
      }

      tradeLog.push({
        action: 'SELL',
        timestamp,
        price: Number(ltp.toFixed(2)),
        qty: exitQty,
        profit: Number(exitLoss.toFixed(2)),
        holdings: 0,
        reason: 'STOP_LOSS',
      });

      state.totalHoldings = 0;
      state.activeLots = [];
      break; // Stop simulation
    }
  }

  // ── Final valuation ──
  const finalLtp = norm[norm.length - 1].close;
  const unrealizedPnl = state.activeLots.reduce(
    (sum, lot) => sum + (finalLtp - lot.entryPrice) * lot.quantity, 0
  );
  const finalCapital = initialCapital + state.totalRealizedPnl + unrealizedPnl;

  // ── Metrics ──
  const metrics = computeMetrics(tradeLog, initialCapital, finalCapital);

  return {
    runId: crypto.randomUUID(),
    dataFile,
    fromDate: norm[0].timestamp,
    toDate: norm[norm.length - 1].timestamp,
    totalCandles: norm.length,
    initialCapital: Number(initialCapital.toFixed(2)),
    finalCapital: metrics.finalCapital,
    realizedPnl: Number(state.totalRealizedPnl.toFixed(2)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    ...metrics,
    tradeLog,
    finalState: {
      totalHoldings: state.totalHoldings,
      coreFloor: state.coreFloor,
      activeLots: state.activeLots.length,
      openTickets: state.rebuyTickets.filter(t => t.status === 'ACTIVE').length,
      totalCyclesCompleted: state.totalCyclesCompleted,
      totalRealizedPnl: Number(state.totalRealizedPnl.toFixed(2)),
    },
    notes,
  };
}

module.exports = {
  runBacktest,
  computeMetrics,
};
