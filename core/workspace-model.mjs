import MarkdownIt from '../app/node_modules/markdown-it/dist/markdown-it.mjs';
import { stringify } from '../app/node_modules/yaml/browser/index.js';
import { readTaskPlan, planTaskChange, validateTaskPlan } from './task-planning.mjs';
import { countNoteWords, extractVaultHighlights } from './research-notes.mjs';

const markdown = new MarkdownIt({ html: false });
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function validDay(value) {
  if (!datePattern.test(String(value))) return false;
  const date = new Date(value + 'T12:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function localDay(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }

export function extractMarkdownTasks(source, bodyFrom = 0) {
  if (!/\[[ xX/]\]/.test(source)) return [];
  if (bodyFrom === 0) { const front = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source); if (front) bodyFrom = front[0].length; }
  const body = source.slice(bodyFrom); const lines = body.split('\n'); const offsets = []; let offset = bodyFrom;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const tasks = []; const tokens = markdown.parse(body, {}); const firstLine = source.slice(0, bodyFrom).split('\n').length;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]; if (token.type !== 'list_item_open' || !token.map) continue;
    const lineIndex = token.map[0]; const raw = lines[lineIndex]?.replace(/\r$/, '') || '';
    const match = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX/])\](\s+)(.*)$/.exec(raw); if (!match) continue;
    const inline = tokens[index + 2]; if (inline?.type !== 'inline' || !inline.content.startsWith('[')) continue;
    const titleTokens = markdown.parseInline(match[4], {})[0].children || [];
    const metadataText = titleTokens.filter(child => child.type === 'text').map(child => child.content).join(' ');
    const dueMatch = /(?:^|\s)@due\((\d{4}-\d{2}-\d{2})\)/.exec(metadataText); const timeMatch = /(?:^|\s)@time\((\d{2}:\d{2})\)/.exec(metadataText);
    const due = dueMatch && validDay(dueMatch[1]) ? dueMatch[1] : '';
    const time = timeMatch && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeMatch[1]) ? timeMatch[1] : '';
    const priority = /(?:^|\s)@priority\((high|normal|low)\)/.exec(metadataText)?.[1] || 'normal';
    const title = titleTokens.filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.type === 'code_inline' ? child.content : child.content.replace(/(?:^|\s)@(?:due|time|priority|repeat|every|days|start|until|task|next|after)\([^)]*\)/g, '')).join('').trim();
    tasks.push({ offset: offsets[lineIndex] + match[1].length + 1, line: firstLine + lineIndex, title: (title || match[4]).slice(0, 400), done: /[xX]/.test(match[2]), due, time, priority, raw, from: offsets[lineIndex], blockTo: offsets[token.map[1]] ?? source.length, ...readTaskPlan(raw, match[2]) });
  }
  return tasks;
}

export function toggleMarkdownTask(source, task, checked) {
  if (typeof checked !== 'boolean' || !Number.isInteger(task?.offset)) throw new Error('Invalid task update');
  const current = extractMarkdownTasks(source).find(item => item.offset === task.offset && item.raw === task.raw);
  if (!current) throw new Error('Task changed; refresh before updating');
  if (current.repeat || current.nextId) return planTaskChange(source, current, extractMarkdownTasks(source), { state: checked ? 'done' : 'todo' });
  return source.slice(0, current.offset) + (checked ? 'x' : ' ') + source.slice(current.offset + 1);
}

export function updateMarkdownTask(source, task, patch) {
  const tasks = extractMarkdownTasks(source); const current = tasks.find(item => task.taskId ? item.taskId === task.taskId : item.offset === task.offset);
  if (!current || current.raw !== task.raw) throw new Error('任务已变化，请刷新后重试');
  return planTaskChange(source, current, tasks, patch);
}

