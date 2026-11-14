import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseWikiLinkBody, parseFrontMatter, nonCodeLineRanges, localDate } from '../../core/vault-graph.mjs';
import { SLASH_AI_COMMANDS, SMART_NOTE_TEMPLATES, generateSlashAiDraft, renderSmartTemplate } from '../../core/in-place-copilot.mjs';

const calloutLabels = {
  NOTE: '笔记提示 (NOTE)',
  TIP: '灵感技巧 (TIP)',
  IMPORTANT: '重要说明 (IMPORTANT)',
  WARNING: '注意提醒 (WARNING)',
  CAUTION: '风险警示 (CAUTION)',
};

export function wikiLinkRangesInDoc(doc, resolveTarget, calloutStyle = 'soft', embedView, version = 0) {
  const decorations = [];
  let embedCount = 0;
  const sharedBudget = { embeds: 0, characters: 0 };
  doc.descendants((node, position) => {
    if (node.type.name === 'blockquote') {
      const firstChild = node.firstChild;
      if (firstChild && firstChild.isTextblock) {
        let header = ''; let ended = false;
        firstChild.forEach(child => { if (child.type.name === 'hard_break') ended = true; if (!ended && child.isText) header += child.text; });
        const match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n]+))?/i.exec(header);
        if (match) {
          const kind = match[1].toUpperCase();
          decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: `inkloom-callout callout-${kind.toLowerCase()} callout-style-${calloutStyle}`,
            'data-callout': kind,
            'data-callout-label': match[2]?.trim() || calloutLabels[kind] || kind,
          }));
          decorations.push(Decoration.inline(position + 2, position + 2 + match[0].length, { class: 'callout-marker' }));
        }
      }
    }
    if (node.type.spec.code || node.type.name === 'code_block' || node.type.name === 'front_matter') return false;
    if (!node.isTextblock) return;
    let text = '';
    let start = 0;
    const isHeading = node.type.name === 'heading';
    const flush = () => {
      if (!text) return;
      for (const match of text.matchAll(/(!?)\[\[([^\][\n]+?)\]\]/g)) {
        const from = start + match.index;
        const to = from + match[0].length;
        const parsed = parseWikiLinkBody(match[2]);
        if (!parsed.target && !parsed.heading) continue;
        const resolved = resolveTarget ? resolveTarget(parsed.target, parsed.heading) : { exists: true };
        if (match[1] === '!' && embedView && ++embedCount <= 24) {
          const isInline = node.textContent.trim() !== match[0];
          decorations.push(Decoration.widget(position + node.nodeSize, () => embedView(parsed, sharedBudget, { inline: isInline }), { side: 1, key: 'embed-' + position + '-' + from + '-' + version + '-' + match[0], ignoreSelection: true, stopEvent: () => true }));
        }
        decorations.push(Decoration.inline(from, to, {
          nodeName: 'span',
          class: 'wikilink-token' + (resolved?.exists === false ? ' is-ghost' : '') + (match[1] === '!' ? ' is-embed' : ''),
          'data-wikilink-target': parsed.target,
          'data-wikilink-heading': parsed.heading,
          'data-wikilink-alias': parsed.alias,
          'data-wikilink-display': parsed.display,
          'data-wikilink-ghost': String(resolved?.exists === false),
          role: 'link',
          tabindex: '0',
          title: resolved?.exists === false
            ? `待建笔记：${parsed.display}（点击创建）`
            : `跳转到双链笔记：${parsed.display}`,
        }));
      }
      if (!isHeading) {
        const masked = text.replace(/https?:\/\/[^\s)]+/g, m => ' '.repeat(m.length));
        for (const match of masked.matchAll(/(?:^|[\s([\u3000，。；：、「『【])(#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*))/gu)) {
          const tag = match[2];
          if (/^[0-9a-fA-F]{3,8}$/.test(tag) || /^\d+$/.test(tag)) continue;
          const prefixLen = match[0].length - match[1].length;
          const from = start + match.index + prefixLen;
          const to = from + match[1].length;
          decorations.push(Decoration.inline(from, to, {
            nodeName: 'span',
            class: 'inline-tag-token',
            'data-inline-tag': tag,
            role: 'button',
            tabindex: '0',
            title: `按标签筛选 #${tag}`,
          }));
        }
      }
      text = '';
    };
    node.forEach((child, offset) => {
      if (!child.isText || child.marks.some(mark => mark.type.spec.code || ['code', 'link'].includes(mark.type.name))) {
        flush();
        return;
      }
      if (!text) start = position + 1 + offset;
      text += child.text;
    });
    flush();
    return false;
  });
  return decorations;
}

