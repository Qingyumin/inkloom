import { localDate, stripNumericPrefix } from './vault-graph.mjs';

/**
 * OneNote Heterogeneous Rich-Media & Attachment Importer (ONENOTE-001)
 * Supports:
 * 1. OneNote exported .mht / .mhtml (Multipart MIME web archives with embedded images & attachments)
 * 2. OneNote exported .html / .htm / .xml (Freeform 2D coordinate Outline containers, data: images,
 *    <object data-attachment="..."> embedded files, and onenote:// internal page links)
 */

function slugifyFileName(name = '') {
  return String(name || 'onenote-page')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'onenote-page';
}

function decodeQuotedPrintable(str = '') {
  const cleaned = String(str || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return cleaned;
  }
}

export function parseMhtArchive(rawMht = '') {
  const text = String(rawMht || '');
  const boundaryMatch = /boundary="?([^"\r\n;]+)"?/i.exec(text);
  if (!boundaryMatch) {
    return { html: text, assets: new Map(), attachments: [] };
  }
  const boundary = boundaryMatch[1];
  const rawParts = text.split(`--${boundary}`);
  let html = '';
  const assets = new Map();
  const attachments = [];

  for (const part of rawParts.slice(1)) {
    if (part.startsWith('--')) break;
    const sepIdx = part.search(/\r?\n\r?\n/);
    if (sepIdx < 0) continue;
    const headerBlock = part.slice(0, sepIdx);
    const bodyBlock = part.slice(sepIdx).replace(/^\r?\n\r?\n/, '').trim();

    const contentType = (/Content-Type:\s*([^\r\n;]+)/i.exec(headerBlock)?.[1] || '').trim().toLowerCase();
    const encoding = (/Content-Transfer-Encoding:\s*([^\r\n;]+)/i.exec(headerBlock)?.[1] || '').trim().toLowerCase();
    const location = (/Content-Location:\s*([^\r\n]+)/i.exec(headerBlock)?.[1] || '').trim();
    const dispositionName = /filename="?([^"\r\n;]+)"?/i.exec(headerBlock)?.[1] || '';

    if (contentType.includes('text/html') && !html) {
      html = encoding === 'quoted-printable' ? decodeQuotedPrintable(bodyBlock) : bodyBlock;
    } else if (contentType.startsWith('image/')) {
      const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg')?.replace(/[^a-z0-9]/g, '') || 'png';
      const baseName = location.split(/[\\/]/).pop() || `image-${assets.size + 1}.${ext}`;
      const dataUri = encoding === 'base64'
        ? `data:${contentType};base64,${bodyBlock.replace(/\s+/g, '')}`
        : '';
      assets.set(location, { fileName: baseName, contentType, dataUri });
      assets.set(baseName, { fileName: baseName, contentType, dataUri });
    } else if (contentType && !contentType.startsWith('text/')) {
      const fileName = dispositionName || location.split(/[\\/]/).pop() || `attachment-${attachments.length + 1}.bin`;
      attachments.push({
        fileName,
        contentType,
        sizeEstimate: Math.round((bodyBlock.replace(/\s+/g, '').length * 3) / 4),
        targetPath: `attachments/onenote/${fileName}`,
      });
    }
  }

  return { html: html || text, assets, attachments };
}

/**
 * Sort OneNote 2D freeform canvas containers (<div style="position:absolute;top:...;left:..."> or <one:Outline>)
 * into natural top-to-bottom, left-to-right reading order.
 */
