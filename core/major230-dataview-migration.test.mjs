import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDataviewQuery,
  executeDataviewQuery,
  convertExternalVaultNoteToInkloom,
} from './vault-doctor.mjs';

test('MAJOR-230: Dataview DQL parser and evaluator supports TABLE, LIST, and TASK with FROM, WHERE, SORT, and LIMIT', () => {
  const sampleNotes = [
    {
      id: 'n1',
      title: '01-双链笔记与卡片盒方法',
      cleanTitle: '双链笔记与卡片盒方法',
      relativePath: 'notes/01-双链笔记与卡片盒方法.md',
      folder: 'notes',
      tags: ['双链笔记', '卡片盒'],
      status: '进行中',
      date: '2026-11-08',
      source: '---\ntitle: 双链笔记与卡片盒方法\nstatus: 进行中\ndate: 2026-11-08\ntags: [双链笔记, 卡片盒]\n---\n\n# 双链笔记\n\n- [ ] 整理卡片盒索引\n- [x] 阅读卢曼原著\n',
    },
    {
      id: 'n2',
      title: '02-知识图谱拓扑分析',
      cleanTitle: '知识图谱拓扑分析',
      relativePath: 'notes/02-知识图谱拓扑分析.md',
      folder: 'notes',
      tags: ['知识图谱'],
      status: '已完成',
      date: '2026-11-06',
      source: '---\ntitle: 知识图谱拓扑分析\nstatus: 已完成\ndate: 2026-11-06\ntags: [知识图谱]\n---\n\n# 知识图谱\n\n- [ ] 验证 PageRank 收敛性\n',
    },
  ];

  const parsed = parseDataviewQuery('TABLE status AS "状态", date AS "日期", tags FROM "notes" WHERE status = "进行中" SORT date DESC LIMIT 5');
  assert.equal(parsed.mode, 'TABLE');
  assert.equal(parsed.fromSource, '"notes"');
  assert.equal(parsed.sortField, 'date');
  assert.equal(parsed.sortDir, 'desc');
  assert.equal(parsed.limit, 5);

  const tableRes = executeDataviewQuery(sampleNotes, parsed);
  assert.equal(tableRes.mode, 'TABLE');
  assert.equal(tableRes.rowCount, 1);
  assert.equal(tableRes.rows[0].title, '双链笔记与卡片盒方法');
  assert.ok(tableRes.markdown.includes('[[双链笔记与卡片盒方法]]'));

  const listRes = executeDataviewQuery(sampleNotes, 'LIST FROM #知识图谱');
  assert.equal(listRes.mode, 'LIST');
  assert.equal(listRes.rowCount, 1);
  assert.ok(listRes.markdown.includes('[[知识图谱拓扑分析]]'));

  const taskRes = executeDataviewQuery(sampleNotes, 'TASK FROM "notes" WHERE !completed');
  assert.equal(taskRes.mode, 'TASK');
  assert.equal(taskRes.rowCount, 2);
  assert.ok(taskRes.markdown.includes('整理卡片盒索引'));
  assert.ok(!taskRes.markdown.includes('阅读卢曼原著'));
});

test('MAJOR-230: Notion export and Logseq outline lossless migration preserves UTF-8 BOM and CRLF', () => {
  const notionRaw = '\uFEFF# 系统架构设计 a1b2c3d4e5f678901234567890abcdef\r\nStatus: 进行中\r\nTags: 架构, PKM\r\nDate: 2026-11-08\r\n\r\n参见子页面 [核心模块](核心模块%200123456789abcdef0123456789abcdef.md) 与 ==重点结论==。\r\n';
  const notionConverted = convertExternalVaultNoteToInkloom(notionRaw, {
    fileName: '系统架构设计 a1b2c3d4e5f678901234567890abcdef.md',
  });
  assert.equal(notionConverted.changed, true);
  assert.ok(notionConverted.source.startsWith('\uFEFF---\r\n'));
  assert.ok(notionConverted.source.includes('title: 系统架构设计'));
  assert.ok(notionConverted.source.includes('[[核心模块]]'));
  assert.ok(notionConverted.source.includes('**重点结论**'));

  const logseqRaw = 'tags:: #卡片盒, #Logseq迁入\nalias:: 卢曼笔记\n- # 卡片盒笔记法\n- id:: 672d0011-2233-4455-6677-8899aabbccdd\n- TODO 提炼原子概念卡\n- DOING 编写索引页\n- DONE 归档文献笔记\n';
  const logseqConverted = convertExternalVaultNoteToInkloom(logseqRaw, {
    fileName: '2026_11_08.md',
    today: '2026-11-08',
  });
  assert.equal(logseqConverted.changed, true);
  assert.ok(logseqConverted.source.includes('tags: [卡片盒, Logseq迁入]'));
  assert.ok(logseqConverted.source.includes('aliases: [卢曼笔记]'));
  assert.ok(!logseqConverted.source.includes('672d0011'));
  assert.ok(logseqConverted.source.includes('- [ ] 提炼原子概念卡'));
  assert.ok(logseqConverted.source.includes('- [/] 编写索引页'));
  assert.ok(logseqConverted.source.includes('- [x] 归档文献笔记'));
});
