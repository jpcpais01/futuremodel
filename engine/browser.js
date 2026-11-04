// The engine as the apps load it (bundled into app/engine.js by tools/bundle.js).
'use strict';
module.exports = {
  C: require('./config'), council: require('./council'), session: require('./session'), ledger: require('./ledger'), rules: require('./rules'),
  store: require('./store'), llm: require('./llm'), net: require('./net'), github: require('./github'), prices: require('./data/prices'), indexer: require('./indexer'),
};
