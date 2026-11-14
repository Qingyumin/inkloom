import { wrap, releaseProxy } from 'comlink';
import { hydrateGraph } from '../../core/vault-index.mjs';
import { TaskQueue, taskCancelled } from '../../core/task-queue.mjs';

export class VaultIndexClient {
  constructor({ createWorker = () => new Worker(new URL('./vault-index-worker.js', import.meta.url), { type: 'module', name: 'inkloom-index' }), wrapWorker = wrap, budgetMs = 30000, queryBudgetMs = 5000 } = {}) {
    this.createWorker = createWorker; this.wrapWorker = wrapWorker; this.budgetMs = budgetMs;
    this.worker = null; this.remote = null; this.scope = ''; this.accepted = new Map(); this.unconfirmed = new Set(); this.request = 0; this.pending = new Set(); this.events = null;
    this.queries = new TaskQueue({ concurrency: 2, limit: 64, budgetMs: queryBudgetMs }); this.version = null; this.querySequence = 0; this.ready = Promise.resolve();
  }

  connect() {
    if (this.worker) return;
    const worker = this.createWorker(); this.worker = worker; this.remote = this.wrapWorker(worker); this.events = new AbortController();
    const failed = event => {
      if (this.worker !== worker) return;
      event.preventDefault?.();
      for (const request of this.pending) request.reject(new Error(event.message || '后台索引Worker连接失败，请刷新知识库'));
      if (!this.pending.size) this.dispose();
    };
    worker.addEventListener('error', failed, { signal: this.events.signal }); worker.addEventListener('messageerror', failed, { signal: this.events.signal });
  }

  async update(vault, activeId, reset = false) {
    const scope = vault.vaultId || vault.vaultPath;
    if (typeof scope !== 'string' || !scope || !Array.isArray(vault.notes)) throw new Error('知识库身份或笔记列表无效');
    if (reset || scope !== this.scope) { this.dispose(); this.scope = scope; }
    this.queries.cancelAll('Index changed');
    for (const request of this.pending) request.resolve(null);
    this.connect();
    let finishUpdate; this.ready = new Promise(resolve => { finishUpdate = resolve; });
    const requestId = ++this.request;
    const current = new Map(vault.notes.map(note => [note.id, { ...note }]));
    const upserts = [];
    for (const note of current.values()) {
      const previous = this.accepted.get(note.id);
      if (!previous || this.unconfirmed.has(note.id) || ['source', 'name', 'path', 'relativePath', 'starred'].some(key => note[key] !== previous[key])) upserts.push(note);
    }
    const removed = [...this.accepted.keys()].filter(id => !current.has(id));
    for (const note of upserts) this.unconfirmed.add(note.id);
    for (const id of removed) this.unconfirmed.add(id);
    let timeout; let waiting;
    const interrupted = new Promise((resolve, reject) => { waiting = { resolve, reject }; this.pending.add(waiting); timeout = setTimeout(() => reject(new Error('后台索引超过时间预算，请刷新知识库')), this.budgetMs); });
    try {
      const result = await Promise.race([
        this.remote.update({ scope, ids: [...current.keys()], upserts, removed, activeId, reset }),
        interrupted,
      ]);
      if (requestId !== this.request || !result || result.scope !== this.scope) return null;
      this.accepted = current; this.unconfirmed.clear(); this.version = result.version;
      return hydrateGraph(result, id => current.get(id)?.source || '');
    } catch (error) {
      if (requestId === this.request) { this.dispose(); this.accepted.clear(); throw error; }
      return null;
    } finally { clearTimeout(timeout); this.pending.delete(waiting); finishUpdate(); }
  }

  query(kind, options = {}, runtime = {}) {
    return this.queries.submit(async ({ signal }) => {
      const id = 'query-' + ++this.querySequence; let remote; let rejectInterrupted;
      const interrupted = new Promise((resolve, reject) => { rejectInterrupted = reject; });
      const abort = () => {
        try { Promise.resolve(remote?.cancelQuery(id)).catch(() => {}); } catch {}
        if (signal.reason?.code === 'TASK_TIMEOUT') this.dispose();
        rejectInterrupted(signal.reason || taskCancelled());
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try {
        return await Promise.race([interrupted, (async () => {
          let pending;
          do { pending = this.ready; await pending; } while (pending !== this.ready);
          if (signal.aborted) throw taskCancelled();
          if (!this.remote || this.version === null) throw new Error('索引尚未就绪，请刷新知识库');
          remote = this.remote; const scope = this.scope; const version = this.version;
          const result = await remote.query({ id, kind, options, scope, version });
          if (signal.aborted || remote !== this.remote || scope !== this.scope || version !== this.version || result.scope !== scope || result.version !== version) throw taskCancelled('Index query changed');
          return result.result;
        })()]);
      } finally { signal.removeEventListener('abort', abort); }
    }, runtime);
  }

  dispose() {
    this.request++;
    this.queries.cancelAll('Index worker disposed'); this.version = null;
    for (const request of this.pending) request.resolve(null);
    this.events?.abort(); this.events = null;
    try { if (this.remote) Promise.resolve(this.remote[releaseProxy]()).catch(() => {}); }
    catch {}
    finally { this.worker?.terminate(); this.remote = null; this.worker = null; this.accepted.clear(); this.unconfirmed.clear(); }
  }
}