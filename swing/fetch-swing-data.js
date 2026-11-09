#!/usr/bin/env node
/**
 * fetch-swing-data.js — data acquisition for backtest-swing.js (Swing V1).
 *
 * Downloads historical data from public, unauthenticated endpoints and caches it
 * under data/swing/. The backtest itself never touches the network; it only reads
 * these cached files, so every run is reproducible from disk.
 *
 * Sources
 *   - NIFTY 500 constituents ........ NSE archives CSV (current list → survivorship bias, flagged in reports)
 *   - Stock / Indian index OHLCV .... Upstox public historical-candle API v3 (split-adjusted)
 *   - Global indices (US, Asia) ..... Yahoo Finance chart API (daily)
 *   - GIFT NIFTY .................... no free historical source → reported as a missing component
 *
 * Usage
 *   node swing/fetch-swing-data.js all [--from 2021-01-01] [--to YYYY-MM-DD]
 *   node swing/fetch-swing-data.js universe
 *   node swing/fetch-swing-data.js daily  [--from ..] [--to ..] [--only SYM1,SYM2]
 *   node swing/fetch-swing-data.js global [--from ..] [--to ..]
 *   node swing/fetch-swing-data.js nifty-intraday [--from 2022-01] [--to 2026-11]
 *   node swing/fetch-swing-data.js intraday --requirements <file.json>
 *   node swing/fetch-swing-data.js mongo-index      load cached index/global daily bars into MongoDB
 *
 * Options
 *   --refresh      re-download files that already exist
 *   --delay <ms>   minimum pause between HTTP requests (default 350)
 *
 * Upstox limits historical requests to 50/s, 500/min and 2,000 per 30 minutes; the limiter below
 * stays under 40/s, 450/min and 1,900 per 30 minutes.
 *
 * MongoDB (mongo-index): writes only to the collection `index_candles_daily` (created if missing)
 * in SWING_MONGO_URI (default mongodb://localhost:27017) / database SWING_MONGO_DB (default msvStorage).
 * The existing `stocks` collection is never written.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'swing');

// Secrets such as UPSTOX_ANALYTICS_TOKEN live in algoTester/.env (git-ignored). Real environment
// variables take precedence over the file.
try { if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch (err) { console.warn(`  could not read .env: ${err.message}`); }
const DIRS = {
  universe: path.join(DATA_DIR, 'universe'),
  daily: path.join(DATA_DIR, 'daily'),
  market: path.join(DATA_DIR, 'market'),
};
// Upstox serves 1-minute and 5-minute candles directly; 15-minute bars are built from 5-minute.
const INTRADAY_INTERVALS = [1, 5];
const intradayDir = interval => path.join(DATA_DIR, `intraday${interval}`);

const UPSTOX = 'https://api.upstox.com/v3/historical-candle';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const NIFTY500_CSV = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv';

// Indian indices fetched from Upstox. File name = key used by the backtest.
const INDIAN_INDICES = {
  NIFTY50: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  INDIAVIX: 'NSE_INDEX|India VIX',
  NIFTY500: 'NSE_INDEX|Nifty 500',
};

// Global indices fetched from Yahoo.
const GLOBAL_INDICES = {
  SP500: '^GSPC',
  NASDAQ: '^IXIC',
  NIKKEI225: '^N225',
  HANGSENG: '^HSI',
  KOSPI: '^KS11',
};

// ─── CLI helpers ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthStart(ym) { return `${ym}-01`; }
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function monthRange(fromYm, toYm) {
  const out = [];
  for (let ym = fromYm; ym <= toYm; ym = nextMonth(ym)) out.push(ym);
  return out;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, obj) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HTTP with throttle + retry ──────────────────────────────────────────────

let DELAY_MS = 350;
let lastRequestAt = 0;
const RATE_LIMITS = [[1000, 40], [60000, 450], [1800000, 1900]];   // [window ms, max requests]
// Request timestamps persist across runs so a restarted fetch cannot exceed Upstox's 30-minute window.
const RATE_FILE = path.join(DATA_DIR, '.upstox-request-log.json');
const requestStamps = (() => {
  try { return JSON.parse(fs.readFileSync(RATE_FILE, 'utf8')).filter(t => t > Date.now() - 1800000).sort((a, b) => a - b); } catch { return []; }
})();
let requestCount = 0;
let lastRateSave = 0;
function saveRateLog(force) {
  if (!force && Date.now() - lastRateSave < 2000) return;
  lastRateSave = Date.now();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(RATE_FILE, JSON.stringify(requestStamps)); } catch { /* best effort */ }
}
process.on('exit', () => saveRateLog(true));
process.on('SIGINT', () => { saveRateLog(true); process.exit(130); });
process.on('SIGTERM', () => { saveRateLog(true); process.exit(143); });

