'use strict';
const path = require('path');
const cp = require('child_process');
const { createChat } = require('../chat.js');
const term = require('../term.js');

const FAKE = path.join(__dirname, 'fake-claude.js');
const Q = 'what is two plus two';

module.exports = async function (ok) {
  const kids = [];
  let mode = 'ok';
  const calls = [];
  const spawn = (args, o) => {
    calls.push(args);
    const c = cp.spawn(process.execPath, [FAKE, ...args], Object.assign({}, o, { env: Object.assign({}, process.env, { FAKE_CLAUDE_MODE: mode }) }));
    kids.push(c);
    return c;
  };
  const make = (extra) => {
    const changes = [];
    const chat = createChat(Object.assign({
      spawn, resolve: () => ({ ok: true }), hint: () => 'install claude',
      args: () => ['--permission-mode', 'default', '--strict-mcp-config'],
      cwd: (w) => w || '.', killTree: term.killTree,
      onChange: (c) => changes.push(c),
    }, extra));
    chat._changes = changes;
    return chat;
  };
  const turn = (chat, text, opts) => new Promise((res) => {
    const r = chat.send(text, Object.assign({ onDone: (d) => res({ r, d }) }, opts));
    if (r.error) res({ r });
  });

  let chat = make();
  let t = await turn(chat, Q);
  const rd = chat.read(t.r.turn);
  ok('a turn streams into items and finishes done',
    rd.state === 'done' && rd.items.map(i => i.k).join() === 'text,tool,done' &&
    rd.items[1].name === 'Read' && rd.items[1].d === 'projects/x.md' &&
    rd.items[2].ms === 12 && rd.items[2].cost === 0.01 && rd.prompt === Q &&
    chat.answerText(t.r.turn) === 'Four. Two plus two is four.' &&
    t.d.ok === true && t.d.answer === 'Four. Two plus two is four.');

  t = await turn(chat, Q);
  const a2 = calls[calls.length - 1];
  ok('the second turn resumes the session', a2[a2.indexOf('--resume') + 1] === 's1' && !calls[0].includes('--resume'));
  ok('the permission args are always passed', ['--permission-mode', 'default', '--strict-mcp-config'].every(a => a2.includes(a)) &&
    a2.slice(0, 4).join() === '-p,--output-format,stream-json,--verbose' && !a2.includes('--model'));

  mode = 'dead';
  let stopped = null;
  t = await turn(chat, Q);
  const rd3 = chat.read(t.r.turn);
  ok('dead resume id → fresh session + notice',
    rd3.state === 'done' && rd3.items[0].k === 'notice' && rd3.items[0].d === 'that session is gone — started a fresh one' &&
    chat.answerText(t.r.turn) === 'Four. Two plus two is four.' &&
    calls.length === 4 && calls[2].includes("--resume") && !calls[3].includes('--resume'));

  // onDone fires once even across the retry (session id is still remembered)
  const fired = [];
  await new Promise((res) => chat.send(Q, { onDone: (d) => { fired.push(d); setTimeout(res, 100); } }));
  ok('onDone fires once per turn, retry included', fired.length === 1 && fired[0].ok === true);

  mode = 'slow';
  chat = make();
  const s1 = chat.send(Q, { source: 'voice', onDone: (d) => { stopped = d; } });
  const s2 = chat.send(Q);
  ok('send while running is refused', s1.turn && s2.error === 'Claude is still answering — wait, or press Ctrl+C' && chat.list().busy === true);
  ok('stop kills the running turn', chat.stop() === true && chat.read(s1.turn).state === 'stopped');
  await new Promise((r) => setTimeout(r, 50));
  ok('stop reports onDone with error stopped', stopped && stopped.ok === false && stopped.error === 'stopped' && chat.list().busy === false && chat.stop() === false);

  chat = make();
  mode = 'ok';
  await turn(chat, Q);
  chat.reset();
  await turn(chat, Q);
  ok('reset forgets the session', !calls[calls.length - 1].includes('--resume'));

  mode = 'slow';
  const s3 = chat.send(Q);
  chat.reset();
  ok('reset stops a running turn', chat.read(s3.turn).state === 'stopped' && chat.list().busy === false);

  const before = calls.length;
  chat = make({ resolve: () => ({ ok: false }) });
  t = await turn(chat, Q);
  const rdm = chat.read(t.r.turn);
  ok('CLI missing → error item with the hint',
    rdm.state === 'error' && JSON.stringify(rdm.items) === JSON.stringify([{ k: 'error', d: 'install claude' }]) &&
    calls.length === before && t.d.ok === false && t.d.error === 'install claude');

  mode = 'fail';
  chat = make();
  t = await turn(chat, Q);
  const rdf = chat.read(t.r.turn);
  ok('a failing CLI is one error item', rdf.state === 'error' && rdf.items.length === 1 && rdf.items[0].k === 'error' && rdf.items[0].d.includes('boom'));

  mode = 'split';
  chat = make();
  t = await turn(chat, Q);
  ok('a multi-byte character split across chunks survives',
    chat.answerText(t.r.turn) === 'a — привет' && t.d.ok === true);

  mode = 'iserr';
  chat = make();
  t = await turn(chat, Q);
  const rde = chat.read(t.r.turn);
  ok('a result with is_error is an error turn with the reason',
    rde.state === 'error' && rde.items.some(i => i.k === 'error' && i.d === 'bad thing') &&
    rde.items[rde.items.length - 1].k === 'done' && t.d.ok === false && t.d.error === 'bad thing');

  mode = 'ok';
  chat = make();
  const secret = 'zebra quartz marmalade';
  t = await turn(chat, secret);
  const blob = JSON.stringify(chat.list()) + JSON.stringify(chat._changes);
  ok('list and onChange carry no text', !blob.includes(secret) && !blob.includes('Four') && chat._changes.length > 0 &&
    Object.keys(chat.list().turns[0]).sort().join() === 'id,n,source,startedAt,state');

  ok('blank and oversized messages are refused',
    chat.send('   ').error === 'message required' && chat.send('x'.repeat(20001)).error === 'message too long');

  chat = make({ resolve: () => ({ ok: false }) }); // no spawn needed to fill the history
  for (let i = 0; i < 52; i++) await turn(chat, Q);
  ok('only the last 50 turns are kept', chat.list().turns.length === 50);

  // no child may outlive the test file
  await Promise.all(kids.map(k => k.exitCode !== null || k.signalCode ? 0 : new Promise(r => k.on('close', r))));
};
