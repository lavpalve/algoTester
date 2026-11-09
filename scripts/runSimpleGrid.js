/**
 * scripts/runSimpleGrid.js
 *
 * A very simple, easy-to-understand implementation of Volatility Harvesting.
 *
 * Rules based on user request:
 * - Step size: 3% (up or down)
 * - Trade size: 10 shares
 * - Buy rule: If price drops 3% from last trade, BUY.
 * - Sell rule: If price rises 3% from last trade, SELL.
 * - Max limits: Max 3 consecutive buys (bucket limit), Max 3 consecutive sells.
 *
 * This is a standalone, simplified engine to help understand the core mechanics
 * of symmetrical volatility harvesting.
 *
 * Run: node scripts/runSimpleGrid.js
 */

const { loadCandles } = require('../src/dataManager');

function runSimpleGrid() {
  console.log("📈 Loading candles for Simple Grid Test...");
  const rawCandles = loadCandles('CEINSYS_INE016Q01014_1minute');
  
  if (!rawCandles || rawCandles.length === 0) {
    console.error("❌ No candles found.");
    return;
  }

  // Sort oldest first
  const candles = [...rawCandles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

  // ─── Configuration ────────────────────────────────────────────────
  const STEP_PCT = 3.0;          // 3% increment/decrement
  const TRADE_QTY = 10;          // 10 shares per trade
  const MAX_CONSECUTIVE = 3;     // Max 3 buys or 3 sells in a row

  // ─── Initial State ────────────────────────────────────────────────
  const initialPrice = candles[0][4];
  let holdings = 100;            // Start with 100 shares
  let cash = 100000;             // Start with some cash pool
  
  let lastTradePrice = initialPrice;
  let consecutiveBuys = 0;
  let consecutiveSells = 0;

  const tradeLog = [];

  console.log(`\n▶ Starting Simple Volatility Grid`);
  console.log(`  Initial Price : ₹${initialPrice}`);
  console.log(`  Target Step   : ${STEP_PCT}%`);
  console.log(`  Max Bucket    : ${MAX_CONSECUTIVE} trades\n`);

  // ─── Main Loop ────────────────────────────────────────────────────
  for (const candle of candles) {
    const timestamp = candle[0];
    const close = candle[4];

    // Check Sell Condition (Price UP by 3%)
    const sellTarget = lastTradePrice * (1 + STEP_PCT / 100);
    if (close >= sellTarget) {
      if (consecutiveSells < MAX_CONSECUTIVE && holdings >= TRADE_QTY) {
        // EXECUTE SELL
        holdings -= TRADE_QTY;
        cash += close * TRADE_QTY;
        
        tradeLog.push({ action: 'SELL', timestamp, price: close, holdings, bucketCount: consecutiveSells + 1 });
        
        lastTradePrice = close;
        consecutiveSells++;
        consecutiveBuys = 0; // Reset buy bucket because direction reversed
      }
    }

    // Check Buy Condition (Price DOWN by 3%)
    const buyTarget = lastTradePrice * (1 - STEP_PCT / 100);
    if (close <= buyTarget) {
      if (consecutiveBuys < MAX_CONSECUTIVE) {
        // EXECUTE BUY
        holdings += TRADE_QTY;
        cash -= close * TRADE_QTY;
        
        tradeLog.push({ action: 'BUY', timestamp, price: close, holdings, bucketCount: consecutiveBuys + 1 });
        
        lastTradePrice = close;
        consecutiveBuys++;
        consecutiveSells = 0; // Reset sell bucket because direction reversed
      }
    }
  }

  // ─── Calculate Final Results ──────────────────────────────────────
  const finalPrice = candles[candles.length - 1][4];
  const finalPortfolioValue = cash + (holdings * finalPrice);
  const initialPortfolioValue = 100000 + (100 * initialPrice);
  
  const totalTrades = tradeLog.length;
  const totalSells = tradeLog.filter(t => t.action === 'SELL').length;
  const totalBuys = tradeLog.filter(t => t.action === 'BUY').length;

  console.log("📋 ─── TRADE LOG SUMMARY (First 15 trades) ───");
  for (let i = 0; i < Math.min(15, tradeLog.length); i++) {
    const t = tradeLog[i];
    const icon = t.action === 'SELL' ? '🔴 SELL' : '🟢 BUY ';
    console.log(`  ${t.timestamp.slice(0, 16)} | ${icon} @ ₹${t.price.toFixed(2).padStart(7)} | Holdings: ${t.holdings.toString().padStart(3)} | Bucket: ${t.bucketCount}/${MAX_CONSECUTIVE}`);
  }
  if (tradeLog.length > 15) console.log(`  ... and ${tradeLog.length - 15} more trades.`);

  console.log("\n📊 ─── RESULTS ───");
  console.log(`  Total Trades : ${totalTrades} (${totalSells} Sells / ${totalBuys} Buys)`);
  console.log(`  Final Price  : ₹${finalPrice.toFixed(2)}`);
  console.log(`  End Holdings : ${holdings} shares`);
  console.log(`  Net PnL      : ₹${(finalPortfolioValue - initialPortfolioValue).toFixed(2)}`);
  console.log("──────────────────────────────────────────────────\n");
}

runSimpleGrid();
