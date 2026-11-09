const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dataManager = require('./dataManager');
const Algorithm = require('./models/algorithm');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

/**
 * Root: API Information & Dataset status
 */
app.get('/', (req, res) => {
  try {
    const summary = dataManager.getSummary('CEINSYS_INE016Q01014_1minute');
    res.json({
      name: 'AlgoTester Market Data Server',
      status: 'active',
      defaultDataset: summary,
      endpoints: {
        listDatasets: 'GET /api/datasets',
        getSummary: 'GET /api/data/:symbol/summary',
        getCandles: 'GET /api/data/:symbol?from=...&to=...&limit=...&format=arrays|objects&sort=asc|desc',
        appendData: 'POST /api/data/:symbol/append (accepts JSON candle data to merge & deduplicate)'
      },
      howToAppend: 'Send a POST request to /api/data/CEINSYS_INE016Q01014_1minute/append with the next month JSON payload, or use: npm run append <path-to-json>'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List all available datasets in data/ folder
 */
app.get('/api/datasets', (req, res) => {
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      return res.json({ datasets: [] });
    }
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    const datasets = files.map(file => {
      const symbol = file.replace('.json', '');
      try {
        return dataManager.getSummary(symbol);
      } catch (e) {
        return { fileName: symbol, error: e.message };
      }
    });
    res.json({ datasets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Summary for a specific dataset
 */
app.get('/api/data/:symbol/summary', (req, res) => {
  try {
    const summary = dataManager.getSummary(req.params.symbol);
    res.json(summary);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * Get candles for a specific dataset with optional filters
 * Query params: from, to, limit, format (arrays|objects), sort (asc|desc)
 */
app.get('/api/data/:symbol', (req, res) => {
  try {
    const symbol = req.params.symbol;
    const { from, to, limit, format = 'arrays', sort = 'desc' } = req.query;

    const candles = dataManager.filterCandles(symbol, {
      from,
      to,
      limit,
      format,
      sortOrder: sort
    });

    res.json({
      status: 'success',
      symbol,
      count: candles.length,
      data: {
        candles
      }
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * Append new candle data to an existing dataset
 */
app.post('/api/data/:symbol/append', (req, res) => {
  try {
    const symbol = req.params.symbol;
    const incomingData = req.body;

    if (!incomingData) {
      return res.status(400).json({ error: 'Request body must contain candle data' });
    }

    const sortOrder = req.query.sort || 'desc';
    const result = dataManager.appendCandles(symbol, incomingData, { sortOrder });

    res.json({
      status: 'success',
      message: `Successfully appended candles to ${symbol}`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/algo/:code
 * Returns best version data for an algorithm:
 *   { code, result (PnL summary), algorithm (full algo doc), signals (buy/sell trade log) }
 */
app.get('/api/algo/:code', (req, res) => {
  try {
    const { code } = req.params;

    // Load the algorithm document
    const doc = Algorithm.findAlgorithm(code);
    if (!doc) {
      return res.status(404).json({ error: `Algorithm '${code}' not found.` });
    }

    // Resolve best version (fallback to latest)
    const bestVersionNum = doc.bestVersion || doc.currentVersion;
    const bestVersion = doc.versions.find(v => v.version === bestVersionNum);
    const bestSummary = doc.versionSummary.find(s => s.version === bestVersionNum);

    // Load the full backtest result (trade log lives here)
    const fullResult = Algorithm.getLatestBacktestResult(code, bestVersionNum);

    // Extract buy/sell signals from the trade log
    const signals = fullResult?.tradeLog
      ? fullResult.tradeLog.map(entry => ({
        action: entry.action,            // 'BUY' | 'SELL'
        timestamp: entry.timestamp,
        price: entry.price,
        qty: entry.qty,
        reason: entry.reason,
        ...(entry.action === 'BUY' && { level: entry.level, profit: entry.profit ?? null }),
        ...(entry.action === 'SELL' && { levels: entry.levels ?? null, stepPct: entry.stepPct ?? null }),
      }))
      : [];

    // Build the PnL result summary
    const result = bestSummary
      ? {
        version: bestSummary.version,
        tag: bestSummary.tag,
        status: bestSummary.status,
        totalPnl: bestSummary.totalPnl,
        totalPnlPct: bestSummary.totalPnlPct,
        avgTradeProfitPct: bestSummary.avgTradeProfitPct,
        avgPerDayProfitPct: bestSummary.avgPerDayProfitPct,
        totalTrades: bestSummary.totalTrades,
        winRatePct: bestSummary.winRatePct,
        maxDrawdownPct: bestSummary.maxDrawdownPct,
        totalSellQty: bestSummary.totalSellQty,
        totalBuyQty: bestSummary.totalBuyQty,
        tradingDays: bestSummary.tradingDays,
        ranAt: fullResult?.ranAt ?? null,
        dataFile: fullResult?.dataFile ?? null,
        fromDate: fullResult?.fromDate ?? null,
        toDate: fullResult?.toDate ?? null,
      }
      : null;

    return res.json({
      code: doc.code,
      result,
      algorithm: {
        code: doc.code,
        name: doc.name,
        description: doc.description,
        bestVersion: doc.bestVersion,
        currentVersion: doc.currentVersion,
        promotionThreshold: doc.promotionThreshold,
        versionSummary: doc.versionSummary,
        bestVersionConfig: bestVersion ?? null,
        updatedAt: doc.updatedAt,
      },
      signals: {
        total: signals.length,
        buys: signals.filter(s => s.action === 'BUY').length,
        sells: signals.filter(s => s.action === 'SELL').length,
        log: signals,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/algo
 * List all algorithms (lightweight index)
 */
app.get('/api/algo', (req, res) => {
  try {
    const list = Algorithm.listAlgorithms();
    res.json({ count: list.length, algorithms: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server if run directly
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`AlgoTester Server running on http://localhost:${PORT}`);
    console.log(`Default data file loaded: CEINSYS_INE016Q01014_1minute.json`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use.`);
      console.error(`   On macOS, port 5000 is reserved by AirPlay. Try a different port:`);
      console.error(`   PORT=3001 npm start\n`);
    } else {
      console.error('❌ Server error:', err.message);
    }
    process.exit(1);
  });
}

module.exports = app;
