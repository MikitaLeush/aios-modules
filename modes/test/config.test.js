'use strict';
const { normalize, modeSlot, appSlot, summary } = require('../config.js');

module.exports = async function (ok) {
  // missing settings (Review Focus 5)
  const empty = normalize(undefined);
  ok('missing settings → no apps, no modes, no problems', Object.keys(empty.apps).length === 0 && Object.keys(empty.modes).length === 0 && empty.problems.length === 0 && empty.current === null && empty.dryRun === false);
  const odd = normalize({ apps: [], modes: 'yes' });
  ok('apps/modes of the wrong type are ignored (hand edits)', Object.keys(odd.apps).length === 0 && Object.keys(odd.modes).length === 0);

  const c = normalize({
    apps: {
      spotify: { launch: 'spotify:', process: 'Spotify.exe', aliases: ['music', 3, ''] },
      chrome: { process: 'chrome.exe' },
      bad: { process: 'x & calc' },
      'Bad Name': {}
    },
    modes: {
      game: { close: ['chrome', 'ghost'], dnd: true, audio: { output: 'Gigabyte', volume: 40 }, workspace: 'Chill', open: ['spotify'] },
      loud: { audio: { volume: 140 } }
    },
    current: 'game',
    dryRun: true
  });
  ok('apps keep their fields', c.apps.spotify.launch === 'spotify:' && c.apps.spotify.process === 'Spotify.exe');
  ok('non-string and empty aliases are dropped', JSON.stringify(c.apps.spotify.aliases) === '["music"]', JSON.stringify(c.apps.spotify.aliases));
  ok('a bad process name is a problem, not a crash', !c.apps.bad.process && c.problems.some(p => /"bad".*Name\.exe/.test(p)), JSON.stringify(c.problems));
  ok('a bad app name is a problem', !c.apps['Bad Name'] && c.problems.some(p => /Bad Name/.test(p)));
  ok('unknown app in a mode is a problem (Review Focus 1)', c.problems.some(p => /"game".*unknown app "ghost"/.test(p)));
  ok('the mode with an unknown app is still kept', !!c.modes.game && c.modes.game.close.length === 2);
  ok('volume out of range is a problem and dropped', !c.modes.loud.audio && c.problems.some(p => /"loud".*0-100/.test(p)));
  ok('current and dryRun are carried', c.current === 'game' && c.dryRun === true);
  ok('current pointing at a missing mode is dropped', normalize({ modes: {}, current: 'game' }).current === null);
  ok('mode slot = mode names', JSON.stringify(modeSlot(c)) === '["game","loud"]');
  ok('app slot carries aliases', appSlot(c).find(a => a.value === 'spotify').aliases[0] === 'music');
  ok('summary reads like the design', summary(c.modes.game) === 'closes chrome, ghost · audio → Gigabyte @ 40% · workspace Chill · opens spotify', summary(c.modes.game));
  ok('summary of an empty mode', summary(normalize({ modes: { x1: {} } }).modes.x1) === 'does nothing yet');

  // names that exist on every plain object are still unknown apps
  const proto = normalize({ apps: {}, modes: { x: { close: ['toString'], open: ['constructor'] } } });
  ok('prototype names are unknown apps, not built-ins', proto.problems.some(p => /unknown app "toString"/.test(p)) && proto.problems.some(p => /unknown app "constructor"/.test(p)), JSON.stringify(proto.problems));

  // missing fields show up front, not only when switching
  const gaps = normalize({ apps: { a: { launch: 'a:' }, b: { process: 'B.exe' } }, modes: { m: { close: ['a'], open: ['b'] } } });
  ok('closing an app with no process is a config problem', gaps.problems.some(p => /"m".*"a" has no process/.test(p)), JSON.stringify(gaps.problems));
  ok('opening an app with no launch target is a config problem', gaps.problems.some(p => /"m".*"b" has no launch/.test(p)), JSON.stringify(gaps.problems));
};
