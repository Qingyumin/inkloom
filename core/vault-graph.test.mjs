import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontMatter,
  extractHeadings,
  extractTags,
  extractWikiLinks,
  purifyWikiLinksForExport,
  buildVaultGraph,
  linkUnlinkedMention,
  queryLocalSubgraph,
  filterGlobalGraph,
  completeWikiLink,
  updateFrontMatterProperties,
  rewriteVaultLinksOnRename,
  queryVaultDatabase,
  planVaultRename,
} from './vault-graph.mjs';

test('parseFrontMatter extracts YAML properties, tags, and aliases cleanly', () => {
  const source = [
    '---',
    'title: 墨图知识引擎',
    'aliases: [Inkloom, 墨图]',
    'tags: [知识图谱, PKM/双链]',
    'status: 已完成',
    'date: 2026-10-21',
    '---',
    '# 一、核心设计',
    '正文段落。',
  ].join('\n');

  const parsed = parseFrontMatter(source);
  assert.equal(parsed.metadata.title, '墨图知识引擎');
  assert.deepEqual(parsed.metadata.aliases, ['Inkloom', '墨图']);
  assert.deepEqual(parsed.metadata.tags, ['知识图谱', 'PKM/双链']);
  assert.equal(parsed.metadata.status, '已完成');
  assert.ok(parsed.bodyFrom > 0);
  assert.ok(source.slice(parsed.bodyFrom).startsWith('# 一、核心设计'));
});

test('extractTags and extractWikiLinks ignore fenced and inline code blocks', () => {
  const source = [
    '---',
    'tags: [核心架构]',
    '---',
    '# 标题 [[被净化的标题双链|标题别名]]',
    '正文中包含 [[01-双链笔记与卡片盒方法]] 以及带章节别名的 [[02-知识图谱与局部星图#双层图谱架构|双层星图设计]]。',
    '还有内嵌引用 ![[03-长文写作与工业级导出#导出净化]] 与行内标签 #双链笔记 和 #PKM/图谱，忽略颜色 #fff000 与行内代码 `[[假链接]] #假标签`。',
    '```js',
    'const fake = "[[代码块内不解析]] #代码块标签";',
    '```',
  ].join('\n');

  const { metadata, bodyFrom } = parseFrontMatter(source);
  const headings = extractHeadings(source, bodyFrom);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, '标题 标题别名');

  const tags = extractTags(source, metadata.tags, bodyFrom);
  assert.deepEqual(tags, ['核心架构', '双链笔记', 'PKM/图谱']);

  const links = extractWikiLinks(source, bodyFrom);
  assert.equal(links.length, 4);
  assert.equal(links[1].target, '01-双链笔记与卡片盒方法');
  assert.equal(links[1].display, '双链笔记与卡片盒方法');
  assert.equal(links[2].target, '02-知识图谱与局部星图');
  assert.equal(links[2].heading, '双层图谱架构');
  assert.equal(links[2].alias, '双层星图设计');
  assert.equal(links[2].display, '双层星图设计');
  assert.equal(links[3].embed, true);
});

