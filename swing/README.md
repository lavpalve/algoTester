# Swing Trading V1 — backtest & paper trading

Research implementation of the frozen *Swing Trading Backtest Plan v1.0* (7 Nov 2026).
Long-only, one position at a time: market gate → top-1 stock scoring ≥ 75 → ORB / VWAP-pullback
entry on 5-minute bars → 2×ATR(14) stop → trailing stop armed at +3%.

It is separate from the grid tooling in `src/` and `scripts/` and does not touch the
Massive Vista platform, MongoDB or any broker.

| File | Role |
|---|---|
| `backtest-swing.js` | The backtest. One file, Node built-ins only, reads `data/swing/` and never calls the network. Holds the frozen V1 config. |
| `fetch-swing-data.js` | Downloads and caches the data the backtest needs (public endpoints, no credentials). |
| `paper-trade.js` | Daily paper trading: updates data, replays sessions with the frozen config, generates a report. |

## Paper trading

Daily paper trading for V1.7b is automated. See [PAPER_TRADING.md](PAPER_TRADING.md) for full documentation.

**Quick start (every trading day):**

```bash
npm run swing:daily
```

This updates data, replays sessions and generates the report: `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`.

**After each results season** (mid-Feb, end-May, mid-Aug, mid-Nov):

```bash
npm run swing:fundamentals
```

## Backtesting

Run a backtest:

```bash
npm run swing:fetch            # universe, daily OHLCV 2021→yesterday, indices, global, NIFTY 5-min
npm run swing:backtest         # pass 1: lists the 5-min stock data it still needs
npm run swing:fetch-intraday   # downloads those symbol-months
npm run swing:backtest         # repeat the last two steps until no "intraday symbol-days missing" warning
```

Options: `--from YYYY-MM-DD --to YYYY-MM-DD` (run window), `--out <dir>`, `--quiet`,
`--config overrides.json` (experiments).

Reports go to `data/swing/reports/<experimentId>_<timestamp>/` and are copied to
`data/swing/reports/latest/`:

| File | Content |
|---|---|
| `report.md` | Human-readable summary, breakdowns, ledger, data-quality flags |
| `summary.json`, `breakdowns.json` | Metrics, segment / method / regime / exit / year / month / symbol splits |
| `trades.csv`, `trades.json` | Funded ledger (JSON adds stop-change events and signal reasons) |
| `shadow-trades.csv` | Research-only band (50–59) trades; never affect equity |
| `scans.csv` | One row per session: market score + components, candidate, decision and reason |
| `equity.csv` | Daily equity, cash, position value, drawdown |
| `diagnostics.json` | Decision counts, band counts, exclusions, rejections, data-quality flags |
| `run.json` | Full config snapshot, config hash, data sources, universe version, run timestamp |
| `intraday-requirements.json` | 5-min data the run needed but did not find locally |

## How a simulated day works

All data is loaded once at start-up. Each session then uses only what was known before it:

1. Before 09:00 IST, re-score all 495 stocks from daily candles up to the previous close (EMA, RSI,
   MACD, ATR, breakout, relative strength, liquidity) and score the market.
2. Build that day's watchlist: the top stock (V1) or the top N stocks above the score threshold
   (`selection`), skipping stocks already held. The list is different every day (`watchSymbols`
   column in `scans.csv`).
3. Walk the session candle by candle (5 or 15-minute confirmation). The earliest ORB / VWAP-pullback
   signal is bought at the next candle's open, until the free position slots are used.
4. Manage open positions candle by candle (1 or 5-minute) for the stop and trailing stop.

## Experiments

