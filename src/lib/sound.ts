// Synthesized UI sounds (Web Audio): no asset files needed.
import { useSound } from '../store/sound';

let ctx: AudioContext | null = null;

function ac() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + (opts.at ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Short filtered noise burst: the "wood" in a piece landing. */
function knock(dur: number, freq: number, gain: number) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

const on = () => !useSound.getState().muted;

export const sound = {
  move: () => on() && (knock(0.07, 1800, 0.9), tone(420, 0.06, { gain: 0.05, type: 'triangle' })),
  capture: () => on() && (knock(0.12, 900, 1.3), tone(220, 0.1, { gain: 0.08, type: 'triangle' })),
  correct: () => on() && (tone(660, 0.12, { gain: 0.12 }), tone(990, 0.18, { gain: 0.12, at: 0.09 })),
  wrong: () => on() && tone(220, 0.25, { type: 'sawtooth', gain: 0.05, slide: 140 }),
  complete: () => on() && [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { gain: 0.1, at: i * 0.08 })),
};
