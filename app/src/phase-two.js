import { createElement, SlidersHorizontal, Pencil, ChevronRight } from 'lucide';
import { queryVaultDatabase, parseFrontMatter, planVaultRename } from '../../core/vault-graph.mjs';
import { detectSlashTrigger, filterSlashCommands } from './wikilink-plugin.js';
import { shortcutCommands, shortcutFor, shortcutFromEvent, validateShortcuts } from '../../vendor/inklet/core/shortcuts.mjs';
import { mountVaultManager } from './vault-manager.js';
import { mountAppearancePanel } from './appearance-panel.js';

const find = selector => document.querySelector(selector);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconButton(icon, label, handler, text = '') {
  const button = element('button', text ? 'phase-command' : 'icon-button');
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  button.append(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' }));
  if (text) button.append(element('span', '', text));
  button.addEventListener('click', handler);
  return button;
}

export function mountPhaseTwo(api) {
  let propertyOwner = null;
  let propertyBaseline = '';
  let slashTrigger = null;
  let slashItems = [];
  let slashIndex = 0;
  let dismissedSlash = '';
  let composing = false;
  let busy = false;
  const guarded = handler => async (...args) => {
    if (busy) return;
    busy = true;
    try { await handler(...args); } catch (error) { api.error(error); }
    finally { busy = false; }
  };

  const propertiesButton = iconButton(SlidersHorizontal, '编辑笔记属性', () => {
    if (!api.graph?.nodeMap.get(api.activeId)?.exists) return;
    properties.hidden = !properties.hidden;
    if (!properties.hidden) { populateProperties(); properties.querySelector('input').focus(); }
  });
  propertiesButton.id = 'properties-button';
  const renameButton = iconButton(Pencil, '重命名笔记', openRename);
  renameButton.id = 'rename-note-button';
  find('.note-context-actions').prepend(propertiesButton, renameButton);

  const properties = element('section', 'note-properties-editor');
  properties.id = 'note-properties-editor'; properties.hidden = true;
  properties.setAttribute('aria-label', '笔记属性');
  const propertyForm = element('form', 'property-form');
  const propertyInputs = new Map();
  for (const [key, label, type] of [['title', '标题', 'text'], ['status', '状态', 'text'], ['tags', '标签', 'text'], ['aliases', '别名', 'text'], ['date', '日期', 'date'], ['category', '分类', 'text']]) {
    const field = element('label', 'property-field', label);
    const input = element('input'); input.name = key; input.type = type; input.id = 'property-' + key; input.autocomplete = 'off';
    if (key === 'status') input.setAttribute('list', 'note-status-values');
    if (key === 'tags' || key === 'aliases') input.placeholder = '用逗号分隔';
    field.append(input); propertyForm.append(field); propertyInputs.set(key, input);
  }
  const statusValues = element('datalist'); statusValues.id = 'note-status-values'; propertyForm.append(statusValues);
  const propertyActions = element('div', 'property-actions');
  const cancelProperties = element('button', 'small-command', '取消'); cancelProperties.type = 'button';
  cancelProperties.onclick = () => { properties.hidden = true; propertiesButton.focus(); };
  const applyProperties = element('button', 'primary-command', '保存属性'); applyProperties.type = 'submit'; applyProperties.id = 'apply-properties';
  propertyActions.append(cancelProperties, applyProperties); propertyForm.append(propertyActions); properties.append(propertyForm);
  find('#note-context-bar').after(properties);
  function populateProperties() {
    const note = api.graph?.nodeMap.get(api.activeId);
    if (!note) { properties.hidden = true; return; }
    propertyOwner = api.activeId; propertyBaseline = api.source;
    const metadata = parseFrontMatter(propertyBaseline).metadata;
    for (const [key, input] of propertyInputs) input.value = Array.isArray(metadata[key]) ? metadata[key].join(', ') : metadata[key] || '';
    statusValues.replaceChildren(...queryVaultDatabase(api.graph).statuses.map(status => new Option(status, status)));
  }
  propertyForm.addEventListener('submit', event => {
    event.preventDefault();
    guarded(async () => {
      if (propertyOwner !== api.activeId || propertyBaseline !== api.source) throw new Error('笔记在属性编辑期间已变化，请重新打开属性面板，未覆盖正文。');
      const patch = {};
      for (const [key, input] of propertyInputs) patch[key] = ['tags', 'aliases'].includes(key) ? input.value.split(/[,，;；]/).map(value => value.trim()).filter(Boolean) : input.value.trim();
      applyProperties.disabled = true;
      try { await api.updateProperties(propertyOwner, patch); properties.hidden = true; refresh(); }
      finally { applyProperties.disabled = false; }
    })();
  });

  const settingsContent = find('#settings-dialog .settings-content');
  const groups = new Map();
  const initialOpenGroup = Object.keys(api.settings.settingsGroups || {}).find(key => api.settings.settingsGroups[key]) || (api.settings.settingsGroups?.appearance !== false ? 'appearance' : null);
  for (const [key, title] of [['appearance', '外观与主题'], ['reading', '阅读与排版'], ['editing', '编辑与提示块'], ['knowledge', '知识库与视图'], ['code', '代码配色'], ['shortcuts', '快捷键']]) {
    const details = element('details', 'settings-group'); details.dataset.settingsGroup = key; details.name = 'inkloom-settings';
    const summary = element('summary', '', title); summary.append(createElement(ChevronRight, { width: 16, height: 16, 'aria-hidden': 'true' }));
    const body = element('div', 'settings-group-content'); details.append(summary, body); groups.set(key, { details, body });
  }
  const move = (key, selector, ancestor) => {
    const target = find(selector); if (!target) return;
    groups.get(key).body.append(ancestor ? target.closest(ancestor) : target);
  };
  move('appearance', '#interface-family-input', 'fieldset');
  move('appearance', '#source-family-input', 'fieldset'); move('appearance', '#reader-family-input', 'fieldset');
  move('appearance', '[data-action="unify-theme"]'); move('appearance', '#paper-input', 'label');
  for (const id of ['reading-font-input', 'font-input', 'line-height-input', 'paragraph-gap-input', 'reading-width-input', 'restore-reading-input', 'ctrl-wheel-input']) move('reading', '#' + id, 'label');
  for (const id of ['opacity-input', 'sync-input', 'compress-input', 'embed-images-input']) move('editing', '#' + id, 'label');
  for (const id of ['outline-side-input', 'search-results-input']) move('knowledge', '#' + id, 'label');
  move('code', '.code-colors-settings');
  settingsContent.replaceChildren(...[...groups.values()].map(group => group.details));
  find('#settings-dialog h2').textContent = '设置';
  const themeLegend = groups.get('appearance').body.querySelector('legend'); if (themeLegend) themeLegend.textContent = '客户端主题';
  const controls = new Map();
  function checkbox(key, label, group, defaultValue) {
    const field = element('label', 'checkbox-setting'); const input = element('input'); input.type = 'checkbox'; input.id = 'setting-' + key;
    input.onchange = () => { api.changeSettings({ [key]: input.checked }); refresh(); };
    field.append(input, document.createTextNode(label)); groups.get(group).body.append(field); controls.set(key, { input, defaultValue });
  }
  checkbox('slashMenu', '斜杠插入菜单', 'editing', true);
  checkbox('autoUpdateLinks', '重命名时更新双链引用', 'knowledge', true);
  checkbox('showBacklinksFooter', '同时在文末显示反链', 'knowledge', false);
  checkbox('formattingToolbar', '默认显示格式工具条', 'editing', false);
  const vaultManager = mountVaultManager(groups.get('knowledge').body, api);
  const appearancePanel = mountAppearancePanel(groups.get('appearance').body, api);
  const appearanceBody = groups.get('appearance').body;
  const themeGrid = element('div', 'appearance-theme-grid');
  for (const fieldset of [...appearanceBody.querySelectorAll(':scope > fieldset')]) themeGrid.append(fieldset);
  const themeFooter = element('div', 'appearance-theme-footer');
  const unifyBtn = appearanceBody.querySelector('[data-action="unify-theme"]');
  const paperLabel = appearanceBody.querySelector('#paper-input')?.closest('label');
  if (unifyBtn) themeFooter.append(unifyBtn);
  if (paperLabel) themeFooter.append(paperLabel);
  appearanceBody.prepend(themeGrid, themeFooter);

  const calloutLabel = element('label', 'select-setting', '提示块样式');
  const calloutSelect = element('select'); calloutSelect.id = 'setting-calloutStyle'; calloutSelect.append(new Option('柔和彩底', 'soft'), new Option('简洁边线', 'outline'));
  calloutSelect.onchange = () => api.changeSettings({ calloutStyle: calloutSelect.value }); calloutLabel.append(calloutSelect); groups.get('editing').body.append(calloutLabel);
  for (const [key, group] of groups) {
    group.details.open = key === initialOpenGroup;
    group.details.addEventListener('toggle', () => {
      if ((api.settings.settingsGroups?.[key] ?? key === 'appearance') !== group.details.open) api.changeSettings({ settingsGroups: { ...api.settings.settingsGroups, [key]: group.details.open } });
    });
  }
  const shortcuts = find('#shortcuts-list'); groups.get('shortcuts').body.append(shortcuts);
  const shortcutError = find('#shortcut-error'); groups.get('shortcuts').body.append(shortcutError);
  const saveKeys = element('button', 'small-command', '保存快捷键'); saveKeys.type = 'button';
  const resetKeys = element('button', 'small-command', '恢复默认'); resetKeys.type = 'button';
  groups.get('shortcuts').body.append(saveKeys, resetKeys); find('#shortcuts-dialog').remove();
  function renderKeys() {
    shortcuts.replaceChildren();
    for (const command of shortcutCommands) {
      const row = element('label', 'shortcut-row'); const input = element('input', 'hotkey-input');
      input.readOnly = true; input.dataset.shortcutCommand = command.id; input.value = shortcutFor(command, api.settings.shortcuts || {});
      input.setAttribute('aria-label', command.label + '快捷键');
      input.onkeydown = event => { if (event.key === 'Tab') return; event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') { input.blur(); return; } if (['Delete', 'Backspace'].includes(event.key) && !event.ctrlKey && !event.altKey) input.value = ''; else { const value = shortcutFromEvent(event); if (value) input.value = value; } };
      row.append(element('span', '', command.label), input); shortcuts.append(row);
    }
  }
  saveKeys.onclick = () => {
    const overrides = Object.fromEntries([...shortcuts.querySelectorAll('input')].map(input => [input.dataset.shortcutCommand, input.value]));
    if (validateShortcuts(overrides) || Object.values(overrides).some(value => ['Ctrl+K', 'Ctrl+G'].includes(value))) { shortcutError.textContent = '快捷键冲突或使用了保留键，请检查。'; return; }
    api.changeSettings({ shortcuts: overrides }); shortcutError.textContent = '已保存';
  };
  resetKeys.onclick = () => { api.changeSettings({ shortcuts: {} }); renderKeys(); shortcutError.textContent = ''; }; renderKeys();

  const slash = element('div', 'wikilink-suggest slash-suggest'); slash.id = 'slash-menu'; slash.hidden = true; slash.setAttribute('role', 'listbox'); slash.setAttribute('aria-label', '插入内容'); document.body.append(slash);
  function updateSlash() {
    if (composing || !api.editorFocused || document.querySelector('dialog[open]') || api.viewOpen) { slash.hidden = true; return; }
    const trigger = detectSlashTrigger(api.source, api.cursor, api.settings.slashMenu !== false);
    if (!trigger || trigger.from + ':' + trigger.query === dismissedSlash) { slash.hidden = true; return; }
    if (!slashTrigger || slashTrigger.query !== trigger.query) slashIndex = 0;
    slashTrigger = { ...trigger, noteId: api.activeId, source: api.source };
    slashItems = filterSlashCommands(trigger.query); slash.hidden = !slashItems.length;
    slash.replaceChildren();
    for (const [index, item] of slashItems.entries()) {
      const row = element('button', 'wikilink-suggest-item' + (index === slashIndex ? ' active' : ''), item.label); row.type = 'button'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === slashIndex)); row.dataset.slashCommand = item.id;
      row.onpointerdown = event => { event.preventDefault(); applySlash(item); }; slash.append(row);
    }
    if (slash.hidden) return;
    const anchor = api.anchor;
    slash.style.left = Math.max(8, Math.min(innerWidth - Math.min(310, innerWidth - 16) - 8, anchor.left)) + 'px';
    slash.style.top = Math.max(8, Math.min(innerHeight - Math.min(280, innerHeight - 16) - 8, anchor.bottom + 8)) + 'px';
  }
  function applySlash(item) {
    if (!slashTrigger || slashTrigger.noteId !== api.activeId || slashTrigger.source !== api.source) { slash.hidden = true; return; }
    const from = slashTrigger.from; const to = slashTrigger.to;
    const activeNode = api.graph?.nodeMap.get(api.activeId);
    const insertion = item.dynamicContextTemplate
      ? item.dynamicContextTemplate({
          source: api.source,
          cursorOffset: from,
          noteTitle: activeNode?.cleanTitle || activeNode?.title || '',
          relatedSnippets: api.liveConnections ? api.liveConnections() : [],
        })
      : item.dynamicTemplate
        ? item.dynamicTemplate()
        : item.template || '[[';
    slash.hidden = true; slashTrigger = null; dismissedSlash = '';
    api.edit({ from, to, insert: insertion }, from + insertion.length);
  }
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing || slash.hidden) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); slashIndex = (slashIndex + (event.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length; updateSlash(); slash.children[slashIndex]?.scrollIntoView({ block: 'nearest' }); }
    else if (['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); applySlash(slashItems[slashIndex]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); dismissedSlash = slashTrigger.from + ':' + slashTrigger.query; slash.hidden = true; }
  }, true);
  document.addEventListener('compositionstart', () => { composing = true; slash.hidden = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; requestAnimationFrame(updateSlash); }, true);
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#slash-menu,.editor-pane')) slash.hidden = true; }, true);

  function openRename() {
    const note = api.graph?.nodeMap.get(api.activeId); if (!note?.exists) return;
    const content = find('#edit-content'); content.replaceChildren();
    const label = element('label', 'editor-label', '文件名'); const input = element('input', 'rename-input'); input.id = 'rename-title'; input.value = note.stem; input.required = true; label.append(input);
    const updateLabel = element('label', 'checkbox-setting'); const update = element('input'); update.type = 'checkbox'; update.checked = api.settings.autoUpdateLinks !== false; update.id = 'rename-update-links'; updateLabel.append(update, document.createTextNode('同时更新双链引用'));
    const preview = element('p', 'rename-preview'); preview.id = 'rename-preview';
    const recompute = () => { try { const plan = planVaultRename(api.vault.notes, note.id, input.value, update.checked); preview.textContent = '涉及 ' + plan.affectedNotes + ' 篇引用笔记，' + plan.rewrittenLinks + ' 处双链'; } catch (error) { preview.textContent = error.message; } };
    input.oninput = recompute; update.onchange = recompute; content.append(label, updateLabel, preview); recompute();
    api.showEdit('重命名笔记', async () => { await api.rename(note.id, input.value, update.checked); properties.hidden = true; refresh(); }); input.focus(); input.select();
  }
  function refresh() {
    vaultManager.refresh();
    appearancePanel.refresh();
    if (propertyOwner && propertyOwner !== api.activeId) properties.hidden = true;
    for (const [key, control] of controls) control.input.checked = api.settings[key] ?? control.defaultValue;
    calloutSelect.value = api.settings.calloutStyle || 'soft';
    const present = Boolean(api.graph?.nodeMap.get(api.activeId)?.exists);
    propertiesButton.disabled = !present; renameButton.disabled = !present;
  }
  find('#settings-dialog').addEventListener('close', () => { slash.hidden = true; });
  refresh();
  return { refresh, updateSlash, openVaultManager: () => vaultManager.open(), refreshManagement: () => { if (groups.get('knowledge').details.open) vaultManager.load(); } };
}