import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMarkdownTasks, toggleMarkdownTask, updateMarkdownTask, captureSource, validDay, workspaceLayout, queryWorkspace } from './workspace-model.mjs';
import { nextTaskDue } from './task-planning.mjs';

test('recurrence respects weekdays, weekly anchors, missing month days and inclusive end dates', () => {
  const base = { state: 'todo', priority: 'normal', every: 1, due: '2026-10-23', repeat: 'weekdays' };
  assert.equal(nextTaskDue(base), '2026-10-26');
  assert.equal(nextTaskDue({ ...base, repeat: 'monthly', due: '2026-01-31' }), '2026-03-31');
  assert.equal(nextTaskDue({ ...base, repeat: 'yearly', due: '2024-02-29' }), '2028-02-29');
  assert.equal(nextTaskDue({ ...base, until: '2026-10-23' }), '');
  assert.equal(nextTaskDue({ ...base, repeat: 'weekly', days: 'MO,WE', start: '2026-10-19', due: '2026-10-21', every: 2 }), '2026-11-02');
});

test('repeat completion writes one successor, preserves child content and refuses destructive undo', () => {
  const original = '\uFEFF# Plan\r\n\r\n- [ ] Review @due(2026-10-23) @repeat(daily)\r\n  Detail stays here.\r\n  - [ ] Subtask\r\n\r\n- [ ] Other\r\n';
  const done = toggleMarkdownTask(original, extractMarkdownTasks(original)[0], true); const tasks = extractMarkdownTasks(done);
  assert.equal(tasks.length, 4); assert.equal(tasks[0].done, true); assert.equal(tasks[0].title, 'Review'); const successor = tasks.find(task => task.afterId); assert.equal(successor.due, '2026-10-24');
  assert.ok(done.includes('  Detail stays here.\r\n  - [ ] Subtask\r\n')); assert.equal(toggleMarkdownTask(done, tasks[0], true), done);
  const undone = toggleMarkdownTask(done, tasks[0], false); assert.equal(extractMarkdownTasks(undone).length, 3); assert.ok(undone.startsWith('\uFEFF')); assert.ok(!/(?<!\r)\n/.test(undone));
  const redone = toggleMarkdownTask(undone, extractMarkdownTasks(undone)[0], true); assert.equal(extractMarkdownTasks(redone).length, 4);
  const changed = done.replace(successor.raw, successor.raw.replace('Review', 'Changed')); assert.throws(() => toggleMarkdownTask(changed, extractMarkdownTasks(changed)[0], false), /下一次任务/);
});

test('task field edits preserve code literals and unrelated text, and recognize in-progress state', () => {
  const source = '# Tasks\n\n- [ ] Fix `@due(2000-01-01)` @due(2026-10-23)\n\nUnrelated.\n'; const task = extractMarkdownTasks(source)[0];
  assert.equal(task.title, 'Fix @due(2000-01-01)');
  assert.equal(extractMarkdownTasks('- [ ] Head\n  Description @due(2026-10-25)\n')[0].due, '');
  const edited = updateMarkdownTask(source, task, { state: 'doing', due: '2026-10-25' }); assert.ok(edited.includes('`@due(2000-01-01)`')); assert.ok(edited.endsWith('Unrelated.\n')); assert.equal(extractMarkdownTasks(edited)[0].state, 'doing');
  assert.throws(() => updateMarkdownTask(edited, task, { state: 'done' }), /变化/);
});

test('Markdown parser indexes real nested task items but excludes fenced, indented and YAML examples', () => {
  const source = '\uFEFF---\r\ntags:\r\n- [ ] not a task\r\n---\r\n\r\n- [ ] Parent @due(2026-10-23) @time(09:30)\r\n    - [X] Nested\r\n\r\n```md\r\n- [ ] Example\r\n```\r\n\r\n    - [ ] Indented code\r\n\r\n> - [ ] Quoted\r\n';
  const tasks = extractMarkdownTasks(source); assert.equal(tasks.length, 3); assert.equal(tasks[0].due, '2026-10-23'); assert.equal(tasks[0].time, '09:30'); assert.equal(tasks[1].done, true);
  const next = toggleMarkdownTask(source, tasks[0], true); assert.equal(next.replace('[x] Parent', '[ ] Parent'), source); assert.equal(next[0], '\uFEFF');
  assert.throws(() => toggleMarkdownTask(source.replace('Parent', 'Changed'), tasks[0], true), /changed/);
});

test('due validation and metadata respect code spans and calendar dates', () => {
  assert.equal(validDay('2026-02-29'), false); assert.equal(validDay('2028-02-29'), true);
  const tasks = extractMarkdownTasks('- [ ] Example `@due(2026-10-23)`\n- [ ] Bad @due(2026-02-30)\n'); assert.equal(tasks[0].due, ''); assert.equal(tasks[1].due, '');
  assert.throws(() => captureSource({ kind: 'task', title: 'Task', created: '2026-10-23T12:00:00', time: '12:00' }), /reminder/);
  const task = extractMarkdownTasks(captureSource({ kind: 'task', title: 'Call: client', text: 'Details', due: '2026-10-24', priority: 'high', created: '2026-10-23T12:00:00' }))[0]; assert.equal(task.title, 'Call: client'); assert.equal(task.priority, 'high');
});

