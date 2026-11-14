import { createElement, Download, Upload, RotateCcw, Eye, Check, X, Trash2, ImagePlus } from 'lucide';
import { appearancePresets } from '../../core/appearance-presets.mjs';
import { validateAppearancePack, validateIconPack, validateReaderCss, importObsidianTheme } from '../../core/appearance-pack.mjs';
import { appearanceIconCatalog, makeAppearanceIcon, sanitizeIconSvg } from './appearance-icons.js';

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const field = (label, control) => { const element = node('label', 'appearance-field', label); element.append(control); return element; };

export function mountAppearancePanel(container, api) {
  const runtime = api.appearance; let draft = runtime.savedConfig(); let busy = false; let scopeId = null; let savedReference = api.settings.appearance;
  const section = node('details', 'appearance-manager'); section.id = 'appearance-manager';
  const title = node('summary', '', '主题包与外观扩展');
  const content = node('div', 'appearance-manager-content');
  const gallery = node('div', 'appearance-gallery'); gallery.id = 'appearance-gallery';
  const theme = node('select'); theme.id = 'appearance-theme';
  const variant = node('select'); variant.id = 'appearance-variant'; variant.append(new Option('浅色', 'light'), new Option('深色', 'dark'));
  const status = node('p', 'appearance-status'); status.id = 'appearance-status'; status.setAttribute('role', 'status');
  const actions = node('div', 'appearance-actions'); const controls = [];
  function button(id, icon, label, action) {
    const control = node('button', 'phase-command'); control.type = 'button'; control.id = id; control.title = label; control.setAttribute('aria-label', label);
    control.append(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' }), node('span', '', label)); control.onclick = () => run(action); controls.push(control); return control;
  }
  async function run(action) {
    if (busy) return; busy = true; section.setAttribute('aria-busy', 'true'); for (const control of section.querySelectorAll('button,input:not([type="file"]),select,textarea')) control.disabled = true; status.classList.remove('has-error'); status.textContent = '处理中';
    try { await action(); if (!status.textContent || status.textContent === '处理中') status.textContent = '已更新'; }
    catch (error) { status.textContent = error.message; status.classList.add('has-error'); }
    finally { busy = false; section.setAttribute('aria-busy', 'false'); for (const control of section.querySelectorAll('button,input,select,textarea')) control.disabled = false; }
  }
  const selected = () => [...appearancePresets, ...(draft.packages || [])].find(pack => pack.id === draft.activeTheme);
  async function save() {
    try { await runtime.commit(draft); }
    catch (error) { draft = runtime.savedConfig(); render(); throw error; }
    draft = runtime.savedConfig(); status.textContent = '已应用'; render();
  }
  const preview = button('appearance-preview', Eye, '预览', () => { runtime.previewConfig(draft); status.textContent = '预览中'; });
  const apply = button('appearance-apply', Check, '应用', save);
  const cancel = button('appearance-cancel', X, '取消预览', () => { runtime.cancelPreview(); draft = runtime.savedConfig(); render(); status.textContent = '已还原'; });
  const reset = button('appearance-reset', RotateCcw, '恢复经典外观', async () => { draft.activeTheme = null; draft.activeIcons = null; draft.snippetEnabled = false; await save(); });
  const file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'appearance-import-file'; file.hidden = true;
  const importTheme = button('appearance-import', Upload, '导入主题包', () => file.click());
  const exportTheme = button('appearance-export', Download, '导出主题包', async () => { const pack = selected(); if (!pack) throw new Error('请先选择主题包'); await api.exportAppearance(pack, pack.id + '.inkloom-theme.json'); status.textContent = '已导出主题包'; });
  const remove = button('appearance-delete', Trash2, '删除自定义包', async () => { if (appearancePresets.some(pack => pack.id === draft.activeTheme)) throw new Error('内置主题不可删除'); draft.packages = (draft.packages || []).filter(pack => pack.id !== draft.activeTheme); draft.activeTheme = null; await save(); });
  file.onchange = () => run(async () => { const selectedFile = file.files[0]; if (!selectedFile) return; try { if (selectedFile.size > 512000) throw new Error('主题包超过500 KiB'); const pack = validateAppearancePack(JSON.parse(await selectedFile.text())); if (appearancePresets.some(item => item.id === pack.id)) throw new Error('自定义包不能覆盖内置主题'); draft.packages = [...(draft.packages || []).filter(item => item.id !== pack.id), pack]; if (draft.packages.length > 12) throw new Error('最多保存12个自定义主题'); draft.activeTheme = pack.id; render(); runtime.previewConfig(draft); status.textContent = '主题包已校验，预览中'; } finally { file.value = ''; } });
  theme.onchange = () => { draft.activeTheme = theme.value || null; renderGallery(); runtime.previewConfig(draft); status.textContent = '预览中'; };
  variant.onchange = () => { draft.variant = variant.value; renderGallery(); runtime.previewConfig(draft); status.textContent = '预览中'; };
  actions.append(preview, apply, cancel, reset, importTheme, exportTheme, remove, file);

  const obsidian = node('details', 'appearance-subsection'); obsidian.id = 'appearance-obsidian-section'; obsidian.append(node('summary', '', 'Obsidian 配色适配'));
  const obsidianFile = node('input'); obsidianFile.type = 'file'; obsidianFile.multiple = true; obsidianFile.accept = '.json,.css'; obsidianFile.id = 'appearance-obsidian-files'; obsidianFile.hidden = true;
  const obsidianImport = button('appearance-obsidian-import', Upload, '选择 manifest.json 和 theme.css', () => obsidianFile.click());
  const obsidianReport = node('p', 'appearance-status'); obsidianReport.id = 'appearance-obsidian-report'; obsidianReport.setAttribute('role', 'status');
  obsidianFile.onchange = () => run(async () => {
    try {
      const files = [...obsidianFile.files];
      const manifestFile = files.find(item => item.name.toLowerCase() === 'manifest.json');
      const stylesheetFile = files.find(item => item.name.toLowerCase() === 'theme.css');
      if (!manifestFile || !stylesheetFile || files.length !== 2) throw new Error('请同时选择同一主题的 manifest.json 和 theme.css。');
      if (manifestFile.size > 16384 || stylesheetFile.size > 1024 * 1024) throw new Error('主题文件超过大小上限。');
      const imported = importObsidianTheme(JSON.parse(await manifestFile.text()), await stylesheetFile.text(), appearancePresets[0]);
      const next = [...(draft.packages || []).filter(item => item.id !== imported.pack.id), imported.pack];
      if (next.length > 12) throw new Error('最多保存 12 个自定义主题。');
      draft.packages = next; draft.activeTheme = imported.pack.id; render(); runtime.previewConfig(draft);
      obsidianReport.textContent = `仅适配配色：${imported.mapped.length} 项；忽略 ${imported.ignoredRules} 条布局或外部规则${imported.warnings.length ? `，${imported.warnings.length} 个变量未支持` : ''}。`;
      obsidianReport.title = imported.warnings.join('\n');
      status.textContent = 'Obsidian 配色预览中，尚未应用';
    } finally { obsidianFile.value = ''; }
  });
  obsidian.append(obsidianImport, obsidianFile, obsidianReport);

  const snippets = node('details', 'appearance-subsection'); snippets.append(node('summary', '', '正文 CSS 片段'));
  const snippet = node('textarea'); snippet.id = 'appearance-css'; snippet.rows = 5; snippet.spellcheck = false; snippet.setAttribute('aria-label', '正文CSS片段');
  const snippetEnabled = node('input'); snippetEnabled.type = 'checkbox'; snippetEnabled.id = 'appearance-css-enabled'; const enabledLabel = node('label', 'checkbox-setting'); enabledLabel.append(snippetEnabled, document.createTextNode('启用片段'));
  const saveSnippet = button('appearance-css-save', Check, '校验并应用片段', async () => { draft.snippet = validateReaderCss(snippet.value); draft.snippetEnabled = snippetEnabled.checked; await save(); });
  snippets.append(snippet, enabledLabel, saveSnippet);

  const iconsSection = node('details', 'appearance-subsection'); iconsSection.append(node('summary', '', '图标包与规则'));
  const iconPack = node('select'); iconPack.id = 'appearance-icon-pack'; const iconFile = node('input'); iconFile.type = 'file'; iconFile.accept = '.json,application/json'; iconFile.id = 'appearance-icon-file'; iconFile.hidden = true;
  const importIcons = button('appearance-icons-import', Upload, '导入图标包', () => iconFile.click());
  const exportIcons = button('appearance-icons-export', Download, '导出图标包', async () => { const pack = (draft.iconPackages || []).find(pack => pack.id === draft.activeIcons); if (!pack) throw new Error('请先选择自定义图标包'); await api.exportAppearance(pack, pack.id + '.inkloom-icons.json'); });
  iconFile.onchange = () => run(async () => { const selectedFile = iconFile.files[0]; if (!selectedFile) return; try { if (selectedFile.size > 1024 * 1024) throw new Error('图标包超过1 MiB'); const pack = validateIconPack(JSON.parse(await selectedFile.text()), sanitizeIconSvg); draft.iconPackages = [...(draft.iconPackages || []).filter(item => item.id !== pack.id), pack]; if (draft.iconPackages.length > 6) throw new Error('最多保存6个图标包'); draft.activeIcons = pack.id; await save(); } finally { iconFile.value = ''; } });
  iconPack.onchange = () => run(async () => { draft.activeIcons = iconPack.value || null; await save(); });
  const target = node('select'); target.id = 'appearance-rule-target'; target.append(new Option('当前笔记', 'note'), new Option('当前目录', 'folder'), new Option('属性条件', 'property'));
  const propertyKey = node('input'); propertyKey.id = 'appearance-rule-key'; propertyKey.placeholder = '属性名';
  const propertyValue = node('input'); propertyValue.id = 'appearance-rule-value'; propertyValue.placeholder = '属性值';
  const search = node('input'); search.id = 'appearance-icon-search'; search.type = 'search'; search.placeholder = '搜索图标';
  const picker = node('div', 'appearance-icon-picker'); picker.id = 'appearance-icon-picker'; let selectedIcon = 'file-text';
  const color = node('input'); color.type = 'color'; color.id = 'appearance-icon-color'; color.value = '#287d77';
  const inheritColor = node('input'); inheritColor.type = 'checkbox'; inheritColor.checked = true; const inheritLabel = node('label', 'checkbox-setting'); inheritLabel.append(inheritColor, document.createTextNode('跟随主题颜色'));
  const scopeRules = () => { const key = runtime.vaultKey(); draft.rules ||= {}; draft.rules[key] ||= { notes: {}, folders: {}, properties: [] }; return draft.rules[key]; };
  function writeRule(kind, value) {
    const note = api.activeNote(); if (!note) throw new Error('请先打开知识库笔记'); const rules = scopeRules();
    if (target.value === 'property') {
      if (kind !== 'icon') throw new Error('Banner只支持当前笔记或目录'); const key = propertyKey.value.trim(); if (!/^[\w.-]{1,64}$/.test(key) || propertyValue.value.length > 120) throw new Error('属性条件无效');
      rules.properties = rules.properties.filter(rule => rule.key !== key || rule.value !== propertyValue.value); if (value !== undefined) rules.properties.push({ key, value: propertyValue.value, [kind]: value });
    } else {
      const key = target.value === 'note' ? note.id : (note.relativePath || '').split('/').slice(0, -1).join('/');
      const collection = target.value === 'note' ? rules.notes : rules.folders; collection[key] = { ...(collection[key] || {}) }; if (value === undefined) delete collection[key][kind]; else collection[key][kind] = value;
      if (!Object.keys(collection[key]).length) delete collection[key];
    }
  }
  const saveIcon = button('appearance-icon-save', Check, '应用图标规则', async () => { writeRule('icon', { name: selectedIcon, ...(inheritColor.checked ? {} : { color: color.value }) }); await save(); });
  const clearIcon = button('appearance-icon-clear', RotateCcw, '清除图标规则', async () => { writeRule('icon', undefined); await save(); });
  const deleteIcons = button('appearance-icons-delete', Trash2, '删除图标包', async () => { if (!draft.activeIcons) return; draft.iconPackages = (draft.iconPackages || []).filter(pack => pack.id !== draft.activeIcons); draft.activeIcons = null; await save(); });
  search.oninput = renderPicker;
  iconsSection.append(field('图标包', iconPack), importIcons, exportIcons, deleteIcons, iconFile, field('应用范围', target), propertyKey, propertyValue, search, picker, field('图标颜色', color), inheritLabel, saveIcon, clearIcon);

  const banners = node('details', 'appearance-subsection'); banners.append(node('summary', '', '本地 Banner'));
  const bannerEnabled = node('input'); bannerEnabled.type = 'checkbox'; bannerEnabled.id = 'appearance-banner-enabled'; const bannerEnabledLabel = node('label', 'checkbox-setting'); bannerEnabledLabel.append(bannerEnabled, document.createTextNode('显示本地Banner'));
  bannerEnabled.onchange = () => run(async () => { draft.bannerEnabled = bannerEnabled.checked; await save(); });
  const bannerTarget = node('select'); bannerTarget.id = 'appearance-banner-target'; bannerTarget.append(new Option('当前笔记', 'note'), new Option('当前目录', 'folder'), new Option('全库默认', 'default'));
  const bannerFile = node('input'); bannerFile.type = 'file'; bannerFile.accept = 'image/png,image/jpeg,image/webp'; bannerFile.id = 'appearance-banner-file'; bannerFile.hidden = true;
  const bannerPreview = node('img', 'appearance-banner-preview'); bannerPreview.id = 'appearance-banner-preview'; bannerPreview.alt = 'Banner预览'; bannerPreview.hidden = true; let bannerAsset = null;
  const height = node('input'); height.type = 'range'; height.min = '80'; height.max = '300'; height.step = '10'; height.value = '150'; height.id = 'appearance-banner-height';
  const focusX = node('input'); focusX.type = 'range'; focusX.min = '0'; focusX.max = '100'; focusX.value = '50'; focusX.id = 'appearance-banner-x';
  const focusY = node('input'); focusY.type = 'range'; focusY.min = '0'; focusY.max = '100'; focusY.value = '50'; focusY.id = 'appearance-banner-y';
  const includeExport = node('input'); includeExport.type = 'checkbox'; includeExport.id = 'appearance-banner-export'; const exportLabel = node('label', 'checkbox-setting'); exportLabel.append(includeExport, document.createTextNode('导出文档包含Banner'));
  const chooseBanner = button('appearance-banner-choose', ImagePlus, '选择本地图片', () => bannerFile.click());
  bannerFile.onchange = () => run(async () => {
    const selectedFile = bannerFile.files[0]; if (!selectedFile) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selectedFile.type) || selectedFile.size > 8 * 1024 * 1024) throw new Error('请选择8 MiB以内的PNG、JPEG或WebP图片');
      const source = URL.createObjectURL(selectedFile); const image = new Image();
      try {
        image.src = source; await image.decode(); if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('图片像素超过处理上限');
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/webp', .84); if (data.length > 1200000) throw new Error('压缩后的图片仍超过外观资源上限');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)); const id = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        draft.assets ||= {}; draft.assets[id] = { name: selectedFile.name, data }; bannerAsset = id; bannerPreview.src = data; bannerPreview.hidden = false; status.textContent = '本地图片已准备，尚未应用';
      } finally { URL.revokeObjectURL(source); }
    } finally { bannerFile.value = ''; }
  });
  function bannerRule(value) {
    if (bannerTarget.value === 'default') { draft.bannerDefaults ||= {}; if (value === undefined) delete draft.bannerDefaults[runtime.vaultKey()]; else draft.bannerDefaults[runtime.vaultKey()] = value; }
    else { const old = target.value; target.value = bannerTarget.value; try { writeRule('banner', value); } finally { target.value = old; } }
  }
  const applyBanner = button('appearance-banner-apply', Check, '应用Banner', async () => { if (!bannerAsset || !draft.assets?.[bannerAsset]) throw new Error('请先选择本地图片'); bannerRule({ assetId: bannerAsset, height: Number(height.value), x: Number(focusX.value), y: Number(focusY.value), includeInExport: includeExport.checked }); await save(); });
  const hideBanner = button('appearance-banner-hide', X, '此范围不显示', async () => { bannerRule(null); await save(); });
  const clearBanner = button('appearance-banner-clear', RotateCcw, '恢复继承', async () => { bannerRule(undefined); await save(); });
  for (const control of [height, focusX, focusY]) control.oninput = () => { bannerPreview.style.height = height.value + 'px'; bannerPreview.style.objectPosition = `${focusX.value}% ${focusY.value}%`; };
  banners.append(bannerEnabledLabel, field('应用范围', bannerTarget), chooseBanner, bannerFile, bannerPreview, field('高度', height), field('水平焦点', focusX), field('垂直焦点', focusY), exportLabel, applyBanner, hideBanner, clearBanner);

  content.append(gallery, field('主题包', theme), field('变体', variant), status, actions, obsidian, snippets, iconsSection, banners);
  section.append(title, content); container.prepend(section);
  function renderGallery() {
    gallery.replaceChildren();
    for (const pack of [...appearancePresets, ...(draft.packages || [])]) {
      const card = node('button', 'appearance-preview-tile'); card.type = 'button'; card.dataset.appearanceTheme = pack.id; card.setAttribute('aria-pressed', String(pack.id === draft.activeTheme));
      const palette = pack.variants[draft.variant || 'light']; const sample = node('span', 'appearance-miniature'); sample.style.backgroundColor = palette.base;
      for (const value of [palette.secondary, palette.accent, palette.ink]) { const swatch = node('i'); swatch.style.backgroundColor = value; sample.append(swatch); }
      card.append(sample, node('strong', '', pack.name)); card.onclick = () => { draft.activeTheme = pack.id; theme.value = pack.id; renderGallery(); runtime.previewConfig(draft); status.textContent = '预览中'; }; gallery.append(card);
    }
  }
  function renderPicker() {
    picker.replaceChildren(); const query = search.value.trim().toLowerCase(); const pack = (draft.iconPackages || []).find(pack => pack.id === draft.activeIcons);
    const entries = [...Object.entries(appearanceIconCatalog).map(([key, [, label]]) => [key, label]), ...Object.keys(pack?.assets || {}).map(key => ['custom:' + key, key])];
    for (const [name, label] of entries.filter(([name, label]) => !query || (name + ' ' + label).toLowerCase().includes(query)).slice(0, 60)) {
      const control = node('button', 'icon-button'); control.type = 'button'; control.title = label + ' · ' + name; control.setAttribute('aria-label', name); control.setAttribute('aria-pressed', String(name === selectedIcon)); control.append(makeAppearanceIcon(name, pack)); control.onclick = () => { selectedIcon = name; renderPicker(); }; picker.append(control);
    }
  }
  function render() {
    const packs = [...appearancePresets, ...(draft.packages || [])]; theme.replaceChildren(new Option('经典配色', ''), ...packs.map(pack => new Option(pack.name, pack.id))); theme.value = draft.activeTheme || ''; variant.value = draft.variant || 'light';
    iconPack.replaceChildren(new Option('跟随主题 / Lucide', ''), ...(draft.iconPackages || []).map(pack => new Option(pack.name, pack.id))); iconPack.value = draft.activeIcons || '';
    snippet.value = draft.snippet || ''; snippetEnabled.checked = Boolean(draft.snippetEnabled); renderGallery(); renderPicker();
    const activeBanner = runtime.bannerSpec(); bannerAsset = activeBanner?.assetId || null; const asset = bannerAsset && draft.assets?.[bannerAsset]; bannerPreview.hidden = !asset;
    bannerEnabled.checked = draft.bannerEnabled !== false;
    if (asset) { bannerPreview.src = asset.data; height.value = activeBanner.height || 150; focusX.value = activeBanner.x ?? 50; focusY.value = activeBanner.y ?? 50; includeExport.checked = Boolean(activeBanner.includeInExport); bannerPreview.style.height = height.value + 'px'; bannerPreview.style.objectPosition = `${focusX.value}% ${focusY.value}%`; }
  }
  const resetDraft = () => { runtime.cancelPreview(); draft = runtime.savedConfig(); render(); };
  document.querySelector('#settings-dialog').addEventListener('close', resetDraft);
  container.parentElement.addEventListener('toggle', () => { if (container.parentElement.open && !runtime.preview) { draft = runtime.savedConfig(); render(); } });
  render(); section.setAttribute('aria-busy', 'false');
  return { refresh() { const current = runtime.vaultKey(); if (current !== scopeId || (!runtime.preview && savedReference !== api.settings.appearance)) { scopeId = current; savedReference = api.settings.appearance; resetDraft(); } }, draft: () => draft, save, target, writeRule, run, button, section };
}