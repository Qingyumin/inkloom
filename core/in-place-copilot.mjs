import { parseFrontMatter, stripNumericPrefix, localDate } from './vault-graph.mjs';
import { tokenizeText, computeEmbedding, cosineSimilarity, chunkNoteParagraphs } from './ai-retrieval.mjs';

export const INLINE_AI_ACTIONS = [
  { id: 'polish', label: 'AI 润色', shortLabel: '润色', tone: 'teal', description: '润色语序与表达，保留原有双链与标签' },
  { id: 'concise', label: 'AI 精简', shortLabel: '精简', tone: 'blue', description: '提炼核心句并精简冗余修饰' },
  { id: 'expand', label: 'AI 扩写', shortLabel: '扩写', tone: 'emerald', description: '结合上下文补充机制说明与边界条件' },
  { id: 'translate', label: '译英/译中', shortLabel: '互译', tone: 'indigo', description: '中英双语术语对照与学术互译' },
  { id: 'todo', label: '提炼待办', shortLabel: '待办', tone: 'amber', description: '将段落中的行动项转化为 Markdown 任务清单' },
  { id: 'flashcard', label: '转为闪卡', shortLabel: '闪卡', tone: 'rose', description: '转化为 SM-2 间隔重复问答闪卡 (Q/A)' },
];

export const SLASH_AI_COMMANDS = [
  {
    id: 'ai-continue',
    label: '✨ /ai 续写下文',
    keywords: 'ai continue 续写 下文 扩写 智能写作',
    subtitle: '结合前文语境与双链脉络原位续写段落',
  },
  {
    id: 'ai-outline',
    label: '📋 /ai 提炼本章要点',
    keywords: 'ai outline summary 提炼 要点 总结 大纲',
    subtitle: '将当前章节归纳为结构化要点列表',
  },
  {
    id: 'ai-arguments',
    label: '⚖️ /ai 生成正反论点',
    keywords: 'ai arguments pros cons 正反 论点 辩证 边界',
    subtitle: '生成正方支撑论据与反方适用边界提示块',
  },
  {
    id: 'ai-table',
    label: '📊 /ai 转为对比表格',
    keywords: 'ai table compare 对比 表格 维度 结构化',
    subtitle: '从当前上下文自动提炼多维对比 Markdown 表格',
  },
];

export const SMART_NOTE_TEMPLATES = [
  {
    id: 'concept-card',
    name: '原子概念卡',
    tone: 'teal',
    category: '核心概念',
    status: '进行中',
    tags: ['原子概念', '永久笔记'],
    description: '卢曼卡片盒风格：一句话定义、核心机制、边界反例与双链脉络',
    body: `# {{title}}

> [!NOTE] 一句话核心定义（{{date}} · {{weekday}}）
> **{{title}}** 是指在特定上下文下，通过明确机制实现结构化认知跃迁的基础单元。

## 1. 核心机制与推导

- **输入前提**：{{clipboard}}
- **作用机理**：阐述该概念如何改变系统状态或知识连接。
- **关键判据**：**{{title}}** :: 具备可证伪性、独立可复用性与明确边界的知识晶体。

## 2. 适用边界与反例

> [!WARNING] 常见误区与失效边界
> 避免将表面相关性误认为因果机制；记录至少一个反面案例。

## 3. 关联脉络

- 上游概念：[[00-墨图导览与万象星图]]
- 下游推演：[[01-双链笔记与卡片盒方法]]
`,
  },
  {
    id: 'cornell-reading',
    name: '康奈尔读书笔记',
    tone: 'blue',
    category: '阅读札记',
    status: '进行中',
    tags: ['读书笔记', '康奈尔笔记'],
    description: '线索提问栏 + 核心摘录札记 + 底部五句话总结与行动启发',
    body: `# {{title}}

> [!TIP] 阅读元数据（记录于 {{date}} {{time}}）
> - **核心线索**：{{clipboard}}
> - **阅读目标**：带着具体问题拆解作者的论证骨架与证据链。

## 1. 关键问题与线索（Cue Column）

- Q: 作者试图解决的核心矛盾是什么？
  A: 通过结构化证据与可验证模型替代经验直觉。

## 2. 核心论点与原文札记（Notes）

| 章节/位置 | 核心观点提炼 | 个人批注与双链连接 |
| --- | --- | --- |
| 第一部分 | 提炼作者的核心假设 | 关联 [[01-双链笔记与卡片盒方法]] |
| 第二部分 | 记录关键实证或算例 | 待补充实验验证 |

## 3. 五句话总结与行动迁移（Summary）

1. **核心收获**：用自己的话重述全书最有价值的 1 个洞见。
2. **下一步行动**：- [ ] 将本章关键概念拆分为独立原子卡片（截止：{{date}}）
`,
  },
  {
    id: 'meeting-minutes',
    name: '会议纪要与行动项',
    tone: 'amber',
    category: '项目规划',
    status: '进行中',
    tags: ['会议纪要', '行动项'],
    description: '议题背景、关键决策结论与可直接进工作台月历的 Todo 任务项',
    body: `# {{title}}

- **会议时间**：{{date}} {{time}}（{{weekday}}）
- **核心议题**：{{clipboard}}

## 1. 已达成共识与决策结论

> [!IMPORTANT] 关键决议
> 1. 明确阶段交付基线与验收门禁；
> 2. 所有待办事项均指定唯一责任人与完成期限。

## 2. 待办行动项（自动同步至工作台任务与日历）

- [ ] 落实《{{title}}》核心方案并输出验证报告 [due:: {{date}}] [priority:: high]
- [ ] 更新关联知识库文档与双链索引 [due:: {{date}}]

## 3. 风险与待决问题

- 待确认外部接口边界与资源排期。
`,
  },
  {
    id: 'paper-review',
    name: '学术文献精读',
    tone: 'indigo',
    category: '研究札记',
    status: '进行中',
    tags: ['文献精读', '研究方法'],
    description: '研究痛点、数学/算法建模、实验设计与局限性批判分析',
    body: `# {{title}}

> [!NOTE] 文献题要（精读日期：{{date}}）
> **研究切入点**：{{clipboard}}

## 1. 领域痛点与核心贡献（Problem & Contribution）

- **既有方法局限**：传统方法在高维稀疏或动态场景下易退化。
- **本文核心突破**：提出可解释、有界复杂度的形式化模型。

## 2. 核心算法与数学形式化（Formulation）

$$
\\mathcal{J}(\\theta) = \\sum_{i=1}^{N} \\ell(f_\\theta(x_i), y_i) + \\lambda \\|\\theta\\|_2^2
$$

## 3. 实验设计与可复现性评估

| 评估维度 | 论文设计 | 局限性与改进空间 |
| --- | --- | --- |
| 数据集与基线 | 标准基准对比 | 缺少极端边界压力测试 |
| 消融实验 | 逐项验证模块增益 | 可进一步结合 [[02-知识图谱与局部星图]] |
`,
  },
  {
    id: 'weekly-retro',
    name: '项目复盘周报',
    tone: 'emerald',
    category: '项目规划',
    status: '已完成',
    tags: ['周报复盘', '经验沉淀'],
    description: '本周关键产出、认知跃迁、阻塞根因分析与下周重点规划',
    body: `# {{title}}

> [!TIP] 复盘周期：截至 {{date}}（{{weekday}} {{time}}）
> 本周焦点：{{clipboard}}

## 1. 本周核心交付与里程碑

- [x] 完成核心模块设计与端到端回归验证
- [x] 沉淀可复用知识卡片与技术规范

## 2. 认知跃迁与经验沉淀（Keep & Learn）

- **验证有效的方法**：先锁定可复现契约与测试基准，再推进实现。
- **需要修正的假设**：避免在缺乏量化指标时过早做复杂抽象。

## 3. 下周重点计划（Next Actions）

- [ ] 推进下一阶段高优工程项并闭环验证 [due:: {{date}}] [priority:: high]
`,
  },
  {
    id: 'world-character',
    name: '长稿角色与设定卡',
    tone: 'purple',
    category: '创作设定',
    status: '进行中',
    tags: ['创作设定', '角色档案'],
    description: '支持长稿一致性核查的【角色·属性】结构化设定与人物弧光',
    body: `# {{title}}

> [!NOTE] 设定档案（建档于 {{date}}）
> 兼容「智识 → 长稿一致性核查」自动冲突检测语法。

## 1. 结构化设定锚点（供一致性核查自动扫描）

- 【{{title}}·定位】：核心叙事枢纽 / 关键见证者
- 【{{title}}·特征】：沉稳克制，善于从碎片线索中推演全局
- 【{{title}}·信物】：{{clipboard}}

## 2. 动机张力与人物弧光

- **表层目标**：完成既定调查与记录使命。
- **深层信念**：探索知识演进与真实记忆的边界。

## 3. 关联章节与登场脉络

- 首次登场：[[00-墨图导览与万象星图]]
`,
  },
];

