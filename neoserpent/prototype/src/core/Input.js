// =============================================================================
// Input.js — miš, tastatura, dodir; pointer-events (ujedinjeno)
// =============================================================================

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.sx = innerWidth / 2; this.sy = innerHeight / 2; // ekran
    this.wx = 0; this.wy = 0;                             // svet (računa se svaki frejm)
    this.boost = false;
    this.boostTouch = false;
    this._dash = false; this._magnet = false; this._emp = false;

    addEventListener('pointermove', (e) => { this.sx = e.clientX; this.sy = e.clientY; }, { passive: true });
    addEventListener('pointerdown', (e) => {
      this.sx = e.clientX; this.sy = e.clientY;
      if (e.pointerType !== 'touch' && e.button === 0) this.boost = true;
    });
    addEventListener('pointerup', (e) => { if (e.button === 0) this.boost = false; });
    addEventListener('blur', () => { this.boost = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      // ne diraj igru dok korisnik kuca u polju imena
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.repeat) return;
      switch (e.code) {
        case 'Space': this.boost = true; e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': this._dash = true; break;
        case 'KeyE': this._magnet = true; break;
        case 'KeyQ': this._emp = true; break;
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.boost = false;
    });
  }

  /// Konverzija ekrana u svet — poziva se jednom po frejmu iz Game loope.
  update(camera, tmp) {
    camera.screenToWorld(this.sx, this.sy, tmp);
    this.wx = tmp.x; this.wy = tmp.y;
  }

  consumeDash() { const v = this._dash; this._dash = false; return v; }
  consumeMagnet() { const v = this._magnet; this._magnet = false; return v; }
  consumeEmp() { const v = this._emp; this._emp = false; return v; }
}
