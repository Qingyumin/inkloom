import { parseFrontMatter, extractWikiLinks, stripNumericPrefix, localDate } from './vault-graph.mjs';
import { searchVaultContext, filterNotesByScope } from './ai-retrieval.mjs';
import { compressOrthogonalContext } from './karpathy-wiki-chronicle.mjs';

const allowedProviders = new Set(['local-grounded', 'local-gguf', 'openai-compatible', 'ollama']);

export function defaultModelProfiles() {
  return [
    {
      id: 'local-ollama-smollm2',
      name: '本地最小模型 SmolLM2-135M（已下载 GGUF · 零外网）',
      provider: 'local-gguf',
      model: 'smollm2:135m-instruct-q4_0',
      endpoint: 'http://127.0.0.1:11435/v1/chat/completions',
      maxContextChars: 8000,
    },
    {
      id: 'copilot-gemini-4',
      name: '在线大模型 Gemini 4（Copilot / OpenAI 兼容网关）',
      provider: 'openai-compatible',
      model: 'gemini-4',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      maxContextChars: 32000,
    },
    {
      id: 'local-ollama-qwen',
      name: '本地 Ollama · Qwen2.5-0.5B（11434 端口）',
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      endpoint: 'http://127.0.0.1:11434/api/chat',
      maxContextChars: 12000,
    },
    {
      id: 'local-grounded',
      name: '内置离线有据合成引擎（确定性段落提取）',
      provider: 'local-grounded',
      model: 'inkloom-grounded-v1',
      endpoint: 'local://inkloom-grounded',
      maxContextChars: 16000,
    },
  ];
}

export function validateAiProviderConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型配置无效');
  const provider = allowedProviders.has(input.provider) ? input.provider : null;
  if (!provider) throw new Error('不支持的模型提供商类型');
  const profileId = typeof input.profileId === 'string' && input.profileId.trim() ? input.profileId.trim().slice(0, 64) : (provider === 'local-gguf' ? 'local-ollama-smollm2' : provider === 'openai-compatible' ? 'copilot-gemini-4' : provider);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : profileId;
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim().slice(0, 120)
    : (provider === 'local-grounded' ? 'inkloom-grounded-v1' : provider === 'local-gguf' ? 'smollm2:135m-instruct-q4_0' : 'gemini-4');
  let endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (provider === 'local-grounded') {
    endpoint = 'local://inkloom-grounded';
  } else {
    if (!endpoint) {
      endpoint = provider === 'local-gguf'
        ? 'http://127.0.0.1:11435/v1/chat/completions'
        : provider === 'ollama'
          ? 'http://127.0.0.1:11434/api/chat'
          : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    }
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new Error('模型接口地址必须是合法的 HTTP/HTTPS URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('模型接口地址仅支持不含凭据的 HTTP 或 HTTPS 协议');
    endpoint = parsed.href;
  }
  const maxContextChars = Math.min(64000, Math.max(1000, Number(input.maxContextChars) || 16000));
  return { profileId, name, provider, endpoint, model, maxContextChars };
}

export function maskCredentialKey(rawKey = '') {
  const trimmed = String(rawKey || '').trim();
  if (!trimmed) return { hasKey: false, maskedKey: '' };
  if (trimmed.length <= 8) return { hasKey: true, maskedKey: '••••' };
  return { hasKey: true, maskedKey: trimmed.slice(0, 3) + '••••' + trimmed.slice(-3) };
}

