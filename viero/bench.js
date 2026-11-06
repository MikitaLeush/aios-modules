#!/usr/bin/env node
'use strict';
/* Viero bench (spec §10): recorded clips through the full path, p50/p95 per stage.
 *   speech → text   listener.py --clips <dir>, with the same model + vocabulary prompt as live
 *   text → action   a scratch AIOS core on its own port: modes in dry run (nothing on this
 *                   computer changes), legacy off
 * Usage: node modules/viero/bench.js <dir with expected.tsv + wavs> [--model tiny.en|base.en]
 * Writes outputs/viero/bench-<model>-<dir name>.json (data for the README latency chart). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');
const py = require('./python.js');
const { whisperPrompt } = require('./config.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 4398;

function pct(values, p) {
  const s = values.slice().sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
}
function sameIntent(res, want) {
  return !!(want && res && res.matched && res.command === want.id && JSON.stringify(res.args) === JSON.stringify(want.args));
}
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request('http://127.0.0.1:' + PORT + p, {
      method, headers: Object.assign({ 'Sec-Fetch-Site': 'same-origin' }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
    }, res => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(p + ' → ' + res.statusCode + ' ' + b.slice(0, 200))); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--model');
  const dir = argv.find((a, i) => !a.startsWith('--') && (mi < 0 || i !== mi + 1));
  if (!dir || !fs.existsSync(path.join(dir, 'expected.tsv'))) {
    console.error('usage: node modules/viero/bench.js <dir with expected.tsv> [--model tiny.en|base.en]');
    process.exit(2);
  }
  const vp = py.venvPython();
  if (!fs.existsSync(vp)) { console.error('no listener venv: run ' + py.SETUP); process.exit(2); }
  let real = {};
  try { real = JSON.parse(fs.readFileSync(path.join(ROOT, 'system', 'machine.json'), 'utf8')); } catch (e) {}
  const mods = real.modules || {};
  const model = mi >= 0 ? argv[mi + 1] : ((mods.viero && mods.viero.model) || 'tiny.en');
  const scratch = path.join(os.tmpdir(), 'aios-bench-machine-' + process.pid + '.json');
  const modes = Object.assign({}, mods.modes || {}, { enabled: true, dryRun: true }); // dry run: nothing on this computer changes
  fs.writeFileSync(scratch, JSON.stringify(Object.assign({}, real, { modules: { legacy: { enabled: false }, modes } }), null, 2));
  const core = spawn(process.execPath, [path.join(ROOT, 'core', 'server.js')], { cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: Object.assign({}, process.env, { AIOS_PORT: String(PORT), AIOS_NO_SCHEDULER: '1', AIOS_MACHINE_FILE: scratch }) });
  let lst = null;
  try {
    let info = null;
    for (let i = 0; i < 60 && !info; i++) { try { info = await req('GET', '/api/core/modules'); } catch (e) { await wait(250); } }
    if (!info) throw new Error('scratch core did not start on :' + PORT);
    const prompt = whisperPrompt(info.vocabulary || []); // what server.js gives the live listener
    console.log('model ' + model + ' · clips ' + dir + '\n');
    lst = spawn(vp, [path.join(__dirname, 'listener', 'listener.py'), '--clips', dir], { windowsHide: true,
      env: Object.assign({}, process.env, { VIERO_MODEL: model, VIERO_PROMPT: prompt, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }) });
    let err = '';
    lst.stderr.on('data', c => { err = (err + c).slice(-2000); });
    const rows = [];
    for await (const line of readline.createInterface({ input: lst.stdout })) {
      let m;
      try { m = JSON.parse(line); } catch (e) { continue; }
      if (m.type === 'fatal') throw new Error(m.error);
      if (m.type !== 'heard') continue;
      const want = (await req('POST', '/api/core/match', { text: m.expected })).match;
      const t = Date.now();
      const res = await req('POST', '/api/core/run', { text: m.text, source: 'bench' });
      const rtt = Date.now() - t;
      const ms = res.ms || {};
      const row = { file: m.file, expected: m.expected, heard: m.text, ok: sameIntent(res, want), asked: !!res.suggestion,
        stt: m.sttMs, match: ms.match || 0, action: ms.action || 0 };
      row.start = row.stt + row.match; // key release → action start (spec §1, criterion 2)
      row.total = row.stt + rtt;       // + the HTTP hop and the (dry-run) action
      rows.push(row);
      console.log((row.ok ? 'ok   ' : row.asked ? 'ask  ' : 'MISS ') + row.file + '  ' + JSON.stringify(row.heard) +
        (row.ok ? '' : '  (want "' + row.expected + '")') + '  stt ' + row.stt + 'ms  start ' + row.start + 'ms');
    }
    if (!rows.length) throw new Error('listener produced nothing: ' + err.trim().split(/\r?\n/).pop());
    const stage = k => ({ p50: pct(rows.map(r => r[k]), 0.5), p95: pct(rows.map(r => r[k]), 0.95) });
    const sum = { at: new Date().toISOString(), model, clips: path.basename(path.resolve(dir)), n: rows.length,
      intentOk: rows.filter(r => r.ok).length, asked: rows.filter(r => r.asked).length,
      stt: stage('stt'), match: stage('match'), action: stage('action'), start: stage('start'), total: stage('total'), rows };
    console.log('\nintent ' + sum.intentOk + '/' + sum.n + ' (asked ' + sum.asked + ') · stt p50 ' + sum.stt.p50 + ' p95 ' + sum.stt.p95 +
      ' · match p50 ' + sum.match.p50 + ' · start p50 ' + sum.start.p50 + ' p95 ' + sum.start.p95 + ' · total p50 ' + sum.total.p50 + ' ms');
    console.log(sum.start.p50 < 1000 ? 'PASS median key-release → action start < 1.0 s' : 'FAIL median ≥ 1.0 s');
    const out = path.join(ROOT, 'outputs', 'viero', 'bench-' + model + '-' + sum.clips + '.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(sum, null, 2));
    console.log('wrote ' + path.relative(ROOT, out));
  } finally {
    if (lst) { try { lst.kill(); } catch (e) {} }
    core.kill();
    try { fs.unlinkSync(scratch); } catch (e) {}
  }
}

module.exports = { pct, sameIntent };
if (require.main === module) main().catch(e => { console.error('bench failed: ' + e.message); process.exit(1); });
