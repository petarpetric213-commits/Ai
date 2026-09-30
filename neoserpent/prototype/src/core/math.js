// =============================================================================
// math.js — vektorska i numerička matematika (bez DOM zavisnosti)
// =============================================================================

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

/// Framerate-nezavisno eksponencijalno prilaženje (kritički prigušeno).
/// rate ~ "brzina reagovanja" u 1/s.
export function smoothDamp(cur, target, rate, dt) {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}

export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
export function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

/// Najkraća ugaona razlika (−π, π] — sigurna za steering.
export function angDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/// Ograničeno okretanje ka ciljnom uglu (max step u radijanima).
export function turnToward(cur, target, maxStep) {
  const d = angDiff(cur, target);
  return cur + clamp(d, -maxStep, maxStep);
}

export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

// -----------------------------------------------------------------------------
// Deterministički RNG (mulberry32) — isti seed = ista simulacija (bitno za testove
// i replikaciju na serveru).
// -----------------------------------------------------------------------------
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }

// -----------------------------------------------------------------------------
// Uniformni Catmull-Rom splajn (centrirani, tension = 0.5).
// Koristi se za uzorkovanje položaja segmenata duž putanje glave.
// -----------------------------------------------------------------------------
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}
