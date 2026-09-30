// =============================================================================
// Audio.js — proceduralni Web Audio sintisajzer (nula asset-a)
// Sigurno no-op kada AudioContext ne postoji (npr. headless testovi).
// =============================================================================

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._boostSrc = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // white noise buffer za "whoosh"
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
    if (m) this.boost(false);
  }

  tone({ f0 = 440, f1, dur = 0.15, type = 'sine', vol = 0.18, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 ?? f0), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.25, f = 900, f1, q = 1.2, vol = 0.2, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1 ?? f), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }

  // ------------------------------------------------------------ događaji
  eat(kind) {
    if (kind === 'mega') { this.tone({ f0: 520, f1: 780, dur: 0.16, type: 'triangle', vol: 0.22 }); this.tone({ f0: 660, f1: 990, dur: 0.2, type: 'sine', vol: 0.14, delay: 0.05 }); }
    else if (kind === 'power') { this.tone({ f0: 440, dur: 0.1, type: 'square', vol: 0.1 }); this.tone({ f0: 550, dur: 0.1, type: 'square', vol: 0.1, delay: 0.08 }); this.tone({ f0: 660, dur: 0.16, type: 'square', vol: 0.12, delay: 0.16 }); }
    else this.tone({ f0: 480 + Math.random() * 240, f1: 700, dur: 0.07, type: 'sine', vol: 0.09 });
  }

  dash() { this.noise({ dur: 0.28, f: 1800, f1: 260, vol: 0.3 }); this.tone({ f0: 300, f1: 90, dur: 0.22, type: 'sawtooth', vol: 0.07 }); }
  magnet() { this.tone({ f0: 300, f1: 900, dur: 0.35, type: 'sine', vol: 0.16 }); this.tone({ f0: 450, f1: 1350, dur: 0.35, type: 'triangle', vol: 0.1, delay: 0.05 }); }
  emp() { this.tone({ f0: 120, f1: 38, dur: 0.5, type: 'sine', vol: 0.35 }); this.noise({ dur: 0.4, f: 3000, f1: 200, q: 0.8, vol: 0.22 }); }
  death() { this.noise({ dur: 0.7, f: 800, f1: 60, q: 0.7, vol: 0.4 }); this.tone({ f0: 220, f1: 28, dur: 0.8, type: 'sawtooth', vol: 0.22 }); }
  kill() { this.tone({ f0: 520, dur: 0.12, type: 'triangle', vol: 0.18 }); this.tone({ f0: 780, dur: 0.22, type: 'triangle', vol: 0.18, delay: 0.1 }); }

  boost(on) {
    if (!this.ctx || this.muted) { if (!on && this._boostSrc) { try { this._boostSrc.stop(); } catch {} this._boostSrc = null; } return; }
    if (on && !this._boostSrc) {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf; src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.value = 620;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.085, this.ctx.currentTime + 0.08);
        src.connect(bp); bp.connect(g); g.connect(this.master);
        src.start();
        this._boostSrc = src; this._boostGain = g;
      } catch {}
    } else if (!on && this._boostSrc) {
      try {
        this._boostGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);
        const src = this._boostSrc;
        setTimeout(() => { try { src.stop(); } catch {} }, 200);
      } catch {}
      this._boostSrc = null;
    }
  }
}
