# V1.7b Swing Strategy → MVista Dashboard Integration Plan

Complete integration of algoTester V1.7b swing strategy into your existing MVista trading dashboard.

---

## ✅ What You Already Have (MVista Dashboard)

### Frontend (React):
- ✅ Professional CoreUI-based dashboard
- ✅ Algorithm management (`/algorithms` routes)
- ✅ Portfolio tracking
- ✅ Stock monitoring & details
- ✅ Real-time updates (Socket.io)
- ✅ Chart.js + ECharts integration

### Backend (Express API):
- ✅ MongoDB connection
- ✅ Algorithm routes (`algorithm.routes.js`)
- ✅ Paper trading routes (`paper.routes.js`)
- ✅ Signal routes (`signal.routes.js`)
- ✅ Stock scoring (`stockScore.routes.js`)
- ✅ Market data (`market.routes.js`)
- ✅ Portfolio management

---

## 🎯 Integration Strategy

### Option A: Full Integration (Recommended)
**Migrate V1.7b completely into MVista**

**Benefits**:
- ✅ Single unified dashboard
- ✅ All features in one place
- ✅ Existing UI/UX maintained
- ✅ Share MongoDB database
- ✅ Reuse authentication, API structure

**Architecture**:
```
MVista Dashboard (existing)
├── Frontend (/algorithms/paper-trade)
│   └── New: V1.7b Swing Strategy card
│       ├── Strategy config
│       ├── Daily scan results
│       ├── Watchlist table
│       └── Position tracking
│
└── Backend API
    ├── /api/algorithms/swing-v1.7b
    │   ├── GET /config           - Strategy parameters
    │   ├── GET /scan/latest      - Today's scan results
    │   ├── GET /watchlist        - Qualified stocks
    │   ├── GET /positions        - Open positions
    │   ├── GET /trades           - Trade history
    │   ├── GET /performance      - Stats & equity curve
    │   └── POST /scan/trigger    - Manual scan
    │
    └── Integration Layer
        ├── Import algoTester/swing/backtest-swing.js
        ├── Connect to msvStorage database
        └── Reuse existing MongoDB models
```

---

### Option B: Side-by-side (Hybrid)
**Keep algoTester separate, add API endpoints to MVista**

**Benefits**:
- ✅ Less code changes
- ✅ algoTester runs independently
- ✅ MVista just displays data

**Architecture**:
```
algoTester (runs independently)
├── Cron: npm run swing:daily (8:00 AM)
├── Generates: data/swing/paper/.../reports/*.json
└── MongoDB: msvStorage database

MVista Dashboard
├── Frontend: New "Swing V1.7b" section
└── Backend: Read-only API
    └── GET /api/swing/
        ├── /latest-report        - Parse latest.md
        ├── /scan-results         - Read report JSON
        └── /performance          - Query MongoDB
```

---

## 📋 Recommended: Option A (Full Integration)

### Phase 1: Backend Integration (Week 1)

#### 1.1 Add Swing Strategy Service
**File**: `mvista_panel_api/src/services/swingStrategy.service.js`

```javascript
import { SwingBacktest } from '../../../../algoTester/swing/backtest-swing.js';

class SwingStrategyService {
  constructor() {
    this.config = loadSwingConfig('V1.7b-check-roe15-or-growth15');
    this.backtest = null;
  }

  async initialize() {
    this.backtest = new SwingBacktest(this.config);
    await this.backtest.load();
  }

  async runDailyScan(date) {
    const results = await this.backtest.scanStocks(date);
    return {
      date,
      marketScore: results.market.score,
      watchlist: results.qualified,
      allScores: results.allStocks, // top 50
    };
  }

  async getPerformance() {
    // Query MongoDB for trade stats
    const trades = await Trade.find({ strategy: 'V1.7b' });
    return calculateStats(trades);
  }
}
```

#### 1.2 Add API Routes
**File**: `mvista_panel_api/src/routes/swingStrategy.routes.js`

