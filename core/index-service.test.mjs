import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexSynchronizationService } from './index-service.mjs';
import { IncrementalVaultIndex } from './vault-index.mjs';
import { encodeCachedNote, decodeCachedNote, cacheChecksum } from './index-cache.mjs';
import { VaultIndexClient } from '../app/src/vault-index-client.js';
import { createRequire } from 'node:module';
import { queryDatabasePage } from './database-query.mjs';

const { releaseProxy } = createRequire(new URL('../app/package.json', import.meta.url))('comlink');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function notes(count, prefix = 'Note') { return Array.from({ length: count }, (_, number) => ({ id: 'id-' + number, name: prefix + number + '.md', relativePath: prefix + number + '.md', source: '# ' + prefix + number + '\n' })); }
function request(scope, raw, patch = {}) { return { scope, ids: raw.map(note => note.id), upserts: raw, removed: [], activeId: raw[0]?.id || '', ...patch }; }
class Cache {
  constructor() { this.scopes = new Map(); this.loads = 0; }
  async load(scope, { reset }) { this.loads++; if (reset) this.scopes.delete(scope); return new Map(this.scopes.get(scope) || []); }
  async save(scope, records, removed) { const next = new Map(this.scopes.get(scope) || []); for (const id of removed) next.delete(id); for (const [id, note] of records) next.set(id, structuredClone(note)); this.scopes.set(scope, next); }
}

test('workspace queries share the committed index version, task pages and vault boundary', async () => {
  const service = new IndexSynchronizationService({ cache: new Cache() });
  const raw = [{ id: 'tasks', name: 'Tasks.md', relativePath: 'Tasks.md', source: '# Tasks\n' + Array.from({ length: 55 }, (_, index) => '- [ ] Task ' + index + ' @due(2026-10-23)').join('\n') }];
  const snapshot = await service.update(request('workspace-vault', raw));
  const query = { id: 'workspace-first', kind: 'workspace', scope: 'workspace-vault', version: snapshot.version, options: { today: '2026-10-23' } };
  const response = await service.query(query); assert.equal(response.result.total, 55); assert.equal(response.result.tasks.length, 50); assert.equal(response.result.vaultKey, 'workspace-vault');
  const last = await service.query({ ...query, id: 'workspace-second', options: { ...query.options, page: 1 } }); assert.equal(last.result.tasks.length, 5);
  await assert.rejects(() => service.query({ ...query, id: 'workspace-wrong-vault', scope: 'other-vault' }), /stale|cancel/i);
});

test('superseded partial updates cannot publish or leave deleted temporary notes', async () => {
  const cache = new Cache(); const paused = deferred(); const resume = deferred(); let pause = true;
  const service = new IndexSynchronizationService({ cache, chunkSize: 2, yieldTask: async () => { if (pause) { pause = false; paused.resolve(); await resume.promise; } } });
  const raw = notes(6); const first = service.update(request('vault-a', raw)); await paused.promise;
  const finalNotes = [{ ...raw[0], source: '# Final\n[[Note5]]\n' }, raw[5]];
  const second = service.update(request('vault-a', finalNotes)); resume.resolve();
  assert.equal(await first, null); const result = await second;
  assert.deepEqual(result.notes.map(note => note.id).sort(), ['id-0', 'id-5']); assert.equal(result.edges.length, 1);
  assert.deepEqual([...cache.scopes.get('vault-a').keys()].sort(), ['id-0', 'id-5']);
});

test('cancelling during initial cache load preserves valid hydration for the next request', async () => {
  const raw = notes(2); const index = new IncrementalVaultIndex(); index.apply(raw);
  const started = deferred(); const resume = deferred(); let loads = 0;
  const cache = { load: async () => { loads++; started.resolve(); await resume.promise; return new Map(index.notes); }, save: async () => {} };
  const service = new IndexSynchronizationService({ cache });
  const first = service.update(request('vault-a', raw)); await started.promise; service.cancel();
  const second = service.update(request('vault-a', raw)); resume.resolve();
  assert.equal(await first, null); const result = await second;
  assert.equal(result.counters.parsed, 0); assert.equal(result.counters.hydrated, 2); assert.equal(loads, 1);
});

