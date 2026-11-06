#!/usr/bin/env node
/* AIOS — terminal engine for the in-dashboard terminal. Zero dependencies.
 *
 * There is no PTY here on purpose. node-pty is a native module, and this vault has to
 * survive being copied to another computer and run with nothing but `node` — so a
 * compiled dependency is not on the table. What we do instead: run each command line
 * as its own short-lived shell process with pipes, stream stdout/stderr back as NDJSON,
 * and carry the working directory forward between commands by having the shell write
 * its final $PWD to a temp file. That gives real `cd`, real exit codes and real
 * streaming output, without a native build step.
 *
 * What it cannot do, and the UI says so: full-screen/interactive TUI programs (vim,
 * top, and `claude` in its interactive mode) need a TTY. `claude` is handled separately
 * by the dashboard, which routes it through the streaming headless endpoint instead.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { execFile } = require('child_process');
const claudeBin = require('./claude-bin.js');

const WIN = process.platform === 'win32';
const MAX_OUTPUT = 4 * 1024 * 1024;      // per command, then we stop forwarding
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

let ROOT = process.cwd();
let extraPath = '';        // prepended to PATH inside the shell (Claude Code's folder)
let shellPref = '';        // machine.json terminalShell override

function init(opts) {
  opts = opts || {};
  if (opts.root) ROOT = opts.root;
  if (typeof opts.extraPath === 'string') extraPath = opts.extraPath;
  if (typeof opts.shell === 'string') shellPref = opts.shell.trim();
}

/* ---------- which shell ---------- */

function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function onPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = WIN ? [name + '.exe', name + '.cmd', name] : [name];
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    if (exists(p)) return p;
  }
  return '';
}

// -> { id, exe, label, ext }
function pickShell() {
  const want = (shellPref || '').toLowerCase();
  const tryIds = [];
  if (want) tryIds.push(want);
  if (WIN) tryIds.push('pwsh', 'powershell', 'cmd');
  else tryIds.push('bash', 'zsh', 'sh');

  for (const id of tryIds) {
    // an absolute path in machine.json is honoured as-is
    if (path.isAbsolute(id) || (WIN && /^[a-z]:\\/i.test(id))) {
      if (exists(shellPref)) {
        const base = path.basename(shellPref).toLowerCase();
        return shellFor(base.replace(/\.(exe|cmd)$/, ''), shellPref);
      }
      continue;
    }
    if (id === 'powershell' && WIN) {
      const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const p = onPath('powershell') || (exists(sys) ? sys : '');
      if (p) return shellFor('powershell', p);
      continue;
    }
    if (id === 'cmd' && WIN) {
      const p = process.env.COMSPEC || onPath('cmd');
      if (p && exists(p)) return shellFor('cmd', p);
      continue;
    }
    const p = onPath(id);
    if (p) return shellFor(id, p);
  }
  // last resort — something always exists
  return WIN ? shellFor('cmd', process.env.COMSPEC || 'cmd.exe') : shellFor('sh', '/bin/sh');
}
function shellFor(id, exe) {
  if (id === 'pwsh' || id === 'powershell') return { id: id, exe: exe, label: id === 'pwsh' ? 'PowerShell 7' : 'Windows PowerShell', ext: '.ps1' };
  if (id === 'cmd') return { id: 'cmd', exe: exe, label: 'Command Prompt', ext: '.bat' };
  return { id: id, exe: exe, label: id, ext: '.sh' };
}

let cachedShell = null;
function shell() {
  if (!cachedShell || !exists(cachedShell.exe)) cachedShell = pickShell();
  return cachedShell;
}

/* ---------- script generation ---------- */

function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }   // PowerShell single-quoted
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; } // POSIX single-quoted

/* How many preamble lines sit above the user's command in the generated script. Shells
 * report errors as "<script>:<line>", and without this the terminal would show the temp
 * file's path and a line number that means nothing to the person who typed the command. */
