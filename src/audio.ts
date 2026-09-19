// Procedural sound effects: no audio files to load.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** The shared context once audio has been unlocked by a user gesture, else null. */
export function audioContext(): AudioContext | null {
  return ctx;
}

export function initAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

interface NoiseOpts {
  duration: number;
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  gain: number;
  q?: number;
}

function noiseBurst(o: NoiseOpts): void {
  if (!ctx || !noise) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + o.duration);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + o.duration + 0.05);
}

function tone(freq: number, freqEnd: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const sfx = {
  shoot(): void {
    noiseBurst({ duration: 0.25, filter: 'lowpass', freq: 4000, freqEnd: 300, gain: 0.8 });
    tone(160, 40, 0.18, 0.5, 'triangle');
  },
  enemyShoot(distance: number): void {
    const v = Math.min(0.5, 2.5 / Math.max(1, distance));
    noiseBurst({ duration: 0.3, filter: 'lowpass', freq: 2200, freqEnd: 200, gain: v });
  },
  empty(): void {
    tone(900, 700, 0.05, 0.25, 'square');
  },
  shatter(): void {
    noiseBurst({ duration: 0.5, filter: 'highpass', freq: 2500, freqEnd: 6000, gain: 0.6, q: 0.7 });
    tone(1800, 600, 0.3, 0.15, 'triangle');
    tone(2600, 900, 0.25, 0.1, 'triangle', 0.04);
  },
  ricochet(): void {
    tone(2200, 3200, 0.08, 0.12, 'sine');
  },
  punch(): void {
    noiseBurst({ duration: 0.12, filter: 'lowpass', freq: 800, freqEnd: 100, gain: 0.8 });
  },
  throwGun(): void {
    noiseBurst({ duration: 0.2, filter: 'bandpass', freq: 600, freqEnd: 1600, gain: 0.3, q: 2 });
  },
  death(): void {
    tone(220, 40, 1.2, 0.5, 'sawtooth');
    noiseBurst({ duration: 0.8, filter: 'lowpass', freq: 1200, freqEnd: 80, gain: 0.6 });
  },
  clear(): void {
    tone(440, 440, 0.25, 0.25, 'triangle');
    tone(660, 660, 0.3, 0.25, 'triangle', 0.18);
  },
  pickup(): void {
    tone(500, 900, 0.08, 0.15, 'triangle');
  },
  revolver(): void {
    noiseBurst({ duration: 0.45, filter: 'lowpass', freq: 3500, freqEnd: 120, gain: 1.0 });
    tone(110, 35, 0.35, 0.7, 'triangle');
    tone(1400, 900, 0.05, 0.12, 'square', 0.12); // hammer click on the way back
  },
  smg(): void {
    noiseBurst({ duration: 0.12, filter: 'lowpass', freq: 5000, freqEnd: 600, gain: 0.55 });
    tone(220, 90, 0.08, 0.3, 'square');
  },
  glass(): void {
    noiseBurst({ duration: 0.7, filter: 'highpass', freq: 4000, freqEnd: 9000, gain: 0.5, q: 0.5 });
    tone(3200, 1400, 0.4, 0.12, 'sine');
    tone(4100, 2000, 0.3, 0.08, 'sine', 0.05);
  },
  disarm(): void {
    tone(700, 300, 0.06, 0.3, 'square');
    noiseBurst({ duration: 0.08, filter: 'bandpass', freq: 1800, gain: 0.5, q: 3 });
  },
};

let hum: { osc: OscillatorNode[]; gain: GainNode } | null = null;

/** Low neon-sign hum; 0 turns it off. */
export function ambience(level: number): void {
  if (!ctx) return;
  if (!hum) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = [60, 120, 181].map((f, i) => {
      const o = ctx!.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const g = ctx!.createGain();
      g.gain.value = [0.5, 0.18, 0.06][i];
      o.connect(g).connect(gain);
      o.start();
      return o;
    });
    hum = { osc, gain };
  }
  hum.gain.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.5);
}