export function humanizeChunkText(rawText = '') {
  const lines = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const cleanedLines = [];
  let inCodeFence = false;
  let inMathBlock = false;
  let mathBuffer = [];
  let tableHeaders = null;
  const tableSummaries = [];

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (line === '$$') {
      if (inMathBlock) {
        const expr = mathBuffer.join(' ')
          .replace(/\\bigl|\\bigr|\\left|\\right/g, '')
          .replace(/\\cdot/g, '·')
          .replace(/\\ln/g, 'ln')
          .replace(/\\deg\^\{\+\}/g, '入度')
          .replace(/\\deg\^\{-\}/g, '出度')
          .replace(/\\alpha/g, 'α')
          .replace(/\s+/g, ' ')
          .trim();
        if (expr) cleanedLines.push(`【核心公式：${expr}】`);
        mathBuffer = [];
        inMathBlock = false;
      } else {
        inMathBlock = true;
      }
      continue;
    }
    if (inMathBlock) {
      mathBuffer.push(line);
      continue;
    }

    // Convert Markdown table rows into readable comparisons instead of raw |---|---| pipes
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!tableHeaders) {
        tableHeaders = cells;
      } else if (cells.length >= 2) {
        const key = cells[0].replace(/\*\*/g, '');
        const val = cells[cells.length - 1].replace(/\*\*/g, '');
        if (key && val) tableSummaries.push(`${key}：${val}`);
      }
      continue;
    }

    const normal = line
      .replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '')
      .replace(/^>\s*/, '')
      .replace(/\$([^$]+)\$/g, (_, m) => m.replace(/\\cdot/g, '·').trim())
      .replace(/(\[\[([^\]]+)\]\])\2+/g, '$1')
      .trim();
    if (normal) cleanedLines.push(normal);
  }

  if (tableSummaries.length) {
    cleanedLines.push('核心对照：' + tableSummaries.slice(0, 4).join('；'));
  }

  return cleanedLines.join(' ').replace(/\s+/g, ' ').trim();
}

