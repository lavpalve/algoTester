# Swing Trading Strategy V1.7b - Frozen Specification

**Status:** Frozen for paper trading starting 9 Nov 2026  
**Backtest Period:** Jun 2024 - Nov 2026 (2.4 years, 98 trades)  
**Performance:** 74.5% win rate, 0.169 avgR, +11.4% return, 5.64% max DD

---

## Strategy Overview

**Type:** Swing trading (multi-day holds, avg 9.5 sessions)  
**Universe:** NIFTY 500 stocks  
**Timeframes:**
- Daily candles for scanning and scoring
- 5-minute candles for entry confirmation
- 1-minute candles for stop management

---

## Market Regime Filter

### Market Score Components (equal weight)

1. **NIFTY 50 Trend** (40-day EMA)
   - Price above EMA: +1
   - Price below EMA: -1

2. **GIFT NIFTY** (futures sentiment)
   - Last price above previous close: +1
   - Below: -1

3. **Sector Strength** (candidate sector vs top-3 leading sectors)
   - Candidate sector strength calculated as mean of its NIFTY 500 constituent returns
   - Leading sectors = top 3 sectors by strength
   - Market component = mean(candidate sector strength, top-3 average)
   - Above 0: positive contribution
   - Below 0: negative contribution

4. **Market Breadth** (advancing vs declining)
   - Net advances > 0: +1
   - Net advances ≤ 0: -1

### Market Bands

