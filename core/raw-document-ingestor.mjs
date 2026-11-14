import { parseFrontMatter, stripNumericPrefix, localDate } from './vault-graph.mjs';

const nodeZlib = typeof globalThis.process?.getBuiltinModule === 'function'
  ? globalThis.process.getBuiltinModule('node:zlib')
  : null;

export const SUPPORTED_RAW_EXTENSIONS = [
  '.pdf', '.epub', '.docx', '.pptx', '.xlsx', '.csv', '.tsv', '.txt', '.html', '.htm', '.md', '.markdown', '.png', '.jpg', '.jpeg', '.webp', '.svg',
];

export function detectRawFileFormat(fileName = '') {
  const lower = String(fileName || '').trim().toLowerCase();
  if (lower.endsWith('.pdf')) return { ext: '.pdf', type: 'pdf', badge: 'PDF 文档', binary: true };
  if (lower.endsWith('.epub')) return { ext: '.epub', type: 'epub', badge: 'EPUB 电子书', binary: true };
  if (lower.endsWith('.docx')) return { ext: '.docx', type: 'docx', badge: 'Word 文档', binary: true };
  if (lower.endsWith('.pptx')) return { ext: '.pptx', type: 'pptx', badge: 'PPT 演示稿', binary: true };
  if (lower.endsWith('.xlsx')) return { ext: '.xlsx', type: 'xlsx', badge: 'Excel 表格', binary: true };
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.svg')) {
    const ext = lower.slice(lower.lastIndexOf('.'));
    return { ext, type: 'image', badge: '长图 / 扫描图 (OCR)', binary: ext !== '.svg' };
  }
  if (lower.endsWith('.csv')) return { ext: '.csv', type: 'csv', badge: 'CSV 数据表', binary: false };
  if (lower.endsWith('.tsv')) return { ext: '.tsv', type: 'tsv', badge: 'TSV 数据表', binary: false };
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return { ext: '.html', type: 'html', badge: '网页文章', binary: false };
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return { ext: '.md', type: 'markdown', badge: 'Markdown', binary: false };
  return { ext: '.txt', type: 'txt', badge: '纯文本', binary: false };
}

export function base64ToUint8Array(base64 = '') {
  const cleaned = String(base64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!cleaned) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(cleaned, 'base64'));
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function uint8ArrayToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

export function computeSimpleSha256Hex(input = '') {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  let h3 = 0x9e3779b9 ^ text.length;
  let h4 = 0x85ebca6b ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ (ch << 3), 2246822507);
    h4 = Math.imul(h4 ^ (ch << 7), 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  return [h1, h2, h3, h4, h1 ^ h3, h2 ^ h4, h1 ^ h4, h2 ^ h3]
    .map(v => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function inflateBytesSync(compressed, format = 'deflate-raw') {
  if (nodeZlib) {
    try {
      const buf = format === 'deflate-raw'
        ? nodeZlib.inflateRawSync(compressed)
        : nodeZlib.inflateSync(compressed);
      return new Uint8Array(buf);
    } catch {
      try {
        return new Uint8Array(nodeZlib.inflateRawSync(compressed));
      } catch {
        return new Uint8Array(0);
      }
    }
  }
  return new Uint8Array(0);
}

async function inflateBytes(compressed, format = 'deflate-raw') {
  if (nodeZlib) return inflateBytesSync(compressed, format);
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const resp = new Response(ds.readable);
      return new Uint8Array(await resp.arrayBuffer());
    } catch {
      return new Uint8Array(0);
    }
  }
  return new Uint8Array(0);
}

function collectRawZipSlices(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const slices = [];
  if (u8.byteLength < 22) return slices;

  let eocdOffset = -1;
  const minEocd = Math.max(0, u8.byteLength - 65557);
  for (let i = u8.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    let ptr = cdOffset;
    for (let idx = 0; idx < totalEntries && ptr + 46 <= u8.byteLength; idx++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const nameBytes = u8.subarray(ptr + 46, ptr + 46 + nameLen);
      const entryName = new TextDecoder('utf-8').decode(nameBytes).replaceAll('\\', '/');
      ptr += 46 + nameLen + extraLen + commentLen;

      if (localHeaderOffset + 30 > u8.byteLength) continue;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = Math.min(u8.byteLength, dataStart + compressedSize);
      slices.push({ entryName, method: compressionMethod, slice: u8.subarray(dataStart, dataEnd) });
    }
    return slices;
  }

  let pos = 0;
  while (pos + 30 <= u8.byteLength) {
    if (view.getUint32(pos, true) !== 0x04034b50) break;
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const entryName = new TextDecoder('utf-8').decode(u8.subarray(pos + 30, pos + 30 + nameLen)).replaceAll('\\', '/');
    const dataStart = pos + 30 + nameLen + extraLen;
    slices.push({ entryName, method, slice: u8.subarray(dataStart, Math.min(u8.byteLength, dataStart + compSize)) });
    pos = dataStart + compSize;
  }
  return slices;
}

export function unpackZipEntriesSync(bytes) {
  const entries = new Map();
  for (const { entryName, method, slice } of collectRawZipSlices(bytes)) {
    if (method === 0) entries.set(entryName, slice);
    else if (method === 8) entries.set(entryName, inflateBytesSync(slice, 'deflate-raw'));
  }
  return entries;
}

export async function unpackZipEntries(bytes) {
  const entries = new Map();
  for (const { entryName, method, slice } of collectRawZipSlices(bytes)) {
    if (method === 0) entries.set(entryName, slice);
    else if (method === 8) entries.set(entryName, await inflateBytes(slice, 'deflate-raw'));
  }
  return entries;
}

