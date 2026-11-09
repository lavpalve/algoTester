#!/usr/bin/env node
/**
 * paper-trade.js — daily paper trading for a frozen swing strategy (default: V1.7b).
 *
 * Every run:
 *   1. updates daily candles (Upstox, incremental), global indices (Yahoo) and the NSE calendar;
 *   2. replays every completed session since the paper start date with the backtest engine
 *      (same code and rules as the backtests), downloading the 1/5-minute data it needs;
 *   3. writes a dated report: account, open positions, what happened in the last session,
 *      and the watchlist / plan for the next session.
 *
 * The paper account is a pure function of the data: re-running gives the same result. Each run
 * is compared with the previous one, and any change to already-reported trades is flagged.
 *
 * Usage
 *   node swing/paper-trade.js --start 2026-11-09            first run: opens the paper account
 *   node swing/paper-trade.js                               every trading day afterwards
 * Options
 *   --config <file>   strategy (default swing/experiments/v1.7b-check-roe15-or-growth15.json)
 *   --equity <₹>      starting equity on the first run (default 10,00,000)
 *   --to YYYY-MM-DD   last completed session to process (default: today after 18:00 IST, else yesterday)
 *   --no-fetch        use local data only
 *   --dir <path>      paper account folder (default data/swing/paper/<experimentId>)
 *
 * Best run on trading days between 07:00 and 09:00 IST: the previous session is complete and the
 * US close is known, so the plan for the day is final. An evening run (after 18:00) is fine for the
 * replay; its plan is marked preliminary until the US session has closed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SwingBacktest, loadConfig, strategyPart, hashOf, round, tradeStats, equityStats } = require('./backtest-swing');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'swing');
const FETCHER = path.join(__dirname, 'fetch-swing-data.js');
const DEFAULT_CONFIG = path.join(__dirname, 'experiments', 'v1.7b-check-roe15-or-growth15.json');

try { if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* optional */ }

