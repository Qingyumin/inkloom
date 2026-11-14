import { isMap, parseDocument as parseYamlDocument } from '../app/node_modules/yaml/browser/index.js';
import { extractMarkdownTasks } from './workspace-model.mjs';

export function normalizeNoteKey(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.(md|markdown|txt)$/i, '')
    .replace(/^\.\//, '')
    .toLowerCase();
}

export function stripNumericPrefix(name) {
  const stem = String(name || '')
    .replace(/\.(md|markdown|txt)$/i, '')
    .trim();
  if (/^\d{4}[-_.]\d{2}[-_.]\d{2}/.test(stem)) return stem;
  return stem.replace(/^\d+(?:\.\d+)?[-_.\s]+/, '').trim();
}

export function headingSlug(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\t]+/g, '-')
    .replace(/[?:!.,;'"()[\]{}<>/\\|]+/g, '');
}

export function parseFrontMatter(source = '') {
  const text = String(source || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { metadata: {}, entries: [], bodyFrom: 0, raw: '' };
  }
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { metadata: {}, entries: [], bodyFrom: 0, raw: '' };
  let closingLine = -1;
  let offset = lines[0].length + (text[lines[0].length] === '\r' ? 2 : 1);
  let yamlEndOffset = -1;
  for (let i = 1; i < lines.length; i++) {
    const lineLen = lines[i].length + (text.slice(offset + lines[i].length, offset + lines[i].length + 2) === '\r\n' ? 2 : 1);
    if (lines[i].trim() === '---') {
      closingLine = i;
      yamlEndOffset = offset;
      offset += Math.min(lineLen, text.length - offset);
      break;
    }
    offset += lineLen;
  }
  if (closingLine < 0) return { metadata: {}, entries: [], bodyFrom: 0, raw: '' };
  const yamlContent = text.slice(text.indexOf('\n') + 1, yamlEndOffset);
  try {
    const doc = parseYamlDocument(yamlContent, { prettyErrors: false, uniqueKeys: false });
    if (doc.errors.length || !isMap(doc.contents)) {
      return { metadata: {}, entries: [], bodyFrom: offset, raw: text.slice(0, offset) };
    }
    const rawObj = doc.toJS({ maxAliasCount: 50 }) || {};
    const entries = Object.entries(rawObj).map(([key, val]) => ({
      key: String(key),
      value: Array.isArray(val) ? val.map(String).join(', ') : val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val),
    }));
    const toList = value => {
      if (!value) return [];
      if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
      return String(value).split(/[,，;；]/).map(item => item.trim()).filter(Boolean);
    };
    const metadata = {
      title: rawObj.title ? String(rawObj.title).trim() : '',
      aliases: toList(rawObj.aliases || rawObj.alias),
      tags: toList(rawObj.tags || rawObj.tag).map(tag => tag.replace(/^#+/, '')),
      status: rawObj.status ? String(rawObj.status).trim() : '',
      date: rawObj.date ? String(rawObj.date).trim() : '',
      category: rawObj.category ? String(rawObj.category).trim() : '',
      summary: rawObj.summary ? String(rawObj.summary).trim() : '',
      ...(rawObj.source_file ? { source_file: String(rawObj.source_file).trim() } : {}),
      ...(rawObj.source_hash ? { source_hash: String(rawObj.source_hash).trim() } : {}),
      ...(rawObj.source_files ? { source_files: toList(rawObj.source_files) } : {}),
      ...(rawObj.source_notes ? { source_notes: toList(rawObj.source_notes) } : {}),
      ...(rawObj.source_fingerprints ? { source_fingerprints: toList(rawObj.source_fingerprints) } : {}),
      ...(rawObj.entity_type ? { entity_type: String(rawObj.entity_type).trim() } : {}),
    };
    return { metadata, entries, bodyFrom: offset, raw: text.slice(0, offset) };
  } catch {
    return { metadata: {}, entries: [], bodyFrom: 0, raw: '' };
  }
}

export function nonCodeLineRanges(source = '', startOffset = 0) {
  const text = String(source || '');
  const ranges = [];
  let pos = 0;
  let lineNum = 1;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const from = pos;
    const to = pos + line.length;
    pos += rawLine.length + 1;
    if (to <= startOffset) {
      lineNum++;
      continue;
    }
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
        fenceLength = fenceMatch[1].length;
      } else if (marker === fenceChar && fenceMatch[1].length >= fenceLength && line.slice(fenceMatch[0].length).trim() === '') {
        inFence = false;
        fenceChar = '';
      }
      lineNum++;
      continue;
    }
    if (!inFence && !/^(?: {4}|\t)/.test(line)) {
      ranges.push({ lineNum, from, to, text: line });
    }
    lineNum++;
  }
  return ranges;
}

export function maskInlineCode(lineText) {
  return lineText.replace(/`+[^`]*`+/g, match => ' '.repeat(match.length));
}

export function extractHeadings(source = '', bodyFrom = 0) {
  const headings = [];
  for (const line of nonCodeLineRanges(source, bodyFrom)) {
    const match = /^\s*(#{1,6})\s+(.+?)\s*#*$/.exec(line.text);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target).trim();
    if (!text) continue;
    headings.push({
      level,
      text,
      slug: headingSlug(text),
      from: line.from,
      to: line.to,
      line: line.lineNum,
    });
  }
  return headings;
}

export function extractTags(source = '', frontMatterTags = [], bodyFrom = 0) {
  const tagSet = new Set();
  for (const tag of frontMatterTags || []) {
    const cleaned = String(tag || '').trim().replace(/^#+/, '');
    if (cleaned) tagSet.add(cleaned);
  }
  for (const line of nonCodeLineRanges(source, bodyFrom)) {
    if (/^\s*#{1,6}\s/.test(line.text)) continue;
    const masked = maskInlineCode(line.text).replace(/https?:\/\/[^\s)]+/g, match => ' '.repeat(match.length));
    const regex = /(?:^|[\s([\u3000，。；：、「『【])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
    for (const match of masked.matchAll(regex)) {
      const candidate = match[1];
      if (/^[0-9a-fA-F]{3,8}$/.test(candidate) || /^\d+$/.test(candidate)) continue;
      tagSet.add(candidate);
    }
  }
  return [...tagSet];
}

export function parseWikiLinkBody(inner = '') {
  const rawInner = String(inner || '').trim();
  const pipeIndex = rawInner.indexOf('|');
  const pathPart = (pipeIndex >= 0 ? rawInner.slice(0, pipeIndex) : rawInner).trim();
  const alias = pipeIndex >= 0 ? rawInner.slice(pipeIndex + 1).trim() : '';
  const hashIndex = pathPart.indexOf('#');
  const target = (hashIndex >= 0 ? pathPart.slice(0, hashIndex) : pathPart).trim();
  const heading = hashIndex >= 0 ? pathPart.slice(hashIndex + 1).trim() : '';
  const display = alias || (target && heading ? `${stripNumericPrefix(target)} · ${heading}` : target ? stripNumericPrefix(target) : heading ? `#${heading}` : rawInner);
  return { target, heading, alias, display };
}

