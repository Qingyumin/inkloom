import { createElement, FolderOpen, RefreshCw, RotateCcw, ChevronLeft, ChevronRight, Save, X, Upload, Download } from 'lucide';

const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

export function mountVaultManager(container, api) {
  const section = element('section', 'vault-manager'); section.id = 'vault-manager';
  const pathLabel = element('label', 'vault-path-label', api.desktop ? '知识库路径' : '浏览器知识库副本');
  const pathInput = element('input'); pathInput.id = 'vault-path-input'; pathInput.type = 'text'; pathInput.autocomplete = 'off'; pathInput.readOnly = !api.desktop; pathLabel.append(pathInput);
  const controls = element('div', 'vault-manager-actions');
  const status = element('p', 'vault-manager-status'); status.id = 'vault-manager-status'; status.setAttribute('role', 'status');
  const summary = element('p', 'vault-manager-summary'); summary.id = 'vault-scan-summary';
  const warnings = element('ul', 'vault-scan-warnings'); warnings.id = 'vault-scan-warnings';
  const startupFields = element('div', 'vault-startup-fields');
  const startupLabel = element('label', 'vault-path-label', '启动时'); const startupMode = element('select'); startupMode.id = 'vault-startup-mode';
  startupMode.append(new Option('首篇可用笔记', 'first'), new Option('继续上次笔记', 'last'), new Option('空白文档', 'blank'), new Option('指定笔记', 'note')); startupLabel.append(startupMode);
  const noteLabel = element('label', 'vault-path-label', '启动笔记'); const startupNote = element('select'); startupNote.id = 'vault-startup-note'; noteLabel.append(startupNote);
  const recentHeading = element('h3', 'vault-manager-heading', '最近知识库'); const recent = element('div', 'vault-recent-list'); recent.id = 'vault-recent-list';
  const tasks = element('section', 'vault-task-section'); tasks.append(element('h3', 'vault-manager-heading', '后台任务与资源'));
  const taskStatus = element('p', 'vault-manager-status'); taskStatus.id = 'vault-task-status'; const taskActions = element('div', 'vault-manager-actions');
  const identitySection = element('section', 'vault-identity-section'); identitySection.append(element('h3', 'vault-manager-heading', '知识库身份迁移'));
  const identityPathLabel = element('label', 'vault-path-label', '身份清单路径'); const identityPath = element('input'); identityPath.type = 'text'; identityPath.id = 'vault-identity-path'; identityPath.autocomplete = 'off'; identityPathLabel.append(identityPath);
  const identityActions = element('div', 'vault-manager-actions'); const identityMessage = element('p', 'vault-manager-status'); identityMessage.id = 'vault-identity-message';
  const identityLabel = element('label', 'checkbox-setting'); const identityConfirm = element('input'); identityConfirm.type = 'checkbox'; identityConfirm.id = 'vault-identity-confirm'; identityLabel.append(identityConfirm, document.createTextNode('确认恢复清单中的笔记身份与偏好'));
  const recoveryHeading = element('div', 'vault-recovery-heading'); recoveryHeading.append(element('h3', '', '改名恢复记录'));
  const filter = element('select'); filter.id = 'vault-recovery-filter'; filter.setAttribute('aria-label', '恢复记录范围'); filter.append(new Option('待恢复', 'pending'), new Option('全部记录', 'all')); recoveryHeading.append(filter);
  const recordCount = element('p', 'vault-manager-summary'); recordCount.id = 'vault-recovery-count';
  const records = element('div', 'vault-recovery-list'); records.id = 'vault-recovery-list';
  const detail = element('div', 'vault-recovery-detail'); detail.id = 'vault-recovery-detail'; detail.hidden = true;
  const message = element('p'); message.id = 'vault-recovery-message';
  const files = element('ul', 'vault-recovery-files'); files.id = 'vault-recovery-files';
  const confirmation = element('label', 'checkbox-setting'); const confirm = element('input'); confirm.type = 'checkbox'; confirm.id = 'vault-recovery-confirm'; confirmation.append(confirm, document.createTextNode('确认恢复到改名前版本'));
  const detailActions = element('div', 'vault-manager-actions');
  let busy = false; let data = { items: [], total: 0 }; let preferences = { recentVaults: [], startupMode: 'first' }; let selected = null; let preview = null; let scope = ''; let offset = 0;
  let identityPreview = null;
  let startupEdited = false;
  const buttons = [];
  function button(id, icon, label, handler, iconOnly = false) {
    const node = element('button', 'phase-command'); node.type = 'button'; node.id = id; node.title = label; node.setAttribute('aria-label', label);
    node.append(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' })); if (!iconOnly) node.append(element('span', '', label)); node.onclick = () => run(handler); buttons.push(node); return node;
  }
  function updateDisabled() {
    section.setAttribute('aria-busy', String(busy));
    for (const node of buttons) node.disabled = busy;
    for (const node of records.querySelectorAll('button')) node.disabled = busy;
    for (const node of recent.querySelectorAll('button')) node.disabled = busy || node.dataset.unavailable === 'true';
    open.disabled = busy || !api.desktop; browse.disabled = busy || !api.desktop;
    restore.disabled = busy || !preview?.canRestore || !confirm.checked; backup.disabled = busy || !selected || !api.desktop;
    confirm.disabled = busy || !preview?.canRestore; filter.disabled = busy; pathInput.disabled = busy;
    previous.disabled = busy || offset === 0; next.disabled = busy || offset + 25 >= data.total;
    startupMode.disabled = busy || !api.desktop; startupNote.disabled = busy || !api.desktop || startupMode.value !== 'note'; saveStartup.disabled = busy || !api.desktop;
    exportIdentity.disabled = busy || !api.desktop; selectIdentity.disabled = busy || !api.desktop;
    identityConfirm.disabled = busy || !identityPreview?.canImport; importIdentity.disabled = busy || !identityPreview?.canImport || !identityConfirm.checked;
    identityPath.disabled = busy || !api.desktop;
  }
  async function run(handler) {
    if (busy) return; busy = true; status.textContent = '处理中'; status.classList.remove('has-error'); updateDisabled();
    try { await handler(); status.textContent = ''; }
    catch (error) { status.textContent = error.message; status.classList.add('has-error'); }
    finally { busy = false; updateDisabled(); }
  }
  async function load(reset = true) {
    if (reset) offset = 0;
    data = await api.listRecovery({ offset, limit: 25, filter: filter.value }); preferences = await api.workspacePreferences(); selected = null; preview = null; confirm.checked = false; detail.hidden = true; renderRecords(); renderPreferences(); refresh();
  }
  const open = button('vault-open-path', FolderOpen, '打开', async () => { if (await api.openVault(pathInput.value.trim())) await load(); });
  const browse = button('vault-browse', FolderOpen, '选择文件夹', async () => { if (await api.openVault()) await load(); });
  pathInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!open.disabled) open.click(); } });
  const rescan = button('vault-manager-rescan', RefreshCw, '重新扫描', async () => { await api.rescan(); await load(); }); controls.append(open, browse, rescan);
  async function showTaskState() {
    const state = api.taskDiagnostics(); const memory = await api.runtimeMetrics();
    taskStatus.textContent = `运行 ${state.running} · 等待 ${state.queued} · 完成 ${state.completed} · 取消 ${state.cancelled} · 超时 ${state.timedOut}` + (memory ? ` · 宿主及WebView2私有内存 ${(memory.privateBytes / 1048576).toFixed(1)} MiB` : '');
  }
  const inspectTasks = button('vault-task-refresh', RefreshCw, '刷新资源状态', showTaskState);
  const cancelTasks = button('vault-task-cancel', X, '取消后台读取', async () => { api.cancelQueries(); await showTaskState(); }); taskActions.append(inspectTasks, cancelTasks); tasks.append(taskStatus, taskActions);
  const saveStartup = button('vault-startup-save', Save, '保存启动方式', async () => { preferences = await api.setStartup(startupMode.value, startupNote.value); startupEdited = false; renderPreferences(); });
  startupFields.append(startupLabel, noteLabel, saveStartup); startupMode.onchange = () => { startupEdited = true; noteLabel.hidden = startupMode.value !== 'note'; renderStartupNotes(); updateDisabled(); }; startupNote.onchange = () => { startupEdited = true; };
  const exportIdentity = button('vault-identity-export', Download, '导出身份清单', async () => { const result = await api.exportIdentity(identityPath.value.trim()); if (result) { identityPath.value = result.path; identityMessage.textContent = `已导出 ${result.noteCount} 篇身份记录`; } });
  const selectIdentity = button('vault-identity-select', Upload, '选择清单并预览', async () => { identityConfirm.checked = false; identityPreview = await api.previewIdentity(identityPath.value.trim()); identityMessage.textContent = identityPreview ? `${identityPreview.noteCount} 篇 · ${identityPreview.message}` : ''; });
  const importIdentity = button('vault-identity-import', RotateCcw, '确认导入身份', async () => {
    if (!identityPreview?.canImport || !identityConfirm.checked) return;
    try { const result = await api.importIdentity(identityPreview.token); identityMessage.textContent = `已导入 ${result.importedNotes} 篇身份，正文未改动`; }
    finally { identityPreview = null; identityConfirm.checked = false; }
    await load();
  });
  identityConfirm.onchange = updateDisabled; identityPath.oninput = () => { identityPreview = null; identityConfirm.checked = false; updateDisabled(); }; identityActions.append(exportIdentity, selectIdentity, importIdentity); identitySection.append(identityPathLabel, identityActions, identityMessage, identityLabel);
  const reload = button('vault-recovery-refresh', RefreshCw, '刷新记录', load); recoveryHeading.append(reload);
  const backup = button('vault-recovery-backup', FolderOpen, '打开备份目录', async () => { await api.openRecoveryDirectory(selected); });
  const restore = button('vault-recovery-restore', RotateCcw, '恢复原文', async () => {
    if (!preview?.canRestore || !confirm.checked) return;
    try { await api.restoreRecovery(selected, preview.token); await load(); }
    catch (error) { preview = null; confirm.checked = false; throw error; }
  }); detailActions.append(backup, restore); detail.append(message, files, confirmation, detailActions);
  const pages = element('div', 'vault-manager-actions');
  const previous = button('vault-recovery-previous', ChevronLeft, '上一页记录', async () => { offset = Math.max(0, offset - 25); await load(false); }, true);
  const next = button('vault-recovery-next', ChevronRight, '下一页记录', async () => { offset += 25; await load(false); }, true); pages.append(recordCount, previous, next);
  section.append(pathLabel, controls, status, summary, warnings, tasks, startupFields, recentHeading, recent, identitySection, recoveryHeading, pages, records, detail); container.append(section);
  const labels = { pending: '待恢复', committed: '已提交', 'rolled-back': '已回滚', blocked: '需核对' };
  function renderRecords() {
    records.replaceChildren();
    const shown = data.items;
    recordCount.textContent = `${shown.length ? offset + 1 : 0}-${offset + shown.length} / ${data.total} 条记录`;
    if (!shown.length) records.append(element('p', 'vault-manager-summary', api.desktop ? '暂无匹配记录' : '桌面版恢复记录不可用'));
    for (const item of shown) {
      const row = element('button', 'vault-recovery-record'); row.type = 'button'; row.dataset.recoveryId = item.id;
      row.append(element('strong', '', (item.oldPath || item.id).split(/[\\/]/).pop()), element('span', '', labels[item.state] || item.state), element('small', '', item.message || item.newPath || ''));
      row.onclick = () => run(async () => {
        selected = item.id; preview = null; confirm.checked = false; files.replaceChildren(); detail.hidden = false; message.textContent = '正在检查';
        preview = await api.previewRecovery(item.id); message.textContent = preview.message;
        files.replaceChildren(...preview.files.map(file => { const item = element('li'); item.dataset.recoveryState = file.state; item.append(element('strong', '', file.relativePath), element('span', '', file.reason)); return item; }));
        for (const candidate of records.querySelectorAll('button')) candidate.setAttribute('aria-pressed', String(candidate === row));
      }); records.append(row);
    }
  }
  filter.onchange = () => run(load); confirm.onchange = updateDisabled;
  function renderStartupNotes() {
    const selectedId = startupNote.value || preferences.startupNoteId || '';
    const options = startupMode.value === 'note' ? (api.vault.notes || []).map(note => new Option(note.relativePath || note.name, note.id)) : [];
    startupNote.replaceChildren(new Option('选择笔记', ''), ...options); startupNote.value = selectedId;
  }
  function renderPreferences() {
    if (!startupEdited) { startupMode.value = preferences.startupMode || 'first'; renderStartupNotes(); startupNote.value = preferences.startupNoteId || ''; }
    noteLabel.hidden = startupMode.value !== 'note'; recent.replaceChildren();
    if (!preferences.recentVaults.length) recent.append(element('p', 'vault-manager-summary', api.desktop ? '暂无最近记录' : '桌面版最近记录不可用'));
    for (const item of preferences.recentVaults) {
      const row = element('div', 'vault-recent-row');
      const openRecent = element('button', 'vault-recent-open'); openRecent.type = 'button'; openRecent.dataset.recentPath = item.path; openRecent.dataset.unavailable = String(!item.available || item.current);
      openRecent.append(element('strong', '', item.name || item.path), element('small', '', item.path), element('span', '', item.current ? '当前' : item.available ? '' : '目录不可用'));
      openRecent.onclick = () => run(async () => { if (await api.openVault(item.path)) await load(); });
      const forget = element('button', 'icon-button'); forget.type = 'button'; forget.title = '移除最近记录'; forget.setAttribute('aria-label', '移除最近记录'); forget.dataset.forgetPath = item.path;
      forget.append(createElement(X, { width: 15, height: 15, 'aria-hidden': 'true' })); forget.onclick = () => run(async () => { preferences = await api.forgetRecent(item.path); renderPreferences(); });
      row.append(openRecent, forget); recent.append(row);
    }
    updateDisabled();
  }
  function refresh() {
    const vault = api.vault; const current = vault.vaultId || vault.vaultPath;
    if (scope !== current) { scope = current; startupEdited = false; offset = 0; selected = null; preview = null; identityPreview = null; identityConfirm.checked = false; detail.hidden = true; data = { items: [], total: 0 }; preferences = { recentVaults: [], startupMode: 'first' }; renderRecords(); renderPreferences(); }
    if (document.activeElement !== pathInput) pathInput.value = vault.vaultPath || '';
    summary.textContent = `${vault.notes?.length || 0} 篇笔记 · ${vault.warnings?.length || 0} 项扫描警告${vault.incomplete ? ' · 扫描未完整' : ''}`;
    warnings.replaceChildren(...(vault.warnings || []).map(text => element('li', '', text))); warnings.hidden = !vault.warnings?.length;
    updateDisabled();
  }
  function openPanel() { container.parentElement.open = true; return run(load); }
  container.parentElement.addEventListener('toggle', () => { if (container.parentElement.open && document.querySelector('#settings-dialog').open) run(load); });
  refresh(); return { refresh, open: openPanel, load: () => run(load) };
}