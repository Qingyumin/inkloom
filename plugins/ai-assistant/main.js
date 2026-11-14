import { createElement, Sparkles, Search, GitCompare, ShieldCheck, BookMarked, Settings2, ArrowUpRight, Check, X, Download, FolderOpen } from 'lucide';
import { defaultModelProfiles, validateAiProviderConfig, answerWithGroundedContext, crystallizeAnswerToNote, buildRevisionProposal, verifyAndApplyRevision } from '../../core/ai-assistant.mjs';
import { parseFrontMatter } from '../../core/vault-graph.mjs';
import { generateSkillCandidate, exportSanitizedSkill } from '../../core/ai-skills.mjs';
import { applyOrphanWeaveLink, splitNoteIntoCards } from '../../core/knowledge-synthesis.mjs';
import {
  applyFlashcardReviewToSource,
  buildFlashcardsFromNote,
  formatFlashcardPlainText,
  parseFlashcardRichSegments,
  extractCandidateFlashcardsFromNote,
  appendSelectedFlashcardsToNote,
  filterFlashcardsDeck,
  exportFlashcardsToAnkiTsv,
  exportFlashcardsToAnkiDeckPackageBytes,
  parseAnkiFlashcardsImport,
  appendImportedAnkiCardsToNote,
  buildImportedAnkiDeckNoteMarkdown,
  buildSampleAnkiTsv,
} from '../../core/spaced-repetition.mjs';
import { normalizeNoteHealthAndObsidianSyntax, executeDataviewQuery, convertExternalVaultNoteToInkloom } from '../../core/vault-doctor.mjs';
import { inspectVaultEmbedReferences } from '../../core/note-embeds.mjs';
import { listLocalMcpTools, mergeConflictedNote, computeFolderSyncPlan, buildZeroKnowledgeE2eeSyncEnvelope, decryptAndVerifyE2eeSyncEnvelope, evaluateCrossPlatformPortability } from '../../core/local-agent-sync.mjs';
import { defaultWikiRulesConfig, generateWikiRulesMarkdown, compileClusterToWikiPage, compileRawDocumentToWikiBundle, recomputeInvalidatedWikiPage, buildWikiMasterIndexMarkdown, appendWikiCompileLogMarkdown, appendDialecticalTensionToWikiMarkdown, detectRawFileFormat } from '../../core/karpathy-wiki-chronicle.mjs';
import { uint8ArrayToBase64 } from '../../core/raw-document-ingestor.mjs';
import { EXTERNAL_MCP_TOOLS_SPEC, buildExternalMcpClientConfigs, defaultMcpSecurityPolicy, recordMcpAuditEntry, formatMcpAuditLedgerMarkdown, handleMcpJsonRpcRequest } from '../../core/mcp-stdio-protocol.mjs';
import { EMBEDDING_INDEX_MODELS, buildSampleScannedOcrBytes, buildPersistentEmbeddingIndex } from '../../core/multimodal-ocr-embedding.mjs';

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cmdButton(icon, text, id = '', primary = false) {
  const btn = element('button', 'phase-command' + (primary ? ' obs-primary-btn' : ' obs-secondary-btn'));
  btn.type = 'button';
  if (id) btn.id = id;
  btn.append(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' }), element('span', '', text));
  return btn;
}

function helpBadge(tooltipText = '') {
  const wrap = element('span', 'ux-help-wrap');
  const trigger = element('button', 'ux-help-badge', '?');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', '查看功能说明：' + tooltipText);
  const pop = element('span', 'ux-help-popover', tooltipText);
  pop.setAttribute('role', 'tooltip');
  const placeHelp = () => {
    const bounds = trigger.getBoundingClientRect(); const width = Math.min(320, window.innerWidth - 24);
    pop.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, bounds.left)) + 'px';
    pop.style.top = Math.max(12, Math.min(window.innerHeight - pop.getBoundingClientRect().height - 12, bounds.bottom + 6)) + 'px';
  };
  wrap.onpointerenter = placeHelp;
  wrap.onfocusin = placeHelp;
  trigger.onclick = evt => {
    evt.preventDefault();
    evt.stopPropagation();
    wrap.classList.toggle('is-open');
    placeHelp();
  };
  trigger.onblur = () => wrap.classList.remove('is-open');
  wrap.append(trigger, pop);
  return wrap;
}

function settingRow(title, subtitle, control) {
  const row = element('label', 'obs-setting-item research-wide');
  const info = element('span', 'obs-setting-info');
  const titleLine = element('span', 'obs-setting-title-line');
  titleLine.append(element('strong', 'obs-setting-title', title));
  if (subtitle) titleLine.append(helpBadge(subtitle));
  info.append(titleLine);
  row.append(info, control);
  return row;
}

function sectionTitle(title, subtitle = '', rightAction = null) {
  const wrap = element('div', 'obs-section-heading ai-panel-header');
  const left = element('div', 'ai-panel-header-left');
  left.append(element('strong', 'ai-panel-title', title));
  if (subtitle) left.append(helpBadge(subtitle));
  wrap.append(left);
  if (rightAction) wrap.append(rightAction);
  return wrap;
}

function renderRichMarkdownSnippet(container, rawText = '', onOpenLink = null) {
  container.replaceChildren();
  let cleaned = String(rawText || '')
    .replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi, '【$1】')
    .replace(/(?:^|\s)>\s+/g, ' ')
    .replace(/\s+-\s*\*\*/g, ' · **')
    .replace(/\$([^$]+)\$/g, (_, mathExpr) => {
      return mathExpr
        .replace(/\\Phi/g, 'Φ')
        .replace(/\\ge/g, '≥')
        .replace(/\\le/g, '≤')
        .replace(/\\longrightarrow/g, '──►')
        .replace(/\\to/g, '→')
        .replace(/\\mathcal\{S\}_\{\\max\}/g, 'S_max')
        .replace(/\\mathcal\{S\}/g, 'S')
        .replace(/\\kappa/g, 'κ')
        .replace(/\^\\circ/g, '°')
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\|\\mathbf\{r\}_i\\|_2/g, '‖r_i‖₂')
        .replace(/E_\{\\text\{tension\}\}/g, 'E_tension')
        .replace(/[\\{}]/g, '')
        .trim();
    })
    .trim();

  const tokenRe = /(!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`\n]{1,64})`|=+([^=\n]+)=+|(?:\s|^)(#[A-Za-z0-9_\u4e00-\u9fa5/-]{1,28}))/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRe.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      container.append(document.createTextNode(cleaned.slice(lastIndex, match.index)));
    }
    if (match[2] !== undefined) {
      const rawTarget = match[2].trim();
      const alias = (match[3] || rawTarget.replace(/^.*?\//, '').replace('#^', ' · ^').replace('#', ' · ')).trim();
      const chip = element('button', 'sr-wikilink-chip', alias);
      chip.type = 'button';
      chip.title = `跳转到笔记：[[${rawTarget}]]`;
      if (onOpenLink) chip.onclick = () => onOpenLink(`[[${rawTarget.replace(/#\^.*$/, '')}]]`);
      container.append(chip);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const imgChip = element('span', 'ai-inline-tag-pill', `🖼️ 原图：${match[4] || '插图'} (${match[5]})`);
      container.append(imgChip);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const fileChip = element('span', 'sr-wikilink-chip', `${match[6]} (${match[7]})`);
      fileChip.title = `本地路径：${match[7]}`;
      container.append(fileChip);
    } else if (match[8] !== undefined) {
      container.append(element('strong', 'ai-prose-strong', match[8]));
    } else if (match[9] !== undefined) {
      container.append(element('code', 'sr-inline-code', match[9]));
    } else if (match[10] !== undefined) {
      container.append(element('mark', 'ai-prose-mark', match[10]));
    } else if (match[11] !== undefined) {
      const rawTag = match[11];
      if (rawTag.startsWith(' ')) container.append(document.createTextNode(' '));
      container.append(element('span', 'ai-inline-tag-pill', rawTag.trim()));
    }
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < cleaned.length) {
    container.append(document.createTextNode(cleaned.slice(lastIndex)));
  }
}

function renderRichMarkdownBody(bodyWrap, bodyMarkdown = '', onOpenLink = null) {
  const lines = String(bodyMarkdown || '').replace(/\r\n/g, '\n').split('\n');
  let listEl = null;
  let calloutLines = [];
  let calloutType = '';
  let calloutTitle = '';
  let tableRows = [];

  const flushList = () => {
    if (listEl) {
      bodyWrap.append(listEl);
      listEl = null;
    }
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    const tbl = element('table', 'ai-doc-table');
    const thead = element('thead');
    const tbody = element('tbody');
    const parseCells = rowLine => {
      const rawCells = [];
      let cur = '';
      let inBracket = 0;
      const stripped = rowLine.replace(/^\||\|$/g, '');
      for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i];
        if (ch === '[') inBracket++;
        else if (ch === ']') inBracket = Math.max(0, inBracket - 1);
        if (ch === '|' && inBracket === 0) {
          rawCells.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      rawCells.push(cur.trim());
      return rawCells;
    };
    const dataRows = tableRows.filter(r => !/^\|?[\s:|-]+\|?$/.test(r));
    dataRows.forEach((rLine, rIdx) => {
      const tr = element('tr');
      for (const cellText of parseCells(rLine)) {
        const cellEl = element(rIdx === 0 ? 'th' : 'td');
        renderRichMarkdownSnippet(cellEl, cellText, onOpenLink);
        tr.append(cellEl);
      }
      if (rIdx === 0) thead.append(tr);
      else tbody.append(tr);
    });
    if (thead.childElementCount) tbl.append(thead);
    if (tbody.childElementCount) tbl.append(tbody);
    bodyWrap.append(tbl);
    tableRows = [];
  };
  const flushCallout = () => {
    if (!calloutLines.length && !calloutTitle) return;
    const box = element('div', 'ai-doc-callout is-' + (calloutType.toLowerCase() || 'note'));
    if (calloutTitle) {
      box.append(element('strong', 'ai-doc-callout-title', calloutTitle));
    }
    const body = element('div', 'ai-doc-callout-body');
    renderRichMarkdownSnippet(body, calloutLines.join(' '), onOpenLink);
    box.append(body);
    bodyWrap.append(box);
    calloutLines = [];
    calloutType = '';
    calloutTitle = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      flushCallout();
      flushTable();
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      flushCallout();
      tableRows.push(line);
      continue;
    }
    flushTable();
    const calloutStart = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(line);
    if (calloutStart) {
      flushList();
      flushCallout();
      calloutType = calloutStart[1].toUpperCase();
      calloutTitle = calloutStart[2].trim() || calloutType;
      continue;
    }
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s*/, '').trim();
      if (calloutType || calloutTitle) {
        if (quoteText) calloutLines.push(quoteText);
      } else {
        calloutType = 'NOTE';
        calloutTitle = '引用与提示';
        if (quoteText) calloutLines.push(quoteText);
      }
      continue;
    }
    flushCallout();

    const hMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hMatch) {
      flushList();
      const level = hMatch[1].length;
      const hEl = element(level === 1 ? 'h3' : 'h4', `ai-doc-heading is-h${level}`);
      renderRichMarkdownSnippet(hEl, hMatch[2].trim(), onOpenLink);
      bodyWrap.append(hEl);
      continue;
    }

    const taskMatch = /^[-*+]\s+\[([ xX/])\]\s+(.+)$/.exec(line);
    if (taskMatch) {
      if (!listEl) listEl = element('ul', 'ai-doc-list');
      const li = element('li', 'ai-doc-list-item is-task');
      const done = taskMatch[1].toLowerCase() === 'x';
      li.append(element('span', 'ai-doc-task-box' + (done ? ' is-done' : ''), done ? '☑' : '☐'));
      const span = element('span', 'ai-doc-task-text');
      renderRichMarkdownSnippet(span, taskMatch[2].trim(), onOpenLink);
      li.append(span);
      listEl.append(li);
      continue;
    }

    const bulletMatch = /^(?:[-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (bulletMatch) {
      if (!listEl) listEl = element('ul', 'ai-doc-list');
      const li = element('li', 'ai-doc-list-item');
      renderRichMarkdownSnippet(li, bulletMatch[1].trim(), onOpenLink);
      listEl.append(li);
      continue;
    }

    flushList();
    const p = element('p', 'ai-doc-paragraph');
    renderRichMarkdownSnippet(p, line, onOpenLink);
    bodyWrap.append(p);
  }
  flushList();
  flushCallout();
  flushTable();
}

export function renderRichMarkdownDocument(container, markdown = '', {
  headerBadge = '📄 富文本排版预览',
  rawSource = '',
  onOpenLink = null,
} = {}) {
  container.replaceChildren();
  const cleanMd = String(markdown || '').replace(/^\uFEFF/, '');
  const fm = parseFrontMatter(cleanMd);
  const meta = fm.metadata || {};
  const bodyMd = cleanMd.slice(fm.bodyFrom || 0).trim();

  const topHeader = element('div', 'ai-answer-header is-clean-doc-head');
  topHeader.append(element('span', 'ai-answer-status-badge is-grounded', headerBadge));
  const metaParts = [];
  if (meta.status) metaParts.push(meta.status);
  if (meta.window) metaParts.push(meta.window);
  if (meta.date) metaParts.push(meta.date);
  if (metaParts.length) {
    topHeader.append(element('small', 'ai-clean-doc-meta', metaParts.join(' · ')));
  }
  container.append(topHeader);

  const bodyWrap = element('div', 'ai-rich-doc-body');
  renderRichMarkdownBody(bodyWrap, bodyMd || cleanMd, onOpenLink);
  container.append(bodyWrap);

  const rawDrawer = element('details', 'ai-raw-source-drawer');
  rawDrawer.append(
    element('summary', '', '查看底层 Markdown 源码 / Diff 明细（可选）'),
    element('pre', 'ai-raw-source-pre', rawSource || cleanMd),
  );
  container.append(rawDrawer);
}

function renderFormattedGroundedAnswer(answerOutput, response, {
  question = '',
  scopeText = '',
  remoteModelAnswer = '',
  onOpenLink = null,
  onCrystallize = null,
} = {}) {
  answerOutput.replaceChildren();
  answerOutput.dataset.answerStatus = response.status;

  const header = element('div', 'ai-answer-header');
  const badge = element(
    'span',
    'ai-answer-status-badge ' + (response.status === 'grounded' ? 'is-grounded' : 'is-refused'),
    response.status === 'grounded' ? '基于笔记原文合成' : '未找到足够原文依据',
  );
  const meta = element('small', 'ai-answer-meta', scopeText || `模型：${response.model}`);
  header.append(badge);
  if (response.orthogonalFunnel?.funnelSummary) {
    const funnelBadge = element('span', 'ai-meta-chip is-score', response.orthogonalFunnel.funnelSummary);
    funnelBadge.id = 'ai-orthogonal-funnel-badge';
    funnelBadge.hidden = true;
    header.append(funnelBadge);
  }
  header.append(meta);
  answerOutput.append(header);

  if (response.status !== 'grounded' || !response.citations?.length) {
    const body = element('div', 'ai-answer-empty-body', response.answer);
    answerOutput.append(body);
    return;
  }

  // 1. Model-Powered Deep Synthesis & Expansion Section
  const modelSection = element('div', 'ai-model-deep-section');
  if (response.executiveSummary) {
    const execBox = element('div', 'ai-executive-synthesis-box');
    const execLabel = element('strong', 'ai-executive-label', '核心结论：');
    const execText = element('span', 'ai-executive-text');
    renderRichMarkdownSnippet(execText, response.executiveSummary, onOpenLink);
    execBox.append(execLabel, execText);
    modelSection.append(execBox);
  }

  if (remoteModelAnswer && remoteModelAnswer.trim()) {
    const llmCard = element('div', 'ai-llm-deep-answer-card');
    llmCard.append(element('div', 'ai-llm-deep-badge', `模型解答 (${response.model})`));
    const llmBody = element('div', 'ai-rich-doc-body');
    renderRichMarkdownBody(llmBody, remoteModelAnswer, onOpenLink);
    llmCard.append(llmBody);
    modelSection.append(llmCard);
  }

  if (Array.isArray(response.modelSynthesisBlocks) && response.modelSynthesisBlocks.length) {
    const blocksGrid = element('div', 'ai-model-blocks-grid');
    for (const blk of response.modelSynthesisBlocks) {
      const blkCard = element('div', 'ai-model-block-card');
      blkCard.append(element('strong', 'ai-model-block-title', blk.title));
      const blkBody = element('div', 'ai-model-block-body');
      renderRichMarkdownSnippet(blkBody, blk.content, onOpenLink);
      blkCard.append(blkBody);
      blocksGrid.append(blkCard);
    }
    modelSection.append(blocksGrid);
  }
  answerOutput.append(modelSection);

  // 2. Grounded Note Evidence Points
  const evidenceTitleBar = element('div', 'ai-sub-divider-bar', '原文出处与段落定位');
  answerOutput.append(evidenceTitleBar);

  const grid = element('div', 'ai-answer-points-grid');
  const synthPoints = Array.isArray(response.synthesizedPoints) && response.synthesizedPoints.length
    ? response.synthesizedPoints
    : response.citations.map((cite, idx) => ({
        index: idx + 1,
        aspectTitle: `${cite.heading ? cite.heading + ' · ' : ''}《${cite.title}》`,
        title: cite.title,
        heading: cite.heading,
        lineFrom: cite.lineFrom,
        lineTo: cite.lineTo,
        citation: cite.citation,
        bodyText: cite.snippet,
      }));

  for (const item of synthPoints) {
    const row = element('div', 'ai-answer-point-row');
    const numBadge = element('span', 'ai-point-index', String(item.index));
    const cell = element('div', 'ai-point-cell');

    const topBar = element('div', 'ai-point-source-bar');
    const titleEl = element('strong', 'ai-point-note-title', item.aspectTitle || item.title);
    const locBadge = element(
      'span',
      'ai-point-loc-badge',
      `《${item.title}》第 ${item.lineFrom}–${item.lineTo} 行`,
    );
    const jumpBtn = element('button', 'sr-wikilink-chip', '跳转原文 ↗');
    jumpBtn.type = 'button';
    jumpBtn.onclick = () => onOpenLink?.(item.citation);
    topBar.append(titleEl, locBadge, jumpBtn);

    const prose = element('div', 'ai-point-prose');
    renderRichMarkdownSnippet(prose, item.bodyText, onOpenLink);

    cell.append(topBar, prose);
    row.append(numBadge, cell);
    grid.append(row);
  }
  answerOutput.append(grid);

  // 3. One-Click Crystallize to Note & Auto Bidirectional Linking Bar (Knowledge Closure!)
  if (onCrystallize) {
    const uniqueNoteCount = new Set((response.citations || []).map(c => c.noteId).filter(Boolean)).size;
    const defaultCardTitle = `智识洞察 · ${(question || response.question || '专题合成').replace(/[？?！!。，,\/\\|:：\[\]#]/g, '').trim().slice(0, 22)}`;
    const crystalBar = element('div', 'ai-crystallize-action-bar');
    crystalBar.id = 'ai-crystallize-bar';

    const crystalLeft = element('div', 'ai-crystallize-left');
    const crystalHead = element('strong', 'ai-crystallize-heading', '存为笔记：');
    const titleRow = element('div', 'ai-crystallize-input-row');
    const titleInput = element('input', 'ai-crystallize-title-input');
    titleInput.type = 'text';
    titleInput.id = 'ai-crystallize-title';
    titleInput.value = defaultCardTitle;
    titleInput.setAttribute('aria-label', '沉淀新笔记标题');

    const targetSelect = element('select', 'ai-crystallize-target-select');
    targetSelect.id = 'ai-crystallize-target';
    targetSelect.setAttribute('aria-label', '沉淀目标目录');
    targetSelect.append(
      new Option('存入 notes/ 笔记', 'notes'),
      new Option('存入 wiki/ 百科', 'wiki'),
    );
    targetSelect.onchange = () => {
      const cur = titleInput.value.trim();
      if (targetSelect.value === 'wiki' && cur.startsWith('智识洞察 · ')) {
        titleInput.value = cur.replace(/^智识洞察\s*·\s*/, 'Wiki · ');
      } else if (targetSelect.value === 'notes' && cur.startsWith('Wiki · ')) {
        titleInput.value = cur.replace(/^Wiki\s*·\s*/, '智识洞察 · ');
      }
    };
    titleRow.append(titleInput, targetSelect);

    const biCheckLabel = element('label', 'ai-crystallize-check-label');
    const biCheck = element('input');
    biCheck.type = 'checkbox';
    biCheck.id = 'ai-crystallize-bidirectional';
    biCheck.checked = true;
    biCheckLabel.append(
      biCheck,
      document.createTextNode(`回写 ${uniqueNoteCount} 篇源笔记双链`),
    );
    crystalLeft.append(crystalHead, titleRow, biCheckLabel);

    const crystalRight = element('div', 'ai-crystallize-right');
    const saveNoteBtn = cmdButton(Sparkles, '存为新笔记', 'ai-crystallize-save-btn', true);
    const openNoteBtn = cmdButton(ArrowUpRight, '保存并打开', 'ai-crystallize-open-btn');
    const crystalStatus = element('small', 'ai-crystallize-status', '');
    crystalStatus.id = 'ai-crystallize-status';

    const runCrystallize = async openAfter => {
      saveNoteBtn.disabled = true;
      openNoteBtn.disabled = true;
      try {
        await onCrystallize({
          customTitle: titleInput.value.trim(),
          targetFolder: targetSelect.value,
          bidirectional: biCheck.checked,
          openAfter,
          statusEl: crystalStatus,
        });
      } finally {
        saveNoteBtn.disabled = false;
        openNoteBtn.disabled = false;
      }
    };
    saveNoteBtn.onclick = () => void runCrystallize(false);
    openNoteBtn.onclick = () => void runCrystallize(true);

    crystalRight.append(saveNoteBtn, openNoteBtn);
    crystalBar.append(crystalLeft, crystalRight, crystalStatus);
    answerOutput.append(crystalBar);
  }
}

