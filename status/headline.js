'use strict';
/* Rule-based headline and spoken answers from the cards (spec §7.2, §7.4) — no AI cost. The
 * same answer functions are what Viero v2 will use. Pure: state and now are passed in. */
const pad = n => String(n).padStart(2, '0');
const hhmm = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const list = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

function nextEvent(s, now) {
  const cal = s.cards.calendar.data;
  return cal ? cal.events.find(e => !e.allDay && new Date(e.start) >= now) || null : null;
}

function headline(s, now) {
  const parts = [];
  const due = s.cards.due.data;
  if (due) {
    const bits = [];
    if (due.overdue.length) bits.push(due.overdue.length + ' overdue');
    if (due.today.length) bits.push(due.today.length + ' due today');
    parts.push(bits.join(', ') || 'nothing due today');
  }
  const next = nextEvent(s, now);
  if (next && sameDay(new Date(next.start), now)) parts.push('next ' + hhmm(next.start) + ' ' + next.summary);
  const w = s.cards.weather.data;
  if (w && w.rainFrom) parts.push(w.hours[0] && w.hours[0].rain ? 'rain now' : 'rain from ' + w.rainFrom);
  return parts.join(' · ') || 'Status';
}

function sayDue(s) {
  const c = s.cards.due;
  if (!c.data) return 'No task list: ' + c.error + '.';
  const d = c.data;
  if (!d.overdue.length && !d.today.length) return 'Nothing due today.' + (d.week.length ? ' ' + d.week.length + ' later this week.' : '');
  const names = d.today.slice(0, 3).map(t => t.text);
  const more = d.today.length > 3 ? ' and ' + (d.today.length - 3) + ' more' : '';
  return (d.today.length ? d.today.length + ' due today: ' + list(names) + more + '.' : 'Nothing due today.') +
    (d.overdue.length ? ' ' + d.overdue.length + ' overdue.' : '');
}

function sayWeather(s) {
  const c = s.cards.weather;
  if (!c.data) return 'No weather: ' + c.error + '.';
  const w = c.data;
  return 'It is ' + w.temp + ' degrees and ' + w.text + '.' +
    (w.rainFrom ? (w.hours[0] && w.hours[0].rain ? ' Raining now.' : ' Rain from ' + w.rainFrom + '.') : ' No rain in the next 12 hours.');
}

function sayNext(s, now) {
  const c = s.cards.calendar;
  if (!c.data) return 'No calendar: ' + c.error + '.';
  const e = nextEvent(s, now);
  if (!e) return 'Nothing else on the calendar this week.';
  const d = new Date(e.start), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = sameDay(d, now) ? 'today' : sameDay(d, tomorrow) ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' });
  return 'Next: ' + e.summary + ', ' + day + ' at ' + hhmm(e.start) + '.';
}

module.exports = { headline, sayDue, sayWeather, sayNext };
