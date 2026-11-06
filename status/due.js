'use strict';
/* tasks/tasks.md → the Due card (spec §7.1). The parser is the tasks module's (M6a), used as a
 * plain library, so this card, the Tasks panel and legacy read the same tasks. */
const { parseTasks } = require('../tasks/tasks.js');
const pad = n => String(n).padStart(2, '0');
const localDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

function dueBuckets(tasks, today) {
  const end = addDays(today, 6);
  const pick = test => tasks.filter(t => !t.done && t.due && test(t.due))
    .map(t => ({ text: t.text, due: t.due, priority: t.priority }))
    .sort((a, b) => (a.priority || '9').localeCompare(b.priority || '9') || a.due.localeCompare(b.due));
  return { overdue: pick(d => d < today), today: pick(d => d === today), week: pick(d => d > today && d <= end) };
}

module.exports = { parseTasks, dueBuckets, localDate, addDays };
