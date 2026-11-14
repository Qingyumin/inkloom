import { stringify } from '../app/node_modules/yaml/browser/index.js';

export function noteReference(relativePath, block = '') {
  if (typeof relativePath !== 'string' || !relativePath || /[\[\]#|\r\n]/.test(relativePath)) throw new Error('文件名包含引用保留字符，请先重命名');
  if (block && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(block)) throw new Error('块标识无效');
  return '[[' + relativePath.replace(/\.(md|markdown)$/i, '') + (block ? '#^' + block : '') + ']]';
}

export function researchSource({
  title,
  kind = 'web',
  locator = '',
  author = '',
  year = '',
  text = '',
  citeKey = '',
  journal = '',
  publisher = '',
  volume = '',
  issue = '',
  pages = '',
  doi = '',
}) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\r\n]/.test(title)) throw new Error('资料标题无效');
  if (!['web', 'book', 'paper', 'interview', 'other'].includes(kind) || [locator, author, year, text, citeKey, journal, publisher, volume, issue, pages, doi].some(value => typeof value !== 'string') || locator.length > 2048 || author.length > 200 || text.length > 100000) throw new Error('资料字段超过范围');
  if (year && !/^\d{4}$/.test(year)) throw new Error('年份应为四位数字，未知时留空');
  if (kind === 'web' && locator) { const url = new URL(locator); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('网页来源仅接受不含凭据的 HTTP 地址'); }
  const metadata = {
    title: title.trim(),
    category: 'source',
    source_type: kind,
    source_locator: locator,
    author,
    year,
    ...(citeKey.trim() ? { cite_key: citeKey.trim().slice(0, 120) } : {}),
    ...(journal.trim() ? { journal: journal.trim().slice(0, 240) } : {}),
    ...(publisher.trim() ? { publisher: publisher.trim().slice(0, 240) } : {}),
    ...(volume.trim() ? { volume: volume.trim().slice(0, 60) } : {}),
    ...(issue.trim() ? { issue: issue.trim().slice(0, 60) } : {}),
    ...(pages.trim() ? { pages: pages.trim().slice(0, 80) } : {}),
    ...(doi.trim() ? { doi: doi.trim().slice(0, 240) } : {}),
    status: '待读',
    tags: ['research'],
  };
  return '---\n' + stringify(metadata) + '---\n\n# ' + title.trim() + '\n\n' + (kind === 'web' && locator ? '[原始来源](<' + new URL(locator).href + '>)\n\n' : '') + '## 资料说明\n\n' + text.trim() + '\n\n## 关键问题\n\n## 相关笔记\n';
}

function cleanBibValue(raw = '') {
  let val = String(raw || '').trim();
  while ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1).trim();
  }
  return val
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBibtexEntries(rawText = '') {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const entries = [];
  const headerRegex = /@([A-Za-z]+)\s*\{\s*([^,\s{}]+)\s*,/g;
  let match;
  while ((match = headerRegex.exec(rawText)) !== null) {
    const entryType = match[1].toLowerCase();
    if (['comment', 'preamble', 'string'].includes(entryType)) continue;
    const citeKey = match[2].trim();
    let idx = headerRegex.lastIndex;
    let depth = 1;
    let inQuotes = false;
    const startBody = idx;
    while (idx < rawText.length && depth > 0) {
      const ch = rawText[idx];
      const prev = rawText[idx - 1];
      if (ch === '"' && prev !== '\\') inQuotes = !inQuotes;
      else if (!inQuotes) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      idx++;
    }
    const body = rawText.slice(startBody, Math.max(startBody, idx - 1));
    const fields = {};
    let pos = 0;
    while (pos < body.length) {
      while (pos < body.length && /[\s,]/.test(body[pos])) pos++;
      if (pos >= body.length) break;
      const keyMatch = /^([A-Za-z0-9_:-]+)\s*=\s*/.exec(body.slice(pos));
      if (!keyMatch) {
        pos++;
        continue;
      }
      const fieldName = keyMatch[1].toLowerCase();
      pos += keyMatch[0].length;
      while (pos < body.length && /\s/.test(body[pos])) pos++;
      let rawVal = '';
      if (body[pos] === '{') {
        let bDepth = 1;
        pos++;
        const vStart = pos;
        while (pos < body.length && bDepth > 0) {
          if (body[pos] === '{' && body[pos - 1] !== '\\') bDepth++;
          else if (body[pos] === '}' && body[pos - 1] !== '\\') bDepth--;
          pos++;
        }
        rawVal = body.slice(vStart, Math.max(vStart, pos - 1));
      } else if (body[pos] === '"') {
        pos++;
        const vStart = pos;
        while (pos < body.length && !(body[pos] === '"' && body[pos - 1] !== '\\')) pos++;
        rawVal = body.slice(vStart, pos);
        pos++;
      } else {
        const vStart = pos;
        while (pos < body.length && body[pos] !== ',' && body[pos] !== '\n' && body[pos] !== '\r') pos++;
        rawVal = body.slice(vStart, pos);
      }
      fields[fieldName] = cleanBibValue(rawVal);
    }
    const title = (fields.title || fields.booktitle || '').slice(0, 160);
    if (!title) continue;
    const rawAuthor = fields.author || fields.editor || '';
    const author = rawAuthor
      ? rawAuthor.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean).join('; ').slice(0, 200)
      : '';
    const yearMatch = /\b(\d{4})\b/.exec(fields.year || fields.date || '');
    const year = yearMatch ? yearMatch[1] : '';
    const doi = (fields.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim();
    let url = (fields.url || '').trim();
    if (url) {
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) url = '';
      } catch {
        url = '';
      }
    }
    const journal = (fields.journal || fields.journaltitle || fields.booktitle || '').slice(0, 240);
    const publisher = (fields.publisher || fields.institution || fields.school || '').slice(0, 240);
    const volume = (fields.volume || '').slice(0, 60);
    const issue = (fields.number || fields.issue || '').slice(0, 60);
    const pages = (fields.pages || '').replace(/--+/g, '-').slice(0, 80);
    const abstract = (fields.abstract || fields.note || fields.annote || '').slice(0, 5000);
    let kind = 'other';
    if (['book', 'inbook', 'booklet', 'proceedings', 'collection', 'incollection'].includes(entryType)) kind = 'book';
    else if (['article', 'inproceedings', 'conference', 'phdthesis', 'mastersthesis', 'techreport', 'unpublished'].includes(entryType)) kind = 'paper';
    else if (['online', 'electronic', 'webpage', 'www'].includes(entryType) && url) kind = 'web';
    else if (doi || journal) kind = 'paper';
    else if (url) kind = 'web';
    const locator = kind === 'web'
      ? url
      : (doi ? `DOI:${doi}` : (url || (fields.isbn ? `ISBN:${fields.isbn}` : '')));
    entries.push({
      citeKey,
      entryType,
      kind,
      title,
      author,
      year,
      locator: locator.slice(0, 2048),
      doi,
      url,
      journal,
      publisher,
      volume,
      issue,
      pages,
      text: abstract,
    });
  }
  return entries;
}

