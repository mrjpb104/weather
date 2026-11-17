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
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  settings: store.get('wx.settings', { units: 'us' }),
  saved: store.get('wx.saved', []),
  order: store.get('wx.order', []),
  labels: store.get('wx.labels', {}),
  active: 'home',
  cache: new Map(),
  gps: null,
  map: null,
  radar: null,
  token: 0,
};
const US = () => state.settings.units !== 'si';
const THEMES = [
  ['classic', 'Classic', ['#eef2f7', '#ffffff', '#2563eb']],
  ['coastal', 'Coastal', ['#f2f7f6', '#9be0c9', '#0f6e7a']],
  ['nightfall', 'Nightfall', ['#070b0f', '#14535a', '#5eead4']],
  ['editorial', 'Editorial', ['#f7f3ec', '#fffdf9', '#2f6b5b']],
  ['sky', 'Live sky', ['#2f80d1', '#c76b6b', '#0b1736']],
];
const theme = () => document.documentElement.dataset.theme || 'classic';
const isDark = () => theme() === 'nightfall' || (theme() === 'sky' ? /^(night|dusk)/.test(document.documentElement.dataset.sky || '') : matchMedia('(prefers-color-scheme: dark)').matches);
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
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('wx.theme', t);
  renderThemePick();
  if (typeof fx !== 'undefined') { if (t === 'sky' && state.lastView) fxFromView(state.lastView); else fx.start(); }
}
// [id, label, CSS family for the preview, stylesheet URL (null = already loaded), note]
const GF = q => `https://fonts.googleapis.com/css2?family=${q}&display=swap`;
const FS = q => `https://api.fontshare.com/v2/css?f[]=${q}&display=swap`;
const FONTS = [
  ['', 'Theme default', 'inherit', null, ''],
  ['inter', 'Inter', '"Inter"', null, ''],
  ['josefin', 'Josefin Sans', '"Josefin Sans"', GF('Josefin+Sans:wght@200;300;400;500;600;700'), ''],
  ['rubik', 'Rubik', '"Rubik"', GF('Rubik:wght@300;400;500;600;700'), ''],
  ['dmsans', 'DM Sans', '"DM Sans"', GF('DM+Sans:opsz,wght@9..40,200;9..40,300;9..40,400;9..40,500;9..40,600;9..40,700'), ''],
  ['manrope', 'Manrope', '"Manrope"', GF('Manrope:wght@200;300;400;500;600;700'), ''],
  ['geist', 'Geist', '"Geist"', GF('Geist:wght@200;300;400;500;600;700'), ''],
  ['satoshi', 'Satoshi', '"Satoshi"', FS('satoshi@300,400,500,700'), 'default'],
  ['clash', 'Clash Grotesk', '"Clash Grotesk"', FS('clash-grotesk@200,300,400,500,600,700'), ''],
  ['general', 'General Sans', '"General Sans"', FS('general-sans@200,300,400,500,600,700'), 'free stand-in for Aeonik'],
  ['switzer', 'Switzer', '"Switzer"', FS('switzer@200,300,400,500,600,700'), 'free stand-in for Mori'],
  ['unbounded', 'Unbounded + Manrope', '"Unbounded"', GF('Unbounded:wght@200;300;400;500;600&family=Manrope:wght@300;400;500;600;700'), 'free stand-in for Monument'],
];
function loadFont(id) {
  const f = FONTS.find(x => x[0] === id);
  if (!f || !f[3] || document.getElementById(`font-${id}`)) return;
  const l = document.createElement('link');
  l.id = `font-${id}`; l.rel = 'stylesheet';
  l.href = f[3];
  document.head.appendChild(l);
}
function setFont(id) {
  if (id) { document.documentElement.dataset.font = id; loadFont(id); } else delete document.documentElement.dataset.font;
  store.set('wx.font', id || null);
  renderFontPick();
}
function renderFontPick() {
  const el = $('#fontPick');
  if (!el) return;
  FONTS.forEach(f => loadFont(f[0]));
  const cur = document.documentElement.dataset.font || '';
  el.innerHTML = FONTS.map(([id, name, fam, , note]) => `<button type="button" data-f="${id}" aria-pressed="${cur === id}">
    <span class="fs" style="font-family:${fam === 'inherit' ? 'inherit' : `${fam}, sans-serif`}">69°<em>Aa</em></span><span class="fn">${esc(name)}</span>${note ? `<span class="fnote">${esc(note)}</span>` : ''}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => setFont(b.dataset.f));
}
function renderThemePick() {
  const el = $('#themePick');
  if (!el) return;
  el.innerHTML = THEMES.map(([id, name, sw]) => `<button type="button" data-t="${id}" aria-pressed="${theme() === id}">
    <span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>${esc(name)}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { setTheme(b.dataset.t); });
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
  state.cache.set(key, { at: Date.now(), view });
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
    getJSON(omURL(lat, lon)), getJSON(aqURL(lat, lon)),
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
    kind: 'us', name: loc.name, sub, lat, lon, tz, office,
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
    getJSON(omURL(lat, lon)), getJSON(aqURL(lat, lon)),
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
// Tab order and names. Home and Current keep fixed ids; their custom names live in wx.labels,
// saved locations keep their name on the saved object. wx.order lists tab ids left to right.
const DEFAULT_LABEL = { home: 'Home', here: 'Current' };
const tabLabel = l => l.kind === 'home' || l.kind === 'gps' ? (state.labels[l.id] || DEFAULT_LABEL[l.id]) : l.name;
const tabIcon = l => l.id === 'home' ? '🏠 ' : l.id === 'here' ? '📍 ' : '';
function allLocs() {
  const base = [{ ...HOME, name: state.labels.home || HOME.name }, { ...HERE, name: state.labels.here || HERE.name }, ...state.saved];
  const byId = new Map(base.map(l => [l.id, l]));
  const out = [];
  for (const id of state.order) if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
  return out.concat([...byId.values()]);
}
function saveOrder(ids) { state.order = ids; store.set('wx.order', ids); }

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = allLocs().map(l => `<button class="tab" data-id="${esc(l.id)}" aria-current="${l.id === state.active}">${tabIcon(l)}${esc(tabLabel(l))}</button>`).join('');
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

function go(id) {
  if (!locById(id)) id = 'home';
  state.active = id;
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  store.set('wx.active', id);
  renderTabs();
  show(false);
}
const locById = id => allLocs().find(l => l.id === id);

async function show(force) {
  const loc = locById(state.active);
  const token = ++state.token;
  stopRadar();
  const main = $('#main');
  if (!state.cache.size || force !== 'quiet') main.innerHTML = '<div class="skel"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:300px"></div>';
  try {
    const view = await loadLocation(loc, !!force);
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
  const g = (icon, title, body, foot) => `<div class="gtile"><div class="gk">${ui(icon)}${title}</div>${body}${foot ? `<div class="gs">${foot}</div>` : ''}</div>`;
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

  html.push(`<section class="card hero">
    <p class="place">${esc(loc?.name || v.name)}</p>
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

  html.push(`<section class="card">${hdr('link', 'More detail')}<div class="links">${links(v).map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}</div></section>`);
  html.push(`<footer class="src fine">Updated ${esc(fmtTime(v.loadedAt, tz))} (${esc(tz.replace(/_/g, ' '))}) · ${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</footer>`);

  let k = 0;
  $('#main').innerHTML = html.join('').replace(/<(section|details) class="(card|alert)/g, (mm, tag, cls) => `<${tag} style="--i:${k++}" class="${cls}`);
  $('#refresh').onclick = () => show(true);
  wireEnableButtons();
  if (typeof fxFromView === 'function') fxFromView(v);
  setupRadar(v);
}
const tile = (k, v, s) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;

// ---------- Turning on summaries for a new NWS office ----------
// The button opens a prefilled GitHub issue; .github/workflows/enable-summaries.yml does the rest.
const PENDING_MS = 24 * 3600e3;
function pendingOffices() {
  const p = store.get('wx.sumPending', {}), now = Date.now();
  for (const k of Object.keys(p)) if (now - p[k] > PENDING_MS) delete p[k];
  return p;
}
function summaryState(v) {
  if (v.summary) return 'ready';
  if (v.summaryOffices?.includes(v.office)) return 'on';
  return pendingOffices()[v.office] ? 'pending' : 'off';
}
const areaName = v => (v.afd?.text?.match(/National Weather Service ([^\n]+)/)?.[1] || v.office).trim().replace(/ ([A-Z]{2})$/, ', $1');
function enableURL(v, loc) {
  const nm = loc?.name || v.name || '', place = !v.sub || v.sub.startsWith(nm) ? v.sub || nm : `${nm} (${v.sub})`;
  const body = [`Office: ${v.office}`, `Area: ${areaName(v)}`, `Location: ${place}`, `Coordinates: ${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}`, '',
    'Sent from the weather app. Submitting this turns on plain-English forecast-discussion summaries for this office automatically; the issue closes itself when it’s done.'].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Enable summaries: ${v.office}`)}&body=${encodeURIComponent(body)}`;
}
const enableBtn = (v, loc, label) => `<a class="btn primary sumbtn" href="${esc(enableURL(v, loc))}" target="_blank" rel="noopener" data-enable="${esc(v.office)}">${esc(label || `Turn on summaries for ${areaName(v)}`)}</a>
  ${label ? '' : '<p class="fine">Opens a prefilled request on GitHub — tap <b>Create</b> and it’s set up automatically.</p>'}`;
function wireEnableButtons() {
  document.querySelectorAll('[data-enable]').forEach(a => a.addEventListener('click', () => {
    const p = pendingOffices(); p[a.dataset.enable] = Date.now(); store.set('wx.sumPending', p);
    state.cache.clear();
    setTimeout(() => show('quiet'), 1500);
  }));
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
    else if (st === 'pending') parts.push(`<div class="sumcta"><p>Turning on summaries for the NWS ${esc(areaName(v))} area. Once you’ve tapped <b>Create</b> on GitHub it finishes in a minute or two, and the first summary follows within about an hour.</p>${enableBtn(v, null, 'Open the request again')}</div>`);
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
  const d = $('#dlgAdd');
  $('#addQuery').value = ''; $('#addResults').innerHTML = '';
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
  renderThemePick();
  renderFontPick();
  const d = $('#dlgSettings');
  if (!d.open) d.showModal();
  if (section === 'locations') requestAnimationFrame(() => $('#locHead').scrollIntoView({ block: 'start' }));
}
function renderSaved() {
  const ul = $('#savedList');
  const locs = allLocs();
  const sub = l => l.kind === 'home' ? `${HOME.lat}, ${HOME.lon}` : l.kind === 'gps' ? 'Wherever you are'
    : esc([l.admin, l.country].filter(Boolean).join(', ') || `${l.lat}, ${l.lon}`);
  ul.innerHTML = locs.map((l, i) => `
    <li data-id="${esc(l.id)}">
      <span class="grip" aria-hidden="true" title="Drag to reorder">⠿</span>
      <span class="nm">${tabIcon(l)}${esc(tabLabel(l))}<small>${sub(l)}</small></span>
      <button data-a="up" aria-label="Move ${esc(tabLabel(l))} left" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button data-a="down" aria-label="Move ${esc(tabLabel(l))} right" ${i === locs.length - 1 ? 'disabled' : ''}>↓</button>
      <button data-a="ren">Rename</button>
      ${l.kind === 'home' || l.kind === 'gps' ? '' : '<button data-a="del">Delete</button>'}</li>`).join('');
  if (!state.saved.length) ul.insertAdjacentHTML('beforeend', '<li class="fine">No saved locations yet — tap ＋ to add one.</li>');
  const ids = () => [...ul.querySelectorAll('li[data-id]')].map(li => li.dataset.id);
  const refresh = () => { renderSaved(); renderTabs(); };

  ul.querySelectorAll('li[data-id] button').forEach(b => b.onclick = () => {
    const li = b.closest('li'), id = li.dataset.id, a = b.dataset.a;
    const order = ids(), i = order.indexOf(id);
    if (a === 'up' || a === 'down') {
      const j = a === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      saveOrder(order); refresh();
      ul.querySelector(`li[data-id="${CSS.escape(id)}"] button[data-a="${a}"]:not([disabled])`)?.focus();
      return;
    }
    if (a === 'del') {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
      state.saved = state.saved.filter(l => l.id !== id);
      store.set('wx.saved', state.saved);
      saveOrder(order.filter(x => x !== id));
      if (id === state.active) { state.active = 'home'; history.replaceState(null, '', '#home'); store.set('wx.active', 'home'); }
      refresh();
      return;
    }
    if (a === 'ren') {
      const l = locById(id), fixed = l.kind === 'home' || l.kind === 'gps';
      li.querySelector('.nm').innerHTML = `<input class="ren" value="${esc(tabLabel(l))}" maxlength="40" aria-label="New name" placeholder="${fixed ? esc(DEFAULT_LABEL[id]) : ''}">`;
      const inp = li.querySelector('input'); inp.focus(); inp.select();
      let finished = false;
      const done = () => {
        if (finished) return; finished = true;
        const v = inp.value.trim();
        if (fixed) {
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
  });

  // Drag the ⠿ handle to reorder (works with touch, mouse and pen).
  ul.querySelectorAll('.grip').forEach(g => g.addEventListener('pointerdown', e => {
    e.preventDefault();
    const li = g.closest('li');
    li.classList.add('dragging');
    const move = ev => {
      const rows = [...ul.querySelectorAll('li[data-id]:not(.dragging)')];
      const before = rows.find(r => { const rc = r.getBoundingClientRect(); return ev.clientY < rc.top + rc.height / 2; });
      if (before) { if (li.nextElementSibling !== before) ul.insertBefore(li, before); }
      else if (rows.length && rows[rows.length - 1].nextElementSibling !== li) rows[rows.length - 1].after(li);
    };
    // Listen on window: moving the row in the DOM drops pointer capture, so the grip alone can miss events.
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      li.classList.remove('dragging');
      saveOrder(ids()); refresh();
    };
    const onMove = ev => { if (ev.pointerId === e.pointerId) { ev.preventDefault(); move(ev); } };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }));
}

// ---------- Boot ----------
function boot() {
  if (window.WX_FONT_PRELOAD) loadFont(window.WX_FONT_PRELOAD);
  $('#btnAdd').onclick = openAdd;
  $('#btnSettings').onclick = openSettings;
  $('#addQuery').oninput = e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 350); };
  $('#addHere').onclick = addHere;
  $('#unitSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    state.settings.units = b.dataset.u; store.set('wx.settings', state.settings);
    $('#unitSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    show(false);
  });
  $('#dlgSettings').addEventListener('close', () => show(false));
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.active) go(id); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const hit = [...state.cache.values()].pop();
      if (!hit || Date.now() - hit.at > 10 * 60e3) show(true);
    }
  });
  const fromHash = location.hash.slice(1);
  go(locById(fromHash) ? fromHash : store.get('wx.active', 'home'));
}
boot();
