'use strict';
/* Weather icons, small UI icons, and SVG data visuals (sun arc, moon, gauges, curves). */

// Shared gradients, injected once.
(function injectDefs() {
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="gSun" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#fff6c2"/><stop offset=".45" stop-color="#ffd447"/><stop offset="1" stop-color="#ff9f1c"/></radialGradient>
    <radialGradient id="gSunGlow"><stop offset="0" stop-color="#ffd447" stop-opacity=".55"/><stop offset="1" stop-color="#ffd447" stop-opacity="0"/></radialGradient>
    <linearGradient id="gCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d5dee9"/></linearGradient>
    <linearGradient id="gCloudDark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aab6c4"/><stop offset="1" stop-color="#6f7d8f"/></linearGradient>
    <linearGradient id="gMoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#e6dcb4"/></linearGradient>
    <linearGradient id="gDrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd0ff" stop-opacity=".2"/><stop offset="1" stop-color="#4aa3ff"/></linearGradient>
    <linearGradient id="gBolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a8"/><stop offset="1" stop-color="#ffb800"/></linearGradient>
    <filter id="fSoft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0b1d33" flood-opacity=".22"/></filter>
  </defs></svg>`;
  const go = () => document.body.insertAdjacentHTML('afterbegin', svg);
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();

// ---------- Weather icon kinds ----------
function iconKindText(text = '', isDay = true) {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return 'thunder';
  if (/snow|flurr|blizzard/.test(t)) return 'snow';
  if (/sleet|freezing|ice/.test(t)) return 'sleet';
  if (/drizzle/.test(t)) return 'drizzle';
  if (/rain|shower/.test(t)) return /chance|slight|isolated|scattered/.test(t) ? (isDay ? 'showers-day' : 'showers-night') : 'rain';
  if (/fog|haze|smoke|dust|mist/.test(t)) return 'fog';
  if (/overcast|^cloudy|mostly cloudy/.test(t)) return 'cloudy';
  if (/partly|mostly sunny|mostly clear|few clouds|cloud/.test(t)) return isDay ? 'partly-day' : 'partly-night';
  if (/wind|breezy|blustery/.test(t)) return 'wind';
  return isDay ? 'clear-day' : 'clear-night';
}
function iconKindWMO(c, isDay = true) {
  if (c == null) return isDay ? 'clear-day' : 'clear-night';
  if (c >= 95) return 'thunder';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
  if ([56, 57, 66, 67].includes(c)) return 'sleet';
  if ([51, 53, 55].includes(c)) return 'drizzle';
  if ([80, 81, 82].includes(c)) return isDay ? 'showers-day' : 'showers-night';
  if ([61, 63, 65].includes(c)) return 'rain';
  if ([45, 48].includes(c)) return 'fog';
  if (c === 3) return 'cloudy';
  if (c === 1 || c === 2) return isDay ? 'partly-day' : 'partly-night';
  return isDay ? 'clear-day' : 'clear-night';
}

const _sun = (cx, cy, r) => `<g class="sunbody"><circle cx="${cx}" cy="${cy}" r="${r * 1.9}" fill="url(#gSunGlow)"/>
  <g class="rays" style="transform-origin:${cx}px ${cy}px">${Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, r1 = r * 1.32, r2 = r * 1.62;
    return `<line x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy + r1 * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy + r2 * Math.sin(a)).toFixed(1)}" stroke="#ffc53a" stroke-width="${(r * .2).toFixed(1)}" stroke-linecap="round"/>`;
  }).join('')}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#gSun)"/></g>`;
const _moon = (cx, cy, r) => `<path d="M${cx + r * .35},${cy - r} a${r},${r} 0 1,0 ${r * .65},${r * 1.55} a${r * .78},${r * .78} 0 1,1 ${-r * .65},${-r * 1.55}z" fill="url(#gMoon)" filter="url(#fSoft)"/>`;
const _cloud = (x, y, s, dark) => `<g class="cloudbody" filter="url(#fSoft)" transform="translate(${x} ${y}) scale(${s})"><path d="M14 36h30a10 10 0 0 0 0-20 13 13 0 0 0-25-3A10 10 0 0 0 14 36z" fill="url(#${dark ? 'gCloudDark' : 'gCloud'})"/></g>`;
const _drops = (n = 3, x0 = 20, y0 = 44) => Array.from({ length: n }, (_, i) => `<line class="drop" style="animation-delay:${(i * .33).toFixed(2)}s" x1="${x0 + i * 10}" y1="${y0}" x2="${x0 + i * 10 - 3}" y2="${y0 + 9}" stroke="url(#gDrop)" stroke-width="3.2" stroke-linecap="round"/>`).join('');
const _flakes = (n = 3, x0 = 20, y0 = 47) => Array.from({ length: n }, (_, i) => `<circle class="flake" style="animation-delay:${(i * .4).toFixed(2)}s" cx="${x0 + i * 10}" cy="${y0 + (i % 2) * 5}" r="2.6" fill="#ffffff" stroke="#b9cde3" stroke-width=".8"/>`).join('');

