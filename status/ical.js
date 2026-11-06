'use strict';
/* iCalendar → events for the Status calendar card (spec §7.1). v1 covers single events, RRULE
 * FREQ=DAILY|WEEKLY (+ BYDAY, UNTIL, COUNT, INTERVAL), EXDATE, TZID times, all-day events,
 * cancelled events and moved instances (RECURRENCE-ID). Any other recurrence shows once, at its
 * start, labelled "repeats", rather than on wrong dates. Pure: no I/O. */
const DAY = 86400000;
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const pad = n => String(n).padStart(2, '0');

const fmts = new Map();
function offset(ms, tz) { // the zone's offset from UTC at that instant, in ms
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmts.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
// Wall-clock time in a zone → epoch ms. tz: 'UTC', an IANA name, or null (this computer's local time).
function wallToMs(w, tz) {
  if (tz === 'UTC') return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (tz) {
    try {
      const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
      const first = guess - offset(guess, tz);
      return guess - offset(first, tz); // second pass settles the hour around a DST change
    } catch (e) { /* unknown zone name: use local time below */ }
  }
  return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime();
}
const ms = t => (t.allDay ? new Date(t.w.y, t.w.m - 1, t.w.d).getTime() : wallToMs(t.w, t.tz));

function parseTime(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const allDay = !m[4];
  return { w: { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) }, allDay, tz: allDay ? null : (m[7] ? 'UTC' : (params.TZID || null)) };
}
function parseDuration(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  return m ? ((((+m[1] || 0) * 7 + (+m[2] || 0)) * 24 + (+m[3] || 0)) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000 : 0;
}
const unescapeText = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

function parseIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null, depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; depth = 0; continue; }
    if (!ev) continue;
    if (line === 'END:VEVENT' && !depth) { events.push(ev); ev = null; continue; }
    if (/^BEGIN:/.test(line)) { depth++; continue; } // e.g. VALARM inside the event
    if (/^END:/.test(line)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i).split(';'), value = line.slice(i + 1);
    const name = head[0].toUpperCase(), params = {};
    for (const p of head.slice(1)) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
    if (name === 'DTSTART') ev.start = parseTime(value, params);
    else if (name === 'DTEND') ev.end = parseTime(value, params);
    else if (name === 'DURATION') ev.duration = parseDuration(value);
    else if (name === 'SUMMARY') ev.summary = unescapeText(value);
    else if (name === 'UID') ev.uid = value;
    else if (name === 'STATUS') ev.status = value.toUpperCase();
    else if (name === 'RECURRENCE-ID') ev.recurrenceId = parseTime(value, params);
    else if (name === 'RRULE') {
      ev.rrule = {};
      for (const kv of value.split(';')) { const k = kv.indexOf('='); if (k > 0) ev.rrule[kv.slice(0, k).toUpperCase()] = kv.slice(k + 1); }
    } else if (name === 'EXDATE') for (const v of value.split(',')) { const t = parseTime(v, params); if (t) ev.exdates.push(t); }
  }
  // a cancelled override (RECURRENCE-ID) stays: expand needs it to hide that instance of its series
  return events.filter(e => e.start && (e.status !== 'CANCELLED' || e.recurrenceId));
}
// Rule parts expand() understands; anything else shows once, labelled "repeats" (spec §7.1).
const SUPPORTED = { DAILY: ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST'], WEEKLY: ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY'] };

const shift = (w, n) => {
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return Object.assign({}, w, { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
};
const weekday = w => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
const dayKey = w => w.y * 10000 + w.m * 100 + w.d;
const isoDay = w => w.y + '-' + pad(w.m) + '-' + pad(w.d);

function expand(events, from, to) {
  const lo = +from, hi = +to, out = [];
  const moved = new Set(events.filter(e => e.recurrenceId && e.uid).map(e => e.uid + '|' + ms(e.recurrenceId)));
  for (const e of events) {
    const len = e.end ? ms(e.end) - ms(e.start) : (e.duration || (e.start.allDay ? DAY : 0));
    const ex = new Set(e.exdates.map(ms));
    const series = !!e.rrule && !e.recurrenceId;
    const push = (w, repeats, s) => {
      if (s === undefined) s = ms({ w, allDay: e.start.allDay, tz: e.start.tz });
      if (e.status === 'CANCELLED' || ex.has(s) || (series && e.uid && moved.has(e.uid + '|' + s))) return;
      if (s + Math.max(len, 1) <= lo || s >= hi) return; // must overlap [from, to)
      out.push({ summary: e.summary || '(no title)', start: new Date(s).toISOString(), end: new Date(s + len).toISOString(),
        allDay: e.start.allDay, day: e.start.allDay ? isoDay(w) : undefined, repeats: !!repeats });
    };
    const r = e.rrule;
    if (!series) { push(e.start.w, false); continue; }
    const known = SUPPORTED[r.FREQ];
    if (!known || Object.keys(r).some(k => known.indexOf(k) < 0)) { push(e.start.w, true); continue; }
    const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
    const count = parseInt(r.COUNT, 10) || Infinity;
    const u = r.UNTIL ? parseTime(r.UNTIL, {}) : null;
    const until = u ? (u.allDay ? ms(u) + DAY - 1 : ms(u)) : Infinity;
    const days = r.FREQ === 'WEEKLY'
      ? (r.BYDAY ? r.BYDAY.split(',').map(x => WD.indexOf(x.trim().slice(-2).toUpperCase())).filter(x => x >= 0) : [weekday(e.start.w)])
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Monday first (WKST=MO)
      : null;
    const startKey = dayKey(e.start.w);
    // Without COUNT nothing before the window matters: jump to just before it, so a series
    // started years ago neither runs out of steps nor costs a walk from its first day.
    const stepDays = (days ? 7 : 1) * interval;
    const first = count === Infinity ? Math.max(0, Math.floor((lo - ms(e.start) - len) / (stepDays * DAY)) - 1) : 0;
    let n = 0, done = false;
    for (let step = first; step < first + 5000 && !done; step++) {
      const cands = days
        ? days.map(d => shift(e.start.w, -((weekday(e.start.w) + 6) % 7) + step * 7 * interval + (d + 6) % 7))
        : [shift(e.start.w, step * interval)];
      for (const w of cands) {
        if (dayKey(w) < startKey) continue;
        const s = ms({ w, allDay: e.start.allDay, tz: e.start.tz });
        if (s > until || s >= hi || n >= count) { done = true; break; }
        n++; // COUNT counts occurrences before EXDATE removes any (RFC 5545)
        push(w, false, s);
      }
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

module.exports = { parseIcs, expand };
