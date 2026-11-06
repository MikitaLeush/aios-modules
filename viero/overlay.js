// Viero's bubble in data-slot="overlay" (ui-spec §4.2; design shell/design/screens/viero-states.html,
// classes from theme.css). Driven by the viero.state event; Yes/No answer an open question.
const NAMES = { scroll_lock: 'Scroll Lock', page_up: 'Page Up', page_down: 'Page Down', num_lock: 'Num Lock', caps_lock: 'Caps Lock',
  ctrl_r: 'Right Ctrl', shift_r: 'Right Shift', pause: 'Pause', insert: 'Insert', menu: 'Menu', home: 'Home', end: 'End' };
export const keyName = k => NAMES[k] || String(k || '').toUpperCase();

// Event → what to draw. Pure (unit-tested). null = nothing on screen.
export function view(ev) {
  const t = ev && ev.text ? String(ev.text) : '';
  const key = keyName(ev && ev.key);
  switch (ev && ev.state) {
    case 'listening': return { cls: 'bubble', phase: 'Listening', text: 'Listening…', levels: true, key };
    case 'transcribing': return { cls: 'bubble', phase: 'Transcribing', text: '…', spin: true };
    case 'heard': return { cls: 'bubble', phase: 'Transcribing', text: t || '…', spin: true };
    case 'matched': return { cls: 'bubble', phase: 'Matched', text: t, check: true, hideMs: 1000 };
    case 'unsure': return { cls: 'bubble', phase: 'Did you mean', text: t + '?', hint: 'Say yes or press ' + key + '.', ask: true, hideMs: 10000 };
    case 'confirm': return { cls: 'bubble bubble-warn', phase: 'Confirm', text: t, hint: 'Say yes or press ' + key + '.', ask: true, hideMs: 10000 };
    case 'speaking': return { cls: 'bubble', phase: 'Viero', text: t, hideMs: 5000 };
    case 'cancelled': return { cls: 'bubble bubble-quiet', text: 'Cancelled', hideMs: 1500 };
    case 'error': return { cls: 'bubble bubble-quiet', text: t || "Didn't catch that", hideMs: 2000 };
    case 'unavailable': return { cls: 'bubble bubble-warn', phase: 'Unavailable', text: t || 'Viero is unavailable', link: true, hideMs: 8000 };
    default: return null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export function mount(root, ctx) {
  let timer = null, asking = false;
  root.setAttribute('aria-live', 'polite'); // one live region for every bubble, so screen readers hear each change
  const hide = () => { clearTimeout(timer); asking = false; root.innerHTML = ''; };
  const answer = yes => { hide(); ctx.api('answer', { body: { yes } }).catch(e => ctx.notify(e.message, 'error')); };
  const dismiss = () => (asking ? answer(false) : hide()); // closing a question means "no", or a stray tap would still run it

  function draw(v) {
    hide();
    if (!v) return;
    asking = !!v.ask;
    const b = el('div', v.cls);
    if (v.ask) { b.setAttribute('role', 'alert'); b.setAttribute('aria-label', (v.phase || '') + ': ' + v.text); }
    if (v.levels) { const lv = el('div', 'levels'); lv.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 5; i++) lv.append(el('span')); b.append(lv); }
    if (v.spin) { const s = el('span', 'spin'); s.setAttribute('aria-hidden', 'true'); b.append(s); }
    if (v.check) {
      const c = el('span'); c.innerHTML = CHECK;
      c.style.cssText = 'width:32px;height:32px;border-radius:50%;background:var(--accent-tint);color:var(--accent);display:grid;place-items:center;flex-shrink:0';
      b.append(c);
    }
    const body = el('div'); body.style.flex = '1';
    if (v.phase) body.append(el('div', 'bubble-phase', v.phase));
    body.append(el('div', v.phase ? 'bubble-text' : 'muted', v.text));
    if (v.hint) { const h = el('div', 'muted', v.hint); h.style.cssText = 'font-size:13px;margin-top:2px'; body.append(h); }
    if (v.ask) {
      const row = el('div'); row.style.cssText = 'display:flex;gap:8px;margin-top:12px';
      const yes = el('button', 'btn btn-sm btn-primary', 'Yes'); yes.type = 'button'; yes.addEventListener('click', () => answer(true));
      const no = el('button', 'btn btn-sm', 'No'); no.type = 'button'; no.addEventListener('click', () => answer(false));
      row.append(yes, no); body.append(row);
    }
    if (v.link) {
      const a = el('a', null, 'Open Viero'); a.href = '#viero';
      a.addEventListener('click', e => { e.preventDefault(); hide(); const nav = document.querySelector('[data-module="viero"]'); if (nav) nav.click(); });
      body.append(a);
    }
    b.append(body);
    if (v.key) b.append(el('span', 'kbd', v.key));
    root.append(b);
    if (v.hideMs) timer = setTimeout(hide, v.hideMs);
  }

  const off = ctx.on('viero.state', ev => draw(view(ev)));
  const onKey = e => { if (e.key === 'Escape' && root.firstChild) dismiss(); };
  const onClick = e => { if (root.firstChild && !root.contains(e.target)) dismiss(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);
  return {
    unmount() {
      off();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      hide();
    }
  };
}
