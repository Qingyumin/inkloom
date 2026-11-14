const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function buildVaultTree(notes, { query = '', tag = '', folders = [], sortBy = 'name-asc' } = {}) {
  const root = { type: 'folder', path: '', name: '', children: [], count: 0, latestDate: '' }; const directoryMap = new Map([['', root]]);
  const directory = path => {
    if (directoryMap.has(path)) return directoryMap.get(path);
    const parts = path.split('/'); const name = parts.pop(); const parent = directory(parts.join('/'));
    const value = { type: 'folder', path, name, children: [], count: 0, latestDate: '' }; parent.children.push(value); directoryMap.set(path, value); return value;
  };
  const search = query.trim().toLocaleLowerCase();
  if (!search && !tag) for (const folder of folders) if (typeof folder === 'string' && folder && !folder.split(/[\\/]/).includes('..')) directory(folder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''));
  for (const note of notes) {
    const path = String(note.relativePath || note.name || '').replaceAll('\\', '/').replace(/^\.\//, '');
    if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '..')) continue;
    if (tag && !(note.tags || []).includes(tag)) continue;
    if (search && ![note.title, note.cleanTitle, note.name, path, ...(note.tags || []).map(value => '#' + value), ...(note.aliases || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)) continue;
    const parts = path.split('/'); const name = parts.pop(); const parent = directory(parts.join('/'));
    const noteDate = String(note.date || note.metadata?.date || '');
    parent.children.push({ type: 'note', id: note.id, name, path, note, noteDate });
  }
  const summarize = folder => {
    let maxDate = '';
    let subfolderCount = 0;
    folder.count = folder.children.reduce((total, child) => {
      if (child.type === 'folder') {
        const subCount = summarize(child);
        subfolderCount += 1 + (child.subfolderCount || 0);
        if (child.latestDate > maxDate) maxDate = child.latestDate;
        return total + subCount;
      }
      if (child.noteDate > maxDate) maxDate = child.noteDate;
      return total + 1;
    }, 0);
    folder.subfolderCount = subfolderCount;
    folder.latestDate = maxDate;
    folder.children.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
      if (sortBy === 'name-desc') return collator.compare(right.name, left.name);
      if (sortBy === 'date-desc') {
        const dLeft = left.type === 'folder' ? (left.latestDate || '') : (left.noteDate || '');
        const dRight = right.type === 'folder' ? (right.latestDate || '') : (right.noteDate || '');
        if (dLeft !== dRight) return dRight.localeCompare(dLeft);
        return collator.compare(left.name, right.name);
      }
      if (sortBy === 'starred-first' && left.type === 'note' && right.type === 'note') {
        const sDiff = Number(Boolean(right.note?.starred)) - Number(Boolean(left.note?.starred));
        if (sDiff !== 0) return sDiff;
      }
      return collator.compare(left.name, right.name);
    });
    return folder.count;
  };
  summarize(root); return root;
}

export function normalizeTreeFolderPath(folderPath = '') {
  return String(folderPath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function extractAllFolderPaths(treeOrFolders) {
  const paths = new Set();
  if (!treeOrFolders) return [];
  if (Array.isArray(treeOrFolders) || treeOrFolders instanceof Set) {
    for (const raw of treeOrFolders) {
      const clean = normalizeTreeFolderPath(raw);
      if (!clean) continue;
      const parts = clean.split('/');
      for (let i = 1; i <= parts.length; i++) {
        paths.add(parts.slice(0, i).join('/'));
      }
    }
  } else if (typeof treeOrFolders === 'object' && Array.isArray(treeOrFolders.children)) {
    const walk = node => {
      if (node.type === 'folder' && node.path) paths.add(normalizeTreeFolderPath(node.path));
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child.type === 'folder') walk(child);
        }
      }
    };
    walk(treeOrFolders);
  }
  return [...paths].sort((a, b) => {
    const depthDiff = a.split('/').length - b.split('/').length;
    return depthDiff !== 0 ? depthDiff : collator.compare(a, b);
  });
}

