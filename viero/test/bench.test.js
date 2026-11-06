'use strict';
const { pct, sameIntent } = require('../bench.js');

module.exports = async function (ok) {
  ok('p50 / p95 of a small list', pct([5, 1, 3], 0.5) === 3 && pct([5, 1, 3], 0.95) === 5 && pct([], 0.5) === null);
  const want = { id: 'modes.open', args: { app: 'spotify' } };
  ok('same command + args = right intent', sameIntent({ matched: true, command: 'modes.open', args: { app: 'spotify' } }, want) === true);
  ok('a different app is a miss', sameIntent({ matched: true, command: 'modes.open', args: { app: 'steam' } }, want) === false);
  ok('a did-you-mean is not a hit', sameIntent({ matched: false, suggestion: { text: 'open spotify' } }, want) === false);
  ok('no expected match → never a hit', sameIntent({ matched: true, command: 'x', args: {} }, null) === false);
};
