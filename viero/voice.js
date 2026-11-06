'use strict';
/* What Viero does with one utterance (spec §5.1, §5.5-§5.7). No I/O: run (the command
 * registry), speak, emit (bubble state), notify (toast) and log are injected, so every rule
 * here is unit-tested. Each call returns the beep the listener plays: 'ok' | 'unsure' | 'error' | null. */
const { normalize } = require('../../core/commands.js');

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'do it', 'correct', 'right']);
const NO = new Set(['no', 'nope', 'cancel', 'stop', 'never mind']);
const PENDING_MS = 10000; // a did-you-mean / confirm question stays open this long
const QUIET = "Didn't catch that";

function createVoice(o) {
  const now = o.now || Date.now;
  let pending = null; // { text, confirmed, at }
  const open = () => (pending && now() - pending.at <= PENDING_MS ? pending : (pending = null));

  async function exec(text, sttMs, ctx, t0) {
    const r = (await o.run(text, Object.assign({ source: 'viero' }, ctx))) || {};
    const ms = r.ms || {};
    const entry = { at: t0, text, command: r.command || '-', sttMs, matchMs: ms.match, actionMs: ms.action, totalMs: sttMs + (now() - t0) };
    if (r.ok) {
      o.log(Object.assign(entry, { result: 'ok' }));
      if (r.say) { o.emit('speaking', { text: r.say }); o.speak(r.say); } else o.emit('matched', { text: r.phrase || text });
      if (r.toast || r.say) o.notify(r.toast || r.say, r.level || 'ok');
      return 'ok';
    }
    if (r.needsConfirm) {
      pending = { text, confirmed: true, at: now() };
      const q = 'Run ' + (r.phrase || text) + '? Say yes.';
      o.log(Object.assign(entry, { result: 'confirm' }));
      o.emit('confirm', { text: q });
      o.speak(q);
      return 'unsure';
    }
    if (r.suggestion) {
      pending = { text: r.suggestion.text, at: now() };
      o.log(Object.assign(entry, { command: r.suggestion.command, result: 'unsure' }));
      o.emit('unsure', { text: r.suggestion.text });
      o.speak('Did you mean ' + r.suggestion.text + '?');
      return 'unsure';
    }
    if (!r.matched) {
      o.log(Object.assign(entry, { result: 'no match' }));
      o.emit('error', { text: QUIET });
      return 'error';
    }
    const msg = r.error || 'failed';
    o.log(Object.assign(entry, { result: 'failed' }));
    o.emit('error', { text: msg });
    o.notify(r.command + ': ' + msg, 'error');
    o.speak(msg);
    return 'error';
  }

  async function heard({ text, sttMs }) {
    const t0 = now(), said = normalize(text), q = open();
    sttMs = +sttMs || 0;
    pending = null; // anything heard, silence too, closes an open question
    if (!said) {
      o.log({ at: t0, text: '(silence)', command: '-', result: 'empty', sttMs, totalMs: sttMs });
      o.emit('error', { text: QUIET });
      return 'error';
    }
    if (q && YES.has(said)) return exec(q.text, sttMs, q.confirmed ? { confirmed: true } : {}, t0);
    if (q && NO.has(said)) { o.emit('cancelled', { text: 'Cancelled' }); return 'ok'; }
    return exec(text, sttMs, {}, t0);
  }

  async function answer(yes) {
    const q = open();
    if (!q) return null;
    pending = null;
    if (!yes) { o.emit('cancelled', { text: 'Cancelled' }); return 'ok'; }
    return exec(q.text, 0, q.confirmed ? { confirmed: true } : {}, now());
  }

  return { heard, answer, tap: () => answer(true), pending: () => (open() ? pending.text : null) };
}

module.exports = { createVoice, PENDING_MS };