let lastPreamble = 0;   // set by buildScript(): lines emitted above the user's command
function countLines(s) { return s === '' ? 0 : s.split(/\r\n|\n/).length; }
// Rewrite "<tempfile>:12 char:1" as "command:1 char:1" in whatever the shell prints.
function makeScrubber(script, off) {
  const esc = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withLine = new RegExp(esc + ':(\\d+)', 'gi');
  const bare = new RegExp(esc, 'gi');
  return (s) => String(s)
    .replace(withLine, (m, n) => 'command:' + Math.max(1, (+n) - off))
    .replace(bare, 'command');
}

function buildScript(sh, cmd, stateFile) {
  const pathSep = WIN ? ';' : ':';
  if (sh.ext === '.ps1') {
    const pre = [
      '$ErrorActionPreference = ' + psq('Continue'),
      'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }',
      'try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }',
      'try { $PSStyle.OutputRendering = ' + psq('PlainText') + ' } catch { }',
      'Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue',
      '$env:AIOS_ROOT = ' + psq(ROOT),
      '$env:AIOS_TERMINAL = ' + psq('1'),
      extraPath ? '$env:PATH = ' + psq(extraPath) + " + '" + pathSep + "' + $env:PATH" : ''
    ].filter(Boolean).join('\r\n');
    const post = [
      '$__aiosOk = $?', '$__aiosCode = $LASTEXITCODE',
      'if ($null -eq $__aiosCode) { if ($__aiosOk) { $__aiosCode = 0 } else { $__aiosCode = 1 } }',
      'try { [IO.File]::WriteAllText(' + psq(stateFile) + ', $PWD.Path, [System.Text.Encoding]::UTF8) } catch { }',
      'exit $__aiosCode'
    ].join('\r\n');
    lastPreamble = countLines(pre);
    return pre + '\r\n' + cmd + '\r\n' + post + '\r\n';
  }
  if (sh.ext === '.bat') {
    const pre = [
      '@echo off', 'chcp 65001 >nul 2>&1',
      'set "AIOS_ROOT=' + ROOT + '"', 'set "AIOS_TERMINAL=1"',
      extraPath ? 'set "PATH=' + extraPath + ';%PATH%"' : ''
    ].filter(Boolean).join('\r\n');
    const post = ['set "__aiosCode=%ERRORLEVEL%"', '>"' + stateFile + '" cd', 'exit /b %__aiosCode%'].join('\r\n');
    lastPreamble = countLines(pre);
    return pre + '\r\n' + cmd + '\r\n' + post + '\r\n';
  }
  const pre = [
    'export AIOS_ROOT=' + shq(ROOT),
    'export AIOS_TERMINAL=1',
    extraPath ? 'export PATH=' + shq(extraPath) + ':"$PATH"' : ''
  ].filter(Boolean).join('\n');
  const post = ['__aiosCode=$?', 'printf %s "$PWD" > ' + shq(stateFile) + ' 2>/dev/null', 'exit $__aiosCode'].join('\n');
  lastPreamble = countLines(pre);
  return pre + '\n' + cmd + '\n' + post + '\n';
}

function shellArgs(sh, script) {
  if (sh.ext === '.ps1') return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (sh.ext === '.bat') return ['/d', '/s', '/c', 'call "' + script + '"'];
  return [script];
}

/* ---------- run registry ---------- */

const RUNS = new Map();  // id -> { child, script, stateFile, cwd }

function tmpBase() {
  const d = path.join(os.tmpdir(), 'aios-term');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}
function cleanup(rec) {
  for (const f of [rec.script, rec.stateFile]) {
    if (!f) continue;
    try { fs.unlink(f, () => {}); } catch (e) {}
  }
}
// Windows child.kill() only kills the shell, leaving whatever it launched running.
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (WIN && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 1500);
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} }
  }
}

/* Resolve a requested cwd. Anything unusable falls back to the vault root, so a
 * deleted folder or a stale cwd from a previous machine can never wedge the terminal. */
function safeCwd(want) {
  const c = String(want || '').trim();
  if (c) {
    try { if (fs.statSync(c).isDirectory()) return path.resolve(c); } catch (e) {}
  }
  return ROOT;
}

/**
 * Run one command line.
 *   on.start({id, cwd, shell})   on.out(str)   on.err(str)   on.exit({code, cwd, ms, killed})
 * Returns the run id.
 */
