import { createElement, FolderTree, Hash, Star, ListTree, Network, Table2, Calendar, Search, CircleDot, ArrowUp, ArrowDown, Pin, Eye, EyeOff, ArrowLeft, RotateCcw, PanelsTopLeft, Bell, X, PencilRuler, BookOpen, Sparkles, ChevronRight, Download } from 'lucide';
import { PluginHost } from '../../core/plugin-host.mjs';
import { createPluginTemplatePackage, installPluginPackage, rollbackPluginPackage, removePluginPackage, normalizePluginRegistryState, defaultExtensionCatalog } from '../../core/plugin-package.mjs';
import unlinkedManifest from '../../plugins/unlinked-notes/manifest.json';
import { activate as activateUnlinked } from '../../plugins/unlinked-notes/main.js';
import { shortcutFromEvent } from '../../vendor/inklet/core/shortcuts.mjs';
import { sandboxedActivation } from './sandboxed-plugin.js';
import noteViewsManifest from '../../plugins/note-views/manifest.json';
import graphManifest from '../../plugins/knowledge-graph/manifest.json';
import homeManifest from '../../plugins/workspace-home/manifest.json';
import whiteboardManifest from '../../plugins/whiteboard/manifest.json';
import researchManifest from '../../plugins/research-desk/manifest.json';
import aiManifest from '../../plugins/ai-assistant/manifest.json';
const manifests = import.meta.glob('../../plugins/*/manifest.json', { eager: true, import: 'default' });
const isolatedEntries = import.meta.glob('../../plugins/*/*.js', { query: '?raw', import: 'default' });

const icons = { 'folder-tree': FolderTree, hash: Hash, star: Star, 'list-tree': ListTree, network: Network, 'table-2': Table2, calendar: Calendar, search: Search, 'circle-dot': CircleDot, 'panels-top-left': PanelsTopLeft, 'pencil-ruler': PencilRuler, 'book-open': BookOpen, sparkles: Sparkles };
const iconTones = {
  '工作台': 'amber',
  '知识库': 'emerald',
  '标签': 'blue',
  '星标': 'amber',
  '大纲': 'cyan',
  '今日手记': 'teal',
  '知识图谱': 'indigo',
  '智识': 'purple',
  '研究': 'rose',
  '白板': 'cyan',
  '搜索笔记': 'blue',
  '笔记视图': 'blue',
  '未关联笔记': 'rose',
};
function element(tag, className, text) { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; }
function tool(icon, name, click) {
  const button = element('button', 'icon-button'); button.type = 'button'; button.title = name; button.setAttribute('aria-label', name);
  button.append(createElement(icon, { width: 14, height: 14, 'aria-hidden': 'true' })); button.addEventListener('click', click); return button;
}