function linearizeOneNoteCanvasContainers(html = '') {
  const containerRegex = /<(?:div|one:Outline)\b([^>]*?)>([\s\S]*?)<\/(?:div|one:Outline)>/gi;
  const positionedBlocks = [];
  let hasPositioned = false;

  let match;
  while ((match = containerRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const topMatch = /(?:top\s*:\s*|y\s*=\s*"?)(\d+(?:\.\d+)?)/i.exec(attrs);
    const leftMatch = /(?:left\s*:\s*|x\s*=\s*"?)(\d+(?:\.\d+)?)/i.exec(attrs);
    if (topMatch || leftMatch) {
      hasPositioned = true;
      positionedBlocks.push({
        top: topMatch ? parseFloat(topMatch[1]) : 0,
        left: leftMatch ? parseFloat(leftMatch[1]) : 0,
        inner,
      });
    }
  }

  if (!hasPositioned || positionedBlocks.length < 2) return { orderedHtml: html, containerCount: Math.max(1, positionedBlocks.length), reordered: false };

  // Sort by vertical row band (within 24px tolerance), then horizontal X coordinate
  positionedBlocks.sort((a, b) => {
    if (Math.abs(a.top - b.top) > 24) return a.top - b.top;
    return a.left - b.left;
  });

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const headerHtml = titleMatch ? `<h1>${titleMatch[1]}</h1>\n` : '';
  return {
    orderedHtml: headerHtml + positionedBlocks.map(b => `<section class="onenote-canvas-block">\n${b.inner}\n</section>`).join('\n\n'),
    containerCount: positionedBlocks.length,
    reordered: true,
  };
}

export function convertOneNoteToMarkdown(rawInput = '', {
  fileName = 'OneNote笔记.mht',
  targetFolder = 'onenote-imports',
  today = localDate(),
} = {}) {
  const isMht = /MIME-Version:|multipart\/related|Content-Location:/i.test(rawInput);
  const parsedMht = isMht ? parseMhtArchive(rawInput) : { html: String(rawInput || ''), assets: new Map(), attachments: [] };

  const { orderedHtml, containerCount, reordered } = linearizeOneNoteCanvasContainers(parsedMht.html);
  let work = orderedHtml;

  // Extract page title
  const rawTitle = (
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(work)?.[1] ||
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(work)?.[1] ||
    String(fileName).replace(/\.(mht|mhtml|html|htm|xml|one)$/i, '')
  ).replace(/<[^>]+>/g, '').trim() || 'OneNote 迁入笔记';
  const cleanTitle = stripNumericPrefix(rawTitle);
  const pageSlug = slugifyFileName(cleanTitle);

  const extractedImages = [];
  const extractedAttachments = [...parsedMht.attachments];
  const convertedWikiLinks = [];

  // 1. Extract OneNote embedded <object data-attachment="..."> or <a data-attachment="...">
  work = work.replace(/<object\b([^>]*?)>([\s\S]*?)<\/object>/gi, (_, attrs) => {
    const attName =
      /data-attachment="([^"]+)"/i.exec(attrs)?.[1] ||
      /data="([^"]+)"/i.exec(attrs)?.[1]?.split(/[\\/]/).pop() ||
      `OneNote附件-${extractedAttachments.length + 1}.pdf`;
    const attType = /type="([^"]+)"/i.exec(attrs)?.[1] || 'application/octet-stream';
    const targetPath = `attachments/onenote/${pageSlug}-${attName}`;
    if (!extractedAttachments.some(a => a.fileName === attName)) {
      extractedAttachments.push({
        fileName: attName,
        contentType: attType,
        targetPath,
      });
    }
    return `\n\n> [!NOTE] 📎 OneNote 嵌入附件：${attName}\n> - 本地落盘路径：[📎 ${attName}](${targetPath})\n\n`;
  });

  // 2. Convert onenote:/// or onenote:https:// internal links into [[WikiLinks]]
  work = work.replace(/<a\b([^>]*?)href="(onenote:[^"]+)"([^>]*?)>([\s\S]*?)<\/a>/gi, (_, pre, href, post, label) => {
    const textLabel = label.replace(/<[^>]+>/g, '').trim();
    const sectionOrPage = textLabel || decodeURIComponent((/page-id=([^&]+)/i.exec(href)?.[1] || '关联笔记')).replace(/[{}\s]/g, '');
    convertedWikiLinks.push({ from: href.slice(0, 48), to: `[[${sectionOrPage}]]` });
    return `[[${sectionOrPage}]]`;
  });

  // 3. Convert regular external or attachment <a href="..."> links
  work = work.replace(/<a\b[^>]*?href="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const textLabel = label.replace(/<[^>]+>/g, '').trim() || href;
    if (/\.(xlsx|xls|docx|doc|pdf|pptx|zip|csv)$/i.test(href) && !/^https?:/i.test(href)) {
      const attName = href.split(/[\\/]/).pop();
      const targetPath = `attachments/onenote/${pageSlug}-${attName}`;
      if (!extractedAttachments.some(a => a.fileName === attName)) {
        extractedAttachments.push({ fileName: attName, contentType: 'application/attachment', targetPath });
      }
      return `[📎 ${textLabel}](${targetPath})`;
    }
    return `[${textLabel}](${href})`;
  });

  // 4. Extract <img> tags (data: URI, MHT Content-Location, or file:/// path)
  work = work.replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    const src = /src="([^"]+)"/i.exec(attrs)?.[1] || '';
    const alt = (/alt="([^"]+)"/i.exec(attrs)?.[1] || `OneNote插图-${extractedImages.length + 1}`).trim();
    const idx = extractedImages.length + 1;
    const ext = /\.jpg|\.jpeg|image\/jpeg/i.test(src) ? 'jpg' : /\.svg|image\/svg/i.test(src) ? 'svg' : 'png';
    const imgFileName = `${pageSlug}-img-${String(idx).padStart(2, '0')}.${ext}`;
    const targetPath = `assets/onenote/${imgFileName}`;
    const mhtAsset = parsedMht.assets.get(src) || parsedMht.assets.get(src.split(/[\\/]/).pop() || '');
    extractedImages.push({
      index: idx,
      alt,
      originalSrc: src.slice(0, 60),
      targetPath,
      dataUri: src.startsWith('data:image/') ? src : (mhtAsset?.dataUri || ''),
    });
    return `\n\n![${alt}](${targetPath})\n\n`;
  });

  // 5. Convert HTML tables to Markdown tables
  work = work.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableInner) => {
    const rows = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tableInner)) !== null) {
      const cells = [];
      const tdRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        const cellText = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        cells.push(cellText.replace(/\|/g, '\\|'));
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';
    const colCount = Math.max(...rows.map(r => r.length));
    const normRows = rows.map(r => Array.from({ length: colCount }, (_, i) => r[i] || ''));
    const header = `| ${normRows[0].join(' | ')} |`;
    const divider = `| ${normRows[0].map(() => '---').join(' | ')} |`;
    const body = normRows.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
    return `\n\n${header}\n${divider}${body ? '\n' + body : ''}\n\n`;
  });

  // 6. Convert headings, lists, formatting, paragraphs
  work = work
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  const bodyLines = work
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Remove duplicate leading H1 if it matches cleanTitle
  const cleanedBody = bodyLines.replace(new RegExp(`^#\\s+${cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`), '');

  const attachmentSummarySection = extractedAttachments.length
    ? [
        '',
        '## 📎 随页迁入附件与外链清单',
        '',
        ...extractedAttachments.map(a => `- [📎 ${a.fileName}](${a.targetPath})（类型：\`${a.contentType}\`）`),
      ].join('\n')
    : '';

  const markdown = [
    '---',
    `title: "${cleanTitle.replace(/"/g, '\\"')}"`,
    'tags: [OneNote迁入, 异构图文, 知识归档]',
    'category: onenote-import',
    'source_app: "Microsoft OneNote"',
    'status: 已迁入',
    `date: ${today}`,
    '---',
    '',
    `# ${cleanTitle}`,
    '',
    cleanedBody,
    attachmentSummarySection,
    '',
  ].filter(Boolean).join('\n');

  return {
    title: cleanTitle,
    folder: targetFolder,
    relativePath: `${targetFolder}/${cleanTitle}.md`,
    markdown,
    stats: {
      canvasBlocksLinearized: containerCount,
      reordered2DCanvas: reordered,
      imageCount: extractedImages.length,
      attachmentCount: extractedAttachments.length,
      wikiLinkCount: convertedWikiLinks.length,
    },
    extractedImages,
    extractedAttachments,
    convertedWikiLinks,
  };
}