export function wikiLinkPlugin({ resolveTarget, getCalloutStyle, onFollowLink, onHoverLink, onLeaveLink, onClickTag, embedView }) {
  let cachedDoc = null;
  let cachedVersion = -1;
  let cachedStyle = '';
  let decorations = DecorationSet.empty;

  const rebuild = (doc, version = 0, style = 'soft') => {
    if (cachedDoc === doc && cachedVersion === version && cachedStyle === style) return;
    cachedDoc = doc;
    cachedVersion = version;
    cachedStyle = style;
    decorations = DecorationSet.create(doc, wikiLinkRangesInDoc(doc, resolveTarget, style, embedView, version));
  };

  const activate = (view, event) => {
    const wiki = event.target.closest?.('[data-wikilink-target],[data-wikilink-heading]');
    if (wiki && view.dom.contains(wiki)) {
      event.preventDefault();
      event.stopPropagation();
      onFollowLink?.({
        target: wiki.dataset.wikilinkTarget || '',
        heading: wiki.dataset.wikilinkHeading || '',
        alias: wiki.dataset.wikilinkAlias || '',
        display: wiki.dataset.wikilinkDisplay || '',
        ghost: wiki.dataset.wikilinkGhost === 'true',
      });
      return true;
    }
    const tagEl = event.target.closest?.('[data-inline-tag]');
    if (tagEl && view.dom.contains(tagEl)) {
      event.preventDefault();
      event.stopPropagation();
      onClickTag?.(tagEl.dataset.inlineTag);
      return true;
    }
    return false;
  };

  return new Plugin({
    props: {
      decorations(state) {
        const graphVersion = resolveTarget?.version?.() ?? 0;
        const style = getCalloutStyle?.() || 'soft';
        rebuild(state.doc, graphVersion, style);
        return decorations;
      },
      handleDOMEvents: {
        click(view, event) {
          return event.button === 0 ? activate(view, event) : false;
        },
        keydown(view, event) {
          return ['Enter', ' '].includes(event.key) ? activate(view, event) : false;
        },
        mouseover(view, event) {
          const wiki = event.target.closest?.('[data-wikilink-target],[data-wikilink-heading]');
          if (!wiki || !view.dom.contains(wiki)) return false;
          const rect = wiki.getBoundingClientRect();
          onHoverLink?.({
            target: wiki.dataset.wikilinkTarget || '',
            heading: wiki.dataset.wikilinkHeading || '',
            display: wiki.dataset.wikilinkDisplay || '',
            ghost: wiki.dataset.wikilinkGhost === 'true',
            rect,
          });
          return false;
        },
        mouseout(view, event) {
          const wiki = event.target.closest?.('[data-wikilink-target],[data-wikilink-heading]');
          if (wiki && !wiki.contains(event.relatedTarget)) onLeaveLink?.();
          return false;
        },
      },
    },
  });
}

export function detectWikiLinkTrigger(sourceText = '', cursorOffset = 0) {
  if (!Number.isInteger(cursorOffset) || cursorOffset < 2) return null;
  const lineStart = sourceText.lastIndexOf('\n', cursorOffset - 1) + 1;
  const beforeCursor = sourceText.slice(lineStart, cursorOffset);
  const openIdx = beforeCursor.lastIndexOf('[[');
  if (openIdx < 0) return null;
  const afterOpen = beforeCursor.slice(openIdx + 2);
  if (afterOpen.includes(']]') || afterOpen.includes('\n')) return null;
  const lineEndIdx = sourceText.indexOf('\n', cursorOffset);
  const afterCursor = sourceText.slice(cursorOffset, lineEndIdx < 0 ? sourceText.length : lineEndIdx);
  const closeMatch = /^\s*\]\]/.exec(afterCursor);
  return {
    from: lineStart + openIdx + 2,
    to: cursorOffset + (closeMatch ? closeMatch[0].length : 0),
    query: afterOpen,
  };
}

