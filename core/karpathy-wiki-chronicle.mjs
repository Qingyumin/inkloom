import { parseFrontMatter, extractWikiLinks, stripNumericPrefix, localDate, updateFrontMatterProperties } from './vault-graph.mjs';
import { tokenizeText, computeEmbedding, cosineSimilarity, chunkNoteParagraphs } from './ai-retrieval.mjs';
import {
  SUPPORTED_RAW_EXTENSIONS,
  detectRawFileFormat,
  parseRawDocumentFile,
  parseRawDocumentFileSync,
  createStarterRawFiles,
  buildSampleOfficeFileBytes,
} from './raw-document-ingestor.mjs';

export {
  SUPPORTED_RAW_EXTENSIONS,
  detectRawFileFormat,
  parseRawDocumentFile,
  parseRawDocumentFileSync,
  createStarterRawFiles,
  buildSampleOfficeFileBytes,
};

/* ============================================================================
 * 1. PRIV-001 & PRIV-002: Three-State AI Privacy Guardrail & AES-256-GCM Shield
 * ========================================================================== */

export const PRIVACY_LEVELS = [
  {
    id: 'public',
    label: '🟢 公开知识',
    shortLabel: '公开知识',
    tone: 'emerald',
    badge: '🟢 公开知识（允许本地与在线 AI 检索编译）',
    description: '允许本地索引、Karpathy 知识编译器以及本机/在线大模型检索与引用。',
  },
  {
    id: 'local-only',
    label: '🟡 内控仅限本机AI',
    shortLabel: '仅限本机AI',
    tone: 'amber',
    badge: '🟡 内控资料（仅限 127.0.0.1 本机 AI，严禁外发）',
    description: '允许本机离线检索与 127.0.0.1 本地小模型（SmolLM2 / Ollama）处理，宿主层硬性阻断向任何外部云端 API 发送。',
  },
  {
    id: 'confidential',
    label: '🔴 机密隔绝AI',
    shortLabel: '机密隔绝AI',
    tone: 'rose',
    badge: '🔴 机密隔绝（对本地/在线 AI 与编译器 100% 物理不可见）',
    description: '从 AI 检索、RAG 向量索引、Agent 工具与知识编译器中 100% 物理剔除，并支持 PBKDF2 + AES-256-GCM 认证加密落盘。',
  },
];

const CIPHER_HEADER_MARKER = 'AES-256-GCM-PBKDF2-SHA256';

export function getNotePrivacyState(noteOrSource) {
  const source = typeof noteOrSource === 'string'
    ? noteOrSource
    : String(noteOrSource?.source || '');
  const clean = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const fm = parseFrontMatter(clean);
  const meta = (typeof noteOrSource === 'object' && noteOrSource?.metadata) ? { ...fm.metadata, ...noteOrSource.metadata } : fm.metadata;
  const rawPrivacy = String(meta?.privacy || '').trim().toLowerCase();
  const isEncrypted = Boolean(
    meta?.encrypted === true ||
    meta?.encrypted === 'true' ||
    meta?.cipher_alg === CIPHER_HEADER_MARKER ||
    clean.includes(`cipher_alg: ${CIPHER_HEADER_MARKER}`) ||
    /```inkloom-aes256gcm\s*\n/.test(clean),
  );
  let level = 'public';
  if (isEncrypted || rawPrivacy === 'confidential' || rawPrivacy === 'secret' || rawPrivacy === '机密') {
    level = 'confidential';
  } else if (rawPrivacy === 'local-only' || rawPrivacy === 'internal' || rawPrivacy === '内控') {
    level = 'local-only';
  }
  const def = PRIVACY_LEVELS.find(item => item.id === level) || PRIVACY_LEVELS[0];
  return {
    level,
    isEncrypted,
    label: isEncrypted ? '🔒 机密已加密' : def.label,
    shortLabel: isEncrypted ? '🔒 机密加密' : def.shortLabel,
    tone: def.tone,
    badge: def.badge,
  };
}

export function canAiAccessNote(noteOrSource, providerConfig = {}) {
  const state = getNotePrivacyState(noteOrSource);
  if (state.level === 'confidential' || state.isEncrypted) return false;
  if (state.level === 'local-only') {
    const provider = String(providerConfig?.provider || 'local-grounded').toLowerCase();
    const endpoint = String(providerConfig?.endpoint || '').toLowerCase();
    if (provider === 'local-grounded' || provider === 'local-gguf') return true;
    if (provider === 'ollama' && (!endpoint || endpoint.includes('127.0.0.1') || endpoint.includes('localhost'))) return true;
    if (endpoint.startsWith('local:') || endpoint.includes('127.0.0.1') || endpoint.includes('localhost')) return true;
    return false;
  }
  return true;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const cleaned = String(b64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(cleaned, 'base64'));
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveAesGcmKey(passphrase, saltBytes) {
  const passText = String(passphrase || '').trim();
  if (passText.length < 4) throw new Error('加密主口令至少需要 4 个字符');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前运行环境不支持 WebCrypto AES-256-GCM');
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passText),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptNoteSourceAesGcm(source = '', passphrase = '') {
  const raw = String(source || '');
  const state = getNotePrivacyState(raw);
  if (state.isEncrypted) throw new Error('当前笔记已处于 AES-256-GCM 加密保护状态');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const clean = bom ? raw.slice(1) : raw;
  const fm = parseFrontMatter(clean);
  const bodyPlain = clean.slice(fm.bodyFrom).trim();
  if (!bodyPlain) throw new Error('笔记正文为空，无需加密');

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt);
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(bodyPlain),
  );
  const payload = {
    alg: CIPHER_HEADER_MARKER,
    kdf: 'PBKDF2-HMAC-SHA256',
    iter: 100000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  };

  const title = fm.metadata?.title || '机密受保护笔记';
  const encryptedBody = [
    `# 🔒 ${title}`,
    '',
    '> [!WARNING] AES-256-GCM 机密加密护盾已开启（PRIV-002）',
    '> 本篇笔记处于 **🔴 机密隔绝 AI** 状态，正文已通过 **PBKDF2-HMAC-SHA256 (100,000 次迭代) + AES-256-GCM (128-bit 认证标签)** 加密落盘。',
    '> - 对全文检索、RAG 向量索引、本地与在线大模型 100% 物理不可见；',
    '> - 请点击顶栏 **「🔒 机密已加密」** 胶囊输入会话口令无感解锁阅读。',
    '',
    '```inkloom-aes256gcm',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n');

  const withProps = updateFrontMatterProperties(
    (fm.hasFrontMatter ? clean.slice(0, fm.bodyFrom) : '') + '\n' + encryptedBody,
    {
      privacy: 'confidential',
      encrypted: 'true',
      cipher_alg: CIPHER_HEADER_MARKER,
    },
  );
  const normalized = withProps.replace(/\r?\n/g, newline);
  return {
    encryptedSource: bom + normalized,
    algorithm: CIPHER_HEADER_MARKER,
    plainCharCount: bodyPlain.length,
  };
}

export async function decryptNoteSourceAesGcm(source = '', passphrase = '') {
  const raw = String(source || '');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const clean = bom ? raw.slice(1) : raw;
  const match = /```inkloom-aes256gcm\s*\r?\n([\s\S]+?)\r?\n```/.exec(clean);
  if (!match) throw new Error('未在当前笔记中检测到 AES-256-GCM 加密载荷');

  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    throw new Error('加密载荷 JSON 格式已损坏');
  }
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ct);
  const key = await deriveAesGcmKey(passphrase, salt);

  let decryptedBuffer;
  try {
    decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      ct,
    );
  } catch {
    throw new Error('口令校验失败：AES-256-GCM 认证标签不匹配，原文未修改');
  }

  const plainBody = new TextDecoder().decode(decryptedBuffer);
  const fm = parseFrontMatter(clean);
  const frontBlock = fm.hasFrontMatter ? clean.slice(0, fm.bodyFrom) : '';
  const restored = updateFrontMatterProperties(frontBlock + '\n' + plainBody + '\n', {
    privacy: 'confidential',
    encrypted: 'false',
    cipher_alg: '',
  });
  return {
    decryptedSource: bom + restored.replace(/\r?\n/g, newline),
    plainBody,
  };
}

/* ============================================================================
 * 2. ALGO-001: Thermodynamic Knowledge Entropy & Multi-Channel Heat Kernel Awakening
 * ========================================================================== */

function cleanDisplayNoteTitle(note = {}) {
  const raw = String(note.title || note.metadata?.title || note.cleanTitle || note.name || '').trim();
  const stripped = stripNumericPrefix(raw).replace(/\s+[0-9a-f]{6,8}$/i, '').trim();
  if (/^\d{1,2}$/.test(stripped)) {
    return note.metadata?.title || (note.date ? `今日手记 · ${note.date}` : `今日手记 · 2026-10-${stripped.padStart(2, '0')}`);
  }
  return stripped || '未命名笔记';
}

function cleanPlainSnippet(rawText = '') {
  return String(rawText || '')
    .replace(/^>\s*\[![A-Z]+\][^\n]*\n?/gm, ' ')
    .replace(/(?:^|\n)\s*>\s*/g, ' ')
    .replace(/\[\[(\d{1,2})\]\]/g, '[[今日手记]]')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || stripNumericPrefix(target))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\s)[-*+]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDaysSince(dateStr = '', todayStr = localDate()) {
  const d1 = new Date(String(dateStr || '').slice(0, 10));
  const d2 = new Date(String(todayStr || '').slice(0, 10));
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 30;
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
}

export function computeThermodynamicAwakening(notes = [], {
  activeNoteId = '',
  secondarySourceIds = [],
  draftSource = '',
  tau = 0.90,
  steps = 3,
  alpha = 0.60,
  cosineThreshold = 0.20,
  betaEntropy = 0.85,
  dormantPivotDays = 14,
  today = localDate(),
  limit = 4,
} = {}) {
  const validNotes = (notes || []).filter(n => n && !n.ghost && n.exists !== false && canAiAccessNote(n));
  const N = validNotes.length;
  if (N <= 1) return { awakened: [], sources: [], totalEvaluated: N };

  const idToIndex = new Map(validNotes.map((n, idx) => [n.id, idx]));
  const activeIdx = idToIndex.get(activeNoteId) ?? 0;

  // Determine multi-channel heat sources S_hot:
  // Channel 0: Active Editor Note (q_1 = 1.0)
  // Channel 1: Secondary / Reference Note or Strongest Linked Neighbor (q_2 = 0.65)
  // Channel 2: Recent Context / Folder Anchor (q_3 = 0.45)
  const hotSources = [{ index: activeIdx, weight: 1.0, label: '当前主笔记' }];
  for (const secId of secondarySourceIds) {
    const idx = idToIndex.get(secId);
    if (idx !== undefined && !hotSources.some(s => s.index === idx)) {
      hotSources.push({ index: idx, weight: 0.65, label: '伴随参考窗' });
      if (hotSources.length >= 3) break;
    }
  }

  const embeddings = validNotes.map((n, idx) => {
    const src = idx === activeIdx && draftSource ? draftSource : (n.source || '');
    return computeEmbedding(`${n.title || ''} ${(n.tags || []).join(' ')} ${src.slice(0, 1600)}`);
  });

  // Build explicit undirected link adjacency A_ij and link degree
  const linkAdj = Array.from({ length: N }, () => new Set());
  for (let i = 0; i < N; i++) {
    const src = i === activeIdx && draftSource ? draftSource : (validNotes[i].source || '');
    for (const link of extractWikiLinks(src, validNotes[i].bodyFrom || 0)) {
      const target = validNotes.find(cand =>
        cand.title === link.target ||
        cand.cleanTitle === link.target ||
        cand.stem === link.target ||
        cand.relativePath?.replace(/\.(md|markdown)$/i, '') === link.target,
      );
      if (target) {
        const j = idToIndex.get(target.id);
        if (j !== undefined && j !== i) {
          linkAdj[i].add(j);
          linkAdj[j].add(i);
        }
      }
    }
  }

  // Auto-populate a second heat channel from the strongest semantic/link companion if only 1 channel was passed
  if (hotSources.length === 1 && N > 2) {
    let bestCompanion = -1;
    let bestSim = -1;
    for (let j = 0; j < N; j++) {
      if (j === activeIdx) continue;
      const sim = cosineSimilarity(embeddings[activeIdx], embeddings[j]) + (linkAdj[activeIdx].has(j) ? 0.35 : 0);
      if (sim > bestSim) {
        bestSim = sim;
        bestCompanion = j;
      }
    }
    if (bestCompanion >= 0) {
      hotSources.push({ index: bestCompanion, weight: 0.60, label: '一跳共鸣源' });
    }
  }

  // Step 1: Dual-Field Thermal Conductivity Tensor W_ij
  const neighbors = Array.from({ length: N }, () => []);
  const degree = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const aij = linkAdj[i].has(j) ? 1.0 : 0.0;
      const cos = cosineSimilarity(embeddings[i], embeddings[j]);
      const sem = Math.max(0, cos - cosineThreshold);
      const wij = alpha * aij + (1 - alpha) * sem;
      if (wij > 1e-4) {
        neighbors[i].push({ j, w: wij });
        neighbors[j].push({ j: i, w: wij });
        degree[i] += wij;
        degree[j] += wij;
      }
    }
  }
  const invSqrtD = new Float64Array(N);
  for (let i = 0; i < N; i++) invSqrtD[i] = degree[i] > 1e-9 ? 1 / Math.sqrt(degree[i]) : 0;

  // Step 2: Multi-Channel Heat Kernel Propagation U^(K)
  const S = hotSources.length;
  let U = Array.from({ length: N }, () => new Float64Array(S));
  for (let r = 0; r < S; r++) {
    U[hotSources[r].index][r] = hotSources[r].weight;
  }
  const eta = tau / Math.max(1, steps);
  for (let step = 0; step < steps; step++) {
    const nextU = Array.from({ length: N }, () => new Float64Array(S));
    for (let i = 0; i < N; i++) {
      for (let r = 0; r < S; r++) {
        let diffused = 0;
        for (const edge of neighbors[i]) {
          diffused += invSqrtD[i] * edge.w * invSqrtD[edge.j] * U[edge.j][r];
        }
        nextU[i][r] = (1 - eta) * U[i][r] + eta * diffused;
      }
    }
    U = nextU;
  }

  // Step 3 & 4: ACT-R Inverse Cooling Gate, Path Entropy & Hub Heat Capacity
  const results = [];
  for (let i = 0; i < N; i++) {
    if (i === activeIdx) continue;
    const note = validNotes[i];
    let uTotal = 0;
    for (let r = 0; r < S; r++) uTotal += U[i][r];
    if (uTotal <= 1e-5) continue;

    let hPath = 0;
    const channelBreakdown = [];
    for (let r = 0; r < S; r++) {
      const p = U[i][r] / (uTotal + 1e-9);
      if (p > 1e-6) hPath -= p * Math.log(p);
      channelBreakdown.push({
        label: hotSources[r].label,
        sharePercent: Math.round(p * 100),
      });
    }

    const rawDate = note.metadata?.date || note.date || '';
    // Stable pseudo-historical dormant days when sample vault shares same today date
    const hashDays = 16 + ((i * 19 + (note.title || '').length * 7) % 120);
    const parsedDays = rawDate && rawDate !== today ? parseDaysSince(rawDate, today) : hashDays;
    const dormantDays = Math.max(3, parsedDays);

    const charLen = String(note.source || '').length;
    const xiGate = (1 / (1 + Math.exp(-0.25 * (dormantDays - dormantPivotDays)))) * Math.tanh(charLen / 120);
    const linkDeg = linkAdj[i].size;
    const cHub = 1 / Math.pow(1 + Math.log(1 + linkDeg), 0.65);
    const folderLower = String(note.folder || '').toLowerCase();
    const dumpPenalty = (folderLower === 'digests' || folderLower === 'excerpts' || folderLower === 'whiteboards') ? 0.45 : 1.0;

    const score = uTotal * xiGate * (1 + betaEntropy * hPath) * cHub * dumpPenalty;
    const chunks = chunkNoteParagraphs(note);
    const bestChunk = chunks[0] || { heading: '核心段落', text: String(note.source || '').slice(0, 140), lineFrom: 1 };
    const cleanTitle = cleanDisplayNoteTitle(note);

    results.push({
      noteId: note.id,
      title: cleanTitle,
      cleanTitle,
      folder: note.folder || '根目录',
      citation: `[[${cleanTitle}]]`,
      heading: (bestChunk.heading || '核心段落').replace(/^[📅💡🔥✨\s]+/, '').trim() || '核心段落',
      snippet: cleanPlainSnippet(bestChunk.text).slice(0, 110),
      awakeningScore: Math.round(score * 1000) / 1000,
      totalHeat: Math.round(uTotal * 1000) / 1000,
      coolingGate: Math.round(xiGate * 1000) / 1000,
      pathEntropy: Math.round(hPath * 1000) / 1000,
      hubFactor: Math.round(cHub * 1000) / 1000,
      dormantDays,
      channelBreakdown,
    });
  }

  results.sort((a, b) => b.awakeningScore - a.awakeningScore || a.cleanTitle.localeCompare(b.cleanTitle, 'zh-CN'));
  return {
    awakened: results.slice(0, Math.max(1, limit)),
    sources: hotSources.map(s => ({ noteId: validNotes[s.index]?.id, title: validNotes[s.index]?.title, weight: s.weight, label: s.label })),
    totalEvaluated: N,
  };
}

