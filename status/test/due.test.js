'use strict';
const { parseTasks, dueBuckets, localDate, addDays } = require('../due.js');

const TXT = [
  '# Tasks',
  '- [ ] Old thing !p2 @2026-10-01 #x',
  '- [ ] Push commits !p1 @2026-10-12',
  '- [ ] Later thing !p3 @2026-10-15',
  '- [ ] Far away @2026-11-30',
  '- [x] Done today @2026-10-12',
  '- [ ] No date',
  '- [] broken line @2026-10-12',
  '- [ ] Low today !p3 @2026-10-12',
  '- [ ] Edge of the week @2026-10-18'
].join('\n');

module.exports = async function (ok) {
  const t = parseTasks(TXT);
  ok('parses like the dashboard: 8 task lines, the broken one skipped', t.length === 8, String(t.length));
  ok('fields: text without markers, priority, due, done, tags', t[1].text === 'Push commits' && t[1].priority === '1' && t[1].due === '2026-10-12' && t[4].done === true && t[0].tags[0] === 'x');
  const b = dueBuckets(t, '2026-10-12');
  ok('overdue', b.overdue.map(x => x.text).join('|') === 'Old thing');
  ok('today: p1 first, done ones left out', b.today.map(x => x.text).join('|') === 'Push commits|Low today');
  ok('this week = the next 6 days', b.week.map(x => x.text).join('|') === 'Later thing|Edge of the week');
  ok('undated and far tasks are not due', ![].concat(b.overdue, b.today, b.week).some(x => /No date|Far away/.test(x.text)));
  ok('addDays crosses months', addDays('2026-10-30', 3) === '2026-11-02');
  ok('localDate is YYYY-MM-DD in local time', localDate(new Date(2026, 9, 12, 23, 59)) === '2026-10-12');
};
