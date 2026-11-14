const capabilities = new Set(['metadata.read', 'vault.read', 'vault.write', 'commands', 'views', 'settings', 'network', 'execute']);
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9.-]{1,63}$/.test(value);
function versionTuple(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid plugin version');
  return value.split('.').map(Number);
}
function newer(required, installed) {
  for (let index = 0; index < 3; index++) { if (required[index] !== installed[index]) return required[index] > installed[index]; }
  return false;
}

export function validateManifest(manifest, hostVersion = '0.8.1') {
  if (!manifest || !validId(manifest.id) || typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('Invalid plugin identity');
  versionTuple(manifest.version);
  if (newer(versionTuple(manifest.minHost), versionTuple(hostVersion))) throw new Error('Plugin requires a newer host');
  if (typeof manifest.entry !== 'string' || !/^(builtin:[a-z0-9.-]+|[a-z0-9._-]+\.js)$/.test(manifest.entry)) throw new Error('Invalid plugin entry');
  if (!Array.isArray(manifest.activation) || manifest.activation.some(value => !['startup', 'manual'].includes(value))) throw new Error('Invalid activation events');
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.some(value => !validId(value))) throw new Error('Invalid plugin dependencies');
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.some(value => !capabilities.has(value))) throw new Error('Invalid plugin capabilities');
  return structuredClone(manifest);
}

export class PluginHost {
  constructor(hooks = {}) {
    this.hooks = hooks; this.plugins = new Map(); this.commands = new Map(); this.views = new Map(); this.settings = new Map(); this.events = new Map();
    this.mountedViews = new Map();
  }

  register(manifest, activate, options = {}) {
    const checked = validateManifest(manifest);
    if (this.plugins.has(checked.id)) throw new Error('Duplicate plugin id');
    if (typeof activate !== 'function') throw new Error('Missing plugin entry');
    const plugin = { manifest: checked, activate, trusted: options.trusted === true, essential: options.essential === true, packaged: options.packaged === true, state: 'disabled', resources: new Set(), generation: 0, error: '' };
    this.plugins.set(checked.id, plugin);
    try { this.activationOrder(); } catch (error) { this.plugins.delete(checked.id); throw error; }
    return checked.id;
  }

  unregister(id) {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    if (plugin.essential) throw new Error('Essential plugin cannot be unregistered');
    this.disable(id);
    this.plugins.delete(id);
    this.changed();
    return true;
  }

  activationOrder() {
    const visiting = new Set(); const visited = new Set(); const result = [];
    const visit = id => {
      if (visiting.has(id)) throw new Error('Plugin dependency cycle');
      if (visited.has(id) || !this.plugins.has(id)) return;
      visiting.add(id);
      for (const dependency of this.plugins.get(id).manifest.dependencies) visit(dependency);
      visiting.delete(id); visited.add(id); result.push(id);
    };
    for (const id of this.plugins.keys()) visit(id);
    return result;
  }

