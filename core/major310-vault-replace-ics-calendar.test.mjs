import test from 'node:test';
import assert from 'node:assert/strict';
import { previewVaultSearchAndReplace } from './vault-doctor.mjs';
import {
  extractMarkdownTasks,
  exportTasksToIcsCalendar,
  parseIcsCalendarToTasks,
  compileImportedIcsNoteMarkdown,
  buildSampleIcsCalendar,
} from './workspace-model.mjs';

test('MAJOR-310: previewVaultSearchAndReplace supports regex capture groups, isolates code blocks, protects [[WikiLink]] targets, renames YAML keys, and builds rollback snapshot', () => {
  const sampleNotes = [
    {
      id: 'n1',
      name: '01-卡片盒架构.md',
      relativePath: 'notes/01-卡片盒架构.md',
      source: [
        '\uFEFF---',
        'title: 旧术语与卡片盒架构',
        'legacy_owner: 达芬奇Vincent',
        '---',
        '',
        '# 旧术语架构演进',
        '',
        '在正文中将「旧术语」替换为新概念，但行内代码 `旧术语` 与双链目标 [[02-旧术语索引]] 保持原样，而别名 [[02-旧术语索引|旧术语导览]] 的显示词可安全更新。',
        '',
        '```js',
        'const label = "旧术语";',
        '```',
        '',
        '阶段编号 STEP-12 与 STEP-34 升级。',
        '',
      ].join('\r\n'),
    },
    {
      id: 'n2',
      name: '02-归档记录.md',
      relativePath: 'archive/02-归档记录.md',
      source: [
        '---',
        'title: 归档记录',
        'legacy_owner: 团队',
        'owner: 已有负责人',
        '---',
        '',
        '归档目录中的旧术语。',
      ].join('\n'),
    },
  ];

  // 1. Plain text search & replace scoped to 'notes' with code & WikiLink target protection
  const textPlan = previewVaultSearchAndReplace(sampleNotes, {
    mode: 'text',
    query: '旧术语',
    replacement: '知识晶体',
    folderPrefix: 'notes',
    skipCodeBlocks: true,
    protectWikiLinkTargets: true,
  });

  assert.equal(textPlan.matchedNoteCount, 1);
  assert.equal(textPlan.totalReplacements, 3); // H1 + prose + alias after '|'
  const nextN1 = textPlan.notePlans[0].nextSource;
  assert.ok(nextN1.startsWith('\uFEFF'));
  assert.ok(nextN1.includes('\r\n'));
  // YAML title untouched by default
  assert.ok(nextN1.includes('title: 旧术语与卡片盒架构'));
  // H1 & prose updated
  assert.ok(nextN1.includes('# 知识晶体架构演进'));
  assert.ok(nextN1.includes('将「知识晶体」替换为新概念'));
  // Inline code & fenced code untouched
  assert.ok(nextN1.includes('`旧术语`'));
  assert.ok(nextN1.includes('const label = "旧术语";'));
  // WikiLink target preserved, alias updated!
  assert.ok(nextN1.includes('[[02-旧术语索引]]'));
  assert.ok(nextN1.includes('[[02-旧术语索引|知识晶体导览]]'));
  // Rollback snapshot preserves exact original source
  assert.equal(textPlan.rollbackSnapshot.entries.length, 1);
  assert.equal(textPlan.rollbackSnapshot.entries[0].originalSource, sampleNotes[0].source);

  // 2. Regex capture group replacement (`STEP-(\d+)` -> `PHASE-$1`)
  const regexPlan = previewVaultSearchAndReplace(sampleNotes, {
    mode: 'text',
    query: 'STEP-(\\d+)',
    replacement: 'PHASE-$1',
    useRegex: true,
    caseSensitive: true,
  });
  assert.equal(regexPlan.totalReplacements, 2);
  assert.ok(regexPlan.notePlans[0].nextSource.includes('PHASE-12 与 PHASE-34'));

  // 3. YAML Frontmatter key batch rename (`legacy_owner` -> `owner`, safely skipping n2 which already has `owner`)
  const yamlPlan = previewVaultSearchAndReplace(sampleNotes, {
    mode: 'yaml-key',
    query: 'legacy_owner',
    replacement: 'owner',
  });
  assert.equal(yamlPlan.matchedNoteCount, 1);
  assert.equal(yamlPlan.notePlans[0].noteId, 'n1');
  assert.ok(yamlPlan.notePlans[0].nextSource.includes('owner: 达芬奇Vincent'));
  assert.ok(!yamlPlan.notePlans[0].nextSource.includes('legacy_owner:'));
});

