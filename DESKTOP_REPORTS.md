# 📊 Desktop Reports - Easy Access

Your paper trading reports are now **automatically copied to Desktop** every day!

---

## 📂 Desktop Folder Structure

```
~/Desktop/
  └── Paper Trading Reports/
      ├── 📊 Latest Report.md          ← Always shows today's report
      ├── 2026-11/                      ← November 2026
      │   ├── 2026-11-09/
      │   │   ├── report_2026-11-09.md
      │   │   ├── account_2026-11-09.json
      │   │   └── summary_2026-11-09.txt
      │   ├── 2026-11-10/
      │   │   ├── report_2026-11-10.md
      │   │   ├── account_2026-11-10.json
      │   │   └── summary_2026-11-10.txt
      │   └── ...
      ├── 2026-12/                      ← December 2026
      │   └── ...
      └── 2027-01/                      ← January 2027
          └── ...
```

---

## 🎯 How to View Reports

### Method 1: Quick Access (Easiest)
1. Go to Desktop
2. Open folder: **"Paper Trading Reports"**
3. Double-click: **"📊 Latest Report.md"**
4. Done! ✅

### Method 2: View Specific Date
1. Go to Desktop → "Paper Trading Reports"
2. Open month folder (e.g., "2026-11")
3. Open date folder (e.g., "2026-11-09")
4. Double-click: **"report_2026-11-09.md"**

### Method 3: Read Summary First
1. Go to date folder
2. Double-click: **"summary_2026-11-09.txt"**
3. Shows quick overview
4. Then open full report if needed

---

## 📁 What Each File Contains

### 📊 report_YYYY-MM-DD.md
**Full paper trading report with:**
- Account status (equity, return, positions)
- Last session activity
- Watchlist for next session
- Entry/exit rules
- Performance vs backtest

### 💰 account_YYYY-MM-DD.json
**Account state (JSON format):**
- Equity amount
- Open positions
- Closed trades
- Trade history

### 📝 summary_YYYY-MM-DD.txt
**Quick summary:**
- Date
- File locations
- Strategy info
- Quick stats

---

## ⏰ When Reports Are Created

**Automatically after paper trading runs:**
```
8:00 AM → Paper trading starts
8:30 AM → Paper trading completes
8:30 AM → Report automatically copied to Desktop ✅
```

**You don't need to run any commands!** Just check Desktop after 8:30 AM.

---

## 📊 Daily Workflow

### Every Morning (After 8:30 AM)

**Old way (before):**
```bash
cd /Users/ankush/Projects/algoTester
npm run swing:report
```

**New way (now):**
1. Open Desktop
2. Open "Paper Trading Reports"
3. Double-click "📊 Latest Report.md"
4. Done! ✅

**Much easier!** 🎉

---

## 🗂️ Organization Benefits

### ✅ Date-wise Organization
- Each day in its own folder
- Easy to compare different dates
- Month-wise grouping

### ✅ Always Latest
- "📊 Latest Report.md" always shows today
- No need to search for latest date
- One-click access

### ✅ History Preserved
- All old reports saved
- Can review past performance
- Compare week-over-week

---

## 📈 Example: Weekly Review

**Want to review this week's trades?**

1. Go to: `Desktop/Paper Trading Reports/2026-11/`
2. Open each day's folder:
   - 2026-11-09 (Monday)
   - 2026-11-10 (Tuesday)
   - 2026-11-11 (Wednesday)
   - 2026-11-12 (Thursday)
   - 2026-11-13 (Friday)
3. Compare reports side-by-side
4. Track performance trend

---

## 🔍 What to Look For Daily

### In "📊 Latest Report.md":

**1. Account Section**
- Current equity
- Return % since start
- Open positions (0, 1, or 2)
- Closed trades count

**2. Last Session**
- What happened yesterday
- Any fills, stops, exits
- P&L from closed trades

**3. Plan for Today**
- Market score (cautious/favorable)
- Watchlist (top stocks to watch)
- Entry rules (how to enter if signals trigger)

**4. Performance Since Start**
- Win rate vs backtest (75.3% expected)
- Avg R vs backtest (0.123 expected)
- Too early to compare until 30+ trades

---

## 💡 Tips

### Bookmark the Folder
1. Open Finder
2. Go to Desktop → "Paper Trading Reports"
3. Drag folder to Finder sidebar
4. Now accessible from any Finder window!

### Set as Startup Item
Make "Paper Trading Reports" open on Mac startup:
1. System Settings → General → Login Items
2. Click "+" and add folder
3. Opens automatically when you log in

### Create Desktop Alias
1. Right-click "📊 Latest Report.md"
2. "Make Alias"
3. Drag alias to Desktop root
4. Rename to "Today's Trading"
5. One-click access from Desktop!

---

## 🗑️ Cleanup

Reports are small (2-5 KB each), but if you want to clean up:

### Keep Last Month Only
```bash
# Delete folders older than 30 days (run manually)
find ~/Desktop/Paper\ Trading\ Reports/ -type d -name "2026-*" -mtime +30 -exec rm -rf {} +
```

### Archive to External Drive
```bash
# Manually copy old months to external drive
cp -r ~/Desktop/Paper\ Trading\ Reports/2026-11 /Volumes/External/Archives/
```

---

## ⚙️ Technical Details

**Where reports come from:**
- Source: `/Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/`
- Copied to: `~/Desktop/Paper Trading Reports/YYYY-MM/YYYY-MM-DD/`
- Script: `swing/copy-report-to-desktop.sh`
- Runs: Automatically after `npm run swing:daily`

**What gets copied:**
1. `latest.md` → `report_YYYY-MM-DD.md`
2. `ledger.json` → `account_YYYY-MM-DD.json`
3. Auto-generated → `summary_YYYY-MM-DD.txt`
4. Shortcut → `📊 Latest Report.md`

---

## ✅ Summary

**Before:**
- Need to open Terminal
- Run `npm run swing:report`
- View in Terminal or text editor

**Now:**
- Just open Desktop folder
- Double-click "📊 Latest Report.md"
- Easy! ✅

**Automatically created every day after 8:30 AM!** 🎉

---

**Tomorrow morning, check Desktop → "Paper Trading Reports" folder!** 📊
