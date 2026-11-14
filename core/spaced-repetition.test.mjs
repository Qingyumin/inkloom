import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFlashcardsFromNotes,
  applyFlashcardReviewToSource,
  buildFlashcardsFromNote,
  computeNextSchedule,
  formatFlashcardPlainText,
  parseFlashcardRichSegments,
  computeFlashcardForecast,
  extractCandidateFlashcardsFromNote,
  appendSelectedFlashcardsToNote,
  filterFlashcardsDeck,
  selectDueMicroFlashcards,
} from './spaced-repetition.mjs';

test('extractFlashcardsFromNotes parses inline :: and Q:/A: cards while applyFlashcardReviewToSource updates SM-2 schedule preserving BOM and CRLF', () => {
  const source = '\uFEFF---\r\ntitle: 算法闪卡\r\n---\r\n# 算法闪卡\r\n\r\n余弦相似度 :: 衡量两个 128 维向量夹角余弦的相似度指标\r\n\r\nQ: BM25 解决什么问题？\r\nA: 词频饱和度与文档长度归一化的精确关键词检索 @sr(due=2026-10-20,interval=2,ease=2.50,reps=1)\r\n';
  const notes = [{ id: 'sr-1', title: '算法闪卡', cleanTitle: '算法闪卡', source }];

  const extracted = extractFlashcardsFromNotes(notes, { today: '2026-10-24' });
  assert.equal(extracted.totalCards, 2);
  assert.equal(extracted.dueCards, 2);

  const inlineCard = extracted.cards.find(c => c.kind === 'inline-pair');
  assert.equal(inlineCard.front, '余弦相似度');
  assert.equal(inlineCard.back, '衡量两个 128 维向量夹角余弦的相似度指标');

  const qaCard = extracted.cards.find(c => c.kind === 'qa-pair');
  assert.equal(qaCard.front, 'BM25 解决什么问题？');
  assert.equal(qaCard.schedule.interval, 2);

  const reviewed = applyFlashcardReviewToSource(source, qaCard.lineNum, 'easy', '2026-10-24');
  assert.ok(reviewed.source.startsWith('\uFEFF'));
  assert.ok(reviewed.source.includes('\r\n'));
  assert.equal(reviewed.schedule.interval, 7);
  assert.equal(reviewed.schedule.due, '2026-10-31');
  assert.equal(reviewed.schedule.ease, 2.65);

  const againSchedule = computeNextSchedule(reviewed.schedule, 'again', '2026-10-31');
  assert.equal(againSchedule.interval, 1);
  assert.equal(againSchedule.reps, 0);
});

test('buildFlashcardsFromNote extracts bold definition pairs into Q:/A: flashcards', () => {
  const note = {
    id: 'n-def',
    title: '02-知识图谱与局部星图',
    cleanTitle: '知识图谱与局部星图',
    source: '# 知识图谱与局部星图\n\n- **局部星图**：聚焦当前笔记一至两跳关联脉络的实时子图。\n- **待建节点**：已被双链提及但尚未落盘创建的虚线主题节点。\n',
  };
  const built = buildFlashcardsFromNote(note, { today: '2026-10-24' });
  assert.equal(built.appendedCount, 2);
  assert.ok(built.source.includes('## 记忆闪卡'));
  assert.ok(built.source.includes('Q: 什么是「局部星图」？'));
  assert.ok(built.source.includes('@sr(due=2026-10-24,interval=1,ease=2.50,reps=0)'));

  const corrupted = '支持 `[[笔记名]]` 跨篇精准跳转，例如直接前往 \\[[[[双链笔记与卡片盒方法]]\\]\\]\\[[[[双链笔记与卡片盒方法]]\\]\\] 或查看 \\[[02-知识图谱与局部星图#双层星图架构|';
  const plain = formatFlashcardPlainText(corrupted);
  assert.ok(!plain.includes('\\['));
  assert.ok(plain.includes('双链笔记与卡片盒方法'));
  assert.ok(plain.includes('知识图谱与局部星图 · 双层星图架构'));
  const segments = parseFlashcardRichSegments(corrupted);
  assert.ok(segments.some(s => s.type === 'code' && s.text === '[[笔记名]]'));
  assert.ok(segments.some(s => s.type === 'wikilink' && s.display === '双链笔记与卡片盒方法'));
});

