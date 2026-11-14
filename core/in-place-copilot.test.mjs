import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INLINE_AI_ACTIONS,
  SLASH_AI_COMMANDS,
  SMART_NOTE_TEMPLATES,
  renderSmartTemplate,
  transformSelectedTextWithAi,
  generateSlashAiDraft,
  inferNotePropertiesFromContent,
  computeLiveSmartConnections,
  appendQuickThoughtToSource,
  convertDelimitedTextToMarkdownTable,
  sortMarkdownTableInSource,
  moveMarkdownHeadingSection,
  appendOrUpdateTableSummaryRow,
  alignMarkdownTableColumnInSource,
  extractMarkdownTableColumnFromSource,
  upsertSavedBookmark,
  removeSavedBookmark,
  formatPomodoroClock,
} from './in-place-copilot.mjs';

test('AIA-001 transformSelectedTextWithAi handles polish, concise, expand, translate, todo and flashcard', () => {
  assert.equal(INLINE_AI_ACTIONS.length, 6);
  const sample = '双链笔记：通过显式双向引用把孤立卡片织成知识图谱。\n此外，结合间隔重复闪卡可以巩固长期记忆。';
  const polished = transformSelectedTextWithAi('polish', sample, { noteTitle: '01-双链笔记' });
  assert.match(polished.output, /双链笔记/);

  const concise = transformSelectedTextWithAi('concise', sample);
  assert.match(concise.output, /- \*\*要点\*\*/);

  const expanded = transformSelectedTextWithAi('expand', sample, { noteTitle: '01-双链笔记', relatedCitation: '[[02-知识图谱]]' });
  assert.match(expanded.output, /\[!TIP\]/);
  assert.match(expanded.output, /\[\[02-知识图谱\]\]/);

  const translated = transformSelectedTextWithAi('translate', sample, { noteTitle: '01-双链笔记' });
  assert.match(translated.output, /Knowledge Graph/);
  assert.match(translated.output, /Bi-directional Linked Notes/);

  const todos = transformSelectedTextWithAi('todo', '整理核心卡片\n补充反例边界');
  assert.match(todos.output, /- \[ \] 整理核心卡片/);
  assert.match(todos.output, /- \[ \] 补充反例边界/);

  const card = transformSelectedTextWithAi('flashcard', '卢曼卡片盒：以原子概念为单位并通过双链组织笔记的方法');
  assert.match(card.output, /^Q: /m);
  assert.match(card.output, /^A: /m);
});

