// =============================================================================
// Hud.js — HUD crtan preko canvasa: statistika, rang-lista, sposobnosti,
// kill feed, minimapa, FPS. (Meniji su DOM — vidi index.html)
// =============================================================================

import { TAU, clamp } from '../core/math.js';
import { BAL } from '../entities/Snake.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export class Hud {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.w = 0; this.h = 0;
    this._prevCd = { dash: 0, magnet: 0, emp: 0 };
    this._readyFlash = { dash: 0, magnet: 0, emp: 0 };
    this._p = { x: 0, y: 0 };
  }

  resize(w, h) { this.w = w; this.h = h; }

  render(game, cam, rdt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (game.state === 'menu') return;

    const player = game.player;
    this._panelStats(ctx, player, game);
    this._panelLeaderboard(ctx, player);
    this._abilities(ctx, player, rdt);
    this._killFeed(ctx);
    this._minimap(ctx, game, cam);
    this._buffs(ctx, player);

    // FPS
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(140, 170, 220, 0.55)';
    ctx.fillText(`${Math.round(game.fps)} FPS`, 12, this.h - 18);
  }

  _panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(6, 9, 20, 0.62)';
    ctx.strokeStyle = 'rgba(90, 140, 255, 0.25)';
    ctx.lineWidth = 1;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  _panelStats(ctx, p, game) {
    const x = 14, y = 14, w = 190, h = 92;
    this._panel(ctx, x, y, w, h);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 20px ${MONO}`;
    ctx.fillStyle = '#e8f4ff';
    ctx.fillText(`MASA ${p ? Math.floor(p.mass) : '—'}`, x + 14, y + 30);
    ctx.font = `500 12px ${MONO}`;
    ctx.fillStyle = 'rgba(150, 190, 255, 0.85)';
    ctx.fillText(`POENI  ${p ? Math.floor(p.score).toLocaleString('en-US') : 0}`, x + 14, y + 52);
    ctx.fillText(`UBISTVA ${p ? p.kills : 0}    DUŽINA ${p ? p.segs.length : 0}`, x + 14, y + 70);
    // boost indikator
    if (p) {
      const bw = w - 28;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 14, y + 78, bw, 4);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${0.4 + 0.6 * p.boostFactor})`;
      ctx.fillRect(x + 14, y + 78, bw * p.boostFactor, 4);
    }
  }

  _panelLeaderboard(ctx, player) {
    const leaders = this.world.leaders(7);
    const x = this.w - 224, y = 14, w = 210;
    const h = 34 + leaders.length * 19;
    this._panel(ctx, x, y, w, h);
    ctx.font = `700 11px ${MONO}`;
    ctx.fillStyle = 'rgba(150, 190, 255, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('RANG LISTA', x + 14, y + 20);
    let rank = 1;
    for (const s of leaders) {
      const isP = s === player;
      const yy = y + 38 + (rank - 1) * 19;
      ctx.font = `${isP ? '700' : '500'} 12px ${MONO}`;
      ctx.fillStyle = isP ? `hsl(${s.hue}, 100%, 75%)` : 'rgba(200, 215, 240, 0.75)';
      const label = `${rank}. ${s.name}`.slice(0, 16);
      ctx.fillText(label, x + 14, yy);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.floor(s.mass)}`, x + w - 12, yy);
      ctx.textAlign = 'left';
      rank++;
    }
  }

  _abilities(ctx, p, rdt) {
    if (!p) return;
    const slots = [
      { key: 'dash', label: 'SHIFT', name: 'DASH', hue: 45, cd: BAL.dashCd, t: p.dashCd, active: 0 },
      { key: 'magnet', label: 'E', name: 'MAGNET', hue: 285, cd: BAL.magnetCd, t: p.magnetCd, active: p.magnetT },
      { key: 'emp', label: 'Q', name: 'EMP', hue: 200, cd: BAL.empCd, t: p.empCd, active: 0 },
    ];
    const size = 52, gap = 14;
    const total = slots.length * size + (slots.length - 1) * gap;
    const x0 = this.w / 2 - total / 2;
    const y0 = this.h - size - 46;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const x = x0 + i * (size + gap);
      const cx = x + size / 2, cy = y0 + size / 2;

      // "ready" flash
      if (this._prevCd[s.key] > 0 && s.t <= 0) this._readyFlash[s.key] = 0.5;
      this._prevCd[s.key] = s.t;
      this._readyFlash[s.key] = Math.max(0, this._readyFlash[s.key] - rdt);
      const flash = this._readyFlash[s.key];

      ctx.save();
      // okvir
      ctx.beginPath(); ctx.arc(cx, cy, size / 2 - 2, 0, TAU);
      ctx.fillStyle = 'rgba(6, 9, 20, 0.66)';
      ctx.fill();
      ctx.strokeStyle = s.t <= 0 ? `hsla(${s.hue}, 100%, 70%, ${0.8 + 0.2 * Math.sin(performance.now() / 200)})` : 'rgba(120, 150, 210, 0.35)';
      ctx.lineWidth = flash > 0 ? 2.5 : 1.4;
      ctx.stroke();
      if (flash > 0) {
        ctx.strokeStyle = `hsla(${s.hue}, 100%, 75%, ${flash})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, size / 2 + 3 + (0.5 - flash) * 10, 0, TAU); ctx.stroke();
      }

      // cooldown "torta"
      if (s.t > 0) {
        const frac = clamp(s.t / s.cd, 0, 1);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, size / 2 - 2, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - frac), false);
        ctx.closePath();
        ctx.fillStyle = 'rgba(3, 5, 12, 0.75)';
        ctx.fill();
        ctx.fillStyle = 'rgba(220, 235, 255, 0.9)';
        ctx.font = `700 15px ${MONO}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.ceil(s.t), cx, cy);
      } else {
        // aktivan tajmer (magnet)
        if (s.active > 0) {
          ctx.strokeStyle = `hsla(${s.hue}, 100%, 75%, 0.9)`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, size / 2 - 4, -Math.PI / 2, -Math.PI / 2 + TAU * (s.active / BAL.magnetTime));
          ctx.stroke();
        }
        // ikona
        this._icon(ctx, s.key, cx, cy, s.hue);
      }
      ctx.restore();

      // labela tastera
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = s.t <= 0 ? `hsla(${s.hue}, 90%, 78%, 0.95)` : 'rgba(140, 160, 200, 0.6)';
      ctx.fillText(s.label, cx, y0 + size + 5);
    }

    // hint za boost
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = 'rgba(140, 170, 220, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('LEVI KLIK / SPACE — BOOST (troši masu)', this.w / 2, this.h - 14);
  }

  _icon(ctx, kind, cx, cy, hue) {
    ctx.strokeStyle = `hsl(${hue}, 100%, 78%)`;
    ctx.fillStyle = `hsl(${hue}, 100%, 78%)`;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'dash') {
      // dvostruka strelica »
      ctx.moveTo(cx - 9, cy - 8); ctx.lineTo(cx - 1, cy); ctx.lineTo(cx - 9, cy + 8);
      ctx.moveTo(cx + 1, cy - 8); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx + 1, cy + 8);
      ctx.stroke();
    } else if (kind === 'magnet') {
      // potkova
      ctx.arc(cx, cy + 3, 7, Math.PI, 0);
      ctx.moveTo(cx - 7, cy + 3); ctx.lineTo(cx - 7, cy + 9);
      ctx.moveTo(cx + 7, cy + 3); ctx.lineTo(cx + 7, cy + 9);
      ctx.stroke();
    } else {
      // EMP — koncentrični lukovi
      ctx.arc(cx, cy, 3, 0, TAU);
      ctx.moveTo(cx - 4, cy - 6);
      ctx.arc(cx, cy, 7.5, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.moveTo(cx + 4, cy - 6);
      ctx.arc(cx, cy, 7.5, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
    }
  }

  _buffs(ctx, p) {
    if (!p) return;
    const act = [];
    if (p.buffs.speed > 0) act.push({ name: 'BRZINA', t: p.buffs.speed, hue: 45 });
    if (p.buffs.magnet > 0) act.push({ name: 'MAGNET', t: p.buffs.magnet, hue: 285 });
    if (p.buffs.double > 0) act.push({ name: '×2 POENI', t: p.buffs.double, hue: 96 });
    if (!act.length) return;
    ctx.font = `700 11px ${MONO}`;
    ctx.textAlign = 'center';
    const y = this.h - 130;
    act.forEach((b, i) => {
      const x = this.w / 2 + (i - (act.length - 1) / 2) * 100;
      const w = 88;
      ctx.fillStyle = 'rgba(6, 9, 20, 0.7)';
      ctx.strokeStyle = `hsla(${b.hue}, 100%, 70%, 0.6)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x - w / 2, y - 10, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `hsl(${b.hue}, 100%, 78%)`;
      ctx.fillText(`${b.name} ${Math.ceil(b.t)}s`, x, y + 4);
    });
  }

  _killFeed(ctx) {
    const feed = this.world.killFeed;
    ctx.font = `600 12px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let y = 26;
    for (const k of feed) {
      const a = k.t > 4 ? 1 - (k.t - 4) : 1;
      ctx.globalAlpha = a * 0.95;
      const txt = `${k.killer}  ⚡  ${k.victim}`;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(txt, this.w / 2 + 1, y + 1);
      ctx.fillStyle = `hsl(${k.hueK}, 90%, 75%)`;
      ctx.fillText(txt, this.w / 2, y);
      ctx.globalAlpha = 1;
      y += 19;
    }
  }

  _minimap(ctx, game, cam) {
    const size = 150;
    const x = this.w - size - 18, y = this.h - size - 18;
    const cx = x + size / 2, cy = y + size / 2;
    const scale = (size / 2 - 4) / this.world.R;

    ctx.save();
    ctx.globalAlpha = 0.92;
    // podloga
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, TAU);
    ctx.fillStyle = 'rgba(6, 9, 20, 0.66)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 140, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // granica
    ctx.beginPath(); ctx.arc(cx, cy, size / 2 - 4, 0, TAU);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
    ctx.stroke();

    // hrana (mega + power)
    for (const f of this.world.foods) {
      if (f.type !== 'mega' && f.type !== 'power') continue;
      ctx.fillStyle = f.type === 'mega' ? 'rgba(120, 230, 255, 0.6)' : `hsla(${f.hue}, 100%, 70%, 0.7)`;
      ctx.fillRect(cx + f.x * scale - 1, cy + f.y * scale - 1, 2, 2);
    }

    // zmije
    for (const s of this.world.snakes) {
      if (s.dead) continue;
      const isP = s === game.player;
      ctx.fillStyle = isP ? '#ffffff' : `hsl(${s.hue}, 90%, 65%)`;
      const r = isP ? 3 : clamp(1.5 + s.mass / 400, 1.5, 3.5);
      ctx.beginPath(); ctx.arc(cx + s.x * scale, cy + s.y * scale, r, 0, TAU); ctx.fill();
    }

    // vidno polje
    const v = cam.view();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + v.x0 * scale, cy + v.y0 * scale, (v.x1 - v.x0) * scale, (v.y1 - v.y0) * scale);
    ctx.restore();
  }
}
