// =============================================================================
// Controllers.js — apstrakcija ulaza: isti Snake, različiti "mozgovi"
//
//   LocalController — igrač (miš/dodir/tastatura)
//   BotController   — AI sa mašinom stanja: WANDER → FEED → HUNT → FLEE
//
// Ova abstrakcija je KLJUČNA za mrežu: na serveru isti BotController pokreće
// botove, a LocalController se zamenjuje NetController-om (ulaz sa klijenta).
// =============================================================================

import { dist2, randRange } from '../core/math.js';

export class LocalController {
  constructor(input) {
    this.input = input; // core/Input.js
  }

  update(dt, time, snake, world) {
    const inp = snake.input;
    const i = this.input;
    inp.tx = i.wx; inp.ty = i.wy;
    inp.boost = i.boost || i.boostTouch;
    if (i.consumeDash()) inp.dash = true;
    if (i.consumeMagnet()) inp.magnet = true;
    if (i.consumeEmp()) inp.emp = true;
  }
}

const PROBE_DISTS = [60, 130, 210];

export class BotController {
  constructor(rng, personality = {}) {
    this.rng = rng;
    this.aggression = personality.aggression ?? 0.5;
    this.skill = personality.skill ?? 0.6;
    this.think = rng() * 0.3;
    this.mode = 'feed';
    this.target = { x: 0, y: 0 };
    this.food = null;
    this.prey = null;
    this.fleeT = 0;
    this.nearFoodCount = 0;
    this._hits = [];
  }

  update(dt, time, s, world) {
    this.think -= dt;
    if (this.fleeT > 0) this.fleeT -= dt;
    if (this.think <= 0) {
      this.think = 0.14 + (1 - this.skill) * 0.22 + this.rng() * 0.08;
      this.decide(s, world);
    }

    const inp = s.input;
    inp.tx = this.target.x;
    inp.ty = this.target.y;

    // boost odluke svaki frejm (mode je postavio decide())
    const d2t = dist2(s.x, s.y, this.target.x, this.target.y);
    const wantBoost =
      (this.mode === 'flee' && s.mass > 22) ||
      (this.mode === 'hunt' && s.mass > 45 && this.rng() < 0.9) ||
      (this.mode === 'feed' && d2t > 620 * 620 && s.mass > 70);
    inp.boost = wantBoost && s.dashCd < 4.0; // čuva masu kada dash treba za bekstvo
  }

  decide(s, world) {
    const rng = this.rng;

    // ---- 1) GRANICA (najveći prioritet) ----
    const dc = Math.hypot(s.x, s.y);
    if (dc > world.R - 340) {
      this.mode = 'flee';
      this.fleeT = 0.5;
      const a = Math.atan2(s.y, s.x); // pravac ka centru
      this.target.x = s.x - Math.cos(a) * 800;
      this.target.y = s.y - Math.sin(a) * 800;
      return;
    }

    // ---- 2) PRETNJA: probe tačke ispred glave ----
    const threat = this.probeThreat(s, world);
    if (threat) {
      this.mode = 'flee';
      this.fleeT = 0.6;
      this.target.x = threat.ex;
      this.target.y = threat.ey;
      if (threat.close && s.dashCd <= 0 && s.mass > 18) s.input.dash = true;
      return;
    }
    if (this.fleeT > 0) this.mode = 'feed';

    // ---- 3) HUNT (agresivni botovi seku manje zmije) ----
    if (this.prey && (this.prey.dead || dist2(s.x, s.y, this.prey.x, this.prey.y) > 800 * 800)) this.prey = null;
    if (!this.prey && rng() < this.aggression * 0.5) {
      let best = null, bestD = 520 * 520;
      for (const o of world.snakes) {
        if (o === s || o.dead || o.invuln > 0) continue;
        if (o.mass > s.mass * 0.72) continue;
        const d2 = dist2(s.x, s.y, o.x, o.y);
        if (d2 < bestD) { bestD = d2; best = o; }
      }
      this.prey = best;
    }
    if (this.prey) {
      this.mode = 'hunt';
      // presretanje: pozicija + brzina žrtve × faktor
      const lead = 0.45 + this.skill * 0.35;
      this.target.x = this.prey.x + Math.cos(this.prey.heading) * this.prey.speed * lead;
      this.target.y = this.prey.y + Math.sin(this.prey.heading) * this.prey.speed * lead;
      this.useAbilities(s, world);
      return;
    }

    // ---- 4) FEED ----
    this.mode = 'feed';
    if (!this.food || this.food.dead || dist2(s.x, s.y, this.food.x, this.food.y) > 900 * 900) {
      this.food = this.findFood(s, world);
    }
    if (this.food) {
      this.target.x = this.food.x;
      this.target.y = this.food.y;
    } else {
      const p = world.randomPoint(0.7);
      this.target.x = p.x; this.target.y = p.y;
    }
    this.useAbilities(s, world);
  }

  probeThreat(s, world) {
    const cos = Math.cos(s.heading), sin = Math.sin(s.heading);
    for (const d of PROBE_DISTS) {
      const px = s.x + cos * d, py = s.y + sin * d;
      if (Math.hypot(px, py) > world.R - 140) {
        return { ex: -px * 2, ey: -py * 2, close: d < 100 }; // beži ka centru
      }
      world.segHash.query(px, py, s.headRadius + 52, this._hits);
      for (const seg of this._hits) {
        if (seg.sid === s.id) continue;
        // bekstvo: normala od pretnje, sa izborom strane
        const dx = px - seg.x, dy = py - seg.y;
        const dl = Math.hypot(dx, dy) || 1;
        const cross = cos * (dy / dl) - sin * (dx / dl); // sa koje strane je pretnja
        const side = cross > 0 ? -1 : 1;
        const ex = s.x + (-sin * side) * 420 - cos * 120;
        const ey = s.y + (cos * side) * 420 - sin * 120;
        return { ex, ey, close: d < 95 };
      }
    }
    return null;
  }

  findFood(s, world) {
    let best = null, bestScore = -1;
    const foods = world.foods;
    const stride = Math.max(1, Math.floor(foods.length / 180));
    let nearCount = 0;
    for (let i = 0; i < foods.length; i += stride) {
      const f = foods[i];
      if (f.dead || f.type === 'power') continue;
      const d2v = dist2(s.x, s.y, f.x, f.y);
      if (d2v < 320 * 320) nearCount++;
      const score = f.value * f.value / (140 + Math.sqrt(d2v));
      if (score > bestScore) { bestScore = score; best = f; }
    }
    this.nearFoodCount = nearCount;
    return best;
  }

  useAbilities(s, world) {
    // magnet kad ima dosta hrane u okruženju
    if (this.nearFoodCount > 4 && s.magnetCd <= 0 && this.mode === 'feed') {
      s.input.magnet = true;
    }
    // EMP kad je neprijateljska glava blizu i opasna
    if (s.empCd <= 0) {
      for (const o of world.snakes) {
        if (o === s || o.dead) continue;
        const d2v = dist2(s.x, s.y, o.x, o.y);
        if (d2v < 260 * 260 && (o.boostFactor > 0.5 || o.mass > s.mass * 0.8)) {
          s.input.emp = true;
          break;
        }
      }
    }
  }
}


