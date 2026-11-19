'use strict';
/* Personal weather app — NWS (U.S.) + Open-Meteo (worldwide). No build step, no API keys. */

// ---------- Config ----------
const HOME = { id: 'home', name: 'Home', lat: 33.14986, lon: -117.30919, kind: 'home' };
const HERE = { id: 'here', name: 'Current Location', kind: 'gps' };
const NWS = 'https://api.weather.gov';
const OM = 'https://api.open-meteo.com/v1/forecast';
const OM_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const OM_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const IEM = 'https://mesonet.agron.iastate.edu';
const CACHE_MS = 5 * 60 * 1000;
const REPO = 'mrjpb104/weather'; // GitHub repo the app is served from; the "Turn on summaries" button opens an issue here

// ---------- Small utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } if (SYNC_KEYS.includes(k)) syncChanged(); },
};
const SYNC_KEYS = ['wx.saved', 'wx.order', 'wx.labels', 'wx.groups']; // these follow you across devices (see "Sync" below)

const state = {
  settings: store.get('wx.settings', { units: 'us' }),
  saved: store.get('wx.saved', []),
  order: store.get('wx.order', []),
  labels: store.get('wx.labels', {}),
  groups: store.get('wx.groups', []),
  active: 'home',
  cache: new Map(),
  gps: null,
  map: null,
  radar: null,
  token: 0,
};
const US = () => state.settings.units !== 'si';
const theme = () => document.documentElement.dataset.theme || 'sky';
const isDark = () => (theme() === 'sky' ? /^(night|dusk)/.test(document.documentElement.dataset.sky || '') : matchMedia('(prefers-color-scheme: dark)').matches);
// "Live sky" theme: pick a background from current conditions and time of day.
function skyFor(v) {
  const s = v.sun, n = Date.now(), txt = `${v.now.text || ''} ${v.hourly[0]?.text || ''}`.toLowerCase();
  const near = d => d && Math.abs(n - d) < 45 * 60e3;
  const day = s.rise && s.set ? n > s.rise && n < s.set : true;
  const wet = /rain|shower|drizzle|thunder|storm|snow|sleet/.test(txt) || (v.hourly[0]?.pop ?? 0) >= 60;
  const cloudy = !wet && /overcast|mostly cloudy|^cloudy|\bcloudy|fog|haze|smoke/.test(txt) && !/partly/.test(txt);
  if ((near(s.rise) || near(s.set)) && !wet) return 'dusk';
  return `${day ? 'day' : 'night'}-${wet ? 'rain' : cloudy ? 'cloudy' : 'clear'}`;
}
async function getJSON(url, { timeout = 15000, text = false, cache = 'default' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return text ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}
async function nws(path, tries = 3) {
  const url = path.startsWith('http') ? path : NWS + path;
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await getJSON(url); } catch (e) { err = e; if (e.status === 404) break; await sleep(500 * (i + 1)); }
  }
  throw err;
}
// Open-Meteo occasionally times out or rate-limits; retry a couple of times before giving up.
async function retryJSON(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await getJSON(url); } catch (e) { err = e; if (e.status === 400 || e.status === 404) break; await sleep(700 * (i + 1)); }
  }
  throw err;
}
const val = r => (r && r.status === 'fulfilled' ? r.value : null);

// ---------- Units & formatting ----------
const cToF = c => c * 9 / 5 + 32;
const T = c => (c == null || Number.isNaN(c) ? null : US() ? cToF(c) : c);
const fmtT = c => { const v = T(c); return v == null ? '–' : `${Math.round(v)}°`; };
const fmtSpd = k => (k == null ? '–' : US() ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`);
const spdNum = k => (k == null ? null : US() ? k * 0.621371 : k);
const fmtLen = mm => {
  if (mm == null) return '–';
  if (US()) { const i = mm / 25.4; return `${i < 0.995 ? i.toFixed(2) : i.toFixed(1)} in`; }
  return `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
};
const fmtVis = m => (m == null ? '–' : US() ? `${Math.round(m / 1609.34 * 10) / 10 >= 10 ? '10+' : (m / 1609.34).toFixed(1)} mi` : `${Math.round(m / 1000)} km`);
const fmtPres = hpa => (hpa == null ? '–' : US() ? `${(hpa * 0.02953).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`);
const compass = d => (d == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round((((d % 360) + 360) % 360) / 22.5) % 16]);

const dtf = (tz, o) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o });
const fmtTime = (d, tz) => dtf(tz, { hour: 'numeric', minute: '2-digit' }).format(d);
const fmtHour = (d, tz) => dtf(tz, { hour: 'numeric' }).format(d);
const fmtWkd = (d, tz) => dtf(tz, { weekday: 'short' }).format(d);
const fmtDayTime = (d, tz) => dtf(tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
const fmtStamp = (d, tz) => dtf(tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
const ymd = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const ago = d => { const m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`; };
const durHM = h => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;

// ---------- Weather icons ----------
function nwsEmoji(text = '', isDay = true) {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return '⛈️';
  if (/snow|flurr|sleet|blizzard/.test(t)) return '🌨️';
  if (/freezing/.test(t)) return '🧊';
  if (/rain|shower|drizzle/.test(t)) return /chance|slight|isolated|scattered/.test(t) ? (isDay ? '🌦️' : '🌧️') : '🌧️';
  if (/fog|haze|smoke|dust|mist/.test(t)) return '🌫️';
  if (/wind|breezy|blustery/.test(t) && !/cloud/.test(t)) return '💨';
  if (/overcast|^cloudy|mostly cloudy/.test(t)) return isDay ? '🌥️' : '☁️';
  if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) return isDay ? '⛅' : '☁️';
  if (/cloud/.test(t)) return '☁️';
  if (/sunny|clear|fair/.test(t)) return isDay ? '☀️' : '🌙';
  return isDay ? '🌤️' : '🌙';
}
const WMO = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mostly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'], 48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌧️', '🌧️'], 55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🧊', '🧊'], 57: ['Freezing drizzle', '🧊', '🧊'],
  61: ['Light rain', '🌦️', '🌧️'], 63: ['Rain', '🌧️', '🌧️'], 65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🧊', '🧊'], 67: ['Freezing rain', '🧊', '🧊'],
  71: ['Light snow', '🌨️', '🌨️'], 73: ['Snow', '🌨️', '🌨️'], 75: ['Heavy snow', '❄️', '❄️'], 77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Showers', '🌦️', '🌧️'], 81: ['Showers', '🌧️', '🌧️'], 82: ['Heavy showers', '🌧️', '🌧️'],
  85: ['Snow showers', '🌨️', '🌨️'], 86: ['Heavy snow showers', '❄️', '❄️'],
  95: ['Thunderstorms', '⛈️', '⛈️'], 96: ['Thunderstorms with hail', '⛈️', '⛈️'], 99: ['Thunderstorms with hail', '⛈️', '⛈️'],
};
const wmo = (c, isDay = true) => { const w = WMO[c] || ['—', '🌡️', '🌡️']; return { text: w[0], emoji: isDay ? w[1] : w[2] }; };

// ---------- Sun & moon (computed locally, works anywhere) ----------
function sunEventUTC(y, m, d, lat, lon, zenith, rising) {
  const rad = Math.PI / 180;
  const N = Math.floor(275 * m / 9) - Math.floor((m + 9) / 12) * (1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3)) + d - 30;
  const lngHour = lon / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634; L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad; RA = ((RA % 360) + 360) % 360;
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
  if (cosH > 1 || cosH < -1) return null;
  const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
  const UT = ((H + RA - 0.06571 * t - 6.622 - lngHour) % 24 + 24) % 24;
  return Date.UTC(y, m - 1, d) + UT * 3600e3;
}
function sunEvent(dateStr, tz, lat, lon, zenith, rising) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let ms = sunEventUTC(y, m, d, lat, lon, zenith, rising);
  if (ms == null) return null;
  for (let i = 0; i < 2; i++) {
    const got = ymd(new Date(ms), tz);
    if (got < dateStr) ms += 864e5; else if (got > dateStr) ms -= 864e5; else break;
  }
  return new Date(ms);
}
function sunInfo(lat, lon, tz) {
  const now = new Date();
  const today = ymd(now, tz);
  const yest = ymd(new Date(now - 864e5), tz);
  const tmrw = ymd(new Date(+now + 864e5), tz);
  const ev = ds => ({
    rise: sunEvent(ds, tz, lat, lon, 90.833, true), set: sunEvent(ds, tz, lat, lon, 90.833, false),
    dawn: sunEvent(ds, tz, lat, lon, 96, true), dusk: sunEvent(ds, tz, lat, lon, 96, false),
  });
  const a = ev(today), b = ev(yest), c = ev(tmrw);
  const len = x => (x.rise && x.set ? (x.set - x.rise) / 3600e3 : null);
  return { ...a, length: len(a), delta: len(a) != null && len(b) != null ? (len(a) - len(b)) * 60 : null, tomorrowRise: c.rise };
}
function moonInfo(date = new Date()) {
  const syn = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = ((((date - ref) / 864e5) % syn) + syn) % syn;
  const illum = (1 - Math.cos(2 * Math.PI * age / syn)) / 2;
  const names = [[1.84, 'New moon', '🌑'], [5.53, 'Waxing crescent', '🌒'], [9.22, 'First quarter', '🌓'], [12.91, 'Waxing gibbous', '🌔'],
    [16.61, 'Full moon', '🌕'], [20.30, 'Waning gibbous', '🌖'], [23.99, 'Last quarter', '🌗'], [27.68, 'Waning crescent', '🌘'], [99, 'New moon', '🌑']];
  const [, name, emoji] = names.find(n => age < n[0]);
  const toFull = ((14.765 - age) + syn) % syn, toNew = (syn - age) % syn;
  return { age, illum, name, emoji, nextFull: new Date(+date + toFull * 864e5), nextNew: new Date(+date + toNew * 864e5) };
}

// ---------- NWS gridpoint helpers ----------
function parseDur(s) { const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(s) || []; return (+m[1] || 0) * 24 + (+m[2] || 0) + (+m[3] || 0) / 60; }
function series(prop) {
  return (prop?.values || []).map(v => {
    const [s, d] = v.validTime.split('/');
    const start = new Date(s);
    return { start, end: new Date(+start + parseDur(d) * 3600e3), value: v.value };
  });
}
function sumBetween(ser, t0, t1) {
  let tot = 0, any = false;
  for (const x of ser) {
    if (x.value == null) continue;
    const a = Math.max(t0, x.start), b = Math.min(t1, x.end);
    if (b > a) { tot += x.value * (b - a) / (x.end - x.start); any = true; }
  }
  return any ? tot : null;
}
function maxBetween(ser, t0, t1) {
  let best = null;
  for (const x of ser) if (x.value != null && x.end > t0 && x.start < t1 && (!best || x.value > best.value)) best = x;
  return best;
}

// ---------- Data loading ----------
async function resolveGPS() {
  if (state.gps && Date.now() - state.gps.at < 10 * 60e3) return state.gps;
  const pos = await new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This browser cannot share location.'));
    navigator.geolocation.getCurrentPosition(p => res(p), e => rej(new Error(e.code === 1 ? 'Location permission was denied. Allow location access for this site in your browser settings, then tap Refresh.' : 'Could not get your location. Try again in a moment.')), { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
  state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
  return state.gps;
}

async function loadLocation(loc, force = false) {
  let lat = loc.lat, lon = loc.lon;
  if (loc.kind === 'gps') ({ lat, lon } = await resolveGPS());
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}|${state.settings.units}`;
  const hit = state.cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.view;

  let view;
  let points = null, nwsFail = null;
  try { points = await nws(`/points/${lat.toFixed(4)},${lon.toFixed(4)}`); } catch (e) { nwsFail = e; }
  if (points) view = await loadUS(loc, lat, lon, points);
  else {
    view = await loadIntl(loc, lat, lon);
    if (nwsFail && nwsFail.status !== 404 && inUSBox(lat, lon)) view.notice = 'The National Weather Service didn’t respond, so this view is using Open-Meteo data. Tap Refresh to try NWS again.';
  }
  view.loadedAt = new Date();
  // If the extra conditions (UV, pressure, visibility) didn't load, keep this view for only a minute so they're retried.
  state.cache.set(key, { at: view.omv ? Date.now() : Date.now() - CACHE_MS + 60e3, view });
  return view;
}
const inUSBox = (lat, lon) => lat > 18 && lat < 72 && lon > -180 && lon < -64;

function omURL(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto', timeformat: 'unixtime', forecast_days: '8',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,visibility,uv_index',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max',
  });
  return `${OM}?${p}`;
}
const aqURL = (lat, lon) => `${OM_AQ}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=us_aqi,european_aqi,pm2_5&timezone=auto`;

