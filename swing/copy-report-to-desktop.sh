#!/bin/bash
# Copy paper trading report to Desktop with date-wise folders

# Get today's date
DATE=$(date +"%Y-%m-%d")
MONTH=$(date +"%Y-%m")

# Desktop folders
DESKTOP="$HOME/Desktop"
REPORTS_FOLDER="$DESKTOP/Paper Trading Reports"
MONTH_FOLDER="$REPORTS_FOLDER/$MONTH"
TODAY_FOLDER="$MONTH_FOLDER/$DATE"

# Source report
SOURCE_REPORT="$HOME/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md"
SOURCE_LEDGER="$HOME/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/ledger.json"

# Create folder structure
mkdir -p "$TODAY_FOLDER"

# Copy report if exists
if [ -f "$SOURCE_REPORT" ]; then
    cp "$SOURCE_REPORT" "$TODAY_FOLDER/report_$DATE.md"
    echo "✅ Report copied to: $TODAY_FOLDER/report_$DATE.md"
else
    echo "⚠️ No report found at $SOURCE_REPORT"
fi

# Copy ledger (account state) if exists
if [ -f "$SOURCE_LEDGER" ]; then
    cp "$SOURCE_LEDGER" "$TODAY_FOLDER/account_$DATE.json"
    echo "✅ Account state copied to: $TODAY_FOLDER/account_$DATE.json"
fi

# Create a summary text file
cat > "$TODAY_FOLDER/summary_$DATE.txt" << EOF
Paper Trading Report - $DATE
============================

Report location: $TODAY_FOLDER/report_$DATE.md
Account state: $TODAY_FOLDER/account_$DATE.json

To view report:
- Double-click report_$DATE.md
- Or open in any text editor

Strategy: V1.7b (ROE ≥15% OR profit growth ≥15%)
Risk: 1% per trade, max 2 positions
Trailing stop: 4%

============================
Generated: $(date)
EOF

echo "✅ Summary created: $TODAY_FOLDER/summary_$DATE.txt"

# Create a shortcut in root reports folder to today's report
if [ -f "$SOURCE_REPORT" ]; then
    cp "$SOURCE_REPORT" "$REPORTS_FOLDER/📊 Latest Report.md"
    echo "✅ Latest report shortcut updated"
fi

echo ""
echo "📂 Desktop location: $REPORTS_FOLDER"
echo "📅 Today's reports: $TODAY_FOLDER"
