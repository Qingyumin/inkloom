import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import { Calendar } from '@fullcalendar/core';
import zhLocale from '@fullcalendar/core/locales/zh-cn';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { createElement, Plus, GripVertical, Pencil, Check, RotateCcw, PanelsTopLeft, CalendarDays, ArrowUpRight, ChevronLeft, ChevronRight, Archive, ArchiveRestore, Download, Upload } from 'lucide';
import {
  captureSource,
  localDay,
  updateMarkdownTask,
  workspaceLayout,
  compileWritingSprintReportMarkdown,
  exportTasksToIcsCalendar,
  parseIcsCalendarToTasks,
  compileImportedIcsNoteMarkdown,
  buildSampleIcsCalendar,
} from '../../core/workspace-model.mjs';
import { createWorkspaceTemplate, validateWorkspaceTemplate } from '../../core/workspace-template.mjs';
import { mountTaskEditor, recurrenceInputs, repeatLabels, stateLabels } from './task-editor.js';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(icon, label, text = '') { const node = element('button', text ? 'phase-command' : 'icon-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.append(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' })); if (text) node.append(element('span', '', text)); return node; }
const widgetNames = { capture: '快速收集', tasks: '任务', memos: 'Memo', calendar: '日历', projects: '项目', starred: '星标笔记' };
const kindNames = { memo: 'Memo', task: '任务', project: '项目', reading: '阅读札记' };

