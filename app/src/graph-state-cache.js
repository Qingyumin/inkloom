import { validGraphState } from '../../core/graph-state.mjs';

let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    let expired = false;
    const timeout = setTimeout(() => { expired = true; opening = null; reject(new Error('Graph layout cache timed out')); }, 2000);
    const request = indexedDB.open('inkloom.graph-layout.v1', 2);
    request.onupgradeneeded = () => { const store = request.result.objectStoreNames.contains('layouts') ? request.transaction.objectStore('layouts') : request.result.createObjectStore('layouts'); if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt'); };
    request.onerror = () => { clearTimeout(timeout); opening = null; reject(request.error); };
    request.onsuccess = () => { clearTimeout(timeout); if (expired) { request.result.close(); return; } request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
  });
  return opening;
}

export async function loadGraphState(key) {
  try {
    const store = await database();
    const value = await new Promise((resolve, reject) => { const transaction = store.transaction('layouts'); const request = transaction.objectStore('layouts').get(key); transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); });
    return validGraphState(value?.state) ? value.state : null;
  } catch { return null; }
}

export async function saveGraphState(key, state) {
  if (!validGraphState(state)) return false;
  try {
    const store = await database();
    await new Promise((resolve, reject) => {
      const transaction = store.transaction('layouts', 'readwrite'); const records = transaction.objectStore('layouts');
      records.put({ key, savedAt: Date.now(), state }, key);
      const request = records.index('savedAt').openKeyCursor(null, 'prev'); let seen = 0;
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (++seen > 20) records.delete(cursor.primaryKey); cursor.continue(); };
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch { return false; }
}