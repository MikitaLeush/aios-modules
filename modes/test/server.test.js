'use strict';
const fs = require('fs');
const path = require('path');
const server = require('../server.js');

// A fake core: settings live in memory, routes and handlers are captured so the test can call them.
function fakeCore(settings) {
  const routes = {}, handlers = {};
  return {
    settings,
    routes,
    handlers,
    config: () => settings,
    setConfig(p) { Object.assign(settings, p); },
    commands: { slot() {}, handle(id, fn) { handlers[id] = fn; } },
    events: { emit() {} },
    route(method, sub, fn) { routes[method + ' ' + sub] = fn; }
  };
}
function getState(core) {
  let body = '';
  core.routes['GET state']({}, { writeHead() {}, end(b) { body = b; } });
  return JSON.parse(body);
}

module.exports = async function (ok) {
  const core = fakeCore({ dryRun: true, modes: {}, apps: {} });
  server.init(core);
  ok('state reports dry run while the dry recorder is in use', getState(core).dryRun === true && getState(core).applyPending === false);

  core.settings.dryRun = false; // hand edit while AIOS runs: the recorder stays until restart
  const s = getState(core);
  ok('state still says dry run after a hand edit — the switches really are still dry', s.dryRun === true, JSON.stringify(s));
  ok('state flags that the dryRun change needs a restart', s.applyPending === true);

  const live = fakeCore({ modes: {}, apps: {} });
  server.init(live);
  live.settings.dryRun = true;
  ok('the reverse: real switches are never reported as dry', getState(live).dryRun === false && getState(live).applyPending === true);

  // dry-run handlers
  const d = fakeCore({
    dryRun: true,
    apps: { chrome: { process: 'chrome.exe' }, steam: { launch: 'steam://open/main', process: 'steam.exe' } },
    modes: { game: { close: ['chrome'], audio: { volume: 40 }, open: ['steam'] } }
  });
  server.init(d);
  const vol = async n => { try { return (await d.handlers['modes.volume']({ n })).toast; } catch (e) { return 'threw ' + e.message; } };
  ok('volume 1000 is refused, not cut to 100', /^threw .*0 to 100/.test(await vol('1000')), await vol('1000'));
  ok('volume 0050 is 50', await vol('0050') === 'audio → current device @ 50%', await vol('0050'));
  ok('volume 40 percent / 40% are 40', await vol('40 percent') === 'audio → current device @ 40%' && await vol('40%') === 'audio → current device @ 40%');
  const g = await d.handlers['modes.switch']({ mode: 'game' });
  ok('switch toast lists every step (spec §6.3)', g.toast === 'game mode on · closed chrome · audio → current device @ 40% · opened steam', g.toast);

  const panel = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
  const hint = /see (modules\/modes\/[\w/-]+\.\w+)/.exec(panel);
  ok('the empty-state hint points at a file that ships with the module', !!hint && fs.existsSync(path.join(__dirname, '..', '..', '..', hint[1])), hint && hint[1]);
};