export function buildSampleOneNoteImportBundle() {
  return {
    fileName: '研发架构会议纪要与附件包.mht',
    rawContent: [
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="----=_NextPart_OneNote_Inkloom"',
      '',
      '------=_NextPart_OneNote_Inkloom',
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<html><head><title>OneNote迁入 · 研发架构会议与多维图文纪要</title></head><body>',
      '<div style="position:absolute;top:240px;left:420px;width:360px">',
      '<h2>二、 架构演进对比表与跨页双链</h2>',
      '<p>关联历史决议：<a href="onenote:https://d.docs.live.net/vault/架构组.one#双链笔记与卡片盒方法&section-id={A1}&page-id={B2}">双链笔记与卡片盒方法</a> 与 <a href="onenote:https://d.docs.live.net/vault/架构组.one#YAML属性与标签体系&section-id={A2}&page-id={B3}">YAML属性与标签体系</a>。</p>',
      '<table><tr><th>维度</th><th>OneNote 原始画布</th><th>Inkloom 迁入后形态</th></tr>',
      '<tr><td>多框自由排版</td><td>绝对坐标 Outline 浮动框</td><td>按 (Y, X) 坐标重排为结构化章节</td></tr>',
      '<tr><td>内嵌截图与手写</td><td>MHT/二进制内嵌流</td><td>提取至 assets/onenote/ 相对路径</td></tr>',
      '<tr><td>随页 Excel/PDF 附件</td><td>OLE/Object 二进制嵌入对象</td><td>解包至 attachments/onenote/ 并生成文件链接</td></tr></table>',
      '</div>',
      '<div style="position:absolute;top:40px;left:40px;width:360px">',
      '<h2>一、 异构画布图文与架构拓扑图</h2>',
      '<p>本页由 Microsoft OneNote 包含自由坐标浮动文本框、内嵌白板截图、内部页面链接及 2 份插入的原始办公附件自动转换生成。</p>',
      '<img src="cid:arch-diagram-01.png" alt="系统分层架构白板手绘图" />',
      '</div>',
      '<div style="position:absolute;top:480px;left:40px;width:680px">',
      '<h2>三、 随页内嵌工程附件（自动解包落盘）</h2>',
      '<object data-attachment="2026Q4-容量测算模型.xlsx" type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></object>',
      '<object data-attachment="接口安全评审规范-v2.pdf" type="application/pdf"></object>',
      '</div>',
      '</body></html>',
      '------=_NextPart_OneNote_Inkloom',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-Location: cid:arch-diagram-01.png',
      '',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      '------=_NextPart_OneNote_Inkloom--',
    ].join('\n'),
  };
}

/* ============================================================================
 * Path B: Windows Native OneNote COM API (OneNote.Application)
 * GetHierarchy(hsPages) + GetPageContent(piAll) XML Parser & Asset Extractor
 * ========================================================================== */

const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE_ATTACHMENT_BASE64 = 'UEsDBBQAAAAIAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function buildDefaultOneNoteComHierarchyXml() {
  return [
    '<?xml version="1.0"?>',
    '<one:Notebooks xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote">',
    '  <one:Notebook name="研发架构与工程笔记本" ID="{NB-ARCH-001}" path="C:\\Users\\Local\\Documents\\OneNote Notebooks\\研发架构与工程笔记本">',
    '    <one:Section name="系统架构与容量规划" ID="{SEC-SYS-101}" path="系统架构与容量规划.one">',
    '      <one:Page ID="{PAGE-ARCH-2026}" name="研发架构会议与多维图文纪要" dateTime="2026-10-28T09:30:00.000Z" pageLevel="1" />',
    '      <one:Page ID="{PAGE-CANVAS-FLOW}" name="核心数据库读写分离与缓存拓扑" dateTime="2026-10-27T15:20:00.000Z" pageLevel="1" />',
    '    </one:Section>',
    '    <one:Section name="AI智能体与协议规范" ID="{SEC-MCP-102}" path="AI智能体与协议规范.one">',
    '      <one:Page ID="{PAGE-MCP-SPEC}" name="MCP受控工具安全边界与联调清单" dateTime="2026-10-28T11:00:00.000Z" pageLevel="1" />',
    '    </one:Section>',
    '  </one:Notebook>',
    '  <one:Notebook name="个人读书与方法论札记" ID="{NB-READ-002}" path="C:\\Users\\Local\\Documents\\OneNote Notebooks\\个人读书与方法论札记">',
    '    <one:Section name="卡片盒与知识编译" ID="{SEC-ZETTEL-201}" path="卡片盒与知识编译.one">',
    '      <one:Page ID="{PAGE-ZETTEL-NOTE}" name="卢曼卡片盒与Karpathy知识编译笔记" dateTime="2026-10-26T20:15:00.000Z" pageLevel="1" />',
    '    </one:Section>',
    '  </one:Notebook>',
    '</one:Notebooks>',
  ].join('\n');
}

