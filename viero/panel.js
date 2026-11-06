// Viero panel: is the listener ready, how to use it, the last utterances (outputs/viero/log.md).
import { keyName } from './overlay.js';

const TITLE = { starting: 'Starting…', ready: 'Ready', 'needs-key': 'Needs a key', 'needs-setup': 'Needs setup', failed: 'Stopped' };
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function mount(root, ctx) {
  let data = null, error = '', alive = true;
  async function load() {
    try { data = await ctx.api('state'); error = ''; } catch (e) { error = e.message; }
    if (alive) draw();
  }
  function draw() {
    root.innerHTML = '';
    if (error) { root.append(el('div', 'error', 'Viero unavailable: ' + error)); return; }
    if (!data) { const s = el('div', 'skel'); s.style.cssText = 'height:56px;width:320px'; root.append(s); return; }
    const s = data.status;
    const head = el('section');
    head.append(el('div', 'label', 'Viero'));
    const h1 = el('h1', 'serif', TITLE[s.state] || s.state); h1.style.cssText = 'margin:8px 0 0;font-size:56px;line-height:1';
    head.append(h1);
    if (s.state === 'ready') {
      const p = el('p', 'muted'); p.style.cssText = 'margin:12px 0 0;font-size:15px';
      p.append('Hold ', el('span', 'kbd', keyName(s.key)), ' anywhere in Windows, say a command, let go. Model ' + s.model + (s.loadMs != null ? ' · loaded in ' + s.loadMs + ' ms' : '') + '.');
      head.append(p);
    }
    root.append(head);
    if (s.state === 'needs-setup') {
      const c = el('div', 'card'); c.style.padding = '18px 24px';
      c.append(el('div', 'warn', 'Run this once in a terminal, in the vault folder:'));
      const cmd = el('div', 'mono', s.setup); cmd.style.cssText = 'margin:8px 0;font-size:14px'; c.append(cmd);
      c.append(el('div', 'muted', 'Then turn Viero off and on in Modules.'));
      root.append(c);
    } else if (s.state === 'needs-key') root.append(el('div', 'warn', s.error));
    else if (s.state === 'failed') root.append(el('div', 'error', s.error));
    for (const p of s.problems || []) if (s.state === 'ready') root.append(el('div', 'warn', p));
    if (data.pending) root.append(el('div', 'muted', 'Waiting for yes / no: did you mean "' + data.pending + '"?'));

    const card = el('div', 'card'); card.style.padding = '24px 28px';
    const t = el('div', 'muted', 'Last utterances'); t.style.cssText = 'font-size:14px;margin-bottom:10px'; card.append(t);
    if (!data.recent.length) card.append(el('div', 'muted', 'Nothing said yet.'));
    for (const line of data.recent.slice().reverse()) {
      const row = el('div', 'mono', line.replace(/^- /, '')); row.style.cssText = 'font-size:12px;padding:6px 0;border-top:1px solid var(--line)';
      card.append(row);
    }
    root.append(card);
  }
  const offs = [
    ctx.on('viero.status', load),
    ctx.on('viero.state', ev => { if (ev && ['matched', 'error', 'unsure', 'confirm', 'cancelled', 'speaking'].includes(ev.state)) load(); })
  ];
  load();
  return { unmount() { alive = false; offs.forEach(off => off()); root.innerHTML = ''; } };
}