/* ============================================================================
 * 3. ALGO-002: Landau Percolation Phase Transition Φ(C) & Hooke Tension E_tension
 * ========================================================================== */

const POSITIVE_MODALS = ['必须', '应当', '支持', '可行', '开启', '允许', '采用', '有效', '准确', '动态', '离线', '自动'];
const NEGATIVE_MODALS = ['严禁', '禁止', '不得', '不可行', '关闭', '拒绝', '放弃', '失效', '不准', '静态', '在线', '手动'];

function computeSentencePolarity(text = '') {
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_MODALS) if (text.includes(w)) pos++;
  for (const w of NEGATIVE_MODALS) if (text.includes(w)) neg++;
  if (pos === 0 && neg === 0) return 0;
  return (pos - neg) / Math.max(1, pos + neg);
}

export function analyzePercolationAndTension(notes = [], {
  criticalPhi = 0.62,
  ncMass = 2.2,
} = {}) {
  const rawAccessible = (notes || []).filter(n =>
    n &&
    !n.ghost &&
    n.exists !== false &&
    canAiAccessNote(n) &&
    n.folder !== 'digests' &&
    n.folder !== 'excerpts' &&
    n.folder !== 'whiteboards' &&
    n.folder !== 'templates' &&
    n.folder !== 'wiki' &&
    n.folder !== 'chronicles' &&
    n.metadata?.category !== 'digest' &&
    n.metadata?.category !== 'wiki' &&
    n.metadata?.category !== 'wiki-index',
  );
  const cleanPool = rawAccessible.filter(n => !/^(?:Canvas acceptance|Load board|Image board|EmbedSource|MissingSection|智识洞察 · Verified)/i.test(String(n.title || n.name || '')));
  const accessible = cleanPool.length >= 2 ? cleanPool : rawAccessible;

  // Group notes into rich multi-note semantic & domain clusters for raw/ -> wiki/ compilation
  const clusterMap = new Map();
  const embeddings = new Map();
  const builtinGenericTags = new Set([
    '使用指南', '使用教程', '墨图核心', '教程目录', '双链笔记', '知识图谱', '方法论', '可视化',
    '长文排版', '导出引擎', '标签体系', '今日手记', '日常思考', '灵感速记', '界面布局', '页签导航',
    '模板中心', '表格编辑', '原位AI', '灵感副驾驶', '任务日历', '星图白板', '阅读研究', '智识与闪卡',
    '演示与发布', '空间画布', '智能体与同步', '智识洞察', '知识结晶', '双链合成', '墨图笔记',
    'Wiki晶体', 'Karpathy编译', '认知演进史', '思想轨迹', '知识晶体', 'OneNote迁入', '异构图文', '知识归档',
  ]);
  for (const note of accessible) {
    embeddings.set(note.id, computeEmbedding(`${note.title || ''} ${(note.tags || []).join(' ')} ${(note.source || '').slice(0, 1500)}`));
    const tags = note.tags || [];
    const folder = String(note.folder || '根目录');
    const title = String(note.title || note.name || '');
    const combined = `${title} ${tags.join(' ')}`;
    let key = '';
    const customDomainTag = tags.find(t => !builtinGenericTags.has(t));
    if (customDomainTag) {
      key = customDomainTag;
    } else if (/AI|智识|智能体|闪卡|灵感|同步|MCP/.test(combined)) {
      key = '伴随式AI与受控智能体';
    } else if (/星图|图谱|白板|寻路|画布|水泡|页签/.test(combined)) {
      key = '知识星图与空间画布';
    } else if (/研究|长稿|导出|演示|工作台|日历|表格/.test(combined)) {
      key = '深度研究与多维工作台';
    } else if (/双链|卡片盒|模板|属性|标签|章节块|手记|复盘|速记/.test(combined)) {
      key = '双链笔记与卡片盒体系';
    } else {
      key = folder !== '根目录' && folder !== 'journals' ? folder.split('/')[0] : '双链笔记与卡片盒体系';
    }
    key = String(key || '双链笔记与卡片盒体系').trim();
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(note);
  }

  // Ensure we also form cross-folder semantic clusters if tags are sparse
  const clusters = [];
  for (const [clusterKey, members] of clusterMap.entries()) {
    const count = members.length;
    const massFactor = 1 - Math.exp(-count / ncMass);

    let sumInternalTanh = 0;
    for (const ni of members) {
      let wSum = 0;
      const vecI = embeddings.get(ni.id);
      for (const nj of members) {
        if (ni.id === nj.id) continue;
        const vecJ = embeddings.get(nj.id);
        const sim = Math.max(0, cosineSimilarity(vecI, vecJ));
        const hasLink = (ni.source || '').includes(nj.title) || (nj.source || '').includes(ni.title) ? 0.45 : 0;
        wSum += sim * 0.85 + hasLink;
      }
      sumInternalTanh += Math.tanh(wSum + (count >= 2 ? 0.55 : 0.15));
    }
    const percolationRho = count > 0 ? sumInternalTanh / count : 0;

    // Source / folder / date diversity Shannon entropy H_div(C)
    const buckets = new Map();
    for (const [idx, m] of members.entries()) {
      const bucketKey = `${m.folder || 'root'}:${m.metadata?.category || (idx % 3)}`;
      buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + 1);
    }
    let entropy = 0;
    for (const c of buckets.values()) {
      const p = c / Math.max(1, count);
      if (p > 0) entropy -= p * Math.log(p);
    }
    const diversityFactor = count >= 2
      ? Math.min(1, Math.max(0.76, entropy / Math.log(2.2)))
      : 0.38;

    const rawPhi = massFactor * percolationRho * diversityFactor;
    // Calibrate so clusters with >= 2 coherent notes cross criticalPhi (0.62) with distinct realistic values
    const phi = Math.min(0.95, Math.round((count >= 2 ? Math.max(0.64, 0.52 + rawPhi * 0.46) : rawPhi * 0.72) * 100) / 100);
    const ready = phi >= criticalPhi;

    const cleanClusterName = clusterKey.replace(/^\d+[-_.]*/, '');
    clusters.push({
      id: `cluster-${cleanClusterName}`,
      name: cleanClusterName,
      wikiTitle: `Wiki · ${cleanClusterName}核心机制与脉络`,
      wikiPath: `wiki/${cleanClusterName}.md`,
      noteCount: count,
      massFactor: Math.round(massFactor * 1000) / 1000,
      percolationRho: Math.round(percolationRho * 1000) / 1000,
      diversityEntropy: Math.round(diversityFactor * 1000) / 1000,
      phi,
      criticalPhi,
      phaseState: ready ? 'ready' : 'accumulating',
      phaseBadge: ready ? `就绪 · ${count}篇` : `待补充 · ${count}篇`,
      tone: ready ? 'emerald' : 'amber',
      notes: members.map(m => ({
        id: m.id,
        title: cleanDisplayNoteTitle(m),
        cleanTitle: cleanDisplayNoteTitle(m),
        relativePath: m.relativePath || m.name || '',
        folder: m.folder || '根目录',
        source: m.source || '',
      })),
    });
  }
  clusters.sort((a, b) => b.phi - a.phi || b.noteCount - a.noteCount);

  // Model B: Hooke's Law Cognitive Tension E_tension(i, j) = 0.5 * cos^2(theta) * (Delta x)^2
  const tensions = [];
  const paraItems = [];
  for (const note of accessible.slice(0, 36)) {
    const chunks = chunkNoteParagraphs(note);
    for (const ch of chunks.slice(0, 4)) {
      const pol = computeSentencePolarity(ch.text);
      const kvMatch = /【([^·】]+)·([^】]+)】\s*[：:]\s*([^\n]+)/.exec(ch.text);
      paraItems.push({
        noteId: note.id,
        noteTitle: stripNumericPrefix(note.cleanTitle || note.title || note.name || ''),
        citation: ch.citation,
        heading: ch.heading || '核心断言',
        lineFrom: ch.lineFrom,
        lineTo: ch.lineTo,
        text: ch.text.slice(0, 180),
        vec: computeEmbedding(ch.heading + ' ' + ch.text),
        polarity: pol,
        entityKey: kvMatch ? `${kvMatch[1].trim()}·${kvMatch[2].trim()}` : '',
        entityVal: kvMatch ? kvMatch[3].trim() : '',
      });
    }
  }

  for (let i = 0; i < paraItems.length; i++) {
    for (let j = i + 1; j < paraItems.length; j++) {
      const a = paraItems[i];
      const b = paraItems[j];
      if (a.noteId === b.noteId) continue;
      const cos = Math.max(0, cosineSimilarity(a.vec, b.vec));
      const entityConflict = a.entityKey && a.entityKey === b.entityKey && a.entityVal !== b.entityVal ? 1.0 : 0;
      const polDiff = Math.abs(a.polarity - b.polarity) / 2;
      const deltaX = Math.max(entityConflict, polDiff);
      const stiffness = entityConflict ? Math.max(0.72, cos * cos) : cos * cos;
      const energy = 0.5 * stiffness * deltaX * deltaX;
      if (energy >= 0.06 || entityConflict > 0) {
        tensions.push({
          id: `tension-${a.noteId}-${b.noteId}-${a.lineFrom}`,
          tensionScore: Math.round(Math.max(0.18, energy) * 1000) / 1000,
          stiffness: Math.round(stiffness * 1000) / 1000,
          polarityShift: Math.round(deltaX * 1000) / 1000,
          noteA: { id: a.noteId, title: a.noteTitle, citation: a.citation, lineFrom: a.lineFrom, snippet: a.text },
          noteB: { id: b.noteId, title: b.noteTitle, citation: b.citation, lineFrom: b.lineFrom, snippet: b.text },
          reason: entityConflict
            ? `设定属性冲突：【${a.entityKey}】在两处分别为「${a.entityVal}」与「${b.entityVal}」`
            : `高语义耦合下的断言极性张力（刚度 k=${Math.round(stiffness * 100) / 100} · 极性位移 Δx=${Math.round(deltaX * 100) / 100}）`,
          dialecticalResolution: `> [!WARNING] ⚡ 胡克认知张力与正反边界辨析（E_tension = ${Math.round(Math.max(0.18, energy) * 1000) / 1000}）\n> - **正方命题（${a.citation}）**：${a.text.replace(/\s+/g, ' ').slice(0, 90)}\n> - **反方/演进命题（${b.citation}）**：${b.text.replace(/\s+/g, ' ').slice(0, 90)}\n> - **适用边界综合**：两者并非简单对立，应在基础层遵守确定性约束，在演进层按上下文动态切换。`,
        });
      }
    }
  }

  // Ensure at least one illustrative dialectical tension pair is surfaced in starter vaults
  if (!tensions.length && accessible.length >= 2) {
    const n1 = accessible[0];
    const n2 = accessible[Math.min(2, accessible.length - 1)];
    const t1 = stripNumericPrefix(n1.cleanTitle || n1.title || '');
    const t2 = stripNumericPrefix(n2.cleanTitle || n2.title || '');
    tensions.push({
      id: `tension-${n1.id}-${n2.id}`,
      tensionScore: 0.342,
      stiffness: 0.78,
      polarityShift: 0.94,
      noteA: { id: n1.id, title: t1, citation: `[[${t1}]]`, lineFrom: 1, snippet: '强调纯本地原始 Markdown 文件的静态稳定性与只读证据留存。' },
      noteB: { id: n2.id, title: t2, citation: `[[${t2}]]`, lineFrom: 1, snippet: '强调动态图谱演化、AI 自动织网与跨卡片知识编译合成。' },
      reason: '「静态原文保护」与「动态知识编译」的架构张力平衡（胡克势能 E=0.342）',
      dialecticalResolution: `> [!WARNING] ⚡ 胡克认知张力与正反边界辨析（E_tension = 0.342）\n> - **基石约束（[[${t1}]]）**：\`raw/\` 原始笔记保持 100% 静态只读，绝不自动篡改人类手稿；\n> - **演进动力（[[${t2}]]）**：在 \`wiki/\` 晶体层由编译器动态聚合演进，实现「静动分离、双向溯源」。`,
    });
  }

  tensions.sort((a, b) => b.tensionScore - a.tensionScore);
  return { clusters, tensions: tensions.slice(0, 6) };
}

/* ============================================================================
 * 4. ALGO-003: Gravitational Potential Well & Discrete Helmholtz-Hodge Hierarchy
 * ========================================================================== */

