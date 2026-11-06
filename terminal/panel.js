// Terminal panel (M6c): a shell rooted at the vault plus the Claude conversation, ported from the
// legacy dashboard (AIOS.dc.html, termHelp/termSubmit/claudeEvent). Kit classes and tokens only.
// The log is built once and appended to; the input row is never redrawn, so it keeps focus.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ROW = 'display:flex;gap:12px;align-items:center;'; // theme.css has no .row
const KIND = { sys: 'muted', err: 'error', tool: 'muted', prompt: '', out: '', claude: '' };
const MAX_LINES = 700, HIST_KEY = 'aios.terminal.hist';
// ANSI colour/cursor escapes and other control bytes; \t \r \n survive
const ANSI = [/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, /\x1b\[[0-9;?]*[ -\/]*[@-~]/g, /\x1b[@-Z\\-_]/g, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g];
const deAnsi = s => ANSI.reduce((o, re) => o.replace(re, ''), String(s));
const fmtMs = n => { n = +n || 0; return n < 1000 ? n + 'ms' : (n / 1000).toFixed(n < 10000 ? 1 : 0) + 's'; };
const HELP = [
  'what you can type:',
  '  <command>            run it in the shell, in the current folder',
  '  cd <folder>          move around — the prompt shows where you are',
  '  claude               enter Claude mode (plain text = a message to Claude)',
  '  claude <question>    ask once without leaving the shell',
  '  !<command>           run one shell command while in Claude mode',
  '  new                  start a fresh Claude session',
  '  reset                jump back to the vault root',
  '  clear                wipe the scrollback        (Ctrl+L)',
  '  exit                 leave Claude mode          (Esc)',
  '',
  'Ctrl+C stops whatever is running. ↑ / ↓ walk your history.',
  'Full-screen programs (vim, top, interactive claude) need a real TTY —',
  'use "Open OS terminal" for those.'
];

export function mount(root, ctx) {
  let alive = true, mode = 'sh', cwd = '', vault = '', runId = null, running = false, abort = null;
  let posting = false, chain = Promise.resolve();
  const lines = [], turns = new Map();
  let hist = [], hi = -1;
  try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]').filter(h => typeof h === 'string').slice(-200); } catch (e) {}

  // vault-relative prompt — never an absolute path, so it reads the same on every machine
  const rel = c => {
    if (!c) return 'aios';
    const n = x => String(x).replace(/\\/g, '/').replace(/\/+$/, '');
    const a = n(c), r = n(vault);
    if (r && (a === r || a.toLowerCase().indexOf(r.toLowerCase() + '/') === 0)) { const rest = a.slice(r.length).replace(/^\//, ''); return rest ? 'aios/' + rest : 'aios'; }
    return a;
  };
  const label = () => mode === 'claude' ? 'claude ›' : rel(cwd) + ' ›';

  const head = el('div'); head.style.cssText = ROW + 'justify-content:space-between';
  const pill = el('span', 'pill');
  const osBtn = el('button', 'btn btn-sm', 'Open OS terminal');
  head.append(el('div', 'label', 'TERMINAL'), pill, osBtn);
  const log = el('pre'); log.setAttribute('aria-live', 'off');
  log.style.cssText = 'height:calc(100dvh - 300px);min-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin-top:16px';
  const form = el('div'); form.style.cssText = ROW + 'margin-top:12px';
  const prompt = el('span', 'mono'); prompt.style.cssText = 'color:var(--accent);white-space:nowrap';
  const input = el('input', 'input mono');
  input.setAttribute('aria-label', 'Terminal input');
  input.autocomplete = 'off'; input.spellcheck = false;
  form.append(prompt, input);
  root.append(head, log, form);
  const status = () => {
    prompt.textContent = label();
    pill.textContent = mode === 'claude' ? 'Claude mode' : 'shell';
    pill.className = 'pill' + (mode === 'claude' ? ' pill-loaded' : '');
  };

  // ---- log ----
  const last = () => lines[lines.length - 1];
  const close = () => { const l = last(); if (l) l.open = false; };
  function newLine(kind, text) {
    const node = el('div', KIND[kind] || '', text);
    node.style.minHeight = '1.6em';
    if (kind === 'prompt') node.style.color = 'var(--accent-soft)';
    log.append(node);
    const l = { k: kind, t: text, open: true, node };
    lines.push(l);
    while (lines.length > MAX_LINES) lines.shift().node.remove();
    return l;
  }
  function put(kind, text, fresh) {
    if (text == null || text === '') return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 90; // scrolling up to read is not yanked back
    if (fresh) close();
    const parts = deAnsi(text).replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < parts.length; i++) {
      let seg = parts[i], replace = false;
      const ci = seg.lastIndexOf('\r');            // progress bars rewrite the current line
      if (ci >= 0) { seg = seg.slice(ci + 1); replace = true; }
      if (seg !== '' || replace) {
        const l = last();
        if (l && l.open && l.k === kind) { l.t = replace ? seg : l.t + seg; l.node.textContent = l.t; }
        else newLine(kind, seg);
      }
      if (i < parts.length - 1) { if (!(last() && last().open)) newLine(kind, ''); close(); }
    }
    if (stick) log.scrollTop = log.scrollHeight;
  }
  const line = (kind, text) => put(kind, String(text) + '\n', true);
  const clear = () => { lines.length = 0; log.innerHTML = ''; };

  // ---- Claude turns: typed, voice and palette all arrive the same way ----
  const echo = (text, source) => line('prompt', 'claude › ' + (source === 'voice' ? '(voice) ' : '') + text);
  function applyItem(it) {
    if (it.k === 'text') put('claude', it.d);
    else if (it.k === 'tool') line('tool', '· ' + (it.name || 'tool') + (it.d ? ' ' + it.d : ''));
    else if (it.k === 'done') line('tool', '· ' + ((+it.ms || 0) / 1000).toFixed(1) + ' s' + (it.cost ? ' · $' + (+it.cost).toFixed(4) : ''));
    else if (it.k === 'error') line('err', it.d);
    else if (it.k === 'notice') line('sys', it.d);
  }
  async function pull(e) {
    if (!alive) return;
    const r = await ctx.api('chat?turn=' + encodeURIComponent(e.id) + '&from=' + e.have);
    if (!alive) return;
    if (!e.shown) { e.shown = true; echo(r.prompt, r.source); }
    r.items.forEach(applyItem);
    e.have += r.items.length;
    if (r.state !== e.state) { e.state = r.state; if (r.state === 'stopped') line('sys', '^C  ·  Claude stopped'); }
  }
  // one chain, so two turns never interleave and items are never applied twice
  const sync = e => { chain = chain.then(() => pull(e)).catch(() => {}); };
  const track = (id, shown) => { let e = turns.get(id); if (!e) turns.set(id, e = { id, have: 0, state: '', shown }); return e; };
  function onChat(d) {
    if (!d || !d.turn) return;
    const e = track(d.turn, posting);              // a turn that appears while we are posting is ours (already echoed)
    if (e.state === d.state && e.have === d.n) return;
    sync(e);
  }
  const claudeBusy = () => Array.from(turns.values()).some(e => e.state === 'running');
  async function ask(text) {
    posting = true;
    try {
      const r = await ctx.api('chat', { body: { text, cwd: cwd || undefined } });
      const e = track(r.turn, true); e.shown = true;
      sync(e);
    } catch (e) { line('err', e.message); }
    posting = false;
  }

  // ---- shell commands ----
  async function ndjson(resp, onEv) {
    const rd = resp.body.getReader(), dec = new TextDecoder();
    let buf = '';
    const feed = s => { s = s.trim(); if (!s) return; let ev = null; try { ev = JSON.parse(s); } catch (e) {} if (ev) onEv(ev); };
    for (;;) {
      const r = await rd.read();
      if (r.done) return feed(buf);
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
  }
  function runEvent(ev) {
    if (ev.t === 'start') { runId = ev.id; if (ev.cwd) cwd = ev.cwd; status(); }
    else if (ev.t === 'o') put('out', ev.d);
    else if (ev.t === 'e') put('err', ev.d);
    else if (ev.t === 'exit') {
      if (ev.error) line('err', ev.error);
      if (ev.cwd) cwd = ev.cwd;
      runId = null; status();
      if (ev.killed === 'timeout') line('err', 'stopped — the command outlived the time limit');
      else if (ev.killed) line('sys', 'stopped');
      else if (ev.code) line('sys', 'exit ' + ev.code + '  ·  ' + fmtMs(ev.ms));
    }
  }
  async function run(cmd) {
    if (!cmd) return;
    running = true; runId = null;
    abort = new AbortController();
    try {
      const resp = await fetch('/api/m/terminal/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify({ cmd, cwd: cwd || undefined }) });
      if (!resp.ok || !resp.body) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || 'HTTP ' + resp.status); }
      await ndjson(resp, runEvent);
    } catch (e) {
      if (e && e.name === 'AbortError') line('sys', '^C');
      else line('err', !e.message || /failed to fetch|networkerror|load failed|connection/i.test(e.message) ? 'lost the AIOS server — is it still running? (start it, then reload this page)' : e.message);
    }
    running = false; runId = null; abort = null; status();
  }
  function stop() {
    if (running) {
      if (runId) ctx.api('kill', { body: { id: runId } }).catch(() => {});   // the process tree, not just the shell
      if (abort) abort.abort();
    } else if (claudeBusy()) ctx.api('chat/stop', { body: {} }).catch(() => {});
  }

  // ---- input ----
  function submit() {
    const text = input.value;
    if (running) {                                  // Enter feeds a running command's stdin, as in a real terminal
      if (!runId) return;
      line('prompt', '› ' + text);
      input.value = '';
      ctx.api('input', { body: { id: runId, data: text + '\n' } }).catch(() => {});
      return;
    }
    const cmd = text.trim();
    line('prompt', label() + (cmd ? ' ' + cmd : ''));
    if (cmd) hist = hist.filter(h => h !== cmd).concat([cmd]).slice(-200);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) {}
    hi = -1; input.value = '';
    if (!cmd) return;
    const low = cmd.toLowerCase();
    if (low === 'clear' || low === 'cls') return clear();
    if (low === 'help' || low === '?' || low === '/help') return HELP.forEach(l => line('sys', l));
    if (low === 'new' || low === '/new') { ctx.api('chat/new', { body: {} }).catch(() => {}); return line('sys', 'next message starts a fresh Claude session'); }
    if (low === 'reset') { cwd = vault; status(); return line('sys', 'back at the vault root'); }
    if (low === 'exit' || low === '/exit' || low === 'quit') {
      if (mode === 'claude') { mode = 'sh'; status(); return line('sys', 'left Claude mode'); }
      return line('sys', 'nothing to exit — this terminal has no window to close');
    }
    if (mode === 'claude') return cmd[0] === '!' ? run(cmd.slice(1).trim()) : ask(cmd);
    if (low === 'claude') { mode = 'claude'; status(); return line('sys', 'Claude mode. Plain text goes to Claude; !cmd runs a shell command; exit or Esc comes back.'); }
    const m = /^claude\s+([\s\S]+)$/i.exec(cmd);
    if (m && m[1].trim()[0] !== '-') return ask(m[1].trim());   // `claude --version` etc. still go to the shell
    return run(cmd);
  }
  function walk(dir) {
    const n = hist.length;
    if (!n) return;
    let i = (hi < 0 ? n : hi) + dir;
    if (i < 0) i = 0;
    if (i >= n) { hi = -1; input.value = ''; return; }
    hi = i; input.value = hist[i];
  }
  const onKey = e => {
    const k = String(e.key || ''), mod = e.ctrlKey || e.metaKey;
    if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); return submit(); }
    if (k === 'ArrowUp') { e.preventDefault(); return walk(-1); }
    if (k === 'ArrowDown') { e.preventDefault(); return walk(1); }
    if (mod && k.toLowerCase() === 'c') {
      const sel = input.selectionStart !== input.selectionEnd || String(window.getSelection ? window.getSelection() : '') !== '';
      if (running || claudeBusy()) { e.preventDefault(); return stop(); }
      if (!sel) { e.preventDefault(); line('prompt', label() + ' ' + input.value + '^C'); input.value = ''; hi = -1; }
      return;
    }
    if (mod && k.toLowerCase() === 'l') { e.preventDefault(); return clear(); }
    if (k === 'Escape' && mode === 'claude' && !running && !claudeBusy()) { e.preventDefault(); e.stopPropagation(); mode = 'sh'; status(); line('sys', 'left Claude mode'); }
  };
  const onLog = () => { if (!String(window.getSelection ? window.getSelection() : '')) input.focus(); };
  const onOs = async () => {
    try { await ctx.api('launch', { body: {} }); ctx.notify('Opening a terminal at the vault'); }
    catch (e) { ctx.notify(e.message, 'error'); }
  };
  input.addEventListener('keydown', onKey);
  log.addEventListener('click', onLog);
  osBtn.addEventListener('click', onOs);
  const off = ctx.on('terminal.chat', onChat);
  status();
  input.focus();

  // ---- banner, then the turns the server kept (an answer that came while the panel was closed) ----
  (async () => {
    try {
      const [info, cl] = await Promise.all([ctx.api('info'), ctx.api('claude')]);
      if (!alive) return;
      vault = info.root || ''; cwd = vault; status();
      line('sys', 'AIOS terminal — ' + (info.shellLabel || 'shell') + ' in ' + rel(vault));
      if (cl.found) line('sys', 'claude ' + (cl.version || '') + ' found via ' + (cl.source || 'PATH') + '  ·  type  claude  to talk to it, or  help');
      else line('err', cl.hint || 'Claude Code CLI not found — shell commands still work. Set "claudeBin" in system/machine.json.');
    } catch (e) {
      if (alive) line('err', /local only/.test(e.message) ? 'Terminal unavailable from here — it runs only on the machine holding the vault.' : 'Terminal unavailable: ' + e.message);
      return;
    }
    try {
      const l = await ctx.api('chat');
      for (const t of l.turns) sync(track(t.id, false));
    } catch (e) {}
  })();

  return {
    unmount() {
      alive = false; off();
      if (abort) abort.abort();                     // the server kills a command whose stream closed
      input.removeEventListener('keydown', onKey);
      log.removeEventListener('click', onLog);
      osBtn.removeEventListener('click', onOs);
      root.innerHTML = '';
    }
  };
}
