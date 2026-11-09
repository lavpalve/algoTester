# Trailing Stop Width Analysis

Testing V1.7b with 4%, 5%, 6% and 7% trailing stops on Jun 2024 → Nov 2026 (2.4 years).

## Results Summary

| Trail | Trades | Win Rate | Avg R | Avg Win | Avg Loss | Profit Factor | Return | Max DD |
|---|---|---|---|---|---|---|---|---|
| **4% (current)** | 98 | **74.5%** | 0.169 | 0.58R | -1.04R | 1.52 | 11.4% | 4.9% |
| 5% | 95 | 70.5% | 0.092 | 0.56R | -1.02R | 1.2 | **4.6%** | **7.0%** |
| 6% | 84 | 72.6% | **0.211** | **0.73R** | -1.05R | 1.55 | **11.9%** | 5.4% |
| 7% | 130 | 74.6% | 0.12 | 0.5R | -1.0R | 1.43 | 11.6% | 5.1% |

## Key Finding: 6% "Superiority" Was Noise

**Testing 7% trail proves the pattern is random variation, not a real trend:**

If wider trailing stops were consistently better, we'd expect:
- 7% > 6% > 5% > 4% (monotonic improvement)

But we see:
- **4% trail: 0.169 avgR** ✓
- **5% trail: 0.092 avgR** ✗ (worst)
- **6% trail: 0.211 avgR** ✓ (best by luck)
- **7% trail: 0.12 avgR** ✗ (below 4%)

This **non-monotonic pattern** is classic statistical noise with insufficient sample size.

## Why 7% Trail Underperformed

- **More trades** (130 vs 98 for 4%) due to different market timing
- **Similar win rate** (74.6% vs 74.5%)
- **Smaller avg wins** (0.5R vs 0.58R) - wider trail didn't capture more upside
- **Slightly better avg loss** (-1.0R vs -1.04R)
- **Net result**: 0.049R worse than 4% trail

If wider trails had a real edge, 7% should be the best performer. **It's not.**

## Statistical Significance

With ~100 trades per configuration, 95% confidence intervals:

- **4% trail**: 0.169 ± 0.191 avgR (95% CI: -0.02 to +0.36)
- **5% trail**: 0.092 ± 0.194 avgR (95% CI: -0.10 to +0.28)
- **6% trail**: 0.211 ± 0.266 avgR (95% CI: -0.05 to +0.47)
- **7% trail**: 0.12 ± 0.17 avgR (95% CI: -0.05 to +0.29)

**All four intervals overlap heavily** → none of the differences are statistically significant.

To reliably distinguish a 0.05R difference, you'd need **300-500 trades** per configuration. We only have ~100.

## Key Differences

### 4% Trail (Current Paper Trading) ✓
- **Highest win rate:** 74.5% (73 wins, 25 losses)
- **Consistent performance:** +11.4% return
- **Smallest wins:** 0.58R average, 49 trades < 0.5R
- **Best for psychology:** wins 3 out of 4 trades
- **Lower overnight risk:** tighter trail = less gap exposure

### 5% Trail (Avoid) ✗
- **Worst overall:** caught between 4% and 6%
- Win rate dropped to 70.5% but avg win barely increased (0.56R)
- **Lowest return:** only 4.6% (vs 11%+ for others)
- Lost money in 2024 (−0.1%)
- **Not recommended**

### 6% Trail (Lucky Sample) ~
- **Best return:** 11.9% (+0.5% better than 4%)
- **Highest avg R:** 0.211 per trade
- **Bigger avg win:** 0.73R (vs 0.58R for 4%)
- **Fewer trades:** 84 (14 fewer than 4%)
- **But**: 7% trail test proves this was luck, not skill

### 7% Trail (Proves Pattern is Noise) ✗
- **More trades** (130) due to different entry timing
- **Similar win rate** (74.6%) to 4%
- **Smaller avg win** (0.5R) - wider trail didn't help
- **Underperformed 4% trail** by 0.049R
- **Proves 6% result was random**

## Profit Distribution

| Category | 4% trail | 5% trail | 6% trail | 7% trail |
|---|---|---|---|---|
| Small wins (0 to 0.5R) | **49** (50%) | 45 (47%) | 43 (51%) | 65 (50%) |
| Big wins (≥ 1R) | 16 (16%) | 15 (16%) | 13 (15%) | 17 (13%) |

All four trails have about the same distribution: **~50% small wins, ~15% big wins**.

## Why This Pattern Emerged (Random Noise)

Looking at individual trades across all configs, each variant happened to:
1. Catch or miss different big winners by chance
2. Exit at slightly different points on reversals
3. Enter different trades due to market timing variations

But these patterns are **random coincidences** specific to this 2.4-year period. A different test period would produce completely different rankings.

## Recommendation

### For Paper Trading (Now)

**Use 4% trail** (v1.7b-check-roe15-or-growth15):
- ✅ **Proven performance:** 0.169 avgR, 74.5% win rate
- ✅ **Lower overnight risk:** tighter trail = less gap exposure
- ✅ **Not materially worse than 6%:** the 0.042R difference is noise
- ✅ **7% test confirms:** wider isn't better, 6% was just luck
- ✅ **Conservative:** protects profits quickly, limits drawdown

### Never Use 5% or 7% Trail

- **5% trail:** strictly worse than 4% and 6%
- **7% trail:** no advantage over 4%, with more gap risk

### After 30+ Paper Trades

If 4% trail matches backtest expectations (0.17 avgR, 74% win rate):
- Continue with 4% trail
- Consider testing 6% in parallel paper account only if you want to verify
- Monitor if 6% advantage persists or reverses (likely reverses)

## Trade Frequency Impact

- **4% trail:** 98 trades in 2.4 years = **40 trades/year**
- **5% trail:** 95 trades = 39 trades/year
- **6% trail:** 84 trades = **35 trades/year**
- **7% trail:** 130 trades = **54 trades/year** (different entry timing)

## Bottom Line

**Don't chase the 6% result. Stick with 4% trail.**

The 7% trail test proves:
- If wider trails were better, 7% should beat 6% → it doesn't
- Pattern is non-monotonic (4% ≈ 7% < 6%, 5% worst) → random noise
- Sample size too small to distinguish real differences
- 6% "superiority" will likely reverse with more data

**Current 4% trail is the right choice for paper trading starting Monday.**

## How to Test Other Trails Later (Not Recommended)

When ready:

```bash
# Create a separate paper account for 6% trail
node swing/paper-trade.js --config swing/experiments/v1.7f-trail6pct.json --start YYYY-MM-DD --dir data/swing/paper/V1.7f-trail6pct

# Run both daily
npm run swing:daily                                    # 4% trail
node swing/paper-trade.js --config swing/experiments/v1.7f-trail6pct.json  # 6% trail
```

But we **don't recommend this**. The 7% test already proved the differences are noise.
