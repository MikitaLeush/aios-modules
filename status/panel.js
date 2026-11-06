// Status panel (spec §7.3, design shell/design/screens/status.html). ←/→ switch Today / Week.
import { el, longDate, cardsRow, ringClock } from './assets/cards.js';

export function mount(root, ctx) {
  let s = null, error = '', alive = true;
  root.tabIndex = 0;
  root.setAttribute('aria-label', 'Status. Left and right arrows switch today and week.');
  async function load() {
    try { s = await ctx.api('state'); error = ''; } catch (e) { error = e.message; }
    if (alive) draw();
  }
  function draw() {
    root.innerHTML = '';
    if (error) { root.append(el('div', 'error', 'Status unavailable: ' + error)); return; }
    if (!s) { const k = el('div', 'skel'); k.style.cssText = 'height:56px;width:320px'; root.append(k); return; }
    const now = new Date(s.now);
    const head = el('section'); head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:48px';
    const left = el('div'); left.style.maxWidth = '720px';
    left.append(el('div', 'label', (s.view === 'week' ? 'THIS WEEK' : 'TODAY') + ' · ← → ' + (s.view === 'week' ? 'TODAY' : 'WEEK')));
    const h1 = el('h1', 'serif', s.headline); h1.style.cssText = 'margin:14px 0 0;font-size:48px;line-height:1.05';
    left.append(h1);
    if (s.mode) { const p = el('span', 'pill pill-loaded', s.mode.charAt(0).toUpperCase() + s.mode.slice(1)); p.style.marginTop = '14px'; left.append(p); }
    const right = el('div'); right.style.textAlign = 'center';
    right.append(ringClock(now, 220), el('div', 'muted', longDate(now)));
    head.append(left, right);
    root.append(head);
    for (const p of s.problems) root.append(el('div', 'warn', 'Check modules.status in system/machine.json: ' + p));
    root.append(cardsRow(s));
  }
  const onKey = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    ctx.api('view', { body: { view: s && s.view === 'week' ? 'today' : 'week' } }).catch(err => ctx.notify(err.message, 'error'));
  };
  root.addEventListener('keydown', onKey);
  const offs = ['status.changed', 'status.view', 'modes.changed'].map(n => ctx.on(n, load));
  const tick = setInterval(load, 30000); // clock + "as of" ages
  load();
  return {
    unmount() {
      alive = false; clearInterval(tick); offs.forEach(off => off());
      root.removeEventListener('keydown', onKey); root.removeAttribute('tabindex'); root.removeAttribute('aria-label');
      root.innerHTML = '';
    }
  };
}
