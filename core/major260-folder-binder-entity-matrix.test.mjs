import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFolderManuscriptBinder } from './research-notes.mjs';
import { buildCrossChapterEntityTimelineMatrix } from './ai-assistant.mjs';

const sampleNovelNotes = [
  {
    id: 'ch-1',
    name: '第01节_少典分家.md',
    relativePath: '第01卷_万邦破晓/第01编_轩辕血火/第01章_双雄并起/第01节_少典分家.md',
    title: '第01节_少典分家',
    cleanTitle: '第01节_少典分家',
    status: '已完成',
    date: '2026-10-01',
    source: [
      '---',
      'title: 第01节_少典分家',
      'status: 已完成',
      'chapter_order: 1',
      'date: 2026-10-01',
      '---',
      '',
      '# 第01节_少典分家',
      '',
      '少典部族在渭水之畔分立两支。',
      '- 【姬轩辕·身份】：有熊少主',
      '- 【姬轩辕·兵力】：三百骨矛手',
      '- 【姜石年·驻地】：姜水西岸',
      '',
    ].join('\n'),
  },
  {
    id: 'ch-2',
    name: '第02节_河洛筑城.md',
    relativePath: '第01卷_万邦破晓/第01编_轩辕血火/第02章_有熊崛起/第02节_河洛筑城.md',
    title: '第02节_河洛筑城',
    cleanTitle: '第02节_河洛筑城',
    status: '进行中',
    date: '2026-10-05',
    source: [
      '---',
      'title: 第02节_河洛筑城',
      'status: 进行中',
      'chapter_order: 2',
      'date: 2026-10-05',
      '---',
      '',
      '# 第02节_河洛筑城',
      '',
      '轩辕率部东出河洛，合诸部筑起夯土高台。',
      '- 【姬轩辕·身份】：有熊盟主',
      '- 【姬轩辕·兵力】：三千甲士',
      '- 【风后·职司】：天象军师',
      '',
    ].join('\n'),
  },
  {
    id: 'other-note',
    name: '00-导览.md',
    relativePath: 'Inkloom使用方法/00-导览.md',
    title: '00-导览',
    cleanTitle: '00-导览',
    status: '已就绪',
    source: '# 00-导览\n\n使用说明正文。\n',
  },
];

test('MAJOR-260: compileFolderManuscriptBinder recursively maps multi-level folders into Manuscript Binder MOC', () => {
  const binder = compileFolderManuscriptBinder(sampleNovelNotes, {
    folderPath: '第01卷_万邦破晓',
    title: '万邦破晓 · 第一卷总览',
    targetWords: 2000,
  });

  assert.equal(binder.title, '万邦破晓 · 第一卷总览');
  assert.equal(binder.folderPath, '第01卷_万邦破晓');
  assert.equal(binder.chapterCount, 2);
  assert.equal(binder.sectionGroupCount, 2);
  assert.ok(binder.totalWords > 40);
  assert.ok(binder.markdown.includes('category: manuscript'));
  assert.ok(binder.markdown.includes('binder_folder: 第01卷_万邦破晓'));
  assert.ok(binder.markdown.includes('## 分卷与子目录进度汇总'));
  assert.ok(binder.markdown.includes('## 分章编排与字数总览表'));
  assert.ok(binder.markdown.includes('[[第01卷_万邦破晓/第01编_轩辕血火/第01章_双雄并起/第01节_少典分家]]'));
  assert.ok(binder.markdown.includes('![[第01卷_万邦破晓/第01编_轩辕血火/第02章_有熊崛起/第02节_河洛筑城]]'));
});

test('MAJOR-260: buildCrossChapterEntityTimelineMatrix extracts cross-chapter entity evolution and timeline table', () => {
  const matrix = buildCrossChapterEntityTimelineMatrix(sampleNovelNotes, {
    folderPath: '第01卷_万邦破晓',
  });

  assert.equal(matrix.folderPath, '第01卷_万邦破晓');
  assert.equal(matrix.totalNotes, 2);
  assert.equal(matrix.entityCount, 3);
  assert.equal(matrix.attributeRecordCount, 6);
  assert.equal(matrix.conflictCount, 2);
  assert.equal(matrix.timelineCount, 2);

  const xuanyuan = matrix.entities.find(e => e.entity === '姬轩辕');
  assert.ok(xuanyuan);
  assert.equal(xuanyuan.appearanceCount, 2);
  assert.equal(xuanyuan.conflictCount, 2);
  assert.ok(xuanyuan.attributeSummary.includes('有熊少主 → 有熊盟主'));
  assert.ok(xuanyuan.attributeSummary.includes('三百骨矛手 → 三千甲士'));
  assert.ok(matrix.markdown.includes('## 一、 人物与核心概念跨章设定矩阵'));
  assert.ok(matrix.markdown.includes('## 二、 章节时间线与目录叙事序列'));
});