export function captureSource({ kind = 'memo', title, text = '', due = '', time = '', priority = 'normal', project = '', created, repeat = '', every = 1, days = '', until = '' }) {
  if (!['memo', 'task', 'project', 'reading'].includes(kind) || typeof title !== 'string' || !title.trim() || title.length > 160 || typeof text !== 'string' || text.length > 100000 || !validDay(String(created).slice(0, 10))) throw new Error('Invalid capture');
  if (due && !validDay(due)) throw new Error('Invalid due date');
  if (time && (!due || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Invalid reminder time');
  if (!['high', 'normal', 'low'].includes(priority) || typeof project !== 'string' || project.length > 160) throw new Error('Invalid task metadata');
  if (kind === 'task') validateTaskPlan({ state: 'todo', due, time, priority, repeat, every: Number(every), days, until });
  const metadata = { title: title.trim(), category: kind, date: created.slice(0, 10), created, tags: [kind], status: kind === 'task' || kind === 'project' ? 'todo' : 'note' };
  if (project) metadata.project = project;
  let body = text.trim();
  if (kind === 'task') body = '- [ ] ' + title.trim().replace(/[\r\n]/g, ' ') + (due ? ' @due(' + due + ')' : '') + (time ? ' @time(' + time + ')' : '') + (priority !== 'normal' ? ' @priority(' + priority + ')' : '') + (repeat ? ' @repeat(' + repeat + ') @start(' + due + ')' + (Number(every) > 1 ? ' @every(' + every + ')' : '') + (days ? ' @days(' + days + ')' : '') + (until ? ' @until(' + until + ')' : '') : '') + (body ? '\n\n' + body : '');
  if (kind === 'project') body = '## 项目目标\n\n' + body + '\n\n## 任务\n\n- [ ] 明确下一步行动\n\n## 相关笔记\n';
  if (kind === 'reading') body = '## 来源\n\n' + body + '\n\n## 关键观点\n\n## 问题与思考\n\n## 关联笔记\n';
  return '---\n' + stringify(metadata) + '---\n\n# ' + title.trim().replace(/[\r\n]/g, ' ') + '\n\n' + body + '\n';
}

const defaults = [
  { id: 'capture', x: 0, y: 0, w: 5, h: 9 }, { id: 'tasks', x: 5, y: 0, w: 7, h: 9 },
  { id: 'memos', x: 0, y: 9, w: 5, h: 7 }, { id: 'calendar', x: 5, y: 9, w: 7, h: 12 },
  { id: 'projects', x: 0, y: 16, w: 5, h: 5 }, { id: 'starred', x: 0, y: 21, w: 12, h: 4 },
];
export function workspaceLayout(value, template = 'balanced') {
  const preset = defaults.map(item => ({ ...item }));
  if (template === 'focus') { const tasks = preset.find(item => item.id === 'tasks'); const capture = preset.find(item => item.id === 'capture'); tasks.x = 0; tasks.w = 7; capture.x = 7; capture.w = 5; }
  if (template === 'focus') for (const item of preset) { if (item.id === 'memos' || item.id === 'projects') item.x = 7; else if (item.id === 'calendar') item.x = 0; }
  if (template === 'writing') { const memo = preset.find(item => item.id === 'memos'); memo.x = 5; memo.y = 0; memo.w = 7; memo.h = 9; preset.find(item => item.id === 'tasks').y = 9; preset.find(item => item.id === 'calendar').y = 18; preset.find(item => item.id === 'projects').y = 9; preset.find(item => item.id === 'starred').y = 30; }
  if (!Array.isArray(value) || !value.length || value.length > defaults.length) return preset;
  const used = new Set(); const result = [];
  for (const entry of value) {
    if (!defaults.some(item => item.id === entry?.id) || used.has(entry.id) || !['x', 'y', 'w', 'h'].every(key => Number.isInteger(entry[key] ?? (key === 'x' || key === 'y' ? 0 : undefined))) || (entry.x || 0) < 0 || (entry.x || 0) > 11 || (entry.y || 0) < 0 || (entry.y || 0) > 100 || entry.w < 3 || (entry.x || 0) + entry.w > 12 || entry.h < 3 || entry.h > 16) return preset;
    used.add(entry.id); result.push({ id: entry.id, x: entry.x || 0, y: entry.y || 0, w: entry.w, h: entry.h });
  }
  return result;
}

export function queryWorkspace(graph, options = {}) {
  const today = validDay(options.today) ? options.today : localDay(); const tasks = []; const memos = []; const projects = []; const starred = []; const whiteboards = []; const research = [];
  const datedNotes = [];
  const activityDays = new Map();
  let undatedNotes = 0;
  const projectNoteCounts = new Map();
  const manuscriptStats = new Map();
  for (const note of graph.notes) {
    const properties = Object.fromEntries(note.properties.map(item => [item.key, item.value]));
    const summary = { id: note.id, title: note.title, date: note.date, created: properties.created || '', excerpt: note.excerpt, folder: note.folder, category: note.metadata.category, status: note.status, starred: note.starred };
    const recordedDate = String(properties.created || note.date || '').slice(0, 10);
    const updatedDate = String(properties.updated || properties.modified || recordedDate).slice(0, 10);
    const words = countNoteWords(graph.nodeMap?.get(note.id)?.source ?? note.source ?? note.excerpt ?? '');
    if (validDay(recordedDate)) activityDays.set(recordedDate, (activityDays.get(recordedDate) || 0) + 1);
    else undatedNotes++;
    datedNotes.push({ id: note.id, title: note.title || note.name || '', folder: note.folder || '', relativePath: note.relativePath || '', date: validDay(recordedDate) ? recordedDate : '', updated: validDay(updatedDate) ? updatedDate : '', words, category: note.metadata.category || '', excerpt: String(note.excerpt || '').slice(0, 140) });
    if (properties.project) projectNoteCounts.set(properties.project, (projectNoteCounts.get(properties.project) || 0) + 1);
    if (note.metadata.category === 'manuscript') {
      const current = manuscriptStats.get(note.id) || { chapterCount: 0, wordCount: 0 };
      current.wordCount += words;
      manuscriptStats.set(note.id, current);
    } else if (note.metadata.category === 'chapter' && properties.manuscript) {
      const current = manuscriptStats.get(properties.manuscript) || { chapterCount: 0, wordCount: 0 };
      current.chapterCount++;
      current.wordCount += words;
      manuscriptStats.set(properties.manuscript, current);
    }
    if (note.starred) starred.push(summary);
    if (note.metadata.category === 'memo') memos.push(summary);
    if (note.metadata.category === 'whiteboard') {
      const boardDate = validDay(note.date || properties.date) ? (note.date || properties.date) : '';
      whiteboards.push({ ...summary, date: boardDate });
    }
    if (['source', 'reading', 'excerpt', 'manuscript', 'chapter'].includes(note.metadata.category)) {
      research.push({
        ...summary,
        relativePath: note.relativePath,
        sourceType: properties.source_type || '',
        locator: properties.source_locator || '',
        author: properties.author || '',
        year: properties.year || '',
        citeKey: properties.cite_key || '',
        journal: properties.journal || '',
        publisher: properties.publisher || '',
        volume: properties.volume || '',
        issue: properties.issue || '',
        pages: properties.pages || '',
        doi: properties.doi || '',
        sourceReference: properties.source_reference || '',
        sourceTitle: properties.source_title || '',
        sourceFile: properties.source_file || '',
        sourceHash: properties.source_hash || '',
        sourceFormat: properties.source_format || '',
        sourcePage: Number(properties.source_page) || 0,
        sourceBbox: properties.source_bbox || '',
        sourceCfi: properties.source_cfi || '',
        sourceChapter: properties.source_chapter || '',
        manuscriptId: properties.manuscript || '',
        chapterOrder: Number(properties.chapter_order) || 1,
        targetWords: Number(properties.target_words) || 0,
        wordCount: words,
        chapterCount: 0,
      });
    }
    if (note.metadata.category === 'project') projects.push({ ...summary, total: 0, done: 0, noteCount: 0 });
    for (const task of note.tasks || []) tasks.push({ ...task, id: note.id + ':' + (task.taskId || task.offset), noteId: note.id, noteTitle: note.title, project: properties.project || (note.metadata.category === 'project' ? note.id : '') });
  }
  for (const item of research) {
    if (item.category === 'manuscript' && manuscriptStats.has(item.id)) {
      const stat = manuscriptStats.get(item.id);
      item.chapterCount = stat.chapterCount;
      item.wordCount = stat.wordCount;
    }
  }
  const projectCounts = new Map();
  for (const task of tasks) if (task.project) { const count = projectCounts.get(task.project) || { total: 0, done: 0 }; count.total++; if (task.done) count.done++; projectCounts.set(task.project, count); }
  for (const project of projects) Object.assign(project, projectCounts.get(project.id) || { total: 0, done: 0 }, { noteCount: projectNoteCounts.get(project.id) || 0 });
  const counts = { total: tasks.length, open: tasks.filter(task => !task.done).length, today: tasks.filter(task => !task.done && task.due === today).length, overdue: tasks.filter(task => !task.done && task.due && task.due < today).length, done: tasks.filter(task => task.done).length };
  const rank = { high: 0, normal: 1, low: 2 }; tasks.sort((first, second) => Number(first.done) - Number(second.done) || (first.due || '9999').localeCompare(second.due || '9999') || rank[first.priority] - rank[second.priority] || first.id.localeCompare(second.id));
  const query = String(options.text || '').trim().toLocaleLowerCase();
  const matching = tasks.filter(task => (!options.project || task.project === options.project) && (!query || (task.title + ' ' + task.noteTitle).toLocaleLowerCase().includes(query)) && (options.filter === 'done' ? task.done : options.filter === 'all' ? true : !task.done) && (options.filter !== 'today' || task.due === today) && (options.filter !== 'overdue' || Boolean(task.due && task.due < today)));
  const pageSize = 50; const page = Math.max(0, Math.min(Math.ceil(matching.length / pageSize) - 1, Number.isInteger(options.page) ? options.page : 0));
  const journalBoards = whiteboards.filter(board => board.date).map(board => ({ id: 'whiteboard:' + board.id, noteId: board.id, title: '手帐 · ' + board.title, due: board.date, time: '', done: false, kind: 'whiteboard' }));
  const calendar = [...tasks, ...journalBoards].filter(item => item.due && (!options.start || item.due >= options.start) && (!options.end || item.due < options.end));
  const memoText = String(options.memoText || '').trim().toLocaleLowerCase(); const memoMatches = memos.filter(note => (options.memoArchive ? note.status === 'archived' : note.status !== 'archived') && (!memoText || (note.title + ' ' + (graph.nodeMap?.get(note.id)?.source ?? note.excerpt ?? '')).toLocaleLowerCase().includes(memoText)));
  const memoPage = Math.max(0, Math.min(Math.ceil(memoMatches.length / 20) - 1, Number.isInteger(options.memoPage) ? options.memoPage : 0));
  const boardMatches = whiteboards.filter(note => !options.whiteboardText || (note.title + ' ' + (note.date || '')).toLocaleLowerCase().includes(String(options.whiteboardText).toLocaleLowerCase())).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'zh-CN')); const whiteboardPage = Math.max(0, Math.min(Math.ceil(boardMatches.length / 25) - 1, Number.isInteger(options.whiteboardPage) ? options.whiteboardPage : 0));
  const researchText = String(options.researchText || '').toLocaleLowerCase();
  const researchMatches = research.filter(note => (!options.researchMode || options.researchMode === 'all' || (options.researchMode === 'manuscript' ? ['manuscript', 'chapter'].includes(note.category) : note.category === options.researchMode)) && (!researchText || [note.title, note.author, note.locator].join(' ').toLocaleLowerCase().includes(researchText)));
  const researchPage = Math.max(0, Math.min(Math.ceil(researchMatches.length / 25) - 1, Number.isInteger(options.researchPage) ? options.researchPage : 0));
  const highlights = options.researchMode === 'highlights'
    ? extractVaultHighlights(graph.notes, { colorFilter: options.highlightColor || 'all', query: options.researchText || '' })
    : undefined;
  const overview = {
    totalNotes: datedNotes.length,
    undatedNotes,
    todayNotes: activityDays.get(today) || 0,
    activityDays: [...activityDays].sort(([first], [second]) => first.localeCompare(second)).map(([date, count]) => ({ date, count })),
    recent: datedNotes.filter(note => !options.overviewDate || note.date === options.overviewDate).sort((first, second) => second.updated.localeCompare(first.updated) || first.title.localeCompare(second.title)).slice(0, 12),
    writingSprint: computeWritingSprintStats(datedNotes, {
      referenceDate: today,
      dailyGoalWords: options.dailyGoalWords || 1000,
      projectGoalWords: options.projectGoalWords || 20000,
    }),
  };
  return { overview, counts, page, pageSize, total: matching.length, tasks: matching.slice(page * pageSize, (page + 1) * pageSize), memos: memoMatches.sort((first, second) => second.created.localeCompare(first.created)).slice(memoPage * 20, (memoPage + 1) * 20), memoTotal: memoMatches.length, memoPage, projects: projects.slice(0, 50), starred: starred.slice(0, 20), whiteboards: boardMatches.slice(whiteboardPage * 25, (whiteboardPage + 1) * 25), whiteboardPage, whiteboardTotal: boardMatches.length, research: researchMatches.slice(researchPage * 25, (researchPage + 1) * 25), researchPage, researchTotal: researchMatches.length, ...(highlights ? { highlights } : {}), calendar: calendar.slice(0, 400), calendarTruncated: calendar.length > 400 };
}

