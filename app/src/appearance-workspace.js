import { appearancePresets } from '../../core/appearance-presets.mjs';
import { validateAppearancePack, validateIconPack, scopeReaderCss, resolveAppearanceRule } from '../../core/appearance-pack.mjs';
import { makeAppearanceIcon, sanitizeIconSvg } from './appearance-icons.js';

export const defaultAppearance = () => ({ version: 1, activeTheme: null, variant: 'light', packages: [], activeIcons: null, iconPackages: [], snippet: '', snippetEnabled: false, rules: {}, assets: {}, bannerDefaults: {}, bannerEnabled: true });
const tokenNames = ['--ui-base', '--ui-secondary', '--ui-ink', '--ui-muted', '--ui-accent', '--shell-surface', '--shell-raised', '--shell-line', '--shell-hover', '--tree-guide', '--shell-radius', '--shell-control-size', '--shell-icon-size', '--reader-bg', '--source-bg', '--reading-font', '--glass-surface', '--glass-control'];
const fonts = { sans: "'Manrope', 'Microsoft YaHei', sans-serif", book: "'Literata', 'Noto Serif SC', 'SimSun', serif", kai: "'LXGW WenKai', 'KaiTi', 'SimSun', serif" };

export class WorkspaceAppearance {
  constructor(api) {
    this.api = api; this.preview = null; this.problem = ''; this.compiledCss = ''; this.iconSignature = '';
    this.packCache = new WeakMap(); this.iconCache = new WeakMap(); this.cssSource = null;
    this.style = document.createElement('style'); this.style.id = 'inkloom-reader-customizations'; document.head.append(this.style);
    this.banner = document.createElement('section'); this.banner.id = 'note-banner'; this.banner.hidden = true;
    this.image = document.createElement('img'); this.image.alt = ''; this.banner.append(this.image);
    document.querySelector('#note-context-bar').after(this.banner);
    this.image.addEventListener('error', () => { this.banner.hidden = true; this.problem = '本地Banner图片无法读取'; });
  }

  config() {
    const saved = this.preview || this.api.settings().appearance;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultAppearance();
    return { ...defaultAppearance(), ...saved, packages: Array.isArray(saved.packages) ? saved.packages.slice(0, 12) : [], iconPackages: Array.isArray(saved.iconPackages) ? saved.iconPackages.slice(0, 6) : [] };
  }
  savedConfig() { const preview = this.preview; this.preview = null; const result = structuredClone(this.config()); this.preview = preview; return result; }
  packages() { return [...appearancePresets, ...(this.config().packages || [])]; }
  activePack() {
    const config = this.config(); const input = this.packages().find(item => item.id === config.activeTheme);
    if (!input) return null;
    try { if (!this.packCache.has(input)) this.packCache.set(input, validateAppearancePack(input)); return this.packCache.get(input); } catch (error) { this.problem = error.message; return null; }
  }
  mode() { return this.activePack() ? (this.config().variant === 'dark' ? 'dark' : 'light') : document.documentElement.dataset.uiMode; }
  vaultKey() { return this.api.vault().vaultId || this.api.vault().vaultPath; }
  rule(note, kind) {
    const source = this.config().rules?.[this.vaultKey()] || {};
    const rules = { notes: Object.fromEntries(Object.entries(source.notes || {}).filter(([, rule]) => rule?.[kind] !== undefined)), folders: Object.fromEntries(Object.entries(source.folders || {}).filter(([, rule]) => rule?.[kind] !== undefined)), properties: (Array.isArray(source.properties) ? source.properties : []).filter(rule => rule?.[kind] !== undefined) };
    return resolveAppearanceRule(rules, note)?.[kind];
  }
  selectedIconPack() {
    const config = this.config(); const input = (config.iconPackages || []).find(item => item.id === config.activeIcons);
    if (!input) return null;
    try { if (!this.iconCache.has(input)) this.iconCache.set(input, validateIconPack(input, sanitizeIconSvg)); return this.iconCache.get(input); } catch (error) { this.problem = error.message; return null; }
  }

