import postcss from '../app/node_modules/postcss/lib/postcss.mjs';
import valueParser from '../app/node_modules/postcss-value-parser/lib/index.js';

const colorKeys = ['base', 'secondary', 'ink', 'muted', 'accent', 'readerBg', 'readerInk', 'readerMuted', 'readerAccent'];
const semanticIcons = ['file', 'folder', 'tag', 'star', 'daily', 'graph', 'database', 'search'];
const text = (value, maximum, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Invalid ' + name);
  return value.trim();
};
const hex = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const bounded = (value, minimum, maximum, fallback) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function contrastRatio(first, second) {
  const luminance = color => {
    const values = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
}

export function validateAppearancePack(input) {
  if (!input || input.format !== 'inkloom.appearance' || input.version !== 1) throw new Error('Unsupported appearance package');
  const id = text(input.id, 64, 'package id'); if (!/^[a-z][a-z0-9.-]+$/.test(id)) throw new Error('Invalid package id');
  const result = { format: input.format, version: 1, id, name: text(input.name, 64, 'package name'), author: text(input.author, 120, 'author'), license: text(input.license, 240, 'license'), variants: {}, icons: {} };
  for (const mode of ['light', 'dark']) {
    const variant = input.variants?.[mode]; if (!variant || typeof variant !== 'object') throw new Error('Both light and dark variants are required');
    const tokens = {};
    for (const key of colorKeys) { if (!hex(variant[key])) throw new Error('Invalid color token: ' + key); tokens[key] = variant[key].toLowerCase(); }
    for (const [foreground, background] of [['ink', 'base'], ['ink', 'secondary'], ['muted', 'base'], ['readerInk', 'readerBg'], ['readerMuted', 'readerBg']]) {
      if (contrastRatio(tokens[foreground], tokens[background]) < 4.5) throw new Error('Insufficient contrast: ' + foreground + '/' + background);
    }
    result.variants[mode] = { ...tokens, radius: bounded(variant.radius, 0, 8, 4), controlSize: bounded(variant.controlSize, 28, 34, 28), iconSize: bounded(variant.iconSize, 14, 17, 15), readerFont: ['sans', 'book', 'kai'].includes(variant.readerFont) ? variant.readerFont : 'sans' };
  }
  for (const [role, value] of Object.entries(input.icons || {})) {
    if (!semanticIcons.includes(role) || typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error('Invalid semantic icon mapping');
    result.icons[role] = value;
  }
  result.css = validateReaderCss(input.css || '');
  return result;
}

export function importObsidianTheme(manifest, css, fallbackPack) {
  if (!manifest || typeof manifest !== 'object') throw new Error('请选择有效的 manifest.json');
  const name = text(manifest.name, 64, 'Obsidian theme name');
  if (typeof css !== 'string' || css.length > 1024 * 1024) throw new Error('theme.css 超过 1 MiB 或格式无效');
  const base = validateAppearancePack(fallbackPack);
  const rules = postcss.parse(css, { from: undefined });
  const variables = { light: new Map(), dark: new Map() }; let ignoredRules = 0;
  for (const rule of rules.nodes) {
    if (rule.type === 'comment') continue;
    if (rule.type !== 'rule') { ignoredRules++; continue; }
    const modes = new Set();
    for (const selector of rule.selectors) {
      const clean = selector.trim();
      if (['body', ':root'].includes(clean)) { modes.add('light'); modes.add('dark'); }
      else if (['.theme-light', 'body.theme-light'].includes(clean)) modes.add('light');
      else if (['.theme-dark', 'body.theme-dark'].includes(clean)) modes.add('dark');
    }
    if (!modes.size) { ignoredRules++; continue; }
    for (const declaration of rule.nodes) if (declaration.type === 'decl' && declaration.prop.startsWith('--')) {
      for (const mode of modes) variables[mode].set(declaration.prop, declaration.value);
    }
  }
  const mapping = {
    '--background-primary': ['base', 'readerBg'], '--background-secondary': ['secondary'],
    '--text-normal': ['ink', 'readerInk'], '--text-muted': ['muted', 'readerMuted'],
    '--interactive-accent': ['accent', 'readerAccent'], '--text-accent': ['accent', 'readerAccent'],
  };
  const resolveValue = (value, values, seen = new Set()) => {
    const parsed = valueParser(value).nodes.filter(part => part.type !== 'space');
    if (parsed.length !== 1 || parsed[0].type !== 'function' || parsed[0].value !== 'var') return value.trim();
    const parts = parsed[0].nodes; const key = parts[0]?.value;
    if (!key || seen.has(key) || seen.size > 24) return '';
    const comma = parts.findIndex(part => part.type === 'div' && part.value === ',');
    const next = values.get(key) || (comma >= 0 ? valueParser.stringify(parts.slice(comma + 1)) : '');
    return resolveValue(next, values, new Set([...seen, key]));
  };
  const normalizedColor = value => {
    if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[\da-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map(part => part + part).join('').toLowerCase();
    const parsed = valueParser(value).nodes;
    if (parsed.length !== 1 || parsed[0].type !== 'function' || !['rgb', 'hsl'].includes(parsed[0].value)) return null;
    const components = parsed[0].nodes.filter(part => part.type === 'word').map(part => part.value);
    if (components.length !== 3 || parsed[0].nodes.some(part => !['word', 'space', 'div'].includes(part.type))) return null;
    let colors;
    if (parsed[0].value === 'rgb') colors = components.map(component => component.endsWith('%') ? Number(component.slice(0, -1)) * 2.55 : Number(component));
    else {
      const hue = Number(components[0]) / 30; const saturation = Number(components[1].replace('%', '')) / 100; const lightness = Number(components[2].replace('%', '')) / 100;
      if (saturation < 0 || saturation > 1 || lightness < 0 || lightness > 1) return null;
      const amplitude = saturation * Math.min(lightness, 1 - lightness);
      colors = [0, 8, 4].map(shift => { const position = ((shift + hue) % 12 + 12) % 12; return 255 * (lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1))); });
    }
    if (colors.some(color => !Number.isFinite(color) || color < 0 || color > 255)) return null;
    return '#' + colors.map(color => Math.round(color).toString(16).padStart(2, '0')).join('');
  };
  const warnings = []; const mapped = [];
  const variants = structuredClone(base.variants);
  for (const mode of ['light', 'dark']) for (const [variable, targets] of Object.entries(mapping)) {
    if (!variables[mode].has(variable)) continue;
    const color = normalizedColor(resolveValue(variables[mode].get(variable), variables[mode]));
    if (!color) { warnings.push(mode + ': ' + variable); continue; }
    for (const target of targets) variants[mode][target] = color;
    mapped.push(mode + ': ' + variable);
  }
  if (!mapped.length) throw new Error('未找到可适配的 Obsidian 颜色变量，未导入主题。');
  const pack = validateAppearancePack({ ...base, id: 'obsidian-' + encodeURIComponent(name.toLowerCase()).replace(/[^a-z0-9]+/g, '-').slice(0, 54), name, author: String(manifest.author || 'Local import').slice(0, 120), license: 'User-supplied theme palette; consult the original theme license before redistribution.', variants, css: '', icons: {} });
  return { pack, mapped, warnings, ignoredRules, compatibility: 'color-variables-only' };
}

const allowedSelectors = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'a', 'strong', 'em', 'code', 'pre', 'table', 'th', 'td', 'hr', 'li', 'mark']);
const colorProperties = new Set(['color', 'background-color', 'border-color', 'text-decoration-color']);
const lengths = new Set(['font-size', 'line-height', 'border-width', 'border-radius', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom']);
const keywords = {
  'font-weight': new Set(['400', '500', '600', '700', 'normal', 'bold']),
  'font-style': new Set(['normal', 'italic']),
  'text-decoration': new Set(['none', 'underline', 'line-through']),
  'border-style': new Set(['none', 'solid', 'dashed', 'dotted']),
};

export function validateReaderCss(source) {
  if (typeof source !== 'string' || source.length > 16000) throw new Error('Reader CSS exceeds its limit');
  const root = postcss.parse(source, { from: undefined }); const output = postcss.root();
  if (root.nodes.length > 80) throw new Error('Too many reader rules');
  for (const node of root.nodes) {
    if (node.type === 'comment') continue;
    if (node.type !== 'rule') throw new Error('CSS at-rules are not allowed');
    const selectors = node.selectors;
    if (!selectors.length || selectors.some(selector => !allowedSelectors.has(selector.trim()))) throw new Error('Only approved reader element selectors are allowed');
    const rule = postcss.rule({ selector: selectors.map(selector => selector.trim()).join(', ') });
    for (const declaration of node.nodes) {
      if (declaration.type === 'comment') continue;
      if (declaration.type !== 'decl' || declaration.important) throw new Error('Nested rules and important declarations are not allowed');
      const property = declaration.prop.toLowerCase(); const value = declaration.value.trim(); const parsed = valueParser(value);
      if (parsed.nodes.some(part => !['word', 'space'].includes(part.type))) throw new Error('CSS functions and external resources are not allowed');
      let valid = false;
      if (colorProperties.has(property)) valid = hex(value) || (value === 'transparent' && property !== 'color') || value === 'currentColor';
      else if (lengths.has(property)) {
        const pieces = value.split(/\s+/); valid = pieces.length <= 4 && pieces.every(piece => {
          const unit = valueParser.unit(piece); if (!unit || !['px', 'em', 'rem', ''].includes(unit.unit)) return false;
          const number = Number(unit.number); if (!Number.isFinite(number) || number < 0) return false;
          if (property === 'font-size') return unit.unit === 'px' ? number >= 12 && number <= 48 : ['em', 'rem'].includes(unit.unit) && number >= .8 && number <= 3;
          if (property === 'line-height') return unit.unit === '' && number >= 1.2 && number <= 2.8;
          return number <= (['em', 'rem'].includes(unit.unit) ? 3 : 32) && (unit.unit !== '' || number === 0);
        });
      } else if (keywords[property]) valid = keywords[property].has(value);
      if (!valid) throw new Error('Unsafe reader declaration: ' + property);
      rule.append(postcss.decl({ prop: property, value }));
    }
    output.append(rule);
  }
  return output.toString();
}

export function scopeReaderCss(source) {
  const root = postcss.parse(validateReaderCss(source), { from: undefined });
  root.walkRules(rule => { rule.selectors = rule.selectors.map(selector => '#rich-editor .ProseMirror ' + selector); });
  return root.toString();
}

export function resolveAppearanceRule(rules, note) {
  if (!note) return null;
  const noteRule = rules?.notes?.[note.id]; if (noteRule) return noteRule;
  const path = String(note.relativePath || '').replaceAll('\\', '/');
  const folders = Object.entries(rules?.folders || {}).filter(([folder]) => folder === '' || path.startsWith(folder.replace(/\/$/, '') + '/')).sort(([left], [right]) => right.length - left.length);
  if (folders.length) return folders[0][1];
  const properties = rules?.properties || [];
  for (const rule of properties) if (rule && typeof rule.key === 'string' && String(note.metadata?.[rule.key] ?? '') === String(rule.value)) return rule;
  return null;
}

export function validateIconPack(input, sanitizeSvg) {
  if (!input || input.format !== 'inkloom.icons' || input.version !== 1 || typeof sanitizeSvg !== 'function') throw new Error('Unsupported icon package');
  const id = text(input.id, 64, 'icon package id'); if (!/^[a-z][a-z0-9.-]+$/.test(id)) throw new Error('Invalid icon package id');
  const result = { format: input.format, version: 1, id, name: text(input.name, 64, 'icon package name'), author: text(input.author, 120, 'author'), license: text(input.license, 240, 'license'), assets: {}, mapping: {}, colorMode: input.colorMode === 'original' ? 'original' : 'inherit' };
  const assets = Object.entries(input.assets || {}); if (assets.length > 100) throw new Error('Icon package exceeds 100 assets');
  for (const [name, svg] of assets) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || typeof svg !== 'string' || svg.length > 24000) throw new Error('Invalid SVG asset');
    result.assets[name] = sanitizeSvg(svg, result.colorMode);
  }
  for (const [role, icon] of Object.entries(input.mapping || {})) {
    if (!semanticIcons.includes(role) || typeof icon !== 'string' || !/^(custom:)?[a-z][a-z0-9-]{0,63}$/.test(icon)) throw new Error('Invalid icon mapping');
    if (icon.startsWith('custom:') && !Object.hasOwn(result.assets, icon.slice(7))) throw new Error('Custom icon asset is missing');
    result.mapping[role] = icon;
  }
  return result;
}