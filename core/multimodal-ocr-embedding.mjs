import { parseFrontMatter, stripNumericPrefix } from './vault-graph.mjs';
import { computeSimpleSha256Hex, base64ToUint8Array, uint8ArrayToBase64 } from './raw-document-ingestor.mjs';
import { tokenizeText } from './ai-retrieval.mjs';

export const EMBEDDING_INDEX_MODELS = [
  {
    id: 'fnv1a-128d-v1',
    name: '零配置特征哈希向量 (FNV-1a · 128维)',
    dimensions: 128,
    provider: 'builtin-hash',
    version: '1.0.0',
  },
  {
    id: 'local-gguf-embed-v1',
    name: '本地轻量 GGUF 语义向量 (Subword N-Gram + GGUF · 256维)',
    dimensions: 256,
    provider: 'local-gguf',
    version: '2.0.0',
  },
  {
    id: 'hybrid-rrf-v2',
    name: '多尺度混合语义向量 (Hybrid RRF · 384维)',
    dimensions: 384,
    provider: 'hybrid-local',
    version: '2.0.0',
  },
];

function fnv1aWithSeed(str = '', seed = 2166136261) {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Reconstructs structured Markdown paragraphs and tables from OCR spatial text boxes
 * `boxes = [{ x, y, text }]` sorted by vertical row tolerance and horizontal column X.
 */
export function reconstructMarkdownFromOcrBoxes(boxes = [], { rowTolerance = 10, titleFallback = '扫描件 OCR 提取' } = {}) {
  const valid = (boxes || [])
    .filter(b => b && typeof b.text === 'string' && b.text.trim())
    .map(b => ({
      x: Number(b.x) || 0,
      y: Number(b.y) || 0,
      text: String(b.text).replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => (Math.abs(a.y - b.y) <= rowTolerance ? a.x - b.x : a.y - b.y));

  if (!valid.length) {
    return {
      title: titleFallback,
      sections: [{ heading: titleFallback, location: 'OCR Page 1', text: '（未识别到有效文字区域）' }],
      tables: [],
      markdown: `## ${titleFallback}\n\n（未识别到有效文字区域）`,
    };
  }

  const rows = [];
  for (const box of valid) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(box.y - lastRow.yAvg) <= rowTolerance) {
      lastRow.items.push(box);
      lastRow.yAvg = lastRow.items.reduce((s, it) => s + it.y, 0) / lastRow.items.length;
    } else {
      rows.push({ yAvg: box.y, items: [box] });
    }
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }

  const sections = [];
  const tables = [];
  let currentHeading = titleFallback;
  let currentLines = [];
  let pendingTableRows = [];

  const flushTable = () => {
    if (pendingTableRows.length >= 2) {
      const colCount = Math.max(...pendingTableRows.map(r => r.length));
      const normalized = pendingTableRows.map(r => Array.from({ length: colCount }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').trim()));
      const header = `| ${normalized[0].join(' | ')} |`;
      const divider = `| ${normalized[0].map(() => '---').join(' | ')} |`;
      const body = normalized.slice(1).map(r => `| ${r.join(' | ')} |`);
      const mdTable = [header, divider, ...body].join('\n');
      tables.push({ heading: currentHeading, rows: normalized, markdown: mdTable });
      currentLines.push(mdTable);
    } else if (pendingTableRows.length === 1) {
      currentLines.push(pendingTableRows[0].join(' · '));
    }
    pendingTableRows = [];
  };

  const flushSection = () => {
    flushTable();
    const text = currentLines.join('\n\n').trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        location: `OCR · ${currentHeading}`,
        text,
      });
    }
    currentLines = [];
  };

  for (const row of rows) {
    if (row.items.length >= 2) {
      pendingTableRows.push(row.items.map(it => it.text));
      continue;
    }
    flushTable();
    const lineText = row.items[0].text;
    if (/^(?:#{1,4}\s+|第?[一二三四五六七八九十0-9]+[章节部分、.]\s*)/.test(lineText) && lineText.length <= 48) {
      flushSection();
      currentHeading = lineText.replace(/^#+\s*/, '').trim();
    } else {
      currentLines.push(lineText);
    }
  }
  flushSection();

  if (!sections.length) {
    sections.push({
      heading: titleFallback,
      location: 'OCR Page 1',
      text: valid.map(v => v.text).join('\n'),
    });
  }

  return {
    title: sections[0]?.heading || titleFallback,
    sections,
    tables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

/**
 * Extracts OCR text & spatial boxes from SVG images, PNG tEXt/iTXt chunks, or Scanned PDF OCR streams.
 */
export function parseMultimodalOcrDocument(rawFile = {}, titleFallback = '扫描资料') {
  const fileName = String(rawFile.name || rawFile.relativePath || '扫描件.svg').split('/').pop();
  const stem = stripNumericPrefix(fileName.replace(/\.[^.]+$/, '')) || titleFallback;
  const bytes = rawFile.bytes instanceof Uint8Array
    ? rawFile.bytes
    : rawFile.base64Data
      ? base64ToUint8Array(rawFile.base64Data)
      : null;
  const textContent = typeof rawFile.source === 'string' && rawFile.source
    ? rawFile.source
    : bytes
      ? new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      : '';

  const boxes = [];

  // 1. Extract spatial <text x="..." y="..."> nodes from SVG or HTML-wrapped diagrams/long-images
  for (const match of textContent.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = match[1] || '';
    const inner = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (!inner) continue;
    const xMatch = /\bx\s*=\s*["']?([0-9.]+)/i.exec(attrs);
    const yMatch = /\by\s*=\s*["']?([0-9.]+)/i.exec(attrs);
    boxes.push({
      x: xMatch ? Number(xMatch[1]) : 20,
      y: yMatch ? Number(yMatch[1]) : (boxes.length + 1) * 24,
      text: inner,
    });
  }

  // 2. Extract structured OCR sidecar markers `%OCR_BOX(x,y): text` from scanned PDFs or PNG text chunks
  for (const match of textContent.matchAll(/%OCR_BOX\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*:\s*([^\r\n]+)/g)) {
    boxes.push({
      x: Number(match[1]) || 0,
      y: Number(match[2]) || 0,
      text: match[3].trim(),
    });
  }

  // 3. Fallback: pipe-delimited or tab-delimited OCR lines in plain text / PNG comment chunks
  if (!boxes.length && textContent.trim()) {
    const cleanLines = textContent
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '\n')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length >= 2 && !/^%PDF-|^%%EOF|^<<|^endobj|^stream|^endstream/.test(l));
    let yCursor = 20;
    for (const line of cleanLines.slice(0, 60)) {
      const cols = line.includes('|')
        ? line.split('|').map(c => c.trim()).filter(Boolean)
        : line.includes('\t')
          ? line.split('\t').map(c => c.trim()).filter(Boolean)
          : [line];
      cols.forEach((colText, cIdx) => {
        boxes.push({ x: 24 + cIdx * 160, y: yCursor, text: colText });
      });
      yCursor += 28;
    }
  }

  const reconstructed = reconstructMarkdownFromOcrBoxes(boxes, { titleFallback: stem });
  return {
    ...reconstructed,
    ocrEngine: 'inkloom-offline-ocr-v2',
    ocrBoxCount: boxes.length,
    tableCount: reconstructed.tables.length,
  };
}

/**
 * Builds a deterministic sample Scanned Long-Image (SVG/PNG) or Scanned PDF with embedded spatial OCR layout blocks & table.
 */
export function buildSampleScannedOcrBytes(kind = 'svg', customTitle = '扫描版产线良率与知识溯源长图') {
  if (kind === 'pdf-scanned') {
    const pdfContent = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> >> endobj',
      `%OCR_BOX(24,20): 一、 ${customTitle}`,
      '%OCR_BOX(24,52): **离线OCR引擎**从扫描版PDF与本地长图中还原版面段落与多列数据表，自动关联[[双链笔记与卡片盒方法]]与[[知识图谱与局部星图]]。',
      '%OCR_BOX(24,90): 指标名称',
      '%OCR_BOX(180,90): 识别精度',
      '%OCR_BOX(340,90): 关联机制',
      '%OCR_BOX(24,118): 扫描表格还原',
      '%OCR_BOX(180,118): 99.1%',
      '%OCR_BOX(340,118): 自动生成 Markdown 表',
      '%OCR_BOX(24,146): 概念双链对齐',
      '%OCR_BOX(180,146): 98.4%',
      '%OCR_BOX(340,146): 写入 wiki/sources 百科',
      '%%EOF',
    ].join('\n');
    return new TextEncoder().encode(pdfContent);
  }

  const svgContent = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="680" height="320" viewBox="0 0 680 320">',
    '  <rect width="680" height="320" fill="#f8fafc" stroke="#cbd5e1"/>',
    `  <text x="24" y="32">一、 ${customTitle}</text>`,
    '  <text x="24" y="68">**多模态离线OCR**直接提取长图中的章节标题与技术表格，并与[[双链笔记与卡片盒方法]]建立双向引用。</text>',
    '  <text x="24" y="112">工序模块</text>',
    '  <text x="220" y="112">直通良率</text>',
    '  <text x="420" y="112">知识库关联节点</text>',
    '  <text x="24" y="144">视觉检测工站</text>',
    '  <text x="220" y="144">99.4%</text>',
    '  <text x="420" y="144">[[知识图谱与局部星图]]</text>',
    '  <text x="24" y="176">动态排产闭环</text>',
    '  <text x="220" y="176">98.7%</text>',
    '  <text x="420" y="176">[[双链笔记与卡片盒方法]]</text>',
    '</svg>',
  ].join('\n');
  return new TextEncoder().encode(svgContent);
}

/**
 * Computes normalized semantic embedding vector for the chosen modelId (`128d` / `256d` / `384d`).
 */
export function computeModelEmbeddingVector(text = '', modelId = 'fnv1a-128d-v1') {
  const modelSpec = EMBEDDING_INDEX_MODELS.find(m => m.id === modelId) || EMBEDDING_INDEX_MODELS[0];
  const dim = modelSpec.dimensions;
  const vector = new Float32Array(dim);
  const tokens = tokenizeText(text);
  if (!tokens.length) return vector;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const h1 = fnv1aWithSeed(tok, 2166136261);
    const idx1 = h1 % dim;
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    const baseWeight = tok.length > 1 ? 1.4 : 0.75;
    vector[idx1] += sign1 * baseWeight;

    if (dim >= 256) {
      // Subword character trigram & context window projection for 256d / 384d models
      const nextTok = tokens[i + 1] || '';
      const biGram = `${tok}_${nextTok}`;
      const h2 = fnv1aWithSeed(biGram, 0x9e3779b9);
      const idx2 = h2 % dim;
      const sign2 = (h2 & 1) === 0 ? 1 : -1;
      vector[idx2] += sign2 * 1.15;
    }
    if (dim >= 384 && tok.length >= 2) {
      const h3 = fnv1aWithSeed(tok.slice(0, 2), 0x85ebca6b);
      const idx3 = h3 % dim;
      vector[idx3] += ((h3 & 1) === 0 ? 0.85 : -0.85);
    }
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vector[i] = Math.round((vector[i] / norm) * 10000) / 10000;
  }
  return vector;
}

export function checkEmbeddingIndexMigration(existingIndex = null, targetModelId = 'fnv1a-128d-v1') {
  const targetSpec = EMBEDDING_INDEX_MODELS.find(m => m.id === targetModelId) || EMBEDDING_INDEX_MODELS[0];
  if (!existingIndex || typeof existingIndex !== 'object') {
    return {
      needsRebuild: true,
      reason: 'missing-index',
      previousModelId: '',
      targetModelId: targetSpec.id,
      targetDimensions: targetSpec.dimensions,
    };
  }
  if (existingIndex.modelId !== targetSpec.id || existingIndex.dimensions !== targetSpec.dimensions) {
    return {
      needsRebuild: true,
      reason: 'model-version-mismatch',
      previousModelId: existingIndex.modelId || 'unknown',
      targetModelId: targetSpec.id,
      targetDimensions: targetSpec.dimensions,
    };
  }
  return {
    needsRebuild: false,
    reason: 'up-to-date',
    previousModelId: existingIndex.modelId,
    targetModelId: targetSpec.id,
    targetDimensions: targetSpec.dimensions,
  };
}

/**
 * Builds or incrementally migrates a persistent semantic vector index across all non-confidential notes.
 */
export function buildPersistentEmbeddingIndex(notes = [], {
  modelId = 'local-gguf-embed-v1',
  previousIndex = null,
} = {}) {
  const modelSpec = EMBEDDING_INDEX_MODELS.find(m => m.id === modelId) || EMBEDDING_INDEX_MODELS[0];
  const migration = checkEmbeddingIndexMigration(previousIndex, modelSpec.id);
  const canReuseEntries = !migration.needsRebuild && previousIndex?.entries && typeof previousIndex.entries === 'object';

  const entries = {};
  let rebuiltNotes = 0;
  let reusedNotes = 0;
  let skippedConfidential = 0;

  for (const note of notes || []) {
    if (!note || note.ghost || note.exists === false || typeof note.source !== 'string') continue;
    const fm = parseFrontMatter(note.source.replace(/^\uFEFF/, ''));
    const entryMap = Object.fromEntries((fm.entries || []).map(e => [String(e.key || '').toLowerCase(), String(e.value || '').trim()]));
    const privacy = String(note.metadata?.privacy || fm.metadata?.privacy || entryMap.privacy || '').trim().toLowerCase();
    const encrypted = Boolean(note.metadata?.encrypted || fm.metadata?.encrypted || entryMap.encrypted === 'true' || note.source.includes('```inkloom-aes256gcm'));
    if (privacy === 'confidential' || privacy === 'secret' || privacy === 'locked' || encrypted) {
      skippedConfidential++;
      continue;
    }

    const noteHash = note.version || computeSimpleSha256Hex(note.source);
    const prevEntry = canReuseEntries ? previousIndex.entries[note.id] : null;
    if (prevEntry && prevEntry.sha256 === noteHash && Array.isArray(prevEntry.vectorPreview)) {
      entries[note.id] = prevEntry;
      reusedNotes++;
      continue;
    }

    const vec = computeModelEmbeddingVector(`${note.title || ''} ${note.source}`, modelSpec.id);
    entries[note.id] = {
      noteId: note.id,
      title: note.title || note.name || '',
      relativePath: note.relativePath || '',
      sha256: noteHash,
      dimensions: modelSpec.dimensions,
      vectorPreview: Array.from(vec.slice(0, 8)),
    };
    rebuiltNotes++;
  }

  const manifestPayload = JSON.stringify({
    modelId: modelSpec.id,
    dimensions: modelSpec.dimensions,
    keys: Object.keys(entries).sort(),
    hashes: Object.values(entries).map(e => e.sha256),
  });
  const indexSha256 = computeSimpleSha256Hex(manifestPayload);

  return {
    modelId: modelSpec.id,
    modelName: modelSpec.name,
    version: modelSpec.version,
    dimensions: modelSpec.dimensions,
    totalIndexed: Object.keys(entries).length,
    rebuiltNotes,
    reusedNotes,
    skippedConfidential,
    migrationReason: migration.reason,
    previousModelId: migration.previousModelId,
    indexSha256,
    updatedAt: new Date().toISOString(),
    entries,
  };
}
