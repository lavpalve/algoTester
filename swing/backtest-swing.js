#!/usr/bin/env node
/**
 * backtest-swing.js — Swing Trading Backtest, Version 1.0 (frozen strategy specification, 7 Nov 2026)
 *
 * Long-only swing strategy research script:
 *   market gate → daily stock score (≥75, top-1 only) → ORB / VWAP-pullback intraday entry
 *   → ATR risk sizing → 2×ATR initial stop → +3% trailing stop.
 *
 * Standalone: Node.js built-ins only. Reads cached historical data from data/swing/
 * (populated by swing/fetch-swing-data.js), never touches the network, never touches
 * the existing platform. Writes a report folder with ledger, equity curve, diagnostics.
 *
 * Usage
 *   node swing/backtest-swing.js [--config overrides.json] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *                                [--out <dir>] [--quiet]
 *
 * Experiments: put overrides in a JSON file with a new strategy.experimentId (e.g. "V1.1-...").
 * The script refuses to run changed strategy parameters under the frozen "V1-baseline" id.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════════════════
// 1. FROZEN VERSION 1 CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const V1_CONFIG = {
  strategy: {
    name: 'Swing Trading V1',
    version: '1.0',
    experimentId: 'V1-baseline',
    specification: 'Swing Trading Backtest Plan v1.0 (frozen), 7 Nov 2026',
  },

  data: {
    dir: 'data/swing',
    // Daily candles: 'files' (Upstox cache in data/swing) or 'mongo' (stocks + index_candles_daily).
    // Intraday candles always come from the data/swing/intraday<N> cache.
    source: 'files',
    mongo: { uri: 'mongodb://localhost:27017', db: 'msvStorage', stocksCollection: 'stocks', indexCollection: 'index_candles_daily' },
    allowedSeries: ['EQ'],              // REIT units (RR) and trade-to-trade (BE) excluded
    excludeSymbols: ['DUMMYHEG'],       // placeholder row in the NSE list, not a tradable stock
    minHistorySessions: 120,            // EMA100 + slope warm-up before a stock can be scored
    globalMaxStaleCalendarDays: 5,      // older global sessions are treated as missing
    intradayIntervalMinutes: 5,         // base download interval; 15-minute bars are built from it
    volumeBaselineSessions: 20,         // same time-of-day volume baseline
    minBaselineSessions: 10,
    priceCrossCheckTolerancePct: 1.0,   // flag 5-min vs daily OHLC disagreement above this
  },

  period: {
    start: '2022-03-01',
    end: '2026-11-06',
    segments: [
      { name: 'development', from: '2022-03-01', to: '2024-06-30' },
      { name: 'validation', from: '2024-07-01', to: '2025-08-31' },
      { name: 'test', from: '2025-09-01', to: '2026-11-06' },
    ],
  },

  account: {
    initialEquity: 1000000,
    maxAllocationPct: 100,              // no leverage: one position ≤ current equity, all positions ≤ cash
    maxOpenPositions: 1,                // V1: one open position at a time
  },

  session: {
    timezone: 'Asia/Kolkata',
    normal: {
      preMarketOpen: '09:00', tradingStart: '09:15', tradeCutoff: '15:00', tradingEnd: '15:30',
      openingRangeMinutes: 15, allowNewEntries: true,
    },
    // Date-specific overrides. Times verified against the NIFTY 5-minute history.
    // Short sessions keep managing open positions but take no new entries (no time-of-day
    // volume baseline exists for these slots).
    specialSessions: {
      '2022-10-24': { label: 'Muhurat trading', preMarketOpen: '18:00', tradingStart: '18:15', tradeCutoff: '19:00', tradingEnd: '19:15', allowNewEntries: false },
      '2023-11-12': { label: 'Muhurat trading', preMarketOpen: '18:00', tradingStart: '18:15', tradeCutoff: '19:00', tradingEnd: '19:15', allowNewEntries: false },
      '2024-03-02': { label: 'Special live session (DR)', preMarketOpen: '09:00', tradingStart: '09:15', tradeCutoff: '12:00', tradingEnd: '12:30', allowNewEntries: false },
      '2024-05-18': { label: 'Special live session (DR)', preMarketOpen: '09:00', tradingStart: '09:15', tradeCutoff: '12:00', tradingEnd: '12:30', allowNewEntries: false },
      '2024-11-01': { label: 'Muhurat trading', preMarketOpen: '17:45', tradingStart: '18:00', tradeCutoff: '18:45', tradingEnd: '19:00', allowNewEntries: false },
      '2025-10-21': { label: 'Muhurat trading', preMarketOpen: '13:30', tradingStart: '13:45', tradeCutoff: '14:30', tradingEnd: '14:45', allowNewEntries: false },
    },
  },

  market: {
    weights: { nifty: 25, breadth: 15, bankNifty: 10, us: 10, asia: 7, giftNifty: 8, vix: 10, sector: 15 },
    domesticComponents: ['nifty', 'breadth', 'bankNifty', 'vix', 'sector'],
    requiredComponents: ['nifty', 'breadth', 'bankNifty', 'vix', 'sector'],
    bands: { favorable: 75, cautious: 60, research: 50 },
    riskPctByBand: { favorable: 1.0, cautious: 0.5, research: 0, blocked: 0 },
    research: { simulateShadowTrades: true, shadowRiskPct: 1.0 },
    dataQuality: {
      // Missing components are never scored as neutral. Their weight is removed, the run is
      // flagged, and the day is blocked when too much weight is missing.
      policy: 'reweight',
      maxMissingWeightPct: 15,
    },
    hardGates: {
      niftyMaxPctBelowEma50: 3,         // severe breakdown: close more than 3% below EMA50
      niftyMinDayReturnPct: -3,         // severe breakdown: prior session fell 3% or more
      minDomesticScore: 50,             // global strength cannot rescue a broken domestic market
      niftyMinRoc20Pct: null,           // optional: block when NIFTY's 20-session return is below this
    },
    indexTrend: { shortRocSessions: 5, mediumRocSessions: 20 },
    breadth: { highLowLookback: 250, directionLookback: 5 },
    vix: { calmLevel: 12, stressLevel: 25, directionLookback: 5 },
    sector: { minMembers: 3, leadingCount: 3, lookback: 20 },
    usIndices: ['SP500', 'NASDAQ'],
    asiaIndices: ['NIKKEI225', 'HANGSENG', 'KOSPI'],
    globalSessions: {
      SP500: { timezone: 'America/New_York', close: '16:00' },
      NASDAQ: { timezone: 'America/New_York', close: '16:00' },
      NIKKEI225: { timezone: 'Asia/Tokyo', close: '15:30' },
      HANGSENG: { timezone: 'Asia/Hong_Kong', close: '16:10' },
      KOSPI: { timezone: 'Asia/Seoul', close: '15:30' },
    },
    giftNifty: { file: 'market/giftnifty.json', fullScoreGapPct: 1.0 },
  },

  stockScore: {
    minScore: 75,
    weights: { trend: 25, relativeStrength: 25, momentum: 15, volume: 15, breakout: 20 },
    liquidity: { minPrice: 100, minAvgTradedValue: 5e7, lookback: 20 },   // ₹100, ₹5 crore
    requireOutperformNifty: true,       // §3.1: 20-session return should beat NIFTY
    requireBreakoutClose: false,        // §2.3: breakout scored (20 pts), not mandatory
    trend: { emaFast: 20, emaMid: 50, emaSlow: 100, fastSlopeSessions: 5, midSlopeSessions: 10, healthyDistanceAtr: 2.5, stretchedDistanceAtr: 4 },
    relativeStrength: { lookback: 20, fullScoreOutperformancePct: 10, persistenceWindows: 4, persistenceWindowSessions: 5 },
    momentum: { rsiPeriod: 14, rsiMin: 55, rsiMax: 72, rsiNearBand: 5, rocPeriod: 10, macd: [12, 26, 9] },
    volume: { turnoverTiers: [[5e8, 1], [2e8, 0.7], [1e8, 0.5], [5e7, 0.3]], relVolumeTiers: [[2.0, 1], [1.5, 0.75], [1.2, 0.5], [1.0, 0.25]], trendSessions: 5 },
  },

  breakout: {
    lookback: 20,
    minVolumeRatio: 1.5,
    minCloseStrength: 0.70,
    maxScoreExtensionAtr: 1.5,          // penalised in the score above this
    maxEntryExtensionAtr: 2.0,          // entry rejected above this (fill vs breakout level)
  },

  // Optional gate from Upstox yearly fundamentals (data/swing/fundamentals). Point in time: a
  // financial year counts only after periodEnd + annualLagDays (SEBI deadline for audited annual
  // results), so FY2024-vs-FY2023 growth first exists on 30 May 2024. Stocks without the needed
  // numbers on a date are excluded. ROE = net profit / (total assets − total liabilities).
  // mode 'scan'      : failing stocks are removed before ranking (the watchlist reaches deeper)
  // mode 'entryCheck': the normal top-N watchlist is built first; failing stocks on it are not bought
  // filter.combine   : 'all' = every set minimum must pass; 'any' = at least one set minimum passes
  fundamentals: {
    enabled: false,
    mode: 'scan',
    dir: 'fundamentals',
    annualLagDays: 60,
    filter: { requirePositiveProfit: true, minRevenueGrowthPct: null, minProfitGrowthPct: null, minRoePct: null, combine: 'all' },
  },

  // 'top1': only the highest-scoring stock ≥ minScore is watched (V1 spec, no fallback).
  // 'watchlist': every eligible stock ≥ minScore is watched; the earliest confirmed signal wins,
  //              same-bar ties go to the higher score. One position at a time either way.
  selection: { mode: 'top1', maxWatchlist: null },

  entry: {
    confirmationIntervalMinutes: 5,     // 5 or 15; bar-count parameters below are in these bars
    orb: { enabled: true, minRelVolume: 1.5, minCloseStrength: 0.60, requireAboveVwap: true },
    vwapPullback: {
      enabled: true,
      minCompletedBars: 3,
      minBarsAboveVwapPct: 60,
      vwapRisingLookbackBars: 3,
      tolerancePct: 0.25,
      maxPenetrationPct: 0.50,
      pullbackLookbackBars: 3,
      minCloseStrength: 0.60,
      minRelVolume: 1.0,
      requireImprovingVolume: true,
      requireRsVsNifty: true,
    },
  },

  risk: {
    atrPeriod: 14,
    stopAtrMultiple: 2,
    maxStopDistancePct: 8,
  },

  // Armed when the price reaches +activationPct; the stop then never sits below +minLockedProfitPct.
  // mode 'pct'      : stop = highest high × (1 − trailPct%)                        (V1 spec)
  // mode 'atr'      : stop = highest high − trailAtrMultiple × ATR(14) at entry
  // mode 'dailyLow' : no intraday trail; after a session closes below the lowest low of the
  //                   previous dailyLowLookback sessions, sell at the next session's open.
  trailing: { mode: 'pct', activationPct: 3, trailPct: 2, minLockedProfitPct: 1, trailAtrMultiple: null, dailyLowLookback: 3 },

  // Bars used for stop / trailing-stop management: 5 (V1 spec) or 1. Missing 1-minute days fall
  // back to 5-minute bars, then to the daily bar, and are flagged.
  management: { intervalMinutes: 5 },

  execution: {
    entrySlippagePct: 0.10,
    exitSlippagePct: 0.10,
    // Same-day round trips are charged at intraday rates, otherwise delivery rates.
  },

  costs: {
    model: 'Zerodha retail, NSE cash equity',
    brokerage: { deliveryPct: 0, intradayPct: 0.03, intradayMaxPerOrder: 20 },
    stt: { deliveryBuyPct: 0.1, deliverySellPct: 0.1, intradaySellPct: 0.025 },
    // NSE equity transaction charges by effective date (pre-2024 values approximate).
    exchangeTxnPct: [
      { from: '2000-01-01', pct: 0.00345 },
      { from: '2023-04-01', pct: 0.00325 },
      { from: '2024-04-01', pct: 0.00322 },
      { from: '2024-10-01', pct: 0.00297 },
      { from: '2026-03-01', pct: 0.00307 },
    ],
    sebiPerCrore: 10,
    gstPct: 18,
    stamp: { deliveryBuyPct: 0.015, intradayBuyPct: 0.003 },
    dpChargePerSellDay: 13.5,           // + GST, delivery sells only
  },

  notes: [
    'Market sector component = mean(candidate sector strength, top-3 leading sectors); leading sectors only when no candidate exists.',
    'Sector strength uses equal-weighted composites of NIFTY 500 constituents grouped by NSE industry, not official sector indices.',
    'Entries are considered only on sessions that start flat; a position closed intraday does not free capital for a same-day re-entry.',
    'Research-only band (50–59) trades are simulated in a separate shadow ledger that never changes equity.',
    'Intraday 5-min prices are rescaled to daily (split-adjusted, not dividend-adjusted) units using the prior session open/high/low ratio.',
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// 2. GENERAL UTILITIES
// ════════════════════════════════════════════════════════════════════════════

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const round = (x, d = 2) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const sum = arr => arr.reduce((a, b) => a + b, 0);
const mean = arr => (arr.length ? sum(arr) / arr.length : null);
const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const deepClone = o => JSON.parse(JSON.stringify(o));

function deepMerge(base, over) {
  if (Array.isArray(over) || over === null || typeof over !== 'object') return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

function stableStringify(o) {
  if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
  if (o && typeof o === 'object') return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  return JSON.stringify(o);
}
const hashOf = o => crypto.createHash('sha256').update(stableStringify(o)).digest('hex').slice(0, 12);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function calendarDaysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// ─── Time-zone helpers (Intl-based, DST-safe) ────────────────────────────────

const dtfCache = new Map();
const offsetCache = new Map();
function tzOffsetMs(epochMs, tz) {
  const key = `${tz}|${Math.floor(epochMs / 3600000)}`;
  let off = offsetCache.get(key);
  if (off !== undefined) return off;
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  const p = {};
  for (const part of f.formatToParts(new Date(epochMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  off = asUtc - Math.floor(epochMs / 1000) * 1000;
  offsetCache.set(key, off);
  return off;
}
function zoned(epochMs, tz) {
  const local = new Date(epochMs + tzOffsetMs(epochMs, tz));
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), min: local.getUTCHours() * 60 + local.getUTCMinutes() };
}
function zonedToEpoch(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let e = guess - tzOffsetMs(guess, tz);
  e = guess - tzOffsetMs(e, tz);
  return e;
}
const hhmmToMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// ════════════════════════════════════════════════════════════════════════════
// 3. INDICATORS (full series, oldest first; null until warmed up)
// ════════════════════════════════════════════════════════════════════════════

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let count = 0, acc = 0, prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (prev === null) {
      acc += v; count++;
      if (count === period) { prev = acc / period; out[i] = prev; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsiSeries(close, period) {
  const out = new Array(close.length).fill(null);
  let g = 0, l = 0, avgG = null, avgL = null;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
    if (avgG === null) {
      g += up; l += dn;
      if (i === period) { avgG = g / period; avgL = l / period; }
      else continue;
    } else {
      avgG = (avgG * (period - 1) + up) / period;
      avgL = (avgL * (period - 1) + dn) / period;
    }
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function atrSeries(high, low, close, period) {
  const out = new Array(close.length).fill(null);
  let acc = 0, prev = null;
  for (let i = 0; i < close.length; i++) {
    const tr = i === 0 ? high[i] - low[i]
      : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (prev === null) {
      acc += tr;
      if (i === period - 1) { prev = acc / period; out[i] = prev; }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

function macdSeries(close, fast, slow, signal) {
  const ef = emaSeries(close, fast), es = emaSeries(close, slow);
  const line = close.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
  const sig = emaSeries(line, signal);
  const hist = line.map((v, i) => (v !== null && sig[i] !== null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

/** Max/min of the N values BEFORE index i (current bar excluded). */
function priorExtremeSeries(values, n, isMax) {
  const out = new Array(values.length).fill(null);
  const dq = [];
  for (let i = 0; i < values.length; i++) {
    if (i >= n) out[i] = values[dq[0]];
    // push i, then evict outside window [i-n+1, i] so that at i+1 the window is [i+1-n, i]
    while (dq.length && (isMax ? values[dq[dq.length - 1]] <= values[i] : values[dq[dq.length - 1]] >= values[i])) dq.pop();
    dq.push(i);
    while (dq[0] <= i - n) dq.shift();
  }
  return out;
}

