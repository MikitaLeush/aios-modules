'use strict';
/* outputs/viero/log.md — one line per utterance (spec §5.7). No "|" or newline inside a field. */
const fs = require('fs');
const path = require('path');

const clean = s => String(s == null ? '' : s).replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
function stamp(at) {
  const d = new Date(at);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
const stage = (label, v) => (typeof v === 'number' && isFinite(v) ? label + ' ' + Math.round(v) + 'ms' : null);

function formatLine(e) {
  const times = [stage('stt', e.sttMs), stage('match', e.matchMs), stage('action', e.actionMs)].filter(Boolean).join(' ') || '-';
  return '- [' + stamp(e.at) + '] ' + (clean(e.text) || '-') + ' | ' + (clean(e.command) || '-') + ' | ' + (clean(e.result) || '-') +
    ' | ' + times + ' | total ' + Math.round(e.totalMs || 0) + 'ms';
}
function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
}
function tail(file, n) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.startsWith('- [')).slice(-n); } catch (e) { return []; }
}

module.exports = { formatLine, appendLine, tail };
