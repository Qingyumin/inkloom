import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeOrphanWeaving,
  applyOrphanWeaveLink,
  generateKnowledgeDigest,
  splitNoteIntoCards,
} from './knowledge-synthesis.mjs';

test('analyzeOrphanWeaving recommends the best hub note for orphan notes and applyOrphanWeaveLink preserves BOM and CRLF', () => {
  const notes = [
    {
      id: 'hub-graph',
      title: '02-知识图谱与局部星图',
      cleanTitle: '知识图谱与局部星图',
      folder: '根目录',
      tags: ['知识图谱', 'PKM'],
      inDegree: 3,
      outDegree: 2,
      orphan: false,
      source: '# 知识图谱与局部星图\n\n基于有向图与局部星图探索孤岛笔记与待建节点。',
      excerpt: '基于有向图与局部星图探索孤岛笔记与待建节点。',
    },
    {
      id: 'orphan-1',
      title: '05-孤岛灵感卡片：知识系统演进',
      cleanTitle: '孤岛灵感卡片：知识系统演进',
      folder: '根目录',
      tags: ['知识图谱', '灵感卡片'],
      inDegree: 0,
      outDegree: 0,
      orphan: true,
      source: '\uFEFF---\r\ntitle: 孤岛灵感卡片\r\n---\r\n# 孤岛灵感卡片\r\n\r\n记录关于知识图谱与节点演进的思考。\r\n',
      excerpt: '记录关于知识图谱与节点演进的思考。',
    },
  ];

  const report = analyzeOrphanWeaving(notes, { versions: new Map([['orphan-1', 'a'.repeat(64)]]) });
  assert.equal(report.totalOrphans, 1);
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0].orphanId, 'orphan-1');
  assert.equal(report.recommendations[0].hubId, 'hub-graph');
  assert.equal(report.recommendations[0].proposedLink, '[[知识图谱与局部星图]]');

  const woven = applyOrphanWeaveLink(notes[1].source, report.recommendations[0].hubCleanTitle, report.recommendations[0].reason);
  assert.equal(woven.changed, true);
  assert.ok(woven.source.startsWith('\uFEFF'));
  assert.ok(woven.source.includes('\r\n'));
  assert.ok(woven.source.includes('[[知识图谱与局部星图]]'));
});

test('generateKnowledgeDigest aggregates memos, tasks, excerpts and themes with traceable WikiLinks, and splitNoteIntoCards extracts H2 cards', () => {
  const notes = [
    {
      id: 'n1',
      name: '2026-10-24.md',
      title: '2026-10-24 今日手记',
      cleanTitle: '2026-10-24 今日手记',
      folder: 'daily',
      metadata: { category: 'memo', date: '2026-10-24' },
      tags: ['PKM', '周报'],
      excerpt: '完成了本地小模型与三模双链的集成验证。',
      source: '---\ntitle: 2026-10-24 今日手记\ncategory: memo\ndate: 2026-10-24\n---\n# 今日手记\n- [x] 完成本地小模型推理\n- [ ] 编写操作手册\n',
    },
    {
      id: 'n2',
      name: 'Excerpt1.md',
      title: '卡片盒摘录',
      cleanTitle: '卡片盒摘录',
      folder: 'excerpts',
      metadata: { category: 'excerpt', date: '2026-10-24', source_block: '01-双链笔记与卡片盒方法#^block-123' },
      tags: ['PKM'],
      excerpt: '卡片盒的核心在于原子化与双链网络。',
      source: '# 卡片盒摘录\n\n## 一、 原子化原则\n每张卡片只围绕一个核心论点展开，便于跨上下文复用。\n\n## 二、 双链织网原则\n新卡片进入系统时必须与既有卡片建立双向关联。\n',
    },
  ];

  const digest = generateKnowledgeDigest(notes, { windowDays: 7, today: '2026-10-24' });
  assert.equal(digest.stats.memos, 1);
  assert.equal(digest.stats.completedTasks, 1);
  assert.equal(digest.stats.openTasks, 1);
  assert.equal(digest.stats.excerpts, 1);
  assert.ok(digest.markdown.includes('[[2026-10-24 今日手记]]'));
  assert.ok(digest.markdown.includes('![[01-双链笔记与卡片盒方法#^block-123]]'));

  const split = splitNoteIntoCards(notes[1]);
  assert.equal(split.cards.length, 2);
  assert.ok(split.cards[0].markdown.includes('parent_note: "[[卡片盒摘录]]"'));
  assert.ok(split.mocSection.includes('[[cards/卡片盒摘录 · 原子化原则|原子化原则]]'));
});
