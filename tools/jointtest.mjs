// Drive each DOF of each joint type with a constant effector and check the
// angle settles at the matching limit (also for mirrored parts).
import { initPhysics, Sim } from '../src/sim.js';
import { JOINT_DOFS } from '../src/genome.js';
await initPhysics();
const node = (joint, eff, shape = 'box') => ({ shape,
  dims: [0.6, 0.3, 0.3], joint, limits: [[-0.5, 0.7], [-0.5, 0.7], [-0.5, 0.7]], recur: 1, neurons: [],
  effectors: [0, 1, 2].map(k => ({ src: { t: 'k', v: 1 }, w: eff[k] })), conns: [],
});
let bad = 0;
for (const [ps, cs] of [['box', 'box'], ['sphere', 'capsule'], ['capsule', 'sphere'], ['box', 'capsule']])
for (const joint of ['revolute', 'twist', 'universal', 'bendtwist', 'twistbend', 'spherical']) {
  for (const reflect of [-1, 2, 1]) {
    for (const rot of [[0, 0, 0], [1.2, 0.5, -0.4]]) {
      for (const k of JOINT_DOFS[joint]) {
        for (const sgn of [1, -1]) {
          const eff = [0, 0, 0]; eff[k] = sgn * 1;
          const g = { nodes: [node('rigid', [0, 0, 0], ps), node(joint, eff, cs)], globals: [] };
          g.nodes[0].dims = [0.8, 0.8, 0.8];
          g.nodes[0].conns.push({ to: 1, face: 0, u: 0.2, v: -0.1, rot, scale: 1, reflect, terminal: false });
          const sim = new Sim('swim', [g]);
          const c = sim.creatures[0];
          for (let s = 0; s < 240; s++) sim.step();
          const j = c.joints[0];
          const a = j.angle[k], want = sgn > 0 ? 0.7 : -0.5;
          const ok = Math.abs(a - want) < 0.35 && !sim.failed[0];
          if (!ok) { bad++; console.log('FAIL', ps, cs, joint, 'reflect', reflect, 'rot', rot.join(','), 'axis', k, 'sign', sgn, 'angle', a.toFixed(2), 'all', j.angle.map(x => x.toFixed(2)).join(','), 'failed', sim.failed[0]); }
          sim.free();
        }
      }
    }
  }
}
console.log(bad ? `${bad} failures` : 'all joints OK');
