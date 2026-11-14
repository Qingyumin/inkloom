import { parseFrontMatter, extractWikiLinks, nonCodeLineRanges, maskInlineCode, stripNumericPrefix } from './vault-graph.mjs';
import { computeEmbedding, cosineSimilarity, tokenizeText } from './ai-retrieval.mjs';

const validModes = new Set(['manual', 'semi-auto', 'auto']);
const validEngines = new Set(['offline-cosine', 'local-llm', 'online-llm']);

export function validateSmartWikiLinkSettings(input = {}) {
  const mode = validModes.has(input.mode) ? input.mode : 'semi-auto';
  const engine = validEngines.has(input.engine) ? input.engine : 'offline-cosine';
  const minScore = Math.min(0.98, Math.max(0.2, Number(input.minScore) || 0.35));
  const autoOnSave = Boolean(input.autoOnSave);
  return { mode, engine, minScore, autoOnSave };
}

function isValidConceptTerm(term) {
  if (!term || term.length < 2 || term.length > 24) return false;
  if (/^\d+$/.test(term) || /^[0-9a-f_-]+$/i.test(term)) return false;
  return /[\u4e00-\u9fa5]{2,}|[A-Za-z]{4,}/.test(term);
}

function extractCandidateTermsFromTarget(note) {
  const rawTerms = [
    note.cleanTitle,
    note.title,
    note.stem,
    ...(note.aliases || []),
  ].map(t => String(t || '').trim()).filter(t => t.length >= 2);

  const subTerms = [];
  for (const term of rawTerms) {
    for (const part of term.split(/(?:[·:：、，,\s/()-]|与|和|及)+/)) {
      const clean = stripNumericPrefix(part.trim());
      if (isValidConceptTerm(clean)) subTerms.push(clean);
    }
  }
  for (const heading of note.headings || []) {
    const clean = stripNumericPrefix(String(heading?.text || heading || '').trim());
    if (isValidConceptTerm(clean) && clean.length >= 4) subTerms.push(clean);
  }
  return {
    exactTerms: [...new Set(rawTerms)].sort((a, b) => b.length - a.length),
    conceptTerms: [...new Set(subTerms)].filter(t => !rawTerms.includes(t)).sort((a, b) => b.length - a.length),
  };
}

export function discoverSmartWikiLinks(notes, activeNote, {
  engine = 'offline-cosine',
  minScore = 0.35,
  limit = 20,
  llmConfirmedTargets = null,
} = {}) {
  if (!activeNote || typeof activeNote.source !== 'string') return [];
  const source = activeNote.source;
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const fm = parseFrontMatter(source.slice(bom));
  const bodyFrom = bom + fm.bodyFrom;
  const existingLinks = extractWikiLinks(source, bodyFrom);
  const alreadyLinkedTargets = new Set(existingLinks.map(l => String(l.target || '').toLocaleLowerCase()));

  const candidates = notes.filter(n => n && n.id !== activeNote.id && n.exists !== false && !n.ghost);
  if (!candidates.length) return [];

  const targetProfiles = candidates.map(target => ({
    note: target,
    vector: computeEmbedding((target.title || '') + ' ' + (target.aliases || []).join(' ') + ' ' + (target.source || target.excerpt || '').slice(0, 1200)),
    terms: extractCandidateTermsFromTarget(target),
  }));

  const bodyVector = computeEmbedding(source.slice(bodyFrom, bodyFrom + 3000));
  const bestByTarget = new Map();

  for (const line of nonCodeLineRanges(source, bodyFrom)) {
    if (/^\s*#{1,6}\s/.test(line.text) || /^\s*>?\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(line.text)) continue;
    const masked = maskInlineCode(line.text)
      .replace(/!?(?:\\?\[){2,}[^\]]+?(?:\\?\]){2,}|!?\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s)]+/g, m => ' '.repeat(m.length))
      .replace(/(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]{0,47}[ \t]*$/g, m => ' '.repeat(m.length));
    if (!masked.trim()) continue;
    const lineVec = computeEmbedding(masked);

    for (const profile of targetProfiles) {
      const { note: target, vector: targetVec, terms } = profile;
      const targetStem = String(target.cleanTitle || target.title || target.stem || '').trim();
      if (!targetStem) continue;

      const docCosine = Math.max(0, cosineSimilarity(bodyVector, targetVec));
      const lineCosine = Math.max(0, cosineSimilarity(lineVec, targetVec));
      const combinedCosine = Math.round((docCosine * 0.45 + lineCosine * 0.55) * 100) / 100;

      // 1. Check exact title/alias match
      let matchedTerm = '';
      let matchOffset = -1;
      let matchKind = 'exact';
      for (const term of terms.exactTerms) {
        const idx = masked.indexOf(term);
        if (idx >= 0) {
          matchedTerm = term;
          matchOffset = idx;
          matchKind = 'exact';
          break;
        }
      }

      // 2. If no exact title match, check semantic concept term match when cosine similarity is strong
      if (matchOffset < 0 && combinedCosine >= Math.max(0.22, minScore * 0.65)) {
        for (const concept of terms.conceptTerms) {
          if (concept.length < 2) continue;
          const idx = masked.indexOf(concept);
          if (idx >= 0) {
            matchedTerm = concept;
            matchOffset = idx;
            matchKind = 'cosine-concept';
            break;
          }
        }
      }

      if (matchOffset < 0) continue;
      const from = line.from + matchOffset;
      const to = from + matchedTerm.length;
      if (existingLinks.some(link => from < link.to && to > link.from)) continue;

      let score = matchKind === 'exact'
        ? Math.min(0.99, Math.round((0.76 + combinedCosine * 0.23) * 100) / 100)
        : Math.min(0.92, Math.round((0.45 + combinedCosine * 0.48) * 100) / 100);

      let engineBadge = '离线余弦+词法';
      if (engine === 'local-llm' || engine === 'online-llm') {
        const label = engine === 'local-llm' ? '本地小模型' : '在线大模型';
        if (llmConfirmedTargets instanceof Set) {
          if (llmConfirmedTargets.has(target.id) || llmConfirmedTargets.has(targetStem.toLocaleLowerCase()) || llmConfirmedTargets.has(matchedTerm.toLocaleLowerCase())) {
            score = Math.min(0.99, Math.round((score + 0.12) * 100) / 100);
            engineBadge = label + '确认';
          } else {
            engineBadge = label + '+余弦协同';
          }
        } else {
          engineBadge = label + '+余弦协同';
        }
      }

      if (score < minScore) continue;
      const replacement = matchedTerm === targetStem || matchedTerm === target.title
        ? `[[${targetStem}]]`
        : `[[${targetStem}|${matchedTerm}]]`;

      const prev = bestByTarget.get(target.id);
      if (prev && (prev.score > score || (prev.score === score && prev.matchKind === 'exact'))) continue;

      bestByTarget.set(target.id, {
        id: `${target.id}:${from}-${to}`,
        targetId: target.id,
        targetTitle: target.title || targetStem,
        targetStem,
        matchedTerm,
        replacement,
        from,
        to,
        line: line.lineNum,
        snippet: line.text.trim().slice(0, 140),
        cosine: combinedCosine,
        score,
        matchKind,
        alreadyLinkedInNote: alreadyLinkedTargets.has(targetStem.toLocaleLowerCase()) || alreadyLinkedTargets.has(String(target.title || '').toLocaleLowerCase()),
        engine: engineBadge,
      });
    }
  }

  const suggestions = [...bestByTarget.values()];
  suggestions.sort((a, b) => Number(a.alreadyLinkedInNote) - Number(b.alreadyLinkedInNote) || b.score - a.score || a.from - b.from);
  return suggestions.slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));
}

