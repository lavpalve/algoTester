#!/usr/bin/env node
/**
 * publish-paper.js — copy paper trading results into MongoDB so MVista can show them (read-only).
 *
 * Reads every paper account under data/swing/paper/<experimentId>/ (meta.json, reports/*.json,
 * equity.csv) and upserts two collections. Nothing else is written.
 *   swing_paper_accounts  one document per account, _id = experimentId (latest state + equity curve)
 *   swing_paper_reports   one document per daily report, _id = "<experimentId>:<YYYY-MM-DD>"
 *
 * The files stay the source of truth: re-running replaces the documents with the file contents,
 * so publishing is idempotent and also backfills older reports.
 *
 * Target database: SWING_PUBLISH_MONGO_URI, a full URI including the database name. It must be the
 * shared database that mvista_panel_api reads (its MONGODB_ATLAS_* settings). Optional override of
 * the database name: SWING_PUBLISH_MONGO_DB. When the URI is not set, the script does nothing.
 *
 * Usage
 *   node swing/publish-paper.js                 publish every paper account
 *   node swing/publish-paper.js --dir <path>    publish one paper account folder
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAPER_ROOT = path.join(ROOT, 'data', 'swing', 'paper');
const ACCOUNTS = 'swing_paper_accounts';
const REPORTS = 'swing_paper_reports';

try { if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* optional */ }

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}

/** Host part of a MongoDB URI without credentials, for log lines. */
function safeHost(uri) {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)(?:[^@/]*@)?([^/?]*).*$/, '$1$2');
}

/** Database name from SWING_PUBLISH_MONGO_DB or the URI path. */
function dbNameFrom(uri) {
  const explicit = (process.env.SWING_PUBLISH_MONGO_DB || '').trim();
  if (explicit) return explicit;
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** equity.csv → [{ date, equity, cash, positionValue, openPositions, symbols }]. */
function readEquityCurve(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean);
  return lines.map(line => {
    const [date, equity, cash, positionValue, openPositions, ...rest] = line.split(',');
    return { date, equity: Number(equity), cash: Number(cash), positionValue: Number(positionValue), openPositions: Number(openPositions), symbols: rest.join(',') || '' };
  });
}

/** Build the documents for one paper account folder. */
function buildDocs(dir, publishedAt) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const reportDir = path.join(dir, 'reports');
  const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => DATE_FILE.test(f)).sort() : [];
  const reports = files.map(f => {
    const reportDate = f.match(DATE_FILE)[1];
    const r = readJson(path.join(reportDir, f));
    if (r.experimentId !== meta.experimentId) throw new Error(`${path.relative(ROOT, path.join(reportDir, f))} belongs to ${r.experimentId}, not ${meta.experimentId}`);
    return { _id: `${meta.experimentId}:${reportDate}`, reportDate, ...r, publishedAt };
  });
  const latest = reports[reports.length - 1] || null;
  const s = (meta.config && meta.config.strategy) || {};
  const account = {
    _id: meta.experimentId,
    experimentId: meta.experimentId,
    source: 'algoTester',
    strategy: { name: s.name || null, version: s.version || null, description: s.description || null },
    configHash: meta.configHash,
    configFile: meta.configFile,
    start: meta.start,
    initialEquity: meta.initialEquity,
    openedAt: meta.createdAt || null,
    maxOpenPositions: latest ? latest.maxOpenPositions : (meta.config && meta.config.account ? meta.config.account.maxOpenPositions : null),
    reportCount: reports.length,
    latestReportDate: latest ? latest.reportDate : null,
    asOf: latest ? latest.asOf : null,
    generatedAt: latest ? latest.generatedAt : null,
    account: latest ? latest.account : null,
    performance: latest ? latest.performance : null,
    nextSession: latest ? { session: latest.plan.session, decision: latest.plan.decision, marketScore: latest.plan.market.score, band: latest.plan.market.band } : null,
    warnings: latest ? latest.warnings : [],
    equityCurve: readEquityCurve(path.join(dir, 'equity.csv')),
    publishedAt,
  };
  return { account, reports };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = (process.env.SWING_PUBLISH_MONGO_URI || '').trim();
  if (!uri) {
    console.log('▶ Publish to MongoDB skipped: SWING_PUBLISH_MONGO_URI is not set (see swing/PAPER_TRADING.md).');
    return;
  }
  const dbName = dbNameFrom(uri);
  if (!dbName) throw new Error('SWING_PUBLISH_MONGO_URI has no database name: add it to the URI path (…/msvStorage) or set SWING_PUBLISH_MONGO_DB.');

  const dirs = args.dir
    ? [path.resolve(args.dir)]
    : (fs.existsSync(PAPER_ROOT) ? fs.readdirSync(PAPER_ROOT).map(d => path.join(PAPER_ROOT, d)) : []).filter(d => fs.existsSync(path.join(d, 'meta.json')));
  if (!dirs.length) { console.log('▶ Publish to MongoDB: no paper accounts found.'); return; }

  const publishedAt = new Date();
  const built = dirs.map(d => buildDocs(d, publishedAt));   // read everything before connecting

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    const reportsColl = db.collection(REPORTS);
    await reportsColl.createIndex({ experimentId: 1, reportDate: -1 }, { unique: true });
    for (const { account, reports } of built) {
      if (reports.length) {
        await reportsColl.bulkWrite(reports.map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })), { ordered: true });
      }
      await db.collection(ACCOUNTS).replaceOne({ _id: account._id }, account, { upsert: true });
      console.log(`▶ Published ${account.experimentId} to ${safeHost(uri)}/${dbName}: ${reports.length} report(s), latest ${account.latestReportDate || '—'}`);
    }
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(`✗ publish-paper: ${err.message}`); process.exitCode = 1; });
