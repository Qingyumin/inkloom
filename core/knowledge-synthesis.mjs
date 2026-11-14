import { parseFrontMatter, nonCodeLineRanges, stripNumericPrefix, localDate } from './vault-graph.mjs';
import { computeEmbedding, cosineSimilarity } from './ai-retrieval.mjs';

function noteTargetTitle(note) {
  const raw = String(note?.cleanTitle || note?.title || note?.stem || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  return stripNumericPrefix(raw) || raw;
}

export function analyzeOrphanWeaving(notes = [], {
  versions = new Map(),
  minScore = 0.15,
} = {}) {
  const validNotes = (notes || []).filter(n => n && n.exists !== false && !n.ghost && n.metadata?.category !== 'whiteboard');
  const orphans = validNotes.filter(n => (n.orphan === true || ((n.inDegree || 0) === 0 && (n.outDegree || 0) === 0)) && n.metadata?.category !== 'skill');
  const hubs = validNotes.filter(n => !orphans.some(o => o.id === n.id) && n.metadata?.category !== 'skill');
  const fallbackHubs = hubs.length ? hubs : validNotes;

  const hubProfiles = fallbackHubs.map(hub => ({
    note: hub,
    cleanTitle: noteTargetTitle(hub),
    vector: computeEmbedding(`${hub.title || ''} ${(hub.tags || []).join(' ')} ${(hub.aliases || []).join(' ')} ${(hub.source || hub.excerpt || '').slice(0, 1500)}`),
    tagSet: new Set((hub.tags || []).map(t => String(t).toLocaleLowerCase())),
    degree: (hub.inDegree || 0) + (hub.outDegree || 0),
  }));

  const recommendations = [];
  for (const orphan of orphans) {
    const orphanVec = computeEmbedding(`${orphan.title || ''} ${(orphan.tags || []).join(' ')} ${(orphan.source || orphan.excerpt || '').slice(0, 1500)}`);
    const orphanTags = (orphan.tags || []).map(t => String(t).toLocaleLowerCase());
    let best = null;

    for (const profile of hubProfiles) {
      if (profile.note.id === orphan.id) continue;
      const cosine = Math.max(0, Math.round(cosineSimilarity(orphanVec, profile.vector) * 100) / 100);
      const sharedTags = (orphan.tags || []).filter(t => profile.tagSet.has(String(t).toLocaleLowerCase()));
      const tagBonus = Math.min(0.28, sharedTags.length * 0.14);
      const centralityBonus = Math.min(0.15, profile.degree * 0.025);
      const folderBonus = orphan.folder && orphan.folder === profile.note.folder ? 0.08 : 0;
      const score = Math.min(0.99, Math.round((0.28 + cosine * 0.52 + tagBonus + centralityBonus + folderBonus) * 100) / 100);

      if (score >= minScore && (!best || score > best.score)) {
        const reasons = [];
        if (sharedTags.length) reasons.push(`共享标签 #${sharedTags.join(' #')}`);
        if (cosine > 0) reasons.push(`向量余弦 ${cosine}`);
        if (profile.degree > 0) reasons.push(`枢纽连接度 ${profile.degree}`);
        best = {
          hubId: profile.note.id,
          hubTitle: profile.note.title,
          hubCleanTitle: profile.cleanTitle || profile.note.title,
          cosine,
          score,
          sharedTags,
          reason: reasons.join(' · ') || '语义向量与主题相近',
        };
      }
    }

    if (best) {
      recommendations.push({
        orphanId: orphan.id,
        orphanTitle: orphan.title,
        orphanCleanTitle: stripNumericPrefix(orphan.cleanTitle || orphan.title || ''),
        orphanPath: orphan.relativePath || orphan.name || '',
        folder: orphan.folder || '根目录',
        tags: orphan.tags || [],
        excerpt: (orphan.excerpt || '').slice(0, 140),
        version: versions.get(orphan.id) || orphan.version || '',
        ...best,
        proposedLink: `[[${best.hubCleanTitle}]]`,
      });
    }
  }

  recommendations.sort((a, b) => b.score - a.score || a.orphanTitle.localeCompare(b.orphanTitle, 'zh-CN'));
  return {
    totalOrphans: orphans.length,
    recommendations,
  };
}

export function applyOrphanWeaveLink(source, targetTitle, reason = '孤岛笔记智能织网') {
  if (typeof source !== 'string' || !targetTitle) return { source, changed: false };
  const cleanedTarget = stripNumericPrefix(String(targetTitle).trim()) || String(targetTitle).trim();
  const linkToken = `[[${cleanedTarget}]]`;
  if (source.includes(linkToken) || source.includes(`[[${targetTitle}]]`)) {
    return { source, changed: false };
  }
  const hasBom = source.startsWith('\uFEFF');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = (hasBom ? source.slice(1) : source).replaceAll('\r\n', '\n');
  const trimmed = body.replace(/\s+$/, '');
  const bullet = `- ${linkToken}（${reason}）`;

  let nextBody;
  if (/^##\s+关联脉络\s*$/m.test(trimmed)) {
    nextBody = trimmed + '\n' + bullet + '\n';
  } else {
    nextBody = trimmed + '\n\n## 关联脉络\n\n' + bullet + '\n';
  }
  const formatted = newline === '\r\n' ? nextBody.replaceAll('\n', '\r\n') : nextBody;
  return {
    source: (hasBom ? '\uFEFF' : '') + formatted,
    changed: true,
    linkToken,
  };
}

export function generateKnowledgeDigest(notes = [], {
  windowDays = 7,
  today = localDate(),
  versions = new Map(),
  customTitle = '',
} = {}) {
  const validNotes = (notes || []).filter(n => {
    if (!n || n.exists === false || n.ghost) return false;
    const cat = String(n.metadata?.category || '').toLowerCase();
    if (cat === 'whiteboard' || cat === 'skill' || cat === 'digest') return false;
    if (n.folder === 'digests' || /^知识周报与专题综述/.test(n.title || '')) return false;
    return true;
  });
  const daysNum = windowDays === 'all' ? Infinity : Math.max(1, Number(windowDays) || 7);
  const todayMs = Date.parse(String(today) + 'T23:59:59Z') || Date.now();

  const inWindow = dateStr => {
    if (!Number.isFinite(daysNum)) return true;
    if (!dateStr) return false;
    const ms = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(ms)) return false;
    const diffDays = (todayMs - ms) / 86400000;
    return diffDays >= -2 && diffDays <= daysNum;
  };

  let scopedNotes = validNotes.filter(n => inWindow(n.metadata?.date) || /^\d{4}-\d{2}-\d{2}/.test(n.name || '') && inWindow((n.name || '').slice(0, 10)));
  if (!scopedNotes.length) scopedNotes = validNotes;

  const memos = [];
  const completedTasks = [];
  const openTasks = [];
  const excerpts = [];
  const tagClusters = new Map();
  const citations = [];
  const seenCiteIds = new Set();

  const addCite = note => {
    if (seenCiteIds.has(note.id)) return;
    seenCiteIds.add(note.id);
    const stem = noteTargetTitle(note);
    citations.push({
      id: note.id,
      title: note.title,
      citation: `[[${stem}]]`,
      version: versions.get(note.id) || note.version || '',
    });
  };

  for (const note of scopedNotes) {
    const stem = noteTargetTitle(note);
    const cat = String(note.metadata?.category || '').toLowerCase();
    const src = String(note.source || '');
    const bom = src.startsWith('\uFEFF') ? 1 : 0;
    const fm = parseFrontMatter(src.slice(bom));
    const bodyFrom = bom + fm.bodyFrom;

    if (cat === 'memo' || note.folder === 'daily' || /^\d{4}-\d{2}-\d{2}/.test(note.name || '')) {
      memos.push({
        id: note.id,
        title: note.title,
        date: note.metadata?.date || today,
        summary: (note.excerpt || '').slice(0, 120),
        citation: `[[${stem}]]`,
      });
      addCite(note);
    }

    if (cat === 'excerpt' || cat === 'source') {
      excerpts.push({
        id: note.id,
        title: note.title,
        summary: (note.excerpt || '').slice(0, 140),
        sourceLink: note.metadata?.source_block ? `![[${note.metadata.source_block}]]` : `[[${stem}]]`,
      });
      addCite(note);
    }

    for (const line of nonCodeLineRanges(src, bodyFrom)) {
      const taskMatch = /^\s*[-*]\s+\[([ xX/])\]\s+(.+)$/.exec(line.text);
      if (taskMatch) {
        const mark = taskMatch[1].toLowerCase();
        const text = taskMatch[2].replace(/\^[A-Za-z0-9_-]+\s*$/, '').trim();
        const item = { noteId: note.id, noteTitle: note.title, text, status: mark === 'x' ? 'done' : mark === '/' ? 'doing' : 'todo', citation: `[[${stem}]]` };
        if (mark === 'x') completedTasks.push(item);
        else openTasks.push(item);
        addCite(note);
      }
    }

    for (const tag of note.tags || []) {
      if (!tagClusters.has(tag)) tagClusters.set(tag, []);
      tagClusters.get(tag).push({ id: note.id, title: note.title, citation: `[[${stem}]]` });
    }
  }

  const windowLabel = windowDays === 'all' ? '全周期' : `近 ${daysNum} 天`;
  const digestTitle = (customTitle || '').trim() || `知识周报与专题综述 · ${today}（${windowLabel}）`;

  const topThemes = [...tagClusters.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6);

  const lines = [
    '---',
    `title: ${digestTitle}`,
    'category: digest',
    `date: ${today}`,
    `window: ${windowLabel}`,
    'tags:',
    '  - 知识周报',
    '  - 专题综述',
    '---',
    '',
    `# ${digestTitle}`,
    '',
    `> [!NOTE] 综述统计概览`,
    `> 本期共扫描汇总 **${scopedNotes.length}** 篇笔记：包含 **${memos.length}** 条手记/Memo、**${completedTasks.length}** 项已完成任务、**${openTasks.length}** 项待推进任务、**${excerpts.length}** 条研究摘录，覆盖 **${topThemes.length}** 个核心标签主题。`,
    '',
    '## 一、 核心主题脉络聚类',
    '',
  ];

  if (topThemes.length) {
    for (const [tag, list] of topThemes) {
      const refs = list.slice(0, 5).map(item => item.citation).join('、');
      lines.push(`- **#${tag}**（${list.length} 篇）：${refs}`);
    }
  } else {
    lines.push('- 本周期笔记尚未标注细分主题标签。');
  }

  lines.push('', '## 二、 灵感手记与 Memo 要点', '');
  if (memos.length) {
    for (const m of memos.slice(0, 8)) {
      lines.push(`- **${m.date}** · ${m.citation}：${m.summary}`);
    }
  } else {
    for (const n of scopedNotes.slice(0, 4)) {
      const stem = noteTargetTitle(n);
      lines.push(`- [[${stem}]]：${(n.excerpt || '').slice(0, 110)}`);
      addCite(n);
    }
  }

  lines.push('', '## 三、 任务进展与行动复盘', '');
  if (completedTasks.length) {
    for (const t of completedTasks.slice(0, 8)) {
      lines.push(`- [x] ${t.text} （来源：${t.citation}）`);
    }
  }
  if (openTasks.length) {
    for (const t of openTasks.slice(0, 8)) {
      lines.push(`- [${t.status === 'doing' ? '/' : ' '}] ${t.text} （来源：${t.citation}）`);
    }
  }
  if (!completedTasks.length && !openTasks.length) {
    lines.push('- 本周期暂无待办或已结项任务记录。');
  }

  if (excerpts.length) {
    lines.push('', '## 四、 研究资料与原文摘录汇编', '');
    for (const ex of excerpts.slice(0, 6)) {
      lines.push(`- **${ex.title}**：${ex.summary} → ${ex.sourceLink}`);
    }
  }

  lines.push('', '## 五、 可追溯引用来源清单', '');
  for (const cite of citations) {
    lines.push(`- ${cite.citation}（版本 \`${String(cite.version || 'latest').slice(0, 8)}\`）`);
  }

  return {
    title: digestTitle,
    windowLabel,
    stats: {
      scopedNotes: scopedNotes.length,
      memos: memos.length,
      completedTasks: completedTasks.length,
      openTasks: openTasks.length,
      excerpts: excerpts.length,
      themes: topThemes.length,
    },
    citations,
    markdown: lines.join('\n') + '\n',
  };
}

