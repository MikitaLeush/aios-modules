'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function fakeCore(settings, run) {
  const routes = {}, seen = [];
  return {
    routes, seen, root: os.tmpdir(),
    config: () => settings, setConfig() {}, notify() {}, log() {},
    events: { emit: (n, d) => seen.push([n, d]), on() {} },
    commands: { run: run || (async () => ({ ok: false, matched: false })), vocabulary: () => ['game mode'], handle() {}, slot() {} },
    route(m, s, fn) { routes[m + ' ' + s] = fn; }
  };
}
async function call(core, key, body) {
  let out = '';
  await core.routes[key]({}, { writeHead() {}, end(b) { out = b; } }, body);
  return JSON.parse(out);
}

module.exports = async function (ok) {
  const saved = { L: process.env.AIOS_VIERO_LISTENER, V: process.env.AIOS_VIERO_VENV, G: process.env.AIOS_VIERO_LOG };
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-viero-novenv-'));
  delete process.env.AIOS_VIERO_LISTENER;
  process.env.AIOS_VIERO_LOG = '-';
  process.env.AIOS_VIERO_VENV = empty;
  try {
    const server = require('../server.js');
    let core = fakeCore({});
    server.init(core);
    let st = await call(core, 'GET state');
    ok('no key → needs-key naming the fix, nothing spawned (Review Focus 4)', st.status.state === 'needs-key' && /modules\.viero\.key/.test(st.status.error), JSON.stringify(st.status));
    core = fakeCore({ key: 'pause' });
    server.init(core);
    st = await call(core, 'GET state');
    ok('no venv → needs-setup naming the one command to run', st.status.state === 'needs-setup' && /node modules\/viero\/setup\.js/.test(st.status.error), JSON.stringify(st.status));
    ok('the shell is told Viero is unavailable', core.seen.some(([n, d]) => n === 'state' && d.state === 'unavailable'));
    ok('answer with nothing open is harmless', (await call(core, 'POST answer', { yes: true })).ok === true);
    server.stop();

    // with a fake listener (final review findings 1, 2, 7)
    process.env.AIOS_VIERO_LISTENER = path.join(__dirname, 'fake-listener.js');
    async function withFake(script, settle, check, run) {
      process.env.AIOS_VIERO_FAKE = JSON.stringify(script);
      const c = fakeCore({ key: 'pause' }, run);
      server.init(c);
      await new Promise(r => setTimeout(r, settle));
      try { await check(c); } finally { server.stop(); delete process.env.AIOS_VIERO_FAKE; }
    }
    await withFake([{ after: 50, line: { type: 'fatal', error: 'missing package: pynput (run: node modules/viero/setup.js)' } }, { after: 30, line: { exit: 1 } }], 800, async c => {
      const s = (await call(c, 'GET state')).status;
      ok('a fatal error keeps its fix text after the listener exits', s.state === 'failed' && /setup\.js/.test(s.error), JSON.stringify(s));
    });
    await withFake([{ after: 50, line: { type: 'state', state: 'listening' } }, { after: 50, line: { type: 'tap' } }], 600, async c => {
      const states = c.seen.filter(([n]) => n === 'state').map(([, d]) => d.state);
      ok('a stray tap clears the Listening bubble (idle)', states.includes('listening') && states[states.length - 1] === 'idle', JSON.stringify(states));
    });

    // utterances run one at a time, and nothing runs after Viero is turned off
    const runs = [];
    let active = 0, overlap = false;
    const slowRun = async text => { active++; if (active > 1) overlap = true; runs.push(text); await new Promise(r => setTimeout(r, 250)); active--; return { ok: false, matched: false }; };
    const two = [{ after: 50, line: { type: 'heard', text: 'one', sttMs: 1 } }, { after: 10, line: { type: 'heard', text: 'two', sttMs: 1 } }];
    await withFake(two, 800, async () => {
      ok('utterances run one at a time, in order', !overlap && runs.join(',') === 'one,two', runs.join(',') + ' overlap=' + overlap);
    }, slowRun);
    runs.length = 0;
    process.env.AIOS_VIERO_FAKE = JSON.stringify(two);
    server.init(fakeCore({ key: 'pause' }, slowRun));
    await new Promise(r => setTimeout(r, 150));
    server.stop();
    await new Promise(r => setTimeout(r, 600));
    delete process.env.AIOS_VIERO_FAKE;
    ok('a line already heard does not run after Viero is turned off', runs.join(',') === 'one', runs.join(','));

    // the live listener must never download a model on its own
    const outF = path.join(os.tmpdir(), 'aios-viero-env-' + process.pid);
    process.env.AIOS_VIERO_FAKE_OUT = outF;
    await withFake([], 400, async () => {
      let info = {};
      try { info = JSON.parse(fs.readFileSync(outF + '.pid', 'utf8')); } catch (e) {}
      ok('the live listener runs offline (HF_HUB_OFFLINE=1): no surprise model download', info.offline === '1', JSON.stringify(info));
    });
    delete process.env.AIOS_VIERO_FAKE_OUT;
    try { fs.unlinkSync(outF + '.pid'); } catch (e) {}
  } finally {
    for (const [k, v] of [['AIOS_VIERO_LISTENER', saved.L], ['AIOS_VIERO_VENV', saved.V], ['AIOS_VIERO_LOG', saved.G]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(empty, { recursive: true, force: true });
  }
  const say = fs.readFileSync(path.join(__dirname, '..', 'ps', 'say.ps1'));
  ok('say.ps1 is plain ASCII and takes the text as a parameter, never script text (Review Focus 5)', say.every(b => b < 128) && /param\(\[string\]\$Text/.test(say.toString()));
};
