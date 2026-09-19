import { audioContext } from './audio';

/**
 * A small procedural lounge-funk loop (A minor, 104 bpm). It runs on a musical
 * clock that follows the game's time scale, so standing still stretches the groove.
 */
const BPM = 104;
const STEP = 60 / BPM / 4; // one sixteenth
const A2 = 110;

// Two bars of sixteenths. Bass: semitones above A2 (null = rest).
const BASS: (number | null)[] = [
  0, null, 0, 3, null, 7, null, 10, 12, null, 10, 7, 5, null, 7, 10,
  5, null, 5, 8, null, 12, null, 15, 12, null, 10, 8, 7, null, 3, null,
];
const KICK = new Set([0, 6, 8, 11, 16, 22, 24, 27]);
const SNARE = new Set([4, 12, 20, 28]);
// Organ stabs: chord (semitones above A3) on these steps.
const STABS: Record<number, number[]> = {
  6: [0, 3, 7, 10],
  14: [0, 3, 7, 10],
  22: [5, 8, 12, 15],
  30: [5, 8, 12, 15],
};

export class Music {
  private pos = 0;
  private lastStep = -1;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Advance the groove; `rate` 1 = normal tempo. */
  update(realDt: number, rate: number): void {
    const ctx = audioContext();
    if (!ctx || !this.enabled) return;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = 0.16;
      this.out.connect(ctx.destination);
      const len = ctx.sampleRate / 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    this.pos += (realDt * rate) / STEP;
    const step = Math.floor(this.pos);
    // Schedule at most a couple of steps per frame (after a hitch, just skip ahead).
    if (step - this.lastStep > 2) this.lastStep = step - 1;
    while (this.lastStep < step) {
      this.lastStep++;
      this.play(ctx, this.lastStep % 32, Math.max(0.35, rate));
    }
  }

  private play(ctx: AudioContext, s: number, rate: number): void {
    const t = ctx.currentTime + 0.03;
    const len = STEP / rate; // notes stretch with the slowed clock
    if (KICK.has(s)) this.kick(ctx, t);
    if (SNARE.has(s)) this.hit(ctx, t, 'bandpass', 1800, 0.35, 0.16);
    if (s % 2 === 0) this.hit(ctx, t, 'highpass', 7000, s % 8 === 6 ? 0.18 : 0.06, s % 8 === 6 ? 0.15 : 0.04);
    const b = BASS[s];
    if (b !== null) this.bass(ctx, t, A2 * 2 ** (b / 12), len * 1.6);
    const chord = STABS[s];
    if (chord) for (const n of chord) this.stab(ctx, t, A2 * 2 * 2 ** (n / 12), len * 1.2);
  }

  private env(ctx: AudioContext, t: number, peak: number, dur: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out!);
    return g;
  }

  private kick(ctx: AudioContext, t: number): void {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(this.env(ctx, t, 0.9, 0.25));
    o.start(t);
    o.stop(t + 0.3);
  }

  private hit(ctx: AudioContext, t: number, type: BiquadFilterType, freq: number, gain: number, dur: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(ctx, t, gain, dur));
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
  }

  private bass(ctx: AudioContext, t: number, freq: number, dur: number): void {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    o.connect(f).connect(this.env(ctx, t, 0.45, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private stab(ctx: AudioContext, t: number, freq: number, dur: number): void {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    o.connect(f).connect(this.env(ctx, t, 0.07, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
