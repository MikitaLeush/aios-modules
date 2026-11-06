'use strict';
const { createRegistry } = require('../../../core/commands.js');

module.exports = async function (ok) {
  const r = createRegistry();
  r.register('modes', require('../../modes/commands.json'));
  r.register('status', require('../commands.json'));
  r.slot('modes', 'mode', () => ['focus', 'game', 'relax']);
  r.slot('modes', 'app', () => ['spotify', 'discord', 'steam', { value: 'obsidian', aliases: ['notes'] }]);
  const id = t => (r.match(t) || {}).id;
  ok('status phrases match status, modes phrases still match modes (Review Focus 5)',
    id("what's due") === 'status.due' && id('weather') === 'status.weather' && id("what's the weather") === 'status.weather' &&
    id("what's next") === 'status.next' && id('show week') === 'status.week' && id('show today') === 'status.today' &&
    id('game mode') === 'modes.switch' && id('open notes') === 'modes.open' && id('volume 40') === 'modes.volume',
    JSON.stringify(["what's due", 'weather', "what's next", 'show week', 'game mode', 'open notes'].map(t => [t, r.match(t)])));
};