export function parseRisEntries(rawText = '') {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const entries = [];
  const lines = rawText.split(/\r?\n/);
  let current = null;
  const flushCurrent = () => {
    if (!current) return;
    const title = String(current.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (!title) {
      current = null;
      return;
    }
    const author = current.authors.filter(Boolean).join('; ').slice(0, 200);
    const yearMatch = /\b(\d{4})\b/.exec(current.year || '');
    const year = yearMatch ? yearMatch[1] : '';
    const doi = String(current.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim();
    let url = String(current.url || '').trim();
    if (url) {
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) url = '';
      } catch {
        url = '';
      }
    }
    const ty = String(current.type || '').toUpperCase();
    let kind = 'other';
    if (['BOOK', 'CHAP', 'EDBOOK'].includes(ty)) kind = 'book';
    else if (['JOUR', 'JFULL', 'MGZN', 'CONF', 'CPAPER', 'THES', 'RPRT', 'UNPB'].includes(ty)) kind = 'paper';
    else if (['ELEC', 'WEB', 'BLOG'].includes(ty) && url) kind = 'web';
    else if (doi || current.journal) kind = 'paper';
    const pages = current.sp && current.ep ? `${current.sp}-${current.ep}` : (current.sp || current.ep || '');
    const locator = kind === 'web'
      ? url
      : (doi ? `DOI:${doi}` : (url || (current.sn ? `ISBN/ISSN:${current.sn}` : '')));
    entries.push({
      citeKey: String(current.id || '').trim(),
      entryType: ty.toLowerCase() || 'ris',
      kind,
      title,
      author,
      year,
      locator: locator.slice(0, 2048),
      doi,
      url,
      journal: String(current.journal || '').slice(0, 240),
      publisher: String(current.publisher || '').slice(0, 240),
      volume: String(current.volume || '').slice(0, 60),
      issue: String(current.issue || '').slice(0, 60),
      pages: String(pages || '').slice(0, 80),
      text: String(current.abstract || '').slice(0, 5000),
    });
    current = null;
  };
  for (const line of lines) {
    const m = /^\s*([A-Z0-9]{2})\s*-\s?(.*)$/.exec(line);
    if (!m) continue;
    const tag = m[1];
    const val = m[2].trim();
    if (tag === 'TY') {
      flushCurrent();
      current = { type: val, authors: [], title: '', journal: '', publisher: '', year: '', volume: '', issue: '', sp: '', ep: '', doi: '', url: '', sn: '', id: '', abstract: '' };
      continue;
    }
    if (tag === 'ER') {
      flushCurrent();
      continue;
    }
    if (!current) continue;
    if (['TI', 'T1', 'CT'].includes(tag) || (tag === 'BT' && !current.title)) current.title = val;
    else if (['AU', 'A1', 'A2'].includes(tag) && val) current.authors.push(val);
    else if (['JO', 'JF', 'T2', 'J2'].includes(tag) && !current.journal) current.journal = val;
    else if (tag === 'PB' && !current.publisher) current.publisher = val;
    else if (['PY', 'Y1', 'DA'].includes(tag) && !current.year) current.year = val;
    else if (tag === 'VL') current.volume = val;
    else if (tag === 'IS') current.issue = val;
    else if (tag === 'SP') current.sp = val;
    else if (tag === 'EP') current.ep = val;
    else if (tag === 'DO') current.doi = val;
    else if (['UR', 'L2'].includes(tag) && !current.url) current.url = val;
    else if (tag === 'SN' && !current.sn) current.sn = val;
    else if (tag === 'ID' && !current.id) current.id = val;
    else if (['AB', 'N2'].includes(tag) && !current.abstract) current.abstract = val;
  }
  flushCurrent();
  return entries;
}

export function parseAcademicReferences(rawText = '') {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('请粘贴或选择非空的 BibTeX (.bib) 或 RIS (.ris) 文献内容');
  }
  const results = [];
  if (/@[A-Za-z]+\s*\{/.test(rawText)) {
    results.push(...parseBibtexEntries(rawText));
  }
  if (/^\s*TY\s*-/m.test(rawText)) {
    results.push(...parseRisEntries(rawText));
  }
  if (!results.length) {
    throw new Error('未解析出包含标题的有效 BibTeX 或 RIS 文献条目');
  }
  return results;
}

export function readingNote(source) {
  const reference = noteReference(source.relativePath);
  return '---\n' + stringify({ title: source.title + ' · 阅读札记', category: 'reading', source_note: source.id, status: '阅读中', tags: ['research'] }) + '---\n\n# ' + source.title + ' · 阅读札记\n\n来源：' + reference + '\n\n## 关键观点\n\n## 证据与摘录\n\n## 问题与反例\n\n## 我的判断\n\n## 下一步\n';
}

export function excerptNote({ title, sourceTitle, relativePath, blockId, text }) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('请选择 1 至 20000 字符的摘录');
  const reference = noteReference(relativePath, blockId);
  return '---\n' + stringify({ title, category: 'excerpt', source_title: sourceTitle, source_reference: reference, tags: ['research', 'excerpt'] }) + '---\n\n# ' + title + '\n\n原文位置：' + reference + '\n\n## 摘录快照\n\n' + text.split(/\r?\n/).map(line => '> ' + line).join('\n') + '\n\n## 我的批注\n';
}

export function normalizeReaderBbox(bbox) {
  if (!bbox) return null;
  let x; let y; let w; let h;
  if (typeof bbox === 'string') {
    const parts = bbox.split(',').map(part => Number(part.trim()));
    if (parts.length !== 4 || parts.some(val => !Number.isFinite(val))) {
      throw new Error('原件区域坐标格式无效');
    }
    [x, y, w, h] = parts;
  } else if (typeof bbox === 'object') {
    x = Number(bbox.x);
    y = Number(bbox.y);
    w = Number(bbox.w);
    h = Number(bbox.h);
    if ([x, y, w, h].some(val => !Number.isFinite(val))) {
      throw new Error('原件区域坐标格式无效');
    }
  } else {
    throw new Error('原件区域坐标格式无效');
  }
  const clampedX = Math.max(0, Math.min(0.98, Math.round(x * 1000) / 1000));
  const clampedY = Math.max(0, Math.min(0.98, Math.round(y * 1000) / 1000));
  const clampedW = Math.max(0.01, Math.min(1 - clampedX, Math.round(w * 1000) / 1000));
  const clampedH = Math.max(0.01, Math.min(1 - clampedY, Math.round(h * 1000) / 1000));
  const bboxString = `${clampedX.toFixed(3)},${clampedY.toFixed(3)},${clampedW.toFixed(3)},${clampedH.toFixed(3)}`;
  const label = `(${Math.round(clampedX * 100)}%, ${Math.round(clampedY * 100)}%, ${Math.round(clampedW * 100)}%×${Math.round(clampedH * 100)}%)`;
  return { x: clampedX, y: clampedY, w: clampedW, h: clampedH, bboxString, label };
}

