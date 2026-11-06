'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const term = require('../term.js');

const FAKE = path.join(__dirname, 'fake-claude.js');
const Q = 'what is two plus two';

function fakeCore(root, cfg) {
  const routes = {}, handlers = {}, seen = [];
  return {
    routes, handlers, seen, root,
    config: () => cfg || {}, setConfig() {}, notify() {}, log() {},
    events: { emit: (n, d) => seen.push([n, d]), on() {} },
    commands: { handle: (id, fn) => { handlers[id] = fn; }, slot() {} },
    route(m, s, fn) { routes[m + ' ' + s] = fn; }
  };
}
async function call(core, key, body, url, from) {
  let out = '', code = 0;
  await core.routes[key]({ url: url || '/', socket: { remoteAddress: from || '127.0.0.1' } }, { writeHead(c) { code = c; }, end(b) { out = b; } }, body);
  return { code, body: JSON.parse(out) };
}
// streaming route: collect NDJSON lines until the handler ends the response
function stream(core, key, body) {
  return new Promise((resolve) => {
    let code = 0, text = '';
    const res = { writeHead(c) { code = c; }, write(s) { text += s; }, end() { resolve({ code, lines: text.split('\n').filter(Boolean).map(l => JSON.parse(l)) }); }, on() {} };
    core.routes[key]({ url: '/', socket: { remoteAddress: '::1' } }, res, body);
  });
}

