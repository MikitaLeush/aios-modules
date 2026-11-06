#!/usr/bin/env node
/* AIOS — Claude Code CLI discovery. Zero dependencies.
 *
 * Why this file exists: the Claude desktop app installs the CLI into a *versioned*
 * folder that is NOT on PATH — on Windows `%APPDATA%\Claude\claude-code\<version>\claude.exe`.
 * The old code just spawned `claude`, got ENOENT, and the dashboard's chat module
 * failed with a 503 every single time. Hardcoding the versioned path is no better:
 * the next CLI update changes the folder name and it breaks again.
 *
 * So: search PATH, then every known install location, newest version first, and
 * re-check whenever the cached path stops existing (which is exactly what an update
 * looks like). Nothing here is machine-specific; it works on any computer the vault
 * is carried to, which is Rule #1 of this vault.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const HOME = os.homedir();

/* ---------- helpers ---------- */

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}
// Newest first. Version folders are "2.1.237"-shaped; compare numerically so
// 2.1.9 does not sort above 2.1.237 the way a string compare would.
function verKey(name) {
  return String(name).split(/[.\-+]/).map(x => parseInt(x, 10));
}
function cmpVerDesc(a, b) {
  const x = verKey(a), y = verKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = isFinite(x[i]) ? x[i] : 0, yi = isFinite(y[i]) ? y[i] : 0;
    if (yi !== xi) return yi - xi;
  }
  return 0;
}
// dir/<version>/<exe> — pick the highest version that actually has the binary
function newestVersioned(dir, exeNames) {
  if (!isDir(dir)) return '';
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return ''; }
  names = names.filter(n => /^\d+\./.test(n)).sort(cmpVerDesc);
  for (const n of names) {
    for (const exe of exeNames) {
      const p = path.join(dir, n, exe);
      if (isFile(p)) return p;
    }
  }
  return '';
}
function fromPathEnv(exeNames) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const exe of exeNames) {
      const p = path.join(d.replace(/^"|"$/g, ''), exe);
      if (isFile(p)) return p;
    }
  }
  return '';
}
function first(paths) {
  for (const p of paths) if (isFile(p)) return p;
  return '';
}
/* MSIX write-redirection. The Claude desktop app is a packaged (Store/MSIX) app, so when it
 * writes to %APPDATA%\Claude the bytes actually land in its package container at
 *   %LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\Claude\…
 * A process running *inside* the container sees the file at the plain %APPDATA% path — which
 * is why looking there works when AIOS is started from the Claude app, and fails when it is
 * started from START-AIOS.bat or any normal shell. The container path is the physical one and
 * is visible from everywhere, so search it too. The family suffix differs per install, hence
 * the scan rather than a literal. */
function fromMsixPackages(exeNames, sub) {
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const pkgRoot = path.join(local, 'Packages');
  if (!isDir(pkgRoot)) return '';
  let fams;
  try { fams = fs.readdirSync(pkgRoot); } catch (e) { return ''; }
  fams = fams.filter(n => /claude/i.test(n));
  for (const fam of fams) {
    for (const cache of ['Roaming', 'Local']) {
      const hit = newestVersioned(path.join(pkgRoot, fam, 'LocalCache', cache, 'Claude', sub), exeNames);
      if (hit) return hit;
    }
  }
  return '';
}

/* ---------- candidate locations ---------- */

