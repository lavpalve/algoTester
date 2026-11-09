#!/bin/bash
# Quick script to view today's paper trading report

REPORT_FILE="/Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md"
LOG_FILE="$HOME/swing-daily.log"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Paper Trading Report - V1.7b"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$REPORT_FILE" ]; then
  cat "$REPORT_FILE"
else
  echo "❌ Report not found. Has the cron job run yet?"
  echo ""
  echo "Run manually:"
  echo "  cd /Users/ankush/Projects/algoTester && npm run swing:daily"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Last 10 lines of log:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "$LOG_FILE" ]; then
  tail -10 "$LOG_FILE"
else
  echo "No log file yet at $LOG_FILE"
fi