export function extractWikiLinks(source = '', bodyFrom = 0) {
  const links = [];
  for (const line of nonCodeLineRanges(source, bodyFrom)) {
    const masked = maskInlineCode(line.text);
    const regex = /(!?)\[\[([^\][\n]+?)\]\]/g;
    for (const match of masked.matchAll(regex)) {
      const embed = match[1] === '!';
      const inner = line.text.slice(match.index + match[1].length + 2, match.index + match[0].length - 2);
      const parsed = parseWikiLinkBody(inner);
      if (!parsed.target && !parsed.heading) continue;
      const from = line.from + match.index;
      const to = from + match[0].length;
      const snippet = line.text
        .replace(/^\s*(?:[-*+]|\d+\.|>+|\#{1,6})\s*/, '')
        .replace(/!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, t, h, a) => a || (t && h ? `${stripNumericPrefix(t)}#${h}` : stripNumericPrefix(t || h)))
        .trim()
        .slice(0, 140);
      links.push({
        raw: line.text.slice(match.index, match.index + match[0].length),
        inner,
        from,
        to,
        line: line.lineNum,
        embed,
        target: parsed.target,
        heading: parsed.heading,
        alias: parsed.alias,
        display: parsed.display,
        snippet: snippet || parsed.display,
      });
    }
  }
  return links;
}

export function purifyWikiLinksForExport(source = '') {
  const text = String(source || '');
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  return lines.map(rawLine => {
    const hasCR = rawLine.endsWith('\r');
    const line = hasCR ? rawLine.slice(0, -1) : rawLine;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) { inFence = true; fenceChar = marker; }
      else if (marker === fenceChar) { inFence = false; fenceChar = ''; }
      return rawLine;
    }
    if (inFence) return rawLine;
    let cursor = 0;
    let output = '';
    const codeRegex = /`+[^`]*`+/g;
    const replaceSegment = segment => segment.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (_, embed, inner) => {
      const parsed = parseWikiLinkBody(inner);
      return parsed.display || inner;
    });
    for (const match of line.matchAll(codeRegex)) {
      output += replaceSegment(line.slice(cursor, match.index));
      output += match[0];
      cursor = match.index + match[0].length;
    }
    output += replaceSegment(line.slice(cursor));
    return hasCR ? output + '\r' : output;
  }).join('\n');
}

export function unescapeWikiLinksInMarkdown(source = '') {
  const text = String(source || '');
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  return lines.map(rawLine => {
    const hasCR = rawLine.endsWith('\r');
    const line = hasCR ? rawLine.slice(0, -1) : rawLine;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) { inFence = true; fenceChar = marker; }
      else if (marker === fenceChar) { inFence = false; fenceChar = ''; }
      return rawLine;
    }
    if (inFence) return rawLine;
    let cursor = 0;
    let output = '';
    const codeRegex = /`+[^`]*`+/g;
    const cleanSegment = segment => {
      let s = segment.replace(/(!?)(?:\\?\[){2,}([^\][\n\\]+?)(?:\\?\]){2,}/g, '$1[[$2]]');
      s = s.replace(/(?:\\?\[)+(\[\[[^\][\n]+\]\])(?:\\?\])+/g, '$1');
      s = s.replace(/(\[\[[^\][\n]+\]\])(?:\s*(?:\\?\[)*\1(?:\\?\])*)+/g, '$1');
      s = s.replace(/(?:\\?\[){2,}([^\][\n\\|]+?)\|(?=\s*(?:@sr\(|\r?$))/g, '[[$1]]');
      return s;
    };
    for (const match of line.matchAll(codeRegex)) {
      output += cleanSegment(line.slice(cursor, match.index));
      output += match[0];
      cursor = match.index + match[0].length;
    }
    output += cleanSegment(line.slice(cursor));
    return hasCR ? output + '\r' : output;
  }).join('\n');
}

function summarizeNoteExcerpt(source = '', bodyFrom = 0) {
  for (const line of nonCodeLineRanges(source, bodyFrom)) {
    const trimmed = line.text.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^\|/.test(trimmed) || /^---+$/.test(trimmed) || /^\[toc\]$/i.test(trimmed)) continue;
    const clean = trimmed
      .replace(/^>\s*(?:\[![A-Z]+\]\s*)?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, t, h, a) => a || stripNumericPrefix(t || h))
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    if (clean.length >= 6) return clean.slice(0, 160);
  }
  return '暂无摘要内容';
}

