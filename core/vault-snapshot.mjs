import { parseFrontMatter, stripNumericPrefix, localDate } from './vault-graph.mjs';
import { buildStoredZipBytes, unpackZipEntries, base64ToUint8Array } from './raw-document-ingestor.mjs';

export function computeSnapshotHash(text = '') {
  const str = String(text ?? '');
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    for (let s = 0; s < 8; s++) {
      let h = seeds[s] ^ ((code + s * 31) & 0xffff);
      h = Math.imul(h, 0x01000193 + (s << 1));
      h ^= h >>> 13;
      seeds[s] = h >>> 0;
    }
  }
  return seeds.map(n => n.toString(16).padStart(8, '0')).join('');
}

function validateRelativeNotePath(relativePath = '') {
  const normalized = String(relativePath || '').replaceAll('\\', '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('快照笔记路径不合法：' + relativePath);
  }
  const segments = normalized.split('/');
  if (segments.some(seg => !seg || seg === '.' || seg === '..')) {
    throw new Error('快照笔记路径包含越界片段：' + relativePath);
  }
  if (!/\.(md|markdown|txt)$/i.test(normalized)) {
    throw new Error('快照仅支持 Markdown 文本笔记：' + relativePath);
  }
  return normalized;
}

export function createVaultSnapshot(notes = [], {
  label = '里程碑快照',
  vaultName = '本地知识库',
  createdAt = new Date().toISOString(),
} = {}) {
  const realNotes = (notes || []).filter(n => n && n.exists !== false && !n.ghost && typeof n.source === 'string');
  const snapshotNotes = [];
  let totalBytes = 0;

  for (const note of realNotes) {
    const relativePath = validateRelativeNotePath(note.relativePath || note.name || `${note.id}.md`);
    const source = note.source;
    const sha256 = computeSnapshotHash(source);
    const bytes = new TextEncoder().encode(source).byteLength;
    totalBytes += bytes;
    const fm = parseFrontMatter(source.replace(/^\uFEFF/, ''));
    snapshotNotes.push({
      id: String(note.id || relativePath),
      relativePath,
      title: String(note.title || fm.metadata?.title || stripNumericPrefix(relativePath.replace(/\.(md|markdown|txt)$/i, ''))),
      sha256,
      bytes,
      source,
    });
  }

  snapshotNotes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
  const manifestInput = snapshotNotes.map(n => `${n.relativePath}:${n.sha256}:${n.bytes}`).join('\n');
  const manifestSha256 = computeSnapshotHash(manifestInput);

  return {
    format: 'inkloom.vault-snapshot',
    version: 1,
    label: String(label || '里程碑快照').trim() || '里程碑快照',
    vaultName: String(vaultName || '本地知识库'),
    createdAt,
    noteCount: snapshotNotes.length,
    totalBytes,
    manifestSha256,
    notes: snapshotNotes,
  };
}

export function verifyVaultSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.format !== 'inkloom.vault-snapshot' || snapshot.version !== 1) {
    throw new Error('无效的知识库快照格式，需为 inkloom.vault-snapshot v1');
  }
  if (!Array.isArray(snapshot.notes)) {
    throw new Error('知识库快照缺少 notes 数组');
  }
  const checked = [];
  for (const item of snapshot.notes) {
    const relativePath = validateRelativeNotePath(item?.relativePath);
    if (typeof item.source !== 'string') {
      throw new Error(`快照笔记《${relativePath}》缺少源码内容`);
    }
    const actualHash = computeSnapshotHash(item.source);
    if (item.sha256 && item.sha256 !== actualHash) {
      throw new Error(`快照笔记《${relativePath}》哈希校验不匹配，内容可能已损坏`);
    }
    checked.push({
      id: String(item.id || relativePath),
      relativePath,
      title: String(item.title || stripNumericPrefix(relativePath.replace(/\.(md|markdown|txt)$/i, ''))),
      sha256: actualHash,
      bytes: new TextEncoder().encode(item.source).byteLength,
      source: item.source,
    });
  }
  checked.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
  const expectedManifest = computeSnapshotHash(checked.map(n => `${n.relativePath}:${n.sha256}:${n.bytes}`).join('\n'));
  if (snapshot.manifestSha256 && snapshot.manifestSha256 !== expectedManifest) {
    throw new Error('知识库快照总清单签名校验失败');
  }
  return {
    ...snapshot,
    manifestSha256: expectedManifest,
    notes: checked,
  };
}