// ─── Small helpers ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
const fmt = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = d => new Date(`${d}T00:00:00Z`).getUTCDay();
const hhmm = ms => new Date(ms + 19800000).toISOString().slice(11, 16);
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const minTo = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function istNow() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, text: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} IST` };
}
function runFetcher(args) {
  execFileSync(process.execPath, [FETCHER, ...args], { cwd: ROOT, stdio: 'inherit' });
}

// ─── NSE calendar (Upstox market holidays, cached daily) ────────────────────

async function exchangeCalendar(allowFetch, warnings) {
  const file = path.join(DATA_DIR, 'paper', 'exchange-calendar.json');
  const today = istNow().date;
  let cal = fs.existsSync(file) ? readJson(file) : null;
  const token = (process.env.UPSTOX_ANALYTICS_TOKEN || '').trim();
  if (allowFetch && token && (!cal || cal.fetchedOn !== today)) {
    try {
      const res = await fetch('https://api.upstox.com/v2/market/holidays', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(`HTTP ${res.status}`);
      cal = { fetchedOn: today, source: 'Upstox /v2/market/holidays', holidays: json.data };
      writeJson(file, cal);
    } catch (err) { warnings.push(`Could not refresh the NSE holiday calendar (${String(err.message).slice(0, 80)}); using ${cal ? `the copy from ${cal.fetchedOn}` : 'weekdays only'}.`); }
  } else if (!token && allowFetch) warnings.push('UPSTOX_ANALYTICS_TOKEN not set: NSE holidays unknown, next session assumed to be the next weekday.');
  const closed = new Set(), special = {};
  for (const h of (cal && cal.holidays) || []) {
    if ((h.closed_exchanges || []).includes('NSE')) closed.add(h.date);
    const o = (h.open_exchanges || []).find(x => x.exchange === 'NSE');
    if (o) special[h.date] = { label: h.description, start: hhmm(o.start_time), end: hhmm(o.end_time) };
  }
  const years = new Set(((cal && cal.holidays) || []).map(h => h.date.slice(0, 4)));
  return { closed, special, years, fetchedOn: cal ? cal.fetchedOn : null };
}

function isTradingDay(d, ex) {
  if (ex.closed.has(d)) return false;
  if (ex.special[d]) return true;
  return weekday(d) !== 0 && weekday(d) !== 6;
}
function nextTradingDay(d, ex) {
  for (let i = 1; i <= 10; i++) { const n = addDays(d, i); if (isTradingDay(n, ex)) return n; }
  return addDays(d, 1);
}

/** Exchange-announced non-standard sessions → engine session overrides. */
function runtimeSessions(ex, normal) {
  const out = {};
  for (const [date, s] of Object.entries(ex.special)) {
    if (s.start === normal.tradingStart && s.end === normal.tradingEnd) continue;
    const len = toMin(s.end) - toMin(s.start);
    out[date] = {
      label: s.label, preMarketOpen: minTo(toMin(s.start) - 15), tradingStart: s.start,
      tradeCutoff: minTo(toMin(s.end) - (len >= 120 ? 30 : 15)), tradingEnd: s.end,
      allowNewEntries: len >= 300,             // short sessions: manage positions, no new entries
    };
  }
  return out;
}

// ─── Plan for the next session ───────────────────────────────────────────────

function buildPlan(bt, D, E, equity, cash, openPositions) {
  const cfg = bt.cfg;
  const sess = bt.sessionFor(E);
  const scan = bt.scanStocks(D);
  const market = bt.marketScore(E, D, sess, scan.top ? scan.top.sector : null);
  const held = new Set(openPositions.map(p => p.symbol));
  const slots = cfg.account.maxOpenPositions - openPositions.length;
  const sel = cfg.selection;
  const notHeld = scan.qualified.filter(c => !held.has(c.symbol));
  const top = sel.mode === 'watchlist' ? notHeld.slice(0, sel.maxWatchlist || notHeld.length) : scan.top && !held.has(scan.top.symbol) ? [scan.top] : [];
  const watch = top.filter(c => !c.fundBlock), dropped = top.filter(c => c.fundBlock);

  let decision;
  if (slots <= 0) decision = { code: 'POSITION_OPEN', text: `All ${cfg.account.maxOpenPositions} slots are in use: no new entries.` };
  else if (market.gate && market.gate.type === 'DATA_QUALITY') decision = { code: 'NO_TRADE_DATA_QUALITY', text: `No new entries: ${market.gate.reason}.` };
  else if (market.gate) decision = { code: 'NO_TRADE_HARD_GATE', text: `No new entries: ${market.gate.reason}.` };
  else if (market.band === 'blocked') decision = { code: 'NO_TRADE_MARKET_GATE', text: `No new entries: market score ${round(market.score, 1)} is below ${cfg.market.bands.research}.` };
  else if (!watch.length) decision = { code: 'NO_TRADE_NO_QUALIFIED_STOCK', text: 'No new entries: no stock passes the score and fundamentals checks.' };
  else if (market.band === 'research') decision = { code: 'RESEARCH_ONLY', text: `Research band (score ${round(market.score, 1)}): watch only, no funded entries.` };
  else if (!sess.allowNewEntries) decision = { code: 'NO_TRADE_SESSION', text: `${sess.label}: short session, manage open positions only.` };
  else decision = { code: 'WATCH', text: `Watch the list below. Up to ${slots} new position(s) may be opened.` };

  const riskPct = cfg.market.riskPctByBand[market.band] || 0;
  const rows = watch.map((c, k) => {
    const s = bt.bySymbol.get(c.symbol), i = s.idx.get(D);
    const close = s.close[i], atr = s.atr[i], breakoutLevel = s.priorHigh[i];
    const stopDist = cfg.risk.stopAtrMultiple * atr, stopPct = (stopDist / close) * 100;
    const qtyRisk = riskPct > 0 ? Math.floor((equity * riskPct) / 100 / stopDist) : 0;
    const qtyCash = Math.floor(Math.min((equity * cfg.account.maxAllocationPct) / 100, cash) / (close * 1.0015));
    return {
      rank: k + 1, symbol: c.symbol, sector: c.sector, score: round(c.score, 1), close, atr: round(atr), atrPct: round((atr / close) * 100),
      breakoutLevel, maxEntryPrice: round(breakoutLevel + cfg.breakout.maxEntryExtensionAtr * atr), stopDistance: round(stopDist), stopPct: round(stopPct),
      stopTooWide: stopPct > cfg.risk.maxStopDistancePct, plannedQty: Math.min(qtyRisk, qtyCash), plannedValue: Math.round(Math.min(qtyRisk, qtyCash) * close),
      roePct: c.fund ? c.fund.roePct : null, profitGrowthPct: c.fund ? c.fund.profitGrowthPct : null, fundYear: c.fund ? c.fund.period : null,
      factors: c.factors, rsi: c.metrics.rsi, relVol: c.metrics.relVol, ret20: c.metrics.ret20,
    };
  });
  const usSessions = market.components.us && market.components.us.detail ? Object.values(market.components.us.detail).map(x => x && x.session).filter(Boolean) : [];
  return {
    session: E, basedOnClose: D, sessionInfo: { label: sess.label, tradingStart: sess.tradingStart, orbFrom: minTo(sess.orEndMin), tradeCutoff: sess.tradeCutoff, tradingEnd: sess.tradingEnd, allowNewEntries: sess.allowNewEntries },
    market: { score: round(market.score, 1), domesticScore: round(market.domesticScore, 1), band: market.band, gate: market.gate ? `${market.gate.type}: ${market.gate.reason}` : null, missing: market.missing,
      components: Object.fromEntries(Object.entries(market.components).map(([k, v]) => [k, v.available ? round(v.score, 1) : null])), latestUsSession: usSessions.sort().pop() || null },
    riskPct, slots, decision, qualifiedCount: scan.qualified.length, watchlist: rows, maxStopPct: cfg.risk.maxStopDistancePct,
    droppedForFundamentals: dropped.map(c => ({ symbol: c.symbol, score: round(c.score, 1), roePct: c.fund ? c.fund.roePct : null, profitGrowthPct: c.fund ? c.fund.profitGrowthPct : null, reason: c.fundBlock })),
  };
}

// ─── Report ──────────────────────────────────────────────────────────────────

function positionView(p) {
  const nextStop = p.pendingStop !== null && p.pendingStop > p.stop ? p.pendingStop : p.stop;
  const unreal = p.qty * (p.lastPrice - p.entry);
  return {
    id: p.id, symbol: p.symbol, entryDate: p.entryDate, entryTime: p.entryTime, method: p.entryMethod, entry: round(p.entry), qty: p.qty,
    initialStop: round(p.initialStop), stopNextSession: round(nextStop), trailArmed: p.trailActive, highest: round(p.highest || p.maxHigh), lastPrice: round(p.lastPrice),
    unrealizedPnl: Math.round(unreal), unrealizedR: round(unreal / p.initialRisk), sessionsHeld: p.sessionsHeld + 1, value: Math.round(p.qty * p.lastPrice),
    sellAtNextOpen: !!p.exitAtNextOpen,
  };
}

function buildMarkdown(r) {
  const L = [];
  const a = r.account, pl = r.plan;
  L.push(`# Paper trading — ${r.experimentId}`, '');
  L.push(`Report for the session of **${r.asOf || '—'}**, generated ${r.generatedAt}. Paper account opened ${r.start} with ₹${fmt(r.initialEquity, 0)}; config hash \`${r.configHash}\`.`, '');
  if (r.warnings.length) { L.push('## ⚠ Check first', ''); for (const w of r.warnings) L.push(`- ${w}`); L.push(''); }

  L.push('## Account', '', '| | |', '|---|---:|');
  for (const [k, v] of [['Equity ₹', fmt(a.equity, 0)], ['Cash ₹', fmt(a.cash, 0)], ['Return since start', `${fmt(a.returnPct)}%`], ['Max drawdown', `${fmt(a.maxDrawdownPct)}%`],
    ['Open positions', `${a.openPositions} of ${r.maxOpenPositions}`], ['Closed trades', a.closedTrades]]) L.push(`| ${k} | ${v} |`);
  L.push('');

  L.push(`## Last session (${r.asOf || '—'})`, '');
  if (!r.lastSession) L.push('_The paper account has not traded yet._', '');
  else {
    L.push(`Decision before the open: **${r.lastSession.decision}** ${r.lastSession.detail ? `— ${r.lastSession.detail}` : ''}`, '');
    if (r.lastSession.events.length) { L.push('| Time | Symbol | Event | Price ₹ | Detail |', '|---|---|---|---:|---|'); for (const e of r.lastSession.events) L.push(`| ${e.time} | ${e.symbol} | ${e.type} | ${fmt(e.price)} | ${e.detail || ''} |`); L.push(''); }
    else L.push('_No entries, exits or stop changes._', '');
  }

  L.push('## Open positions', '');
  if (!r.openPositions.length) L.push('_None._', '');
  else {
    L.push('| Symbol | Entered | Method | Entry ₹ | Qty | Last ₹ | P&L ₹ | R | Stop for next session ₹ | Trail armed | Sessions |', '|---|---|---|---:|---:|---:|---:|---:|---:|---|---:|');
    for (const p of r.openPositions) L.push(`| ${p.symbol} | ${p.entryDate} ${p.entryTime} | ${p.method} | ${fmt(p.entry)} | ${p.qty} | ${fmt(p.lastPrice)} | ${fmt(p.unrealizedPnl, 0)} | ${fmt(p.unrealizedR)} | ${p.sellAtNextOpen ? '**sell at open**' : fmt(p.stopNextSession)} | ${p.trailArmed ? 'yes' : 'no'} | ${p.sessionsHeld} |`);
    L.push('');
  }

  L.push(`## Plan for ${pl.session}${pl.preview ? ' (preview — paper account not open yet)' : ''}${pl.preliminary ? ' (preliminary)' : ''}`, '');
  L.push(`Based on the close of ${pl.basedOnClose}. Session ${pl.sessionInfo.tradingStart}–${pl.sessionInfo.tradingEnd}${pl.sessionInfo.label !== 'normal' ? ` (${pl.sessionInfo.label})` : ''}; no new entries after ${pl.sessionInfo.tradeCutoff}.`, '');
  L.push(`Market score **${fmt(pl.market.score, 1)}** (${pl.market.band}${pl.market.gate ? `, ${pl.market.gate}` : ''}), domestic ${fmt(pl.market.domesticScore, 1)}. Risk per trade **${pl.riskPct}%** of equity. Free slots: ${pl.slots}.`, '');
  L.push(`**${pl.decision.text}**`, '');
  if (pl.watchlist.length) {
    L.push('| # | Symbol | Score | Close ₹ | Breakout level ₹ | Don\'t buy above ₹ | Stop distance | Qty at plan risk | ROE % | Profit growth % |', '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const w of pl.watchlist) L.push(`| ${w.rank} | ${w.symbol} | ${fmt(w.score, 1)} | ${fmt(w.close)} | ${fmt(w.breakoutLevel)} | ${fmt(w.maxEntryPrice)}${w.close > w.maxEntryPrice ? ' ⚠' : ''} | ₹${fmt(w.stopDistance)} (${fmt(w.stopPct)}%)${w.stopTooWide ? ' ⛔' : ''} | ${fmt(w.plannedQty, 0)} | ${fmt(w.roePct, 1)} | ${fmt(w.profitGrowthPct, 1)} |`);
    L.push('');
    if (pl.watchlist.some(w => w.close > w.maxEntryPrice)) L.push('⚠ = already closed above its "don\'t buy above" price; it can only be bought after a pullback below it.', '');
    if (pl.watchlist.some(w => w.stopTooWide)) L.push(`⛔ = stop would be wider than ${pl.maxStopPct}% of price; any signal will be rejected.`, '');
  }
  if (pl.droppedForFundamentals.length) L.push(`Not bought for fundamentals (on the technical top 10): ${pl.droppedForFundamentals.map(d => `${d.symbol} (ROE ${fmt(d.roePct, 1)}%, growth ${fmt(d.profitGrowthPct, 1)}%)`).join(', ')}.`, '');
  L.push('**Entry rules (5-minute candles):**',
    `- *Opening-range breakout:* from ${pl.sessionInfo.orbFrom}, a candle that closes above the ${pl.sessionInfo.tradingStart}–${pl.sessionInfo.orbFrom} high, above VWAP, with at least 1.5× its usual volume for that time and a close in the top 40% of the candle. Buy at the next candle's open.`,
    '- *VWAP pullback:* after at least 3 candles, mostly above a rising VWAP, the price dips to within 0.25% of VWAP and the next candle closes back above it as a strong green candle, on rising volume and stronger than NIFTY. Buy at the next candle\'s open.',
    '- The earliest signal wins; skip it if the price is above "Don\'t buy above" or the stop is marked ⛔.',
    '- *After buying:* stop = entry − 2 × ATR. Once the price is 3% above entry, the stop trails 4% below the highest price, and never below entry + 1%. Stops are checked on 1-minute candles.', '');

  const p = r.performance;
  L.push('## Performance since start', '');
  L.push('| | Paper | Backtest Jun 2024 – Nov 2026 |', '|---|---:|---:|');
  for (const [k, a1, b1] of [['Closed trades', p.trades, r.reference.trades], ['Win rate %', p.winRatePct, r.reference.winRatePct], ['Avg R per trade', p.avgR, r.reference.avgR], ['Profit factor', p.profitFactorNet, r.reference.profitFactorNet], ['Avg win R / loss R', `${fmt(p.avgWinR)} / ${fmt(p.avgLossR)}`, `${fmt(r.reference.avgWinR)} / ${fmt(r.reference.avgLossR)}`]])
    L.push(`| ${k} | ${typeof a1 === 'number' ? fmt(a1, 3) : a1 ?? '—'} | ${typeof b1 === 'number' ? fmt(b1, 3) : b1 ?? '—'} |`);
  L.push('', p.trades < 30 ? `_Only ${p.trades || 0} closed trade(s): far too few to judge. About 30+ trades are needed before comparing with the backtest._` : '', '');
  if (r.closedTrades.length) {
    L.push('## Closed trades', '', '| # | Symbol | Entry | Exit | Entry ₹ | Exit ₹ | Reason | Net ₹ | R |', '|---:|---|---|---|---:|---:|---|---:|---:|');
    r.closedTrades.forEach((t, i) => L.push(`| ${i + 1} | ${t.symbol} | ${t.entryDate} ${t.entryTime} | ${t.exitDate} ${t.exitTime} | ${fmt(t.entry)} | ${fmt(t.exit)} | ${t.exitReason} | ${fmt(t.netPnl, 0)} | ${fmt(t.rMultiple)} |`));
    L.push('');
  }
  L.push('## Data', '', `- Daily candles up to ${r.data.lastDailyCandle}; NSE calendar from ${r.data.calendarFetchedOn || 'n/a'}; fundamentals snapshot ${r.data.fundamentalsSnapshot}.`,
    `- Intraday data missing for this replay: ${r.data.intradayMissing}. Days replayed on 1-minute bars: ${r.data.mgmt1m}, fallbacks: ${r.data.mgmtFallbacks}.`, '');
  L.push('_Paper trading only. Results here are simulated fills at candle opens with 0.1% slippage and Zerodha charges, not real orders._', '');
  return L.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = istNow();
  const warnings = [];
  const configPath = path.resolve(args.config || DEFAULT_CONFIG);
  const cfg = loadConfig(configPath);
  cfg.data.source = 'files';                       // Upstox daily files, refreshed by this script
  const paperDir = args.dir ? path.resolve(args.dir) : path.join(DATA_DIR, 'paper', cfg.strategy.experimentId);
  const metaFile = path.join(paperDir, 'meta.json');

  // Paper account identity: start date, equity and the frozen config hash.
  let meta = fs.existsSync(metaFile) ? readJson(metaFile) : null;
  if (!meta) {
    if (!args.start || !/^\d{4}-\d{2}-\d{2}$/.test(args.start)) throw new Error('First run: pass --start YYYY-MM-DD (the first session the paper account may trade).');
    cfg.account.initialEquity = args.equity ? Number(args.equity) : cfg.account.initialEquity;
    meta = { experimentId: cfg.strategy.experimentId, configFile: path.relative(ROOT, configPath), start: args.start, initialEquity: cfg.account.initialEquity, configHash: hashOf(strategyPart(cfg)), createdAt: new Date().toISOString(), config: cfg };
    writeJson(metaFile, meta);
    console.log(`Opened paper account ${meta.experimentId}: start ${meta.start}, equity ₹${fmt(meta.initialEquity, 0)}, config ${meta.configHash}`);
  } else {
    if (args.start && args.start !== meta.start) throw new Error(`This paper account started on ${meta.start}. To start over, move ${path.relative(ROOT, paperDir)} aside first.`);
    cfg.account.initialEquity = meta.initialEquity;
    const h = hashOf(strategyPart(cfg));
    if (h !== meta.configHash) throw new Error(`Strategy config changed since the paper account opened (${meta.configHash} → ${h}). Paper trading needs a frozen strategy: use a new experiment id for the new rules.`);
  }

  const to = args.to && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? args.to : now.minutes >= 18 * 60 ? now.date : addDays(now.date, -1);
  const allowFetch = !args['no-fetch'];
  const ex = await exchangeCalendar(allowFetch, warnings);

  if (allowFetch) {
    console.log(`▶ Updating daily candles to ${to}`);
    runFetcher(['daily', '--to', to]);
    runFetcher(['global', '--to', to]);
  }

  const load = async () => {
    const bt = new SwingBacktest(cfg, { quiet: true });
    bt.runtimeSessions = runtimeSessions(ex, cfg.session.normal);
    await bt.load();
    return bt;
  };
  let bt = await load();
  const D = bt.calendar.filter(d => d <= to).pop();
  if (D < to && isTradingDay(to, ex) && to <= now.date) warnings.push(`Daily data stops at ${D}, but ${to} was a trading session. Upstox may not have published it yet; re-run later.`);

  // Replay every completed session since the start, fetching intraday data until nothing is missing.
  let replayed = false;
  if (D >= meta.start) {
    for (let pass = 1; pass <= 5; pass++) {
      bt.run({ from: meta.start, to: D, keepOpen: true });
      replayed = true;
      if (!bt.intraday.requirements.size) break;
      if (!allowFetch || pass === 5) { warnings.push(`${bt.intraday.requirements.size} intraday symbol-days are missing; affected days used coarser bars or were skipped.`); break; }
      const reqFile = path.join(paperDir, 'intraday-requirements.json');
      writeJson(reqFile, { items: [...bt.intraday.requirements.values()] });
      console.log(`▶ Replay pass ${pass}: fetching ${bt.intraday.requirements.size} missing intraday symbol-days`);
      runFetcher(['intraday', '--requirements', reqFile, '--to', D, '--interval', '1', '--delay', '60']);
      bt = await load();
    }
  }
  const funded = replayed ? bt.funded : { cash: meta.initialEquity, equity: meta.initialEquity, positions: [], trades: [] };
  const curve = replayed ? bt.equityCurve : [];

  // Plan for the next session.
  const E = nextTradingDay(D, ex);
  if (!ex.years.has(E.slice(0, 4))) warnings.push(`NSE holidays for ${E.slice(0, 4)} are not in the calendar yet; ${E} is assumed to be a trading day.`);
  const plan = buildPlan(bt, D, E, funded.equity, funded.cash, funded.positions);
  plan.preview = E < meta.start;
  const usExpected = addDays(E, -1);                     // last US session that should be closed before E 09:00 IST
  plan.preliminary = plan.market.latestUsSession !== null && plan.market.latestUsSession < usExpected && weekday(usExpected) !== 0 && weekday(usExpected) !== 6;
  if (plan.preliminary) warnings.push(`US session of ${usExpected} not closed yet (latest ${plan.market.latestUsSession}): the market score is preliminary. Re-run before 09:00 IST on ${E}.`);

  // Fundamentals freshness (results seasons: mid-Feb, end-May, mid-Aug, mid-Nov).
  const snap = bt.fundStats ? bt.fundStats.snapshotDates.slice(-1)[0] : null;
  if (cfg.fundamentals.enabled) {
    const age = snap ? Math.round((Date.parse(now.date) - Date.parse(snap)) / 86400000) : null;
    if (!snap) warnings.push('No fundamentals snapshot found: run node swing/fetch-swing-data.js fundamentals.');
    else if (age > 95) warnings.push(`Fundamentals snapshot is ${age} days old (${snap}): run node swing/fetch-swing-data.js fundamentals.`);
  }

  // Last session's decision and events.
  let lastSession = null;
  if (replayed) {
    const rec = bt.scans.find(s => s.date === D);
    const events = [];
    const allPos = [...funded.trades, ...funded.positions];
    for (const t of allPos) for (const e of t.events || []) if (e.time.startsWith(D)) {
      events.push({ time: e.time.slice(11), symbol: t.symbol, type: e.type, price: e.price ?? e.to ?? e.high ?? null,
        detail: e.type === 'ENTRY' ? `${e.method}, stop ₹${fmt(e.stop)}` : e.type === 'EXIT' ? e.reason : e.from ? `stop ₹${fmt(e.from)} → ₹${fmt(e.to)}` : '' });
    }
    events.sort((x, y) => (x.time < y.time ? -1 : 1));
    lastSession = { decision: rec ? rec.decision : '—', detail: rec ? rec.detail : '', watchlist: rec ? rec.watchSymbols : '', events };
  }

  // Integrity: already-reported trades must not change when the history is replayed again.
  const ledgerFile = path.join(paperDir, 'ledger.json');
  const prev = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : null;
  const key = t => [t.symbol, t.entryDate, t.entryTime, round(t.entry, 4), t.qty].join('|');
  if (prev && prev.asOf && prev.asOf <= D) {
    const nowKeys = new Map([...funded.trades, ...funded.positions].map(t => [t.id, t]));
    const changed = [];
    for (const t of [...prev.closedTrades, ...prev.openPositions.map(p => ({ ...p, entry: p.entry }))]) {
      const n = nowKeys.get(t.id);
      if (!n || key(n) !== key(t)) changed.push(t.id);
      else if (t.exitDate && (n.exitDate !== t.exitDate || n.exitTime !== t.exitTime || round(n.exit, 4) !== round(t.exit, 4))) changed.push(t.id);
    }
    if (changed.length) warnings.push(`Replaying the history changed ${changed.length} already-reported trade(s): ${changed.join(', ')}. Usually a data revision (new fundamentals snapshot or vendor correction). Previous ledger kept in history/.`);
  }

  // Assemble outputs.
  const eq = curve.length ? equityStats(curve.map(x => ({ ...x })), meta.initialEquity) : { returnPct: 0, maxDrawdownPct: 0 };
  const tStats = tradeStats(funded.trades);
  const refDir = path.join(DATA_DIR, 'reports');
  const refRun = fs.existsSync(refDir) ? fs.readdirSync(refDir).filter(x => x.startsWith(`${cfg.strategy.experimentId}_2026`)).sort().pop() : null;
  const reference = refRun ? readJson(path.join(refDir, refRun, 'summary.json')).trades : {};
  const mgmt = funded.trades.concat(funded.positions).reduce((acc, t) => { for (const [k, v] of Object.entries(t.mgmtDays || {})) acc[k] = (acc[k] || 0) + v; acc.fb += (t.mgmtFallbackDays || 0) + (t.dailyFallbackDays || 0); return acc; }, { fb: 0 });
  const report = {
    experimentId: cfg.strategy.experimentId, configHash: meta.configHash, start: meta.start, initialEquity: meta.initialEquity, maxOpenPositions: cfg.account.maxOpenPositions,
    asOf: replayed ? D : null, generatedAt: now.text, warnings,
    account: { equity: Math.round(funded.equity), cash: Math.round(funded.cash), returnPct: round((funded.equity / meta.initialEquity - 1) * 100), maxDrawdownPct: eq.maxDrawdownPct, openPositions: funded.positions.length, closedTrades: funded.trades.length },
    lastSession, openPositions: funded.positions.map(positionView), plan,
    performance: tStats, reference,
    closedTrades: funded.trades.map(t => ({ id: t.id, symbol: t.symbol, entryDate: t.entryDate, entryTime: t.entryTime, exitDate: t.exitDate, exitTime: t.exitTime, entry: round(t.entry), exit: round(t.exit), qty: t.qty, exitReason: t.exitReason, netPnl: Math.round(t.netPnl), rMultiple: round(t.rMultiple) })),
    data: { lastDailyCandle: D, calendarFetchedOn: ex.fetchedOn, fundamentalsSnapshot: snap || 'n/a', intradayMissing: replayed ? bt.intraday.requirements.size : 0, mgmt1m: mgmt['1'] || 0, mgmtFallbacks: mgmt.fb },
  };
  const ledger = {
    experimentId: cfg.strategy.experimentId, asOf: replayed ? D : null, generatedAt: now.text, equity: report.account.equity, cash: report.account.cash,
    closedTrades: funded.trades.map(t => ({ ...report.closedTrades.find(c => c.id === t.id), entry: t.entry, exit: t.exit })),
    openPositions: funded.positions.map(p => ({ ...positionView(p), entry: p.entry })),
  };

  if (prev) writeJson(path.join(paperDir, 'history', `ledger_${prev.asOf || 'none'}_${Date.now()}.json`), prev);
  writeJson(ledgerFile, ledger);
  writeJson(path.join(paperDir, 'reports', `${D}.json`), report);
  const md = buildMarkdown(report);
  fs.writeFileSync(path.join(paperDir, 'reports', `${D}.md`), md);
  fs.writeFileSync(path.join(paperDir, 'latest.md'), md);
  fs.writeFileSync(path.join(paperDir, 'equity.csv'), ['date,equity,cash,positionValue,openPositions,symbols', ...curve.map(c => `${c.date},${round(c.equity)},${round(c.cash)},${round(c.positionValue)},${c.openPositions},${c.symbol}`)].join('\n') + '\n');

  console.log(`\nPaper ${cfg.strategy.experimentId} — session ${replayed ? D : '(not started)'} | equity ₹${fmt(report.account.equity, 0)} (${fmt(report.account.returnPct)}%) | open ${funded.positions.length} | closed ${funded.trades.length}`);
  console.log(`Plan for ${E}${plan.preview ? ' (preview)' : ''}${plan.preliminary ? ' (preliminary)' : ''}: ${plan.decision.text}`);
  if (plan.watchlist.length) console.log(`  Watch: ${plan.watchlist.map(w => `${w.symbol} ${w.score}`).join(', ')}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log(`Report: ${path.relative(process.cwd(), path.join(paperDir, 'latest.md'))}`);
}

main().catch(err => { console.error(`✗ ${err.stack || err.message}`); process.exitCode = 1; });
