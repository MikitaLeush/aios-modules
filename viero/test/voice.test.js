'use strict';
const { createVoice, PENDING_MS } = require('../voice.js');

const OK = { ok: true, matched: true, command: 'modes.switch', phrase: 'game mode', toast: 'game mode on · closed obsidian', level: 'ok', ms: { match: 2, action: 30 } };
const FOCUS = { ok: true, matched: true, command: 'modes.switch', phrase: 'focus mode', toast: 'focus mode on', level: 'ok', ms: { match: 2, action: 30 } };
const UNSURE = { ok: false, matched: false, suggestion: { text: 'game mode', command: 'modes.switch', score: 0.75 }, ms: { match: 2 } };
const FAIL = { ok: false, matched: true, command: 'modes.open', error: 'steam: not found', ms: { match: 1, action: 5 } };
const CONFIRM = { ok: false, matched: true, command: 'files.wipe', phrase: 'wipe everything', needsConfirm: true, ms: { match: 1 } };
const WIPED = { ok: true, matched: true, command: 'files.wipe', phrase: 'wipe', toast: 'wiped', ms: { match: 1, action: 3 } };
const NONE = { ok: false, matched: false, ms: { match: 1 } };

function harness() {
  const results = { 'game mode': OK, 'focus mode': FOCUS, 'gay mode': UNSURE, 'open steam': FAIL, wipe: ctx => (ctx.confirmed ? WIPED : CONFIRM) };
  const calls = { run: [], speak: [], emit: [], notify: [], log: [] };
  let t = 1000000;
  const v = createVoice({
    run: async (text, ctx) => { calls.run.push([text, ctx]); const r = results[text]; return typeof r === 'function' ? r(ctx) : (r || NONE); },
    speak: s => calls.speak.push(s),
    emit: (s, d) => calls.emit.push(s + ':' + (d && d.text)),
    notify: (s, l) => calls.notify.push(l + ':' + s),
    log: e => calls.log.push(e),
    now: () => t
  });
  return { v, calls, advance: ms => { t += ms; } };
}

module.exports = async function (ok) {
  let h = harness();
  let b = await h.v.heard({ text: 'game mode', sttMs: 150 });
  ok('a match: ok beep, toast, no speech', b === 'ok' && h.calls.notify[0] === 'ok:game mode on · closed obsidian' && h.calls.speak.length === 0 && h.calls.emit[0] === 'matched:game mode', JSON.stringify(h.calls));
  ok('runs through the registry as source viero', h.calls.run[0][0] === 'game mode' && h.calls.run[0][1].source === 'viero');
  const e = h.calls.log[0];
  ok('log entry carries every stage time; total includes stt', e.result === 'ok' && e.command === 'modes.switch' && e.sttMs === 150 && e.matchMs === 2 && e.actionMs === 30 && e.totalMs === 150, JSON.stringify(e));

  // Review Focus 1
  h = harness();
  b = await h.v.heard({ text: '  ', sttMs: 80 });
  ok('silence: error beep, nothing runs, quiet bubble, no speech', b === 'error' && h.calls.run.length === 0 && h.calls.emit[0] === "error:Didn't catch that" && h.calls.speak.length === 0 && h.calls.log[0].result === 'empty' && h.calls.log[0].text === '(silence)');
  b = await h.v.tap();
  ok('tap with nothing open: no beep, nothing runs', b === null && h.calls.run.length === 0);
  b = await h.v.heard({ text: 'blah blah', sttMs: 90 });
  ok('no match: error beep, not spoken, logged', b === 'error' && h.calls.speak.length === 0 && h.calls.log[1].result === 'no match' && h.calls.notify.length === 0);

  h = harness();
  b = await h.v.heard({ text: 'gay mode', sttMs: 150 });
  ok('near miss: asks out loud, unsure beep, nothing runs', b === 'unsure' && h.calls.speak[0] === 'Did you mean game mode?' && h.calls.emit[0] === 'unsure:game mode' && h.calls.run.length === 1 && h.v.pending() === 'game mode');
  ok('the question is logged as unsure under the suggested command', h.calls.log[0].result === 'unsure' && h.calls.log[0].command === 'modes.switch');
  b = await h.v.heard({ text: 'Yes.', sttMs: 100 });
  ok('"yes" runs the suggestion', b === 'ok' && h.calls.run[1][0] === 'game mode' && h.v.pending() === null);

  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  b = await h.v.tap();
  ok('a short key tap answers yes', b === 'ok' && h.calls.run[1][0] === 'game mode');

  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  b = await h.v.heard({ text: 'no', sttMs: 100 });
  ok('"no" cancels', b === 'ok' && h.calls.run.length === 1 && h.calls.emit.includes('cancelled:Cancelled'));
  b = await h.v.heard({ text: 'yes', sttMs: 100 });
  ok('"yes" with nothing open is just an unmatched phrase', b === 'error' && h.calls.run[1][0] === 'yes');

  // Review Focus 3
  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  h.advance(PENDING_MS + 1);
  await h.v.heard({ text: 'yes', sttMs: 100 });
  ok('expired question: a late "yes" does not run the old suggestion', !h.calls.run.some(([t]) => t === 'game mode'));
  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  await h.v.heard({ text: 'focus mode', sttMs: 150 });
  await h.v.heard({ text: 'yes', sttMs: 100 });
  ok('a new command replaces the question', h.calls.run.map(([t]) => t).join(',') === 'gay mode,focus mode,yes');

  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  ok('Yes/No buttons: answer(false) cancels', (await h.v.answer(false)) === 'ok' && h.v.pending() === null && h.calls.run.length === 1);
  ok('answer with nothing open does nothing', (await h.v.answer(true)) === null);

  h = harness();
  b = await h.v.heard({ text: 'open steam', sttMs: 120 });
  ok('handler failure: spoken, error toast, error beep', b === 'error' && h.calls.speak[0] === 'steam: not found' && h.calls.notify[0] === 'error:modes.open: steam: not found' && h.calls.log[0].result === 'failed');

  // Review Focus 5: confirm-required command by voice
  h = harness();
  b = await h.v.heard({ text: 'wipe', sttMs: 120 });
  ok('confirm-required: asks out loud first, in words not the command id', b === 'unsure' && h.calls.speak[0] === 'Run wipe everything? Say yes.' && h.calls.emit[0] === 'confirm:Run wipe everything? Say yes.', JSON.stringify(h.calls.speak));
  b = await h.v.heard({ text: 'yes', sttMs: 100 });
  ok('"yes" runs it confirmed', b === 'ok' && h.calls.run[1][0] === 'wipe' && h.calls.run[1][1].confirmed === true);

  h = harness();
  await h.v.heard({ text: 'gay mode', sttMs: 150 });
  await h.v.heard({ text: '', sttMs: 80 });
  ok('silence closes an open question (a later tap runs nothing)', h.v.pending() === null && (await h.v.tap()) === null && h.calls.run.length === 1);
};
