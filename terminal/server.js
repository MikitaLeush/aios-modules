'use strict';
/* Terminal module (M6c): a shell rooted at the vault, and one Claude conversation shared by
 * typing and voice. Every route is loopback-only. Routes are ported from the legacy server
 * (/api/term/*, /api/launch-terminal, /api/chat/check) with the same limits.
 *
 * `term` is a process-wide singleton shared with the legacy module (same process when both
 * are on): term.init sets root/extraPath/shell for both, and stop() -> term.killAll() also
 * ends any run legacy started. Both run in the vault root, so we accept that. */
const path = require('path');
const { execFile, spawn: cpSpawn } = require('child_process');
const term = require('./term.js');
const claudeBin = require('./claude-bin.js');
const rules = require('./rules.js');
const { createChat } = require('./chat.js');

const LOCAL = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const GAP = 250;                                   // events per turn: at most 4 a second
const OS_UNSAFE = /[&|^<>"%!\r\n]/;                // cmd.exe re-parses its own line

function create(core, deps) {
  deps = deps || {};
  const cfg = () => core.config() || {};
  const refreshPath = () => term.init({ extraPath: claudeBin.binDir() });   // a CLI installed after start is found

  // Test/demo only (R2): AIOS_TERMINAL_FAKE_CLAUDE = vault-relative path of a stand-in CLI. Read once, here.
  const fake = process.env.AIOS_TERMINAL_FAKE_CLAUDE ? path.resolve(core.root, process.env.AIOS_TERMINAL_FAKE_CLAUDE) : '';
  const status = () => fake ? { found: true, path: fake, source: 'fake', version: 'fake', hint: '' } : claudeBin.status();

  const c0 = cfg();
  term.init({ root: core.root, extraPath: claudeBin.binDir(), shell: c0.shell });
  if (c0.claudeBin) claudeBin.init(c0.claudeBin);

  // chat events: state only, never text; throttled per turn, the final state always goes out
  const gate = new Map();                            // turn -> { at, timer, last }
  const send = (c) => core.events.emit('chat', { turn: c.turn, state: c.state, n: c.n, source: c.source });
  function onChange(c) {
    let g = gate.get(c.turn);
    if (!g) gate.set(c.turn, g = { at: 0, timer: null, last: null });
    if (c.state !== 'running') { clearTimeout(g.timer); gate.delete(c.turn); return send(c); }
    g.last = c;
    const wait = g.at + GAP - Date.now();
    if (wait <= 0) { clearTimeout(g.timer); g.timer = null; g.at = Date.now(); return send(c); }
    if (!g.timer) g.timer = setTimeout(() => { g.timer = null; g.at = Date.now(); send(g.last); }, wait);
  }

  const chat = createChat({
    spawn: deps.spawn || (fake ? (args, o) => cpSpawn(process.execPath, [fake, ...args], Object.assign({ windowsHide: true }, o)) : (args, o) => { refreshPath(); return claudeBin.spawnClaude(args, o); }),
    resolve: deps.resolve || (fake ? () => ({ ok: true }) : () => claudeBin.resolve()),
    hint: deps.hint || (() => status().hint),
    args: () => { const c = cfg(); return rules.claudeArgs({ root: core.root, flags: [...(c.model ? ['--model', c.model] : []), ...(c.flags || [])] }); },
    cwd: (want) => term.safeCwd(want),
    killTree: term.killTree,
    onChange,
  });

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const route = (method, sub, fn) => core.route(method, sub, (req, res, body) => {
    if (!LOCAL.includes(req.socket && req.socket.remoteAddress)) return json(res, 403, { error: 'local only' });
    return fn(req, res, body || {});
  });
  const param = (req, k) => new URL(req.url, 'http://x').searchParams.get(k);

  route('GET', 'info', (req, res) => json(res, 200, Object.assign({}, term.info(), { claude: status() })));

  route('GET', 'claude', (req, res) => {
    if (fake) return json(res, 200, status());
    claudeBin.resolve(param(req, 'rescan') === '1');
    refreshPath();
    claudeBin.probeVersion(() => json(res, 200, status()));
  });

  route('POST', 'run', (req, res, d) => {
    const cmd = String(d.cmd || '');
    if (!cmd.trim()) return json(res, 400, { error: 'cmd required' });
    if (cmd.length > 32768) return json(res, 400, { error: 'command too long' });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
    let closed = false;
    const out = (o) => { if (!closed) { try { res.write(JSON.stringify(o) + '\n'); } catch (e) {} } };
    const runId = term.run({ cmd, cwd: d.cwd, timeoutMs: d.timeoutMs }, {
      start: (s) => out({ t: 'start', id: s.id, cwd: s.cwd, shell: s.shell }),
      out: (s) => out({ t: 'o', d: s }),
      err: (s) => out({ t: 'e', d: s }),
      exit: (x) => { out({ t: 'exit', code: x.code, cwd: x.cwd, ms: x.ms, killed: x.killed || false, error: x.error || '' }); closed = true; try { res.end(); } catch (e) {} }
    });
    // tab closed mid-command: do not orphan the process
    res.on('close', () => { if (!closed) { closed = true; term.kill(runId); } });
  });

  route('POST', 'input', (req, res, d) => {
    if (!d.id) return json(res, 400, { error: 'id required' });
    if (d.eof) return json(res, 200, { ok: term.endInput(String(d.id)) });
    return json(res, 200, { ok: term.write(String(d.id), String(d.data == null ? '' : d.data)) });
  });
  route('POST', 'kill', (req, res, d) => {
    if (!d.id) return json(res, 400, { error: 'id required' });
    return json(res, 200, { ok: term.kill(String(d.id)) });
  });

  // The escape hatch for full-screen programs: a real OS terminal at the vault root running Claude Code.
  route('POST', 'launch', (req, res) => {
    const ROOT = core.root;
    const r = claudeBin.resolve();
    const bin = r.ok ? r.path : 'claude';
    const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
    if (process.platform === 'win32') {
      if (OS_UNSAFE.test(ROOT) || OS_UNSAFE.test(bin)) return json(res, 400, { error: 'vault or CLI path contains characters the Windows shell cannot handle' });
      const w = (s) => '"' + s + '"';
      const cs = process.env.COMSPEC || 'cmd.exe';
      // cleanEnv: the new window is a session of its own, not a child of the session that started AIOS
      const verbatim = { windowsVerbatimArguments: true, windowsHide: true, env: claudeBin.cleanEnv() };
      execFile(cs, ['/d', '/s', '/c', 'wt -d ' + w(ROOT) + ' cmd /k ' + w(bin)], verbatim, (e) => {
        if (e) execFile(cs, ['/d', '/s', '/c', 'start "Claude Code" /d ' + w(ROOT) + ' cmd /k ' + w(bin)], verbatim, () => {});
      });
    } else if (process.platform === 'darwin') {
      const line = 'cd ' + q(ROOT) + ' && ' + q(bin);
      execFile('osascript', ['-e', 'tell application "Terminal" to activate', '-e', 'tell application "Terminal" to do script ' + JSON.stringify(line)], () => {});
    } else {
      const line = 'cd ' + q(ROOT) + ' && ' + q(bin) + '; exec bash';
      const opt = { env: claudeBin.cleanEnv() };
      execFile('x-terminal-emulator', ['-e', 'bash', '-lc', line], opt, (e) => {
        if (e) execFile('xterm', ['-e', 'bash', '-lc', line], opt, () => {});
      });
    }
    return json(res, 200, { ok: true, bin, found: !!r.ok });
  });

  route('POST', 'chat', (req, res, d) => {
    const r = chat.send(d.text, { source: 'typed', cwd: d.cwd });
    return r.error ? json(res, 400, { error: r.error }) : json(res, 200, { turn: r.turn });
  });
  route('GET', 'chat', (req, res) => {
    const turn = param(req, 'turn');
    if (!turn) return json(res, 200, chat.list());
    const r = chat.read(turn, Number(param(req, 'from')) || 0);
    return r ? json(res, 200, r) : json(res, 404, { error: 'no such turn' });
  });
  route('POST', 'chat/new', (req, res) => { chat.reset(); json(res, 200, { ok: true }); });
  route('POST', 'chat/stop', (req, res) => { chat.stop(); json(res, 200, { ok: true }); });

  core.commands.handle('terminal.claude', async (args, ctx) => {
    ctx = ctx || {};
    const text = String((args && args.text) || '').trim();
    if (/^new (chat|conversation)$/i.test(text)) { chat.reset(); return { say: 'New Claude chat.' }; }
    const r = chat.send(text, { source: ctx.source === 'viero' ? 'voice' : 'command', onDone: ctx.onDone });
    if (r.error) throw new Error(r.error);
    return { toast: 'Asked Claude — the answer is in the Terminal' };
  });

  function stop() {
    for (const g of gate.values()) clearTimeout(g.timer);
    gate.clear();
    chat.stop();
    term.killAll();
  }
  return { chat, stop };
}

let live = null;
module.exports = {
  create,
  init(core) { live = create(core); },
  stop() { if (live) live.stop(); live = null; }
};