export const SLASH_COMMANDS = [
  { id: 'callout-note', label: '提示块', keywords: 'callout note 提示 备注', subtitle: '', template: '> [!NOTE]\n> ' },
  { id: 'callout-tip', label: '建议块', keywords: 'callout tip 灵感 技巧 建议', subtitle: '', template: '> [!TIP]\n> ' },
  { id: 'callout-warning', label: '警告块', keywords: 'callout warning 注意 警告 边界', subtitle: '', template: '> [!WARNING]\n> ' },
  { id: 'callout-important', label: '重要提示', keywords: 'callout important 重要', subtitle: '', template: '> [!IMPORTANT]\n> ' },
  { id: 'callout-caution', label: '风险提示', keywords: 'callout caution 风险', subtitle: '', template: '> [!CAUTION]\n> ' },
  { id: 'wikilink', label: '笔记链接', keywords: 'wikilink link 双链 引用 关联', subtitle: '', template: '[[' },
  { id: 'h2', label: 'H2 二级章节标题', keywords: 'h2 heading 标题 二级', subtitle: '插入 ## 章节标题', template: '\n## 二级章节标题\n' },
  { id: 'h3', label: 'H3 三级小节标题', keywords: 'h3 heading 标题 三级', subtitle: '插入 ### 小节标题', template: '\n### 三级小节标题\n' },
  { id: 'table', label: '📊 三列表格 (Table)', keywords: 'table 表格 数据', subtitle: '快速插入 3×3 标准 Markdown 表格', template: '\n| 维度 | 核心要点 | 备注说明 |\n| --- | --- | --- |\n| 示例项 A | 内容描述 | 关联说明 |\n| 示例项 B | 内容描述 | 关联说明 |\n' },
  { id: 'mermaid', label: '🕸️ Mermaid 思维流程图', keywords: 'mermaid diagram 流程图 图表', subtitle: '插入可缩放预览的流程图代码块', template: '\n```mermaid\nflowchart LR\n  A[灵感落笔] --> B[双链连接]\n  B --> C[万象成图]\n```\n' },
  { id: 'math', label: '∑ LaTeX 数学公式块', keywords: 'math latex 公式 数学', subtitle: '插入独立居中数学公式 $$...$$', template: '\n$$\nR(v) = R_0 + \\alpha \\cdot \\ln(1 + \\deg(v))\n$$\n' },
  { id: 'code', label: '💻 高亮代码块 (Code Block)', keywords: 'code 代码 脚本', subtitle: '插入带语法高亮的代码块', template: '\n```javascript\n// 在此编写代码\nconsole.log("Inkloom 墨图");\n```\n' },
  { id: 'date', label: '今日日期', keywords: 'date today 日期 今日 时间', subtitle: '', dynamicTemplate: () => localDate() + ' ' },
  ...SLASH_AI_COMMANDS.map(cmd => ({
    id: cmd.id,
    label: cmd.label,
    keywords: cmd.keywords,
    subtitle: cmd.subtitle,
    aiCommand: cmd.id,
    dynamicContextTemplate: ctx => generateSlashAiDraft(cmd.id, ctx),
  })),
  ...SMART_NOTE_TEMPLATES.map(tpl => ({
    id: 'template-' + tpl.id,
    label: `📄 模板 · ${tpl.name}`,
    keywords: `template 模板 ${tpl.name} ${tpl.category} ${tpl.tags.join(' ')}`,
    subtitle: tpl.description,
    dynamicContextTemplate: ctx => {
      const rendered = renderSmartTemplate(tpl.id, { title: ctx?.noteTitle || tpl.name });
      const fm = parseFrontMatter(rendered.source);
      return rendered.source.slice(fm.bodyFrom).trim();
    },
  })),
];

export function detectSlashTrigger(sourceText = '', cursorOffset = 0, enabled = true) {
  if (!enabled || !Number.isInteger(cursorOffset) || cursorOffset < 1) return null;
  const lineStart = sourceText.lastIndexOf('\n', cursorOffset - 1) + 1;
  const beforeCursor = sourceText.slice(lineStart, cursorOffset);
  const match = /^( {0,3})(\/([\p{L}\p{N}_-]{0,20}))$/u.exec(beforeCursor);
  if (!match) return null;
  const frontmatter = parseFrontMatter(sourceText);
  if (cursorOffset < frontmatter.bodyFrom || !nonCodeLineRanges(sourceText, frontmatter.bodyFrom).some(line => line.from === lineStart)) return null;
  const slashFrom = lineStart + match[1].length;
  return {
    from: slashFrom,
    to: cursorOffset,
    query: (match[3] || '').toLowerCase(),
  };
}

export function filterSlashCommands(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(item =>
    item.label.toLowerCase().includes(q) ||
    item.keywords.toLowerCase().includes(q) ||
    item.subtitle.toLowerCase().includes(q)
  );
}

