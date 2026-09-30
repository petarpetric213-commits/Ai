// =============================================================================
// dom-smoke.test.mjs — pun game-loop smoke test sa stub-ovanim DOM-om.
// Hvata runtime greške u Renderer/Hud/Background/Input/Game (typos, null...).
// Pokretanje:  node neoserpent/test/dom-smoke.test.mjs
// =============================================================================

// ------------------------------------------------------------------ DOM stub
const ctxStub = new Proxy({}, {
  get(t, p) {
    if (p === 'canvas') return canvas;
    if (p in t) return t[p];
    // posebni povratni tipovi
    if (p === 'measureText') return () => ({ width: 42 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') {
      return () => ({ addColorStop: () => {} });
    }
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    // sve ostalo: no-op funkcija
    t[p] = () => {};
    return t[p];
  },
  set(t, p, v) { t[p] = v; return true; },
});

function makeCanvas() {
  return {
    width: 1280, height: 720, style: {},
    getContext: () => ctxStub,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
}
const canvas = makeCanvas();

const elements = new Map();
function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', innerHTML: '', value: '',
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    appendChild: () => {},
    focus: () => {},
  };
  return el;
}

let rafCb = null;
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.Path2D = class {
  moveTo() {} lineTo() {} closePath() {} arc() {} arcTo() {}
  ellipse() {} rect() {} quadraticCurveTo() {} bezierCurveTo() {}
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  addEventListener: () => {},
  body: makeEl('body'),
};

// ------------------------------------------------------------------ test
const { Game } = await import('../prototype/src/Game.js');

const ids = ['game', 'menu', 'death', 'playBtn', 'respawnBtn', 'nameInput', 'deathCause', 'deathStats',
  'touchControls', 'boostBtn', 'dashBtn', 'magnetBtn', 'empBtn'];
for (const id of ids) document.getElementById(id);

const game = new Game(canvas, {
  menu: document.getElementById('menu'),
  death: document.getElementById('death'),
  playBtn: document.getElementById('playBtn'),
  respawnBtn: document.getElementById('respawnBtn'),
  nameInput: document.getElementById('nameInput'),
  deathCause: document.getElementById('deathCause'),
  deathStats: document.getElementById('deathStats'),
  touch: document.getElementById('touchControls'),
  boostBtn: document.getElementById('boostBtn'),
  dashBtn: document.getElementById('dashBtn'),
  magnetBtn: document.getElementById('magnetBtn'),
  empBtn: document.getElementById('empBtn'),
});

let t = 1000;
function pump(frames, dtMs = 16.6) {
  for (let i = 0; i < frames; i++) {
    const cb = rafCb; rafCb = null;
    t += dtMs;
    if (cb) cb(t);
    if (!rafCb) throw new Error('requestAnimationFrame nije re-zakazan (petlja pukla)');
  }
}

// 1) meni — botski svet + kino kamera + render svega
pump(120);
console.log('  ✓ 120 frejmova u meniju (pozadina, grid, botovi, HUD off)');

// 2) start igre — klik na play
game.startGame('TESTER');
if (game.state !== 'playing' || !game.player) throw new Error('startGame nije prebacio stanje');
pump(240);
console.log('  ✓ 240 frejmova gameplay-a (zmija, hrana, HUD, minimapa, ability bar)');

// 3) sposobnosti igrača
game.input._dash = true; game.input._magnet = true; game.input._emp = true;
pump(90);
console.log('  ✓ dash + magnet + EMP bez crash-a');

// 4) boost + smrt igrača
game.input.boost = true;
pump(60);
game.input.boost = false;
game.world.processDeath(game.player, null, 'wall');
pump(120);
if (game.state !== 'dead') throw new Error('smrt igrača nije prikazana (state=' + game.state + ')');
console.log('  ✓ smrt igrača → death screen, spectate kamera, particles');

// 5) respawn
game.respawn();
pump(240);
console.log('  ✓ respawn i nastavak igre');

// 6) krajnje provere
const w = game.world;
for (const s of w.snakes) {
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) throw new Error('NaN pozicija zmije');
}
console.log(`  ✓ završno stanje: ${w.snakes.length} zmija, ${w.foods.length} hrane, ${w.effects.particles.length} čestica`);
console.log('\nDOM SMOKE TEST: SVE PROŠLO ✔');
