'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const TASKS = ['- [ ] Old thing @2026-10-01', '- [ ] Push commits !p1 @2026-10-12', '- [ ] Low today !p3 @2026-10-12', '- [ ] Later @2026-10-15'].join('\n');
const SECRET = 'https://calendar.example/private-abc123/basic.ics';

function fakeCore(root, settings) {
  const routes = {}, handlers = {}, seen = [], listeners = {};
  return {
    root, routes, handlers, seen, listeners,
    config: () => settings, setConfig() {}, notify() {}, log() {},
    events: { emit: (n, d) => seen.push([n, d]), on: (n, fn) => { listeners[n] = fn; } },
    commands: { handle: (id, fn) => { handlers[id] = fn; }, slot() {} },
    route(m, s, fn) { routes[m + ' ' + s] = fn; }
  };
}
async function call(core, key, body) {
  let out = '', code = 0;
  await core.routes[key]({}, { writeHead(c) { code = c; }, end(b) { out = b; } }, body);
  return { code, body: JSON.parse(out) };
}

module.exports = async function (ok) {
  const { create } = require('../server.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-status-'));
  fs.mkdirSync(path.join(root, 'tasks'));
  fs.writeFileSync(path.join(root, 'tasks', 'tasks.md'), TASKS);
  const now = () => new Date(2026, 9, 12, 14, 3);
  let fail = null;
  const fetchText = async url => {
    if (fail) throw new Error(fail);
    return fs.readFileSync(path.join(FIX, /open-meteo/.test(url) ? 'forecast.json' : 'calendar.ics'), 'utf8');
  };
  const core = fakeCore(root, { lat: 52.52, lon: 13.41, place: 'Berlin', icsUrl: SECRET });
  const s = create(core, { now, fetchText });
  await s.refreshAll();
  let st = (await call(core, 'GET state')).body;
  ok('all three cards load', st.cards.due.state === 'ok' && st.cards.weather.state === 'ok' && st.cards.calendar.state === 'ok', JSON.stringify(st.cards).slice(0, 300));
  ok('due card from tasks.md', st.cards.due.data.today.map(t => t.text).join('|') === 'Push commits|Low today' && st.cards.due.data.overdue.length === 1);
  // fixture events are UTC instants, so the shown hour depends on this computer's zone: match any HH:MM
  ok('headline from the cards', /^1 overdue, 2 due today( · next \d{2}:\d{2} .+)? · rain from 17:00$/.test(st.headline), st.headline);
  ok('state never contains the calendar link (Review Focus 2)', !JSON.stringify(st).includes('private-abc123'));

  fail = 'getaddrinfo ENOTFOUND ' + SECRET;
  await s.refresh('weather');
  await s.refresh('calendar');
  st = (await call(core, 'GET state')).body;
  ok('a failing source keeps its last data, marked stale with "as of" (Review Focus 1)', st.cards.weather.state === 'stale' && st.cards.weather.data.temp === 11 && !!st.cards.weather.asOf && st.cards.due.state === 'ok');
  ok('a download error never repeats the link (Review Focus 2)', st.cards.calendar.state === 'stale' && !st.cards.calendar.error.includes('private-abc123') && /calendar download failed/.test(st.cards.calendar.error), st.cards.calendar.error);
  fail = null;

  const bare = fakeCore(path.join(root, 'nowhere'), {});
  const b = create(bare, { now, fetchText });
  await b.refreshAll();
  const bs = (await call(bare, 'GET state')).body;
  ok('missing config: each card says why on its own line', bs.cards.weather.state === 'error' && /location not set/.test(bs.cards.weather.error) && /calendar URL not set/.test(bs.cards.calendar.error));
  ok('missing tasks.md is one card\'s error, not a crash', bs.cards.due.state === 'error' && typeof bs.headline === 'string');

  const say = await core.handlers['status.due']();
  ok('"what\'s due" says it and shows it', say.say === '2 due today: Push commits and Low today. 1 overdue.' && say.toast === say.say, JSON.stringify(say));
  ok('"weather" says it', (await core.handlers['status.weather']()).say === 'It is 11 degrees and cloudy. Rain from 17:00.');
  await core.handlers['status.week']();
  ok('"show week" switches the view and tells the TV', s.state().view === 'week' && core.seen.some(([n, d]) => n === 'view' && d.view === 'week'));
  ok('POST view refuses an unknown view', (await call(core, 'POST view', { view: 'month' })).code === 400 && s.state().view === 'week');
  ok('POST view today', (await call(core, 'POST view', { view: 'today' })).body.view === 'today');
  core.listeners['modes.changed']({ current: 'game' });
  ok('current mode follows modes.changed', s.state().mode === 'game');

  // final review: a link that answers with a web page is not "nothing on the calendar"
  const page = fakeCore(root, { icsUrl: SECRET });
  const p = create(page, { now, fetchText: async () => '<!doctype html><html><body>Google Calendar</body></html>' });
  await p.refresh('calendar');
  const pc = (await call(page, 'GET state')).body.cards.calendar;
  ok('a link that returns a web page is an error, not an empty day', pc.state === 'error' && /did not return a calendar/.test(pc.error) && !pc.error.includes('private-abc123'), JSON.stringify(pc));
  fs.rmSync(root, { recursive: true, force: true });
};