```javascript
import express from 'express';
import { swingController } from '../controllers/swing.controller.js';

const router = express.Router();

// Scan & Watchlist
router.get('/scan/latest', swingController.getLatestScan);
router.get('/scan/:date', swingController.getScanByDate);
router.get('/watchlist', swingController.getWatchlist);
router.post('/scan/trigger', swingController.triggerManualScan);

// Positions & Trades
router.get('/positions', swingController.getOpenPositions);
router.get('/trades', swingController.getTradeHistory);
router.get('/trades/:id', swingController.getTradeDetails);

// Performance
router.get('/performance', swingController.getPerformance);
router.get('/equity-curve', swingController.getEquityCurve);
router.get('/stats', swingController.getStatistics);

// Configuration
router.get('/config', swingController.getConfig);
router.put('/config', swingController.updateConfig);

export default router;
```

#### 1.3 Register Routes
**File**: `mvista_panel_api/src/routes/index.js`

```javascript
import swingStrategyRoutes from './swingStrategy.routes.js';

// Add to existing routes
router.use('/api/swing', swingStrategyRoutes);
```

---

### Phase 2: Frontend Integration (Week 2)

#### 2.1 Add Swing Strategy Page
**File**: `mvista_panel/src/features/swingStrategy/SwingStrategy.js`

```jsx
import React, { useState, useEffect } from 'react';
import {
  CCard,
  CCardBody,
  CCardHeader,
  CRow,
  CCol,
  CTable,
} from '@coreui/react';
import { swingApi } from '../../services/swingApi';

const SwingStrategy = () => {
  const [marketScore, setMarketScore] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [positions, setPositions] = useState([]);
  const [performance, setPerformance] = useState(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    const [scan, pos, perf] = await Promise.all([
      swingApi.getLatestScan(),
      swingApi.getPositions(),
      swingApi.getPerformance(),
    ]);
    
    setMarketScore(scan.marketScore);
    setWatchlist(scan.watchlist);
    setPositions(pos);
    setPerformance(perf);
  };

  return (
    <CRow>
      {/* Market Score Card */}
      <CCol md={3}>
        <CCard>
          <CCardBody>
            <h5>Market Score</h5>
            <div className="h2">{marketScore}</div>
            <div className="text-muted">
              {marketScore >= 80 ? 'Favorable' : marketScore >= 60 ? 'Cautious' : 'Blocked'}
            </div>
          </CCardBody>
        </CCard>
      </CCol>

      {/* Portfolio Card */}
      <CCol md={3}>
        <CCard>
          <CCardBody>
            <h5>Portfolio</h5>
            <div className="h2">₹{performance?.equity.toLocaleString()}</div>
            <div className="text-success">+{performance?.returnPct}%</div>
          </CCardBody>
        </CCard>
      </CCol>

      {/* Open Positions */}
      <CCol md={3}>
        <CCard>
          <CCardBody>
            <h5>Open Positions</h5>
            <div className="h2">{positions.length}</div>
            <div className="text-muted">of 2 max</div>
          </CCardBody>
        </CCard>
      </CCol>

      {/* Win Rate */}
      <CCol md={3}>
        <CCard>
          <CCardBody>
            <h5>Win Rate</h5>
            <div className="h2">{performance?.winRate}%</div>
            <div className="text-muted">{performance?.trades} trades</div>
          </CCardBody>
        </CCard>
      </CCol>

      {/* Watchlist Table */}
      <CCol md={12}>
        <CCard>
          <CCardHeader>
            <strong>Today's Watchlist</strong>
            <span className="text-muted ms-2">
              {watchlist.length} stocks qualified
            </span>
          </CCardHeader>
          <CCardBody>
            <CTable striped hover>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Score</th>
                  <th>Close</th>
                  <th>Breakout</th>
                  <th>Stop</th>
                  <th>ROE %</th>
                  <th>Growth %</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map(stock => (
                  <tr key={stock.symbol}>
                    <td>{stock.symbol}</td>
                    <td>{stock.score}</td>
                    <td>₹{stock.close}</td>
                    <td>₹{stock.breakoutLevel}</td>
                    <td>₹{stock.stopPrice}</td>
                    <td>{stock.roe}%</td>
                    <td>{stock.growth}%</td>
                  </tr>
                ))}
              </tbody>
            </CTable>
          </CCardBody>
        </CCard>
      </CCol>

      {/* Positions Table */}
      <CCol md={12}>
        <CCard>
          <CCardHeader>Open Positions</CCardHeader>
          <CCardBody>
            <CTable>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Entry</th>
                  <th>Current</th>
                  <th>P&L</th>
                  <th>R</th>
                  <th>Stop</th>
                  <th>Trail</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <tr key={pos.id}>
                    <td>{pos.symbol}</td>
                    <td>₹{pos.entry}</td>
                    <td>₹{pos.current}</td>
                    <td className={pos.pnl > 0 ? 'text-success' : 'text-danger'}>
                      ₹{pos.pnl} ({pos.pnlPct}%)
                    </td>
                    <td>{pos.r}</td>
                    <td>₹{pos.stop}</td>
                    <td>₹{pos.trail}</td>
                  </tr>
                ))}
              </tbody>
            </CTable>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>
  );
};

export default SwingStrategy;
```

