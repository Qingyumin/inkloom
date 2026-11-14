import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVaultTree, flattenVaultTree } from './vault-tree.mjs';

const notes = [
  { id: 'root', name: 'Home.md', relativePath: 'Home.md', title: 'Home', tags: [] },
  { id: 'one', name: 'Plan.md', relativePath: 'Projects/Client/Plan.md', title: 'Plan', tags: ['work'] },
  { id: 'two', name: 'Plan.md', relativePath: 'Projects/Internal/Plan.md', title: 'Plan', tags: [] },
];

test('real path segments form hierarchical folders with isolated same-name notes', () => {
  const tree = buildVaultTree(notes, { folders: ['Archive/Empty'] }); const rows = flattenVaultTree(tree).rows;
  assert.equal(tree.count, 3); assert.equal(rows.find(row => row.path === 'Projects/Client').depth, 1);
  assert.equal(rows.find(row => row.id === 'one').depth, 2); assert.equal(rows.find(row => row.id === 'two').parent, 'Projects/Internal');
  assert.ok(rows.some(row => row.path === 'Archive/Empty' && row.count === 0));
});

test('collapsed branches hide descendants while search and active reveal remain reachable', () => {
  const tree = buildVaultTree(notes);
  assert.ok(!flattenVaultTree(tree, { collapsed: ['Projects'] }).rows.some(row => row.id === 'one'));
  assert.ok(flattenVaultTree(tree, { collapsed: ['Projects'], revealId: 'one' }).rows.some(row => row.id === 'one'));
  const result = flattenVaultTree(buildVaultTree(notes, { query: 'Client' }), { collapsed: ['Projects'], filtering: true });
  assert.equal(result.totalNotes, 1); assert.equal(result.rows.at(-1).id, 'one');
});

test('tree limits note rows without dropping query counts or accepting escaped paths', () => {
  const tree = buildVaultTree([...notes, { id: 'bad', relativePath: '../escape.md' }]); const result = flattenVaultTree(tree, { limit: 1 });
  assert.equal(result.shownNotes, 1); assert.equal(result.totalNotes, 3); assert.ok(!result.rows.some(row => row.id === 'bad'));
});