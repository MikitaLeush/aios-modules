'use strict';
const { normalize } = require('../config.js');
const { createSwitcher, drySys, DND_TEXT } = require('../switcher.js');

function fakeSys(over) {
  const log = [];
  const sys = Object.assign({
    async launch(t) { log.push('launch ' + t); },
    async close(p) { log.push('close ' + p); return 'closed'; },
    async workspace(n) { log.push('workspace ' + n); },
    async audio(a) { log.push('audio ' + JSON.stringify(a)); return { output: a.output ? a.output + ' (device)' : undefined, volume: a.volume }; }
  }, over || {});
  sys.log = log;
  return sys;
}

const cfg = normalize({
  apps: {
    chrome: { process: 'chrome.exe' },
    code: { process: 'Code.exe' },
    steam: { launch: 'steam://open/main', process: 'steam.exe' },
    notes: { process: 'Notes.exe' }
  },
  modes: {
    // keys deliberately out of order: the switcher must still run close → dnd → audio → workspace → open
    game: { open: ['steam'], workspace: 'Chill', audio: { output: 'Gigabyte', volume: 40 }, dnd: true, close: ['chrome', 'code'] },
    broken: { close: ['chrome', 'ghost'], open: ['notes'] }
  }
});

module.exports = async function (ok) {
  let sys = fakeSys();
  let sw = createSwitcher(sys);
  const r = await sw.switchMode('game', cfg);
  ok('steps run in the fixed order', sys.log.join(' | ') === 'close chrome.exe | close Code.exe | audio {"output":"Gigabyte","volume":40} | workspace Chill | launch steam://open/main', sys.log.join(' | '));
  ok('result names the mode and time', r.mode === 'game' && !isNaN(Date.parse(r.at)));
  ok('step kinds in order', r.steps.map(s => s.step).join(',') === 'close,dnd,audio,workspace,open');
  ok('close text', r.steps[0].ok === true && r.steps[0].text === 'closed chrome, code', r.steps[0].text);
  ok('dnd is reported as not supported', r.steps[1].ok === null && r.steps[1].text === DND_TEXT);
  ok('audio text', r.steps[2].ok === true && r.steps[2].text === 'audio → Gigabyte (device) @ 40%', r.steps[2].text);
  ok('workspace text says best effort', r.steps[3].text === 'workspace "Chill" launched (window placement is best effort)');
  ok('open text', r.steps[4].ok === true && r.steps[4].text === 'opened steam');

  // still running (Review Focus 2)
  sys = fakeSys({ async close(p) { sys.log.push('close ' + p); return p === 'chrome.exe' ? 'still-running' : 'not-running'; } });
  sw = createSwitcher(sys);
  let res = await sw.switchMode('game', cfg);
  ok('still running is reported, later steps still run', res.steps[0].ok === false && /chrome still running after 5s \(not forced\)/.test(res.steps[0].text) && /code not running/.test(res.steps[0].text) && res.steps[4].ok === true, res.steps[0].text);

  // missing PowerToys / audio tool (Review Focus 4)
  sys = fakeSys({
    async workspace() { throw new Error('PowerToys Workspaces not found'); },
    async audio() { throw new Error('needs AudioDeviceCmdlets'); }
  });
  sw = createSwitcher(sys);
  res = await sw.switchMode('game', cfg);
  ok('missing PowerToys / audio tool: other steps still run',
    res.steps[2].ok === false && /couldn't set audio to Gigabyte \(needs AudioDeviceCmdlets\)/.test(res.steps[2].text) &&
    res.steps[3].ok === false && /not launched \(PowerToys Workspaces not found\)/.test(res.steps[3].text) &&
    res.steps[0].ok === true && res.steps[4].ok === true, JSON.stringify(res.steps));

  // unknown app (Review Focus 1)
  sys = fakeSys(); sw = createSwitcher(sys);
  res = await sw.switchMode('broken', cfg);
  ok('unknown app: others still close', res.steps[0].ok === false && /closed chrome/.test(res.steps[0].text) && /unknown app "ghost"/.test(res.steps[0].text), res.steps[0].text);
  ok('an app without a launch target is reported', res.steps[1].ok === false && /notes has no launch target/.test(res.steps[1].text), res.steps[1].text);

  let threw = '';
  try { await sw.switchMode('nope', cfg); } catch (e) { threw = e.message; }
  ok('unknown mode throws', threw === 'no mode "nope"', threw);

  threw = '';
  try { await sw.switchMode('toString', cfg); } catch (e) { threw = e.message; }
  ok('a prototype name is not a mode', threw === 'no mode "toString"', threw);

  // lock (Review Focus 3)
  const releases = [];
  sys = fakeSys({ close: () => new Promise(r => releases.push(() => r('closed'))) });
  sw = createSwitcher(sys);
  const first = sw.switchMode('game', cfg);
  await new Promise(r => setTimeout(r, 0));
  threw = '';
  try { await sw.switchMode('broken', cfg); } catch (e) { threw = e.message; }
  ok('a second switch while one runs is refused', threw === 'already switching to game' && sw.busy() === 'game', threw);
  const refused = [];
  for (const p of [sw.openApp(cfg, 'steam'), sw.closeApp(cfg, 'code'), sw.setVolume(20)]) {
    try { await p; refused.push('ran'); } catch (e) { refused.push(e.message); }
  }
  ok('open / close / volume are refused while a switch runs', refused.every(m => m === 'already switching to game'), JSON.stringify(refused));
  releases.forEach(f => f());
  await first;
  ok('the lock is released afterwards', sw.busy() === null);

  // closes run side by side: two tray apps cost ~5 s, not ~10 s
  sys = fakeSys({ close: p => new Promise(r => setTimeout(() => r('closed'), 100)) });
  sw = createSwitcher(sys);
  const t0 = Date.now();
  const par = await sw.switchMode('game', cfg);
  const took = Date.now() - t0;
  ok('closes run in parallel and keep their order', took < 180 && par.steps[0].text === 'closed chrome, code', took + 'ms ' + par.steps[0].text);

  sys = fakeSys(); sw = createSwitcher(sys);
  ok('openApp launches one app', (await sw.openApp(cfg, 'steam')).text === 'opened steam' && sys.log[0] === 'launch steam://open/main');
  ok('closeApp closes one app', (await sw.closeApp(cfg, 'code')).text === 'closed code');
  ok('setVolume keeps the device', (await sw.setVolume(30)).text === 'audio → current device @ 30%');

  const log = [];
  const dry = createSwitcher(drySys(log));
  const d = await dry.switchMode('game', cfg);
  ok('dry run records every call and reports success', log.length === 5 && log[0][0] === 'close' && d.steps.every(s => s.ok !== false), JSON.stringify(log));
};