| Band | Score Range | Action |
|---|---|---|
| **Favorable** | 60-100 | Trade normally |
| **Cautious** | 40-59 | Trade normally (slightly defensive) |
| **Research** | 50-59 | Shadow ledger only (track but don't commit capital) |
| **Blocked** | < 40 | No new entries |

---

## Stock Selection

### Daily Scoring System (0-100)

**Components:**

1. **Price Action (25 points)**
   - Distance from 52-week high
   - Recent momentum (5-day, 10-day returns)
   - Breakout confirmation

2. **Relative Strength (25 points)**
   - Outperformance vs NIFTY 50
   - Sector relative strength
   - RS trend consistency

3. **Technical Setup (25 points)**
   - Consolidation quality
   - Volume patterns
   - Support/resistance levels

4. **Volatility & Volume (25 points)**
   - ATR percentile
   - Volume surge
   - Liquidity check

**Minimum Score:** 80 (out of 100)

### Watchlist Selection

- **Mode:** Watchlist (top 10 stocks rebuild daily)
- **Max watchlist size:** 10 stocks
- **Entry candidates:** Stocks with score ≥ 80
- **Rebuild:** Every session (fresh scan daily)

---

## Fundamentals Gate (Entry Check Mode)

**Mode:** Entry check (not scan filter)
- Watchlist remains the technical top 10
- Fundamentals check blocks purchases, not rankings

**Requirements (ANY condition must pass):**

1. **ROE ≥ 15%** (Return on Equity)
   - Uses latest yearly data
   - Snapshot updated quarterly after earnings

2. **Profit Growth ≥ 15%** (YoY net profit growth)
   - Compares latest year vs previous year
   - Excludes negative profit stocks

**Combine Logic:** `"any"` (ROE ≥15% OR growth ≥15%)

**Additional:** Require positive profit (no loss-making companies)

**Data Source:** Upstox Analytics API (yearly income statement + balance sheet)
**Update Frequency:** After earnings season (quarterly)

---

## Entry Rules

### Entry Methods (3 patterns)

1. **Opening Range Breakout (ORB)**
   - Price breaks above first 15-minute high
   - Volume confirmation
   - No immediate resistance overhead

2. **VWAP Pullback**
   - Price pulls back to VWAP
   - Holds and bounces
   - Momentum still intact

3. **Confluence**
   - Multiple support levels align
   - Technical + volume + momentum confluence
   - Stronger setup (historically 83% win rate)

### Entry Confirmation (5-minute bars)

- Wait for 5-minute bar close above trigger
- Must occur during market hours (9:15 AM - 3:30 PM IST)
- Skip if entry would occur in last 30 minutes

### Position Sizing

- **Risk per trade:** 1% of equity
- **Stop loss:** Entry price - 2 × ATR(14)
- **Position size:** (Equity × 1%) / (Entry - Stop)
- **Max position size:** 25% of equity (risk gate)
- **Max open positions:** 2

### Entry Gates (Must ALL Pass)

1. ✅ **Score ≥ 80** (technical quality)
2. ✅ **Market score ≥ 40** (not blocked band)
3. ✅ **Fundamentals check** (ROE ≥15% OR growth ≥15%)
4. ✅ **Risk gate** (position size ≤ 25% equity)
5. ✅ **Open positions < 2** (max concurrent positions)
6. ✅ **Entry method triggered** (ORB, VWAP pullback, or confluence)
7. ✅ **No existing position** in same stock

---

## Exit Rules

### Initial Stop Loss

- **Calculation:** Entry - 2 × ATR(14)
- **Type:** Fixed stop (doesn't move)
- **Checked:** Every 1-minute bar
- **Sequencing:** Stop-first (if bar hits both stop and target, assume stop hit first)

### Trailing Stop (4% Trail)

**Activation:**
- Trail arms when price reaches **entry + 3%**
- Before activation, only initial stop protects position

**Trail Calculation:**
- Trail = Highest close since entry - 4%
- **Minimum trail:** Entry + 1% (lock in at least 1% profit)
- Trail never goes down (only moves up or stays flat)

**Trail Management:**
- Checked on every 1-minute bar close
- Trail updates on new high close
- Exit when 1-min close < trail level

**Why 4% Trail?**
- Tested 4%, 5%, 6%, 7% on same backtest window
- 5% and 7% underperformed (statistical noise)
- 4% gave highest win rate (74.5%) with consistent results
- Lower overnight gap risk vs wider trails

### Exit Priority

1. **Initial stop hit** → Exit immediately (-1.04R avg)
2. **Trailing stop hit** → Exit immediately (+0.58R avg)
3. **End of backtest** → Close all positions (paper trading ignores this)

**No time-based exits, no profit targets.**

---

## Risk Management

### Position Level

- **Stop loss:** 2 × ATR (avg -1.04R when hit)
- **Trail activation:** +3% from entry
- **Trail distance:** 4% from highest close
- **Minimum profit lock:** Entry + 1%

### Account Level

- **Max open positions:** 2
- **Risk per trade:** 1% of equity
- **Max position size:** 25% of equity
- **Max concurrent risk:** 2% (2 positions × 1% each)

### Session Rules

- **Entries considered:** Only on sessions starting flat (no intraday re-entries)
- **Stop checked:** Every 1-minute bar
- **Trail checked:** Every 1-minute bar (after activation)

---

## Data Requirements

### Daily Data (MongoDB)

- **Stocks:** 495 NIFTY 500 constituents (collection: `stocks`)
- **Index:** NIFTY 50 daily candles (collection: `index_candles_daily`)
- **History:** 2021-11-08 onwards (for indicators)
- **Adjustments:** Split/bonus adjusted, not dividend-adjusted

### Intraday Data (File Cache)

- **5-minute bars:** Entry confirmation (cached in `data/swing/intraday/`)
- **1-minute bars:** Stop management (cached in `data/swing/intraday/`)
- **Fetch:** On-demand from Upstox (historical API)
- **Cache:** Permanent (reused across backtests)

### Fundamentals Data (MongoDB)

- **Collection:** `fundamentals_snapshots`
- **Endpoints:** 6 per stock (incomeYearly, balanceSheetYearly, etc.)
- **Stocks:** 495 (491 with data, 4 missing)
- **Update:** Quarterly after earnings season
- **Fields used:** ROE, net profit, previous year profit

---

## Expected Performance

Based on backtest (Jun 2024 - Nov 2026):

| Metric | Value |
|---|---:|
| **Total trades** | 98 |
| **Win rate** | 74.5% (73 wins, 25 losses) |
| **Average R** | 0.169 |
| **Avg win R** | 0.58 |
| **Avg loss R** | -1.04 |
| **Profit factor** | 1.52 |
| **Return** | +11.4% (vs NIFTY +7.6%) |
| **CAGR** | 4.56% |
| **Max drawdown** | 5.64% |
| **Avg hold time** | 9.5 sessions |
| **Exposure** | 56% (in market 56% of time) |
| **Trades/year** | ~40 |

### Exit Reason Breakdown

| Exit Reason | Trades | Win % | Avg R |
|---|---:|---:|---:|
| **Trailing stop** | 70 (71%) | 100% | +0.58 |
| **Initial stop** | 22 (22%) | 0% | -1.06 |
| **Gap stop** | 6 (6%) | 33% | -0.47 |

### Win/Loss Distribution

- Small wins (0-0.5R): 49 trades (50%)
- Medium wins (0.5-1R): 8 trades (8%)
- Big wins (≥1R): 16 trades (16%)
- Losses: 25 trades (26%)

**Profit comes from high frequency of small wins.**

---

## Entry Method Performance

| Method | Trades | Win % | Avg R |
|---|---:|---:|---:|
| **ORB** | 40 (41%) | 75% | 0.207 |
| **VWAP Pullback** | 36 (37%) | 72% | 0.065 |
| **Confluence** | 22 (22%) | 77% | 0.264 |

All three methods work. Confluence has best avgR but fewer opportunities.

---

## Watchlist Rank Performance

| Rank | Trades | Win % | Avg R |
|---|---:|---:|---:|
| **Rank 1** (highest score) | 25 (26%) | 68% | 0.026 |
| **Rank 2-5** | 63 (64%) | 78% | 0.216 |
| **Rank 6-10** | 10 (10%) | 70% | 0.108 |

**Rank 2-5 performed best.** Rank 1 stocks often already moved (overbought).

---

## Known Limitations

### Backtest Limitations

1. **Survivorship bias:** Uses current NIFTY 500 list for all historical dates
2. **5-minute sequencing:** Cannot reproduce order book, queue position, partial fills
3. **Stop-first assumption:** If bar hits both stop and target, assumes stop hit first
4. **Gap handling:** Uses open price for gap stops (may differ from actual broker fill)
5. **Slippage:** Fixed 0.05% assumed (may be higher in illiquid stocks)

### Data Quality

- GIFT NIFTY: No free history (component removed from market score)
- Sector indices: Use equal-weighted composites (not official NSE sector indices)
- Intraday bars: 69 symbol-days missing (fetched on-demand)
- Fundamentals: 4 stocks have no data (filtered out automatically)

---

## Configuration File

**Location:** `swing/experiments/v1.7b-check-roe15-or-growth15.json`

```json
{
  "strategy": {
    "experimentId": "V1.7b-check-roe15-or-growth15",
    "description": "V1.5b (4% trail) with one change: watchlist stays the technical top 10; only buy names with profit > 0 and (ROE ≥ 15% or profit growth ≥ 15%)."
  },
  "data": {
    "source": "mongo"
  },
  "management": {
    "intervalMinutes": 1
  },
  "stockScore": {
    "minScore": 80
  },
  "selection": {
    "mode": "watchlist",
    "maxWatchlist": 10
  },
  "account": {
    "maxOpenPositions": 2
  },
  "trailing": {
    "trailPct": 4
  },
  "fundamentals": {
    "enabled": true,
    "mode": "entryCheck",
    "filter": {
      "requirePositiveProfit": true,
      "minRevenueGrowthPct": null,
      "minProfitGrowthPct": 15,
      "minRoePct": 15,
      "combine": "any"
    }
  }
}
```

---

## Paper Trading Setup

**Start Date:** 9 Nov 2026  
**Initial Equity:** ₹10,00,000  
**Account Directory:** `data/swing/paper/V1.7b-check-roe15-or-growth15/`

**Daily Automation:**
```bash
npm run swing:daily
```

**Cron Schedule:**
```cron
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /Users/ankush/.nvm/versions/node/v24.14.1/bin/npm run swing:daily >> ~/swing-daily.log 2>&1
```

**Report Location:** `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`

---

## Monitoring & Review

### Daily Checks

- ✅ Cron ran successfully (check `~/swing-daily.log`)
- ✅ Report generated with watchlist
- ✅ Fundamentals gate blocking/allowing stocks correctly
- ✅ No data fetch errors

### Weekly Review

- Compare paper trades vs backtest expectations
- Check if entry methods are triggering correctly
- Verify stop losses are being hit at correct prices

### Monthly Review (After 30+ Trades)

**Calculate:**
- Paper avgR vs backtest (0.169 expected)
- Paper win rate vs backtest (74.5% expected)
- Paper profit factor vs backtest (1.52 expected)

**Investigate if significantly different:**
- Are fundamentals blocking too many stocks?
- Are entry prices worse in live market vs backtest?
- Are stops being hit more often (higher volatility)?
- Is market regime different from backtest period?

---

## Success Criteria

**Continue if:**
- ✅ Paper avgR within ±50% of backtest (0.085 to 0.254)
- ✅ Paper win rate within ±10% of backtest (64.5% to 84.5%)
- ✅ Drawdown within tolerance (< 10%)

**Investigate if:**
- ⚠️ Paper avgR < 0.085 for 30+ trades
- ⚠️ Paper win rate < 65% for 30+ trades
- ⚠️ Drawdown > 10%

**Stop if:**
- ❌ Paper avgR negative after 50+ trades
- ❌ Paper win rate < 55% after 50+ trades
- ❌ Drawdown > 15%

---

## Version History

- **V1.0** - Baseline strategy (no fundamentals)
- **V1.5b** - Optimized trailing stop (4%), improved scoring
- **V1.6a/b/c** - Fundamentals in scan mode (failed - removed good stocks)
- **V1.7a** - Fundamentals entry check (ROE only)
- **V1.7b** - Fundamentals entry check (ROE OR growth) ⭐ **FROZEN**
- **V1.7c** - Fundamentals entry check (growth only)
- **V1.7e/f/g** - Trail width tests (5%, 6%, 7%) - confirmed 4% is best

---

## Notes

- This is a **frozen specification** for paper trading
- Do not modify parameters during paper trading period
- After 30+ trades, compare results and decide whether to continue, adjust, or stop
- Fundamentals mode "entryCheck" is critical (scan mode doesn't work)
- 4% trailing stop is optimal (5%, 6%, 7% tested and inferior)
- Strategy avoids stocks that already moved (MOTILALOFS +21% in 5 days was correctly skipped)

---

**End of Specification**