export function parseVaultNote(item) {
  const source = String(item.source ?? item.text ?? '');
  const name = item.name || (item.path ? item.path.split(/[\\/]/).pop() : '未命名.md');
  const stem = name.replace(/\.(md|markdown|txt)$/i, '');
  const cleanTitle = stripNumericPrefix(stem) || stem;
  const relativePath = (item.relativePath || item.vaultPath || name).replace(/\\/g, '/').replace(/^\.\//, '');
  const folder = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '根目录';
  const { metadata, entries, bodyFrom } = parseFrontMatter(source);
  return {
    id: item.id || relativePath, name, stem, cleanTitle,
    title: metadata.title || cleanTitle || stem, label: cleanTitle || metadata.title || stem,
    path: item.path || relativePath, relativePath, folder, source, bodyFrom, metadata,
    properties: entries, aliases: metadata.aliases || [],
    tags: extractTags(source, metadata.tags, bodyFrom), status: metadata.status || '', date: metadata.date || '',
    headings: extractHeadings(source, bodyFrom), wikiLinks: extractWikiLinks(source, bodyFrom), tasks: extractMarkdownTasks(source, bodyFrom),
    excerpt: summarizeNoteExcerpt(source, bodyFrom), starred: Boolean(item.starred), updatedAt: item.updatedAt || null,
    exists: true, ghost: false, inDegree: 0, outDegree: 0, degree: 0,
  };
}

export function buildVaultGraph(rawNotes = [], { includeMentions = true } = {}) {
  const notes = [];
  const keyToNoteId = new Map();
  const registerKey = (key, noteId, priority = false) => {
    const normalized = normalizeNoteKey(key);
    if (!normalized) return;
    if (!keyToNoteId.has(normalized)) keyToNoteId.set(normalized, new Set());
    keyToNoteId.get(normalized).add(noteId);
  };

  for (const item of rawNotes) {
    const note = parseVaultNote(item);
    notes.push(note);

    registerKey(note.relativePath, note.id, true);
    registerKey(note.stem, note.id, true);
    registerKey(note.cleanTitle, note.id, false);
    if (note.metadata.title) registerKey(note.metadata.title, note.id, false);
    for (const alias of note.aliases) registerKey(alias, note.id, false);
  }

  const nodeMap = new Map(notes.map(note => [note.id, note]));
  const ghostMap = new Map();
  const edges = [];
  const backlinksByNote = new Map(notes.map(note => [note.id, []]));
  const outgoingByNote = new Map(notes.map(note => [note.id, []]));

  const resolveTargetId = (target, sourceNoteId) => {
    if (!target) return sourceNoteId;
    const normalized = normalizeNoteKey(target);
    const sourceNote = nodeMap.get(sourceNoteId);
    const folder = sourceNote?.relativePath.split('/').slice(0, -1).join('/') || '';
    const collapse = value => {
      const parts = [];
      for (const segment of value.split('/')) {
        if (segment === '..') { if (!parts.length) return null; parts.pop(); }
        else if (segment && segment !== '.') parts.push(segment);
      }
      return parts.join('/');
    };
    const relative = collapse((folder ? folder + '/' : '') + normalized);
    const local = notes.filter(note => normalizeNoteKey(note.relativePath) === relative);
    if (local.length === 1 && (!normalized.includes('/') || /^[.]{1,2}\//.test(target))) return local[0].id;
    const exact = notes.filter(note => normalizeNoteKey(note.relativePath) === normalized);
    if (exact.length === 1) return exact[0].id;
    const direct = keyToNoteId.get(normalized);
    if (direct?.size === 1) return [...direct][0];
    if (direct?.size > 1) return null;
    const stripped = keyToNoteId.get(normalizeNoteKey(stripNumericPrefix(target)));
    if (stripped?.size === 1) return [...stripped][0];
    return null;
  };

  for (const note of notes) {
    const seenTargets = new Set();
    for (const link of note.wikiLinks) {
      const resolvedId = resolveTargetId(link.target, note.id);
      let targetNode;
      let isGhost = false;
      if (resolvedId && nodeMap.has(resolvedId)) {
        targetNode = nodeMap.get(resolvedId);
      } else {
        isGhost = true;
        const ghostKey = normalizeNoteKey(link.target);
        const ghostId = 'ghost:' + ghostKey;
        targetNode = ghostMap.get(ghostId);
        if (!targetNode) {
          targetNode = {
            id: ghostId,
            name: link.target + '.md',
            stem: link.target,
            cleanTitle: stripNumericPrefix(link.target) || link.target,
            title: stripNumericPrefix(link.target) || link.target,
            label: stripNumericPrefix(link.target) || link.target,
            path: null,
            relativePath: link.target + '.md',
            folder: '待建节点',
            source: '',
            metadata: {},
            properties: [],
            aliases: [],
            tags: [],
            status: '待创建',
            headings: [],
            wikiLinks: [],
            excerpt: '尚未创建的双链主题，点击即可一键新建该笔记。',
            starred: false,
            exists: false,
            ghost: true,
            inDegree: 0,
            outDegree: 0,
            degree: 0,
          };
          ghostMap.set(ghostId, targetNode);
          backlinksByNote.set(ghostId, []);
        }
      }

      const outgoingRecord = {
        ...link,
        sourceId: note.id,
        targetId: targetNode.id,
        targetTitle: targetNode.title,
        targetName: targetNode.name,
        ghost: isGhost,
      };
      outgoingByNote.get(note.id).push(outgoingRecord);

      if (targetNode.id !== note.id) {
        backlinksByNote.get(targetNode.id)?.push({
          sourceId: note.id,
          sourceTitle: note.title,
          sourceName: note.name,
          sourcePath: note.relativePath,
          targetId: targetNode.id,
          heading: link.heading,
          alias: link.alias,
          snippet: link.snippet,
          from: link.from,
          to: link.to,
          line: link.line,
        });

        const edgeKey = `${note.id}->${targetNode.id}`;
        if (!seenTargets.has(edgeKey)) {
          seenTargets.add(edgeKey);
          edges.push({
            id: edgeKey,
            source: note.id,
            target: targetNode.id,
            heading: link.heading,
            alias: link.alias,
            snippet: link.snippet,
            ghost: isGhost,
            kind: 'wikilink',
          });
          note.outDegree++;
          targetNode.inDegree++;
        }
      }
    }
  }

  const allNodes = [...notes, ...ghostMap.values()];
  for (const node of allNodes) {
    node.degree = node.inDegree + node.outDegree;
    node.orphan = node.exists && node.degree === 0;
  }

  // Compute Unlinked Mentions (potential mentions of existing notes in other notes)
  const unlinkedMentionsByNote = new Map(notes.map(note => [note.id, []]));
  for (const targetNote of includeMentions ? notes : []) {
    const candidateTerms = [...new Set([
      targetNote.cleanTitle,
      targetNote.title,
      ...targetNote.aliases,
    ].map(term => String(term || '').trim()).filter(term => term.length >= 2))]
      .sort((a, b) => b.length - a.length);
    if (!candidateTerms.length) continue;

    const mentions = [];
    for (const sourceNote of notes) {
      if (sourceNote.id === targetNote.id) continue;
      const linkedIntervals = sourceNote.wikiLinks.map(item => [item.from, item.to]);
      for (const line of nonCodeLineRanges(sourceNote.source, sourceNote.bodyFrom)) {
        if (/^\s*#{1,6}\s/.test(line.text)) continue;
        const masked = maskInlineCode(line.text)
          .replace(/!?\[[^\]]*\]\([^)]*\)/g, m => ' '.repeat(m.length))
          .replace(/https?:\/\/[^\s)]+/g, m => ' '.repeat(m.length));
        for (const term of candidateTerms) {
          let searchStart = 0;
          while (searchStart < masked.length) {
            const idx = masked.indexOf(term, searchStart);
            if (idx < 0) break;
            const absFrom = line.from + idx;
            const absTo = absFrom + term.length;
            searchStart = idx + term.length;
            const overlapsWikiLink = linkedIntervals.some(([lFrom, lTo]) => !(absTo <= lFrom || absFrom >= lTo));
            if (overlapsWikiLink) continue;
            mentions.push({
              sourceId: sourceNote.id,
              sourceTitle: sourceNote.title,
              sourceName: sourceNote.name,
              sourcePath: sourceNote.relativePath,
              targetId: targetNote.id,
              targetStem: targetNote.stem,
              targetCleanTitle: targetNote.cleanTitle,
              matchedTerm: line.text.slice(idx, idx + term.length),
              from: absFrom,
              to: absTo,
              line: line.lineNum,
              snippet: line.text.trim().slice(0, 140),
            });
            break;
          }
          if (mentions.some(m => m.sourceId === sourceNote.id && m.line === line.lineNum)) break;
        }
      }
    }
    unlinkedMentionsByNote.set(targetNote.id, mentions);
  }

  // Build Tags Index & Folders Index
  const tagMap = new Map();
  const folderMap = new Map();
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(note.id);
    }
    if (!folderMap.has(note.folder)) folderMap.set(note.folder, []);
    folderMap.get(note.folder).push(note.id);
  }

  const tagsIndex = [...tagMap.entries()]
    .map(([tag, noteIds]) => ({ tag, count: noteIds.length, noteIds }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));

  const foldersIndex = [...folderMap.entries()]
    .map(([folder, noteIds]) => ({ folder, count: noteIds.length, noteIds }))
    .sort((a, b) => (a.folder === '根目录' ? -1 : b.folder === '根目录' ? 1 : a.folder.localeCompare(b.folder, 'zh-CN')));

  const hubNote = [...notes].sort((a, b) => b.degree - a.degree)[0] || null;
  const stats = {
    totalNotes: notes.length,
    totalNodes: allNodes.length,
    totalLinks: edges.length,
    totalTags: tagsIndex.length,
    orphanCount: notes.filter(note => note.orphan).length,
    ghostCount: ghostMap.size,
    starredCount: notes.filter(note => note.starred).length,
    hubNoteTitle: hubNote?.title || '',
  };

  return {
    notes,
    nodes: allNodes,
    nodeMap: new Map(allNodes.map(node => [node.id, node])),
    edges,
    backlinksByNote,
    outgoingByNote,
    unlinkedMentionsByNote,
    tagsIndex,
    foldersIndex,
    stats,
    resolveTargetId,
  };
}