export function computePeriodicNoteSpec(periodKind = 'weekly', referenceDate = localDay()) {
  const safeRef = validDay(referenceDate) ? referenceDate : localDay();
  const [year, month, day] = safeRef.split('-').map(Number);
  const refUtc = new Date(Date.UTC(year, month - 1, day));
  const fmtUtc = dt => dt.toISOString().slice(0, 10);

  if (periodKind === 'daily') {
    return {
      periodKind: 'daily',
      periodKey: safeRef,
      label: '今日手记',
      tagLabel: '今日手记',
      title: `今日手记 · ${safeRef}`,
      folder: 'journals',
      fileName: `${safeRef}.md`,
      relativePath: `journals/${safeRef}.md`,
      startDate: safeRef,
      endDate: safeRef,
      referenceDate: safeRef,
    };
  }

  if (periodKind === 'monthly') {
    const startUtc = new Date(Date.UTC(year, month - 1, 1));
    const endUtc = new Date(Date.UTC(year, month, 0));
    const periodKey = `${year}-${String(month).padStart(2, '0')}`;
    return {
      periodKind: 'monthly',
      periodKey,
      label: '本月复盘手记',
      tagLabel: '月报复盘',
      title: `月度复盘与规划 · ${periodKey}`,
      folder: 'journals/monthly',
      fileName: `${periodKey}.md`,
      relativePath: `journals/monthly/${periodKey}.md`,
      startDate: fmtUtc(startUtc),
      endDate: fmtUtc(endUtc),
      referenceDate: safeRef,
    };
  }

  if (periodKind === 'quarterly') {
    const quarter = Math.floor((month - 1) / 3) + 1;
    const qStartMonth = (quarter - 1) * 3;
    const startUtc = new Date(Date.UTC(year, qStartMonth, 1));
    const endUtc = new Date(Date.UTC(year, qStartMonth + 3, 0));
    const periodKey = `${year}-Q${quarter}`;
    return {
      periodKind: 'quarterly',
      periodKey,
      label: '本季规划手记',
      tagLabel: '季度规划',
      title: `季度目标与路线复盘 · ${periodKey}`,
      folder: 'journals/quarterly',
      fileName: `${periodKey}.md`,
      relativePath: `journals/quarterly/${periodKey}.md`,
      startDate: fmtUtc(startUtc),
      endDate: fmtUtc(endUtc),
      referenceDate: safeRef,
    };
  }

  // Default: ISO 8601 weekly (Monday - Sunday)
  const dayOfWeek = refUtc.getUTCDay() || 7;
  const mondayUtc = new Date(refUtc);
  mondayUtc.setUTCDate(refUtc.getUTCDate() - (dayOfWeek - 1));
  const sundayUtc = new Date(mondayUtc);
  sundayUtc.setUTCDate(mondayUtc.getUTCDate() + 6);
  const thursdayUtc = new Date(mondayUtc);
  thursdayUtc.setUTCDate(mondayUtc.getUTCDate() + 3);
  const isoYear = thursdayUtc.getUTCFullYear();
  const jan4Utc = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4Utc.getUTCDay() || 7;
  const week1Monday = new Date(jan4Utc);
  week1Monday.setUTCDate(jan4Utc.getUTCDate() - (jan4Day - 1));
  const weekNo = Math.floor((mondayUtc.getTime() - week1Monday.getTime()) / 86400000 / 7) + 1;
  const periodKey = `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
  return {
    periodKind: 'weekly',
    periodKey,
    label: '本周周报手记',
    tagLabel: '周报复盘',
    title: `周度手记与复盘 · ${periodKey}`,
    folder: 'journals/weekly',
    fileName: `${periodKey}.md`,
    relativePath: `journals/weekly/${periodKey}.md`,
    startDate: fmtUtc(mondayUtc),
    endDate: fmtUtc(sundayUtc),
    referenceDate: safeRef,
  };
}

function readSimpleFrontmatterField(source = '', field = '') {
  const fmMatch = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(String(source || ''));
  if (!fmMatch) return '';
  const lineRe = new RegExp(`^\\s*${field}\\s*:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm');
  return (lineRe.exec(fmMatch[1])?.[1] || '').trim();
}

