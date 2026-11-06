'use strict';
/* Tasks module (M6a): tasks/tasks.md through the one parser in tasks.js. Every write goes
 * through core.vault (atomic + undo history). Each read-modify-write is synchronous inside
 * one handler, so writes from here and from legacy (same process) never interleave.
 * AIOS_TASKS_DIR (relative to the vault root) is a test hook for the demo preview only. */
const fs = require('fs');
const path = require('path');
const { parseTasks, formatTask, toggleTask, archiveDone } = require('./tasks.js');

const pad = n => String(n).padStart(2, '0');
const localDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function create(core, deps) {
  deps = deps || {};
  const now = deps.now || (() => new Date());
  const dir = process.env.AIOS_TASKS_DIR || 'tasks';
  const FILE = dir + '/tasks.md', DONE = dir + '/done.md';
  let watcher = null, debounce = null;

  const read = () => core.vault.read(FILE) || '';
  const changed = () => core.events.emit('changed', { at: now().toISOString() });

  function list() {
    const skipped = [];
    const tasks = parseTasks(read(), (line, text, why) => skipped.push({ line, text: text.trim().slice(0, 160), why }));
    return { tasks, skipped };
  }
  function add(body) {
    const line = formatTask(body);
    if (!line) return { status: 400, error: 'text required' };
    core.vault.append(FILE, line, 'tasks add');
    changed();
    const tasks = parseTasks(read());
    return { ok: true, task: tasks[tasks.length - 1] };
  }
  function toggle(body) {
    if (!body || typeof body.index !== 'number') return { status: 400, error: 'index required' };
    const r = toggleTask(read(), body.index, body.raw);
    if (r.status) return r;
    core.vault.write(FILE, r.text, 'tasks toggle');
    changed();
    return { ok: true };
  }
  function archive() {
    const r = archiveDone(read(), localDate(now()));
    if (r.archived.length) { // done.md first: a crash between the two writes loses nothing
      core.vault.append(DONE, r.archived.join('\n'), 'tasks archive');
      core.vault.write(FILE, r.text, 'tasks archive');
      changed();
    }
    return { ok: true, archived: r.archived.length };
  }

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const reply = (res, r) => (r.status ? json(res, r.status, { error: r.error }) : json(res, 200, r));
  core.route('GET', 'list', (req, res) => json(res, 200, list()));
  core.route('POST', 'add', (req, res, body) => reply(res, add(body)));
  core.route('POST', 'toggle', (req, res, body) => reply(res, toggle(body)));
  core.route('POST', 'archive', (req, res) => reply(res, archive()));

  core.commands.handle('tasks.add', async args => {
    const r = add({ text: args && args.text });
    if (r.status) throw new Error(r.error);
    return { toast: 'Task added: ' + r.task.text, say: 'Added ' + r.task.text };
  });
  core.commands.handle('tasks.archive', async () => {
    const n = archive().archived, say = 'Archived ' + n + ' done task' + (n === 1 ? '' : 's');
    return { toast: say, say };
  });

  function start() {
    try { // tasks.md is often saved by rename, so watch its folder
      watcher = fs.watch(path.join(core.root, dir), (ev, file) => {
        if (file && file !== 'tasks.md') return;
        clearTimeout(debounce);
        debounce = setTimeout(changed, 300);
      });
    } catch (e) {
      // shortcut: no watch until restart when tasks/ is created by the first add; own writes still emit changed, external edits need a restart — upgrade if fresh clones complain
      core.log('cannot watch ' + dir + '/: ' + e.message);
    }
  }
  function stop() {
    clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  }

  return { list, add, toggle, archive, start, stop };
}

let live = null;
module.exports = {
  create,
  init(core) { live = create(core); live.start(); },
  stop() { if (live) live.stop(); live = null; }
};