/** Mean of window ending at i (inclusive) or ending at i-1 (prior), length n. */
function rollingMeanSeries(values, n, prior) {
  const out = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= n) acc -= values[i - n];
    if (!prior && i >= n - 1) out[i] = acc / n;
    if (prior && i >= n) out[i] = (acc - values[i] + values[i - n]) / n;
  }
  return out;
}

function pctChangeSeries(close, n) {
  return close.map((c, i) => (i >= n && close[i - n] > 0 ? (c / close[i - n] - 1) * 100 : null));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. DATA LOADING & VALIDATION
// ════════════════════════════════════════════════════════════════════════════

class DataQuality {
  constructor() { this.counts = {}; this.samples = {}; }
  flag(code, detail) {
    this.counts[code] = (this.counts[code] || 0) + 1;
    if (detail !== undefined) {
      const s = this.samples[code] || (this.samples[code] = []);
      if (s.length < 10) s.push(detail);
    }
  }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Load + validate a daily OHLCV file → column arrays. */
function loadDailySeries(file, name, dq) {
  const raw = readJson(file);
  return buildDailySeries(raw.candles || [], name, { source: raw.source, timezone: raw.timezone, fetchedAt: raw.fetchedAt }, dq);
}

/** Validate rows [date, o, h, l, c, v] → column arrays (sorted, de-duplicated). */
function buildDailySeries(rows, name, meta, dq) {
  const byDate = new Map();
  for (const r of rows) {
    const [date, o, h, l, c, v] = r;
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && [o, h, l, c].every(x => isNum(x) && x > 0) && h >= l
      && h >= Math.max(o, c) - 1e-9 && l <= Math.min(o, c) + 1e-9 && isNum(v) && v >= 0;
    if (!ok) { dq.flag('DAILY_INVALID_ROW', `${name} ${date}`); continue; }
    if (byDate.has(date)) dq.flag('DAILY_DUPLICATE_ROW', `${name} ${date}`);
    byDate.set(date, [date, o, h, l, c, v]);
  }
  const sorted = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const s = {
    name, meta,
    dates: sorted.map(r => r[0]), open: sorted.map(r => r[1]), high: sorted.map(r => r[2]),
    low: sorted.map(r => r[3]), close: sorted.map(r => r[4]), volume: sorted.map(r => r[5]),
  };
  s.idx = new Map(s.dates.map((d, i) => [d, i]));
  return s;
}

function prepareIndexSeries(s, cfg) {
  s.ema20 = emaSeries(s.close, 20);
  s.ema50 = emaSeries(s.close, 50);
  s.rocShort = pctChangeSeries(s.close, cfg.market.indexTrend.shortRocSessions);
  s.rocMedium = pctChangeSeries(s.close, cfg.market.indexTrend.mediumRocSessions);
  s.ret1 = pctChangeSeries(s.close, 1);
  return s;
}

function prepareStock(s, info, cfg) {
  const sc = cfg.stockScore, t = sc.trend, m = sc.momentum;
  Object.assign(s, { symbol: info.symbol, sector: info.sector, companyName: info.name });
  s.emaFast = emaSeries(s.close, t.emaFast);
  s.emaMid = emaSeries(s.close, t.emaMid);
  s.emaSlow = emaSeries(s.close, t.emaSlow);
  s.rsi = rsiSeries(s.close, m.rsiPeriod);
  s.macd = macdSeries(s.close, ...m.macd);
  s.roc = pctChangeSeries(s.close, m.rocPeriod);
  s.atr = atrSeries(s.high, s.low, s.close, cfg.risk.atrPeriod);
  s.ret20 = pctChangeSeries(s.close, sc.relativeStrength.lookback);
  s.turnover = s.close.map((c, i) => c * s.volume[i]);
  s.avgTurnover = rollingMeanSeries(s.turnover, sc.liquidity.lookback, false);
  s.avgVolPrior = rollingMeanSeries(s.volume, cfg.breakout.lookback, true);
  s.avgVolShort = rollingMeanSeries(s.volume, sc.volume.trendSessions, false);
  s.priorHigh = priorExtremeSeries(s.high, cfg.breakout.lookback, true);
  s.prior52High = priorExtremeSeries(s.high, cfg.market.breadth.highLowLookback, true);
  s.prior52Low = priorExtremeSeries(s.low, cfg.market.breadth.highLowLookback, false);
  return s;
}

// ─── MongoDB daily source (read-only) ────────────────────────────────────────

/**
 * Reads every daily stock candle for the universe from `stocks` and every index / global bar
 * from `index_candles_daily`, once, at start-up. Each simulated day still only uses rows up to
 * its own decision date. Duplicate (symbol, date) documents keep the newest one.
 */
async function loadDailyFromMongo(cfg, symbols, indexNames, dq) {
  let MongoClient;
  try { ({ MongoClient } = require('mongodb')); } catch { throw new Error('data.source "mongo" needs the mongodb driver: npm install mongodb'); }
  const m = cfg.data.mongo;
  const uri = process.env.SWING_MONGO_URI || m.uri;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(process.env.SWING_MONGO_DB || m.db);
    const stocks = new Map();
    const kept = new Map();
    const cursor = db.collection(m.stocksCollection).find({ type: 'stock', sybl: { $in: symbols } }, { projection: { sybl: 1, dId: 1, 'data.avg': 1 } });
    let docs = 0;
    for await (const d of cursor) {
      docs++;
      const a = (d.data && d.data.avg) || {};
      const date = `${d.dId.slice(0, 4)}-${d.dId.slice(4, 6)}-${d.dId.slice(6, 8)}`;
      const row = [date, a.open, a.high, a.low, a.close, a.volume];
      const ts = d._id.getTimestamp().getTime();
      const key = `${d.sybl}|${date}`;
      const prev = kept.get(key);
      if (prev) {
        const same = prev.row.slice(1).every((v, i) => v === row[i + 1]);
        dq.flag(same ? 'MONGO_DUPLICATE_IDENTICAL' : 'MONGO_DUPLICATE_CONFLICT', same ? undefined : `${key} close ${prev.row[4]} vs ${row[4]} (kept newest)`);
        if (ts < prev.ts) continue;
      }
      kept.set(key, { row, ts });
    }
    for (const [key, { row }] of kept) {
      const sym = key.slice(0, key.indexOf('|'));
      if (!stocks.has(sym)) stocks.set(sym, []);
      stocks.get(sym).push(row);
    }
    const indices = new Map();
    const icursor = db.collection(m.indexCollection).find({ symbol: { $in: indexNames } }, { projection: { _id: 0, symbol: 1, date: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, source: 1, exchangeTimezone: 1 } });
    for await (const d of icursor) {
      if (!indices.has(d.symbol)) indices.set(d.symbol, { rows: [], meta: { source: `mongo:${m.indexCollection} (${d.source})`, timezone: d.exchangeTimezone } });
      indices.get(d.symbol).rows.push([d.date, d.open, d.high, d.low, d.close, d.volume]);
    }
    return { stocks, indices, stats: { stockDocuments: docs, stockRows: kept.size, symbols: stocks.size, indexSeries: indices.size, uri: uri.replace(/\/\/[^@]*@/, '//***@') } };
  } finally {
    await client.close();
  }
}

// ─── Intraday store ──────────────────────────────────────────────────────────

class IntradayStore {
  constructor(dataDir, tz, dq) {
    this.dataDir = dataDir;
    this.tz = tz; this.dq = dq;
    this.months = new Map();
    this.requirements = new Map();
  }

  loadMonth(symbol, ym, interval) {
    const key = `${interval}|${symbol}|${ym}`;
    if (this.months.has(key)) return this.months.get(key);
    const file = path.join(this.dataDir, `intraday${interval}`, symbol, `${ym}.json`);
    let rec = null;
    if (fs.existsSync(file)) {
      const raw = readJson(file);
      const byEpoch = new Map();
      for (const c of raw.candles || []) {
        const e = Date.parse(c[0]);
        const [o, h, l, cl, v] = [c[1], c[2], c[3], c[4], c[5]];
        const ok = isNum(e) && [o, h, l, cl].every(x => isNum(x) && x > 0) && h >= l
          && h >= Math.max(o, cl) - 1e-9 && l <= Math.min(o, cl) + 1e-9 && isNum(v) && v >= 0;
        if (!ok) { this.dq.flag('INTRADAY_INVALID_BAR', `${symbol} ${c[0]}`); continue; }
        if (byEpoch.has(e)) this.dq.flag('INTRADAY_DUPLICATE_BAR', `${symbol} ${c[0]}`);
        const z = zoned(e, this.tz);
        byEpoch.set(e, { e, date: z.date, time: z.time, min: z.min, o, h, l, c: cl, v });
      }
      const byDate = new Map();
      for (const b of [...byEpoch.values()].sort((a, b2) => a.e - b2.e)) {
        if (!byDate.has(b.date)) byDate.set(b.date, []);
        byDate.get(b.date).push(b);
      }
      rec = { to: raw.to, byDate };
      this.loadedCount = this.loadedCount || {};
      this.loadedCount[interval] = (this.loadedCount[interval] || 0) + 1;
    }
    this.months.set(key, rec);
    return rec;
  }

  /** → { status: 'ok' | 'not_fetched' | 'no_data', bars } (bars = raw vendor units, all times) */
  dayBars(symbol, date, interval = 5) {
    const m = this.loadMonth(symbol, date.slice(0, 7), interval);
    if (!m || date > m.to) return { status: 'not_fetched', bars: [] };
    const bars = m.byDate.get(date);
    return bars && bars.length ? { status: 'ok', bars } : { status: 'no_data', bars: [] };
  }

  require(symbol, date, purpose, interval = 5) {
    const key = `${interval}|${symbol}|${date}|${purpose}`;
    if (!this.requirements.has(key)) this.requirements.set(key, { symbol, date, purpose, interval });
  }

  monthsLoaded(interval) { return (this.loadedCount && this.loadedCount[interval]) || 0; }
}

const inSession = (bars, sess) => bars.filter(b => b.min >= sess.startMin && b.min < sess.endMin);
const minToHhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Build N-minute bars from in-session base bars, aligned to the session start. */
function aggregateBars(bars, startMin, interval) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const slot = Math.floor((b.min - startMin) / interval);
    if (!cur || cur.slot !== slot) {
      if (cur) out.push(cur);
      const min = startMin + slot * interval;
      cur = { slot, e: b.e, date: b.date, min, time: minToHhmm(min), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c; cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out.map(({ slot, ...b }) => b);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. BACKTEST ENGINE
// ════════════════════════════════════════════════════════════════════════════

class SwingBacktest {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.quiet = !!opts.quiet;
    this.root = path.resolve(__dirname, '..');
    this.dataDir = path.resolve(this.root, cfg.data.dir);
    this.dq = new DataQuality();
    this.log = (...a) => { if (!this.quiet) console.log(...a); };
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  async load() {
    const cfg = this.cfg;
    const universeFile = path.join(this.dataDir, 'universe', 'universe.json');
    if (!fs.existsSync(universeFile)) throw new Error(`Missing ${universeFile}. Run: node swing/fetch-swing-data.js all`);
    this.universe = readJson(universeFile);
    const tradable = this.universe.stocks.filter(info => !cfg.data.excludeSymbols.includes(info.symbol) && cfg.data.allowedSeries.includes(info.series));
    const indexNames = ['NIFTY50', 'BANKNIFTY', 'INDIAVIX', ...cfg.market.usIndices, ...cfg.market.asiaIndices];

    let mongo = null;
    if (cfg.data.source === 'mongo') {
      this.log(`Reading daily candles from MongoDB ${cfg.data.mongo.db}.${cfg.data.mongo.stocksCollection} and .${cfg.data.mongo.indexCollection} …`);
      mongo = await loadDailyFromMongo(cfg, tradable.map(s => s.symbol), indexNames, this.dq);
      this.mongoStats = mongo.stats;
    } else if (cfg.data.source !== 'files') throw new Error(`Unknown data.source "${cfg.data.source}" (use files or mongo)`);

    const mkt = name => {
      if (mongo) {
        const rec = mongo.indices.get(name);
        if (!rec) { this.dq.flag('MARKET_SERIES_MISSING', name); return null; }
        return prepareIndexSeries(buildDailySeries(rec.rows, name, rec.meta, this.dq), cfg);
      }
      const f = path.join(this.dataDir, 'market', 'daily', `${name}.json`);
      if (!fs.existsSync(f)) { this.dq.flag('MARKET_SERIES_FILE_MISSING', name); return null; }
      return prepareIndexSeries(loadDailySeries(f, name, this.dq), cfg);
    };
    this.nifty = mkt('NIFTY50');
    if (!this.nifty) throw new Error('NIFTY50 daily data is required (trading calendar + benchmark).');
    this.bankNifty = mkt('BANKNIFTY');
    this.vix = mkt('INDIAVIX');
    this.global = {};
    for (const name of [...cfg.market.usIndices, ...cfg.market.asiaIndices]) {
      const s = mkt(name);
      if (!s) continue;
      const gs = cfg.market.globalSessions[name];
      s.closeEpoch = s.dates.map(d => zonedToEpoch(d, gs.close, gs.timezone));
      this.global[name] = s;
    }
    const giftFile = path.join(this.dataDir, cfg.market.giftNifty.file);
    this.gift = fs.existsSync(giftFile) ? new Map(readJson(giftFile).rows.map(r => [r[0], r[1]])) : null;

    this.stocks = [];
    this.universeStats = { listed: this.universe.stocks.length, excludedSeries: 0, excludedSymbol: 0, missingFile: 0, loaded: 0 };
    for (const info of this.universe.stocks) {
      if (cfg.data.excludeSymbols.includes(info.symbol)) { this.universeStats.excludedSymbol++; continue; }
      if (!cfg.data.allowedSeries.includes(info.series)) { this.universeStats.excludedSeries++; continue; }
      let s;
      if (mongo) {
        const rows = mongo.stocks.get(info.symbol);
        if (!rows) { this.universeStats.missingFile++; this.dq.flag('STOCK_DAILY_MISSING', info.symbol); continue; }
        s = buildDailySeries(rows, info.symbol, { source: `mongo:${cfg.data.mongo.stocksCollection}` }, this.dq);
      } else {
        const f = path.join(this.dataDir, 'daily', `${info.symbol}.json`);
        if (!fs.existsSync(f)) { this.universeStats.missingFile++; this.dq.flag('STOCK_DAILY_MISSING', info.symbol); continue; }
        s = loadDailySeries(f, info.symbol, this.dq);
      }
      if (s.dates.length < cfg.data.minHistorySessions) this.dq.flag('STOCK_SHORT_HISTORY', `${info.symbol} (${s.dates.length} sessions)`);
      this.stocks.push(prepareStock(s, info, cfg));
    }
    this.universeStats.loaded = this.stocks.length;
    this.bySymbol = new Map(this.stocks.map(s => [s.symbol, s]));
    if (cfg.fundamentals.enabled) this.loadFundamentals();

    this.calendar = this.nifty.dates;
    this.calIdx = new Map(this.calendar.map((d, i) => [d, i]));
    this.intraday = new IntradayStore(this.dataDir, cfg.session.timezone, this.dq);
    this.buildCrossSection();
    this.barCache = new Map();
    const firstStock = this.stocks.reduce((m, s) => (s.dates[0] < m ? s.dates[0] : m), '9999');
    this.log(`Loaded ${this.stocks.length} stocks (from ${cfg.data.source}, first candle ${firstStock}), ${this.calendar.length} NIFTY sessions (${this.calendar[0]} → ${this.calendar[this.calendar.length - 1]})`);
  }

  /**
   * In-session bars for one day at 1, 5 or 15 minutes (vendor price units).
   * 15-minute bars are built from 5-minute bars aligned to that day's session start.
   */
  barsFor(symbol, date, interval) {
    const key = `${symbol}|${date}|${interval}`;
    const hit = this.barCache.get(key);
    if (hit) return hit;
    const sess = this.sessionFor(date);
    const base = this.cfg.data.intradayIntervalMinutes;
    if (interval !== 1 && interval % base) throw new Error(`Interval ${interval} must be 1 or a multiple of ${base}`);
    // Source order: the exact interval, then 5-minute (for 15), then 1-minute (for 5 and 15).
    const sources = interval === 1 ? [1] : interval === base ? [base, 1] : [base, 1];
    let out = null;
    for (const src of sources) {
      const r = this.intraday.dayBars(symbol, date, src);
      if (r.status !== 'ok') { if (!out || r.status === 'no_data') out = { status: r.status, bars: [] }; continue; }
      const bars = inSession(r.bars, sess);
      out = { status: 'ok', source: src, bars: src === interval ? bars : aggregateBars(bars, sess.startMin, interval) };
      break;
    }
    this.barCache.set(key, out);
    return out;
  }

  /** Download interval behind a bar interval (5 and 15-minute bars can come from 5 or 1-minute files). */
  sourceInterval(interval) { return interval === 1 ? 1 : this.cfg.data.intradayIntervalMinutes; }

  /** Drop parsed intraday months and built bars older than `keepFrom` (memory bound on long runs). */
  releaseIntradayBefore(keepFrom) {
    const ym = keepFrom.slice(0, 7);
    for (const k of this.intraday.months.keys()) if (k.slice(k.lastIndexOf('|') + 1) < ym) this.intraday.months.delete(k);
    for (const k of this.barCache.keys()) { const d = k.split('|')[1]; if (d < keepFrom) this.barCache.delete(k); }
  }

  /** Yearly revenue, net profit and equity per stock, each with the date it became public. */
  loadFundamentals() {
    const fc = this.cfg.fundamentals;
    const dir = path.join(this.dataDir, fc.dir);
    const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const periodEnd = label => { const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label || ''); return m ? new Date(Date.UTC(+m[2], MONTHS[m[1]] + 1, 0)) : null; };
    this.fundStats = { stocksWithData: 0, stocksMissing: 0, snapshotDates: new Set() };
    for (const s of this.stocks) {
      const f = path.join(dir, `${s.symbol}.json`);
      s.fund = [];
      if (!fs.existsSync(f)) { this.fundStats.stocksMissing++; this.dq.flag('FUNDAMENTALS_FILE_MISSING', s.symbol); continue; }
      const raw = readJson(f);
      this.fundStats.snapshotDates.add(raw.snapshotDate);
      const iy = raw.endpoints && raw.endpoints.incomeYearly, bs = raw.endpoints && raw.endpoints.balanceSheet;
      const rows = (iy && iy.income_statement) || [];
      const pick = cat => new Map(((rows.find(r => r.category === cat) || {}).history || []).map(h => [h.period, h.value]));
      const rev = pick('revenue'), np = pick('net_profit');
      const eq = new Map(((bs && bs.history) || []).map(h => [h.period, isNum(h.total_asset) && isNum(h.total_liability) ? h.total_asset - h.total_liability : null]));
      for (const period of new Set([...rev.keys(), ...np.keys()])) {
        const end = periodEnd(period);
        if (!end) { this.dq.flag('FUNDAMENTALS_BAD_PERIOD', `${s.symbol} ${period}`); continue; }
        const avail = new Date(end.getTime() + fc.annualLagDays * 86400000).toISOString().slice(0, 10);
        s.fund.push({ period, periodEnd: end.toISOString().slice(0, 10), availableFrom: avail, revenue: rev.get(period), netProfit: np.get(period), equity: eq.has(period) ? eq.get(period) : null });
      }
      s.fund.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
      if (s.fund.length) this.fundStats.stocksWithData++; else this.fundStats.stocksMissing++;
    }
    this.fundStats.snapshotDates = [...this.fundStats.snapshotDates].sort();
    this.log(`Fundamentals: ${this.fundStats.stocksWithData} stocks with yearly data, ${this.fundStats.stocksMissing} without (snapshot ${this.fundStats.snapshotDates.join(', ')})`);
  }

  /** Fundamentals known on date D: latest public year vs the year before it. */
  fundamentalsAsOf(s, D) {
    let i = -1;
    for (let k = 0; k < s.fund.length; k++) if (s.fund[k].availableFrom <= D) i = k;
    if (i < 0) return null;
    const cur = s.fund[i], prev = i > 0 ? s.fund[i - 1] : null;
    const growth = (a, b) => (isNum(a) && isNum(b) && b > 0 ? (a / b - 1) * 100 : null);
    return {
      period: cur.period, netProfit: cur.netProfit,
      revenueGrowthPct: prev ? growth(cur.revenue, prev.revenue) : null,
      profitGrowthPct: prev ? growth(cur.netProfit, prev.netProfit) : null,
      roePct: isNum(cur.netProfit) && isNum(cur.equity) && cur.equity > 0 ? (cur.netProfit / cur.equity) * 100 : null,
    };
  }

  /** null when the stock passes; otherwise the exclusion bucket ('fundMissing' | 'fundFail'). */
  fundamentalsGate(s, D) {
    const ff = this.cfg.fundamentals.filter;
    const f = this.fundamentalsAsOf(s, D);
    if (!f) return 'fundMissing';
    const criteria = [[ff.minRevenueGrowthPct, f.revenueGrowthPct], [ff.minProfitGrowthPct, f.profitGrowthPct], [ff.minRoePct, f.roePct]]
      .filter(([min]) => min !== null && min !== undefined);
    if (ff.requirePositiveProfit && !isNum(f.netProfit)) return 'fundMissing';
    if (ff.requirePositiveProfit && !(f.netProfit > 0)) return 'fundFail';
    if (!criteria.length) return null;
    const known = criteria.filter(([, v]) => v !== null);
    if ((ff.combine || 'all') === 'any') {
      if (known.some(([min, v]) => v >= min)) return null;
      return known.length ? 'fundFail' : 'fundMissing';
    }
    if (known.length < criteria.length) return 'fundMissing';
    return known.every(([min, v]) => v >= min) ? null : 'fundFail';
  }

  /** Breadth + equal-weighted sector composites for every trading date. */
  buildCrossSection() {
    this.cross = new Map();
    for (const date of this.calendar) {
      let n = 0, above = 0, hlN = 0, nh = 0, nl = 0;
      const sectors = new Map();
      for (const s of this.stocks) {
        const i = s.idx.get(date);
        if (i === undefined || s.emaFast[i] === null) continue;
        n++;
        const isAbove = s.close[i] > s.emaFast[i];
        if (isAbove) above++;
        if (s.prior52High[i] !== null) {
          hlN++;
          if (s.high[i] >= s.prior52High[i]) nh++;
          if (s.low[i] <= s.prior52Low[i]) nl++;
        }
        if (s.ret20[i] !== null) {
          let sec = sectors.get(s.sector);
          if (!sec) sectors.set(s.sector, (sec = { n: 0, sumRet20: 0, above: 0 }));
          sec.n++; sec.sumRet20 += s.ret20[i]; if (isAbove) sec.above++;
        }
      }
      this.cross.set(date, { n, pctAbove: n ? (100 * above) / n : null, hlN, nh, nl, sectors });
    }
  }

  sessionFor(date) {
    const c = this.cfg.session;
    // Configured special sessions first, then dated sessions supplied at run time (exchange calendar).
    const sp = c.specialSessions[date] || (this.runtimeSessions && this.runtimeSessions[date]);
    const s = { ...c.normal, ...(sp || {}), date, special: !!sp, label: (sp && sp.label) || 'normal' };
    s.startMin = hhmmToMin(s.tradingStart);
    s.endMin = hhmmToMin(s.tradingEnd);
    s.cutoffMin = hhmmToMin(s.tradeCutoff);
    s.orEndMin = s.startMin + s.openingRangeMinutes;
    s.decisionEpoch = zonedToEpoch(date, s.preMarketOpen, c.timezone);
    return s;
  }

  // ─── Market feasibility (§2.1–2.2) ─────────────────────────────────────────

  indexTrendScore(s, D) {
    if (!s) return { available: false, why: 'series missing' };
    const i = s.idx.get(D);
    if (i === undefined) return { available: false, why: `no ${s.name} bar for ${D}` };
    if (s.ema50[i] === null || s.rocMedium[i] === null) return { available: false, why: 'warm-up' };
    const c = s.close[i];
    let pts = 0;
    if (c > s.ema20[i]) pts += 25;
    if (c > s.ema50[i]) pts += 20;
    if (s.ema20[i] > s.ema50[i]) pts += 20;
    if (s.rocShort[i] > 0) pts += 15;
    if (s.rocMedium[i] > 0) pts += 20;
    return { available: true, score: pts, detail: { close: round(c), ema20: round(s.ema20[i]), ema50: round(s.ema50[i]), rocShort: round(s.rocShort[i]), rocMedium: round(s.rocMedium[i]) } };
  }

  globalGroupScore(names, E, decisionEpoch) {
    const parts = {};
    const scores = [];
    for (const name of names) {
      const s = this.global[name];
      if (!s) { parts[name] = 'missing'; continue; }
      // latest session whose close is at or before the decision time
      let lo = 0, hi = s.closeEpoch.length - 1, j = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.closeEpoch[mid] <= decisionEpoch) { j = mid; lo = mid + 1; } else hi = mid - 1; }
      if (j < 1 || s.ema50[j] === null) { parts[name] = 'warm-up'; continue; }
      const age = calendarDaysBetween(s.dates[j], E);
      if (age > this.cfg.data.globalMaxStaleCalendarDays) { parts[name] = `stale (${s.dates[j]})`; continue; }
      const ret = (s.close[j] / s.close[j - 1] - 1) * 100;
      const score = 50 * clamp01((ret + 1.5) / 3) + (s.close[j] > s.ema20[j] ? 25 : 0) + (s.ema20[j] > s.ema50[j] ? 25 : 0);
      parts[name] = { session: s.dates[j], retPct: round(ret), score: round(score, 1) };
      scores.push(score);
    }
    return scores.length ? { available: true, score: mean(scores), detail: parts } : { available: false, why: 'no fresh session', detail: parts };
  }

  sectorStrength(sec, niftyRet20) {
    const meanRet = sec.sumRet20 / sec.n;
    const pct = (100 * sec.above) / sec.n;
    return 50 * clamp01((meanRet - niftyRet20 + 5) / 10) + 50 * clamp01((pct - 30) / 40);
  }

  marketScore(E, D, sess, candidateSector) {
    const cfg = this.cfg.market;
    const comp = {};
    comp.nifty = this.indexTrendScore(this.nifty, D);
    comp.bankNifty = this.indexTrendScore(this.bankNifty, D);

    const cs = this.cross.get(D);
    const prevDate = this.calendar[this.calIdx.get(D) - cfg.breadth.directionLookback];
    const csPrev = prevDate ? this.cross.get(prevDate) : null;
    if (cs && cs.n >= 100 && cs.hlN >= 100 && csPrev && csPrev.pctAbove !== null) {
      const hl = cs.nh + cs.nl ? cs.nh / (cs.nh + cs.nl) : 0.5;
      const delta = cs.pctAbove - csPrev.pctAbove;
      const score = 50 * clamp01((cs.pctAbove - 30) / 40) + 30 * hl + 20 * clamp01((delta + 10) / 20);
      comp.breadth = { available: true, score, detail: { pctAboveEma20: round(cs.pctAbove, 1), newHighs: cs.nh, newLows: cs.nl, delta5: round(delta, 1), stocks: cs.n } };
    } else comp.breadth = { available: false, why: 'insufficient constituents with data' };

    comp.us = this.globalGroupScore(cfg.usIndices, E, sess.decisionEpoch);
    comp.asia = this.globalGroupScore(cfg.asiaIndices, E, sess.decisionEpoch);

    const ni = this.nifty.idx.get(D);
    if (this.gift && this.gift.has(E) && ni !== undefined) {
      const gap = (this.gift.get(E) / this.nifty.close[ni] - 1) * 100;
      const g = cfg.giftNifty.fullScoreGapPct;
      comp.giftNifty = { available: true, score: 100 * clamp01((gap + g) / (2 * g)), detail: { gapPct: round(gap) } };
    } else comp.giftNifty = { available: false, why: 'no GIFT NIFTY history' };

    const vi = this.vix ? this.vix.idx.get(D) : undefined;
    if (vi !== undefined && vi >= cfg.vix.directionLookback) {
      const lvl = this.vix.close[vi];
      const chg = (lvl / this.vix.close[vi - cfg.vix.directionLookback] - 1) * 100;
      const score = 60 * clamp01((cfg.vix.stressLevel - lvl) / (cfg.vix.stressLevel - cfg.vix.calmLevel)) + 40 * clamp01((10 - chg) / 20);
      comp.vix = { available: true, score, detail: { level: round(lvl), change5Pct: round(chg) } };
    } else comp.vix = { available: false, why: 'no India VIX bar' };

    const niftyRet20 = ni !== undefined ? this.nifty.rocMedium[ni] : null;
    if (cs && niftyRet20 !== null) {
      const scored = [...cs.sectors.entries()].filter(([, s]) => s.n >= cfg.sector.minMembers)
        .map(([name, s]) => ({ name, score: this.sectorStrength(s, niftyRet20) })).sort((a, b) => b.score - a.score);
      const leading = scored.slice(0, cfg.sector.leadingCount);
      if (leading.length) {
        const leadScore = mean(leading.map(x => x.score));
        const cand = candidateSector ? scored.find(x => x.name === candidateSector) : null;
        const score = cand ? (cand.score + leadScore) / 2 : leadScore;
        comp.sector = { available: true, score, detail: { leading: leading.map(x => `${x.name} ${round(x.score, 0)}`), candidateSector: candidateSector || null, candidateSectorScore: cand ? round(cand.score, 1) : null } };
      } else comp.sector = { available: false, why: 'no sector with enough members' };
    } else comp.sector = { available: false, why: 'cross-section missing' };

    let wSum = 0, wsSum = 0, missingWeight = 0, dW = 0, dWs = 0;
    const missing = [];
    for (const [name, w] of Object.entries(cfg.weights)) {
      const c = comp[name];
      if (c && c.available) {
        wSum += w; wsSum += w * c.score;
        if (cfg.domesticComponents.includes(name)) { dW += w; dWs += w * c.score; }
      } else { missingWeight += w; missing.push(name); }
    }
    const totalWeight = sum(Object.values(cfg.weights));
    const missingPct = (100 * missingWeight) / totalWeight;
    const score = wSum ? wsSum / wSum : null;
    const domesticScore = dW ? dWs / dW : null;

    let gate = null;
    const missingRequired = cfg.requiredComponents.filter(n => missing.includes(n));
    if (missingRequired.length) gate = { type: 'DATA_QUALITY', reason: `required component missing: ${missingRequired.join(', ')}` };
    else if (missingPct > cfg.dataQuality.maxMissingWeightPct) gate = { type: 'DATA_QUALITY', reason: `missing weight ${round(missingPct, 1)}% > ${cfg.dataQuality.maxMissingWeightPct}%` };
    else if (ni !== undefined) {
      const c = this.nifty.close[ni], e50 = this.nifty.ema50[ni], r1 = this.nifty.ret1[ni];
      if (e50 && c < e50 * (1 - cfg.hardGates.niftyMaxPctBelowEma50 / 100)) gate = { type: 'HARD_GATE', reason: `NIFTY ${round((c / e50 - 1) * 100)}% below EMA50` };
      else if (r1 !== null && r1 <= cfg.hardGates.niftyMinDayReturnPct) gate = { type: 'HARD_GATE', reason: `NIFTY fell ${round(r1)}% on ${D}` };
      else if (isNum(cfg.hardGates.niftyMinRoc20Pct) && this.nifty.rocMedium[ni] !== null && this.nifty.rocMedium[ni] < cfg.hardGates.niftyMinRoc20Pct) gate = { type: 'HARD_GATE', reason: `NIFTY 20-session return ${round(this.nifty.rocMedium[ni])}% < ${cfg.hardGates.niftyMinRoc20Pct}%` };
      else if (domesticScore !== null && domesticScore < cfg.hardGates.minDomesticScore) gate = { type: 'HARD_GATE', reason: `domestic score ${round(domesticScore, 1)} < ${cfg.hardGates.minDomesticScore}` };
    }

    let band = 'blocked';
    if (!gate && score !== null) {
      if (score >= cfg.bands.favorable) band = 'favorable';
      else if (score >= cfg.bands.cautious) band = 'cautious';
      else if (score >= cfg.bands.research) band = 'research';
    }
    return { score, domesticScore, band, gate, missing, missingPct, components: comp };
  }

  // ─── Daily stock score (§2.3, §3.1) ────────────────────────────────────────

  scoreStock(s, i, ctx) {
    const cfg = this.cfg, sc = cfg.stockScore, w = sc.weights, bo = cfg.breakout;
    const c = s.close[i], atr = s.atr[i];
    const t = sc.trend;
    const ef = s.emaFast[i], em = s.emaMid[i], es = s.emaSlow[i];

    // Trend strength
    const distAtr = (c - ef) / atr;
    const trendParts = {
      closeAboveEmaFast: c > ef ? 0.24 : 0,
      emaFastAboveMid: ef > em ? 0.20 : 0,
      emaMidAboveSlow: em > es ? 0.16 : 0,
      fastSlopeUp: ef > s.emaFast[i - t.fastSlopeSessions] ? 0.12 : 0,
      midSlopeUp: em > s.emaMid[i - t.midSlopeSessions] ? 0.08 : 0,
      distance: distAtr >= 0 && distAtr <= t.healthyDistanceAtr ? 0.20 : distAtr > t.healthyDistanceAtr && distAtr <= t.stretchedDistanceAtr ? 0.10 : 0,
    };
    const trend = w.trend * sum(Object.values(trendParts));

    // Relative strength
    const rsCfg = sc.relativeStrength;
    const r20 = s.ret20[i];
    const diffNifty = r20 - ctx.niftyRet20;
    const sec = ctx.cross.sectors.get(s.sector);
    let diffSector, sectorFallback = false;
    if (sec && sec.n - 1 >= cfg.market.sector.minMembers) diffSector = r20 - (sec.sumRet20 - r20) / (sec.n - 1);
    else { diffSector = diffNifty; sectorFallback = true; }
    let persist = 0, persistN = 0;
    for (let k = 0; k < rsCfg.persistenceWindows; k++) {
      const a = i - k * rsCfg.persistenceWindowSessions, b = a - rsCfg.persistenceWindowSessions;
      if (b < 0) continue;
      const na = this.nifty.idx.get(s.dates[a]), nb = this.nifty.idx.get(s.dates[b]);
      if (na === undefined || nb === undefined) continue;
      persistN++;
      if (s.close[a] / s.close[b] > this.nifty.close[na] / this.nifty.close[nb]) persist++;
    }
    const full = rsCfg.fullScoreOutperformancePct;
    const rs = w.relativeStrength * (0.48 * clamp01(diffNifty / full) + 0.24 * clamp01(diffSector / full) + 0.28 * (persistN ? persist / rsCfg.persistenceWindows : 0));

    // Momentum
    const m = sc.momentum;
    const rsi = s.rsi[i];
    const rsiPts = rsi >= m.rsiMin && rsi <= m.rsiMax ? 0.40 : (rsi >= m.rsiMin - m.rsiNearBand && rsi <= m.rsiMax + m.rsiNearBand ? 0.20 : 0);
    const ml = s.macd.line[i], msig = s.macd.signal[i], mh = s.macd.hist[i], mhPrev = s.macd.hist[i - 1];
    const momentum = w.momentum * (rsiPts + (ml > msig ? 0.20 : 0) + (mh > 0 && mhPrev !== null && mh > mhPrev ? 0.133 : 0) + (s.roc[i] > 0 ? 0.267 : 0));

    // Volume strength
    const v = sc.volume;
    const relVol = s.avgVolPrior[i] > 0 ? s.volume[i] / s.avgVolPrior[i] : 0;
    const volTrend = s.avgVolPrior[i] > 0 ? s.avgVolShort[i] / s.avgVolPrior[i] : 0;
    const tier = (x, tiers) => { for (const [th, f] of tiers) if (x >= th) return f; return 0; };
    const volume = w.volume * (0.333 * tier(s.avgTurnover[i], v.turnoverTiers) + 0.40 * tier(relVol, v.relVolumeTiers) + 0.267 * (volTrend >= 1.2 ? 1 : volTrend >= 1.0 ? 0.5 : 0));

    // Breakout quality
    const range = s.high[i] - s.low[i];
    const closeStrength = range > 0 ? (c - s.low[i]) / range : 0;
    const isBreakout = c > s.priorHigh[i];
    const extensionAtr = (c - s.priorHigh[i]) / atr;
    const breakout = w.breakout * ((isBreakout ? 0.40 : 0) + (relVol >= bo.minVolumeRatio ? 0.25 : 0)
      + (closeStrength >= bo.minCloseStrength ? 0.20 : 0) + (isBreakout && extensionAtr <= bo.maxScoreExtensionAtr ? 0.15 : 0));

    const score = trend + rs + momentum + volume + breakout;
    return {
      symbol: s.symbol, sector: s.sector, score,
      factors: { trend: round(trend, 1), relativeStrength: round(rs, 1), momentum: round(momentum, 1), volume: round(volume, 1), breakout: round(breakout, 1) },
      metrics: {
        close: c, atr, atrPct: round((atr / c) * 100), ret20: round(r20), diffNifty: round(diffNifty), diffSector: round(diffSector), sectorFallback,
        persistence: `${persist}/${persistN}`, rsi: round(rsi, 1), roc: round(s.roc[i]), relVol: round(relVol), volTrend: round(volTrend),
        avgTurnoverCr: round(s.avgTurnover[i] / 1e7, 1), isBreakout, breakoutLevel: s.priorHigh[i], extensionAtr: round(extensionAtr), closeStrength: round(closeStrength),
      },
    };
  }

  scanStocks(D) {
    const cfg = this.cfg, sc = cfg.stockScore;
    const ni = this.nifty.idx.get(D);
    const ctx = { niftyRet20: this.nifty.rocMedium[ni], cross: this.cross.get(D) };
    const excluded = { noBarOnDate: 0, warmup: 0, price: 0, turnover: 0, rsBelowNifty: 0, noBreakout: 0, fundMissing: 0, fundFail: 0 };
    const useFund = cfg.fundamentals.enabled && (cfg.fundamentals.mode || 'scan') === 'scan';
    const checkFund = cfg.fundamentals.enabled && cfg.fundamentals.mode === 'entryCheck';
    const eligible = [];
    for (const s of this.stocks) {
      const i = s.idx.get(D);
      if (i === undefined) { excluded.noBarOnDate++; continue; }
      if (i < cfg.data.minHistorySessions || s.emaSlow[i] === null || s.atr[i] === null || s.macd.signal[i - 1] == null || s.priorHigh[i] === null || s.ret20[i] === null) { excluded.warmup++; continue; }
      if (!(s.close[i] > sc.liquidity.minPrice)) { excluded.price++; continue; }
      if (!(s.avgTurnover[i] > sc.liquidity.minAvgTradedValue)) { excluded.turnover++; continue; }
      if (sc.requireOutperformNifty && !(s.ret20[i] > ctx.niftyRet20)) { excluded.rsBelowNifty++; continue; }
      if (sc.requireBreakoutClose && !(s.close[i] > s.priorHigh[i])) { excluded.noBreakout++; continue; }
      if (useFund) { const why = this.fundamentalsGate(s, D); if (why) { excluded[why]++; continue; } }
      const scored = this.scoreStock(s, i, ctx);
      if (useFund || checkFund) {
        const f = this.fundamentalsAsOf(s, D);
        scored.fund = f ? { period: f.period, revenueGrowthPct: round(f.revenueGrowthPct, 1), profitGrowthPct: round(f.profitGrowthPct, 1), roePct: round(f.roePct, 1) } : null;
        if (checkFund) scored.fundBlock = this.fundamentalsGate(s, D);   // null = may be bought
      }
      eligible.push(scored);
    }
    eligible.sort((a, b) => b.score - a.score || b.metrics.diffNifty - a.metrics.diffNifty || (a.symbol < b.symbol ? -1 : 1));
    const qualified = eligible.filter(x => x.score >= sc.minScore);
    return { eligible, qualified, excluded, top: qualified[0] || null, best: eligible[0] || null };
  }

  // ─── Intraday helpers (§3.2–3.4) ───────────────────────────────────────────

  /** Daily-units / vendor-intraday-units ratio from the most recent session ≤ D with both. */
  priceScale(symbol, s, D) {
    const di = this.calIdx.get(D);
    for (let back = 0; back < 5 && di - back >= 0; back++) {
      const date = this.calendar[di - back];
      const i = s.idx.get(date);
      if (i === undefined) continue;
      const r = this.barsFor(symbol, date, this.cfg.data.intradayIntervalMinutes);
      if (r.status !== 'ok') continue;
      const bars = r.bars;
      if (!bars.length) continue;
      const hi = Math.max(...bars.map(b => b.h)), lo = Math.min(...bars.map(b => b.l));
      const k = median([s.open[i] / bars[0].o, s.high[i] / hi, s.low[i] / lo]);
      return { k, from: date, lastClose: bars[bars.length - 1].c * k };
    }
    this.dq.flag('PRICE_SCALE_UNAVAILABLE', `${symbol} ${D}`);
    return { k: 1, from: null, lastClose: null };
  }

  /** Same time-of-day volume baseline from prior normal sessions (confirmation-interval bars). */
  volumeBaseline(symbol, E, interval) {
    const cfg = this.cfg.data;
    const ei = this.calIdx.get(E);
    const slots = new Map();
    let sessions = 0, notFetched = false;
    for (let j = ei - 1; j >= 0 && sessions < cfg.volumeBaselineSessions && ei - j <= cfg.volumeBaselineSessions * 2; j--) {
      const date = this.calendar[j];
      if (this.sessionFor(date).special) continue;
      const r = this.barsFor(symbol, date, interval);
      if (r.status === 'not_fetched') { notFetched = true; this.intraday.require(symbol, date, 'baseline', this.sourceInterval(interval)); continue; }
      if (r.status !== 'ok') continue;
      sessions++;
      for (const b of r.bars) {
        if (!slots.has(b.time)) slots.set(b.time, []);
        slots.get(b.time).push(b.v);
      }
    }
    const avg = new Map();
    for (const [t, vols] of slots) if (vols.length >= cfg.minBaselineSessions) avg.set(t, mean(vols));
    return { avg, sessions, notFetched };
  }

  /**
   * Everything one candidate needs before the session's bars are walked: confirmation bars in
   * daily price units, VWAP, same-time relative volume, opening range, NIFTY reference.
   * Returns { ok: false, status, reason } when the data is not usable.
   */
  prepareCandidate(plan, sess) {
    const cfg = this.cfg;
    const ci = cfg.entry.confirmationIntervalMinutes;
    const { symbol, D, E } = plan;
    const s = this.bySymbol.get(symbol);
    const di = s.idx.get(D);

    const today = this.barsFor(symbol, E, ci);
    if (today.status === 'not_fetched') { this.intraday.require(symbol, E, 'entry', this.sourceInterval(ci)); return { ok: false, status: 'data_missing', reason: 'intraday not fetched' }; }
    if (today.status !== 'ok' || !today.bars.length) { this.dq.flag('INTRADAY_NO_BARS_FOR_ENTRY_DAY', `${symbol} ${E}`); return { ok: false, status: 'data_missing', reason: 'vendor has no bars' }; }
    const raw = today.bars;
    if (raw[0].min !== sess.startMin) {
      this.dq.flag('SESSION_MISMATCH', `${symbol} ${E} first bar ${raw[0].time}`);
      return { ok: false, status: 'session_invalid', reason: 'first bar does not match configured trading start' };
    }
    const expectedBars = (sess.endMin - sess.startMin) / ci;
    if (raw.length < 0.9 * expectedBars) this.dq.flag('INTRADAY_PARTIAL_SESSION', `${symbol} ${E} ${raw.length}/${expectedBars}`);

    const base = this.volumeBaseline(symbol, E, ci);
    if (base.sessions < cfg.data.minBaselineSessions) {
      this.dq.flag('VOLUME_BASELINE_INSUFFICIENT', `${symbol} ${E} (${base.sessions} sessions)`);
      return { ok: false, status: 'data_missing', reason: `volume baseline ${base.sessions} sessions` };
    }

    const nToday = this.barsFor('NIFTY50', E, ci);
    const nPrev = this.barsFor('NIFTY50', D, ci);
    if (nToday.status === 'not_fetched') this.intraday.require('NIFTY50', E, 'hold', this.sourceInterval(ci));
    const niftyByTime = new Map(nToday.bars.map(b => [b.time, b.c]));
    const niftyRef = nPrev.bars.length ? nPrev.bars[nPrev.bars.length - 1].c : this.nifty.close[this.nifty.idx.get(D)];

    const scale = this.priceScale(symbol, s, D);
    const k = scale.k;
    const bars = raw.map(b => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k }));
    const vwap = [], relVol = [];
    let pv = 0, vv = 0;
    for (const b of bars) {
      pv += ((b.h + b.l + b.c) / 3) * b.v; vv += b.v;
      vwap.push(vv > 0 ? pv / vv : (b.h + b.l + b.c) / 3);
      const bl = base.avg.get(b.time);
      relVol.push(bl > 0 ? b.v / bl : null);
    }
    const orBars = bars.filter(b => b.min < sess.orEndMin);
    const orComplete = orBars.length === Math.ceil(sess.openingRangeMinutes / ci);
    if (!orComplete) this.dq.flag('OPENING_RANGE_INCOMPLETE', `${symbol} ${E}`);
    return {
      ok: true, plan, symbol, bars, vwap, relVol, orComplete, orHigh: orBars.length ? Math.max(...orBars.map(b => b.h)) : null,
      niftyByTime, niftyRef, stockRef: scale.lastClose || s.close[di], k, priceScaleFrom: scale.from,
      atr: s.atr[di], breakoutLevel: s.priorHigh[di],
    };
  }

  /** Every ORB / VWAP-pullback confirmation for one candidate, bar by bar, up to the cutoff. */
  scanSignals(ctx, sess) {
    const { bars, vwap, relVol, orHigh } = ctx;
    const orbCfg = this.cfg.entry.orb, vpCfg = this.cfg.entry.vwapPullback;
    const strength = b => (b.h > b.l ? (b.c - b.l) / (b.h - b.l) : null);
    const out = [];
    let aboveCount = 0;
    for (let i = 0; i < bars.length - 1; i++) {
      const b = bars[i], next = bars[i + 1];
      if (i > 0 && bars[i - 1].c > vwap[i - 1]) aboveCount++;
      if (next.min > sess.cutoffMin) break;
      const st = strength(b);

      // A) Opening Range Breakout — only after the opening range has completed
      let orb = false;
      if (orbCfg.enabled && ctx.orComplete && b.min >= sess.orEndMin) {
        orb = b.c > orHigh && (!orbCfg.requireAboveVwap || b.c > vwap[i])
          && relVol[i] !== null && relVol[i] >= orbCfg.minRelVolume && st !== null && st >= orbCfg.minCloseStrength;
      }

      // B) VWAP Pullback — eligible as soon as enough completed bars exist
      let vp = false, vpInfo = null;
      if (vpCfg.enabled && i + 1 >= vpCfg.minCompletedBars) {
        const fracAbove = i > 0 ? (100 * aboveCount) / i : 0;
        const vwapRising = vwap[i] > vwap[Math.max(0, i - vpCfg.vwapRisingLookbackBars)];
        let touched = false;
        for (let j = Math.max(0, i - vpCfg.pullbackLookbackBars + 1); j <= i; j++) {
          if (bars[j].l <= vwap[j] * (1 + vpCfg.tolerancePct / 100) && bars[j].l >= vwap[j] * (1 - vpCfg.maxPenetrationPct / 100)) { touched = true; break; }
        }
        const reclaim = b.c > vwap[i] && b.c > b.o && st !== null && st >= vpCfg.minCloseStrength;
        const volOk = relVol[i] !== null && relVol[i] >= vpCfg.minRelVolume && (!vpCfg.requireImprovingVolume || (relVol[i - 1] !== null && relVol[i] > relVol[i - 1]));
        const nClose = ctx.niftyByTime.get(b.time);
        const rsVal = nClose ? (b.c / ctx.stockRef - 1) * 100 - (nClose / ctx.niftyRef - 1) * 100 : null;
        const rsOk = !vpCfg.requireRsVsNifty || (rsVal !== null && rsVal > 0);
        if (vpCfg.requireRsVsNifty && rsVal === null) this.dq.flag('NIFTY_INTRADAY_MISSING_FOR_RS', `${sess.date} ${b.time}`);
        vp = fracAbove >= vpCfg.minBarsAboveVwapPct && vwapRising && touched && reclaim && volOk && rsOk;
        vpInfo = { fracAbove: round(fracAbove, 0), rsVsNiftyPct: round(rsVal) };
      }
      if (!orb && !vp) continue;

      const method = orb && vp ? 'CONFLUENCE' : orb ? 'ORB' : 'VWAP_PULLBACK';
      out.push({
        i, next, method,
        signal: {
          method, signalTime: b.time, signalClose: round(b.c), vwap: round(vwap[i]), orHigh: round(orHigh), relVolume: round(relVol[i]), closeStrength: round(st),
          reasons: [orb ? `ORB: close ${round(b.c)} > OR high ${round(orHigh)}, > VWAP, relVol ${round(relVol[i])}` : null,
            vp ? `VWAP pullback: touched VWAP zone, reclaimed with bullish close, relVol ${round(relVol[i])}, RS vs NIFTY ${vpInfo.rsVsNiftyPct}%` : null].filter(Boolean),
        },
      });
    }
    return out;
  }

  /**
   * Watch every planned candidate through the session. The earliest confirmed signal is taken to
   * the risk gate (same-bar ties: higher score first); a rejected signal lets the next one try.
   * With one candidate this is exactly the V1 single-stock entry.
   */
  evaluateEntry(plans, sess, equity, riskPct, { slots = 1, cash = Infinity } = {}) {
    const cfg = this.cfg;
    const res = { status: 'no_signal', signalsSeen: 0, rejections: [], watchlistSize: plans.length, withData: 0, dataIssues: {}, fills: [] };
    const events = [];
    let lastIssue = null;
    plans.forEach((plan, rank) => {
      const ctx = this.prepareCandidate(plan, sess);
      if (!ctx.ok) { res.dataIssues[ctx.status] = (res.dataIssues[ctx.status] || 0) + 1; lastIssue = ctx; return; }
      res.withData++;
      for (const sig of this.scanSignals(ctx, sess)) events.push({ ...sig, ctx, plan, rank });
    });
    if (!res.withData) return { ...res, status: lastIssue.status, reason: plans.length === 1 ? lastIssue.reason : `no usable intraday data for ${plans.length} watchlist stocks` };
    events.sort((a, b) => a.next.min - b.next.min || b.plan.candidate.score - a.plan.candidate.score || a.rank - b.rank);

    let cashLeft = cash;
    const taken = new Set();
    for (const ev of events) {
      if (taken.has(ev.ctx.symbol)) continue;
      res.signalsSeen++;
      const { ctx, next } = ev;
      // Risk gate (§4.2) at the next bar open
      const rawFill = next.o;
      const fill = rawFill * (1 + cfg.execution.entrySlippagePct / 100);
      const extension = (fill - ctx.breakoutLevel) / ctx.atr;
      const stopDist = cfg.risk.stopAtrMultiple * ctx.atr;
      const stop = fill - stopDist;
      const stopPct = (stopDist / fill) * 100;
      let reject = null;
      if (extension > cfg.breakout.maxEntryExtensionAtr) reject = `EXTENDED (${round(extension)} ATR above breakout level)`;
      else if (!(stop > 0) || stopPct > cfg.risk.maxStopDistancePct) reject = `STOP_TOO_WIDE (${round(stopPct)}%)`;
      let qty = 0;
      if (!reject) {
        const qtyRisk = Math.floor((equity * riskPct) / 100 / stopDist);
        const capital = Math.min((equity * cfg.account.maxAllocationPct) / 100, cashLeft);
        const qtyCap = Math.floor(capital / (fill * 1.0015));
        qty = Math.min(qtyRisk, qtyCap);
        if (qty < 1) reject = qtyRisk >= 1 ? 'NO_CASH' : 'QTY_ZERO';
      }
      if (reject) { res.rejections.push({ symbol: ctx.symbol, time: next.time, method: ev.method, reason: reject }); continue; }

      taken.add(ctx.symbol);
      cashLeft -= qty * fill * 1.0015;
      res.fills.push({
        plan: ev.plan, rank: ev.rank + 1, watchlistSize: plans.length, signal: ev.signal, k: ctx.k, priceScaleFrom: ctx.priceScaleFrom, bars: ctx.bars, fillIndex: ev.i + 1,
        fill: { time: next.time, min: next.min, rawPrice: rawFill, price: fill, qty, stop, stopPct, extensionAtr: extension, atr: ctx.atr, breakoutLevel: ctx.breakoutLevel },
      });
      if (res.fills.length >= slots) break;
    }
    if (res.fills.length) return { ...res, status: 'filled' };
    if (res.rejections.length) return { ...res, status: 'rejected', reason: res.rejections[res.rejections.length - 1].reason.split(' ')[0] };
    return res;
  }

  // ─── Costs (§4.4) ──────────────────────────────────────────────────────────

  charges(side, value, date, intraday) {
    const c = this.cfg.costs;
    let ex = c.exchangeTxnPct[0].pct;
    for (const r of c.exchangeTxnPct) if (date >= r.from) ex = r.pct;
    const brokerage = intraday ? Math.min((value * c.brokerage.intradayPct) / 100, c.brokerage.intradayMaxPerOrder) : (value * c.brokerage.deliveryPct) / 100;
    const stt = intraday ? (side === 'sell' ? (value * c.stt.intradaySellPct) / 100 : 0) : (value * (side === 'buy' ? c.stt.deliveryBuyPct : c.stt.deliverySellPct)) / 100;
    const exchange = (value * ex) / 100;
    const sebi = (value * c.sebiPerCrore) / 1e7;
    const stamp = side === 'buy' ? (value * (intraday ? c.stamp.intradayBuyPct : c.stamp.deliveryBuyPct)) / 100 : 0;
    const gst = ((brokerage + exchange + sebi) * c.gstPct) / 100;
    const dp = !intraday && side === 'sell' ? c.dpChargePerSellDay * (1 + c.gstPct / 100) : 0;
    const total = brokerage + stt + exchange + sebi + stamp + gst + dp;
    return { brokerage, stt, exchange, sebi, stamp, gst, dp, total };
  }

  // ─── Position management (§4.3) ────────────────────────────────────────────

  openPosition(book, plan, entry, market, E) {
    const f = entry.fill;
    const provisional = this.charges('buy', f.qty * f.price, E, false).total;
    book.nextId = (book.nextId || 0) + 1;
    const pos = {
      id: `${book.name}-${book.nextId}`, book: book.name, funded: book.funded,
      symbol: plan.symbol, sector: plan.sector, signalDate: plan.D, entryDate: E, entryTime: f.time,
      candidateScore: round(plan.candidate.score, 1), factors: plan.candidate.factors, marketScore: round(market.score, 1), band: market.band,
      riskPct: book.funded ? this.cfg.market.riskPctByBand[market.band] : this.cfg.market.research.shadowRiskPct,
      entryMethod: entry.signal.method, signalReasons: entry.signal.reasons, signalTime: entry.signal.signalTime,
      qty: f.qty, entryRaw: f.rawPrice, entry: f.price, atr: f.atr, breakoutLevel: f.breakoutLevel, extensionAtr: round(f.extensionAtr),
      initialStop: f.stop, stop: f.stop, pendingStop: null, trailActive: false, highest: null,
      initialRisk: f.qty * (f.price - f.stop), equityAtEntry: book.equity, positionValuePct: round((100 * f.qty * f.price) / book.equity),
      k: entry.k, priceScaleFrom: entry.priceScaleFrom, maxHigh: f.price, minLow: f.price, barsHeld: 0, sessionsHeld: 0,
      watchlistRank: entry.rank, watchlistSize: entry.watchlistSize, fundamentals: plan.candidate.fund || null,
      events: [{ time: `${E} ${f.time}`, type: 'ENTRY', price: round(f.price), stop: round(f.stop), method: entry.signal.method }],
      provisionalBuyCost: provisional, dailyFallbackDays: 0, mgmtFallbackDays: 0, mgmtDays: {}, lastPrice: f.price, lastDate: E,
    };
    book.cash -= f.qty * f.price + provisional;
    book.positions.push(pos);
    this.maxConcurrent[book.name] = Math.max(this.maxConcurrent[book.name] || 0, book.positions.length);
    return pos;
  }

  /**
   * Bars used to manage an open position on `date`, in daily price units:
   * configured management interval → 5-minute → none (caller falls back to the daily bar).
   */
  managementBars(pos, date) {
    const want = this.cfg.management.intervalMinutes;
    const base = this.cfg.data.intradayIntervalMinutes;
    for (const interval of want === base ? [base] : [want, base]) {
      const r = this.barsFor(pos.symbol, date, interval);
      if (r.status === 'not_fetched') this.intraday.require(pos.symbol, date, 'hold', this.sourceInterval(interval));
      if (r.status !== 'ok' || !r.bars.length) continue;
      if (interval !== want) { pos.mgmtFallbackDays++; this.dq.flag(`HOLD_DAY_${base}MIN_FALLBACK`, `${pos.symbol} ${date}`); }
      pos.mgmtDays[interval] = (pos.mgmtDays[interval] || 0) + 1;
      return { interval, bars: r.bars.map(b => ({ ...b, o: b.o * pos.k, h: b.h * pos.k, l: b.l * pos.k, c: b.c * pos.k })) };
    }
    return null;
  }

  /** Manage the rest of the entry day from the fill bar (the bar that starts at the fill time). */
  manageEntryDay(book, pos, entry, E) {
    const mb = this.managementBars(pos, E);
    let closed;
    if (!mb) closed = this.manageBars(book, pos, entry.bars, entry.fillIndex, E);
    else {
      const from = mb.bars.findIndex(b => b.min >= entry.fill.min);
      closed = from >= 0 ? this.manageBars(book, pos, mb.bars, from, E) : false;
    }
    if (!closed) this.checkDailyCloseExit(pos, E);
  }

  /** Walk bars (daily units) from index `from`. Returns true when the position was closed. */
  manageBars(book, pos, bars, from, date) {
    const tr = this.cfg.trailing, slip = this.cfg.execution.exitSlippagePct / 100;
    for (let j = from; j < bars.length; j++) {
      const b = bars[j];
      const isFillBar = date === pos.entryDate && j === from && pos.barsHeld === 0;
      if (pos.pendingStop !== null && pos.pendingStop > pos.stop) {
        pos.events.push({ time: `${date} ${b.time}`, type: pos.stop === pos.initialStop ? 'TRAIL_STOP_ACTIVE' : 'TRAIL_STOP_RAISED', from: round(pos.stop), to: round(pos.pendingStop) });
        pos.stop = pos.pendingStop;
      }
      pos.pendingStop = null;
      pos.barsHeld++;
      const stopKind = pos.stop > pos.initialStop ? 'TRAILING_STOP' : 'INITIAL_STOP';
      if (!isFillBar && b.o <= pos.stop) {
        pos.minLow = Math.min(pos.minLow, b.o);
        this.closePosition(book, pos, date, b.time, b.o, b.o * (1 - slip), `${stopKind}_GAP`);
        return true;
      }
      if (b.l <= pos.stop) {
        pos.minLow = Math.min(pos.minLow, pos.stop);
        this.closePosition(book, pos, date, b.time, pos.stop, pos.stop * (1 - slip), stopKind);
        return true;
      }
      pos.maxHigh = Math.max(pos.maxHigh, b.h);
      pos.minLow = Math.min(pos.minLow, b.l);
      pos.lastPrice = b.c;
      if (!pos.trailActive && b.h >= pos.entry * (1 + tr.activationPct / 100)) {
        pos.trailActive = true;
        pos.events.push({ time: `${date} ${b.time}`, type: 'TRAIL_ARMED', high: round(b.h) });
      }
      if (pos.trailActive) {
        pos.highest = Math.max(pos.highest || 0, b.h);
        const lock = Math.max(pos.initialStop, pos.entry * (1 + tr.minLockedProfitPct / 100));
        const trail = tr.mode === 'pct' ? pos.highest * (1 - tr.trailPct / 100)
          : tr.mode === 'atr' ? pos.highest - tr.trailAtrMultiple * pos.atr
          : -Infinity;                                               // 'dailyLow': decided at the close
        const candidate = Math.max(lock, trail);
        if (candidate > pos.stop) pos.pendingStop = candidate;      // effective from the next bar
      }
    }
    return false;
  }

  /** 'dailyLow' trail: after the session closes, flag an exit at the next open if the close broke the prior lows. */
  checkDailyCloseExit(pos, date) {
    const tr = this.cfg.trailing;
    if (tr.mode !== 'dailyLow' || !pos.trailActive || pos.exitAtNextOpen) return;
    const s = this.bySymbol.get(pos.symbol);
    const di = s.idx.get(date);
    if (di === undefined || di < tr.dailyLowLookback) return;
    const level = Math.min(...s.low.slice(di - tr.dailyLowLookback, di));
    if (s.close[di] < level) {
      pos.exitAtNextOpen = { signalDate: date, close: s.close[di], level };
      pos.events.push({ time: `${date} close`, type: 'DAILY_CLOSE_EXIT_SIGNAL', close: round(s.close[di]), level: round(level) });
    }
  }

  manageDay(book, pos, E) {
    const s = this.bySymbol.get(pos.symbol);
    const sess = this.sessionFor(E);
    pos.sessionsHeld++;
    const mb = this.managementBars(pos, E);
    let bars = mb ? mb.bars : [];
    if (bars.length) {
      const di = s.idx.get(E);
      if (di !== undefined) {
        const hi = Math.max(...bars.map(b => b.h)), lo = Math.min(...bars.map(b => b.l));
        const tol = this.cfg.data.priceCrossCheckTolerancePct / 100;
        if (Math.abs(hi / s.high[di] - 1) > tol || Math.abs(lo / s.low[di] - 1) > tol) this.dq.flag('INTRADAY_DAILY_PRICE_MISMATCH', `${pos.symbol} ${E} ${mb.interval}m H/L ${round(hi)}/${round(lo)} vs daily ${s.high[di]}/${s.low[di]}`);
      }
    } else {
      const di = s.idx.get(E);
      if (di === undefined) { this.dq.flag('HELD_STOCK_NO_DATA', `${pos.symbol} ${E}`); return; }
      // Conservative fallback: one daily bar (gap check on open, stop before high).
      bars = [{ time: sess.tradingStart, min: sess.startMin, o: s.open[di], h: s.high[di], l: s.low[di], c: s.close[di] }];
      pos.dailyFallbackDays++;
      this.dq.flag('HOLD_DAY_DAILY_FALLBACK', `${pos.symbol} ${E}`);
    }
    if (pos.exitAtNextOpen) {
      // Exit signalled by the previous session's close: sell at this session's first bar open.
      const b = bars[0], slip = this.cfg.execution.exitSlippagePct / 100;
      pos.barsHeld++;
      pos.minLow = Math.min(pos.minLow, b.o);
      pos.maxHigh = Math.max(pos.maxHigh, b.o);
      this.closePosition(book, pos, E, b.time, b.o, b.o * (1 - slip), 'TRAIL_DAILY_CLOSE');
      return;
    }
    if (!this.manageBars(book, pos, bars, 0, E)) { pos.lastDate = E; this.checkDailyCloseExit(pos, E); }
  }

  closePosition(book, pos, date, time, rawPrice, price, reason) {
    const sameDay = date === pos.entryDate;
    const buy = this.charges('buy', pos.qty * pos.entry, pos.entryDate, sameDay);
    const sell = this.charges('sell', pos.qty * price, date, sameDay);
    book.cash += pos.qty * price - sell.total - (buy.total - pos.provisionalBuyCost);
    const grossPnl = pos.qty * (price - pos.entry);
    const costs = buy.total + sell.total;
    const netPnl = grossPnl - costs;
    const maxUnrealized = pos.qty * (pos.maxHigh - pos.entry);
    const trade = {
      ...pos, exitDate: date, exitTime: time, exitRaw: rawPrice, exit: price, exitReason: reason, sameDay,
      grossPnl, costs, costBreakdown: Object.fromEntries(Object.keys(buy).map(kk => [kk, round(buy[kk] + sell[kk])])),
      slippageCost: pos.qty * (pos.entry - pos.entryRaw) + pos.qty * (rawPrice - price),
      netPnl, rMultiple: netPnl / pos.initialRisk, returnPct: ((price / pos.entry) - 1) * 100,
      mfePct: ((pos.maxHigh / pos.entry) - 1) * 100, maePct: ((pos.entry - pos.minLow) / pos.entry) * 100,
      mfeR: (pos.qty * (pos.maxHigh - pos.entry)) / pos.initialRisk, maeR: (pos.qty * (pos.entry - pos.minLow)) / pos.initialRisk,
      maxUnrealizedPnl: maxUnrealized, givebackPnl: Math.max(0, maxUnrealized - grossPnl),
      finalStop: pos.stop,
    };
    trade.events = [...pos.events, { time: `${date} ${time}`, type: 'EXIT', reason, price: round(price) }];
    delete trade.pendingStop;
    book.trades.push(trade);
    book.positions = book.positions.filter(p => p !== pos);
    book.lastExitDate = date;
  }

  // ─── Main loop (§5.3) ──────────────────────────────────────────────────────

  run(range) {
    const cfg = this.cfg;
    const start = range.from || cfg.period.start, end = range.to || cfg.period.end;
    const days = this.calendar.filter(d => d >= start && d <= end);
    if (!days.length) throw new Error(`No trading days between ${start} and ${end}`);
    const firstIdx = this.calendar.indexOf(days[0]);
    if (firstIdx < 1) throw new Error('Backtest start needs at least one prior session');

    const funded = { name: 'funded', funded: true, cash: cfg.account.initialEquity, equity: cfg.account.initialEquity, positions: [], trades: [] };
    const shadow = { name: 'shadow', funded: false, cash: 0, equity: 0, positions: [], trades: [] };
    const maxOpen = cfg.account.maxOpenPositions;
    this.maxConcurrent = {};
    this.openCountDays = {};
    this.scans = [];
    this.equityCurve = [];
    this.marketBandDays = { favorable: 0, cautious: 0, research: 0, blocked: 0 };
    const decisionCounts = {};
    const qualifiedCounts = [];
    const excludedTotals = {};

    const loadedMonthsSeen = new Set();
    for (const E of days) {
      const D = this.calendar[this.calIdx.get(E) - 1];
      const sess = this.sessionFor(E);
      // Keep two months of parsed intraday data (enough for the 20-session volume baseline).
      if (!loadedMonthsSeen.has(E.slice(0, 7))) {
        loadedMonthsSeen.add(E.slice(0, 7));
        const keep = this.calendar[Math.max(0, this.calIdx.get(E) - this.cfg.data.volumeBaselineSessions * 2 - 5)];
        const openSince = [...funded.positions, ...shadow.positions].map(p => p.entryDate).sort()[0];
        this.releaseIntradayBefore(openSince && openSince < keep ? openSince : keep);
      }
      // Free slots are counted before the session (pre-market decision); a position closed
      // intraday does not free a slot until the next session.
      const fundedSlots = maxOpen - funded.positions.length, shadowSlots = maxOpen - shadow.positions.length;
      const heldFunded = new Set(funded.positions.map(p => p.symbol));
      const heldShadow = new Set(shadow.positions.map(p => p.symbol));
      const openAtStart = funded.positions.map(p => p.symbol);

      for (const book of [funded, shadow]) for (const pos of [...book.positions]) this.manageDay(book, pos, E);

      const scan = this.scanStocks(D);
      for (const [k, v] of Object.entries(scan.excluded)) excludedTotals[k] = (excludedTotals[k] || 0) + v;
      qualifiedCounts.push(scan.qualified.length);
      const market = this.marketScore(E, D, sess, scan.top ? scan.top.sector : null);
      this.marketBandDays[market.band]++;
      if (market.missing.length) this.dq.flag(`MARKET_COMPONENT_MISSING:${market.missing.join('+')}`);

      const rec = {
        date: E, signalDate: D, session: sess.label,
        marketScore: round(market.score, 1), domesticScore: round(market.domesticScore, 1), band: market.band,
        gate: market.gate ? `${market.gate.type}: ${market.gate.reason}` : '', missing: market.missing.join('+'), missingWeightPct: round(market.missingPct, 1),
        components: Object.fromEntries(Object.entries(market.components).map(([k, c]) => [k, c.available ? round(c.score, 1) : null])),
        eligible: scan.eligible.length, qualified: scan.qualified.length,
        topSymbol: scan.top ? scan.top.symbol : '', topScore: scan.top ? round(scan.top.score, 1) : null,
        bestSymbol: scan.best ? scan.best.symbol : '', bestScore: scan.best ? round(scan.best.score, 1) : null,
        watchlist: 0, watchSymbols: '', openAtStart: '', fundDropped: '', watchWithData: null, signals: null, enteredSymbol: '', enteredRank: null,
        decision: '', detail: '', entryMethod: '',
      };

      // Candidates to watch on E, rebuilt every session from that morning's scan:
      // the top stock only (V1) or the top-N qualified stocks not already held (watchlist).
      const sel = cfg.selection;
      const plansFor = held => {
        const notHeld = scan.qualified.filter(c => !held.has(c.symbol));
        const picked = sel.mode === 'watchlist' ? notHeld.slice(0, sel.maxWatchlist || notHeld.length)
          : scan.top && !held.has(scan.top.symbol) ? [scan.top] : [];
        // entryCheck: the watchlist stays the technical top-N; names failing fundamentals are not bought.
        return picked.filter(c => !c.fundBlock).map(c => ({ symbol: c.symbol, sector: c.sector, D, E, candidate: c }));
      };
      const plans = plansFor(heldFunded);
      const plan = plans[0] || null;
      rec.watchlist = plans.length;
      if (cfg.fundamentals.enabled && cfg.fundamentals.mode === 'entryCheck') {
        const top = scan.qualified.filter(c => !heldFunded.has(c.symbol)).slice(0, sel.mode === 'watchlist' ? sel.maxWatchlist || Infinity : 1);
        rec.fundDropped = top.filter(c => c.fundBlock).map(c => c.symbol).join(' ');
      }
      rec.watchSymbols = plans.map(p => `${p.symbol}:${round(p.candidate.score, 1)}`).join(' ');
      rec.openAtStart = openAtStart.join(' ');
      const decide = (code, detail = '') => { rec.decision = code; rec.detail = detail; decisionCounts[code] = (decisionCounts[code] || 0) + 1; };
      const label = plans.length > 1 ? `${plans.length} watched (top ${plan.symbol})` : plan ? plan.symbol : '';
      const noteEntry = entry => { rec.watchWithData = entry.withData; rec.signals = entry.signalsSeen; };

      if (fundedSlots <= 0) decide('POSITION_OPEN', `${openAtStart.join(', ')} (max ${maxOpen} open)`);
      else if (market.gate && market.gate.type === 'DATA_QUALITY') decide('NO_TRADE_DATA_QUALITY', market.gate.reason);
      else if (market.gate) decide('NO_TRADE_HARD_GATE', market.gate.reason);
      else if (market.band === 'blocked') decide('NO_TRADE_MARKET_GATE', `score ${round(market.score, 1)} < ${cfg.market.bands.research}`);
      else if (!plan) decide('NO_TRADE_NO_QUALIFIED_STOCK', scan.best ? `best ${scan.best.symbol} ${round(scan.best.score, 1)}` : 'no eligible stock');
      else if (market.band === 'research') decide('RESEARCH_ONLY', `${label} ${round(plan.candidate.score, 1)} → shadow ledger`);
      else if (!sess.allowNewEntries) decide('NO_TRADE_SESSION', sess.label);
      else {
        const riskPct = cfg.market.riskPctByBand[market.band];
        const entry = this.evaluateEntry(plans, sess, funded.equity, riskPct, { slots: fundedSlots, cash: funded.cash });
        noteEntry(entry);
        if (entry.status === 'filled') {
          for (const f of entry.fills) {
            const pos = this.openPosition(funded, f.plan, f, market, E);
            this.manageEntryDay(funded, pos, f, E);
          }
          rec.entryMethod = entry.fills.map(f => f.signal.method).join(' ');
          rec.enteredSymbol = entry.fills.map(f => f.plan.symbol).join(' ');
          rec.enteredRank = entry.fills.map(f => f.rank).join(' ');
          decide('ENTERED', entry.fills.map(f => `${f.plan.symbol} (rank ${f.rank}/${plans.length}) ${f.signal.method} @ ${f.fill.time} ${round(f.fill.price)}`).join(' + ')
            + (openAtStart.length ? ` | already open: ${openAtStart.join(', ')}` : ''));
        } else if (entry.status === 'data_missing' || entry.status === 'session_invalid') decide('NO_TRADE_INTRADAY_DATA', `${label}: ${entry.reason}`);
        else if (entry.status === 'rejected') decide('NO_TRADE_RISK_GATE', `${label}: ${entry.reason} (${entry.signalsSeen} signal(s))`);
        else decide('NO_TRADE_NO_ENTRY_SIGNAL', `${label} waited until ${sess.tradeCutoff}`);
      }

      // Research-only bucket → shadow ledger (never touches funded equity)
      const shadowPlans = plansFor(heldShadow);
      if (cfg.market.research.simulateShadowTrades && shadowSlots > 0 && market.band === 'research' && shadowPlans.length && sess.allowNewEntries) {
        shadow.equity = funded.equity;
        const shadowCash = funded.equity - sum(shadow.positions.map(p => p.qty * p.entry));
        const entry = this.evaluateEntry(shadowPlans, sess, funded.equity, cfg.market.research.shadowRiskPct, { slots: shadowSlots, cash: shadowCash });
        noteEntry(entry);
        if (entry.status === 'filled') {
          shadow.cash = 0;
          for (const f of entry.fills) {
            const pos = this.openPosition(shadow, f.plan, f, market, E);
            this.manageEntryDay(shadow, pos, f, E);
          }
          rec.detail += ` | shadow ENTERED ${entry.fills.map(f => `${f.plan.symbol} ${f.signal.method}`).join(' + ')}`;
        } else rec.detail += ` | shadow ${entry.status}`;
      }

      // End-of-day mark-to-market
      let posValue = 0;
      for (const p of funded.positions) {
        const di = this.bySymbol.get(p.symbol).idx.get(E);
        if (p.lastDate !== E && di !== undefined) p.lastPrice = this.bySymbol.get(p.symbol).close[di];
        posValue += p.qty * p.lastPrice;
      }
      funded.equity = funded.cash + posValue;
      this.openCountDays[funded.positions.length] = (this.openCountDays[funded.positions.length] || 0) + 1;
      this.equityCurve.push({ date: E, equity: funded.equity, cash: funded.cash, positionValue: posValue, openPositions: funded.positions.length, symbol: funded.positions.map(p => p.symbol).join(' '), marketBand: market.band });
      this.scans.push(rec);
    }

    // Close anything still open at the end of the test window (paper trading keeps them open)
    const lastDay = days[days.length - 1];
    for (const book of range.keepOpen ? [] : [funded, shadow]) {
      for (const p of [...book.positions]) {
        const slip = cfg.execution.exitSlippagePct / 100;
        this.closePosition(book, p, lastDay, cfg.session.normal.tradingEnd, p.lastPrice, p.lastPrice * (1 - slip), 'END_OF_BACKTEST');
      }
    }
    if (this.equityCurve.length && !range.keepOpen) {
      const last = this.equityCurve[this.equityCurve.length - 1];
      last.equity = funded.cash; last.cash = funded.cash; last.positionValue = 0;
    }

    this.funded = funded; this.shadow = shadow;
    this.range = { start: days[0], end: lastDay, sessions: days.length };
    this.decisionCounts = decisionCounts;
    this.qualifiedCounts = qualifiedCounts;
    this.excludedTotals = excludedTotals;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. METRICS
// ════════════════════════════════════════════════════════════════════════════

function tradeStats(trades) {
  const n = trades.length;
  if (!n) return { trades: 0 };
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl <= 0);
  const grossWin = sum(trades.filter(t => t.grossPnl > 0).map(t => t.grossPnl));
  const grossLoss = -sum(trades.filter(t => t.grossPnl < 0).map(t => t.grossPnl));
  const netWin = sum(wins.map(t => t.netPnl)), netLoss = -sum(losses.map(t => t.netPnl));
  const avgWinR = wins.length ? mean(wins.map(t => t.rMultiple)) : null;
  const avgLossR = losses.length ? mean(losses.map(t => t.rMultiple)) : null;
  let streakW = 0, streakL = 0, maxW = 0, maxL = 0;
  for (const t of trades) {
    if (t.netPnl > 0) { streakW++; streakL = 0; } else { streakL++; streakW = 0; }
    maxW = Math.max(maxW, streakW); maxL = Math.max(maxL, streakL);
  }
  return {
    trades: n, wins: wins.length, losses: losses.length, winRatePct: round((100 * wins.length) / n, 1),
    netPnl: round(sum(trades.map(t => t.netPnl))), grossPnl: round(sum(trades.map(t => t.grossPnl))),
    costs: round(sum(trades.map(t => t.costs))), slippage: round(sum(trades.map(t => t.slippageCost))),
    profitFactorNet: netLoss > 0 ? round(netWin / netLoss) : null, profitFactorGross: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    expectancy: round(mean(trades.map(t => t.netPnl))), avgR: round(mean(trades.map(t => t.rMultiple)), 3),
    avgWin: wins.length ? round(mean(wins.map(t => t.netPnl))) : null, avgLoss: losses.length ? round(mean(losses.map(t => t.netPnl))) : null,
    avgWinR: round(avgWinR, 3), avgLossR: round(avgLossR, 3), payoffRatio: avgWinR !== null && avgLossR ? round(avgWinR / Math.abs(avgLossR)) : null,
    bestR: round(Math.max(...trades.map(t => t.rMultiple)), 2), worstR: round(Math.min(...trades.map(t => t.rMultiple)), 2),
    avgReturnPct: round(mean(trades.map(t => t.returnPct))),
    avgMfePct: round(mean(trades.map(t => t.mfePct))), avgMaePct: round(mean(trades.map(t => t.maePct))),
    avgMfeR: round(mean(trades.map(t => t.mfeR))), avgMaeR: round(mean(trades.map(t => t.maeR))),
    avgGivebackPnl: round(mean(trades.map(t => t.givebackPnl))),
    avgBarsHeld: round(mean(trades.map(t => t.barsHeld)), 1), avgSessionsHeld: round(mean(trades.map(t => t.sessionsHeld + 1)), 1),
    maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL,
  };
}

