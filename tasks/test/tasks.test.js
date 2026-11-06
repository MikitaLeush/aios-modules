'use strict';
const { parseTasks, formatTask, toggleTask, archiveDone } = require('../tasks.js');

const TXT = ['# Tasks', '- [ ] Buy milk !p1 @2026-10-12 #home', '- [x] Call the dentist', '- [] broken', 'some prose', '  - [ ] Indented one', '* [ ] star broken', '- [X] Done caps #a-b'].join('\r\n');
const WHY = 'not a task line — expected "- [ ] text" or "- [x] text"';

module.exports = async function (ok) {
  const t = parseTasks(TXT);
  ok('parses legacy fields', t.length === 4 &&
    JSON.stringify(t[0]) === JSON.stringify({ i: 0, done: false, raw: '- [ ] Buy milk !p1 @2026-10-12 #home', text: 'Buy milk', priority: '1', due: '2026-10-12', tags: ['home'] }) &&
    t[2].raw === '- [ ] Indented one' && t[3].done === true, JSON.stringify(t));

  const skips = [];
  parseTasks(TXT, (n, line, why) => skips.push([n, line, why]));
  ok('skip callback gets line numbers', JSON.stringify(skips) === JSON.stringify([[4, '- [] broken', WHY], [7, '* [ ] star broken', WHY]]), JSON.stringify(skips));

  const drift = toggleTask('- [x]\n- [ ] A\n- [ ] B', 1, '- [ ] B');
  ok('index drift: a "- [x]" with no text no longer shifts indexes', drift.text === '- [x]\n- [ ] A\n- [x] B', JSON.stringify(drift));

  const lines = s => s.split('\n');
  ok('toggle flips both ways and keeps indentation',
    lines(toggleTask(TXT, 2).text)[5] === '  - [x] Indented one' && lines(toggleTask(TXT, 3).text)[7] === '- [ ] Done caps #a-b');

  const stale = toggleTask(TXT, 0, '- [ ] Something else'), gone = toggleTask(TXT, 9);
  ok('toggle with a stale raw is 409, out of range is 404',
    stale.status === 409 && stale.error === 'task list changed — refresh and retry' && gone.status === 404 && gone.error === 'task not found (file changed?)',
    JSON.stringify([stale, gone]));

  ok('format: cleans text, keeps only valid markers',
    formatTask({ text: ' Call\nthe  dentist ', priority: 1, due: '2026-11-02', tags: ['work', 'b ig!'] }) === '- [ ] Call the dentist !p1 @2026-11-02 #work #big' &&
    formatTask({ text: 'x', priority: '4', due: '2026-1-2' }) === '- [ ] x' &&
    formatTask({ text: '  \n ' }) === null &&
    formatTask({ text: 'a'.repeat(600) }) === '- [ ] ' + 'a'.repeat(500));

  const a = archiveDone(TXT, '2026-10-28');
  ok('archive keeps headings, prose and broken lines in order',
    JSON.stringify(a.archived) === JSON.stringify(['- [x] Call the dentist (archived 2026-10-28)', '- [X] Done caps #a-b (archived 2026-10-28)']) &&
    a.text === ['# Tasks', '- [ ] Buy milk !p1 @2026-10-12 #home', '- [] broken', 'some prose', '  - [ ] Indented one', '* [ ] star broken'].join('\n'),
    JSON.stringify(a));

  const none = archiveDone('# T\r\n- [ ] open', '2026-10-28');
  ok('archive with nothing done changes nothing', none.archived.length === 0 && none.text === '# T\n- [ ] open', JSON.stringify(none));

  ok('status due parser is the tasks parser', require('../../status/due.js').parseTasks === parseTasks);
};