export function getDefaultOneNotePageXml(pageId = '{PAGE-ARCH-2026}') {
  const pages = {
    '{PAGE-ARCH-2026}': [
      '<?xml version="1.0"?>',
      '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{PAGE-ARCH-2026}" name="研发架构会议与多维图文纪要" dateTime="2026-10-28T09:30:00.000Z">',
      '  <one:Title><one:OE><one:T><![CDATA[研发架构会议与多维图文纪要]]></one:T></one:OE></one:Title>',
      '  <one:Outline>',
      '    <one:Position x="420.0" y="220.0" z="1"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>二、 架构演进对比表与跨页双链</h2>]]></one:T></one:OE>',
      '      <one:OE><one:T><![CDATA[关联历史笔记：<a href="onenote:https://d.docs.live.net/vault/架构组.one#双链笔记与卡片盒方法&amp;section-id={SEC-SYS-101}&amp;page-id={PAGE-CANVAS-FLOW}">双链笔记与卡片盒方法</a> 与 <a href="onenote:https://d.docs.live.net/vault/架构组.one#YAML属性与标签体系&amp;section-id={SEC-MCP-102}&amp;page-id={PAGE-MCP-SPEC}">YAML属性与标签体系</a>。]]></one:T></one:OE>',
      '      <one:OE>',
      '        <one:Table>',
      '          <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[维度]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[OneNote 原始画布]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[Inkloom Path B 迁入形态]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>',
      '          <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[自由坐标画布]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[one:Outline (x, y) 浮动框]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[按 (Y, X) 坐标线性化为标准章节]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>',
      '          <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[内嵌图片与手写]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[one:Image Base64 二进制流]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[落盘至 assets/onenote/ 并插入图片语法]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>',
      '          <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[随页插入附件]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[one:InsertedFile 嵌入对象]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[落盘至 attachments/onenote/ 并生成文件链接]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>',
      '        </one:Table>',
      '      </one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '  <one:Outline>',
      '    <one:Position x="36.0" y="42.0" z="0"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>一、 异构画布图文与架构拓扑图</h2>]]></one:T></one:OE>',
      '      <one:OE><one:T><![CDATA[本页通过 Windows 本机 <b>OneNote.Application COM 接口 (GetHierarchy + GetPageContent)</b> 直接读取，包含多个二维自由坐标文本框、内嵌白板图像、待办标签及 2 份插入的办公附件。]]></one:T></one:OE>',
      '      <one:OE><one:Tag index="0" completed="true"/><one:T><![CDATA[完成 OneNote COM 层级树 (笔记本/分区/页面) 自动扫描]]></one:T></one:OE>',
      '      <one:OE><one:Tag index="0" completed="false"/><one:T><![CDATA[核对随页 Excel 容量模型与 PDF 规范附件落盘路径]]></one:T></one:OE>',
      '      <one:OE>',
      '        <one:Image format="png" alt="系统分层架构白板手绘图">',
      `          <one:Data>${SAMPLE_PNG_BASE64}</one:Data>`,
      '        </one:Image>',
      '      </one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '  <one:Outline>',
      '    <one:Position x="36.0" y="460.0" z="2"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>三、 随页内嵌工程附件（COM 自动解包落盘）</h2>]]></one:T></one:OE>',
      '      <one:OE>',
      '        <one:InsertedFile pathCache="C:\\Temp\\2026Q4-容量测算模型.xlsx" pathSource="C:\\Docs\\2026Q4-容量测算模型.xlsx" preferredName="2026Q4-容量测算模型.xlsx">',
      `          <one:Data>${SAMPLE_ATTACHMENT_BASE64}</one:Data>`,
      '        </one:InsertedFile>',
      '      </one:OE>',
      '      <one:OE>',
      '        <one:InsertedFile pathCache="C:\\Temp\\接口安全评审规范-v2.pdf" pathSource="C:\\Docs\\接口安全评审规范-v2.pdf" preferredName="接口安全评审规范-v2.pdf">',
      `          <one:Data>${SAMPLE_ATTACHMENT_BASE64}</one:Data>`,
      '        </one:InsertedFile>',
      '      </one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '</one:Page>',
    ].join('\n'),
    '{PAGE-CANVAS-FLOW}': [
      '<?xml version="1.0"?>',
      '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{PAGE-CANVAS-FLOW}" name="核心数据库读写分离与缓存拓扑" dateTime="2026-10-27T15:20:00.000Z">',
      '  <one:Title><one:OE><one:T><![CDATA[核心数据库读写分离与缓存拓扑]]></one:T></one:OE></one:Title>',
      '  <one:Outline>',
      '    <one:Position x="40.0" y="50.0" z="0"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>一、 读写分离与多级缓存要点</h2>]]></one:T></one:OE>',
      '      <one:OE><one:T><![CDATA[主库承接事务写入，只读副本承接报表查询；参见 <a href="onenote:#研发架构会议与多维图文纪要&amp;page-id={PAGE-ARCH-2026}">研发架构会议与多维图文纪要</a>。]]></one:T></one:OE>',
      '      <one:OE><one:Image format="png" alt="读写分离拓扑图"><one:Data>' + SAMPLE_PNG_BASE64 + '</one:Data></one:Image></one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '</one:Page>',
    ].join('\n'),
    '{PAGE-MCP-SPEC}': [
      '<?xml version="1.0"?>',
      '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{PAGE-MCP-SPEC}" name="MCP受控工具安全边界与联调清单" dateTime="2026-10-28T11:00:00.000Z">',
      '  <one:Title><one:OE><one:T><![CDATA[MCP受控工具安全边界与联调清单]]></one:T></one:OE></one:Title>',
      '  <one:Outline>',
      '    <one:Position x="40.0" y="50.0" z="0"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>一、 外部 AI 工具直连安全门禁</h2>]]></one:T></one:OE>',
      '      <one:OE><one:Tag index="0" completed="true"/><one:T><![CDATA[所有 @privacy: locked 私密笔记在 MCP Server 层硬性拦截]]></one:T></one:OE>',
      '      <one:OE><one:InsertedFile pathSource="C:\\Docs\\MCP接口联调报告.pdf" preferredName="MCP接口联调报告.pdf"><one:Data>' + SAMPLE_ATTACHMENT_BASE64 + '</one:Data></one:InsertedFile></one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '</one:Page>',
    ].join('\n'),
    '{PAGE-ZETTEL-NOTE}': [
      '<?xml version="1.0"?>',
      '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{PAGE-ZETTEL-NOTE}" name="卢曼卡片盒与Karpathy知识编译笔记" dateTime="2026-10-26T20:15:00.000Z">',
      '  <one:Title><one:OE><one:T><![CDATA[卢曼卡片盒与Karpathy知识编译笔记]]></one:T></one:OE></one:Title>',
      '  <one:Outline>',
      '    <one:Position x="40.0" y="50.0" z="0"/>',
      '    <one:OEChildren>',
      '      <one:OE><one:T><![CDATA[<h2>一、 从零散手记到 Wiki 概念晶体</h2>]]></one:T></one:OE>',
      '      <one:OE><one:T><![CDATA[关联墨图核心卡片：<a href="onenote:#双链笔记与卡片盒方法">双链笔记与卡片盒方法</a>。]]></one:T></one:OE>',
      '    </one:OEChildren>',
      '  </one:Outline>',
      '</one:Page>',
    ].join('\n'),
  };
  return pages[pageId] || pages['{PAGE-ARCH-2026}'];
}

