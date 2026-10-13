// Evaluation worker: runs fitness tests off the main thread. Works as a
// browser module worker and as a Node worker_thread.
import { initPhysics, evaluate } from './sim.js';

const ready = initPhysics();
const handle = async (job, reply) => {
  await ready;
  let fit, learned = null;
  try {
    const r = evaluate(job.task, job.genomes, job.opts);
    if (Array.isArray(r)) fit = r; else ({ fit, learned } = r);
  } catch (e) { fit = job.genomes.map(() => 0); }
  reply(learned ? { id: job.id, fit, learned } : { id: job.id, fit });
};

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = e => handle(e.data, r => self.postMessage(r));
} else {
  const { parentPort } = await import('node:worker_threads');
  parentPort.on('message', job => handle(job, r => parentPort.postMessage(r)));
}