export function documentSourceLink({ relativePath, sourceHash, page, cfi, bbox }) {
  if (typeof relativePath !== 'string' || relativePath.length > 2048 || !/^raw\/.+\.(pdf|epub)$/i.test(relativePath) || /[\\:\x00-\x1f]/.test(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('原件必须位于 raw 目录，且为 PDF 或 EPUB 文件');
  if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('缺少原件 SHA-256，不能保存来源位置');
  const params = new URLSearchParams({ file: relativePath, hash: sourceHash });
  if (/\.pdf$/i.test(relativePath)) {
    if (!Number.isInteger(page) || page < 1 || page > 1000000) throw new Error('PDF 页码无效');
    params.set('page', String(page));
    if (bbox) {
      const normBbox = normalizeReaderBbox(bbox);
      if (normBbox) params.set('bbox', normBbox.bboxString);
    }
  } else {
    if (typeof cfi !== 'string' || cfi.length > 2048 || !/^epubcfi\([^\r\n\x00]+\)$/.test(cfi)) throw new Error('EPUB 章节位置无效');
    params.set('cfi', cfi);
  }
  return '#inkloom-reader?' + params.toString();
}

export function parseDocumentSourceLink(value) {
  if (typeof value !== 'string' || !value.startsWith('#inkloom-reader?')) return null;
  const params = new URLSearchParams(value.slice('#inkloom-reader?'.length));
  const location = { relativePath: params.get('file'), sourceHash: params.get('hash') };
  if (params.has('page')) location.page = Number(params.get('page'));
  if (params.has('cfi')) location.cfi = params.get('cfi');
  if (params.has('bbox')) {
    const normBbox = normalizeReaderBbox(params.get('bbox'));
    if (normBbox) {
      location.bbox = { x: normBbox.x, y: normBbox.y, w: normBbox.w, h: normBbox.h };
      location.bboxString = normBbox.bboxString;
    }
  }
  documentSourceLink(location);
  return location;
}

export function computePageLayoutBlocks(section = {}, pageNumber = 1) {
  const cleanHeading = String(section?.heading || `Page ${pageNumber}`).replace(/^\[Page\s+\d+\]\s*/i, '').trim() || `第 ${pageNumber} 页`;
  const paragraphs = String(section?.text || '').split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
  const blocks = [
    {
      index: -1,
      kind: 'heading',
      text: cleanHeading,
      x: 0.08,
      y: 0.07,
      w: 0.84,
      h: 0.08,
    },
  ];
  const count = Math.max(1, paragraphs.length);
  const availableTop = 0.18;
  const availableHeight = 0.72;
  const gap = 0.025;
  const slotHeight = Math.max(0.08, Math.min(0.22, (availableHeight - gap * Math.max(0, count - 1)) / count));
  paragraphs.forEach((paraText, idx) => {
    const yPos = Math.min(0.86, availableTop + idx * (slotHeight + gap));
    blocks.push({
      index: idx,
      kind: 'paragraph',
      text: paraText,
      x: 0.08,
      y: Math.round(yPos * 1000) / 1000,
      w: 0.84,
      h: Math.round(slotHeight * 1000) / 1000,
    });
  });
  return blocks;
}

export function extractTextFromPageRegion(layoutBlocks = [], bbox) {
  const norm = normalizeReaderBbox(bbox);
  if (!norm) return { matchedBlocks: [], text: '', bbox: null };
  const bx2 = norm.x + norm.w;
  const by2 = norm.y + norm.h;
  const matchedBlocks = (layoutBlocks || []).filter(block => {
    if (!block) return false;
    const xOverlap = Math.max(0, Math.min(bx2, block.x + block.w) - Math.max(norm.x, block.x));
    const yOverlap = Math.max(0, Math.min(by2, block.y + block.h) - Math.max(norm.y, block.y));
    return xOverlap > 0.005 && yOverlap > 0.005;
  });
  const paraBlocks = matchedBlocks.filter(b => b.kind === 'paragraph');
  const chosen = paraBlocks.length ? paraBlocks : matchedBlocks;
  const text = chosen.length
    ? chosen.map(b => b.text).join('\n')
    : `【画布框选区域 ${norm.label}】`;
  return {
    matchedBlocks: chosen,
    text,
    bbox: norm,
  };
}

export function renderPageRegionSvgThumbnail({ title = '', page = 1, bbox, snippet = '' } = {}) {
  const norm = normalizeReaderBbox(bbox) || { x: 0.08, y: 0.18, w: 0.84, h: 0.22, label: '(8%, 18%, 84%×22%)' };
  const esc = s => String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const rx = Math.round(16 + norm.x * 208);
  const ry = Math.round(28 + norm.y * 104);
  const rw = Math.max(18, Math.round(norm.w * 208));
  const rh = Math.max(14, Math.round(norm.h * 104));
  const cleanTitle = esc(String(title || 'PDF 原件').slice(0, 22));
  const cleanSnippet = esc(String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 34));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="144" viewBox="0 0 240 144">` +
    `<rect width="240" height="144" rx="8" fill="#f3f4f6" stroke="#cfd4dc"/>` +
    `<rect x="16" y="24" width="208" height="108" rx="4" fill="#ffffff" stroke="#d8dde6"/>` +
    `<text x="16" y="17" font-family="sans-serif" font-size="10" font-weight="600" fill="#2b313a">${cleanTitle} · P.${Number(page) || 1} ${esc(norm.label)}</text>` +
    `<line x1="28" y1="42" x2="196" y2="42" stroke="#e2e6ed" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="28" y1="58" x2="208" y2="58" stroke="#ebeff5" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="28" y1="72" x2="202" y2="72" stroke="#ebeff5" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="28" y1="86" x2="188" y2="86" stroke="#ebeff5" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="3" fill="#f59e0b" fill-opacity="0.22" stroke="#d97706" stroke-width="1.6" stroke-dasharray="3,2"/>` +
    `<text x="24" y="122" font-family="sans-serif" font-size="9.5" fill="#4b5563">${cleanSnippet}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function formatSplitReaderCitationBlock({ title, relativePath, sourceHash, page, cfi, chapter = '', text = '' }) {
  const isPdf = /\.pdf$/i.test(relativePath || '');
  const link = documentSourceLink({
    relativePath,
    sourceHash,
    page: isPdf ? Number(page) || 1 : undefined,
    cfi: !isPdf ? (cfi || 'epubcfi(/6/2!/4/2/1:0)') : undefined,
  });
  const cleanTitle = String(title || relativePath?.split('/').pop()?.replace(/\.(pdf|epub)$/i, '') || '原件').replace(/[\r\n[\]<>]/g, '').trim();
  const locLabel = isPdf
    ? `第 ${Number(page) || 1} 页`
    : (String(chapter || '').replace(/^\[Page\s+\d+\]\s*/i, '').trim() || cfi || '第 1 章');
  const cleanText = String(text || cleanTitle).replace(/\s+/g, ' ').trim().slice(0, 220);
  return `> ${cleanText} — [《${cleanTitle} · ${locLabel}》](<${link}>)`;
}

export function detectDocumentHashDrift(item, rawHashByPath = new Map()) {
  if (!item || typeof item !== 'object') return { drifted: false };
  const lookup = pathStr => {
    const key = String(pathStr || '').replaceAll('\\', '/').toLowerCase();
    if (!key) return '';
    if (rawHashByPath instanceof Map) return rawHashByPath.get(key) || '';
    return rawHashByPath[key] || '';
  };
  let relPath = String(item.sourceFile || item.metadata?.source_file || '').trim();
  let recHash = String(item.sourceHash || item.metadata?.source_hash || '').trim().toLowerCase();
  const refStr = String(item.sourceReference || item.metadata?.source_reference || '').trim();
  if ((!relPath || !recHash) && refStr.startsWith('#inkloom-reader?')) {
    try {
      const parsed = parseDocumentSourceLink(refStr);
      if (parsed) {
        relPath = relPath || parsed.relativePath;
        recHash = recHash || parsed.sourceHash;
      }
    } catch {}
  }
  if ((!relPath || !recHash) && typeof item.source === 'string') {
    const match = /#inkloom-reader\?([^\s)>"]+)/.exec(item.source);
    if (match) {
      try {
        const parsed = parseDocumentSourceLink('#inkloom-reader?' + match[1]);
        if (parsed) {
          relPath = relPath || parsed.relativePath;
          recHash = recHash || parsed.sourceHash;
        }
      } catch {}
    }
  }
  if (!relPath || !/^[a-f0-9]{64}$/.test(recHash)) return { drifted: false };
  const curHash = String(lookup(relPath) || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(curHash) || curHash === recHash) return { drifted: false, relativePath: relPath, recordedHash: recHash, currentHash: curHash || recHash };
  return {
    drifted: true,
    relativePath: relPath,
    recordedHash: recHash,
    currentHash: curHash,
    label: `原件版本已更新（${recHash.slice(0, 8)} → ${curHash.slice(0, 8)}）`,
  };
}

export function syncDocumentSourceHashInMarkdown(markdownSource = '', { relativePath, newHash } = {}) {
  if (typeof markdownSource !== 'string' || !markdownSource) throw new Error('原文不能为空');
  const cleanNewHash = String(newHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanNewHash)) throw new Error('新 SHA-256 哈希格式无效');
  const targetRel = String(relativePath || '').replaceAll('\\', '/').trim();
  let updated = markdownSource.replace(
    /(^source_hash:\s*["']?)[a-f0-9]{64}(["']?\s*$)/gim,
    `$1${cleanNewHash}$2`,
  );
  updated = updated.replace(/#inkloom-reader\?([^\s)>"]+)/g, (full, queryStr) => {
    try {
      const params = new URLSearchParams(queryStr);
      const fileParam = String(params.get('file') || '').replaceAll('\\', '/');
      if (targetRel && fileParam.toLowerCase() !== targetRel.toLowerCase()) return full;
      params.set('hash', cleanNewHash);
      return '#inkloom-reader?' + params.toString();
    } catch {
      return full;
    }
  });
  return updated;
}

export function documentExcerptNote({ title, sourceTitle, relativePath, sourceHash, page, cfi, bbox, regionThumbnail = '', chapter = '', text, annotation = '' }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\r\n]/.test(title)) throw new Error('摘录标题无效');
  if (typeof sourceTitle !== 'string' || !sourceTitle.trim() || sourceTitle.length > 512 || /[\r\n]/.test(sourceTitle)) throw new Error('原件标题无效');
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('请选择 1 至 20000 字符的摘录');
  if (typeof annotation !== 'string' || annotation.length > 20000 || typeof chapter !== 'string' || chapter.length > 512) throw new Error('批注或章节名称超过范围');
  const normBbox = bbox ? normalizeReaderBbox(bbox) : null;
  const reference = documentSourceLink({ relativePath, sourceHash, page, cfi, bbox: normBbox });
  const format = /\.pdf$/i.test(relativePath) ? 'pdf' : 'epub';
  const metadata = {
    title: title.trim(),
    category: 'excerpt',
    source_title: sourceTitle,
    source_file: relativePath,
    source_hash: sourceHash,
    source_format: format,
    source_reference: reference,
    ...(format === 'pdf' ? { source_page: page, ...(normBbox ? { source_bbox: normBbox.bboxString } : {}) } : { source_cfi: cfi, source_chapter: chapter }),
    tags: ['research', 'excerpt'],
  };
  const escape = value => value.replace(/[\\`*_{}\[\]<>!#|]/g, '\\$&');
  const label = sourceTitle + (format === 'pdf' ? ' · 第 ' + page + ' 页' + (normBbox ? ' · 区域 ' + normBbox.label : '') : chapter ? ' · ' + chapter : '');
  const snapshotUrl = normBbox
    ? (typeof regionThumbnail === 'string' && regionThumbnail.startsWith('data:image/')
        ? regionThumbnail
        : renderPageRegionSvgThumbnail({ title: sourceTitle, page, bbox: normBbox, snippet: text }))
    : '';
  const snapshotSection = snapshotUrl
    ? `\n## 区域版面快照\n\n![区域版面快照](${snapshotUrl})\n`
    : '';
  return '---\n' + stringify(metadata) + '---\n\n# ' + escape(title.trim()) + '\n\n原文位置：[' + escape(label) + '](<' + reference + '>)\n' + snapshotSection + '\n## 摘录快照\n\n' + text.split(/\r?\n/).map(line => '> ' + escape(line)).join('\n') + '\n\n## 我的批注\n\n' + annotation + '\n';
}

export function searchDocumentSections(sections = [], query = '') {
  const cleanQuery = String(query || '').trim().toLocaleLowerCase();
  if (!cleanQuery || !Array.isArray(sections)) return { query: '', totalMatches: 0, matchedIndices: [] };
  const matchedIndices = [];
  let totalMatches = 0;
  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx];
    const cleanHeading = String(sec?.heading || '').replace(/^\[Page\s+\d+\]\s*/i, '');
    const haystack = `${cleanHeading}\n${sec?.text || ''}`.toLocaleLowerCase();
    let pos = 0;
    let count = 0;
    while ((pos = haystack.indexOf(cleanQuery, pos)) !== -1) {
      count++;
      pos += cleanQuery.length;
    }
    if (count > 0) {
      matchedIndices.push(idx);
      totalMatches += count;
    }
  }
  return { query: String(query || '').trim(), totalMatches, matchedIndices };
}