| Config | What changes |
|---|---|
| *(none)* | V1 baseline, frozen spec |
| `experiments/v1.1-1min-management.json` | Stops managed on 1-minute bars |
| `experiments/v1.2-watchlist80-top10.json` | + daily watchlist: top 10 scoring ≥ 80 |
| `experiments/v1.3-watchlist80-top10-2pos.json` | + up to 2 open positions |
| `experiments/v1.4-watchlist80-top10-2pos-15min.json` | + 15-minute entry confirmation |
| `experiments/v1.5a…f-*.json` | V1.3 with only the trailing stop changed: 3%, 4%, 1 / 1.5 / 2 × ATR, daily close below the prior 3-day low |
| `experiments/v1.6a…c-*.json` | V1.5b + fundamentals removed before ranking (`fundamentals.mode: scan`); run with `--from 2024-06-03` |
| `experiments/v1.7a…c-*.json`, `v1.7b-risk*.json` | V1.5b + fundamentals checked only on the technical top 10 (`mode: entryCheck`); risk 1 / 1.5 / 2%; run with `--from 2024-06-03` |
| `experiments/v1.8a/b-*.json` | V1.5b + stricter bear-market gate (NIFTY below EMA50; NIFTY 20-day return < −3%) |
| `experiments/v1.9a/b-*.json` | V1.5b with 3 or 4 open positions |

Fundamentals come from `node swing/fetch-swing-data.js fundamentals` (Upstox analytics token in `algoTester/.env`;
also stored as dated snapshots in MongoDB `fundamentals_snapshots`). Upstox returns only 4 years and 4
quarters, so fundamentals experiments start on 3 Jun 2024. Re-run the command after each results season.

New experiments: a JSON file with only the keys you change and a new experiment id.

```bash
node swing/backtest-swing.js --config swing/experiments/v1.3-watchlist80-top10-2pos.json
node swing/backtest-swing.js --source mongo      # V1 baseline on MongoDB daily data
```

Main switches: `data.source` (`files` | `mongo`), `stockScore.minScore`, `selection.mode`
(`top1` | `watchlist`), `selection.maxWatchlist`, `account.maxOpenPositions`,
`entry.confirmationIntervalMinutes` (5 | 15), `management.intervalMinutes` (1 | 5),
`trailing.mode` (`pct` | `atr` | `dailyLow`) with `trailPct`, `trailAtrMultiple`, `dailyLowLookback`.

After changing the watchlist rules, run the backtest once; if it reports missing intraday days, run
`npm run swing:fetch-intraday` (add `--interval 1`) and run the backtest again. Stored months are
never downloaded twice. Upstox allows 2,000 history calls per 30 minutes, so a large new download
waits between batches.

The script refuses to run changed strategy parameters under the frozen `V1-baseline` id.
Compare runs on the same dates, universe and costs; tune on the development and validation
segments only, never on the test segment.

## MongoDB

`data.source: "mongo"` reads daily stock candles from `msvStorage.stocks` (read-only; duplicates keep
the newest document) and index / global bars from `msvStorage.index_candles_daily`. Load or refresh
that collection with `node swing/fetch-swing-data.js mongo-index`; it is the only collection written.
MongoDB history starts on 8 Nov 2021, so the 52-week breadth check first passes on 11 Nov 2022.

## Data sources and known gaps

- **Universe**: current NIFTY 500 list from NSE archives, applied to all past dates (survivorship bias).
- **Stocks and Indian indices** (daily, 1-minute, 5-minute): Upstox v3 historical candles, keyed by
  ISIN, one call per stock-month. 5 and 15-minute bars are built from 1-minute files when no 5-minute
  file exists. Daily bars are split/bonus-adjusted; intraday bars are additionally
  dividend-adjusted, so the backtest rescales them to daily units per trade.
- **Global**: S&P 500, Nasdaq, Nikkei 225, Hang Seng, KOSPI daily from Yahoo Finance, aligned by
  each exchange's session close so only sessions closed before 09:00 IST are used.
- **GIFT NIFTY**: no free history. The component is reported missing and its 8% weight is removed.
  Drop a file at `data/swing/market/giftnifty.json` (`{ "rows": [["YYYY-MM-DD", preOpenIndication], …] }`) to enable it.
- **Sector strength**: equal-weighted composites of NIFTY 500 constituents by NSE industry.
