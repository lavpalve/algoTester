# Local Mac Setup: Automated Paper Trading

Running paper trading automatically on your Mac every trading day at 8:00 AM IST.

## Prerequisites

✅ MongoDB running locally (`mongodb://localhost:27017`)
✅ Node.js installed
✅ Project setup complete in `/Users/ankush/Projects/algoTester`

---

## Step 1: Set Up Cron Job

### Open Terminal and Edit Crontab

```bash
crontab -e
```

This opens your cron configuration in the default editor (usually vim or nano).

### Add the Cron Job

**If using vim (default):**
1. Press `i` to enter insert mode
2. Paste the line below
3. Press `Esc`
4. Type `:wq` and press Enter to save

**If using nano:**
1. Paste the line below
2. Press `Ctrl+O` to save
3. Press `Ctrl+X` to exit

### Cron Job Line

```bash
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /usr/local/bin/npm run swing:daily >> ~/swing-daily.log 2>&1
```

**Explanation:**
- `0 8` = 8:00 AM
- `* *` = Every day of month, every month
- `1-5` = Monday to Friday (skip weekends)
- `cd /Users/ankush/Projects/algoTester` = Go to project directory
- `/usr/local/bin/npm run swing:daily` = Run paper trading script
- `>> ~/swing-daily.log 2>&1` = Log output to `~/swing-daily.log`

### Verify Cron is Set

```bash
crontab -l
```

Should show your cron job.

---

## Step 2: Find Correct npm Path

The cron job needs the full path to `npm`. Check yours:

```bash
which npm
```

**Common paths:**
- `/usr/local/bin/npm` (Homebrew Node.js)
- `/opt/homebrew/bin/npm` (Apple Silicon Homebrew)
- `~/.nvm/versions/node/v20.x.x/bin/npm` (nvm)

**Update the cron line with YOUR path.**

For example, if `which npm` shows `/opt/homebrew/bin/npm`:

```bash
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /opt/homebrew/bin/npm run swing:daily >> ~/swing-daily.log 2>&1
```

---

## Step 3: Grant Permissions (macOS Security)

macOS may block cron from running. Grant permissions:

### Option A: Full Disk Access (Recommended)

1. Open **System Settings** (or System Preferences)
2. Go to **Privacy & Security** → **Full Disk Access**
3. Click the lock icon and authenticate
4. Click **+** button
5. Add `/usr/sbin/cron` (type `Cmd+Shift+G` and paste the path)
6. Enable the checkbox

### Option B: Grant Terminal Access

1. Go to **Privacy & Security** → **Files and Folders**
2. Find **Terminal** or **cron**
3. Enable access to your home directory

---

## Step 4: Test Cron Job Manually

Before waiting for 8 AM tomorrow, test now:

### Run the Script Manually

```bash
cd /Users/ankush/Projects/algoTester
npm run swing:daily
```

**Check for errors.** If it runs successfully, cron will work too.

### Test Cron with a Short Schedule

Temporarily change cron to run in 2 minutes:

```bash
crontab -e

# Change to (replace 8 with current_hour and 0 with current_minute+2):
# For example, if it's 10:35 AM now, use:
37 10 * * * cd /Users/ankush/Projects/algoTester && /usr/local/bin/npm run swing:daily >> ~/swing-daily.log 2>&1

# Save and wait 2 minutes
```

Then check the log:

```bash
tail -f ~/swing-daily.log
```

**After testing, change it back to 8 AM weekdays.**

---

## Step 5: Monitor Your Cron Job

### View Today's Log

```bash
tail -f ~/swing-daily.log
```

### View Latest Paper Trading Report

```bash
cat /Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md
```

### Check if Cron Ran

```bash
# View cron execution history (macOS)
log show --predicate 'process == "cron"' --last 1d
```

---

## Step 6: Set Up Log Rotation (Optional)

Keep log file from growing forever:

