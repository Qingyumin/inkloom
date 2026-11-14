import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import '../../app/node_modules/@excalidraw/excalidraw/dist/prod/index.css';
import { createElement, Save, FolderOpen, Code2, Download, ZoomIn, FilePlus2 } from 'lucide';
import { validateWhiteboard, whiteboardFromMarkdown, updateWhiteboardMarkdown } from '../../core/whiteboard-document.mjs';
import { createWhiteboardNoteCardElements, extractWhiteboardNoteCards, exportWhiteboardSceneToJsonCanvas } from '../../core/spatial-canvas-graph.mjs';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(icon, label, action) { const node = element('button', 'icon-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.append(createElement(icon, { width: 16, height: 16 })); node.onclick = action; return node; }
async function download(blob, name, handle) {
  if (handle) { const writable = await handle.createWritable(); try { await writable.write(blob); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; } return; }
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountWhiteboard(api, container, scope, library) {
  let document = api.activeDocument(); const id = document.id; let source = document.source; let revision = document.revision; let scene = whiteboardFromMarkdown(source).scene; let last = JSON.stringify(scene); let editor; let writing = false; let blocked = false; let ready = false; let interacted = false;
  const root = element('section', 'whiteboard-stage'); root.id = 'whiteboard-stage'; root.setAttribute('aria-label', '白板编辑器'); const toolbar = element('header', 'whiteboard-toolbar'); const name = element('strong', '', document.name.replace(/\.(md|markdown)$/i, '')); const status = element('span', 'home-status', document.dirty ? '未保存' : '已保存'); status.id = 'whiteboard-save-state';
  const error = element('p', 'database-error'); error.id = 'whiteboard-error'; error.hidden = true; error.setAttribute('role', 'alert');
  const fail = reason => { if (!scope.signal.aborted && reason.name !== 'AbortError') { error.hidden = false; error.textContent = reason.message; } };
  let saving = false;
  async function save() {
    if (blocked || saving || scope.signal.aborted) return; saving = true; host.inert = true; status.textContent = '正在保存'; for (const control of toolbar.querySelectorAll('button, select')) control.disabled = true;
    try { const result = await api.saveActiveDocument(id); status.textContent = result.saved ? '已保存' : '未保存'; } catch (reason) { fail(reason); }
    finally { saving = false; host.inert = false; for (const control of toolbar.querySelectorAll('button, select')) control.disabled = false; }
  }
  const saveButton = button(Save, '保存白板', () => void save()); saveButton.id = 'whiteboard-save';
  const noteSelect = element('select'); noteSelect.id = 'whiteboard-note-select'; noteSelect.setAttribute('aria-label', '选择要插入白板的知识库笔记');
  noteSelect.append(new Option('选择笔记卡片...', ''));
  for (const item of (api.query({ limit: 100 }) || []).filter(n => n.id !== id && !n.folder?.startsWith('whiteboards'))) {
    noteSelect.append(new Option(item.title, item.id));
  }
  if (noteSelect.options.length > 1) noteSelect.selectedIndex = 1;
  const insertNoteCardBtn = element('button', 'small-command whiteboard-insert-card-btn', '+ 笔记卡片');
  insertNoteCardBtn.type = 'button'; insertNoteCardBtn.id = 'whiteboard-insert-note-card'; insertNoteCardBtn.title = '将选定 Markdown 笔记作为卡片插入白板画布';
  const noteCardsBar = element('div', 'whiteboard-note-cards-bar'); noteCardsBar.id = 'whiteboard-note-cards-bar'; noteCardsBar.hidden = true;
  let lastInsertedRect = null;

  function renderNoteCardsBar(elementsList) {
    const cards = extractWhiteboardNoteCards(elementsList || scene.elements || []);
    noteCardsBar.replaceChildren();
    if (!cards.length) {
      noteCardsBar.hidden = true;
      return;
    }
    noteCardsBar.hidden = false;
    noteCardsBar.append(element('small', 'whiteboard-cards-label', `画布已混排 ${cards.length} 张笔记卡片（点击直达原文）：`));
    for (const card of cards) {
      const chip = element('button', 'ux-pill-option whiteboard-note-card-chip', `📄 ${card.display} ↗`);
      chip.type = 'button';
      chip.dataset.wbCardTarget = card.target;
      chip.dataset.pillTone = 'teal';
      chip.onclick = async () => {
        try {
          if (status.textContent === '未保存') await save();
          await api.openLink(card.link);
        } catch (reason) { fail(reason); }
      };
      noteCardsBar.append(chip);
    }
  }

  insertNoteCardBtn.onclick = async () => {
    if (blocked || saving || !noteSelect.value) return;
    error.hidden = true;
    try {
      const targetId = noteSelect.value;
      const noteMeta = (api.query({ limit: 100 }) || []).find(n => n.id === targetId) || { id: targetId, title: noteSelect.selectedOptions[0]?.textContent || '笔记' };
      let rawSource = '';
      try { const loaded = await api.read(targetId, { signal: scope.signal }); rawSource = loaded?.source || ''; } catch { }
      const currentElements = editor ? editor.getSceneElementsIncludingDeleted() : scene.elements;
      const card = createWhiteboardNoteCardElements(
        { ...noteMeta, source: rawSource },
        currentElements,
        { connectFromRect: lastInsertedRect },
      );
      lastInsertedRect = card.rectElement;
      const nextElements = [...currentElements, ...card.elements];
      const nextScene = validateWhiteboard({
        type: 'excalidraw',
        version: 2,
        elements: nextElements,
        files: editor ? editor.getFiles() : scene.files,
        appState: editor ? editor.getAppState() : scene.appState,
      });
      const updated = updateWhiteboardMarkdown(source, nextScene);
      writing = true;
      interacted = true;
      const result = api.updateActiveDocument(id, revision, updated);
      source = updated; revision = result.revision; scene = nextScene; last = JSON.stringify(nextScene);
      status.textContent = '未保存';
      root.dataset.elements = String(nextElements.filter(el => !el.isDeleted).length);
      editor?.updateScene({ elements: nextScene.elements });
      renderNoteCardsBar(nextScene.elements);
    } catch (reason) { fail(reason); }
    finally { writing = false; }
  };

  const exportMenu = element('select'); exportMenu.id = 'whiteboard-export-format'; exportMenu.setAttribute('aria-label', '白板导出格式'); exportMenu.append(new Option('Excalidraw', 'excalidraw'), new Option('Obsidian Canvas (.canvas)', 'canvas'), new Option('PNG', 'png'), new Option('SVG', 'svg'));
  const exportButton = button(Download, '导出白板', async () => {
    if (!editor) return; exportButton.disabled = true;
    try {
      const filename = document.name.replace(/\.(md|markdown)$/i, '') + '.' + exportMenu.value;
      const handle = window.showSaveFilePicker ? await window.showSaveFilePicker({ suggestedName: filename }) : null;
      const current = validateWhiteboard({ type: 'excalidraw', version: 2, elements: editor.getSceneElementsIncludingDeleted(), files: editor.getFiles(), appState: editor.getAppState() }); let blob;
      if (exportMenu.value === 'excalidraw') blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
      else if (exportMenu.value === 'canvas') blob = new Blob([JSON.stringify(exportWhiteboardSceneToJsonCanvas(current), null, 2)], { type: 'application/json' });
      else if (exportMenu.value === 'png') blob = await exportToBlob({ elements: current.elements, files: current.files, appState: { ...current.appState, exportBackground: true }, mimeType: 'image/png', maxWidthOrHeight: 2400 });
      else { const svg = await exportToSvg({ elements: current.elements, files: current.files, appState: { ...current.appState, exportBackground: true }, exportPadding: 20 }); blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' }); }
      if (!scope.signal.aborted) await download(blob, filename, handle);
    } catch (reason) { fail(reason); } finally { exportButton.disabled = false; }
  });
  toolbar.append(button(FolderOpen, '所有白板', library), name, status, noteSelect, insertNoteCardBtn, button(ZoomIn, '白板适应窗口', () => editor?.scrollToContent(undefined, { fitToContent: true, animate: false })), button(Code2, '查看白板源文', () => api.navigate('write')), saveButton, exportMenu, exportButton);
  const host = element('div', 'whiteboard-canvas-host'); host.id = 'whiteboard-canvas-host'; root.append(toolbar, noteCardsBar, error, host); container.append(root); const react = createRoot(host);
  renderNoteCardsBar(scene.elements);
  for (const event of ['pointerdown', 'keydown', 'paste', 'drop']) host.addEventListener(event, () => { interacted = true; }, { capture: true, signal: scope.signal });
  let fitFrame; let width = host.clientWidth; let height = host.clientHeight;
  const resize = new ResizeObserver(() => { const nextWidth = host.clientWidth; const nextHeight = host.clientHeight; if (Math.abs(nextWidth - width) > 80 || Math.abs(nextHeight - height) > 80) { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(() => { if (!scope.signal.aborted) editor?.scrollToContent(undefined, { fitToContent: true, animate: false }); }); } width = nextWidth; height = nextHeight; }); resize.observe(host); scope.own(() => { resize.disconnect(); cancelAnimationFrame(fitFrame); });
  function changed(elements, appState, files) {
    if (!ready || writing || blocked || scope.signal.aborted) return;
    try {
      const next = validateWhiteboard({ type: 'excalidraw', version: 2, elements, files, appState }); const serialized = JSON.stringify(next); if (serialized === last) return;
      if (!interacted) { scene = next; last = serialized; return; }
      const updated = updateWhiteboardMarkdown(source, next); writing = true;
      const result = api.updateActiveDocument(id, revision, updated); source = updated; revision = result.revision; scene = next; last = serialized; status.textContent = '未保存'; root.dataset.elements = String(elements.filter(element => !element.isDeleted).length); error.hidden = true;
      renderNoteCardsBar(next.elements);
    } catch (reason) { blocked = true; editor?.updateScene({ elements: scene.elements, appState: { viewModeEnabled: true } }); fail(reason); }
    finally { writing = false; }
  }
  react.render(React.createElement(Excalidraw, {
    initialData: { ...scene, scrollToContent: true }, langCode: 'zh-CN', aiEnabled: false, handleKeyboardGlobally: false, detectScroll: true,
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } },
    validateEmbeddable: () => false,
    libraryItems: api.getSetting('library') || [], onLibraryChange: items => api.setSetting('library', items).catch(fail),
    excalidrawAPI: value => { editor = value; ready = true; root.dataset.ready = 'true'; root.dataset.elements = String(scene.elements.filter(element => !element.isDeleted).length); },
    onChange: changed,
    onLinkOpen: (element, event) => { event.preventDefault(); void api.openLink(element.link).catch(fail); },
  }));
  root.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { const handled = event.defaultPrevented; event.preventDefault(); event.stopPropagation(); if (!handled) void save(); } }, { capture: true, signal: scope.signal });
  const sync = () => {
    if (writing || scope.signal.aborted) return; const current = api.activeDocument(); if (!current || current.id !== id) { blocked = true; editor?.updateScene({ appState: { viewModeEnabled: true } }); return; }
    status.textContent = current.dirty ? '未保存' : '已保存';
    if (current.revision === revision) return;
    try { const updated = whiteboardFromMarkdown(current.source).scene; source = current.source; revision = current.revision; scene = updated; last = JSON.stringify(updated); writing = true; editor?.addFiles(Object.values(updated.files)); editor?.updateScene({ elements: updated.elements, appState: updated.appState }); editor?.history.clear(); blocked = false; }
    catch (reason) { blocked = true; fail(reason); } finally { writing = false; }
  };
  scope.own(api.on('workspace.draft', sync)); scope.own(api.on('workspace.active', sync));
  return () => { ready = false; react.unmount(); root.remove(); };
}