test('buildVaultGraph builds backlinks, ghost nodes, orphans, and unlinked mentions', () => {
  const notes = [
    {
      id: 'n0',
      name: '00-墨图导览与万象星图.md',
      relativePath: '00-墨图导览与万象星图.md',
      source: [
        '---',
        'title: 墨图导览与万象星图',
        'aliases: [墨图导览]',
        'tags: [总览, 知识图谱]',
        '---',
        '# 墨图导览',
        '核心参考 [[01-双链笔记与卡片盒方法]] 与 [[02-知识图谱与局部星图#局部星图|局部星图]]，未来将补充 [[卡片写作十诫]]。',
      ].join('\n'),
    },
    {
      id: 'n1',
      name: '01-双链笔记与卡片盒方法.md',
      relativePath: '01-双链笔记与卡片盒方法.md',
      source: [
        '---',
        'title: 双链笔记与卡片盒方法',
        'tags: [双链笔记, 方法论]',
        '---',
        '# 双链笔记与卡片盒方法',
        '回到 [[墨图导览]]。本文顺带在正文中提到 知识图谱与局部星图 但没有加双链方括号。',
      ].join('\n'),
    },
    {
      id: 'n2',
      name: '02-知识图谱与局部星图.md',
      relativePath: '02-知识图谱与局部星图.md',
      source: [
        '---',
        'title: 知识图谱与局部星图',
        'tags: [知识图谱]',
        '---',
        '# 知识图谱与局部星图',
        '## 局部星图',
        '支持 1~2 跳邻居展示。',
      ].join('\n'),
    },
    {
      id: 'n3',
      name: '99-孤岛速记.md',
      relativePath: 'journals/99-孤岛速记.md',
      source: '# 孤岛速记\n这是一篇没有任何入链或出链的独立笔记。',
    },
  ];

  const graph = buildVaultGraph(notes);
  assert.equal(graph.stats.totalNotes, 4);
  assert.equal(graph.stats.ghostCount, 1);
  assert.equal(graph.stats.orphanCount, 1);

  const n2Backlinks = graph.backlinksByNote.get('n2');
  assert.equal(n2Backlinks.length, 1);
  assert.equal(n2Backlinks[0].sourceId, 'n0');
  assert.equal(n2Backlinks[0].heading, '局部星图');

  const n2Mentions = graph.unlinkedMentionsByNote.get('n2');
  assert.equal(n2Mentions.length, 1);
  assert.equal(n2Mentions[0].sourceId, 'n1');
  assert.equal(n2Mentions[0].matchedTerm, '知识图谱与局部星图');

  const linked = linkUnlinkedMention(notes[1].source, n2Mentions[0]);
  assert.ok(linked);
  assert.ok(linked.nextSource.includes('[[知识图谱与局部星图]]'));

  const local1 = queryLocalSubgraph(graph, 'n0', { depth: 1 });
  assert.equal(local1.nodes.length, 4); // n0 + n1 + n2 + ghost:卡片写作十诫

  const orphans = filterGlobalGraph(graph, { mode: 'orphans' });
  assert.equal(orphans.nodes.length, 1);
  assert.equal(orphans.nodes[0].id, 'n3');

  const ghosts = filterGlobalGraph(graph, { mode: 'ghosts' });
  assert.ok(ghosts.nodes.some(node => node.ghost && node.label === '卡片写作十诫'));

  const suggestions = completeWikiLink(graph, '02-知识图谱与局部星图#', 'n0');
  assert.ok(suggestions.some(item => item.heading === '局部星图'));
});

test('purifyWikiLinksForExport converts wikilinks to clean prose while keeping code untouched', () => {
  const md = '请参见 [[01-双链笔记与卡片盒方法]] 与 [[02-知识图谱与局部星图#双层架构|双层架构说明]]，代码 `[[保留原样]]` 不动。';
  const cleaned = purifyWikiLinksForExport(md);
  assert.equal(cleaned, '请参见 双链笔记与卡片盒方法 与 双层架构说明，代码 `[[保留原样]]` 不动。');
});

test('property edits preserve comments, unknown fields, BOM, CRLF and the exact body', () => {
  const body = '\r\n\r\n# Body\r\n  untouched  \r\n';
  const original = '\uFEFF---\r\n# keep this comment\r\nstatus: draft\r\ncustom: {nested: 42}\r\n---\r\n' + body;
  const updated = updateFrontMatterProperties(original, { status: 'ready', tags: ['one', 'two'] });
  assert.ok(updated.startsWith('\uFEFF---\r\n'));
  assert.ok(updated.includes('# keep this comment\r\n'));
  assert.ok(updated.includes('custom: { nested: 42 }') || updated.includes('custom: {nested: 42}'));
  assert.ok(updated.endsWith('---\r\n' + body));
  assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false);
});

