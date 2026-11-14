import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDatabasePage, normalizeSavedDatabaseViews, saveDatabaseViewPreset, renameDatabaseViewPreset, deleteDatabaseViewPreset, reorderDatabaseViewPresets, recordMruVisit, computeBatchTagPatch, resolveShiftRangeIds } from './database-query.mjs';
import { IncrementalVaultIndex, hydrateGraph } from './vault-index.mjs';

function graph() {
  const index = new IncrementalVaultIndex();
  index.apply(Array.from({ length: 135 }, (_, number) => ({ id: 'note-' + number, name: 'Note-' + String(number).padStart(3, '0') + '.md', relativePath: 'notes/Note-' + String(number).padStart(3, '0') + '.md', source: '---\nstatus: ' + (number % 2 ? 'Done' : 'Draft') + '\ntags: [test]\n---\nPrivate body\n' })));
  return hydrateGraph(index.snapshot());
}

test('paged database metadata is bounded, sorted, grouped and contains no source', () => {
  const result = queryDatabasePage(graph(), { pageIndex: 2, pageSize: 50, sortBy: 'title', sortDir: 'asc' });
  assert.equal(result.total, 135); assert.equal(result.rows.length, 35); assert.equal(result.pageIndex, 2); assert.equal(result.pageCount, 3);
  assert.equal(result.rows[0].id, 'note-100'); assert.equal(result.columns.reduce((count, column) => count + column.items.length, 0), 35);
  assert.ok(result.rows.every(row => !('source' in row))); assert.ok(result.columns.every(column => column.items.length <= column.count));
  assert.equal(queryDatabasePage(graph(), { pageSize: 100000 }).rows.length, 50);
});

test('filters reset out-of-range pages without losing options or returning stale rows', () => {
  const result = queryDatabasePage(graph(), { query: 'Note-134', pageIndex: 99, pageSize: 25 });
  assert.equal(result.pageIndex, 0); assert.equal(result.total, 1); assert.equal(result.rows[0].id, 'note-134');
  assert.ok(result.tags.includes('test')); assert.ok(result.statuses.includes('Done'));
  const empty = queryDatabasePage(graph(), { query: 'missing', pageIndex: 2 });
  assert.equal(empty.rows.length, 0); assert.equal(empty.pageIndex, 0); assert.equal(empty.pageCount, 1);
});

