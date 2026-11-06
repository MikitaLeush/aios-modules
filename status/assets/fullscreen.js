// Full-screen /status (spec §7.3, design status-fullscreen.html): big type, dark, nothing to click.
// ←/→ switch Today / Week (the no-mic fallback). On the LAN, open /status?t=<token>.
import { el, longDate, cardsRow, ringClock } from './cards.js';

const q = new URLSearchParams(location.search).get('t');
if (q) { try { sessionStorage.setItem('aios-token', q); } catch (e) {} }
let token = q || '';
try { token = token || sessionStorage.getItem('aios-token') || ''; } catch (e) {}
const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'x-aios-token': token } : {});
const root = document.getElementById('status');
let s = null;

async function load() {
  try {
    const r = await fetch('/api/m/status/state', { headers });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status); // e.g. on the LAN without ?t=<token>
    s = body;
  } catch (e) { root.textContent = 'Status unavailable: ' + e.message; return; }
  draw();
}
function draw() {
  root.innerHTML = '';
  const now = new Date(s.now);
  const top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  top.append(el('span', 'muted', longDate(now)));
  if (s.mode) top.append(el('span', 'pill pill-loaded', s.mode.charAt(0).toUpperCase() + s.mode.slice(1)));
  const mid = el('div'); mid.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:80px;margin:40px 0';
  const h1 = el('h1', 'serif', s.headline); h1.style.cssText = 'margin:0;font-size:clamp(48px,6.8vw,132px);line-height:1;max-width:70%';
  mid.append(h1, ringClock(now, 320));
  root.append(top, mid, cardsRow(s));
}
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  fetch('/api/m/status/view', { method: 'POST', headers, body: JSON.stringify({ view: s && s.view === 'week' ? 'today' : 'week' }) });
});
const es = new EventSource('/api/events' + (token ? '?t=' + encodeURIComponent(token) : ''));
es.onmessage = m => { try { const ev = JSON.parse(m.data); if (/^(status\.|modes\.changed)/.test(ev.name)) load(); } catch (e) {} };
setInterval(load, 30000);
load();