export function compilePeriodicNoteMarkdown(notes = [], { periodKind = 'weekly', referenceDate = localDay(), dueFlashcardCount = 0 } = {}) {
  const spec = computePeriodicNoteSpec(periodKind, referenceDate);
  const activeNotes = [];
  const doneTasks = [];
  const openTasks = [];

  for (const rawNote of notes || []) {
    const relPath = String(rawNote?.relativePath || '').replaceAll('\\', '/');
    if (relPath && relPath.toLowerCase() === spec.relativePath.toLowerCase()) continue;
    const source = typeof rawNote?.source === 'string' ? rawNote.source : '';
    const rawName = String(rawNote?.title || readSimpleFrontmatterField(source, 'title') || rawNote?.name || '未命名笔记').replace(/\.md$/i, '').trim();
    const propsMap = Array.isArray(rawNote?.properties)
      ? Object.fromEntries(rawNote.properties.map(item => [item.key, item.value]))
      : {};
    const rawDateCandidate = String(
      rawNote?.date || propsMap.date || propsMap.created || readSimpleFrontmatterField(source, 'date') || readSimpleFrontmatterField(source, 'created') || ''
    ).slice(0, 10);
    const noteDate = validDay(rawDateCandidate) ? rawDateCandidate : (/(\d{4}-\d{2}-\d{2})/.exec(rawName)?.[1] || '');
    const inPeriod = Boolean(noteDate && noteDate >= spec.startDate && noteDate <= spec.endDate);
    if (inPeriod) {
      activeNotes.push({
        title: rawName,
        date: noteDate,
        folder: rawNote?.folder || (relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '根目录'),
        words: countNoteWords(source || rawNote?.excerpt || ''),
      });
    }

    const noteTasks = Array.isArray(rawNote?.tasks) ? rawNote.tasks : (source ? extractMarkdownTasks(source) : []);
    for (const task of noteTasks) {
      const dueInWindow = Boolean(task.due && task.due >= spec.startDate && task.due <= spec.endDate);
      if (task.done && (dueInWindow || inPeriod)) {
        doneTasks.push({ title: task.title, noteTitle: rawName, due: task.due || noteDate || '' });
      } else if (!task.done && (!task.due || task.due <= spec.endDate)) {
        openTasks.push({ title: task.title, noteTitle: rawName, due: task.due || '', priority: task.priority || 'normal' });
      }
    }
  }

  activeNotes.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
  const totalPeriodWords = activeNotes.reduce((sum, item) => sum + item.words, 0);
  const metadata = {
    title: spec.title,
    category: 'journal',
    period_kind: spec.periodKind,
    period_key: spec.periodKey,
    period_start: spec.startDate,
    period_end: spec.endDate,
    date: spec.referenceDate,
    status: '进行中',
    tags: ['周期手记', spec.tagLabel],
  };

  const noteLines = activeNotes.length
    ? activeNotes.slice(0, 20).map(item => `- **${item.date}** · [[${item.title}]]（${item.folder} · ${item.words} 字）`)
    : ['- 暂无本周期标定日期的新增笔记，可在下方补充本阶段重点记录与链接。'];

  const doneLines = doneTasks.length
    ? doneTasks.slice(0, 15).map(item => `- [x] ${item.title}（来源：[[${item.noteTitle}]]${item.due ? ` · ${item.due}` : ''}）`)
    : ['- 暂无本周期内已勾选完成的任务。'];

  const openLines = openTasks.length
    ? openTasks.slice(0, 15).map(item => `- [ ] ${item.title}${item.due ? ` @due(${item.due})` : ''}${item.priority === 'high' ? ' @priority(high)' : ''}（关联：[[${item.noteTitle}]]）`)
    : ['- [ ] 梳理下一周期最关键的 1~3 项推进目标'];

  const reflectionPrompts = spec.periodKind === 'quarterly'
    ? ['1. **季度里程碑达成度**：本季度核心目标完成了哪些关键跃迁？', '2. **系统瓶颈与取舍**：哪些低收益事项应在下季度果断精简？', '3. **下一季度北极星指标**：确定不超过 3 个可验证的核心交付物。']
    : spec.periodKind === 'monthly'
      ? ['1. **月度知识沉淀**：本月最具复利价值的笔记与方法论是什么？', '2. **执行节奏偏差**：计划与实际投入时间在哪些环节出现了偏离？', '3. **下月重点聚焦**：明确下月首要攻克的主题与阅读清单。']
      : ['1. **本周高光与突破**：本周完成了哪件最有价值的事？', '2. **阻力与改进点**：遇到什么卡点，下周如何调整工作流？', '3. **下周首要行动**：写下周一早上第一件要推进的具体事项。'];

  const body = [
    `# ${spec.title}`,
    '',
    `> **📅 周期范围**：\`${spec.startDate}\` ~ \`${spec.endDate}\` ｜ **活跃笔记**：**${activeNotes.length}** 篇（共 **${totalPeriodWords}** 字） ｜ **已完成待办**：**${doneTasks.length}** 项 ｜ **待推进任务**：**${openTasks.length}** 项 ｜ **待温习闪卡**：**${Number(dueFlashcardCount) || 0}** 张`,
    '',
    '## 一、 本周期活跃笔记与知识脉络',
    '',
    ...noteLines,
    '',
    '## 二、 已完成事项回顾',
    '',
    ...doneLines,
    '',
    '## 三、 待推进重点与下阶段行动',
    '',
    ...openLines,
    '',
    '## 四、 核心洞察与复盘沉淀',
    '',
    ...reflectionPrompts,
    '',
  ].join('\n');

  return {
    spec,
    activeNoteCount: activeNotes.length,
    totalPeriodWords,
    doneTaskCount: doneTasks.length,
    openTaskCount: openTasks.length,
    dueFlashcardCount: Number(dueFlashcardCount) || 0,
    markdown: `---\n${stringify(metadata)}---\n\n${body}`,
  };
}

