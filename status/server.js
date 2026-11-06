'use strict';
/* Status module (spec §7): date, what's due, weather, calendar and current mode, one card per
 * source. A card keeps its last good data with "as of", or one line of reason; one broken
 * source never blanks the screen (spec §7.5). The calendar link is a secret: it never leaves
 * this file (state, events and errors never carry it). AIOS_STATUS_FIXTURES / AIOS_STATUS_NOW
 * are test hooks (selftest, the demo preview), environment only. */
const fs = require('fs');
const path = require('path');
const { normalizeConfig } = require('./config.js');
const { parseTasks, dueBuckets, localDate } = require('./due.js');
const { weatherUrl, parseForecast } = require('./weather.js');
const { parseIcs, expand } = require('./ical.js');
const { headline, sayDue, sayWeather, sayNext } = require('./headline.js');

const DAY = 86400000;
const EVERY = { due: 60 * 1000, weather: 30 * 60 * 1000, calendar: 15 * 60 * 1000 }; // spec §7.1
const VIEWS = new Set(['today', 'week']);

async function fetchText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function create(core, deps) {
  deps = deps || {};
  const now = deps.now || (() => new Date());
  const get = deps.fetchText || fetchText;
  const cfg = () => normalizeConfig(core.config());
  const cards = { due: blank(), weather: blank(), calendar: blank() };
  let view = 'today', mode = null;
  const timers = [];
  let watcher = null, debounce = null;

  function blank() { return { state: 'loading', data: null, asOf: null, error: '' }; }
  const changed = () => core.events.emit('changed', { at: now().toISOString() });

  const sources = {
    async due() {
      return dueBuckets(parseTasks(fs.readFileSync(path.join(core.root, 'tasks', 'tasks.md'), 'utf8')), localDate(now()));
    },
    async weather() {
      const c = cfg();
      if (c.lat === null) throw new Error('location not set (modules.status.lat / lon)');
      return parseForecast(JSON.parse(await get(weatherUrl(c.lat, c.lon))));
    },
    async calendar() {
      const c = cfg();
      if (!c.icsUrl) throw new Error('calendar URL not set (modules.status.icsUrl)');
      let text;
      try { text = await get(c.icsUrl); }
      catch (e) { throw new Error('calendar download failed (' + String(e.message).split(c.icsUrl).join('<calendar link>') + ')'); }
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('the link did not return a calendar (use the "Secret address in iCal format")');
      const t = now(), from = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      return { events: expand(parseIcs(text), from, new Date(+from + 7 * DAY)) };
    }
  };

  async function refresh(name) {
    try {
      cards[name] = { state: 'ok', data: await sources[name](), asOf: now().toISOString(), error: '' };
    } catch (e) {
      const c = cards[name], why = e.code === 'ENOENT' ? 'tasks/tasks.md not found' : e.message;
      cards[name] = c.data ? { state: 'stale', data: c.data, asOf: c.asOf, error: why } : { state: 'error', data: null, asOf: null, error: why };
    }
    changed();
  }
  const refreshAll = () => Promise.all(Object.keys(sources).map(refresh));

  function state() {
    const c = cfg(), t = now();
    const s = { now: t.toISOString(), view, place: c.place, mode, problems: c.problems, cards };
    s.headline = headline(s, t);
    return s;
  }
  function setView(v) {
    if (!VIEWS.has(v)) return false;
    view = v;
    core.events.emit('view', { view });
    return true;
  }

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  core.route('GET', 'state', (req, res) => json(res, 200, state()));
  core.route('POST', 'view', (req, res, body) => (setView(body && body.view) ? json(res, 200, { ok: true, view }) : json(res, 400, { error: 'view must be today or week' })));

  const answer = fn => async () => { setView('today'); const say = fn(state(), now()); return { say, toast: say }; };
  core.commands.handle('status.today', async () => { setView('today'); return { toast: 'Status: today' }; });
  core.commands.handle('status.week', async () => { setView('week'); return { toast: 'Status: this week' }; });
  core.commands.handle('status.due', answer(sayDue));
  core.commands.handle('status.weather', answer(sayWeather));
  core.commands.handle('status.next', answer(sayNext));
  core.events.on('modes.changed', d => { mode = d && d.current ? String(d.current) : null; changed(); });

  function start() {
    refreshAll();
    for (const name of Object.keys(EVERY)) timers.push(setInterval(() => refresh(name), EVERY[name]));
    try { // tasks.md is often saved by rename, so watch its folder
      watcher = fs.watch(path.join(core.root, 'tasks'), (ev, file) => {
        if (file && file !== 'tasks.md') return;
        clearTimeout(debounce);
        debounce = setTimeout(() => refresh('due'), 300);
      });
    } catch (e) { core.log('cannot watch tasks/: ' + e.message); }
  }
  function stop() {
    timers.splice(0).forEach(clearInterval);
    clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  }

  return { refresh, refreshAll, state, setView, start, stop };
}

let live = null;
module.exports = {
  create,
  init(core) {
    const dir = process.env.AIOS_STATUS_FIXTURES;
    const deps = dir ? {
      fetchText: async url => fs.readFileSync(path.join(path.resolve(core.root, dir), /open-meteo/.test(url) ? 'forecast.json' : 'calendar.ics'), 'utf8'),
      now: process.env.AIOS_STATUS_NOW ? (() => new Date(process.env.AIOS_STATUS_NOW)) : undefined
    } : {};
    live = create(core, deps);
    live.start();
  },
  stop() { if (live) live.stop(); live = null; }
};
