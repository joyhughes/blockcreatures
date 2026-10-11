// Video capture of the 3D view. Each frame, the WebGL canvas and the HUD text
// are drawn onto a 2D canvas, which a MediaRecorder captures. The text is
// HTML over the view, so it would be missing from the WebGL canvas alone.
// MP4 (H.264) where the browser can record it, WebM otherwise.

const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export class Recorder {
  constructor(src) {
    this.src = src;
    this.cv = document.createElement('canvas');
    this.g = this.cv.getContext('2d');
    this.mr = null;
  }

  get recording() { return !!this.mr; }
  static supported() { return typeof MediaRecorder !== 'undefined' && TYPES.some(t => MediaRecorder.isTypeSupported(t)); }

  start() {
    // even dimensions, which H.264 encoders require
    this.cv.width = this.src.width & ~1;
    this.cv.height = this.src.height & ~1;
    this.mime = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    this.ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    this.chunks = [];
    this.mr = new MediaRecorder(this.cv.captureStream(60), { mimeType: this.mime, videoBitsPerSecond: 16e6 });
    this.mr.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    // one piece at the end, not timesliced: with a timeslice Chrome writes a
    // fragmented MP4 whose header some players (QuickTime) read as only the
    // first second or two
    this.mr.start();
    this.t0 = performance.now();
  }

  get seconds() { return this.mr ? (performance.now() - this.t0) / 1000 : 0; }

  // Call right after the WebGL render, in the same frame, while its drawing
  // buffer is still valid.
  frame(title, sub) {
    if (!this.mr) return;
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
  }

  // -> Promise<Blob>
  stop() {
    const mr = this.mr;
    this.mr = null;
    return new Promise(res => {
      mr.onstop = () => res(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
      mr.stop();
    });
  }
}
