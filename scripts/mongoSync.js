const mongoose = require('mongoose');
const AlgorithmLocal = require('../../src/models/algorithm');
const readline = require('readline');

// MongoDB URI
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/msvStorage';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// Minimal schema to fetch algorithms
const algorithmSchema = new mongoose.Schema({
  name: String,
  algorithmCode: String,
  description: String,
  indicators: [mongoose.Schema.Types.Mixed],
  entry: mongoose.Schema.Types.Mixed,
  exit: mongoose.Schema.Types.Mixed,
  riskConfig: mongoose.Schema.Types.Mixed,
  gridConfig: mongoose.Schema.Types.Mixed,
  isActive: Boolean,
}, { collection: 'algorithms' });

async function connectDb() {
  if (mongoose.connection.readyState === 1) return;
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);
}

async function disconnectDb() {
  await mongoose.disconnect();
}

async function fetchFromMongo() {
  await connectDb();
  const AlgorithmMongo = mongoose.models.Algorithm || mongoose.model('Algorithm', algorithmSchema);
  
  const codes = await ask('? Enter algorithm codes to fetch (comma-separated, or "all"): ');
  
  let query = {};
  if (codes && codes.toLowerCase() !== 'all') {
    query = { algorithmCode: { $in: codes.split(',').map(c => c.trim()) } };
  }
  
  const docs = await AlgorithmMongo.find(query).lean();
  console.log(`\n📦 Found ${docs.length} algorithms in MongoDB.`);
  
  for (const doc of docs) {
    console.log(`Syncing ${doc.algorithmCode}...`);
    let localDoc = AlgorithmLocal.findAlgorithm(doc.algorithmCode);
    
    const configToSync = {
      gridConfig: doc.gridConfig || {},
      riskConfig: doc.riskConfig || {},
      indicators: doc.indicators || [],
      entry: doc.entry,
      exit: doc.exit,
    };
    
    if (!localDoc) {
      AlgorithmLocal.createAlgorithm({
        algorithmCode: doc.algorithmCode,
        name: doc.name || doc.algorithmCode,
        description: doc.description || 'Imported from MongoDB',
        initialVersion: {
          tag: 'v1-mongo',
          notes: 'Initial import from MongoDB',
          ...configToSync,
        }
      });
      console.log(`  ✅ Created new local algorithm: ${doc.algorithmCode}`);
    } else {
      const nextVersion = localDoc.currentVersion + 1;
      AlgorithmLocal.addVersion(doc.algorithmCode, {
        tag: `v${nextVersion}-mongo`,
        notes: 'Synced from MongoDB',
        ...configToSync,
      });
      console.log(`  ✅ Added v${nextVersion} to ${doc.algorithmCode}`);
    }
  }
  
  await disconnectDb();
}

async function pushToMongo() {
  await connectDb();
  const AlgorithmMongo = mongoose.models.Algorithm || mongoose.model('Algorithm', algorithmSchema);
  
  const code = await ask('? Enter algorithm code to push to MongoDB: ');
  const localDoc = AlgorithmLocal.findAlgorithm(code);
  
  if (!localDoc) {
    console.error(`❌ Local algorithm '${code}' not found.`);
    await disconnectDb();
    return;
  }
  
  let targetVersionNum = localDoc.bestVersion;
  if (!targetVersionNum) {
    console.log('⚠️ No promoted version found. Will use latest version.');
    targetVersionNum = localDoc.currentVersion;
  }
  
  const ver = localDoc.versions.find(v => v.version === targetVersionNum);
  if (!ver) {
    console.error(`❌ Could not find version ${targetVersionNum} data.`);
    await disconnectDb();
    return;
  }
  
  console.log(`\n🚀 Pushing ${code} (v${targetVersionNum}) to MongoDB...`);
  
  const updateData = {
    name: localDoc.name,
    description: localDoc.description,
    indicators: ver.indicators || [],
    entry: ver.entry || { logic: 'OR', groups: [] },
    exit: ver.exit || { logic: 'OR', groups: [] },
    riskConfig: ver.riskConfig || {},
    gridConfig: ver.gridConfig || {},
  };
  
  const result = await AlgorithmMongo.findOneAndUpdate(
    { algorithmCode: code },
    { $set: updateData },
    { new: true, upsert: true }
  );
  
  console.log(`✅ Successfully pushed ${code} to MongoDB (ID: ${result._id})`);
  
  await disconnectDb();
}

module.exports = { fetchFromMongo, pushToMongo };
