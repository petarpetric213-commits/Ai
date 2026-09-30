// =============================================================================
// Effects.js — čestice, kristalni shard-ovi, shockwave, screen shake, slow-mo
//
// Screen shake koristi "trauma" model: shake = trauma², trauma eksponencijalno
// opada — prirodan udarac bez trzanja. Offset = mešavina dve sinusne frekvencije.
// =============================================================================

import { randRange, easeOutCubic } from '../core/math.js';

const MAX_PARTICLES = 1500;

export class Effects {
  constructor(rng) {
    this.rng = rng;
    this.particles = [];
    this.shockwaves = [];
    this.texts = [];
    this.trauma = 0;
    this.timeScale = 1;
    this.shakeX = 0; this.shakeY = 0;
    this._t = 0;
  }

  /// dt = skalirano (slow-mo) vreme, rdt = realno vreme
  update(dt, rdt) {
    this._t += rdt;
    this.timeScale += (1 - this.timeScale) * Math.min(1, 2.4 * rdt);

    // --- screen shake (trauma model) ---
    this.trauma = Math.max(0, this.trauma - 1.5 * rdt);
    const s = this.trauma * this.trauma;
    this.shakeX = s * 30 * Math.sin(this._t * 93.7) * Math.cos(this._t * 47.3);
    this.shakeY = s * 26 * Math.sin(this._t * 81.1 + 1.7) * Math.cos(this._t * 53.9);

    // --- čestice ---
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      if (p.vr) p.rot += p.vr * dt;
    }

    // --- shockwave-ovi ---
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i];
      w.t += dt;
      if (w.t >= w.dur) this.shockwaves.splice(i, 1);
    }

    // --- lebdeći tekstovi ---
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.y -= 26 * dt;
      if (t.t >= t.ttl) this.texts.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ spawneri
  spark(x, y, opts = {}) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const rng = this.rng;
    const ang = opts.ang ?? rng() * Math.PI * 2;
    const spd = opts.speed ?? randRange(rng, 30, 260);
    this.particles.push({
      type: 'spark',
      x, y,
      vx: Math.cos(ang) * spd + (opts.vx || 0),
      vy: Math.sin(ang) * spd + (opts.vy || 0),
      drag: opts.drag ?? 2.2,
      size: opts.size ?? randRange(rng, 2, 5),
      hue: opts.hue ?? 50,
      life: opts.ttl ?? randRange(rng, 0.35, 0.9),
      ttl: opts.ttl ?? 0.6,
      rot: 0, vr: 0,
    });
  }

  /// "Kristalisane svetlosne čestice" — smrt zmije.
  shard(x, y, hue, vx = 0, vy = 0) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const rng = this.rng;
    const ang = rng() * Math.PI * 2;
    const spd = randRange(rng, 60, 380);
    this.particles.push({
      type: 'shard',
      x, y,
      vx: Math.cos(ang) * spd * 0.7 + vx,
      vy: Math.sin(ang) * spd * 0.7 + vy,
      drag: 1.5,
      size: randRange(rng, 3, 9),
      hue,
      life: randRange(rng, 0.7, 1.6),
      ttl: 1.6,
      rot: rng() * Math.PI * 2,
      vr: randRange(rng, -7, 7),
    });
  }

  burst(x, y, hue, count = 10, speed = 220) {
    for (let i = 0; i < count; i++) this.spark(x, y, { hue, speed: this.rng() * speed + 30 });
  }

  shockwave(x, y, hue, rMax = 260, dur = 0.55) {
    this.shockwaves.push({ x, y, hue, rMax, dur, t: 0 });
  }

  text(x, y, str, hue = 50) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, str, hue, t: 0, ttl: 1.1 });
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  slowMo(scale = 0.3) { this.timeScale = Math.min(this.timeScale, scale); }

  /// 0..1 progres shockwave-a (ease out cubic).
  waveProgress(w) { return easeOutCubic(Math.min(1, w.t / w.dur)); }
}