export function computeWritingSprintStats(notes = [], { dailyGoalWords = 1000, projectGoalWords = 20000, referenceDate = localDay() } = {}) {
  const safeRef = validDay(referenceDate) ? referenceDate : localDay();
  const safeDailyGoal = Math.max(100, Math.min(200000, Number(dailyGoalWords) || 1000));
  const safeProjectGoal = Math.max(500, Math.min(5000000, Number(projectGoalWords) || 20000));

  const wordsByDate = new Map();
  const notesByDate = new Map();
  let totalVaultWords = 0;
  let totalNoteCount = 0;
  let chapterAndManuscriptCount = 0;

  for (const rawNote of notes || []) {
    totalNoteCount++;
    const source = typeof rawNote?.source === 'string' ? rawNote.source : '';
    const words = Number.isInteger(rawNote?.words)
      ? rawNote.words
      : countNoteWords(source || rawNote?.excerpt || '');
    totalVaultWords += words;

    const category = String(rawNote?.category || readSimpleFrontmatterField(source, 'category') || '').toLowerCase();
    if (category === 'chapter' || category === 'manuscript') chapterAndManuscriptCount++;

    const rawDateCandidate = String(
      rawNote?.date || rawNote?.created || readSimpleFrontmatterField(source, 'date') || readSimpleFrontmatterField(source, 'created') || ''
    ).slice(0, 10);
    const dayKey = validDay(rawDateCandidate) ? rawDateCandidate : '';
    if (dayKey) {
      wordsByDate.set(dayKey, (wordsByDate.get(dayKey) || 0) + words);
      notesByDate.set(dayKey, (notesByDate.get(dayKey) || 0) + 1);
    }
  }

  const todayWords = wordsByDate.get(safeRef) || 0;
  const dailyProgressPct = Math.min(100, Math.round((todayWords / safeDailyGoal) * 100));
  const projectProgressPct = Math.min(100, Math.round((totalVaultWords / safeProjectGoal) * 100));

  const [refY, refM, refD] = safeRef.split('-').map(Number);
  const refUtc = new Date(Date.UTC(refY, refM - 1, refD));
  const fmtUtc = dt => dt.toISOString().slice(0, 10);

  const last7Days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const dt = new Date(refUtc);
    dt.setUTCDate(refUtc.getUTCDate() - offset);
    const dayStr = fmtUtc(dt);
    const words = wordsByDate.get(dayStr) || 0;
    const noteCount = notesByDate.get(dayStr) || 0;
    last7Days.push({
      date: dayStr,
      label: dayStr.slice(5),
      words,
      noteCount,
      reachedGoal: words >= safeDailyGoal,
    });
  }

  const sortedActiveDates = [...wordsByDate.entries()]
    .filter(([, w]) => w > 0)
    .map(([d]) => d)
    .sort();

  let bestStreakDays = 0;
  let running = 0;
  let prevTime = null;
  for (const dayStr of sortedActiveDates) {
    const [y, m, d] = dayStr.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    if (prevTime !== null && t - prevTime === 86400000) {
      running++;
    } else {
      running = 1;
    }
    if (running > bestStreakDays) bestStreakDays = running;
    prevTime = t;
  }

  let currentStreakDays = 0;
  const activeSet = new Set(sortedActiveDates);
  const checkCursor = new Date(refUtc);
  if (!activeSet.has(fmtUtc(checkCursor))) {
    checkCursor.setUTCDate(checkCursor.getUTCDate() - 1);
  }
  while (activeSet.has(fmtUtc(checkCursor))) {
    currentStreakDays++;
    checkCursor.setUTCDate(checkCursor.getUTCDate() - 1);
  }

  const milestones = [
    {
      id: 'daily-target',
      title: '今日字数冲刺目标',
      current: todayWords,
      target: safeDailyGoal,
      unit: '字',
      progressPct: dailyProgressPct,
      reached: todayWords >= safeDailyGoal,
    },
    {
      id: 'project-target',
      title: '全库/长稿总字数里程碑',
      current: totalVaultWords,
      target: safeProjectGoal,
      unit: '字',
      progressPct: projectProgressPct,
      reached: totalVaultWords >= safeProjectGoal,
    },
    {
      id: 'streak-3d',
      title: '连续创作热力打卡',
      current: currentStreakDays,
      target: 3,
      unit: '天',
      progressPct: Math.min(100, Math.round((currentStreakDays / 3) * 100)),
      reached: currentStreakDays >= 3,
    },
    {
      id: 'vault-notes-10',
      title: '知识晶体卡片积累',
      current: totalNoteCount,
      target: 10,
      unit: '篇',
      progressPct: Math.min(100, Math.round((totalNoteCount / 10) * 100)),
      reached: totalNoteCount >= 10,
    },
  ];

  return {
    referenceDate: safeRef,
    dailyGoalWords: safeDailyGoal,
    projectGoalWords: safeProjectGoal,
    todayWords,
    dailyProgressPct,
    totalVaultWords,
    projectProgressPct,
    totalNoteCount,
    chapterAndManuscriptCount,
    activeDayCount: sortedActiveDates.length,
    currentStreakDays,
    bestStreakDays,
    last7Days,
    milestones,
  };
}