export function collectDescendantFolderPaths(treeOrFolders, targetFolderPath = '') {
  const cleanTarget = normalizeTreeFolderPath(targetFolderPath);
  const allFolders = extractAllFolderPaths(treeOrFolders);
  if (!cleanTarget) {
    const maxRelativeDepth = allFolders.reduce((max, p) => Math.max(max, p.split('/').length), 0);
    return {
      targetFolderPath: '',
      selfAndDescendants: allFolders,
      descendantsOnly: allFolders,
      maxRelativeDepth,
      hasSubfolders: allFolders.length > 0,
    };
  }
  const prefix = `${cleanTarget}/`;
  const descendantsOnly = allFolders.filter(path => path.startsWith(prefix));
  const selfAndDescendants = [cleanTarget, ...descendantsOnly];
  const baseDepth = cleanTarget.split('/').length;
  const maxRelativeDepth = descendantsOnly.reduce(
    (max, p) => Math.max(max, p.split('/').length - baseDepth),
    0,
  );
  return {
    targetFolderPath: cleanTarget,
    selfAndDescendants,
    descendantsOnly,
    maxRelativeDepth,
    hasSubfolders: descendantsOnly.length > 0,
  };
}

export function isFolderRecursivelyExpanded(treeOrFolders, targetFolderPath = '', collapsed = []) {
  const closed = collapsed instanceof Set ? collapsed : new Set(Array.isArray(collapsed) ? collapsed.map(normalizeTreeFolderPath) : []);
  const { selfAndDescendants } = collectDescendantFolderPaths(treeOrFolders, targetFolderPath);
  if (!selfAndDescendants.length) return true;
  return selfAndDescendants.every(folderPath => !closed.has(folderPath));
}

export function applyRecursiveFolderExpansion(collapsed = [], treeOrFolders = [], targetFolderPath = '', mode = 'toggle') {
  const next = new Set(Array.isArray(collapsed) ? collapsed.map(normalizeTreeFolderPath).filter(Boolean) : []);
  const cleanTarget = normalizeTreeFolderPath(targetFolderPath);
  const { selfAndDescendants, descendantsOnly, maxRelativeDepth } = collectDescendantFolderPaths(treeOrFolders, cleanTarget);
  const currentlyFullyExpanded = selfAndDescendants.length > 0 && selfAndDescendants.every(folderPath => !next.has(folderPath));
  const resolvedMode = mode === 'toggle'
    ? (currentlyFullyExpanded ? 'collapse-all' : 'expand-all')
    : mode;

  if (resolvedMode === 'expand-all') {
    for (const folderPath of selfAndDescendants) {
      next.delete(folderPath);
    }
    if (cleanTarget) {
      const ancestorParts = cleanTarget.split('/');
      for (let i = 1; i < ancestorParts.length; i++) {
        next.delete(ancestorParts.slice(0, i).join('/'));
      }
    }
  } else if (resolvedMode === 'collapse-all') {
    for (const folderPath of selfAndDescendants) {
      next.add(folderPath);
    }
  }

  return {
    collapsed: [...next],
    expanded: resolvedMode === 'expand-all',
    mode: resolvedMode,
    targetFolderPath: cleanTarget,
    affectedFolders: selfAndDescendants,
    subfolderCount: descendantsOnly.length,
    maxRelativeDepth,
  };
}

export function flattenVaultTree(root, { collapsed = [], revealId = null, filtering = false, limit = 200 } = {}) {
  const closed = new Set(collapsed); const revealPaths = new Set(); const rows = []; let noteCount = 0; let hasMore = false;
  const find = folder => {
    for (const child of folder.children) {
      if ((child.type === 'note' && child.id === revealId) || (child.type === 'folder' && find(child))) { revealPaths.add(folder.path); return true; }
    }
    return false;
  };
  if (revealId) find(root);
  const checkAllExpanded = folder => {
    const selfOpen = filtering || !closed.has(folder.path) || revealPaths.has(folder.path);
    if (!selfOpen) return false;
    for (const child of folder.children) {
      if (child.type === 'folder' && !checkAllExpanded(child)) return false;
    }
    return true;
  };
  const visit = (folder, depth) => {
    for (const child of folder.children) {
      if (noteCount >= limit || rows.length >= limit * 4 + 100) { hasMore = true; break; }
      if (child.type === 'folder') {
        const expanded = filtering || !closed.has(child.path) || revealPaths.has(child.path);
        const allDescendantsExpanded = checkAllExpanded(child);
        rows.push({
          ...child,
          depth,
          expanded,
          allDescendantsExpanded,
          subfolderCount: child.subfolderCount || 0,
          parent: folder.path,
        });
        if (expanded) visit(child, depth + 1);
      } else { rows.push({ ...child, depth, parent: folder.path }); noteCount++; }
    }
  };
  visit(root, 0); return { rows, shownNotes: noteCount, totalNotes: root.count, hasMore };
}