async function loadUS(loc, lat, lon, points) {
  const P = points.properties;
  const tz = P.timeZone;
  const office = P.cwa || P.gridId;
  const rl = P.relativeLocation?.properties || {};
  const unitQ = US() ? '' : '?units=si';
  const [fc, hr, grid, alerts, om, aq, stations, afdList, summary, cfg] = await Promise.allSettled([
    nws(P.forecast + unitQ), nws(P.forecastHourly + unitQ), nws(P.forecastGridData),
    nws(`/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`),
    retryJSON(omURL(lat, lon)), retryJSON(aqURL(lat, lon)),
    nws(P.observationStations), nws(`/products/types/AFD/locations/${office}`),
    getJSON(`summaries/${office}.json?t=${Date.now()}`, { cache: 'no-store' }),
    getJSON(`config.json?t=${Date.now()}`, { cache: 'no-store' }),
  ]);

  // Observation: first nearby station with a recent temperature
  let obs = null, station = null;
  const st = val(stations)?.features || [];
  for (const f of st.slice(0, 4)) {
    try {
      const o = await nws(`/stations/${f.properties.stationIdentifier}/observations/latest`, 1);
      const p = o.properties;
      if (p.temperature?.value != null && Date.now() - new Date(p.timestamp) < 2.5 * 3600e3) { obs = p; station = f.properties; break; }
    } catch { /* try next station */ }
  }

  // Latest forecast discussion
  let afd = null;
  const latest = val(afdList)?.['@graph']?.[0];
  if (latest) {
    try { const prod = await nws(`/products/${latest.id}`); afd = { id: latest.id, issued: new Date(prod.issuanceTime || latest.issuanceTime), text: prod.productText }; } catch { /* leave null */ }
  }

  const omv = val(om);
  const g = val(grid)?.properties || {};
  const qpf = series(g.quantitativePrecipitation), gust = series(g.windGust);
  const periods = val(fc)?.properties?.periods || [];
  const hourly = (val(hr)?.properties?.periods || []).filter(p => new Date(p.endTime) > Date.now()).slice(0, 24).map(p => ({
    t: new Date(p.startTime), temp: p.temperature, pop: p.probabilityOfPrecipitation?.value ?? 0,
    emoji: nwsEmoji(p.shortForecast, p.isDaytime), kind: iconKindText(p.shortForecast, p.isDaytime), text: p.shortForecast,
    gustKmh: maxBetween(gust, new Date(p.startTime), new Date(p.endTime))?.value ?? null,
  }));

  // Now
  const now = {};
  if (obs) {
    const c = x => x?.value ?? null;
    Object.assign(now, {
      tempC: c(obs.temperature), feelsC: c(obs.heatIndex) ?? c(obs.windChill) ?? c(obs.temperature), text: obs.textDescription || '',
      windKmh: c(obs.windSpeed), windDir: c(obs.windDirection), gustKmh: c(obs.windGust), rh: c(obs.relativeHumidity),
      dewC: c(obs.dewpoint), presHpa: c(obs.seaLevelPressure) != null ? c(obs.seaLevelPressure) / 100 : c(obs.barometricPressure) != null ? c(obs.barometricPressure) / 100 : null,
      visM: c(obs.visibility), time: new Date(obs.timestamp), source: `${station.name} (${station.stationIdentifier})`,
    });
  }
  if (omv?.current) {
    const k = omv.current;
    const fill = (f, v) => { if (now[f] == null) now[f] = v; };
    fill('tempC', k.temperature_2m); fill('feelsC', k.apparent_temperature); fill('windKmh', k.wind_speed_10m); fill('windDir', k.wind_direction_10m);
    fill('gustKmh', k.wind_gusts_10m); fill('rh', k.relative_humidity_2m); fill('dewC', k.dew_point_2m); fill('presHpa', k.pressure_msl); fill('visM', k.visibility);
    if (!now.text) now.text = wmo(k.weather_code, k.is_day).text;
    if (!now.source) { now.source = 'Open-Meteo model (no nearby NWS observation)'; now.time = new Date(k.time * 1000); }
    now.uv = k.uv_index;
    now.uvMax = omv.daily?.uv_index_max?.[0];
  }
  const firstIsDay = periods[0]?.isDaytime ?? true;
  const dayNow = obs ? isDaylight(lat, lon, tz) : firstIsDay;
  now.emoji = nwsEmoji(now.text || periods[0]?.shortForecast, dayNow);
  now.kind = iconKindText(now.text || periods[0]?.shortForecast, dayNow);
  const aqv = val(aq)?.current;
  if (aqv) now.aqi = aqv.us_aqi;

  // Days (pair NWS day/night periods)
  const days = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (p.isDaytime) {
      const n = periods[i + 1] && !periods[i + 1].isDaytime ? periods[++i] : null;
      days.push(mkDay(p, n));
    } else days.push(mkDay(null, p));
  }
  function mkDay(d, n) {
    const t0 = new Date((d || n).startTime), t1 = new Date((n || d).endTime);
    const precip = sumBetween(qpf, t0, t1);
    const gmax = maxBetween(gust, t0, t1);
    const pops = [d, n].filter(Boolean).map(x => x.probabilityOfPrecipitation?.value ?? 0);
    return {
      name: d ? (/^(today|this)/i.test(d.name) ? 'Today' : d.name.slice(0, 3)) : (n.name.length > 9 ? n.name.slice(0, 3) : n.name),
      fullName: d ? d.name : n.name,
      hi: d ? `${d.temperature}°` : null, lo: n ? `${n.temperature}°` : null, hiN: d ? d.temperature : null, loN: n ? n.temperature : null,
      kind: iconKindText((d || n).shortForecast, !!d),
      pop: Math.max(...pops), emoji: nwsEmoji((d || n).shortForecast, !!d), short: (d || n).shortForecast,
      detail: [d && [d.name, d.detailedForecast], n && [n.name, n.detailedForecast]].filter(Boolean),
      precipMm: precip, gustKmh: gmax?.value ?? null,
    };
  }

  const sub = rl.city ? `${rl.city}, ${rl.state}` : `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  const view = {
    kind: 'us', name: loc.name, sub, lat, lon, tz, office, elevM: val(grid)?.properties?.elevation?.value ?? val(om)?.elevation ?? null,
    officeName: null, radarStation: P.radarStation, now, hourly, days, periods,
    alerts: (val(alerts)?.features || []).map(f => f.properties),
    afd, summary: val(summary), summaryOffices: val(cfg)?.summary_offices || null, sun: sunInfo(lat, lon, tz), moon: moonInfo(),
    qpf24: sumBetween(qpf, new Date(), new Date(Date.now() + 24 * 3600e3)),
    gust24: maxBetween(gust, new Date(), new Date(Date.now() + 24 * 3600e3)),
    cc: 'US', omv,
  };
  view.glance = glanceUS(view);
  view.tides = await loadTides(lat, lon, tz).catch(() => null);
  return view;
}

function isDaylight(lat, lon, tz) {
  const s = sunInfo(lat, lon, tz);
  const n = Date.now();
  return s.rise && s.set ? n > s.rise && n < s.set : true;
}

async function loadIntl(loc, lat, lon) {
  const [om, aq, rev] = await Promise.allSettled([
    retryJSON(omURL(lat, lon)), retryJSON(aqURL(lat, lon)),
    loc.cc ? Promise.resolve(null) : getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`),
  ]);
  const o = val(om);
  if (!o) throw new Error('Could not load forecast data (Open-Meteo did not respond).');
  const tz = o.timezone;
  const r = val(rev);
  const cc = loc.cc || r?.countryCode || '';
  const sub = loc.kind === 'gps'
    ? [r?.city || r?.locality, r?.principalSubdivision, r?.countryName].filter(Boolean).join(', ')
    : [loc.admin, loc.country || cc].filter(Boolean).join(', ');
  const k = o.current;
  const now = {
    tempC: k.temperature_2m, feelsC: k.apparent_temperature, text: wmo(k.weather_code, k.is_day).text, emoji: wmo(k.weather_code, k.is_day).emoji,
    windKmh: k.wind_speed_10m, windDir: k.wind_direction_10m, gustKmh: k.wind_gusts_10m, rh: k.relative_humidity_2m, dewC: k.dew_point_2m,
    presHpa: k.pressure_msl, visM: k.visibility, uv: k.uv_index, uvMax: o.daily?.uv_index_max?.[0],
    time: new Date(k.time * 1000), source: 'Open-Meteo (blend of national weather service models)',
    kind: iconKindWMO(k.weather_code, k.is_day),
  };
  const aqv = val(aq)?.current;
  if (aqv) { now.aqi = aqv.us_aqi; now.eaqi = aqv.european_aqi; }
  const H = o.hourly;
  const hourly = [];
  for (let i = 0; i < H.time.length && hourly.length < 24; i++) {
    const t = new Date(H.time[i] * 1000);
    if (+t + 3600e3 <= Date.now()) continue;
    const w = wmo(H.weather_code[i], H.is_day[i]);
    hourly.push({ t, temp: Math.round(T(H.temperature_2m[i])), pop: H.precipitation_probability[i] ?? 0, emoji: w.emoji, kind: iconKindWMO(H.weather_code[i], H.is_day[i]), text: w.text, gustKmh: H.wind_gusts_10m[i], precipMm: H.precipitation[i] });
  }
  const D = o.daily;
  const days = D.time.map((ts, i) => {
    const d = new Date((ts + 12 * 3600) * 1000);
    const w = wmo(D.weather_code[i], true);
    const name = i === 0 ? 'Today' : fmtWkd(d, tz);
    return {
      name, fullName: i === 0 ? 'Today' : dtf(tz, { weekday: 'long' }).format(d),
      hi: fmtT(D.temperature_2m_max[i]), lo: fmtT(D.temperature_2m_min[i]),
      hiC: D.temperature_2m_max[i], loC: D.temperature_2m_min[i], hiN: Math.round(T(D.temperature_2m_max[i])), loN: Math.round(T(D.temperature_2m_min[i])), kind: iconKindWMO(D.weather_code[i], true),
      pop: D.precipitation_probability_max[i] ?? 0, emoji: w.emoji, short: w.text,
      precipMm: D.precipitation_sum[i], gustKmh: D.wind_gusts_10m_max[i], windDir: D.wind_direction_10m_dominant[i], uv: D.uv_index_max[i],
    };
  });
  days.forEach(d => { d.detail = [[d.fullName, intlDayText(d)]]; });
  const view = {
    kind: 'intl', name: loc.name, sub, lat, lon, tz, cc,
    now, hourly, days, alerts: [], sun: sunInfo(lat, lon, tz), moon: moonInfo(), omv: o,
    qpf24: hourly.reduce((a, h) => a + (h.precipMm || 0), 0),
    gust24: (() => { let b = null; hourly.forEach(h => { if (h.gustKmh != null && (!b || h.gustKmh > b.value)) b = { value: h.gustKmh, start: h.t }; }); return b; })(),
  };
  view.glance = glanceIntl(view);
  view.plain = intlWeekText(view);
  return view;
}

function intlDayText(d) {
  const parts = [`${d.short}.`, `High ${d.hi}, low ${d.lo}.`];
  if (d.pop >= 15 || d.precipMm >= 0.5) parts.push(`${d.pop}% chance of precipitation${d.precipMm >= 0.25 ? ` (about ${fmtLen(d.precipMm)})` : ''}.`);
  if (d.gustKmh != null && d.gustKmh >= 35) parts.push(`Gusts to ${fmtSpd(d.gustKmh)} from the ${compass(d.windDir)}.`);
  if (d.uv >= 6) parts.push(`UV index up to ${Math.round(d.uv)} (${uvCat(d.uv)}).`);
  return parts.join(' ');
}

