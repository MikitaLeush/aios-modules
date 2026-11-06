'use strict';
/* Open-Meteo forecast (no key) → the Weather card: now + the next 12 hours (spec §7.1). Pure,
 * except that weatherUrl builds the address server.js fetches. Times stay in the place's own
 * time zone (timezone=auto). */
const CODES = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'snow', 73: 'snow', 75: 'heavy snow', 77: 'snow', 80: 'showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm' };
const words = code => CODES[code] || 'weather ' + code;
const wet = code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;

function weatherUrl(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=14&timezone=auto';
}

function parseForecast(j) {
  const h = j && j.hourly;
  if (!j || !j.current || !h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m) || !Array.isArray(h.weather_code))
    throw new Error('weather answer not understood');
  const nowHour = String(j.current.time).slice(0, 13); // 'YYYY-MM-DDTHH'
  const hours = [];
  for (let i = 0; i < h.time.length && hours.length < 12; i++) {
    if (String(h.time[i]).slice(0, 13) < nowHour) continue;
    const code = h.weather_code[i];
    const pop = Array.isArray(h.precipitation_probability) && typeof h.precipitation_probability[i] === 'number' ? h.precipitation_probability[i] : null;
    hours.push({ time: String(h.time[i]).slice(11, 16), temp: Math.round(h.temperature_2m[i]), text: words(code), rain: wet(code) || (pop !== null && pop >= 50), pop });
  }
  const first = hours.find(x => x.rain);
  return { temp: Math.round(j.current.temperature_2m), text: words(j.current.weather_code), hours, rainFrom: first ? first.time : null };
}

module.exports = { weatherUrl, parseForecast, CODES };
