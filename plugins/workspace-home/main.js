export function activate(api) {
  api.registerSetting({ id: 'task-mode', name: '任务默认视图', type: 'choice', default: 'list', options: [{ label: '清单', value: 'list' }, { label: '看板', value: 'board' }] });
  api.registerSetting({ id: 'layouts', name: '工作台布局', type: 'data', default: {} });
  api.registerSetting({ id: 'drafts', name: '收集草稿', type: 'data', default: {} });
  api.registerSetting({ id: 'database-template', name: '工作台关联视图预设', type: 'data', default: {} });
  api.registerSetting({ id: 'home-surface', name: '工作台默认页面', type: 'choice', default: 'overview', options: [{ label: '总览', value: 'overview' }, { label: '可组合面板', value: 'panels' }] });
  api.registerSetting({ id: 'open-on-start', name: '启动后进入工作台', type: 'boolean', default: false });
  api.registerSetting({ id: 'reminders', name: '应用打开时提醒任务', type: 'boolean', default: false });
  const view = api.registerView({ id: 'home-view', target: 'home', name: '工作台', icon: 'panels-top-left', location: 'activity', order: -10, mount(container, scope) {
    let dispose; container.textContent = '正在载入工作台...';
    import('./workspace-view.js').then(module => { if (!scope.signal.aborted) { container.replaceChildren(); dispose = module.mountWorkspace(api, container, scope); } }).catch(error => { if (!scope.signal.aborted) api.fail(error.message); });
    return () => dispose?.();
  } });
  api.registerCommand({ id: 'open-home', name: '打开工作台', shortcut: 'Ctrl+Alt+H', run: () => api.showView(view) });
  const seen = new Set(); let checking = false;
  async function remind() {
    if (checking || !api.getSetting('reminders')) return;
    checking = true;
    try {
      const { localDay } = await import('../../core/workspace-model.mjs'); const today = localDay();
      const result = await api.queryWorkspace({ today, start: today, filter: 'all' }); const now = new Date();
      for (const task of result.calendar.filter(task => !task.done && task.due === today && task.time)) {
        const key = result.vaultKey + ':' + task.id + ':' + task.due + ':' + task.time;
        if (!seen.has(key) && new Date(task.due + 'T' + task.time + ':00') <= now) { seen.add(key); api.notify({ id: key, noteId: task.noteId, title: task.title }); }
      }
      if (seen.size > 1000) { const entries = [...seen]; seen.clear(); for (const key of entries.slice(-500)) seen.add(key); }
    } catch (error) { if (error.name !== 'AbortError') console.warn('Task reminder check unavailable'); }
    finally { checking = false; }
  }
  api.interval(remind, 30000); api.on('settings.changed', () => remind()); api.on('vault.changed', () => remind());
  void remind();
}