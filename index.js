const dataManager = require('./src/dataManager');
const server = require('./src/server');

module.exports = {
  dataManager,
  server,
  // Helper shortcuts
  loadCandles: dataManager.loadCandles,
  appendCandles: dataManager.appendCandles,
  getSummary: dataManager.getSummary,
  filterCandles: dataManager.filterCandles
};

// If run directly: start the server
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`AlgoTester Server running on http://localhost:${PORT}`);
    console.log(`Loaded dataset: CEINSYS_INE016Q01014_1minute.json`);
  });
}