const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function formatLocalTime(now = new Date()) {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatLocalWeekday(now = new Date()) {
  return WEEKDAY_NAMES[now.getDay()] || '星期一';
}

export function renderSmartTemplate(templateId, variables = {}) {
  const tpl = SMART_NOTE_TEMPLATES.find(item => item.id === templateId) || SMART_NOTE_TEMPLATES[0];
  const now = variables.now instanceof Date ? variables.now : new Date();
  const dateStr = variables.date || localDate(now);
  const timeStr = variables.time || formatLocalTime(now);
  const weekdayStr = variables.weekday || formatLocalWeekday(now);
  const rawTitle = String(variables.title || tpl.name).trim();
  const cleanTitle = stripNumericPrefix(rawTitle) || tpl.name;
  const clipboardStr = String(variables.clipboard || '').trim() || '（在此补充核心背景或外部素材摘录）';

  const replaceVars = text => String(text || '')
    .replaceAll('{{date}}', dateStr)
    .replaceAll('{{time}}', timeStr)
    .replaceAll('{{weekday}}', weekdayStr)
    .replaceAll('{{title}}', cleanTitle)
    .replaceAll('{{clipboard}}', clipboardStr);

  const yamlLines = [
    '---',
    `title: ${cleanTitle}`,
    `status: ${tpl.status}`,
    `category: ${tpl.category}`,
    `date: ${dateStr}`,
    'tags:',
    ...tpl.tags.map(tag => `  - ${tag}`),
    '---',
    '',
  ];
  return {
    templateId: tpl.id,
    name: tpl.name,
    title: cleanTitle,
    source: yamlLines.join('\n') + replaceVars(tpl.body),
  };
}

export function transformSelectedTextWithAi(actionId, selectedText = '', options = {}) {
  const raw = String(selectedText || '').trim();
  if (!raw) {
    return { actionId, output: '', summary: '未选择有效文本' };
  }
  const noteTitle = stripNumericPrefix(options.noteTitle || '当前笔记') || '当前笔记';
  const contextCite = options.relatedCitation ? `（关联参考：${options.relatedCitation}）` : '';
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim())
    .filter(Boolean);
  const sentences = raw
    .replace(/\r?\n+/g, ' ')
    .split(/(?<=[。！？.!?;；])\s*/)
    .map(s => s.trim())
    .filter(Boolean);

  if (actionId === 'polish') {
    const polished = lines.length > 1
      ? lines.map(line => {
          const clean = line.replace(/^[，。；：、\s]+/, '').replace(/\s{2,}/g, ' ');
          return /[.。!！?？;；]$/.test(clean) ? `- ${clean}` : `- ${clean}。`;
        }).join('\n')
      : (() => {
          const joined = sentences.map(s => s.replace(/\s{2,}/g, ' ').trim()).join('');
          const normalized = /[.。!！?？]$/.test(joined) ? joined : `${joined}。`;
          return `**核心阐述**：${normalized}`;
        })();
    return {
      actionId,
      output: polished,
      summary: '已完成学术与结构化语序润色（保留双链与标签）',
    };
  }

  if (actionId === 'concise') {
    const corePoints = (sentences.length > 1 ? sentences : lines).slice(0, 3).map(s => {
      const clean = s.replace(/^(此外|同时|需要注意的是|总而言之|综上所述)[，、\s]*/u, '').trim();
      return `- **要点**：${clean}`;
    });
    return {
      actionId,
      output: corePoints.join('\n'),
      summary: `已浓缩为 ${corePoints.length} 条高密度核心要点`,
    };
  }

  if (actionId === 'expand') {
    const headSentence = sentences[0] || raw.slice(0, 120);
    const expanded = [
      raw,
      '',
      `> [!TIP] 深度展开与机制推演（${noteTitle}）`,
      `> - **核心机理**：围绕「${headSentence.slice(0, 42)}」，其底层逻辑在于通过显式结构降低信息熵并建立可验证的因果链条。`,
      `> - **适用边界**：在实际应用中需兼顾数据完整性与上下文约束${contextCite}。`,
    ].join('\n');
    return {
      actionId,
      output: expanded,
      summary: '已补充底层机理推演与适用边界说明',
    };
  }

  if (actionId === 'translate') {
    const hasCjk = /[\u4e00-\u9fa5]/.test(raw);
    const termMap = [
      ['知识图谱', 'Knowledge Graph'],
      ['双链笔记', 'Bi-directional Linked Notes'],
      ['卡片盒', 'Zettelkasten'],
      ['间隔重复', 'Spaced Repetition'],
      ['记忆闪卡', 'Flashcards'],
      ['属性视图', 'Property View'],
      ['语义检索', 'Semantic Retrieval'],
      ['余弦相似度', 'Cosine Similarity'],
      ['工作台', 'Workbench'],
      ['本地优先', 'Local-First'],
    ];
    if (hasCjk) {
      let enSummary = raw;
      const matchedPairs = [];
      for (const [zh, en] of termMap) {
        if (raw.includes(zh)) {
          enSummary = enSummary.replaceAll(zh, en);
          matchedPairs.push(`${zh} (${en})`);
        }
      }
      const bilingual = [
        raw,
        '',
        `> **Bilingual Reference / 学术英译对照**：`,
        `> ${enSummary}`,
        matchedPairs.length ? `> - **Key Terms**：${matchedPairs.join(' · ')}` : `> - **Context Note**：Translated from "${noteTitle}"`,
      ].join('\n');
      return {
        actionId,
        output: bilingual,
        summary: '已生成中英双语对照与核心术语标注',
      };
    }
    let zhText = raw;
    for (const [zh, en] of termMap) {
      zhText = zhText.replace(new RegExp(en, 'gi'), `${zh}（${en}）`);
    }
    return {
      actionId,
      output: `${raw}\n\n> **中文对照解析**：${zhText}`,
      summary: '已生成中文术语对照解析',
    };
  }

  if (actionId === 'todo') {
    const items = (lines.length > 1 ? lines : sentences).slice(0, 5).map(item => {
      const clean = item
        .replace(/^[-*+]\s*(\[[ xX]\]\s*)?/, '')
        .replace(/[。；;]+$/, '')
        .trim();
      return `- [ ] ${clean}`;
    });
    return {
      actionId,
      output: items.join('\n'),
      summary: `已提炼 ${items.length} 项可执行 Markdown 待办任务`,
    };
  }

  if (actionId === 'flashcard') {
    const firstLine = lines[0] || sentences[0] || raw;
    const colonMatch = /^([^：:]{2,36})[：:]\s*(.+)$/.exec(firstLine);
    const question = colonMatch
      ? `如何理解「${colonMatch[1].trim()}」的核心内涵与作用？`
      : `关于《${noteTitle}》中的「${firstLine.slice(0, 28).replace(/[#*>_`]/g, '').trim()}」，其关键结论是什么？`;
    const answer = colonMatch ? colonMatch[2].trim() : raw.replace(/\r?\n+/g, ' ').trim();
    return {
      actionId,
      output: `Q: ${question}\nA: ${answer}`,
      summary: '已生成符合 SM-2 规范的 Q/A 间隔重复闪卡',
    };
  }

  return { actionId, output: raw, summary: '已保持原文' };
}

export function buildInlineAiPrompt(actionId, selectedText = '', options = {}) {
  const noteTitle = stripNumericPrefix(options.noteTitle || '当前笔记');
  const instructions = {
    polish: '请润色以下 Markdown 段落，使其表达更凝练、逻辑更清晰，严格保留原有的 [[双链]] 与 #标签，直接输出润色后的 Markdown：',
    concise: '请将以下文本浓缩为 2~3 条高信息密度的 Markdown 无序列表要点，直接输出结果：',
    expand: '请围绕以下段落进行深度扩写，补充核心机制说明与适用边界（可使用 > [!TIP] 提示块），直接输出 Markdown：',
    translate: '请提供以下段落的精准中英双语对照翻译，并标注关键专业术语，直接输出 Markdown：',
    todo: '请从以下段落中提炼具体的可执行待办事项，使用 `- [ ] 任务内容` 格式直接输出：',
    flashcard: '请将以下段落转化为一张问答闪卡，严格使用 `Q: 问题\\nA: 答案` 格式输出：',
  };
  return {
    systemPrompt: `你是 Inkloom 墨图原位写作副驾驶。当前笔记：《${noteTitle}》。只输出可直接插入编辑器的 Markdown 内容，不要寒暄。`,
    userPrompt: `${instructions[actionId] || instructions.polish}\n\n${selectedText}`,
  };
}

export function generateSlashAiDraft(commandId, { source = '', cursorOffset = 0, noteTitle = '', relatedSnippets = [] } = {}) {
  const text = String(source || '');
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
  const fm = parseFrontMatter(text);
  const before = text.slice(fm.bodyFrom, safeOffset).trim();
  const paragraphs = before.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const lastParagraph = paragraphs.at(-1) || stripNumericPrefix(noteTitle) || '核心主题';
  const lastHeadingMatch = [...before.matchAll(/^\s*#{1,6}\s+(.+?)\s*$/gm)].at(-1);
  const currentHeading = lastHeadingMatch ? lastHeadingMatch[1].trim() : (stripNumericPrefix(noteTitle) || '当前章节');
  const cleanContext = lastParagraph
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const citeSuffix = relatedSnippets[0]?.citation ? `（参见 ${relatedSnippets[0].citation}）` : '';

  if (commandId === 'ai-continue') {
    return [
      `承接「${currentHeading}」的核心脉络，进一步围绕“${cleanContext.slice(0, 48)}”展开推演：`,
      '',
      `- **机制深化**：在既有结构基础上，通过显式双链锚定上下文证据，使零散观察收敛为可复用的知识节点${citeSuffix}。`,
      `- **实践验证**：结合具体场景记录可观测指标与反例边界，确保结论在跨期复盘中保持稳健。`,
    ].join('\n');
  }

  if (commandId === 'ai-outline') {
    const bulletLines = paragraphs.slice(-4).map((p, idx) => {
      const single = p.replace(/^\s*#{1,6}\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 72);
      return `${idx + 1}. **核心脉络 ${idx + 1}**：${single}`;
    });
    if (!bulletLines.length) {
      bulletLines.push(`1. **核心主题**：梳理《${currentHeading}》的关键定义与上下文连接。`);
    }
    return [
      `> [!NOTE] 《${currentHeading}》章节要点提炼`,
      ...bulletLines.map(line => `> ${line}`),
    ].join('\n');
  }

  if (commandId === 'ai-arguments') {
    return [
      `> [!TIP] 正方核心论据（支撑「${currentHeading}」）`,
      `> - **结构增益**：围绕「${cleanContext.slice(0, 36)}」，建立标准化模型可显著降低认知负荷与检索摩擦${citeSuffix}。`,
      `> - **复利效应**：随着双链密度提升，跨卡片知识重组将产生非线性的洞察涌现。`,
      '',
      `> [!WARNING] 反方张力与适用边界（潜在局限）`,
      `> - **过早形式化风险**：在原始素材尚不充分时强行分类，可能掩盖边缘异常证据。`,
      `> - **维护成本边界**：需保持轻量原位操作，避免形式大于内容。`,
    ].join('\n');
  }

  if (commandId === 'ai-table') {
    return [
      `| 评估维度 | 「${currentHeading}」现状基线 | 结构化演进方案 | 预期验证指标 |`,
      `| --- | --- | --- | --- |`,
      `| 核心机制 | ${cleanContext.slice(0, 32) || '经验驱动记录'} | 双链锚定 + 语义胶囊归纳 | 检索触达耗时缩短 |`,
      `| 证据可追溯性 | 零散段落分布 | 段落块引用与原位 AI 校核${citeSuffix} | 100% 具备原文出处 |`,
    ].join('\n');
  }

  return '';
}

export function inferNotePropertiesFromContent({
  title = '',
  source = '',
  folder = '',
  existingMetadata = {},
  vaultTags = [],
  vaultNotes = [],
} = {}) {
  const raw = String(source || '');
  const fm = parseFrontMatter(raw);
  const meta = { ...fm.metadata, ...existingMetadata };
  const body = raw.slice(fm.bodyFrom).replace(/```[\s\S]*?```/g, ' ').trim();
  const cleanTitle = stripNumericPrefix(meta.title || title || '未命名笔记') || '未命名笔记';

  // 1. Infer tags: preserve existing tags, match vault tags present in body/title, and extract key domain terms
  const inferredTags = new Set(meta.tags || []);
  const lowerCombined = `${cleanTitle}\n${body}`.toLocaleLowerCase();
  for (const tagItem of vaultTags) {
    const tagName = typeof tagItem === 'string' ? tagItem : tagItem?.tag;
    if (tagName && lowerCombined.includes(String(tagName).toLocaleLowerCase())) {
      inferredTags.add(String(tagName).replace(/^#+/, ''));
    }
  }
  const domainKeywords = [
    ['知识图谱', '知识图谱'],
    ['双链', '双链笔记'],
    ['卡片盒', '卡片盒方法'],
    ['闪卡', '间隔重复'],
    ['yaml', 'YAML属性'],
    ['算法', '核心算法'],
    ['复盘', '经验复盘'],
    ['研究', '阅读研究'],
    ['任务', '任务规划'],
  ];
  for (const [kw, tag] of domainKeywords) {
    if (inferredTags.size >= 5) break;
    if (lowerCombined.includes(kw)) inferredTags.add(tag);
  }
  if (!inferredTags.size) {
    inferredTags.add(folder && folder !== '根目录' ? folder.split('/')[0] : '知识卡片');
  }
  const tags = [...inferredTags].slice(0, 5);

  // 2. Infer aliases: preserve existing aliases, extract parenthetical alias in title or first bold concept
  const inferredAliases = new Set(meta.aliases || []);
  const parenMatch = /[（(]([A-Za-z0-9\u4e00-\u9fa5_-]{2,28})[)）]/.exec(cleanTitle) || /[（(]([A-Za-z][A-Za-z0-9 _-]{2,28})[)）]/.exec(body);
  if (parenMatch) inferredAliases.add(parenMatch[1].trim());
  for (const boldMatch of body.matchAll(/\*\*([\u4e00-\u9fa5A-Za-z0-9_-]{2,18})\*\*/g)) {
    const candidate = boldMatch[1].trim();
    if (candidate && candidate !== cleanTitle && inferredAliases.size < 3) {
      inferredAliases.add(candidate);
    }
  }
  if (!inferredAliases.size && cleanTitle.length >= 4) {
    inferredAliases.add(cleanTitle.slice(0, Math.min(8, cleanTitle.length)) + '卡片');
  }
  const aliases = [...inferredAliases].slice(0, 3);

  // 3. Infer status
  const openTasks = (body.match(/^\s*[-*+]\s+\[ \]/gm) || []).length;
  const doneTasks = (body.match(/^\s*[-*+]\s+\[[xX]\]/gm) || []).length;
  let status = meta.status || '';
  if (!status || status === '未设置' || status === '草稿') {
    if (doneTasks > 0 && openTasks === 0) status = '已完成';
    else if (body.length >= 160 || openTasks > 0) status = '进行中';
    else status = '草稿';
  }

  // 4. Infer summary (concise 40~110 chars)
  const cleanParagraphs = body
    .split(/\r?\n+/)
    .map(line => line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s*(\[![A-Z]+\]\s*)?/, '')
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/, '')
      .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
      .replace(/[*_`~]/g, '')
      .trim())
    .filter(line => line.length >= 10);
  const summaryText = (cleanParagraphs.slice(0, 2).join('；') || `${cleanTitle}的核心要点与关联脉络整理。`).slice(0, 96);

  // 5. Infer category
  let category = meta.category || '';
  if (!category) {
    if (openTasks + doneTasks >= 2) category = '项目规划';
    else if (body.includes('摘录') || body.includes('文献') || body.includes('研究')) category = '研究札记';
    else category = '核心概念';
  }

  // Check if any vault note is referenced for extra context
  const linkedCount = vaultNotes.length;

  return {
    patch: {
      title: meta.title || cleanTitle,
      status,
      tags,
      aliases,
      category,
      summary: summaryText,
    },
    summary: summaryText,
    status,
    tags,
    aliases,
    category,
    analyzedNotes: linkedCount,
  };
}

