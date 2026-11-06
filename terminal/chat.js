'use strict';
/* One server-side Claude conversation, shared by typed and voice messages.
 * Everything that touches the outside world (spawn, CLI lookup, cwd, kill) is injected,
 * so tests run against a fake CLI. Ported from the legacy /api/chat handler. */

const MAX_TEXT = 20000, KEEP = 50, KILL_AFTER = 15 * 60 * 1000;
const BUSY = 'Claude is still answering — wait, or press Ctrl+C';
const GONE = 'that session is gone — started a fresh one';
const RESUME_DEAD = /No conversation found with session ID|no conversation found|session .{0,80}not found/i;
const SOURCES = ['typed', 'voice', 'command'];

function createChat({ spawn, resolve, hint, args, cwd, killTree, now = Date.now, onChange }) {
  let sid = '', seq = 0, running = null;
  const turns = [];

  const changed = (t) => { if (onChange) try { onChange({ turn: t.id, state: t.state, n: t.items.length, source: t.source }); } catch (e) {} };
  const push = (t, item) => { t.items.push(item); changed(t); };
  const answerText = (id) => { const t = turns.find(x => x.id === id); return t ? t.items.filter(i => i.k === 'text').map(i => i.d).join('') : ''; };

  // the single exit of a turn: state, timer, busy flag, onDone (once, after the caller has the turn id)
  function finish(t, state, error) {
    if (t.state !== 'running') return;
    t.state = state;
    clearTimeout(t.timer);
    if (running === t) running = null;
    changed(t);
    const done = t.onDone;
    if (done) queueMicrotask(() => { try { done(state === 'done' ? { ok: true, answer: answerText(t.id) } : { ok: false, error, answer: answerText(t.id) }); } catch (e) {} });
  }

  function attempt(t, resumeId, isRetry) {
    const a = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (resumeId) a.push('--resume', resumeId);
    a.push(...args());
    let child;
    try { child = spawn(a, { cwd: t.cwd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (err) {
      push(t, { k: 'error', d: err.code === 'ENOENT' ? hint() : 'could not start claude: ' + err.message });
      return finish(t, 'error', t.items[t.items.length - 1].d);
    }
    t.child = child;
    const mine = () => t.state === 'running' && t.child === child;
    let buf = '', stderr = '', sawOutput = false, resumeFailed = false;
    // A dead resume id is reported as the very first event, so look at it before using anything.
    let sniff = !!(resumeId && !isRetry);

    const event = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch (e) { return; }
      if (!ev || typeof ev !== 'object') return;
      if (ev.session_id) sid = ev.session_id;
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const c of ev.message.content) {
          if (c.type === 'text' && c.text) push(t, { k: 'text', d: c.text });
          else if (c.type === 'tool_use') { const i = c.input || {}; push(t, { k: 'tool', name: c.name, d: i.file_path || i.path || i.pattern || '' }); }
        }
      } else if (ev.type === 'result') {
        if (ev.is_error) { t.failed = String(ev.result || 'Claude reported an error'); push(t, { k: 'error', d: t.failed }); }
        push(t, { k: 'done', ms: ev.duration_ms, cost: ev.total_cost_usd });
      }
    };
    const feed = (line) => {
      if (!line.trim()) return;
      if (sniff) {
        sniff = false;
        if (RESUME_DEAD.test(line)) { resumeFailed = true; return; }
      }
      if (resumeFailed) return;
      sawOutput = true;
      event(line);
    };

    child.on('error', (err) => {
      if (!mine()) return;
      push(t, { k: 'error', d: err.code === 'ENOENT' ? hint() : 'claude failed to start: ' + err.message });
      finish(t, 'error', t.items[t.items.length - 1].d);
    });
    child.stdout.setEncoding('utf8');                // decode across chunk boundaries (multi-byte chars)
    child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => {});               // EPIPE if claude exits early
    try { child.stdin.write(t.prompt); child.stdin.end(); } catch (e) {}
    child.stdout.on('data', (chunk) => {
      if (!mine()) return;
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); feed(line); }
    });
    child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
    child.on('close', (code) => {
      if (!mine()) return;
      feed(buf); buf = '';
      // the stored session can vanish (CLI update, other computer): start fresh, say so
      if (resumeId && !isRetry && (resumeFailed || (!sawOutput && code !== 0 && RESUME_DEAD.test(stderr)))) {
        sid = '';
        push(t, { k: 'notice', d: GONE });
        return attempt(t, '', true);
      }
      if (t.failed) return finish(t, 'error', t.failed);
      if (code !== 0 || !sawOutput) {
        const why = 'claude exited (code ' + code + ')' + (sawOutput ? '' : ' with no output') + (stderr.trim() ? ': ' + stderr.trim().slice(0, 400) : '');
        push(t, { k: 'error', d: why });
        return finish(t, 'error', why);
      }
      finish(t, 'done');
    });
  }

  function send(text, opts) {
    opts = opts || {};
    const prompt = String(text == null ? '' : text).trim();
    if (!prompt) return { error: 'message required' };
    if (prompt.length > MAX_TEXT) return { error: 'message too long' };
    if (running) return { error: BUSY };
    const t = {
      id: 't' + (++seq), source: SOURCES.includes(opts.source) ? opts.source : 'typed',
      prompt, state: 'running', items: [], startedAt: now(), onDone: opts.onDone, child: null, timer: null, failed: '',
      cwd: cwd(opts.cwd),
    };
    turns.push(t);
    while (turns.length > KEEP) turns.shift();
    running = t;
    changed(t);
    if (!resolve().ok) {
      push(t, { k: 'error', d: hint() });
      finish(t, 'error', hint());
      return { turn: t.id };
    }
    t.timer = setTimeout(() => {
      push(t, { k: 'error', d: 'claude took longer than 15 minutes — stopped' });
      const c = t.child;
      finish(t, 'error', 'timeout');
      if (c) killTree(c);
    }, KILL_AFTER);
    if (t.timer.unref) t.timer.unref();
    attempt(t, sid, false);
    return { turn: t.id };
  }

  function stop() {
    const t = running;
    if (!t) return false;
    const c = t.child;
    finish(t, 'stopped', 'stopped');
    if (c) killTree(c);
    return true;
  }

  return {
    send, stop,
    reset() { stop(); sid = ''; },
    list() { return { busy: !!running, turns: turns.map(t => ({ id: t.id, source: t.source, state: t.state, n: t.items.length, startedAt: t.startedAt })) }; },
    read(id, from = 0) {
      const t = turns.find(x => x.id === id);
      return t ? { id: t.id, source: t.source, prompt: t.prompt, state: t.state, n: t.items.length, items: t.items.slice(from) } : null;
    },
    answerText,
  };
}

module.exports = { createChat };