export function compileDocumentReadingNote({ title, relativePath, sourceHash, sections = [], excerpts = [] }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\r\n]/.test(title)) throw new Error('原件标题无效');
  const isPdf = /\.pdf$/i.test(relativePath || '');
  const firstSec = Array.isArray(sections) && sections[0] ? sections[0] : {};
  const firstCfi = firstSec.cfi || 'epubcfi(/6/2!/4/2/1:0)';
  const rootReference = documentSourceLink({
    relativePath,
    sourceHash,
    page: isPdf ? 1 : undefined,
    cfi: !isPdf ? firstCfi : undefined,
  });
  const format = isPdf ? 'pdf' : 'epub';
  const noteTitle = `${title.trim()} · 精读札记`;
  const escape = value => String(value || '').replace(/[\\`*_{}\[\]<>!#|]/g, '\\$&');
  const metadata = {
    title: noteTitle,
    category: 'reading',
    source_title: title.trim(),
    source_file: relativePath,
    source_hash: sourceHash,
    source_format: format,
    source_reference: rootReference,
    status: '阅读中',
    tags: ['research', 'reading'],
  };

  const outlineLines = (Array.isArray(sections) ? sections : []).slice(0, 60).map((sec, idx) => {
    const pageNum = idx + 1;
    const cfi = sec?.cfi || `epubcfi(/6/${pageNum * 2}!/4/2/1:0)`;
    const link = documentSourceLink({
      relativePath,
      sourceHash,
      page: isPdf ? pageNum : undefined,
      cfi: !isPdf ? cfi : undefined,
    });
    const cleanHeading = String(sec?.heading || `第 ${pageNum} ${isPdf ? '页' : '章'}`).replace(/^\[Page \d+\]\s*/, '').trim();
    const preview = String(sec?.text || '').replace(/\s+/g, ' ').trim().slice(0, 96);
    const label = isPdf ? `第 ${pageNum} 页 · ${cleanHeading}` : `第 ${pageNum} 章 · ${cleanHeading}`;
    return `- [${escape(label)}](<${link}>)${preview ? `：${escape(preview)}` : ''}`;
  });

  const excerptLines = (Array.isArray(excerpts) ? excerpts : []).map(ex => {
    const exRef = ex?.RelativePath || ex?.relativePath ? noteReference(ex.RelativePath || ex.relativePath) : '';
    const locLink = typeof ex?.sourceReference === 'string' && ex.sourceReference.startsWith('#inkloom-reader?')
      ? ` · [定位原件](<${ex.sourceReference}>)`
      : '';
    return `- ${exRef || escape(ex?.title || '摘录')}${locLink}`;
  });

  return [
    '---',
    stringify(metadata).trimEnd(),
    '---',
    '',
    `# ${escape(noteTitle)}`,
    '',
    `原件位置：[${escape(title.trim())}（${relativePath} · SHA-256 ${sourceHash.slice(0, 8)}）](<${rootReference}>)`,
    '',
    `## 章节与页码脉络（共 ${sections.length} ${isPdf ? '页' : '章'}）`,
    '',
    ...(outlineLines.length ? outlineLines : ['- （暂无章节目录）']),
    '',
    `## 已存可溯源摘录（${excerptLines.length} 条）`,
    '',
    ...(excerptLines.length ? excerptLines : ['- （尚无摘录卡片，可在「研究 → 原件精读」中按段或划词摘录）']),
    '',
    '## 关键观点与研究判断',
    '',
    '- 在此提炼核心论点与方法论洞见，可通过 `[[` 关联全库概念卡。',
    '',
  ].join('\n');
}

