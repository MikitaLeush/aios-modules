'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatLine, appendLine, tail } = require('../log.js');

module.exports = async function (ok) {
  const at = new Date(2026, 9, 12, 14, 3, 22);
  ok('line matches spec §5.7', formatLine({ at, text: 'game mode', command: 'modes.switch', result: 'ok', sttMs: 420, matchMs: 3, actionMs: 610, totalMs: 1033 }) ===
    '- [2026-10-12 14:03:22] game mode | modes.switch | ok | stt 420ms match 3ms action 610ms | total 1033ms');
  ok('pipes and newlines never reach a field', formatLine({ at, text: 'a | b\nc', command: 'x', result: 'ok', totalMs: 1 }) === '- [2026-10-12 14:03:22] a b c | x | ok | - | total 1ms',
    formatLine({ at, text: 'a | b\nc', command: 'x', result: 'ok', totalMs: 1 }));
  ok('missing stage times are left out', formatLine({ at, text: '(silence)', command: '-', result: 'empty', sttMs: 80, totalMs: 80 }) === '- [2026-10-12 14:03:22] (silence) | - | empty | stt 80ms | total 80ms');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-viero-log-'));
  const file = path.join(dir, 'sub', 'log.md');
  appendLine(file, '- [a] one');
  fs.appendFileSync(file, 'not a log line\n');
  appendLine(file, '- [b] two');
  appendLine(file, '- [c] three');
  ok('appendLine creates the folder; tail keeps the last log lines, oldest first', JSON.stringify(tail(file, 2)) === '["- [b] two","- [c] three"]', JSON.stringify(tail(file, 2)));
  ok('tail of a missing file is empty', tail(path.join(dir, 'nope.md'), 5).length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
};
