import MarkdownIt from '../app/node_modules/markdown-it/dist/markdown-it.mjs';
import { parseFrontMatter, parseWikiLinkBody, extractWikiLinks, headingSlug, parseVaultNote, stripNumericPrefix } from './vault-graph.mjs';
import { buildNoteResolver } from './vault-index.mjs';

const parser = new MarkdownIt({ html: false });
const blockIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

function documentBlocks(source) {
  const bom = source.startsWith('\uFEFF') ? 1 : 0; const bodyFrom = bom + parseFrontMatter(source.slice(bom)).bodyFrom;
  const lines = source.slice(bodyFrom).split('\n'); const offsets = []; let offset = bodyFrom;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const tokens = parser.parse(source.slice(bodyFrom), {});
  return { bodyFrom, lines, offsets, tokens };
}

export function noteBlocks(source) {
  const { lines, offsets, tokens } = documentBlocks(source); const blocks = [];
  for (const token of tokens) {
    if (!['paragraph_open', 'heading_open'].includes(token.type) || !token.map) continue;
    const endLine = token.map[1] - 1; const line = lines[endLine].replace(/\r$/, '');
    const marker = /(?:^|[ \t])\^([A-Za-z0-9][A-Za-z0-9_-]{0,47})[ \t]*$/.exec(line); if (!marker) continue;
    const inline = parser.parseInline(line, {})[0].children || [];
    if (inline.at(-1)?.type !== 'text' || !inline.at(-1).content.trimEnd().endsWith('^' + marker[1])) continue;
    let from = offsets[token.map[0]]; const markerFrom = offsets[endLine] + marker.index + (marker[0].startsWith('^') ? 0 : 1);
    if (line.trim() === '^' + marker[1]) {
      const previous = tokens.filter(candidate => candidate.level === 0 && candidate.map && candidate.map[1] <= token.map[0] && candidate.type !== 'inline').at(-1);
      if (!previous) continue; from = offsets[previous.map[0]];
    }
    blocks.push({ id: marker[1], from, to: markerFrom, markerFrom, markerTo: offsets[endLine] + line.length, source: source.slice(from, markerFrom).trimEnd() });
  }
  return blocks;
}

export function deduplicateBlockIds(source, nextId) {
  const blocks = noteBlocks(source);
  if (blocks.length <= 1) return { source, changed: false, replacements: [] };
  const used = new Set();
  const duplicates = [];
  for (const block of blocks) {
    if (used.has(block.id)) duplicates.push(block);
    else used.add(block.id);
  }
  if (!duplicates.length) return { source, changed: false, replacements: [] };
  let counter = 1;
  const makeId = base => {
    if (typeof nextId === 'function') {
      const candidate = String(nextId(base, counter));
      if (blockIdPattern.test(candidate) && !used.has(candidate)) { used.add(candidate); return candidate; }
    }
    while (used.has(`${base}-${counter}`)) counter++;
    const candidate = `${base.slice(0, 40)}-${counter++}`;
    used.add(candidate);
    return candidate;
  };
  const replacements = duplicates.map(block => ({ from: block.markerFrom, to: block.markerTo, oldId: block.id, newId: makeId(block.id) }));
  let updated = source;
  for (const item of [...replacements].reverse()) {
    updated = updated.slice(0, item.from) + '^' + item.newId + updated.slice(item.to);
  }
  return { source: updated, changed: true, replacements };
}

export function ensureBlockReference(source, position, id) {
  if (!Number.isInteger(position) || position < 0 || position > source.length || !blockIdPattern.test(id)) throw new Error('块引用参数无效');
  const deduped = deduplicateBlockIds(source);
  const working = deduped.source;
  const blocks = noteBlocks(working); const existing = blocks.find(block => position >= block.from && position <= block.markerTo);
  if (existing) return { source: working, id: existing.id, changed: deduped.changed };
  if (blocks.some(block => block.id === id)) throw new Error('块标识已存在');
  const { offsets, tokens } = documentBlocks(working);
  const token = tokens.find(candidate => candidate.type === 'paragraph_open' && candidate.map && position >= offsets[candidate.map[0]] && position <= (offsets[candidate.map[1]] ?? working.length));
  if (!token) throw new Error('请将光标放在正文段落中，代码和属性不能添加块标识');
  let end = offsets[token.map[1]] ?? working.length; while (end > offsets[token.map[0]] && /[\r\n]/.test(working[end - 1])) end--;
  return { source: working.slice(0, end) + ' ^' + id + working.slice(end), id, changed: true };
}

