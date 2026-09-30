// =============================================================================
// Background.js — parallax zvezdana polja, nebula, REAKTIVNA MREŽA, granica
//
// Reaktivna mreža: svaki vrh mreže se pomera odbijanjem od uzoraka tela velikih
// zmija (influence samples) — mreža "talasa" kada zmija prođe. U WebGL verziji
// ovo postaje vertex shader displacement (vidi docs/02-ARHITEKTURA.md).
// =============================================================================

import { TAU, clamp } from '../core/math.js';

const GRID = 118;          // razmak mreže (svetske jedinice)
const CELL = 512;          // veličina tile za zvezde

export class Background {
  constructor(rng) {
    this.rng = rng;
    this.layers = [];      // {pattern, factor, alpha}
    this.motes = [];       // lebdeće čestice prašine (world space)
    this._inf = [];        // influence uzorci velikih zmija
    this._w = 0; this._h = 0;
  }

  resize(w, h) {
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this.layers = [
      { pattern: this._makeStarTile(90, 0.5, 1.0), factor: 0.12, alpha: 0.5 },
      { pattern: this._makeStarTile(55, 0.9, 1.4), factor: 0.3, alpha: 0.6 },
      { pattern: this._makeStarTile(30, 1.4, 2.0), factor: 0.55, alpha: 0.75 },
    ];
    this.motes.length = 0;
    for (let i = 0; i < 90; i++) this.motes.push(this._makeMote());
  }

  _makeStarTile(count, rMin, rMax) {
    const c = document.createElement('canvas');
    c.width = c.height = CELL;
    const g = c.getContext('2d');
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const x = rng() * CELL, y = rng() * CELL;
      const r = rMin + rng() * (rMax - rMin) * 0.4;
      const hue = [190, 220, 265, 320][(rng() * 4) | 0];
      g.fillStyle = `hsla(${hue}, 80%, ${70 + rng() * 25}%, ${0.25 + rng() * 0.5})`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    return g.createPattern(c, 'repeat');
  }

  _makeMote() {
    const rng = this.rng;
    return {
      x: (rng() - 0.5) * 2600, y: (rng() - 0.5) * 1600,
      r: 0.8 + rng() * 2.4,
      a: 0.1 + rng() * 0.3,
      vx: (rng() - 0.5) * 14, vy: (rng() - 0.5) * 14,
      ph: rng() * TAU,
    };
  }

  render(ctx, cam, world, time) {
    const w = this._w, h = this._h;

    // --- baza: duboki svemirski gradijent ---
    ctx.fillStyle = '#04050d';
    ctx.fillRect(0, 0, w, h);

    // --- nebula oblaci (spori, skriveni iza svega) ---
    this._nebula(ctx, w, h, time);

    // --- parallax zvezde (screen-space offset = kamera × factor) ---
    for (const L of this.layers) {
      ctx.save();
      ctx.globalAlpha = L.alpha;
      const ox = (-cam.x * L.factor + time * 3) % CELL;
      const oy = (-cam.y * L.factor + time * 1.4) % CELL;
      ctx.translate(ox - CELL, oy - CELL);
      ctx.fillStyle = L.pattern;
      ctx.fillRect(0, 0, w + CELL * 2, h + CELL * 2);
      ctx.restore();
    }

    // --- svetski sloj ---
    ctx.save();
    cam.apply(ctx);

    // reaktivna mreža
    this._grid(ctx, cam, world);

    // lebdeća prašina (blizu kamere, world space)
    this._motes(ctx, cam, time);

    // granica arene
    this._border(ctx, world, time);

    ctx.restore();
  }

