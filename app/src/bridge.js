import { createStarterVaultNotes } from './sample-vault.js';
import { planVaultRename, planVaultMove, planVaultFolderMove, localDate } from '../../core/vault-graph.mjs';
import { createStarterRawFiles, computeSimpleSha256Hex } from '../../core/raw-document-ingestor.mjs';
import { validateSecondaryWindowSpec } from '../../core/multi-window-docking.mjs';

const pending = new Map();
const assets = new Map();
let sequence = 0;
let activeDocumentId = null;
const browserDocuments = new Map();
let sessionDatabase;
export const desktop = !!window.chrome?.webview;

const browserWindowId = new URLSearchParams(window.location?.search || '').get('window') || 'browser-main';
const browserSecondaryWindows = [];
const multiWindowChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('inkloom.multiwindow.v1') : null;
if (multiWindowChannel) {
  multiWindowChannel.onmessage = event => {
    const msg = event.data;
    if (!msg || msg.sourceWindowId === browserWindowId) return;
    if (msg.channelEvent === 'crossWindowSync') {
      window.dispatchEvent(new CustomEvent('inkloom:crossWindowSync', { detail: msg.payload }));
    } else if (msg.channelEvent === 'windowRegistryChanged') {
      window.dispatchEvent(new CustomEvent('inkloom:windowRegistryChanged', { detail: msg.payload }));
    }
  };
}
function describeBrowserWindows() {
  return [
    { windowId: browserWindowId, isSecondary: false, targetType: 'note', targetId: activeDocumentId || '', title: '主工作区', activeDocumentId },
    ...browserSecondaryWindows.map(w => ({ ...w })),
  ];
}

const browserVaultKey = 'inkloom.vault.notes.v1';
const browserRawKey = 'inkloom.vault.raw.v1';
let browserVault = null;
let browserRawFiles = null;
let browserAiSecret = '';

function ensureBrowserRawFiles() {
  if (browserRawFiles) return browserRawFiles;
  const rawJson = localStorage.getItem(browserRawKey);
  if (rawJson !== null) {
    const cached = JSON.parse(rawJson);
    if (!Array.isArray(cached)) throw new Error('浏览器原件副本索引损坏，未加载任何替代数据');
    browserRawFiles = cached;
    return browserRawFiles;
  }
  browserRawFiles = createStarterRawFiles('2026-10-21').map(item => ({
    ...item,
    id: 'raw:' + item.relativePath,
    path: 'vault://' + item.relativePath,
    sizeBytes: (item.source || '').length,
    sha256: computeSimpleSha256Hex(item.source || ''),
  }));
  localStorage.setItem(browserRawKey, JSON.stringify(browserRawFiles));
  return browserRawFiles;
}

function saveBrowserRawFiles(next) {
  localStorage.setItem(browserRawKey, JSON.stringify(next));
  browserRawFiles = next;
}

async function browserRawBytes(record) {
  const bytes = record.base64Data ? Uint8Array.from(atob(record.base64Data), character => character.charCodeAt(0)) : new TextEncoder().encode(record.source || '');
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('原件为空或超过 16 MB 读取上限');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { sizeBytes: bytes.length, sha256: Array.from(hash, value => value.toString(16).padStart(2, '0')).join('') };
}

function ensureBrowserVault() {
  if (browserVault) return browserVault;
  try {
    const cached = JSON.parse(localStorage.getItem(browserVaultKey) || 'null');
    if (cached && Array.isArray(cached.notes)) {
      if (!Array.isArray(cached.folders)) cached.folders = [];
      browserVault = cached;
      return browserVault;
    }
  } catch {}
  const notes = createStarterVaultNotes('2026-10-21').map(note => ({
    ...note,
    path: 'vault://' + note.relativePath,
  }));
  browserVault = {
    vaultName: '墨图示例知识库 (Starter Vault)',
    vaultPath: 'vault://starter-vault',
    folders: ['journals', 'notes', 'raw', 'wiki'],
    notes,
  };
  saveBrowserVault();
  return browserVault;
}

function saveBrowserVault() {
  if (!browserVault) return;
  localStorage.setItem(browserVaultKey, JSON.stringify(browserVault));
}

export function selectDocument(id) {
  activeDocumentId = id;
  if (!desktop && id && !browserDocuments.has(id)) {
    const vault = ensureBrowserVault();
    const vaultNote = vault.notes.find(item => item.id === id);
    browserDocuments.set(id, {
      id,
      name: vaultNote?.name || '未命名.md',
      path: vaultNote?.path || null,
      relativePath: vaultNote?.relativePath || null,
      handle: null,
      stamp: null,
    });
  }
}

async function sessionStorageOperation(mode, id, value) {
  if (!sessionDatabase) sessionDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('inkloom.workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const database = await sessionDatabase;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', mode === 'read' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = mode === 'read' ? store.get(id) : mode === 'delete' ? store.delete(id) : store.put(value, id);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('文档缓存写入已取消。'));
  });
}

