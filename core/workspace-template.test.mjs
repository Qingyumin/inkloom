import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTemplate, validateWorkspaceTemplate } from './workspace-template.mjs';

test('workspace templates round-trip layout, task mode and database view settings', () => {
  const pack = createWorkspaceTemplate({
    name: '研究与写作工作台',
    template: 'writing',
    taskMode: 'board',
    databaseView: { viewMode: 'table', compactMode: true, pageSize: 25, groupBy: 'project', propertyKey: 'target_words' },
  });
  const verified = validateWorkspaceTemplate(JSON.parse(JSON.stringify(pack)));
  assert.equal(verified.name, '研究与写作工作台');
  assert.equal(verified.template, 'writing');
  assert.equal(verified.taskMode, 'board');
  assert.equal(verified.databaseView.groupBy, 'project');
  assert.equal(verified.databaseView.propertyKey, 'target_words');
  assert.equal(verified.layout.length, 6);
});

test('workspace template validation rejects overlapping widgets, unknown fields and oversized payloads', () => {
  const valid = createWorkspaceTemplate({ name: '默认' });
  assert.throws(() => validateWorkspaceTemplate({ ...valid, format: 'other' }), /版本/);
  assert.throws(() => validateWorkspaceTemplate({ ...valid, name: '' }), /名称/);
  assert.throws(() => validateWorkspaceTemplate({
    ...valid,
    layout: [
      { id: 'capture', x: 0, y: 0, w: 6, h: 6 },
      { id: 'tasks', x: 4, y: 2, w: 6, h: 6 },
    ],
  }), /重叠/);
  assert.throws(() => validateWorkspaceTemplate({ ...valid, databaseView: { groupBy: '../bad' } }), /分组/);
  assert.throws(() => validateWorkspaceTemplate({ ...valid, databaseView: { propertyKey: 'bad key!' } }), /属性列/);
});