export function linkUnlinkedMention(sourceText = '', mention, preferredTarget = '') {
  const text = String(sourceText || '');
  if (!mention || !Number.isInteger(mention.from) || !Number.isInteger(mention.to)) return null;
  const actual = text.slice(mention.from, mention.to);
  if (actual !== mention.matchedTerm) return null;
  const targetName = preferredTarget || mention.targetCleanTitle || mention.targetStem || mention.matchedTerm;
  const replacement = targetName === mention.matchedTerm ? `[[${targetName}]]` : `[[${targetName}|${mention.matchedTerm}]]`;
  return {
    from: mention.from,
    to: mention.to,
    insert: replacement,
    nextSource: text.slice(0, mention.from) + replacement + text.slice(mention.to),
  };
}

export function queryLocalSubgraph(graph, centerNoteId, { depth = 1, includeTagLinks = false } = {}) {
  if (!graph || !centerNoteId || !graph.nodeMap.has(centerNoteId)) {
    return { nodes: [], edges: [], centerId: centerNoteId };
  }
  const maxHop = Math.max(1, Math.min(2, Number(depth) || 1));
  const distances = new Map([[centerNoteId, 0]]);
  const queue = [centerNoteId];

  const allEdges = [...graph.edges];
  if (includeTagLinks) {
    const centerNode = graph.nodeMap.get(centerNoteId);
    if (centerNode?.tags?.length) {
      for (const candidate of graph.notes) {
        if (candidate.id === centerNoteId) continue;
        const sharedTag = candidate.tags.find(tag => centerNode.tags.includes(tag));
        if (sharedTag && !allEdges.some(e => (e.source === centerNoteId && e.target === candidate.id) || (e.source === candidate.id && e.target === centerNoteId))) {
          allEdges.push({
            id: `tag:${centerNoteId}<->${candidate.id}`,
            source: centerNoteId,
            target: candidate.id,
            kind: 'tag',
            tag: sharedTag,
            ghost: false,
          });
        }
      }
    }
  }

  while (queue.length) {
    const current = queue.shift();
    const currentHop = distances.get(current);
    if (currentHop >= maxHop) continue;
    for (const edge of allEdges) {
      const neighbor = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (neighbor && !distances.has(neighbor)) {
        distances.set(neighbor, currentHop + 1);
        queue.push(neighbor);
      }
    }
  }

  const subNodes = [...distances.entries()].map(([id, hop]) => ({
    ...graph.nodeMap.get(id),
    hop,
    isCenter: id === centerNoteId,
  }));
  const subEdges = allEdges.filter(edge => distances.has(edge.source) && distances.has(edge.target));
  return { nodes: subNodes, edges: subEdges, centerId: centerNoteId };
}

export function filterGlobalGraph(graph, { mode = 'all', folder = '', tag = '', query = '', activeNoteId = '' } = {}) {
  if (!graph) return { nodes: [], edges: [] };
  let candidateIds = new Set(graph.nodes.map(node => node.id));

  if (mode === 'orphans') {
    candidateIds = new Set(graph.nodes.filter(node => node.exists && node.degree === 0).map(node => node.id));
  } else if (mode === 'ghosts') {
    const ghostIds = new Set(graph.nodes.filter(node => node.ghost).map(node => node.id));
    const connectedIds = new Set(ghostIds);
    for (const edge of graph.edges) {
      if (ghostIds.has(edge.target)) connectedIds.add(edge.source);
    }
    candidateIds = connectedIds;
  } else if (mode === 'folder' && folder) {
    candidateIds = new Set(graph.nodes.filter(node => node.folder === folder).map(node => node.id));
  }

  if (tag) {
    candidateIds = new Set([...candidateIds].filter(id => {
      const node = graph.nodeMap.get(id);
      return node?.tags?.includes(tag);
    }));
  }

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const matchedIds = new Set();
  const neighborIds = new Set();
  if (normalizedQuery) {
    for (const id of candidateIds) {
      const node = graph.nodeMap.get(id);
      if (!node) continue;
      const haystack = [node.title, node.name, node.cleanTitle, ...(node.aliases || []), ...(node.tags || []), node.folder].join(' ').toLowerCase();
      if (haystack.includes(normalizedQuery)) matchedIds.add(id);
    }
    for (const edge of graph.edges) {
      if (matchedIds.has(edge.source) && candidateIds.has(edge.target)) neighborIds.add(edge.target);
      if (matchedIds.has(edge.target) && candidateIds.has(edge.source)) neighborIds.add(edge.source);
    }
  }

  const nodes = [...candidateIds].map(id => {
    const node = graph.nodeMap.get(id);
    const matched = normalizedQuery ? matchedIds.has(id) : true;
    const neighbor = normalizedQuery ? neighborIds.has(id) : false;
    return {
      ...node,
      isCenter: id === activeNoteId,
      highlighted: normalizedQuery ? (matched || neighbor) : true,
      dimmed: normalizedQuery ? !(matched || neighbor) : false,
    };
  });

  const edges = graph.edges.filter(edge => candidateIds.has(edge.source) && candidateIds.has(edge.target));
  return { nodes, edges };
}