export async function digest(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

if (desktop) window.chrome.webview.addEventListener('message', event => {
  const message = event.data;
  if (message.event) {
    window.dispatchEvent(new CustomEvent('inkloom:' + message.event, { detail: message.data }));
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.result);
});

async function writeFile(handle, text) {
  const writer = await handle.createWritable();
  try { await writer.write(text); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

async function browserCall(command, args) {
  const documentId = args.documentId || activeDocumentId;
  const owner = browserDocuments.get(documentId);
  const vault = ensureBrowserVault();

  if (command === 'hello') {
    const first = vault.notes[0] || { id: crypto.randomUUID(), name: '未命名.md', path: null, source: '' };
    const hash = await digest(first.source);
    browserDocuments.set(first.id, {
      id: first.id,
      name: first.name,
      path: first.path,
      relativePath: first.relativePath,
      handle: null,
      stamp: null,
    });
    return {
      settings: JSON.parse(localStorage.getItem('inkloom.settings') || '{}'),
      document: {
        id: first.id,
        name: first.name,
        path: first.path,
        relativePath: first.relativePath,
        text: first.source,
        hash,
      },
      documents: [{ id: first.id, name: first.name, path: first.path, dirty: false }],
      vault: {
        vaultName: vault.vaultName,
        vaultPath: vault.vaultPath,
        folders: vault.folders || [],
        notes: vault.notes,
      },
      recent: [],
      workspace: true,
      multipleWindows: true,
      isSecondary: new URLSearchParams(window.location?.search || '').get('secondary') === '1',
      windowId: browserWindowId,
      activeWindowCount: 1 + browserSecondaryWindows.length,
      windows: describeBrowserWindows(),
    };
  }

  if (command === 'openSecondaryWindow') {
    const validated = validateSecondaryWindowSpec(args);
    browserSecondaryWindows.push(validated);
    const registryPayload = {
      activeWindowCount: 1 + browserSecondaryWindows.length,
      windows: describeBrowserWindows(),
    };
    multiWindowChannel?.postMessage({ sourceWindowId: browserWindowId, channelEvent: 'windowRegistryChanged', payload: registryPayload });
    window.dispatchEvent(new CustomEvent('inkloom:windowRegistryChanged', { detail: registryPayload }));
    return {
      window: validated,
      multipleWindows: true,
      activeWindowCount: registryPayload.activeWindowCount,
      windows: registryPayload.windows,
    };
  }

  if (command === 'listWindows') {
    return {
      multipleWindows: true,
      activeWindowCount: 1 + browserSecondaryWindows.length,
      windows: describeBrowserWindows(),
    };
  }

  if (command === 'broadcastWindowEvent') {
    const syncPayload = {
      eventType: args.eventType || 'note-saved',
      sourceWindowId: browserWindowId,
      payload: args.payload || args,
    };
    multiWindowChannel?.postMessage({ sourceWindowId: browserWindowId, channelEvent: 'crossWindowSync', payload: syncPayload });
    window.dispatchEvent(new CustomEvent('inkloom:crossWindowSync', { detail: { ...syncPayload, loopbackPreview: true } }));
    return {
      delivered: browserSecondaryWindows.length,
      activeWindowCount: 1 + browserSecondaryWindows.length,
    };
  }

  if (command === 'closeSecondaryWindow') {
    const targetId = String(args.targetWindowId || 'all');
    if (targetId === 'all') {
      browserSecondaryWindows.length = 0;
    } else {
      const idx = browserSecondaryWindows.findIndex(w => w.windowId === targetId);
      if (idx >= 0) browserSecondaryWindows.splice(idx, 1);
    }
    const registryPayload = {
      activeWindowCount: 1 + browserSecondaryWindows.length,
      windows: describeBrowserWindows(),
    };
    multiWindowChannel?.postMessage({ sourceWindowId: browserWindowId, channelEvent: 'windowRegistryChanged', payload: registryPayload });
    window.dispatchEvent(new CustomEvent('inkloom:windowRegistryChanged', { detail: registryPayload }));
    return registryPayload;
  }

  if (command === 'vaultInfo' || command === 'rescanVault') {
    return {
      vaultName: vault.vaultName,
      vaultPath: vault.vaultPath,
      folders: vault.folders || [],
      notes: vault.notes,
    };
  }

  if (command === 'openVault') {
    if (window.showDirectoryPicker && !args.resetStarter) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const scanned = [];
        const walk = async (dir, prefix = '') => {
          for await (const [entryName, handle] of dir.entries()) {
            if (entryName.startsWith('.') || entryName === 'node_modules') continue;
            const rel = prefix ? `${prefix}/${entryName}` : entryName;
            if (handle.kind === 'directory') await walk(handle, rel);
            else if (/\.(md|markdown|txt)$/i.test(entryName)) {
              const file = await handle.getFile();
              if (file.size <= 24 * 1024 * 1024) {
                const source = (await file.text()).replace(/\r\n/g, '\n');
                scanned.push({
                  id: 'vault-' + (await digest(rel)).slice(0, 12),
                  name: entryName,
                  relativePath: rel,
                  path: `vault://${dirHandle.name}/${rel}`,
                  source,
                  starred: false,
                });
              }
            }
          }
        };
        await walk(dirHandle);
        {
          browserVault = { vaultId: crypto.randomUUID(), vaultName: dirHandle.name, vaultPath: `vault://${dirHandle.name}`, notes: scanned };
          saveBrowserVault();
        }
      } catch (err) {
        if (err?.name === 'AbortError') return null;
        throw err;
      }
    } else if (args.resetStarter) {
      localStorage.removeItem(browserVaultKey);
      browserVault = null;
      ensureBrowserVault();
    }
    return {
      vaultName: browserVault.vaultName,
      vaultPath: browserVault.vaultPath,
      notes: browserVault.notes,
    };
  }

  if (command === 'openVaultNote' || command === 'reloadVaultNote') {
    const target = vault.notes.find(n => n.id === args.noteId || n.relativePath === args.relativePath || n.path === args.path);
    if (!target) throw new Error('未找到对应的知识库笔记。');
    browserDocuments.set(target.id, {
      id: target.id,
      name: target.name,
      path: target.path,
      relativePath: target.relativePath,
      handle: null,
      stamp: null,
    });
    const hash = await digest(target.source);
    const cachedMarks = JSON.parse(localStorage.getItem('inkloom.marks.' + target.id) || 'null');
    if (command === 'reloadVaultNote') return { id: target.id, name: target.name, path: target.path, relativePath: target.relativePath, text: target.source, hash, annotations: cachedMarks };
    return {
      documents: [{
        id: target.id,
        name: target.name,
        path: target.path,
        relativePath: target.relativePath,
        text: target.source,
        hash,
        annotations: cachedMarks,
      }],
    };
  }

  if (command === 'createVaultNote') {
    const rawTitle = String(args.title || '新建笔记').trim().replace(/\.(md|markdown|txt)$/i, '');
    const safeFile = rawTitle.replace(/[\\/:*?"<>|]+/g, '-');
    const folder = String(args.folder || '').trim().replace(/^\/+|\/+$/g, '');
    const relativePath = folder && folder !== '根目录' && folder !== '待建节点'
      ? `${folder}/${safeFile}.md`
      : `${safeFile}.md`;
    if (folder && folder !== '根目录' && folder !== '待建节点') {
      if (!Array.isArray(vault.folders)) vault.folders = [];
      if (!vault.folders.includes(folder)) vault.folders.push(folder);
    }
    let existing = vault.notes.find(n => n.relativePath.toLowerCase() === relativePath.toLowerCase());
    if (existing && args.exclusive && !args.overwrite && existing.source !== args.source) throw new Error('同名笔记已存在且正文不同，未覆盖');
    if (existing && args.overwrite && typeof args.source === 'string') {
      existing.source = args.source;
      saveBrowserVault();
    }
    if (!existing) {
      const today = args.date || new Date().toISOString().slice(0, 10);
      const source = args.source || [
        '---',
        `title: ${rawTitle}`,
        'tags: [墨图笔记]',
        'status: 草稿',
        `date: ${today}`,
        '---',
        '',
        `# ${rawTitle}`,
        '',
        args.initialBody || '在此输入正文，使用 `[[` 可随时关联知识库中的其他笔记。',
        '',
      ].join('\n');
      existing = {
        id: 'vault-' + (await digest(relativePath + ':' + Date.now())).slice(0, 12),
        name: `${safeFile}.md`,
        relativePath,
        path: `vault://${relativePath}`,
        source,
        starred: false,
      };
      vault.notes.push(existing);
      saveBrowserVault();
    }
    if (args.background) return { note: existing, vault: { vaultId: vault.vaultId, vaultName: vault.vaultName, vaultPath: vault.vaultPath, folders: vault.folders || [], notes: vault.notes } };
    browserDocuments.set(existing.id, {
      id: existing.id,
      name: existing.name,
      path: existing.path,
      relativePath: existing.relativePath,
      handle: null,
      stamp: null,
    });
    return {
      note: existing,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, folders: vault.folders || [], notes: vault.notes },
      document: {
        id: existing.id,
        name: existing.name,
        path: existing.path,
        relativePath: existing.relativePath,
        text: existing.source,
        hash: await digest(existing.source),
      },
    };
  }

  if (command === 'createVaultFolder') {
    const cleanFolder = String(args.folder || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (!cleanFolder || cleanFolder.split('/').some(p => !p || p === '.' || p === '..')) {
      throw new Error('目录名称无效，不能包含 . 或 .. 路径段。');
    }
    if (!Array.isArray(vault.folders)) vault.folders = [];
    const parts = cleanFolder.split('/');
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!vault.folders.some(f => f.toLowerCase() === prefix.toLowerCase())) {
        vault.folders.push(prefix);
      }
    }
    saveBrowserVault();
    return {
      folder: cleanFolder,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, folders: vault.folders, notes: vault.notes },
    };
  }

  if (command === 'revealVaultItem') {
    const rel = String(args.relativePath || args.path || '').replaceAll('\\', '/').replace(/^vault:\/\//i, '');
    const isFolder = Boolean(args.isFolder);
    return {
      revealed: true,
      fullPath: `vault://${rel || ''}`,
      relativePath: rel,
      isFolder,
      exists: true,
    };
  }

  if (command === 'deleteVaultItems') {
    const next = structuredClone(vault);
    for (const update of (args.updates || [])) {
      const note = next.notes.find(item => item.id === update.noteId || item.relativePath === update.relativePath);
      if (!note || note.source !== update.expectedSource) throw new Error('引用笔记已变化，删除未提交。');
      note.source = update.source;
    }
    const deletedIds = new Set((args.deletedNotes || []).map(n => n.noteId));
    const deletedRels = new Set((args.deletedNotes || []).map(n => String(n.relativePath || '').toLowerCase()));
    next.notes = next.notes.filter(n => !deletedIds.has(n.id) && !deletedRels.has(String(n.relativePath || '').toLowerCase()));
    if (args.mode === 'folder' && args.folderPath) {
      const fPrefix = String(args.folderPath).toLowerCase();
      next.folders = (next.folders || []).filter(f => f.toLowerCase() !== fPrefix && !f.toLowerCase().startsWith(fPrefix + '/'));
    }
    localStorage.setItem(browserVaultKey, JSON.stringify(next));
    browserVault = next;
    const invalidatedIds = [
      ...deletedIds,
      ...(args.updates || []).map(u => u.noteId),
    ];
    for (const id of invalidatedIds) browserDocuments.delete(id);
    const firstRemaining = next.notes[0] || { id: crypto.randomUUID().replaceAll('-', ''), name: '未命名.md', path: null, relativePath: '未命名.md', source: '' };
    const docHash = await digest(firstRemaining.source || '');
    browserDocuments.set(firstRemaining.id, {
      id: firstRemaining.id,
      name: firstRemaining.name,
      path: firstRemaining.path,
      relativePath: firstRemaining.relativePath,
      handle: null,
      stamp: null,
    });
    return {
      summary: { deletedCount: deletedIds.size, affectedFileCount: (args.updates || []).length },
      invalidatedIds,
      document: {
        id: firstRemaining.id,
        name: firstRemaining.name,
        path: firstRemaining.path,
        relativePath: firstRemaining.relativePath,
        text: firstRemaining.source || '',
        hash: docHash,
      },
      vault: next,
    };
  }

  if (command === 'scanRawFiles') {
    return { rawFiles: ensureBrowserRawFiles() };
  }

  if (command === 'listReadingDocuments') {
    return { rawFiles: ensureBrowserRawFiles().filter(item => /\.(pdf|epub)$/i.test(item.relativePath)).map(({ name, relativePath, sizeBytes }) => ({ name, relativePath, sizeBytes })) };
  }

  if (command === 'readRawFile') {
    const relativePath = args.relativePath;
    if (typeof relativePath !== 'string' || !relativePath.startsWith('raw/') || /[\\:\x00-\x1f]/.test(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('原件路径必须位于 raw 目录');
    const record = ensureBrowserRawFiles().find(item => item.relativePath.toLowerCase() === relativePath.toLowerCase());
    if (!record) throw new Error('找不到原件：' + relativePath);
    return { ...record, ...await browserRawBytes(record) };
  }

  if (command === 'importRawFile') {
    const list = ensureBrowserRawFiles();
    const cleanName = String(args.fileName || '').split(/[\\/]/).pop().replace(/[\\/:*?"<>|]+/g, '-');
    if (!cleanName || !/\.(pdf|epub|docx|pptx|xlsx|csv|tsv|txt|html?|md|markdown|png|jpe?g|webp|svg)$/i.test(cleanName)) throw new Error('不支持的原始资料格式');
    const relativePath = `raw/${cleanName}`;
    const integrity = await browserRawBytes(args);
    const record = {
      id: 'raw:' + relativePath,
      name: cleanName,
      relativePath,
      path: 'vault://' + relativePath,
      ...integrity,
      source: args.source || '',
      base64Data: args.base64Data || '',
    };
    const existingIdx = list.findIndex(item => item.relativePath.toLowerCase() === relativePath.toLowerCase());
    if (existingIdx >= 0 && !args.overwrite && (await browserRawBytes(list[existingIdx])).sha256 !== integrity.sha256) throw new Error('同名原件已存在，请更改文件名后导入；不会覆盖已有原件');
    const next = [...list];
    if (existingIdx >= 0) next[existingIdx] = record;
    else next.push(record);
    saveBrowserRawFiles(next);
    return {
      importedPath: relativePath,
      rawFiles: next,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, folders: vault.folders || [], notes: vault.notes },
    };
  }

  if (command === 'openDailyNote') {
    const today = args.date || localDate();
    const rel = `journals/${today}.md`;
    let existing = vault.notes.find(n => n.relativePath === rel || n.name === `${today}.md`);
    if (!existing) {
      const created = await browserCall('createVaultNote', {
        title: today,
        folder: 'journals',
        date: today,
        source: [
          '---',
          `title: 今日手记 · ${today}`,
          'aliases: [今日手记]',
          'tags: [今日手记, 日常思考]',
          'status: 记录中',
          `date: ${today}`,
          '---',
          '',
          `# 📅 今日手记 · ${today}`,
          '',
          '## 今日思考与灵感连接',
          '',
          '- 关联核心笔记：[[00-墨图导览与万象星图]]',
          '',
        ].join('\n'),
      });
      return created;
    }
    const opened = await browserCall('openVaultNote', { noteId: existing.id });
    return {
      note: existing,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, notes: vault.notes },
      document: opened.documents[0],
    };
  }

  if (command === 'updateVaultNoteSource') {
    const target = vault.notes.find(n => n.id === args.noteId || n.path === args.path || n.relativePath === args.relativePath);
    if (!target) throw new Error('目标笔记不存在。');
    if (typeof args.expectedSource !== 'string' || target.source !== args.expectedSource) throw new Error('笔记内容已变化，未覆盖。');
    const before = target.source;
    target.source = String(args.source ?? '');
    try { saveBrowserVault(); } catch (error) { target.source = before; throw error; }
    const hash = await digest(target.source);
    const syncPayload = {
      eventType: 'note-saved',
      sourceWindowId: browserWindowId,
      payload: {
        noteId: target.id,
        path: target.path,
        relativePath: target.relativePath,
        source: target.source,
        hash,
      },
    };
    multiWindowChannel?.postMessage({ sourceWindowId: browserWindowId, channelEvent: 'crossWindowSync', payload: syncPayload });
    return {
      note: target,
      hash,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, notes: vault.notes },
    };
  }

  if (command === 'toggleVaultStar') {
    const target = vault.notes.find(n => n.id === args.noteId || n.path === args.path);
    if (!target) return { starred: false };
    target.starred = typeof args.starred === 'boolean' ? args.starred : !target.starred;
    saveBrowserVault();
    return {
      starred: target.starred,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, notes: vault.notes },
    };
  }

  if (command === 'renameVaultNote') {
    planVaultRename(vault.notes, args.noteId, args.newTitle, false);
    const next = structuredClone(vault);
    for (const update of args.updates) {
      const note = next.notes.find(item => item.id === update.noteId);
      if (!note || note.source !== update.expectedSource) throw new Error('引用笔记已变化，重命名未提交。');
      note.source = update.source;
    }
    const target = next.notes.find(note => note.id === args.noteId);
    target.name = args.newTitle + '.md'; target.relativePath = args.newRelativePath; target.path = 'vault://' + args.newRelativePath;
    localStorage.setItem(browserVaultKey, JSON.stringify(next));
    browserVault = next;
    for (const update of args.updates) browserDocuments.delete(update.noteId);
    browserDocuments.set(target.id, { id: target.id, name: target.name, path: target.path, relativePath: target.relativePath, handle: null, stamp: null });
    return {
      note: target,
      rewrittenLinks: args.rewrittenLinks,
      affectedNotes: args.affectedNotes,
      invalidatedIds: args.updates.map(update => update.noteId),
      document: { ...target, text: target.source, hash: await digest(target.source) },
      vault: next,
    };
  }

  if (command === 'moveVaultNote') {
    planVaultMove(vault.notes, args.noteId, args.targetFolder, false);
    const next = structuredClone(vault);
    if (!Array.isArray(next.folders)) next.folders = [];
    const cleanTargetFolder = String(args.targetFolder || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (cleanTargetFolder) {
      const parts = cleanTargetFolder.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        if (!next.folders.some(f => f.toLowerCase() === sub.toLowerCase())) next.folders.push(sub);
      }
    }
    for (const update of args.updates || []) {
      const note = next.notes.find(item => item.id === update.noteId);
      if (!note || note.source !== update.expectedSource) throw new Error('引用笔记已变化，移动未提交。');
      note.source = update.source;
    }
    const target = next.notes.find(note => note.id === args.noteId);
    target.relativePath = args.newRelativePath;
    target.path = 'vault://' + args.newRelativePath;
    localStorage.setItem(browserVaultKey, JSON.stringify(next));
    browserVault = next;
    for (const update of args.updates || []) browserDocuments.delete(update.noteId);
    browserDocuments.set(target.id, { id: target.id, name: target.name, path: target.path, relativePath: target.relativePath, handle: null, stamp: null });
    return {
      note: target,
      rewrittenLinks: args.rewrittenLinks,
      affectedNotes: args.affectedNotes,
      invalidatedIds: (args.updates || []).map(update => update.noteId),
      document: { ...target, text: target.source, hash: await digest(target.source) },
      vault: next,
    };
  }

  if (command === 'moveVaultFolder') {
    planVaultFolderMove(vault.notes, {
      sourceFolder: args.sourceFolder,
      targetFolderPath: args.newFolderPath,
      knownFolders: vault.folders || [],
      autoUpdateLinks: false,
    });
    const next = structuredClone(vault);
    if (!Array.isArray(next.folders)) next.folders = [];
    const srcLower = String(args.sourceFolder || '').toLowerCase();
    const newFolderPath = String(args.newFolderPath || '');
    for (const update of args.updates || []) {
      const note = next.notes.find(item => item.id === update.noteId);
      if (!note || note.source !== update.expectedSource) throw new Error('引用笔记已变化，目录移动未提交。');
      note.source = update.source;
    }
    const invalidatedIds = new Set((args.updates || []).map(u => u.noteId));
    for (const moved of args.movedNotes || []) {
      const note = next.notes.find(item => item.id === moved.noteId || item.relativePath === moved.oldRelativePath);
      if (note) {
        note.relativePath = moved.newRelativePath;
        note.path = 'vault://' + moved.newRelativePath;
        invalidatedIds.add(note.id);
      }
    }
    next.folders = next.folders
      .filter(f => f.toLowerCase() !== srcLower && !f.toLowerCase().startsWith(srcLower + '/'));
    const parts = newFolderPath.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (!next.folders.some(f => f.toLowerCase() === sub.toLowerCase())) next.folders.push(sub);
    }
    for (const mf of args.movedFolders || []) {
      if (mf.newFolder && !next.folders.some(f => f.toLowerCase() === mf.newFolder.toLowerCase())) {
        next.folders.push(mf.newFolder);
      }
    }
    localStorage.setItem(browserVaultKey, JSON.stringify(next));
    browserVault = next;
    let activeTarget = null;
    for (const id of invalidatedIds) {
      if (id === activeDocumentId) {
        activeTarget = next.notes.find(n => n.id === id) || null;
      }
      browserDocuments.delete(id);
    }
    let reopenedDoc = null;
    if (activeTarget) {
      browserDocuments.set(activeTarget.id, {
        id: activeTarget.id,
        name: activeTarget.name,
        path: activeTarget.path,
        relativePath: activeTarget.relativePath,
        handle: null,
        stamp: null,
      });
      reopenedDoc = { ...activeTarget, text: activeTarget.source, hash: await digest(activeTarget.source) };
    }
    return {
      oldFolder: args.sourceFolder,
      newFolder: newFolderPath,
      movedCount: (args.movedNotes || []).length,
      rewrittenLinks: args.rewrittenLinks || 0,
      invalidatedIds: [...invalidatedIds],
      document: reopenedDoc,
      vault: next,
    };
  }

  if (command === 'workspaceList') return [...browserDocuments.values()].map(({ id, name, path }) => ({ id, name, path }));
  if (command === 'activateDocument') { selectDocument(documentId); return true; }
  if (command === 'storeSession') {
    await sessionStorageOperation('write', documentId, args.snapshot);
    return { documentId, revision: args.snapshot.session.revision, persisted: true };
  }
  if (command === 'readSession') return sessionStorageOperation('read', documentId);
  if (command === 'releaseDocument' || command === 'cancelClose') return true;
  if (command === 'closeDocuments') {
    for (const id of args.ids) {
      await sessionStorageOperation('delete', id);
      browserDocuments.delete(id);
      for (const [key, url] of assets) if (key.startsWith(id + ':')) { URL.revokeObjectURL(url); assets.delete(key); }
    }
    return true;
  }
  if (command === 'history') return [];
  if (command === 'open') {
    const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }] });
    const documents = [];
    for (const handle of handles) {
      let existing;
      for (const candidate of browserDocuments.values()) if (candidate.handle && await candidate.handle.isSameEntry(handle)) { existing = candidate; break; }
      if (!existing) {
        const id = crypto.randomUUID().replaceAll('-', '');
        existing = { id, name: handle.name, path: 'browser:' + id + '/' + handle.name, handle, stamp: null };
        browserDocuments.set(id, existing);
      }
      documents.push({ id: existing.id, name: existing.name, path: existing.path });
    }
    return { documents };
  }
  if (command === 'loadDocument') {
    if (!owner) throw new Error('文档已关闭。');
    const vaultNote = vault.notes.find(n => n.id === owner.id || (owner.path && n.path === owner.path));
    if (vaultNote && !owner.handle) {
      const cached = JSON.parse(localStorage.getItem('inkloom.marks.' + owner.id) || 'null');
      return {
        id: owner.id,
        name: vaultNote.name,
        path: vaultNote.path,
        relativePath: vaultNote.relativePath,
        text: vaultNote.source,
        hash: await digest(vaultNote.source),
        annotations: cached,
      };
    }
    if (!owner.handle) return { id: owner.id, name: owner.name, path: null, text: '' };
    const file = await owner.handle.getFile();
    const text = (await file.text()).replace(/\r\n/g, '\n');
    owner.stamp = { modified: file.lastModified, size: file.size };
    const cached = JSON.parse(localStorage.getItem('inkloom.marks.' + owner.id) || 'null');
    return { id: owner.id, name: file.name, path: owner.path, text, hash: await digest(text), annotations: cached };
  }
  if (command === 'new') {
    const id = crypto.randomUUID().replaceAll('-', '');
    browserDocuments.set(id, { id, name: '未命名.md', path: null, handle: null, stamp: null });
    return { id, name: '未命名.md', text: '', placeholder: args.placeholder === true };
  }
  if (command === 'save') {
    if (!owner) throw new Error('文档已关闭。');
    const vaultNote = vault.notes.find(n => n.id === documentId || (owner.path && n.path === owner.path));
    if (vaultNote && !args.saveAs && !owner.handle) {
      const before = vaultNote.source;
      vaultNote.source = args.text;
      try { saveBrowserVault(); } catch (error) { vaultNote.source = before; throw error; }
      const hash = await digest(args.text);
      localStorage.setItem('inkloom.marks.' + owner.id, JSON.stringify({ ...args.annotations, textHash: hash }));
      const syncPayload = {
        eventType: 'note-saved',
        sourceWindowId: browserWindowId,
        payload: {
          noteId: vaultNote.id,
          path: vaultNote.path,
          relativePath: vaultNote.relativePath,
          source: vaultNote.source,
          hash,
        },
      };
      multiWindowChannel?.postMessage({ sourceWindowId: browserWindowId, channelEvent: 'crossWindowSync', payload: syncPayload });
      return { documentId, path: vaultNote.path, name: vaultNote.name, hash };
    }
    const handle = !owner.handle || args.saveAs ? await window.showSaveFilePicker({ suggestedName: args.name || 'Untitled.md', types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] }) : owner.handle;
    for (const candidate of browserDocuments.values()) if (candidate.id !== documentId && candidate.handle && await candidate.handle.isSameEntry(handle)) throw new Error('目标文件已在工作空间打开，请选择其他文件名。');
    if (owner.stamp && !args.saveAs) {
      const file = await handle.getFile();
      if (file.lastModified !== owner.stamp.modified || file.size !== owner.stamp.size) throw new Error('磁盘文件已被其他程序修改，请另存为以保留双方内容。');
    }
    await writeFile(handle, args.text);
    const hash = await digest(args.text);
    localStorage.setItem('inkloom.marks.' + owner.id, JSON.stringify({ ...args.annotations, textHash: hash }));
    const file = await handle.getFile();
    owner.handle = handle; owner.name = handle.name; owner.path = 'browser:' + owner.id + '/' + handle.name;
    owner.stamp = { modified: file.lastModified, size: file.size };
    return { documentId, path: owner.path, name: owner.name, hash };
  }
  if (command === 'importImage') {
    if (!owner) throw new Error('文档已关闭。');
    if (!owner.directoryHandle) owner.directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const folder = await owner.directoryHandle.getDirectoryHandle('.inkloom-assets', { create: true });
    const bytes = Uint8Array.from(atob(args.data), character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: args.mime });
    const name = (await digest(args.data)).slice(0, 20) + '.' + (args.mime === 'image/jpeg' ? 'jpg' : args.mime.split('/')[1]);
    const handle = await folder.getFileHandle(name, { create: true });
    await writeFile(handle, blob);
    const path = '.inkloom-assets/' + name;
    assets.set(documentId + ':' + path, URL.createObjectURL(blob));
    return { path, name: args.name };
  }
  if (command === 'settings') { localStorage.setItem('inkloom.settings', JSON.stringify(args)); return true; }
  if (command === 'readAsset') {
    const url = assetUrl(args.path, documentId);
    if (!url) throw new Error('浏览器预览无法读取此本地图片，请使用桌面版导出。');
    const response = await fetch(url);
    if (!response.ok) throw new Error('图片读取失败。');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { mime: blob.type, data: dataUrl.split(',')[1] };
  }
  if (command === 'export') {
    if (args.format === 'pdf') throw new Error('PDF 导出请使用 Inkloom 桌面版。');
    const mime = args.format === 'html'
      ? 'text/html'
      : args.format === 'epub'
        ? 'application/epub+zip'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = args.format === 'html' ? new Blob([args.html], { type: mime }) : new Blob([Uint8Array.from(atob(args.data), character => character.charCodeAt(0))], { type: mime });
    const name = args.name.replace(/\.(md|markdown|txt)$/i, '') + '.' + args.format;
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: args.format.toUpperCase(), accept: { [mime]: ['.' + args.format] } }] });
      await writeFile(handle, blob);
      return { path: handle.name, format: args.format };
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    return { path: name, format: args.format };
  }
  if (command === 'state' || command === 'draft' || command === 'searchState') return true;
  if (command === 'aiLocalLlmStatus' || command === 'aiStartLocalLlm' || command === 'aiStopLocalLlm') {
    const action = command === 'aiStartLocalLlm' ? 'start' : command === 'aiStopLocalLlm' ? 'stop' : 'status';
    try {
      const resp = await fetch('/__local_llm/' + action, { method: action === 'status' ? 'GET' : 'POST' });
      if (resp.ok) return await resp.json();
    } catch {}
    return { installed: false, running: false, modelName: 'smollm2:135m-instruct-q4_0', modelFile: 'smollm2-135m-instruct-q4_0.gguf', modelBytes: 0, endpoint: 'http://127.0.0.1:11435/v1/chat/completions' };
  }
  if (command === 'aiSecretStatus') {
    const masked = !browserAiSecret ? '' : (browserAiSecret.length <= 8 ? '••••' : browserAiSecret.slice(0, 3) + '••••' + browserAiSecret.slice(-3));
    const localLlm = await browserCall('aiLocalLlmStatus', {});
    return { hasKey: Boolean(browserAiSecret), maskedKey: masked, storage: 'Isolated Session Memory', localLlm };
  }
  if (command === 'aiSaveSecret') {
    if (args.clear) browserAiSecret = '';
    else if (typeof args.apiKey === 'string' && args.apiKey.trim()) {
      const trimmed = args.apiKey.trim();
      if (trimmed.length > 512 || /[\r\n\0]/.test(trimmed)) throw new Error('API 密钥格式无效。');
      browserAiSecret = trimmed;
    }
    const masked = !browserAiSecret ? '' : (browserAiSecret.length <= 8 ? '••••' : browserAiSecret.slice(0, 3) + '••••' + browserAiSecret.slice(-3));
    const localLlm = await browserCall('aiLocalLlmStatus', {});
    return { hasKey: Boolean(browserAiSecret), maskedKey: masked, storage: 'Isolated Session Memory', localLlm };
  }
  if (command === 'aiCompleteHttp') {
    if (args.provider === 'local-gguf') {
      const resp = await fetch('/__local_llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!resp.ok) throw new Error('本地小模型推理响应失败：HTTP ' + resp.status);
      return await resp.json();
    }
    const url = new URL(args.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型接口地址无效或包含内嵌凭据。');
    const headers = { 'Content-Type': 'application/json' };
    if (browserAiSecret) headers.Authorization = 'Bearer ' + browserAiSecret;
    const t0 = performance.now();
    const body = args.provider === 'ollama'
      ? { model: args.model, stream: false, messages: [{ role: 'system', content: args.systemPrompt || '' }, { role: 'user', content: args.userPrompt || '' }] }
      : { model: args.model, temperature: 0.2, max_tokens: 160, messages: [{ role: 'system', content: args.systemPrompt || '' }, { role: 'user', content: args.userPrompt || '' }] };
    const resp = await fetch(url.href, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error('模型服务响应失败：HTTP ' + resp.status);
    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content || data?.message?.content || '';
    return { answer: String(answer), model: args.model, provider: args.provider, latencyMs: Math.round(performance.now() - t0) };
  }
  if (command === 'oneNoteGetHierarchy') {
    return { liveComConnected: false, xml: '', provider: 'OneNote 2016/365 COM XML Schema Channel' };
  }
  if (command === 'oneNoteGetPageContent') {
    return { liveComConnected: false, xml: '' };
  }
  if (command === 'oneNoteSaveBinaryAsset') {
    throw new Error('浏览器预览不能将 OneNote 附件写入本地知识库，请使用 Windows 桌面版。');
  }
  if (command === 'createVaultFolder') {
    const cleaned = String(args.folder || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (!cleaned || cleaned === '根目录') throw new Error('目录名称不能为空。');
    if (cleaned.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))) {
      throw new Error('目录路径包含无效字符或 . / .. 段。');
    }
    if (!Array.isArray(vault.folders)) vault.folders = [];
    const parts = cleaned.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (!vault.folders.some(f => f.toLowerCase() === sub.toLowerCase())) vault.folders.push(sub);
    }
    saveBrowserVault();
    return {
      folder: cleaned,
      vault: { vaultName: vault.vaultName, vaultPath: vault.vaultPath, folders: vault.folders, notes: vault.notes },
    };
  }
  if (command === 'revealVaultItem') {
    const rel = String(args.relativePath || args.path || '').replaceAll('\\', '/').replace(/^vault:\/\//i, '');
    const isFolder = Boolean(args.isFolder);
    const fullPath = `${vault.vaultPath || 'vault://starter-vault'}/${rel}`.replace(/\/+/g, '/');
    return { revealed: true, fullPath, relativePath: rel, isFolder, exists: true };
  }
  if (command === 'deleteVaultItems') {
    const next = structuredClone(vault);
    if (!Array.isArray(next.folders)) next.folders = [];
    for (const update of args.updates || []) {
      const target = next.notes.find(n => n.id === update.noteId || n.relativePath === update.relativePath);
      if (!target || target.source !== update.expectedSource) throw new Error('引用笔记已变化，删除未提交。');
      target.source = update.source;
    }
    const deletedSet = new Set((args.deletedNotes || []).map(d => d.noteId || d.relativePath));
    const invalidatedIds = [];
    next.notes = next.notes.filter(n => {
      const del = deletedSet.has(n.id) || deletedSet.has(n.relativePath);
      if (del) {
        invalidatedIds.push(n.id);
        browserDocuments.delete(n.id);
        localStorage.removeItem('inkloom.marks.' + n.id);
      }
      return !del;
    });
    for (const upd of args.updates || []) {
      invalidatedIds.push(upd.noteId);
      browserDocuments.delete(upd.noteId);
    }
    if (args.mode === 'folder' && args.folderPath) {
      const prefix = String(args.folderPath).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toLowerCase();
      next.folders = next.folders.filter(f => {
        const fl = f.toLowerCase();
        return fl !== prefix && !fl.startsWith(prefix + '/');
      });
    }
    browserVault = next;
    saveBrowserVault();
    const first = next.notes[0] || { id: 'vault-empty', name: '未命名.md', path: null, relativePath: '未命名.md', source: '' };
    const hash = await digest(first.source || '');
    browserDocuments.set(first.id, { id: first.id, name: first.name, path: first.path, relativePath: first.relativePath, handle: null, stamp: null });
    return {
      summary: { deletedCount: (args.deletedNotes || []).length, affectedFileCount: (args.updates || []).length },
      invalidatedIds,
      document: { id: first.id, name: first.name, path: first.path, relativePath: first.relativePath, text: first.source || '', hash },
      vault: { vaultName: next.vaultName, vaultPath: next.vaultPath, folders: next.folders, notes: next.notes },
    };
  }
  if (command === 'external') { window.open(args.url, '_blank', 'noopener,noreferrer'); return true; }
  if (command === 'print') { window.print(); return true; }
  throw new Error('此操作需要 Inkloom 桌面版。');
}

export function call(command, args = {}) {
  args = { documentId: activeDocumentId, ...args };
  if (!desktop) return browserCall(command, args);
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    window.chrome.webview.postMessage({ id, command, args });
  });
}

export function assetUrl(source, documentId = activeDocumentId) {
  if (assets.has(documentId + ':' + source)) return assets.get(documentId + ':' + source);
  if (/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(source)) return source;
  if (/^(https?:|javascript:|data:|\/\/)/i.test(source)) return '';
  if (desktop) return 'https://inkloom-files.local/image?' + new URLSearchParams({ document: documentId || '', path: source.replaceAll('\\', '/') });
  return source.startsWith('/samples/') ? source : '';
}