export function answerWithGroundedContext({ question, retrieval, providerConfig = { provider: 'local-grounded', model: 'inkloom-grounded-v1' } }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('请输入要查询或分析的问题');
  const rawChunks = retrieval?.chunks || [];
  // Filter out empty-note placeholder chunks if real chunks exist
  const substantiveChunks = rawChunks.filter(c => !/^在此输入正文，使用/.test(c.text.trim()));
  const chunks = substantiveChunks.length ? substantiveChunks : rawChunks;
  const scopedCount = retrieval?.scopedNotes?.length || 0;
  if (!chunks.length) {
    return {
      status: 'insufficient-evidence',
      answer: `在所选范围（共核对 ${scopedCount} 篇笔记）内未找到与「${q}」相关的可靠段落依据，拒绝编造回答。请尝试扩大检索范围或补充相关笔记。`,
      executiveSummary: '',
      synthesizedPoints: [],
      citations: [],
      model: providerConfig.model || 'inkloom-grounded-v1',
      provider: providerConfig.provider || 'local-grounded',
      usage: { promptChars: q.length, contextChars: 0, citedChunks: 0 },
    };
  }

  // Group & deduplicate by (noteId + heading) so the same section is synthesized into one rich point
  const groupedMap = new Map();
  for (const chunk of chunks) {
    const key = `${chunk.noteId}::${chunk.heading || '概述'}`;
    const humanized = humanizeChunkText(chunk.text);
    if (!humanized) continue;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        ...chunk,
        mergedTexts: [humanized],
        lineFrom: chunk.lineFrom,
        lineTo: chunk.lineTo,
      });
    } else {
      const existing = groupedMap.get(key);
      if (!existing.mergedTexts.includes(humanized) && existing.mergedTexts.join(' ').length < 320) {
        existing.mergedTexts.push(humanized);
        existing.lineFrom = Math.min(existing.lineFrom, chunk.lineFrom);
        existing.lineTo = Math.max(existing.lineTo, chunk.lineTo);
      }
    }
    if (groupedMap.size >= 5) break;
  }

  const topGroups = [...groupedMap.values()].slice(0, 5);
  const uniqueTitles = [...new Set(topGroups.map(g => `《${g.title}》`))];
  const uniqueWikiLinks = [...new Set(topGroups.map(g => `[[${stripNumericPrefix(g.title)}]]`))];
  const leadSummaryParts = topGroups.slice(0, 3).map(g => {
    const firstSentence = g.mergedTexts.join(' ').split(/[。！？；]/)[0]?.trim() || '';
    return firstSentence;
  }).filter(Boolean);

  const executiveSummary = `针对问题「${q}」，综合您知识库中的 ${uniqueWikiLinks.slice(0, 3).join('、')} 等 ${uniqueTitles.length} 篇核心笔记与模型推演，直接结论如下：${leadSummaryParts.join('；')}。`;

  const synthesizedPoints = topGroups.map((group, idx) => {
    const aspectTitle = group.heading
      ? `${group.heading}（源自《${group.title}》）`
      : `《${group.title}》核心机制阐述`;
    const bodyText = group.mergedTexts.join(' ').slice(0, 280);
    return {
      index: idx + 1,
      aspectTitle,
      noteId: group.noteId,
      title: group.title,
      cleanTitle: stripNumericPrefix(group.title),
      heading: group.heading || '正文核心段',
      lineFrom: group.lineFrom,
      lineTo: group.lineTo,
      citation: group.citation,
      score: group.score,
      bodyText,
    };
  });

  const modelSynthesisBlocks = [
    {
      title: '一、 核心机制与直接解答',
      content: `${leadSummaryParts.join('。')}。在您的知识体系中，这一主题由 ${uniqueWikiLinks.slice(0, 3).join(' 与 ')} 共同支撑，核心在于将零散信息转化为结构化、可回溯的显式知识网络。`,
    },
    {
      title: '二、 关键维度与方法拆解',
      content: synthesizedPoints
        .slice(0, 3)
        .map(pt => `**${pt.heading}**（[[${pt.cleanTitle}]]）：${pt.bodyText.slice(0, 140)}`)
        .join('；'),
    },
    {
      title: '三、 模型知识拓展与实操建议',
      content: `围绕「${q}」，建议从三个层面形成闭环：(1) **结构化沉淀**：将本次提炼出的跨笔记洞见保存为独立概念卡；(2) **双向织网**：在关联源笔记（${uniqueWikiLinks.slice(0, 3).join('、')}）中建立反向双链，提升局部与全局星图的连通度；(3) **间隔巩固**：将核心定义转化为 SM-2 问答闪卡长期内化。`,
    },
  ];

  const bulletLines = synthesizedPoints.map(pt => {
    return `${pt.index}. **${pt.title}**（${pt.heading ? pt.heading + ' · ' : ''}第 ${pt.lineFrom}–${pt.lineTo} 行）：${pt.bodyText} ${pt.citation}`;
  });
  const contextChars = topGroups.reduce((sum, item) => sum + item.text.length, 0);
  const orthogonalFunnel = compressOrthogonalContext(retrieval.chunks || [], q, { maxChunks: 6 });

  return {
    status: 'grounded',
    question: q,
    executiveSummary,
    modelSynthesisBlocks,
    synthesizedPoints,
    orthogonalFunnel,
    answer: `${executiveSummary}\n\n` + bulletLines.join('\n'),
    citations: topGroups.map(chunk => ({
      noteId: chunk.noteId,
      title: chunk.title,
      cleanTitle: stripNumericPrefix(chunk.title),
      relativePath: chunk.relativePath,
      sourceFile: chunk.sourceFile || '',
      wikiLayer: chunk.wikiLayer || 'L2-Raw',
      version: chunk.version,
      heading: chunk.heading,
      lineFrom: chunk.lineFrom,
      lineTo: chunk.lineTo,
      citation: chunk.citation,
      score: chunk.score,
      snippet: chunk.mergedTexts.join(' ').slice(0, 180),
    })),
    model: providerConfig.model || 'inkloom-grounded-v1',
    provider: providerConfig.provider || 'local-grounded',
    usage: { promptChars: q.length, contextChars, citedChunks: topGroups.length },
  };
}