export function compileWritingSprintReportMarkdown(sprintStats = {}) {
  const refDate = validDay(sprintStats.referenceDate) ? sprintStats.referenceDate : localDay();
  const title = `写作目标冲刺与里程碑报告 · ${refDate}`;
  const metadata = {
    title,
    category: 'journal',
    date: refDate,
    status: '进行中',
    tags: ['写作冲刺', '字数统计', '里程碑'],
    daily_goal_words: sprintStats.dailyGoalWords || 1000,
    project_goal_words: sprintStats.projectGoalWords || 20000,
  };

  const dayRows = (sprintStats.last7Days || []).map(item =>
    `| ${item.date} | ${item.noteCount} 篇 | ${item.words} 字 | ${item.reachedGoal ? '✅ 已达标' : '⏳ 推进中'} |`
  );

  const milestoneLines = (sprintStats.milestones || []).map(ms =>
    `- [${ms.reached ? 'x' : ' '}] **${ms.title}**：当前 **${ms.current} / ${ms.target} ${ms.unit}**（达成率 **${ms.progressPct}%**）`
  );

  const body = [
    `# ${title}`,
    '',
    `> **🎯 冲刺总览**：今日产出 **${sprintStats.todayWords ?? 0} / ${sprintStats.dailyGoalWords ?? 1000} 字**（**${sprintStats.dailyProgressPct ?? 0}%**） ｜ 全库累计 **${sprintStats.totalVaultWords ?? 0} / ${sprintStats.projectGoalWords ?? 20000} 字**（**${sprintStats.projectProgressPct ?? 0}%**） ｜ 连续创作 **${sprintStats.currentStreakDays ?? 0} 天**（历史最高 **${sprintStats.bestStreakDays ?? 0} 天**）`,
    '',
    '## 一、 创作里程碑达成清单',
    '',
    ...milestoneLines,
    '',
    '## 二、 近 7 日写作热力与产出明细',
    '',
    '| 日期 | 记录篇数 | 产出字数 | 每日目标状态 |',
    '| --- | --- | --- | --- |',
    ...dayRows,
    '',
  ].join('\n');

  return {
    title,
    fileName: `写作冲刺-${refDate}.md`,
    folder: 'journals/sprints',
    markdown: `---\n${stringify(metadata)}---\n\n${body}`,
  };
}

/* ============================================================================
 * MAJOR-310 (3.1.0): RFC 5545 iCalendar (.ics) Bidirectional Task & Milestone Sync
 * ========================================================================== */

function escapeIcsText(value = '') {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeIcsText(value = '') {
  return String(value ?? '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function foldIcsLine(line = '') {
  const encoder = new TextEncoder();
  if (encoder.encode(line).byteLength <= 74) return line;
  const parts = [];
  let current = '';
  let currentBytes = 0;
  let limit = 74;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).byteLength;
    if (currentBytes + chBytes > limit && current) {
      parts.push(current);
      current = ' ' + ch;
      currentBytes = 1 + chBytes;
      limit = 74;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

function addCalendarDaysUtc(dayStr, deltaDays = 1) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function addMinutesToLocalDateTime(dayStr, timeStr, deltaMinutes = 30) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm + deltaMinutes, 0));
  const nextDay = dt.toISOString().slice(0, 10).replaceAll('-', '');
  const nextTime = String(dt.getUTCHours()).padStart(2, '0') + String(dt.getUTCMinutes()).padStart(2, '0') + '00';
  return `${nextDay}T${nextTime}`;
}

