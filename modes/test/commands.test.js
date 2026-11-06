'use strict';
const { createRegistry } = require('../../../core/commands.js');

module.exports = async function (ok) {
  const reg = createRegistry();
  reg.register('modes', require('../commands.json'));
  reg.slot('modes', 'mode', () => ['game']);
  reg.slot('modes', 'app', () => []);
  const m = reg.match('switch to game mode');
  ok('"switch to game mode" switches to game', !!m && m.id === 'modes.switch' && m.args.mode === 'game', JSON.stringify(m));
};