export function crystallizeAnswerToNote({
  question = '',
  customTitle = '',
  targetFolder = 'notes',
  response = {},
  remoteModelAnswer = '',
  today = localDate(),
} = {}) {
  const q = String(question || response?.question || '专题洞察').trim();
  const isWikiTarget = String(targetFolder || '').toLowerCase().startsWith('wiki');
  const defaultPrefix = isWikiTarget ? 'Wiki · ' : '智识洞察 · ';
  const rawTitle = String(customTitle || '').trim() || `${defaultPrefix}${q.replace(/[？?！!。，,\/\\|:：\[\]#]/g, '').trim().slice(0, 24)}`;
  const cleanNoteTitle = rawTitle.replace(/[\[\]#|\/\\]/g, '-').trim() || `${defaultPrefix}${today}`;
  const resolvedFolder = isWikiTarget ? 'wiki' : (targetFolder || 'notes');

  const seenIds = new Set();
  const linkedNotes = [];
  const sourcePaths = [];
  for (const cite of response?.citations || []) {
    if (!cite?.noteId || seenIds.has(cite.noteId)) continue;
    seenIds.add(cite.noteId);
    if (cite.relativePath) sourcePaths.push(cite.relativePath);
    const cleanTitle = stripNumericPrefix(cite.cleanTitle || cite.title || '');
    linkedNotes.push({
      noteId: cite.noteId,
      title: cite.title,
      cleanTitle: cleanTitle || cite.title,
      relativePath: cite.relativePath || '',
      sourceFile: cite.sourceFile || '',
      citation: `[[${cleanTitle || cite.title}]]`,
      heading: cite.heading || '核心段落',
      lineFrom: cite.lineFrom,
      lineTo: cite.lineTo,
      snippet: cite.snippet || '',
    });
  }

  const wikiLinkRow = linkedNotes.map(n => n.citation).join(' · ') || '[[00-墨图导览与万象星图]]';
  const execSummary = String(response?.executiveSummary || '').trim() || `围绕「${q}」的跨笔记智识合成与模型推演结论。`;
  const modelBlocks = Array.isArray(response?.modelSynthesisBlocks) ? response.modelSynthesisBlocks : [];

  const lines = [
    '---',
    `title: "${cleanNoteTitle.replace(/"/g, '\\"')}"`,
    `tags: [${isWikiTarget ? 'Wiki晶体, Karpathy编译, 问答反哺' : '智识洞察, 知识结晶, 双链合成'}]`,
    `category: ${isWikiTarget ? 'wiki' : '智识洞察'}`,
    `status: ${isWikiTarget ? '已结晶' : '已就绪'}`,
    ...(isWikiTarget ? [`query_origin: "${q.replace(/"/g, '\\"')}"`, 'phi_order: 0.78'] : []),
    `summary: ${execSummary.slice(0, 92).replace(/[:：\[\]\r\n]/g, ' ')}`,
    `date: ${today}`,
    '---',
    '',
    `# ${cleanNoteTitle}`,
    '',
    `> [!TIP] ${isWikiTarget ? 'Karpathy LLM Wiki 问答反哺专页（Query → Wiki）' : '智识问答核心结论'}（问题：${q}）`,
    `> ${execSummary}`,
    '',
    '## 模型深度综合解答',
    '',
  ];

  if (remoteModelAnswer && remoteModelAnswer.trim()) {
    lines.push(remoteModelAnswer.trim(), '');
  }
  for (const block of modelBlocks) {
    lines.push(`### ${block.title}`, '', block.content, '');
  }

  lines.push('## 关联源笔记 (双链锚点)', '');
  for (const item of linkedNotes) {
    const rawOrigin = item.sourceFile ? ` · 原始资料 \`${item.sourceFile}\`` : '';
    lines.push(`- **${item.citation}**（${item.heading} · 第 ${item.lineFrom}–${item.lineTo} 行${rawOrigin}）：${item.snippet}`);
  }
  if (!linkedNotes.length) {
    lines.push(`- 核心关联脉络：${wikiLinkRow}`);
  }

  lines.push(
    '',
    '## 延伸思考与行动项',
    '',
    `- **双向织网关联**：${wikiLinkRow}`,
    ...(isWikiTarget ? ['- **所属总目录**：[[Karpathy Wiki 知识晶体总目录 (index.md)|📚 返回 Wiki 总目录 (wiki/index.md)]]'] : []),
    `- [ ] 结合《${cleanNoteTitle}》进一步补充个人实践算例或读书摘录`,
    '',
  );

  return {
    title: cleanNoteTitle,
    cleanName: cleanNoteTitle.replace(/^Wiki\s*·\s*/i, '').trim() || cleanNoteTitle,
    folder: resolvedFolder,
    isWikiTarget,
    markdown: lines.join('\n'),
    linkedNotes,
    sourcePaths,
  };
}

export function buildRevisionProposal({ noteId, title = '', source = '', version = '', revision = 0, mode = 'summary-callout', instruction = '' }) {
  if (typeof noteId !== 'string' || !noteId || typeof source !== 'string') throw new Error('修订目标笔记无效');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const clean = bom ? source.slice(1) : source;
  const fm = parseFrontMatter(clean);
  const front = clean.slice(0, fm.bodyFrom);
  const body = clean.slice(fm.bodyFrom);
  let proposedBody = body;
  let summary = '';

  if (mode === 'summary-callout') {
    const firstLines = body.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('>')).slice(0, 2);
    const digestLine = firstLines.join(' ').slice(0, 140) || (instruction.trim() || '本篇核心要点整理。');
    const callout = `> [!NOTE] 要点提炼${newline}> ${digestLine}${newline}${newline}`;
    if (!body.includes('[!NOTE] 要点提炼')) {
      const headingMatch = /^(\s*#\s+[^\r\n]+\r?\n(?:\r?\n)?)/.exec(body);
      proposedBody = headingMatch
        ? body.slice(0, headingMatch[1].length) + callout + body.slice(headingMatch[1].length)
        : callout + body;
    }
    summary = '在正文顶部插入受控 [!NOTE] 要点提炼提示块';
  } else if (mode === 'action-checklist') {
    const taskLine = `- [ ] 跟进：${(instruction.trim() || title || '复核本篇核心事项').replace(/[\r\n]/g, ' ')}`;
    proposedBody = body.replace(/(?:\r?\n)+$/, '') + newline + newline + '## 下一步行动' + newline + newline + taskLine + newline;
    summary = '在文末追加「下一步行动」待办清单章节';
  } else {
    throw new Error('不支持的修订模式');
  }

  const proposedSource = bom + front + proposedBody;
  const beforeLines = source.replaceAll('\r\n', '\n').split('\n');
  const afterLines = proposedSource.replaceAll('\r\n', '\n').split('\n');
  const diffLines = [];
  const maxCheck = Math.max(beforeLines.length, afterLines.length);
  let bi = 0; let ai = 0;
  while (bi < beforeLines.length || ai < afterLines.length) {
    if (bi < beforeLines.length && ai < afterLines.length && beforeLines[bi] === afterLines[ai]) {
      bi++; ai++;
      continue;
    }
    if (ai < afterLines.length && !beforeLines.slice(bi, bi + 4).includes(afterLines[ai])) {
      diffLines.push({ type: 'add', lineNumber: ai + 1, text: afterLines[ai] });
      ai++;
    } else if (bi < beforeLines.length) {
      diffLines.push({ type: 'remove', lineNumber: bi + 1, text: beforeLines[bi] });
      bi++;
    }
    if (diffLines.length > 120) break;
  }

  return {
    noteId,
    title,
    expectedVersion: version,
    expectedRevision: revision,
    mode,
    summary,
    originalSource: source,
    proposedSource,
    changed: proposedSource !== source,
    diff: diffLines,
  };
}

export function verifyAndApplyRevision(proposal, currentDoc) {
  if (!proposal || !currentDoc) throw new Error('修订提案或当前文档不存在');
  if (proposal.noteId !== currentDoc.id) throw new Error('目标笔记已切换，拒绝跨笔记写入');
  if (Number.isInteger(proposal.expectedRevision) && currentDoc.revision !== proposal.expectedRevision) {
    throw new Error('文档在预览期间已发生变化，请重新生成差异预览');
  }
  if (proposal.expectedVersion && currentDoc.version && proposal.expectedVersion !== currentDoc.version) {
    throw new Error('磁盘版本已变化，拒绝应用过期修订');
  }
  return proposal.proposedSource;
}

export function checkManuscriptConsistency(notes, { scope = { kind: 'vault' }, versions = new Map() } = {}) {
  const scoped = filterNotesByScope(notes, scope).sort((a, b) => {
    const oa = Number(a.metadata?.chapter_order || a.properties?.find?.(p => p.key === 'chapter_order')?.value || 999);
    const ob = Number(b.metadata?.chapter_order || b.properties?.find?.(p => p.key === 'chapter_order')?.value || 999);
    return oa - ob || String(a.relativePath || a.name).localeCompare(String(b.relativePath || b.name), 'zh-CN');
  });

  const checkedNotes = scoped.map(note => ({
    id: note.id,
    title: note.title || note.name,
    relativePath: note.relativePath || note.name,
    chapterOrder: Number(note.metadata?.chapter_order || note.properties?.find?.(p => p.key === 'chapter_order')?.value || 0) || null,
    version: versions.get(note.id) || note.version || '',
  }));

  const findings = [];
  const entityAttributes = new Map();
  const chapterDates = [];
  const existingTitles = new Set(notes.filter(n => n.exists !== false && !n.ghost).flatMap(n => [
    String(n.title || '').toLocaleLowerCase(),
    String(n.stem || '').toLocaleLowerCase(),
    String(n.relativePath || '').replace(/\.(md|markdown)$/i, '').toLocaleLowerCase(),
  ]).filter(Boolean));

  for (const note of scoped) {
    const source = String(note.source || '');
    const stem = String(note.relativePath || note.name || note.title || '').replace(/\.(md|markdown)$/i, '');
    const lines = source.split(/\r?\n/);
    let earliestDateInNote = '';

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const settingMatch = /^\s*(?:[-*]\s*)?【([^】]{1,24})[·:：]([^】]{1,24})】\s*[：:]\s*(.+?)\s*$/.exec(line);
      if (settingMatch) {
        const entity = settingMatch[1].trim();
        const attr = settingMatch[2].trim();
        const val = settingMatch[3].trim();
        const key = `${entity}::${attr}`;
        const prev = entityAttributes.get(key);
        if (prev && prev.value !== val) {
          findings.push({
            kind: 'character-setting-conflict',
            severity: 'warning',
            title: `设定冲突：${entity} 的「${attr}」前后不一致`,
            detail: `《${prev.noteTitle}》第 ${prev.line} 行记录为「${prev.value}」，而《${note.title}》第 ${idx + 1} 行记录为「${val}」`,
            citations: [prev.citation, `[[${stem}]]`],
          });
        } else if (!prev) {
          entityAttributes.set(key, { value: val, noteId: note.id, noteTitle: note.title, line: idx + 1, citation: `[[${stem}]]` });
        }
      }

      const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(line);
      if (dateMatch && !earliestDateInNote) earliestDateInNote = dateMatch[1];
    }

    const order = Number(note.metadata?.chapter_order || note.properties?.find?.(p => p.key === 'chapter_order')?.value || 0);
    if (order > 0 && earliestDateInNote) {
      chapterDates.push({ order, date: earliestDateInNote, noteTitle: note.title, citation: `[[${stem}]]` });
    }

    for (const link of extractWikiLinks(source, note.bodyFrom || 0)) {
      if (!link.target) continue;
      if (!existingTitles.has(link.target.toLocaleLowerCase())) {
        findings.push({
          kind: 'unresolved-thread',
          severity: 'info',
          title: `未闭合线索/待建节点：[[${link.target}]]`,
          detail: `在《${note.title}》第 ${link.line || 1} 行被引用，但当前知识库尚未创建对应笔记`,
          citations: [`[[${stem}]]`],
        });
      }
    }
  }

  chapterDates.sort((a, b) => a.order - b.order);
  for (let i = 1; i < chapterDates.length; i++) {
    if (chapterDates[i].date < chapterDates[i - 1].date) {
      findings.push({
        kind: 'timeline-regression',
        severity: 'warning',
        title: `时间线倒置：第 ${chapterDates[i].order} 章早于第 ${chapterDates[i - 1].order} 章`,
        detail: `《${chapterDates[i - 1].noteTitle}》（第 ${chapterDates[i - 1].order} 章）日期为 ${chapterDates[i - 1].date}，而后续《${chapterDates[i].noteTitle}》（第 ${chapterDates[i].order} 章）日期回退为 ${chapterDates[i].date}`,
        citations: [chapterDates[i - 1].citation, chapterDates[i].citation],
      });
    }
  }

  return {
    checkedScope: scope.kind || 'vault',
    checkedNotes,
    totalChecked: checkedNotes.length,
    findings,
    passed: findings.filter(f => f.severity === 'warning').length === 0,
  };
}

/**
 * MAJOR-260 (2.6.0): Cross-Chapter / Cross-Folder Entity & Timeline Tracking Matrix
 * Scans notes (optionally scoped to a multi-level folder or manuscript) for
 * 【实体·属性】：值 declarations, YAML/inline dates, and chapter sequences.
 */
export function buildCrossChapterEntityTimelineMatrix(notes = [], {
  folderPath = '',
  scope = { kind: 'vault' },
} = {}) {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const cleanFolder = String(folderPath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const folderPrefix = cleanFolder ? `${cleanFolder}/` : '';

  const baseScoped = filterNotesByScope(notes, scope).filter(n => {
    if (!n || n.exists === false || n.ghost) return false;
    if (String(n.metadata?.category || '').toLowerCase() === 'whiteboard') return false;
    if (!cleanFolder) return true;
    const rel = String(n.relativePath || n.name || '').replaceAll('\\', '/').replace(/^\/+/, '');
    return rel.toLowerCase().startsWith(folderPrefix.toLowerCase());
  });

  const sorted = [...baseScoped].sort((a, b) => {
    const oa = Number(a.metadata?.chapter_order || a.properties?.find?.(p => p.key === 'chapter_order')?.value || 9999);
    const ob = Number(b.metadata?.chapter_order || b.properties?.find?.(p => p.key === 'chapter_order')?.value || 9999);
    if (oa !== ob) return oa - ob;
    return collator.compare(String(a.relativePath || a.name || ''), String(b.relativePath || b.name || ''));
  });

  const entityMap = new Map();
  const timelineEntries = [];
  let attributeRecordCount = 0;
  let conflictCount = 0;

  for (const [idx, note] of sorted.entries()) {
    const source = String(note.source || '');
    const rel = String(note.relativePath || note.name || note.title || '').replaceAll('\\', '/').replace(/^\/+/, '');
    const stem = rel.replace(/\.(md|markdown)$/i, '');
    const citation = `[[${stem}]]`;
    const cleanTitle = String(note.cleanTitle || note.title || note.name || `章节 ${idx + 1}`).replace(/\.(md|markdown)$/i, '');
    const folder = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '根目录';
    const lines = source.split(/\r?\n/);

    let noteDateAnchor = String(
      note.date
      || note.metadata?.date
      || note.metadata?.era
      || note.metadata?.timeline
      || note.properties?.find?.(p => ['date', 'era', 'timeline'].includes(p.key))?.value
      || '',
    ).trim();

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const settingMatch = /^\s*(?:[-*]\s*)?【([^】]{1,28})[·:：]([^】]{1,28})】\s*[：:]\s*(.+?)\s*$/.exec(line);
      if (settingMatch) {
        const entityName = settingMatch[1].trim();
        const attrName = settingMatch[2].trim();
        const attrValue = settingMatch[3].trim();
        attributeRecordCount += 1;

        if (!entityMap.has(entityName)) {
          entityMap.set(entityName, {
            entity: entityName,
            firstNoteTitle: cleanTitle,
            firstCitation: citation,
            chapters: new Set(),
            citations: [],
            attributes: new Map(),
            conflicts: [],
          });
        }
        const entry = entityMap.get(entityName);
        if (!entry.chapters.has(stem)) {
          entry.chapters.add(stem);
          entry.citations.push(citation);
        }
        if (!entry.attributes.has(attrName)) {
          entry.attributes.set(attrName, []);
        }
        const attrHistory = entry.attributes.get(attrName);
        if (attrHistory.length > 0 && attrHistory[attrHistory.length - 1].value !== attrValue) {
          conflictCount += 1;
          entry.conflicts.push({
            attribute: attrName,
            fromValue: attrHistory[attrHistory.length - 1].value,
            fromCitation: attrHistory[attrHistory.length - 1].citation,
            toValue: attrValue,
            toCitation: citation,
          });
        }
        attrHistory.push({
          value: attrValue,
          noteId: note.id,
          noteTitle: cleanTitle,
          line: lineIdx + 1,
          citation,
        });
      }

      if (!noteDateAnchor) {
        const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(line) || /(公元前\s*\d+\s*年|\d{3,4}\s*年)/.exec(line);
        if (dateMatch) noteDateAnchor = dateMatch[1].trim();
      }
    }

    const chapterOrder = Number(note.metadata?.chapter_order || note.properties?.find?.(p => p.key === 'chapter_order')?.value || 0) || (idx + 1);
    const status = String(note.status || note.metadata?.status || '进行中').trim();
    if (noteDateAnchor || note.metadata?.chapter_order || cleanFolder) {
      timelineEntries.push({
        order: chapterOrder,
        noteId: note.id,
        title: cleanTitle,
        folder,
        relativePath: rel,
        citation,
        dateAnchor: noteDateAnchor || '未标注日期',
        status,
      });
    }
  }

  const entities = [...entityMap.values()].map(item => {
    const attrSummaries = [];
    for (const [attrKey, hist] of item.attributes.entries()) {
      const distinctVals = [...new Set(hist.map(h => h.value))];
      attrSummaries.push(
        distinctVals.length > 1
          ? `${attrKey}: ${distinctVals.join(' → ')} (⚠️演进/冲突)`
          : `${attrKey}: ${distinctVals[0]}`,
      );
    }
    return {
      entity: item.entity,
      firstNoteTitle: item.firstNoteTitle,
      firstCitation: item.firstCitation,
      appearanceCount: item.chapters.size,
      citations: item.citations,
      attributeSummary: attrSummaries.join('；'),
      conflictCount: item.conflicts.length,
    };
  });

  const scopeLabel = cleanFolder ? `目录 \`${cleanFolder}\`` : '全库范围';
  const entityRows = entities.length
    ? entities.map(e =>
        `| **${e.entity}** | ${e.attributeSummary.replace(/\|/g, '｜')} | ${e.firstCitation} | ${e.appearanceCount} 篇 | ${e.citations.slice(0, 5).join(' · ')} |`,
      )
    : ['| （暂无 `【实体·属性】：值` 记录） | 可在正文中书写 `【角色·身份】：值` 自动入表 | — | 0 | — |'];

  const timelineRows = timelineEntries.slice(0, 60).map(t =>
    `| ${t.order} | ${t.folder} | ${t.citation} | ${t.dateAnchor} | ${t.status} |`,
  );

  const markdown = [
    `# 🧭 跨章节人物·概念设定与时间线追踪矩阵`,
    '',
    `> **扫描范围**：${scopeLabel} · 已扫描 **${sorted.length}** 篇章节笔记 · 识别 **${entities.length}** 个核心实体（共 **${attributeRecordCount}** 条属性记录，变更/冲突 **${conflictCount}** 处） · 时间线节点 **${timelineEntries.length}** 处`,
    '',
    '## 一、 人物与核心概念跨章设定矩阵',
    '',
    '| 实体 / 角色 | 关键属性与跨章演进轨迹 | 首次登场 | 登场章数 | 关联章节双链 |',
    '| --- | --- | --- | --- | --- |',
    ...entityRows,
    '',
    '## 二、 章节时间线与目录叙事序列',
    '',
    '| 序号 | 所属目录层级 | 章节笔记（双链直达） | 时间锚点 | 状态 |',
    '| --- | --- | --- | --- | --- |',
    ...(timelineRows.length ? timelineRows : ['| — | — | 暂无时间线章节 | — | — |']),
    '',
  ].join('\n');

  return {
    folderPath: cleanFolder,
    totalNotes: sorted.length,
    entityCount: entities.length,
    attributeRecordCount,
    conflictCount,
    timelineCount: timelineEntries.length,
    entities,
    timelineEntries,
    markdown,
  };
}