export function countNoteWords(source = '') {
  if (typeof source !== 'string' || !source) return 0;
  const withoutFront = source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const withoutFences = withoutFront.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[\[[^\]]+\]\]/g, ' ');
  const cjk = withoutFences.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const words = withoutFences.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length || 0;
  return cjk + words;
}

export function manuscriptNote({ title, targetWords = 3000, synopsis = '' }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\r\n]/.test(title)) throw new Error('长稿标题无效');
  const target = Number(targetWords);
  if (!Number.isInteger(target) || target < 100 || target > 2000000) throw new Error('目标字数应为 100 至 2000000 的整数');
  if (typeof synopsis !== 'string' || synopsis.length > 100000) throw new Error('长稿提纲超过长度上限');
  const metadata = { title: title.trim(), category: 'manuscript', target_words: target, status: '写作中', tags: ['manuscript', 'research'] };
  return '---\n' + stringify(metadata) + '---\n\n# ' + title.trim() + '\n\n## 写作提纲\n\n' + (synopsis.trim() || '在此记录核心论点与结构规划。') + '\n\n## 章节结构\n';
}

export function manuscriptChapterNote({ manuscriptId, manuscriptTitle, chapterTitle, order = 1, targetWords = 1000 }) {
  if (typeof manuscriptId !== 'string' || !manuscriptId || typeof manuscriptTitle !== 'string' || !manuscriptTitle.trim()) throw new Error('所属长稿身份无效');
  if (typeof chapterTitle !== 'string' || !chapterTitle.trim() || chapterTitle.length > 160 || /[\r\n]/.test(chapterTitle)) throw new Error('章节标题无效');
  const seq = Number(order); const target = Number(targetWords);
  if (!Number.isInteger(seq) || seq < 1 || seq > 1000 || !Number.isInteger(target) || target < 50 || target > 500000) throw new Error('章节序号或目标字数无效');
  const metadata = {
    title: chapterTitle.trim(),
    category: 'chapter',
    manuscript: manuscriptId,
    manuscript_title: manuscriptTitle.trim(),
    chapter_order: seq,
    target_words: target,
    status: '草稿',
    tags: ['manuscript', 'chapter'],
  };
  return '---\n' + stringify(metadata) + '---\n\n# ' + chapterTitle.trim() + '\n\n在此撰写本章正文。\n';
}

export function appendManuscriptChapter(manuscriptSource, chapterRelativePath, chapterTitle = '') {
  if (typeof manuscriptSource !== 'string' || !manuscriptSource) throw new Error('长稿原文无效');
  const link = noteReference(chapterRelativePath);
  const embed = '!' + link;
  if (manuscriptSource.includes(embed)) throw new Error('该章节已在长稿结构中');
  const newline = manuscriptSource.includes('\r\n') ? '\r\n' : '\n';
  const trimmed = manuscriptSource.replace(/(?:\r?\n)+$/, '');
  const label = chapterTitle.trim() ? `- ${link} · ${chapterTitle.trim()}` : `- ${link}`;
  return trimmed + newline + newline + label + newline + newline + embed + newline;
}