/**
 * Minimal ZIP builder (Stored method 0 with CRC-32) for generating valid .docx/.pptx/.xlsx test & starter fixtures
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildStoredZipBytes(fileMap = {}) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const names = Object.keys(fileMap);

  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const raw = fileMap[name];
    const dataBytes = typeof raw === 'string' ? encoder.encode(raw) : new Uint8Array(raw);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // Stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, names.length, true);
  ev.setUint16(10, names.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function decodeXmlEntities(str = '') {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseSimpleXml(xmlText = '') {
  const root = { nodeType: 9, nodeName: '#document', localName: '#document', attributes: [], childNodes: [], get textContent() { return this.childNodes.map(c => c.textContent || '').join(''); } };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z0-9_.:-]+)\s*>|<([A-Za-z0-9_.:-]+)((?:\s+[A-Za-z0-9_.:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
  let match;
  while ((match = tokenRe.exec(xmlText)) !== null) {
    const top = stack[stack.length - 1];
    if (match[1] !== undefined) {
      top.childNodes.push({ nodeType: 3, textContent: match[1] });
    } else if (match[2] !== undefined) {
      const closeLocal = match[2].replace(/^.*:/, '');
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].localName === closeLocal || stack[i].nodeName === match[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (match[3] !== undefined) {
      const nodeName = match[3];
      const localName = nodeName.replace(/^.*:/, '');
      const attrRaw = match[4] || '';
      const selfClosing = match[5] === '/';
      const attributes = [];
      const attrRe = /([A-Za-z0-9_.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      let am;
      while ((am = attrRe.exec(attrRaw)) !== null) {
        const name = am[1];
        const value = decodeXmlEntities(am[2] ?? am[3] ?? am[4] ?? '');
        attributes.push({ name, localName: name.replace(/^.*:/, ''), value });
      }
      const el = {
        nodeType: 1,
        nodeName,
        localName,
        attributes,
        childNodes: [],
        get textContent() {
          return this.childNodes.map(c => c.textContent || '').join('');
        },
      };
      top.childNodes.push(el);
      if (!selfClosing) stack.push(el);
    } else if (match[6] !== undefined) {
      const text = decodeXmlEntities(match[6]);
      if (text) top.childNodes.push({ nodeType: 3, textContent: text });
    }
  }
  root.documentElement = root.childNodes.find(c => c.nodeType === 1) || root;
  return root;
}

function localNameOf(node) {
  return String(node?.localName || node?.nodeName || '').replace(/^.*:/, '');
}

function childrenByLocalName(parent, name) {
  const out = [];
  const childNodes = parent?.childNodes || [];
  for (let i = 0; i < childNodes.length; i++) {
    const ch = childNodes[i];
    if (ch.nodeType === 1 && localNameOf(ch) === name) out.push(ch);
  }
  return out;
}

function descendantsByLocalName(root, name) {
  const out = [];
  const visit = node => {
    const children = node?.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      if (ch.nodeType === 1) {
        if (localNameOf(ch) === name) out.push(ch);
        visit(ch);
      }
    }
  };
  visit(root);
  return out;
}

function getAttrByLocalName(el, attrName) {
  if (!el?.attributes) return '';
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (localNameOf(attr) === attrName || attr.name === attrName) return String(attr.value || '');
  }
  return '';
}

function formatMarkdownTable(rows = []) {
  const cleaned = rows
    .map(r => r.map(cell => String(cell ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()))
    .filter(r => r.some(Boolean));
  if (!cleaned.length) return '';
  const colCount = Math.max(...cleaned.map(r => r.length));
  const normalized = cleaned.map(r => Array.from({ length: colCount }, (_, i) => r[i] || ''));
  const header = `| ${normalized[0].join(' | ')} |`;
  const divider = `| ${normalized[0].map(() => '---').join(' | ')} |`;
  const body = normalized.slice(1).map(r => `| ${r.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function parseDocxEntries(entries, titleFallback) {
  const docBytes = entries.get('word/document.xml');
  if (!docBytes || !docBytes.length) {
    throw new Error('DOCX 文件缺少 word/document.xml 结构');
  }
  const xmlText = new TextDecoder('utf-8').decode(docBytes);
  const doc = parseSimpleXml(xmlText);
  const body = descendantsByLocalName(doc, 'body')[0] || doc.documentElement;

  const sections = [];
  const tables = [];
  let currentHeading = titleFallback;
  let currentLines = [];

  const flushSection = () => {
    const text = currentLines.join('\n').trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        location: `章节 · ${currentHeading}`,
        text,
      });
    }
    currentLines = [];
  };

  const bodyChildren = body?.childNodes || [];
  for (let i = 0; i < bodyChildren.length; i++) {
    const node = bodyChildren[i];
    if (node.nodeType !== 1) continue;
    const tag = localNameOf(node);
    if (tag === 'p') {
      const pPr = childrenByLocalName(node, 'pPr')[0];
      const pStyle = pPr ? childrenByLocalName(pPr, 'pStyle')[0] : null;
      const styleVal = getAttrByLocalName(pStyle, 'val');
      const isBullet = Boolean(pPr && childrenByLocalName(pPr, 'numPr').length);
      const runs = descendantsByLocalName(node, 't').map(t => t.textContent || '').join('').trim();
      if (!runs) continue;
      if (/^(?:Heading[1-6]|标题\s*[1-6]|Title|Subtitle)$/i.test(styleVal) || (runs.length <= 42 && /^第?[一二三四五六七八九十0-9]+[章节部分、.]/.test(runs))) {
        flushSection();
        currentHeading = runs.replace(/^#+\s*/, '').trim();
      } else {
        currentLines.push(isBullet ? `- ${runs}` : runs);
      }
    } else if (tag === 'tbl') {
      const trs = childrenByLocalName(node, 'tr');
      const rows = trs.map(tr =>
        childrenByLocalName(tr, 'tc').map(tc =>
          descendantsByLocalName(tc, 't').map(t => t.textContent || '').join(' ').trim(),
        ),
      );
      const mdTable = formatMarkdownTable(rows);
      if (mdTable) {
        tables.push({ heading: currentHeading, rows, markdown: mdTable });
        currentLines.push(mdTable);
      }
    }
  }
  flushSection();

  const markdown = sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n');
  return {
    title: sections[0]?.heading || titleFallback,
    sections,
    tables,
    markdown: markdown || `# ${titleFallback}\n\n（空文档）`,
  };
}