export function completeWikiLink(graph, rawQuery = '', currentNoteId = '') {
  if (!graph) return [];
  const text = String(rawQuery || '');
  const hashIndex = text.indexOf('#');

  // Heading completion inside [[Note#...]] or [[#...]]
  if (hashIndex >= 0) {
    const targetPrefix = text.slice(0, hashIndex).trim();
    const headingQuery = text.slice(hashIndex + 1).trim().toLowerCase();
    const noteId = targetPrefix ? graph.resolveTargetId(targetPrefix, currentNoteId) : currentNoteId;
    const targetNote = noteId ? graph.nodeMap.get(noteId) : null;
    if (!targetNote || !targetNote.headings?.length) return [];
    return targetNote.headings
      .filter(h => !headingQuery || h.text.toLowerCase().includes(headingQuery))
      .slice(0, 12)
      .map(h => ({
        kind: 'heading',
        label: `${targetPrefix ? targetNote.cleanTitle : ''}#${h.text}`,
        subtitle: `H${h.level} 章节 · ${targetNote.name}`,
        insertText: `${targetPrefix ? targetNote.cleanTitle : ''}#${h.text}]]`,
        noteId: targetNote.id,
        heading: h.text,
      }));
  }

  const query = text.trim().toLowerCase();
  const results = [];
  for (const note of graph.notes) {
    const titleMatch = note.cleanTitle.toLowerCase().includes(query) || note.title.toLowerCase().includes(query) || note.stem.toLowerCase().includes(query);
    const matchingAlias = (note.aliases || []).find(alias => alias.toLowerCase().includes(query));
    if (!query || titleMatch || matchingAlias) {
      const score = (note.id === currentNoteId ? -5 : 0) +
        (note.cleanTitle.toLowerCase().startsWith(query) ? 30 : 0) +
        (titleMatch ? 15 : 0) +
        (matchingAlias ? 10 : 0) +
        Math.min(10, note.degree);
      results.push({
        kind: 'note',
        score,
        label: note.cleanTitle || note.title,
        subtitle: matchingAlias ? `别名：${matchingAlias} · ${note.folder}` : `${note.folder} · ${note.tags.map(t => '#' + t).join(' ') || '无标签'}`,
        insertText: matchingAlias && !titleMatch ? `${note.cleanTitle}|${matchingAlias}]]` : `${note.cleanTitle}]]`,
        noteId: note.id,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'zh-CN')).slice(0, 12);
}

export function updateFrontMatterProperties(source = '', patch = {}) {
  const text = String(source || '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const match = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(text);
  const hasHeader = match?.index === 0;
  if (/^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(text) && !hasHeader) throw new Error('YAML 属性未闭合，请先修复源码，原文未修改。');
  const yamlDocument = parseYamlDocument(hasHeader ? match[2] : '{}\n', { prettyErrors: false, uniqueKeys: true });
  if (yamlDocument.errors.length || !isMap(yamlDocument.contents)) throw new Error('YAML 属性格式无效或键名重复，原文未修改。');
  yamlDocument.toJS({ maxAliasCount: 50 });
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('属性名称不可用。');
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) yamlDocument.delete(key);
    else yamlDocument.set(key, value);
  }
  const body = hasHeader ? text.slice(match[0].length) : text.replace(/^\uFEFF/, '');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (!yamlDocument.contents.items.length) return bom + body;
  const yamlText = yamlDocument.toString({ lineWidth: 0 }).replace(/\r?\n/g, newline);
  const opening = hasHeader ? match[1] : bom + '---' + newline;
  const closing = hasHeader ? match[3] : '---' + newline + newline;
  return opening + yamlText + closing + body;
}

export function rewriteVaultLinksOnRename(source = '', { oldStem = '', oldCleanTitle = '', newStem = '', newCleanTitle = '', newTitle = '' } = {}) {
  const text = String(source || '');
  const oldKeys = new Set([
    normalizeNoteKey(oldStem),
    normalizeNoteKey(oldCleanTitle),
  ].filter(Boolean));
  if (!oldKeys.size || (!newCleanTitle && !newStem)) {
    return { changed: false, count: 0, nextSource: text };
  }

  const preferredNewTarget = newCleanTitle || stripNumericPrefix(newStem) || newStem;
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  let count = 0;

  const nextLines = lines.map(rawLine => {
    const hasCR = rawLine.endsWith('\r');
    const line = hasCR ? rawLine.slice(0, -1) : rawLine;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) { inFence = true; fenceChar = marker; }
      else if (marker === fenceChar) { inFence = false; fenceChar = ''; }
      return rawLine;
    }
    if (inFence) return rawLine;

    let cursor = 0;
    let output = '';
    const codeRegex = /`+[^`]*`+/g;
    const rewriteSegment = segment => segment.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (full, bang, inner) => {
      const parsed = parseWikiLinkBody(inner);
      if (!parsed.target) return full;
      const normalizedTarget = normalizeNoteKey(parsed.target);
      const strippedTarget = normalizeNoteKey(stripNumericPrefix(parsed.target));
      if (!oldKeys.has(normalizedTarget) && !oldKeys.has(strippedTarget)) return full;
      count++;
      const targetOut = /^\d+[-_.\s]+/.test(parsed.target) && newStem ? newStem : preferredNewTarget;
      const headingPart = parsed.heading ? `#${parsed.heading}` : '';
      const aliasPart = parsed.alias ? `|${parsed.alias}` : '';
      return `${bang}[[${targetOut}${headingPart}${aliasPart}]]`;
    });

    for (const match of line.matchAll(codeRegex)) {
      output += rewriteSegment(line.slice(cursor, match.index));
      output += match[0];
      cursor = match.index + match[0].length;
    }
    output += rewriteSegment(line.slice(cursor));
    return hasCR ? output + '\r' : output;
  });

  let nextSource = nextLines.join('\n');
  if (newTitle) {
    const fm = parseFrontMatter(nextSource);
    if (fm.bodyFrom > 0 && fm.metadata.title && oldKeys.has(normalizeNoteKey(fm.metadata.title))) {
      nextSource = updateFrontMatterProperties(nextSource, { title: newTitle });
    }
  }

  return { changed: count > 0 || nextSource !== text, count, nextSource };
}

