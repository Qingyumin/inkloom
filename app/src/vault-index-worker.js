import { expose } from 'comlink';
import { IndexSynchronizationService } from '../../core/index-service.mjs';
import { encodeCachedNote, decodeCachedNote } from '../../core/index-cache.mjs';

let database;
let schemaWarning = '';

function openCache() {
  if (database) return database;
  let blocked = false; let blockedTimer;
  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('inkloom.index.v1');
    request.onupgradeneeded = () => request.result.createObjectStore('notes');
    request.onsuccess = () => {
      clearTimeout(blockedTimer);
      if (blocked) { request.result.close(); return; }
      const connection = request.result;
      const valid = connection.objectStoreNames.contains('notes') && connection.transaction('notes').objectStore('notes').keyPath === null;
      if (!valid) {
        const version = connection.version + 1; connection.close();
        const repair = indexedDB.open('inkloom.index.v1', version);
        repair.onupgradeneeded = () => { if (repair.result.objectStoreNames.contains('notes')) repair.result.deleteObjectStore('notes'); repair.result.createObjectStore('notes'); };
        repair.onblocked = () => { clearTimeout(blockedTimer); blockedTimer = setTimeout(() => { blocked = true; reject(new Error('索引缓存结构修复被其他页面占用，请关闭其他窗口后刷新')); }, 2000); };
        repair.onerror = () => { clearTimeout(blockedTimer); reject(repair.error); };
        repair.onsuccess = () => {
          clearTimeout(blockedTimer);
          if (blocked) { repair.result.close(); return; }
          schemaWarning = '索引缓存结构已修复并从原文重建';
          repair.result.onversionchange = () => { repair.result.close(); if (database === opening) database = null; };
          resolve(repair.result);
        };
      } else {
        connection.onversionchange = () => { connection.close(); if (database === opening) database = null; };
        resolve(connection);
      }
    };
    request.onerror = () => { clearTimeout(blockedTimer); reject(request.error); };
    request.onblocked = () => { clearTimeout(blockedTimer); blockedTimer = setTimeout(() => { blocked = true; reject(new Error('缓存数据库被其他页面占用')); }, 2000); };
  });
  database = opening; opening.catch(() => { if (database === opening) database = null; });
  return opening;
}

async function readCache(scopeId, { reset = false } = {}) {
  const connection = await openCache();
  const stored = await new Promise((resolve, reject) => {
    const transaction = connection.transaction('notes', reset ? 'readwrite' : 'readonly'); const records = new Map();
    const range = IDBKeyRange.bound([scopeId, ''], [scopeId, '\uffff']);
    if (reset) transaction.objectStore('notes').delete(range);
    else {
      const store = transaction.objectStore('notes');
      const readBatch = keyRange => {
        const keysRequest = store.getAllKeys(keyRange, 256); const valuesRequest = store.getAll(keyRange, 256);
        let keys; let values;
        const collect = () => {
          if (!keys || !values) return;
          for (let offset = 0; offset < keys.length; offset++) records.set(keys[offset][1], values[offset]);
          if (keys.length === 256) readBatch(IDBKeyRange.bound(keys[keys.length - 1], [scopeId, '\uffff'], true));
        };
        keysRequest.onsuccess = () => { keys = keysRequest.result; collect(); };
        valuesRequest.onsuccess = () => { values = valuesRequest.result; collect(); };
      };
      readBatch(range);
    }
    transaction.oncomplete = () => resolve(records);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('缓存读取已取消'));
  });
  const records = new Map(); const entries = [...stored]; let invalid = 0;
  for (let offset = 0; offset < entries.length; offset += 32) {
    const decoded = await Promise.all(entries.slice(offset, offset + 32).map(async ([id, envelope]) => [id, await decodeCachedNote(envelope, id)]));
    for (const [id, note] of decoded) { records.set(id, note); if (!note) invalid++; }
  }
  const warning = [schemaWarning, invalid ? `${invalid} 条旧版或损坏缓存已忽略` : ''].filter(Boolean).join('；'); schemaWarning = '';
  return { records, warning };
}

async function writeCache(scopeId, updated, removed) {
  const records = await Promise.all([...updated].map(async ([id, note]) => [id, await encodeCachedNote(note)]));
  const connection = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('notes', 'readwrite'); const store = transaction.objectStore('notes');
    for (const id of removed) store.delete([scopeId, id]);
    for (const [id, envelope] of records) store.put(envelope, [scopeId, id]);
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('Index cache write aborted'));
  });
}

const service = new IndexSynchronizationService({ cache: { load: readCache, save: writeCache } });
expose({ update: request => service.update(request), cancel: () => service.cancel(), query: request => service.query(request), cancelQuery: id => service.cancelQuery(id) });