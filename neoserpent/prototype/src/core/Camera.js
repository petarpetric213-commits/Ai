// =============================================================================
// Camera.js — praćenje, zoom, screen shake, konverzije koordinata
// =============================================================================

import { clamp, smoothDamp } from './math.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.w = 1280; this.h = 720;
    this.shakeX = 0; this.shakeY = 0;
    this._vw = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  resize(w, h) { this.w = w; this.h = h; }

  /// Praćenje zmije sa "look-ahead" pomakom u smeru kretanja + zoom po masi.
  update(dt, snake, cinematic = false) {
    if (snake) {
      const la = 0.15; // gleda ~150ms unapred
      const tx = snake.x + Math.cos(snake.heading) * snake.speed * la;
      const ty = snake.y + Math.sin(snake.heading) * snake.speed * la;
      this.x = smoothDamp(this.x, tx, 6.5, dt);
      this.y = smoothDamp(this.y, ty, 6.5, dt);
      // Veće zmije se dalje odmiču (vidi više sveta): logaritamska kriva
      const zTarget = clamp(1.10 - 0.34 * Math.log10(Math.max(30, snake.mass) / 30), 0.45, 1.10);
      this.zoom = smoothDamp(this.zoom, cinematic ? zTarget * 0.92 : zTarget, 2.2, dt);
    } else {
      this.zoom = smoothDamp(this.zoom, 0.8, 1.5, dt);
    }
  }

  screenToWorld(sx, sy, out) {
    out.x = (sx - this.w / 2 - this.shakeX) / this.zoom + this.x;
    out.y = (sy - this.h / 2 - this.shakeY) / this.zoom + this.y;
    return out;
  }

  worldToScreen(wx, wy, out) {
    out.x = (wx - this.x) * this.zoom + this.w / 2 + this.shakeX;
    out.y = (wy - this.y) * this.zoom + this.h / 2 + this.shakeY;
    return out;
  }

  /// Vidljivi pravougaonik sveta (za culling).
  view() {
    const hw = this.w / 2 / this.zoom, hh = this.h / 2 / this.zoom;
    this._vw.x0 = this.x - hw; this._vw.y0 = this.y - hh;
    this._vw.x1 = this.x + hw; this._vw.y1 = this.y + hh;
    return this._vw;
  }

  apply(ctx) {
    ctx.translate(this.w / 2 + this.shakeX, this.h / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