export function diffVaultSnapshot(currentNotes = [], snapshot) {
  const verified = verifyVaultSnapshot(snapshot);
  const realCurrent = (currentNotes || []).filter(n => n && n.exists !== false && !n.ghost && typeof n.source === 'string');

  const byId = new Map();
  const byPath = new Map();
  for (const cur of realCurrent) {
    const normPath = String(cur.relativePath || cur.name || '').replaceAll('\\', '/').trim();
    if (cur.id) byId.set(cur.id, cur);
    if (normPath) byPath.set(normPath.toLocaleLowerCase(), cur);
  }

  const matchedCurrentIds = new Set();
  const items = [];
  let unchangedCount = 0;
  let modifiedCount = 0;
  let missingCount = 0;

  for (const snapNote of verified.notes) {
    const current = byId.get(snapNote.id) || byPath.get(snapNote.relativePath.toLocaleLowerCase()) || null;
    if (!current) {
      missingCount++;
      items.push({
        status: 'restorable-missing',
        id: snapNote.id,
        relativePath: snapNote.relativePath,
        title: snapNote.title,
        snapshotSha256: snapNote.sha256,
        currentSha256: '',
        restorable: true,
        summary: '当前知识库中已缺失，可从快照无损恢复该笔记',
        snapshotSource: snapNote.source,
      });
      continue;
    }

    matchedCurrentIds.add(current.id);
    const currentHash = computeSnapshotHash(current.source);
    if (currentHash === snapNote.sha256 || current.source === snapNote.source) {
      unchangedCount++;
      items.push({
        status: 'unchanged',
        id: current.id,
        relativePath: current.relativePath || snapNote.relativePath,
        title: snapNote.title,
        snapshotSha256: snapNote.sha256,
        currentSha256: currentHash,
        restorable: false,
        summary: '与快照版本完全一致',
        snapshotSource: snapNote.source,
      });
    } else {
      modifiedCount++;
      const snapLines = snapNote.source.split(/\r?\n/).length;
      const curLines = current.source.split(/\r?\n/).length;
      const deltaLines = curLines - snapLines;
      items.push({
        status: 'modified',
        id: current.id,
        relativePath: current.relativePath || snapNote.relativePath,
        title: snapNote.title,
        snapshotSha256: snapNote.sha256,
        currentSha256: currentHash,
        restorable: true,
        summary: `正文已发生变更（快照 ${snapLines} 行 → 当前 ${curLines} 行，行差 ${deltaLines >= 0 ? '+' + deltaLines : deltaLines}），支持回滚至快照版本`,
        snapshotSource: snapNote.source,
      });
    }
  }

  let addedSinceCount = 0;
  for (const cur of realCurrent) {
    if (!matchedCurrentIds.has(cur.id)) {
      addedSinceCount++;
      items.push({
        status: 'added-since-snapshot',
        id: cur.id,
        relativePath: cur.relativePath || cur.name || '',
        title: cur.title || cur.cleanTitle || cur.name || '',
        snapshotSha256: '',
        currentSha256: computeSnapshotHash(cur.source),
        restorable: false,
        summary: '快照创建后新增的笔记，恢复时将安全保留不删除',
        snapshotSource: '',
      });
    }
  }

  return {
    valid: true,
    label: verified.label,
    createdAt: verified.createdAt,
    manifestSha256: verified.manifestSha256,
    summary: {
      totalSnapshotNotes: verified.notes.length,
      unchangedCount,
      modifiedCount,
      missingCount,
      addedSinceCount,
      restorableCount: modifiedCount + missingCount,
    },
    items,
  };
}

/* ============================================================================
 * MAJOR-300 (3.0.0): Portable Vault Archive (.inkloom-vault.zip) with
 * FIPS 180-4 SHA-256 Manifest Signing, Tamper Detection & Lossless Restore
 * ========================================================================== */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function computeSha256HexSync(input) {
  const data = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input || []);
  const bitLenHi = Math.floor((data.byteLength * 8) / 0x100000000) >>> 0;
  const bitLenLo = ((data.byteLength * 8) >>> 0);
  const padLen = ((data.byteLength + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLenHi, false);
  view.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('');
}

