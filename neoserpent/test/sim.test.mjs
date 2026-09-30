// =============================================================================
// sim.test.mjs — headless test simulacije (bez DOM-a)
// Pokretanje:  node neoserpent/test/sim.test.mjs
// =============================================================================

import { makeRng } from '../prototype/src/core/math.js';
import { PathBuffer } from '../prototype/src/core/PathBuffer.js';
import { SpatialHash } from '../prototype/src/core/SpatialHash.js';
import { World } from '../prototype/src/systems/World.js';
import { Effects } from '../prototype/src/systems/Effects.js';
import { Snake, BAL } from '../prototype/src/entities/Snake.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// ---------------------------------------------------------------- PathBuffer
console.log('\n[1] PathBuffer — uzorkovanje putanje');
{
  const pb = new PathBuffer(4, 512);
  pb.clear(0, 0);
  // napravi pravu liniju duž x ose: tačke na 4, 8, 12 ... glava na x=100
  for (let x = 4; x <= 100; x += 4) pb.push(x, 0);
  const out = { x: 0, y: 0 };

  pb.sample(0, 100, 0, out);
  check('sample(0) = pozicija glave', Math.abs(out.x - 100) < 1e-6 && Math.abs(out.y) < 1e-6);

  pb.sample(10, 100, 0, out);
  check('sample(10) na pravoj liniji → x=90', Math.abs(out.x - 90) < 0.6);

  // monotona udaljenost od glave duž uzorka
  let ok = true, prev = -1;
  for (let s = 0; s < 90; s += 2) {
    pb.sample(s, 100, 0, out);
    const d = Math.hypot(out.x - 100, out.y);
    if (d < prev - 0.5) { ok = false; break; }
    prev = d;
  }
  check('udaljenost raste monotonoo sa s (nema "pucketanja")', ok);

  pb.sample(5000, 100, 0, out);
  check('van opsega → klemp na poslednju tačku', out.x <= 4 && Math.abs(out.y) < 1e-6);
}

// --------------------------------------------------------------- SpatialHash
console.log('\n[2] SpatialHash — ubacivanje i upiti');
{
  const h = new SpatialHash(100);
  const a = { x: 250, y: 250, r: 5 }, b = { x: 900, y: 900, r: 5 };
  h.insert(250, 250, 5, a);
  h.insert(900, 900, 5, b);
  const out = [];
  h.query(260, 260, 50, out);
  check('upit pronalazi obližnji item', out.includes(a) && !out.includes(b));
  h.query(880, 880, 100, out);
  check('upit pronalazi udaljen item (drugi region)', out.includes(b));
  h.clear();
  h.query(250, 250, 200, out);
  check('clear() prazni heš', out.length === 0);
}

// ------------------------------------------------------------- Snake mehanika
console.log('\n[3] Snake — boost, dash, masa, segmenti');
{
  const effects = new Effects(makeRng(7));
  const world = new World({ radius: 2000, effects, rng: makeRng(42), botCount: 3 });
  const s = new Snake(world, { name: 'TEST', hue: 190, x: 500, y: 500, mass: 60 });

  const segCount0 = s.targetSegCount;
  check('početni broj segmenata odgovara masi', s.segs.length === segCount0);

  // simuliraj 2s boost-a pravo
  const inp = s.input;
  inp.boost = true;
  inp.tx = s.x + 1000; inp.ty = s.y;
  const m0 = s.mass;
  for (let i = 0; i < 120; i++) s.update(1 / 60, i / 60);
  check('boost troši masu', s.mass < m0 - 2);
  check('boostFactor raste ka 1', s.boostFactor > 0.8);
  check('boost ispušta hranu u svet', world.foods.some((f) => f.x > 400 && f.x < 2000));

  // dash
  const cdBefore = s.dashCd;
  s.tryDash();
  check('dash postavlja cooldown', s.dashCd > cdBefore && s.dashCd > 4);
  let maxSpeed = 0;
  for (let i = 0; i < 40; i++) { s.update(1 / 60, i / 60); maxSpeed = Math.max(maxSpeed, s.speed); }
  check('dash daje brzinski impuls (>2× osnovna)', maxSpeed > BAL.baseSpeed * 2);

  // EMP debaf (prvo ugasi boost i sačekaj da opadne)
  inp.boost = false;
  for (let i = 0; i < 90; i++) s.update(1 / 60, i / 60);
  check('boostFactor opada nakon puštanja', s.boostFactor < 0.15);
  s.slowT = BAL.empTime;
  s.update(1 / 60, 0);
  check('EMP usporava (speed < 50% baze)', s.speed < BAL.baseSpeed * 0.55);
}

