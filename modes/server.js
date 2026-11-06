'use strict';
/* Modes module (spec §6): focus / game / relax. Steps run through windows.js, or through
 * the dry-run recorder when settings.dryRun is true (selftest, first try-outs). Switching
 * from the panel goes through the same commands as the palette and Viero. */
const { normalize, modeSlot, appSlot, summary } = require('./config.js');
const { createSwitcher, drySys } = require('./switcher.js');
const { createWindowsSys } = require('./windows.js');

module.exports = {
  init(core) {
    const cfg = () => normalize(core.config());
    const dry = cfg().dryRun; // fixed until restart/toggle, so `state` reports this, not the file
    const sw = createSwitcher(dry ? drySys() : createWindowsSys());
    let last = null;

    core.commands.slot('mode', () => modeSlot(cfg()));
    core.commands.slot('app', () => appSlot(cfg()));

    const stepResult = s => {
      if (s.ok === false) throw new Error(s.text);
      return { toast: s.text, details: s };
    };

    core.commands.handle('modes.switch', async ({ mode }) => {
      const r = await sw.switchMode(mode, cfg());
      last = r;
      core.setConfig({ current: mode });
      core.events.emit('changed', { current: mode, last: r });
      const toast = [mode + ' mode on'].concat(r.steps.map(s => s.text)).join(' · ');
      return { toast, level: r.steps.some(s => s.ok === false) ? 'warn' : 'ok', details: r };
    });
    core.commands.handle('modes.open', async ({ app }) => stepResult(await sw.openApp(cfg(), app)));
    core.commands.handle('modes.close', async ({ app }) => stepResult(await sw.closeApp(cfg(), app)));
    core.commands.handle('modes.volume', async ({ n }) => {
      const m = /^(\d+)%?(?:\s|$)/.exec(String(n).trim());
      const v = m ? +m[1] : NaN;
      if (!(v >= 0 && v <= 100)) throw new Error('say a volume from 0 to 100');
      return stepResult(await sw.setVolume(v));
    });

    core.route('GET', 'state', (req, res) => {
      const c = cfg();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        current: c.current, dryRun: dry, applyPending: c.dryRun !== dry, problems: c.problems, last,
        modes: Object.values(c.modes).map(m => ({ name: m.name, summary: summary(m) })),
        apps: Object.values(c.apps).map(a => ({ name: a.name, aliases: a.aliases }))
      }));
    });
  }
};