export function queryVaultDatabase(graph, { query = '', folder = '', tag = '', status = '', sortBy = 'degree', sortDir = 'desc' } = {}) {
  if (!graph) return { rows: [], columns: [], folders: [], tags: [], statuses: [] };
  const q = String(query || '').trim().toLowerCase();
  const statusOrder = ['草稿', '待整理', '记录中', '进行中', '已就绪', '持续演进', '已完成'];
  const statusMap = new Map();

  for (const statusName of ['草稿', '进行中', '已就绪', '持续演进']) {
    statusMap.set(statusName, []);
  }

  const filtered = graph.notes.filter(note => {
    if (folder && note.folder !== folder) return false;
    if (tag && !note.tags.includes(tag)) return false;
    const noteStatus = note.status || '未设状态';
    if (status && noteStatus !== status) return false;
    if (!q) return true;
    const hay = [note.title, note.cleanTitle, note.name, note.folder, noteStatus, ...note.tags, ...note.aliases].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    if (sortBy === 'title') return dir * a.title.localeCompare(b.title, 'zh-CN');
    if (sortBy === 'date') return dir * String(a.date || '').localeCompare(String(b.date || ''));
    if (sortBy === 'status') return dir * String(a.status || '').localeCompare(String(b.status || ''), 'zh-CN');
    return dir * ((a.degree || 0) - (b.degree || 0)) || a.title.localeCompare(b.title, 'zh-CN');
  });

  for (const note of filtered) {
    const key = note.status || '未设状态';
    if (!statusMap.has(key)) statusMap.set(key, []);
    statusMap.get(key).push(note);
  }

  const columns = [...statusMap.entries()]
    .filter(([name, items]) => items.length > 0 || ['草稿', '进行中', '已就绪', '持续演进'].includes(name))
    .sort((a, b) => {
      const ia = statusOrder.indexOf(a[0]);
      const ib = statusOrder.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([statusName, items]) => ({ status: statusName, count: items.length, items }));

  const allStatuses = [...new Set(['草稿', '待整理', '记录中', '进行中', '已就绪', '持续演进', '已完成', '未设状态', ...graph.notes.map(n => n.status).filter(Boolean)])];

  return {
    rows: filtered,
    columns,
    folders: graph.foldersIndex.map(f => f.folder),
    tags: graph.tagsIndex.map(t => t.tag),
    statuses: allStatuses,
  };
}

export function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function planVaultRename(rawNotes, noteId, requestedName, autoUpdateLinks = true) {
  const graph = buildVaultGraph(rawNotes, { includeMentions: false });
  const target = graph.nodeMap.get(noteId);
  if (!target?.exists) throw new Error('笔记不存在。');
  const stem = String(requestedName || '').trim().replace(/\.(md|markdown)$/i, '');
  if (!stem || /[\\/:*?"<>|\[\]#\x00-\x1f]/.test(stem) || /[. ]$/.test(stem) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) throw new Error('文件名无效，请去掉路径、双链分隔符或系统保留名称。');
  const folder = target.relativePath.split('/').slice(0, -1).join('/');
  const newRelativePath = (folder ? folder + '/' : '') + stem + '.md';
  if (graph.notes.some(note => note.id !== noteId && normalizeNoteKey(note.relativePath) === normalizeNoteKey(newRelativePath))) throw new Error('目标文件已存在，未执行重命名。');
  const newTarget = newRelativePath.replace(/\.md$/i, '');
  let rewrittenLinks = 0;
  const updates = [];
  for (const note of graph.notes) {
    let nextSource = note.source;
    let count = 0;
    if (autoUpdateLinks) {
      const edits = note.wikiLinks.filter(link => link.target && graph.resolveTargetId(link.target, note.id) === noteId);
      for (const link of edits.reverse()) {
        if (link.from > 0 && note.source[link.from - 1] === '\\') continue;
        const replacement = (link.embed ? '!' : '') + '[[' + newTarget + (link.heading ? '#' + link.heading : '') + (link.alias ? '|' + link.alias : '') + ']]';
        nextSource = nextSource.slice(0, link.from) + replacement + nextSource.slice(link.to);
        count++;
      }
    }
    if (nextSource !== note.source || note.id === noteId) updates.push({ noteId: note.id, path: note.path, relativePath: note.relativePath, expectedSource: note.source, source: nextSource, count });
    rewrittenLinks += count;
  }
  return { noteId, path: target.path, relativePath: target.relativePath, newTitle: stem, newRelativePath, updates, rewrittenLinks, affectedNotes: updates.filter(item => item.count > 0).length };
}

function cleanSourceReferencesToDeleted(source = '', isDeletedLink = () => false) {
  const text = String(source || '');
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  let removedCount = 0;
  const keptLines = [];

  for (const rawLine of lines) {
    const hasCR = rawLine.endsWith('\r');
    const line = hasCR ? rawLine.slice(0, -1) : rawLine;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) { inFence = true; fenceChar = marker; }
      else if (marker === fenceChar) { inFence = false; fenceChar = ''; }
      keptLines.push(rawLine);
      continue;
    }
    if (inFence) {
      keptLines.push(rawLine);
      continue;
    }

    let lineRemoved = 0;
    let cursor = 0;
    let rebuilt = '';
    const codeRegex = /`+[^`]*`+/g;
    const rewriteSegment = segment => segment.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (full, bang, inner) => {
      const parsed = parseWikiLinkBody(inner);
      if (!parsed.target || !isDeletedLink(parsed.target)) return full;
      lineRemoved++;
      removedCount++;
      return '';
    });

    for (const match of line.matchAll(codeRegex)) {
      rebuilt += rewriteSegment(line.slice(cursor, match.index));
      rebuilt += match[0];
      cursor = match.index + match[0].length;
    }
    rebuilt += rewriteSegment(line.slice(cursor));

    if (lineRemoved > 0) {
      rebuilt = rebuilt
        .replace(/(?:\s*[·、/]\s*){2,}/g, ' · ')
        .replace(/^(\s*(?:[-*+]|\d+\.)\s+)[·、/,\s]+/, '$1')
        .replace(/[·、/,\s]+$/, '')
        .replace(/\(\s*来源：\s*\)/g, '')
        .replace(/（\s*来源：\s*）/g, '');
      const strippedCheck = rebuilt
        .replace(/^\s*(?:[-*+]|\d+\.|>+)\s*/, '')
        .replace(/^\*\*[^*]+\*\*[：:]\s*(?:（路径：`[^`]+`）)?\s*$/, '')
        .trim();
      if (!strippedCheck) {
        continue;
      }
    }
    keptLines.push(hasCR ? rebuilt + '\r' : rebuilt);
  }

  return {
    changed: removedCount > 0,
    removedCount,
    nextSource: keptLines.join('\n'),
  };
}

