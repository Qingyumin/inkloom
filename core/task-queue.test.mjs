import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from './task-queue.mjs';

function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('queue enforces concurrency and releases its pending records', async () => {
  const queue = new TaskQueue(); const firstGate = gate(); const started = gate(); const order = [];
  const first = queue.submit(async () => { order.push('first'); started.resolve(); await firstGate.promise; return 1; }); await started.promise;
  const second = queue.submit(() => { order.push('second'); return 2; });
  assert.deepEqual(order, ['first']); assert.equal(queue.diagnostics().queued, 1); firstGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]); assert.equal(queue.diagnostics().pending, 0); queue.dispose();
});

test('same-key tasks cancel stale work and reject its late result', async () => {
  const queue = new TaskQueue(); const pause = gate(); const started = gate();
  const first = queue.submit(async ({ signal }) => { started.resolve(); await pause.promise; assert.equal(signal.aborted, true); return 'old'; }, { key: 'query' }); await started.promise;
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const next = queue.submit(() => 'latest', { key: 'query' }); await rejected; pause.resolve();
  assert.equal(await next, 'latest'); assert.equal(queue.diagnostics().cancelled, 1); queue.dispose();
});

test('abort, timeout, bounded backlog and failed jobs do not poison the queue', async () => {
  const queue = new TaskQueue({ limit: 2 }); const pause = gate(); const started = gate();
  const first = queue.submit(async () => { started.resolve(); await pause.promise; }); await started.promise;
  const controller = new AbortController(); const cancelled = queue.submit(() => 2, { signal: controller.signal });
  await assert.rejects(() => queue.submit(() => 3), { code: 'TASK_QUEUE_FULL' }); controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  pause.resolve(); await first;
  await assert.rejects(() => queue.submit(async ({ signal }) => { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); }, { budgetMs: 10 }), { code: 'TASK_TIMEOUT' });
  await assert.rejects(() => queue.submit(() => { throw new Error('intentional'); }), /intentional/);
  assert.equal(await queue.submit(() => 4), 4); queue.dispose(); await assert.rejects(() => queue.submit(() => 5), { name: 'AbortError' });
});