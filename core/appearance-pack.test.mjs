import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppearancePack, validateReaderCss, scopeReaderCss, resolveAppearanceRule, validateIconPack, importObsidianTheme } from './appearance-pack.mjs';
import { appearancePresets } from './appearance-presets.mjs';
import { readFileSync } from 'node:fs';

const variant = { base: '#ffffff', secondary: '#f3f4f4', ink: '#20242a', muted: '#565b63', accent: '#216d65', readerBg: '#ffffff', readerInk: '#20242a', readerMuted: '#565b63', readerAccent: '#216d65' };
const pack = () => ({ format: 'inkloom.appearance', version: 1, id: 'test-pack', name: 'Test', author: 'Example', license: 'MIT', variants: { light: variant, dark: { ...variant, base: '#181a1d', secondary: '#24272b', ink: '#f3f4f5', muted: '#bcc0c7', readerBg: '#181a1d', readerInk: '#f3f4f5', readerMuted: '#bcc0c7' } } });

test('appearance packages validate identity, both palettes and readable bounded tokens', () => {
  const input = pack(); input.variants.light = { ...variant, radius: 200, iconSize: 99 };
  const checked = validateAppearancePack(input); assert.equal(checked.variants.light.radius, 8); assert.equal(checked.variants.light.iconSize, 17);
  const invalid = pack(); invalid.variants.light = { ...variant, ink: '#ffffff' }; assert.throws(() => validateAppearancePack(invalid), /contrast/);
  assert.throws(() => validateAppearancePack({ ...pack(), icons: { settings: 'file' } }), /icon/);
  assert.throws(() => validateAppearancePack({ ...pack(), version: 2 }), /Unsupported/);
});

test('reader snippets are parsed, restricted and cannot address protected UI or load resources', () => {
  const valid = 'h1, h2 { color: #174a46; margin-bottom: 1em } blockquote { border-style: solid; border-width: 2px; padding: 12px; }';
  assert.match(scopeReaderCss(valid), /#rich-editor \.ProseMirror h1/);
  for (const source of ['@import "https://example.com/x.css";', '#settings-dialog { color: #ffffff }', 'p { position: fixed }', 'p { background-color: url(https://example.com/a) }', 'p { color: var(--secret) }', 'p { opacity: 0 }', 'p { font-size: 0px }', 'p { margin-top: -99px }', 'p { color: #ffffff !important }', 'p { & span { color: #ffffff } }']) assert.throws(() => validateReaderCss(source));
});

test('appearance rules prefer stable note identities, then longest folder, then property', () => {
  const rules = { notes: { note: { icon: 'star' } }, folders: { projects: { icon: 'folder' }, 'projects/client': { icon: 'briefcase' } }, properties: [{ key: 'status', value: 'Done', icon: 'check' }] };
  assert.equal(resolveAppearanceRule(rules, { id: 'note', relativePath: 'projects/client/a.md' }).icon, 'star');
  assert.equal(resolveAppearanceRule(rules, { id: 'other', relativePath: 'projects/client/a.md' }).icon, 'briefcase');
  assert.equal(resolveAppearanceRule(rules, { id: 'other', relativePath: 'journal/a.md', metadata: { status: 'Done' } }).icon, 'check');
});

test('three distinct bundled themes pass the same import checks and round-trip', () => {
  assert.equal(appearancePresets.length, 3);
  assert.equal(new Set(appearancePresets.map(item => item.variants.light.accent)).size, 3);
  for (const item of appearancePresets) assert.deepEqual(validateAppearancePack(JSON.parse(JSON.stringify(item))), item);
  assert.throws(() => validateReaderCss('p { color: transparent }'));
});

test('appearance parsers are explicitly pinned production dependencies', () => {
  const metadata = JSON.parse(readFileSync(new URL('../app/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../app/package-lock.json', import.meta.url), 'utf8'));
  for (const name of ['postcss', 'postcss-value-parser']) assert.equal(metadata.dependencies[name], lock.packages['node_modules/' + name].version);
  for (const name of ['postcss', 'postcss-value-parser', 'nanoid', 'picocolors', 'source-map-js']) assert.notEqual(lock.packages['node_modules/' + name].dev, true);
});

test('icon package metadata and semantic references are bounded before SVG processing', () => {
  const input = { format: 'inkloom.icons', version: 1, id: 'sample-icons', name: 'Sample', author: 'Example', license: 'MIT', assets: { note: '<svg/>' }, mapping: { file: 'custom:note' } };
  let checked = 0; const result = validateIconPack(input, source => { checked++; return source; }); assert.equal(checked, 1); assert.equal(result.mapping.file, 'custom:note');
  assert.throws(() => validateIconPack({ ...input, mapping: { file: 'custom:missing' } }, value => value), /missing/);
  assert.throws(() => validateIconPack({ ...input, mapping: { save: 'file' } }, value => value), /mapping/);
  assert.throws(() => validateIconPack({ ...input, assets: { note: 'x'.repeat(25000) } }, value => value), /asset/);
});

test('Obsidian import maps palettes but never installs layout CSS or external resources', () => {
  const css = ':root { --ink: #25313b; } .theme-light { --background-primary: #fff; --text-normal: var(--ink); --interactive-accent: rgb(40, 100, 90); } .theme-dark { --background-primary: #181a1d; --text-normal: #f3f4f5; } #settings-dialog { display:none } @import "https://example.com/theme.css";';
  const result = importObsidianTheme({ name: 'Palette', author: 'Fixture' }, css, pack());
  assert.equal(result.pack.variants.light.ink, '#25313b');
  assert.equal(result.pack.variants.light.accent, '#28645a');
  assert.equal(result.pack.css, '');
  assert.equal(result.ignoredRules, 2);
  assert.equal(result.compatibility, 'color-variables-only');
  assert.throws(() => importObsidianTheme({ name: 'Unsafe' }, 'body { --text-normal: url(https://example.com/x); }', pack()), /未找到/);
  assert.throws(() => importObsidianTheme({ name: 'LowContrast' }, 'body { --text-normal: #fff; }', pack()), /contrast/);
});