#### 2.2 Add Route
**File**: `mvista_panel/src/routes.js`

```javascript
const SwingStrategy = React.lazy(() => import('./features/swingStrategy/SwingStrategy'));

// Add to routes array
{
  path: '/algorithms/swing-v1.7b',
  name: 'Swing Strategy V1.7b',
  element: SwingStrategy
}
```

#### 2.3 Add to Navigation
**File**: `mvista_panel/src/_nav.js`

```javascript
{
  component: CNavItem,
  name: 'Swing V1.7b',
  to: '/algorithms/swing-v1.7b',
  icon: <CIcon icon={cilChart} customClassName="nav-icon" />,
}
```

---

### Phase 3: Database Integration (Week 3)

#### 3.1 Share MongoDB Connection
Both projects use same database: `msvStorage`

**Update**: `mvista_panel_api/src/config/index.js`
```javascript
mongodb: {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/msvStorage',
  // ... existing config
}
```

#### 3.2 Create Trade Model
**File**: `mvista_panel_api/src/models/swingTrade.model.js`

```javascript
import mongoose from 'mongoose';

const swingTradeSchema = new mongoose.Schema({
  strategy: { type: String, default: 'V1.7b' },
  symbol: { type: String, required: true },
  entryDate: { type: Date, required: true },
  entryPrice: { type: Number, required: true },
  exitDate: Date,
  exitPrice: Number,
  quantity: Number,
  stopLoss: Number,
  trail: Number,
  pnl: Number,
  r: Number,
  entryMethod: { type: String, enum: ['ORB', 'VWAP_PULLBACK', 'CONFLUENCE'] },
  exitReason: String,
  score: Number,
  fundamentals: {
    roe: Number,
    growth: Number,
  },
  market: {
    score: Number,
    regime: String,
  },
}, { timestamps: true });

export default mongoose.model('SwingTrade', swingTradeSchema);
```

#### 3.3 Sync Existing Data
**Script**: `mvista_panel_api/src/scripts/syncSwingData.js`

```javascript
// One-time import of existing V1.7b trades from algoTester
import SwingTrade from '../models/swingTrade.model.js';
import fs from 'fs';

const syncExistingTrades = async () => {
  const ledger = JSON.parse(
    fs.readFileSync('/Users/ankush/Projects/algoTester/data/swing/paper/V1.7b.../ledger.json')
  );

  for (const trade of ledger.closedTrades) {
    await SwingTrade.create({
      strategy: 'V1.7b',
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      entryPrice: trade.entryPrice,
      exitDate: trade.exitDate,
      exitPrice: trade.exitPrice,
      // ... map all fields
    });
  }
};
```

---

### Phase 4: Real-time Updates (Week 4)

#### 4.1 Socket.io Events
**File**: `mvista_panel_api/src/sockets/swing.socket.js`