function parsePptxEntries(entries, titleFallback) {
  const slideEntries = [...entries.keys()]
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/i.exec(a)?.[1] || 0);
      const nb = Number(/slide(\d+)\.xml/i.exec(b)?.[1] || 0);
      return na - nb;
    });

  if (!slideEntries.length) {
    throw new Error('PPTX 文件未找到 ppt/slides/slide*.xml 幻灯片内容');
  }

  const sections = [];
  const tables = [];

  for (const slidePath of slideEntries) {
    const slideNum = Number(/slide(\d+)\.xml/i.exec(slidePath)?.[1] || sections.length + 1);
    const xmlText = new TextDecoder('utf-8').decode(entries.get(slidePath));
    const doc = parseSimpleXml(xmlText);

    let slideTitle = '';
    const bullets = [];
    const spNodes = descendantsByLocalName(doc, 'sp');
    for (const sp of spNodes) {
      const ph = descendantsByLocalName(sp, 'ph')[0];
      const phType = getAttrByLocalName(ph, 'type');
      const paragraphs = descendantsByLocalName(sp, 'p')
        .map(p => descendantsByLocalName(p, 't').map(t => t.textContent || '').join('').trim())
        .filter(Boolean);
      if (!paragraphs.length) continue;
      if ((phType === 'title' || phType === 'ctrTitle' || !slideTitle) && paragraphs[0]) {
        if (!slideTitle) {
          slideTitle = paragraphs[0];
          for (const extra of paragraphs.slice(1)) bullets.push(`- ${extra}`);
          continue;
        }
      }
      for (const line of paragraphs) bullets.push(`- ${line}`);
    }

    const tblNodes = descendantsByLocalName(doc, 'tbl');
    for (const tbl of tblNodes) {
      const rows = childrenByLocalName(tbl, 'tr').map(tr =>
        childrenByLocalName(tr, 'tc').map(tc =>
          descendantsByLocalName(tc, 't').map(t => t.textContent || '').join(' ').trim(),
        ),
      );
      const mdTable = formatMarkdownTable(rows);
      if (mdTable) {
        tables.push({ heading: slideTitle || `Slide ${slideNum}`, rows, markdown: mdTable });
        bullets.push(mdTable);
      }
    }

    const notePath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    if (entries.has(notePath)) {
      const noteDoc = parseSimpleXml(new TextDecoder('utf-8').decode(entries.get(notePath)));
      const noteTexts = descendantsByLocalName(noteDoc, 't').map(t => (t.textContent || '').trim()).filter(t => t && !/^\d+$/.test(t));
      if (noteTexts.length) bullets.push(`> 演讲备注：${noteTexts.join(' ')}`);
    }

    const heading = `[Slide ${slideNum}] ${slideTitle || `第 ${slideNum} 页`}`;
    sections.push({
      heading,
      location: `Slide ${slideNum}`,
      text: bullets.length ? bullets.join('\n') : slideTitle,
    });
  }

  return {
    title: sections[0]?.heading.replace(/^\[Slide \d+\]\s*/, '') || titleFallback,
    sections,
    tables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

function colLettersToIndex(letters = '') {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function parseXlsxEntries(entries, titleFallback) {
  const sharedStrings = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const sstDoc = parseSimpleXml(new TextDecoder('utf-8').decode(entries.get('xl/sharedStrings.xml')));
    for (const si of descendantsByLocalName(sstDoc, 'si')) {
      sharedStrings.push(descendantsByLocalName(si, 't').map(t => t.textContent || '').join(''));
    }
  }

  const sheetNames = [];
  if (entries.has('xl/workbook.xml')) {
    const wbDoc = parseSimpleXml(new TextDecoder('utf-8').decode(entries.get('xl/workbook.xml')));
    for (const sh of descendantsByLocalName(wbDoc, 'sheet')) {
      sheetNames.push(getAttrByLocalName(sh, 'name') || `Sheet${sheetNames.length + 1}`);
    }
  }

  const sheetPaths = [...entries.keys()]
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/sheet(\d+)\.xml/i.exec(a)?.[1] || 0) - Number(/sheet(\d+)\.xml/i.exec(b)?.[1] || 0));

  if (!sheetPaths.length) {
    throw new Error('XLSX 文件未找到 xl/worksheets/sheet*.xml 工作表');
  }

  const sections = [];
  const tables = [];

  for (let idx = 0; idx < sheetPaths.length; idx++) {
    const sheetName = sheetNames[idx] || `Sheet${idx + 1}`;
    const xmlText = new TextDecoder('utf-8').decode(entries.get(sheetPaths[idx]));
    const doc = parseSimpleXml(xmlText);
    const rowNodes = descendantsByLocalName(doc, 'row');
    const rows = [];
    for (const rNode of rowNodes.slice(0, 80)) {
      const cells = childrenByLocalName(rNode, 'c');
      const rowArr = [];
      for (const cNode of cells) {
        const ref = getAttrByLocalName(cNode, 'r');
        const colMatch = /^([A-Z]+)/i.exec(ref);
        const colIdx = colMatch ? colLettersToIndex(colMatch[1].toUpperCase()) : rowArr.length;
        const cType = getAttrByLocalName(cNode, 't');
        let val = '';
        if (cType === 'inlineStr') {
          val = descendantsByLocalName(cNode, 't').map(t => t.textContent || '').join('');
        } else {
          const vNode = childrenByLocalName(cNode, 'v')[0];
          const rawV = vNode ? (vNode.textContent || '').trim() : '';
          val = cType === 's' ? (sharedStrings[Number(rawV)] ?? rawV) : rawV;
        }
        rowArr[colIdx] = String(val || '').trim();
      }
      if (rowArr.some(Boolean)) rows.push(rowArr);
    }
    const mdTable = formatMarkdownTable(rows);
    if (mdTable) {
      const heading = `[Sheet: ${sheetName}] 数据表 (${rows.length} 行)`;
      tables.push({ heading: sheetName, rows, markdown: mdTable });
      sections.push({
        heading,
        location: `Sheet: ${sheetName}`,
        text: mdTable,
      });
    }
  }

  return {
    title: titleFallback,
    sections,
    tables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n') || `# ${titleFallback}`,
  };
}

function parseDelimitedText(rawText = '', delimiter = ',', titleFallback = '数据表') {
  const lines = String(rawText || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  const rows = lines.slice(0, 100).map(line => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  const mdTable = formatMarkdownTable(rows);
  const headers = rows[0] || [];
  const summaryLines = [
    `共解析 **${ Math.max(0, rows.length - 1) }** 条数据记录，包含字段：${headers.map(h => `\`${h}\``).join('、')}。`,
  ];
  for (const r of rows.slice(1, 8)) {
    const pairs = headers.map((h, idx) => `${h}: ${r[idx] ?? ''}`).filter(Boolean).join(' · ');
    if (pairs) summaryLines.push(`- ${pairs}`);
  }
  const sections = [
    {
      heading: `${titleFallback} · 字段与记录概览`,
      location: 'Rows 1–' + rows.length,
      text: summaryLines.join('\n') + (mdTable ? '\n\n' + mdTable : ''),
    },
  ];
  return {
    title: titleFallback,
    sections,
    tables: mdTable ? [{ heading: titleFallback, rows, markdown: mdTable }] : [],
    markdown: `## ${sections[0].heading}\n\n${sections[0].text}`,
  };
}

