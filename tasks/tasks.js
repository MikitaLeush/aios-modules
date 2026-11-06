'use strict';
/* tasks/tasks.md — the one parser and the line edits (spec amendment M6a-2). The module,
 * legacy /api/tasks* and the status due card all use these, so they can never read the
 * file differently. Rules are legacy getTasks/inlineText exactly (CLAUDE.md "Data formats"). */
const TASK_RE = /^- \[([ xX])\]\s+(.*)$/;
const NOT_A_TASK = 'not a task line — expected "- [ ] text" or "- [x] text"';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function parseTasks(text, onSkip) {
  const out = [];
  let n = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    n++;
    const m = TASK_RE.exec(line.trim());
    if (!m) {
      // catches `- [] text` (no space), `-[ ] text`, `* [ ] text`, `- [x]` with no text
      if (onSkip && /^[-*]\s*\[/.test(line.trim())) onSkip(n, line, NOT_A_TASK);
      continue;
    }
    const raw = m[2];
    out.push({
      i: out.length, // 0-based index among task lines — what toggle counts
      done: m[1] !== ' ',
      raw: line.trim(),
      text: raw.replace(/!p[123]/g, '').replace(/@\d{4}-\d{2}-\d{2}/g, '').replace(/#[\w-]+/g, '').trim(),
      priority: (raw.match(/!p([123])/) || [])[1] || null,
      due: (raw.match(/@(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
      tags: (raw.match(/#[\w-]+/g) || []).map(t => t.slice(1))
    });
  }
  return out;
}

function formatTask(d) {
  d = d || {};
  // a newline inside the text would split the line and the task would vanish from every reader
  const text = String(d.text == null ? '' : d.text).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return null;
  let line = '- [ ] ' + text;
  if (/^[123]$/.test(String(d.priority || ''))) line += ' !p' + d.priority;
  if (isDate(d.due)) line += ' @' + d.due;
  for (const t of (Array.isArray(d.tags) ? d.tags : [])) {
    const tag = String(t || '').replace(/[^\w-]/g, '');
    if (tag) line += ' #' + tag;
  }
  return line;
}

function toggleTask(text, index, raw) {
  const lines = String(text || '').split(/\r?\n/);
  let ti = -1, li = -1;
  for (let k = 0; k < lines.length; k++) { // same rule as parseTasks, so indexes always agree
    if (TASK_RE.test(lines[k].trim()) && ++ti === index) { li = k; break; }
  }
  if (li < 0) return { status: 404, error: 'task not found (file changed?)' };
  if (raw && lines[li].trim() !== raw) return { status: 409, error: 'task list changed — refresh and retry' };
  lines[li] = /\[ \]/.test(lines[li]) ? lines[li].replace('[ ]', '[x]') : lines[li].replace(/\[[xX]\]/, '[ ]');
  return { text: lines.join('\n') };
}

function archiveDone(text, day) {
  const kept = [], archived = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = TASK_RE.exec(line.trim());
    if (m && m[1] !== ' ') archived.push(line.trim() + ' (archived ' + day + ')');
    else kept.push(line);
  }
  return { text: kept.join('\n'), archived };
}

module.exports = { parseTasks, formatTask, toggleTask, archiveDone };