async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestStamps.length && requestStamps[0] <= now - 1800000) requestStamps.shift();
    let wait = lastRequestAt + DELAY_MS - now;
    for (const [win, max] of RATE_LIMITS) {
      let count = 0, oldest = null;
      for (let i = requestStamps.length - 1; i >= 0 && requestStamps[i] > now - win; i--) { count++; oldest = requestStamps[i]; }
      if (count >= max) wait = Math.max(wait, oldest + win - now + 5);
    }
    if (wait <= 0) { requestStamps.push(now); lastRequestAt = now; requestCount++; saveRateLog(false); return; }
    if (wait > 10000) console.log(`  … rate limit: waiting ${Math.round(wait / 1000)} s (${requestCount} requests so far)`);
    await sleep(wait);
  }
}

async function httpGet(url, { asText = false, retries = 5, headers = {} } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (algoTester swing research)', Accept: asText ? 'text/csv,*/*' : 'application/json', ...headers },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status >= 500) {
        const backoff = 1000 * 2 ** attempt;
        console.warn(`  HTTP ${res.status} — retry in ${backoff} ms`);
        await sleep(backoff);
        continue;
      }
      const body = await res.text();
      if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`); e.status = res.status; e.noRetry = true; throw e; }
      return asText ? body : JSON.parse(body);
    } catch (err) {
      if (err.noRetry || attempt === retries) throw err;   // 4xx answers will not change on retry
      const backoff = 1000 * 2 ** attempt;
      console.warn(`  ${err.message} — retry in ${backoff} ms`);
      await sleep(backoff);
    }
  }
  throw new Error(`Failed after retries: ${url}`);
}

async function upstoxCandles(instrumentKey, unit, interval, from, to) {
  const url = `${UPSTOX}/${encodeURIComponent(instrumentKey)}/${unit}/${interval}/${to}/${from}`;
  const json = await httpGet(url);
  if (json.status !== 'success') throw new Error(`Upstox error for ${instrumentKey}: ${JSON.stringify(json.errors || json).slice(0, 200)}`);
  const candles = (json.data && json.data.candles) || [];
  return candles.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ─── Universe ────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = [];
    let cur = '', quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

async function fetchUniverse() {
  console.log('▶ Universe: NIFTY 500 constituents (NSE archives)');
  const text = await httpGet(NIFTY500_CSV, { asText: true });
  const rows = parseCsv(text);
  const stocks = rows
    .filter(r => r.Symbol && r['ISIN Code'])
    .map(r => ({ symbol: r.Symbol, name: r['Company Name'], sector: r.Industry, series: r.Series, isin: r['ISIN Code'], instrumentKey: `NSE_EQ|${r['ISIN Code']}` }));
  const asOf = istToday();
  ensureDir(DIRS.universe);
  fs.writeFileSync(path.join(DIRS.universe, `ind_nifty500list_${asOf}.csv`), text);
  writeJson(path.join(DIRS.universe, 'universe.json'), {
    name: 'NIFTY 500',
    version: `nifty500-${asOf}`,
    source: NIFTY500_CSV,
    downloadedAt: new Date().toISOString(),
    pointInTime: false,
    note: 'Current constituents applied to all historical dates (survivorship bias).',
    stocks,
  });
  console.log(`  ✓ ${stocks.length} constituents, ${new Set(stocks.map(s => s.sector)).size} sectors`);
  return stocks;
}

function loadUniverse() {
  const file = path.join(DIRS.universe, 'universe.json');
  if (!fs.existsSync(file)) throw new Error('universe.json missing — run "universe" first');
  return readJson(file);
}

// ─── Daily data ──────────────────────────────────────────────────────────────

function toDailyRows(candles) {
  // Upstox daily timestamp: 2026-11-06T00:00:00+05:30 → date 2026-11-06
  return candles.map(c => [c[0].slice(0, 10), +c[1], +c[2], +c[3], +c[4], +c[5]]);
}

async function fetchDaily(opts) {
  const universe = loadUniverse();
  const only = opts.only ? new Set(String(opts.only).split(',')) : null;
  const jobs = [];
  for (const [name, key] of Object.entries(INDIAN_INDICES)) jobs.push({ name, key, file: path.join(DIRS.market, 'daily', `${name}.json`), kind: 'index' });
  for (const s of universe.stocks) jobs.push({ name: s.symbol, key: s.instrumentKey, file: path.join(DIRS.daily, `${s.symbol}.json`), kind: 'stock' });

  console.log(`▶ Daily OHLCV ${opts.from} → ${opts.to} for ${jobs.length} instruments (Upstox)`);
  let done = 0, skipped = 0, appended = 0, rebuilt = 0, failed = [];
  for (const job of jobs) {
    if (only && !only.has(job.name)) continue;
    let existing = null;
    if (!opts.refresh && fs.existsSync(job.file)) {
      existing = readJson(job.file);
      if (existing.to >= opts.to && existing.from <= opts.from) { skipped++; continue; }
      if (existing.from > opts.from || !existing.candles.length) existing = null;
    }
    try {
      let rows, from = opts.from;
      if (existing) {
        // Incremental: re-read from the last stored day. If that day's close moved, the vendor
        // re-adjusted history (split / bonus), so rebuild the whole file instead of appending.
        const last = existing.candles[existing.candles.length - 1];
        const fresh = toDailyRows(await upstoxCandles(job.key, 'days', 1, last[0], opts.to));
        const overlap = fresh.find(r => r[0] === last[0]);
        if (overlap && Math.abs(overlap[4] / last[4] - 1) <= 0.005) {
          const byDate = new Map(existing.candles.map(r => [r[0], r]));
          for (const r of fresh) byDate.set(r[0], r);
          rows = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
          from = existing.from; appended++;
        } else {
          rows = toDailyRows(await upstoxCandles(job.key, 'days', 1, opts.from, opts.to));
          rebuilt++;
          console.log(`  ↻ ${job.name}: history re-adjusted by vendor (close ${last[4]} → ${overlap ? overlap[4] : 'n/a'} on ${last[0]}), rebuilt`);
        }
      } else rows = toDailyRows(await upstoxCandles(job.key, 'days', 1, opts.from, opts.to));
      writeJson(job.file, {
        symbol: job.name, instrumentKey: job.key, kind: job.kind, source: 'upstox-v3-historical', adjustment: 'split/bonus adjusted (vendor)',
        timezone: 'Asia/Kolkata', from, to: opts.to, fetchedAt: new Date().toISOString(),
        columns: ['date', 'open', 'high', 'low', 'close', 'volume'], candles: rows,
      });
      done++;
      if (done % 25 === 0) console.log(`  … ${done} fetched`);
    } catch (err) {
      failed.push({ name: job.name, error: err.message });
      console.warn(`  ✗ ${job.name}: ${err.message}`);
    }
  }
  console.log(`  ✓ updated ${done} (appended ${appended}, rebuilt ${rebuilt}), skipped (up to date) ${skipped}, failed ${failed.length}`);
  if (failed.length) writeJson(path.join(DATA_DIR, 'fetch-failures-daily.json'), failed);
}

// ─── Global indices (Yahoo) ──────────────────────────────────────────────────

function zonedDate(epochSec, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(epochSec * 1000));
}

async function fetchGlobal(opts) {
  console.log(`▶ Global indices ${opts.from} → ${opts.to} (Yahoo)`);
  const p1 = Math.floor(new Date(`${opts.from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${addDays(opts.to, 1)}T23:59:59Z`).getTime() / 1000);
  for (const [name, sym] of Object.entries(GLOBAL_INDICES)) {
    const file = path.join(DIRS.market, 'daily', `${name}.json`);
    if (!opts.refresh && fs.existsSync(file) && readJson(file).to >= opts.to) { console.log(`  · ${name} cached`); continue; }
    const json = await httpGet(`${YAHOO}/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false`);
    const r = json.chart && json.chart.result && json.chart.result[0];
    if (!r) throw new Error(`Yahoo returned no data for ${sym}`);
    const tz = r.meta.exchangeTimezoneName;
    const q = r.indicators.quote[0];
    const rows = [];
    r.timestamp.forEach((t, i) => {
      if ([q.open[i], q.high[i], q.low[i], q.close[i]].some(v => v == null)) return;
      rows.push([zonedDate(t, tz), q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0]);
    });
    const dedup = [...new Map(rows.map(rw => [rw[0], rw])).values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    writeJson(file, {
      symbol: name, ticker: sym, kind: 'global-index', source: 'yahoo-chart-v8', timezone: tz,
      from: opts.from, to: opts.to, fetchedAt: new Date().toISOString(),
      columns: ['date', 'open', 'high', 'low', 'close', 'volume'], candles: dedup,
    });
    console.log(`  ✓ ${name} (${sym}) ${dedup.length} sessions, tz ${tz}`);
  }
}

// ─── Intraday (1-minute / 5-minute) ──────────────────────────────────────────

function intradayFile(symbol, ym, interval = 5) { return path.join(intradayDir(interval), symbol, `${ym}.json`); }

function isMonthComplete(ym, fetchedAtIso) {
  // A month file is final once it was fetched after the month ended.
  return fetchedAtIso.slice(0, 10) > monthEnd(ym);
}

/** True when a cached month file already covers the month (or everything up to opts.to). */
function monthCached(symbol, ym, interval, opts) {
  const file = intradayFile(symbol, ym, interval);
  if (opts.refresh || !fs.existsSync(file)) return false;
  const existing = readJson(file);
  return isMonthComplete(ym, existing.fetchedAt) || existing.to >= opts.to;
}

async function fetchIntradayMonth(symbol, instrumentKey, ym, opts, interval = 5) {
  if (!INTRADAY_INTERVALS.includes(interval)) throw new Error(`Unsupported download interval ${interval} (use 1 or 5; 15-minute is built from 5-minute)`);
  if (monthCached(symbol, ym, interval, opts)) return 'cached';
  // A cached 1-minute month already contains every 5-minute bar; the backtest builds them locally.
  if (interval === 5 && monthCached(symbol, ym, 1, opts)) return 'cached-1m';
  const file = intradayFile(symbol, ym, interval);
  const from = monthStart(ym);
  const to = monthEnd(ym) < opts.to ? monthEnd(ym) : opts.to;
  if (from > to) return 'future';
  const candles = await upstoxCandles(instrumentKey, 'minutes', interval, from, to);
  writeJson(file, {
    symbol, instrumentKey, month: ym, interval: `${interval}minute`, source: 'upstox-v3-historical', timezone: 'Asia/Kolkata',
    barTimestamp: 'bar start', from, to, fetchedAt: new Date().toISOString(),
    columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
    candles: candles.map(c => [c[0], +c[1], +c[2], +c[3], +c[4], +c[5]]),
  });
  return candles.length ? 'fetched' : 'empty';
}

async function fetchNiftyIntraday(opts) {
  const months = monthRange(opts.fromMonth, opts.toMonth);
  console.log(`▶ NIFTY 50 5-minute bars, ${months.length} months (Upstox)`);
  const stats = {};
  for (const ym of months) {
    const r = await fetchIntradayMonth('NIFTY50', INDIAN_INDICES.NIFTY50, ym, opts);
    stats[r] = (stats[r] || 0) + 1;
  }
  console.log(`  ✓ ${JSON.stringify(stats)}`);
}

async function fetchIntradayRequirements(opts) {
  if (!opts.requirements) throw new Error('--requirements <file> is required');
  const req = readJson(path.resolve(opts.requirements));
  const universe = loadUniverse();
  const keyBySymbol = new Map(universe.stocks.map(s => [s.symbol, s.instrumentKey]));
  // Requirement items: { symbol, date, purpose: 'entry' | 'hold' | 'baseline', interval: 1 | 5 }
  // entry           → previous month (time-of-day volume baseline) + month
  // hold / baseline → month of the date
  // Holding months are not prefetched: most watched stocks are never bought, and the backtest
  // asks for the months it actually holds on its next run.
  // --interval 1: download every missing month at 1 minute (one call per stock-month covers
  // 1, 5 and 15-minute use). Months already cached at 5 minutes are not downloaded again unless
  // 1-minute bars are needed for them.
  const forceInterval = opts.interval === '1' ? 1 : null;
  const wanted = new Map();
  for (const item of req.items || []) {
    const ym = item.date.slice(0, 7);
    let interval = item.interval === 1 ? 1 : 5;
    if (forceInterval && interval === 5 && !monthCached(item.symbol, ym, 5, opts)) interval = 1;
    const months = item.purpose === 'entry' ? [prevMonth(ym), ym] : [ym];
    for (const m of months) {
      if (m > opts.to.slice(0, 7)) continue;
      const iv = forceInterval && interval === 5 && !monthCached(item.symbol, m, 5, opts) ? 1 : interval;
      if (wanted.has(`${item.symbol}|${m}|1`)) continue;
      if (iv === 1) wanted.delete(`${item.symbol}|${m}|5`);
      wanted.set(`${item.symbol}|${m}|${iv}`, { symbol: item.symbol, ym: m, interval: iv });
    }
  }
  if (opts.dryRun) {
    const todo = [...wanted.values()].filter(j => !monthCached(j.symbol, j.ym, j.interval, opts) && !(j.interval === 5 && monthCached(j.symbol, j.ym, 1, opts)));
    console.log(`▶ Dry run: ${wanted.size} symbol-months requested, ${wanted.size - todo.length} already cached, ${todo.length} to download (${todo.filter(j => j.interval === 1).length} at 1-minute, ${todo.filter(j => j.interval === 5).length} at 5-minute)`);
    return;
  }
  // Month first, so an interrupted download still leaves complete early date windows.
  const jobs = [...wanted.values()].sort((a, b) => (`${a.ym}${a.interval}${a.symbol}` < `${b.ym}${b.interval}${b.symbol}` ? -1 : 1));
  console.log(`▶ Intraday: ${req.items.length} requirement(s) → ${jobs.length} symbol-month file(s)`);
  const stats = {};
  let n = 0;
  for (const job of jobs) {
    const key = job.symbol === 'NIFTY50' ? INDIAN_INDICES.NIFTY50 : keyBySymbol.get(job.symbol);
    if (!key) { stats.unknownSymbol = (stats.unknownSymbol || 0) + 1; continue; }
    try {
      const r = await fetchIntradayMonth(job.symbol, key, job.ym, opts, job.interval);
      stats[r] = (stats[r] || 0) + 1;
    } catch (err) {
      stats.failed = (stats.failed || 0) + 1;
      console.warn(`  ✗ ${job.symbol} ${job.ym}: ${err.message}`);
    }
    if (++n % 50 === 0) console.log(`  … ${n}/${jobs.length}`);
  }
  console.log(`  ✓ ${JSON.stringify(stats)}`);
}

// ─── Load index / global daily bars into MongoDB ─────────────────────────────

// Session close (exchange local time) stored with each bar as closeUtc, for point-in-time queries.
const SESSION_CLOSE = {
  NIFTY50: ['Asia/Kolkata', '15:30'], BANKNIFTY: ['Asia/Kolkata', '15:30'], INDIAVIX: ['Asia/Kolkata', '15:30'], NIFTY500: ['Asia/Kolkata', '15:30'],
  SP500: ['America/New_York', '16:00'], NASDAQ: ['America/New_York', '16:00'], NIKKEI225: ['Asia/Tokyo', '15:30'],
  HANGSENG: ['Asia/Hong_Kong', '16:10'], KOSPI: ['Asia/Seoul', '15:30'],
};

function zonedToEpoch(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = e => {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(e))) p[part.type] = part.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(e / 1000) * 1000;
  };
  return guess - offset(guess - offset(guess));
}