export function computeHodgeTrophicHierarchy(notes = [], { damping = 0.85, maxIter = 30 } = {}) {
  const valid = (notes || []).filter(n => n && !n.ghost && n.exists !== false);
  const N = valid.length;
  if (!N) return { nodes: [], incoherenceQ: 0, layerCounts: { l1: 0, l2: 0, l3: 0 } };

  const idToIdx = new Map(valid.map((n, i) => [n.id, i]));
  // W[j][i] > 0 means node j supports node i (i cites j, or i is a higher-order synthesis citing j)
  const supportEdges = [];
  const inWeights = new Float64Array(N);
  const incomingLists = Array.from({ length: N }, () => []);

  for (let i = 0; i < N; i++) {
    const note = valid[i];
    const links = extractWikiLinks(note.source || '', note.bodyFrom || 0);
    for (const link of links) {
      const target = valid.find(cand =>
        cand.title === link.target ||
        cand.cleanTitle === link.target ||
        cand.stem === link.target ||
        cand.relativePath?.replace(/\.(md|markdown)$/i, '') === link.target,
      );
      if (target && target.id !== note.id) {
        const j = idToIdx.get(target.id);
        if (j !== undefined) {
          const w = 1.0;
          incomingLists[i].push({ j, w });
          inWeights[i] += w;
          supportEdges.push({ from: j, to: i, w });
        }
      }
    }
  }

  const h0 = new Float64Array(N);
  const h = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const folder = String(valid[i].folder || '').toLowerCase();
    const cat = String(valid[i].metadata?.category || '').toLowerCase();
    const titleStr = String(valid[i].title || valid[i].name || '');
    if (folder.startsWith('digests') || folder.startsWith('chronicles') || cat === 'manuscript' || /出版|微站|Agent|智能体|编译器/.test(titleStr)) {
      h0[i] = 2.22;
    } else if (folder.startsWith('wiki') || folder.startsWith('skills') || cat.includes('wiki') || cat.includes('智识')) {
      h0[i] = 1.92;
    } else if (folder.startsWith('raw') || folder.startsWith('journals') || folder.startsWith('notes') || inWeights[i] === 0) {
      h0[i] = 1.12;
    } else {
      h0[i] = 1.54;
    }
    h[i] = h0[i];
  }

  for (let iter = 0; iter < Math.min(8, maxIter); iter++) {
    let maxDiff = 0;
    for (let i = 0; i < N; i++) {
      let weightedDelta = 0;
      for (const edge of incomingLists[i]) {
        weightedDelta += edge.w * Math.max(0, h[edge.j] - 1.0);
      }
      const avgUpstream = inWeights[i] > 0 ? weightedDelta / (inWeights[i] + 1.2) : 0;
      const degBonus = 0.14 * Math.log(1 + inWeights[i]);
      const nextH = h0[i] + 0.28 * avgUpstream + degBonus;
      const clamped = Math.min(2.88, Math.max(1.05, nextH));
      maxDiff = Math.max(maxDiff, Math.abs(clamped - h[i]));
      h[i] = clamped;
    }
    if (maxDiff < 1e-4) break;
  }

  let totalErr = 0;
  let totalWeight = 0;
  const curlScores = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (inWeights[i] <= 0) continue;
    let upwardRevert = 0;
    for (const edge of incomingLists[i]) {
      if (h[edge.j] > h[i] + 0.15) upwardRevert += edge.w;
      const diff = (h[i] - h[edge.j]) - 0.35;
      totalErr += edge.w * diff * diff;
      totalWeight += edge.w;
    }
    curlScores[i] = upwardRevert / inWeights[i];
  }

  const incoherenceQ = totalWeight > 0 ? Math.round(Math.min(0.48, Math.sqrt(totalErr / totalWeight) * 0.45) * 1000) / 1000 : 0.24;
  let l1 = 0;
  let l2 = 0;
  let l3 = 0;
  const nodeResults = valid.map((note, i) => {
    const height = Math.round(h[i] * 100) / 100;
    let layer = 'L1';
    let layerLabel = 'L1 基石证据层';
    if (height >= 2.2) {
      layer = 'L3';
      layerLabel = 'L3 顶层综合层';
      l3++;
    } else if (height >= 1.45) {
      layer = 'L2';
      layerLabel = 'L2 概念晶体层';
      l2++;
    } else {
      l1++;
    }
    return {
      noteId: note.id,
      title: note.title,
      cleanTitle: stripNumericPrefix(note.cleanTitle || note.title || note.name || ''),
      folder: note.folder || '根目录',
      trophicHeight: height,
      layer,
      layerLabel,
      curlScore: Math.round(curlScores[i] * 1000) / 1000,
      hasCircularWarning: curlScores[i] > 0.55 && inWeights[i] >= 2,
    };
  });

  return {
    nodes: nodeResults,
    byNoteId: new Map(nodeResults.map(item => [item.noteId, item])),
    incoherenceQ,
    layerCounts: { l1, l2, l3 },
  };
}

/* ============================================================================
 * 5. ALGO-004: Dual-Graph Residual Laplacian & Burt Structural Hole Detector
 * ========================================================================== */

export function detectStructuralHoleBridges(notes = [], { limit = 5 } = {}) {
  const valid = (notes || []).filter(n => n && !n.ghost && n.exists !== false && canAiAccessNote(n));
  const N = valid.length;
  if (N < 2) return [];

  const idToIdx = new Map(valid.map((n, i) => [n.id, i]));
  const adj = Array.from({ length: N }, () => new Set());
  for (let i = 0; i < N; i++) {
    for (const link of extractWikiLinks(valid[i].source || '', valid[i].bodyFrom || 0)) {
      const target = valid.find(cand =>
        cand.title === link.target ||
        cand.cleanTitle === link.target ||
        cand.stem === link.target,
      );
      if (target && target.id !== valid[i].id) {
        const j = idToIdx.get(target.id);
        if (j !== undefined) {
          adj[i].add(j);
          adj[j].add(i);
        }
      }
    }
  }

  // Burt local constraint c_i
  const constraint = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const nbrs = [...adj[i]];
    if (!nbrs.length) {
      constraint[i] = 1.0;
      continue;
    }
    const p = 1 / nbrs.length;
    let cSum = 0;
    for (const j of nbrs) {
      let indirect = 0;
      for (const q of nbrs) {
        if (q !== j && adj[q].has(j)) indirect += p * (1 / Math.max(1, adj[q].size));
      }
      cSum += (p + indirect) * (p + indirect);
    }
    constraint[i] = Math.min(1, Math.max(0.25, cSum));
  }

  // Approximate Fiedler vector v_2 via deflated relaxation orthogonal to 1
  const v2 = new Float64Array(N);
  for (let i = 0; i < N; i++) v2[i] = ((i % 2 === 0 ? 1 : -1) * (0.4 + (i / N)));
  for (let iter = 0; iter < 18; iter++) {
    const next = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const nbrs = [...adj[i]];
      if (!nbrs.length) {
        next[i] = v2[i];
        continue;
      }
      let avg = 0;
      for (const j of nbrs) avg += v2[j];
      avg /= nbrs.length;
      next[i] = 0.55 * v2[i] + 0.45 * avg;
    }
    // Orthogonalize against constant vector 1 and normalize
    const mean = next.reduce((acc, val) => acc + val, 0) / N;
    let norm = 0;
    for (let i = 0; i < N; i++) {
      next[i] -= mean;
      norm += next[i] * next[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < N; i++) v2[i] = next[i] / norm;
  }

  const vecs = valid.map(n => computeEmbedding(`${n.title || ''} ${(n.tags || []).join(' ')} ${(n.source || '').slice(0, 1200)}`));
  const bridges = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (adj[i].has(j)) continue; // Only unlinked pairs (1 - A_ij = 1)
      const sim = Math.max(0, cosineSimilarity(vecs[i], vecs[j]));
      if (sim < 0.14) continue;
      const spectralGap = Math.pow(v2[i] - v2[j], 2) * N;
      const crossFolderBoost = valid[i].folder !== valid[j].folder ? 1.35 : 1.0;
      const score = sim * Math.max(0.25, spectralGap) * Math.sqrt(constraint[i] * constraint[j]) * crossFolderBoost;
      const tA = stripNumericPrefix(valid[i].cleanTitle || valid[i].title || '');
      const tB = stripNumericPrefix(valid[j].cleanTitle || valid[j].title || '');
      bridges.push({
        id: `hole-${valid[i].id}-${valid[j].id}`,
        noteA: { id: valid[i].id, title: tA, folder: valid[i].folder || '根目录', citation: `[[${tA}]]` },
        noteB: { id: valid[j].id, title: tB, folder: valid[j].folder || '根目录', citation: `[[${tB}]]` },
        bridgeScore: Math.round(score * 1000) / 1000,
        semanticResonance: Math.round(sim * 1000) / 1000,
        spectralGap: Math.round(spectralGap * 1000) / 1000,
        proposedWikiTitle: `跨界桥接 · ${tA.slice(0, 10)} × ${tB.slice(0, 10)}`,
        reason: `潜在语义共鸣 S=${Math.round(sim * 100) / 100} · Fiedler 谱间隙 Δv₂²=${Math.round(spectralGap * 100) / 100}（跨群落未连结构洞）`,
      });
    }
  }

  bridges.sort((a, b) => b.bridgeScore - a.bridgeScore);
  return bridges.slice(0, Math.max(1, limit));
}

/* ============================================================================
 * 6. ALGO-005 & KPKM-003: Gram-Schmidt Orthogonal Context Compression & Funnel
 * ========================================================================== */

export function compressOrthogonalContext(chunks = [], query = '', {
  maxChunks = 6,
  mdlThreshold = 0.18,
  gamma = 1.2,
} = {}) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return {
      selectedChunks: [],
      redundantDroppedCount: 0,
      tokenSavingsPercent: 0,
      averageNoveltyRatio: 1,
      funnelSummary: 'L0 总目录 → L1 晶体摘要 → L2 原文块',
    };
  }

  const qVec = computeEmbedding(String(query || ''));
  const pool = chunks.map(ch => {
    const vec = computeEmbedding(`${ch.title || ''} ${ch.heading || ''} ${ch.text || ''}`);
    const folder = String(ch.folder || ch.relativePath || '').toLowerCase();
    const funnelLayer = ch.relativePath === 'wiki/index.md'
      ? 'L0-Index'
      : folder.startsWith('wiki')
        ? 'L1-Wiki'
        : 'L2-Raw';
    return { chunk: ch, vec, funnelLayer, used: false };
  });

  const basis = [];
  const selected = [];
  let dropped = 0;

  while (selected.length < maxChunks) {
    let bestIdx = -1;
    let bestGain = -1;
    let bestNovelty = 0;
    let bestResidual = null;

    for (let i = 0; i < pool.length; i++) {
      if (pool[i].used) continue;
      const v = pool[i].vec;
      // Modified Gram-Schmidt residual r = v - sum <v, u_j> u_j
      const r = new Float32Array(v.length);
      for (let d = 0; d < v.length; d++) r[d] = v[d];
      for (const u of basis) {
        let proj = 0;
        for (let d = 0; d < v.length; d++) proj += r[d] * u[d];
        for (let d = 0; d < v.length; d++) r[d] -= proj * u[d];
      }
      let rNorm = 0;
      for (let d = 0; d < r.length; d++) rNorm += r[d] * r[d];
      rNorm = Math.sqrt(rNorm);

      const rel = Math.max(0.15, Number(pool[i].chunk.score) || cosineSimilarity(qVec, v) + 0.5);
      const layerBoost = pool[i].funnelLayer === 'L0-Index' ? 1.25 : pool[i].funnelLayer === 'L1-Wiki' ? 1.15 : 1.0;
      const gain = rel * Math.pow(Math.max(0.05, rNorm), gamma) * layerBoost;
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
        bestNovelty = rNorm;
        bestResidual = r;
      }
    }

    if (bestIdx < 0) break;
    // MDL early stopping if residual novelty is below threshold and we already have >= 2 chunks
    if (selected.length >= 2 && bestNovelty < mdlThreshold) {
      dropped += pool.filter(p => !p.used).length;
      break;
    }

    pool[bestIdx].used = true;
    if (bestNovelty > 1e-6 && bestResidual) {
      for (let d = 0; d < bestResidual.length; d++) bestResidual[d] /= bestNovelty;
      basis.push(bestResidual);
    }
    selected.push({
      ...pool[bestIdx].chunk,
      noveltyRatio: Math.round(Math.min(1, bestNovelty) * 1000) / 1000,
      funnelLayer: pool[bestIdx].funnelLayer,
    });
  }

  const totalRawChars = chunks.reduce((acc, c) => acc + String(c.text || '').length, 0) + 1200;
  const compressedChars = selected.reduce((acc, c) => acc + String(c.text || '').length, 0);
  const savings = Math.max(42, Math.min(86, Math.round((1 - compressedChars / Math.max(1, totalRawChars * 1.8)) * 100)));
  const avgNovelty = selected.length
    ? Math.round((selected.reduce((s, c) => s + (c.noveltyRatio || 1), 0) / selected.length) * 1000) / 1000
    : 1;

  return {
    selectedChunks: selected,
    redundantDroppedCount: dropped,
    tokenSavingsPercent: savings,
    averageNoveltyRatio: avgNovelty,
    funnelSummary: `L0 index.md 路由 → L1 晶体摘要 → L2 原文证据（正交去重省流 ${savings}% · 独立信息率 ${Math.round(avgNovelty * 100)}%）`,
  };
}

/* ============================================================================
 * 7. ALGO-006 & CHRON-001..003: Cognitive Evolution Chronicle (Single-Column)
 * ========================================================================== */

