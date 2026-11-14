import { DOMSerializer } from 'prosemirror-model';
import { createElement, ArrowUpRight } from 'lucide';
import { parseDocument, schema } from '../../vendor/inklet/app/src/markdown.js';
import { renderMarkup } from '../../vendor/inklet/app/src/renderers.js';
import { whiteboardFromMarkdown, renderWhiteboardSvgMarkup } from '../../core/whiteboard-document.mjs';

const labels = { 'missing-note': '来源笔记不存在或名称不唯一', 'missing-heading': '来源章节不存在', 'missing-block': '来源块不存在', ambiguous: '来源标识不唯一', cycle: '已停止循环引用', limit: '已达到引用预览上限' };
export function embeddedAssetPath(value, notePath) {
  if (/^(?:https?:|data:|[A-Za-z]:|[\\/]{2})/.test(value)) return value;
  if (/^[A-Za-z]:[\\/]/.test(notePath)) return decodeURIComponent(new URL(value.replaceAll('\\', '/'), 'file:///' + notePath.replaceAll('\\', '/')).pathname).slice(1);
  return value;
}

export function renderNoteEmbed(model, { open, asset, external, theme = 'neutral', inline = false }, depth = 0) {
  const root = document.createElement('section'); root.className = 'note-embed' + (inline ? ' is-inline-embed' : ''); root.contentEditable = 'false'; root.dataset.noteEmbed = model.noteId; root.dataset.embedStatus = model.status; root.setAttribute('aria-label', '引用 ' + model.name);
  const header = document.createElement('button'); header.type = 'button'; header.className = 'note-embed-source'; header.title = '打开引用来源'; header.append(createElement(ArrowUpRight, { width: 14, height: 14 })); const title = document.createElement('span'); title.textContent = model.reference.alias || model.name; header.append(title);
  header.onclick = event => { event.preventDefault(); event.stopPropagation(); if (model.noteId) open(model.noteId, model.reference.heading); }; root.append(header);
  if (model.status !== 'ready') { const message = document.createElement('p'); message.className = 'note-embed-error'; message.textContent = labels[model.status] || '引用暂不可用'; root.append(message); return root; }
  const body = document.createElement('div'); body.className = 'note-embed-body'; root.append(body);
  const marker = 'inkloom-embed-' + crypto.randomUUID(); let source = model.source;
  for (const [index, child] of [...model.children.entries()].reverse()) source = source.slice(0, child.linkFrom) + '\n\n' + marker + '-' + index + '\n\n' + source.slice(child.linkTo);
  let boardPreview = null;
  const boardMarker = 'inkloom-board-' + crypto.randomUUID();
  try {
    const parsedBoard = whiteboardFromMarkdown(source);
    boardPreview = renderWhiteboardSvgMarkup(parsedBoard.scene);
    source = source.slice(0, parsedBoard.from) + '\n\n' + boardMarker + '\n\n' + source.slice(parsedBoard.to);
  } catch { }
  const json = parseDocument(source).doc.toJSON();
  const normalize = node => {
    if (node.type === 'image') {
      const original = node.attrs.src || ''; const path = embeddedAssetPath(original, model.path);
      if (/^https?:|^\/\//i.test(path) || (/^data:/i.test(path) && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(path))) { node.attrs.src = ''; node.attrs.alt = (node.attrs.alt || '') + '（远程或不支持的图片）'; }
      else node.attrs.src = /^data:/i.test(path) ? path : asset(path);
    }
    node.content?.forEach(normalize);
  };
  normalize(json); const parsed = schema.nodeFromJSON(json);
  body.append(DOMSerializer.fromSchema(schema).serializeFragment(parsed.content));
  if (boardPreview) {
    const placeholder = [...body.querySelectorAll('p')].find(node => node.textContent.trim() === boardMarker);
    const previewBox = document.createElement('div');
    previewBox.className = 'whiteboard-embed-preview';
    previewBox.dataset.whiteboardPreview = model.noteId;
    previewBox.innerHTML = boardPreview;
    if (placeholder) placeholder.replaceWith(previewBox);
    else body.prepend(previewBox);
  }
  for (const [index, child] of model.children.entries()) {
    const placeholder = [...body.querySelectorAll('p')].find(node => node.textContent.trim() === marker + '-' + index);
    if (placeholder) placeholder.replaceWith(renderNoteEmbed(child, { open, asset, external, theme }, depth + 1));
  }
  for (const link of body.querySelectorAll('a')) {
    const href = link.getAttribute('href') || ''; link.removeAttribute('target'); link.onclick = event => { event.preventDefault(); event.stopPropagation(); if (/^https?:\/\//.test(href)) external(href); else if (href.startsWith('#')) open(model.noteId, decodeURIComponent(href.slice(1))); };
  }
  for (const element of [...body.querySelectorAll('[data-math], [data-mermaid]')].filter(element => element.closest('.note-embed') === root).slice(0, 32)) {
    const kind = element.hasAttribute('data-mermaid') ? 'mermaid' : element.classList.contains('math-inline') ? 'math_inline' : 'math_block';
    void renderMarkup(kind, element.dataset.mermaid || element.dataset.math, theme).then(markup => { if (root.isConnected) element.innerHTML = markup; }).catch(() => { element.classList.add('note-embed-error'); });
  }
  for (const control of body.querySelectorAll('input, textarea, select')) control.disabled = true;
  return root;
}