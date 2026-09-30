// =============================================================================
// World.js — arena: zmije, hrana, sudari, smrt, respavn, prostorni heševi
//
// Redosled update-a (bitan za determinizam):
//   1. kontroleri (AI/igrač popunjavaju snake.input)
//   2. zmije (kretanje + segmenti)
//   3. rebuild segHash
//   4. hrana (bega/lutanje/magnet iz prošlog frejma)
//   5. rebuild foodHash
//   6. eat-pass + magnet sken (postavlja pull za sledeći frejm)
//   7. collision-pass → smrti
//   8. respavn + održavanje hrane
// =============================================================================

import { makeRng, dist2, TAU } from '../core/math.js';
import { SpatialHash } from '../core/SpatialHash.js';
import { Snake, BAL } from '../entities/Snake.js';
import { Food, FOOD } from '../entities/Food.js';
import { BotController } from '../entities/Controllers.js';

export const BOT_NAMES = [
  'NYX-7', 'V0LT', 'GL1TCH', 'KRAIT', 'SABLE', 'HEX', 'OMEN', 'RAZOR',
  'ZENITH', 'WRAITH', 'VECTOR', 'PRISM', 'ECHO', 'NOVA', 'CIPHER', 'JOLT',
  'PHANTOM', 'QUASAR', 'DRIFT', 'SPECTRE', 'IONA', 'MIRAGE',
];
export const HUES = [174, 320, 96, 38, 262, 14, 190, 210, 288, 55, 335, 150];

export class World {
  constructor(opts = {}) {
    this.R = opts.radius ?? 3800;
    this.effects = opts.effects;
    this.rng = opts.rng ?? makeRng((Math.random() * 1e9) | 0);
    this.hooks = opts.hooks || {}; // { eat, death, dash, magnet, emp, boostDrop }
    this.snakes = [];
    this.foods = [];
    this.segHash = new SpatialHash(110);
    this.foodHash = new SpatialHash(96);
    this.killFeed = [];             // { killer, victim, hueK, hueV, t }
    this.pendingSpawns = [];        // { at, isBot }
    this.viewer = { x: 0, y: 0 };   // pozicija kamere (za jačinu shake-a)
    this.time = 0;
    this._hits = [];
    this._hits2 = [];
    this._usedNames = new Set();
    this._powerTimer = 4;
    this._foodCounts = { pellet: 0, mega: 0, power: 0 };

    const bots = opts.botCount ?? 11;
    for (let i = 0; i < bots; i++) this.spawnBot();
    for (let i = 0; i < FOOD.pelletTarget; i++) {
      const p = this.randomPoint(0.96);
      this.foods.push(new Food('pellet', p.x, p.y, { hue: this.randomFoodHue() }));
    }
    for (let i = 0; i < FOOD.megaTarget; i++) {
      const p = this.randomPoint(0.9);
      this.foods.push(new Food('mega', p.x, p.y, { hue: 185 }));
    }
  }