// ---------- Plain-English "next 24 hours" ----------
const whenH = (d, tz) => (ymd(d, tz) === ymd(new Date(), tz) ? fmtHour(d, tz) : `${fmtWkd(d, tz)} ${fmtHour(d, tz)}`);
function rainSentence(hourly, tz, qpf24) {
  if (!hourly.length) return null;
  const maxPop = Math.max(...hourly.map(h => h.pop || 0));
  const idx = hourly.findIndex(h => h.pop >= 40);
  const amt = qpf24 != null && qpf24 >= 0.25 ? ` Expected total: about ${fmtLen(qpf24)}.` : '';
  if (idx < 0) {
    if (maxPop < 15) return ['☀️', 'No rain expected in the next 24 hours.'];
    const pk = hourly.find(h => h.pop === maxPop);
    return ['🌂', `Small chance of a shower (up to ${maxPop}% around ${whenH(pk.t, tz)}).${amt}`];
  }
  let end = idx;
  while (end + 1 < hourly.length && hourly[end + 1].pop >= 40) end++;
  const peak = hourly.slice(idx, end + 1).reduce((a, h) => (h.pop > a.pop ? h : a));
  const thunder = hourly.slice(idx, end + 1).some(h => /thunder/i.test(h.text));
  const endTxt = end + 1 < hourly.length ? ` until about ${whenH(new Date(+hourly[end].t + 3600e3), tz)}` : ' through at least the next day';
  const startTxt = idx === 0 ? 'Rain is likely now' : `Rain likely starting around ${whenH(hourly[idx].t, tz)}`;
  return ['🌧️', `${startTxt}${endTxt} (peak chance ${peak.pop}%)${thunder ? ', with a chance of thunder' : ''}.${amt}`];
}
function glanceCommon(v) {
  const out = [];
  // The rain sentence leads the hero card, so it isn't repeated here.
  const g = v.gust24;
  if (g && spdNum(g.value) >= (US() ? 25 : 40)) out.push(['💨', esc(`Gusty: wind gusts up to ${fmtSpd(g.value)} around ${whenH(new Date(g.start), v.tz)}.`)]);
  const s = v.sun, n = new Date();
  if (s.set && n < s.set && (!s.rise || n > s.rise)) out.push(['🌇', esc(`Sunset at ${fmtTime(s.set, v.tz)}.`)]);
  else if (s.rise && n < s.rise) out.push(['🌅', esc(`Sunrise at ${fmtTime(s.rise, v.tz)}.`)]);
  else if (s.tomorrowRise) out.push(['🌅', esc(`Sunrise tomorrow at ${fmtTime(s.tomorrowRise, v.tz)}.`)]);
  if (v.now.uvMax >= 6 && s.set && n < s.set) out.push(['🧴', esc(`UV gets ${uvCat(v.now.uvMax).toLowerCase()} today (index ${Math.round(v.now.uvMax)}).`)]);
  return out;
}
function glanceUS(v) {
  const out = glanceCommon(v);
  const p = v.periods;
  if (p.length) {
    const d = p.find(x => x.isDaytime), n = p.find(x => !x.isDaytime);
    const bits = [];
    if (p[0].isDaytime) { bits.push(`High ${p[0].temperature}° today`); if (n) bits.push(`low ${n.temperature}° tonight`); }
    else { bits.push(`Low ${p[0].temperature}° tonight`); if (d) bits.push(`high ${d.temperature}° ${d.name.toLowerCase().startsWith('to') ? 'tomorrow' : d.name}`); }
    out.splice(out.length ? 1 : 0, 0, ['🌡️', esc(bits.join(', ') + '.')]);
  }
  return out;
}
function glanceIntl(v) {
  const out = glanceCommon(v);
  const d0 = v.days[0], d1 = v.days[1];
  if (d0 && d1) out.splice(1, 0, ['🌡️', esc(`High ${d0.hi} today, low ${d1 ? d0.lo : ''} tonight; tomorrow ${d1.hi}/${d1.lo}.`)]);
  return out;
}
function intlWeekText(v) {
  const d = v.days.slice(0, 7);
  if (!d.length) return [];
  const his = d.map(x => T(x.hiC)), los = d.map(x => T(x.loC));
  const lines = [];
  lines.push(`Highs ${Math.round(Math.min(...his))}–${Math.round(Math.max(...his))}°, lows ${Math.round(Math.min(...los))}–${Math.round(Math.max(...los))}° over the next week.`);
  const wet = d.filter(x => x.pop >= 50);
  if (!wet.length) lines.push(d.some(x => x.pop >= 20) ? 'Mostly dry — just a few small chances of a shower.' : 'Dry all week.');
  else {
    const w = wet.reduce((a, x) => (x.precipMm > a.precipMm ? x : a));
    lines.push(`Wet days: ${wet.map(x => x.fullName).join(', ')}. Wettest looks like ${w.fullName} (${w.pop}%${w.precipMm >= 0.25 ? `, about ${fmtLen(w.precipMm)}` : ''}).`);
  }
  const windy = d.reduce((a, x) => ((x.gustKmh || 0) > (a.gustKmh || 0) ? x : a));
  if (windy.gustKmh >= 40) lines.push(`Windiest: ${windy.fullName}, gusts to ${fmtSpd(windy.gustKmh)}.`);
  const cold = d.reduce((a, x) => (x.loC < a.loC ? x : a));
  if (cold.loC <= 2) lines.push(`Coldest night: ${cold.fullName} (${cold.lo}) — frost or freezing possible.`);
  const snowy = d.filter(x => /snow/i.test(x.short));
  if (snowy.length) lines.push(`Snow possible: ${snowy.map(x => x.fullName).join(', ')}.`);
  return lines;
}
const uvCat = u => (u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme');
const aqiCat = a => (a <= 50 ? 'Good' : a <= 100 ? 'Moderate' : a <= 150 ? 'Unhealthy for sensitive groups' : a <= 200 ? 'Unhealthy' : a <= 300 ? 'Very unhealthy' : 'Hazardous');

// ---------- Tides (NOAA CO-OPS, U.S. coasts) ----------
async function loadTides(lat, lon, tz) {
  let cached = store.get('wx.tidestations', null);
  if (!cached || Date.now() - cached.at > 30 * 864e5) {
    const j = await getJSON('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions', { timeout: 20000 });
    cached = { at: Date.now(), s: (j.stations || []).map(s => [s.id, s.name, +s.lat, +s.lng]) };
    store.set('wx.tidestations', cached);
  }
  let best = null, bd = Infinity;
  for (const s of cached.s) { const d = distKm(lat, lon, s[2], s[3]); if (d < bd) { bd = d; best = s; } }
  if (!best || bd > 50) return null;
  const begin = ymd(new Date(), tz).replace(/-/g, '');
  const u = new URLSearchParams({ product: 'predictions', application: 'personal_weather_app', begin_date: begin, range: '48', datum: 'MLLW', station: best[0], time_zone: 'lst_ldt', units: US() ? 'english' : 'metric', interval: 'hilo', format: 'json' });
  const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${u}`);
  const nowStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace('T', ' ');
  const ev = (j.predictions || []).filter(p => p.t >= nowStr).slice(0, 4).map(p => {
    const [d, hm] = p.t.split(' ');
    const [h, m] = hm.split(':').map(Number);
    const sameDay = d === nowStr.slice(0, 10);
    return { type: p.type === 'H' ? 'High' : 'Low', time: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, day: sameDay ? 'Today' : 'Tomorrow', height: `${(+p.v).toFixed(1)} ${US() ? 'ft' : 'm'}` };
  });
  return ev.length ? { station: best[1], id: best[0], km: bd, events: ev } : null;
}
function distKm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

// ---------- Forecast discussion ----------
function parseAFD(text) {
  const body = text.replace(/\r/g, '');
  const re = /^\.([A-Z][A-Z0-9 /&()-]*?)\.\.\.(.*)$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(body))) heads.push({ title: m[1].trim(), start: m.index, headEnd: m.index + m[0].length, rest: m[2] });
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : body.length;
    let chunk = `${h.rest}\n${body.slice(h.headEnd, end)}`;
    chunk = chunk.split(/^&&\s*$/m)[0].split(/^\$\$/m)[0];
    if (/WATCHES|WARNINGS/.test(h.title)) return { title: 'Watches, warnings & advisories', paras: unwrap(chunk) };
    return { title: h.title.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(Sgx|Lox|Hnx|Nws|Afd)\b/g, s => s.toUpperCase()), paras: unwrap(chunk) };
  }).filter(s => s.paras.length);
}
function unwrap(t) {
  return t.split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).filter(Boolean)).filter(p => p.length).map(lines => {
    const out = [];
    lines.forEach(l => { if (/^([-*•]|\d+\))\s/.test(l) || !out.length) out.push(l); else out[out.length - 1] += ` ${l}`; });
    return out.join('\n');
  });
}
const JARGON = [
  ['PoP', 'Probability of precipitation — chance of measurable rain at a given spot.'],
  ['QPF', 'Quantitative precipitation forecast — expected rain amount.'],
  ['CAPE', 'Energy available for thunderstorms; higher means stronger storms possible.'],
  ['Trough / low', 'A dip in the jet stream; brings clouds, cooler air and storms.'],
  ['Ridge / high', 'A bulge in the jet stream; brings warmer, drier, calmer weather.'],
  ['Marine layer', 'Cool, moist ocean air capped by warmer air — the source of May Gray/June Gloom.'],
  ['Onshore / offshore', 'Wind from the ocean (cooler, moister) vs. from inland (warm, dry; e.g. Santa Ana).'],
  ['Shortwave', 'A smaller ripple in the jet stream that can trigger showers.'],
  ['Ensembles', 'Many runs of a model with slight tweaks; agreement means higher confidence.'],
  ['GFS / ECMWF', 'The U.S. and European global forecast models.'],
  ['NBM', 'National Blend of Models — NWS’s statistical blend of many models.'],
  ['VFR / MVFR / IFR', 'Aviation flying conditions, from good to poor visibility/cloud ceilings.'],
  ['Z / UTC', 'Universal time. Pacific Standard Time = Z minus 8 hours.'],
];

// ---------- Rendering ----------
// Places are Home, Current location and saved locations. Tabs are groups (a named set of places you
// swipe between, e.g. "Los Angeles": Westside, Downtown, Valley) or single places not in a group.
// Home and Current keep fixed ids; their custom names live in wx.labels. wx.order lists tab ids left
// to right; wx.groups is [{ id, name, members: [place ids] }]. Current location can't join a group.
const DEFAULT_LABEL = { home: 'Home', here: 'Current' };
const tabLabel = l => l.kind === 'home' || l.kind === 'gps' ? (state.labels[l.id] || DEFAULT_LABEL[l.id]) : l.name;
const tabIcon = l => l.id === 'home' ? '🏠 ' : l.id === 'here' ? '📍 ' : '';
function allPlaces() {
  return [{ ...HOME, name: state.labels.home || HOME.name }, { ...HERE, name: state.labels.here || HERE.name }, ...state.saved];
}
const placeById = id => allPlaces().find(l => l.id === id);
const groupById = id => state.groups.find(g => g.id === id);
const groupOf = id => state.groups.find(g => g.members.includes(id));
// Keep groups consistent with the places that exist: no unknown or duplicate members, no empty groups.
function cleanGroups(groups, savedIds) {
  const ok = new Set(['home', ...savedIds]), seen = new Set(), out = [];
  for (const g of groups || []) {
    const members = (g.members || []).filter(id => ok.has(id) && !seen.has(id) && seen.add(id));
    if (members.length) out.push({ id: g.id, name: g.name, members });
  }
  return out;
}
function saveGroups(groups) { state.groups = cleanGroups(groups, state.saved.map(l => l.id)); store.set('wx.groups', state.groups); }
function allTabs() {
  const grouped = new Set(state.groups.flatMap(g => g.members));
  const items = [...state.groups.map(g => ({ id: g.id, group: g })), ...allPlaces().filter(l => !grouped.has(l.id)).map(l => ({ id: l.id, place: l }))];
  const byId = new Map(items.map(t => [t.id, t])), out = [];
  for (const id of state.order) if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
  return out.concat([...byId.values()]);
}
function saveOrder(ids) { state.order = ids; store.set('wx.order', ids); }
const tabIds = () => allTabs().map(t => t.id);
const tabOf = id => groupOf(id)?.id || id;
// Last place viewed in each group (this device only), so tapping a group tab returns there.
const groupLast = () => store.get('wx.groupLast', {});

function renderTabs() {
  const tabs = $('#tabs'), cur = tabOf(state.active);
  tabs.innerHTML = allTabs().map(t => `<button class="tab${t.group ? ' grp' : ''}" data-id="${esc(t.id)}" aria-current="${t.id === cur}">${t.group ? esc(t.group.name) : tabIcon(t.place) + esc(tabLabel(t.place))}</button>`).join('');
  tabs.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => { if (b.dataset.held) { delete b.dataset.held; return; } go(b.dataset.id); };
    // Long-press a tab to jump to the reorder/rename list.
    let t = null;
    const cancel = () => clearTimeout(t);
    b.addEventListener('pointerdown', () => { t = setTimeout(() => { b.dataset.held = '1'; openSettings('locations'); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, cancel));
    b.addEventListener('contextmenu', e => e.preventDefault());
  });
  $('.tab[aria-current="true"]', tabs)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function go(id, slide = 0) {
  const g = groupById(id);
  if (g) id = g.members.includes(groupLast()[g.id]) ? groupLast()[g.id] : g.members[0];
  if (!placeById(id)) id = 'home';
  const grp = groupOf(id);
  if (grp) { const gl = groupLast(); gl[grp.id] = id; store.set('wx.groupLast', gl); }
  state.active = id;
  state.slide = slide;
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  store.set('wx.active', id);
  renderTabs();
  show(isCached(placeById(id)) ? 'swap' : false);
}
// Step to the previous/next place in the current group (swipe or arrow keys).
function stepPlace(dir) {
  const g = groupOf(state.active);
  if (!g || g.members.length < 2) return;
  const i = g.members.indexOf(state.active), j = i + dir;
  if (j < 0 || j >= g.members.length) { const m = $('#main'); m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); return; }
  go(g.members[j], dir);
}
function isCached(loc) {
  if (!loc || loc.kind === 'gps') return false;
  const hit = state.cache.get(`${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}|${state.settings.units}`);
  return !!hit && Date.now() - hit.at < CACHE_MS;
}
const locById = placeById;

async function show(force) {
  const loc = locById(state.active);
  const token = ++state.token;
  stopRadar();
  const main = $('#main');
  // 'swap' = switching to a place already in the cache: no loading placeholders, no refetch.
  if (!state.cache.size || (force !== 'quiet' && force !== 'swap')) main.innerHTML = '<div class="skel"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:300px"></div>';
  try {
    const view = await loadLocation(loc, force === true || force === 'quiet');
    if (token !== state.token) return;
    render(view, loc);
  } catch (e) {
    if (token !== state.token) return;
    main.innerHTML = `<div class="err"><b>Couldn’t load the weather.</b><br>${esc(e.message || e)}</div><button class="btn" id="retry">Try again</button>`;
    $('#retry').onclick = () => show(true);
  }
}

const hdr = (icon, title, aside) => `<h2><span class="ht">${ui(icon)}${title}</span>${aside ? `<span class="aside">${aside}</span>` : ''}</h2>`;
const toF = x => (US() ? x : x * 9 / 5 + 32);
const GLANCE_ICON = { '☀️': 'sun', '🌂': 'umbrella', '🌧️': 'umbrella', '💨': 'wind', '🌇': 'sunset', '🌅': 'sunrise', '🧴': 'sun', '🌡️': 'thermo' };

function renderHourly(v) {
  const H = v.hourly, tz = v.tz, CW = 58, W = H.length * CW, CH = 76;
  const temps = H.map(h => h.temp), tmin = Math.min(...temps), tmax = Math.max(...temps), span = Math.max(tmax - tmin, 4);
  const pts = H.map((h, i) => [i * CW + CW / 2, 22 + (1 - (h.temp - tmin) / span) * 40]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0]},${CH} L${pts[0][0]},${CH} Z`;
  const stops = H.map((h, i) => `<stop offset="${(i / Math.max(H.length - 1, 1)).toFixed(3)}" stop-color="${tempColor(toF(h.temp))}"/>`).join('');
  return `<div class="hscroll"><div class="hgrid" style="width:${W}px">
    <div class="hrow">${H.map((h, i) => `<div class="hc${i === 0 ? ' now' : ''}" title="${esc(h.text)}"><div class="t">${i === 0 ? 'Now' : esc(fmtHour(h.t, tz))}</div>${wxIcon(h.kind, 'sm')}</div>`).join('')}</div>
    <svg class="hcurve" width="${W}" height="${CH}" viewBox="0 0 ${W} ${CH}" aria-hidden="true">
      <defs><linearGradient id="gTline" x1="0" x2="1">${stops}</linearGradient>
      <linearGradient id="gTarea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#gTarea)"/><path d="${line}" stroke="url(#gTline)" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1].toFixed(1)}" r="${i === 0 ? 4.5 : 2.6}" class="${i === 0 ? 'tnow' : 'tdot'}"/><text x="${p[0]}" y="${(p[1] - 9).toFixed(1)}" class="tlab">${H[i].temp}°</text>`).join('')}
    </svg>
    <div class="hrow pops">${H.map(h => `<div class="hc"><div class="pbar"><i style="height:${Math.max(h.pop, 0)}%;opacity:${h.pop >= 10 ? clamp(.35 + h.pop / 140, .35, 1) : 0}"></i></div><div class="p">${h.pop >= 10 ? h.pop + '%' : ''}</div></div>`).join('')}</div>
  </div></div>`;
}

function renderDays(v) {
  const days = v.days.slice(0, 8), n = v.now;
  const all = days.flatMap(d => [d.hiN, d.loN]).filter(x => x != null);
  const curT = n.tempC != null ? Math.round(T(n.tempC)) : null;
  if (curT != null) all.push(curT);
  const wmin = Math.min(...all), wmax = Math.max(...all), span = Math.max(wmax - wmin, 1);
  const pos = t => ((t - wmin) / span) * 100;
  return days.map((d, i) => {
    const lo = d.loN ?? d.hiN, hi = d.hiN ?? d.loN;
    const left = pos(lo), width = Math.max(pos(hi) - left, 0);
    const bar = d.hiN != null && d.loN != null
      ? `<i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:linear-gradient(90deg,${tempColor(toF(lo))},${tempColor(toF(hi))})"></i>`
      : `<i class="solo" style="left:calc(${left.toFixed(1)}% - 4px);background:${tempColor(toF(lo))}"></i>`;
    const dot = i === 0 && curT != null ? `<b class="cur" style="left:${pos(curT).toFixed(1)}%" title="Now ${curT}°"></b>` : '';
    const amt = d.precipMm != null && d.precipMm >= 0.25 ? ` · about ${esc(fmtLen(d.precipMm))}` : '';
    return `<details class="day"><summary>
      <span class="dn">${esc(d.name)}</span><span class="de">${wxIcon(d.kind, 'sm')}</span>
      <span class="dp">${d.pop >= 20 ? `${d.pop}%` : ''}</span>
      <span class="dlo">${d.loN != null ? `${d.loN}°` : ''}</span>
      <span class="rbar">${bar}${dot}</span>
      <span class="dhi">${d.hiN != null ? `${d.hiN}°` : ''}</span></summary>
      <div class="detail"><p class="dshort">${esc(d.short)}${d.pop >= 10 ? ` · ${d.pop}% chance of precipitation` : ''}${amt}</p>
      ${d.detail.map(([nm, tx]) => `<p><b>${esc(nm)}:</b> ${esc(tx)}</p>`).join('')}${d.gustKmh != null && spdNum(d.gustKmh) >= (US() ? 20 : 32) && v.kind === 'us' ? `<p class="muted">Peak gusts near ${esc(fmtSpd(d.gustKmh))}.</p>` : ''}</div>
    </details>`;
  }).join('');
}