test('multi-dimensional database query aggregates groups, task progress and numeric custom properties', () => {
  const index = new IncrementalVaultIndex();
  index.apply([
    { id: 'proj-alpha', name: 'Alpha.md', relativePath: 'projects/Alpha.md', source: '---\ntitle: Alpha Project\ncategory: project\nstatus: 进行中\ntarget_words: 5000\n---\n- [x] Kickoff\n- [ ] Review\n' },
    { id: 'chap-1', name: 'Chapter1.md', relativePath: 'chapters/Chapter1.md', source: '---\ntitle: Chapter 1\ncategory: chapter\nproject: proj-alpha\nstatus: 已完成\ntarget_words: 2000\n---\n- [x] Draft\n' },
    { id: 'chap-2', name: 'Chapter2.md', relativePath: 'chapters/Chapter2.md', source: '---\ntitle: Chapter 2\ncategory: chapter\nproject: proj-alpha\nstatus: 草稿\ntarget_words: 3000\n---\n- [ ] Outline\n' },
  ]);
  const hydrated = hydrateGraph(index.snapshot(), id => index.notes.get(id).source);
  const grouped = queryDatabasePage(hydrated, { groupBy: 'project', propertyKey: 'target_words', sortBy: 'property', sortDir: 'asc' });
  assert.equal(grouped.total, 3);
  assert.equal(grouped.rows[0].id, 'chap-1');
  assert.equal(grouped.rows[0].projectTitle, 'Alpha Project');
  assert.equal(grouped.summary.completed, 1);
  assert.equal(grouped.summary.taskCount, 4);
  assert.equal(grouped.summary.taskDone, 2);
  assert.equal(grouped.summary.numericSum, 10000);
  assert.equal(grouped.groups.length, 1);
  assert.equal(grouped.groups[0].label, 'Alpha Project');
  assert.equal(grouped.groups[0].count, 3);
  assert.equal(grouped.groups[0].numericSum, 10000);
  const filtered = queryDatabasePage(hydrated, { propertyKey: 'category', propertyValue: 'chapter' });
  assert.equal(filtered.total, 2);
  const formulaPage = queryDatabasePage(hydrated, { propertyKey: 'formula:task_progress', sortBy: 'property', sortDir: 'desc' });
  assert.equal(formulaPage.isDerivedProperty, true);
  assert.equal(formulaPage.rows[0].id, 'chap-1');
  assert.equal(formulaPage.rows[0].propertyValue, '100');
  const rollupPage = queryDatabasePage(hydrated, { propertyKey: 'rollup:project_notes' });
  assert.equal(rollupPage.rows.find(r => r.id === 'proj-alpha').propertyValue, '2');

  // ITER-176 (1.7.6): Saved View Tabs (save, rename, reorder, delete, and combined filter restoration)
  const initialViews = normalizeSavedDatabaseViews([]);
  assert.equal(initialViews.length, 3);
  assert.equal(initialViews[0].id, 'all-notes');
  assert.equal(initialViews[1].name, '进行中项目');
  assert.equal(initialViews[2].name, '待读文献');

  const { views: afterSave, savedView } = saveDatabaseViewPreset(initialViews, {
    name: '高优章节任务',
    mode: 'board',
    groupBy: 'project',
    propertyKey: 'formula:task_progress',
    propertyValue: '100',
    sortBy: 'property',
    sortDir: 'desc',
  });
  assert.equal(afterSave.length, 4);
  assert.equal(savedView.name, '高优章节任务');
  assert.equal(savedView.mode, 'board');
  assert.equal(savedView.propertyKey, 'formula:task_progress');

  const { views: afterRename, renamedView } = renameDatabaseViewPreset(afterSave, savedView.id, '已完成章节视图');
  assert.equal(renamedView.name, '已完成章节视图');
  assert.throws(() => renameDatabaseViewPreset(afterRename, 'all-notes', '改名'), /不可重命名/);

  const reordered = reorderDatabaseViewPresets(afterRename, savedView.id, 'active-projects');
  assert.equal(reordered[1].id, savedView.id);

  const { views: afterDelete } = deleteDatabaseViewPreset(reordered, savedView.id);
  assert.equal(afterDelete.length, 3);
  assert.throws(() => deleteDatabaseViewPreset(afterDelete, 'all-notes'), /不可删除/);

  // ITER-177 (1.7.7): Ctrl+K MRU stack & Shift/Ctrl multi-select batch tag/status/range operations
  let mru = recordMruVisit([], { kind: 'note', noteId: 'chap-1', title: 'Chapter 1', folder: 'chapters' });
  mru = recordMruVisit(mru, { kind: 'raw', relativePath: 'raw/智能制造与双链溯源规范.pdf', title: '智能制造与双链溯源规范', page: 2 });
  mru = recordMruVisit(mru, { kind: 'note', noteId: 'proj-alpha', title: 'Alpha Project', folder: 'projects', heading: 'Kickoff' });
  assert.equal(mru.length, 3);
  assert.equal(mru[0].label, 'Alpha Project # Kickoff');
  assert.equal(mru[1].label, '智能制造与双链溯源规范 · 第 2 页');
  mru = recordMruVisit(mru, { kind: 'raw', relativePath: 'raw/智能制造与双链溯源规范.pdf', title: '智能制造与双链溯源规范', page: 5 });
  assert.equal(mru.length, 3);
  assert.equal(mru[0].page, 5);

  const tagsAdded = computeBatchTagPatch(['research', 'draft'], { addTag: '#priority-high' });
  assert.deepEqual(tagsAdded, ['research', 'draft', 'priority-high']);
  const tagsRemoved = computeBatchTagPatch(tagsAdded, { removeTag: '#draft' });
  assert.deepEqual(tagsRemoved, ['research', 'priority-high']);

  const rangeIds = resolveShiftRangeIds(['n1', 'n2', 'n3', 'n4', 'n5'], 'n4', 'n2');
  assert.deepEqual(rangeIds, ['n2', 'n3', 'n4']);
});