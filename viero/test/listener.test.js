'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const py = require('../python.js');
const { normalize } = require('../../../core/commands.js');

const LISTENER = path.join(__dirname, '..', 'listener', 'listener.py');
const runP = (cmd, args, opts) => new Promise(res => execFile(cmd, args, Object.assign({ encoding: 'utf8', timeout: 180000, windowsHide: true }, opts),
  (e, so, se) => res({ code: e ? e.code : 0, out: so || '', err: se || '' })));
const lines = out => out.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });

module.exports = async function (ok) {
  const src = fs.readFileSync(LISTENER, 'utf8');
  ok('listener never opens a network port (stdin/stdout only) (Review Focus 5)', !/\b(socket|urllib|http\.client|requests|websocket)\b/.test(src));
  ok('mic stream is opened on key-down and closed on key-up', /def press[\s\S]*open_stream[\s\S]*def release[\s\S]*_close\(\)/.test(src) && /InputStream/.test(src));
  // the default fallback retries at temperatures 0.2..1.0 with 5 samples each: 0.7-4 s on unclear audio
  ok('speech-to-text decodes once (temperature 0, no fallback retries)', /model\.transcribe\([^)]*temperature=0(\.0)?[,)]/.test(src));
  ok('make-clips.ps1 is plain ASCII', fs.readFileSync(path.join(__dirname, '..', 'make-clips.ps1')).every(b => b < 128));

  const vp = py.venvPython();
  if (process.platform !== 'win32' || !fs.existsSync(vp)) { console.log('  skip listener runs (no venv at ' + vp + ': ' + py.SETUP + ')'); return; }
  const chk = lines((await runP(vp, [LISTENER, '--check'])).out);
  ok('--check: every listener package is installed (Review Focus 4)', chk.some(m => m.type === 'ok'), JSON.stringify(chk));

  // key → mic state machine and the transcription job (final review findings 3, 4, 5)
  const rc = await runP(vp, [path.join(__dirname, 'recorder_check.py')]);
  let rs = {};
  try { rs = JSON.parse(rc.out.trim().split(/\r?\n/).pop()); } catch (e) {}
  ok('busy mic: one error per key press, not one per auto-repeat', rs.busy_mic_one_error === true, rc.out.slice(-300) + rc.err.slice(-300));
  ok('a tap closes the mic and sends tap, no audio', rs.tap === true);
  ok('one press = one stream = one utterance', rs.utterance === true);
  ok('the mic closes on its own after 15 s; the late key-up adds nothing', rs.cap === true);
  ok('a transcription error is reported and the worker keeps going', rs.job_survives === true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-viero-clips-'));
  await runP('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'make-clips.ps1'), '-Out', dir, '-Phrases', 'game mode;open spotify']);
  const r = await runP(vp, [LISTENER, '--clips', dir], { env: Object.assign({}, process.env, { VIERO_MODEL: 'tiny.en', VIERO_PROMPT: 'game mode, open spotify', PYTHONIOENCODING: 'utf-8' }) });
  const heard = lines(r.out).filter(m => m.type === 'heard');
  ok('--clips transcribes each clip (synthetic voice)', heard.length === 2 && normalize(heard[0].text) === 'game mode' && normalize(heard[1].text) === 'open spotify', JSON.stringify(heard) + ' ' + r.err.slice(-300));
  ok('each transcript carries its stt time and the expected phrase', heard.every(x => typeof x.sttMs === 'number' && x.sttMs >= 0) && heard[0].expected === 'game mode');
  ok('--clips ends with done', lines(r.out).some(m => m.type === 'done'));

  // models: setup fetches them; the live listener (offline) never downloads one on its own
  const fe = await runP(vp, [LISTENER, '--fetch'], { env: Object.assign({}, process.env, { VIERO_MODEL: 'tiny.en', PYTHONIOENCODING: 'utf-8' }) });
  ok('--fetch loads (downloading if needed) the model, for setup.js', lines(fe.out).some(m => m.type === 'ok' && m.model === 'tiny.en'), fe.out.slice(-300) + fe.err.slice(-300));
  const off = await runP(vp, [LISTENER, '--clips', dir], { env: Object.assign({}, process.env, { VIERO_MODEL: 'small.en', HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8' }) });
  ok('offline with a model not on disk: fails fast, naming the setup command for it', lines(off.out).some(m => m.type === 'fatal' && /setup\.js small\.en/.test(m.error)), off.out.slice(-300));
  fs.rmSync(dir, { recursive: true, force: true });
};
