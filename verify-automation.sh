#!/bin/bash
# Verification script for automated paper trading setup

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Verifying Automated Paper Trading Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check 1: Auto Wake-Up Schedule
echo "1️⃣  Checking auto wake-up schedule..."
wake_schedule=$(pmset -g sched 2>&1)
if echo "$wake_schedule" | grep -q "wake at"; then
    echo "   ✅ PASS: Auto wake-up is configured"
    echo "$wake_schedule" | grep "wake at"
else
    echo "   ❌ FAIL: Auto wake-up NOT configured"
    echo "   Run: sudo pmset repeat wake MTWRF 07:55:00"
fi
echo ""

# Check 2: Cron Jobs
echo "2️⃣  Checking cron jobs..."
cron_count=$(crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | wc -l | tr -d ' ')
if [ "$cron_count" -ge 3 ]; then
    echo "   ✅ PASS: Found $cron_count cron jobs"
    crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | while read line; do
        echo "   → $line"
    done
else
    echo "   ⚠️  WARNING: Only $cron_count cron jobs found (expected 3)"
fi
echo ""

# Check 3: Scripts Exist
echo "3️⃣  Checking required scripts..."
scripts=(
    "/Users/ankush/keep-mac-awake.sh"
    "/Users/ankush/auto-sleep-if-idle.sh"
    "/Users/ankush/Projects/algoTester/swing/daily.sh"
)

for script in "${scripts[@]}"; do
    if [ -f "$script" ] && [ -x "$script" ]; then
        echo "   ✅ $script (executable)"
    elif [ -f "$script" ]; then
        echo "   ⚠️  $script (exists but not executable)"
    else
        echo "   ❌ $script (missing)"
    fi
done
echo ""

# Check 4: MongoDB Running
echo "4️⃣  Checking MongoDB..."
if pgrep -x "mongod" > /dev/null; then
    echo "   ✅ PASS: MongoDB is running"
else
    echo "   ❌ FAIL: MongoDB is NOT running"
    echo "   Run: brew services start mongodb-community@7.0"
fi
echo ""

# Check 5: Node.js Path
echo "5️⃣  Checking Node.js..."
node_path="/Users/ankush/.nvm/versions/node/v24.14.1/bin/npm"
if [ -f "$node_path" ]; then
    echo "   ✅ PASS: Node.js found at $node_path"
    $node_path --version 2>&1 | head -1
else
    echo "   ❌ FAIL: Node.js NOT found at $node_path"
    echo "   Current npm: $(which npm)"
fi
echo ""

# Check 6: Paper Trading Config
echo "6️⃣  Checking paper trading config..."
config_file="/Users/ankush/Projects/algoTester/swing/experiments/v1.7b-check-roe15-or-growth15.json"
if [ -f "$config_file" ]; then
    echo "   ✅ PASS: Config file exists"
else
    echo "   ❌ FAIL: Config file missing"
fi
echo ""

# Check 7: Paper Account
echo "7️⃣  Checking paper account..."
paper_dir="/Users/ankush/Projects/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15"
if [ -d "$paper_dir" ]; then
    echo "   ✅ PASS: Paper account directory exists"
    if [ -f "$paper_dir/meta.json" ]; then
        echo "   ✅ PASS: meta.json exists"
    fi
    if [ -f "$paper_dir/ledger.json" ]; then
        echo "   ✅ PASS: ledger.json exists"
    fi
else
    echo "   ❌ FAIL: Paper account directory missing"
fi
echo ""

# Check 8: Recent Logs
echo "8️⃣  Checking recent logs..."
if [ -f "$HOME/swing-daily.log" ]; then
    last_run=$(tail -1 "$HOME/swing-daily.log")
    echo "   ✅ PASS: Log file exists"
    echo "   Last entry: $last_run"
else
    echo "   ⚠️  WARNING: No log file yet (will be created on first run)"
fi
echo ""

# Check 9: Test Auto-Sleep Logic
echo "9️⃣  Testing auto-sleep logic..."
idle_time=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
cpu_usage=$(ps aux | awk '{sum+=$3} END {print int(sum)}')
active_users=$(who | wc -l | tr -d ' ')

echo "   Idle time: ${idle_time}s"
echo "   CPU usage: ${cpu_usage}%"
echo "   Active users: ${active_users}"

if [ "$idle_time" -gt 300 ] && [ "$cpu_usage" -lt 20 ] && [ "$active_users" -eq 0 ]; then
    echo "   ⚠️  Would sleep if paper trading finished"
else
    echo "   ✅ Won't sleep (user active or system busy)"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Count passes and fails
passes=$(echo "$output" | grep -c "✅ PASS" || echo "0")
fails=$(echo "$output" | grep -c "❌ FAIL" || echo "0")

echo ""
echo "✅ If all checks pass, your automation is ready!"
echo ""
echo "📅 Tomorrow's Schedule:"
echo "   7:55 AM → Mac wakes up automatically"
echo "   8:00 AM → Paper trading runs"
echo "   10:00 AM → Mac sleeps (if idle)"
echo ""
echo "🔍 Monitor Commands:"
echo "   tail -f ~/swing-daily.log      # Watch paper trading"
echo "   tail -f ~/auto-sleep.log       # Watch sleep checks"
echo "   npm run swing:report           # View latest report"
echo ""
