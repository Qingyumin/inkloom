import test from 'node:test';
import assert from 'node:assert/strict';
import { researchSource, parseBibtexEntries, parseRisEntries, parseAcademicReferences, readingNote, excerptNote, noteReference, normalizeReaderBbox, computePageLayoutBlocks, extractTextFromPageRegion, renderPageRegionSvgThumbnail, documentSourceLink, parseDocumentSourceLink, formatSplitReaderCitationBlock, detectDocumentHashDrift, syncDocumentSourceHashInMarkdown, documentExcerptNote, searchDocumentSections, compileDocumentReadingNote, manuscriptNote, manuscriptChapterNote, appendManuscriptChapter, synchronizeManuscriptStructure, formatResearchCitation, countNoteWords, extractVaultHighlights, compileHighlightsDigestMarkdown, compilePublicationManuscript } from './research-notes.mjs';
import { buildSampleOfficeFileBytes, parseRawDocumentFile, computeSimpleSha256Hex } from './raw-document-ingestor.mjs';
import { parseFrontMatter } from './vault-graph.mjs';

test('research data is structured Markdown without invented source metadata', () => {
  const source = researchSource({ title: 'Paper: one', kind: 'paper', locator: 'User supplied DOI', author: '', year: '' });
  const properties = Object.fromEntries(parseFrontMatter(source).entries.map(entry => [entry.key, entry.value]));
  assert.equal(properties.source_locator, 'User supplied DOI'); assert.equal(properties.author, ''); assert.equal(properties.year, '');
  assert.throws(() => researchSource({ title: 'Bad', locator: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => researchSource({ title: 'Bad', year: 'unknown' }), /四位/);
});
test('reading notes and excerpts retain exact snapshot text and resolvable provenance', () => {
  const reading = readingNote({ id: 'source-id', title: 'Source', relativePath: 'Research/Source.md' }); assert.ok(reading.includes('[[Research/Source]]'));
  const excerpt = excerptNote({ title: 'Excerpt', sourceTitle: 'Source', relativePath: 'Research/Source.md', blockId: 'proof', text: 'One\r\nTwo' }); assert.ok(excerpt.includes('[[Research/Source#^proof]]')); assert.ok(excerpt.includes('> One\n> Two'));
  assert.throws(() => noteReference('A#B.md'), /保留字符/);
});

test('document excerpts retain encoded local provenance and reject missing or invalid sources', () => {
  const sourceHash = 'a'.repeat(64);
  const location = { relativePath: 'raw/研究 [A]/含 空格#1.pdf', sourceHash, page: 2 };
  const reference = documentSourceLink(location);
  assert.deepEqual(parseDocumentSourceLink(reference), location);
  assert.equal(parseDocumentSourceLink('https://example.com/book.pdf'), null);
  const excerpt = documentExcerptNote({ ...location, title: 'Evidence', sourceTitle: 'Original', text: 'One\r\nTwo <script>\n![image](https://example.com)', annotation: 'My note' });
  const properties = Object.fromEntries(parseFrontMatter(excerpt).entries.map(entry => [entry.key, entry.value]));
  assert.equal(properties.source_file, location.relativePath);
  assert.equal(properties.source_hash, sourceHash);
  assert.equal(Number(properties.source_page), 2);
  assert.equal(properties.source_format, 'pdf');
  assert.ok(excerpt.includes('> One\n> Two \\<script\\>'));
  assert.ok(excerpt.includes('> \\!\\[image\\]'));
  assert.ok(excerpt.includes('## 我的批注\n\nMy note'));
  const epub = { relativePath: 'raw/book.epub', sourceHash, cfi: 'epubcfi(/6/4!/4/2/1:8)' };
  assert.deepEqual(parseDocumentSourceLink(documentSourceLink(epub)), epub);
  assert.ok(documentExcerptNote({ ...epub, title: 'EPUB', sourceTitle: 'Book', chapter: 'Chapter 2', text: 'Quoted text' }).includes('source_cfi:'));
  for (const relativePath of ['../book.pdf', 'raw/../book.pdf', 'raw//book.pdf', 'raw/C:/book.pdf', 'raw/book.txt']) assert.throws(() => documentSourceLink({ ...location, relativePath }), /raw/);
  for (const page of [0, -1, 1.5, NaN, undefined]) assert.throws(() => documentSourceLink({ ...location, page }), /页码/);
  assert.throws(() => documentSourceLink({ ...location, sourceHash: '' }), /SHA-256/);
  assert.throws(() => documentSourceLink({ ...epub, cfi: '' }), /章节/);
  assert.throws(() => documentExcerptNote({ ...location, title: 'Blank', sourceTitle: 'Original', text: ' ' }), /摘录/);
});

test('manuscript notes, chapter embeds and citations preserve CRLF and never invent metadata', () => {
  const manuscript = '\uFEFF' + manuscriptNote({ title: 'Book Draft', targetWords: 4000, synopsis: 'Core thesis' }).replaceAll('\n', '\r\n');
  const chapter = manuscriptChapterNote({ manuscriptId: 'ms-1', manuscriptTitle: 'Book Draft', chapterTitle: 'First Chapter', order: 1, targetWords: 1200 });
  const updated = appendManuscriptChapter(manuscript, 'chapters/First Chapter.md', 'First Chapter');
  assert.ok(updated.startsWith('\uFEFF'));
  assert.ok(!/(?<!\r)\n/.test(updated));
  assert.ok(updated.includes('![[chapters/First Chapter]]'));
  assert.throws(() => appendManuscriptChapter(updated, 'chapters/First Chapter.md', 'First Chapter'), /已在长稿结构中/);
  assert.equal(formatResearchCitation({ category: 'source', relativePath: 'sources/Paper.md', author: 'Lin', year: '', locator: 'DOI:10.1000/1' }), '[[sources/Paper]]（Lin，DOI:10.1000/1）');
  assert.equal(formatResearchCitation({ category: 'excerpt', sourceReference: '[[sources/Paper#^block-1]]', sourceTitle: 'Paper' }), '[[sources/Paper#^block-1]]（Paper）');
  assert.ok(countNoteWords(chapter) >= 8);
  const reordered = synchronizeManuscriptStructure(updated, [
    { relativePath: 'chapters/Second Chapter.md', title: 'Second Chapter', chapterOrder: 1 },
    { relativePath: 'chapters/First Chapter.md', title: 'First Chapter', chapterOrder: 2 },
  ]);
  assert.ok(reordered.indexOf('Second Chapter') < reordered.indexOf('First Chapter'));
});

test('extractVaultHighlights, compileHighlightsDigestMarkdown and compilePublicationManuscript aggregate highlights and compile multi-chapter manuscripts', () => {
  const sampleNotes = [
    {
      id: 'n-hl',
      title: '01-双链笔记与卡片盒方法',
      relativePath: '01-双链笔记与卡片盒方法.md',
      source: '---\ntitle: 双链笔记\n---\n# 双链笔记\n\n这里有 <mark data-color="green">原子化卡片洞见</mark> 以及 ==关键句子高亮==。\n\n> [!TIP] 卡片盒原则\n> 每张卡片只表达一个独立论点 — [[00-墨图导览与万象星图]]\n',
    },
  ];
  const allHl = extractVaultHighlights(sampleNotes, { colorFilter: 'all' });
  assert.ok(allHl.total >= 3);
  assert.equal(allHl.counts.green, 1);
  assert.equal(allHl.counts.yellow, 1);
  assert.equal(allHl.counts.quote, 1);

  const greenOnly = extractVaultHighlights(sampleNotes, { colorFilter: 'green' });
  assert.equal(greenOnly.total, 1);
  assert.equal(greenOnly.items[0].colorLabel, '浅绿高亮');

  const digestMd = compileHighlightsDigestMarkdown(allHl.items, { title: '精读批注汇编' });
  assert.ok(digestMd.includes('# 精读批注汇编'));
  assert.ok(digestMd.includes('原子化卡片洞见'));

  const compiled = compilePublicationManuscript(
    { title: '知识图谱专著', targetWords: 1000 },
    [
      { title: '第一章 · 缘起', chapterOrder: 1, source: '---\ntitle: 缘起\n---\n# 缘起\n\n本章引用 [[01-双链笔记与卡片盒方法|卡片盒方法]] 展开论述。\n' },
      { title: '第二章 · 架构', chapterOrder: 2, source: '---\ntitle: 架构\n---\n# 架构\n\n结合 [[02-知识图谱与局部星图]] 构建双层网络。\n' },
    ],
  );
  assert.equal(compiled.chapterCount, 2);
  assert.ok(compiled.markdown.includes('## 全稿目录 (TOC)'));
  assert.ok(compiled.markdown.includes('## 第 1 章 · 缘起'));
  assert.ok(compiled.markdown.includes('## 第 2 章 · 架构'));
  assert.ok(compiled.markdown.includes('卡片盒方法'));
  assert.ok(compiled.markdown.includes('## 参考文献与关联索引'));
  assert.ok(compiled.markdown.includes('- [[01-双链笔记与卡片盒方法]]'));
});

test('multi-page PDF and multi-chapter EPUB raw files parse into page/CFI sections and round-trip citations', async () => {
  const pdfBytes = buildSampleOfficeFileBytes('pdf', '智能制造与双链溯源规范');
  const pdfHash = computeSimpleSha256Hex(pdfBytes);
  const parsedPdf = await parseRawDocumentFile({
    name: '智能制造与双链溯源规范.pdf',
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    bytes: pdfBytes,
    sha256: pdfHash,
  });
  assert.equal(parsedPdf.format, 'pdf');
  assert.equal(parsedPdf.sections.length, 2);
  assert.equal(parsedPdf.sections[0].page, 1);
  assert.equal(parsedPdf.sections[1].page, 2);
  assert.ok(parsedPdf.sections[1].text.includes('Page 2'));

  const epubBytes = buildSampleOfficeFileBytes('epub', '卡片盒与知识图谱精读');
  const epubHash = computeSimpleSha256Hex(epubBytes);
  const parsedEpub = await parseRawDocumentFile({
    name: '卡片盒与知识图谱精读.epub',
    relativePath: 'raw/卡片盒与知识图谱精读.epub',
    bytes: epubBytes,
    sha256: epubHash,
  });
  assert.equal(parsedEpub.format, 'epub');
  assert.equal(parsedEpub.sections.length, 2);
  assert.equal(parsedEpub.sections[0].cfi, 'epubcfi(/6/2!/4/2/1:0)');
  assert.equal(parsedEpub.sections[1].cfi, 'epubcfi(/6/4!/4/2/1:0)');
  assert.ok(parsedEpub.sections[1].text.includes('可溯源摘录卡片'));

  const pdfCite = formatResearchCitation({
    category: 'excerpt',
    relativePath: 'excerpts/PDF第二页摘录.md',
    sourceTitle: '智能制造与双链溯源规范',
    sourceReference: documentSourceLink({ relativePath: 'raw/智能制造与双链溯源规范.pdf', sourceHash: pdfHash, page: 2 }),
  });
  assert.equal(pdfCite, '[[excerpts/PDF第二页摘录]]（智能制造与双链溯源规范 · 第 2 页）');

  const searchHit = searchDocumentSections(parsedPdf.sections, 'Page 2');
  assert.equal(searchHit.totalMatches, 1);
  assert.deepEqual(searchHit.matchedIndices, [1]);

  const readingDigest = compileDocumentReadingNote({
    title: '智能制造与双链溯源规范',
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    sourceHash: pdfHash,
    sections: parsedPdf.sections,
    excerpts: [
      {
        title: '第二页实证摘录',
        relativePath: 'excerpts/第二页实证摘录.md',
        sourceReference: documentSourceLink({ relativePath: 'raw/智能制造与双链溯源规范.pdf', sourceHash: pdfHash, page: 2 }),
      },
    ],
  });
  assert.ok(readingDigest.includes('category: reading'));
  assert.ok(readingDigest.includes('source_file: raw/智能制造与双链溯源规范.pdf'));
  assert.ok(readingDigest.includes('page=2'));
  assert.ok(readingDigest.includes('[[excerpts/第二页实证摘录]]'));

  // ITER-174 (1.7.4): Split-pane PDF/EPUB citation block & SHA-256 drift detection / one-click sync
  const splitCitation = formatSplitReaderCitationBlock({
    title: '智能制造与双链溯源规范',
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    sourceHash: pdfHash,
    page: 2,
    text: '第二页验证多页 PDF 翻页与定向回跳。',
  });
  assert.ok(splitCitation.includes('[《智能制造与双链溯源规范 · 第 2 页》](<#inkloom-reader?'));
  assert.ok(splitCitation.includes('page=2'));

  const newPdfHash = 'b'.repeat(64);
  const hashMap = new Map([['raw/智能制造与双链溯源规范.pdf', newPdfHash]]);
  const drift = detectDocumentHashDrift(
    { sourceFile: 'raw/智能制造与双链溯源规范.pdf', sourceHash: pdfHash, source: readingDigest },
    hashMap,
  );
  assert.equal(drift.drifted, true);
  assert.equal(drift.recordedHash, pdfHash);
  assert.equal(drift.currentHash, newPdfHash);

  const syncedDigest = syncDocumentSourceHashInMarkdown('\uFEFF' + readingDigest.replaceAll('\n', '\r\n'), {
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    newHash: newPdfHash,
  });
  assert.ok(syncedDigest.startsWith('\uFEFF'));
  assert.ok(!/(?<!\r)\n/.test(syncedDigest));
  assert.ok(syncedDigest.includes(`source_hash: ${newPdfHash}`));
  assert.ok(syncedDigest.includes(`hash=${newPdfHash}`));
  assert.equal(detectDocumentHashDrift({ sourceFile: 'raw/智能制造与双链溯源规范.pdf', sourceHash: newPdfHash, source: syncedDigest }, hashMap).drifted, false);

  // ITER-175 (1.7.5): BibTeX / RIS academic reference parser & 4-style citation engine (Wikilink / GB/T 7714-2015 / APA 7th / BibTeX)
  const mixedAcademicPayload = [
    '@article{luhmann1992slipbox,',
    '  title = {Communicating with Slip Boxes: An Empirical Account},',
    '  author = {Luhmann, Niklas and Ahrens, Sönke},',
    '  journal = {Journal of Knowledge Systems},',
    '  year = {1992},',
    '  volume = {19},',
    '  number = {2},',
    '  pages = {53--61},',
    '  doi = {https://doi.org/10.1000/jks.1992.53}',
    '}',
    '',
    'TY  - BOOK',
    'ID  - ahrens2022smart',
    'TI  - How to Take Smart Notes',
    'AU  - Ahrens, Sönke',
    'PY  - 2022/05/01',
    'PB  - CreateSpace Independent Publishing',
    'SP  - 1',
    'EP  - 178',
    'ER  - ',
  ].join('\n');
  const parsedRefs = parseAcademicReferences(mixedAcademicPayload);
  assert.equal(parsedRefs.length, 2);
  assert.equal(parsedRefs[0].kind, 'paper');
  assert.equal(parsedRefs[0].citeKey, 'luhmann1992slipbox');
  assert.equal(parsedRefs[0].author, 'Luhmann, Niklas; Ahrens, Sönke');
  assert.equal(parsedRefs[0].year, '1992');
  assert.equal(parsedRefs[0].pages, '53-61');
  assert.equal(parsedRefs[0].doi, '10.1000/jks.1992.53');
  assert.equal(parsedRefs[1].kind, 'book');
  assert.equal(parsedRefs[1].publisher, 'CreateSpace Independent Publishing');
  assert.equal(parsedRefs[1].year, '2022');
  assert.equal(parsedRefs[1].doi, '');

  const refItem = {
    ...parsedRefs[0],
    category: 'source',
    sourceType: parsedRefs[0].kind,
    relativePath: 'sources/Communicating with Slip Boxes.md',
  };
  const gbtCite = formatResearchCitation(refItem, 'gbt7714');
  assert.ok(gbtCite.includes('Luhmann, Niklas; Ahrens, Sönke. Communicating with Slip Boxes: An Empirical Account[J]. Journal of Knowledge Systems, 1992, 19(2): 53-61. DOI:10.1000/jks.1992.53.'));
  const apaCite = formatResearchCitation(refItem, 'apa');
  assert.ok(apaCite.includes('Luhmann, Niklas; Ahrens, Sönke. (1992). Communicating with Slip Boxes: An Empirical Account. *Journal of Knowledge Systems*, *19*(2), 53-61. https://doi.org/10.1000/jks.1992.53'));
  const bibCite = formatResearchCitation(refItem, 'bibtex');
  assert.ok(bibCite.startsWith('@article{luhmann1992slipbox,'));
  assert.ok(bibCite.includes('pages = {53-61}'));

  const gbtCompiled = compilePublicationManuscript(
    { title: '卡片盒学术综述', targetWords: 1000 },
    [
      {
        title: '第一章 · 文献基础',
        chapterOrder: 1,
        source: '---\ntitle: 文献基础\n---\n# 文献基础\n\n卢曼在 [[sources/Communicating with Slip Boxes]] 中阐述了卡片盒编码原则。\n',
      },
    ],
    {
      citationStyle: 'gbt7714',
      referenceNotes: [refItem],
    },
  );
  assert.equal(gbtCompiled.citationStyle, 'gbt7714');
  assert.ok(gbtCompiled.markdown.includes('[J]. Journal of Knowledge Systems, 1992, 19(2): 53-61. DOI:10.1000/jks.1992.53.'));

  // MAJOR-180 (1.8.0): PDF page layout blocks, canvas bbox region extraction, SVG snapshot thumbnail & bidirectional excerpt link
  const layoutBlocks = computePageLayoutBlocks(parsedPdf.sections[0], 1);
  assert.ok(layoutBlocks.length >= 2);
  const regionExtracted = extractTextFromPageRegion(layoutBlocks, { x: 0.06, y: 0.16, w: 0.88, h: 0.42 });
  assert.ok(regionExtracted.matchedBlocks.length >= 1);
  assert.ok(regionExtracted.text.includes('智能制造与双链溯源规范'));
  assert.equal(regionExtracted.bbox.bboxString, '0.060,0.160,0.880,0.420');

  const bboxExcerptMd = documentExcerptNote({
    title: '第一页画布框选摘录',
    sourceTitle: '智能制造与双链溯源规范',
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    sourceHash: pdfHash,
    page: 1,
    bbox: regionExtracted.bbox,
    text: regionExtracted.text,
    annotation: '画布级框选区域批注验证',
  });
  const bboxProps = Object.fromEntries(parseFrontMatter(bboxExcerptMd).entries.map(e => [e.key, e.value]));
  assert.equal(bboxProps.source_bbox, '0.060,0.160,0.880,0.420');
  assert.ok(bboxExcerptMd.includes('## 区域版面快照'));
  assert.ok(bboxExcerptMd.includes('![区域版面快照](data:image/svg+xml;utf8,'));
  const parsedBboxLink = parseDocumentSourceLink(bboxProps.source_reference);
  assert.equal(parsedBboxLink.page, 1);
  assert.equal(parsedBboxLink.bboxString, '0.060,0.160,0.880,0.420');
  assert.deepEqual(parsedBboxLink.bbox, { x: 0.06, y: 0.16, w: 0.88, h: 0.42 });
});