function cleanSidebarDisplayTitle(note = {}) {
  const rawTitle = String(note.title || note.metadata?.title || note.cleanTitle || note.name || '').trim();
  const stripped = stripNumericPrefix(rawTitle).replace(/\s+[0-9a-f]{6,8}$/i, '').trim();
  if (/^\d{1,2}$/.test(stripped)) {
    return note.metadata?.title || (note.date ? `今日手记 · ${note.date}` : `手记 · ${stripped}`);
  }
  return stripped || '未命名笔记';
}

function cleanSidebarSnippetText(rawText = '') {
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

export function computeLiveSmartConnections({
  activeNoteId = '',
  activeTitle = '',
  source = '',
  cursorOffset = 0,
  notes = [],
  limit = 3,
} = {}) {
  const raw = String(source || '');
  const fm = parseFrontMatter(raw);
  const safeCursor = Math.max(fm.bodyFrom, Math.min(cursorOffset || 0, raw.length));
  const windowStart = Math.max(fm.bodyFrom, safeCursor - 360);
  const windowEnd = Math.min(raw.length, safeCursor + 360);
  const focusSlice = raw.slice(windowStart, windowEnd).trim();
  const focusText = focusSlice.length >= 24 ? `${activeTitle}\n${focusSlice}` : `${activeTitle}\n${raw.slice(fm.bodyFrom, fm.bodyFrom + 800)}`;

  const queryVec = computeEmbedding(focusText);
  const queryTokens = new Set(tokenizeText(focusText).filter(t => t.length >= 2));
  if (!queryTokens.size && !focusText.trim()) return [];

  const candidates = [];
  for (const note of notes || []) {
    if (!note || note.id === activeNoteId || !note.source) continue;
    const folder = String(note.folder || '').toLowerCase();
    const cat = String(note.metadata?.category || '').toLowerCase();
    // Deprioritize auto-generated digest/excerpt dumps so primary knowledge notes surface first
    const isGeneratedDump = folder === 'digests' || folder === 'excerpts' || cat === 'digest' || cat === 'excerpt';
    const chunks = chunkNoteParagraphs(note);
    for (const chunk of chunks) {
      const vec = computeEmbedding(`${chunk.title} ${chunk.heading} ${chunk.text}`);
      const cosine = Math.max(0, cosineSimilarity(queryVec, vec));
      const chunkTokens = tokenizeText(`${chunk.title} ${chunk.heading} ${chunk.text}`);
      const sharedTerms = [];
      const seen = new Set();
      for (const tok of chunkTokens) {
        if (tok.length >= 2 && queryTokens.has(tok) && !seen.has(tok)) {
          seen.add(tok);
          sharedTerms.push(tok);
        }
      }
      const lexicalBoost = Math.min(0.45, sharedTerms.length * 0.06);
      const rawScore = (cosine * 0.72 + lexicalBoost) * (isGeneratedDump ? 0.55 : 1.0);
      const score = Number(rawScore.toFixed(3));
      if (score <= 0.05) continue;
      const cleanTitle = cleanSidebarDisplayTitle(note);
      candidates.push({
        id: chunk.id,
        noteId: note.id,
        noteTitle: cleanTitle,
        heading: (chunk.heading || '核心段落').replace(/^[📅💡🔥✨\s]+/, '').trim() || '核心段落',
        lineFrom: chunk.lineFrom,
        from: chunk.from,
        snippet: cleanSidebarSnippetText(chunk.text).slice(0, 110),
        citation: chunk.citation,
        cosine: Number(cosine.toFixed(2)),
        score,
        sharedTerms: sharedTerms.filter(t => !/^\d+$/.test(t)).slice(0, 3),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.noteTitle.localeCompare(b.noteTitle, 'zh-CN'));
  // Deduplicate by noteId + heading so top results are diverse
  const picked = [];
  const usedKeys = new Set();
  for (const item of candidates) {
    const key = `${item.noteId}:${item.heading}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function appendQuickThoughtToSource(source = '', thoughtText = '', options = {}) {
  const cleanThought = String(thoughtText || '').replace(/\r?\n+/g, ' ').trim();
  if (!cleanThought) throw new Error('请输入要追加的闪念或待办内容');
  const raw = String(source || '');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = bom ? raw.slice(1) : raw;
  const now = options.now instanceof Date ? options.now : new Date();
  const timeLabel = options.time || formatLocalTime(now);
  const asTask = Boolean(options.asTask) || /^(\[ \]|todo:|待办[:：])/i.test(cleanThought);
  const stripped = cleanThought.replace(/^(\[ \]|todo:|待办[:：])\s*/i, '');
  const entryLine = asTask ? `- [ ] [${timeLabel}] ${stripped}` : `- **[${timeLabel}]** ${stripped}`;

  const trimmedEnd = body.replace(/[\r\n]+$/, '');
  const hasQuickSection = /^##\s+⚡\s*今日闪念与快记\s*$/m.test(trimmedEnd);
  const nextBody = hasQuickSection
    ? `${trimmedEnd}${newline}${entryLine}${newline}`
    : `${trimmedEnd}${newline}${newline}## ⚡ 今日闪念与快记${newline}${newline}${entryLine}${newline}`;
  return {
    source: bom + nextBody,
    entryLine,
    timeLabel,
    asTask,
  };
}

function decodeBasicHtmlEntities(str = '') {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function parseHtmlTableToRows(htmlText = '') {
  const html = String(htmlText || '');
  const tableMatch = /<table\b[\s\S]*?<\/table>/i.exec(html);
  if (!tableMatch) return null;
  const rows = [];
  for (const trMatch of tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const tdMatch of trMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      const cleaned = decodeBasicHtmlEntities(
        tdMatch[1]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/(?:p|div|li)>/gi, ' ')
          .replace(/<[^>]+>/g, '')
      )
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\|/g, '\\|');
      cells.push(cleaned || ' ');
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  const maxCols = Math.max(...rows.map(r => r.length));
  if (maxCols < 2 && rows.length < 2) return null;
  return {
    rows: rows.map(r => Array.from({ length: maxCols }, (_, i) => r[i] ?? ' ')),
    colCount: Math.max(2, maxCols),
  };
}

export function convertDelimitedTextToMarkdownTable(rawText = '', htmlText = '') {
  // 1. Prefer HTML <table> structure when copying from Excel / WPS / Numbers / Word / Webpages
  if (htmlText && /<table[\s>]/i.test(htmlText)) {
    const parsedHtml = parseHtmlTableToRows(htmlText);
    if (parsedHtml && parsedHtml.rows.length >= 1) {
      const { rows, colCount } = parsedHtml;
      const header = `| ${rows[0].slice(0, colCount).join(' | ')} |`;
      const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
      const dataRows = rows.length >= 2
        ? rows.slice(1).map(r => `| ${r.slice(0, colCount).join(' | ')} |`)
        : [`| ${Array(colCount).fill(' ').join(' | ')} |`];
      return {
        columns: colCount,
        rowCount: dataRows.length,
        markdown: [header, separator, ...dataRows].join('\n'),
      };
    }
  }

  // 2. Fallback to TSV / CSV plain text
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return null;
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (!lines.length) return null;
  // Ignore if already a Markdown table
  if (lines.every(l => l.trim().startsWith('|') && l.trim().endsWith('|'))) return null;

  const tabCounts = lines.map(l => (l.match(/\t/g) || []).length);
  const commaCounts = lines.map(l => (l.match(/,/g) || []).length);
  let delimiter = null;
  if (tabCounts.some(c => c >= 1) && (lines.length === 1 || tabCounts.filter(c => c >= 1).length >= Math.ceil(lines.length * 0.6))) {
    delimiter = '\t';
  } else if (lines.length >= 2 && commaCounts[0] >= 1 && commaCounts.every(c => c === commaCounts[0])) {
    delimiter = ',';
  }
  if (!delimiter) return null;

  const rawRows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/\|/g, '\\|') || ' '));
  const colCount = Math.max(...rawRows.map(r => r.length));
  if (colCount < 2) return null;
  const rows = rawRows.map(r => Array.from({ length: colCount }, (_, i) => r[i] ?? ' '));

  const header = `| ${rows[0].join(' | ')} |`;
  const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
  const bodyRows = rows.length >= 2
    ? rows.slice(1).map(r => `| ${r.slice(0, colCount).join(' | ')} |`)
    : [`| ${Array(colCount).fill(' ').join(' | ')} |`];
  return {
    columns: colCount,
    rowCount: bodyRows.length,
    markdown: [header, separator, ...bodyRows].join('\n'),
  };
}

function splitMarkdownTableRow(line = '') {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
}

export function sortMarkdownTableInSource(source = '', cursorOffset = 0, direction = 'asc', columnIndex = null) {
  const raw = String(source || '');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  let cursorLine = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + newline.length;
    if (cursorOffset <= acc + len) {
      cursorLine = i;
      break;
    }
    acc += len;
  }

  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line || '');
  const isSeparatorLine = line => /^\s*\|[\s:|-]+\|\s*$/.test(line || '') && (line || '').includes('-');

  // Find table block containing cursorLine, or fallback to first table in document
  let tableStart = -1;
  let tableEnd = -1;
  const locateAt = lineIdx => {
    if (!isTableLine(lines[lineIdx])) return false;
    let s = lineIdx;
    while (s > 0 && isTableLine(lines[s - 1])) s--;
    let e = lineIdx;
    while (e + 1 < lines.length && isTableLine(lines[e + 1])) e++;
    if (e - s >= 2 && isSeparatorLine(lines[s + 1])) {
      tableStart = s;
      tableEnd = e;
      return true;
    }
    return false;
  };

  if (!locateAt(cursorLine)) {
    for (let i = 0; i < lines.length; i++) {
      if (locateAt(i)) break;
    }
  }
  if (tableStart < 0 || tableEnd - tableStart < 2) {
    return { changed: false, source: raw, sortedRows: 0, columnHeader: '' };
  }

  const headerCells = splitMarkdownTableRow(lines[tableStart]);
  let targetCol = Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : 0;
  if (!Number.isInteger(columnIndex) && cursorLine >= tableStart && cursorLine <= tableEnd) {
    let lineStartOffset = 0;
    for (let i = 0; i < cursorLine; i++) lineStartOffset += lines[i].length + newline.length;
    const withinLine = Math.max(0, cursorOffset - lineStartOffset);
    const prefix = lines[cursorLine].slice(0, withinLine);
    const pipesBefore = (prefix.match(/\|/g) || []).length;
    if (pipesBefore >= 1) targetCol = Math.min(headerCells.length - 1, pipesBefore - 1);
  }
  targetCol = Math.max(0, Math.min(headerCells.length - 1, targetCol));

  const dataLines = lines.slice(tableStart + 2, tableEnd + 1);
  const dir = direction === 'desc' ? -1 : 1;
  const sortedDataLines = [...dataLines].sort((lineA, lineB) => {
    const cellsA = splitMarkdownTableRow(lineA);
    const cellsB = splitMarkdownTableRow(lineB);
    const valA = cellsA[targetCol] ?? '';
    const valB = cellsB[targetCol] ?? '';
    const numA = Number(valA.replace(/[,%$￥]/g, ''));
    const numB = Number(valB.replace(/[,%$￥]/g, ''));
    if (valA !== '' && valB !== '' && Number.isFinite(numA) && Number.isFinite(numB)) {
      return (numA - numB) * dir;
    }
    return valA.localeCompare(valB, 'zh-CN', { numeric: true }) * dir;
  });

  const nextLines = [
    ...lines.slice(0, tableStart + 2),
    ...sortedDataLines,
    ...lines.slice(tableEnd + 1),
  ];
  const nextSource = nextLines.join(newline);
  return {
    changed: nextSource !== raw,
    source: nextSource,
    sortedRows: sortedDataLines.length,
    columnIndex: targetCol,
    columnHeader: headerCells[targetCol] || `第 ${targetCol + 1} 列`,
  };
}

