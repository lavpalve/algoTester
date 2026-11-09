# AlgoTester — Project Summary
> **Use this file at the start of every new session to restore full context.**

---

## 1. What This Project Does

A **Node.js/Express backtesting engine** for the *Asymmetric Multi-Level Grid* trading strategy.
No database — everything is stored in flat JSON files.
Designed for rapid iteration: add a version → run backtest → auto-evaluate → promote or reject.

**Core loop:**
```
create/add version → test → auto-evaluate (>2% avg trade profit?) → promote or reject → iterate
```

---

## 2. Project Structure

```
algoTester/
├── data/
│   ├── CEINSYS_INE016Q01014_1minute.json    ← primary 1-min OHLCV dataset (53,817 candles)
│   └── algorithms/
│       ├── _index.json                       ← lightweight registry (list of algorithm codes)
│       └── asymmetric-grid/
│           ├── algo.json                     ← algorithm config + versionSummary (SMALL ~12 KB)
│           └── results/                      ← full backtest results with tradeLogs (gitignored)
│               ├── v1_run1.json
│               ├── v2_run1.json
│               └── ...
│
├── src/
│   ├── models/
│   │   └── algorithm.js      ← directory-based model (version control + auto-promotion)
│   ├── indicators.js         ← technical indicator engine (EMA, SMA, ATR, RSI, MACD, BB)
│   ├── backtestEngine.js     ← full grid strategy simulation (resolves both flat/nested config)
│   ├── dataManager.js        ← candle file I/O, filtering, deduplication
│   └── server.js             ← Express REST API
│
├── scripts/
│   ├── algo.js               ← MAIN: unified CLI for all workflow operations
│   └── appendData.js         ← import new monthly data batches
│
├── test/
│   └── backtest.test.js      ← 4-layer Jest suite (40 tests, ~0.5s)
│
├── PROJECT_SUMMARY.md        ← this file
├── index.js
└── package.json
```

---

## 3. npm Commands

| Command | What it does |
|---|---|
| `npm run algo:create` | Create algorithm + v1 |
| `npm run algo:add` | Add next version (defined in scripts/algo.js) |
| `npm run algo:test` | Backtest latest version, auto-evaluate (promote/reject) |
| `npm run algo:all` | Backtest ALL versions |
| `npm run algo:status` | Print version summary table |
| `npm run algo:compare` | Full comparison with ruleDesc |
| `npm run algo:reset` | Delete algorithm + all results |
| `npm test` | Run 4-layer Jest suite (40 tests, ~0.5s) |
| `npm run append <file>` | Import new monthly JSON data batch |
| `npm run summary` | Print candle dataset summary |
| `npm start` | Start Express API server |

---

## 4. Algorithm Storage — New Lightweight Format

Each algorithm lives in its own directory:
```
data/algorithms/<code>/
├── algo.json          ← SMALL: config + versionSummary[] (always openable)
└── results/
    ├── v1_run1.json   ← LARGE: full backtest result with tradeLog (read on demand)
    └── ...
```

**`algo.json` is NEVER written to with trade logs** — stays tiny (~12 KB) regardless of how many backtests run.

---

## 5. algo.json Schema

```json
{
  "code": "asymmetric-grid",
  "name": "Asymmetric Grid Strategy",
  "description": "...",

  "promotionThreshold": {
    "minAvgTradeProfitPct": 2.0
  },

  "bestVersion": 3,

  "versionSummary": [
    {
      "version": 1,
      "tag": "v1-baseline",
      "status": "promoted",
      "tradingDays": 153,
      "avgTradeProfitPct": 2.67,
      "avgPerDayProfitPct": -0.08,
      "totalPnl": -8107,
      "totalPnlPct": -11.77,
      "totalTrades": 26,
      "winRatePct": 100,
      "maxDrawdownPct": 14.06,
      "promotedAt": "..."
    }
  ],

  "versions": [
    {
      "version": 1,
      "tag": "v1-baseline",
      "indicators": [...],
      "gridConfig": { "step": {...}, "position": {...}, "rebuyLadder": {...} },
      "rules": [...],
      "ruleDesc": {
        "buy": "Rebuy at R1/R2/R3 depth below sell price. ATR-adaptive allocation.",
        "sell": "Sell when price rises 1.5×ATR% above entry. No trend filter."
      }
    }
  ]
}
```

