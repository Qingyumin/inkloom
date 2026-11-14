import { queryVaultDatabase } from './vault-graph.mjs';
import { countNoteWords } from './research-notes.mjs';

const completedStatuses = new Set(['已完成', '已读', '已就绪', 'done', 'Done']);
const reservedPropertyKeys = new Set(['title', 'status', 'tags', 'date', 'aliases']);
const builtInDerivedKeys = ['formula:task_progress', 'formula:word_progress', 'formula:word_count', 'rollup:project_notes', 'rollup:backlinks'];
const defaultPropertyKeys = [...builtInDerivedKeys, 'category', 'project', 'priority', 'target_words', 'author', 'year'];
const validPropertyKey = value => typeof value === 'string' && /^(?:(?:formula|rollup):[a-z_]{1,32}|[A-Za-z0-9_\u4e00-\u9fa5-]{1,48})$/.test(value);

const defaultSavedViews = [
  {
    id: 'all-notes',
    name: '全部笔记',
    builtin: true,
    mode: 'table',
    query: '',
    folder: '',
    tag: '',
    status: '',
    groupBy: '',
    propertyKey: '',
    propertyValue: '',
    sortBy: 'title',
    sortDir: 'asc',
  },
  {
    id: 'active-projects',
    name: '进行中项目',
    builtin: false,
    mode: 'board',
    query: '',
    folder: '',
    tag: '',
    status: '进行中',
    groupBy: 'project',
    propertyKey: 'formula:task_progress',
    propertyValue: '',
    sortBy: 'property',
    sortDir: 'desc',
  },
  {
    id: 'reading-sources',
    name: '待读文献',
    builtin: false,
    mode: 'table',
    query: '',
    folder: '',
    tag: 'research',
    status: '待读',
    groupBy: 'status',
    propertyKey: 'author',
    propertyValue: '',
    sortBy: 'date',
    sortDir: 'desc',
  },
];