function equityStats(curve, initial) {
  let peak = initial, maxDd = 0, maxDdAmt = 0, peakDate = curve[0] && curve[0].date, ddFrom = null, ddTo = null;
  for (const p of curve) {
    if (p.equity > peak) { peak = p.equity; peakDate = p.date; }
    const dd = (peak - p.equity) / peak;
    p.drawdownPct = round(dd * 100, 2);
    if (dd > maxDd) { maxDd = dd; maxDdAmt = peak - p.equity; ddFrom = peakDate; ddTo = p.date; }
  }
  const end = curve.length ? curve[curve.length - 1].equity : initial;
  const years = curve.length ? calendarDaysBetween(curve[0].date, curve[curve.length - 1].date) / 365.25 : 0;
  const exposureDays = curve.filter(p => p.positionValue > 0).length;
  return {
    initialEquity: initial, endingEquity: round(end), netPnl: round(end - initial), returnPct: round((end / initial - 1) * 100),
    cagrPct: years > 0 ? round(((end / initial) ** (1 / years) - 1) * 100) : null,
    maxDrawdownPct: round(maxDd * 100), maxDrawdownAmount: round(maxDdAmt), maxDrawdownPeak: ddFrom, maxDrawdownTrough: ddTo,
    exposurePct: curve.length ? round((100 * exposureDays) / curve.length, 1) : 0,
    avgPositionValuePctWhenExposed: exposureDays ? round(mean(curve.filter(p => p.positionValue > 0).map(p => (100 * p.positionValue) / p.equity)), 1) : null,
  };
}

