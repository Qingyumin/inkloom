import { createTable, getCoreRowModel } from '@tanstack/table-core';
import { createElement, Table2, Columns3, ArrowUpDown, FileText, ChevronLeft, ChevronRight } from 'lucide';
import { normalizeSavedDatabaseViews, saveDatabaseViewPreset, renameDatabaseViewPreset, deleteDatabaseViewPreset, reorderDatabaseViewPresets, computeBatchTagPatch, resolveShiftRangeIds, exportDatabaseRowsToCsv, exportDatabaseRowsToMarkdownTable, parseDatabaseCsvPropertyUpdates } from '../../core/database-query.mjs';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(icon, label, text = '') {
  const node = element('button', text ? 'phase-command' : 'icon-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
  node.append(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' })); if (text) node.append(element('span', '', text)); return node;
}

export function activate(api) {
  const filters = { query: '', folder: '', tag: '', status: '', groupBy: '', propertyKey: '', propertyValue: '', sortBy: 'title', sortDir: 'asc' };
  let pagination = { pageIndex: 0, pageSize: 50 };
  api.registerSetting({ id: 'view-mode', name: '默认视图', type: 'choice', default: 'table', options: [{ label: '表格', value: 'table' }, { label: '看板', value: 'board' }] });
  api.registerSetting({ id: 'compact-mode', name: '紧凑行距', type: 'boolean', default: false });
  api.registerSetting({ id: 'page-size', name: '每页笔记', type: 'choice', default: 50, options: [10, 25, 50, 100].map(value => ({ label: String(value), value })) });
  api.registerSetting({ id: 'dimensions', name: '多维视图分组与属性列', type: 'data', default: {} });
  api.registerSetting({ id: 'saved-views', name: '常驻视图预设页签', type: 'data', default: [] });
  const view = api.registerView({ id: 'database-view', target: 'database', name: '笔记视图', icon: 'table-2', location: 'activity', order: 50, mount });
  api.registerCommand({ id: 'open-views', name: '打开笔记视图', run: () => api.showView(view) });

  function mount(container, scope) {
    let lastConfiguredViewMode = api.getSetting('view-mode') || 'table';
    let mode = lastConfiguredViewMode; let result; let busy = false; let request = 0; let queryTimer;
    let pointerActive = false; let refreshDeferred = false;
    let savedViews = normalizeSavedDatabaseViews(api.getSetting('saved-views'));
    let activeViewId = 'all-notes';
    let draggingViewId = '';
    const selectedNoteIds = new Set();
    let lastSelectedNoteId = '';
    const savedDimensions = api.getSetting('dimensions') || {};
    if (typeof savedDimensions.groupBy === 'string') filters.groupBy = savedDimensions.groupBy;
    if (typeof savedDimensions.propertyKey === 'string') filters.propertyKey = savedDimensions.propertyKey;
    pagination = { ...pagination, pageSize: Number(api.getSetting('page-size')) || 50 };
    const database = element('section', 'database-stage'); database.id = 'database-stage'; database.setAttribute('aria-label', '笔记视图');
    const toolbar = element('div', 'database-toolbar'); const modes = element('div', 'segmented-control ux-pill-bar'); modes.setAttribute('role', 'tablist'); modes.setAttribute('aria-label', '笔记视图');
    const tableButton = button(Table2, '表格视图', '表格'); tableButton.id = 'database-table-mode'; tableButton.dataset.viewMode = 'table'; tableButton.dataset.pillTone = 'teal'; tableButton.classList.add('ux-pill-option'); tableButton.setAttribute('role', 'tab');
    const boardButton = button(Columns3, '看板视图', '看板'); boardButton.id = 'database-board-mode'; boardButton.dataset.viewMode = 'board'; boardButton.dataset.pillTone = 'purple'; boardButton.classList.add('ux-pill-option'); boardButton.setAttribute('role', 'tab');
    modes.append(tableButton, boardButton);
    const savedViewsBar = element('div', 'segmented-control ux-pill-bar database-saved-views-bar');
    savedViewsBar.id = 'database-saved-views-bar';
    savedViewsBar.setAttribute('role', 'tablist');
    savedViewsBar.setAttribute('aria-label', '常驻视图预设页签');
    const viewManageMenu = element('details', 'ux-popover-menu');
    viewManageMenu.id = 'database-view-manage-menu';
    const viewManageTrigger = element('summary', 'ux-popover-trigger', '视图管理 ▾');
    viewManageTrigger.id = 'database-view-manage-trigger';
    viewManageTrigger.setAttribute('aria-label', '自定义视图管理菜单');
    const presetControls = element('div', 'ux-popover-panel database-view-preset-controls');
    presetControls.id = 'database-view-preset-controls';
    const presetNameInput = element('input');
    presetNameInput.type = 'text';
    presetNameInput.id = 'database-preset-name';
    presetNameInput.maxLength = 40;
    presetNameInput.placeholder = '视图名称...';
    presetNameInput.setAttribute('aria-label', '视图预设名称');
    const saveViewBtn = element('button', 'small-command', '保存视图');
    saveViewBtn.type = 'button';
    saveViewBtn.id = 'database-save-view-btn';
    const renameViewBtn = element('button', 'small-command', '重命名');
    renameViewBtn.type = 'button';
    renameViewBtn.id = 'database-rename-view-btn';
    const deleteViewBtn = element('button', 'small-command', '删除视图');
    deleteViewBtn.type = 'button';
    deleteViewBtn.id = 'database-delete-view-btn';
    const exportCsvBtn = element('button', 'small-command', '导出 CSV');
    exportCsvBtn.type = 'button';
    exportCsvBtn.id = 'database-export-csv-btn';
    const saveMdTableBtn = element('button', 'small-command', '存为汇总笔记');
    saveMdTableBtn.type = 'button';
    saveMdTableBtn.id = 'database-save-md-table-btn';
    const csvSampleBtn = element('button', 'small-command', 'CSV属性示例');
    csvSampleBtn.type = 'button';
    csvSampleBtn.id = 'database-csv-sample-btn';
    const csvImportInput = element('textarea', 'database-csv-import-input');
    csvImportInput.id = 'database-csv-import-input';
    csvImportInput.rows = 3;
    csvImportInput.placeholder = '粘贴 CSV 批量更新属性（如：title,status,tags,priority）...';
    csvImportInput.setAttribute('aria-label', 'CSV 批量属性贴入');
    const csvApplyBtn = element('button', 'phase-command obs-primary-btn', '同步 CSV 属性到笔记');
    csvApplyBtn.type = 'button';
    csvApplyBtn.id = 'database-csv-apply-btn';
    const csvStatus = element('small', '', '');
    csvStatus.id = 'database-csv-status';
    presetControls.append(
      presetNameInput,
      saveViewBtn,
      renameViewBtn,
      deleteViewBtn,
      exportCsvBtn,
      saveMdTableBtn,
      csvSampleBtn,
      csvImportInput,
      csvApplyBtn,
      csvStatus,
    );
    viewManageMenu.append(viewManageTrigger, presetControls);
    toolbar.append(modes, savedViewsBar, viewManageMenu);
    const filterRow = element('div', 'database-filters'); const search = element('input'); search.type = 'search'; search.id = 'database-query'; search.placeholder = '筛选笔记'; search.setAttribute('aria-label', '筛选笔记'); search.value = filters.query; filterRow.append(search);
    const selects = new Map();
    for (const [key, label] of [['folder', '全部目录'], ['tag', '全部标签'], ['status', '全部状态'], ['groupBy', '不分组'], ['propertyKey', '属性列'], ['sortBy', '排序']]) {
      const select = element('select'); select.id = 'database-' + key; select.dataset.filter = key; select.setAttribute('aria-label', label); selects.set(key, { select, label }); filterRow.append(select);
    }
    const propertySearch = element('input'); propertySearch.type = 'search'; propertySearch.id = 'database-property-value'; propertySearch.placeholder = '按属性值筛选'; propertySearch.setAttribute('aria-label', '按属性值筛选'); propertySearch.value = filters.propertyValue; propertySearch.hidden = !filters.propertyKey; filterRow.append(propertySearch);
    const order = button(ArrowUpDown, '切换排序方向'); order.id = 'database-sort-direction'; filterRow.append(order);
    const count = element('span', 'database-count'); count.id = 'database-count';
    const summaryBar = element('div', 'database-summary'); summaryBar.id = 'database-summary';
    const groupBar = element('div', 'database-groups'); groupBar.id = 'database-groups'; groupBar.hidden = true;
    const batchBar = element('div', 'database-batch-bar'); batchBar.id = 'database-batch-bar'; batchBar.hidden = true;
    const batchCount = element('strong', '', '已选 0 篇'); batchCount.id = 'database-batch-count';
    const batchTagInput = element('input'); batchTagInput.type = 'text'; batchTagInput.id = 'database-batch-tag-input'; batchTagInput.maxLength = 48; batchTagInput.placeholder = '#标签名...'; batchTagInput.setAttribute('aria-label', '批量标签名');
    const batchAddTagBtn = element('button', 'small-command', '+标签'); batchAddTagBtn.type = 'button'; batchAddTagBtn.id = 'database-batch-add-tag-btn';
    const batchRemoveTagBtn = element('button', 'small-command', '-标签'); batchRemoveTagBtn.type = 'button'; batchRemoveTagBtn.id = 'database-batch-remove-tag-btn';
    const batchStatusSelect = element('select'); batchStatusSelect.id = 'database-batch-status-select'; batchStatusSelect.setAttribute('aria-label', '批量状态选择');
    for (const st of ['进行中', '已完成', '待办', '草稿', '已读']) batchStatusSelect.append(new Option(st, st));
    const batchStatusBtn = element('button', 'small-command', '批量改状态'); batchStatusBtn.type = 'button'; batchStatusBtn.id = 'database-batch-status-btn';
    const batchFolderInput = element('input'); batchFolderInput.type = 'text'; batchFolderInput.id = 'database-batch-folder-input'; batchFolderInput.maxLength = 160; batchFolderInput.placeholder = '目标目录...'; batchFolderInput.setAttribute('aria-label', '批量移入目录');
    const batchMoveBtn = element('button', 'small-command', '批量移入目录'); batchMoveBtn.type = 'button'; batchMoveBtn.id = 'database-batch-move-btn';
    const batchClearBtn = element('button', 'small-command', '取消多选'); batchClearBtn.type = 'button'; batchClearBtn.id = 'database-batch-clear-btn';
    batchBar.append(batchCount, batchTagInput, batchAddTagBtn, batchRemoveTagBtn, batchStatusSelect, batchStatusBtn, batchFolderInput, batchMoveBtn, batchClearBtn);
    const error = element('div', 'database-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const content = element('div', 'database-content'); content.id = 'database-content';
    const footer = element('div', 'database-pagination'); const previous = button(ChevronLeft, '上一页'); previous.id = 'database-previous'; const next = button(ChevronRight, '下一页'); next.id = 'database-next';
    const page = element('span'); page.id = 'database-page'; const size = element('select'); size.id = 'database-page-size'; size.setAttribute('aria-label', '每页笔记'); size.append(...[10, 25, 50, 100].map(value => new Option(String(value), String(value)))); size.value = String(pagination.pageSize);
    footer.append(previous, page, next, size); database.append(toolbar, filterRow, count, summaryBar, groupBar, batchBar, error, content, footer); container.append(database);
    const table = createTable({
      data: [], columns: [{ accessorKey: 'title' }, { accessorKey: 'status' }, { accessorKey: 'tags' }, { accessorKey: 'date' }, { accessorKey: 'folder' }, { accessorKey: 'degree' }],
      state: { pagination }, getRowId: note => note.id, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: 0,
      onStateChange() {}, renderFallbackValue: '',
      onPaginationChange: update => { pagination = typeof update === 'function' ? update(pagination) : update; refresh(); },
    });
    function fail(reason) { if (!scope.signal.aborted) { error.hidden = false; error.textContent = reason.message || String(reason); } }
    function statusSelect(note) {
      const select = element('select', 'note-status-select'); select.dataset.statusNoteId = note.id; select.setAttribute('aria-label', note.title + '的状态');
      select.append(...result.statuses.map(value => new Option(value, value))); select.value = note.status || '未设状态'; select.disabled = busy; return select;
    }
    const derivedLabels = {
      'formula:task_progress': '公式: 任务完成率(%)',
      'formula:word_progress': '公式: 字数达成率(%)',
      'formula:word_count': '公式: 正文字数',
      'rollup:project_notes': '汇总: 项目关联数',
      'rollup:backlinks': '汇总: 反向链接数',
    };
    function openButton(note) { const node = button(FileText, '打开 ' + note.title, note.title); node.dataset.openNoteId = note.id; node.classList.add('database-note-open'); return node; }
    function propertyInput(note, key) {
      if (key.startsWith('formula:') || key.startsWith('rollup:')) {
        const suffix = key.endsWith('_progress') ? '%' : '';
        const badge = element('span', 'database-derived-cell', (note.propertyValue || '0') + suffix);
        badge.dataset.derivedKey = key;
        return badge;
      }
      const input = element('input', 'database-property-input'); input.type = 'text'; input.maxLength = 240;
      input.dataset.propertyNoteId = note.id; input.dataset.propertyKey = key;
      input.setAttribute('aria-label', note.title + '的' + key);
      input.value = note.propertyValue || '';
      input.disabled = busy;
      return input;
    }
    function applyViewPreset(preset) {
      if (!preset) return;
      activeViewId = preset.id;
      mode = preset.mode === 'board' ? 'board' : 'table';
      Object.assign(filters, {
        query: preset.query || '',
        folder: preset.folder || '',
        tag: preset.tag || '',
        status: preset.status || '',
        groupBy: preset.groupBy || '',
        propertyKey: preset.propertyKey || '',
        propertyValue: preset.propertyValue || '',
        sortBy: preset.sortBy || 'title',
        sortDir: preset.sortDir || 'asc',
      });
      search.value = filters.query;
      propertySearch.value = filters.propertyValue;
      propertySearch.hidden = !filters.propertyKey;
      for (const [key, field] of selects) {
        field.select.value = filters[key] || '';
      }
      presetNameInput.value = preset.id === 'all-notes' ? '' : preset.name;
      pagination.pageIndex = 0;
      renderSavedViewsBar();
      void refresh();
    }
    function renderSavedViewsBar() {
      savedViewsBar.replaceChildren();
      for (const viewTab of savedViews) {
        const btn = element('button', 'ux-pill-option database-view-tab', viewTab.name);
        btn.type = 'button';
        btn.dataset.savedViewId = viewTab.id;
        btn.draggable = true;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(viewTab.id === activeViewId));
        btn.onclick = () => {
          error.hidden = true;
          applyViewPreset(viewTab);
        };
        btn.ondragstart = event => {
          draggingViewId = viewTab.id;
          event.dataTransfer?.setData('application/x-inkloom-db-view', viewTab.id);
        };
        btn.ondragover = event => {
          if (draggingViewId && draggingViewId !== viewTab.id) event.preventDefault();
        };
        btn.ondrop = async event => {
          event.preventDefault();
          const fromId = draggingViewId || event.dataTransfer?.getData('application/x-inkloom-db-view') || '';
          draggingViewId = '';
          if (!fromId || fromId === viewTab.id) return;
          savedViews = reorderDatabaseViewPresets(savedViews, fromId, viewTab.id);
          renderSavedViewsBar();
          await api.setSetting('saved-views', savedViews).catch(fail);
        };
        savedViewsBar.append(btn);
      }
      const isDefaultTab = activeViewId === 'all-notes';
      renameViewBtn.disabled = isDefaultTab || busy;
      deleteViewBtn.disabled = isDefaultTab || busy;
    }
    saveViewBtn.onclick = async () => {
      if (busy) return;
      error.hidden = true;
      try {
        const { views, savedView } = saveDatabaseViewPreset(savedViews, {
          name: presetNameInput.value,
          mode,
          ...filters,
        });
        savedViews = views;
        activeViewId = savedView.id;
        presetNameInput.value = savedView.name;
        renderSavedViewsBar();
        await api.setSetting('saved-views', savedViews);
      } catch (err) {
        fail(err);
      }
    };
    renameViewBtn.onclick = async () => {
      if (busy) return;
      error.hidden = true;
      try {
        const { views, renamedView } = renameDatabaseViewPreset(savedViews, activeViewId, presetNameInput.value);
        savedViews = views;
        presetNameInput.value = renamedView.name;
        renderSavedViewsBar();
        await api.setSetting('saved-views', savedViews);
      } catch (err) {
        fail(err);
      }
    };
    deleteViewBtn.onclick = async () => {
      if (busy) return;
      error.hidden = true;
      try {
        const { views } = deleteDatabaseViewPreset(savedViews, activeViewId);
        savedViews = views;
        applyViewPreset(savedViews[0]);
        await api.setSetting('saved-views', savedViews);
      } catch (err) {
        fail(err);
      }
    };
    exportCsvBtn.onclick = async () => {
      if (busy || !result?.rows) return;
      error.hidden = true;
      try {
        const exported = exportDatabaseRowsToCsv(result.rows, {
          propertyKey: filters.propertyKey,
        });
        window.__inkloomLastExportedDatabaseCsv = exported.csv;
        await navigator.clipboard?.writeText(exported.csv).catch(() => {});
        const blob = new Blob([exported.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = element('a');
        link.href = url;
        link.download = `inkloom-view-${activeViewId || 'all'}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        csvStatus.textContent = `✓ 已导出 ${exported.rowCount} 行 CSV（已同步复制到剪贴板）`;
      } catch (err) {
        fail(err);
      }
    };
    saveMdTableBtn.onclick = async () => {
      if (busy || !result?.rows) return;
      error.hidden = true;
      busy = true;
      database.setAttribute('aria-busy', 'true');
      try {
        const activePreset = savedViews.find(v => v.id === activeViewId);
        const compiled = exportDatabaseRowsToMarkdownTable(result.rows, {
          viewName: activePreset?.name || '全部笔记',
          propertyKey: filters.propertyKey,
          propertyLabel: derivedLabels[filters.propertyKey] || filters.propertyKey,
        });
        const noteName = `${compiled.title} ${crypto.randomUUID().slice(0, 6)}`;
        await api.createNote(noteName, {
          folder: 'reading',
          source: compiled.markdown,
          background: true,
        });
        csvStatus.textContent = `✓ 已保存 ${compiled.rowCount} 行汇总表至 reading/${noteName}.md`;
      } catch (err) {
        fail(err);
      } finally {
        busy = false;
        database.removeAttribute('aria-busy');
        if (!scope.signal.aborted) await refresh();
      }
    };
    csvSampleBtn.onclick = () => {
      const sampleRows = (result?.rows || []).slice(0, 2);
      if (sampleRows.length) {
        csvImportInput.value = [
          'title,status,priority',
          ...sampleRows.map(r => `${r.title},${r.status || '进行中'},high`),
        ].join('\n');
      } else {
        csvImportInput.value = 'title,status,priority\n墨图导览与万象星图,持续演进,high';
      }
      csvStatus.textContent = '已填入当前视图前 2 篇笔记的 CSV 属性示例，点击下方按钮即可同步写回 YAML';
    };
    csvApplyBtn.onclick = async () => {
      if (busy || !result?.rows) return;
      error.hidden = true;
      busy = true;
      request++;
      content.inert = true;
      database.setAttribute('aria-busy', 'true');
      try {
        const parsed = parseDatabaseCsvPropertyUpdates(csvImportInput.value, result.rows);
        for (const item of parsed.updates) {
          await api.updateProperties(item.noteId, item.version, item.patch);
        }
        csvStatus.textContent = `✓ 已批量同步 ${parsed.matchedCount} 篇笔记的 YAML 属性${parsed.unmatchedCount ? `（未匹配 ${parsed.unmatchedCount} 行）` : ''}`;
      } catch (err) {
        fail(err);
      } finally {
        busy = false;
        if (!scope.signal.aborted) {
          content.inert = false;
          database.removeAttribute('aria-busy');
          await refresh();
        }
      }
    };
    renderSavedViewsBar();
    function syncBatchBar() {
      batchBar.hidden = selectedNoteIds.size === 0;
      batchCount.textContent = `已选 ${selectedNoteIds.size} 篇`;
      for (const cb of content.querySelectorAll('.database-row-select')) {
        cb.checked = selectedNoteIds.has(cb.dataset.selectNoteId);
      }
      for (const tr of content.querySelectorAll('tr[data-note-id]')) {
        tr.classList.toggle('is-multi-selected', selectedNoteIds.has(tr.dataset.noteId));
      }
    }
    function handleRowMultiSelect(noteId, { shiftKey = false, forceToggle = null } = {}) {
      if (!noteId || !result?.rows) return;
      if (shiftKey && lastSelectedNoteId) {
        const orderedIds = result.rows.map(r => r.id);
        for (const id of resolveShiftRangeIds(orderedIds, lastSelectedNoteId, noteId)) {
          selectedNoteIds.add(id);
        }
      } else if (typeof forceToggle === 'boolean') {
        if (forceToggle) selectedNoteIds.add(noteId);
        else selectedNoteIds.delete(noteId);
      } else if (selectedNoteIds.has(noteId)) {
        selectedNoteIds.delete(noteId);
      } else {
        selectedNoteIds.add(noteId);
      }
      lastSelectedNoteId = noteId;
      syncBatchBar();
    }
    async function runBatchPropertyOperation(kind) {
      if (busy || !selectedNoteIds.size || !result?.rows) return;
      const targets = result.rows.filter(r => selectedNoteIds.has(r.id));
      if (!targets.length) return;
      error.hidden = true;
      if (kind === 'move-folder') {
        const folderVal = batchFolderInput.value.trim();
        if (!window.__inkloomBatchMoveNotesToFolder) return;
        busy = true; database.setAttribute('aria-busy', 'true');
        try {
          await window.__inkloomBatchMoveNotesToFolder(targets.map(t => t.id), folderVal);
          selectedNoteIds.clear();
          batchFolderInput.value = '';
        } catch (err) { fail(err); }
        finally { busy = false; database.removeAttribute('aria-busy'); await refresh(); }
        return;
      }
      const tagVal = batchTagInput.value.trim();
      if ((kind === 'add-tag' || kind === 'remove-tag') && !tagVal) {
        fail(new Error('请输入要批量添加或移除的 #标签名'));
        return;
      }
      busy = true; request++; content.inert = true; database.setAttribute('aria-busy', 'true');
      try {
        for (const note of targets) {
          let patch;
          if (kind === 'add-tag') {
            patch = { tags: computeBatchTagPatch(note.tags || [], { addTag: tagVal }) };
          } else if (kind === 'remove-tag') {
            patch = { tags: computeBatchTagPatch(note.tags || [], { removeTag: tagVal }) };
          } else if (kind === 'status') {
            patch = { status: batchStatusSelect.value };
          }
          if (patch) await api.updateProperties(note.id, note.version, patch);
        }
        if (kind === 'add-tag' || kind === 'remove-tag') batchTagInput.value = '';
      } catch (err) { fail(err); }
      finally {
        busy = false;
        if (!scope.signal.aborted) { content.inert = false; await refresh(); }
      }
    }
    batchAddTagBtn.onclick = () => void runBatchPropertyOperation('add-tag');
    batchRemoveTagBtn.onclick = () => void runBatchPropertyOperation('remove-tag');
    batchStatusBtn.onclick = () => void runBatchPropertyOperation('status');
    batchMoveBtn.onclick = () => void runBatchPropertyOperation('move-folder');
    batchClearBtn.onclick = () => { selectedNoteIds.clear(); lastSelectedNoteId = ''; syncBatchBar(); };
    function render() {
      content.replaceChildren(); content.dataset.mode = mode; content.dataset.density = api.getSetting('compact-mode') ? 'compact' : 'comfortable';
      tableButton.setAttribute('aria-selected', String(mode === 'table')); boardButton.setAttribute('aria-selected', String(mode === 'board'));
      renderSavedViewsBar();
      order.setAttribute('aria-pressed', String(filters.sortDir === 'desc'));
      count.textContent = result.total + ' 篇笔记'; page.textContent = (pagination.pageIndex + 1) + ' / ' + Math.max(1, table.getPageCount());
      previous.disabled = !table.getCanPreviousPage() || busy; next.disabled = !table.getCanNextPage() || busy;
      propertySearch.hidden = !filters.propertyKey;
      const summary = result.summary || { total: result.total, completed: 0, taskCount: 0, taskDone: 0, numericCount: 0, numericSum: 0, numericAverage: null };
      const summaryParts = [`匹配 ${summary.total} 篇`, `已完成 ${summary.completed} 篇`, `任务 ${summary.taskDone}/${summary.taskCount}`];
      if (filters.propertyKey && summary.numericCount > 0) summaryParts.push(`${filters.propertyKey} 合计 ${summary.numericSum}（均值 ${summary.numericAverage}）`);
      summaryBar.textContent = summaryParts.join(' · ');
      groupBar.replaceChildren();
      if (result.groups?.length) {
        groupBar.hidden = false;
        for (const group of result.groups) {
          const chip = element('button', 'database-group-chip'); chip.type = 'button'; chip.dataset.groupKey = group.key;
          const detail = [`${group.count} 篇`, group.taskCount ? `任务 ${group.taskDone}/${group.taskCount}` : '', group.numericCount ? `合计 ${group.numericSum}` : ''].filter(Boolean).join(' · ');
          chip.append(element('strong', '', group.label), element('small', '', detail));
          chip.onclick = () => {
            if (filters.groupBy === 'status') filters.status = group.key;
            else if (filters.groupBy === 'folder') filters.folder = group.key === '根目录' ? '根目录' : group.key;
            else { filters.propertyKey = filters.groupBy; filters.propertyValue = group.key === '无项目' || group.key === '未分类' || group.key === '未设置' ? '' : group.key; propertySearch.value = filters.propertyValue; }
            pagination.pageIndex = 0; refresh();
          };
          groupBar.append(chip);
        }
      } else groupBar.hidden = true;
      if (!result.rows.length) { content.append(element('p', 'empty-state', '没有匹配的笔记')); return; }
      if (mode === 'table') {
        const grid = element('table', 'vault-database-table'); const header = element('thead'); const heading = element('tr');
        const headers = ['笔记', '状态', '标签', '任务', ...(filters.propertyKey ? [filters.propertyKey] : []), '日期', '目录', '链接'];
        for (const label of headers) { const cell = element('th', '', label); cell.scope = 'col'; heading.append(cell); }
        header.append(heading); grid.append(header); const body = element('tbody');
        for (const row of table.getRowModel().rows) {
          const note = row.original; const line = element('tr'); line.dataset.noteId = note.id;
          if (selectedNoteIds.has(note.id)) line.classList.add('is-multi-selected');
          const rowCb = element('input', 'database-row-select'); rowCb.type = 'checkbox'; rowCb.dataset.selectNoteId = note.id;
          rowCb.checked = selectedNoteIds.has(note.id);
          rowCb.setAttribute('aria-label', '选择 ' + note.title);
          rowCb.onclick = event => {
            event.stopPropagation();
            handleRowMultiSelect(note.id, { shiftKey: event.shiftKey, forceToggle: rowCb.checked });
          };
          line.onclick = event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
              if (event.target.closest('input, select, button')) return;
              event.preventDefault();
              handleRowMultiSelect(note.id, { shiftKey: event.shiftKey });
            }
          };
          const title = element('td', 'database-title-cell'); title.append(rowCb, openButton(note)); const state = element('td'); state.append(statusSelect(note));
          const taskCell = element('td', '', note.taskCount ? `${note.taskDone}/${note.taskCount}` : '0/0');
          const cells = [title, state, element('td', 'tag-text', note.tags.map(tag => '#' + tag).join(' ')), taskCell];
          if (filters.propertyKey) { const propCell = element('td'); propCell.append(propertyInput(note, filters.propertyKey)); cells.push(propCell); }
          cells.push(element('td', '', note.date || ''), element('td', '', note.folder), element('td', '', String(note.degree)));
          line.append(...cells); body.append(line);
        }
        grid.append(body); content.append(grid);
        syncBatchBar();
      } else {
        for (const column of result.columns) {
          const lane = element('section', 'kanban-column'); lane.dataset.status = column.status; lane.append(element('h3', '', column.status + '  ' + column.items.length + '/' + column.count));
          for (const note of column.items) {
            const card = element('article', 'kanban-note'); card.dataset.noteId = note.id; card.draggable = !busy;
            card.append(openButton(note), element('p', 'tag-text', note.tags.map(tag => '#' + tag).join(' ')), statusSelect(note)); lane.append(card);
          }
          content.append(lane);
        }
      }
    }
    async function refresh() {
      if (scope.signal.aborted || busy) return;
      if (pointerActive) { refreshDeferred = true; return; }
      const current = ++request; database.setAttribute('aria-busy', 'true');
      try {
        const data = await api.queryDatabase({ ...filters, ...pagination }, { signal: scope.signal, key: 'note-views' });
        if (scope.signal.aborted || current !== request) return;
        if (pointerActive) { refreshDeferred = true; return; }
        result = data; pagination = { pageIndex: data.pageIndex, pageSize: data.pageSize };
        table.setOptions(options => ({ ...options, data: data.rows, rowCount: data.total, state: { ...options.state, pagination } }));
        for (const [key, field] of selects) {
          if (key === 'groupBy') {
            const groupLabels = { status: '按状态分组', folder: '按目录分组', category: '按分类分组', project: '按项目分组' };
            field.select.replaceChildren(new Option(field.label, ''), ...Object.entries(groupLabels).map(([val, text]) => new Option(text, val)));
            field.select.value = filters.groupBy;
            continue;
          }
          if (key === 'propertyKey') {
            field.select.replaceChildren(new Option(field.label, ''), ...(data.propertyKeys || []).map(prop => new Option(derivedLabels[prop] || ('属性: ' + prop), prop)));
            field.select.value = filters.propertyKey;
            continue;
          }
          const values = key === 'sortBy' ? ['title', 'date', 'status', 'degree', 'tasks', 'property'] : data[key === 'folder' ? 'folders' : key === 'tag' ? 'tags' : 'statuses'];
          const labels = { title: '标题', date: '日期', status: '状态', degree: '链接数', tasks: '任务数', property: '属性列' };
          field.select.replaceChildren(...(key === 'sortBy' ? [] : [new Option(field.label, '')]), ...values.map(value => new Option(labels[value] && key === 'sortBy' ? labels[value] : value, value))); field.select.value = filters[key];
        }
        render();
      } catch (reason) { if (reason.name !== 'AbortError') fail(reason); }
      finally { if (!scope.signal.aborted && current === request) database.removeAttribute('aria-busy'); }
    }
    async function changeProperty(id, key, value) {
      if (busy || scope.signal.aborted) return;
      const note = result?.rows.find(row => row.id === id); if (!note) return;
      busy = true; request++; error.hidden = true; content.inert = true;
      database.setAttribute('aria-busy', 'true');
      for (const control of content.querySelectorAll('select, input')) control.disabled = true;
      try {
        const cleaned = typeof value === 'string' ? value.trim() : value;
        const normalized = cleaned === '' || cleaned === null ? null : (/^-?\d+(\.\d+)?$/.test(String(cleaned)) && key.includes('words') ? Number(cleaned) : cleaned);
        await api.updateProperties(id, note.version, { [key]: normalized });
      } catch (reason) { fail(reason); }
      finally {
        busy = false;
        if (!scope.signal.aborted) { await refresh(); content.inert = false; for (const control of content.querySelectorAll('select, input')) control.disabled = false; }
      }
    }
    async function changeStatus(id, status) {
      return changeProperty(id, 'status', status === '未设状态' ? null : status);
    }
    database.addEventListener('click', event => {
      const target = event.target.closest('button'); if (!target || busy) return;
      if (target.dataset.openNoteId) api.open(target.dataset.openNoteId).catch(fail);
      else if (target.dataset.viewMode) {
        mode = target.dataset.viewMode;
        lastConfiguredViewMode = mode;
        api.setSetting('view-mode', target.dataset.viewMode).catch(fail);
      }
      else if (target === previous) table.previousPage(); else if (target === next) table.nextPage();
      else if (target === order) { filters.sortDir = filters.sortDir === 'asc' ? 'desc' : 'asc'; pagination.pageIndex = 0; refresh(); }
    }, { signal: scope.signal });
    search.addEventListener('input', () => { filters.query = search.value; pagination.pageIndex = 0; clearTimeout(queryTimer); queryTimer = setTimeout(refresh, 100); }, { signal: scope.signal });
    propertySearch.addEventListener('input', () => { filters.propertyValue = propertySearch.value; pagination.pageIndex = 0; clearTimeout(queryTimer); queryTimer = setTimeout(refresh, 100); }, { signal: scope.signal });
    database.addEventListener('change', event => {
      const target = event.target;
      if (target.dataset.statusNoteId) changeStatus(target.dataset.statusNoteId, target.value);
      else if (target.dataset.propertyNoteId) changeProperty(target.dataset.propertyNoteId, target.dataset.propertyKey, target.value);
      else if (target.dataset.filter) {
        filters[target.dataset.filter] = target.value;
        if (target.dataset.filter === 'propertyKey' && !target.value) { filters.propertyValue = ''; propertySearch.value = ''; }
        if (target.dataset.filter === 'groupBy' || target.dataset.filter === 'propertyKey') {
          api.setSetting('dimensions', { groupBy: filters.groupBy, propertyKey: filters.propertyKey }).catch(fail);
        }
        pagination.pageIndex = 0; refresh();
      }
      else if (target === size) api.setSetting('page-size', Number(size.value)).catch(fail);
    }, { signal: scope.signal });
    content.addEventListener('dragstart', event => { const card = event.target.closest('.kanban-note'); if (card && !busy) { event.dataTransfer.setData('application/x-inkloom-note', card.dataset.noteId); event.dataTransfer.effectAllowed = 'move'; } }, { signal: scope.signal });
    content.addEventListener('dragover', event => { if (!busy && event.target.closest('.kanban-column') && event.dataTransfer.types.includes('application/x-inkloom-note')) event.preventDefault(); }, { signal: scope.signal });
    content.addEventListener('drop', event => { const lane = event.target.closest('.kanban-column'); if (lane) { event.preventDefault(); changeStatus(event.dataTransfer.getData('application/x-inkloom-note'), lane.dataset.status); } }, { signal: scope.signal });
    content.addEventListener('pointerdown', event => { if (event.target.closest('.kanban-note')) pointerActive = true; }, { signal: scope.signal });
    const finishPointer = () => { pointerActive = false; if (refreshDeferred) { refreshDeferred = false; refresh(); } };
    for (const event of ['pointerup', 'pointercancel', 'dragend']) document.addEventListener(event, finishPointer, { signal: scope.signal });
    scope.own(api.on('vault.changed', refresh));
    scope.own(api.on('settings.changed', event => {
      if (event.pluginId !== api.pluginId) return;
      savedViews = normalizeSavedDatabaseViews(api.getSetting('saved-views'));
      if (event.settingId === 'saved-views' || event.settingId === 'dimensions') {
        renderSavedViewsBar();
        return;
      }
      const nextViewMode = api.getSetting('view-mode') || 'table';
      if (nextViewMode !== lastConfiguredViewMode) {
        lastConfiguredViewMode = nextViewMode;
        mode = nextViewMode;
      }
      const pageSize = Number(api.getSetting('page-size')) || 50;
      if (pageSize !== pagination.pageSize) pagination = { pageIndex: 0, pageSize }; size.value = String(pageSize); return refresh();
    }));
    refresh();
    return () => { request++; clearTimeout(queryTimer); table.setOptions(options => ({ ...options, data: [] })); database.remove(); };
  }
}