  apply() {
    this.problem = ''; const app = document.querySelector('#app'); const pack = this.activePack(); const mode = this.mode(); const config = this.config();
    const hostStyle = getComputedStyle(document.documentElement);
    const hostMode = document.documentElement.dataset.uiMode || 'light';
    for (const protectedElement of document.querySelectorAll('#app dialog, #vault-change-notice, #toast')) {
      protectedElement.dataset.uiMode = hostMode;
      for (const token of ['base', 'secondary', 'ink', 'muted', 'accent']) protectedElement.style.setProperty('--ui-' + token, hostStyle.getPropertyValue('--ui-' + token));
      protectedElement.style.setProperty('--shell-radius', '6px'); protectedElement.style.setProperty('--shell-control-size', '28px'); protectedElement.style.setProperty('--shell-icon-size', '14px');
    }
    document.documentElement.dataset.appearancePreview = String(Boolean(this.preview));
    for (const name of tokenNames) app.style.removeProperty(name);
    app.dataset.appearancePack = pack?.id || ''; app.dataset.workspaceMode = mode;
    if (pack) {
      const tokens = pack.variants[mode];
      for (const name of ['base', 'secondary', 'ink', 'muted', 'accent']) app.style.setProperty('--ui-' + name, tokens[name]);
      app.style.setProperty('--tree-guide', `color-mix(in srgb, ${tokens.ink} 18%, ${tokens.base})`);
      app.style.setProperty('--shell-radius', tokens.radius + 'px'); app.style.setProperty('--shell-control-size', tokens.controlSize + 'px'); app.style.setProperty('--shell-icon-size', tokens.iconSize + 'px');
      app.style.setProperty('--reader-bg', tokens.readerBg); app.style.setProperty('--source-bg', tokens.readerBg); app.style.setProperty('--reading-font', fonts[tokens.readerFont]);
      for (const pane of document.querySelectorAll('.source-pane,.rich-pane')) {
        pane.dataset.paperMode = mode;
        for (const [key, value] of Object.entries({ bg: tokens.readerBg, ink: tokens.readerInk, muted: tokens.readerMuted, accent: tokens.readerAccent })) pane.style.setProperty('--pane-' + key, value);
      }
    }
    try {
      const source = [pack?.css || '', config.snippetEnabled ? config.snippet || '' : ''].join('\n');
      if (source !== this.cssSource) { this.compiledCss = scopeReaderCss(source); this.style.textContent = this.compiledCss; this.cssSource = source; }
    } catch (error) { this.problem = error.message; this.style.textContent = ''; this.compiledCss = ''; this.cssSource = null; }
    this.applyIcons(); this.applyBanner();
  }