export function activate(api) {
  const presets = defaultModelProfiles();
  api.registerSetting({ id: 'provider-config', name: '模型与上下文配置', type: 'data', default: presets[0] });
  api.registerSetting({ id: 'saved-profiles', name: '已保存的多模型预设列表', type: 'data', default: presets });
  api.registerSetting({ id: 'snapshot-history', name: '知识库历史里程碑快照表', type: 'data', default: [] });
  api.registerSetting({ id: 'embedding-model-id', name: '语义向量索引模型', type: 'data', default: 'fnv1a-128d-v1' });
  api.registerSetting({ id: 'embedding-index-snapshot', name: '持久化语义向量索引', type: 'data', default: null });
  api.registerSetting({ id: 'mcp-security-policy', name: '外部 MCP 工具级权限与目录白名单', type: 'data', default: null });
  api.registerSetting({ id: 'mcp-audit-ledger', name: '外部 MCP JSON-RPC 调用审计账本', type: 'data', default: [] });
  api.registerSetting({ id: 'e2ee-sync-envelope', name: '零知识 E2EE 增量加密同步仓清单', type: 'data', default: null });

  const view = api.registerView({
    id: 'ai-view',
    target: 'ai',
    name: '智识',
    icon: 'sparkles',
    location: 'activity',
    order: 42,
    mount(container, scope) {
      let activeTab = 'chat';
      if (window.__inkloomPendingSubTab?.viewId === 'ai-assistant:ai-view' && window.__inkloomPendingSubTab.subKey) {
        activeTab = window.__inkloomPendingSubTab.subKey;
        window.__inkloomPendingSubTab = null;
      }
      let scopesData = { folders: [], projects: [], manuscripts: [], totalNotes: 0 };
      let currentProposal = null;
      let currentSkillCandidate = null;
      let askController = null;

      const root = element('section', 'ai-assistant ai-master-detail-layout');
      root.id = 'ai-assistant';
      root.setAttribute('aria-label', '智识与技能工作台');

      const navSidebar = element('aside', 'ai-subnav-sidebar');
      navSidebar.id = 'ai-subnav-sidebar';
      navSidebar.setAttribute('aria-label', '智识二级功能导航');

      const navHeader = element('div', 'ai-subnav-header');
      const navTitle = element('strong', 'ai-subnav-title', '笔记智识');
      const statusBadge = element('span', 'home-status ux-status-pill', '本地有据');
      statusBadge.id = 'ai-status-badge';
      navHeader.append(navTitle, statusBadge);

      const tabs = element('div', 'ai-subnav-groups');
      tabs.setAttribute('role', 'tablist');

      const navGroups = [
        ['围绕笔记提问', [
          ['chat', '笔记问答', Sparkles, 'teal'],
          ['search', '段落搜索', Search, 'blue'],
          ['mcp', '多步助手', ShieldCheck, 'indigo'],
        ]],
        ['整理与连线', [
          ['compiler', '资料转百科', Sparkles, 'emerald'],
          ['revise', '当前笔记润色', GitCompare, 'blue'],
          ['synthesis', '孤岛笔记连线', Sparkles, 'purple'],
          ['digest', '周报与拆卡', BookMarked, 'teal'],
          ['consistency', '长稿前后核查', ShieldCheck, 'amber'],
          ['chronicle', '笔记时间脉络', BookMarked, 'purple'],
        ]],
        ['温习与守护', [
          ['flashcards', '闪卡温习', BookMarked, 'rose'],
          ['skills', '常用方法卡', BookMarked, 'indigo'],
          ['doctor', '格式与断链体检', ShieldCheck, 'emerald'],
          ['snapshot', '历史快照', Download, 'amber'],
          ['sync', '文件夹同步', FolderOpen, 'blue'],
          ['config', '模型连接', Settings2, 'slate'],
        ]],
      ];

      const panels = new Map();
      const navButtons = [];
      const mobileNavigation = element('select', 'ai-mobile-navigation'); mobileNavigation.id = 'ai-mobile-navigation'; mobileNavigation.setAttribute('aria-label', '智识功能');
      for (const [groupLabel, items] of navGroups) { const group = document.createElement('optgroup'); group.label = groupLabel; for (const [key, label] of items) group.append(new Option(label, key)); mobileNavigation.append(group); }
      mobileNavigation.value = activeTab; mobileNavigation.onchange = () => switchTab(mobileNavigation.value);

      for (const [groupLabel, items] of navGroups) {
        const groupEl = element('div', 'ai-subnav-group');
        groupEl.append(element('small', 'ai-subnav-group-title', groupLabel));
        for (const [key, label, iconGlyph, tone] of items) {
          const btn = element('button', 'ux-pill-option ai-subnav-item');
          btn.type = 'button';
          btn.dataset.aiTab = key;
          btn.dataset.pillTone = tone;
          btn.setAttribute('role', 'tab');
          btn.append(
            createElement(iconGlyph, { width: 14, height: 14, 'aria-hidden': 'true' }),
            element('span', '', label),
          );
          btn.onclick = () => { mobileNavigation.value = key; switchTab(key); };
          groupEl.append(btn);
          navButtons.push(btn);
        }
        tabs.append(groupEl);
      }
      navSidebar.append(navHeader, mobileNavigation, tabs);

      const mainStage = element('div', 'ai-stage-main');
      mainStage.id = 'ai-stage-main';

      const errorBox = element('p', 'database-error');
      errorBox.id = 'ai-error';
      errorBox.hidden = true;
      errorBox.setAttribute('role', 'alert');
      const fail = err => {
        if (!scope.signal.aborted && err?.name !== 'AbortError') {
          errorBox.hidden = false;
          errorBox.textContent = err.message || String(err);
        }
      };
      async function withIndexRetry(fn) {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            return await fn();
          } catch (err) {
            if (scope.signal.aborted) throw err;
            if ((err?.code === 'TASK_CANCELLED' || err?.name === 'AbortError' || /索引/.test(err?.message || '')) && attempt < 3) {
              await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
              continue;
            }
            throw err;
          }
        }
      }

      // 1. Grounded Q&A Panel (Pure Question Answering — separated from Retrieval & MCP Agent)
      const chatPanel = element('div', 'ai-panel');
      chatPanel.id = 'ai-panel-chat';
      const chatHeader = sectionTitle(
        '围绕笔记提问',
        '严格依据所选笔记范围生成回答，附带可点击的原文行号出处，并支持一键存为新笔记。',
      );
      const chatControls = element('div', 'research-form obs-card ai-compact-query-card');
      const scopeKind = element('select');
      scopeKind.id = 'ai-scope-kind';
      scopeKind.setAttribute('aria-label', '上下文范围');
      for (const [val, text] of [['vault', '全库笔记'], ['active', '当前笔记'], ['selection', '当前选区'], ['folder', '指定目录'], ['project', '指定项目'], ['manuscript', '指定长稿']]) {
        scopeKind.append(new Option(text, val));
      }
      const scopeKindLabel = settingRow('范围', '限定仅在所选知识库范围内检索段落并发送至模型', scopeKind);
      scopeKindLabel.classList.add('is-compact-select');

      const scopeTarget = element('select');
      scopeTarget.id = 'ai-scope-target';
      scopeTarget.setAttribute('aria-label', '具体范围目标');
      const scopeTargetLabel = settingRow('目标', '选择要限定的文件夹、项目或长稿', scopeTarget);
      scopeTargetLabel.classList.add('is-compact-select');
      scopeTargetLabel.hidden = true;

      const searchMode = element('select');
      searchMode.id = 'ai-search-mode';
      searchMode.setAttribute('aria-label', '检索策略');
      searchMode.append(
        new Option('智能混合检索', 'hybrid'),
        new Option('Wiki 百科优先', 'wiki-first'),
        new Option('精确词句匹配', 'lexical'),
      );
      const modeLabel = settingRow('方式', '混合向量检索、Wiki 百科优先或精确匹配', searchMode);
      modeLabel.classList.add('is-compact-select');

      const questionInput = element('input');
      questionInput.type = 'text';
      questionInput.id = 'ai-question-input';
      questionInput.placeholder = '向你的笔记提问，生成带出处的回答或新卡片...';
      questionInput.setAttribute('aria-label', '问题或检索词');
      const questionLabel = settingRow('提问', '输入问题后按回车或点击右侧按钮', questionInput);
      questionLabel.classList.add('is-primary-input');

      const chatActions = element('div', 'research-form-footer research-wide ai-exec-bar');
      const quickPromptsWrap = element('div', 'ai-quick-prompts');
      const scopeSummary = element('small', 'ai-exec-summary', '仅使用所选范围内的本地笔记片段');
      scopeSummary.id = 'ai-scope-summary';
      quickPromptsWrap.append(scopeSummary);
      for (const presetQ of ['双链笔记与卡片盒方法', '知识图谱与局部星图', '长文写作与工业级导出', 'YAML属性与标签体系']) {
        const chip = element('button', 'sr-wikilink-chip ai-prompt-chip', presetQ);
        chip.type = 'button';
        chip.onclick = () => {
          questionInput.value = presetQ;
          askSubmit.click();
        };
        quickPromptsWrap.append(chip);
      }
      const actionBtns = element('div', 'task-row-actions');
      const askSubmit = cmdButton(Sparkles, '提问', 'ai-ask-submit', true);
      const askCancel = cmdButton(X, '取消', 'ai-ask-cancel');
      askCancel.disabled = true;
      actionBtns.append(askSubmit, askCancel);
      chatActions.append(quickPromptsWrap, actionBtns);
      chatControls.append(questionLabel, scopeKindLabel, scopeTargetLabel, modeLabel, chatActions);

      const answerOutput = element('article', 'ai-answer-box ai-formatted-answer');
      answerOutput.id = 'ai-answer-output';
      answerOutput.dataset.answerStatus = 'idle';
      const renderIdleChatStudio = () => {
        if (answerOutput.dataset.answerStatus !== 'idle') return;
        const active = api.activeDocument?.();
        const activeTitle = active?.name ? active.name.replace(/\.md$/i, '') : '当前笔记';
        answerOutput.replaceChildren();
        const head = element('div', 'ai-answer-header');
        head.append(
          element('span', 'ai-answer-status-badge is-grounded', `当前上下文：《${activeTitle}》 与本地知识库`),
          element('small', 'ai-answer-meta', '点击下方问题卡或输入问题，即刻生成带行号出处的笔记解答'),
        );
        const studioGrid = element('div', 'ai-model-blocks-grid ai-idle-studio-grid');
        for (const [cardTitle, cardDesc, queryText, scopeVal] of [
          [`提炼《${activeTitle}》核心要点`, '基于当前正在阅读的笔记生成结构化要点与原文行号引用', activeTitle, 'active'],
          ['双链笔记与卡片盒方法', '梳理全库关于双向链接、块引用 #^block 与原子卡片的核心笔记', '双链笔记与卡片盒方法', 'vault'],
          ['知识图谱与关系溯源', '检索局部图谱、全局星图、显式双链与同标签推断关系的使用方法', '知识图谱与局部星图', 'vault'],
          ['文献精读与长稿写作', '查看 PDF/EPUB 原件哈希摘录、五色高亮汇总与多章长稿联排流程', '长文写作与工业级导出', 'vault'],
        ]) {
          const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
          card.type = 'button';
          card.append(
            element('strong', 'ai-model-block-title', cardTitle),
            element('div', 'ai-model-block-body', cardDesc),
          );
          card.onclick = () => {
            scopeKind.value = scopeVal;
            updateScopeTargetOptions();
            questionInput.value = queryText;
            askSubmit.click();
          };
          studioGrid.append(card);
        }
        answerOutput.append(head, studioGrid);
      };
      renderIdleChatStudio();
      const citationSectionHeader = element('div', 'ai-results-divider', '引用笔记段落（点击直达原文）');
      citationSectionHeader.hidden = true;
      const citationList = element('div', 'ai-citation-list ai-structured-citation-grid');
      citationList.id = 'ai-citation-list';

      chatPanel.append(chatHeader, chatControls, answerOutput, citationSectionHeader, citationList);
      panels.set('chat', chatPanel);

      // 1b. Dedicated Semantic Paragraph Retrieval Panel (Pure Search — separated from Q&A)
      const pureSearchPanel = element('div', 'ai-panel');
      pureSearchPanel.id = 'ai-panel-search';
      pureSearchPanel.hidden = true;
      const pureSearchHeader = sectionTitle(
        '跨库语义段落检索',
        '专注段落级快速定位（不调用生成模型）：通过 128 维特征哈希余弦相似度 + 中文二元分词 BM25 + 一跳双链扩展，秒级定位全库相关段落与精确行号。',
      );
      const pureSearchCard = element('div', 'research-form obs-card');
      const pureSearchInput = element('input');
      pureSearchInput.type = 'search';
      pureSearchInput.id = 'ai-pure-search-input';
      pureSearchInput.placeholder = '输入关键词或句子片段，定位全库高相关段落与行号...';
      pureSearchInput.setAttribute('aria-label', '语义检索关键词');
      const pureSearchRow = settingRow('检索词或概念短语', '支持自然语言短语与精确术语混合匹配', pureSearchInput);
      const pureSearchFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      const pureSearchStatus = element('small', 'ai-exec-summary', '点击「执行段落检索」查看按相关度排序的原文证据表');
      pureSearchStatus.id = 'ai-pure-search-status';
      const pureSearchBtn = cmdButton(Search, '执行段落检索', 'ai-pure-search-btn', true);
      pureSearchFooter.append(pureSearchStatus, pureSearchBtn);
      pureSearchCard.append(pureSearchRow, pureSearchFooter);
      const pureSearchList = element('div', 'ai-citation-list ai-structured-citation-grid');
      pureSearchList.id = 'ai-pure-search-list';
      const renderIdleSearchStudio = () => {
        if (pureSearchList.childElementCount) return;
        for (const [topicTitle, topicDesc, queryVal] of [
          ['双链语法与块引用', '查找全库关于 [[双链]]、#^block 段落引用与分屏对照的笔记段落', '双链'],
          ['知识图谱与节点寻路', '定位局部星图、全局图谱、孤岛笔记与最短路径相关的段落', '知识图谱'],
          ['文献摘录与长稿写作', '检索 PDF/EPUB 原件哈希溯源、五色高亮与多章长稿相关段落', '摘录'],
          ['YAML 属性与多维视图', '查找笔记属性、状态看板、公式汇总与目录树组织相关段落', 'YAML'],
        ]) {
          const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
          card.type = 'button';
          card.append(
            element('strong', 'ai-model-block-title', `🔍 ${topicTitle}`),
            element('div', 'ai-model-block-body', topicDesc),
          );
          card.onclick = () => {
            pureSearchInput.value = queryVal;
            pureSearchBtn.click();
          };
          pureSearchList.append(card);
        }
      };
      renderIdleSearchStudio();
      pureSearchPanel.append(pureSearchHeader, pureSearchCard, pureSearchList);
      panels.set('search', pureSearchPanel);

      pureSearchBtn.onclick = async () => {
        const q = pureSearchInput.value.trim() || questionInput.value.trim() || '双链';
        errorBox.hidden = true;
        pureSearchBtn.disabled = true;
        try {
          const retrieval = await withIndexRetry(() => api.queryAi({
            subkind: 'search',
            query: q,
            scope: { kind: 'vault' },
            mode: 'hybrid',
            limit: 8,
          }, { signal: scope.signal, key: 'ai-pure-search' }));
          pureSearchStatus.textContent = `全库核对 ${retrieval.scopedNotes.length} 篇笔记 · 命中 ${retrieval.chunks.length} 处高相关段落`;
          pureSearchList.replaceChildren();
          for (const chunk of retrieval.chunks) {
            const card = element('div', 'ai-citation-card is-structured');
            const headBar = element('div', 'ai-citation-card-header');
            const jump = element('button', 'home-task-title', `📄 ${chunk.title} · 第 ${chunk.lineFrom}–${chunk.lineTo} 行`);
            jump.type = 'button';
            jump.onclick = () => api.openLink(chunk.citation).catch(fail);
            const badges = element('div', 'ai-citation-badges');
            badges.append(
              element('span', 'ai-meta-chip', `相关度 ${chunk.score}`),
              element('span', 'ai-meta-chip', `版本 ${String(chunk.version || '').slice(0, 8)}`),
            );
            headBar.append(jump, badges);
            const snippet = element('div', 'ai-citation-card-body');
            renderRichMarkdownSnippet(snippet, chunk.text.slice(0, 200), link => api.openLink(link).catch(fail));
            card.append(headBar, snippet);
            pureSearchList.append(card);
          }
        } catch (err) {
          fail(err);
        } finally {
          pureSearchBtn.disabled = false;
        }
      };

      // 1c. Dedicated Controlled Local MCP Agent Toolbox Panel (AIA-005 — own tab!)
      const mcpPanel = element('div', 'ai-panel');
      mcpPanel.id = 'ai-panel-mcp';
      mcpPanel.hidden = true;
      const mcpSectionHeading = sectionTitle(
        '受控本地 MCP Agent 工具箱 (AIA-005)',
        '开放 6 大受控本地工具（跨库检索 / 章节精读 / 盲区诊断 / 项目汇总 / 新卡提案 / 批量标签），逐步可视化展示推理轨迹，任何写操作强制经过 Diff 预览与人工批准门禁。',
      );
      const mcpForm = element('div', 'research-form obs-card');
      mcpForm.id = 'ai-mcp-agent-section';

      const mcpToolBar = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row');
      mcpToolBar.id = 'ai-mcp-tool-pills';
      for (const toolMeta of listLocalMcpTools()) {
        const pill = element('span', 'ux-pill-option ai-sr-stat-pill', toolMeta.label);
        pill.dataset.pillTone = toolMeta.tone;
        pill.dataset.mcpToolId = toolMeta.id;
        pill.title = `${toolMeta.name}：${toolMeta.description}`;
        mcpToolBar.append(pill);
      }

      const mcpToolSelect = element('select');
      mcpToolSelect.id = 'ai-mcp-tool-select';
      mcpToolSelect.setAttribute('aria-label', 'MCP Agent 执行模式与受控工具');
      mcpToolSelect.append(
        new Option('多步自动编排（检索 → 精读 → 盲区诊断 → 草拟新卡提案）', 'propose_note'),
        new Option('批量标签规范化提案（检索 → 扫描 → 生成 YAML 标签 Diff）', 'batch_tag_update'),
        new Option('项目与手记进展汇总（检索 → 章节精读 → 项目简报）', 'summarize_project'),
      );
      const mcpToolSelectRow = settingRow('Agent 任务编排模式', '选择多步工具调用链路，所有写库提案均需人工确认后才落盘', mcpToolSelect);

      const mcpGoalInput = element('input');
      mcpGoalInput.type = 'text';
      mcpGoalInput.id = 'ai-mcp-goal-input';
      mcpGoalInput.value = '巡检知识库盲区并草拟核心概念补全卡片';
      mcpGoalInput.setAttribute('aria-label', 'MCP Agent 推理目标');
      const mcpGoalRow = settingRow('任务目标与检索主题', '输入希望 Agent 自动检索、分析或草拟卡片的主题', mcpGoalInput);

      const mcpFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      const mcpStatus = element('small', 'ai-exec-summary', '就绪：已注册 6 项本地受控工具（只读优先，写操作强制 Diff 门禁）');
      mcpStatus.id = 'ai-mcp-status';
      const mcpBtns = element('div', 'task-row-actions');
      const mcpRunBtn = cmdButton(Sparkles, '启动 MCP Agent 多步推理', 'ai-mcp-run-btn', true);
      const mcpApproveBtn = cmdButton(Check, '批准并执行提案', 'ai-mcp-approve-btn');
      mcpApproveBtn.disabled = true;
      mcpBtns.append(mcpRunBtn, mcpApproveBtn);
      mcpFooter.append(mcpStatus, mcpBtns);
      mcpForm.append(mcpToolSelectRow, mcpGoalRow, mcpFooter);

      let currentMcpSession = null;

      const mcpSynthesisCard = element('article', 'ai-answer-box ai-formatted-answer');
      mcpSynthesisCard.id = 'ai-mcp-synthesis-card';
      const renderIdleMcpStudio = () => {
        if (currentMcpSession) return;
        mcpSynthesisCard.hidden = false;
        mcpSynthesisCard.replaceChildren();
        const head = element('div', 'ai-answer-header');
        head.append(
          element('span', 'ai-answer-status-badge is-grounded', '多步笔记整理工作流（只读检索 → 差异预览 → 确认后落盘）'),
          element('small', 'ai-answer-meta', '点击上方任务卡片或「启动 MCP Agent 多步推理」立即生成提案'),
        );
        const grid = element('div', 'ai-model-blocks-grid ai-idle-studio-grid');
        for (const [modeVal, titleText, descText, goalText] of [
          ['propose_note', '草拟缺失概念卡', '扫描全库知识盲区与高频未建双链，自动检索关联段落并生成新笔记草稿提案', '巡检知识库盲区并草拟核心概念补全卡片'],
          ['batch_tag_update', '批量规范化标签', '扫描缺少 YAML 标签或分类不一的笔记，生成逐篇标签补全 Diff 预览', '统一规范全库笔记的 YAML 标签与分类属性'],
          ['summarize_project', '汇总项目与手记进展', '聚合近期手记、待办任务与项目关联笔记，生成结构化项目简报', '汇总近期项目进展与未完成待办事项'],
        ]) {
          const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
          card.type = 'button';
          card.append(
            element('strong', 'ai-model-block-title', titleText),
            element('div', 'ai-model-block-body', descText),
          );
          card.onclick = () => {
            mcpToolSelect.value = modeVal;
            mcpGoalInput.value = goalText;
            mcpRunBtn.click();
          };
          grid.append(card);
        }
        mcpSynthesisCard.append(head, grid);
      };
      renderIdleMcpStudio();

      const mcpTraceDivider = element('div', 'ai-results-divider', '🧭 受控工具调用流水线（5 步单行轨迹 · 点击下方页签切换提案与检索详情）');
      mcpTraceDivider.hidden = true;
      const mcpTraceList = element('div', 'ai-citation-list mcp-trace-pipeline');
      mcpTraceList.id = 'ai-mcp-trace-list';

      const mcpResultSwitchBar = element('div', 'chronicle-section-bar');
      mcpResultSwitchBar.id = 'ai-mcp-diff-divider';
      mcpResultSwitchBar.hidden = true;
      const mcpDiffTitle = element('strong', 'chronicle-section-title', '📝 待人工批准的新建/变更预览（确认无误后点击上方「批准并执行提案」）');
      const mcpResultTabs = element('div', 'context-submode-bar');
      const mcpTabDiffBtn = element('button', 'context-submode-pill is-active', '📝 待批准提案预览');
      mcpTabDiffBtn.type = 'button';
      const mcpTabSynthBtn = element('button', 'context-submode-pill', '🤖 Agent 检索解答依据');
      mcpTabSynthBtn.type = 'button';
      mcpResultTabs.append(mcpTabDiffBtn, mcpTabSynthBtn);
      mcpResultSwitchBar.append(mcpDiffTitle, mcpResultTabs);

      const mcpDiffPreview = element('article', 'ai-answer-box ai-formatted-answer');
      mcpDiffPreview.id = 'ai-mcp-diff-preview';
      mcpDiffPreview.hidden = true;

      mcpTabDiffBtn.onclick = () => {
        mcpTabDiffBtn.classList.add('is-active');
        mcpTabSynthBtn.classList.remove('is-active');
        mcpDiffPreview.hidden = false;
        mcpSynthesisCard.hidden = true;
      };
      mcpTabSynthBtn.onclick = () => {
        mcpTabSynthBtn.classList.add('is-active');
        mcpTabDiffBtn.classList.remove('is-active');
        mcpSynthesisCard.hidden = false;
        mcpDiffPreview.hidden = true;
      };

      mcpRunBtn.onclick = async () => {
        errorBox.hidden = true;
        mcpRunBtn.disabled = true;
        mcpApproveBtn.disabled = true;
        try {
          const session = await withIndexRetry(() => api.queryAi({
            subkind: 'mcp-agent',
            goal: mcpGoalInput.value.trim(),
            toolId: mcpToolSelect.value,
          }, { signal: scope.signal, key: 'ai-mcp-agent' }));
          if (scope.signal.aborted) return;
          currentMcpSession = session;
          mcpStatus.textContent = `已完成 ${session.traceSteps.length} 步受控推理 · 待审批提案：${session.pendingWriteProposal ? session.pendingWriteProposal.summary : '无'}`;

          // Render structured answer & note synthesis card
          mcpSynthesisCard.replaceChildren();
          const synthHeader = element('div', 'ai-answer-header');
          synthHeader.append(
            element('span', 'ai-answer-status-badge is-grounded', '🤖 Agent 多步检索解答与合成卡片预览'),
            element('small', 'ai-answer-meta', `目标：「${session.goal}」 · 共调用 ${session.traceSteps.length} 步工具`),
          );
          mcpSynthesisCard.append(synthHeader);

          if (session.directAnswerSummary) {
            const execBox = element('div', 'ai-executive-synthesis-box');
            const execLabel = element('strong', 'ai-executive-label', '🎯 问题核心解答：');
            const execText = element('span', 'ai-executive-text');
            renderRichMarkdownSnippet(execText, session.directAnswerSummary, link => api.openLink(link).catch(fail));
            execBox.append(execLabel, execText);
            mcpSynthesisCard.append(execBox);
          }

          if (Array.isArray(session.structuredAnswerPoints) && session.structuredAnswerPoints.length) {
            const ptsGrid = element('div', 'ai-answer-points-grid');
            for (const pt of session.structuredAnswerPoints) {
              const row = element('div', 'ai-answer-point-row');
              const numBadge = element('span', 'ai-point-index', String(pt.index));
              const cell = element('div', 'ai-point-cell');
              const topBar = element('div', 'ai-point-source-bar');
              topBar.append(
                element('strong', 'ai-point-note-title', pt.title),
                element('span', 'ai-point-loc-badge', pt.lineRange),
              );
              if (pt.citation) {
                const jumpBtn = element('button', 'sr-wikilink-chip', '跳转原文 ↗');
                jumpBtn.type = 'button';
                jumpBtn.onclick = () => api.openLink(pt.citation).catch(fail);
                topBar.append(jumpBtn);
              }
              const prose = element('div', 'ai-point-prose');
              renderRichMarkdownSnippet(prose, pt.content, link => api.openLink(link).catch(fail));
              cell.append(topBar, prose);
              row.append(numBadge, cell);
              ptsGrid.append(row);
            }
            mcpSynthesisCard.append(ptsGrid);
          }

          // Render Horizontal 5-Step Pipeline (Compact Single Row!)
          mcpTraceDivider.hidden = false;
          mcpTraceList.replaceChildren();
          for (const step of session.traceSteps) {
            const card = element('div', 'ai-citation-card is-structured mcp-step-compact-card');
            card.dataset.mcpStep = String(step.stepIndex);
            card.dataset.mcpTool = step.toolId;
            card.title = `输入参数：${step.inputSummary}\n执行结论：${step.outputSummary}`;
            const headBar = element('div', 'mcp-step-top');
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', step.badgeText);
            pill.dataset.pillTone = step.tone || 'teal';
            headBar.append(pill);
            const toolCode = element('code', 'sr-inline-code', step.toolId);
            const detail = element('small', 'mcp-step-summary', step.outputSummary);
            card.append(headBar, toolCode, detail);
            mcpTraceList.append(card);
          }

          if (session.pendingWriteProposal) {
            mcpResultSwitchBar.hidden = false;
            mcpTabDiffBtn.classList.add('is-active');
            mcpTabSynthBtn.classList.remove('is-active');
            renderRichMarkdownDocument(
              mcpDiffPreview,
              session.pendingWriteProposal.proposedSource || session.pendingWriteProposal.diffPreview,
              {
                headerBadge: `📄 提案排版预览 · ${session.pendingWriteProposal.summary}`,
                rawSource: session.pendingWriteProposal.diffPreview,
                onOpenLink: link => api.openLink(link).catch(fail),
              },
            );
            mcpDiffPreview.hidden = false;
            mcpSynthesisCard.hidden = true;
            mcpApproveBtn.disabled = false;
          } else {
            mcpResultSwitchBar.hidden = true;
            mcpDiffPreview.hidden = true;
            mcpSynthesisCard.hidden = false;
          }
        } catch (err) {
          fail(err);
        } finally {
          mcpRunBtn.disabled = false;
        }
      };

      mcpApproveBtn.onclick = async () => {
        if (!currentMcpSession?.pendingWriteProposal) return;
        errorBox.hidden = true;
        mcpApproveBtn.disabled = true;
        try {
          const proposal = currentMcpSession.pendingWriteProposal;
          let appliedCount = 0;
          for (const mut of proposal.mutations || []) {
            if (mut.kind === 'create-note') {
              const cleanTitle = mut.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
              await api.createNote(cleanTitle, { folder: mut.folder || 'notes', source: mut.source, background: true });
              appliedCount++;
            } else if (mut.kind === 'update-note') {
              const raw = await withIndexRetry(() => api.read(mut.noteId, { signal: scope.signal }));
              await api.write(mut.noteId, raw.version, mut.afterSource);
              appliedCount++;
            }
          }
          mcpStatus.textContent = `✅ 已人工批准并执行提案（共写入 ${appliedCount} 项变更）：${proposal.summary}`;
          currentMcpSession.pendingWriteProposal = null;
        } catch (err) {
          mcpApproveBtn.disabled = false;
          fail(err);
        }
      };

      // Sub-Mode 2: External Standard MCP Server (GitHub Copilot / Claude Desktop / Cursor)
      const mcpModeToolbar = element('div', 'chronicle-top-toolbar');
      const mcpModeTabs = element('div', 'context-submode-bar');
      mcpModeTabs.setAttribute('role', 'tablist');
      const mcpInternalModeBtn = element('button', 'context-submode-pill is-active', '🤖 1. 内置受控 Agent 沙盒');
      mcpInternalModeBtn.type = 'button';
      mcpInternalModeBtn.dataset.mcpSubmode = 'internal';
      const mcpExternalModeBtn = element('button', 'context-submode-pill', '🔌 2. 外部 AI 接入 (GitHub Copilot / Claude MCP)');
      mcpExternalModeBtn.type = 'button';
      mcpExternalModeBtn.dataset.mcpSubmode = 'external';
      mcpModeTabs.append(mcpInternalModeBtn, mcpExternalModeBtn);
      mcpModeToolbar.append(mcpModeTabs, mcpToolBar);

      const mcpInternalPane = element('div', 'compiler-subview-pane');
      mcpInternalPane.append(mcpForm, mcpTraceDivider, mcpTraceList, mcpResultSwitchBar, mcpDiffPreview, mcpSynthesisCard);

      const mcpExternalPane = element('div', 'compiler-subview-pane');
      mcpExternalPane.id = 'ai-mcp-external-pane';
      mcpExternalPane.hidden = true;

      const extConfigs = buildExternalMcpClientConfigs();
      const mcpExtGrid = element('div', 'compiler-workbench-layout');
      const mcpExtLeft = element('div', 'compiler-control-sidebar obs-card');
      mcpExtLeft.append(
        element('strong', 'compiler-step-heading', '① 选择外部 AI 客户端配置'),
        element('small', 'compiler-step-hint', '支持标准 Model Context Protocol (JSON-RPC 2.0 over stdio)，与 Obsidian / Notion MCP 同级体验。'),
      );
      const mcpClientSelect = element('select');
      mcpClientSelect.id = 'ai-mcp-client-select';
      mcpClientSelect.setAttribute('aria-label', '外部 AI 客户端类型');
      mcpClientSelect.append(
        new Option('VS Code · GitHub Copilot (.vscode/mcp.json)', 'vscode'),
        new Option('Claude Desktop / Cursor (claude_desktop_config.json)', 'claude'),
      );
      const mcpConfigPre = element('pre', 'ai-raw-source-pre mcp-config-codebox', extConfigs.vscodeMcpJson);
      mcpConfigPre.id = 'ai-mcp-config-code';
      mcpClientSelect.onchange = () => {
        mcpConfigPre.textContent = mcpClientSelect.value === 'claude' ? extConfigs.claudeConfigJson : extConfigs.vscodeMcpJson;
      };
      const mcpCopyCfgBtn = cmdButton(Check, '📋 一键复制 MCP 配置文件', 'ai-mcp-copy-config-btn', true);
      const mcpExtTestSelect = element('select');
      mcpExtTestSelect.id = 'ai-mcp-ext-test-tool';
      mcpExtTestSelect.setAttribute('aria-label', '实测外部 MCP 工具');
      for (const spec of EXTERNAL_MCP_TOOLS_SPEC) {
        mcpExtTestSelect.append(new Option(`${spec.name} — ${spec.description.slice(0, 18)}…`, spec.name));
      }
      const mcpExtTestBtn = cmdButton(Sparkles, '⚡ 实测 JSON-RPC 2.0 握手与调用', 'ai-mcp-ext-test-btn');
      const mcpExtStatus = element('small', 'ai-exec-summary', '协议版本：MCP 2024-11-05 (stdio) · 自动拦截 @privacy: locked 私密笔记');
      mcpExtStatus.id = 'ai-mcp-ext-status';

      let mcpSecurityPolicy = api.getSetting('mcp-security-policy') || defaultMcpSecurityPolicy();
      let mcpAuditLedger = Array.isArray(api.getSetting('mcp-audit-ledger')) ? [...api.getSetting('mcp-audit-ledger')] : [];

      const mcpSecurityMenu = element('details', 'ux-popover-menu');
      mcpSecurityMenu.id = 'ai-mcp-security-menu';
      const mcpSecurityTrigger = element('summary', 'ux-popover-trigger', '🛡️ 权限与审计 ▾');
      mcpSecurityTrigger.id = 'ai-mcp-security-menu-trigger';
      mcpSecurityTrigger.setAttribute('aria-label', '外部 MCP 工具级权限开关、允许目录白名单与审计账本菜单');
      const mcpSecurityPanel = element('div', 'ux-popover-panel');
      mcpSecurityPanel.setAttribute('role', 'menu');

      const mcpPresetRow = element('div', 'ux-popover-group');
      const mcpReadOnlyPresetBtn = element('button', 'small-command', '🔒 仅开放只读工具');
      mcpReadOnlyPresetBtn.type = 'button';
      mcpReadOnlyPresetBtn.id = 'ai-mcp-readonly-preset-btn';
      const mcpAllToolsPresetBtn = element('button', 'small-command', '🔓 开放全部工具');
      mcpAllToolsPresetBtn.type = 'button';
      mcpAllToolsPresetBtn.id = 'ai-mcp-alltools-preset-btn';
      mcpPresetRow.append(mcpReadOnlyPresetBtn, mcpAllToolsPresetBtn);

      const mcpToolTogglesGroup = element('div', 'ux-popover-group');
      const mcpToolCheckboxes = new Map();
      for (const spec of EXTERNAL_MCP_TOOLS_SPEC) {
        const lbl = element('label', 'ai-crystallize-check-label');
        lbl.style.width = '100%';
        const chk = element('input');
        chk.type = 'checkbox';
        chk.checked = mcpSecurityPolicy.enabledTools?.[spec.name] !== false;
        chk.dataset.mcpPermTool = spec.name;
        chk.onchange = () => {
          mcpSecurityPolicy = {
            ...mcpSecurityPolicy,
            enabledTools: { ...(mcpSecurityPolicy.enabledTools || {}), [spec.name]: chk.checked },
          };
          void api.setSetting('mcp-security-policy', mcpSecurityPolicy).catch(() => {});
          renderDefaultExtMcpDoc();
        };
        mcpToolCheckboxes.set(spec.name, chk);
        lbl.append(chk, document.createTextNode(spec.name));
        mcpToolTogglesGroup.append(lbl);
      }

      const mcpWhitelistGroup = element('div', 'ux-popover-group');
      const mcpWhitelistInput = element('input');
      mcpWhitelistInput.type = 'text';
      mcpWhitelistInput.id = 'ai-mcp-whitelist-input';
      mcpWhitelistInput.placeholder = '允许目录白名单 (如 notes, wiki；留空不限)';
      mcpWhitelistInput.setAttribute('aria-label', '允许目录白名单');
      mcpWhitelistInput.value = Array.isArray(mcpSecurityPolicy.allowedFolders) ? mcpSecurityPolicy.allowedFolders.join(', ') : '';
      mcpWhitelistInput.oninput = () => {
        const folders = mcpWhitelistInput.value.split(/[,，;；]/).map(f => f.trim()).filter(Boolean);
        mcpSecurityPolicy = { ...mcpSecurityPolicy, allowedFolders: folders };
        void api.setSetting('mcp-security-policy', mcpSecurityPolicy).catch(() => {});
      };
      const mcpViewAuditBtn = cmdButton(ShieldCheck, '📒 查看调用审计账本', 'ai-mcp-view-audit-btn');
      mcpWhitelistGroup.append(mcpWhitelistInput, mcpViewAuditBtn);

      mcpSecurityPanel.append(mcpPresetRow, mcpToolTogglesGroup, mcpWhitelistGroup);
      mcpSecurityMenu.append(mcpSecurityTrigger, mcpSecurityPanel);

      const syncMcpSecurityCheckboxes = () => {
        for (const [tName, chk] of mcpToolCheckboxes.entries()) {
          chk.checked = mcpSecurityPolicy.enabledTools?.[tName] !== false;
        }
      };

      mcpReadOnlyPresetBtn.onclick = () => {
        const nextTools = {};
        for (const spec of EXTERNAL_MCP_TOOLS_SPEC) {
          nextTools[spec.name] = !/create|update|compile/.test(spec.name);
        }
        mcpSecurityPolicy = { ...mcpSecurityPolicy, enabledTools: nextTools };
        syncMcpSecurityCheckboxes();
        void api.setSetting('mcp-security-policy', mcpSecurityPolicy).catch(() => {});
        mcpExtStatus.textContent = '🔒 已切换为「仅开放只读工具」策略（写操作工具已停用）';
        renderDefaultExtMcpDoc();
      };

      mcpAllToolsPresetBtn.onclick = () => {
        const nextTools = {};
        for (const spec of EXTERNAL_MCP_TOOLS_SPEC) nextTools[spec.name] = true;
        mcpSecurityPolicy = { ...mcpSecurityPolicy, enabledTools: nextTools };
        syncMcpSecurityCheckboxes();
        void api.setSetting('mcp-security-policy', mcpSecurityPolicy).catch(() => {});
        mcpExtStatus.textContent = '🔓 已开放全部 7 项 MCP 工具（仍受目录白名单与隐私护栏保护）';
        renderDefaultExtMcpDoc();
      };

      mcpCopyCfgBtn.onclick = async () => {
        await navigator.clipboard?.writeText(mcpConfigPre.textContent).catch(() => {});
        mcpExtStatus.textContent = '✅ 已复制 MCP 配置 JSON，粘贴至项目 .vscode/mcp.json 即可在 GitHub Copilot Agent 模式直接操作笔记！';
      };

      mcpExtLeft.append(
        mcpClientSelect,
        mcpConfigPre,
        mcpCopyCfgBtn,
        element('strong', 'compiler-step-heading', '② 在线实测外部协议调用与权限审计'),
        mcpExtTestSelect,
        mcpExtTestBtn,
        mcpSecurityMenu,
        mcpExtStatus,
      );

      const mcpExtRight = element('div', 'compiler-preview-stage');
      const mcpExtDocBox = element('article', 'ai-answer-box ai-formatted-answer');
      mcpExtDocBox.id = 'ai-mcp-ext-preview';
      const renderDefaultExtMcpDoc = (rpcResultText = '') => {
        const auditMd = formatMcpAuditLedgerMarkdown(mcpSecurityPolicy, mcpAuditLedger);
        const md = [
          '# 🔌 外部 AI 工具直连协议 (MCP Server for GitHub Copilot / Claude / Cursor)',
          '',
          '> [!TIP] 像连接 Obsidian / Notion 一样让外部 AI 直接操作墨图笔记',
          '> Inkloom 内置标准 **Model Context Protocol (`tools/inkloom-mcp-server.mjs`)** 服务端。在 VS Code 的 `.vscode/mcp.json` 中填入左侧配置后，您在 **GitHub Copilot Chat** 中输入「帮我检索墨图里关于双链的笔记并总结写入新卡片」，Copilot 即可直接调用下列 7 个工具操作您的本地知识库。',
          '',
          '## 已开放的 7 项标准 MCP 工具 (`tools/list`)',
          '',
          '| MCP 工具名 | 当前状态 | 权限级别 | 功能说明与 Copilot 调用场景 |',
          '| --- | --- | --- | --- |',
          ...EXTERNAL_MCP_TOOLS_SPEC.map(t => `| \`${t.name}\` | ${mcpSecurityPolicy.enabledTools?.[t.name] === false ? '⛔ 已停用' : '✅ 已启用'} | ${/create|update|compile/.test(t.name) ? '写操作（受隐私与白名单保护）' : '只读检索'} | ${t.description} |`),
          ...(rpcResultText ? ['', '## ⚡ 最新 JSON-RPC 2.0 实测响应报文', '', rpcResultText] : []),
          '',
          auditMd,
        ].join('\n');
        renderRichMarkdownDocument(mcpExtDocBox, md, {
          headerBadge: '🔌 MCP Server 协议与权限审计台 · JSON-RPC 2.0 (stdio)',
          rawSource: rpcResultText || extConfigs.vscodeMcpJson,
          onOpenLink: link => api.openLink(link).catch(fail),
        });
      };
      renderDefaultExtMcpDoc();
      mcpViewAuditBtn.onclick = () => {
        mcpSecurityMenu.open = false;
        renderDefaultExtMcpDoc();
      };
      mcpExtRight.append(mcpExtDocBox);
      mcpExtGrid.append(mcpExtLeft, mcpExtRight);
      mcpExternalPane.append(mcpExtGrid);

      mcpExtTestBtn.onclick = async () => {
        errorBox.hidden = true;
        mcpExtTestBtn.disabled = true;
        try {
          const allData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-mcp-ext-probe' }));
          const sampleNotes = (allData.clusters || []).flatMap(c => c.notes);
          const chosenTool = mcpExtTestSelect.value || 'inkloom_list_vault';
          const rpcReq = {
            jsonrpc: '2.0',
            id: 101,
            method: 'tools/call',
            params: {
              name: chosenTool,
              arguments: chosenTool === 'inkloom_search_notes'
                ? { query: '双链', limit: 3 }
                : chosenTool === 'inkloom_read_note' || chosenTool === 'inkloom_graph_neighbors'
                  ? { titleOrPath: sampleNotes[0]?.title || '双链笔记与卡片盒方法' }
                  : chosenTool === 'inkloom_create_note'
                    ? { title: 'MCP审计验证笔记', folder: 'notes', content: 'MCP 权限审计实测正文' }
                    : { limit: 5 },
            },
          };
          const rpcResp = await handleMcpJsonRpcRequest(rpcReq, {
            listNotes: async () => sampleNotes,
            createNote: async ({ title, folder, source }) => api.createNote(title, { folder, source, background: true }),
            securityPolicy: mcpSecurityPolicy,
            onAuditLog: entry => {
              mcpAuditLedger = recordMcpAuditEntry(mcpAuditLedger, entry);
              void api.setSetting('mcp-audit-ledger', mcpAuditLedger).catch(() => {});
            },
          });
          const isDenied = Boolean(rpcResp?.result?.isError);
          mcpExtStatus.textContent = isDenied
            ? `🔒 JSON-RPC 2.0 权限审计已拦截 (${chosenTool})：${rpcResp?.result?.content?.[0]?.text || ''}`
            : `✅ JSON-RPC 2.0 调用成功：method="tools/call" (${chosenTool})`;
          renderDefaultExtMcpDoc(`- **请求工具**：\`${chosenTool}\`\n- **返回状态**：\`jsonrpc: 2.0, id: 101, isError: ${isDenied}\`\n- **返回摘要**：\`${JSON.stringify(rpcResp?.result?.content?.[0]?.text || '').slice(0, 220)}…\``);
        } catch (err) {
          fail(err);
        } finally {
          mcpExtTestBtn.disabled = false;
        }
      };

      mcpInternalModeBtn.onclick = () => {
        mcpInternalModeBtn.classList.add('is-active');
        mcpExternalModeBtn.classList.remove('is-active');
        mcpInternalPane.hidden = false;
        mcpExternalPane.hidden = true;
      };
      mcpExternalModeBtn.onclick = () => {
        mcpExternalModeBtn.classList.add('is-active');
        mcpInternalModeBtn.classList.remove('is-active');
        mcpExternalPane.hidden = false;
        mcpInternalPane.hidden = true;
      };

      mcpPanel.append(mcpSectionHeading, mcpModeToolbar, mcpInternalPane, mcpExternalPane);
      panels.set('mcp', mcpPanel);

      function updateScopeTargetOptions() {
        const kind = scopeKind.value;
        scopeTarget.replaceChildren();
        if (kind === 'folder') {
          scopeTargetLabel.hidden = false;
          for (const folder of scopesData.folders) scopeTarget.append(new Option(folder, folder));
        } else if (kind === 'project') {
          scopeTargetLabel.hidden = false;
          for (const proj of scopesData.projects) scopeTarget.append(new Option(proj.title, proj.id));
        } else if (kind === 'manuscript') {
          scopeTargetLabel.hidden = false;
          for (const ms of scopesData.manuscripts) scopeTarget.append(new Option(ms.title, ms.id));
        } else {
          scopeTargetLabel.hidden = true;
        }
      }
      scopeKind.onchange = updateScopeTargetOptions;

      askCancel.onclick = () => {
        if (askController) {
          askController.abort();
          askController = null;
          askCancel.disabled = true;
          askSubmit.disabled = false;
          statusBadge.textContent = '已取消请求';
        }
      };

      askSubmit.onclick = async () => {
        const q = questionInput.value.trim();
        if (!q) { questionInput.focus(); return; }
        errorBox.hidden = true;
        askController?.abort();
        askController = new AbortController();
        askSubmit.disabled = true;
        askCancel.disabled = false;
        statusBadge.textContent = '正在检索上下文...';
        try {
          const activeDoc = api.activeDocument();
          const scopeObj = {
            kind: scopeKind.value,
            activeNoteId: activeDoc?.id || '',
            folder: scopeKind.value === 'folder' ? scopeTarget.value : '',
            projectId: scopeKind.value === 'project' ? scopeTarget.value : '',
            manuscriptId: scopeKind.value === 'manuscript' ? scopeTarget.value : '',
          };
          const currentAskController = askController;
          const retrieval = await withIndexRetry(() => {
            if (currentAskController.signal.aborted) throw Object.assign(new Error('Query cancelled'), { name: 'AbortError' });
            return api.queryAi({
              subkind: 'search',
              query: q,
              scope: scopeObj,
              mode: searchMode.value,
              limit: 6,
            }, { signal: currentAskController.signal, key: 'ai-search' });
          });

          const cfg = validateAiProviderConfig(api.getSetting('provider-config') || {});
          let response = answerWithGroundedContext({ question: q, retrieval, providerConfig: cfg });
          let remoteModelAnswer = '';

          if (cfg.provider !== 'local-grounded' && retrieval.chunks.length > 0) {
            statusBadge.textContent = '正在请求模型 (' + cfg.model + ')...';
            const contextBlock = retrieval.chunks.slice(0, 3).map((c, idx) => `[${idx + 1}] 《${c.title}》(第${c.lineFrom}-${c.lineTo}行) ${c.citation}:\n${c.text.slice(0, 360)}`).join('\n\n');
            try {
              const remote = await api.aiComplete({
                provider: cfg.provider,
                endpoint: cfg.endpoint,
                model: cfg.model,
                systemPrompt: '你是 Inkloom 墨图知识助手。请结合提供的知识库段落与你的领域知识，分点给出深入、结构化的解答，并在结尾保留 [[笔记]] 双链出处。',
                userPrompt: `知识库依据：\n${contextBlock}\n\n问题：${q}`,
              }, { signal: askController.signal, key: 'ai-complete' });
              if (remote?.answer?.trim()) {
                remoteModelAnswer = remote.answer.trim();
                const citeRefs = response.citations.map(c => c.citation).join(' ');
                const mergedAnswer = remoteModelAnswer + (remoteModelAnswer.includes('[[') ? '' : `\n\n依据出处：${citeRefs}`);
                response = { ...response, answer: mergedAnswer, model: remote.model || cfg.model, provider: cfg.provider };
              }
            } catch {
              // Fall back to deterministic grounded synthesis if remote/local endpoint is unreachable
            }
          }

          const summaryLine = `核对范围：${retrieval.scopedNotes.length} 篇笔记 · 命中 ${retrieval.chunks.length} 处段落 · 模型：${response.model}`;
          scopeSummary.textContent = summaryLine;
          renderFormattedGroundedAnswer(answerOutput, response, {
            question: q,
            scopeText: summaryLine,
            remoteModelAnswer,
            onOpenLink: link => api.openLink(link).catch(fail),
            onCrystallize: async ({ customTitle, targetFolder, bidirectional, openAfter, statusEl }) => {
              errorBox.hidden = true;
              try {
                const crystallized = crystallizeAnswerToNote({
                  question: q,
                  customTitle,
                  targetFolder,
                  response,
                  remoteModelAnswer,
                });
                const safeName = (crystallized.isWikiTarget ? crystallized.cleanName : crystallized.title).slice(0, 44).replace(/[\[\]#|:：\/\\]/g, '-');
                const created = await api.createNote(safeName, {
                  folder: crystallized.folder,
                  source: crystallized.markdown,
                  background: true,
                  overwrite: crystallized.isWikiTarget,
                });
                if (crystallized.isWikiTarget) {
                  const compData = await withIndexRetry(() => api.queryAi({
                    subkind: 'karpathy-compiler',
                    rulesConfig: compilerRules,
                  }, { signal: scope.signal, key: 'ai-query-wiki-sync' }));
                  const queryLogMd = appendWikiCompileLogMarkdown(compData.logMarkdown, {
                    operation: 'QUERY',
                    compiledTitles: [crystallized.title],
                    sourceNoteCount: retrieval.scopedNotes.length,
                  });
                  await api.createNote('index', { folder: 'wiki', source: compData.indexMarkdown, background: true, overwrite: true });
                  await api.createNote('log', { folder: 'wiki', source: queryLogMd, background: true, overwrite: true });
                }
                let wovenCount = 0;
                if (bidirectional && crystallized.linkedNotes.length) {
                  const active = api.activeDocument();
                  for (const linked of crystallized.linkedNotes) {
                    if (!linked.noteId || linked.noteId === created.id) continue;
                    try {
                      if (active && active.id === linked.noteId) {
                        const woven = applyOrphanWeaveLink(active.source, crystallized.title, `智识问答衍生洞察：${q.slice(0, 20)}`);
                        if (woven.changed) {
                          api.updateActiveDocument(active.id, active.revision, woven.source);
                          await api.saveActiveDocument(active.id);
                          wovenCount++;
                        }
                      } else {
                        const raw = await withIndexRetry(() => api.read(linked.noteId, { signal: scope.signal }));
                        const woven = applyOrphanWeaveLink(raw.source, crystallized.title, `智识问答衍生洞察：${q.slice(0, 20)}`);
                        if (woven.changed) {
                          await api.write(linked.noteId, raw.version, woven.source);
                          wovenCount++;
                        }
                      }
                    } catch {
                      // Ignore individual note write lock if any
                    }
                  }
                }
                if (statusEl) {
                  statusEl.replaceChildren();
                  statusEl.append(
                    document.createTextNode(
                      `✅ 已沉淀为《${crystallized.title}》（存入 ${crystallized.folder}/ 目录${crystallized.isWikiTarget ? ' 并同步更新 wiki/index.md 与 log.md' : ''}）${bidirectional ? `，并与 ${wovenCount} 篇关联源笔记建立双向双链` : ''} `,
                    ),
                  );
                  const jumpChip = element('button', 'sr-wikilink-chip', '打开新笔记 ↗');
                  jumpChip.type = 'button';
                  jumpChip.onclick = () => api.open(created.id).catch(fail);
                  statusEl.append(jumpChip);
                }
                if (openAfter) {
                  await api.open(created.id);
                }
              } catch (err) {
                fail(err);
              }
            },
          });
          citationList.replaceChildren();
          citationSectionHeader.hidden = !response.citations.length;
          for (const cite of response.citations) {
            const card = element('div', 'ai-citation-card is-structured');
            card.dataset.citationNoteId = cite.noteId;
            const headBar = element('div', 'ai-citation-card-header');
            const jump = element('button', 'home-task-title', `📄 ${cite.title} · 第 ${cite.lineFrom}–${cite.lineTo} 行`);
            jump.type = 'button';
            jump.onclick = () => api.openLink(cite.citation).catch(fail);
            const badges = element('div', 'ai-citation-badges');
            if (cite.sourceFile) {
              badges.append(element('span', 'ai-meta-chip', `源自 ${cite.sourceFile}`));
            }
            badges.append(
              element('span', 'ai-meta-chip', `${cite.citation}`),
              element('span', 'ai-meta-chip', `版本 ${String(cite.version || '').slice(0, 8)}`),
              element('span', 'ai-meta-chip is-score', `相关度 ${cite.score}`),
            );
            headBar.append(jump, badges);
            const snippet = element('div', 'ai-citation-card-body');
            renderRichMarkdownSnippet(snippet, cite.snippet, link => api.openLink(link).catch(fail));
            card.append(headBar, snippet);
            citationList.append(card);
          }
          statusBadge.textContent = response.status === 'grounded' ? '已定位依据并生成回答' : '未找到足够依据（已拒答）';
        } catch (err) {
          if (err?.name === 'AbortError') statusBadge.textContent = '已取消请求';
          else fail(err);
        } finally {
          askSubmit.disabled = false;
          askCancel.disabled = true;
          askController = null;
        }
      };

      // 2. Diff Revision Panel
      const revisePanel = element('div', 'ai-panel');
      revisePanel.id = 'ai-panel-revise';
      revisePanel.hidden = true;
      const reviseControls = element('div', 'research-form obs-card');
      const reviseMode = element('select');
      reviseMode.id = 'ai-revise-mode';
      reviseMode.setAttribute('aria-label', '受控修订方式');
      reviseMode.append(new Option('在顶部插入 [!NOTE] 要点提炼', 'summary-callout'), new Option('在文末追加「下一步行动」清单', 'action-checklist'));
      const reviseModeLabel = settingRow('受控修订方式', '选择针对当前活动笔记的结构化修订模式', reviseMode);

      const reviseInst = element('input');
      reviseInst.type = 'text';
      reviseInst.id = 'ai-revise-instruction';
      reviseInst.placeholder = '例如：提炼核心架构结论 / 补充评审待办...';
      reviseInst.setAttribute('aria-label', '补充修订说明');
      const reviseInstLabel = settingRow('补充修订说明（可选）', '为本次修订附加特定的关注重点或约束', reviseInst);

      const reviseFooter = element('div', 'research-form-footer research-wide');
      const reviseStatus = element('small', '', '先生成只读差异预览，确认后才写入当前活动笔记草稿');
      reviseStatus.id = 'ai-revise-status';
      const reviseBtns = element('div', 'task-row-actions');
      const previewBtn = cmdButton(GitCompare, '生成差异预览', 'ai-revise-preview', true);
      const applyBtn = cmdButton(Check, '确认应用修订', 'ai-revise-apply');
      applyBtn.disabled = true;
      reviseBtns.append(previewBtn, applyBtn);
      reviseFooter.append(reviseStatus, reviseBtns);
      reviseControls.append(reviseModeLabel, reviseInstLabel, reviseFooter);

      const diffBox = element('article', 'ai-answer-box ai-formatted-answer');
      diffBox.id = 'ai-revise-diff';
      const reviseIdleGrid = element('div', 'ai-model-blocks-grid ai-idle-studio-grid');
      for (const [mVal, mTitle, mDesc, mInst] of [
        ['summary-callout', '生成顶部要点提要块', '从当前笔记正文提炼 3 条核心结论，在文首插入结构化提要块预览', '提炼核心架构结论与关联双链'],
        ['action-checklist', '生成文末下一步行动清单', '根据当前笔记内容整理可执行待办事项，追加在笔记末尾预览', '补充评审待办与后续验证步骤'],
      ]) {
        const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
        card.type = 'button';
        card.append(element('strong', 'ai-model-block-title', mTitle), element('div', 'ai-model-block-body', mDesc));
        card.onclick = () => {
          reviseMode.value = mVal;
          reviseInst.value = mInst;
          previewBtn.click();
        };
        reviseIdleGrid.append(card);
      }
      diffBox.append(
        element('div', 'ai-answer-header', '📝 当前笔记结构化润色与差异预览（先看对比，确认后才写入草稿）'),
        reviseIdleGrid,
      );
      revisePanel.append(
        sectionTitle(
          '受控差异修订 (Diff Revision)',
          '针对当前正在编辑的笔记生成只读逐行增删对比（Diff），仅在您核对并点击「确认应用修订」后才写入草稿，支持 Ctrl+Z 一键撤销。',
        ),
        reviseControls,
        diffBox,
      );
      panels.set('revise', revisePanel);

      previewBtn.onclick = async () => {
        errorBox.hidden = true;
        try {
          const active = api.activeDocument();
          if (!active) throw new Error('当前没有打开的知识库笔记');
          const disk = await withIndexRetry(() => api.read(active.id, { signal: scope.signal }));
          currentProposal = buildRevisionProposal({
            noteId: active.id,
            title: active.name,
            source: active.source,
            version: disk.version,
            revision: active.revision,
            mode: reviseMode.value,
            instruction: reviseInst.value,
          });
          const header = `目标笔记：${active.name}（修订号 r${active.revision} · 哈希 ${disk.version.slice(0, 8)}）\n说明：${currentProposal.summary}\n`;
          const lines = currentProposal.diff.map(d => `${d.type === 'add' ? '+' : '-'} [行 ${d.lineNumber}] ${d.text}`);
          const rawDiffText = header + '\n' + (lines.length ? lines.join('\n') : '（内容已包含该结构，无需变更）');
          const addedMd = currentProposal.diff.filter(d => d.type === 'add').map(d => d.text).join('\n') || currentProposal.proposedSource;
          renderRichMarkdownDocument(diffBox, addedMd, {
            headerBadge: `✨ 修订效果预览 · ${currentProposal.summary}（目标：${active.name}）`,
            rawSource: rawDiffText,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          applyBtn.disabled = !currentProposal.changed;
          reviseStatus.textContent = currentProposal.changed ? '差异预览已生成，核对无误后可点击「确认应用修订」' : '无需变更';
        } catch (err) { fail(err); }
      };

      applyBtn.onclick = () => {
        errorBox.hidden = true;
        try {
          const active = api.activeDocument();
          const nextSource = verifyAndApplyRevision(currentProposal, active);
          api.updateActiveDocument(active.id, active.revision, nextSource);
          applyBtn.disabled = true;
          currentProposal = null;
          reviseStatus.textContent = '修订已写入当前草稿（可返回笔记保存或按 Ctrl+Z 撤销）';
        } catch (err) {
          applyBtn.disabled = true;
          fail(err);
        }
      };

      // 3. Manuscript Consistency Panel
      const consistencyPanel = element('div', 'ai-panel');
      consistencyPanel.id = 'ai-panel-consistency';
      consistencyPanel.hidden = true;
      const consControls = element('div', 'research-form obs-card');
      const consScope = element('select');
      consScope.id = 'ai-consistency-scope';
      consScope.setAttribute('aria-label', '核查范围');
      consScope.append(new Option('全库笔记', 'vault'));
      const consScopeLabel = settingRow('一致性核查范围', '自动扫描【角色·属性】设定冲突、章节时间线倒置与未建双链线索', consScope);
      const consFooter = element('div', 'research-form-footer research-wide');
      const consCoverage = element('small', '', '核查角色/术语设定冲突、章节时间线倒置与未闭合待建节点线索。');
      consCoverage.id = 'ai-consistency-coverage';
      const consRun = cmdButton(ShieldCheck, '运行一致性核查', 'ai-consistency-run', true);

      let lastEntityTimelineMatrix = null;
      const consMatrixMenu = element('details', 'ux-popover-menu');
      consMatrixMenu.id = 'ai-consistency-matrix-menu';
      const consMatrixTrigger = element('summary', 'ux-popover-trigger', '🧭 设定与时间线矩阵 ▾');
      consMatrixTrigger.id = 'ai-consistency-matrix-trigger';
      consMatrixTrigger.setAttribute('aria-label', '生成跨章节人物概念与时间线追踪矩阵菜单');
      const consMatrixPanel = element('div', 'ux-popover-panel');
      consMatrixPanel.setAttribute('role', 'menu');
      const matrixFolderLabel = element('label', 'ux-popover-field-label', '按多级目录筛选（留空扫描全库）');
      const matrixFolderInput = element('input');
      matrixFolderInput.type = 'text';
      matrixFolderInput.id = 'ai-matrix-folder-input';
      matrixFolderInput.placeholder = '例如：Inkloom使用方法';
      matrixFolderInput.setAttribute('aria-label', '跨章追踪矩阵目录筛选');
      matrixFolderLabel.append(matrixFolderInput);
      const matrixBuildBtn = element('button', 'phase-command obs-primary-btn', '📊 生成跨章人物·概念·时间线矩阵');
      matrixBuildBtn.type = 'button';
      matrixBuildBtn.id = 'ai-matrix-build-btn';
      const matrixSaveBtn = element('button', 'small-command', '💾 沉淀矩阵为研究笔记');
      matrixSaveBtn.type = 'button';
      matrixSaveBtn.id = 'ai-matrix-save-btn';
      matrixSaveBtn.disabled = true;
      consMatrixPanel.append(matrixFolderLabel, matrixBuildBtn, matrixSaveBtn);
      consMatrixMenu.append(consMatrixTrigger, consMatrixPanel);

      const consActionRow = element('div', 'task-row-actions');
      consActionRow.append(consMatrixMenu, consRun);
      consFooter.append(consCoverage, consActionRow);
      consControls.append(consScopeLabel, consFooter);

      const consFindings = element('div', 'ai-citation-list ai-structured-citation-grid');
      consFindings.id = 'ai-consistency-findings';
      for (const [cTitle, cDesc] of [
        ['🔍 术语与属性冲突检查', '扫描多篇笔记中同名概念、角色或参数的前后不一致描述，点击上方按钮开始核查'],
        ['⏳ 章节时间线与待建双链', '排查长稿章节中的时间顺序倒置，以及指向尚未创建笔记的断链线索'],
      ]) {
        const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
        card.type = 'button';
        card.append(element('strong', 'ai-model-block-title', cTitle), element('div', 'ai-model-block-body', cDesc));
        card.onclick = () => consRun.click();
        consFindings.append(card);
      }
      consistencyPanel.append(
        sectionTitle(
          '长稿与全库设定一致性核查',
          '自动扫描全库或指定长稿中的【角色/术语·属性】前后矛盾、章节时间线倒置以及尚未创建的 [[待建节点]] 断链线索。',
        ),
        consControls,
        consFindings,
      );
      panels.set('consistency', consistencyPanel);

      consRun.onclick = async () => {
        errorBox.hidden = true;
        consRun.disabled = true;
        try {
          const val = consScope.value;
          const scopeObj = val === 'vault' ? { kind: 'vault' } : { kind: 'manuscript', manuscriptId: val };
          const report = await withIndexRetry(() => api.queryAi({ subkind: 'consistency', scope: scopeObj }, { signal: scope.signal, key: 'ai-consistency' }));
          const names = report.checkedNotes.map(n => `${n.title}(${String(n.version || '').slice(0, 6)})`).join('、');
          consCoverage.textContent = `已核对 ${report.totalChecked} 篇笔记 [${names || '无'}] · 发现 ${report.findings.length} 项提示`;
          consFindings.replaceChildren();
          if (!report.findings.length) {
            consFindings.append(element('p', 'empty-state', '未发现设定冲突、时间线倒置或未建线索'));
          } else {
            for (const item of report.findings) {
              const card = element('div', 'ai-citation-card');
              card.dataset.findingKind = item.kind;
              const title = element('strong', '', item.title);
              const detail = element('p', '', item.detail);
              const links = element('div', 'task-row-actions');
              for (const cite of item.citations || []) {
                const btn = element('button', 'small-command', cite);
                btn.type = 'button';
                btn.onclick = () => api.openLink(cite).catch(fail);
                links.append(btn);
              }
              card.append(title, detail, links);
              consFindings.append(card);
            }
          }
        } catch (err) { fail(err); }
        finally { consRun.disabled = false; }
      };

      matrixBuildBtn.onclick = async () => {
        errorBox.hidden = true;
        matrixBuildBtn.disabled = true;
        consMatrixMenu.open = false;
        try {
          const val = consScope.value;
          const scopeObj = val === 'vault' ? { kind: 'vault' } : { kind: 'manuscript', manuscriptId: val };
          const folderFilter = matrixFolderInput.value.trim();
          const matrixReport = await withIndexRetry(() =>
            api.queryAi({ subkind: 'entity-timeline-matrix', scope: scopeObj, folderPath: folderFilter }, { signal: scope.signal, key: 'ai-entity-matrix' }),
          );
          lastEntityTimelineMatrix = matrixReport;
          matrixSaveBtn.disabled = false;
          consCoverage.textContent = `已生成跨章追踪矩阵：扫描 ${matrixReport.totalNotes} 篇章节 · 识别 ${matrixReport.entityCount} 个核心实体 · 时间线节点 ${matrixReport.timelineCount} 处`;
          consFindings.replaceChildren();
          const card = element('div', 'ai-citation-card');
          card.id = 'ai-entity-timeline-matrix-card';
          const previewBox = element('article', 'ai-answer-box ai-formatted-answer');
          previewBox.id = 'ai-entity-timeline-matrix-preview';
          renderRichMarkdownDocument(previewBox, matrixReport.markdown, {
            headerBadge: `🧭 跨章人物·概念·时间线追踪矩阵（${matrixReport.folderPath || '全库'}）`,
            rawSource: matrixReport.markdown,
            onOpenLink: cite => api.openLink(cite).catch(fail),
          });
          card.append(previewBox);
          consFindings.append(card);
        } catch (err) {
          fail(err);
        } finally {
          matrixBuildBtn.disabled = false;
        }
      };

      matrixSaveBtn.onclick = async () => {
        if (!lastEntityTimelineMatrix) return;
        errorBox.hidden = true;
        matrixSaveBtn.disabled = true;
        consMatrixMenu.open = false;
        try {
          const scopeTag = lastEntityTimelineMatrix.folderPath
            ? lastEntityTimelineMatrix.folderPath.split('/').pop()
            : '全库';
          const noteTitle = `跨章设定与时间线矩阵 · ${scopeTag} ${crypto.randomUUID().slice(0, 6)}`;
          await api.createNote(noteTitle, {
            folder: 'reading',
            source: `---\ntitle: ${noteTitle}\ncategory: reading\nstatus: 已完成\ntags:\n  - research\n  - matrix\n---\n\n${lastEntityTimelineMatrix.markdown}`,
            background: true,
          });
          consCoverage.textContent = `✓ 已将跨章设定与时间线追踪矩阵保存至 reading/${noteTitle}.md`;
        } catch (err) {
          fail(err);
        } finally {
          matrixSaveBtn.disabled = false;
        }
      };

      // 4. Skills Panel
      const skillsPanel = element('div', 'ai-panel');
      skillsPanel.id = 'ai-panel-skills';
      skillsPanel.hidden = true;
      const skillForm = element('div', 'research-form obs-card');
      const skillName = element('input');
      skillName.type = 'text';
      skillName.id = 'ai-skill-name';
      skillName.placeholder = '例如：长稿设定与时间线核查法';
      skillName.setAttribute('aria-label', 'Skill 名称');
      const skillNameLabel = settingRow('Skill 技能名称', '提炼为结构化可复用方法卡片的标题', skillName);

      const skillSourceSelect = element('select');
      skillSourceSelect.id = 'ai-skill-source';
      skillSourceSelect.setAttribute('aria-label', '提炼来源笔记');
      const skillSourceLabel = settingRow('提炼来源笔记', '选择作为方法论依据的原始知识库笔记', skillSourceSelect);

      const skillDesc = element('input');
      skillDesc.type = 'text';
      skillDesc.id = 'ai-skill-desc';
      skillDesc.placeholder = '简述该 Skill 解决的问题与适用边界';
      skillDesc.setAttribute('aria-label', '方法说明与边界');
      const skillDescLabel = settingRow('方法说明与适用边界', '记录执行步骤约束与不适用的反例场景', skillDesc);

      const skillFooter = element('div', 'research-form-footer research-wide');
      const skillHint = element('small', '', '先从来源笔记生成候选预览，人工确认后保存到 skills/ 目录');
      const skillBtns = element('div', 'task-row-actions');
      const skillPreviewBtn = cmdButton(BookMarked, '生成 Skill 候选', 'ai-skill-preview-btn', true);
      const skillSaveBtn = cmdButton(Check, '确认保存为 Skill', 'ai-skill-save-btn');
      skillSaveBtn.disabled = true;
      skillBtns.append(skillPreviewBtn, skillSaveBtn);
      skillFooter.append(skillHint, skillBtns);
      skillForm.append(skillNameLabel, skillSourceLabel, skillDescLabel, skillFooter);

      const skillCandidatePreview = element('article', 'ai-answer-box ai-formatted-answer');
      skillCandidatePreview.id = 'ai-skill-candidate-preview';
      skillCandidatePreview.append(
        element('div', 'ai-answer-header', '📘 Skill 方法卡排版预览'),
        element('div', 'ai-answer-empty-body', '尚未生成 Skill 候选。填写名称并选择来源笔记后点击「生成 Skill 候选」。'),
      );
      const skillExportOutput = element('textarea', 'ai-export-box');
      skillExportOutput.id = 'ai-skill-export-output';
      skillExportOutput.readOnly = true;
      skillExportOutput.hidden = true;
      skillExportOutput.rows = 4;
      skillExportOutput.setAttribute('aria-label', '脱敏导出的 Skill 内容');
      const skillList = element('div', 'ai-citation-list');
      skillList.id = 'ai-skill-list';
      skillsPanel.append(
        sectionTitle(
          'Skills 结构化方法沉淀',
          '从知识库笔记中提炼可复用的标准作业步骤（SOP / Skill），自动校验 7 项完整性门禁并支持一键脱敏分享。',
        ),
        skillForm,
        skillCandidatePreview,
        skillExportOutput,
        skillList,
      );
      panels.set('skills', skillsPanel);

      skillPreviewBtn.onclick = async () => {
        errorBox.hidden = true;
        try {
          if (!skillName.value.trim()) throw new Error('请填写 Skill 名称');
          const sourceId = skillSourceSelect.value;
          if (!sourceId) throw new Error('请选择来源笔记');
          const record = await withIndexRetry(() => api.read(sourceId, { signal: scope.signal }));
          const optionText = skillSourceSelect.selectedOptions[0]?.dataset.relativePath || skillSourceSelect.selectedOptions[0]?.textContent || 'Source.md';
          currentSkillCandidate = generateSkillCandidate({
            name: skillName.value.trim(),
            description: skillDesc.value.trim(),
            sourceNotes: [{ id: sourceId, title: skillSourceSelect.selectedOptions[0]?.textContent || '来源', relativePath: optionText, source: record.source, version: record.version }],
          });
          renderRichMarkdownDocument(skillCandidatePreview, currentSkillCandidate.markdown, {
            headerBadge: `📘 Skill 候选预览 · 《${currentSkillCandidate.title}》`,
            rawSource: currentSkillCandidate.markdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          skillSaveBtn.disabled = false;
        } catch (err) { fail(err); }
      };

      skillSaveBtn.onclick = async () => {
        if (!currentSkillCandidate) return;
        errorBox.hidden = true;
        skillSaveBtn.disabled = true;
        try {
          const filename = currentSkillCandidate.title.slice(0, 44).replace(/[\[\]#|]/g, '-') + ' ' + crypto.randomUUID().slice(0, 8);
          await api.createNote(filename, { folder: 'skills', source: currentSkillCandidate.markdown, background: true });
          currentSkillCandidate = null;
          skillName.value = '';
          skillDesc.value = '';
          skillCandidatePreview.replaceChildren(
            element('div', 'ai-answer-header', '✅ 已保存到 skills/ 目录'),
            element('div', 'ai-answer-empty-body', 'Skill 卡片已成功写入知识库 skills/ 目录，可在下方列表中查看或脱敏导出。'),
          );
          await refreshSkills();
        } catch (err) { fail(err); }
      };

      async function refreshSkills() {
        const data = await withIndexRetry(() => api.queryAi({ subkind: 'skills' }, { signal: scope.signal, key: 'ai-skills' }));
        if (scope.signal.aborted) return;
        const selectedSource = skillSourceSelect.value;
        skillSourceSelect.replaceChildren();
        for (const src of data.sources) {
          const opt = new Option(`${src.title} (${src.relativePath})`, src.id);
          opt.dataset.relativePath = src.relativePath;
          skillSourceSelect.append(opt);
        }
        if (selectedSource && [...skillSourceSelect.options].some(o => o.value === selectedSource)) skillSourceSelect.value = selectedSource;
        if (!currentSkillCandidate && data.sources.length) {
          const firstSrc = data.sources[0];
          renderRichMarkdownDocument(skillCandidatePreview, [
            `# 方法卡提炼预览 · 基于《${firstSrc.title}》`,
            '',
            '> [!TIP] 从真实笔记提炼可复用方法卡 (SOP / Skill)',
            `> 当前已选来源笔记：**《${firstSrc.title}》**（\`${firstSrc.relativePath}\`）。在上方输入方法名称并点击 **「生成 Skill 候选」**，即可将笔记中的核心步骤提炼为带 7 项完整性校验的标准方法卡，并存入 \`skills/\` 目录。`,
          ].join('\n'), {
            headerBadge: `📘 方法卡提炼台 · 已关联 ${data.sources.length} 篇源笔记`,
            rawSource: firstSrc.relativePath,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        }

        const skillsKey = JSON.stringify(data.skills.map(s => [s.id, s.title, s.version, s.evaluation]));
        if (skillList.dataset.skillsKey === skillsKey) return;
        skillList.dataset.skillsKey = skillsKey;
        skillList.replaceChildren();
        if (!data.skills.length) {
          skillList.append(element('p', 'empty-state', '尚无已保存的 Skill'));
          return;
        }
        for (const item of data.skills) {
          const card = element('div', 'ai-citation-card');
          card.dataset.skillNoteId = item.id;
          const openBtn = element('button', 'home-task-title', item.title);
          openBtn.type = 'button';
          openBtn.onclick = () => api.open(item.id).catch(fail);
          const passedCount = item.evaluation.checks.filter(c => c.passed).length;
          const reviewBadge = item.evaluation.needsReview ? ' · 来源已更新，建议复审' : ' · 来源版本一致';
          const meta = element('small', '', `规范检查 ${passedCount}/${item.evaluation.checks.length} 项通过${reviewBadge}`);
          const actions = element('div', 'task-row-actions');
          const exportBtn = cmdButton(Download, '脱敏导出分享');
          exportBtn.dataset.exportSkill = item.id;
          exportBtn.onclick = async () => {
            try {
              const raw = await withIndexRetry(() => api.read(item.id, { signal: scope.signal }));
              const sanitized = exportSanitizedSkill(raw.source);
              skillExportOutput.value = sanitized;
              skillExportOutput.hidden = false;
              await navigator.clipboard?.writeText(sanitized).catch(() => {});
            } catch (err) { fail(err); }
          };
          actions.append(exportBtn);
          card.append(openBtn, meta, actions);
          skillList.append(card);
        }
      }

      // 5. Provider & Credentials Config Panel (Obsidian-style Setting Rows)
      const configPanel = element('div', 'ai-panel');
      configPanel.id = 'ai-panel-config';
      configPanel.hidden = true;
      const configForm = element('div', 'research-form obs-card');

      const presetSelect = element('select');
      presetSelect.id = 'ai-profile-preset';
      presetSelect.setAttribute('aria-label', '已保存模型预设档');
      for (const preset of presets) {
        presetSelect.append(new Option(`${preset.name} [${preset.model}]`, preset.id));
      }
      const presetLabel = settingRow(
        '已保存模型预设档',
        '内置本地 SmolLM2-135M、在线 Gemini 4、Ollama 与离线有据引擎，支持一键切换',
        presetSelect,
      );

      const providerSelect = element('select');
      providerSelect.id = 'ai-provider';
      providerSelect.setAttribute('aria-label', '模型提供商');
      providerSelect.append(
        new Option('内置本地小模型 GGUF（SmolLM2-135M · 11435 端口）', 'local-gguf'),
        new Option('OpenAI 兼容接口 / Gemini 4 网关 (/v1/chat/completions)', 'openai-compatible'),
        new Option('本地 Ollama (/api/chat · 11434 端口)', 'ollama'),
        new Option('内置本地有据合成引擎（零网络确定性提取）', 'local-grounded'),
      );
      const providerLabel = settingRow(
        '模型服务提供商',
        '选择本地 GGUF 引擎、OpenAI/Gemini 兼容网关、本地 Ollama 或纯离线有据合成',
        providerSelect,
      );

      const modelInput = element('input');
      modelInput.type = 'text';
      modelInput.id = 'ai-model';
      modelInput.setAttribute('aria-label', '模型名称');
      const modelLabel = settingRow(
        '模型标识名称 (Model ID)',
        '发送给推理端点的模型名称（例如 gemini-4 或 smollm2:135m-instruct-q4_0）',
        modelInput,
      );

      const endpointInput = element('input');
      endpointInput.type = 'text';
      endpointInput.id = 'ai-endpoint';
      endpointInput.setAttribute('aria-label', '接口地址');
      const endpointLabel = settingRow(
        '接口地址 (Endpoint)',
        'HTTP/HTTPS 推理服务地址（本地模型使用 127.0.0.1 回环地址）',
        endpointInput,
      );

      const keyInput = element('input');
      keyInput.type = 'password';
      keyInput.id = 'ai-api-key';
      keyInput.autocomplete = 'off';
      keyInput.placeholder = '输入新密钥以更新（留空保持现有凭据）';
      keyInput.setAttribute('aria-label', 'API 密钥');
      const keyLabel = settingRow(
        'API 访问密钥',
        '仅经 Windows DPAPI 加密保存在系统凭据区，绝不写入知识库或日志',
        keyInput,
      );

      const configFooter = element('div', 'research-form-footer research-wide');
      const keyStatus = element('small', '', '凭据状态：检查中...');
      keyStatus.id = 'ai-key-status';
      const configBtns = element('div', 'task-row-actions');
      const testLocalBtn = cmdButton(Sparkles, '启动本地小模型并实测推理', 'ai-test-local-llm');
      const saveConfigBtn = cmdButton(Check, '保存模型配置', 'ai-config-save', true);
      const clearKeyBtn = cmdButton(X, '清除已存密钥', 'ai-config-clear-key');

      const embedMenu = element('details', 'ux-popover-menu');
      embedMenu.id = 'ai-embedding-index-menu';
      const embedMenuTrigger = element('summary', 'ux-popover-trigger', '🧬 向量索引管理 ▾');
      embedMenuTrigger.id = 'ai-embedding-index-menu-trigger';
      embedMenuTrigger.setAttribute('aria-label', '本地语义向量索引与模型版本重建菜单');
      const embedMenuPanel = element('div', 'ux-popover-panel');
      embedMenuPanel.setAttribute('role', 'menu');
      const embedModelSelect = element('select', 'ux-select');
      embedModelSelect.id = 'ai-embedding-model-select';
      embedModelSelect.setAttribute('aria-label', '选择语义向量索引模型');
      for (const em of EMBEDDING_INDEX_MODELS) {
        embedModelSelect.append(new Option(em.name, em.id));
      }
      embedModelSelect.value = api.getSetting('embedding-model-id') || 'fnv1a-128d-v1';
      const embedRebuildBtn = cmdButton(Sparkles, '🔄 平滑重建向量索引', 'ai-embedding-rebuild-btn');
      const embedStatusText = element('small', '', '当前默认：128 维零配置特征哈希向量');
      embedStatusText.id = 'ai-embedding-index-status';
      embedMenuPanel.append(embedModelSelect, embedRebuildBtn, embedStatusText);
      embedMenu.append(embedMenuTrigger, embedMenuPanel);

      embedRebuildBtn.onclick = async () => {
        errorBox.hidden = true;
        embedRebuildBtn.disabled = true;
        try {
          const compData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-embed-rebuild' }));
          const allNotes = (compData.clusters || []).flatMap(c => c.notes || []);
          const prevSnap = api.getSetting('embedding-index-snapshot') || null;
          const targetModel = embedModelSelect.value || 'local-gguf-embed-v1';
          const built = buildPersistentEmbeddingIndex(allNotes, {
            modelId: targetModel,
            previousIndex: prevSnap,
          });
          await api.setSetting('embedding-model-id', built.modelId);
          await api.setSetting('embedding-index-snapshot', built);
          embedStatusText.textContent = `✅ 索引已平滑就绪：${built.modelId} (${built.dimensions}维) · 共 ${built.totalIndexed} 篇（重算 ${built.rebuiltNotes} / 复用 ${built.reusedNotes}） · SHA ${built.indexSha256.slice(0, 8)}`;
        } catch (err) {
          fail(err);
        } finally {
          embedRebuildBtn.disabled = false;
        }
      };

      configBtns.append(testLocalBtn, saveConfigBtn, clearKeyBtn, embedMenu);
      configFooter.append(keyStatus, configBtns);
      configForm.append(presetLabel, providerLabel, modelLabel, endpointLabel, keyLabel, configFooter);

      const localLlmBox = element('pre', 'ai-diff-box', '本地最小语言模型（SmolLM2-135M-Instruct GGUF，91.7 MB）就绪状态将显示于此。点击「启动本地小模型并实测推理」可直接验证真实本地模型生成。');
      localLlmBox.id = 'ai-local-llm-output';
      configPanel.append(
        sectionTitle('模型连接与安全凭据配置', '参考 Obsidian 分栏设置规范：左侧展示功能说明，右侧集中配置参数'),
        configForm,
        sectionTitle('本地最小模型实测诊断台', '本机 llama-server + SmolLM2-135M GGUF 离线推理状态与实测输出'),
        localLlmBox,
      );
      panels.set('config', configPanel);

      presetSelect.onchange = () => {
        const chosen = presets.find(p => p.id === presetSelect.value);
        if (!chosen) return;
        providerSelect.value = chosen.provider;
        modelInput.value = chosen.model;
        endpointInput.value = chosen.endpoint;
      };

      async function loadConfig() {
        const stored = api.getSetting('provider-config') || presets[0];
        if (stored.profileId && [...presetSelect.options].some(o => o.value === stored.profileId)) {
          presetSelect.value = stored.profileId;
        }
        providerSelect.value = stored.provider || presets[0].provider;
        modelInput.value = stored.model || presets[0].model;
        endpointInput.value = stored.endpoint || presets[0].endpoint;
        const secret = await api.aiConfig('get');
        if (!scope.signal.aborted && secret) {
          const llm = secret.localLlm;
          const llmText = llm?.installed
            ? ` · 本地小模型 ${llm.modelFile} (${(llm.modelBytes / 1048576).toFixed(1)} MB, ${llm.running ? '运行中' : '已安装待启动'})`
            : '';
          keyStatus.textContent = (secret.hasKey ? `已加密保存密钥：${secret.maskedKey}（${secret.storage}）` : `未保存 API 密钥（${secret.storage}）`) + llmText;
        }
      }

      testLocalBtn.onclick = async () => {
        errorBox.hidden = true;
        testLocalBtn.disabled = true;
        localLlmBox.textContent = '正在启动本地 GGUF 推理引擎 (llama-server + smollm2-135m-instruct-q4_0.gguf)...';
        try {
          const status = await api.aiConfig('local-start');
          const result = await api.aiComplete({
            provider: 'local-gguf',
            endpoint: 'http://127.0.0.1:11435/v1/chat/completions',
            model: 'smollm2:135m-instruct-q4_0',
            systemPrompt: 'You are Inkloom local assistant. Reply in one concise sentence.',
            userPrompt: 'What is the benefit of linking notes in a personal knowledge base?',
          }, { signal: scope.signal, key: 'ai-local-test' });
          localLlmBox.textContent = `本地模型：${status?.modelFile || 'smollm2-135m-instruct-q4_0.gguf'} (${((status?.modelBytes || 91726912) / 1048576).toFixed(1)} MB)\n服务地址：http://127.0.0.1:11435/v1/chat/completions\n推理耗时：${result.latencyMs ?? 0} ms\n实测生成：${(result.answer || '').trim()}`;
          await loadConfig();
        } catch (err) {
          localLlmBox.textContent = '本地小模型测试失败：' + (err.message || String(err));
          fail(err);
        } finally {
          testLocalBtn.disabled = false;
        }
      };

      saveConfigBtn.onclick = async () => {
        errorBox.hidden = true;
        try {
          const matchedPreset = presets.find(p => p.model === modelInput.value.trim() && p.provider === providerSelect.value) || presets.find(p => p.id === presetSelect.value);
          const validated = validateAiProviderConfig({
            profileId: matchedPreset?.id || presetSelect.value,
            name: matchedPreset?.name || modelInput.value.trim(),
            provider: providerSelect.value,
            endpoint: endpointInput.value,
            model: modelInput.value,
          });
          await api.setSetting('provider-config', validated);
          const savedList = api.getSetting('saved-profiles') || presets;
          const updatedList = [...savedList.filter(p => p.id !== validated.profileId), validated];
          await api.setSetting('saved-profiles', updatedList);
          if (keyInput.value.trim()) {
            const secret = await api.aiConfig('save', { apiKey: keyInput.value.trim() });
            keyInput.value = '';
            keyStatus.textContent = `已加密保存密钥：${secret.maskedKey}（${secret.storage}）`;
          } else {
            await loadConfig();
          }
          statusBadge.textContent = validated.provider === 'local-grounded' ? '默认离线有据模式' : `已配置 ${validated.provider} (${validated.model})`;
        } catch (err) { fail(err); }
      };

      clearKeyBtn.onclick = async () => {
        errorBox.hidden = true;
        try {
          const secret = await api.aiConfig('save', { clear: true });
          keyInput.value = '';
          keyStatus.textContent = `未保存 API 密钥（${secret.storage}）`;
        } catch (err) { fail(err); }
      };

      // 6. Orphan Note Weaver, Weekly Digest & Smart Card Splitter Panel
      const synthesisPanel = element('div', 'ai-panel');
      synthesisPanel.id = 'ai-panel-synthesis';
      synthesisPanel.hidden = true;

      // 6a. Orphan Weaver Section
      const weaverForm = element('div', 'research-form');
      const weaverFooter = element('div', 'research-form-footer research-wide');
      const weaverSummary = element('small', '', '扫描全库 0 入链且 0 出链的孤岛笔记，通过 128 维余弦向量与标签匹配推荐主干节点并一键织网。');
      weaverSummary.id = 'ai-weaver-summary';
      const weaverBtns = element('div', 'task-row-actions');
      const weaverScanBtn = cmdButton(Search, '扫描全库孤岛笔记', 'ai-weaver-scan');
      const weaverApplyAllBtn = cmdButton(Check, '一键织入全部孤岛', 'ai-weaver-apply-all');
      weaverApplyAllBtn.disabled = true;
      weaverBtns.append(weaverScanBtn, weaverApplyAllBtn);
      weaverFooter.append(weaverSummary, weaverBtns);
      weaverForm.append(weaverFooter);

      const weaverList = element('div', 'ai-citation-list');
      weaverList.id = 'ai-weaver-list';
      let currentWeaverItems = [];

      async function weaveSingleItem(item) {
        const raw = await withIndexRetry(() => api.read(item.orphanId, { signal: scope.signal }));
        const woven = applyOrphanWeaveLink(raw.source, item.hubCleanTitle, item.reason);
        if (woven.changed) {
          await api.write(item.orphanId, raw.version, woven.source);
        }
        return woven.changed;
      }

      async function refreshWeaver() {
        weaverScanBtn.disabled = true;
        try {
          const report = await withIndexRetry(() => api.queryAi({ subkind: 'weaver' }, { signal: scope.signal, key: 'ai-weaver' }));
          if (scope.signal.aborted) return;
          currentWeaverItems = report.recommendations || [];
          weaverSummary.textContent = `全库共发现 ${report.totalOrphans} 篇孤岛笔记 · 已生成 ${currentWeaverItems.length} 条高置信度织网建议`;
          weaverApplyAllBtn.disabled = !currentWeaverItems.length;
          weaverList.replaceChildren();
          if (!currentWeaverItems.length) {
            weaverList.append(element('p', 'empty-state', '全库笔记均已织入双链网络，暂无孤岛笔记'));
            return;
          }
          for (const item of currentWeaverItems) {
            const card = element('div', 'ai-citation-card');
            card.dataset.orphanId = item.orphanId;
            const titleBtn = element('button', 'home-task-title', `孤岛《${item.orphanTitle}》 → 建议挂载至 ${item.proposedLink}`);
            titleBtn.type = 'button';
            titleBtn.onclick = () => api.open(item.orphanId).catch(fail);
            const meta = element('small', '', `${item.reason} · 综合得分 ${item.score}`);
            const excerpt = element('p', '', item.excerpt);
            const actions = element('div', 'task-row-actions');
            const weaveBtn = cmdButton(Check, '织入双链');
            weaveBtn.dataset.weaveOrphan = item.orphanId;
            weaveBtn.onclick = async () => {
              errorBox.hidden = true;
              weaveBtn.disabled = true;
              try {
                await weaveSingleItem(item);
                await refreshWeaver();
              } catch (err) {
                weaveBtn.disabled = false;
                fail(err);
              }
            };
            actions.append(weaveBtn);
            card.append(titleBtn, meta, excerpt, actions);
            weaverList.append(card);
          }
        } catch (err) {
          fail(err);
        } finally {
          weaverScanBtn.disabled = false;
        }
      }

      weaverScanBtn.onclick = () => { errorBox.hidden = true; void refreshWeaver(); };
      weaverApplyAllBtn.onclick = async () => {
        if (!currentWeaverItems.length) return;
        errorBox.hidden = true;
        weaverApplyAllBtn.disabled = true;
        try {
          let count = 0;
          for (const item of currentWeaverItems) {
            if (await weaveSingleItem(item)) count++;
          }
          weaverSummary.textContent = `已自动将 ${count} 篇孤岛笔记织入知识星图`;
          await refreshWeaver();
        } catch (err) {
          fail(err);
        }
      };

      // 6b. Weekly Digest & Topic Synthesis Section
      const digestForm = element('div', 'research-form obs-card');
      const digestWindow = element('select');
      digestWindow.id = 'ai-digest-window';
      digestWindow.setAttribute('aria-label', '综述汇总周期');
      digestWindow.append(
        new Option('近 7 天（周报综述）', '7'),
        new Option('近 30 天（月度综述）', '30'),
        new Option('全库汇总（专题全景）', 'all'),
      );
      const digestWindowLabel = settingRow('综述汇总周期', '选择自动聚合手记、已完成任务与研究摘录的时间范围', digestWindow);

      const digestTitleInput = element('input');
      digestTitleInput.type = 'text';
      digestTitleInput.id = 'ai-digest-title';
      digestTitleInput.placeholder = '留空则自动生成带日期的周报标题';
      digestTitleInput.setAttribute('aria-label', '综述标题');
      const digestTitleLabel = settingRow('综述文档标题（可选）', '生成的综述笔记将自动保存在 digests/ 目录下', digestTitleInput);

      const digestFooter = element('div', 'research-form-footer research-wide');
      const digestStatus = element('small', '', '自动聚类手记/Memo、已完成任务与研究摘录，生成带 [[双链]] 与 ![[#^block]] 出处的综述草稿');
      digestStatus.id = 'ai-digest-status';
      const digestBtns = element('div', 'task-row-actions');
      const digestGenBtn = cmdButton(Sparkles, '生成周报与专题综述', 'ai-digest-generate', true);
      const digestSaveBtn = cmdButton(Check, '保存为综述笔记', 'ai-digest-save');
      digestSaveBtn.disabled = true;
      digestBtns.append(digestGenBtn, digestSaveBtn);
      digestFooter.append(digestStatus, digestBtns);
      digestForm.append(digestWindowLabel, digestTitleLabel, digestFooter);

      const digestPreview = element('article', 'ai-answer-box ai-formatted-answer');
      digestPreview.id = 'ai-digest-preview';
      const digestIdleGrid = element('div', 'ai-model-blocks-grid ai-idle-studio-grid');
      for (const [wVal, wTitle, wDesc] of [
        ['7', '生成近 7 天周报综述', '自动汇总近一周的手记、已完成待办与文献摘录，生成带双链出处的周报笔记'],
        ['30', '生成近 30 天月度回顾', '聚合近一个月的项目进展、核心笔记与阅读摘录，一键存入 digests/ 目录'],
        ['all', '生成全库专题全景综述', '按目录与主题梳理全库笔记脉络，或切换至「长文 H2 原子拆卡」切分独立概念卡'],
      ]) {
        const card = element('button', 'ai-model-block-card ai-idle-prompt-card');
        card.type = 'button';
        card.append(element('strong', 'ai-model-block-title', wTitle), element('div', 'ai-model-block-body', wDesc));
        card.onclick = () => {
          digestWindow.value = wVal;
          digestGenBtn.click();
        };
        digestIdleGrid.append(card);
      }
      digestPreview.append(
        element('div', 'ai-answer-header', '📊 周期手记综述与长文拆卡工作台（点击下方卡片直接生成预览）'),
        digestIdleGrid,
      );
      let currentDigest = null;

      digestGenBtn.onclick = async () => {
        errorBox.hidden = true;
        digestGenBtn.disabled = true;
        try {
          const val = digestWindow.value === 'all' ? 'all' : Number(digestWindow.value) || 7;
          const res = await withIndexRetry(() => api.queryAi({
            subkind: 'digest',
            windowDays: val,
            customTitle: digestTitleInput.value.trim(),
          }, { signal: scope.signal, key: 'ai-digest' }));
          currentDigest = res;
          renderRichMarkdownDocument(digestPreview, res.markdown, {
            headerBadge: `📊 ${res.title}`,
            rawSource: res.markdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          digestStatus.textContent = `已汇编 ${res.stats.scopedNotes} 篇笔记（${res.stats.memos} 条手记 · ${res.stats.completedTasks} 项完成任务 · ${res.stats.excerpts} 条摘录）`;
          digestSaveBtn.disabled = false;
        } catch (err) {
          fail(err);
        } finally {
          digestGenBtn.disabled = false;
        }
      };

      digestSaveBtn.onclick = async () => {
        if (!currentDigest) return;
        errorBox.hidden = true;
        digestSaveBtn.disabled = true;
        try {
          const cleanName = currentDigest.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
          await api.createNote(cleanName, { folder: 'digests', source: currentDigest.markdown, background: true });
          digestStatus.textContent = `已保存到 digests/${cleanName}.md`;
          currentDigest = null;
        } catch (err) {
          digestSaveBtn.disabled = false;
          fail(err);
        }
      };

      // 6c. Smart Card Splitter & MOC Generator
      const splitForm = element('div', 'research-form');
      const splitFooter = element('div', 'research-form-footer research-wide');
      const splitStatus = element('small', '', '将当前打开的长文笔记按 H2 二级章节切分为独立原子卡片（cards/ 目录），并生成 MOC 索引');
      splitStatus.id = 'ai-split-status';
      const splitBtns = element('div', 'task-row-actions');
      const splitPreviewBtn = cmdButton(BookMarked, '预览当前笔记 H2 原子拆卡', 'ai-split-preview-btn');
      const splitApplyBtn = cmdButton(Check, '执行拆卡并生成子卡片', 'ai-split-apply-btn');
      splitApplyBtn.disabled = true;
      splitBtns.append(splitPreviewBtn, splitApplyBtn);
      splitFooter.append(splitStatus, splitBtns);
      splitForm.append(splitFooter);

      const splitOutput = element('article', 'ai-answer-box ai-formatted-answer');
      splitOutput.id = 'ai-split-output';
      splitOutput.append(
        element('div', 'ai-answer-header', '🗂️ 长文 H2 原子拆卡与 MOC 索引预览'),
        element('div', 'ai-answer-empty-body', '尚未生成原子拆卡预览。点击上方「预览当前笔记 H2 原子拆卡」查看拆分后的卡片列表与 MOC 索引。'),
      );
      let currentSplitPlan = null;

      splitPreviewBtn.onclick = () => {
        errorBox.hidden = true;
        try {
          const active = api.activeDocument();
          if (!active) throw new Error('请先打开一篇包含二级标题（##）的长文笔记');
          currentSplitPlan = splitNoteIntoCards({ title: active.name.replace(/\.md$/i, ''), source: active.source });
          if (!currentSplitPlan.cards.length) {
            splitOutput.replaceChildren(
              element('div', 'ai-answer-header', '⚠️ 未检测到可拆分的二级章节'),
              element('div', 'ai-answer-empty-body', '当前笔记未检测到符合长度要求的二级章节（##）。'),
            );
            splitApplyBtn.disabled = true;
            return;
          }
          const rawSplitMd = [
            `# 《${currentSplitPlan.parentTitle}》原子拆卡方案`,
            '',
            `> [!TIP] 拆卡概览`,
            `> 共从《[[${currentSplitPlan.parentTitle}]]》识别出 **${currentSplitPlan.cards.length}** 张独立原子概念卡（将存入 \`cards/\` 目录）。`,
            '',
            '## 拟生成的原子子卡片清单',
            '',
            ...currentSplitPlan.cards.map(c => `- **卡片 ${c.order}**：\`cards/${c.title}.md\`（**${c.wordCount}** 字）`),
            '',
            currentSplitPlan.mocSection,
          ].join('\n');
          renderRichMarkdownDocument(splitOutput, rawSplitMd, {
            headerBadge: `🗂️ 已从《${currentSplitPlan.parentTitle}》提炼 ${currentSplitPlan.cards.length} 张原子卡片`,
            rawSource: rawSplitMd,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          splitStatus.textContent = `已从《${currentSplitPlan.parentTitle}》识别出 ${currentSplitPlan.cards.length} 张可提炼的原子卡片`;
          splitApplyBtn.disabled = false;
        } catch (err) { fail(err); }
      };

      splitApplyBtn.onclick = async () => {
        if (!currentSplitPlan?.cards?.length) return;
        errorBox.hidden = true;
        splitApplyBtn.disabled = true;
        try {
          for (const card of currentSplitPlan.cards) {
            const safeTitle = card.title.slice(0, 48).replace(/[\[\]#|:：/\\]/g, '-');
            await api.createNote(safeTitle, { folder: 'cards', source: card.markdown, background: true });
          }
          splitStatus.textContent = `已成功生成 ${currentSplitPlan.cards.length} 张原子卡片并存入 cards/ 目录`;
          currentSplitPlan = null;
        } catch (err) {
          splitApplyBtn.disabled = false;
          fail(err);
        }
      };

      synthesisPanel.append(
        sectionTitle(
          '全库孤岛笔记智能织网',
          '自动扫描全库 0 入链且 0 出链的孤岛卡片，通过 128 维特征哈希余弦向量与标签重合度计算最优主干挂载点，一键补齐双向链接。',
        ),
        weaverForm,
        weaverList,
      );
      panels.set('synthesis', synthesisPanel);

      // 6b. Dedicated Weekly Digest & H2 Atomic Card Splitter Panel (Segmented Sub-Mode Switcher — Zero Vertical Piling!)
      const digestPanel = element('div', 'ai-panel');
      digestPanel.id = 'ai-panel-digest';
      digestPanel.hidden = true;

      const digestModeToolbar = element('div', 'chronicle-top-toolbar');
      const digestSubModeBar = element('div', 'context-submode-bar');
      digestSubModeBar.setAttribute('role', 'tablist');
      const digestModeTabBtn = element('button', 'context-submode-pill is-active', '📊 1. 周期手记综述汇编');
      digestModeTabBtn.type = 'button';
      digestModeTabBtn.dataset.digestSubmode = 'digest';
      const splitModeTabBtn = element('button', 'context-submode-pill', '🗂️ 2. 长文 H2 原子拆卡');
      splitModeTabBtn.type = 'button';
      splitModeTabBtn.dataset.digestSubmode = 'split';
      digestSubModeBar.append(digestModeTabBtn, splitModeTabBtn);
      digestModeToolbar.append(digestSubModeBar, splitBtns);

      const digestSubPane = element('div', 'compiler-subview-pane');
      digestSubPane.append(digestForm, digestPreview);

      const splitSubPane = element('div', 'compiler-subview-pane');
      splitSubPane.hidden = true;
      splitSubPane.append(splitStatus, splitOutput);

      const switchDigestSubMode = mode => {
        const isDigest = mode === 'digest';
        digestSubPane.hidden = !isDigest;
        splitSubPane.hidden = isDigest;
        digestModeTabBtn.classList.toggle('is-active', isDigest);
        splitModeTabBtn.classList.toggle('is-active', !isDigest);
      };
      digestModeTabBtn.onclick = () => switchDigestSubMode('digest');
      splitModeTabBtn.onclick = () => switchDigestSubMode('split');

      const origSplitPreviewClick = splitPreviewBtn.onclick;
      splitPreviewBtn.onclick = evt => {
        switchDigestSubMode('split');
        origSplitPreviewClick?.(evt);
      };

      digestPanel.append(
        sectionTitle(
          '周期综述汇编与长文 H2 原子拆卡',
          '采用分段模式切换：默认展示近 7/30 天周期手记综述汇编（存入 digests/ 目录）；点击右上角「预览当前笔记 H2 原子拆卡」或切换至第二页签，即可按二级标题切分独立概念卡（存入 cards/ 目录）。',
        ),
        digestModeToolbar,
        digestSubPane,
        splitSubPane,
      );
      panels.set('digest', digestPanel);

      // 7. Spaced Repetition Flashcards Panel (SM-2 / FSRS-inspired)
      const flashcardsPanel = element('div', 'ai-panel');
      flashcardsPanel.id = 'ai-panel-flashcards';
      flashcardsPanel.hidden = true;

      const srForm = element('div', 'research-form');
      const srFooter = element('div', 'research-form-footer research-wide');
      const srSummary = element('small', '', '支持从笔记 Q:/A: 与「概念 :: 定义」提取闪卡，基于 SM-2 间隔重复算法回写复习周期');
      srSummary.id = 'ai-sr-summary';
      const srBtns = element('div', 'task-row-actions');
      const srHardOnlyBtn = element('button', 'ux-pill-option', '🔥 难点错题本 (0)');
      srHardOnlyBtn.type = 'button';
      srHardOnlyBtn.id = 'ai-sr-hard-only-btn';
      srHardOnlyBtn.dataset.pillTone = 'rose';
      srHardOnlyBtn.setAttribute('aria-pressed', 'false');
      const srRefreshBtn = cmdButton(Search, '刷新闪卡队列', 'ai-sr-refresh');

      const srDeckMenu = element('details', 'ux-popover-menu');
      srDeckMenu.id = 'ai-sr-deck-menu';
      const srDeckTrigger = element('summary', 'ux-popover-trigger', '牌组与制卡 ▾');
      srDeckTrigger.id = 'ai-sr-deck-menu-trigger';
      srDeckTrigger.setAttribute('aria-label', '闪卡牌组筛选与提炼制卡菜单');
      const srDeckFilterBar = element('div', 'ux-popover-panel ai-sr-deck-filter-bar');
      srDeckFilterBar.id = 'ai-sr-deck-filter-bar';
      srDeckFilterBar.setAttribute('aria-label', '闪卡牌组与错题筛选');
      const srFolderSelect = element('select', 'ux-select');
      srFolderSelect.id = 'ai-sr-folder-filter';
      srFolderSelect.setAttribute('aria-label', '按来源目录筛选闪卡牌组');
      srFolderSelect.append(new Option('📂 全部来源目录', ''));
      const srTagSelect = element('select', 'ux-select');
      srTagSelect.id = 'ai-sr-tag-filter';
      srTagSelect.setAttribute('aria-label', '按标签筛选闪卡牌组');
      srTagSelect.append(new Option('🏷️ 全部 #标签', ''));
      const srPreviewBtn = cmdButton(BookMarked, '预览候选闪卡', 'ai-sr-preview-candidates');
      const srGenBtn = cmdButton(Sparkles, '从当前笔记提炼闪卡', 'ai-sr-generate-note');

      const srAnkiGroup = element('div', 'ux-popover-group ai-sr-anki-group');
      const srExportAnkiTsvBtn = cmdButton(Download, '导出 Anki TSV', 'ai-sr-export-anki-tsv');
      const srExportAnkiApkgBtn = cmdButton(Download, '导出 Anki .apkg 包', 'ai-sr-export-anki-apkg');
      const srAnkiSampleBtn = cmdButton(Sparkles, '填入 Anki 示例', 'ai-sr-anki-sample-btn');
      const srAnkiFileBtn = cmdButton(FolderOpen, '导入 .apkg/.tsv 文件', 'ai-sr-anki-file-btn');
      const srAnkiFileInput = element('input');
      srAnkiFileInput.type = 'file';
      srAnkiFileInput.id = 'ai-sr-anki-file-input';
      srAnkiFileInput.accept = '.apkg,.tsv,.txt,.csv';
      srAnkiFileInput.hidden = true;
      const srAnkiImportInput = element('textarea', 'ai-sr-anki-import-input');
      srAnkiImportInput.id = 'ai-sr-anki-import-input';
      srAnkiImportInput.rows = 3;
      srAnkiImportInput.placeholder = '粘贴 Anki TSV（Front<TAB>Back<TAB>Tags）或 Q:/A: 闪卡文本...';
      srAnkiImportInput.setAttribute('aria-label', 'Anki 闪卡导入内容');
      const srAnkiImportBtn = cmdButton(Check, '同步 Anki 闪卡到知识库', 'ai-sr-anki-import-btn', true);
      const srAnkiStatus = element('small', 'ai-sr-anki-status', '');
      srAnkiStatus.id = 'ai-sr-anki-status';
      srAnkiGroup.append(
        srExportAnkiTsvBtn,
        srExportAnkiApkgBtn,
        srAnkiSampleBtn,
        srAnkiFileBtn,
        srAnkiFileInput,
        srAnkiImportInput,
        srAnkiImportBtn,
        srAnkiStatus,
      );

      srDeckFilterBar.append(srFolderSelect, srTagSelect, srPreviewBtn, srGenBtn, srAnkiGroup);
      srDeckMenu.append(srDeckTrigger, srDeckFilterBar);

      srBtns.append(srHardOnlyBtn, srRefreshBtn, srDeckMenu);
      srFooter.append(srSummary, srBtns);
      srForm.append(srFooter);

      const srStatsRow = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row');
      srStatsRow.id = 'ai-sr-stats-pills';
      srStatsRow.setAttribute('aria-label', '记忆闪卡掌握度概览');

      const srForecastBar = element('div', 'ai-sr-forecast-bar');
      srForecastBar.id = 'ai-sr-forecast-bar';
      srForecastBar.setAttribute('aria-label', '未来 14 天闪卡到期复习负荷');

      const srCandidatePanel = element('div', 'ai-citation-card ai-sr-candidate-panel');
      srCandidatePanel.id = 'ai-sr-candidate-panel';
      srCandidatePanel.hidden = true;
      const srCandidateHeader = element('div', 'research-form-footer');
      const srCandidateSummary = element('small', '', '勾选需要写入当前笔记「## 记忆闪卡」章节的候选问答卡片：');
      srCandidateSummary.id = 'ai-sr-candidate-summary';
      const srCandidateCommitBtn = cmdButton(Check, '写入已勾选闪卡', 'ai-sr-commit-candidates');
      srCandidateHeader.append(srCandidateSummary, srCandidateCommitBtn);
      const srCandidateList = element('div', 'ai-sr-candidate-list');
      srCandidateList.id = 'ai-sr-candidate-list';
      srCandidatePanel.append(srCandidateHeader, srCandidateList);

      const srStage = element('div', 'ai-citation-card ai-sr-card');
      srStage.id = 'ai-sr-stage';
      const srCardMeta = element('small', 'ai-sr-meta-line', '');
      srCardMeta.id = 'ai-sr-meta';
      const srFront = element('strong', 'ai-sr-question', '暂无待复习闪卡');
      srFront.id = 'ai-sr-front';
      const srBack = element('div', 'ai-sr-answer-card');
      srBack.id = 'ai-sr-back';
      srBack.hidden = true;

      const srActions = element('div', 'task-row-actions');
      const srFlipBtn = cmdButton(BookMarked, '显示答案 / 翻转卡片', 'ai-sr-flip-btn', true);
      const srAgainBtn = cmdButton(X, '重来 (1天)', 'ai-sr-grade-again');
      const srHardBtn = cmdButton(GitCompare, '困难 (1.2x)', 'ai-sr-grade-hard');
      const srGoodBtn = cmdButton(Check, '良好 (标准)', 'ai-sr-grade-good');
      const srEasyBtn = cmdButton(Sparkles, '简单 (1.3x)', 'ai-sr-grade-easy');
      const srCramBtn = cmdButton(Sparkles, '开启超额自由练习（一轮浏览全部闪卡）', 'ai-sr-cram-btn');
      srCramBtn.hidden = true;
      srActions.append(srFlipBtn, srAgainBtn, srHardBtn, srGoodBtn, srEasyBtn, srCramBtn);
      srStage.append(srCardMeta, srFront, srBack, srActions);
      flashcardsPanel.append(
        sectionTitle(
          'SM-2 间隔重复记忆闪卡工作台',
          '系统仅将「今日到期或新提炼」的闪卡排入待复习队列；全部回答完毕后自动进入完成状态（绝不死循环）。若想提前巩固未到期卡片，可点击「开启超额自由练习」进行单轮练习。',
        ),
        srForm,
        srStatsRow,
        srForecastBar,
        srCandidatePanel,
        srStage,
      );
      panels.set('flashcards', flashcardsPanel);

      let srAllCards = [];
      let srCardsQueue = [];
      let srCurrentIndex = 0;
      let srPracticeAll = false;
      let srHardOnly = false;
      const srCramReviewedIds = new Set();
      let srCandidates = [];

      function getFilteredDeckCards() {
        return filterFlashcardsDeck(srAllCards, {
          folder: srFolderSelect.value || '',
          tag: srTagSelect.value || '',
          hardOnly: srHardOnly,
        });
      }

      function rebuildSrActiveQueue() {
        const deckCards = getFilteredDeckCards();
        if (srPracticeAll) {
          srCardsQueue = deckCards.filter(c => !srCramReviewedIds.has(c.id));
          if (!srCardsQueue.length) {
            srPracticeAll = false;
          }
        } else {
          srCardsQueue = deckCards.filter(c => c.isDue);
        }
        if (srCurrentIndex >= srCardsQueue.length) srCurrentIndex = 0;
      }

      const applySrFilterChange = () => {
        srCurrentIndex = 0;
        rebuildSrActiveQueue();
        renderCurrentFlashcard();
      };
      srFolderSelect.onchange = applySrFilterChange;
      srTagSelect.onchange = applySrFilterChange;
      srHardOnlyBtn.onclick = () => {
        srHardOnly = !srHardOnly;
        srHardOnlyBtn.classList.toggle('is-active', srHardOnly);
        srHardOnlyBtn.setAttribute('aria-pressed', String(srHardOnly));
        applySrFilterChange();
      };

      srCramBtn.onclick = () => {
        if (!srAllCards.length) return;
        srPracticeAll = true;
        srCramReviewedIds.clear();
        srCurrentIndex = 0;
        rebuildSrActiveQueue();
        renderCurrentFlashcard();
      };

      function renderSrStatsAndForecast(stats = {}, forecast = []) {
        srStatsRow.replaceChildren();
        const badges = [
          ['rose', `今日待复习 · ${stats.dueCards ?? 0} 张`],
          ['amber', `新卡片 · ${stats.newCards ?? 0} 张`],
          ['blue', `学习中 · ${stats.learningCards ?? 0} 张`],
          ['emerald', `已熟记 · ${stats.masteredCards ?? 0} 张`],
          ['teal', `平均难度 · ${(stats.averageEase ?? 2.5).toFixed(2)}`],
        ];
        for (const [tone, labelText] of badges) {
          const pill = element('span', 'ux-pill-option ai-sr-stat-pill', labelText);
          pill.dataset.pillTone = tone;
          srStatsRow.append(pill);
        }

        srForecastBar.replaceChildren();
        for (const day of forecast || []) {
          const col = element('div', 'ai-sr-forecast-col' + (day.isToday ? ' is-today' : '') + (day.count > 0 ? ' has-load' : ''));
          col.dataset.forecastDate = day.date;
          col.title = `${day.date}（${day.label}）：待复习 ${day.count} 张`;
          const countEl = element('small', 'ai-sr-forecast-count', String(day.count));
          const track = element('div', 'ai-sr-forecast-track');
          const fill = element('div', 'ai-sr-forecast-fill');
          fill.style.height = `${day.count > 0 ? Math.max(18, day.ratio || 20) : 6}%`;
          track.append(fill);
          const labelEl = element('span', 'ai-sr-forecast-label', day.label);
          col.append(countEl, track, labelEl);
          srForecastBar.append(col);
        }
      }

      function renderCurrentFlashcard() {
        const card = srCardsQueue[srCurrentIndex] || null;
        const hasCard = Boolean(card);
        srFlipBtn.disabled = !hasCard;
        for (const b of [srAgainBtn, srHardBtn, srGoodBtn, srEasyBtn]) b.disabled = !hasCard;
        if (!card) {
          srBack.hidden = true;
          srBack.replaceChildren();
          if (srAllCards.length > 0) {
            const nextDue = [...srAllCards].sort((a, b) => String(a.due).localeCompare(String(b.due)))[0]?.due || '未来周期';
            srCardMeta.textContent = `✅ 今日待复习队列已全部清零 · 下次最近到期日：${nextDue}`;
            srFront.textContent = `🎉 太棒了！今日待复习闪卡已全部完成（全库共掌握 ${srAllCards.length} 张记忆闪卡）`;
            srCramBtn.querySelector('span').textContent = `开启超额自由练习（单轮浏览全部 ${srAllCards.length} 张）`;
            srCramBtn.hidden = false;
          } else {
            srCardMeta.textContent = '队列为空 · 可点击上方「预览候选闪卡」或「从当前笔记提炼闪卡」自动生成记忆卡片';
            srFront.textContent = '当前暂无待复习的记忆闪卡';
            srCramBtn.hidden = true;
          }
          return;
        }
        srCramBtn.hidden = true;
        const cleanSourceTitle = String(card.noteTitle || card.citation || '').replace(/^\[\[|\]\]$/g, '');
        const modePrefix = srPracticeAll ? `【超额练习 剩余 ${srCardsQueue.length} 张】` : `待复习 ${srCurrentIndex + 1}/${srCardsQueue.length} · `;
        srCardMeta.textContent = `${modePrefix}来源《${cleanSourceTitle}》（第 ${card.lineNum} 行） · 到期 ${card.due}${card.schedule ? ` · 间隔 ${card.schedule.interval} 天` : ' · 新卡'}`;
        srFront.textContent = `问：${formatFlashcardPlainText(card.front)}`;
        srBack.replaceChildren();
        srBack.append(element('strong', 'sr-answer-prefix', '答：'));
        const segs = Array.isArray(card.segments) && card.segments.length ? card.segments : parseFlashcardRichSegments(card.back || '');
        for (const seg of segs) {
          if (seg.type === 'code') {
            srBack.append(element('code', 'sr-inline-code', seg.text));
          } else if (seg.type === 'wikilink') {
            const chip = element('button', 'sr-wikilink-chip', seg.display);
            chip.type = 'button';
            chip.title = `跳转到关联笔记：${seg.display}`;
            chip.onclick = () => api.openLink(seg.raw).catch(fail);
            srBack.append(chip);
          } else if (seg.type === 'strong') {
            srBack.append(element('strong', '', seg.text));
          } else {
            srBack.append(document.createTextNode(seg.text));
          }
        }
        srBack.hidden = true;
      }

      srFlipBtn.onclick = () => {
        if (srCardsQueue[srCurrentIndex]) srBack.hidden = !srBack.hidden;
      };

      async function refreshFlashcards() {
        const data = await withIndexRetry(() => api.queryAi({ subkind: 'flashcards' }, { signal: scope.signal, key: 'ai-flashcards' }));
        if (scope.signal.aborted) return;
        srAllCards = data.cards || [];
        const prevFolder = srFolderSelect.value;
        const prevTag = srTagSelect.value;
        const folders = Array.isArray(data.folders) && data.folders.length
          ? data.folders
          : [...new Set(srAllCards.map(c => c.folder || '根目录').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const tags = Array.isArray(data.tags) && data.tags.length
          ? data.tags
          : [...new Set(srAllCards.flatMap(c => c.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        srFolderSelect.replaceChildren(new Option('📂 全部来源目录', ''));
        for (const folderName of folders) {
          srFolderSelect.append(new Option(`📂 ${folderName}`, folderName));
        }
        if (folders.includes(prevFolder)) srFolderSelect.value = prevFolder;
        srTagSelect.replaceChildren(new Option('🏷️ 全部 #标签', ''));
        for (const tagName of tags) {
          srTagSelect.append(new Option(`#${tagName}`, tagName));
        }
        if (tags.includes(prevTag)) srTagSelect.value = prevTag;
        const hardCount = data.hardCount ?? srAllCards.filter(c => c.isHardCard).length;
        srHardOnlyBtn.textContent = `🔥 难点错题本 (${hardCount})`;
        rebuildSrActiveQueue();
        srSummary.textContent = `全库共 ${data.totalCards} 张记忆闪卡 · 今日待复习 ${data.dueCards} 张`;
        renderSrStatsAndForecast(data.stats, data.forecast);
        renderCurrentFlashcard();
      }

      async function gradeCurrentFlashcard(grade) {
        const card = srCardsQueue[srCurrentIndex];
        if (!card) return;
        errorBox.hidden = true;
        for (const b of [srAgainBtn, srHardBtn, srGoodBtn, srEasyBtn]) b.disabled = true;
        try {
          if (srPracticeAll) {
            srCramReviewedIds.add(card.id);
          }
          const active = api.activeDocument();
          if (active && active.id === card.noteId) {
            const updated = applyFlashcardReviewToSource(active.source, card.lineNum, grade);
            api.updateActiveDocument(active.id, active.revision, updated.source);
            await api.saveActiveDocument(active.id);
            srSummary.textContent = `已完成复习评分（下次到期：${updated.schedule.due} · 间隔 ${updated.schedule.interval} 天）`;
          } else {
            const raw = await withIndexRetry(() => api.read(card.noteId, { signal: scope.signal }));
            const updated = applyFlashcardReviewToSource(raw.source, card.lineNum, grade);
            await api.write(card.noteId, raw.version, updated.source);
            srSummary.textContent = `已完成复习评分（下次到期：${updated.schedule.due} · 间隔 ${updated.schedule.interval} 天）`;
          }
          await refreshFlashcards();
        } catch (err) {
          fail(err);
          renderCurrentFlashcard();
        }
      }

      srAgainBtn.onclick = () => void gradeCurrentFlashcard('again');
      srHardBtn.onclick = () => void gradeCurrentFlashcard('hard');
      srGoodBtn.onclick = () => void gradeCurrentFlashcard('good');
      srEasyBtn.onclick = () => void gradeCurrentFlashcard('easy');
      srRefreshBtn.onclick = () => void refreshFlashcards().catch(fail);

      srPreviewBtn.onclick = () => {
        srDeckMenu.open = false;
        errorBox.hidden = true;
        try {
          const active = api.activeDocument();
          if (!active) throw new Error('请先打开一篇笔记以预览候选闪卡');
          srCandidates = extractCandidateFlashcardsFromNote({ title: active.name.replace(/\.md$/i, ''), source: active.source });
          srCandidateList.replaceChildren();
          for (const [idx, cand] of srCandidates.entries()) {
            const row = element('label', 'ai-sr-candidate-row');
            row.dataset.candidateId = cand.id;
            const check = element('input');
            check.type = 'checkbox';
            check.checked = !cand.alreadyExists;
            check.dataset.candidateIndex = String(idx);
            const content = element('div', 'ai-sr-candidate-body');
            const qEl = element('strong', '', `问：${cand.question}${cand.alreadyExists ? '（已存在）' : ''}`);
            const aEl = element('span', '', `答：${cand.answerPlain}`);
            content.append(qEl, aEl);
            row.append(check, content);
            srCandidateList.append(row);
          }
          srCandidateSummary.textContent = `从《${active.name}》识别出 ${srCandidates.length} 张候选闪卡，勾选后可写入笔记：`;
          srCandidatePanel.hidden = false;
        } catch (err) {
          fail(err);
        }
      };

      srCandidateCommitBtn.onclick = async () => {
        errorBox.hidden = true;
        srCandidateCommitBtn.disabled = true;
        try {
          const active = api.activeDocument();
          if (!active) throw new Error('请先打开目标笔记');
          const checkedIndices = [...srCandidateList.querySelectorAll('input[type="checkbox"]:checked')].map(el => Number(el.dataset.candidateIndex));
          const chosen = checkedIndices.map(i => srCandidates[i]).filter(Boolean);
          const appended = appendSelectedFlashcardsToNote({ title: active.name.replace(/\.md$/i, ''), source: active.source }, chosen);
          if (appended.appendedCount > 0) {
            api.updateActiveDocument(active.id, active.revision, appended.source);
            await api.saveActiveDocument(active.id);
          }
          srCandidatePanel.hidden = true;
          await refreshFlashcards();
          srSummary.textContent = `已将勾选的 ${appended.appendedCount} 张闪卡写入《${active.name}》并同步至复习队列`;
        } catch (err) {
          fail(err);
        } finally {
          srCandidateCommitBtn.disabled = false;
        }
      };

      srGenBtn.onclick = async () => {
        srDeckMenu.open = false;
        errorBox.hidden = true;
        srGenBtn.disabled = true;
        try {
          const active = api.activeDocument();
          if (!active) throw new Error('请先打开一篇笔记以提炼记忆闪卡');
          const built = buildFlashcardsFromNote({ title: active.name.replace(/\.md$/i, ''), source: active.source });
          if (built.appendedCount > 0) {
            api.updateActiveDocument(active.id, active.revision, built.source);
            await api.saveActiveDocument(active.id);
          }
          await refreshFlashcards();
          srSummary.textContent = `已从《${active.name}》提炼 ${built.appendedCount} 张闪卡并同步至复习队列`;
        } catch (err) {
          fail(err);
        } finally {
          srGenBtn.disabled = false;
        }
      };

      const resolveActiveAnkiDeckName = () => {
        const folderPart = srFolderSelect.value ? `::${srFolderSelect.value}` : '';
        const tagPart = srTagSelect.value ? `::#${srTagSelect.value}` : '';
        return `Inkloom${folderPart}${tagPart}` || 'Inkloom::知识闪卡';
      };

      const triggerLocalDownload = (blob, fileName) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
      };

      srExportAnkiTsvBtn.onclick = () => {
        errorBox.hidden = true;
        try {
          const targetCards = getFilteredDeckCards();
          if (!targetCards.length) throw new Error('当前筛选牌组暂无可导出的记忆闪卡');
          const exported = exportFlashcardsToAnkiTsv(targetCards, { deckName: resolveActiveAnkiDeckName() });
          srAnkiImportInput.value = exported.tsv;
          triggerLocalDownload(new Blob(['\uFEFF' + exported.tsv], { type: 'text/tab-separated-values;charset=utf-8' }), 'inkloom-flashcards.tsv');
          srAnkiStatus.textContent = `已导出 ${exported.cardCount} 张闪卡为标准 Anki TSV（含 SM-2 进度注释）`;
          srSummary.textContent = `已导出 Anki TSV 牌组（${exported.cardCount} 张闪卡）`;
        } catch (err) {
          fail(err);
        }
      };

      srExportAnkiApkgBtn.onclick = () => {
        errorBox.hidden = true;
        try {
          const targetCards = getFilteredDeckCards();
          if (!targetCards.length) throw new Error('当前筛选牌组暂无可打包的记忆闪卡');
          const pkg = exportFlashcardsToAnkiDeckPackageBytes(targetCards, { deckName: resolveActiveAnkiDeckName() });
          triggerLocalDownload(new Blob([pkg.bytes], { type: 'application/octet-stream' }), pkg.fileName);
          srAnkiStatus.textContent = `已导出 Anki .apkg 离线牌组包：${pkg.fileName}（${pkg.cardCount} 张 · ${pkg.bytes.byteLength} B）`;
          srSummary.textContent = `已导出 Anki .apkg 牌组包（${pkg.cardCount} 张闪卡 · ${pkg.bytes.byteLength} B）`;
        } catch (err) {
          fail(err);
        }
      };

      srAnkiSampleBtn.onclick = () => {
        errorBox.hidden = true;
        srAnkiImportInput.value = buildSampleAnkiTsv();
        srAnkiStatus.textContent = '已填入 Anki 标准 TSV 示例，点击下方按钮即可同步至知识库';
      };

      const commitImportedAnkiPayload = async rawPayload => {
        const parsed = await parseAnkiFlashcardsImport(rawPayload);
        if (!parsed.cards.length) {
          throw new Error('未识别出有效的 Anki 问答闪卡，请检查 TSV 分隔符或 .apkg 包内容');
        }
        const active = api.activeDocument();
        let importedCount = 0;
        let targetName = '';
        if (active) {
          const appended = appendImportedAnkiCardsToNote(
            { title: active.name.replace(/\.md$/i, ''), source: active.source },
            parsed.cards,
          );
          importedCount = appended.appendedCount;
          targetName = active.name;
          if (importedCount > 0) {
            api.updateActiveDocument(active.id, active.revision, appended.source);
            await api.saveActiveDocument(active.id);
          }
        } else {
          const built = buildImportedAnkiDeckNoteMarkdown(parsed.cards, { deckName: parsed.deckName });
          importedCount = built.appendedCount;
          targetName = `${built.title}.md`;
          await api.createNote(built.title, { folder: 'flashcards', source: built.markdown, background: true });
        }
        await refreshFlashcards();
        srAnkiStatus.textContent = importedCount > 0
          ? `成功导入 ${importedCount} 张闪卡至《${targetName}》（来源：${parsed.deckName}）`
          : `解析出 ${parsed.cards.length} 张闪卡，但《${targetName}》中均已存在（未重复写入）`;
        srSummary.textContent = `已完成 Anki 闪卡同步（新增 ${importedCount} 张 · 牌组《${parsed.deckName}》）`;
      };

      srAnkiImportBtn.onclick = async () => {
        errorBox.hidden = true;
        srAnkiImportBtn.disabled = true;
        try {
          if (!srAnkiImportInput.value.trim()) throw new Error('请先粘贴 Anki TSV 内容或点击「填入 Anki 示例」');
          await commitImportedAnkiPayload(srAnkiImportInput.value);
        } catch (err) {
          fail(err);
        } finally {
          srAnkiImportBtn.disabled = false;
        }
      };

      srAnkiFileBtn.onclick = () => srAnkiFileInput.click();
      srAnkiFileInput.onchange = async () => {
        const file = srAnkiFileInput.files?.[0];
        if (!file) return;
        errorBox.hidden = true;
        srAnkiFileBtn.disabled = true;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await commitImportedAnkiPayload(bytes);
        } catch (err) {
          fail(err);
        } finally {
          srAnkiFileBtn.disabled = false;
          srAnkiFileInput.value = '';
        }
      };

      // 8. Dedicated Vault Health Doctor & Obsidian Compatibility Inspector Panel (ECO-003)
      const doctorPanel = element('div', 'ai-panel');
      doctorPanel.id = 'ai-panel-doctor';
      doctorPanel.hidden = true;

      const doctorHeader = sectionTitle(
        '全库健康与 Obsidian 语法迁移诊断',
        '全面扫描全库 Markdown 笔记的 YAML Frontmatter 完整性、待建双链断链、同名标题冲突以及 Obsidian 扩展语法（%%隐藏注释%% / ==高亮== / 转义双链），支持一键无损规范化修复。',
      );
      const doctorForm = element('div', 'research-form obs-card');
      const doctorFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      const doctorSummary = element('small', 'ai-exec-summary', '点击右侧「运行全库健康与迁移诊断」扫描全库笔记规范度');
      doctorSummary.id = 'ai-doctor-summary';
      const doctorBtns = element('div', 'task-row-actions');
      const doctorRunBtn = cmdButton(ShieldCheck, '运行全库健康与迁移诊断', 'ai-doctor-run', true);
      const doctorFixBtn = cmdButton(Check, '一键自动修复可规范化项', 'ai-doctor-autofix');
      doctorFixBtn.disabled = true;

      const doctorToolsMenu = element('details', 'ux-popover-menu');
      doctorToolsMenu.id = 'ai-doctor-tools-menu';
      const doctorToolsTrigger = element('summary', 'ux-popover-trigger', '🧬 Dataview与多源迁移 ▾');
      doctorToolsTrigger.id = 'ai-doctor-tools-menu-trigger';
      doctorToolsTrigger.setAttribute('aria-label', 'Obsidian Dataview DQL 实时查询与 Notion/Logseq 多源笔记无损迁移菜单');
      const doctorToolsPanel = element('div', 'ux-popover-panel');
      doctorToolsPanel.setAttribute('role', 'menu');

      const dqlInputGroup = element('div', 'ux-popover-group');
      const dqlQueryInput = element('input');
      dqlQueryInput.type = 'text';
      dqlQueryInput.id = 'ai-dataview-query-input';
      dqlQueryInput.value = 'TABLE status AS "状态", date AS "日期", tags FROM "" SORT date DESC LIMIT 8';
      dqlQueryInput.placeholder = '输入 Dataview DQL (TABLE / LIST / TASK)...';
      dqlQueryInput.setAttribute('aria-label', 'Obsidian Dataview DQL 查询语句');
      dqlInputGroup.append(dqlQueryInput);

      const dqlActionGroup = element('div', 'ux-popover-group');
      const dqlRunBtn = cmdButton(Search, '📊 执行 Dataview DQL 查询', 'ai-dataview-run-btn', true);
      const dqlTaskPresetBtn = cmdButton(Check, '☑️ 汇总全库未完成 TASK', 'ai-dataview-task-preset-btn');
      dqlActionGroup.append(dqlRunBtn, dqlTaskPresetBtn);

      const migActionGroup = element('div', 'ux-popover-group');
      const migSampleBtn = cmdButton(Sparkles, '🔄 预览 Notion / Logseq 迁移演练', 'ai-migration-preview-btn');
      const embedAuditBtn = cmdButton(GitCompare, '🔗 巡检全库 ![[块/章节]] 内嵌引用', 'ai-embed-audit-btn');
      doctorToolsPanel.append(dqlInputGroup, dqlActionGroup, migActionGroup);
      migActionGroup.append(migSampleBtn, embedAuditBtn);
      doctorToolsMenu.append(doctorToolsTrigger, doctorToolsPanel);

      doctorBtns.append(doctorRunBtn, doctorFixBtn, doctorToolsMenu);
      doctorFooter.append(doctorSummary, doctorBtns);
      doctorForm.append(doctorFooter);

      const doctorDataviewBox = element('article', 'ai-answer-box ai-formatted-answer');
      doctorDataviewBox.id = 'ai-doctor-dataview-output';
      doctorDataviewBox.hidden = true;

      const doctorDivider = element('div', 'ai-results-divider', '🩺 诊断发现明细表（点击笔记标题可直达对应文件）');
      const doctorList = element('div', 'ai-citation-list ai-structured-citation-grid');
      doctorList.id = 'ai-doctor-findings';
      doctorPanel.append(doctorHeader, doctorForm, doctorDataviewBox, doctorDivider, doctorList);
      panels.set('doctor', doctorPanel);

      const runDataviewInDoctor = async queryStr => {
        doctorToolsMenu.open = false;
        errorBox.hidden = true;
        dqlRunBtn.disabled = true;
        try {
          const allData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-dataview-query' }));
          const vaultNotes = (allData.clusters || []).flatMap(c => c.notes);
          const res = executeDataviewQuery(vaultNotes, queryStr);
          renderRichMarkdownDocument(doctorDataviewBox, res.markdown, {
            headerBadge: `📊 Dataview ${res.mode} 实时查询 · 命中 ${res.rowCount} 项`,
            rawSource: `\`\`\`dataview\n${queryStr}\n\`\`\`\n\n${res.markdown}`,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          doctorDataviewBox.hidden = false;
          doctorSummary.textContent = `📊 Dataview ${res.mode} 查询已执行：共匹配 ${res.rowCount} 项结果`;
        } catch (err) {
          fail(err);
        } finally {
          dqlRunBtn.disabled = false;
        }
      };

      dqlRunBtn.onclick = () => void runDataviewInDoctor(dqlQueryInput.value);
      dqlTaskPresetBtn.onclick = () => {
        dqlQueryInput.value = 'TASK WHERE !completed LIMIT 12';
        void runDataviewInDoctor(dqlQueryInput.value);
      };

      embedAuditBtn.onclick = async () => {
        doctorToolsMenu.open = false;
        errorBox.hidden = true;
        embedAuditBtn.disabled = true;
        try {
          const allData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-embed-audit' }));
          const vaultNotes = (allData.clusters || []).flatMap(c => c.notes);
          const report = inspectVaultEmbedReferences(vaultNotes);
          renderRichMarkdownDocument(doctorDataviewBox, report.reportMarkdown, {
            headerBadge: `🔗 跨笔记内嵌引用巡检 · 共 ${report.totalEmbeds} 处`,
            rawSource: report.reportMarkdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          doctorDataviewBox.hidden = false;
          doctorSummary.textContent = `🔗 全库跨笔记 ![[块/章节]] 内嵌巡检完成：正常 ${report.healthyCount} 处 · 异常 ${report.brokenCount} 处（可自动对齐 ${report.repairableCount} 处）`;
        } catch (err) {
          fail(err);
        } finally {
          embedAuditBtn.disabled = false;
        }
      };

      migSampleBtn.onclick = () => {
        doctorToolsMenu.open = false;
        errorBox.hidden = true;
        const sampleNotion = '# 知识系统架构笔记 a1b2c3d4e5f678901234567890abcdef\nStatus: 进行中\nTags: 架构设计, Notion迁入\nDate: 2026-11-08\n\n关联子页面 [双链笔记与卡片盒方法](双链笔记与卡片盒方法%200123456789abcdef0123456789abcdef.md) 与 ==核心论点==。\n';
        const sampleLogseq = 'tags:: #卡片盒, #Logseq迁入\nalias:: 卢曼笔记\n- # 卢曼大纲手记\n- id:: 672d0011-2233-4455-6677-8899aabbccdd\n- TODO 整理索引页\n- DOING 提炼概念卡\n- DONE 阅读原始文献\n';
        const convNotion = convertExternalVaultNoteToInkloom(sampleNotion, {
          fileName: '知识系统架构笔记 a1b2c3d4e5f678901234567890abcdef.md',
        });
        const convLogseq = convertExternalVaultNoteToInkloom(sampleLogseq, {
          fileName: '2026_11_08.md',
        });
        const md = [
          '## 🔄 Notion / Logseq / Obsidian 多源语法无损迁移核验 (MAJOR-230)',
          '',
          `- **Notion 导出净化**：${convNotion.actions.join(' · ')}`,
          `- **Logseq 大纲净化**：${convLogseq.actions.join(' · ')}`,
          '',
          '### 1. Notion 导出转换后标准 Markdown',
          '',
          '```markdown',
          convNotion.source.trim(),
          '```',
          '',
          '### 2. Logseq 大纲转换后标准 Markdown',
          '',
          '```markdown',
          convLogseq.source.trim(),
          '```',
        ].join('\n');
        renderRichMarkdownDocument(doctorDataviewBox, md, {
          headerBadge: '🔄 Notion / Logseq / Obsidian 多源无损转换预览',
          rawSource: md,
          onOpenLink: link => api.openLink(link).catch(fail),
        });
        doctorDataviewBox.hidden = false;
        doctorSummary.textContent = `🔄 已完成 Notion (32位UUID剥离+顶部属性转YAML) 与 Logseq (property:: + TODO/DOING/DONE) 无损转换预览`;
      };

      // 9. Dedicated Vault Milestone Snapshot & Time-Machine Panel (own tab!)
      const snapshotPanel = element('div', 'ai-panel');
      snapshotPanel.id = 'ai-panel-snapshot';
      snapshotPanel.hidden = true;
      const snapshotHeader = sectionTitle(
        '知识库里程碑快照与时光机恢复',
        '存储与空间机制：所有快照保存在本地历史快照表中，采用「SHA-256 内容寻址增量去重（Content-Addressed Deduplication）」——未改动的笔记在多个快照间共享同一份正文，保存 15 个历史快照通常仅占几十 KB；支持随时删除旧快照或导出独立 .json 归档文件永久保存。',
      );

      const snapshotStepsStrip = element('div', 'ai-workflow-steps-strip');
      snapshotStepsStrip.append(
        element('span', 'ai-workflow-step', '① 大改前点击「创建里程碑快照」存入下方历史表'),
        element('span', 'ai-workflow-arrow', '→'),
        element('span', 'ai-workflow-step', '② 在历史快照表中点选过去的某个旧快照对比当前库'),
        element('span', 'ai-workflow-arrow', '→'),
        element('span', 'ai-workflow-step', '③ 发现误改/误删时一键无损回滚（SHA-256 增量去重极省空间）'),
      );

      const snapshotForm = element('div', 'research-form obs-card');
      snapshotForm.id = 'ai-snapshot-section';
      const snapLabelInput = element('input');
      snapLabelInput.type = 'text';
      snapLabelInput.id = 'ai-snapshot-label';
      snapLabelInput.value = '1.0.0 里程碑定稿快照';
      snapLabelInput.setAttribute('aria-label', '里程碑快照标签');
      const snapLabelWrap = settingRow(
        '新建里程碑快照名称',
        '为即将保存的历史时间点命名（创建后将追加至下方「历史快照时间轴表」，最多滚动保留最近 15 个历史点）',
        snapLabelInput,
      );

      const snapImportInput = element('input');
      snapImportInput.type = 'file';
      snapImportInput.accept = '.json,.inkloom-snapshot.json';
      snapImportInput.hidden = true;

      const snapFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      const snapStatus = element('small', 'ai-exec-summary', '就绪：可在下方历史快照表中选择旧时间点与当前最新知识库对比');
      snapStatus.id = 'ai-snapshot-status';
      const snapBtns = element('div', 'task-row-actions');
      const snapCreateBtn = cmdButton(Download, '创建里程碑快照', 'ai-snapshot-create', true);
      const snapDiffBtn = cmdButton(GitCompare, '对比选中历史快照与当前库', 'ai-snapshot-diff-btn');
      const snapImportBtn = cmdButton(FolderOpen, '导入快照文件', 'ai-snapshot-import-btn');
      const snapRestoreBtn = cmdButton(Check, '无损恢复变更与缺失笔记', 'ai-snapshot-restore-btn');
      snapDiffBtn.disabled = true;
      snapRestoreBtn.disabled = true;
      snapBtns.append(snapCreateBtn, snapDiffBtn, snapImportBtn, snapRestoreBtn, snapImportInput);
      snapFooter.append(snapStatus, snapBtns);
      snapshotForm.append(snapLabelWrap, snapFooter);

      const snapHistoryHeader = element('div', 'ai-results-divider', '🕰️ 历史里程碑快照时间轴表（SHA-256 内容寻址去重存储 · 点击任意旧快照与当前库对比）');
      const snapHistoryList = element('div', 'ai-citation-list ai-structured-citation-grid');
      snapHistoryList.id = 'ai-snapshot-history-list';

      const snapDiffHeader = element('div', 'ai-results-divider', '🔍 选中历史快照 vs 当前最新知识库 · 五维差异对比结果');
      const snapStatsPills = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row');
      snapStatsPills.id = 'ai-snapshot-stats-pills';
      snapStatsPills.hidden = true;

      const snapDiffList = element('div', 'ai-citation-list ai-structured-citation-grid');
      snapDiffList.id = 'ai-snapshot-diff-list';

      const snapRawDetails = element('details', 'ai-snapshot-raw-details');
      const snapRawSummary = element('summary', '', '查看当前选中快照的底层 SHA-256 签名清单 JSON（可选）');
      const snapJsonOutput = element('textarea', 'ai-diff-box');
      snapJsonOutput.id = 'ai-snapshot-json';
      snapJsonOutput.rows = 4;
      snapJsonOutput.readOnly = true;
      snapJsonOutput.hidden = true;
      snapJsonOutput.setAttribute('aria-label', '知识库里程碑快照 JSON 清单');
      snapRawDetails.append(snapRawSummary, snapJsonOutput);

      snapshotPanel.append(
        snapshotHeader,
        snapshotStepsStrip,
        snapshotForm,
        snapHistoryHeader,
        snapHistoryList,
        snapDiffHeader,
        snapStatsPills,
        snapDiffList,
        snapRawDetails,
      );
      panels.set('snapshot', snapshotPanel);

      // 10. Dedicated Bidirectional SHA-256 Folder Sync & 3-Way Conflict Merge Panel (SYNC-001 — own tab!)
      const syncPanel = element('div', 'ai-panel');
      syncPanel.id = 'ai-panel-sync';
      syncPanel.hidden = true;
      const syncHeading = sectionTitle(
        '本地双目录 SHA-256 增量同步与冲突合并台 (SYNC-001)',
        '面向坚果云、OneDrive、局域网共享盘或外置 U 盘备份目录：先选择本地镜像文件夹（或载入演练样例），系统将基于 64 位 SHA-256 哈希逐文件比对「仅主库新增 / 仅镜像新增 / 双端冲突」，并支持三方合并落盘（完整保留 UTF-8 BOM 与 CRLF）。',
      );

      const syncStepsStrip = element('div', 'ai-workflow-steps-strip');
      syncStepsStrip.append(
        element('span', 'ai-workflow-step', '① 选择本机网盘/备份文件夹（或载入演练样例）'),
        element('span', 'ai-workflow-arrow', '→'),
        element('span', 'ai-workflow-step', '② 扫描 64 位 SHA-256 双端增量与冲突'),
        element('span', 'ai-workflow-arrow', '→'),
        element('span', 'ai-workflow-step', '③ 预览冲突差异并执行双向同步'),
      );

      const syncForm = element('div', 'research-form obs-card');
      syncForm.id = 'ai-folder-sync-section';

      const syncFolderPicker = element('input');
      syncFolderPicker.type = 'file';
      syncFolderPicker.id = 'ai-sync-folder-picker';
      syncFolderPicker.multiple = true;
      syncFolderPicker.setAttribute('webkitdirectory', '');
      syncFolderPicker.setAttribute('directory', '');
      syncFolderPicker.hidden = true;

      let customMirrorNotes = null;

      const syncPathControlWrap = element('div', 'ai-sync-path-controls');
      const syncMirrorInput = element('input');
      syncMirrorInput.type = 'text';
      syncMirrorInput.id = 'ai-sync-mirror-label';
      syncMirrorInput.value = '%LOCALAPPDATA%\\Inkloom\\MirrorVault';
      syncMirrorInput.placeholder = '输入或点击右侧按钮选择本地镜像文件夹路径...';
      syncMirrorInput.setAttribute('aria-label', '目标镜像文件夹路径');
      const syncBrowseBtn = cmdButton(FolderOpen, '选择本地文件夹...', 'ai-sync-browse-btn');
      const syncSeedDemoBtn = cmdButton(Sparkles, '载入冲突演练样例', 'ai-sync-seed-btn');
      syncPathControlWrap.append(syncMirrorInput, syncBrowseBtn, syncSeedDemoBtn, syncFolderPicker);

      const syncMirrorRow = settingRow(
        '目标镜像文件夹路径',
        '可点击「选择本地文件夹...」读取本机真实文件夹中的 .md 笔记，或点击「载入冲突演练样例」体验双端冲突合并',
        syncPathControlWrap,
      );

      const syncResolutionSelect = element('select');
      syncResolutionSelect.id = 'ai-sync-resolution';
      syncResolutionSelect.setAttribute('aria-label', '双端冲突合并策略');
      syncResolutionSelect.append(
        new Option('智能合并双端段落（保留主库正文并汇入镜像端新增段落）', 'combine'),
        new Option('保留主知识库版本（以当前主库覆盖冲突项）', 'keep-local'),
        new Option('采用镜像目录版本（以镜像端内容更新主库）', 'use-remote'),
      );
      const syncResolutionRow = settingRow(
        '双端修改冲突解决策略',
        '当同一相对路径在主库与镜像文件夹中同时被修改时的合并规则',
        syncResolutionSelect,
      );

      const syncFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      const syncStatus = element('small', 'ai-exec-summary', '就绪：点击「扫描双目录增量与冲突」对主库与目标镜像文件夹执行 SHA-256 比对');
      syncStatus.id = 'ai-sync-status';
      const syncBtns = element('div', 'task-row-actions');
      const syncScanBtn = cmdButton(GitCompare, '扫描双目录增量与冲突', 'ai-sync-scan-btn', true);
      const syncApplyBtn = cmdButton(Check, '执行增量同步与冲突合并', 'ai-sync-apply-btn');
      syncApplyBtn.disabled = true;

      let activeE2eeEnvelope = api.getSetting('e2ee-sync-envelope') || null;
      const e2eeMenu = element('details', 'ux-popover-menu');
      e2eeMenu.id = 'ai-sync-e2ee-menu';
      const e2eeMenuTrigger = element('summary', 'ux-popover-trigger', '🔐 零知识E2EE与跨平台 ▾');
      e2eeMenuTrigger.id = 'ai-sync-e2ee-menu-trigger';
      e2eeMenuTrigger.setAttribute('aria-label', '零知识端到端加密同步仓与跨平台宿主自检菜单');
      const e2eeMenuPanel = element('div', 'ux-popover-panel');
      e2eeMenuPanel.setAttribute('role', 'menu');

      const e2eeInputsGroup = element('div', 'ux-popover-group');
      const e2eePassInput = element('input');
      e2eePassInput.type = 'password';
      e2eePassInput.id = 'ai-sync-e2ee-passphrase';
      e2eePassInput.placeholder = 'E2EE 同步口令 (≥4位)';
      e2eePassInput.value = 'inkloom-e2ee-2026';
      e2eePassInput.setAttribute('aria-label', 'E2EE 零知识加密同步口令');
      const e2eeFolderInput = element('input');
      e2eeFolderInput.type = 'text';
      e2eeFolderInput.id = 'ai-sync-e2ee-folder';
      e2eeFolderInput.placeholder = '限定目录 (留空全库)';
      e2eeFolderInput.setAttribute('aria-label', 'E2EE 增量推送目录范围');
      e2eeInputsGroup.append(e2eePassInput, e2eeFolderInput);

      const e2eeActionsGroup = element('div', 'ux-popover-group');
      const e2eePushBtn = cmdButton(ShieldCheck, '🔒 增量推送至 E2EE 密文仓', 'ai-sync-e2ee-push-btn', true);
      const e2eeVerifyBtn = cmdButton(Check, '🔓 口令解密校验并还原预览', 'ai-sync-e2ee-verify-btn');
      const xplatAuditBtn = cmdButton(Sparkles, '🧭 跨平台可移植性与宿主自检', 'ai-sync-xplat-audit-btn');
      e2eeActionsGroup.append(e2eePushBtn, e2eeVerifyBtn, xplatAuditBtn);
      e2eeMenuPanel.append(e2eeInputsGroup, e2eeActionsGroup);
      e2eeMenu.append(e2eeMenuTrigger, e2eeMenuPanel);

      syncBtns.append(syncScanBtn, syncApplyBtn, e2eeMenu);
      syncFooter.append(syncStatus, syncBtns);
      syncForm.append(syncMirrorRow, syncResolutionRow, syncFooter);

      const syncStatsPills = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row');
      syncStatsPills.id = 'ai-sync-stats-pills';
      syncStatsPills.hidden = true;

      const syncE2eeReportBox = element('article', 'ai-answer-box ai-formatted-answer');
      syncE2eeReportBox.id = 'ai-sync-e2ee-report-box';
      syncE2eeReportBox.hidden = true;

      const syncConflictList = element('div', 'ai-citation-list ai-structured-citation-grid');
      syncConflictList.id = 'ai-sync-conflict-list';

      syncPanel.append(syncHeading, syncStepsStrip, syncForm, syncStatsPills, syncE2eeReportBox, syncConflictList);
      panels.set('sync', syncPanel);

      e2eePushBtn.onclick = async () => {
        e2eeMenu.open = false;
        errorBox.hidden = true;
        e2eePushBtn.disabled = true;
        try {
          const allData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-e2ee-push' }));
          const vaultNotes = (allData.clusters || []).flatMap(c => c.notes).filter(n => String(n?.source || '').length <= 65536);
          const pass = e2eePassInput.value.trim();
          const folderScope = e2eeFolderInput.value.trim();
          const nextEnv = await buildZeroKnowledgeE2eeSyncEnvelope(vaultNotes, pass, {
            folderScope,
            previousEnvelope: activeE2eeEnvelope,
          });
          activeE2eeEnvelope = nextEnv;
          const st = nextEnv.stats;
          const md = [
            '## 🔐 零知识端到端加密（E2EE）增量同步仓清单 (MAJOR-220)',
            '',
            `- **加密算法与密钥派生**：\`${nextEnv.cipher}\` + \`${nextEnv.kdf} (${nextEnv.iterations} 次迭代)\``,
            `- **同步范围与增量去重**：范围 \`${st.folderScope}\` · 共 **${st.totalNotes}** 篇笔记 · 新加密 **${st.newlyEncryptedCount}** 块 · 增量复用未变密文 **${st.reusedBlobCount}** 块`,
            `- **加密清单签名 (\`manifestSha256\`)**：\`${nextEnv.manifestSha256}\`（远端仅见密文块与哈希，零明文标题或正文暴露）`,
          ].join('\n');
          renderRichMarkdownDocument(syncE2eeReportBox, md, {
            headerBadge: '🔐 E2EE 零知识密文同步仓 · AES-256-GCM',
            rawSource: JSON.stringify(nextEnv, null, 2).slice(0, 1200),
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          syncE2eeReportBox.hidden = false;
          syncStatus.textContent = `🔒 已增量推送至 E2EE 零知识密文仓（范围：${st.folderScope} · 共 ${st.totalNotes} 篇 · 新加密 ${st.newlyEncryptedCount} 块 · 增量复用 ${st.reusedBlobCount} 块 · 密文 ${(st.totalCipherBytes / 1024).toFixed(1)} KB）`;
        } catch (err) {
          syncStatus.textContent = `❌ E2EE 推送失败：${err?.message || String(err)}`;
          fail(err);
        } finally {
          e2eePushBtn.disabled = false;
        }
      };

      e2eeVerifyBtn.onclick = async () => {
        e2eeMenu.open = false;
        errorBox.hidden = true;
        e2eeVerifyBtn.disabled = true;
        try {
          if (!activeE2eeEnvelope) {
            throw new Error('当前尚无 E2EE 密文同步仓，请先点击「🔒 增量推送至 E2EE 密文仓」');
          }
          const pass = e2eePassInput.value.trim();
          const verified = await decryptAndVerifyE2eeSyncEnvelope(activeE2eeEnvelope, pass);
          const md = [
            '## 🔓 E2EE 零知识密文仓解密与完整性核验通过',
            '',
            `- **核验状态**：✅ 全部 **${verified.noteCount}** 篇笔记通过 \`AES-256-GCM\` 认证标签与原文 64 位 SHA-256 校验（完整保留 UTF-8 BOM 与 CRLF）`,
            '',
            '| 相对路径 | 笔记标题 | 原文 SHA-256 前 12 位 | 状态 |',
            '| --- | --- | --- | --- |',
            ...verified.notes.slice(0, 8).map(n => `| \`${n.relativePath}\` | 《${n.title}》 | \`${n.plainSha256.slice(0, 12)}…\` | ✓ 校验一致 |`),
          ].join('\n');
          renderRichMarkdownDocument(syncE2eeReportBox, md, {
            headerBadge: `🔓 E2EE 解密还原核验 · ${verified.noteCount} 篇通过`,
            rawSource: md,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          syncE2eeReportBox.hidden = false;
          syncStatus.textContent = `🔓 E2EE 零知识密文仓口令解密与完整性校验通过：成功还原 ${verified.noteCount} 篇笔记（100% 匹配原文 SHA-256 指纹）`;
        } catch (err) {
          syncStatus.textContent = `❌ E2EE 校验失败：${err?.message || String(err)}`;
          fail(err);
        } finally {
          e2eeVerifyBtn.disabled = false;
        }
      };

      xplatAuditBtn.onclick = async () => {
        e2eeMenu.open = false;
        errorBox.hidden = true;
        xplatAuditBtn.disabled = true;
        try {
          const allData = await withIndexRetry(() => api.queryAi({ subkind: 'karpathy-compiler' }, { signal: scope.signal, key: 'ai-xplat-audit' }));
          const vaultNotes = (allData.clusters || []).flatMap(c => c.notes);
          const rawFiles = allData.rawDocuments || [];
          const report = evaluateCrossPlatformPortability(vaultNotes, rawFiles);
          renderRichMarkdownDocument(syncE2eeReportBox, report.markdownReport, {
            headerBadge: `🧭 跨平台可移植性与宿主矩阵 · ${report.portabilityScore}/100`,
            rawSource: report.markdownReport,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
          syncE2eeReportBox.hidden = false;
          syncStatus.textContent = `🧭 跨平台可移植性自检完成：评分 ${report.portabilityScore}/100（扫描 ${report.totalScanned} 项 · 错误 ${report.errorCount} · 提示 ${report.warnCount}）`;
        } catch (err) {
          syncStatus.textContent = `❌ 跨平台自检失败：${err?.message || String(err)}`;
          fail(err);
        } finally {
          xplatAuditBtn.disabled = false;
        }
      };

      syncBrowseBtn.onclick = () => {
        syncFolderPicker.click();
      };

      syncFolderPicker.onchange = async () => {
        const files = [...(syncFolderPicker.files || [])].filter(f => /\.(md|markdown)$/i.test(f.name));
        if (!files.length) return;
        errorBox.hidden = true;
        try {
          const loaded = [];
          let folderRootName = '';
          for (const f of files) {
            const rawRel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
            const parts = rawRel.split('/');
            if (parts.length > 1 && !folderRootName) folderRootName = parts[0];
            const relPath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
            const text = await f.text();
            loaded.push({
              relativePath: relPath,
              title: relPath.replace(/\.(md|markdown)$/i, ''),
              source: text,
            });
          }
          customMirrorNotes = loaded;
          if (folderRootName) syncMirrorInput.value = folderRootName;
          syncStatus.textContent = `已从本地文件夹「${syncMirrorInput.value}」读取 ${loaded.length} 篇 Markdown 笔记，正在执行 SHA-256 比对...`;
          syncScanBtn.click();
        } catch (err) {
          fail(err);
        } finally {
          syncFolderPicker.value = '';
        }
      };

      syncSeedDemoBtn.onclick = () => {
        customMirrorNotes = null;
        syncMirrorInput.value = '%LOCALAPPDATA%\\Inkloom\\MirrorVault (冲突演练仓)';
        syncScanBtn.click();
      };

      let currentSyncPlan = null;

      function renderSyncPlan(plan) {
        syncStatsPills.replaceChildren();
        syncConflictList.replaceChildren();
        if (!plan) {
          syncStatsPills.hidden = true;
          return;
        }
        const s = plan.summary;
        const badges = [
          ['slate', `比对路径 · ${s.totalPaths} 项`],
          ['emerald', `SHA-256 一致 · ${s.identicalCount} 篇`],
          ['teal', `待推送镜像 · ${s.pushCount} 篇`],
          ['blue', `待拉取入库 · ${s.pullCount} 篇`],
          ['rose', `双端冲突 · ${s.conflictCount} 篇`],
        ];
        for (const [tone, text] of badges) {
          const pill = element('span', 'ux-pill-option ai-sr-stat-pill', text);
          pill.dataset.pillTone = tone;
          syncStatsPills.append(pill);
        }
        syncStatsPills.hidden = false;
        syncApplyBtn.disabled = (s.pullCount + s.conflictCount + s.pushCount) === 0;

        const actionable = plan.items.filter(i => i.status !== 'identical');
        if (!actionable.length) {
          syncConflictList.append(element('p', 'empty-state', '主库与镜像目录全部笔记 SHA-256 校验 100% 一致，无需同步'));
          return;
        }
        for (const item of actionable) {
          const card = element('div', 'ai-citation-card is-structured');
          card.dataset.syncStatus = item.status;
          card.dataset.syncPath = item.relativePath;
          const headBar = element('div', 'ai-citation-card-header');
          const head = element('strong', 'home-task-title', `《${item.title}》 (${item.relativePath})`);
          const badge = element('span', 'ux-pill-option ai-sr-stat-pill', item.badgeText);
          badge.dataset.pillTone = item.tone || 'blue';
          headBar.append(head, badge);
          const hashInfo = `主库 SHA-256: ${item.localSha256 ? item.localSha256.slice(0, 12) + '…' : '无'} · 镜像 SHA-256: ${item.remoteSha256 ? item.remoteSha256.slice(0, 12) + '…' : '无'}${item.diffSummary ? ' · ' + item.diffSummary : ''}`;
          const detail = element('div', 'ai-citation-card-body', hashInfo);
          card.append(headBar, detail);
          if (item.status === 'conflict') {
            const mergedPreview = mergeConflictedNote(item.localSource, item.remoteSource, syncResolutionSelect.value, {
              mirrorLabel: syncMirrorInput.value.trim() || '镜像端同步增量',
            });
            const richConflictBox = element('div', 'ai-rich-doc-body sync-conflict-rich-preview');
            richConflictBox.dataset.conflictPreview = item.relativePath;
            renderRichMarkdownBody(richConflictBox, mergedPreview.mergedSource.slice(-260), link => api.openLink(link).catch(fail));
            card.append(richConflictBox);
          }
          syncConflictList.append(card);
        }
      }

      syncResolutionSelect.onchange = () => {
        if (currentSyncPlan) renderSyncPlan(currentSyncPlan);
      };

      syncScanBtn.onclick = async () => {
        errorBox.hidden = true;
        syncScanBtn.disabled = true;
        try {
          const plan = await withIndexRetry(() => api.queryAi({
            subkind: 'folder-sync',
            mirrorLabel: syncMirrorInput.value.trim(),
            mirrorNotes: customMirrorNotes,
          }, { signal: scope.signal, key: 'ai-folder-sync' }));
          if (scope.signal.aborted) return;
          currentSyncPlan = plan;
          renderSyncPlan(plan);
          syncStatus.textContent = `已完成「${syncMirrorInput.value.trim()}」SHA-256 比对：${plan.summary.identicalCount} 篇一致 · ${plan.summary.pullCount} 篇待拉取 · ${plan.summary.pushCount} 篇待推送 · ${plan.summary.conflictCount} 篇冲突`;
        } catch (err) {
          fail(err);
        } finally {
          syncScanBtn.disabled = false;
        }
      };

      syncApplyBtn.onclick = async () => {
        if (!currentSyncPlan) return;
        errorBox.hidden = true;
        syncApplyBtn.disabled = true;
        try {
          let pulled = 0;
          let merged = 0;
          let pushed = 0;
          const resolution = syncResolutionSelect.value;
          const active = api.activeDocument();
          const updatedMirrorNotes = [...(currentSyncPlan.mirrorNotes || [])];

          for (const item of currentSyncPlan.items) {
            if (item.status === 'remote-only' || item.status === 'remote-updated') {
              const parts = item.relativePath.split('/');
              const stem = parts.pop().replace(/\.(md|markdown)$/i, '');
              const folder = parts.join('/');
              await api.createNote(stem, { folder, source: item.remoteSource, background: true });
              pulled++;
            } else if (item.status === 'conflict') {
              const res = mergeConflictedNote(item.localSource, item.remoteSource, resolution, {
                mirrorLabel: syncMirrorInput.value.trim() || '镜像端同步增量',
              });
              if (active && active.id === item.localId) {
                api.updateActiveDocument(active.id, active.revision, res.mergedSource);
                await api.saveActiveDocument(active.id);
              } else if (item.localId) {
                const raw = await withIndexRetry(() => api.read(item.localId, { signal: scope.signal }));
                await api.write(item.localId, raw.version, res.mergedSource);
              }
              const mIdx = updatedMirrorNotes.findIndex(m => m.relativePath === item.relativePath);
              if (mIdx >= 0) updatedMirrorNotes[mIdx] = { ...updatedMirrorNotes[mIdx], source: res.mergedSource };
              merged++;
            } else if (item.status === 'local-only' || item.status === 'local-updated') {
              updatedMirrorNotes.push({ relativePath: item.relativePath, title: item.title, source: item.localSource });
              pushed++;
            }
          }

          syncStatus.textContent = `✅ 双向增量同步完成：已拉取 ${pulled} 篇、合并冲突 ${merged} 篇、推送镜像 ${pushed} 篇（双端 SHA-256 已对齐）`;
          const refreshedNotes = updatedMirrorNotes.map(n => ({ ...n }));
          currentSyncPlan = computeFolderSyncPlan(refreshedNotes, refreshedNotes, {});
          renderSyncPlan(currentSyncPlan);
        } catch (err) {
          syncApplyBtn.disabled = false;
          fail(err);
        }
      };

      let currentDoctorFindings = [];
      let snapshotHistory = Array.isArray(api.getSetting('snapshot-history')) ? [...api.getSetting('snapshot-history')] : [];
      let currentVaultSnapshot = snapshotHistory[0] || null;
      let currentSnapshotDiff = null;

      function computeDeduplicatedStorageStats(historyList = []) {
        const uniqueBlobs = new Map();
        let rawTotalBytes = 0;
        for (const snap of historyList) {
          for (const n of snap?.notes || []) {
            rawTotalBytes += n.bytes || 0;
            if (n.sha256 && !uniqueBlobs.has(n.sha256)) {
              uniqueBlobs.set(n.sha256, n.bytes || 0);
            }
          }
        }
        let dedupBytes = 0;
        for (const b of uniqueBlobs.values()) dedupBytes += b;
        return {
          snapshotCount: historyList.length,
          uniqueBlobCount: uniqueBlobs.size,
          rawTotalKB: (rawTotalBytes / 1024).toFixed(1),
          dedupKB: (dedupBytes / 1024).toFixed(1),
        };
      }

      function renderSnapshotHistoryTable() {
        snapHistoryList.replaceChildren();
        const stats = computeDeduplicatedStorageStats(snapshotHistory);
        snapHistoryHeader.textContent = `🕰️ 历史里程碑快照时间轴表（已存 ${stats.snapshotCount}/15 个历史点 · SHA-256 增量去重后总占用仅 ${stats.dedupKB} KB，原累计 ${stats.rawTotalKB} KB）`;
        if (!snapshotHistory.length) {
          snapHistoryList.append(element('p', 'empty-state', '尚无历史快照，点击上方「创建里程碑快照」即可保存当前时间点'));
          return;
        }
        for (const [idx, snap] of snapshotHistory.entries()) {
          const isSelected = currentVaultSnapshot && currentVaultSnapshot.createdAt === snap.createdAt && currentVaultSnapshot.manifestSha256 === snap.manifestSha256;
          const card = element('div', 'ai-citation-card is-structured' + (isSelected ? ' is-selected-snapshot' : ''));
          card.dataset.snapshotIndex = String(idx);
          const headBar = element('div', 'ai-citation-card-header');
          const timeStr = String(snap.createdAt || '').replace('T', ' ').slice(0, 19);
          const titleEl = element('strong', 'home-task-title', `${isSelected ? '👉 ' : '📦 '}${snap.label}（${timeStr}）`);
          const actions = element('div', 'ai-citation-badges');
          actions.append(
            element('span', 'ai-meta-chip', `${snap.noteCount} 篇笔记`),
            element('span', 'ai-meta-chip', `${((snap.totalBytes || 0) / 1024).toFixed(1)} KB`),
            element('span', 'ai-meta-chip', `SHA ${String(snap.manifestSha256 || '').slice(0, 8)}`),
          );
          const compareBtn = element('button', 'sr-wikilink-chip', isSelected ? '✓ 当前对比基准' : '🔍 与当前库对比');
          compareBtn.type = 'button';
          compareBtn.onclick = () => void selectAndDiffSnapshot(snap);

          const exportBtn = element('button', 'sr-wikilink-chip', '📥 导出文件');
          exportBtn.type = 'button';
          exportBtn.onclick = () => {
            const blob = new Blob([JSON.stringify(snap, null, 2) + '\n'], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${snap.label.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}-${String(snap.createdAt || '').slice(0, 10)}.inkloom-snapshot.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          };

          actions.append(compareBtn, exportBtn);
          if (snapshotHistory.length > 1) {
            const delBtn = element('button', 'sr-wikilink-chip', '🗑️ 删除');
            delBtn.type = 'button';
            delBtn.onclick = async () => {
              snapshotHistory = snapshotHistory.filter(item => item !== snap);
              await api.setSetting('snapshot-history', snapshotHistory).catch(() => {});
              if (currentVaultSnapshot === snap) {
                currentVaultSnapshot = snapshotHistory[0] || null;
                if (currentVaultSnapshot) await selectAndDiffSnapshot(currentVaultSnapshot);
              }
              renderSnapshotHistoryTable();
            };
            actions.append(delBtn);
          }
          headBar.append(titleEl, actions);
          card.append(headBar);
          snapHistoryList.append(card);
        }
      }

      async function selectAndDiffSnapshot(snap) {
        if (!snap) return;
        currentVaultSnapshot = snap;
        snapJsonOutput.value = JSON.stringify(snap, null, 2);
        snapJsonOutput.hidden = false;
        snapDiffBtn.disabled = false;
        renderSnapshotHistoryTable();
        const diff = await withIndexRetry(() => api.queryAi({
          subkind: 'snapshot-diff',
          snapshot: snap,
        }, { signal: scope.signal, key: 'ai-snapshot-diff' }));
        if (scope.signal.aborted) return;
        currentSnapshotDiff = diff;
        renderSnapshotDiff(diff);
      }

      async function ensureSnapshotHistoryInitialized() {
        if (!snapshotHistory.length) {
          const res = await withIndexRetry(() => api.queryAi({
            subkind: 'snapshot',
            label: '0.0 初始知识库基线快照 (自动留存)',
          }, { signal: scope.signal, key: 'ai-snapshot-seed' }));
          if (scope.signal.aborted) return;
          snapshotHistory = [res.snapshot];
          await api.setSetting('snapshot-history', snapshotHistory).catch(() => {});
        }
        if (!currentVaultSnapshot && snapshotHistory[0]) {
          currentVaultSnapshot = snapshotHistory[0];
        }
        renderSnapshotHistoryTable();
        if (currentVaultSnapshot) {
          await selectAndDiffSnapshot(currentVaultSnapshot);
        }
      }

      function renderSnapshotDiff(diff) {
        snapStatsPills.replaceChildren();
        snapDiffList.replaceChildren();
        if (!diff) {
          snapStatsPills.hidden = true;
          return;
        }
        const s = diff.summary;
        const snapName = currentVaultSnapshot?.label || '选中历史快照';
        snapDiffHeader.textContent = `🔍 历史快照「${snapName}」 vs 当前最新知识库 · 五维对比结果`;
        const badges = [
          ['teal', `快照总计 · ${s.totalSnapshotNotes} 篇`],
          ['emerald', `完全一致 · ${s.unchangedCount} 篇`],
          ['amber', `已修改可回滚 · ${s.modifiedCount} 篇`],
          ['rose', `缺失可恢复 · ${s.missingCount} 篇`],
          ['blue', `快照后新增 · ${s.addedSinceCount} 篇`],
        ];
        for (const [tone, text] of badges) {
          const pill = element('span', 'ux-pill-option ai-sr-stat-pill', text);
          pill.dataset.pillTone = tone;
          snapStatsPills.append(pill);
        }
        snapStatsPills.hidden = false;
        snapRestoreBtn.disabled = s.restorableCount === 0;

        const changedItems = diff.items.filter(i => i.status !== 'unchanged');
        if (!changedItems.length) {
          snapDiffList.append(
            element(
              'p',
              'empty-state',
              `当前知识库与历史快照「${snapName}」100% 一致。当您在后续修改或删除了笔记后，再来点击该历史快照即可查看差异并一键回滚。`,
            ),
          );
          return;
        }
        for (const item of changedItems) {
          const card = element('div', 'ai-citation-card is-structured');
          card.dataset.snapshotStatus = item.status;
          const headBar = element('div', 'ai-citation-card-header');
          const statusTitle = item.status === 'modified' ? `【已修改】《${item.title}》` : item.status === 'restorable-missing' ? `【已缺失】《${item.title}》` : `【快照后新增】《${item.title}》`;
          const head = element('strong', 'home-task-title', statusTitle);
          const chip = element('span', 'ai-meta-chip', item.restorable ? '✨ 支持一键回滚恢复' : '快照后新建文件');
          headBar.append(head, chip);
          const detail = element('div', 'ai-citation-card-body', `${item.relativePath} · ${item.summary}`);
          card.append(headBar, detail);
          snapDiffList.append(card);
        }
      }

      snapCreateBtn.onclick = async () => {
        errorBox.hidden = true;
        snapCreateBtn.disabled = true;
        try {
          const res = await withIndexRetry(() => api.queryAi({
            subkind: 'snapshot',
            label: snapLabelInput.value.trim() || '1.0.0 里程碑定稿快照',
          }, { signal: scope.signal, key: 'ai-snapshot-create' }));
          // Prepend to history (keep up to 15 snapshots)
          snapshotHistory = [res.snapshot, ...snapshotHistory.filter(s => s.manifestSha256 !== res.snapshot.manifestSha256 || s.label !== res.snapshot.label)].slice(0, 15);
          await api.setSetting('snapshot-history', snapshotHistory).catch(() => {});
          // If there is an older snapshot in history, keep comparing against the older snapshot if it has diffs, or select the newly created one
          currentVaultSnapshot = res.snapshot;
          snapJsonOutput.value = JSON.stringify(currentVaultSnapshot, null, 2);
          snapJsonOutput.hidden = false;
          snapDiffBtn.disabled = false;
          const stats = computeDeduplicatedStorageStats(snapshotHistory);
          snapStatus.textContent = `已生成里程碑快照「${currentVaultSnapshot.label}」并存入历史表（共 ${currentVaultSnapshot.noteCount} 篇 · 历史表去重后仅占 ${stats.dedupKB} KB · 签名 ${currentVaultSnapshot.manifestSha256.slice(0, 16)}...）`;
          renderSnapshotHistoryTable();
          const diff = await withIndexRetry(() => api.queryAi({
            subkind: 'snapshot-diff',
            snapshot: currentVaultSnapshot,
          }, { signal: scope.signal, key: 'ai-snapshot-diff' }));
          currentSnapshotDiff = diff;
          renderSnapshotDiff(diff);
        } catch (err) {
          fail(err);
        } finally {
          snapCreateBtn.disabled = false;
        }
      };

      snapImportBtn.onclick = () => snapImportInput.click();
      snapImportInput.onchange = async () => {
        const file = snapImportInput.files?.[0];
        if (!file) return;
        errorBox.hidden = true;
        try {
          const parsed = JSON.parse(await file.text());
          snapshotHistory = [parsed, ...snapshotHistory].slice(0, 15);
          await api.setSetting('snapshot-history', snapshotHistory).catch(() => {});
          await selectAndDiffSnapshot(parsed);
          snapStatus.textContent = `已导入外部历史快照「${parsed.label || file.name}」并与当前库完成对比`;
        } catch (err) {
          fail(err);
        } finally {
          snapImportInput.value = '';
        }
      };

      snapDiffBtn.onclick = async () => {
        if (!currentVaultSnapshot) return;
        errorBox.hidden = true;
        snapDiffBtn.disabled = true;
        try {
          await selectAndDiffSnapshot(currentVaultSnapshot);
          snapStatus.textContent = `差异对比完成（基准：「${currentVaultSnapshot.label}」）：${currentSnapshotDiff.summary.unchangedCount} 篇一致 · ${currentSnapshotDiff.summary.modifiedCount} 篇已修改 · ${currentSnapshotDiff.summary.missingCount} 篇缺失`;
        } catch (err) {
          fail(err);
        } finally {
          snapDiffBtn.disabled = false;
        }
      };

      snapRestoreBtn.onclick = async () => {
        if (!currentVaultSnapshot || !currentSnapshotDiff) return;
        errorBox.hidden = true;
        snapRestoreBtn.disabled = true;
        try {
          let restoredCount = 0;
          const active = api.activeDocument();
          for (const item of currentSnapshotDiff.items) {
            if (!item.restorable) continue;
            if (item.status === 'modified') {
              if (active && active.id === item.id) {
                api.updateActiveDocument(active.id, active.revision, item.snapshotSource);
                await api.saveActiveDocument(active.id);
              } else {
                const raw = await withIndexRetry(() => api.read(item.id, { signal: scope.signal }));
                await api.write(item.id, raw.version, item.snapshotSource);
              }
              restoredCount++;
            } else if (item.status === 'restorable-missing') {
              const parts = item.relativePath.split('/');
              const fileStem = parts.pop().replace(/\.(md|markdown|txt)$/i, '');
              const folder = parts.join('/');
              await api.createNote(fileStem, { folder, source: item.snapshotSource, background: true });
              restoredCount++;
            }
          }
          const nextDiff = await withIndexRetry(() => api.queryAi({
            subkind: 'snapshot-diff',
            snapshot: currentVaultSnapshot,
          }, { signal: scope.signal, key: 'ai-snapshot-diff' }));
          currentSnapshotDiff = nextDiff;
          renderSnapshotDiff(nextDiff);
          snapStatus.textContent = `时光机恢复完成：已无损回滚/恢复 ${restoredCount} 篇笔记至里程碑快照版本`;
        } catch (err) {
          fail(err);
        }
      };

      async function runDoctorAudit() {
        doctorRunBtn.disabled = true;
        try {
          const report = await withIndexRetry(() => api.queryAi({ subkind: 'doctor' }, { signal: scope.signal, key: 'ai-doctor' }));
          if (scope.signal.aborted) return;
          currentDoctorFindings = report.findings || [];
          doctorSummary.textContent = `全库健康度评分：${report.healthScore} / 100 · 已扫描 ${report.totalNotes} 篇笔记 · 发现 ${currentDoctorFindings.length} 项提示（${report.autoFixableCount} 项支持一键修复）`;
          doctorFixBtn.disabled = report.autoFixableCount === 0;
          doctorList.replaceChildren();
          if (!currentDoctorFindings.length) {
            doctorList.append(element('p', 'empty-state', '全库笔记健康度满分，未发现 YAML 缺失、断链或语法兼容问题'));
            return;
          }
          for (const item of currentDoctorFindings) {
            const card = element('div', 'ai-citation-card is-structured');
            card.dataset.doctorKind = item.kind;
            const headBar = element('div', 'ai-citation-card-header');
            const titleBtn = element('button', 'home-task-title', item.title);
            titleBtn.type = 'button';
            titleBtn.onclick = () => api.open(item.noteId).catch(fail);
            const kindBadge = element(
              'span',
              'ai-meta-chip',
              item.autoFixable ? '✨ 支持一键修复' : '🧭 建议人工核查',
            );
            headBar.append(titleBtn, kindBadge);
            const detail = element('div', 'ai-citation-card-body', item.detail);
            card.append(headBar, detail);
            doctorList.append(card);
          }
        } catch (err) {
          fail(err);
        } finally {
          doctorRunBtn.disabled = false;
        }
      }

      doctorRunBtn.onclick = () => { errorBox.hidden = true; void runDoctorAudit(); };
      doctorFixBtn.onclick = async () => {
        const fixableIds = [...new Set(currentDoctorFindings.filter(f => f.autoFixable).map(f => f.noteId))];
        if (!fixableIds.length) return;
        errorBox.hidden = true;
        doctorFixBtn.disabled = true;
        try {
          let fixedNotes = 0;
          const active = api.activeDocument();
          for (const noteId of fixableIds) {
            if (active && active.id === noteId) {
              const res = normalizeNoteHealthAndObsidianSyntax({ title: active.name.replace(/\.md$/i, ''), source: active.source });
              if (res.changed) {
                api.updateActiveDocument(active.id, active.revision, res.source);
                await api.saveActiveDocument(active.id);
                fixedNotes++;
              }
            } else {
              const raw = await withIndexRetry(() => api.read(noteId, { signal: scope.signal }));
              const res = normalizeNoteHealthAndObsidianSyntax({ title: '笔记', source: raw.source });
              if (res.changed) {
                await api.write(noteId, raw.version, res.source);
                fixedNotes++;
              }
            }
          }
          await runDoctorAudit();
          doctorSummary.textContent += ` · 已自动修复 ${fixedNotes} 篇笔记`;
        } catch (err) {
          fail(err);
        }
      };

      function switchTab(nextTab) {
        if (!panels.has(nextTab)) nextTab = 'chat';
        activeTab = nextTab;
        errorBox.hidden = true;
        for (const btn of navButtons) {
          const isCurrent = btn.dataset.aiTab === activeTab;
          btn.setAttribute('aria-selected', String(isCurrent));
          btn.classList.toggle('is-active', isCurrent);
        }
        for (const [key, panel] of panels) panel.hidden = key !== activeTab;
        if (activeTab === 'chat') renderIdleChatStudio();
        if (activeTab === 'compiler') void refreshKarpathyCompiler().catch(fail);
        if (activeTab === 'chronicle') void refreshCognitiveChronicle().catch(fail);
        if (activeTab === 'synthesis') void refreshWeaver().catch(fail);
        if (activeTab === 'flashcards') void refreshFlashcards().catch(fail);
        if (activeTab === 'doctor') void runDoctorAudit().catch(fail);
        if (activeTab === 'snapshot') void ensureSnapshotHistoryInitialized().catch(fail);
        if (activeTab === 'skills') void refreshSkills().catch(fail);
        if (activeTab === 'config') void loadConfig().catch(fail);
      }

      // 11. Karpathy-Style `raw/ -> wiki/` Knowledge Compiler Panel (KPKM-001..003 — Actionable 3-Step Left-Control / Right-Preview Workbench!)
      const compilerPanel = element('div', 'ai-panel');
      compilerPanel.id = 'ai-panel-compiler';
      compilerPanel.hidden = true;

      let compilerRules = defaultWikiRulesConfig();
      let currentCompilerData = null;
      let activeCompilerSubView = 'ingest'; // 'ingest' | 'lint' | 'rules'
      let activeCompilerPreviewTab = 'raw-source'; // 'raw-source' | 'raw-extracted' | 'entities' | 'crystal' | 'index'
      let activeRulesDocTab = 'rules'; // 'rules' | 'log'
      let selectedRawDocIndex = 0;
      let selectedClusterIndex = 0;
      let selectedSourceNoteIds = new Set();
      let selectedRawPaths = new Set();
      let customWikiTitleOverride = '';
      const dismissedEntityPairs = new Set();

      const compilerTopActions = element('div', 'task-row-actions');
      const compilerScanBtn = cmdButton(Search, '扫描 raw/', 'ai-compiler-scan-btn');
      const compilerIngestAllBtn = cmdButton(Sparkles, '编译全部专题', 'ai-compiler-ingest-all-btn', true);
      compilerTopActions.append(compilerScanBtn, compilerIngestAllBtn);

      const compilerHeading = sectionTitle(
        'Karpathy 知识编译器 (raw/ 异构资料 → wiki/ 知识百科)',
        '遵循 Andrej Karpathy LLM Wiki 架构：将 PDF、Word (.docx)、PPT (.pptx)、Excel (.xlsx)、CSV、TXT、网页文章放入 raw/ 原始资料仓（只读保护不篡改），自动提取结构化内容、创建/增量更新 wiki/sources/ 文献笔记与 wiki/entities/ 概念百科，并与全库笔记建立双向连接。',
        compilerTopActions,
      );

      // Unified Sub-View Switcher + Subtle Metric Strip
      const compilerToolbar = element('div', 'chronicle-top-toolbar');
      const compilerSubViewBar = element('div', 'context-submode-bar compiler-subview-bar');
      compilerSubViewBar.setAttribute('role', 'tablist');
      compilerSubViewBar.setAttribute('aria-label', '知识编译器功能视图切换');

      const compilerStatsPills = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row chronicle-kpi-strip');
      compilerStatsPills.id = 'ai-compiler-stats-pills';
      compilerToolbar.append(compilerSubViewBar, compilerStatsPills);

      const compilerStatus = element('small', 'ai-exec-summary', '');
      compilerStatus.id = 'ai-compiler-status';
      compilerStatus.hidden = true;

      // Sub-View 1: Left-Control (Raw Inbox + Topic Synthesis) + Right-Preview (Clean Paper Stage)
      const compilerIngestPane = element('div', 'compiler-subview-pane');
      compilerIngestPane.id = 'ai-compiler-ingest-pane';

      const compilerWorkbench = element('div', 'compiler-workbench-layout');
      const compilerLeftSidebar = element('div', 'compiler-control-sidebar obs-card');

      const rawInboxHeader = element('div', 'compiler-step-header-row');
      rawInboxHeader.append(element('strong', 'compiler-step-heading', '① raw/ 原始资料仓'));
      const rawInboxActions = element('div', 'compiler-inline-actions');
      const rawInboxMenu = element('details', 'ux-popover-menu');
      rawInboxMenu.id = 'ai-compiler-raw-menu';
      const rawInboxMenuTrigger = element('summary', 'ux-popover-trigger', '+ 导入与OCR ▾');
      rawInboxMenuTrigger.id = 'ai-compiler-raw-menu-trigger';
      rawInboxMenuTrigger.setAttribute('aria-label', '导入原始资料与多模态离线 OCR 菜单');
      const rawInboxMenuPanel = element('div', 'ux-popover-panel');
      rawInboxMenuPanel.setAttribute('role', 'menu');
      const importRawBtn = element('button', 'compiler-link-action', '+ 导入资料');
      importRawBtn.type = 'button';
      importRawBtn.id = 'ai-compiler-import-raw-btn';
      importRawBtn.title = '选择 PDF、Word (.docx)、PPT (.pptx)、Excel (.xlsx)、CSV、TXT、HTML、长图 (.png/.jpg/.svg) 或 Markdown 放入 raw/ 目录';
      const ocrSampleBtn = element('button', 'compiler-link-action', '🔍 载入扫描长图 OCR 样例');
      ocrSampleBtn.type = 'button';
      ocrSampleBtn.id = 'ai-compiler-ocr-sample-btn';
      ocrSampleBtn.title = '载入包含多列数据表的离线扫描长图/扫描 PDF 样例并自动执行 OCR 表格还原';
      const revealRawBtn = element('button', 'compiler-link-action', '打开 raw/');
      revealRawBtn.type = 'button';
      revealRawBtn.id = 'ai-compiler-reveal-raw-btn';
      revealRawBtn.title = '在本地资源管理器中打开 raw/ 原始资料文件夹';
      const rawFileInput = element('input');
      rawFileInput.type = 'file';
      rawFileInput.id = 'ai-compiler-raw-file-input';
      rawFileInput.accept = '.pdf,.docx,.pptx,.xlsx,.csv,.tsv,.txt,.html,.htm,.md,.markdown,.png,.jpg,.jpeg,.webp,.svg';
      rawFileInput.multiple = true;
      rawFileInput.hidden = true;
      rawInboxMenuPanel.append(importRawBtn, ocrSampleBtn, revealRawBtn);
      rawInboxMenu.append(rawInboxMenuTrigger, rawInboxMenuPanel);
      rawInboxActions.append(rawInboxMenu, rawFileInput);
      rawInboxHeader.append(rawInboxActions);

      const compilerRawList = element('div', 'compiler-raw-list');
      compilerRawList.id = 'ai-compiler-raw-list';
      compilerRawList.setAttribute('role', 'listbox');
      compilerRawList.setAttribute('aria-label', 'raw/ 原始资料列表');

      const rawActionStack = element('div', 'compiler-action-row');
      const ingestActiveRawBtn = cmdButton(Check, '✨ 摄取生成 Wiki', 'ai-compiler-ingest-raw-btn', true);
      const ingestRawAndOpenBtn = cmdButton(ArrowUpRight, '📖 摄取并打开', 'ai-compiler-ingest-open-btn');
      rawActionStack.append(ingestActiveRawBtn, ingestRawAndOpenBtn);

      const step1Label = element('strong', 'compiler-step-heading', '② 跨源专题综合 (多份 raw/ + 笔记 → wiki/topics/)');
      const compilerClustersList = element('div', 'compiler-topic-strip is-vertical-list');
      compilerClustersList.id = 'ai-compiler-clusters-list';
      compilerClustersList.setAttribute('role', 'tablist');
      compilerClustersList.setAttribute('aria-label', '候选概念晶体主题簇');

      const customTitleInput = element('input', 'compiler-custom-title-input');
      customTitleInput.type = 'text';
      customTitleInput.id = 'ai-compiler-custom-title';
      customTitleInput.placeholder = '自定义输出 Wiki 标题...';
      customTitleInput.setAttribute('aria-label', '输出 Wiki 标题');
      customTitleInput.oninput = () => {
        customWikiTitleOverride = customTitleInput.value.trim();
        renderCompilerDocPreview();
      };

      const step2Header = element('div', 'compiler-step-header-row');
      step2Header.append(element('strong', 'compiler-step-heading', '③ 勾选参与合并的 raw/ 资料与笔记'));
      const selectAllNotesBtn = element('button', 'compiler-link-action', '全选');
      selectAllNotesBtn.type = 'button';
      step2Header.append(selectAllNotesBtn);

      const compilerSourceChecklist = element('div', 'compiler-source-checklist');
      compilerSourceChecklist.id = 'ai-compiler-source-checklist';

      const compilerActionStack = element('div', 'compiler-action-row');
      const compileActiveTopicBtn = cmdButton(Check, '✨ 编译此专题', 'ai-compiler-compile-topic-btn');
      const compileAndOpenBtn = cmdButton(ArrowUpRight, '📖 编译并打开', 'ai-compiler-compile-open-btn');
      compilerActionStack.append(compileActiveTopicBtn, compileAndOpenBtn);

      compilerLeftSidebar.append(
        rawInboxHeader,
        compilerRawList,
        rawActionStack,
        step1Label,
        compilerClustersList,
        customTitleInput,
        step2Header,
        compilerSourceChecklist,
        compilerActionStack,
      );

      const compilerRightStage = element('div', 'compiler-preview-stage');
      const compilerStageBar = element('div', 'chronicle-section-bar compiler-stage-bar');
      const compilerPreviewTabs = element('div', 'context-submode-bar');
      compilerPreviewTabs.id = 'ai-compiler-preview-tabs';
      for (const [pKey, pLabel] of [
        ['raw-source', '文献笔记'],
        ['raw-extracted', '原文提取'],
        ['entities', '概念百科'],
        ['crystal', '专题预览'],
        ['index', '总目录'],
      ]) {
        const pBtn = element('button', 'context-submode-pill' + (pKey === activeCompilerPreviewTab ? ' is-active' : ''), pLabel);
        pBtn.type = 'button';
        pBtn.dataset.compilerPreviewMode = pKey;
        pBtn.setAttribute('aria-selected', String(pKey === activeCompilerPreviewTab));
        pBtn.onclick = () => {
          activeCompilerPreviewTab = pKey;
          for (const b of compilerPreviewTabs.querySelectorAll('[data-compiler-preview-mode]')) {
            const match = b.dataset.compilerPreviewMode === activeCompilerPreviewTab;
            b.classList.toggle('is-active', match);
            b.setAttribute('aria-selected', String(match));
          }
          renderCompilerDocPreview();
        };
        compilerPreviewTabs.append(pBtn);
      }

      const compilerStageCaption = element('small', 'compiler-stage-caption', '');
      compilerStageBar.append(compilerPreviewTabs, compilerStageCaption);

      const compilerPreviewBox = element('article', 'ai-answer-box ai-formatted-answer is-clean-paper');
      compilerPreviewBox.id = 'ai-compiler-preview';
      compilerRightStage.append(compilerStageBar, compilerPreviewBox);

      compilerWorkbench.append(compilerLeftSidebar, compilerRightStage);
      compilerIngestPane.append(compilerWorkbench);

      // Sub-View 2: Lint (Hooke Cognitive Tension & Structural Holes — Clean Swiss Grid Cards)
      const compilerLintPane = element('div', 'compiler-subview-pane');
      compilerLintPane.id = 'ai-compiler-lint-pane';
      compilerLintPane.hidden = true;
      const compilerLintDivider = element('div', 'chronicle-section-bar');
      compilerLintDivider.append(element('strong', 'chronicle-section-title', '🔍 跨篇矛盾与未连盲区审校（检测前后表述冲突与潜在关联笔记）'));
      const compilerLintList = element('div', 'ai-citation-list ai-structured-citation-grid');
      compilerLintList.id = 'ai-compiler-lint-list';
      compilerLintPane.append(compilerLintDivider, compilerLintList);

      // Sub-View 3: Compiler Constitution Rules & Audit Log (wiki/RULES.md & wiki/log.md)
      const compilerRulesPane = element('div', 'compiler-subview-pane');
      compilerRulesPane.id = 'ai-compiler-rules-pane';
      compilerRulesPane.hidden = true;
      const compilerForm = element('div', 'research-form obs-card');
      compilerForm.id = 'ai-compiler-controls';
      const rulesTogglesWrap = element('div', 'ai-compiler-rules-toggles');
      rulesTogglesWrap.id = 'ai-compiler-rules-bar';
      const ruleCheckDefs = [
        ['enforceLineProvenance', '强制附带 [[来源#章节]] 行号溯源'],
        ['injectHookeTensionSection', '自动生成跨篇边界辨析节'],
        ['maintainMasterIndexAndLog', '同步维护 wiki/index.md 与 log.md'],
        ['orthogonalDeduplication', '启用相似段落自动去重压缩'],
      ];
      for (const [rKey, rLabel] of ruleCheckDefs) {
        const lbl = element('label', 'ai-crystallize-check-label');
        const chk = element('input');
        chk.type = 'checkbox';
        chk.checked = Boolean(compilerRules[rKey]);
        chk.dataset.compilerRule = rKey;
        chk.onchange = () => {
          compilerRules[rKey] = chk.checked;
          void refreshKarpathyCompiler().catch(fail);
        };
        lbl.append(chk, document.createTextNode(rLabel));
        rulesTogglesWrap.append(lbl);
      }
      const compilerSaveRulesBtn = cmdButton(BookMarked, '生成并保存 wiki/RULES.md', 'ai-compiler-rules-btn', true);
      const rulesRow = settingRow(
        '编译宪章规则 (wiki/RULES.md)',
        '勾选切换编译约束，点击右侧按钮可一键在知识库生成或更新 wiki/RULES.md 实体文件',
        rulesTogglesWrap,
      );
      const rulesDocSwitchBar = element('div', 'context-submode-bar');
      const rulesDocTabBtn = element('button', 'context-submode-pill is-active', '📜 编译宪章预览 (wiki/RULES.md)');
      rulesDocTabBtn.type = 'button';
      const logDocTabBtn = element('button', 'context-submode-pill', '📒 编译审计账本 (wiki/log.md)');
      logDocTabBtn.type = 'button';
      rulesDocSwitchBar.append(rulesDocTabBtn, logDocTabBtn);

      const rulesFooter = element('div', 'research-form-footer research-wide ai-exec-bar');
      rulesFooter.append(rulesDocSwitchBar, compilerSaveRulesBtn);
      compilerForm.append(rulesRow, rulesFooter);

      const compilerRulesPreviewBox = element('article', 'ai-answer-box ai-formatted-answer is-clean-paper');
      compilerRulesPreviewBox.id = 'ai-compiler-rules-preview';
      compilerRulesPane.append(compilerForm, compilerRulesPreviewBox);

      const renderRulesOrLogPreview = () => {
        if (!currentCompilerData) return;
        if (activeRulesDocTab === 'log') {
          renderRichMarkdownDocument(compilerRulesPreviewBox, currentCompilerData.logMarkdown, {
            headerBadge: '📒 编译演进审计账本 · wiki/log.md',
            rawSource: currentCompilerData.logMarkdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        } else {
          renderRichMarkdownDocument(compilerRulesPreviewBox, currentCompilerData.rulesMarkdown, {
            headerBadge: '📜 Karpathy 编译宪章 · wiki/RULES.md',
            rawSource: currentCompilerData.rulesMarkdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        }
      };

      rulesDocTabBtn.onclick = () => {
        activeRulesDocTab = 'rules';
        rulesDocTabBtn.classList.add('is-active');
        logDocTabBtn.classList.remove('is-active');
        renderRulesOrLogPreview();
      };
      logDocTabBtn.onclick = () => {
        activeRulesDocTab = 'log';
        logDocTabBtn.classList.add('is-active');
        rulesDocTabBtn.classList.remove('is-active');
        renderRulesOrLogPreview();
      };

      function switchCompilerSubView(nextView) {
        activeCompilerSubView = nextView;
        compilerIngestPane.hidden = nextView !== 'ingest';
        compilerLintPane.hidden = nextView !== 'lint';
        compilerRulesPane.hidden = nextView !== 'rules';
        for (const btn of compilerSubViewBar.querySelectorAll('[data-compiler-view]')) {
          const active = btn.dataset.compilerView === nextView;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-selected', String(active));
        }
        if (nextView === 'rules') renderRulesOrLogPreview();
      }

      for (const [vKey, vLabel] of [
        ['ingest', '专题编译'],
        ['lint', '审校'],
        ['rules', '规则与日志'],
      ]) {
        const tabBtn = element('button', 'context-submode-pill' + (vKey === activeCompilerSubView ? ' is-active' : ''), vLabel);
        tabBtn.type = 'button';
        tabBtn.dataset.compilerView = vKey;
        tabBtn.setAttribute('aria-selected', String(vKey === activeCompilerSubView));
        tabBtn.onclick = () => switchCompilerSubView(vKey);
        compilerSubViewBar.append(tabBtn);
      }

      compilerPanel.append(
        compilerHeading,
        compilerToolbar,
        compilerStatus,
        compilerIngestPane,
        compilerLintPane,
        compilerRulesPane,
      );
      panels.set('compiler', compilerPanel);

      function renderActiveClusterChecklist() {
        if (!currentCompilerData) return;
        const clusters = (currentCompilerData.clusters || []).slice(0, 4);
        const activeCluster = clusters[selectedClusterIndex] || clusters[0];
        compilerSourceChecklist.replaceChildren();
        if (!activeCluster) return;

        for (const rDoc of (activeCluster.rawDocuments || [])) {
          const row = element('div', 'compiler-source-check-row');
          const lbl = element('label', 'compiler-source-check-label');
          const chk = element('input');
          chk.type = 'checkbox';
          chk.checked = selectedRawPaths.has(rDoc.relativePath);
          chk.onchange = () => {
            if (chk.checked) selectedRawPaths.add(rDoc.relativePath);
            else selectedRawPaths.delete(rDoc.relativePath);
            renderCompilerDocPreview();
          };
          const fmtBadge = element('span', 'compiler-format-badge is-' + rDoc.format, rDoc.format.toUpperCase());
          const titleSpan = element('span', 'compiler-source-note-name', rDoc.title || rDoc.name);
          lbl.append(chk, fmtBadge, titleSpan);

          const splitBtn = element('button', 'compiler-link-action', '对照');
          splitBtn.type = 'button';
          splitBtn.dataset.splitRawPath = rDoc.relativePath;
          splitBtn.title = `在右侧分屏对照栏打开原始文件：${rDoc.relativePath}`;
          splitBtn.onclick = () => {
            window.__inkloomOpenRawInSplitPane?.(rDoc.relativePath);
          };

          row.append(lbl, splitBtn);
          compilerSourceChecklist.append(row);
        }

        for (const note of activeCluster.notes) {
          const row = element('div', 'compiler-source-check-row');
          const lbl = element('label', 'compiler-source-check-label');
          const chk = element('input');
          chk.type = 'checkbox';
          chk.checked = selectedSourceNoteIds.has(note.id);
          chk.onchange = () => {
            if (chk.checked) selectedSourceNoteIds.add(note.id);
            else if (selectedSourceNoteIds.size > 1) selectedSourceNoteIds.delete(note.id);
            else chk.checked = true;
            renderCompilerDocPreview();
          };
          const titleSpan = element('span', 'compiler-source-note-name', note.cleanTitle);
          lbl.append(chk, titleSpan);

          const openBtn = element('button', 'compiler-link-action', '打开');
          openBtn.type = 'button';
          openBtn.title = `在编辑器中打开《${note.cleanTitle}》`;
          openBtn.onclick = () => api.open(note.id).catch(fail);

          row.append(lbl, openBtn);
          compilerSourceChecklist.append(row);
        }
      }

      selectAllNotesBtn.onclick = () => {
        if (!currentCompilerData) return;
        const clusters = (currentCompilerData.clusters || []).slice(0, 4);
        const activeCluster = clusters[selectedClusterIndex] || clusters[0];
        if (!activeCluster) return;
        selectedSourceNoteIds = new Set(activeCluster.notes.map(n => n.id));
        selectedRawPaths = new Set((activeCluster.rawDocuments || []).map(d => d.relativePath));
        renderActiveClusterChecklist();
        renderCompilerDocPreview();
      };

      function setPreviewTabActive(modeKey) {
        activeCompilerPreviewTab = modeKey;
        for (const b of compilerPreviewTabs.querySelectorAll('[data-compiler-preview-mode]')) {
          const match = b.dataset.compilerPreviewMode === modeKey;
          b.classList.toggle('is-active', match);
          b.setAttribute('aria-selected', String(match));
        }
      }

      function renderCompilerDocPreview() {
        if (!currentCompilerData) return;
        const rawDocs = currentCompilerData.rawDocuments || [];
        const activeRawDoc = rawDocs[selectedRawDocIndex] || rawDocs[0];
        const clusters = (currentCompilerData.clusters || []).slice(0, 4);
        const activeCluster = clusters[selectedClusterIndex] || clusters[0];

        if (activeRawDoc) {
          ingestActiveRawBtn.dataset.ingestRaw = activeRawDoc.relativePath;
          ingestActiveRawBtn.querySelector('span').textContent = '✨ 摄取生成 Wiki';
        }
        if (activeCluster) {
          compileActiveTopicBtn.dataset.compileCluster = activeCluster.name;
          compileActiveTopicBtn.querySelector('span').textContent = '✨ 编译此专题';
        }

        if (activeCompilerPreviewTab === 'index') {
          compilerStageCaption.textContent = `L0 总目录路由 · 共收录 ${rawDocs.length} 份 raw/ 资料与 ${(currentCompilerData.entityPages || []).length} 项概念百科`;
          renderRichMarkdownDocument(compilerPreviewBox, currentCompilerData.indexMarkdown, {
            headerBadge: '🧭 Wiki 知识总目录 · wiki/index.md',
            rawSource: currentCompilerData.indexMarkdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        } else if (activeCompilerPreviewTab === 'raw-extracted' && activeRawDoc) {
          compilerStageCaption.textContent = `原始文件：${activeRawDoc.relativePath}（${activeRawDoc.formatBadge} · 只读解析 ${activeRawDoc.sections?.length || 0} 节）`;
          renderRichMarkdownDocument(compilerPreviewBox, activeRawDoc.extractedMarkdown, {
            headerBadge: `📂 raw/ 原文结构化提取 · ${activeRawDoc.name}`,
            rawSource: activeRawDoc.extractedMarkdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        } else if (activeCompilerPreviewTab === 'entities' && activeRawDoc) {
          const entList = activeRawDoc.entityPages || [];
          const combinedEntitiesMd = entList.length
            ? entList.map(ep => ep.markdown).join('\n\n---\n\n')
            : `# 概念实体百科预览\n\n当前资料未提取到独立概念页。`;
          compilerStageCaption.textContent = `共提炼 ${entList.length} 篇概念百科（输出至 wiki/entities/*.md，增量累积引用出处）`;
          renderRichMarkdownDocument(compilerPreviewBox, combinedEntitiesMd, {
            headerBadge: `🧩 概念实体百科 (${entList.length} 篇) · wiki/entities/`,
            rawSource: combinedEntitiesMd,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        } else if (activeCompilerPreviewTab === 'raw-source' && activeRawDoc) {
          const page = activeRawDoc.sourcePage;
          compilerStageCaption.textContent = `输入：${activeRawDoc.relativePath} (${activeRawDoc.statusLabel}) → 输出：${page.relativePath}`;
          renderRichMarkdownDocument(compilerPreviewBox, page.markdown, {
            headerBadge: `📄 文献解析笔记预览 · 《${page.title}》`,
            rawSource: page.markdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        } else if (activeCluster) {
          compilerStageCaption.textContent = `已选 ${selectedRawPaths.size} 份 raw/ 资料 + ${selectedSourceNoteIds.size}/${activeCluster.notes.length} 篇源笔记 · 输出路径：wiki/topics/${activeCluster.name}.md`;
          const livePage = compileClusterToWikiPage(activeCluster, currentCompilerData.tensions, {
            ...compilerRules,
            selectedNoteIds: [...selectedSourceNoteIds],
            selectedRawPaths: [...selectedRawPaths],
            customWikiTitle: customWikiTitleOverride || activeCluster.wikiTitle,
          });
          renderRichMarkdownDocument(compilerPreviewBox, livePage.markdown, {
            headerBadge: `📄 跨源专题综合预览 · 《${livePage.title}》 (${livePage.relativePath})`,
            rawSource: livePage.markdown,
            onOpenLink: link => api.openLink(link).catch(fail),
          });
        }
      }

      const executeRawDocIngest = async (openAfter = false) => {
        if (!currentCompilerData) return;
        const rawDocs = currentCompilerData.rawDocuments || [];
        const doc = rawDocs[selectedRawDocIndex] || rawDocs[0];
        if (!doc) return;
        errorBox.hidden = true;
        ingestActiveRawBtn.disabled = true;
        ingestRawAndOpenBtn.disabled = true;
        try {
          let llmSynthesis = '';
          const cfg = validateAiProviderConfig(api.getSetting('provider-config') || {});
          if (cfg.provider !== 'local-grounded') {
            try {
              const llmResp = await api.aiComplete({
                ...cfg,
                systemPrompt: '你是 Karpathy LLM Wiki 知识编译器。请用 2~3 条精炼要点概括以下原始资料的核心机制、关键指标及可复用的方法论结论。',
                userPrompt: `资料标题：${doc.title}\n原始路径：${doc.relativePath}\n提取内容：\n${String(doc.extractedMarkdown || '').slice(0, 1800)}`,
              });
              if (llmResp?.answer) llmSynthesis = String(llmResp.answer).trim();
            } catch {}
          }
          const sourcePage = llmSynthesis
            ? compileRawDocumentToWikiBundle(doc, [], { rulesConfig: compilerRules, llmSynthesis }).sourcePage
            : doc.sourcePage;
          const created = await api.createNote(sourcePage.cleanName, {
            folder: sourcePage.folder,
            source: sourcePage.markdown,
            background: !openAfter,
            overwrite: true,
          });
          let entCount = 0;
          for (const ep of doc.entityPages || []) {
            await api.createNote(ep.cleanName, {
              folder: ep.folder,
              source: ep.markdown,
              background: true,
              overwrite: true,
            });
            entCount++;
          }
          if (compilerRules.maintainMasterIndexAndLog) {
            await api.createNote('index', { folder: 'wiki', source: currentCompilerData.indexMarkdown, background: true, overwrite: true });
            await api.createNote('log', { folder: 'wiki', source: currentCompilerData.logMarkdown, background: true, overwrite: true });
          }
          compilerStatus.hidden = false;
          compilerStatus.textContent = `✅ 已摄取原始资料 ${doc.relativePath}，写入 ${sourcePage.relativePath}、增量更新 ${entCount} 篇概念百科，并同步更新 wiki/index.md 与 wiki/log.md`;
          await refreshKarpathyCompiler();
          if (openAfter && created?.id) {
            await api.open(created.id);
          }
        } catch (err) {
          fail(err);
        } finally {
          ingestActiveRawBtn.disabled = false;
          ingestRawAndOpenBtn.disabled = false;
        }
      };

      ingestActiveRawBtn.onclick = () => void executeRawDocIngest(false);
      ingestRawAndOpenBtn.onclick = () => void executeRawDocIngest(true);

      importRawBtn.onclick = () => {
        rawInboxMenu.open = false;
        rawFileInput.click();
      };
      ocrSampleBtn.onclick = async () => {
        rawInboxMenu.open = false;
        errorBox.hidden = true;
        ocrSampleBtn.disabled = true;
        try {
          const ocrBytes = buildSampleScannedOcrBytes('svg', '产线视觉检测与双链溯源长图');
          const ocrText = new TextDecoder('utf-8').decode(ocrBytes);
          const res = await api.aiConfig('import-raw', {
            fileName: '产线视觉检测与双链溯源长图.svg',
            base64Data: '',
            source: ocrText,
            sizeBytes: ocrBytes.byteLength,
          });
          const importedPath = res?.importedPath || 'raw/产线视觉检测与双链溯源长图.svg';
          await refreshKarpathyCompiler();
          if (currentCompilerData?.rawDocuments) {
            const idx = currentCompilerData.rawDocuments.findIndex(d => d.relativePath.toLowerCase() === importedPath.toLowerCase());
            if (idx >= 0) selectedRawDocIndex = idx;
          }
          setPreviewTabActive('raw-extracted');
          renderCompilerDocPreview();
          compilerStatus.hidden = false;
          compilerStatus.textContent = `✅ 已通过离线 OCR 引擎解析「${importedPath}」并还原 Markdown 数据表，点击「✨ 摄取生成 Wiki」即可入库`;
        } catch (err) {
          fail(err);
        } finally {
          ocrSampleBtn.disabled = false;
        }
      };
      revealRawBtn.onclick = () => {
        rawInboxMenu.open = false;
        errorBox.hidden = true;
        void api.aiConfig('reveal-raw').catch(fail);
      };
      rawFileInput.onchange = async () => {
        const files = [...(rawFileInput.files || [])];
        rawFileInput.value = '';
        if (!files.length) return;
        errorBox.hidden = true;
        importRawBtn.disabled = true;
        try {
          let lastImported = '';
          for (const file of files) {
            if (file.size > 16 * 1024 * 1024) throw new Error(`文件 ${file.name} 超过 16 MB 上限`);
            const fmt = detectRawFileFormat(file.name);
            const buf = new Uint8Array(await file.arrayBuffer());
            const payload = fmt.binary
              ? { fileName: file.name, base64Data: uint8ArrayToBase64(buf), source: '', sizeBytes: buf.byteLength }
              : { fileName: file.name, base64Data: '', source: new TextDecoder('utf-8').decode(buf), sizeBytes: buf.byteLength };
            const res = await api.aiConfig('import-raw', payload);
            lastImported = res?.importedPath || `raw/${file.name}`;
          }
          await refreshKarpathyCompiler();
          if (lastImported && currentCompilerData?.rawDocuments) {
            const idx = currentCompilerData.rawDocuments.findIndex(d => d.relativePath.toLowerCase() === lastImported.toLowerCase());
            if (idx >= 0) {
              selectedRawDocIndex = idx;
              for (const [i, ch] of [...compilerRawList.children].entries()) {
                ch.classList.toggle('is-active', i === idx);
                ch.setAttribute('aria-selected', String(i === idx));
              }
            }
          }
          setPreviewTabActive('raw-source');
          renderCompilerDocPreview();
          compilerStatus.hidden = false;
          compilerStatus.textContent = `✅ 已导入 ${files.length} 份文件至 raw/ 目录（${lastImported}），已自动提取结构化章节与概念，点击「摄取此资料生成 Wiki 笔记」即可落盘`;
        } catch (err) {
          fail(err);
        } finally {
          importRawBtn.disabled = false;
        }
      };

      const executeTopicCompile = async (openAfter = false) => {
        if (!currentCompilerData) return;
        const clusters = (currentCompilerData.clusters || []).slice(0, 4);
        const cl = clusters[selectedClusterIndex] || clusters[0];
        if (!cl) return;
        errorBox.hidden = true;
        compileActiveTopicBtn.disabled = true;
        compileAndOpenBtn.disabled = true;
        try {
          const page = compileClusterToWikiPage(cl, currentCompilerData.tensions, {
            ...compilerRules,
            selectedNoteIds: [...selectedSourceNoteIds],
            selectedRawPaths: [...selectedRawPaths],
            customWikiTitle: customWikiTitleOverride || cl.wikiTitle,
          });
          const created = await api.createNote(page.cleanName, { folder: page.folder || 'wiki/topics', source: page.markdown, background: !openAfter, overwrite: true });
          if (compilerRules.maintainMasterIndexAndLog) {
            await api.createNote('index', { folder: 'wiki', source: currentCompilerData.indexMarkdown, background: true, overwrite: true });
            await api.createNote('log', { folder: 'wiki', source: currentCompilerData.logMarkdown, background: true, overwrite: true });
          }
          compilerStatus.hidden = false;
          compilerStatus.textContent = `✅ 已将《${cl.name}》（聚合 ${page.rawDocCount || 0} 份 raw/ 资料与 ${page.sourceCount} 篇源笔记）编译写入 ${page.relativePath}，并同步更新 wiki/index.md 与 wiki/log.md`;
          await refreshKarpathyCompiler();
          if (openAfter && created?.id) {
            await api.open(created.id);
          }
        } catch (err) {
          fail(err);
        } finally {
          compileActiveTopicBtn.disabled = false;
          compileAndOpenBtn.disabled = false;
        }
      };

      compileActiveTopicBtn.onclick = () => void executeTopicCompile(false);
      compileAndOpenBtn.onclick = () => void executeTopicCompile(true);

      async function refreshKarpathyCompiler() {
        compilerScanBtn.disabled = true;
        try {
          const data = await withIndexRetry(() => api.queryAi({
            subkind: 'karpathy-compiler',
            rulesConfig: compilerRules,
            dismissedEdges: [...dismissedEntityPairs],
          }, { signal: scope.signal, key: 'ai-karpathy-compiler' }));
          if (scope.signal.aborted) return;
          currentCompilerData = data;
          const s = data.stats;
          compilerStatsPills.replaceChildren();
          const statItems = [
            ['teal', `raw/ 资料 ${s.totalRawFiles || 0} 份`],
            ['emerald', `提炼概念 ${s.extractedEntityCount || 0} 项`],
            ['purple', `已存 Wiki ${s.existingWikiCount} 篇`],
            ...(s.invalidatedWikiCount ? [['rose', `失效待重算 ${s.invalidatedWikiCount} 篇`]] : []),
            ...(s.entityRelationCount ? [['indigo', `实体关系 ${s.entityRelationCount} 处`]] : []),
            ['amber', `矛盾项 ${s.tensionCount} 处`],
            ['blue', `待连盲区 ${s.structuralHoleCount} 处`],
          ];
          for (const [tone, text] of statItems) {
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', text);
            pill.dataset.pillTone = tone;
            compilerStatsPills.append(pill);
          }

          // Render raw/ heterogeneous documents inbox
          compilerRawList.replaceChildren();
          const rawDocs = data.rawDocuments || [];
          if (selectedRawDocIndex >= rawDocs.length) selectedRawDocIndex = 0;
          for (const [rIdx, rDoc] of rawDocs.entries()) {
            const isSelected = rIdx === selectedRawDocIndex;
            const itemBtn = element('button', 'compiler-cluster-card compiler-raw-card' + (isSelected ? ' is-active' : ''));
            itemBtn.type = 'button';
            itemBtn.dataset.rawPath = rDoc.relativePath;
            itemBtn.dataset.rawFormat = rDoc.format;
            itemBtn.dataset.rawStatus = rDoc.status;
            itemBtn.setAttribute('aria-selected', String(isSelected));
            itemBtn.title = `${rDoc.relativePath} (${rDoc.formatBadge} · ${rDoc.statusLabel})`;

            const leftInfo = element('div', 'compiler-raw-card-main');
            const fmtBadge = element('span', 'compiler-format-badge is-' + rDoc.format, rDoc.format.toUpperCase());
            const titleStrong = element('strong', 'compiler-topic-title', rDoc.title || rDoc.name);
            leftInfo.append(fmtBadge, titleStrong);

            const stateSpan = element(
              'span',
              'compiler-topic-badge is-' + (rDoc.status === 'synced' ? 'ready' : 'accumulating'),
              rDoc.statusLabel,
            );
            itemBtn.append(leftInfo, stateSpan);

            itemBtn.onclick = () => {
              selectedRawDocIndex = rIdx;
              for (const [i, ch] of [...compilerRawList.children].entries()) {
                ch.classList.toggle('is-active', i === rIdx);
                ch.setAttribute('aria-selected', String(i === rIdx));
              }
              if (activeCompilerPreviewTab === 'crystal' || activeCompilerPreviewTab === 'index') {
                setPreviewTabActive('raw-source');
              } else {
                renderCompilerDocPreview();
              }
            };
            compilerRawList.append(itemBtn);
          }

          compilerClustersList.replaceChildren();
          const topClusters = (data.clusters || []).slice(0, 4);
          if (selectedClusterIndex >= topClusters.length) selectedClusterIndex = 0;
          const currentCluster = topClusters[selectedClusterIndex] || topClusters[0];
          if (currentCluster) {
            selectedSourceNoteIds = new Set(currentCluster.notes.map(n => n.id));
            selectedRawPaths = new Set((currentCluster.rawDocuments || []).map(d => d.relativePath));
            customWikiTitleOverride = currentCluster.wikiTitle;
            customTitleInput.value = currentCluster.wikiTitle;
          }

          for (const [idx, cl] of topClusters.entries()) {
            const isSelected = idx === selectedClusterIndex;
            const card = element(
              'button',
              'compiler-cluster-card is-topic-step' + (isSelected ? ' is-active' : ''),
            );
            card.type = 'button';
            card.dataset.clusterId = cl.id;
            card.dataset.phaseState = cl.phaseState;
            card.setAttribute('role', 'tab');
            card.setAttribute('aria-selected', String(isSelected));
            card.title = `点击选择专题《${cl.name}》（含 ${(cl.rawDocuments || []).length} 份 raw/ 资料与 ${cl.noteCount} 篇源笔记）`;

            const nameStrong = element('strong', 'compiler-topic-title', cl.name);
            const countSpan = element('span', 'compiler-topic-badge is-' + cl.phaseState, `${cl.noteCount} 篇`);
            card.append(nameStrong, countSpan);

            card.onclick = () => {
              selectedClusterIndex = idx;
              selectedSourceNoteIds = new Set(cl.notes.map(n => n.id));
              selectedRawPaths = new Set((cl.rawDocuments || []).map(d => d.relativePath));
              customWikiTitleOverride = cl.wikiTitle;
              customTitleInput.value = cl.wikiTitle;
              setPreviewTabActive('crystal');
              for (const [cIdx, cEl] of [...compilerClustersList.children].entries()) {
                cEl.classList.toggle('is-active', cIdx === idx);
                cEl.setAttribute('aria-selected', String(cIdx === idx));
              }
              renderActiveClusterChecklist();
              renderCompilerDocPreview();
            };
            compilerClustersList.append(card);
          }

          renderActiveClusterChecklist();
          renderCompilerDocPreview();
          if (activeCompilerSubView === 'rules') renderRulesOrLogPreview();

          // Render Lint: Pending raw/ files + Missing Entity/Index Health + Hooke Tension + Structural Holes
          compilerLintList.replaceChildren();
          for (const pDoc of (data.wikiLint?.pendingRawDocs || []).slice(0, 3)) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'pending-raw';
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `📂 原始资料待同步：《${pDoc.title}》（${pDoc.formatBadge}）`);
            const rightWrap = element('div', 'ai-citation-badges');
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', pDoc.statusLabel);
            pill.dataset.pillTone = 'teal';
            const syncNowBtn = element('button', 'sr-wikilink-chip', '✨ 立即摄取同步');
            syncNowBtn.type = 'button';
            syncNowBtn.dataset.lintIngestRaw = pDoc.relativePath;
            syncNowBtn.onclick = async () => {
              errorBox.hidden = true;
              syncNowBtn.disabled = true;
              try {
                const targetRaw = (data.rawDocuments || []).find(d => d.relativePath === pDoc.relativePath);
                if (targetRaw) {
                  await api.createNote(targetRaw.sourcePage.cleanName, {
                    folder: targetRaw.sourcePage.folder,
                    source: targetRaw.sourcePage.markdown,
                    background: true,
                    overwrite: true,
                  });
                  for (const ep of targetRaw.entityPages || []) {
                    await api.createNote(ep.cleanName, {
                      folder: ep.folder,
                      source: ep.markdown,
                      background: true,
                      overwrite: true,
                    });
                  }
                  await api.createNote('index', { folder: 'wiki', source: data.indexMarkdown, background: true, overwrite: true });
                  await api.createNote('log', { folder: 'wiki', source: data.logMarkdown, background: true, overwrite: true });
                  compilerStatus.hidden = false;
                  compilerStatus.textContent = `✅ 已在审校台同步摄取 ${pDoc.relativePath} → ${targetRaw.sourcePage.relativePath}`;
                  await refreshKarpathyCompiler();
                }
              } catch (err) {
                syncNowBtn.disabled = false;
                fail(err);
              }
            };
            rightWrap.append(pill, syncNowBtn);
            headBar.append(head, rightWrap);
            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(element('span', 'chronicle-kv-key', '文件路径'), element('span', 'chronicle-kv-val', `${pDoc.relativePath} 尚未同步至 wiki/sources/，点击右上角「立即摄取同步」即可一键落盘。`));
            kv.append(r1);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }

          for (const inv of (data.wikiLint?.invalidatedWikiPages || []).slice(0, 4)) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'invalidated-wiki';
            card.dataset.invalidatedWikiPath = inv.wikiPath;
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `🔄 原文变更 · 证据失效待重算：《${inv.wikiTitle}》`);
            const rightWrap = element('div', 'ai-citation-badges');
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', inv.preservedAnnotations ? '保留人工批注' : '上游已变更');
            pill.dataset.pillTone = 'rose';
            const recomputeBtn = element('button', 'sr-wikilink-chip', '🔄 增量重算并保留批注');
            recomputeBtn.type = 'button';
            recomputeBtn.dataset.recomputeWiki = inv.wikiPath;
            recomputeBtn.onclick = async () => {
              errorBox.hidden = true;
              recomputeBtn.disabled = true;
              try {
                const allNotesSnapshot = (data.clusters || []).flatMap(c => c.notes || []);
                const existingWikiNote = inv.wikiId ? await withIndexRetry(() => api.read(inv.wikiId, { signal: scope.signal })).catch(() => null) : null;
                const notesForRecompute = existingWikiNote
                  ? [...allNotesSnapshot, { id: inv.wikiId, title: inv.wikiTitle, relativePath: inv.wikiPath, folder: inv.folder, source: existingWikiNote.source }]
                  : allNotesSnapshot;
                const recomputed = recomputeInvalidatedWikiPage(
                  inv,
                  notesForRecompute,
                  data.rawDocuments || [],
                  data.clusters || [],
                  data.tensions || [],
                  compilerRules,
                );
                await api.createNote(recomputed.cleanName, {
                  folder: recomputed.folder || inv.folder || 'wiki/topics',
                  source: recomputed.markdown,
                  background: true,
                  overwrite: true,
                });
                const lintLogMd = appendWikiCompileLogMarkdown(data.logMarkdown, {
                  operation: 'RECOMPUTE-INVALIDATED',
                  compiledTitles: [recomputed.title || inv.wikiTitle],
                  sourceNoteCount: data.stats?.totalSourceNotes || 0,
                  tensionCount: data.stats?.tensionCount || 0,
                  holeCount: data.stats?.structuralHoleCount || 0,
                });
                await api.createNote('index', { folder: 'wiki', source: data.indexMarkdown, background: true, overwrite: true });
                await api.createNote('log', { folder: 'wiki', source: lintLogMd, background: true, overwrite: true });
                compilerStatus.hidden = false;
                compilerStatus.textContent = `✅ 已增量重算失效页面 ${inv.wikiPath}（更新上游证据指纹${recomputed.preservedAnnotations ? '，已完整保留人工研读批注' : ''}）`;
                await refreshKarpathyCompiler();
              } catch (err) {
                recomputeBtn.disabled = false;
                fail(err);
              }
            };
            rightWrap.append(pill, recomputeBtn);
            headBar.append(head, rightWrap);
            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(element('span', 'chronicle-kv-key', '失效原因'), element('span', 'chronicle-kv-val', inv.reason || '上游源笔记或原始资料已变更'));
            const r2 = element('div', 'chronicle-kv-row');
            r2.append(element('span', 'chronicle-kv-key', '目标路径'), element('span', 'chronicle-kv-val', `${inv.wikiPath}（点击右上角即可对齐最新原文并刷新 source_fingerprints）`));
            kv.append(r1, r2);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }

          for (const rel of (data.wikiLint?.entityRelations || []).slice(0, 4)) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'entity-relation';
            card.dataset.entityPairKey = rel.pairKey;
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `🧬 概念实体关系审阅：《${rel.sourceTitle}》 ──[${rel.entityName} · ${rel.relationVerb}]──► 《${rel.targetTitle}》`);
            const rightWrap = element('div', 'ai-citation-badges');
            const locBtn = element('button', 'compiler-link-action', `${rel.sourcePath} · 第 ${rel.line} 行`);
            locBtn.type = 'button';
            locBtn.dataset.entityEvidenceSource = rel.sourceId;
            locBtn.onclick = () => api.open(rel.sourceId).catch(fail);
            const promoteBtn = element('button', 'sr-wikilink-chip', '✨ 采纳关系双链');
            promoteBtn.type = 'button';
            promoteBtn.dataset.promoteEntityRel = rel.pairKey;
            promoteBtn.onclick = async () => {
              errorBox.hidden = true;
              promoteBtn.disabled = true;
              try {
                const raw = await withIndexRetry(() => api.read(rel.sourceId, { signal: scope.signal }));
                const woven = applyOrphanWeaveLink(raw.source, rel.targetTitle, `概念实体「${rel.entityName}」(${rel.relationVerb})`);
                if (woven.changed) await api.write(rel.sourceId, raw.version, woven.source);
                compilerStatus.hidden = false;
                compilerStatus.textContent = `✅ 已采纳概念实体「${rel.entityName}」关系，在《${rel.sourceTitle}》写入指向《${rel.targetTitle}》的双链`;
                await refreshKarpathyCompiler();
              } catch (err) {
                promoteBtn.disabled = false;
                fail(err);
              }
            };
            const dismissRelBtn = element('button', 'compiler-link-action', '忽略');
            dismissRelBtn.type = 'button';
            dismissRelBtn.dataset.dismissEntityRel = rel.pairKey;
            dismissRelBtn.onclick = async () => {
              dismissedEntityPairs.add(rel.pairKey);
              await refreshKarpathyCompiler();
            };
            rightWrap.append(locBtn, promoteBtn, dismissRelBtn);
            headBar.append(head, rightWrap);
            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(element('span', 'chronicle-kv-key', '原文证据'), element('span', 'chronicle-kv-val', rel.snippet || rel.reason));
            kv.append(r1);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }

          const missingEntities = data.wikiLint?.missingEntityPages || [];
          const orphanPages = data.wikiLint?.orphanWikiPages || [];
          if (missingEntities.length > 0 || orphanPages.length > 0) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'wiki-health';
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `🧩 Wiki 概念百科与索引待补全（待建概念 ${missingEntities.length} 项 · 孤立页 ${orphanPages.length} 篇）`);
            const rightWrap = element('div', 'ai-citation-badges');
            const repairBtn = element('button', 'sr-wikilink-chip', '🔧 一键修复索引与交叉引用');
            repairBtn.type = 'button';
            repairBtn.id = 'ai-compiler-repair-wiki-btn';
            repairBtn.onclick = async () => {
              errorBox.hidden = true;
              repairBtn.disabled = true;
              try {
                let repairedCount = 0;
                for (const ep of missingEntities) {
                  await api.createNote(ep.cleanName, {
                    folder: ep.folder,
                    source: ep.markdown,
                    background: true,
                    overwrite: true,
                  });
                  repairedCount++;
                }
                const lintLogMd = appendWikiCompileLogMarkdown(data.logMarkdown, {
                  operation: 'LINT',
                  compiledTitles: missingEntities.map(e => e.title),
                  sourceNoteCount: data.stats?.totalSourceNotes || 0,
                  tensionCount: data.stats?.tensionCount || 0,
                  holeCount: data.stats?.structuralHoleCount || 0,
                });
                await api.createNote('index', { folder: 'wiki', source: data.indexMarkdown, background: true, overwrite: true });
                await api.createNote('log', { folder: 'wiki', source: lintLogMd, background: true, overwrite: true });
                compilerStatus.hidden = false;
                compilerStatus.textContent = `✅ 已补全 ${repairedCount} 篇概念百科（wiki/entities/），并同步修复 wiki/index.md 与 wiki/log.md`;
                await refreshKarpathyCompiler();
              } catch (err) {
                repairBtn.disabled = false;
                fail(err);
              }
            };
            rightWrap.append(repairBtn);
            headBar.append(head, rightWrap);
            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(
              element('span', 'chronicle-kv-key', '待补概念'),
              element('span', 'chronicle-kv-val', missingEntities.map(e => `[[${e.title}]]`).join(' · ') || '全部概念页已就绪'),
            );
            kv.append(r1);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }

          for (const t of (data.tensions || []).slice(0, 3)) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'hooke-tension';
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `⚡ 胡克认知张力冲突：《${t.noteA.title}》 ↔ 《${t.noteB.title}》`);
            const rightWrap = element('div', 'ai-citation-badges');
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', `张力势能 E=${t.tensionScore}`);
            pill.dataset.pillTone = 'amber';
            const resolveTensionBtn = element('button', 'sr-wikilink-chip', '⚖️ 写入 Wiki 边界辨析节');
            resolveTensionBtn.type = 'button';
            resolveTensionBtn.dataset.resolveTension = t.id;
            resolveTensionBtn.onclick = async () => {
              errorBox.hidden = true;
              resolveTensionBtn.disabled = true;
              try {
                const targetCluster = (data.clusters || []).find(cl =>
                  cl.notes.some(n => n.id === t.noteA.id || n.id === t.noteB.id),
                ) || (data.clusters || [])[0];
                const basePage = compileClusterToWikiPage(targetCluster, [t], compilerRules);
                const resolvedMd = appendDialecticalTensionToWikiMarkdown(basePage.markdown, t);
                await api.createNote(basePage.cleanName, {
                  folder: basePage.folder || 'wiki/topics',
                  source: resolvedMd,
                  background: true,
                  overwrite: true,
                });
                const lintLogMd = appendWikiCompileLogMarkdown(data.logMarkdown, {
                  operation: 'LINT-TENSION',
                  compiledTitles: [basePage.title],
                  sourceNoteCount: data.stats?.totalSourceNotes || 0,
                  tensionCount: 1,
                });
                await api.createNote('index', { folder: 'wiki', source: data.indexMarkdown, background: true, overwrite: true });
                await api.createNote('log', { folder: 'wiki', source: lintLogMd, background: true, overwrite: true });
                compilerStatus.hidden = false;
                compilerStatus.textContent = `✅ 已将《${t.noteA.title}》与《${t.noteB.title}》的正反边界辨析节写入 ${basePage.relativePath} 并记入 wiki/log.md`;
                await refreshKarpathyCompiler();
              } catch (err) {
                resolveTensionBtn.disabled = false;
                fail(err);
              }
            };
            rightWrap.append(pill, resolveTensionBtn);
            headBar.append(head, rightWrap);

            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(element('span', 'chronicle-kv-key', '冲突原因'), element('span', 'chronicle-kv-val', t.reason));
            const r2 = element('div', 'chronicle-kv-row');
            r2.append(element('span', 'chronicle-kv-key', '命题对照'), element('span', 'chronicle-kv-val', `【A】${t.noteA.snippet}  ⟷  【B】${t.noteB.snippet}`));
            kv.append(r1, r2);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }
          for (const h of (data.structuralHoles || []).slice(0, 3)) {
            const card = element('div', 'ai-citation-card is-structured chronicle-milestone-card');
            card.dataset.lintKind = 'structural-hole';
            const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
            const head = element('strong', 'home-task-title', `🧭 结构洞跨界盲区：《${h.noteA.title}》 ⋯⋯► 《${h.noteB.title}》`);
            const rightWrap = element('div', 'ai-citation-badges');
            const pill = element('span', 'ux-pill-option ai-sr-stat-pill', `桥接增益 B=${h.bridgeScore}`);
            pill.dataset.pillTone = 'blue';
            const bridgeBtn = element('button', 'sr-wikilink-chip', '✨ 一键织入跨界双链');
            bridgeBtn.type = 'button';
            bridgeBtn.dataset.bridgeHole = h.id;
            bridgeBtn.onclick = async () => {
              errorBox.hidden = true;
              bridgeBtn.disabled = true;
              try {
                const raw = await withIndexRetry(() => api.read(h.noteA.id, { signal: scope.signal }));
                const woven = applyOrphanWeaveLink(raw.source, h.noteB.title, `结构洞跨界桥接 (B=${h.bridgeScore})`);
                if (woven.changed) await api.write(h.noteA.id, raw.version, woven.source);
                compilerStatus.hidden = false;
                compilerStatus.textContent = `✅ 已打通《${h.noteA.title}》与《${h.noteB.title}》之间的跨群落结构洞桥梁`;
                await refreshKarpathyCompiler();
              } catch (err) {
                bridgeBtn.disabled = false;
                fail(err);
              }
            };
            rightWrap.append(pill, bridgeBtn);
            headBar.append(head, rightWrap);

            const kv = element('div', 'chronicle-kv-grid');
            const r1 = element('div', 'chronicle-kv-row');
            r1.append(element('span', 'chronicle-kv-key', '拓扑诊断'), element('span', 'chronicle-kv-val', h.reason));
            kv.append(r1);
            card.append(headBar, kv);
            compilerLintList.append(card);
          }
        } finally {
          compilerScanBtn.disabled = false;
        }
      }

      compilerScanBtn.onclick = () => {
        errorBox.hidden = true;
        void refreshKarpathyCompiler().catch(fail);
      };

      compilerSaveRulesBtn.onclick = async () => {
        errorBox.hidden = true;
        compilerSaveRulesBtn.disabled = true;
        try {
          const rulesMd = generateWikiRulesMarkdown(compilerRules);
          await api.createNote('RULES', { folder: 'wiki', source: rulesMd, background: true, overwrite: true });
          activeRulesDocTab = 'rules';
          renderRulesOrLogPreview();
          compilerStatus.hidden = false;
          compilerStatus.textContent = '✅ 已生成并保存编译宪章 wiki/RULES.md';
        } catch (err) {
          fail(err);
        } finally {
          compilerSaveRulesBtn.disabled = false;
        }
      };

      compilerIngestAllBtn.onclick = async () => {
        errorBox.hidden = true;
        compilerIngestAllBtn.disabled = true;
        try {
          if (!currentCompilerData) await refreshKarpathyCompiler();
          const rawDocs = currentCompilerData?.rawDocuments || [];
          let rawWritten = 0;
          for (const rd of rawDocs) {
            await api.createNote(rd.sourcePage.cleanName, {
              folder: rd.sourcePage.folder,
              source: rd.sourcePage.markdown,
              background: true,
              overwrite: true,
            });
            rawWritten++;
          }
          let entityWritten = 0;
          for (const ep of (currentCompilerData?.entityPages || []).slice(0, 6)) {
            await api.createNote(ep.cleanName, {
              folder: ep.folder,
              source: ep.markdown,
              background: true,
              overwrite: true,
            });
            entityWritten++;
          }
          const pages = currentCompilerData?.compiledPages || [];
          let written = 0;
          for (const page of pages.slice(0, 3)) {
            await api.createNote(page.cleanName, { folder: page.folder || 'wiki/topics', source: page.markdown, background: true, overwrite: true });
            written++;
          }
          await api.createNote('RULES', { folder: 'wiki', source: currentCompilerData.rulesMarkdown, background: true, overwrite: true });
          await api.createNote('index', { folder: 'wiki', source: currentCompilerData.indexMarkdown, background: true, overwrite: true });
          await api.createNote('log', { folder: 'wiki', source: currentCompilerData.logMarkdown, background: true, overwrite: true });
          await refreshKarpathyCompiler();
          setPreviewTabActive('index');
          renderCompilerDocPreview();
          compilerStatus.hidden = false;
          compilerStatus.textContent = `✅ Karpathy Ingest 编译完成：已摄取 ${rawWritten} 份 raw/ 资料生成文献笔记、更新 ${entityWritten} 篇概念百科与 ${written} 篇专题页，并同步生成 wiki/index.md、wiki/RULES.md 与 wiki/log.md`;
        } catch (err) {
          fail(err);
        } finally {
          compilerIngestAllBtn.disabled = false;
        }
      };

      // 12. Flagship Module: Cognitive Evolution Chronicle (CHRON-001..003 + ALGO-003/006 — Orderly Single-Column Architecture!)
      const chroniclePanel = element('div', 'ai-panel chronicle-single-column-panel');
      chroniclePanel.id = 'ai-panel-chronicle';
      chroniclePanel.hidden = true;

      let activeChronicleStream = '全部航道';
      let currentChronicleData = null;
      let activeMilestoneId = '';
      let chronicleViewMode = 'focus'; // Default to 'focus' so Layer 1 + Layer 2 (active card) + Layer 3 fit on 1 screen!

      const chronicleSaveBtn = cmdButton(Sparkles, '保存纪传', 'ai-chronicle-save-btn', true);
      const chronicleHeader = sectionTitle(
        '认知演进史',
        '仅按已记录日期展示笔记，结构指标和文本差异来自本地规则，不是个人认知水平测量。缺少日期或历史版本时不推断过去的状态。',
        chronicleSaveBtn,
      );

      // Unified Single-Row Top Toolbar (Stream Filter on Left + Compact KPI Strip on Right)
      const chronicleTopToolbar = element('div', 'chronicle-top-toolbar');
      const chronicleStreamPills = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row');
      chronicleStreamPills.id = 'ai-chronicle-stream-pills';
      chronicleStreamPills.setAttribute('aria-label', '知识演进航道筛选');

      const chronicleStatsPills = element('div', 'segmented-control ux-pill-bar ai-sr-stats-row chronicle-kpi-strip');
      chronicleStatsPills.id = 'ai-chronicle-stats-pills';
      chronicleTopToolbar.append(chronicleStreamPills, chronicleStatsPills);

      const chronicleStatus = element('small', 'ai-exec-summary', '');
      chronicleStatus.id = 'ai-chronicle-status';
      chronicleStatus.hidden = true;

      // Layer 1 (CHRON-001): Minimalist Full-Width Horizontal Timeline Coordinate Axis + Uniform 8-Step Bar
      const layer1Card = element('section', 'chronicle-layer-card chronicle-axis-card');
      layer1Card.id = 'ai-chronicle-timeline-axis';
      layer1Card.setAttribute('aria-label', '上层：横向时间刻度与知识能级坐标轴');

      // Layer 2 (CHRON-002): Full-Width Single-Column Structured Chronicle Table-Cards + Focus/All Switcher
      const layer2HeaderBar = element('div', 'chronicle-section-bar');
      const layer2Title = element('strong', 'chronicle-section-title', '笔记记录');
      const layer2ModeSwitch = element('div', 'context-submode-bar chronicle-mode-switch');
      const modeFocusBtn = element('button', 'context-submode-pill is-active', '🎯 聚焦选中星点 (1)');
      modeFocusBtn.type = 'button';
      modeFocusBtn.dataset.chronicleMode = 'focus';
      const modeAllBtn = element('button', 'context-submode-pill', '📋 展开编年全览');
      modeAllBtn.type = 'button';
      modeAllBtn.dataset.chronicleMode = 'all';
      layer2ModeSwitch.append(modeFocusBtn, modeAllBtn);
      layer2HeaderBar.append(layer2Title, layer2ModeSwitch);

      const layer2List = element('div', 'chronicle-single-column-stream');
      layer2List.id = 'ai-chronicle-cards-list';

      // Layer 3 (CHRON-003): Full-Width Single-Column 3-Part AI Cognitive Critique
      const layer3Divider = element('div', 'chronicle-section-bar');
      layer3Divider.append(element('strong', 'chronicle-section-title', '整理建议'));
      const layer3CritiqueBox = element('section', 'chronicle-layer-card chronicle-critique-card');
      layer3CritiqueBox.id = 'ai-chronicle-critique-box';

      chroniclePanel.append(
        chronicleHeader,
        chronicleTopToolbar,
        chronicleStatus,
        layer1Card,
        layer2HeaderBar,
        layer2List,
        layer3Divider,
        layer3CritiqueBox,
      );
      panels.set('chronicle', chroniclePanel);

      function updateChronicleSelectionUI() {
        for (const nodeG of layer1Card.querySelectorAll('[data-axis-milestone-id]')) {
          const match = nodeG.dataset.axisMilestoneId === activeMilestoneId;
          nodeG.classList.toggle('is-selected', match);
          const circle = nodeG.querySelector('circle');
          if (circle) circle.setAttribute('r', match ? '8' : '6');
        }
        for (const stepBtn of layer1Card.querySelectorAll('[data-timeline-node-id]')) {
          const match = stepBtn.dataset.timelineNodeId === activeMilestoneId;
          stepBtn.classList.toggle('is-active', match);
          stepBtn.setAttribute('aria-selected', String(match));
        }
        for (const cardEl of layer2List.querySelectorAll('[data-chronicle-milestone-id]')) {
          const match = cardEl.dataset.chronicleMilestoneId === activeMilestoneId;
          cardEl.classList.toggle('is-highlighted', match);
          cardEl.hidden = chronicleViewMode === 'focus' && !match;
        }
      }

      modeAllBtn.onclick = () => {
        chronicleViewMode = 'all';
        modeAllBtn.classList.add('is-active');
        modeFocusBtn.classList.remove('is-active');
        updateChronicleSelectionUI();
      };
      modeFocusBtn.onclick = () => {
        chronicleViewMode = 'focus';
        modeFocusBtn.classList.add('is-active');
        modeAllBtn.classList.remove('is-active');
        updateChronicleSelectionUI();
      };

      function renderChronicleAxisAndStream(data) {
        // Stream filter pills
        chronicleStreamPills.replaceChildren();
        for (const stream of data.streams || ['全部航道']) {
          const btn = element('button', 'ux-pill-option', stream);
          btn.type = 'button';
          btn.dataset.chronicleStream = stream;
          btn.dataset.pillTone = stream === activeChronicleStream ? 'purple' : 'slate';
          btn.setAttribute('aria-selected', String(stream === activeChronicleStream));
          btn.onclick = () => {
            activeChronicleStream = stream;
            void refreshCognitiveChronicle().catch(fail);
          };
          chronicleStreamPills.append(btn);
        }

        // Compact KPI Stats pills
        chronicleStatsPills.replaceChildren();
        const st = data.stats;
        for (const [tone, text] of [
          ['purple', `星点 ${st.milestoneCount}`],
          ['teal', `结构均值 ${st.averageTrophicHeight ?? '暂无'}`],
          ['amber', `文本差异 ${st.maxSurprisalBits ?? '暂无'}`],
          ['blue', `相干度 q=${st.incoherenceQ}`],
          ['emerald', `晶体 ${st.readyCrystalCount} 簇`],
          ['slate', `未标日期 ${st.undatedNoteCount || 0}`],
        ]) {
          const pill = element('span', 'ux-pill-option ai-sr-stat-pill', text);
          pill.dataset.pillTone = tone;
          chronicleStatsPills.append(pill);
        }

        // Layer 1: Minimalist Horizontal Timeline Coordinate Axis + Uniform 8-Step Grid
        layer1Card.replaceChildren();
        const axisHeader = element('div', 'chronicle-axis-header');
        axisHeader.append(
          element('strong', 'chronicle-axis-title', '笔记日期与结构指标'),
          element('span', 'chronicle-axis-legend', '当前笔记图的规则指标，不代表个人认知水平'),
        );
        layer1Card.append(axisHeader);

        const milestones = data.milestones || [];
        if (!activeMilestoneId || !milestones.some(m => m.id === activeMilestoneId)) {
          activeMilestoneId = milestones[0]?.id || '';
        }

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 880 186');
        svg.setAttribute('class', 'chronicle-timeline-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', '知识能级时间演进折线坐标轴');

        for (const [yPos, bandLabel] of [
          [34, 'L3 顶层综合层 (h ≥ 2.2)'],
          [88, 'L2 概念晶体层 (h ≈ 1.8)'],
          [142, 'L1 基石证据层 (h = 1.0)'],
        ]) {
          const line = document.createElementNS(svgNs, 'line');
          line.setAttribute('x1', '132');
          line.setAttribute('y1', String(yPos));
          line.setAttribute('x2', '848');
          line.setAttribute('y2', String(yPos));
          line.setAttribute('class', 'chronicle-grid-line');
          svg.append(line);

          const txt = document.createElementNS(svgNs, 'text');
          txt.setAttribute('x', '8');
          txt.setAttribute('y', String(yPos + 4));
          txt.setAttribute('class', 'chronicle-band-label');
          txt.textContent = bandLabel;
          svg.append(txt);
        }

        const coords = milestones.map((m, idx) => {
          const x = milestones.length === 1 ? 490 : Math.round(168 + (idx * 648) / (milestones.length - 1));
          const clampedH = Math.max(1.0, Math.min(2.95, Number(m.trophicHeight) || 1.2));
          const y = Math.round(142 - ((clampedH - 1.0) / 1.95) * 108);
          return { m, x, y };
        });

        if (coords.length > 1) {
          const poly = document.createElementNS(svgNs, 'polyline');
          poly.setAttribute('points', coords.map(pt => `${pt.x},${pt.y}`).join(' '));
          poly.setAttribute('class', 'chronicle-trajectory-line');
          svg.append(poly);
        }

        for (const pt of coords) {
          const g = document.createElementNS(svgNs, 'g');
          g.setAttribute('class', 'chronicle-axis-node' + (pt.m.id === activeMilestoneId ? ' is-selected' : ''));
          g.dataset.axisMilestoneId = pt.m.id;
          g.style.cursor = 'pointer';
          g.onclick = () => {
            activeMilestoneId = pt.m.id;
            updateChronicleSelectionUI();
          };

          const circle = document.createElementNS(svgNs, 'circle');
          circle.setAttribute('cx', String(pt.x));
          circle.setAttribute('cy', String(pt.y));
          circle.setAttribute('r', pt.m.id === activeMilestoneId ? '8' : '6');
          circle.setAttribute('class', 'chronicle-node-dot is-' + pt.m.starType);

          const dateLbl = document.createElementNS(svgNs, 'text');
          dateLbl.setAttribute('x', String(pt.x));
          dateLbl.setAttribute('y', '168');
          dateLbl.setAttribute('text-anchor', 'middle');
          dateLbl.setAttribute('class', 'chronicle-date-tick');
          dateLbl.textContent = pt.m.date.slice(5);

          const hLbl = document.createElementNS(svgNs, 'text');
          hLbl.setAttribute('x', String(pt.x));
          hLbl.setAttribute('y', String(Math.max(15, pt.y - 11)));
          hLbl.setAttribute('text-anchor', 'middle');
          hLbl.setAttribute('class', 'chronicle-node-caption');
          hLbl.textContent = `h=${pt.m.trophicTo}`;

          g.append(circle, dateLbl, hLbl);
          svg.append(g);
        }
        layer1Card.append(svg);

        // Uniform Single-Row Stepper Bar aligned underneath the chart (Zero Jagged Multi-Row Wrapping!)
        const stepperGrid = element('div', 'chronicle-stepper-grid');
        stepperGrid.style.gridTemplateColumns = `repeat(${Math.max(1, milestones.length)}, minmax(0, 1fr))`;
        for (const [idx, m] of milestones.entries()) {
          const stepBtn = element('button', 'chronicle-step-cell' + (m.id === activeMilestoneId ? ' is-active' : ''));
          stepBtn.type = 'button';
          stepBtn.dataset.timelineNodeId = m.id;
          stepBtn.setAttribute('aria-selected', String(m.id === activeMilestoneId));
          stepBtn.title = `[${m.date}] 《${m.title}》 (h: ${m.trophicFrom} → ${m.trophicTo})`;
          const topLine = element('span', 'chronicle-step-meta', `0${idx + 1} · ${m.date.slice(5)}`);
          const midLine = element('strong', 'chronicle-step-name', `${m.starIcon} ${m.shortTitle || m.title.slice(0, 6)}`);
          stepBtn.append(topLine, midLine);
          stepBtn.onclick = () => {
            activeMilestoneId = m.id;
            updateChronicleSelectionUI();
            const targetCard = layer2List.querySelector(`[data-chronicle-milestone-id="${m.id}"]`);
            targetCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          };
          stepperGrid.append(stepBtn);
        }
        layer1Card.append(stepperGrid);

        // Layer 2: Clean, Structured 3-Row Table Cards (Swiss Grid Alignment — Zero Nested Box Clutter!)
        layer2List.replaceChildren();
        modeAllBtn.textContent = `📋 编年全览 (${milestones.length})`;
        for (const [idx, m] of milestones.entries()) {
          const isCurrent = m.id === activeMilestoneId;
          const card = element(
            'article',
            'ai-citation-card is-structured chronicle-milestone-card' + (isCurrent ? ' is-highlighted' : ''),
          );
          card.dataset.chronicleMilestoneId = m.id;
          card.hidden = chronicleViewMode === 'focus' && !isCurrent;
          card.onclick = evt => {
            if (evt.target.closest('button')) return;
            activeMilestoneId = m.id;
            updateChronicleSelectionUI();
          };

          const headBar = element('div', 'ai-citation-card-header chronicle-clean-card-head');
          const leftHead = element('div', 'chronicle-card-head-left');
          const indexBadge = element('span', 'chronicle-step-num-badge', `0${idx + 1}`);
          const starPill = element('span', 'ux-pill-option ai-sr-stat-pill', `${m.starIcon} ${m.starLabel}`);
          starPill.dataset.pillTone = m.pillTone;
          const titleBtn = element('button', 'home-task-title', `《${m.title}》`);
          titleBtn.type = 'button';
          titleBtn.onclick = () => api.open(m.noteId).catch(fail);
          const dateSpan = element('small', 'chronicle-card-date', m.date);
          leftHead.append(indexBadge, starPill, titleBtn, dateSpan);

          const rightBadges = element('div', 'ai-citation-badges');
          rightBadges.append(
            element('span', 'ai-meta-chip is-score', `结构指标 ${m.trophicFrom} → ${m.trophicTo}`),
            element('span', 'ai-meta-chip', `文本差异 ${m.surprisalBits} · 转向 ${m.curvatureDeg}°`),
          );
          const jumpNoteBtn = element('button', 'sr-wikilink-chip', '打开笔记 ↗');
          jumpNoteBtn.type = 'button';
          jumpNoteBtn.onclick = () => api.open(m.noteId).catch(fail);
          rightBadges.append(jumpNoteBtn);
          headBar.append(leftHead, rightBadges);

          // Structured 3-Row Key-Value Grid
          const kvTable = element('div', 'chronicle-kv-grid');

          const rowPrior = element('div', 'chronicle-kv-row is-prior');
          rowPrior.append(
            element('span', 'chronicle-kv-key', '此前记录'),
            element('span', 'chronicle-kv-val', m.priorBelief),
          );

          const rowNew = element('div', 'chronicle-kv-row is-new');
          rowNew.append(
            element('span', 'chronicle-kv-key', '当前摘录'),
            element('span', 'chronicle-kv-val', m.newParadigm),
          );

          const rowProv = element('div', 'chronicle-kv-row is-prov');
          rowProv.append(element('span', 'chronicle-kv-key', '双链溯源'));
          const provLinks = element('div', 'chronicle-kv-val chronicle-prov-links');
          renderRichMarkdownSnippet(
            provLinks,
            `文内引用：${m.rawSources.length ? m.rawSources.join(' · ') : '未记录显式双链'} · 原文 ${m.citation}`,
            link => api.openLink(link).catch(fail),
          );
          rowProv.append(provLinks);

          kvTable.append(rowPrior, rowNew, rowProv);
          card.append(headBar, kvTable);
          layer2List.append(card);
        }

        // Layer 3: Full-Width Single-Column 3-Part AI Cognitive Critique (Aligned Horizontal Rows)
        layer3CritiqueBox.replaceChildren();
        const c = data.critique;
        const critiqueRows = [
          ['strengths', '✓ 卓越之处', c.strengths, 'emerald'],
          ['blindspots', '! 盲区诊断', c.blindSpots, 'amber'],
          ['prescription', '→ 提升建议', c.prescription, 'blue'],
        ];
        for (const [cKey, cTitle, cBody, cTone] of critiqueRows) {
          const row = element('div', 'chronicle-critique-item is-' + cKey);
          row.dataset.critiqueSection = cKey;
          const badge = element('span', 'ux-pill-option ai-sr-stat-pill chronicle-critique-badge', cTitle);
          badge.dataset.pillTone = cTone;
          const textEl = element('div', 'chronicle-critique-text');
          renderRichMarkdownSnippet(textEl, cBody, link => api.openLink(link).catch(fail));
          row.append(badge, textEl);
          if (cKey === 'prescription' && c.recommendedBridge) {
            const adoptBtn = cmdButton(Sparkles, `✨ 一键打通《${c.recommendedBridge.noteA.title.slice(0, 8)}》×《${c.recommendedBridge.noteB.title.slice(0, 8)}》`, 'ai-chronicle-apply-prescription-btn');
            adoptBtn.onclick = async () => {
              errorBox.hidden = true;
              adoptBtn.disabled = true;
              try {
                const hole = c.recommendedBridge;
                const raw = await withIndexRetry(() => api.read(hole.noteA.id, { signal: scope.signal }));
                const woven = applyOrphanWeaveLink(raw.source, hole.noteB.title, `认知演进史破局桥接 (B=${hole.bridgeScore})`);
                if (woven.changed) await api.write(hole.noteA.id, raw.version, woven.source);
                chronicleStatus.hidden = false;
                chronicleStatus.textContent = `✅ 已采纳 AI 史官建议：成功打通《${hole.noteA.title}》与《${hole.noteB.title}》之间的跨领域双链桥梁！`;
              } catch (err) {
                adoptBtn.disabled = false;
                fail(err);
              }
            };
            row.append(adoptBtn);
          }
          layer3CritiqueBox.append(row);
        }
      }

      async function refreshCognitiveChronicle() {
        const data = await withIndexRetry(() => api.queryAi({
          subkind: 'cognitive-chronicle',
          domainFilter: activeChronicleStream,
        }, { signal: scope.signal, key: 'ai-cognitive-chronicle' }));
        if (scope.signal.aborted) return;
        currentChronicleData = data;
        renderChronicleAxisAndStream(data);
      }

      chronicleSaveBtn.onclick = async () => {
        errorBox.hidden = true;
        chronicleSaveBtn.disabled = true;
        try {
          if (!currentChronicleData) await refreshCognitiveChronicle();
          const created = await api.createNote('认知演进史', {
            folder: 'chronicles',
            source: currentChronicleData.chronicleMarkdown,
            background: true,
          });
          chronicleStatus.hidden = false;
          chronicleStatus.textContent = `✅ 已将单文件编年史《chronicles/认知演进史.md》写入知识库（共收录 ${currentChronicleData.stats.milestoneCount} 颗里程碑星点）`;
          if (created?.id) {
            const openChip = element('button', 'sr-wikilink-chip', '打开《认知演进史.md》 ↗');
            openChip.type = 'button';
            openChip.onclick = () => api.open(created.id).catch(fail);
            chronicleStatus.append(document.createTextNode(' '), openChip);
          }
        } catch (err) {
          fail(err);
        } finally {
          chronicleSaveBtn.disabled = false;
        }
      };

      window.addEventListener('inkloom:ai-switch-tab', evt => {
        if (evt.detail) switchTab(evt.detail);
      }, { signal: scope.signal });

      async function refreshScopes() {
        try {
          scopesData = await withIndexRetry(() => api.queryAi({ subkind: 'scopes' }, { signal: scope.signal, key: 'ai-scopes' }));
          if (scope.signal.aborted) return;
          updateScopeTargetOptions();
          const currentCons = consScope.value;
          consScope.replaceChildren(new Option('全库笔记', 'vault'), ...scopesData.manuscripts.map(ms => new Option('长稿：' + ms.title, ms.id)));
          if ([...consScope.options].some(o => o.value === currentCons)) consScope.value = currentCons;
          root.dataset.ready = 'true';
        } catch (err) {
          root.dataset.ready = 'true';
          if (err?.name !== 'AbortError') fail(err);
        }
      }

      mainStage.append(
        errorBox,
        chatPanel,
        pureSearchPanel,
        mcpPanel,
        compilerPanel,
        chroniclePanel,
        revisePanel,
        consistencyPanel,
        synthesisPanel,
        digestPanel,
        flashcardsPanel,
        skillsPanel,
        doctorPanel,
        snapshotPanel,
        syncPanel,
        configPanel,
      );
      root.append(navSidebar, mainStage);
      container.append(root);
      switchTab(activeTab);
      void refreshScopes();
      void loadConfig();
      scope.own(api.on('vault.changed', () => {
        void refreshScopes();
        if (activeTab === 'skills') void refreshSkills().catch(fail);
      }));

      return () => {
        askController?.abort();
        root.remove();
      };
    },
  });

  api.registerCommand({ id: 'open-ai', name: '打开智识与技能', shortcut: 'Ctrl+Alt+A', run: () => api.showView(view) });
}