test('same note IDs in different vaults and same-scope reset remain isolated', async () => {
  const cache = new Cache(); const service = new IndexSynchronizationService({ cache });
  const first = notes(2, 'Alpha'); const second = notes(1, 'Beta');
  await service.update(request('vault-a', first));
  const result = await service.update(request('vault-b', second)); assert.equal(result.notes.length, 1); assert.equal(result.notes[0].name, 'Beta0.md');
  const returned = await service.update(request('vault-a', first)); assert.equal(returned.counters.hydrated, 2);
  const reset = await service.update(request('vault-a', first, { reset: true })); assert.equal(reset.counters.parsed, 2); assert.equal(reset.counters.hydrated, 0);
  assert.equal(cache.scopes.get('vault-b').get('id-0').name, 'Beta0.md');
});

test('a cancelled cache commit cannot publish over a newer vault', async () => {
  const cache = new Cache(); const commit = deferred(); const started = deferred(); const save = cache.save.bind(cache);
  cache.save = async (scope, records, removed) => { if (scope === 'vault-a') { started.resolve(); await commit.promise; } await save(scope, records, removed); };
  const service = new IndexSynchronizationService({ cache }); const first = service.update(request('vault-a', notes(2, 'Alpha'))); await started.promise;
  const second = service.update(request('vault-b', notes(1, 'Beta'))); commit.resolve();
  assert.equal(await first, null); const result = await second; assert.equal(result.scope, 'vault-b'); assert.equal(result.notes[0].name, 'Beta0.md');
  assert.equal(cache.scopes.get('vault-a').get('id-0').name, 'Alpha0.md');
});

test('cache errors are visible while valid indexing continues, and computation failure does not poison the queue', async () => {
  let time = 0; let exceed = true;
  const service = new IndexSynchronizationService({ cache: { load: async () => { throw new Error('read blocked'); }, save: async () => { throw new Error('quota'); } }, now: () => time, budgetMs: 20, chunkSize: 2, yieldTask: async () => { if (exceed) time = 50; } });
  const raw = notes(4); await assert.rejects(() => service.update(request('vault-a', raw)), /时间预算/);
  exceed = false; time = 0; const result = await service.update(request('vault-a', raw));
  assert.equal(result.notes.length, 4); assert.match(result.cacheError, /quota/);
  await assert.rejects(() => service.update(request('vault-a', raw, { ids: ['id-0', 'id-0'] })), /身份/);
});

test('cache envelopes detect truncated JSON, altered metadata, wrong identity and old format', async () => {
  const note = notes(1)[0]; const envelope = await encodeCachedNote(note);
  assert.deepEqual(await decodeCachedNote(envelope, note.id), note);
  assert.equal(await decodeCachedNote({ ...envelope, data: envelope.data.replace('Note0', 'Wrong') }, note.id), null);
  assert.equal(await decodeCachedNote(envelope, 'other-id'), null);
  assert.equal(await decodeCachedNote(note, note.id), null);
  assert.equal(await decodeCachedNote({ format: 2, data: '{', checksum: await cacheChecksum('{') }, note.id), null);
});

function clientFixture(options = {}) {
  const workers = []; const calls = [];
  const client = new VaultIndexClient({
    ...options,
    createWorker: () => { const worker = new EventTarget(); worker.stopped = 0; worker.terminate = () => { worker.stopped++; }; workers.push(worker); return worker; },
    wrapWorker: () => ({ update: request => { const completion = deferred(); calls.push({ request, completion }); return completion.promise; }, [releaseProxy]: () => {} }),
  });
  const finish = (call, raw) => { const index = new IncrementalVaultIndex(); index.apply(raw); call.completion.resolve({ ...index.snapshot(raw[0]?.id), scope: call.request.scope }); };
  return { client, workers, calls, finish };
}

test('client cancels superseded waits immediately and rejects late same-scope responses', async () => {
  const { client, calls, finish } = clientFixture(); const raw = notes(1);
  const first = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  const latest = [{ ...raw[0], source: '# Latest\n' }]; const second = client.update({ vaultId: 'vault-a', notes: latest }, raw[0].id);
  assert.equal(await first, null); finish(calls[1], latest); const graph = await second; finish(calls[0], raw);
  assert.equal(graph.nodeMap.get(raw[0].id).source, latest[0].source); assert.equal(client.pending.size, 0); client.dispose();
});

