import MarkdownIt from '../app/node_modules/markdown-it/dist/markdown-it.mjs';
import { stringify } from '../app/node_modules/yaml/browser/index.js';

const parser = new MarkdownIt({ html: false });
export const whiteboardLimits = { characters: 6 * 1024 * 1024, elements: 3000, files: 60, points: 20000 };
const elementTypes = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame']);

export function validateWhiteboard(input) {
  if (!input || input.type !== 'excalidraw' || input.version !== 2 || !Array.isArray(input.elements) || input.elements.length > whiteboardLimits.elements) throw new Error('白板格式无效或超过 3000 个元素');
  if (JSON.stringify(input).length > whiteboardLimits.characters) throw new Error('白板超过 6 MiB 文本上限');
  const ids = new Set();
  for (const element of input.elements) {
    if (!element || !elementTypes.has(element.type) || typeof element.id !== 'string' || !element.id || ids.has(element.id)) throw new Error('白板元素类型或身份无效');
    ids.add(element.id);
    for (const key of ['x', 'y', 'width', 'height', 'angle']) if (!Number.isFinite(element[key]) || Math.abs(element[key]) > 1000000) throw new Error('白板元素坐标无效');
    if (element.width < 0 || element.height < 0 || (element.text !== undefined && (typeof element.text !== 'string' || element.text.length > 100000))) throw new Error('白板元素内容无效');
    if (element.points && (!Array.isArray(element.points) || element.points.length > whiteboardLimits.points || element.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1000000)))) throw new Error('白板笔画超过边界');
    if (element.link && (typeof element.link !== 'string' || !/^(?:https?:\/\/|\[\[[^\r\n]+\]\]$)/i.test(element.link))) throw new Error('白板链接仅支持笔记引用或 HTTP 地址');
  }
  const files = input.files || {};
  if (typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > whiteboardLimits.files) throw new Error('白板图片数量超过上限');
  for (const [id, file] of Object.entries(files)) {
    if (!file || file.id !== id || !/^image\/(png|jpeg|webp)$/.test(file.mimeType) || typeof file.dataURL !== 'string' || !new RegExp('^data:' + file.mimeType + ';base64,[A-Za-z0-9+/]+=*$').test(file.dataURL)) throw new Error('白板仅接受内嵌 PNG、JPEG 或 WebP 图片');
  }
  for (const element of input.elements) if (element.type === 'image' && !element.isDeleted && element.fileId && !Object.hasOwn(files, element.fileId)) throw new Error('白板图片资源缺失');
  return { type: 'excalidraw', version: 2, source: 'Inkloom', elements: structuredClone(input.elements), appState: { viewBackgroundColor: /^#[0-9a-f]{6}$/i.test(input.appState?.viewBackgroundColor) ? input.appState.viewBackgroundColor : '#ffffff', gridModeEnabled: Boolean(input.appState?.gridModeEnabled) }, files: structuredClone(files) };
}

export function whiteboardFromMarkdown(source) {
  if (typeof source !== 'string' || source.length > whiteboardLimits.characters + 100000) throw new Error('白板文档超过大小上限');
  const tokens = parser.parse(source, {}).filter(token => token.type === 'fence' && token.info.trim() === 'excalidraw');
  if (tokens.length !== 1) throw new Error('白板文档必须包含唯一的 excalidraw 代码块');
  const scene = validateWhiteboard(JSON.parse(tokens[0].content));
  const lines = source.split('\n'); let from = 0; let to = 0;
  for (let index = 0; index < tokens[0].map[1]; index++) { if (index === tokens[0].map[0]) from = to; to += lines[index].length + (index < lines.length - 1 ? 1 : 0); }
  return { scene, from, to };
}

export function updateWhiteboardMarkdown(source, input) {
  const current = whiteboardFromMarkdown(source); const scene = validateWhiteboard(input); const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const content = '```excalidraw' + newline + JSON.stringify(scene) + newline + '```' + (source.slice(current.from, current.to).endsWith('\n') ? newline : '');
  return source.slice(0, current.from) + content + source.slice(current.to);
}

export function newWhiteboardMarkdown(title = '新白板', options = {}) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160) throw new Error('白板标题无效');
  const date = options?.date ? String(options.date).trim() : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('手绘手帐日期格式应为 YYYY-MM-DD');
  const scene = validateWhiteboard({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} });
  const metadata = { title: title.trim(), category: 'whiteboard', ...(date ? { date } : {}), tags: date ? ['whiteboard', 'journal'] : ['whiteboard'] };
  return '---\n' + stringify(metadata) + '---\n\n```excalidraw\n' + JSON.stringify(scene) + '\n```\n';
}