test('computeFlashcardForecast and candidate selection preview calculate 14-day load and selectively append flashcards', () => {
  const note = {
    id: 'n-cand',
    title: '04-YAML属性与标签体系',
    cleanTitle: 'YAML属性与标签体系',
    source: '\uFEFF---\r\ntitle: YAML属性与标签体系\r\n---\r\n# YAML属性与标签体系\r\n\r\n- **状态胶囊**：通过彩色圆角胶囊直接标记与快切笔记生命周期。\r\n- **标签索引**：支持按 #标签 聚合跨目录的知识卡片。\r\n',
  };
  const candidates = extractCandidateFlashcardsFromNote(note, { today: '2026-10-25' });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].term, '状态胶囊');
  assert.equal(candidates[0].alreadyExists, false);

  const appended = appendSelectedFlashcardsToNote(note, [candidates[0]], { today: '2026-10-25' });
  assert.equal(appended.appendedCount, 1);
  assert.ok(appended.source.startsWith('\uFEFF'));
  assert.ok(appended.source.includes('\r\n'));
  assert.ok(appended.source.includes('Q: 什么是「状态胶囊」？'));
  assert.ok(!appended.source.includes('Q: 什么是「标签索引」？'));

  const extracted = extractFlashcardsFromNotes([{ ...note, source: appended.source }], { today: '2026-10-25' });
  assert.equal(extracted.forecast.length, 14);
  assert.equal(extracted.stats.totalCards, 1);
  assert.equal(extracted.stats.dueCards, 1);
  assert.equal(extracted.stats.newCards, 1);
  const forecast = computeFlashcardForecast(extracted.cards, '2026-10-25', 14);
  assert.equal(forecast.days[0].label, '今日');
  assert.equal(forecast.days[0].count, 1);
});

test('filterFlashcardsDeck and selectDueMicroFlashcards classify folders, tags, hard cards, and top-3 due micro cards (ITER-179)', () => {
  const notes = [
    {
      id: 'n-deck-1',
      title: '01-双链笔记',
      cleanTitle: '双链笔记',
      folder: '卡片盒理论',
      tags: ['双链', '卡片盒'],
      source: '---\ntitle: 双链笔记\ntags: [双链, 卡片盒]\n---\n原子概念 :: 每个卡片聚焦单一核心观点 @sr(due=2026-10-24,interval=1,ease=2.20,reps=0)\n\nQ: 什么是索引卡？\nA: 用于聚合同一专题下多张原子卡的枢纽笔记 @sr(due=2026-10-24,interval=3,ease=2.50,reps=1)\n',
    },
    {
      id: 'n-deck-2',
      title: '02-图谱算法',
      cleanTitle: '图谱算法',
      folder: '算法专栏',
      tags: ['星图', '算法'],
      source: '---\ntitle: 图谱算法\ntags: [星图, 算法]\n---\nPageRank :: 衡量图谱中枢纽节点权重的迭代算法 @sr(due=2026-10-24,interval=1,ease=2.30,reps=1)\n\n双向BFS :: 从起点与终点同步扩展的最短路径搜索 @sr(due=2026-10-28,interval=6,ease=2.65,reps=2)\n',
    },
  ];

  const extracted = extractFlashcardsFromNotes(notes, { today: '2026-10-25' });
  assert.equal(extracted.totalCards, 4);
  assert.equal(extracted.dueCards, 3);
  assert.equal(extracted.hardCount, 2);
  assert.deepEqual(extracted.folders, ['卡片盒理论', '算法专栏']);
  assert.ok(extracted.tags.includes('双链'));
  assert.ok(extracted.tags.includes('算法'));

  const byFolder = filterFlashcardsDeck(extracted.cards, { folder: '卡片盒理论' });
  assert.equal(byFolder.length, 2);

  const byTag = filterFlashcardsDeck(extracted.cards, { tag: '#算法' });
  assert.equal(byTag.length, 2);

  const hardOnly = filterFlashcardsDeck(extracted.cards, { hardOnly: true });
  assert.equal(hardOnly.length, 2);
  assert.ok(hardOnly.every(card => card.isHardCard));

  const microDue = selectDueMicroFlashcards(extracted.cards, { limit: 3 });
  assert.equal(microDue.length, 3);
  assert.equal(microDue[0].isHardCard, true);
  assert.equal(microDue[1].isHardCard, true);
});