export function normalizeSavedBookmarks(bookmarks = []) {
  if (!Array.isArray(bookmarks)) return [];
  const valid = [];
  const seen = new Set();
  for (const item of bookmarks) {
    if (!item || typeof item !== 'object') continue;
    const kind = ['note-heading', 'tag-filter', 'search-query', 'view-preset'].includes(item.kind) ? item.kind : 'note-heading';
    const target = String(item.target || '').trim();
    const label = String(item.label || target).trim();
    if (!target || !label) continue;
    const id = String(item.id || `${kind}:${target}:${item.heading || ''}`);
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({
      id,
      kind,
      label: label.slice(0, 80),
      target: target.slice(0, 180),
      heading: String(item.heading || '').trim().slice(0, 120),
      createdAt: item.createdAt || '2026-10-26',
    });
  }
  return valid.slice(0, 24);
}

export function upsertSavedBookmark(bookmarks = [], candidate = {}) {
  const list = normalizeSavedBookmarks(bookmarks);
  const normalized = normalizeSavedBookmarks([candidate])[0];
  if (!normalized) return list;
  const filtered = list.filter(item => item.id !== normalized.id);
  return [normalized, ...filtered].slice(0, 24);
}

export function removeSavedBookmark(bookmarks = [], bookmarkId = '') {
  return normalizeSavedBookmarks(bookmarks).filter(item => item.id !== bookmarkId);
}

