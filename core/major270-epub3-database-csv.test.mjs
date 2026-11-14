import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEpub3PackageBytes } from './publication-presenter.mjs';
import { unpackZipEntriesSync, parseRawDocumentFileSync } from './raw-document-ingestor.mjs';
import {
  exportDatabaseRowsToCsv,
  exportDatabaseRowsToMarkdownTable,
  parseDatabaseCsvPropertyUpdates,
} from './database-query.mjs';

test('MAJOR-270: compileEpub3PackageBytes builds valid EPUB 3.0 package and round-trips through parseRawDocumentFileSync', () => {
  const sampleNotes = [
    {
      id: 'c1',
      name: '01-双链笔记导论.md',
      relativePath: 'book/01-双链笔记导论.md',
      title: '01-双链笔记导论',
      cleanTitle: '双链笔记导论',
      source: [
        '---',
        'title: 双链笔记导论',
        'author: 达芬奇Vincent',
        'chapter_order: 1',
        '---',
        '',
        '# 双链笔记导论',
        '',
        '卡片盒方法通过 [[02-知识图谱演化|知识图谱]] 将零散笔记连接成网。',
        '',
        '- [x] 建立原子卡片',
        '- [ ] 梳理双向链接',
        '',
      ].join('\n'),
    },
    {
      id: 'c2',
      name: '02-知识图谱演化.md',
      relativePath: 'book/02-知识图谱演化.md',
      title: '02-知识图谱演化',
      cleanTitle: '知识图谱演化',
      source: [
        '---',
        'title: 知识图谱演化',
        'chapter_order: 2',
        '---',
        '',
        '# 知识图谱演化',
        '',
        '> [!TIP] 核心法则',
        '> 局部星图与全库万象星图互为表里。',
        '',
      ].join('\n'),
    },
  ];

  const pkg = compileEpub3PackageBytes(sampleNotes, {
    bookTitle: '墨图知识工程实战',
    author: '达芬奇Vincent',
  });

  assert.equal(pkg.bookTitle, '墨图知识工程实战');
  assert.equal(pkg.author, '达芬奇Vincent');
  assert.equal(pkg.chapterCount, 2);
  assert.ok(pkg.totalWords >= 20);
  assert.ok(pkg.bytes instanceof Uint8Array);
  assert.equal(pkg.bytes[0], 0x50); // 'P'
  assert.equal(pkg.bytes[1], 0x4b); // 'K'

  const zipMap = unpackZipEntriesSync(pkg.bytes);
  assert.equal(new TextDecoder().decode(zipMap.get('mimetype')), 'application/epub+zip');
  assert.ok(zipMap.has('META-INF/container.xml'));
  assert.ok(zipMap.has('OEBPS/content.opf'));
  assert.ok(zipMap.has('OEBPS/nav.xhtml'));
  assert.ok(zipMap.has('OEBPS/toc.ncx'));
  assert.ok(zipMap.has('OEBPS/chapter-1.xhtml'));
  assert.ok(zipMap.has('OEBPS/chapter-2.xhtml'));

  const parsedBack = parseRawDocumentFileSync({
    name: '墨图知识工程实战.epub',
    relativePath: 'raw/墨图知识工程实战.epub',
    base64Data: pkg.base64Data,
  });
  assert.equal(parsedBack.format, 'epub');
  assert.equal(parsedBack.title, '墨图知识工程实战');
  assert.equal(parsedBack.sections.length, 2);
  assert.ok(parsedBack.sections[0].text.includes('卡片盒方法'));
  assert.ok(parsedBack.sections[1].text.includes('局部星图'));
});

test('MAJOR-270: exportDatabaseRowsToCsv, exportDatabaseRowsToMarkdownTable & parseDatabaseCsvPropertyUpdates', () => {
  const sampleRows = [
    {
      id: 'note-1',
      name: '01-双链笔记.md',
      title: '双链笔记',
      folder: 'notes',
      status: '进行中',
      tags: ['双链', '核心'],
      date: '2026-11-10',
      taskDone: 2,
      taskCount: 4,
      wordCount: 860,
      degree: 5,
      propertyValue: '50',
      version: 'v1',
    },
    {
      id: 'note-2',
      name: '02-星图算法.md',
      title: '星图算法',
      folder: 'notes',
      status: '待办',
      tags: ['算法'],
      date: '2026-11-11',
      taskDone: 0,
      taskCount: 2,
      wordCount: 1200,
      degree: 3,
      propertyValue: '0',
      version: 'v2',
    },
  ];

  const csvOut = exportDatabaseRowsToCsv(sampleRows, { propertyKey: 'formula:task_progress' });
  assert.equal(csvOut.rowCount, 2);
  assert.ok(csvOut.csv.includes('id,title,folder,status,tags,date,taskDone,taskCount,wordCount,degree,formula:task_progress'));
  assert.ok(csvOut.csv.includes('note-1,双链笔记,notes,进行中,双链;核心,2026-11-10,2,4,860,5,50'));

  const mdOut = exportDatabaseRowsToMarkdownTable(sampleRows, {
    viewName: '进行中项目',
    propertyKey: 'formula:task_progress',
    propertyLabel: '公式: 任务完成率(%)',
  });
  assert.equal(mdOut.rowCount, 2);
  assert.ok(mdOut.markdown.includes('# 📊 多维视图汇总 · 进行中项目'));
  assert.ok(mdOut.markdown.includes('[[notes/01-双链笔记|双链笔记]]'));
  assert.ok(mdOut.markdown.includes('公式: 任务完成率(%)'));

  const batchInputCsv = [
    'title,status,tags,priority,target_words,formula:task_progress',
    '双链笔记,已完成,双链;核心;已验收,high,1500,99',
    '星图算法,进行中,算法;图论,normal,2400,50',
    '不存在的笔记,已完成,测试,low,500,0',
  ].join('\n');

  const parsedBatch = parseDatabaseCsvPropertyUpdates(batchInputCsv, sampleRows);
  assert.equal(parsedBatch.totalRows, 3);
  assert.equal(parsedBatch.matchedCount, 2);
  assert.equal(parsedBatch.unmatchedCount, 1);
  assert.deepEqual(parsedBatch.updates[0].patch, {
    status: '已完成',
    tags: ['双链', '核心', '已验收'],
    priority: 'high',
    target_words: 1500,
  });
  assert.equal('formula:task_progress' in parsedBatch.updates[0].patch, false);
});
