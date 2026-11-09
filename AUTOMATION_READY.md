# ✅ Automation Ready!

Your fully automated paper trading system is configured and ready.

---

## 📅 Daily Schedule (Weekdays Only)

| Time | Action | Details |
|---|---|---|
| **7:55 AM** | 🌅 **Mac Wakes** | Automatic (pmset) |
| **7:56 AM** | 💤 **Stay Awake** | Caffeinate keeps Mac awake |
| **8:00 AM** | 📊 **Paper Trading** | Fetches data, scans stocks, generates report |
| **8:30 AM** | ✅ **Complete** | Report ready at `data/swing/paper/.../latest.md` |
| **9:00 AM** | 🔍 **Sleep Check** | Checks every 15 min if idle |
| **9:15 AM** | 🔍 **Sleep Check** | |
| **9:30 AM** | 🔍 **Sleep Check** | |
| **9:45 AM** | 🔍 **Sleep Check** | |
| **10:00 AM** | 💤 **Auto Sleep** | If idle >5min AND no user |
| **10:15 AM** | 🔍 **Sleep Check** | Final check |

---

## 🎯 What Happens Tomorrow (Tue, 10 Nov 2026)

1. **Leave your Mac in sleep mode tonight** ✅
2. Mac will wake automatically at 7:55 AM ✅
3. Paper trading runs at 8:00 AM ✅
4. Check results after 8:30 AM:
   ```bash
   npm run swing:report
   ```
5. If you're not using Mac at 10 AM, it sleeps automatically ✅

---

## 📊 Monitoring Commands

```bash
# View latest paper trading report
npm run swing:report

# Watch paper trading log (live)
tail -f ~/swing-daily.log

# Watch auto-sleep decisions (live)
tail -f ~/auto-sleep.log

# Check if automation ran today
tail -50 ~/swing-daily.log

# Verify cron schedule
crontab -l

# Verify wake schedule
pmset -g sched

# Test automation setup
bash verify-automation.sh
```

---

## 🔧 Manual Controls

```bash
# Run paper trading manually (if missed)
npm run swing:daily

# Force Mac to sleep now
pmset sleepnow

# Keep Mac awake for 2 hours
caffeinate -t 7200

# Disable auto-sleep temporarily
# (just stay active or run: caffeinate)
```

---

## ⚠️ Important Rules

### For Auto Wake-Up to Work:
1. ✅ **Sleep Mac** (don't shut down completely)
2. ✅ **Keep plugged in** (for MacBooks)
3. ✅ **Don't disable power** at night

### Mac Won't Sleep If:
- ❌ You're actively using it (mouse/keyboard activity)
- ❌ CPU usage > 20%
- ❌ Paper trading still running
- ❌ Idle time < 5 minutes

---

## 📁 Important Files

| File | Purpose |
|---|---|
| `~/swing-daily.log` | Paper trading execution log |
| `~/auto-sleep.log` | Sleep check decisions |
| `~/wake-mac.log` | Wake-up script log |
| `data/swing/paper/.../latest.md` | Latest paper trading report |
| `data/swing/paper/.../ledger.json` | Account state (equity, positions, trades) |
| `verify-automation.sh` | Test all automation components |

---

## 🚨 Troubleshooting

### Mac Didn't Wake at 7:55 AM

```bash
# Check wake schedule
pmset -g sched

# If not set, run:
sudo pmset repeat wake MTWRF 07:55:00
```

### Paper Trading Didn't Run

```bash
# Check the log
tail -50 ~/swing-daily.log

# If empty, Mac was probably asleep
# Check cron:
crontab -l

# Run manually:
npm run swing:daily
```

### Mac Didn't Sleep at 10 AM

```bash
# Check why
tail -20 ~/auto-sleep.log

# Probably you were using it (this is correct behavior!)
```

### MongoDB Not Running

```bash
# Start it
brew services start mongodb-community@7.0

# Verify
ps aux | grep mongod
```

---

## 📈 After 30 Trades (2-3 Months)

Compare paper vs backtest:

| Metric | Backtest | Paper | Status |
|---|---:|---:|:---:|
| Win Rate | 75.3% | ??? | Compare |
| Avg R | 0.123 | ??? | Compare |
| Max DD | 4.84% | ??? | Compare |

**If paper matches backtest:** ✅ Strategy works!
**If paper is worse:** ⚠️ Investigate why
**If paper is much worse:** ❌ May need adjustments

---

## 🎯 Success Criteria

After 30+ paper trades:
- ✅ **Continue** if avgR > 0.08 and win rate > 65%
- ⚠️ **Investigate** if avgR < 0.08 or win rate < 60%
- ❌ **Stop** if avgR < 0 or win rate < 55%

---

## 🚀 Next Steps

### Week 1 (Nov 10-14)
- Monitor daily: Check report each morning
- Verify automation: Mac wakes, runs, sleeps correctly
- Log any issues: Note if anything doesn't work

### Week 2-4 (Nov 17 - Dec 5)
- Track trades: Should have 5-10 trades by now
- Compare vs backtest: Are results similar?
- Adjust if needed: But don't change strategy mid-test!

### Month 2-3 (Dec-Jan)
- Collect 30+ trades
- Calculate avgR and win rate
- Decide: Continue, adjust, or stop

### After Validation (Feb 2027+)
- If successful: Consider deploying to VPS for 99.9% uptime
- Build MVista integration
- Develop Strategy V2 (mean reversion?)

---

## 💰 Cost Comparison

| Setup | Monthly Cost | Reliability | Best For |
|---|---:|:---:|---|
| **Mac Auto Wake/Sleep** | $0 | 95% | Testing phase |
| **VPS (DigitalOcean)** | $6 | 99.9% | Production |

**Current setup is perfect for 2-3 month testing period.**

---

## ✅ Summary

**You're 100% ready!**

- ✅ Auto wake-up: 7:55 AM weekdays
- ✅ Paper trading: 8:00 AM weekdays
- ✅ Auto sleep: 10:00 AM (if idle)
- ✅ MongoDB: Running
- ✅ All scripts: Configured
- ✅ Cron jobs: Active

**Just sleep your Mac tonight. Everything else is automatic!** 🌙

---

**See you tomorrow at 8:30 AM!** Check `npm run swing:report` for results. 📊