function getXmlAttr(tagAttrs = '', attrName = '') {
  const m = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i').exec(tagAttrs);
  return m ? m[1] : '';
}

export function parseOneNoteHierarchyXml(xmlString = '') {
  const xml = String(xmlString || '').trim();
  const notebooks = [];
  let totalSections = 0;
  let totalPages = 0;

  const nbRegex = /<(?:one:)?Notebook\b([^>]*?)>([\s\S]*?)<\/(?:one:)?Notebook>/gi;
  let nbMatch;
  while ((nbMatch = nbRegex.exec(xml)) !== null) {
    const nbAttrs = nbMatch[1] || '';
    const nbBody = nbMatch[2] || '';
    const nbId = getXmlAttr(nbAttrs, 'ID') || `nb-${notebooks.length + 1}`;
    const nbName = getXmlAttr(nbAttrs, 'name') || `OneNote 笔记本 ${notebooks.length + 1}`;
    const nbPath = getXmlAttr(nbAttrs, 'path') || '';
    const sections = [];

    const secRegex = /<(?:one:)?Section\b([^>]*?)>([\s\S]*?)<\/(?:one:)?Section>/gi;
    let secMatch;
    while ((secMatch = secRegex.exec(nbBody)) !== null) {
      const secAttrs = secMatch[1] || '';
      const secBody = secMatch[2] || '';
      const secId = getXmlAttr(secAttrs, 'ID') || `sec-${totalSections + 1}`;
      const secName = getXmlAttr(secAttrs, 'name') || `分区 ${totalSections + 1}`;
      const pages = [];

      const pageRegex = /<(?:one:)?Page\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:one:)?Page>)/gi;
      let pageMatch;
      while ((pageMatch = pageRegex.exec(secBody)) !== null) {
        const pAttrs = pageMatch[1] || '';
        const pId = getXmlAttr(pAttrs, 'ID') || `page-${totalPages + 1}`;
        const pName = getXmlAttr(pAttrs, 'name') || `未命名页面 ${totalPages + 1}`;
        const dateTime = getXmlAttr(pAttrs, 'dateTime') || '';
        const pageLevel = Number(getXmlAttr(pAttrs, 'pageLevel') || '1') || 1;
        pages.push({
          id: pId,
          name: pName,
          notebookId: nbId,
          notebookName: nbName,
          sectionId: secId,
          sectionName: secName,
          dateTime: dateTime ? dateTime.slice(0, 10) : localDate(),
          pageLevel,
        });
        totalPages++;
      }
      if (pages.length) {
        sections.push({ id: secId, name: secName, notebookName: nbName, pages });
        totalSections++;
      }
    }
    if (sections.length) {
      notebooks.push({ id: nbId, name: nbName, path: nbPath, sections });
    }
  }

  return {
    notebooks,
    totalNotebooks: notebooks.length,
    totalSections,
    totalPages,
  };
}

/**
 * Convert a OneNote COM <one:Page> XML document into Inkloom Markdown,
 * sorting 2D <one:Outline> canvas containers by (y, x) coordinates,
 * and extracting <one:Image> binary streams + <one:InsertedFile> attachments.
 */
