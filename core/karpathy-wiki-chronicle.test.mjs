import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNotePrivacyState,
  canAiAccessNote,
  encryptNoteSourceAesGcm,
  decryptNoteSourceAesGcm,
  computeThermodynamicAwakening,
  analyzePercolationAndTension,
  computeHodgeTrophicHierarchy,
  detectStructuralHoleBridges,
  compressOrthogonalContext,
  buildCognitiveEvolutionChronicle,
  computeRenormalizedGraphClusters,
  runKarpathyWikiCompiler,
  compileRawDocumentToWikiBundle,
  compileMultiSourceTopicWikiPage,
  parseRawDocumentFile,
  buildSampleOfficeFileBytes,
  appendDialecticalTensionToWikiMarkdown,
  extractPreservedUserAnnotations,
  computeNoteContentFingerprint,
  detectInvalidatedWikiEvidence,
  recomputeInvalidatedWikiPage,
  extractVaultEntityRelations,
} from './karpathy-wiki-chronicle.mjs';
import { planVaultDelete, planVaultMove, planVaultFolderMove, buildVaultGraph } from './vault-graph.mjs';
import { buildVaultTree, flattenVaultTree } from './vault-tree.mjs';
import { queryGraphSnapshot } from './graph-query.mjs';
import { layoutGraph } from './graph-layout.mjs';
import { searchVaultContext } from './ai-retrieval.mjs';
import { crystallizeAnswerToNote } from './ai-assistant.mjs';
import {
  convertOneNoteToMarkdown,
  buildSampleOneNoteImportBundle,
  buildDefaultOneNoteComHierarchyXml,
  getDefaultOneNotePageXml,
  parseOneNoteHierarchyXml,
  convertOneNotePageXmlToMarkdown,
} from './onenote-importer.mjs';
import { handleMcpJsonRpcRequest, buildExternalMcpClientConfigs, validateMcpVaultRelativePath } from './mcp-stdio-protocol.mjs';
import { compileSingleFileWikiHtml } from './publication-presenter.mjs';

const sampleVault = [
  {
    id: 'raw-1',
    title: '安全库存与动态服务水平推导',
    cleanTitle: '安全库存与动态服务水平推导',
    name: 'raw-safety-stock.md',
    relativePath: 'raw/raw-safety-stock.md',
    folder: 'raw',
    tags: ['供应链', '库存模型'],
    metadata: { title: '安全库存与动态服务水平推导', date: '2026-08-15', privacy: 'public' },
    source: '---\ntitle: 安全库存与动态服务水平推导\ntags: [供应链, 库存模型]\ndate: 2026-08-15\n---\n# 安全库存推导\n\n【安全库存·策略】：动态计算\n\n安全库存必须根据需求波动标准差与提前期动态计算，严禁直接拍脑袋设置静态常数。\n',
  },
  {
    id: 'raw-2',
    title: '车间安全库存静态经验法则',
    cleanTitle: '车间安全库存静态经验法则',
    name: 'raw-static-stock.md',
    relativePath: 'raw/raw-static-stock.md',
    folder: 'raw',
    tags: ['供应链', '库存模型'],
    metadata: { title: '车间安全库存静态经验法则', date: '2026-09-10', privacy: 'local-only' },
    source: '---\ntitle: 车间安全库存静态经验法则\ntags: [供应链, 库存模型]\nprivacy: local-only\ndate: 2026-09-10\n---\n# 静态安全库存\n\n【安全库存·策略】：静态固定值\n\n在看板拉动初期，安全库存采用静态固定值更简单，无需复杂动态公式，关联 [[安全库存与动态服务水平推导]]。\n',
  },
  {
    id: 'note-agent',
    title: '受控MCP智能体回溯规划机制',
    cleanTitle: '受控MCP智能体回溯规划机制',
    name: 'agent-planning.md',
    relativePath: 'notes/agent-planning.md',
    folder: 'notes',
    tags: ['AI智能体', '任务规划'],
    metadata: { title: '受控MCP智能体回溯规划机制', date: '2026-10-05', privacy: 'public' },
    source: '---\ntitle: 受控MCP智能体回溯规划机制\ntags: [AI智能体, 任务规划]\ndate: 2026-10-05\n---\n# 智能体规划\n\n当工具调用受阻时，Agent 通过状态回溯与资源约束重排生成新提案，其数学结构与供应链安全库存动态缓冲高度同构。\n',
  },
  {
    id: 'note-secret',
    title: '核心商业底价机密档案',
    cleanTitle: '核心商业底价机密档案',
    name: 'secret-pricing.md',
    relativePath: 'vault/secret-pricing.md',
    folder: 'vault',
    tags: ['机密'],
    metadata: { title: '核心商业底价机密档案', privacy: 'confidential', date: '2026-10-20' },
    source: '---\ntitle: 核心商业底价机密档案\nprivacy: confidential\ndate: 2026-10-20\n---\n# 核心商业底价\n\n绝密协议底价为 428800 元，严禁任何 AI 读取。\n',
  },
];

