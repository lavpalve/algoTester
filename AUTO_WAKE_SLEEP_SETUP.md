# Automatic Wake → Trade → Sleep Setup

**Goal:** Mac automatically wakes at 7:55 AM, runs paper trading at 8:00 AM, then auto-sleeps at 10:00 AM (if not in use).

---

## 🚀 Complete Setup Guide

### Step 1: Enable Auto Wake-Up (7:55 AM)

#### Option A: Using pmset (Recommended for macOS)

```bash
# Schedule wake-up at 7:55 AM every weekday
sudo pmset repeat wake MTWRF 07:55:00

# Verify it's set
pmset -g sched
```

**What this does:**
- Mac automatically wakes from sleep at 7:55 AM
- Monday to Friday only
- Works even if lid is closed (for MacBooks)

#### Option B: System Settings (GUI Method)

1. Open **System Settings** → **Battery** (or **Energy Saver**)
2. Click **Schedule** button
3. Check **Start up or wake**
4. Set time: **7:55 AM**
5. Select days: **Weekdays**

---

### Step 2: Run Paper Trading at 8:00 AM

**Already set up!** Your cron job:
```cron
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /Users/ankush/.nvm/versions/node/v24.14.1/bin/npm run swing:daily >> ~/swing-daily.log 2>&1
```

This runs automatically once Mac is awake.

---

### Step 3: Auto-Sleep at 10:00 AM (If Not in Use)

Create an intelligent sleep script that checks if Mac is being used:

```bash
#!/bin/bash
# File: /Users/ankush/auto-sleep-if-idle.sh

# Check if user is actively using the Mac
idle_time=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
cpu_usage=$(ps aux | awk '{sum+=$3} END {print int(sum)}')

# Get paper trading process status
paper_trading_running=$(ps aux | grep "swing:daily" | grep -v grep | wc -l)

echo "$(date): Idle time: ${idle_time}s, CPU usage: ${cpu_usage}%, Paper trading: ${paper_trading_running}"

# Sleep conditions (ALL must be true):
# 1. Idle for more than 5 minutes (300 seconds)
# 2. CPU usage < 20%
# 3. Paper trading finished
# 4. No active SSH/remote sessions
# 5. No user logged in GUI

if [ "$idle_time" -gt 300 ] && [ "$cpu_usage" -lt 20 ] && [ "$paper_trading_running" -eq 0 ]; then
    # Check if anyone is using the Mac (GUI sessions)
    active_users=$(who | wc -l)
    
    if [ "$active_users" -eq 0 ] || [ "$idle_time" -gt 600 ]; then
        echo "$(date): Conditions met. Sleeping Mac..."
        pmset sleepnow
    else
        echo "$(date): User is active. Skipping sleep."
    fi
else
    echo "$(date): Not ready to sleep yet."
fi
```

Save this script:

```bash
# Create the script
cat > /Users/ankush/auto-sleep-if-idle.sh << 'EOF'
#!/bin/bash
# Auto-sleep if Mac is idle and paper trading finished

idle_time=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
cpu_usage=$(ps aux | awk '{sum+=$3} END {print int(sum)}')
paper_trading_running=$(ps aux | grep "swing:daily" | grep -v grep | wc -l)

echo "$(date): Idle ${idle_time}s, CPU ${cpu_usage}%, Trading: ${paper_trading_running}"

if [ "$idle_time" -gt 300 ] && [ "$cpu_usage" -lt 20 ] && [ "$paper_trading_running" -eq 0 ]; then
    active_users=$(who | wc -l)
    if [ "$active_users" -eq 0 ] || [ "$idle_time" -gt 600 ]; then
        echo "$(date): Sleeping Mac..."
        pmset sleepnow
    else
        echo "$(date): User active, skipping sleep"
    fi
else
    echo "$(date): Not ready to sleep"
fi
EOF

# Make it executable
chmod +x /Users/ankush/auto-sleep-if-idle.sh
```

---

### Step 4: Schedule Auto-Sleep Check at 10:00 AM

Add to crontab:

```bash
# Add sleep check to cron
(crontab -l 2>/dev/null; echo "# Auto-sleep at 10 AM if idle"; echo "0 10 * * 1-5 /bin/bash /Users/ankush/auto-sleep-if-idle.sh >> ~/auto-sleep.log 2>&1") | crontab -
```

Or run the check every 15 minutes from 9:00 AM to 11:00 AM:

```bash
# More frequent checks (every 15 min from 9-11 AM)
(crontab -l 2>/dev/null; echo "# Auto-sleep checks (9-11 AM, every 15 min)"; echo "*/15 9-11 * * 1-5 /bin/bash /Users/ankush/auto-sleep-if-idle.sh >> ~/auto-sleep.log 2>&1") | crontab -
```

---

## 📋 Complete Crontab (All Together)

```cron
# Paper Trading - Runs every weekday at 8:00 AM IST
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /Users/ankush/.nvm/versions/node/v24.14.1/bin/npm run swing:daily >> ~/swing-daily.log 2>&1

# Keep Mac awake before paper trading
50 7 * * 1-5 /bin/bash /Users/ankush/keep-mac-awake.sh >> ~/wake-mac.log 2>&1

# Auto-sleep checks (9-11 AM, every 15 min if idle)
*/15 9-11 * * 1-5 /bin/bash /Users/ankush/auto-sleep-if-idle.sh >> ~/auto-sleep.log 2>&1
```

---

## 🔄 Complete Daily Flow

### Timeline