function decodePdfLiteralString(str = '') {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = str[++i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '(' || next === ')' || next === '\\') out += next;
    else if (/[0-7]/.test(next)) {
      let oct = next;
      if (/[0-7]/.test(str[i + 1] || '')) oct += str[++i];
      if (/[0-7]/.test(str[i + 1] || '')) oct += str[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next) {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hex = '') {
  const clean = hex.replace(/\s+/g, '');
  if (!clean) return '';
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let u16 = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      u16 += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return u16;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function extractPdfTextFromStreams(u8, decompressStream) {
  const latin1 = new TextDecoder('latin1').decode(u8);
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  const pageChunks = [];
  let match;
  while ((match = streamRegex.exec(latin1)) !== null) {
    const dict = match[1];
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    let streamEnd = end;
    if (latin1[streamEnd - 1] === '\n') streamEnd--;
    if (latin1[streamEnd - 1] === '\r') streamEnd--;
    const rawSlice = u8.subarray(start, streamEnd);
    let contentBytes = rawSlice;
    if (/\/FlateDecode\b/.test(dict)) {
      const inflated = decompressStream(rawSlice);
      if (inflated && inflated.length) contentBytes = inflated;
    }
    const contentStr = new TextDecoder('utf-8', { fatal: false }).decode(contentBytes);
    if (!/\bBT\b/.test(contentStr) && !/\bTj\b|\bTJ\b/.test(contentStr)) continue;

    const pieces = [];
    const btBlocks = contentStr.match(/BT[\s\S]*?ET/g) || [contentStr];
    for (const block of btBlocks) {
      const tokenRe = /\((?:\\.|[^\\()])*\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g;
      let tm;
      while ((tm = tokenRe.exec(block)) !== null) {
        if (tm[1] !== undefined) {
          const arrStr = tm[1];
          const subRe = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
          let sm;
          let line = '';
          while ((sm = subRe.exec(arrStr)) !== null) {
            if (sm[1] !== undefined) line += decodePdfHexString(sm[1]);
            else line += decodePdfLiteralString(sm[0].slice(1, -1));
          }
          if (line.trim()) pieces.push(line.trim());
        } else if (tm[2] !== undefined) {
          const decoded = decodePdfHexString(tm[2]).trim();
          if (decoded) pieces.push(decoded);
        } else {
          const lit = /\(([\s\S]*)\)\s*Tj$/.exec(tm[0]);
          if (lit) {
            const decoded = decodePdfLiteralString(lit[1]).trim();
            if (decoded) pieces.push(decoded);
          }
        }
      }
    }
    const pageText = pieces.join('\n').replace(/\u0000/g, '').trim();
    if (pageText) pageChunks.push(pageText);
  }
  return pageChunks;
}

function parseOcrTextAndTables(rawText = '', titleFallback = '扫描资料') {
  const boxes = [];
  for (const match of String(rawText || '').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
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
  for (const match of String(rawText || '').matchAll(/%OCR_BOX\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*:\s*([^\r\n]+)/g)) {
    boxes.push({
      x: Number(match[1]) || 0,
      y: Number(match[2]) || 0,
      text: match[3].trim(),
    });
  }
  if (!boxes.length) return null;

  boxes.sort((a, b) => (Math.abs(a.y - b.y) <= 10 ? a.x - b.x : a.y - b.y));
  const rows = [];
  for (const box of boxes) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(box.y - lastRow.yAvg) <= 10) {
      lastRow.items.push(box);
      lastRow.yAvg = lastRow.items.reduce((s, it) => s + it.y, 0) / lastRow.items.length;
    } else {
      rows.push({ yAvg: box.y, items: [box] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);

  const sections = [];
  const tables = [];
  let currentHeading = titleFallback;
  let currentLines = [];
  let pendingTableRows = [];

  const flushTable = () => {
    if (pendingTableRows.length >= 2) {
      const mdTable = formatMarkdownTable(pendingTableRows);
      if (mdTable) {
        tables.push({ heading: currentHeading, rows: pendingTableRows, markdown: mdTable });
        currentLines.push(mdTable);
      }
    } else if (pendingTableRows.length === 1) {
      currentLines.push(pendingTableRows[0].join(' · '));
    }
    pendingTableRows = [];
  };
  const flushSec = () => {
    flushTable();
    const text = currentLines.join('\n\n').trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        location: `OCR · ${currentHeading}`,
        page: sections.length + 1,
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
      flushSec();
      currentHeading = lineText.replace(/^#+\s*/, '').trim();
    } else {
      currentLines.push(lineText);
    }
  }
  flushSec();
  if (!sections.length) return null;
  return {
    title: sections[0]?.heading || titleFallback,
    sections,
    tables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

function buildPdfParsedObject(pageChunks, titleFallback, rawBytes = null) {
  if (!pageChunks.length && rawBytes) {
    const rawStr = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
    const ocrParsed = parseOcrTextAndTables(rawStr, titleFallback);
    if (ocrParsed) return ocrParsed;
  }
  const sections = pageChunks.map((text, idx) => ({
    heading: `[Page ${idx + 1}] 第 ${idx + 1} 页内容`,
    location: `Page ${idx + 1}`,
    page: idx + 1,
    text,
  }));

  if (!sections.length) {
    sections.push({
      heading: `${titleFallback} · PDF 元数据记录`,
      location: 'Page 1',
      page: 1,
      text: '检测到该 PDF 未包含可直接提取的明文文本流（可能为扫描图片版 PDF），建议补充文字说明或 OCR 文本后再编译。',
    });
  }

  return {
    title: titleFallback,
    sections,
    tables: [],
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

function parseEpubEntries(entries, titleFallback) {
  let opfPath = '';
  if (entries.has('META-INF/container.xml')) {
    const containerDoc = parseSimpleXml(new TextDecoder('utf-8').decode(entries.get('META-INF/container.xml')));
    const rootfile = descendantsByLocalName(containerDoc, 'rootfile')[0];
    opfPath = getAttrByLocalName(rootfile, 'full-path');
  }
  if (!opfPath || !entries.has(opfPath)) {
    opfPath = [...entries.keys()].find(name => /\.opf$/i.test(name)) || '';
  }
  if (!opfPath || !entries.has(opfPath)) {
    throw new Error('EPUB 文件缺少 OPF 包清单结构');
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfDoc = parseSimpleXml(new TextDecoder('utf-8').decode(entries.get(opfPath)));
  const bookTitle = descendantsByLocalName(opfDoc, 'title')[0]?.textContent?.trim() || titleFallback;
  const author = descendantsByLocalName(opfDoc, 'creator')[0]?.textContent?.trim() || '';

  const manifestMap = new Map();
  for (const item of descendantsByLocalName(opfDoc, 'item')) {
    const id = getAttrByLocalName(item, 'id');
    const href = getAttrByLocalName(item, 'href');
    if (id && href) {
      const resolved = (opfDir + href).replace(/^\.\//, '');
      manifestMap.set(id, resolved);
    }
  }

  const spineIds = descendantsByLocalName(opfDoc, 'itemref')
    .map(ref => getAttrByLocalName(ref, 'idref'))
    .filter(Boolean);
  let chapterPaths = spineIds.map(id => manifestMap.get(id)).filter(p => p && entries.has(p));
  if (!chapterPaths.length) {
    chapterPaths = [...entries.keys()].filter(name => /\.(?:xhtml|html|htm)$/i.test(name) && !/nav|toc/i.test(name));
  }
  if (!chapterPaths.length) {
    throw new Error('EPUB 文件未找到可阅读的 XHTML 章节内容');
  }

  const sections = [];
  const tables = [];
  for (let idx = 0; idx < chapterPaths.length; idx++) {
    const chapterPath = chapterPaths[idx];
    const rawHtml = new TextDecoder('utf-8').decode(entries.get(chapterPath));
    const parsedChapter = parseHtmlText(rawHtml, `第 ${idx + 1} 章`);
    const chapterHeading = parsedChapter.sections[0]?.heading || parsedChapter.title || `第 ${idx + 1} 章`;
    const chapterBody = parsedChapter.sections.map(s => s.text).join('\n\n').trim() || chapterHeading;
    const cfi = `epubcfi(/6/${(idx + 1) * 2}!/4/2/1:0)`;
    sections.push({
      heading: chapterHeading,
      location: cfi,
      cfi,
      chapterIndex: idx + 1,
      text: chapterBody,
    });
    for (const tbl of parsedChapter.tables || []) tables.push(tbl);
  }

  return {
    title: bookTitle,
    author,
    sections,
    tables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

function parsePdfBytesSync(bytes, titleFallback) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const pageChunks = extractPdfTextFromStreams(u8, rawSlice => inflateBytesSync(rawSlice, 'deflate'));
  return buildPdfParsedObject(pageChunks, titleFallback, u8);
}

async function parsePdfBytes(bytes, titleFallback) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const latin1 = new TextDecoder('latin1').decode(u8);
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  const pageChunks = [];
  let match;
  while ((match = streamRegex.exec(latin1)) !== null) {
    const dict = match[1];
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    let streamEnd = end;
    if (latin1[streamEnd - 1] === '\n') streamEnd--;
    if (latin1[streamEnd - 1] === '\r') streamEnd--;
    const rawSlice = u8.subarray(start, streamEnd);
    let contentBytes = rawSlice;
    if (/\/FlateDecode\b/.test(dict)) {
      const inflated = await inflateBytes(rawSlice, 'deflate');
      if (inflated.length) contentBytes = inflated;
    }
    const contentStr = new TextDecoder('utf-8', { fatal: false }).decode(contentBytes);
    if (!/\bBT\b/.test(contentStr) && !/\bTj\b|\bTJ\b/.test(contentStr)) continue;
    const subChunks = extractPdfTextFromStreams(
      new TextEncoder().encode(`<< >>\nstream\n${contentStr}\nendstream`),
      s => s,
    );
    pageChunks.push(...subChunks);
  }
  return buildPdfParsedObject(pageChunks, titleFallback, u8);
}

function parseHtmlText(rawHtml = '', titleFallback = '网页资料') {
  const cleaned = String(rawHtml || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|footer|iframe)\b[\s\S]*?<\/\1>/gi, '');

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned);
  const pageTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : titleFallback;

  const tables = [];
  const withTables = cleaned.replace(/<table\b[\s\S]*?<\/table>/gi, tableHtml => {
    const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const rows = rowMatches.map(rm =>
      [...rm[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cm =>
        cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      ),
    );
    const md = formatMarkdownTable(rows);
    if (md) tables.push({ heading: pageTitle, rows, markdown: md });
    return `\n\n${md}\n\n`;
  });

  const blockText = withTables
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
    .replace(/<(?:p|div|section|article|blockquote|br|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

  return parsePlainOrMarkdownText(blockText, pageTitle || titleFallback, tables);
}

function parsePlainOrMarkdownText(rawText = '', titleFallback = '文档资料', extraTables = []) {
  const clean = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const fm = parseFrontMatter(clean);
  const body = clean.slice(fm.bodyFrom || 0);
  const lines = body.split('\n');
  const sections = [];
  let currentHeading = fm.metadata?.title || titleFallback;
  let currentLines = [];
  let startLine = 1;

  const flush = endLine => {
    const text = currentLines.join('\n').trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        location: `第 ${startLine}–${Math.max(startLine, endLine)} 行`,
        text,
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hMatch = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (hMatch) {
      flush(i);
      currentHeading = hMatch[2].replace(/^[0-9一二三四五六七八九十、.．\s-]+/, '').trim() || hMatch[2].trim();
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }
  flush(lines.length);

  if (!sections.length && body.trim()) {
    sections.push({
      heading: titleFallback,
      location: `第 1–${lines.length} 行`,
      text: body.trim(),
    });
  }

  return {
    title: fm.metadata?.title || titleFallback,
    sections,
    tables: extraTables,
    markdown: sections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
  };
}

/**
 * Synchronous Raw Document Parser (used by worker & synchronous compiler pipelines)
 */
export function parseRawDocumentFileSync(rawFile = {}) {
  if (rawFile.extractedMarkdown && Array.isArray(rawFile.sections)) {
    const extraction = rawFile.entities && rawFile.relations && rawFile.claims
      ? { entities: rawFile.entities, relations: rawFile.relations, claims: rawFile.claims }
      : extractEntitiesAndRelationsFromSections(rawFile.sections, rawFile.title || rawFile.name || '');
    const format = detectRawFileFormat(rawFile.name || rawFile.relativePath || '');
    const fileName = String(rawFile.name || rawFile.relativePath || '未命名资料.txt').split('/').pop();
    const stem = stripNumericPrefix(fileName.replace(/\.[^.]+$/, '')) || fileName.replace(/\.[^.]+$/, '');
    return {
      id: rawFile.id || `raw:${rawFile.relativePath || 'raw/' + fileName}`,
      name: fileName,
      stem,
      title: rawFile.title || stem,
      relativePath: String(rawFile.relativePath || `raw/${fileName}`).replaceAll('\\', '/'),
      format: rawFile.format || format.type,
      formatBadge: rawFile.formatBadge || format.badge,
      sizeBytes: rawFile.sizeBytes || rawFile.extractedMarkdown.length,
      sha256: rawFile.sha256 || computeSimpleSha256Hex(rawFile.extractedMarkdown),
      sections: rawFile.sections,
      tables: rawFile.tables || [],
      entities: extraction.entities,
      relations: extraction.relations,
      claims: extraction.claims,
      extractedMarkdown: rawFile.extractedMarkdown,
    };
  }

  const fileName = String(rawFile.name || rawFile.relativePath || '未命名资料.txt').split('/').pop();
  const relativePath = String(rawFile.relativePath || `raw/${fileName}`).replaceAll('\\', '/');
  const format = detectRawFileFormat(fileName);
  const stem = stripNumericPrefix(fileName.replace(/\.[^.]+$/, '')) || fileName.replace(/\.[^.]+$/, '');

  let bytes = rawFile.bytes instanceof Uint8Array
    ? rawFile.bytes
    : rawFile.base64Data
      ? base64ToUint8Array(rawFile.base64Data)
      : null;

  let textSource = typeof rawFile.source === 'string' ? rawFile.source : '';
  if (!textSource && bytes && !format.binary) {
    textSource = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (!bytes && textSource) {
    bytes = new TextEncoder().encode(textSource);
  }

  const sha256 = rawFile.sha256 || computeSimpleSha256Hex(bytes || textSource || fileName);
  let parsed;
  if (format.type === 'docx') {
    parsed = parseDocxEntries(unpackZipEntriesSync(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'epub') {
    parsed = parseEpubEntries(unpackZipEntriesSync(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'pptx') {
    parsed = parsePptxEntries(unpackZipEntriesSync(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'xlsx') {
    parsed = parseXlsxEntries(unpackZipEntriesSync(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'pdf') {
    parsed = parsePdfBytesSync(bytes || new Uint8Array(0), stem);
  } else if (format.type === 'image') {
    const rawImgStr = textSource || (bytes ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : '');
    parsed = parseOcrTextAndTables(rawImgStr, stem) || parsePlainOrMarkdownText(rawImgStr || `${stem} · 离线长图 OCR 解析`, stem);
  } else if (format.type === 'csv') {
    parsed = parseDelimitedText(textSource, ',', stem);
  } else if (format.type === 'tsv') {
    parsed = parseDelimitedText(textSource, '\t', stem);
  } else if (format.type === 'html') {
    parsed = parseHtmlText(textSource, stem);
  } else {
    parsed = parsePlainOrMarkdownText(textSource, stem);
  }

  const extraction = extractEntitiesAndRelationsFromSections(parsed.sections, stem);

  return {
    id: rawFile.id || `raw:${relativePath}`,
    name: fileName,
    stem,
    title: parsed.title || stem,
    relativePath,
    format: format.type,
    formatBadge: format.badge,
    sizeBytes: rawFile.sizeBytes ?? (bytes ? bytes.byteLength : textSource.length),
    sha256,
    sections: parsed.sections,
    tables: parsed.tables || [],
    entities: extraction.entities,
    relations: extraction.relations,
    claims: extraction.claims,
    extractedMarkdown: parsed.markdown,
  };
}

/**
 * Unified Raw Document Parser: accepts `{ name, relativePath, source, base64Data, bytes }`
 * and returns structured sections, tables, extracted entities/relations, and clean Markdown.
 */
export async function parseRawDocumentFile(rawFile = {}) {
  const fileName = String(rawFile.name || rawFile.relativePath || '未命名资料.txt').split('/').pop();
  const relativePath = String(rawFile.relativePath || `raw/${fileName}`).replaceAll('\\', '/');
  const format = detectRawFileFormat(fileName);
  const stem = stripNumericPrefix(fileName.replace(/\.[^.]+$/, '')) || fileName.replace(/\.[^.]+$/, '');

  let bytes = rawFile.bytes instanceof Uint8Array
    ? rawFile.bytes
    : rawFile.base64Data
      ? base64ToUint8Array(rawFile.base64Data)
      : null;

  let textSource = typeof rawFile.source === 'string' ? rawFile.source : '';
  if (!textSource && bytes && !format.binary) {
    textSource = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (!bytes && textSource) {
    bytes = new TextEncoder().encode(textSource);
  }

  const sha256 = rawFile.sha256 || computeSimpleSha256Hex(bytes || textSource || fileName);
  let parsed;
  if (format.type === 'docx') {
    parsed = parseDocxEntries(await unpackZipEntries(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'epub') {
    parsed = parseEpubEntries(await unpackZipEntries(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'pptx') {
    parsed = parsePptxEntries(await unpackZipEntries(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'xlsx') {
    parsed = parseXlsxEntries(await unpackZipEntries(bytes || new Uint8Array(0)), stem);
  } else if (format.type === 'pdf') {
    parsed = await parsePdfBytes(bytes || new Uint8Array(0), stem);
  } else if (format.type === 'image') {
    const rawImgStr = textSource || (bytes ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : '');
    parsed = parseOcrTextAndTables(rawImgStr, stem) || parsePlainOrMarkdownText(rawImgStr || `${stem} · 离线长图 OCR 解析`, stem);
  } else if (format.type === 'csv') {
    parsed = parseDelimitedText(textSource, ',', stem);
  } else if (format.type === 'tsv') {
    parsed = parseDelimitedText(textSource, '\t', stem);
  } else if (format.type === 'html') {
    parsed = parseHtmlText(textSource, stem);
  } else {
    parsed = parsePlainOrMarkdownText(textSource, stem);
  }

  const extraction = extractEntitiesAndRelationsFromSections(parsed.sections, stem);

  return {
    id: rawFile.id || `raw:${relativePath}`,
    name: fileName,
    stem,
    title: parsed.title || stem,
    relativePath,
    format: format.type,
    formatBadge: format.badge,
    sizeBytes: rawFile.sizeBytes ?? (bytes ? bytes.byteLength : textSource.length),
    sha256,
    sections: parsed.sections,
    tables: parsed.tables || [],
    entities: extraction.entities,
    relations: extraction.relations,
    claims: extraction.claims,
    extractedMarkdown: parsed.markdown,
  };
}

/**
 * Deterministic Ontology-Normalized Entity, Relation & Claim Extractor (following mini-context-graph)
 */
const ENTITY_TYPE_RULES = [
  { type: 'metric', pattern: /标准差|服务水平|安全库存|提前期|公式|阈值|指标|周转率|缺货率|延迟|耗时|吞吐|余弦|BM25|PageRank|参数|成本|良率/i },
  { type: 'component', pattern: /引擎|编译器|模块|索引|算法|解析器|模型|向量|工作台|星图|画布|接口|服务|缓存/i },
  { type: 'system', pattern: /系统|架构|平台|知识库|数据库|网络|框架|协议|流水线|仓库/i },
  { type: 'method', pattern: /方法|策略|机制|范式|法则|工作流|规范|流程|规划|同步|拆卡|检索/i },
  { type: 'issue', pattern: /冲突|风险|盲区|断链|孤岛|瓶颈|故障|误差|泄漏|阻塞|异常/i },
];

function classifyEntityType(name = '', context = '') {
  const combined = `${name} ${context}`;
  for (const rule of ENTITY_TYPE_RULES) {
    if (rule.pattern.test(combined)) return rule.type;
  }
  return 'concept';
}

export function extractEntitiesAndRelationsFromSections(sections = [], docTitle = '') {
  const entityMap = new Map();
  const claims = [];
  const relations = [];

  const registerEntity = (rawName, location, quote) => {
    const clean = String(rawName || '')
      .replace(/^[#*>-]+\s*/, '')
      .replace(/[《》「」『』【】[\]()`"']/g, '')
      .replace(/^(?:第[一二三四五六七八九十0-9]+[章节部分条]|Slide\s*\d+|Sheet:|Page\s*\d+|[一二三四五六七八九十0-9]+[、.．])\s*/i, '')
      .replace(/(?:直接|自动|动态|严格|实时|持续|必须|严禁)$/, '')
      .trim();
    if (clean.length < 2 || clean.length > 26) return null;
    if (/^(?:核心结论|关键要点|概述|总结|引言|背景|目录|备注|说明|数据表|字段|记录|内容|章节|项目|名称|状态|时间|日期|策略对比基准表)$/i.test(clean)) return null;
    const cleanQuote = String(quote || '')
      .split('\n')
      .filter(l => !l.trim().startsWith('|'))
      .join(' ')
      .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)
      .replace(/[\[\]|`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110);
    const key = clean.toLowerCase();
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        name: clean,
        type: classifyEntityType(clean, cleanQuote),
        location,
        supporting_text: cleanQuote || clean,
        mentions: 1,
      });
    } else {
      entityMap.get(key).mentions++;
    }
    return entityMap.get(key);
  };

  for (const sec of sections) {
    const loc = sec.location || sec.heading || '原文';
    if (sec.heading) registerEntity(sec.heading.replace(/^\[[^\]]+\]\s*/, ''), loc, sec.text.slice(0, 120));

    const lines = String(sec.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^\|[\s-:|]+\|$/.test(line)) continue;
      // Extract bolded concepts, bracketed terms, or wikilinks
      for (const m of line.matchAll(/\*\*([^*]{2,24})\*\*|《([^》]{2,24})》|「([^」]{2,24})」|\[\[([^\]|#]{2,24})/g)) {
        const term = m[1] || m[2] || m[3] || m[4];
        registerEntity(term, loc, line);
      }

      const plainLine = line
        .replace(/^[-*+\d.)>]+\s*/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/`/g, '')
        .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)
        .trim();
      if (plainLine.length >= 14 && !plainLine.startsWith('|')) {
        claims.push({
          heading: sec.heading || docTitle,
          location: loc,
          text: plainLine.slice(0, 180),
        });
      }

      // Extract explicit relations between two terms in the same sentence
      const relMatch = /([^\s，。；：,.;:]{2,18}?)\s*(导致|引起|决定|依赖于|包含|采用|驱动|影响|优于|替代|通过|提升|降低|生成|连接)\s*([^\s，。；：,.;:]{2,18})/.exec(plainLine);
      if (relMatch) {
        const srcEnt = registerEntity(relMatch[1], loc, plainLine);
        const tgtEnt = registerEntity(relMatch[3], loc, plainLine);
        const verb = relMatch[2];
        const canonicalRel = /导致|引起|生成/.test(verb)
          ? 'causes'
          : /依赖于/.test(verb)
            ? 'depends on'
            : /包含/.test(verb)
              ? 'contains'
              : /采用|通过/.test(verb)
                ? 'uses'
                : /连接/.test(verb)
                  ? 'connects to'
                  : 'affects';
        if (srcEnt && tgtEnt && srcEnt.name !== tgtEnt.name && relations.length < 12) {
          relations.push({
            source: srcEnt.name,
            target: tgtEnt.name,
            type: canonicalRel,
            verb,
            confidence: 0.9,
            location: loc,
            supporting_text: plainLine.slice(0, 140),
          });
        }
      }
    }
  }

  const entities = [...entityMap.values()]
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 12);

  return {
    entities,
    relations,
    claims: claims.slice(0, 10),
  };
}

/**
 * Starter `raw/` heterogeneous files for initial vault & testing
 */
export function createStarterRawFiles(today = localDate()) {
  return [
    {
      name: '供应链安全库存与动态服务水平白皮书.html',
      relativePath: 'raw/供应链安全库存与动态服务水平白皮书.html',
      source: [
        '<!DOCTYPE html>',
        '<html><head><title>供应链安全库存与动态服务水平白皮书</title></head><body>',
        '<h1>供应链安全库存与动态服务水平白皮书</h1>',
        '<h2>一、 核心机制与安全库存公式</h2>',
        '<p>在多级制造与分销网络中，<strong>安全库存模型</strong>直接决定订单满足率与资金占用的平衡。安全库存必须依据<strong>需求波动标准差</strong>与<strong>供应提前期</strong>动态计算，严禁使用静态经验常数替代实时预测。</p>',
        '<p>当<strong>需求波动标准差</strong>上升时，系统通过<strong>动态服务水平策略</strong>自动调整安全库存缓冲，并关联双链笔记与卡片盒方法沉淀排产决策规则。</p>',
        '<h2>二、 策略对比基准表</h2>',
        '<table>',
        '<tr><th>策略类型</th><th>适用需求场景</th><th>平均缺货率</th><th>库存周转天数</th></tr>',
        '<tr><td>静态固定缓冲</td><td>稳定大宗标准件</td><td>4.8%</td><td>42 天</td></tr>',
        '<tr><td>动态服务水平模型</td><td>季节性与促销波动件</td><td>1.1%</td><td>26 天</td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    },
    {
      name: '知识图谱与混合检索性能基准测试.csv',
      relativePath: 'raw/知识图谱与混合检索性能基准测试.csv',
      source: [
        '评测模块,算法机制,百篇耗时ms,千篇耗时ms,准确率提升',
        '混合向量检索,128维特征哈希余弦+BM25二元分词,18.4,72.6,+24.5%',
        '知识图谱寻路,双向BFS最短路径+PageRank中心度,11.2,48.0,+31.0%',
        'Karpathy知识编译,raw只读解析+wiki增量双链合成,29.5,115.2,+38.2%',
      ].join('\n'),
    },
    {
      name: 'Karpathy-LLM-Wiki增量编译工程手稿.txt',
      relativePath: 'raw/Karpathy-LLM-Wiki增量编译工程手稿.txt',
      source: [
        '# Karpathy LLM Wiki 增量编译工程手稿',
        '',
        '## 1. 原始资料层 (raw/) 与只读铁律',
        '用户将 PDF、Word (.docx)、PPT (.pptx)、Excel (.xlsx)、CSV 与网页文章放入 **raw/ 原始资料仓**。**Karpathy 知识编译器**通过只读解析器提取章节、表格与幻灯片大纲，绝不覆写原始文件。',
        '',
        '## 2. 知识百科层 (wiki/) 与增量连接',
        '每次摄取新资料时，编译器自动生成或更新 **文献解析笔记**（存入 `wiki/sources/`）、提炼 **概念实体百科**（存入 `wiki/entities/`），并在匹配到知识库既有主题（如《双链笔记与卡片盒方法》与《知识图谱与局部星图》）时自动建立双向 `[[双链]]` 与 `wiki/index.md` 路由索引。',
        '',
        'date: ' + today,
      ].join('\n'),
    },
  ];
}

/**
 * Helper to build real binary .docx / .pptx / .xlsx / .pdf buffers for testing & quick sample import
 */
export function buildSampleOfficeFileBytes(format = 'docx', customTitle = '制造排产与知识图谱协同方案') {
  if (format === 'docx') {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${customTitle}</w:t></w:r></w:p>
    <w:p><w:r><w:t>**有限产能排产**通过资源日历约束决定**工序齐套率**，并与[[知识图谱与局部星图]]建立跨篇溯源连接。</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>关键模块</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>核心指标</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>有限产能排产</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>准时交付率 98.2%</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
    return buildStoredZipBytes({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      'word/document.xml': documentXml,
    });
  }

  if (format === 'pptx') {
    const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${customTitle} · 架构总览</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>
      <a:p><a:r><a:t>**异构文档解析器**包含PPT幻灯片提取与Excel表格还原，直接生成结构化[[双链笔记与卡片盒方法]]。</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    return buildStoredZipBytes({
      'ppt/slides/slide1.xml': slide1,
    });
  }

  if (format === 'xlsx') {
    const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>指标名称</t></si>
  <si><t>改善幅度</t></si>
  <si><t>知识复用率</t></si>
  <si><t>+42%</t></si>
</sst>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="核心指标表" sheetId="1"/></sheets></workbook>`;
    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
</sheetData></worksheet>`;
    return buildStoredZipBytes({
      'xl/sharedStrings.xml': sharedStrings,
      'xl/workbook.xml': workbook,
      'xl/worksheets/sheet1.xml': sheet1,
    });
  }

  if (format === 'epub') {
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${customTitle}</dc:title>
    <dc:creator>Inkloom Research Lab</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;
    const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 · 知识图谱与双链溯源机制</title></head><body>
<h1>第一章 · 知识图谱与双链溯源机制</h1>
<p>在《${customTitle}》中，<strong>双层星图架构</strong>通过显式引用与<strong>语义向量检索</strong>将零散读书笔记连接为可验证的知识网络。</p>
<p>每一条原件摘录均绑定原文件 64 位 SHA-256 校验值与精确章节锚点，点击即可回跳至原书对应段落。</p>
</body></html>`;
    const ch2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 · 异构原件精读与卡片盒沉淀</title></head><body>
<h1>第二章 · 异构原件精读与卡片盒沉淀</h1>
<p>当研究者在阅读 EPUB 电子书或 PDF 论文时，<strong>可溯源摘录卡片</strong>能够自动记录 <code>epubcfi(/6/4!/4/2/1:0)</code> 位置标识与个人批注。</p>
<p>结合 [[双链笔记与卡片盒方法]]，摘录卡片可直接嵌入长稿章节并生成学术引文。</p>
</body></html>`;
    return buildStoredZipBytes({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': containerXml,
      'OEBPS/content.opf': contentOpf,
      'OEBPS/chapter1.xhtml': ch1,
      'OEBPS/chapter2.xhtml': ch2,
    });
  }

  const toUtf16BeHex = text => 'FEFF' + Array.from(String(text), ch => ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');
  const p1Line1 = toUtf16BeHex(`${customTitle} · 第 1 页：原件精读与 SHA-256 溯源机制`);
  const p1Line2 = toUtf16BeHex('在深度研究工作流中，PDF 原件摘录必须绑定原文件 SHA-256 哈希与精确页码（Page 1），防止引用失真。');
  const p2Line1 = toUtf16BeHex(`${customTitle} · 第 2 页：跨篇双链合成与实证检验`);
  const p2Line2 = toUtf16BeHex('第二页验证多页 PDF 翻页与定向回跳：点击摘录卡片中的 #inkloom-reader 链接即可直达本页（Page 2）。');
  const pdfStream1 = `BT /F1 12 Tf 72 720 Td <${p1Line1}> Tj 0 -24 Td <${p1Line2}> Tj 0 -24 Td (Karpathy LLM Wiki extracts PDF text into structured wiki notes.) Tj ET`;
  const pdfStream2 = `BT /F1 12 Tf 72 720 Td <${p2Line1}> Tj 0 -24 Td <${p2Line2}> Tj ET`;
  const pdfText = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${pdfStream1.length} >>
stream
${pdfStream1}
endstream
endobj
5 0 obj << /Type /Page /Parent 2 0 R /Contents 6 0 R >> endobj
6 0 obj << /Length ${pdfStream2.length} >>
stream
${pdfStream2}
endstream
endobj
%%EOF`;
  return new TextEncoder().encode(pdfText);
}
