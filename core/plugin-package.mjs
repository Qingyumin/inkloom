import { validateManifest } from './plugin-host.mjs';
import { cacheChecksum } from './index-cache.mjs';

export const BUILTIN_PLUGIN_IDS = new Set([
  'core-navigation',
  'unlinked-notes',
  'note-views',
  'knowledge-graph',
  'workspace-home',
  'whiteboard',
  'research-desk',
  'ai-assistant',
  'sandbox-inspector',
]);

const ALLOWED_EXTERNAL_CAPABILITIES = new Set([
  'metadata.read',
  'vault.read',
  'commands',
  'views',
  'settings',
]);

export async function validatePluginPackage(rawPackage, { hostVersion = '0.8.1' } = {}) {
  if (!rawPackage || typeof rawPackage !== 'object' || Array.isArray(rawPackage)) {
    throw new Error('扩展包格式无效');
  }
  const serialized = JSON.stringify(rawPackage);
  if (!serialized || serialized.length > 262144) {
    throw new Error('扩展包体积超出 256 KiB 安全上限');
  }
  if (rawPackage.format !== 'inkloom.plugin-package' || rawPackage.version !== 1) {
    throw new Error('不支持的扩展包格式或协议版本');
  }

  const manifest = validateManifest(rawPackage.manifest, hostVersion);
  if (BUILTIN_PLUGIN_IDS.has(manifest.id)) {
    throw new Error('禁止覆盖核心内置扩展：' + manifest.id);
  }
  if (
    manifest.entry.startsWith('builtin:') ||
    manifest.entry.includes('..') ||
    manifest.entry.includes('/') ||
    manifest.entry.includes('\\') ||
    !/^[a-z0-9._-]+\.js$/.test(manifest.entry)
  ) {
    throw new Error('扩展包入口文件路径非法（禁止路径越界）');
  }

  for (const cap of manifest.capabilities) {
    if (!ALLOWED_EXTERNAL_CAPABILITIES.has(cap)) {
      throw new Error('外部离线扩展包不允许申请高危权限：' + cap);
    }
  }

  const source = rawPackage.source;
  if (typeof source !== 'string' || !source.trim() || source.length > 196608) {
    throw new Error('扩展包源码为空或超出 192 KiB 限制');
  }

  const expectedHash = String(rawPackage.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('扩展包缺少有效的 64 位 SHA-256 完整性签名');
  }
  const actualHash = await cacheChecksum(source);
  if (actualHash !== expectedHash) {
    throw new Error('扩展包 SHA-256 校验和不匹配，源码可能已损坏或被篡改');
  }

  const license = String(rawPackage.license || '').trim();
  const author = String(rawPackage.author || '').trim();
  const repository = String(rawPackage.repository || '').trim();
  const description = String(rawPackage.description || '').trim();

  if (!license || license.length > 120) {
    throw new Error('扩展包必须声明许可证（license）');
  }
  if (!author || author.length > 120) {
    throw new Error('扩展包必须声明作者或维护者（author）');
  }
  if (repository) {
    if (repository.length > 240 || /^(?:javascript|data|file):/i.test(repository) || /:\/\/[^/]*@/.test(repository)) {
      throw new Error('扩展包仓库地址无效或包含内嵌凭据');
    }
  }
  if (description.length > 400) {
    throw new Error('扩展包说明超出长度限制');
  }

  return {
    format: 'inkloom.plugin-package',
    version: 1,
    manifest,
    source,
    sha256: actualHash,
    license,
    author,
    repository: repository || 'local://offline-package',
    description: description || manifest.name,
    installedAt: rawPackage.installedAt || new Date().toISOString(),
  };
}

export async function createPluginTemplatePackage({
  id = 'reading-stats-helper',
  name = '阅读卡片统计助手',
  version = '1.0.0',
  minHost = '0.8.1',
  author = 'Inkloom Developer Template',
  license = 'MIT',
  repository = 'https://inkloom.local/extensions/reading-stats-helper',
  description = '按连接度筛选知识库笔记的离线沙箱扩展模板（基于 SDK 1.7 隔离 iframe 运行）',
} = {}) {
  const source = [
    "await api.registerSetting({ id: 'limit', name: '最大显示篇数', type: 'number', min: 1, max: 50, default: 10 });",
    "const viewId = await api.registerView({ id: 'stats-view', name: " + JSON.stringify(name) + ", icon: 'circle-dot', location: 'activity', order: 95 });",
    "const refresh = async () => {",
    "  const limit = Number(await api.getSetting('limit')) || 10;",
    "  const rows = await api.query({ limit });",
    "  await api.updateView(viewId, { type: 'notes', rows });",
    "  return rows.length;",
    "};",
    "await api.registerCommand({ id: 'refresh-stats', name: '打开' + " + JSON.stringify(name) + ", run: () => api.showView(viewId) });",
    "await api.on('vault.changed', refresh);",
    "await api.on('settings.changed', refresh);",
    "await refresh();",
  ].join('\n');

  const sha256 = await cacheChecksum(source);
  return validatePluginPackage({
    format: 'inkloom.plugin-package',
    version: 1,
    manifest: {
      id,
      name,
      version,
      minHost,
      entry: 'main.js',
      activation: ['manual'],
      dependencies: [],
      capabilities: ['metadata.read', 'views', 'commands', 'settings'],
    },
    source,
    sha256,
    license,
    author,
    repository,
    description,
  }, { hostVersion: minHost });
}

