import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginHost, validateManifest } from './plugin-host.mjs';

const manifest = (id = 'sample-plugin', patch = {}) => ({ id, name: id, version: '1.0.0', minHost: '0.3.0', entry: 'main.js', activation: ['manual'], dependencies: [], capabilities: ['metadata.read', 'views', 'commands', 'settings'], ...patch });

test('workspace API preserves write gates, data budgets and trusted notification ownership', async () => {
  let api; let created; let settings;
  const host = new PluginHost({ createNote: async (title, options) => { created = { title, options }; return { id: 'created' }; }, queryWorkspace: async () => ({ total: 2 }), setSetting: async (_plugin, _key, value) => { settings = value; } });
  host.register(manifest('workspace-test', { capabilities: ['metadata.read', 'vault.write', 'settings'] }), value => { api = value; value.registerSetting({ id: 'layout', name: 'Layout', type: 'data', default: {} }); }, { trusted: true }); await host.enable('workspace-test');
  assert.equal(api.version, '1.7.0'); assert.equal((await api.queryWorkspace({})).total, 2);
  await api.createNote('Capture', { source: '# Capture', folder: 'memos', background: true }); assert.equal(created.options.background, true);
  await assert.rejects(() => api.createNote('Capture', { folder: '../outside' }), /options/); await assert.rejects(() => api.createNote('Capture', { source: 'x'.repeat(8 * 1024 * 1024 + 1) }), /options/);
  await api.setSetting('layout', { vault: [{ id: 'capture', x: 0 }] }); assert.equal(settings.vault[0].x, 0); await assert.rejects(() => api.setSetting('layout', 'x'.repeat(131073)), /budget/);
  host.dispose(); await assert.rejects(() => api.queryWorkspace({}), /disabled/);
  const external = new PluginHost(); external.register(manifest('external-data'), value => value.registerSetting({ id: 'layout', name: 'Layout', type: 'data' }));
  await assert.rejects(() => external.enable('external-data', ['settings']), /Unsupported/); assert.equal(external.plugins.get('external-data').resources.size, 0); external.dispose();
});

test('manifest gates identity, version, entry, unknown capabilities and dependency cycles', () => {
  for (const patch of [{ id: '../bad' }, { minHost: '99.0.0' }, { entry: '../main.js' }, { capabilities: ['filesystem'] }, { version: 'beta' }]) assert.throws(() => validateManifest(manifest('sample-plugin', patch)));
  const host = new PluginHost(); host.register(manifest('first-plugin', { dependencies: ['second-plugin'] }), () => {});
  assert.throws(() => host.register(manifest('second-plugin', { dependencies: ['first-plugin'] }), () => {}), /cycle/);
  assert.throws(() => host.register(manifest('first-plugin'), () => {}), /Duplicate/);
});

test('disabling reclaims views, commands, listeners, settings, timers, workers and retained APIs', async () => {
  const host = new PluginHost({ query: () => [{ id: 'note' }] }); let retained; let terminated = 0; let disposed = 0;
  host.register(manifest(), api => {
    retained = api;
    api.registerView({ id: 'list-view', name: 'List' }); api.registerCommand({ id: 'test-command', name: 'Test', run: () => true });
    api.registerSetting({ id: 'compact-mode', name: 'Compact', type: 'boolean' });
    api.on('vault.changed', () => {}); api.interval(() => {}, 1000);
    api.ownWorker({ terminate() { terminated++; } }); api.own(() => { disposed++; });
  }, { trusted: true });
  await host.enable('sample-plugin'); assert.equal(host.diagnostics().listeners, 1);
  host.disable('sample-plugin'); host.disable('sample-plugin');
  assert.equal(terminated, 1); assert.equal(disposed, 1);
  assert.deepEqual([host.commands.size, host.views.size, host.settings.size, host.diagnostics().listeners, host.plugins.get('sample-plugin').resources.size], [0, 0, 0, 0, 0]);
  assert.throws(() => retained.query(), /disabled/);
  await host.enable('sample-plugin'); assert.equal(host.views.size, 1); host.dispose();
});

