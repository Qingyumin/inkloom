import { parseFrontMatter, extractWikiLinks, nonCodeLineRanges, stripNumericPrefix, localDate, unescapeWikiLinksInMarkdown } from './vault-graph.mjs';

export function diagnoseVaultHealth(notes = [], { versions = new Map() } = {}) {
  const realNotes = (notes || []).filter(n => n && n.exists !== false && !n.ghost);
  const findings = [];
  const titleMap = new Map();
  const knownTargets = new Set();

  for (const note of realNotes) {
    const clean = stripNumericPrefix(note.cleanTitle || note.title || note.stem || '').toLocaleLowerCase();
    const raw = String(note.title || note.stem || '').toLocaleLowerCase();
    if (clean) {
      knownTargets.add(clean);
      if (!titleMap.has(clean)) titleMap.set(clean, []);
      titleMap.get(clean).push(note);
    }
    if (raw) knownTargets.add(raw);
    for (const alias of note.aliases || []) {
      if (alias) knownTargets.add(String(alias).trim().toLocaleLowerCase());
    }
  }

  for (const [cleanKey, list] of titleMap) {
    if (list.length > 1) {
      findings.push({
        id: `dup:${cleanKey}`,
        kind: 'duplicate-title',
        severity: 'warning',
        autoFixable: false,
        noteId: list[0].id,
        noteTitle: list[0].title,
        title: `同名或去前缀冲突：《${list.map(n => n.title).join('》与《')}》`,
        detail: `共有 ${list.length} 篇笔记共享归一化标题「${cleanKey}」，建议重命名或通过目录路径区分双链引用。`,
        version: versions.get(list[0].id) || '',
      });
    }
  }

  for (const note of realNotes) {
    if (note.metadata?.category === 'whiteboard') continue;
    const src = String(note.source || '');
    const bom = src.startsWith('\uFEFF') ? 1 : 0;
    const fm = parseFrontMatter(src.slice(bom));
    const bodyFrom = bom + fm.bodyFrom;
    const stem = stripNumericPrefix(note.cleanTitle || note.title || note.stem || '未命名');
    const ver = versions.get(note.id) || note.version || '';

    // 1. Check missing YAML Frontmatter
    if (fm.bodyFrom === 0 || !fm.metadata?.title) {
      findings.push({
        id: `fm:${note.id}`,
        kind: 'missing-frontmatter',
        severity: 'info',
        autoFixable: true,
        noteId: note.id,
        noteTitle: note.title || stem,
        title: `缺少标准 YAML Frontmatter：《${note.title || stem}》`,
        detail: '未检测到顶部 YAML 属性头或缺少 title 字段，支持一键补齐标准 YAML 头且不改动正文。',
        version: ver,
      });
    }

    // 2. Check unresolved ghost WikiLinks
    const links = extractWikiLinks(src, bodyFrom);
    for (const link of links) {
      const targetKey = stripNumericPrefix(link.target || '').toLocaleLowerCase();
      const rawKey = String(link.target || '').toLocaleLowerCase();
      if (targetKey && !knownTargets.has(targetKey) && !knownTargets.has(rawKey)) {
        findings.push({
          id: `ghost:${note.id}:${link.target}`,
          kind: 'unresolved-ghost',
          severity: 'info',
          autoFixable: false,
          ghostTarget: stripNumericPrefix(link.target) || link.target,
          noteId: note.id,
          noteTitle: note.title || stem,
          title: `待建双链节点 [[${link.target}]]（来自《${note.title || stem}》）`,
          detail: '该双链指向的目标笔记尚未创建，可点击跳转或创建对应卡片以闭合知识网络。',
          version: ver,
        });
      }
    }

    // 3. Check Obsidian-specific syntax compatibility (ECO-003) & escaped WikiLinks
    const bodyRanges = nonCodeLineRanges(src, bodyFrom);
    let hasObsidianComment = false;
    let hasObsidianHighlight = false;
    let hasEscapedWikiLink = false;
    for (const line of bodyRanges) {
      if (/%%[^%]+%%/.test(line.text)) hasObsidianComment = true;
      if (/==[^=\s][^=]*==/.test(line.text)) hasObsidianHighlight = true;
      if (/\\\[\\?\[/.test(line.text)) hasEscapedWikiLink = true;
    }
    const hasDataview = /```\s*dataview/i.test(src);

    if (hasObsidianComment || hasObsidianHighlight || hasDataview || hasEscapedWikiLink) {
      const tags = [];
      if (hasObsidianComment) tags.push('%%隐藏注释%%');
      if (hasObsidianHighlight) tags.push('==高亮语法==');
      if (hasDataview) tags.push('dataview 代码块');
      if (hasEscapedWikiLink) tags.push('转义双链 \\[[...]]');
      findings.push({
        id: `obsidian:${note.id}`,
        kind: 'obsidian-syntax',
        severity: 'info',
        autoFixable: hasObsidianComment || hasObsidianHighlight || hasEscapedWikiLink,
        noteId: note.id,
        noteTitle: note.title || stem,
        title: `检测到可扩展/待净化语法：《${note.title || stem}》`,
        detail: `包含 ${tags.join('、')}。支持一键将转义双链、%%注释%% 与 ==高亮== 规范化为标准 Markdown，保留正文兼容性。`,
        version: ver,
      });
    }
  }

  const penalty = findings.reduce((sum, f) => sum + (f.severity === 'warning' ? 6 : 3), 0);
  const healthScore = Math.max(40, Math.min(100, 100 - penalty));

  return {
    totalNotes: realNotes.length,
    healthScore,
    autoFixableCount: findings.filter(f => f.autoFixable).length,
    findings,
  };
}

export function normalizeNoteHealthAndObsidianSyntax(note, { today = localDate() } = {}) {
  if (!note || typeof note.source !== 'string') {
    return { source: note?.source || '', changed: false, actions: [] };
  }
  const hasBom = note.source.startsWith('\uFEFF');
  const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
  let body = (hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n');
  const actions = [];

  const fm = parseFrontMatter(body);
  let headerPart = body.slice(0, fm.bodyFrom);
  let contentPart = body.slice(fm.bodyFrom);

  const cleanTitle = stripNumericPrefix(note.cleanTitle || note.title || note.stem || (note.name || '').replace(/\.md$/i, '') || '未命名笔记');
  if (fm.bodyFrom === 0) {
    headerPart = [
      '---',
      `title: ${cleanTitle}`,
      'status: 进行中',
      `date: ${today}`,
      '---',
      '',
    ].join('\n');
    actions.push('补齐标准 YAML Frontmatter');
  } else if (!fm.metadata?.title) {
    headerPart = headerPart.replace(/^---\n/, `---\ntitle: ${cleanTitle}\n`);
    actions.push('补齐 YAML title 字段');
  }

  // Safely convert Obsidian %%comments%% and ==highlights== outside code blocks
  const lines = contentPart.split('\n');
  let inFence = false;
  let convertedSyntax = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const before = lines[i];
    let after = before
      .replace(/%%\s*([^%]+?)\s*%%/g, '<!-- $1 -->')
      .replace(/==([^=\s][^=\n]*?)==/g, '**$1**');
    if (after !== before) {
      lines[i] = after;
      convertedSyntax = true;
    }
  }
  if (convertedSyntax) {
    contentPart = lines.join('\n');
    actions.push('转换 Obsidian %%注释%% / ==高亮== 语法');
  }
  const unescapedContent = unescapeWikiLinksInMarkdown(contentPart);
  if (unescapedContent !== contentPart) {
    contentPart = unescapedContent;
    actions.push('修复转义双链语法');
  }

  const nextNormalized = headerPart + contentPart;
  const changed = actions.length > 0;
  const formatted = newline === '\r\n' ? nextNormalized.replaceAll('\n', '\r\n') : nextNormalized;
  return {
    source: changed ? (hasBom ? '\uFEFF' : '') + formatted : note.source,
    changed,
    actions,
  };
}

/* ============================================================================
 * MAJOR-230 (2.3.0): Obsidian Dataview DQL Live Query Engine &
 * Notion / Logseq / Obsidian Multi-Source Lossless Migration Engine
 * ========================================================================== */

/**
 * Parse an Obsidian Dataview DQL query (`TABLE ...`, `LIST ...`, `TASK ...`).
 */
export function parseDataviewQuery(dql = '') {
  const cleaned = String(dql || '')
    .replace(/^```\s*dataview\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleaned) {
    throw new Error('Dataview 查询语句不能为空');
  }
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  const modeMatch = /^(TABLE(?:\s+WITHOUT\s+ID)?|LIST|TASK)\b([\s\S]*)$/i.exec(normalized);
  if (!modeMatch) {
    throw new Error('不支持的 Dataview 查询类型（支持 TABLE / LIST / TASK）');
  }
  const rawMode = modeMatch[1].toUpperCase();
  const mode = rawMode.startsWith('TABLE') ? 'TABLE' : rawMode;
  let rest = modeMatch[2].trim();

  let limit = 50;
  const limitMatch = /\bLIMIT\s+(\d+)\s*$/i.exec(rest);
  if (limitMatch) {
    limit = Math.max(1, Math.min(200, Number(limitMatch[1]) || 50));
    rest = rest.slice(0, limitMatch.index).trim();
  }

  let sortField = '';
  let sortDir = 'asc';
  const sortMatch = /\bSORT\s+([A-Za-z0-9_.\u4e00-\u9fa5-]+)(?:\s+(ASC|DESC|ASCENDING|DESCENDING))?\s*$/i.exec(rest);
  if (sortMatch) {
    sortField = sortMatch[1].trim();
    sortDir = /^DESC/i.test(sortMatch[2] || '') ? 'desc' : 'asc';
    rest = rest.slice(0, sortMatch.index).trim();
  }

  let whereExpr = '';
  const whereMatch = /\bWHERE\s+([\s\S]+)$/i.exec(rest);
  if (whereMatch) {
    whereExpr = whereMatch[1].trim();
    rest = rest.slice(0, whereMatch.index).trim();
  }

  let fromSource = '';
  const fromMatch = /\bFROM\s+("[^"]*"|'[^']*'|#[A-Za-z0-9_/\u4e00-\u9fa5-]+|[^\s]+)\s*$/i.exec(rest);
  if (fromMatch) {
    fromSource = fromMatch[1].trim();
    rest = rest.slice(0, fromMatch.index).trim();
  }

  const fields = mode === 'TABLE'
    ? rest.split(',').map(f => f.trim()).filter(Boolean).map(rawField => {
        const asMatch = /^([A-Za-z0-9_.\u4e00-\u9fa5-]+)\s+AS\s+["']?([^"']+)["']?$/i.exec(rawField);
        if (asMatch) return { key: asMatch[1].trim(), label: asMatch[2].trim() };
        return { key: rawField, label: rawField };
      })
    : [];

  return {
    mode,
    fields: fields.length ? fields : (mode === 'TABLE' ? [{ key: 'status', label: 'status' }, { key: 'date', label: 'date' }, { key: 'tags', label: 'tags' }] : []),
    fromSource,
    whereExpr,
    sortField,
    sortDir,
    limit,
  };
}

function readNoteFieldForDataview(note = {}, fm = {}, fieldKey = '') {
  const key = String(fieldKey || '').replace(/^file\./i, '').trim();
  if (!key) return '';
  if (key === 'name' || key === 'title') return stripNumericPrefix(note.cleanTitle || note.title || fm.metadata?.title || note.name || '');
  if (key === 'folder' || key === 'path') return note.folder || note.relativePath || '';
  if (key === 'tags' || key === 'etags') {
    const tags = note.tags || fm.metadata?.tags || [];
    return Array.isArray(tags) ? tags.map(t => `#${String(t).replace(/^#+/, '')}`).join(' ') : String(tags);
  }
  if (key === 'status') return note.status || fm.metadata?.status || '';
  if (key === 'date' || key === 'cday' || key === 'mday') return note.date || fm.metadata?.date || '';
  if (key === 'category') return note.category || fm.metadata?.category || '';
  const entry = (fm.entries || []).find(e => e.key.toLowerCase() === key.toLowerCase());
  return entry ? String(entry.value ?? '') : '';
}

function matchesDataviewWhere(note, fm, whereExpr = '') {
  const expr = String(whereExpr || '').trim();
  if (!expr) return true;
  const containsMatch = /^contains\(\s*([A-Za-z0-9_.\u4e00-\u9fa5-]+)\s*,\s*["']([^"']*)["']\s*\)$/i.exec(expr);
  if (containsMatch) {
    const val = readNoteFieldForDataview(note, fm, containsMatch[1]);
    return val.toLocaleLowerCase().includes(containsMatch[2].toLocaleLowerCase());
  }
  const eqMatch = /^([A-Za-z0-9_.\u4e00-\u9fa5-]+)\s*(=|!=)\s*["']([^"']*)["']$/i.exec(expr);
  if (eqMatch) {
    const val = readNoteFieldForDataview(note, fm, eqMatch[1]);
    const isEq = val.toLocaleLowerCase() === eqMatch[3].toLocaleLowerCase();
    return eqMatch[2] === '!=' ? !isEq : isEq;
  }
  return true;
}

/**
 * Execute a parsed or raw Dataview DQL query against vault notes and return structured rows + Markdown.
 */
export function executeDataviewQuery(notes = [], dql = '') {
  const spec = typeof dql === 'string' ? parseDataviewQuery(dql) : dql;
  const realNotes = (notes || []).filter(n => n && n.exists !== false && !n.ghost);

  const scoped = [];
  for (const note of realNotes) {
    const src = String(note.source || '').replace(/^\uFEFF/, '');
    const fm = parseFrontMatter(src);
    const rel = String(note.relativePath || note.name || '').replace(/\\/g, '/');
    const folder = note.folder || (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const tags = (note.tags || fm.metadata?.tags || []).map(t => String(t).replace(/^#+/, '').toLocaleLowerCase());

    if (spec.fromSource) {
      if (spec.fromSource.startsWith('#')) {
        const wantedTag = spec.fromSource.slice(1).toLocaleLowerCase();
        if (!tags.includes(wantedTag)) continue;
      } else {
        const wantedFolder = spec.fromSource.replace(/^["']|["']$/g, '').replace(/^\/+|\/+$/g, '').trim();
        if (wantedFolder && folder !== wantedFolder && !rel.startsWith(wantedFolder + '/')) continue;
      }
    }

    if (spec.mode !== 'TASK' && !matchesDataviewWhere(note, fm, spec.whereExpr)) {
      continue;
    }

    scoped.push({ note, fm, rel, cleanTitle: stripNumericPrefix(note.cleanTitle || note.title || fm.metadata?.title || note.name || '未命名') });
  }

  if (spec.sortField) {
    scoped.sort((a, b) => {
      const va = readNoteFieldForDataview(a.note, a.fm, spec.sortField);
      const vb = readNoteFieldForDataview(b.note, b.fm, spec.sortField);
      const cmp = String(va).localeCompare(String(vb), 'zh-CN', { numeric: true });
      return spec.sortDir === 'desc' ? -cmp : cmp;
    });
  }

  if (spec.mode === 'TASK') {
    const tasks = [];
    const wantUncompletedOnly = /!completed|status\s*!=\s*["']done["']/i.test(spec.whereExpr);
    const wantCompletedOnly = /\bcompleted\b/i.test(spec.whereExpr) && !wantUncompletedOnly;
    for (const item of scoped) {
      const lines = String(item.note.source || '').split(/\r?\n/);
      for (const line of lines) {
        const m = /^\s*[-*]\s+\[([ xX/])\]\s+(.+)$/.exec(line);
        if (!m) continue;
        const done = m[1].toLowerCase() === 'x';
        if (wantUncompletedOnly && done) continue;
        if (wantCompletedOnly && !done) continue;
        tasks.push({
          noteTitle: item.cleanTitle,
          statusChar: m[1],
          done,
          text: m[2].trim(),
        });
        if (tasks.length >= spec.limit) break;
      }
      if (tasks.length >= spec.limit) break;
    }
    const mdLines = [
      `### ☑️ Dataview TASK 查询结果（共 ${tasks.length} 项）`,
      '',
      ...(tasks.length
        ? tasks.map(t => `- [${t.statusChar}] ${t.text} （来自 [[${t.noteTitle}]]）`)
        : ['- _当前筛选条件下暂无匹配任务_']),
    ];
    return {
      mode: 'TASK',
      rowCount: tasks.length,
      rows: tasks,
      markdown: mdLines.join('\n'),
    };
  }

  const limited = scoped.slice(0, spec.limit);
  if (spec.mode === 'LIST') {
    const mdLines = [
      `### 📋 Dataview LIST 查询结果（共 ${limited.length} 篇）`,
      '',
      ...(limited.length
        ? limited.map(item => `- [[${item.cleanTitle}]]${readNoteFieldForDataview(item.note, item.fm, 'status') ? ` · \`${readNoteFieldForDataview(item.note, item.fm, 'status')}\`` : ''}`)
        : ['- _当前筛选条件下暂无匹配笔记_']),
    ];
    return {
      mode: 'LIST',
      rowCount: limited.length,
      rows: limited.map(i => ({ title: i.cleanTitle, relativePath: i.rel })),
      markdown: mdLines.join('\n'),
    };
  }

  const headers = ['笔记 (File)', ...spec.fields.map(f => f.label)];
  const rows = limited.map(item => {
    const cells = spec.fields.map(f => readNoteFieldForDataview(item.note, item.fm, f.key) || '—');
    return {
      title: item.cleanTitle,
      relativePath: item.rel,
      cells,
    };
  });

  const mdTable = [
    `### 📊 Dataview TABLE 查询结果（共 ${rows.length} 篇）`,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| [[${r.title}]] | ${r.cells.map(c => String(c).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');

  return {
    mode: 'TABLE',
    rowCount: rows.length,
    headers,
    rows,
    markdown: mdTable,
  };
}

/**
 * Convert Notion Export (.md with 32-hex UUIDs & top key-value header lines),
 * Logseq Outline (.md with `- ` bullets, `prop:: value`, `TODO`/`DOING`/`DONE`),
 * or Obsidian syntax into clean Inkloom Markdown while preserving UTF-8 BOM & CRLF.
 */
export function convertExternalVaultNoteToInkloom(rawSource = '', options = {}) {
  const raw = String(rawSource || '');
  const hasBom = raw.startsWith('\uFEFF');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const clean = (hasBom ? raw.slice(1) : raw).replace(/\r\n/g, '\n');
  const today = options.today || localDate();

  // Strip Notion 32-char hex UUID suffix from file name if provided
  const rawFileName = String(options.fileName || '').replace(/\.(md|markdown)$/i, '').trim();
  const cleanFileTitle = rawFileName
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/^\d{4}_\d{2}_\d{2}$/, m => m.replace(/_/g, '-'))
    .trim();

  const actions = [];
  let work = clean;

  // 1. Detect and strip Notion 32-hex UUID suffixes on markdown links: [Title](Page%20Name%200123456789abcdef0123456789abcdef.md) -> [[Title]]
  const notionLinkRegex = /\[([^\]]+)\]\(([^)]+?)[%20\s]+[0-9a-f]{32}\.md\)/gi;
  if (notionLinkRegex.test(work)) {
    work = work.replace(notionLinkRegex, (_, label) => `[[${label.trim()}]]`);
    actions.push('剥离 Notion 导出链接 32 位 UUID 后缀并转为 [[双链]]');
  }

  // 2. Detect Notion top metadata lines right after `# Title` (e.g., `Status: In Progress\nTags: AI, PKM`)
  const notionHeaderMatch = /^#\s+([^\n]+)\n+((?:[A-Za-z\u4e00-\u9fa5 ]+:\s*[^\n]+\n)+)\n*/.exec(work);
  const extractedProps = {};
  if (notionHeaderMatch && !work.startsWith('---\n')) {
    const h1Title = notionHeaderMatch[1].replace(/\s+[0-9a-f]{32}$/i, '').trim();
    extractedProps.title = h1Title;
    const propBlock = notionHeaderMatch[2].trim().split('\n');
    for (const line of propBlock) {
      const kv = /^([A-Za-z\u4e00-\u9fa5 ]+):\s*(.+)$/.exec(line.trim());
      if (!kv) continue;
      const k = kv[1].trim().toLowerCase();
      const v = kv[2].trim();
      if (k === 'status' || k === '状态') extractedProps.status = v;
      else if (k === 'tags' || k === '标签') extractedProps.tags = v.split(/[,，]/).map(s => s.trim().replace(/^#+/, '')).filter(Boolean);
      else if (k === 'date' || k === 'created' || k === '日期') extractedProps.date = v.slice(0, 10);
      else extractedProps[k.replace(/\s+/g, '_')] = v;
    }
    work = `# ${h1Title}\n\n` + work.slice(notionHeaderMatch[0].length);
    actions.push('提取 Notion 顶部属性行转换为标准 YAML Frontmatter');
  }

  // 3. Detect Logseq inline properties (`key:: value`) and Logseq outline tasks (`- TODO `, `- DOING `, `- DONE `)
  const lines = work.split('\n');
  const bodyLines = [];
  let logseqPropsExtracted = false;
  let logseqOutlineNormalized = false;
  let logseqTasksConverted = false;

  for (const line of lines) {
    const propMatch = /^\s*(?:-\s+)?([A-Za-z0-9_\u4e00-\u9fa5-]+)::\s*(.+)$/.exec(line);
    if (propMatch) {
      const k = propMatch[1].trim().toLowerCase();
      const v = propMatch[2].trim();
      if (k === 'id' || k === 'collapsed') {
        logseqPropsExtracted = true;
        continue;
      }
      if (k === 'title') extractedProps.title = v;
      else if (k === 'tags') extractedProps.tags = v.split(/[,，\s]+/).map(s => s.replace(/^#+|\[\[|\]\]/g, '').trim()).filter(Boolean);
      else if (k === 'alias' || k === 'aliases') extractedProps.aliases = v.split(/[,，]/).map(s => s.replace(/^\[\[|\]\]$/g, '').trim()).filter(Boolean);
      else if (k === 'status') extractedProps.status = v;
      else extractedProps[k] = v;
      logseqPropsExtracted = true;
      continue;
    }

    let nextLine = line;
    // Convert Logseq `- # Heading` or `- ## Subheading` into standard Markdown headings
    if (/^\s*-\s+(#{1,6}\s+.+)$/.test(nextLine)) {
      nextLine = nextLine.replace(/^\s*-\s+(#{1,6}\s+.+)$/, '$1');
      logseqOutlineNormalized = true;
    }
    // Convert Logseq `- TODO `, `- DOING `, `- DONE `, `- LATER `, `- NOW `
    if (/^(\s*)-\s+(TODO|LATER)\s+(.+)$/.test(nextLine)) {
      nextLine = nextLine.replace(/^(\s*)-\s+(?:TODO|LATER)\s+(.+)$/, '$1- [ ] $2');
      logseqTasksConverted = true;
    } else if (/^(\s*)-\s+(DOING|NOW)\s+(.+)$/.test(nextLine)) {
      nextLine = nextLine.replace(/^(\s*)-\s+(?:DOING|NOW)\s+(.+)$/, '$1- [/] $2');
      logseqTasksConverted = true;
    } else if (/^(\s*)-\s+DONE\s+(.+)$/.test(nextLine)) {
      nextLine = nextLine.replace(/^(\s*)-\s+DONE\s+(.+)$/, '$1- [x] $2');
      logseqTasksConverted = true;
    }

    bodyLines.push(nextLine);
  }

  if (logseqPropsExtracted) actions.push('提取 Logseq `key:: value` 属性并剥离内部块 `id::`');
  if (logseqOutlineNormalized) actions.push('规范化 Logseq 大纲标题（`- # 标题` → `# 标题`）');
  if (logseqTasksConverted) actions.push('转换 Logseq `TODO / DOING / DONE` 为标准 Markdown 任务复选框');

  work = bodyLines.join('\n').trim();

  // 4. Ensure standard YAML Frontmatter with extracted properties
  const existingFm = parseFrontMatter(work);
  if (existingFm.bodyFrom === 0) {
    const titleVal = extractedProps.title || cleanFileTitle || '迁入笔记';
    const tagsArr = Array.isArray(extractedProps.tags) && extractedProps.tags.length ? extractedProps.tags : ['多源迁入'];
    const statusVal = extractedProps.status || '进行中';
    const dateVal = extractedProps.date || today;
    const yamlLines = [
      '---',
      `title: ${titleVal}`,
      `tags: [${tagsArr.join(', ')}]`,
      `status: ${statusVal}`,
      `date: ${dateVal}`,
    ];
    if (Array.isArray(extractedProps.aliases) && extractedProps.aliases.length) {
      yamlLines.push(`aliases: [${extractedProps.aliases.join(', ')}]`);
    }
    yamlLines.push('---', '');
    work = yamlLines.join('\n') + (work.startsWith('# ') ? work : `# ${titleVal}\n\n${work}`) + '\n';
    if (!actions.includes('提取 Notion 顶部属性行转换为标准 YAML Frontmatter')) {
      actions.push('生成标准 YAML Frontmatter');
    }
  }

  // 5. Run standard Obsidian syntax normalization (`%%comment%%`, `==highlight==`, escaped wikilinks)
  const finalNorm = normalizeNoteHealthAndObsidianSyntax(
    { title: extractedProps.title || cleanFileTitle || '迁入笔记', source: (hasBom ? '\uFEFF' : '') + work.replace(/\n/g, newline) },
    { today },
  );
  for (const act of finalNorm.actions) {
    if (!actions.includes(act)) actions.push(act);
  }

  return {
    source: finalNorm.source,
    changed: actions.length > 0 || finalNorm.changed,
    actions,
    extractedProperties: extractedProps,
  };
}

/* ============================================================================
 * MAJOR-310 (3.1.0): Vault-Wide Controlled Regex / Text Search & Replace
 * with Code-Block Isolation, WikiLink Target Protection, YAML Key Rename & Rollback
 * ========================================================================== */

function escapeRegExpLiteral(str = '') {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectProtectedLineSpans(lineText = '', { skipCodeBlocks = true, protectWikiLinkTargets = true } = {}) {
  const spans = [];
  if (skipCodeBlocks) {
    const runs = [...lineText.matchAll(/`+/g)];
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i];
      const backslashes = lineText.slice(0, open.index).match(/\\+$/)?.[0].length || 0;
      if (backslashes % 2 === 1) continue;
      const closeIdx = runs.findIndex((r, pos) => pos > i && r[0].length === open[0].length);
      if (closeIdx >= 0) {
        spans.push([open.index, runs[closeIdx].index + runs[closeIdx][0].length]);
        i = closeIdx;
      }
    }
  }
  if (protectWikiLinkTargets) {
    const linkRe = /!?\[\[([^\][\n]+?)\]\]/g;
    for (const m of lineText.matchAll(linkRe)) {
      const start = m.index;
      const fullEnd = m.index + m[0].length;
      const prefixLen = m[0].startsWith('!') ? 3 : 2;
      const inner = m[1];
      const pipeIdx = inner.indexOf('|');
      if (pipeIdx >= 0) {
        // Protect `![[target#heading|` while allowing the display alias after `|` to be updated if matched
        spans.push([start, start + prefixLen + pipeIdx + 1]);
        spans.push([fullEnd - 2, fullEnd]);
      } else {
        spans.push([start, fullEnd]);
      }
    }
  }
  return spans;
}

function overlapsAnySpan(from, to, spans) {
  for (const [sFrom, sTo] of spans) {
    if (from < sTo && to > sFrom) return true;
  }
  return false;
}

function replaceLineWithProtection(lineText, searchRegex, replacement, protectionOpts) {
  const spans = collectProtectedLineSpans(lineText, protectionOpts);
  let count = 0;
  let result = '';
  let lastIndex = 0;
  searchRegex.lastIndex = 0;

  let match;
  while ((match = searchRegex.exec(lineText)) !== null) {
    if (match[0].length === 0) {
      searchRegex.lastIndex++;
      continue;
    }
    const mFrom = match.index;
    const mTo = mFrom + match[0].length;
    if (overlapsAnySpan(mFrom, mTo, spans)) {
      continue;
    }
    result += lineText.slice(lastIndex, mFrom);
    // Apply standard String.prototype.replace substitution ($1, $&, etc.) on the matched substring
    const singleRe = new RegExp(searchRegex.source, searchRegex.flags.replace('g', ''));
    result += match[0].replace(singleRe, replacement);
    lastIndex = mTo;
    count++;
  }

  if (count === 0) return { changed: false, count: 0, text: lineText };
  result += lineText.slice(lastIndex);
  return { changed: result !== lineText, count, text: result };
}

export function previewVaultSearchAndReplace(notes = [], {
  mode = 'text',
  query = '',
  replacement = '',
  useRegex = false,
  caseSensitive = false,
  folderPrefix = '',
  skipCodeBlocks = true,
  protectWikiLinkTargets = true,
  includeFrontMatter = false,
  createdAt = new Date().toISOString(),
} = {}) {
  const rawQuery = String(query ?? '');
  const rawReplacement = String(replacement ?? '');
  const normalizedFolder = String(folderPrefix || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').trim().toLocaleLowerCase();

  const realNotes = (notes || []).filter(n => {
    if (!n || n.exists === false || n.ghost || typeof n.source !== 'string') return false;
    if (n.metadata?.category === 'whiteboard') return false;
    if (n.source.includes('inkloom-encrypted-v1')) return false;
    if (normalizedFolder) {
      const rel = String(n.relativePath || n.folder || '').replaceAll('\\', '/').toLocaleLowerCase();
      if (!(rel === normalizedFolder || rel.startsWith(normalizedFolder + '/'))) return false;
    }
    return true;
  });

  if (mode === 'yaml-key') {
    const oldKey = rawQuery.trim();
    const newKey = rawReplacement.trim();
    const validKeyRe = /^[A-Za-z0-9_\u4e00-\u9fa5-]+$/;
    if (!oldKey || !validKeyRe.test(oldKey)) {
      throw new Error('原 YAML 属性键名无效（仅支持中英文、数字、下划线或连字符）');
    }
    if (!newKey || !validKeyRe.test(newKey)) {
      throw new Error('新 YAML 属性键名无效（仅支持中英文、数字、下划线或连字符）');
    }
    if (oldKey === newKey) {
      return {
        mode: 'yaml-key',
        totalScannedNotes: realNotes.length,
        matchedNoteCount: 0,
        totalReplacements: 0,
        notePlans: [],
        rollbackSnapshot: { id: `rollback-${createdAt}`, createdAt, entries: [] },
      };
    }

    const notePlans = [];
    let totalReplacements = 0;
    const oldKeyLineRe = new RegExp(`^(\\s*)${escapeRegExpLiteral(oldKey)}(\\s*:\\s*.*)$`);
    const newKeyCheckRe = new RegExp(`^\\s*${escapeRegExpLiteral(newKey)}\\s*:`, 'm');

    for (const note of realNotes) {
      const hasBom = note.source.startsWith('\uFEFF');
      const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
      const clean = (hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n');
      const fm = parseFrontMatter(clean);
      if (fm.bodyFrom === 0) continue;

      const yamlBlock = clean.slice(0, fm.bodyFrom);
      if (newKeyCheckRe.test(yamlBlock)) continue;

      const yamlLines = yamlBlock.split('\n');
      let changedInNote = 0;
      const lineDiffs = [];
      for (let idx = 0; idx < yamlLines.length; idx++) {
        const m = oldKeyLineRe.exec(yamlLines[idx]);
        if (m) {
          const beforeLine = yamlLines[idx];
          const afterLine = `${m[1]}${newKey}${m[2]}`;
          if (afterLine !== beforeLine) {
            yamlLines[idx] = afterLine;
            changedInNote++;
            lineDiffs.push({ lineNum: idx + 1, beforeLine, afterLine });
          }
        }
      }

      if (changedInNote > 0) {
        const nextClean = yamlLines.join('\n') + clean.slice(fm.bodyFrom);
        const nextSource = (hasBom ? '\uFEFF' : '') + (newline === '\r\n' ? nextClean.replaceAll('\n', '\r\n') : nextClean);
        totalReplacements += changedInNote;
        notePlans.push({
          noteId: note.id,
          title: note.cleanTitle || note.title || stripNumericPrefix(note.name || ''),
          relativePath: note.relativePath || note.name || '',
          replacementCount: changedInNote,
          originalSource: note.source,
          nextSource,
          lineDiffs,
        });
      }
    }

    return {
      mode: 'yaml-key',
      totalScannedNotes: realNotes.length,
      matchedNoteCount: notePlans.length,
      totalReplacements,
      notePlans,
      rollbackSnapshot: {
        id: `rollback-${createdAt}`,
        createdAt,
        entries: notePlans.map(p => ({
          noteId: p.noteId,
          title: p.title,
          relativePath: p.relativePath,
          originalSource: p.originalSource,
          afterSource: p.nextSource,
        })),
      },
    };
  }

  // Default mode: 'text' (plain text or regular expression)
  if (!rawQuery) {
    throw new Error('查找词不能为空');
  }
  const flags = caseSensitive ? 'gu' : 'giu';
  let searchRegex;
  try {
    searchRegex = new RegExp(useRegex ? rawQuery : escapeRegExpLiteral(rawQuery), flags);
  } catch (err) {
    throw new Error('正则表达式语法无效：' + err.message);
  }
  if (''.match(searchRegex)?.[0] === '') {
    throw new Error('正则表达式不允许匹配空字符串（避免无限零宽替换）');
  }

  const notePlans = [];
  let totalReplacements = 0;

  for (const note of realNotes) {
    const hasBom = note.source.startsWith('\uFEFF');
    const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
    const clean = (hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n');
    const fm = parseFrontMatter(clean);
    const fmLineCount = (!includeFrontMatter && fm.bodyFrom > 0)
      ? clean.slice(0, fm.bodyFrom).split('\n').length - 1
      : 0;

    const lines = clean.split('\n');
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let noteReplacements = 0;
    const lineDiffs = [];

    for (let i = 0; i < lines.length; i++) {
      if (i < fmLineCount) continue;
      const rawLine = lines[i];
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(rawLine);
      if (fenceMatch) {
        const ch = fenceMatch[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
          fenceLen = fenceMatch[1].length;
        } else if (ch === fenceChar && fenceMatch[1].length >= fenceLen && rawLine.slice(fenceMatch[0].length).trim() === '') {
          inFence = false;
          fenceChar = '';
        }
        if (skipCodeBlocks) continue;
      }
      if (inFence && skipCodeBlocks) continue;

      const replaced = replaceLineWithProtection(rawLine, searchRegex, rawReplacement, {
        skipCodeBlocks,
        protectWikiLinkTargets,
      });
      if (replaced.changed && replaced.count > 0) {
        lines[i] = replaced.text;
        noteReplacements += replaced.count;
        if (lineDiffs.length < 12) {
          lineDiffs.push({
            lineNum: i + 1,
            beforeLine: rawLine,
            afterLine: replaced.text,
          });
        }
      }
    }

    if (noteReplacements > 0) {
      const nextClean = lines.join('\n');
      const nextSource = (hasBom ? '\uFEFF' : '') + (newline === '\r\n' ? nextClean.replaceAll('\n', '\r\n') : nextClean);
      if (nextSource !== note.source) {
        totalReplacements += noteReplacements;
        notePlans.push({
          noteId: note.id,
          title: note.cleanTitle || note.title || stripNumericPrefix(note.name || ''),
          relativePath: note.relativePath || note.name || '',
          replacementCount: noteReplacements,
          originalSource: note.source,
          nextSource,
          lineDiffs,
        });
      }
    }
  }

  return {
    mode: 'text',
    totalScannedNotes: realNotes.length,
    matchedNoteCount: notePlans.length,
    totalReplacements,
    notePlans,
    rollbackSnapshot: {
      id: `rollback-${createdAt}`,
      createdAt,
      entries: notePlans.map(p => ({
        noteId: p.noteId,
        title: p.title,
        relativePath: p.relativePath,
        originalSource: p.originalSource,
        afterSource: p.nextSource,
      })),
    },
  };
}
