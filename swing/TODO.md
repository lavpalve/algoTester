# TODO — Swing V1 paper trading

## Before Monday 9 Nov 2026

- [x] Paper trader built and validated
- [x] Automated daily run: `npm run swing:daily`
- [x] Documentation: SWING_QUICKSTART.md, PAPER_TRADING.md
- [ ] Test the daily run on Monday morning before the market opens
- [ ] Decide whether to follow the signals manually or observe only

## Ongoing

- [ ] Run `npm run swing:daily` every trading day (07:00–09:00 IST)
- [ ] Read `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md` for the watchlist
- [ ] Check warnings at the top of the report
- [ ] Update fundamentals after 14 Nov 2026 (Sep-quarter results): `npm run swing:fundamentals`

## After 30+ closed trades

- [ ] Compare paper results with the Jun 2024–Nov 2026 backtest (performance section in the report)
- [ ] Decide: continue paper trading, stop, or go live at reduced size

## If you want to improve V1.7b (not recommended yet)

- Wait until 30+ paper trades confirm the edge
- Then test ideas on 2022–mid-2025 data (development window), validate on mid-2025–Aug 2026, confirm on paper from Sep 2026 onwards
- Never tune on the paper period itself

## If you want 20% a year

V1.7b at 1% risk makes about 4.5% a year. At 2% risk it makes about 9%, but drawdowns go to ~9% and the worst trade is −2.2% of equity.

**More likely path:** V2 momentum portfolio (monthly picks, hold for weeks to months, multiple positions). Use the same fundamentals check, but:
- Select from a wider universe (top 30–50 by 6-month momentum + fundamentals)
- Hold for weeks to months (exit on momentum loss or fundamentals deterioration)
- Risk 2–3% per position, 3–5 positions

This hasn't been built yet. The swing V1 code and data are reusable for it.

## Questions to answer with paper trading

1. Does the fundamentals check actually help, or did we fit noise in Jun 2024–Nov 2026?
2. Do the entry signals work in real-time (ORB, VWAP pullback on 5-minute bars)?
3. Does the trailing stop work, or does it give back too much profit?
4. How often does the market gate block entries? (It should mostly allow them in bull markets and block in crashes.)
5. What is the real trade frequency? (Backtest: ~40 trades/year)

Paper trading is the only way to answer these with genuinely new data.

## Notes

- The paper account is a pure function of the data: re-running gives the same ledger
- Every dated report is kept in `data/swing/paper/V1.7b-check-roe15-or-growth15/reports/`
- The equity curve is saved in `equity.csv`
- Previous ledgers go to `history/` when the ledger changes on replay (usually a data revision)
- The strategy is frozen: any change to V1.7b's rules requires a new experiment id and a new paper account
