'use strict';
const { headline, sayDue, sayWeather, sayNext } = require('../headline.js');

const at = (d, h, mi) => new Date(2026, 9, d, h, mi).toISOString(); // local times, so the test works in any time zone
function state(over) {
  return Object.assign({ cards: {
    due: { state: 'ok', data: { overdue: [{ text: 'Old' }], today: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], week: [{ text: 'W' }] } },
    weather: { state: 'ok', data: { temp: 11, text: 'cloudy', hours: [{ time: '14:00', rain: false }], rainFrom: '17:00' } },
    calendar: { state: 'ok', data: { events: [
      { summary: 'CICS 160 lab', start: at(12, 15, 0), end: at(12, 16, 15), allDay: false },
      { summary: 'Office hours', start: at(13, 11, 0), end: at(13, 12, 0), allDay: false }] } }
  } }, over || {});
}
const noon = new Date(2026, 9, 12, 14, 3);

module.exports = async function (ok) {
  ok('headline: due, next event today, rain', headline(state(), noon) === '1 overdue, 3 due today · next 15:00 CICS 160 lab · rain from 17:00', headline(state(), noon));
  const later = new Date(2026, 9, 12, 16, 30);
  ok('headline leaves out an event that is not today', headline(state(), later) === '1 overdue, 3 due today · rain from 17:00', headline(state(), later));
  ok('say due', sayDue(state()) === '3 due today: A, B and C. 1 overdue.', sayDue(state()));
  ok('say weather', sayWeather(state()) === 'It is 11 degrees and cloudy. Rain from 17:00.', sayWeather(state()));
  ok('say next: today', sayNext(state(), noon) === 'Next: CICS 160 lab, today at 15:00.', sayNext(state(), noon));
  ok('say next: tomorrow', sayNext(state(), later) === 'Next: Office hours, tomorrow at 11:00.', sayNext(state(), later));

  const clear = state();
  clear.cards.due = { state: 'ok', data: { overdue: [], today: [], week: [{ text: 'W' }] } };
  clear.cards.weather = { state: 'error', data: null, error: 'location not set (modules.status.lat / lon)' };
  clear.cards.calendar = { state: 'error', data: null, error: 'calendar URL not set (modules.status.icsUrl)' };
  ok('nothing due, broken sources: still a headline (Review Focus 1)', headline(clear, noon) === 'nothing due today', headline(clear, noon));
  ok('say due when clear', sayDue(clear) === 'Nothing due today. 1 later this week.');
  ok('say weather names the problem', sayWeather(clear) === 'No weather: location not set (modules.status.lat / lon).');
  ok('say next names the problem', sayNext(clear, noon) === 'No calendar: calendar URL not set (modules.status.icsUrl).');
  const rainy = state();
  rainy.cards.weather.data.hours[0].rain = true;
  rainy.cards.weather.data.rainFrom = '14:00';
  ok('raining now', / · rain now$/.test(headline(rainy, noon)));
};
