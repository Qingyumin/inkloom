import { newWhiteboardMarkdown, whiteboardFromMarkdown, updateWhiteboardMarkdown } from '../../core/whiteboard-document.mjs';
import { convertJsonCanvasToWhiteboardScene } from '../../core/spatial-canvas-graph.mjs';
import { localDay } from '../../core/workspace-model.mjs';
import { createElement, Plus, Upload, ArrowUpRight, CalendarDays } from 'lucide';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function command(icon, name) { const button = element('button', 'phase-command'); button.type = 'button'; button.title = name; button.append(createElement(icon, { width: 15, height: 15 }), document.createTextNode(name)); return button; }

export function activate(api) {
  let libraryRequested = false;
  api.registerSetting({ id: 'library', name: '白板元件库', type: 'data', default: [] });
  const view = api.registerView({ id: 'whiteboard-view', target: 'whiteboard', name: '白板', icon: 'pencil-ruler', location: 'activity', order: 45, mount(container, scope) {
    const current = api.activeDocument(); let board;
    try { if (current) board = whiteboardFromMarkdown(current.source); } catch { }
    if (board && !libraryRequested) {
      window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw/', window.location.href).href;
      let dispose; container.textContent = '正在载入白板...';
      import('./canvas-view.js').then(module => { if (!scope.signal.aborted) { container.replaceChildren(); dispose = module.mountWhiteboard(api, container, scope, async () => { libraryRequested = true; await api.navigate('write'); await api.showView(view); }); } }).catch(error => { if (!scope.signal.aborted) api.fail(error.message); });
      return () => dispose?.();
    }
    libraryRequested = false;
    const root = element('section', 'whiteboard-library'); root.id = 'whiteboard-library'; const toolbar = element('form', 'whiteboard-library-tools'); const title = element('input'); title.placeholder = '白板或手帐名称'; title.required = true; title.maxLength = 100; title.id = 'whiteboard-new-title'; title.setAttribute('aria-label', '白板名称');
    const dateInput = element('input'); dateInput.type = 'date'; dateInput.id = 'whiteboard-new-date'; dateInput.setAttribute('aria-label', '手绘手帐日期');
    const create = command(Plus, '新建白板'); create.type = 'submit'; create.id = 'whiteboard-create';
    const todayJournal = command(CalendarDays, '今日手绘手帐'); todayJournal.id = 'whiteboard-today-journal';
    const imported = command(Upload, '导入白板'); imported.id = 'whiteboard-import'; const file = element('input'); file.type = 'file'; file.accept = '.canvas,.excalidraw,.json'; file.hidden = true; file.id = 'whiteboard-import-file'; imported.onclick = () => file.click();
    const search = element('input'); search.type = 'search'; search.placeholder = '查找白板或日期'; search.setAttribute('aria-label', '查找白板'); const list = element('div', 'whiteboard-note-list'); const status = element('p', 'home-status'); status.setAttribute('role', 'status'); const error = element('p', 'database-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const paging = element('div', 'home-task-footer'); const previous = element('button', 'small-command', '上一页'); previous.type = 'button'; const next = element('button', 'small-command', '下一页'); next.type = 'button'; const count = element('span'); paging.append(previous, count, next); toolbar.append(title, dateInput, create, todayJournal, imported, file, search); root.append(toolbar, status, error, list, paging); container.append(root); let page = 0; let request = 0; let busy = false; let currentBoards = [];
    const fail = reason => { if (!scope.signal.aborted) { error.hidden = false; error.textContent = reason.message; } };
    async function refresh() {
      const token = ++request;
      try { const result = await api.queryWorkspace({ whiteboardText: search.value, whiteboardPage: page }, { signal: scope.signal, key: 'whiteboard-library' }); if (scope.signal.aborted || token !== request) return;
        currentBoards = result.whiteboards;
        list.replaceChildren(); for (const note of result.whiteboards) { const label = note.date ? `${note.title} · ${note.date}` : note.title; const open = command(ArrowUpRight, label); open.dataset.whiteboardNoteId = note.id; if (note.date) open.dataset.whiteboardDate = note.date; open.onclick = () => api.open(note.id).catch(fail); list.append(open); }
        if (!result.whiteboards.length) list.append(element('p', 'empty-state', '尚无白板')); page = result.whiteboardPage; count.textContent = result.whiteboardTotal + ' 个白板 · ' + (page + 1); previous.disabled = page === 0; next.disabled = (page + 1) * 25 >= result.whiteboardTotal;
      } catch (reason) { if (reason.name !== 'AbortError') fail(reason); }
    }
    async function createBoard(source, name) {
      if (busy) return; busy = true; create.disabled = true; todayJournal.disabled = true; imported.disabled = true; error.hidden = true;
      try { const filename = name.slice(0, 48) + ' ' + crypto.randomUUID(); const note = await api.createNote(filename, { folder: 'whiteboards', source, background: true }); if (!scope.signal.aborted) await api.open(note.id); }
      catch (reason) { fail(reason); } finally { busy = false; create.disabled = false; todayJournal.disabled = false; imported.disabled = false; }
    }
    toolbar.onsubmit = event => { event.preventDefault(); if (title.value.trim()) void createBoard(newWhiteboardMarkdown(title.value.trim(), { date: dateInput.value }), title.value.trim()); };
    todayJournal.onclick = async () => {
      if (busy) return;
      const today = localDay();
      const existing = currentBoards.find(board => board.date === today);
      if (existing) { await api.open(existing.id).catch(fail); return; }
      const journalTitle = '手绘手帐 · ' + today;
      await createBoard(newWhiteboardMarkdown(journalTitle, { date: today }), journalTitle);
    };
    file.onchange = async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      try {
        if (selected.size > 6 * 1024 * 1024) throw new Error('白板文件超过 6 MiB');
        const name = selected.name.replace(/\.(canvas|excalidraw|json)$/i, '').slice(0, 100) || '导入白板';
        const parsed = JSON.parse(await selected.text());
        const sceneInput = (selected.name.toLowerCase().endsWith('.canvas') || (Array.isArray(parsed?.nodes) && parsed?.type !== 'excalidraw'))
          ? convertJsonCanvasToWhiteboardScene(parsed, api.query({ limit: 250 }) || [])
          : parsed;
        const source = updateWhiteboardMarkdown(newWhiteboardMarkdown(name, { date: dateInput.value }), sceneInput);
        await createBoard(source, name);
      } catch (reason) { fail(reason); } finally { file.value = ''; }
    };
    search.oninput = () => { page = 0; void refresh(); }; previous.onclick = () => { page--; void refresh(); }; next.onclick = () => { page++; void refresh(); }; scope.own(api.on('vault.changed', refresh)); void refresh(); return () => { request++; root.remove(); };
  } });
  api.registerCommand({ id: 'open-whiteboard', name: '打开白板', run: () => api.showView(view) });
}