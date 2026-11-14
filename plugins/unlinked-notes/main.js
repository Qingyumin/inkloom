export function activate(api) {
  let alive = true;
  const view = api.registerView({ id: 'note-list', name: '未关联笔记', icon: 'circle-dot', location: 'activity', order: 80 });
  api.registerSetting({ id: 'row-limit', name: '最多显示', type: 'number', min: 10, max: 250, default: 100 });
  const refresh = async () => {
    try {
      const rows = await api.queryAsync({ orphan: true, limit: api.getSetting('row-limit') ?? 100 }, { key: 'unlinked-notes' });
      if (alive) api.updateView(view, { type: 'notes', rows });
    } catch (error) { if (alive && error.name !== 'AbortError') throw error; }
  };
  api.registerCommand({ id: 'open-list', name: '打开未关联笔记', shortcut: 'Ctrl+Shift+U', run: () => api.showView(view) });
  api.on('vault.changed', refresh); api.on('settings.changed', refresh); refresh().catch(error => { if (alive) api.fail(error.message); });
  return () => { alive = false; };
}