test('invalid frontmatter is rejected instead of replaced', () => {
  for (const source of ['---\nstatus: [broken\n---\nBody', '---\nstatus: one\nstatus: two\n---\nBody', '---\nstatus: one', '---\n- not a mapping\n---\nBody']) {
    assert.throws(() => updateFrontMatterProperties(source, { status: 'ready' }));
  }
  assert.equal(updateFrontMatterProperties('# Body\n', { tags: [] }), '# Body\n');
});

test('rename plans resolve folder-local names and preserve code, heading suffixes and aliases', () => {
  const notes = [
    { id: 'target', name: 'Topic.md', relativePath: 'one/Topic.md', source: '---\ntitle: Keep title\n---\n# Section\n' },
    { id: 'other', name: 'Topic.md', relativePath: 'two/Topic.md', source: '# Another\n' },
    { id: 'ref', name: 'Ref.md', relativePath: 'one/Ref.md', source: '[[Topic#Section|Alias]]\n![[one/Topic]]\n`[[Topic]]`\n````md\n```\n[[Topic]]\n````\n' },
    { id: 'unrelated', name: 'Ref.md', relativePath: 'two/Ref.md', source: '[[Topic]]\n' },
  ];
  const plan = planVaultRename(notes, 'target', 'Renamed');
  assert.equal(plan.newRelativePath, 'one/Renamed.md');
  assert.equal(plan.rewrittenLinks, 2);
  assert.equal(plan.updates.find(item => item.noteId === 'target').source, notes[0].source);
  assert.equal(plan.updates.find(item => item.noteId === 'ref').source, '[[one/Renamed#Section|Alias]]\n![[one/Renamed]]\n`[[Topic]]`\n````md\n```\n[[Topic]]\n````\n');
  assert.equal(plan.updates.some(item => item.noteId === 'unrelated'), false);
  assert.throws(() => planVaultRename(notes, 'target', '../outside'));
  assert.throws(() => planVaultRename(notes, 'target', 'CON'));
  assert.equal(planVaultRename(notes, 'target', 'Renamed', false).rewrittenLinks, 0);
});

test('updateFrontMatterProperties, rewriteVaultLinksOnRename, and queryVaultDatabase support Phase 2 workflows', () => {
  const original = [
    '---',
    'title: 旧名称',
    'status: 草稿',
    'tags: [双链笔记]',
    '---',
    '',
    '# 标题',
    '正文。',
  ].join('\n');

  const updated = updateFrontMatterProperties(original, {
    status: '已就绪',
    tags: ['双链笔记', 'Notion增强'],
    aliases: ['新别名'],
  });
  const parsed = parseFrontMatter(updated);
  assert.equal(parsed.metadata.status, '已就绪');
  assert.deepEqual(parsed.metadata.tags, ['双链笔记', 'Notion增强']);
  assert.deepEqual(parsed.metadata.aliases, ['新别名']);

  const referring = '参考 [[01-双链笔记与卡片盒方法#语法|卡片法]] 与 [[双链笔记与卡片盒方法]]，代码 `[[双链笔记与卡片盒方法]]` 不改。';
  const renamed = rewriteVaultLinksOnRename(referring, {
    oldStem: '01-双链笔记与卡片盒方法',
    oldCleanTitle: '双链笔记与卡片盒方法',
    newStem: '01-卢曼双链与卡片盒',
    newCleanTitle: '卢曼双链与卡片盒',
  });
  assert.equal(renamed.changed, true);
  assert.equal(renamed.count, 2);
  assert.equal(
    renamed.nextSource,
    '参考 [[01-卢曼双链与卡片盒#语法|卡片法]] 与 [[卢曼双链与卡片盒]]，代码 `[[双链笔记与卡片盒方法]]` 不改。'
  );

  const graph = buildVaultGraph([
    { id: 'a', name: 'A.md', relativePath: 'A.md', source: updated },
    { id: 'b', name: 'B.md', relativePath: 'notes/B.md', source: '---\ntitle: B\nstatus: 草稿\ntags: [图谱]\n---\n[[旧名称]]' },
  ]);
  const db = queryVaultDatabase(graph, { status: '已就绪' });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].id, 'a');
  assert.ok(db.columns.some(col => col.status === '已就绪' && col.count === 1));
});