test('PRIV-001 and PRIV-002 enforce three-state privacy isolation and AES-256-GCM authenticated encryption round-trip', async () => {
  assert.equal(getNotePrivacyState(sampleVault[0]).level, 'public');
  assert.equal(getNotePrivacyState(sampleVault[1]).level, 'local-only');
  assert.equal(getNotePrivacyState(sampleVault[3]).level, 'confidential');

  assert.equal(canAiAccessNote(sampleVault[1], { provider: 'local-gguf', endpoint: 'http://127.0.0.1:11435' }), true);
  assert.equal(canAiAccessNote(sampleVault[1], { provider: 'openai-compatible', endpoint: 'https://api.example.com/v1' }), false);
  assert.equal(canAiAccessNote(sampleVault[3], { provider: 'local-grounded' }), false);

  // Verify searchVaultContext physically blocks confidential notes
  const secretSearch = searchVaultContext(sampleVault, { query: '428800', scope: { kind: 'vault' } });
  assert.equal(secretSearch.chunks.length, 0);

  // Verify AES-256-GCM encryption and decryption round-trip
  const plainNote = '---\ntitle: 研发专利核心草稿\ntags: [专利]\n---\n# 专利核心公式\n\n这是受保护的机密正文段落 998877。\n';
  const encrypted = await encryptNoteSourceAesGcm(plainNote, 'InkloomPass#2026');
  assert.ok(encrypted.encryptedSource.includes('```inkloom-aes256gcm'));
  assert.ok(!encrypted.encryptedSource.includes('998877'));
  assert.equal(getNotePrivacyState(encrypted.encryptedSource).isEncrypted, true);

  await assert.rejects(() => decryptNoteSourceAesGcm(encrypted.encryptedSource, 'WrongPassphrase'), /口令校验失败/);

  const decrypted = await decryptNoteSourceAesGcm(encrypted.encryptedSource, 'InkloomPass#2026');
  assert.ok(decrypted.decryptedSource.includes('这是受保护的机密正文段落 998877。'));
  assert.equal(getNotePrivacyState(decrypted.decryptedSource).isEncrypted, false);
});