export function synchronizeManuscriptStructure(manuscriptSource, chapters = []) {
  if (typeof manuscriptSource !== 'string' || !manuscriptSource) throw new Error('长稿原文无效');
  if (!Array.isArray(chapters) || !chapters.length) return manuscriptSource;
  const newline = manuscriptSource.includes('\r\n') ? '\r\n' : '\n';
  const sorted = [...chapters].sort((a, b) => (Number(a.chapterOrder) || 999) - (Number(b.chapterOrder) || 999) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
  const lines = [];
  for (const ch of sorted) {
    const link = noteReference(ch.relativePath);
    const title = String(ch.title || '').trim();
    lines.push((title ? `- ${link} · ${title}` : `- ${link}`) + newline + newline + '!' + link);
  }
  const sectionBlock = '## 章节结构' + newline + newline + lines.join(newline + newline) + newline;
  const marker = /## 章节结构[\s\S]*$/;
  if (marker.test(manuscriptSource)) return manuscriptSource.replace(marker, sectionBlock);
  return manuscriptSource.replace(/(?:\r?\n)+$/, '') + newline + newline + sectionBlock;
}

export function formatResearchCitation(item, style = 'wikilink') {
  if (!item || typeof item !== 'object') throw new Error('引文来源无效');
  const normStyle = String(style || 'wikilink').trim().toLowerCase();
  if (normStyle === 'wikilink') {
    if (item.category === 'excerpt' && typeof item.sourceReference === 'string' && /^\[\[[^\[\]]+\]\]$/.test(item.sourceReference)) {
      const title = String(item.sourceTitle || item.title || '').trim();
      return item.sourceReference + (title ? '（' + title + '）' : '');
    }
    if (item.category === 'excerpt' && typeof item.sourceReference === 'string' && item.sourceReference.startsWith('#inkloom-reader?')) {
      const parsed = parseDocumentSourceLink(item.sourceReference);
      const ref = noteReference(item.relativePath, item.blockId || '');
      const locLabel = parsed?.page ? `第 ${parsed.page} 页` : (item.sourceChapter || parsed?.cfi || '');
      const parts = [String(item.sourceTitle || item.title || '').trim(), locLabel].filter(Boolean);
      return ref + (parts.length ? '（' + parts.join(' · ') + '）' : '');
    }
    const reference = noteReference(item.relativePath, item.blockId || '');
    const meta = [item.author, item.year, item.locator].map(val => String(val || '').trim()).filter(Boolean);
    return reference + (meta.length ? '（' + meta.join('，') + '）' : '');
  }

  const title = String(item.sourceTitle || item.title || '').trim();
  const author = String(item.author || '').trim();
  const year = String(item.year || '').trim();
  const journal = String(item.journal || '').trim();
  const publisher = String(item.publisher || '').trim();
  const volume = String(item.volume || '').trim();
  const issue = String(item.issue || '').trim();
  const locator = String(item.locator || '').trim();
  const rawDoi = String(item.doi || '').trim() || (/^DOI:\s*(.+)$/i.exec(locator)?.[1]?.trim() || '');
  const cleanDoi = rawDoi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim();
  let pages = String(item.pages || '').trim();
  if (!pages && item.sourcePage) pages = String(item.sourcePage);
  else if (!pages && typeof item.sourceReference === 'string' && item.sourceReference.startsWith('#inkloom-reader?')) {
    try {
      const parsed = parseDocumentSourceLink(item.sourceReference);
      if (parsed?.page) pages = String(parsed.page);
    } catch {}
  }
  const sourceType = String(item.sourceType || item.kind || '').toLowerCase();

  if (normStyle === 'gbt7714') {
    const typeCode = sourceType === 'book' ? 'M' : sourceType === 'paper' ? 'J' : sourceType === 'web' ? 'EB/OL' : 'Z';
    const segments = [];
    if (author) segments.push(author.replace(/\.$/, ''));
    segments.push(`${title}[${typeCode}]`);
    if (typeCode === 'J') {
      const volIssue = volume ? (issue ? `${volume}(${issue})` : volume) : (issue ? `(${issue})` : '');
      const venueCore = [journal, year, volIssue].filter(Boolean).join(', ');
      if (venueCore || pages) {
        segments.push(venueCore ? (pages ? `${venueCore}: ${pages}` : venueCore) : `p. ${pages}`);
      }
    } else {
      const pubCore = [publisher || journal, year].filter(Boolean).join(', ');
      if (pubCore || pages) {
        segments.push(pubCore ? (pages ? `${pubCore}: ${pages}` : pubCore) : `p. ${pages}`);
      }
    }
    if (cleanDoi) segments.push(`DOI:${cleanDoi}`);
    else if (locator) segments.push(locator);
    return segments.filter(Boolean).join('. ') + '.';
  }

  if (normStyle === 'apa') {
    const parts = [];
    if (author) parts.push(`${author.replace(/\.$/, '')}.`);
    if (year) parts.push(`(${year}).`);
    parts.push(`${title.replace(/\.$/, '')}.`);
    if (journal) {
      const volIssue = volume ? (issue ? `*${journal}*, *${volume}*(${issue})` : `*${journal}*, *${volume}*`) : (issue ? `*${journal}*, (${issue})` : `*${journal}*`);
      parts.push(pages ? `${volIssue}, ${pages}.` : `${volIssue}.`);
    } else if (publisher) {
      parts.push(pages ? `${publisher}, pp. ${pages}.` : `${publisher}.`);
    } else if (pages) {
      parts.push(`pp. ${pages}.`);
    }
    if (cleanDoi) parts.push(`https://doi.org/${cleanDoi}`);
    else if (locator) parts.push(locator);
    return parts.filter(Boolean).join(' ');
  }

  if (normStyle === 'bibtex') {
    const bibType = sourceType === 'book' ? 'book' : sourceType === 'paper' ? 'article' : 'misc';
    const fallbackAuthorKey = (author.split(/[,\s;]+/)[0] || 'ref').replace(/[^A-Za-z0-9\u4e00-\u9fa5_-]/g, '');
    const fallbackTitleKey = title.slice(0, 10).replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '');
    const rawKey = String(item.citeKey || '').replace(/[^A-Za-z0-9_:-]/g, '');
    const key = rawKey || `${fallbackAuthorKey}${year || ''}_${fallbackTitleKey || 'entry'}`;
    const fields = [['title', title]];
    if (author) fields.push(['author', author.replace(/;\s*/g, ' and ')]);
    if (year) fields.push(['year', year]);
    if (journal) fields.push([bibType === 'book' ? 'booktitle' : 'journal', journal]);
    if (publisher) fields.push(['publisher', publisher]);
    if (volume) fields.push(['volume', volume]);
    if (issue) fields.push(['number', issue]);
    if (pages) fields.push(['pages', pages]);
    if (cleanDoi) fields.push(['doi', cleanDoi]);
    else if (locator) fields.push([/^https?:\/\//i.test(locator) ? 'url' : 'note', locator]);
    const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    return `@${bibType}{${key},\n${body}\n}`;
  }

  throw new Error('不支持的引文格式：' + style);
}

const HIGHLIGHT_TONE_LABELS = {
  yellow: { label: '淡黄高亮', tone: 'amber' },
  green: { label: '浅绿高亮', tone: 'emerald' },
  blue: { label: '天蓝高亮', tone: 'blue' },
  pink: { label: '浅粉高亮', tone: 'rose' },
  orange: { label: '淡橙高亮', tone: 'purple' },
  quote: { label: '引文与提示块', tone: 'indigo' },
};

export function extractVaultHighlights(notes = [], { colorFilter = 'all', query = '' } = {}) {
  const items = [];
  const q = String(query || '').trim().toLocaleLowerCase();

  for (const note of notes || []) {
    if (!note || note.exists === false || note.ghost || typeof note.source !== 'string') continue;
    if (note.metadata?.category === 'whiteboard') continue;
    const raw = note.source.replace(/^\uFEFF/, '');
    const withoutFm = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    const lines = withoutFm.split(/\r?\n/);
    const noteTitle = String(note.title || note.cleanTitle || note.name || '未命名笔记').replace(/^\d+-/, '');
    const relPath = String(note.relativePath || note.name || `${note.id}.md`).replace(/\.(md|markdown)$/i, '');

    // 0. User-selected background highlights from #selection-tools (annotations / marks)
    if (Array.isArray(note.highlights)) {
      for (const [mIdx, mark] of note.highlights.entries()) {
        const color = String(mark?.color || 'yellow').toLowerCase();
        if (!HIGHLIGHT_TONE_LABELS[color] || color === 'quote') continue;
        const text = String(mark.quote ?? (Number.isInteger(mark.from) && Number.isInteger(mark.to) ? note.source.slice(mark.from, mark.to) : '')).trim();
        if (!text) continue;
        const lineNum = Number.isInteger(mark.from) ? note.source.slice(0, mark.from).split(/\r?\n/).length : 1;
        items.push({
          id: `${note.id}:painted:${mIdx}:${lineNum}`,
          noteId: note.id,
          noteTitle,
          relativePath: note.relativePath || '',
          citation: `[[${relPath}]]`,
          color,
          colorLabel: HIGHLIGHT_TONE_LABELS[color].label,
          tone: HIGHLIGHT_TONE_LABELS[color].tone,
          lineNum,
          text,
        });
      }
    }

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      // 1. HTML <mark data-color="...">...</mark> or <mark>...</mark>
      for (const m of line.matchAll(/<mark(?:\s+[^>]*data-color=["'](yellow|green|blue|pink|orange)["'][^>]*)?>([^<]{2,400})<\/mark>/gi)) {
        const color = (m[1] || 'yellow').toLowerCase();
        const text = m[2].trim();
        if (text) {
          items.push({
            id: `${note.id}:mark:${lineNum}:${m.index}`,
            noteId: note.id,
            noteTitle,
            relativePath: note.relativePath || '',
            citation: `[[${relPath}]]`,
            color,
            colorLabel: HIGHLIGHT_TONE_LABELS[color]?.label || '淡黄高亮',
            tone: HIGHLIGHT_TONE_LABELS[color]?.tone || 'amber',
            lineNum,
            text,
          });
        }
      }

      // 2. Markdown ==highlight==
      for (const m of line.matchAll(/==([^=\n]{2,300})==/g)) {
        const text = m[1].trim();
        if (text) {
          items.push({
            id: `${note.id}:eq:${lineNum}:${m.index}`,
            noteId: note.id,
            noteTitle,
            relativePath: note.relativePath || '',
            citation: `[[${relPath}]]`,
            color: 'yellow',
            colorLabel: HIGHLIGHT_TONE_LABELS.yellow.label,
            tone: HIGHLIGHT_TONE_LABELS.yellow.tone,
            lineNum,
            text,
          });
        }
      }

      // 3. Callouts or Blockquote citations (> [!NOTE|TIP|IMPORTANT] or > text) -> always 'quote'
      const trimmed = line.trim();
      if (trimmed.startsWith('>')) {
        const calloutMatch = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(trimmed);
        if (calloutMatch) {
          const kind = calloutMatch[1].toUpperCase();
          const titlePart = calloutMatch[2].trim();
          const hasNextQuoteLine = /^\s*>/.test(lines[idx + 1] || '');
          const nextLine = hasNextQuoteLine ? (lines[idx + 1] || '').replace(/^\s*>\s?/, '').trim() : '';
          if (hasNextQuoteLine) idx++;
          const combined = [titlePart, nextLine].filter(Boolean).join(' — ');
          if (combined.length >= 4) {
            items.push({
              id: `${note.id}:callout:${lineNum}`,
              noteId: note.id,
              noteTitle,
              relativePath: note.relativePath || '',
              citation: `[[${relPath}]]`,
              color: 'quote',
              colorLabel: HIGHLIGHT_TONE_LABELS.quote.label,
              tone: HIGHLIGHT_TONE_LABELS.quote.tone,
              lineNum,
              text: `[!${kind}] ${combined}`,
            });
          }
        } else {
          const quoteBody = trimmed.replace(/^>\s*/, '').trim();
          if (quoteBody.length >= 8 && !/^\[!/.test(quoteBody)) {
            items.push({
              id: `${note.id}:quote:${lineNum}`,
              noteId: note.id,
              noteTitle,
              relativePath: note.relativePath || '',
              citation: `[[${relPath}]]`,
              color: 'quote',
              colorLabel: HIGHLIGHT_TONE_LABELS.quote.label,
              tone: HIGHLIGHT_TONE_LABELS.quote.tone,
              lineNum,
              text: quoteBody,
            });
          }
        }
      }
    }
  }

  const counts = {
    all: items.length,
    yellow: items.filter(i => i.color === 'yellow').length,
    green: items.filter(i => i.color === 'green').length,
    blue: items.filter(i => i.color === 'blue').length,
    pink: items.filter(i => i.color === 'pink').length,
    orange: items.filter(i => i.color === 'orange').length,
    quote: items.filter(i => i.color === 'quote').length,
  };

  const filtered = items.filter(item => {
    if (colorFilter && colorFilter !== 'all' && item.color !== colorFilter) return false;
    if (q && !`${item.text} ${item.noteTitle} ${item.colorLabel}`.toLocaleLowerCase().includes(q)) return false;
    return true;
  });

  return {
    counts,
    total: filtered.length,
    items: filtered.slice(0, 120),
  };
}

export function compileHighlightsDigestMarkdown(items = [], { title = '全库高亮批注与引文精粹' } = {}) {
  const cleanTitle = String(title || '全库高亮批注与引文精粹').trim();
  const metadata = {
    title: cleanTitle,
    category: 'excerpt',
    status: '已读',
    tags: ['research', 'highlights', 'digest'],
  };
  const byNote = new Map();
  for (const item of items || []) {
    const key = item.noteTitle || '未命名笔记';
    if (!byNote.has(key)) byNote.set(key, { citation: item.citation || `[[${key}]]`, list: [] });
    byNote.get(key).list.push(item);
  }
  const sections = [];
  for (const [noteTitle, group] of byNote) {
    const lines = group.list.map(entry => `- **【${entry.colorLabel} · Ln ${entry.lineNum}】** ${entry.text} （来源：${group.citation}）`);
    sections.push(`## 《${noteTitle}》批注摘录（${group.list.length} 条）\n\n${lines.join('\n')}`);
  }
  const body = sections.length ? sections.join('\n\n') : '当前筛选条件下暂无高亮或批注条目。';
  return `---\n${stringify(metadata)}---\n\n# ${cleanTitle}\n\n> 共聚合 ${items.length} 条跨笔记高亮批注与引文摘录。\n\n${body}\n`;
}

export function compilePublicationManuscript(manuscript = {}, chapters = [], {
  purifyLinks = true,
  autoNumberChapters = true,
  includeToc = true,
  includeCitationIndex = true,
  citationStyle = 'wikilink',
  referenceNotes = [],
} = {}) {
  const msTitle = String(manuscript.title || '未命名长稿').trim();
  const targetWords = Math.max(100, Number(manuscript.targetWords) || 3000);
  const sorted = [...(chapters || [])].sort(
    (a, b) => (Number(a.chapterOrder) || 999) - (Number(b.chapterOrder) || 999) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'),
  );
  const normCiteStyle = ['wikilink', 'gbt7714', 'apa', 'bibtex'].includes(String(citationStyle || '').toLowerCase())
    ? String(citationStyle).toLowerCase()
    : 'wikilink';

  const lookupMap = new Map();
  for (const item of referenceNotes || []) {
    if (!item || typeof item !== 'object') continue;
    const relNoExt = String(item.relativePath || '').replace(/\.(md|markdown)$/i, '').trim();
    const shortName = relNoExt.split('/').pop()?.trim() || '';
    const cleanTitle = String(item.title || '').trim();
    if (relNoExt) lookupMap.set(relNoExt.toLowerCase(), item);
    if (shortName) lookupMap.set(shortName.toLowerCase(), item);
    if (cleanTitle) lookupMap.set(cleanTitle.toLowerCase(), item);
  }

  const referencedTargets = new Set();
  const purifyText = text => {
    let out = String(text || '');
    for (const m of out.matchAll(/!?\[\[([^\][\n]+?)\]\]/g)) {
      const inner = m[1];
      const [targetAndHeading, alias] = inner.split('|');
      const [target] = targetAndHeading.split('#');
      if (target && target.trim()) referencedTargets.add(target.trim());
    }
    if (!purifyLinks) return out;
    return out
      .replace(/!\[\[([^\][\n]+?)\]\]/g, (_, inner) => {
        const parts = inner.split('|');
        return parts[1] ? parts[1].trim() : parts[0].split('/').pop().trim();
      })
      .replace(/\[\[([^\][\n]+?)\]\]/g, (_, inner) => {
        const parts = inner.split('|');
        if (parts[1]) return parts[1].trim();
        const [t, h] = parts[0].split('#');
        const cleanT = t.split('/').pop().replace(/^\d+-/, '').trim();
        return h && !h.startsWith('^') ? `${cleanT}（${h}）` : cleanT;
      });
  };

  const chapterBlocks = [];
  const tocLines = [];
  let totalWords = 0;

  for (const [idx, ch] of sorted.entries()) {
    const seq = idx + 1;
    const rawSource = String(ch.source || '').replace(/^\uFEFF/, '');
    const withoutFm = rawSource.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
    const bodyWithoutTopH1 = withoutFm.replace(/^#\s+[^\r\n]+\r?\n*/, '').trim();
    const cleanChTitle = String(ch.title || `章节 ${seq}`).replace(/^.*·\s*/, '').trim();
    const headingText = autoNumberChapters ? `第 ${seq} 章 · ${cleanChTitle}` : cleanChTitle;
    const cleanedBody = purifyText(bodyWithoutTopH1 || '（本章正文待补充）');
    const words = countNoteWords(cleanedBody);
    totalWords += words;
    tocLines.push(`${seq}. **${headingText}**（${words} 字）`);
    chapterBlocks.push(`## ${headingText}\n\n${cleanedBody}`);
  }

  const completionRate = Math.min(100, Math.round((totalWords / targetWords) * 100));
  const metadata = {
    title: `${msTitle}（出版联排定稿）`,
    category: 'manuscript',
    status: '已完成',
    chapter_count: sorted.length,
    word_count: totalWords,
    target_words: targetWords,
    citation_style: normCiteStyle,
    tags: ['manuscript', 'publication'],
  };

  const parts = [
    `---\n${stringify(metadata)}---`,
    `# ${msTitle}`,
    `> **出版联排定稿** · 共 ${sorted.length} 章 · 总计 ${totalWords} 字（目标达成率 ${completionRate}%）`,
  ];

  if (includeToc && tocLines.length) {
    parts.push(`## 全稿目录 (TOC)\n\n${tocLines.join('\n')}`);
  }
  if (chapterBlocks.length) {
    parts.push(chapterBlocks.join('\n\n---\n\n'));
  }
  if (includeCitationIndex && referencedTargets.size) {
    const sortedTargets = [...referencedTargets].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const refLines = sortedTargets.map((t, idx) => {
      const matched = lookupMap.get(t.toLowerCase()) || lookupMap.get(t.split('/').pop()?.toLowerCase() || '');
      if (!matched || normCiteStyle === 'wikilink') {
        if (matched && (matched.author || matched.year || matched.locator || matched.doi)) {
          return `- [[${t}]] — ${formatResearchCitation(matched, 'wikilink')}`;
        }
        return `- [[${t}]]`;
      }
      if (normCiteStyle === 'bibtex') {
        const bib = formatResearchCitation(matched, 'bibtex').replace(/\n+/g, ' ');
        return `- [${idx + 1}] [[${t}]] — \`${bib}\``;
      }
      return `- [${idx + 1}] [[${t}]] — ${formatResearchCitation(matched, normCiteStyle)}`;
    });
    parts.push(`## 参考文献与关联索引\n\n${refLines.join('\n')}`);
  }

  return {
    title: `${msTitle}（出版联排定稿）`,
    chapterCount: sorted.length,
    totalWords,
    targetWords,
    completionRate,
    citationStyle: normCiteStyle,
    referencedCount: referencedTargets.size,
    markdown: parts.join('\n\n') + '\n',
  };
}

/**
 * MAJOR-260 (2.6.0): Multi-level Folder-to-Manuscript Binder Engine
 * Recursively maps a multi-level folder hierarchy into a structured Manuscript Binder MOC
 * with per-subfolder/per-chapter word counts, status progress, and embedded chapter sequence.
 */
export function compileFolderManuscriptBinder(notes = [], {
  folderPath = '',
  title = '',
  targetWords = 0,
  synopsis = '',
} = {}) {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const cleanFolder = String(folderPath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const folderPrefix = cleanFolder ? `${cleanFolder}/` : '';

  const matchedNotes = (Array.isArray(notes) ? notes : [])
    .filter(n => {
      if (!n || n.exists === false || n.ghost) return false;
      const cat = String(n.metadata?.category || n.category || '').toLowerCase();
      if (cat === 'whiteboard') return false;
      const rel = String(n.relativePath || n.name || '').replaceAll('\\', '/').replace(/^\/+/, '');
      if (!rel || !/\.(md|markdown)$/i.test(rel)) return false;
      if (!cleanFolder) return true;
      return rel.toLowerCase().startsWith(folderPrefix.toLowerCase());
    })
    .sort((a, b) => {
      const relA = String(a.relativePath || a.name || '').replaceAll('\\', '/');
      const relB = String(b.relativePath || b.name || '').replaceAll('\\', '/');
      return collator.compare(relA, relB);
    });

  if (!matchedNotes.length) {
    throw new Error(cleanFolder ? `目录「${cleanFolder}」下未找到可汇编的 Markdown 笔记` : '当前知识库暂无可汇编的 Markdown 笔记');
  }

  const defaultBinderTitle = title.trim()
    || (cleanFolder ? `${cleanFolder.split('/').pop()} · 多级目录长稿总览` : '全库多级目录长稿总览');

  const chapters = [];
  const groupMap = new Map();
  let totalWords = 0;

  for (const [idx, note] of matchedNotes.entries()) {
    const seq = idx + 1;
    const rel = String(note.relativePath || note.name || '').replaceAll('\\', '/').replace(/^\/+/, '');
    const relativeSubpath = cleanFolder && rel.toLowerCase().startsWith(folderPrefix.toLowerCase())
      ? rel.slice(folderPrefix.length)
      : rel;
    const subParts = relativeSubpath.split('/');
    subParts.pop();
    const subfolderGroup = subParts.join('/') || '直属章节';
    const rawSource = String(note.source || '');
    const words = Number.isFinite(Number(note.wordCount)) && Number(note.wordCount) > 0
      ? Number(note.wordCount)
      : countNoteWords(rawSource);
    totalWords += words;

    const status = String(
      note.status
      || note.metadata?.status
      || note.properties?.find?.(p => p.key === 'status')?.value
      || '写作中',
    ).trim();

    const withoutFm = rawSource
      .replace(/^\uFEFF/, '')
      .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
      .replace(/^#\s+[^\r\n]+\r?\n*/, '')
      .trim();
    const firstPara = withoutFm
      .split(/\r?\n+/)
      .map(line => line.replace(/^>\s*/, '').trim())
      .find(line => line && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('```')) || '';
    const summaryText = String(note.metadata?.summary || firstPara || note.title || note.name || '')
      .replace(/\|/g, '｜')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64);

    const cleanNoteTitle = String(note.cleanTitle || note.title || note.name || `章节 ${seq}`).replace(/\.(md|markdown)$/i, '');
    const linkRef = noteReference(rel);

    const chapterEntry = {
      order: seq,
      id: note.id || `ch-${seq}`,
      title: cleanNoteTitle,
      relativePath: rel,
      subfolderGroup,
      status,
      wordCount: words,
      summary: summaryText || '—',
      reference: linkRef,
    };
    chapters.push(chapterEntry);

    if (!groupMap.has(subfolderGroup)) {
      groupMap.set(subfolderGroup, {
        groupPath: subfolderGroup,
        chapterCount: 0,
        wordCount: 0,
        chapters: [],
      });
    }
    const g = groupMap.get(subfolderGroup);
    g.chapterCount += 1;
    g.wordCount += words;
    g.chapters.push(chapterEntry);
  }

  const resolvedTargetWords = Number(targetWords) >= 100
    ? Math.round(Number(targetWords))
    : Math.max(3000, chapters.length * 1500);
  const completionRate = Math.min(100, Math.round((totalWords / resolvedTargetWords) * 100));

  const metadata = {
    title: defaultBinderTitle,
    category: 'manuscript',
    binder_folder: cleanFolder || '/',
    chapter_count: chapters.length,
    subfolder_groups: groupMap.size,
    word_count: totalWords,
    target_words: resolvedTargetWords,
    status: completionRate >= 100 ? '已完成' : '写作中',
    tags: ['manuscript', 'binder', 'research'],
  };

  const tableRows = chapters.map(ch =>
    `| ${ch.order} | ${ch.subfolderGroup} | ${ch.reference} | ${ch.status} | ${ch.wordCount} | ${ch.summary} |`,
  );

  const groupSummaryLines = [...groupMap.values()].map(g =>
    `- **📂 ${g.groupPath}**：共 ${g.chapterCount} 节 · 累计 ${g.wordCount} 字`,
  );

  const embedLines = chapters.map(ch =>
    `- ${ch.reference} · ${ch.title}（${ch.subfolderGroup} · ${ch.wordCount} 字）\n\n!${ch.reference}`,
  );

  const markdown = [
    '---',
    stringify(metadata).trimEnd(),
    '---',
    '',
    `# ${defaultBinderTitle}`,
    '',
    `> **📚 多级目录长稿编排总控台** · 绑定目录：\`${cleanFolder || '/'}\` · 共 **${groupMap.size}** 个分卷/子目录组、**${chapters.length}** 篇章节 · 累计 **${totalWords}** / ${resolvedTargetWords} 字（达成率 **${completionRate}%**）`,
    '',
    '## 写作提纲',
    '',
    synopsis.trim() || `本长稿由多级目录 \`${cleanFolder || '/'}\` 自动递归映射生成，支持按分卷/子目录追踪各章节字数进度、状态流转与全文联排出版。`,
    '',
    '## 分卷与子目录进度汇总',
    '',
    ...groupSummaryLines,
    '',
    '## 分章编排与字数总览表',
    '',
    '| 序号 | 所属分卷/子目录 | 章节笔记（双链直达） | 状态 | 字数 | 章节题要 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...tableRows,
    '',
    '## 章节结构',
    '',
    embedLines.join('\n\n'),
    '',
  ].join('\n');

  return {
    title: defaultBinderTitle,
    folderPath: cleanFolder,
    chapterCount: chapters.length,
    sectionGroupCount: groupMap.size,
    totalWords,
    targetWords: resolvedTargetWords,
    completionRate,
    chapters,
    groups: [...groupMap.values()],
    markdown,
  };
}