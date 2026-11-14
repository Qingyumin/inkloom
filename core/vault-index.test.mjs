import test from 'node:test';
import assert from 'node:assert/strict';
import { IncrementalVaultIndex, hydrateGraph } from './vault-index.mjs';
import { buildVaultGraph } from './vault-graph.mjs';

const fixture = () => [
  { id: 'one', name: 'Topic.md', relativePath: 'one/Topic.md', path: '/one/Topic.md', source: '---\naliases: [Subject]\ntags: [test]\n---\n# Topic\nBody\n' },
  { id: 'two', name: 'Ref.md', relativePath: 'one/Ref.md', path: '/one/Ref.md', source: '# Ref\n[[Topic#Section|Alias]]\n[[Future]]\nSubject is mentioned.\n' },
  { id: 'three', name: 'Topic.md', relativePath: 'two/Topic.md', path: '/two/Topic.md', source: '# Other\n' },
  { id: 'four', name: 'Ref.md', relativePath: 'two/Ref.md', path: '/two/Ref.md', source: '[[Topic]]\n' },
];

function projection(graph) {
  return {
    nodes: graph.nodes.map(node => [node.id, node.degree, node.ghost, node.orphan]).sort(),
    edges: graph.edges.map(edge => [edge.source, edge.target]).sort(),
    backlinks: [...graph.backlinksByNote].filter(([, links]) => links.length).map(([id, links]) => [id, links.map(link => [link.sourceId, link.from]).sort()]).sort(),
  };
}

test('incremental graph matches legacy graph for creation, body edits, aliases, ghosts and deletion', () => {
  const raw = fixture(); const index = new IncrementalVaultIndex(); index.apply(raw);
  const compare = () => assert.deepEqual(projection(hydrateGraph(index.snapshot('one'))), projection(buildVaultGraph(raw)));
  compare();
  const before = { ...index.counters };
  raw[1] = { ...raw[1], source: raw[1].source + 'More text\n' }; index.apply([raw[1]]); compare();
  assert.equal(index.counters.parsed - before.parsed, 1);
  assert.equal(index.counters.relinked - before.relinked, 1);
  raw.push({ id: 'future', name: 'Future.md', relativePath: 'Future.md', path: '/Future.md', source: '# Future\n' }); index.apply([raw.at(-1)]); compare();
  const changed = { ...raw[0], source: raw[0].source.replace('Subject', 'Alias2') }; raw[0] = changed; index.apply([changed]); compare();
  raw.splice(2, 1); index.apply([], ['three']); compare();
});

test('unchanged notes are not reparsed, cached notes hydrate, and snapshots do not include full text', () => {
  const raw = fixture(); const index = new IncrementalVaultIndex(); index.apply(raw);
  index.apply(raw); assert.equal(index.counters.parsed, 4); assert.equal(index.counters.unchanged, 4);
  const cache = new Map(index.notes); const restored = new IncrementalVaultIndex(); restored.apply(raw, [], cache);
  assert.equal(restored.counters.parsed, 0); assert.equal(restored.counters.hydrated, 4);
  const snapshot = restored.snapshot('one'); assert.equal('source' in snapshot.notes[0], false);
  const graph = hydrateGraph(snapshot, id => raw.find(note => note.id === id).source);
  assert.equal(graph.nodeMap.get('one').source, raw[0].source);
  assert.equal(graph.resolveTargetId('Topic', 'two'), 'one');
  assert.equal(graph.resolveTargetId('Topic', 'four'), 'three');
  assert.equal(graph.unlinkedMentionsByNote.get('one').length, 1);
});

test('ten thousand notes only reparse and relink the modified note and its real dependents', () => {
  const raw = Array.from({ length: 10000 }, (_, index) => ({ id: 'id-' + index, name: 'Note-' + index + '.md', relativePath: 'Note-' + index + '.md', source: '# Note ' + index + '\n' + (index > 0 ? '[[Note-' + (index - 1) + ']]\n' : '') }));
  const graph = new IncrementalVaultIndex(); graph.apply(raw);
  const before = { ...graph.counters };
  graph.apply([{ ...raw[5000], source: raw[5000].source + 'Changed\n' }]);
  assert.equal(graph.counters.parsed - before.parsed, 1);
  assert.ok(graph.counters.relinked - before.relinked <= 2);
  assert.equal(graph.edges.size, 9999);
});

test('malformed cached links, headings and metadata fall back to authoritative source parsing', () => {
  const raw = fixture(); const original = new IncrementalVaultIndex(); original.apply(raw);
  for (const change of [
    { wikiLinks: [null] }, { wikiLinks: [{ target: 'Wrong' }] }, { aliases: [null] }, { tags: [7] },
    { headings: [{ text: 'Bad', level: 99 }] }, { bodyFrom: -1 }, { metadata: [] }, { title: {} },
  ]) {
    const cached = new Map(original.notes); cached.set('two', { ...cached.get('two'), ...change });
    const restored = new IncrementalVaultIndex(); restored.apply(raw, [], cached);
    assert.equal(restored.counters.rejectedCache, 1); assert.equal(restored.counters.parsed, 1);
    assert.deepEqual(projection(hydrateGraph(restored.snapshot('one'))), projection(buildVaultGraph(raw)));
  }
});