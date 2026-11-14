import { parseFrontMatter, nonCodeLineRanges, stripNumericPrefix, localDate, parseWikiLinkBody, unescapeWikiLinksInMarkdown } from './vault-graph.mjs';
import { buildStoredZipBytes, unpackZipEntries } from './raw-document-ingestor.mjs';

const SR_TAG_RE = /\s*@sr\(due=(\d{4}-\d{2}-\d{2}),interval=(\d+),ease=(\d+(?:\.\d+)?),reps=(\d+)\)\s*$/;

export function cleanFlashcardMarkdown(rawText = '') {
  let text = unescapeWikiLinksInMarkdown(String(rawText || '').trim());
  text = text.replace(/(?:\\?\[){1,2}([^\]\n|]+)\|$/g, '[[$1]]');
  text = text.replace(/\\([\[\]])/g, '$1');
  return text.trim();
}

export function formatFlashcardPlainText(rawText = '') {
  const cleaned = cleanFlashcardMarkdown(rawText);
  return cleaned
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[\[([^\][\n]+?)\]\]/g, (_, inner) => {
      const parsed = parseWikiLinkBody(inner);
      return parsed.display || inner;
    })
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .trim();
}

export function parseFlashcardRichSegments(rawText = '') {
  const cleaned = cleanFlashcardMarkdown(rawText);
  const segments = [];
  const tokenRe = /`([^`]+)`|(!?)\[\[([^\][\n]+?)\]\]|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  for (const match of cleaned.matchAll(tokenRe)) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: cleaned.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'code', text: match[1] });
    } else if (match[3] !== undefined) {
      const parsed = parseWikiLinkBody(match[3]);
      segments.push({
        type: 'wikilink',
        raw: `[[${match[3]}]]`,
        target: parsed.target,
        heading: parsed.heading,
        display: parsed.display || match[3],
      });
    } else if (match[4] !== undefined) {
      segments.push({ type: 'strong', text: match[4] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < cleaned.length) {
    segments.push({ type: 'text', text: cleaned.slice(lastIndex) });
  }
  return segments.length ? segments : [{ type: 'text', text: cleaned }];
}

export function parseSrMetadata(text = '') {
  const match = SR_TAG_RE.exec(String(text));
  if (!match) return null;
  return {
    due: match[1],
    interval: Number(match[2]),
    ease: Number(match[3]),
    reps: Number(match[4]),
    rawTag: match[0],
  };
}

export function formatSrMetadata({ due, interval, ease, reps }) {
  const safeInterval = Math.max(1, Math.round(Number(interval) || 1));
  const safeEase = Math.min(3.5, Math.max(1.3, Number(ease) || 2.5)).toFixed(2);
  const safeReps = Math.max(0, Math.round(Number(reps) || 0));
  return `@sr(due=${due},interval=${safeInterval},ease=${safeEase},reps=${safeReps})`;
}

function addDays(dateStr, days) {
  const base = Date.parse(String(dateStr).slice(0, 10) + 'T12:00:00Z') || Date.now();
  const next = new Date(base + Math.max(1, Math.round(days)) * 86400000);
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function computeNextSchedule(current = null, grade = 'good', today = localDate()) {
  const prevInterval = current?.interval || 0;
  const prevEase = current?.ease || 2.5;
  const prevReps = current?.reps || 0;

  let interval = 1;
  let ease = prevEase;
  let reps = prevReps;

  if (grade === 'again') {
    interval = 1;
    ease = Math.max(1.3, prevEase - 0.2);
    reps = 0;
  } else if (grade === 'hard') {
    interval = prevReps === 0 ? 1 : Math.max(2, Math.round(prevInterval * 1.2));
    ease = Math.max(1.3, prevEase - 0.15);
    reps = prevReps + 1;
  } else if (grade === 'easy') {
    interval = prevReps === 0 ? 4 : prevReps === 1 ? 7 : Math.max(5, Math.round(prevInterval * prevEase * 1.3));
    ease = Math.min(3.5, prevEase + 0.15);
    reps = prevReps + 1;
  } else {
    // 'good'
    interval = prevReps === 0 ? 1 : prevReps === 1 ? 3 : Math.max(2, Math.round(prevInterval * prevEase));
    reps = prevReps + 1;
  }

  const due = addDays(today, interval);
  return {
    due,
    interval,
    ease: Math.round(ease * 100) / 100,
    reps,
    tag: formatSrMetadata({ due, interval, ease, reps }),
  };
}

export function isHardFlashcard(schedule) {
  if (!schedule) return false;
  const ease = Number(schedule.ease || 2.5);
  const reps = Number(schedule.reps || 0);
  return ease <= 2.35 || (reps === 0 && ease < 2.5);
}

export function extractFlashcardsFromNotes(notes = [], { today = localDate(), versions = new Map() } = {}) {
  const cards = [];
  for (const note of notes || []) {
    if (!note || note.exists === false || note.ghost || typeof note.source !== 'string') continue;
    if (note.metadata?.category === 'whiteboard') continue;

    const src = note.source;
    const bom = src.startsWith('\uFEFF') ? 1 : 0;
    const fm = parseFrontMatter(src.slice(bom));
    const bodyFrom = bom + fm.bodyFrom;
    const lines = nonCodeLineRanges(src, bodyFrom);
    const noteStem = stripNumericPrefix(note.cleanTitle || note.title || note.stem || '');
    const noteFolder = String(note.folder || (typeof note.relativePath === 'string' && note.relativePath.includes('/')
      ? note.relativePath.split('/').slice(0, -1).join('/')
      : '根目录')).trim() || '根目录';
    const rawTags = Array.isArray(note.tags) && note.tags.length
      ? note.tags
      : Array.isArray(fm.metadata?.tags)
        ? fm.metadata.tags
        : [];
    const bodyTags = Array.from(src.slice(bodyFrom).matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]{1,32})/gu), match => match[1]);
    const noteTags = [...new Set([...rawTags, ...bodyTags].map(tag => String(tag || '').replace(/^#+/, '').trim()).filter(Boolean))];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.text.trim();
      if (!text) continue;

      // 1. Inline 'Term :: Definition' syntax (excluding URLs like https://)
      const sepMatch = /^([^:`#>\[\]]{2,80}?)\s*::\s*(.+)$/.exec(text);
      if (sepMatch && !/https?:$/i.test(sepMatch[1])) {
        const rawBack = sepMatch[2].trim();
        const sr = parseSrMetadata(rawBack);
        const cleanBack = cleanFlashcardMarkdown(sr ? rawBack.slice(0, rawBack.length - sr.rawTag.length).trim() : rawBack);
        const cleanFront = formatFlashcardPlainText(sepMatch[1].trim());
        const isDue = !sr || sr.due <= today;
        cards.push({
          id: `${note.id}:line:${line.lineNum}`,
          noteId: note.id,
          noteTitle: note.title || noteStem,
          folder: noteFolder,
          tags: noteTags,
          citation: `[[${noteStem}]]`,
          kind: 'inline-pair',
          lineNum: line.lineNum,
          front: cleanFront,
          frontRaw: cleanFlashcardMarkdown(sepMatch[1].trim()),
          back: cleanBack,
          backPlain: formatFlashcardPlainText(cleanBack),
          segments: parseFlashcardRichSegments(cleanBack),
          schedule: sr,
          isHardCard: isHardFlashcard(sr),
          due: sr?.due || today,
          isDue,
          version: versions.get(note.id) || note.version || '',
        });
        continue;
      }

      // 2. Multi-line Q: / A: or 问：/ 答： syntax
      const qMatch = /^(?:Q|问)\s*[:：]\s*(.+)$/i.exec(text);
      if (qMatch && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const aMatch = /^(?:A|答)\s*[:：]\s*(.+)$/i.exec(nextLine.text.trim());
        if (aMatch) {
          const rawBack = aMatch[1].trim();
          const sr = parseSrMetadata(rawBack);
          const cleanBack = cleanFlashcardMarkdown(sr ? rawBack.slice(0, rawBack.length - sr.rawTag.length).trim() : rawBack);
          const cleanFront = formatFlashcardPlainText(qMatch[1].trim());
          const isDue = !sr || sr.due <= today;
          cards.push({
            id: `${note.id}:line:${nextLine.lineNum}`,
            noteId: note.id,
            noteTitle: note.title || noteStem,
            folder: noteFolder,
            tags: noteTags,
            citation: `[[${noteStem}]]`,
            kind: 'qa-pair',
            lineNum: nextLine.lineNum,
            front: cleanFront,
            frontRaw: cleanFlashcardMarkdown(qMatch[1].trim()),
            back: cleanBack,
            backPlain: formatFlashcardPlainText(cleanBack),
            segments: parseFlashcardRichSegments(cleanBack),
            schedule: sr,
            isHardCard: isHardFlashcard(sr),
            due: sr?.due || today,
            isDue,
            version: versions.get(note.id) || note.version || '',
          });
          i++;
        }
      }
    }
  }

  cards.sort((a, b) => Number(b.isDue) - Number(a.isDue) || a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  const forecastInfo = computeFlashcardForecast(cards, today, 14);
  const folders = [...new Set(cards.map(card => card.folder || '根目录').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const tags = [...new Set(cards.flatMap(card => card.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const hardCount = cards.filter(card => card.isHardCard).length;
  return {
    totalCards: cards.length,
    dueCards: forecastInfo.stats.dueCards,
    hardCount,
    folders,
    tags,
    stats: { ...forecastInfo.stats, hardCount },
    forecast: forecastInfo.days,
    cards,
  };
}

export function filterFlashcardsDeck(cards = [], { folder = '', tag = '', hardOnly = false } = {}) {
  const normalizedFolder = String(folder || '').trim();
  const normalizedTag = String(tag || '').replace(/^#+/, '').trim().toLowerCase();
  return (cards || []).filter(card => {
    if (normalizedFolder && (card.folder || '根目录') !== normalizedFolder) return false;
    if (normalizedTag && !(card.tags || []).some(item => String(item || '').replace(/^#+/, '').trim().toLowerCase() === normalizedTag)) return false;
    if (hardOnly && !card.isHardCard) return false;
    return true;
  });
}

export function selectDueMicroFlashcards(cards = [], { limit = 3 } = {}) {
  const maxItems = Math.max(1, Number(limit || 3));
  return [...(cards || [])]
    .filter(card => card && card.isDue)
    .sort((a, b) => Number(Boolean(b.isHardCard)) - Number(Boolean(a.isHardCard)) || String(a.due || '').localeCompare(String(b.due || '')) || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, maxItems);
}

export function computeFlashcardForecast(cards = [], today = localDate(), days = 14) {
  const safeDays = Math.max(1, Math.min(30, Number(days) || 14));
  let newCards = 0;
  let learningCards = 0;
  let masteredCards = 0;
  let dueCards = 0;
  let easeSum = 0;
  let easeCount = 0;

  for (const card of cards || []) {
    const isDue = !card.schedule || (card.due || today) <= today;
    if (isDue) dueCards++;
    if (!card.schedule || (card.schedule.reps || 0) === 0) {
      newCards++;
    } else if ((card.schedule.interval || 1) >= 7) {
      masteredCards++;
    } else {
      learningCards++;
    }
    if (card.schedule?.ease) {
      easeSum += Number(card.schedule.ease);
      easeCount++;
    }
  }

  const averageEase = easeCount > 0 ? Math.round((easeSum / easeCount) * 100) / 100 : 2.5;
  const forecastDays = [];
  for (let offset = 0; offset < safeDays; offset++) {
    const dateStr = offset === 0 ? today : addDays(today, offset);
    const count = offset === 0
      ? dueCards
      : (cards || []).filter(c => c.schedule && c.due === dateStr).length;
    forecastDays.push({
      date: dateStr,
      label: offset === 0 ? '今日' : dateStr.slice(5),
      count,
      isToday: offset === 0,
    });
  }
  const maxCount = Math.max(1, ...forecastDays.map(d => d.count));
  return {
    days: forecastDays.map(d => ({ ...d, ratio: Math.round((d.count / maxCount) * 100) })),
    maxCount,
    stats: {
      totalCards: (cards || []).length,
      dueCards,
      newCards,
      learningCards,
      masteredCards,
      averageEase,
    },
  };
}

export function extractCandidateFlashcardsFromNote(note, { today = localDate() } = {}) {
  if (!note || typeof note.source !== 'string') return [];
  const hasBom = note.source.startsWith('\uFEFF');
  const body = unescapeWikiLinksInMarkdown((hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n'));
  const srSectionMatch = /\n##\s+记忆闪卡\s*\n[\s\S]*$/.exec(body);
  const fm = parseFrontMatter(body);
  const content = body.slice(fm.bodyFrom);
  const sourceWithoutSrSection = srSectionMatch
    ? content.slice(0, Math.max(0, srSectionMatch.index - fm.bodyFrom))
    : content;

  const candidates = [];
  const seenTerms = new Set();
  for (const match of sourceWithoutSrSection.matchAll(/\*\*([^*\n]{2,36})\*\*\s*[：:]\s*([^\n]{6,280})/g)) {
    const term = match[1].trim();
    if (seenTerms.has(term)) continue;
    seenTerms.add(term);
    const rawDef = match[2].replace(/\s*@sr\([^)]*\)\s*$/, '').trim();
    const def = cleanFlashcardMarkdown(rawDef);
    const question = `什么是「${term}」？`;
    const alreadyExists = body.includes(`Q: ${question}`) || body.includes(`${term} ::`);
    candidates.push({
      id: `cand-${candidates.length + 1}`,
      term,
      question,
      answer: def,
      answerPlain: formatFlashcardPlainText(def),
      segments: parseFlashcardRichSegments(def),
      markdownBlock: `Q: ${question}\nA: ${def} @sr(due=${today},interval=1,ease=2.50,reps=0)`,
      alreadyExists,
    });
    if (candidates.length >= 8) break;
  }

  if (!candidates.length) {
    const stem = stripNumericPrefix(note.cleanTitle || note.title || '核心概念');
    const summary = cleanFlashcardMarkdown(sourceWithoutSrSection.replace(/^#+\s+.+$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120)) || '本地优先的知识与创作工作台核心概念';
    const question = `《${stem}》的核心要点是什么？`;
    candidates.push({
      id: 'cand-1',
      term: stem,
      question,
      answer: summary,
      answerPlain: formatFlashcardPlainText(summary),
      segments: parseFlashcardRichSegments(summary),
      markdownBlock: `Q: ${question}\nA: ${summary} @sr(due=${today},interval=1,ease=2.50,reps=0)`,
      alreadyExists: body.includes(`Q: ${question}`),
    });
  }

  return candidates;
}

export function appendSelectedFlashcardsToNote(note, selectedCandidates = [], { today = localDate() } = {}) {
  if (!note || typeof note.source !== 'string') return { appendedCount: 0, source: note?.source || '' };
  const hasBom = note.source.startsWith('\uFEFF');
  const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
  const body = unescapeWikiLinksInMarkdown((hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n'));
  const blocks = [];
  for (const item of selectedCandidates || []) {
    const q = item.question || `什么是「${item.term || '概念'}」？`;
    const a = cleanFlashcardMarkdown(item.answer || '');
    if (!a || body.includes(`Q: ${q}`)) continue;
    blocks.push(item.markdownBlock || `Q: ${q}\nA: ${a} @sr(due=${today},interval=1,ease=2.50,reps=0)`);
  }
  if (!blocks.length) {
    return { appendedCount: 0, source: note.source };
  }
  const trimmed = body.replace(/\s+$/, '');
  const sectionHeader = /^##\s+记忆闪卡\s*$/m.test(trimmed) ? '\n\n' : '\n\n## 记忆闪卡\n\n';
  const nextBody = trimmed + sectionHeader + blocks.join('\n\n') + '\n';
  const formatted = newline === '\r\n' ? nextBody.replaceAll('\n', '\r\n') : nextBody;
  return {
    appendedCount: blocks.length,
    source: (hasBom ? '\uFEFF' : '') + formatted,
  };
}

export function applyFlashcardReviewToSource(source, lineNum, grade = 'good', today = localDate()) {
  if (typeof source !== 'string' || !Number.isInteger(lineNum) || lineNum < 1) {
    throw new Error('无效的闪卡源码或行号');
  }
  const hasBom = source.startsWith('\uFEFF');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = (hasBom ? source.slice(1) : source).replaceAll('\r\n', '\n');
  const lines = body.split('\n');
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new Error('闪卡目标行号超出笔记范围');
  }

  const targetLine = lines[idx];
  const currentSr = parseSrMetadata(targetLine);
  const nextSchedule = computeNextSchedule(currentSr, grade, today);
  const stripped = currentSr ? targetLine.slice(0, targetLine.length - currentSr.rawTag.length).trimEnd() : targetLine.trimEnd();
  lines[idx] = `${stripped} ${nextSchedule.tag}`;

  const joined = lines.join(newline);
  return {
    source: (hasBom ? '\uFEFF' : '') + joined,
    schedule: nextSchedule,
  };
}

export function buildFlashcardsFromNote(note, { today = localDate() } = {}) {
  if (!note || typeof note.source !== 'string') return { appendedCount: 0, source: note?.source || '' };
  const hasBom = note.source.startsWith('\uFEFF');
  const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
  let body = unescapeWikiLinksInMarkdown((hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n'));

  // If an existing '## 记忆闪卡' section contains corrupted/escaped brackets or truncated links, remove it so it can be cleanly rebuilt
  const srSectionMatch = /\n##\s+记忆闪卡\s*\n[\s\S]*$/.exec(body);
  let replacedCorruptedSection = false;
  if (srSectionMatch && (/\\\[|\\\]|\|\s*@sr\(/.test(srSectionMatch[0]))) {
    body = body.slice(0, srSectionMatch.index).trimEnd() + '\n';
    replacedCorruptedSection = true;
  }

  const fm = parseFrontMatter(body);
  const content = body.slice(fm.bodyFrom);
  const sourceWithoutSrSection = srSectionMatch && !replacedCorruptedSection
    ? content.slice(0, Math.max(0, srSectionMatch.index - fm.bodyFrom))
    : content;

  const generated = [];
  for (const match of sourceWithoutSrSection.matchAll(/\*\*([^*\n]{2,36})\*\*\s*[：:]\s*([^\n]{6,280})/g)) {
    const term = match[1].trim();
    const rawDef = match[2].replace(/\s*@sr\([^)]*\)\s*$/, '').trim();
    const def = cleanFlashcardMarkdown(rawDef);
    if (!body.includes(`Q: 什么是「${term}」？`) && !body.includes(`${term} ::`)) {
      generated.push(`Q: 什么是「${term}」？\nA: ${def} @sr(due=${today},interval=1,ease=2.50,reps=0)`);
    }
    if (generated.length >= 5) break;
  }

  if (!generated.length && !body.includes('## 记忆闪卡')) {
    const stem = stripNumericPrefix(note.cleanTitle || note.title || '核心概念');
    const summary = cleanFlashcardMarkdown(sourceWithoutSrSection.replace(/^#+\s+.+$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120)) || '本地优先的知识与创作工作台核心概念';
    if (!body.includes(`Q: 《${stem}》的核心要点是什么？`)) {
      generated.push(`Q: 《${stem}》的核心要点是什么？\nA: ${summary} @sr(due=${today},interval=1,ease=2.50,reps=0)`);
    }
  }

  if (!generated.length && !replacedCorruptedSection) {
    const formattedUnescaped = newline === '\r\n' ? body.replaceAll('\n', '\r\n') : body;
    const fullUnescaped = (hasBom ? '\uFEFF' : '') + formattedUnescaped;
    return { appendedCount: fullUnescaped !== note.source ? 1 : 0, source: fullUnescaped };
  }
  const trimmed = body.replace(/\s+$/, '');
  const sectionHeader = /^##\s+记忆闪卡\s*$/m.test(trimmed) ? '\n\n' : '\n\n## 记忆闪卡\n\n';
  const nextBody = trimmed + sectionHeader + generated.join('\n\n') + '\n';
  const formatted = newline === '\r\n' ? nextBody.replaceAll('\n', '\r\n') : nextBody;
  return {
    appendedCount: Math.max(1, generated.length),
    source: (hasBom ? '\uFEFF' : '') + formatted,
  };
}

function escapeAnkiHtml(text = '') {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\t', ' ')
    .replace(/\r?\n/g, '<br>');
}

function unescapeAnkiHtmlEntities(text = '') {
  return String(text || '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export function formatFlashcardAnkiHtml(rawText = '') {
  const segments = parseFlashcardRichSegments(rawText);
  return segments.map(seg => {
    if (seg.type === 'code') return `<code>${escapeAnkiHtml(seg.text)}</code>`;
    if (seg.type === 'strong') return `<strong>${escapeAnkiHtml(seg.text)}</strong>`;
    if (seg.type === 'wikilink') {
      const targetAttr = escapeAnkiHtml(seg.raw.replace(/^\[\[|\]\]$/g, ''));
      return `<span class="inkloom-wikilink" data-wikilink="${targetAttr}">${escapeAnkiHtml(seg.display)}</span>`;
    }
    return escapeAnkiHtml(seg.text);
  }).join('');
}

export function ankiHtmlToMarkdown(rawHtml = '') {
  let html = String(rawHtml || '').trim();
  let schedule = null;
  const srCommentMatch = /<!--\s*inkloom-sr:\s*due=(\d{4}-\d{2}-\d{2}),interval=(\d+),ease=(\d+(?:\.\d+)?),reps=(\d+)\s*-->/i.exec(html);
  if (srCommentMatch) {
    schedule = {
      due: srCommentMatch[1],
      interval: Number(srCommentMatch[2]) || 1,
      ease: Number(srCommentMatch[3]) || 2.5,
      reps: Number(srCommentMatch[4]) || 0,
    };
    html = html.replace(srCommentMatch[0], '');
  }
  const inlineSr = parseSrMetadata(html);
  if (!schedule && inlineSr) {
    schedule = {
      due: inlineSr.due,
      interval: inlineSr.interval,
      ease: inlineSr.ease,
      reps: inlineSr.reps,
    };
    html = html.slice(0, html.length - inlineSr.rawTag.length);
  }

  let md = html
    .replace(/<span[^>]*data-wikilink="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi, (_, rawTarget) => `[[${unescapeAnkiHtmlEntities(rawTarget)}]]`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${unescapeAnkiHtmlEntities(inner).trim()}\``)
    .replace(/<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/gi, (_, inner) => `**${unescapeAnkiHtmlEntities(inner).trim()}**`)
    .replace(/<br\s*\/?>/gi, ' ； ')
    .replace(/<\/(?:p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  md = cleanFlashcardMarkdown(unescapeAnkiHtmlEntities(md).replace(/\s+/g, ' ').trim());
  return { text: md, schedule };
}

function sanitizeAnkiTagToken(tag = '') {
  return String(tag || '').trim().replace(/^#+/, '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_:./-]/gu, '');
}

export function exportFlashcardsToAnkiTsv(cards = [], { deckName = 'Inkloom::知识闪卡', includeScheduling = true, today = localDate() } = {}) {
  const safeDeckName = String(deckName || 'Inkloom::知识闪卡').replace(/[\t\r\n]+/g, ' ').trim() || 'Inkloom::知识闪卡';
  const headerLines = [
    '#separator:tab',
    '#html:true',
    `#deck:${safeDeckName}`,
    '#columns:Front\tBack\tTags',
    '#tags column:3',
  ];
  const rows = [];
  for (const card of cards || []) {
    const frontRaw = String(card?.frontRaw || card?.front || card?.question || '').trim();
    const backRaw = String(card?.back || card?.answer || '').trim();
    if (!frontRaw || !backRaw) continue;
    const frontHtml = formatFlashcardAnkiHtml(frontRaw);
    let backHtml = formatFlashcardAnkiHtml(backRaw);
    if (includeScheduling) {
      const due = card?.schedule?.due || card?.due || today;
      const interval = Number(card?.schedule?.interval) || 1;
      const ease = (Number(card?.schedule?.ease) || 2.5).toFixed(2);
      const reps = Number(card?.schedule?.reps) || 0;
      backHtml += ` <!-- inkloom-sr: due=${due},interval=${interval},ease=${ease},reps=${reps} -->`;
    }
    const rawTags = [
      ...(Array.isArray(card?.tags) ? card.tags : []),
      card?.folder && card.folder !== '根目录' ? `目录::${card.folder}` : '',
    ].map(sanitizeAnkiTagToken).filter(Boolean);
    const uniqueTags = [...new Set(['Inkloom', ...rawTags])];
    rows.push(`${frontHtml}\t${backHtml}\t${uniqueTags.join(' ')}`);
  }
  return {
    deckName: safeDeckName,
    cardCount: rows.length,
    tsv: [...headerLines, ...rows].join('\n') + '\n',
  };
}

export function exportFlashcardsToAnkiDeckPackageBytes(cards = [], { deckName = 'Inkloom::知识闪卡', today = localDate() } = {}) {
  const exportedTsv = exportFlashcardsToAnkiTsv(cards, { deckName, includeScheduling: true, today });
  const manifestCards = [];
  for (const card of cards || []) {
    const front = cleanFlashcardMarkdown(card?.frontRaw || card?.front || card?.question || '');
    const back = cleanFlashcardMarkdown(card?.back || card?.answer || '');
    if (!front || !back) continue;
    manifestCards.push({
      front,
      back,
      tags: [...new Set((card?.tags || []).map(t => String(t).replace(/^#+/, '').trim()).filter(Boolean))],
      folder: card?.folder || '',
      noteTitle: card?.noteTitle || '',
      schedule: {
        due: card?.schedule?.due || card?.due || today,
        interval: Number(card?.schedule?.interval) || 1,
        ease: Number((Number(card?.schedule?.ease) || 2.5).toFixed(2)),
        reps: Number(card?.schedule?.reps) || 0,
      },
    });
  }
  const manifest = {
    format: 'inkloom-anki-apkg',
    version: '1.0',
    deckName: exportedTsv.deckName,
    exportedAt: today,
    cardCount: manifestCards.length,
    cards: manifestCards,
  };
  const safeStem = exportedTsv.deckName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'inkloom-flashcards';
  const bytes = buildStoredZipBytes({
    'deck-manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'cards.tsv': exportedTsv.tsv,
    media: '{}',
  });
  return {
    bytes,
    fileName: `${safeStem}-${today}.apkg`,
    deckName: exportedTsv.deckName,
    cardCount: manifestCards.length,
    tsv: exportedTsv.tsv,
  };
}

function buildImportedCardRecord({ question, answer, tags = [], schedule = null, today = localDate() }) {
  const q = cleanFlashcardMarkdown(question).replace(/^问[：:]\s*/, '').trim();
  const a = cleanFlashcardMarkdown(answer).replace(/^答[：:]\s*/, '').trim();
  if (!q || !a) return null;
  const sr = {
    due: schedule?.due || today,
    interval: Math.max(1, Number(schedule?.interval) || 1),
    ease: Math.min(3.5, Math.max(1.3, Number(schedule?.ease) || 2.5)),
    reps: Math.max(0, Number(schedule?.reps) || 0),
  };
  const srTag = `@sr(due=${sr.due},interval=${sr.interval},ease=${sr.ease.toFixed(2)},reps=${sr.reps})`;
  const cleanTags = [...new Set((tags || []).map(t => String(t).replace(/^#+/, '').trim()).filter(t => t && t.toLowerCase() !== 'inkloom'))];
  return {
    question: q,
    answer: a,
    tags: cleanTags,
    schedule: sr,
    markdownBlock: `Q: ${q}\nA: ${a} ${srTag}`,
  };
}

function extractUnitSeparatedAnkiSqliteCards(sqliteBytes, today = localDate()) {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sqliteBytes);
  const cards = [];
  // Anki notes.flds stores fields separated by ASCII 0x1F (Unit Separator): Front \x1f Back
  const pairRe = /([\p{L}\p{N}<[「『"'(（][^\x00-\x1e\x7f]{1,240}?)\x1f([\p{L}\p{N}<`*[「『"'(（][^\x00-\x1e\x7f]{1,600})/gu;
  for (const match of decoded.matchAll(pairRe)) {
    const frontParsed = ankiHtmlToMarkdown(match[1]);
    const backParsed = ankiHtmlToMarkdown(match[2]);
    if (!frontParsed.text || !backParsed.text || frontParsed.text.length < 2) continue;
    const rec = buildImportedCardRecord({
      question: frontParsed.text,
      answer: backParsed.text,
      schedule: backParsed.schedule,
      today,
    });
    if (rec) cards.push(rec);
    if (cards.length >= 500) break;
  }
  return cards;
}

function parseAnkiTextContent(rawText = '', { today = localDate(), defaultDeckName = 'Anki 导入牌组' } = {}) {
  const lines = String(rawText || '').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n');
  let deckName = defaultDeckName;
  let separator = '\t';
  let tagsCol = 3;
  const cards = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const deckMatch = /^#deck\s*:\s*(.+)$/i.exec(trimmed);
      if (deckMatch) deckName = deckMatch[1].trim() || deckName;
      const sepMatch = /^#separator\s*:\s*(.+)$/i.exec(trimmed);
      if (sepMatch) {
        const token = sepMatch[1].trim().toLowerCase();
        if (token === 'tab' || token === '\\t') separator = '\t';
        else if (token === 'semicolon' || token === ';') separator = ';';
        else if (token === 'comma' || token === ',') separator = ',';
        else if (token === 'pipe' || token === '|') separator = '|';
      }
      const tagsMatch = /^#tags\s+column\s*:\s*(\d+)$/i.exec(trimmed);
      if (tagsMatch) tagsCol = Number(tagsMatch[1]) || 3;
      continue;
    }

    if (/^(?:Q|问)\s*[：:]/i.test(trimmed) && i + 1 < lines.length && /^(?:A|答)\s*[：:]/i.test(lines[i + 1].trim())) {
      const qRaw = trimmed.replace(/^(?:Q|问)\s*[：:]\s*/i, '');
      const aRaw = lines[i + 1].trim().replace(/^(?:A|答)\s*[：:]\s*/i, '');
      const frontParsed = ankiHtmlToMarkdown(qRaw);
      const backParsed = ankiHtmlToMarkdown(aRaw);
      const rec = buildImportedCardRecord({
        question: frontParsed.text,
        answer: backParsed.text,
        schedule: backParsed.schedule,
        today,
      });
      if (rec) cards.push(rec);
      i++;
      continue;
    }

    const parts = rawLine.includes(separator)
      ? rawLine.split(separator)
      : rawLine.includes('\t')
        ? rawLine.split('\t')
        : rawLine.includes(' :: ')
          ? rawLine.split(' :: ')
          : null;
    if (!parts || parts.length < 2) continue;
    if (parts[0].trim().toLowerCase() === 'front' && parts[1].trim().toLowerCase() === 'back') continue;

    const frontParsed = ankiHtmlToMarkdown(parts[0]);
    const backParsed = ankiHtmlToMarkdown(parts[1]);
    const rawTagsStr = tagsCol >= 1 && parts[tagsCol - 1] ? parts[tagsCol - 1].trim() : (parts[2] || '').trim();
    const rowTags = rawTagsStr ? rawTagsStr.split(/\s+/).filter(Boolean) : [];
    const rec = buildImportedCardRecord({
      question: frontParsed.text,
      answer: backParsed.text,
      tags: rowTags,
      schedule: backParsed.schedule,
      today,
    });
    if (rec) cards.push(rec);
  }

  return { deckName, cards };
}

export async function parseAnkiFlashcardsImport(input, { today = localDate(), defaultDeckName = 'Anki 导入牌组' } = {}) {
  let deckName = defaultDeckName;
  let format = 'tsv';
  let rawCards = [];

  const isBinary = input instanceof Uint8Array || input instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer(input));
  if (isBinary) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const isZip = u8.byteLength >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
    if (isZip) {
      format = 'apkg';
      const entries = await unpackZipEntries(u8);
      const decoder = new TextDecoder('utf-8', { fatal: false });
      if (entries.has('deck-manifest.json')) {
        const parsedManifest = JSON.parse(decoder.decode(entries.get('deck-manifest.json')));
        deckName = parsedManifest?.deckName || deckName;
        for (const item of parsedManifest?.cards || []) {
          const rec = buildImportedCardRecord({
            question: item.front || item.question || '',
            answer: item.back || item.answer || '',
            tags: item.tags || [],
            schedule: item.schedule || null,
            today,
          });
          if (rec) rawCards.push(rec);
        }
      }
      if (!rawCards.length) {
        const tsvEntry = [...entries.entries()].find(([name]) => /\.(?:tsv|txt|csv)$/i.test(name));
        if (tsvEntry) {
          const parsedText = parseAnkiTextContent(decoder.decode(tsvEntry[1]), { today, defaultDeckName: deckName });
          deckName = parsedText.deckName;
          rawCards = parsedText.cards;
        }
      }
      if (!rawCards.length) {
        const sqliteEntry = [...entries.entries()].find(([name]) => /collection\.anki21?$/i.test(name));
        if (sqliteEntry) {
          rawCards = extractUnitSeparatedAnkiSqliteCards(sqliteEntry[1], today);
        }
      }
    } else {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(u8);
      const parsedText = parseAnkiTextContent(text, { today, defaultDeckName: deckName });
      deckName = parsedText.deckName;
      rawCards = parsedText.cards;
    }
  } else {
    const parsedText = parseAnkiTextContent(String(input || ''), { today, defaultDeckName: deckName });
    deckName = parsedText.deckName;
    rawCards = parsedText.cards;
  }

  const deduped = [];
  const seenQuestions = new Set();
  for (const card of rawCards) {
    const key = card.question.toLocaleLowerCase();
    if (seenQuestions.has(key)) continue;
    seenQuestions.add(key);
    deduped.push(card);
  }

  return {
    format,
    deckName,
    cardCount: deduped.length,
    cards: deduped,
  };
}

export function appendImportedAnkiCardsToNote(note, importedCards = [], { today = localDate() } = {}) {
  if (!note || typeof note.source !== 'string') return { appendedCount: 0, skippedCount: 0, source: note?.source || '' };
  const hasBom = note.source.startsWith('\uFEFF');
  const newline = note.source.includes('\r\n') ? '\r\n' : '\n';
  const body = unescapeWikiLinksInMarkdown((hasBom ? note.source.slice(1) : note.source).replaceAll('\r\n', '\n'));
  const blocks = [];
  let skippedCount = 0;

  for (const item of importedCards || []) {
    const rec = item?.markdownBlock ? item : buildImportedCardRecord({
      question: item?.question || item?.front || '',
      answer: item?.answer || item?.back || '',
      tags: item?.tags || [],
      schedule: item?.schedule || null,
      today,
    });
    if (!rec) continue;
    if (body.includes(`Q: ${rec.question}`)) {
      skippedCount++;
      continue;
    }
    blocks.push(rec.markdownBlock);
  }

  if (!blocks.length) {
    return { appendedCount: 0, skippedCount, source: note.source };
  }
  const trimmed = body.replace(/\s+$/, '');
  const sectionHeader = /^##\s+记忆闪卡\s*$/m.test(trimmed) ? '\n\n' : '\n\n## 记忆闪卡\n\n';
  const nextBody = trimmed + sectionHeader + blocks.join('\n\n') + '\n';
  const formatted = newline === '\r\n' ? nextBody.replaceAll('\n', '\r\n') : nextBody;
  return {
    appendedCount: blocks.length,
    skippedCount,
    source: (hasBom ? '\uFEFF' : '') + formatted,
  };
}

export function buildImportedAnkiDeckNoteMarkdown(importedCards = [], { deckName = 'Anki 导入牌组', today = localDate() } = {}) {
  const safeTitle = String(deckName || 'Anki 导入牌组').replaceAll('::', ' · ').replace(/[\r\n]+/g, ' ').trim() || 'Anki 导入牌组';
  const allTags = [...new Set(['闪卡牌组', 'Anki同步', ...(importedCards || []).flatMap(c => c.tags || []).slice(0, 8)])];
  const baseNote = {
    source: [
      '---',
      `title: "${safeTitle.replaceAll('"', '\\"')}"`,
      'category: note',
      `date: ${today}`,
      'status: 进行中',
      'tags:',
      ...allTags.map(tag => `  - "${String(tag).replaceAll('"', '\\"')}"`),
      '---',
      '',
      `# ${safeTitle}`,
      '',
      `> **🗂️ Anki 牌组同步说明**：共导入 **${(importedCards || []).length}** 张问答闪卡（同步日期：\`${today}\`），可直接在本页修订或在「笔记智识 -> 闪卡温习」按 SM-2 曲线复习。`,
      '',
    ].join('\n'),
  };
  const appended = appendImportedAnkiCardsToNote(baseNote, importedCards, { today });
  return {
    title: safeTitle,
    appendedCount: appended.appendedCount,
    markdown: appended.source,
  };
}

export function buildSampleAnkiTsv({ today = localDate() } = {}) {
  return [
    '#separator:tab',
    '#html:true',
    '#deck:Inkloom::认知科学精选',
    '#columns:Front\tBack\tTags',
    '#tags column:3',
    `什么是 <strong>间隔重复 (Spaced Repetition)</strong> 的核心记忆原理？\t在遗忘曲线临界点主动提取记忆，通过 <code>SM-2</code> 动态拉长复习间隔以巩固长期记忆。 <!-- inkloom-sr: due=${today},interval=1,ease=2.50,reps=0 -->\t认知科学 记忆法`,
    `为什么知识卡片提倡 <strong>最小信息原则</strong>？\t单张闪卡聚焦单一原子问题与双链上下文，可显著降低提取歧义并提升复习流畅度。 <!-- inkloom-sr: due=${today},interval=3,ease=2.60,reps=1 -->\t制卡原则 知识管理`,
  ].join('\n') + '\n';
}