test('ALGO-001..007, Karpathy raw->wiki compiler and single-column Cognitive Evolution Chronicle produce verified outputs', async () => {
  // ALGO-001: Thermodynamic Awakening
  const awakening = computeThermodynamicAwakening(sampleVault, { activeNoteId: 'raw-1', today: '2026-10-28' });
  assert.ok(awakening.awakened.length >= 1);
  assert.ok(awakening.awakened.every(item => item.noteId !== 'note-secret'));
  assert.ok(awakening.awakened[0].awakeningScore > 0);
  assert.ok(awakening.awakened[0].channelBreakdown.length >= 1);

  // ALGO-002 & KPKM-001..003: Percolation, Hooke Tension & Karpathy Wiki Compiler
  const compiler = runKarpathyWikiCompiler(sampleVault, { today: '2026-10-28' });
  assert.ok(compiler.clusters.length >= 1);
  assert.ok(compiler.clusters[0].phi >= 0.62);
  assert.ok(compiler.tensions.length >= 1);
  assert.ok(compiler.compiledPages.length >= 1);
  assert.ok(compiler.indexMarkdown.includes('Karpathy Wiki 知识晶体总目录'));
  assert.ok(compiler.rulesMarkdown.includes('wiki/RULES.md'));
  assert.ok(compiler.logMarkdown.includes('INGEST & LINT'));

  // ALGO-003 & ALGO-004: Hodge Trophic Hierarchy & Structural Hole Bridges
  const trophic = computeHodgeTrophicHierarchy(sampleVault);
  assert.ok(trophic.nodes.length >= 3);
  const holes = detectStructuralHoleBridges(sampleVault);
  assert.ok(holes.length >= 1);

  // ALGO-005: Gram-Schmidt Orthogonal Context Compression
  const chunks = [
    { id: 'c1', title: 'A', heading: 'H1', text: '安全库存必须根据需求波动标准差动态计算', score: 3.2 },
    { id: 'c2', title: 'A-dup', heading: 'H1', text: '安全库存必须根据需求波动标准差动态计算', score: 3.1 },
    { id: 'c3', title: 'B', heading: 'H2', text: '受控智能体通过状态回溯与Fiedler谱间隙桥接跨群落盲区', score: 2.6 },
  ];
  const compressed = compressOrthogonalContext(chunks, '安全库存与智能体规划', { maxChunks: 2, mdlThreshold: 0.25 });
  assert.equal(compressed.selectedChunks.length, 2);
  assert.equal(compressed.selectedChunks[0].id, 'c1');
  assert.equal(compressed.selectedChunks[1].id, 'c3');

  // ALGO-006 & CHRON-001..003: Cognitive Evolution Chronicle
  const chronicle = buildCognitiveEvolutionChronicle(sampleVault, { today: '2026-10-28' });
  assert.ok(chronicle.milestones.length >= 2);
  assert.ok(chronicle.critique.strengths.length > 10);
  assert.ok(chronicle.critique.blindSpots.length > 10);
  assert.ok(chronicle.critique.prescription.length > 10);
  assert.ok(chronicle.chronicleMarkdown.includes('# 🌌 认知演进史'));
  for (const milestone of chronicle.milestones) assert.equal(milestone.date, sampleVault.find(note => note.id === milestone.noteId).metadata.date);
  assert.equal(chronicle.milestones[0].curvatureDeg, 0);
  const sameDayNotes = Array.from({ length: 9 }, (_, index) => ({ id: 'same-day-' + index, name: 'Same day ' + index + '.md', title: 'Same day ' + index, folder: 'notes', source: '# Recorded note\n\nIndependent source.', metadata: { date: '2026-10-21' }, tags: [] }));
  const sameDay = buildCognitiveEvolutionChronicle(sameDayNotes);
  assert.equal(sameDay.milestones.length, 8);
  assert.ok(sameDay.milestones.every(milestone => milestone.date === '2026-10-21' && milestone.rawSources.length === 0));
  const actualStructure = computeHodgeTrophicHierarchy(sameDayNotes);
  for (const milestone of sameDay.milestones) assert.equal(milestone.trophicHeight, actualStructure.byNoteId.get(milestone.noteId).trophicHeight);
  const undated = buildCognitiveEvolutionChronicle(sameDayNotes.map(note => ({ ...note, metadata: { date: 'invalid' } })));
  assert.equal(undated.milestones.length, 0); assert.equal(undated.stats.undatedNoteCount, 9); assert.equal(undated.stats.averageTrophicHeight, null);

  // ALGO-007: Block-Spin Renormalization Group Zoom
  const rg = computeRenormalizedGraphClusters(
    [
      { id: 'n1', title: '卡片1', folder: 'raw', degree: 3, pageRank: 1.4, x: 10, y: 20 },
      { id: 'n2', title: '卡片2', folder: 'raw', degree: 1, pageRank: 0.8, x: 30, y: 40 },
      { id: 'n3', title: '卡片3', folder: 'notes', degree: 2, pageRank: 1.1, x: 200, y: 180 },
    ],
    [{ source: 'n1', target: 'n3' }],
    0.4,
  );
  assert.equal(rg.scaleRegime, 'macro-galaxy');
  assert.ok(rg.superBubbles.length >= 2);

  // ONENOTE-001: OneNote Heterogeneous Rich-Media & Attachment Importer
  const oneNoteSample = buildSampleOneNoteImportBundle();
  const convertedOneNote = convertOneNoteToMarkdown(oneNoteSample.rawContent, {
    fileName: oneNoteSample.fileName,
    today: '2026-10-28',
  });
  assert.equal(convertedOneNote.stats.reordered2DCanvas, true);
  assert.equal(convertedOneNote.stats.imageCount, 1);
  assert.equal(convertedOneNote.stats.attachmentCount, 2);
  assert.equal(convertedOneNote.stats.wikiLinkCount, 2);
  assert.ok(convertedOneNote.markdown.includes('[[双链笔记与卡片盒方法]]'));
  assert.ok(convertedOneNote.markdown.includes('attachments/onenote/'));

  // ONENOTE-COM-001 (Path B): OneNote COM Hierarchy XML & Page XML Importer
  const comHierarchy = parseOneNoteHierarchyXml(buildDefaultOneNoteComHierarchyXml());
  assert.equal(comHierarchy.totalNotebooks, 2);
  assert.equal(comHierarchy.totalPages, 4);
  const comPage = convertOneNotePageXmlToMarkdown(getDefaultOneNotePageXml('{PAGE-ARCH-2026}'), {
    notebookName: '研发架构与工程笔记本',
    sectionName: '系统架构与容量规划',
    targetRootFolder: 'OneNote迁入',
    today: '2026-10-28',
  });
  assert.equal(comPage.stats.reordered2DCanvas, true);
  assert.equal(comPage.stats.imageCount, 1);
  assert.equal(comPage.stats.attachmentCount, 2);
  assert.equal(comPage.stats.wikiLinkCount, 2);
  assert.ok(comPage.markdown.indexOf('## 一、 异构画布图文与架构拓扑图') < comPage.markdown.indexOf('## 二、 架构演进对比表与跨页双链'));
  assert.ok(comPage.extractedImages[0].base64Data.length > 20);
  assert.ok(comPage.extractedAttachments[0].base64Data.length > 20);
  assert.equal(parseOneNoteHierarchyXml('').totalPages, 0);
  const missingAssets = convertOneNotePageXmlToMarkdown('<one:Page name="Missing"><one:Outline><one:OE><one:Image format="png"></one:Image></one:OE><one:OE><one:InsertedFile preferredName="missing.pdf" /></one:OE></one:Outline></one:Page>');
  assert.equal(missingAssets.extractedImages[0].base64Data, '');
  assert.equal(missingAssets.extractedAttachments[0].base64Data, '');

  // MCP-STDIO-001: External MCP JSON-RPC 2.0 Protocol Engine
  const mcpConfigs = buildExternalMcpClientConfigs();
  assert.ok(mcpConfigs.vscodeMcpJson.includes('inkloom-vault'));
  const initResp = await handleMcpJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(initResp.result.serverInfo.name, 'inkloom-vault-mcp');
  const listToolsResp = await handleMcpJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(listToolsResp.result.tools.length, 7);
  const readLockedResp = await handleMcpJsonRpcRequest(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inkloom_read_note', arguments: { titleOrPath: '核心商业底价机密档案' } } },
    { listNotes: async () => sampleVault },
  );
  assert.equal(readLockedResp.result.isError, true);
  assert.ok(readLockedResp.result.content[0].text.includes('隐私护栏拦截'));

  // RAW-INGEST-001: Multi-format raw/ document parsing (.docx, .pptx, .xlsx, .pdf) & incremental wiki/ compilation
  for (const fmt of ['docx', 'pptx', 'xlsx', 'pdf']) {
    const bytes = buildSampleOfficeFileBytes(fmt, `工程测试资料_${fmt.toUpperCase()}`);
    const parsed = await parseRawDocumentFile({
      name: `工程测试资料_${fmt.toUpperCase()}.${fmt}`,
      relativePath: `raw/工程测试资料_${fmt.toUpperCase()}.${fmt}`,
      bytes,
    });
    assert.equal(parsed.format, fmt);
    assert.ok(parsed.sections.length >= 1);
    assert.ok(parsed.extractedMarkdown.length > 20);
    const bundle = compileRawDocumentToWikiBundle(parsed, sampleVault, { today: '2026-10-29' });
    assert.ok(bundle.sourcePage.relativePath.startsWith('wiki/sources/'));
    assert.ok(bundle.sourcePage.markdown.includes(`source_file: "raw/工程测试资料_${fmt.toUpperCase()}.${fmt}"`));
  }

  // VAULT-DELETE-001: Deleting a note cleans up all incoming wikilinks/embeds (and eliminates ghost nodes) or deletes referencing files
  const deletePlan = planVaultDelete(sampleVault, { noteId: 'raw-1', cleanReferences: true });
  assert.equal(deletePlan.deletedNotes.length, 1);
  assert.equal(deletePlan.referencingNotes.length, 1);
  assert.equal(deletePlan.referencingNotes[0].noteId, 'raw-2');
  assert.equal(deletePlan.updates.length, 1);
  assert.ok(!deletePlan.updates[0].source.includes('[[安全库存与动态服务水平推导]]'));
  const survivingVault = sampleVault
    .filter(n => n.id !== 'raw-1')
    .map(n => {
      const upd = deletePlan.updates.find(u => u.noteId === n.id);
      return upd ? { ...n, source: upd.source } : n;
    });
  const rebuiltGraph = buildVaultGraph(survivingVault);
  assert.equal(rebuiltGraph.stats.ghostCount, 0);

  const cascadePlan = planVaultDelete(sampleVault, { noteId: 'raw-1', cleanReferences: true, deleteReferencingFiles: true });
  assert.ok(cascadePlan.deletedNotes.some(n => n.noteId === 'raw-1'));
  assert.ok(cascadePlan.deletedNotes.some(n => n.noteId === 'raw-2'));

  // VAULT-MOVE-001: Moving a note to a nested directory rewrites path-based wikilinks & preserves identity
  const moveVaultFixture = [
    ...sampleVault,
    {
      id: 'path-caller',
      name: '路径引用测试.md',
      title: '路径引用测试',
      relativePath: 'notes/路径引用测试.md',
      folder: 'notes',
      source: '# 路径引用\n\n参见 [[raw/raw-safety-stock#安全库存推导]]。\n',
    },
  ];
  const movePlan = planVaultMove(moveVaultFixture, 'raw-1', 'archive/2026/supply-chain', true);
  assert.equal(movePlan.newRelativePath, 'archive/2026/supply-chain/raw-safety-stock.md');
  assert.equal(movePlan.rewrittenLinks, 1);
  const callerUpdate = movePlan.updates.find(u => u.noteId === 'path-caller');
  assert.ok(callerUpdate.source.includes('[[archive/2026/supply-chain/raw-safety-stock#安全库存推导]]'));

  // KPKM-QUERY-LINT-002: Wiki-first retrieval, filing Q&A answers back into wiki/, and dialectical tension resolution
  const wikiCrystallized = crystallizeAnswerToNote({
    question: '安全库存如何结合动态服务水平计算？',
    targetFolder: 'wiki',
    response: {
      executiveSummary: '安全库存需结合需求波动标准差与动态服务水平计算。',
      modelSynthesisBlocks: [{ title: '一、 核心机制', content: '动态缓冲优于静态经验值。' }],
      citations: [{
        noteId: 'raw-1',
        title: '安全库存与动态服务水平推导',
        cleanTitle: '安全库存与动态服务水平推导',
        relativePath: 'wiki/sources/安全库存.md',
        sourceFile: 'raw/安全库存白皮书.pdf',
        heading: '公式推导',
        lineFrom: 1,
        lineTo: 8,
        snippet: '安全库存必须根据需求波动标准差动态计算。',
      }],
    },
    today: '2026-10-30',
  });
  assert.equal(wikiCrystallized.folder, 'wiki');
  assert.equal(wikiCrystallized.isWikiTarget, true);
  assert.ok(wikiCrystallized.markdown.includes('category: wiki'));
  assert.ok(wikiCrystallized.markdown.includes('raw/安全库存白皮书.pdf'));

  const tensionResolvedMd = appendDialecticalTensionToWikiMarkdown(
    '---\ntitle: "Wiki · 安全库存"\nstatus: 已结晶\n---\n\n# Wiki · 安全库存\n\n正文内容。',
    compiler.tensions[0],
    '2026-10-30',
  );
  assert.ok(tensionResolvedMd.includes('认知张力与正反边界辨析'));

  // VAULT-FOLDER-MOVE-001: Whole-folder rename/move rewrites all child note paths & incoming path links, and blocks cycle moves
  assert.throws(
    () => planVaultFolderMove(moveVaultFixture, { sourceFolder: 'raw', targetParentFolder: 'raw/sub', newFolderName: 'nested' }),
    /不能将目录移动到其自身或子目录中/,
  );
  const folderMovePlan = planVaultFolderMove(moveVaultFixture, {
    sourceFolder: 'raw',
    targetParentFolder: 'knowledge/2026',
    newFolderName: 'sources-archive',
    knownFolders: ['raw', 'raw/empty-child', 'notes'],
    autoUpdateLinks: true,
  });
  assert.equal(folderMovePlan.newFolderPath, 'knowledge/2026/sources-archive');
  assert.equal(folderMovePlan.movedNotes.length, 2);
  assert.ok(folderMovePlan.movedNotes.some(m => m.newRelativePath === 'knowledge/2026/sources-archive/raw-safety-stock.md'));
  assert.ok(folderMovePlan.movedFolders.some(f => f.newFolder === 'knowledge/2026/sources-archive/empty-child'));
  assert.equal(folderMovePlan.rewrittenLinks, 1);
  const folderCallerUpdate = folderMovePlan.updates.find(u => u.noteId === 'path-caller');
  assert.ok(folderCallerUpdate.source.includes('[[knowledge/2026/sources-archive/raw-safety-stock#安全库存推导]]'));

  // VAULT-TREE-SORT-001: Multi-dimensional tree sorting (name-asc, name-desc, date-desc, starred-first)
  const sortFixture = [
    { id: 'n-b', name: 'B-卡片.md', relativePath: 'B-卡片.md', date: '2026-10-01', starred: false, source: '# B' },
    { id: 'n-a', name: 'A-卡片.md', relativePath: 'A-卡片.md', date: '2026-10-20', starred: true, source: '# A' },
    { id: 'n-c', name: 'C-卡片.md', relativePath: 'C-卡片.md', date: '2026-10-30', starred: false, source: '# C' },
  ];
  const descTree = flattenVaultTree(buildVaultTree(sortFixture, { sortBy: 'name-desc' })).rows;
  assert.equal(descTree[0].id, 'n-c');
  const dateTree = flattenVaultTree(buildVaultTree(sortFixture, { sortBy: 'date-desc' })).rows;
  assert.equal(dateTree[0].id, 'n-c');
  assert.equal(dateTree[1].id, 'n-a');
  const starTree = flattenVaultTree(buildVaultTree(sortFixture, { sortBy: 'starred-first' })).rows;
  assert.equal(starTree[0].id, 'n-a');

  // KARPATHY-STALE-PRESERVE-001: Re-compiling a modified raw/ document preserves ## ✍️ 人工研读批注
  const docxBytesForPreserve = buildSampleOfficeFileBytes('docx', '2026企业供应链韧性架构报告');
  const parsedDocxForPreserve = await parseRawDocumentFile({
    name: '2026企业供应链韧性架构报告.docx',
    relativePath: 'raw/2026企业供应链韧性架构报告.docx',
    bytes: docxBytesForPreserve,
  });
  const existingAnnotatedWiki = {
    id: 'wiki-src-docx',
    title: '文献解析 · 2026企业供应链韧性架构报告',
    relativePath: 'wiki/sources/2026企业供应链韧性架构报告.md',
    folder: 'wiki/sources',
    metadata: { source_file: 'raw/2026企业供应链韧性架构报告.docx', source_hash: 'old-hash-000' },
    source: [
      '---',
      'title: "文献解析 · 2026企业供应链韧性架构报告"',
      'source_file: "raw/2026企业供应链韧性架构报告.docx"',
      'source_hash: "old-hash-000"',
      '---',
      '',
      '# 文献解析 · 2026企业供应链韧性架构报告',
      '',
      '## ✍️ 人工研读批注',
      '',
      '- **核心业务批注**：本报告需结合 S&OP 产销协同流程落地，重点关注动态安全库存系数。',
      '',
      '---',
      '- 🧭 所属总目录：[[Karpathy Wiki 知识晶体总目录 (index.md)|📚 返回 Wiki 总目录 (wiki/index.md)]]',
    ].join('\n'),
  };
  assert.ok(extractPreservedUserAnnotations(existingAnnotatedWiki.source).includes('核心业务批注'));
  const recompiledBundle = compileRawDocumentToWikiBundle(parsedDocxForPreserve, [...sampleVault, existingAnnotatedWiki]);
  assert.equal(recompiledBundle.sourcePage.preservedAnnotations, true);
  assert.ok(recompiledBundle.sourcePage.markdown.includes('## ✍️ 人工研读批注'));
  assert.ok(recompiledBundle.sourcePage.markdown.includes('本报告需结合 S&OP 产销协同流程落地'));

  // KARPATHY-TOPIC-SYNTHESIS-001: Multi-source topic synthesis page (wiki/topics/) combines raw/ documents + vault notes into a comparative matrix
  const existingTopicWithNotes = {
    id: 'wiki-topic-sc',
    title: compiler.clusters[0].wikiTitle,
    relativePath: `wiki/topics/${compiler.clusters[0].name}.md`,
    folder: 'wiki/topics',
    source: `# ${compiler.clusters[0].wikiTitle}\n\n## ✍️ 人工研读批注\n\n- **专题批注**：多源对账验证通过。\n`,
  };
  const topicPage = compileMultiSourceTopicWikiPage(
    compiler.clusters[0],
    compiler.rawDocuments,
    compiler.tensions,
    [...sampleVault, existingTopicWithNotes],
    { today: '2026-10-30' },
  );
  assert.equal(topicPage.folder, 'wiki/topics');
  assert.ok(topicPage.relativePath.startsWith('wiki/topics/'));
  assert.ok(topicPage.rawDocCount >= 1);
  assert.ok(topicPage.markdown.includes('跨资料核心结论与指标对照矩阵'));
  assert.ok(topicPage.markdown.includes('source_files:'));
  assert.equal(topicPage.preservedAnnotations, true);
  assert.ok(topicPage.markdown.includes('专题批注'));

  // GRAPH-REVIEW-001: Graph snapshot exposes Hodge trophic layers, inferred edges, dismissal filtering, and trophic vertical stratification
  const graphFixture = buildVaultGraph([
    ...sampleVault,
    {
      id: 'tag-peer',
      name: '库存缓冲策略.md',
      title: '库存缓冲策略',
      relativePath: 'notes/库存缓冲策略.md',
      folder: 'notes',
      tags: ['供应链', '库存模型'],
      source: '---\ntitle: 库存缓冲策略\ntags: [供应链, 库存模型]\n---\n# 库存缓冲策略\n\n无显式双链但共享供应链标签。\n',
    },
  ]);
  const snap = queryGraphSnapshot(graphFixture, 'raw-1', { scope: 'global' });
  assert.ok(snap.nodes.every(n => n.trophicLayer && n.trophicHeight >= 1));
  const inferredHit = snap.inferredEdges.find(e =>
    (e.source === 'raw-1' && e.target === 'tag-peer') || (e.source === 'tag-peer' && e.target === 'raw-1'),
  );
  assert.ok(inferredHit);
  assert.equal(inferredHit.confidence, 'INFERRED');
  const snapDismissed = queryGraphSnapshot(graphFixture, 'raw-1', {
    scope: 'global',
    dismissedEdges: [inferredHit.pairKey],
  });
  assert.ok(!snapDismissed.inferredEdges.some(e => e.pairKey === inferredHit.pairKey));

  const trophicLayout = await layoutGraph({
    mode: 'global',
    layout: 'trophic',
    spacing: 115,
    nodes: [
      { id: 'l3-node', radius: 10, trophicLayer: 'L3' },
      { id: 'l2-node', radius: 10, trophicLayer: 'L2' },
      { id: 'l1-node', radius: 10, trophicLayer: 'L1' },
    ],
    edges: [{ source: 'l1-node', target: 'l2-node' }, { source: 'l2-node', target: 'l3-node' }],
  });
  const posById = new Map(trophicLayout.nodes.map(n => [n.id, n]));
  assert.ok(posById.get('l3-node').y < posById.get('l2-node').y);
  assert.ok(posById.get('l2-node').y < posById.get('l1-node').y);

  // MCP-GUARD-001: Path traversal boundary protection & readOnly dry-run gate
  assert.throws(() => validateMcpVaultRelativePath('../../etc/passwd'), /MCP 路径边界拦截/);
  assert.throws(() => validateMcpVaultRelativePath('C:/Windows/System32/cmd.exe'), /MCP 路径边界拦截/);
  const traversalResp = await handleMcpJsonRpcRequest(
    { jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'inkloom_create_note', arguments: { title: 'Test', folder: '../outside', content: '# Hi' } } },
    { listNotes: async () => sampleVault },
  );
  assert.ok(traversalResp.error.message.includes('路径边界拦截'));

  const readOnlyCreateResp = await handleMcpJsonRpcRequest(
    { jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'inkloom_create_note', arguments: { title: 'ReadOnlyCard', folder: 'notes', content: '# DryRun' } } },
    { readOnly: true, listNotes: async () => sampleVault },
  );
  const readOnlyPayload = JSON.parse(readOnlyCreateResp.result.content[0].text);
  assert.equal(readOnlyPayload.dryRun, true);
  assert.equal(readOnlyPayload.created, false);

  // WIKI-HTML-EXPORT-001: Single-file offline wiki HTML preserves relativePath/relNoExt and interactive TOC buttons
  const wikiHtml = compileSingleFileWikiHtml([
    ...sampleVault.slice(0, 2),
    {
      id: 'topic-sc',
      title: topicPage.title,
      name: `${topicPage.cleanName}.md`,
      relativePath: topicPage.relativePath,
      folder: topicPage.folder,
      source: topicPage.markdown,
    },
  ], { siteTitle: 'Inkloom 离线知识微站验收', exportedAt: '2026-10-30' });
  assert.ok(wikiHtml.includes('data-wiki-generator="Inkloom-1.7.1"'));
  assert.ok(wikiHtml.includes('wiki/topics/'));
  assert.ok(wikiHtml.includes('data-toc-heading'));
  assert.ok(wikiHtml.includes('scrollToHeadingText'));

  // KPKM-004 & EVID-001 (1.8.0): Source-change evidence invalidation, incremental recomputation preserving annotations, and fine-grained entity relation extraction
  const fpBefore = computeNoteContentFingerprint(sampleVault[0].source);
  const fpAfter = computeNoteContentFingerprint(sampleVault[0].source + '\n新增实验观测段落：动态安全库存缓冲提升 18%。\n');
  assert.notEqual(fpBefore, fpAfter);
  assert.equal(fpBefore.length, 12);

  const compiledTopicWithFp = {
    id: 'wiki-topic-live',
    name: `${topicPage.cleanName}.md`,
    title: topicPage.title,
    relativePath: topicPage.relativePath,
    folder: topicPage.folder,
    source: topicPage.markdown,
  };
  assert.equal(detectInvalidatedWikiEvidence([...sampleVault, compiledTopicWithFp], compiler.rawDocuments).length, 0);

  const modifiedVault = sampleVault.map((n, idx) =>
    idx === 0
      ? { ...n, source: n.source + '\n\n## 新增实证数据\n\n修改了上游源笔记正文以触发 Wiki 证据失效检测。\n' }
      : n,
  );
  const invalidatedList = detectInvalidatedWikiEvidence([...modifiedVault, compiledTopicWithFp], compiler.rawDocuments);
  assert.equal(invalidatedList.length, 1);
  assert.equal(invalidatedList[0].wikiPath, topicPage.relativePath);
  assert.equal(invalidatedList[0].preservedAnnotations, true);
  assert.ok(invalidatedList[0].changedSources.some(c => c.kind === 'note-modified'));

  const recomputedTopic = recomputeInvalidatedWikiPage(
    invalidatedList[0],
    [...modifiedVault, compiledTopicWithFp],
    compiler.rawDocuments,
    compiler.clusters,
    compiler.tensions,
  );
  assert.equal(recomputedTopic.preservedAnnotations, true);
  assert.ok(recomputedTopic.markdown.includes('专题批注'));
  const afterRecomputeInvalidated = detectInvalidatedWikiEvidence(
    [...modifiedVault, { ...compiledTopicWithFp, source: recomputedTopic.markdown }],
    compiler.rawDocuments,
  );
  assert.equal(afterRecomputeInvalidated.length, 0);

  const entityRelNotes = [
    {
      id: 'ent-note-a',
      name: '架构规划.md',
      title: '架构规划',
      cleanTitle: '架构规划',
      relativePath: 'notes/架构规划.md',
      folder: 'notes',
      aliases: ['系统架构'],
      source: '---\ntitle: 架构规划\n---\n# 架构规划\n\n本系统通过 **双层星图引擎** 驱动海量节点的实时增量布局与视觉聚焦。\n',
    },
    {
      id: 'ent-note-b',
      name: '双层星图引擎.md',
      title: '双层星图引擎',
      cleanTitle: '双层星图引擎',
      relativePath: 'notes/双层星图引擎.md',
      folder: 'notes',
      aliases: ['局部与全局星图'],
      source: '---\ntitle: 双层星图引擎\n---\n# 双层星图引擎\n\n将局部 1-2 跳邻居与全局力导向图解耦。\n',
    },
  ];
  const extractedRels = extractVaultEntityRelations(entityRelNotes, [], []);
  assert.equal(extractedRels.length, 1);
  assert.equal(extractedRels[0].confidence, 'ENTITY_EXTRACTED');
  assert.equal(extractedRels[0].entityName, '双层星图引擎');
  assert.equal(extractedRels[0].relationVerb, '驱动');
  assert.ok(extractedRels[0].line >= 4);
  assert.equal(extractVaultEntityRelations(entityRelNotes, [], [extractedRels[0].pairKey]).length, 0);
});
