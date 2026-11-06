#!/usr/bin/env node
'use strict';
/* Stand-in for listener.py in selftest and the aios-viero-demo preview: speaks the same
 * stdin/stdout protocol. AIOS_VIERO_FAKE = JSON [{ after: ms, line: {...} }], played in order;
 * it starts once the file AIOS_VIERO_FAKE_GO exists (selftest) or at once (demo), and repeats
 * every AIOS_VIERO_FAKE_LOOP ms if set. Beeps it receives go to AIOS_VIERO_FAKE_OUT, one per
 * line; its pid, prompt and key go to AIOS_VIERO_FAKE_OUT + '.pid'. */
const fs = require('fs');
const readline = require('readline');

const env = process.env;
const out = env.AIOS_VIERO_FAKE_OUT;
const script = JSON.parse(env.AIOS_VIERO_FAKE || '[]');
const say = o => process.stdout.write(JSON.stringify(o) + '\n');

if (out) fs.writeFileSync(out + '.pid', JSON.stringify({ pid: process.pid, prompt: env.VIERO_PROMPT, key: env.VIERO_KEY, offline: env.HF_HUB_OFFLINE }));
say({ type: 'ready', model: 'fake', loadMs: 0, key: env.VIERO_KEY });

// A line may also be { exit: code }: die like a crashed listener.
function act(line) {
  if (line.exit !== undefined) process.exit(line.exit);
  else say(line);
}
function play() { let t = 0; for (const s of script) { t += s.after || 0; setTimeout(() => act(s.line), t); } }
function start() { play(); if (+env.AIOS_VIERO_FAKE_LOOP > 0) setInterval(play, +env.AIOS_VIERO_FAKE_LOOP); }
if (env.AIOS_VIERO_FAKE_GO) {
  const poll = setInterval(() => { if (fs.existsSync(env.AIOS_VIERO_FAKE_GO)) { clearInterval(poll); start(); } }, 100);
} else start();

readline.createInterface({ input: process.stdin })
  .on('line', l => { if (out) fs.appendFileSync(out, l + '\n'); })
  .on('close', () => process.exit(0)); // AIOS stopped: same as the real listener