function formatUtcStamp(dateObj = new Date()) {
  const iso = dateObj.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function normalizeTaskInputList(tasksOrNotes = []) {
  const tasks = [];
  for (const item of tasksOrNotes || []) {
    if (!item) continue;
    if (typeof item.source === 'string' && item.due === undefined) {
      const noteTitle = String(item.title || item.cleanTitle || item.name || '未命名笔记').replace(/\.(md|markdown|txt)$/i, '');
      for (const t of extractMarkdownTasks(item.source)) {
        tasks.push({
          ...t,
          noteId: item.id || '',
          noteTitle,
        });
      }
    } else if (typeof item.title === 'string') {
      tasks.push(item);
    }
  }
  return tasks;
}

export function exportTasksToIcsCalendar(tasksOrNotes = [], {
  calendarName = 'Inkloom 墨图任务与里程碑',
  includeCompleted = false,
  prodId = '-//Inkloom//PKM Calendar 3.1//ZH',
  dtStamp = formatUtcStamp(),
  today = localDay(),
} = {}) {
  const allTasks = normalizeTaskInputList(tasksOrNotes);
  const eligible = allTasks.filter(t => {
    if (!t || !validDay(t.due)) return false;
    if (t.kind === 'whiteboard') return false;
    if (!includeCompleted && t.done) return false;
    return true;
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  eligible.forEach((task, idx) => {
    const cleanDate = task.due.replaceAll('-', '');
    const rawUidBase = String(task.taskId || task.id || `${cleanDate}-${idx + 1}`).replace(/[^A-Za-z0-9_.-]/g, '-');
    const uid = `${rawUidBase}@inkloom.local`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtStamp}`);

    if (task.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) {
      const cleanTime = task.time.replace(':', '') + '00';
      lines.push(`DTSTART:${cleanDate}T${cleanTime}`);
      lines.push(`DTEND:${addMinutesToLocalDateTime(task.due, task.time, 30)}`);
    } else {
      const nextDate = addCalendarDaysUtc(task.due, 1).replaceAll('-', '');
      lines.push(`DTSTART;VALUE=DATE:${cleanDate}`);
      lines.push(`DTEND;VALUE=DATE:${nextDate}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(task.title)}`);
    const priorityNum = task.priority === 'high' ? 1 : task.priority === 'low' ? 9 : 5;
    lines.push(`PRIORITY:${priorityNum}`);
    const statusStr = task.done ? 'COMPLETED' : task.state === 'doing' ? 'IN-PROCESS' : 'CONFIRMED';
    lines.push(`STATUS:${statusStr}`);

    if (task.repeat && ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(task.repeat)) {
      const rruleParts = [];
      if (task.repeat === 'weekdays') {
        rruleParts.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
      } else {
        rruleParts.push(`FREQ=${task.repeat.toUpperCase()}`);
        const every = Number(task.every) || 1;
        if (every > 1) rruleParts.push(`INTERVAL=${every}`);
        if (task.repeat === 'weekly' && task.days) {
          rruleParts.push(`BYDAY=${task.days}`);
        }
      }
      if (task.until && validDay(task.until)) {
        rruleParts.push(`UNTIL=${task.until.replaceAll('-', '')}`);
      }
      lines.push(`RRULE:${rruleParts.join(';')}`);
    }

    if (task.noteTitle) {
      lines.push(`DESCRIPTION:${escapeIcsText(`来源笔记：${task.noteTitle}`)}`);
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  const folded = lines.map(foldIcsLine).join('\r\n') + '\r\n';
  const safeStem = String(calendarName || 'inkloom-tasks').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'inkloom-tasks';

  return {
    calendarName,
    eventCount: eligible.length,
    fileName: `${safeStem}-${today}.ics`,
    icsContent: folded,
  };
}

function parseIcsDateTimeValue(rawVal = '') {
  const clean = String(rawVal || '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (dateOnly) {
    const due = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return validDay(due) ? { due, time: '' } : { due: '', time: '' };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/i.exec(clean);
  if (dateTime) {
    const due = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`;
    const time = `${dateTime[4]}:${dateTime[5]}`;
    return validDay(due) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
      ? { due, time }
      : { due: validDay(due) ? due : '', time: '' };
  }
  return { due: '', time: '' };
}

function parseIcsRruleToInkloom(rruleStr = '') {
  const map = {};
  for (const part of String(rruleStr || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      map[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().toUpperCase();
    }
  }
  const freq = map.FREQ || '';
  let repeat = '';
  let every = Math.max(1, Math.min(365, Number(map.INTERVAL) || 1));
  let days = '';
  let until = '';

  const validWeekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  if (map.BYDAY) {
    const parsedDays = map.BYDAY
      .split(',')
      .map(d => d.replace(/^[+-]?\d+/, '').trim())
      .filter(d => validWeekdays.includes(d));
    if (parsedDays.length) days = [...new Set(parsedDays)].join(',');
  }

  if (freq === 'WEEKLY' && days === 'MO,TU,WE,TH,FR' && every === 1) {
    repeat = 'weekdays';
    days = '';
  } else if (freq === 'DAILY') {
    repeat = 'daily';
    days = '';
  } else if (freq === 'WEEKLY') {
    repeat = 'weekly';
  } else if (freq === 'MONTHLY') {
    repeat = 'monthly';
    days = '';
  } else if (freq === 'YEARLY') {
    repeat = 'yearly';
    days = '';
  }

  if (map.UNTIL) {
    const parsedUntil = parseIcsDateTimeValue(map.UNTIL.slice(0, 8));
    if (parsedUntil.due) until = parsedUntil.due;
  }

  return { repeat, every: repeat === 'weekdays' ? 1 : every, days, until };
}

export function parseIcsCalendarToTasks(icsText = '', { defaultCalendarName = '外部日历导入' } = {}) {
  const unfolded = String(icsText || '').replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  let calendarName = defaultCalendarName;
  const tasks = [];
  let currentBlock = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();

    if (upper === 'BEGIN:VEVENT' || upper === 'BEGIN:VTODO') {
      currentBlock = {};
      continue;
    }
    if ((upper === 'END:VEVENT' || upper === 'END:VTODO') && currentBlock) {
      const title = unescapeIcsText(currentBlock.SUMMARY || '').replace(/[\r\n]/g, ' ').trim();
      const dt = parseIcsDateTimeValue(currentBlock.DTSTART || currentBlock.DUE || '');
      if (title && dt.due) {
        const prioRaw = Number(currentBlock.PRIORITY) || 5;
        const priority = prioRaw >= 1 && prioRaw <= 4 ? 'high' : prioRaw >= 6 && prioRaw <= 9 ? 'low' : 'normal';
        const statusUpper = String(currentBlock.STATUS || '').toUpperCase();
        if (statusUpper !== 'CANCELLED') {
          const state = statusUpper === 'COMPLETED' ? 'done' : statusUpper === 'IN-PROCESS' ? 'doing' : 'todo';
          const done = state === 'done';
          const rrule = currentBlock.RRULE ? parseIcsRruleToInkloom(currentBlock.RRULE) : { repeat: '', every: 1, days: '', until: '' };
          if (rrule.until && rrule.until < dt.due) rrule.until = '';

          const planCandidate = {
            state,
            due: dt.due,
            time: dt.time,
            priority,
            repeat: rrule.repeat,
            every: rrule.every,
            days: rrule.days,
            until: rrule.until,
          };
          try {
            validateTaskPlan(planCandidate);
          } catch {
            planCandidate.repeat = '';
            planCandidate.every = 1;
            planCandidate.days = '';
            planCandidate.until = '';
          }

          const checkChar = state === 'done' ? 'x' : state === 'doing' ? '/' : ' ';
          const metaTokens = [`@due(${planCandidate.due})`];
          if (planCandidate.time) metaTokens.push(`@time(${planCandidate.time})`);
          if (planCandidate.priority !== 'normal') metaTokens.push(`@priority(${planCandidate.priority})`);
          if (planCandidate.repeat) {
            metaTokens.push(`@repeat(${planCandidate.repeat})`, `@start(${planCandidate.due})`);
            if (planCandidate.every > 1) metaTokens.push(`@every(${planCandidate.every})`);
            if (planCandidate.days) metaTokens.push(`@days(${planCandidate.days})`);
            if (planCandidate.until) metaTokens.push(`@until(${planCandidate.until})`);
          }
          const safeTitle = title.slice(0, 240);
          const markdownLine = `- [${checkChar}] ${safeTitle} ${metaTokens.join(' ')}`;

          tasks.push({
            uid: unescapeIcsText(currentBlock.UID || ''),
            title: safeTitle,
            due: planCandidate.due,
            time: planCandidate.time,
            priority: planCandidate.priority,
            state,
            done,
            repeat: planCandidate.repeat,
            every: planCandidate.every,
            days: planCandidate.days,
            until: planCandidate.until,
            description: unescapeIcsText(currentBlock.DESCRIPTION || ''),
            markdownLine,
          });
        }
      }
      currentBlock = null;
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const rawProp = trimmed.slice(0, colonIdx);
    const val = trimmed.slice(colonIdx + 1);
    const propName = rawProp.split(';')[0].trim().toUpperCase();

    if (!currentBlock) {
      if (propName === 'X-WR-CALNAME' && val.trim()) {
        calendarName = unescapeIcsText(val);
      }
      continue;
    }
    currentBlock[propName] = val.trim();
  }

  const deduped = [];
  const seenKeys = new Set();
  for (const t of tasks) {
    const key = t.uid ? `uid:${t.uid}` : `sig:${t.title.toLocaleLowerCase()}|${t.due}|${t.time}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(t);
  }

  return {
    calendarName,
    taskCount: deduped.length,
    tasks: deduped,
  };
}

export function compileImportedIcsNoteMarkdown(importedTasks = [], {
  calendarName = '外部日历同步日程',
  today = localDay(),
} = {}) {
  const safeCal = String(calendarName || '外部日历同步日程').replace(/[\r\n]+/g, ' ').trim() || '外部日历同步日程';
  const title = `${safeCal} · ${today}`;
  const metadata = {
    title,
    category: 'task',
    date: today,
    status: 'todo',
    tags: ['日历同步', 'ICS日程', 'task'],
  };
  const taskLines = (importedTasks || []).map(t => t.markdownLine);
  const body = [
    `# ${title}`,
    '',
    `> **📅 RFC 5545 (.ics) 日历同步清单**：共导入 **${taskLines.length}** 项日程待办（同步日期：\`${today}\`），已自动绑定 \`@due\`、\`@time\` 与 \`@repeat\` 规则并在工作台日历与看板实时联动。`,
    '',
    '## 待办日程事项',
    '',
    ...(taskLines.length ? taskLines : [`- [ ] 核对外部日历日程 @due(${today})`]),
    '',
  ].join('\n');

  return {
    title,
    folder: 'tasks',
    taskCount: taskLines.length,
    markdown: `---\n${stringify(metadata)}---\n\n${body}`,
  };
}

export function buildSampleIcsCalendar({ today = localDay() } = {}) {
  const dayClean = (validDay(today) ? today : localDay()).replaceAll('-', '');
  const tomorrowClean = addCalendarDaysUtc(validDay(today) ? today : localDay(), 1).replaceAll('-', '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Inkloom//Sample Schedule 3.1//ZH',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:墨图里程碑与研读日程',
    'BEGIN:VEVENT',
    `UID:sample-seminar-${dayClean}@inkloom.local`,
    `DTSTAMP:${dayClean}T080000Z`,
    `DTSTART:${dayClean}T143000`,
    `DTEND:${dayClean}T153000`,
    'SUMMARY:深度学习与知识星图专题研讨',
    'PRIORITY:1',
    'STATUS:CONFIRMED',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,FR',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:sample-review-${tomorrowClean}@inkloom.local`,
    `DTSTAMP:${dayClean}T080000Z`,
    `DTSTART;VALUE=DATE:${tomorrowClean}`,
    'SUMMARY:整理月度卡片盒文献摘录',
    'PRIORITY:5',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}