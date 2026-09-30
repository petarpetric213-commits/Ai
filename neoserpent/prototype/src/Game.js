// =============================================================================
// Game.js — glavna petlja, state mašina (menu/playing/dead), povezivanje DOM-a
// =============================================================================

import { clamp } from './core/math.js';
import { makeRng } from './core/math.js';
import { Camera } from './core/Camera.js';
import { Input } from './core/Input.js';
import { Sfx } from './core/Audio.js';
import { World } from './systems/World.js';
import { Effects } from './systems/Effects.js';
import { Snake, BAL } from './entities/Snake.js';
import { LocalController } from './entities/Controllers.js';
import { Renderer } from './render/Renderer.js';
import { Background } from './render/Background.js';
import { Hud } from './render/Hud.js';

export class Game {
  constructor(canvas, dom) {
    this.canvas = canvas;
    this.dom = dom; // { menu, death, playBtn, respawnBtn, nameInput, deathCause, deathStats, touch, boostBtn, ... }
    this.rng = makeRng((Math.random() * 1e9) | 0);
    this.effects = new Effects(this.rng);
    this.world = new World({
      radius: 3800,
      effects: this.effects,
      rng: this.rng,
      botCount: 11,
      hooks: this._hooks(),
    });
    this.camera = new Camera();
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.renderer = new Renderer(canvas, this.world);
    this.background = new Background(this.rng);
    this.hud = new Hud(canvas, this.world);

    this.state = 'menu';
    this.player = null;
    this.playerHue = 190;
    this.runStats = null;
    this.time = 0;
    this.last = 0;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsN = 0;
    this._tmpv = { x: 0, y: 0 };

    this._resize();
    addEventListener('resize', () => this._resize());

    this._bindDom();
    this._spectateTarget = null;

    requestAnimationFrame((t) => this._frame(t));
  }

  _resize() {
    this.renderer.resize();
    this.background.resize(globalThis.innerWidth, globalThis.innerHeight);
    this.hud.resize(globalThis.innerWidth, globalThis.innerHeight);
    this.camera.resize(globalThis.innerWidth, globalThis.innerHeight);
  }

  _hooks() {
    return {
      eat: (snake, food) => {
        if (snake === this.player) this.sfx.eat(food.type);
      },
      death: (victim, killer) => {
        if (killer === this.player && this.player) {
          this.sfx.kill();
          this.effects.text(victim.x, victim.y - 20, 'ELIMINACIJA!', victim.hue);
        }
        if (victim === this.player) this._onPlayerDeath(killer);
        else if (victim === this._spectateTarget) this._spectateTarget = null;
      },
      dash: (s) => { if (s === this.player) this.sfx.dash(); },
      magnet: (s) => { if (s === this.player) this.sfx.magnet(); },
      emp: (s) => { if (s === this.player) this.sfx.emp(); },
    };
  }