  // ------------------------------------------------------------------ spawn
  randomPoint(f = 1) {
    const rng = this.rng;
    const r = this.R * f * Math.sqrt(rng());
    const a = rng() * TAU;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  randomFoodHue() {
    const h = [45, 55, 165, 190, 320, 265];
    return h[(this.rng() * h.length) | 0];
  }

  safeSpawnPos(out) {
    for (let i = 0; i < 24; i++) {
      const p = this.randomPoint(0.72);
      let ok = true;
      for (const s of this.snakes) {
        if (s.dead) continue;
        if (dist2(p.x, p.y, s.x, s.y) < 560 * 560) { ok = false; break; }
      }
      if (ok) { out.x = p.x; out.y = p.y; return out; }
    }
    out.x = 0; out.y = 0;
    return out;
  }

  spawnBot() {
    const rng = this.rng;
    let name = BOT_NAMES[(rng() * BOT_NAMES.length) | 0];
    let guard = 0;
    while (this._usedNames.has(name) && guard++ < 40) name = BOT_NAMES[(rng() * BOT_NAMES.length) | 0] + '-' + ((rng() * 90 + 10) | 0);
    this._usedNames.add(name);
    const p = this.safeSpawnPos({ x: 0, y: 0 });
    const bot = new Snake(this, {
      name, isBot: true,
      hue: HUES[(rng() * HUES.length) | 0],
      x: p.x, y: p.y,
      heading: rng() * TAU,
      mass: 20 + rng() * 90,
    });
    bot.controller = new BotController(rng, {
      aggression: 0.15 + rng() * 0.8,
      skill: 0.35 + rng() * 0.65,
    });
    this.snakes.push(bot);
    return bot;
  }

  addPlayerSnake(name, hue) {
    const p = this.safeSpawnPos({ x: 0, y: 0 });
    const s = new Snake(this, { name, hue, x: p.x, y: p.y, mass: 30 });
    this.snakes.push(s);
    return s;
  }

  // ----------------------------------------------------------------- update
  update(dt) {
    this.time += dt;

    // 1) kontroleri
    for (const s of this.snakes) {
      if (!s.dead && s.controller) s.controller.update(dt, this.time, s, this);
    }

    // 2) zmije
    for (const s of this.snakes) s.update(dt, this.time);

    // 3) heš segmenata (za sudare glave ↔ tuđe telo)
    this.segHash.clear();
    for (const s of this.snakes) {
      if (s.dead) continue;
      const segs = s.segs;
      for (let i = 0; i < segs.length; i += 2) { // stride 2: preklapanje garantuje pokrivenost
        const seg = segs[i];
        seg.sid = s.id;
        this.segHash.insert(seg.x, seg.y, seg.r, seg);
      }
    }

    // 4) hrana
    for (const f of this.foods) f.update(dt, this.time, this);

    // kompakcija (bez filter() alokacija)
    let w = 0;
    for (let i = 0; i < this.foods.length; i++) {
      const f = this.foods[i];
      if (!f.dead) this.foods[w++] = f;
    }
    this.foods.length = w;

    // 5) heš hrane
    this.foodHash.clear();
    for (const f of this.foods) this.foodHash.insert(f.x, f.y, f.r, f);

    // 6) eat-pass + magnet sken
    this.eatPass();

    // 7) sudari
    this.collisionPass();

    // uklanjanje mrtvih (smrt obrađena u processDeath)
    w = 0;
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.dead) this.snakes[w++] = s;
    }
    this.snakes.length = w;

