// =============================================================================
// Food.js — pellets, Mega-Orbs, power-up kapsule, drop-orbs posle smrti
// =============================================================================

import { clamp } from '../core/math.js';

export const FOOD = {
  pelletTarget: 900,
  megaTarget: 18,
  powerTarget: 5,
  powerTypes: ['speed', 'magnet', 'double'],
};

let FID = 1;

export class Food {
  /// type: 'pellet' | 'mega' | 'drop' | 'power'
  constructor(type, x, y, opts = {}) {
    this.id = FID++;
    this.type = type;
    this.x = x; this.y = y;
    this.r = opts.r ?? 4;
    this.value = opts.value ?? 1;      // masa koju daje
    this.hue = opts.hue ?? 50;
    this.power = opts.power || null;   // za 'power'
    this.life = opts.life ?? Infinity; // za 'power' i 'drop'
    this.phase = Math.random() * Math.PI * 2;
    this.vx = 0; this.vy = 0;
    this.dead = false;
    this.pullT = 0; this.tx = 0; this.ty = 0; // magnet (postavlja World)
    if (type === 'mega') { this.r = 9; this.value = 8; }
    if (type === 'drop') { this.r = clamp(4 + this.value, 5, 9); }
    if (type === 'power') { this.r = 11; this.value = 2; }
  }

  update(dt, time, world) {
    if (this.life !== Infinity) {
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
    }

    // --- magnet privlačenje (cilj postavlja World u eat-passu) ---
    if (this.pullT > 0) {
      this.pullT -= dt;
      const dx = this.tx - this.x, dy = this.ty - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx / d) * 2600 * dt;
      this.vy += (dy / d) * 2600 * dt;
      const sp = Math.hypot(this.vx, this.vy);
      const max = 760;
      if (sp > max) { this.vx = this.vx / sp * max; this.vy = this.vy / sp * max; }
    } else if (this.type === 'mega') {
      // --- Mega-Orb: budi od zmija ---
      let fx = 0, fy = 0, scare = 0;
      for (const s of world.snakes) {
        if (s.dead) continue;
        const dx = this.x - s.x, dy = this.y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 190 * 190 && d2 > 1) {
          const d = Math.sqrt(d2);
          const w = 1 - d / 190;
          fx += (dx / d) * w; fy += (dy / d) * w;
          scare = Math.max(scare, w);
        }
      }
      if (scare > 0) {
        const d = Math.hypot(fx, fy) || 1;
        this.vx += (fx / d) * 620 * scare * dt;
        this.vy += (fy / d) * 620 * scare * dt;
      } else {
        this.wander(dt, 40, 26);
      }
    } else if (this.type === 'pellet') {
      // --- pasivno lebdenje ---
      this.wander(dt, 14, 10);
    } else if (this.type === 'drop') {
      // drop orb: samo trenje
    }
    // 'power' je statičan (samo vizuelno lebdi u rendereru)

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // trenje
    const drag = Math.exp(-3.2 * dt);
    this.vx *= drag; this.vy *= drag;

    // ne puštaj hranu kroz ivicu sveta
    const d0 = Math.hypot(this.x, this.y);
    if (d0 > world.R - 20) {
      const k = (world.R - 20) / d0;
      this.x *= k; this.y *= k;
      this.vx *= -0.5; this.vy *= -0.5;
    }
  }

  wander(dt, maxSpeed, accel) {
    this.phase += dt;
    const ax = Math.cos(this.phase * 0.7 + this.id) * accel;
    const ay = Math.sin(this.phase * 0.9 + this.id * 1.3) * accel;
    this.vx += ax * dt; this.vy += ay * dt;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSpeed) { this.vx = this.vx / sp * maxSpeed; this.vy = this.vy / sp * maxSpeed; }
  }
}
