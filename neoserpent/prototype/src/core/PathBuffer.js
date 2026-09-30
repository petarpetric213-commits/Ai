// =============================================================================
// PathBuffer.js — ring-buffer istorije putanje glave (SRCE glatkog kretanja)
//
// Princip ("path following" / slither.io tehnika):
//   1. Glava se slobodno kreće (steering + integracija).
//   2. Iza glave ostaje PUTANJA — uzorkovana na fiksnom razmaku `spacing`
//      (tačke se dodaju samo kada glava pređe `spacing` piksela).
//   3. Segment i tela se uzorkuje na lukovoj dužini  s_i = (i+1)·segSpacing
//      od glave, interpolacijom kroz tačke putanje (Catmull-Rom).
//
// Posledice:
//   • Telu je NEMOGUĆE da se razdvoji ili "skupi" — uvek tačno prati putanju.
//   • Nema akumulacije greške (za razliku od lanca opruga).
//   • O(1) amortizovano po frejmu; Float32Array => nula alokacija, nula GC-ja.
//   • MREŽA: dovoljno je poslati (x, y, ugao, brzinu, masu) po zmiji —
//     klijent rekonstruiše CELO telo deterministički iz iste putanje.
// =============================================================================

export class PathBuffer {
  constructor(spacing, capacity = 2600) {
    this.spacing = spacing;
    this.cap = capacity;
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.head = -1;  // indeks najnovije tačke
    this.count = 0;  // broj validnih tačaka
  }

  /// Reset na jednu tačku (npr. pri spawn-u).
  clear(x, y) {
    this.head = 0;
    this.count = 1;
    this.xs[0] = x;
    this.ys[0] = y;
  }

  /// Dodaje NOVU najnoviju tačku (poziva se u smeru kretanja!).
  push(x, y) {
    this.head = (this.head + 1) % this.cap;
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    if (this.count < this.cap) this.count++;
  }

  /// Indeks u prstenu za i-tu tačku iza glave (0 = najnovija).
  _idx(i) {
    let k = this.head - i;
    if (k < 0) k += this.cap;
    return k;
  }

  x(i) { return this.xs[this._idx(i)]; }
  y(i) { return this.ys[this._idx(i)]; }

  /// Uzorkuje tačku na lukovoj dužini `s` od TRENUTNE pozicije glave (hx, hy).
  /// Radi u tri režima:
  ///   s <= d0  : linearna interpolacija glava → najnovija tačka putanje
  ///   inače     : Catmull-Rom kroz tačke putanje (indeks = (s − d0)/spacing)
  ///   van kraja : klemp na poslednju tačku (rep dok putanja ne izraste)
  sample(s, hx, hy, out) {
    if (this.count === 0) { out.x = hx; out.y = hy; return; }

    const p0x = this.x(0), p0y = this.y(0);
    const dx = hx - p0x, dy = hy - p0y;
    const d0 = Math.hypot(dx, dy);

    if (s <= d0) {
      // ispred najnovije tačke → lerp od glave ka njoj
      const t = d0 > 1e-9 ? clamp01(s / d0) : 0;
      out.x = hx - dx * t;
      out.y = hy - dy * t;
      return;
    }

    const u = (s - d0) / this.spacing;
    let i = Math.floor(u);
    const t = u - i;

    if (i >= this.count - 1) { // van istorije → poslednja tačka
      const last = this.count - 1;
      out.x = this.x(last);
      out.y = this.y(last);
      return;
    }

    // Catmull-Rom sa klempovanim krajevima (i-1 može biti -1 → koristi i)
    const i0 = i > 0 ? i - 1 : 0;
    const i3 = Math.min(this.count - 1, i + 2);
    const x0 = this.x(i0), x1 = this.x(i), x2 = this.x(i + 1), x3 = this.x(i3);
    const y0 = this.y(i0), y1 = this.y(i), y2 = this.y(i + 1), y3 = this.y(i3);

    const t2 = t * t, t3 = t2 * t;
    out.x = 0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
    out.y = 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
