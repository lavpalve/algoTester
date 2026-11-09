# Swing Trading V1.7b — Quick Start

Automated paper trading for **V1.7b**: fundamentals check (ROE ≥ 15% or profit growth ≥ 15%), 4% trailing stop, 1% risk per trade.

## One command to run everything

**Every trading day (07:00–09:00 IST recommended):**

```bash
npm run swing:daily
```

This single command:
1. Shows a quick status (last session, equity, open positions)
2. Updates daily candles, global indices and the NSE calendar
3. Replays every completed session since the paper start
4. Generates today's report with your watchlist and trading plan

The report is written to: **`data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`**

## What you get in the report

- **Quick status:** equity, cash, return, drawdown, open positions
- **What happened yesterday:** entries, exits, stop changes
- **Your watchlist for today:** up to 10 stocks with breakout levels, max entry prices, planned quantity, fundamentals (ROE %, profit growth %)
- **Entry rules:** opening-range breakout, VWAP pullback
- **Performance:** closed trades, win rate, avg R per trade vs the Jun 2024–Nov 2026 backtest

## First time only

The paper account is already opened and ready. If you need to start over:

```bash
node swing/paper-trade.js --start 2026-11-09
```

## After each results season

Update fundamentals (mid-Feb, end-May, mid-Aug, mid-Nov):

```bash
npm run swing:fundamentals
```

Next update due: **after 14 Nov 2026** (Sep-quarter results).

## That's it

- **Morning run** (before 09:15): gives the final watchlist for the day
- **Evening run** (after 18:00): replays yesterday, gives a preliminary plan for tomorrow
- **Paper only:** the report gives you signals; you execute them manually if you choose to follow them
- **Strategy frozen:** V1.7b's rules can't be changed without starting a new paper account

Full documentation: [swing/PAPER_TRADING.md](swing/PAPER_TRADING.md)

## Example: reading the watchlist

From the report:

```
Plan for 2026-11-09

Market score 64.7 (cautious), domestic 73.6. Risk per trade 0.5% of equity. Free slots: 2.

Watch the list below. Up to 2 new position(s) may be opened.

| # | Symbol     | Score | Close ₹ | Breakout level ₹ | Don't buy above ₹ | Stop distance | Qty | ROE % | Profit growth % |
|---|------------|-------|---------|------------------|-------------------|---------------|-----|-------|-----------------|
| 1 | SHYAMMETL  | 91.9  | 1,300.6 | 1,283.7          | 1,377.6           | ₹93.9 (7.22%) | 53  | 8.6   | 16.6            |
| 2 | GLENMARK   | 88.7  | 2,590   | 2,542.2          | 2,722.12          | ₹179.92 (7%)  | 27  | 13    | 30.1            |
```

**How to use it:**
- Watch SHYAMMETL and GLENMARK on 5-minute charts
- Buy on the first opening-range breakout or VWAP pullback signal (rules in the report)
- Don't buy SHYAMMETL above ₹1,377.6 or GLENMARK above ₹2,722.12
- Stop = entry − 2 × ATR (about ₹94 for SHYAMMETL, ₹180 for GLENMARK)
- Trail the stop 4% below the highest price once the price is 3% above entry

The report includes your planned quantity and the fundamentals that cleared the check.

## Requirements

- **Upstox:** analytics token in `.env` (`UPSTOX_ANALYTICS_TOKEN`)
- **MongoDB:** running on localhost:27017
- **Node.js:** v18+
- **Internet:** for data updates

That's all you need to know. Run `npm run swing:daily` every trading day and read `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`.