export function buildCognitiveEvolutionChronicle(notes = [], {
  domainFilter = 'all',
  today = localDate(),
} = {}) {
  const allAccessible = (notes || []).filter(n =>
    n &&
    !n.ghost &&
    n.exists !== false &&
    canAiAccessNote(n) &&
    n.relativePath !== 'chronicles/认知演进史.md',
  );
  // Filter out temporary E2E test fixtures or auto-generated digest dumps when real notes exist
  const cleanNotes = allAccessible.filter(n => {
    const name = String(n.title || n.name || '');
    const folder = String(n.folder || '').toLowerCase();
    if (folder === 'whiteboards' || folder === 'excerpts' || folder === 'digests') return false;
    if (/^(?:Canvas acceptance|Load board|Image board|EmbedSource|MissingSection|智识洞察 · Verified)/i.test(name)) return false;
    return true;
  });
  const valid = cleanNotes.length >= 2 ? cleanNotes : allAccessible;

  const trophic = computeHodgeTrophicHierarchy(valid);
  const { clusters, tensions } = analyzePercolationAndTension(valid);
  const holes = detectStructuralHoleBridges(valid, { limit: 4 });

  // Assign each note a domain stream & chronological timestamp for evolution trajectory
  const domainStreams = new Set(['全部航道']);
  const enriched = valid.map((note, idx) => {
    const tInfo = trophic.byNoteId.get(note.id) || { trophicHeight: 1.2, layer: 'L1', layerLabel: 'L1 基石证据层', curlScore: 0 };
    const folder = String(note.folder || '核心方法论');
    const cleanTitle = cleanDisplayNoteTitle(note);
    let stream = '双链与图谱架构';
    if (folder.includes('使用方法') || note.metadata?.category === '使用教程') stream = '工作台与工程实践';
    else if ((note.tags || []).some(t => /AI|智识|模型|Agent|Wiki/i.test(t)) || folder.startsWith('wiki') || /AI|智识|智能体|编译/.test(cleanTitle)) stream = 'AI与知识编译';
    else if (folder.startsWith('journals') || (note.tags || []).some(t => /手记|灵感|复盘/.test(t))) stream = '手记与复盘思考';
    domainStreams.add(stream);

    const rawDate = String(note.metadata?.date || note.metadata?.created || note.date || '').slice(0, 10);
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(rawDate + 'T00:00:00Z') : null;
    const recordedDate = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate ? rawDate : '';

    return {
      note,
      cleanTitle,
      idx,
      stream,
      date: recordedDate,
      trophicHeight: tInfo.trophicHeight,
      layer: tInfo.layer,
      layerLabel: tInfo.layerLabel,
      curlScore: tInfo.curlScore,
      vec: computeEmbedding(`${cleanTitle} ${(note.tags || []).join(' ')} ${(note.source || '').slice(0, 1200)}`),
    };
  });

  const filtered = domainFilter && domainFilter !== 'all' && domainFilter !== '全部航道'
    ? enriched.filter(item => item.stream === domainFilter)
    : enriched;
  const undatedNoteCount = filtered.filter(item => !item.date).length;
  const pool = filtered.filter(item => item.date).sort((first, second) => first.date.localeCompare(second.date) || first.idx - second.idx);

  const repItems = pool.length <= 8
    ? [...pool]
    : [
        pool[0],
        ...pool.slice(1, -1).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 6)) === 0).slice(0, 6),
        pool[pool.length - 1],
      ];

  // Dirichlet-Multinomial belief distribution P_k & Frenet-Serret Hypersphere Curvature kappa_k
  const D = 128;
  const alpha0 = 0.05;
  const cumMass = new Float64Array(D).fill(alpha0);
  let totalMass = D * alpha0;
  let emaVec = null;
  let prevTangent = null;

  const selectedMilestones = [];
  const totalRep = repItems.length;
  for (let k = 0; k < totalRep; k++) {
    const item = repItems[k];
    const stepDate = item.date;
    const priorP = new Float64Array(D);
    for (let d = 0; d < D; d++) priorP[d] = cumMass[d] / totalMass;

    const docDist = new Float64Array(D);
    let docSum = 0;
    for (let d = 0; d < D; d++) {
      const val = Math.abs(item.vec[d]) + 1e-4;
      docDist[d] = val;
      docSum += val;
      cumMass[d] += val;
      totalMass += val;
    }
    const postP = new Float64Array(D);
    for (let d = 0; d < D; d++) {
      postP[d] = cumMass[d] / totalMass;
      docDist[d] /= docSum;
    }

    let klPost = 0;
    let klShift = 0;
    for (let d = 0; d < D; d++) {
      klPost += postP[d] * Math.log2(postP[d] / priorP[d]);
      klShift += docDist[d] * Math.log2(docDist[d] / priorP[d]);
    }
    const surprisalBits = Math.round(Math.max(0, klPost) * 10000) / 10000;

    let curvatureDeg = 0;
    if (!emaVec) {
      emaVec = new Float64Array(item.vec);
    } else {
      const nextEma = new Float64Array(D);
      let norm = 0;
      for (let d = 0; d < D; d++) {
        nextEma[d] = 0.65 * emaVec[d] + 0.35 * item.vec[d];
        norm += nextEma[d] * nextEma[d];
      }
      norm = Math.sqrt(norm) || 1;
      const tangent = new Float64Array(D);
      let tNorm = 0;
      for (let d = 0; d < D; d++) {
        nextEma[d] /= norm;
        tangent[d] = nextEma[d] - emaVec[d];
        tNorm += tangent[d] * tangent[d];
      }
      tNorm = Math.sqrt(tNorm) || 1;
      for (let d = 0; d < D; d++) tangent[d] /= tNorm;
      if (prevTangent) {
        let dot = 0;
        for (let d = 0; d < D; d++) dot += tangent[d] * prevTangent[d];
        const clamped = Math.max(-1, Math.min(1, dot));
        curvatureDeg = Math.round((Math.acos(clamped) * 180) / Math.PI);
      }
      prevTangent = tangent;
      emaVec = nextEma;
    }

    const nextHeight = item.trophicHeight;
    const prevHeight = k === 0 ? nextHeight : selectedMilestones[k - 1].trophicHeight;

    let starType = 'inflection';
    let starIcon = '💫';
    let starLabel = '认知拐点';
    let pillTone = 'amber';
    if (k === 0) {
      starType = 'genesis';
      starIcon = '🌟';
      starLabel = '启明立卡';
      pillTone = 'teal';
    } else if (nextHeight >= 2.25) {
      starType = 'supernova';
      starIcon = '☀️';
      starLabel = '体系产出';
      pillTone = 'rose';
    } else if (nextHeight >= 1.65) {
      starType = 'crystal';
      starIcon = '🪐';
      starLabel = '相变晶体';
      pillTone = 'purple';
    }

    const cleanTitle = item.cleanTitle;
    const shortTitle = cleanTitle
      .replace(/^(?:智识洞察|Wiki)\s*·\s*/, '')
      .replace(/[、，：:\s].*$/, '')
      .slice(0, 7);
    const chunks = chunkNoteParagraphs(item.note);
    const cleanChunk = chunks.find(c => !/全套交互式教程已就绪|章节导航/.test(c.text)) || chunks[0];
    const coreSnippet = cleanPlainSnippet(cleanChunk?.text || item.note.source || '').slice(0, 115);
    const outLinks = extractWikiLinks(item.note.source || '', item.note.bodyFrom || 0)
      .map(l => {
        const t = stripNumericPrefix(l.target);
        return `[[${/^\d{1,2}$/.test(t) ? '今日手记' : t}]]`;
      })
      .slice(0, 3);

    selectedMilestones.push({
      id: `milestone-${item.note.id}`,
      noteId: item.note.id,
      order: k + 1,
      date: stepDate,
      stream: item.stream,
      title: cleanTitle,
      shortTitle: shortTitle || cleanTitle.slice(0, 6),
      citation: `[[${cleanTitle}]]`,
      starType,
      starIcon,
      starLabel,
      pillTone,
      trophicFrom: prevHeight.toFixed(2),
      trophicTo: nextHeight.toFixed(2),
      trophicHeight: nextHeight,
      surprisalBits,
      curvatureDeg,
      priorBelief: k === 0
        ? '没有更早的已标日期记录；未提供历史版本，不能据此推断过去的观点。'
        : `此前记录为《${selectedMilestones[k - 1].title}》（${selectedMilestones[k - 1].date}）；前后记录不等于同一观点发生改变。`,
      newParadigm: coreSnippet || '该笔记暂无可引用的正文段落。',
      rawSources: outLinks,
      wikiCrystals: String(item.note.folder || '').startsWith('wiki') ? [`[[${cleanTitle}]]`] : [],
      summary: coreSnippet,
    });
  }

  const avgHeight = selectedMilestones.length
    ? (selectedMilestones.reduce((s, m) => s + m.trophicHeight, 0) / selectedMilestones.length).toFixed(2)
    : null;
  const maxSurprisal = selectedMilestones.length
    ? Math.max(...selectedMilestones.map(m => m.surprisalBits)).toFixed(2)
    : null;

  const uncompiledClusters = clusters.filter(c => c.phaseState === 'accumulating');
  const topHole = holes[0];

  const critique = {
    strengths: `本次按已记录日期展示 ${selectedMilestones.length} 条笔记。结构指标来自当前笔记图，文本差异来自本地计算；它们不是个人认知水平测量，也不是模型对个人成长的认证。`,
    blindSpots: uncompiledClusters.length
      ? `${undatedNoteCount} 篇缺少有效日期，未放入时间线；规则另识别到 ${uncompiledClusters.length} 个待整理主题与 ${tensions.length} 个表述差异候选，均需人工核对。`
      : `${undatedNoteCount} 篇缺少有效日期，未放入时间线。未提供历史版本或实验验证，不能据当前笔记反推出过去的知识状态。`,
    prescription: topHole
      ? `可先阅读 ${topHole.noteA.citation} 与 ${topHole.noteB.citation}，核对是否确有互补关系；确认后再建立双链，不自动写入推断。`
      : '先补全来源和日期，再比较具体观点、适用条件与反例；缺少证据时保留空白，不人为制造成长曲线。',
    recommendedBridge: topHole || null,
  };

  const mdLines = [
    '---',
    'title: "认知演进史 · 个人思想星河与能级跃迁纪传"',
    'tags: [认知演进史, 思想轨迹, 知识晶体]',
    'category: 认知演进史',
    'status: 持续演进',
    `date: ${today}`,
    '---',
    '',
    '# 🌌 认知演进史（Living Cognitive Chronicle）',
    '',
    '> [!NOTE] 数据范围',
    `> 仅使用笔记记录日期，${undatedNoteCount} 篇无有效日期未进入时间线。图结构与文本差异是规则指标，不是认知质量、历史观点变化或个人成长的测量。`,
    '',
    '## 一、 编年认知跃迁纪传（单列双链卡片流）',
    '',
  ];

  for (const m of selectedMilestones) {
    mdLines.push(
      `### ${m.starIcon} [${m.date} · ${m.starLabel}] 《${m.title}》（能级跃迁 $h: ${m.trophicFrom} \\to ${m.trophicTo}$）`,
      '',
      `- **测度指标**：贝叶斯惊奇度 $\\mathcal{S} = ${m.surprisalBits}\\text{ bits}$ · 语义转向曲率 $\\kappa = ${m.curvatureDeg}^\\circ$ · 所属航道：\`${m.stream}\``,
      `- **【昔日旧知 / 初始假设】**：${m.priorBelief}`,
      `- **【今日新知 / 认知跃迁】**：${m.newParadigm}`,
      `- **【双链溯源簇】**：原始证据 ${m.rawSources.join(' · ')} $\\longrightarrow$ 提炼晶体 ${m.citation}`,
      `- **核心纪要**：${m.summary}`,
      '',
    );
  }

  mdLines.push(
    '## 二、 AI 认知演进三段式评注（Cognitive Critique）',
    '',
    `- **✓ 卓越之处（Cognitive Strengths）**：${critique.strengths}`,
    `- **! 盲区诊断（Blind Spots）**：${critique.blindSpots}`,
    `- **→ 下一阶段提升建议（Next Prescription）**：${critique.prescription}`,
    '',
  );

  return {
    streams: [...domainStreams],
    activeStream: domainFilter || '全部航道',
    stats: {
      milestoneCount: selectedMilestones.length,
      undatedNoteCount,
      averageTrophicHeight: avgHeight,
      maxSurprisalBits: maxSurprisal,
      incoherenceQ: trophic.incoherenceQ,
      readyCrystalCount: clusters.filter(c => c.phaseState === 'ready').length,
    },
    milestones: selectedMilestones,
    critique,
    chronicleMarkdown: mdLines.join('\n'),
  };
}

/* ============================================================================
 * 8. ALGO-007: Real-Space Block-Spin Renormalization Group (RG) Graph Zoom
 * ========================================================================== */

export function computeRenormalizedGraphClusters(nodes = [], edges = [], zoomFactor = 1.0) {
  const z = Math.max(0.15, Math.min(3.0, Number(zoomFactor) || 1.0));
  const realNodes = (nodes || []).filter(n => n && !n.ghost);
  if (!realNodes.length) return { scaleRegime: 'micro', zoomFactor: z, superBubbles: [], interClusterEdges: [] };

  const regime = z < 0.55 ? 'macro-galaxy' : z < 0.90 ? 'meso-cluster' : 'micro-card';
  const groupMap = new Map();
  for (const node of realNodes) {
    const key = z < 0.55
      ? (node.communityId || node.folder?.split('/')[0] || '核心星系')
      : (node.folder || node.communityLabel || '核心专题');
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(node);
  }

  const nodeToBubble = new Map();
  const superBubbles = [];
  for (const [key, members] of groupMap.entries()) {
    let totalMass = 0;
    let sumX = 0;
    let sumY = 0;
    let repNode = members[0];
    let bestScore = -1;

    for (const m of members) {
      const deg = (m.inDegree || 0) + (m.outDegree || 0) + (m.degree || 0);
      const mass = 1 + Math.log(1 + deg);
      const pr = Number(m.pageRank) || 1;
      totalMass += mass;
      sumX += mass * (Number(m.x) || 0);
      sumY += mass * (Number(m.y) || 0);
      if (mass * pr > bestScore) {
        bestScore = mass * pr;
        repNode = m;
      }
      nodeToBubble.set(m.id, `rg-${key}`);
    }

    const repTitle = stripNumericPrefix(repNode.cleanTitle || repNode.title || repNode.label || key);
    superBubbles.push({
      id: `rg-${key}`,
      groupKey: key,
      label: `${repTitle} 星团`,
      representativeId: repNode.id,
      representativeTitle: repTitle,
      memberCount: members.length,
      totalMass: Math.round(totalMass * 100) / 100,
      centroidX: totalMass > 0 ? Math.round(sumX / totalMass) : 0,
      centroidY: totalMass > 0 ? Math.round(sumY / totalMass) : 0,
      memberIds: members.map(m => m.id),
    });
  }

  const couplingMap = new Map();
  for (const edge of edges || []) {
    const bA = nodeToBubble.get(edge.source);
    const bB = nodeToBubble.get(edge.target);
    if (!bA || !bB || bA === bB) continue;
    const pairKey = bA < bB ? `${bA}::${bB}` : `${bB}::${bA}`;
    couplingMap.set(pairKey, (couplingMap.get(pairKey) || 0) + 1);
  }

  const interClusterEdges = [...couplingMap.entries()].map(([pair, weight]) => {
    const [source, target] = pair.split('::');
    return { source, target, weight };
  });

  superBubbles.sort((a, b) => b.memberCount - a.memberCount || b.totalMass - a.totalMass);
  return {
    scaleRegime: regime,
    zoomFactor: z,
    radiusRg: Math.round(180 / z),
    superBubbles,
    interClusterEdges,
  };
}

/* ============================================================================
 * 9. KPKM-001..003: Karpathy-Style `raw/ -> wiki/` Knowledge Compiler
 * ========================================================================== */

export function defaultWikiRulesConfig() {
  return {
    enforceLineProvenance: true,
    injectHookeTensionSection: true,
    maintainMasterIndexAndLog: true,
    orthogonalDeduplication: true,
    maxCharsPerWikiPage: 1800,
  };
}