export function selectNoteContent(note, fragment = '') {
  const source = String(note.source || ''); const structure = documentBlocks(source);
  if (!fragment) return { status: 'ready', source: source.slice(structure.bodyFrom), from: structure.bodyFrom, to: source.length };
  if (fragment.startsWith('^')) {
    const matches = noteBlocks(source).filter(block => block.id === fragment.slice(1));
    if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing-block', source: '' };
    return { status: 'ready', ...matches[0] };
  }
  const headings = structure.tokens.filter(token => token.type === 'heading_open');
  const textOf = token => structure.tokens[structure.tokens.indexOf(token) + 1]?.content || '';
  const matches = headings.filter(token => textOf(token) === fragment || headingSlug(textOf(token)) === headingSlug(fragment));
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing-heading', source: '' };
  const heading = matches[0]; const level = Number(heading.tag.slice(1)); const from = structure.offsets[heading.map[0]];
  const following = headings.find(token => token.map[0] > heading.map[0] && Number(token.tag.slice(1)) <= level);
  const to = following ? structure.offsets[following.map[0]] : source.length;
  return { status: 'ready', source: source.slice(from, to), from, to };
}

export function createEmbedResolver(rawNotes, { maxDepth = 3, maxEmbeds = 24, maxCharacters = 80000 } = {}) {
  const notes = rawNotes.map(note => note.aliases && note.cleanTitle ? note : parseVaultNote(note));
  const byId = new Map(notes.map(note => [note.id, note])); const resolveId = buildNoteResolver(notes);
  return (expression, sourceId, sharedBudget) => {
    const budget = sharedBudget || { embeds: 0, characters: 0 };
    const resolve = (body, context, ancestors = [], depth = 0) => {
      const reference = typeof body === 'string' ? parseWikiLinkBody(body) : body;
      const id = reference.target ? resolveId(reference.target, context) : context; const note = byId.get(id);
      const base = { reference, noteId: id || '', name: note?.title || reference.display, path: note?.path || '', relativePath: note?.relativePath || '', children: [] };
      if (!note) return { ...base, status: 'missing-note', source: '' };
      const key = id + '#' + reference.heading;
      if (ancestors.includes(key)) return { ...base, status: 'cycle', source: '' };
      if (depth >= maxDepth || ++budget.embeds > maxEmbeds) return { ...base, status: 'limit', source: '' };
      const selection = selectNoteContent(note, reference.heading); if (selection.status !== 'ready') return { ...base, ...selection };
      if (budget.characters + selection.source.length > maxCharacters) return { ...base, status: 'limit', source: '' };
      budget.characters += selection.source.length;
      const children = extractWikiLinks(selection.source).filter(link => link.embed).map(link => ({ ...resolve(link, id, [...ancestors, key], depth + 1), linkFrom: link.from, linkTo: link.to }));
      return { ...base, ...selection, children };
    };
    return resolve(expression, sourceId);
  };
}

export function expandNoteEmbeds(rawNotes, source, sourceId, options) {
  const resolve = createEmbedResolver(rawNotes, options); const references = [];
  const materialize = content => {
    let text = content.source;
    for (const child of [...content.children].reverse()) text = text.slice(0, child.linkFrom) + materialize(child) + text.slice(child.linkTo);
    references.push({ noteId: content.noteId, path: content.relativePath, fragment: content.reference.heading, status: content.status });
    if (content.status !== 'ready') return '> 引用不可用：' + content.name + ' (' + content.status + ')\n';
    return options?.rewriteSource ? options.rewriteSource(text, content) : text;
  };
  let text = source; const bodyFrom = parseFrontMatter(source.replace(/^\uFEFF/, '')).bodyFrom + (source.startsWith('\uFEFF') ? 1 : 0);
  const budget = { embeds: 0, characters: 0 };
  const replacements = extractWikiLinks(source, bodyFrom).filter(link => link.embed).map(link => ({ link, content: resolve(link, sourceId, budget) }));
  for (const { link, content } of replacements.reverse()) text = text.slice(0, link.from) + materialize(content) + text.slice(link.to);
  return { source: text, references };
}

