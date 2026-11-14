import { parseFrontMatter, extractWikiLinks, nonCodeLineRanges } from './vault-graph.mjs';

const VECTOR_DIM = 128;

export function tokenizeText(text = '') {
  const cleaned = String(text || '').toLocaleLowerCase();
  const tokens = [];
  const words = cleaned.match(/[a-z0-9_]{2,32}/g) || [];
  tokens.push(...words);
  const cjkBlocks = cleaned.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const block of cjkBlocks) {
    for (let i = 0; i < block.length; i++) {
      tokens.push(block[i]);
      if (i + 1 < block.length) tokens.push(block.slice(i, i + 2));
    }
  }
  return tokens;
}

function fnv1aHash(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeEmbedding(text = '') {
  const vector = new Float32Array(VECTOR_DIM);
  const tokens = tokenizeText(text);
  if (!tokens.length) return vector;
  for (const token of tokens) {
    const hash = fnv1aHash(token);
    const idx = hash % VECTOR_DIM;
    const sign = (hash & 1) === 0 ? 1 : -1;
    const weight = token.length > 1 ? 1.35 : 0.75;
    vector[idx] += sign * weight;
  }
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) vector[i] /= norm;
  }
  return vector;
}

export function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) dot += vecA[i] * vecB[i];
  return dot;
}

