#!/usr/bin/env node
'use strict';
/* One-time per machine: make ~/.cache/aios/viero-venv (outside the synced vault, spec §5.2),
 * install the listener's packages into it and download the speech model (the live listener
 * runs offline). Run from the vault: node modules/viero/setup.js [tiny.en|base.en|small.en]
 * Then turn Viero off and on in Modules (or restart AIOS). */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const py = require('./python.js');

function systemPython() {
  const tries = process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) {
    try {
      const out = execFileSync(cmd, pre.concat(['--version']), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      if (py.okVersion(py.parseVersion(out))) return [cmd, pre];
    } catch (e) { /* not this one */ }
  }
  return null;
}
function step(cmd, args, env) {
  console.log('> ' + [cmd].concat(args).join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, env: Object.assign({}, process.env, env) });
  if (r.status !== 0) { console.error('failed (' + (r.error ? r.error.message : 'exit ' + r.status) + ')'); process.exit(1); }
}

const vp = py.venvPython();
if (!fs.existsSync(vp)) {
  const sys = systemPython();
  if (!sys) { console.error('Viero needs Python 3.10+. Install it (python.org, or: winget install Python.Python.3.12), then run this again.'); process.exit(1); }
  step(sys[0], sys[1].concat(['-m', 'venv', py.venvDir()]));
}
step(vp, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(__dirname, 'listener', 'requirements.txt')]);
step(vp, [path.join(__dirname, 'listener', 'listener.py'), '--check']);
const model = process.argv[2] || 'tiny.en';
console.log('Downloading the ' + model + ' speech model if it is not here yet (75-500 MB, once)…');
step(vp, [path.join(__dirname, 'listener', 'listener.py'), '--fetch'], { VIERO_MODEL: model });
console.log('Viero is set up. Turn Viero off and on in Modules, or restart AIOS.');
