'use strict';
const path = require('path');
const { createRegistry } = require('../../../core/commands.js');

const MODULES = path.join(__dirname, '..', '..');

module.exports = async function (ok) {
  const reg = createRegistry();
  for (const id of ['modes', 'status', 'tasks']) reg.register(id, require(path.join(MODULES, id, 'commands.json')));
  reg.slot('modes', 'app', () => ['steam']);
  reg.slot('modes', 'mode', () => ['focus', 'game']);
  const m = t => reg.match(t) || {};

  const add = m('add task call mom');
  const steam = m('add task open steam');
  ok("tasks phrases don't steal modes or status phrases",
    add.id === 'tasks.add' && add.args.text === 'call mom' && add.sure &&
    steam.id === 'tasks.add' && steam.args.text === 'open steam' &&
    m('remind me to switch to focus mode').id === 'tasks.add' &&
    m('open steam').id === 'modes.open' &&
    m("what's due").id === 'status.due' &&
    m('archive tasks').id === 'tasks.archive',
    JSON.stringify([add, steam, m('remind me to switch to focus mode'), m('open steam'), m("what's due"), m('archive tasks')].map(x => x.id)));
};