function wxIcon(kind, cls = '') {
  let g = '';
  switch (kind) {
    case 'clear-day': g = _sun(32, 32, 12); break;
    case 'clear-night': g = _moon(30, 32, 14); break;
    case 'partly-day': g = _sun(24, 24, 9) + _cloud(10, 14, 1.05); break;
    case 'partly-night': g = _moon(24, 24, 10) + _cloud(10, 16, 1.0); break;
    case 'cloudy': g = _cloud(-2, 2, .95, true) + _cloud(6, 12, 1.05); break;
    case 'fog': g = _cloud(4, 4, 1) + [40, 47, 54].map((y, i) => `<line class="fogline" style="animation-delay:${i * .5}s" x1="${12 + i * 3}" y1="${y}" x2="${52 - i * 2}" y2="${y}" stroke="#c9d4e0" stroke-width="3.4" stroke-linecap="round"/>`).join(''); break;
    case 'drizzle': g = _cloud(4, 2, 1) + _drops(3, 22, 42); break;
    case 'rain': g = _cloud(4, 0, 1, true) + _drops(4, 17, 40); break;
    case 'showers-day': g = _sun(20, 20, 8) + _cloud(8, 6, 1) + _drops(3, 22, 42); break;
    case 'showers-night': g = _moon(20, 18, 9) + _cloud(8, 6, 1) + _drops(3, 22, 42); break;
    case 'thunder': g = _cloud(4, 0, 1, true) + `<path class="bolt" d="M33 34l-7 13h7l-4 11 12-16h-7l4-8z" fill="url(#gBolt)"/>` + _drops(2, 18, 42); break;
    case 'snow': g = _cloud(4, 0, 1) + _flakes(3, 21, 44); break;
    case 'sleet': g = _cloud(4, 0, 1, true) + _drops(2, 18, 42) + _flakes(1, 41, 46); break;
    case 'wind': g = `<g fill="none" stroke="#dfe8f2" stroke-width="3.6" stroke-linecap="round" class="windlines"><path d="M8 26h30a7 7 0 1 0-7-7"/><path d="M8 36h40a7 7 0 1 1-7 7"/><path d="M14 46h18"/></g>`; break;
    default: g = _sun(32, 32, 12);
  }
  return `<svg class="wxi ${cls}" viewBox="0 0 64 64" aria-hidden="true">${g}</svg>`;
}

// ---------- Small line icons for labels ----------
const UI = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
  sunrise: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0"/><path d="M12 4v4M9.5 6.5L12 4l2.5 2.5M5 10.5l1.4 1M19 10.5l-1.4 1"/>',
  sunset: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0"/><path d="M12 8V4M9.5 5.5L12 8l2.5-2.5M5 10.5l1.4 1M19 10.5l-1.4 1"/>',
  gauge: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13.5l3.5-4"/><circle cx="12" cy="14" r="1.3"/>',
  waves: '<path d="M3 9c2 0 2-2 4.5-2S9.5 9 12 9s2-2 4.5-2S18.5 9 21 9M3 14c2 0 2-2 4.5-2s2 2 4.5 2 2-2 4.5-2 2 2 4.5 2M3 19c2 0 2-2 4.5-2s2 2 4.5 2 2-2 4.5-2 2 2 4.5 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  umbrella: '<path d="M3.5 12a8.5 8.5 0 0 1 17 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
  drop: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/>',
};
const ui = (name, cls = '') => `<svg class="uii ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name] || ''}</svg>`;

