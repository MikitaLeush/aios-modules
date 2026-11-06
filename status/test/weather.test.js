'use strict';
const fs = require('fs');
const path = require('path');
const { weatherUrl, parseForecast } = require('../weather.js');

module.exports = async function (ok) {
  const u = weatherUrl(52.52, 13.41);
  ok('url: location, current + hourly fields, place time zone, no key', /latitude=52\.52&longitude=13\.41/.test(u) && /timezone=auto/.test(u) && /precipitation_probability/.test(u) && !/key=/.test(u), u);
  const w = parseForecast(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'forecast.json'), 'utf8')));
  ok('now: rounded temperature and words', w.temp === 11 && w.text === 'cloudy', JSON.stringify(w));
  ok('12 hours from the current hour (13:00 is past)', w.hours.length === 12 && w.hours[0].time === '14:00' && w.hours[11].time === '01:00');
  ok('17:00 is rain (code 61, 80%)', w.hours[3].time === '17:00' && w.hours[3].rain === true && w.hours[3].text === 'rain' && w.hours[3].temp === 9);
  ok('rain from 17:00', w.rainFrom === '17:00');
  let threw = '';
  try { parseForecast({ nope: 1 }); } catch (e) { threw = e.message; }
  ok('garbage weather answer is a clear error (Review Focus 1)', threw === 'weather answer not understood');
};