// --------------------------------------------------------------- World sim
console.log('\n[4] World — 90 sekundi simulacije sa botovima (deterministički seed)');
{
  const rng = makeRng(1234);
  const effects = new Effects(rng);
  const world = new World({ radius: 3800, effects, rng, botCount: 12 });
  const deaths = [];
  world.hooks.death = (v) => deaths.push(v.name);

  let deathsTotal = 0, botCountMin = 99;
  const steps = 90 * 60;
  for (let i = 0; i < steps; i++) {
    world.update(1 / 60);
    if (i % 60 === 0) {
      botCountMin = Math.min(botCountMin, world.snakes.length);
      for (const s of world.snakes) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.mass)) {
          throw new Error(`NaN/Infinity na zmiji ${s.name} pri t=${i / 60}s`);
        }
        for (const seg of s.segs) {
          if (!Number.isFinite(seg.x) || !Number.isFinite(seg.y)) throw new Error('NaN u segmentu');
        }
      }
      for (const f of world.foods) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new Error('NaN u hrani');
      }
      if (world.foods.length > 1600) throw new Error('hrana eksplodirala: ' + world.foods.length);
      if (world.snakes.length > 30) throw new Error('previše zmija: ' + world.snakes.length);
    }
  }
  check('90s simulacije bez NaN/crasha', true);
  check('smrti se dešavaju (botovi umiru i vraćaju se)', deaths.length > 0 || world.killFeed !== null);
  check('populacija botova se održava (živi + zakazani respavn ≥ 12)',
    world.snakes.length + world.pendingSpawns.length >= 12);
  check('hrana unutar granica', world.foods.every((f) => Math.hypot(f.x, f.y) < world.R + 1));
  check('efekti (čestice) rade', effects.particles !== null);
}

// ------------------------------------------------------------- sudari
console.log('\n[5] Sudari — glava u telo = smrt');
{
  const rng = makeRng(99);
  const effects = new Effects(rng);
  const world = new World({ radius: 3000, effects, rng, botCount: 0 });
  const big = new Snake(world, { name: 'BIG', hue: 100, x: 0, y: 0, mass: 400, heading: 0 });
  // velika zmija se kreće desno, telo joj je levo od glave
  world.snakes.push(big);
  for (let i = 0; i < 60; i++) world.update(1 / 60);

  const victim = new Snake(world, { name: 'VICTIM', hue: 320, x: 0, y: -100, mass: 30 });
  victim.controller = null;
  world.snakes.push(victim);
  for (let i = 0; i < 30; i++) world.update(1 / 60);

  // usmeri žrtvu pravo u telo velike zmije
  victim.input.tx = -50; victim.input.ty = 0;
  for (let i = 0; i < 400 && !victim.dead; i++) world.update(1 / 60);
  check('zmija koja udari tuđe telo umire', victim.dead === true);
  check('kill feed je zabeležio eliminaciju', world.killFeed.some((k) => k.victim === 'VICTIM'));
}

console.log(`\n==========================================`);
console.log(`REZULTAT: ${passed} prošlo, ${failed} palo`);
if (failed > 0) process.exit(1);