test('permission enforcement happens in host APIs and failures unload contributions', async () => {
  let retained; const host = new PluginHost({ read: () => ({ source: 'private' }), write: () => assert.fail('unauthorized write'), query: () => [] });
  host.register(manifest('external-plugin', { capabilities: ['metadata.read', 'vault.read', 'views', 'commands'] }), api => { retained = api; api.registerView({ id: 'list-view', name: 'View' }); });
  await host.enable('external-plugin', ['metadata.read', 'views']);
  await assert.rejects(() => retained.read('note'), /Permission denied/); await assert.rejects(() => retained.write('note', 'v1', 'changed'), /Permission denied/);
  await assert.rejects(() => retained.request('https://example.com'), /Permission denied/); await assert.rejects(() => retained.execute('command'), /Permission denied/);
  const broken = manifest('broken-plugin'); host.register(broken, api => { api.registerView({ id: 'list-view', name: 'View' }); throw new Error('activation failed'); }, { trusted: true });
  await assert.rejects(() => host.enable('broken-plugin'), /activation failed/);
  assert.equal(host.plugins.get('broken-plugin').state, 'failed'); assert.equal(host.plugins.get('broken-plugin').resources.size, 0);
  host.dispose();
});

test('a stale asynchronous activation cannot resurrect a disabled plugin', async () => {
  const host = new PluginHost(); let finish; let cleanup = 0;
  host.register(manifest(), () => new Promise(resolve => { finish = resolve; }));
  const loading = host.enable('sample-plugin'); host.disable('sample-plugin'); finish(() => { cleanup++; }); await loading;
  assert.equal(cleanup, 1); assert.equal(host.plugins.get('sample-plugin').state, 'disabled');
});

test('command failure disables plugin, setting validation rejects invalid values, safe mode preserves essential host', async () => {
  const changes = []; const host = new PluginHost({ setSetting: (...args) => changes.push(args) });
  host.register(manifest('core-plugin'), () => {}, { trusted: true, essential: true });
  host.register(manifest(), api => { api.registerSetting({ id: 'row-limit', name: 'Rows', type: 'number', min: 1, max: 100 }); api.registerCommand({ id: 'fail-command', name: 'Fail', run: () => { throw new Error('command failure'); } }); }, { trusted: true });
  await host.enable('core-plugin'); await host.enable('sample-plugin');
  await assert.rejects(() => host.setSetting('sample-plugin:row-limit', 200), /out of range/);
  await host.setSetting('sample-plugin:row-limit', 30); assert.equal(changes.length, 1);
  await assert.rejects(() => host.command('sample-plugin:fail-command'), /command failure/); assert.equal(host.commands.size, 0);
  host.safeMode(); assert.equal(host.plugins.get('core-plugin').state, 'enabled'); host.dispose();
});

test('external declarations share settings and events without gaining write or network permissions', async () => {
  const values = {}; const changes = []; let api;
  const host = new PluginHost({ getSettings: id => values[id], setSetting: (id, key, value) => { values[id] = { ...values[id], [key]: value }; } });
  host.register(manifest('external-settings'), context => {
    api = context;
    context.registerSetting({ id: 'row-limit', name: 'Rows', type: 'number', min: 1, max: 50, default: 20 });
    context.on('settings.changed', event => changes.push(event.pluginId));
  });
  await host.enable('external-settings', ['metadata.read', 'settings']);
  await api.setSetting('row-limit', 12); assert.equal(api.getSetting('row-limit'), 12); assert.deepEqual(changes, ['external-settings']);
  assert.throws(() => api.getSetting('__proto__'), /not registered/);
  await assert.rejects(() => api.setSetting('row-limit', 51), /range/);
  await assert.rejects(() => api.write('id', 'version', 'source'), /Permission/);
  host.disable('external-settings'); assert.equal(host.diagnostics().listeners, 0); assert.equal(host.settings.size, 0);
});

