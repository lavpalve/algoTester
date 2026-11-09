# Paper Trading — V1.7b

Automated daily paper trading for **V1.7b**: fundamentals check (ROE ≥ 15% or profit growth ≥ 15%), 4% trailing stop, 1% risk per trade.

## Quick start

**Every trading day (07:00–09:00 IST recommended):**

```bash
npm run swing:daily
```

This single command:
1. Shows a quick status (last session, equity, open positions)
2. Updates daily candles (Upstox), global indices (Yahoo) and the NSE calendar
3. Replays every completed session since the paper start
4. Generates today's report: account, open positions, watchlist and plan for the next session

The report is written to:
- `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md` (always the most recent)
- `data/swing/paper/V1.7b-check-roe15-or-growth15/reports/YYYY-MM-DD.md` (historical)

## What the report contains

- **Account:** equity, cash, return, max drawdown, open positions, closed trades
- **Last session:** decision before the open, entries/exits/stops that happened
- **Open positions:** symbol, entry date/time/price, current price, P&L, R, stop for next session, trail status
- **Plan for the next session:** watchlist (up to 10 stocks), breakout levels, max entry prices, planned quantity, fundamentals (ROE %, profit growth %), decision (watch / no new entries / blocked)
- **Entry rules:** opening-range breakout, VWAP pullback (described in the report)
- **Performance:** closed trades, win rate, avg R, profit factor vs the Jun 2024–Nov 2026 backtest
- **Data status:** daily candles up to which date, fundamentals snapshot date, intraday data missing

## Warnings to check

The report lists warnings at the top if:
- Daily data is incomplete (Upstox hasn't published yesterday's session yet)
- US session hasn't closed (market score is preliminary, re-run before 09:00 IST)
- Fundamentals snapshot is old (>95 days since last update)
- NSE holiday calendar is stale or missing
- Replaying the history changed already-reported trades (usually a data revision; previous ledger saved in history/)

## After each results season

Refresh the fundamentals snapshot (mid-Feb, end-May, mid-Aug, mid-Nov):

```bash
npm run swing:fundamentals
```

Next update due: **after 14 Nov 2026** (Sep-quarter results).

## Files

- `data/swing/paper/V1.7b-check-roe15-or-growth15/meta.json` — account identity (start date, equity, frozen config hash)
- `data/swing/paper/V1.7b-check-roe15-or-growth15/ledger.json` — current state (equity, cash, open positions, closed trades)
- `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md` — most recent report
- `data/swing/paper/V1.7b-check-roe15-or-growth15/reports/` — dated reports, one per session
- `data/swing/paper/V1.7b-check-roe15-or-growth15/equity.csv` — daily equity curve
- `data/swing/paper/V1.7b-check-roe15-or-growth15/history/` — previous ledgers (created when a ledger changes on replay)

## MVista dashboard (read-only)

After each run, `daily.sh` calls `swing/publish-paper.js`, which copies the files above into two MongoDB collections:

- `swing_paper_accounts` — one document per paper account (latest state and the equity curve)
- `swing_paper_reports` — one document per daily report

MVista shows them under **Research → Stock Selection → Swing paper trading**. MVista only reads these collections; algoTester is their only writer. The files stay the source of truth, and re-running the publisher replaces the documents with the file contents.

Set the target in `.env`. It must be the same shared database that `mvista_panel_api` uses (its `MONGODB_ATLAS_*` settings), including the database name:

```bash
SWING_PUBLISH_MONGO_URI=mongodb+srv://<user>:<password>@<cluster-host>/msvStorage
```

Without it, publishing is skipped and the local report is unaffected. To publish by hand: `npm run swing:publish`.

## Manual commands

If you need to run parts separately:

```bash
# Update data only (no replay)
node swing/fetch-swing-data.js daily
node swing/fetch-swing-data.js global

# Paper trader with options
node swing/paper-trade.js                    # default: update data, replay, report
node swing/paper-trade.js --to 2026-11-06    # replay up to a specific date
node swing/paper-trade.js --no-fetch         # use local data only

# Refresh fundamentals
node swing/fetch-swing-data.js fundamentals

# Run a backtest for comparison
node swing/backtest-swing.js --config swing/experiments/v1.7b-check-roe15-or-growth15.json
```

## Notes

- **Paper only.** The report gives you the watchlist and signals. You execute them manually on your platform if you choose to follow them.
- **Strategy is frozen.** V1.7b's rules can't be changed without breaking the paper account. Any change requires a new experiment id.
- **Repeatability.** Running the paper trader twice on the same data gives the same ledger. The equity curve is a pure function of the data.
- **Integrity check.** Already-reported trades must not change when the history is replayed. Any change is detected and flagged.
- **Morning vs evening.** A morning run (before 09:15) gives the final plan for the day. An evening run (after 18:00) replays yesterday and gives a preliminary plan for tomorrow.

## Backtest reference (Jun 2024 – Nov 2026)

The report compares paper results with this backtest:

- **Trades:** 98
- **Win rate:** 74.5%
- **Avg R:** +0.169
- **Profit factor:** 1.52
- **Return:** +11.4% over 2.4 years (4.5% annualized at 1% risk)
- **Max drawdown:** 4.9%

About 30+ closed trades are needed before the comparison is meaningful.

## Requirements

- **Upstox:** analytics token in `.env` (`UPSTOX_ANALYTICS_TOKEN`)
- **MongoDB:** running on localhost:27017 (for fundamentals snapshots)
- **Node.js:** v18+
- **Internet:** for data updates

## First-time setup

If the paper account doesn't exist yet:

```bash
node swing/paper-trade.js --start 2026-11-09
```

This creates `data/swing/paper/V1.7b-check-roe15-or-growth15/` and opens the account on the specified date with ₹10,00,000.