  _nebula(ctx, w, h, time) {
    const blobs = [
      { x: w * (0.25 + 0.05 * Math.sin(time * 0.05)), y: h * (0.3 + 0.04 * Math.cos(time * 0.04)), r: w * 0.45, hue: 265, a: 0.05 },
      { x: w * (0.75 + 0.04 * Math.cos(time * 0.06)), y: h * (0.7 + 0.05 * Math.sin(time * 0.05)), r: w * 0.5, hue: 190, a: 0.045 },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 80%, 55%, ${b.a})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /// Mreža koja se pomera oko velikih zmija.
  /// Pomeraj vrhova se kešira jednom po frejmu (računa se za sve vrhove u
  /// vidnom polju jednim prolazom), pa se iz keša crtaju minor/major linije.
  _grid(ctx, cam, world) {
    const v = cam.view();
    const ix0 = Math.floor(v.x0 / GRID), ix1 = Math.ceil(v.x1 / GRID);
    const iy0 = Math.floor(v.y0 / GRID), iy1 = Math.ceil(v.y1 / GRID);
    const cols = ix1 - ix0 + 1, rows = iy1 - iy0 + 1;
    if (cols * rows > 6000) return; // sigurnosni limit (ekstremni zoom-out)

    // skupi influence uzorke velikih zmija — SAMO unutar vidnog polja
    const inf = this._inf;
    inf.length = 0;
    const M = 170, M2 = M * M;
    for (const s of world.snakes) {
      if (s.dead || s.mass < 70) continue;
      if (s.maxX < v.x0 - M || s.minX > v.x1 + M || s.maxY < v.y0 - M || s.minY > v.y1 + M) continue;
      const segs = s.segs;
      for (let i = 0; i < segs.length; i += 6) {
        const seg = segs[i];
        if (seg.x < v.x0 - M || seg.x > v.x1 + M || seg.y < v.y0 - M || seg.y > v.y1 + M) continue;
        inf.push(seg);
        if (inf.length > 260) break;
      }
    }

    // izračunaj pomeraj svakog vrha jednom → keš (2 floata po vrhu)
    const n = cols * rows;
    const disp = this._disp && this._disp.length >= n * 2 ? this._disp : (this._disp = new Float32Array(n * 2));
    const hasInf = inf.length > 0;
    for (let gy = 0; gy < rows; gy++) {
      const wy = (iy0 + gy) * GRID;
      for (let gx = 0; gx < cols; gx++) {
        const wx = (ix0 + gx) * GRID;
        const k = (gy * cols + gx) * 2;
        if (!hasInf) { disp[k] = wx; disp[k + 1] = wy; continue; }
        let px = 0, py = 0;
        for (let i = 0; i < inf.length; i++) {
          const s = inf[i];
          const ddx = wx - s.x, ddy = wy - s.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < M2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = 1 - d / M;
            const push = f * f * 26 * clamp(s.w / 18, 0.7, 2);
            px += (ddx / d) * push;
            py += (ddy / d) * push;
          }
        }
        disp[k] = wx + px;
        disp[k + 1] = wy + py;
      }
    }

    ctx.lineWidth = 1 / cam.zoom;

    // crtanje linija iz keša; major linije su svaki 4. red/kolona
    for (let pass = 0; pass < 2; pass++) {
      const major = pass === 1;
      ctx.strokeStyle = major ? 'rgba(96, 140, 255, 0.10)' : 'rgba(80, 120, 255, 0.05)';
      ctx.beginPath();
      // vertikale
      for (let gx = 0; gx < cols; gx++) {
        const isMajor = ((ix0 + gx) % 4 + 4) % 4 === 0;
        if (isMajor !== major) continue;
        for (let gy = 0; gy < rows; gy++) {
          const k = (gy * cols + gx) * 2;
          if (gy === 0) ctx.moveTo(disp[k], disp[k + 1]);
          else ctx.lineTo(disp[k], disp[k + 1]);
        }
      }
      // horizontale
      for (let gy = 0; gy < rows; gy++) {
        const isMajor = ((iy0 + gy) % 4 + 4) % 4 === 0;
        if (isMajor !== major) continue;
        for (let gx = 0; gx < cols; gx++) {
          const k = (gy * cols + gx) * 2;
          if (gx === 0) ctx.moveTo(disp[k], disp[k + 1]);
          else ctx.lineTo(disp[k], disp[k + 1]);
        }
      }
      ctx.stroke();
    }
  }

  _motes(ctx, cam, time) {
    const v = cam.view();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(150, 200, 255, 1)';
    for (const m of this.motes) {
      // drift + respawn kad izađe iz vidnog polja
      m.x += m.vx * 0.016; m.y += m.vy * 0.016;
      if (m.x < v.x0 - 100) m.x = v.x1 + 90; else if (m.x > v.x1 + 100) m.x = v.x0 - 90;
      if (m.y < v.y0 - 100) m.y = v.y1 + 90; else if (m.y > v.y1 + 100) m.y = v.y0 - 90;
      const a = m.a * (0.6 + 0.4 * Math.sin(time * 1.5 + m.ph));
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _border(ctx, world, time) {
    const R = world.R;
    // zatamnjenje van arene
    ctx.save();
    ctx.beginPath();
    ctx.rect(-99999, -99999, 199998, 199998);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.fillStyle = 'rgba(2, 3, 10, 0.75)';
    ctx.fill('evenodd');
    ctx.restore();

    // spoljašnji sjaj
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, R + i * 7, 0, TAU);
      ctx.strokeStyle = `hsla(190, 100%, 60%, ${0.22 - i * 0.06})`;
      ctx.lineWidth = 5 - i * 1.5;
      ctx.stroke();
    }
    // rotirajući dashed prsten
    ctx.save();
    ctx.rotate(time * 0.12);
    ctx.setLineDash([46, 26]);
    ctx.lineDashOffset = -time * 60;
    ctx.beginPath();
    ctx.arc(0, 0, R - 12, 0, TAU);
    ctx.strokeStyle = 'hsla(320, 100%, 65%, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }
}
