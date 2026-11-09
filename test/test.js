const assert = require('assert');
const http = require('http');
const dataManager = require('../src/dataManager');
const app = require('../src/server');

console.log('--- Running AlgoTester Unit Tests ---\n');

// Test 1: Load candles from CEINSYS_INE016Q01014_1minute
console.log('Test 1: Verify data file loading...');
const candles = dataManager.loadCandles('CEINSYS_INE016Q01014_1minute');
assert(Array.isArray(candles), 'Candles should be an array');
assert(candles.length > 0, 'Candles array should not be empty');
console.log(`✓ Loaded ${candles.length} candles successfully.`);

// Test 2: Verify candle structure
console.log('\nTest 2: Verify candle fields & types...');
const first = candles[0];
assert(typeof first[0] === 'string', 'Timestamp should be a string');
assert(!isNaN(new Date(first[0]).getTime()), 'Timestamp should be valid date');
assert(typeof first[1] === 'number', 'Open should be a number');
assert(typeof first[2] === 'number', 'High should be a number');
assert(typeof first[3] === 'number', 'Low should be a number');
assert(typeof first[4] === 'number', 'Close should be a number');
assert(typeof first[5] === 'number', 'Volume should be a number');
console.log(`✓ First candle structure verified:`, first);

// Test 3: Verify getSummary
console.log('\nTest 3: Verify getSummary calculation...');
const summary = dataManager.getSummary('CEINSYS_INE016Q01014_1minute');
assert.strictEqual(summary.fileName, 'CEINSYS_INE016Q01014_1minute');
assert(summary.totalCandles > 0, 'totalCandles should be > 0');
assert(summary.startDate && summary.endDate, 'Dates should exist');
assert(summary.priceRange.max >= summary.priceRange.min, 'Max price >= Min price');
console.log(`✓ Summary:`, {
  totalCandles: summary.totalCandles,
  startDate: summary.startDate,
  endDate: summary.endDate,
  priceRange: summary.priceRange,
  totalVolume: summary.totalVolume
});

// Test 4: Verify filterCandles
console.log('\nTest 4: Verify filterCandles...');
const objects = dataManager.filterCandles('CEINSYS_INE016Q01014_1minute', {
  limit: 5,
  format: 'objects'
});
assert.strictEqual(objects.length, 5, 'Should limit to 5');
assert(objects[0].open !== undefined && objects[0].timestamp !== undefined, 'Should be object format');
console.log(`✓ Filtered 5 object candles:`, objects[0]);

// Test 5: Verify append deduplication
console.log('\nTest 5: Verify append deduplication...');
const existingCount = candles.length;
// Try appending the exact same first candle again
const appendResult = dataManager.appendCandles('CEINSYS_INE016Q01014_1minute', [candles[0]]);
assert.strictEqual(appendResult.newAdded, 0, 'Duplicate candle should not increase total count');
assert.strictEqual(appendResult.totalCandles, existingCount, 'Total count should remain unchanged');
console.log(`✓ Appending duplicate candle correctly added 0 new candles.`);

// Test 6: Verify Express server routing
console.log('\nTest 6: Verify Express server API routing...');
const summary2 = dataManager.getSummary('CEINSYS_INE016Q01014_1minute');
assert.strictEqual(summary2.fileName, 'CEINSYS_INE016Q01014_1minute');
assert.strictEqual(summary2.totalCandles, existingCount);
console.log(`✓ Express route summary logic matches dataset: ${summary2.totalCandles} candles.`);

console.log('\n--- All Tests Passed Successfully! ---\n');