function sanitizeViewPreset(raw = {}, index = 0) {
  const id = String(raw.id || `view-${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || `view-${index + 1}`;
  const isAll = id === 'all-notes';
  const name = isAll ? '全部笔记' : String(raw.name || '未命名视图').replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || '未命名视图';
  const mode = raw.mode === 'board' ? 'board' : 'table';
  const sortBy = ['title', 'date', 'status', 'degree', 'tasks', 'property'].includes(raw.sortBy) ? raw.sortBy : 'title';
  const sortDir = raw.sortDir === 'desc' ? 'desc' : 'asc';
  const propertyKey = validPropertyKey(raw.propertyKey) ? raw.propertyKey : '';
  const groupBy = typeof raw.groupBy === 'string' && (/^(status|folder|category|project)$/.test(raw.groupBy) || /^[A-Za-z0-9_\u4e00-\u9fa5-]{1,48}$/.test(raw.groupBy)) ? raw.groupBy : '';
  return {
    id,
    name,
    builtin: isAll,
    mode,
    query: isAll ? '' : String(raw.query || '').slice(0, 160),
    folder: isAll ? '' : String(raw.folder || '').slice(0, 240),
    tag: isAll ? '' : String(raw.tag || '').slice(0, 120),
    status: isAll ? '' : String(raw.status || '').slice(0, 80),
    groupBy: isAll ? '' : groupBy,
    propertyKey: isAll ? '' : propertyKey,
    propertyValue: isAll || !propertyKey ? '' : String(raw.propertyValue || '').slice(0, 160),
    sortBy: isAll ? 'title' : sortBy,
    sortDir: isAll ? 'asc' : sortDir,
  };
}

export function normalizeSavedDatabaseViews(rawViews) {
  if (!Array.isArray(rawViews) || !rawViews.length) {
    return defaultSavedViews.map((item, idx) => sanitizeViewPreset(item, idx));
  }
  const seen = new Set();
  const result = [];
  for (const [idx, entry] of rawViews.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const clean = sanitizeViewPreset(entry, idx);
    if (seen.has(clean.id)) continue;
    seen.add(clean.id);
    result.push(clean);
    if (result.length >= 24) break;
  }
  if (!seen.has('all-notes')) {
    result.unshift(sanitizeViewPreset(defaultSavedViews[0], 0));
  }
  return result;
}

export function saveDatabaseViewPreset(rawViews, preset = {}) {
  const name = String(preset.name || '').replace(/[\r\n]+/g, ' ').trim();
  if (!name || name.length > 40) throw new Error('请输入 1 至 40 字符的视图预设名称');
  const current = normalizeSavedDatabaseViews(rawViews);
  const existingIdx = current.findIndex(v => (preset.id && v.id === preset.id && v.id !== 'all-notes') || (v.name === name && v.id !== 'all-notes'));
  const targetId = existingIdx >= 0
    ? current[existingIdx].id
    : `view-${name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18) || 'custom'}-${Date.now().toString(36).slice(-4)}`;
  const entry = sanitizeViewPreset({ ...preset, id: targetId, name }, current.length);
  const next = [...current];
  if (existingIdx >= 0) next[existingIdx] = entry;
  else next.push(entry);
  return { views: next, savedView: entry };
}

export function renameDatabaseViewPreset(rawViews, viewId, newName) {
  if (!viewId || viewId === 'all-notes') throw new Error('默认「全部笔记」视图不可重命名');
  const cleanName = String(newName || '').replace(/[\r\n]+/g, ' ').trim();
  if (!cleanName || cleanName.length > 40) throw new Error('请输入 1 至 40 字符的新视图名称');
  const current = normalizeSavedDatabaseViews(rawViews);
  const idx = current.findIndex(v => v.id === viewId);
  if (idx < 0) throw new Error('未找到要重命名的视图页签');
  const next = current.map((v, i) => (i === idx ? { ...v, name: cleanName } : v));
  return { views: next, renamedView: next[idx] };
}

export function deleteDatabaseViewPreset(rawViews, viewId) {
  if (!viewId || viewId === 'all-notes') throw new Error('默认「全部笔记」视图不可删除');
  const current = normalizeSavedDatabaseViews(rawViews);
  const next = current.filter(v => v.id !== viewId);
  return { views: next, activeViewId: 'all-notes' };
}

export function reorderDatabaseViewPresets(rawViews, fromId, toId) {
  const current = normalizeSavedDatabaseViews(rawViews);
  if (!fromId || !toId || fromId === toId) return current;
  const fromIdx = current.findIndex(v => v.id === fromId);
  const toIdx = current.findIndex(v => v.id === toId);
  if (fromIdx < 0 || toIdx < 0) return current;
  const next = [...current];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function recordMruVisit(mruStack = [], entry = {}, maxItems = 12) {
  const list = Array.isArray(mruStack) ? mruStack.filter(item => item && typeof item === 'object') : [];
  if (!entry || typeof entry !== 'object') return list.slice(0, maxItems);
  const kind = entry.kind === 'raw' ? 'raw' : 'note';
  let normalized = null;
  if (kind === 'raw') {
    const relativePath = String(entry.relativePath || '').replaceAll('\\', '/').trim();
    if (!relativePath) return list.slice(0, maxItems);
    const title = String(entry.title || relativePath.split('/').pop() || '原件').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    const isPdf = /\.pdf$/i.test(relativePath);
    const page = Number.isInteger(Number(entry.page)) && Number(entry.page) >= 1 ? Number(entry.page) : 1;
    const cfi = String(entry.cfi || '').trim().slice(0, 240);
    const key = `raw:${relativePath.toLowerCase()}`;
    const label = isPdf ? `${title} · 第 ${page} 页` : `${title} · ${cfi || '第 1 章'}`;
    normalized = {
      key,
      kind: 'raw',
      relativePath,
      title,
      page: isPdf ? page : undefined,
      cfi: !isPdf ? (cfi || 'epubcfi(/6/2!/4/2/1:0)') : undefined,
      label,
      subtitle: `最近精读原件 · ${relativePath}`,
      visitedAt: entry.visitedAt || new Date().toISOString(),
    };
  } else {
    const noteId = String(entry.noteId || '').trim();
    if (!noteId) return list.slice(0, maxItems);
    const title = String(entry.title || noteId).replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    const folder = String(entry.folder || '根目录').trim().slice(0, 160);
    const heading = String(entry.heading || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    const key = `note:${noteId}:${heading.toLowerCase()}`;
    const label = heading ? `${title} # ${heading}` : title;
    normalized = {
      key,
      kind: 'note',
      noteId,
      title,
      folder,
      heading,
      label,
      subtitle: heading ? `最近访问章节 · ${folder}` : `最近访问笔记 · ${folder}`,
      visitedAt: entry.visitedAt || new Date().toISOString(),
    };
  }
  const filtered = list.filter(item => item.key !== normalized.key);
  return [normalized, ...filtered].slice(0, Math.max(1, Number(maxItems) || 12));
}