async function loadIndexToMongo() {
  const { MongoClient } = require('mongodb');
  const uri = process.env.SWING_MONGO_URI || 'mongodb://localhost:27017';
  const dbName = process.env.SWING_MONGO_DB || 'msvStorage';
  const collName = 'index_candles_daily';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const coll = client.db(dbName).collection(collName);
    console.log(`▶ MongoDB ${dbName}.${collName}: loading cached index and global daily bars`);
    for (const name of Object.keys(SESSION_CLOSE)) {
      const file = path.join(DIRS.market, 'daily', `${name}.json`);
      if (!fs.existsSync(file)) { console.warn(`  ✗ ${name}: no cached file (run "daily"/"global" first)`); continue; }
      const raw = readJson(file);
      const [tz, close] = SESSION_CLOSE[name];
      const kind = name in GLOBAL_INDICES ? 'global-index' : 'indian-index';
      const loadedAt = new Date();
      const ops = raw.candles.map(([date, open, high, low, cl, volume]) => ({
        updateOne: {
          filter: { symbol: name, dId: date.replace(/-/g, '') },
          update: { $set: { symbol: name, kind, dId: date.replace(/-/g, ''), date, open, high, low, close: cl, volume, exchangeTimezone: tz, sessionClose: close, closeUtc: new Date(zonedToEpoch(date, close, tz)), source: raw.source, instrumentKey: raw.instrumentKey || null, ticker: raw.ticker || null, loadedAt } },
          upsert: true,
        },
      }));
      let upserted = 0, modified = 0;
      for (let i = 0; i < ops.length; i += 1000) {
        const r = await coll.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
        upserted += r.upsertedCount; modified += r.modifiedCount;
      }
      console.log(`  ✓ ${name.padEnd(10)} ${kind.padEnd(13)} ${ops.length} bars (${upserted} new, ${modified} updated) ${raw.candles[0][0]} → ${raw.candles[raw.candles.length - 1][0]}`);
    }
    await coll.createIndex({ symbol: 1, dId: 1 }, { unique: true });
    await coll.createIndex({ kind: 1, dId: 1 });
    console.log(`  ✓ ${await coll.countDocuments()} documents, indexes: ${(await coll.indexes()).map(i => i.name).join(', ')}`);
  } finally {
    await client.close();
  }
}

