#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dataManager = require('../src/dataManager');

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  node scripts/appendData.js <file-or-json-string> [target-symbol] [--sort asc|desc]

Examples:
  node scripts/appendData.js ./march2026.json
  node scripts/appendData.js ./data/ceinsys_mar2026.json CEINSYS_INE016Q01014_1minute
  npm run append ./march2026.json

Target Symbol defaults to: CEINSYS_INE016Q01014_1minute
  `);
  process.exit(0);
}

const inputSource = args[0];
let targetSymbol = 'CEINSYS_INE016Q01014_1minute';
let sortOrder = 'desc';

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--sort' && args[i + 1]) {
    sortOrder = args[i + 1];
    i++;
  } else if (!args[i].startsWith('--')) {
    targetSymbol = args[i];
  }
}

try {
  console.log(`\nAppending data from: ${inputSource}`);
  console.log(`Target dataset: ${targetSymbol}`);

  let inputData;
  if (fs.existsSync(inputSource)) {
    const raw = fs.readFileSync(inputSource, 'utf8');
    inputData = JSON.parse(raw);
  } else {
    // Attempt parsing as JSON string
    inputData = JSON.parse(inputSource);
  }

  const result = dataManager.appendCandles(targetSymbol, inputData, { sortOrder });

  console.log('\n=========================================');
  console.log(' Append Successful!');
  console.log('=========================================');
  console.log(`File:           ${result.fileName}.json`);
  console.log(`Previous count: ${result.previousTotal}`);
  console.log(`New added:      +${result.newAdded}`);
  console.log(`Updated bars:   ${result.updated}`);
  console.log(`Total candles:  ${result.totalCandles}`);
  console.log(`Date range:     ${result.startDate} to ${result.endDate}`);
  console.log(`Sort order:     ${result.sortOrder}`);
  console.log('=========================================\n');
} catch (err) {
  console.error('\nError appending data:', err.message);
  process.exit(1);
}