function periodReturns(curve, initial, keyLen) {
  const out = [];
  let prevEnd = initial, cur = null;
  for (const p of curve) {
    const key = p.date.slice(0, keyLen);
    if (!cur || cur.period !== key) {
      if (cur) { cur.returnPct = round((cur.endEquity / prevEnd - 1) * 100); prevEnd = cur.endEquity; out.push(cur); }
      cur = { period: key, startEquity: prevEnd, endEquity: p.equity };
    }
    cur.endEquity = p.equity;
  }
  if (cur) { cur.returnPct = round((cur.endEquity / prevEnd - 1) * 100); out.push(cur); }
  return out.map(x => ({ ...x, startEquity: round(x.startEquity), endEquity: round(x.endEquity) }));
}

function groupStats(trades, keyFn) {
  const groups = {};
  for (const t of trades) (groups[keyFn(t)] = groups[keyFn(t)] || []).push(t);
  return Object.fromEntries(Object.entries(groups).sort().map(([k, v]) => [k, tradeStats(v)]));
}

function concentration(trades) {
  const positive = trades.filter(t => t.netPnl > 0);
  const totalPos = sum(positive.map(t => t.netPnl));
  const top = (keyFn) => {
    const m = {};
    for (const t of positive) m[keyFn(t)] = (m[keyFn(t)] || 0) + t.netPnl;
    const [k, v] = Object.entries(m).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    return { key: k, shareOfGrossWinsPct: totalPos ? round((100 * v) / totalPos, 1) : null };
  };
  return { topSymbol: top(t => t.symbol), topMonth: top(t => t.exitDate.slice(0, 7)), topTrade: top(t => t.id) };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. REPORTING
// ════════════════════════════════════════════════════════════════════════════

function toCsv(rows, columns) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(round(v, 4)) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map(r => columns.map(c => esc(typeof c === 'function' ? c(r) : r[c])).join(','))].join('\n') + '\n';
}

