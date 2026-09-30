// =============================================================================
// Snake.js — entitet zmije: kretanje, putanja, segmenti, sposobnosti
//
// Materijalizacija algoritma iz docs/03-MATEMATIKA-I-ALGORITMI.md:
//   glava (steering) → PathBuffer (istorija) → uzorkovanje segmenata (CR splajn)
//   → width profil (taper + pulsevi + squash/stretch) → ribbon render.
// =============================================================================

import { clamp, smoothDamp, turnToward } from '../core/math.js';
import { PathBuffer } from '../core/PathBuffer.js';

export const PATH_SPACING = 4; // px između uzoraka putanje (gustoća = glatkoća)

export const BAL = {
  baseSpeed: 168,     // osnovna brzina px/s
  boostMul: 1.9,      // množilac brzine pri boost-u
  boostDrain: 5.0,    // masa/s koju boost troši
  boostDropEvery: 0.16,
  dropValue: 1.0,
  minBoostMass: 15,
  dashCd: 5.0, dashTime: 0.26, dashSpeed: 560, dashCost: 2, dashTurnMul: 0.32,
  magnetCd: 13.0, magnetTime: 4.0, magnetRadius: 300,
  empCd: 15.0, empRadius: 340, empSlow: 0.42, empTurnMul: 0.5, empTime: 2.4,
  spawnProtect: 2.6,
};

let SID = 1;

export class Snake {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = SID++;
    this.name = opts.name || 'ZMIJA';
    this.hue = opts.hue ?? 190;
    this.isBot = !!opts.isBot;
    this.controller = null;      // LocalController | BotController | null

    this.mass = opts.mass ?? 26;
    this.kills = 0;
    this.score = 0;
    this.aliveTime = 0;

    // --- kretanje ---
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.heading = opts.heading ?? 0;
    this.speed = BAL.baseSpeed;
    this.boostFactor = 0;        // gladak 0→1 (vizuelni + fizika)

    // --- stanja ---
    this.dead = false;
    this.invuln = BAL.spawnProtect;
    this.slowT = 0;              // EMP debaf
    this.dashT = 0; this.dashCd = 0;
    this.magnetT = 0; this.magnetCd = 0;
    this.empCd = 0;
    this.buffs = { speed: 0, magnet: 0, double: 0 }; // power-up bonusi (sekunde)
    this.dropTimer = 0;
    this.pulseTimer = 0;

    // --- telo ---
    this.path = new PathBuffer(PATH_SPACING, 2600);
    this.segs = [];              // [{x, y, w, s, r, sid}]
    this.pulses = [];            // putovali "bulge" talasi: [{s}]
    this.ghosts = [];            // afterimage tragovi pri dash-u
    this.ghostTimer = 0;

    // --- ulaz (popunjava controller) ---
    this.input = {
      tx: this.x + Math.cos(this.heading) * 100,
      ty: this.y + Math.sin(this.heading) * 100,
      boost: false, dash: false, magnet: false, emp: false,
    };

    // AABB za culling
    this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;

