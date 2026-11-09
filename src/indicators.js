/**
 * Indicator Engine — powered by `technicalindicators`
 *
 * Wraps the `technicalindicators` library with a unified API
 * so the backtest engine only calls computeIndicators() and
 * gets a Map<name, value> back.
 *
 * Supported types:
 *   EMA, SMA, ATR, RSI, MACD, BB (Bollinger Bands), CLOSE, VOLUME
 *
 * Candle format accepted:
 *   Array: [timestamp, open, high, low, close, volume, oi]
 *   Object: { timestamp, open, high, low, close, volume }
 */

'use strict';

const {
  EMA,
  SMA,
  ATR,
  RSI,
  MACD,
  BollingerBands,
} = require('technicalindicators');

// ─── Candle normaliser ────────────────────────────────────────────────────────

function normalise(candle) {
  if (Array.isArray(candle)) {
    return {
      timestamp: candle[0],
      open:   Number(candle[1]),
      high:   Number(candle[2]),
      low:    Number(candle[3]),
      close:  Number(candle[4]),
      volume: Number(candle[5]),
    };
  }
  return candle;
}

// ─── Individual indicator wrappers ────────────────────────────────────────────

/**
 * EMA — last value only
 * @param {number[]} values
 * @param {number} period
 * @returns {number|null}
 */
function ema(values, period) {
  if (values.length < period) return null;
  const result = EMA.calculate({ period, values });
  return result.length ? result[result.length - 1] : null;
}

/**
 * SMA — last value only
 */
function sma(values, period) {
  if (values.length < period) return null;
  const result = SMA.calculate({ period, values });
  return result.length ? result[result.length - 1] : null;
}

// Keep emaFull as alias (used in tests)
const emaFull = ema;

/**
 * ATR — last value only
 * @param {Array} candles - raw candle array (array or object format)
 * @param {number} period
 * @returns {number|null}
 */
function atr(candles, period) {
  const norm = candles.map(normalise);
  if (norm.length < period + 1) return null;
  const result = ATR.calculate({
    period,
    high:  norm.map(c => c.high),
    low:   norm.map(c => c.low),
    close: norm.map(c => c.close),
  });
  return result.length ? result[result.length - 1] : null;
}

/**
 * RSI — last value only
 */
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  const result = RSI.calculate({ period, values });
  return result.length ? result[result.length - 1] : null;
}

/**
 * MACD — last value only
 * Returns { MACD, signal, histogram } or null
 */
function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (values.length < slowPeriod + signalPeriod) return null;
  const result = MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  return result.length ? result[result.length - 1] : null;
  // Returns: { MACD: number, signal: number, histogram: number }
}

/**
 * Bollinger Bands — last value only
 * Returns { upper, middle, lower } or null
 */
function bollingerBands(values, period = 20, stdDev = 2) {
  if (values.length < period) return null;
  const result = BollingerBands.calculate({ period, values, stdDev });
  if (!result.length) return null;
  const last = result[result.length - 1];
  return { upper: last.upper, middle: last.middle, lower: last.lower };
}

// ─── computeIndicators ────────────────────────────────────────────────────────

/**
 * Compute a set of indicators over the candle series and return the
 * LAST value for each.
 *
 * @param {Array} candles   - Raw candles (oldest first, array or object format)
 * @param {Array} indicatorDefs - Indicator definitions
 * @returns {Map<string, any>}
 *
 * Example indicatorDefs:
 *   [
 *     { type: 'EMA',  source: 'close', params: { period: 200 }, name: 'EMA200' },
 *     { type: 'ATR',  params: { period: 14 },                   name: 'ATR14'  },
 *     { type: 'RSI',  source: 'close', params: { period: 14 },  name: 'RSI14'  },
 *     { type: 'MACD', source: 'close',
 *       params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, name: 'MACD' },
 *     { type: 'CLOSE', name: 'CLOSE' },
 *   ]
 */
function computeIndicators(candles, indicatorDefs = []) {
  const result = new Map();
  const normalised = candles.map(normalise);

  for (const def of indicatorDefs) {
    const { type, source = 'close', params = {}, name } = def;
    const key = name || type;
    const values = normalised.map(c => c[source] ?? c.close);

    try {
      switch (type.toUpperCase()) {
        case 'EMA':
          result.set(key, ema(values, params.period || 14));
          break;

        case 'SMA':
          result.set(key, sma(values, params.period || 14));
          break;

        case 'ATR':
          // ATR needs candle objects, not a values array
          result.set(key, atr(normalised, params.period || 14));
          break;

        case 'RSI':
          result.set(key, rsi(values, params.period || 14));
          break;

        case 'MACD':
          result.set(key, macd(
            values,
            params.fastPeriod   || 12,
            params.slowPeriod   || 26,
            params.signalPeriod || 9,
          ));
          break;

        case 'BB':
        case 'BOLLINGER':
        case 'BOLLINGERBANDS':
          result.set(key, bollingerBands(values, params.period || 20, params.stdDev || 2));
          break;

        case 'CLOSE':
          result.set(key, normalised[normalised.length - 1]?.close ?? null);
          break;

        case 'VOLUME':
          result.set(key, normalised[normalised.length - 1]?.volume ?? null);
          break;

        default:
          result.set(key, null);
      }
    } catch {
      result.set(key, null);
    }
  }

  return result;
}

module.exports = {
  computeIndicators,
  ema,
  emaFull,        // alias kept for test compatibility
  sma,
  atr,
  rsi,
  macd,
  bollingerBands,
  normalise,
};
