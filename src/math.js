// Small vector / matrix / quaternion helpers. Matrices are 3x3 column-major
// arrays of columns: m[c] = [x, y, z], so m[0] is the local X axis in world.

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// m * v
export const mv = (m, v) => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
// m^T * v
export const mtv = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
// a * b
export const mm = (a, b) => [mv(a, b[0]), mv(a, b[1]), mv(a, b[2])];
export const det = m => dot(m[0], cross(m[1], m[2]));
// scale columns by d = [dx, dy, dz]  (m * diag(d))
export const mdiag = (m, d) => [scale(m[0], d[0]), scale(m[1], d[1]), scale(m[2], d[2])];

export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }

// Quaternions are {x, y, z, w} to match Rapier.
export function quatFromMat(m) {
  const m00 = m[0][0], m11 = m[1][1], m22 = m[2][2];
  const m01 = m[1][0], m02 = m[2][0], m10 = m[0][1], m12 = m[2][1], m20 = m[0][2], m21 = m[1][2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return { x, y, z, w };
}
export const qconj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qmul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
export function qrot(q, v) {
  const [x, y, z] = v;
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ];
}
// rotation vector (axis * angle) of a unit quaternion, angle in (-pi, pi]
export function qlog(q) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const a = 2 * Math.atan2(s, w) / s;
  return [x * a, y * a, z * a];
}

// Seeded PRNG so evolution runs are reproducible.
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = n => Math.floor(r() * n);
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.gauss = () => {
    let u = 0; while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  r.chance = p => r() < p;
  return r;
}
