import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdownSlides,
  compileSingleFileWikiHtml,
  computeNoteLineDiff,
  revertDiffHunk,
} from './publication-presenter.mjs';

test('PUB-001 parseMarkdownSlides splits by horizontal rules and extracts speaker notes', () => {
  const md = [
    '---',
    'title: 06-墨图演示文稿示例',
    '---',
    '',
    '# 第一页：核心定位',
    '',
    '- 本地优先双链工作台',
    '<!-- note: 开场强调本地优先与数据自主性 -->',
    '',
    '---',
    '',
    '## 第二页：架构对比',
    '',
    '| 维度 | 方案 |',
    '| --- | --- |',
    '| 存储 | 本地 Markdown |',
    '',
    '---',
    '',
    '## 第三页：总结展望',
    '',
    '> [!TIP] 关键结论',
    '> 参看 [[00-墨图导览与万象星图]]',
  ].join('\n');

  const deck = parseMarkdownSlides(md);
  assert.equal(deck.title, '墨图演示文稿示例');
  assert.equal(deck.splitMode, 'hr');
  assert.equal(deck.totalSlides, 3);
  assert.equal(deck.slides[0].title, '第一页：核心定位');
  assert.match(deck.slides[0].speakerNotes, /开场强调本地优先与数据自主性/);
  assert.match(deck.slides[1].html, /<table class="pub-table">/);
  assert.match(deck.slides[2].html, /pub-callout-tip/);
  assert.match(deck.slides[2].html, /data-wiki-target="00-墨图导览与万象星图"/);
});

test('PUB-001 parseMarkdownSlides automatically falls back to H2 headings when no --- rule exists', () => {
  const md = [
    '# 总体介绍',
    '',
    '导语内容。',
    '',
    '## 章节 A',
    '',
    '章节 A 正文。',
    '',
    '## 章节 B',
    '',
    '章节 B 正文。',
  ].join('\n');

  const deck = parseMarkdownSlides(md, { title: 'H2自动分页测试' });
  assert.equal(deck.splitMode, 'h2');
  assert.equal(deck.totalSlides, 3);
  assert.equal(deck.slides[1].title, '章节 A');
  assert.equal(deck.slides[2].title, '章节 B');
});

test('PUB-002 compileSingleFileWikiHtml generates a self-contained offline interactive HTML wiki', () => {
  const notes = [
    {
      id: 'n-home',
      name: '00-导览.md',
      relativePath: '00-导览.md',
      source: '---\ntitle: 00-导览\ntags: [核心]\nstatus: 已就绪\n---\n\n# 导览首页\n\n前往 [[01-详情]] 查看 ==重点高亮==。\n\n> [!NOTE] 提示标题\n> 提示内容。',
    },
    {
      id: 'n-detail',
      name: '01-详情.md',
      relativePath: '专题/01-详情.md',
      source: '---\ntitle: 01-详情\n---\n\n# 专题详情\n\n## 子章节一\n\n包含具体算例。',
    },
  ];

  const html = compileSingleFileWikiHtml(notes, {
    activeNoteId: 'n-home',
    siteTitle: '测试知识微站',
    exportedAt: '2026-10-26',
  });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /data-wiki-generator="Inkloom-1\.\d+\.\d+"/);
  assert.match(html, /测试知识微站/);
  assert.match(html, /id="wiki-nav-tree"/);
  assert.match(html, /id="wiki-search-input"/);
  assert.match(html, /pub-highlight-mark/);
  assert.match(html, /pub-callout-note/);
  assert.doesNotMatch(html, /https?:\/\/cdn/i);
});

test('PUB-003 computeNoteLineDiff and revertDiffHunk accurately diff and rollback individual hunks preserving BOM and CRLF', () => {
  const baseline = '\uFEFF---\r\ntitle: 版本测试\r\n---\r\n\r\n# 标题\r\n\r\n第一段原始文本。\r\n\r\n第二段保持不变。\r\n\r\n第三段原始结尾。\r\n';
  const modified = '\uFEFF---\r\ntitle: 版本测试\r\n---\r\n\r\n# 标题\r\n\r\n第一段被修改后的文本。\r\n新增一行补充说明。\r\n\r\n第二段保持不变。\r\n\r\n第三段也被修改了。\r\n';

  const diff = computeNoteLineDiff(baseline, modified);
  assert.equal(diff.identical, false);
  assert.equal(diff.stats.hunks, 2);
  assert.equal(diff.stats.added, 3);
  assert.equal(diff.stats.removed, 2);

  // Revert only hunk-1, keeping hunk-2 intact
  const afterHunk1 = revertDiffHunk(modified, baseline, 'hunk-1');
  assert.equal(afterHunk1.reverted, true);
  assert.ok(afterHunk1.source.startsWith('\uFEFF'));
  assert.ok(afterHunk1.source.includes('\r\n'));
  assert.match(afterHunk1.source, /第一段原始文本。/);
  assert.doesNotMatch(afterHunk1.source, /新增一行补充说明。/);
  assert.match(afterHunk1.source, /第三段也被修改了。/);

  // Revert remaining hunk-1 (which was hunk-2) to return to exact baseline
  const afterAll = revertDiffHunk(afterHunk1.source, baseline, 'hunk-1');
  assert.equal(afterAll.source, baseline);
});
