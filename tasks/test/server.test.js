'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../../core/vault.js');

const WHY = 'not a task line — expected "- [ ] text" or "- [x] text"';

function fakeCore(root) {
  const routes = {}, handlers = {}, seen = [];
  return {
    root, routes, handlers, seen, vault: createVault(root, { history: false }),
    config: () => ({}), setConfig() {}, notify() {}, log() {},
    events: { emit: (n, d) => seen.push([n, d]), on() {} },
    commands: { handle: (id, fn) => { handlers[id] = fn; }, slot() {} },
    route(m, s, fn) { routes[m + ' ' + s] = fn; }
  };
}
async function call(core, key, body) {
  let out = '', code = 0;
  await core.routes[key]({}, { writeHead(c) { code = c; }, end(b) { out = b; } }, body);
  return { code, body: JSON.parse(out) };
}

module.exports = async function (ok) {
  const { create } = require('../server.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-tasks-'));
  const file = path.join(root, 'tasks', 'tasks.md');
  const core = fakeCore(root);
  create(core, { now: () => new Date(2026, 9, 28, 9, 0) });
  const changes = () => core.seen.filter(e => e[0] === 'changed').length;

  let r = await call(core, 'GET list');
  ok('missing tasks/: empty list', r.code === 200 && JSON.stringify(r.body) === '{"tasks":[],"skipped":[]}', JSON.stringify(r.body));
  r = await call(core, 'POST add', { text: 'Buy milk' });
  ok('missing tasks/: add creates the file', r.code === 200 && fs.readFileSync(file, 'utf8') === '- [ ] Buy milk\n', JSON.stringify(r.body));

  r = await call(core, 'POST add', { text: 'Call the dentist', priority: 2, due: '2026-11-02', tags: ['health'] });
  ok('add with markers formats the line', r.body.task && r.body.task.i === 1 &&
    fs.readFileSync(file, 'utf8').split('\n')[1] === '- [ ] Call the dentist !p2 @2026-11-02 #health', JSON.stringify(r.body));

  let before = fs.readFileSync(file, 'utf8');
  r = await call(core, 'POST add', { text: '   ' });
  ok("add without text is 400 'text required'", r.code === 400 && r.body.error === 'text required' && fs.readFileSync(file, 'utf8') === before);

  fs.appendFileSync(file, '- [] broken\n');
  r = await call(core, 'GET list');
  ok('list reports skipped lines', JSON.stringify(r.body.skipped) === JSON.stringify([{ line: 3, text: '- [] broken', why: WHY }]), JSON.stringify(r.body.skipped));

  const oldRaw = r.body.tasks[0].raw;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Buy milk', 'Buy oat milk'));
  before = fs.readFileSync(file, 'utf8');
  r = await call(core, 'POST toggle', { index: 0, raw: oldRaw });
  ok('file edited between list and toggle → 409', r.code === 409 && fs.readFileSync(file, 'utf8') === before, JSON.stringify(r));

  r = await call(core, 'POST toggle', { index: 0, raw: '- [ ] Buy oat milk' });
  ok('toggle ok flips the line', r.code === 200 && fs.readFileSync(file, 'utf8').startsWith('- [x] Buy oat milk\n'));

  r = await call(core, 'POST toggle', { index: '0' });
  ok("toggle without a number index is 400 'index required'", r.code === 400 && r.body.error === 'index required');
  r = await call(core, 'POST toggle', { index: 42 });
  ok('toggle out of range is 404', r.code === 404);

  const n = changes();
  r = await call(core, 'POST archive', {});
  ok("archive moves done tasks to done.md with today's date", r.body.archived === 1 &&
    fs.readFileSync(path.join(root, 'tasks', 'done.md'), 'utf8') === '- [x] Buy oat milk (archived 2026-10-28)\n' &&
    !/Buy oat milk/.test(fs.readFileSync(file, 'utf8')), JSON.stringify(r.body));
  ok('each write emits tasks changed (adds, toggle, archive — not the refusals)', n === 3 && changes() === 4, n + ' / ' + changes());

  const said = await core.handlers['tasks.add']({ text: 'call mom' });
  ok('voice add: tasks.add handler', /\n- \[ \] call mom\n$/.test(fs.readFileSync(file, 'utf8')) && said.say === 'Added call mom', JSON.stringify(said));
  fs.appendFileSync(file, '- [x] done one\n- [x] done two\n');
  const arch = await core.handlers['tasks.archive']({});
  ok('tasks.archive says how many', arch.say === 'Archived 2 done tasks', JSON.stringify(arch));
};
