'use strict';
/* Where the listener's Python lives: a venv under ~/.cache/aios (per machine, never synced,
 * spec §5.2). AIOS_VIERO_VENV points tests at another folder. */
const os = require('os');
const path = require('path');

const SETUP = 'node modules/viero/setup.js';
function venvDir(home, env) {
  env = env || process.env;
  return env.AIOS_VIERO_VENV || path.join(home || os.homedir(), '.cache', 'aios', 'viero-venv');
}
function venvPython(home, env) {
  const d = venvDir(home, env);
  return process.platform === 'win32' ? path.join(d, 'Scripts', 'python.exe') : path.join(d, 'bin', 'python');
}
function parseVersion(text) {
  const m = /Python (\d+)\.(\d+)/.exec(String(text));
  return m ? [+m[1], +m[2]] : null;
}
const okVersion = v => !!v && (v[0] > 3 || (v[0] === 3 && v[1] >= 10));

module.exports = { SETUP, venvDir, venvPython, parseVersion, okVersion };