  applyIcons() {
    const config = this.config(); const pack = this.activePack(); const iconPack = this.selectedIconPack();
    const mapping = { ...(pack?.icons || {}), ...(iconPack?.mapping || {}) };
    const enabled = Boolean(pack || iconPack || config.rules?.[this.vaultKey()]);
    const invalidate = this.lastIconPack !== iconPack; this.lastIconPack = iconPack;
    for (const button of document.querySelectorAll('[data-vault-note-id]')) {
      const note = this.api.vault().notes.find(note => note.id === button.dataset.vaultNoteId); if (!note) continue;
      const parsed = this.api.noteById?.(note.id) || note; const rule = this.rule(parsed, 'icon');
      const name = typeof rule === 'string' ? rule : rule?.name || mapping.file || 'file-text';
      let slot = button.querySelector('.appearance-note-icon');
      if (!enabled) { slot?.remove(); continue; }
      if (!slot) { slot = document.createElement('span'); slot.className = 'appearance-note-icon'; button.prepend(slot); }
      const signature = name + ':' + (iconPack?.id || '') + ':' + (rule?.color || '');
      if (invalidate || slot.dataset.iconKey !== signature) { slot.replaceChildren(makeAppearanceIcon(name, iconPack)); slot.dataset.iconKey = signature; }
      slot.style.color = /^#[\da-f]{6}$/i.test(rule?.color || '') ? rule.color : '';
    }
    for (const heading of document.querySelectorAll('[data-appearance-folder]')) {
      const folder = heading.dataset.appearanceFolder; const rule = this.rule({ relativePath: folder ? folder + '/_' : '_' }, 'icon');
      let slot = heading.querySelector('.appearance-note-icon');
      if (!enabled) { slot?.remove(); continue; }
      if (!slot) { slot = document.createElement('span'); slot.className = 'appearance-note-icon'; heading.prepend(slot); }
      slot.replaceChildren(makeAppearanceIcon(rule?.name || mapping.folder || 'folder-tree', iconPack, 'folder-tree'));
    }
    const roles = { vault: 'folder', tags: 'tag', starred: 'star', daily: 'daily', graph: 'graph', database: 'database', search: 'search' };
    for (const button of document.querySelectorAll('#activity-rail button[data-activity-id]')) {
      const id = button.dataset.activityId || ''; const role = Object.entries(roles).find(([name]) => id.includes(name))?.[1];
      if (!role) continue;
      const original = button.dataset.originalAppearanceIcon;
      const current = button.querySelector('svg'); if (!current) continue;
      if (!original) button.dataset.originalAppearanceIcon = current.outerHTML;
      if (enabled && mapping[role]) current.replaceWith(makeAppearanceIcon(mapping[role], iconPack, role === 'folder' ? 'folder-tree' : 'file-text'));
      else if (original) { const template = document.createElement('template'); template.innerHTML = original; current.replaceWith(template.content.firstElementChild); }
    }
  }

  bannerSpec() {
    const note = this.api.activeNote(); const config = this.config(); const specified = this.rule(note, 'banner');
    if (config.bannerEnabled === false) return null;
    return specified === undefined ? config.bannerDefaults?.[this.vaultKey()] : specified;
  }
  applyBanner() {
    const value = this.bannerSpec(); const asset = value && this.config().assets?.[value.assetId];
    const valid = typeof asset?.data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(asset.data);
    this.banner.hidden = !valid || !this.api.activeNote();
    if (this.banner.hidden) { this.image.removeAttribute('src'); return; }
    if (this.image.getAttribute('src') !== asset.data) this.image.src = asset.data;
    this.banner.style.height = Math.max(80, Math.min(300, Number(value.height) || 150)) + 'px';
    const position = coordinate => Number.isFinite(Number(coordinate)) ? Math.max(0, Math.min(100, Number(coordinate))) : 50;
    this.image.style.objectPosition = `${position(value.x)}% ${position(value.y)}%`;
  }
  exportSource(source) {
    const banner = this.bannerSpec(); const data = banner?.includeInExport && this.config().assets?.[banner.assetId]?.data;
    return data && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data) ? `![Banner](${data})\n\n${source}` : source;
  }
  previewConfig(config) { this.preview = structuredClone(config); this.api.refresh(); }
  cancelPreview() { if (this.preview) { this.preview = null; this.api.refresh(); } }
  async commit(config) {
    const next = structuredClone(config);
    if (!Array.isArray(next.packages) || next.packages.length > 12 || !Array.isArray(next.iconPackages) || next.iconPackages.length > 6) throw new Error('外观包数量超出限制');
    next.packages = next.packages.map(validateAppearancePack); next.iconPackages = next.iconPackages.map(pack => validateIconPack(pack, sanitizeIconSvg));
    scopeReaderCss(next.snippet || '');
    const used = new Set();
    for (const banner of Object.values(next.bannerDefaults || {})) if (banner?.assetId) used.add(banner.assetId);
    for (const rules of Object.values(next.rules || {})) for (const rule of [...Object.values(rules?.notes || {}), ...Object.values(rules?.folders || {})]) if (rule?.banner?.assetId) used.add(rule.banner.assetId);
    next.assets = Object.fromEntries(Object.entries(next.assets || {}).filter(([id]) => used.has(id)));
    if (JSON.stringify(next).length > 4 * 1024 * 1024) throw new Error('外观配置超过4 MiB，请移除不使用的图片或图标资源');
    this.preview = null;
    try { await this.api.save(next); } finally { this.api.refresh(); }
  }
}