test('AIA-002 generateSlashAiDraft produces structured markdown for 4 slash AI commands', () => {
  assert.equal(SLASH_AI_COMMANDS.length, 4);
  const source = '---\ntitle: 系统思考\n---\n\n## 反馈回路机制\n\n正反馈会放大系统偏离，负反馈则维持稳态平衡。\n';
  const context = {
    source,
    cursorOffset: source.length,
    noteTitle: '系统思考',
    relatedSnippets: [{ citation: '[[01-双链笔记与卡片盒方法#核心原则]]' }],
  };
  const cont = generateSlashAiDraft('ai-continue', context);
  assert.match(cont, /反馈回路机制/);
  assert.match(cont, /\[\[01-双链笔记与卡片盒方法#核心原则\]\]/);

  const outline = generateSlashAiDraft('ai-outline', context);
  assert.match(outline, /\[!NOTE\] 《反馈回路机制》章节要点提炼/);

  const args = generateSlashAiDraft('ai-arguments', context);
  assert.match(args, /\[!TIP\] 正方核心论据/);
  assert.match(args, /\[!WARNING\] 反方张力与适用边界/);

  const table = generateSlashAiDraft('ai-table', context);
  assert.match(table, /\| 评估维度 \|/);
});

test('AIA-003 inferNotePropertiesFromContent extracts tags, aliases, status and summary', () => {
  const source = [
    '---',
    'title: 04-知识图谱与双链检索（Graph RAG）',
    '---',
    '',
    '# 知识图谱与双链检索',
    '',
    '本文探讨 **图谱检索** 与 **混合向量** 在本地知识库中的协同机制，并结合 YAML 属性实现多维过滤。',
    '- [x] 完成向量索引设计',
    '- [x] 完成双链一跳扩展验证',
  ].join('\n');

  const inferred = inferNotePropertiesFromContent({
    title: '04-知识图谱与双链检索（Graph RAG）',
    source,
    folder: '研究',
    vaultTags: ['墨图核心', '知识图谱'],
  });
  assert.equal(inferred.status, '已完成');
  assert.ok(inferred.tags.includes('知识图谱'));
  assert.ok(inferred.tags.includes('双链笔记'));
  assert.ok(inferred.aliases.includes('Graph RAG') || inferred.aliases.includes('图谱检索'));
  assert.ok(inferred.summary.length >= 15);
});

test('AIA-004 computeLiveSmartConnections ranks semantically related paragraphs across vault', () => {
  const notes = [
    {
      id: 'n1',
      title: '01-双链笔记与卡片盒方法',
      cleanTitle: '双链笔记与卡片盒方法',
      relativePath: '01-双链笔记与卡片盒方法.md',
      source: '# 双链笔记\n\n## 原子化原则\n\n每张卡片只记录一个独立完整的概念，并通过 [[双链]] 建立上下文联系。',
    },
    {
      id: 'n2',
      title: '02-知识图谱与局部星图',
      cleanTitle: '知识图谱与局部星图',
      relativePath: '02-知识图谱与局部星图.md',
      source: '# 知识图谱\n\n## 拓扑中心性\n\n通过入链与出链度数衡量核心枢纽节点，识别孤岛卡片。',
    },
  ];
  const currentSource = '# 新笔记\n\n在整理原子概念卡片时，如何利用双链与卡片盒方法建立连接？';
  const matches = computeLiveSmartConnections({
    activeNoteId: 'active-doc',
    activeTitle: '新笔记',
    source: currentSource,
    cursorOffset: currentSource.length,
    notes,
    limit: 3,
  });
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].noteId, 'n1');
  assert.match(matches[0].citation, /\[\[01-双链笔记与卡片盒方法/);
});

test('EFF-001 renderSmartTemplate substitutes dynamic variables across all 6 templates', () => {
  assert.equal(SMART_NOTE_TEMPLATES.length, 6);
  const now = new Date('2026-10-26T14:35:00');
  const rendered = renderSmartTemplate('meeting-minutes', {
    title: '08-产品架构评审纪要',
    clipboard: '对齐 1.1.0 原位 AI 与效率工具交付范围',
    now,
    date: '2026-10-26',
  });
  assert.equal(rendered.title, '产品架构评审纪要');
  assert.match(rendered.source, /title: 产品架构评审纪要/);
  assert.match(rendered.source, /2026-10-26 14:35（星期一）/);
  assert.match(rendered.source, /对齐 1\.1\.0 原位 AI 与效率工具交付范围/);
});

test('EFF-002 appendQuickThoughtToSource preserves BOM and CRLF and formats timestamps', () => {
  const original = '\uFEFF---\r\ntitle: 今日手记\r\n---\r\n\r\n# 今日手记\r\n\r\n初始正文。\r\n';
  const first = appendQuickThoughtToSource(original, '验证全局闪念静默追加机制', { time: '09:15' });
  assert.ok(first.source.startsWith('\uFEFF'));
  assert.ok(first.source.includes('\r\n'));
  assert.match(first.source, /## ⚡ 今日闪念与快记/);
  assert.match(first.source, /- \*\*\[09:15\]\*\* 验证全局闪念静默追加机制/);

  const second = appendQuickThoughtToSource(first.source, '待办：补充单元测试断言', { time: '09:20' });
  assert.equal((second.source.match(/## ⚡ 今日闪念与快记/g) || []).length, 1);
  assert.match(second.source, /- \[ \] \[09:20\] 补充单元测试断言/);
});

test('EFF-003 convertDelimitedTextToMarkdownTable and sortMarkdownTableInSource work accurately', () => {
  const tsv = '模块\t耗时ms\t状态\n图谱布局\t195\t已完成\n全文检索\t42\t进行中\n增量索引\t88\t已完成';
  const table = convertDelimitedTextToMarkdownTable(tsv);
  assert.ok(table);
  assert.equal(table.columns, 3);
  assert.equal(table.rowCount, 3);
  assert.match(table.markdown, /\| 模块 \| 耗时ms \| 状态 \|/);

  const doc = `# 性能表\n\n${table.markdown}\n`;
  const asc = sortMarkdownTableInSource(doc, doc.indexOf('195'), 'asc', 1);
  assert.equal(asc.changed, true);
  const rowsAsc = asc.source.trim().split('\n').slice(-3);
  assert.match(rowsAsc[0], /全文检索 \| 42/);
  assert.match(rowsAsc[2], /图谱布局 \| 195/);

  const desc = sortMarkdownTableInSource(asc.source, doc.indexOf('195'), 'desc', 1);
  const rowsDesc = desc.source.trim().split('\n').slice(-3);
  assert.match(rowsDesc[0], /图谱布局 \| 195/);

  const excelHtml = '<table><tr><th>功能</th><th>快捷键</th></tr><tr><td>全局搜索</td><td>Ctrl+K</td></tr></table>';
  const fromHtml = convertDelimitedTextToMarkdownTable('', excelHtml);
  assert.ok(fromHtml);
  assert.equal(fromHtml.columns, 2);
  assert.equal(fromHtml.rowCount, 1);
  assert.match(fromHtml.markdown, /\| 功能 \| 快捷键 \|/);
  assert.match(fromHtml.markdown, /\| 全局搜索 \| Ctrl\+K \|/);

  // EFF-005b: appendOrUpdateTableSummaryRow
  const sumRes = appendOrUpdateTableSummaryRow(doc, doc.indexOf('195'));
  assert.equal(sumRes.changed, true);
  assert.equal(sumRes.numericColumns, 1);
  assert.match(sumRes.source, /Σ 汇总 \(3行\)/);
  assert.match(sumRes.source, /合计 325/);

  // EFF-005a: moveMarkdownHeadingSection
  const secDoc = '# 总标题\n\n## 第一节\n\n内容A\n\n### 子节A1\n\n细节A1\n\n## 第二节\n\n内容B\n';
  const movedDown = moveMarkdownHeadingSection(secDoc, '第一节', 'down');
  assert.equal(movedDown.changed, true);
  assert.ok(movedDown.source.indexOf('## 第二节') < movedDown.source.indexOf('## 第一节'));
  assert.ok(movedDown.source.indexOf('### 子节A1') > movedDown.source.indexOf('## 第一节'));

  // ITER-178: alignMarkdownTableColumnInSource & extractMarkdownTableColumnFromSource
  const centerAligned = alignMarkdownTableColumnInSource(doc, doc.indexOf('195'), 'center', 1);
  assert.equal(centerAligned.changed, true);
  assert.equal(centerAligned.alignment, 'center');
  assert.match(centerAligned.separatorLine, /\| --- \| :---: \| --- \|/);

  const rightAligned = alignMarkdownTableColumnInSource(centerAligned.source, doc.indexOf('195'), 'right', 1);
  assert.equal(rightAligned.changed, true);
  assert.match(rightAligned.separatorLine, /\| --- \| ---: \| --- \|/);

  const extractedCol = extractMarkdownTableColumnFromSource(doc, doc.indexOf('195'), 1);
  assert.equal(extractedCol.found, true);
  assert.equal(extractedCol.columnHeader, '耗时ms');
  assert.deepEqual(extractedCol.values, ['195', '42', '88']);
});

test('EFF-004 saved bookmarks and pomodoro clock formatting work deterministically', () => {
  let bookmarks = [];
  bookmarks = upsertSavedBookmark(bookmarks, {
    kind: 'note-heading',
    label: '墨图导览 # 核心理念',
    target: '00-墨图导览与万象星图.md',
    heading: '核心理念',
  });
  bookmarks = upsertSavedBookmark(bookmarks, {
    kind: 'tag-filter',
    label: '#墨图核心',
    target: '墨图核心',
  });
  assert.equal(bookmarks.length, 2);
  bookmarks = removeSavedBookmark(bookmarks, bookmarks[0].id);
  assert.equal(bookmarks.length, 1);
  assert.equal(formatPomodoroClock(1500), '25:00');
  assert.equal(formatPomodoroClock(65), '01:05');
});