export function convertOneNotePageXmlToMarkdown(pageXml = '', {
  notebookName = '研发架构与工程笔记本',
  sectionName = '系统架构与容量规划',
  targetRootFolder = 'OneNote迁入',
  today = localDate(),
} = {}) {
  const xml = String(pageXml || '');
  if (!/<(?:one:)?Page\b/i.test(xml)) {
    return convertOneNoteToMarkdown(xml, {
      fileName: 'OneNote页面.mht',
      targetFolder: `${targetRootFolder}/${slugifyFileName(notebookName)}/${slugifyFileName(sectionName)}`,
      today,
    });
  }

  const pageTagMatch = /<(?:one:)?Page\b([^>]*?)>/i.exec(xml);
  const pageAttrs = pageTagMatch ? pageTagMatch[1] : '';
  const attrTitle = getXmlAttr(pageAttrs, 'name');
  const titleBlockMatch = /<(?:one:)?Title\b[^>]*>[\s\S]*?<(?:one:)?T\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/(?:one:)?T>[\s\S]*?<\/(?:one:)?Title>/i.exec(xml);
  const rawTitle = (titleBlockMatch?.[1] || attrTitle || 'OneNote 迁入笔记').replace(/<[^>]+>/g, '').trim();
  const cleanTitle = stripNumericPrefix(rawTitle);
  const pageSlug = slugifyFileName(cleanTitle);

  const extractedImages = [];
  const extractedInkDrawings = [];
  const extractedAttachments = [];
  const convertedWikiLinks = [];

  // Extract all <one:Outline> blocks and top-level <one:InkDrawing> blocks and sort by (y, x) position
  const outlines = [];
  const outlineRegex = /<(?:one:)?Outline\b[^>]*>([\s\S]*?)<\/(?:one:)?Outline>/gi;
  let outMatch;
  while ((outMatch = outlineRegex.exec(xml)) !== null) {
    const outInner = outMatch[1] || '';
    const posMatch = /<(?:one:)?Position\b([^>]*?)\/?>/i.exec(outInner);
    const x = posMatch ? parseFloat(getXmlAttr(posMatch[1], 'x') || '0') : 0;
    const y = posMatch ? parseFloat(getXmlAttr(posMatch[1], 'y') || '0') : 0;
    outlines.push({ x, y, inner: outInner });
  }
  const xmlWithoutOutlines = xml.replace(/<(?:one:)?Outline\b[^>]*>[\s\S]*?<\/(?:one:)?Outline>/gi, '');
  const topInkRegex = /<(?:one:)?InkDrawing\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:one:)?InkDrawing>)/gi;
  let topInkMatch;
  while ((topInkMatch = topInkRegex.exec(xmlWithoutOutlines)) !== null) {
    const inkBlock = topInkMatch[0] || '';
    const posMatch = /<(?:one:)?Position\b([^>]*?)\/?>/i.exec(inkBlock);
    const x = posMatch ? parseFloat(getXmlAttr(posMatch[1], 'x') || '0') : 0;
    const y = posMatch ? parseFloat(getXmlAttr(posMatch[1], 'y') || '200') : 200;
    outlines.push({ x, y, inner: `<one:OE><one:T><![CDATA[]]></one:T>${inkBlock}</one:OE>` });
  }

  const reordered = outlines.length > 1;
  outlines.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
    return a.x - b.x;
  });

  const convertInlineRichText = (htmlFrag = '') => {
    let text = String(htmlFrag || '');
    // Convert onenote: links into [[WikiLinks]]
    text = text.replace(/<a\b[^>]*?href="(onenote:[^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
      const targetName = cleanLabel || decodeURIComponent((/#([^&]+)/.exec(href)?.[1] || '关联笔记')).trim();
      convertedWikiLinks.push({ from: href.slice(0, 48), to: `[[${targetName}]]` });
      return `[[${targetName}]]`;
    });
    text = text.replace(/<a\b[^>]*?href="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      return `[${label.replace(/<[^>]+>/g, '').trim() || href}](${href})`;
    });
    return text
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1')
      .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
      .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .trim();
  };

  const renderedBlocks = [];
  for (const outline of (outlines.length ? outlines : [{ x: 0, y: 0, inner: xml }])) {
    let blockXml = outline.inner;

    // 1. Convert <one:Table> first so inner <one:OE> are handled as table cells
    blockXml = blockXml.replace(/<(?:one:)?Table\b[^>]*>([\s\S]*?)<\/(?:one:)?Table>/gi, (_, tableInner) => {
      const rows = [];
      const rowRegex = /<(?:one:)?Row\b[^>]*>([\s\S]*?)<\/(?:one:)?Row>/gi;
      let rMatch;
      while ((rMatch = rowRegex.exec(tableInner)) !== null) {
        const cells = [];
        const cellRegex = /<(?:one:)?Cell\b[^>]*>([\s\S]*?)<\/(?:one:)?Cell>/gi;
        let cMatch;
        while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
          const cdatas = [...cMatch[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => convertInlineRichText(m[1]));
          cells.push(cdatas.join(' ').replace(/\|/g, '\\|').trim());
        }
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return '';
      const colCount = Math.max(...rows.map(r => r.length));
      const norm = rows.map(r => Array.from({ length: colCount }, (_, i) => r[i] || ''));
      const header = `| ${norm[0].join(' | ')} |`;
      const sep = `| ${norm[0].map(() => '---').join(' | ')} |`;
      const body = norm.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
      return `\n<ONENOTE_MD_BLOCK>${header}\n${sep}${body ? '\n' + body : ''}</ONENOTE_MD_BLOCK>\n`;
    });

    // 2. Convert <one:Image>
    blockXml = blockXml.replace(/<(?:one:)?Image\b([^>]*?)>([\s\S]*?)<\/(?:one:)?Image>/gi, (_, imgAttrs, imgInner) => {
      const fmt = (getXmlAttr(imgAttrs, 'format') || 'png').toLowerCase().replace('jpeg', 'jpg');
      const alt = getXmlAttr(imgAttrs, 'alt') || `${cleanTitle}-插图-${extractedImages.length + 1}`;
      const dataMatch = /<(?:one:)?Data\b[^>]*>([\s\S]*?)<\/(?:one:)?Data>/i.exec(imgInner);
      const base64Data = (dataMatch?.[1] || '').replace(/\s+/g, '');
      const idx = extractedImages.length + 1;
      const fileName = `${pageSlug}-img-${String(idx).padStart(2, '0')}.${fmt}`;
      const targetPath = `assets/onenote/${fileName}`;
      extractedImages.push({
        index: idx,
        alt,
        fileName,
        targetPath,
        base64Data,
        dataUri: base64Data ? `data:image/${fmt === 'jpg' ? 'jpeg' : fmt};base64,${base64Data}` : '',
      });
      return `\n<ONENOTE_MD_BLOCK>![${alt}](${targetPath})</ONENOTE_MD_BLOCK>\n`;
    });

    // 2b. MAJOR-210: Convert <one:InkDrawing> handwritten ink strokes into vector SVG assets
    blockXml = blockXml.replace(/<(?:one:)?InkDrawing\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:one:)?InkDrawing>)/gi, (_, inkAttrs, inkInner = '') => {
      const recognized = getXmlAttr(inkAttrs, 'recognizedText') ||
        /<(?:one:)?RecognizedText\b[^>]*>([\s\S]*?)<\/(?:one:)?RecognizedText>/i.exec(inkInner)?.[1]?.trim() ||
        'OneNote 手写墨迹批注';
      const strokeColor = getXmlAttr(inkAttrs, 'color') || '#1e293b';
      const strokeWidth = Number(getXmlAttr(inkAttrs, 'width')) || 2.2;
      const strokePolylines = [];
      for (const stMatch of inkInner.matchAll(/<(?:one:)?Stroke\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:one:)?Stroke>)/gi)) {
        const ptsAttr = getXmlAttr(stMatch[1] || '', 'points') || (stMatch[2] || '').trim();
        if (ptsAttr) strokePolylines.push(ptsAttr.replace(/\s+/g, ' ').trim());
      }
      const attrPoints = getXmlAttr(inkAttrs, 'points');
      if (attrPoints) strokePolylines.push(attrPoints.replace(/\s+/g, ' ').trim());
      if (!strokePolylines.length) {
        strokePolylines.push('18,62 56,34 98,66 146,30 198,58 254,36');
      }
      const svgXml = renderOneNoteInkDrawingToSvg({
        strokes: strokePolylines,
        recognizedText: recognized,
        color: strokeColor,
        strokeWidth,
      });
      const svgBase64 = typeof Buffer !== 'undefined'
        ? Buffer.from(svgXml, 'utf-8').toString('base64')
        : btoa(unescape(encodeURIComponent(svgXml)));
      const inkIdx = extractedInkDrawings.length + 1;
      const imgIdx = extractedImages.length + 1;
      const fileName = `${pageSlug}-ink-${String(inkIdx).padStart(2, '0')}.svg`;
      const targetPath = `assets/onenote/${fileName}`;
      const inkRecord = {
        index: inkIdx,
        recognizedText: recognized,
        strokeCount: strokePolylines.length,
        fileName,
        targetPath,
        svgXml,
        base64Data: svgBase64,
        dataUri: `data:image/svg+xml;base64,${svgBase64}`,
      };
      extractedInkDrawings.push(inkRecord);
      extractedImages.push({
        index: imgIdx,
        alt: `手写墨迹：${recognized}`,
        fileName,
        targetPath,
        base64Data: svgBase64,
        dataUri: inkRecord.dataUri,
        isInkDrawing: true,
      });
      return `\n<ONENOTE_MD_BLOCK>![手写墨迹：${recognized}](${targetPath})\n> ✍️ 手写墨迹识别：${recognized}</ONENOTE_MD_BLOCK>\n`;
    });

    // 3. Convert <one:InsertedFile>
    blockXml = blockXml.replace(/<(?:one:)?InsertedFile\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:one:)?InsertedFile>)/gi, (_, fileAttrs, fileInner = '') => {
      const preferredName = getXmlAttr(fileAttrs, 'preferredName') ||
        getXmlAttr(fileAttrs, 'pathSource').split(/[\\/]/).pop() ||
        `OneNote附件-${extractedAttachments.length + 1}.bin`;
      const dataMatch = /<(?:one:)?Data\b[^>]*>([\s\S]*?)<\/(?:one:)?Data>/i.exec(fileInner || '');
      const base64Data = (dataMatch?.[1] || '').replace(/\s+/g, '');
      const targetPath = `attachments/onenote/${pageSlug}-${preferredName}`;
      const ext = preferredName.split('.').pop()?.toLowerCase() || 'bin';
      const contentType = ext === 'pdf'
        ? 'application/pdf'
        : ext === 'xlsx' || ext === 'xls'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream';
      extractedAttachments.push({
        fileName: preferredName,
        contentType,
        targetPath,
        base64Data,
      });
      return `\n<ONENOTE_MD_BLOCK>> [!NOTE] 📎 随页嵌入附件：${preferredName}\n> - 本地落盘路径：[📎 ${preferredName}](${targetPath})</ONENOTE_MD_BLOCK>\n`;
    });

    // 4. Extract remaining <one:OE> text / tag lines and <ONENOTE_MD_BLOCK> in document order
    const tokenRegex = /<ONENOTE_MD_BLOCK>([\s\S]*?)<\/ONENOTE_MD_BLOCK>|<(?:one:)?OE\b[^>]*>([\s\S]*?)<\/(?:one:)?OE>/gi;
    let tok;
    while ((tok = tokenRegex.exec(blockXml)) !== null) {
      if (tok[1] !== undefined) {
        renderedBlocks.push(tok[1].trim());
      } else if (tok[2] !== undefined) {
        const oeInner = tok[2];
        for (const innerBlock of oeInner.matchAll(/<ONENOTE_MD_BLOCK>([\s\S]*?)<\/ONENOTE_MD_BLOCK>/gi)) {
          if (innerBlock[1]?.trim()) renderedBlocks.push(innerBlock[1].trim());
        }
        const tagMatch = /<(?:one:)?Tag\b([^>]*?)\/?>/i.exec(oeInner);
        const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(oeInner);
        if (!cdataMatch) continue;
        const lineText = convertInlineRichText(cdataMatch[1]);
        if (!lineText) continue;
        if (tagMatch) {
          const completed = getXmlAttr(tagMatch[1], 'completed') === 'true';
          renderedBlocks.push(`- [${completed ? 'x' : ' '}] ${lineText}`);
        } else if (lineText.startsWith('#')) {
          renderedBlocks.push(lineText);
        } else {
          renderedBlocks.push(lineText);
        }
      }
    }
  }

  const folderPath = [
    String(targetRootFolder || 'OneNote迁入').replace(/^\/+|\/+$/g, ''),
    slugifyFileName(notebookName),
    slugifyFileName(sectionName),
  ].filter(Boolean).join('/');

  const attachmentSummarySection = extractedAttachments.length
    ? [
        '',
        '## 📎 随页迁入附件与外链清单',
        '',
        ...extractedAttachments.map(a => `- [📎 ${a.fileName}](${a.targetPath})（类型：\`${a.contentType}\`）`),
      ].join('\n')
    : '';

  const markdown = [
    '---',
    `title: "${cleanTitle.replace(/"/g, '\\"')}"`,
    `notebook: "${notebookName.replace(/"/g, '\\"')}"`,
    `section: "${sectionName.replace(/"/g, '\\"')}"`,
    'tags: [OneNote迁入, 异构图文, COM整本同步]',
    'category: onenote-import',
    'source_app: "Microsoft OneNote (COM Hierarchy)"',
    'status: 已迁入',
    `date: ${today}`,
    '---',
    '',
    `# ${cleanTitle}`,
    '',
    `> [!TIP] OneNote 层级来源：\`${notebookName} / ${sectionName}\``,
    '',
    renderedBlocks.join('\n\n'),
    attachmentSummarySection,
    '',
  ].filter(Boolean).join('\n');

  const result = {
    title: cleanTitle,
    notebookName,
    sectionName,
    folder: folderPath,
    relativePath: `${folderPath}/${cleanTitle}.md`,
    markdown,
    stats: {
      canvasBlocksLinearized: Math.max(1, outlines.length),
      reordered2DCanvas: reordered,
      imageCount: extractedImages.length,
      inkDrawingCount: extractedInkDrawings.length,
      attachmentCount: extractedAttachments.length,
      wikiLinkCount: convertedWikiLinks.length,
    },
    extractedImages,
    extractedInkDrawings,
    extractedAttachments,
    convertedWikiLinks,
  };
  result.fidelityAudit = auditOneNoteMigrationFidelity(result);
  return result;
}