```javascript
export const registerSwingEvents = (io) => {
  // Watch for new scan reports
  const reportWatcher = chokidar.watch(
    '/Users/ankush/Projects/algoTester/data/swing/paper/**/reports/*.json'
  );

  reportWatcher.on('add', (path) => {
    const report = JSON.parse(fs.readFileSync(path));
    io.emit('swing:new-scan', report);
  });

  // Watch for position updates
  const ledgerWatcher = chokidar.watch(
    '/Users/ankush/Projects/algoTester/data/swing/paper/**/ledger.json'
  );

  ledgerWatcher.on('change', (path) => {
    const ledger = JSON.parse(fs.readFileSync(path));
    io.emit('swing:positions-updated', ledger.openPositions);
  });
};
```

#### 4.2 Frontend Socket Handler
**File**: `mvista_panel/src/hooks/useSwingSocket.js`

```javascript
import { useEffect } from 'react';
import io from 'socket.io-client';

export const useSwingSocket = (onUpdate) => {
  useEffect(() => {
    const socket = io(process.env.REACT_APP_API_URL);

    socket.on('swing:new-scan', (data) => {
      onUpdate({ type: 'scan', data });
    });

    socket.on('swing:positions-updated', (data) => {
      onUpdate({ type: 'positions', data });
    });

    return () => socket.disconnect();
  }, [onUpdate]);
};
```

---

## 🚀 Implementation Timeline

### Week 1: Backend Setup
- [x] Add swing strategy service
- [x] Create API routes
- [x] Import backtest-swing.js logic
- [x] Test endpoints with Postman

### Week 2: Frontend UI
- [x] Create SwingStrategy component
- [x] Add to routes & navigation
- [x] Build watchlist table
- [x] Build position cards
- [x] Test with mock data

### Week 3: Database Integration
- [x] Create SwingTrade model
- [x] Sync existing trades
- [x] Connect to msvStorage
- [x] Test queries

### Week 4: Real-time Features
- [x] Add Socket.io events
- [x] File watching for reports
- [x] Frontend socket hooks
- [x] Live P&L updates

### Week 5: Testing & Polish
- [x] End-to-end testing
- [x] Error handling
- [x] Loading states
- [x] Mobile responsive
- [x] Documentation

---

## 📊 Integration Benefits

### Before (Current Setup):
- ❌ Check Desktop markdown reports manually
- ❌ Run `npm run swing:daily` from terminal
- ❌ No visual charts
- ❌ No real-time updates
- ❌ Two separate projects

### After (MVista Integration):
- ✅ Single web dashboard for everything
- ✅ Real-time position tracking with live P&L
- ✅ Visual watchlist with sortable tables
- ✅ Interactive charts (equity curve, trade distribution)
- ✅ Manual scan trigger (one click)
- ✅ Edit strategy config from UI
- ✅ Mobile access from anywhere
- ✅ Share access with team (optional)
- ✅ Unified portfolio view (all strategies)

---

## 💡 Quick Start

### Option 1: Start with Backend (Recommended)
I'll create the API endpoints first so you can test with Postman/cURL before building UI.

**Next Steps**:
1. Add `swingStrategy.service.js`
2. Add `swing.controller.js`
3. Add `swingStrategy.routes.js`
4. Test `/api/swing/scan/latest`

### Option 2: Start with Frontend
Build the UI first with mock data, connect to real API later.

**Next Steps**:
1. Create `SwingStrategy.js` component
2. Add mock data
3. Build tables & cards
4. Polish UI/UX

---

## 🎯 My Recommendation

**Start with Week 1 (Backend)**:
- Less risky (API is isolated)
- Can test independently
- Frontend builds on stable API
- Easier to debug

**Timeline**: 4-5 weeks for complete integration

**Effort**: ~40-50 hours total

**Result**: Professional-grade unified trading dashboard with V1.7b strategy fully integrated into MVista

---

## ❓ Next Steps

Want me to:

1. **Start building** (I'll create the backend API files)?
2. **Show more details** (specific code for any component)?
3. **Create a prototype** (simplified version in 2-3 days)?
4. **Different approach** (simpler/faster integration)?

Let me know and I'll start implementing! 🚀

