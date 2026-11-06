'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async function (ok) {
  const { onDay } = await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'cards.js')).href);
  const d = n => new Date(2026, 9, n);
  const trip = { allDay: true, day: '2026-10-10', start: d(10).toISOString(), end: d(16).toISOString() };
  ok('a multi-day all-day event shows on each of its days', onDay(trip, d(12)) && onDay(trip, d(15)) && !onDay(trip, d(16)) && !onDay(trip, d(9)));
  const night = { allDay: false, start: new Date(2026, 9, 11, 22).toISOString(), end: new Date(2026, 9, 12, 2).toISOString() };
  ok('an overnight event shows on the day it ends too', onDay(night, d(11)) && onDay(night, d(12)) && !onDay(night, d(13)));
  const at10 = new Date(2026, 9, 12, 10).toISOString();
  const point = { allDay: false, start: at10, end: at10 };
  ok('an event with no length shows on its own day only', onDay(point, d(12)) && !onDay(point, d(11)) && !onDay(point, d(13)));
};
