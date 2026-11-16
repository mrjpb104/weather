// Weather widget core for Scriptable (iOS). Loaded by the small "Weather" loader script.
// Data: National Weather Service (api.weather.gov) + plain-English summary from the web app.
// Widget parameter (long-press widget → Edit Widget → Parameter):
//   blank = Home · "here" = current location · "lat,lon" = any U.S. point · add "|Name" to label it, e.g. "47.61,-122.33|Seattle"

const SITE = 'https://mrjpb104.github.io/weather/';
const HOME = { lat: 33.14986, lon: -117.30919, name: 'Home' };
const UA = { 'User-Agent': '(mrjpb104 personal weather widget)', Accept: 'application/geo+json' };

async function getJSON(url, headers = UA) {
  const r = new Request(url);
  r.headers = headers;
  r.timeoutInterval = 20;
  return await r.loadJSON();
}

// ---------- Look & icons ----------
function symbolName(text = '', day = true) {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return 'cloud.bolt.rain.fill';
  if (/snow|flurr|blizzard/.test(t)) return 'cloud.snow.fill';
  if (/sleet|freezing|ice/.test(t)) return 'cloud.sleet.fill';
  if (/drizzle/.test(t)) return 'cloud.drizzle.fill';
  if (/rain|shower/.test(t)) return /chance|slight|isolated|scattered/.test(t) ? (day ? 'cloud.sun.rain.fill' : 'cloud.moon.rain.fill') : 'cloud.rain.fill';
  if (/fog|haze|smoke|mist/.test(t)) return 'cloud.fog.fill';
  if (/overcast|^cloudy|mostly cloudy/.test(t)) return 'cloud.fill';
  if (/partly|mostly sunny|mostly clear|cloud/.test(t)) return day ? 'cloud.sun.fill' : 'cloud.moon.fill';
  if (/wind|breezy|blustery/.test(t)) return 'wind';
  return day ? 'sun.max.fill' : 'moon.stars.fill';
}
function sky(text = '', day = true) {
  const t = text.toLowerCase();
  const wet = /rain|shower|drizzle|thunder|storm|snow|sleet/.test(t);
  const cloudy = /overcast|cloudy|fog|haze/.test(t) && !/partly/.test(t);
  if (day) return wet ? ['#34475d', '#5a6e85'] : cloudy ? ['#4f6a87', '#7f95ac'] : ['#2a6dc4', '#5f9fdd'];
  return wet ? ['#0f1620', '#243142'] : cloudy ? ['#161d29', '#323d51'] : ['#07112a', '#1f3363'];
}
function addSymbol(stack, name, size, color = Color.white()) {
  const s = SFSymbol.named(name) || SFSymbol.named('cloud.fill');
  s.applyFont(Font.systemFont(size));
  const img = stack.addImage(s.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color;
  return img;
}
function text(stack, str, font, opacity = 1, color = Color.white()) {
  const t = stack.addText(String(str));
  t.font = font; t.textColor = color; t.textOpacity = opacity;
  t.minimumScaleFactor = 0.6; t.lineLimit = 1;
  return t;
}
const hourLabel = d => d.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(':00', '').replace(' ', '');
const dayLabel = (d, i) => (i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }));

// ---------- Data ----------
async function resolvePlace(param) {
  const p = (param || '').trim();
  if (/^here$/i.test(p)) {
    try { Location.setAccuracyToThreeKilometers(); const l = await Location.current(); return { lat: l.latitude, lon: l.longitude, name: null, here: true }; }
    catch (e) { return HOME; }
  }
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\|\s*(.+))?$/.exec(p);
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] || null };
  return HOME;
}

function rainLine(hourly) {
  if (!hourly.length) return '';
  const idx = hourly.findIndex(h => h.pop >= 40);
  const max = Math.max(...hourly.map(h => h.pop));
  if (idx < 0) return max < 15 ? 'Dry next 24 hrs' : `Rain chance ≤${max}%`;
  let end = idx;
  while (end + 1 < hourly.length && hourly[end + 1].pop >= 40) end++;
  const until = end + 1 < hourly.length ? hourLabel(new Date(+hourly[end].t + 3600e3)) : null;
  if (idx === 0) return until ? `Rain until ${until}` : 'Rain all day';
  return `Rain from ${hourLabel(hourly[idx].t)}${until ? `–${until}` : ''}`;
}