module.exports = async function (ok) {
  const { create } = require('../server.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-term-'));
  let mode = 'ok';
  const spawn = (args, o) => cp.spawn(process.execPath, [FAKE, ...args], Object.assign({}, o, { env: Object.assign({}, process.env, { FAKE_CLAUDE_MODE: mode }) }));
  let found = true;
  const core = fakeCore(root, {});
  const live = create(core, { spawn, resolve: () => ({ ok: found }), hint: () => 'install claude' });

  const routes = ['GET info', 'GET claude', 'POST run', 'POST input', 'POST kill', 'POST launch', 'POST chat', 'GET chat', 'POST chat/new', 'POST chat/stop'];
  ok('all ten routes are registered', routes.every(k => typeof core.routes[k] === 'function'), Object.keys(core.routes).join());
  const bad = [];
  for (const k of routes) {
    const r = await call(core, k, { cmd: 'echo x', id: 'x', text: Q }, undefined, '192.168.1.5');
    if (r.code !== 403 || r.body.error !== 'local only') bad.push(k);
  }
  ok('every route refuses a LAN caller', bad.length === 0, bad.join());
  const v6 = await call(core, 'GET info', null, '/', '::ffff:192.168.1.5');
  ok('an IPv4-mapped LAN address is refused too', v6.code === 403);

  let r = await stream(core, 'POST run', { cmd: 'echo aios-term-test' });
  const kinds = r.lines.map(l => l.t);
  ok('run streams start/output/exit', r.code === 200 && kinds[0] === 'start' && kinds[kinds.length - 1] === 'exit' &&
    r.lines.some(l => l.t === 'o' && /aios-term-test/.test(l.d)) && r.lines[r.lines.length - 1].code === 0, JSON.stringify(r.lines).slice(0, 300));
  r = await call(core, 'POST run', { cmd: '   ' });
  const r2 = await call(core, 'POST run', { cmd: 'x'.repeat(32769) });
  ok('run rejects empty and too long', r.code === 400 && r.body.error === 'cmd required' && r2.code === 400 && r2.body.error === 'command too long', JSON.stringify([r, r2]));
  r = await call(core, 'POST kill', {});
  ok('kill without an id is 400', r.code === 400 && r.body.error === 'id required');

  r = await call(core, 'POST chat', { text: '   ' });
  ok('chat without text is 400', r.code === 400 && r.body.error === 'message required', JSON.stringify(r));
  r = await call(core, 'POST chat', { text: Q });
  ok('chat returns a turn id', r.code === 200 && r.body.turn === 't1', JSON.stringify(r));
  const id = r.body.turn;
  let rd;
  for (let i = 0; i < 100; i++) {
    rd = await call(core, 'GET chat', null, '/api/m/terminal/chat?turn=' + id);
    if (rd.body.state !== 'running') break;
    await new Promise(res => setTimeout(res, 50));
  }
  ok('chat → read → done with the answer in items', rd.code === 200 && rd.body.state === 'done' &&
    rd.body.items.some(i => i.k === 'text' && /Four/.test(i.d)), JSON.stringify(rd.body).slice(0, 300));
  const part = await call(core, 'GET chat', null, '/api/m/terminal/chat?turn=' + id + '&from=2');
  ok('read honours from=', part.body.items.length === rd.body.n - 2, JSON.stringify(part.body));
  const gone = await call(core, 'GET chat', null, '/api/m/terminal/chat?turn=t99');
  ok('unknown turn is 404', gone.code === 404 && gone.body.error === 'no such turn');
  const list = await call(core, 'GET chat', null, '/api/m/terminal/chat');
  ok('no turn lists the turns', list.body.busy === false && list.body.turns.length === 1 && list.body.turns[0].id === id, JSON.stringify(list.body));

  const evs = core.seen.filter(e => e[0] === 'chat');
  ok('events carry state only, no text', evs.length > 0 && evs[evs.length - 1][1].state === 'done' &&
    evs.every(e => Object.keys(e[1]).sort().join() === 'n,source,state,turn') &&
    !/two plus two/i.test(JSON.stringify(core.seen)), JSON.stringify(core.seen).slice(0, 300));
  ok('events are throttled (a fast turn sends fewer than its raw changes)', evs.length <= 4, String(evs.length));

  // terminal.claude handler
  const h = core.handlers['terminal.claude'];
  ok('terminal.claude is registered', typeof h === 'function');
  let said = await h({ text: 'new chat' });
  ok('terminal.claude: "new chat" resets', said.say === 'New Claude chat.', JSON.stringify(said));
  said = await h({ text: 'New Conversation' });
  ok('terminal.claude: "new conversation" resets too', said.say === 'New Claude chat.');
  let finished;
  const done = new Promise(res => { finished = res; });
  said = await h({ text: Q }, { source: 'viero', onDone: (d) => finished(d) });
  const d = await done;
  const last = (await call(core, 'GET chat')).body.turns.pop();
  ok('terminal.claude: asks, source voice for viero, onDone gets the answer', said.toast === 'Asked Claude — the answer is in the Terminal' &&
    last.source === 'voice' && d.ok === true && d.answer === 'Four. Two plus two is four.', JSON.stringify([said, last, d]));
  mode = 'slow';
  await h({ text: Q }, { source: 'palette' });
  const busy = (await call(core, 'GET chat')).body;
  let err = null;
  try { await h({ text: Q }, {}); } catch (e) { err = e; }
  ok('terminal.claude: busy throws', busy.busy === true && err && err.message === 'Claude is still answering — wait, or press Ctrl+C', err && err.message);
  r = await call(core, 'POST chat/stop', {});
  ok('chat/stop stops the turn', r.body.ok === true && (await call(core, 'GET chat')).body.busy === false);
  r = await call(core, 'POST chat/new', {});
  ok('chat/new answers ok', r.body.ok === true);
  mode = 'ok';

  // claude missing: the shell still works
  found = false;
  r = await call(core, 'GET info');
  ok('info reports claude not found (info part)', r.code === 200 && typeof r.body.claude === 'object' && 'found' in r.body.claude && r.body.shell, JSON.stringify(r.body).slice(0, 200));
  r = await stream(core, 'POST run', { cmd: 'echo aios-term-test' });
  ok('info reports claude not found, run still works (run part)', r.lines.some(l => l.t === 'o' && /aios-term-test/.test(l.d)));
  r = await call(core, 'POST chat', { text: Q });
  const rr = await call(core, 'GET chat', null, '/api/m/terminal/chat?turn=' + r.body.turn);
  ok('chat with no claude ends in an error item with the hint', rr.body.state === 'error' && rr.body.items[0].d === 'install claude', JSON.stringify(rr.body));
  found = true;

  // AIOS_TERMINAL_FAKE_CLAUDE (demo/test): resolve is ok and spawn runs the fake, with no deps injected
  process.env.AIOS_TERMINAL_FAKE_CLAUDE = path.relative(root, FAKE);
  const core2 = fakeCore(root, {});
  const live2 = create(core2);
  delete process.env.AIOS_TERMINAL_FAKE_CLAUDE;
  r = await call(core2, 'GET info');
  const cl = await call(core2, 'GET claude');
  ok('fake env: info and claude report the CLI found', r.body.claude.found === true && r.body.claude.source === 'fake' && cl.body.found === true, JSON.stringify([r.body.claude, cl.body]));
  r = await call(core2, 'POST chat', { text: Q });
  for (let i = 0; i < 100; i++) {
    rd = await call(core2, 'GET chat', null, '/api/m/terminal/chat?turn=' + r.body.turn);
    if (rd.body.state !== 'running') break;
    await new Promise(res => setTimeout(res, 50));
  }
  ok('fake env: a chat turn runs the fake CLI', rd.body.state === 'done' && rd.body.items.some(i => i.k === 'text' && /Four/.test(i.d)), JSON.stringify(rd.body).slice(0, 300));
  live2.stop();

  live.stop();
  term.init({ root: process.cwd() });   // term is a process-wide singleton; hand it back
  fs.rmSync(root, { recursive: true, force: true });
};