export function buildNoteHeadingMindmapTree(note = {}) {
  const source = String(note.source || '');
  const title = String(note.cleanTitle || note.title || note.name || '未命名笔记').replace(/\.(md|markdown)$/i, '');
  const root = {
    id: `note-root:${note.id || title}`,
    label: title,
    kind: 'note-root',
    noteId: note.id || '',
    depth: 0,
    line: 1,
    wikiLinks: [],
    children: [],
  };
  const stack = [root];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let inFrontMatter = false;
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (line.trim() === '---' || line.trim() === '...') inFrontMatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const headingMatch = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target).trim();
      const normHeading = rawText.replace(/[\s_-]+/g, '').toLowerCase();
      const normTitle = title.replace(/[\s_-]+/g, '').toLowerCase();
      if (level === 1 && normHeading === normTitle && root.children.length === 0) continue;
      const wikiLinks = [...headingMatch[2].matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)].map(m => ({
        target: m[1].trim(),
        label: (m[2] || m[1]).trim(),
      }));
      const node = {
        id: `heading:${i + 1}`,
        label: rawText.slice(0, 48),
        kind: `h${level}`,
        depth: level,
        line: i + 1,
        wikiLinks,
        children: [],
      };
      while (stack.length > 1 && stack[stack.length - 1].depth >= level) {
        stack.pop();
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    const wikiMatches = [...line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)];
    if (wikiMatches.length > 0 && stack.length > 0) {
      const parent = stack[stack.length - 1];
      for (const m of wikiMatches.slice(0, 4)) {
        const target = m[1].trim();
        const label = (m[2] || m[1]).trim();
        if (!parent.children.some(c => c.kind === 'wikilink' && c.target === target)) {
          parent.children.push({
            id: `wikilink:${i + 1}:${target}`,
            label: `[[${label.slice(0, 32)}]]`,
            kind: 'wikilink',
            target,
            depth: parent.depth + 1,
            line: i + 1,
            children: [],
          });
        }
      }
    }
  }
  return root;
}

export function buildFolderHierarchyMindmapTree(vaultTree, targetFolderPath = '') {
  const cleanTarget = normalizeTreeFolderPath(targetFolderPath);
  let startNode = vaultTree;
  if (cleanTarget && vaultTree && Array.isArray(vaultTree.children)) {
    const findFolder = node => {
      if (node.type === 'folder' && normalizeTreeFolderPath(node.path) === cleanTarget) return node;
      for (const child of node.children || []) {
        if (child.type === 'folder') {
          const hit = findFolder(child);
          if (hit) return hit;
        }
      }
      return null;
    };
    startNode = findFolder(vaultTree) || vaultTree;
  }
  const convert = (node, depth = 0) => {
    if (node.type === 'note') {
      const cleanName = String(node.note?.cleanTitle || node.name || '').replace(/\.(md|markdown)$/i, '');
      return {
        id: `mindmap-note:${node.id}`,
        label: cleanName.slice(0, 42),
        kind: 'note',
        noteId: node.id,
        path: node.path,
        depth,
        children: [],
      };
    }
    const label = node.name || (cleanTarget ? cleanTarget.split('/').pop() : '知识库根目录');
    const children = (node.children || []).slice(0, 36).map(child => convert(child, depth + 1));
    return {
      id: `mindmap-folder:${node.path || 'root'}`,
      label: `${label} (${node.count || 0})`,
      kind: 'folder',
      path: node.path || '',
      count: node.count || 0,
      subfolderCount: node.subfolderCount || 0,
      depth,
      children,
    };
  };
  return convert(startNode, 0);
}