function run(opts, on) {
  const cmd = String((opts && opts.cmd) || '');
  const cwd = safeCwd(opts && opts.cwd);
  const sh = shell();
  const id = crypto.randomBytes(9).toString('hex');
  const base = path.join(tmpBase(), id);
  const script = base + sh.ext;
  const stateFile = base + '.cwd';
  const started = Date.now();

  let preamble = 0;
  try {
    // BOM so PowerShell 5.1 reads the file as UTF-8 rather than the ANSI codepage
    const body = buildScript(sh, cmd, stateFile);
    preamble = lastPreamble;
    fs.writeFileSync(script, (sh.ext === '.ps1' ? '\ufeff' : '') + body, 'utf8');
  } catch (e) {
    on.exit({ code: -1, cwd: cwd, ms: 0, error: 'could not stage command: ' + e.message });
    return id;
  }

  let child;
  try {
    child = spawn(sh.exe, shellArgs(sh, script), {
      cwd: cwd, windowsHide: true,
      // cleanEnv drops the parent Claude session's markers — otherwise a `claude` started
      // from this shell would silently join that session and save no transcript of its own
      env: Object.assign(claudeBin.cleanEnv(), { AIOS_ROOT: ROOT, AIOS_TERMINAL: '1' }),
      detached: !WIN     // own process group on POSIX so kill(-pid) takes the children too
    });
  } catch (e) {
    try { fs.unlinkSync(script); } catch (e2) {}
    on.exit({ code: -1, cwd: cwd, ms: 0, error: 'could not start ' + sh.id + ': ' + e.message });
    return id;
  }

  const rec = { child: child, script: script, stateFile: stateFile, cwd: cwd };
  RUNS.set(id, rec);
  on.start({ id: id, cwd: cwd, shell: sh.label });

  let bytes = 0, truncated = false;
  const scrub = makeScrubber(script, preamble);
  const feed = (fn) => (chunk) => {
    if (truncated) return;
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT) {
      truncated = true;
      on.err('\n[output truncated at ' + Math.round(MAX_OUTPUT / 1024 / 1024) + ' MB — run it in a real terminal for the full log]\n');
      return;
    }
    fn(scrub(chunk.toString('utf8')));
  };
  child.stdout.on('data', feed(on.out));
  child.stderr.on('data', feed(on.err));

  let killed = false;
  const timeout = Math.max(1000, (opts && +opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => { killed = 'timeout'; killTree(child); }, timeout);

  child.on('error', (e) => { on.err('\n' + (e.code === 'ENOENT' ? 'shell not found: ' + sh.exe : e.message) + '\n'); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    RUNS.delete(id);
    // the shell wrote its final directory here — that is how `cd` persists
    let next = cwd;
    try {
      const raw = fs.readFileSync(stateFile, 'utf8').replace(/^\ufeff/, '').trim();
      if (raw && fs.statSync(raw).isDirectory()) next = path.resolve(raw);
    } catch (e) {}
    cleanup(rec);
    on.exit({
      code: (code === null ? (signal ? 130 : -1) : code),
      cwd: next, ms: Date.now() - started,
      killed: killed || (signal ? 'signal' : false)
    });
  });
  return id;
}

function write(id, data) {
  const rec = RUNS.get(id);
  if (!rec || !rec.child || !rec.child.stdin || rec.child.stdin.destroyed) return false;
  try { rec.child.stdin.write(String(data)); return true; } catch (e) { return false; }
}
function endInput(id) {
  const rec = RUNS.get(id);
  if (!rec) return false;
  try { rec.child.stdin.end(); return true; } catch (e) { return false; }
}
function kill(id) {
  const rec = RUNS.get(id);
  if (!rec) return false;
  killTree(rec.child);
  return true;
}
function killAll() { for (const id of Array.from(RUNS.keys())) kill(id); }
function info() {
  const sh = shell();
  return { root: ROOT, shell: sh.id, shellLabel: sh.label, shellPath: sh.exe, platform: process.platform, running: RUNS.size };
}

module.exports = {
  init: init, run: run, write: write, endInput: endInput, kill: kill, killAll: killAll,
  killTree: killTree, info: info, safeCwd: safeCwd,
  _buildScript: buildScript, _pickShell: pickShell
};