export function mountWorkspace(api, container, scope) {
  let homeSurface = api.getSetting('home-surface') === 'panels' ? 'panels' : 'overview';
  let overviewDate = '';
  let overviewDays = 90;
  let statusRevision = 0;
  let taskMode = api.getSetting('task-mode') || 'list'; let draggingTask = null; let refreshAfterDrag = false; let pointerActive = false; let pointerFrame;
  let result; let vaultKey = ''; let grid; let calendar; let editing = false; let busy = false; let querying = false; let request = 0; let queryTimer; let draftTimer; let calendarRange = {}; let filter = 'open'; let pageIndex = 0; let memoPage = 0; let lastLayout = []; let restoring = false;
  let layouts = api.getSetting('layouts') || {}; let drafts = api.getSetting('drafts') || {}; let draft = { kind: 'memo', title: '', text: '', due: '', time: '', priority: 'normal', project: '' };
  const root = element('section', 'workspace-home'); root.id = 'workspace-home'; root.setAttribute('aria-label', '工作台');
  const toolbar = element('div', 'home-toolbar'); const date = element('h2', 'home-date', new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())); const tools = element('div', 'home-tools');
  const daily = button(CalendarDays, '打开今日手记'); daily.onclick = () => api.navigate('daily');
  const template = element('select'); template.id = 'home-template'; template.setAttribute('aria-label', '工作台布局模板'); template.append(new Option('日常', 'balanced'), new Option('专注任务', 'focus'), new Option('阅读写作', 'writing'));
  const customize = button(Pencil, '编辑工作台布局'); customize.id = 'home-customize'; customize.setAttribute('aria-pressed', 'false');
  const widgetsMenu = element('details', 'home-widget-menu'); const menuLabel = element('summary', 'icon-button'); menuLabel.title = '选择工作台模块'; menuLabel.setAttribute('aria-label', '选择工作台模块'); menuLabel.append(createElement(PanelsTopLeft, { width: 15, height: 15 })); const menuBody = element('div', 'home-widget-options'); widgetsMenu.append(menuLabel, menuBody);
  const exportTemplate = button(Download, '导出工作台模板'); exportTemplate.id = 'home-export-template';
  const importTemplate = button(Upload, '导入工作台模板'); importTemplate.id = 'home-import-template';
  const importTemplateFile = element('input'); importTemplateFile.type = 'file'; importTemplateFile.id = 'home-import-template-file'; importTemplateFile.accept = '.json,.inkloom-workspace.json'; importTemplateFile.hidden = true;
  const reset = button(RotateCcw, '恢复默认布局'); reset.id = 'home-reset'; tools.append(daily, template, widgetsMenu, customize, exportTemplate, importTemplate, importTemplateFile, reset); toolbar.append(date, tools);
  const surfaceTabs = element('div', 'home-surface-tabs'); surfaceTabs.setAttribute('role', 'tablist'); surfaceTabs.setAttribute('aria-label', '工作台页面');
  const overviewTab = element('button', '', '总览'); overviewTab.id = 'home-overview-tab'; overviewTab.type = 'button'; overviewTab.setAttribute('role', 'tab');
  const panelsTab = element('button', '', '面板'); panelsTab.id = 'home-panels-tab'; panelsTab.type = 'button'; panelsTab.setAttribute('role', 'tab');
  surfaceTabs.append(overviewTab, panelsTab); toolbar.prepend(surfaceTabs);
  const overview = element('section', 'home-overview'); overview.id = 'home-overview';
  const welcome = element('header', 'home-welcome');
  const welcomeCopy = element('div'); const welcomeBrand = element('span', 'home-eyebrow', 'INKLOOM / 墨图');
  const hour = new Date().getHours();
  welcomeCopy.append(welcomeBrand, element('h2', '', hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'), element('p', 'home-welcome-date', date.textContent));
  const welcomeImage = element('img', 'home-welcome-mark'); welcomeImage.src = '/inkloom.png'; welcomeImage.alt = 'Inkloom'; welcomeImage.width = 64; welcomeImage.height = 64;
  const quickActions = element('div', 'home-quick-actions');
  const overviewDaily = button(CalendarDays, '打开今日手记', '今日手记'); overviewDaily.onclick = () => api.navigate('daily');
  const periodicMenu = element('details', 'ux-popover-menu'); periodicMenu.id = 'home-periodic-menu';
  const periodicTrigger = element('summary', 'ux-popover-trigger', '📅 周期手记 ▾'); periodicTrigger.id = 'home-periodic-menu-trigger';
  periodicTrigger.setAttribute('aria-label', '打开日/周/月/季周期性手记模板菜单');
  const periodicPanel = element('div', 'ux-popover-panel home-periodic-panel'); periodicPanel.id = 'home-periodic-menu-panel';
  for (const [id, navTarget, labelText] of [
    ['home-periodic-daily', 'daily', '📅 今日手记 (Daily)'],
    ['home-periodic-weekly', 'periodic:weekly', '🗓️ 本周周报手记 (Weekly)'],
    ['home-periodic-monthly', 'periodic:monthly', '📆 本月复盘手记 (Monthly)'],
    ['home-periodic-quarterly', 'periodic:quarterly', '🧭 本季规划手记 (Quarterly)'],
  ]) {
    const item = element('button', 'ux-popover-item', labelText);
    item.type = 'button';
    item.id = id;
    item.onclick = () => { periodicMenu.open = false; void api.navigate(navTarget).catch(fail); };
    periodicPanel.append(item);
  }
  const sprintGroup = element('div', 'ux-popover-group home-sprint-group');
  const sprintSummary = element('small', 'home-sprint-summary', '🎯 今日写作冲刺与里程碑统计');
  sprintSummary.id = 'home-sprint-summary';
  const sprintGoalsRow = element('div', 'home-sprint-goals-row');
  const dailyGoalInput = element('input', 'ux-select');
  dailyGoalInput.type = 'number';
  dailyGoalInput.id = 'home-sprint-daily-goal';
  dailyGoalInput.min = '100';
  dailyGoalInput.max = '200000';
  dailyGoalInput.step = '100';
  dailyGoalInput.value = '1000';
  dailyGoalInput.title = '每日目标字数';
  dailyGoalInput.setAttribute('aria-label', '每日目标字数');
  const projectGoalInput = element('input', 'ux-select');
  projectGoalInput.type = 'number';
  projectGoalInput.id = 'home-sprint-project-goal';
  projectGoalInput.min = '500';
  projectGoalInput.max = '5000000';
  projectGoalInput.step = '500';
  projectGoalInput.value = '20000';
  projectGoalInput.title = '全库或长稿总目标字数';
  projectGoalInput.setAttribute('aria-label', '全库或长稿总目标字数');
  sprintGoalsRow.append(dailyGoalInput, projectGoalInput);
  const sprintMilestones = element('div', 'home-sprint-milestones');
  sprintMilestones.id = 'home-sprint-milestones';
  const sprintExportBtn = element('button', 'ux-popover-item', '📊 生成写作冲刺与里程碑报告');
  sprintExportBtn.type = 'button';
  sprintExportBtn.id = 'home-sprint-export-btn';
  sprintGroup.append(sprintSummary, sprintGoalsRow, sprintMilestones, sprintExportBtn);

  const icsGroup = element('div', 'ux-popover-group home-ics-group');
  const icsTitle = element('small', 'home-sprint-summary', '🗓️ iCalendar (.ics) 日程双向互通');
  const icsExportBtn = element('button', 'ux-popover-item', '📤 导出待办日程 (.ics)');
  icsExportBtn.type = 'button';
  icsExportBtn.id = 'home-ics-export-btn';
  const icsSampleBtn = element('button', 'ux-popover-item', '✨ 填入 .ics 示例日程');
  icsSampleBtn.type = 'button';
  icsSampleBtn.id = 'home-ics-sample-btn';
  const icsFileBtn = element('button', 'ux-popover-item', '📂 选择外部 .ics 文件导入');
  icsFileBtn.type = 'button';
  icsFileBtn.id = 'home-ics-file-btn';
  const icsFileInput = element('input');
  icsFileInput.type = 'file';
  icsFileInput.id = 'home-ics-file-input';
  icsFileInput.accept = '.ics,text/calendar';
  icsFileInput.hidden = true;
  const icsImportInput = element('textarea', 'ai-sr-anki-import-input');
  icsImportInput.id = 'home-ics-import-input';
  icsImportInput.rows = 2;
  icsImportInput.placeholder = '粘贴 BEGIN:VCALENDAR ... END:VCALENDAR 内容...';
  icsImportInput.setAttribute('aria-label', 'iCalendar .ics 日程内容');
  const icsImportBtn = element('button', 'ux-popover-item', '📅 同步 .ics 日程到任务库');
  icsImportBtn.type = 'button';
  icsImportBtn.id = 'home-ics-import-btn';
  const icsStatus = element('small', 'ai-sr-anki-status', '');
  icsStatus.id = 'home-ics-status';
  icsGroup.append(icsTitle, icsExportBtn, icsSampleBtn, icsFileBtn, icsFileInput, icsImportInput, icsImportBtn, icsStatus);

  periodicPanel.append(sprintGroup, icsGroup);
  periodicMenu.append(periodicTrigger, periodicPanel);
  const onSprintGoalChange = () => { void refresh(); };
  dailyGoalInput.onchange = onSprintGoalChange;
  projectGoalInput.onchange = onSprintGoalChange;
  sprintExportBtn.onclick = async () => {
    if (busy || !result?.overview?.writingSprint) return;
    periodicMenu.open = false;
    busy = true; setBusy();
    const finishStatus = startStatus('正在生成写作冲刺报告');
    try {
      const report = compileWritingSprintReportMarkdown(result.overview.writingSprint);
      await api.createNote(report.title, { folder: report.folder, source: report.markdown, background: true, overwrite: true });
      finishStatus(`已生成《${report.title}》`);
    } catch (reason) {
      finishStatus('冲刺报告未完成');
      fail(reason);
    } finally {
      busy = false;
      if (!scope.signal.aborted) { await refresh(); setBusy(); }
    }
  };
  icsSampleBtn.onclick = () => {
    error.hidden = true;
    icsImportInput.value = buildSampleIcsCalendar({ today: localDay() });
    icsStatus.textContent = '已填入 RFC 5545 标准 .ics 示例日程，点击下方按钮即可同步至任务库';
  };
  icsExportBtn.onclick = async () => {
    if (busy) return;
    error.hidden = true;
    try {
      const fullRes = await api.queryWorkspace({ today: localDay(), filter: 'all', page: 0 }, { signal: scope.signal, key: 'home-ics-export' });
      const exported = exportTasksToIcsCalendar(fullRes.tasks || [], {
        calendarName: 'Inkloom 墨图任务与里程碑',
        includeCompleted: false,
        today: localDay(),
      });
      icsImportInput.value = exported.icsContent;
      const blob = new Blob([exported.icsContent], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exported.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      icsStatus.textContent = `已导出 ${exported.eventCount} 项设期日程至 ${exported.fileName}`;
      startStatus(icsStatus.textContent)(icsStatus.textContent);
    } catch (reason) {
      fail(reason);
    }
  };
  const commitIcsImport = async rawIcs => {
    const parsed = parseIcsCalendarToTasks(rawIcs);
    if (!parsed.tasks.length) {
      throw new Error('未识别出有效的 VEVENT / VTODO 设期日程，请检查 .ics 内容');
    }
    const compiled = compileImportedIcsNoteMarkdown(parsed.tasks, {
      calendarName: parsed.calendarName,
      today: localDay(),
    });
    await api.createNote(compiled.title, {
      folder: compiled.folder,
      source: compiled.markdown,
      background: true,
      overwrite: true,
    });
    icsStatus.textContent = `成功同步 ${parsed.taskCount} 项日程至《${compiled.title}》`;
    startStatus(icsStatus.textContent)(icsStatus.textContent);
    await refresh();
  };
  icsImportBtn.onclick = async () => {
    if (busy) return;
    error.hidden = true;
    if (!icsImportInput.value.trim()) {
      fail(new Error('请先粘贴 .ics 内容或点击「✨ 填入 .ics 示例日程」'));
      return;
    }
    busy = true; setBusy();
    try {
      await commitIcsImport(icsImportInput.value);
    } catch (reason) {
      fail(reason);
    } finally {
      busy = false;
      if (!scope.signal.aborted) setBusy();
    }
  };
  icsFileBtn.onclick = () => { if (!busy) icsFileInput.click(); };
  icsFileInput.onchange = async () => {
    const file = icsFileInput.files?.[0];
    if (!file || busy) return;
    error.hidden = true;
    busy = true; setBusy();
    try {
      const textContent = await file.text();
      icsImportInput.value = textContent;
      await commitIcsImport(textContent);
    } catch (reason) {
      fail(reason);
    } finally {
      icsFileInput.value = '';
      busy = false;
      if (!scope.signal.aborted) setBusy();
    }
  };
  document.addEventListener('pointerdown', event => { if (!periodicMenu.contains(event.target)) periodicMenu.open = false; }, { signal: scope.signal });
  periodicMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { periodicMenu.open = false; periodicTrigger.focus(); } }, { signal: scope.signal });
  const overviewCapture = button(Plus, '新建记录', '记一笔'); overviewCapture.id = 'home-overview-capture';
  const overviewTasks = button(Check, '查看任务', '待办');
  quickActions.append(overviewCapture, overviewDaily, periodicMenu, overviewTasks); welcome.append(welcomeCopy, welcomeImage, quickActions);
  const overviewBody = element('div', 'home-overview-columns');
  const overviewMain = element('div', 'home-overview-main'); const overviewAside = element('aside', 'home-overview-aside');
  const activitySection = element('section', 'home-activity'); const activityHeading = element('header', 'home-section-heading');
  activityHeading.append(element('h3', '', '笔记活动'));
  const periodControl = element('div', 'home-period-control'); periodControl.setAttribute('role', 'group'); periodControl.setAttribute('aria-label', '笔记日期范围');
  for (const [days, label] of [[30, '月'], [90, '季'], [365, '年']]) {
    const option = element('button', '', label); option.type = 'button'; option.dataset.activityDays = String(days);
    option.onclick = () => { overviewDays = days; renderOverview(); }; periodControl.append(option);
  }
  activityHeading.append(periodControl);
  const activityGrid = element('div', 'home-activity-grid'); activityGrid.id = 'home-activity-grid'; activityGrid.setAttribute('aria-label', '按笔记日期统计');
  const activityStats = element('p', 'home-activity-stats'); activityStats.id = 'home-activity-stats';
  activitySection.append(activityHeading, activityGrid, activityStats);
  const recentSection = element('section', 'home-recent'); const recentHeading = element('header', 'home-section-heading');
  const recentTitle = element('h3', '', '最近记录'); const clearDay = button(RotateCcw, '清除日期筛选'); clearDay.hidden = true;
  clearDay.onclick = () => { overviewDate = ''; void refresh(); };
  recentHeading.append(recentTitle, clearDay); const recentList = element('div', 'home-recent-list'); recentList.id = 'home-recent-list'; recentSection.append(recentHeading, recentList);
  const focusSection = element('section'); focusSection.append(element('h3', '', '待办聚焦')); const focusList = element('div'); focusList.id = 'home-focus-list'; focusSection.append(focusList);
  const inspirationSection = element('section'); inspirationSection.append(element('h3', '', '星标卡片')); const inspirationList = element('div'); inspirationList.id = 'home-starred-cards'; inspirationSection.append(inspirationList);
  overviewMain.append(activitySection, recentSection); overviewAside.append(focusSection, inspirationSection); overviewBody.append(overviewMain, overviewAside); overview.append(welcome, overviewBody);
  const summary = element('div', 'home-summary'); summary.id = 'home-summary';
  const status = element('p', 'home-status'); status.id = 'home-status'; status.setAttribute('role', 'status');
  const startStatus = message => { const revision = ++statusRevision; status.textContent = message; return next => { if (!scope.signal.aborted && revision === statusRevision) status.textContent = next; }; };
  const error = element('p', 'database-error'); error.id = 'home-error'; error.hidden = true; error.setAttribute('role', 'alert');
  const gridElement = element('div', 'grid-stack home-grid'); const widgetElements = new Map(); const bodies = new Map(); const toggles = new Map();
  for (const [id, name] of Object.entries(widgetNames)) {
    const widget = element('section', 'grid-stack-item'); widget.dataset.widget = id; widget.setAttribute('gs-id', id); widget.setAttribute('aria-label', name);
    const content = element('div', 'grid-stack-item-content'); const heading = element('header', 'home-widget-heading'); const grip = element('span', 'home-drag-handle'); grip.append(createElement(GripVertical, { width: 14, height: 14 })); grip.title = '移动模块'; const headingText = element('h3', '', name); heading.append(grip, headingText); const body = element('div', 'home-widget-body'); content.append(heading, body); widget.append(content); gridElement.append(widget); widgetElements.set(id, widget); bodies.set(id, body);
    const option = element('label'); const toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = true; toggle.dataset.homeWidget = id; option.append(toggle, document.createTextNode(name)); menuBody.append(option); toggles.set(id, toggle);
    toggle.onchange = async () => { if (!grid || busy) return; if (!toggle.checked && [...toggles.values()].filter(value => value.checked).length === 0) { toggle.checked = true; return; } if (toggle.checked) { widget.hidden = false; grid.makeWidget(widget, { ...workspaceLayout().find(item => item.id === id), autoPosition: true }); } else { grid.removeWidget(widget, false); widget.hidden = true; } await saveLayout(); calendar?.updateSize(); };
  }
  root.append(toolbar, summary, status, error, overview, gridElement); container.append(root);
  function showHomeSurface(next, persist = true) {
    homeSurface = next; root.dataset.homeSurface = next;
    overview.hidden = next !== 'overview'; gridElement.hidden = next !== 'panels'; summary.hidden = next !== 'panels';
    tools.hidden = next !== 'panels'; date.hidden = next !== 'panels';
    overviewTab.setAttribute('aria-selected', String(next === 'overview')); panelsTab.setAttribute('aria-selected', String(next === 'panels'));
    if (next === 'panels') { grid?.onResize(); calendar?.updateSize(); }
    if (persist) void api.setSetting('home-surface', next).catch(fail);
  }
  overviewTab.onclick = () => showHomeSurface('overview'); panelsTab.onclick = () => showHomeSurface('panels');
  async function revealWidget(id) {
    showHomeSurface('panels'); const widget = widgetElements.get(id);
    if (widget.hidden) { toggles.get(id).checked = true; await toggles.get(id).onchange(); }
    widget.scrollIntoView({ block: 'nearest' });
  }
  overviewCapture.onclick = () => revealWidget('capture').then(() => title.focus()).catch(fail);
  overviewTasks.onclick = () => revealWidget('tasks').catch(fail);
  showHomeSurface(homeSurface, false);
  const captureForm = element('form', 'home-capture'); captureForm.id = 'home-capture'; const modes = element('div', 'segmented-control ux-pill-bar'); modes.setAttribute('role', 'tablist'); modes.setAttribute('aria-label', '收集类型'); const modeButtons = new Map();
  const kindTones = { memo: 'teal', task: 'amber', project: 'purple', reading: 'blue' };
  for (const [kind, name] of Object.entries(kindNames)) { const mode = element('button', 'ux-pill-option', name); mode.type = 'button'; mode.dataset.captureKind = kind; mode.dataset.pillTone = kindTones[kind] || 'teal'; mode.setAttribute('role', 'tab'); mode.onclick = () => { draft.kind = kind; renderDraft(); scheduleDraft(); }; modes.append(mode); modeButtons.set(kind, mode); }
  const title = element('input'); title.id = 'capture-title'; title.placeholder = '标题'; title.setAttribute('aria-label', '收集标题'); title.maxLength = 160;
  const text = element('textarea'); text.id = 'capture-text'; text.placeholder = '此刻记下...'; text.setAttribute('aria-label', '收集正文'); text.maxLength = 100000; text.rows = 3;
  const taskFields = element('div', 'capture-task-fields'); const due = element('input'); due.type = 'date'; due.id = 'capture-due'; due.setAttribute('aria-label', '任务日期'); const time = element('input'); time.type = 'time'; time.id = 'capture-time'; time.setAttribute('aria-label', '提醒时间');
  const priority = element('select'); priority.id = 'capture-priority'; priority.setAttribute('aria-label', '任务优先级'); priority.append(new Option('普通', 'normal'), new Option('重要', 'high'), new Option('低优先级', 'low')); const project = element('select'); project.id = 'capture-project'; project.setAttribute('aria-label', '所属项目'); project.append(new Option('无项目', ''));
  const recurrence = recurrenceInputs('capture', values => { Object.assign(draft, values); scheduleDraft(); });
  taskFields.append(due, time, priority, project, recurrence.root); const captureFooter = element('div', 'capture-footer'); const submit = button(Plus, '保存收集', '收集'); submit.type = 'submit'; submit.id = 'capture-save'; const draftState = element('small'); draftState.id = 'capture-draft-state'; captureFooter.append(draftState, submit); captureForm.append(modes, title, text, taskFields, captureFooter); bodies.get('capture').append(captureForm);
  for (const [key, input] of Object.entries({ title, text, due, time, priority, project })) input.addEventListener('input', () => { draft[key] = input.value; text.required = draft.kind === 'memo' && !draft.title.trim(); scheduleDraft(); }, { signal: scope.signal });
  captureForm.onsubmit = async event => {
    event.preventDefault(); if (busy || !vaultKey) return; error.hidden = true;
    const heading = draft.title.trim() || (draft.kind === 'memo' ? draft.text.trim().split('\n')[0].slice(0, 80) : ''); if (!heading) { title.focus(); return; }
    const now = new Date(); draft.created ||= localDay(now) + 'T' + now.toTimeString().slice(0, 8); draft.captureId ||= crypto.randomUUID();
    const captured = { ...draft }; const created = captured.created; const filename = heading.slice(0, 70) + ' ' + created.replaceAll(':', '').replace('T', ' ') + '-' + captured.captureId;
    busy = true; setBusy(); const finishStatus = startStatus('正在收集');
    try {
      const source = captureSource({ ...captured, title: heading, created });
      await saveDraft(false, true);
      await api.createNote(filename, { folder: captured.kind === 'memo' ? 'memos' : captured.kind === 'task' ? 'tasks' : captured.kind === 'project' ? 'projects' : 'reading', source, background: true });
      draft = { ...draft, title: '', text: '', created: '', captureId: '' }; await saveDraft(true); if (scope.signal.aborted) return;
      renderDraft(); finishStatus('已收集到 Markdown');
    } catch (reason) { finishStatus('收集未完成'); fail(reason); }
    finally { busy = false; if (!scope.signal.aborted) { await refresh(); setBusy(); } }
  };

  const taskToolbar = element('div', 'home-task-toolbar'); const taskFilter = element('select'); taskFilter.id = 'home-task-filter'; taskFilter.setAttribute('aria-label', '任务范围'); taskFilter.append(...[['open', '未完成'], ['today', '今天'], ['overdue', '逾期'], ['done', '已完成'], ['all', '全部']].map(([value, label]) => new Option(label, value)));
  const taskSearch = element('input'); taskSearch.type = 'search'; taskSearch.id = 'home-task-search'; taskSearch.placeholder = '筛选任务'; taskSearch.setAttribute('aria-label', '筛选任务'); const projectFilter = element('select'); projectFilter.id = 'home-project-filter'; projectFilter.setAttribute('aria-label', '任务项目'); projectFilter.append(new Option('全部项目', ''));
  const taskModes = element('div', 'segmented-control ux-pill-bar'); taskModes.setAttribute('role', 'tablist'); taskModes.setAttribute('aria-label', '任务视图');
  for (const [mode, label, tone] of [['list', '清单', 'teal'], ['board', '看板', 'purple']]) { const toggle = element('button', 'ux-pill-option', label); toggle.type = 'button'; toggle.dataset.taskMode = mode; toggle.dataset.pillTone = tone; toggle.setAttribute('role', 'tab'); toggle.onclick = async () => { if (busy) return; taskMode = mode; filter = mode === 'board' ? 'all' : 'open'; taskFilter.value = filter; pageIndex = 0; try { await api.setSetting('task-mode', mode); } catch (reason) { fail(reason); } await refresh(); }; taskModes.append(toggle); }
  if (taskMode === 'board') { filter = 'all'; taskFilter.value = 'all'; }
  taskToolbar.append(taskModes, taskFilter, taskSearch, projectFilter); const taskList = element('div', 'home-task-list'); taskList.id = 'home-task-list'; const taskFooter = element('div', 'home-task-footer'); const previous = button(ChevronLeft, '任务上一页'); const next = button(ChevronRight, '任务下一页'); const paging = element('span'); paging.id = 'home-task-page'; taskFooter.append(previous, paging, next); bodies.get('tasks').append(taskToolbar, taskList, taskFooter);
  taskFilter.onchange = () => { filter = taskFilter.value; pageIndex = 0; void refresh(); }; projectFilter.onchange = () => { pageIndex = 0; void refresh(); }; taskSearch.oninput = () => { clearTimeout(queryTimer); queryTimer = setTimeout(() => { pageIndex = 0; void refresh(); }, 160); };
  previous.onclick = () => { pageIndex--; void refresh(); }; next.onclick = () => { pageIndex++; void refresh(); };
  const calendarElement = element('div', 'home-calendar'); calendarElement.id = 'home-calendar'; bodies.get('calendar').append(calendarElement);
  const memoToolbar = element('div', 'home-task-toolbar'); const memoSearch = element('input'); memoSearch.type = 'search'; memoSearch.id = 'home-memo-search'; memoSearch.placeholder = '检索 Memo'; memoSearch.setAttribute('aria-label', '检索 Memo'); const memoArchive = element('select'); memoArchive.id = 'home-memo-archive'; memoArchive.setAttribute('aria-label', 'Memo 范围'); memoArchive.append(new Option('收集箱', 'inbox'), new Option('已归档', 'archived')); memoToolbar.append(memoSearch, memoArchive);
  const memoList = element('div'); memoList.id = 'home-memo-list'; const memoFooter = element('div', 'home-task-footer'); const memoPrevious = button(ChevronLeft, 'Memo 上一页'); const memoNext = button(ChevronRight, 'Memo 下一页'); const memoPaging = element('span'); memoFooter.append(memoPrevious, memoPaging, memoNext); bodies.get('memos').append(memoToolbar, memoList, memoFooter);
  memoSearch.oninput = () => { clearTimeout(queryTimer); queryTimer = setTimeout(() => { memoPage = 0; void refresh(); }, 160); }; memoArchive.onchange = () => { memoPage = 0; void refresh(); }; memoPrevious.onclick = () => { memoPage--; void refresh(); }; memoNext.onclick = () => { memoPage++; void refresh(); };

  const taskEditor = mountTaskEditor(root, { save: changeTask, open: id => api.open(id), closed: () => { void refresh(); } }, scope);
  async function changeTask(task, patch) {
    if (busy || querying) throw new Error('任务数据正在刷新，请稍后重试');
    busy = true; setBusy(); error.hidden = true;
    try { const note = await api.read(task.noteId, { signal: scope.signal }); const source = updateMarkdownTask(note.source, task, patch); if (scope.signal.aborted) throw new Error('任务视图已关闭'); await api.write(task.noteId, note.version, source); }
    finally { busy = false; if (!scope.signal.aborted) { await refresh(); setBusy(); } }
  }
  function fail(reason) { if (!scope.signal.aborted) { error.hidden = false; error.textContent = reason.message || String(reason); } }
  function setBusy() { for (const input of captureForm.querySelectorAll('input, textarea, button, select')) input.disabled = busy; recurrence.enable(!busy && draft.kind === 'task'); for (const input of taskList.querySelectorAll('input, select, button')) input.disabled = busy || querying; for (const input of memoList.querySelectorAll('[data-archive-memo]')) input.disabled = busy || querying; taskEditor.setBlocked(busy || querying); taskList.setAttribute('aria-busy', String(busy || querying)); submit.setAttribute('aria-busy', String(busy)); }
  function renderDraft() {
    for (const [kind, mode] of modeButtons) mode.setAttribute('aria-selected', String(draft.kind === kind));
    for (const [key, input] of Object.entries({ title, text, due, time, priority, project })) if (document.activeElement !== input) input.value = draft[key] || '';
    taskFields.hidden = draft.kind !== 'task'; title.required = draft.kind !== 'memo'; text.required = draft.kind === 'memo' && !draft.title.trim();
    recurrence.fill(draft);
    recurrence.enable(!busy && draft.kind === 'task');
  }
  function scheduleDraft() { draftState.textContent = '草稿未保存'; clearTimeout(draftTimer); draftTimer = setTimeout(() => void saveDraft(), 350); }
  async function saveDraft(force = false, strict = false) {
    if (!vaultKey || (scope.signal.aborted && !force)) return; clearTimeout(draftTimer);
    try { const nextDrafts = { ...drafts, [vaultKey]: { ...draft } }; await api.setSetting('drafts', nextDrafts); drafts = nextDrafts; if (!scope.signal.aborted) draftState.textContent = '草稿已保存'; }
    catch (reason) { draftState.textContent = '草稿未保存'; fail(reason); if (strict) throw reason; }
  }
  async function saveLayout() {
    if (!grid || !vaultKey || restoring) return;
    const finishStatus = startStatus('正在保存布局');
    const layout = workspaceLayout(grid.save(false, false, undefined, 12)); const nextLayouts = { ...layouts, [vaultKey]: { template: template.value, layout } };
    try { await api.setSetting('layouts', nextLayouts); layouts = nextLayouts; lastLayout = layout; finishStatus('布局已保存'); }
    catch (reason) { finishStatus('布局未保存'); fail(reason); if (!scope.signal.aborted) restoreLayout(lastLayout); }
  }
  function restoreLayout(layout) {
    restoring = true; const ids = new Set(layout.map(item => item.id));
    if (!grid) grid = GridStack.init({ column: 12, cellHeight: 40, margin: 6, animate: false, float: false, handle: '.home-drag-handle', disableDrag: true, disableResize: true, columnOpts: { breakpointForWindow: false, breakpoints: [{ w: 660, c: 1 }] }, resizable: { handles: 'se' } }, gridElement);
    grid.batchUpdate();
    for (const [id, widget] of widgetElements) { if (!ids.has(id)) { if (widget.gridstackNode) grid.removeWidget(widget, false); widget.hidden = true; } else { widget.hidden = false; if (!widget.gridstackNode) grid.makeWidget(widget, { ...layout.find(item => item.id === id), minW: 3, minH: 3 }); } toggles.get(id).checked = ids.has(id); }
    grid.load(layout, false); grid.batchUpdate(false); restoring = false; calendar?.updateSize();
  }
  function openNote(note) { const item = button(ArrowUpRight, '打开 ' + note.title, note.title); item.classList.add('home-note-open'); item.dataset.homeNoteId = note.id; item.onclick = () => api.open(note.id); return item; }
  function renderOverview() {
    if (!result?.overview) return;
    const data = result.overview; const counts = new Map(data.activityDays.map(item => [item.date, item.count]));
    activityGrid.replaceChildren(); activityGrid.style.setProperty('--activity-weeks', String(Math.ceil(overviewDays / 7)));
    for (const option of periodControl.children) option.setAttribute('aria-pressed', String(Number(option.dataset.activityDays) === overviewDays));
    let activeDays = 0; let periodNotes = 0;
    for (let offset = overviewDays - 1; offset >= 0; offset--) {
      const current = new Date(); current.setDate(current.getDate() - offset); const day = localDay(current); const count = counts.get(day) || 0;
      const cell = element('button', 'home-activity-cell'); cell.type = 'button'; cell.dataset.level = String(Math.min(4, count)); cell.dataset.activityDate = day;
      cell.title = day + ' · ' + count + ' 篇笔记'; cell.setAttribute('aria-label', cell.title); cell.setAttribute('aria-pressed', String(day === overviewDate));
      cell.onclick = () => { overviewDate = day === overviewDate ? '' : day; void refresh(); }; activityGrid.append(cell);
      if (count) activeDays++; periodNotes += count;
    }
    activityStats.textContent = `${activeDays} 个记录日 · ${periodNotes} 篇日期内笔记 · ${data.totalNotes} 篇总计${data.undatedNotes ? ` · ${data.undatedNotes} 篇未标日期` : ''}`;
    activityStats.title = '依据笔记 created 或 date 字段；不代表编辑次数。';
    if (data.writingSprint) {
      const sp = data.writingSprint;
      sprintSummary.textContent = `🎯 今日 ${sp.todayWords} / ${sp.dailyGoalWords} 字 (${sp.dailyProgressPct}%) · 全库 ${sp.totalVaultWords} 字 · 连续 ${sp.currentStreakDays} 天`;
      sprintMilestones.replaceChildren();
      for (const ms of sp.milestones || []) {
        const row = element('small', 'home-sprint-milestone-item', `${ms.reached ? '✅' : '⏳'} ${ms.title}：${ms.current}/${ms.target}${ms.unit} (${ms.progressPct}%)`);
        row.dataset.milestoneId = ms.id;
        sprintMilestones.append(row);
      }
    }
    recentTitle.textContent = overviewDate ? overviewDate + ' 的记录' : '最近记录'; clearDay.hidden = !overviewDate; recentList.replaceChildren();
    for (const note of data.recent) {
      const row = element('article', 'home-overview-note'); const heading = openNote(note);
      row.append(heading, element('small', '', [note.folder, note.updated || '未标日期'].filter(Boolean).join(' · ')));
      if (note.excerpt) row.append(element('p', '', note.excerpt)); recentList.append(row);
    }
    if (!data.recent.length) recentList.append(element('p', 'empty-state', '暂无记录'));
    focusList.replaceChildren();
    for (const task of result.tasks.filter(task => !task.done).slice(0, 4)) {
      const row = element('div', 'home-focus-item'); const open = element('button', 'home-task-title', task.title); open.type = 'button'; open.onclick = () => taskEditor.open(task);
      row.append(open, element('small', '', task.due || '未设日期')); focusList.append(row);
    }
    if (!focusList.children.length) focusList.append(element('p', 'empty-state', '暂无待办'));
    inspirationList.replaceChildren();
    for (const note of result.starred.slice(0, 3)) { const row = element('article', 'home-focus-item'); row.append(openNote(note)); if (note.excerpt) row.append(element('p', '', note.excerpt.slice(0, 100))); inspirationList.append(row); }
    if (!inspirationList.children.length) inspirationList.append(element('p', 'empty-state', '暂无星标'));
  }
  function render() {
    renderOverview();
    root.dataset.ready = 'true'; summary.replaceChildren();
    for (const [label, value] of [['未完成', result.counts.open], ['今天', result.counts.today], ['逾期', result.counts.overdue], ['已完成', result.counts.done]]) { const metric = element('span'); metric.append(element('strong', '', String(value)), document.createTextNode(label)); summary.append(metric); }
    const selectedProject = projectFilter.value; project.replaceChildren(new Option('无项目', '')); projectFilter.replaceChildren(new Option('全部项目', ''));
    for (const item of result.projects) { project.append(new Option(item.title, item.id)); projectFilter.append(new Option(item.title, item.id)); }
    project.value = draft.project; projectFilter.value = selectedProject;
    taskList.replaceChildren();
    taskList.dataset.mode = taskMode; for (const toggle of taskModes.children) toggle.setAttribute('aria-selected', String(toggle.dataset.taskMode === taskMode));
    const columns = new Map();
    if (taskMode === 'board') for (const [state, label] of Object.entries(stateLabels)) {
      const column = element('section', 'task-board-column'); column.dataset.taskColumn = state; column.append(element('h4', '', label + ' · ' + result.tasks.filter(task => task.state === state).length));
      column.ondragover = event => { if (draggingTask && !busy) event.preventDefault(); };
      column.ondrop = event => { event.preventDefault(); const task = draggingTask; draggingTask = null; if (task) void changeTask(task, { state }).catch(fail); };
      taskList.append(column); columns.set(state, column);
    }
    for (const task of result.tasks) {
      const row = element('div', 'home-task-row'); row.dataset.taskId = task.id; row.dataset.completed = String(task.done); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = task.done; checkbox.setAttribute('aria-label', '完成 ' + task.title); checkbox.dataset.taskCheck = task.id;
      const copy = element('div', 'home-task-copy'); const open = element('button', 'home-task-title', task.title); open.type = 'button'; open.onclick = () => api.open(task.noteId); const meta = element('small', '', [task.noteTitle, task.due, task.time, task.priority === 'high' ? '重要' : '', task.repeat ? repeatLabels[task.repeat] : '', task.planningError].filter(Boolean).join(' · ')); copy.append(open, meta); if (task.due && task.due < localDay() && !task.done) row.classList.add('overdue');
      const state = element('select', 'task-state-select'); state.setAttribute('aria-label', task.title + '状态'); state.append(...Object.entries(stateLabels).map(([value, label]) => new Option(label, value))); state.value = task.state; state.onchange = () => void changeTask(task, { state: state.value }).catch(fail);
      const edit = button(Pencil, '编辑 ' + task.title); edit.dataset.editTask = task.id; edit.onclick = () => taskEditor.open(task); const actions = element('div', 'task-row-actions'); actions.append(state, edit); copy.append(actions); row.append(checkbox, copy); (columns.get(task.state) || taskList).append(row);
      row.draggable = taskMode === 'board'; row.ondragstart = event => { if (busy || querying) { event.preventDefault(); return; } draggingTask = task; event.dataTransfer.setData('application/x-inkloom-task', task.id); event.dataTransfer.effectAllowed = 'move'; };
      row.ondragend = () => { draggingTask = null; if (refreshAfterDrag) { refreshAfterDrag = false; void refresh(); } };
      checkbox.onchange = async () => {
        if (busy || querying) { checkbox.checked = task.done; return; }
        try { await changeTask(task, { state: checkbox.checked ? 'done' : 'todo' }); }
        catch (reason) { checkbox.checked = task.done; fail(reason); }
      };
    }
    if (!result.tasks.length) taskList.append(element('p', 'empty-state', '没有符合条件的任务'));
    pageIndex = result.page; paging.textContent = result.total + ' 项 · ' + (pageIndex + 1) + '/' + Math.max(1, Math.ceil(result.total / 50)); previous.disabled = pageIndex === 0; next.disabled = (pageIndex + 1) * 50 >= result.total;
    for (const [kind, notes, empty] of [['memos', result.memos, '尚无 Memo'], ['starred', result.starred, '尚无星标笔记']]) {
      const body = kind === 'memos' ? memoList : bodies.get(kind); body.replaceChildren();
      for (const note of notes) {
        const row = element('article', 'home-note-row'); const heading = element('div', 'home-memo-heading'); heading.append(openNote(note));
        if (kind === 'memos') {
          const archived = note.status === 'archived'; const archive = button(archived ? ArchiveRestore : Archive, archived ? '恢复 Memo' : '归档 Memo'); archive.dataset.archiveMemo = note.id; archive.onclick = async () => {
            if (busy) return; busy = true; setBusy(); archive.disabled = true;
            try { const current = await api.read(note.id, { signal: scope.signal }); if (!scope.signal.aborted) await api.updateProperties(note.id, current.version, { status: archived ? 'note' : 'archived' }); }
            catch (reason) { fail(reason); } finally { busy = false; if (!scope.signal.aborted) { await refresh(); setBusy(); } }
          }; heading.append(archive);
        }
        row.append(heading, element('small', '', note.created.replace('T', ' ') || note.date), element('p', '', note.excerpt)); body.append(row);
      }
      if (!notes.length) body.append(element('p', 'empty-state', empty));
    }
    memoPage = result.memoPage; memoPaging.textContent = result.memoTotal + ' 条 · ' + (memoPage + 1); memoPrevious.disabled = memoPage === 0; memoNext.disabled = (memoPage + 1) * 20 >= result.memoTotal;
    const projects = bodies.get('projects'); projects.replaceChildren(); for (const note of result.projects) { const row = element('div', 'home-project-row'); const progress = element('progress'); progress.max = Math.max(1, note.total); progress.value = note.done; progress.setAttribute('aria-label', note.title + '完成进度'); const meta = element('small', '', note.done + ' / ' + note.total + (note.noteCount ? ' · ' + note.noteCount + ' 篇关联' : '')); row.append(openNote(note), progress, meta); projects.append(row); } if (!result.projects.length) projects.append(element('p', 'empty-state', '尚无项目'));
    calendar?.batchRendering(() => { calendar.removeAllEvents(); calendar.addEventSource(result.calendar.map(task => ({ id: task.id, title: task.kind === 'whiteboard' ? task.title : ((task.done ? '✓ ' : '') + task.title), start: task.due + (task.time ? 'T' + task.time + ':00' : ''), allDay: !task.time, startEditable: task.kind !== 'whiteboard' && !task.done, durationEditable: false, classNames: [task.kind === 'whiteboard' ? 'task-journal' : task.done ? 'task-complete' : task.due < localDay() ? 'task-overdue' : 'task-open'], extendedProps: { noteId: task.noteId, task } }))); });
    if (result.calendarTruncated) status.textContent = '当前日历范围超过 400 项，已显示前 400 项';
  }
  async function refresh() {
    if (taskEditor.isOpen) return;
    if (draggingTask || pointerActive) { refreshAfterDrag = true; return; }
    if (scope.signal.aborted || busy) return; const token = ++request; querying = true; setBusy();
    try {
      const nextResult = await api.queryWorkspace({ today: localDay(), overviewDate, dailyGoalWords: Number(dailyGoalInput.value) || 1000, projectGoalWords: Number(projectGoalInput.value) || 20000, ...calendarRange, filter, text: taskSearch.value, project: projectFilter.value, page: pageIndex, memoText: memoSearch.value, memoArchive: memoArchive.value === 'archived', memoPage }, { signal: scope.signal, key: 'home-workspace' });
      if (scope.signal.aborted || token !== request) return;
      if (draggingTask || pointerActive || taskEditor.isOpen) { refreshAfterDrag = true; return; }
      if (vaultKey !== nextResult.vaultKey) {
        vaultKey = nextResult.vaultKey; layouts = api.getSetting('layouts') || {}; drafts = api.getSetting('drafts') || {}; draft = { kind: 'memo', title: '', text: '', due: '', time: '', priority: 'normal', project: '', ...(drafts[vaultKey] || {}) }; renderDraft();
        const saved = layouts[vaultKey]; template.value = saved?.template || 'balanced'; lastLayout = workspaceLayout(saved?.layout, template.value); restoreLayout(lastLayout);
        grid.off('dragstop'); grid.off('resizestop'); grid.on('dragstop resizestop', () => { void saveLayout(); calendar?.updateSize(); });
        if (!calendar) { calendar = new Calendar(calendarElement, { plugins: [dayGridPlugin, interactionPlugin], locale: zhLocale, initialView: 'dayGridMonth', height: '100%', headerToolbar: { left: 'prev,next today', center: 'title', right: '' }, dayMaxEvents: 2, fixedWeekCount: false, editable: true, eventClick: info => { const item = info.event.extendedProps.task; if (item?.kind === 'whiteboard') void api.open(item.noteId).catch(fail); else taskEditor.open(item); }, eventDrop: info => { const task = info.event.extendedProps.task; if (task?.kind === 'whiteboard') { info.revert(); return; } void changeTask(task, { due: localDay(info.event.start) }).catch(reason => { if (!scope.signal.aborted) info.revert(); fail(reason); }); }, dateClick: info => { draft.kind = 'task'; draft.due = info.dateStr; renderDraft(); scheduleDraft(); toggles.get('capture').checked = true; const captureWidget = widgetElements.get('capture'); if (captureWidget.hidden) { captureWidget.hidden = false; grid.makeWidget(captureWidget, { ...workspaceLayout()[0], autoPosition: true }); } title.focus(); }, datesSet: info => { const nextStart = info.startStr.slice(0, 10); const nextEnd = info.endStr.slice(0, 10); const hadRange = Boolean(calendarRange.start && calendarRange.end); if (calendarRange.start === nextStart && calendarRange.end === nextEnd) return; calendarRange = { start: nextStart, end: nextEnd }; if (hadRange) queueMicrotask(() => void refresh()); } }); calendar.render(); }
      }
      result = nextResult; render();
    } catch (reason) { if (reason.name !== 'AbortError') fail(reason); }
    finally { if (token === request && !scope.signal.aborted) { querying = false; setBusy(); } }
  }
  customize.onclick = () => { editing = !editing; root.dataset.editing = String(editing); customize.setAttribute('aria-pressed', String(editing)); customize.replaceChildren(createElement(editing ? Check : Pencil, { width: 15, height: 15 })); customize.title = editing ? '完成布局编辑' : '编辑工作台布局'; grid?.enableMove(editing); grid?.enableResize(editing); };
  template.onchange = async () => { restoreLayout(workspaceLayout(null, template.value)); await saveLayout(); };
  reset.onclick = async () => { template.value = 'balanced'; restoreLayout(workspaceLayout()); await saveLayout(); };
  exportTemplate.onclick = async () => {
    if (busy || !vaultKey) return;
    error.hidden = true;
    try {
      const dbTemplates = api.getSetting('database-template') || {};
      const pack = createWorkspaceTemplate({
        name: (template.selectedOptions[0]?.textContent || '日常') + '工作台模板',
        template: template.value,
        layout: lastLayout.length ? lastLayout : workspaceLayout(null, template.value),
        taskMode,
        databaseView: dbTemplates[vaultKey] || {},
      });
      const filename = 'inkloom-' + template.value + '.inkloom-workspace.json';
      const handle = window.showSaveFilePicker ? await window.showSaveFilePicker({ suggestedName: filename }) : null;
      const blob = new Blob([JSON.stringify(pack, null, 2) + '\n'], { type: 'application/json' });
      if (handle) {
        const writable = await handle.createWritable();
        try { await writable.write(blob); await writable.close(); } catch (err) { await writable.abort().catch(() => {}); throw err; }
      } else {
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      startStatus('工作台模板已导出')('工作台模板已导出');
    } catch (reason) { if (reason?.name !== 'AbortError') fail(reason); }
  };
  importTemplate.onclick = () => { if (!busy) importTemplateFile.click(); };
  importTemplateFile.onchange = async () => {
    const selected = importTemplateFile.files?.[0];
    if (!selected || busy || !vaultKey) return;
    error.hidden = true;
    const prevTemplate = template.value; const prevLayout = lastLayout.map(item => ({ ...item })); const prevLayouts = { ...layouts };
    const prevTaskMode = taskMode; const prevFilter = filter;
    const prevDbTemplates = { ...(api.getSetting('database-template') || {}) };
    const finishStatus = startStatus('正在导入工作台模板');
    try {
      if (selected.size > 256 * 1024) throw new Error('工作台模板超过 256 KiB 上限');
      const verified = validateWorkspaceTemplate(JSON.parse(await selected.text()));
      const nextLayouts = { ...layouts, [vaultKey]: { template: verified.template, layout: verified.layout } };
      const nextDbTemplates = { ...prevDbTemplates, [vaultKey]: verified.databaseView };
      await api.setSetting('layouts', nextLayouts);
      await api.setSetting('task-mode', verified.taskMode);
      await api.setSetting('database-template', nextDbTemplates);
      layouts = nextLayouts;
      template.value = verified.template;
      lastLayout = verified.layout;
      restoreLayout(verified.layout);
      taskMode = verified.taskMode;
      filter = taskMode === 'board' ? 'all' : 'open';
      taskFilter.value = filter;
      finishStatus('已导入工作台模板：' + verified.name);
      await refresh();
    } catch (reason) {
      layouts = prevLayouts; template.value = prevTemplate; lastLayout = prevLayout; restoreLayout(prevLayout);
      taskMode = prevTaskMode; filter = prevFilter; taskFilter.value = prevFilter;
      await api.setSetting('layouts', prevLayouts).catch(() => {});
      await api.setSetting('task-mode', prevTaskMode).catch(() => {});
      await api.setSetting('database-template', prevDbTemplates).catch(() => {});
      finishStatus('模板未导入');
      fail(reason);
    } finally { importTemplateFile.value = ''; }
  };
  root.addEventListener('pointerdown', () => { pointerActive = true; }, { signal: scope.signal });
  const finishPointer = () => {
    pointerActive = false; if (!refreshAfterDrag) return; cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => { if (!scope.signal.aborted) { refreshAfterDrag = false; void refresh(); } });
  };
  for (const event of ['pointerup', 'pointercancel', 'dragend']) document.addEventListener(event, finishPointer, { signal: scope.signal });
  scope.own(() => cancelAnimationFrame(pointerFrame));
  scope.own(api.on('vault.changed', () => refresh()));
  scope.own(api.on('workspace.appearance', () => { calendar?.updateSize(); }));
  const resize = new ResizeObserver(() => calendar?.updateSize()); resize.observe(root); scope.own(() => resize.disconnect());
  scope.own(api.interval(() => refresh(), 60000));
  renderDraft(); void refresh();
  return () => { clearTimeout(queryTimer); clearTimeout(draftTimer); if (!busy) void saveDraft(true); request++; calendar?.destroy(); grid?.destroy(false); root.remove(); };
}