async function load(place) {
  const pt = await getJSON(`https://api.weather.gov/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`);
  const P = pt.properties;
  const [fc, hr, st, al] = await Promise.all([
    getJSON(P.forecast), getJSON(P.forecastHourly), getJSON(P.observationStations),
    getJSON(`https://api.weather.gov/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`).catch(() => null),
  ]);
  let obs = null;
  for (const f of (st.features || []).slice(0, 3)) {
    try {
      const o = (await getJSON(`https://api.weather.gov/stations/${f.properties.stationIdentifier}/observations/latest`)).properties;
      if (o.temperature && o.temperature.value != null && Date.now() - new Date(o.timestamp) < 2.5 * 3600e3) { obs = o; break; }
    } catch (e) { /* try the next station */ }
  }
  const periods = fc.properties.periods;
  const hourly = hr.properties.periods.filter(p => new Date(p.endTime) > Date.now()).slice(0, 24)
    .map(p => ({ t: new Date(p.startTime), temp: p.temperature, pop: (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0, text: p.shortForecast, day: p.isDaytime }));
  const day = hourly[0] ? hourly[0].day : periods[0].isDaytime;
  const nowText = (obs && obs.textDescription) || (hourly[0] && hourly[0].text) || periods[0].shortForecast;
  const tempF = obs ? Math.round(obs.temperature.value * 9 / 5 + 32) : hourly[0] ? hourly[0].temp : periods[0].temperature;
  const days = [];
  for (let i = 0; i < periods.length && days.length < 7; i++) {
    const p = periods[i];
    if (p.isDaytime) {
      const n = periods[i + 1] && !periods[i + 1].isDaytime ? periods[++i] : null;
      days.push({ t: new Date(p.startTime), hi: p.temperature, lo: n ? n.temperature : null, pop: Math.max((p.probabilityOfPrecipitation || {}).value || 0, n ? ((n.probabilityOfPrecipitation || {}).value || 0) : 0), text: p.shortForecast, name: p.name });
    } else if (!days.length) {
      days.push({ t: new Date(p.startTime), hi: null, lo: p.temperature, pop: (p.probabilityOfPrecipitation || {}).value || 0, text: p.shortForecast, name: 'Tonight' });
    }
  }
  let summary = null;
  try { summary = await getJSON(`${SITE}summaries/${P.cwa}.json?t=${Date.now()}`, {}); } catch (e) { /* none for this office */ }
  const rl = P.relativeLocation && P.relativeLocation.properties;
  return {
    name: place.name || (place.here ? (rl ? rl.city : 'Here') : rl ? rl.city : 'Weather'),
    tempF, nowText, day, hourly, days,
    hi: days[0] ? days[0].hi : null, lo: days[0] ? (days[0].lo != null ? days[0].lo : days[1] && days[1].lo) : null,
    rain: rainLine(hourly),
    alert: al && al.features && al.features[0] ? al.features[0].properties.event : null,
    headline: summary && summary.headline, at: Date.now(),
  };
}

// Cache the last good data so the widget still shows something offline.
function cachePath(place) {
  const fm = FileManager.local();
  return [fm, fm.joinPath(fm.cacheDirectory(), `wx-${place.lat.toFixed(2)}_${place.lon.toFixed(2)}.json`)];
}
async function getData(place) {
  const [fm, path] = cachePath(place);
  try {
    const d = await load(place);
    fm.writeString(path, JSON.stringify(d));
    return d;
  } catch (e) {
    if (fm.fileExists(path)) {
      const d = JSON.parse(fm.readString(path));
      d.hourly.forEach(h => (h.t = new Date(h.t))); d.days.forEach(x => (x.t = new Date(x.t)));
      d.stale = true;
      return d;
    }
    throw e;
  }
}

// ---------- Layouts ----------
function base(d) {
  const w = new ListWidget();
  const g = new LinearGradient();
  const [a, b] = sky(d.nowText, d.day);
  g.colors = [new Color(a), new Color(b)]; g.locations = [0, 1];
  w.backgroundGradient = g;
  w.url = SITE;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  return w;
}
function header(w, d, size = 13) {
  const h = w.addStack(); h.centerAlignContent();
  text(h, d.name, Font.semiboldSystemFont(size));
  if (d.alert) { h.addSpacer(4); addSymbol(h, 'exclamationmark.triangle.fill', size - 1, new Color('#ffd66b')); }
  if (d.stale) { h.addSpacer(4); text(h, '•', Font.boldSystemFont(size), 0.6, new Color('#ffd66b')); }
  h.addSpacer();
  return h;
}
function small(d) {
  const w = base(d); w.setPadding(14, 14, 12, 14);
  header(w, d);
  text(w, `${d.tempF}°`, Font.lightSystemFont(44));
  w.addSpacer();
  const c = w.addStack(); c.centerAlignContent(); c.spacing = 5;
  addSymbol(c, symbolName(d.nowText, d.day), 16);
  text(c, d.nowText, Font.mediumSystemFont(12));
  text(w, `H:${d.hi ?? '–'}°  L:${d.lo ?? '–'}°`, Font.mediumSystemFont(12), 0.85);
  text(w, d.rain, Font.mediumSystemFont(11), 0.8);
  return w;
}
function hourStrip(parent, d, n) {
  const s = parent.addStack(); s.spacing = 0;
  d.hourly.slice(0, n).forEach((h, i) => {
    const col = s.addStack(); col.layoutVertically(); col.centerAlignContent();
    const t = text(col, i === 0 ? 'Now' : hourLabel(h.t), Font.mediumSystemFont(11), 0.75); t.centerAlignText();
    col.addSpacer(4);
    const ic = col.addStack(); ic.addSpacer(); addSymbol(ic, symbolName(h.text, h.day), 18); ic.addSpacer();
    col.addSpacer(4);
    const v = text(col, `${h.temp}°`, Font.semiboldSystemFont(14)); v.centerAlignText();
    const p = text(col, h.pop >= 20 ? `${h.pop}%` : ' ', Font.boldSystemFont(10), 0.9, new Color('#bfe0ff')); p.centerAlignText();
    if (i < n - 1) s.addSpacer();
  });
  return s;
}
function medium(d) {
  const w = base(d); w.setPadding(14, 16, 12, 16);
  const top = w.addStack(); top.centerAlignContent();
  const left = top.addStack(); left.layoutVertically();
  header(left, d, 13);
  text(left, `${d.tempF}°`, Font.lightSystemFont(40));
  top.addSpacer();
  const right = top.addStack(); right.layoutVertically();
  const ri = right.addStack(); ri.addSpacer(); addSymbol(ri, symbolName(d.nowText, d.day), 22);
  const rc = text(right, d.nowText, Font.mediumSystemFont(12)); rc.rightAlignText();
  const rh = text(right, `H:${d.hi ?? '–'}°  L:${d.lo ?? '–'}°`, Font.mediumSystemFont(12), 0.85); rh.rightAlignText();
  const rr = text(right, d.rain, Font.mediumSystemFont(11), 0.85); rr.rightAlignText();
  if (d.alert) { const ra = text(right, `⚠ ${d.alert}`, Font.mediumSystemFont(10), 1, new Color('#ffe08a')); ra.rightAlignText(); }
  w.addSpacer();
  hourStrip(w, d, 6);
  return w;
}
function large(d) {
  const w = base(d); w.setPadding(16, 16, 14, 16);
  const top = w.addStack(); top.centerAlignContent();
  const left = top.addStack(); left.layoutVertically();
  header(left, d, 14);
  text(left, `${d.tempF}°`, Font.lightSystemFont(46));
  top.addSpacer();
  const right = top.addStack(); right.layoutVertically();
  const ri = right.addStack(); ri.addSpacer(); addSymbol(ri, symbolName(d.nowText, d.day), 26);
  const rc = text(right, d.nowText, Font.mediumSystemFont(13)); rc.rightAlignText();
  const rh = text(right, `H:${d.hi ?? '–'}°  L:${d.lo ?? '–'}°`, Font.mediumSystemFont(13), 0.85); rh.rightAlignText();
  const rr = text(right, d.rain, Font.mediumSystemFont(12), 0.85); rr.rightAlignText();
  if (d.alert) { const ra = text(right, `⚠ ${d.alert}`, Font.mediumSystemFont(11), 1, new Color('#ffe08a')); ra.rightAlignText(); }
  w.addSpacer(10);
  hourStrip(w, d, 6);
  w.addSpacer(10);
  const all = d.days.slice(0, 5).flatMap(x => [x.hi, x.lo]).filter(x => x != null);
  const mn = Math.min(...all), mx = Math.max(...all), span = Math.max(mx - mn, 1);
  d.days.slice(0, 5).forEach((x, i) => {
    const row = w.addStack(); row.centerAlignContent(); row.spacing = 6;
    const nm = row.addStack(); nm.size = new Size(46, 0); text(nm, dayLabel(x.t, i), Font.semiboldSystemFont(13));
    const ic = row.addStack(); ic.size = new Size(24, 0); addSymbol(ic, symbolName(x.text, true), 16);
    const pp = row.addStack(); pp.size = new Size(32, 0); text(pp, x.pop >= 20 ? `${x.pop}%` : '', Font.boldSystemFont(11), 0.9, new Color('#bfe0ff'));
    const lo = row.addStack(); lo.size = new Size(30, 0); const lt = text(lo, x.lo != null ? `${x.lo}°` : '', Font.mediumSystemFont(13), 0.7); lt.rightAlignText();
    // range bar
    const barW = 96, lo2 = x.lo ?? x.hi, hi2 = x.hi ?? x.lo;
    const ctx = new DrawContext(); ctx.size = new Size(barW, 6); ctx.opaque = false; ctx.respectScreenScale = true;
    ctx.setFillColor(new Color('#ffffff', 0.18)); ctx.fillPath(roundRect(0, 0, barW, 6, 3));
    const x0 = ((lo2 - mn) / span) * barW, x1 = Math.max(((hi2 - mn) / span) * barW, x0 + 6);
    ctx.setFillColor(new Color('#ffd35a')); ctx.fillPath(roundRect(x0, 0, x1 - x0, 6, 3));
    const bar = row.addImage(ctx.getImage()); bar.imageSize = new Size(barW, 6);
    const hi = row.addStack(); hi.size = new Size(30, 0); text(hi, x.hi != null ? `${x.hi}°` : '', Font.semiboldSystemFont(13));
    w.addSpacer(4);
  });
  if (d.headline) {
    w.addSpacer(4);
    const t = w.addText(d.headline);
    t.font = Font.mediumSystemFont(11); t.textColor = Color.white(); t.textOpacity = 0.85; t.lineLimit = 2; t.minimumScaleFactor = 0.8;
  }
  return w;
}
function roundRect(x, y, w, h, r) { const p = new Path(); p.addRoundedRect(new Rect(x, y, w, h), r, r); return p; }

// Lock Screen
function lockRect(d) {
  const w = new ListWidget(); w.url = SITE;
  const top = w.addStack(); top.centerAlignContent(); top.spacing = 4;
  addSymbol(top, symbolName(d.nowText, d.day), 14);
  text(top, `${d.tempF}° ${d.nowText}`, Font.semiboldSystemFont(13));
  text(w, `H:${d.hi ?? '–'}°  L:${d.lo ?? '–'}°`, Font.mediumSystemFont(12), 0.9);
  text(w, d.alert ? `${d.rain} · ⚠` : d.rain, Font.mediumSystemFont(12), 0.9);
  return w;
}
function lockCircle(d) {
  const w = new ListWidget(); w.url = SITE; w.addAccessoryWidgetBackground = true;
  const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
  const a = s.addStack(); a.addSpacer(); addSymbol(a, symbolName(d.nowText, d.day), 14); a.addSpacer();
  const b = s.addStack(); b.addSpacer(); text(b, `${d.tempF}°`, Font.semiboldSystemFont(16)); b.addSpacer();
  return w;
}
function lockInline(d) {
  const w = new ListWidget(); w.url = SITE;
  text(w, `${d.tempF}° · ${d.rain}`, Font.mediumSystemFont(12));
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget(); w.url = SITE;
  const g = new LinearGradient(); g.colors = [new Color('#34475d'), new Color('#5a6e85')]; g.locations = [0, 1]; w.backgroundGradient = g;
  text(w, 'Weather', Font.semiboldSystemFont(13));
  w.addSpacer(4);
  const t = w.addText(msg); t.font = Font.systemFont(11); t.textColor = Color.white(); t.textOpacity = 0.85;
  return w;
}

module.exports.run = async function (param) {
  let w;
  try {
    const place = await resolvePlace(param);
    const d = await getData(place);
    const fam = config.widgetFamily || 'medium';
    w = fam === 'small' ? small(d) : fam === 'large' || fam === 'extraLarge' ? large(d)
      : fam === 'accessoryRectangular' ? lockRect(d) : fam === 'accessoryCircular' ? lockCircle(d)
      : fam === 'accessoryInline' ? lockInline(d) : medium(d);
  } catch (e) {
    w = errorWidget(`Couldn't load the weather (${e.message || e}). Outside the U.S.? This widget uses NWS data.`);
  }
  if (config.runsInWidget) Script.setWidget(w);
  else {
    const fam = config.widgetFamily || 'medium';
    if (fam === 'small') await w.presentSmall(); else if (fam === 'large') await w.presentLarge(); else await w.presentMedium();
  }
  Script.complete();
};