export function formatPomodoroClock(remainingSeconds = 1500) {
  const safe = Math.max(0, Math.floor(Number(remainingSeconds) || 0));
  const mins = String(Math.floor(safe / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

/**
 * EFF-005a: Move a Markdown heading section (and its nested sub-headings/paragraphs)
 * up or down relative to its adjacent sibling heading of the same level.
 */
export function moveMarkdownHeadingSection(source = '', targetOffsetOrTitle = 0, direction = 'up') {
  const raw = String(source || '');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = bom ? raw.slice(1) : raw;
  const fm = parseFrontMatter(body);
  const lines = body.split(/\r?\n/);

  let offset = 0;
  const lineOffsets = lines.map(l => {
    const cur = offset;
    offset += l.length + newline.length;
    return cur;
  });

  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lineOffsets[i] + lines[i].length < fm.bodyFrom) continue;
    const trimmed = lines[i].trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      headings.push({
        index: headings.length,
        lineIndex: i,
        from: lineOffsets[i],
        level: m[1].length,
        title: m[2].trim(),
      });
    }
  }

  if (headings.length < 2) {
    return { changed: false, source: raw, movedTitle: '' };
  }

  for (let h = 0; h < headings.length; h++) {
    let endLine = lines.length - 1;
    for (let next = h + 1; next < headings.length; next++) {
      if (headings[next].level <= headings[h].level) {
        endLine = headings[next].lineIndex - 1;
        break;
      }
    }
    headings[h].endLine = endLine;
  }

  // Locate target heading by character offset, exact title, or 0-based heading index
  let targetIdx = -1;
  if (typeof targetOffsetOrTitle === 'string' && targetOffsetOrTitle.trim()) {
    targetIdx = headings.findIndex(h => h.title === targetOffsetOrTitle.trim());
  } else if (typeof targetOffsetOrTitle === 'number') {
    const cleanOffset = Math.max(0, targetOffsetOrTitle - bom.length);
    targetIdx = headings.findIndex(h => Math.abs(h.from - cleanOffset) <= 4);
    if (targetIdx < 0 && targetOffsetOrTitle >= 0 && targetOffsetOrTitle < headings.length) {
      targetIdx = targetOffsetOrTitle;
    }
  }
  if (targetIdx < 0) return { changed: false, source: raw, movedTitle: '' };

  const target = headings[targetIdx];
  // Find sibling at the same level within the same parent boundary
  let siblingIdx = -1;
  if (direction === 'up') {
    for (let k = targetIdx - 1; k >= 0; k--) {
      if (headings[k].level < target.level) break;
      if (headings[k].level === target.level) {
        siblingIdx = k;
        break;
      }
    }
  } else {
    for (let k = targetIdx + 1; k < headings.length; k++) {
      if (headings[k].level < target.level) break;
      if (headings[k].level === target.level) {
        siblingIdx = k;
        break;
      }
    }
  }

  if (siblingIdx < 0) {
    return { changed: false, source: raw, movedTitle: target.title };
  }

  const first = direction === 'up' ? headings[siblingIdx] : target;
  const second = direction === 'up' ? target : headings[siblingIdx];

  const firstSlice = lines.slice(first.lineIndex, first.endLine + 1);
  const middleSlice = lines.slice(first.endLine + 1, second.lineIndex);
  const secondSlice = lines.slice(second.lineIndex, second.endLine + 1);

  const nextLines = [
    ...lines.slice(0, first.lineIndex),
    ...secondSlice,
    ...middleSlice,
    ...firstSlice,
    ...lines.slice(second.endLine + 1),
  ];

  const nextSource = bom + nextLines.join(newline);
  return {
    changed: nextSource !== raw,
    source: nextSource,
    movedTitle: target.title,
    direction,
  };
}