// ─── Upstox fundamentals (analytics token) ───────────────────────────────────

const FUNDAMENTAL_ENDPOINTS = {
  incomeYearly: isin => `${isin}/income-statement?type=consolidated&time_period=yearly&fs=true`,
  incomeQuarterly: isin => `${isin}/income-statement?type=consolidated&time_period=quarterly&fs=true`,
  balanceSheet: isin => `${isin}/balance-sheet?type=consolidated&fs=true`,
  cashFlow: isin => `${isin}/cash-flow?type=consolidated&fs=true`,
  shareHoldings: isin => `${isin}/share-holdings`,
  keyRatios: isin => `${isin}/key-ratios`,
};
const FUND_DIR = path.join(DATA_DIR, 'fundamentals');

function analyticsToken() {
  const token = (process.env.UPSTOX_ANALYTICS_TOKEN || '').trim();
  if (!token) throw new Error('UPSTOX_ANALYTICS_TOKEN is not set. Put it in algoTester/.env as: UPSTOX_ANALYTICS_TOKEN=<token>');
  return token;
}

/** Consolidated first; companies without consolidated accounts fall back to standalone. */
async function fetchFundamentalEndpoint(isin, name, auth) {
  const url = `https://api.upstox.com/v2/fundamentals/${FUNDAMENTAL_ENDPOINTS[name](isin)}`;
  // Empty = no array anywhere in the payload holds a data point (rows with empty `history` count as empty).
  const hasPoints = v => (Array.isArray(v) ? v.some(x => (x && typeof x === 'object' ? (Array.isArray(x.history) ? x.history.length > 0 : hasPoints(Object.values(x)) || 'value' in x || 'period' in x) : x != null)) : v && typeof v === 'object' ? Object.values(v).some(hasPoints) : false);
  const isEmpty = d => !hasPoints(d);
  try {
    const json = await httpGet(url, { headers: auth, retries: 3 });
    if (!isEmpty(json.data) || !url.includes('type=consolidated')) return { data: json.data, type: url.includes('consolidated') ? 'consolidated' : null };
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    if (!url.includes('type=consolidated')) return { error: err.message.slice(0, 160) };
  }
  try {
    const json = await httpGet(url.replace('type=consolidated', 'type=standalone'), { headers: auth, retries: 3 });
    return { data: json.data, type: 'standalone' };
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    return { error: err.message.slice(0, 160) };
  }
}

