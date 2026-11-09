# Professional Web Dashboard for V1.7b Swing Trading

Complete plan for a modern, real-time trading dashboard with professional UI/UX.

---

## 🎨 Features Overview

### 1. **Dashboard Home** (Real-time Overview)
- Live market score gauge (0-100)
- Portfolio equity chart (daily performance)
- Open positions cards with live P&L
- Today's signals/watchlist
- Quick stats: Win rate, Avg R, Total trades

### 2. **Watchlist & Scanner** (Daily Scan Results)
- Top 20 stocks with scores (sortable table)
- Filter by: Score ≥ threshold, Sector, Fundamentals pass/fail
- Stock details modal:
  - Price chart with EMA20/50/100
  - Score breakdown (Trend, RS, Momentum, Volume, Breakout)
  - Fundamentals (ROE, Growth, Turnover)
  - Entry signals (ORB/VWAP zones)
- Export to CSV/Excel

### 3. **Live Trading** (Intraday Monitoring)
- 5-minute candlestick charts
- Entry signal alerts (ORB breakout, VWAP pullback)
- Position management:
  - Current price, entry, stop, trail
  - Live MFE/MAE
  - Manual exit button (emergency)
- Order log (simulated fills)

### 4. **Performance Analytics**
- Equity curve (interactive chart)
- Trade history table (filterable)
- Statistics:
  - By entry method (ORB, VWAP, Confluence)
  - By market regime (Favorable, Cautious, Research)
  - By sector
  - Monthly/Yearly breakdown
- Drawdown analysis
- R-multiple distribution

### 5. **Configuration** (Settings Panel)
- Strategy parameters (trailing %, risk %, max positions)
- Fundamentals filters (ROE, Growth thresholds)
- Market gates (min score, regime rules)
- Data refresh intervals
- Alert preferences (email, push notifications)

### 6. **Backtest Explorer**
- Run historical backtests
- Compare configs side-by-side
- Monte Carlo simulation
- Sensitivity analysis (parameter sweeps)
- Export reports (PDF/Excel)

### 7. **Admin & Monitoring**
- System health (data freshness, MongoDB status)
- Cron job logs
- Data quality flags
- Manual scan trigger
- User activity log

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **UI Library**: shadcn/ui + Tailwind CSS (modern, professional)
- **Charts**: Recharts + TradingView lightweight-charts
- **State Management**: Zustand (lightweight)
- **Real-time**: Socket.io client
- **Routing**: React Router v6
- **Forms**: React Hook Form + Zod validation
- **Tables**: TanStack Table (formerly React Table)
- **Notifications**: Sonner (toast notifications)

### Backend
- **Server**: Node.js + Express
- **API**: RESTful + WebSocket (Socket.io)
- **Database**: MongoDB (existing)
- **Validation**: Zod schemas
- **Auth**: JWT (optional, for multi-user)
- **File watching**: Chokidar (watch report files)
- **Scheduler**: node-cron (existing)

### Infrastructure
- **Dev Server**: Vite (fast HMR)
- **Production**: PM2 (process manager)
- **Reverse Proxy**: Nginx (optional, for domain)
- **SSL**: Let's Encrypt (if deployed)
- **Monitoring**: Simple logging + error tracking

---

## 📁 Project Structure