function validateSafeArchiveSubpath(subpath = '') {
  const normalized = String(subpath || '').replaceAll('\\', '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('归档相对路径不合法：' + subpath);
  }
  const parts = normalized.split('/');
  if (parts.some(seg => !seg || seg === '.' || seg === '..')) {
    throw new Error('归档相对路径包含非法路径段：' + subpath);
  }
  return normalized;
}

export function compileVaultPortableArchiveBytes(notes = [], {
  vaultName = '本地知识库',
  folders = [],
  rawDocuments = [],
  createdAt = new Date().toISOString(),
  appVersion = '3.0.0',
} = {}) {
  const encoder = new TextEncoder();
  const realNotes = (notes || []).filter(n => n && n.exists !== false && !n.ghost && typeof n.source === 'string');
  const zipMap = {};
  const entries = [];
  const folderSet = new Set(
    (folders || [])
      .map(f => String(f || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').trim())
      .filter(f => f && f !== '根目录' && f !== '待建节点')
  );
  let totalBytes = 0;

  const sortedNotes = [...realNotes].sort((a, b) =>
    String(a.relativePath || a.name || '').localeCompare(String(b.relativePath || b.name || ''), 'zh-CN')
  );

  for (const note of sortedNotes) {
    const relativePath = validateRelativeNotePath(note.relativePath || note.name || `${note.id}.md`);
    if (relativePath.includes('/')) {
      folderSet.add(relativePath.slice(0, relativePath.lastIndexOf('/')));
    }
    const zipEntryPath = `notes/${relativePath}`;
    const noteBytes = encoder.encode(note.source);
    const sha256 = computeSha256HexSync(noteBytes);
    const fm = parseFrontMatter(note.source.replace(/^\uFEFF/, ''));
    zipMap[zipEntryPath] = noteBytes;
    totalBytes += noteBytes.byteLength;
    entries.push({
      kind: 'note',
      zipPath: zipEntryPath,
      relativePath,
      title: String(note.title || fm.metadata?.title || stripNumericPrefix(relativePath.replace(/\.(md|markdown|txt)$/i, ''))),
      bytes: noteBytes.byteLength,
      sha256,
      hasBom: note.source.startsWith('\uFEFF'),
      lineEnding: note.source.includes('\r\n') ? 'CRLF' : 'LF',
    });
  }

  let rawCount = 0;
  for (const rawDoc of rawDocuments || []) {
    const rawRel = validateSafeArchiveSubpath(rawDoc?.relativePath || (rawDoc?.name ? `raw/${rawDoc.name}` : ''));
    const normalizedRawRel = rawRel.startsWith('raw/') ? rawRel : `raw/${rawRel}`;
    let rawBytes = null;
    if (rawDoc?.bytes instanceof Uint8Array) rawBytes = rawDoc.bytes;
    else if (typeof rawDoc?.base64Data === 'string' && rawDoc.base64Data) rawBytes = base64ToUint8Array(rawDoc.base64Data);
    if (!rawBytes || !rawBytes.byteLength) continue;
    const sha256 = computeSha256HexSync(rawBytes);
    zipMap[normalizedRawRel] = rawBytes;
    totalBytes += rawBytes.byteLength;
    rawCount++;
    entries.push({
      kind: 'raw',
      zipPath: normalizedRawRel,
      relativePath: normalizedRawRel,
      title: String(rawDoc?.name || normalizedRawRel.split('/').pop()),
      bytes: rawBytes.byteLength,
      sha256,
    });
  }

  entries.sort((a, b) => a.zipPath.localeCompare(b.zipPath, 'zh-CN'));
  const canonicalLedger = entries.map(e => `${e.kind}|${e.zipPath}|${e.bytes}|${e.sha256}`).join('\n');
  const manifestSha256 = computeSha256HexSync(canonicalLedger);
  const safeVaultName = String(vaultName || '本地知识库').trim() || '本地知识库';

  const manifest = {
    format: 'inkloom.portable-vault-archive',
    version: 1,
    appVersion: String(appVersion || '3.0.0'),
    vaultName: safeVaultName,
    createdAt,
    folders: [...folderSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    noteCount: sortedNotes.length,
    rawCount,
    totalBytes,
    manifestSha256,
    entries,
  };

  const fullFileMap = {
    'vault-manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'README-ARCHIVE.txt': [
      `Inkloom 墨图 · 便携知识库归档包 (v${manifest.appVersion})`,
      `知识库名称：${safeVaultName}`,
      `归档时间：${createdAt}`,
      `收录笔记：${sortedNotes.length} 篇 ｜ 原始附件：${rawCount} 份 ｜ 净字节：${totalBytes} B`,
      `清单签名 (SHA-256)：${manifestSha256}`,
      '',
      '说明：notes/ 目录保留全部原始 Markdown 文件（含多级子目录、UTF-8 BOM 与行尾换行格式），可通过 Inkloom「导入与库管理 → 全库便携归档」执行逐文件 SHA-256 完整性验签与无损差异还原。',
      '',
    ].join('\n'),
    ...zipMap,
  };

  const bytes = buildStoredZipBytes(fullFileMap);
  const safeStem = safeVaultName.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'inkloom-vault';
  const dayStamp = String(createdAt).slice(0, 10) || localDate();

  return {
    bytes,
    fileName: `${safeStem}-${dayStamp}.inkloom-vault.zip`,
    vaultName: safeVaultName,
    noteCount: sortedNotes.length,
    rawCount,
    folderCount: manifest.folders.length,
    totalBytes,
    archiveByteLength: bytes.byteLength,
    manifestSha256,
    manifest,
  };
}

export async function inspectAndVerifyVaultPortableArchive(zipBytes, currentNotes = []) {
  const u8 = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes || []);
  if (u8.byteLength < 22 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
    return {
      valid: false,
      error: '不是有效的 ZIP / .inkloom-vault.zip 归档文件',
      tamperedEntries: [],
      missingEntries: [],
      restorableNotes: [],
    };
  }

  const unpacked = await unpackZipEntries(u8);
  if (!unpacked.has('vault-manifest.json')) {
    return {
      valid: false,
      error: '归档包缺少 vault-manifest.json 签名清单',
      tamperedEntries: [],
      missingEntries: ['vault-manifest.json'],
      restorableNotes: [],
    };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(unpacked.get('vault-manifest.json')));
  } catch {
    return {
      valid: false,
      error: 'vault-manifest.json 格式损坏，无法解析 JSON',
      tamperedEntries: [],
      missingEntries: [],
      restorableNotes: [],
    };
  }

  if (manifest?.format !== 'inkloom.portable-vault-archive' || manifest?.version !== 1 || !Array.isArray(manifest.entries)) {
    return {
      valid: false,
      error: '不支持的归档清单版本（需为 inkloom.portable-vault-archive v1）',
      tamperedEntries: [],
      missingEntries: [],
      restorableNotes: [],
    };
  }

  const missingEntries = [];
  const tamperedEntries = [];
  const verifiedNotes = [];
  const verifiedRaws = [];

  for (const entry of manifest.entries) {
    let safeZipPath;
    try {
      safeZipPath = validateSafeArchiveSubpath(entry?.zipPath);
      if (entry.kind === 'note') validateRelativeNotePath(entry?.relativePath);
      else validateSafeArchiveSubpath(entry?.relativePath);
    } catch (pathErr) {
      tamperedEntries.push({ zipPath: String(entry?.zipPath || ''), reason: pathErr.message });
      continue;
    }

    if (!unpacked.has(safeZipPath)) {
      missingEntries.push(safeZipPath);
      continue;
    }
    const entryBytes = unpacked.get(safeZipPath);
    const actualSha256 = computeSha256HexSync(entryBytes);
    if (actualSha256 !== entry.sha256 || entryBytes.byteLength !== entry.bytes) {
      tamperedEntries.push({
        zipPath: safeZipPath,
        expectedSha256: entry.sha256,
        actualSha256,
        reason: 'SHA-256 哈希或字节长度与清单不一致',
      });
      continue;
    }

    if (entry.kind === 'note') {
      const source = decoder.decode(entryBytes);
      const rel = entry.relativePath;
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const fileName = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
      verifiedNotes.push({
        relativePath: rel,
        folder,
        fileName,
        stem: fileName.replace(/\.(md|markdown|txt)$/i, ''),
        title: entry.title || stripNumericPrefix(fileName),
        bytes: entryBytes.byteLength,
        sha256: actualSha256,
        source,
      });
    } else if (entry.kind === 'raw') {
      verifiedRaws.push({
        relativePath: entry.relativePath,
        bytes: entryBytes,
        byteLength: entryBytes.byteLength,
        sha256: actualSha256,
      });
    }
  }

  const sortedForLedger = [...manifest.entries].sort((a, b) => String(a.zipPath).localeCompare(String(b.zipPath), 'zh-CN'));
  const expectedManifestSha = computeSha256HexSync(
    sortedForLedger.map(e => `${e.kind}|${e.zipPath}|${e.bytes}|${e.sha256}`).join('\n')
  );
  if (manifest.manifestSha256 !== expectedManifestSha) {
    tamperedEntries.push({
      zipPath: 'vault-manifest.json',
      expectedSha256: manifest.manifestSha256,
      actualSha256: expectedManifestSha,
      reason: '总清单签名 manifestSha256 校验不匹配',
    });
  }

  if (missingEntries.length > 0 || tamperedEntries.length > 0) {
    return {
      valid: false,
      error: `完整性校验未通过：缺失 ${missingEntries.length} 项，哈希不匹配/篡改 ${tamperedEntries.length} 项（已安全阻断还原）`,
      manifest,
      missingEntries,
      tamperedEntries,
      restorableNotes: [],
    };
  }

  const currentByPath = new Map();
  for (const cur of currentNotes || []) {
    if (!cur || cur.exists === false || cur.ghost || typeof cur.source !== 'string') continue;
    const norm = String(cur.relativePath || cur.name || '').replaceAll('\\', '/').trim().toLocaleLowerCase();
    if (norm) currentByPath.set(norm, cur);
  }

  const comparisonItems = [];
  const restorableNotes = [];
  let unchangedCount = 0;
  let modifiedCount = 0;
  let missingInVaultCount = 0;
  const seenCurrentPaths = new Set();

  for (const arcNote of verifiedNotes) {
    const key = arcNote.relativePath.toLocaleLowerCase();
    const cur = currentByPath.get(key);
    if (!cur) {
      missingInVaultCount++;
      const item = { ...arcNote, status: 'missing-in-vault', statusLabel: '库内缺失 · 可无损补齐' };
      comparisonItems.push(item);
      restorableNotes.push(item);
      continue;
    }
    seenCurrentPaths.add(key);
    const curSha = computeSha256HexSync(cur.source);
    if (curSha === arcNote.sha256) {
      unchangedCount++;
      comparisonItems.push({ ...arcNote, status: 'unchanged', statusLabel: 'SHA-256 完全一致' });
    } else {
      modifiedCount++;
      const item = { ...arcNote, currentNoteId: cur.id, status: 'modified', statusLabel: '内容存在差异 · 可还原覆盖' };
      comparisonItems.push(item);
      restorableNotes.push(item);
    }
  }

  let addedInVaultCount = 0;
  for (const [key, cur] of currentByPath.entries()) {
    if (!seenCurrentPaths.has(key)) {
      addedInVaultCount++;
      comparisonItems.push({
        relativePath: String(cur.relativePath || cur.name || '').replaceAll('\\', '/'),
        title: cur.title || cur.cleanTitle || cur.name || '',
        bytes: new TextEncoder().encode(cur.source).byteLength,
        sha256: computeSha256HexSync(cur.source),
        status: 'added-in-vault',
        statusLabel: '当前库独有新笔记（保留不删）',
      });
    }
  }

  return {
    valid: true,
    manifest,
    manifestSha256: manifest.manifestSha256,
    verifiedEntryCount: verifiedNotes.length + verifiedRaws.length,
    verifiedNoteCount: verifiedNotes.length,
    verifiedRawCount: verifiedRaws.length,
    unchangedCount,
    modifiedCount,
    missingInVaultCount,
    addedInVaultCount,
    restorableCount: restorableNotes.length,
    comparisonItems,
    restorableNotes,
    verifiedRaws,
  };
}