export function normalizePluginRegistryState(raw = {}) {
  const installed = raw?.installed && typeof raw.installed === 'object' && !Array.isArray(raw.installed) ? { ...raw.installed } : {};
  const backups = raw?.backups && typeof raw.backups === 'object' && !Array.isArray(raw.backups) ? { ...raw.backups } : {};
  return { installed, backups };
}

export async function installPluginPackage(rawState = {}, rawPackage, { hostVersion = '0.8.1' } = {}) {
  const state = normalizePluginRegistryState(rawState);
  const checked = await validatePluginPackage(rawPackage, { hostVersion });
  const id = checked.manifest.id;
  const previous = state.installed[id] || null;
  const nextInstalled = { ...state.installed, [id]: checked };
  const nextBackups = { ...state.backups };
  if (previous) {
    nextBackups[id] = structuredClone(previous);
  }
  return {
    nextState: { installed: nextInstalled, backups: nextBackups },
    installed: checked,
    upgraded: Boolean(previous),
    previousVersion: previous?.manifest?.version || null,
    canRollback: Boolean(nextBackups[id]),
  };
}

export function rollbackPluginPackage(rawState = {}, pluginId) {
  const state = normalizePluginRegistryState(rawState);
  const backup = state.backups[pluginId];
  if (!backup) {
    throw new Error('该扩展没有可回退的旧版本备份');
  }
  const nextInstalled = { ...state.installed, [pluginId]: structuredClone(backup) };
  const nextBackups = { ...state.backups };
  delete nextBackups[pluginId];
  return {
    nextState: { installed: nextInstalled, backups: nextBackups },
    restored: structuredClone(backup),
  };
}

export function removePluginPackage(rawState = {}, pluginId) {
  const state = normalizePluginRegistryState(rawState);
  if (BUILTIN_PLUGIN_IDS.has(pluginId)) {
    throw new Error('内置扩展不支持卸载，请使用停用开关');
  }
  const nextInstalled = { ...state.installed };
  const nextBackups = { ...state.backups };
  delete nextInstalled[pluginId];
  delete nextBackups[pluginId];
  return {
    nextState: { installed: nextInstalled, backups: nextBackups },
  };
}

export function defaultExtensionCatalog() {
  return [
    {
      id: 'workspace-home',
      name: '可组合工作台',
      version: '0.5.0',
      license: 'MIT (GridStack 12.3.3 + FullCalendar 6.1.19)',
      repository: 'builtin://plugins/workspace-home',
      capabilities: ['metadata.read', 'vault.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'note-views',
      name: '多维笔记视图',
      version: '0.5.4',
      license: 'MIT (@tanstack/table-core 8.21.3)',
      repository: 'builtin://plugins/note-views',
      capabilities: ['metadata.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'knowledge-graph',
      name: '万象与局部知识星图',
      version: '0.4.0',
      license: 'ISC (d3-force 3.0.0) + Apache-2.0 (Comlink 4.4.2)',
      repository: 'builtin://plugins/knowledge-graph',
      capabilities: ['metadata.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'whiteboard',
      name: 'Excalidraw 白板与手绘手帐',
      version: '0.5.4',
      license: 'MIT (Excalidraw 0.18.0)',
      repository: 'builtin://plugins/whiteboard',
      capabilities: ['metadata.read', 'vault.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'research-desk',
      name: '阅读与长稿研究工作台',
      version: '0.5.4',
      license: 'MIT',
      repository: 'builtin://plugins/research-desk',
      capabilities: ['metadata.read', 'vault.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'ai-assistant',
      name: '智识与 Skills 工作台',
      version: '0.7.0',
      license: 'MIT + Apache-2.0 (SmolLM2 GGUF / llama.cpp)',
      repository: 'builtin://plugins/ai-assistant',
      capabilities: ['metadata.read', 'vault.read', 'vault.write', 'views', 'commands', 'settings'],
      isolation: 'trusted-builtin',
      builtin: true,
    },
    {
      id: 'reading-stats-helper',
      name: '阅读卡片统计助手（SDK 离线模板）',
      version: '1.0.0',
      license: 'MIT',
      repository: 'https://inkloom.local/extensions/reading-stats-helper',
      capabilities: ['metadata.read', 'views', 'commands', 'settings'],
      isolation: 'sandboxed-iframe',
      builtin: false,
    },
  ];
}