export function rebaseEmbeddedImages(input, notePath) {
  const source = input.replaceAll('\r\n', '\n'); const markdown = new MarkdownIt({ html: false });
  const imageRule = markdown.inline.ruler.__rules__.find(rule => rule.name === 'image').fn;
  markdown.inline.ruler.at('image', (state, silent) => {
    const from = state.pos; if (!imageRule(state, silent)) return false;
    if (!silent && state.tokens.at(-1)?.type === 'image') state.tokens.at(-1).meta = { from, to: state.pos };
    return true;
  });
  const lines = source.split('\n'); const offsets = []; let position = 0; for (const line of lines) { offsets.push(position); position += line.length + 1; }
  const changes = []; let cursor = 0;
  for (const token of markdown.parse(source, {})) {
    if (token.type !== 'inline') continue;
    const base = token.map ? offsets[token.map[0]] : cursor; const found = source.indexOf(token.content, base);
    const images = (token.children || []).filter(child => child.type === 'image');
    if (!images.length) { if (found >= 0) cursor = found + token.content.length; continue; }
    const locate = relative => {
      if (found >= 0 && (!token.map || found + token.content.length <= (offsets[token.map[1]] ?? source.length))) return found + relative;
      if (!token.map) throw new Error('无法确定引用图片位置，请改用单独一行的 Markdown 图片');
      const prefix = token.content.slice(0, relative); const line = prefix.split('\n').length - 1; const column = relative - (prefix.lastIndexOf('\n') + 1);
      const original = lines[token.map[0] + line]; const contentLine = token.content.split('\n')[line]; const start = original.indexOf(contentLine);
      if (start < 0) throw new Error('无法确定引用图片位置'); return offsets[token.map[0] + line] + start + column;
    };
    for (const image of images) {
      const value = image.attrGet('src'); if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) continue;
      if (/^(?:https?:|\/\/)/i.test(value)) throw new Error('引用中的远程图片需先保存为本地资源');
      if (/^[A-Za-z]:[\\/]/.test(value)) continue;
      if (!/^[A-Za-z]:[\\/]/.test(notePath)) throw new Error('浏览器副本中的引用图片需先内嵌，或使用 Windows 知识库');
      const resolved = new URL(value.replaceAll('\\', '/'), 'file:///' + notePath.replaceAll('\\', '/')); const destination = resolved.pathname.slice(1);
      const title = image.attrGet('title'); const replacement = '![' + image.content.replace(/[\\\[\]]/g, '\\$&') + '](<' + destination + '>' + (title ? ' ' + JSON.stringify(title) : '') + ')';
      changes.push({ from: locate(image.meta.from), to: locate(image.meta.to), value: replacement });
    }
    if (found >= 0) cursor = found + token.content.length;
  }
  let result = source; for (const change of changes.reverse()) result = result.slice(0, change.from) + change.value + result.slice(change.to); return result;
}

/* ============================================================================
 * MAJOR-300 (3.0.0): Cross-Note Section & Block Transclusion Inspector,
 * Live Preview Comparison & One-Click Anchor Sync Repair
 * ========================================================================== */

const NON_NOTE_ASSET_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|pdf|epub|docx|pptx|xlsx|mp3|wav|ogg|mp4|webm|zip)$/i;

export function extractNoteHeadings(source = '') {
  const { bodyFrom, tokens } = documentBlocks(String(source || ''));
  const preLines = bodyFrom > 0 ? String(source || '').slice(0, bodyFrom).split('\n').length - 1 : 0;
  const headings = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open' || !token.map) continue;
    const content = String(tokens[i + 1]?.content || '').trim();
    if (!content) continue;
    headings.push({
      level: Number(token.tag.slice(1)) || 1,
      text: content,
      slug: headingSlug(content),
      line: preLines + token.map[0] + 1,
    });
  }
  return headings;
}

function computeTextOverlapScore(query = '', candidate = '') {
  const q = headingSlug(query).replaceAll('-', '');
  const c = headingSlug(candidate).replaceAll('-', '');
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) {
    return 0.78 + 0.2 * (Math.min(q.length, c.length) / Math.max(q.length, c.length));
  }
  const bigrams = str => {
    if (str.length < 2) return new Set([str]);
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
  };
  const qSet = bigrams(q);
  const cSet = bigrams(c);
  let shared = 0;
  for (const bg of qSet) if (cSet.has(bg)) shared++;
  return (2 * shared) / (qSet.size + cSet.size);
}

