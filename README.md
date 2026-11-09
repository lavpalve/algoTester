# AlgoTester - Market Data & Backtesting Engine

Node.js backtesting and market data management service with Express API support.

## 📁 Data Files

- [data/CEINSYS_INE016Q01014_1minute.json](file:///Users/ankush/Projects/algoTester/data/CEINSYS_INE016Q01014_1minute.json)
- [CEINSYS_INE016Q01014_1minute.json](file:///Users/ankush/Projects/algoTester/CEINSYS_INE016Q01014_1minute.json) (Root mirror)

### Data Format
Standard Zerodha Kite / Angel One 1-minute OHLCV format:
```json
{
  "status": "success",
  "data": {
    "candles": [
      [
        "2026-02-27T15:29:00+05:30", // [0] Timestamp (ISO 8601)
        974.9,                       // [1] Open
        978.0,                       // [2] High
        971.0,                       // [3] Low
        978.0,                       // [4] Close
        72,                          // [5] Volume
        0                            // [6] Open Interest
      ]
    ]
  }
}
```

### Current Dataset Metrics
- **Symbol / File**: `CEINSYS_INE016Q01014_1minute`
- **Candle Count**: `942` bars
- **Date Range**: `2026-02-25T12:18:00+05:30` to `2026-02-27T15:29:00+05:30`
- **Price Range**: `₹965.3` to `₹1010.7`
- **Total Volume**: `47,602` shares

---

## 🚀 How to Add New Monthly Data (Up to Sept 2026)

When you receive the next batch of data (March to September 2026), you can append it in any of three easy ways. The system automatically **deduplicates bars by timestamp** and **sorts** them.

### 1. Via Command Line (CLI)
Save your new data to a JSON file (e.g. `march2026.json`) and run:
```bash
npm run append ./march2026.json
```
Or with custom options:
```bash
node scripts/appendData.js ./march2026.json CEINSYS_INE016Q01014_1minute --sort desc
```

### 2. Via Express REST API
Send a POST request with the new JSON payload:
```bash
curl -X POST http://localhost:3000/api/data/CEINSYS_INE016Q01014_1minute/append \
  -H "Content-Type: application/json" \
  -d @march2026.json
```

### 3. Programmatically in Node.js
```javascript
const { appendCandles } = require('./index');

const result = appendCandles('CEINSYS_INE016Q01014_1minute', newCandlesData);
console.log(`Added ${result.newAdded} candles. New total: ${result.totalCandles}`);
```

---

## 🌐 Express Server API Endpoints

Start the server:
```bash
npm start
```
Dev server with hot-reload:
```bash
npm run dev
```

### Endpoints:
| Method | Route | Description |
|---|---|---|
| `GET` | `/` | API Information and dataset status |
| `GET` | `/api/datasets` | List all available datasets in `data/` folder |
| `GET` | `/api/data/:symbol/summary` | Summary stats (candle count, range, high/low, volume) |
| `GET` | `/api/data/:symbol` | Query candles with optional filters |
| `POST` | `/api/data/:symbol/append` | Append new candle data directly |

#### Query Parameters for `GET /api/data/:symbol`:
- `from`: Start ISO timestamp (e.g. `2026-02-26T09:15:00+05:30`)
- `to`: End ISO timestamp (e.g. `2026-02-26T15:30:00+05:30`)
- `limit`: Number of bars to return (e.g. `100`)
- `format`: `arrays` (default Kite format) or `objects` (`{ timestamp, open, high, low, close, volume, openInterest }`)
- `sort`: `desc` (default) or `asc` (chronological)

---

## 🧪 Testing

Run test suite:
```bash
npm test
```
View dataset summary:
```bash
npm run summary
```