    // kill feed starenje (realno vreme skalirano)
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t += dt;
      if (this.killFeed[i].t > 5) this.killFeed.splice(i, 1);
    }

    // 8) respavn + hrana
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      if (this.time >= this.pendingSpawns[i].at) {
        this.spawnBot();
        this.pendingSpawns.splice(i, 1);
      }
    }
    this.maintainFood(dt);
  }

  // ------------------------------------------------------------------ jelo
  eatPass() {
    for (const s of this.snakes) {
      if (s.dead) continue;
      const r = s.headRadius + 10;

      this.foodHash.query(s.x, s.y, r + 20, this._hits);
      for (const f of this._hits) {
        if (f.dead) continue;
        const rr = r + f.r;
        if (dist2(s.x, s.y, f.x, f.y) < rr * rr) this.eatFood(s, f);
      }

      // magnet: označi hranu za sledeći frejm (privlačenje u Food.update)
      if (s.magnetActive) {
        this.foodHash.query(s.x, s.y, BAL.magnetRadius, this._hits2);
        for (const f of this._hits2) {
          if (f.dead || f.type === 'power') continue;
          f.pullT = 0.06;
          f.tx = s.x; f.ty = s.y;
        }
      }
    }
  }

  eatFood(s, f) {
    if (f.dead) return;
    f.dead = true;
    s.mass += f.value;
    let score = f.value * 10;

    if (f.type === 'power') {
      s.buffs[f.power] = f.power === 'speed' ? 6 : f.power === 'magnet' ? 8 : 10;
      score = 50;
      this.effects.burst(f.x, f.y, this.powerHue(f.power), 14, 260);
    } else if (f.type === 'mega') {
      this.effects.burst(f.x, f.y, f.hue, 12, 300);
      this.effects.text(f.x, f.y, '+8', 185);
    } else {
      this.effects.spark(f.x, f.y, { hue: f.hue, speed: 90, ttl: 0.35 });
    }
    s.addScore(score);
    this.hooks.eat?.(s, f);
  }

  powerHue(type) { return type === 'speed' ? 45 : type === 'magnet' ? 285 : 96; }

  // ------------------------------------------------------------------ sudari
  collisionPass() {
    const deaths = [];
    for (const s of this.snakes) {
      if (s.dead || s.invuln > 0) continue;

      // granica arene
      if (Math.hypot(s.x, s.y) > this.R - s.headRadius) {
        deaths.push({ s, killer: null, cause: 'wall' });
        continue;
      }

      // glava ↔ tuđe telo
      let killed = false;
      this.segHash.query(s.x, s.y, s.headRadius + 44, this._hits);
      for (const seg of this._hits) {
        if (seg.sid === s.id) continue;
        const rr = s.headRadius * 0.9 + seg.r;
        if (dist2(s.x, s.y, seg.x, seg.y) < rr * rr) {
          const killer = this.snakeById(seg.sid);
          deaths.push({ s, killer, cause: 'body' });
          killed = true;
          break;
        }
      }
      if (killed) continue;

      // glava ↔ glava (oboje ginu)
      for (const o of this.snakes) {
        if (o === s || o.dead) continue;
        const rr = (s.headRadius + o.headRadius) * 0.82;
        if (dist2(s.x, s.y, o.x, o.y) < rr * rr) {
          deaths.push({ s, killer: o, cause: 'head' });
          break;
        }
      }
    }

    for (const d of deaths) if (!d.s.dead) this.processDeath(d.s, d.killer, d.cause);
  }

  snakeById(id) {
    for (const s of this.snakes) if (s.id === id) return s;
    return null;
  }

  // ------------------------------------------------------------------- smrt
  processDeath(victim, killer, cause) {
    victim.die();

    // 1) drop-orb duž tela (55% mase se vraća u svet)
    const segs = victim.segs;
    if (segs.length > 0) {
      const nDrops = Math.min(56, Math.ceil(segs.length / 2));
      const value = Math.max(1, (victim.mass * 0.55) / nDrops);
      for (let i = 0; i < nDrops; i++) {
        const seg = segs[Math.min(segs.length - 1, Math.floor(i * segs.length / nDrops))];
        this.foods.push(new Food('drop', seg.x + (this.rng() - 0.5) * 14, seg.y + (this.rng() - 0.5) * 14, {
          value: Math.min(6, value), hue: victim.hue, life: 28,
        }));
      }
    }

    // 2) kristalni shard-ovi + iskre + shockwave
    const ef = this.effects;
    const step = Math.max(1, Math.floor(segs.length / 26));
    const hvx = Math.cos(victim.heading) * victim.speed * 0.4;
    const hvy = Math.sin(victim.heading) * victim.speed * 0.4;
    for (let i = 0; i < segs.length; i += step) {
      ef.shard(segs[i].x, segs[i].y, victim.hue, hvx, hvy);
      ef.shard(segs[i].x, segs[i].y, victim.hue);
    }
    ef.burst(victim.x, victim.y, victim.hue, 18, 340);
    ef.shockwave(victim.x, victim.y, victim.hue, 150 + victim.baseWidth * 6, 0.6);

    // 3) screen shake sa opadanjem po udaljenosti od kamere + slow-mo
    const dCam = Math.hypot(victim.x - this.viewer.x, victim.y - this.viewer.y);
    const falloff = Math.max(0, 1 - dCam / 1400);
    ef.addTrauma(0.75 * falloff);
    if (falloff > 0.25) ef.slowMo(0.35);

    // 4) kredit ubici
    if (killer && !killer.dead) {
      killer.kills++;
      killer.addScore(Math.round(victim.mass * 4));
    }

    // 5) kill feed
    const who = killer ? killer.name : (cause === 'wall' ? 'ENERGETSKI ZID' : 'ARENA');
    this.killFeed.push({ killer: who, victim: victim.name, hueK: killer ? killer.hue : 0, hueV: victim.hue, t: 0 });
    if (this.killFeed.length > 5) this.killFeed.shift();

    // 6) respavn botova
    if (victim.isBot) {
      this._usedNames.delete(victim.name);
      this.pendingSpawns.push({ at: this.time + 3.2 });
    }

    this.hooks.death?.(victim, killer, cause);
  }

  // ------------------------------------------------------- sposobnosti (hook)
  onDash(s) {
    this.effects.burst(s.x, s.y, s.hue, 10, 200);
    this.hooks.dash?.(s);
  }

  onMagnet(s) {
    this.effects.shockwave(s.x, s.y, 285, BAL.magnetRadius, 0.5);
    this.hooks.magnet?.(s);
  }

  onEmp(s) {
    const ef = this.effects;
    ef.shockwave(s.x, s.y, 200, BAL.empRadius + 80, 0.6);
    ef.addTrauma(0.18);
    for (const o of this.snakes) {
      if (o === s || o.dead) continue;
      if (dist2(s.x, s.y, o.x, o.y) < BAL.empRadius * BAL.empRadius) {
        o.slowT = BAL.empTime;
        ef.spark(o.x, o.y, { hue: 200, speed: 220, ttl: 0.5 });
      }
    }
    this.hooks.emp?.(s);
  }

  dropBoostPellet(x, y, hue) {
    if (this.foods.length > 1450) return;
    this.foods.push(new Food('pellet', x + (this.rng() - 0.5) * 10, y + (this.rng() - 0.5) * 10, { hue }));
  }

  // ----------------------------------------------------------- održavanje
  maintainFood(dt) {
    // prebroj (jeftino — vršimo jednom po frejmu nad ≤1500 elemenata)
    const c = { pellet: 0, mega: 0, power: 0 };
    for (const f of this.foods) if (f.type in c) c[f.type]++;

    for (let i = c.pellet; i < FOOD.pelletTarget; i++) {
      const p = this.randomPoint(0.97);
      this.foods.push(new Food('pellet', p.x, p.y, { hue: this.randomFoodHue() }));
    }
    for (let i = c.mega; i < FOOD.megaTarget; i++) {
      const p = this.randomPoint(0.92);
      this.foods.push(new Food('mega', p.x, p.y, { hue: 185 }));
    }

    this._powerTimer -= dt;
    if (this._powerTimer <= 0) {
      this._powerTimer = 5 + this.rng() * 4;
      if (c.power < FOOD.powerTarget) {
        const p = this.randomPoint(0.85);
        const power = FOOD.powerTypes[(this.rng() * FOOD.powerTypes.length) | 0];
        this.foods.push(new Food('power', p.x, p.y, { hue: this.powerHue(power), power, life: 22 }));
      }
    }
  }

  /// Rang-lista (žive zmije, sortirano po masi).
  leaders(n = 10) {
    const arr = [];
    for (const s of this.snakes) if (!s.dead) arr.push(s);
    arr.sort((a, b) => b.mass - a.mass);
    return arr.slice(0, n);
  }

  aliveCount() {
    let n = 0;
    for (const s of this.snakes) if (!s.dead) n++;
    return n;
  }
}