export async function mountWorkbench(options) {
  const previousSettings = options.settings(); const migration = {};
  if (!previousSettings.pluginSettings?.['note-views']) migration.pluginSettings = { ...previousSettings.pluginSettings, 'note-views': { 'view-mode': previousSettings.databaseView || 'table', 'compact-mode': Boolean(previousSettings.databaseCompact), 'page-size': 50 } };
  if (!previousSettings.pluginSettings?.['knowledge-graph']) migration.pluginSettings = { ...(migration.pluginSettings || previousSettings.pluginSettings), 'knowledge-graph': { 'local-depth': previousSettings.localGraphDepth || 1, 'local-tags': Boolean(previousSettings.localGraphTags), 'show-local': true } };
  for (const key of ['activityOrder', 'activityHidden', 'activityPinned']) {
    if (previousSettings[key]?.some(id => ['core-navigation:database-view', 'core-navigation:graph-view'].includes(id))) migration[key] = previousSettings[key].map(id => id === 'core-navigation:database-view' ? 'note-views:database-view' : id === 'core-navigation:graph-view' ? 'knowledge-graph:global-view' : id);
  }
  if (Object.keys(migration).length) await options.changeSettings(migration);
  const controller = new AbortController(); const { signal } = controller;
  const rail = element('nav', 'activity-rail'); rail.id = 'activity-rail'; rail.setAttribute('aria-label', '工作台活动栏');
  const entries = element('div', 'activity-entries'); const utilities = element('div', 'activity-utilities'); rail.append(entries, utilities);
  document.querySelector('.app-body').prepend(rail);
  const settingsButton = document.querySelector('[data-action="settings"]');
  settingsButton.id = 'settings-button'; settingsButton.title = '设置'; settingsButton.setAttribute('aria-label', '设置'); settingsButton.dataset.iconTone = 'teal';
  const refreshVaultBtn = tool(RotateCcw, '刷新知识库', () => options.refreshVault());
  refreshVaultBtn.dataset.iconTone = 'emerald';
  utilities.append(refreshVaultBtn, settingsButton);
  const specialTools = element('details', 'special-tools-menu'); specialTools.id = 'special-tools-menu';
  const specialTrigger = element('summary', 'icon-button'); specialTrigger.title = '导入与库管理'; specialTrigger.setAttribute('aria-label', '导入与库管理'); specialTrigger.dataset.iconTone = 'amber'; specialTrigger.append(createElement(Download, { width: 14, height: 14, 'aria-hidden': 'true' }));
  const specialItems = element('div', 'special-tools-items');
  for (const [action, label, icon] of [['vault-archive', '全库便携归档 (.zip)', Download], ['onenote-import', 'OneNote 迁入', Download], ['vault-manage', '知识库管理', FolderTree]]) {
    const item = tool(icon, label, () => { specialTools.open = false; }); item.dataset.action = action;
    item.append(element('span', '', label)); specialItems.append(item);
  }
  specialTools.append(specialTrigger, specialItems); utilities.prepend(specialTools);
  document.addEventListener('pointerdown', event => { if (!specialTools.contains(event.target)) specialTools.open = false; }, { signal });
  specialTools.addEventListener('keydown', event => { if (event.key === 'Escape') { specialTools.open = false; specialTrigger.focus(); } }, { signal });
  const stage = element('section', 'plugin-stage'); stage.id = 'plugin-stage'; stage.hidden = true; stage.setAttribute('aria-label', '插件视图');
  const heading = element('div', 'plugin-view-heading'); const title = element('h2');
  const headingActions = element('div', 'plugin-view-actions');
  const activeNoteChip = element('button', 'plugin-active-note-chip');
  activeNoteChip.type = 'button';
  activeNoteChip.title = '点击返回当前正在编辑的笔记';
  activeNoteChip.onclick = () => closeView();
  const backToNoteBtn = tool(ArrowLeft, '返回笔记', () => closeView());
  backToNoteBtn.classList.add('plugin-back-btn');
  backToNoteBtn.dataset.shortLabel = '返回笔记';
  backToNoteBtn.dataset.iconTone = 'teal';
  headingActions.append(activeNoteChip, backToNoteBtn);
  heading.append(title, headingActions);
  const content = element('div', 'plugin-view-content'); stage.append(heading, content); document.querySelector('#backlinks-drawer').after(stage);
  let selected = ''; let renderQueued = false; let disposed = false;
  let savedSourceScrollTop = 0; let savedRichScrollTop = 0;
  let packageStatusText = '支持离线 .inkloom-plugin.json 扩展包校验安装、版本升级备份与一键回退（沙箱隔离运行）';
  let packageDraftJson = '';
  const reminders = element('aside', 'home-reminders'); reminders.setAttribute('aria-live', 'polite'); document.querySelector('#app').append(reminders);
  const flyout = element('aside', 'activity-flyout-popover'); flyout.id = 'activity-flyout-popover'; flyout.hidden = true; flyout.setAttribute('aria-label', '二级功能直达菜单'); document.querySelector('#app').append(flyout);
  let flyoutShowTimer = null; let flyoutHideTimer = null;
  const activityFlyoutMenus = {
    'ai-assistant:ai-view': {
      title: '笔记智识 · 快速直达',
      event: 'inkloom:ai-switch-tab',
      groups: [
        ['围绕笔记提问', [
          ['chat', '笔记问答', '基于原文生成回答与新笔记'],
          ['search', '段落搜索', '跨库定位相关段落与行号'],
          ['mcp', '多步助手', '自动检索分析并生成修订提案'],
        ]],
        ['整理与连线', [
          ['compiler', '资料转百科', 'raw/ 资料自动整理为 Wiki 笔记'],
          ['revise', '当前笔记润色', '为当前笔记生成要点或待办预览'],
          ['synthesis', '孤岛笔记连线', '为无连接笔记推荐双链挂载点'],
          ['digest', '周报与拆卡', '汇总周期手记或按章节拆分为子卡'],
          ['consistency', '长稿前后核查', '检查长稿设定冲突与未建节点'],
          ['chronicle', '笔记时间脉络', '按记录日期查看笔记演进脉络'],
        ]],
        ['温习与守护', [
          ['flashcards', '闪卡温习', '到期闪卡温习与一键提炼闪卡'],
          ['skills', '常用方法卡', '从笔记提炼可复用的方法模板'],
          ['doctor', '格式与断链体检', '检查并修复断链与属性格式'],
          ['snapshot', '历史快照', '保存全库快照并支持无损回退'],
          ['sync', '文件夹同步', '与本地备份目录双向增量比对'],
          ['config', '模型连接', '配置本地小模型或在线接口'],
        ]],
      ],
    },
    'research-desk:research-view': {
      title: '文献与研究 · 快速直达',
      event: 'inkloom:research-switch-mode',
      groups: [
        ['阅读与摘录', [
          ['source', '资料书架', '管理论文、书籍与阅读状态'],
          ['reader', '原件精读 (PDF/EPUB)', '分页阅读原件并划词生成摘录卡'],
          ['reading', '阅读札记', '查看关联资料的精读笔记'],
          ['excerpt', '选段摘录', '查看带页码与段落锚点的摘录卡'],
        ]],
        ['批注与长稿', [
          ['highlights', '高亮批注', '汇总全库高亮并生成精读笔记'],
          ['manuscript', '长稿写作', '管理多章长稿与全稿预览'],
          ['all', '全部条目', '查看全部资料、摘录与札记'],
        ]],
      ],
    },
    'core-navigation:daily-view': {
      title: '周期手记 · 日/周/月/季模板中心',
      directNavigate: true,
      groups: [
        ['日常与周复盘', [
          ['daily', '今日手记 (Daily)', '打开或创建今日灵感与行动手记'],
          ['periodic:weekly', '本周周报手记 (Weekly)', '按 ISO 周自动聚合活跃笔记、已完成待办与闪卡'],
        ]],
        ['月度与季度规划', [
          ['periodic:monthly', '本月复盘手记 (Monthly)', '按自然月汇总知识沉淀与待推进重点'],
          ['periodic:quarterly', '本季规划手记 (Quarterly)', '按季度梳理北极星目标与路线复盘'],
        ]],
      ],
    },
  };
  function hideFlyoutImmediate() {
    clearTimeout(flyoutShowTimer); clearTimeout(flyoutHideTimer);
    flyout.hidden = true;
  }
  function scheduleHideFlyout() {
    clearTimeout(flyoutShowTimer); clearTimeout(flyoutHideTimer);
    flyoutHideTimer = setTimeout(() => { flyout.hidden = true; }, 180);
  }
  function openFlyoutForButton(viewId, btnEl) {
    const menuDef = activityFlyoutMenus[viewId];
    if (!menuDef || window.innerWidth <= 680) return;
    clearTimeout(flyoutHideTimer);
    flyout.replaceChildren();
    const head = element('div', 'activity-flyout-header', menuDef.title);
    const grid = element('div', 'activity-flyout-grid');
    for (const [groupName, items] of menuDef.groups) {
      const col = element('div', 'activity-flyout-group');
      col.append(element('small', 'activity-flyout-group-title', groupName));
      for (const [subKey, label, desc] of items) {
        const itemBtn = element('button', 'activity-flyout-item');
        itemBtn.type = 'button';
        itemBtn.dataset.flyoutView = viewId;
        itemBtn.dataset.flyoutSubtab = subKey;
        itemBtn.append(element('strong', '', label), element('span', '', desc));
        itemBtn.onclick = async () => {
          hideFlyoutImmediate();
          if (menuDef.directNavigate) {
            closeView(false);
            await options.navigate(subKey).catch(options.failure);
            return;
          }
          window.__inkloomPendingSubTab = { viewId, subKey };
          if (selected !== viewId || stage.hidden) {
            await host.openView(viewId).catch(options.failure);
          }
          window.dispatchEvent(new CustomEvent(menuDef.event, { detail: subKey }));
        };
        col.append(itemBtn);
      }
      grid.append(col);
    }
    flyout.append(head, grid);
    const rect = btnEl.getBoundingClientRect();
    flyout.style.top = `${Math.max(44, Math.min(window.innerHeight - 360, Math.round(rect.top - 8)))}px`;
    flyout.hidden = false;
  }
  flyout.addEventListener('mouseenter', () => clearTimeout(flyoutHideTimer), { signal });
  flyout.addEventListener('mouseleave', () => scheduleHideFlyout(), { signal });
  const contextViews = new Map();
  const settingsContent = document.querySelector('#settings-dialog .settings-content');
  const group = element('details', 'settings-group'); group.dataset.settingsGroup = 'extensions'; group.name = 'inkloom-settings';
  const summary = element('summary', '', '工作台与插件'); summary.append(createElement(ChevronRight, { width: 14, height: 14, 'aria-hidden': 'true' }));
  const settingsBody = element('div', 'settings-group-content'); group.append(summary, settingsBody); settingsContent.append(group);
  group.open = Boolean(options.settings().settingsGroups?.extensions);
  group.addEventListener('toggle', () => { if (options.settings().settingsGroups?.extensions !== group.open) options.changeSettings({ settingsGroups: { ...options.settings().settingsGroups, extensions: group.open } }); }, { signal });

  const host = new PluginHost({
    query: query => options.query(query), queryAsync: (query, runtime) => options.queryAsync(query, runtime), read: (id, runtime) => options.read(id, runtime), write: (id, version, source) => options.write(id, version, source), open: async id => { const opened = await options.open(id); if (!opened) throw new Error('笔记尚未打开，当前视图和草稿已保留'); return opened; }, openLink: link => options.openLink(link),
    queryDatabase: (query, runtime) => options.queryDatabase(query, runtime), updateProperties: (id, version, patch) => options.updateProperties(id, version, patch),
    promoteEdge: (sourceId, targetId, reason) => options.promoteEdge?.(sourceId, targetId, reason),
    queryGraph: (query, runtime) => options.queryGraph(query, runtime), queryWorkspace: (query, runtime) => options.queryWorkspace(query, runtime),
    queryAi: (query, runtime) => options.queryAi(query, runtime), aiConfig: (action, payload) => options.aiConfig(action, payload), aiComplete: (payload, runtime) => options.aiComplete(payload, runtime),
    createNote: (title, values) => options.createNote(title, values),
    activeDocument: () => options.activeDocument(), updateActiveDocument: (id, revision, source) => options.updateActiveDocument(id, revision, source), saveActiveDocument: id => options.saveActiveDocument(id),
    navigate: target => { closeView(false); return options.navigate(target); },
    notify: note => { if (reminders.children.length >= 3) reminders.firstElementChild.remove(); const reminder = element('div', 'home-reminder'); reminder.append(createElement(Bell, { width: 16, height: 16 })); const open = element('button', '', note.title); open.type = 'button'; open.onclick = () => { reminder.remove(); closeView(); options.open(note.noteId).catch(options.failure); }; reminder.append(open, tool(X, '关闭任务提醒', () => reminder.remove())); reminders.append(reminder); },
    getSettings: id => options.settings().pluginSettings?.[id] || {},
    setSetting: (id, key, value) => options.changeSettings({ pluginSettings: { ...options.settings().pluginSettings, [id]: { ...options.settings().pluginSettings?.[id], [key]: value } } }),
    view: view => {
      const selTools = document.querySelector('#selection-tools'); if (selTools) selTools.hidden = true;
      const tblTools = document.querySelector('#table-tools'); if (tblTools) tblTools.hidden = true;
      const propPop = document.querySelector('#inline-property-popover'); if (propPop) propPop.hidden = true;
      const aiPop = document.querySelector('#inline-ai-popover'); if (aiPop) aiPop.hidden = true;
      if (selected === view.id && !stage.hidden) { closeView(); return; }
      const editorStage = document.querySelector('#editor-stage');
      if (editorStage && !editorStage.hidden) {
        savedSourceScrollTop = document.querySelector('#source-editor .cm-scroller')?.scrollTop || 0;
        savedRichScrollTop = document.querySelector('#rich-editor')?.scrollTop || 0;
      }
      closeView(false); options.navigate('write'); selected = view.id; title.textContent = view.name; stage.hidden = false; document.querySelector('#app').dataset.workspaceView = view.target || '';
      stage.dataset.mounted = String(Boolean(view.mount));
      if (editorStage) editorStage.hidden = true;
      document.querySelector('#backlinks-drawer').hidden = true;
      renderView(view); scheduleRender();
    },
    changed: () => scheduleRender(), failure: (id, error) => { options.failure(new Error(id + ': ' + error.message)); },
  });

  function closeView(navigate = true) {
    const wasOpen = !stage.hidden;
    if (selected) host.unmountView(selected);
    stage.hidden = true;
    selected = '';
    document.querySelector('#app').dataset.workspaceView = '';
    content.replaceChildren();
    if (wasOpen) {
      const editorStage = document.querySelector('#editor-stage');
      if (editorStage) editorStage.hidden = false;
      const backlinksDrawer = document.querySelector('#backlinks-drawer');
      if (backlinksDrawer) backlinksDrawer.hidden = false;
      if (navigate) options.navigate('write');
      const restoreScroll = () => {
        const cmScroller = document.querySelector('#source-editor .cm-scroller');
        const richScroller = document.querySelector('#rich-editor');
        if (cmScroller) cmScroller.scrollTop = savedSourceScrollTop;
        if (richScroller) richScroller.scrollTop = savedRichScrollTop;
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    }
  }
  function scheduleRender() { if (disposed || renderQueued) return; renderQueued = true; queueMicrotask(() => { renderQueued = false; if (!disposed) render(); }); }
  function viewsInOrder() {
    const settings = options.settings(); const order = settings.activityOrder || [];
    return [...host.views.values()].filter(view => view.location === 'activity').sort((first, second) => {
      const firstIndex = order.indexOf(first.id); const secondIndex = order.indexOf(second.id);
      return (firstIndex >= 0 ? firstIndex : 1000 + (first.order || 0)) - (secondIndex >= 0 ? secondIndex : 1000 + (second.order || 0));
    });
  }
  function changeActivity(key, id, enabled) {
    const values = new Set(options.settings()[key] || []); if (enabled) values.add(id); else values.delete(id);
    options.changeSettings({ [key]: [...values] }); scheduleRender();
  }
  function render() {
    renderQueued = false;
    const settings = options.settings(); rail.dataset.labels = settings.activityLabels ? 'true' : 'false';
    if (host.plugins.get('workspace-home')?.state !== 'enabled') reminders.replaceChildren();
    document.documentElement.dataset.textNavigation = settings.textNavigation ? 'true' : 'false';
    const focusId = document.activeElement?.dataset.activityId;
    const order = viewsInOrder(); const hidden = new Set(settings.activityHidden || []);
    entries.replaceChildren();
    for (const view of order.filter(view => !hidden.has(view.id))) {
      const active = selected === view.id || (!selected && options.activeView() === view.target);
      const button = tool(icons[view.icon] || CircleDot, view.name, () => { hideFlyoutImmediate(); host.openView(view.id).catch(options.failure); });
      if (view.target === 'graph') button.id = 'global-graph-button';
      if (view.target === 'database') button.id = 'database-button';
      if (view.target === 'search') button.id = 'quick-switcher-trigger';
      button.classList.add('activity-button'); button.dataset.activityId = view.id; button.setAttribute('aria-pressed', String(active));
      button.dataset.iconTone = iconTones[view.name] || 'teal';
      if (activityFlyoutMenus[view.id]) {
        button.classList.add('has-flyout');
        button.addEventListener('mouseenter', () => {
          clearTimeout(flyoutShowTimer);
          flyoutShowTimer = setTimeout(() => openFlyoutForButton(view.id, button), 260);
        });
        button.addEventListener('mouseleave', () => scheduleHideFlyout());
        button.addEventListener('contextmenu', event => {
          event.preventDefault();
          openFlyoutForButton(view.id, button);
        });
      }
      button.append(element('span', 'activity-label', view.name)); button.tabIndex = active ? 0 : -1;
      if (settings.activityPinned?.includes(view.id)) button.classList.add('pinned');
      entries.append(button);
    }
    if (!entries.querySelector('[tabindex="0"]')) entries.firstElementChild?.setAttribute('tabindex', '0');
    if (focusId) [...entries.children].find(button => button.dataset.activityId === focusId)?.focus();
    options.decorateIcons?.();
    if (selected && !host.views.has(selected)) closeView();
    if (selected) {
      const activeDoc = options.activeDocument?.();
      activeNoteChip.textContent = activeDoc?.name ? `当前笔记：${activeDoc.name.replace(/\.md$/i, '')}` : '';
      activeNoteChip.hidden = !activeDoc?.name;
      renderView(host.views.get(selected));
    }
    renderContextViews();
    renderSettings(order);
    rail.dataset.pluginDiagnostics = JSON.stringify(host.diagnostics());
  }
  function renderContextViews() {
    if (!options.contextContainer) return;
    const visible = options.contextVisible() && !['home', 'whiteboard', 'research', 'ai'].includes(host.views.get(selected)?.target);
    const views = [...host.views.values()].filter(view => view.location === 'context' && (!view.visibleSetting || (options.settings().pluginSettings?.[view.pluginId]?.[view.visibleSetting] ?? host.settings.get(view.pluginId + ':' + view.visibleSetting)?.default) !== false));
    const activeIds = new Set(visible ? views.map(view => view.id) : []);
    for (const [id, container] of contextViews) if (!activeIds.has(id)) { host.unmountView(id); container.remove(); contextViews.delete(id); }
    options.contextContainer.hidden = !activeIds.size;
    for (const view of views) {
      if (!visible || contextViews.has(view.id) || host.plugins.get(view.pluginId)?.state !== 'enabled') continue;
      const container = element('div', 'context-plugin-view'); container.dataset.contextView = view.id; options.contextContainer.append(container); contextViews.set(view.id, container);
      try { host.mountView(view.id, container); } catch (error) { container.remove(); contextViews.delete(view.id); options.failure(error); }
    }
  }
  function renderView(view) {
    if (view?.mount) { host.mountView(view.id, content); return; }
    content.replaceChildren(); if (!view) return;
    const rows = view.model?.type === 'notes' && Array.isArray(view.model.rows) ? view.model.rows.slice(0, 250) : [];
    content.append(element('div', 'plugin-list-count', `${rows.length} 篇笔记`));
    if (!rows.length) content.append(element('p', 'empty-state', '没有符合条件的笔记'));
    for (const row of rows) {
      const button = element('button', 'plugin-note-row'); button.type = 'button'; button.dataset.noteId = String(row.id);
      button.append(element('strong', '', String(row.title || row.name || '未命名')), element('small', '', String(row.folder || '根目录')));
      button.onclick = () => { closeView(); options.open(String(row.id)).catch(options.failure); }; content.append(button);
    }
  }
  async function mountPackagedPlugin(pkg, autoEnable = false) {
    if (host.plugins.has(pkg.manifest.id)) host.unregister(pkg.manifest.id);
    for (const stale of document.querySelectorAll(`[data-plugin-sandbox="${pkg.manifest.id}"]`)) stale.remove();
    host.register(pkg.manifest, async api => sandboxedActivation(pkg.source)(api), { packaged: true });
    const shouldEnable = autoEnable || options.settings().enabledPlugins?.includes(pkg.manifest.id);
    if (shouldEnable && !options.settings().pluginSafeMode && !(options.settings().disabledPlugins || []).includes(pkg.manifest.id)) {
      await host.enable(pkg.manifest.id, pkg.manifest.capabilities);
    }
  }
  function renderSettings(order) {
    const focused = document.activeElement; if (settingsBody.contains(focused) && ((focused.tagName === 'INPUT' && focused.type !== 'checkbox') || focused.tagName === 'TEXTAREA')) return;
    const settings = options.settings(); settingsBody.replaceChildren();
    for (const [key, label] of [['activityLabels', '活动栏显示文字'], ['textNavigation', '显示传统文字导航'], ['pluginSafeMode', '插件安全模式']]) {
      const row = element('label', 'checkbox-setting'); const input = element('input'); input.type = 'checkbox'; input.checked = Boolean(settings[key]); input.id = 'setting-' + key;
      input.onchange = async () => { options.changeSettings({ [key]: input.checked }); if (key === 'pluginSafeMode' && input.checked) host.safeMode(); else if (key === 'pluginSafeMode') await activateConfigured(); scheduleRender(); };
      row.append(input, document.createTextNode(label)); settingsBody.append(row);
    }
    const navigation = element('div', 'activity-settings');
    for (const [index, view] of order.entries()) {
      const row = element('div', 'activity-setting-row'); row.append(element('span', '', view.name));
      for (const [delta, icon, label] of [[-1, ArrowUp, '上移'], [1, ArrowDown, '下移']]) {
        const button = tool(icon, label + view.name, () => { const ids = order.map(item => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; options.changeSettings({ activityOrder: ids }); scheduleRender(); });
        button.disabled = index + delta < 0 || index + delta >= order.length; row.append(button);
      }
      const pinned = settings.activityPinned?.includes(view.id); const hidden = settings.activityHidden?.includes(view.id);
      const pin = tool(Pin, (pinned ? '取消固定' : '固定') + view.name, () => changeActivity('activityPinned', view.id, !pinned)); pin.setAttribute('aria-pressed', String(Boolean(pinned)));
      const visible = tool(hidden ? EyeOff : Eye, (hidden ? '显示' : '隐藏') + view.name, () => changeActivity('activityHidden', view.id, !hidden)); visible.setAttribute('aria-pressed', String(!hidden)); row.append(pin, visible); navigation.append(row);
    }
    settingsBody.append(navigation);
    for (const plugin of host.plugins.values()) {
      if (plugin.essential) continue;
      const row = element('label', 'plugin-setting-row'); const input = element('input'); input.type = 'checkbox'; input.dataset.pluginId = plugin.manifest.id;
      input.checked = plugin.state === 'enabled'; input.disabled = Boolean(settings.pluginSafeMode);
      const label = element('span', '', plugin.manifest.name); label.append(element('small', '', plugin.manifest.version + ' · ' + (plugin.state === 'failed' ? plugin.error : plugin.state === 'enabled' ? '已启用' : '已停用')));
      input.onchange = async () => {
        const enabled = input.checked; input.disabled = true;
        options.changeSettings({ disabledPlugins: enabled ? (options.settings().disabledPlugins || []).filter(id => id !== plugin.manifest.id) : [...new Set([...(options.settings().disabledPlugins || []), plugin.manifest.id])], enabledPlugins: enabled ? [...new Set([...(options.settings().enabledPlugins || []), plugin.manifest.id])] : (options.settings().enabledPlugins || []).filter(id => id !== plugin.manifest.id) });
        try { if (enabled) await host.enable(plugin.manifest.id, plugin.manifest.capabilities); else host.disable(plugin.manifest.id); } catch (error) { options.failure(error); } finally { scheduleRender(); }
      };
      row.append(input, label); settingsBody.append(row);
    }
    for (const setting of host.settings.values()) {
      if (setting.type === 'data') continue;
      const row = element('label', 'plugin-setting-row'); row.append(element('span', '', host.plugins.get(setting.pluginId).manifest.name + ' · ' + setting.name));
      const input = element(setting.type === 'choice' ? 'select' : 'input'); input.dataset.pluginSetting = setting.id;
      const value = settings.pluginSettings?.[setting.pluginId]?.[setting.id.slice(setting.pluginId.length + 1)] ?? setting.default;
      if (setting.type === 'boolean') { input.type = 'checkbox'; input.checked = Boolean(value); }
      else if (setting.type === 'number') { input.type = 'number'; input.min = setting.min; input.max = setting.max; input.step = Number.isInteger(setting.min) && Number.isInteger(setting.max) && Number.isInteger(setting.default) ? '1' : 'any'; input.value = value; }
      else { input.append(...setting.options.map(option => new Option(option.label, option.value))); input.value = value; }
      input.onchange = () => host.setSetting(setting.id, setting.type === 'boolean' ? input.checked : setting.type === 'number' ? Number(input.value) : setting.options.find(option => String(option.value) === input.value)?.value).catch(options.failure); row.append(input); settingsBody.append(row);
    }
    const commands = element('div', 'plugin-command-settings');
    for (const command of host.commands.values()) {
      if (command.pluginId === 'core-navigation') continue;
      const row = element('label', 'shortcut-row'); const input = element('input', 'hotkey-input'); input.readOnly = true; input.value = settings.pluginShortcuts?.[command.id] ?? command.shortcut ?? ''; input.setAttribute('aria-label', command.name + '快捷键');
      input.onkeydown = event => {
        if (event.key === 'Tab') return; event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { input.blur(); return; }
        const value = ['Backspace', 'Delete'].includes(event.key) ? '' : shortcutFromEvent(event); if (value === null || value === undefined) return;
        if (value && (options.shortcutInUse(value) || [...host.commands.values()].some(other => other.id !== command.id && (settings.pluginShortcuts?.[other.id] ?? other.shortcut) === value))) { options.failure(new Error('快捷键已占用')); return; }
        input.value = value; options.changeSettings({ pluginShortcuts: { ...options.settings().pluginShortcuts, [command.id]: value } });
      };
      row.append(element('span', '', command.name), input); commands.append(row);
    }
    const reset = element('button', 'small-command', '恢复插件快捷键'); reset.type = 'button'; reset.onclick = () => { options.changeSettings({ pluginShortcuts: {} }); scheduleRender(); }; commands.append(reset);
    settingsBody.append(commands);

    const pkgManager = element('div', 'plugin-package-manager');
    pkgManager.id = 'plugin-package-manager';
    const pkgTitle = element('strong', '', '离线扩展包管理与开发目录 (SDK-007 / ECO-001 / ECO-002)');
    const pkgStatus = element('small', '', packageStatusText);
    pkgStatus.id = 'plugin-package-status';

    const pkgActions = element('div', 'task-row-actions');
    const exportTplBtn = element('button', 'small-command', '生成开发模板包');
    exportTplBtn.type = 'button';
    exportTplBtn.id = 'plugin-export-template';
    const installJsonBtn = element('button', 'small-command', '校验并安装扩展包');
    installJsonBtn.type = 'button';
    installJsonBtn.id = 'plugin-install-json-btn';
    const fileInput = element('input');
    fileInput.type = 'file';
    fileInput.id = 'plugin-import-file';
    fileInput.accept = '.json,.inkloom-plugin.json';
    fileInput.setAttribute('aria-label', '选择离线扩展包文件');
    pkgActions.append(exportTplBtn, installJsonBtn, fileInput);

    const pkgTextarea = element('textarea', 'ai-export-box');
    pkgTextarea.id = 'plugin-package-json';
    pkgTextarea.rows = 3;
    pkgTextarea.placeholder = '在此粘贴 .inkloom-plugin.json 内容，或点击「生成开发模板包」体验外部扩展的开发、安装、升级与回退';
    pkgTextarea.setAttribute('aria-label', '离线扩展包 JSON 内容');
    pkgTextarea.value = packageDraftJson;
    pkgTextarea.oninput = () => { packageDraftJson = pkgTextarea.value; };

    exportTplBtn.onclick = async () => {
      try {
        const reg = normalizePluginRegistryState(options.settings().pluginPackages);
        const existing = reg.installed['reading-stats-helper'];
        const nextVer = existing?.manifest?.version === '1.0.0' ? '1.1.0' : '1.0.0';
        const tpl = await createPluginTemplatePackage({
          id: 'reading-stats-helper',
          name: nextVer === '1.1.0' ? '阅读卡片统计助手 Pro' : '阅读卡片统计助手',
          version: nextVer,
        });
        packageDraftJson = JSON.stringify(tpl, null, 2);
        packageStatusText = `已生成 SDK 1.7 离线扩展模板包（${tpl.manifest.id} v${tpl.manifest.version} · SHA ${tpl.sha256.slice(0, 8)}）`;
        for (const ta of [pkgTextarea, document.querySelector('#plugin-package-json')].filter(Boolean)) ta.value = packageDraftJson;
        for (const st of [pkgStatus, document.querySelector('#plugin-package-status')].filter(Boolean)) st.textContent = packageStatusText;
      } catch (err) {
        options.failure(err);
      }
    };

    const runInstallFromRaw = async rawText => {
      try {
        const parsed = JSON.parse(rawText);
        const res = await installPluginPackage(options.settings().pluginPackages, parsed);
        const enabledSet = new Set([...(options.settings().enabledPlugins || []), res.installed.manifest.id]);
        const disabledList = (options.settings().disabledPlugins || []).filter(id => id !== res.installed.manifest.id);
        packageStatusText = `已安装扩展 ${res.installed.manifest.name} v${res.installed.manifest.version}${res.upgraded ? '（已备份 v' + res.previousVersion + ' 可回退）' : ''}`;
        await options.changeSettings({
          pluginPackages: res.nextState,
          enabledPlugins: [...enabledSet],
          disabledPlugins: disabledList,
        });
        await mountPackagedPlugin(res.installed, true);
        scheduleRender();
      } catch (err) {
        packageStatusText = '扩展包校验拒绝：' + (err.message || String(err));
        for (const st of [pkgStatus, document.querySelector('#plugin-package-status')].filter(Boolean)) st.textContent = packageStatusText;
        options.failure(err);
      }
    };

    installJsonBtn.onclick = () => {
      if (!pkgTextarea.value.trim()) {
        options.failure(new Error('请先生成或粘贴扩展包 JSON'));
        return;
      }
      void runInstallFromRaw(pkgTextarea.value);
    };

    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const text = await f.text();
      packageDraftJson = text;
      pkgTextarea.value = text;
      await runInstallFromRaw(text);
    };

    const installedWrap = element('div', 'plugin-installed-list');
    installedWrap.id = 'plugin-installed-packages';
    const regState = normalizePluginRegistryState(settings.pluginPackages);
    for (const pkg of Object.values(regState.installed)) {
      const pid = pkg.manifest.id;
      const backup = regState.backups[pid];
      const row = element('div', 'activity-setting-row');
      row.dataset.installedPackageId = pid;
      const info = element('span', '', `${pkg.manifest.name} v${pkg.manifest.version} (${pkg.license} · SHA ${pkg.sha256.slice(0, 8)})`);
      row.append(info);
      if (backup) {
        const rbBtn = element('button', 'small-command', `回退至 v${backup.manifest.version}`);
        rbBtn.type = 'button';
        rbBtn.dataset.rollbackPlugin = pid;
        rbBtn.onclick = async () => {
          try {
            const rolled = rollbackPluginPackage(options.settings().pluginPackages, pid);
            packageStatusText = `已回退 ${rolled.restored.manifest.name} 至 v${rolled.restored.manifest.version}`;
            await mountPackagedPlugin(rolled.restored, true);
            await options.changeSettings({ pluginPackages: rolled.nextState });
          } catch (err) { options.failure(err); }
        };
        row.append(rbBtn);
      }
      const rmBtn = element('button', 'small-command', '卸载');
      rmBtn.type = 'button';
      rmBtn.dataset.removePlugin = pid;
      rmBtn.onclick = async () => {
        try {
          if (host.plugins.has(pid)) host.unregister(pid);
          for (const stale of document.querySelectorAll(`[data-plugin-sandbox="${pid}"]`)) stale.remove();
          const removed = removePluginPackage(options.settings().pluginPackages, pid);
          packageStatusText = `已卸载离线扩展 ${pid}`;
          await options.changeSettings({
            pluginPackages: removed.nextState,
            enabledPlugins: (options.settings().enabledPlugins || []).filter(id => id !== pid),
          });
          for (const stale of document.querySelectorAll(`[data-plugin-sandbox="${pid}"]`)) stale.remove();
        } catch (err) { options.failure(err); }
      };
      row.append(rmBtn);
      installedWrap.append(row);
    }

    const catalogDetails = element('div', 'plugin-catalog-box');
    catalogDetails.id = 'plugin-catalog-details';
    const catalogSummary = element('small', '', `离线扩展目录与来源许可清单 (${defaultExtensionCatalog().length})`);
    const catalogList = element('div', 'plugin-catalog-list');
    catalogList.id = 'plugin-catalog-list';
    for (const item of defaultExtensionCatalog()) {
      const itemRow = element('div', 'activity-setting-row');
      itemRow.dataset.catalogPluginId = item.id;
      itemRow.append(
        element('span', '', `${item.name} (${item.id} v${item.version})`),
        element('small', '', `${item.license} · ${item.isolation}`),
      );
      catalogList.append(itemRow);
    }
    catalogDetails.append(catalogSummary, catalogList);

    pkgManager.append(pkgTitle, pkgStatus, pkgActions, pkgTextarea, installedWrap, catalogDetails);
    settingsBody.append(pkgManager);
  }

  entries.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...entries.children]; const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.isComposing || document.querySelector('dialog[open]')) return;
    const shortcut = shortcutFromEvent(event); if (!shortcut) return;
    const command = [...host.commands.values()].find(item => (options.settings().pluginShortcuts?.[item.id] ?? item.shortcut) === shortcut);
    if (command) { event.preventDefault(); event.stopImmediatePropagation(); host.command(command.id).catch(options.failure); }
  }, { capture: true, signal });
  host.register({ id: 'core-navigation', name: '工作台导航', version: '0.3.0', minHost: '0.3.0', entry: 'builtin:navigation', activation: ['startup'], dependencies: [], capabilities: ['views', 'commands'] }, api => {
    for (const [order, descriptor] of [['vault', '知识库', 'folder-tree'], ['tags', '标签', 'hash'], ['starred', '星标', 'star'], ['outline', '大纲', 'list-tree'], ['daily', '今日手记', 'calendar'], ['search', '搜索笔记', 'search']].entries()) {
      const [target, name, icon] = descriptor;
      api.registerView({ id: target + '-view', target, name, icon, order: order * 10, location: 'activity', run: () => api.navigate(target) });
    }
  }, { trusted: true, essential: true });
  host.register(unlinkedManifest, activateUnlinked, { trusted: true });
  host.register(noteViewsManifest, async api => { const { activate } = await import('../../plugins/note-views/main.js'); return activate(api); }, { trusted: true });
  host.register(graphManifest, async api => { const { activate } = await import('../../plugins/knowledge-graph/main.js'); return activate(api); }, { trusted: true });
  host.register(homeManifest, async api => { const { activate } = await import('../../plugins/workspace-home/main.js'); return activate(api); }, { trusted: true });
  host.register(whiteboardManifest, async api => { const { activate } = await import('../../plugins/whiteboard/main.js'); return activate(api); }, { trusted: true });
  host.register(researchManifest, async api => { const { activate } = await import('../../plugins/research-desk/main.js'); return activate(api); }, { trusted: true });
  host.register(aiManifest, async api => { const { activate } = await import('../../plugins/ai-assistant/main.js'); return activate(api); }, { trusted: true });
  for (const [file, manifest] of Object.entries(manifests)) {
    if (['../../plugins/unlinked-notes/manifest.json', '../../plugins/note-views/manifest.json', '../../plugins/knowledge-graph/manifest.json', '../../plugins/workspace-home/manifest.json', '../../plugins/whiteboard/manifest.json', '../../plugins/research-desk/manifest.json', '../../plugins/ai-assistant/manifest.json'].includes(file)) continue;
    const entry = isolatedEntries[file.replace('manifest.json', manifest.entry)];
    try {
      if (!entry) throw new Error('Plugin entry is missing');
      host.register(manifest, async api => sandboxedActivation(await entry())(api));
    } catch (error) { options.failure(error); }
  }
  const initialPackages = normalizePluginRegistryState(options.settings().pluginPackages);
  for (const pkg of Object.values(initialPackages.installed)) {
    try {
      host.register(pkg.manifest, async api => sandboxedActivation(pkg.source)(api), { packaged: true });
    } catch (error) { options.failure(error); }
  }
  async function activateConfigured() {
    for (const id of host.activationOrder()) {
      const plugin = host.plugins.get(id);
      if (plugin.essential || (!options.settings().pluginSafeMode && !(options.settings().disabledPlugins || []).includes(id) && ((plugin.trusted && plugin.manifest.activation.includes('startup')) || options.settings().enabledPlugins?.includes(id)))) await host.enable(id, plugin.manifest.capabilities).catch(options.failure);
    }
  }
  await activateConfigured(); render();
  return {
    host, refresh: scheduleRender, closeView,
    get activeTarget() { return host.views.get(selected)?.target || ''; },
    openDatabase: () => host.openView('note-views:database-view'),
    openGraph: () => host.openView('knowledge-graph:global-view'),
    openHome: () => host.openView('workspace-home:home-view'),
    openWhiteboard: () => host.openView('whiteboard:whiteboard-view'),
    openAi: () => host.openView('ai-assistant:ai-view'),
    openViewById: id => host.openView(id),
    changed: detail => host.emit('vault.changed', detail),
    activeChanged: detail => host.emit('workspace.active', detail),
    draftChanged: detail => host.emit('workspace.draft', detail),
    appearanceChanged: detail => { scheduleRender(); return host.emit('workspace.appearance', detail); },
    dispose: () => { disposed = true; controller.abort(); host.dispose(); for (const container of contextViews.values()) container.remove(); contextViews.clear(); rail.remove(); stage.remove(); group.remove(); reminders.remove(); },
  };
}