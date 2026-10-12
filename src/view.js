// three.js rendering of a running Sim.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PALETTE = [0xe8b04a, 0x4fa3d9, 0xd9534f, 0x6cbf6a, 0xb07ad9, 0xe07a3f, 0x4fc1b8, 0xd96fa3, 0x9aa64a, 0x7a8cd9, 0xc9a27a, 0x5f9e8f];
const OPPONENT = [0x8a8f99, 0x6d727c, 0xa3a8b0];

export class View {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // a click (not a drag) on a creature in a crowd zooms in on it
    this.focusCell = -1;
    this.onPick = null;
    this.raycaster = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 500) return;
      down = null;
      if (this.cells.length < 2) return;
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      const k = hit ? this.cells.findIndex(c => c.meshes.includes(hit.object)) : -1;
      this.focus_(k);
      this.onPick?.(this.focusCell);
    });

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.2));
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(5, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 40 });
    this.scene.add(sun, sun.target);

    // land
    const tex = this.checker();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(200, 200);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // water: drifting motes give a sense of speed without a floor
    const n = 3000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 60;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xcfe9ff, size: 0.04, transparent: true, opacity: 0.6 }));
    this.scene.add(this.motes);

    // light source for following, cube for competition
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }));
    this.lightGlow = new THREE.PointLight(0xfff0a0, 3, 12);
    this.light.add(this.lightGlow);
    const halo = document.createElement('canvas');
    halo.width = halo.height = 128;
    const hg = halo.getContext('2d'), grad = hg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,245,180,0.9)'); grad.addColorStop(0.25, 'rgba(255,230,120,0.35)'); grad.addColorStop(1, 'rgba(255,220,100,0)');
    hg.fillStyle = grad; hg.fillRect(0, 0, 128, 128);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(halo), transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(2.2, 2.2, 1);
    this.light.add(sprite);
    this.scene.add(this.light);
    // competition: a cube, or a ball painted in segments so its rolling shows;
    // unit-size meshes scaled to the scene's ball size
    this.cubeGeo = new THREE.BoxGeometry(2, 2, 2);
    this.cubeMat = new THREE.MeshStandardMaterial({ color: 0x2b9b4a, roughness: 0.5 });
    this.ballGeo = new THREE.SphereGeometry(1, 32, 24);
    const bc = document.createElement('canvas');
    bc.width = 256; bc.height = 128;
    const bg = bc.getContext('2d');
    ['#2b9b4a', '#f2efe6', '#2b9b4a', '#f2efe6', '#2b9b4a', '#f2efe6'].forEach((c, i) => { bg.fillStyle = c; bg.fillRect(i * 256 / 6, 0, 256 / 6 + 1, 128); });
    const bt = new THREE.CanvasTexture(bc);
    bt.colorSpace = THREE.SRGBColorSpace;
    this.ballMat = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.45 });
    // stairs: pale stone
    this.stairMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.85 });
    // cooperation: the goal, a ring with a faint disc, flat on the ground
    this.goalMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.goalFill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    this.cube = new THREE.Mesh(this.cubeGeo, this.cubeMat);
    this.cube.castShadow = true;
    this.scene.add(this.cube);

    this.meshes = [];
    this.cells = [];
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.edgeGeo = new THREE.EdgesGeometry(this.boxGeo);
    this.focus = new THREE.Vector3();
    this.labels = true;
    this.setEnv('land');
  }

  checker() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c9c3b5'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#b8b1a1'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  setEnv(env) {
    this.env = env;
    const water = env === 'water';
    this.ground.visible = !water;
    this.motes.visible = water;
    this.scene.background = new THREE.Color(water ? 0x0d3b5c : 0xa9c4d8);
    this.scene.fog = water ? new THREE.FogExp2(0x0d3b5c, 0.06) : new THREE.Fog(0xa9c4d8, 25, 90);
  }

  clear() {
    for (const m of this.meshes) { this.scene.remove(m); m.material.dispose(); }
    // extras: clones of the light and cube share their materials; labels own theirs
    for (const o of this.extras || []) { this.scene.remove(o); if (o.userData.own) { o.material.map.dispose(); o.material.dispose(); } }
    for (const g of this.owned || []) g.dispose();
    this.owned = [];
    this.meshes = [];
    this.extras = [];
    this.cells = [];
    this.sim = null;
    this.light.visible = this.cube.visible = false;
  }

  // Build meshes for one sim, or for several side by side on a grid ("crowd"):
  // each runs in its own physics world, so they never touch, and is offset only
  // in the picture. labels: optional text above each sim's first creature.
  load(sims, labels = []) {
    this.clear();
    if (!Array.isArray(sims)) sims = [sims];
    this.sim = sims[0];
    this.setEnv(sims[0].task.env);
    const crowd = sims.length > 1;
    // grid spacing from the largest creature
    const sizeOf = sim => { const c = sim.creatures.find(c => c.valid); return c ? Math.max(...c.parts.map(p => Math.hypot(...p.center) + Math.max(...p.half))) : 1; };
    const big = Math.max(...sims.map(sizeOf));
    // competition: room for both contestants at their start distance
    const sc = sims[0].scene;
    const reach = sc.gap + (sc.zone !== 'none' ? 2 * big : big);
    const pair = sims[0].task.pair && !sims[0].wrestle;   // a ball between two creatures
    this.arena = !pair ? 0 : sims[0].coop ? reach + sc.goalDist + sc.goalSize : 2 * reach;
    // stairs: each cell holds its whole flight
    const flight = sims[0].statics ? Math.max(...sims.map(s => Math.max(0, ...(s.statics || []).map(b => Math.abs(b.c[0]) + b.h[0])))) : 0;
    const gap = pair ? Math.max(9, this.arena + 3) : flight ? 2 * flight + 1 : Math.max(3, 2.6 * big);
    const cols = Math.ceil(Math.sqrt(sims.length));
    this.gridSize = gap * cols;
    sims.forEach((sim, k) => {
      const off = crowd ? new THREE.Vector3((k % cols - (cols - 1) / 2) * gap, 0, (Math.floor(k / cols) - (Math.ceil(sims.length / cols) - 1) / 2) * gap) : new THREE.Vector3();
      const cell = { sim, off, meshes: [] };
      this.cells.push(cell);
      this.addCreatures(cell);
      if (sim.light) {
        if (k === 0) { cell.light = this.light; this.light.visible = true; }
        else { cell.light = this.light.clone(false); cell.light.add(this.light.children[1].clone()); this.add(cell.light); }
        cell.light.position.fromArray(sim.light).add(off);
      }
      if (sim.cube) {
        if (k === 0) { cell.cube = this.cube; this.cube.visible = true; }
        else { cell.cube = this.cube.clone(); this.add(cell.cube); }
        cell.cube.geometry = sim.ballSphere ? this.ballGeo : this.cubeGeo;
        cell.cube.material = sim.ballSphere ? this.ballMat : this.cubeMat;
        cell.cube.scale.setScalar(sim.ballR);
      }
      for (const b of sim.statics || []) {
        const geo = new THREE.BoxGeometry(2 * b.h[0], 2 * b.h[1], 2 * b.h[2]);
        this.owned.push(geo);
        const m = new THREE.Mesh(geo, this.stairMat);
        m.position.fromArray(b.c).add(off);
        m.castShadow = m.receiveShadow = true;
        this.add(m);
      }
      // the cooperation goal, or the wrestling ring
      if (sim.goal || sim.ring) {
        const R = sim.goal ? sim.scene.goalSize : sim.ring, at = sim.goal || [0, 0, 0], ring = new THREE.RingGeometry(Math.max(0, R - 0.06), R, 64), disc = new THREE.CircleGeometry(R, 64);
        this.owned.push(ring, disc);
        for (const [geo, mat, y] of [[disc, this.goalFill, 0.004], [ring, this.goalMat, 0.006]]) {
          const m = new THREE.Mesh(geo, mat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(at[0], y, at[2]).add(off);
          this.add(m);
        }
      }
      // Labels: in small crowds, a fixed size on screen; in bigger ones they
      // shrink with distance like the creatures do, and past 25 show only
      // the short form (fitness), or the grid becomes a wall of text.
      if (labels[k]) {
        const L = labels[k], many = sims.length > 25;
        cell.label = sims.length > 9
          ? this.textSprite(many && L.short ? L.short : L.text, L.color, 0.12 * gap, true)
          : this.textSprite(L.text, L.color, 0.03);
        cell.label.visible = this.labels;
        this.add(cell.label);
      }
    });
    // shadows must cover the whole grid
    const ext = crowd ? this.gridSize / 2 + gap : 8;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: 40 + ext });
    this.sun.shadow.camera.updateProjectionMatrix();

    this.focusCell = -1;
    const goal = this.goal();
    if (goal) {
      this.focus.copy(goal);
      this.controls.target.copy(this.focus);
      const sim = sims[0];
      const d = crowd ? Math.max(6, 0.9 * this.gridSize + 2 * big) : pair ? Math.max(3.5, (sim.coop ? 1 : 0.7) * this.arena) : sim.ring ? Math.max(4, 1.6 * sim.ring + 2 * big) : Math.max(4, 3 * big);
      this.crowdDist = d;
      this.wantDist = undefined;
      if (sim.light && !crowd) {
        // look past the creature toward the light
        const dir = new THREE.Vector3().fromArray(sim.light).sub(this.focus);
        dir.y = 0; dir.normalize();
        this.camera.position.copy(this.focus).addScaledVector(dir, -Math.max(5.5, d)).add(new THREE.Vector3(0, 3, 0));
      } else {
        this.camera.position.set(this.focus.x + d * 0.55, this.focus.y + d * (crowd ? 0.75 : 0.45), this.focus.z + d * 0.9);
      }
      // thinner fog for a crowd viewed from further away
      if (crowd && this.scene.fog.isFogExp2) this.scene.fog.density = 0.06 * Math.min(1, 9 / d);
      if (crowd && this.scene.fog.isFog) this.scene.fog.far = Math.max(90, 3 * d);
    }
  }

  add(o) { this.scene.add(o); this.extras.push(o); }

  setLabels(on) {
    this.labels = on;
    this.cells.forEach((c, k) => { if (c.label) c.label.visible = on && (this.focusCell < 0 || k === this.focusCell); });
  }

  // Zoom in on one creature of a crowd (k), or back out to all of them (-1).
  focus_(k, instant = false) {
    if (k === this.focusCell && !instant) return;
    this.focusCell = k;
    this.setLabels(this.labels);
    const cell = this.cells[k];
    if (cell) {
      const c0 = cell.sim.creatures.find(c => c.valid);
      const size = c0 ? Math.max(...c0.parts.map(p => Math.hypot(...p.center) + Math.max(...p.half))) : 1;
      this.wantDist = Math.max(3, 3 * size);
    } else this.wantDist = this.crowdDist;
    if (instant) { const g = this.goal(); if (g) this.focus.copy(g); }
  }

  addCreatures(cell) {
    cell.sim.creatures.forEach((c, ci) => {
      if (!c.valid) return;
      c.parts.forEach(p => {
        const col = ci === 0 ? PALETTE[p.node % PALETTE.length] : OPPONENT[p.node % OPPONENT.length];
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
        let mesh;
        if (!p.shape || p.shape === 'box') {
          mesh = new THREE.Mesh(this.boxGeo, mat);
          mesh.scale.set(p.half[0] * 2, p.half[1] * 2, p.half[2] * 2);
          if (this.cells.length < 40) mesh.add(new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })));
        } else {
          let geo;
          if (p.shape === 'sphere') geo = new THREE.SphereGeometry(p.half[0], 24, 16);
          else if (p.shape === 'capsule') geo = new THREE.CapsuleGeometry(p.half[1], 2 * (p.half[0] - p.half[1]), 8, 18).rotateZ(-Math.PI / 2);
          else {
            const r = p.half[(p.cyl + 1) % 3];
            geo = new THREE.CylinderGeometry(r, r, 2 * p.half[p.cyl], 32);
            if (p.cyl === 0) geo.rotateZ(-Math.PI / 2);
          }
          this.owned.push(geo);
          mesh = new THREE.Mesh(geo, mat);
        }
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData = { creature: ci, part: p.index };
        this.scene.add(mesh);
        this.meshes.push(mesh);
        cell.meshes.push(mesh);
      });
    });
  }

  // A label that keeps the same size on screen.
  // h: height as a fraction of the screen, or in metres when world is true
  textSprite(text, color = '#ffffff', h = 0.032, world = false) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const font = '600 40px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.font = font;
    c.width = Math.ceil(g.measureText(text).width) + 24; c.height = 56;
    g.font = font;
    g.fillStyle = 'rgba(20,23,28,.72)';
    g.beginPath(); g.roundRect(0, 0, c.width, c.height, 14); g.fill();
    g.fillStyle = color; g.textBaseline = 'middle';
    g.fillText(text, 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: world, depthTest: world, transparent: true, fog: false }));
    sp.scale.set(h * c.width / c.height, h, 1);
    sp.center.set(0.5, 0);
    sp.renderOrder = 10;
    sp.userData.own = true;
    return sp;
  }

  // what the camera follows: the cube in competition, else the creature, or
  // in a crowd the middle of the grid plus the creatures' average drift
  goal() {
    const cells = this.cells;
    if (!cells.length) return null;
    if (cells.length === 1 || cells[this.focusCell]) {
      const cell = cells.length === 1 ? cells[0] : cells[this.focusCell], sim = cell.sim;
      if (sim.cube && sim.task.pair) { const t = sim.cube.translation(); return new THREE.Vector3(t.x, t.y, t.z).add(cell.off); }
      // wrestling: midway between the two
      if (sim.wrestle && sim.creatures.length === 2 && sim.creatures.every(c => c.valid)) {
        const [a, b] = sim.creatures.map(c => c.com());
        return new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2).add(cell.off);
      }
      const c0 = sim.creatures.find(c => c.valid);
      return c0 ? new THREE.Vector3().fromArray(c0.com()).add(cell.off) : null;
    }
    const sum = new THREE.Vector3();
    let n = 0;
    for (const cell of cells) {
      const c0 = cell.sim.creatures.find(c => c.valid);
      if (!c0) continue;
      sum.add(new THREE.Vector3().fromArray(c0.com()).add(cell.off)); n++;
    }
    return n ? sum.divideScalar(n) : null;
  }

  update() {
    for (const cell of this.cells) {
      const { sim, off } = cell;
      for (const m of cell.meshes) {
        const { creature, part } = m.userData;
        const { c, q } = sim.creatures[creature].partPose(part);
        m.position.set(c[0] + off.x, c[1] + off.y, c[2] + off.z);
        m.quaternion.set(q.x, q.y, q.z, q.w);
      }
      if (cell.cube) {
        const t = sim.cube.translation(), r = sim.cube.rotation();
        cell.cube.position.set(t.x + off.x, t.y + off.y, t.z + off.z);
        cell.cube.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (cell.label) {
        const c0 = sim.creatures.find(c => c.valid);
        if (c0) {
          const com = c0.com();
          const top = Math.max(...c0.parts.map(p => c0.partPose(p.index).c[1] + Math.max(...p.half)));
          cell.label.position.set(com[0] + off.x, top + 0.25 + off.y, com[2] + off.z);
        }
      }
    }
    const goal = this.goal();
    if (goal) {
      const prev = this.focus.clone();
      this.focus.lerp(goal, this.wantDist !== undefined ? 0.2 : 0.08);   // faster while zooming
      const delta = this.focus.clone().sub(prev);
      this.camera.position.add(delta);
      this.controls.target.copy(this.focus);
      // glide toward the wanted viewing distance after a zoom in or out
      if (this.wantDist !== undefined) {
        const off = this.camera.position.clone().sub(this.focus);
        const L = off.length(), L2 = L + (this.wantDist - L) * 0.2;
        this.camera.position.copy(this.focus).addScaledVector(off.normalize(), L2);
        if (Math.abs(L2 - this.wantDist) < 0.02) this.wantDist = undefined;
      }
      this.sun.position.set(this.focus.x + 5, this.focus.y + 10, this.focus.z + 4);
      this.sun.target.position.copy(this.focus);
    }
  }

  render() {
    const cv = this.renderer.domElement;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.floor(w * this.renderer.getPixelRatio()) || cv.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
