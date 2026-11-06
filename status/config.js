'use strict';
/* Status settings (machine.json → modules.status) → { lat, lon, place, icsUrl, problems }. Pure.
 * The calendar link is a secret (spec §11): no problem text ever repeats it. */
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

function normalizeConfig(settings) {
  const s = obj(settings);
  const problems = [];
  let lat = num(s.lat), lon = num(s.lon);
  const given = (s.lat !== undefined && s.lat !== null) || (s.lon !== undefined && s.lon !== null);
  if (given && (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    problems.push('location must be numbers: lat -90..90 and lon -180..180');
    lat = lon = null;
  }
  let icsUrl = typeof s.icsUrl === 'string' ? s.icsUrl.trim() : '';
  if (/^webcal:\/\//i.test(icsUrl)) icsUrl = 'https://' + icsUrl.slice('webcal://'.length);
  if (icsUrl && !/^https:\/\/\S+$/i.test(icsUrl)) { problems.push('icsUrl must be an https:// or webcal:// link'); icsUrl = ''; }
  const place = typeof s.place === 'string' ? s.place.trim().slice(0, 40) : '';
  return { lat, lon, place, icsUrl, problems };
}

module.exports = { normalizeConfig };