function renderConditions(v) {
  const n = v.now;
  const sp = n.windKmh != null ? Math.round(spdNum(n.windKmh)) : '–';
  const uv = n.uv != null ? n.uv : null, aqi = n.aqi != null ? n.aqi : null;
  const presTxt = n.presHpa == null ? '–' : US() ? (n.presHpa * 0.02953).toFixed(2) : Math.round(n.presHpa);
  const visMi = n.visM != null ? n.visM / 1609.34 : null;
  const visWord = visMi == null ? '' : visMi >= 9 ? 'Clear view' : visMi >= 5 ? 'Slight haze' : visMi >= 2 ? 'Hazy' : visMi >= 0.6 ? 'Mist / fog' : 'Dense fog';
  const g = (icon, title, body, foot) => {
    if (!foot && /class="gbig">–</.test(body)) foot = 'Not available right now';
    return `<div class="gtile"><div class="gk">${ui(icon)}${title}</div>${body}${foot ? `<div class="gs">${foot}</div>` : ''}</div>`;
  };
  return `<div class="ggrid">
    ${g('wind', 'Wind', windDial(n.windDir, sp, US() ? 'mph' : 'km/h'), `${n.windDir != null ? `From the ${compass(n.windDir)}` : ''}${n.gustKmh ? ` · gusts ${esc(fmtSpd(n.gustKmh))}` : ''}`)}
    ${g('sun', 'UV index', uv == null ? '<div class="gbig">–</div>' : arcGauge(uv / 11, [[0, '#4cc38a'], [.3, '#f5d547'], [.55, '#ff9f43'], [.8, '#ff5b5b'], [1, '#a463f2']], Math.round(uv), uvCat(uv)), n.uvMax != null ? `Peak today ${Math.round(n.uvMax)}` : '')}
    ${g('leaf', 'Air quality', aqi == null ? '<div class="gbig">–</div>' : arcGauge(aqi / 300, [[0, '#4cc38a'], [.17, '#f5d547'], [.33, '#ff9f43'], [.5, '#ff5b5b'], [.67, '#a463f2'], [1, '#8b2c4a']], Math.round(aqi), aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : 'Unhealthy'), aqiCat(aqi ?? 0) && aqi != null ? `U.S. AQI · ${aqiCat(aqi)}` : 'U.S. AQI')}
    ${g('drop', 'Humidity', `<div class="gbig">${n.rh != null ? Math.round(n.rh) + '%' : '–'}</div>${n.rh != null ? barMeter(n.rh / 100, ['#f3c27a', '#7fd6c2', '#4aa3ff']) : ''}`, n.dewC != null ? `Dew point ${fmtT(n.dewC)}` : '')}
    ${g('gauge', 'Pressure', n.presHpa == null ? '<div class="gbig">–</div>' : arcGauge((n.presHpa - 985) / 55, [[0, '#7aa2ff'], [.5, '#c9d6e8'], [1, '#ffcf7a']], presTxt, US() ? 'inHg' : 'hPa'), n.presHpa != null ? (n.presHpa < 1005 ? 'Low — unsettled' : n.presHpa > 1022 ? 'High — settled' : 'Near normal') : '')}
    ${g('eye', 'Visibility', `<div class="gbig">${esc(fmtVis(n.visM))}</div>${visMi != null ? barMeter(Math.min(visMi, 10) / 10, ['#9aa7b8', '#cfe3f5']) : ''}`, visWord)}
  </div>`;
}

function render(v, loc) {
  document.documentElement.dataset.sky = skyFor(v);
  state.lastView = v;
  const n = v.now, tz = v.tz;
  const firstDay = v.days[0];
  const hiT = firstDay?.hi, loT = firstDay?.lo || v.days[1]?.lo;
  const lede = rainSentence(v.hourly, tz, v.qpf24)?.[1];
  const html = [];

  if (v.notice) html.push(`<div class="note">${esc(v.notice)}</div>`);
  if (loc && state.justAdded === loc.id) {
    state.justAdded = null;
    const st = summaryState(v);
    if (st === 'off') html.push(`<section class="card sumcta top"><p>${ui('doc')}<span>This spot is in the NWS <b>${esc(areaName(v))}</b> forecast area, which doesn’t have plain-English discussion summaries yet.</span></p>${enableBtn(v, loc)}</section>`);
  }

  const grp = loc && groupOf(loc.id);
  if (grp && grp.members.length > 1) {
    html.push(`<nav class="pdots" aria-label="${esc(grp.name)} places">${grp.members.map(id => { const p = placeById(id); return `<button type="button" data-go="${esc(id)}" aria-label="${esc(tabLabel(p))}" aria-current="${id === loc.id}"><i></i></button>`; }).join('')}</nav>`);
  }
  html.push(`<section class="card hero">
    <p class="place">${esc(loc ? tabLabel(loc) : v.name)}</p>
    <div class="sub">${esc(v.sub)}${v.kind === 'us' ? ' · NWS ' + esc(v.office) : ''}</div>
    <div class="nowrow">
      <div class="hicon">${wxIcon(n.kind, 'anim')}</div>
      <div class="big">${fmtT(n.tempC)}</div>
      <div class="nowtxt"><div class="cond">${esc(n.text || '')}</div>
        <div class="hl">Feels like ${fmtT(n.feelsC)}</div>
        ${hiT || loT ? `<div class="hl hlr">${hiT ? `<span>H ${esc(hiT)}</span>` : ''}${loT ? `<span>L ${esc(loT)}</span>` : ''}</div>` : ''}</div>
    </div>
    ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
    <div class="meta"><span class="fine">${n.time ? `${/^Open-Meteo/.test(n.source) ? 'Model data' : 'Observed'} ${esc(ago(n.time))} · ${esc(n.source)}` : ''}</span>
      <button class="btn ghost" id="refresh" title="Refresh">${ui('refresh')} Refresh</button></div>
  </section>`);

  v.alerts.forEach(a => {
    const sev = /Extreme|Severe/.test(a.severity) || /Warning/.test(a.event);
    html.push(`<details class="alert${sev ? ' severe' : ''}"><summary>${ui('alert')}<span><b>${esc(a.event)}</b><span class="when">${a.onset ? esc(fmtDayTime(new Date(a.onset), tz)) : ''}${a.ends || a.expires ? ' – ' + esc(fmtDayTime(new Date(a.ends || a.expires), tz)) : ''} · tap for details</span></span></summary>
      <div class="body">${esc(a.description || '')}${a.instruction ? '\n\n' + esc(a.instruction) : ''}</div></details>`);
  });

  if (v.glance.length) html.push(`<section class="card">${hdr('clock', 'Next 24 hours')}<ul class="glance">${v.glance.map(([i, t]) => `<li><span class="ic">${GLANCE_ICON[i] ? ui(GLANCE_ICON[i]) : i}</span><span>${t}</span></li>`).join('')}</ul></section>`);

  if (v.hourly.length) html.push(`<section class="card">${hdr('clock', 'Hourly', 'temperature · chance of rain')}${renderHourly(v)}</section>`);

  html.push(`<section class="card">${hdr('radar', 'Radar', '<span id="radarSrc"></span>')}
    <div id="radar"></div>
    <div class="radar-ctl">
      <button class="btn" id="rPlay" aria-label="Play or pause">▶︎</button>
      <input type="range" id="rSlide" min="0" max="0" value="0" aria-label="Radar time">
      <span class="radar-label" id="rLabel">Loading…</span>
      ${v.kind === 'us' ? '<div class="seg" id="rMode"><button type="button" data-m="past" aria-pressed="true">Past hour</button><button type="button" data-m="future" aria-pressed="false">Next 12 h</button></div>' : ''}
    </div>
    <div class="legend"><span>Light</span><span class="ramp"></span><span>Heavy</span></div>
    <p class="fine" id="radarNote"></p>
  </section>`);

  if (v.days.length) html.push(`<section class="card">${hdr('calendar', '7-day forecast', v.kind === 'us' ? 'NWS · tap a day' : 'Open-Meteo · tap a day')}${renderDays(v)}</section>`);

  html.push(v.kind === 'us' ? renderAFD(v) : renderPlain(v));

  const s = v.sun, m = v.moon;
  const dl = s.delta == null ? '' : ` · ${s.delta >= 0 ? '+' : '−'}${Math.abs(s.delta).toFixed(1)} min vs. yesterday`;
  html.push(`<section class="card">${hdr('sunrise', 'Sun &amp; moon')}<div class="sungrid">
    <div class="sunbox">${sunArc(s.rise, s.set)}
      <div class="sunlabels"><div><span class="sl">${ui('sunrise')}Sunrise</span><b>${s.rise ? esc(fmtTime(s.rise, tz)) : '—'}</b><small>${s.dawn ? `First light ${esc(fmtTime(s.dawn, tz))}` : ''}</small></div>
      <div class="r"><span class="sl">${ui('sunset')}Sunset</span><b>${s.set ? esc(fmtTime(s.set, tz)) : '—'}</b><small>${s.dusk ? `Last light ${esc(fmtTime(s.dusk, tz))}` : ''}</small></div></div>
      <p class="fine center">${s.length != null ? `${durHM(s.length)} of daylight${esc(dl)}` : ''}</p></div>
    <div class="moonbox">${moonDisc(m.age)}<div class="mtxt"><b>${esc(m.name)}</b><span>${Math.round(m.illum * 100)}% illuminated</span>
      <span class="fine">Full ${esc(dtf(tz, { month: 'short', day: 'numeric' }).format(m.nextFull))} · New ${esc(dtf(tz, { month: 'short', day: 'numeric' }).format(m.nextNew))}</span></div></div>
  </div></section>`);

  html.push(`<section class="card">${hdr('gauge', 'Conditions')}${renderConditions(v)}</section>`);

  if (v.tides) {
    html.push(`<section class="card">${hdr('waves', 'Tides', `${esc(v.tides.station)} · ${Math.round(v.tides.km)} km`)}<div class="tides">${v.tides.events.map(e => `<div class="tile tide ${e.type === 'High' ? 'hi' : 'lo'}"><div class="k">${esc(e.day)}</div><div class="v">${e.type === 'High' ? '▲' : '▼'} ${esc(e.time)}</div><div class="s">${esc(e.type)} · ${esc(e.height)}</div></div>`).join('')}</div></section>`);
  }

  if (v.kind === 'us') html.push(`<section class="card" id="clim">${hdr('drop', 'Rainfall & records')}<div class="climbody"><p class="fine">Loading season rainfall and records…</p></div>
    <div class="links climlinks">${climateLinks(v).map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}</div></section>`);
  html.push(`<section class="card">${hdr('link', 'More detail')}<div class="links">${links(v).map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}</div></section>`);
  html.push(`<footer class="src fine">Updated ${esc(fmtTime(v.loadedAt, tz))} (${esc(tz.replace(/_/g, ' '))}) · ${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</footer>`);

  let k = 0;
  $('#main').innerHTML = html.join('').replace(/<(section|details) class="(card|alert)/g, (mm, tag, cls) => `<${tag} style="--i:${k++}" class="${cls}`);
  $('#refresh').onclick = () => show(true);
  wireEnableButtons();
  if (typeof fxFromView === 'function') fxFromView(v);
  setupRadar(v);
  if (v.kind === 'us') fillClimate(v, state.token);
  $('#main').querySelectorAll('.pdots button').forEach(b => b.onclick = () => { const g = groupOf(state.active); go(b.dataset.go, g ? Math.sign(g.members.indexOf(b.dataset.go) - g.members.indexOf(state.active)) : 0); });
  const mainEl = $('#main');
  mainEl.classList.remove('slide-next', 'slide-prev', 'bump');
  if (state.slide) { void mainEl.offsetWidth; mainEl.classList.add(state.slide > 0 ? 'slide-next' : 'slide-prev'); state.slide = 0; }
  // Load the neighboring places in this group in the background so swiping to them is instant.
  if (grp) {
    const i = grp.members.indexOf(loc.id), tok = state.token;
    setTimeout(() => { if (tok !== state.token) return; [grp.members[i + 1], grp.members[i - 1]].map(placeById).filter(Boolean).forEach(p => { if (!isCached(p)) loadLocation(p).catch(() => {}); }); }, 1200);
  }
}
// Swipe left/right on the page to move between the places in a group.
function setupSwipe() {
  const main = $('#main');
  let t0 = null;
  main.addEventListener('touchstart', e => {
    t0 = null;
    if (e.touches.length !== 1) return;
    const g = groupOf(state.active), t = e.touches[0];
    if (!g || g.members.length < 2) return;
    if (t.clientX < 24 || t.clientX > innerWidth - 24) return; // leave screen edges to the browser's back/forward swipe
    if (e.target.closest('.hscroll, #radar, .leaflet-container, input, select, textarea, button.ctl, .tides')) return;
    t0 = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, quick = Date.now() - t0.at < 700;
    t0 = null;
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy)) stepPlace(dx < 0 ? 1 : -1);
  }, { passive: true });
  main.addEventListener('touchcancel', () => { t0 = null; }, { passive: true });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') stepPlace(1); else if (e.key === 'ArrowLeft') stepPlace(-1);
  });
}
const tile = (k, v, s) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;

// ---------- Turning on summaries for a new NWS office ----------
// The button opens a prefilled GitHub issue; .github/workflows/enable-summaries.yml does the rest.
const PENDING_MS = 24 * 3600e3;
const GH_API = 'https://api.github.com';
const GH_WORKFLOW = 'enable-summaries.yml';
// Fine-grained token template: this account, Actions + Contents read/write, 1 year. The repo still has to be picked on GitHub.
const GH_TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: 'Weather app', description: 'Lets the weather app sync saved locations (locations.json) and turn on forecast summaries for new areas in mrjpb104/weather.',
  target_name: REPO.split('/')[0], expires_in: '365', actions: 'write', contents: 'write',
})}`;
const ghToken = () => store.get('wx.ghToken', '');
function pendingOffices() {
  const p = store.get('wx.sumPending', {}), now = Date.now();
  for (const k of Object.keys(p)) {
    if (typeof p[k] === 'number') p[k] = { at: p[k], via: 'issue' };
    if (now - p[k].at > PENDING_MS) delete p[k];
  }
  return p;
}
function setPending(office, via) { const p = pendingOffices(); p[office] = { at: Date.now(), via }; store.set('wx.sumPending', p); }
function summaryState(v) {
  if (v.summary) return 'ready';
  if (v.summaryOffices?.includes(v.office)) return 'on';
  return pendingOffices()[v.office] ? 'pending' : 'off';
}
const areaName = v => (v.afd?.text?.match(/National Weather Service ([^\n]+)/)?.[1] || v.office).trim().replace(/ ([A-Z]{2})$/, ', $1');
const placeOf = (v, loc) => { const nm = loc?.name || v.name || ''; return !v.sub || v.sub.startsWith(nm) ? v.sub || nm : `${nm} (${v.sub})`; };
const coordsOf = v => `${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}`;
function enableURL(v, loc) {
  const body = [`Office: ${v.office}`, `Area: ${areaName(v)}`, `Location: ${placeOf(v, loc)}`, `Coordinates: ${coordsOf(v)}`, '',
    'Sent from the weather app. Submitting this turns on plain-English forecast-discussion summaries for this office automatically; the issue closes itself when it’s done.'].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Enable summaries: ${v.office}`)}&body=${encodeURIComponent(body)}`;
}
// With a saved token the button turns summaries on directly; without one it opens a prefilled GitHub issue.
function enableBtn(v, loc, label) {
  const data = `data-enable="${esc(v.office)}" data-place="${esc(placeOf(v, loc))}" data-coords="${esc(coordsOf(v))}"`;
  const text = esc(label || `Turn on summaries for ${areaName(v)}`);
  if (ghToken()) return `<button type="button" class="btn primary sumbtn" ${data}>${text}</button><p class="fine sumerr" hidden></p>`;
  return `<a class="btn primary sumbtn" href="${esc(enableURL(v, loc))}" target="_blank" rel="noopener" ${data}>${text}</a>
    ${label ? '' : '<p class="fine">Opens a prefilled request on GitHub — tap <b>Create</b> and it’s set up automatically. <button type="button" class="linkbtn" data-gh-setup>Make this one tap</button></p>'}`;
}
async function dispatchEnable(office, place, coords) {
  const r = await fetch(`${GH_API}/repos/${REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main', inputs: { office, location: place, coords } }),
  });
  if (r.status !== 204) { const e = new Error(`GitHub said ${r.status}`); e.status = r.status; throw e; }
}
// After turning an office on, watch config.json (GitHub Pages) until it lists the office, then refresh.
let enableWatch = null;
function watchForOffice(office) {
  clearInterval(enableWatch);
  const t0 = Date.now();
  enableWatch = setInterval(async () => {
    if (Date.now() - t0 > 6 * 60e3) return clearInterval(enableWatch);
    try {
      const c = await getJSON(`config.json?t=${Date.now()}`, { cache: 'no-store' });
      if (c.summary_offices?.includes(office)) { clearInterval(enableWatch); state.cache.clear(); show('quiet'); }
    } catch { /* keep watching */ }
  }, 15000);
}
function wireEnableButtons() {
  document.querySelectorAll('[data-gh-setup]').forEach(b => b.onclick = () => openSettings('github'));
  document.querySelectorAll('[data-enable]').forEach(el => el.addEventListener('click', async () => {
    const office = el.dataset.enable;
    if (el.tagName === 'A') { setPending(office, 'issue'); state.cache.clear(); setTimeout(() => show('quiet'), 1500); watchForOffice(office); return; }
    const err = el.nextElementSibling;
    el.disabled = true; el.textContent = 'Turning on…';
    try {
      await dispatchEnable(office, el.dataset.place, el.dataset.coords);
      setPending(office, 'token');
      state.cache.clear(); show('quiet'); watchForOffice(office);
    } catch (e) {
      el.disabled = false; el.textContent = 'Try again';
      if (err) {
        err.hidden = false;
        err.innerHTML = e.status === 401 || e.status === 403 || e.status === 404
          ? 'Your saved GitHub access isn’t working (it may have expired or be missing the weather repo). <button type="button" class="linkbtn" data-gh-setup>Fix it in Settings</button>'
          : `Couldn’t reach GitHub (${esc(e.message)}). Check your connection and try again.`;
        err.querySelector('[data-gh-setup]')?.addEventListener('click', () => openSettings('github'));
      }
    }
  }));
}

// ---------- Settings: GitHub access for one-tap summaries ----------
function renderGh(msg) {
  const has = !!ghToken();
  $('#ghStatus').innerHTML = msg || (has
    ? '✓ GitHub access is saved on this device. Location changes made here sync to your other devices, and <b>Turn on summaries</b> works in one tap.'
    : 'Save a GitHub access token on this device so location changes made here reach your other devices, and <b>Turn on summaries</b> works in one tap. Without one, this device still gets your synced locations, but its own changes stay here.');
  $('#ghForm').hidden = has;
  $('#ghRemove').hidden = !has;
  $('#ghCreate').href = GH_TOKEN_URL;
}
async function saveGh() {
  const inp = $('#ghToken'), tok = inp.value.trim(), b = $('#ghSave');
  if (!tok) return;
  b.disabled = true; b.textContent = 'Checking…';
  try {
    const r = await fetch(`${GH_API}/repos/${REPO}/actions/workflows/${GH_WORKFLOW}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 401 ? 'GitHub didn’t accept that token. Check you copied all of it.' : r.status === 404 || r.status === 403
      ? `That token can’t see the ${REPO.split('/')[1]} repo’s workflows. On GitHub, edit the token: Repository access → Only select repositories → ${REPO.split('/')[1]}, and Actions → Read and write.`
      : `GitHub said ${r.status}. Try again.`);
    store.set('wx.ghToken', tok); inp.value = '';
    renderGh();
    syncNow();
  } catch (e) { renderGh(`<span class="bad">${esc(e.message)}</span>`); }
  b.disabled = false; b.textContent = 'Save';
}

// ---------- Sync: saved locations, tab names and order follow you across devices ----------
// The shared copy is locations.json in the repo (public, like config.json). Every device reads it;
// a device with GitHub access (Contents: read and write) also writes it. Each device keeps the last
// shared copy it saw (wx.syncBase) so changes merge three ways: edits made here since then win,
// everything else comes from the shared copy. Without GitHub access, this device's own edits stay
// on top of the shared copy until a device with access is used.
const SYNC_FILE = 'locations.json';
const sync = { sha: null, running: false, again: false, applying: false, timer: null, last: 0, status: '' };
const EMPTY_SYNC = { saved: [], order: [], labels: {}, groups: [] };
const syncData = d => ({ saved: d.saved, order: d.order, labels: d.labels, groups: d.groups || [] });
const sameSync = (a, b) => JSON.stringify(syncData(a)) === JSON.stringify(syncData(b));
function cleanSync(d) {
  const saved = (Array.isArray(d?.saved) ? d.saved : []).filter(l => l && typeof l.id === 'string' && typeof l.name === 'string' && Number.isFinite(+l.lat) && Number.isFinite(+l.lon))
    .map(l => ({ id: l.id, name: l.name, lat: +l.lat, lon: +l.lon, cc: String(l.cc || ''), admin: String(l.admin || ''), country: String(l.country || '') }));
  const order = (Array.isArray(d?.order) ? d.order : []).filter(x => typeof x === 'string');
  const labels = {};
  for (const k of ['home', 'here']) if (typeof d?.labels?.[k] === 'string' && d.labels[k]) labels[k] = d.labels[k];
  const groups = cleanGroups((Array.isArray(d?.groups) ? d.groups : []).filter(g => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.members))
    .map(g => ({ id: g.id, name: g.name, members: g.members.filter(x => typeof x === 'string') })), saved.map(l => l.id));
  return { saved, order, labels, groups, hasGroups: Array.isArray(d?.groups), updated: typeof d?.updated === 'string' ? d.updated : '' };
}
const localSync = () => cleanSync({ saved: state.saved, order: state.order, labels: state.labels, groups: state.groups });
const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64enc = t => { let s = ''; new TextEncoder().encode(t).forEach(c => (s += String.fromCharCode(c))); return btoa(s); };

