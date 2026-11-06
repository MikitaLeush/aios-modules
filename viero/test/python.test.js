'use strict';
const py = require('../python.js');

module.exports = async function (ok) {
  ok('version parse', JSON.stringify(py.parseVersion('Python 3.12.10')) === '[3,12]' && py.parseVersion('nope') === null);
  ok('3.10 or newer only', py.okVersion([3, 10]) && py.okVersion([3, 12]) && !py.okVersion([3, 9]) && !py.okVersion(null));
  ok('venv lives under the home cache, outside the vault', py.venvDir('/h', {}).replace(/\\/g, '/') === '/h/.cache/aios/viero-venv');
  ok('AIOS_VIERO_VENV overrides the venv (tests)', py.venvDir('/h', { AIOS_VIERO_VENV: '/x/v' }) === '/x/v');
  ok('venv python path for this OS', /(Scripts[\\/]python\.exe|bin[\\/]python)$/.test(py.venvPython('/h', {})));
  ok('the setup command is relative to the vault', py.SETUP === 'node modules/viero/setup.js');
};