```
algoTester/
├── backend/
│   ├── server.js                 # Express server
│   ├── routes/
│   │   ├── api.js                # REST API routes
│   │   ├── scanner.js            # Stock scanning endpoints
│   │   ├── trades.js             # Trade management
│   │   ├── backtest.js           # Backtest execution
│   │   └── config.js             # Settings endpoints
│   ├── controllers/
│   │   ├── paperAccount.js       # Paper trading logic
│   │   ├── marketData.js         # MongoDB queries
│   │   └── indicators.js         # Score calculation
│   ├── websocket/
│   │   └── liveUpdates.js        # Socket.io handlers
│   ├── middleware/
│   │   ├── auth.js               # JWT validation (optional)
│   │   └── errorHandler.js
│   └── utils/
│       ├── db.js                 # MongoDB connection
│       └── fileWatcher.js        # Watch reports folder
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/               # shadcn components
│   │   │   ├── Dashboard/
│   │   │   │   ├── MarketScore.tsx
│   │   │   │   ├── EquityChart.tsx
│   │   │   │   ├── PositionCard.tsx
│   │   │   │   └── QuickStats.tsx
│   │   │   ├── Watchlist/
│   │   │   │   ├── ScannerTable.tsx
│   │   │   │   ├── StockModal.tsx
│   │   │   │   └── Filters.tsx
│   │   │   ├── LiveTrading/
│   │   │   │   ├── CandlestickChart.tsx
│   │   │   │   ├── SignalAlert.tsx
│   │   │   │   └── PositionManager.tsx
│   │   │   ├── Performance/
│   │   │   │   ├── EquityCurve.tsx
│   │   │   │   ├── TradeHistory.tsx
│   │   │   │   └── Statistics.tsx
│   │   │   └── Settings/
│   │   │       └── ConfigPanel.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Watchlist.tsx
│   │   │   ├── Live.tsx
│   │   │   ├── Analytics.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useMarketData.ts
│   │   │   └── usePaperAccount.ts
│   │   ├── store/
│   │   │   └── tradingStore.ts   # Zustand store
│   │   ├── lib/
│   │   │   ├── api.ts            # API client
│   │   │   └── utils.ts
│   │   ├── types/
│   │   │   └── index.ts          # TypeScript types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── shared/
│   └── types.ts                  # Shared TS types
│
├── package.json                  # Root package scripts
└── ecosystem.config.js           # PM2 config
```

---

## 🎨 UI/UX Design Mockup

### Color Scheme (Professional Trading Theme)
```css
:root {
  /* Primary */
  --primary: 217 91% 60%;          /* Blue */
  --primary-foreground: 0 0% 100%;
  
  /* Status Colors */
  --success: 142 76% 36%;          /* Green (profit) */
  --danger: 0 84% 60%;             /* Red (loss) */
  --warning: 38 92% 50%;           /* Orange (alert) */
  
  /* Background */
  --background: 222 47% 11%;       /* Dark navy */
  --card: 217 33% 17%;             /* Card background */
  --border: 217 20% 30%;
  
  /* Text */
  --foreground: 213 31% 91%;       /* Light text */
  --muted-foreground: 215 20% 65%;
}
```

### Dashboard Layout (Desktop)
```
┌─────────────────────────────────────────────────────────┐
│ [Logo] V1.7b Swing Trading    [Market: 72] [🔴 Live]  │
├───────┬─────────────────────────────────────────────────┤
│       │ Dashboard Home                                  │
│ Nav   │ ┌──────────────┬──────────────┬──────────────┐ │
│ Menu  │ │ Equity       │ Open Pos: 1  │ Today's      │ │
│       │ │ ₹10,05,000   │ +₹5,234      │ Watchlist: 3 │ │
│ 📊    │ │ +0.5% return │ SHYAMMETL    │ Top: 88.7    │ │
│ Dash  │ └──────────────┴──────────────┴──────────────┘ │
│       │                                                 │
│ 🔍    │ [Equity Curve Chart - Last 30 Days]           │
│ Watch │                                                 │
│       │ ┌─────────────────────────────────────────┐   │
│ 📈    │ │ Open Positions                          │   │
│ Live  │ │ SHYAMMETL | Score 91.9 | Entry ₹1,284  │   │
│       │ │ Current: ₹1,323 (+3.0%) | Stop: ₹1,190 │   │
│ 📊    │ │ [Close Position] [Trail Stop]           │   │
│ Stats │ └─────────────────────────────────────────┘   │
│       │                                                 │
│ ⚙️    │ Recent Trades (Last 5)                         │
│ Set   │ [Table: Symbol | Date | R | P&L]              │
└───────┴─────────────────────────────────────────────────┘
```

---

## 🚀 Implementation Phases

### Phase 1: MVP (Week 1-2) - Core Dashboard
**Goal**: Basic read-only dashboard showing current state

Features:
- ✅ Display today's watchlist (from latest.md)
- ✅ Show open positions
- ✅ Portfolio equity chart
- ✅ Trade history table
- ✅ Market score display

Tech:
- Simple Express API reading JSON files
- React frontend with Recharts
- No real-time updates (manual refresh)

**Deliverable**: Can view all paper trading data in browser

---

### Phase 2: Real-time Updates (Week 3)
**Goal**: Live data streaming

Features:
- ✅ WebSocket connection
- ✅ Auto-refresh on new report generation
- ✅ Live position P&L (polling MongoDB)
- ✅ Alert notifications (new signals, entries, exits)

Tech:
- Socket.io integration
- Chokidar file watching
- Toast notifications

**Deliverable**: Dashboard updates automatically

---

