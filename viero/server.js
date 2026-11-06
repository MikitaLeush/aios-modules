'use strict';
/* Viero (spec §5): push-to-talk voice → the same command registry as Ctrl+K. The Python
 * listener (listener/listener.py) runs as a child process and talks only over stdin/stdout
 * JSON lines: it hears and transcribes; voice.js decides; this file logs (outputs/viero/log.md),
 * speaks failures and questions (ps/say.ps1), and tells the shell what is happening
 * (events viero.state / viero.status). AIOS_VIERO_LISTENER / AIOS_VIERO_LOG / AIOS_VIERO_VENV
 * are test hooks (selftest, the demo preview), environment only. */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { normalizeConfig, whisperPrompt } = require('./config.js');
const { createVoice } = require('./voice.js');
const { formatLine, appendLine, tail } = require('./log.js');
const py = require('./python.js');

let child = null, sayer = null, stopping = false;

module.exports = {
  init(core) {
    stopping = false;
    const cfg = normalizeConfig(core.config());
    const status = { state: 'starting', error: '', problems: cfg.problems, key: cfg.key, model: cfg.model, loadMs: null, setup: py.SETUP };
    const logEnv = process.env.AIOS_VIERO_LOG;
    const logFile = logEnv === '-' ? null : (logEnv || path.join(core.root, 'outputs', 'viero', 'log.md'));
    const emit = (state, data) => core.events.emit('state', Object.assign({ state, key: cfg.key }, data || {}));
    const setStatus = patch => {
      Object.assign(status, patch);
      core.events.emit('status', status);
      if (status.state !== 'ready' && status.state !== 'starting') emit('unavailable', { text: status.error });
    };

    function speak(text) {
      if (process.platform !== 'win32' || !text) return;
      if (sayer) { try { sayer.kill(); } catch (e) {} }
      sayer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'ps', 'say.ps1'), '-Text', String(text).slice(0, 300)], { windowsHide: true, stdio: 'ignore' });
      sayer.on('error', () => {});
    }
    const voice = createVoice({
      run: (text, ctx) => core.commands.run(text, ctx),
      speak, emit,
      notify: (text, level) => core.notify(text, level),
      log: e => { if (!logFile) return; try { appendLine(logFile, formatLine(e)); } catch (err) { core.log('log: ' + err.message); } }
    });
    const send = beep => { if (beep && child && child.stdin.writable) child.stdin.write(JSON.stringify({ beep }) + '\n'); };

    core.route('GET', 'state', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status, pending: voice.pending(), recent: logFile ? tail(logFile, 12) : [] }));
    });
    core.route('POST', 'answer', async (req, res, body) => {
      send(await voice.answer(!!(body && body.yes === true)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    if (!cfg.key) return setStatus({ state: 'needs-key', error: cfg.problems.join(' · ') });
    const fake = process.env.AIOS_VIERO_LISTENER;
    const pyExe = py.venvPython();
    if (!fake && !fs.existsSync(pyExe)) return setStatus({ state: 'needs-setup', error: 'Viero needs Python 3.10+ and its packages: run ' + py.SETUP });

    child = spawn(fake ? process.execPath : pyExe, [fake ? path.resolve(core.root, fake) : path.join(__dirname, 'listener', 'listener.py')], {
      cwd: core.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        VIERO_KEY: cfg.key, VIERO_MODEL: cfg.model, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8',
        HF_HUB_OFFLINE: '1', // models come from setup.js; never a surprise download at start
        VIERO_PROMPT: whisperPrompt(core.commands.vocabulary()) // whisper prompt: the sayable commands (spec §5.3)
      })
    });
    const me = child;
    let errTail = '';
    me.stdin.on('error', () => {}); // a listener that died mid-write must not take AIOS down (EPIPE)
    me.stderr.on('data', c => { errTail = (errTail + c).slice(-600); });
    me.on('error', e => setStatus({ state: 'failed', error: 'listener did not start: ' + e.message }));
    me.on('exit', code => {
      if (child === me) child = null;
      // a fatal line already said why and how to fix it; keep that over "exit 1"
      if (!stopping && status.state !== 'failed') setStatus({ state: 'failed', error: 'listener stopped (exit ' + code + ')' + (errTail.trim() ? ': ' + errTail.trim().split(/\r?\n/).pop() : '') });
    });
    // utterances run one at a time, in order; one still waiting when Viero is turned off never runs
    let turn = Promise.resolve();
    const inTurn = fn => { turn = turn.then(() => (child === me ? fn() : null)).catch(e => core.log('utterance: ' + e.message)); };
    readline.createInterface({ input: me.stdout }).on('line', async line => {
      let m;
      try { m = JSON.parse(line); } catch (e) { return; }
      if (m.type === 'ready') setStatus({ state: 'ready', error: '', loadMs: m.loadMs });
      else if (m.type === 'fatal') setStatus({ state: 'failed', error: String(m.error || 'listener failed') });
      else if (m.type === 'state') emit(String(m.state));
      else if (m.type === 'heard') {
        emit('heard', { text: String(m.text || '') });
        inTurn(async () => send(await voice.heard({ text: String(m.text || ''), sttMs: +m.sttMs || 0 })));
      } else if (m.type === 'tap') {
        inTurn(async () => {
          const beep = await voice.tap();
          if (!beep) emit('idle'); // a tap with no question open: just clear the Listening bubble
          send(beep);
        });
      }
      else if (m.type === 'error') { emit('error', { text: String(m.error) }); core.notify('Viero: ' + m.error, 'error'); }
    });
  },
  stop() {
    stopping = true;
    for (const p of [child, sayer]) if (p) { try { p.kill(); } catch (e) {} }
    child = null; sayer = null;
  }
};
