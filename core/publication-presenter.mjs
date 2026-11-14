import { parseFrontMatter, stripNumericPrefix, parseWikiLinkBody, localDate, purifyWikiLinksForExport } from './vault-graph.mjs';
import { buildStoredZipBytes, uint8ArrayToBase64 } from './raw-document-ingestor.mjs';
import { countNoteWords } from './research-notes.mjs';

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

export function renderInlineRichMarkdown(text = '', options = {}) {
  const interactiveLinks = options.interactiveWikiLinks !== false;
  let html = escapeHtml(text);

  // Inline code `...`
  html = html.replace(/`([^`\n]+)`/g, '<code class="pub-inline-code">$1</code>');

  // WikiLinks [[target#heading|alias]]
  html = html.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (_, bang, inner) => {
    const parsed = parseWikiLinkBody(inner);
    const label = escapeHtml(parsed.display || inner);
    const targetAttr = escapeHtml(parsed.target || '');
    const headingAttr = escapeHtml(parsed.heading || '');
    if (interactiveLinks) {
      return `<button type="button" class="pub-wikilink-chip" data-wiki-target="${targetAttr}" data-wiki-heading="${headingAttr}">🔗 ${label}</button>`;
    }
    return `<span class="pub-wikilink-text">${label}</span>`;
  });

  // Highlights ==...==
  html = html.replace(/==([^=\n]+)==/g, '<mark class="pub-highlight-mark">$1</mark>');

  // Bold & italic & strikethrough
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Inline tags #tag
  html = html.replace(/(^|[\s([\u3000，。；：])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu, '$1<span class="pub-tag-chip">#$2</span>');

  return html;
}

export function renderMarkdownBlockToHtml(markdown = '', options = {}) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = /^(`{3,}|~{3,})([\w-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] || 'text';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre class="pub-code-block" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Math block $$...$$
    if (trimmed === '$$') {
      const mathLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<div class="pub-math-block">${escapeHtml(mathLines.join('\n'))}</div>`);
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const idSlug = text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || `sec-${i}`;
      out.push(`<h${level} id="${escapeHtml(idSlug)}" class="pub-heading pub-h${level}">${renderInlineRichMarkdown(text, options)}</h${level}>`);
      i++;
      continue;
    }

    // Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseCells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headers = parseCells(lines[i]);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        bodyRows.push(parseCells(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${renderInlineRichMarkdown(h, options)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyRows.map(r => `<tr>${headers.map((_, idx) => `<td>${renderInlineRichMarkdown(r[idx] ?? '', options)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<div class="pub-table-wrap"><table class="pub-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote / Callout
    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const firstLine = quoteLines[0] || '';
      const calloutMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(firstLine);
      if (calloutMatch) {
        const kind = calloutMatch[1].toUpperCase();
        const title = calloutMatch[2].trim() || kind;
        const bodyHtml = quoteLines.slice(1).map(l => `<p>${renderInlineRichMarkdown(l, options)}</p>`).join('');
        out.push(`<aside class="pub-callout pub-callout-${kind.toLowerCase()}" data-callout="${kind}"><strong>${renderInlineRichMarkdown(title, options)}</strong>${bodyHtml}</aside>`);
      } else {
        out.push(`<blockquote class="pub-blockquote">${quoteLines.map(l => `<p>${renderInlineRichMarkdown(l, options)}</p>`).join('')}</blockquote>`);
      }
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, '').trim();
        const taskMatch = /^\[([ xX])\]\s+(.+)$/.exec(itemText);
        if (taskMatch) {
          const checked = taskMatch[1].toLowerCase() === 'x';
          items.push(`<li class="pub-task-item"><input type="checkbox" disabled ${checked ? 'checked' : ''}> <span>${renderInlineRichMarkdown(taskMatch[2], options)}</span></li>`);
        } else {
          items.push(`<li>${renderInlineRichMarkdown(itemText, options)}</li>`);
        }
        i++;
      }
      out.push(`<ul class="pub-list">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '').trim();
        items.push(`<li>${renderInlineRichMarkdown(itemText, options)}</li>`);
        i++;
      }
      out.push(`<ol class="pub-list pub-ordered-list">${items.join('')}</ol>`);
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s+|`{3,}|~{3,}|\$\$|>|\s*[-*+]\s+|\s*\d+\.\s+|\|.*\|)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      out.push(`<p class="pub-paragraph">${paraLines.map(l => renderInlineRichMarkdown(l, options)).join('<br>')}</p>`);
    } else {
      i++;
    }
  }

  return out.join('\n');
}

export function parseMarkdownSlides(source = '', options = {}) {
  const raw = String(source || '');
  const bom = raw.startsWith('\uFEFF') ? 1 : 0;
  const fm = parseFrontMatter(raw.slice(bom));
  const body = raw.slice(bom + fm.bodyFrom).replace(/\r\n/g, '\n').trim();
  const deckTitle = stripNumericPrefix(fm.metadata.title || options.title || '未命名演示文稿') || '未命名演示文稿';

  // Split by --- horizontal rules outside fenced code blocks
  const lines = body.split('\n');
  const hrChunks = [];
  let buffer = [];
  let inFence = false;
  let hasExplicitHr = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (!inFence && /^---+$/.test(trimmed)) {
      hasExplicitHr = true;
      if (buffer.join('\n').trim()) hrChunks.push(buffer.join('\n').trim());
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (buffer.join('\n').trim()) hrChunks.push(buffer.join('\n').trim());

  let rawSlideBlocks = hrChunks;
  if (!hasExplicitHr && hrChunks.length <= 1) {
    // Secondary split by ## H2 headings when no explicit --- separator is used
    const h2Chunks = [];
    let current = [];
    let inCode = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        inCode = !inCode;
        current.push(line);
        continue;
      }
      if (!inCode && /^##\s+/.test(trimmed) && current.join('\n').trim()) {
        h2Chunks.push(current.join('\n').trim());
        current = [line];
        continue;
      }
      current.push(line);
    }
    if (current.join('\n').trim()) h2Chunks.push(current.join('\n').trim());
    rawSlideBlocks = h2Chunks.length ? h2Chunks : [body || `# ${deckTitle}`];
  }

  const slides = rawSlideBlocks.map((block, idx) => {
    let speakerNotes = '';
    let cleanedBlock = block.replace(/<!--\s*(?:note|speaker)\s*:\s*([\s\S]*?)-->/gi, (_, noteContent) => {
      speakerNotes += (speakerNotes ? '\n' : '') + noteContent.trim();
      return '';
    }).trim();

    const headingMatch = /^\s*#{1,3}\s+(.+?)\s*$/m.exec(cleanedBlock);
    const slideTitle = headingMatch
      ? headingMatch[1].replace(/[*_`~]/g, '').trim()
      : (idx === 0 ? deckTitle : `第 ${idx + 1} 页`);

    if (!speakerNotes) {
      const plainSummary = cleanedBlock
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*#{1,6}\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      speakerNotes = `本页核心：${slideTitle}。${plainSummary}`;
    }

    return {
      index: idx,
      pageNumber: idx + 1,
      title: slideTitle,
      markdown: cleanedBlock,
      html: renderMarkdownBlockToHtml(cleanedBlock, { interactiveWikiLinks: true }),
      speakerNotes,
    };
  });

  return {
    title: deckTitle,
    metadata: fm.metadata,
    splitMode: hasExplicitHr ? 'hr' : (slides.length > 1 ? 'h2' : 'single'),
    totalSlides: slides.length,
    slides,
  };
}

export function compileSingleFileWikiHtml(notes = [], options = {}) {
  const activeNoteId = options.activeNoteId || notes[0]?.id || '';
  const siteTitle = escapeHtml(options.siteTitle || 'Inkloom 墨图 · 离线知识微站');
  const exportedAt = escapeHtml(options.exportedAt || '2026-10-26');

  const preparedNotes = (notes || [])
    .filter(n => n && typeof n.source === 'string')
    .map(n => {
      const bom = n.source.startsWith('\uFEFF') ? 1 : 0;
      const fm = parseFrontMatter(n.source.slice(bom));
      const body = n.source.slice(bom + fm.bodyFrom);
      const cleanTitle = stripNumericPrefix(fm.metadata.title || n.cleanTitle || n.title || n.name || '未命名笔记');
      const folder = n.folder || (n.relativePath?.includes('/') ? n.relativePath.split('/').slice(0, -1).join('/') : '根目录');
      const relPath = String(n.relativePath || (folder && folder !== '根目录' ? `${folder}/${n.name || (cleanTitle + '.md')}` : (n.name || `${cleanTitle}.md`))).replace(/\\/g, '/');
      const relNoExt = relPath.replace(/\.(md|markdown)$/i, '');
      const headings = [...body.matchAll(/^\s*(#{1,3})\s+(.+?)\s*$/gm)].map(m => ({
        level: m[1].length,
        text: m[2].trim(),
      }));
      return {
        id: String(n.id || cleanTitle),
        title: cleanTitle,
        name: n.name || `${cleanTitle}.md`,
        relativePath: relPath,
        relNoExt,
        folder,
        status: fm.metadata.status || n.status || '已发布',
        tags: fm.metadata.tags || n.tags || [],
        summary: fm.metadata.summary || '',
        headings,
        html: renderMarkdownBlockToHtml(body, { interactiveWikiLinks: true }),
        plainText: `${cleanTitle} ${relNoExt} ${folder} ${(fm.metadata.tags || []).join(' ')} ${body.replace(/\s+/g, ' ').slice(0, 1200)}`,
      };
    });

  const payloadJson = JSON.stringify(preparedNotes).replace(/</g, '\\u003c');
  const defaultId = escapeHtml(activeNoteId || preparedNotes[0]?.id || '');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-wiki-generator="Inkloom-1.7.1">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteTitle}</title>
  <style>
    :root { --bg: #f6f8f9; --card: #ffffff; --ink: #1e252b; --muted: #64707d; --line: #e2e8f0; --accent: #1d7268; --accent-soft: rgba(29,114,104,0.1); }
    [data-theme="dark"] { --bg: #11151a; --card: #181e25; --ink: #e2e8f0; --muted: #94a3b8; --line: #2a3441; --accent: #38b2ac; --accent-soft: rgba(56,178,172,0.15); }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Manrope', 'Noto Sans SC', 'Microsoft YaHei', sans-serif; background: var(--bg); color: var(--ink); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    .wiki-top { height: 48px; padding: 0 18px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .wiki-brand { font-weight: 700; font-size: 15px; color: var(--accent); display: flex; align-items: center; gap: 8px; }
    .wiki-search { width: min(340px, 45vw); height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); font-size: 12.5px; }
    .wiki-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px 1fr 220px; overflow: hidden; }
    .wiki-nav, .wiki-toc { background: var(--card); border-right: 1px solid var(--line); padding: 14px 12px; overflow-y: auto; }
    .wiki-toc { border-right: 0; border-left: 1px solid var(--line); }
    .wiki-folder { font-size: 11px; font-weight: 700; color: var(--muted); margin: 12px 6px 6px; text-transform: uppercase; }
    .wiki-note-btn { display: block; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); font-size: 13px; cursor: pointer; margin-bottom: 2px; }
    .wiki-note-btn:hover { background: var(--accent-soft); }
    .wiki-note-btn.active { background: var(--accent); color: #ffffff; font-weight: 600; }
    .wiki-stage { padding: 28px 42px 60px; overflow-y: auto; max-width: 880px; width: 100%; margin: 0 auto; line-height: 1.75; }
    .wiki-meta-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
    .wiki-pill { padding: 2px 10px; border-radius: 999px; font-size: 11.5px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .pub-callout { padding: 12px 16px; border-left: 4px solid var(--accent); background: var(--accent-soft); border-radius: 6px; margin: 14px 0; }
    .pub-highlight-mark { background: rgba(250, 204, 21, 0.35); padding: 1px 4px; border-radius: 3px; color: inherit; }
    .pub-wikilink-chip { border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 1px 9px; font-size: 12.5px; cursor: pointer; }
    .pub-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
    .pub-table th, .pub-table td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; }
    .pub-code-block { padding: 12px 14px; border-radius: 8px; background: #1e293b; color: #f8fafc; overflow-x: auto; font-size: 12.5px; }
    @media (max-width: 900px) { .wiki-body { grid-template-columns: 1fr; } .wiki-toc { display: none; } }
  </style>
</head>
<body>
  <header class="wiki-top">
    <div class="wiki-brand"><span>🏛️ ${siteTitle}</span><small style="color:var(--muted);font-weight:400">共 ${preparedNotes.length} 篇 · 导出于 ${exportedAt}</small></div>
    <div style="display:flex;align-items:center;gap:8px">
      <input id="wiki-search-input" class="wiki-search" type="search" placeholder="搜索微站内全部笔记、标签与正文..." aria-label="搜索知识微站">
      <button type="button" id="wiki-theme-toggle" class="pub-wikilink-chip">切换明暗</button>
    </div>
  </header>
  <div class="wiki-body">
    <nav class="wiki-nav" id="wiki-nav-tree" aria-label="知识微站目录树"></nav>
    <main class="wiki-stage" id="wiki-main-stage" aria-label="笔记正文"></main>
    <aside class="wiki-toc" id="wiki-toc-panel" aria-label="本篇章节大纲"></aside>
  </div>
  <script id="inkloom-wiki-data" type="application/json">${payloadJson}</script>
  <script>
    const notes = JSON.parse(document.getElementById('inkloom-wiki-data').textContent);
    let activeId = ${JSON.stringify(defaultId)} || (notes[0] && notes[0].id) || '';
    let query = '';
    function renderWiki() {
      const nav = document.getElementById('wiki-nav-tree');
      const stage = document.getElementById('wiki-main-stage');
      const toc = document.getElementById('wiki-toc-panel');
      const q = query.trim().toLowerCase();
      const filtered = notes.filter(n => !q || n.plainText.toLowerCase().includes(q));
      const byFolder = new Map();
      for (const n of filtered) {
        if (!byFolder.has(n.folder)) byFolder.set(n.folder, []);
        byFolder.get(n.folder).push(n);
      }
      nav.innerHTML = '';
      for (const [folder, items] of byFolder.entries()) {
        const fh = document.createElement('div');
        fh.className = 'wiki-folder';
        fh.textContent = folder + ' (' + items.length + ')';
        nav.appendChild(fh);
        for (const item of items) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wiki-note-btn' + (item.id === activeId ? ' active' : '');
          b.textContent = item.title;
          b.onclick = () => { activeId = item.id; renderWiki(); };
          nav.appendChild(b);
        }
      }
      const current = notes.find(n => n.id === activeId) || filtered[0] || notes[0];
      if (!current) { stage.innerHTML = '<p>无匹配笔记</p>'; toc.innerHTML = ''; return; }
      const tagsHtml = (current.tags || []).map(t => '<span class="wiki-pill">#' + t + '</span>').join('');
      stage.innerHTML = '<div class="wiki-meta-bar"><span class="wiki-pill">📂 ' + current.folder + '</span><span class="wiki-pill">状态 · ' + current.status + '</span>' + tagsHtml + '</div>' + current.html;
      toc.innerHTML = '<div class="wiki-folder">📑 本篇章节目录</div>' + (current.headings || []).map(h => '<button type="button" class="wiki-note-btn" data-toc-heading="' + h.text.replace(/"/g, '&quot;') + '" style="padding:4px 6px 4px ' + (6 + (h.level - 1) * 10) + 'px;font-size:12px;color:var(--muted)">• ' + h.text + '</button>').join('');
    }
    function scrollToHeadingText(headingText) {
      if (!headingText) return;
      const needle = headingText.trim().toLowerCase();
      const stage = document.getElementById('wiki-main-stage');
      const headings = stage ? stage.querySelectorAll('h1, h2, h3, h4, h5, h6') : [];
      for (const el of headings) {
        if ((el.textContent || '').trim().toLowerCase().includes(needle)) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
    }
    document.getElementById('wiki-search-input').addEventListener('input', e => { query = e.target.value; renderWiki(); });
    document.getElementById('wiki-theme-toggle').addEventListener('click', () => {
      document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    });
    document.addEventListener('click', e => {
      const tocBtn = e.target.closest('[data-toc-heading]');
      if (tocBtn) {
        scrollToHeadingText(tocBtn.dataset.tocHeading);
        return;
      }
      const chip = e.target.closest('[data-wiki-target]');
      if (!chip) return;
      const target = (chip.dataset.wikiTarget || '').trim().toLowerCase().replace(/\\\\/g, '/').replace(/\\.(md|markdown)$/i, '');
      const heading = (chip.dataset.wikiHeading || '').trim();
      const hit = notes.find(n =>
        (n.relNoExt && n.relNoExt.toLowerCase() === target) ||
        (n.relativePath && n.relativePath.toLowerCase() === target) ||
        n.title.toLowerCase() === target ||
        n.name.replace(/\\.md$/i, '').toLowerCase() === target ||
        n.title.toLowerCase().includes(target),
      );
      if (hit) {
        activeId = hit.id;
        renderWiki();
        if (heading) scrollToHeadingText(heading);
      } else if (!target && heading) {
        scrollToHeadingText(heading);
      }
    });
    renderWiki();
  </script>
</body>
</html>`;
}

export function computeNoteLineDiff(baselineSource = '', currentSource = '') {
  const baseNorm = String(baselineSource || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const currNorm = String(currentSource || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  if (baseNorm === currNorm) {
    const equalLines = currNorm.split('\n');
    return {
      identical: true,
      stats: { added: 0, removed: 0, unchanged: equalLines.length, hunks: 0 },
      hunks: [],
      lines: equalLines.map((text, idx) => ({
        type: 'equal',
        text,
        oldLine: idx + 1,
        newLine: idx + 1,
        hunkId: '',
      })),
    };
  }

  const oldLines = baseNorm.split('\n');
  const newLines = currNorm.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Trim common prefix and suffix for speed
  let start = 0;
  while (start < m && start < n && oldLines[start] === newLines[start]) start++;
  let endOld = m - 1;
  let endNew = n - 1;
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--;
    endNew--;
  }

  const midOld = oldLines.slice(start, endOld + 1);
  const midNew = newLines.slice(start, endNew + 1);
  const M = midOld.length;
  const N = midNew.length;

  const midOps = [];
  if (M * N <= 250000) {
    const dp = Array.from({ length: M + 1 }, () => new Int32Array(N + 1));
    for (let i = M - 1; i >= 0; i--) {
      for (let j = N - 1; j >= 0; j--) {
        if (midOld[i] === midNew[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < M && j < N) {
      if (midOld[i] === midNew[j]) {
        midOps.push({ type: 'equal', text: midOld[i], oldIdx: start + i, newIdx: start + j });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        midOps.push({ type: 'del', text: midOld[i], oldIdx: start + i, newIdx: start + j });
        i++;
      } else {
        midOps.push({ type: 'add', text: midNew[j], oldIdx: start + i, newIdx: start + j });
        j++;
      }
    }
    while (i < M) {
      midOps.push({ type: 'del', text: midOld[i], oldIdx: start + i, newIdx: start + j });
      i++;
    }
    while (j < N) {
      midOps.push({ type: 'add', text: midNew[j], oldIdx: start + i, newIdx: start + j });
      j++;
    }
  } else {
    for (let i = 0; i < M; i++) midOps.push({ type: 'del', text: midOld[i], oldIdx: start + i, newIdx: start });
    for (let j = 0; j < N; j++) midOps.push({ type: 'add', text: midNew[j], oldIdx: start + M, newIdx: start + j });
  }

  const allOps = [];
  for (let idx = 0; idx < start; idx++) {
    allOps.push({ type: 'equal', text: oldLines[idx], oldIdx: idx, newIdx: idx });
  }
  allOps.push(...midOps);
  const suffixLen = m - 1 - endOld;
  for (let k = 0; k < suffixLen; k++) {
    const oi = endOld + 1 + k;
    const ni = endNew + 1 + k;
    allOps.push({ type: 'equal', text: oldLines[oi], oldIdx: oi, newIdx: ni });
  }

  // Group contiguous non-equal operations into hunks
  const hunks = [];
  const diffLines = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  let currentHunk = null;
  for (const op of allOps) {
    if (op.type === 'equal') {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      unchanged++;
      diffLines.push({
        type: 'equal',
        text: op.text,
        oldLine: op.oldIdx + 1,
        newLine: op.newIdx + 1,
        hunkId: '',
      });
    } else {
      if (!currentHunk) {
        const hunkNum = hunks.length + 1;
        currentHunk = {
          id: `hunk-${hunkNum}`,
          oldStartIdx: op.oldIdx,
          newStartIdx: op.newIdx,
          oldStartLine: op.oldIdx + 1,
          newStartLine: op.newIdx + 1,
          removedLines: [],
          addedLines: [],
          lines: [],
        };
      }
      if (op.type === 'del') {
        removed++;
        currentHunk.removedLines.push(op.text);
      } else {
        added++;
        currentHunk.addedLines.push(op.text);
      }
      const lineRecord = {
        type: op.type,
        text: op.text,
        oldLine: op.type === 'del' ? op.oldIdx + 1 : null,
        newLine: op.type === 'add' ? op.newIdx + 1 : null,
        hunkId: currentHunk.id,
      };
      currentHunk.lines.push(lineRecord);
      diffLines.push(lineRecord);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  for (const h of hunks) {
    h.oldLineCount = h.removedLines.length;
    h.newLineCount = h.addedLines.length;
    h.header = `@@ -${h.oldStartLine},${h.oldLineCount} +${h.newStartLine},${h.newLineCount} @@`;
    h.summary = `删除 ${h.oldLineCount} 行 · 新增 ${h.newLineCount} 行`;
  }

  return {
    identical: hunks.length === 0,
    stats: {
      added,
      removed,
      unchanged,
      hunks: hunks.length,
    },
    hunks,
    lines: diffLines,
  };
}

export function revertDiffHunk(currentSource = '', baselineSource = '', hunkId = '') {
  const rawCurr = String(currentSource || '');
  const bom = rawCurr.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = rawCurr.includes('\r\n') ? '\r\n' : '\n';

  if (hunkId === 'all') {
    const baseClean = String(baselineSource || '').replace(/^\uFEFF/, '').replace(/\r?\n/g, newline);
    return {
      reverted: baseClean !== rawCurr.replace(/^\uFEFF/, ''),
      source: bom + baseClean,
      hunkId: 'all',
    };
  }

  const diff = computeNoteLineDiff(baselineSource, currentSource);
  const targetHunk = diff.hunks.find(h => h.id === hunkId);
  if (!targetHunk) {
    return { reverted: false, source: rawCurr, hunkId };
  }

  const currLines = rawCurr.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const nextLines = [
    ...currLines.slice(0, targetHunk.newStartIdx),
    ...targetHunk.removedLines,
    ...currLines.slice(targetHunk.newStartIdx + targetHunk.newLineCount),
  ];
  const nextSource = bom + nextLines.join(newline);
  return {
    reverted: nextSource !== rawCurr,
    source: nextSource,
    hunkId: targetHunk.id,
    summary: targetHunk.summary,
  };
}

function normalizeXhtmlFragment(html = '') {
  return String(html || '')
    .replace(/<br\s*>/gi, '<br />')
    .replace(/<hr\s*>/gi, '<hr />')
    .replace(/<input([^>]*?)\s*(?<!\/)>/gi, (_, attrs) => {
      const fixedAttrs = attrs.replace(/\bdisabled\b(?!\s*=)/gi, 'disabled="disabled"').replace(/\bchecked\b(?!\s*=)/gi, 'checked="checked"');
      return `<input${fixedAttrs} />`;
    });
}

function countPlainWords(text = '') {
  const cjk = String(text || '').match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const words = String(text || '').replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g)?.length || 0;
  return cjk + words;
}

/**
 * MAJOR-270 (2.7.0): Standard EPUB 3.0 Offline Package Builder
 * Compiles a single long note/manuscript or a collection of Markdown notes into a standards-compliant
 * EPUB 3.0 .epub archive (mimetype, META-INF/container.xml, OEBPS/content.opf, nav.xhtml, toc.ncx, chapter-*.xhtml).
 */
export function compileEpub3PackageBytes(notes = [], options = {}) {
  const rawList = (Array.isArray(notes) ? notes : [notes]).filter(n => n && typeof n.source === 'string');
  if (!rawList.length) {
    throw new Error('请至少提供 1 篇包含正文的笔记以生成 EPUB 3.0 电子书');
  }

  const firstFm = parseFrontMatter(rawList[0].source.replace(/^\uFEFF/, ''));
  const bookTitle = String(
    options.bookTitle
    || firstFm.metadata.title
    || rawList[0].cleanTitle
    || rawList[0].title
    || rawList[0].name?.replace(/\.(md|markdown)$/i, '')
    || 'Inkloom 墨图电子书',
  ).trim();
  const author = String(
    options.author
    || firstFm.metadata.author
    || rawList[0].author
    || 'Inkloom 墨图作者',
  ).trim();
  const language = String(options.language || 'zh-CN').trim();
  const modifiedIso = String(options.modifiedIso || '2026-11-11T00:00:00Z').trim();
  const identifier = String(options.identifier || `urn:inkloom:epub:${encodeURIComponent(bookTitle).slice(0, 48)}`).trim();

  const chapters = [];
  if (rawList.length === 1) {
    const raw = rawList[0].source.replace(/^\uFEFF/, '');
    const fm = parseFrontMatter(raw);
    const body = raw.slice(fm.bodyFrom).replace(/\r\n/g, '\n').trim();
    const lines = body.split('\n');
    const sections = [];
    let curTitle = bookTitle;
    let curLines = [];
    let inFence = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        inFence = !inFence;
        curLines.push(line);
        continue;
      }
      const h1Match = /^#\s+(.+?)\s*$/.exec(trimmed);
      if (!inFence && h1Match && sections.length === 0 && curLines.every(l => !l.trim())) {
        curTitle = h1Match[1].replace(/[*_`~]/g, '').trim() || curTitle;
        continue;
      }
      const h2Match = /^##\s+(.+?)\s*$/.exec(trimmed);
      if (!inFence && h2Match) {
        if (curLines.some(l => l.trim())) {
          sections.push({ title: curTitle, markdown: curLines.join('\n').trim() });
        }
        curTitle = h2Match[1].replace(/[*_`~]/g, '').trim();
        curLines = [];
        continue;
      }
      curLines.push(line);
    }
    if (curLines.some(l => l.trim()) || !sections.length) {
      sections.push({ title: curTitle, markdown: curLines.join('\n').trim() || bookTitle });
    }
    sections.forEach((sec, idx) => {
      const htmlBody = normalizeXhtmlFragment(renderMarkdownBlockToHtml(sec.markdown, { interactiveWikiLinks: false }));
      chapters.push({
        index: idx + 1,
        id: `chapter-${idx + 1}`,
        fileName: `chapter-${idx + 1}.xhtml`,
        title: sec.title || `第 ${idx + 1} 章`,
        wordCount: countPlainWords(sec.markdown),
        xhtmlBody: htmlBody,
      });
    });
  } else {
    const sorted = [...rawList].sort((a, b) => {
      const fmA = parseFrontMatter(a.source.replace(/^\uFEFF/, ''));
      const fmB = parseFrontMatter(b.source.replace(/^\uFEFF/, ''));
      const oa = Number(fmA.metadata.chapter_order || a.chapterOrder || 9999);
      const ob = Number(fmB.metadata.chapter_order || b.chapterOrder || 9999);
      if (oa !== ob) return oa - ob;
      return String(a.relativePath || a.name || a.title || '').localeCompare(String(b.relativePath || b.name || b.title || ''), 'zh-CN', { numeric: true });
    });

    sorted.forEach((note, idx) => {
      const raw = note.source.replace(/^\uFEFF/, '');
      const fm = parseFrontMatter(raw);
      const body = raw.slice(fm.bodyFrom).replace(/\r\n/g, '\n').replace(/^#\s+[^\n]+\n*/, '').trim();
      const chTitle = stripNumericPrefix(fm.metadata.title || note.cleanTitle || note.title || note.name?.replace(/\.(md|markdown)$/i, '') || `第 ${idx + 1} 章`);
      const htmlBody = normalizeXhtmlFragment(renderMarkdownBlockToHtml(body || chTitle, { interactiveWikiLinks: false }));
      chapters.push({
        index: idx + 1,
        id: `chapter-${idx + 1}`,
        fileName: `chapter-${idx + 1}.xhtml`,
        title: chTitle,
        wordCount: countPlainWords(body),
        xhtmlBody: htmlBody,
      });
    });
  }

  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  const stylesCss = [
    'body { font-family: "Literata", "Noto Serif SC", "Songti SC", serif; line-height: 1.75; color: #1b1f25; margin: 1.2em; }',
    'h1, h2, h3, h4 { font-family: "Manrope", "Noto Sans SC", sans-serif; color: #111827; line-height: 1.35; }',
    'blockquote, aside.pub-callout { border-left: 3px solid #1d7268; padding: 0.5em 1em; margin: 1em 0; background: #f4f7f6; }',
    'table.pub-table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.92em; }',
    'table.pub-table th, table.pub-table td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }',
    'pre.pub-code-block { background: #1e293b; color: #f8fafc; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }',
  ].join('\n');

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const navItems = chapters
    .map(ch => `        <li><a href="${ch.fileName}">${escapeHtml(ch.title)}</a></li>`)
    .join('\n');

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(bookTitle)} · 目录</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeHtml(bookTitle)}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;

  const ncxPoints = chapters
    .map(
      ch => `    <navPoint id="navPoint-${ch.index}" playOrder="${ch.index}">
      <navLabel><text>${escapeHtml(ch.title)}</text></navLabel>
      <content src="${ch.fileName}"/>
    </navPoint>`,
    )
    .join('\n');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeHtml(identifier)}"/>
  </head>
  <docTitle><text>${escapeHtml(bookTitle)}</text></docTitle>
  <navMap>
${ncxPoints}
  </navMap>
</ncx>`;

  const manifestItems = [
    '    <item id="css" href="styles.css" media-type="text/css"/>',
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    ...chapters.map(
      ch => `    <item id="${ch.id}" href="${ch.fileName}" media-type="application/xhtml+xml"/>`,
    ),
  ].join('\n');

  const spineItems = chapters
    .map(ch => `    <itemref idref="${ch.id}"/>`)
    .join('\n');

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeHtml(identifier)}</dc:identifier>
    <dc:title>${escapeHtml(bookTitle)}</dc:title>
    <dc:creator>${escapeHtml(author)}</dc:creator>
    <dc:language>${escapeHtml(language)}</dc:language>
    <meta property="dcterms:modified">${escapeHtml(modifiedIso)}</meta>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;

  const zipFiles = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': containerXml,
    'OEBPS/styles.css': stylesCss,
    'OEBPS/nav.xhtml': navXhtml,
    'OEBPS/toc.ncx': tocNcx,
    'OEBPS/content.opf': contentOpf,
  };

  for (const ch of chapters) {
    zipFiles[`OEBPS/${ch.fileName}`] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
  <section id="${ch.id}">
    <h1>${escapeHtml(ch.title)}</h1>
    ${ch.xhtmlBody}
  </section>
</body>
</html>`;
  }

  const bytes = buildStoredZipBytes(zipFiles);
  return {
    bookTitle,
    author,
    language,
    identifier,
    chapterCount: chapters.length,
    totalWords,
    chapters: chapters.map(({ index, id, fileName, title, wordCount }) => ({
      index,
      id,
      fileName,
      title,
      wordCount,
    })),
    bytes,
    base64Data: uint8ArrayToBase64(bytes),
  };
}

/**
 * 7. Offline SVG / PNG Knowledge Quote & Note Share Card Renderer (MAJOR-290)
 */
export const KNOWLEDGE_CARD_THEMES = {
  'scroll-light': {
    id: 'scroll-light',
    name: '书卷清透',
    bgStart: '#fbf9f3',
    bgEnd: '#f1ece1',
    surface: '#ffffff',
    border: '#dcd4c4',
    ink: '#1e2229',
    muted: '#5e6572',
    accent: '#0f766e',
    tagBg: '#e6f2f0',
    tagInk: '#0f766e',
    sealBg: '#b91c1c',
    sealInk: '#ffffff',
  },
  'obsidian-gold': {
    id: 'obsidian-gold',
    name: '暗夜黑金',
    bgStart: '#161920',
    bgEnd: '#0e1015',
    surface: '#1c2029',
    border: '#323846',
    ink: '#f3f4f6',
    muted: '#9ca3af',
    accent: '#f59e0b',
    tagBg: '#2c2517',
    tagInk: '#fbbf24',
    sealBg: '#d97706',
    sealInk: '#111827',
  },
  'morandi-sage': {
    id: 'morandi-sage',
    name: '莫兰迪青瓷',
    bgStart: '#eef3f0',
    bgEnd: '#e2ebe6',
    surface: '#f8fbf9',
    border: '#c5d4cc',
    ink: '#1d2b24',
    muted: '#52665c',
    accent: '#2d6a4f',
    tagBg: '#dcebe3',
    tagInk: '#2d6a4f',
    sealBg: '#2d6a4f',
    sealInk: '#ffffff',
  },
  'ink-indigo': {
    id: 'ink-indigo',
    name: '苍穹靛青',
    bgStart: '#f0f4fa',
    bgEnd: '#e4ebf5',
    surface: '#ffffff',
    border: '#c7d4e6',
    ink: '#172236',
    muted: '#52627a',
    accent: '#2563eb',
    tagBg: '#e0eafc',
    tagInk: '#1d4ed8',
    sealBg: '#1d4ed8',
    sealInk: '#ffffff',
  },
};

function cleanShareCardLine(line = '') {
  return purifyWikiLinksForExport(String(line || ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*\[![A-Za-z]+\]\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\s*@sr\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractNoteKnowledgeCardPayload(note = {}, { selectionText = '', customAuthor = '', maxParagraphs = 4 } = {}) {
  const rawSource = String(note?.source || '');
  const fm = parseFrontMatter(rawSource);
  const entriesList = Array.isArray(fm.entries) ? fm.entries : (Array.isArray(fm.properties) ? fm.properties : []);
  const propsMap = Object.fromEntries(entriesList.map(item => [item.key, item.value]));
  const meta = fm.metadata || {};
  const body = rawSource.slice(fm.bodyFrom).replaceAll('\r\n', '\n');
  const h1Match = /^#\s+(.+)$/m.exec(body);
  const rawTitle = String(
    meta.title || propsMap.title || note?.cleanTitle || note?.title || h1Match?.[1] || note?.name || '未命名笔记'
  ).replace(/\.(md|markdown|txt)$/i, '');
  const title = stripNumericPrefix(rawTitle).trim() || '墨图笔记';
  const author = String(customAuthor || propsMap.author || note?.author || '达芬奇Vincent · 墨图').trim();
  const date = String(meta.date || propsMap.date || note?.date || localDate()).slice(0, 10);
  const rawTags = Array.isArray(meta.tags) && meta.tags.length
    ? meta.tags
    : Array.isArray(fm.tags) && fm.tags.length
      ? fm.tags
      : Array.isArray(note?.tags) && note.tags.length
        ? note.tags
        : ['墨图笔记'];
  const tags = [...new Set(rawTags.map(t => String(t || '').replace(/^#+/, '').trim()).filter(Boolean))].slice(0, 4);
  const wordCount = countNoteWords(rawSource);

  const chosenParagraphs = [];
  const trimmedSelection = String(selectionText || '').trim();
  if (trimmedSelection) {
    for (const rawLine of trimmedSelection.replaceAll('\r\n', '\n').split(/\n+/)) {
      const cleaned = cleanShareCardLine(rawLine.replace(/^#+\s+/, ''));
      if (cleaned) chosenParagraphs.push(cleaned);
      if (chosenParagraphs.length >= maxParagraphs + 2) break;
    }
  }

  if (!chosenParagraphs.length) {
    let inFence = false;
    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim();
      if (/^(```|~~~)/.test(trimmed)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !trimmed) continue;
      if (/^#+\s+/.test(trimmed) || /^---+$/.test(trimmed) || /^\|.*\|$/.test(trimmed)) continue;
      const cleaned = cleanShareCardLine(trimmed.replace(/^[-*+]\s+\[[ xX/]\]\s+/, '• ').replace(/^[-*+]\s+/, '• '));
      if (!cleaned || cleaned === title) continue;
      chosenParagraphs.push(cleaned);
      if (chosenParagraphs.length >= maxParagraphs) break;
    }
  }

  if (!chosenParagraphs.length) {
    chosenParagraphs.push('一念落笔，万象成图。本地优先的个人知识与创作工作台。');
  }

  return {
    title,
    author,
    date,
    tags,
    wordCount,
    paragraphs: chosenParagraphs,
    excerptText: chosenParagraphs.join('\n\n'),
  };
}

function wrapVisualUnitsLine(text = '', maxUnits = 27) {
  const str = String(text || '').trim();
  if (!str) return [];
  const wrapped = [];
  let current = '';
  let units = 0;
  for (const ch of str) {
    const step = ch.charCodeAt(0) > 255 ? 1 : 0.56;
    if (units + step > maxUnits && current) {
      wrapped.push(current.trimEnd());
      current = ch.trimStart();
      units = current ? step : 0;
    } else {
      current += ch;
      units += step;
    }
  }
  if (current.trim()) wrapped.push(current.trim());
  return wrapped;
}

export function renderKnowledgeShareCardSvg(noteOrPayload = {}, options = {}) {
  const themeKey = KNOWLEDGE_CARD_THEMES[options.theme] ? options.theme : 'scroll-light';
  const palette = KNOWLEDGE_CARD_THEMES[themeKey];
  const width = Math.max(480, Math.min(960, Number(options.width) || 680));
  const payload = Array.isArray(noteOrPayload?.paragraphs) && noteOrPayload?.title && !options.selectionText && !options.customAuthor
    ? noteOrPayload
    : extractNoteKnowledgeCardPayload(noteOrPayload, {
        selectionText: options.selectionText || '',
        customAuthor: options.customAuthor || '',
        maxParagraphs: options.maxParagraphs || 4,
      });

  const maxBodyUnits = Math.max(18, Math.floor((width - 128) / 19.5));
  const titleLines = wrapVisualUnitsLine(payload.title, Math.max(14, Math.floor((width - 128) / 26))).slice(0, 2);
  const bodyLines = [];
  for (const para of payload.paragraphs) {
    const lines = wrapVisualUnitsLine(para, maxBodyUnits);
    for (const line of lines) {
      bodyLines.push({ text: line, isParagraphEnd: false });
    }
    if (bodyLines.length) bodyLines[bodyLines.length - 1].isParagraphEnd = true;
    if (bodyLines.length >= 16) break;
  }

  const titleStartY = 108;
  const titleLineHeight = 34;
  const bodyStartY = titleStartY + titleLines.length * titleLineHeight + 28;
  let cursorY = bodyStartY;
  const positionedBodyLines = [];
  for (const item of bodyLines.slice(0, 16)) {
    positionedBodyLines.push({ text: item.text, y: cursorY });
    cursorY += item.isParagraphEnd ? 38 : 29;
  }

  const footerTopY = Math.max(cursorY + 20, 290);
  const height = footerTopY + 86;

  let tagCursorX = 56;
  const tagNodes = [];
  for (const tag of (payload.tags || []).slice(0, 3)) {
    const label = `#${tag}`;
    const pillWidth = Math.max(54, Math.round(label.length * 11 + 20));
    if (tagCursorX + pillWidth > width - 150) break;
    tagNodes.push(
      `<g transform="translate(${tagCursorX}, 44)">` +
        `<rect width="${pillWidth}" height="24" rx="12" fill="${palette.tagBg}" />` +
        `<text x="${Math.round(pillWidth / 2)}" y="16" text-anchor="middle" fill="${palette.tagInk}" font-size="11.5" font-weight="600" font-family="'Manrope', 'Microsoft YaHei', sans-serif">${escapeHtml(label)}</text>` +
      `</g>`
    );
    tagNodes.push();
    tagCursorX += pillWidth + 8;
  }

  const titleNodes = titleLines.map((line, idx) =>
    `<text x="56" y="${titleStartY + idx * titleLineHeight}" fill="${palette.ink}" font-size="25" font-weight="700" font-family="'Literata', 'Noto Serif SC', 'Songti SC', serif">${escapeHtml(line)}</text>`
  ).join('\n    ');

  const bodyNodes = positionedBodyLines.map(line =>
    `<text x="64" y="${line.y}" fill="${palette.ink}" font-size="16.5" font-weight="400" font-family="'Literata', 'Noto Serif SC', 'Microsoft YaHei', serif">${escapeHtml(line.text)}</text>`
  ).join('\n    ');

  const quoteBarHeight = Math.max(36, (positionedBodyLines.at(-1)?.y || bodyStartY) - bodyStartY + 20);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(payload.title)} 知识分享卡片">`,
    `  <defs>`,
    `    <linearGradient id="inkloom-card-bg-${palette.id}" x1="0" y1="0" x2="1" y2="1">`,
    `      <stop offset="0%" stop-color="${palette.bgStart}" />`,
    `      <stop offset="100%" stop-color="${palette.bgEnd}" />`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect width="${width}" height="${height}" rx="20" fill="url(#inkloom-card-bg-${palette.id})" />`,
    `  <rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="16" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1.5" />`,
    `  <g class="card-header">`,
    `    ${tagNodes.join('\n    ')}`,
    `    <text x="${width - 56}" y="60" text-anchor="end" fill="${palette.muted}" font-size="12" font-family="'Manrope', 'Microsoft YaHei', sans-serif">${escapeHtml(payload.date)}</text>`,
    `  </g>`,
    `  <g class="card-title-group">`,
    `    ${titleNodes}`,
    `  </g>`,
    `  <rect x="48" y="${bodyStartY - 16}" width="3.5" height="${quoteBarHeight}" rx="2" fill="${palette.accent}" opacity="0.85" />`,
    `  <g class="card-body-group">`,
    `    ${bodyNodes}`,
    `  </g>`,
    `  <line x1="56" y1="${footerTopY}" x2="${width - 56}" y2="${footerTopY}" stroke="${palette.border}" stroke-width="1" stroke-dasharray="4 4" />`,
    `  <g class="card-footer" transform="translate(0, ${footerTopY})">`,
    `    <text x="56" y="30" fill="${palette.ink}" font-size="13" font-weight="600" font-family="'Manrope', 'Microsoft YaHei', sans-serif">${escapeHtml(payload.author)}</text>`,
    `    <text x="56" y="50" fill="${palette.muted}" font-size="11.5" font-family="'Manrope', 'Microsoft YaHei', sans-serif">摘自《${escapeHtml(payload.title)}》 · 全篇 ${payload.wordCount} 字 · Inkloom 墨图</text>`,
    `    <g transform="translate(${width - 104}, 16)">`,
    `      <rect width="48" height="36" rx="6" fill="${palette.sealBg}" />`,
    `      <text x="24" y="23" text-anchor="middle" fill="${palette.sealInk}" font-size="13" font-weight="700" letter-spacing="2" font-family="'Noto Serif SC', 'Songti SC', serif">墨图</text>`,
    `    </g>`,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return {
    svg,
    width,
    height,
    theme: themeKey,
    themeName: palette.name,
    title: payload.title,
    author: payload.author,
    date: payload.date,
    tags: payload.tags,
    wordCount: payload.wordCount,
    lineCount: positionedBodyLines.length,
    excerptText: payload.excerptText,
  };
}