export function inspectVaultEmbedReferences(rawNotes = [], { focusNoteId = '' } = {}) {
  const realRaw = (rawNotes || []).filter(n => n && n.exists !== false && !n.ghost && typeof n.source === 'string');
  const notes = realRaw.map(note => note.aliases && note.cleanTitle ? note : parseVaultNote(note));
  const byId = new Map(notes.map(note => [note.id, note]));
  const resolveId = buildNoteResolver(notes);
  const resolveEmbed = createEmbedResolver(notes);

  const scopeNotes = focusNoteId
    ? notes.filter(n => n.id === focusNoteId)
    : notes;

  const items = [];
  let healthyCount = 0;
  let brokenCount = 0;
  let repairableCount = 0;

  for (const hostNote of scopeNotes) {
    const src = String(hostNote.source || '');
    const bom = src.startsWith('\uFEFF') ? 1 : 0;
    const bodyFrom = bom + parseFrontMatter(src.slice(bom)).bodyFrom;
    const embeds = extractWikiLinks(src, bodyFrom).filter(link =>
      link.embed && !NON_NOTE_ASSET_EXT_RE.test(link.target || '')
    );

    for (const link of embeds) {
      const resolved = resolveEmbed(link, hostNote.id);
      let status = resolved.status;
      let targetNote = resolved.noteId ? byId.get(resolved.noteId) : null;
      let suggestedTarget = '';
      let suggestedFragment = '';
      let suggestionReason = '';
      let availableFragments = [];

      // Support detecting Obsidian shorthand ![[Note^block-id]] (without #)
      if (status === 'missing-note' && !link.heading && link.target && link.target.includes('^')) {
        const caretIdx = link.target.lastIndexOf('^');
        const candidateNotePart = link.target.slice(0, caretIdx).trim();
        const candidateBlockId = link.target.slice(caretIdx + 1).trim();
        const resolvedCandidateId = candidateNotePart ? resolveId(candidateNotePart, hostNote.id) : hostNote.id;
        const candidateNote = byId.get(resolvedCandidateId);
        if (candidateNote && candidateBlockId) {
          targetNote = candidateNote;
          const blocks = noteBlocks(candidateNote.source);
          availableFragments = blocks.map(b => `^${b.id}`);
          const exactBlock = blocks.find(b => b.id.toLowerCase() === candidateBlockId.toLowerCase());
          if (exactBlock) {
            suggestedTarget = candidateNotePart;
            suggestedFragment = `^${exactBlock.id}`;
            suggestionReason = `检测到未加 # 的块引用简写，可规范化为 ![[${candidateNotePart}#^${exactBlock.id}]]`;
          }
        }
      }

      if (targetNote && status === 'missing-heading') {
        const headings = extractNoteHeadings(targetNote.source);
        availableFragments = headings.map(h => h.text);
        let bestHeading = '';
        let bestScore = 0;
        for (const h of headings) {
          const score = computeTextOverlapScore(link.heading, h.text);
          if (score > bestScore) {
            bestScore = score;
            bestHeading = h.text;
          }
        }
        if (bestHeading && bestScore >= 0.25) {
          suggestedFragment = bestHeading;
          suggestionReason = `源笔记章节可能已重命名为「${bestHeading}」（匹配度 ${Math.round(bestScore * 100)}%）`;
        } else if (headings.length === 1) {
          suggestedFragment = headings[0].text;
          suggestionReason = `源笔记当前唯一章节为「${headings[0].text}」`;
        }
      } else if (targetNote && status === 'missing-block') {
        const blocks = noteBlocks(targetNote.source);
        availableFragments = blocks.map(b => `^${b.id}`);
        const wantedId = String(link.heading || '').replace(/^\^/, '');
        let bestBlock = '';
        let bestScore = 0;
        for (const b of blocks) {
          const score = computeTextOverlapScore(wantedId, b.id);
          if (score > bestScore) {
            bestScore = score;
            bestBlock = `^${b.id}`;
          }
        }
        if (bestBlock && bestScore >= 0.3) {
          suggestedFragment = bestBlock;
          suggestionReason = `源笔记存在相近块锚点「${bestBlock}」`;
        } else if (blocks.length === 1) {
          suggestedFragment = `^${blocks[0].id}`;
          suggestionReason = `源笔记当前唯一块锚点为「^${blocks[0].id}」`;
        }
      }

      const previewSource = status === 'ready' ? String(resolved.source || '').trim() : '';
      const previewExcerpt = previewSource
        .replace(/^#+\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);

      const repairable = Boolean(status !== 'ready' && (suggestedFragment || suggestedTarget));
      if (status === 'ready') healthyCount++;
      else brokenCount++;
      if (repairable) repairableCount++;

      items.push({
        id: `${hostNote.id}:${link.from}:${link.to}`,
        hostNoteId: hostNote.id,
        hostTitle: hostNote.cleanTitle || hostNote.title || hostNote.name || '',
        hostRelativePath: hostNote.relativePath || hostNote.name || '',
        lineNum: link.line,
        from: link.from,
        to: link.to,
        raw: link.raw,
        target: link.target,
        fragment: link.heading,
        alias: link.alias,
        kind: !link.heading ? 'full-note' : link.heading.startsWith('^') ? 'block' : 'heading',
        status,
        targetNoteId: targetNote?.id || resolved.noteId || '',
        targetTitle: targetNote ? (targetNote.cleanTitle || targetNote.title || '') : stripNumericPrefix(link.target || ''),
        targetRelativePath: targetNote?.relativePath || resolved.relativePath || '',
        previewExcerpt,
        previewLineCount: previewSource ? previewSource.split(/\r?\n/).length : 0,
        repairable,
        suggestedTarget,
        suggestedFragment,
        suggestionReason,
        availableFragments,
      });
    }
  }

  const statusText = st => ({
    ready: '✅ 正常同步',
    'missing-heading': '⚠️ 源章节不存在/已改名',
    'missing-block': '⚠️ 源块标识 ^id 不存在',
    'missing-note': '❌ 目标笔记不存在',
    ambiguous: '⚠️ 目标锚点重复不唯一',
    cycle: '🔄 循环内嵌已拦截',
    limit: '⏳ 超出嵌套上限',
  }[st] || st);

  const mdRows = items.length
    ? items.map(it =>
        `| [[${it.hostTitle}]] (L${it.lineNum}) | \`${it.raw.replaceAll('|', '\\|')}\` | ${statusText(it.status)} | ${it.repairable ? `建议锚点：\`${it.suggestedFragment}\`` : (it.previewExcerpt ? it.previewExcerpt.slice(0, 46).replaceAll('|', '\\|') + '…' : '—')} |`
      )
    : ['| — | 当前范围内未检测到 `![[...]]` 跨笔记块或章节内嵌引用 | — | — |'];

  const reportMarkdown = [
    `### 🔗 跨笔记块引用与章节内嵌健康报告`,
    '',
    `> **巡检总计**：**${items.length}** 处内嵌引用 ｜ **正常同步**：**${healthyCount}** 处 ｜ **异常待处理**：**${brokenCount}** 处（其中 **${repairableCount}** 处可自动对齐修复）`,
    '',
    '| 宿主笔记与行号 | 内嵌引用表达式 | 状态 | 实时预览或修复建议 |',
    '| --- | --- | --- | --- |',
    ...mdRows,
    '',
  ].join('\n');

  return {
    totalEmbeds: items.length,
    healthyCount,
    brokenCount,
    repairableCount,
    items,
    reportMarkdown,
  };
}

