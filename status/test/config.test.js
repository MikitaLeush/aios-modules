'use strict';
const { normalizeConfig } = require('../config.js');

module.exports = async function (ok) {
  const none = normalizeConfig(undefined);
  ok('nothing set → no location, no calendar, no problems', none.lat === null && none.lon === null && none.icsUrl === '' && none.place === '' && none.problems.length === 0);
  const amh = normalizeConfig({ lat: 52.52, lon: 13.41, place: 'Berlin', icsUrl: 'webcal://calendar.google.com/x/basic.ics' });
  ok('location and place are kept', amh.lat === 52.52 && amh.lon === 13.41 && amh.place === 'Berlin');
  ok('webcal:// becomes https://', amh.icsUrl === 'https://calendar.google.com/x/basic.ics');
  const bad = normalizeConfig({ lat: 120, lon: 5, icsUrl: 'http://x/secret.ics' });
  ok('out-of-range location is a problem and dropped', bad.lat === null && bad.lon === null && bad.problems.some(p => /location/.test(p)), JSON.stringify(bad.problems));
  ok('plain http calendar links are refused', bad.icsUrl === '' && bad.problems.some(p => /https/.test(p)));
  ok('a problem never repeats the calendar link (Review Focus 2)', !bad.problems.some(p => /secret/.test(p)));
  ok('only one of lat / lon is a problem', normalizeConfig({ lat: 1 }).problems.length === 1 && normalizeConfig({ lat: 1 }).lat === null);
  ok('a number typed as text is a problem', normalizeConfig({ lat: '42', lon: '-72' }).lat === null);
};