test('client replaces cross-vault workers and disposal settles outstanding requests', async () => {
  const { client, calls, workers, finish } = clientFixture(); const raw = notes(1);
  const first = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  const second = client.update({ vaultId: 'vault-b', notes: notes(1, 'Other') }, raw[0].id);
  assert.equal(workers[0].stopped, 1); assert.equal(await first, null); finish(calls[1], notes(1, 'Other'));
  assert.equal((await second).notes[0].name, 'Other0.md');
  const pending = client.update({ vaultId: 'vault-b', notes: raw }, raw[0].id); client.dispose(); assert.equal(await pending, null); assert.equal(client.pending.size, 0); assert.equal(workers[1].stopped, 1);
});

test('worker errors fail promptly and the next request starts a clean worker', async () => {
  const { client, calls, workers, finish } = clientFixture(); const raw = notes(1);
  const failed = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  workers[0].dispatchEvent(new Event('error', { cancelable: true })); await assert.rejects(() => failed, /Worker/);
  assert.equal(workers[0].stopped, 1);
  const recovered = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id); finish(calls[1], raw);
  assert.equal((await recovered).notes.length, 1); client.dispose();
});

test('client timeout releases the stalled worker and permits a successful retry', async () => {
  const { client, calls, workers, finish } = clientFixture({ budgetMs: 10 }); const raw = notes(1);
  await assert.rejects(() => client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id), /时间预算/);
  assert.equal(workers[0].stopped, 1); assert.equal(client.pending.size, 0);
  const retry = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id); finish(calls[1], raw);
  assert.equal((await retry).notes.length, 1); client.dispose();
});

test('several queued vault switches publish only the latest matching scope', async () => {
  const gate = deferred(); const started = deferred(); let firstLoad = true;
  const cache = new Cache(); const load = cache.load.bind(cache);
  cache.load = async (...args) => { if (firstLoad) { firstLoad = false; started.resolve(); await gate.promise; } return load(...args); };
  const service = new IndexSynchronizationService({ cache });
  const first = service.update(request('vault-a', notes(3, 'Alpha'))); await started.promise;
  const middle = service.update(request('vault-b', notes(2, 'Beta')));
  const final = service.update(request('vault-a', notes(1, 'Final'))); gate.resolve();
  assert.equal(await first, null); assert.equal(await middle, null);
  const result = await final; assert.equal(result.scope, 'vault-a'); assert.equal(result.notes.length, 1); assert.equal(result.notes[0].name, 'Final0.md');
});

test('client and service restore edits and deletions cancelled back to the accepted baseline', async () => {
  for (const mode of ['edit', 'delete']) {
    const cache = new Cache(); const save = cache.save.bind(cache); const paused = deferred(); const resume = deferred(); let pause = false;
    cache.save = async (...args) => { if (pause) { pause = false; paused.resolve(); await resume.promise; } await save(...args); };
    const service = new IndexSynchronizationService({ cache });
    const client = new VaultIndexClient({
      createWorker: () => { const worker = new EventTarget(); worker.terminate = () => {}; return worker; },
      wrapWorker: () => ({ update: request => service.update(request), [releaseProxy]: () => {} }),
    });
    const raw = notes(2); await client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
    pause = true;
    const changed = mode === 'edit' ? [{ ...raw[0], source: '# Temporary\n[[Ghost]]\n' }, raw[1]] : [raw[1]];
    const first = client.update({ vaultId: 'vault-a', notes: changed }, raw[0].id); await paused.promise;
    assert.notEqual(service.index.notes.get(raw[0].id)?.source, raw[0].source);
    const restored = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id); assert.equal(await first, null); resume.resolve();
    const result = await restored;
    assert.equal(result.stats.totalNotes, 2); assert.equal(result.edges.length, 0); assert.equal(service.index.notes.get(raw[0].id).source, raw[0].source);
    assert.equal(cache.scopes.get('vault-a').get(raw[0].id).source, raw[0].source); client.dispose();
  }
});

test('idle worker failure is discarded before the next update', async () => {
  const { client, calls, workers, finish } = clientFixture(); const raw = notes(1);
  const first = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id); finish(calls[0], raw); await first;
  workers[0].dispatchEvent(new Event('messageerror')); assert.equal(workers[0].stopped, 1);
  const next = client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  assert.equal(workers.length, 2); assert.equal(calls[1].request.upserts.length, 1); finish(calls[1], raw); await next; client.dispose();
});

