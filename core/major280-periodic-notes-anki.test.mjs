import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeriodicNoteSpec, compilePeriodicNoteMarkdown } from './workspace-model.mjs';
import {
  extractFlashcardsFromNotes,
  exportFlashcardsToAnkiTsv,
  exportFlashcardsToAnkiDeckPackageBytes,
  parseAnkiFlashcardsImport,
  appendImportedAnkiCardsToNote,
  buildImportedAnkiDeckNoteMarkdown,
} from './spaced-repetition.mjs';
import { buildStoredZipBytes } from './raw-document-ingestor.mjs';

test('MAJOR-280: computePeriodicNoteSpec & compilePeriodicNoteMarkdown aggregate weekly/monthly/quarterly notes, tasks, and flashcards', () => {
  const weeklySpec = computePeriodicNoteSpec('weekly', '2026-11-14');
  assert.equal(weeklySpec.periodKey, '2026-W46');
  assert.equal(weeklySpec.startDate, '2026-11-09');
  assert.equal(weeklySpec.endDate, '2026-11-15');
  assert.equal(weeklySpec.relativePath, 'journals/weekly/2026-W46.md');

  const monthlySpec = computePeriodicNoteSpec('monthly', '2026-11-14');
  assert.equal(monthlySpec.periodKey, '2026-11');
  assert.equal(monthlySpec.startDate, '2026-11-01');
  assert.equal(monthlySpec.endDate, '2026-11-30');
  assert.equal(monthlySpec.relativePath, 'journals/monthly/2026-11.md');

  const quarterlySpec = computePeriodicNoteSpec('quarterly', '2026-11-14');
  assert.equal(quarterlySpec.periodKey, '2026-Q4');
  assert.equal(quarterlySpec.startDate, '2026-10-01');
  assert.equal(quarterlySpec.endDate, '2026-12-31');
  assert.equal(quarterlySpec.relativePath, 'journals/quarterly/2026-Q4.md');

  const sampleVaultNotes = [
    {
      id: 'n1',
      name: '知识图谱架构演进.md',
      relativePath: 'notes/知识图谱架构演进.md',
      source: [
        '---',
        'title: 知识图谱架构演进',
        'date: 2026-11-12',
        '---',
        '',
        '# 知识图谱架构演进',
        '',
        '本周完成了局部星图与全库图谱的数据索引整合。',
        '- [x] 完成双向链接增量索引 @due(2026-11-12)',
        '- [ ] 补充性能基准回归文档 @due(2026-11-15) @priority(high)',
      ].join('\n'),
    },
    {
      id: 'n2',
      name: '早期归档笔记.md',
      relativePath: 'archive/早期归档笔记.md',
      source: [
        '---',
        'title: 早期归档笔记',
        'date: 2026-08-01',
        '---',
        '',
        '# 早期归档笔记',
        '- [x] 八月历史任务',
      ].join('\n'),
    },
  ];

  const compiledWeekly = compilePeriodicNoteMarkdown(sampleVaultNotes, {
    periodKind: 'weekly',
    referenceDate: '2026-11-14',
    dueFlashcardCount: 4,
  });

  assert.equal(compiledWeekly.activeNoteCount, 1);
  assert.equal(compiledWeekly.doneTaskCount, 1);
  assert.equal(compiledWeekly.openTaskCount, 1);
  assert.equal(compiledWeekly.dueFlashcardCount, 4);
  assert.ok(compiledWeekly.markdown.includes('period_key: 2026-W46'));
  assert.ok(compiledWeekly.markdown.includes('[[知识图谱架构演进]]'));
  assert.ok(!compiledWeekly.markdown.includes('[[早期归档笔记]]'));
  assert.ok(compiledWeekly.markdown.includes('完成双向链接增量索引'));
  assert.ok(compiledWeekly.markdown.includes('补充性能基准回归文档'));
  assert.ok(compiledWeekly.markdown.includes('**待温习闪卡**：**4** 张'));
});