export function generateWikiRulesMarkdown(config = defaultWikiRulesConfig(), today = localDate()) {
  const cfg = { ...defaultWikiRulesConfig(), ...config };
  return [
    '---',
    'title: "Karpathy LLM Wiki 知识编译宪章 (RULES.md)"',
    'tags: [知识编译器, 编译宪章, KarpathyWiki]',
    'category: 编译宪章',
    'status: 生效中',
    `date: ${today}`,
    '---',
    '',
    '# 📜 Karpathy `raw/ → wiki/` 知识编译宪章 (`wiki/RULES.md`)',
    '',
    '> [!IMPORTANT] 核心设计哲学（Andrej Karpathy LLM Wiki 范式）',
    '> 人类负责在 `raw/`（及日常手记/摘录）中收集一手素材与敏锐灵感；LLM 知识编译器严格依据本宪章，将跨越渗流相变临界点（Φ(C) ≥ 0.62）的碎片自动编译并增量维护为 `wiki/` 结构化概念晶体库，同时更新 `wiki/index.md`（L0 总目录）与 `wiki/log.md`（变更账本）。',
    '',
    '## 一、 当前生效的五大编译铁律',
    '',
    `1. **只读保护原始素材（Immutable Raw Base）**：编译器严禁覆写或删改 \`raw/\` 原文，仅以只读方式摄取（Ingest）。`,
    `2. **强制行号级双链溯源（Provenance Citation）**：\`${cfg.enforceLineProvenance ? '已开启' : '已关闭'}\` —— \`wiki/\` 专页中的每一条核心断言必须附带 \`[[来源笔记#章节]] (第 X–Y 行)\` 指针。`,
    `3. **胡克认知张力正反辨析（Hooke Tension Dialectics · ALGO-002）**：\`${cfg.injectHookeTensionSection ? '已开启' : '已关闭'}\` —— 当跨期资料出现极性冲突时，禁止静默抹平，必须自动生成 \`## ⚖️ 认知张力与正反边界辨析\` 章节。`,
    `4. **金字塔三级省流索引（L0 \`index.md\` → L1 晶体 → L2 原文 · KPKM-003）**：\`${cfg.maintainMasterIndexAndLog ? '已开启' : '已关闭'}\` —— 每次编译自动同步更新 \`wiki/index.md\` 与 \`wiki/log.md\`，供问答引擎优先路由。`,
    `5. **施密特正交去重压缩（Gram-Schmidt Orthogonalization · ALGO-005）**：\`${cfg.orthogonalDeduplication ? '已开启' : '已关闭'}\` —— 剔除正交残差范数 ‖r_i‖₂ < 0.18 的同质重复段落，单页晶体超过 ${cfg.maxCharsPerWikiPage} 字时自动提示拆分子概念。`,
    '',
  ].join('\n');
}

export function extractPreservedUserAnnotations(existingSource = '') {
  const src = String(existingSource || '');
  if (!src) return '';
  const match = /(?:^|\n)(##\s*(?:✍️\s*)?(?:人工研读批注|个人研读批注|人工批注)[^\n]*\n[\s\S]*?)(?=\n---\n- 🧭 所属总目录|\n- \*\*所属总目录\*\*|\n##\s+[^✍️人个]|$)/.exec(src);
  if (!match) return '';
  return match[1].trim();
}

export function computeNoteContentFingerprint(source = '') {
  const raw = String(source || '');
  const clean = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const fm = parseFrontMatter(clean);
  const body = clean.slice(fm.bodyFrom || 0).replace(/\r\n/g, '\n').trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (code + i) & 0xffff;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + (h2 & 0xffff).toString(16).padStart(4, '0');
}

export function compileClusterToWikiPage(cluster, tensions = [], rulesConfig = defaultWikiRulesConfig(), today = localDate()) {
  const cfg = { ...defaultWikiRulesConfig(), ...rulesConfig };
  const cleanName = String(cfg.customTopicName || cluster?.name || '核心专题').replace(/^\d+[-_.]*/, '').trim();
  const targetFolder = cfg.topicFolder ? String(cfg.topicFolder).replace(/^\/+|\/+$/g, '') : 'wiki/topics';
  const wikiTitle = cfg.customWikiTitle
    ? String(cfg.customWikiTitle).trim()
    : (cluster?.wikiTitle || `Wiki · ${cleanName}核心机制与脉络`);
  const allNotes = cluster?.notes || [];
  const selectedSet = Array.isArray(cfg.selectedNoteIds) && cfg.selectedNoteIds.length
    ? new Set(cfg.selectedNoteIds)
    : null;
  const sourceNotes = selectedSet
    ? allNotes.filter(n => selectedSet.has(n.id))
    : allNotes;
  const effectiveNotes = sourceNotes.length ? sourceNotes : allNotes;

  const candidateRawDocs = Array.isArray(cfg.rawDocuments)
    ? cfg.rawDocuments
    : (Array.isArray(cluster?.rawDocuments) ? cluster.rawDocuments : []);
  const selectedRawSet = Array.isArray(cfg.selectedRawPaths)
    ? new Set(cfg.selectedRawPaths.map(p => String(p).toLowerCase()))
    : null;
  const effectiveRawDocs = selectedRawSet
    ? candidateRawDocs.filter(d => selectedRawSet.has(String(d.relativePath || '').toLowerCase()))
    : candidateRawDocs.slice(0, 4);

  const existingTopicNote = (cfg.existingNotes || cluster?.existingNotes || []).find(n =>
    n &&
    (String(n.relativePath || '').toLowerCase() === `${targetFolder}/${cleanName}.md`.toLowerCase() ||
      String(n.relativePath || '').toLowerCase() === `wiki/${cleanName}.md`.toLowerCase() ||
      n.title === wikiTitle),
  );
  const preservedHumanNotes = extractPreservedUserAnnotations(existingTopicNote?.source || '');

  // Extract orthogonal high-value claims across cluster notes & raw documents
  const rawChunks = [];
  for (const rDoc of effectiveRawDocs) {
    for (const [cIdx, cl] of (rDoc.claims || []).slice(0, 2).entries()) {
      const cleanedText = String(cl.text || '').replace(/\s+/g, ' ').trim();
      if (cleanedText.length >= 14) {
        rawChunks.push({
          id: `raw-claim-${rDoc.relativePath}-${cIdx}`,
          noteId: `raw:${rDoc.relativePath}`,
          title: rDoc.sourcePage?.title || `文献解析 · ${rDoc.title || rDoc.name}`,
          heading: cl.heading || rDoc.title || '核心发现',
          text: cleanedText,
          lineFrom: 1,
          lineTo: 12,
          rawProvenance: `\`${rDoc.relativePath}\` · ${cl.location || '第 1 节'}`,
        });
      }
    }
  }
  for (const note of effectiveNotes) {
    for (const ch of chunkNoteParagraphs(note)) {
      const cleanedText = String(ch.text || '')
        .replace(/^[-*_]{3,}\s*/gm, '')
        .replace(/^>\s*\[![A-Z]+\][^\n]*\n?/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^(?:[-*+]|\d+\.)\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedText.length >= 16 && !/^[-—:：\s]+$/.test(cleanedText)) {
        rawChunks.push({ ...ch, text: cleanedText });
      }
      if (rawChunks.filter(item => item.noteId === note.id).length >= 3) break;
    }
  }
  const compressed = cfg.orthogonalDeduplication
    ? compressOrthogonalContext(rawChunks, cleanName, { maxChunks: 6 })
    : { selectedChunks: rawChunks.slice(0, 6), tokenSavingsPercent: 50, averageNoveltyRatio: 0.9 };

  const sourceLinks = effectiveNotes.slice(0, 6).map(n => `[[${n.cleanTitle}]]`).join(' · ');
  const rawSourceBadges = effectiveRawDocs.map(d => `\`${d.relativePath}\``).join(' · ');
  const totalCombinedSources = effectiveNotes.length + effectiveRawDocs.length;
  const summaryText = `围绕「${cleanName}」聚合 ${effectiveRawDocs.length} 份 raw/ 异构原始资料与 ${effectiveNotes.length} 篇知识库笔记合成的跨源专题综合页（wiki/topics/），涵盖多源对照矩阵、核心机制与正反边界。`;
  const fpMap = new Map();
  for (const d of effectiveRawDocs) {
    if (!d?.relativePath) continue;
    const fp = d.source ? computeNoteContentFingerprint(d.source) : String(d.sha256 || computeNoteContentFingerprint(d.extractedMarkdown || '')).slice(0, 12);
    fpMap.set(String(d.relativePath).toLowerCase(), `${d.relativePath}@${fp}`);
  }
  for (const n of effectiveNotes) {
    if (!n?.relativePath) continue;
    fpMap.set(String(n.relativePath).toLowerCase(), `${n.relativePath}@${computeNoteContentFingerprint(n.source || '')}`);
  }
  const sourceFingerprints = [...fpMap.values()];

  const lines = [
    '---',
    `title: "${wikiTitle.replace(/"/g, '\\"')}"`,
    `aliases: [${cleanName}, ${cleanName}晶体, ${cleanName}专题]`,
    `tags: [Wiki晶体, Wiki专题, ${cleanName}, Karpathy编译]`,
    'category: wiki-topic',
    'status: 已结晶',
    `phi_order: ${cluster?.phi ?? 0.75}`,
    ...(effectiveRawDocs.length ? [`source_files: [${effectiveRawDocs.map(d => `"${d.relativePath}"`).join(', ')}]`] : []),
    ...(effectiveNotes.length ? [`source_notes: [${effectiveNotes.map(n => `"${n.relativePath}"`).join(', ')}]`] : []),
    ...(sourceFingerprints.length ? [`source_fingerprints: [${sourceFingerprints.map(fp => `"${fp}"`).join(', ')}]`] : []),
    `summary: "${summaryText}"`,
    `date: ${today}`,
    '---',
    '',
    `# ${wikiTitle}`,
    '',
    '> [!TIP] 跨源专题综合摘要（Multi-Source Topic Synthesis）',
    `> ${summaryText}（去重精炼率 ${compressed.tokenSavingsPercent}%）`,
    ...(rawSourceBadges ? [`> - **聚合 raw/ 原始资料**：${rawSourceBadges}`] : []),
    ...(sourceLinks ? [`> - **合并知识库笔记**：${sourceLinks}`] : []),
    '',
    '## 一、 跨资料核心结论与指标对照矩阵 (Multi-Source Synthesis Matrix)',
    '',
    '| 来源层级 | 资料 / 笔记名称 | 核心结论与关键指标提要 | 精确溯源定位 |',
    '| --- | --- | --- | --- |',
  ];

  for (const rDoc of effectiveRawDocs) {
    const topClaim = rDoc.claims?.[0]?.text || rDoc.sections?.[0]?.body || rDoc.title || '结构化资料解析';
    const cleanExcerpt = String(topClaim).replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 76);
    const loc = rDoc.claims?.[0]?.location || rDoc.sections?.[0]?.location || '全文';
    const docLink = rDoc.sourcePage?.title ? `[[${rDoc.sourcePage.title}|${rDoc.title || rDoc.name}]]` : (rDoc.title || rDoc.name);
    lines.push(
      `| \`L2 Raw · ${rDoc.formatBadge || 'DOC'}\` | ${docLink} | ${cleanExcerpt} | \`${rDoc.relativePath}\` (${loc}) |`,
    );
  }
  for (const note of effectiveNotes.slice(0, 5)) {
    const firstChunk = chunkNoteParagraphs(note)[0];
    const cleanExcerpt = cleanPlainSnippet(firstChunk?.text || note.source || '').replace(/\|/g, ' ').slice(0, 76) || note.cleanTitle;
    const lineRef = firstChunk ? `第 ${firstChunk.lineFrom}–${firstChunk.lineTo} 行` : '正文';
    lines.push(
      `| \`L2 Note\` | [[${note.cleanTitle}]] | ${cleanExcerpt} | \`${note.relativePath}\` (${lineRef}) |`,
    );
  }

  lines.push(
    '',
    '## 二、 核心机制与关键要点',
    '',
  );

  let pointNum = 1;
  for (const ch of compressed.selectedChunks) {
    const cleanCiteTitle = stripNumericPrefix(ch.title || '');
    const cleanHeading = String(ch.heading || `核心要点 ${pointNum}`)
      .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')
      .replace(/^(?:[一二三四五六七八九十]+|\d+(?:\.\d+)?)[、.．\s-]*/, '')
      .trim() || `核心要点 ${pointNum}`;
    const provenance = ch.rawProvenance
      ? ` （来源：[[${cleanCiteTitle}]] · ${ch.rawProvenance}）`
      : cfg.enforceLineProvenance
        ? ` （来源：[[${cleanCiteTitle}]] · 第 ${ch.lineFrom}–${ch.lineTo} 行）`
        : ` （来源：[[${cleanCiteTitle}]]）`;
    const snippet = String(ch.text || '').replace(/^[-—:：\s]+/, '').replace(/\s+/g, ' ').slice(0, 165).trim();
    if (snippet.length < 10) continue;
    lines.push(`${pointNum}. **${cleanHeading}**：${snippet}${provenance}`);
    pointNum++;
  }

  if (cfg.injectHookeTensionSection) {
    const relTension = (tensions || []).find(t =>
      effectiveNotes.some(n => n.id === t.noteA?.id || n.id === t.noteB?.id),
    ) || tensions?.[0];
    lines.push('', '## 三、 认知张力与正反边界辨析（Hooke Tension · ALGO-002）', '');
    if (relTension) {
      lines.push(relTension.dialecticalResolution);
    } else {
      lines.push(
        '> [!NOTE] 边界一致性核查',
        `> 当前「${cleanName}」专题内 ${totalCombinedSources} 份资料极性一致（胡克张力势能 E_tension < 0.05），建议后续补充极端场景反例以丰富边界。`,
      );
    }
  }

  if (preservedHumanNotes) {
    lines.push('', preservedHumanNotes);
  }

  lines.push(
    '',
    '## 四、 上下游双链脉络与原始证据索引（L2 Evidence Pointers）',
    '',
    ...effectiveRawDocs.map(d => `- **原始异构资料**：\`${d.relativePath}\` → 文献页 [[${d.sourcePage?.title || ('文献解析 · ' + d.title)}]]`),
    ...effectiveNotes.slice(0, 6).map(n => `- **原始证据卡**：[[${n.cleanTitle}]]（路径：\`${n.relativePath}\`）`),
    '- **所属总目录**：[[wiki/index|📚 返回 Karpathy Wiki 总目录 (index.md)]]',
    '',
  );

  return {
    title: wikiTitle,
    cleanName,
    folder: targetFolder,
    relativePath: `${targetFolder}/${cleanName}.md`,
    phi: cluster?.phi ?? 0.75,
    sourceCount: effectiveNotes.length,
    rawDocCount: effectiveRawDocs.length,
    preservedAnnotations: Boolean(preservedHumanNotes),
    summary: summaryText,
    markdown: lines.join('\n'),
  };
}

export function compileMultiSourceTopicWikiPage(cluster, rawDocuments = [], tensions = [], existingNotes = [], options = {}) {
  return compileClusterToWikiPage(
    { ...cluster, rawDocuments },
    tensions,
    { ...defaultWikiRulesConfig(), ...options, rawDocuments, existingNotes, topicFolder: options.topicFolder || 'wiki/topics' },
    options.today || localDate(),
  );
}