### Phase 3: Interactive Scanner (Week 4)
**Goal**: Deep-dive stock analysis

Features:
- ✅ Complete scan results (top 50 stocks, not just watchlist)
- ✅ Stock detail modal with charts
- ✅ Score breakdown visualization
- ✅ Fundamentals panel
- ✅ Filters & sorting

Tech:
- Modify backtest-swing.js to save all scores
- TradingView lightweight charts
- TanStack Table

**Deliverable**: Can analyze any stock's score/fundamentals

---

### Phase 4: Performance Analytics (Week 5)
**Goal**: Comprehensive trade analysis

Features:
- ✅ Equity curve with drawdown shading
- ✅ Trade breakdown by entry method, sector, regime
- ✅ R-multiple histogram
- ✅ Monthly/yearly returns
- ✅ Export to Excel

Tech:
- Advanced MongoDB aggregations
- Recharts composed charts
- ExcelJS for exports

**Deliverable**: Full backtest-quality analytics

---

### Phase 5: Configuration & Control (Week 6)
**Goal**: Adjust strategy without editing code

Features:
- ✅ Edit strategy parameters (UI form)
- ✅ Toggle fundamentals filters
- ✅ Change risk %, trailing %
- ✅ Manual scan trigger
- ✅ Pause/resume paper trading

Tech:
- Form validation with Zod
- Config file hot-reload
- API endpoints for updates

**Deliverable**: Non-technical user can tune strategy

---

### Phase 6: Live Trading (Intraday) - Optional
**Goal**: Real-time intraday monitoring

Features:
- ✅ 5-min candle updates
- ✅ Entry signal detection
- ✅ Live stop/trail visualization
- ✅ Manual position management

Tech:
- Intraday data polling
- Chart updates via WebSocket
- Manual order simulation

**Deliverable**: Can monitor intraday like a trader

---

## 💰 Estimated Effort

| Phase | Features | Time | Complexity |
|---|---|---:|---|
| Phase 1 | Core Dashboard | 10-15 hours | Low |
| Phase 2 | Real-time Updates | 6-8 hours | Medium |
| Phase 3 | Interactive Scanner | 12-15 hours | Medium |
| Phase 4 | Performance Analytics | 8-10 hours | Medium |
| Phase 5 | Configuration | 6-8 hours | Low |
| Phase 6 | Live Trading | 15-20 hours | High |
| **Total** | **Full System** | **~60-80 hours** | — |

**MVP (Phase 1-2)**: ~20 hours = **Professional read-only dashboard**

**Production-ready (Phase 1-5)**: ~50 hours = **Complete trading platform**

---

## 🎯 Recommended Approach

### Option A: MVP First (Fastest Value)
Build Phase 1-2 in **2 weeks**:
- Basic dashboard showing all data
- Real-time updates
- Clean, professional UI

**Benefit**: Quickly stop using markdown reports, use browser instead

---

### Option B: Full Platform (Production Quality)
Build Phase 1-5 in **6-8 weeks**:
- Complete trading dashboard
- Stock analysis tools
- Performance analytics
- Configuration panel

**Benefit**: Professional-grade platform, no code changes needed

---

### Option C: Enterprise (Optional Phase 6)
Add Phase 6 for **live intraday monitoring**:
- Real-time charts
- Entry signal alerts
- Manual position management

**Benefit**: Day-trader experience

---

## 🔧 Quick Start (Phase 1 MVP)

Would you like me to:

1. **Build the MVP** (Phase 1-2)?
   - Set up React + Express
   - Create dashboard home page
   - Show watchlist, positions, trades
   - Real-time updates

2. **Full platform** (Phase 1-5)?
   - Complete professional UI
   - All analytics
   - Configuration panel

3. **Just the design specs**?
   - I can create detailed Figma-style mockups
   - Component specifications
   - API contract documentation

---

## 📱 Bonus: Mobile Responsive

All phases include mobile-responsive design:
- Collapsible sidebar → bottom nav
- Card layouts stack vertically
- Charts resize dynamically
- Touch-friendly controls

---

## 🎨 Preview: Key Screens

I can create:
1. **Dashboard Home** - Equity, positions, quick stats
2. **Watchlist Scanner** - Top stocks with scores
3. **Stock Detail Modal** - Chart + fundamentals
4. **Performance Analytics** - Equity curve, trade breakdown
5. **Settings Panel** - Strategy configuration

Want me to start building? I'll create a modern, production-ready dashboard! 🚀