  async enable(id, grants = []) {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    if (plugin.state === 'enabled' || plugin.state === 'enabling') return;
    for (const dependency of plugin.manifest.dependencies) if (this.plugins.get(dependency)?.state !== 'enabled') throw new Error('Plugin dependency is not enabled: ' + dependency);
    const permissions = new Set(plugin.trusted ? plugin.manifest.capabilities : grants.filter(capability => plugin.manifest.capabilities.includes(capability)));
    if (!plugin.trusted && (permissions.has('network') || permissions.has('execute') || permissions.has('vault.write'))) throw new Error('External plugin write, network and execute are not enabled in this host');
    plugin.state = 'enabling'; plugin.error = ''; const generation = ++plugin.generation;
    const assertActive = () => { if (!['enabled', 'enabling'].includes(plugin.state) || generation !== plugin.generation) throw new Error('Plugin is disabled'); };
    const requirePermission = capability => { assertActive(); if (!permissions.has(capability)) throw new Error('Permission denied: ' + capability); };
    const own = dispose => {
      assertActive(); if (typeof dispose !== 'function') throw new Error('Invalid disposer');
      let disposed = false;
      const release = () => { if (disposed) return; disposed = true; plugin.resources.delete(release); dispose(); };
      plugin.resources.add(release); return release;
    };
    const safe = handler => async (...args) => {
      try { assertActive(); return await handler(...args); }
      catch (error) { if (generation === plugin.generation && error.name !== 'AbortError') this.disable(id, error); throw error; }
    };
    const pendingReads = new Set(); own(() => { for (const controller of pendingReads) controller.abort(); pendingReads.clear(); });
    const readTask = async (capability, kind, options, runtime = {}) => {
      requirePermission(capability); const controller = new AbortController(); const cancel = () => controller.abort();
      pendingReads.add(controller); runtime.signal?.addEventListener('abort', cancel, { once: true }); if (runtime.signal?.aborted) cancel();
      try {
        if (controller.signal.aborted) throw Object.assign(new Error('Query cancelled'), { name: 'AbortError' });
        const handler = this.hooks[kind] || (kind === 'queryAsync' ? this.hooks.query : null);
        const result = await handler(options, { ...runtime, signal: controller.signal });
        assertActive(); if (controller.signal.aborted) throw Object.assign(new Error('Query cancelled'), { name: 'AbortError' });
        return structuredClone(result);
      } finally { pendingReads.delete(controller); runtime.signal?.removeEventListener('abort', cancel); }
    };
    const registerItem = (map, descriptor, permission) => {
      requirePermission(permission);
      if (!descriptor || !validId(descriptor.id) || typeof descriptor.name !== 'string') throw new Error('Invalid contribution');
      const key = id + ':' + descriptor.id;
      if (map.has(key)) throw new Error('Duplicate contribution');
      const item = { ...descriptor, id: key, pluginId: id };
      if (item.run) item.run = safe(item.run);
      map.set(key, item); own(() => { if (map === this.views) this.unmountView(key); map.delete(key); this.changed(); }); this.changed();
      return key;
    };
    const api = Object.freeze({
      version: '1.7.0', pluginId: id,
      fail: message => { assertActive(); this.disable(id, new Error(String(message).slice(0, 500))); },
      query: options => { requirePermission('metadata.read'); return structuredClone(this.hooks.query?.(options) || []); },
      queryAsync: (options, runtime) => readTask('metadata.read', 'queryAsync', options, runtime),
      queryDatabase: (options, runtime) => readTask('metadata.read', 'queryDatabase', options, runtime),
      queryGraph: (options, runtime) => readTask('metadata.read', 'queryGraph', options, runtime),
      queryWorkspace: (options, runtime) => readTask('metadata.read', 'queryWorkspace', options, runtime),
      queryAi: (options, runtime) => { if (!plugin.trusted) return Promise.reject(new Error('AI context queries require a trusted plugin')); return readTask('vault.read', 'queryAi', options, runtime); },
      aiConfig: (action = 'get', payload = {}) => {
        requirePermission('settings');
        if (!plugin.trusted || !['get', 'save', 'local-status', 'local-start', 'local-stop', 'scan-raw', 'list-reading-docs', 'read-raw', 'import-raw', 'reveal-raw'].includes(action)) return Promise.reject(new Error('AI configuration requires a trusted plugin'));
        return Promise.resolve().then(() => this.hooks.aiConfig?.(action, structuredClone(payload)));
      },
      aiComplete: (payload = {}, runtime = {}) => {
        requirePermission('vault.read');
        if (!plugin.trusted) return Promise.reject(new Error('AI completion requires a trusted plugin'));
        return readTask('vault.read', 'aiComplete', payload, runtime);
      },
      activeDocument: () => { requirePermission('vault.read'); if (!plugin.trusted) throw new Error('Active document access requires a trusted plugin'); return structuredClone(this.hooks.activeDocument?.() || null); },
      updateActiveDocument: (noteId, revision, source) => {
        requirePermission('vault.write');
        if (!plugin.trusted || typeof noteId !== 'string' || !noteId || !Number.isInteger(revision) || revision < 0 || typeof source !== 'string' || source.length > 8 * 1024 * 1024) throw new Error('Invalid active document edit');
        return this.hooks.updateActiveDocument(noteId, revision, source);
      },
      saveActiveDocument: async noteId => { requirePermission('vault.write'); if (!plugin.trusted || typeof noteId !== 'string' || !noteId) throw new Error('Active document save requires a trusted plugin'); return this.hooks.saveActiveDocument(noteId); },
      createNote: async (title, options = {}) => {
        requirePermission('vault.write'); if (typeof title !== 'string' || !title.trim() || title.length > 240) throw new Error('Invalid note title');
        if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['folder', 'source', 'background', 'overwrite'].includes(key)) || (options.folder !== undefined && (typeof options.folder !== 'string' || !/^[a-z][a-z0-9-]{0,40}(?:\/[a-z][a-z0-9-]{0,40})*$/.test(options.folder))) || (options.source !== undefined && (typeof options.source !== 'string' || options.source.length > 8 * 1024 * 1024)) || (options.background !== undefined && typeof options.background !== 'boolean') || (options.overwrite !== undefined && typeof options.overwrite !== 'boolean')) throw new Error('Invalid note creation options');
        return this.hooks.createNote(title, structuredClone(options));
      },
      read: (noteId, runtime) => readTask('vault.read', 'read', noteId, runtime),
      write: async (noteId, version, source) => { requirePermission('vault.write'); if (typeof noteId !== 'string' || !noteId || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || typeof source !== 'string') throw new Error('A valid note identity, content version and source are required'); return this.hooks.write(noteId, version, source); },
      updateProperties: async (noteId, version, patch) => {
        requirePermission('vault.write');
        if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || !patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('A valid note version and property patch are required');
        return this.hooks.updateProperties(noteId, version, structuredClone(patch));
      },
      promoteEdge: async (sourceId, targetId, reason = '') => {
        requirePermission('vault.write');
        if (!plugin.trusted || typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId) throw new Error('Edge promotion requires a trusted plugin and valid node IDs');
        return this.hooks.promoteEdge?.(sourceId, targetId, String(reason || '').slice(0, 200));
      },
      open: noteId => { requirePermission('metadata.read'); return this.hooks.open(noteId); },
      openLink: async link => {
        requirePermission('metadata.read');
        if (!plugin.trusted || typeof link !== 'string' || link.length > 2048 || /[\r\n]/.test(link)) throw new Error('Link navigation requires a trusted plugin and a valid link');
        if (!/^\[\[[^\[\]]+\]\]$/.test(link) && !link.startsWith('#inkloom-reader?')) { const address = new URL(link); if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error('Only HTTP navigation is supported'); }
        if (!this.hooks.openLink) throw new Error('Link navigation is unavailable');
        return this.hooks.openLink(link);
      },
      notify: note => { requirePermission('metadata.read'); if (!plugin.trusted || typeof note?.title !== 'string' || note.title.length > 400 || typeof note.noteId !== 'string') throw new Error('Invalid notification'); return this.hooks.notify?.(structuredClone(note)); },
      registerCommand: descriptor => registerItem(this.commands, descriptor, 'commands'),
      registerView: descriptor => {
        if (descriptor?.mount && (!plugin.trusted || typeof descriptor.mount !== 'function')) throw new Error('DOM views require a trusted built-in plugin');
        if (descriptor?.location === 'context' && (!plugin.trusted || typeof descriptor.mount !== 'function')) throw new Error('Context views require a trusted built-in plugin');
        return registerItem(this.views, descriptor, 'views');
      },
      navigate: target => { requirePermission('views'); return this.hooks.navigate(target); },
      showView: viewId => { requirePermission('views'); if (this.views.get(viewId)?.pluginId !== id) throw new Error('View ownership mismatch'); return this.openView(viewId); },
      updateView: (viewId, model) => { requirePermission('views'); const view = this.views.get(viewId); if (!view || view.pluginId !== id) throw new Error('View ownership mismatch'); view.model = structuredClone(model); this.changed(); },
      registerSetting: descriptor => {
        requirePermission('settings');
        if (!['boolean', 'number', 'choice', 'data'].includes(descriptor?.type) || (descriptor.type === 'data' && !plugin.trusted)) throw new Error('Unsupported setting type');
        if (descriptor.type === 'number' && (!Number.isFinite(descriptor.min) || !Number.isFinite(descriptor.max) || descriptor.min > descriptor.max)) throw new Error('Invalid numeric bounds');
        if (descriptor.type === 'choice' && (!Array.isArray(descriptor.options) || !descriptor.options.length || descriptor.options.length > 100 || descriptor.options.some(option => typeof option.label !== 'string' || !['string', 'number', 'boolean'].includes(typeof option.value)))) throw new Error('Invalid setting options');
        return registerItem(this.settings, descriptor, 'settings');
      },
      getSetting: key => { requirePermission('settings'); const setting = this.settings.get(id + ':' + key); if (!setting) throw new Error('Setting is not registered'); const value = this.hooks.getSettings?.(id)?.[key]; return structuredClone(value === undefined ? setting.default : value); },
      setSetting: (key, value) => { requirePermission('settings'); return this.setSetting(id + ':' + key, value); },
      on: (event, handler) => {
        requirePermission('metadata.read');
        if (!['vault.changed', 'workspace.active', 'workspace.draft', 'workspace.appearance', 'settings.changed'].includes(event) || typeof handler !== 'function') throw new Error('Invalid host event');
        if (!this.events.has(event)) this.events.set(event, new Set());
        const listener = safe(handler); this.events.get(event).add(listener); return own(() => this.events.get(event).delete(listener));
      },
      interval: (handler, delay) => { assertActive(); if (!Number.isFinite(delay) || delay < 100) throw new Error('Timer budget is at least 100 ms'); const timer = setInterval(() => safe(handler)().catch(() => {}), delay); return own(() => clearInterval(timer)); },
      own,
      ownWorker: worker => { assertActive(); if (!plugin.trusted || !worker || typeof worker.terminate !== 'function') throw new Error('Worker ownership unavailable'); return own(() => worker.terminate()); },
      request: async () => { requirePermission('network'); throw new Error('Network API is not enabled'); },
      execute: async () => { requirePermission('execute'); throw new Error('Process API is not enabled'); },
    });
    let activationTimer; let lateDisposed = false;
    try {
      const activation = Promise.resolve(plugin.activate(api));
      activation.then(dispose => { if (generation !== plugin.generation && typeof dispose === 'function') { lateDisposed = true; dispose(); } }).catch(() => {});
      const budget = new Promise((resolve, reject) => { activationTimer = setTimeout(() => reject(new Error('Plugin activation exceeded its time budget')), this.hooks.activationBudgetMs || 5000); });
      const dispose = await Promise.race([activation, budget]);
      if (generation !== plugin.generation) { if (!lateDisposed && typeof dispose === 'function') dispose(); return; }
      if (typeof dispose === 'function') own(dispose);
      plugin.state = 'enabled'; this.changed();
    } catch (error) { if (generation === plugin.generation) this.disable(id, error); throw error; }
    finally { clearTimeout(activationTimer); }
  }

  disable(id, error = null) {
    const plugin = this.plugins.get(id); if (!plugin) return;
    for (const dependent of this.plugins.values()) if (dependent.manifest.dependencies.includes(id) && ['enabled', 'enabling'].includes(dependent.state)) this.disable(dependent.manifest.id);
    plugin.generation++; plugin.state = error ? 'failed' : 'disabled'; plugin.error = error?.message || '';
    for (const release of [...plugin.resources].reverse()) { try { release(); } catch (disposeError) { plugin.error ||= disposeError.message; } }
    this.changed(); if (error) this.hooks.failure?.(id, error);
  }

  safeMode() { for (const plugin of this.plugins.values()) if (!plugin.essential) this.disable(plugin.manifest.id); }
  changed() { this.hooks.changed?.(); }
  async emit(event, detail = {}) { await Promise.allSettled([...(this.events.get(event) || [])].map(listener => listener(structuredClone(detail)))); }
  async command(id) { const command = this.commands.get(id); if (!command?.run) throw new Error('Command unavailable'); return command.run(); }
  async openView(id) { const view = this.views.get(id); if (!view) throw new Error('View unavailable'); if (view.run) await view.run(); else this.hooks.view?.(view); }
  mountView(id, container) {
    const view = this.views.get(id); const plugin = view && this.plugins.get(view.pluginId);
    if (!view?.mount || !plugin?.trusted || plugin.state !== 'enabled') throw new Error('Mounted view unavailable');
    if (this.mountedViews.get(id)?.container === container) return;
    this.unmountView(id);
    const controller = new AbortController(); const releases = new Set();
    const scope = {
      signal: controller.signal,
      own: release => {
        if (controller.signal.aborted || typeof release !== 'function') throw new Error('View scope is closed');
        let done = false;
        const dispose = () => { if (done) return; done = true; releases.delete(dispose); release(); };
        releases.add(dispose); return dispose;
      },
    };
    const dispose = () => {
      controller.abort();
      for (const release of [...releases].reverse()) { try { release(); } catch (error) { plugin.error = error.message; } }
      container.replaceChildren();
    };
    this.mountedViews.set(id, { container, dispose });
    try {
      const release = view.mount(container, scope);
      if (typeof release !== 'function') throw new Error('A mounted view must return a disposer');
      scope.own(release);
    } catch (error) { this.unmountView(id); this.disable(view.pluginId, error); throw error; }
  }
  unmountView(id) {
    const mounted = this.mountedViews.get(id); if (!mounted) return;
    this.mountedViews.delete(id); mounted.dispose();
  }
  async setSetting(id, value) {
    const setting = this.settings.get(id); if (!setting) throw new Error('Setting unavailable');
    if (setting.type === 'boolean' && typeof value !== 'boolean') throw new Error('Expected boolean');
    if (setting.type === 'number' && (!Number.isFinite(value) || value < setting.min || value > setting.max)) throw new Error('Numeric setting out of range');
    if (setting.type === 'choice' && !setting.options?.some(option => option.value === value)) throw new Error('Invalid setting choice');
    if (setting.type === 'data') { const serialized = JSON.stringify(value); if (!serialized || serialized.length > 131072) throw new Error('Setting data exceeds its budget'); value = JSON.parse(serialized); }
    await this.hooks.setSetting(setting.pluginId, id.slice(setting.pluginId.length + 1), value);
    await this.emit('settings.changed', { pluginId: setting.pluginId });
    this.changed();
  }
  diagnostics() {
    return { plugins: [...this.plugins.values()].map(plugin => ({ id: plugin.manifest.id, state: plugin.state, resources: plugin.resources.size, error: plugin.error })), commands: this.commands.size, views: this.views.size, mountedViews: this.mountedViews.size, settings: this.settings.size, listeners: [...this.events.values()].reduce((total, listeners) => total + listeners.size, 0) };
  }
  dispose() { for (const id of [...this.plugins.keys()].reverse()) this.disable(id); }
}