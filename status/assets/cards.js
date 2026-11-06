// Status cards, shared by the shell panel and the full-screen /status page (design:
// shell/design/screens/status.html + status-fullscreen.html, classes from theme.css).
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const pad = n => String(n).padStart(2, '0');
export const clock = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const longDate = d => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); // "Monday 12 October"
const shortDate = day => new Date(day + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const weekdayShort = d => d.toLocaleDateString('en-GB', { weekday: 'short' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dayOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); // local, like ical.js "day"
// Is the event on (overlapping) local day d? Multi-day and overnight events count on every day they touch.
export function onDay(e, d) {
  const lo = new Date(d.getFullYear(), d.getMonth(), d.getDate()), hi = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (e.allDay) return e.day <= dayOf(d) && dayOf(d) < dayOf(new Date(e.end));
  const s = new Date(e.start), end = new Date(e.end);
  return s < hi && (end > lo || s >= lo);
}

function shell(title, card, count) {
  const c = el('div', 'card');
  const cap = el('div'); cap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
  cap.append(el('span', 'muted', title));
  if (card.state === 'stale' && card.asOf) cap.append(el('span', 'stale', 'as of ' + clock(new Date(card.asOf))));
  else if (count != null) cap.append(el('span', 'mono muted', String(count)));
  c.append(cap);
  if (card.state === 'loading') { const s = el('div', 'skel'); s.style.height = '80px'; c.append(s); }
  return c;
}
const why = (c, card) => { if (card.error) c.append(el('div', card.state === 'error' ? 'warn' : 'muted', card.error)); };

function dueCard(card, view) {
  const d = card.data;
  const items = d ? d.overdue.map(t => [t, 'overdue']).concat(d.today.map(t => [t, 'today']), view === 'week' ? d.week.map(t => [t, 'week']) : []) : [];
  const c = shell('Due', card, d ? items.length : null);
  if (d && !items.length) c.append(el('div', 'empty', 'Clear — nothing due'));
  const list = el('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:18px';
  for (const [t, kind] of items) {
    const row = el('div'); row.style.cssText = 'display:flex;gap:14px;align-items:baseline';
    const dot = el('span'); dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = 'width:.5em;height:.5em;border-radius:50%;flex-shrink:0;' + (kind === 'overdue' ? 'background:var(--error)'
      : kind === 'today' ? 'background:var(--accent);box-shadow:0 0 8px var(--accent)' : 'border:1px solid var(--muted)');
    const body = el('div');
    body.append(el('div', null, t.text));
    const sub = kind === 'overdue' ? 'Overdue · since ' + shortDate(t.due) : (kind === 'today' ? 'Today' : weekdayShort(new Date(t.due + 'T12:00'))) + (t.priority ? ' · p' + t.priority : '');
    const s = el('div', kind === 'overdue' ? null : 'muted', sub); s.style.cssText = 'font-size:.85em;margin-top:3px' + (kind === 'overdue' ? ';color:var(--error)' : '');
    body.append(s);
    row.append(dot, body);
    list.append(row);
  }
  c.append(list);
  why(c, card);
  return c;
}

function weatherCard(card, place) {
  const c = shell('Weather', card);
  const w = card.data;
  if (w) {
    const t = el('div', 'serif', w.temp + '°'); t.style.cssText = 'font-size:2.6em;line-height:1';
    c.append(t, el('div', 'muted', w.text + (place ? ', ' + place : '')));
    const strip = el('div', 'mono'); strip.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:22px;font-size:.8em';
    for (const h of [w.hours[0], w.hours[3], w.hours[6]].filter(Boolean)) {
      const slot = el('div'); slot.style.cssText = 'border-radius:12px;padding:8px 10px;background:' + (h.rain ? 'var(--accent-tint)' : 'var(--raised)');
      slot.append(el('div', 'muted', h.time), el('div', null, h.temp + '°' + (h.rain ? ' rain' : '')));
      strip.append(slot);
    }
    c.append(strip);
  }
  why(c, card);
  return c;
}

function calendarCard(card, view, now) {
  const c = shell('Calendar', card);
  const cal = card.data;
  if (cal) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const evs = cal.events.filter(e => view === 'week' || [now, tomorrow].some(d => onDay(e, d)));
    if (!evs.length) c.append(el('div', 'muted', 'Nothing on the calendar'));
    for (const e of evs) {
      const s = new Date(e.start);
      const when = (sameDay(s, now) ? '' : weekdayShort(s) + ' ') + (e.allDay ? 'all day' : clock(s) + (e.end !== e.start && sameDay(new Date(e.end), s) ? '–' + clock(new Date(e.end)) : ''));
      const row = el('div'); row.style.cssText = 'display:grid;grid-template-columns:7.5em 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line)';
      row.append(el('span', 'mono muted', when), el('span', null, e.summary + (e.repeats ? ' · repeats' : '')));
      c.append(row);
    }
  }
  why(c, card);
  return c;
}

export function cardsRow(s) {
  const now = new Date(s.now);
  const row = el('section');
  row.style.cssText = 'display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:20px;align-items:start';
  row.append(dueCard(s.cards.due, s.view), weatherCard(s.cards.weather, s.place), calendarCard(s.cards.calendar, s.view, now));
  return row;
}

// The clock ring from the design: a sweep hand over a progress arc for the minute.
export function ringClock(now, size) {
  const r = size / 2 - 14, len = 2 * Math.PI * r, frac = now.getSeconds() / 60;
  const box = el('div', 'ring-clock'); box.style.cssText = 'width:' + size + 'px;height:' + size + 'px';
  box.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="2"/>' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' +
    (len * frac).toFixed(0) + ' ' + len.toFixed(0) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
    '<g class="sweep"><line x1="' + size / 2 + '" y1="' + size / 2 + '" x2="' + size / 2 + '" y2="' + (size / 2 - r + 14) + '" stroke="var(--accent-tint)" stroke-width="1" stroke-linecap="round"/></g></svg>';
  const face = el('div'); face.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center';
  const t = el('div', 'serif', clock(now)); t.style.cssText = 'font-size:' + Math.round(size * 0.29) + 'px;line-height:.9;font-variant-numeric:tabular-nums';
  face.append(t);
  box.append(face);
  return box;
}
