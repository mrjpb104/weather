'use strict';
/* Living sky: a full-page canvas whose colors follow the real sun position, with clouds sized to
   actual cloud cover, rain/snow when precipitating, stars on clear nights and lightning in storms. */

function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180, d = date / 864e5 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * rad - ra, la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { alt: alt / rad, az: ((az / rad) + 360) % 360 };
}

const SKY_KEYS = [ // sun altitude → [top, middle, bottom]
  [-18, ['#03060f', '#070d1f', '#0d1830']],
  [-12, ['#060c20', '#0e1a3a', '#1d2b52']],
  [-7, ['#0f1a3d', '#273766', '#5a4a7c']],
  [-3, ['#1c2a5a', '#5a4f86', '#d27b6b']],
  [0, ['#2a3f7c', '#8a6b9a', '#f19a68']],
  [4, ['#3560a6', '#7f9cc8', '#f6c08a']],
  [10, ['#2f6fc0', '#5f9bd8', '#a9cdea']],
  [30, ['#2a6dc4', '#4f92dc', '#8fc0ec']],
  [90, ['#2566bd', '#4a8bd6', '#86b9e8']],
];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function skyColors(alt, cloud, wet) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && alt > SKY_KEYS[i + 1][0]) i++;
  const [a0, c0] = SKY_KEYS[i], [a1, c1] = SKY_KEYS[i + 1];
  const t = clamp((alt - a0) / (a1 - a0), 0, 1);
  let cols = c0.map((h, k) => mix(hex(h), hex(c1[k]), t));
  // Overcast: pull toward slate grays (lighter by day, darker by night)
  const dayness = clamp((alt + 6) / 16, 0, 1);
  const grey = [mix([22, 28, 40], [84, 104, 128], dayness), mix([34, 42, 58], [116, 134, 154], dayness), mix([46, 56, 74], [142, 158, 176], dayness)];
  const c = clamp(cloud * (wet ? 1 : 0.85), 0, 1);
  cols = cols.map((col, k) => mix(col, grey[k], c * 0.85));
  if (wet) cols = cols.map(col => col.map(v => Math.round(v * 0.82)));
  return cols;
}

