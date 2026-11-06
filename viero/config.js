'use strict';
/* Viero settings (machine.json → modules.viero) → { key, model, problems }. Pure. */
// pynput Key names that exist on every Windows keyboard layout. Left out on purpose: AltGr
// (alt_r) types characters on many layouts (spec §15.1); caps/num lock flip their state and
// insert/menu/home/end/page keys act in the focused app on every press.
const KEYS = new Set(Array.from({ length: 20 }, (_, i) => 'f' + (i + 1)).concat(['scroll_lock', 'pause', 'ctrl_r', 'shift_r']));
const MODELS = new Set(['tiny.en', 'base.en', 'small.en']);

function normalizeConfig(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const problems = [];
  let key = typeof s.key === 'string' ? s.key.trim().toLowerCase() : '';
  if (!key) problems.push('no push-to-talk key yet: set modules.viero.key in system/machine.json (e.g. "pause")');
  else if (!KEYS.has(key)) { problems.push('key "' + key + '" is not supported: use f1-f20, pause, scroll_lock, ctrl_r or shift_r'); key = ''; }
  let model = 'tiny.en';
  if (MODELS.has(s.model)) model = s.model;
  else if (s.model !== undefined) problems.push('model "' + s.model + '" is not supported: use tiny.en, base.en or small.en');
  return { key, model, problems };
}

// Speech-to-text prompt from the sayable commands (spec §5.3): whole phrases up to max chars.
// Never cut mid-list: a prompt ending in ", " makes whisper repeat the phrase it heard.
function whisperPrompt(phrases, max) {
  max = max || 600;
  let out = '';
  for (const p of phrases) {
    const next = out ? out + ', ' + p : p;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

module.exports = { normalizeConfig, whisperPrompt, KEYS };