// Three-way merge of this device's copy (local) onto the shared copy (remote), relative to base.
function mergeSync(base, local, remote) {
  const first = !base;
  base = base || EMPTY_SYNC;
  const B = new Map(base.saved.map(l => [l.id, l])), L = new Map(local.saved.map(l => [l.id, l])), R = new Map(remote.saved.map(l => [l.id, l]));
  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  const saved = [];
  for (const r of remote.saved) {
    if (B.has(r.id) && !L.has(r.id)) continue; // deleted here
    const l = L.get(r.id), b = B.get(r.id);
    saved.push(l && b && JSON.stringify(l) !== JSON.stringify(b) ? l : r); // edited here (e.g. renamed)
  }
  for (const l of local.saved) {
    if (R.has(l.id) || B.has(l.id)) continue;
    if (first && remote.saved.some(r => near(r, l))) continue; // first sync: same place already shared
    saved.push(l); // added here
  }
  const order = first ? (remote.order.length ? remote.order : local.order) : JSON.stringify(local.order) !== JSON.stringify(base.order) ? local.order : remote.order;
  const labels = {};
  for (const k of ['home', 'here']) {
    const v = first ? (remote.labels[k] || local.labels[k]) : local.labels[k] !== base.labels[k] ? local.labels[k] : remote.labels[k];
    if (v) labels[k] = v;
  }
  // Groups: if this device changed them since the last shared copy, this device's version wins; otherwise the shared one.
  const gs = x => JSON.stringify(x.groups || []);
  // (A shared copy written by an older version of the app has no groups at all: keep this device's.)
  const groups = cleanGroups(!remote.hasGroups || (first && !remote.groups.length) ? local.groups : first ? remote.groups : gs(local) !== gs(base) ? local.groups : remote.groups, saved.map(l => l.id));
  return { saved, order, labels, groups };
}
function applySync(d) {
  sync.applying = true;
  try {
    state.saved = d.saved; state.order = d.order; state.labels = d.labels; state.groups = d.groups || [];
    store.set('wx.saved', d.saved); store.set('wx.order', d.order); store.set('wx.labels', d.labels); store.set('wx.groups', state.groups);
  } finally { sync.applying = false; }
  if (!locById(state.active)) go('home'); else renderTabs();
  if ($('#dlgSettings').open && !$('#savedList input.ren')) renderSaved();
}
async function fetchSync() {
  // The GitHub API is up to date within seconds and gives the file's sha (needed to write); Pages lags a few minutes.
  for (const tok of [...new Set([ghToken(), ''])]) {
    try {
      const h = { Accept: 'application/vnd.github+json' };
      if (tok) h.Authorization = `Bearer ${tok}`;
      const r = await fetch(`${GH_API}/repos/${REPO}/contents/${SYNC_FILE}?ref=main&t=${Date.now()}`, { headers: h, cache: 'no-store' });
      if (r.status === 404) return { missing: true };
      if (r.ok) { const j = await r.json(); return { data: cleanSync(JSON.parse(b64dec(j.content))), sha: j.sha }; }
    } catch { /* try the next way */ }
  }
  try { return { data: cleanSync(await getJSON(`${SYNC_FILE}?t=${Date.now()}`, { cache: 'no-store' })) }; } catch { return null; }
}
function setSyncStatus(s) { sync.status = s; if ($('#dlgSettings').open) renderSyncStatus(); }
async function syncNow() {
  if (sync.running) { sync.again = true; return; }
  sync.running = true; sync.last = Date.now();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rem = await fetchSync();
      if (!rem) return setSyncStatus('offline');
      const remote = rem.missing ? cleanSync(EMPTY_SYNC) : rem.data;
      const base = store.get('wx.syncBase', null);
      const merged = mergeSync(base && cleanSync(base), localSync(), remote);
      if (!sameSync(merged, localSync())) applySync(merged);
      if (!rem.missing) store.set('wx.syncBase', remote);
      if (!rem.missing && sameSync(merged, remote)) return setSyncStatus('ok');
      if (rem.missing && !merged.saved.length && !Object.keys(merged.labels).length && !merged.order.length) return setSyncStatus('ok');
      if (!ghToken()) return setSyncStatus('local');
      if (!rem.missing && !rem.sha) return setSyncStatus('offline');
      const body = { ...merged, updated: new Date().toISOString() };
      const r = await fetch(`${GH_API}/repos/${REPO}/contents/${SYNC_FILE}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ message: 'Sync saved locations', content: b64enc(`${JSON.stringify(body, null, 2)}\n`), branch: 'main', ...(rem.sha ? { sha: rem.sha } : {}) }),
      }).catch(() => null);
      if (r?.ok) { store.set('wx.syncBase', body); return setSyncStatus('ok'); }
      if (r && (r.status === 409 || r.status === 422)) continue; // changed elsewhere meanwhile: merge again
      return setSyncStatus(r && [401, 403, 404].includes(r.status) ? 'noaccess' : 'offline');
    }
    setSyncStatus('offline');
  } finally {
    sync.running = false;
    if (sync.again) { sync.again = false; syncNow(); }
  }
}
function syncChanged() {
  if (sync.applying) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, 1500);
}
function renderSyncStatus() {
  const el = $('#syncStatus');
  if (!el) return;
  el.innerHTML = {
    ok: ghToken() ? '✓ Your locations, tab names and order sync across your devices and browsers.' : '✓ Synced from your other devices. To make changes here that reach them too, add GitHub access under <b>GitHub access</b> below.',
    local: 'Changes made here stay on this device. To send them to your other devices, add GitHub access under <b>GitHub access</b> below.',
    noaccess: 'Couldn’t save changes for your other devices: the saved GitHub token needs <b>Contents → Read and write</b> on the weather repo. Edit the token on GitHub, or add a new one below.',
    offline: 'Couldn’t reach GitHub to sync just now. Changes are kept here and sync next time.',
  }[sync.status] || 'Checking sync…';
}

function renderAFD(v) {
  const a = v.afd, s = v.summary, tz = v.tz;
  const parts = [`<section class="card">${hdr('doc', 'Forecast discussion', `NWS ${esc(v.office)} forecasters`)}`];
  const sIssued = s?.afd_issued ? new Date(s.afd_issued) : null;
  const extras = [];
  if (s && s.headline) {
    parts.push(`<p class="afd-head">${esc(s.headline)}</p>`);
    (s.sections || []).forEach(x => parts.push(`<div class="afd-sec"><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`));
    parts.push(`<p class="fine">Plain-English summary by Claude of the discussion issued ${sIssued ? esc(fmtStamp(sIssued, tz)) : '—'}.</p>`);
    if (a && sIssued && a.issued - sIssued > 5 * 60e3) parts.push(`<div class="note">A newer discussion was issued ${esc(fmtStamp(a.issued, tz))}. The summary refreshes at the next scheduled update; the latest original text is below.</div>`);
    if (s.coast) extras.push(['Coast, beaches &amp; marine', `<p>${esc(s.coast)}</p>`]);
    const wf = (s.watch_for || []).map(x => `<p>• ${esc(x)}</p>`).join('');
    if (wf || s.confidence) extras.push(['Worth watching &amp; confidence', `${wf}${s.confidence ? `<p><b>Confidence:</b> ${esc(s.confidence)}</p>` : ''}`]);
  } else {
    const st = summaryState(v);
    if (st === 'on') parts.push(`<div class="sumcta"><p>Plain-English summaries are on for the NWS ${esc(areaName(v))} area. The first one arrives within about an hour; the original discussion is below.</p></div>`);
    else if (st === 'pending') parts.push(pendingOffices()[v.office].via === 'token'
      ? `<div class="sumcta"><p>Turning on summaries for the NWS ${esc(areaName(v))} area — this takes a minute or two. The first summary follows within about an hour.</p></div>`
      : `<div class="sumcta"><p>Turning on summaries for the NWS ${esc(areaName(v))} area. Once you’ve tapped <b>Create</b> on GitHub it finishes in a minute or two, and the first summary follows within about an hour.</p>${ghToken() ? enableBtn(v, null, 'Turn on now') : enableBtn(v, null, 'Open the request again')}</div>`);
    else parts.push(`<div class="sumcta"><p>No plain-English summary for the NWS ${esc(areaName(v))} forecast area yet. The original discussion is below.</p>${enableBtn(v, null)}</div>`);
  }
  if (a) {
    const secs = parseAFD(a.text || '');
    const extraHTML = extras.length ? `<div class="afd-group"><h4>More from the summary</h4>${extras.map(([t, h]) => `<details><summary>${t}</summary><div class="rawtext">${h}</div></details>`).join('')}</div>` : '';
    parts.push(`<div class="afd-raw">${extraHTML}<div class="afd-group"><h4>Original NWS discussion <span>issued ${esc(fmtStamp(a.issued, tz))}</span></h4>${secs.map((x, i) => `<details${!s && i === 0 ? ' open' : ''}><summary>${esc(x.title)}</summary><div class="rawtext">${x.paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div></details>`).join('')}
      <details><summary>Jargon decoder</summary><dl class="jargon">${JARGON.map(([k, d]) => `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`).join('')}</dl></details></div></div>`);
  } else parts.push(`<div class="afd-raw">${extras.length ? `<div class="afd-group"><h4>More from the summary</h4>${extras.map(([t, h]) => `<details><summary>${t}</summary><div class="rawtext">${h}</div></details>`).join('')}</div>` : ''}</div><p class="fine">The latest original discussion couldn’t be loaded right now.</p>`);
  parts.push('</section>');
  return parts.join('');
}

const NATIONAL = {
  DE: ['Deutscher Wetterdienst (DWD)', 'https://www.dwd.de/EN/'], FR: ['Météo-France', 'https://meteofrance.com/'], GB: ['Met Office', 'https://www.metoffice.gov.uk/'],
  IE: ['Met Éireann', 'https://www.met.ie/'], ES: ['AEMET', 'https://www.aemet.es/en/portada'], IT: ['Meteo Aeronautica Militare', 'https://www.meteoam.it/'],
  NL: ['KNMI', 'https://www.knmi.nl/'], BE: ['RMI Belgium', 'https://www.meteo.be/en'], CH: ['MeteoSwiss', 'https://www.meteoswiss.admin.ch/'],
  AT: ['GeoSphere Austria', 'https://www.geosphere.at/'], PT: ['IPMA', 'https://www.ipma.pt/en/'], DK: ['DMI', 'https://www.dmi.dk/'],
  NO: ['MET Norway (Yr)', 'https://www.yr.no/en'], SE: ['SMHI', 'https://www.smhi.se/en'], FI: ['FMI', 'https://en.ilmatieteenlaitos.fi/'],
  IS: ['Icelandic Met Office', 'https://en.vedur.is/'], CZ: ['CHMI', 'https://www.chmi.cz/'], PL: ['IMGW', 'https://meteo.imgw.pl/'],
  GR: ['HNMS', 'https://www.emy.gr/'], JP: ['Japan Meteorological Agency', 'https://www.jma.go.jp/bosai/en_forecast/'],
  KR: ['Korea Meteorological Administration', 'https://www.weather.go.kr/w/eng/'], CA: ['Environment Canada', 'https://weather.gc.ca/'],
  MX: ['SMN Mexico', 'https://smn.conagua.gob.mx/'], AU: ['Bureau of Meteorology', 'https://www.bom.gov.au/'], NZ: ['MetService', 'https://www.metservice.com/'],
};
const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LT LU MT NL NO PL PT RO RS SK SI ES SE CH GB'.split(' '));

function renderPlain(v) {
  const nat = NATIONAL[v.cc];
  return `<section class="card">${hdr('doc', 'The week in plain English', 'from model data')}
    <ul class="glance">${(v.plain || []).map(t => `<li><span class="ic">•</span><span>${esc(t)}</span></li>`).join('')}</ul>
    <p class="fine">Outside the U.S. there’s no NWS forecaster discussion. This summary is generated from Open-Meteo’s blend of national weather service models.
    For official forecasts and warnings, check ${nat ? `<a href="${nat[1]}" target="_blank" rel="noopener">${esc(nat[0])}</a>` : '<a href="https://worldweather.wmo.int/en/home.html" target="_blank" rel="noopener">the country’s national weather service (WMO directory)</a>'}${EU.has(v.cc) ? ' or <a href="https://www.meteoalarm.org/" target="_blank" rel="noopener">MeteoAlarm</a> for European warnings' : ''}.</p></section>`;
}

// Office-wide climate products: every NWS forecast office issues PNS and RER, and NOWData covers all offices.
function climateLinks(v) {
  const o = v.office, prod = c => `https://forecast.weather.gov/product.php?site=${o}&issuedby=${o}&product=${c}&format=CI&version=1&glossary=0`;
  return [
    ['Storm rainfall totals', prod('PNS')],
    ['Newly set records', prod('RER')],
    ['NOWData (more climate tables)', `https://www.weather.gov/wrh/climate?wfo=${o.toLowerCase()}`],
  ];
}

// ---------- Rainfall & records ----------
// ACIS is the NOAA Regional Climate Centers' data service — the same data NWS NOWData shows.
// Season totals run on the water year (Oct 1 – Sep 30), the rain season the NWS uses in the West.
const ACIS = 'https://data.rcc-acis.org';
async function acis(method, params, timeout = 20000) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // Form-encoded body keeps this a "simple" cross-origin request (no CORS preflight).
    const r = await fetch(`${ACIS}/${method}`, { method: 'POST', body: new URLSearchParams({ params: JSON.stringify(params) }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`Climate data HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  } finally { clearTimeout(t); }
}
const acisNum = x => { const a = Array.isArray(x) ? x[0] : x; if (a == null || a === 'M' || a === 'S' || a === '') return null; if (a === 'T') return 0; const n = parseFloat(a); return Number.isFinite(n) ? n : null; };
const acisDate = x => (Array.isArray(x) && typeof x[1] === 'string' && /^\d{4}-\d\d-\d\d/.test(x[1]) ? x[1] : null);
const isoDay = (tz, d = new Date()) => { const p = Object.fromEntries(dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const isoAdd = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10);
const prettyDate = (iso, year = true) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
const climT = f => (f == null ? '—' : `${Math.round(US() ? f : (f - 32) * 5 / 9)}°`);
const climR = i => (i == null ? '—' : US() ? `${i.toFixed(2)} in` : `${Math.round(i * 25.4)} mm`);
const pctOf = (a, b) => (a != null && b > 0.05 ? `${Math.round(a / b * 100)}% of normal` : '');
const nameCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Ap|Nas|Mcas|Afb|Wso|Intl|Faa)\b/g, m => m.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase()).replace(/\bArea\b/, 'area');

// Nearby stations with a long record (30+ years) that are still reporting. Where an airport has a
// "threaded" NWS climate record (ThreadEx — the official city record NWS climate reports use, often
// going back to the 1800s), that record is used instead.
async function climateStations(lat, lon, today, elevM) {
  const key = `wx.climSt3.${lat.toFixed(2)},${lon.toFixed(2)}`, hit = store.get(key);
  if (hit?.list?.length && Date.now() - hit.at < 7 * 864e5) return hit.list;
  const since = `${+today.slice(0, 4) - 25}${today.slice(4)}`, fresh = isoAdd(today, -10), recent = isoAdd(today, -60);
  const ft = elevM != null ? elevM * 3.281 : null;
  let all = [];
  for (const deg of [0.75, 1.5]) {
    const dl = deg / Math.cos(lat * Math.PI / 180);
    const j = await acis('StnMeta', { bbox: [lon - dl, lat - deg, lon + dl, lat + deg].map(x => x.toFixed(3)).join(','), elems: 'pcpn,maxt', meta: 'name,sids,ll,elev,valid_daterange' });
    const cur = [];
    for (const m of j.meta || []) {
      const [p, t] = m.valid_daterange || [];
      if (!m.ll || !p?.length || !t?.length || p[1] < recent || t[1] < recent) continue;
      const sids = m.sids || [], id = t => sids.find(x => x.endsWith(' ' + t))?.split(' ')[0];
      cur.push({ sid: id(6) || sids[0].split(' ')[0], faa: id(3), name: nameCase(m.name), km: distKm(lat, lon, m.ll[1], m.ll[0]), elev: m.elev ?? null, start: p[0] > t[0] ? p[0] : t[0], pStart: p[0], end: p[1] < t[1] ? p[1] : t[1] });
    }
    const faas = [...new Set(cur.sort((a, b) => a.km - b.km).map(c => c.faa).filter(f => /^[A-Z0-9]{3}$/.test(f || '')))].slice(0, 25);
    if (faas.length) {
      const t = await acis('StnMeta', { sids: faas.map(f => f + 'thr').join(','), elems: 'pcpn,maxt', meta: 'name,sids,valid_daterange' }).catch(() => null);
      for (const m of t?.meta || []) {
        const id = (m.sids?.[0] || '').split(' ')[0], c = cur.find(x => x.faa === id.replace(/thr$/, '')), [p, tt] = m.valid_daterange || [];
        if (c && p?.length && tt?.length && p[1] >= recent) Object.assign(c, { sid: id, name: nameCase(m.name), start: p[0] > tt[0] ? p[0] : tt[0], pStart: p[0], end: p[1] < tt[1] ? p[1] : tt[1], thr: true });
      }
    }
    all = cur.filter(c => c.start <= since);
    for (const c of all) { c.lag = c.end < fresh; c.score = c.km + (ft != null && c.elev != null ? Math.abs(c.elev - ft) / 40 : 0); }
    if (all.some(c => !c.lag)) break;
  }
  // Rank by distance plus an elevation penalty (1,000 ft difference counts like 25 km), so a coastal
  // spot isn't matched to an inland or mountain station just because it's a bit closer.
  all.sort((a, b) => a.score - b.score);
  let live = all.filter(c => !c.lag);
  const slow = all.filter(c => c.lag).slice(0, 2); // long-record co-op stations that report monthly: in the picker, never the default
  // Default: the best match, unless an official city record (usually a far longer history) scores within 45 km of it.
  const best = live[0], thr = live.find(c => c.thr);
  if (thr && best && thr !== best && thr.score <= best.score + 45) live = [thr, ...live.filter(c => c !== thr)];
  const list = [...live.slice(0, 5), ...slow];
  if (list.length) store.set(key, { at: Date.now(), list });
  return list;
}

const climMemo = new Map();
async function climateSeason(st, today) {
  const mk = `${st.sid}|${today}`, m0 = climMemo.get(mk);
  if (m0 && Date.now() - m0.at < 30 * 60e3) return m0.v;
  const v = await climateSeasonFetch(st, today);
  climMemo.set(mk, { at: Date.now(), v });
  return v;
}
async function climateSeasonFetch(st, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7), wy = m >= 10 ? y : y - 1;
  const wyStart = `${wy}-10-01`, prevStart = `${wy - 1}-10-01`, prevEnd = `${wy}-09-30`, jan1 = `${y}-01-01`;
  const [obs, nrm] = await Promise.all([
    acis('StnData', { sid: st.sid, sdate: prevStart, edate: today, elems: 'pcpn' }),
    acis('StnData', { sid: st.sid, sdate: prevStart, edate: today, elems: [{ name: 'pcpn', normal: '1' }] }),
  ]);
  const O = obs.data || [], N = new Map((nrm.data || []).map(r => [r[0], acisNum(r[1])]));
  const last = [...O].reverse().find(r => acisNum(r[1]) != null)?.[0] || today;
  const sum = (rows, a, b) => { let t = 0, miss = 0; for (const [d, x] of rows) if (d >= a && d <= b) { const n = acisNum(x); if (n == null) miss++; else t += n; } return { t, miss }; };
  const nsum = (a, b) => { let t = 0, k = 0; for (const [d, n] of N) if (d >= a && d <= b && n != null) { t += n; k++; } return k ? t : null; };
  const cur = sum(O, wyStart, last), prev = sum(O, prevStart, prevEnd), ytd = sum(O, jan1, last);
  return { wy, last, season: cur.t, seasonMiss: cur.miss, seasonNormal: nsum(wyStart, last), fullNormal: nsum(prevStart, prevEnd),
    prev: prev.miss > 15 ? null : prev.t, ytd: ytd.t, ytdNormal: nsum(jan1, last) };
}

// Records for today's calendar date (every year on record) and all-time extremes. Cached for a week (all-time) / a day (today's date).
async function climateRecords(st, today) {
  const mmdd = today.slice(5), key = `wx.climRec.${st.sid}`, hit = store.get(key, {});
  const out = {};
  // Today's date across all years: one value per year on this month/day.
  if (hit.day?.date === today) out.day = hit.day;
  else if (mmdd !== '02-29') {
    const first = +st.start.slice(0, 4) + (st.start.slice(5) > mmdd ? 1 : 0), sdate = `${first}-${mmdd}`;
    const one = name => acis('StnData', { sid: st.sid, sdate, edate: today, elems: [{ name, interval: [1, 0, 0], duration: 'dly' }] }).then(j => j.data || []);
    const norm = name => acis('StnData', { sid: st.sid, sdate: today, edate: today, elems: [{ name, normal: '1' }] }).then(j => acisNum(j.data?.[0]?.[1])).catch(() => null);
    const r = await Promise.allSettled([one('maxt'), one('mint'), one('pcpn'), norm('maxt'), norm('mint')]);
    const ext = (rows, hi) => { let b = null; for (const [d, x] of rows || []) { if (d.slice(5) !== mmdd || d === today) continue; const n = acisNum(x); if (n != null && (b == null || (hi ? n > b.v : n < b.v))) b = { v: n, years: [d.slice(0, 4)] }; else if (n != null && b && n === b.v) b.years.push(d.slice(0, 4)); } return b; };
    if (r[0].status === 'fulfilled' || r[1].status === 'fulfilled') {
      out.day = { date: today, hi: ext(val(r[0]), true), lo: ext(val(r[1]), false), wet: ext(val(r[2]), true), nHi: val(r[3]), nLo: val(r[4]) };
      if (out.day.wet && out.day.wet.v <= 0) out.day.wet = null;
    }
  }
  // All-time extremes, and wettest/driest rain seasons from monthly totals.
  if (hit.all && Date.now() - hit.all.at < 7 * 864e5) out.all = hit.all;
  else {
    const ex = (name, reduce) => acis('StnData', { sid: st.sid, sdate: 'por', edate: 'por', elems: [{ name, smry: { reduce, add: 'date' }, smry_only: 1 }] })
      .catch(() => acis('StnData', { sid: st.sid, sdate: 'por', edate: 'por', elems: [{ name, smry: reduce, smry_only: 1 }] }))
      .then(j => ({ v: acisNum(j.smry?.[0]), date: acisDate(j.smry?.[0]) }));
    const months = acis('StnData', { sid: st.sid, sdate: (st.pStart || st.start).slice(0, 7), edate: today.slice(0, 7), elems: [{ name: 'pcpn', interval: [0, 1], duration: 1, reduce: 'sum', maxmissing: '3' }] }).then(j => j.data || []);
    const r = await Promise.allSettled([ex('maxt', 'max'), ex('mint', 'min'), ex('pcpn', 'max'), months]);
    const seasons = {};
    for (const [d, x] of val(r[3]) || []) { const yy = +d.slice(0, 4), mo = +d.slice(5, 7), w = mo >= 10 ? yy : yy - 1, n = acisNum(x); (seasons[w] ||= { t: 0, n: 0, bad: false }); if (n == null) seasons[w].bad = true; else { seasons[w].t += n; seasons[w].n++; } }
    const full = Object.entries(seasons).filter(([, s]) => s.n === 12 && !s.bad).map(([w, s]) => ({ w: +w, t: s.t }));
    full.sort((a, b) => b.t - a.t);
    out.all = { at: Date.now(), hi: val(r[0]), lo: val(r[1]), wet: val(r[2]), wetSeason: full[0] || null, drySeason: full[full.length - 1] || null, nSeasons: full.length };
    if (![out.all.hi, out.all.lo, out.all.wet, out.all.wetSeason].some(Boolean)) delete out.all;
  }
  store.set(key, { day: out.day || hit.day, all: out.all || hit.all });
  return out;
}

const seasonLabel = w => `${w}–${String(w + 1).slice(2)}`;
async function fillClimate(v, token, pick) {
  const box = () => (token === state.token ? $('#clim .climbody') : null);
  const today = isoDay(v.tz), locKey = `${v.lat.toFixed(2)},${v.lon.toFixed(2)}`;
  let list;
  try { list = await climateStations(v.lat, v.lon, today, v.elevM); } catch { list = null; }
  if (!box()) return;
  if (!list?.length) { box().innerHTML = '<p class="fine">Couldn’t find a nearby long-record weather station for season totals and records. The links below have the NWS office’s own reports.</p>'; return; }
  const chosen = store.get('wx.climPick', {}), sid = pick || chosen[locKey];
  const st = list.find(s => s.sid === sid) || list[0];
  if (pick) { chosen[locKey] = pick; store.set('wx.climPick', chosen); }
  const picker = `<label class="climpick"><span class="fine">Station</span><select>${list.map(s => `<option value="${esc(s.sid)}"${s === st ? ' selected' : ''}>${esc(s.name)} · ${US() ? Math.round(s.km / 1.609) + ' mi' : Math.round(s.km) + ' km'} · since ${esc(s.start.slice(0, 4))}${s.lag ? ' · monthly reports' : ''}</option>`).join('')}</select></label>`;
  box().innerHTML = `${picker}<p class="fine">Loading…</p>`;
  const wire = () => { const sel = $('#clim select'); if (sel) sel.onchange = () => fillClimate(v, token, sel.value); };
  wire();
  const [sea, rec] = await Promise.allSettled([climateSeason(st, today), climateRecords(st, today)]);
  if (!box()) return;
  const S = val(sea), R = val(rec) || {}, html = [picker];
  if (S) {
    html.push(`<h3 class="climh">Rain season since Oct 1 <span class="fine">· through ${esc(prettyDate(S.last, false))}</span></h3><div class="grid">
      ${tile('This season', climR(S.season), [S.seasonNormal != null ? `Normal to date ${climR(S.seasonNormal)}` : '', pctOf(S.season, S.seasonNormal)].filter(Boolean).join(' · '))}
      ${tile(`Last season (${seasonLabel(S.wy - 1)})`, climR(S.prev), pctOf(S.prev, S.fullNormal))}
      ${S.fullNormal != null ? tile('Normal full season', climR(S.fullNormal), 'Oct 1 – Sep 30') : ''}
      ${tile(`Since Jan 1, ${S.last.slice(0, 4)}`, climR(S.ytd), [S.ytdNormal != null ? `Normal ${climR(S.ytdNormal)}` : '', pctOf(S.ytd, S.ytdNormal)].filter(Boolean).join(' · '))}
    </div>${S.seasonMiss > 3 ? `<p class="fine">${S.seasonMiss} days are missing from this season’s record, so the total may be low.</p>` : ''}`);
  }
  const yrs = b => { if (!b) return ''; const y = [...b.years].reverse(); return y.slice(0, 2).join(', ') + (y.length > 2 ? ` +${y.length - 2} more` : ''); };
  if (R.day) {
    const d = R.day;
    html.push(`<h3 class="climh">Records for ${esc(prettyDate(today, false))}</h3><div class="grid">
      ${tile('Record high', climT(d.hi?.v), yrs(d.hi))}${tile('Record low', climT(d.lo?.v), yrs(d.lo))}
      ${d.wet ? tile('Wettest on this date', climR(d.wet.v), yrs(d.wet)) : ''}${d.nHi != null ? tile('Normal high / low', `${climT(d.nHi)} / ${climT(d.nLo)}`, '') : ''}
    </div>`);
  }
  if (R.all) {
    const a = R.all, when = x => (x?.date ? prettyDate(x.date) : '');
    html.push(`<h3 class="climh">All-time records <span class="fine">· since ${esc(st.start.slice(0, 4))}</span></h3><div class="grid">
      ${tile('Hottest', climT(a.hi?.v), when(a.hi))}${tile('Coldest', climT(a.lo?.v), when(a.lo))}${tile('Wettest day', climR(a.wet?.v), when(a.wet))}
      ${a.wetSeason ? tile('Wettest season', climR(a.wetSeason.t), seasonLabel(a.wetSeason.w)) : ''}${a.drySeason && a.nSeasons > 10 ? tile('Driest season', climR(a.drySeason.t), seasonLabel(a.drySeason.w)) : ''}
    </div>`);
  }
  if (!S && !R.day && !R.all) html.push('<p class="fine">Couldn’t load climate data for this station right now. Try another station, or use the links below.</p>');
  else html.push(`<p class="fine">${esc(st.name)}${st.thr ? ' (the official NWS city record, combining past station sites)' : ''}. Data: NOAA Regional Climate Centers (ACIS), the same source as NWS NOWData. Recent days may be preliminary.</p>`);
  box().innerHTML = html.join('');
  wire();
}

function links(v) {
  const { lat, lon } = v;
  const L = [];
  if (v.kind === 'us') {
    L.push(['NWS point forecast', `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`]);
    L.push(['Hourly graph', `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&FcstType=graphical`]);
    L.push(['Full discussion', `https://forecast.weather.gov/product.php?site=${v.office}&issuedby=${v.office}&product=AFD&format=CI&version=1&glossary=1`]);
    if (v.radarStation) L.push([`NWS radar (${v.radarStation})`, `https://radar.weather.gov/station/${v.radarStation}/standard`]);
    L.push([`NWS ${v.office} office`, `https://www.weather.gov/${v.office.toLowerCase()}/`]);
    L.push(['HRRR model (Pivotal)', 'https://www.pivotalweather.com/model.php?m=hrrr']);
  } else {
    const nat = NATIONAL[v.cc];
    if (nat) L.push(nat);
    if (EU.has(v.cc)) L.push(['MeteoAlarm warnings', 'https://www.meteoalarm.org/']);
  }
  L.push(['Windy', `https://www.windy.com/?radar,${lat.toFixed(3)},${lon.toFixed(3)},9`]);
  L.push(['Ventusky', `https://www.ventusky.com/?p=${lat.toFixed(2)};${lon.toFixed(2)};8&l=radar`]);
  L.push(['RainViewer', `https://www.rainviewer.com/map.html?loc=${lat.toFixed(4)},${lon.toFixed(4)},8`]);
  return L;
}

// ---------- Radar ----------
function stopRadar() {
  if (state.radar?.timer) clearInterval(state.radar.timer);
  if (state.map) { state.map.remove(); state.map = null; }
  state.radar = null;
}
async function setupRadar(v) {
  stopRadar();
  const el = $('#radar');
  if (!el) return;
  if (!window.L) { el.innerHTML = '<p class="fine" style="padding:12px">Map library failed to load. Use the radar links below.</p>'; $('#rLabel').textContent = ''; return; }
  const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, worldCopyJump: true }).setView([v.lat, v.lon], v.kind === 'us' ? 8 : 6);
  state.map = map;
  const dark = isDark();
  // Basemap: Esri gray canvas (no API key); labels drawn above the radar. Falls back to OpenStreetMap if Esri tiles fail.
  const esri = name => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;
  const esriAttr = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 650;
  map.getPane('labels').style.pointerEvents = 'none';
  const base = L.tileLayer(esri(dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'), { maxZoom: 12, maxNativeZoom: 16, attribution: esriAttr }).addTo(map);
  const labels = L.tileLayer(esri(dark ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference'), { maxZoom: 12, pane: 'labels' }).addTo(map);
  let fails = 0;
  base.on('tileerror', () => {
    if (++fails !== 4) return;
    map.removeLayer(base); map.removeLayer(labels);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap contributors' }).addTo(map);
  });
  // Radar layers live in their own pane so they can be smoothed with a zoom-aware blur.
  map.createPane('radar');
  map.getPane('radar').style.zIndex = 350;
  map.on('zoomend', smoothRadar);
  L.circleMarker([v.lat, v.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  state.radar = { v, frames: [], layers: [], i: 0, timer: null, mode: 'past' };
  $('#rPlay').onclick = () => (state.radar?.timer ? pause() : play());
  $('#rSlide').oninput = e => { pause(); showFrame(+e.target.value); };
  $('#rMode')?.querySelectorAll('button').forEach(b => b.onclick = () => {
    $('#rMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    loadFrames(b.dataset.m);
  });
  setTimeout(() => map.invalidateSize(), 50);
  loadFrames('past');
}
async function loadFrames(mode) {
  const R = state.radar;
  if (!R) return;
  pause();
  R.layers.forEach(l => l && state.map.removeLayer(l));
  R.layers = []; R.frames = []; R.mode = mode; R.i = 0;
  $('#rLabel').textContent = 'Loading…';
  try {
    R.frames = R.v.kind === 'us' ? (mode === 'past' ? usPastFrames() : await usFutureFrames()) : await rvFrames();
  } catch (e) {
    $('#rLabel').textContent = 'Radar unavailable';
    $('#radarNote').textContent = 'Radar frames could not be loaded. Use the links below.';
    return;
  }
  if (state.radar !== R) return;
  R.layers = R.frames.map(() => null);
  smoothRadar();
  const sl = $('#rSlide'); sl.max = R.frames.length - 1;
  const start = mode === 'future' ? 0 : R.frames.length - 1;
  showFrame(start);
  $('#radarSrc').textContent = R.v.kind === 'us' ? (mode === 'past' ? 'NEXRAD via Iowa Mesonet' : 'HRRR model via Iowa Mesonet') : 'RainViewer';
  $('#radarNote').innerHTML = R.v.kind === 'us'
    ? (mode === 'past' ? 'Observed radar, last 50 minutes in 5-minute steps.' : 'Future frames are the HRRR model’s <i>simulated</i> radar — a forecast, not an observation. Good for timing, less reliable for exact placement of individual showers.')
    : 'Observed radar, past hour (max detail is limited outside the U.S.). Future radar isn’t available for this location.';
  play();
}
// Data cell size: HRRR ~3 km, NEXRAD mosaic ~1 km, RainViewer capped at zoom 7 (~1.2 km/px at that zoom).
// Smooth, contour-like rendering: blur blends the coarse cells, then an alpha curve re-sharpens the
// outer edge and caps opacity so the map shows through. In light mode the radar also multiplies into
// the basemap so roads and coastline stay visible underneath.
function ensureRadarFilter() {
  if (document.getElementById('radarSoft')) return;
  document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <filter id="radarSoft" filterUnits="userSpaceOnUse" x="-6000" y="-6000" width="12000" height="12000" color-interpolation-filters="sRGB">
      <feGaussianBlur id="radarSoftBlur" stdDeviation="3"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 0.05 0.5 0.8 0.86 0.86 0.86 0.86"/></feComponentTransfer>
    </filter></svg>`);
}
function smoothRadar() {
  const R = state.radar, map = state.map;
  if (!R || !map) return;
  ensureRadarFilter();
  const cellM = R.v.kind !== 'us' ? 2500 : R.mode === 'future' ? 3000 : 1000;
  const mPerPx = 156543.03 * Math.cos(map.getCenter().lat * Math.PI / 180) / 2 ** map.getZoom();
  const sd = clamp((cellM / mPerPx) * 0.24, 0.6, 14);
  document.getElementById('radarSoftBlur').setAttribute('stdDeviation', sd.toFixed(1));
  const pane = map.getPane('radar');
  pane.style.filter = 'url(#radarSoft)';
  pane.style.mixBlendMode = isDark() ? 'normal' : 'multiply';
}
function layerFor(i) {
  const R = state.radar, f = R.frames[i];
  if (!R.layers[i]) {
    R.layers[i] = L.tileLayer(f.url, { pane: 'radar', opacity: 0, maxNativeZoom: f.maxNative || 12, maxZoom: 12, attribution: f.attr, zIndex: 10 + i, crossOrigin: false }).addTo(state.map);
  }
  return R.layers[i];
}
function showFrame(i) {
  const R = state.radar;
  if (!R || !R.frames.length || !$('#rSlide')) return;
  i = ((i % R.frames.length) + R.frames.length) % R.frames.length;
  layerFor(i).setOpacity(1);
  R.layers.forEach((l, j) => { if (l && j !== i) l.setOpacity(0); });
  layerFor((i + 1) % R.frames.length); // preload next
  R.i = i;
  $('#rSlide').value = i;
  const f = R.frames[i];
  $('#rLabel').innerHTML = `${esc(f.label)}${f.fc ? '<span class="badge fc">FORECAST</span>' : '<span class="badge">RADAR</span>'}`;
}
function play() {
  const R = state.radar;
  if (!R || R.timer || R.frames.length < 2) return;
  $('#rPlay').textContent = '❚❚';
  R.timer = setInterval(() => {
    const next = (R.i + 1) % R.frames.length;
    showFrame(next);
    if (next === R.frames.length - 1) { clearInterval(R.timer); R.timer = setTimeout(() => { R.timer = null; if (state.radar === R) play(); }, 1800); }
  }, R.mode === 'future' ? 900 : 550);
}
function pause() {
  const R = state.radar;
  if (!R) return;
  clearInterval(R.timer); clearTimeout(R.timer); R.timer = null;
  const b = $('#rPlay'); if (b) b.textContent = '▶︎';
}
function usPastFrames() {
  const tz = state.radar.v.tz;
  const bust = Math.floor(Date.now() / 300000);
  const now = Date.now() - 5 * 60e3; // mosaic lags ~5 min
  const fr = [];
  for (let m = 50; m >= 0; m -= 5) {
    const layer = m ? `nexrad-n0q-900913-m${String(m).padStart(2, '0')}m` : 'nexrad-n0q-900913';
    fr.push({ url: `${IEM}/cache/tile.py/1.0.0/${layer}/{z}/{x}/{y}.png?_=${bust}`, label: m ? `${fmtTime(new Date(now - m * 60e3), tz)}` : `${fmtTime(new Date(now), tz)} (latest)`, attr: 'Radar: NWS NEXRAD via IEM' });
  }
  return fr;
}
async function usFutureFrames() {
  const tz = state.radar.v.tz;
  let init = null;
  try {
    const j = await getJSON(`${IEM}/data/gis/images/4326/hrrr/refd_1080.json`, { cache: 'no-store', timeout: 8000 });
    if (j.model_init_utc) init = new Date(j.model_init_utc);
  } catch { /* metadata unreachable: estimate below */ }
  // IEM finishes each HRRR run ~1h50m after its start time; if the metadata file was blocked, assume the newest run that should be ready.
  if (!init) init = new Date(Math.floor((Date.now() - 115 * 60e3) / 3600e3) * 3600e3);
  const fr = [];
  const stamp = d => d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  if (init) {
    const firstValid = Math.ceil(Date.now() / 3600e3) * 3600e3;
    for (let k = 0; k < 13; k++) {
      const valid = firstValid + k * 3600e3;
      const fmin = Math.round((valid - init) / 60e3);
      if (fmin < 0 || fmin > 1080 || valid > Date.now() + 12.5 * 3600e3) continue;
      fr.push({ url: `${IEM}/cache/tile.py/1.0.0/hrrr::REFP-F${String(fmin).padStart(4, '0')}-${stamp(init)}/{z}/{x}/{y}.png`, label: fmtDayTime(new Date(valid), tz), fc: true, attr: 'Forecast: NOAA HRRR via IEM' });
    }
  } else {
    for (let h = 1; h <= 12; h++) fr.push({ url: `${IEM}/cache/tile.py/1.0.0/hrrr::REFP-F${String(h * 60).padStart(4, '0')}-0/{z}/{x}/{y}.png`, label: `Model run +${h}h`, fc: true, attr: 'Forecast: NOAA HRRR via IEM' });
  }
  if (!fr.length) throw new Error('no frames');
  return fr;
}
async function rvFrames() {
  const j = await getJSON('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
  const tz = state.radar.v.tz;
  return (j.radar?.past || []).slice(-7).map(p => ({ url: `${j.host}${p.path}/256/{z}/{x}/{y}/2/1_1.png`, label: fmtTime(new Date(p.time * 1000), tz), maxNative: 7, attr: 'Radar: <a href="https://www.rainviewer.com/">RainViewer</a>' }));
}

// ---------- Add / manage locations ----------
let searchTimer = null;
function openAdd() {
  const d = $('#dlgAdd'), cur = groupOf(state.active);
  $('#addQuery').value = ''; $('#addResults').innerHTML = '';
  $('#addTo').innerHTML = `<option value="own">Its own tab</option>${state.groups.map(g => `<option value="${esc(g.id)}"${g === cur ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="new">New tab with other places…</option>`;
  d.showModal();
  setTimeout(() => $('#addQuery').focus(), 50);
}
async function doSearch(q) {
  const out = $('#addResults');
  q = q.trim();
  if (q.length < 2) { out.innerHTML = ''; return; }
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (ll) {
    const lat = +ll[1], lon = +ll[2];
    out.innerHTML = `<li><button data-lat="${lat}" data-lon="${lon}" data-name="${esc(`${lat.toFixed(3)}, ${lon.toFixed(3)}`)}">📌 ${lat.toFixed(4)}, ${lon.toFixed(4)}<span class="r2">Coordinates</span></button></li>`;
  } else {
    out.innerHTML = '<li class="fine" style="padding:8px 4px">Searching…</li>';
    try {
      const zip = /^\d{5}$/.test(q) ? '&countryCode=US' : '';
      const j = await getJSON(`${OM_GEO}?name=${encodeURIComponent(q)}&count=8&language=en&format=json${zip}`);
      const rs = j.results || [];
      out.innerHTML = rs.length ? rs.map(r => `<li><button data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${esc(r.name)}" data-cc="${esc(r.country_code || '')}" data-admin="${esc(r.admin1 || '')}" data-country="${esc(r.country || '')}">${esc(r.name)}<span class="r2">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></button></li>`).join('') : '<li class="fine" style="padding:8px 4px">No matches. Try a nearby city, or enter coordinates like 48.85, 2.35.</li>';
    } catch { out.innerHTML = '<li class="fine" style="padding:8px 4px">Search failed — check your connection.</li>'; }
  }
  out.querySelectorAll('button').forEach(b => b.onclick = () => {
    const ds = b.dataset;
    addLocation({ name: ds.name, lat: +ds.lat, lon: +ds.lon, cc: ds.cc || '', admin: ds.admin || '', country: ds.country || '' });
  });
}
function addLocation(o) {
  const id = `loc-${Date.now().toString(36)}`;
  state.saved.push({ id, ...o });
  store.set('wx.saved', state.saved);
  const to = $('#addTo')?.value || 'own';
  if (to !== 'own') movePlace(id, to);
  state.justAdded = id;
  $('#dlgAdd').close();
  go(id);
  // Entered as bare coordinates? Name it after the nearest town (U.S. only); rename anytime in Settings.
  if (!o.cc && /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(o.name)) {
    nws(`/points/${o.lat.toFixed(4)},${o.lon.toFixed(4)}`, 1).then(p => {
      const rl = p.properties.relativeLocation?.properties, s = state.saved.find(x => x.id === id);
      if (!rl?.city || !s || s.name !== o.name) return;
      Object.assign(s, { name: rl.city, admin: rl.state, cc: 'US', country: 'United States' });
      store.set('wx.saved', state.saved);
      renderTabs();
      if (state.active === id) { const pl = $('.place'); if (pl) pl.textContent = s.name; }
    }).catch(() => { /* keep the coordinates as the name */ });
  }
}
async function addHere() {
  const b = $('#addHere');
  b.textContent = 'Getting your location…';
  try {
    const g = await resolveGPS();
    let name = 'Saved spot', cc = '', admin = '', country = '';
    try {
      const p = await nws(`/points/${g.lat.toFixed(4)},${g.lon.toFixed(4)}`, 1);
      const rl = p.properties.relativeLocation?.properties;
      if (rl) { name = rl.city; admin = rl.state; cc = 'US'; country = 'United States'; }
    } catch {
      try { const r = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${g.lat}&longitude=${g.lon}&localityLanguage=en`); name = r.city || r.locality || name; cc = r.countryCode; admin = r.principalSubdivision; country = r.countryName; } catch { /* keep default */ }
    }
    addLocation({ name, lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), cc, admin, country });
  } catch (e) { b.textContent = e.message; setTimeout(() => (b.textContent = '📍 Save my current location'), 4000); return; }
  b.textContent = '📍 Save my current location';
}
function openSettings(section) {
  $('#unitSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.u === state.settings.units));
  renderSaved();
  renderGh();
  renderSyncStatus();
  const d = $('#dlgSettings');
  if (!d.open) d.showModal();
  if (section === 'locations') requestAnimationFrame(() => $('#locHead').scrollIntoView({ block: 'start' }));
  if (section === 'github') requestAnimationFrame(() => $('#ghHead').scrollIntoView({ block: 'start' }));
}
// Move a place into a group ('g-…'), onto its own tab ('own'), or into a new group ('new').
function movePlace(id, target) {
  if (id === 'here' || !target) return false;
  let name = '';
  if (target === 'new') {
    name = (prompt('Name for the new tab (e.g. San Diego)', '') || '').trim().slice(0, 40);
    if (!name) return false;
  }
  const from = groupOf(id), order = tabIds();
  const at = order.indexOf(from ? from.id : id);
  let groups = state.groups.map(g => ({ ...g, members: g.members.filter(x => x !== id) }));
  let newOrder = order.filter(x => x !== id);
  if (target === 'own') newOrder.splice(at < 0 ? newOrder.length : at + 1, 0, id);
  else if (target === 'new') {
    const g = { id: `g-${Date.now().toString(36)}`, name, members: [id] };
    groups.push(g);
    newOrder.splice(at < 0 ? newOrder.length : from ? at + 1 : at, 0, g.id);
  } else {
    const g = groups.find(x => x.id === target);
    if (!g) return false;
    g.members.push(id);
  }
  saveGroups(groups);
  saveOrder(newOrder.filter(x => groupById(x) || (placeById(x) && !groupOf(x))));
  return true;
}
const moveOptions = (id, includeOwn) => `<option value="">Move to…</option>${includeOwn ? '<option value="own">Its own tab</option>' : ''}${state.groups.filter(g => !g.members.includes(id)).map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}<option value="new">New tab…</option>`;

function renderSaved() {
  const ul = $('#savedList');
  const tabs = allTabs();
  const sub = l => l.kind === 'home' ? `${HOME.lat}, ${HOME.lon}` : l.kind === 'gps' ? 'Wherever you are'
    : esc([l.admin, l.country].filter(Boolean).join(', ') || `${l.lat}, ${l.lon}`);
  const placeRow = (l, i, n, inGroup) => `
    <li data-id="${esc(l.id)}"><div class="row">
      <span class="grip" aria-hidden="true" title="Drag to reorder">⠿</span>
      <span class="nm">${tabIcon(l)}${esc(tabLabel(l))}<small>${sub(l)}</small></span>
      <button data-a="up" aria-label="Move ${esc(tabLabel(l))} up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button data-a="down" aria-label="Move ${esc(tabLabel(l))} down" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button data-a="ren">Rename</button>
      ${l.kind === 'gps' ? '' : `<select data-a="move" aria-label="Move ${esc(tabLabel(l))} to another tab">${moveOptions(l.id, inGroup)}</select>`}
      ${l.kind === 'home' || l.kind === 'gps' ? '' : '<button data-a="del">Delete</button>'}</div></li>`;
  ul.innerHTML = tabs.map((t, i) => t.place ? placeRow(t.place, i, tabs.length, false) : `
    <li data-id="${esc(t.id)}" class="grp"><div class="row">
      <span class="grip" aria-hidden="true" title="Drag to reorder">⠿</span>
      <span class="nm"><b>${esc(t.group.name)}</b><small>${t.group.members.length === 1 ? '1 place — use Move to… on other places to add them' : `${t.group.members.length} places · swipe between them`}</small></span>
      <button data-a="up" aria-label="Move ${esc(t.group.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button data-a="down" aria-label="Move ${esc(t.group.name)} down" ${i === tabs.length - 1 ? 'disabled' : ''}>↓</button>
      <button data-a="ren">Rename</button>
      <button data-a="ungroup">Ungroup</button></div>
      <ul class="members" data-g="${esc(t.id)}">${t.group.members.map((id, j, arr) => placeRow(placeById(id), j, arr.length, true)).join('')}</ul></li>`).join('');
  if (!state.saved.length) ul.insertAdjacentHTML('beforeend', '<li class="fine">No saved locations yet — tap ＋ to add one.</li>');
  const refresh = () => { renderSaved(); renderTabs(); };
  // The ids of the rows in one list (the tab list, or one group's places), in on-screen order.
  const idsIn = list => [...list.children].filter(li => li.dataset.id).map(li => li.dataset.id);
  const saveList = list => {
    if (list === ul) saveOrder(idsIn(ul));
    else saveGroups(state.groups.map(g => (g.id === list.dataset.g ? { ...g, members: idsIn(list) } : g)));
  };

  ul.querySelectorAll('li[data-id] > .row > button, li[data-id] > .row > select').forEach(b => {
    const li = b.closest('li'), id = li.dataset.id, a = b.dataset.a, list = li.parentElement;
    if (a === 'move') { b.onchange = () => { if (movePlace(id, b.value)) refresh(); else b.value = ''; }; return; }
    b.onclick = () => {
      if (a === 'up' || a === 'down') {
        const order = idsIn(list), i = order.indexOf(id), j = a === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= order.length) return;
        if (j === i - 1) li.previousElementSibling?.before(li); else li.nextElementSibling?.after(li);
        saveList(list); refresh();
        ul.querySelector(`li[data-id="${CSS.escape(id)}"] > .row > button[data-a="${a}"]:not([disabled])`)?.focus();
        return;
      }
      if (a === 'ungroup') {
        const g = groupById(id), order = tabIds(), at = order.indexOf(id);
        order.splice(at, 1, ...g.members);
        saveGroups(state.groups.filter(x => x.id !== id));
        saveOrder(order);
        refresh();
        return;
      }
      if (a === 'del') {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
        state.saved = state.saved.filter(l => l.id !== id);
        store.set('wx.saved', state.saved);
        saveGroups(state.groups);
        saveOrder(tabIds().filter(x => x !== id));
        if (id === state.active) { state.active = 'home'; history.replaceState(null, '', '#home'); store.set('wx.active', 'home'); }
        refresh();
        return;
      }
      if (a === 'ren') {
        const g = groupById(id), l = g ? null : placeById(id), fixed = l && (l.kind === 'home' || l.kind === 'gps');
        const cur = g ? g.name : tabLabel(l);
        li.querySelector(':scope > .row > .nm').innerHTML = `<input class="ren" value="${esc(cur)}" maxlength="40" aria-label="New name" placeholder="${fixed ? esc(DEFAULT_LABEL[id]) : ''}">`;
        const inp = li.querySelector('input.ren'); inp.focus(); inp.select();
        let finished = false;
        const done = () => {
          if (finished) return; finished = true;
          const v = inp.value.trim();
          if (g) { if (v) saveGroups(state.groups.map(x => (x.id === id ? { ...x, name: v } : x))); }
          else if (fixed) {
            if (v && v !== DEFAULT_LABEL[id]) state.labels[id] = v; else delete state.labels[id];
            store.set('wx.labels', state.labels);
          } else if (v) {
            const s = state.saved.find(x => x.id === id); s.name = v; store.set('wx.saved', state.saved);
          }
          refresh();
        };
        inp.onkeydown = e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { e.preventDefault(); finished = true; refresh(); } };
        inp.onblur = done;
      }
    };
  });

  // Drag the ⠿ handle to reorder tabs, or places within a group (works with touch, mouse and pen).
  // To move a place to a different tab, use its "Move to…" menu.
  ul.querySelectorAll('.grip').forEach(g => g.addEventListener('pointerdown', e => {
    e.preventDefault();
    const li = g.closest('li'), list = li.parentElement;
    li.classList.add('dragging');
    const move = ev => {
      const rows = [...list.children].filter(r => r.dataset.id && r !== li);
      const before = rows.find(r => { const rc = r.getBoundingClientRect(); return ev.clientY < rc.top + rc.height / 2; });
      if (before) { if (li.nextElementSibling !== before) list.insertBefore(li, before); }
      else if (rows.length && rows[rows.length - 1].nextElementSibling !== li) rows[rows.length - 1].after(li);
    };
    // Listen on window: moving the row in the DOM drops pointer capture, so the grip alone can miss events.
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      li.classList.remove('dragging');
      saveList(list); refresh();
    };
    const onMove = ev => { if (ev.pointerId === e.pointerId) { ev.preventDefault(); move(ev); } };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }));
}

// ---------- Boot ----------
function boot() {
  $('#btnAdd').onclick = openAdd;
  $('#btnSettings').onclick = openSettings;
  $('#addQuery').oninput = e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 350); };
  $('#addHere').onclick = addHere;
  $('#ghSave').onclick = saveGh;
  $('#ghToken').onkeydown = e => { if (e.key === 'Enter') saveGh(); };
  $('#ghRemove').onclick = () => { store.set('wx.ghToken', ''); try { localStorage.removeItem('wx.ghToken'); } catch { /* ignore */ } renderGh(); };
  $('#unitSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    state.settings.units = b.dataset.u; store.set('wx.settings', state.settings);
    $('#unitSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    show(false);
  });
  $('#dlgSettings').addEventListener('close', () => show(false));
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.active) go(id); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - sync.last > 30e3) syncNow();
      const hit = [...state.cache.values()].pop();
      if (!hit || Date.now() - hit.at > 10 * 60e3) show(true);
    }
  });
  setupSwipe();
  state.groups = cleanGroups(state.groups, state.saved.map(l => l.id));
  const fromHash = location.hash.slice(1);
  go(placeById(fromHash) || groupById(fromHash) ? fromHash : store.get('wx.active', 'home'));
  syncNow();
}
boot();