export function repairBrokenNoteEmbedInSource(source = '', embedItem, { newTarget, newFragment } = {}) {
  const src = String(source || '');
  if (!embedItem || !Number.isInteger(embedItem.from) || !Number.isInteger(embedItem.to)) {
    throw new Error('无效的内嵌引用位置参数');
  }
  if (src.slice(embedItem.from, embedItem.to) !== embedItem.raw) {
    throw new Error('笔记原文已发生变动，请重新扫描后再执行引用修复');
  }
  const effectiveTarget = newTarget !== undefined ? String(newTarget).trim() : (embedItem.suggestedTarget || embedItem.target || '');
  const effectiveFragment = newFragment !== undefined ? String(newFragment).trim() : (embedItem.suggestedFragment ?? embedItem.fragment ?? '');
  const aliasSuffix = embedItem.alias ? `|${embedItem.alias}` : '';
  const fragPart = effectiveFragment ? `#${effectiveFragment.replace(/^#/, '')}` : '';
  const replacement = `![[${effectiveTarget}${fragPart}${aliasSuffix}]]`;
  if (replacement === embedItem.raw) {
    return { source: src, changed: false, replacement };
  }
  return {
    source: src.slice(0, embedItem.from) + replacement + src.slice(embedItem.to),
    changed: true,
    replacement,
  };
}

export function batchRepairNoteEmbedsInSource(source = '', embedItems = []) {
  let working = String(source || '');
  const repairable = [...(embedItems || [])]
    .filter(item => item && item.repairable && Number.isInteger(item.from) && Number.isInteger(item.to))
    .sort((a, b) => b.from - a.from);
  let repairedCount = 0;
  for (const item of repairable) {
    if (working.slice(item.from, item.to) !== item.raw) continue;
    const res = repairBrokenNoteEmbedInSource(working, item);
    if (res.changed) {
      working = res.source;
      repairedCount++;
    }
  }
  return {
    source: working,
    changed: repairedCount > 0,
    repairedCount,
  };
}