export function planVaultDelete(rawNotes = [], {
  noteId = '',
  folderPath = '',
  cleanReferences = true,
  deleteReferencingFiles = false,
} = {}) {
  const graph = buildVaultGraph(rawNotes, { includeMentions: false });
  const normalizedFolder = String(folderPath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const initialTargets = [];

  if (normalizedFolder) {
    const lowerPrefix = normalizedFolder.toLowerCase() + '/';
    for (const note of graph.notes) {
      const relLower = note.relativePath.toLowerCase();
      if (relLower === normalizedFolder.toLowerCase() || relLower.startsWith(lowerPrefix)) {
        initialTargets.push(note);
      }
    }
  } else if (noteId) {
    const target = graph.nodeMap.get(noteId);
    if (!target?.exists) throw new Error('待删除的笔记不存在。');
    initialTargets.push(target);
  } else {
    throw new Error('请指定要删除的笔记或目录。');
  }

  const deletedIds = new Set(initialTargets.map(n => n.id));
  const deletedKeys = new Set();
  const addDeletedKeys = note => {
    for (const k of [note.relativePath, note.relativePath.replace(/\.(md|markdown)$/i, ''), note.stem, note.cleanTitle, note.title, ...(note.aliases || [])]) {
      const nk = normalizeNoteKey(k);
      if (nk) deletedKeys.add(nk);
      const sk = normalizeNoteKey(stripNumericPrefix(k || ''));
      if (sk) deletedKeys.add(sk);
    }
  };
  for (const note of initialTargets) addDeletedKeys(note);

  const isTargetLink = (linkTarget, sourceNoteId) => {
    if (!linkTarget) return false;
    const resolved = graph.resolveTargetId(linkTarget, sourceNoteId);
    if (resolved && deletedIds.has(resolved)) return true;
    const nk = normalizeNoteKey(linkTarget);
    const sk = normalizeNoteKey(stripNumericPrefix(linkTarget));
    return (nk && deletedKeys.has(nk)) || (sk && deletedKeys.has(sk));
  };

  const referencingNotes = [];
  for (const note of graph.notes) {
    if (deletedIds.has(note.id)) continue;
    const matchingLinks = note.wikiLinks.filter(link => isTargetLink(link.target, note.id));
    if (matchingLinks.length > 0) {
      referencingNotes.push({
        noteId: note.id,
        path: note.path,
        relativePath: note.relativePath,
        title: note.cleanTitle || note.title,
        referenceCount: matchingLinks.length,
        snippets: matchingLinks.slice(0, 3).map(l => l.raw),
      });
    }
  }

  if (deleteReferencingFiles) {
    for (const ref of referencingNotes) {
      const refNote = graph.nodeMap.get(ref.noteId);
      if (refNote && !deletedIds.has(refNote.id)) {
        deletedIds.add(refNote.id);
        initialTargets.push(refNote);
        addDeletedKeys(refNote);
      }
    }
  }

  const updates = [];
  let cleanedReferenceCount = 0;
  if (cleanReferences) {
    for (const note of graph.notes) {
      if (deletedIds.has(note.id)) continue;
      const cleaned = cleanSourceReferencesToDeleted(note.source, target => isTargetLink(target, note.id));
      if (cleaned.changed && cleaned.nextSource !== note.source) {
        updates.push({
          noteId: note.id,
          path: note.path,
          relativePath: note.relativePath,
          expectedSource: note.source,
          source: cleaned.nextSource,
          removedCount: cleaned.removedCount,
        });
        cleanedReferenceCount += cleaned.removedCount;
      }
    }
  }

  return {
    mode: normalizedFolder ? 'folder' : 'note',
    folderPath: normalizedFolder,
    deletedNotes: initialTargets.map(n => ({
      noteId: n.id,
      path: n.path,
      relativePath: n.relativePath,
      title: n.cleanTitle || n.title,
    })),
    referencingNotes,
    updates,
    cleanedReferenceCount,
    affectedFileCount: updates.length,
  };
}

export function planVaultMove(rawNotes = [], noteId = '', targetFolder = '', autoUpdateLinks = true) {
  const graph = buildVaultGraph(rawNotes, { includeMentions: false });
  const target = graph.nodeMap.get(noteId);
  if (!target?.exists) throw new Error('待移动的笔记不存在。');
  const cleanFolder = String(targetFolder || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (cleanFolder === '根目录') {
    return planVaultMove(rawNotes, noteId, '', autoUpdateLinks);
  }
  if (cleanFolder && cleanFolder.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))) {
    throw new Error('目标目录路径包含非法字符或 . / .. 段。');
  }
  const newRelativePath = (cleanFolder ? `${cleanFolder}/` : '') + target.name;
  if (normalizeNoteKey(newRelativePath) === normalizeNoteKey(target.relativePath)) {
    throw new Error('笔记已位于该目录中，无需移动。');
  }
  if (graph.notes.some(note => note.id !== noteId && normalizeNoteKey(note.relativePath) === normalizeNoteKey(newRelativePath))) {
    throw new Error('目标目录下已存在同名笔记，未执行移动。');
  }
  const oldRelNoExt = target.relativePath.replace(/\.(md|markdown)$/i, '');
  const newRelNoExt = newRelativePath.replace(/\.(md|markdown)$/i, '');
  let rewrittenLinks = 0;
  const updates = [];

  for (const note of graph.notes) {
    let nextSource = note.source;
    let count = 0;
    if (autoUpdateLinks) {
      const edits = note.wikiLinks.filter(link => {
        if (!link.target) return false;
        if (graph.resolveTargetId(link.target, note.id) !== noteId) return false;
        return link.target.includes('/') || normalizeNoteKey(link.target) === normalizeNoteKey(oldRelNoExt);
      });
      for (const link of edits.reverse()) {
        if (link.from > 0 && note.source[link.from - 1] === '\\') continue;
        const replacement = (link.embed ? '!' : '') + '[[' + newRelNoExt + (link.heading ? '#' + link.heading : '') + (link.alias ? '|' + link.alias : '') + ']]';
        nextSource = nextSource.slice(0, link.from) + replacement + nextSource.slice(link.to);
        count++;
      }
    }
    if (nextSource !== note.source || note.id === noteId) {
      updates.push({
        noteId: note.id,
        path: note.path,
        relativePath: note.relativePath,
        expectedSource: note.source,
        source: nextSource,
        count,
      });
    }
    rewrittenLinks += count;
  }

  return {
    noteId,
    path: target.path,
    relativePath: target.relativePath,
    targetFolder: cleanFolder,
    newRelativePath,
    updates,
    rewrittenLinks,
    affectedNotes: updates.filter(item => item.count > 0).length,
  };
}

