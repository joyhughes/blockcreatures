// Fixed pool of evaluation workers. `spawn(onMessage)` creates one worker
// and returns a function that posts a job to it.
export class Pool {
  constructor(spawn, n) {
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = { post: null };
      w.post = spawn(msg => this.done(w, msg));
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  done(w, msg) {
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    p.resolve(msg.fit);
    this.idle.push(w);
    this.pump();
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop(), job = this.queue.shift();
      w.post(job);
    }
  }

  run(jobs) {
    let id = 0;
    return Promise.all(jobs.map(j => new Promise(resolve => {
      const job = { ...j, id: `${Date.now()}-${Math.random()}-${id++}` };
      this.pending.set(job.id, { resolve });
      this.queue.push(job);
      this.pump();
    })));
  }
}