export function renderMindmapTreeSvg(mindmapRoot, { collapsedNodeIds = [] } = {}) {
  const collapsed = new Set(Array.isArray(collapsedNodeIds) ? collapsedNodeIds : []);
  const nodes = [];
  const edges = [];
  const colWidth = 228;
  const rowHeight = 38;
  let leafIndex = 0;
  let maxDepth = 0;

  const layout = (node, depth = 0) => {
    maxDepth = Math.max(maxDepth, depth);
    const isCollapsed = collapsed.has(node.id);
    const visibleChildren = isCollapsed ? [] : (node.children || []);
    if (!visibleChildren.length) {
      const y = leafIndex * rowHeight + 36;
      leafIndex += 1;
      const item = { ...node, depth, x: depth * colWidth + 24, y, collapsed: isCollapsed, totalChildren: (node.children || []).length };
      nodes.push(item);
      return item;
    }
    const childItems = visibleChildren.map(child => layout(child, depth + 1));
    const y = (childItems[0].y + childItems[childItems.length - 1].y) / 2;
    const item = { ...node, depth, x: depth * colWidth + 24, y, collapsed: isCollapsed, totalChildren: (node.children || []).length };
    nodes.push(item);
    for (const childItem of childItems) {
      edges.push({ from: item, to: childItem });
    }
    return item;
  };

  if (mindmapRoot) layout(mindmapRoot, 0);
  const width = Math.max(640, (maxDepth + 1) * colWidth + 180);
  const height = Math.max(260, leafIndex * rowHeight + 56);
  const esc = str => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const edgePaths = edges.map(({ from, to }) => {
    const x1 = from.x + 168;
    const y1 = from.y;
    const x2 = to.x;
    const y2 = to.y;
    const cx = (x1 + x2) / 2;
    return `<path class="mindmap-edge" d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.5"/>`;
  }).join('');

  const nodeGroups = nodes.map(node => {
    const labelText = node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label;
    const isFolder = node.kind === 'folder' || node.kind === 'note-root';
    const isWikiLink = node.kind === 'wikilink';
    const badge = node.totalChildren > 0 ? (node.collapsed ? `+${node.totalChildren}` : `${node.totalChildren}`) : '';
    const dataAttrs = [
      `data-mindmap-node-id="${esc(node.id)}"`,
      node.noteId ? `data-mindmap-note-id="${esc(node.noteId)}"` : '',
      node.path !== undefined ? `data-mindmap-folder="${esc(node.path)}"` : '',
      node.target ? `data-mindmap-wikilink="${esc(node.target)}"` : '',
    ].filter(Boolean).join(' ');
    return `<g class="mindmap-node is-${esc(node.kind)}" transform="translate(${node.x}, ${node.y - 14})" ${dataAttrs}>
      <rect width="168" height="28" rx="6" class="mindmap-node-box" fill="${isFolder ? 'rgba(43, 49, 58, 0.08)' : isWikiLink ? 'rgba(20, 110, 90, 0.09)' : 'rgba(255, 255, 255, 0.86)'}" stroke="currentColor" stroke-opacity="0.22" stroke-width="1"/>
      <text x="10" y="18" font-size="11.5" fill="currentColor" class="mindmap-node-label">${esc(labelText)}</text>
      ${badge ? `<text x="158" y="18" font-size="10" text-anchor="end" fill="currentColor" opacity="0.65">${esc(badge)}</text>` : ''}
    </g>`;
  }).join('');

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" class="inkloom-mindmap-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="知识大纲与目录层级思维导图">${edgePaths}${nodeGroups}</svg>`,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    maxDepth,
    width,
    height,
  };
}

export function collectBlockReferenceBacklinks(notes = []) {
  const definitions = new Map();
  const references = [];
  for (const note of notes) {
    const source = String(note.source || '');
    const title = String(note.cleanTitle || note.title || note.name || '').replace(/\.(md|markdown)$/i, '');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const defMatch = /\s\^([A-Za-z0-9_-]{3,40})\s*$/.exec(line);
      if (defMatch) {
        const blockId = defMatch[1];
        const excerpt = line.replace(/\s\^[A-Za-z0-9_-]{3,40}\s*$/, '').trim();
        definitions.set(`${title.toLowerCase()}#^${blockId.toLowerCase()}`, {
          noteId: note.id,
          noteTitle: title,
          relativePath: note.relativePath || note.name || '',
          blockId,
          line: i + 1,
          excerpt,
        });
      }
      const refRegex = /(!?)\[\[([^\]|#]+)#\^([A-Za-z0-9_-]{3,40})(?:\|([^\]]+))?\]\]/g;
      let match;
      while ((match = refRegex.exec(line)) !== null) {
        references.push({
          fromNoteId: note.id,
          fromNoteTitle: title,
          targetNote: match[2].trim(),
          blockId: match[3].trim(),
          alias: (match[4] || '').trim(),
          isEmbed: match[1] === '!',
          line: i + 1,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  return {
    definitions: [...definitions.values()],
    references,
  };
}