test('dashboard uses bounded validated per-vault layout and complete task counts with pages', () => {
  assert.equal(workspaceLayout([{ id: 'script', x: 0, y: 0, w: 9, h: 3 }]).length, 6);
  assert.equal(workspaceLayout([{ id: 'tasks', x: 0, y: 0, w: 6, h: 8 }])[0].h, 8);
  assert.equal(workspaceLayout([{ id: 'tasks', w: 6, h: 8 }])[0].x, 0);
  for (const template of ['balanced', 'focus', 'writing']) {
    const layout = workspaceLayout(null, template);
    for (const first of layout) for (const second of layout) if (first !== second) assert.ok(first.x + first.w <= second.x || second.x + second.w <= first.x || first.y + first.h <= second.y || second.y + second.h <= first.y, template + ' overlaps ' + first.id + ' and ' + second.id);
  }
  const tasks = Array.from({ length: 60 }, (_, index) => ({ offset: index, title: 'Task ' + index, done: index === 0, due: '2026-10-22', priority: 'normal' }));
  const graph = { notes: [{ id: 'one', properties: [], metadata: {}, title: 'One', tasks }] }; const result = queryWorkspace(graph, { today: '2026-10-23' });
  assert.equal(result.total, 59); assert.equal(result.tasks.length, 50); assert.equal(result.counts.overdue, 59); assert.equal(queryWorkspace(graph, { page: 1, today: '2026-10-23' }).tasks.length, 9);
});

test('research queries retain provenance metadata, filter categories and bound pages without source text', () => {
  const notes = Array.from({ length: 32 }, (_, index) => ({ id: 'source-' + index, title: 'Source ' + index, relativePath: 'sources/' + index + '.md', metadata: { category: 'source' }, status: 'reading', properties: [{ key: 'author', value: 'Known author' }, { key: 'source_type', value: 'paper' }, { key: 'year', value: '2026' }, { key: 'source_locator', value: 'exact-identifier' }], source: 'private source content', tasks: [] }));
  notes.push({ ...notes[0], id: 'excerpt', metadata: { category: 'excerpt' } }); const graph = { notes, nodeMap: new Map(notes.map(note => [note.id, note])) };
  const first = queryWorkspace(graph, { researchMode: 'source', researchText: 'KNOWN AUTHOR' }); assert.equal(first.researchTotal, 32); assert.equal(first.research.length, 25); assert.equal(first.research[0].sourceType, 'paper'); assert.equal(first.research[0].year, '2026'); assert.equal(first.research[0].locator, 'exact-identifier'); assert.equal(first.research[0].relativePath, 'sources/0.md'); assert.equal('source' in first.research[0], false);
  assert.equal(queryWorkspace(graph, { researchMode: 'source', researchPage: 10 }).research.length, 7); assert.equal(queryWorkspace(graph, { researchMode: 'excerpt' }).researchTotal, 1);
});

test('manuscript progress aggregates chapter counts and words while projects count linked notes', () => {
  const notes = [
    { id: 'proj-1', title: 'Project One', relativePath: 'projects/One.md', metadata: { category: 'project' }, status: 'todo', properties: [], source: 'Project body', tasks: [{ offset: 1, title: 'T1', done: true, due: '', priority: 'normal' }] },
    { id: 'ms-1', title: 'Book One', relativePath: 'manuscripts/Book.md', metadata: { category: 'manuscript' }, status: '写作中', properties: [{ key: 'project', value: 'proj-1' }, { key: 'target_words', value: '1000' }], source: '本书导言十个汉字测试', tasks: [] },
    { id: 'ch-1', title: 'Chapter 1', relativePath: 'chapters/Ch1.md', metadata: { category: 'chapter' }, status: '草稿', properties: [{ key: 'manuscript', value: 'ms-1' }, { key: 'project', value: 'proj-1' }, { key: 'target_words', value: '500' }], source: '第一章正文包含十二个汉字内容', tasks: [] },
  ];
  const graph = { notes, nodeMap: new Map(notes.map(note => [note.id, note])) };
  const result = queryWorkspace(graph, { researchMode: 'manuscript' });
  assert.equal(result.projects[0].noteCount, 2);
  assert.equal(result.projects[0].done, 1);
  assert.equal(result.researchTotal, 2);
  const manuscript = result.research.find(item => item.id === 'ms-1');
  assert.equal(manuscript.chapterCount, 1);
  assert.equal(manuscript.targetWords, 1000);
  assert.ok(manuscript.wordCount >= 20);
});

test('memo search includes original body and keeps archived notes out of inbox', () => {
  const memo = { id: 'memo', properties: [{ key: 'created', value: '2026-10-23T12:00:00' }], metadata: { category: 'memo' }, title: 'Memo', status: 'note', tasks: [], source: 'A distant searchable sentence', excerpt: 'A distant' };
  const graph = { notes: [memo], nodeMap: new Map([[memo.id, memo]]) };
  assert.equal(queryWorkspace(graph, { memoText: 'searchable' }).memoTotal, 1);
  memo.status = 'archived'; assert.equal(queryWorkspace(graph).memoTotal, 0); assert.equal(queryWorkspace(graph, { memoArchive: true }).memoTotal, 1);
});

test('home overview uses recorded dates and does not invent activity for undated notes', () => {
  const notes = [
    { id: 'dated', title: 'Dated', date: '2026-10-29', properties: [], metadata: {}, tasks: [] },
    { id: 'undated', title: 'Undated', properties: [], metadata: {}, tasks: [] },
    { id: 'invalid', title: 'Invalid', date: '2026-02-30', properties: [], metadata: {}, tasks: [] },
  ];
  const { overview } = queryWorkspace({ notes }, { today: '2026-10-29' });
  assert.equal(overview.totalNotes, 3);
  assert.equal(overview.undatedNotes, 2);
  assert.equal(overview.todayNotes, 1);
  assert.deepEqual(overview.activityDays, [{ date: '2026-10-29', count: 1 }]);
  assert.deepEqual(queryWorkspace({ notes }, { overviewDate: '2026-10-29' }).overview.recent.map(note => note.id), ['dated']);
});