    this.initBody();
  }

  // ---------------------------------------------------------------- geometrija
  get baseWidth() { return 13 + Math.min(21, this.mass / 55); }
  get headRadius() { return this.baseWidth * 0.58; }
  get segSpacing() { return clamp(this.baseWidth * 0.52, 5.5, 16); }
  get targetSegCount() { return Math.min(240, 13 + Math.floor(this.mass / 3)); }
  get totalLen() { return this.segs.length * this.segSpacing; }
  get magnetActive() { return this.magnetT > 0 || this.buffs.magnet > 0; }

  initBody() {
    const n = this.targetSegCount;
    const sp = this.segSpacing;
    // napuni putanje unazad od repa ka glavi (push ide ka novijim tačkama)
    const len = n * sp + 90;
    let px = this.x - Math.cos(this.heading) * len;
    let py = this.y - Math.sin(this.heading) * len;
    this.path.clear(px, py);
    let d = Math.hypot(this.x - px, this.y - py);
    let guard = 0;
    while (d >= PATH_SPACING && guard++ < 2000) {
      px += ((this.x - px) / d) * PATH_SPACING;
      py += ((this.y - py) / d) * PATH_SPACING;
      this.path.push(px, py);
      d = Math.hypot(this.x - px, this.y - py);
    }
    this.segs.length = 0;
    for (let i = 0; i < n; i++) this.segs.push({ x: 0, y: 0, w: 6, s: 0, r: 3, sid: this.id });
    this.refreshSegs();
    this.updateSegWidths(0);
  }

  _makeSeg() { return { x: 0, y: 0, w: 6, s: 0, r: 3, sid: this.id }; }

  // ------------------------------------------------------------------- update
  update(dt, time) {
    if (this.dead) return;
    this.aliveTime += dt;

    // tajmeri
    if (this.invuln > 0) this.invuln -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.magnetCd > 0) this.magnetCd -= dt;
    if (this.empCd > 0) this.empCd -= dt;
    if (this.dashT > 0) this.dashT -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.buffs.speed > 0) this.buffs.speed -= dt;
    if (this.buffs.magnet > 0) this.buffs.magnet -= dt;
    if (this.buffs.double > 0) this.buffs.double -= dt;

    // afterimage tragovi
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t -= dt;
      if (g.t <= 0) this.ghosts.splice(i, 1);
    }

    const inp = this.input;

    // --- sposobnosti (edge-triggered) ---
    if (inp.dash) { inp.dash = false; this.tryDash(); }
    if (inp.magnet) { inp.magnet = false; this.tryMagnet(); }
    if (inp.emp) { inp.emp = false; this.tryEmp(); }

    // --- boost (troši masu) ---
    const wantBoost = inp.boost && this.mass > BAL.minBoostMass && this.dashT <= 0;
    if (wantBoost && this.invuln > 0) this.invuln = 0; // boost skida spawn zaštitu
    this.boostFactor = smoothDamp(this.boostFactor, wantBoost ? 1 : 0, 10, dt);

    // --- steering: ograničena ugaona brzina ---
    const desired = Math.atan2(inp.ty - this.y, inp.tx - this.x);
    const w = this.baseWidth;
    let omega = 4.6 * Math.pow(15 / w, 0.35);   // velike zmije sporije skreću
    if (this.boostFactor > 0.1) omega *= 1 - 0.25 * this.boostFactor;
    if (this.dashT > 0) omega *= BAL.dashTurnMul;
    if (this.slowT > 0) omega *= BAL.empTurnMul;
    this.heading = turnToward(this.heading, desired, omega * dt);

    // --- brzina ---
    let v = BAL.baseSpeed * (1 + (BAL.boostMul - 1) * this.boostFactor);
    if (this.buffs.speed > 0) v *= 1.35;
    if (this.slowT > 0) v *= BAL.empSlow;
    if (this.dashT > 0) { const k = this.dashT / BAL.dashTime; v += BAL.dashSpeed * k * k; }
    this.speed = v;

    // --- integracija pozicije ---
    this.x += Math.cos(this.heading) * v * dt;
    this.y += Math.sin(this.heading) * v * dt;

    // --- boost: drenaža mase + ispuštanje hrane + pulsevi ---
    if (this.boostFactor > 0.5) {
      this.mass -= BAL.boostDrain * dt;
      this.dropTimer -= dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = BAL.boostDropEvery;
        const tail = this.segs[this.segs.length - 1];
        if (tail) this.world.dropBoostPellet(tail.x, tail.y, this.hue);
      }
      this.pulseTimer -= dt;
      if (this.pulseTimer <= 0) { this.pulseTimer = 0.45; this.pulses.push({ s: 0 }); }
    }

    // afterimage snimci tokom dash-a
    if (this.dashT > 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.045;
        this.snapshotGhost();
      }
    }

    // pulsevi putuju niz telo brzinom nezavisnom od zmije
    const total = this.totalLen + 80;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.s += 300 * dt;
      if (p.s > total) this.pulses.splice(i, 1);
    }

    // --- putanja: dodaj tačke na fiksnom razmaku ---
    this.pushPathPoints();

    // --- broj segmenata prati masu (rast/opadanje, max 3 po frejmu = glatko) ---
    const target = this.targetSegCount;
    if (this.segs.length < target) {
      for (let i = 0; i < 3 && this.segs.length < target; i++) this.segs.push(this._makeSeg());
    } else if (this.segs.length > target) {
      for (let i = 0; i < 3 && this.segs.length > target; i++) this.segs.pop();
    }

    this.refreshSegs();
    this.updateSegWidths(time);
  }

  pushPathPoints() {
    let px = this.path.x(0), py = this.path.y(0);
    let dx = this.x - px, dy = this.y - py;
    let d = Math.hypot(dx, dy);
    let guard = 0;
    while (d >= PATH_SPACING && guard++ < 256) {
      px += (dx / d) * PATH_SPACING;
      py += (dy / d) * PATH_SPACING;
      this.path.push(px, py);
      dx = this.x - px; dy = this.y - py;
      d = Math.hypot(dx, dy);
    }
  }

  refreshSegs() {
    const n = this.segs.length, sp = this.segSpacing;
    let minX = this.x, minY = this.y, maxX = this.x, maxY = this.y;
    for (let i = 0; i < n; i++) {
      const seg = this.segs[i];
      this.path.sample((i + 1) * sp, this.x, this.y, seg);
      seg.s = (i + 1) * sp;
      if (seg.x < minX) minX = seg.x; else if (seg.x > maxX) maxX = seg.x;
      if (seg.y < minY) minY = seg.y; else if (seg.y > maxY) maxY = seg.y;
    }
    const m = this.baseWidth;
    this.minX = minX - m; this.maxX = maxX + m;
    this.minY = minY - m; this.maxY = maxY + m;
  }

  /// Profil širine: konus repa + putovali pulsevi + "disanje" + sužavanje pri boost-u.
  updateSegWidths(time) {
    const n = this.segs.length, w = this.baseWidth;
    const boostNarrow = 1 - 0.10 * this.boostFactor;
    const tailN = Math.min(10, n);
    const pulses = this.pulses;
    for (let i = 0; i < n; i++) {
      const seg = this.segs[i];
      let m = 1;
      const fromEnd = n - 1 - i;
      if (fromEnd < tailN) { const t = 1 - fromEnd / tailN; m *= 1 - 0.68 * t * t; }
      for (let p = 0; p < pulses.length; p++) {
        const ds = (seg.s - pulses[p].s) / 26;
        m *= 1 + 0.34 * Math.exp(-ds * ds);
      }
      m *= 1 + 0.03 * Math.sin(time * 2.2 + i * 0.4 + this.id);
      const fw = w * m * boostNarrow;
      seg.w = fw;
      seg.r = fw * 0.5;
    }
  }

  snapshotGhost() {
    const stride = 2, cap = 56;
    const n = Math.min(cap, Math.ceil(this.segs.length / stride) + 1);
    const xs = new Float32Array(n), ys = new Float32Array(n);
    xs[0] = this.x; ys[0] = this.y;
    for (let i = 1; i < n; i++) {
      const seg = this.segs[Math.min(this.segs.length - 1, (i - 1) * stride)];
      xs[i] = seg.x; ys[i] = seg.y;
    }
    this.ghosts.push({ xs, ys, n, w: this.baseWidth, hue: this.hue, t: 0.38, ttl: 0.38 });
    if (this.ghosts.length > 6) this.ghosts.shift();
  }

  // -------------------------------------------------------------- sposobnosti
  tryDash() {
    if (this.dead || this.dashCd > 0 || this.mass < BAL.minBoostMass) return false;
    this.dashCd = BAL.dashCd;
    this.dashT = BAL.dashTime;
    this.mass -= BAL.dashCost;
    if (this.world) this.world.onDash(this);
    return true;
  }

  tryMagnet() {
    if (this.dead || this.magnetCd > 0 || this.magnetT > 0) return false;
    this.magnetCd = BAL.magnetCd;
    this.magnetT = BAL.magnetTime;
    if (this.world) this.world.onMagnet(this);
    return true;
  }

  tryEmp() {
    if (this.dead || this.empCd > 0) return false;
    this.empCd = BAL.empCd;
    if (this.world) this.world.onEmp(this);
    return true;
  }

  addScore(base) {
    const mult = this.buffs.double > 0 ? 2 : 1;
    this.score += base * mult;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
  }
}