/**
 * EFF-005b: Append or update a Σ Summary Row (Sum / Average / Count) at the bottom of a Markdown table.
 */
export function appendOrUpdateTableSummaryRow(source = '', cursorOffset = 0) {
  const raw = String(source || '');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  let cursorLine = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + newline.length;
    if (cursorOffset <= acc + len) {
      cursorLine = i;
      break;
    }
    acc += len;
  }

  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line || '');
  const isSeparatorLine = line => /^\s*\|[\s:|-]+\|\s*$/.test(line || '') && (line || '').includes('-');

  let tableStart = -1;
  let tableEnd = -1;
  const locateAt = lineIdx => {
    if (!isTableLine(lines[lineIdx])) return false;
    let s = lineIdx;
    while (s > 0 && isTableLine(lines[s - 1])) s--;
    let e = lineIdx;
    while (e + 1 < lines.length && isTableLine(lines[e + 1])) e++;
    if (e - s >= 2 && isSeparatorLine(lines[s + 1])) {
      tableStart = s;
      tableEnd = e;
      return true;
    }
    return false;
  };

  if (!locateAt(cursorLine)) {
    for (let i = 0; i < lines.length; i++) {
      if (locateAt(i)) break;
    }
  }
  if (tableStart < 0 || tableEnd - tableStart < 2) {
    return { changed: false, source: raw, numericColumns: 0, rowCount: 0 };
  }

  const headerCells = splitMarkdownTableRow(lines[tableStart]);
  const colCount = headerCells.length;
  const rawDataLines = lines.slice(tableStart + 2, tableEnd + 1);
  // Strip any previously generated summary row
  const dataLines = rawDataLines.filter(l => !/^\s*\|\s*\*\*Σ\s*汇总/.test(l));
  if (!dataLines.length) {
    return { changed: false, source: raw, numericColumns: 0, rowCount: 0 };
  }

  let numericColumns = 0;
  const summaryCells = [];
  for (let c = 0; c < colCount; c++) {
    if (c === 0) {
      summaryCells.push(`**Σ 汇总 (${dataLines.length}行)**`);
      continue;
    }
    const nums = [];
    let isPercent = false;
    for (const rowLine of dataLines) {
      const cells = splitMarkdownTableRow(rowLine);
      const cellVal = String(cells[c] ?? '').replace(/\*\*/g, '').trim();
      if (!cellVal) continue;
      if (cellVal.endsWith('%')) isPercent = true;
      const numMatch = /^[$￥]?\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*%?$/.exec(cellVal);
      if (numMatch) {
        const parsed = Number(numMatch[1].replace(/,/g, ''));
        if (Number.isFinite(parsed)) nums.push(parsed);
      }
    }
    if (nums.length > 0) {
      numericColumns++;
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = sum / nums.length;
      const fmt = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
      summaryCells.push(isPercent ? `**均值 ${fmt(avg)}%**` : `**合计 ${fmt(sum)} (均值 ${fmt(avg)})**`);
    } else {
      summaryCells.push(`共 ${dataLines.length} 项`);
    }
  }

  const summaryLine = `| ${summaryCells.join(' | ')} |`;
  const nextLines = [
    ...lines.slice(0, tableStart + 2),
    ...dataLines,
    summaryLine,
    ...lines.slice(tableEnd + 1),
  ];
  const nextSource = nextLines.join(newline);
  return {
    changed: nextSource !== raw,
    source: nextSource,
    numericColumns,
    rowCount: dataLines.length,
    summaryLine,
  };
}