```bash
# Create a weekly cleanup script
cat > ~/cleanup-swing-logs.sh << 'EOF'
#!/bin/bash
# Keep only last 30 days of logs
find ~/swing-daily.log -mtime +30 -delete
EOF

chmod +x ~/cleanup-swing-logs.sh

# Add to cron (runs every Sunday at 3 AM)
crontab -e
# Add: 0 3 * * 0 ~/cleanup-swing-logs.sh
```

---

## Important: Keep Your Mac Running

For cron to work:
- ✅ **Mac must be powered on** at 8 AM
- ✅ **Mac must NOT be sleeping** (disable sleep or use caffeinate)
- ✅ **MongoDB must be running** (`brew services start mongodb-community`)

### Prevent Mac from Sleeping

**Option A: System Settings**
1. Go to **System Settings** → **Energy**
2. Set **Turn display off after** to "Never" (or long duration)
3. Enable **Prevent automatic sleeping when the display is off**

**Option B: Use caffeinate**

Add to your cron script:

```bash
0 8 * * 1-5 caffeinate -s cd /Users/ankush/Projects/algoTester && /usr/local/bin/npm run swing:daily >> ~/swing-daily.log 2>&1
```

This prevents sleep while script runs.

---

## Troubleshooting

### Cron Doesn't Run

**Check if cron is enabled:**
```bash
sudo launchctl list | grep cron
```

Should show `com.vix.cron`. If not:
```bash
sudo launchctl load -w /System/Library/LaunchDaemons/com.vix.cron.plist
```

### MongoDB Not Running

```bash
# Check MongoDB status
brew services list | grep mongodb

# If stopped, start it
brew services start mongodb-community@7.0

# Or start manually
mongod --config /opt/homebrew/etc/mongod.conf
```

### Log is Empty

1. Check cron syntax: `crontab -l`
2. Check npm path: `which npm`
3. Check file permissions: `ls -la ~/swing-daily.log`
4. Check macOS privacy settings (Step 3)

### Script Runs but Fails

```bash
# Check the log for errors
cat ~/swing-daily.log

# Common issues:
# - MongoDB not running
# - UPSTOX_ANALYTICS_TOKEN expired
# - Network connection failed
```

---

## Daily Workflow

### What Happens Automatically

Every trading day at 8:00 AM:
1. ✅ Cron triggers the script
2. ✅ Script updates OHLC data from Upstox
3. ✅ Script runs paper trading simulation
4. ✅ Script generates report in `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`
5. ✅ Log saved to `~/swing-daily.log`

### What You Do

**Every morning (8:30+ AM):**
```bash
# View the report
cat /Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md

# Or open in VS Code
code /Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md
```

**Check watchlist and follow the recommendations.**

---

## Quick Commands Reference

```bash
# View cron jobs
crontab -l

# Edit cron jobs
crontab -e

# Remove all cron jobs (careful!)
crontab -r

# View latest log
tail -20 ~/swing-daily.log

# View latest report
cat /Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md

# Run manually (for testing)
cd /Users/ankush/Projects/algoTester && npm run swing:daily

# Check MongoDB
brew services list | grep mongodb

# Start MongoDB if stopped
brew services start mongodb-community@7.0
```

---

## Summary

✅ **Cron job set:** Runs every weekday at 8:00 AM
✅ **Logs:** Saved to `~/swing-daily.log`
✅ **Report:** `data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md`
✅ **Cost:** $0 (completely free)

**Just make sure:**
- Mac is on at 8 AM
- MongoDB is running
- You check the report after 8:30 AM

---

## Next Review: After 30 Trades

After 30+ closed paper trades (probably 2-3 months):
- Compare paper avgR vs backtest (0.169 expected)
- Compare paper win rate vs backtest (74.5% expected)
- Decide if fundamentals gate helped or hurt
- Consider adjusting risk or trailing stop

**For now: just follow the watchlist and track results!**
