// =============================================================================
// Renderer.js — glavni canvas renderer (Canvas 2D, zero-dependency)
//
// TEHNIKA "NEON RIBBON" (4 prolaza po zmiji):
//   1. široki aditivni glow  (lighter, width ×2.7, α ~0.08 + puls brzine)
//   2. srednji glow          (lighter, width ×1.6, α ~0.2)
//   3. telo                  (source-over, puni satenski ton — tamna "cev")
//      + kontura             (stroke 1.5px svetla)
//   4. unutrašnja svetla pruga sa pomakom ka svetlu (fake 3D osvetljenje cevi)
//
// Glow se NE crta shadowBlur-om (presporo) već pre-renderovanim radialnim
// sprite-ovima i višestrukim prolazima poligona — 60fps sa 13 zmija.
// U produkciji se ovo preslikava na PixiJS MeshRope + additive sprites.
// =============================================================================

import { TAU, clamp } from '../core/math.js';
import { BAL } from '../entities/Snake.js';

const LIGHT = { x: -0.62, y: -0.78 }; // pravac svetla (ekranski gore-levo)
const MAXPTS = 512;

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.w = 0; this.h = 0; this.dpr = 1;

    // keš glow sprite-ova po nijansi (10° granulacija)
    this._glows = new Map();

    // flat baferi tačaka zmije (bez alokacija po frejmu)
    this._px = new Float32Array(MAXPTS);
    this._py = new Float32Array(MAXPTS);
    this._nx = new Float32Array(MAXPTS);
    this._ny = new Float32Array(MAXPTS);
    this._pw = new Float32Array(MAXPTS);
    this._n = 0;

    this._tmp = { x: 0, y: 0 };
    this._perfMode = false;
  }

  resize() {
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.w = globalThis.innerWidth;
    this.h = globalThis.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  glow(hue) {
    const key = Math.round(hue / 10) * 10;
    let c = this._glows.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, `hsla(${key}, 100%, 92%, 0.95)`);
      rg.addColorStop(0.22, `hsla(${key}, 100%, 65%, 0.55)`);
      rg.addColorStop(0.55, `hsla(${key}, 100%, 55%, 0.16)`);
      rg.addColorStop(1, `hsla(${key}, 100%, 50%, 0)`);
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      this._glows.set(key, c);
    }
    return c;
  }

  render(cam, rdt, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // pozadinu crta Background (u sebi koristi cam.apply)
    // --- SVETSKI SLOJ ---
    ctx.save();
    cam.apply(ctx);
    const v = cam.view();

    this._drawShadows(ctx, v);
    this._drawFood(ctx, v, time);
    this._drawGhosts(ctx, v);
    this._drawSnakes(ctx, v, time);
    this._drawParticles(ctx, v);
    this._drawShockwaves(ctx, v);
    this._drawMagnetRings(ctx, time);

    ctx.restore();

    // --- SCREEN-SPACE: imena, lebdeći tekstovi ---
    this._drawOverlayText(ctx, cam, time);
  }

  // ------------------------------------------------------------------ senke
  _drawShadows(ctx, v) {
    // meka senka ispod zmija → 2.5D dubina
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (const s of this.world.snakes) {
      if (s.dead) continue;
      if (s.maxX < v.x0 || s.minX > v.x1 || s.maxY < v.y0 || s.minY > v.y1) continue;
      ctx.beginPath();
      const off = 0.55 * s.baseWidth;
      let first = true;
      const step = Math.max(1, Math.floor(s.segs.length / 60));
      for (let i = 0; i < s.segs.length; i += step) {
        const seg = s.segs[i];
        const x = seg.x + off, y = seg.y + off * 1.4;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.baseWidth * 1.9;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ hrana
  _drawFood(ctx, v, time) {
    const world = this.world;
    ctx.globalCompositeOperation = 'lighter';

    for (const f of world.foods) {
      if (f.x < v.x0 - 30 || f.x > v.x1 + 30 || f.y < v.y0 - 30 || f.y > v.y1 + 30) continue;
      const pulse = 0.8 + 0.25 * Math.sin(time * 2.4 + f.phase * 7);

      if (f.type === 'pellet' || f.type === 'drop') {
        const r = f.r * (f.type === 'drop' ? 1.25 : 1);
        const g = this.glow(f.hue);
        const size = r * (f.type === 'drop' ? 5.5 : 6) * pulse;
        ctx.globalAlpha = f.type === 'drop' ? 0.9 : 0.75;
        ctx.drawImage(g, f.x - size, f.y - size, size * 2, size * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = `hsl(${f.hue}, 100%, 82%)`;
        ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.62, 0, TAU); ctx.fill();
      } else if (f.type === 'mega') {
        const g = this.glow(185);
        const size = 34 * pulse;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(g, f.x - size, f.y - size, size * 2, size * 2);
        ctx.globalAlpha = 1;
        // belo plavo jezgro + rotirajući "iskričavi" krst
        ctx.fillStyle = 'hsl(185, 100%, 88%)';
        ctx.beginPath(); ctx.arc(f.x, f.y, 5.2 * pulse, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'hsla(185, 100%, 80%, 0.8)';
        ctx.lineWidth = 1.6;
        const rot = time * 2 + f.phase;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = rot + k * Math.PI / 2;
          ctx.moveTo(f.x + Math.cos(a) * 8, f.y + Math.sin(a) * 8);
          ctx.lineTo(f.x + Math.cos(a) * 13, f.y + Math.sin(a) * 13);
        }
        ctx.stroke();
      } else if (f.type === 'power') {
        const blink = f.life < 5 ? (Math.sin(time * 14) > 0 ? 1 : 0.25) : 1;
        const g = this.glow(f.hue);
        const size = 30 * pulse;
        ctx.globalAlpha = 0.9 * blink;
        ctx.drawImage(g, f.x - size, f.y - size, size * 2, size * 2);
        ctx.globalAlpha = 1;
        // heksa kapsula
        ctx.strokeStyle = `hsla(${f.hue}, 100%, 75%, ${0.9 * blink})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3 + time * 1.2;
          const x = f.x + Math.cos(a) * f.r, y = f.y + Math.sin(a) * f.r;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        // glif
        ctx.fillStyle = `hsla(${f.hue}, 100%, 85%, ${blink})`;
        this._powerGlyph(ctx, f);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _powerGlyph(ctx, f) {
    const x = f.x, y = f.y;
    ctx.beginPath();
    if (f.power === 'speed') {
      // munja
      ctx.moveTo(x + 3, y - 6); ctx.lineTo(x - 3, y + 1); ctx.lineTo(x + 0.5, y + 1);
      ctx.lineTo(x - 3, y + 7); ctx.lineTo(x + 3.5, y - 1); ctx.lineTo(x + 0.5, y - 1);
      ctx.closePath();
      ctx.fill();
    } else if (f.power === 'magnet') {
      // potkova
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y + 1.5, 4.5, Math.PI, 0);
      ctx.moveTo(x - 4.5, y + 1.5); ctx.lineTo(x - 4.5, y + 5.5);
      ctx.moveTo(x + 4.5, y + 1.5); ctx.lineTo(x + 4.5, y + 5.5);
      ctx.stroke();
    } else {
      // ×2
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×2', x, y + 0.5);
    }
  }

  // ----------------------------------------------------------- zmije (core)
  _prepare(s, time) {
    // pakuj head + segmente u flat bafer + normale iz tangenti
    const n = Math.min(MAXPTS, s.segs.length + 1);
    this._n = n;
    const px = this._px, py = this._py, nx = this._nx, ny = this._ny, pw = this._pw;

    const jit = s.slowT > 0 ? 2.2 : 0; // EMP "glitch" drhtanje
    px[0] = s.x; py[0] = s.y;
    if (jit) { px[0] += Math.sin(time * 47 + s.id) * jit; py[0] += Math.cos(time * 39 + s.id) * jit; }
    pw[0] = s.baseWidth * 1.12;

    for (let i = 1; i < n; i++) {
      const seg = s.segs[i - 1];
      px[i] = seg.x; py[i] = seg.y; pw[i] = seg.w;
      if (jit) { px[i] += Math.sin(time * 43 + i * 2.1 + s.id) * jit; py[i] += Math.cos(time * 37 + i * 1.7 + s.id) * jit; }
    }

    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : 0;
      const i1 = i < n - 1 ? i + 1 : n - 1;
      let tx = px[i1] - px[i0], ty = py[i1] - py[i0];
      const tl = Math.hypot(tx, ty) || 1;
      nx[i] = -ty / tl; ny[i] = tx / tl;
    }
  }

  /// Gradi Path2D ribbon: levo niz telo, desno nazad. scale množi poluširinu;
  /// lightShift pomera "centar" trake ka svetlu (fake 3D osvetljenje cevi).
  _ribbon(scale, lightShift) {
    const n = this._n;
    const px = this._px, py = this._py, nx = this._nx, ny = this._ny, pw = this._pw;
    const path = new Path2D();
    // leva ivica (normala +)
    for (let i = 0; i < n; i++) {
      let w = pw[i] * scale;
      if (lightShift) w = w + lightShift * pw[i] * (nx[i] * LIGHT.x + ny[i] * LIGHT.y) * 0.5;
      if (w < 0.4) w = 0.4; // sprecava self-intersection kod jakog shift-a
      const x = px[i] + nx[i] * w, y = py[i] + ny[i] * w;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    // desna ivica (normala −), nazad
    for (let i = n - 1; i >= 0; i--) {
      let w = pw[i] * scale;
      if (lightShift) w = w - lightShift * pw[i] * (nx[i] * LIGHT.x + ny[i] * LIGHT.y) * 0.5;
      if (w < 0.4) w = 0.4;
      const x = px[i] - nx[i] * w, y = py[i] - ny[i] * w;
      path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  _drawSnakes(ctx, v, time) {
    const world = this.world;
    // sortiraj po masi — male ispod, velike preko
    const list = world.snakes.slice().sort((a, b) => a.mass - b.mass);

    for (const s of list) {
      if (s.dead) continue;
      if (s.maxX < v.x0 - 60 || s.minX > v.x1 + 60 || s.maxY < v.y0 - 60 || s.minY > v.y1 + 60) continue;

      this._prepare(s, time);
      const hue = s.hue;
      const pulse = 0.7 + 0.3 * Math.sin(time * (2.6 + 6 * s.boostFactor) + s.id * 1.3);
      const boost = s.boostFactor;
      const invulnBlink = s.invuln > 0 ? (Math.sin(time * 16) > 0 ? 0.45 : 1) : 1;
      ctx.globalAlpha = invulnBlink;

      // 1) spoljašnji glow
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${(0.05 + 0.05 * pulse + 0.09 * boost) * invulnBlink})`;
      ctx.fill(this._ribbon(2.7, 0));
      // 2) unutrašnji glow
      ctx.fillStyle = `hsla(${hue}, 100%, 62%, ${(0.15 + 0.12 * boost) * pulse * invulnBlink})`;
      ctx.fill(this._ribbon(1.62, 0));

      // 3) telo — tamna satenska "cev"
      ctx.globalCompositeOperation = 'source-over';
      const body = this._ribbon(1.0, 0);
      ctx.fillStyle = `hsl(${hue}, 60%, ${s.slowT > 0 && Math.sin(time * 30) > 0 ? 26 : 30}%)`;
      ctx.fill(body);
      ctx.strokeStyle = `hsla(${hue}, 100%, 68%, ${0.85 * invulnBlink})`;
      ctx.lineWidth = 1.4;
      ctx.stroke(body);

      // "segmentni prstenovi" — tekstura tela
      ctx.strokeStyle = `hsla(${hue}, 90%, 55%, 0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const stepR = 3;
      for (let i = 2; i < this._n; i += stepR) {
        const w = this._pw[i] * 0.92;
        ctx.moveTo(this._px[i] + this._nx[i] * w, this._py[i] + this._ny[i] * w);
        ctx.lineTo(this._px[i] - this._nx[i] * w, this._py[i] - this._ny[i] * w);
      }
      ctx.stroke();

      // 4) neon kičma — svetla pruga ka izvoru svetla (fake 3D)
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `hsla(${hue}, 100%, 82%, ${(0.4 + 0.45 * pulse) * invulnBlink})`;
      ctx.fill(this._ribbon(0.38, 0.85));
      ctx.fillStyle = `hsla(${hue}, 100%, 95%, ${(0.35 + 0.4 * pulse + 0.25 * boost) * invulnBlink})`;
      ctx.fill(this._ribbon(0.15, 0.9));

      // glava
      this._drawHead(ctx, s, time);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  _drawHead(ctx, s, time) {
    const hue = s.hue;
    const r = s.headRadius;
    const sp = s.speed / BAL.baseSpeed;

    // SQUASH & STRETCH: izduženje pri ubrzanju, spljoštenje bočno (pseudo-očuvanje zapremine)
    const sx = clamp(1 + (sp - 1) * 0.22, 0.85, 1.4);
    const sy = clamp(1 / Math.sqrt(sx), 0.8, 1.15);

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.heading);
    ctx.scale(sx, sy);

    // lobanja
    ctx.beginPath();
    ctx.ellipse(r * 0.25, 0, r * 1.18, r * 0.98, 0, 0, TAU);
    ctx.fillStyle = `hsl(${hue}, 62%, 34%)`;
    ctx.fill();
    ctx.strokeStyle = `hsl(${hue}, 100%, 70%)`;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // vizor
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `hsla(${hue}, 100%, 80%, 0.9)`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(r * 0.1, 0, r * 0.72, -0.9, 0.9);
    ctx.stroke();

    // oči
    for (const side of [-1, 1]) {
      const ex = r * 0.55, ey = side * r * 0.5;
      ctx.fillStyle = `hsla(${hue}, 100%, 92%, 0.95)`;
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.24, 0, TAU); ctx.fill();
      ctx.fillStyle = '#04050d';
      ctx.beginPath(); ctx.arc(ex + r * 0.08, ey, r * 0.1, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // ------------------------------------------------------------- afterimages
  _drawGhosts(ctx, v) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const s of this.world.snakes) {
      for (const g of s.ghosts) {
        const a = g.t / g.ttl;
        ctx.strokeStyle = `hsla(${g.hue}, 100%, 70%, ${0.28 * a})`;
        ctx.lineWidth = g.w * 1.5;
        ctx.beginPath();
        for (let i = 0; i < g.n; i++) {
          if (i === 0) ctx.moveTo(g.xs[i], g.ys[i]);
          else ctx.lineTo(g.xs[i], g.ys[i]);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- magnet
  _drawMagnetRings(ctx, time) {
    for (const s of this.world.snakes) {
      if (s.dead || !s.magnetActive) continue;
      const hue = s.buffs.magnet > 0 ? 285 : s.hue;
      const rot = time * 1.6;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(rot);
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.5)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([26, 14]);
      ctx.beginPath(); ctx.arc(0, 0, BAL.magnetRadius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      // unutrašnji heksagon
      ctx.strokeStyle = `hsla(${hue}, 100%, 80%, 0.35)`;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 - rot * 0.6;
        const r = s.headRadius * 2.6;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  // --------------------------------------------------------------- čestice
  _drawParticles(ctx, v) {
    const ps = this.world.effects.particles;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x < v.x0 - 40 || p.x > v.x1 + 40 || p.y < v.y0 - 40 || p.y > v.y1 + 40) continue;
      const a = Math.pow(Math.max(0, p.life / p.ttl), 1.4);
      if (p.type === 'spark') {
        const g = this.glow(p.hue);
        const s = p.size * 5 * a + p.size;
        ctx.globalAlpha = a;
        ctx.drawImage(g, p.x - s, p.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
      } else if (p.type === 'shard') {
        // kristalisana svetlosna čestica: romb + glow
        const g = this.glow(p.hue);
        const s = p.size * 4 * a + 2;
        ctx.globalAlpha = a * 0.8;
        ctx.drawImage(g, p.x - s, p.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const z = p.size * a + 1;
        ctx.fillStyle = `hsla(${p.hue}, 100%, 75%, ${a})`;
        ctx.strokeStyle = `hsla(${p.hue}, 100%, 92%, ${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -z * 1.6); ctx.lineTo(z * 0.9, 0); ctx.lineTo(0, z * 1.6); ctx.lineTo(-z * 0.9, 0);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawShockwaves(ctx, v) {
    const ef = this.world.effects;
    ctx.globalCompositeOperation = 'lighter';
    for (const w of ef.shockwaves) {
      const t = w.t / w.dur;
      const r = w.rMax * ef.waveProgress(w);
      const a = (1 - t) * (1 - t);
      // glavni prsten
      ctx.strokeStyle = `hsla(${w.hue}, 100%, 75%, ${a * 0.9})`;
      ctx.lineWidth = 2 + 14 * (1 - t);
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TAU); ctx.stroke();
      // spoljašnji fade prsten
      ctx.strokeStyle = `hsla(${w.hue}, 100%, 60%, ${a * 0.35})`;
      ctx.lineWidth = 8 + 30 * (1 - t);
      ctx.beginPath(); ctx.arc(w.x, w.y, r * 0.92, 0, TAU); ctx.stroke();
      // bljesak u centru na početku
      if (t < 0.22) {
        const g = this.glow(w.hue);
        const s = w.rMax * 0.5 * (1 - t / 0.22);
        ctx.globalAlpha = 0.7 * (1 - t / 0.22);
        ctx.drawImage(g, w.x - s, w.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------- imena + tekst (screen)
  _drawOverlayText(ctx, cam, time) {
    const world = this.world;
    const tmp = this._tmp;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // imena zmija
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const s of world.snakes) {
      if (s.dead) continue;
      cam.worldToScreen(s.x, s.y, tmp);
      if (tmp.x < -80 || tmp.x > this.w + 80 || tmp.y < -80 || tmp.y > this.h + 80) continue;
      const r = s.headRadius * cam.zoom + 14;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillText(s.name, tmp.x + 1, tmp.y - r + 1);
      ctx.fillStyle = `hsl(${s.hue}, 90%, 78%)`;
      ctx.fillText(s.name, tmp.x, tmp.y - r);
    }

    // lebdeći tekstovi (+8, itd.)
    ctx.font = '700 13px ui-monospace, monospace';
    for (const t of world.effects.texts) {
      cam.worldToScreen(t.x, t.y, tmp);
      const a = 1 - t.t / t.ttl;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(t.str, tmp.x + 1, tmp.y + 1);
      ctx.fillStyle = `hsl(${t.hue}, 100%, 78%)`;
      ctx.fillText(t.str, tmp.x, tmp.y);
      ctx.globalAlpha = 1;
    }
  }
}
