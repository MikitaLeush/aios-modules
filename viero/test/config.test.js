'use strict';
const { normalizeConfig, whisperPrompt } = require('../config.js');

module.exports = async function (ok) {
  const none = normalizeConfig(undefined);
  ok('no settings → no key, tiny.en, one problem naming the fix', none.key === '' && none.model === 'tiny.en' && none.problems.length === 1 && /modules\.viero\.key/.test(none.problems[0]), JSON.stringify(none));
  const good = normalizeConfig({ key: 'F9', model: 'base.en' });
  ok('key is lower-cased, model kept, no problems', good.key === 'f9' && good.model === 'base.en' && good.problems.length === 0, JSON.stringify(good));
  const altgr = normalizeConfig({ key: 'alt_r' });
  ok('AltGr is refused (it types characters)', altgr.key === '' && /not supported/.test(altgr.problems[0]), JSON.stringify(altgr));
  ok('a made-up key is refused', normalizeConfig({ key: 'banana' }).key === '');
  const big = normalizeConfig({ key: 'pause', model: 'large-v3' });
  ok('unknown model → tiny.en with a problem', big.key === 'pause' && big.model === 'tiny.en' && big.problems.some(p => /model/.test(p)), JSON.stringify(big));
  ok('lock and editing keys are refused (they act on every press)', ['caps_lock', 'num_lock', 'insert', 'menu', 'home', 'end', 'page_up', 'page_down'].every(k => normalizeConfig({ key: k }).key === ''));

  // A prompt ending in ", " makes whisper continue the list: "open steam, open steam," (M3 bench finding)
  const many = Array.from({ length: 80 }, (_, i) => 'open app' + i);
  const p = whisperPrompt(many);
  ok('whisper prompt: whole phrases only, never ends on a comma, at most 600 chars', p.length <= 600 && !/[,\s]$/.test(p) && p.split(', ').every(x => many.includes(x)), JSON.stringify(p.slice(-40)));
  ok('whisper prompt of a short list is the whole list', whisperPrompt(['game mode', 'open music']) === 'game mode, open music');
};