export function planVaultFolderMove(rawNotes = [], {
  sourceFolder = '',
  targetParentFolder = '',
  newFolderName = '',
  targetFolderPath = '',
  knownFolders = [],
  autoUpdateLinks = true,
} = {}) {
  const graph = buildVaultGraph(rawNotes, { includeMentions: false });
  const cleanSource = String(sourceFolder || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!cleanSource || cleanSource === '根目录') {
    throw new Error('请选择要重命名或移动的子目录。');
  }
  const sourceParts = cleanSource.split('/');
  const defaultBaseName = sourceParts[sourceParts.length - 1];
  const defaultParent = sourceParts.slice(0, -1).join('/');

  let cleanTarget = String(targetFolderPath || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!cleanTarget) {
    const cleanParent = (targetParentFolder === undefined || targetParentFolder === null ? defaultParent : String(targetParentFolder))
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    const normalizedParent = cleanParent === '根目录' ? '' : cleanParent;
    const baseName = String(newFolderName || defaultBaseName).trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (!baseName) throw new Error('目录新名称不能为空。');
    cleanTarget = normalizedParent ? `${normalizedParent}/${baseName}` : baseName;
  }

  if (cleanTarget.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))) {
    throw new Error('目标目录路径包含非法字符或 . / .. 段。');
  }
  const srcLower = cleanSource.toLowerCase();
  const dstLower = cleanTarget.toLowerCase();
  if (srcLower === dstLower) {
    throw new Error('目标目录路径与原目录相同，无需移动。');
  }
  if (dstLower.startsWith(srcLower + '/')) {
    throw new Error('不能将目录移动到其自身或子目录中。');
  }

  const movedNotes = [];
  const movedIdMap = new Map();
  for (const note of graph.notes) {
    const rel = String(note.relativePath || '').replaceAll('\\', '/');
    const relLower = rel.toLowerCase();
    if (relLower.startsWith(srcLower + '/')) {
      const suffix = rel.slice(cleanSource.length + 1);
      const newRelativePath = `${cleanTarget}/${suffix}`;
      const oldRelNoExt = rel.replace(/\.(md|markdown)$/i, '');
      const newRelNoExt = newRelativePath.replace(/\.(md|markdown)$/i, '');
      const entry = {
        noteId: note.id,
        path: note.path,
        oldRelativePath: rel,
        newRelativePath,
        oldRelNoExt,
        newRelNoExt,
      };
      movedNotes.push(entry);
      movedIdMap.set(note.id, entry);
    }
  }

  for (const moved of movedNotes) {
    const conflict = graph.notes.find(n =>
      !movedIdMap.has(n.id) &&
      normalizeNoteKey(n.relativePath) === normalizeNoteKey(moved.newRelativePath),
    );
    if (conflict) {
      throw new Error(`目标目录已存在同名笔记（${moved.newRelativePath}），未执行目录移动。`);
    }
  }

  const allKnownFolders = new Set([
    cleanSource,
    ...(knownFolders || []).map(f => String(f || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')),
  ]);
  const movedFolders = [];
  for (const f of allKnownFolders) {
    if (!f) continue;
    const fl = f.toLowerCase();
    if (fl === srcLower) {
      movedFolders.push({ oldFolder: f, newFolder: cleanTarget });
    } else if (fl.startsWith(srcLower + '/')) {
      movedFolders.push({ oldFolder: f, newFolder: `${cleanTarget}/${f.slice(cleanSource.length + 1)}` });
    }
  }

  let rewrittenLinks = 0;
  const updates = [];
  for (const note of graph.notes) {
    let nextSource = note.source;
    let count = 0;
    if (autoUpdateLinks && movedIdMap.size > 0) {
      const edits = [];
      for (const link of note.wikiLinks) {
        if (!link.target) continue;
        const resolvedId = graph.resolveTargetId(link.target, note.id);
        const movedTarget = resolvedId ? movedIdMap.get(resolvedId) : null;
        if (movedTarget && (link.target.includes('/') || normalizeNoteKey(link.target) === normalizeNoteKey(movedTarget.oldRelNoExt))) {
          edits.push({ link, movedTarget });
        }
      }
      for (const { link, movedTarget } of edits.reverse()) {
        if (link.from > 0 && note.source[link.from - 1] === '\\') continue;
        const replacement = (link.embed ? '!' : '') + '[[' + movedTarget.newRelNoExt + (link.heading ? '#' + link.heading : '') + (link.alias ? '|' + link.alias : '') + ']]';
        nextSource = nextSource.slice(0, link.from) + replacement + nextSource.slice(link.to);
        count++;
      }
    }
    if (nextSource !== note.source) {
      updates.push({
        noteId: note.id,
        path: note.path,
        relativePath: note.relativePath,
        expectedSource: note.source,
        source: nextSource,
        count,
      });
    }
    rewrittenLinks += count;
  }

  return {
    sourceFolder: cleanSource,
    newFolderPath: cleanTarget,
    movedNotes,
    movedFolders,
    updates,
    rewrittenLinks,
    affectedNotes: updates.length,
  };
}

