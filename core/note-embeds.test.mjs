import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedResolver, selectNoteContent, noteBlocks, ensureBlockReference, deduplicateBlockIds, expandNoteEmbeds, rebaseEmbeddedImages } from './note-embeds.mjs';

const notes = [
  { id: 'root', name: 'Root.md', relativePath: 'Root.md', source: '# Root\n\n![[Research/Source#Findings]]\n' },
  { id: 'source', name: 'Source.md', relativePath: 'Research/Source.md', source: '---\ntitle: Evidence\n---\n# Source\n\n## Findings\n\nVerified paragraph. ^evidence\n\n### Detail\n\nSupporting text.\n\n## Later\n\nNot selected.\n' },
];
test('embed selection excludes YAML and respects heading hierarchy and explicit blocks', () => {
  const resolve = createEmbedResolver(notes); const section = resolve('Research/Source#Findings', 'root');
  assert.equal(section.status, 'ready'); assert.ok(section.source.includes('Supporting text.')); assert.ok(!section.source.includes('Not selected.'));
  assert.equal(resolve('Research/Source#^evidence', 'root').source, 'Verified paragraph.');
  assert.ok(!resolve('Research/Source', 'root').source.includes('title: Evidence'));
  assert.equal(resolve('Research/Source#Missing', 'root').status, 'missing-heading');
});
test('block anchors survive editing and preserve original BOM and line endings', () => {
  const original = '\uFEFF# Title\r\n\r\nA paragraph.\r\n\r\n```md\r\nNot a block.\r\n```\r\n';
  const next = ensureBlockReference(original, original.indexOf('paragraph'), 'stable-1');
  assert.equal(next.source.replace(' ^stable-1', ''), original); assert.equal(noteBlocks(next.source)[0].id, 'stable-1');
  assert.equal(ensureBlockReference(next.source, original.indexOf('paragraph'), 'unused').changed, false);
  assert.throws(() => ensureBlockReference(original, original.indexOf('Not a block'), 'bad'), /代码/);
  assert.equal(noteBlocks('`literal ^not-block`\n').length, 0);
  const duplicated = '\uFEFFFirst copy. ^dup\r\n\r\nSecond copy. ^dup\r\n';
  const repaired = deduplicateBlockIds(duplicated);
  assert.equal(repaired.changed, true);
  assert.deepEqual(noteBlocks(repaired.source).map(item => item.id), ['dup', 'dup-1']);
  assert.equal(selectNoteContent({ source: repaired.source }, '^dup').source, 'First copy.');
  assert.equal(selectNoteContent({ source: repaired.source }, '^dup-1').source, 'Second copy.');
});
test('cycles, ambiguity, missing targets and size budgets never expand without bound', () => {
  const cycle = [{ id: 'a', name: 'A.md', source: '![[B]]' }, { id: 'b', name: 'B.md', source: '![[A]]' }];
  const result = createEmbedResolver(cycle)('A', 'a'); assert.equal(result.children[0].children[0].status, 'cycle');
  assert.equal(createEmbedResolver(notes, { maxCharacters: 4 })('Source', 'root').status, 'limit');
  assert.equal(selectNoteContent({ source: '## Same\n\nA\n\n## Same\n\nB' }, 'Same').status, 'ambiguous');
  assert.equal(createEmbedResolver(notes)('Absent', 'root').status, 'missing-note');
});
test('export materialization uses source copies and leaves fenced references literal', () => {
  const original = JSON.stringify(notes); const result = expandNoteEmbeds(notes, '![[Research/Source#^evidence]]\n\n```md\n![[Absent]]\n```', 'root');
  assert.ok(result.source.startsWith('Verified paragraph.')); assert.ok(result.source.includes('![[Absent]]')); assert.equal(result.references.length, 1); assert.equal(JSON.stringify(notes), original);
});

test('nested insertion uses parent offsets and a shared document expansion budget', () => {
  const nested = [...notes, { id: 'nested', name: 'Nested.md', source: 'Before\n\n![[Research/Source#^evidence]]\n\nAfter\n' }];
  assert.equal(expandNoteEmbeds(nested, '![[Nested]]', 'root').source, 'Before\n\nVerified paragraph.\n\nAfter\n');
  const limited = expandNoteEmbeds(nested, '![[Nested]]\n\n![[Nested]]', 'root', { maxEmbeds: 2 });
  assert.ok(limited.source.includes('(limit)')); assert.equal(limited.references.filter(reference => reference.status === 'ready').length, 2);
});

test('embedded images resolve against their source note without changing code examples', () => {
  const source = 'Text `![example](ignore.png)` and ![real](images/chart.png "Chart").\n\n> ![quoted][photo]\n> More text.\n\n[photo]: ../photo.png\n';
  const rebased = rebaseEmbeddedImages(source, 'D:/Vault/Research/Source.md');
  assert.ok(rebased.includes('`![example](ignore.png)`')); assert.ok(rebased.includes('![real](<D:/Vault/Research/images/chart.png> "Chart")')); assert.ok(rebased.includes('![quoted](<D:/Vault/photo.png>)'));
  assert.throws(() => rebaseEmbeddedImages('![remote](https://example.com/p.png)', 'D:/Vault/Source.md'), /远程图片/);
});