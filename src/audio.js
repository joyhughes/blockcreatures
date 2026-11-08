// Hearing for the dancers: the microphone's sound, reduced each frame to the
// NAUD channels the creatures sense (sim.js AUDIO, genome.js NAUD):
//   0 loudness, 1 bass (30-200 Hz), 2 mids (200-2000 Hz), 3 treble (2-8 kHz):
//     each in dB, mapped to 0..1 over the 40 dB below the loudest it has been
//     lately (that peak sinks back 6 dB every 4 s), so quiet rooms and loud
//     parties both span the range, and silence reads 0;
//   4 beat: 1 at an onset (the bass jumping well above its recent average),
//     decaying over a fifth of a second.
// A test beat (120 bpm, made up, nothing played) stands in for a microphone.
import { AUDIO } from './sim.js';

const BANDS = [[30, 200], [200, 2000], [2000, 8000]];
const RANGE = 40, SINK = 6 / 4;   // dB mapped to 0..1; peak sinks this many dB/s
const BEAT_DECAY = 0.2, BEAT_GAP = 0.22, BEAT_JUMP = 0.18;

export class Ear {
  constructor() {
    this.mode = 'off';   // 'off' | 'mic' | 'beat'
    this.peak = [-60, -60, -60, -60];
    this.bassAvg = 0; this.lastBeat = -1; this.beat = 0;
    this.t = null;
  }

  async listen() {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.3;
    ctx.createMediaStreamSource(stream).connect(an);
    Object.assign(this, { stream, ctx, an, freq: new Float32Array(an.frequencyBinCount), wave: new Float32Array(an.fftSize), mode: 'mic' });
  }

  testBeat() { this.stop(); this.mode = 'beat'; }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
    this.stream = this.ctx = this.an = null;
    this.mode = 'off';
    AUDIO.fill(0);
  }

  // dB -> 0..1 against channel k's recent peak
  scale(k, db, dt) {
    this.peak[k] = Math.max(db, this.peak[k] - SINK * dt, -90);
    return Math.max(0, Math.min(1, (db - (this.peak[k] - RANGE)) / RANGE));
  }

  update(now) {
    const t = now / 1000, dt = this.t === null ? 0 : Math.min(0.1, t - this.t);
    this.t = t;
    if (this.mode === 'off') return;
    if (this.mode === 'beat') {
      const ph = (t * 2) % 1, kick = Math.exp(-ph / 0.08);
      AUDIO[0] = 0.4 + 0.5 * kick; AUDIO[1] = kick; AUDIO[2] = 0.35 + 0.25 * Math.sin(t * 2.1);
      AUDIO[3] = (t * 4) % 1 < 0.12 ? 0.8 : 0.1; AUDIO[4] = Math.exp(-ph / BEAT_DECAY);
      return;
    }
    const { an, freq, wave } = this;
    an.getFloatTimeDomainData(wave);
    let ss = 0;
    for (const x of wave) ss += x * x;
    AUDIO[0] = this.scale(0, 10 * Math.log10(ss / wave.length + 1e-12), dt);
    an.getFloatFrequencyData(freq);
    const hz = this.ctx.sampleRate / an.fftSize;
    BANDS.forEach(([lo, hi], b) => {
      let p = 0;
      for (let i = Math.max(1, Math.round(lo / hz)); i <= Math.min(freq.length - 1, Math.round(hi / hz)); i++) p += 10 ** (freq[i] / 10);
      AUDIO[1 + b] = this.scale(1 + b, 10 * Math.log10(p + 1e-12), dt);
    });
    // beat: the bass jumping above its average of the last half second or so
    const bass = AUDIO[1];
    if (bass - this.bassAvg > BEAT_JUMP && t - this.lastBeat > BEAT_GAP) { this.lastBeat = t; this.beat = 1; }
    else this.beat *= Math.exp(-dt / BEAT_DECAY);
    this.bassAvg += (bass - this.bassAvg) * Math.min(1, dt / 0.5);
    AUDIO[4] = this.beat;
  }
}
