import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWLEDGE_CARD_THEMES,
  extractNoteKnowledgeCardPayload,
  renderKnowledgeShareCardSvg,
} from './publication-presenter.mjs';
import {
  computeWritingSprintStats,
  compileWritingSprintReportMarkdown,
} from './workspace-model.mjs';

test('MAJOR-290: extractNoteKnowledgeCardPayload & renderKnowledgeShareCardSvg purify wikilinks and render offline SVG cards across 4 themes', () => {
  const sampleNote = {
    id: 'note-card-1',
    name: '01-双链笔记与卡片盒方法.md',
    source: [
      '---',
      'title: 双链笔记与卡片盒方法',
      'author: 达芬奇Vincent',
      'date: 2026-11-14',
      'tags: [卡片盒, 知识图谱, 深度学习]',
      '---',
      '',
      '# 双链笔记与卡片盒方法',
      '',
      '原子笔记的核心在于将单一洞察独立成卡，并通过 [[02-知识图谱演化|万象知识星图]] 建立跨语境的双向连接。',
      '',
      '> [!TIP] 最小信息原则',
      '> 当笔记保持高内聚与低耦合时，复利效应会随时间自然涌现。',
    ].join('\n'),
  };

  const payload = extractNoteKnowledgeCardPayload(sampleNote);
  assert.equal(payload.title, '双链笔记与卡片盒方法');
  assert.equal(payload.author, '达芬奇Vincent');
  assert.equal(payload.date, '2026-11-14');
  assert.deepEqual(payload.tags, ['卡片盒', '知识图谱', '深度学习']);
  assert.ok(payload.wordCount > 20);
  assert.ok(payload.excerptText.includes('万象知识星图'));
  assert.ok(!payload.excerptText.includes('[['));

  for (const themeKey of Object.keys(KNOWLEDGE_CARD_THEMES)) {
    const rendered = renderKnowledgeShareCardSvg(sampleNote, {
      theme: themeKey,
      customAuthor: 'Vincent · 墨图印鉴',
    });
    assert.equal(rendered.theme, themeKey);
    assert.equal(rendered.width, 680);
    assert.ok(rendered.height >= 360);
    assert.ok(rendered.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(rendered.svg.includes('双链笔记与卡片盒方法'));
    assert.ok(rendered.excerptText.includes('万象知识星图'));
    assert.ok(rendered.svg.includes('原子笔记的核心在于'));
    assert.ok(rendered.svg.includes('Vincent · 墨图印鉴'));
    assert.ok(rendered.svg.includes('>墨图</text>'));
  }

  const selectionRendered = renderKnowledgeShareCardSvg(sampleNote, {
    theme: 'obsidian-gold',
    selectionText: '通过 [[03-间隔重复|SM-2 记忆算法]] 对抗遗忘曲线，让知识真正内化为长期直觉。',
  });
  assert.ok(selectionRendered.svg.includes('SM-2 记忆算法'));
  assert.ok(!selectionRendered.svg.includes('[[03-间隔重复'));
});

test('MAJOR-290: computeWritingSprintStats & compileWritingSprintReportMarkdown track daily/project word goals, streaks, and milestones', () => {
  const sampleNotes = [
    {
      id: 'd1',
      title: '周三笔记',
      date: '2026-11-12',
      source: '---\ntitle: 周三笔记\ndate: 2026-11-12\ncategory: chapter\n---\n\n' + '甲乙丙丁戊己庚辛壬癸'.repeat(60),
    },
    {
      id: 'd2',
      title: '周四笔记',
      date: '2026-11-13',
      source: '---\ntitle: 周四笔记\ndate: 2026-11-13\ncategory: chapter\n---\n\n' + '天地玄黄宇宙洪荒日月盈昃'.repeat(60),
    },
    {
      id: 'd3',
      title: '周五今日冲刺',
      date: '2026-11-14',
      source: '---\ntitle: 周五今日冲刺\ndate: 2026-11-14\ncategory: manuscript\n---\n\n' + '一念落笔万象成图知行合一'.repeat(100),
    },
  ];

  const stats = computeWritingSprintStats(sampleNotes, {
    referenceDate: '2026-11-14',
    dailyGoalWords: 1000,
    projectGoalWords: 2000,
  });

  assert.equal(stats.referenceDate, '2026-11-14');
  assert.ok(stats.todayWords >= 1200);
  assert.equal(stats.dailyProgressPct, 100);
  assert.ok(stats.totalVaultWords >= 2500);
  assert.equal(stats.projectProgressPct, 100);
  assert.equal(stats.currentStreakDays, 3);
  assert.equal(stats.bestStreakDays, 3);
  assert.equal(stats.last7Days.length, 7);
  assert.equal(stats.last7Days.at(-1).date, '2026-11-14');
  assert.equal(stats.last7Days.at(-1).reachedGoal, true);
  assert.equal(stats.milestones.find(m => m.id === 'daily-target')?.reached, true);
  assert.equal(stats.milestones.find(m => m.id === 'project-target')?.reached, true);
  assert.equal(stats.milestones.find(m => m.id === 'streak-3d')?.reached, true);

  const report = compileWritingSprintReportMarkdown(stats);
  assert.equal(report.folder, 'journals/sprints');
  assert.ok(report.markdown.includes('# 写作目标冲刺与里程碑报告 · 2026-11-14'));
  assert.ok(report.markdown.includes('- [x] **今日字数冲刺目标**'));
  assert.ok(report.markdown.includes('- [x] **全库/长稿总字数里程碑**'));
  assert.ok(report.markdown.includes('- [x] **连续创作热力打卡**'));
  assert.ok(report.markdown.includes('| 2026-11-14 |'));
});
