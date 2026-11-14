const checks = {};
try { void parent.document.body; checks.parentDom = false; } catch { checks.parentDom = true; }
try { void localStorage.length; checks.storage = false; } catch { checks.storage = true; }
try { await fetch('https://inkloom.invalid/sandbox-network-probe'); checks.fetch = false; } catch { checks.fetch = true; }
try { await api.read('private'); checks.sourceRead = false; } catch { checks.sourceRead = true; }
try { await api.write('private', 'stale', 'changed'); checks.write = false; } catch { checks.write = true; }
try { await api.request('https://inkloom.invalid/'); checks.network = false; } catch { checks.network = true; }
try { await api.execute('process'); checks.process = false; } catch { checks.process = true; }
const view = await api.registerView({ id: 'sandbox-list', name: '隔离示例', icon: 'circle-dot', location: 'activity', order: 90 });
await api.registerSetting({ id: 'row-limit', name: '最多显示', type: 'number', min: 1, max: 50, default: 20 });
const refresh = async () => {
	const limit = await api.getSetting('row-limit') ?? 20;
	await api.updateView(view, { type: 'notes', rows: await api.query({ limit }) });
};
await api.on('vault.changed', refresh);
await api.on('settings.changed', refresh);
await api.registerCommand({ id: 'show-list', name: '打开隔离示例', shortcut: 'Ctrl+Shift+I', run: () => api.showView(view) });
await refresh();
evidence(checks);