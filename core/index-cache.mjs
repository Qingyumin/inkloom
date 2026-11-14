export async function cacheChecksum(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encodeCachedNote(note) {
  const data = JSON.stringify(note);
  return { format: 2, data, checksum: await cacheChecksum(data) };
}

export async function decodeCachedNote(envelope, id) {
  if (!envelope || envelope.format !== 2 || typeof envelope.data !== 'string' || typeof envelope.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.checksum)) return null;
  if (await cacheChecksum(envelope.data) !== envelope.checksum) return null;
  try {
    const note = JSON.parse(envelope.data);
    return note?.id === id && typeof note.source === 'string' ? note : null;
  } catch { return null; }
}