test('failure from an old activation or callback cannot disable a newly enabled generation', async () => {
  const host = new PluginHost(); let rejectFirst; let rejectCommand; let activation = 0;
  host.register(manifest(), api => {
    if (++activation === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
    api.registerCommand({ id: 'slow-command', name: 'Slow', run: () => new Promise((resolve, reject) => { rejectCommand = reject; }) });
  }, { trusted: true });
  const first = host.enable('sample-plugin'); host.disable('sample-plugin'); await host.enable('sample-plugin');
  rejectFirst(new Error('old activation')); await assert.rejects(() => first, /old activation/);
  assert.equal(host.plugins.get('sample-plugin').state, 'enabled');
  const command = host.command('sample-plugin:slow-command'); host.disable('sample-plugin'); await host.enable('sample-plugin');
  rejectCommand(new Error('old command')); await assert.rejects(() => command, /old command/);
  assert.equal(host.plugins.get('sample-plugin').state, 'enabled'); assert.equal(host.commands.size, 1); host.dispose();
});

test('mounted built-in views release DOM, events and resources when closed or disabled', async () => {
  const host = new PluginHost(); let released = 0; let cleared = 0; let signal;
  const container = { replaceChildren() { cleared++; } };
  host.register(manifest(), api => api.registerView({ id: 'table-view', name: 'Table', mount(root, scope) {
    assert.equal(root, container); signal = scope.signal;
    scope.own(api.on('vault.changed', () => {})); scope.own(() => { released++; });
    return () => { released++; };
  } }), { trusted: true });
  await host.enable('sample-plugin'); host.mountView('sample-plugin:table-view', container); host.mountView('sample-plugin:table-view', container);
  assert.equal(host.diagnostics().mountedViews, 1); assert.equal(host.diagnostics().listeners, 1);
  host.unmountView('sample-plugin:table-view'); assert.equal(released, 2); assert.equal(cleared, 1); assert.equal(signal.aborted, true); assert.equal(host.diagnostics().listeners, 0);
  host.mountView('sample-plugin:table-view', container); host.disable('sample-plugin');
  assert.equal(released, 4); assert.equal(cleared, 2); assert.equal(host.diagnostics().mountedViews, 0); assert.equal(host.plugins.get('sample-plugin').resources.size, 0);
});

test('external plugins cannot mount host DOM and partial mount failure is cleaned', async () => {
  const host = new PluginHost();
  host.register(manifest('external-dom'), api => api.registerView({ id: 'view-main', name: 'Bad', mount() {} }));
  await assert.rejects(() => host.enable('external-dom', ['views']), /trusted/);
  let released = 0; let cleared = 0;
  host.register(manifest('broken-view'), api => api.registerView({ id: 'view-main', name: 'Broken', mount(root, scope) { scope.own(() => { released++; }); throw new Error('mount failed'); } }), { trusted: true });
  await host.enable('broken-view');
  assert.throws(() => host.mountView('broken-view:view-main', { replaceChildren() { cleared++; } }), /mount failed/);
  assert.equal(released, 1); assert.equal(cleared, 1); assert.equal(host.diagnostics().mountedViews, 0); assert.equal(host.views.size, 0);
});

test('database property commands require write permission and a content version', async () => {
  const calls = []; let writer; let reader;
  const host = new PluginHost({ updateProperties: (...args) => { calls.push(args); return { saved: true }; }, queryDatabase: () => ({ rows: [], total: 0 }) });
  host.register(manifest('database-writer', { capabilities: ['metadata.read', 'vault.write'] }), api => { writer = api; }, { trusted: true });
  host.register(manifest('database-reader', { capabilities: ['metadata.read'] }), api => { reader = api; });
  await host.enable('database-writer'); await host.enable('database-reader', ['metadata.read']);
  await assert.rejects(() => reader.updateProperties('note', 'a'.repeat(64), { status: 'Done' }), /Permission/);
  await assert.rejects(() => writer.updateProperties('note', '', { status: 'Done' }), /version/);
  assert.deepEqual(await reader.queryDatabase({}), { rows: [], total: 0 });
  await writer.updateProperties('note', 'a'.repeat(64), { status: 'Done' }); assert.equal(calls.length, 1); host.dispose();
});

test('graph metadata and note creation have separate permissions and context mounts are trusted only', async () => {
  let reader; const created = [];
  const host = new PluginHost({ queryGraph: () => ({ nodes: [{ id: 'note' }], edges: [] }), createNote: title => created.push(title) });
  host.register(manifest('graph-reader', { capabilities: ['metadata.read', 'views'] }), api => { reader = api; });
  await host.enable('graph-reader', ['metadata.read', 'views']);
  assert.equal((await reader.queryGraph({})).nodes.length, 1);
  await assert.rejects(() => reader.createNote('Future'), /Permission/);
  assert.throws(() => reader.registerView({ id: 'local-view', name: 'Local', location: 'context' }), /trusted/);
  assert.equal(created.length, 0); host.dispose();
});

test('asynchronous reads inherit plugin and view cancellation without returning after disable', async () => {
  let api; let signal; let finish;
  const host = new PluginHost({ queryAsync: (options, runtime) => { signal = runtime.signal; return new Promise(resolve => { finish = resolve; }); } });
  host.register(manifest(), context => { api = context; }, { trusted: true }); await host.enable('sample-plugin');
  const first = api.queryAsync({}); host.disable('sample-plugin'); assert.equal(signal.aborted, true); finish([]); await assert.rejects(first, /disabled/);
  await host.enable('sample-plugin'); const view = new AbortController(); const second = api.queryAsync({}, { signal: view.signal }); view.abort(); assert.equal(signal.aborted, true); finish([]); await assert.rejects(second, { name: 'AbortError' });
  assert.equal(host.plugins.get('sample-plugin').state, 'enabled'); host.dispose();
});

test('versioned writes reject invalid contracts and preserve already submitted saves on disable', async () => {
  let api; let complete; const calls = [];
  const host = new PluginHost({ write: (...args) => { calls.push(args); return new Promise(resolve => { complete = resolve; }); } });
  host.register(manifest('writer-plugin', { capabilities: ['vault.write'] }), context => { api = context; }, { trusted: true }); await host.enable('writer-plugin');
  await assert.rejects(() => api.write('', 'a'.repeat(64), 'text'), /identity/);
  await assert.rejects(() => api.write('note', 'stale', 'text'), /version/); assert.equal(calls.length, 0);
  const saved = api.write('note', 'a'.repeat(64), 'new'); host.disable('writer-plugin'); complete({ saved: true });
  assert.equal((await saved).saved, true); assert.equal(calls.length, 1); await assert.rejects(() => api.write('note', 'a'.repeat(64), 'again'), /disabled/);
});

test('activation timeout releases contributions and cleans a late activation result once', async () => {
  const host = new PluginHost({ activationBudgetMs: 10 }); let finish; let cleaned = 0;
  host.register(manifest(), api => { api.registerView({ id: 'pending-view', name: 'Pending' }); return new Promise(resolve => { finish = resolve; }); }, { trusted: true });
  await assert.rejects(() => host.enable('sample-plugin'), /time budget/);
  assert.equal(host.plugins.get('sample-plugin').state, 'failed'); assert.equal(host.views.size, 0); assert.equal(host.plugins.get('sample-plugin').resources.size, 0);
  finish(() => { cleaned++; }); await Promise.resolve(); await Promise.resolve(); assert.equal(cleaned, 1); host.dispose();
});

test('declared setting defaults are available before explicit user overrides', async () => {
  let api; const host = new PluginHost({ getSettings: () => ({}) });
  host.register(manifest(), context => { api = context; api.registerSetting({ id: 'fraction-value', name: 'Fraction', type: 'number', min: .6, max: 1.8, default: 1 }); api.registerSetting({ id: 'default-enabled', name: 'Enabled', type: 'boolean', default: true }); }, { trusted: true });
  await host.enable('sample-plugin'); assert.equal(api.getSetting('fraction-value'), 1); assert.equal(api.getSetting('default-enabled'), true); host.dispose();
});

test('link navigation is trusted, protocol bounded and revoked on disable', async () => {
  let trusted; let external; const opened = []; const host = new PluginHost({ openLink: link => opened.push(link) });
  host.register(manifest('link-trusted'), api => { trusted = api; }, { trusted: true }); host.register(manifest('link-external'), api => { external = api; });
  await host.enable('link-trusted'); await host.enable('link-external', ['metadata.read']);
  await trusted.openLink('[[Research/Source#^proof|Evidence]]'); await trusted.openLink('https://example.org/'); assert.equal(opened.length, 2);
  for (const link of ['javascript:alert(1)', 'file:///C:/private', 'https://user:secret@example.org/', '[[broken\nlink]]']) await assert.rejects(() => trusted.openLink(link));
  await assert.rejects(() => external.openLink('https://example.org/'), /trusted/); host.disable('link-trusted'); await assert.rejects(() => trusted.openLink('[[Source]]'), /disabled/); host.dispose();
});

test('active document editing is trusted, versioned and revoked on disable', async () => {
  let api; let updates = 0; const document = { id: 'note', source: 'source', revision: 2, dirty: false };
  const host = new PluginHost({ activeDocument: () => document, updateActiveDocument: (id, revision, source) => { assert.equal(id, document.id); assert.equal(revision, document.revision); document.source = source; document.revision++; updates++; return { revision: document.revision }; }, saveActiveDocument: async () => ({ saved: true }) });
  host.register(manifest('draft-test', { capabilities: ['vault.read', 'vault.write'] }), value => { api = value; }, { trusted: true }); await host.enable('draft-test');
  const snapshot = api.activeDocument(); snapshot.source = 'cannot change host'; assert.equal(document.source, 'source');
  assert.equal(api.updateActiveDocument('note', 2, 'drawing').revision, 3); assert.equal(updates, 1);
  assert.throws(() => api.updateActiveDocument('note', -1, 'bad'), /Invalid/); assert.equal((await api.saveActiveDocument('note')).saved, true);
  host.disable('draft-test'); assert.throws(() => api.updateActiveDocument('note', 3, 'late'), /disabled/); host.dispose();
});