export function chunkNoteParagraphs(note, version = '') {
  const source = String(note.source || '');
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const fm = parseFrontMatter(source.slice(bom));
  const bodyFrom = bom + fm.bodyFrom;
  const lines = source.split('\n');
  let offset = 0;
  const lineOffsets = lines.map(line => { const cur = offset; offset += line.length + 1; return cur; });

  let currentHeading = '';
  const chunks = [];
  let buffer = [];
  let startLine = 1;
  let fromOffset = bodyFrom;

  const flush = endLine => {
    if (!buffer.length) return;
    const rawText = buffer.join('\n').trim();
    buffer = [];
    if (!rawText) return;
    const blockMatch = /(?:^|[ \t])\^([A-Za-z0-9][A-Za-z0-9_-]{0,47})[ \t]*$/m.exec(rawText);
    const blockId = blockMatch ? blockMatch[1] : '';
    const cleanText = rawText.replace(/(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]{0,47}[ \t]*$/gm, '').trim();
    if (!cleanText) return;
    const stem = String(note.relativePath || note.name || note.title || '').replace(/\.(md|markdown)$/i, '');
    const anchor = blockId ? `#^${blockId}` : (currentHeading ? `#${currentHeading}` : '');
    const relPath = note.relativePath || note.name || '';
    const lowerRel = relPath.toLowerCase();
    const wikiLayer = lowerRel === 'wiki/index.md'
      ? 'L0-Index'
      : lowerRel.startsWith('wiki/')
        ? 'L1-Wiki'
        : 'L2-Raw';
    chunks.push({
      id: `${note.id}:${startLine}-${endLine}`,
      noteId: note.id,
      title: note.title || note.name || stem,
      relativePath: relPath,
      folder: note.folder || '根目录',
      sourceFile: String(note.metadata?.source_file || ''),
      wikiLayer,
      version: version || note.version || '',
      heading: currentHeading,
      blockId,
      lineFrom: startLine,
      lineTo: endLine,
      from: fromOffset,
      text: cleanText.slice(0, 1600),
      citation: `[[${stem}${anchor}]]`,
    });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineStart = lineOffsets[idx];
    if (lineStart + lines[idx].length < bodyFrom) continue;
    const rawLine = lines[idx].replace(/\r$/, '');
    const trimmedLine = rawLine.trim();
    // Skip pure tutorial navigation bars or default empty note placeholder lines
    if (
      /^[-*_]{3,}$/.test(trimmedLine) ||
      /^>\s*(?:🧭|↩|💡)\s*\*\*(?:章节导航|快速返回|如何使用)/.test(trimmedLine) ||
      /^>\s*↩\s*\[\[00-Inkloom使用方法总目录/.test(trimmedLine) ||
      /^在此输入正文，使用\s*`?\[\[`?\s*可随时关联/.test(trimmedLine) ||
      /^<!--\s*note:.*-->$/.test(trimmedLine)
    ) {
      continue;
    }
    const headingMatch = /^\s*#{1,6}\s+(.+?)\s*$/.exec(rawLine);
    if (headingMatch) {
      flush(idx);
      currentHeading = headingMatch[1].trim();
      startLine = idx + 1;
      fromOffset = lineStart;
      continue;
    }
    if (!trimmedLine) {
      // Only flush on blank line if buffer already has enough substance (>= 140 chars),
      // so short intro sentences stay grouped with their following formula or bullet list
      if (buffer.join('\n').length >= 140) {
        flush(idx);
        startLine = idx + 2;
        fromOffset = lineOffsets[idx + 1] ?? source.length;
      }
      continue;
    }
    if (!buffer.length) {
      startLine = idx + 1;
      fromOffset = lineStart;
    }
    buffer.push(rawLine);
    if (buffer.join('\n').length >= 600) {
      flush(idx + 1);
      startLine = idx + 2;
      fromOffset = lineOffsets[idx + 1] ?? source.length;
    }
  }
  flush(lines.length);
  return chunks;
}

export function filterNotesByScope(notes, scope = {}) {
  const kind = scope?.kind || 'vault';
  const allowedIds = scope?.allowedNoteIds instanceof Set ? scope.allowedNoteIds : (Array.isArray(scope?.allowedNoteIds) ? new Set(scope.allowedNoteIds) : null);
  return notes.filter(note => {
    if (!note || note.ghost || note.exists === false) return false;
    // PRIV-001: Hard physical exclusion of confidential or AES-256-GCM encrypted notes from AI retrieval
    const rawPrivacy = String(note.metadata?.privacy || '').trim().toLowerCase();
    const isEncrypted = Boolean(
      note.metadata?.encrypted === true ||
      note.metadata?.encrypted === 'true' ||
      String(note.source || '').includes('```inkloom-aes256gcm'),
    );
    if (isEncrypted || rawPrivacy === 'confidential' || rawPrivacy === 'secret') return false;
    if (rawPrivacy === 'local-only' && scope?.provider && !['local-grounded', 'local-gguf', 'ollama'].includes(String(scope.provider).toLowerCase())) {
      return false;
    }
    if (allowedIds && !allowedIds.has(note.id)) return false;
    if (kind === 'active' || kind === 'selection') return note.id === scope.activeNoteId;
    if (kind === 'folder') return Boolean(scope.folder) && note.folder === scope.folder;
    if (kind === 'project') {
      const proj = note.metadata?.project || note.properties?.find?.(p => p.key === 'project')?.value || (note.metadata?.category === 'project' ? note.id : '');
      return Boolean(scope.projectId) && proj === scope.projectId;
    }
    if (kind === 'manuscript') {
      const ms = note.metadata?.manuscript || note.properties?.find?.(p => p.key === 'manuscript')?.value || (note.metadata?.category === 'manuscript' ? note.id : '');
      return Boolean(scope.manuscriptId) && ms === scope.manuscriptId;
    }
    return true;
  });
}

export function searchVaultContext(notes, {
  query = '',
  scope = { kind: 'vault' },
  mode = 'hybrid',
  expandLinks = true,
  limit = 8,
  versions = new Map(),
} = {}) {
  const trimmedQuery = String(query || '').trim();
  const scopedNotes = filterNotesByScope(notes, scope);
  if (!scopedNotes.length || !trimmedQuery) {
    return { chunks: [], scopedNotes: scopedNotes.map(n => ({ id: n.id, title: n.title, relativePath: n.relativePath, version: versions.get(n.id) || n.version || '' })), totalChunks: 0 };
  }

  let candidateNotes = [...scopedNotes];
  const primaryIds = new Set(scopedNotes.map(n => n.id));
  if (expandLinks && (mode === 'hybrid' || mode === 'graph')) {
    const byId = new Map(notes.map(n => [n.id, n]));
    const allowedIds = scope?.allowedNoteIds instanceof Set ? scope.allowedNoteIds : (Array.isArray(scope?.allowedNoteIds) ? new Set(scope.allowedNoteIds) : null);
    for (const note of scopedNotes) {
      for (const link of extractWikiLinks(note.source || '', note.bodyFrom || 0)) {
        const target = notes.find(candidate => candidate.title === link.target || candidate.stem === link.target || candidate.relativePath?.replace(/\.(md|markdown)$/i, '') === link.target);
        if (target && !primaryIds.has(target.id) && (!allowedIds || allowedIds.has(target.id))) {
          primaryIds.add(target.id);
          candidateNotes.push(byId.get(target.id));
        }
      }
    }
  }

  const allChunks = [];
  for (const note of candidateNotes) {
    if (scope.kind === 'selection' && note.id === scope.activeNoteId && typeof scope.selectionText === 'string' && scope.selectionText.trim()) {
      const stem = String(note.relativePath || note.name || note.title || '').replace(/\.(md|markdown)$/i, '');
      allChunks.push({
        id: `${note.id}:selection`,
        noteId: note.id,
        title: note.title || note.name || stem,
        relativePath: note.relativePath || note.name || '',
        folder: note.folder || '根目录',
        version: versions.get(note.id) || note.version || '',
        heading: '当前选区',
        blockId: '',
        lineFrom: 1,
        lineTo: 1,
        from: 0,
        text: scope.selectionText.trim().slice(0, 2000),
        citation: `[[${stem}]]`,
        isPrimaryScope: true,
      });
      continue;
    }
    for (const chunk of chunkNoteParagraphs(note, versions.get(note.id) || note.version || '')) {
      allChunks.push({ ...chunk, isPrimaryScope: scopedNotes.some(s => s.id === note.id) });
    }
  }

  const queryTokens = tokenizeText(trimmedQuery);
  const queryVec = mode === 'lexical' ? null : computeEmbedding(trimmedQuery);
  const docFreq = new Map();
  const chunkTokensList = allChunks.map(chunk => {
    const toks = tokenizeText(chunk.title + ' ' + chunk.heading + ' ' + chunk.text);
    for (const unique of new Set(toks)) docFreq.set(unique, (docFreq.get(unique) || 0) + 1);
    return toks;
  });
  const avgLen = chunkTokensList.reduce((sum, list) => sum + list.length, 0) / Math.max(1, chunkTokensList.length);
  const lowerQuery = trimmedQuery.toLocaleLowerCase();

  const scored = allChunks.map((chunk, index) => {
    const tokens = chunkTokensList[index];
    const counts = new Map();
    for (const tok of tokens) counts.set(tok, (counts.get(tok) || 0) + 1);
    let bm25 = 0;
    for (const qTok of queryTokens) {
      const tf = counts.get(qTok) || 0;
      if (!tf) continue;
      const df = docFreq.get(qTok) || 1;
      const idf = Math.log(1 + (allChunks.length - df + 0.5) / (df + 0.5));
      const normTf = (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (tokens.length / Math.max(1, avgLen))));
      bm25 += idf * normTf;
    }
    const exactBoost = (chunk.text.toLocaleLowerCase().includes(lowerQuery) ? 3.5 : 0)
      + (chunk.title.toLocaleLowerCase().includes(lowerQuery) ? 2.5 : 0)
      + (chunk.heading.toLocaleLowerCase().includes(lowerQuery) ? 1.8 : 0);
    const lexicalScore = bm25 + exactBoost;
    const vectorScore = queryVec ? Math.max(0, cosineSimilarity(queryVec, computeEmbedding(chunk.title + ' ' + chunk.heading + ' ' + chunk.text))) : 0;
    const scopeFactor = chunk.isPrimaryScope ? 1 : 0.82;
    const wikiFactor = mode === 'wiki-first'
      ? (chunk.wikiLayer === 'L0-Index' ? 1.28 : chunk.wikiLayer === 'L1-Wiki' ? 1.22 : 1.0)
      : (chunk.wikiLayer === 'L1-Wiki' ? 1.06 : 1.0);
    const totalScore = mode === 'lexical'
      ? lexicalScore * scopeFactor
      : (lexicalScore * 0.72 + (lexicalScore > 0 || vectorScore >= 0.28 ? vectorScore * 3.2 : 0)) * scopeFactor * wikiFactor;
    return {
      ...chunk,
      lexicalScore: Math.round(lexicalScore * 1000) / 1000,
      vectorScore: Math.round(vectorScore * 1000) / 1000,
      score: Math.round(totalScore * 1000) / 1000,
    };
  }).filter(item => mode === 'lexical' ? item.lexicalScore > 0 : (item.lexicalScore > 0 || (queryTokens.length >= 3 && item.vectorScore >= 0.38)));

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN') || a.lineFrom - b.lineFrom);
  const maxResults = Math.min(20, Math.max(1, Number(limit) || 8));
  return {
    chunks: scored.slice(0, maxResults),
    scopedNotes: scopedNotes.map(n => ({ id: n.id, title: n.title, relativePath: n.relativePath, version: versions.get(n.id) || n.version || '' })),
    totalChunks: allChunks.length,
  };
}