export function applySmartWikiLinks(source, suggestions = [], {
  onlyUnlinkedTargets = true,
  minScore = 0.35,
  maxLinks = 12,
} = {}) {
  if (typeof source !== 'string' || !Array.isArray(suggestions) || !suggestions.length) {
    return { source, appliedCount: 0, applied: [] };
  }
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const fm = parseFrontMatter(source.slice(bom));
  const bodyFrom = bom + fm.bodyFrom;

  const eligible = suggestions
    .filter(item => item && Number.isInteger(item.from) && Number.isInteger(item.to) && item.from >= bodyFrom && item.to > item.from && item.to <= source.length)
    .filter(item => (item.score ?? 1) >= minScore && (!onlyUnlinkedTargets || !item.alreadyLinkedInNote))
    .filter(item => source.slice(item.from, item.to) === item.matchedTerm)
    .slice(0, maxLinks)
    .sort((a, b) => a.from - b.from);

  const nonOverlapping = [];
  const usedTargets = new Set();
  let lastTo = -1;
  for (const item of eligible) {
    if (item.from < lastTo || usedTargets.has(item.targetId)) continue;
    nonOverlapping.push(item);
    usedTargets.add(item.targetId);
    lastTo = item.to;
  }

  if (!nonOverlapping.length) return { source, appliedCount: 0, applied: [] };
  let updated = source;
  for (const item of [...nonOverlapping].reverse()) {
    updated = updated.slice(0, item.from) + item.replacement + updated.slice(item.to);
  }
  return {
    source: updated,
    appliedCount: nonOverlapping.length,
    applied: nonOverlapping,
  };
}

export function buildLlmWikiLinkPrompt(noteSource = '', candidates = []) {
  const snippet = String(noteSource || '').slice(0, 1200);
  const list = candidates.slice(0, 12).map((c, idx) => `${idx + 1}. 词项「${c.matchedTerm}」 -> 目标笔记《${c.targetTitle}》(余弦 ${c.cosine})`).join('\n');
  return {
    systemPrompt: '你是知识库双链分析助手。请从候选双链列表中挑出最值得建立双向链接的笔记标题，直接输出选中的目标笔记标题即可。',
    userPrompt: `当前笔记片段：\n${snippet}\n\n候选双链：\n${list}\n\n请确认应关联的目标笔记：`,
  };
}
