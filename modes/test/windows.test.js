'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const w = require('../windows.js');

async function rejects(p) { try { await p; return ''; } catch (e) { return e.message; } }

module.exports = async function (ok) {
  ok('.exe paths run directly', JSON.stringify(w.launchCommand('C:\\Apps\\x.exe')) === JSON.stringify(['C:\\Apps\\x.exe', []]));
  ok('URIs go through explorer', JSON.stringify(w.launchCommand('steam://open/main')) === JSON.stringify(['explorer.exe', ['steam://open/main']]));
  ok('shortcuts go through explorer', w.launchCommand('C:\\Links\\Spotify.lnk')[0] === 'explorer.exe');
  const tk = w.taskkillArgs('chrome.exe');
  ok('taskkill is graceful (no /f) (Review Focus 2)', JSON.stringify(tk) === '["/im","chrome.exe"]' && !tk.some(a => /^\/f$/i.test(a)));
  ok('tasklist csv: running', w.parseTasklist('"chrome.exe","1234","Console","1","120,000 K"\r\n', 'Chrome.exe') === true);
  ok('tasklist: not running', w.parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n', 'chrome.exe') === false);
  const throwsOn = (out, code) => { try { w.parseTasklist(out, 'chrome.exe', code); return ''; } catch (e) { return e.message; } };
  ok('tasklist that failed or timed out is an error, not "not running"', /tasklist failed/.test(throwsOn('', -1)) && /tasklist failed/.test(throwsOn('ERROR: Invalid argument/option.\r\n', 1)));
  ok('workspace by name, case-insensitive', w.workspaceId({ workspaces: [{ name: 'Chill', id: '{A-1}' }] }, 'chill') === '{A-1}');
  ok('unknown workspace / bad json → null', w.workspaceId({ workspaces: [{ name: 'Chill', id: '{A-1}' }] }, 'Work') === null && w.workspaceId(null, 'x') === null);
  const aa = w.audioArgs('a.ps1', { output: 'Gig"; calc', volume: 40 });
  ok('audio values are separate arguments, never script text', aa.indexOf('-Output') >= 0 && aa[aa.indexOf('-Output') + 1] === 'Gig"; calc' && aa[aa.indexOf('-Volume') + 1] === '40', JSON.stringify(aa));
  ok('no volume → -1', w.audioArgs('a.ps1', { output: 'X' })[w.audioArgs('a.ps1', { output: 'X' }).indexOf('-Volume') + 1] === '-1');

  const script = fs.readFileSync(path.join(__dirname, '..', 'ps', 'audio.ps1'));
  ok('audio.ps1 is plain ASCII (PowerShell 5.1 reads BOM-less files as ANSI)', script.every(b => b < 128));

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-modes-'));
  const sys = w.createWindowsSys({ env: { LOCALAPPDATA: empty, ProgramFiles: empty } });
  ok('no PowerToys → clear error (Review Focus 4)', /PowerToys Workspaces not found/.test(await rejects(sys.workspace('Chill'))));
  fs.mkdirSync(path.join(empty, 'PowerToys'));
  fs.writeFileSync(path.join(empty, 'PowerToys', 'PowerToys.WorkspacesLauncher.exe'), '');
  ok('PowerToys but no saved workspaces → clear error', /no PowerToys workspaces saved/.test(await rejects(sys.workspace('Chill'))));
  fs.mkdirSync(path.join(empty, 'Microsoft', 'PowerToys', 'Workspaces'), { recursive: true });
  fs.writeFileSync(path.join(empty, 'Microsoft', 'PowerToys', 'Workspaces', 'workspaces.json'), JSON.stringify({ workspaces: [{ name: 'Chill', id: '{A-1}' }] }));
  ok('unknown workspace name → clear error', /no PowerToys workspace named "Work"/.test(await rejects(sys.workspace('Work'))));
  ok('close refuses odd process names', /bad process name/.test(await rejects(sys.close('x & calc'))));
  fs.rmSync(empty, { recursive: true, force: true });

  if (process.platform === 'win32') {
    const real = w.createWindowsSys();
    ok('running() sees this node process', await real.running(path.basename(process.execPath)) === true);
    ok('running() of a made-up process is false', await real.running('aios-not-a-real-process.exe') === false);
    ok('close() of a process that is not running does nothing', await real.close('aios-not-a-real-process.exe') === 'not-running');
    // read-only: no device has this name, so nothing changes; the name must come back intact
    const odd = 'Zürich-ÄÖ-not-a-device';
    const msg = await rejects(real.audio({ output: odd }));
    ok('non-ASCII text from audio.ps1 arrives intact', msg === 'device not found: ' + odd || /needs AudioDeviceCmdlets/.test(msg), msg);
  }
};