// Ordered best-first. Each entry: () => absolute path or ''.
function candidates() {
  const exe = WIN ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
  const list = [];
  const add = (source, fn) => list.push({ source: source, fn: fn });

  add('PATH', () => fromPathEnv(exe));

  if (WIN) {
    const appdata = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    // The MSIX container path goes FIRST, ahead of the %APPDATA% view of the same install.
    // Both resolve for a process inside the Claude app's container, but only this one
    // resolves outside it — and AIOS hands this path to things that run outside: the
    // terminal window opened by /api/launch-terminal, and any shell the user starts later.
    // Preferring the %APPDATA% view made "Open OS terminal" launch a cmd window that
    // immediately said "The system cannot find the path specified".
    add('Claude app (packaged)', () => fromMsixPackages(exe, 'claude-code'));
    add('Claude app (packaged)', () => fromMsixPackages(exe, 'claude-code-vm'));
    // plain (non-packaged) desktop-app install
    add('Claude app', () => newestVersioned(path.join(appdata, 'Claude', 'claude-code'), exe));
    add('Claude app', () => newestVersioned(path.join(local, 'Claude', 'claude-code'), exe));
    add('Claude app', () => newestVersioned(path.join(appdata, 'Claude', 'claude-code-vm'), exe));
    // native installer / npm global
    add('native install', () => first([path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(HOME, '.local', 'bin', 'claude')]));
    add('local install', () => first([path.join(HOME, '.claude', 'local', 'claude.exe'), path.join(HOME, '.claude', 'local', 'claude.cmd')]));
    add('npm global', () => first([path.join(appdata, 'npm', 'claude.cmd'), path.join(appdata, 'npm', 'claude.exe')]));
    add('program files', () => first([
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Claude', 'claude.exe'),
      path.join(local, 'Programs', 'Claude', 'claude.exe')
    ]));
  } else {
    const mac = process.platform === 'darwin';
    add('native install', () => first([path.join(HOME, '.local', 'bin', 'claude')]));
    add('local install', () => first([path.join(HOME, '.claude', 'local', 'claude')]));
    if (mac) {
      add('Claude app', () => newestVersioned(path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code'), exe));
      add('homebrew', () => first(['/opt/homebrew/bin/claude', '/usr/local/bin/claude']));
    } else {
      add('Claude app', () => newestVersioned(path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Claude', 'claude-code'), exe));
      add('system', () => first(['/usr/local/bin/claude', '/usr/bin/claude', '/snap/bin/claude']));
    }
    add('npm global', () => first([
      path.join(HOME, '.npm-global', 'bin', 'claude'),
      path.join(HOME, 'node_modules', '.bin', 'claude'),
      '/usr/local/lib/node_modules/.bin/claude'
    ]));
  }
  return list;
}

/* ---------- resolution (cached, self-healing) ---------- */

let cache = null;          // { ok, path, source, version, tried }
let configured = '';       // machine.json claudeBin, set by init()

function init(claudeBin) {
  const next = String(claudeBin || '');
  if (next !== configured) { configured = next; cache = null; }
}

// force=true re-scans. Otherwise the cache is reused only while the file is still
// there — a CLI update deletes the old versioned folder, and that invalidates us.
function resolve(force) {
  if (!force && cache && cache.ok && isFile(cache.path)) return cache;
  const tried = [];
  // 1. explicit override from system/machine.json — but never trust it blindly.
  if (configured) {
    if (isFile(configured)) return (cache = { ok: true, path: configured, source: 'machine.json', tried: tried });
    // A bare command name ("claude") is legitimate too: look it up on PATH.
    if (!path.isAbsolute(configured)) {
      const names = WIN ? [configured, configured + '.exe', configured + '.cmd'] : [configured];
      const onPath = fromPathEnv(names);
      if (onPath) return (cache = { ok: true, path: onPath, source: 'machine.json + PATH', tried: tried });
    }
    tried.push(configured + ' (machine.json claudeBin — not found)');
  }
  // 2. everything we know about, best-first.
  const cs = candidates();
  for (let i = 0; i < cs.length; i++) {
    let hit = '';
    try { hit = cs[i].fn(); } catch (e) { hit = ''; }
    if (hit) return (cache = { ok: true, path: hit, source: cs[i].source, tried: tried });
    tried.push(cs[i].source);
  }
  cache = { ok: false, path: '', source: '', tried: tried };
  return cache;
}

function binDir() {
  const r = resolve();
  return r.ok ? path.dirname(r.path) : '';
}

/* ---------- spawning ---------- */

// Windows .cmd/.bat cannot be spawned directly by Node >=20, and spawning them with
// `shell:true` string-joins argv — which corrupts any path containing a space. Use the
// documented cmd.exe + verbatim-arguments form instead, and quote every argument once.
/* A Claude Code session marks its child processes with CLAUDE_CODE_CHILD_SESSION and a few
 * session-identity/IPC variables. Those are inherited by everything below, so if AIOS is
 * started from inside a Claude session, every terminal it opens is treated as part of that
 * session: transcript saving is off, and the new session shares ids and a messaging socket
 * with an unrelated one. A terminal opened from the dashboard is its own session, so strip
 * them. Auth is not in here — it comes from the credentials store — so this is safe.  */
const INHERITED_SESSION_VARS = [
  'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDECODE'
];
function cleanEnv(base) {
  const env = Object.assign({}, base || process.env);
  for (const k of INHERITED_SESSION_VARS) delete env[k];
  return env;
}

function winQuote(s) {
  s = String(s);
  if (s === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1') + '"';
}
function spawnClaude(args, opts) {
  const r = resolve();
  if (!r.ok) {
    const err = new Error('claude not found');
    err.code = 'ENOENT';
    throw err;
  }
  args = Array.isArray(args) ? args.map(String) : [];
  const o = Object.assign({ windowsHide: true }, opts || {});
  o.env = cleanEnv(o.env);
  if (WIN && /\.(cmd|bat)$/i.test(r.path)) {
    const line = [r.path].concat(args).map(winQuote).join(' ');
    return spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', line],
      Object.assign({}, o, { windowsVerbatimArguments: true }));
  }
  return spawn(r.path, args, o); // .exe / POSIX binary — no shell, no quoting worries
}

// `claude --version` -> "2.1.237 (Claude Code)". Cached on the resolution record.
function probeVersion(cb) {
  const r = resolve();
  if (!r.ok) return cb(null);
  if (r.version) return cb(r.version);
  let child;
  try { child = spawnClaude(['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return cb(null); }
  let out = '', done = false;
  const finish = (v) => { if (done) return; done = true; clearTimeout(t); cb(v); };
  const t = setTimeout(() => { try { child.kill(); } catch (e) {} finish(null); }, 12000);
  child.stdout.on('data', c => { out += c.toString(); if (out.length > 400) out = out.slice(0, 400); });
  child.on('error', () => finish(null));
  child.on('close', () => {
    const m = out.match(/\d+\.\d+\.\d+/);
    if (m && cache) cache.version = m[0];
    finish(m ? m[0] : null);
  });
}

// Everything the dashboard needs to explain itself when the CLI is missing.
function status() {
  const r = resolve();
  return {
    found: !!r.ok,
    path: r.path || '',
    source: r.source || '',
    version: r.version || '',
    hint: r.ok ? '' :
      'Claude Code CLI not found. Install it, or set "claudeBin" to the full path of the ' +
      'executable in system/machine.json. Looked in: ' + (r.tried || []).join(', ')
  };
}

module.exports = {
  init: init, resolve: resolve, binDir: binDir, spawnClaude: spawnClaude,
  probeVersion: probeVersion, status: status,
  cleanEnv: cleanEnv,
  _cmpVerDesc: cmpVerDesc, _winQuote: winQuote, _newestVersioned: newestVersioned,
  _fromMsixPackages: fromMsixPackages, _sessionVars: INHERITED_SESSION_VARS
};
