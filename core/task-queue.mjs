export function taskCancelled(message = 'Task cancelled') {
  return Object.assign(new Error(message), { name: 'AbortError', code: 'TASK_CANCELLED' });
}

export class TaskQueue {
  constructor({ concurrency = 1, limit = 64, budgetMs = 5000 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(limit) || limit < concurrency) throw new Error('Invalid task queue limits');
    this.concurrency = concurrency; this.limit = limit; this.budgetMs = budgetMs;
    this.waiting = []; this.running = new Set(); this.entries = new Set(); this.closed = false;
    this.counts = { completed: 0, cancelled: 0, failed: 0, timedOut: 0 };
  }

  submit(task, { key, signal, budgetMs = this.budgetMs } = {}) {
    if (this.closed || signal?.aborted) return Promise.reject(taskCancelled('Task queue is closed or cancelled'));
    if (typeof task !== 'function' || !Number.isFinite(budgetMs) || budgetMs <= 0) return Promise.reject(new Error('Invalid task or budget'));
    if (key !== undefined) for (const entry of this.entries) if (entry.key === key) entry.cancel(taskCancelled('Superseded task'));
    if (this.entries.size >= this.limit) return Promise.reject(Object.assign(new Error('后台任务队列已满，请稍后重试'), { code: 'TASK_QUEUE_FULL' }));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const entry = { task, key, controller, settled: false, timer: null, cancel: null };
      const finish = (error, value) => {
        if (entry.settled) return; entry.settled = true; clearTimeout(entry.timer); signal?.removeEventListener('abort', abort);
        this.entries.delete(entry);
        if (error) { this.counts[error.code === 'TASK_TIMEOUT' ? 'timedOut' : error.name === 'AbortError' ? 'cancelled' : 'failed']++; reject(error); }
        else { this.counts.completed++; resolve(value); }
      };
      const abort = () => entry.cancel(taskCancelled());
      entry.cancel = error => { finish(error); controller.abort(error); if (!this.running.has(entry)) this.waiting = this.waiting.filter(candidate => candidate !== entry); };
      entry.finish = finish;
      entry.timer = setTimeout(() => entry.cancel(Object.assign(new Error('后台查询超过时间预算'), { code: 'TASK_TIMEOUT' })), budgetMs);
      signal?.addEventListener('abort', abort, { once: true });
      this.entries.add(entry); this.waiting.push(entry); this.drain();
    });
  }

  drain() {
    while (!this.closed && this.running.size < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift(); if (entry.settled) continue; this.running.add(entry);
      Promise.resolve().then(() => { if (entry.controller.signal.aborted) throw taskCancelled(); return entry.task({ signal: entry.controller.signal }); })
        .then(value => entry.finish(null, value), error => entry.finish(error))
        .finally(() => { this.running.delete(entry); this.drain(); });
    }
  }

  cancelAll(message = 'Task queue cancelled') { for (const entry of [...this.entries]) entry.cancel(taskCancelled(message)); }
  diagnostics() { return { queued: this.waiting.length, running: this.running.size, pending: this.entries.size, ...this.counts }; }
  dispose() { this.closed = true; this.cancelAll(); }
}