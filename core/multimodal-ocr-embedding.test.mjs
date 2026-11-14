import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBEDDING_INDEX_MODELS,
  reconstructMarkdownFromOcrBoxes,
  parseMultimodalOcrDocument,
  buildSampleScannedOcrBytes,
  computeModelEmbeddingVector,
  checkEmbeddingIndexMigration,
  buildPersistentEmbeddingIndex,
} from './multimodal-ocr-embedding.mjs';

test('MAJOR-200 parseMultimodalOcrDocument extracts headings, prose, and Markdown tables from scanned PDF and long-image OCR streams', () => {
  const svgBytes = buildSampleScannedOcrBytes('svg', '产线视觉检测与双链溯源长图');
  const parsedSvg = parseMultimodalOcrDocument({
    name: '产线视觉检测与双链溯源长图.svg',
    relativePath: 'raw/产线视觉检测与双链溯源长图.svg',
    bytes: svgBytes,
  });
  assert.equal(parsedSvg.ocrEngine, 'inkloom-offline-ocr-v2');
  assert.ok(parsedSvg.ocrBoxCount >= 8);
  assert.equal(parsedSvg.tables.length, 1);
  assert.ok(parsedSvg.markdown.includes('| 工序模块 | 直通良率 | 知识库关联节点 |'));
  assert.ok(parsedSvg.markdown.includes('99.4%'));

  const pdfBytes = buildSampleScannedOcrBytes('pdf-scanned', '扫描版排产规范');
  const parsedPdf = parseMultimodalOcrDocument({
    name: '扫描版排产规范.pdf',
    relativePath: 'raw/扫描版排产规范.pdf',
    bytes: pdfBytes,
  });
  assert.equal(parsedPdf.tables.length, 1);
  assert.ok(parsedPdf.markdown.includes('| 指标名称 | 识别精度 | 关联机制 |'));
  assert.ok(parsedPdf.markdown.includes('99.1%'));
});

test('MAJOR-200 buildPersistentEmbeddingIndex supports 128d/256d/384d models, incremental reuse, and smooth model version rebuild while excluding confidential notes', () => {
  assert.equal(EMBEDDING_INDEX_MODELS.length, 3);
  const v128 = computeModelEmbeddingVector('双链笔记与知识图谱余弦相似度', 'fnv1a-128d-v1');
  const v256 = computeModelEmbeddingVector('双链笔记与知识图谱余弦相似度', 'local-gguf-embed-v1');
  assert.equal(v128.length, 128);
  assert.equal(v256.length, 256);

  const sampleNotes = [
    { id: 'n1', title: '01-双链笔记', relativePath: 'notes/01.md', source: '# 双链笔记\n\n原子化概念与卡片盒连接。' },
    { id: 'n2', title: '02-知识星图', relativePath: 'notes/02.md', source: '# 知识星图\n\n力导向布局与 PageRank 中心度。' },
    { id: 'n3', title: '03-机密笔记', relativePath: 'notes/03.md', source: '---\nprivacy: confidential\n---\n# 机密\n\n不进入索引。' },
  ];

  const idx128 = buildPersistentEmbeddingIndex(sampleNotes, { modelId: 'fnv1a-128d-v1' });
  assert.equal(idx128.modelId, 'fnv1a-128d-v1');
  assert.equal(idx128.dimensions, 128);
  assert.equal(idx128.totalIndexed, 2);
  assert.equal(idx128.rebuiltNotes, 2);
  assert.equal(idx128.reusedNotes, 0);
  assert.equal(idx128.skippedConfidential, 1);

  // Incremental run with same modelId reuses unchanged notes
  const idxIncremental = buildPersistentEmbeddingIndex(sampleNotes, {
    modelId: 'fnv1a-128d-v1',
    previousIndex: idx128,
  });
  assert.equal(idxIncremental.migrationReason, 'up-to-date');
  assert.equal(idxIncremental.reusedNotes, 2);
  assert.equal(idxIncremental.rebuiltNotes, 0);

  // Switching to local-gguf-embed-v1 (256d) triggers smooth version migration rebuild
  const migrationCheck = checkEmbeddingIndexMigration(idx128, 'local-gguf-embed-v1');
  assert.equal(migrationCheck.needsRebuild, true);
  assert.equal(migrationCheck.reason, 'model-version-mismatch');

  const idx256 = buildPersistentEmbeddingIndex(sampleNotes, {
    modelId: 'local-gguf-embed-v1',
    previousIndex: idx128,
  });
  assert.equal(idx256.modelId, 'local-gguf-embed-v1');
  assert.equal(idx256.dimensions, 256);
  assert.equal(idx256.migrationReason, 'model-version-mismatch');
  assert.equal(idx256.rebuiltNotes, 2);
  assert.equal(idx256.reusedNotes, 0);
});
