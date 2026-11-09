# Paper Trading Quick Start

Your automated paper trading is now set up! 🎉

## ✅ What's Configured

- **Cron Job:** Runs every weekday at 8:00 AM IST
- **Strategy:** V1.7b (4% trailing stop, ROE ≥15% OR growth ≥15%)
- **Risk:** 1% per trade, max 2 positions
- **Paper Account:** Starting 9 Nov 2026
- **MongoDB:** Running locally
- **Logs:** `~/swing-daily.log`

---

## 🚀 Daily Workflow

### Every Morning (After 8:30 AM)

**View today's report:**
```bash
./view-report.sh
```

Or:
```bash
cat data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md
```

**The report shows:**
- Account status (equity, return %)
- Open positions
- Last session events (fills, stops, exits)
- **Next session watchlist** (top 10 stocks to watch)
- Entry prices and position sizes
- Fundamentals check (which stocks are blocked)

---

## 📊 Quick Commands

```bash
# View latest report
./view-report.sh

# View cron job
crontab -l

# View logs (live)
tail -f ~/swing-daily.log

# Run manually (for testing)
npm run swing:daily

# Check MongoDB
ps aux | grep mongod

# View paper account ledger
cat data/swing/paper/V1.7b-check-roe15-or-growth15/ledger.json

# View equity curve
cat data/swing/paper/V1.7b-check-roe15-or-growth15/equity.csv
```

---

## ⚠️ Important Reminders

### For Cron to Work

1. ✅ **Mac must be powered on** at 8:00 AM weekdays
2. ✅ **Mac must NOT be sleeping** (System Settings → Energy → Turn display off: Never)
3. ✅ **MongoDB must be running** (it is - check with `ps aux | grep mongod`)
4. ✅ **Grant Full Disk Access to cron**:
   - System Settings → Privacy & Security → Full Disk Access
   - Click `+` and add `/usr/sbin/cron`
   - Enable the checkbox

---

## 🔍 Troubleshooting

### Cron didn't run

```bash
# Check cron is set
crontab -l

# Check log for errors
cat ~/swing-daily.log

# Check macOS privacy settings
# System Settings → Privacy & Security → Full Disk Access → /usr/sbin/cron
```

### MongoDB not running

```bash
# Start MongoDB
brew services start mongodb-community@7.0

# Or start manually
mongod --dbpath /opt/homebrew/var/mongodb --logpath /opt/homebrew/var/log/mongodb/mongo.log --fork
```

### Data fetch failed

```bash
# Check UPSTOX_ANALYTICS_TOKEN in .env
cat .env | grep UPSTOX

# Token expires: November 2027
# If expired, get new token from Upstox and update .env
```

---

## 📈 What to Expect (Backtest Results)

Based on Jun 2024 - Nov 2026 backtest:

| Metric | Expected Value |
|---|---:|
| **Win Rate** | 74.5% |
| **Average R** | 0.169 per trade |
| **Profit Factor** | 1.52 |
| **Return** | ~11% over 2.4 years |
| **Max Drawdown** | ~5% |
| **Trades per Year** | ~40 |

**After 30+ paper trades (2-3 months):**
- Compare your paper results vs backtest
- If avgR ≈ 0.17 and win rate ≈ 74%, strategy is working
- If significantly different, investigate why

---

## 📁 File Structure

```
/Users/ankush/Projects/algoTester/
├── data/swing/paper/V1.7b-check-roe15-or-growth15/
│   ├── meta.json              # Account settings
│   ├── ledger.json            # Current state (equity, positions, trades)
│   ├── latest.md              # Latest report with watchlist
│   ├── equity.csv             # Equity curve (date, equity, return%)
│   ├── history/               # Historical session snapshots
│   │   └── ledger_YYYY-MM-DD.json
│   └── reports/               # Detailed reports by run
│       └── YYYY-MM-DDTHH-MM-SS/
│           └── report.md
```

---

## 🎯 Next Steps

### This Week (9-15 Nov 2026)

1. **Monday morning (9 Nov):** Check if cron ran successfully
   ```bash
   tail -50 ~/swing-daily.log
   ```

2. **View watchlist:**
   ```bash
   ./view-report.sh
   ```

3. **Follow recommendations** (the report tells you what to watch)

4. **Verify paper account is updating** each day

### After 1 Week

- Review if cron is running reliably
- Check if watchlist makes sense
- Verify no errors in logs

### After 1 Month

- Review closed trades (should have ~3-5 trades)
- Compare to backtest expectations
- Check if fundamentals gate is helping

### After 3 Months

- Review full paper performance (30+ trades)
- Calculate your avgR and win rate
- Decide if strategy is working as expected
- Consider adjustments if needed

---

## 📚 Documentation

- **LOCAL_SETUP.md** - Full local setup guide
- **DEPLOYMENT.md** - VPS deployment guide (if you want to switch later)
- **SWING_QUICKSTART.md** - Strategy overview
- **swing/PAPER_TRADING.md** - Paper trading details
- **swing/TRAILING_STOP_ANALYSIS.md** - Why 4% trail is best

---

## 🆘 Need Help?

**Common Issues:**

1. **"Report not found"** → Cron hasn't run yet, or there's an error in the log
2. **"MongoDB connection failed"** → Start MongoDB: `brew services start mongodb-community@7.0`
3. **"No qualified stocks"** → Market conditions, or fundamentals gate blocking everything
4. **"Token expired"** → Update UPSTOX_ANALYTICS_TOKEN in .env

---

## Summary

✅ **You're all set!**

Starting Monday (9 Nov 2026):
- Cron runs automatically at 8 AM weekdays
- Check report after 8:30 AM: `./view-report.sh`
- Follow the watchlist recommendations
- Track your paper trading results

**Just make sure your Mac is on at 8 AM!** ☕️