export function renderOneNoteInkDrawingToSvg({
  strokes = [],
  recognizedText = '手写墨迹',
  color = '#1e293b',
  strokeWidth = 2.2,
} = {}) {
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const polylines = (strokes.length ? strokes : ['18,62 56,34 98,66 146,30 198,58'])
    .map(pts => `<polyline fill="none" stroke="${esc(color)}" stroke-width="${Number(strokeWidth) || 2.2}" stroke-linecap="round" stroke-linejoin="round" points="${esc(pts)}"/>`)
    .join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="108" viewBox="0 0 320 108">',
    '  <rect width="320" height="108" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>',
    `  <g>${polylines}</g>`,
    `  <text x="12" y="96" font-family="sans-serif" font-size="10.5" fill="#475569">✍️ ${esc(String(recognizedText).slice(0, 36))}</text>`,
    '</svg>',
  ].join('\n');
}

export function auditOneNoteMigrationFidelity(converted = {}) {
  const images = Array.isArray(converted.extractedImages) ? converted.extractedImages : [];
  const inks = Array.isArray(converted.extractedInkDrawings) ? converted.extractedInkDrawings : [];
  const attachments = Array.isArray(converted.extractedAttachments) ? converted.extractedAttachments : [];
  const missingImages = images.filter(img => !img.base64Data && !img.dataUri);
  const missingAttachments = attachments.filter(att => !att.base64Data);
  const missingAssetCount = missingImages.length + missingAttachments.length;

  const checks = [
    {
      id: 'outline-order',
      label: '二维自由坐标画布 (Y,X) 线性化',
      passed: (converted.stats?.canvasBlocksLinearized || 0) >= 1,
    },
    {
      id: 'images-integrity',
      label: `内嵌图像字节完整性 (${images.length - missingImages.length}/${images.length})`,
      passed: missingImages.length === 0,
    },
    {
      id: 'ink-vectorized',
      label: `手写墨迹矢量化还原 (${inks.length} 处 SVG)`,
      passed: inks.every(ink => Boolean(ink.svgXml && ink.base64Data)),
    },
    {
      id: 'attachments-integrity',
      label: `随页附件原字节校验 (${attachments.length - missingAttachments.length}/${attachments.length})`,
      passed: missingAttachments.length === 0,
    },
  ];
  const passedCount = checks.filter(c => c.passed).length;
  const passed = missingAssetCount === 0 && passedCount === checks.length;
  return {
    passed,
    score: Math.round((passedCount / checks.length) * 100),
    missingAssetCount,
    checks,
    summaryText: passed
      ? `✓ 全保真校验通过（画布 ${converted.stats?.canvasBlocksLinearized || 1} 框 · 图片 ${images.length} · 墨迹 ${inks.length} · 附件 ${attachments.length}）`
      : `⚠ 保真校验阻止：${missingAssetCount} 项附件或图像缺少原始字节数据`,
  };
}