export function splitNoteIntoCards(note, { minSectionLength = 15 } = {}) {
  if (!note || typeof note.source !== 'string') {
    throw new Error('请选择包含正文的笔记进行拆卡');
  }
  const src = note.source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const fm = parseFrontMatter(src);
  const body = src.slice(fm.bodyFrom);
  const parentTitle = noteTargetTitle(note) || '来源笔记';
  const baseTags = Array.isArray(note.tags) && note.tags.length ? note.tags.slice(0, 4) : ['原子卡片'];

  const lines = body.split('\n');
  const sections = [];
  let currentHeading = '';
  let currentLines = [];
  let inFence = false;

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (currentHeading && content.length >= minSectionLength) {
      sections.push({
        heading: currentHeading,
        content,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      if (currentHeading) currentLines.push(line);
      continue;
    }
    if (!inFence) {
      const h2Match = /^##\s+(.+)$/.exec(line);
      if (h2Match) {
        flush();
        currentHeading = h2Match[1].replace(/^[一二三四五六七八九十\d]+[、.\s]+/, '').trim() || h2Match[1].trim();
        continue;
      }
    }
    if (currentHeading) {
      currentLines.push(line);
    }
  }
  flush();

  const cards = sections.slice(0, 12).map((sec, index) => {
    const cardTitle = `${parentTitle} · ${sec.heading}`.slice(0, 60);
    const cardMd = [
      '---',
      `title: ${cardTitle}`,
      'category: card',
      `parent_note: "[[${parentTitle}]]"`,
      `card_order: ${index + 1}`,
      'tags:',
      ...baseTags.map(t => `  - ${t}`),
      '---',
      '',
      `# ${cardTitle}`,
      '',
      `> 提炼自母卡 [[${parentTitle}#${sec.heading}|${parentTitle} § ${sec.heading}]]`,
      '',
      sec.content,
      '',
    ].join('\n');

    return {
      order: index + 1,
      heading: sec.heading,
      title: cardTitle,
      folder: 'cards',
      wordCount: sec.content.length,
      markdown: cardMd,
    };
  });

  const mocSection = cards.length
    ? [
        '',
        '## 原子卡片索引 (MOC)',
        '',
        ...cards.map(c => `- [[cards/${c.title}|${c.heading}]]（${c.wordCount} 字）`),
        '',
      ].join('\n')
    : '';

  return {
    parentTitle,
    cards,
    mocSection,
  };
}