test('MAJOR-310: exportTasksToIcsCalendar, parseIcsCalendarToTasks & compileImportedIcsNoteMarkdown round-trip RFC 5545 events, RRULEs, and folded lines', () => {
  const sourceNote = {
    id: 'task-note-1',
    title: '研发里程碑清单',
    source: [
      '---',
      'title: 研发里程碑清单',
      '---',
      '',
      '- [ ] 架构评审会议，核对索引与图谱边界 @due(2026-11-16) @time(09:30) @priority(high) @repeat(weekly) @start(2026-11-16) @every(2) @days(MO,TH) @until(2026-12-31)',
      '- [/] 每日晨间卡片盒回顾 @due(2026-11-17) @repeat(weekdays) @start(2026-11-17)',
      '- [x] 已完成历史事项 @due(2026-11-10)',
    ].join('\n'),
  };

  const exported = exportTasksToIcsCalendar([sourceNote], {
    calendarName: '墨图研发日历',
    includeCompleted: false,
    today: '2026-11-14',
  });

  assert.equal(exported.eventCount, 2);
  assert.ok(exported.fileName.endsWith('-2026-11-14.ics'));
  assert.ok(exported.icsContent.includes('BEGIN:VCALENDAR\r\n'));
  assert.ok(exported.icsContent.includes('DTSTART:20261116T093000'));
  assert.ok(exported.icsContent.includes('PRIORITY:1'));
  assert.ok(exported.icsContent.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231'));
  assert.ok(exported.icsContent.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'));
  assert.ok(exported.icsContent.includes('STATUS:IN-PROCESS'));

  // Parse back the exported .ics (including RFC 5545 folded lines and escaped commas)
  const parsedBack = parseIcsCalendarToTasks(exported.icsContent);
  assert.equal(parsedBack.calendarName, '墨图研发日历');
  assert.equal(parsedBack.taskCount, 2);

  const first = parsedBack.tasks[0];
  assert.equal(first.title, '架构评审会议，核对索引与图谱边界');
  assert.equal(first.due, '2026-11-16');
  assert.equal(first.time, '09:30');
  assert.equal(first.priority, 'high');
  assert.equal(first.repeat, 'weekly');
  assert.equal(first.every, 2);
  assert.equal(first.days, 'MO,TH');
  assert.equal(first.until, '2026-12-31');

  const second = parsedBack.tasks[1];
  assert.equal(second.due, '2026-11-17');
  assert.equal(second.state, 'doing');
  assert.equal(second.repeat, 'weekdays');

  const compiledNote = compileImportedIcsNoteMarkdown(parsedBack.tasks, {
    calendarName: parsedBack.calendarName,
    today: '2026-11-14',
  });
  const extractedTasks = extractMarkdownTasks(compiledNote.markdown);
  assert.equal(extractedTasks.length, 2);
  assert.equal(extractedTasks[0].repeat, 'weekly');
  assert.equal(extractedTasks[0].every, 2);
  assert.equal(extractedTasks[1].repeat, 'weekdays');
  assert.equal(extractedTasks[1].state, 'doing');

  const sampleIcs = buildSampleIcsCalendar({ today: '2026-11-14' });
  const parsedSample = parseIcsCalendarToTasks(sampleIcs);
  assert.equal(parsedSample.taskCount, 2);
});
