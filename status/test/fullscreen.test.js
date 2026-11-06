'use strict';
/* fullscreen.js against stubbed browser globals: a refused state request (LAN without ?t=,
 * old token, server error) must say why instead of leaving the TV blank. */
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async function (ok) {
  const keep = {};
  const set = (k, v) => { keep[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  const root = { textContent: '', innerHTML: '', append() { throw new Error('drew a state that was refused'); } };
  set('location', { search: '' });
  set('sessionStorage', { getItem: () => null, setItem() {} });
  set('document', { getElementById: () => root, addEventListener() {}, createElement: () => ({ style: {}, append() {}, setAttribute() {} }) });
  set('EventSource', function () { this.close = () => {}; });
  set('setInterval', () => 0);
  set('fetch', async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden: token required' }) }));
  try {
    await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'fullscreen.js')).href + '?t=' + Date.now());
    for (let i = 0; i < 20 && !root.textContent; i++) await new Promise(r => setImmediate(r));
    ok('a refused state request says why instead of a blank screen', /Status unavailable: forbidden: token required/.test(root.textContent), JSON.stringify(root.textContent));
  } finally {
    for (const k of Object.keys(keep)) { if (keep[k]) Object.defineProperty(globalThis, k, keep[k]); else delete globalThis[k]; }
  }
};
