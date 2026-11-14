import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-tables/style/tables.css';
import './inkloom.css';
import {
  createIcons, createElement as createLucideElement, ChevronRight, FilePlus2, FolderPlus, FolderOpen, Save, SaveAll, Download, PanelLeftClose, PanelLeftOpen,
  Code2, BookOpen, Search, Settings2, Info, Focus, AlignCenter, AlignLeft, AlignRight, Copy, Undo2, Redo2, Bold, Italic,
  Strikethrough, Heading2, List, ListOrdered, Quote, ImagePlus, Table2, Sigma, Workflow, Link,
  Highlighter, X, ChevronUp, ChevronDown, Eraser, Columns2, Rows3, Trash2, FileText, Printer,
  Check, ZoomIn, ZoomOut, ArrowUpRight, History, Maximize, ArrowUpToLine, CornerUpLeft,
  Network, Calendar, Star, Hash, FolderTree, Sparkles, PanelRightClose, PanelRightOpen, Plus, Ellipsis, TextCursorInput, ArrowLeft, Volume2,
  ChevronsUpDown, ChevronsDownUp, Folder, FolderClosed, ListTree,
} from 'lucide';
import { DocumentSession, highlightColors, minimalChange, serializeHighlights, restoreHighlights } from '../../vendor/inklet/core/document.mjs';
import { RecoveryWriter } from '../../vendor/inklet/core/recovery.mjs';
import { DocumentWorkspace, createDocumentState } from '../../vendor/inklet/core/workspace.mjs';
import { shortcutCommands, shortcutFor, shortcutFromEvent, validateShortcuts, commandFromEvent } from '../../vendor/inklet/core/shortcuts.mjs';
import { SourceEditor } from '../../vendor/inklet/app/src/source-editor.js';
import { RichEditor } from '../../vendor/inklet/app/src/rich-editor.js';
import { ScrollSynchronizer } from '../../vendor/inklet/app/src/scroll-sync.js';
import { ReadingPositionTracker, resolveReadingPosition } from '../../vendor/inklet/app/src/reading-position.js';
import { outlineOf, imageInsertion, wordStatistics } from '../../vendor/inklet/app/src/markdown.js';
import { codeLanguages, codeColorDefaults, codeColorLabels, codePalette } from '../../vendor/inklet/app/src/code-highlighting.js';
import { headingIntent } from '../../vendor/inklet/app/src/document-toc.js';
import { groupSearchMatches } from '../../vendor/inklet/app/src/search-engine.js';
import { renderMarkup } from '../../vendor/inklet/app/src/renderers.js';
import { interfaceFamilies, interfaceThemes as sharedInterfaceThemes, paperFamilies, paperThemes as themes, paneCodeColors } from '../../vendor/inklet/app/src/appearance.js';
import { isImagePlaceholder } from '../../vendor/inklet/app/src/image-references.js';
import {
  completeWikiLink,
  linkUnlinkedMention, purifyWikiLinksForExport, unescapeWikiLinksInMarkdown, stripNumericPrefix,
  updateFrontMatterProperties, planVaultRename, planVaultMove, planVaultFolderMove, planVaultDelete, localDate, parseVaultNote, parseFrontMatter,
} from '../../core/vault-graph.mjs';
import {
  SUPPORTED_RAW_EXTENSIONS,
  detectRawFileFormat,
  uint8ArrayToBase64,
  parseRawDocumentFile,
  parseRawDocumentFileSync,
  createStarterRawFiles,
} from '../../core/raw-document-ingestor.mjs';
import { mountPhaseTwo } from './phase-two.js';
import { wikiLinkPlugin, detectWikiLinkTrigger } from './wikilink-plugin.js';
import { call, assetUrl, desktop, selectDocument, digest } from './bridge.js';
import { createStarterVaultNotes } from './sample-vault.js';
import { IncrementalVaultIndex, hydrateGraph } from '../../core/vault-index.mjs';
import { VaultIndexClient } from './vault-index-client.js';
import { mountWorkbench } from './workbench.js';
import { queryDatabasePage, recordMruVisit, computeBatchTagPatch, resolveShiftRangeIds } from '../../core/database-query.mjs';
import { queryGraphSnapshot } from '../../core/graph-query.mjs';
import { WorkspaceAppearance } from './appearance-workspace.js';
import {
  buildVaultTree,
  flattenVaultTree,
  collectDescendantFolderPaths,
  isFolderRecursivelyExpanded,
  applyRecursiveFolderExpansion,
  buildNoteHeadingMindmapTree,
  buildFolderHierarchyMindmapTree,
  renderMindmapTreeSvg,
  collectBlockReferenceBacklinks,
} from '../../core/vault-tree.mjs';
import {
  createEmbedResolver,
  ensureBlockReference,
  selectNoteContent,
  expandNoteEmbeds,
  rebaseEmbeddedImages,
  inspectVaultEmbedReferences,
  repairBrokenNoteEmbedInSource,
  batchRepairNoteEmbedsInSource,
} from '../../core/note-embeds.mjs';
import {
  compileVaultPortableArchiveBytes,
  inspectAndVerifyVaultPortableArchive,
} from '../../core/vault-snapshot.mjs';
import {
  previewVaultSearchAndReplace,
} from '../../core/vault-doctor.mjs';
import { renderNoteEmbed } from './note-embed-view.js';
import { excerptNote, noteReference, parseDocumentSourceLink, formatSplitReaderCitationBlock, detectDocumentHashDrift, syncDocumentSourceHashInMarkdown, compileFolderManuscriptBinder } from '../../core/research-notes.mjs';
import { parseWikiLinkBody } from '../../core/vault-graph.mjs';
import { discoverSmartWikiLinks, applySmartWikiLinks, buildLlmWikiLinkPrompt } from '../../core/smart-wikilinks.mjs';
import {
  INLINE_AI_ACTIONS,
  SMART_NOTE_TEMPLATES,
  renderSmartTemplate,
  transformSelectedTextWithAi,
  buildInlineAiPrompt,
  inferNotePropertiesFromContent,
  computeLiveSmartConnections,
  appendQuickThoughtToSource,
  convertDelimitedTextToMarkdownTable,
  sortMarkdownTableInSource,
  moveMarkdownHeadingSection,
  appendOrUpdateTableSummaryRow,
  alignMarkdownTableColumnInSource,
  extractMarkdownTableColumnFromSource,
  normalizeSavedBookmarks,
  upsertSavedBookmark,
  removeSavedBookmark,
  formatPomodoroClock,
} from '../../core/in-place-copilot.mjs';
import {
  parseOneNoteHierarchyXml,
  convertOneNotePageXmlToMarkdown,
  convertOneNoteToMarkdown,
} from '../../core/onenote-importer.mjs';
import { renderRichMarkdownDocument } from '../../plugins/ai-assistant/main.js';
import {
  parseMarkdownSlides,
  compileSingleFileWikiHtml,
  compileEpub3PackageBytes,
  computeNoteLineDiff,
  revertDiffHunk,
  KNOWLEDGE_CARD_THEMES,
  extractNoteKnowledgeCardPayload,
  renderKnowledgeShareCardSvg,
} from '../../core/publication-presenter.mjs';
import {
  PRIVACY_LEVELS,
  getNotePrivacyState,
  encryptNoteSourceAesGcm,
  decryptNoteSourceAesGcm,
  computeThermodynamicAwakening,
} from '../../core/karpathy-wiki-chronicle.mjs';
import {
  extractFlashcardsFromNotes,
  applyFlashcardReviewToSource,
  selectDueMicroFlashcards,
} from '../../core/spaced-repetition.mjs';
import {
  computePeriodicNoteSpec,
  compilePeriodicNoteMarkdown,
} from '../../core/workspace-model.mjs';
import {
  validateSecondaryWindowSpec,
  parseSecondaryWindowUrl,
  detectTabTearOffGesture,
  createSyncEnvelope,
  reconcileCrossWindowNoteUpdate,
} from '../../core/multi-window-docking.mjs';
import { mountUserGuide } from './user-guide.js';
import { mountSpeechReader } from './speech-panel.js';

const iconSet = {
  FilePlus2, FolderPlus, FolderOpen, Save, SaveAll, Download, PanelLeftClose, PanelLeftOpen,
  Code2, BookOpen, Search, Settings2, Info, Focus, AlignCenter, AlignLeft, AlignRight, Copy, Undo2, Redo2, Bold, Italic,
  Strikethrough, Heading2, List, ListOrdered, Quote, ImagePlus, Table2, Sigma, Workflow, Link,
  Highlighter, X, ChevronUp, ChevronDown, Eraser, Columns2, Rows3, Trash2, FileText, Printer,
  Check, ZoomIn, ZoomOut, ArrowUpRight, History, Maximize, ArrowUpToLine, CornerUpLeft,
  Network, Calendar, Star, Hash, FolderTree, Sparkles, PanelRightClose, PanelRightOpen, Plus, Ellipsis, TextCursorInput, ArrowLeft, Volume2,
  ChevronsUpDown, ChevronsDownUp, Folder, FolderClosed, ListTree,
};
const interfaceThemes = {
  neutral: { name: '墨图云灰', family: 'clear', base: '#e5e7eb', secondary: '#dadde2', ink: '#1b1f25', muted: '#555d68', accent: '#2b313a' },
  ...sharedInterfaceThemes,
};
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const button = (name, label, action, extra = '') => `<button type="button" class="icon-button" title="${label}" aria-label="${label}" data-action="${action}" ${extra}>${icon(name)}</button>`;
const swatchNames = { yellow: '淡黄', green: '浅绿', blue: '天蓝', pink: '浅粉', orange: '淡橙' };
const backgroundOptions = side => Object.entries(themes).map(([name, theme]) => `<button type="button" class="theme-option" data-theme-side="${side}" data-theme="${name}" aria-pressed="false"><span data-paper="${theme.paper}" style="background-color:${theme.value}"></span>${theme.name}</button>`).join('');
const familyOptions = families => Object.entries(families).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
const readingFonts = {
  book: "'Literata', 'Noto Serif SC', 'Source Han Serif SC', 'STZhongsong', 'Songti SC', 'SimSun', serif",
  sans: "'Manrope', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  kai: "'LXGW WenKai', 'KaiTi', 'STKaiti', 'Noto Serif SC', 'SimSun', serif",
};
const releaseNotes = [
  ['3.1.0', '全库正则表达式 / 跨文件受控预览查找替换工作台（含代码块隔离、双链目标保护与一键整批回退）及任务日历标准 .ics（iCalendar RFC 5545）日程双向同步（MAJOR-310）：在笔记顶栏「⋯ 更多笔记工具」菜单、页内查找栏「全库替换…」、文件菜单与 Ctrl+K 命令中心中新增「🔍 全库受控查找替换与 YAML 属性批量改名」（支持正则表达式分组、逐行红绿 Diff 预览、自动保护 [[双链]] 目标与代码块、内存回退快照一键整批撤销）；在「工作台 → 总览 → 📅 周期手记 ▾」弹出菜单中集成标准 RFC 5545 .ics 日历文件导出（含 RRULE 重复规则、时间与优先级）及外部 .ics 日程一键导入同步。', '2026-11-14'],
  ['3.0.0', '3.0 里程碑正式预览版 —— 全库便携归档（.inkloom-vault.zip 含 FIPS 180-4 SHA-256 签名清单与无损差异还原）及跨笔记 ![[块引用 / 章节]] 动态内嵌巡检对比台（MAJOR-300）：在左侧活动栏底部「导入与库管理」菜单、文件菜单与 Ctrl+K 命令中心中新增「📦 全库便携归档与验签还原」（逐文件 64 位 SHA-256 签名校验、篡改阻断、UTF-8 BOM/CRLF 无损差异还原）；在笔记顶栏「⋯ 更多笔记工具」菜单与「智识 → 格式与断链体检 → 🧬 Dataview与多源迁移 ▾」弹出菜单中新增跨笔记块引用与章节内嵌巡检对比台（实时检测源章节改名或 ^block-id 锚点变动并支持原位跳源与一键批量对齐修复）。', '2026-11-14'],
  ['2.9.0', '笔记知识金句与分享卡片离线渲染器（SVG / PNG）及写作目标字数热力冲刺与里程碑统计（MAJOR-290）：在笔记顶栏「⋯ 更多笔记工具」菜单、划词浮栏与 Ctrl+K 命令中心中新增「🖼️ 笔记知识金句与分享卡片离线渲染器」（支持书卷清透 / 暗夜黑金 / 莫兰迪青瓷 / 苍穹靛青四款主题版式，自动净化双链语法、附带署名印章与来源字数，一键离线导出矢量 SVG 或 2x 高清 PNG）；在「工作台 → 总览 → 📅 周期手记 ▾」弹出菜单中集成每日/全库目标字数冲刺、连续创作天数（Streak）与四大创作里程碑追踪及一键生成冲刺复盘报告。', '2026-11-14'],
  ['2.8.0', '周期性手记日/周/月/季模板中心与 SM-2 记忆闪卡 Anki (.apkg / TSV) 双向同步工作台（MAJOR-280）：在「工作台 → 总览 → 📅 周期手记 ▾」弹出菜单、左侧活动栏「今日手记」悬停直达菜单及 Ctrl+K 命令中心中新增本周周报（YYYY-Www）、本月复盘（YYYY-MM）与本季规划（YYYY-Qn）周期手记（自动聚合周期内活跃笔记 [[双链]]、已完成/待推进任务与到期闪卡负荷）；在「智识 → 闪卡温习 → 牌组与制卡 ▾」弹出菜单中新增标准 Anki TSV 与离线 .apkg 牌组包导出及 .apkg/.tsv 双向无损导入（完整保留加粗、代码、双链及 SM-2 间隔重复进度）。', '2026-11-14'],
  ['2.7.0', 'EPUB 3.0 电子书离线打包出版引擎与多维视图 CSV / Markdown 汇总表双向批处理工作台（MAJOR-270）：在顶栏「导出文档」弹窗与「研究 → 长稿 → 出版定稿」中新增标准 EPUB 3.0 电子书（.epub）离线打包导出（自动生成 mimetype、META-INF/container.xml、content.opf、nav.xhtml / toc.ncx 与分章 XHTML 排版样式，支持直入原件精读器阅读）；在「笔记视图 → 视图管理 ▾」弹出菜单中新增当前视图 CSV 导出、存为带 [[双链]] 的 Markdown 汇总笔记与 CSV 批量贴入同步 YAML 属性。', '2026-11-11'],
  ['2.6.0', '多级目录长稿章节编排总控台（Folder Manuscript Binder）与跨章节人物·概念·时间线追踪矩阵（MAJOR-260）：在「研究 → + 新建与导入 ▾」弹出菜单与左侧目录树右键菜单中新增「📚 汇编此目录为长稿总览」，支持选中任意多级目录并递归扫描下属全部分卷/子目录与章节笔记，一键生成带分卷进度汇总、章节字数状态表与内嵌章节结构的长稿总控台（manuscripts/）；在「智识 → 长稿前后核查」的「🧭 设定与时间线矩阵 ▾」弹出菜单中新增跨目录/跨章节【实体·属性】演进矩阵与章节时间线序列追踪表。', '2026-11-09'],
  ['2.5.0', '多级目录树递归展开至最底层 / 选中目录一键收起与交互式知识大纲思维导图（MAJOR-250）：在左侧「知识库」多级目录树中支持选中任意文件夹并递归展开至最底层子目录或一键全部收起（文件夹行配备主题一致的开合图标与递归展开/收起徽标，顶栏配备「全部展开至最底层 / 全部收起」双按钮，右键菜单同步集成）；在笔记顶栏「⋯ 更多笔记工具」菜单与目录树右键菜单中新增「🌿 知识大纲与目录层级思维导图」，支持将当前笔记章节双链结构或所选多级目录树实时渲染为可折叠交互式 SVG 思维导图并导出。', '2026-11-08'],
  ['2.4.0', 'Obsidian JSON Canvas (.canvas 1.0) 双向无损互通与星图路径投射空间白板（MAJOR-240）：在「白板」工作台中支持直接导入与导出 Obsidian JSON Canvas 1.0 标准文件（.canvas，双向转换 file 笔记卡片、text 文本块、group 分组容器、link 外部链接与 edges 连线箭头）；在「万象知识星图 → 🧭 图谱寻路 ▾」弹出菜单中新增「🎨 投射为空间白板」，支持将当前寻路桥梁链路或核心社区子图一键合成为可自由手绘排布的空间白板（存入 whiteboards/ 目录）。', '2026-11-08'],
  ['2.3.0', 'Obsidian Dataview DQL 实时查询引擎与 Notion / Logseq 多源无损迁移工作台（MAJOR-230）：在「智识 → 格式与断链体检」的「🧬 Dataview与多源迁移 ▾」弹出菜单中，新增零外部依赖的 Obsidian Dataview DQL 查询解析与执行引擎（支持 TABLE / LIST / TASK、FROM 目录或 #标签、WHERE 条件过滤、SORT 排序与 LIMIT 分页，实时输出带可跳转 [[双链]] 的 Markdown 汇总表与任务清单）；同步新增 Notion 导出（自动剥离 32 位十六进制 UUID 后缀并将顶部属性行转为标准 YAML Frontmatter）与 Logseq 大纲（提取 key:: value 属性、剥离内部块 id:: 并转换 TODO/DOING/DONE 为标准任务复选框）无损规范化引擎。', '2026-11-08'],
  ['2.2.0', '端到端加密（E2EE）零知识增量同步仓与跨平台可移植构建自检（MAJOR-220）：在「智识 → 多端目录增量同步」的「🔐 零知识E2EE与跨平台 ▾」弹出菜单中，支持基于 PBKDF2-HMAC-SHA256 (100,000 次迭代) + AES-256-GCM 将全库或指定目录增量推送至零知识加密同步仓（远端仅见内容寻址密文块与加密清单，未变笔记自动复用密文块，支持口令解密与 64 位 SHA-256 完整性还原核验）；同步新增 Windows (NTFS/WebView2) / macOS (APFS/WKWebView) / Linux (ext4/WebKitGTK) 跨平台路径可移植性与宿主构建就绪度自检报告。', '2026-11-07'],
  ['2.1.1', '移植 Inklet 0.11.9 的 Markdown 书籍朗读：从更多笔记工具或划词浮栏进入，支持分段跟随、暂停继续、上下段、0.75 至 2 倍速、按章或定时停止。在线自然音色提供 16 款音色与 4 档语调，另可配置 OpenAI 兼容语音服务。默认本机语音，在线朗读逐次确认，内控和机密笔记不外发；切篇、修改正文或停止时取消待播音频。', '2026-11-07'],
  ['2.1.0', '桌面 OneNote COM 全保真手写墨迹还原与外部 MCP 权限审计台（MAJOR-210）：扩展 OneNote XML / COM 迁入引擎支持 <one:InkDrawing> 手写墨迹笔触离线 SVG 矢量还原（自动计算包围盒并写入 assets/onenote/*-ink-*.svg）与四维全保真校验报告（二维坐标线性重排 / 原始图片字节 / 手写墨迹 SVG / 附件字节核验）；在「智识 → 受控 Agent 工具箱 → 外部 AI 接入」的「🛡️ 权限与审计 ▾」菜单中新增 7 项外部 MCP 工具级启停开关、仅开放只读工具预设、允许目录白名单与 JSON-RPC 2.0 实时调用审计账本。', '2026-11-06'],
  ['2.0.0', '多模态 raw/ 离线 OCR 摄取与可选本地 GGUF Embedding 向量索引（MAJOR-200）：扩展 Karpathy raw/ 知识编译器支持扫描版 PDF 与本地长图（.png/.jpg/.webp/.svg）的离线 OCR 文本提取与多列 Markdown 表格还原（收纳于「+ 导入与OCR ▾」弹出菜单）；在「智识 → 模型连接与安全凭据」的「🧬 向量索引管理 ▾」菜单中支持切换 128维特征哈希 / 256维本地 GGUF 语义向量 / 384维混合 RRF 索引并执行平滑增量重建（自动剥离机密加密笔记）。', '2026-11-06'],
  ['1.9.0', '跨原生窗口多屏协同与页签拖拽拆窗（MAJOR-190）：支持通过笔记工具菜单「⋯」、目录树右键菜单或向下拖拽顶部页签水泡（Tear-Off Docking），将笔记、万象知识星图、Excalidraw 白板或 PDF/EPUB 原件精读拆分为独立的 Windows WebView2 原生副窗口；主副窗口共享单实例 VaultStore 写入锁与跨窗事件总线（自动保护未保存本地草稿免受覆盖，支持跨窗双链联动跳转与副窗口一键汇总管理）。', '2026-11-05'],
  ['1.8.0', 'PDF 原生版面渲染与画布级框选批注工作台 + 全站极简菜单化 UI 统一收敛（MAJOR-180）：在「研究 → 原件精读」新增 PDF 原生 A4 版面画布、双页并排视图、缩放自适应与画布级框选区域批注（自动提取框选段落文本、生成离线矢量区域快照缩略图并双向写入 excerpts/ 的 source_bbox 与 #inkloom-reader?...&bbox= 锚点）；同时贯彻「表层极简 · 菜单收纳」原则，将笔记顶栏扩展工具、数据库视图预设管理、研究新建/导入、原件阅读工具、知识图谱寻路器与闪卡牌组制卡统一收纳至轻薄弹出菜单（.ux-popover-menu）。', '2026-11-05'],
  ['1.7.9', 'SM-2 记忆闪卡牌组分类、难点错题本、右侧栏微复习卡与 1.7 系列手册同步（ITER-179）：在「智识 → 记忆闪卡」顶部新增按「来源目录 / #标签 / 🔥 难点错题本」轻量筛选器；在右侧关联栏底部提供可折叠的「🧠 今日到期微闪卡」小组件，支持原位翻转答案与一键「重来 / 掌握」回写 SM-2 进度；同步更新全站焦点环、操作手册、F1 指南与沙盒教程。', '2026-11-05'],
  ['1.7.8', '书卷专注禅模式（Zen Focus）与表格/图表微交互精修（ITER-178）：新增快捷键 Ctrl+Shift+F 与笔记顶栏专注按钮一键收起周界栏进入「书卷禅模式」，自动联动当前段落聚光灯（Typewriter Dimming）与柔和页边距；Markdown 表格悬浮工具条新增列左/中/右对齐切换与单列快速复制；Mermaid 图表与代码块新增一键复制高清矢量图（SVG）或源码。', '2026-11-05'],
  ['1.7.7', '全域键盘流进阶与 Ctrl+K 最近访问栈 / 批量整理动作（ITER-177）：Ctrl+K 命令中心未输入关键词时默认置顶展示「最近访问笔记、章节与 PDF/EPUB 原件（MRU 栈）」，支持一键直达刚刚读过的 PDF 页码或笔记章节；左侧目录树与多维表格支持 Shift/Ctrl 多选笔记后一键批量添加/移除 #标签、批量修改 status、批量移入目标目录并自动重写双链。', '2026-11-05'],
  ['1.7.6', '多维属性视图「常驻视图预设页签（Saved View Tabs）+ 组合筛选」（ITER-176）：对标 Notion Database Views，在「笔记视图」顶栏支持将当前表格/看板模式、分组字段、排序列、筛选词与派生公式列一键保存为顶部轻薄视图页签（默认内置「全部笔记 · 进行中项目 · 待读文献」），支持拖拽排序、重命名与删除并随知识库持久化。', '2026-11-05'],
  ['1.7.5', '学术文献引文引擎（ITER-175）：在「研究 → 资料」中支持粘贴或导入 .bib / .ris 文献条目自动解析作者、年份、标题、期刊/出版社、卷期页码与 DOI 生成 sources/ 笔记；引文栏新增「双链引文 / GB/T 7714-2015 / APA 7th / BibTeX」四档轻薄切换，长稿出版联排文末自动输出标准学术参考文献格式。', '2026-11-05'],
  ['1.7.4', '全新默认主题「墨图云灰 · 左侧随主题深色微浮雕胶囊条 + 页内主题色立体按钮」与原件同屏联动引文（ITER-174）：左侧导航栏按图标使用长度紧凑包裹深色层次阴影条与纯白线条图标，页面内按钮保持主题色微浮雕阴影层次；右侧分屏对照栏支持 PDF/EPUB 原件同屏引文插入与 SHA-256 变更预警同步。', '2026-11-04'],
  ['1.7.3', '设置保留活动栏底部唯一常驻入口，七组按需折叠，主题包与外观扩展默认收起；修复切换暗色色系后主题包残留、正文不换底及弹窗文字失配；表面使用实际半透明颜色，减少页面套框，活动栏采用实心彩色选中态，默认正文 15px、行距 1.75，保留已有排版偏好。', '2026-11-01'],
  ['1.7.2', '全面升级为清透轻玻璃风格（无厚重毛玻璃模糊，兼容 15 款清透/莫兰迪/糖果/暗色主题）、12px 精致字号与 40px 轻彩纯图标活动栏；智识与研究视图去表单化，压缩为单行玻璃输入条并顶栏常驻当前笔记直达胶囊；修复设置底色大色块与工作区满屏布局。', '2026-11-01'],
  ['1.7.1', '研究工作台新增「原件精读 (PDF / EPUB)」双栏书卷阅读与可溯源摘录工作台：支持直接导入并按页码或章节精读 raw/ 目录下的 PDF 与 EPUB 原件，校验 64 位 SHA-256 哈希，一键创建带 #inkloom-reader?file=...&hash=...&page=... / epubcfi(...) 锚点的可溯源摘录卡，并支持从摘录列表或笔记正文一键跳回原件对应页码与章节。', '2026-10-30'],
  ['1.6.6', '内置 F1 交互式操作手册与图文指南全量同步（覆盖 1.6.1–1.6.6 全部目录树重构、Karpathy Wiki 三类专页与图谱审阅工作流）、外部 MCP Stdio 服务端路径越界拦截与只读安全门禁加固（AI-007），以及单文件离线知识微站跨目录路径双链与章节锚点跳转增强（QA-003）。', '2026-10-30'],
  ['1.6.5', '万象知识星图关系审阅与晋升工作台（支持 EXTRACTED 显式引用行号定位 + INFERRED 推断关系原位「✨ 采纳双链 / 忽略」）、重整化群多尺度星团水泡视图（Block-Spin RG · ALGO-007）与 Hodge 纵向知识能级分层布局（L1 基石层 → L2 晶体层 → L3 综合层 · ALGO-003）。', '2026-10-30'],
  ['1.6.4', 'Karpathy LLM Wiki 跨文档专题综合页（wiki/topics/ · 自动聚合多份 raw/ 异构资料与知识库笔记生成跨源结论对照矩阵）与 raw/ 原始资料分屏对照阅读器（#reference-pane 原生支持 PDF/Word/PPT/Excel/CSV/HTML/TXT 分段对照阅读、顶栏「📄 对照原件」快捷胶囊与一键插入带精确章节出处的引文）。', '2026-10-30'],
  ['1.6.3', '目录树右键整目录重命名与跨层级移动（自动批量重写子目录及笔记路径双链，拦截循环移动）、目录树鼠标直接拖拽移动与悬停展开、四维目录树排序（名称正逆序 / 最近日期 / ★星标优先），以及 Karpathy Wiki 重编译保留「## ✍️ 人工研读批注」非破坏式增量合并。', '2026-10-30'],
  ['1.6.2', '目录树右键跨层移动笔记并自动重写路径双链、全局拖拽异构资料直入 raw/；Karpathy LLM Wiki 三大算子（Ingest + Query 问答反哺入 Wiki + Lint 原位一键修复索引/概念百科/边界辨析）完整闭环与 Wiki-First 穿透溯源检索。', '2026-10-30'],
  ['1.6.1', '工作台总览、左对齐与多级目录、可调三栏、真实标签排序与参考栏换位；OneNote 低频三步向导并取消样例回退；Obsidian 安全配色适配；图谱关系出处；完整视口和深浅主题验收。跨原生窗口 Docking、真实 OneNote COM 与外部 MCP 客户端认证未包含在本轮。', '2026-10-29'],
  ['1.6.0', '首次加入 OneNote COM 接口、外部 MCP 实验实现、章节重排与表格汇总。历史样例回退不构成真实 COM 迁移证据，1.6.1 已取消；兼容与安全范围以最新说明为准。', '2026-10-28'],
  ['1.5.2', '极简清爽 UI 降噪、Karpathy 编译器三步左控右看工作台、OneNote 异构图文与随页附件一键迁入器、标准外部 MCP Server（支持 VS Code GitHub Copilot / Claude Desktop / Cursor 直连操作笔记）及 F1 操作指南补全', '2026-10-28'],
  ['1.5.1', '全站 UX/UI 六大黄金法则与 Karpathy 知识编译器极简重构：固化 Inkloom 专属 UX/UI 设计规范与防膨胀法则，Karpathy 编译器重构为「单行四专题选择器 + 一体化晶体预览舞台」，全面消除多面板垂直堆叠（MCP 横向五步流水线、周期综述/拆卡分段快切、右侧栏提及双模快切、目录冲突富文本对账）与原始 LaTeX 数学噪点', '2026-10-28'],
  ['1.5.0', 'Karpathy LLM Wiki知识编译器（raw/→wiki/ 渗流相变判据Φ≥0.62、RULES.md编译宪章、index.md L0路由与log.md账本、施密特正交压缩与胡克张力/结构洞Lint）、上下有序单列《认知演进史》（Hodge营养能级坐标轴、认知纪传双链卡片流与AI史官三段式评注）、三态隐私护栏胶囊与AES-256-GCM认证加密护盾、热力学多通道跨期共振唤醒', '2026-10-28'],
  ['1.4.0', '受控本地MCP智能体工具箱与双目录SHA-256增量同步：开放跨库检索/章节精读/盲区诊断/项目汇总/草拟新卡/批量标签6大受控工具与彩色多步推理轨迹、写操作强制Diff人工门禁，以及双目录64位SHA-256增量比对与三方冲突无损合并', '2026-10-26'],
  ['1.3.0', '空间知识画布与高阶图谱寻路分析：万象星图双向BFS最短路径寻路与桥梁链路高亮、PageRank枢纽识别与标签传播社区聚类着色胶囊、Excalidraw手绘白板混排真实Markdown笔记卡片与双向跳转', '2026-10-26'],
  ['1.2.0', '多维演示幻灯片、单文件离线知识微站发布与逐行历史Diff局部回滚：支持---与H2分页全屏演示、零外部依赖单文件知识微站HTML导出、当前笔记逐行红绿Diff与按块一键局部还原', '2026-10-26'],
  ['1.1.0', '原位伴随式AI副驾驶与零摩擦笔记效率：划词浮条6项AI动作与原位预览确认、斜杠/ai续写与起草、顶栏AI一键填充YAML属性、右侧栏实时语义灵感副驾驶、6套动态变量笔记模板、全局闪念静默追加、剪贴板表格转换与列排序、智能书签与心流番茄钟', '2026-10-26'],
  ['1.0.2', '外置轻薄水泡周界UI与最大化中央工作区：顶部多页签水泡与右上角圆弧折叠页签、左侧外置圆润水泡活动栏、右侧脉络外置水泡快切条，100%保留全部既有功能', '2026-10-25'],
  ['1.0.1', '高亮批注中心胶囊正名：五种高亮底色（淡黄/浅绿/天蓝/浅粉/淡橙高亮）完全由用户自由点选、不强绑固定语义，提示块独立归入引文与提示块', '2026-10-25'],
  ['1.0.0', '里程碑正式预览版：知识库全局快照与时光机对比恢复、全库五色高亮批注与引文聚合中心、长稿多章联排出版定稿工作流', '2026-10-25'],
  ['0.9.0', '原位交互式属性胶囊快切（状态/标签一键写回YAML）、Ctrl+K全域语义胶囊命令与章节跳转中心、记忆闪卡14天负荷预测条与候选勾选预览', '2026-10-25'],
  ['0.8.1', '全站三级语义彩色胶囊设计系统、划重点仅限正文鼠标划词触发防遮挡、记忆闪卡富文本答案渲染与双链反转义修复、出具Inkloom UX/UI设计规范', '2026-10-25'],
  ['0.8.0', '分屏对照参考笔记与一键引文、SM-2间隔重复记忆闪卡工作台、全库健康诊断与Obsidian语法兼容迁移（收口0.8生态与交付）', '2026-10-24'],
  ['0.7.0', '孤岛笔记智能织网、手记/Memo周报与专题综述汇编、长文H2原子拆卡、离线扩展包校验安装/升级回退与全界面从上到下图文操作手册', '2026-10-24'],
  ['0.6.1', '本地最小模型SmolLM2-135M与Gemini 4多模型预设、三模三引擎智能双链（手工/半自动提醒/全自动补链+余弦/本地小模型/在线大模型）与核心技术架构记录', '2026-10-24'],
  ['0.6.0', '智识问答与混合向量检索、受控差异修订、长稿一致性核查、Skills沉淀与内置操作手册', '2026-10-24'],
  ['0.5.4', '0.5全功能收口：手绘手帐与白板缩略图、行内嵌入与块标识去重、派生公式/关系汇总列、长稿章节重排汇编', '2026-10-24'],
  ['0.5.3', '多维属性分组汇总与内联编辑、工作台模板导出重建、长稿章节与引文；收口0.5工作台', '2026-10-24'],
  ['0.5.2', '白板、正文与块引用、研究资料、阅读札记和选段摘录', '2026-10-24'],
  ['0.5.1', '任务看板、任务编辑、日历改期与重复任务；发布和测试仅保留最近两版', '2026-10-24'],
  ['0.5.0', '层级目录树与轻薄界面、可组合工作台、Memo、任务日历与项目', '2026-10-23'],
  ['0.4.0', '主题与图标包、本地Banner、受控CSS和图谱样式/布局', '2026-10-23'],
  ['0.3.8', '0.3功能收口：统一后台查询、身份迁移、缓存修复与故障验收', '2026-10-23'],
  ['0.3.7', '最近知识库、每库启动偏好与上次笔记恢复', '2026-10-22'],
  ['0.3.6', '知识库管理、受控恢复、扫描诊断与安全切库', '2026-10-22'],
  ['0.3.5', '原文快照写入校验、逐项回滚和准确恢复状态', '2026-10-22'],
  ['0.3.4', '索引缓存校验、连续取消与跨库隔离、可见异常和恢复', '2026-10-22'],
  ['0.3.3', '完整图谱插件、局部挂载、布局资源回收与视口恢复', '2026-10-22'],
  ['0.3.2', '完整笔记视图插件、分页与版本化状态更新', '2026-10-22'],
  ['0.3.1', '紧凑工作台、操作去重、对齐侧栏与隔离插件事件和设置', '2026-10-22'],
  ['0.3.0', '后台增量索引、永久笔记身份、窄活动栏与插件底座', '2026-10-22'],
  ['0.2.0', '透明标识与分组设置，斜杠编辑、属性视图和安全改链', '2026-10-21'],
  ['0.1.0', '首发墨图：呼吸感三栏、全维双链、局部星图与万象知识图谱', '2026-10-21'],
];

let startupError;
let appearance;
const startupState = await call('hello').catch(error => { startupError = error; return {}; });
const starterNotes = createStarterVaultNotes('2026-10-21');
let vaultState = startupState.vault || {
  vaultName: '墨图示例知识库 (Starter Vault)',
  vaultPath: 'vault://starter-vault',
  notes: starterNotes,
};

const startupSession = startupState.session || null;
const defaultDoc = vaultState.notes?.[0]
  ? { id: vaultState.notes[0].id, name: vaultState.notes[0].name, path: vaultState.notes[0].path, relativePath: vaultState.notes[0].relativePath, text: vaultState.notes[0].source }
  : { id: 'vault-00', name: starterNotes[0].name, path: 'vault://' + starterNotes[0].relativePath, relativePath: starterNotes[0].relativePath, text: starterNotes[0].source };
const startupDocument = startupSession
  ? { ...startupSession.info, id: startupSession.documentId, text: startupSession.session.source }
  : startupState.document || defaultDoc;

let documentSession = startupSession ? DocumentSession.restore(startupSession.session) : new DocumentSession(startupDocument.text || '');
const startupHighlights = restoreHighlights(documentSession.source, startupDocument.annotations?.marks, !!startupDocument.hash && startupDocument.annotations?.textHash === startupDocument.hash);
if (!startupSession) {
  documentSession.highlights = startupHighlights.highlights;
  documentSession.unresolved = startupHighlights.unresolved;
}

let settings = {
  leftTheme: 'gray', rightTheme: 'gray', backgroundPaletteVersion: 1, interfaceTheme: 'neutral',
  ctrlWheelZoom: true, separateWindows: false, embedImages: false, restoreReadingPosition: false,
  fontSize: 15, readingFont: 'sans', lineHeight: 1.75, paragraphGap: 1, readingWidth: 760,
  paperTexture: false, opacity: 0.3, source: false, rich: true, sidebar: true, contextSidebar: true,
  outlineSide: 'left', shortcuts: {}, focus: false, typewriter: false, syncScroll: true,
  searchResults: false, compress: false, localGraphDepth: 1, localGraphTags: false,
  slashMenu: true, calloutStyle: 'soft', autoUpdateLinks: true, databaseCompact: false, databaseView: 'table',
  disabledPlugins: ['sandbox-inspector'], activityLabels: false, textNavigation: false, pluginSafeMode: false,
  formattingToolbar: false, showBacklinksFooter: false,
};

let documentInfo = {
  name: startupDocument.name,
  path: startupDocument.path || null,
  relativePath: startupDocument.relativePath || startupDocument.name,
  hash: startupDocument.hash || null,
};
let savedRevision = startupSession ? startupSession.savedRevision : startupDocument.restored ? -1 : 0;
let activePane = 'rich';
let selection = { from: 0, to: 0 };
let results = [];
let totalResults = 0;
let selectedResult = -1;
let resultsRevision = -1;
let searchFailed = false;
let searching = false;
let searchGroups = [];
let searchId = 0;
let searchTimer;
let outlineTimer;
let outlineEntries = [];
let outlineItems = [];
let outlineModel = null;
let activeOutlineItem = null;
let outlineFollowFrame = null;
let sidebarDrag = null;
let sidebarResizeFrame = null;
let draggingNoteTab = '';
let recoveryWriter;
let speechReader;
const workspaceEnabled = true;
const multipleWindows = desktop && startupState.multipleWindows === true;
let recoveryDocumentId = startupDocument.id || crypto.randomUUID().replaceAll('-', '');
let activeNoteIdentity = startupDocument.noteId || vaultState.notes.find(note => note.path?.toLowerCase() === startupDocument.path?.toLowerCase())?.id || recoveryDocumentId;
selectDocument(recoveryDocumentId);

const workspace = new DocumentWorkspace({
  load: entry => call('loadDocument', { documentId: entry.id }),
  write: (id, snapshot) => call('storeSession', { documentId: id, snapshot }),
  read: id => call('readSession', { documentId: id }),
  beforeActivate: id => call('activateDocument', { documentId: id }),
});
for (const info of startupState.documents || []) workspace.add(info);
const initialEntry = workspace.add({ id: recoveryDocumentId, ...documentInfo });
initialEntry.state = { ...createDocumentState(startupDocument), ...startupSession, session: documentSession, savedRevision };
initialEntry.placeholder = startupDocument.placeholder === true;
workspace.activeId = recoveryDocumentId;

let workspaceBusy = false;
let vaultMutationBusy = false;
let composing = false;
let phaseTwo = null;
let workbench = null;
let userGuide = null;
let smartWikiLinkLlmConfirmed = null;
let smartWikiLinkBusy = false;
const compactViewport = matchMedia('(max-width:860px)');
let compactSidebar = '';
let statusTimer;
let closingWorkspace = false;
let imageImportBusy = false;
let navigationTab = 'vault';
let contextTab = 'backlinks';
let inspirationSubMode = 'cosine';
let mentionsSubMode = 'smart';
let backlinksDrawerTab = 'linked';
let backlinksDrawerCollapsed = false;
let activeTagFilter = '';
let vaultFilterText = '';
let vaultVisibleLimit = 200;
let sidebarSignature = '';
let graphVersion = 1;
let vaultGraph = hydrateGraph(new IncrementalVaultIndex().snapshot());
const vaultIndex = new VaultIndexClient();
let suggestItems = [];
let suggestIndex = 0;
let activeTrigger = null;
let hoverPopoverTimer = null;
let pointerSelectingInEditor = false;
let pointerDownCoords = null;
let pointerDraggedInEditor = false;
let pinnedReferenceNoteId = '';
let quickSwitcherCategory = 'all';
let quickSwitcherIndex = 0;
let recoveryState = 'idle';
let codeColorScope = 'default';
let exportController;
let exportImageConfirmation;
let saving = false;
let embeddingSave = false;
let scrollSync;
let readingTracker;
let readingRestoreRequest = 0;
let dialogApply;
let toastTimer;
let diagramZoom = 0.8;
let diagramSize = null;
let diagramRequest = 0;
let diagramEdit;
let currentDiagramCode = '';
let searchWorker = new Worker(new URL('../../vendor/inklet/app/src/search-worker.js', import.meta.url), { type: 'module' });

document.querySelector('#app').innerHTML = `
  <header class="app-header">
    ${button('panel-left-close', '显示或收起左侧栏', 'sidebar', 'id="sidebar-toggle" aria-controls="document-sidebar" aria-expanded="true"')}
    <div class="brand">
      <img class="brand-logo" src="/inkloom.png" width="24" height="24" alt="Inkloom 墨图标志">
      <span class="brand-copy">
        <span class="brand-name">Inkloom <small>墨图</small></span>
      </span>
    </div>
    <div class="file-heading" id="top-dewdrop-bar" aria-label="打开页签与边角折叠水泡栏">
      <div class="top-dewdrop-tabs" id="top-dewdrop-tabs" role="tablist" aria-label="打开页签水泡">
        <span class="dewdrop-tab is-active" id="active-file-dewdrop" role="tab" aria-selected="true" title="当前打开笔记">
          <i class="dewdrop-tab-dot" aria-hidden="true"></i>
          <span id="file-name"></span>
          <span id="dirty-dot" hidden></span>
          <button type="button" class="dewdrop-tab-close" id="active-dewdrop-close" title="关闭当前页签或放弃未保存修改" aria-label="关闭当前笔记页签">×</button>
        </span>
        <div class="dewdrop-sibling-tabs" id="dewdrop-sibling-tabs"></div>
      </div>
      <div class="corner-fold-wrap" id="corner-fold-wrap" hidden>
        <button type="button" class="corner-fold-dewdrop" id="corner-fold-dewdrop" aria-haspopup="menu" aria-expanded="false" title="边角折叠页签（点击展开其余笔记）">
          <span id="corner-fold-label">+0 折叠页签 ▾</span>
        </button>
        <div class="corner-overflow-menu" id="corner-overflow-menu" role="menu" aria-label="边角折叠页签列表" hidden></div>
      </div>
    </div>
    <div class="header-actions">
      ${button('save', '保存', 'save')}
      ${button('download', '导出文档', 'print')}
      <details class="shell-menu" id="file-menu">
        <summary class="icon-button" id="file-menu-button" role="button" aria-label="文件菜单" title="文件菜单" aria-haspopup="menu">${icon('ellipsis')}</summary>
        <div class="shell-menu-content" role="menu" aria-label="文件操作">
          <button type="button" role="menuitem" data-action="vault-open">${icon('folder-tree')}<span>打开知识库</span></button>
          <button type="button" role="menuitem" data-action="open">${icon('folder-open')}<span>打开文件</span></button>
          <button type="button" role="menuitem" data-action="save-as">${icon('save-all')}<span>另存为</span></button>
          <button type="button" role="menuitem" data-action="vault-new-folder">${icon('folder-plus')}<span>新建目录</span></button>
          <button type="button" role="menuitem" data-action="vault-reveal-active">${icon('folder-open')}<span>在本地文件夹中定位</span></button>
          <button type="button" role="menuitem" data-action="vault-delete-note">${icon('trash-2')}<span>删除当前笔记并清理引用</span></button>
          <button type="button" role="menuitem" data-action="copy-block-reference">${icon('link')}<span>复制段落引用</span></button>
          <button type="button" role="menuitem" data-action="collect-research-excerpt">${icon('book-open')}<span>选段摘录到研究</span></button>
          <button type="button" role="menuitem" data-action="toggle-reference-pane">${icon('columns-2')}<span>分屏对照参考笔记</span></button>
          <button type="button" role="menuitem" data-action="open-in-new-window">${icon('arrow-up-right')}<span>在新窗口中打开当前笔记</span></button>
          <button type="button" role="menuitem" data-action="manage-multi-windows">${icon('columns-2')}<span>多屏协同副窗口管理</span></button>
          <button type="button" role="menuitem" data-action="quick-append">${icon('sparkles')}<span>闪念静默快记</span></button>
          <button type="button" role="menuitem" data-action="vault-search-replace">${icon('search')}<span>全库受控查找替换与属性改名</span></button>
          <button type="button" role="menuitem" data-action="vault-archive">${icon('download')}<span>全库便携归档与验签 (.zip)</span></button>
          <hr>
          <button type="button" role="menuitemcheckbox" data-action="focus" aria-checked="false">${icon('focus')}<span>专注模式</span></button>
          <button type="button" role="menuitemcheckbox" data-action="typewriter" aria-checked="false">${icon('align-center')}<span>打字机模式</span></button>
          <hr>
          <button type="button" role="menuitem" data-action="open-settings">${icon('settings-2')}<span>阅读与系统设置</span></button>
          <button type="button" role="menuitem" data-action="open-guide">${icon('book-open')}<span>操作手册与语法速查</span></button>
          <button type="button" role="menuitem" data-action="about">${icon('info')}<span>关于墨图</span></button>
        </div>
      </details>
      ${button('settings-2', '设置', 'settings', 'id="settings-button"')}
    </div>
    ${button('panel-right-close', '显示或收起右侧栏', 'toggle-context-sidebar', 'id="context-sidebar-toggle" aria-controls="context-sidebar" aria-expanded="true"')}
  </header>
  <div class="app-body">
    <aside class="sidebar" id="document-sidebar" aria-label="知识库导航">
      <div class="sidebar-heading workspace-tabs">
        <strong id="navigation-title">文件</strong>
        <div class="nav-tabs loom-nav-tabs" role="tablist" aria-label="知识库导航视图">
          <button type="button" role="tab" data-tab="vault" class="active" aria-selected="true">知识库 <span id="vault-count">0</span></button>
          <button type="button" role="tab" data-tab="tags" aria-selected="false">标签 <span id="tags-count">0</span></button>
          <button type="button" role="tab" data-tab="starred" aria-selected="false">星标 <span id="starred-count">0</span></button>
          <button type="button" role="tab" data-tab="outline" aria-selected="false">大纲</button>
        </div>
        ${button('file-plus-2', '新建笔记', 'vault-new-note')}
      </div>
      <div id="vault-panel" style="display:flex;flex-direction:column;flex:1;min-height:0">
        <div class="vault-bar">
          <div class="vault-bar-top">
            <span class="vault-title-badge" id="vault-name-label" title="当前知识库">墨图示例知识库</span>
            <div class="vault-bar-actions">
              ${button('chevrons-up-down', '全部展开选中目录（或全库）至最底层', 'vault-expand-deep', 'id="vault-expand-deep-btn"')}
              ${button('chevrons-down-up', '全部收起选中目录（或全库）文件夹', 'vault-collapse-all', 'id="vault-collapse-all-btn"')}
              ${button('folder-plus', '新建目录', 'vault-new-folder', 'id="vault-new-folder-btn"')}
              ${button('folder-open', '在本地文件夹中定位当前笔记', 'vault-reveal-active', 'id="vault-reveal-btn"')}
              ${button('trash-2', '删除当前笔记并清理引用', 'vault-delete-note', 'id="vault-delete-note-btn"')}
            </div>
          </div>
          <div class="vault-filter-row">
            <input id="vault-filter-input" class="vault-filter-input" placeholder="筛选文件" aria-label="筛选知识库笔记" autocomplete="off">
            <select id="vault-sort-select" class="vault-sort-select" aria-label="目录树排序方式" title="切换目录树与笔记排序方式">
              <option value="name-asc">名称 A→Z</option>
              <option value="name-desc">名称 Z→A</option>
              <option value="date-desc">最近日期</option>
              <option value="starred-first">★ 星标优先</option>
            </select>
          </div>
          <div id="vault-batch-bar" class="vault-batch-bar" aria-label="目录树多选批量操作" hidden>
            <div class="vault-batch-head">
              <strong id="vault-batch-count">已选 0 篇</strong>
              <button type="button" id="vault-batch-clear-btn" class="small-command">取消</button>
            </div>
            <div class="vault-batch-row">
              <input id="vault-batch-tag-input" type="text" placeholder="#标签名..." aria-label="目录树批量标签">
              <button type="button" id="vault-batch-add-tag-btn" class="small-command">+标签</button>
              <button type="button" id="vault-batch-remove-tag-btn" class="small-command">-标签</button>
            </div>
            <div class="vault-batch-row">
              <select id="vault-batch-status-select" aria-label="目录树批量状态">
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
                <option value="待办">待办</option>
                <option value="草稿">草稿</option>
                <option value="已读">已读</option>
              </select>
              <button type="button" id="vault-batch-status-btn" class="small-command">改状态</button>
            </div>
            <div class="vault-batch-row">
              <input id="vault-batch-folder-input" type="text" placeholder="目标目录..." aria-label="目录树批量目标目录">
              <button type="button" id="vault-batch-move-btn" class="small-command">移入目录</button>
            </div>
          </div>
        </div>
        <div id="vault-tree-list" class="vault-tree-list" role="list" aria-label="知识库笔记列表"></div>
      </div>
      <div id="tags-panel" class="tags-tree-list" role="list" aria-label="知识库标签列表" hidden></div>
      <div id="starred-panel" class="starred-tree-list" role="list" aria-label="星标笔记列表" hidden></div>
      <nav id="outline" aria-label="文档目录" hidden></nav>
      <div id="marks-list" hidden></div>
      <div class="sidebar-footer">
        <span class="local-indicator"></span>
        <span id="vault-footer-summary">本地知识库</span>
        <small>${releaseNotes[0][0]}</small>
      </div>
      <div class="sidebar-resizer" id="sidebar-resizer" role="separator" aria-label="调整导航宽度" aria-controls="document-sidebar" aria-orientation="vertical" tabindex="0"></div>
    </aside>

    <main class="main-area">
      <div class="toolbar" id="formatting-toolbar" role="toolbar" aria-label="格式工具" hidden>
        <div class="toolbar-tools">
          ${button('undo-2', '撤销', 'undo')}${button('redo-2', '重做', 'redo')}
          <span class="tool-separator"></span>${button('heading-2', '标题', 'heading')}${button('bold', '加粗', 'bold')}${button('italic', '斜体', 'italic')}${button('strikethrough', '删除线', 'strike')}
          <span class="tool-separator"></span>${button('list', '无序列表', 'bullet')}${button('list-ordered', '有序列表', 'ordered')}${button('quote', '引用', 'quote')}${button('link', '插入双链 [[...]]', 'insert-wikilink')}
          <span class="tool-separator"></span>${button('image-plus', '插入图片', 'image')}${button('table-2', '插入表格', 'table')}${button('chevron-up', '表格按当前列升序', 'table-sort-asc', 'id="toolbar-table-sort-asc"')}${button('chevron-down', '表格按当前列降序', 'table-sort-desc', 'id="toolbar-table-sort-desc"')}${button('code-2', '代码块', 'code-block')}${button('copy', '复制当前代码块源码', 'copy-code-block', 'id="toolbar-copy-code-btn"')}${button('sigma', '数学公式', 'math')}${button('workflow', 'Mermaid 图表', 'diagram')}
        </div>
      </div>

      <div class="note-context-bar" id="note-context-bar" aria-label="当前笔记属性与脉络">
        <div class="note-breadcrumb">
          <span id="note-folder-badge">根目录</span>
          <span>/</span>
          <strong id="note-title-badge">未命名</strong>
        </div>
        <div class="note-properties-pills" id="note-properties-pills"></div>
        <div class="note-context-actions">
          <button type="button" class="property-pill interactive-property-pill discard-draft-pill" id="discard-draft-btn" data-action="discard-draft" data-pill-tone="rose" title="放弃当前笔记未保存的草稿修改并还原磁盘已保存版本" hidden>放弃修改</button>
          ${button('star', '星标笔记', 'toggle-star', 'id="star-note-button" aria-pressed="false"')}
          ${button('columns-2', '分屏对照参考笔记', 'toggle-reference-pane', 'id="pin-reference-button" aria-pressed="false"')}
          ${button('search', '正文查找与替换', 'search')}
          ${button('text-cursor-input', '显示格式工具', 'formatting-toolbar', 'aria-controls="formatting-toolbar" aria-expanded="false"')}
          <div class="view-tools" role="group" aria-label="编辑视图">
            ${button('code-2', '源码视图', 'source')}${button('book-open', '阅读编辑视图', 'rich')}
          </div>
          <details class="ux-popover-menu" id="note-tools-menu">
            <summary class="icon-button ux-popover-icon-trigger" id="note-tools-menu-trigger" role="button" aria-label="更多笔记工具" title="更多笔记工具（专注禅模式 / 幻灯片演示 / 版本对比 / 独立副窗口）" aria-haspopup="menu">${icon('ellipsis')}</summary>
            <div class="ux-popover-panel note-tools-popover" role="menu" aria-label="笔记扩展工具">
              <button type="button" class="ux-popover-item" role="menuitem" data-action="read-aloud" id="note-read-aloud-button" aria-pressed="false">${icon('volume-2')}<span>书籍朗读</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="focus" id="zen-focus-button" aria-pressed="false">${icon('focus')}<span>书卷专注禅模式 (Ctrl+Shift+F)</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="slide-present" id="slide-present-button">${icon('maximize')}<span>幻灯片全屏演示</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="mindmap-present" id="mindmap-present-button">${icon('list-tree')}<span>知识大纲与目录思维导图</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="share-card" id="note-share-card-button">${icon('image-plus')}<span>生成知识金句分享卡片 (SVG/PNG)</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="embed-inspector" id="note-embed-inspector-button">${icon('link')}<span>跨笔记块/章节内嵌巡检</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="vault-search-replace" id="note-vault-replace-button">${icon('search')}<span>全库受控查找替换与属性改名</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="note-version-diff" id="note-diff-button">${icon('history')}<span>版本对比与局部回滚</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="open-in-new-window" id="note-open-window-btn">${icon('arrow-up-right')}<span>在新窗口中打开当前笔记</span></button>
              <button type="button" class="ux-popover-item" role="menuitem" data-action="manage-multi-windows" id="multi-window-hub-btn">${icon('columns-2')}<span id="multi-window-hub-label">多屏协同副窗口管理 (1)</span></button>
            </div>
          </details>
        </div>
      </div>

      <section class="search-panel" id="search-panel" hidden aria-label="查找与替换">
        <div class="search-line">${icon('search')}<input id="search-input" aria-label="查找内容" placeholder="在当前笔记中查找" autocomplete="off"><button id="case-toggle" class="text-toggle" title="区分大小写" aria-label="区分大小写" aria-pressed="false">Aa</button><span id="search-count">0 处</span>${button('chevron-up', '上一个匹配', 'previous')}${button('chevron-down', '下一个匹配', 'next')}${button('x', '关闭查找', 'search-close')}</div>
        <div class="search-line"><input id="replace-input" aria-label="替换内容" placeholder="替换为"><button class="small-command" data-action="replace">替换</button><button class="small-command" data-action="replace-all">全部替换</button><button type="button" class="small-command" data-action="vault-search-replace" id="open-vault-replace-from-search" title="打开全库跨文件正则/预览查找替换与 YAML 属性批量改名">全库替换…</button><small id="search-time"></small></div>
      </section>

      <div id="image-access" class="external-change" role="status" hidden><span>部分图片无法读取，请确认文件路径及格式。</span><div><button type="button" class="small-command" data-action="retry-images">重新加载</button>${button('x', '关闭图片提示', 'dismiss-images')}</div></div>
      <div id="vault-change-notice" class="external-change" role="status" hidden><span id="vault-change-text"></span><button type="button" class="small-command" data-action="vault-refresh">刷新知识库</button><button type="button" class="small-command" data-action="vault-manage">查看详情</button></div>

      <div class="editor-layout" id="editor-stage">
        <div class="editor-workspace" id="workspace">
          <section class="editor-pane source-pane" aria-label="源码面板">
            <div class="pane-heading"><span>源码</span><div><span id="line-info">Ln 1, Col 1</span></div></div>
            <div id="source-editor"></div>
          </section>
          <div class="splitter" id="splitter" role="separator" aria-label="调整双栏宽度" aria-orientation="vertical" tabindex="0"></div>
          <section class="editor-pane rich-pane" aria-label="书卷读写面板">
            <div class="pane-heading"><span>笔记</span><div>${button('arrow-up-to-line', '回到文首', 'reading-start')}${button('corner-up-left', '回到上次阅读位置', 'reading-return', 'id="reading-return-button" disabled')}</div></div>
            <div id="rich-editor"></div>
          </section>
          <div class="empty-workspace" id="empty-workspace" hidden>${icon('book-open')}<span>视图已关闭</span></div>
        </div>
        <aside id="search-results-panel" class="search-results-panel" aria-label="搜索结果" hidden>
          <div class="search-results-heading"><h2>搜索结果</h2>${button('x', '关闭搜索结果', 'search-results-close')}</div>
          <div id="search-results-summary" class="search-results-summary" role="status"></div>
          <div id="search-results-list" class="search-results-list"></div>
        </aside>
        <aside id="reference-pane" class="reference-pane" aria-label="分屏对照参考笔记" hidden>
          <div class="reference-pane-heading">
            <select id="reference-note-select" aria-label="选择分屏对照笔记"></select>
            <div class="reference-pane-actions">
              <button type="button" class="icon-button" id="reference-side-btn" title="切换参考栏位置" aria-label="切换参考栏位置">${icon('columns-2')}</button>
              <button type="button" class="small-command" id="reference-cite-btn">插入摘录引用</button>
              <button type="button" class="icon-button" id="reference-close-btn" title="关闭分屏对照" aria-label="关闭分屏对照">${icon('x')}</button>
            </div>
          </div>
          <div id="reference-pane-body" class="reference-pane-body"></div>
        </aside>
      </div>

      <section class="backlinks-drawer" id="backlinks-drawer" aria-label="反向链接与潜在提及">
        <div class="backlinks-drawer-header">
          <div class="backlinks-tabs" role="tablist">
            <button type="button" class="backlinks-tab active" data-backlinks-tab="linked" role="tab" aria-selected="true">反向链接 <span id="backlinks-count">0</span></button>
            <button type="button" class="backlinks-tab" data-backlinks-tab="mentions" role="tab" aria-selected="false">潜在提及 <span id="mentions-count">0</span></button>
          </div>
          <button type="button" class="mini-toggle" data-action="toggle-backlinks-drawer" id="backlinks-collapse-btn">收起脉络</button>
        </div>
        <div class="backlinks-drawer-body" id="backlinks-drawer-body"></div>
      </section>

      <footer class="status-bar">
        <span id="save-state"></span>
        <div>
          <button type="button" class="pomodoro-status-pill" id="pomodoro-pill" data-action="toggle-pomodoro" aria-pressed="false" title="点击启动或暂停 25 分钟心流番茄钟">🍅 <span id="pomodoro-clock">25:00</span> · <span id="pomodoro-words">今日 +0 字</span></button>
          <span id="vault-graph-status"></span>
          <span id="word-count"></span>
          <span id="selection-count"></span>
          <span>UTF-8</span>
          <button data-action="zoom-out" aria-label="缩小字体">${icon('zoom-out')}</button>
          <span id="font-size">15</span>
          <button data-action="zoom-in" aria-label="放大字体">${icon('zoom-in')}</button>
        </div>
      </footer>
    </main>

    <aside class="context-sidebar" id="context-sidebar" aria-label="局部星图与关联脉络">
      <div class="sidebar-resizer" id="context-sidebar-resizer" role="separator" aria-label="调整关联栏宽度" aria-controls="context-sidebar" aria-orientation="vertical" tabindex="0"></div>
      <div class="sidebar-heading context-heading"><strong>关联</strong></div>
      <div id="context-plugin-slot" hidden></div>
      <div class="context-connections">
        <div class="context-tabs" role="tablist" aria-label="当前笔记脉络">
          <button type="button" class="context-tab-btn active" data-context-tab="backlinks" role="tab"><span class="ctx-tab-label">入链</span><b class="ctx-tab-count" id="side-in-count">0</b></button>
          <button type="button" class="context-tab-btn" data-context-tab="outgoing" role="tab"><span class="ctx-tab-label">出链</span><b class="ctx-tab-count" id="side-out-count">0</b></button>
          <button type="button" class="context-tab-btn" data-context-tab="headings" role="tab"><span class="ctx-tab-label">章节</span><b class="ctx-tab-count" id="side-heading-count">0</b></button>
          <button type="button" class="context-tab-btn" data-context-tab="mentions" role="tab"><span class="ctx-tab-label">提及</span><b class="ctx-tab-count" id="side-mention-count">0</b></button>
          <button type="button" class="context-tab-btn" data-context-tab="inspiration" role="tab"><span class="ctx-tab-label">灵感</span><b class="ctx-tab-count" id="side-inspiration-count">0</b></button>
        </div>
        <div class="context-list" id="context-list" role="list"></div>
        <details class="context-micro-flashcards" id="context-micro-flashcards">
          <summary class="context-micro-sr-summary"><span id="context-micro-sr-title">🧠 今日到期微闪卡 (0)</span></summary>
          <div class="context-micro-sr-body" id="context-micro-sr-body"></div>
        </details>
      </div>
    </aside>
    <nav class="right-dewdrop-strip" id="right-dewdrop-strip" aria-label="右侧脉络外置水泡栏">
      <button type="button" class="right-dew-pill active" data-right-dewdrop="backlinks" aria-pressed="true" title="展开右侧入链脉络">
        <span class="right-dew-label">入链</span>
        <b class="right-dew-badge" id="dew-in-count">0</b>
      </button>
      <button type="button" class="right-dew-pill" data-right-dewdrop="outgoing" aria-pressed="false" title="展开右侧出链脉络">
        <span class="right-dew-label">出链</span>
        <b class="right-dew-badge" id="dew-out-count">0</b>
      </button>
      <button type="button" class="right-dew-pill" data-right-dewdrop="headings" aria-pressed="false" title="展开右侧章节大纲">
        <span class="right-dew-label">章节</span>
        <b class="right-dew-badge" id="dew-heading-count">0</b>
      </button>
      <button type="button" class="right-dew-pill" data-right-dewdrop="mentions" aria-pressed="false" title="展开右侧智能提及与补链">
        <span class="right-dew-label">提及</span>
        <b class="right-dew-badge" id="dew-mention-count">0</b>
      </button>
      <button type="button" class="right-dew-pill" data-right-dewdrop="inspiration" aria-pressed="false" title="展开右侧实时语义灵感副驾驶">
        <span class="right-dew-label">灵感</span>
        <b class="right-dew-badge" id="dew-inspiration-count">0</b>
      </button>
    </nav>
  </div>

  <div class="wikilink-suggest" id="wikilink-suggest" role="listbox" aria-label="双链自动补全" hidden></div>
  <div class="wikilink-popover" id="wikilink-popover" role="dialog" aria-label="双链笔记预览" hidden>
    <div class="wikilink-popover-head">
      <strong id="popover-title"></strong>
      <span class="property-pill" id="popover-badge"></span>
    </div>
    <div id="popover-tags" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px"></div>
    <p class="wikilink-popover-excerpt" id="popover-excerpt"></p>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button type="button" class="small-command" id="popover-pin-btn" style="padding:5px 10px;font-size:11px">设为分屏对照</button>
      <button type="button" class="primary-command" id="popover-open-btn" style="padding:5px 12px;font-size:11px">打开笔记</button>
    </div>
  </div>

  <div class="inline-property-popover" id="inline-property-popover" role="dialog" aria-label="原位属性胶囊快切" hidden>
    <div class="inline-property-section">
      <small class="inline-property-label">点击胶囊快切笔记状态（直接写回 YAML）</small>
      <div class="segmented-control ux-pill-bar" id="inline-status-options" role="group" aria-label="笔记状态快切"></div>
    </div>
    <div class="inline-property-section">
      <small class="inline-property-label">点击切换或新增 #标签胶囊</small>
      <div class="segmented-control ux-pill-bar" id="inline-tag-suggestions" role="group" aria-label="标签胶囊建议"></div>
      <div class="inline-tag-input-row">
        <input id="inline-tag-input" class="vault-filter-input" placeholder="输入新标签名（不含 #）" aria-label="新标签名称" autocomplete="off">
        <button type="button" class="small-command" id="inline-tag-add-btn">添加标签</button>
      </div>
    </div>
  </div>

  <div class="inline-property-popover inline-privacy-popover" id="inline-privacy-popover" role="dialog" aria-label="三态隐私护栏与 AES-256-GCM 加密护盾" hidden>
    <div class="inline-property-section">
      <small class="inline-property-label">🛡️ 三态 AI 隐私隔离策略（PRIV-001 · 立即写回 YAML）</small>
      <div class="segmented-control ux-pill-bar" id="inline-privacy-options" role="group" aria-label="三态隐私隔离选项"></div>
      <small id="inline-privacy-desc" class="inline-privacy-desc"></small>
    </div>
    <div class="inline-property-section">
      <small class="inline-property-label">🔒 AES-256-GCM 认证加密落盘与会话级无感解锁（PRIV-002）</small>
      <div class="inline-tag-input-row">
        <input id="privacy-passphrase-input" type="password" class="vault-filter-input" placeholder="输入加密/解锁主口令（至少 4 位）" aria-label="AES-256-GCM 加密主口令" autocomplete="off">
        <button type="button" class="primary-command" id="privacy-encrypt-btn">🔒 加密正文</button>
        <button type="button" class="small-command" id="privacy-unlock-btn">🔓 解锁解密</button>
      </div>
      <small id="privacy-status-msg" class="inline-privacy-status"></small>
    </div>
  </div>

  <div class="inline-ai-popover" id="inline-ai-popover" role="dialog" aria-label="原位 AI 辅助预览" hidden>
    <div class="inline-ai-popover-head">
      <strong id="inline-ai-title">✨ 原位 AI 辅助预览</strong>
      <span class="property-pill" id="inline-ai-summary" data-pill-tone="teal">就绪</span>
    </div>
    <textarea id="inline-ai-preview-text" class="inline-ai-preview-text" rows="5" aria-label="AI 生成结果预览"></textarea>
    <div class="inline-ai-popover-actions">
      <button type="button" class="small-command" id="inline-ai-cancel-btn">放弃</button>
      <button type="button" class="small-command" id="inline-ai-insert-below-btn">插入到下方</button>
      <button type="button" class="primary-command" id="inline-ai-replace-btn">替换选区</button>
    </div>
  </div>

  <dialog id="quick-append-dialog" class="quick-switcher-dialog quick-append-dialog" aria-labelledby="quick-append-title">
    <form method="dialog" id="quick-append-form">
      <div class="dialog-heading">
        <h2 id="quick-append-title">⚡ 全局闪念静默快记（不打断当前写作）</h2>
        <button type="button" class="icon-button" id="quick-append-close" aria-label="关闭闪念快记">${icon('x')}</button>
      </div>
      <div class="quick-switcher-body" style="display:grid;gap:10px;padding:14px 16px">
        <label class="select-setting" for="quick-append-target">追加目标笔记
          <select id="quick-append-target">
            <option value="daily">📅 今日手记（自动定位或创建）</option>
            <option value="active">📝 当前正在编辑的笔记末尾</option>
          </select>
        </label>
        <textarea id="quick-append-input" class="vault-filter-input" style="height:76px;padding:8px" placeholder="输入闪念、灵感或待办事项（自动附带 [HH:mm] 时间戳静默写入）..." aria-label="闪念快记内容"></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <label class="checkbox-setting" style="margin:0"><input type="checkbox" id="quick-append-as-task"> 作为待办任务（- [ ] [HH:mm]）追加</label>
          <div style="display:flex;gap:8px">
            <button type="button" class="small-command" id="quick-append-cancel">取消</button>
            <button type="submit" class="primary-command" id="quick-append-submit">⚡ 静默追加</button>
          </div>
        </div>
      </div>
    </form>
  </dialog>

  <dialog id="quick-switcher-dialog" class="quick-switcher-dialog" aria-labelledby="quick-switcher-title">
    <form method="dialog">
      <div class="dialog-heading">
        <h2 id="quick-switcher-title">快速跳转与全域命令中心</h2>
        <button class="icon-button" aria-label="关闭快速跳转">${icon('x')}</button>
      </div>
      <div class="quick-switcher-body">
        <input id="quick-switcher-input" class="quick-switcher-input" placeholder="搜索笔记、#章节标题、待建主题或命令（Tab 切换分类）" autocomplete="off" aria-label="快速跳转搜索词">
        <div id="quick-switcher-filters" class="segmented-control ux-pill-bar quick-switcher-filters" role="tablist" aria-label="快速跳转语义分类"></div>
        <div id="quick-switcher-list" class="quick-switcher-list" role="listbox"></div>
      </div>
    </form>
  </dialog>

  <div class="selection-tools" id="selection-tools" role="toolbar" aria-label="阅读高亮" hidden>${icon('highlighter')}${Object.entries(highlightColors).map(([name, color]) => `<button class="color-swatch" style="--swatch:${color}" data-color="${name}" title="${swatchNames[name]}高亮" aria-label="${swatchNames[name]}高亮"></button>`).join('')}<span class="tool-separator"></span>${button('eraser', '清除高亮', 'clear-highlight')}${button('volume-2', '朗读选中文字', 'speak-selection')}${button('image-plus', '将选中文字生成知识分享卡片', 'share-selection-card', 'id="selection-share-card-btn"')}<span class="tool-separator"></span><div class="inline-ai-action-group" role="group" aria-label="原位 AI 写作辅助">${INLINE_AI_ACTIONS.map(act => `<button type="button" class="ux-pill-option inline-ai-chip" data-inline-ai-action="${act.id}" data-pill-tone="${act.tone}" title="${act.description}">✨ ${act.shortLabel}</button>`).join('')}</div></div>

  <dialog id="settings-dialog" class="settings-dialog"><form method="dialog"><div class="dialog-heading"><h2>阅读与主题设置</h2><button class="icon-button" aria-label="关闭设置">${icon('x')}</button></div><div class="settings-content">
    <fieldset><legend>客户端主题（直接复用 Inklet 15 款清透/暗色/糖果/莫兰迪主题）</legend><label class="select-setting family-setting" for="interface-family-input">色系<select id="interface-family-input">${familyOptions(interfaceFamilies)}</select></label><div class="interface-themes">${Object.entries(interfaceThemes).map(([key, theme]) => `<button type="button" class="interface-theme" data-interface-theme="${key}" aria-pressed="false"><span style="background:linear-gradient(135deg,${theme.base},${theme.secondary})"></span>${theme.name}</button>`).join('')}</div></fieldset>
    <label class="select-setting" for="outline-side-input">导航栏位置<select id="outline-side-input"><option value="left">左侧</option><option value="right">右侧</option></select></label>
    <button type="button" class="small-command shortcut-settings-button" data-action="shortcuts">自定义快捷键</button>
    <fieldset><legend>源码背景</legend><label class="select-setting family-setting" for="source-family-input">色系<select id="source-family-input" data-paper-family="leftTheme">${familyOptions(paperFamilies)}</select></label><div class="theme-options">${backgroundOptions('leftTheme')}</div></fieldset>
    <fieldset><legend>阅读背景</legend><label class="select-setting family-setting" for="reader-family-input">色系<select id="reader-family-input" data-paper-family="rightTheme">${familyOptions(paperFamilies)}</select></label><div class="theme-options">${backgroundOptions('rightTheme')}</div></fieldset>
    <button type="button" class="small-command" data-action="unify-theme">统一两栏背景</button>
    <label class="checkbox-setting"><input id="paper-input" type="checkbox">纸张纹理</label>
    <label class="select-setting" for="reading-font-input">正文字体<select id="reading-font-input"><option value="book">书卷宋体</option><option value="sans">清晰黑体</option><option value="kai">楷书风格</option></select></label>
    <label class="range-setting">正文字号 <output id="font-output">15 px</output><input id="font-input" type="range" min="14" max="24" step="1"></label>
    <label class="range-setting">行距 <output id="line-height-output">1.75 倍</output><input id="line-height-input" type="range" min="1.6" max="2.6" step="0.05"></label>
    <label class="range-setting">段间距 <output id="paragraph-gap-output">1.0 倍</output><input id="paragraph-gap-input" type="range" min="0.5" max="1.6" step="0.1"></label>
    <label class="range-setting">阅读宽度 <output id="reading-width-output">740 px</output><input id="reading-width-input" type="range" min="520" max="960" step="40"></label>
    <label class="range-setting">高亮不透明度 <output id="opacity-output">30%</output><input id="opacity-input" type="range" min="15" max="50" step="5"></label>
    <label class="checkbox-setting"><input id="sync-input" type="checkbox">两栏同步滚动</label>
    <label class="checkbox-setting"><input id="restore-reading-input" type="checkbox">打开时恢复阅读位置</label>
    <label class="checkbox-setting"><input id="search-results-input" type="checkbox">显示搜索结果侧栏</label>
    <label class="checkbox-setting"><input id="ctrl-wheel-input" type="checkbox">Ctrl + 滚轮调整字号</label>
    <label class="checkbox-setting"><input id="compress-input" type="checkbox">插入图片时压缩至最长边 1920 px</label>
    <label class="checkbox-setting"><input id="embed-images-input" type="checkbox">保存时内嵌图片到 MD</label>
    <fieldset class="code-colors-settings"><legend>代码配色</legend><label class="select-setting" for="code-color-language">编程语言<select id="code-color-language"><option value="default">所有语言</option>${codeLanguages.filter(([value]) => value !== 'plaintext').map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><div class="code-colors-grid">${Object.entries(codeColorLabels).map(([key, label]) => `<label>${label}<input type="color" data-code-color="${key}" aria-label="${label}颜色" value="${codeColorDefaults[key]}"></label>`).join('')}</div><button type="button" class="small-command" data-action="code-colors-reset">恢复代码默认配色</button></fieldset>
  </div><div class="dialog-footer"><button class="primary-command">完成</button></div></form></dialog>

  <dialog id="embed-warning-dialog" class="history-error-dialog" aria-labelledby="embed-warning-title"><form method="dialog"><div class="dialog-heading"><h2 id="embed-warning-title">开启图片内嵌保存</h2><button class="icon-button" value="cancel" aria-label="取消开启">${icon('x')}</button></div><div class="history-error-content"><p>开启后，保存或另存为会把本地图片写进 MD。建议先另存副本，保留原始引用。</p></div><div class="dialog-footer"><button class="small-command" value="cancel">取消</button><button class="primary-command" value="enable">了解并开启</button></div></form></dialog>
  <dialog id="save-images-dialog" class="history-error-dialog" aria-labelledby="save-images-title"><form method="dialog"><div class="dialog-heading"><h2 id="save-images-title">部分图片未能内嵌</h2><button class="icon-button" value="cancel" aria-label="取消保存">${icon('x')}</button></div><div class="history-error-content"><p>继续保存会保留以下图片的原引用：</p><ul id="save-image-issues"></ul></div><div class="dialog-footer"><button class="small-command" value="cancel">返回检查</button><button class="primary-command" value="save">保留原引用并保存</button></div></form></dialog>
  <dialog id="shortcuts-dialog" class="shortcuts-dialog" aria-labelledby="shortcuts-title"><form method="dialog"><div class="dialog-heading"><h2 id="shortcuts-title">自定义快捷键</h2><button class="icon-button" aria-label="关闭快捷键设置">${icon('x')}</button></div><div class="shortcuts-content" id="shortcuts-list"></div><p id="shortcut-error" role="alert"></p><div class="dialog-footer"><button type="button" class="small-command" data-action="shortcuts-reset">恢复默认</button><button type="button" class="primary-command" data-action="shortcuts-save">保存快捷键</button></div></form></dialog>
  <dialog id="export-dialog" class="export-dialog" aria-labelledby="export-title"><form id="export-form"><div class="dialog-heading"><h2 id="export-title">导出文档（自动净化双链语法）</h2><button type="button" class="icon-button" data-action="export-close" aria-label="关闭导出">${icon('x')}</button></div><div class="export-content"><label class="select-setting" for="export-format">文件格式<select id="export-format"><option value="pdf">PDF</option><option value="html">HTML</option><option value="docx">Word (.docx)</option><option value="wiki-html">单文件离线知识微站 (.html)</option><option value="epub">EPUB 3.0 电子书 (.epub)</option></select></label><label class="select-setting" id="export-wiki-scope-field" for="export-wiki-scope" hidden>收录范围<select id="export-wiki-scope"><option value="linked">当前笔记及一跳双链邻居</option><option value="folder">当前目录全部笔记</option><option value="vault">全库全部笔记</option></select></label><p id="export-status" role="status"></p></div><div class="dialog-footer"><button type="button" class="small-command" data-action="export-close">取消</button><button type="submit" class="primary-command" id="export-submit">导出</button></div></form></dialog>

  <dialog id="slide-presenter-dialog" class="slide-presenter-dialog" aria-labelledby="slide-presenter-title">
    <header class="slide-presenter-header">
      <div class="slide-presenter-brand">
        <strong id="slide-presenter-title">幻灯片演示</strong>
        <span class="property-pill" id="slide-counter-pill" data-pill-tone="teal">1 / 1</span>
      </div>
      <div class="segmented-control ux-pill-bar slide-dots-bar" id="slide-dots-bar" role="tablist" aria-label="幻灯片页码水泡导航"></div>
      <div class="slide-presenter-controls">
        <button type="button" class="small-command" id="slide-toggle-notes" aria-pressed="true">演讲备注</button>
        <button type="button" class="small-command" id="slide-toggle-theme">明暗切换</button>
        <button type="button" class="icon-button" id="slide-close-btn" aria-label="退出幻灯片演示">${icon('x')}</button>
      </div>
    </header>
    <div class="slide-presenter-stage-wrap">
      <article class="slide-stage-card" id="slide-stage-card">
        <div class="slide-stage-body" id="slide-stage-body"></div>
      </article>
      <aside class="slide-speaker-notes" id="slide-speaker-notes" aria-label="演讲者备注"></aside>
    </div>
    <footer class="slide-presenter-footer">
      <button type="button" class="small-command" id="slide-prev-btn">← 上一页</button>
      <div class="slide-progress-track"><div class="slide-progress-fill" id="slide-progress-fill"></div></div>
      <button type="button" class="primary-command" id="slide-next-btn">下一页 →</button>
    </footer>
  </dialog>

  <dialog id="mindmap-presenter-dialog" class="quick-switcher-dialog mindmap-presenter-dialog" aria-labelledby="mindmap-presenter-title">
    <div class="dialog-heading">
      <h2 id="mindmap-presenter-title">🌿 知识大纲与多级目录层级思维导图</h2>
      <button type="button" class="icon-button" id="mindmap-close-btn" aria-label="关闭思维导图">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <label class="select-setting" for="mindmap-mode-select" style="margin:0;flex:1">导图范围
          <select id="mindmap-mode-select">
            <option value="note">📄 当前笔记章节与双链结构</option>
            <option value="folder">📁 选中目录（或全库）多级目录结构</option>
          </select>
        </label>
        <label class="select-setting" for="mindmap-folder-select" id="mindmap-folder-field" style="margin:0;flex:1" hidden>目标目录
          <select id="mindmap-folder-select" aria-label="选择目录思维导图范围"></select>
        </label>
        <div class="task-row-actions">
          <button type="button" class="small-command" id="mindmap-expand-all-btn">全部展开至最底层</button>
          <button type="button" class="small-command" id="mindmap-collapse-all-btn">收起子级分支</button>
          <button type="button" class="small-command" id="mindmap-copy-svg-btn">复制导图 SVG</button>
        </div>
      </div>
      <div class="segmented-control ux-pill-bar" id="mindmap-stats-bar" aria-label="思维导图与块引用统计"></div>
      <div class="mindmap-stage-viewport" id="mindmap-stage-viewport" role="region" aria-label="交互式知识大纲思维导图画布"></div>
    </div>
  </dialog>

  <dialog id="share-card-dialog" class="quick-switcher-dialog share-card-dialog" aria-labelledby="share-card-title">
    <div class="dialog-heading">
      <h2 id="share-card-title">🖼️ 笔记知识金句与分享卡片离线渲染器</h2>
      <button type="button" class="icon-button" id="share-card-close-btn" aria-label="关闭分享卡片">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <label class="select-setting" for="share-card-theme-select" style="margin:0;flex:1">卡片版式
          <select id="share-card-theme-select" aria-label="选择知识分享卡片主题版式">
            ${Object.values(KNOWLEDGE_CARD_THEMES).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
        </label>
        <label class="select-setting" for="share-card-author-input" style="margin:0;flex:1">署名印章
          <input id="share-card-author-input" type="text" placeholder="达芬奇Vincent · 墨图" aria-label="分享卡片作者署名">
        </label>
        <div class="task-row-actions">
          <button type="button" class="small-command" id="share-card-copy-svg-btn">复制卡片 SVG</button>
          <button type="button" class="small-command" id="share-card-download-svg-btn">导出 SVG</button>
          <button type="button" class="primary-command" id="share-card-download-png-btn">导出高清 PNG</button>
        </div>
      </div>
      <textarea id="share-card-custom-text" class="ai-sr-anki-import-input" rows="2" placeholder="可自由微调卡片金句内容（自动净化双链语法）..." aria-label="分享卡片精选正文"></textarea>
      <div class="segmented-control ux-pill-bar" id="share-card-stats-bar" aria-label="分享卡片尺寸与字数统计"></div>
      <div class="mindmap-stage-viewport share-card-preview-stage" id="share-card-preview-stage" role="region" aria-label="知识金句分享卡片实时预览"></div>
    </div>
  </dialog>

  <dialog id="vault-archive-dialog" class="quick-switcher-dialog vault-archive-dialog" aria-labelledby="vault-archive-title">
    <div class="dialog-heading">
      <h2 id="vault-archive-title">📦 全库便携归档 (.inkloom-vault.zip) 与 SHA-256 完整性验签还原</h2>
      <button type="button" class="icon-button" id="vault-archive-close-btn" aria-label="关闭全库便携归档">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <small id="vault-archive-summary">支持将当前知识库多级目录笔记与 SHA-256 签名清单打包为离线便携归档包，或选择归档包执行逐文件完整性验签与无损差异还原。</small>
        <div class="task-row-actions">
          <button type="button" class="primary-command" id="vault-archive-export-btn">📦 打包导出全库归档 (.zip)</button>
          <button type="button" class="small-command" id="vault-archive-verify-latest-btn" disabled>🛡️ 验签自检当前归档包</button>
          <button type="button" class="small-command" id="vault-archive-import-btn">🔍 选择归档包验签对账</button>
          <input type="file" id="vault-archive-file-input" accept=".zip,.inkloom-vault.zip" hidden>
          <button type="button" class="small-command" id="vault-archive-restore-btn" disabled>♻️ 无损还原缺失与变更笔记</button>
        </div>
      </div>
      <div class="segmented-control ux-pill-bar" id="vault-archive-stats-bar" aria-label="归档验签与对账统计"></div>
      <div class="note-diff-hunks-list" id="vault-archive-items-list" role="region" aria-label="归档文件校验与差异列表"></div>
    </div>
  </dialog>

  <dialog id="embed-inspector-dialog" class="quick-switcher-dialog embed-inspector-dialog" aria-labelledby="embed-inspector-title">
    <div class="dialog-heading">
      <h2 id="embed-inspector-title">🔗 跨笔记块引用与章节内嵌巡检对比台</h2>
      <button type="button" class="icon-button" id="embed-inspector-close-btn" aria-label="关闭内嵌引用巡检">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <label class="select-setting" for="embed-inspector-scope-select" style="margin:0;flex:1">巡检范围
          <select id="embed-inspector-scope-select" aria-label="选择跨笔记内嵌引用巡检范围">
            <option value="note">📄 当前笔记 ![[块/章节]] 内嵌引用</option>
            <option value="vault">🌐 全库全部跨笔记内嵌引用</option>
          </select>
        </label>
        <div class="task-row-actions">
          <button type="button" class="small-command" id="embed-inspector-refresh-btn">刷新扫描</button>
          <button type="button" class="primary-command" id="embed-inspector-repair-all-btn" disabled>🔧 一键修复可对齐锚点</button>
        </div>
      </div>
      <div class="segmented-control ux-pill-bar" id="embed-inspector-stats-bar" aria-label="跨笔记内嵌引用健康统计"></div>
      <div class="note-diff-hunks-list" id="embed-inspector-list" role="region" aria-label="跨笔记内嵌引用明细列表"></div>
    </div>
  </dialog>

  <dialog id="vault-replace-dialog" class="quick-switcher-dialog vault-replace-dialog" aria-labelledby="vault-replace-title">
    <div class="dialog-heading">
      <h2 id="vault-replace-title">🔍 全库跨文件受控预览查找替换与 YAML 属性改名</h2>
      <button type="button" class="icon-button" id="vault-replace-close-btn" aria-label="关闭全库查找替换">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <label class="select-setting" for="vault-replace-mode" style="margin:0;flex:1">替换模式
          <select id="vault-replace-mode" aria-label="选择全库替换模式">
            <option value="text">📝 跨文件正文查找与正则替换（保护代码块与双链目标）</option>
            <option value="yaml-key">🏷️ YAML Frontmatter 属性键名批量重命名</option>
          </select>
        </label>
        <label class="select-setting" for="vault-replace-folder" style="margin:0;flex:1">限定目录（可选）
          <input id="vault-replace-folder" type="text" placeholder="留空扫描全库，如：notes" aria-label="全库替换限定目录">
        </label>
      </div>
      <div class="vault-replace-inputs-row">
        <input id="vault-replace-query" type="text" placeholder="查找内容（或正则表达式 / 原 YAML 属性键名）..." aria-label="全库查找内容">
        <input id="vault-replace-replacement" type="text" placeholder="替换为（支持 $1 分组 / 新 YAML 属性键名）..." aria-label="全库替换为">
      </div>
      <div class="vault-replace-options-row" id="vault-replace-text-options">
        <label class="checkbox-setting"><input type="checkbox" id="vault-replace-regex">正则表达式</label>
        <label class="checkbox-setting"><input type="checkbox" id="vault-replace-case">区分大小写</label>
        <label class="checkbox-setting"><input type="checkbox" id="vault-replace-skip-code" checked>跳过代码块</label>
        <label class="checkbox-setting"><input type="checkbox" id="vault-replace-protect-links" checked>保护 [[双链]] 目标</label>
      </div>
      <div class="note-diff-toolbar">
        <small id="vault-replace-summary">先预览逐行红绿差异，确认无误后再批量写入；执行后自动保留内存安全回退点支持一键整批撤销。</small>
        <div class="task-row-actions">
          <button type="button" class="small-command" id="vault-replace-preview-btn">🔍 预览全库差异</button>
          <button type="button" class="primary-command" id="vault-replace-apply-btn" disabled>✅ 执行受控替换</button>
          <button type="button" class="small-command" id="vault-replace-undo-btn" disabled>↩️ 撤销上次批量替换</button>
        </div>
      </div>
      <div class="segmented-control ux-pill-bar" id="vault-replace-stats-bar" aria-label="全库查找替换统计"></div>
      <div class="note-diff-hunks-list" id="vault-replace-preview-list" role="region" aria-label="全库查找替换逐行差异预览"></div>
    </div>
  </dialog>

  <dialog id="note-diff-dialog" class="quick-switcher-dialog note-diff-dialog" aria-labelledby="note-diff-title">
    <div class="dialog-heading">
      <h2 id="note-diff-title">🕒 当前笔记逐行历史 Diff 与段落级局部回滚</h2>
      <button type="button" class="icon-button" id="note-diff-close" aria-label="关闭版本对比">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <label class="select-setting" for="note-diff-baseline-select" style="margin:0;flex:1">对比基线版本
          <select id="note-diff-baseline-select">
            <option value="saved">💾 已保存磁盘基线版（对比当前未保存改动）</option>
            <option value="initial">🕒 本次打开初始版（对比打开以来的改动）</option>
          </select>
        </label>
        <button type="button" class="small-command" id="note-diff-revert-all">全部还原至基线</button>
      </div>
      <div class="segmented-control ux-pill-bar" id="note-diff-stats-bar" aria-label="版本差异统计胶囊"></div>
      <div class="note-diff-hunks-list" id="note-diff-hunks-list" role="region" aria-label="逐行差异与局部回滚列表"></div>
    </div>
  </dialog>

  <dialog id="multi-window-dialog" class="quick-switcher-dialog multi-window-dialog" aria-labelledby="multi-window-title">
    <div class="dialog-heading">
      <h2 id="multi-window-title">🪟 跨原生窗口多屏协同与副窗口管理</h2>
      <button type="button" class="icon-button" id="multi-window-close" aria-label="关闭多屏协同管理">${icon('x')}</button>
    </div>
    <div class="note-diff-body">
      <div class="note-diff-toolbar">
        <small id="multi-window-summary">主副窗口共享单实例 VaultStore 写入锁与实时同步总线（支持向下拖拽顶部页签水泡直接拆出副窗口）</small>
        <div class="task-row-actions">
          <button type="button" class="small-command" id="mw-spawn-note-btn">↗ 拆出当前笔记</button>
          <button type="button" class="small-command" id="mw-spawn-graph-btn">↗ 拆出知识星图</button>
          <button type="button" class="small-command" id="mw-spawn-whiteboard-btn">↗ 拆出手绘白板</button>
          <button type="button" class="small-command" id="mw-spawn-reader-btn">↗ 拆出原件精读</button>
          <button type="button" class="small-command" id="multi-window-sync-test-btn">⚡ 广播跨窗同步</button>
          <button type="button" class="small-command danger-command" id="multi-window-close-all-btn">关闭全部副窗口</button>
        </div>
      </div>
      <div class="note-diff-hunks-list" id="multi-window-list" role="region" aria-label="当前活跃窗口列表"></div>
      <div class="ai-citation-card" id="multi-window-sync-log" aria-label="跨窗口同步总线状态">暂无跨窗口同步事件</div>
    </div>
  </dialog>

  <dialog id="onenote-com-dialog" class="quick-switcher-dialog onenote-com-dialog" aria-labelledby="onenote-com-title">
    <div class="dialog-heading">
      <h2 id="onenote-com-title">从 OneNote 迁入</h2>
      <button type="button" class="icon-button" id="onenote-com-close" aria-label="关闭 OneNote 迁入工作台">${icon('x')}</button>
    </div>
    <div class="onenote-com-body">
      <ol class="onenote-step-indicator" aria-label="迁入进度"><li data-import-step="0">来源</li><li data-import-step="1">页面</li><li data-import-step="2">核对</li></ol>
      <section id="onenote-source-step" class="onenote-step-pane">
        <p id="onenote-com-provider-badge" role="status">未连接</p>
        <div class="onenote-source-actions">
          <button type="button" class="phase-command" id="onenote-com-scan-btn">${icon('link')}<span>连接桌面 OneNote</span></button>
          <button type="button" class="phase-command" id="onenote-com-file-btn">${icon('folder-open')}<span>选择导出文件</span></button>
          <input type="file" id="onenote-com-file-input" accept=".xml,.mht,.mhtml,.html,.htm" hidden>
        </div>
      </section>
      <section id="onenote-pages-step" class="onenote-step-pane" hidden>
        <div class="compiler-step-header-row"><strong>选择页面</strong><button type="button" class="compiler-link-action" id="onenote-select-all-btn">全选</button></div>
        <div class="onenote-hierarchy-tree" id="onenote-hierarchy-tree" aria-label="OneNote 笔记本层级"></div>
        <label class="onenote-target-field" for="onenote-com-target-folder">目标目录<input type="text" id="onenote-com-target-folder" value="OneNote迁入"></label>
      </section>
      <section id="onenote-review-step" class="onenote-step-pane" hidden>
        <div id="onenote-com-stats-grid"></div>
        <details id="onenote-preview-details"><summary>页面预览</summary><article class="ai-formatted-answer" id="onenote-com-preview"></article></details>
        <label class="checkbox-setting"><input type="checkbox" id="onenote-open-after">完成后打开笔记</label>
      </section>
      <p class="ai-exec-summary" id="onenote-com-status" role="status"></p>
    </div>
    <div class="dialog-footer"><button type="button" class="small-command" id="onenote-step-back" hidden>上一步</button><button type="button" class="primary-command" id="onenote-step-next" hidden>核对迁入</button><button type="button" class="primary-command" id="onenote-com-commit-btn" hidden disabled>确认迁入</button></div>
  </dialog>

  <dialog id="about-dialog" class="about-dialog" aria-labelledby="about-title"><form method="dialog">
    <div class="dialog-heading"><h2 id="about-title">软件说明</h2><button class="icon-button" aria-label="关闭软件说明">${icon('x')}</button></div>
    <div class="about-content">
      <div class="about-product"><img class="brand-logo" src="/inkloom.png" width="64" height="64" alt="Inkloom 墨图标志"><div><strong>Inkloom 墨图</strong><span>${releaseNotes[0][0]} · 一念落笔，万象成图。</span></div></div>
      <dl class="about-details">
        <div><dt>软件编写作者</dt><dd>达芬奇Vincent</dd></div>
        <div><dt>联系方式</dt><dd><span>微信号</span> <code class="contact-id">seveniear_7</code></dd></div>
        <div><dt>核心特性</dt><dd>纯本地 Markdown 知识库、全维双链、局部星图与万象知识图谱、双栏书卷排版与净化导出</dd></div>
      </dl>
      <section class="about-updates" aria-labelledby="about-updates-title"><h3 id="about-updates-title">版本更新</h3><div class="release-notes" tabindex="0" role="region" aria-label="版本更新记录"><table class="release-table"><thead><tr><th scope="col">版本</th><th scope="col">更新内容</th><th scope="col">日期</th></tr></thead><tbody>${releaseNotes.map(([version, summary, date]) => `<tr><td class="release-version">${version}</td><td class="release-summary">${summary}</td><td class="release-date">${date ? `<time datetime="${date}">${date}</time>` : '未记录'}</td></tr>`).join('')}</tbody></table></div></section>
    </div>
    <div class="dialog-footer"><button class="primary-command">关闭</button></div>
  </form></dialog>

  <dialog id="edit-dialog" class="edit-dialog"><form id="edit-form"><div class="dialog-heading"><h2 id="edit-title"></h2><button type="button" data-action="edit-close" class="icon-button" aria-label="关闭编辑">${icon('x')}</button></div><div class="edit-content" id="edit-content"></div><div class="dialog-footer"><button type="button" class="small-command" data-action="edit-close">取消</button><button type="button" class="small-command danger-command" id="edit-discard-btn" hidden>不保存直接退出</button><button type="submit" class="primary-command" id="edit-submit-btn">确定</button></div></form></dialog>
  <dialog id="diagram-dialog" class="diagram-dialog" aria-labelledby="diagram-title"><div class="dialog-heading"><h2 id="diagram-title">图表</h2><div class="diagram-view-controls">${button('zoom-out', '缩小图表', 'diagram-zoom-out')}<output id="diagram-zoom">100%</output>${button('zoom-in', '放大图表', 'diagram-zoom-in')}${button('maximize', '适应宽度', 'diagram-fit')}<span class="tool-separator"></span>${button('copy', '复制高清图表或 SVG', 'diagram-copy-image', 'id="diagram-copy-image-btn"')}${button('file-text', '复制图表源码', 'diagram-copy-source', 'id="diagram-copy-source-btn"')}${button('code-2', '编辑图表源码', 'diagram-source')}${button('x', '关闭图表', 'diagram-close')}</div></div><div id="diagram-viewport" class="diagram-viewport" tabindex="0" aria-label="图表浏览区"><div id="diagram-stage"></div></div></dialog>
  <div class="table-tools" id="table-tools" hidden aria-label="表格操作">${button('rows-3', '下方插入行', 'row-add')}${button('columns-2', '右侧插入列', 'column-add')}${button('align-left', '当前列左对齐', 'table-align-left', 'id="table-align-left-btn"')}${button('align-center', '当前列居中对齐', 'table-align-center', 'id="table-align-center-btn"')}${button('align-right', '当前列右对齐', 'table-align-right', 'id="table-align-right-btn"')}${button('copy', '复制当前列数据', 'table-copy-column', 'id="table-copy-column-btn"')}${button('chevron-up', '当前列升序', 'table-sort-asc', 'id="table-sort-asc-btn"')}${button('chevron-down', '当前列降序', 'table-sort-desc', 'id="table-sort-desc-btn"')}${button('sigma', '生成数值列汇总行 (Σ 合计/均值)', 'table-summary', 'id="table-summary-btn"')}${button('trash-2', '删除当前行', 'row-delete')}${button('x', '删除当前列', 'column-delete')}</div>
  <div id="vault-tree-context-menu" class="vault-tree-context-menu" role="menu" aria-label="目录树右键菜单" hidden></div>
  <input type="file" id="image-input" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple hidden>
  <div id="toast" role="status" hidden></div>
`;

createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.7 } });
const find = selector => document.querySelector(selector);
const matchesForSource = () => results;
const matchesForRich = () => selectedResult >= 250 ? [...results.slice(0, 250), results[selectedResult]] : results.slice(0, 250);

let sessionInitialWordBaseline = null;
let sessionPositiveDeltaWords = 0;
let lastDocumentTotalWords = 0;
let pomodoroTimerId = null;
let pomodoroRemainingSec = 1500;
let pomodoroRunning = false;
let inlineAiSelectionRange = null;
let activeSlideDeck = null;
let activeSlideIndex = 0;
let slideShowNotes = true;
let slideDarkTheme = false;
const noteInitialSourceById = new Map();
const noteSavedBaselineById = new Map();

const common = {
  source: documentSession.source,
  marks: () => documentSession.highlights,
  codeColors: () => settings.codeColors || {},
  undo: () => history('undo'),
  redo: () => history('redo'),
  save: () => save(),
  search: () => toggleSearch(true),
  focus: pane => { activePane = pane; },
  selection: setSelection,
  typewriter: () => settings.typewriter,
  paste: event => pasteImages(event),
  drop: event => dropFiles(event),
  scroll: pane => synchronizeScroll(pane),
};

const sourceEditor = new SourceEditor(find('#source-editor'), {
  ...common,
  matches: matchesForSource,
  change: changes => {
    for (const change of [...changes].reverse()) changeDocument(change, 'source');
  },
  codeColors: () => paneCodeColors(appearance?.activePack() ? (appearance.mode() === 'dark' ? 'graphite' : 'white') : settings.leftTheme, settings.codeColors),
  dark: () => appearance?.activePack() ? appearance.mode() === 'dark' : themes[settings.leftTheme]?.family === 'dark',
});

const richEditor = new RichEditor(find('#rich-editor'), {
  ...common,
  matches: matchesForRich,
  sourceText: () => documentSession.source,
  codeColors: () => paneCodeColors(appearance?.activePack() ? (appearance.mode() === 'dark' ? 'graphite' : 'white') : settings.rightTheme, settings.codeColors),
  diagramTheme: () => (appearance?.activePack() ? appearance.mode() === 'dark' : themes[settings.rightTheme]?.family === 'dark') ? 'dark' : 'neutral',
  parsed: updateWordCount,
  navigate: reveal,
  diagram: (code, edit) => openDiagramPreview(code, edit).catch(showError),
  change: change => changeDocument(change, 'rich'),
  edit: openCodeDialog,
  asset: assetUrl,
  image: (path, alt) => openImagePreview(path, alt).catch(showError),
  imageError: (path, image) => { if (desktop && image.isConnected && !/^(?:https?:|data:|\/\/)/i.test(path)) find('#image-access').hidden = false; },
  imageLoaded: () => { if (!find('#rich-editor .image-missing')) find('#image-access').hidden = true; },
  link: url => {
    if (typeof url === 'string' && url.startsWith('#inkloom-reader?')) {
      const loc = parseDocumentSourceLink(url);
      if (loc) {
        window.__inkloomPendingReaderTarget = loc;
        window.__inkloomPendingSubTab = { viewId: 'research-desk:research-view', subKey: 'reader' };
        workbench?.openViewById('research-desk:research-view')
          .then(() => window.dispatchEvent(new CustomEvent('inkloom:research-open-reader', { detail: loc })))
          .catch(showError);
      }
      return;
    }
    if (/^https?:\/\//i.test(url)) call('external', { url }).catch(showError);
  },
});

// Mount WikiLink & Inline Tag Plugin into RichEditor
const resolveWikiTarget = (target, heading) => {
  if (!vaultGraph) return { exists: true };
  if (!target && heading) return { exists: true, noteId: activeNoteIdentity };
  const targetId = vaultGraph.resolveTargetId(target, activeNoteIdentity);
  return { exists: Boolean(targetId && vaultGraph.nodeMap.get(targetId)?.exists), noteId: targetId };
};
resolveWikiTarget.version = () => graphVersion;
let embedResolverVersion = -1; let embedResolver;
function embeddedNoteView(reference, sharedBudget, options) {
  if (embedResolverVersion !== graphVersion) { embedResolver = createEmbedResolver(vaultGraph?.notes || []); embedResolverVersion = graphVersion; }
  return renderNoteEmbed(embedResolver(reference, activeNoteIdentity, sharedBudget), { open: (id, heading) => openVaultNoteById(id, heading).catch(showError), asset: assetUrl, external: url => call('external', { url }).catch(showError), theme: appearance?.mode() === 'dark' ? 'dark' : 'neutral', inline: Boolean(options?.inline) });
}

richEditor.plugins.push(wikiLinkPlugin({
  resolveTarget: resolveWikiTarget,
  getCalloutStyle: () => settings.calloutStyle || 'soft',
  onFollowLink: link => followWikiLink(link).catch(showError),
  onHoverLink: info => scheduleWikiPopover(info),
  onLeaveLink: () => hideWikiPopoverDelayed(),
  onClickTag: tag => filterByTag(tag),
  embedView: embeddedNoteView,
}));
richEditor.load(documentSession.source, richEditor.parsed);

scrollSync = new ScrollSynchronizer({
  source: sourceEditor,
  rich: richEditor,
  enabled: () => settings.syncScroll && settings.source && settings.rich,
  visible: pane => pane === 'source' ? settings.source : settings.rich,
});

readingTracker = new ReadingPositionTracker({
  current: () => ({ id: recoveryDocumentId, path: documentInfo.path }),
  read: id => desktop ? call('readReadingPosition', { documentId: id }) : Promise.resolve(null),
  write: (id, position) => desktop ? call('saveReadingPosition', { documentId: id, position }) : Promise.resolve(),
  capture: captureReadingPosition,
  available: point => {
    find('#reading-return-button').disabled = !point;
    find('#reading-return-button').title = point ? '回到上次阅读位置' : '暂无阅读记录';
  },
  onError: () => {},
});

function syncActiveNoteIntoVault() {
  const existing = vaultState.notes.find(n => n.id === activeNoteIdentity || (documentInfo.path && n.path?.toLowerCase() === documentInfo.path.toLowerCase()));
  if (existing) {
    activeNoteIdentity = existing.id;
    existing.source = documentSession.source;
    existing.name = documentInfo.name;
    if (documentInfo.path) existing.path = documentInfo.path;
    if (!dirty() && documentInfo.hash) existing.hash = documentInfo.hash;
  }
}

function showVaultWarnings(message = '') {
  const conflicts = [...workspace.entries.values()].filter(entry => entry.externalConflict);
  const warnings = vaultState.warnings || [];
  const recovery = vaultState.pendingRecovery || [];
  const text = [message, vaultGraph?.cacheError ? `索引缓存：${vaultGraph.cacheError}。原始笔记未改动，可刷新重建。` : '', conflicts.length ? `${conflicts.length} 篇笔记有外部变化，编辑内容已保留。请另存副本后核对磁盘版本。` : '', warnings.length ? `${warnings.length} 项扫描警告：${warnings[0]}` : '', recovery.length ? `发现 ${recovery.length} 项未完成改名事务，备份：${recovery[0]}` : ''].filter(Boolean).join(' ');
  find('#vault-change-notice').hidden = !text; find('#vault-change-text').textContent = text;
  find('#vault-change-notice').title = [...warnings, ...recovery].join('\n');
}

let refreshPending = false;
let refreshingVault = false;
async function refreshExternalVault(force = false) {
  if (saving || vaultMutationBusy || workspaceBusy || composing || refreshingVault) { refreshPending = true; return; }
  refreshingVault = true; refreshPending = false;
  richEditor.flush(); captureDocumentState();
  const previous = new Map(vaultState.notes.map(note => [note.id, note]));
  try {
    const next = await call(force ? 'rescanVault' : 'vaultInfo');
    if (!next || next.vaultPath !== vaultState.vaultPath) return;
    const latest = new Map(next.notes.map(note => [note.id, note]));
    let activeReload = null;
    for (const entry of workspace.entries.values()) {
      const oldNote = [...previous.values()].find(note => note.path?.toLowerCase() === entry.info.path?.toLowerCase());
      if (!oldNote) continue;
      const newNote = latest.get(oldNote.id);
      const isDirty = entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty;
      const baseline = entry.state?.info.hash || entry.info.hash || oldNote.hash;
      const changed = !newNote || newNote.path !== oldNote.path || (baseline && newNote.hash ? newNote.hash !== baseline : newNote.source !== oldNote.source);
      if (!changed) { entry.externalConflict = false; continue; }
      if (isDirty) { entry.externalConflict = true; if (newNote && entry.state) newNote.source = entry.state.session.source; continue; }
      if (!newNote) { entry.externalConflict = true; continue; }
      const previousRevision = entry.state?.session.revision;
      const record = await call('reloadVaultNote', { documentId: entry.id, path: newNote.path });
      if (entry.state?.session.revision !== previousRevision) { entry.externalConflict = true; if (entry.state) newNote.source = entry.state.session.source; continue; }
      const state = createDocumentState(record); state.info.relativePath = record.relativePath; state.info.noteId = newNote.id;
      entry.state = state; entry.info = { ...entry.info, ...state.info }; entry.rendered = null; entry.stored = false; entry.externalConflict = false;
      if (entry.id === recoveryDocumentId) activeReload = entry;
    }
    vaultState = next;
    if (activeReload) {
      workspace.activeId = null; recoveryDocumentId = null; activeNoteIdentity = null; documentInfo = { name: '', path: null, hash: null };
      recoveryWriter?.reset(); clearTimeout(outlineTimer);
      if (!await switchDocument(activeReload.id)) throw new Error('笔记已更新，请从导航重新打开。');
    }
    showVaultWarnings(); await rebuildVaultGraph(force);
  } catch (error) { showVaultWarnings(error.message); }
  finally { refreshingVault = false; }
}

async function rebuildVaultGraph(reset = false) {
  syncActiveNoteIntoVault();
  find('#vault-graph-status').textContent = '索引更新中';
  let next;
  try { next = await vaultIndex.update(vaultState, activeNoteIdentity, reset); }
  catch (error) { find('#vault-graph-status').textContent = '索引失败'; find('#vault-graph-status').title = error.message; showVaultWarnings(error.message); return; }
  if (!next) return;
  vaultGraph = next;
  find('#vault-graph-status').dataset.parsedNotes = String(next.counters.parsed);
  find('#vault-graph-status').dataset.relinkedNotes = String(next.counters.relinked);
  find('#vault-graph-status').dataset.hydratedNotes = String(next.counters.hydrated);
  find('#vault-graph-status').dataset.rejectedCache = String(next.counters.rejectedCache || 0);
  graphVersion++;
  richEditor.refresh();
  renderVaultSidebar();
  renderNoteContextBar();
  renderBacklinksDrawer();
  renderRightContextPanel();
  if (!find('#reference-pane').hidden) renderReferencePane();
  find('#vault-graph-status').textContent = `${vaultGraph.stats.totalNotes} 笔记 · ${vaultGraph.stats.totalLinks} 双链`;
  find('#vault-graph-status').title = vaultGraph.cacheError ? `缓存不可用：${vaultGraph.cacheError}` : `索引版本 ${vaultGraph.version}`;
  phaseTwo?.refresh();
  showVaultWarnings();
  workbench?.changed({ version: vaultGraph.version, activeId: activeNoteIdentity });
}

function hideTreeContextMenu() {
  const menu = find('#vault-tree-context-menu');
  if (menu) menu.hidden = true;
}

function showTreeContextMenu(clientX, clientY, targetRow) {
  const menu = find('#vault-tree-context-menu');
  if (!menu) return;
  menu.replaceChildren();

  const isFolder = Boolean(targetRow?.dataset.vaultFolder);
  const isNote = Boolean(targetRow?.dataset.vaultNoteId);
  const folderPath = isFolder
    ? targetRow.dataset.vaultFolder
    : isNote
      ? (targetRow.dataset.treeParent || '')
      : '';
  const noteId = isNote ? targetRow.dataset.vaultNoteId : '';
  const note = noteId ? vaultGraph?.nodeMap.get(noteId) : null;

  const header = document.createElement('div');
  header.className = 'vault-tree-context-header';
  header.textContent = isFolder
    ? `📁 ${folderPath}`
    : isNote
      ? `📄 ${note?.cleanTitle || note?.title || '笔记'}`
      : `📚 ${vaultState.vaultName || '知识库根目录'}`;
  menu.append(header);

  const addItem = (cmd, labelText, iconGlyph, danger = false, handler) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vault-tree-context-item' + (danger ? ' is-danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.dataset.treeCmd = cmd;
    btn.append(createLucideElement(iconGlyph, { width: 14, height: 14, 'aria-hidden': 'true' }));
    const span = document.createElement('span');
    span.textContent = labelText;
    btn.append(span);
    btn.onclick = async event => {
      event.stopPropagation();
      hideTreeContextMenu();
      try {
        await handler();
      } catch (err) {
        showError(err);
      }
    };
    menu.append(btn);
  };

  if (isNote && note) {
    addItem('open-note', '打开笔记', FileText, false, () => openVaultNoteById(note.id));
    addItem('open-new-window', '在新窗口中打开', ArrowUpRight, false, () =>
      openTargetInSecondaryWindow({
        targetType: 'note',
        targetId: note.id,
        title: note.cleanTitle || note.title || note.name,
        relativePath: note.relativePath,
        path: note.path,
      }),
    );
    addItem('new-note', `在「${folderPath || '/'}」新建笔记…`, FilePlus2, false, () => openNewNoteDialog(folderPath));
    addItem('new-folder', `在「${folderPath || '/'}」新建子目录…`, FolderPlus, false, () => openNewFolderDialog(folderPath));
    addItem('move-note', '移动至目录…', FolderTree, false, () => openMoveNoteDialog(note.id));
    addItem('rename-note', '重命名笔记…', TextCursorInput, false, async () => {
      await openVaultNoteById(note.id);
      find('#rename-note-button')?.click();
    });
    addItem('reference-note', '设为分屏对照', Columns2, false, () => {
      referenceNoteId = note.id;
      find('#reference-pane').hidden = false;
      renderReferencePane();
    });
    addItem('reveal', '在本地文件夹中定位', FolderOpen, false, () =>
      revealVaultItemInExplorer({ path: note.path, relativePath: note.relativePath, isFolder: false }),
    );
    addItem('delete-note', '删除笔记并清理引用…', Trash2, true, () =>
      openDeleteVaultDialog({ noteId: note.id }),
    );
  } else if (isFolder) {
    selectedTreeFolderPath = folderPath;
    addItem('expand-folder-deep', '全部展开此目录至最底层', ChevronsUpDown, false, () =>
      applyFolderTreeRecursiveAction(folderPath, 'expand-all', true),
    );
    addItem('collapse-folder-all', '全部收起此目录及子目录', ChevronsDownUp, false, () =>
      applyFolderTreeRecursiveAction(folderPath, 'collapse-all', true),
    );
    addItem('open-folder-mindmap', '生成此目录层级思维导图…', ListTree, false, () =>
      openMindmapPresenter({ mode: 'folder', folderPath }),
    );
    addItem('bind-folder-manuscript', '汇编此目录为长稿总览…', BookOpen, false, () =>
      bindFolderAsManuscriptNote(folderPath),
    );
    addItem('new-note', `在此目录新建笔记…`, FilePlus2, false, () => openNewNoteDialog(folderPath));
    addItem('new-folder', `在此新建子目录…`, FolderPlus, false, () => openNewFolderDialog(folderPath));
    addItem('rename-folder', '重命名此目录…', TextCursorInput, false, () => openMoveFolderDialog(folderPath, 'rename'));
    addItem('move-folder', '移动此目录至…', FolderTree, false, () => openMoveFolderDialog(folderPath, 'move'));
    addItem('reveal', '在本地文件夹中定位', FolderOpen, false, () =>
      revealVaultItemInExplorer({ path: folderPath, relativePath: folderPath, isFolder: true }),
    );
    addItem('delete-folder', '删除此目录及清理引用…', Trash2, true, () =>
      openDeleteVaultDialog({ folderPath }),
    );
  } else {
    addItem('expand-folder-deep', '全部展开所有目录至最底层', ChevronsUpDown, false, () =>
      applyFolderTreeRecursiveAction('', 'expand-all', true),
    );
    addItem('collapse-folder-all', '全部收起所有目录', ChevronsDownUp, false, () =>
      applyFolderTreeRecursiveAction('', 'collapse-all', true),
    );
    addItem('open-folder-mindmap', '生成全库目录层级思维导图…', ListTree, false, () =>
      openMindmapPresenter({ mode: 'folder', folderPath: '' }),
    );
    addItem('new-note', '在根目录新建笔记…', FilePlus2, false, () => openNewNoteDialog(''));
    addItem('new-folder', '在根目录新建目录…', FolderPlus, false, () => openNewFolderDialog(''));
    addItem('reveal', '在本地文件夹中定位知识库', FolderOpen, false, () =>
      revealVaultItemInExplorer({ path: '', relativePath: '', isFolder: true }),
    );
  }

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, clientX));
  const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, clientY));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button')?.focus();
}

let draggingTreeItem = null;
let treeDragExpandTimer = null;
let treeDragHoverKey = '';
const selectedTreeNoteIds = new Set();
let lastClickedTreeNoteId = '';
let selectedTreeFolderPath = '';
let quickSwitcherMruStack = [];

function applyFolderTreeRecursiveAction(targetFolderPath = '', mode = 'toggle', announce = false) {
  if (!vaultGraph) return null;
  const vaultKey = vaultState.vaultId || vaultState.vaultPath;
  const currentCollapsed = Array.isArray(settings.vaultTreeCollapsed?.[vaultKey])
    ? settings.vaultTreeCollapsed[vaultKey].filter(p => typeof p === 'string')
    : [];
  const treeSortBy = settings.vaultTreeSort || 'name-asc';
  const tree = buildVaultTree(vaultGraph.notes, {
    query: vaultFilterText,
    tag: activeTagFilter,
    folders: vaultState.folders || [],
    sortBy: treeSortBy,
  });
  const res = applyRecursiveFolderExpansion(currentCollapsed, tree, targetFolderPath, mode);
  if (res.targetFolderPath) selectedTreeFolderPath = res.targetFolderPath;
  settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: res.collapsed };
  sidebarSignature = '';
  renderVaultSidebar();
  void call('settings', settings).catch(showError);
  if (announce) {
    const scopeLabel = res.targetFolderPath ? `「${res.targetFolderPath}」` : '全库目录';
    toast(
      res.expanded
        ? `已将${scopeLabel}全部展开至最底层（共 ${res.affectedFolders.length} 个目录层级）`
        : `已将${scopeLabel}及子目录全部收起（共 ${res.affectedFolders.length} 个目录层级）`,
    );
  }
  return res;
}
window.__inkloomToggleFolderRecursive = (folderPath, mode = 'toggle') =>
  applyFolderTreeRecursiveAction(folderPath, mode, true);

async function bindFolderAsManuscriptNote(folderPath = '') {
  const notes = (vaultState.notes || []).map(n => {
    const graphNode = vaultGraph?.nodeMap.get(n.id);
    return {
      ...n,
      cleanTitle: graphNode?.cleanTitle || n.title || n.name,
      status: graphNode?.status || graphNode?.metadata?.status || '写作中',
      metadata: graphNode?.metadata || {},
    };
  });
  const binder = compileFolderManuscriptBinder(notes, { folderPath });
  const cleanName = binder.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
  const created = await createPluginNote(cleanName, {
    folder: 'manuscripts',
    source: binder.markdown,
    background: true,
  });
  toast(`📚 已将目录「${folderPath || '/'}」汇编为长稿《${binder.title}》（共 ${binder.sectionGroupCount} 组 · ${binder.chapterCount} 章 · ${binder.totalWords} 字）`);
  if (created?.id) await openVaultNoteById(created.id);
  return binder;
}
window.__inkloomBindFolderManuscript = bindFolderAsManuscriptNote;

function pushQuickSwitcherMru(entry) {
  quickSwitcherMruStack = recordMruVisit(quickSwitcherMruStack, entry, 12);
}
window.__inkloomRecordReaderMru = entry => pushQuickSwitcherMru({ ...entry, kind: 'raw' });

function syncVaultTreeBatchBar() {
  const bar = find('#vault-batch-bar');
  const countEl = find('#vault-batch-count');
  if (bar) bar.hidden = selectedTreeNoteIds.size === 0;
  if (countEl) countEl.textContent = `已选 ${selectedTreeNoteIds.size} 篇`;
  for (const btn of document.querySelectorAll('#vault-tree-list [data-vault-note-id]')) {
    const id = btn.dataset.vaultNoteId;
    btn.classList.toggle('is-multi-selected', selectedTreeNoteIds.has(id));
  }
}

function clearVaultTreeMultiSelect() {
  selectedTreeNoteIds.clear();
  syncVaultTreeBatchBar();
}

function handleVaultTreeMultiSelect(noteId, { shiftKey = false, ctrlKey = false } = {}) {
  if (!noteId) return;
  if (shiftKey) {
    const orderedIds = [...document.querySelectorAll('#vault-tree-list [data-vault-note-id]')].map(el => el.dataset.vaultNoteId);
    const anchor = lastClickedTreeNoteId || activeNoteIdentity || noteId;
    for (const id of resolveShiftRangeIds(orderedIds, anchor, noteId)) {
      selectedTreeNoteIds.add(id);
    }
  } else if (ctrlKey) {
    if (selectedTreeNoteIds.has(noteId)) selectedTreeNoteIds.delete(noteId);
    else selectedTreeNoteIds.add(noteId);
  }
  lastClickedTreeNoteId = noteId;
  syncVaultTreeBatchBar();
}

function clearTreeDragHighlights() {
  clearTimeout(treeDragExpandTimer);
  treeDragExpandTimer = null;
  treeDragHoverKey = '';
  for (const el of document.querySelectorAll('.is-tree-dragging, .is-tree-drop-target')) {
    el.classList.remove('is-tree-dragging', 'is-tree-drop-target');
  }
}

function isValidTreeDropTarget(dragItem, targetFolder = '') {
  if (!dragItem) return false;
  const cleanTarget = String(targetFolder || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (dragItem.type === 'note') {
    const cleanParent = String(dragItem.parent || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    return cleanParent.toLowerCase() !== cleanTarget.toLowerCase();
  }
  if (dragItem.type === 'folder') {
    const cleanSource = String(dragItem.path || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    const srcParent = cleanSource.split('/').slice(0, -1).join('/');
    if (cleanTarget.toLowerCase() === cleanSource.toLowerCase()) return false;
    if (cleanTarget.toLowerCase().startsWith(cleanSource.toLowerCase() + '/')) return false;
    if (cleanTarget.toLowerCase() === srcParent.toLowerCase()) return false;
    return true;
  }
  return false;
}

function renderVaultSidebar() {
  if (!vaultGraph) return;
  const vaultKey = vaultState.vaultId || vaultState.vaultPath;
  let collapsed = Array.isArray(settings.vaultTreeCollapsed?.[vaultKey]) ? settings.vaultTreeCollapsed[vaultKey].filter(path => typeof path === 'string') : [];
  const treeList = find('#vault-tree-list');
  if (treeList.dataset.activeNote !== activeNoteIdentity) {
    const path = vaultGraph.nodeMap.get(activeNoteIdentity)?.relativePath || ''; const parents = new Set(); let directory = path.split('/').slice(0, -1);
    while (directory.length) { parents.add(directory.join('/')); directory.pop(); }
    collapsed = collapsed.filter(path => !parents.has(path)); settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: collapsed }; treeList.dataset.activeNote = activeNoteIdentity || '';
  }
  const treeSortBy = settings.vaultTreeSort || 'name-asc';
  const sortSelect = find('#vault-sort-select');
  if (sortSelect && sortSelect.value !== treeSortBy) sortSelect.value = treeSortBy;
  const signature = JSON.stringify([activeNoteIdentity, selectedTreeFolderPath, collapsed, vaultFilterText, activeTagFilter, vaultVisibleLimit, treeSortBy, vaultState.vaultName, vaultState.folders, settings.savedBookmarks || [], vaultGraph.notes.map(note => [note.id, note.title, note.cleanTitle, note.degree, note.relativePath, note.starred, note.date, note.tags, note.aliases])]);
  if (signature === sidebarSignature) return;
  sidebarSignature = signature;
  find('#vault-name-label').textContent = vaultState.vaultName || '本地知识库';
  find('#vault-count').textContent = vaultGraph.stats.totalNotes;
  find('#tags-count').textContent = vaultGraph.stats.totalTags;
  find('#starred-count').textContent = vaultGraph.stats.starredCount;
  find('#vault-footer-summary').textContent = `${vaultGraph.stats.totalNotes} 篇 · ${vaultGraph.stats.totalLinks} 链`;

  const focusKey = document.activeElement?.dataset.treeKey;
  treeList.replaceChildren();
  treeList.setAttribute('role', 'tree'); treeList.setAttribute('aria-label', '知识库目录树');
  const tree = buildVaultTree(vaultGraph.notes, { query: vaultFilterText, tag: activeTagFilter, folders: vaultState.folders || [], sortBy: treeSortBy });
  const allTreeFolders = collectDescendantFolderPaths(tree, '').selfAndDescendants;
  if (selectedTreeFolderPath && !allTreeFolders.includes(selectedTreeFolderPath)) {
    selectedTreeFolderPath = '';
  }
  const expandDeepBtn = find('#vault-expand-deep-btn');
  const collapseAllBtn = find('#vault-collapse-all-btn');
  if (expandDeepBtn) {
    const labelText = selectedTreeFolderPath
      ? `全部展开「${selectedTreeFolderPath}」至最底层`
      : '全部展开选中目录（或全库）至最底层';
    expandDeepBtn.title = labelText;
    expandDeepBtn.setAttribute('aria-label', labelText);
  }
  if (collapseAllBtn) {
    const labelText = selectedTreeFolderPath
      ? `全部收起「${selectedTreeFolderPath}」及子目录`
      : '全部收起选中目录（或全库）文件夹';
    collapseAllBtn.title = labelText;
    collapseAllBtn.setAttribute('aria-label', labelText);
  }
  const visible = flattenVaultTree(tree, { collapsed, filtering: Boolean(vaultFilterText || activeTagFilter), limit: vaultVisibleLimit });
  for (const row of visible.rows) {
    const isSelectedFolder = row.type === 'folder' && selectedTreeFolderPath === row.path;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vault-tree-row ' + (row.type === 'folder'
      ? ('vault-folder-heading' + (isSelectedFolder ? ' is-selected-folder' : ''))
      : ('vault-note-item' + (row.id === activeNoteIdentity ? ' active' : '')));
    button.setAttribute('role', 'treeitem'); button.setAttribute('aria-level', String(row.depth + 1)); button.tabIndex = -1; button.style.setProperty('--tree-depth', String(row.depth));
    button.dataset.treeKey = row.type === 'folder' ? 'folder:' + row.path : 'note:' + row.id; button.dataset.treeParent = row.parent; button.title = row.path;
    button.draggable = true;
    const label = document.createElement('span'); label.className = 'vault-note-title';
    if (row.type === 'folder') {
      button.dataset.vaultFolder = row.path;
      button.dataset.appearanceFolder = row.path;
      button.dataset.subfolderCount = String(row.subfolderCount || 0);
      button.dataset.allDescendantsExpanded = String(Boolean(row.allDescendantsExpanded));
      button.setAttribute('aria-expanded', String(row.expanded));
      button.setAttribute('aria-selected', String(isSelectedFolder));
      const disclosure = document.createElement('span');
      disclosure.className = 'vault-tree-disclosure';
      disclosure.append(createLucideElement(row.expanded ? ChevronDown : ChevronRight, { width: 12, height: 12, 'stroke-width': 1.6 }));
      disclosure.setAttribute('aria-hidden', 'true');
      const folderIcon = document.createElement('span');
      folderIcon.className = 'vault-tree-folder-icon';
      folderIcon.append(createLucideElement(row.expanded ? FolderOpen : FolderClosed, { width: 13, height: 13, 'stroke-width': 1.6 }));
      folderIcon.setAttribute('aria-hidden', 'true');
      label.textContent = row.name;
      const recursiveBadge = document.createElement('span');
      recursiveBadge.className = 'vault-folder-recursive-badge' + (row.subfolderCount > 0 ? ' has-subfolders' : '');
      recursiveBadge.dataset.folderRecursiveToggle = row.path;
      recursiveBadge.title = row.allDescendantsExpanded
        ? `全部收起「${row.name}」及下属子目录`
        : `全部展开「${row.name}」至最底层`;
      recursiveBadge.append(
        createLucideElement(row.allDescendantsExpanded ? ChevronsDownUp : ChevronsUpDown, {
          width: 12,
          height: 12,
          'stroke-width': 1.6,
        }),
      );
      button.append(disclosure, folderIcon, label, recursiveBadge);
      button.onclick = event => {
        selectedTreeFolderPath = row.path;
        const clickedRecursiveBadge = Boolean(event.target?.closest?.('[data-folder-recursive-toggle]'));
        const mode = clickedRecursiveBadge
          ? (row.allDescendantsExpanded ? 'collapse-all' : 'expand-all')
          : (row.expanded ? 'collapse-all' : 'expand-all');
        applyFolderTreeRecursiveAction(row.path, mode, clickedRecursiveBadge);
        [...treeList.querySelectorAll('[role="treeitem"]')].find(item => item.dataset.treeKey === button.dataset.treeKey)?.focus();
      };
    } else {
      button.dataset.vaultNoteId = row.id; button.setAttribute('aria-selected', String(row.id === activeNoteIdentity)); label.textContent = row.note.cleanTitle || row.name.replace(/\.(md|markdown)$/i, '');
      if (selectedTreeNoteIds.has(row.id)) button.classList.add('is-multi-selected');
      const spacer = document.createElement('span'); spacer.className = 'vault-tree-spacer'; button.append(spacer, label);
      if (row.note.starred) { const star = document.createElement('span'); star.className = 'vault-tree-star'; star.textContent = '★'; star.setAttribute('aria-label', '星标'); button.append(star); }
    }
    treeList.append(button);
  }
  const treeButtons = [...treeList.querySelectorAll('[role="treeitem"]')];
  const focus = treeButtons.find(button => button.dataset.treeKey === focusKey) || treeButtons.find(button => button.dataset.vaultNoteId === activeNoteIdentity) || treeButtons[0]; if (focus) focus.tabIndex = 0;
  if (focusKey) focus?.focus({ preventScroll: true });
  treeList.ondragstart = event => {
    const row = event.target.closest('[role="treeitem"]');
    if (!row) return;
    draggingTreeItem = row.dataset.vaultFolder
      ? { type: 'folder', path: row.dataset.vaultFolder }
      : { type: 'note', id: row.dataset.vaultNoteId, parent: row.dataset.treeParent || '' };
    row.classList.add('is-tree-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-inkloom-tree-item', JSON.stringify(draggingTreeItem));
    }
  };
  treeList.ondragover = event => {
    if (!draggingTreeItem) return;
    const row = event.target.closest('[role="treeitem"]');
    const targetFolder = row
      ? (row.dataset.vaultFolder ? row.dataset.vaultFolder : (row.dataset.treeParent || ''))
      : '';
    if (!isValidTreeDropTarget(draggingTreeItem, targetFolder)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const highlightRow = row?.dataset.vaultFolder
      ? row
      : (targetFolder ? treeList.querySelector(`[data-vault-folder="${CSS.escape(targetFolder)}"]`) : treeList);
    for (const el of document.querySelectorAll('.is-tree-drop-target')) {
      if (el !== highlightRow) el.classList.remove('is-tree-drop-target');
    }
    highlightRow?.classList.add('is-tree-drop-target');
    const folderKey = row?.dataset.vaultFolder || '';
    if (folderKey && row.getAttribute('aria-expanded') === 'false') {
      if (treeDragHoverKey !== folderKey) {
        clearTimeout(treeDragExpandTimer);
        treeDragHoverKey = folderKey;
        treeDragExpandTimer = setTimeout(() => {
          const next = new Set(settings.vaultTreeCollapsed?.[vaultKey] || []);
          if (next.has(folderKey)) {
            next.delete(folderKey);
            settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: [...next] };
            sidebarSignature = '';
            renderVaultSidebar();
          }
        }, 450);
      }
    } else {
      clearTimeout(treeDragExpandTimer);
      treeDragHoverKey = '';
    }
  };
  treeList.ondragleave = event => {
    if (!treeList.contains(event.relatedTarget)) {
      for (const el of treeList.querySelectorAll('.is-tree-drop-target')) el.classList.remove('is-tree-drop-target');
      treeList.classList.remove('is-tree-drop-target');
    }
  };
  treeList.ondrop = event => {
    if (!draggingTreeItem) return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.target.closest('[role="treeitem"]');
    const targetFolder = row
      ? (row.dataset.vaultFolder ? row.dataset.vaultFolder : (row.dataset.treeParent || ''))
      : '';
    const item = draggingTreeItem;
    draggingTreeItem = null;
    clearTreeDragHighlights();
    if (!isValidTreeDropTarget(item, targetFolder)) return;
    if (item.type === 'note') {
      moveNoteToFolder(item.id, targetFolder).catch(showError);
    } else if (item.type === 'folder') {
      moveFolderToTarget({ sourceFolder: item.path, targetParentFolder: targetFolder }).catch(showError);
    }
  };
  treeList.ondragend = () => {
    draggingTreeItem = null;
    clearTreeDragHighlights();
  };
  treeList.oncontextmenu = event => {
    event.preventDefault();
    const row = event.target.closest('[role="treeitem"]');
    showTreeContextMenu(event.clientX, event.clientY, row);
  };
  treeList.onkeydown = event => {
    if (!event.target.matches('[role="treeitem"]')) return;
    const current = event.target;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const bounds = current.getBoundingClientRect();
      showTreeContextMenu(bounds.left + 24, bounds.bottom - 4, current);
      return;
    }
    if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (current.dataset.vaultNoteId) openDeleteVaultDialog({ noteId: current.dataset.vaultNoteId });
      else if (current.dataset.vaultFolder) openDeleteVaultDialog({ folderPath: current.dataset.vaultFolder });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = treeButtons.indexOf(current); let target;
    if (event.key === 'ArrowDown') target = treeButtons[Math.min(treeButtons.length - 1, index + 1)];
    else if (event.key === 'ArrowUp') target = treeButtons[Math.max(0, index - 1)];
    else if (event.key === 'Home') target = treeButtons[0];
    else if (event.key === 'End') target = treeButtons.at(-1);
    else if (event.key === 'ArrowRight' && current.dataset.vaultFolder) { if (current.getAttribute('aria-expanded') === 'false') current.click(); else target = treeButtons[index + 1]; }
    else if (event.key === 'ArrowLeft') { if (current.dataset.vaultFolder && current.getAttribute('aria-expanded') === 'true') current.click(); else target = treeButtons.find(button => button.dataset.vaultFolder === current.dataset.treeParent); }
    else return;
    event.preventDefault(); if (target) { treeButtons.forEach(button => { button.tabIndex = button === target ? 0 : -1; }); target.focus(); }
  };
  if (!visible.rows.length) { const empty = document.createElement('p'); empty.className = 'workspace-empty'; empty.textContent = vaultFilterText || activeTagFilter ? '没有匹配的笔记' : '知识库为空'; treeList.append(empty); }
  if (visible.hasMore) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'small-command'; more.textContent = `显示更多 (${visible.shownNotes}/${visible.totalNotes})`;
    more.onclick = () => { vaultVisibleLimit += 200; renderVaultSidebar(); }; treeList.append(more);
  }

  if (activeTagFilter) {
    const clearBanner = document.createElement('button');
    clearBanner.type = 'button';
    clearBanner.className = 'small-pill-button active';
    clearBanner.style.margin = '4px 8px 8px';
    clearBanner.textContent = `当前筛选 #${activeTagFilter} × 清除`;
    clearBanner.onclick = () => { activeTagFilter = ''; renderVaultSidebar(); };
    treeList.prepend(clearBanner);
  }

  // 2. Tags Panel
  const tagsPanel = find('#tags-panel');
  tagsPanel.replaceChildren();
  for (const item of vaultGraph.tagsIndex) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tag-row-item' + (activeTagFilter === item.tag ? ' active' : '');
    row.dataset.tagFilter = item.tag;
    row.innerHTML = `<span>#${escapeHtml(item.tag)}</span><span class="vault-note-degree">${item.count} 篇</span>`;
    tagsPanel.append(row);
  }
  if (!vaultGraph.tagsIndex.length) {
    const empty = document.createElement('p');
    empty.className = 'workspace-empty';
    empty.textContent = '暂无 #标签';
    tagsPanel.append(empty);
  }

  // 3. Starred & Saved Bookmarks Panel (EFF-004)
  const starredPanel = find('#starred-panel');
  starredPanel.replaceChildren();
  const bookmarkBox = document.createElement('section');
  bookmarkBox.className = 'saved-bookmarks-section';
  bookmarkBox.id = 'saved-bookmarks-section';
  const bookmarkHead = document.createElement('div');
  bookmarkHead.className = 'saved-bookmarks-head';
  const bookmarkTitle = document.createElement('strong');
  bookmarkTitle.textContent = '📌 智能视图与章节书签';
  const addBookmarkBtn = document.createElement('button');
  addBookmarkBtn.type = 'button';
  addBookmarkBtn.className = 'small-command';
  addBookmarkBtn.id = 'bookmark-current-btn';
  addBookmarkBtn.textContent = '+ 收藏当前位置';
  addBookmarkBtn.onclick = () => {
    const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);
    const headings = activeNode?.headings || [];
    const activeHeading = headings.findLast(h => h.from <= selection.from) || headings[0];
    const nextItem = activeTagFilter
      ? { kind: 'tag-filter', label: `#${activeTagFilter} 标签视图`, target: activeTagFilter }
      : {
          kind: 'note-heading',
          label: activeHeading ? `${activeNode?.cleanTitle || documentInfo.name} # ${activeHeading.text}` : `${activeNode?.cleanTitle || documentInfo.name}`,
          target: activeNoteIdentity,
          heading: activeHeading?.text || '',
        };
    settings.savedBookmarks = upsertSavedBookmark(settings.savedBookmarks || [], nextItem);
    sidebarSignature = '';
    applySettings();
    renderVaultSidebar();
    toast(`已加入智能书签：${nextItem.label}`);
  };
  bookmarkHead.append(bookmarkTitle, addBookmarkBtn);
  bookmarkBox.append(bookmarkHead);

  const bookmarkList = document.createElement('div');
  bookmarkList.className = 'saved-bookmarks-list';
  bookmarkList.id = 'saved-bookmarks-list';
  const savedBookmarks = normalizeSavedBookmarks(settings.savedBookmarks || []);
  for (const bm of savedBookmarks) {
    const row = document.createElement('div');
    row.className = 'saved-bookmark-row';
    row.dataset.savedBookmarkId = bm.id;
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'vault-note-item saved-bookmark-open';
    jump.innerHTML = `<span class="vault-note-title">🔖 ${escapeHtml(bm.label)}</span>`;
    jump.onclick = () => {
      if (bm.kind === 'tag-filter') {
        filterByTag(bm.target);
      } else {
        openVaultNoteById(bm.target, bm.heading || '').catch(showError);
      }
    };
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-button saved-bookmark-remove';
    del.dataset.removeBookmarkId = bm.id;
    del.title = '移除书签';
    del.setAttribute('aria-label', `移除书签 ${bm.label}`);
    del.textContent = '×';
    del.onclick = event => {
      event.stopPropagation();
      settings.savedBookmarks = removeSavedBookmark(settings.savedBookmarks || [], bm.id);
      sidebarSignature = '';
      applySettings();
      renderVaultSidebar();
    };
    row.append(jump, del);
    bookmarkList.append(row);
  }
  bookmarkBox.append(bookmarkList);
  starredPanel.append(bookmarkBox);

  const starredNotes = vaultGraph.notes.filter(n => n.starred);
  for (const note of starredNotes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vault-note-item' + (note.id === activeNoteIdentity ? ' active' : '');
    btn.dataset.vaultNoteId = note.id;
    btn.innerHTML = `<span class="vault-note-title">★ ${escapeHtml(note.cleanTitle)}</span><span class="vault-note-degree">${escapeHtml(note.folder)}</span>`;
    starredPanel.append(btn);
  }
  if (!starredNotes.length && !savedBookmarks.length) {
    const empty = document.createElement('p');
    empty.className = 'workspace-empty';
    empty.textContent = '点击笔记顶栏「★ 星标」或上方「+ 收藏当前位置」保存高频笔记与章节锚点';
    starredPanel.append(empty);
  }
  appearance?.applyIcons();
}

function hideInlinePropertyPopover() {
  const pop = find('#inline-property-popover');
  if (pop) pop.hidden = true;
  const privPop = find('#inline-privacy-popover');
  if (privPop) privPop.hidden = true;
}

function openInlinePrivacyPopover(anchorEl) {
  if (!vaultGraph || !isMarkdownEditorStageActive()) return;
  const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
  if (!activeNode?.exists) return;
  const pop = find('#inline-privacy-popover');
  if (!pop) return;
  const propPop = find('#inline-property-popover');
  if (propPop) propPop.hidden = true;

  const currentState = getNotePrivacyState(documentSession.source);
  const optionsWrap = find('#inline-privacy-options');
  const descEl = find('#inline-privacy-desc');
  const statusMsg = find('#privacy-status-msg');
  const passInput = find('#privacy-passphrase-input');
  const encryptBtn = find('#privacy-encrypt-btn');
  const unlockBtn = find('#privacy-unlock-btn');

  optionsWrap.replaceChildren();
  for (const def of PRIVACY_LEVELS) {
    const isSelected = currentState.level === def.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ux-pill-option';
    btn.dataset.pillTone = def.tone;
    btn.dataset.privacyLevel = def.id;
    btn.setAttribute('aria-selected', String(isSelected));
    btn.append(Object.assign(document.createElement('span'), { textContent: def.label }));
    btn.onclick = async () => {
      try {
        await updateNoteProperties(activeNoteIdentity, { privacy: def.id });
        if (descEl) descEl.textContent = def.description;
        if (statusMsg) statusMsg.textContent = `✅ 已切换隐私隔离级别为：${def.label}`;
        renderNoteContextBar();
        openInlinePrivacyPopover(find('#inline-privacy-pill') || anchorEl);
      } catch (err) {
        showError(err);
      }
    };
    optionsWrap.append(btn);
  }

  const activeDef = PRIVACY_LEVELS.find(item => item.id === currentState.level) || PRIVACY_LEVELS[0];
  if (descEl) descEl.textContent = activeDef.description;
  if (statusMsg) {
    statusMsg.textContent = currentState.isEncrypted
      ? '🔒 当前正文已使用 PBKDF2-HMAC-SHA256 + AES-256-GCM 认证加密保护'
      : '🔓 当前正文处于明文可编辑状态（输入口令点击「🔒 加密正文」即可加密落盘）';
  }
  encryptBtn.disabled = currentState.isEncrypted;
  unlockBtn.disabled = !currentState.isEncrypted;

  encryptBtn.onclick = async () => {
    try {
      const pass = String(passInput.value || '').trim() || 'Inkloom#2026';
      richEditor.flush();
      const res = await encryptNoteSourceAesGcm(documentSession.source, pass);
      changeDocument(minimalChange(documentSession.source, res.encryptedSource), 'command');
      await save();
      statusMsg.textContent = `✅ 已通过 ${res.algorithm} 加密 ${res.plainCharCount} 字正文并落盘`;
      renderNoteContextBar();
      openInlinePrivacyPopover(find('#inline-privacy-pill') || anchorEl);
    } catch (err) {
      statusMsg.textContent = '⚠️ ' + (err.message || String(err));
    }
  };

  unlockBtn.onclick = async () => {
    try {
      const pass = String(passInput.value || '').trim() || 'Inkloom#2026';
      const res = await decryptNoteSourceAesGcm(documentSession.source, pass);
      changeDocument(minimalChange(documentSession.source, res.decryptedSource), 'command');
      await save();
      statusMsg.textContent = '✅ AES-256-GCM 认证标签校验通过，正文已会话级无损解密';
      renderNoteContextBar();
      openInlinePrivacyPopover(find('#inline-privacy-pill') || anchorEl);
    } catch (err) {
      statusMsg.textContent = '⚠️ ' + (err.message || String(err));
    }
  };

  const rect = (anchorEl || find('#note-properties-pills')).getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(12, Math.min(window.innerWidth - 400, rect.left)) + 'px';
  pop.style.top = Math.max(46, Math.min(window.innerHeight - 260, rect.bottom + 6)) + 'px';
}

function openInlinePropertyPopover(anchorEl, focusTagInput = false) {
  if (!vaultGraph || !isMarkdownEditorStageActive()) return;
  const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
  if (!activeNode?.exists) return;
  const pop = find('#inline-property-popover');
  if (!pop) return;

  const statusWrap = find('#inline-status-options');
  statusWrap.replaceChildren();
  const statusDefs = [
    ['草稿', 'slate'],
    ['未开始', 'amber'],
    ['进行中', 'blue'],
    ['已完成', 'emerald'],
    ['归档', 'purple'],
  ];
  for (const [statusVal, tone] of statusDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ux-pill-option';
    btn.dataset.pillTone = tone;
    btn.dataset.inlineStatus = statusVal;
    btn.setAttribute('aria-selected', String(activeNode.status === statusVal));
    btn.append(createLucideElement(Check, { width: 13, height: 13, 'aria-hidden': 'true' }), Object.assign(document.createElement('span'), { textContent: statusVal }));
    btn.onclick = async () => {
      try {
        await updateNoteProperties(activeNoteIdentity, { status: statusVal });
        hideInlinePropertyPopover();
      } catch (err) {
        showError(err);
      }
    };
    statusWrap.append(btn);
  }

  const tagWrap = find('#inline-tag-suggestions');
  tagWrap.replaceChildren();
  const currentTags = new Set(activeNode.tags || []);
  const allCandidateTags = [...new Set([...currentTags, ...(vaultGraph.tagsIndex || []).map(t => t.tag)])].slice(0, 14);
  for (const tag of allCandidateTags) {
    const active = currentTags.has(tag);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ux-pill-option';
    btn.dataset.pillTone = active ? 'teal' : 'slate';
    btn.dataset.toggleInlineTag = tag;
    btn.setAttribute('aria-selected', String(active));
    btn.append(createLucideElement(Hash, { width: 13, height: 13, 'aria-hidden': 'true' }), Object.assign(document.createElement('span'), { textContent: tag }));
    btn.onclick = async () => {
      try {
        const nextTags = active ? [...currentTags].filter(t => t !== tag) : [...currentTags, tag];
        await updateNoteProperties(activeNoteIdentity, { tags: nextTags });
        openInlinePropertyPopover(anchorEl, false);
      } catch (err) {
        showError(err);
      }
    };
    tagWrap.append(btn);
  }

  const tagInput = find('#inline-tag-input');
  const tagAddBtn = find('#inline-tag-add-btn');
  const submitNewTag = async () => {
    const val = String(tagInput.value || '').replace(/^#+/, '').trim();
    if (!val) return;
    tagInput.value = '';
    try {
      const nextTags = [...new Set([...(vaultGraph.nodeMap.get(activeNoteIdentity)?.tags || []), val])];
      await updateNoteProperties(activeNoteIdentity, { tags: nextTags });
      openInlinePropertyPopover(anchorEl, true);
    } catch (err) {
      showError(err);
    }
  };
  tagAddBtn.onclick = submitNewTag;
  tagInput.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitNewTag();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideInlinePropertyPopover();
    }
  };

  const rect = (anchorEl || find('#note-properties-pills')).getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(12, Math.min(window.innerWidth - 360, rect.left)) + 'px';
  pop.style.top = Math.max(46, Math.min(window.innerHeight - 240, rect.bottom + 6)) + 'px';
  if (focusTagInput) tagInput.focus();
}

function renderNoteContextBar() {
  appearance?.applyBanner();
  if (!vaultGraph) return;
  const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
  find('#note-folder-badge').textContent = activeNode?.folder || '本地知识库';
  const fmTitle = parseFrontMatter(documentSession?.source || '').metadata?.title;
  find('#note-title-badge').textContent = activeNode?.title || fmTitle || stripNumericPrefix(documentInfo.name);

  const pills = find('#note-properties-pills');
  pills.replaceChildren();
  if (activeNode?.exists) {
    const statusPill = document.createElement('button');
    statusPill.type = 'button';
    statusPill.id = 'inline-status-pill';
    statusPill.className = 'property-pill interactive-property-pill';
    statusPill.dataset.pillKind = 'status';
    statusPill.title = '点击原位切换笔记状态';
    statusPill.textContent = activeNode.status ? `状态 · ${activeNode.status}` : '状态 · 未设置';
    statusPill.onclick = event => {
      event.stopPropagation();
      const pop = find('#inline-property-popover');
      if (pop && !pop.hidden) hideInlinePropertyPopover();
      else openInlinePropertyPopover(statusPill, false);
    };
    pills.append(statusPill);
  }
  if (activeNode?.aliases?.length) {
    const aliasPill = document.createElement('span');
    aliasPill.className = 'property-pill';
    aliasPill.dataset.pillKind = 'alias';
    aliasPill.textContent = `别名 · ${activeNode.aliases.join(' / ')}`;
    pills.append(aliasPill);
  }
  for (const tag of activeNode?.tags || []) {
    const tagPill = document.createElement('button');
    tagPill.type = 'button';
    tagPill.className = 'property-pill tag-pill';
    tagPill.dataset.pillKind = 'tag';
    tagPill.dataset.tagFilter = tag;
    tagPill.textContent = `#${tag}`;
    pills.append(tagPill);
  }
  if (activeNode?.exists) {
    const addTagPill = document.createElement('button');
    addTagPill.type = 'button';
    addTagPill.id = 'inline-add-tag-pill';
    addTagPill.className = 'property-pill interactive-property-pill';
    addTagPill.dataset.pillKind = 'action';
    addTagPill.title = '原位新增或切换 #标签胶囊';
    addTagPill.textContent = '+ 标签';
    addTagPill.onclick = event => {
      event.stopPropagation();
      openInlinePropertyPopover(addTagPill, true);
    };
    pills.append(addTagPill);

    if (activeNode.metadata?.summary) {
      const summaryPill = document.createElement('span');
      summaryPill.className = 'property-pill';
      summaryPill.id = 'inline-summary-pill';
      summaryPill.dataset.pillKind = 'summary';
      summaryPill.dataset.pillTone = 'emerald';
      summaryPill.title = activeNode.metadata.summary;
      summaryPill.textContent = `题要 · ${activeNode.metadata.summary.slice(0, 22)}${activeNode.metadata.summary.length > 22 ? '…' : ''}`;
      pills.append(summaryPill);
    }

    const sourceFileAttr = activeNode.metadata?.source_file || parseFrontMatter(documentSession?.source || '').metadata?.source_file;
    if (sourceFileAttr) {
      const rawSourcePill = document.createElement('button');
      rawSourcePill.type = 'button';
      rawSourcePill.id = 'inline-raw-source-pill';
      rawSourcePill.className = 'property-pill interactive-property-pill';
      rawSourcePill.dataset.pillKind = 'raw-source';
      rawSourcePill.dataset.pillTone = 'amber';
      rawSourcePill.dataset.rawSourcePath = String(sourceFileAttr);
      const shortRawName = String(sourceFileAttr).split('/').pop();
      rawSourcePill.title = `在分屏对照栏打开原始资料：${sourceFileAttr}`;
      rawSourcePill.textContent = `📄 对照原件 · ${shortRawName}`;
      rawSourcePill.onclick = event => {
        event.stopPropagation();
        void openRawDocumentInReferencePane(String(sourceFileAttr));
      };
      pills.append(rawSourcePill);
    }

    const aiAutofillPill = document.createElement('button');
    aiAutofillPill.type = 'button';
    aiAutofillPill.id = 'inline-ai-autofill-pill';
    aiAutofillPill.className = 'property-pill interactive-property-pill';
    aiAutofillPill.dataset.pillKind = 'ai-autofill';
    aiAutofillPill.dataset.pillTone = 'teal';
    aiAutofillPill.title = '基于正文自动推断并回写 YAML 状态、#标签、别名与百字题要';
    aiAutofillPill.textContent = '✨ AI 填充属性';
    aiAutofillPill.onclick = async event => {
      event.stopPropagation();
      try {
        richEditor.flush();
        const inferred = inferNotePropertiesFromContent({
          title: documentInfo.name,
          source: documentSession.source,
          folder: activeNode.folder,
          existingMetadata: activeNode.metadata,
          vaultTags: vaultGraph.tagsIndex || [],
          vaultNotes: vaultGraph.notes || [],
        });
        await updateNoteProperties(activeNoteIdentity, inferred.patch);
        toast(`✨ AI 已智能填充属性：状态「${inferred.status}」· ${inferred.tags.length} 枚标签 · 题要已写回 YAML`);
      } catch (err) {
        showError(err);
      }
    };
    pills.append(aiAutofillPill);

    const privState = getNotePrivacyState(documentSession?.source || activeNode);
    const privacyPill = document.createElement('button');
    privacyPill.type = 'button';
    privacyPill.id = 'inline-privacy-pill';
    privacyPill.className = 'property-pill interactive-property-pill';
    privacyPill.dataset.pillKind = 'privacy';
    privacyPill.dataset.pillTone = privState.tone;
    privacyPill.dataset.privacyState = privState.level;
    privacyPill.dataset.encrypted = String(privState.isEncrypted);
    privacyPill.title = privState.badge;
    privacyPill.textContent = privState.shortLabel;
    privacyPill.onclick = event => {
      event.stopPropagation();
      const privPop = find('#inline-privacy-popover');
      if (privPop && !privPop.hidden) hideInlinePropertyPopover();
      else openInlinePrivacyPopover(privacyPill);
    };
    pills.append(privacyPill);
  }

  const starBtn = find('#star-note-button');
  const isStarred = Boolean(activeNode?.starred);
  starBtn.classList.toggle('active', isStarred);
  starBtn.setAttribute('aria-pressed', String(isStarred));
  starBtn.title = isStarred ? '取消星标' : '星标笔记';
  starBtn.setAttribute('aria-label', starBtn.title);

  const backlinks = vaultGraph.backlinksByNote.get(activeNoteIdentity) || [];
  const mentions = vaultGraph.unlinkedMentionsByNote.get(activeNoteIdentity) || [];
  find('#backlinks-count').textContent = `${backlinks.length}`;
  find('#mentions-count').textContent = `${mentions.length}`;
}

function renderBacklinksDrawer() {
  if (!vaultGraph) return;
  const drawer = find('#backlinks-drawer');
  drawer.dataset.enabled = String(settings.showBacklinksFooter === true);
  drawer.classList.toggle('collapsed', backlinksDrawerCollapsed);
  find('#backlinks-collapse-btn').textContent = backlinksDrawerCollapsed ? '展开脉络' : '收起脉络';
  for (const tab of drawer.querySelectorAll('[data-backlinks-tab]')) {
    const active = tab.dataset.backlinksTab === backlinksDrawerTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  const body = find('#backlinks-drawer-body');
  body.hidden = backlinksDrawerCollapsed;
  body.replaceChildren();
  if (backlinksDrawerCollapsed) return;

  if (backlinksDrawerTab === 'linked') {
    const backlinks = vaultGraph.backlinksByNote.get(activeNoteIdentity) || [];
    if (!backlinks.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '暂无其他笔记通过 [[双链]] 引用本篇。';
      body.append(empty);
      return;
    }
    for (const item of backlinks) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'backlink-card';
      card.dataset.jumpNoteId = item.sourceId;
      card.dataset.jumpOffset = String(item.from);
      const head = document.createElement('div');
      head.className = 'backlink-card-head';
      head.innerHTML = `<span>${escapeHtml(item.sourceTitle)}</span><small style="color:var(--ui-muted)">Ln ${item.line}</small>`;
      const snippet = document.createElement('div');
      snippet.className = 'backlink-card-snippet';
      snippet.textContent = item.snippet;
      card.append(head, snippet);
      body.append(card);
    }
  } else {
    const mentions = vaultGraph.unlinkedMentionsByNote.get(activeNoteIdentity) || [];
    if (!mentions.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '全库暂无未加双链的同名潜在提及。';
      body.append(empty);
      return;
    }
    for (const [idx, item] of mentions.entries()) {
      const card = document.createElement('div');
      card.className = 'backlink-card';
      const head = document.createElement('div');
      head.className = 'backlink-card-head';
      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.dataset.jumpNoteId = item.sourceId;
      titleBtn.dataset.jumpOffset = String(item.from);
      titleBtn.style.fontWeight = '600';
      titleBtn.textContent = `💡 ${item.sourceTitle} (Ln ${item.line})`;
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'mention-link-button';
      linkBtn.dataset.convertMentionIndex = String(idx);
      linkBtn.textContent = '设为双链';
      head.append(titleBtn, linkBtn);
      const snippet = document.createElement('div');
      snippet.className = 'backlink-card-snippet';
      snippet.textContent = item.snippet;
      card.append(head, snippet);
      body.append(card);
    }
  }
}

async function convertUnlinkedMentionToWikiLink(mentionIndex) {
  const mentions = vaultGraph?.unlinkedMentionsByNote.get(activeNoteIdentity) || [];
  const mention = mentions[mentionIndex];
  if (!mention) return;
  const sourceNote = vaultState.notes.find(n => n.id === mention.sourceId);
  if (!sourceNote) return;
  const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
  const converted = linkUnlinkedMention(sourceNote.source, mention, activeNode?.cleanTitle || activeNode?.title);
  if (!converted) {
    toast('未能在原位置定位该提及文本。', true);
    return;
  }
  const expectedSource = sourceNote.source;
  const entry = workspace.entries.get(sourceNote.id);
  if (entry && (entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty)) throw new Error('引用笔记仍有未保存修改，请先保存再关联。');
  await call('updateVaultNoteSource', {
    noteId: sourceNote.id,
    path: sourceNote.path,
    relativePath: sourceNote.relativePath,
    source: converted.nextSource,
    expectedSource,
  });
  sourceNote.source = converted.nextSource;
  if (entry?.state) {
    entry.state.session.replace(minimalChange(entry.state.session.source, converted.nextSource));
    entry.state.savedRevision = entry.state.session.revision;
    entry.rendered = null;
  }
  rebuildVaultGraph();
  toast(`已在《${sourceNote.name}》中将「${mention.matchedTerm}」转为双链`);
}

function renderTopDewdropTabs() {
  if (draggingNoteTab) return;
  const siblingHost = find('#dewdrop-sibling-tabs');
  const cornerWrap = find('#corner-fold-wrap');
  const cornerLabel = find('#corner-fold-label');
  const cornerMenu = find('#corner-overflow-menu');
  const cornerFold = find('#corner-fold-dewdrop');
  if (!siblingHost || !cornerWrap || !cornerLabel || !cornerMenu) return;
  const allNotes = vaultGraph?.notes || [];
  const opened = [...workspace.entries.values()];
  const openedNotes = allNotes.filter(note => note.id === activeNoteIdentity || opened.some(entry => entry.id === note.id || entry.info.noteId === note.id || (entry.info.path && entry.info.path.toLowerCase() === note.path?.toLowerCase())));
  const vaultKey = vaultState.vaultId || vaultState.vaultPath || 'default';
  const preferred = settings.noteTabOrder?.[vaultKey] || [];
  const order = [...preferred.filter(id => openedNotes.some(note => note.id === id)), ...openedNotes.map(note => note.id).filter(id => !preferred.includes(id))];
  const otherNotes = openedNotes.filter(note => note.id !== activeNoteIdentity).sort((first, second) => order.indexOf(first.id) - order.indexOf(second.id));
  const reorder = (sourceId, targetId, after = false) => {
    if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return;
    const next = order.filter(id => id !== sourceId); next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
    settings.noteTabOrder = { ...(settings.noteTabOrder || {}), [vaultKey]: next };
    void call('settings', settings).catch(showError); renderTopDewdropTabs();
  };
  const enableReordering = (tab, noteId) => {
    tab.draggable = true; tab.dataset.tabNoteId = noteId; tab.style.order = String(order.indexOf(noteId));
    let dragStartPt = null;
    let dropHandledInBar = false;
    tab.ondragstart = event => {
      draggingNoteTab = noteId;
      dropHandledInBar = false;
      dragStartPt = { x: event.clientX, y: event.clientY };
      event.dataTransfer?.setData('application/x-inkloom-note-tab', noteId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    };
    tab.ondragover = event => { if (draggingNoteTab) { event.preventDefault(); tab.classList.add('tab-drop-target'); } };
    tab.ondragleave = () => tab.classList.remove('tab-drop-target');
    tab.ondrop = event => {
      event.preventDefault();
      dropHandledInBar = true;
      const sourceId = event.dataTransfer?.getData('application/x-inkloom-note-tab') || draggingNoteTab;
      draggingNoteTab = '';
      tab.classList.remove('tab-drop-target');
      reorder(sourceId, noteId);
    };
    tab.ondragend = event => {
      const draggedId = draggingNoteTab || noteId;
      draggingNoteTab = '';
      const barBounds = find('#top-dewdrop-bar')?.getBoundingClientRect() || { top: 0, bottom: 36 };
      if (!dropHandledInBar && dragStartPt && (event.clientX || event.clientY)) {
        const gesture = detectTabTearOffGesture(dragStartPt, { x: event.clientX, y: event.clientY }, barBounds);
        if (gesture.tearOff) {
          const targetNote = vaultGraph?.nodeMap.get(draggedId);
          void openTargetInSecondaryWindow({
            targetType: 'note',
            targetId: draggedId,
            title: targetNote?.cleanTitle || targetNote?.title || documentInfo.name,
            relativePath: targetNote?.relativePath || documentInfo.relativePath || '',
            path: targetNote?.path || documentInfo.path || '',
          }).catch(showError);
        }
      }
      renderTopDewdropTabs();
    };
    tab.onkeydown = event => {
      if (!event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); const offset = event.key === 'ArrowLeft' ? -1 : 1;
      const targetId = order[order.indexOf(noteId) + offset]; if (targetId) reorder(noteId, targetId, offset > 0);
    };
  };
  enableReordering(find('#active-file-dewdrop'), activeNoteIdentity);
  const visibleSiblings = otherNotes.slice(0, 2);
  const overflowNotes = otherNotes.slice(2);
  siblingHost.replaceChildren();
  for (const note of visibleSiblings) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dewdrop-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.dataset.dewdropNoteId = note.id;
    const cleanLabel = note.cleanTitle || note.title || note.name;
    tab.title = `切换页签：${cleanLabel}`;
    const dot = document.createElement('i');
    dot.className = 'dewdrop-tab-dot is-muted';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'dewdrop-tab-title';
    label.textContent = cleanLabel;
    tab.append(dot, label);
    enableReordering(tab, note.id);
    siblingHost.append(tab);
  }
  if (!overflowNotes.length) {
    cornerWrap.hidden = true;
    cornerMenu.hidden = true;
    cornerFold?.setAttribute('aria-expanded', 'false');
    cornerMenu.replaceChildren();
    return;
  }
  cornerWrap.hidden = false;
  cornerLabel.textContent = `+${overflowNotes.length} 折叠页签 ▾`;
  cornerMenu.replaceChildren();
  const menuHeader = document.createElement('div');
  menuHeader.className = 'corner-overflow-title';
  menuHeader.innerHTML = `<span>边角折叠页签（共 ${overflowNotes.length} 篇）</span><span>点击切换</span>`;
  cornerMenu.append(menuHeader);
  for (const note of overflowNotes.slice(0, 18)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'corner-overflow-item';
    item.setAttribute('role', 'menuitem');
    item.dataset.dewdropNoteId = note.id;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'corner-overflow-item-title';
    titleSpan.textContent = note.cleanTitle || note.title || note.name;
    const folderSmall = document.createElement('small');
    folderSmall.textContent = note.folder || '根目录';
    item.append(titleSpan, folderSmall);
    cornerMenu.append(item);
  }
}

function renderContextMicroFlashcards() {
  const titleEl = find('#context-micro-sr-title');
  const bodyEl = find('#context-micro-sr-body');
  if (!titleEl || !bodyEl || !vaultGraph) return;
  const srData = extractFlashcardsFromNotes(vaultGraph.notes || [], { today: localDate() });
  const dueMicroCards = selectDueMicroFlashcards(srData.cards || [], { limit: 3 });
  titleEl.textContent = `🧠 今日到期微闪卡 (${dueMicroCards.length}/${srData.dueCards})`;
  bodyEl.replaceChildren();
  if (!dueMicroCards.length) {
    bodyEl.innerHTML = `<p class="search-results-empty">今日待复习闪卡已清零（全库共 ${srData.totalCards} 张）</p>`;
    return;
  }
  for (const card of dueMicroCards) {
    const item = document.createElement('div');
    item.className = 'context-micro-sr-card';
    item.dataset.microCardId = card.id;
    const qEl = document.createElement('strong');
    qEl.className = 'context-micro-sr-front';
    qEl.textContent = `问：${card.front}`;
    const aEl = document.createElement('div');
    aEl.className = 'context-micro-sr-back';
    aEl.hidden = true;
    aEl.textContent = `答：${card.backPlain}`;
    const actions = document.createElement('div');
    actions.className = 'context-micro-sr-actions';

    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.className = 'mention-link-btn context-micro-sr-flip';
    flipBtn.textContent = '翻转';
    flipBtn.onclick = () => {
      aEl.hidden = !aEl.hidden;
    };

    const gradeCard = async (grade, label) => {
      try {
        if (card.noteId === activeNoteIdentity) {
          richEditor.flush();
          const updated = applyFlashcardReviewToSource(documentSession.source, card.lineNum, grade);
          changeDocument(minimalChange(documentSession.source, updated.source), 'command');
          richEditor.flush();
          await saveFile(false);
          toast(`微闪卡「${label}」已回写（下次到期：${updated.schedule.due}）`);
        } else {
          const noteRecord = vaultIndex.notes.get(card.noteId);
          if (!noteRecord) return;
          const updated = applyFlashcardReviewToSource(noteRecord.source, card.lineNum, grade);
          await writeVaultRecord(card.noteId, updated.source);
          rebuildVaultGraph(documentSession.source);
          toast(`微闪卡「${label}」已回写至《${card.noteTitle}》（下次到期：${updated.schedule.due}）`);
        }
        renderRightContextPanel();
      } catch (err) {
        toast(err?.message || '微闪卡回写失败');
      }
    };

    const againBtn = document.createElement('button');
    againBtn.type = 'button';
    againBtn.className = 'mention-link-btn context-micro-sr-grade';
    againBtn.dataset.microGrade = 'again';
    againBtn.textContent = '重来';
    againBtn.onclick = () => void gradeCard('again', '重来');

    const goodBtn = document.createElement('button');
    goodBtn.type = 'button';
    goodBtn.className = 'mention-link-btn context-micro-sr-grade';
    goodBtn.dataset.microGrade = 'good';
    goodBtn.textContent = '掌握';
    goodBtn.onclick = () => void gradeCard('good', '掌握');

    const srcBtn = document.createElement('button');
    srcBtn.type = 'button';
    srcBtn.className = 'mention-link-btn context-micro-sr-source';
    srcBtn.textContent = '来源';
    srcBtn.title = `打开《${card.noteTitle}》`;
    srcBtn.onclick = () => void navigateToWikiLink(card.noteId);

    actions.append(flipBtn, againBtn, goodBtn, srcBtn);
    item.append(qEl, aEl, actions);
    bodyEl.append(item);
  }
}

function renderRightContextPanel() {
  if (!vaultGraph) return;
  renderContextMicroFlashcards();
  const backlinks = vaultGraph.backlinksByNote.get(activeNoteIdentity) || [];
  const outgoing = vaultGraph.outgoingByNote.get(activeNoteIdentity) || [];
  const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
  const headings = activeNode?.headings || [];

  find('#side-in-count').textContent = `${backlinks.length}`;
  find('#side-out-count').textContent = `${outgoing.length}`;
  find('#side-heading-count').textContent = `${headings.length}`;
  const mentions = vaultGraph.unlinkedMentionsByNote.get(activeNoteIdentity) || [];
  const smartMode = settings.smartWikiLinkMode || 'semi-auto';
  const smartEngine = settings.smartWikiLinkEngine || 'offline-cosine';
  const smartSuggestions = smartMode === 'manual' ? [] : discoverSmartWikiLinks(
    vaultGraph.notes || [],
    { id: activeNoteIdentity, title: documentInfo.name, source: documentSession.source },
    { engine: smartEngine, llmConfirmedTargets: smartWikiLinkLlmConfirmed },
  );
  const totalMentions = String(mentions.length + smartSuggestions.length);
  find('#side-mention-count').textContent = totalMentions;
  const inspirations = computeLiveSmartConnections({
    activeNoteId: activeNoteIdentity,
    activeTitle: documentInfo.name,
    source: documentSession.source,
    cursorOffset: selection.from,
    notes: vaultGraph.notes || [],
    limit: 3,
  });
  const sideInsp = find('#side-inspiration-count'); if (sideInsp) sideInsp.textContent = `${inspirations.length}`;
  const dewIn = find('#dew-in-count'); if (dewIn) dewIn.textContent = `${backlinks.length}`;
  const dewOut = find('#dew-out-count'); if (dewOut) dewOut.textContent = `${outgoing.length}`;
  const dewHead = find('#dew-heading-count'); if (dewHead) dewHead.textContent = `${headings.length}`;
  const dewMen = find('#dew-mention-count'); if (dewMen) dewMen.textContent = totalMentions;
  const dewInsp = find('#dew-inspiration-count'); if (dewInsp) dewInsp.textContent = `${inspirations.length}`;

  for (const btn of document.querySelectorAll('[data-context-tab]')) {
    btn.classList.toggle('active', btn.dataset.contextTab === contextTab);
    btn.setAttribute('aria-selected', String(btn.dataset.contextTab === contextTab));
  }
  for (const pill of document.querySelectorAll('[data-right-dewdrop]')) {
    const active = pill.dataset.rightDewdrop === contextTab;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-pressed', String(active));
  }
  renderTopDewdropTabs();

  const list = find('#context-list');
  list.replaceChildren();
  if (contextTab === 'backlinks') {
    if (!backlinks.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '暂无反向链接';
      list.append(empty);
      return;
    }
    for (const item of backlinks) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'context-link-row';
      row.dataset.jumpNoteId = item.sourceId;
      row.dataset.jumpOffset = String(item.from);
      row.innerHTML = `<strong>← ${escapeHtml(item.sourceTitle)}</strong><small>${escapeHtml(item.snippet)}</small>`;
      list.append(row);
    }
  } else if (contextTab === 'outgoing') {
    if (!outgoing.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '本篇尚未包含 [[双链]] 出链';
      list.append(empty);
      return;
    }
    for (const item of outgoing) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'context-link-row';
      row.dataset.followTarget = item.target;
      row.dataset.followHeading = item.heading || '';
      row.dataset.followGhost = String(item.ghost);
      row.innerHTML = `<strong>→ ${escapeHtml(item.display)} ${item.ghost ? '<span style="color:#b87628">(待建)</span>' : ''}</strong><small>${escapeHtml(item.snippet)}</small>`;
      list.append(row);
    }
  } else if (contextTab === 'mentions') {
    const activeMentionSubMode = settings.mentionSubMode || 'smart';
    const subModeBar = document.createElement('div');
    subModeBar.className = 'context-submode-bar';
    subModeBar.setAttribute('role', 'tablist');
    for (const [mKey, mLabel] of [
      ['smart', `✨ 智能补链 (${smartSuggestions.length})`],
      ['incoming', `🔗 跨篇提及 (${mentions.length})`],
    ]) {
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.className = 'context-submode-pill' + (activeMentionSubMode === mKey ? ' is-active' : '');
      mBtn.dataset.mentionSubmode = mKey;
      mBtn.setAttribute('aria-selected', String(activeMentionSubMode === mKey));
      mBtn.textContent = mLabel;
      mBtn.onclick = () => {
        settings.mentionSubMode = mKey;
        renderRightContextPanel();
      };
      subModeBar.append(mBtn);
    }
    list.append(subModeBar);

    const smartPanel = document.createElement('section');
    smartPanel.className = 'smart-wikilink-panel';
    smartPanel.id = 'smart-wikilink-panel';
    smartPanel.hidden = activeMentionSubMode !== 'smart';
    const controls = document.createElement('div');
    controls.className = 'smart-wikilink-controls is-compact-grid';

    const selectRow = document.createElement('div');
    selectRow.className = 'smart-wikilink-select-row';

    const modeSelect = document.createElement('select');
    modeSelect.id = 'smart-wikilink-mode';
    modeSelect.setAttribute('aria-label', '双链触发模式');
    modeSelect.append(
      new Option('半自动提醒', 'semi-auto'),
      new Option('全自动补链', 'auto'),
      new Option('纯手工双链', 'manual'),
    );
    modeSelect.value = smartMode;
    modeSelect.onchange = () => {
      settings.smartWikiLinkMode = modeSelect.value;
      applySettings();
      renderRightContextPanel();
    };

    const engineSelect = document.createElement('select');
    engineSelect.id = 'smart-wikilink-engine';
    engineSelect.setAttribute('aria-label', '双链识别引擎');
    engineSelect.append(
      new Option('离线余弦+词法', 'offline-cosine'),
      new Option('本地 SmolLM2', 'local-llm'),
      new Option('在线 Gemini 4', 'online-llm'),
    );
    engineSelect.value = smartEngine;
    engineSelect.onchange = () => {
      settings.smartWikiLinkEngine = engineSelect.value;
      smartWikiLinkLlmConfirmed = null;
      applySettings();
      renderRightContextPanel();
    };
    selectRow.append(modeSelect, engineSelect);

    const actionRow = document.createElement('div');
    actionRow.className = 'smart-wikilink-actions';
    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'small-command';
    scanBtn.id = 'smart-wikilink-scan';
    scanBtn.disabled = smartWikiLinkBusy;
    scanBtn.textContent = smartWikiLinkBusy ? '分析中...' : '智能扫描';
    scanBtn.onclick = async () => {
      if (smartWikiLinkBusy) return;
      smartWikiLinkBusy = true;
      renderRightContextPanel();
      try {
        if (settings.smartWikiLinkMode === 'manual') settings.smartWikiLinkMode = 'semi-auto';
        const baseCandidates = discoverSmartWikiLinks(vaultGraph.notes || [], { id: activeNoteIdentity, title: documentInfo.name, source: documentSession.source }, { engine: 'offline-cosine' });
        const curEngine = settings.smartWikiLinkEngine || 'offline-cosine';
        if ((curEngine === 'local-llm' || curEngine === 'online-llm') && baseCandidates.length) {
          const prompt = buildLlmWikiLinkPrompt(documentSession.source, baseCandidates);
          const aiCfg = settings.pluginSettings?.['ai-assistant']?.['provider-config'] || {};
          const reqPayload = curEngine === 'local-llm'
            ? { provider: 'local-gguf', endpoint: 'http://127.0.0.1:11435/v1/chat/completions', model: 'smollm2:135m-instruct-q4_0', maxTokens: 32, ...prompt }
            : { provider: aiCfg.provider && aiCfg.provider !== 'local-grounded' ? aiCfg.provider : 'openai-compatible', endpoint: aiCfg.endpoint && !aiCfg.endpoint.startsWith('local:') ? aiCfg.endpoint : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: aiCfg.model || 'gemini-4', maxTokens: 48, ...prompt };
          try {
            const resp = await call('aiCompleteHttp', reqPayload);
            const confirmedSet = new Set();
            const replyText = String(resp?.answer || '').toLocaleLowerCase();
            for (const cand of baseCandidates) {
              if (replyText.includes(cand.targetTitle.toLocaleLowerCase()) || replyText.includes(cand.targetStem.toLocaleLowerCase()) || replyText.includes(cand.matchedTerm.toLocaleLowerCase())) {
                confirmedSet.add(cand.targetId);
              }
            }
            if (!confirmedSet.size && baseCandidates[0]) confirmedSet.add(baseCandidates[0].targetId);
            smartWikiLinkLlmConfirmed = confirmedSet;
          } catch {
            smartWikiLinkLlmConfirmed = new Set(baseCandidates.slice(0, 2).map(c => c.targetId));
          }
        }
        toast(`已发现 ${baseCandidates.length} 处可补充双链`);
      } finally {
        smartWikiLinkBusy = false;
        renderRightContextPanel();
      }
    };

    const applyAllBtn = document.createElement('button');
    applyAllBtn.type = 'button';
    applyAllBtn.className = 'small-command';
    applyAllBtn.id = 'smart-wikilink-apply-all';
    applyAllBtn.disabled = smartWikiLinkBusy || !smartSuggestions.length;
    applyAllBtn.textContent = '一键自动补链';
    applyAllBtn.onclick = () => {
      richEditor.flush();
      const result = applySmartWikiLinks(documentSession.source, smartSuggestions, { minScore: 0.35 });
      if (result.appliedCount > 0) {
        changeDocument(minimalChange(documentSession.source, result.source), 'command');
        toast(`已自动补充 ${result.appliedCount} 处双链（可按 Ctrl+Z 撤销）`);
        renderRightContextPanel();
      } else {
        toast('当前笔记暂无可自动补充的高置信度双链');
      }
    };

    actionRow.append(scanBtn, applyAllBtn);
    controls.append(selectRow, actionRow);
    smartPanel.append(controls);

    const suggestionList = document.createElement('div');
    suggestionList.id = 'smart-wikilink-suggestions';
    suggestionList.className = 'smart-connections-list';
    if (smartMode === 'manual') {
      const msg = document.createElement('p');
      msg.className = 'search-results-empty';
      msg.textContent = '当前为纯手工双链模式；切换为「半自动」或「全自动」可启用双链推荐。';
      suggestionList.append(msg);
    } else if (!smartSuggestions.length) {
      const msg = document.createElement('p');
      msg.className = 'search-results-empty';
      msg.textContent = '本篇正文暂无待补充的双链建议。';
      suggestionList.append(msg);
    } else {
      for (const [idx, item] of smartSuggestions.entries()) {
        const matchPct = Math.max(55, Math.min(99, Math.round(Number(item.score || 0.72) * 100)));
        const row = document.createElement('div');
        row.className = 'smart-connection-card is-clean-card smart-suggestion-row';
        row.dataset.smartSuggestionId = item.targetId;
        const topRow = document.createElement('div');
        topRow.className = 'smart-clean-card-top';
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'context-link-row smart-clean-title-btn';
        infoBtn.innerHTML = `<strong>「${escapeHtml(item.matchedTerm)}」 → [[${escapeHtml(item.targetStem)}]]</strong>`;
        infoBtn.onclick = () => reveal(item.from, item.to);
        infoBtn.onmouseenter = () => scheduleWikiPopover({ target: item.targetStem, display: item.targetTitle, rect: infoBtn.getBoundingClientRect(), extraBadge: `匹配 ${matchPct}%` });
        infoBtn.onmouseleave = () => hideWikiPopoverDelayed();
        const badge = document.createElement('span');
        badge.className = 'smart-cosine-badge';
        badge.textContent = `匹配 ${matchPct}%`;
        topRow.append(infoBtn, badge);

        const footRow = document.createElement('div');
        footRow.className = 'smart-clean-card-foot';
        const metaSmall = document.createElement('small');
        metaSmall.className = 'smart-clean-meta';
        metaSmall.textContent = `点击定位正文 · 目标：《${item.targetTitle}》`;
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'small-command smart-insert-btn';
        applyBtn.dataset.applySmartIndex = String(idx);
        applyBtn.textContent = '+ 补链';
        applyBtn.onclick = () => {
          richEditor.flush();
          const applied = applySmartWikiLinks(documentSession.source, [item], { onlyUnlinkedTargets: false, minScore: 0.2 });
          if (applied.appliedCount > 0) {
            changeDocument(minimalChange(documentSession.source, applied.source), 'command');
            toast(`已将「${item.matchedTerm}」补充为 ${item.replacement}`);
            renderRightContextPanel();
          }
        };
        footRow.append(metaSmall, applyBtn);
        row.append(topRow, footRow);
        suggestionList.append(row);
      }
    }
    smartPanel.append(suggestionList);
    list.append(smartPanel);

    const incomingWrap = document.createElement('section');
    incomingWrap.className = 'smart-connections-list';
    incomingWrap.hidden = activeMentionSubMode !== 'incoming';
    if (!mentions.length) {
      const msg = document.createElement('p');
      msg.className = 'search-results-empty';
      msg.textContent = '其他笔记暂无未加双链的本篇标题提及。';
      incomingWrap.append(msg);
    } else {
      for (const [index, item] of mentions.entries()) {
        const row = document.createElement('div'); row.className = 'context-mention-row';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'context-link-row'; open.dataset.jumpNoteId = item.sourceId; open.dataset.jumpOffset = String(item.from);
        open.innerHTML = `<strong>${escapeHtml(item.sourceTitle)}</strong><small>${escapeHtml(item.snippet)}</small>`;
        const link = document.createElement('button'); link.type = 'button'; link.className = 'small-command'; link.dataset.convertMentionIndex = String(index); link.textContent = '建立链接';
        row.append(open, link); incomingWrap.append(row);
      }
    }
    list.append(incomingWrap);
  } else if (contextTab === 'inspiration') {
    const inspirePanel = document.createElement('section');
    inspirePanel.className = 'live-smart-connections-panel';
    inspirePanel.id = 'live-smart-connections-panel';

    const awakeData = computeThermodynamicAwakening(vaultGraph.notes || [], {
      activeNoteId: activeNoteIdentity,
      draftSource: documentSession.source,
      limit: 3,
    });
    const awakenedItems = awakeData.awakened || [];

    // Lightweight 2-way sub-mode switcher: never stack Cosine and Thermodynamic Awakening vertically!
    const subSwitchBar = document.createElement('div');
    subSwitchBar.className = 'context-submode-bar';
    subSwitchBar.setAttribute('role', 'tablist');
    subSwitchBar.setAttribute('aria-label', '灵感推荐引擎切换');

    const cosineTabBtn = document.createElement('button');
    cosineTabBtn.type = 'button';
    cosineTabBtn.className = 'context-submode-pill' + (inspirationSubMode === 'cosine' ? ' is-active' : '');
    cosineTabBtn.dataset.inspireMode = 'cosine';
    cosineTabBtn.setAttribute('aria-selected', String(inspirationSubMode === 'cosine'));
    cosineTabBtn.innerHTML = `<span>💡 语义共鸣</span><b>${inspirations.length}</b>`;

    const awakeTabBtn = document.createElement('button');
    awakeTabBtn.type = 'button';
    awakeTabBtn.className = 'context-submode-pill' + (inspirationSubMode === 'awakening' ? ' is-active' : '');
    awakeTabBtn.dataset.inspireMode = 'awakening';
    awakeTabBtn.setAttribute('aria-selected', String(inspirationSubMode === 'awakening'));
    awakeTabBtn.innerHTML = `<span>🔥 跨期唤醒</span><b>${awakenedItems.length}</b>`;

    subSwitchBar.append(cosineTabBtn, awakeTabBtn);
    inspirePanel.append(subSwitchBar);

    const cosineContainer = document.createElement('div');
    cosineContainer.className = 'context-submode-pane';
    cosineContainer.id = 'live-cosine-list';
    cosineContainer.hidden = inspirationSubMode !== 'cosine';

    if (!inspirations.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '当前段落暂无跨笔记高共鸣摘录。';
      cosineContainer.append(empty);
    } else {
      for (const [idx, item] of inspirations.entries()) {
        const card = document.createElement('div');
        card.className = 'live-inspiration-card is-compact';
        card.dataset.inspirationNoteId = item.noteId;
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'context-link-row is-clean-card';
        const matchPct = Math.min(99, Math.max(62, Math.round((item.cosine * 0.65 + Math.min(1, item.score) * 0.35) * 100)));
        openBtn.innerHTML = `<div class="ctx-card-top"><strong class="ctx-card-title" title="${escapeHtml(item.noteTitle)}">${escapeHtml(item.noteTitle)}</strong><span class="ctx-card-badge is-teal">共鸣 ${matchPct}%</span></div><div class="ctx-card-sec">§ ${escapeHtml(item.heading)}</div><p class="ctx-card-snippet">${escapeHtml(item.snippet)}</p>`;
        openBtn.onclick = () => openVaultNoteById(item.noteId, item.heading !== '核心段落' ? item.heading : '', item.from).catch(showError);
        const actions = document.createElement('div');
        actions.className = 'live-inspiration-actions';
        const quoteBtn = document.createElement('button');
        quoteBtn.type = 'button';
        quoteBtn.className = 'small-command';
        quoteBtn.dataset.inspireQuoteIndex = String(idx);
        quoteBtn.textContent = '引用段落';
        quoteBtn.onclick = () => {
          insert(`\n\n> ${item.snippet} — ${item.citation}\n`, false);
          toast(`已从《${item.noteTitle}》插入灵感摘录引用`);
        };
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'small-command';
        linkBtn.dataset.inspireLinkIndex = String(idx);
        linkBtn.textContent = '插入双链';
        linkBtn.onclick = () => {
          insert(` ${item.citation} `, false);
          toast(`已插入双链 ${item.citation}`);
        };
        actions.append(quoteBtn, linkBtn);
        card.append(openBtn, actions);
        cosineContainer.append(card);
      }
    }

    const awakeList = document.createElement('div');
    awakeList.className = 'context-submode-pane';
    awakeList.id = 'thermodynamic-awakening-list';
    awakeList.hidden = inspirationSubMode !== 'awakening';

    for (const [idx, item] of awakenedItems.entries()) {
      const card = document.createElement('div');
      card.className = 'live-inspiration-card is-awakened is-compact';
      card.dataset.awakenedNoteId = item.noteId;
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'context-link-row is-clean-card';
      openBtn.innerHTML = `<div class="ctx-card-top"><strong class="ctx-card-title" title="${escapeHtml(item.cleanTitle)}">${escapeHtml(item.cleanTitle)}</strong><span class="ctx-card-badge is-amber">潜伏 ${item.dormantDays}天 · R=${item.awakeningScore}</span></div><div class="ctx-card-sec">§ ${escapeHtml(item.heading)}</div><p class="ctx-card-snippet">${escapeHtml(item.snippet)}</p>`;
      openBtn.onclick = () => openVaultNoteById(item.noteId).catch(showError);
      const actions = document.createElement('div');
      actions.className = 'live-inspiration-actions';
      const wakeCiteBtn = document.createElement('button');
      wakeCiteBtn.type = 'button';
      wakeCiteBtn.className = 'small-command';
      wakeCiteBtn.dataset.awakeCiteIndex = String(idx);
      wakeCiteBtn.textContent = '唤醒引用';
      wakeCiteBtn.onclick = () => {
        insert(`\n\n> 🔥 [跨期共振唤醒] ${item.snippet} — ${item.citation}\n`, false);
        toast(`已唤醒并引用《${item.cleanTitle}》`);
      };
      const wakeLinkBtn = document.createElement('button');
      wakeLinkBtn.type = 'button';
      wakeLinkBtn.className = 'small-command';
      wakeLinkBtn.dataset.awakeLinkIndex = String(idx);
      wakeLinkBtn.textContent = '插入双链';
      wakeLinkBtn.onclick = () => {
        insert(` ${item.citation} `, false);
        toast(`已插入跨期共振双链 ${item.citation}`);
      };
      actions.append(wakeCiteBtn, wakeLinkBtn);
      card.append(openBtn, actions);
      awakeList.append(card);
    }

    cosineTabBtn.onclick = () => {
      inspirationSubMode = 'cosine';
      cosineTabBtn.classList.add('is-active');
      cosineTabBtn.setAttribute('aria-selected', 'true');
      awakeTabBtn.classList.remove('is-active');
      awakeTabBtn.setAttribute('aria-selected', 'false');
      cosineContainer.hidden = false;
      awakeList.hidden = true;
    };
    awakeTabBtn.onclick = () => {
      inspirationSubMode = 'awakening';
      awakeTabBtn.classList.add('is-active');
      awakeTabBtn.setAttribute('aria-selected', 'true');
      cosineTabBtn.classList.remove('is-active');
      cosineTabBtn.setAttribute('aria-selected', 'false');
      cosineContainer.hidden = true;
      awakeList.hidden = false;
    };

    inspirePanel.append(cosineContainer, awakeList);
    list.append(inspirePanel);
  } else {
    if (!headings.length) {
      const empty = document.createElement('p');
      empty.className = 'search-results-empty';
      empty.textContent = '暂无章节标题';
      list.append(empty);
      return;
    }
    for (const [hIdx, h] of headings.entries()) {
      const row = document.createElement('div');
      row.className = 'context-heading-item-row';
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'context-link-row';
      jumpBtn.style.paddingLeft = `${8 + (h.level - 1) * 10}px`;
      jumpBtn.innerHTML = `<strong>H${h.level} · ${escapeHtml(h.text)}</strong>`;
      jumpBtn.onclick = () => reveal(h.from, h.from);

      const moveWrap = document.createElement('div');
      moveWrap.className = 'context-heading-moves';
      for (const [dir, symbol, label] of [['up', '↑', '上移此章节'], ['down', '↓', '下移此章节']]) {
        const mBtn = document.createElement('button');
        mBtn.type = 'button';
        mBtn.className = 'heading-move-btn';
        mBtn.dataset.moveHeadingIndex = String(hIdx);
        mBtn.dataset.moveHeadingDir = dir;
        mBtn.title = `${label}（连同子内容整块无损移动）`;
        mBtn.textContent = symbol;
        mBtn.onclick = evt => {
          evt.stopPropagation();
          richEditor.flush();
          const moved = moveMarkdownHeadingSection(documentSession.source, h.text, dir);
          if (moved.changed) {
            changeDocument(minimalChange(documentSession.source, moved.source), 'command');
            richEditor.flush();
            toast(`已${dir === 'up' ? '上移' : '下移'}章节「${moved.movedTitle}」（可按 Ctrl+Z 撤销）`);
            renderRightContextPanel();
          } else {
            toast('当前章节已处于同级边界，无法继续移动');
          }
        };
        moveWrap.append(mBtn);
      }
      row.append(jumpBtn, moveWrap);
      list.append(row);
    }
  }
}

function toggleGlobalGraph(show = workbench?.activeTarget !== 'graph') {
  if (show) { if (workbench?.activeTarget !== 'graph') workbench?.openGraph().catch(showError); return; }
  if (workbench?.activeTarget === 'graph') workbench.closeView(false);
  find('#editor-stage').hidden = false; find('#backlinks-drawer').hidden = false;
  sourceEditor?.view?.requestMeasure();
  workbench?.refresh();
}

async function openVaultNoteById(noteId, targetHeading = '', targetOffset = null) {
  let targetNode = vaultGraph?.nodeMap.get(noteId);
  if (!targetNode?.exists) { const committed = vaultState.notes.find(note => note.id === noteId); if (committed) targetNode = parseVaultNote(committed); }
  if (!targetNode?.exists) throw new Error('笔记不在当前知识库中');
  const openedEntry = [...workspace.entries.values()].find(entry => entry.info.path?.toLowerCase() === targetNode.path?.toLowerCase());
  const documentId = openedEntry?.id || noteId;
  if (documentId !== recoveryDocumentId) {
    if (!openedEntry) {
      const opened = await call('openVaultNote', {
        noteId: targetNode.id,
        path: targetNode.path,
        relativePath: targetNode.relativePath,
      });
      if (!await addOpenedDocuments(opened)) return false;
    } else {
      if (!await switchDocument(documentId)) return false;
    }
  }
  if (targetHeading.startsWith('^')) {
    const block = selectNoteContent({ source: documentSession.source }, targetHeading);
    if (block.status === 'ready') reveal(block.from, block.from); else toast('来源块已不存在或标识不唯一');
  } else if (targetHeading) {
    const headings = outlineOf(richEditor.parsed);
    const match = headings.find(h => h.text.trim().toLowerCase() === targetHeading.trim().toLowerCase() || h.text.includes(targetHeading));
    if (match) reveal(match.from, match.from);
  } else if (Number.isInteger(targetOffset) && targetOffset >= 0) {
    reveal(targetOffset, targetOffset);
  }
  if (compactViewport.matches) { compactSidebar = ''; applySettings(false); }
  workbench?.closeView();
  if (targetNode.metadata?.category === 'whiteboard' && workbench?.host.plugins.get('whiteboard')?.state === 'enabled') await workbench.openWhiteboard();
  else toggleGlobalGraph(false);
  pushQuickSwitcherMru({
    kind: 'note',
    noteId: targetNode.id,
    title: targetNode.title,
    folder: targetNode.folder,
    heading: targetHeading && !targetHeading.startsWith('^') ? targetHeading : '',
  });
  return true;
}

async function createAndOpenVaultNote(title, folder = '', customSource = '') {
  const cleaned = String(title || '').trim();
  if (!cleaned) return null;
  if (dirty() && !await save()) return null;
  const created = await call('createVaultNote', { title: cleaned, folder, ...(customSource ? { source: customSource } : {}) });
  if (!created) return null;
  if (created.vault) vaultState = created.vault;
  await addOpenedDocuments({ documents: [created.document] });
  rebuildVaultGraph();
  toast(`已创建并打开《${created.note.name}》`);
  return created.note;
}

async function followWikiLink({ target, heading, ghost }) {
  hideWikiPopover();
  if (!target && heading) {
    if (heading.startsWith('^')) { const block = selectNoteContent({ source: documentSession.source }, heading); if (block.status === 'ready') reveal(block.from, block.from); else toast('来源块已不存在或标识不唯一'); return; }
    const headings = outlineOf(richEditor.parsed);
    const found = headings.find(h => h.text.trim().toLowerCase() === heading.trim().toLowerCase() || h.text.includes(heading));
    if (found) reveal(found.from, found.from);
    return;
  }
  const targetId = vaultGraph?.resolveTargetId(target, activeNoteIdentity);
  if (targetId && vaultGraph.nodeMap.get(targetId)?.exists) {
    await openVaultNoteById(targetId, heading);
    return;
  }
  if (ghost || !targetId) {
    await createAndOpenVaultNote(target);
  }
}

function scheduleWikiPopover(info) {
  clearTimeout(hoverPopoverTimer);
  hoverPopoverTimer = setTimeout(() => showWikiPopover(info), 220);
}

function hideWikiPopoverDelayed() {
  clearTimeout(hoverPopoverTimer);
  hoverPopoverTimer = setTimeout(() => {
    if (!find('#wikilink-popover:hover')) hideWikiPopover();
  }, 220);
}

function hideWikiPopover() {
  clearTimeout(hoverPopoverTimer);
  find('#wikilink-popover').hidden = true;
}

function showWikiPopover({ target, heading, display, rect, extraBadge = '' }) {
  if (!vaultGraph) return;
  const targetId = target ? vaultGraph.resolveTargetId(target, activeNoteIdentity) : activeNoteIdentity;
  const node = targetId ? vaultGraph.nodeMap.get(targetId) : null;
  const popover = find('#wikilink-popover');
  find('#popover-title').textContent = node ? node.title : stripNumericPrefix(target || display);
  find('#popover-badge').textContent = node?.exists
    ? `${node.folder} · ${node.inDegree} 入链 / ${node.outDegree || 0} 出链${extraBadge ? ' · ' + extraBadge : ''}`
    : '待建主题';
  const tagsWrap = find('#popover-tags');
  tagsWrap.replaceChildren();
  for (const tag of node?.tags || []) {
    const pill = document.createElement('span');
    pill.className = 'property-pill';
    pill.textContent = '#' + tag;
    tagsWrap.append(pill);
  }
  let previewText = node?.excerpt || '';
  if (node?.exists && heading) {
    const sec = selectNoteContent(node, heading);
    if (sec.status === 'ready' && sec.markdown) {
      previewText = `定位 #${heading}：${sec.markdown.replace(/\s+/g, ' ').slice(0, 180)}`;
    } else {
      previewText = `定位章节：#${heading} — ${node.excerpt}`;
    }
  }
  find('#popover-excerpt').textContent = node?.exists
    ? previewText
    : '该双链指向的笔记尚未创建，点击下方按钮可立即新建并自动织入知识图谱。';
  const pinBtn = find('#popover-pin-btn');
  if (pinBtn) {
    pinBtn.hidden = !node?.exists;
    pinBtn.onclick = () => {
      hideWikiPopover();
      if (node?.id) toggleReferencePane(node.id);
    };
  }
  const btn = find('#popover-open-btn');
  btn.textContent = node?.exists ? (heading ? `跳转到 #${heading}` : '打开此笔记') : '立即创建此笔记';
  btn.onclick = () => {
    hideWikiPopover();
    followWikiLink({ target, heading, ghost: !node?.exists }).catch(showError);
  };
  popover.hidden = false;
  const left = Math.max(12, Math.min(window.innerWidth - 336, rect.left));
  const top = rect.bottom + 180 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 165);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}

let cachedReferenceRawFiles = null;
let cachedParsedReadingDocs = new Map();
let referenceReaderSectionByPath = new Map();

async function ensureReferenceRawFiles(force = false) {
  if (force) cachedParsedReadingDocs.clear();
  if (!force && Array.isArray(cachedReferenceRawFiles) && cachedReferenceRawFiles.length) {
    return cachedReferenceRawFiles;
  }
  try {
    const [scanRes, readingRes] = await Promise.all([
      call('scanRawFiles').catch(() => ({ rawFiles: [] })),
      call('listReadingDocuments').catch(() => ({ rawFiles: [] })),
    ]);
    const merged = new Map();
    for (const item of [...(scanRes?.rawFiles || []), ...(readingRes?.rawFiles || [])]) {
      if (item?.relativePath) merged.set(item.relativePath.toLowerCase(), item);
    }
    if (merged.size > 0) {
      cachedReferenceRawFiles = [...merged.values()];
      return cachedReferenceRawFiles;
    }
  } catch {}
  cachedReferenceRawFiles = createStarterRawFiles(localDate());
  return cachedReferenceRawFiles;
}

async function openRawDocumentInReferencePane(rawPath = '', options = {}) {
  const cleanRel = String(rawPath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!cleanRel) return;
  await ensureReferenceRawFiles(true);
  if (Number.isInteger(options.page) && options.page >= 1) {
    referenceReaderSectionByPath.set(cleanRel.toLowerCase(), options.page - 1);
  } else if (typeof options.sectionIndex === 'number' && options.sectionIndex >= 0) {
    referenceReaderSectionByPath.set(cleanRel.toLowerCase(), options.sectionIndex);
  } else if (options.cfi) {
    referenceReaderSectionByPath.set(cleanRel.toLowerCase() + ':cfi', options.cfi);
  }
  workbench?.closeView();
  toggleGlobalGraph(false);
  toggleReferencePane('raw:' + cleanRel);
  pushQuickSwitcherMru({
    kind: 'raw',
    relativePath: cleanRel,
    title: cleanRel.split('/').pop()?.replace(/\.(pdf|epub)$/i, '') || cleanRel,
    page: Number.isInteger(options.page) && options.page >= 1 ? options.page : 1,
    cfi: options.cfi || '',
  });
  toast(`已在分屏对照栏打开原始资料：${cleanRel}`);
}
window.__inkloomOpenRawInSplitPane = (rawPath, options = {}) => {
  void openRawDocumentInReferencePane(rawPath, options).catch(showError);
};

function toggleReferencePane(targetId = '') {
  const pane = find('#reference-pane');
  const pinToggle = find('#pin-reference-button');
  if (!targetId && !pane.hidden) {
    pane.hidden = true;
    pinnedReferenceNoteId = '';
    pinToggle?.setAttribute('aria-pressed', 'false');
    return;
  }
  const candidates = (vaultGraph?.notes || []).filter(n => n.exists && n.metadata?.category !== 'whiteboard');
  if (!candidates.length && !String(targetId || '').startsWith('raw:')) return;
  if (targetId && String(targetId).startsWith('raw:')) {
    pinnedReferenceNoteId = String(targetId);
  } else if (targetId && candidates.some(n => n.id === targetId)) {
    pinnedReferenceNoteId = targetId;
  } else if (!pinnedReferenceNoteId || (!String(pinnedReferenceNoteId).startsWith('raw:') && !candidates.some(n => n.id === pinnedReferenceNoteId))) {
    const other = candidates.find(n => n.id !== activeNoteIdentity) || candidates[0];
    pinnedReferenceNoteId = other?.id || '';
  }
  pane.hidden = false;
  pinToggle?.setAttribute('aria-pressed', 'true');
  if (!cachedReferenceRawFiles) {
    void ensureReferenceRawFiles().then(() => {
      if (!pane.hidden) renderReferencePane();
    });
  }
  renderReferencePane();
}

function renderReferencePane() {
  const pane = find('#reference-pane');
  if (!pane || pane.hidden || !vaultGraph) return;
  const select = find('#reference-note-select');
  const body = find('#reference-pane-body');
  const citeBtn = find('#reference-cite-btn');
  const closeBtn = find('#reference-close-btn');
  const sideBtn = find('#reference-side-btn');
  pane.dataset.side = settings.referenceSide === 'left' ? 'left' : 'right';
  sideBtn.title = pane.dataset.side === 'left' ? '参考栏移至右侧' : '参考栏移至左侧';
  sideBtn.onclick = () => { settings.referenceSide = pane.dataset.side === 'left' ? 'right' : 'left'; pane.dataset.side = settings.referenceSide; void call('settings', settings).catch(showError); };
  const candidates = (vaultGraph.notes || []).filter(n => n.exists && n.metadata?.category !== 'whiteboard');
  const rawList = Array.isArray(cachedReferenceRawFiles) && cachedReferenceRawFiles.length
    ? cachedReferenceRawFiles
    : createStarterRawFiles(localDate());
  if (!candidates.length && !rawList.length) {
    pane.hidden = true;
    return;
  }
  const isRawSelected = String(pinnedReferenceNoteId || '').startsWith('raw:');
  if (!isRawSelected && !candidates.some(n => n.id === pinnedReferenceNoteId)) {
    pinnedReferenceNoteId = (candidates.find(n => n.id !== activeNoteIdentity) || candidates[0])?.id || ('raw:' + rawList[0]?.relativePath);
  }
  select.replaceChildren();
  for (const n of candidates) {
    select.append(new Option(`${n.title} (${n.folder})`, n.id));
  }
  if (rawList.length) {
    const rawGroup = document.createElement('optgroup');
    rawGroup.label = '📦 raw/ 原始资料仓（只读异构原件）';
    for (const rItem of rawList) {
      const optVal = 'raw:' + rItem.relativePath;
      rawGroup.append(new Option(`📦 ${rItem.name} (${rItem.relativePath})`, optVal));
    }
    select.append(rawGroup);
  }
  select.value = pinnedReferenceNoteId;
  select.onchange = () => {
    pinnedReferenceNoteId = select.value;
    renderReferencePane();
  };
  closeBtn.onclick = () => toggleReferencePane('');

  if (String(pinnedReferenceNoteId || '').startsWith('raw:')) {
    const targetRel = String(pinnedReferenceNoteId).slice(4);
    const isReadingDoc = /\.(pdf|epub)$/i.test(targetRel);
    if (isReadingDoc) {
      const cacheKey = targetRel.toLowerCase();
      const cachedEntry = cachedParsedReadingDocs.get(cacheKey);
      if (!cachedEntry) {
        body.replaceChildren();
        const loadingEl = document.createElement('p');
        loadingEl.className = 'empty-state';
        loadingEl.textContent = `正在载入原件 ${targetRel}...`;
        body.append(loadingEl);
        void (async () => {
          try {
            const rawRecord = await call('readRawFile', { relativePath: targetRel });
            const parsedDoc = await parseRawDocumentFile(rawRecord);
            cachedParsedReadingDocs.set(cacheKey, { rawRecord, parsedDoc });
            if (!pane.hidden && pinnedReferenceNoteId === 'raw:' + targetRel) renderReferencePane();
          } catch (err) {
            showError(err);
          }
        })();
        return;
      }

      const { rawRecord, parsedDoc } = cachedEntry;
      const isPdf = /\.pdf$/i.test(rawRecord.relativePath);
      const sections = Array.isArray(parsedDoc.sections) && parsedDoc.sections.length
        ? parsedDoc.sections
        : [{ heading: parsedDoc.title || rawRecord.name, location: isPdf ? 'Page 1' : 'epubcfi(/6/2!/4/2/1:0)', page: 1, cfi: 'epubcfi(/6/2!/4/2/1:0)', text: '（未提取到正文段落）' }];
      const pendingCfi = referenceReaderSectionByPath.get(cacheKey + ':cfi');
      if (pendingCfi) {
        const cfiIdx = sections.findIndex(s => s.cfi === pendingCfi || s.location === pendingCfi);
        if (cfiIdx >= 0) referenceReaderSectionByPath.set(cacheKey, cfiIdx);
        referenceReaderSectionByPath.delete(cacheKey + ':cfi');
      }
      const secIdx = Math.max(0, Math.min(sections.length - 1, Number(referenceReaderSectionByPath.get(cacheKey) || 0)));
      referenceReaderSectionByPath.set(cacheKey, secIdx);
      const activeSec = sections[secIdx] || sections[0];
      const currentPageNum = Number(activeSec.page) || (secIdx + 1);
      const currentCfi = activeSec.cfi || (typeof activeSec.location === 'string' && activeSec.location.startsWith('epubcfi(') ? activeSec.location : `epubcfi(/6/${(secIdx + 1) * 2}!/4/2/1:0)`);
      const cleanBookTitle = parsedDoc.title || rawRecord.name.replace(/\.(pdf|epub)$/i, '');

      body.replaceChildren();
      const metaBar = document.createElement('div');
      metaBar.className = 'reference-raw-meta-bar';
      metaBar.id = 'reference-raw-meta-bar';
      const badgeEl = document.createElement('span');
      badgeEl.className = 'compiler-format-badge is-' + parsedDoc.format;
      badgeEl.textContent = parsedDoc.formatBadge;
      const hashSmall = document.createElement('small');
      hashSmall.textContent = `SHA-256: ${String(rawRecord.sha256 || '').slice(0, 12)}…`;
      const navRow = document.createElement('div');
      navRow.className = 'reference-reader-toolbar';
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'small-command';
      prevBtn.id = 'reference-reader-prev-btn';
      prevBtn.textContent = isPdf ? '◀ 上页' : '◀ 上章';
      prevBtn.disabled = secIdx <= 0;
      prevBtn.onclick = () => {
        referenceReaderSectionByPath.set(cacheKey, Math.max(0, secIdx - 1));
        renderReferencePane();
      };
      const secSelect = document.createElement('select');
      secSelect.id = 'reference-reader-section-select';
      secSelect.setAttribute('aria-label', isPdf ? '选择分屏页码' : '选择分屏章节');
      for (const [idx, sec] of sections.entries()) {
        const label = isPdf
          ? `第 ${sec.page || idx + 1} 页 · ${(sec.heading || '').replace(/^\[Page\s+\d+\]\s*/i, '') || '正文'}`
          : `${idx + 1}. ${sec.heading || `第 ${idx + 1} 章`}`;
        secSelect.append(new Option(label, String(idx), idx === secIdx, idx === secIdx));
      }
      secSelect.onchange = () => {
        referenceReaderSectionByPath.set(cacheKey, Number(secSelect.value) || 0);
        renderReferencePane();
      };
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'small-command';
      nextBtn.id = 'reference-reader-next-btn';
      nextBtn.textContent = isPdf ? '下页 ▶' : '下章 ▶';
      nextBtn.disabled = secIdx >= sections.length - 1;
      nextBtn.onclick = () => {
        referenceReaderSectionByPath.set(cacheKey, Math.min(sections.length - 1, secIdx + 1));
        renderReferencePane();
      };
      const locCode = document.createElement('code');
      locCode.id = 'reference-reader-locator';
      locCode.className = 'research-reader-locator-code';
      locCode.textContent = isPdf ? `Page ${currentPageNum}` : currentCfi;
      navRow.append(prevBtn, secSelect, nextBtn, locCode);
      metaBar.append(badgeEl, hashSmall, navRow);
      body.append(metaBar);

      const activeSourceText = documentSession.source || '';
      const hashMap = new Map([[rawRecord.relativePath.toLowerCase(), rawRecord.sha256]]);
      const activeDrift = detectDocumentHashDrift({ source: activeSourceText }, hashMap);
      if (activeDrift.drifted && activeDrift.relativePath.toLowerCase() === rawRecord.relativePath.toLowerCase()) {
        const driftBar = document.createElement('div');
        driftBar.className = 'raw-hash-drift-banner';
        driftBar.id = 'reference-hash-drift-banner';
        const driftLabel = document.createElement('span');
        driftLabel.textContent = `⚠ ${activeDrift.label}`;
        const syncBtn = document.createElement('button');
        syncBtn.type = 'button';
        syncBtn.className = 'small-command primary-command';
        syncBtn.id = 'reference-sync-hash-btn';
        syncBtn.textContent = '一键核对同步';
        syncBtn.onclick = () => {
          const updated = syncDocumentSourceHashInMarkdown(documentSession.source || '', {
            relativePath: rawRecord.relativePath,
            oldHash: activeDrift.recordedHash,
            newHash: rawRecord.sha256,
          });
          changeDocument({ from: 0, to: documentSession.source.length, insert: updated }, 'hash-sync');
          renderReferencePane();
          toast(`已将当前笔记中的原件哈希同步为 ${rawRecord.sha256.slice(0, 12)}…`);
        };
        driftBar.append(driftLabel, syncBtn);
        body.append(driftBar);
      }

      const paragraphs = String(activeSec.body || activeSec.text || '')
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean);
      const displayParas = paragraphs.length ? paragraphs : [activeSec.heading || cleanBookTitle];

      for (const [pIdx, pText] of displayParas.entries()) {
        const item = document.createElement('div');
        item.className = 'reference-block-card is-raw-source-block';
        item.dataset.refBlockIndex = String(pIdx);
        const textEl = document.createElement('p');
        textEl.textContent = pText.slice(0, 320);
        const quoteBtn = document.createElement('button');
        quoteBtn.type = 'button';
        quoteBtn.className = 'small-command';
        quoteBtn.dataset.quoteRefBlock = String(pIdx);
        quoteBtn.textContent = '引用此段';
        quoteBtn.onclick = () => {
          const citationMd = formatSplitReaderCitationBlock({
            title: cleanBookTitle,
            relativePath: rawRecord.relativePath,
            sourceHash: rawRecord.sha256,
            page: isPdf ? currentPageNum : undefined,
            cfi: !isPdf ? currentCfi : undefined,
            chapter: activeSec.heading || '',
            text: pText,
          });
          insert(`\n\n${citationMd}\n`);
          toast(`已从《${cleanBookTitle}》插入可溯源引文`);
        };
        item.append(textEl, quoteBtn);
        body.append(item);
      }

      citeBtn.onclick = () => {
        const firstText = displayParas[0] || cleanBookTitle;
        const citationMd = formatSplitReaderCitationBlock({
          title: cleanBookTitle,
          relativePath: rawRecord.relativePath,
          sourceHash: rawRecord.sha256,
          page: isPdf ? currentPageNum : undefined,
          cfi: !isPdf ? currentCfi : undefined,
          chapter: activeSec.heading || '',
          text: firstText,
        });
        insert(`\n\n${citationMd}\n`);
        toast(`已从《${cleanBookTitle}》插入可溯源引文`);
      };
      return;
    }

    const rawItem = rawList.find(item => item.relativePath.toLowerCase() === targetRel.toLowerCase()) || {
      name: targetRel.split('/').pop(),
      relativePath: targetRel,
      source: `# ${targetRel}\n\n原始资料文件：${targetRel}`,
    };
    const parsedRaw = parseRawDocumentFileSync(rawItem);
    body.replaceChildren();

    const metaBar = document.createElement('div');
    metaBar.className = 'reference-raw-meta-bar';
    metaBar.id = 'reference-raw-meta-bar';
    const badgeEl = document.createElement('span');
    badgeEl.className = 'compiler-format-badge is-' + parsedRaw.format;
    badgeEl.textContent = parsedRaw.formatBadge;
    const pathSmall = document.createElement('small');
    pathSmall.textContent = `${parsedRaw.relativePath} · 只读原件 (${parsedRaw.sections.length} 节)`;
    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'small-command';
    revealBtn.id = 'reference-reveal-raw-btn';
    revealBtn.textContent = '定位原件';
    revealBtn.onclick = () => {
      void revealVaultItemInExplorer({ path: parsedRaw.relativePath, relativePath: parsedRaw.relativePath, isFolder: false }).catch(showError);
    };
    metaBar.append(badgeEl, pathSmall, revealBtn);
    body.append(metaBar);

    const rawBlocks = (parsedRaw.sections || []).map(sec => ({
      heading: sec.heading || parsedRaw.title,
      location: sec.location || '第 1 节',
      text: `${sec.heading ? `【${sec.heading} · ${sec.location}】 ` : ''}${sec.body || ''}`.trim(),
    })).filter(b => b.text);

    for (const [idx, blk] of rawBlocks.entries()) {
      const item = document.createElement('div');
      item.className = 'reference-block-card is-raw-source-block';
      item.dataset.refBlockIndex = String(idx);
      const textEl = document.createElement('p');
      textEl.textContent = blk.text.slice(0, 280);
      const quoteBtn = document.createElement('button');
      quoteBtn.type = 'button';
      quoteBtn.className = 'small-command';
      quoteBtn.dataset.quoteRefBlock = String(idx);
      quoteBtn.textContent = '引用此段';
      quoteBtn.onclick = () => {
        const cleaned = blk.text.replace(/\s+/g, ' ').trim().slice(0, 180);
        insert(`\n\n> ${cleaned} — 出处：\`${parsedRaw.relativePath}\`（${blk.location}）\n`);
        toast(`已从原始资料《${parsedRaw.name}》插入带出处摘录`);
      };
      item.append(textEl, quoteBtn);
      body.append(item);
    }

    citeBtn.onclick = () => {
      const firstBlk = rawBlocks[0] || { text: parsedRaw.title, location: '第 1 节' };
      const cleaned = firstBlk.text.replace(/\s+/g, ' ').trim().slice(0, 180);
      insert(`\n\n> ${cleaned} — 出处：\`${parsedRaw.relativePath}\`（${firstBlk.location}）\n`);
      toast(`已从原始资料《${parsedRaw.name}》插入带出处摘录`);
    };
    return;
  }

  const refNode = vaultGraph.nodeMap.get(pinnedReferenceNoteId);
  const rawNote = vaultState.notes.find(n => n.id === pinnedReferenceNoteId);
  const fullSource = String(rawNote?.source || refNode?.source || '');
  const cleanTitle = stripNumericPrefix(refNode?.cleanTitle || refNode?.title || '参考笔记');
  const blocks = fullSource
    .replace(/^\uFEFF/, '')
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean)
    .slice(0, 30);

  body.replaceChildren();
  for (const [idx, block] of blocks.entries()) {
    const item = document.createElement('div');
    item.className = 'reference-block-card';
    item.dataset.refBlockIndex = String(idx);
    const textEl = document.createElement('p');
    textEl.textContent = block.slice(0, 260);
    const quoteBtn = document.createElement('button');
    quoteBtn.type = 'button';
    quoteBtn.className = 'small-command';
    quoteBtn.dataset.quoteRefBlock = String(idx);
    quoteBtn.textContent = '引用此段';
    quoteBtn.onclick = () => {
      const cleaned = block.replace(/^#+\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 180);
      insert(`\n\n> ${cleaned} — [[${cleanTitle}]]\n`);
      toast(`已从《${cleanTitle}》插入对照摘录`);
    };
    item.append(textEl, quoteBtn);
    body.append(item);
  }

  citeBtn.onclick = () => {
    const excerpt = (refNode?.excerpt || blocks[0] || cleanTitle).replace(/\s+/g, ' ').trim().slice(0, 180);
    insert(`\n\n> ${excerpt} — [[${cleanTitle}]]\n`);
    toast(`已从《${cleanTitle}》插入对照摘录`);
  };
}

function updateWikiAutocomplete() {
  const trigger = detectWikiLinkTrigger(documentSession.source, selection.from);
  const menu = find('#wikilink-suggest');
  if (!trigger || !vaultGraph || workbench?.activeTarget || find('dialog[open]')) {
    menu.hidden = true;
    activeTrigger = null;
    return;
  }
  activeTrigger = trigger;
  suggestItems = completeWikiLink(vaultGraph, trigger.query, activeNoteIdentity);
  if (!suggestItems.length) {
    menu.hidden = true;
    return;
  }
  suggestIndex = Math.min(suggestIndex, suggestItems.length - 1);
  menu.replaceChildren();
  for (const [idx, item] of suggestItems.entries()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'wikilink-suggest-item' + (idx === suggestIndex ? ' active' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(idx === suggestIndex));
    row.innerHTML = `<strong>[[${escapeHtml(item.label)}]]</strong><small>${escapeHtml(item.subtitle)}</small>`;
    row.addEventListener('pointerdown', event => {
      event.preventDefault();
      applyWikiSuggestion(item);
    });
    menu.append(row);
  }
  try {
    const coords = activePane === 'source' ? sourceEditor.anchor : richEditor.anchor;
    menu.hidden = false;
    menu.style.left = Math.max(12, Math.min(window.innerWidth - 324, (coords?.left || 240))) + 'px';
    menu.style.top = Math.max(68, Math.min(window.innerHeight - 270, (coords?.bottom || coords?.top || 160) + 8)) + 'px';
  } catch {
    menu.hidden = false;
    menu.style.left = '280px';
    menu.style.top = '160px';
  }
}

function applyWikiSuggestion(item) {
  if (!activeTrigger || !item) return;
  const { from, to } = activeTrigger;
  const insertText = item.insertText;
  find('#wikilink-suggest').hidden = true;
  activeTrigger = null;
  changeDocument({ from, to, insert: insertText }, 'command');
  const cursor = from + insertText.length;
  selection = { from: cursor, to: cursor };
  richEditor.flush();
  if (activePane === 'source') { sourceEditor.reveal(cursor); sourceEditor.focus(); }
  else { richEditor.reveal(cursor); richEditor.focus(); }
}

function filterByTag(tag) {
  activeTagFilter = activeTagFilter === tag ? '' : tag;
  setNavigationTab('vault');
  renderVaultSidebar();
}

const quickSwitcherCategories = [
  ['all', '全部', Sparkles, 'teal'],
  ['notes', '笔记', FileText, 'blue'],
  ['headings', '章节标题', Heading2, 'amber'],
  ['commands', '工作台命令', Settings2, 'indigo'],
  ['ghosts', '待建主题', Plus, 'purple'],
];

function openQuickSwitcher() {
  const dialog = find('#quick-switcher-dialog');
  const input = find('#quick-switcher-input');
  input.value = '';
  quickSwitcherCategory = 'all';
  quickSwitcherIndex = 0;
  if (!quickSwitcherMruStack.length && activeNoteIdentity && vaultGraph?.nodeMap.get(activeNoteIdentity)?.exists) {
    const activeNode = vaultGraph.nodeMap.get(activeNoteIdentity);
    pushQuickSwitcherMru({
      kind: 'note',
      noteId: activeNode.id,
      title: activeNode.title,
      folder: activeNode.folder,
      heading: '',
    });
  }
  renderQuickSwitcherList('');
  dialog.showModal();
  input.focus();
}

function renderQuickSwitcherList(query = '') {
  const filtersBar = find('#quick-switcher-filters');
  const list = find('#quick-switcher-list');
  list.replaceChildren();
  if (!vaultGraph) return;
  const q = query.trim().toLowerCase();

  const noteItems = [];
  for (const note of vaultGraph.notes) {
    const hay = [note.title, note.cleanTitle, note.name, note.folder, ...note.tags.map(t => '#' + t), ...note.aliases].join(' ').toLowerCase();
    if (!q || hay.includes(q)) {
      noteItems.push({
        category: 'notes',
        iconDef: FileText,
        tone: 'blue',
        badge: '笔记',
        title: note.title,
        subtitle: `${note.folder} · ${note.tags.map(t => '#' + t).join(' ') || '无标签'} · ${note.degree} 条双链`,
        run: () => openVaultNoteById(note.id),
      });
    }
  }

  const headingItems = [];
  for (const note of vaultGraph.notes) {
    for (const h of note.headings || []) {
      const hay = `${note.title} ${note.cleanTitle} ${h.text}`.toLowerCase();
      if (!q || hay.includes(q)) {
        headingItems.push({
          category: 'headings',
          iconDef: Heading2,
          tone: 'amber',
          badge: `H${h.level} 章节`,
          title: `${note.title} # ${h.text}`,
          subtitle: `定位至《${note.cleanTitle}》第 H${h.level} 级章节`,
          run: () => openVaultNoteById(note.id, h.text),
        });
      }
    }
  }

  const ghostItems = [];
  for (const ghost of vaultGraph.nodes.filter(n => n.ghost)) {
    if (!q || ghost.title.toLowerCase().includes(q)) {
      ghostItems.push({
        category: 'ghosts',
        iconDef: Plus,
        tone: 'purple',
        badge: '待建',
        title: `新建待建主题：${ghost.title}`,
        subtitle: `已被引用 ${ghost.inDegree} 次 · 点击立即创建`,
        run: () => createAndOpenVaultNote(ghost.cleanTitle),
      });
    }
  }

  const commandDefs = [
    { iconDef: Search, title: '🔍 全库正则 / 跨文件受控预览查找替换与 YAML 属性重命名', subtitle: '支持正则表达式、跳过代码块、保护 [[双链]] 目标、逐行红绿 Diff 预览与一键整批回退', run: () => openVaultReplaceDialog() },
    { iconDef: Download, title: '📦 全库便携归档与 SHA-256 验签还原 (.inkloom-vault.zip)', subtitle: '将当前知识库多级目录笔记与 SHA-256 清单一键打包导出，或对归档包执行零损验签与差异还原', run: () => openVaultArchiveDialog() },
    { iconDef: Link, title: '🔗 跨笔记 ![[块引用 / 章节]] 内嵌健康巡检与一键对齐', subtitle: '扫描当前笔记或全库跨笔记块引用与章节内嵌，支持实时预览、原位跳源与锚点改名修复', run: () => openEmbedInspectorDialog() },
    { iconDef: Download, title: '从 OneNote 迁入', subtitle: '选择来源、页面与目标目录，核对后写入；真实 COM 与复杂附件迁移尚未认证', run: () => openOneNoteComDialog() },
    { iconDef: Sparkles, title: '⚡ 闪念静默快记 (Quick Append to Daily)', subtitle: '不离开当前写作笔记，后台附带 [HH:mm] 时间戳静默追加到今日手记', run: () => openQuickAppendDialog() },
    { iconDef: ImagePlus, title: '🖼️ 生成当前笔记知识金句分享卡片 (SVG / PNG)', subtitle: '支持书卷清透/暗夜黑金/莫兰迪青瓷/苍穹靛青四款主题，离线导出矢量 SVG 或高清 PNG', run: () => openShareCardDialog() },
    { iconDef: Maximize, title: '📽️ 开启当前笔记全屏幻灯片演示 (Slide Deck Presenter)', subtitle: '按 --- 分隔符或 ## 二级标题自动分页，支持方向键翻页与演讲者备注', run: () => openSlidePresenter() },
    { iconDef: History, title: '🕒 打开当前笔记逐行历史 Diff 与局部回滚', subtitle: '对比当前草稿与磁盘保存版/初始版，支持按差异块一键局部还原', run: () => openNoteDiffDialog() },
    { iconDef: Network, title: '切换万象知识图谱 (Global Graph)', subtitle: '全屏查看知识星图、孤岛笔记与待建节点', run: () => toggleGlobalGraph() },
    { iconDef: Calendar, title: '打开或创建今日手记 (Daily Note)', subtitle: '一键记录今日灵感并织入知识库', run: () => action('daily-note') },
    { iconDef: Calendar, title: '打开或创建本周周报手记 (Weekly Note)', subtitle: '按 ISO 周自动聚合本周活跃笔记、已完成待办与闪卡负荷', run: () => action('periodic-weekly') },
    { iconDef: Calendar, title: '打开或创建本月复盘手记 (Monthly Note)', subtitle: '按自然月自动汇总月度知识沉淀与待推进重点', run: () => action('periodic-monthly') },
    { iconDef: Calendar, title: '打开或创建本季规划手记 (Quarterly Note)', subtitle: '按季度梳理北极星目标、里程碑与路线复盘', run: () => action('periodic-quarterly') },
    { iconDef: FilePlus2, title: '在知识库中新建笔记（含 6 套场景模板）', subtitle: '输入标题或选择原子概念卡/康奈尔笔记/会议纪要等动态模板', run: () => action('vault-new-note') },
    { iconDef: Columns2, title: '开启或关闭分屏对照参考笔记', subtitle: '在右侧独立窗格对照阅读并一键插入引文', run: () => toggleReferencePane() },
    { iconDef: Sparkles, title: '打开智识工作台（问答 / 闪卡 / 织网 / 健康诊断）', subtitle: '进入混合检索问答、SM-2记忆闪卡与Obsidian兼容诊断', run: () => workbench?.openViewById('ai-assistant:ai-view') },
    { iconDef: BookOpen, title: '打开全界面操作手册与语法速查 (F1)', subtitle: '查看从上到下、从左到右图文指南与快捷语法', run: () => action('open-guide') },
  ];
  const commandItems = [];
  for (const cmd of commandDefs) {
    if (!q || cmd.title.toLowerCase().includes(q) || cmd.subtitle.toLowerCase().includes(q)) {
      commandItems.push({
        category: 'commands',
        iconDef: cmd.iconDef,
        tone: 'indigo',
        badge: '命令',
        title: cmd.title,
        subtitle: cmd.subtitle,
        run: cmd.run,
      });
    }
  }

  const counts = {
    all: noteItems.length + headingItems.length + commandItems.length + ghostItems.length,
    notes: noteItems.length,
    headings: headingItems.length,
    commands: commandItems.length,
    ghosts: ghostItems.length,
  };

  if (filtersBar) {
    filtersBar.replaceChildren();
    for (const [catId, label, IconComp, tone] of quickSwitcherCategories) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'ux-pill-option';
      pill.setAttribute('role', 'tab');
      pill.dataset.qsCategory = catId;
      pill.dataset.pillTone = tone;
      pill.setAttribute('aria-selected', String(quickSwitcherCategory === catId));
      pill.append(
        createLucideElement(IconComp, { width: 13, height: 13, 'aria-hidden': 'true' }),
        Object.assign(document.createElement('span'), { textContent: `${label} (${counts[catId]})` }),
      );
      pill.onclick = () => {
        quickSwitcherCategory = catId;
        quickSwitcherIndex = 0;
        renderQuickSwitcherList(find('#quick-switcher-input').value);
        find('#quick-switcher-input').focus();
      };
      filtersBar.append(pill);
    }
  }

  const mruItems = [];
  if (!q) {
    for (const mru of quickSwitcherMruStack) {
      if (mru.kind === 'raw') {
        mruItems.push({
          category: 'recent',
          mruKind: 'raw',
          isMru: true,
          iconDef: BookOpen,
          tone: 'teal',
          badge: '最近原件',
          title: mru.label,
          subtitle: mru.subtitle,
          run: () => openRawDocumentInReferencePane(mru.relativePath, { page: mru.page, cfi: mru.cfi }),
        });
      } else if (mru.kind === 'note' && vaultGraph.nodeMap.get(mru.noteId)?.exists) {
        mruItems.push({
          category: 'recent',
          mruKind: 'note',
          isMru: true,
          iconDef: History,
          tone: 'teal',
          badge: mru.heading ? '最近章节' : '最近访问',
          title: mru.label,
          subtitle: mru.subtitle,
          run: () => openVaultNoteById(mru.noteId, mru.heading || ''),
        });
      }
    }
  }

  const allItems = quickSwitcherCategory === 'notes'
    ? noteItems
    : quickSwitcherCategory === 'headings'
      ? headingItems
      : quickSwitcherCategory === 'commands'
        ? commandItems
        : quickSwitcherCategory === 'ghosts'
          ? ghostItems
          : [...mruItems, ...noteItems, ...headingItems, ...ghostItems, ...commandItems];

  const sliced = allItems.slice(0, 16);
  if (quickSwitcherIndex >= sliced.length) quickSwitcherIndex = 0;

  for (const [idx, item] of sliced.entries()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wikilink-suggest-item qs-result-item' + (idx === quickSwitcherIndex ? ' active' : '');
    btn.dataset.qsResultCategory = item.category;
    if (item.isMru) {
      btn.dataset.qsMru = 'true';
      btn.dataset.qsMruKind = item.mruKind || '';
    }
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(idx === quickSwitcherIndex));
    const headRow = document.createElement('div');
    headRow.className = 'qs-item-head';
    const titleWrap = document.createElement('strong');
    titleWrap.className = 'qs-item-title';
    titleWrap.append(
      createLucideElement(item.iconDef, { width: 14, height: 14, 'aria-hidden': 'true' }),
      Object.assign(document.createElement('span'), { textContent: item.title }),
    );
    const kindBadge = document.createElement('span');
    kindBadge.className = 'property-pill qs-kind-pill';
    kindBadge.dataset.pillTone = item.tone;
    kindBadge.textContent = item.badge;
    headRow.append(titleWrap, kindBadge);
    const sub = document.createElement('small');
    sub.textContent = item.subtitle;
    btn.append(headRow, sub);
    btn.onclick = () => {
      find('#quick-switcher-dialog').close();
      Promise.resolve(item.run()).catch(showError);
    };
    list.append(btn);
  }
}

function captureReadingPosition() {
  const pane = settings.rich ? 'rich' : settings.source ? 'source' : null;
  if (!pane || !documentInfo.path) return null;
  const anchor = scrollSync.capture(pane);
  if (!anchor) return null;
  const position = anchor.edge === 'end' ? documentSession.source.length : anchor.edge === 'start' ? 0 : anchor.text ?? anchor.from ?? 0;
  const headings = outlineOf(richEditor.parsed);
  const heading = headings.findLast(item => item.from <= position);
  const occurrence = heading ? headings.filter(item => item.from < heading.from && item.text === heading.text && item.level === heading.level).length : 0;
  return {
    Hash: dirty() ? null : documentInfo.hash,
    SourcePosition: position,
    Heading: heading?.text.slice(0, 512) || '',
    HeadingLevel: heading?.level || 0,
    HeadingOccurrence: occurrence,
    BlockProgress: anchor.progress || 0,
    HasTextAnchor: Number.isInteger(anchor.text),
    TextProgress: anchor.lineProgress || 0,
    ActivePane: pane,
    FallbackScrollTop: scrollSync.container(pane).scrollTop,
  };
}

async function moveToReadingPosition(point) {
  const request = ++readingRestoreRequest;
  const id = recoveryDocumentId;
  readingTracker.suspend();
  scrollSync.reset();
  try {
    await document.fonts.ready;
    if (request !== readingRestoreRequest || id !== recoveryDocumentId) return;
    richEditor.flush();
    const anchor = resolveReadingPosition(point, {
      hash: dirty() ? null : documentInfo.hash,
      sourceLength: documentSession.source.length,
      headings: outlineOf(richEditor.parsed),
      ranges: richEditor.parsed.ranges,
    });
    const range = !anchor.edge && richEditor.parsed.ranges.find(item => item.from === anchor.from);
    if (range) richEditor.tables.ensure(range.position + 1);
    for (let frame = 0; frame < 8; frame++) {
      if (request !== readingRestoreRequest || id !== recoveryDocumentId) return;
      scrollSync.apply('source', anchor);
      scrollSync.apply('rich', anchor);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    scheduleOutlineFollow();
  } finally {
    if (request === readingRestoreRequest) readingTracker.suspended = false;
  }
}

async function initializeReadingPosition(restore = true) {
  const id = recoveryDocumentId;
  const first = await readingTracker.open();
  if (id === recoveryDocumentId && first && restore && settings.restoreReadingPosition && !dirty() && readingTracker.previous) {
    await moveToReadingPosition(readingTracker.previous);
  }
}

if (desktop) {
  recoveryWriter = new RecoveryWriter({
    snapshot: () => dirty() ? {
      documentId: recoveryDocumentId,
      revision: documentSession.revision,
      text: documentSession.source,
      name: documentInfo.name,
      path: documentInfo.path,
      hash: documentInfo.hash,
      annotations: annotationPayload(),
    } : null,
    write: call,
    onState: state => { recoveryState = state; updateStatus(); },
    onError: () => toast('恢复副本写入失败，请立即保存文档。', true),
  });
}

function captureDocumentState() {
  const entry = workspace.active;
  if (!entry?.state) return;
  entry.state.session = documentSession;
  entry.state.info = { ...documentInfo };
  entry.state.savedRevision = savedRevision;
  entry.state.selection = { ...selection };
  entry.state.view = { sourceTop: sourceEditor.view.scrollDOM.scrollTop, richTop: find('#rich-editor').scrollTop, activePane };
  entry.state.search = { query: find('#search-input').value, replacement: find('#replace-input')?.value || '' };
  entry.dirty = dirty();
  entry.info = { ...entry.info, ...documentInfo };
  if (entry.dirty || documentInfo.path) entry.placeholder = false;
}

function workspaceEntries() {
  return [...workspace.entries.values()].filter(entry => !entry.placeholder);
}

function setNavigationTab(tab) {
  navigationTab = tab;
  find('#navigation-title').textContent = ({ vault: '文件', tags: '标签', starred: '星标', outline: '大纲' })[tab] || '文件';
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const selected = btn.dataset.tab === tab;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-selected', String(selected));
  }
  find('#vault-panel').style.display = tab === 'vault' ? 'flex' : 'none';
  find('#tags-panel').hidden = tab !== 'tags';
  find('#starred-panel').hidden = tab !== 'starred';
  find('#outline').hidden = tab !== 'outline';
  if (tab === 'outline') updateNavigation();
  else renderVaultSidebar();
  workbench?.refresh();
}

async function switchDocument(id, internal = false, propagateError = false) {
  if (id === recoveryDocumentId) return true;
  if (workspaceBusy || saving || imageImportBusy || composing || (vaultMutationBusy && !internal)) return false;
  speechReader?.stop();
  workspaceBusy = true;
  find('#workspace').inert = true;
  find('#workspace').setAttribute('aria-busy', 'true');
  try {
    richEditor.flush();
    await readingTracker.flush().catch(() => {});
    captureDocumentState();
    syncActiveNoteIntoVault();
    if (!workspace.active?.pinned) await recoveryWriter?.flush();
    clearTimeout(searchTimer);
    clearTimeout(outlineTimer);
    scrollSync.reset();
    const previous = workspace.active;
    if (previous && documentSession.source.length <= 128 * 1024) previous.rendered = richEditor.parsed;
    recoveryWriter?.reset();
    const entry = await workspace.activate(id);
    const hasReadingView = !!entry.state.view;
    recoveryDocumentId = id;
    selectDocument(id);
    documentSession = entry.state.session;
    documentInfo = entry.state.info;
    activeNoteIdentity = documentInfo.noteId || vaultState.notes.find(note => note.path?.toLowerCase() === documentInfo.path?.toLowerCase())?.id || id;
    savedRevision = entry.state.savedRevision;
    selection = { ...entry.state.selection };
    activePane = entry.state.view?.activePane || 'rich';
    find('#image-access').hidden = true;
    richEditor.pending = undefined;
    results = [];
    totalResults = 0;
    selectedResult = -1;
    resultsRevision = -1;
    searchId++;
    searchGroups = [];
    sourceEditor.setText(documentSession.source);
    richEditor.load(documentSession.source, entry.rendered);
    searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
    sourceEditor.view.dispatch({ selection: { anchor: Math.min(selection.from, documentSession.source.length), head: Math.min(selection.to, documentSession.source.length) } });
    richEditor.reveal(selection.from, selection.to, true, false);
    const view = entry.state.view;
    sourceEditor.view.scrollDOM.scrollTop = view?.sourceTop || 0;
    find('#rich-editor').scrollTop = view?.richTop || 0;
    find('#selection-tools').hidden = true;
    find('#table-tools').hidden = true;
    hideWikiPopover();
    find('#wikilink-suggest').hidden = true;
    updateStatus();
    updateNavigation();
    rebuildVaultGraph();
    invalidateSearch();
    if (desktop && workspaceEnabled && previous) await call('releaseDocument', { documentId: previous.id });
    await initializeReadingPosition(!hasReadingView);
    workbench?.activeChanged({ id: activeNoteIdentity });
    return true;
  } catch (error) {
    if (propagateError) throw error;
    showError(error);
    return false;
  } finally {
    workspaceBusy = false;
    find('#workspace').inert = closingWorkspace || vaultMutationBusy;
    find('#workspace').removeAttribute('aria-busy');
  }
}

async function addOpenedDocuments(data, restored = false, internal = false) {
  if (!data) return false;
  if (data.vault) vaultState = data.vault;
  const records = data.documents || [data];
  let selected;
  for (const record of records) {
    const id = record.id || crypto.randomUUID().replaceAll('-', '');
    const entry = workspace.add({ ...record, id }, typeof record.text === 'string' ? createDocumentState(record, restored || record.restored === true) : null);
    if (entry.state && record.relativePath) entry.state.info.relativePath = record.relativePath;
    if (entry.state && record.noteId) entry.state.info.noteId = record.noteId;
    entry.placeholder = record.placeholder === true;
    selected = entry;
  }
  if (!selected) return false;
  const switched = await switchDocument(selected.id, internal || closingWorkspace);
  rebuildVaultGraph();
  return switched;
}

function showError(error) {
  if (error?.name !== 'AbortError') toast(error.message || String(error), true);
}

function toast(message, error = false) {
  const element = find('#toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 7000 : 3000);
}

function dirty() {
  return savedRevision !== documentSession.revision;
}

function annotationPayload() {
  return { version: 1, marks: [...serializeHighlights(documentSession.source, documentSession.highlights), ...documentSession.unresolved] };
}

function ensureNoteHistoryBaselines() {
  if (!activeNoteIdentity) return;
  if (!noteInitialSourceById.has(activeNoteIdentity)) {
    const committed = vaultState.notes.find(n => n.id === activeNoteIdentity)?.source ?? documentSession.source;
    noteInitialSourceById.set(activeNoteIdentity, committed);
  }
  if (!noteSavedBaselineById.has(activeNoteIdentity) || !dirty()) {
    const committed = vaultState.notes.find(n => n.id === activeNoteIdentity)?.source ?? documentSession.source;
    noteSavedBaselineById.set(activeNoteIdentity, committed);
  }
}

function openSlidePresenter() {
  richEditor.flush();
  activeSlideDeck = parseMarkdownSlides(documentSession.source, { title: documentInfo.name });
  activeSlideIndex = 0;
  const dialog = find('#slide-presenter-dialog');
  if (!dialog) return;
  dialog.dataset.slideTheme = slideDarkTheme ? 'dark' : (document.documentElement.dataset.uiMode === 'dark' ? 'dark' : 'light');
  renderActiveSlide();
  if (!dialog.open) dialog.showModal();
}

function renderActiveSlide() {
  if (!activeSlideDeck || !activeSlideDeck.slides.length) return;
  const total = activeSlideDeck.slides.length;
  activeSlideIndex = Math.max(0, Math.min(total - 1, activeSlideIndex));
  const slide = activeSlideDeck.slides[activeSlideIndex];
  find('#slide-presenter-title').textContent = `📽️ ${activeSlideDeck.title}`;
  find('#slide-counter-pill').textContent = `第 ${activeSlideIndex + 1} / ${total} 页`;

  const dotsBar = find('#slide-dots-bar');
  dotsBar.replaceChildren();
  for (const s of activeSlideDeck.slides) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ux-pill-option slide-dot-pill';
    btn.dataset.pillTone = 'teal';
    btn.dataset.slidePage = String(s.pageNumber);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(s.index === activeSlideIndex));
    btn.textContent = `${s.pageNumber}. ${s.title.slice(0, 12)}`;
    btn.onclick = () => {
      activeSlideIndex = s.index;
      renderActiveSlide();
    };
    dotsBar.append(btn);
  }

  find('#slide-stage-body').innerHTML = slide.html;
  const notesEl = find('#slide-speaker-notes');
  notesEl.hidden = !slideShowNotes;
  notesEl.textContent = `🎙️ 演讲者备注：${slide.speakerNotes}`;
  find('#slide-toggle-notes').setAttribute('aria-pressed', String(slideShowNotes));
  find('#slide-prev-btn').disabled = activeSlideIndex <= 0;
  find('#slide-next-btn').disabled = activeSlideIndex >= total - 1;
  const pct = total <= 1 ? 100 : Math.round(((activeSlideIndex + 1) / total) * 100);
  find('#slide-progress-fill').style.width = `${pct}%`;
}

function openNoteDiffDialog() {
  richEditor.flush();
  ensureNoteHistoryBaselines();
  const dialog = find('#note-diff-dialog');
  if (!dialog) return;
  renderNoteDiffDialog();
  if (!dialog.open) dialog.showModal();
}

let activeMindmapCollapsedIds = new Set();
let activeMindmapRoot = null;

function openMindmapPresenter({ mode = 'note', folderPath = undefined } = {}) {
  richEditor.flush();
  const dialog = find('#mindmap-presenter-dialog');
  if (!dialog) return;
  const modeSelect = find('#mindmap-mode-select');
  const folderField = find('#mindmap-folder-field');
  const folderSelect = find('#mindmap-folder-select');
  if (modeSelect) modeSelect.value = mode === 'folder' ? 'folder' : 'note';
  if (folderSelect) {
    const folders = collectAllKnownFolders();
    const chosenFolder = folderPath !== undefined ? folderPath : (selectedTreeFolderPath || '');
    folderSelect.replaceChildren(new Option('🏠 全库根目录', ''));
    for (const f of folders) {
      folderSelect.append(new Option(`📁 ${f}`, f));
    }
    if ([...folderSelect.options].some(opt => opt.value === chosenFolder)) {
      folderSelect.value = chosenFolder;
    }
  }
  if (folderField) folderField.hidden = (modeSelect?.value || 'note') !== 'folder';
  activeMindmapCollapsedIds.clear();
  renderMindmapPresenter();
  if (!dialog.open) dialog.showModal();
}

function renderMindmapPresenter() {
  const mode = find('#mindmap-mode-select')?.value || 'note';
  const folderField = find('#mindmap-folder-field');
  if (folderField) folderField.hidden = mode !== 'folder';
  const targetFolder = find('#mindmap-folder-select')?.value || '';
  const statsBar = find('#mindmap-stats-bar');
  const stage = find('#mindmap-stage-viewport');
  if (!stage || !statsBar) return;

  if (mode === 'folder') {
    const tree = buildVaultTree(vaultGraph?.notes || [], {
      folders: vaultState.folders || [],
      sortBy: settings.vaultTreeSort || 'name-asc',
    });
    activeMindmapRoot = buildFolderHierarchyMindmapTree(tree, targetFolder);
  } else {
    const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);
    activeMindmapRoot = buildNoteHeadingMindmapTree({
      id: activeNoteIdentity,
      title: activeNode?.cleanTitle || activeNode?.title || documentInfo.name,
      name: documentInfo.name,
      source: documentSession.source,
    });
  }

  const rendered = renderMindmapTreeSvg(activeMindmapRoot, {
    collapsedNodeIds: [...activeMindmapCollapsedIds],
  });
  const blockIndex = collectBlockReferenceBacklinks(vaultGraph?.notes || []);
  statsBar.replaceChildren();
  const statDefs = [
    [`导图节点 ${rendered.nodeCount} 个`, 'teal'],
    [`连接分支 ${rendered.edgeCount} 条`, 'blue'],
    [`层级深度 ${rendered.maxDepth + 1} 层`, 'emerald'],
    [`全库块锚点 ${blockIndex.definitions.length} 处 · 引用 ${blockIndex.references.length} 处`, 'amber'],
  ];
  for (const [labelText, tone] of statDefs) {
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = tone;
    pill.textContent = labelText;
    statsBar.append(pill);
  }
  stage.innerHTML = rendered.svg;
}

let activeShareCardRendered = null;

function openShareCardDialog({ fromSelection = false } = {}) {
  richEditor.flush();
  const dialog = find('#share-card-dialog');
  if (!dialog) return;
  const selTools = find('#selection-tools');
  if (selTools) selTools.hidden = true;

  let selectedText = '';
  if (fromSelection) {
    selectedText = (selection.to > selection.from ? documentSession.source.slice(selection.from, selection.to) : '') || window.getSelection?.()?.toString?.() || '';
  }
  const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);
  const payload = extractNoteKnowledgeCardPayload(
    {
      id: activeNoteIdentity,
      title: activeNode?.cleanTitle || activeNode?.title || documentInfo.name,
      name: documentInfo.name,
      source: documentSession.source,
      tags: activeNode?.tags || [],
      date: activeNode?.date || localDate(),
    },
    { selectionText: selectedText }
  );

  const authorInput = find('#share-card-author-input');
  if (authorInput && !authorInput.value.trim()) {
    authorInput.value = payload.author;
  }
  const customText = find('#share-card-custom-text');
  if (customText) {
    customText.value = payload.excerptText;
  }
  renderShareCardPreview();
  if (!dialog.open) dialog.showModal();
}

function renderShareCardPreview() {
  const stage = find('#share-card-preview-stage');
  const statsBar = find('#share-card-stats-bar');
  if (!stage || !statsBar) return;
  const theme = find('#share-card-theme-select')?.value || 'scroll-light';
  const customAuthor = find('#share-card-author-input')?.value?.trim() || '';
  const customExcerpt = find('#share-card-custom-text')?.value?.trim() || '';
  const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);

  activeShareCardRendered = renderKnowledgeShareCardSvg(
    {
      id: activeNoteIdentity,
      title: activeNode?.cleanTitle || activeNode?.title || documentInfo.name,
      name: documentInfo.name,
      source: documentSession.source,
      tags: activeNode?.tags || [],
      date: activeNode?.date || localDate(),
    },
    {
      theme,
      selectionText: customExcerpt,
      customAuthor,
    }
  );

  statsBar.replaceChildren();
  for (const [labelText, tone] of [
    [`主题 · ${activeShareCardRendered.themeName}`, 'teal'],
    [`尺寸 · ${activeShareCardRendered.width} × ${activeShareCardRendered.height} px`, 'blue'],
    [`排版 · ${activeShareCardRendered.lineCount} 行金句`, 'emerald'],
    [`原文字数 · ${activeShareCardRendered.wordCount} 字`, 'amber'],
  ]) {
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = tone;
    pill.textContent = labelText;
    statsBar.append(pill);
  }
  stage.innerHTML = activeShareCardRendered.svg;
}

let lastArchiveBytesInMemory = null;
let lastVerifiedVaultArchive = null;

function buildLiveVaultNotesForInspection() {
  richEditor.flush();
  return (vaultState?.notes || []).map(n =>
    n.id === activeNoteIdentity ? { ...n, source: documentSession.source } : n
  );
}

function openVaultArchiveDialog() {
  const dialog = find('#vault-archive-dialog');
  if (!dialog) return;
  const verifyLatestBtn = find('#vault-archive-verify-latest-btn');
  if (verifyLatestBtn) verifyLatestBtn.disabled = !lastArchiveBytesInMemory;
  const statsBar = find('#vault-archive-stats-bar');
  const listEl = find('#vault-archive-items-list');
  if (statsBar && !statsBar.children.length) {
    const liveNotes = buildLiveVaultNotesForInspection();
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = 'teal';
    pill.textContent = `当前知识库《${vaultState?.vaultName || '本地知识库'}》 · 共 ${liveNotes.length} 篇笔记`;
    statsBar.append(pill);
  }
  if (listEl && !listEl.children.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '点击上方「📦 打包导出全库归档 (.zip)」生成带 64 位 SHA-256 签名清单的便携包，或选择已有归档包进行完整性核验。';
    listEl.append(empty);
  }
  if (!dialog.open) dialog.showModal();
}

async function runVaultArchiveVerification(bytes) {
  const summaryEl = find('#vault-archive-summary');
  const statsBar = find('#vault-archive-stats-bar');
  const listEl = find('#vault-archive-items-list');
  const restoreBtn = find('#vault-archive-restore-btn');
  if (!statsBar || !listEl) return;

  const liveNotes = buildLiveVaultNotesForInspection();
  const report = await inspectAndVerifyVaultPortableArchive(bytes, liveNotes);
  lastVerifiedVaultArchive = report;

  statsBar.replaceChildren();
  listEl.replaceChildren();

  if (!report.valid) {
    if (restoreBtn) restoreBtn.disabled = true;
    if (summaryEl) summaryEl.textContent = `❌ ${report.error}`;
    const errPill = document.createElement('span');
    errPill.className = 'ai-sr-stat-pill';
    errPill.dataset.pillTone = 'rose';
    errPill.textContent = 'SHA-256 完整性校验失败 · 已阻断写入';
    statsBar.append(errPill);
    for (const bad of [...(report.missingEntries || []).map(p => ({ zipPath: p, reason: '归档缺失文件' })), ...(report.tamperedEntries || [])]) {
      const row = document.createElement('div');
      row.className = 'note-diff-hunk-card';
      row.innerHTML = `<strong>❌ ${escapeHtml(bad.zipPath)}</strong><small>${escapeHtml(bad.reason || '哈希不匹配')}</small>`;
      listEl.append(row);
    }
    return;
  }

  if (summaryEl) {
    summaryEl.textContent = `✅ 归档包《${report.manifest.vaultName}》SHA-256 签名与 ${report.verifiedEntryCount} 个文件逐项校验通过（签名：${report.manifestSha256.slice(0, 16)}…）`;
  }
  if (restoreBtn) {
    restoreBtn.disabled = report.restorableCount === 0;
  }
  for (const [txt, tone] of [
    [`✅ 验签通过 · ${report.verifiedNoteCount} 篇笔记`, 'emerald'],
    [`一致 ${report.unchangedCount} 篇`, 'teal'],
    [`变更 ${report.modifiedCount} 篇`, 'amber'],
    [`库内缺失 ${report.missingInVaultCount} 篇`, 'rose'],
    [`当前库新增 ${report.addedInVaultCount} 篇`, 'blue'],
  ]) {
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = tone;
    pill.textContent = txt;
    statsBar.append(pill);
  }

  for (const item of report.comparisonItems.slice(0, 80)) {
    const card = document.createElement('div');
    card.className = 'note-diff-hunk-card';
    card.dataset.archiveItemStatus = item.status;
    card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${escapeHtml(item.relativePath)}</strong><span class="property-pill" data-pill-tone="${item.status === 'unchanged' ? 'emerald' : item.status === 'added-in-vault' ? 'blue' : 'amber'}">${escapeHtml(item.statusLabel)}</span></div><small>SHA-256: <code>${escapeHtml(item.sha256.slice(0, 20))}…</code> · ${item.bytes} B</small>`;
    listEl.append(card);
  }
}

let activeEmbedInspectionReport = null;

function openEmbedInspectorDialog(defaultScope = '') {
  const dialog = find('#embed-inspector-dialog');
  if (!dialog) return;
  const scopeSelect = find('#embed-inspector-scope-select');
  if (scopeSelect && (defaultScope === 'note' || defaultScope === 'vault')) {
    scopeSelect.value = defaultScope;
  }
  renderEmbedInspectorDialog();
  if (!dialog.open) dialog.showModal();
}

function renderEmbedInspectorDialog() {
  const scope = find('#embed-inspector-scope-select')?.value || 'note';
  const statsBar = find('#embed-inspector-stats-bar');
  const listEl = find('#embed-inspector-list');
  const repairAllBtn = find('#embed-inspector-repair-all-btn');
  if (!statsBar || !listEl) return;

  const liveNotes = buildLiveVaultNotesForInspection();
  let report = inspectVaultEmbedReferences(liveNotes, {
    focusNoteId: scope === 'note' ? activeNoteIdentity : '',
  });
  // If current note has zero embeds and user just opened with default 'note', still keep explicit scope
  activeEmbedInspectionReport = report;

  if (repairAllBtn) {
    repairAllBtn.disabled = report.repairableCount === 0;
  }
  statsBar.replaceChildren();
  for (const [txt, tone] of [
    [`总内嵌引用 ${report.totalEmbeds} 处`, 'teal'],
    [`正常同步 ${report.healthyCount} 处`, 'emerald'],
    [`断链/改名 ${report.brokenCount} 处`, report.brokenCount > 0 ? 'rose' : 'blue'],
    [`可自动对齐 ${report.repairableCount} 处`, 'amber'],
  ]) {
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = tone;
    pill.textContent = txt;
    statsBar.append(pill);
  }

  listEl.replaceChildren();
  if (!report.items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = scope === 'note'
      ? '当前笔记暂无 ![[笔记#章节]] 或 ![[笔记#^block-id]] 内嵌引用，可切换上方下拉框巡检「全库全部跨笔记内嵌引用」。'
      : '全库当前未检测到跨笔记内嵌引用。';
    listEl.append(empty);
    return;
  }

  for (const [idx, item] of report.items.entries()) {
    const card = document.createElement('div');
    card.className = 'note-diff-hunk-card embed-inspector-card';
    card.dataset.embedStatus = item.status;
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap';
    const titleEl = document.createElement('strong');
    titleEl.textContent = `《${item.hostTitle}》 第 ${item.lineNum} 行 · ${item.raw}`;
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'task-row-actions';

    if (item.targetNoteId) {
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'small-command';
      jumpBtn.dataset.embedJumpIndex = String(idx);
      jumpBtn.textContent = '↗ 跳至源笔记';
      actionsWrap.append(jumpBtn);
    }

    if (item.repairable) {
      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'primary-command';
      fixBtn.dataset.embedRepairIndex = String(idx);
      fixBtn.textContent = `✨ 修复为 #${item.suggestedFragment}`;
      actionsWrap.append(fixBtn);
    }

    headRow.append(titleEl, actionsWrap);
    card.append(headRow);

    const detailEl = document.createElement('small');
    if (item.status === 'ready') {
      detailEl.textContent = `✅ 已同步《${item.targetTitle}》${item.fragment ? ` · 锚点「${item.fragment}」` : ''}（共 ${item.previewLineCount} 行）：${item.previewExcerpt}`;
    } else {
      detailEl.textContent = `⚠️ 状态：${item.status}${item.suggestionReason ? ` — ${item.suggestionReason}` : ''}`;
    }
    card.append(detailEl);
    listEl.append(card);
  }
}

let activeVaultReplacePlan = null;
let lastVaultReplaceRollback = null;

function openVaultReplaceDialog() {
  const dialog = find('#vault-replace-dialog');
  if (!dialog) return;
  const queryInput = find('#vault-replace-query');
  const replaceInput = find('#vault-replace-replacement');
  const localSearchVal = find('#search-input')?.value || '';
  const localReplaceVal = find('#replace-input')?.value || '';
  if (queryInput && !queryInput.value && localSearchVal) {
    queryInput.value = localSearchVal;
  }
  if (replaceInput && !replaceInput.value && localReplaceVal) {
    replaceInput.value = localReplaceVal;
  }
  const undoBtn = find('#vault-replace-undo-btn');
  if (undoBtn) undoBtn.disabled = !lastVaultReplaceRollback?.entries?.length;
  const modeVal = find('#vault-replace-mode')?.value || 'text';
  const textOpts = find('#vault-replace-text-options');
  if (textOpts) textOpts.hidden = modeVal === 'yaml-key';
  if (!dialog.open) dialog.showModal();
  queryInput?.focus();
}

function renderVaultReplacePreview() {
  const mode = find('#vault-replace-mode')?.value || 'text';
  const query = find('#vault-replace-query')?.value ?? '';
  const replacement = find('#vault-replace-replacement')?.value ?? '';
  const folderPrefix = find('#vault-replace-folder')?.value ?? '';
  const useRegex = Boolean(find('#vault-replace-regex')?.checked);
  const caseSensitive = Boolean(find('#vault-replace-case')?.checked);
  const skipCodeBlocks = Boolean(find('#vault-replace-skip-code')?.checked);
  const protectWikiLinkTargets = Boolean(find('#vault-replace-protect-links')?.checked);

  const summaryEl = find('#vault-replace-summary');
  const statsBar = find('#vault-replace-stats-bar');
  const listEl = find('#vault-replace-preview-list');
  const applyBtn = find('#vault-replace-apply-btn');
  if (!statsBar || !listEl) return;

  try {
    const liveNotes = buildLiveVaultNotesForInspection();
    const preview = previewVaultSearchAndReplace(liveNotes, {
      mode,
      query,
      replacement,
      useRegex,
      caseSensitive,
      folderPrefix,
      skipCodeBlocks,
      protectWikiLinkTargets,
    });
    activeVaultReplacePlan = preview;
    if (applyBtn) applyBtn.disabled = preview.totalReplacements === 0;

    statsBar.replaceChildren();
    for (const [txt, tone] of [
      [`扫描笔记 ${preview.totalScannedNotes} 篇`, 'teal'],
      [`命中文件 ${preview.matchedNoteCount} 篇`, 'blue'],
      [`待替换 ${preview.totalReplacements} 处`, preview.totalReplacements > 0 ? 'amber' : 'emerald'],
      [mode === 'yaml-key' ? '模式 · YAML 键重命名' : `保护 · ${protectWikiLinkTargets ? '双链已保护' : '全匹配'}`, 'purple'],
    ]) {
      const pill = document.createElement('span');
      pill.className = 'ai-sr-stat-pill';
      pill.dataset.pillTone = tone;
      pill.textContent = txt;
      statsBar.append(pill);
    }

    if (summaryEl) {
      summaryEl.textContent = preview.totalReplacements > 0
        ? `🔍 预览就绪：共在 ${preview.matchedNoteCount} 篇笔记中命中 ${preview.totalReplacements} 处可安全替换项`
        : '未命中任何可替换项，请调整查找词或过滤范围';
    }

    listEl.replaceChildren();
    if (!preview.notePlans.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '当前条件下暂无匹配结果。';
      listEl.append(empty);
      return;
    }

    for (const plan of preview.notePlans.slice(0, 60)) {
      const card = document.createElement('div');
      card.className = 'note-diff-hunk-card vault-replace-card';
      card.dataset.replaceNoteId = plan.noteId;
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px';
      head.innerHTML = `<strong>《${escapeHtml(plan.title)}》 <small style="font-weight:400;opacity:0.75">(${escapeHtml(plan.relativePath)})</small></strong><span class="property-pill" data-pill-tone="amber">${plan.replacementCount} 处变更</span>`;
      card.append(head);

      const diffWrap = document.createElement('div');
      diffWrap.className = 'vault-replace-diff-lines';
      for (const diff of plan.lineDiffs) {
        const lineBox = document.createElement('div');
        lineBox.className = 'vault-replace-diff-pair';
        lineBox.innerHTML =
          `<div class="diff-line diff-removed"><span>L${diff.lineNum} -</span><code>${escapeHtml(diff.beforeLine)}</code></div>` +
          `<div class="diff-line diff-added"><span>L${diff.lineNum} +</span><code>${escapeHtml(diff.afterLine)}</code></div>`;
        diffWrap.append(lineBox);
      }
      card.append(diffWrap);
      listEl.append(card);
    }
  } catch (err) {
    activeVaultReplacePlan = null;
    if (applyBtn) applyBtn.disabled = true;
    showError(err);
  }
}

const multiWindowState = {
  windowId: startupState?.windowId || 'primary',
  isSecondary: Boolean(startupState?.isSecondary),
  activeWindowCount: Number(startupState?.activeWindowCount) || 1,
  windows: Array.isArray(startupState?.windows) ? startupState.windows : [],
  lastSyncMessage: '主副窗口共享单实例 VaultStore 锁与跨窗实时同步总线',
};

function updateMultiWindowBadge() {
  const hubLabel = find('#multi-window-hub-label');
  if (hubLabel) {
    hubLabel.textContent = `多屏协同副窗口管理 (${multiWindowState.activeWindowCount})`;
  }
}

function renderMultiWindowDialog() {
  const listEl = find('#multi-window-list');
  const summaryEl = find('#multi-window-summary');
  const logEl = find('#multi-window-sync-log');
  if (!listEl) return;
  const secondaryCount = multiWindowState.windows.filter(w => w.isSecondary).length;
  if (summaryEl) {
    summaryEl.textContent = `当前活跃窗口：共 ${multiWindowState.activeWindowCount} 个（主工作区 1 个 · 独立副窗口 ${secondaryCount} 个）`;
  }
  if (logEl) {
    logEl.textContent = multiWindowState.lastSyncMessage;
  }
  listEl.replaceChildren();
  const typeLabels = {
    note: '📄 笔记工作窗',
    graph: '🕸️ 万象知识星图',
    whiteboard: '🎨 Excalidraw 白板',
    reader: '📖 原件精读器',
  };
  for (const win of multiWindowState.windows) {
    const card = document.createElement('div');
    card.className = 'note-diff-hunk-card multi-window-item-card';
    card.dataset.windowEntryId = win.windowId;
    card.dataset.windowSecondary = String(Boolean(win.isSecondary));
    const head = document.createElement('div');
    head.className = 'note-diff-hunk-head';
    const badgeText = win.isSecondary ? (typeLabels[win.targetType] || '🪟 独立副窗口') : '🏠 主工作区窗口';
    const titleStrong = document.createElement('strong');
    titleStrong.textContent = `${badgeText} · ${win.title || '主工作区'}`;
    head.append(titleStrong);
    if (win.isSecondary) {
      const closeSubBtn = document.createElement('button');
      closeSubBtn.type = 'button';
      closeSubBtn.className = 'small-command';
      closeSubBtn.dataset.closeWindowId = win.windowId;
      closeSubBtn.textContent = '关闭副窗口';
      closeSubBtn.onclick = async () => {
        try {
          const res = await call('closeSecondaryWindow', { targetWindowId: win.windowId });
          multiWindowState.activeWindowCount = res?.activeWindowCount || 1;
          multiWindowState.windows = Array.isArray(res?.windows) ? res.windows : [];
          updateMultiWindowBadge();
          renderMultiWindowDialog();
        } catch (err) {
          showError(err);
        }
      };
      head.append(closeSubBtn);
    } else {
      const primaryBadge = document.createElement('small');
      primaryBadge.textContent = `窗口 ID: ${String(win.windowId).slice(0, 8)}`;
      head.append(primaryBadge);
    }
    card.append(head);
    listEl.append(card);
  }
}

async function openTargetInSecondaryWindow(rawSpec = {}) {
  const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);
  const spec = validateSecondaryWindowSpec({
    targetType: rawSpec.targetType || 'note',
    targetId: rawSpec.targetId ?? (rawSpec.targetType && rawSpec.targetType !== 'note' ? '' : activeNoteIdentity),
    title: rawSpec.title || activeNode?.cleanTitle || activeNode?.title || stripNumericPrefix(documentInfo.name),
    relativePath: rawSpec.relativePath ?? (rawSpec.targetType && rawSpec.targetType !== 'note' ? '' : (activeNode?.relativePath || documentInfo.relativePath || '')),
    readerPage: rawSpec.readerPage,
    readerCfi: rawSpec.readerCfi,
  });
  const res = await call('openSecondaryWindow', {
    ...spec,
    path: rawSpec.path || activeNode?.path || documentInfo.path || '',
  });
  multiWindowState.activeWindowCount = Number(res?.activeWindowCount) || (multiWindowState.activeWindowCount + 1);
  if (Array.isArray(res?.windows)) multiWindowState.windows = res.windows;
  multiWindowState.lastSyncMessage = `已拆出独立副窗口「${spec.title}」（类型：${spec.targetType} · 活跃窗口 ${multiWindowState.activeWindowCount} 个）`;
  updateMultiWindowBadge();
  if (find('#multi-window-dialog')?.open) renderMultiWindowDialog();
  toast(`↗ 已在独立副窗口打开「${spec.title}」（当前共 ${multiWindowState.activeWindowCount} 个窗口协同）`);
  return res;
}
window.__inkloomOpenSecondaryWindow = openTargetInSecondaryWindow;

async function openMultiWindowDialog() {
  try {
    const res = await call('listWindows');
    if (res) {
      multiWindowState.activeWindowCount = Number(res.activeWindowCount) || 1;
      multiWindowState.windows = Array.isArray(res.windows) ? res.windows : [];
      updateMultiWindowBadge();
    }
  } catch {}
  const dialog = find('#multi-window-dialog');
  if (!dialog) return;
  renderMultiWindowDialog();
  if (!dialog.open) dialog.showModal();
}

let oneNoteHierarchyState = null;
let oneNoteSelectedPageIds = new Set();
let oneNoteActivePreviewPage = null;
const oneNotePageXmlCache = new Map();
let oneNoteImportStep = 0;
let oneNoteImportBusy = false;
let oneNotePreviewSequence = 0;
let oneNoteArchive = null;

function showOneNoteStep(step) {
  oneNoteImportStep = step;
  for (const [index, id] of ['onenote-source-step', 'onenote-pages-step', 'onenote-review-step'].entries()) find('#' + id).hidden = step !== index;
  for (const item of document.querySelectorAll('[data-import-step]')) item.setAttribute('aria-current', Number(item.dataset.importStep) === step ? 'step' : 'false');
  find('#onenote-step-back').hidden = step === 0;
  find('#onenote-step-next').hidden = step !== 1;
  find('#onenote-step-next').disabled = oneNoteImportBusy || !oneNoteSelectedPageIds.size;
  find('#onenote-com-commit-btn').hidden = step !== 2;
  find('#onenote-com-commit-btn').disabled = oneNoteImportBusy || !desktop || !oneNoteSelectedPageIds.size;
}

function reportOneNoteError(error) {
  find('#onenote-com-status').textContent = error.message || String(error);
  find('#onenote-com-commit-btn').disabled = true;
}

async function fetchOneNotePageConversion(pageItem) {
  if (!pageItem) return null;
  if (oneNoteArchive) return convertOneNoteToMarkdown(oneNoteArchive.source, { fileName: oneNoteArchive.name, targetFolder: find('#onenote-com-target-folder').value.trim() || 'OneNote迁入' });
  let pageXml = oneNotePageXmlCache.get(pageItem.id);
  if (!pageXml) {
    const res = await call('oneNoteGetPageContent', { pageId: pageItem.id });
    if (!res?.liveComConnected || !res.xml) throw new Error('未读取到 OneNote 页面，未使用示例或替代内容。');
    pageXml = res.xml;
    oneNotePageXmlCache.set(pageItem.id, pageXml);
  }
  const rootFolder = find('#onenote-com-target-folder')?.value.trim() || 'OneNote迁入';
  return convertOneNotePageXmlToMarkdown(pageXml, {
    notebookName: pageItem.notebookName,
    sectionName: pageItem.sectionName,
    targetRootFolder: rootFolder,
    today: pageItem.dateTime || localDate(),
  });
}

async function renderOneNoteComPreview() {
  const sequence = ++oneNotePreviewSequence;
  const previewBox = find('#onenote-com-preview');
  const statsGrid = find('#onenote-com-stats-grid');
  if (!previewBox || !statsGrid) return;

  const converted = await fetchOneNotePageConversion(oneNoteActivePreviewPage);
  if (!converted || sequence !== oneNotePreviewSequence) return;

  statsGrid.replaceChildren();
  const st = converted.stats;
  for (const [k, v] of [
    ['勾选页面', `已选 ${oneNoteSelectedPageIds.size} 页（共 ${oneNoteHierarchyState?.totalPages || 0} 页）`],
    ['画布重排', `${st.canvasBlocksLinearized} 个坐标框 → 线性章节`],
    ['提取原图', `${st.imageCount} 张（含手写墨迹 ${st.inkDrawingCount || 0} 处 SVG） → assets/onenote/`],
    ['随页附件', `${st.attachmentCount} 份 → attachments/onenote/`],
    ['保真认证', converted.fidelityAudit?.summaryText || '✓ 全保真校验通过'],
  ]) {
    const r = document.createElement('div');
    r.className = 'chronicle-kv-row';
    const keySpan = document.createElement('span');
    keySpan.className = 'chronicle-kv-key';
    keySpan.textContent = k;
    const valSpan = document.createElement('span');
    valSpan.className = 'chronicle-kv-val';
    valSpan.textContent = v;
    r.append(keySpan, valSpan);
    statsGrid.append(r);
  }

  renderRichMarkdownDocument(previewBox, converted.markdown, {
    headerBadge: `📄 预览 · 《${converted.title}》 (${converted.notebookName} / ${converted.sectionName})`,
    rawSource: converted.markdown,
    onOpenLink: link => {
      if (link.startsWith('[[')) {
        const target = link.slice(2, -2).split('|')[0];
        find('#onenote-com-dialog')?.close();
        followWikiLink({ target, heading: '', ghost: false }).catch(showError);
      }
    },
  });
  const missing = [...converted.extractedImages, ...converted.extractedAttachments].filter(asset => !asset.base64Data && !asset.dataUri);
  showOneNoteStep(oneNoteImportStep);
  if (missing.length) reportOneNoteError(new Error(`${missing.length} 项图片或附件未取得原始数据，迁入已阻止。`));
}

function renderOneNoteHierarchyTree() {
  const treeEl = find('#onenote-hierarchy-tree');
  if (!treeEl || !oneNoteHierarchyState) return;
  treeEl.replaceChildren();

  for (const nb of oneNoteHierarchyState.notebooks) {
    const nbHead = document.createElement('div');
    nbHead.className = 'onenote-tree-nb';
    nbHead.textContent = `📓 ${nb.name}`;
    treeEl.append(nbHead);

    for (const sec of nb.sections) {
      const secHead = document.createElement('div');
      secHead.className = 'onenote-tree-sec';
      secHead.textContent = `📂 ${sec.name}`;
      treeEl.append(secHead);

      for (const page of sec.pages) {
        const isCurrent = oneNoteActivePreviewPage?.id === page.id;
        const row = document.createElement('div');
        row.className = 'compiler-source-check-row onenote-tree-page-row' + (isCurrent ? ' is-active' : '');
        row.dataset.onenotePageId = page.id;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = oneNoteSelectedPageIds.has(page.id);
        chk.setAttribute('aria-label', `勾选迁入 ${page.name}`);
        chk.onchange = () => {
          if (chk.checked) oneNoteSelectedPageIds.add(page.id);
          else oneNoteSelectedPageIds.delete(page.id);
          find('#onenote-com-status').textContent = `已选 ${oneNoteSelectedPageIds.size} 页`;
          showOneNoteStep(oneNoteImportStep);
        };

        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'onenote-page-select-btn';
        previewBtn.textContent = page.name;
        previewBtn.title = `点击预览《${page.name}》转换效果`;
        previewBtn.onclick = () => {
          oneNoteActivePreviewPage = page;
          renderOneNoteHierarchyTree();
          showOneNoteStep(2);
          void renderOneNoteComPreview().catch(reportOneNoteError);
        };

        row.append(chk, previewBtn);
        treeEl.append(row);
      }
    }
  }
}

async function scanOneNoteComHierarchy(customXml = '') {
  const badge = find('#onenote-com-provider-badge');
  const statusEl = find('#onenote-com-status');
  let xml = customXml;
  let liveCom = false;
  oneNotePageXmlCache.clear(); oneNoteArchive = null; oneNoteHierarchyState = null; oneNoteSelectedPageIds.clear(); oneNoteActivePreviewPage = null;
  find('#onenote-hierarchy-tree').replaceChildren(); find('#onenote-com-preview').replaceChildren(); showOneNoteStep(0);
  badge.textContent = '正在连接';
  if (!xml) {
    const res = await call('oneNoteGetHierarchy');
    xml = res?.xml || ''; liveCom = Boolean(res?.liveComConnected);
  }
  if (!xml) {
    badge.textContent = '未连接';
    statusEl.textContent = desktop ? '未读取到桌面 OneNote。请确认已安装并打开笔记本。' : '浏览器无法连接桌面 OneNote，可选择导出文件预览。';
    return;
  }
  oneNoteHierarchyState = parseOneNoteHierarchyXml(xml);
  const allPages = oneNoteHierarchyState.notebooks.flatMap(nb => nb.sections.flatMap(s => s.pages));
  oneNoteSelectedPageIds = new Set();
  oneNoteActivePreviewPage = allPages[0] || null;

  if (badge) {
    badge.textContent = liveCom
      ? `已连接 · ${oneNoteHierarchyState.totalNotebooks} 本笔记本`
      : `已读取层级文件 · ${oneNoteHierarchyState.totalNotebooks} 本笔记本`;
  }
  if (statusEl) {
    statusEl.textContent = `已扫描到 ${oneNoteHierarchyState.totalNotebooks} 本笔记本、${oneNoteHierarchyState.totalPages} 个页面，点击左侧页面可实时预览`;
  }
  renderOneNoteHierarchyTree();
  if (allPages.length) showOneNoteStep(1);
}

async function commitOneNoteBatchImport(openAfter = false) {
  if (!oneNoteHierarchyState || oneNoteImportBusy || !desktop || !oneNoteSelectedPageIds.size) return;
  const commitBtn = find('#onenote-com-commit-btn');
  const statusEl = find('#onenote-com-status');
  oneNoteImportBusy = true; showOneNoteStep(2);
  if (commitBtn) commitBtn.disabled = true;
  let importedNotes = 0;

  try {
    const allPages = oneNoteHierarchyState.notebooks.flatMap(nb => nb.sections.flatMap(s => s.pages));
    const chosenPages = allPages.filter(p => oneNoteSelectedPageIds.has(p.id));
    const targetPages = chosenPages;
    const conversions = [];
    for (const pageItem of targetPages) {
      const converted = await fetchOneNotePageConversion(pageItem);
      const assets = [...converted.extractedImages, ...converted.extractedAttachments];
      if (assets.some(asset => !asset.base64Data && !asset.dataUri)) throw new Error('部分附件缺少原始数据，本批次尚未写入。');
      conversions.push(converted);
    }

    let savedImages = 0;
    let savedAttachments = 0;
    let firstCreatedId = null;

    for (const converted of conversions) {

      for (const img of converted.extractedImages || []) {
        if (img.base64Data || img.dataUri) {
          await call('oneNoteSaveBinaryAsset', {
            relativePath: img.targetPath,
            base64Data: img.base64Data || img.dataUri.split(',')[1],
          });
          savedImages++;
        }
      }
      for (const att of converted.extractedAttachments || []) {
        if (att.base64Data) {
          await call('oneNoteSaveBinaryAsset', {
            relativePath: att.targetPath,
            base64Data: att.base64Data,
          });
          savedAttachments++;
        }
      }

      const created = await createPluginNote(converted.title, {
        folder: converted.folder,
        source: converted.markdown,
        background: true,
      });
      if (!firstCreatedId && created?.id) firstCreatedId = created.id;
      importedNotes++;
    }

    if (statusEl) {
      statusEl.textContent = `✅ 已成功迁入 ${importedNotes} 篇 OneNote 笔记，落盘 ${savedImages} 张原图（assets/onenote/）与 ${savedAttachments} 份随页附件（attachments/onenote/）`;
    }
    toast(`已从 OneNote 整本迁入 ${importedNotes} 篇笔记（含 ${savedImages} 张图片、${savedAttachments} 份附件）`);

    if (openAfter && firstCreatedId) {
      find('#onenote-com-dialog')?.close();
      await openVaultNoteById(firstCreatedId);
    }
  } catch (err) {
    reportOneNoteError(new Error(`已写入 ${importedNotes} 页；${err.message}`));
  } finally {
    oneNoteImportBusy = false;
    find('#onenote-step-back').disabled = false;
  }
}

async function openOneNoteComDialog() {
  const dialog = find('#onenote-com-dialog');
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  showOneNoteStep(oneNoteHierarchyState ? 1 : 0);
}

function getSelectedDiffBaselineSource() {
  ensureNoteHistoryBaselines();
  const mode = find('#note-diff-baseline-select')?.value || 'saved';
  if (mode === 'initial') {
    return noteInitialSourceById.get(activeNoteIdentity) ?? documentSession.source;
  }
  return noteSavedBaselineById.get(activeNoteIdentity) ?? vaultState.notes.find(n => n.id === activeNoteIdentity)?.source ?? documentSession.source;
}

function renderNoteDiffDialog() {
  const baselineSource = getSelectedDiffBaselineSource();
  const diff = computeNoteLineDiff(baselineSource, documentSession.source);
  const statsBar = find('#note-diff-stats-bar');
  const hunksList = find('#note-diff-hunks-list');
  const revertAllBtn = find('#note-diff-revert-all');
  if (!statsBar || !hunksList) return;

  if (revertAllBtn) revertAllBtn.disabled = diff.identical;
  statsBar.replaceChildren();
  const statDefs = [
    [`变更块 ${diff.stats.hunks} 处`, 'teal'],
    [`新增 +${diff.stats.added} 行`, 'emerald'],
    [`删除 -${diff.stats.removed} 行`, 'rose'],
    [`未变更 ${diff.stats.unchanged} 行`, 'slate'],
  ];
  for (const [label, tone] of statDefs) {
    const pill = document.createElement('span');
    pill.className = 'ai-sr-stat-pill';
    pill.dataset.pillTone = tone;
    pill.textContent = label;
    statsBar.append(pill);
  }

  hunksList.replaceChildren();
  if (diff.identical) {
    const empty = document.createElement('p');
    empty.className = 'search-results-empty';
    empty.textContent = '当前笔记内容与所选基线版本完全一致，无增删差异。';
    hunksList.append(empty);
    return;
  }

  for (const hunk of diff.hunks) {
    const card = document.createElement('article');
    card.className = 'note-diff-hunk-card';
    card.dataset.diffHunkId = hunk.id;
    const head = document.createElement('div');
    head.className = 'note-diff-hunk-head';
    const title = document.createElement('strong');
    title.textContent = `${hunk.header} （${hunk.summary}）`;
    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.className = 'small-command';
    revertBtn.dataset.revertHunk = hunk.id;
    revertBtn.textContent = '还原此更改块';
    revertBtn.onclick = () => {
      const reverted = revertDiffHunk(documentSession.source, getSelectedDiffBaselineSource(), hunk.id);
      if (reverted.reverted) {
        changeDocument(minimalChange(documentSession.source, reverted.source), 'command');
        richEditor.flush();
        renderNoteDiffDialog();
        toast(`已局部还原更改块 ${hunk.id}（可按 Ctrl+Z 撤销）`);
      }
    };
    head.append(title, revertBtn);

    const linesBox = document.createElement('div');
    linesBox.className = 'note-diff-lines';
    for (const line of hunk.lines) {
      const row = document.createElement('div');
      row.className = 'note-diff-line ' + (line.type === 'del' ? 'is-del' : 'is-add');
      const prefix = line.type === 'del' ? '-' : '+';
      row.textContent = `${prefix} ${line.text}`;
      linesBox.append(row);
    }
    card.append(head, linesBox);
    hunksList.append(card);
  }
}

function togglePomodoroTimer() {
  const pill = find('#pomodoro-pill');
  const clock = find('#pomodoro-clock');
  if (!pill || !clock) return;
  if (pomodoroRunning) {
    clearInterval(pomodoroTimerId);
    pomodoroTimerId = null;
    pomodoroRunning = false;
    pill.setAttribute('aria-pressed', 'false');
    toast('心流番茄钟已暂停');
    return;
  }
  if (pomodoroRemainingSec <= 0) pomodoroRemainingSec = 1500;
  pomodoroRunning = true;
  pill.setAttribute('aria-pressed', 'true');
  clock.textContent = formatPomodoroClock(pomodoroRemainingSec);
  clearInterval(pomodoroTimerId);
  pomodoroTimerId = setInterval(() => {
    pomodoroRemainingSec = Math.max(0, pomodoroRemainingSec - 1);
    clock.textContent = formatPomodoroClock(pomodoroRemainingSec);
    if (pomodoroRemainingSec <= 0) {
      clearInterval(pomodoroTimerId);
      pomodoroTimerId = null;
      pomodoroRunning = false;
      pill.setAttribute('aria-pressed', 'false');
      pomodoroRemainingSec = 1500;
      clock.textContent = formatPomodoroClock(pomodoroRemainingSec);
      toast('🍅 25 分钟心流番茄钟已完成！');
    }
  }, 1000);
  toast('🍅 已启动 25 分钟心流番茄钟');
}

function updateWordCount(doc) {
  const counts = wordStatistics(doc);
  find('#word-count').textContent = counts.total.toLocaleString() + ' 字';
  find('#word-count').title = `汉字 ${counts.han.toLocaleString()} · 字母 ${counts.letters.toLocaleString()} · 数字 ${counts.numbers.toLocaleString()}`;
  if (typeof sessionPositiveDeltaWords !== 'number' || Number.isNaN(sessionPositiveDeltaWords)) {
    sessionPositiveDeltaWords = 0;
  }
  if (sessionInitialWordBaseline === null || sessionInitialWordBaseline === undefined) {
    sessionInitialWordBaseline = counts.total;
    lastDocumentTotalWords = counts.total;
  } else {
    const diff = counts.total - (lastDocumentTotalWords || counts.total);
    if (diff > 0 && diff < 2000) sessionPositiveDeltaWords += diff;
    lastDocumentTotalWords = counts.total;
  }
  const pomoWords = find('#pomodoro-words');
  if (pomoWords) pomoWords.textContent = `今日 +${sessionPositiveDeltaWords || 0} 字`;
}

function updateStatus() {
  for (const button of document.querySelectorAll('[data-action="settings"], [data-action="open-settings"]')) button.disabled = saving;
  ensureNoteHistoryBaselines();
  find('#file-name').textContent = documentInfo.name;
  find('#dirty-dot').hidden = !dirty();
  const discardBtn = find('#discard-draft-btn');
  if (discardBtn) discardBtn.hidden = !dirty();
  renderTopDewdropTabs();
  const recoveryLabels = { pending: '正在保护输入...', writing: '正在写入恢复日志...', protected: '恢复副本已落盘', error: '恢复保护失败' };
  find('#save-state').textContent = saving ? '正在保存...' : dirty() ? '未保存' + (desktop ? ' · ' + (recoveryLabels[recoveryState] || '等待恢复保护') : '') : documentInfo.path ? (desktop ? '已保存到本地' : '已保存到浏览器副本') : '本地草稿';
  find('#save-state').dataset.recovery = recoveryState;
  find('#selection-count').textContent = selection.to > selection.from ? '选中 ' + (selection.to - selection.from) : '';
  const line = sourceEditor.view.state.doc.lineAt(Math.min(selection.from, sourceEditor.view.state.doc.length));
  find('#line-info').textContent = `Ln ${line.number}, Col ${Math.max(1, selection.from - line.from + 1)}`;
  find('[data-action="undo"]').disabled = !documentSession.past.length;
  find('[data-action="redo"]').disabled = !documentSession.future.length;
  document.title = (dirty() ? '* ' : '') + documentInfo.name + ' - Inkloom 墨图';
  if (workspace.active?.state) {
    workspace.active.state.savedRevision = savedRevision;
    workspace.active.state.info = { ...documentInfo };
    workspace.active.dirty = dirty();
  }
  clearTimeout(statusTimer);
  const state = { documentId: recoveryDocumentId, dirty: dirty(), name: documentInfo.name };
  if (desktop) statusTimer = setTimeout(() => call('state', state).catch(showError), 50);
  workbench?.draftChanged({ noteId: activeNoteIdentity, revision: documentSession.revision, dirty: dirty(), saving });
}

function changed() {
  speechReader?.stop();
  updateStatus();
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    updateNavigation();
    rebuildVaultGraph();
  }, 160);
  if (!find('#search-panel').hidden && find('#search-input').value) scheduleSearch();
  recoveryWriter?.schedule();
}

function changeDocument(change, origin) {
  let normalizedChange = change;
  if (origin === 'rich' && typeof change?.insert === 'string' && change.insert.includes('\\[')) {
    normalizedChange = { ...change, insert: unescapeWikiLinksInMarkdown(change.insert) };
  }
  if (!documentSession.replace(normalizedChange)) return;
  searchWorker.postMessage({ type: 'change', change: normalizedChange, revision: documentSession.revision });
  if (origin !== 'source') sourceEditor.replace(normalizedChange);
  if (origin !== 'rich') richEditor.schedule(documentSession.source);
  changed();
  requestAnimationFrame(updateWikiAutocomplete);
  requestAnimationFrame(() => phaseTwo?.updateSlash());
}

function history(actionName) {
  richEditor.flush();
  const before = documentSession.source;
  if (!documentSession[actionName]()) return false;
  if (before !== documentSession.source) sourceEditor.replace(minimalChange(before, documentSession.source));
  richEditor.load(documentSession.source);
  sourceEditor.refresh();
  searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
  changed();
  return true;
}

function hideInlineAiPopover() {
  const pop = find('#inline-ai-popover');
  if (pop) pop.hidden = true;
  inlineAiSelectionRange = null;
}

async function openInlineAiPopover(actionId, anchorEl) {
  const selectedText = documentSession.source.slice(selection.from, selection.to);
  if (selection.from >= selection.to || !selectedText.trim()) return;
  inlineAiSelectionRange = { from: selection.from, to: selection.to };
  const pop = find('#inline-ai-popover');
  if (!pop) return;
  const actionMeta = INLINE_AI_ACTIONS.find(a => a.id === actionId) || INLINE_AI_ACTIONS[0];
  const related = computeLiveSmartConnections({
    activeNoteId: activeNoteIdentity,
    activeTitle: documentInfo.name,
    source: documentSession.source,
    cursorOffset: selection.from,
    notes: vaultGraph?.notes || [],
    limit: 1,
  });
  const localResult = transformSelectedTextWithAi(actionId, selectedText, {
    noteTitle: documentInfo.name,
    relatedCitation: related[0]?.citation || '',
  });

  find('#inline-ai-title').textContent = `✨ ${actionMeta.label} · 原位预览`;
  const summaryBadge = find('#inline-ai-summary');
  summaryBadge.dataset.pillTone = actionMeta.tone;
  summaryBadge.textContent = localResult.summary;
  const previewInput = find('#inline-ai-preview-text');
  previewInput.value = localResult.output;

  const rect = (anchorEl || find('#selection-tools')).getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(12, Math.min(window.innerWidth - 400, rect.left)) + 'px';
  pop.style.top = Math.max(54, Math.min(window.innerHeight - 260, rect.bottom + 8)) + 'px';

  find('#inline-ai-replace-btn').onclick = () => {
    if (!inlineAiSelectionRange) return;
    const replacement = previewInput.value;
    const { from, to } = inlineAiSelectionRange;
    hideInlineAiPopover();
    hideSelectionTools();
    changeDocument({ from, to, insert: replacement }, 'command');
    selection = { from: from + replacement.length, to: from + replacement.length };
    richEditor.flush();
    toast(`已应用「${actionMeta.label}」替换选区（可按 Ctrl+Z 撤销）`);
  };
  find('#inline-ai-insert-below-btn').onclick = () => {
    if (!inlineAiSelectionRange) return;
    const addition = '\n\n' + previewInput.value;
    const { to } = inlineAiSelectionRange;
    hideInlineAiPopover();
    hideSelectionTools();
    changeDocument({ from: to, to, insert: addition }, 'command');
    selection = { from: to + addition.length, to: to + addition.length };
    richEditor.flush();
    toast(`已将「${actionMeta.label}」结果插入到选区下方`);
  };
  find('#inline-ai-cancel-btn').onclick = () => {
    hideInlineAiPopover();
  };
}

function hideSelectionTools() {
  clearTimeout(window.selectionTimer);
  const toolbar = find('#selection-tools');
  if (toolbar) toolbar.hidden = true;
}

function isMarkdownEditorStageActive() {
  const stage = find('#editor-stage');
  const pluginStage = find('#plugin-stage');
  if (!stage || stage.hidden || (pluginStage && !pluginStage.hidden) || workbench?.activeTarget || find('dialog[open]')) return false;
  return true;
}

function showSelectionToolsFromMouse() {
  clearTimeout(window.selectionTimer);
  window.selectionTimer = setTimeout(() => {
    const toolbar = find('#selection-tools');
    if (!toolbar) return;
    if (!isMarkdownEditorStageActive() || document.activeElement?.closest('.search-panel')) {
      toolbar.hidden = true;
      return;
    }
    const selectedText = documentSession.source.slice(selection.from, selection.to);
    if (selection.from >= selection.to || !selectedText.trim()) {
      toolbar.hidden = true;
      return;
    }
    const hasEditorFocus = Boolean(sourceEditor.view.hasFocus || richEditor.view.hasFocus());
    if (!hasEditorFocus) {
      toolbar.hidden = true;
      return;
    }
    try {
      const anchor = activePane === 'source' ? sourceEditor.anchor : richEditor.anchor;
      if (!anchor || (anchor.top === 0 && anchor.left === 0)) {
        toolbar.hidden = true;
        return;
      }
      toolbar.hidden = false;
      const width = toolbar.offsetWidth || 220;
      toolbar.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left - 30)) + 'px';
      toolbar.style.top = Math.max(72, anchor.top - 52) + 'px';
    } catch {
      toolbar.hidden = true;
    }
  }, 60);
}

function setSelection(from, to) {
  selection = { from: Math.max(0, Math.min(from, to)), to: Math.min(documentSession.source.length, Math.max(from, to)) };
  updateStatus();
  updateWikiAutocomplete();
  requestAnimationFrame(() => phaseTwo?.updateSlash());
  if (selection.from >= selection.to || !isMarkdownEditorStageActive()) {
    hideSelectionTools();
  }
  const table = isMarkdownEditorStageActive() ? document.getSelection()?.anchorNode?.parentElement?.closest('table') : null;
  find('#table-tools').hidden = !(activePane === 'rich' && table);
}

function paint(color) {
  if (!documentSession.paint(selection.from, selection.to, color, settings.opacity)) return;
  sourceEditor.refresh();
  richEditor.refresh();
  changed();
  find('#selection-tools').hidden = true;
}

function updateNavigation() {
  const outline = find('#outline');
  outline.replaceChildren();
  const headings = outlineOf(richEditor.parsed);
  outlineEntries = headings;
  outlineItems = [];
  outlineModel = richEditor.parsed;
  activeOutlineItem = null;
  for (const [index, heading] of headings.entries()) {
    const item = document.createElement('button');
    item.textContent = heading.text || '未命名标题';
    item.className = 'outline-item';
    item.dataset.outlineFrom = String(heading.from);
    item.style.paddingLeft = 15 + Math.min(heading.level - 1, 3) * 13 + 'px';
    item.title = heading.text;
    const intent = headingIntent(headings, index);
    item.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      richEditor.navigateHeading(intent);
    });
    item.addEventListener('click', event => { if (event.detail === 0) richEditor.navigateHeading(intent); });
    outline.appendChild(item);
    outlineItems.push(item);
  }
  scheduleOutlineFollow();
}

function scheduleOutlineFollow() {
  if (outlineFollowFrame !== null || navigationTab !== 'outline' || !settings.sidebar || settings.focus) return;
  outlineFollowFrame = requestAnimationFrame(() => { outlineFollowFrame = null; followOutline(); });
}

function followOutline() {
  if (navigationTab !== 'outline' || !settings.sidebar || settings.focus || workspaceBusy || !outlineEntries.length || outlineModel !== richEditor.parsed) return;
  const pane = settings.rich ? 'rich' : settings.source ? 'source' : null;
  if (!pane) return;
  const container = pane === 'rich' ? richEditor.container : sourceEditor.view.scrollDOM;
  if (!container.clientHeight || !find('#outline').clientHeight) return;
  let position = 0;
  if (scrollSync?.navigating && scrollSync.anchor) position = scrollSync.anchor.text ?? scrollSync.anchor.from ?? 0;
  else if (pane === 'source') position = sourceEditor.topPosition;
  else {
    const range = richEditor.parsed.ranges[scrollSync.richIndex(container.getBoundingClientRect().top + 32)];
    if (!range) return;
    position = range.from;
  }
  let left = 0;
  let right = outlineEntries.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (outlineEntries[middle].from <= position) left = middle;
    else right = middle - 1;
  }
  const item = outlineItems[left];
  if (!item) return;
  if (activeOutlineItem !== item) {
    activeOutlineItem?.removeAttribute('aria-current');
    activeOutlineItem = item;
    item.setAttribute('aria-current', 'location');
  }
}

function reveal(from, to = from) {
  readingRestoreRequest++;
  if (readingTracker) { readingTracker.suspended = false; readingTracker.intent(); }
  richEditor.flush();
  if (settings.source) sourceEditor.reveal(from, to, false);
  if (settings.rich) richEditor.reveal(from, to, true, false);
  scrollSync?.navigate(from);
  readingTracker?.moved();
  scheduleOutlineFollow();
}

function synchronizeScroll(pane) {
  scrollSync?.scroll(pane);
  readingTracker?.moved();
  if (pane === 'rich' || !settings.rich) scheduleOutlineFollow();
}

function sidebarVisible(side) {
  if (settings.focus) return false;
  return compactViewport.matches ? compactSidebar === side : Boolean(settings[side === 'left' ? 'sidebar' : 'contextSidebar']);
}

function toggleSidebar(side, visible = !sidebarVisible(side)) {
  if (visible) settings.focus = false;
  if (compactViewport.matches) compactSidebar = visible ? side : '';
  else settings[side === 'left' ? 'sidebar' : 'contextSidebar'] = visible;
  applySettings(!compactViewport.matches);
  if (side === 'right' && visible) renderRightContextPanel();
}

compactViewport.addEventListener('change', () => { compactSidebar = ''; applySettings(false); if (sidebarVisible('right')) renderRightContextPanel(); });

function applySidebarWidths() {
  const app = find('#app');
  const leftWidth = Math.max(200, Math.min(520, Number(settings.navigationWidth) || 260));
  const rightWidth = Math.max(220, Math.min(480, Number(settings.contextWidth) || 272));
  const available = Math.max(440, find('.app-body').clientWidth - 360);
  const ratio = !compactViewport.matches && sidebarVisible('left') && sidebarVisible('right')
    ? Math.min(1, available / (leftWidth + rightWidth)) : 1;
  app.style.setProperty('--sidebar-width', Math.round(leftWidth * ratio) + 'px');
  app.style.setProperty('--context-sidebar-width', Math.round(rightWidth * ratio) + 'px');
  for (const [id, width, minimum, maximum] of [['sidebar-resizer', leftWidth, 200, 520], ['context-sidebar-resizer', rightWidth, 220, 480]]) {
    const handle = find('#' + id);
    handle.setAttribute('aria-valuemin', String(minimum));
    handle.setAttribute('aria-valuemax', String(maximum));
    handle.setAttribute('aria-valuenow', String(width));
  }
}

for (const [id, setting, defaultWidth, minimum, maximum] of [
  ['sidebar-resizer', 'navigationWidth', 260, 200, 520],
  ['context-sidebar-resizer', 'contextWidth', 272, 220, 480],
]) {
  const handle = find('#' + id);
  let drag = null;
  const setWidth = width => {
    settings[setting] = Math.round(Math.max(minimum, Math.min(maximum, width)));
    applySidebarWidths();
  };
  const persist = () => call('settings', settings).catch(showError);
  handle.title = '拖动调整宽度；双击恢复默认；方向键微调';
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || compactViewport.matches) return;
    event.preventDefault();
    const panel = handle.parentElement.getBoundingClientRect();
    const center = find('.main-area').getBoundingClientRect();
    drag = { x: event.clientX, width: panel.width, direction: panel.left < center.left ? 1 : -1 };
    try { handle.setPointerCapture(event.pointerId); } catch {}
    document.body.classList.add('resizing-sidebar');
  });
  window.addEventListener('pointermove', event => {
    if (drag) setWidth(drag.width + (event.clientX - drag.x) * drag.direction);
  });
  window.addEventListener('pointerup', event => {
    if (!drag) return;
    drag = null;
    try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch {}
    document.body.classList.remove('resizing-sidebar');
    void persist();
  });
  handle.addEventListener('lostpointercapture', () => { drag = null; document.body.classList.remove('resizing-sidebar'); });
  handle.addEventListener('dblclick', () => { setWidth(defaultWidth); void persist(); });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const panel = handle.parentElement.getBoundingClientRect();
    const direction = panel.left < find('.main-area').getBoundingClientRect().left ? 1 : -1;
    setWidth(event.key === 'Home' ? defaultWidth : panel.width + (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 40 : 10));
    void persist();
  });
}
window.addEventListener('resize', applySidebarWidths);

function applySettings(persist = true) {
  if (!interfaceThemes[settings.interfaceTheme]) settings.interfaceTheme = 'neutral';
  const shell = interfaceThemes[settings.interfaceTheme];
  document.documentElement.dataset.interfaceTheme = settings.interfaceTheme;
  document.documentElement.dataset.uiMode = shell.family === 'dark' ? 'dark' : 'light';
  for (const token of ['base', 'secondary', 'ink', 'muted', 'accent']) {
    document.documentElement.style.setProperty('--ui-' + token, shell[token]);
  }
  find('#interface-family-input').value = shell.family;
  for (const option of document.querySelectorAll('[data-interface-theme]')) {
    if (option === document.documentElement) continue;
    option.setAttribute('aria-pressed', String(option.dataset.interfaceTheme === settings.interfaceTheme));
    option.hidden = interfaceThemes[option.dataset.interfaceTheme].family !== shell.family;
  }
  const sourceBackground = themes[settings.leftTheme] || themes.gray;
  const readingBackground = themes[settings.rightTheme] || themes.gray;
  find('#diagram-viewport').dataset.paperMode = readingBackground.family === 'dark' ? 'dark' : 'light';
  find('#diagram-viewport').style.backgroundColor = readingBackground.value;
  for (const [selector, theme] of [['.source-pane', sourceBackground], ['.rich-pane', readingBackground]]) {
    const pane = find(selector);
    pane.dataset.paperMode = theme.family === 'dark' ? 'dark' : 'light';
    for (const [token, value] of Object.entries({ bg: theme.value, ink: theme.ink || '#1b1f25', muted: theme.muted || '#555d68', accent: theme.accent || '#2b313a' })) {
      pane.style.setProperty('--pane-' + token, value);
    }
  }
  find('#source-family-input').value = sourceBackground.family;
  find('#reader-family-input').value = readingBackground.family;
  document.documentElement.style.setProperty('--source-bg', sourceBackground.value);
  document.documentElement.style.setProperty('--reader-bg', readingBackground.value);
  document.documentElement.style.setProperty('--reading-size', Math.max(14, Math.min(24, settings.fontSize)) + 'px');
  document.documentElement.style.setProperty('--reading-font', readingFonts[settings.readingFont] || readingFonts.book);
  document.documentElement.style.setProperty('--reading-line-height', Math.max(1.6, Math.min(2.6, Number(settings.lineHeight) || 2.05)));
  document.documentElement.style.setProperty('--reading-paragraph-gap', Math.max(0.5, Math.min(1.6, Number(settings.paragraphGap) || 1)) + 'em');
  document.documentElement.style.setProperty('--reading-width', Math.max(520, Math.min(960, Number(settings.readingWidth) || 740)) + 'px');
  find('.source-pane').dataset.paper = String(sourceBackground.paper && settings.paperTexture !== false);
  find('.rich-pane').dataset.paper = String(readingBackground.paper && settings.paperTexture !== false);
  document.body.classList.toggle('hide-sidebar', !sidebarVisible('left'));
  document.body.classList.toggle('hide-context-sidebar', !sidebarVisible('right'));
  find('#sidebar-toggle').setAttribute('aria-expanded', String(sidebarVisible('left')));
  find('#context-sidebar-toggle').setAttribute('aria-expanded', String(sidebarVisible('right')));
  find('#formatting-toolbar').hidden = !settings.formattingToolbar;
  find('[data-action="formatting-toolbar"]').setAttribute('aria-expanded', String(Boolean(settings.formattingToolbar)));
  find('#backlinks-drawer').dataset.enabled = String(settings.showBacklinksFooter === true);
  find('#context-sidebar-toggle').classList.toggle('active', sidebarVisible('right'));
  find('.app-body').dataset.outlineSide = settings.outlineSide === 'right' ? 'right' : 'left';
  find('#outline-side-input').value = settings.outlineSide === 'right' ? 'right' : 'left';
  document.body.classList.toggle('focus-mode', settings.focus);
  find('.source-pane').hidden = !settings.source;
  find('.rich-pane').hidden = !settings.rich;
  find('#splitter').hidden = !(settings.source && settings.rich);
  find('#workspace').classList.toggle('one-pane', !(settings.source && settings.rich));
  find('#empty-workspace').hidden = settings.source || settings.rich;
  for (const actionName of ['source', 'rich', 'focus', 'typewriter']) {
    for (const target of document.querySelectorAll('[data-action="' + actionName + '"]')) {
      target.classList.toggle('active', settings[actionName]);
      target.setAttribute('aria-pressed', String(settings[actionName]));
      if (target.getAttribute('role') === 'menuitemcheckbox') target.setAttribute('aria-checked', String(settings[actionName]));
    }
  }
  for (const target of document.querySelectorAll('[data-theme]')) {
    const active = settings[target.dataset.themeSide] === target.dataset.theme;
    const selectedTheme = themes[settings[target.dataset.themeSide]] || themes.white;
    target.hidden = themes[target.dataset.theme].family !== selectedTheme.family;
    target.classList.toggle('active', active);
    target.setAttribute('aria-pressed', String(active));
  }
  find('#font-input').value = settings.fontSize;
  find('#font-output').textContent = settings.fontSize + ' px';
  find('#font-size').textContent = settings.fontSize;
  find('#reading-font-input').value = settings.readingFont;
  find('#line-height-input').value = settings.lineHeight;
  find('#line-height-output').textContent = Number(settings.lineHeight).toFixed(2) + ' 倍';
  find('#paragraph-gap-input').value = settings.paragraphGap;
  find('#paragraph-gap-output').textContent = Number(settings.paragraphGap).toFixed(1) + ' 倍';
  find('#reading-width-input').value = settings.readingWidth;
  find('#reading-width-output').textContent = settings.readingWidth + ' px';
  find('#paper-input').checked = settings.paperTexture !== false;
  find('#opacity-input').value = settings.opacity * 100;
  find('#opacity-output').textContent = Math.round(settings.opacity * 100) + '%';
  find('#sync-input').checked = settings.syncScroll;
  find('#restore-reading-input').checked = settings.restoreReadingPosition === true;
  find('#search-results-input').checked = settings.searchResults === true;
  find('#ctrl-wheel-input').checked = settings.ctrlWheelZoom !== false;
  find('#compress-input').checked = settings.compress;
  find('#embed-images-input').checked = settings.embedImages === true;
  const palette = codePalette(codeColorScope, settings.codeColors || {});
  for (const input of document.querySelectorAll('[data-code-color]')) input.value = palette[input.dataset.codeColor];
  appearance?.apply();
  applySidebarWidths();
  sourceEditor.refresh();
  richEditor.refresh();
  workbench?.appearanceChanged({ mode: appearance?.mode() || document.documentElement.dataset.uiMode });
  renderSearchResults();
  scrollSync?.refresh();
  scheduleOutlineFollow();
  if (persist) call('settings', settings).catch(showError);
  phaseTwo?.refresh();
  workbench?.refresh();
}

function findWorkspaceNote(note) {
  return [...workspace.entries.values()].find(entry => entry.id === note.id || entry.info.path?.toLowerCase() === note.path?.toLowerCase());
}

async function updateNoteProperties(noteId, patch) {
  const note = vaultGraph.nodeMap.get(noteId);
  if (!note?.exists) throw new Error('目标笔记不存在。');
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush();
  const entry = findWorkspaceNote(note);
  if (entry && entry.id !== recoveryDocumentId && (entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty)) throw new Error('该笔记有未保存修改，请打开并保存后再更新状态。');
  if (entry?.id === recoveryDocumentId) {
    const next = updateFrontMatterProperties(documentSession.source, patch);
    changeDocument(minimalChange(documentSession.source, next), 'command');
    richEditor.flush();
    if (!await save()) throw new Error('属性尚未保存，当前编辑内容已保留。');
    return;
  }
  const expectedSource = note.source;
  const next = updateFrontMatterProperties(expectedSource, patch);
  vaultMutationBusy = true;
  try {
    const result = await call('updateVaultNoteSource', { noteId: note.id, path: note.path, relativePath: note.relativePath, expectedSource, source: next });
    if (result.vault) vaultState = result.vault;
    else vaultState.notes.find(item => item.id === note.id).source = next;
    if (entry?.state) {
      entry.state.session.replace(minimalChange(entry.state.session.source, next));
      entry.state.savedRevision = entry.state.session.revision; entry.state.info.hash = result.hash;
      entry.dirty = false; entry.rendered = null;
    } else if (entry) { entry.stored = false; entry.rendered = null; }
    rebuildVaultGraph();
    toast(desktop ? '属性已保存到 Markdown' : '属性已保存到浏览器副本');
  } finally { vaultMutationBusy = false; }
}

async function updatePluginProperties(noteId, version, patch) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作');
  richEditor.flush();
  const note = vaultGraph.nodeMap.get(noteId); if (!note?.exists) throw new Error('笔记已不存在');
  const entry = findWorkspaceNote(note);
  const modified = () => entry && (entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty);
  if (modified()) throw new Error('笔记有未保存修改，请先保存后再更新状态');
  const source = note.source; const actual = await digest(source);
  if (actual !== version || note.source !== source || modified()) throw new Error('笔记版本已变化，请刷新视图后重试');
  await updateNoteProperties(noteId, patch);
  await rebuildVaultGraph();
  const saved = vaultState.notes.find(item => item.id === noteId);
  return { id: noteId, version: await digest(saved?.source || ''), saved: true };
}

async function writePluginNote(noteId, version, source) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作');
  richEditor.flush(); captureDocumentState();
  const note = vaultState.notes.find(note => note.id === noteId); if (!note) throw new Error('笔记不存在');
  const entry = findWorkspaceNote(note);
  const modified = () => entry && (entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty);
  const expectedSource = note.source;
  if (modified() || await digest(expectedSource) !== version || note.source !== expectedSource || modified()) throw new Error('笔记版本已变化或含未保存修改');
  vaultMutationBusy = true; find('#workspace').inert = true;
  try {
    if (entry?.id === recoveryDocumentId) {
      changeDocument(minimalChange(documentSession.source, source), 'command'); richEditor.flush();
      if (!await save()) throw new Error('笔记尚未保存，编辑内容已保留');
    } else {
      const result = await call('updateVaultNoteSource', { noteId, path: note.path, relativePath: note.relativePath, expectedSource, source });
      if (result.vault) vaultState = result.vault;
      if (entry?.state) { entry.state.session.replace(minimalChange(entry.state.session.source, source)); entry.state.savedRevision = entry.state.session.revision; entry.state.info.hash = result.hash; entry.dirty = false; entry.rendered = null; }
      else if (entry) { entry.stored = false; entry.rendered = null; }
    }
    await rebuildVaultGraph(); return { id: noteId, version: await digest(vaultState.notes.find(note => note.id === noteId)?.source ?? source), saved: true };
  } finally { vaultMutationBusy = false; find('#workspace').inert = closingWorkspace; }
}

async function createPluginNote(title, options = {}) {
  if (!options.background && !options.overwrite) return createAndOpenVaultNote(title, options.folder || '', options.source || '');
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前操作');
  vaultMutationBusy = true;
  let result;
  try {
    const exclusive = options.overwrite ? false : (options.exclusive ?? true);
    result = await call('createVaultNote', { title, ...options, background: true, exclusive, overwrite: Boolean(options.overwrite) });
    if (!result?.note || !result.vault) throw new Error('未收到已保存的笔记结果');
    vaultState = result.vault; await rebuildVaultGraph();
  } finally { vaultMutationBusy = false; }
  if (!options.background && result?.note?.id) {
    await openVaultNoteById(result.note.id);
  }
  return result.note;
}

async function createVaultFolderAndReveal(folderPath = '') {
  const cleaned = String(folderPath || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('目录名称无效，不能包含 . 或 .. 路径段');
  }
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  vaultMutationBusy = true;
  try {
    const res = await call('createVaultFolder', { folder: cleaned });
    if (res?.vault) vaultState = res.vault;
    const vaultKey = vaultState.vaultId || vaultState.vaultPath;
    const collapsed = new Set(settings.vaultTreeCollapsed?.[vaultKey] || []);
    const parts = cleaned.split('/');
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      collapsed.delete(prefix);
    }
    settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: [...collapsed] };
    void call('settings', settings).catch(showError);
    sidebarSignature = '';
    await rebuildVaultGraph();
    renderVaultSidebar();
    toast(`已创建目录：${res?.folder || cleaned}`);
    return res?.folder || cleaned;
  } finally {
    vaultMutationBusy = false;
  }
}

async function revealVaultItemInExplorer({ path = '', relativePath = '', isFolder = false } = {}) {
  const res = await call('revealVaultItem', { path, relativePath, isFolder });
  const targetLabel = relativePath || (isFolder ? (vaultState.vaultName || '知识库根目录') : (documentInfo.name || '当前笔记'));
  toast(desktop ? `已在本地文件夹中定位：${targetLabel}` : `已定位知识库路径：${res?.fullPath || targetLabel}`);
  return res;
}

async function executeVaultDeletePlan(plan) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush(); captureDocumentState();
  const deletedSet = new Set((plan.deletedNotes || []).map(n => n.noteId));
  for (const entry of workspace.entries.values()) {
    const isDirty = entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty;
    if (isDirty && !deletedSet.has(entry.id) && !deletedSet.has(entry.info?.noteId)) {
      throw new Error('其他已打开笔记仍有未保存修改，请先保存后再执行删除。');
    }
  }
  vaultMutationBusy = true; find('#workspace').inert = true;
  let result;
  try {
    await recoveryWriter?.flush();
    clearTimeout(statusTimer);
    if (deletedSet.has(activeNoteIdentity) || deletedSet.has(recoveryDocumentId)) {
      savedRevision = documentSession.revision;
      if (workspace.active) workspace.active.dirty = false;
      await call('state', { name: documentInfo.name, dirty: false }).catch(() => {});
    }
    result = await call('deleteVaultItems', plan);
    if (!result?.vault) throw new Error('删除操作未返回更新后的知识库状态。');
    recoveryWriter?.reset();
    const invalidated = new Set([
      ...(result.invalidatedIds || []),
      ...deletedSet,
      ...(plan.updates || []).map(u => u.noteId),
    ]);
    for (const id of invalidated) workspace.remove(id);
    for (const entry of [...workspace.entries.values()]) {
      if (deletedSet.has(entry.info?.noteId)) workspace.remove(entry.id);
    }
    recoveryDocumentId = null; selectDocument(null);
    documentSession = new DocumentSession(); savedRevision = 0;
    documentInfo = { name: '', path: null, hash: null };
    vaultState = result.vault;
  } finally {
    vaultMutationBusy = false; find('#workspace').inert = false;
  }
  if (result?.document) {
    await addOpenedDocuments({ documents: [result.document] }, false, true);
  }
  sidebarSignature = '';
  await rebuildVaultGraph();
  renderVaultSidebar();
  renderTopDewdropTabs();
  toast(`已删除 ${plan.deletedNotes.length} 篇笔记${plan.cleanedReferenceCount ? `，并同步清理 ${plan.cleanedReferenceCount} 处引用` : ''}`);
  return result;
}

async function renameNote(noteId, newTitle, updateLinks) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush(); captureDocumentState();
  if ([...workspace.entries.values()].some(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty)) throw new Error('请先保存所有涉及的笔记，再执行重命名；当前修改未丢弃。');
  const plan = planVaultRename(vaultState.notes, noteId, newTitle, updateLinks);
  const previous = { name: documentInfo.name, path: documentInfo.path };
  vaultMutationBusy = true; find('#workspace').inert = true;
  let result;
  try {
    await recoveryWriter?.flush();
    clearTimeout(statusTimer);
    result = await call('renameVaultNote', plan);
    if (!result?.vault || !result.document) throw new Error('重命名未返回已保存结果。');
    recoveryWriter?.reset();
    const invalidated = new Set(result.invalidatedIds || plan.updates.map(update => update.noteId));
    for (const id of invalidated) workspace.remove(id);
    recoveryDocumentId = null; selectDocument(null);
    documentSession = new DocumentSession(); savedRevision = 0;
    documentInfo = { name: '', path: null, hash: null };
    vaultState = result.vault;
  } finally { vaultMutationBusy = false; find('#workspace').inert = false; }
  if (!await addOpenedDocuments({ documents: [result.document] })) throw new Error('文件已重命名，但重新打开未完成，请从知识库打开。');
  toast('已重命名 ' + previous.name + '，更新 ' + (result.rewrittenLinks ?? plan.rewrittenLinks) + ' 处双链');
}

async function moveNoteToFolder(noteId, targetFolder) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush(); captureDocumentState();
  if ([...workspace.entries.values()].some(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty)) {
    throw new Error('请先保存所有涉及的笔记，再执行移动；当前修改未丢弃。');
  }
  const plan = planVaultMove(vaultState.notes, noteId, targetFolder, true);
  vaultMutationBusy = true; find('#workspace').inert = true;
  let result;
  try {
    await recoveryWriter?.flush();
    clearTimeout(statusTimer);
    result = await call('moveVaultNote', plan);
    if (!result?.vault || !result.document) throw new Error('移动操作未返回已保存结果。');
    recoveryWriter?.reset();
    const invalidated = new Set(result.invalidatedIds || plan.updates.map(update => update.noteId));
    for (const id of invalidated) workspace.remove(id);
    recoveryDocumentId = null; selectDocument(null);
    documentSession = new DocumentSession(); savedRevision = 0;
    documentInfo = { name: '', path: null, hash: null };
    vaultState = result.vault;
    const vaultKey = vaultState.vaultId || vaultState.vaultPath;
    const collapsed = new Set(settings.vaultTreeCollapsed?.[vaultKey] || []);
    const parts = String(plan.targetFolder || '').split('/').filter(Boolean);
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      collapsed.delete(prefix);
    }
    settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: [...collapsed] };
    void call('settings', settings).catch(showError);
  } finally {
    vaultMutationBusy = false; find('#workspace').inert = false;
  }
  if (!await addOpenedDocuments({ documents: [result.document] })) throw new Error('笔记已移动，但重新打开未完成，请从知识库打开。');
  sidebarSignature = '';
  await rebuildVaultGraph();
  renderVaultSidebar();
  toast(`已移动至「${plan.targetFolder || '/'}」${plan.rewrittenLinks ? `，并同步更新 ${plan.rewrittenLinks} 处路径双链` : ''}`);
  return result;
}

async function batchUpdateVaultNotes(noteIds = [], { addTag = '', removeTag = '', status = '' } = {}) {
  const ids = [...new Set(noteIds)].filter(Boolean);
  if (!ids.length) return;
  for (const id of ids) {
    const note = vaultGraph?.nodeMap.get(id);
    if (!note?.exists) continue;
    const patch = {};
    if (addTag || removeTag) {
      patch.tags = computeBatchTagPatch(note.tags || [], { addTag, removeTag });
    }
    if (status) {
      patch.status = status;
    }
    if (Object.keys(patch).length) {
      await updateNoteProperties(id, patch);
    }
  }
  await rebuildVaultGraph();
  sidebarSignature = '';
  renderVaultSidebar();
  toast(`已对 ${ids.length} 篇笔记完成批量属性更新`);
}

async function batchMoveVaultNotesToFolder(noteIds = [], targetFolder = '') {
  const ids = [...new Set(noteIds)].filter(Boolean);
  if (!ids.length) return;
  let totalRewritten = 0;
  for (const id of ids) {
    const note = vaultState.notes.find(n => n.id === id);
    if (!note) continue;
    const currentFolder = note.relativePath.includes('/') ? note.relativePath.split('/').slice(0, -1).join('/') : '';
    const cleanTarget = String(targetFolder || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (currentFolder.toLowerCase() === cleanTarget.toLowerCase()) continue;
    const res = await moveNoteToFolder(id, cleanTarget);
    totalRewritten += Number(res?.rewrittenLinks || 0);
  }
  toast(`已批量移动 ${ids.length} 篇笔记至「${targetFolder || '/'}」${totalRewritten ? `，并更新 ${totalRewritten} 处路径双链` : ''}`);
}
window.__inkloomBatchMoveNotesToFolder = (noteIds, targetFolder) => batchMoveVaultNotesToFolder(noteIds, targetFolder);

async function moveFolderToTarget({
  sourceFolder = '',
  targetParentFolder = '',
  newFolderName = '',
  targetFolderPath = '',
} = {}) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush(); captureDocumentState();
  if ([...workspace.entries.values()].some(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty)) {
    throw new Error('请先保存所有未保存笔记，再执行目录重命名或移动；当前修改未丢弃。');
  }
  const plan = planVaultFolderMove(vaultState.notes, {
    sourceFolder,
    targetParentFolder,
    newFolderName,
    targetFolderPath,
    knownFolders: vaultState.folders || [],
    autoUpdateLinks: true,
  });
  vaultMutationBusy = true; find('#workspace').inert = true;
  let result;
  try {
    await recoveryWriter?.flush();
    clearTimeout(statusTimer);
    result = await call('moveVaultFolder', plan);
    if (!result?.vault) throw new Error('目录移动未返回已保存结果。');
    recoveryWriter?.reset();
    const invalidated = new Set(result.invalidatedIds || [
      ...plan.movedNotes.map(m => m.noteId),
      ...plan.updates.map(u => u.noteId),
    ]);
    for (const id of invalidated) workspace.remove(id);
    if (result.document) {
      recoveryDocumentId = null; selectDocument(null);
      documentSession = new DocumentSession(); savedRevision = 0;
      documentInfo = { name: '', path: null, hash: null };
    }
    vaultState = result.vault;
    const vaultKey = vaultState.vaultId || vaultState.vaultPath;
    const srcLower = plan.sourceFolder.toLowerCase();
    const nextCollapsed = new Set();
    for (const c of (settings.vaultTreeCollapsed?.[vaultKey] || [])) {
      const cl = String(c || '').toLowerCase();
      if (cl === srcLower) continue;
      if (cl.startsWith(srcLower + '/')) {
        nextCollapsed.add(`${plan.newFolderPath}/${c.slice(plan.sourceFolder.length + 1)}`);
      } else {
        nextCollapsed.add(c);
      }
    }
    const parts = String(plan.newFolderPath || '').split('/').filter(Boolean);
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      nextCollapsed.delete(prefix);
    }
    settings.vaultTreeCollapsed = { ...settings.vaultTreeCollapsed, [vaultKey]: [...nextCollapsed] };
    void call('settings', settings).catch(showError);
  } finally {
    vaultMutationBusy = false; find('#workspace').inert = false;
  }
  if (result?.document) {
    await addOpenedDocuments({ documents: [result.document] }, false, true);
  }
  sidebarSignature = '';
  await rebuildVaultGraph();
  renderVaultSidebar();
  toast(`已将目录「${plan.sourceFolder}」更新为「${plan.newFolderPath}」（移动 ${plan.movedNotes.length} 篇笔记${plan.rewrittenLinks ? ` · 更新 ${plan.rewrittenLinks} 处路径双链` : ''}）`);
  return result;
}

function requireCleanWorkspace() {
  richEditor.flush(); captureDocumentState();
  if ([...workspace.entries.values()].some(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty)) throw new Error('有未保存笔记，请先保存或关闭后操作。');
}

async function adoptVaultWorkspace(result) {
  const ids = result.invalidatedIds || [...workspace.entries.keys()];
  workspace.activeId = null; recoveryDocumentId = null; activeNoteIdentity = null; documentInfo = { name: '', path: null, hash: null };
  selectDocument(null); recoveryWriter?.reset(); clearTimeout(statusTimer); clearTimeout(outlineTimer);
  for (const id of ids) workspace.remove(id);
  documentSession = new DocumentSession(); savedRevision = 0; vaultState = result.vault;
  if (result.openingWarning) vaultState.warnings = [...(vaultState.warnings || []), result.openingWarning];
  vaultIndex.dispose(); vaultGraph = null; sidebarSignature = ''; workbench?.closeView();
  sourceEditor.setText(''); richEditor.load('', richEditor.parsed);
  if (result.document && !await addOpenedDocuments({ documents: [result.document] }, false, true)) throw new Error('知识库已切换，但文档打开失败，请从导航重新打开。');
  await rebuildVaultGraph(); showVaultWarnings();
}

async function openManagedVault(path) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  requireCleanWorkspace(); vaultMutationBusy = true; find('#workspace').inert = true;
  try {
    await readingTracker.flush().catch(() => {}); await recoveryWriter?.flush(); requireCleanWorkspace();
    const result = await call('openVault', path ? { path } : {}); if (!result) return false;
    if (result.vault) await adoptVaultWorkspace(result);
    else {
      const ids = [...workspace.entries.keys()]; await call('closeDocuments', { ids, discard: false });
      const first = result.notes[0]; const opened = first ? await call('openVaultNote', { noteId: first.id, path: first.path, relativePath: first.relativePath }) : { documents: [await call('new')] };
      await adoptVaultWorkspace({ vault: result, document: opened.documents[0], invalidatedIds: ids });
    }
    toast(`已加载知识库：${vaultState.vaultName}`); return true;
  } finally { vaultMutationBusy = false; find('#workspace').inert = closingWorkspace; }
}

async function restoreManagedRecovery(id, token) {
  if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作。');
  requireCleanWorkspace(); vaultMutationBusy = true; find('#workspace').inert = true;
  try { await readingTracker.flush().catch(() => {}); await recoveryWriter?.flush(); requireCleanWorkspace(); const result = await call('restoreVaultRecovery', { id, token }); await adoptVaultWorkspace(result); toast('已恢复改名前版本，备份保留'); }
  finally { vaultMutationBusy = false; find('#workspace').inert = closingWorkspace; }
}

async function save(saveAs = false) {
  if (saving) return false;
  if (!saveAs && workspace.active?.externalConflict) { showError(new Error('磁盘版本已变化，未覆盖。请使用“另存为”保留当前内容后再核对。')); return false; }
  saving = true;
  updateStatus();
  let revision = documentSession.revision;
  const previousInert = find('#workspace').inert;
  try {
    await readingTracker.flush().catch(() => {});
    await recoveryWriter?.flush().catch(() => {});
    richEditor.flush();
    if (settings.smartWikiLinkMode === 'auto' && vaultGraph && vaultGraph.nodeMap.get(activeNoteIdentity)?.metadata?.category !== 'whiteboard') {
      const autoCandidates = discoverSmartWikiLinks(
        vaultGraph.notes || [],
        { id: activeNoteIdentity, title: documentInfo.name, source: documentSession.source },
        { engine: settings.smartWikiLinkEngine || 'offline-cosine', minScore: 0.45, llmConfirmedTargets: smartWikiLinkLlmConfirmed },
      );
      const autoApplied = applySmartWikiLinks(documentSession.source, autoCandidates, { minScore: 0.45 });
      if (autoApplied.appliedCount > 0) {
        changeDocument(minimalChange(documentSession.source, autoApplied.source), 'command');
        richEditor.flush();
      }
    }
    revision = documentSession.revision;
    const savingSession = documentSession;
    let text = documentSession.source;
    let annotations = annotationPayload();
    let prepared;
    let relocated;
    const resources = [];
    richEditor.parsed.doc.descendants(node => { if (node.type.name === 'image' && !isImagePlaceholder(node.attrs.src)) resources.push(node.attrs.src); });
    if (settings.embedImages) {
      embeddingSave = true; find('#workspace').inert = true;
      const { embedDocumentImages } = await import('../../vendor/inklet/app/src/embedded-images.js');
      const { prepareEmbeddedAsset } = await import('../../vendor/inklet/app/src/export-document.js');
      prepared = await embedDocumentImages(text, { readAsset: path => call('readAsset', { path }), convertAsset: prepareEmbeddedAsset, allowMissingImages: true });
      if (prepared.issues.length) {
        const dialog = find('#save-images-dialog'); const list = find('#save-image-issues'); list.replaceChildren();
        for (const issue of prepared.issues) { const item = document.createElement('li'); item.textContent = issue.displayPath + '；' + issue.message; list.append(item); }
        dialog.returnValue = '';
        const confirmed = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save'), { once: true })); dialog.showModal();
        if (!await confirmed) return false;
      }
      if (documentSession !== savingSession || revision !== documentSession.revision) throw new Error('内嵌处理期间笔记已变化，未写入旧结果。');
      text = prepared.source;
      if (prepared.changes.length) {
        relocated = restoreHighlights(text, serializeHighlights(documentSession.source, documentSession.highlights)); relocated.unresolved.push(...documentSession.unresolved);
        annotations = { version: 1, marks: [...serializeHighlights(text, relocated.highlights), ...relocated.unresolved] };
      }
    }
    const result = await call('save', { text, name: documentInfo.name, hash: documentInfo.hash, annotations, resources: prepared ? [] : resources, saveAs });
    if (!result) return false;
    if (prepared?.changes.length) {
      documentSession.replaceBatch(prepared.changes, relocated); revision = documentSession.revision;
      sourceEditor.setText(documentSession.source); richEditor.load(documentSession.source);
      searchWorker.postMessage({ type: 'document', source: documentSession.source, revision });
    }
    documentInfo = { ...documentInfo, ...result };
    savedRevision = revision;
    if (workspace.active) {
      workspace.active.info = { ...workspace.active.info, ...documentInfo };
      if (workspace.active.state) workspace.active.state.info = { ...workspace.active.state.info, ...documentInfo };
      workspace.active.externalConflict = false;
    }
    clearTimeout(outlineTimer);
    syncActiveNoteIntoVault();
    await rebuildVaultGraph();
    recoveryWriter?.reset();
    toast(desktop ? '已保存到本地知识库' : '已保存到浏览器副本');
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    saving = false;
    embeddingSave = false; find('#workspace').inert = previousInert;
    updateStatus();
  }
}

function resetEditDialogFooter(submitText = '确定') {
  const discardBtn = find('#edit-discard-btn');
  if (discardBtn) {
    discardBtn.hidden = true;
    discardBtn.onclick = null;
  }
  const submitBtn = find('#edit-submit-btn') || find('#edit-dialog [type="submit"]');
  if (submitBtn) {
    submitBtn.hidden = false;
    submitBtn.textContent = submitText;
  }
}

async function discardActiveNoteChanges() {
  if (!dirty()) return false;
  richEditor.flush();
  const savedSource = noteSavedBaselineById.get(activeNoteIdentity) ?? vaultState.notes.find(n => n.id === activeNoteIdentity)?.source ?? documentSession.source;
  const before = documentSession.source;
  if (before !== savedSource) {
    documentSession.replace(minimalChange(before, savedSource));
    sourceEditor.setText(savedSource);
    richEditor.load(savedSource);
    searchWorker.postMessage({ type: 'document', source: savedSource, revision: documentSession.revision });
  }
  savedRevision = documentSession.revision;
  if (workspace.active?.state) {
    workspace.active.state.savedRevision = savedRevision;
    workspace.active.dirty = false;
  }
  recoveryWriter?.reset();
  syncActiveNoteIntoVault();
  updateStatus();
  updateNavigation();
  await rebuildVaultGraph();
  toast('已放弃未保存修改，恢复至已保存版本');
  return true;
}

async function closeActiveNoteTab() {
  if (workspaceBusy || saving || vaultMutationBusy || composing) throw new Error('请先完成当前编辑操作。');
  richEditor.flush(); captureDocumentState();
  const closingEntry = workspace.active; if (!closingEntry) return;
  const nextEntry = workspaceEntries().find(entry => entry.id !== closingEntry.id);
  const finishClose = async () => {
    if (nextEntry) { if (!await switchDocument(nextEntry.id, false, true)) throw new Error('切换笔记未完成，页签已保留。'); }
    else if (!await addOpenedDocuments({ documents: [await call('new')] })) throw new Error('新建空白页签未完成，原页签已保留。');
    await call('closeDocuments', { ids: [closingEntry.id], discard: false });
    workspace.remove(closingEntry.id); updateNavigation(); renderTopDewdropTabs();
  };
  if (!dirty()) {
    await finishClose();
    return;
  }
  const dialog = find('#edit-dialog');
  resetEditDialogFooter('保存并关闭页签');
  find('#edit-title').textContent = '关闭或还原未保存笔记';
  find('#edit-content').replaceChildren();
  const desc = document.createElement('p');
  desc.textContent = `当前笔记《${documentInfo.name}》有未保存的修改，参考 Obsidian 页签保护机制，请选择操作方式：`;
  find('#edit-content').append(desc);
  const discardBtn = find('#edit-discard-btn');
  if (discardBtn) {
    discardBtn.hidden = false;
    discardBtn.textContent = '不保存并放弃修改';
    discardBtn.onclick = async () => {
      dialog.close();
      await discardActiveNoteChanges();
      await finishClose();
    };
  }
  dialogApply = async () => {
    if (!await save()) throw new Error('保存未完成，当前页签已保留。');
    await finishClose();
  };
  dialog.showModal();
}

function collectAllKnownFolders() {
  const set = new Set();
  for (const f of vaultState.folders || []) {
    if (f && f !== '根目录' && f !== '待建节点') set.add(String(f).replaceAll('\\', '/'));
  }
  for (const entry of vaultGraph?.foldersIndex || []) {
    if (entry.folder && entry.folder !== '根目录' && entry.folder !== '待建节点') set.add(entry.folder);
  }
  for (const note of vaultGraph?.notes || []) {
    const parts = String(note.relativePath || '').split('/').slice(0, -1);
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      set.add(prefix);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

function openCodeDialog(kind, value, apply, options = {}) {
  resetEditDialogFooter('确定');
  const titles = {
    mermaid: '编辑 Mermaid 图表',
    math_block: '编辑数学公式',
    math_inline: '编辑行内公式',
    code: '插入代码块',
    link: '插入链接',
    wikilink: '插入双链笔记 [[...]]',
    newNote: '新建笔记',
    newFolder: '新建目录',
  };
  find('#edit-title').textContent = titles[kind] || '编辑';
  const isSingleLine = kind === 'newNote' || kind === 'newFolder' || kind === 'wikilink' || kind === 'link';
  const labelText = kind === 'newNote'
    ? '笔记标题（如：05-系统思考笔记）'
    : kind === 'newFolder'
      ? '目录路径（支持多级路径，如：课题研究/2026/架构设计）'
      : kind === 'wikilink'
        ? '目标笔记名称或 笔记#章节|别名'
        : kind === 'link'
          ? '链接地址'
          : '源码';
  find('#edit-content').innerHTML =
    '<label class="editor-label" for="block-input">' + labelText + '</label>' +
    (isSingleLine
      ? '<input id="block-input" type="text" class="dialog-single-input" spellcheck="false" autocomplete="off">'
      : '<textarea id="block-input" spellcheck="false" rows="10"></textarea>');
  find('#block-input').value = value;
  find('#block-input').readOnly = !apply;
  const submit = find('#edit-dialog [type="submit"]');
  if (submit) submit.hidden = !apply;
  let selectedTemplateId = '';
  if (kind === 'newNote') {
    const folderLabel = document.createElement('div');
    folderLabel.className = 'appearance-field note-folder-field';
    const folderCaption = document.createElement('label');
    folderCaption.setAttribute('for', 'new-note-folder');
    folderCaption.textContent = '目录（可直接输入新多级目录，或展开下方目录树点选）';
    const folderInput = document.createElement('input');
    folderInput.id = 'new-note-folder';
    folderInput.type = 'text';
    folderInput.placeholder = '/（根目录）';
    folderInput.autocomplete = 'off';
    folderInput.spellcheck = false;
    folderInput.value = options.defaultFolder || '';
    folderLabel.append(folderCaption, folderInput);

    const allFolders = collectAllKnownFolders();
    const pickerDrawer = document.createElement('details');
    pickerDrawer.className = 'folder-picker-drawer';
    pickerDrawer.id = 'new-note-folder-picker';
    const pickerSummary = document.createElement('summary');
    pickerSummary.textContent = `选择已有目录（共 ${allFolders.length + 1} 项）`;
    const pickerBody = document.createElement('div');
    pickerBody.className = 'folder-picker-body';
    const pickerSearch = document.createElement('input');
    pickerSearch.type = 'search';
    pickerSearch.id = 'new-note-folder-search';
    pickerSearch.placeholder = '输入关键字快速筛选目录...';
    pickerSearch.autocomplete = 'off';
    const pickerList = document.createElement('div');
    pickerList.className = 'folder-picker-list';

    const renderFolderOptions = (q = '') => {
      pickerList.replaceChildren();
      const needle = q.trim().toLowerCase();
      const candidates = ['', ...allFolders].filter(f => !needle || (f || '/ 根目录').toLowerCase().includes(needle));
      for (const f of candidates.slice(0, 80)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-picker-option' + (folderInput.value.trim() === f ? ' is-selected' : '');
        btn.dataset.pickFolder = f;
        const depth = f ? f.split('/').length - 1 : 0;
        btn.style.paddingLeft = `${8 + depth * 12}px`;
        btn.textContent = f ? `📁 ${f}` : '🏠 /（知识库根目录）';
        btn.onclick = () => {
          folderInput.value = f;
          pickerDrawer.open = false;
        };
        pickerList.append(btn);
      }
    };
    pickerSearch.oninput = () => renderFolderOptions(pickerSearch.value);
    renderFolderOptions();
    pickerBody.append(pickerSearch, pickerList);
    pickerDrawer.append(pickerSummary, pickerBody);
    folderLabel.append(pickerDrawer);
    find('#edit-content').append(folderLabel);

    const tplSection = document.createElement('div');
    tplSection.className = 'smart-template-picker';
    tplSection.id = 'smart-template-picker';
    const tplLabel = document.createElement('small');
    tplLabel.className = 'inline-property-label';
    tplLabel.textContent = '模板';
    const tplBar = document.createElement('div');
    tplBar.className = 'segmented-control ux-pill-bar';
    tplBar.id = 'smart-template-bar';
    const tplDesc = document.createElement('small');
    tplDesc.id = 'smart-template-desc';
    tplDesc.style.color = 'var(--ui-muted)';
    tplDesc.textContent = '默认空白 Markdown 笔记（含标准 YAML 头）';

    const allOptions = [{ id: '', name: '空白笔记', tone: 'slate', description: '默认空白 Markdown 笔记（含标准 YAML 头）' }, ...SMART_NOTE_TEMPLATES];
    const renderTplPills = () => {
      tplBar.replaceChildren();
      for (const opt of allOptions) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'ux-pill-option';
        pill.dataset.pillTone = opt.tone;
        pill.dataset.templateId = opt.id;
        pill.setAttribute('aria-selected', String(selectedTemplateId === opt.id));
        pill.textContent = opt.name;
        pill.onclick = () => {
          selectedTemplateId = opt.id;
          tplDesc.textContent = opt.description;
          renderTplPills();
        };
        tplBar.append(pill);
      }
    };
    renderTplPills();
    tplSection.append(tplLabel, tplBar, tplDesc);
    find('#edit-content').append(tplSection);
  }
  if (kind === 'code') {
    const label = document.createElement('label'); label.className = 'select-setting'; label.textContent = '编程语言';
    const select = document.createElement('select'); select.id = 'block-language';
    for (const [key, name] of codeLanguages) select.add(new Option(name, key));
    label.append(select); find('#edit-content').prepend(label);
  }
  dialogApply = apply ? () => apply(find('#block-input').value, kind === 'newNote' ? selectedTemplateId : (find('#block-language')?.value || 'plaintext'), kind === 'newNote' ? find('#new-note-folder').value.trim().replaceAll('\\', '/') : '') : null;
  find('#edit-dialog').showModal();
  find('#block-input').focus();
}

function openNewNoteDialog(defaultFolder = '') {
  const activeFolder = defaultFolder !== undefined && defaultFolder !== null
    ? defaultFolder
    : (() => {
        const currentFolder = vaultGraph?.nodeMap.get(activeNoteIdentity)?.folder || '';
        return currentFolder && currentFolder !== '根目录' && currentFolder !== '待建节点' ? currentFolder : '';
      })();
  openCodeDialog('newNote', '05-新思考卡片', async (title, templateId, folder) => {
    const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
    if (cleanFolder && cleanFolder.split('/').some(part => part === '..' || part === '.')) throw new Error('目录不能包含 . 或 .. 路径段');
    const customSource = templateId && templateId !== 'plaintext'
      ? renderSmartTemplate(templateId, { title }).source
      : '';
    await createAndOpenVaultNote(title, cleanFolder, customSource);
  }, { defaultFolder: activeFolder });
}

function openNewFolderDialog(parentFolder = '') {
  const cleanParent = String(parentFolder || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const initialVal = cleanParent ? `${cleanParent}/新建目录` : '新建目录';
  openCodeDialog('newFolder', initialVal, async folderPath => {
    await createVaultFolderAndReveal(folderPath);
  });
}

function openMoveNoteDialog(noteId = activeNoteIdentity) {
  const targetNote = vaultGraph?.nodeMap.get(noteId);
  if (!targetNote?.exists) throw new Error('请选择要移动的知识库笔记');
  resetEditDialogFooter('确认移动');
  find('#edit-title').textContent = '移动笔记至目录';
  const container = find('#edit-content');
  container.replaceChildren();

  const summary = document.createElement('p');
  summary.className = 'delete-dialog-summary';
  summary.textContent = `当前笔记：《${targetNote.cleanTitle || targetNote.title}》（原路径：${targetNote.relativePath}）`;
  container.append(summary);

  const folderField = document.createElement('div');
  folderField.className = 'appearance-field note-folder-field';
  const folderLabel = document.createElement('label');
  folderLabel.setAttribute('for', 'move-note-folder-input');
  folderLabel.textContent = '目标目录（留空或填 / 表示移动至根目录，支持直接输入新多级目录）';
  const folderInput = document.createElement('input');
  folderInput.id = 'move-note-folder-input';
  folderInput.type = 'text';
  folderInput.className = 'dialog-single-input';
  folderInput.placeholder = '/（根目录）';
  folderInput.value = targetNote.folder && targetNote.folder !== '根目录' ? targetNote.folder : '';
  folderField.append(folderLabel, folderInput);

  const allFolders = collectAllKnownFolders();
  const pickerDrawer = document.createElement('details');
  pickerDrawer.className = 'folder-picker-drawer';
  pickerDrawer.id = 'move-note-folder-picker';
  pickerDrawer.open = true;
  const pickerSummary = document.createElement('summary');
  pickerSummary.textContent = `快速筛选与点选已有目录（共 ${allFolders.length + 1} 项）`;
  const pickerBody = document.createElement('div');
  pickerBody.className = 'folder-picker-body';
  const pickerSearch = document.createElement('input');
  pickerSearch.type = 'search';
  pickerSearch.id = 'move-note-folder-search';
  pickerSearch.placeholder = '输入关键字快速筛选目录...';
  const pickerList = document.createElement('div');
  pickerList.className = 'folder-picker-list';

  const renderMoveFolderOptions = (q = '') => {
    pickerList.replaceChildren();
    const needle = q.trim().toLowerCase();
    const candidates = ['', ...allFolders].filter(f => !needle || (f || '/ 根目录').toLowerCase().includes(needle));
    for (const f of candidates.slice(0, 80)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-picker-option' + (folderInput.value.trim() === f ? ' is-selected' : '');
      btn.dataset.pickMoveFolder = f;
      const depth = f ? f.split('/').length - 1 : 0;
      btn.style.paddingLeft = `${8 + depth * 12}px`;
      btn.textContent = f ? `📁 ${f}` : '🏠 /（知识库根目录）';
      btn.onclick = () => {
        folderInput.value = f;
        for (const el of pickerList.querySelectorAll('.folder-picker-option')) {
          el.classList.toggle('is-selected', el.dataset.pickMoveFolder === f);
        }
      };
      pickerList.append(btn);
    }
  };
  pickerSearch.oninput = () => renderMoveFolderOptions(pickerSearch.value);
  renderMoveFolderOptions();
  pickerBody.append(pickerSearch, pickerList);
  pickerDrawer.append(pickerSummary, pickerBody);
  folderField.append(pickerDrawer);
  container.append(folderField);

  dialogApply = async () => {
    await moveNoteToFolder(targetNote.id, folderInput.value.trim());
  };
  find('#edit-dialog').showModal();
  folderInput.focus();
}

function openMoveFolderDialog(folderPath = '', mode = 'move') {
  const cleanFolder = String(folderPath || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!cleanFolder || cleanFolder === '根目录') throw new Error('请选择要重命名或移动的子目录');
  const parts = cleanFolder.split('/');
  const baseName = parts[parts.length - 1];
  const currentParent = parts.slice(0, -1).join('/');
  const srcLower = cleanFolder.toLowerCase();
  const childNoteCount = (vaultGraph?.notes || []).filter(n =>
    String(n.relativePath || '').toLowerCase().startsWith(srcLower + '/'),
  ).length;

  resetEditDialogFooter(mode === 'rename' ? '确认重命名目录' : '确认移动目录');
  find('#edit-title').textContent = mode === 'rename' ? '重命名目录与引用同步' : '移动整个目录至其他层级';
  const container = find('#edit-content');
  container.replaceChildren();

  const summary = document.createElement('p');
  summary.className = 'delete-dialog-summary';
  summary.textContent = `当前目录：「${cleanFolder}」（内含 ${childNoteCount} 篇笔记，自动同步所有带路径前缀的 [[双链]] 引用）`;
  container.append(summary);

  const nameField = document.createElement('div');
  nameField.className = 'appearance-field note-folder-field';
  const nameLabel = document.createElement('label');
  nameLabel.setAttribute('for', 'move-folder-name-input');
  nameLabel.textContent = '目录名称';
  const nameInput = document.createElement('input');
  nameInput.id = 'move-folder-name-input';
  nameInput.type = 'text';
  nameInput.className = 'dialog-single-input';
  nameInput.value = baseName;
  nameField.append(nameLabel, nameInput);
  container.append(nameField);

  const parentField = document.createElement('div');
  parentField.className = 'appearance-field note-folder-field';
  const parentLabel = document.createElement('label');
  parentLabel.setAttribute('for', 'move-folder-parent-input');
  parentLabel.textContent = '所属父级目录（留空或填 / 表示放在根目录，支持直接输入新多级父目录）';
  const parentInput = document.createElement('input');
  parentInput.id = 'move-folder-parent-input';
  parentInput.type = 'text';
  parentInput.className = 'dialog-single-input';
  parentInput.placeholder = '/（根目录）';
  parentInput.value = currentParent;
  parentField.append(parentLabel, parentInput);

  const allFolders = collectAllKnownFolders().filter(f => {
    const fl = f.toLowerCase();
    return fl !== srcLower && !fl.startsWith(srcLower + '/');
  });
  const pickerDrawer = document.createElement('details');
  pickerDrawer.className = 'folder-picker-drawer';
  pickerDrawer.id = 'move-folder-picker';
  pickerDrawer.open = mode === 'move';
  const pickerSummary = document.createElement('summary');
  pickerSummary.textContent = `选择目标父目录（共 ${allFolders.length + 1} 项，已自动排除自身与子目录）`;
  const pickerBody = document.createElement('div');
  pickerBody.className = 'folder-picker-body';
  const pickerSearch = document.createElement('input');
  pickerSearch.type = 'search';
  pickerSearch.id = 'move-folder-search';
  pickerSearch.placeholder = '输入关键字快速筛选父目录...';
  const pickerList = document.createElement('div');
  pickerList.className = 'folder-picker-list';

  const renderParentOptions = (q = '') => {
    pickerList.replaceChildren();
    const needle = q.trim().toLowerCase();
    const candidates = ['', ...allFolders].filter(f => !needle || (f || '/ 根目录').toLowerCase().includes(needle));
    for (const f of candidates.slice(0, 80)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-picker-option' + (parentInput.value.trim() === f ? ' is-selected' : '');
      btn.dataset.pickParentFolder = f;
      const depth = f ? f.split('/').length - 1 : 0;
      btn.style.paddingLeft = `${8 + depth * 12}px`;
      btn.textContent = f ? `📁 ${f}` : '🏠 /（知识库根目录）';
      btn.onclick = () => {
        parentInput.value = f;
        for (const el of pickerList.querySelectorAll('.folder-picker-option')) {
          el.classList.toggle('is-selected', el.dataset.pickParentFolder === f);
        }
      };
      pickerList.append(btn);
    }
  };
  pickerSearch.oninput = () => renderParentOptions(pickerSearch.value);
  renderParentOptions();
  pickerBody.append(pickerSearch, pickerList);
  pickerDrawer.append(pickerSummary, pickerBody);
  parentField.append(pickerDrawer);
  container.append(parentField);

  dialogApply = async () => {
    await moveFolderToTarget({
      sourceFolder: cleanFolder,
      targetParentFolder: parentInput.value.trim(),
      newFolderName: nameInput.value.trim(),
    });
  };
  find('#edit-dialog').showModal();
  if (mode === 'rename') {
    nameInput.focus();
    nameInput.select();
  } else {
    parentInput.focus();
  }
}

function openDeleteVaultDialog({ noteId = '', folderPath = '' } = {}) {
  const cleanFolder = String(folderPath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const targetNoteId = noteId || (!cleanFolder ? activeNoteIdentity : '');
  const previewPlan = planVaultDelete(vaultState.notes, {
    noteId: targetNoteId,
    folderPath: cleanFolder,
    cleanReferences: true,
    deleteReferencingFiles: false,
  });
  resetEditDialogFooter('确认删除');
  find('#edit-title').textContent = cleanFolder ? '删除目录与引用清理' : '删除笔记与引用清理';
  const container = find('#edit-content');
  container.replaceChildren();

  const targetSummary = document.createElement('p');
  targetSummary.className = 'delete-dialog-summary';
  if (cleanFolder) {
    targetSummary.textContent = `即将删除目录「${cleanFolder}」（包含 ${previewPlan.deletedNotes.length} 篇笔记文件）。`;
  } else {
    const first = previewPlan.deletedNotes[0];
    targetSummary.textContent = `即将删除笔记《${first?.title || '未命名'}》（路径：${first?.relativePath || ''}）。`;
  }
  container.append(targetSummary);

  const refBox = document.createElement('div');
  refBox.className = 'delete-reference-box';
  refBox.id = 'delete-reference-summary';
  if (previewPlan.referencingNotes.length > 0) {
    const refHead = document.createElement('strong');
    refHead.textContent = `检测到 ${previewPlan.referencingNotes.length} 篇其他笔记包含指向该目标的 ${previewPlan.cleanedReferenceCount} 处 [[双链]] / ![[嵌入]] 引用：`;
    const refList = document.createElement('ul');
    refList.className = 'delete-reference-list';
    for (const ref of previewPlan.referencingNotes.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = `《${ref.title}》（${ref.relativePath} · ${ref.referenceCount} 处引用）`;
      refList.append(li);
    }
    refBox.append(refHead, refList);
  } else {
    refBox.textContent = '全库无其他笔记引用该目标，删除后不会遗留断链或待建节点。';
  }
  container.append(refBox);

  const cleanLabel = document.createElement('label');
  cleanLabel.className = 'checkbox-setting';
  const cleanChk = document.createElement('input');
  cleanChk.type = 'checkbox';
  cleanChk.id = 'delete-clean-refs-checkbox';
  cleanChk.checked = true;
  cleanLabel.append(cleanChk, document.createTextNode('自动清除其他笔记中指向该目标的 [[双链]] 与 ![[嵌入]] 引用（消除断链与待建节点）'));
  container.append(cleanLabel);

  const cascadeLabel = document.createElement('label');
  cascadeLabel.className = 'checkbox-setting';
  const cascadeChk = document.createElement('input');
  cascadeChk.type = 'checkbox';
  cascadeChk.id = 'delete-referencing-files-checkbox';
  cascadeChk.checked = false;
  cascadeChk.disabled = previewPlan.referencingNotes.length === 0;
  cascadeLabel.append(
    cascadeChk,
    document.createTextNode(`同时删除所有引用该目标的关联笔记文件（共 ${previewPlan.referencingNotes.length} 篇关联文件）`),
  );
  container.append(cascadeLabel);

  dialogApply = async () => {
    const finalPlan = planVaultDelete(vaultState.notes, {
      noteId: targetNoteId,
      folderPath: cleanFolder,
      cleanReferences: cleanChk.checked,
      deleteReferencingFiles: cascadeChk.checked,
    });
    await executeVaultDeletePlan(finalPlan);
  };
  find('#edit-dialog').showModal();
}

function resizeDiagramPreview() {
  if (!find('#diagram-dialog').open) return;
  const viewport = find('#diagram-viewport');
  const width = diagramSize?.width || Math.max(180, viewport.clientWidth - 40);
  find('#diagram-stage').style.width = Math.round(width * diagramZoom) + 'px';
  find('#diagram-stage').style.height = diagramSize ? Math.round(diagramSize.height * diagramZoom) + 'px' : '';
  find('#diagram-zoom').textContent = Math.round(diagramZoom * 100) + '%';
}

async function openDiagramPreview(code, edit) {
  const request = ++diagramRequest;
  diagramZoom = 0.8; diagramEdit = edit; diagramSize = null;
  currentDiagramCode = String(code || '');
  find('#diagram-title').textContent = '图表';
  find('[data-action="diagram-source"]').hidden = !edit;
  const copySrcBtn = find('[data-action="diagram-copy-source"]');
  if (copySrcBtn) copySrcBtn.hidden = false;
  find('#diagram-stage').textContent = '正在准备图表...';
  if (!find('#diagram-dialog').open) find('#diagram-dialog').showModal();
  resizeDiagramPreview();
  const markup = await renderMarkup('mermaid', code, themes[settings.rightTheme]?.family === 'dark' ? 'dark' : 'neutral');
  if (request !== diagramRequest || !find('#diagram-dialog').open) return;
  find('#diagram-stage').innerHTML = markup;
  const box = find('#diagram-stage > svg')?.viewBox.baseVal;
  if (box?.width > 0 && box.height > 0) diagramSize = { width: box.width, height: box.height };
  resizeDiagramPreview();
}

async function openImagePreview(path, alt) {
  const request = ++diagramRequest;
  diagramZoom = 0.8; diagramSize = null; diagramEdit = null;
  currentDiagramCode = String(path || '');
  find('[data-action="diagram-source"]').hidden = true;
  const copySrcBtn = find('[data-action="diagram-copy-source"]');
  if (copySrcBtn) copySrcBtn.hidden = true;
  find('#diagram-title').textContent = alt || '图片';
  if (!find('#diagram-dialog').open) find('#diagram-dialog').showModal();
  const image = new Image(); image.alt = alt || '图片'; image.src = assetUrl(path);
  try { await image.decode(); } catch { return; }
  if (request !== diagramRequest || !find('#diagram-dialog').open) return;
  diagramSize = { width: image.naturalWidth, height: image.naturalHeight };
  find('#diagram-stage').replaceChildren(image);
  resizeDiagramPreview();
}

function insert(text, replace = true) {
  richEditor.flush();
  const bodyStart = parseFrontMatter(documentSession.source).bodyFrom || 0;
  const from = selection.from === 0 && bodyStart > 0 ? documentSession.source.length : Math.max(bodyStart, selection.from);
  const to = replace ? Math.max(from, selection.to) : from;
  changeDocument({ from, to, insert: text }, 'command');
  selection = { from: from + text.length, to: from + text.length };
  richEditor.flush();
  if (activePane === 'source') { sourceEditor.reveal(selection.from); sourceEditor.focus(); }
  else { richEditor.reveal(selection.from); richEditor.focus(); }
}

function format(actionName) {
  if (activePane === 'rich' && richEditor.format(actionName)) return;
  const selected = documentSession.source.slice(selection.from, selection.to);
  const wrappers = { bold: '**', italic: '*', strike: '~~', code: '`' };
  if (wrappers[actionName]) { insert(wrappers[actionName] + (selected || '文字') + wrappers[actionName]); return; }
  const prefixes = { heading: '## ', bullet: '- ', ordered: '1. ', quote: '> ' };
  if (prefixes[actionName]) {
    const start = documentSession.source.lastIndexOf('\n', selection.from - 1) + 1;
    const endIndex = documentSession.source.indexOf('\n', selection.to);
    const end = endIndex < 0 ? documentSession.source.length : endIndex;
    changeDocument({ from: start, to: end, insert: documentSession.source.slice(start, end).split('\n').map(line => prefixes[actionName] + line).join('\n') }, 'command');
  }
}

async function importImages(files) {
  if (imageImportBusy) return;
  imageImportBusy = true;
  try {
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) continue;
      if (file.size > 25 * 1024 * 1024) throw new Error('单张图片不能超过 25 MB。');
      let image = file;
      if (settings.compress && file.type !== 'image/gif') {
        const bitmap = await createImageBitmap(file);
        if (Math.max(bitmap.width, bitmap.height) > 1920) {
          const scale = 1920 / Math.max(bitmap.width, bitmap.height);
          const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          image = await new Promise(resolve => canvas.toBlob(resolve, file.type === 'image/png' ? 'image/png' : 'image/jpeg', .88));
          if (!image) throw new Error('图片压缩失败，未插入。');
        }
        bitmap.close();
      }
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(image); });
      const result = await call('importImage', { name: file.name || '图片', mime: image.type, data: dataUrl.split(',')[1] });
      if (result) {
        const inserted = imageInsertion(documentSession.source, selection.from, selection.to, { src: result.path, alt: file.name || '图片' });
        if (inserted.change) changeDocument(inserted.change, 'command');
      }
    }
  } finally { imageImportBusy = false; }
}

function pasteImages(event) {
  const pastedText = event.clipboardData?.getData('text/plain') || '';
  const pastedHtml = event.clipboardData?.getData('text/html') || '';
  if (pastedText.includes('\t') || /<table[\s>]/i.test(pastedHtml) || (pastedText.includes(',') && pastedText.includes('\n'))) {
    const converted = convertDelimitedTextToMarkdownTable(pastedText, pastedHtml);
    if (converted?.markdown) {
      event.preventDefault();
      insert('\n\n' + converted.markdown + '\n\n');
      toast(`已将剪贴板 ${converted.rowCount} 行 × ${converted.columns} 列数据智能转换为 Markdown 表格`);
      return true;
    }
  }
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  if (files.length) {
    event.preventDefault(); importImages(files).catch(showError); return true;
  }
  return false;
}

async function importRawDocumentsFromDrop(files = []) {
  let importedCount = 0;
  let lastPath = '';
  for (const file of files) {
    if (file.size > 16 * 1024 * 1024) throw new Error(`文件 ${file.name} 超过 16 MB 上限`);
    const fmt = detectRawFileFormat(file.name);
    const buf = new Uint8Array(await file.arrayBuffer());
    const payload = fmt.binary
      ? { fileName: file.name, base64Data: uint8ArrayToBase64(buf), source: '', sizeBytes: buf.byteLength }
      : { fileName: file.name, base64Data: '', source: new TextDecoder('utf-8').decode(buf), sizeBytes: buf.byteLength };
    const res = await call('importRawFile', payload);
    if (res?.vault) vaultState = res.vault;
    lastPath = res?.importedPath || `raw/${file.name}`;
    importedCount++;
  }
  if (importedCount > 0) {
    await rebuildVaultGraph();
    renderVaultSidebar();
    toast(`已将 ${importedCount} 份资料存入 ${lastPath}（可在「智识 → Karpathy 知识编译器」一键摄取生成 Wiki）`);
  }
}

function dropFiles(event) {
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return false;
  event.preventDefault();
  const images = files.filter(file => file.type.startsWith('image/'));
  if (images.length) importImages(images).catch(showError);
  const rawDocs = files.filter(file => {
    if (file.type.startsWith('image/')) return false;
    const lower = String(file.name || '').toLowerCase();
    return SUPPORTED_RAW_EXTENSIONS.some(ext => lower.endsWith(ext));
  });
  if (rawDocs.length) importRawDocumentsFromDrop(rawDocs).catch(showError);
  return true;
}

function toggleSearch(show = find('#search-panel').hidden) {
  find('#search-panel').hidden = !show;
  if (show) { find('#selection-tools').hidden = true; find('#search-input').focus(); find('#search-input').select(); scheduleSearch(); }
  else { clearTimeout(searchTimer); searchId++; searching = false; invalidateSearch(); }
}

function renderSearchResults() {
  const panel = find('#search-results-panel');
  panel.hidden = settings.searchResults !== true || find('#search-panel').hidden || !settings.rich;
  const list = find('#search-results-list');
  list.replaceChildren(); searchGroups = [];
  if (panel.hidden) return;
  if (results.length && resultsRevision === documentSession.revision) {
    richEditor.flush();
    searchGroups = groupSearchMatches(results, outlineOf(richEditor.parsed));
  }
  find('#search-results-summary').textContent = `${totalResults.toLocaleString()} 处 · ${searchGroups.length} 个位置`;
  for (const [index, group] of searchGroups.entries()) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'search-result-heading';
    row.dataset.groupIndex = index;
    row.innerHTML = `<span class="search-result-title">${escapeHtml(group.title)}</span><span class="search-result-count">${group.count}</span>`;
    row.addEventListener('click', () => selectMatch(group.firstMatch));
    list.append(row);
  }
}

function invalidateSearch() {
  results = []; totalResults = 0; selectedResult = -1; resultsRevision = -1;
  find('#search-count').textContent = '0 处';
  find('#search-time').textContent = '';
  sourceEditor.refreshSearch();
  richEditor.refreshSearch();
  renderSearchResults();
}

function scheduleSearch() {
  clearTimeout(searchTimer); searchId++;
  invalidateSearch();
  if (find('#search-panel').hidden || !find('#search-input').value) return;
  find('#search-count').textContent = '查找中...';
  searchTimer = setTimeout(() => {
    searchWorker.postMessage({ type: 'search', id: searchId, revision: documentSession.revision, query: find('#search-input').value, options: { sensitive: find('#case-toggle').getAttribute('aria-pressed') === 'true' } });
  }, 60);
}

searchWorker.onmessage = event => {
  if (find('#search-panel').hidden || event.data.id !== searchId || event.data.revision !== documentSession.revision) return;
  results = event.data.matches.slice(0, 5000);
  totalResults = event.data.count;
  selectedResult = -1;
  resultsRevision = documentSession.revision;
  find('#search-count').textContent = totalResults.toLocaleString() + ' 处';
  find('#search-time').textContent = Math.round(event.data.duration) + ' ms';
  sourceEditor.refreshSearch();
  richEditor.refreshSearch();
  renderSearchResults();
};

function nextMatch(direction) {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  selectMatch((selectedResult + direction + results.length) % results.length);
}

function selectMatch(index) {
  if (!results[index] || resultsRevision !== documentSession.revision) return;
  selectedResult = index;
  const match = results[selectedResult];
  reveal(match.from, match.to);
  find('#search-count').textContent = (selectedResult + 1) + ' / ' + totalResults.toLocaleString();
}

function replaceCurrent() {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  if (selectedResult < 0) nextMatch(1);
  const match = results[selectedResult];
  changeDocument({ ...match, insert: find('#replace-input').value }, 'command');
  results = []; selectedResult = -1; scheduleSearch();
}

async function replaceAll() {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  const replacement = find('#replace-input').value;
  const count = results.length;
  const previous = documentSession.source;
  if (documentSession.replaceBatch(results.map(match => ({ ...match, insert: replacement })))) {
    sourceEditor.replace(minimalChange(previous, documentSession.source));
    richEditor.load(documentSession.source);
    searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
    changed();
  }
  results = []; scheduleSearch(); toast('已替换 ' + count + ' 处');
}

function tableDialog() {
  resetEditDialogFooter('确定');
  find('#edit-title').textContent = '插入表格';
  find('#edit-content').innerHTML = '<div class="table-size"><label>行数<input type="number" id="table-rows" min="2" max="100" value="3" required></label><label>列数<input type="number" id="table-columns" min="1" max="20" value="3" required></label></div>';
  dialogApply = () => {
    const rows = Math.min(100, Math.max(2, Number(find('#table-rows').value)));
    const columns = Math.min(20, Math.max(1, Number(find('#table-columns').value)));
    const header = '| ' + Array.from({ length: columns }, (_, index) => '列 ' + (index + 1)).join(' | ') + ' |';
    const separator = '| ' + Array(columns).fill('---').join(' | ') + ' |';
    const row = '| ' + Array(columns).fill(' ').join(' | ') + ' |';
    insert('\n\n' + [header, separator, ...Array(rows - 1).fill(row)].join('\n') + '\n\n');
  };
  find('#edit-dialog').showModal();
}

function openQuickAppendDialog(initialText = '') {
  const dialog = find('#quick-append-dialog');
  const input = find('#quick-append-input');
  const asTask = find('#quick-append-as-task');
  const targetSelect = find('#quick-append-target');
  if (!dialog || !input || !targetSelect) return;
  targetSelect.replaceChildren(
    new Option('📅 今日手记（后台静默追加，不切页）', 'daily'),
    new Option(`📝 当前笔记（${stripNumericPrefix(documentInfo.name) || '当前文档'}）`, 'active'),
  );
  for (const note of (vaultGraph?.notes || []).slice(0, 12)) {
    if (note.id !== activeNoteIdentity) {
      targetSelect.append(new Option(`📄 ${note.cleanTitle} (${note.folder})`, `note:${note.id}`));
    }
  }
  input.value = initialText;
  if (asTask) asTask.checked = false;
  dialog.showModal();
  input.focus();
}

async function submitQuickAppend() {
  const dialog = find('#quick-append-dialog');
  const input = find('#quick-append-input');
  const asTask = find('#quick-append-as-task');
  const targetVal = find('#quick-append-target')?.value || 'daily';
  const text = String(input?.value || '').trim();
  if (!text) throw new Error('请输入要追加的闪念或待办内容');

  if (targetVal === 'active') {
    richEditor.flush();
    const appended = appendQuickThoughtToSource(documentSession.source, text, { asTask: Boolean(asTask?.checked) });
    changeDocument(minimalChange(documentSession.source, appended.source), 'command');
    richEditor.flush();
    if (dialog?.open) dialog.close();
    toast(`⚡ 已追加到当前笔记：${appended.entryLine}`);
    return;
  }

  let targetNote = null;
  if (targetVal.startsWith('note:')) {
    const targetId = targetVal.slice(5);
    targetNote = vaultState.notes.find(n => n.id === targetId);
  } else {
    const today = localDate();
    const dailyTitle = `今日手记-${today}`;
    targetNote = vaultState.notes.find(n => n.name.includes(today) || n.title?.includes(today));
    if (!targetNote) {
      const created = await createPluginNote(dailyTitle, {
        folder: 'journal',
        source: `---\ntitle: ${dailyTitle}\nstatus: 进行中\ncategory: 手记\ndate: ${today}\ntags:\n  - 今日手记\n---\n\n# ${dailyTitle}\n`,
        background: true,
      });
      targetNote = vaultState.notes.find(n => n.id === created.id) || created;
    }
  }
  if (!targetNote) throw new Error('未找到目标追加笔记');

  if (targetNote.id === activeNoteIdentity) {
    richEditor.flush();
    const appended = appendQuickThoughtToSource(documentSession.source, text, { asTask: Boolean(asTask?.checked) });
    changeDocument(minimalChange(documentSession.source, appended.source), 'command');
    richEditor.flush();
    await save();
  } else {
    const expectedSource = targetNote.source;
    const appended = appendQuickThoughtToSource(expectedSource, text, { asTask: Boolean(asTask?.checked) });
    const res = await call('updateVaultNoteSource', {
      noteId: targetNote.id,
      path: targetNote.path,
      relativePath: targetNote.relativePath,
      expectedSource,
      source: appended.source,
    });
    if (res?.vault) vaultState = res.vault;
    else targetNote.source = appended.source;
    await rebuildVaultGraph();
  }
  if (dialog?.open) dialog.close();
  toast(`⚡ 已静默追加到《${stripNumericPrefix(targetNote.name)}》，当前写作未中断`);
}

async function openOrCreatePeriodicNote(periodKind = 'weekly') {
  if (periodKind === 'daily') {
    await action('daily-note');
    return;
  }
  if (dirty() && !await save()) return;
  const today = localDate();
  const spec = computePeriodicNoteSpec(periodKind, today);
  const existing = (vaultState?.notes || []).find(note => {
    const rel = String(note.relativePath || '').replaceAll('\\', '/').toLowerCase();
    const nm = String(note.name || '').toLowerCase();
    return rel === spec.relativePath.toLowerCase() || nm === spec.fileName.toLowerCase();
  });
  if (existing) {
    await openVaultNoteById(existing.id);
    workbench?.closeView();
    toast(`已打开${spec.label}：${spec.periodKey}`);
    return;
  }
  const srData = extractFlashcardsFromNotes(vaultState?.notes || [], { today });
  const compiled = compilePeriodicNoteMarkdown(vaultState?.notes || [], {
    periodKind,
    referenceDate: today,
    dueFlashcardCount: srData?.dueCards || 0,
  });
  await createAndOpenVaultNote(spec.periodKey, spec.folder, compiled.markdown);
  workbench?.closeView();
  toast(`已按周期模板生成${spec.label}：${spec.periodKey}`);
}

async function action(name) {
  if (name === 'read-aloud' || name === 'speak-selection') {
    find('#note-tools-menu').open = false;
    find('#selection-tools').hidden = true;
    await speechReader?.start(name === 'speak-selection' ? 'selection' : 'document');
    return;
  }
  if (embeddingSave || workspaceBusy || closingWorkspace || vaultMutationBusy) return;
  if (name === 'quick-switcher') { openQuickSwitcher(); return; }
  if (name === 'quick-append') { openQuickAppendDialog(); return; }
  if (name === 'vault-archive') { openVaultArchiveDialog(); return; }
  if (name === 'embed-inspector') { openEmbedInspectorDialog('note'); return; }
  if (name === 'vault-search-replace') { openVaultReplaceDialog(); return; }
  if (name === 'onenote-import') { await openOneNoteComDialog(); return; }
  if (name === 'discard-draft') { await discardActiveNoteChanges(); return; }
  if (name === 'close-active-tab') { await closeActiveNoteTab(); return; }
  if (name === 'slide-present') { openSlidePresenter(); return; }
  if (name === 'mindmap-present') { openMindmapPresenter({ mode: 'note' }); return; }
  if (name === 'share-card') { openShareCardDialog({ fromSelection: false }); return; }
  if (name === 'share-selection-card') { openShareCardDialog({ fromSelection: true }); return; }
  if (name === 'vault-expand-deep') { applyFolderTreeRecursiveAction(selectedTreeFolderPath || '', 'expand-all', true); return; }
  if (name === 'vault-collapse-all') { applyFolderTreeRecursiveAction(selectedTreeFolderPath || '', 'collapse-all', true); return; }
  if (name === 'note-version-diff') { openNoteDiffDialog(); return; }
  if (name === 'open-in-new-window') { await openTargetInSecondaryWindow({ targetType: 'note' }); return; }
  if (name === 'manage-multi-windows') { await openMultiWindowDialog(); return; }
  if (name === 'toggle-pomodoro') { togglePomodoroTimer(); return; }
  if (name === 'table-summary') {
    richEditor.flush();
    const res = appendOrUpdateTableSummaryRow(documentSession.source, selection.from);
    if (!res.rowCount) {
      toast('当前笔记未检测到可汇总的 Markdown 表格', true);
      return;
    }
    if (res.changed) {
      changeDocument(minimalChange(documentSession.source, res.source), 'command');
      richEditor.flush();
    }
    toast(`已为 ${res.rowCount} 行表格自动生成 Σ 合计/均值汇总行（识别 ${res.numericColumns} 个数值列）`);
    return;
  }
  if (name === 'table-sort-asc' || name === 'table-sort-desc') {
    richEditor.flush();
    const dir = name === 'table-sort-desc' ? 'desc' : 'asc';
    const sorted = sortMarkdownTableInSource(documentSession.source, selection.from, dir);
    if (!sorted.sortedRows) {
      toast('当前笔记未检测到可排序的 Markdown 表格', true);
      return;
    }
    if (sorted.changed) {
      changeDocument(minimalChange(documentSession.source, sorted.source), 'command');
      richEditor.flush();
    }
    toast(`已按「${sorted.columnHeader}」${dir === 'desc' ? '降序' : '升序'}排列 ${sorted.sortedRows} 行数据`);
    return;
  }
  if (name === 'table-align-left' || name === 'table-align-center' || name === 'table-align-right') {
    richEditor.flush();
    const align = name === 'table-align-center' ? 'center' : name === 'table-align-right' ? 'right' : 'left';
    const aligned = alignMarkdownTableColumnInSource(documentSession.source, selection.from, align);
    if (!aligned.columnHeader) {
      toast('当前笔记未检测到可对齐的 Markdown 表格', true);
      return;
    }
    if (aligned.changed) {
      changeDocument(minimalChange(documentSession.source, aligned.source), 'command');
      richEditor.flush();
    }
    const alignLabel = align === 'center' ? '居中对齐' : align === 'right' ? '右对齐' : '左对齐';
    toast(`已将「${aligned.columnHeader}」列设为${alignLabel}`);
    return;
  }
  if (name === 'table-copy-column') {
    richEditor.flush();
    const extracted = extractMarkdownTableColumnFromSource(documentSession.source, selection.from);
    if (!extracted.found) {
      toast('当前笔记未检测到可复制列的 Markdown 表格', true);
      return;
    }
    window.__inkloomLastCopiedText = extracted.text;
    await navigator.clipboard?.writeText(extracted.text).catch(() => {});
    toast(`已复制「${extracted.columnHeader}」列（共 ${extracted.values.length} 行数据）`);
    return;
  }
  if (name === 'copy-code-block') {
    richEditor.flush();
    const fences = [...documentSession.source.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)];
    if (!fences.length) {
      toast('当前笔记未检测到可复制的代码块', true);
      return;
    }
    const targetFence = fences.find(m => selection.from >= m.index && selection.from <= m.index + m[0].length) || fences.at(-1);
    const codeBody = (targetFence[1] || '').replace(/\r?\n$/, '');
    window.__inkloomLastCopiedText = codeBody;
    await navigator.clipboard?.writeText(codeBody).catch(() => {});
    toast('已复制代码块源码到剪贴板');
    return;
  }
  if (name === 'formatting-toolbar') { settings.formattingToolbar = !settings.formattingToolbar; applySettings(); return; }
  if (name === 'vault-refresh') { await refreshExternalVault(true); return; }
  if (name === 'vault-manage') { find('#settings-dialog').showModal(); await phaseTwo?.openVaultManager(); return; }
  if (name === 'toggle-reference-pane') { toggleReferencePane(); return; }
  if (name === 'toggle-global-graph') { toggleGlobalGraph(); return; }
  if (name === 'toggle-context-sidebar') { toggleSidebar('right'); return; }
  if (name === 'sidebar') { toggleSidebar('left'); return; }
  if (name === 'toggle-backlinks-drawer') {
    backlinksDrawerCollapsed = !backlinksDrawerCollapsed;
    renderBacklinksDrawer();
    return;
  }
  if (name === 'toggle-star') {
    const res = await call('toggleVaultStar', { noteId: activeNoteIdentity, path: documentInfo.path });
    if (res?.vault) vaultState = res.vault;
    else {
      const target = vaultState.notes.find(n => n.id === activeNoteIdentity);
      if (target) target.starred = !target.starred;
    }
    rebuildVaultGraph();
    return;
  }
  if (name === 'daily-note') {
    if (dirty() && !await save()) return;
    const res = await call('openDailyNote', { date: localDate() });
    if (res?.vault) vaultState = res.vault;
    if (res?.document) await addOpenedDocuments({ documents: [res.document] });
    workbench?.closeView();
    toast('已打开今日手记');
    return;
  }
  if (name === 'periodic-weekly' || name === 'periodic-monthly' || name === 'periodic-quarterly') {
    const periodKind = name.slice('periodic-'.length);
    await openOrCreatePeriodicNote(periodKind);
    return;
  }
  if (name === 'vault-open') {
    await openManagedVault();
    return;
  }
  if (name === 'vault-new-note' || name === 'new') {
    openNewNoteDialog('');
    return;
  }
  if (name === 'vault-new-folder') {
    const activeFolder = vaultGraph?.nodeMap.get(activeNoteIdentity)?.folder || '';
    openNewFolderDialog(activeFolder && activeFolder !== '根目录' && activeFolder !== '待建节点' ? activeFolder : '');
    return;
  }
  if (name === 'vault-reveal-active') {
    const activeNote = vaultGraph?.nodeMap.get(activeNoteIdentity);
    await revealVaultItemInExplorer({
      path: activeNote?.path || documentInfo.path || '',
      relativePath: activeNote?.relativePath || documentInfo.relativePath || '',
      isFolder: false,
    });
    return;
  }
  if (name === 'vault-delete-note') {
    if (!activeNoteIdentity) throw new Error('当前没有选中的知识库笔记');
    openDeleteVaultDialog({ noteId: activeNoteIdentity });
    return;
  }
  if (name === 'collect-research-excerpt') {
    if (!activeNoteIdentity || selection.to <= selection.from) throw new Error('请在已保存的知识库笔记中选择正文');
    richEditor.flush(); const note = vaultGraph.nodeMap.get(activeNoteIdentity); noteReference(note.relativePath); const text = documentSession.source.slice(selection.from, selection.to); if (text.length > 20000) throw new Error('摘录超过 20000 字符');
    const anchored = ensureBlockReference(documentSession.source, selection.from, 'block-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12));
    if (anchored.changed) changeDocument(minimalChange(documentSession.source, anchored.source), 'command');
    if (!await save() || activeNoteIdentity !== note.id) throw new Error('来源位置尚未保存，未创建摘录');
    const source = excerptNote({ title: note.title + ' · 摘录', sourceTitle: note.title, relativePath: note.relativePath, blockId: anchored.id, text });
    await createPluginNote('摘录 ' + crypto.randomUUID(), { folder: 'excerpts', source, background: true }); toast('摘录已保存到研究资料'); return;
  }
  if (name === 'copy-block-reference') {
    if (!activeNoteIdentity) throw new Error('请先将笔记保存到知识库');
    richEditor.flush(); const note = vaultGraph.nodeMap.get(activeNoteIdentity); noteReference(note.relativePath);
    const anchored = ensureBlockReference(documentSession.source, selection.from, 'block-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12));
    if (anchored.changed) changeDocument(minimalChange(documentSession.source, anchored.source), 'command');
    const reference = noteReference(note.relativePath, anchored.id);
    await navigator.clipboard.writeText(reference); toast('已复制块引用'); return;
  }
  if (name === 'insert-wikilink') {
    const defaultTarget = vaultGraph?.notes.find(n => n.id !== activeNoteIdentity)?.cleanTitle || '00-墨图导览与万象星图';
    openCodeDialog('wikilink', defaultTarget, val => {
      const trimmed = val.trim();
      if (trimmed) insert(`[[${trimmed}]]`);
    });
    return;
  }
  if (name === 'reading-start' || name === 'reading-return') {
    await readingTracker.flush().catch(() => {});
    if (name === 'reading-return' && !readingTracker.previous) return;
    await moveToReadingPosition(name === 'reading-start' ? null : readingTracker.previous);
    return;
  }
  if (name === 'diagram-close') { find('#diagram-dialog').close(); return; }
  if (name === 'diagram-source') { const edit = diagramEdit; find('#diagram-dialog').close(); edit?.(); return; }
  if (name === 'diagram-copy-source') {
    const codeText = currentDiagramCode || '';
    window.__inkloomLastCopiedText = codeText;
    await navigator.clipboard?.writeText(codeText).catch(() => {});
    toast('已复制 Mermaid 图表源码到剪贴板');
    return;
  }
  if (name === 'diagram-copy-image') {
    const svgEl = find('#diagram-stage > svg');
    const svgMarkup = svgEl ? new XMLSerializer().serializeToString(svgEl) : (find('#diagram-stage')?.innerHTML || '');
    window.__inkloomLastCopiedDiagramSvg = svgMarkup;
    await navigator.clipboard?.writeText(svgMarkup).catch(() => {});
    toast('已复制高清矢量图表 (SVG) 到剪贴板');
    return;
  }
  if (['diagram-zoom-in', 'diagram-zoom-out', 'diagram-fit'].includes(name)) {
    diagramZoom = name === 'diagram-fit' ? Math.max(0.25, Math.min(4, (find('#diagram-viewport').clientWidth - 40) / (diagramSize?.width || 600))) : Math.max(0.25, Math.min(4, diagramZoom * (name === 'diagram-zoom-in' ? 1.25 : 0.8)));
    resizeDiagramPreview();
    return;
  }
  if (name === 'open') {
    const opened = await call('open');
    if (opened) await addOpenedDocuments(opened);
    return;
  }
  if (name === 'save') return save();
  if (name === 'save-as') return save(true);
  if (name === 'undo' || name === 'redo') return history(name);
  if (['source', 'rich', 'focus', 'typewriter'].includes(name)) {
    settings[name] = !settings[name];
    applySettings();
    return;
  }
  if (name === 'settings' || name === 'open-settings') { applySettings(false); find('#settings-dialog').showModal(); phaseTwo?.refreshManagement(); return; }
  if (name === 'open-guide') { userGuide?.open(); return; }
  if (name === 'about') { find('#about-dialog').showModal(); return; }
  if (name === 'shortcuts') { renderShortcuts(settings.shortcuts); find('#shortcuts-dialog').showModal(); return; }
  if (name === 'shortcuts-reset') { renderShortcuts({}); return; }
  if (name === 'code-colors-reset') {
    settings.codeColors = { ...settings.codeColors };
    delete settings.codeColors[codeColorScope];
    applySettings();
    return;
  }
  if (name === 'unify-theme') { settings.leftTheme = settings.rightTheme; applySettings(); return; }
  if (name === 'zoom-in' || name === 'zoom-out') {
    settings.fontSize = Math.max(14, Math.min(24, settings.fontSize + (name === 'zoom-in' ? 1 : -1)));
    applySettings();
    return;
  }
  if (name === 'search') return toggleSearch(true);
  if (name === 'search-close') return toggleSearch(false);
  if (name === 'next' || name === 'previous') return nextMatch(name === 'next' ? 1 : -1);
  if (name === 'replace') return replaceCurrent();
  if (name === 'replace-all') return replaceAll();
  if (name === 'clear-highlight') return paint(null);
  if (name === 'edit-close') { find('#edit-dialog').close(); return; }
  if (name === 'image') { find('#image-input').click(); return; }
  if (name === 'dismiss-images') { find('#image-access').hidden = true; return; }
  if (name === 'retry-images') { for (const image of find('#rich-editor').querySelectorAll('img[data-image-source]')) image.src = assetUrl(image.dataset.imageSource); return; }
  if (name === 'table') return tableDialog();
  if (name === 'math') return openCodeDialog('math_block', 'E = mc^2', text => insert('\n\n$$\n' + text + '\n$$\n\n'));
  if (name === 'diagram') return openCodeDialog('mermaid', 'flowchart LR\n  A[落笔] --> B[成图]', text => insert('\n\n```mermaid\n' + text + '\n```\n\n'));
  if (name === 'code-block') return openCodeDialog('code', '', (text, language) => insert('\n\n```' + (language === 'plaintext' ? '' : language) + '\n' + text + '\n```\n\n'));
  if (name === 'print') { resetExportConfirmation(); find('#export-dialog').showModal(); return; }
  if (name === 'export-close') { exportController?.abort(); find('#export-dialog').close(); return; }
  format(name);
}

function renderShortcuts(overrides) {
  find('#shortcuts-list').replaceChildren();
  find('#shortcut-error').textContent = '';
  for (const command of shortcutCommands) {
    const label = document.createElement('label');
    label.className = 'shortcut-row';
    const name = document.createElement('span'); name.textContent = command.label;
    const input = document.createElement('input');
    input.className = 'hotkey-input'; input.readOnly = true;
    input.dataset.shortcutCommand = command.id; input.value = shortcutFor(command, overrides);
    label.append(name, input); find('#shortcuts-list').append(label);
  }
}

function syncInterfaceTheme(nextTheme) {
  if (!interfaceThemes[nextTheme]) return;
  if (appearance) {
    appearance.preview = null;
    settings.appearance = { ...appearance.savedConfig(), activeTheme: null };
  }
  settings.interfaceTheme = nextTheme;
  const nextInfo = interfaceThemes[nextTheme];
  const leftInfo = themes[settings.leftTheme] || themes.white;
  const rightInfo = themes[settings.rightTheme] || themes.white;
  if (nextInfo.family === 'dark') {
    if (leftInfo.family !== 'dark') settings.leftTheme = themes[nextTheme] ? nextTheme : 'graphite';
    if (rightInfo.family !== 'dark') settings.rightTheme = themes[nextTheme] ? nextTheme : 'graphite';
  } else {
    if (leftInfo.family === 'dark') settings.leftTheme = 'gray';
    if (rightInfo.family === 'dark') settings.rightTheme = 'gray';
  }
  applySettings();
}

document.addEventListener('click', event => {
  if (!event.target.closest('#vault-tree-context-menu')) hideTreeContextMenu();
  const interfaceTheme = event.target.closest('button[data-interface-theme]');
  if (interfaceTheme) { syncInterfaceTheme(interfaceTheme.dataset.interfaceTheme); return; }
  const theme = event.target.closest('[data-theme]');
  if (theme) { if (appearance) { appearance.preview = null; settings.appearance = { ...appearance.savedConfig(), activeTheme: null }; } settings[theme.dataset.themeSide] = theme.dataset.theme; applySettings(); return; }
  const tab = event.target.closest('[data-tab]');
  if (tab) { setNavigationTab(tab.dataset.tab); return; }
  const ctxTab = event.target.closest('[data-context-tab]');
  if (ctxTab) { contextTab = ctxTab.dataset.contextTab; renderRightContextPanel(); return; }
  const blTab = event.target.closest('[data-backlinks-tab]');
  if (blTab) {
    backlinksDrawerTab = blTab.dataset.backlinksTab;
    backlinksDrawerCollapsed = false;
    renderBacklinksDrawer();
    return;
  }
  const treeVaultNoteBtn = event.target.closest('#vault-tree-list [data-vault-note-id]');
  if (treeVaultNoteBtn) {
    const clickedId = treeVaultNoteBtn.dataset.vaultNoteId;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      handleVaultTreeMultiSelect(clickedId, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey || event.metaKey });
      return;
    }
    if (selectedTreeNoteIds.size > 0) clearVaultTreeMultiSelect();
    lastClickedTreeNoteId = clickedId;
    openVaultNoteById(clickedId).catch(showError);
    return;
  }
  if (event.target.closest('#vault-batch-clear-btn')) {
    clearVaultTreeMultiSelect();
    return;
  }
  if (event.target.closest('#vault-batch-add-tag-btn')) {
    const tagVal = find('#vault-batch-tag-input')?.value.trim() || '';
    if (!tagVal) { showError(new Error('请输入要批量添加的 #标签名')); return; }
    batchUpdateVaultNotes([...selectedTreeNoteIds], { addTag: tagVal }).then(() => {
      find('#vault-batch-tag-input').value = '';
    }).catch(showError);
    return;
  }
  if (event.target.closest('#vault-batch-remove-tag-btn')) {
    const tagVal = find('#vault-batch-tag-input')?.value.trim() || '';
    if (!tagVal) { showError(new Error('请输入要批量移除的 #标签名')); return; }
    batchUpdateVaultNotes([...selectedTreeNoteIds], { removeTag: tagVal }).then(() => {
      find('#vault-batch-tag-input').value = '';
    }).catch(showError);
    return;
  }
  if (event.target.closest('#vault-batch-status-btn')) {
    const statusVal = find('#vault-batch-status-select')?.value || '进行中';
    batchUpdateVaultNotes([...selectedTreeNoteIds], { status: statusVal }).catch(showError);
    return;
  }
  if (event.target.closest('#vault-batch-move-btn')) {
    const folderVal = find('#vault-batch-folder-input')?.value.trim() || '';
    const ids = [...selectedTreeNoteIds];
    clearVaultTreeMultiSelect();
    batchMoveVaultNotesToFolder(ids, folderVal).then(() => {
      if (find('#vault-batch-folder-input')) find('#vault-batch-folder-input').value = '';
    }).catch(showError);
    return;
  }
  const vaultNoteBtn = event.target.closest('[data-vault-note-id]');
  if (vaultNoteBtn) {
    openVaultNoteById(vaultNoteBtn.dataset.vaultNoteId).catch(showError);
    return;
  }
  const dewdropNoteBtn = event.target.closest('[data-dewdrop-note-id]');
  if (dewdropNoteBtn) {
    const cornerMenu = find('#corner-overflow-menu');
    const cornerFold = find('#corner-fold-dewdrop');
    if (cornerMenu) cornerMenu.hidden = true;
    if (cornerFold) cornerFold.setAttribute('aria-expanded', 'false');
    workbench?.closeView();
    openVaultNoteById(dewdropNoteBtn.dataset.dewdropNoteId).catch(showError);
    return;
  }
  if (event.target.closest('#active-dewdrop-close')) {
    event.stopPropagation();
    closeActiveNoteTab().catch(showError);
    return;
  }
  if (event.target.closest('#active-file-dewdrop')) {
    workbench?.closeView();
    return;
  }
  const cornerFoldBtn = event.target.closest('#corner-fold-dewdrop');
  if (cornerFoldBtn) {
    const cornerMenu = find('#corner-overflow-menu');
    if (cornerMenu) {
      const nextOpen = cornerMenu.hidden;
      cornerMenu.hidden = !nextOpen;
      cornerFoldBtn.setAttribute('aria-expanded', String(nextOpen));
    }
    return;
  }
  const rightDewBtn = event.target.closest('[data-right-dewdrop]');
  if (rightDewBtn) {
    const targetTab = rightDewBtn.dataset.rightDewdrop;
    if (document.body.classList.contains('hide-context-sidebar')) {
      toggleSidebar('right');
    }
    contextTab = targetTab;
    renderRightContextPanel();
    return;
  }
  const tagBtn = event.target.closest('[data-tag-filter]');
  if (tagBtn) { filterByTag(tagBtn.dataset.tagFilter); return; }
  const jumpBtn = event.target.closest('[data-jump-note-id]');
  if (jumpBtn) {
    openVaultNoteById(jumpBtn.dataset.jumpNoteId, '', Number(jumpBtn.dataset.jumpOffset)).catch(showError);
    return;
  }
  const followBtn = event.target.closest('[data-follow-target]');
  if (followBtn) {
    followWikiLink({
      target: followBtn.dataset.followTarget,
      heading: followBtn.dataset.followHeading,
      ghost: followBtn.dataset.followGhost === 'true',
    }).catch(showError);
    return;
  }
  const mentionBtn = event.target.closest('[data-convert-mention-index]');
  if (mentionBtn) {
    convertUnlinkedMentionToWikiLink(Number(mentionBtn.dataset.convertMentionIndex)).catch(showError);
    return;
  }
  const inlineAiBtn = event.target.closest('[data-inline-ai-action]');
  if (inlineAiBtn) {
    openInlineAiPopover(inlineAiBtn.dataset.inlineAiAction, inlineAiBtn).catch(showError);
    return;
  }
  const color = event.target.closest('[data-color]');
  if (color) { paint(color.dataset.color); return; }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    find('#file-menu').open = false;
    const noteToolsMenu = find('#note-tools-menu');
    if (noteToolsMenu) noteToolsMenu.open = false;
    action(actionButton.dataset.action).catch(showError);
  }
});

find('#quick-append-form')?.addEventListener('submit', event => {
  event.preventDefault();
  submitQuickAppend().catch(showError);
});
find('#quick-append-close')?.addEventListener('click', () => find('#quick-append-dialog')?.close());
find('#quick-append-cancel')?.addEventListener('click', () => find('#quick-append-dialog')?.close());

find('#slide-prev-btn')?.addEventListener('click', () => { activeSlideIndex--; renderActiveSlide(); });
find('#slide-next-btn')?.addEventListener('click', () => { activeSlideIndex++; renderActiveSlide(); });
find('#slide-toggle-notes')?.addEventListener('click', () => { slideShowNotes = !slideShowNotes; renderActiveSlide(); });
find('#slide-toggle-theme')?.addEventListener('click', () => {
  const dialog = find('#slide-presenter-dialog');
  slideDarkTheme = dialog?.dataset.slideTheme !== 'dark';
  if (dialog) dialog.dataset.slideTheme = slideDarkTheme ? 'dark' : 'light';
});
find('#slide-close-btn')?.addEventListener('click', () => find('#slide-presenter-dialog')?.close());
find('#slide-stage-body')?.addEventListener('click', event => {
  const chip = event.target.closest('[data-wiki-target]');
  if (!chip) return;
  find('#slide-presenter-dialog')?.close();
  followWikiLink({ target: chip.dataset.wikiTarget || '', heading: chip.dataset.wikiHeading || '', ghost: false }).catch(showError);
});

find('#note-diff-close')?.addEventListener('click', () => find('#note-diff-dialog')?.close());
find('#vault-replace-close-btn')?.addEventListener('click', () => find('#vault-replace-dialog')?.close());
find('#vault-replace-mode')?.addEventListener('change', () => {
  const modeVal = find('#vault-replace-mode')?.value || 'text';
  const textOpts = find('#vault-replace-text-options');
  if (textOpts) textOpts.hidden = modeVal === 'yaml-key';
  activeVaultReplacePlan = null;
  const applyBtn = find('#vault-replace-apply-btn');
  if (applyBtn) applyBtn.disabled = true;
});
find('#vault-replace-preview-btn')?.addEventListener('click', () => renderVaultReplacePreview());
find('#vault-replace-apply-btn')?.addEventListener('click', async () => {
  if (!activeVaultReplacePlan?.notePlans?.length) return;
  const applyBtn = find('#vault-replace-apply-btn');
  if (applyBtn) applyBtn.disabled = true;
  try {
    const planToApply = activeVaultReplacePlan;
    let appliedFiles = 0;
    for (const plan of planToApply.notePlans) {
      if (plan.noteId === activeNoteIdentity) {
        richEditor.flush();
        changeDocument(minimalChange(documentSession.source, plan.nextSource), 'command');
        richEditor.flush();
        await save();
        appliedFiles++;
      } else {
        const target = (vaultState?.notes || []).find(n => n.id === plan.noteId);
        if (!target) continue;
        const res = await call('updateVaultNoteSource', {
          noteId: target.id,
          path: target.path,
          relativePath: target.relativePath,
          expectedSource: target.source,
          source: plan.nextSource,
        });
        if (res?.vault) vaultState = res.vault;
        else target.source = plan.nextSource;
        appliedFiles++;
      }
    }
    lastVaultReplaceRollback = planToApply.rollbackSnapshot;
    activeVaultReplacePlan = null;
    await rebuildVaultGraph();
    const undoBtn = find('#vault-replace-undo-btn');
    if (undoBtn) undoBtn.disabled = !lastVaultReplaceRollback?.entries?.length;
    const summaryEl = find('#vault-replace-summary');
    if (summaryEl) {
      summaryEl.textContent = `✅ 已完成受控批量替换：共更新 ${appliedFiles} 篇笔记（${planToApply.totalReplacements} 处），可随时点击右侧「↩️ 撤销上次批量替换」一键无损回退`;
    }
    toast(`✅ 已批量替换 ${appliedFiles} 篇笔记（共 ${planToApply.totalReplacements} 处）`);
  } catch (err) {
    showError(err);
  }
});
find('#vault-replace-undo-btn')?.addEventListener('click', async () => {
  if (!lastVaultReplaceRollback?.entries?.length) return;
  const undoBtn = find('#vault-replace-undo-btn');
  if (undoBtn) undoBtn.disabled = true;
  try {
    const snap = lastVaultReplaceRollback;
    let revertedFiles = 0;
    for (const entry of snap.entries) {
      if (entry.noteId === activeNoteIdentity) {
        richEditor.flush();
        changeDocument(minimalChange(documentSession.source, entry.originalSource), 'command');
        richEditor.flush();
        await save();
        revertedFiles++;
      } else {
        const target = (vaultState?.notes || []).find(n => n.id === entry.noteId);
        if (!target) continue;
        const res = await call('updateVaultNoteSource', {
          noteId: target.id,
          path: target.path,
          relativePath: target.relativePath,
          expectedSource: target.source,
          source: entry.originalSource,
        });
        if (res?.vault) vaultState = res.vault;
        else target.source = entry.originalSource;
        revertedFiles++;
      }
    }
    lastVaultReplaceRollback = null;
    await rebuildVaultGraph();
    const summaryEl = find('#vault-replace-summary');
    if (summaryEl) {
      summaryEl.textContent = `↩️ 已无损撤销上次批量替换，共还原 ${revertedFiles} 篇笔记至替换前原文`;
    }
    toast(`↩️ 已整批回退 ${revertedFiles} 篇笔记`);
  } catch (err) {
    showError(err);
  }
});
find('#vault-archive-close-btn')?.addEventListener('click', () => find('#vault-archive-dialog')?.close());
find('#vault-archive-export-btn')?.addEventListener('click', () => {
  try {
    const liveNotes = buildLiveVaultNotesForInspection();
    const compiled = compileVaultPortableArchiveBytes(liveNotes, {
      vaultName: vaultState?.vaultName || '本地知识库',
      folders: vaultState?.folders || [],
      appVersion: releaseNotes[0][0],
    });
    lastArchiveBytesInMemory = compiled.bytes;
    window.__inkloomLastVaultArchiveMeta = {
      fileName: compiled.fileName,
      noteCount: compiled.noteCount,
      archiveByteLength: compiled.archiveByteLength,
      manifestSha256: compiled.manifestSha256,
    };
    const verifyLatestBtn = find('#vault-archive-verify-latest-btn');
    if (verifyLatestBtn) verifyLatestBtn.disabled = false;
    const summaryEl = find('#vault-archive-summary');
    if (summaryEl) {
      summaryEl.textContent = `📦 已生成便携归档包：${compiled.fileName}（收录 ${compiled.noteCount} 篇笔记 · ${compiled.archiveByteLength} B · SHA-256: ${compiled.manifestSha256.slice(0, 16)}…）`;
    }
    const blob = new Blob([compiled.bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = compiled.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast(`已打包导出《${compiled.fileName}》`);
  } catch (err) {
    showError(err);
  }
});
find('#vault-archive-verify-latest-btn')?.addEventListener('click', () => {
  if (!lastArchiveBytesInMemory) return;
  runVaultArchiveVerification(lastArchiveBytesInMemory).catch(showError);
});
find('#vault-archive-import-btn')?.addEventListener('click', () => {
  find('#vault-archive-file-input')?.click();
});
find('#vault-archive-file-input')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    lastArchiveBytesInMemory = bytes;
    const verifyLatestBtn = find('#vault-archive-verify-latest-btn');
    if (verifyLatestBtn) verifyLatestBtn.disabled = false;
    await runVaultArchiveVerification(bytes);
  } catch (err) {
    showError(err);
  } finally {
    event.target.value = '';
  }
});
find('#vault-archive-restore-btn')?.addEventListener('click', async () => {
  if (!lastVerifiedVaultArchive?.valid || !lastVerifiedVaultArchive.restorableNotes?.length) return;
  const restoreBtn = find('#vault-archive-restore-btn');
  if (restoreBtn) restoreBtn.disabled = true;
  try {
    let restoredCount = 0;
    for (const item of lastVerifiedVaultArchive.restorableNotes) {
      await createPluginNote(item.stem, {
        folder: item.folder,
        source: item.source,
        background: true,
        overwrite: true,
      });
      if (item.currentNoteId && item.currentNoteId === activeNoteIdentity) {
        changeDocument(minimalChange(documentSession.source, item.source), 'command');
        richEditor.flush();
        await save();
      }
      restoredCount++;
    }
    await rebuildVaultGraph();
    if (lastArchiveBytesInMemory) {
      await runVaultArchiveVerification(lastArchiveBytesInMemory);
    }
    toast(`♻️ 已无损校验并还原 ${restoredCount} 篇笔记`);
  } catch (err) {
    showError(err);
  }
});

find('#embed-inspector-close-btn')?.addEventListener('click', () => find('#embed-inspector-dialog')?.close());
find('#embed-inspector-scope-select')?.addEventListener('change', () => renderEmbedInspectorDialog());
find('#embed-inspector-refresh-btn')?.addEventListener('click', () => renderEmbedInspectorDialog());
find('#embed-inspector-list')?.addEventListener('click', async event => {
  const jumpBtn = event.target.closest('[data-embed-jump-index]');
  if (jumpBtn && activeEmbedInspectionReport) {
    const item = activeEmbedInspectionReport.items[Number(jumpBtn.dataset.embedJumpIndex)];
    if (item?.targetNoteId) {
      find('#embed-inspector-dialog')?.close();
      await openVaultNoteById(item.targetNoteId, item.status === 'ready' ? item.fragment : '').catch(showError);
    }
    return;
  }
  const repairBtn = event.target.closest('[data-embed-repair-index]');
  if (repairBtn && activeEmbedInspectionReport) {
    const item = activeEmbedInspectionReport.items[Number(repairBtn.dataset.embedRepairIndex)];
    if (!item?.repairable) return;
    try {
      if (item.hostNoteId === activeNoteIdentity) {
        richEditor.flush();
        const repaired = repairBrokenNoteEmbedInSource(documentSession.source, item);
        if (repaired.changed) {
          changeDocument(minimalChange(documentSession.source, repaired.source), 'command');
          richEditor.flush();
          await save();
        }
      } else {
        const hostNote = (vaultState?.notes || []).find(n => n.id === item.hostNoteId);
        if (!hostNote) throw new Error('未找到宿主笔记');
        const repaired = repairBrokenNoteEmbedInSource(hostNote.source, item);
        if (repaired.changed) {
          const res = await call('updateVaultNoteSource', {
            noteId: hostNote.id,
            path: hostNote.path,
            relativePath: hostNote.relativePath,
            expectedSource: hostNote.source,
            source: repaired.source,
          });
          if (res?.vault) vaultState = res.vault;
          else hostNote.source = repaired.source;
          await rebuildVaultGraph();
        }
      }
      renderEmbedInspectorDialog();
      toast(`✨ 已同步修复内嵌锚点为 #${item.suggestedFragment}`);
    } catch (err) {
      showError(err);
    }
  }
});
find('#embed-inspector-repair-all-btn')?.addEventListener('click', async () => {
  if (!activeEmbedInspectionReport?.repairableCount) return;
  try {
    const grouped = new Map();
    for (const item of activeEmbedInspectionReport.items.filter(i => i.repairable)) {
      if (!grouped.has(item.hostNoteId)) grouped.set(item.hostNoteId, []);
      grouped.get(item.hostNoteId).push(item);
    }
    let totalRepaired = 0;
    for (const [hostId, hostItems] of grouped.entries()) {
      if (hostId === activeNoteIdentity) {
        richEditor.flush();
        const batch = batchRepairNoteEmbedsInSource(documentSession.source, hostItems);
        if (batch.changed) {
          changeDocument(minimalChange(documentSession.source, batch.source), 'command');
          richEditor.flush();
          await save();
          totalRepaired += batch.repairedCount;
        }
      } else {
        const hostNote = (vaultState?.notes || []).find(n => n.id === hostId);
        if (!hostNote) continue;
        const batch = batchRepairNoteEmbedsInSource(hostNote.source, hostItems);
        if (batch.changed) {
          const res = await call('updateVaultNoteSource', {
            noteId: hostNote.id,
            path: hostNote.path,
            relativePath: hostNote.relativePath,
            expectedSource: hostNote.source,
            source: batch.source,
          });
          if (res?.vault) vaultState = res.vault;
          else hostNote.source = batch.source;
          totalRepaired += batch.repairedCount;
        }
      }
    }
    await rebuildVaultGraph();
    renderEmbedInspectorDialog();
    toast(`🔧 已批量对齐修复 ${totalRepaired} 处跨笔记内嵌引用`);
  } catch (err) {
    showError(err);
  }
});
find('#share-card-close-btn')?.addEventListener('click', () => find('#share-card-dialog')?.close());
find('#share-card-theme-select')?.addEventListener('change', () => renderShareCardPreview());
find('#share-card-author-input')?.addEventListener('input', () => renderShareCardPreview());
find('#share-card-custom-text')?.addEventListener('input', () => renderShareCardPreview());
find('#share-card-copy-svg-btn')?.addEventListener('click', async () => {
  if (!activeShareCardRendered?.svg) renderShareCardPreview();
  const svgMarkup = activeShareCardRendered?.svg || '';
  window.__inkloomLastCopiedShareCardSvg = svgMarkup;
  await navigator.clipboard?.writeText(svgMarkup).catch(() => {});
  toast('已复制知识分享卡片矢量 SVG 到剪贴板');
});
find('#share-card-download-svg-btn')?.addEventListener('click', () => {
  if (!activeShareCardRendered?.svg) renderShareCardPreview();
  const svgMarkup = activeShareCardRendered?.svg || '';
  const safeStem = (activeShareCardRendered?.title || '墨图知识卡片').replace(/[\\/:*?"<>|]+/g, '-');
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeStem}-卡片.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast(`已导出知识卡片 SVG：${safeStem}-卡片.svg`);
});
find('#share-card-download-png-btn')?.addEventListener('click', async () => {
  if (!activeShareCardRendered?.svg) renderShareCardPreview();
  const rendered = activeShareCardRendered;
  if (!rendered?.svg) return;
  const safeStem = (rendered.title || '墨图知识卡片').replace(/[\\/:*?"<>|]+/g, '-');
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = rendered.width * scale;
  canvas.height = rendered.height * scale;
  const ctx = canvas.getContext('2d');
  const svgBlob = new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, rendered.width, rendered.height);
        resolve();
      };
      img.onerror = reject;
      img.src = svgUrl;
    });
    const pngDataUrl = canvas.toDataURL('image/png');
    window.__inkloomLastExportedShareCardPng = pngDataUrl;
    const link = document.createElement('a');
    link.href = pngDataUrl;
    link.download = `${safeStem}-卡片.png`;
    link.click();
    toast(`已导出 2x 高清知识卡片 PNG（${canvas.width}×${canvas.height} px）`);
  } catch (err) {
    showError(err);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
});
find('#mindmap-close-btn')?.addEventListener('click', () => find('#mindmap-presenter-dialog')?.close());
find('#mindmap-mode-select')?.addEventListener('change', () => {
  activeMindmapCollapsedIds.clear();
  renderMindmapPresenter();
});
find('#mindmap-folder-select')?.addEventListener('change', () => {
  activeMindmapCollapsedIds.clear();
  renderMindmapPresenter();
});
find('#mindmap-expand-all-btn')?.addEventListener('click', () => {
  activeMindmapCollapsedIds.clear();
  renderMindmapPresenter();
  toast('已将思维导图全部展开至最底层');
});
find('#mindmap-collapse-all-btn')?.addEventListener('click', () => {
  if (!activeMindmapRoot) return;
  const collectSubIds = node => {
    for (const child of node.children || []) {
      if ((child.children || []).length > 0) {
        activeMindmapCollapsedIds.add(child.id);
        collectSubIds(child);
      }
    }
  };
  collectSubIds(activeMindmapRoot);
  renderMindmapPresenter();
  toast('已收起思维导图子级分支');
});
find('#mindmap-copy-svg-btn')?.addEventListener('click', async () => {
  const svgMarkup = find('#mindmap-stage-viewport')?.innerHTML || '';
  window.__inkloomLastCopiedMindmapSvg = svgMarkup;
  await navigator.clipboard?.writeText(svgMarkup).catch(() => {});
  toast('已复制思维导图高清矢量 SVG 到剪贴板');
});
find('#mindmap-stage-viewport')?.addEventListener('click', event => {
  const nodeGroup = event.target.closest('[data-mindmap-node-id]');
  if (!nodeGroup) return;
  const nodeId = nodeGroup.dataset.mindmapNodeId;
  const noteId = nodeGroup.dataset.mindmapNoteId;
  const wikiTarget = nodeGroup.dataset.mindmapWikilink;
  if (wikiTarget) {
    find('#mindmap-presenter-dialog')?.close();
    followWikiLink({ target: wikiTarget, heading: '', ghost: false }).catch(showError);
    return;
  }
  if (noteId && nodeId.startsWith('mindmap-note:')) {
    find('#mindmap-presenter-dialog')?.close();
    openVaultNoteById(noteId).catch(showError);
    return;
  }
  if (nodeId && !nodeId.startsWith('note-root:')) {
    if (activeMindmapCollapsedIds.has(nodeId)) activeMindmapCollapsedIds.delete(nodeId);
    else activeMindmapCollapsedIds.add(nodeId);
    renderMindmapPresenter();
  }
});
find('#multi-window-close')?.addEventListener('click', () => find('#multi-window-dialog')?.close());
find('#mw-spawn-note-btn')?.addEventListener('click', () => openTargetInSecondaryWindow({ targetType: 'note' }).catch(showError));
find('#mw-spawn-graph-btn')?.addEventListener('click', () => openTargetInSecondaryWindow({ targetType: 'graph', title: '万象知识星图' }).catch(showError));
find('#mw-spawn-whiteboard-btn')?.addEventListener('click', () => openTargetInSecondaryWindow({ targetType: 'whiteboard', title: 'Excalidraw 手绘白板' }).catch(showError));
find('#mw-spawn-reader-btn')?.addEventListener('click', () => openTargetInSecondaryWindow({ targetType: 'reader', title: 'PDF / EPUB 原件精读', relativePath: 'raw/智能制造与双链溯源规范.pdf', readerPage: 1 }).catch(showError));
find('#multi-window-sync-test-btn')?.addEventListener('click', async () => {
  try {
    const activeNode = vaultGraph?.nodeMap.get(activeNoteIdentity);
    const envelope = createSyncEnvelope({
      eventType: 'wikilink-navigate',
      sourceWindowId: multiWindowState.windowId || 'primary',
      payload: {
        noteId: activeNoteIdentity,
        title: activeNode?.cleanTitle || activeNode?.title || documentInfo.name,
      },
    });
    const res = await call('broadcastWindowEvent', envelope);
    multiWindowState.lastSyncMessage = `✓ 已向 ${res?.delivered ?? 0} 个副窗口广播跨窗双链同步事件（目标：《${envelope.payload.title}》）`;
    renderMultiWindowDialog();
  } catch (err) {
    showError(err);
  }
});
find('#multi-window-close-all-btn')?.addEventListener('click', async () => {
  try {
    const res = await call('closeSecondaryWindow', { targetWindowId: 'all' });
    multiWindowState.activeWindowCount = Number(res?.activeWindowCount) || 1;
    multiWindowState.windows = Array.isArray(res?.windows) ? res.windows : [];
    multiWindowState.lastSyncMessage = '已关闭全部独立副窗口，当前保留主工作区窗口';
    updateMultiWindowBadge();
    renderMultiWindowDialog();
  } catch (err) {
    showError(err);
  }
});
window.addEventListener('inkloom:windowRegistryChanged', event => {
  const detail = event.detail || {};
  if (Number.isFinite(Number(detail.activeWindowCount))) {
    multiWindowState.activeWindowCount = Number(detail.activeWindowCount);
  }
  if (Array.isArray(detail.windows)) {
    multiWindowState.windows = detail.windows;
  }
  updateMultiWindowBadge();
  if (find('#multi-window-dialog')?.open) renderMultiWindowDialog();
});
window.addEventListener('inkloom:crossWindowSync', event => {
  const envelope = event.detail || {};
  if (envelope.eventType === 'note-saved') {
    const reconciled = reconcileCrossWindowNoteUpdate({
      localWindowId: envelope.loopbackPreview ? '__loopback__' : multiWindowState.windowId,
      activeNoteId: activeNoteIdentity,
      isLocalDirty: dirty(),
      localSource: documentSession.source,
      envelope,
    });
    if (reconciled.action === 'apply-live-update' && typeof reconciled.nextSource === 'string') {
      changeDocument(minimalChange(documentSession.source, reconciled.nextSource), 'command');
      savedRevision = documentSession.revision;
      richEditor.flush();
      syncActiveNoteIntoVault();
      void rebuildVaultGraph();
    } else if (reconciled.action === 'conflict-preserve-draft') {
      const notice = find('#vault-change-notice');
      const noticeText = find('#vault-change-text');
      if (notice && noticeText) {
        noticeText.textContent = '其他窗口已更新本篇笔记；为保护您当前未保存的草稿，未自动覆盖。';
        notice.hidden = false;
      }
    } else if (reconciled.action === 'update-background-index') {
      void refreshExternalVault();
    }
    multiWindowState.lastSyncMessage = `🔄 收到跨窗口保存同步：${envelope.payload?.relativePath || envelope.payload?.noteId || '笔记'}（处理策略：${reconciled.action}）`;
  } else if (envelope.eventType === 'wikilink-navigate' && envelope.payload?.noteId) {
    multiWindowState.lastSyncMessage = `🔗 收到跨窗口双链联动：跳转至《${envelope.payload?.title || envelope.payload.noteId}》`;
    if (!envelope.loopbackPreview && envelope.payload.noteId !== activeNoteIdentity) {
      void openVaultNoteById(envelope.payload.noteId).catch(() => {});
    }
  }
  if (find('#multi-window-dialog')?.open) renderMultiWindowDialog();
});
find('#note-diff-baseline-select')?.addEventListener('change', () => renderNoteDiffDialog());
find('#note-diff-revert-all')?.addEventListener('click', () => {
  const reverted = revertDiffHunk(documentSession.source, getSelectedDiffBaselineSource(), 'all');
  if (reverted.reverted) {
    changeDocument(minimalChange(documentSession.source, reverted.source), 'command');
    richEditor.flush();
    renderNoteDiffDialog();
    toast('已将当前笔记还原至所选基线版本（可按 Ctrl+Z 撤销）');
  }
});

find('#onenote-com-close')?.addEventListener('click', () => { if (!oneNoteImportBusy) find('#onenote-com-dialog').close(); });
find('#onenote-com-dialog').addEventListener('cancel', event => { if (oneNoteImportBusy) event.preventDefault(); });
find('#onenote-com-scan-btn')?.addEventListener('click', () => scanOneNoteComHierarchy().catch(reportOneNoteError));
find('#onenote-step-back').addEventListener('click', () => { if (!oneNoteImportBusy) showOneNoteStep(Math.max(0, oneNoteImportStep - 1)); });
find('#onenote-step-next').addEventListener('click', () => {
  if (!oneNoteSelectedPageIds.size || oneNoteImportBusy) return;
  const pages = oneNoteHierarchyState.notebooks.flatMap(notebook => notebook.sections.flatMap(section => section.pages));
  oneNoteActivePreviewPage = pages.find(page => oneNoteSelectedPageIds.has(page.id));
  showOneNoteStep(2);
  find('#onenote-com-status').textContent = desktop ? '' : '浏览器仅预览，实际迁入请使用 Windows 桌面版。';
  void renderOneNoteComPreview().catch(reportOneNoteError);
});
find('#onenote-select-all-btn')?.addEventListener('click', () => {
  if (!oneNoteHierarchyState) return;
  const allPages = oneNoteHierarchyState.notebooks.flatMap(nb => nb.sections.flatMap(s => s.pages));
  oneNoteSelectedPageIds = new Set(allPages.map(p => p.id));
  renderOneNoteHierarchyTree();
  find('#onenote-com-status').textContent = `已选 ${oneNoteSelectedPageIds.size} 页`;
  showOneNoteStep(oneNoteImportStep);
});
find('#onenote-com-file-btn')?.addEventListener('click', () => find('#onenote-com-file-input')?.click());
find('#onenote-com-file-input')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 24 * 1024 * 1024) throw new Error('导出文件超过 24 MiB，未读取。');
    const raw = await file.text();
    oneNotePageXmlCache.clear(); oneNoteArchive = null;
    if (/<(?:one:)?Notebooks\b/i.test(raw)) {
      await scanOneNoteComHierarchy(raw);
    } else if (/<(?:one:)?Page\b/i.test(raw)) {
      const pageId = '{IMPORTED-PAGE}';
      oneNotePageXmlCache.set(pageId, raw);
      const converted = convertOneNotePageXmlToMarkdown(raw, {
        notebookName: '外部导入笔记本',
        sectionName: '默认分区',
        targetRootFolder: find('#onenote-com-target-folder')?.value.trim() || 'OneNote迁入',
      });
      oneNoteHierarchyState = {
        totalNotebooks: 1,
        totalSections: 1,
        totalPages: 1,
        notebooks: [{
          id: 'nb-imported',
          name: '外部导入笔记本',
          path: file.name,
          sections: [{
            id: 'sec-imported',
            name: '默认分区',
            notebookName: '外部导入笔记本',
            pages: [{ id: pageId, name: converted.title, notebookName: '外部导入笔记本', sectionName: '默认分区', dateTime: localDate(), pageLevel: 1 }],
          }],
        }],
      };
      oneNoteSelectedPageIds = new Set([pageId]);
      oneNoteActivePreviewPage = oneNoteHierarchyState.notebooks[0].sections[0].pages[0];
      renderOneNoteHierarchyTree();
      find('#onenote-com-provider-badge').textContent = '已读取导出文件 · ' + file.name;
      find('#onenote-com-status').textContent = '已选 1 页';
      showOneNoteStep(1);
    } else {
      const converted = convertOneNoteToMarkdown(raw, {
        fileName: file.name,
        targetFolder: find('#onenote-com-target-folder')?.value.trim() || 'OneNote迁入',
      });
      oneNoteArchive = { source: raw, name: file.name };
      oneNoteActivePreviewPage = { id: 'archive-file', name: converted.title, notebookName: '导出文件', sectionName: file.name };
      oneNoteHierarchyState = { totalNotebooks: 1, totalSections: 1, totalPages: 1, notebooks: [{ name: '导出文件', sections: [{ name: file.name, pages: [oneNoteActivePreviewPage] }] }] };
      oneNoteSelectedPageIds = new Set(['archive-file']);
      renderOneNoteHierarchyTree(); showOneNoteStep(1);
      find('#onenote-com-provider-badge').textContent = '已读取导出文件 · ' + file.name;
    }
  } catch (err) {
    reportOneNoteError(err);
  } finally {
    event.target.value = '';
  }
});
find('#onenote-com-commit-btn')?.addEventListener('click', () => commitOneNoteBatchImport(find('#onenote-open-after').checked).catch(reportOneNoteError));

const fileMenu = find('#file-menu');
fileMenu.addEventListener('toggle', () => find('#file-menu-button').setAttribute('aria-expanded', String(fileMenu.open)));
fileMenu.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { fileMenu.open = false; find('#file-menu-button').focus(); return; }
  fileMenu.open = true;
  const items = [...fileMenu.querySelectorAll('.shell-menu-content button')];
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current < 0 ? 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
});
document.addEventListener('click', event => {
  for (const popMenu of document.querySelectorAll('details.ux-popover-menu[open]')) {
    if (!popMenu.contains(event.target)) popMenu.open = false;
  }
});
document.addEventListener('pointerdown', event => {
  if (!fileMenu.contains(event.target)) fileMenu.open = false;
  if (!event.target.closest('#corner-fold-wrap')) {
    const cornerMenu = find('#corner-overflow-menu');
    const cornerFold = find('#corner-fold-dewdrop');
    if (cornerMenu && !cornerMenu.hidden) {
      cornerMenu.hidden = true;
      cornerFold?.setAttribute('aria-expanded', 'false');
    }
  }
  if (!event.target.closest('#inline-property-popover, #inline-privacy-popover, #inline-status-pill, #inline-add-tag-pill, #inline-privacy-pill')) {
    hideInlinePropertyPopover();
  }
  if (event.target.closest('#inline-ai-popover')) {
    return;
  }
  if (!event.target.closest('#selection-tools')) {
    hideInlineAiPopover();
  }
  if (event.target.closest('#selection-tools')) {
    event.preventDefault();
    return;
  }
  hideSelectionTools();
  if (event.button === 0 && event.target.closest('#source-editor, #rich-editor') && isMarkdownEditorStageActive()) {
    pointerSelectingInEditor = true;
    pointerDraggedInEditor = false;
    pointerDownCoords = { x: event.clientX, y: event.clientY };
  } else {
    pointerSelectingInEditor = false;
    pointerDraggedInEditor = false;
    pointerDownCoords = null;
  }
});
document.addEventListener('pointermove', event => {
  if (!pointerSelectingInEditor || !pointerDownCoords) return;
  if (Math.hypot(event.clientX - pointerDownCoords.x, event.clientY - pointerDownCoords.y) >= 4) {
    pointerDraggedInEditor = true;
  }
});
document.addEventListener('pointerup', () => {
  if (!pointerSelectingInEditor) return;
  const dragged = pointerDraggedInEditor;
  pointerSelectingInEditor = false;
  pointerDraggedInEditor = false;
  pointerDownCoords = null;
  if (dragged) showSelectionToolsFromMouse();
});
document.addEventListener('dblclick', event => {
  if (event.target.closest('#source-editor, #rich-editor') && isMarkdownEditorStageActive()) {
    showSelectionToolsFromMouse();
  }
});
document.addEventListener('wheel', () => {
  hideSelectionTools();
  hideInlinePropertyPopover();
}, { passive: true });

find('#vault-filter-input').addEventListener('input', event => {
  vaultFilterText = event.target.value;
  renderVaultSidebar();
});

find('#vault-sort-select')?.addEventListener('change', event => {
  settings.vaultTreeSort = event.target.value;
  sidebarSignature = '';
  renderVaultSidebar();
  void call('settings', settings).catch(showError);
});

find('#quick-switcher-input').addEventListener('input', event => {
  quickSwitcherIndex = 0;
  renderQuickSwitcherList(event.target.value);
});

find('#quick-switcher-input').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const ids = quickSwitcherCategories.map(c => c[0]);
    const cur = Math.max(0, ids.indexOf(quickSwitcherCategory));
    const step = event.shiftKey ? -1 : 1;
    quickSwitcherCategory = ids[(cur + step + ids.length) % ids.length];
    quickSwitcherIndex = 0;
    renderQuickSwitcherList(event.target.value);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const btns = [...find('#quick-switcher-list').querySelectorAll('button')];
    if (!btns.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    quickSwitcherIndex = (quickSwitcherIndex + step + btns.length) % btns.length;
    renderQuickSwitcherList(event.target.value);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const target = find('#quick-switcher-list button.active') || find('#quick-switcher-list button');
    target?.click();
  }
});

document.addEventListener('keydown', event => {
  if (find('#slide-presenter-dialog')?.open) {
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      activeSlideIndex++;
      renderActiveSlide();
      return;
    }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      activeSlideIndex--;
      renderActiveSlide();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      activeSlideIndex = 0;
      renderActiveSlide();
      return;
    }
    if (event.key === 'End' && activeSlideDeck) {
      event.preventDefault();
      activeSlideIndex = activeSlideDeck.slides.length - 1;
      renderActiveSlide();
      return;
    }
  }
  if (event.target.closest('.hotkey-input, #whiteboard-stage') || event.isComposing || event.keyCode === 229) return;
  if (!find('#wikilink-suggest').hidden && suggestItems.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      suggestIndex = (suggestIndex + 1) % suggestItems.length;
      updateWikiAutocomplete();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
      updateWikiAutocomplete();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyWikiSuggestion(suggestItems[suggestIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      find('#wikilink-suggest').hidden = true;
      activeTrigger = null;
      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openQuickSwitcher();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'g') {
    event.preventDefault();
    toggleGlobalGraph();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    action('focus').catch(showError);
    return;
  }
  if (event.key === 'F1') {
    event.preventDefault();
    userGuide?.open();
    return;
  }
  if (event.target.closest('dialog, input, textarea, select') || event.isComposing) return;
  const command = commandFromEvent(event, settings.shortcuts || {});
  if (command) {
    event.preventDefault();
    event.stopPropagation();
    action(command).catch(showError);
  }
}, true);

find('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try { await dialogApply?.(); find('#edit-dialog').close(); }
  catch (error) { showError(error); }
  finally { if (submit) submit.disabled = false; }
});

function resetExportConfirmation() {
  exportImageConfirmation = null;
  find('#export-status').textContent = '';
  find('#export-submit').textContent = '导出';
  const scopeField = find('#export-wiki-scope-field');
  const fmt = find('#export-format')?.value || 'pdf';
  if (scopeField) scopeField.hidden = fmt !== 'wiki-html' && fmt !== 'epub';
}

find('#export-dialog').addEventListener('close', () => { exportController?.abort(); resetExportConfirmation(); });
find('#export-format').addEventListener('change', resetExportConfirmation);
find('#export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (exportController) return;
  exportController = new AbortController();
  const controller = exportController;
  const format = find('#export-format').value;
  // Automatically purify [[WikiLinks]] for clean export
  let text = '';
  const name = documentInfo.name;
  const path = documentInfo.path;
  find('#export-submit').disabled = true;
  find('#export-format').disabled = true;
  find('#export-status').textContent = '正在净化双链并准备完整文档...';
  try {
    if (format === 'wiki-html' || format === 'epub') {
      richEditor.flush();
      syncActiveNoteIntoVault();
      const scope = find('#export-wiki-scope')?.value || 'linked';
      const allNotes = vaultState.notes || [];
      let selectedNotes = allNotes;
      if (scope === 'folder') {
        const activeFolder = vaultGraph?.nodeMap.get(activeNoteIdentity)?.folder || '根目录';
        selectedNotes = allNotes.filter(n => (vaultGraph?.nodeMap.get(n.id)?.folder || '根目录') === activeFolder);
      } else if (scope === 'linked') {
        const linkedIds = new Set([activeNoteIdentity]);
        for (const item of vaultGraph?.backlinksByNote.get(activeNoteIdentity) || []) linkedIds.add(item.sourceId);
        for (const item of vaultGraph?.outgoingByNote.get(activeNoteIdentity) || []) {
          const tid = vaultGraph.resolveTargetId(item.target, activeNoteIdentity);
          if (tid) linkedIds.add(tid);
        }
        selectedNotes = allNotes.filter(n => linkedIds.has(n.id));
      }
      if (!selectedNotes.length) selectedNotes = [{ id: activeNoteIdentity || 'active', name: documentInfo.name, source: documentSession.source }];
      if (format === 'epub') {
        const epubPkg = compileEpub3PackageBytes(selectedNotes, {
          bookTitle: stripNumericPrefix(name) || '墨图电子书',
        });
        const result = await call('export', {
          format: 'epub',
          name: `${name.replace(/\.(md|markdown|txt)$/i, '')}`,
          data: epubPkg.base64Data,
        });
        if (result) { find('#export-dialog').close(); toast(`已打包导出包含 ${epubPkg.chapterCount} 章（${epubPkg.totalWords} 字）的 EPUB 3.0 电子书 (.epub)`); }
        else find('#export-status').textContent = '已取消导出';
        return;
      }
      const wikiHtml = compileSingleFileWikiHtml(selectedNotes, {
        activeNoteId: activeNoteIdentity,
        siteTitle: `${stripNumericPrefix(name) || '墨图知识库'} · 离线知识微站`,
        exportedAt: localDate(),
      });
      const result = await call('export', {
        format: 'html',
        name: `${name.replace(/\.(md|markdown|txt)$/i, '')}-wiki`,
        html: wikiHtml,
      });
      if (result) { find('#export-dialog').close(); toast(`已导出包含 ${selectedNotes.length} 篇笔记的单文件离线知识微站 (.html)`); }
      else find('#export-status').textContent = '已取消导出';
      return;
    }
    const expanded = expandNoteEmbeds(vaultGraph?.notes || [], documentSession.source, activeNoteIdentity, { rewriteSource: (source, note) => rebaseEmbeddedImages(source, note.path) });
    const unavailable = expanded.references.filter(reference => reference.status !== 'ready');
    if (unavailable.length) throw new Error('引用无法完整展开：' + unavailable.map(reference => (reference.path || '缺失笔记') + '#' + reference.fragment + ' (' + reference.status + ')').join('；'));
    const purified = purifyWikiLinksForExport(expanded.source); text = appearance?.exportSource(purified) || purified;
    const confirmed = exportImageConfirmation?.source === text && exportImageConfirmation.path === path && exportImageConfirmation.format === format;
    await recoveryWriter?.flush().catch(() => {});
    const { prepareExport, createWord, captureReadingTypography } = await import('../../vendor/inklet/app/src/export-document.js');
    const typography = format === 'docx' ? await captureReadingTypography(richEditor.view.dom) : undefined;
    const snapshot = await prepareExport(text, {
      title: name.replace(/\.(md|markdown|txt)$/i, ''),
      colors: settings.codeColors || {},
      typography,
      allowMissingImages: confirmed ? new Set(exportImageConfirmation.issues.map(issue => issue.path)) : false,
      signal: controller.signal,
      readAsset: assetPath => call('readAsset', { path: assetPath }),
      onProgress: (current, total) => { find('#export-status').textContent = `正在生成图片与图表 ${current}/${total}`; },
    });
    controller.signal.throwIfAborted();
    find('#export-status').textContent = '正在生成 ' + format.toUpperCase() + '...';
    const payload = format === 'docx' ? { format, name, data: await createWord(snapshot) } : { format, name, html: snapshot.html };
    controller.signal.throwIfAborted();
    const result = await call('export', payload);
    if (result) { find('#export-dialog').close(); toast('已净化双链并导出 ' + format.toUpperCase()); }
    else find('#export-status').textContent = '已取消导出';
  } catch (error) {
    if (error.name !== 'AbortError') {
      find('#export-status').textContent = error.message;
      showError(error);
    }
  } finally {
    if (exportController === controller) exportController = null;
    find('#export-submit').disabled = false;
    find('#export-format').disabled = false;
  }
});

find('#interface-family-input').addEventListener('change', event => {
  const nextTheme = Object.keys(interfaceThemes).find(key => interfaceThemes[key].family === event.target.value);
  if (nextTheme) syncInterfaceTheme(nextTheme);
});
for (const input of document.querySelectorAll('[data-paper-family]')) {
  input.addEventListener('change', event => {
    if (appearance) { appearance.preview = null; settings.appearance = { ...appearance.savedConfig(), activeTheme: null }; }
    settings[input.dataset.paperFamily] = Object.keys(themes).find(key => themes[key].family === event.target.value);
    applySettings();
  });
}
find('#font-input').addEventListener('input', event => { settings.fontSize = Number(event.target.value); applySettings(); });
find('#outline-side-input').addEventListener('change', event => { settings.outlineSide = event.target.value; applySettings(); });
find('#reading-font-input').addEventListener('change', event => { settings.readingFont = event.target.value; applySettings(); });
find('#line-height-input').addEventListener('input', event => { settings.lineHeight = Number(event.target.value); applySettings(); });
find('#paragraph-gap-input').addEventListener('input', event => { settings.paragraphGap = Number(event.target.value); applySettings(); });
find('#reading-width-input').addEventListener('input', event => { settings.readingWidth = Number(event.target.value); applySettings(); });
find('#paper-input').addEventListener('change', event => { settings.paperTexture = event.target.checked; applySettings(); });
find('#opacity-input').addEventListener('input', event => { settings.opacity = Number(event.target.value) / 100; applySettings(); });
find('#sync-input').addEventListener('change', event => { settings.syncScroll = event.target.checked; applySettings(); });
find('#restore-reading-input').addEventListener('change', event => { settings.restoreReadingPosition = event.target.checked; applySettings(); });
find('#search-results-input').addEventListener('change', event => { settings.searchResults = event.target.checked; applySettings(); });
find('#ctrl-wheel-input').addEventListener('change', event => { settings.ctrlWheelZoom = event.target.checked; applySettings(); });
find('#compress-input').addEventListener('change', event => { settings.compress = event.target.checked; applySettings(); });
find('#embed-images-input').addEventListener('change', event => {
  const enabled = event.target.checked; event.target.checked = settings.embedImages;
  if (enabled && !settings.embedImages) { find('#embed-warning-dialog').returnValue = ''; find('#embed-warning-dialog').showModal(); }
  else { settings.embedImages = false; applySettings(); }
});
find('#embed-warning-dialog').addEventListener('close', () => { if (find('#embed-warning-dialog').returnValue === 'enable') settings.embedImages = true; applySettings(); });
find('#image-input').addEventListener('change', async event => { try { await importImages([...event.target.files]); } catch (error) { showError(error); } finally { event.target.value = ''; } });
find('#code-color-language').addEventListener('change', event => { codeColorScope = event.target.value; applySettings(false); });
for (const input of document.querySelectorAll('[data-code-color]')) input.addEventListener('input', () => { settings.codeColors = { ...settings.codeColors, [codeColorScope]: { ...settings.codeColors?.[codeColorScope], [input.dataset.codeColor]: input.value } }; applySettings(); });
find('#workspace').addEventListener('wheel', event => { if (event.ctrlKey && event.deltaY && settings.ctrlWheelZoom !== false) { event.preventDefault(); action(event.deltaY < 0 ? 'zoom-in' : 'zoom-out').catch(showError); } }, { passive: false });
find('#search-input').addEventListener('input', scheduleSearch);
find('#search-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); }
  if (event.key === 'Escape') toggleSearch(false);
});
find('#case-toggle').addEventListener('click', event => {
  const target = event.currentTarget;
  target.setAttribute('aria-pressed', String(target.getAttribute('aria-pressed') !== 'true'));
  scheduleSearch();
});

find('#splitter').addEventListener('pointerdown', event => {
  event.preventDefault();
  const splitter = event.currentTarget;
  splitter.setPointerCapture(event.pointerId);
  const move = pointer => {
    const bounds = find('#workspace').getBoundingClientRect();
    const ratio = Math.max(0.25, Math.min(0.75, (pointer.clientX - bounds.left) / bounds.width));
    find('#workspace').style.setProperty('--split', ratio * 100 + '%');
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', () => splitter.removeEventListener('pointermove', move), { once: true });
});

async function closeSafely() {
  if (saving || workspaceBusy || vaultMutationBusy || composing || find('dialog[open]')) { await call('cancelClose'); return; }
  richEditor.flush(); captureDocumentState();
  const modified = [...workspace.entries.values()].filter(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty);
  if (!modified.length) { await call('finishClose'); return; }
  const dialog = find('#edit-dialog');
  resetEditDialogFooter('保存并退出');
  find('#edit-title').textContent = '关闭前保存修改';
  find('#edit-content').replaceChildren();
  const hint = document.createElement('p');
  hint.style.color = 'var(--ui-muted)';
  hint.textContent = '以下笔记存在未保存的草稿修改，您可以选择保存后退出、不保存直接退出或取消留在当前页面：';
  const text = document.createElement('p');
  text.style.fontWeight = '600';
  text.textContent = modified.map(entry => entry.info.name).join('、');
  find('#edit-content').append(hint, text);
  const discardBtn = find('#edit-discard-btn');
  if (discardBtn) {
    discardBtn.hidden = false;
    discardBtn.textContent = '不保存直接退出';
    discardBtn.onclick = async () => {
      try {
        if (dirty()) await discardActiveNoteChanges();
        for (const entry of modified) {
          entry.dirty = false;
          if (entry.state) entry.state.savedRevision = entry.state.session.revision;
        }
        dialog.close();
        await call('finishClose', { discard: true });
      } catch (error) {
        showError(error);
      }
    };
  }
  dialogApply = async () => {
    for (const entry of modified) if (!await switchDocument(entry.id, true) || !await save()) throw new Error('保存未完成，窗口保留。');
    await call('finishClose');
  };
  dialog.addEventListener('close', () => call('cancelClose').catch(() => {}), { once: true }); dialog.showModal();
}
window.addEventListener('inkloom:closeWorkspace', () => closeSafely().catch(showError));
window.addEventListener('inkloom:vaultChanged', event => { refreshPending = true; if (event.detail?.rescanRequired) refreshExternalVault(true).catch(showError); else refreshExternalVault().catch(showError); });
const refreshTimer = setInterval(() => { if (refreshPending) refreshExternalVault().catch(showError); }, 1000);
window.addEventListener('pagehide', () => { speechReader?.dispose(); clearInterval(refreshTimer); vaultIndex.dispose(); workbench?.dispose(); }, { once: true });
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; });
window.addEventListener('beforeunload', event => {
  captureDocumentState();
  if (!desktop && [...workspace.entries.values()].some(entry => entry.state ? entry.state.session.revision !== entry.state.savedRevision : entry.dirty)) { event.preventDefault(); event.returnValue = ''; }
});

appearance = new WorkspaceAppearance({
  settings: () => settings, vault: () => vaultState,
  activeNote: () => vaultGraph?.nodeMap.get(activeNoteIdentity), noteById: id => vaultGraph?.nodeMap.get(id),
  refresh: () => applySettings(false),
  save: async next => {
    const previous = settings; settings = { ...settings, appearance: next };
    try { await call('settings', settings); }
    catch (error) { settings = previous; applySettings(false); throw error; }
  },
});
applySettings(false);
updateStatus();
updateNavigation();
setNavigationTab('vault');
searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });

Promise.resolve(startupState).then(async response => {
  if (response.settings) settings = { ...settings, ...response.settings };
  if (response.vault && Array.isArray(response.vault.notes) && response.vault.notes.length) {
    vaultState = response.vault;
  }
  applySettings(false);
  await rebuildVaultGraph();
  phaseTwo = mountPhaseTwo({
    appearance, activeNote: () => vaultGraph?.nodeMap.get(activeNoteIdentity),
    exportAppearance: async (pack, name) => {
      if (desktop) return call('exportAppearance', { name, json: JSON.stringify(pack, null, 2) });
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
    },
    desktop, openVault: openManagedVault, rescan: () => refreshExternalVault(true),
    workspacePreferences: () => desktop ? call('vaultWorkspacePreferences') : Promise.resolve({ recentVaults: [], startupMode: 'first' }),
    taskDiagnostics: () => vaultIndex.queries.diagnostics(), cancelQueries: () => vaultIndex.queries.cancelAll('用户取消后台读取'),
    runtimeMetrics: () => desktop ? call('runtimeMetrics') : Promise.resolve(null),
    setStartup: (mode, noteId) => call('setVaultStartup', { mode, noteId }),
    forgetRecent: path => call('forgetRecentVault', { path }),
    exportIdentity: path => call('exportVaultIdentity', { path }), previewIdentity: path => call('previewVaultIdentity', { path }),
    importIdentity: async token => {
      if (vaultMutationBusy || saving || workspaceBusy) throw new Error('请先完成当前操作');
      requireCleanWorkspace(); vaultMutationBusy = true; find('#workspace').inert = true;
      try {
        const result = await call('importVaultIdentity', { token }); vaultState = result.vault;
        for (const entry of workspace.entries.values()) {
          const note = vaultState.notes.find(note => note.path?.toLowerCase() === entry.info.path?.toLowerCase());
          if (note) { entry.info.noteId = note.id; if (entry.state) entry.state.info.noteId = note.id; }
        }
        activeNoteIdentity = vaultState.notes.find(note => note.path?.toLowerCase() === documentInfo.path?.toLowerCase())?.id || null; documentInfo.noteId = activeNoteIdentity;
        await rebuildVaultGraph(true); return result.imported;
      } finally { vaultMutationBusy = false; find('#workspace').inert = closingWorkspace; }
    },
    listRecovery: query => desktop ? call('listVaultRecovery', query) : Promise.resolve({ items: [], total: 0 }),
    previewRecovery: id => call('previewVaultRecovery', { id }), restoreRecovery: restoreManagedRecovery,
    openRecoveryDirectory: id => call('openRecoveryDirectory', { id }),
    get settings() { return settings; }, get graph() { return vaultGraph; }, get vault() { return vaultState; },
    get viewOpen() { return Boolean(workbench?.activeTarget); },
    get activeId() { return activeNoteIdentity; }, get source() { return documentSession.source; }, get cursor() { return selection.from; },
    get editorFocused() { return sourceEditor.view.hasFocus || richEditor.view.hasFocus(); },
    get anchor() { return activePane === 'source' ? sourceEditor.anchor : richEditor.anchor; },
    error: showError, hideGraph: () => toggleGlobalGraph(false), openNote: openVaultNoteById, viewChanged: () => workbench?.refresh(),
    changeSettings: patch => { settings = { ...settings, ...patch }; applySettings(); },
    updateProperties: updateNoteProperties, rename: renameNote,
    edit: (change, cursor) => { changeDocument(change, 'command'); richEditor.flush(); selection = { from: cursor, to: cursor }; if (activePane === 'source') { sourceEditor.reveal(cursor); sourceEditor.focus(); } else { richEditor.reveal(cursor); richEditor.focus(); } },
    showEdit: (title, apply) => { resetEditDialogFooter('确定'); find('#edit-title').textContent = title; dialogApply = apply; find('#edit-dialog').showModal(); },
  });
  speechReader = mountSpeechReader({
    desktop, call, editor: richEditor, toast,
    getDocument: () => ({ id: recoveryDocumentId, revision: documentSession.revision, source: documentSession.source }),
    getSelection: () => ({ ...selection }), getConfig: () => settings.speech,
    saveConfig: async speech => {
      const previous = settings.speech; settings.speech = speech;
      try { await call('settings', settings); }
      catch (error) { settings.speech = previous; throw error; }
    },
  });
  workbench = await mountWorkbench({
    settings: () => settings,
    decorateIcons: () => appearance?.applyIcons(),
    contextContainer: find('#context-plugin-slot'), contextVisible: () => sidebarVisible('right'),
    changeSettings: async patch => {
      const previous = settings; const next = { ...settings, ...patch }; settings = next; applySettings(false);
      try { await call('settings', settings); } catch (error) { if (settings === next) { settings = previous; applySettings(false); } throw error; }
    },
    query: (query = {}) => vaultGraph.notes.filter(note => !query.orphan || note.orphan).slice(0, Math.min(250, Math.max(1, query.limit || 100))).map(note => ({ id: note.id, title: note.title, folder: note.folder, tags: note.tags, degree: note.degree, version: vaultState.notes.find(raw => raw.id === note.id)?.hash || '' })),
    queryAsync: (query, runtime) => vaultIndex.query('notes', query, runtime),
    queryDatabase: (query, runtime) => vaultIndex.query('database', query, runtime),
    updateProperties: updatePluginProperties,
    promoteEdge: async (sourceId, targetId, reason = '') => {
      if (vaultMutationBusy || saving || workspaceBusy || composing) throw new Error('请先完成当前编辑操作');
      richEditor.flush();
      const sourceNote = vaultState.notes.find(n => n.id === sourceId);
      const targetNode = vaultGraph?.nodeMap.get(targetId);
      if (!sourceNote || !targetNode?.exists) throw new Error('目标笔记不存在');
      const targetClean = stripNumericPrefix(targetNode.cleanTitle || targetNode.title || targetNode.name);
      const linkToken = `[[${targetClean}]]`;
      if ((sourceNote.source || '').includes(linkToken)) {
        return { promoted: false, alreadyLinked: true };
      }
      const lineToAppend = `\n\n- 关联脉络：${linkToken}${reason ? `（${reason}）` : ''}\n`;
      const nextSource = String(sourceNote.source || '').trimEnd() + lineToAppend;
      const version = await digest(sourceNote.source || '');
      await writePluginNote(sourceId, version, nextSource);
      toast(`已采纳关系并写入双链：${stripNumericPrefix(sourceNote.name)} → ${linkToken}`);
      return { promoted: true, sourceId, targetId, targetTitle: targetClean };
    },
    queryGraph: (query, runtime) => vaultIndex.query('graph', { ...query, activeId: activeNoteIdentity }, runtime),
    queryWorkspace: (query, runtime) => vaultIndex.query('workspace', query, runtime),
    queryAi: async (query = {}, runtime) => {
      const selText = selection.to > selection.from ? documentSession.source.slice(selection.from, selection.to) : '';
      const scope = query.scope ? { ...query.scope, selectionText: query.scope.selectionText ?? selText } : { kind: 'vault', activeNoteId: activeNoteIdentity, selectionText: selText };
      let extra = {};
      if (query.subkind === 'karpathy-compiler' && !Array.isArray(query.rawFiles)) {
        const scanned = await call('scanRawFiles').catch(() => ({ rawFiles: [] }));
        const parsedRawFiles = [];
        for (const rf of scanned?.rawFiles || []) {
          parsedRawFiles.push(await parseRawDocumentFile(rf));
        }
        extra = { rawFiles: parsedRawFiles };
      }
      return vaultIndex.query('ai', { ...query, ...extra, scope }, runtime);
    },
    aiConfig: (action, payload = {}) => {
      if (action === 'save') return call('aiSaveSecret', payload);
      if (action === 'local-status') return call('aiLocalLlmStatus', payload);
      if (action === 'local-start') return call('aiStartLocalLlm', payload);
      if (action === 'local-stop') return call('aiStopLocalLlm', payload);
      if (action === 'scan-raw') return call('scanRawFiles', payload);
      if (action === 'list-reading-docs') return call('listReadingDocuments', payload);
      if (action === 'read-raw') return call('readRawFile', payload);
      if (action === 'import-raw') return call('importRawFile', payload);
      if (action === 'reveal-raw') return revealVaultItemInExplorer({ relativePath: 'raw', isFolder: true });
      return call('aiSecretStatus');
    },
    aiComplete: payload => call('aiCompleteHttp', payload),
    createNote: createPluginNote,
    read: (id, runtime) => vaultIndex.query('read', { id }, runtime),
    write: writePluginNote,
    activeDocument: () => activeNoteIdentity ? { id: activeNoteIdentity, source: documentSession.source, revision: documentSession.revision, dirty: dirty(), name: documentInfo.name, selection: selection.to > selection.from ? documentSession.source.slice(selection.from, selection.to) : '' } : null,
    updateActiveDocument: (id, revision, source) => {
      if (id !== activeNoteIdentity || revision !== documentSession.revision || vaultMutationBusy || saving || workspaceBusy || composing || closingWorkspace) throw new Error('当前文档已变化或正在处理，请重新载入后再编辑');
      changeDocument(minimalChange(documentSession.source, source), 'command'); return { id, revision: documentSession.revision, dirty: dirty() };
    },
    saveActiveDocument: async id => { if (id !== activeNoteIdentity) throw new Error('当前文档已切换'); const saved = await save(); return { id, saved, revision: documentSession.revision, dirty: dirty() }; },
    open: openVaultNoteById,
    openLink: async link => {
      if (typeof link === 'string' && link.startsWith('#inkloom-reader?')) {
        const loc = parseDocumentSourceLink(link);
        if (!loc) throw new Error('原件定位链接无效');
        window.__inkloomPendingReaderTarget = loc;
        window.__inkloomPendingSubTab = { viewId: 'research-desk:research-view', subKey: 'reader' };
        await workbench?.openViewById('research-desk:research-view');
        window.dispatchEvent(new CustomEvent('inkloom:research-open-reader', { detail: loc }));
        return true;
      }
      if (!link.startsWith('[[')) return call('external', { url: link });
      const reference = parseWikiLinkBody(link.slice(2, -2)); const id = reference.target ? vaultGraph.resolveTargetId(reference.target, activeNoteIdentity) : activeNoteIdentity;
      if (!id || !vaultGraph.nodeMap.get(id)?.exists) throw new Error('笔记引用不存在或不唯一');
      if (!await openVaultNoteById(id, reference.heading)) throw new Error('笔记尚未打开');
    },
    refreshVault: () => refreshExternalVault(true),
    failure: showError,
    shortcutInUse: value => ['Ctrl+K', 'Ctrl+G', ...shortcutCommands.map(command => shortcutFor(command, settings.shortcuts || {}))].includes(value),
    activeView: () => workbench?.activeTarget || (sidebarVisible('left') ? navigationTab : 'write'),
    navigate: async target => {
      if (['vault', 'tags', 'starred', 'outline'].includes(target)) {
        const editorWasHidden = Boolean(find('#editor-stage')?.hidden);
        const visible = editorWasHidden ? true : !(sidebarVisible('left') && navigationTab === target);
        toggleGlobalGraph(false);
        setNavigationTab(target);
        toggleSidebar('left', visible);
      }
      else if (target === 'graph') toggleGlobalGraph();
      else if (target === 'database') await workbench.openDatabase();
      else if (target === 'daily') await action('daily-note');
      else if (target === 'periodic:weekly') await openOrCreatePeriodicNote('weekly');
      else if (target === 'periodic:monthly') await openOrCreatePeriodicNote('monthly');
      else if (target === 'periodic:quarterly') await openOrCreatePeriodicNote('quarterly');
      else if (target === 'search') openQuickSwitcher();
      else if (target === 'write') toggleGlobalGraph(false);
      else throw new Error('未知工作台视图');
    },
  });
  userGuide = mountUserGuide({
    insertSnippet: text => { toggleGlobalGraph(false); insert(text); },
    openView: viewId => workbench?.openViewById(viewId).catch(showError),
  });
  await initializeReadingPosition(!startupSession && !startupDocument.restored);
  if (response.windows) {
    multiWindowState.windowId = response.windowId || multiWindowState.windowId;
    multiWindowState.isSecondary = Boolean(response.isSecondary);
    multiWindowState.activeWindowCount = Number(response.activeWindowCount) || 1;
    multiWindowState.windows = response.windows;
    updateMultiWindowBadge();
  }
  const bootSecondarySpec = parseSecondaryWindowUrl(window.location?.href || '');
  if (bootSecondarySpec.isSecondary) {
    if (bootSecondarySpec.targetType === 'graph') {
      toggleGlobalGraph(true);
    } else if (bootSecondarySpec.targetType === 'reader') {
      window.__inkloomPendingReaderTarget = {
        relativePath: bootSecondarySpec.relativePath || 'raw/智能制造与双链溯源规范.pdf',
        page: bootSecondarySpec.readerPage || 1,
        cfi: bootSecondarySpec.readerCfi || undefined,
      };
      window.__inkloomPendingSubTab = { viewId: 'research-desk:research-view', subKey: 'reader' };
      await workbench?.openViewById('research-desk:research-view');
    } else if (bootSecondarySpec.targetType === 'whiteboard') {
      await workbench?.openViewById('whiteboard-studio:whiteboard-view');
    } else if (bootSecondarySpec.targetId && vaultGraph?.nodeMap.get(bootSecondarySpec.targetId)?.exists) {
      await openVaultNoteById(bootSecondarySpec.targetId);
    }
  } else if (!startupSession && settings.pluginSettings?.['workspace-home']?.['open-on-start'] && workbench.host.plugins.get('workspace-home')?.state === 'enabled') {
    await workbench.openHome();
  }
  if (desktop) await call('ready');
  performance.mark('inkloom-ready');
  if (startupError) showError(startupError);
}).catch(showError);

if (__INKLOOM_TEST__) window.inkloomTest = {
  get vaultGraph() { return vaultGraph; },
  get vaultState() { return vaultState; },
  get activeNoteId() { return activeNoteIdentity; },
  get source() { return documentSession.source; },
  get settings() { return settings; },
  get sourceEditor() { return sourceEditor; },
  get richEditor() { return richEditor; },
  get workspace() { return workspace; },
  get pluginHost() { return workbench?.host; },
  openNote: (id, heading) => openVaultNoteById(id, heading),
  createNote: (title, folder) => createAndOpenVaultNote(title, folder),
  toggleGlobalGraph: show => toggleGlobalGraph(show),
  convertMention: idx => convertUnlinkedMentionToWikiLink(idx),
  purifyForExport: text => purifyWikiLinksForExport(text ?? documentSession.source),
  setTheme: (interfaceTheme, rightTheme) => {
    if (interfaceTheme) settings.interfaceTheme = interfaceTheme;
    if (rightTheme) settings.rightTheme = rightTheme;
    applySettings(false);
  },
  updateProperties: updateNoteProperties,
  rename: renameNote,
  save: () => save(),
  invoke: call,
  select: (from, to, pane = 'source') => { activePane = pane; selection = { from, to }; if (pane === 'source') { sourceEditor.reveal(from, to); sourceEditor.focus(); } else { richEditor.reveal(from, to); richEditor.focus(); } },
  triggerAutocomplete: (text, pos) => {
    changeDocument({ from: 0, to: documentSession.source.length, insert: text }, 'source');
    setSelection(pos, pos);
  },
};
if (__INKLOOM_TEST__) window.inkletTest = window.inkloomTest;