function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderWhiteboardSvgMarkup(inputScene) {
  const scene = validateWhiteboard(inputScene);
  const active = scene.elements.filter(element => !element.isDeleted);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const el of active) {
    const pts = Array.isArray(el.points) && el.points.length ? el.points.map(([px, py]) => [el.x + px, el.y + py]) : [[el.x, el.y], [el.x + (el.width || 120), el.y + (el.height || 40)]];
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 360; maxY = 180; }
  const pad = 24;
  const vx = Math.round(minX - pad); const vy = Math.round(minY - pad);
  const vw = Math.max(160, Math.round(maxX - minX + pad * 2));
  const vh = Math.max(90, Math.round(maxY - minY + pad * 2));
  const bg = /^#[0-9a-f]{6}$/i.test(scene.appState?.viewBackgroundColor) ? scene.appState.viewBackgroundColor : '#ffffff';
  const nodes = [`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="6" fill="${bg}"/>`];
  for (const el of active) {
    const stroke = /^#[0-9a-f]{3,8}$/i.test(el.strokeColor) ? el.strokeColor : '#1e293b';
    const fill = /^#[0-9a-f]{3,8}$/i.test(el.backgroundColor) ? el.backgroundColor : 'none';
    const sw = Number.isFinite(el.strokeWidth) && el.strokeWidth > 0 ? Math.min(8, el.strokeWidth) : 2;
    const x = Math.round(el.x); const y = Math.round(el.y);
    const w = Math.max(1, Math.round(el.width || 100)); const h = Math.max(1, Math.round(el.height || 36));
    if (el.type === 'rectangle' || el.type === 'frame') {
      nodes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.type === 'frame' ? 2 : 4}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
    } else if (el.type === 'ellipse') {
      nodes.push(`<ellipse cx="${Math.round(x + w / 2)}" cy="${Math.round(y + h / 2)}" rx="${Math.round(w / 2)}" ry="${Math.round(h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
    } else if (el.type === 'diamond') {
      const pts = `${Math.round(x + w / 2)},${y} ${x + w},${Math.round(y + h / 2)} ${Math.round(x + w / 2)},${y + h} ${x},${Math.round(y + h / 2)}`;
      nodes.push(`<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
    } else if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
      const pts = (Array.isArray(el.points) && el.points.length ? el.points : [[0, 0], [w, h]]).map(([px, py]) => `${Math.round(x + px)},${Math.round(y + py)}`).join(' ');
      nodes.push(`<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (el.type === 'text' && el.text) {
      const lines = String(el.text).split(/\r?\n/).slice(0, 12);
      const fontSize = Number.isFinite(el.fontSize) && el.fontSize >= 10 ? Math.min(36, Math.round(el.fontSize)) : 16;
      lines.forEach((line, idx) => {
        nodes.push(`<text x="${x}" y="${y + (idx + 1) * Math.round(fontSize * 1.25)}" fill="${stroke}" font-size="${fontSize}">${escapeXml(line)}</text>`);
      });
    } else if (el.type === 'image' && el.fileId && scene.files?.[el.fileId]?.dataURL) {
      nodes.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${escapeXml(scene.files[el.fileId].dataURL)}" preserveAspectRatio="xMidYMid meet"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="whiteboard-embed-svg" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="白板缩略预览">${nodes.join('')}</svg>`;
}