// ---------- Temperature color scale (input in °F) ----------
function tempColor(f) {
  const stops = [[10, [128, 116, 255]], [32, [88, 156, 255]], [50, [72, 200, 220]], [62, [126, 216, 150]], [72, [250, 214, 90]], [84, [255, 158, 74]], [96, [255, 92, 74]], [110, [210, 40, 90]]];
  if (f <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (f <= b) { const t = (f - a) / (b - a); return `rgb(${ca.map((c, k) => Math.round(c + t * (cb[k] - c))).join(',')})`; }
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

// ---------- Smooth curve through points (Catmull-Rom → Bézier) ----------
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// ---------- Moon phase disc ----------
function moonDisc(age, r = 26) {
  const p = (age % 29.530588853) / 29.530588853;
  const waxing = p < 0.5, k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r;
  const s1 = waxing ? 1 : 0, s2 = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  const lit = p < 0.02 || p > 0.98 ? '' : `<path d="M0,${-r} A${r},${r} 0 0 ${s1} 0,${r} A${rx.toFixed(2)},${r} 0 0 ${s2} 0,${-r}Z" fill="url(#gMoon)"/>`;
  return `<svg class="moondisc" viewBox="${-r - 6} ${-r - 6} ${2 * r + 12} ${2 * r + 12}" aria-hidden="true">
    <circle r="${r + 4}" fill="#fff6d0" opacity=".08"/><circle r="${r}" fill="#2a3346" opacity=".9"/>${lit}
    <g fill="#000" opacity=".07"><circle cx="${-r * .3}" cy="${-r * .25}" r="${r * .18}"/><circle cx="${r * .28}" cy="${r * .3}" r="${r * .13}"/><circle cx="${r * .05}" cy="${-r * .55}" r="${r * .09}"/></g></svg>`;
}

// ---------- Sun arc ----------
function sunArc(rise, set, now = Date.now()) {
  const W = 300, H = 120, x0 = 22, x1 = W - 22, base = 100, top = 18;
  const pt = f => { const x = x0 + (x1 - x0) * f; const y = base - (base - top) * Math.sin(Math.PI * f); return [x, y]; };
  const track = Array.from({ length: 41 }, (_, i) => pt(i / 40));
  const path = track.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  let f = rise && set ? (now - rise) / (set - rise) : -1;
  const up = f >= 0 && f <= 1;
  const fc = clamp(f, 0, 1);
  const done = track.filter((_, i) => i / 40 <= fc).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const [sx, sy] = pt(fc);
  return `<svg class="sunarc" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="gArc" x1="0" x2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#ff8a5b"/></linearGradient></defs>
    <line x1="6" y1="${base}" x2="${W - 6}" y2="${base}" class="horizon"/>
    <path d="${path}" class="arctrack"/>
    ${up ? `<path d="${done}" stroke="url(#gArc)" stroke-width="3" fill="none" stroke-linecap="round"/>` : ''}
    ${up ? `<circle cx="${sx}" cy="${sy}" r="16" fill="url(#gSunGlow)"/><circle cx="${sx}" cy="${sy}" r="7.5" fill="url(#gSun)"/>`
      : `<circle cx="${f < 0 ? x0 : x1}" cy="${base}" r="6" class="sundown"/>`}
  </svg>`;
}

// ---------- Gauges ----------
function arcGauge(frac, stops, label, sub) { // 240° arc with gradient and marker
  const r = 34, cx = 44, cy = 44, a0 = 150, a1 = 390;
  const P = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [sx, sy] = P(a0), [ex, ey] = P(a1), [mx, my] = P(a0 + (a1 - a0) * clamp(frac, 0, 1));
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="gauge" viewBox="0 0 88 80" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs>
    <path d="M${sx.toFixed(1)},${sy.toFixed(1)} A${r},${r} 0 1 1 ${ex.toFixed(1)},${ey.toFixed(1)}" stroke="url(#${id})" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="6" class="gmark"/>
    <text x="44" y="47" class="gval">${label}</text><text x="44" y="62" class="gsub">${sub || ''}</text></svg>`;
}
function windDial(dirFrom, speedTxt, unit) {
  const rot = ((dirFrom ?? 0) + 180) % 360; // arrow points where the wind is going
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = i * 10 * Math.PI / 180, r1 = i % 9 === 0 ? 30 : 33, r2 = 37;
    return `<line x1="${(44 + r1 * Math.sin(a)).toFixed(1)}" y1="${(44 - r1 * Math.cos(a)).toFixed(1)}" x2="${(44 + r2 * Math.sin(a)).toFixed(1)}" y2="${(44 - r2 * Math.cos(a)).toFixed(1)}" class="${i % 9 === 0 ? 'tk tkM' : 'tk'}"/>`;
  }).join('');
  return `<svg class="gauge" viewBox="0 0 88 88" aria-hidden="true">${ticks}
    ${[['N', 44, 20], ['E', 70, 47], ['S', 44, 74], ['W', 18, 47]].map(([t, x, y]) => `<text x="${x}" y="${y}" class="card-dir">${t}</text>`).join('')}
    ${dirFrom == null ? '' : `<g transform="rotate(${rot} 44 44)"><line x1="44" y1="70" x2="44" y2="22" class="warrow"/><path d="M44 14l6 10h-12z" class="warrowhead"/><circle cx="44" cy="70" r="3.5" class="warrowtail"/></g>`}
    <circle cx="44" cy="44" r="16.5" class="wcenter"/><text x="44" y="45" class="gval sm">${speedTxt}</text><text x="44" y="55" class="gsub">${unit}</text></svg>`;
}
function barMeter(frac, stops) {
  return `<div class="meter"><div class="mtrack" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="mdot" style="left:${(clamp(frac, 0, 1) * 100).toFixed(1)}%"></div></div>`;
}
