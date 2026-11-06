'use strict';
/* The real OS side of the modes module (Windows). Every command here was proven in
 * projects/aios-v3/experiments.md §1 and §3. Paths are found at run time, never hardcoded;
 * values go to execFile/spawn as separate arguments, never through a shell. */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { PROC_RE } = require('./config.js');

// .exe runs directly; anything else (URI, .lnk, document) is opened by explorer.exe.
function launchCommand(target) {
  return /\.exe$/i.test(target) ? [target, []] : ['explorer.exe', [target]];
}
// No /f: the same as clicking X, so apps can save or ask first (spec §6.3).
function taskkillArgs(proc) { return ['/im', proc]; }
// A failed or timed-out tasklist must not read as "not running". Exit code, not the INFO text: that is localized.
function parseTasklist(out, proc, code) {
  if (code) throw new Error('tasklist failed' + (String(out).trim() ? ': ' + String(out).trim().slice(0, 120) : ''));
  return String(out).toLowerCase().indexOf('"' + String(proc).toLowerCase() + '"') >= 0;
}
function workspaceId(json, name) {
  const list = json && Array.isArray(json.workspaces) ? json.workspaces : [];
  const hit = list.find(x => x && typeof x.name === 'string' && x.name.toLowerCase() === String(name).toLowerCase());
  return hit && typeof hit.id === 'string' ? hit.id : null;
}
function audioArgs(script, a) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Output', a.output || '', '-Volume', String(a.volume === undefined ? -1 : a.volume)];
}
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

function createWindowsSys(opts) {
  const env = (opts && opts.env) || process.env;
  const local = env.LOCALAPPDATA || '';
  const launchers = [local && path.join(local, 'PowerToys', 'PowerToys.WorkspacesLauncher.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'PowerToys', 'PowerToys.WorkspacesLauncher.exe')].filter(Boolean);
  const workspacesFile = path.join(local, 'Microsoft', 'PowerToys', 'Workspaces', 'workspaces.json');
  const script = path.join(__dirname, 'ps', 'audio.ps1');

  const run = (cmd, args, timeout) => new Promise(resolve => execFile(cmd, args, { timeout: timeout || 15000, windowsHide: true },
    (e, so, se) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : -1) : 0, out: String(so || ''), err: String(se || (e ? e.message : '')) })));
  const detached = (cmd, args) => new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    c.once('error', e => reject(new Error(e.code === 'ENOENT' ? 'not found: ' + cmd : e.message)));
    c.once('spawn', () => { c.unref(); resolve(); });
  });

  async function running(proc) {
    const r = await run('tasklist', ['/fi', 'imagename eq ' + proc, '/fo', 'csv', '/nh']);
    return parseTasklist(r.out || r.err, proc, r.code);
  }

  return {
    running,
    async launch(target) {
      const [cmd, args] = launchCommand(target);
      await detached(cmd, args);
    },
    async close(proc, waitMs) {
      if (!PROC_RE.test(String(proc))) throw new Error('bad process name ' + proc);
      if (!(await running(proc))) return 'not-running';
      await run('taskkill', taskkillArgs(proc));
      const until = Date.now() + (waitMs === undefined ? 5000 : waitMs);
      while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 500));
        if (!(await running(proc))) return 'closed';
      }
      return 'still-running';
    },
    async workspace(name) {
      const exe = launchers.find(isFile);
      if (!exe) throw new Error('PowerToys Workspaces not found');
      let json;
      try { json = JSON.parse(fs.readFileSync(workspacesFile, 'utf8')); } catch (e) { throw new Error('no PowerToys workspaces saved'); }
      const id = workspaceId(json, name);
      if (!id) throw new Error('no PowerToys workspace named "' + name + '"');
      await detached(exe, [id]); // fire and forget: waiting hangs until its apps exit (experiments §1)
    },
    async audio(a) {
      const r = await run('powershell.exe', audioArgs(script, a), 20000);
      let j;
      try { j = JSON.parse(r.out.trim().split(/\r?\n/).pop()); }
      catch (e) { throw new Error('audio script failed: ' + (r.err || r.out).trim().slice(0, 200)); }
      if (!j.ok) throw new Error(j.error || 'audio failed');
      return { output: j.output, volume: j.volume };
    }
  };
}

module.exports = { createWindowsSys, launchCommand, taskkillArgs, parseTasklist, workspaceId, audioArgs };