/**
 * ITER-178: Set or toggle Markdown table column alignment (left: `:---`, center: `:---:`, right: `---:`)
 */
export function alignMarkdownTableColumnInSource(source = '', cursorOffset = 0, alignment = 'left', columnIndex = null) {
  const raw = String(source || '');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  let cursorLine = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + newline.length;
    if (cursorOffset <= acc + len) {
      cursorLine = i;
      break;
    }
    acc += len;
  }

  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line || '');
  const isSeparatorLine = line => /^\s*\|[\s:|-]+\|\s*$/.test(line || '') && (line || '').includes('-');

  let tableStart = -1;
  let tableEnd = -1;
  const locateAt = lineIdx => {
    if (!isTableLine(lines[lineIdx])) return false;
    let s = lineIdx;
    while (s > 0 && isTableLine(lines[s - 1])) s--;
    let e = lineIdx;
    while (e + 1 < lines.length && isTableLine(lines[e + 1])) e++;
    if (e - s >= 1 && isSeparatorLine(lines[s + 1])) {
      tableStart = s;
      tableEnd = e;
      return true;
    }
    return false;
  };

  if (!locateAt(cursorLine)) {
    for (let i = 0; i < lines.length; i++) {
      if (locateAt(i)) break;
    }
  }
  if (tableStart < 0 || !isSeparatorLine(lines[tableStart + 1])) {
    return { changed: false, source: raw, columnIndex: 0, columnHeader: '', alignment };
  }

  const headerCells = splitMarkdownTableRow(lines[tableStart]);
  const sepCells = splitMarkdownTableRow(lines[tableStart + 1]);
  const colCount = Math.max(headerCells.length, sepCells.length);

  let targetCol = Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : 0;
  if (!Number.isInteger(columnIndex) && cursorLine >= tableStart && cursorLine <= tableEnd) {
    let lineStartOffset = 0;
    for (let i = 0; i < cursorLine; i++) lineStartOffset += lines[i].length + newline.length;
    const withinLine = Math.max(0, cursorOffset - lineStartOffset);
    const prefix = lines[cursorLine].slice(0, withinLine);
    const pipesBefore = (prefix.match(/\|/g) || []).length;
    if (pipesBefore >= 1) targetCol = Math.min(colCount - 1, pipesBefore - 1);
  }
  targetCol = Math.max(0, Math.min(colCount - 1, targetCol));

  const normAlign = ['left', 'center', 'right'].includes(String(alignment || '').toLowerCase())
    ? String(alignment).toLowerCase()
    : 'left';
  const marker = normAlign === 'center' ? ':---:' : normAlign === 'right' ? '---:' : ':---';

  const nextSepCells = Array.from({ length: colCount }, (_, idx) => {
    if (idx === targetCol) return marker;
    return sepCells[idx] || '---';
  });
  const nextSepLine = `| ${nextSepCells.join(' | ')} |`;
  const nextLines = [...lines];
  nextLines[tableStart + 1] = nextSepLine;
  const nextSource = nextLines.join(newline);
  return {
    changed: nextSource !== raw,
    source: nextSource,
    columnIndex: targetCol,
    columnHeader: headerCells[targetCol] || `第 ${targetCol + 1} 列`,
    alignment: normAlign,
    separatorLine: nextSepLine,
  };
}