const TRADE_COLUMNS = ['id', 'symbol', 'sector', 'signalDate', 'entryDate', 'entryTime', 'exitDate', 'exitTime', 'candidateScore', 'marketScore', 'band', 'riskPct',
  'entryMethod', 'entryRaw', 'entry', 'exitRaw', 'exit', 'qty', 'initialStop', 'finalStop', 'initialRisk', 'grossPnl', 'costs', 'slippageCost', 'netPnl', 'rMultiple', 'returnPct',
  'exitReason', 'sameDay', 'mfePct', 'maePct', 'mfeR', 'maeR', 'maxUnrealizedPnl', 'givebackPnl', 'barsHeld', 'sessionsHeld', 'positionValuePct', 'extensionAtr',
  'watchlistRank', 'watchlistSize', 'mgmtFallbackDays', 'dailyFallbackDays'];

function fmt(n, d = 2) { return n === null || n === undefined ? '—' : typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : String(n); }

function statsTable(groups) {
  const rows = Object.entries(groups);
  if (!rows.length) return '_No trades._\n';
  return ['| Group | Trades | Win % | Net P&L ₹ | PF (net) | Avg R | Avg win R | Avg loss R |', '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(([k, s]) => `| ${k} | ${s.trades} | ${fmt(s.winRatePct, 1)} | ${fmt(s.netPnl, 0)} | ${fmt(s.profitFactorNet)} | ${fmt(s.avgR, 3)} | ${fmt(s.avgWinR, 2)} | ${fmt(s.avgLossR, 2)} |`)].join('\n') + '\n';
}

function buildMarkdown(r) {
  const s = r.summary, t = s.trades, e = s.equity;
  const lines = [];
  lines.push(`# ${r.run.strategy.name} — backtest report`, '');
  lines.push(`Experiment **${r.run.strategy.experimentId}** (strategy v${r.run.strategy.version}), config hash \`${r.run.configHash}\`, run ${r.run.runAt}.`);
  lines.push(`Period ${r.run.range.start} → ${r.run.range.end} (${r.run.range.sessions} sessions). Universe: ${r.run.universe.version} (${r.run.universe.loaded} stocks loaded, point-in-time: ${r.run.universe.pointInTime}).`, '');
  const cfgR = r.run.config;
  lines.push(`Daily data: **${cfgR.data.source}**. Selection: **${cfgR.selection.mode}** (score ≥ ${cfgR.stockScore.minScore}${cfgR.selection.mode === 'watchlist' ? `, max ${cfgR.selection.maxWatchlist || 'all'} watched, rebuilt every session` : ''}). Max open positions: **${cfgR.account.maxOpenPositions}**. Entry confirmation: **${cfgR.entry.confirmationIntervalMinutes}-minute** bars. Stop management: **${cfgR.management.intervalMinutes}-minute** bars.`, '');
  if (cfgR.fundamentals.enabled) {
    const ff = cfgR.fundamentals.filter, fs_ = r.run.fundamentals;
    lines.push(`Fundamentals gate (Upstox yearly data, public ${cfgR.fundamentals.annualLagDays} days after year-end): profit > 0${ff.minRevenueGrowthPct != null ? `, revenue growth ≥ ${ff.minRevenueGrowthPct}%` : ''}${ff.minProfitGrowthPct != null ? `, profit growth ≥ ${ff.minProfitGrowthPct}%` : ''}${ff.minRoePct != null ? `, ROE ≥ ${ff.minRoePct}%` : ''}. ${fs_.stocksWithData} stocks with data, snapshot ${fs_.snapshotDates.join(', ')}.`, '');
  }
  const pd = r.diagnostics.positions;
  lines.push(`Sessions ending with 0 / 1 / 2 open positions: ${[0, 1, 2].map(n => pd.sessionsByOpenCount[n] || 0).join(' / ')} (max seen ${pd.maxConcurrentSeen}).`, '');
  lines.push('## Summary', '');
  lines.push('| Metric | Value |', '|---|---:|');
  const rows = [
    ['Initial equity ₹', fmt(e.initialEquity, 0)], ['Ending equity ₹', fmt(e.endingEquity, 0)], ['Net P&L ₹', fmt(e.netPnl, 0)],
    ['Return %', fmt(e.returnPct)], ['CAGR %', fmt(e.cagrPct)], ['Max drawdown %', `${fmt(e.maxDrawdownPct)} (${e.maxDrawdownPeak} → ${e.maxDrawdownTrough})`],
    ['Trades', fmt(t.trades)], ['Win rate %', fmt(t.winRatePct, 1)], ['Profit factor (net / gross)', `${fmt(t.profitFactorNet)} / ${fmt(t.profitFactorGross)}`],
    ['Expectancy ₹ / trade', fmt(t.expectancy, 0)], ['Average R', fmt(t.avgR, 3)], ['Avg win R / avg loss R', `${fmt(t.avgWinR)} / ${fmt(t.avgLossR)}`],
    ['Payoff ratio', fmt(t.payoffRatio)], ['Costs ₹ (charges)', fmt(t.costs, 0)], ['Slippage ₹', fmt(t.slippage, 0)],
    ['Exposure (% sessions in a position)', fmt(e.exposurePct, 1)], ['Avg position size % equity', fmt(e.avgPositionValuePctWhenExposed, 1)],
    ['Max consecutive wins / losses', `${fmt(t.maxConsecutiveWins)} / ${fmt(t.maxConsecutiveLosses)}`],
    ['Avg MFE % / MAE %', `${fmt(t.avgMfePct)} / ${fmt(t.avgMaePct)}`], ['Avg sessions held', fmt(t.avgSessionsHeld, 1)],
  ];
  for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
  lines.push('', '## Research targets (§6.3)', '');
  for (const c of r.targets) lines.push(`- ${c.pass === null ? '➖' : c.pass ? '✅' : '❌'} ${c.label}: ${c.value}`);
  lines.push('', '## Chronological segments', '', statsTable(r.breakdowns.bySegment));
  lines.push('## Entry method (ORB / VWAP pullback / confluence)', '', statsTable(r.breakdowns.byEntryMethod));
  if (cfgR.selection.mode === 'watchlist') {
    const w = r.diagnostics.watchlist;
    lines.push('## Watchlist', '', `Sessions with a watchlist: ${w.sessions}. Watchlist size median ${fmt(w.medianSize)}, max ${fmt(w.maxSize)}; stocks with usable intraday data per session median ${fmt(w.medianWithData)}.`, '');
    lines.push('Entered stock by its score rank in that day\'s watchlist:', '', statsTable(r.breakdowns.byWatchlistRank));
  }
  lines.push('## Market regime', '', '_Funded trades by band; research-only (50–59) trades come from the shadow ledger and never touch equity._', '');
  lines.push(statsTable({ ...r.breakdowns.byBand, ...(r.shadow.stats.trades ? { 'research (shadow)': r.shadow.stats } : {}) }));
  lines.push('## Exit reasons', '', statsTable(r.breakdowns.byExitReason));
  lines.push('## Yearly', '', '| Year | Return % | Start ₹ | End ₹ |', '|---|---:|---:|---:|', ...r.periods.yearly.map(y => `| ${y.period} | ${fmt(y.returnPct)} | ${fmt(y.startEquity, 0)} | ${fmt(y.endEquity, 0)} |`), '');
  lines.push('## Concentration', '');
  const c = r.concentration;
  lines.push(`- Top symbol ${c.topSymbol.key}: ${fmt(c.topSymbol.shareOfGrossWinsPct, 1)}% of winning P&L`, `- Top month ${c.topMonth.key}: ${fmt(c.topMonth.shareOfGrossWinsPct, 1)}% of winning P&L`, `- Top trade ${c.topTrade.key}: ${fmt(c.topTrade.shareOfGrossWinsPct, 1)}% of winning P&L`, '');
  lines.push('## Decisions per session', '', '| Decision | Sessions |', '|---|---:|', ...Object.entries(r.diagnostics.decisions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '');
  lines.push('## Market score bands (sessions)', '', '| Band | Sessions |', '|---|---:|', ...Object.entries(r.diagnostics.marketBands).map(([k, v]) => `| ${k} | ${v} |`), '');
  lines.push(`Qualified candidates (score ≥ ${r.run.config.stockScore.minScore}) per session: mean ${fmt(r.diagnostics.qualifiedPerSession.mean)}, median ${fmt(r.diagnostics.qualifiedPerSession.median)}, sessions with ≥1: ${r.diagnostics.qualifiedPerSession.sessionsWithAny}.`, '');
  lines.push('## Trade ledger', '', '| # | Symbol | Entry | Method | Score | Mkt | Entry ₹ | Exit | Exit ₹ | Reason | Net ₹ | R |', '|---:|---|---|---|---:|---:|---:|---|---:|---|---:|---:|');
  r.trades.forEach((tr, i) => lines.push(`| ${i + 1} | ${tr.symbol} | ${tr.entryDate} ${tr.entryTime} | ${tr.entryMethod} | ${fmt(tr.candidateScore, 1)} | ${fmt(tr.marketScore, 1)} | ${fmt(tr.entry)} | ${tr.exitDate} ${tr.exitTime} | ${fmt(tr.exit)} | ${tr.exitReason} | ${fmt(tr.netPnl, 0)} | ${fmt(tr.rMultiple)} |`));
  lines.push('', '## Data quality and limitations', '');
  for (const n of r.limitations) lines.push(`- ${n}`);
  lines.push('', '| Flag | Count |', '|---|---:|', ...Object.entries(r.diagnostics.dataQuality.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '');
  lines.push('## Interpretations applied to the frozen spec', '');
  for (const n of r.run.config.notes) lines.push(`- ${n}`);
  lines.push('', 'Historical results are research evidence, not a forecast or a live-trading instruction.', '');
  return lines.join('\n');
}

function writeReports(bt, outDir, runMeta) {
  const cfg = bt.cfg;
  const trades = bt.funded.trades;
  const tStats = tradeStats(trades);
  const eStats = equityStats(bt.equityCurve, cfg.account.initialEquity);
  const segmentOf = d => (cfg.period.segments.find(s => d >= s.from && d <= s.to) || { name: 'outside-segments' }).name;
  const breakdowns = {
    bySegment: groupStats(trades, t => segmentOf(t.entryDate)),
    byEntryMethod: groupStats(trades, t => t.entryMethod),
    byWatchlistRank: groupStats(trades, t => (t.watchlistRank === 1 ? 'rank 1' : t.watchlistRank <= 5 ? 'rank 2–5' : t.watchlistRank <= 10 ? 'rank 6–10' : 'rank 11+')),
    byBand: groupStats(trades, t => t.band),
    byExitReason: groupStats(trades, t => t.exitReason),
    byYear: groupStats(trades, t => t.exitDate.slice(0, 4)),
    byMonth: groupStats(trades, t => t.exitDate.slice(0, 7)),
    bySymbol: groupStats(trades, t => t.symbol),
    bySector: groupStats(trades, t => t.sector),
  };
  const qc = bt.qualifiedCounts;
  const diagnostics = {
    decisions: bt.decisionCounts,
    marketBands: bt.marketBandDays,
    qualifiedPerSession: { mean: round(mean(qc)), median: median(qc), max: Math.max(...qc), sessionsWithAny: qc.filter(x => x > 0).length },
    stockExclusionsSummed: bt.excludedTotals,
    entrySignals: {
      fundedEntriesByMethod: Object.fromEntries(Object.entries(breakdowns.byEntryMethod).map(([k, v]) => [k, v.trades])),
      riskGateRejections: bt.scans.filter(s => s.decision === 'NO_TRADE_RISK_GATE').map(s => `${s.date} ${s.detail}`),
    },
    dataQuality: bt.dq,
    intradayRequirementsOutstanding: bt.intraday.requirements.size,
    watchlist: (() => {
      const w = bt.scans.filter(s => s.watchWithData !== null && s.watchWithData !== undefined);
      return { sessions: w.length, medianSize: median(w.map(s => s.watchlist)), maxSize: w.length ? Math.max(...w.map(s => s.watchlist)) : null, medianWithData: median(w.map(s => s.watchWithData)) };
    })(),
    positions: { maxOpenPositions: cfg.account.maxOpenPositions, maxConcurrentSeen: bt.maxConcurrent.funded || 0, sessionsByOpenCount: bt.openCountDays },
    management: {
      intervalMinutes: cfg.management.intervalMinutes,
      sessionsByBarInterval: trades.reduce((acc, t) => { for (const [k, v] of Object.entries(t.mgmtDays || {})) acc[`${k}m`] = (acc[`${k}m`] || 0) + v; return acc; }, {}),
      fallbackSessions: sum(trades.map(t => t.mgmtFallbackDays || 0)), dailyFallbackSessions: sum(trades.map(t => t.dailyFallbackDays || 0)),
    },
  };
  const targets = [
    { label: 'Net expectancy positive', value: `${fmt(tStats.avgR, 3)} R / trade`, pass: tStats.trades ? tStats.avgR > 0 : null },
    { label: 'Profit factor after costs > 1.5', value: fmt(tStats.profitFactorNet), pass: tStats.profitFactorNet === null ? null : tStats.profitFactorNet > 1.5 },
    { label: 'Average reward-to-risk (avg win R / |avg loss R|) > 1.5', value: fmt(tStats.payoffRatio), pass: tStats.payoffRatio === null ? null : tStats.payoffRatio > 1.5 },
    { label: 'Test segment expectancy positive (out of sample)', value: breakdowns.bySegment.test ? `${fmt(breakdowns.bySegment.test.avgR, 3)} R over ${breakdowns.bySegment.test.trades} trades` : 'no trades', pass: breakdowns.bySegment.test ? breakdowns.bySegment.test.avgR > 0 : null },
    { label: 'Max drawdown (judge against your tolerance)', value: `${fmt(eStats.maxDrawdownPct)}%`, pass: null },
    { label: 'Not dominated by one stock (top symbol < 30% of winning P&L)', value: `${fmt(concentration(trades).topSymbol.shareOfGrossWinsPct, 1)}%`, pass: tStats.trades ? concentration(trades).topSymbol.shareOfGrossWinsPct < 30 : null },
  ];
  const limitations = [
    `Universe is today's NIFTY 500 list (${bt.universe.version}) applied to every past date — survivorship bias inflates results.`,
    'GIFT NIFTY (8% weight) has no free history; the component is reported missing on every session and its weight is removed (policy: reweight).',
    'Sector strength uses equal-weighted composites of NIFTY 500 constituents by NSE industry rather than official sector indices.',
    'Daily prices are split/bonus-adjusted, not dividend-adjusted. 5-minute prices are rescaled to daily units per trade.',
    '5-minute bars cannot reproduce order-book depth, queue position, partial fills or the true intrabar path; stop-first sequencing is assumed.',
    bt.intraday.requirements.size ? `${bt.intraday.requirements.size} intraday symbol-days were not available locally (see intraday-requirements.json). Re-run the fetcher, then the backtest.` : 'All required intraday data was available locally.',
  ];
  const shadowStats = tradeStats(bt.shadow.trades);
  const report = {
    run: runMeta,
    summary: { trades: tStats, equity: eStats },
    targets, breakdowns, periods: { monthly: periodReturns(bt.equityCurve, cfg.account.initialEquity, 7), yearly: periodReturns(bt.equityCurve, cfg.account.initialEquity, 4) },
    concentration: concentration(trades), diagnostics, limitations,
    shadow: { note: 'Research-only band (50–59) trades. Notional sizing at 1% risk of funded equity; no effect on equity.', stats: shadowStats },
    trades,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const w = (f, content) => fs.writeFileSync(path.join(outDir, f), content);
  w('run.json', JSON.stringify(runMeta, null, 2));
  w('summary.json', JSON.stringify({ run: { experimentId: runMeta.strategy.experimentId, configHash: runMeta.configHash, range: runMeta.range }, ...report.summary, targets, breakdowns: { bySegment: breakdowns.bySegment, byEntryMethod: breakdowns.byEntryMethod, byBand: breakdowns.byBand, byExitReason: breakdowns.byExitReason, byYear: breakdowns.byYear }, shadow: report.shadow, concentration: report.concentration }, null, 2));
  w('breakdowns.json', JSON.stringify({ ...breakdowns, periods: report.periods }, null, 2));
  w('diagnostics.json', JSON.stringify(diagnostics, null, 2));
  w('trades.json', JSON.stringify(trades, null, 2));
  w('trades.csv', toCsv(trades, TRADE_COLUMNS));
  w('shadow-trades.csv', toCsv(bt.shadow.trades, TRADE_COLUMNS));
  w('equity.csv', toCsv(bt.equityCurve, ['date', 'equity', 'cash', 'positionValue', 'openPositions', 'drawdownPct', 'symbol', 'marketBand']));
  const compKeys = Object.keys(cfg.market.weights).map(k => `c_${k}`);
  const scanRows = bt.scans.map(r => ({ ...r, ...Object.fromEntries(Object.entries(r.components).map(([k, v]) => [`c_${k}`, v])) }));
  w('scans.csv', toCsv(scanRows, ['date', 'signalDate', 'session', 'marketScore', 'domesticScore', 'band', 'gate', 'missing', 'missingWeightPct',
    ...compKeys, 'eligible', 'qualified', 'topSymbol', 'topScore', 'bestSymbol', 'bestScore', 'openAtStart', 'watchlist', 'watchWithData', 'signals',
    'decision', 'enteredSymbol', 'enteredRank', 'entryMethod', 'watchSymbols', 'fundDropped', 'detail']));
  w('intraday-requirements.json', JSON.stringify({ generatedAt: runMeta.runAt, items: [...bt.intraday.requirements.values()] }, null, 2));
  w('report.md', buildMarkdown(report));
  return report;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. MAIN
// ════════════════════════════════════════════════════════════════════════════

/** Everything that changes results. Labels, run window, data path and notes are excluded. */
function strategyPart(cfg) {
  const { strategy, period, notes, ...rest } = deepClone(cfg);
  delete rest.data.dir; delete rest.data.source; delete rest.data.mongo;
  return rest;
}

/** V1 baseline merged with an overrides file; refuses changed strategy parameters under the V1 id. */
function loadConfig(configPath) {
  let cfg = deepClone(V1_CONFIG);
  if (!configPath) return cfg;
  cfg = deepMerge(cfg, readJson(path.resolve(configPath)));
  if (hashOf(strategyPart(cfg)) !== hashOf(strategyPart(V1_CONFIG)) && cfg.strategy.experimentId === V1_CONFIG.strategy.experimentId) {
    throw new Error('Config overrides change the frozen V1 strategy. Set strategy.experimentId (e.g. "V1.1-<change>") in the overrides file.');
  }
  return cfg;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config);
  const t0 = Date.now();
  if (args.source) cfg.data.source = args.source;
  const bt = new SwingBacktest(cfg, { quiet: args.quiet });
  await bt.load();
  bt.run({ from: args.from, to: args.to });

  const runAt = new Date().toISOString();
  const runMeta = {
    strategy: cfg.strategy, configHash: hashOf(strategyPart(cfg)), runAt, script: 'swing/backtest-swing.js', node: process.version,
    range: bt.range, segments: cfg.period.segments,
    universe: { version: bt.universe.version, source: bt.universe.source, pointInTime: bt.universe.pointInTime, ...bt.universeStats },
    dataCoverage: {
      calendarFirst: bt.calendar[0], calendarLast: bt.calendar[bt.calendar.length - 1],
      firstStockCandle: bt.stocks.reduce((m, s) => (s.dates[0] < m ? s.dates[0] : m), '9999'),
      intradayMonthFilesLoaded: { '1m': bt.intraday.monthsLoaded(1), '5m': bt.intraday.monthsLoaded(5) },
    },
    dataSources: cfg.data.source === 'mongo'
      ? { stocksDaily: `MongoDB ${cfg.data.mongo.db}.${cfg.data.mongo.stocksCollection} (read-only)`, indicesDaily: `MongoDB ${cfg.data.mongo.db}.${cfg.data.mongo.indexCollection} (loaded from Upstox v3 + Yahoo)`, intraday: 'Upstox v3 historical candles, cached under data/swing/intraday1 and intraday5', giftNifty: bt.gift ? 'local file' : 'not available', mongo: bt.mongoStats }
      : { stocks: 'Upstox v3 historical candles (daily + intraday)', indianIndices: 'Upstox v3 (NIFTY 50, NIFTY BANK, INDIA VIX)', global: 'Yahoo Finance chart API (S&P 500, Nasdaq, Nikkei 225, Hang Seng, KOSPI)', giftNifty: bt.gift ? 'local file' : 'not available' },
    costsAndSlippage: { costs: cfg.costs, execution: cfg.execution },
    fundamentals: cfg.fundamentals.enabled ? { source: 'Upstox v2 fundamentals (yearly income statement + balance sheet)', ...bt.fundStats, filter: cfg.fundamentals.filter, annualLagDays: cfg.fundamentals.annualLagDays } : { enabled: false },
    config: cfg,
  };
  const outDir = path.resolve(args.out || path.join(bt.dataDir, 'reports', `${cfg.strategy.experimentId}_${runAt.replace(/[:.]/g, '-')}`));
  const report = writeReports(bt, outDir, runMeta);
  const latest = path.join(bt.dataDir, 'reports', 'latest');
  fs.rmSync(latest, { recursive: true, force: true });
  fs.cpSync(outDir, latest, { recursive: true });

  const t = report.summary.trades, e = report.summary.equity;
  console.log(`\n${cfg.strategy.name} [${cfg.strategy.experimentId}] ${bt.range.start} → ${bt.range.end} (${bt.range.sessions} sessions, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`  Equity ₹${fmt(e.initialEquity, 0)} → ₹${fmt(e.endingEquity, 0)} (${fmt(e.returnPct)}%), max DD ${fmt(e.maxDrawdownPct)}%`);
  console.log(`  Trades ${t.trades || 0}, win ${fmt(t.winRatePct, 1)}%, PF net ${fmt(t.profitFactorNet)}, avg R ${fmt(t.avgR, 3)}, expectancy ₹${fmt(t.expectancy, 0)}`);
  console.log(`  Decisions: ${Object.entries(bt.decisionCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (bt.intraday.requirements.size) console.log(`  ⚠ ${bt.intraday.requirements.size} intraday symbol-days missing → node swing/fetch-swing-data.js intraday --requirements ${path.relative(process.cwd(), path.join(latest, 'intraday-requirements.json'))}`);
  console.log(`  Report: ${path.relative(process.cwd(), outDir)}/report.md`);
}

if (require.main === module) {
  main().catch(err => { console.error(`✗ ${err.stack || err.message}`); process.exitCode = 1; });
}

module.exports = { V1_CONFIG, SwingBacktest, loadConfig, strategyPart, hashOf, round, tradeStats, equityStats, emaSeries, rsiSeries, atrSeries, macdSeries, priorExtremeSeries, rollingMeanSeries };