test('MAJOR-280: exportFlashcardsToAnkiTsv, exportFlashcardsToAnkiDeckPackageBytes & parseAnkiFlashcardsImport round-trip losslessly', async () => {
  const notes = [
    {
      id: 'sr-1',
      name: '卡片盒原理.md',
      folder: 'notes',
      source: [
        '---',
        'title: 卡片盒原理',
        'tags: [卡片盒, 记忆科学]',
        '---',
        '',
        '## 记忆闪卡',
        '',
        'Q: 什么是 **间隔重复** 的核心算法？',
        'A: 通过 `SM-2` 动态调整 [[复习周期|最佳间隔]] 以对抗遗忘曲线。 @sr(due=2026-11-20,interval=6,ease=2.60,reps=2)',
        '',
        '原子笔记 :: 每张卡片聚焦单一可复用命题 @sr(due=2026-11-14,interval=1,ease=2.50,reps=0)',
      ].join('\n'),
    },
  ];

  const extracted = extractFlashcardsFromNotes(notes, { today: '2026-11-14' });
  assert.equal(extracted.totalCards, 2);

  const exportedTsv = exportFlashcardsToAnkiTsv(extracted.cards, {
    deckName: 'Inkloom::卡片盒精选',
    today: '2026-11-14',
  });
  assert.equal(exportedTsv.cardCount, 2);
  assert.ok(exportedTsv.tsv.includes('#separator:tab'));
  assert.ok(exportedTsv.tsv.includes('#deck:Inkloom::卡片盒精选'));
  assert.ok(exportedTsv.tsv.includes('<code>SM-2</code>'));
  assert.ok(exportedTsv.tsv.includes('data-wikilink="复习周期|最佳间隔"'));

  const reimportedTsv = await parseAnkiFlashcardsImport(exportedTsv.tsv, { today: '2026-11-14' });
  assert.equal(reimportedTsv.deckName, 'Inkloom::卡片盒精选');
  assert.equal(reimportedTsv.cardCount, 2);
  const srCardTsv = reimportedTsv.cards.find(c => c.question.includes('间隔重复'));
  assert.ok(srCardTsv);
  assert.ok(srCardTsv.question.includes('**间隔重复**'));
  assert.ok(srCardTsv.answer.includes('`SM-2`'));
  assert.ok(srCardTsv.answer.includes('[[复习周期|最佳间隔]]'));
  assert.equal(srCardTsv.schedule.due, '2026-11-20');
  assert.equal(srCardTsv.schedule.interval, 6);
  assert.equal(srCardTsv.schedule.ease, 2.6);
  assert.equal(srCardTsv.schedule.reps, 2);

  const apkg = exportFlashcardsToAnkiDeckPackageBytes(extracted.cards, {
    deckName: 'Inkloom::卡片盒精选',
    today: '2026-11-14',
  });
  assert.ok(apkg.bytes instanceof Uint8Array);
  assert.equal(apkg.bytes[0], 0x50);
  assert.equal(apkg.bytes[1], 0x4b);
  assert.equal(apkg.cardCount, 2);

  const reimportedApkg = await parseAnkiFlashcardsImport(apkg.bytes, { today: '2026-11-14' });
  assert.equal(reimportedApkg.format, 'apkg');
  assert.equal(reimportedApkg.deckName, 'Inkloom::卡片盒精选');
  assert.equal(reimportedApkg.cardCount, 2);
  const srCardApkg = reimportedApkg.cards.find(c => c.question.includes('间隔重复'));
  assert.equal(srCardApkg.schedule.due, '2026-11-20');

  // Verify SQLite collection.anki21 0x1F unit-separator binary fallback
  const fakeSqlitePayload = new TextEncoder().encode('SQLite format 3\0...什么是主动回忆？\x1f不看原文主动提取答案以强化神经通路\x00');
  const rawApkgBytes = buildStoredZipBytes({
    'collection.anki21': fakeSqlitePayload,
    media: '{}',
  });
  const sqliteImported = await parseAnkiFlashcardsImport(rawApkgBytes, { today: '2026-11-14' });
  assert.equal(sqliteImported.format, 'apkg');
  assert.equal(sqliteImported.cardCount, 1);
  assert.equal(sqliteImported.cards[0].question, '什么是主动回忆？');

  // Verify deduplicated append into note & deck note builder
  const targetNote = { source: '---\ntitle: 学习笔记\n---\n\n# 学习笔记\n' };
  const firstAppend = appendImportedAnkiCardsToNote(targetNote, reimportedApkg.cards, { today: '2026-11-14' });
  assert.equal(firstAppend.appendedCount, 2);
  const secondAppend = appendImportedAnkiCardsToNote({ source: firstAppend.source }, reimportedApkg.cards, { today: '2026-11-14' });
  assert.equal(secondAppend.appendedCount, 0);
  assert.equal(secondAppend.skippedCount, 2);

  const deckDoc = buildImportedAnkiDeckNoteMarkdown(reimportedApkg.cards, {
    deckName: reimportedApkg.deckName,
    today: '2026-11-14',
  });
  assert.equal(deckDoc.appendedCount, 2);
  assert.ok(deckDoc.markdown.includes('## 记忆闪卡'));
});
