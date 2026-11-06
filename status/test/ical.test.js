'use strict';
const fs = require('fs');
const path = require('path');
const { parseIcs, expand } = require('../ical.js');

module.exports = async function (ok) {
  const evs = parseIcs(fs.readFileSync(path.join(__dirname, 'fixtures', 'calendar.ics'), 'utf8'));
  ok('cancelled events are dropped', !evs.some(e => /Cancelled/.test(e.summary || '')));
  const occ = expand(evs, new Date('2026-10-12T00:00:00Z'), new Date('2026-10-19T00:00:00Z'));
  const timed = occ.filter(o => !o.allDay && o.summary !== 'Unknown zone').map(o => o.summary + '@' + o.start);
  ok('timed occurrences: single, TZID, weekly+BYDAY−EXDATE, daily INTERVAL+UNTIL, moved instance, MONTHLY once, escapes (Review Focus 3, 4)',
    JSON.stringify(timed) === JSON.stringify([
      'Gym@2026-10-12T12:00:00.000Z', 'Standup@2026-10-12T13:00:00.000Z', 'CICS 160 lab@2026-10-12T19:00:00.000Z',
      'Club (moved)@2026-10-12T21:00:00.000Z', 'Office hours@2026-10-13T15:00:00.000Z', 'Gym@2026-10-14T12:00:00.000Z',
      'Rent@2026-10-15T15:00:00.000Z', 'Lunch, then walk; maybe@2026-10-16T14:00:00.000Z']), JSON.stringify(timed));
  ok('end times come from DTEND', occ.find(o => o.summary === 'CICS 160 lab').end === '2026-10-12T20:15:00.000Z');
  ok('a folded SUMMARY line is joined', occ.some(o => o.summary === 'Office hours'));
  const hol = occ.find(o => o.summary === 'Holiday');
  ok('all-day event stays on its date', hol && hol.allDay === true && hol.day === '2026-10-13', JSON.stringify(hol));
  ok('an unsupported recurrence shows once, labelled repeats', occ.find(o => o.summary === 'Rent').repeats === true && occ.filter(o => o.summary === 'Rent').length === 1);
  ok('a VALARM inside an event does not change its start', occ.find(o => o.summary === 'CICS 160 lab').start === '2026-10-12T19:00:00.000Z');
  ok('an unknown TZID falls back to local time, no crash', occ.filter(o => o.summary === 'Unknown zone').length === 1);
  const dst = expand(evs, new Date('2026-10-29T00:00:00Z'), new Date('2026-11-04T00:00:00Z')).filter(o => o.summary === 'Morning run').map(o => o.start);
  ok('DST: a 09:00 New York series stays at 09:00 local (13:00Z → 14:00Z after 1 Nov), COUNT=4 (Review Focus 3)',
    JSON.stringify(dst) === JSON.stringify(['2026-10-30T13:00:00.000Z', '2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z']), JSON.stringify(dst));
  ok('empty or garbage text → no events', parseIcs('').length === 0 && parseIcs('<html>404</html>').length === 0);

  // final review fixes
  const cal = (...evs) => 'BEGIN:VCALENDAR\n' + evs.map(e => 'BEGIN:VEVENT\n' + e.join('\n') + '\nEND:VEVENT\n').join('') + 'END:VCALENDAR\n';
  const week = [new Date('2026-10-12T00:00:00Z'), new Date('2026-10-19T00:00:00Z')];
  const names = (text, from, to) => expand(parseIcs(text), from || week[0], to || week[1]).map(o => o.summary + '@' + o.start.slice(0, 10) + (o.repeats ? ' repeats' : ''));
  const cancelledOverride = cal(
    ['UID:c@aios', 'DTSTART:20261005T170000Z', 'DTEND:20261005T180000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Club'],
    ['UID:c@aios', 'RECURRENCE-ID:20261012T170000Z', 'DTSTART:20261012T170000Z', 'STATUS:CANCELLED', 'SUMMARY:Club']);
  ok('a cancelled instance of a series does not show', JSON.stringify(names(cancelledOverride)) === '[]', JSON.stringify(names(cancelledOverride)));
  const old = cal(['UID:old@aios', 'DTSTART:20120101T120000Z', 'DTEND:20120101T123000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Pills']);
  ok('a daily series started in 2012 still shows today', JSON.stringify(names(old, week[0], new Date('2026-10-13T00:00:00Z'))) === '["Pills@2026-10-12"]', JSON.stringify(names(old, week[0], new Date('2026-10-13T00:00:00Z'))));
  const many = cal(...Array.from({ length: 300 }, (_, i) => ['UID:m' + i + '@aios', 'DTSTART;TZID=America/New_York:20160104T090000', 'DTEND;TZID=America/New_York:20160104T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'SUMMARY:M' + i]));
  const t0 = Date.now(), n = expand(parseIcs(many), week[0], week[1]).length, took = Date.now() - t0;
  ok('300 open-ended series since 2016 expand quickly', n === 900 && took < 1000, n + ' in ' + took + ' ms');
  const weekdays = cal(['UID:wd@aios', 'DTSTART:20261012T120000Z', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'SUMMARY:Weekdays']);
  ok('DAILY with BYDAY is not supported: once, labelled repeats', JSON.stringify(names(weekdays)) === '["Weekdays@2026-10-12 repeats"]', JSON.stringify(names(weekdays)));
  const winter = cal(['UID:bm@aios', 'DTSTART:20261012T120000Z', 'RRULE:FREQ=WEEKLY;BYMONTH=1,2', 'SUMMARY:Winter']);
  ok('WEEKLY with BYMONTH is not supported: once, labelled repeats', JSON.stringify(names(winter)) === '["Winter@2026-10-12 repeats"]', JSON.stringify(names(winter)));
};