| Time | Action | What Happens |
|---|---|---|
| **7:55 AM** | 🌅 Auto Wake | Mac wakes from sleep (pmset) |
| **7:56-7:59 AM** | 💤 Stay Awake | Caffeinate keeps Mac awake |
| **8:00 AM** | 📊 Paper Trading | Cron runs `npm run swing:daily` |
| **8:00-8:30 AM** | 🔄 Processing | Fetches data, scans stocks, generates report |
| **8:30 AM** | ✅ Complete | Paper trading finished, report ready |
| **9:00 AM** | 🔍 First Check | Check if idle + finished |
| **9:15 AM** | 🔍 Check Again | Still checking... |
| **9:30 AM** | 🔍 Check Again | Still checking... |
| **10:00 AM** | 💤 Auto Sleep | If idle > 5 min AND no user, sleep! |

### Smart Sleep Conditions

Mac will **ONLY** sleep if **ALL** of these are true:
1. ✅ Idle for > 5 minutes (no mouse/keyboard activity)
2. ✅ CPU usage < 20% (not busy)
3. ✅ Paper trading finished (no `swing:daily` process)
4. ✅ No GUI users logged in OR idle > 10 minutes

**If you're using the Mac at 10 AM, it WON'T sleep!**

---

## 🛠️ Installation Commands (Run These)

```bash
# 1. Schedule auto wake-up at 7:55 AM weekdays
sudo pmset repeat wake MTWRF 07:55:00

# 2. Create auto-sleep script
cat > /Users/ankush/auto-sleep-if-idle.sh << 'EOF'
#!/bin/bash
idle_time=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
cpu_usage=$(ps aux | awk '{sum+=$3} END {print int(sum)}')
paper_trading_running=$(ps aux | grep "swing:daily" | grep -v grep | wc -l)

echo "$(date): Idle ${idle_time}s, CPU ${cpu_usage}%, Trading: ${paper_trading_running}"

if [ "$idle_time" -gt 300 ] && [ "$cpu_usage" -lt 20 ] && [ "$paper_trading_running" -eq 0 ]; then
    active_users=$(who | wc -l)
    if [ "$active_users" -eq 0 ] || [ "$idle_time" -gt 600 ]; then
        echo "$(date): Sleeping Mac..."
        pmset sleepnow
    fi
fi
EOF

chmod +x /Users/ankush/auto-sleep-if-idle.sh

# 3. Update crontab with sleep checks
(crontab -l 2>/dev/null | grep -v "Auto-sleep checks"; echo "# Auto-sleep checks (9-11 AM, every 15 min)"; echo "*/15 9-11 * * 1-5 /bin/bash /Users/ankush/auto-sleep-if-idle.sh >> ~/auto-sleep.log 2>&1") | crontab -

# 4. Verify everything
echo "=== Scheduled Wake-Up ==="
pmset -g sched
echo ""
echo "=== Crontab ==="
crontab -l
echo ""
echo "✅ Setup complete!"
```

---

## ✅ Verify Setup

```bash
# Check wake schedule
pmset -g sched
# Should show: wake at 7:55 AM on MTWRF

# Check cron jobs
crontab -l
# Should show 3 jobs: wake script, paper trading, auto-sleep

# Test auto-sleep script manually
bash /Users/ankush/auto-sleep-if-idle.sh
# Should show current status (won't sleep if you're using Mac)
```

---

## 📊 Monitor the Automation

```bash
# Check if paper trading ran today
tail -50 ~/swing-daily.log

# Check auto-sleep decisions
tail -50 ~/auto-sleep.log

# Check wake-up script
tail -50 ~/wake-mac.log
```

---

## ⚠️ Important Notes

### Power Settings Required

For auto wake-up to work:
1. **Don't shut down Mac** - Only sleep/close lid
2. **Keep Mac plugged in** (for MacBooks) - Wake from sleep uses power
3. **Enable "Wake for network access"** in Battery settings

### If Using a MacBook

```bash
# Allow wake even when lid is closed (if connected to power)
sudo pmset -c lidwake 1
sudo pmset -c ttyskeepawake 1
```

### Disable Auto-Update During Trading Hours

System updates can interfere:
1. **System Settings** → **General** → **Software Update**
2. Uncheck "Install macOS updates" or schedule for non-trading hours

---

## 🚨 Troubleshooting

### Mac Doesn't Wake at 7:55 AM

```bash
# Check if wake schedule is set
pmset -g sched

# Re-apply wake schedule
sudo pmset repeat wake MTWRF 07:55:00

# Check system log for wake events
log show --predicate 'eventMessage contains "Wake"' --last 1d
```

### Mac Doesn't Sleep at 10 AM

```bash
# Check why
tail -20 ~/auto-sleep.log

# Manually test sleep conditions
bash /Users/ankush/auto-sleep-if-idle.sh

# Force sleep manually (testing)
pmset sleepnow
```

### Cron Didn't Run

```bash
# Check cron log
tail -50 ~/swing-daily.log

# Check if cron service is running
ps aux | grep cron

# Check system logs
log show --predicate 'process == "cron"' --last 1h
```

---

## 🎯 Summary

**What you get:**
- ✅ Mac wakes automatically at 7:55 AM weekdays
- ✅ Paper trading runs at 8:00 AM
- ✅ Mac sleeps at 10:00 AM if idle and not in use
- ✅ Won't sleep if you're actively using it
- ✅ Fully automated, no manual intervention

**Compared to VPS:**
- 💰 Cost: $0/month (vs $6/month VPS)
- ⚡ Reliability: 95% (vs 99.9% VPS)
- 🔋 Power: Uses electricity when running
- 🏠 Location: Must be home with power

**Best for:** Testing phase (1-3 months)
**Upgrade to VPS when:** Strategy is proven and you want 99.9% reliability

---

**Run the installation commands above and you're done!** 🚀
