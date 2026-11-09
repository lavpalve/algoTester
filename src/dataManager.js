const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = 'CEINSYS_INE016Q01014_1minute';

/**
 * Resolves the absolute path of a data file.
 * Checks data/ directory first, then root directory.
 */
function resolveFilePath(fileName = DEFAULT_FILE) {
  const cleanName = fileName.replace(/\.json$/, '');
  const dataDirPath = path.resolve(process.cwd(), 'data', `${cleanName}.json`);
  const rootDirPath = path.resolve(process.cwd(), `${cleanName}.json`);

  if (fs.existsSync(dataDirPath)) {
    return dataDirPath;
  }
  if (fs.existsSync(rootDirPath)) {
    return rootDirPath;
  }
  // Default to data directory if not existing yet
  return dataDirPath;
}

/**
 * Loads the raw JSON file containing candle data.
 */
function loadDataFile(fileName = DEFAULT_FILE) {
  const filePath = resolveFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Loads candles array from a given data file.
 * Returns Array of [timestamp, open, high, low, close, volume, open_interest]
 */
function loadCandles(fileName = DEFAULT_FILE) {
  const data = loadDataFile(fileName);
  if (data && data.data && Array.isArray(data.data.candles)) {
    return data.data.candles;
  }
  if (Array.isArray(data)) {
    return data;
  }
  throw new Error('Invalid candle data structure in file: ' + fileName);
}

/**
 * Parses an individual candle array into a structured object.
 */
function candleToObject(candle) {
  return {
    timestamp: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    openInterest: Number(candle[6] ?? 0)
  };
}

/**
 * Normalizes input candles from various possible structures:
 * - { status: "success", data: { candles: [...] } }
 * - { candles: [...] }
 * - Array of candles
 * - JSON string or file path
 */
function normalizeCandlesInput(input) {
  if (typeof input === 'string') {
    // Check if it's a file path
    if (fs.existsSync(input)) {
      const fileData = JSON.parse(fs.readFileSync(input, 'utf8'));
      return normalizeCandlesInput(fileData);
    }
    // Try parsing as JSON string
    try {
      const parsed = JSON.parse(input);
      return normalizeCandlesInput(parsed);
    } catch {
      throw new Error('Input string is neither a valid file path nor valid JSON');
    }
  }

  if (input && input.data && Array.isArray(input.data.candles)) {
    return input.data.candles;
  }
  if (input && Array.isArray(input.candles)) {
    return input.candles;
  }
  if (Array.isArray(input)) {
    return input;
  }

  throw new Error('Unrecognized candle input structure');
}

/**
 * Appends new candles to the existing data file with deduplication and sorting.
 *
 * @param {string} fileName - Base filename (e.g. 'CEINSYS_INE016Q01014_1minute')
 * @param {object|array|string} newCandlesInput - The new candles to append
 * @param {object} options - Options: { sortOrder: 'desc' | 'asc' } (default 'desc')
 * @returns {object} Summary of the append operation
 */
function appendCandles(fileName = DEFAULT_FILE, newCandlesInput, options = {}) {
  const sortOrder = options.sortOrder || 'desc';
  const cleanName = fileName.replace(/\.json$/, '');
  const dataDirPath = path.resolve(process.cwd(), 'data', `${cleanName}.json`);
  const rootDirPath = path.resolve(process.cwd(), `${cleanName}.json`);

  let existingCandles = [];
  try {
    existingCandles = loadCandles(fileName);
  } catch {
    existingCandles = [];
  }

  const incomingCandles = normalizeCandlesInput(newCandlesInput);

  // Use Map keyed by ISO timestamp for deduplication
  const candleMap = new Map();

  // Load existing candles first
  for (const c of existingCandles) {
    if (c && c[0]) {
      candleMap.set(c[0], c);
    }
  }

  const initialCount = candleMap.size;
  let addedCount = 0;
  let updatedCount = 0;

  // Insert incoming candles
  for (const c of incomingCandles) {
    if (c && c[0]) {
      if (candleMap.has(c[0])) {
        // If incoming candle has non-zero volume and previous had 0, update it
        const prev = candleMap.get(c[0]);
        if (Number(c[5]) > 0 && Number(prev[5]) === 0) {
          candleMap.set(c[0], c);
          updatedCount++;
        }
      } else {
        candleMap.set(c[0], c);
        addedCount++;
      }
    }
  }

  // Convert back to array
  const allCandles = Array.from(candleMap.values());

  // Sort candles by timestamp
  allCandles.sort((a, b) => {
    const timeA = new Date(a[0]).getTime();
    const timeB = new Date(b[0]).getTime();
    return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
  });

  const outputData = {
    status: 'success',
    data: {
      candles: allCandles
    }
  };

  const jsonString = JSON.stringify(outputData, null, 2);

  // Ensure data directory exists
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Save to both data/ and root for full compatibility
  fs.writeFileSync(dataDirPath, jsonString, 'utf8');
  fs.writeFileSync(rootDirPath, jsonString, 'utf8');

  const timestamps = allCandles.map(c => c[0]);
  const sortedAsc = [...timestamps].sort();
  const startDate = sortedAsc[0] || null;
  const endDate = sortedAsc[sortedAsc.length - 1] || null;

  return {
    fileName: cleanName,
    previousTotal: initialCount,
    newAdded: addedCount,
    updated: updatedCount,
    totalCandles: allCandles.length,
    startDate,
    endDate,
    sortOrder
  };
}

/**
 * Calculates summary statistics for the dataset.
 */
function getSummary(fileName = DEFAULT_FILE) {
  const candles = loadCandles(fileName);
  if (!candles.length) {
    return {
      fileName,
      totalCandles: 0
    };
  }

  const timestamps = candles.map(c => c[0]).sort();
  const startDate = timestamps[0];
  const endDate = timestamps[timestamps.length - 1];

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalVolume = 0;

  for (const c of candles) {
    const low = Number(c[3]);
    const high = Number(c[2]);
    const vol = Number(c[5]) || 0;

    if (low < minPrice) minPrice = low;
    if (high > maxPrice) maxPrice = high;
    totalVolume += vol;
  }

  return {
    fileName: fileName.replace(/\.json$/, ''),
    totalCandles: candles.length,
    startDate,
    endDate,
    priceRange: {
      min: minPrice === Infinity ? 0 : minPrice,
      max: maxPrice === -Infinity ? 0 : maxPrice
    },
    totalVolume,
    latestCandle: candleToObject(candles[0]),
    earliestCandle: candleToObject(candles[candles.length - 1])
  };
}

/**
 * Slices/filters candles by date range, count limit, and output format.
 */
function filterCandles(fileName = DEFAULT_FILE, options = {}) {
  const { from, to, limit, format = 'arrays', sortOrder = 'asc' } = options;
  let candles = loadCandles(fileName);

  // Normalize to chronological (ascending) first for date filtering
  candles = [...candles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

  if (from) {
    const fromTime = new Date(from).getTime();
    candles = candles.filter(c => new Date(c[0]).getTime() >= fromTime);
  }

  if (to) {
    const toTime = new Date(to).getTime();
    candles = candles.filter(c => new Date(c[0]).getTime() <= toTime);
  }

  if (sortOrder === 'desc') {
    candles.reverse();
  }

  if (limit && Number(limit) > 0) {
    candles = candles.slice(0, Number(limit));
  }

  if (format === 'objects') {
    return candles.map(candleToObject);
  }

  return candles;
}

module.exports = {
  DEFAULT_FILE,
  resolveFilePath,
  loadDataFile,
  loadCandles,
  candleToObject,
  normalizeCandlesInput,
  appendCandles,
  getSummary,
  filterCandles
};