test('warm hydration does not rewrite valid cache and a later edit writes only its changed note', async () => {
  const cache = new Cache(); const raw = notes(4); await new IndexSynchronizationService({ cache }).update(request('vault-a', raw));
  const save = cache.save.bind(cache); const writes = [];
  cache.save = async (scope, records, removed) => { writes.push([...records.keys()]); await save(scope, records, removed); };
  const service = new IndexSynchronizationService({ cache }); const warm = await service.update(request('vault-a', raw));
  assert.equal(warm.counters.hydrated, 4); assert.equal(warm.counters.parsed, 0); assert.deepEqual(writes, []);
  const changed = [{ ...raw[0], source: '# Changed\n[[Note1]]\n' }, ...raw.slice(1)];
  const result = await service.update(request('vault-a', changed)); assert.equal(result.edges.length, 1); assert.deepEqual(writes, [[raw[0].id]]);
  assert.equal(cache.scopes.get('vault-a').get(raw[0].id).source, changed[0].source);
});

test('queries use committed index versions and return bounded permission-specific payloads', async () => {
  const service = new IndexSynchronizationService({ cache: new Cache() }); const raw = notes(40);
  const snapshot = await service.update(request('vault-a', raw));
  const query = (kind, options = {}, version = snapshot.version) => service.query({ id: kind + '-' + Math.random(), scope: 'vault-a', version, kind, options });
  const database = await query('database', { pageIndex: 1, pageSize: 10 });
  assert.equal(database.result.rows.length, 10); assert.equal(database.result.total, 40); assert.equal(database.result.pageIndex, 1);
  assert.ok(database.result.rows.every(row => /^[a-f0-9]{64}$/.test(row.version) && !('source' in row)));
  assert.deepEqual(database.result.rows.map(row => row.id), queryDatabasePage({ ...snapshot }, { pageIndex: 1, pageSize: 10 }).rows.map(row => row.id));
  const graph = await query('graph'); assert.ok(!JSON.stringify(graph.result).includes('"source":"#'));
  const limited = await query('notes', { limit: 3 }); assert.equal(limited.result.length, 3); assert.ok(limited.result.every(row => !('source' in row)));
  const read = await query('read', { id: raw[0].id }); assert.equal(read.result.source, raw[0].source);
  await assert.rejects(() => query('notes', {}, -1), { name: 'AbortError' });
  await service.update(request('vault-b', notes(1, 'Other')));
  await assert.rejects(() => query('notes'), { name: 'AbortError' });
});

test('queued index queries cancel promptly when their owner aborts', async () => {
  const service = new IndexSynchronizationService({ cache: new Cache() }); const snapshot = await service.update(request('vault-a', notes(2)));
  const paused = deferred(); service.running = paused.promise;
  const result = service.query({ id: 'cancel-me', scope: 'vault-a', version: snapshot.version, kind: 'notes' });
  service.cancelQuery('cancel-me'); await assert.rejects(result, { name: 'AbortError' }); paused.resolve();
  const next = await service.query({ id: 'next', scope: 'vault-a', version: snapshot.version, kind: 'notes' }); assert.equal(next.result.length, 2);
});

test('a hard query timeout terminates its worker and allows a new index and query', async () => {
  const raw = notes(2); const index = new IncrementalVaultIndex(); index.apply(raw); const workers = []; let stall = true;
  const client = new VaultIndexClient({
    queryBudgetMs: 10,
    createWorker: () => { const worker = new EventTarget(); worker.stopped = 0; worker.terminate = () => worker.stopped++; workers.push(worker); return worker; },
    wrapWorker: () => ({ update: async request => ({ ...index.snapshot(raw[0].id), scope: request.scope }), query: request => stall ? new Promise(() => {}) : Promise.resolve({ scope: request.scope, version: request.version, result: ['recovered'] }), cancelQuery: () => {}, [releaseProxy]: () => {} }),
  });
  await client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  await assert.rejects(() => client.query('notes'), { code: 'TASK_TIMEOUT' }); assert.equal(workers[0].stopped, 1);
  stall = false; await client.update({ vaultId: 'vault-a', notes: raw }, raw[0].id);
  assert.deepEqual(await client.query('notes'), ['recovered']); assert.equal(client.queries.diagnostics().pending, 0); client.dispose();
});