export function computeBatchTagPatch(existingTags = [], { addTag = '', removeTag = '' } = {}) {
  const cleanTag = raw => String(raw || '').replace(/^#+/, '').replace(/[\s\[\]#|,\r\n]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const toAdd = cleanTag(addTag);
  const toRemove = cleanTag(removeTag);
  const current = Array.isArray(existingTags)
    ? existingTags.map(t => cleanTag(t)).filter(Boolean)
    : [];
  const seen = new Set();
  const next = [];
  for (const tag of current) {
    if (toRemove && tag.toLowerCase() === toRemove.toLowerCase()) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    next.push(tag);
  }
  if (toAdd && !seen.has(toAdd.toLowerCase())) {
    next.push(toAdd);
  }
  return next;
}

export function resolveShiftRangeIds(orderedIds = [], anchorId = '', targetId = '') {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return targetId ? [targetId] : [];
  const tIdx = orderedIds.indexOf(targetId);
  if (tIdx < 0) return targetId ? [targetId] : [];
  const aIdx = orderedIds.indexOf(anchorId);
  if (aIdx < 0) return [targetId];
  const start = Math.min(aIdx, tIdx);
  const end = Math.max(aIdx, tIdx);
  return orderedIds.slice(start, end + 1);
}

function extractNoteProperties(note) {
  const map = {};
  for (const [key, value] of Object.entries(note.metadata || {})) {
    if (reservedPropertyKeys.has(key) || value === null || value === undefined || typeof value === 'object') continue;
    map[key] = String(value).slice(0, 240);
  }
  for (const entry of note.properties || []) {
    if (!entry?.key || reservedPropertyKeys.has(entry.key)) continue;
    map[entry.key] = String(entry.value ?? '').slice(0, 240);
  }
  return map;
}

export function queryDatabasePage(graph, options = {}) {
  const pageSize = [10, 25, 50, 100].includes(Number(options.pageSize)) ? Number(options.pageSize) : 50;
  const propertyKey = validPropertyKey(options.propertyKey) ? options.propertyKey : '';
  const isDerivedProperty = propertyKey.startsWith('formula:') || propertyKey.startsWith('rollup:');
  const propertyFilter = String(options.propertyValue || '').trim().toLocaleLowerCase();
  const groupBy = typeof options.groupBy === 'string' && (/^(status|folder|category|project)$/.test(options.groupBy) || /^[A-Za-z0-9_\u4e00-\u9fa5-]{1,48}$/.test(options.groupBy)) ? options.groupBy : '';
  const baseSort = ['title', 'date', 'status', 'degree'].includes(options.sortBy) ? options.sortBy : 'degree';
  const result = queryVaultDatabase(graph, { ...options, sortBy: baseSort });

  const projectTitles = new Map();
  const projectLinkedNotes = new Map();
  const discoveredKeys = new Set(defaultPropertyKeys);
  for (const note of graph?.notes || []) {
    if (note.metadata?.category === 'project') projectTitles.set(note.id, note.title);
    const props = extractNoteProperties(note);
    if (props.project) projectLinkedNotes.set(props.project, (projectLinkedNotes.get(props.project) || 0) + 1);
    for (const key of Object.keys(props)) {
      if (/^[A-Za-z0-9_\u4e00-\u9fa5-]{1,48}$/.test(key)) discoveredKeys.add(key);
    }
  }
  const customKeys = [...discoveredKeys].filter(key => !builtInDerivedKeys.includes(key)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const propertyKeys = [...builtInDerivedKeys, ...customKeys].slice(0, 100);

  const enriched = result.rows.map(note => {
    const properties = extractNoteProperties(note);
    const category = String(note.metadata?.category || properties.category || '');
    if (category) properties.category = category;
    const project = String(properties.project || (category === 'project' ? note.id : ''));
    const projectTitle = project ? (projectTitles.get(project) || project) : '';
    const tasks = note.tasks || [];
    const taskCount = tasks.length;
    const taskDone = tasks.filter(task => task.done).length;
    const wordCount = countNoteWords(graph?.nodeMap?.get(note.id)?.source ?? note.source ?? note.excerpt ?? '');
    const targetWords = Number(properties.target_words) || 0;
    const taskProgress = taskCount ? Math.round((taskDone / taskCount) * 100) : 0;
    const wordProgress = targetWords > 0 ? Math.round((wordCount / targetWords) * 100) : 0;
    const rollupNotes = category === 'project' ? (projectLinkedNotes.get(note.id) || 0) : (project ? (projectLinkedNotes.get(project) || 0) : 0);
    const backlinkCount = Number(note.inDegree ?? graph?.backlinksByNote?.get?.(note.id)?.length ?? 0);
    let rawProp = '';
    if (propertyKey === 'formula:task_progress') rawProp = String(taskProgress);
    else if (propertyKey === 'formula:word_progress') rawProp = String(wordProgress);
    else if (propertyKey === 'formula:word_count') rawProp = String(wordCount);
    else if (propertyKey === 'rollup:project_notes') rawProp = String(rollupNotes);
    else if (propertyKey === 'rollup:backlinks') rawProp = String(backlinkCount);
    else if (propertyKey) rawProp = propertyKey === 'project' ? project : (properties[propertyKey] ?? '');
    return { note, properties, category, project, projectTitle, taskCount, taskDone, wordCount, taskProgress, wordProgress, rollupNotes, backlinkCount, propertyValue: String(rawProp), isDerivedProperty };
  }).filter(item => {
    if (!propertyKey || !propertyFilter) return true;
    const hay = (item.propertyValue + ' ' + (propertyKey === 'project' ? item.projectTitle : '')).toLocaleLowerCase();
    return hay.includes(propertyFilter);
  });

  const dir = options.sortDir === 'asc' ? 1 : -1;
  if (options.sortBy === 'tasks') {
    enriched.sort((a, b) => dir * (a.taskCount - b.taskCount || a.taskDone - b.taskDone) || a.note.title.localeCompare(b.note.title, 'zh-CN'));
  } else if (options.sortBy === 'property' && propertyKey) {
    enriched.sort((a, b) => {
      const na = Number(a.propertyValue); const nb = Number(b.propertyValue);
      if (a.propertyValue.trim() !== '' && b.propertyValue.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return dir * (na - nb) || a.note.title.localeCompare(b.note.title, 'zh-CN');
      return dir * a.propertyValue.localeCompare(b.propertyValue, 'zh-CN') || a.note.title.localeCompare(b.note.title, 'zh-CN');
    });
  }

  let completed = 0; let totalTasks = 0; let doneTasks = 0;
  let numericCount = 0; let numericSum = 0;
  const groupsMap = new Map();

  for (const item of enriched) {
    const isCompleted = completedStatuses.has(item.note.status || '');
    if (isCompleted) completed++;
    totalTasks += item.taskCount;
    doneTasks += item.taskDone;
    const num = propertyKey && item.propertyValue.trim() !== '' ? Number(item.propertyValue) : NaN;
    const hasNum = Number.isFinite(num);
    if (hasNum) { numericCount++; numericSum += num; }
    if (groupBy) {
      let groupKey = ''; let groupLabel = '';
      if (groupBy === 'status') { groupKey = item.note.status || '未设状态'; groupLabel = groupKey; }
      else if (groupBy === 'folder') { groupKey = item.note.folder || '根目录'; groupLabel = groupKey; }
      else if (groupBy === 'category') { groupKey = item.category || '未分类'; groupLabel = groupKey; }
      else if (groupBy === 'project') { groupKey = item.project || '无项目'; groupLabel = item.projectTitle || '无项目'; }
      else { groupKey = item.properties[groupBy] || '未设置'; groupLabel = groupKey; }
      if (!groupsMap.has(groupKey)) groupsMap.set(groupKey, { key: groupKey, label: groupLabel, count: 0, completedCount: 0, taskCount: 0, taskDone: 0, numericCount: 0, numericSum: 0 });
      const group = groupsMap.get(groupKey);
      group.count++;
      if (isCompleted) group.completedCount++;
      group.taskCount += item.taskCount;
      group.taskDone += item.taskDone;
      if (hasNum) { group.numericCount++; group.numericSum += num; }
    }
  }

  const groups = [...groupsMap.values()].map(group => ({
    ...group,
    numericAverage: group.numericCount ? Math.round((group.numericSum / group.numericCount) * 100) / 100 : null,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  const total = enriched.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Math.floor(Number(options.pageIndex));
  const pageIndex = Math.min(pageCount - 1, Math.max(0, Number.isFinite(requested) ? requested : 0));
  const rows = enriched.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map(({ note, properties, category, project, projectTitle, taskCount, taskDone, wordCount, taskProgress, wordProgress, rollupNotes, backlinkCount, propertyValue, isDerivedProperty }) => ({
    id: note.id, name: note.name, title: note.title, folder: note.folder, tags: [...note.tags],
    status: note.status, date: note.date, degree: note.degree,
    category, project, projectTitle, taskCount, taskDone, wordCount, taskProgress, wordProgress, rollupNotes, backlinkCount, propertyValue, isDerivedProperty, properties,
  }));
  const matchedIds = new Set(enriched.map(item => item.note.id));
  const byId = new Map(rows.map(row => [row.id, row]));
  return {
    rows, total, pageIndex, pageSize, pageCount,
    columns: result.columns.map(column => {
      const matchedItems = column.items.filter(note => matchedIds.has(note.id));
      return { status: column.status, count: matchedItems.length, items: matchedItems.filter(note => byId.has(note.id)).map(note => byId.get(note.id)) };
    }),
    folders: result.folders, tags: result.tags, statuses: result.statuses,
    propertyKeys, propertyKey, isDerivedProperty, groupBy, groups,
    summary: {
      total,
      completed,
      taskCount: totalTasks,
      taskDone: doneTasks,
      numericCount,
      numericSum: Math.round(numericSum * 100) / 100,
      numericAverage: numericCount ? Math.round((numericSum / numericCount) * 100) / 100 : null,
    },
  };
}

function escapeCsvCell(value = '') {
  const str = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvRows(csvText = '') {
  const lines = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  return lines.map(line => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === '\t') && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

/**
 * MAJOR-270 (2.7.0): Export Database View Rows to RFC 4180 CSV & Markdown Summary Note,
 * and Parse CSV Property Batch Updates.
 */
export function exportDatabaseRowsToCsv(rows = [], { propertyKey = '' } = {}) {
  const cleanPropKey = validPropertyKey(propertyKey) ? propertyKey : '';
  const headers = [
    'id',
    'title',
    'folder',
    'status',
    'tags',
    'date',
    'taskDone',
    'taskCount',
    'wordCount',
    'degree',
    ...(cleanPropKey ? [cleanPropKey] : []),
  ];
  const csvLines = [headers.map(escapeCsvCell).join(',')];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const tagsStr = Array.isArray(row.tags) ? row.tags.join(';') : String(row.tags || '');
    const values = [
      row.id || '',
      row.title || row.name || '',
      row.folder || '根目录',
      row.status || '',
      tagsStr,
      row.date || '',
      row.taskDone ?? 0,
      row.taskCount ?? 0,
      row.wordCount ?? 0,
      row.degree ?? 0,
      ...(cleanPropKey ? [row.propertyValue ?? row.properties?.[cleanPropKey] ?? ''] : []),
    ];
    csvLines.push(values.map(escapeCsvCell).join(','));
  }

  return {
    rowCount: Math.max(0, csvLines.length - 1),
    headers,
    csv: '\uFEFF' + csvLines.join('\r\n') + '\r\n',
  };
}

export function exportDatabaseRowsToMarkdownTable(rows = [], {
  viewName = '全部笔记',
  propertyKey = '',
  propertyLabel = '',
} = {}) {
  const cleanViewName = String(viewName || '全部笔记').trim();
  const cleanPropKey = validPropertyKey(propertyKey) ? propertyKey : '';
  const propColTitle = propertyLabel || cleanPropKey;
  const list = Array.isArray(rows) ? rows : [];

  const headerCells = [
    '笔记（双链直达）',
    '所属目录',
    '状态',
    '标签',
    '任务进度',
    '字数',
    '链接度',
    ...(cleanPropKey ? [propColTitle] : []),
  ];
  const sepCells = headerCells.map(() => '---');

  const bodyLines = list.map(row => {
    const cleanTitle = String(row.title || row.name || '未命名').replace(/\|/g, '｜');
    const folder = String(row.folder || '根目录').replace(/\|/g, '｜');
    const relTarget = folder && folder !== '根目录'
      ? `${folder}/${(row.name || cleanTitle).replace(/\.(md|markdown)$/i, '')}`
      : (row.name || cleanTitle).replace(/\.(md|markdown)$/i, '');
    const wikiCell = `[[${relTarget}|${cleanTitle}]]`;
    const tagsCell = Array.isArray(row.tags) && row.tags.length
      ? row.tags.map(t => `#${t}`).join(' ')
      : '—';
    const taskCell = `${row.taskDone ?? 0}/${row.taskCount ?? 0}`;
    const cells = [
      wikiCell,
      folder,
      String(row.status || '未设状态').replace(/\|/g, '｜'),
      tagsCell.replace(/\|/g, '｜'),
      taskCell,
      String(row.wordCount ?? 0),
      String(row.degree ?? 0),
      ...(cleanPropKey ? [String(row.propertyValue ?? row.properties?.[cleanPropKey] ?? '—').replace(/\|/g, '｜')] : []),
    ];
    return `| ${cells.join(' | ')} |`;
  });

  const markdown = [
    '---',
    `title: 多维视图汇总 · ${cleanViewName}`,
    'category: reading',
    'status: 已完成',
    'tags:',
    '  - database',
    '  - summary',
    '---',
    '',
    `# 📊 多维视图汇总 · ${cleanViewName}`,
    '',
    `> 共收录 **${list.length}** 篇笔记${cleanPropKey ? ` · 挂载属性/公式列：\`${propColTitle}\`` : ''}。`,
    '',
    `| ${headerCells.join(' | ')} |`,
    `| ${sepCells.join(' | ')} |`,
    ...(bodyLines.length ? bodyLines : [`| 暂无匹配笔记 | ${headerCells.slice(1).map(() => '—').join(' | ')} |`]),
    '',
  ].join('\n');

  return {
    title: `多维视图汇总 · ${cleanViewName}`,
    rowCount: list.length,
    markdown,
  };
}

export function parseDatabaseCsvPropertyUpdates(csvText = '', existingNotes = []) {
  const parsedRows = parseCsvRows(csvText);
  if (parsedRows.length < 2) {
    throw new Error('请提供包含表头与至少 1 行数据的 CSV 内容（需包含 title / id / relativePath 标识列）');
  }
  const rawHeaders = parsedRows[0].map(h => h.trim());
  const lowerHeaders = rawHeaders.map(h => h.toLowerCase());
  const idIdx = lowerHeaders.indexOf('id');
  const titleIdx = lowerHeaders.findIndex(h => ['title', '笔记', '标题', 'name'].includes(h));
  const pathIdx = lowerHeaders.findIndex(h => ['relativepath', 'path', '路径'].includes(h));
  if (idIdx < 0 && titleIdx < 0 && pathIdx < 0) {
    throw new Error('CSV 表头必须包含 title（或 标题 / id / relativePath）列以匹配目标笔记');
  }

  const readOnlyCols = new Set([
    'id', 'title', 'name', '笔记', '标题', 'relativepath', 'path', '路径',
    'folder', '目录', 'taskdone', 'taskcount', 'wordcount', 'degree', 'tasks',
  ]);

  const byId = new Map();
  const byTitle = new Map();
  const byPath = new Map();
  for (const note of Array.isArray(existingNotes) ? existingNotes : []) {
    if (!note) continue;
    if (note.id) byId.set(String(note.id).toLowerCase(), note);
    const cleanT = String(note.title || note.cleanTitle || note.name || '').replace(/\.(md|markdown)$/i, '').trim().toLowerCase();
    if (cleanT) byTitle.set(cleanT, note);
    const cleanP = String(note.relativePath || note.name || '').replaceAll('\\', '/').replace(/\.(md|markdown)$/i, '').trim().toLowerCase();
    if (cleanP) byPath.set(cleanP, note);
  }

  const updates = [];
  const unmatched = [];

  for (let rIdx = 1; rIdx < parsedRows.length; rIdx++) {
    const row = parsedRows[rIdx];
    const idVal = idIdx >= 0 ? String(row[idIdx] || '').trim().toLowerCase() : '';
    const pathVal = pathIdx >= 0 ? String(row[pathIdx] || '').replaceAll('\\', '/').replace(/\.(md|markdown)$/i, '').trim().toLowerCase() : '';
    const titleVal = titleIdx >= 0 ? String(row[titleIdx] || '').replace(/\.(md|markdown)$/i, '').trim().toLowerCase() : '';

    const matched = (idVal && byId.get(idVal))
      || (pathVal && byPath.get(pathVal))
      || (titleVal && byTitle.get(titleVal))
      || null;

    if (!matched) {
      const label = (titleIdx >= 0 && row[titleIdx]) || (pathIdx >= 0 && row[pathIdx]) || (idIdx >= 0 && row[idIdx]) || `第 ${rIdx + 1} 行`;
      unmatched.push(String(label));
      continue;
    }

    const patch = {};
    const changedKeys = [];
    for (let cIdx = 0; cIdx < rawHeaders.length; cIdx++) {
      const colName = rawHeaders[cIdx];
      const lowerCol = lowerHeaders[cIdx];
      if (!colName || readOnlyCols.has(lowerCol)) continue;
      if (lowerCol.startsWith('formula:') || lowerCol.startsWith('rollup:')) continue;
      if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{1,48}$/.test(colName)) continue;

      const cellVal = String(row[cIdx] ?? '').trim();
      if (!cellVal) continue;

      if (lowerCol === 'status' || colName === '状态') {
        patch.status = cellVal;
        changedKeys.push('status');
      } else if (lowerCol === 'tags' || colName === '标签') {
        const parsedTags = cellVal
          .split(/[;,，\s]+/)
          .map(t => t.replace(/^#+/, '').trim())
          .filter(Boolean);
        patch.tags = parsedTags;
        changedKeys.push('tags');
      } else if (lowerCol === 'date' || colName === '日期') {
        patch.date = cellVal;
        changedKeys.push('date');
      } else {
        const numVal = /^-?\d+(\.\d+)?$/.test(cellVal) && colName.includes('words') ? Number(cellVal) : cellVal;
        patch[colName] = numVal;
        changedKeys.push(colName);
      }
    }

    if (changedKeys.length > 0) {
      updates.push({
        noteId: matched.id,
        title: matched.title || matched.name,
        version: matched.version,
        patch,
        changedKeys,
      });
    }
  }

  return {
    totalRows: parsedRows.length - 1,
    matchedCount: updates.length,
    unmatchedCount: unmatched.length,
    unmatched,
    updates,
  };
}