  _bindDom() {
    const d = this.dom;
    const start = () => { this.sfx.unlock(); this.startGame(d.nameInput.value.trim() || 'PILOT'); };
    d.playBtn.addEventListener('click', start);
    d.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

    const respawn = () => { if (this.state === 'dead') { this.sfx.unlock(); this.respawn(); } };
    d.respawnBtn.addEventListener('click', respawn);
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.state === 'dead') { e.preventDefault(); respawn(); }
      if (e.code === 'KeyM') { this.sfx.setMuted(!this.sfx.muted); }
    });

    // unlock audio na prvi klik bilo gde
    addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });

    // touch kontrole
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse) d.touch.classList.remove('hidden');
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
    };
    hold(d.boostBtn, () => { this.input.boostTouch = true; }, () => { this.input.boostTouch = false; });
    d.dashBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input._dash = true; });
    d.magnetBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input._magnet = true; });
    d.empBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input._emp = true; });
  }

  // --------------------------------------------------------------- state flow
  startGame(name) {
    this.player = this.world.addPlayerSnake(name, this.playerHue);
    this.player.controller = new LocalController(this.input);
    this.runStats = { t0: this.time, maxMass: this.player.mass, kills: 0, bestRank: 99, score0: 0 };
    this.state = 'playing';
    this.dom.menu.classList.add('hidden');
    this.dom.death.classList.add('hidden');
    this.sfx.unlock();
  }

  respawn() {
    this.startGame(this.player ? this.player.name : 'PILOT');
  }

  _onPlayerDeath(killer) {
    this.state = 'dead';
    this.sfx.death();
    this.sfx.boost(false);
    const p = this.player;
    const cause = killer
      ? `eliminisao te je ${killer.name}`
      : 'udario si u energetski zid arene';
    this.dom.deathCause.textContent = cause;
    const mins = Math.floor((this.time - this.runStats.t0) / 60);
    const secs = Math.floor((this.time - this.runStats.t0) % 60);
    this.dom.deathStats.innerHTML = `
      <div><span>MAKS. MASA</span><b>${Math.floor(this.runStats.maxMass)}</b></div>
      <div><span>POENI</span><b>${Math.floor(p.score).toLocaleString('en-US')}</b></div>
      <div><span>UBISTVA</span><b>${p.kills}</b></div>
      <div><span>PREŽIVEO</span><b>${mins}:${String(secs).padStart(2, '0')}</b></div>`;
    this.dom.death.classList.remove('hidden');
    this._spectateTarget = killer && !killer.dead ? killer : null;
  }

  // ------------------------------------------------------------------- petlja
  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    if (!this.last) this.last = now;
    let rdt = (now - this.last) / 1000;
    this.last = now;
    if (rdt > 0.1) rdt = 0.1; // tab bio u pozadini
    this.time += rdt;

    // FPS (EMA)
    if (rdt > 0) this.fps += (1 / rdt - this.fps) * 0.06;

    // slow-mo utiče na svet
    const dt = rdt * this.effects.timeScale;

    // kamera prati igrača (ili spectate/kino lidera)
    let target = null;
    let cinematic = false;
    if (this.state === 'playing' && this.player && !this.player.dead) {
      target = this.player;
      if (this.player.boostFactor > 0.5) this.sfx.boost(true);
      else this.sfx.boost(false);
      // boost partikli za igrača
      if (this.player.boostFactor > 0.6) this._playerBoostTrail();
    } else if (this.state === 'dead') {
      if (this._spectateTarget && !this._spectateTarget.dead) target = this._spectateTarget;
      else {
        const l = this.world.leaders(1);
        target = l[0] || null;
      }
    } else {
      const l = this.world.leaders(1);
      target = l[0] || null;
      cinematic = true;
    }
    this.camera.update(rdt, target, cinematic);
    this.world.viewer.x = this.camera.x;
    this.world.viewer.y = this.camera.y;

    // ulaz → svetske koordinate
    this.input.update(this.camera, this._tmpv);

    // simulacija (sub-step ako je dt velik)
    if (dt > 1 / 32) {
      const n = Math.ceil(dt / (1 / 60));
      const step = dt / n;
      for (let i = 0; i < n; i++) this.world.update(step);
    } else {
      this.world.update(dt);
    }
    this.effects.update(dt, rdt);
    this.camera.shakeX = this.effects.shakeX;
    this.camera.shakeY = this.effects.shakeY;

    // statistika igrača
    if (this.state === 'playing' && this.player && !this.player.dead) {
      this.runStats.maxMass = Math.max(this.runStats.maxMass, this.player.mass);
      const leaders = this.world.leaders(20);
      const rank = leaders.indexOf(this.player) + 1;
      if (rank > 0) this.runStats.bestRank = Math.min(this.runStats.bestRank, rank);
    }

    // render
    this.background.render(this.renderer.ctx, this.camera, this.world, this.time);
    this.renderer.render(this.camera, rdt, this.time);
    this.hud.render(this, this.camera, rdt);
  }

  _playerBoostTrail() {
    const p = this.player;
    const tail = p.segs[Math.min(p.segs.length - 1, 4)];
    if (tail && Math.random() < 0.5) {
      this.effects.spark(tail.x, tail.y, {
        hue: p.hue, speed: 60, ttl: 0.4, size: 2.5,
        vx: -Math.cos(p.heading) * 120, vy: -Math.sin(p.heading) * 120,
      });
    }
  }
}
