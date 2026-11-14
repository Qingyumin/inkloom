import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from './graph-layout.mjs';
import { LoomGraphView } from '../app/src/loom-graph.js';
import { queryGraphSnapshot } from './graph-query.mjs';
import { IncrementalVaultIndex, hydrateGraph } from './vault-index.mjs';
import { validGraphState } from './graph-state.mjs';

test('d3 layout is finite, deterministic, budgeted and cancellable without mutating graph metadata', async () => {
  const graph = { mode: 'local', nodes: [{ id: 'center', isCenter: true, radius: 10 }, { id: 'other', radius: 8 }], edges: [{ source: 'center', target: 'other' }] };
  const original = structuredClone(graph);
  const first = await layoutGraph(graph); const second = await layoutGraph(graph);
  assert.deepEqual(first.nodes, second.nodes); assert.deepEqual(graph, original);
  assert.ok(first.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(first.nodes[0].x, 0); assert.equal(first.nodes[0].y, 0);
  assert.equal(await layoutGraph(graph, () => true), null);
});

test('graph disposal releases worker, observer, pointer listeners and retained nodes exactly once', () => {
  const canvas = new EventTarget(); canvas.dataset = {}; canvas.parentElement = null; canvas.width = 300; canvas.height = 200;
  let stopped = 0; let disconnected = 0; let pointerEvents = 0;
  const worker = new EventTarget(); worker.postMessage = () => {}; worker.terminate = () => { stopped++; };
  class Observer { observe() {} disconnect() { disconnected++; } }
  const view = new LoomGraphView(canvas, { createWorker: () => worker, ResizeObserver: Observer });
  view.onPointerMove = () => { pointerEvents++; };
  view.nodes = [{ id: 'node' }]; view.edges = [{ source: 'node', target: 'other' }];
  canvas.dispatchEvent(new Event('pointermove')); assert.equal(pointerEvents, 1);
  view.dispose(); view.dispose(); canvas.dispatchEvent(new Event('pointermove'));
  assert.equal(pointerEvents, 1); assert.equal(stopped, 1); assert.equal(disconnected, 1);
  assert.equal(view.nodes.length, 0); assert.equal(view.edges.length, 0); assert.equal(canvas.width, 0);
  assert.equal(canvas.dataset.layoutState, 'disposed');
});

test('graph snapshots preserve filters, local depth and ghosts without transferring note bodies', () => {
  const index = new IncrementalVaultIndex();
  index.apply([
    { id: 'alpha', name: 'Alpha.md', relativePath: 'notes/Alpha.md', source: '# Alpha\n[[Beta]]\nPRIVATE_BODY\n#test' },
    { id: 'beta', name: 'Beta.md', relativePath: 'notes/Beta.md', source: '[[Gamma]]\n' },
    { id: 'gamma', name: 'Gamma.md', relativePath: 'Gamma.md', source: '# Gamma\n[[Future]]\n#test' },
    { id: 'orphan', name: 'Orphan.md', relativePath: 'Orphan.md', source: '# Orphan\n' },
  ]);
  const graph = hydrateGraph(index.snapshot(), id => index.notes.get(id)?.source || '');
  const local = queryGraphSnapshot(graph, 'alpha', { scope: 'local', depth: 1 });
  assert.deepEqual(local.nodes.map(node => node.id).sort(), ['alpha', 'beta']);
  const deeper = queryGraphSnapshot(graph, 'alpha', { scope: 'local', depth: 2 });
  assert.ok(deeper.nodes.some(node => node.id === 'gamma'));
  const orphans = queryGraphSnapshot(graph, 'alpha', { mode: 'orphans' }); assert.deepEqual(orphans.nodes.map(node => node.id), ['orphan']);
  const ghosts = queryGraphSnapshot(graph, 'alpha', { mode: 'ghosts' }); assert.ok(ghosts.nodes.some(node => node.ghost));
  const folder = queryGraphSnapshot(graph, 'alpha', { mode: 'folder' }); assert.equal(folder.nodes.length, 2);
  const data = JSON.stringify(queryGraphSnapshot(graph, 'alpha', {})); assert.ok(!data.includes('PRIVATE_BODY'));
  assert.ok(local.nodes.every(node => !('source' in node) && !('excerpt' in node)));
  assert.equal(local.edges[0].confidence, 'EXTRACTED');
  assert.equal(local.edges[0].relation, 'references');
  assert.equal(local.edges[0].evidence[0].sourcePath, 'notes/Alpha.md');
  assert.equal(local.edges[0].evidence[0].line, 2);
  const tagged = queryGraphSnapshot(graph, 'alpha', { scope: 'local', depth: 1, includeTagLinks: true }).edges.find(edge => edge.kind === 'tag');
  assert.equal(tagged.confidence, 'INFERRED');
  assert.deepEqual(tagged.sharedTags, ['test']);
  assert.deepEqual(tagged.evidence, []);
});

test('settled graph positions can be restored while incomplete layouts are not cached', () => {
  const makeCanvas = () => Object.assign(new EventTarget(), { dataset: {}, parentElement: null, width: 300, height: 200 });
  const worker = () => Object.assign(new EventTarget(), { postMessage() {}, terminate() {} });
  class Observer { observe() {} disconnect() {} }
  const options = { createWorker: worker, ResizeObserver: Observer };
  const view = new LoomGraphView(makeCanvas(), options);
  assert.equal(view.captureState(), null);
  const data = { nodes: [{ id: 'node', degree: 0, folder: 'notes', label: 'Node' }], edges: [], centerId: 'node' };
  view.setData(data); view.nodes[0].x = 45; view.nodes[0].y = 70; view.zoom = 1.5; view.canvas.dataset.layoutState = 'manual';
  const state = view.captureState(); view.dispose();
  const reopened = new LoomGraphView(makeCanvas(), { ...options, state }); reopened.setData(data);
  assert.equal(reopened.nodes[0].x, 45); assert.equal(reopened.nodes[0].y, 70); assert.equal(reopened.canvas.dataset.layoutState, 'manual');
  reopened.dispose();
  const mismatched = new LoomGraphView(makeCanvas(), { ...options, state: { ...state, positions: [{ id: 'foreign', x: 1, y: 2 }] } }); mismatched.setData(data);
  assert.notEqual(mismatched.canvas.dataset.layoutRestored, 'true'); mismatched.dispose();
});

test('radial and folder layouts reuse bounded d3 simulation with deterministic finite positions', async () => {
  const input = { nodes: Array.from({ length: 12 }, (_, index) => ({ id: 'node-' + index, folder: index < 6 ? 'first' : 'second', radius: 8 })), edges: [] };
  for (const layout of ['radial', 'folders']) {
    const first = await layoutGraph({ ...input, layout, spacing: 120 }); const second = await layoutGraph({ ...input, layout, spacing: 120 });
    assert.deepEqual(first.nodes, second.nodes); assert.ok(first.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))); assert.ok(first.ticks <= 140);
    assert.equal(await layoutGraph({ ...input, layout }, () => true), null);
  }
});

test('persistent graph state rejects incomplete, duplicate and nonfinite positions', () => {
  const state = { key: 'sample', state: 'ready', zoom: 1, centerX: 0, centerY: 0, positions: [{ id: 'one', x: 1, y: 2 }] };
  assert.equal(validGraphState(state), true); assert.equal(validGraphState({ ...state, state: 'running' }), false);
  assert.equal(validGraphState({ ...state, positions: [state.positions[0], state.positions[0]] }), false);
  assert.equal(validGraphState({ ...state, positions: [{ id: 'one', x: Infinity, y: 2 }] }), false);
});