/**
 * Download every fundamentals endpoint for the universe. Writes a file per stock under
 * data/swing/fundamentals/ and a dated snapshot per stock and endpoint into MongoDB
 * `fundamentals_snapshots` (the only collection written). Re-running on another day adds a new
 * snapshot, so the history becomes point-in-time going forward.
 */
async function fetchFundamentals(opts) {
  const token = analyticsToken();
  const auth = { Authorization: `Bearer ${token}` };
  const universe = loadUniverse();
  const only = opts.only ? new Set(String(opts.only).split(',')) : null;
  const stocks = universe.stocks.filter(s => s.series === 'EQ' && s.symbol !== 'DUMMYHEG' && (!only || only.has(s.symbol)));
  const today = istToday();
  ensureDir(FUND_DIR);

  let coll = null, client = null;
  if (!opts['no-mongo']) {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(process.env.SWING_MONGO_URI || 'mongodb://localhost:27017', { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    coll = client.db(process.env.SWING_MONGO_DB || 'msvStorage').collection('fundamentals_snapshots');
    await coll.createIndex({ symbol: 1, endpoint: 1, snapshotDate: 1 }, { unique: true });
  }

  console.log(`▶ Fundamentals: ${stocks.length} stocks × ${Object.keys(FUNDAMENTAL_ENDPOINTS).length} endpoints (Upstox, snapshot ${today})`);
  const stats = { fetched: 0, cached: 0, endpointErrors: 0, standalone: 0 };
  let n = 0;
  try {
    for (const s of stocks) {
      const file = path.join(FUND_DIR, `${s.symbol}.json`);
      if (!opts.refresh && fs.existsSync(file) && readJson(file).snapshotDate === today) { stats.cached++; continue; }
      const rec = { symbol: s.symbol, isin: s.isin, name: s.name, sector: s.sector, source: 'upstox-v2-fundamentals', snapshotDate: today, fetchedAt: new Date().toISOString(), endpoints: {}, statementType: {}, errors: {} };
      for (const name of Object.keys(FUNDAMENTAL_ENDPOINTS)) {
        const r = await fetchFundamentalEndpoint(s.isin, name, auth);
        if (r.error) { rec.errors[name] = r.error; stats.endpointErrors++; continue; }
        rec.endpoints[name] = r.data;
        if (r.type) rec.statementType[name] = r.type;
        if (r.type === 'standalone') stats.standalone++;
      }
      writeJson(file, rec);
      if (coll) {
        const ops = Object.entries(rec.endpoints).map(([endpoint, data]) => ({
          updateOne: { filter: { symbol: s.symbol, endpoint, snapshotDate: today }, update: { $set: { symbol: s.symbol, isin: s.isin, endpoint, snapshotDate: today, statementType: rec.statementType[endpoint] || null, source: rec.source, fetchedAt: new Date(rec.fetchedAt), data } }, upsert: true },
        }));
        if (ops.length) await coll.bulkWrite(ops, { ordered: false });
      }
      stats.fetched++;
      if (++n % 25 === 0) console.log(`  … ${n}/${stocks.length} stocks`);
    }
  } finally {
    if (client) await client.close();
  }
  console.log(`  ✓ ${JSON.stringify(stats)}`);
}

// ─── Upstox analytics token check (fundamentals) ─────────────────────────────

/** Calls the Fundamentals API for one stock and reports how much history comes back. Never prints the token. */
async function checkToken() {
  const token = (process.env.UPSTOX_ANALYTICS_TOKEN || '').trim();
  if (!token) {
    console.log('✗ UPSTOX_ANALYTICS_TOKEN is not set. Put it in algoTester/.env as: UPSTOX_ANALYTICS_TOKEN=<token>');
    process.exitCode = 1;
    return;
  }
  console.log(`▶ Testing Upstox analytics token (${token.length} characters) on RELIANCE fundamentals`);
  const isin = 'INE002A01018';
  const auth = { Authorization: `Bearer ${token}` };
  const checks = [
    ['income statement, quarterly', `income-statement?type=consolidated&time_period=quarterly&fs=false`, j => j.data.income_statement],
    ['income statement, yearly', `income-statement?type=consolidated&time_period=yearly&fs=false`, j => j.data.income_statement],
    ['share holdings', 'share-holdings', j => j.data],
  ];
  for (const [label, q, pick] of checks) {
    try {
      const json = await httpGet(`https://api.upstox.com/v2/fundamentals/${isin}/${q}`, { headers: auth, retries: 1 });
      const rows = pick(json);
      const hist = Array.isArray(rows) && rows[0] && Array.isArray(rows[0].history) ? rows[0].history : null;
      if (hist) console.log(`  ✓ ${label}: ${hist.length} periods, ${hist[hist.length - 1].period} → ${hist[0].period}`);
      else console.log(`  ✓ ${label}: OK (${JSON.stringify(rows).slice(0, 160)}…)`);
    } catch (err) {
      const msg = String(err.message).replaceAll(token, '<token>');
      console.log(`  ✗ ${label}: ${msg.slice(0, 200)}`);
      if (/HTTP 401|HTTP 403/.test(msg)) { console.log('    The token was rejected: regenerate it in Upstox Developer Apps → Analytics tab.'); process.exitCode = 1; return; }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.delay) DELAY_MS = Number(args.delay);
  const opts = {
    from: args.from && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : '2021-01-01',
    to: args.to && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? args.to : addDays(istToday(), -1),
    refresh: Boolean(args.refresh),
    only: args.only,
    requirements: args.requirements,
    interval: args.interval ? String(args.interval) : null,
    dryRun: Boolean(args['dry-run']),
  };
  opts.fromMonth = args.from && /^\d{4}-\d{2}$/.test(args.from) ? args.from : '2022-01';
  opts.toMonth = args.to && /^\d{4}-\d{2}$/.test(args.to) ? args.to : opts.to.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(args.to || '')) opts.to = monthEnd(args.to) < addDays(istToday(), -1) ? monthEnd(args.to) : addDays(istToday(), -1);

  switch (cmd) {
    case 'universe': await fetchUniverse(); break;
    case 'daily': await fetchDaily(opts); break;
    case 'global': await fetchGlobal(opts); break;
    case 'nifty-intraday': await fetchNiftyIntraday(opts); break;
    case 'intraday': await fetchIntradayRequirements(opts); break;
    case 'mongo-index': await loadIndexToMongo(); break;
    case 'check-token': await checkToken(); break;
    case 'fundamentals': await fetchFundamentals({ ...opts, 'no-mongo': args['no-mongo'] }); break;
    case 'all':
      await fetchUniverse();
      await fetchDaily(opts);
      await fetchGlobal(opts);
      await fetchNiftyIntraday({ ...opts, fromMonth: '2022-01', toMonth: opts.to.slice(0, 7) });
      break;
    default:
      console.log('Usage: node swing/fetch-swing-data.js <all|universe|daily|global|nifty-intraday|intraday|mongo-index> [options]');
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(err => { console.error(`✗ ${err.stack || err.message}`); process.exitCode = 1; });
}

module.exports = { fetchIntradayMonth, INDIAN_INDICES, requestCountSoFar: () => requestCount };