const fx = {
  canvas: null, ctx: null, w: 0, h: 0, dpr: 1, raf: 0, last: 0, running: false,
  state: { lat: 33, lon: -117, cloud: 0.2, precip: 0, kind: 'rain', thunder: false, wind: 0.3 },
  clouds: [], drops: [], stars: [], flash: 0, nextFlash: 0, sprites: null, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,

  init() {
    if (this.canvas) return;
    const c = document.createElement('canvas');
    c.id = 'skyfx'; c.setAttribute('aria-hidden', 'true');
    document.body.prepend(c);
    this.canvas = c; this.ctx = c.getContext('2d');
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.resize();
  },
  resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seed();
    if (!this.running) this.draw(0);
  },
  update(s) {
    Object.assign(this.state, s);
    this.init();
    this.seed();
    this.start();
  },
  enabled() { return document.documentElement.dataset.theme === 'sky'; },
  start() {
    if (!this.canvas || !this.enabled()) { this.stop(); if (this.canvas) this.canvas.style.display = 'none'; return; }
    this.canvas.style.display = 'block';
    if (this.reduced) { this.draw(0); return; }
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const loop = t => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  stop() { this.running = false; cancelAnimationFrame(this.raf); },

  makeSprites() {
    // Soft cloud puffs rendered once to offscreen canvases (light and dark variants)
    const mk = (seed, dark) => {
      const W = 420, H = 180, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      let r = seed;
      const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 16; i++) {
        const px = 70 + rnd() * 280, py = 70 + rnd() * 50 - (Math.abs(px - 210) < 90 ? 20 : 0), pr = 34 + rnd() * 46;
        const g = x.createRadialGradient(px, py, 0, px, py, pr);
        const base = dark ? '150,162,180' : '255,255,255';
        g.addColorStop(0, `rgba(${base},${dark ? 0.55 : 0.75})`);
        g.addColorStop(0.55, `rgba(${base},${dark ? 0.32 : 0.42})`);
        g.addColorStop(1, `rgba(${base},0)`);
        x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.fill();
      }
      return c;
    };
    this.sprites = { light: [1, 7, 13, 21].map(s => mk(s, false)), dark: [3, 9, 17, 29].map(s => mk(s, true)) };
  },
  seed() {
    if (!this.w) return;
    if (!this.sprites) this.makeSprites();
    const s = this.state;
    const nClouds = Math.round(2 + s.cloud * 14);
    this.clouds = Array.from({ length: nClouds }, (_, i) => ({
      x: Math.random() * (this.w + 500) - 250,
      y: -40 + Math.random() * this.h * 0.75,
      s: 0.6 + Math.random() * 1.1,
      v: 4 + Math.random() * 10 + s.wind * 12,
      k: i % 4, a: 0.45 + Math.random() * 0.5,
    }));
    const nDrops = Math.round(s.precip * (s.kind === 'snow' ? 160 : 260) * clamp(this.w / 600, 0.6, 1.6));
    this.drops = Array.from({ length: nDrops }, () => this.newDrop(true));
    this.stars = Array.from({ length: Math.round(this.w * this.h / 5200) }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h * 0.7, r: Math.random() * 1.1 + 0.3, p: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.6 }));
    this.nextFlash = performance.now() + 4000 + Math.random() * 8000;
  },
  newDrop(anywhere) {
    const snow = this.state.kind === 'snow';
    return { x: Math.random() * (this.w + 200) - 100, y: anywhere ? Math.random() * this.h : -20 - Math.random() * 60,
      v: snow ? 40 + Math.random() * 50 : 700 + Math.random() * 450, l: snow ? 0 : 10 + Math.random() * 14,
      r: snow ? 1.2 + Math.random() * 2.2 : 0, ph: Math.random() * 6.28, a: 0.12 + Math.random() * 0.22 };
  },

  draw(dt) {
    const { ctx, w, h, state: s } = this;
    if (!ctx) return;
    const now = new Date();
    const sun = solarPosition(now, s.lat, s.lon);
    const wet = s.precip > 0.05;
    const [top, mid, bot] = skyColors(sun.alt, s.cloud, wet);
    const scroll = scrollY || 0;

    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(top)); g.addColorStop(0.55, rgb(mid)); g.addColorStop(1, rgb(bot));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    document.documentElement.style.setProperty('--sky-top', rgb(top));
    document.documentElement.style.setProperty('--sky-bot', rgb(bot));

    // Stars (fade in below -4° sun altitude, hidden by clouds)
    const starA = clamp((-sun.alt - 4) / 8, 0, 1) * (1 - clamp(s.cloud * 1.3, 0, 1));
    if (starA > 0.02) {
      const t = performance.now() / 1000;
      ctx.fillStyle = '#ffffff';
      for (const st of this.stars) {
        ctx.globalAlpha = starA * (0.45 + 0.55 * Math.abs(Math.sin(st.p + t * st.sp * (this.reduced ? 0 : 1))));
        ctx.beginPath(); ctx.arc(st.x, st.y - scroll * 0.05, st.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Sun or moon glow, placed by azimuth (east = left, west = right) and altitude
    const sx = w * clamp(0.5 + ((sun.az - 180) / 180) * 0.62, 0.08, 0.92);
    if (sun.alt > -8) {
      const sy = h * clamp(0.42 - (sun.alt / 60) * 0.5, 0.04, 0.62) - scroll * 0.08;
      const warm = clamp(1 - sun.alt / 18, 0, 1);
      const strength = clamp((sun.alt + 8) / 10, 0, 1) * (1 - s.cloud * 0.75);
      const R = Math.max(w, h) * (0.35 + warm * 0.25);
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      sg.addColorStop(0, `rgba(255,${Math.round(236 - warm * 60)},${Math.round(190 - warm * 90)},${0.55 * strength})`);
      sg.addColorStop(0.25, `rgba(255,${Math.round(214 - warm * 70)},${Math.round(150 - warm * 70)},${0.22 * strength})`);
      sg.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
      if (sun.alt > 0 && s.cloud < 0.7) {
        ctx.globalAlpha = strength * 0.9;
        const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
        core.addColorStop(0, 'rgba(255,252,235,1)'); core.addColorStop(0.35, 'rgba(255,240,200,.65)'); core.addColorStop(1, 'rgba(255,230,180,0)');
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (s.cloud < 0.85) {
      const mx = w * 0.78, my = h * 0.14 - scroll * 0.06;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 160);
      mg.addColorStop(0, `rgba(220,230,255,${0.22 * (1 - s.cloud)})`); mg.addColorStop(1, 'rgba(220,230,255,0)');
      ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(250,248,235,${0.85 * (1 - s.cloud)})`;
      ctx.beginPath(); ctx.arc(mx, my, 13, 0, 6.283); ctx.fill();
    }

    // Clouds
    const night = sun.alt < -4;
    const set = night || wet || s.cloud > 0.75 ? this.sprites.dark : this.sprites.light;
    const tint = clamp((sun.alt + 6) / 14, 0, 1);
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > w + 260) { c.x = -460 * c.s; c.y = -40 + Math.random() * h * 0.75; }
      const sp = set[c.k];
      ctx.globalAlpha = c.a * (night ? 0.55 : 0.6 + 0.4 * tint) * (0.55 + s.cloud * 0.6);
      ctx.drawImage(sp, c.x, c.y - scroll * 0.12 * c.s, sp.width * c.s, sp.height * c.s);
    }
    ctx.globalAlpha = 1;

    // Rain / snow
    if (this.drops.length) {
      const slant = 0.12 + s.wind * 0.25;
      if (s.kind === 'snow') {
        ctx.fillStyle = '#ffffff';
        for (const d of this.drops) {
          d.y += d.v * dt; d.ph += dt; d.x += Math.sin(d.ph) * 0.4 + slant * d.v * dt;
          if (d.y > h + 10) Object.assign(d, this.newDrop(false));
          ctx.globalAlpha = d.a + 0.35; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
        }
      } else {
        ctx.strokeStyle = '#dfeaff'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
        for (const d of this.drops) {
          d.y += d.v * dt; d.x += d.v * dt * slant;
          if (d.y > h + 20) Object.assign(d, this.newDrop(false));
          ctx.globalAlpha = d.a; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * slant, d.y - d.l); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Lightning
    if (s.thunder && !this.reduced) {
      const t = performance.now();
      if (t > this.nextFlash) { this.flash = 1; this.nextFlash = t + 5000 + Math.random() * 11000; }
      if (this.flash > 0.01) {
        ctx.fillStyle = `rgba(235,240,255,${(this.flash * 0.45 * (0.6 + 0.4 * Math.random())).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
        this.flash *= Math.pow(0.02, dt * 2.2);
      }
    }
  },
};

// Feed the sky from a loaded location view.
function fxFromView(v) {
  const txt = `${v.now.text || ''} ${v.hourly[0]?.text || ''}`.toLowerCase();
  let cloud = v.omv?.current?.cloud_cover;
  cloud = cloud != null ? cloud / 100
    : /overcast|^cloudy|mostly cloudy|fog/.test(txt) ? 0.85 : /partly|scattered clouds/.test(txt) ? 0.45 : /few clouds|mostly clear|mostly sunny/.test(txt) ? 0.2 : /rain|shower|storm/.test(txt) ? 0.8 : 0.08;
  const nowTxt = (v.now.text || '').toLowerCase();
  const precipNow = v.omv?.current?.precipitation ?? 0;
  const wetWord = /rain|shower|drizzle|thunder|storm|snow|sleet/.test(nowTxt);
  let precip = 0;
  if (wetWord || precipNow > 0.05) {
    precip = /heavy/.test(nowTxt) || precipNow > 4 ? 1 : /light|drizzle/.test(nowTxt) || precipNow < 0.6 ? 0.35 : 0.65;
  }
  const kind = /snow|flurr|sleet/.test(nowTxt) ? 'snow' : 'rain';
  const thunder = /thunder|t-storm/.test(nowTxt);
  const wind = clamp((v.now.windKmh || 0) / 50, 0, 1);
  fx.update({ lat: v.lat, lon: v.lon, cloud: Math.max(cloud, precip ? 0.7 : 0), precip, kind, thunder, wind });
}
