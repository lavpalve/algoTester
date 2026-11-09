#!/bin/zsh
# Daily paper trading: update data, replay sessions, generate report.
# Run this once per trading day, ideally 07:00–09:00 IST.

set -e
cd "$(dirname "$0")/.." || exit 1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Paper trading: V1.7b (fundamentals check, 1% risk)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Quick status
PAPER_DIR="data/swing/paper/V1.7b-check-roe15-or-growth15"
if [ ! -f "$PAPER_DIR/meta.json" ]; then
  echo "✗ Paper account not opened yet. Run: node swing/paper-trade.js --start YYYY-MM-DD"
  exit 1
fi

node -e "
const fs = require('fs');
const meta = JSON.parse(fs.readFileSync('$PAPER_DIR/meta.json', 'utf8'));
const fmt = n => n.toLocaleString('en-IN');
console.log(\`Account opened: \${meta.start} with ₹\${fmt(meta.initialEquity)}\`);
if (fs.existsSync('$PAPER_DIR/ledger.json')) {
  const L = JSON.parse(fs.readFileSync('$PAPER_DIR/ledger.json', 'utf8'));
  const ret = ((L.equity / meta.initialEquity - 1) * 100).toFixed(2);
  console.log(\`Last session:   \${L.asOf || '(not started)'} | equity ₹\${fmt(Math.round(L.equity))} (\${ret}%) | open \${L.openPositions.length} | closed \${L.closedTrades.length}\`);
} else console.log('Last session:   (not started)');
"
echo ""

# Run the paper trader (it handles data updates)
node swing/paper-trade.js

# Publish the results to MongoDB for the MVista dashboard (read-only there).
# A failure here must not stop the daily report.
node swing/publish-paper.js || echo "⚠ Publish to MongoDB failed; the local report is still complete."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Report: $PAPER_DIR/latest.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Copy report to Desktop with date-wise folders
bash swing/copy-report-to-desktop.sh