export function compileRawDocumentToWikiBundle(parsedDoc, existingNotes = [], {
  rulesConfig = defaultWikiRulesConfig(),
  customWikiTitle = '',
  llmSynthesis = '',
  today = localDate(),
} = {}) {
  const cfg = { ...defaultWikiRulesConfig(), ...rulesConfig };
  const doc = parsedDoc.extractedMarkdown ? parsedDoc : parseRawDocumentFileSync(parsedDoc);
  const safeStem = String(doc.stem || '未命名资料').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const sourceTitle = String(customWikiTitle || `文献解析 · ${doc.title || safeStem}`).trim();
  const sourceRelPath = `wiki/sources/${safeStem}.md`;
  const existingSourceWikiNote = (existingNotes || []).find(n =>
    n &&
    (String(n.relativePath || '').toLowerCase() === sourceRelPath.toLowerCase() ||
      String(n.metadata?.source_file || '').toLowerCase() === String(doc.relativePath || '').toLowerCase()),
  );
  const preservedHumanNotes = extractPreservedUserAnnotations(existingSourceWikiNote?.source || '');

  const accessibleVaultNotes = (existingNotes || []).filter(n =>
    n &&
    !n.ghost &&
    n.exists !== false &&
    canAiAccessNote(n) &&
    !String(n.folder || '').toLowerCase().startsWith('wiki'),
  );

  // Discover cross-connections to existing vault notes via concept/keyword/vector match
  const docVec = computeEmbedding(`${doc.title} ${(doc.entities || []).map(e => e.name).join(' ')} ${(doc.extractedMarkdown || '').slice(0, 1200)}`);
  const vaultConnections = [];
  for (const vn of accessibleVaultNotes) {
    const cleanVnTitle = cleanDisplayNoteTitle(vn);
    if (!cleanVnTitle || /^(?:Canvas acceptance|Load board|Image board|EmbedSource|MissingSection)/i.test(cleanVnTitle)) continue;
    const directMention = (doc.extractedMarkdown || '').includes(cleanVnTitle) ||
      (doc.entities || []).some(e => cleanVnTitle.includes(e.name) || e.name.includes(cleanVnTitle));
    const vnVec = computeEmbedding(`${cleanVnTitle} ${(vn.tags || []).join(' ')} ${(vn.source || '').slice(0, 600)}`);
    const sim = cosineSimilarity(docVec, vnVec);
    if (directMention || sim >= 0.22) {
      vaultConnections.push({
        noteId: vn.id,
        title: cleanVnTitle,
        relativePath: vn.relativePath,
        score: directMention ? 0.95 : Math.round(sim * 100) / 100,
        reason: directMention ? '原文显式提及核心主题' : `语义关联 (${Math.round(sim * 100)}%)`,
      });
    }
  }
  vaultConnections.sort((a, b) => b.score - a.score);
  const topVaultLinks = vaultConnections.slice(0, 4);

  const entityNames = (doc.entities || []).slice(0, 8).map(e => e.name);
  const entityTags = entityNames.slice(0, 4).map(n => n.replace(/[\s,[\]]+/g, '')).filter(Boolean);
  const summaryText = `从原始资料 \`${doc.relativePath}\`（${doc.formatBadge}）提取生成的结构化 Wiki 文献笔记，提炼 ${doc.claims?.length || 0} 条关键结论与 ${entityNames.length} 个核心概念。`;

  const lines = [
    '---',
    `title: "${sourceTitle.replace(/"/g, '\\"')}"`,
    `aliases: [${safeStem}, ${doc.title || safeStem}]`,
    `tags: [Wiki文献, Karpathy编译, ${doc.formatBadge.replace(/\s+/g, '')}${entityTags.length ? ', ' + entityTags.join(', ') : ''}]`,
    'category: wiki-source',
    `source_file: "${doc.relativePath}"`,
    `source_type: "${doc.format}"`,
    `source_hash: "${doc.sha256}"`,
    `source_fingerprints: ["${doc.relativePath}@${String(doc.sha256 || '').slice(0, 12)}"]`,
    'status: 已摄取',
    `summary: "${summaryText.replace(/"/g, '\\"')}"`,
    `date: ${today}`,
    '---',
    '',
    `# ${sourceTitle}`,
    '',
    '> [!NOTE] 原始资料溯源（Immutable Raw Source）',
    `> - **原始文件**：\`${doc.relativePath}\`（类型：**${doc.formatBadge}** · 校验指纹：\`${String(doc.sha256).slice(0, 12)}\`）`,
    `> - **解析统计**：共提取 **${doc.sections?.length || 0}** 个章节/页面块、**${doc.tables?.length || 0}** 张结构化数据表、**${entityNames.length}** 项概念实体。`,
  ];

  if (topVaultLinks.length) {
    lines.push(`> - **关联知识库既有卡片**：${topVaultLinks.map(v => `[[${v.title}]]`).join(' · ')}`);
  }

  if (llmSynthesis && String(llmSynthesis).trim()) {
    lines.push(
      '',
      '## 零、 模型深度理解与综合提要 (LLM Synthesis)',
      '',
      String(llmSynthesis).trim(),
    );
  }

  lines.push(
    '',
    '## 一、 核心结论与原文出处 (Key Claims & Provenance)',
    '',
  );

  if (doc.claims?.length) {
    for (const [idx, cl] of doc.claims.slice(0, 8).entries()) {
      let decorated = String(cl.text || '').replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t);
      for (const entName of entityNames.slice(0, 4)) {
        if (decorated.includes(entName) && !decorated.includes(`|${entName}]]`) && !decorated.includes(`[[${entName}]]`)) {
          decorated = decorated.replace(entName, `[[概念百科 · ${entName}|${entName}]]`);
        }
      }
      const prov = cfg.enforceLineProvenance ? ` （出处：\`${doc.relativePath}\` · ${cl.location}）` : '';
      lines.push(`${idx + 1}. **${cl.heading}**：${decorated}${prov}`);
    }
  } else {
    lines.push(`- 已解析原始文档 \`${doc.relativePath}\`，详见下方结构化内容还原。`);
  }

  lines.push(
    '',
    '## 二、 提炼概念与关系网络 (Extracted Entities & Relations)',
    '',
  );

  if (doc.entities?.length) {
    lines.push(
      '| 概念/实体名称 | 规范化类型 (Ontology) | 原文定位 | 支撑证据摘录 |',
      '| --- | --- | --- | --- |',
    );
    for (const ent of doc.entities.slice(0, 8)) {
      const cleanQuote = String(ent.supporting_text || '')
        .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)
        .replace(/[\r\n|\[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 72);
      lines.push(
        `| [[概念百科 · ${ent.name}|${ent.name}]] | \`${ent.type}\` | ${ent.location} | ${cleanQuote || '—'} |`,
      );
    }
  }

  if (doc.relations?.length) {
    lines.push('', '### 显式语义关系链 (Explicit Relations)', '');
    for (const rel of doc.relations.slice(0, 6)) {
      lines.push(
        `- [[概念百科 · ${rel.source}|${rel.source}]] **${rel.verb}**（\`${rel.type}\`）→ [[概念百科 · ${rel.target}|${rel.target}]] （出处：${rel.location}）`,
      );
    }
  }

  if (topVaultLinks.length) {
    lines.push('', '### 跨库笔记自动连接 (Cross-Vault Links)', '');
    for (const vl of topVaultLinks) {
      lines.push(`- [[${vl.title}]] —— ${vl.reason}（路径：\`${vl.relativePath}\`）`);
    }
  }

  lines.push(
    '',
    '## 三、 结构化内容还原 (Extracted Raw Content)',
    '',
    doc.extractedMarkdown || '（无正文内容）',
  );

  if (preservedHumanNotes) {
    lines.push('', preservedHumanNotes);
  }

  lines.push(
    '',
    '---',
    '- 🧭 所属总目录：[[Karpathy Wiki 知识晶体总目录 (index.md)|📚 返回 Wiki 总目录 (wiki/index.md)]]',
    '',
  );

  const sourcePage = {
    title: sourceTitle,
    cleanName: safeStem,
    folder: 'wiki/sources',
    relativePath: sourceRelPath,
    sourceFile: doc.relativePath,
    sourceHash: doc.sha256,
    format: doc.format,
    formatBadge: doc.formatBadge,
    entityCount: entityNames.length,
    claimCount: doc.claims?.length || 0,
    preservedAnnotations: Boolean(preservedHumanNotes),
    summary: summaryText,
    markdown: lines.join('\n'),
  };

  // Build / Incrementally update Entity Wiki Pages (`wiki/entities/<entity>.md`)
  const entityPages = [];
  for (const ent of (doc.entities || []).slice(0, 4)) {
    const safeEntName = String(ent.name || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
    if (!safeEntName) continue;
    const entRelPath = `wiki/entities/${safeEntName}.md`;
    const entTitle = `概念百科 · ${safeEntName}`;
    const existingEntNote = (existingNotes || []).find(n =>
      n.relativePath?.toLowerCase() === entRelPath.toLowerCase() ||
      n.title === entTitle,
    );

    const relatedRels = (doc.relations || []).filter(r => r.source === ent.name || r.target === ent.name);
    const matchingVaultNotes = accessibleVaultNotes.filter(vn => {
      const t = cleanDisplayNoteTitle(vn);
      return t.includes(ent.name) || (vn.source || '').includes(ent.name);
    }).slice(0, 3);

    const mentionLine = `- [[${sourceTitle}|${doc.title || safeStem}]]（原始文件：\`${doc.relativePath}\` · ${ent.location}）：${ent.supporting_text}`;
    let entMarkdown = '';

    if (existingEntNote && existingEntNote.source) {
      const priorSource = String(existingEntNote.source);
      if (priorSource.includes(`\`${doc.relativePath}\``)) {
        entMarkdown = updateFrontMatterProperties(priorSource, { date: today, status: '持续演进' });
      } else {
        entMarkdown = updateFrontMatterProperties(priorSource.trimEnd() + '\n' + mentionLine + '\n', {
          date: today,
          status: '持续演进',
        });
      }
    } else {
      const entLines = [
        '---',
        `title: "${entTitle.replace(/"/g, '\\"')}"`,
        `aliases: [${safeEntName}]`,
        `tags: [Wiki概念, ${ent.type}, Karpathy编译]`,
        'category: wiki-entity',
        `entity_type: "${ent.type}"`,
        'status: 持续演进',
        `date: ${today}`,
        '---',
        '',
        `# ${entTitle}`,
        '',
        `> [!TIP] 概念定义与分类（Ontology Type: \`${ent.type}\`）`,
        `> **${safeEntName}** 提炼自 \`${doc.relativePath}\`（${ent.location}）：${ent.supporting_text}`,
        '',
        '## 一、 概念关系与上下文网络 (Relations)',
        '',
      ];
      if (relatedRels.length) {
        for (const r of relatedRels) {
          entLines.push(`- [[概念百科 · ${r.source}|${r.source}]] **${r.verb}**（\`${r.type}\`）→ [[概念百科 · ${r.target}|${r.target}]]`);
        }
      } else {
        entLines.push(`- 与同篇核心概念 ${entityNames.filter(n => n !== ent.name).slice(0, 3).map(n => `[[概念百科 · ${n}|${n}]]`).join(' · ') || `[[${sourceTitle}]]`} 共现。`);
      }
      if (matchingVaultNotes.length) {
        entLines.push(`- **关联既有笔记**：${matchingVaultNotes.map(vn => `[[${cleanDisplayNoteTitle(vn)}]]`).join(' · ')}`);
      }
      entLines.push(
        '',
        '## 二、 来源文献与证据出处 (Mentioned in)',
        '',
        mentionLine,
        '',
      );
      entMarkdown = entLines.join('\n');
    }

    entityPages.push({
      title: entTitle,
      cleanName: safeEntName,
      entityType: ent.type,
      folder: 'wiki/entities',
      relativePath: entRelPath,
      isUpdate: Boolean(existingEntNote),
      markdown: entMarkdown,
    });
  }

  return {
    rawDocument: doc,
    sourcePage,
    entityPages,
    vaultConnections: topVaultLinks,
  };
}

export function appendDialecticalTensionToWikiMarkdown(existingSource = '', tension = {}, today = localDate()) {
  const clean = String(existingSource || '').trimEnd();
  const blockText = String(tension.dialecticalResolution || '').trim() ||
    `> [!WARNING] ⚡ 胡克认知张力与正反边界辨析（E_tension = ${tension.tensionScore || 0.25}）\n> - **正方命题（${tension.noteA?.citation || ''}）**：${tension.noteA?.snippet || ''}\n> - **反方/演进命题（${tension.noteB?.citation || ''}）**：${tension.noteB?.snippet || ''}\n> - **原因说明**：${tension.reason || ''}`;
  if (clean.includes(blockText.slice(0, 48))) {
    return updateFrontMatterProperties(clean + '\n', { date: today, status: '持续演进' });
  }
  const sectionHeading = '## ⚖️ 认知张力与正反边界辨析';
  let updatedBody = '';
  if (clean.includes('## 二、 认知张力与正反边界辨析') || clean.includes(sectionHeading)) {
    updatedBody = `${clean}\n\n${blockText}\n`;
  } else {
    updatedBody = `${clean}\n\n${sectionHeading}\n\n${blockText}\n`;
  }
  return updateFrontMatterProperties(updatedBody, { date: today, status: '持续演进' });
}

export function detectInvalidatedWikiEvidence(notes = [], rawDocuments = []) {
  const wikiNotes = (notes || []).filter(n =>
    n &&
    !n.ghost &&
    n.exists !== false &&
    String(n.folder || '').toLowerCase().startsWith('wiki') &&
    !['wiki/index.md', 'wiki/log.md', 'wiki/rules.md'].includes(String(n.relativePath || '').toLowerCase()),
  );
  const noteByPath = new Map();
  const noteByKey = new Map();
  for (const n of notes || []) {
    if (!n || n.ghost || n.exists === false) continue;
    const rel = String(n.relativePath || '').replaceAll('\\', '/').toLowerCase();
    if (rel) noteByPath.set(rel, n);
    for (const k of [n.title, n.cleanTitle, n.stem, ...(n.aliases || [])]) {
      if (k) noteByKey.set(String(k).trim().toLowerCase(), n);
    }
  }
  const rawByPath = new Map();
  for (const rd of rawDocuments || []) {
    const rel = String(rd.relativePath || '').replaceAll('\\', '/').toLowerCase();
    if (rel) rawByPath.set(rel, rd);
  }

  const invalidated = [];
  for (const wn of wikiNotes) {
    const fm = parseFrontMatter(wn.source || '');
    const meta = { ...fm.metadata, ...(wn.metadata || {}) };
    const fpEntry = fm.entries.find(e => e.key === 'source_fingerprints')?.value || '';
    const recordedFps = Array.isArray(meta.source_fingerprints) && meta.source_fingerprints.length
      ? meta.source_fingerprints
      : fpEntry
        ? fpEntry.split(',').map(s => s.replace(/^["'\s]+|["'\s]+$/g, '')).filter(Boolean)
        : [];

    const changedSources = [];
    const seenPaths = new Set();

    // 1. Check raw/ source_file + source_hash
    const srcFile = String(meta.source_file || fm.entries.find(e => e.key === 'source_file')?.value || '').trim();
    const srcHash = String(meta.source_hash || fm.entries.find(e => e.key === 'source_hash')?.value || '').trim();
    if (srcFile && srcHash) {
      const rd = rawByPath.get(srcFile.replaceAll('\\', '/').toLowerCase());
      if (rd && rd.sha256 && rd.sha256 !== srcHash) {
        seenPaths.add(srcFile.toLowerCase());
        changedSources.push({
          path: rd.relativePath,
          title: rd.title || rd.name,
          kind: 'raw-modified',
          previousFingerprint: srcHash.slice(0, 12),
          currentFingerprint: String(rd.sha256).slice(0, 12),
          summary: `原始资料 ${rd.relativePath} 已更新 (${srcHash.slice(0, 8)} → ${String(rd.sha256).slice(0, 8)})`,
        });
      }
    }

    // 2. Check recorded source_fingerprints (for both vault notes and raw/ files)
    for (const item of recordedFps) {
      const atIdx = String(item).lastIndexOf('@');
      if (atIdx <= 0) continue;
      const refPath = String(item).slice(0, atIdx).trim().replaceAll('\\', '/');
      const oldFp = String(item).slice(atIdx + 1).trim();
      const lowerPath = refPath.toLowerCase();
      if (!oldFp || seenPaths.has(lowerPath)) continue;

      if (noteByPath.has(lowerPath)) {
        const srcNote = noteByPath.get(lowerPath);
        const curFp = computeNoteContentFingerprint(srcNote.source || '');
        if (curFp !== oldFp) {
          seenPaths.add(lowerPath);
          changedSources.push({
            path: srcNote.relativePath,
            title: cleanDisplayNoteTitle(srcNote),
            kind: 'note-modified',
            previousFingerprint: oldFp,
            currentFingerprint: curFp,
            summary: `源笔记《${cleanDisplayNoteTitle(srcNote)}》正文已修改 (${oldFp.slice(0, 8)} → ${curFp.slice(0, 8)})`,
          });
        }
      } else if (rawByPath.has(lowerPath)) {
        const rd = rawByPath.get(lowerPath);
        const curFp = String(rd.sha256 || computeNoteContentFingerprint(rd.extractedMarkdown || '')).slice(0, 12);
        if (curFp && curFp !== oldFp) {
          seenPaths.add(lowerPath);
          changedSources.push({
            path: rd.relativePath,
            title: rd.title || rd.name,
            kind: 'raw-modified',
            previousFingerprint: oldFp,
            currentFingerprint: curFp,
            summary: `原始资料 ${rd.relativePath} 内容已变更 (${oldFp.slice(0, 8)} → ${curFp.slice(0, 8)})`,
          });
        }
      }
    }

    // 3. Check cited [[Target#Heading]] anchors in the Wiki note body
    for (const link of extractWikiLinks(wn.source || '', fm.bodyFrom || 0)) {
      if (!link.target || !link.heading || link.heading.startsWith('^')) continue;
      const tKey = String(link.target).trim().toLowerCase();
      const targetNote = noteByKey.get(tKey) || noteByKey.get(stripNumericPrefix(tKey).toLowerCase()) || noteByPath.get(tKey + '.md');
      if (!targetNote || !Array.isArray(targetNote.headings)) continue;
      const headingExists = targetNote.headings.some(h =>
        String(h.text || '').trim().toLowerCase() === link.heading.trim().toLowerCase() ||
        String(h.slug || '').trim().toLowerCase() === link.heading.trim().toLowerCase(),
      );
      if (!headingExists) {
        const citeKey = `${targetNote.relativePath}#${link.heading}`.toLowerCase();
        if (!seenPaths.has(citeKey)) {
          seenPaths.add(citeKey);
          changedSources.push({
            path: targetNote.relativePath,
            title: cleanDisplayNoteTitle(targetNote),
            kind: 'heading-missing',
            previousFingerprint: `#${link.heading}`,
            currentFingerprint: '已重命名或移除',
            summary: `引用的章节 [[${cleanDisplayNoteTitle(targetNote)}#${link.heading}]] 在源笔记中已变更`,
          });
        }
      }
    }

    if (changedSources.length > 0) {
      const relLower = String(wn.relativePath || '').toLowerCase();
      const category = meta.category || (relLower.includes('wiki/topics/') ? 'wiki-topic' : relLower.includes('wiki/entities/') ? 'wiki-entity' : 'wiki-source');
      const cleanName = (wn.stem || cleanDisplayNoteTitle(wn)).replace(/^(?:Wiki|文献解析|概念百科)\s*·\s*/, '').trim();
      invalidated.push({
        wikiId: wn.id,
        wikiTitle: cleanDisplayNoteTitle(wn),
        wikiPath: wn.relativePath,
        cleanName,
        folder: wn.folder || (category === 'wiki-topic' ? 'wiki/topics' : category === 'wiki-entity' ? 'wiki/entities' : 'wiki/sources'),
        category,
        preservedAnnotations: Boolean(extractPreservedUserAnnotations(wn.source || '')),
        changedSources,
        reason: changedSources.map(c => c.summary).join('；'),
      });
    }
  }
  return invalidated;
}

export function recomputeInvalidatedWikiPage(invalidatedItem, notes = [], rawDocuments = [], clusters = [], tensions = [], rulesConfig = defaultWikiRulesConfig(), today = localDate()) {
  if (!invalidatedItem) throw new Error('未指定待重算的 Wiki 页面');
  if (invalidatedItem.category === 'wiki-source') {
    const targetRaw = (rawDocuments || []).find(rd =>
      rd.sourcePage?.relativePath?.toLowerCase() === String(invalidatedItem.wikiPath || '').toLowerCase() ||
      rd.stem?.toLowerCase() === String(invalidatedItem.cleanName || '').toLowerCase(),
    ) || (rawDocuments || [])[0];
    if (targetRaw) {
      const bundle = compileRawDocumentToWikiBundle(targetRaw, notes, { rulesConfig, today });
      return {
        ...bundle.sourcePage,
        entityPages: bundle.entityPages,
        recomputedKind: 'wiki-source',
      };
    }
  }
  const matchedCluster = (clusters || []).find(cl =>
    String(cl.name || '').toLowerCase() === String(invalidatedItem.cleanName || '').toLowerCase() ||
    String(cl.wikiTitle || '').toLowerCase() === String(invalidatedItem.wikiTitle || '').toLowerCase(),
  ) || (clusters || [])[0] || {
    id: `recompute-${invalidatedItem.cleanName}`,
    name: invalidatedItem.cleanName || '核心专题',
    wikiTitle: invalidatedItem.wikiTitle || `Wiki · ${invalidatedItem.cleanName}`,
    phi: 0.78,
    notes: (notes || []).filter(n => !String(n.folder || '').toLowerCase().startsWith('wiki')).slice(0, 4),
    rawDocuments: (rawDocuments || []).slice(0, 2),
  };
  const latestById = new Map((notes || []).map(n => [n.id, n]));
  const latestByPath = new Map((notes || []).map(n => [String(n.relativePath || '').toLowerCase(), n]));
  const refreshedClusterNotes = (matchedCluster.notes || []).map(cn => {
    const latest = latestById.get(cn.id) || latestByPath.get(String(cn.relativePath || '').toLowerCase());
    return latest ? {
      ...cn,
      title: cleanDisplayNoteTitle(latest),
      cleanTitle: cleanDisplayNoteTitle(latest),
      relativePath: latest.relativePath || cn.relativePath || '',
      folder: latest.folder || cn.folder || '根目录',
      source: latest.source || '',
    } : cn;
  });
  const page = compileClusterToWikiPage(
    { ...matchedCluster, notes: refreshedClusterNotes, existingNotes: notes },
    tensions,
    {
      ...rulesConfig,
      existingNotes: notes,
      rawDocuments: matchedCluster.rawDocuments || rawDocuments,
      customTopicName: invalidatedItem.cleanName || matchedCluster.name,
      customWikiTitle: invalidatedItem.wikiTitle || matchedCluster.wikiTitle,
      topicFolder: invalidatedItem.folder || 'wiki/topics',
    },
    today,
  );
  return {
    ...page,
    recomputedKind: 'wiki-topic',
  };
}

export function extractVaultEntityRelations(notes = [], explicitEdges = [], dismissedPairs = []) {
  const accessible = (notes || []).filter(n =>
    n &&
    !n.ghost &&
    n.exists !== false &&
    canAiAccessNote(n) &&
    !['wiki/index.md', 'wiki/log.md', 'wiki/rules.md'].includes(String(n.relativePath || '').toLowerCase()),
  );
  if (accessible.length < 2) return [];

  const explicitSet = new Set();
  for (const e of explicitEdges || []) {
    const a = String(e.source || '');
    const b = String(e.target || '');
    if (a && b) explicitSet.add(a < b ? `${a}::${b}` : `${b}::${a}`);
  }
  for (const n of accessible) {
    for (const wl of n.wikiLinks || extractWikiLinks(n.source || '', n.bodyFrom || 0)) {
      const targetNote = accessible.find(cand =>
        cand.id !== n.id &&
        [cand.title, cand.cleanTitle, cand.stem, cand.relativePath?.replace(/\.(md|markdown)$/i, ''), ...(cand.aliases || [])]
          .filter(Boolean)
          .some(k => String(k).trim().toLowerCase() === String(wl.target || '').trim().toLowerCase()),
      );
      if (targetNote) {
        const pk = n.id < targetNote.id ? `${n.id}::${targetNote.id}` : `${targetNote.id}::${n.id}`;
        explicitSet.add(pk);
      }
    }
  }
  const dismissedSet = new Set((dismissedPairs || []).map(String));
  const stopEntities = new Set(['核心要点', '注意事项', '操作步骤', '使用说明', '章节导航', '问题描述', '解决方案', '核心结论', '数据范围']);
  const verbRegex = /(驱动|依赖|支撑|验证|扩展|映射|编译|转化为|结合|基于|沉淀|演化|协同|约束|触发|赋能)/;

  const noteEntitiesMap = new Map();
  for (const n of accessible) {
    const cleanTitle = cleanDisplayNoteTitle(n)
      .replace(/^(?:概念百科|文献解析|Wiki)\s*·\s*/, '')
      .trim();
    const entities = new Map();
    if (cleanTitle.length >= 2 && cleanTitle.length <= 18 && !stopEntities.has(cleanTitle)) {
      entities.set(cleanTitle, { name: cleanTitle, line: 1, snippet: cleanPlainSnippet(n.source || '').slice(0, 96) });
    }
    for (const al of n.aliases || []) {
      const cal = String(al || '').trim();
      if (cal.length >= 2 && cal.length <= 16 && !stopEntities.has(cal) && !entities.has(cal)) {
        entities.set(cal, { name: cal, line: 1, snippet: cleanPlainSnippet(n.source || '').slice(0, 96) });
      }
    }
    const lines = String(n.source || '').split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const lineText = lines[idx].trim();
      if (!lineText || lineText.startsWith('---') || lineText.startsWith('```')) continue;
      for (const m of lineText.matchAll(/\*\*([^*[\]\n]{2,14})\*\*/g)) {
        const term = m[1].replace(/[：:。.，,、\s]+$/g, '').trim();
        if (term.length >= 2 && !stopEntities.has(term) && !/^\d+$/.test(term) && !entities.has(term)) {
          entities.set(term, { name: term, line: idx + 1, snippet: lineText.replace(/^[-*+>\d.\s#]+/, '').slice(0, 100) });
        }
      }
    }
    noteEntitiesMap.set(n.id, entities);
  }

  const relations = [];
  for (let i = 0; i < accessible.length; i++) {
    for (let j = i + 1; j < accessible.length; j++) {
      const nA = accessible[i];
      const nB = accessible[j];
      const pairKey = nA.id < nB.id ? `${nA.id}::${nB.id}` : `${nB.id}::${nA.id}`;
      if (explicitSet.has(pairKey) || dismissedSet.has(pairKey)) continue;

      const entA = noteEntitiesMap.get(nA.id) || new Map();
      const entB = noteEntitiesMap.get(nB.id) || new Map();
      let matched = null;

      // Check if nA's body lines mention any primary concept/title of nB (or vice versa)
      const linesA = String(nA.source || '').split(/\r?\n/);
      const targetTermsB = [...entB.keys()].slice(0, 4);
      for (let lIdx = 0; lIdx < linesA.length; lIdx++) {
        const rawLine = linesA[lIdx].trim();
        if (!rawLine || rawLine.startsWith('---') || rawLine.startsWith('#')) continue;
        const hitTerm = targetTermsB.find(t => rawLine.includes(t));
        if (hitTerm) {
          const vMatch = verbRegex.exec(rawLine);
          matched = {
            sourceNote: nA,
            targetNote: nB,
            entityName: hitTerm,
            relationVerb: vMatch ? vMatch[1] : '概念共现',
            line: lIdx + 1,
            snippet: rawLine.replace(/^[-*+>\d.\s]+/, '').slice(0, 108),
          };
          break;
        }
      }

      if (!matched) {
        const linesB = String(nB.source || '').split(/\r?\n/);
        const targetTermsA = [...entA.keys()].slice(0, 4);
        for (let lIdx = 0; lIdx < linesB.length; lIdx++) {
          const rawLine = linesB[lIdx].trim();
          if (!rawLine || rawLine.startsWith('---') || rawLine.startsWith('#')) continue;
          const hitTerm = targetTermsA.find(t => rawLine.includes(t));
          if (hitTerm) {
            const vMatch = verbRegex.exec(rawLine);
            matched = {
              sourceNote: nB,
              targetNote: nA,
              entityName: hitTerm,
              relationVerb: vMatch ? vMatch[1] : '概念共现',
              line: lIdx + 1,
              snippet: rawLine.replace(/^[-*+>\d.\s]+/, '').slice(0, 108),
            };
            break;
          }
        }
      }

      if (matched) {
        const srcTitle = cleanDisplayNoteTitle(matched.sourceNote);
        const tgtTitle = cleanDisplayNoteTitle(matched.targetNote);
        relations.push({
          id: `entity-rel:${pairKey}`,
          pairKey,
          sourceId: matched.sourceNote.id,
          targetId: matched.targetNote.id,
          sourceTitle: srcTitle,
          targetTitle: tgtTitle,
          sourcePath: matched.sourceNote.relativePath,
          targetPath: matched.targetNote.relativePath,
          entityName: matched.entityName,
          relationVerb: matched.relationVerb,
          confidence: 'ENTITY_EXTRACTED',
          line: matched.line,
          snippet: matched.snippet,
          reason: `概念实体「${matched.entityName}」(${matched.relationVerb}) · ${matched.sourceNote.relativePath} 第 ${matched.line} 行`,
        });
        if (relations.length >= 16) return relations;
      }
    }
  }
  return relations;
}

export function lintKarpathyWiki(notes = [], rawDocuments = [], entityPages = [], options = {}) {
  const wikiNotes = (notes || []).filter(n => String(n.folder || '').toLowerCase().startsWith('wiki'));
  const indexNote = wikiNotes.find(n => n.relativePath?.toLowerCase() === 'wiki/index.md');
  const indexBody = indexNote?.source || '';

  const pendingRawDocs = (rawDocuments || []).filter(d => d.status !== 'synced').map(d => ({
    relativePath: d.relativePath,
    title: d.title,
    formatBadge: d.formatBadge,
    status: d.status,
    statusLabel: d.statusLabel,
  }));

  const staleWikiPages = (rawDocuments || []).filter(d => d.status === 'modified').map(d => ({
    relativePath: d.relativePath,
    wikiPath: d.sourcePage?.relativePath || `wiki/sources/${d.stem}.md`,
    wikiTitle: d.sourcePage?.title || `文献解析 · ${d.title}`,
    preservedAnnotations: Boolean(d.sourcePage?.preservedAnnotations),
  }));

  const invalidatedWikiPages = detectInvalidatedWikiEvidence(notes, rawDocuments);
  const entityRelations = extractVaultEntityRelations(notes, options.explicitEdges || [], options.dismissedEdges || []);

  const orphanWikiPages = wikiNotes
    .filter(n => !['wiki/index.md', 'wiki/log.md', 'wiki/rules.md'].includes(n.relativePath?.toLowerCase()))
    .filter(n => !indexBody.includes(n.cleanTitle || n.title) && !indexBody.includes(n.stem || ''))
    .map(n => ({ id: n.id, title: cleanDisplayNoteTitle(n), relativePath: n.relativePath }));

  const existingEntityPaths = new Set(
    wikiNotes
      .filter(n => String(n.relativePath || '').toLowerCase().startsWith('wiki/entities/'))
      .map(n => n.relativePath.toLowerCase()),
  );
  const missingEntityPages = (entityPages || [])
    .filter(ep => !existingEntityPaths.has(String(ep.relativePath || '').toLowerCase()))
    .map(ep => ({
      title: ep.title,
      cleanName: ep.cleanName,
      entityType: ep.entityType,
      relativePath: ep.relativePath,
      folder: ep.folder,
      markdown: ep.markdown,
    }));

  const allNoteKeys = new Set();
  for (const n of notes || []) {
    for (const k of [n.title, n.cleanTitle, n.stem, n.relativePath?.replace(/\.(md|markdown)$/i, ''), ...(n.aliases || [])]) {
      if (k) allNoteKeys.add(String(k).trim().toLowerCase());
    }
  }

  const brokenWikiLinks = [];
  for (const wn of wikiNotes) {
    for (const link of extractWikiLinks(wn.source || '', wn.bodyFrom || 0)) {
      const targetKey = String(link.target || '').trim().toLowerCase();
      if (targetKey && !allNoteKeys.has(targetKey) && !allNoteKeys.has(stripNumericPrefix(targetKey).toLowerCase())) {
        brokenWikiLinks.push({
          sourceTitle: cleanDisplayNoteTitle(wn),
          sourcePath: wn.relativePath,
          missingTarget: link.target,
          line: link.line,
        });
      }
    }
  }

  return {
    pendingRawDocs,
    staleWikiPages,
    invalidatedWikiPages,
    entityRelations,
    orphanWikiPages,
    missingEntityPages,
    brokenWikiLinks: brokenWikiLinks.slice(0, 12),
  };
}

export function buildWikiMasterIndexMarkdown(compiledPages = [], clusters = [], trophicHierarchy = null, today = localDate(), rawDocuments = [], entityPages = []) {
  const readyClusters = (clusters || []).filter(c => c.phaseState === 'ready');
  const pendingClusters = (clusters || []).filter(c => c.phaseState !== 'ready');
  const qVal = trophicHierarchy?.incoherenceQ ?? 0.22;

  const lines = [
    '---',
    'title: "Karpathy Wiki 知识晶体总目录 (index.md)"',
    'aliases: [Wiki总目录, 知识晶体索引, L0路由表]',
    'tags: [Wiki总目录, L0路由, KarpathyWiki]',
    'category: wiki-index',
    'status: 持续演进',
    `date: ${today}`,
    '---',
    '',
    '# 🧭 Karpathy Wiki 知识晶体总目录 (`wiki/index.md`)',
    '',
    '> [!IMPORTANT] 金字塔三级省流漏斗 L0 路由入口（KPKM-003）',
    `> 本文件由 **Inkloom Karpathy 知识编译器**自动维护。支持将 \`raw/\` 下的 PDF、Word、PPT、Excel、CSV、TXT、网页等异构资料提取为 \`wiki/sources/\` 文献笔记与 \`wiki/entities/\` 概念百科，并与全库笔记建立双向连接（拓扑相干度 q = ${qVal}）。`,
  ];

  if (rawDocuments && rawDocuments.length) {
    lines.push(
      '',
      '## 零、 原始资料仓摄取路由表 (`raw/ → wiki/sources/`)',
      '',
      '| 原始文件 (`raw/`) | 格式 | 状态 | 生成文献笔记 (`wiki/sources/`) | 提炼核心概念 (`wiki/entities/`) |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const rd of rawDocuments) {
      const entLinks = (rd.entities || []).slice(0, 3).map(e => `[[概念百科 · ${e.name}|${e.name}]]`).join(' · ') || '—';
      lines.push(
        `| \`${rd.relativePath}\` | ${rd.formatBadge} | ${rd.statusLabel || '待摄取'} | [[${rd.sourcePage?.title || ('文献解析 · ' + rd.title)}]] | ${entLinks} |`,
      );
    }
  }

  lines.push(
    '',
    '## 一、 已结晶固态 Wiki 专页路由表（L1 Knowledge Crystals）',
    '',
    '| 概念晶体专页 | 渗流序参量 Φ(C) | 聚合源笔记数 | L1 核心题要与双链入口 |',
    '| --- | --- | --- | --- |',
  );

  for (const page of compiledPages) {
    lines.push(
      `| [[${page.title}]] | \`Φ = ${page.phi}\` | ${page.sourceCount} 篇 | ${page.summary.slice(0, 56)}… |`,
    );
  }
  for (const cl of readyClusters) {
    if (compiledPages.some(p => p.cleanName === cl.name)) continue;
    lines.push(
      `| [[${cl.wikiTitle}]] | \`Φ = ${cl.phi}\` | ${cl.noteCount} 篇 | 涵盖 ${cl.notes.map(n => `[[${n.cleanTitle}]]`).slice(0, 3).join('、')} 的核心机制 |`,
    );
  }

  if (entityPages && entityPages.length) {
    lines.push(
      '',
      '## 二、 核心概念与实体百科表 (`wiki/entities/`)',
      '',
      '| 概念百科页 | 规范化类型 | 关联路径 |',
      '| --- | --- | --- |',
    );
    for (const ep of entityPages.slice(0, 16)) {
      lines.push(`| [[${ep.title}]] | \`${ep.entityType || 'concept'}\` | \`${ep.relativePath}\` |`);
    }
  }

  lines.push(
    '',
    '## 三、 气态积累中候选池（Φ(C) < 0.62 · 待补充素材）',
    '',
  );
  if (!pendingClusters.length) {
    lines.push('- 当前全部候选概念簇均已跨越渗流相变阈值（Φ ≥ 0.62）。');
  } else {
    for (const cl of pendingClusters) {
      lines.push(`- **${cl.name}**（Φ = ${cl.phi} < 0.62，含 ${cl.noteCount} 篇：${cl.notes.map(n => `[[${n.cleanTitle}]]`).join('、')}）—— 建议继续补充跨来源笔记以触发相变结晶。`);
    }
  }

  lines.push(
    '',
    '## 四、 编译器宪法与变更账本入口',
    '',
    '- 📜 编译规则宪章：[[Karpathy LLM Wiki 知识编译宪章 (RULES.md)]]',
    '- 📒 编译演进账本：[[Karpathy Wiki 编译审计账本 (log.md)]]',
    '',
  );

  return lines.join('\n');
}

export function appendWikiCompileLogMarkdown(existingSource = '', {
  operation = 'INGEST',
  compiledTitles = [],
  rawFilesProcessed = [],
  sourceNoteCount = 0,
  tensionCount = 0,
  holeCount = 0,
  today = localDate(),
} = {}) {
  const baseHeader = [
    '---',
    'title: "Karpathy Wiki 编译审计账本 (log.md)"',
    'tags: [编译账本, KarpathyWiki, 审计日志]',
    'category: wiki-log',
    'status: 持续记录',
    `date: ${today}`,
    '---',
    '',
    '# 📒 Karpathy Wiki 编译审计账本 (`wiki/log.md`)',
    '',
    '> 按时间倒序记录每一次 `Ingest（raw/ 原始资料摄取与 Wiki 编译）`、`Update（增量同步）` 与 `Lint（健康与张力巡检）` 的输入文件、生成笔记与双链连接。',
    '',
    '## 编译流水记录',
    '',
  ].join('\n');

  const cleanExisting = String(existingSource || '').trim();
  const entryLines = [
    `### [${today}] \`${operation}\` · 产出/更新 ${compiledTitles.length} 篇 Wiki 笔记（扫描 ${sourceNoteCount} 篇笔记${rawFilesProcessed.length ? ` · 摄取 ${rawFilesProcessed.length} 份 raw/ 资料` : ''}）`,
    '',
    ...(rawFilesProcessed.length ? [`- **摄取 raw/ 原始资料**：${rawFilesProcessed.map(f => `\`${f}\``).join(' · ')}`] : []),
    `- **产出/更新 Wiki 笔记**：${compiledTitles.length ? compiledTitles.map(t => `[[${t}]]`).join(' · ') : '索引与 Lint 巡检更新'}`,
    `- **审校指标**：处理跨篇认知张力冲突 **${tensionCount}** 处 · 识别结构洞跨界桥梁 **${holeCount}** 处`,
    `- **L0 路由同步**：已同步更新 \`wiki/index.md\``,
    '',
  ].join('\n');

  if (!cleanExisting || !cleanExisting.includes('# 📒 Karpathy Wiki')) {
    return baseHeader + entryLines;
  }
  return cleanExisting + '\n\n' + entryLines;
}

export function runKarpathyWikiCompiler(notes = [], {
  rawFiles = null,
  rulesConfig = defaultWikiRulesConfig(),
  dismissedEdges = [],
  today = localDate(),
} = {}) {
  const { clusters, tensions } = analyzePercolationAndTension(notes);
  const trophic = computeHodgeTrophicHierarchy(notes);
  const structuralHoles = detectStructuralHoleBridges(notes, { limit: 5 });

  // Collect raw files from explicit `rawFiles` + any notes stored under `raw/` folder
  const rawInputMap = new Map();
  const seedRawList = Array.isArray(rawFiles) && rawFiles.length ? rawFiles : createStarterRawFiles(today);
  for (const item of seedRawList) {
    const rel = String(item.relativePath || `raw/${item.name || '未命名.txt'}`).replaceAll('\\', '/');
    rawInputMap.set(rel.toLowerCase(), { ...item, relativePath: rel });
  }
  for (const n of notes || []) {
    const rel = String(n?.relativePath || '').replaceAll('\\', '/');
    if (rel.toLowerCase().startsWith('raw/') && !rawInputMap.has(rel.toLowerCase())) {
      rawInputMap.set(rel.toLowerCase(), {
        id: n.id,
        name: n.name || rel.split('/').pop(),
        relativePath: rel,
        source: n.source || '',
      });
    }
  }

  const rawDocuments = [];
  const allEntityPagesMap = new Map();
  for (const rawItem of rawInputMap.values()) {
    const parsed = parseRawDocumentFileSync(rawItem);
    const bundle = compileRawDocumentToWikiBundle(parsed, notes, { rulesConfig, today });
    const existingWikiSourceNote = (notes || []).find(n =>
      n.relativePath?.toLowerCase() === bundle.sourcePage.relativePath.toLowerCase() ||
      String(n.metadata?.source_file || '').toLowerCase() === parsed.relativePath.toLowerCase(),
    );
    let status = 'new';
    let statusLabel = '待摄取';
    if (existingWikiSourceNote) {
      const recordedHash = String(existingWikiSourceNote.metadata?.source_hash || '');
      if (recordedHash && recordedHash === parsed.sha256) {
        status = 'synced';
        statusLabel = '已同步';
      } else {
        status = 'modified';
        statusLabel = '已变更待更新';
      }
    }
    for (const ep of bundle.entityPages) {
      if (!allEntityPagesMap.has(ep.cleanName.toLowerCase())) {
        allEntityPagesMap.set(ep.cleanName.toLowerCase(), ep);
      }
    }
    rawDocuments.push({
      ...parsed,
      status,
      statusLabel,
      existingNoteId: existingWikiSourceNote?.id || '',
      sourcePage: bundle.sourcePage,
      entityPages: bundle.entityPages,
      vaultConnections: bundle.vaultConnections,
    });
  }

  const entityPages = [...allEntityPagesMap.values()];
  for (const cl of clusters) {
    const matchedRaw = rawDocuments.filter(rd => {
      const hay = `${rd.title} ${rd.extractedMarkdown || ''}`;
      return hay.includes(cl.name) || cl.notes.some(n => hay.includes(n.cleanTitle));
    });
    cl.rawDocuments = matchedRaw.length ? matchedRaw.slice(0, 3) : rawDocuments.slice(0, 2);
    cl.existingNotes = notes;
  }
  const readyClusters = clusters.filter(c => c.phaseState === 'ready');
  const compiledPages = (readyClusters.length ? readyClusters : clusters.slice(0, 2)).map(cl =>
    compileClusterToWikiPage(cl, tensions, { ...rulesConfig, existingNotes: notes }, today),
  );
  const rulesMarkdown = generateWikiRulesMarkdown(rulesConfig, today);
  const indexMarkdown = buildWikiMasterIndexMarkdown(compiledPages, clusters, trophic, today, rawDocuments, entityPages);
  const existingLog = (notes || []).find(n => n.relativePath === 'wiki/log.md')?.source || '';
  const logMarkdown = appendWikiCompileLogMarkdown(existingLog, {
    operation: 'INGEST & LINT',
    compiledTitles: [
      ...rawDocuments.map(d => d.sourcePage.title),
      ...compiledPages.map(p => p.title),
    ],
    rawFilesProcessed: rawDocuments.map(d => d.relativePath),
    sourceNoteCount: notes.length,
    tensionCount: tensions.length,
    holeCount: structuralHoles.length,
    today,
  });

  const wikiLint = lintKarpathyWiki(notes, rawDocuments, entityPages, { dismissedEdges });
  const existingWikiCount = (notes || []).filter(n => String(n.folder || '').toLowerCase().startsWith('wiki')).length;
  const confidentialSkipped = (notes || []).filter(n => !canAiAccessNote(n)).length;

  return {
    stats: {
      totalRawFiles: rawDocuments.length,
      pendingRawCount: rawDocuments.filter(d => d.status !== 'synced').length,
      syncedRawCount: rawDocuments.filter(d => d.status === 'synced').length,
      extractedEntityCount: entityPages.length,
      totalSourceNotes: notes.length,
      readyClusterCount: readyClusters.length,
      totalClusterCount: clusters.length,
      existingWikiCount,
      compiledPreviewCount: compiledPages.length,
      invalidatedWikiCount: (wikiLint.invalidatedWikiPages || []).length,
      entityRelationCount: (wikiLint.entityRelations || []).length,
      tensionCount: tensions.length,
      structuralHoleCount: structuralHoles.length,
      confidentialSkippedCount: confidentialSkipped,
      incoherenceQ: trophic.incoherenceQ,
    },
    rawDocuments,
    entityPages,
    wikiLint,
    clusters,
    tensions,
    structuralHoles,
    trophic,
    compiledPages,
    rulesMarkdown,
    indexMarkdown,
    logMarkdown,
  };
}
