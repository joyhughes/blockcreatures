// Video capture of the 3D view. Each frame, the WebGL canvas and the HUD text
// are drawn onto a 2D canvas, which is encoded. The text is HTML over the
// view, so it would be missing from the WebGL canvas alone.
//
// Where the browser has WebCodecs, frames are encoded as H.264 and written by
// mp4-muxer as an ordinary MP4 with its index at the front. MediaRecorder is
// the fallback (MP4 or WebM), but Chrome's MediaRecorder MP4 is fragmented
// with a wrong duration in its header, which QuickTime and others play as
// only the first second or so.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';

const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
// H.264 High profile, levels 5.1 / 4.2 / 4.0: a high-DPI view needs 5.1
const CODECS = ['avc1.640033', 'avc1.64002a', 'avc1.640028'];
const KEY_EVERY = 2;   // seconds between keyframes
const MAX_QUEUE = 8;   // frames waiting in the encoder; past this, frames are skipped

export class Recorder {
  constructor(src) {
    this.src = src;
    this.cv = document.createElement('canvas');
    // CPU-backed: the encoder reads it every frame, and a GPU canvas made
    // that read take hundreds of ms in software rendering (8 ms this way)
    this.g = this.cv.getContext('2d', { willReadFrequently: true });
    this.active = false;
  }

  get recording() { return this.active; }
  static supported() { return typeof VideoEncoder !== 'undefined' || (typeof MediaRecorder !== 'undefined' && TYPES.some(t => MediaRecorder.isTypeSupported(t))); }

  async start() {
    // even dimensions, which H.264 encoders require
    const width = this.cv.width = this.src.width & ~1;
    const height = this.cv.height = this.src.height & ~1;
    this.active = true;
    this.t0 = performance.now();
    this.ready = false;
    this.enc = this.mr = null;
    const config = typeof VideoEncoder === 'undefined' ? null : await pickConfig(width, height);
    if (!this.active) return;   // stopped while choosing
    if (config) {
      this.ext = 'mp4';
      this.target = new ArrayBufferTarget();
      this.muxer = new Muxer({ target: this.target, video: { codec: 'avc', width, height }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
      this.enc = new VideoEncoder({
        output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
        error: e => console.error('video encoder:', e),
      });
      this.enc.configure(config);
      this.lastKey = -Infinity;
    } else {
      this.mime = TYPES.find(t => MediaRecorder.isTypeSupported(t));
      this.ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      this.chunks = [];
      this.mr = new MediaRecorder(this.cv.captureStream(60), { mimeType: this.mime, videoBitsPerSecond: 16e6 });
      this.mr.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
      this.mr.start();
    }
    this.ready = true;
  }

  get seconds() { return this.active ? (performance.now() - this.t0) / 1000 : 0; }

  // Call right after the WebGL render, in the same frame, while its drawing
  // buffer is still valid.
  frame(title, sub) {
    if (!this.active || !this.ready) return;
    const { g, cv } = this;
    g.drawImage(this.src, 0, 0, cv.width, cv.height, 0, 0, cv.width, cv.height);
    const k = this.src.width / this.src.clientWidth;   // CSS px -> canvas px
    g.save();
    g.scale(k, k);
    g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
    g.fillStyle = '#fff';
    g.textBaseline = 'top';
    g.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(title, 14, 12);
    g.globalAlpha = 0.85;
    g.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(sub, 14, 32);
    g.restore();
    if (!this.enc || this.enc.encodeQueueSize > MAX_QUEUE) return;
    // timestamps from the wall clock: the clip runs at the speed it was watched
    const t = performance.now() - this.t0;
    const vf = new VideoFrame(cv, { timestamp: Math.round(t * 1000) });
    const keyFrame = t - this.lastKey >= KEY_EVERY * 1000;
    if (keyFrame) this.lastKey = t;
    this.enc.encode(vf, { keyFrame });
    vf.close();
  }

  // -> Promise<Blob>
  async stop() {
    this.active = false;
    if (this.enc) {
      const { enc, muxer, target } = this;
      this.enc = null;
      await enc.flush();
      enc.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    }
    const mr = this.mr;
    this.mr = null;
    if (!mr) return new Blob([], { type: 'video/mp4' });
    return new Promise(res => {
      mr.onstop = () => res(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
      mr.stop();
    });
  }
}

// the first H.264 configuration the browser can encode at this size
async function pickConfig(width, height) {
  for (const codec of CODECS) {
    const config = { codec, width, height, bitrate: 16e6, framerate: 60, latencyMode: 'realtime', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* next */ }
  }
  return null;
}
