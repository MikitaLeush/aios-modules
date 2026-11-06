'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async function (ok) {
  const { view, keyName } = await import(pathToFileURL(path.join(__dirname, '..', 'overlay.js')).href);
  ok('key names read like the keyboard', keyName('f9') === 'F9' && keyName('scroll_lock') === 'Scroll Lock' && keyName('pause') === 'Pause');
  const l = view({ state: 'listening', key: 'pause' });
  ok('listening: level bars and the key', l.levels === true && l.key === 'Pause' && l.phase === 'Listening');
  const m = view({ state: 'matched', text: 'game mode' });
  ok('matched shows the phrase and fades after 1 s', m.text === 'game mode' && m.check === true && m.hideMs === 1000);
  const u = view({ state: 'unsure', text: 'game mode', key: 'pause' });
  ok('did-you-mean asks with Yes/No and names the key', u.ask === true && u.text === 'game mode?' && u.hint === 'Say yes or press Pause.' && u.hideMs === 10000);
  const e = view({ state: 'error' });
  ok("silence / no match: small quiet bubble, gone after 2 s", e.cls === 'bubble bubble-quiet' && e.text === "Didn't catch that" && e.hideMs === 2000);
  const cf = view({ state: 'confirm', text: 'Run wipe everything? Say yes.', key: 'ctrl_r' });
  ok('confirm names the key too (ui-spec state 6)', cf.ask === true && cf.hint === 'Say yes or press Right Ctrl.', JSON.stringify(cf));
  const n = view({ state: 'unavailable', text: 'Viero needs Python 3.10+ and its packages: run node modules/viero/setup.js' });
  ok('unavailable: warning bubble with a link to the panel', n.cls === 'bubble bubble-warn' && n.link === true && /setup\.js/.test(n.text));
  ok('unknown states draw nothing', view({ state: 'whatever' }) === null && view(null) === null);
};