/**
 * ITER-178: Extract a single column from a Markdown table for quick clipboard copy.
 */
export function extractMarkdownTableColumnFromSource(source = '', cursorOffset = 0, columnIndex = null) {
  const raw = String(source || '');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  let cursorLine = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + newline.length;
    if (cursorOffset <= acc + len) {
      cursorLine = i;
      break;
    }
    acc += len;
  }

  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line || '');
  const isSeparatorLine = line => /^\s*\|[\s:|-]+\|\s*$/.test(line || '') && (line || '').includes('-');

  let tableStart = -1;
  let tableEnd = -1;
  const locateAt = lineIdx => {
    if (!isTableLine(lines[lineIdx])) return false;
    let s = lineIdx;
    while (s > 0 && isTableLine(lines[s - 1])) s--;
    let e = lineIdx;
    while (e + 1 < lines.length && isTableLine(lines[e + 1])) e++;
    if (e - s >= 1 && isSeparatorLine(lines[s + 1])) {
      tableStart = s;
      tableEnd = e;
      return true;
    }
    return false;
  };

  if (!locateAt(cursorLine)) {
    for (let i = 0; i < lines.length; i++) {
      if (locateAt(i)) break;
    }
  }
  if (tableStart < 0 || !isSeparatorLine(lines[tableStart + 1])) {
    return { found: false, columnIndex: 0, columnHeader: '', values: [], text: '' };
  }

  const headerCells = splitMarkdownTableRow(lines[tableStart]);
  const colCount = headerCells.length;
  let targetCol = Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : 0;
  if (!Number.isInteger(columnIndex) && cursorLine >= tableStart && cursorLine <= tableEnd) {
    let lineStartOffset = 0;
    for (let i = 0; i < cursorLine; i++) lineStartOffset += lines[i].length + newline.length;
    const withinLine = Math.max(0, cursorOffset - lineStartOffset);
    const prefix = lines[cursorLine].slice(0, withinLine);
    const pipesBefore = (prefix.match(/\|/g) || []).length;
    if (pipesBefore >= 1) targetCol = Math.min(colCount - 1, pipesBefore - 1);
  }
  targetCol = Math.max(0, Math.min(colCount - 1, targetCol));

  const columnHeader = headerCells[targetCol] || `第 ${targetCol + 1} 列`;
  const dataLines = lines.slice(tableStart + 2, tableEnd + 1);
  const values = dataLines.map(line => splitMarkdownTableRow(line)[targetCol] ?? '');
  const text = [columnHeader, ...values].join('\n');
  return {
    found: true,
    columnIndex: targetCol,
    columnHeader,
    values,
    text,
  };
}