---

## 6. Auto-Promotion Logic

After every `test` run:
- Computes `avgTradeProfitPct = (avgTradePnl / capitalPerTrade) * 100`
- If `avgTradeProfitPct >= promotionThreshold.minAvgTradeProfitPct (2.0%)`:
  - Sets `status = "promoted"`, records `promotedAt`
  - Updates `bestVersion` if this is the highest `avgTradeProfitPct` so far
- Else: `status = "rejected"`

---

## 7. Version Definitions

All versions are defined inside `scripts/algo.js` in the `VERSION_DEFINITIONS` array.
To add a new version: append to the array → run `npm run algo:add` → run `npm run algo:test`.

**Current results (CEINSYS Feb–Sep 2026, 53,817 candles):**

| Ver | Tag | Status | AvgPft% | Trades | WinR% | MaxDD% |
|---|---|---|---|---|---|---|
| v1 | v1-baseline | 🏆 promoted | 2.67% | 26 | 100% | 14.06% |
| v2 | v2-trend-filter | 🏆 promoted | 2.67% | 26 | 100% | 14.06% |
| v3 | v3-optimized | 🏆 **bestVersion** | 5.53% | 18 | 100% | 13.44% |
| v4 | v4-fast-cycle | 🏆 promoted | 2.05% | 16 | 100% | 12.44% |

**Why negative total PnL but 100% win rate?**
Every completed rebuy cycle IS profitable (sold high, rebought lower = positive realized PnL). The negative total PnL is **unrealized MTM loss** on the initial 100 shares as price declined below the entry price. This is expected behavior for a long-bias grid in a bear phase. The `avgTradeProfitPct` metric captures the per-cycle efficiency.

**bestVersion = v3** because v3's wider ATR step (2x) and deeper ladder captures more profit per cycle (5.53% vs 2.67%).

---

## 8. Backtest Engine — gridConfig formats

The engine (`backtestEngine.js`) accepts BOTH gridConfig formats automatically via `resolveConfig()`:

```js
// Format 1 — Flat (used in tests)
{ stepMode: 'ATR', atrStepMultiplier: 1.5, rebuyLevels: [...], ... }

// Format 2 — Nested (used in algo.js / algorithm model)
{ step: { mode: 'ATR', atrMultiplier: 1.5 }, rebuyLadder: { levels: [...] }, ... }
```

---

## 9. Test Architecture (4 Layers)

**File:** `test/backtest.test.js` — **40 tests, ~0.5s**

| Layer | Tests |
|---|---|
| Layer 1 — Indicators | SMA, EMA, RSI, ATR, computeIndicators |
| Layer 2 — Algorithm Model | CRUD, versionSummary, auto-promotion (promoted/rejected), ruleDesc |
| Layer 3 — Backtest Engine | runBacktest on synthetic data, edge cases |
| Layer 4 — Transparency Gate | Expected vs Actual comparison, versionSummary populated |

---

## 10. Data Format

**Candle array:** `[timestamp, open, high, low, close, volume, open_interest]`

**Data file:** `data/CEINSYS_INE016Q01014_1minute.json`
Format: `{ "status": "success", "data": { "candles": [[...], ...] } }`

**Adding new data:**
```bash
npm run append path/to/OCT_2026_data.json
```

---

## 10b. Swing Trading V1 (separate research track)

`swing/` holds a standalone backtest of the frozen *Swing Trading Backtest Plan v1.0*
(NIFTY 500 universe, market gate, top-1 stock ≥75, ORB / VWAP-pullback entries, ATR stop + trailing stop).
It does not use `src/` or the grid engine. Data cache and reports live in `data/swing/`.
See `swing/README.md`; commands: `npm run swing:fetch`, `npm run swing:backtest`, `npm run swing:fetch-intraday`.

---

## 11. Next Steps

- Tune `promotionThreshold` — currently 2% avgTradeProfitPct. May need to factor in `maxDrawdownPct` too.
- Fix Sharpe ratio — currently per-trade PnL, should use daily returns
- Add more months to dataset (currently Feb–Sep 2026)
- Add POST /api/algo/test endpoint to trigger backtests from the API
- Experiment with RSI entry filter as an indicator in a v5
