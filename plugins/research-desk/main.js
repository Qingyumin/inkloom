import { createElement, Plus, BookOpen, Copy, FilePlus2, Layers, Highlighter, BookMarked, Check, ChevronLeft, ChevronRight, Upload, RotateCcw, Download } from 'lucide';
import { researchSource, parseAcademicReferences, readingNote, documentExcerptNote, normalizeReaderBbox, computePageLayoutBlocks, extractTextFromPageRegion, renderPageRegionSvgThumbnail, parseDocumentSourceLink, detectDocumentHashDrift, syncDocumentSourceHashInMarkdown, searchDocumentSections, compileDocumentReadingNote, manuscriptNote, manuscriptChapterNote, appendManuscriptChapter, synchronizeManuscriptStructure, formatResearchCitation, compileHighlightsDigestMarkdown, compilePublicationManuscript, compileFolderManuscriptBinder } from '../../core/research-notes.mjs';
import { parseRawDocumentFile, buildSampleOfficeFileBytes, uint8ArrayToBase64 } from '../../core/raw-document-ingestor.mjs';
import { compileEpub3PackageBytes } from '../../core/publication-presenter.mjs';
import { renderRichMarkdownDocument } from '../ai-assistant/main.js';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(icon, name) { const node = element('button', 'icon-button'); node.type = 'button'; node.title = name; node.setAttribute('aria-label', name); node.append(createElement(icon, { width: 15, height: 15 })); return node; }
const kinds = { web: '网页', book: '书籍', paper: '论文', interview: '访谈', other: '其他' };
const statuses = ['待读', '阅读中', '已读', '写作中', '草稿', '已完成'];

export function activate(api) {
  api.registerSetting({ id: 'drafts', name: '资料登记草稿', type: 'data', default: {} });
  const view = api.registerView({ id: 'research-view', target: 'research', name: '研究', icon: 'book-open', location: 'activity', order: 44, mount(container, scope) {
    let page = 0; let request = 0; let busy = false; let vaultKey = ''; let draftTimer; let pointer = false; let deferred = false; let frame;
    let drafts = api.getSetting('drafts') || {}; let draft = { title: '', kind: 'web', locator: '', author: '', year: '', text: '' };
    const root = element('section', 'research-desk'); root.id = 'research-desk'; const toolbar = element('div', 'research-toolbar'); const tabs = element('div', 'segmented-control ux-pill-bar'); let mode = 'source';
    if (window.__inkloomPendingSubTab?.viewId === 'research-desk:research-view' && window.__inkloomPendingSubTab.subKey) {
      mode = window.__inkloomPendingSubTab.subKey;
      window.__inkloomPendingSubTab = null;
    }
    let highlightColor = 'all'; let currentPublication = null;
    let currentReaderPath = ''; let readerSectionIndex = 0;
    let readerSearchQuery = ''; let readerFontScale = 14.5; let activeQuotedParagraphIdx = -1;
    let readerLayoutMode = 'canvas'; let readerSpreadMode = false; let readerZoomPercent = 100;
    let readerBoxAnnotateMode = false; let activeReaderBbox = null; let focusedJumpBboxString = '';
    let readerToolsMenuOpenState = false;
    let pendingReaderTarget = window.__inkloomPendingReaderTarget || null;
    window.__inkloomPendingReaderTarget = null;
    if (pendingReaderTarget?.relativePath) mode = 'reader';
    let readerExcerptTitleDraft = ''; let readerExcerptQuoteDraft = ''; let readerExcerptAnnotationDraft = ''; let readerExcerptStatusText = '';
    for (const [value, label, iconGlyph, tone] of [['source', '资料', BookOpen, 'teal'], ['reader', '原件精读', BookMarked, 'indigo'], ['reading', '札记', FilePlus2, 'blue'], ['excerpt', '摘录', Copy, 'rose'], ['highlights', '高亮批注', Highlighter, 'amber'], ['manuscript', '长稿', Layers, 'purple'], ['all', '全部', Plus, 'slate']]) {
      const tab = element('button', 'ux-pill-option');
      tab.type = 'button';
      tab.dataset.researchMode = value;
      tab.dataset.pillTone = tone;
      tab.setAttribute('role', 'tab');
      tab.append(createElement(iconGlyph, { width: 14, height: 14, 'aria-hidden': 'true' }), element('span', '', label));
      tab.onclick = () => { mode = value; page = 0; void refresh(); };
      tabs.append(tab);
    }
    const search = element('input'); search.type = 'search'; search.id = 'research-search'; search.placeholder = '搜索资料或作者'; search.setAttribute('aria-label', '搜索研究资料');
    const actionsMenu = element('details', 'ux-popover-menu'); actionsMenu.id = 'research-actions-menu';
    const actionsTrigger = element('summary', 'ux-popover-trigger', '+ 新建与导入 ▾'); actionsTrigger.id = 'research-actions-menu-trigger';
    actionsTrigger.setAttribute('aria-label', '新建资料或长稿菜单');
    const actionsPanel = element('div', 'ux-popover-panel'); actionsPanel.setAttribute('role', 'menu');
    const add = button(Plus, '登记资料'); add.id = 'research-add'; add.dataset.shortLabel = '登记资料';
    const importBibToggle = button(Upload, '导入 BibTeX / RIS'); importBibToggle.id = 'research-import-bib-toggle'; importBibToggle.dataset.shortLabel = '导入 Bib/RIS';
    const addManuscript = button(FilePlus2, '新建长稿'); addManuscript.id = 'research-add-manuscript'; addManuscript.dataset.shortLabel = '新建长稿';
    const folderBinderToggle = button(Layers, '多级目录汇编长稿'); folderBinderToggle.id = 'research-folder-binder-toggle'; folderBinderToggle.dataset.shortLabel = '目录汇编长稿';
    actionsPanel.append(add, importBibToggle, addManuscript, folderBinderToggle);
    actionsMenu.append(actionsTrigger, actionsPanel);
    const controls = element('div', 'research-controls');
    controls.append(search, actionsMenu);
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '研究视图');
    toolbar.append(tabs, controls);
    const form = element('form', 'research-form'); form.id = 'research-form'; form.hidden = true; const fields = {};
    for (const [key, label, type] of [['title', '资料标题', 'text'], ['kind', '资料类型', 'select'], ['locator', '来源地址或标识', 'text'], ['author', '作者', 'text'], ['year', '年份', 'text'], ['text', '资料说明', 'textarea']]) {
      const row = element('label', key === 'text' ? 'research-wide' : '', label); const input = element(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input'); if (type === 'text') input.type = 'text'; input.id = 'research-' + key; input.setAttribute('aria-label', label); fields[key] = input;
      if (key === 'kind') input.append(...Object.entries(kinds).map(([value, label]) => new Option(label, value)));
      else input.maxLength = key === 'text' ? 100000 : key === 'locator' ? 2048 : key === 'year' ? 4 : key === 'author' ? 200 : 160;
      if (key === 'title') input.required = true; row.append(input); form.append(row); input.oninput = () => { draft[key] = input.value; clearTimeout(draftTimer); draftState.textContent = '草稿未保存'; draftTimer = setTimeout(() => void persist(), 350); };
    }
    const footer = element('div', 'research-form-footer research-wide'); const draftState = element('small'); const submit = element('button', 'phase-command', '保存资料'); submit.type = 'submit'; submit.id = 'research-save'; footer.append(draftState, submit); form.append(footer);
    const bibForm = element('form', 'research-form'); bibForm.id = 'research-bib-form'; bibForm.hidden = true;
    const bibHeadRow = element('div', 'research-form-footer research-wide');
    const bibFileInput = element('input'); bibFileInput.type = 'file'; bibFileInput.id = 'research-bib-file-input'; bibFileInput.accept = '.bib,.ris,text/plain'; bibFileInput.hidden = true;
    const bibFileBtn = element('button', 'small-command', '选择 .bib / .ris 文件'); bibFileBtn.type = 'button'; bibFileBtn.id = 'research-bib-file-btn';
    bibFileBtn.onclick = () => bibFileInput.click();
    const bibSampleBtn = element('button', 'small-command', '填入 BibTeX / RIS 示例'); bibSampleBtn.type = 'button'; bibSampleBtn.id = 'research-bib-sample-btn';
    const bibTextareaLabel = element('label', 'research-wide', '粘贴或导入 BibTeX (.bib) / RIS (.ris) 文献条目');
    const bibInput = element('textarea'); bibInput.id = 'research-bib-input'; bibInput.setAttribute('aria-label', 'BibTeX 或 RIS 文献内容');
    bibInput.placeholder = '@article{luhmann1992,\n  title = {Communicating with Slip Boxes},\n  author = {Luhmann, Niklas},\n  journal = {Empirical Studies of Literature},\n  year = {1992},\n  volume = {19},\n  number = {2},\n  pages = {53--61},\n  doi = {10.1000/slipbox.1992}\n}';
    bibTextareaLabel.append(bibInput);
    const bibFooter = element('div', 'research-form-footer research-wide');
    const bibStatus = element('small', '', '自动解析作者、年份、标题、期刊/出版社、卷期页码与 DOI，绝不编造缺失字段'); bibStatus.id = 'research-bib-status';
    const bibSubmit = element('button', 'phase-command', '解析并生成资料笔记'); bibSubmit.type = 'submit'; bibSubmit.id = 'research-bib-submit';
    bibHeadRow.append(element('small', '', '支持多条 BibTeX (@article/@book) 与 RIS (TY - JOUR ... ER -) 批量解析入库'), bibFileInput, bibFileBtn, bibSampleBtn);
    bibFooter.append(bibStatus, bibSubmit);
    bibForm.append(bibHeadRow, bibTextareaLabel, bibFooter);
    bibFileInput.onchange = async () => {
      const file = bibFileInput.files?.[0];
      bibFileInput.value = '';
      if (!file) return;
      const content = await file.text();
      bibInput.value = content;
      try {
        const parsed = parseAcademicReferences(content);
        bibStatus.textContent = `已从 ${file.name} 识别 ${parsed.length} 条有效文献条目`;
      } catch (err) {
        bibStatus.textContent = err.message;
      }
    };
    bibSampleBtn.onclick = () => {
      bibInput.value = [
        '@article{luhmann1992slipbox,',
        '  title = {Communicating with Slip Boxes: An Empirical Account},',
        '  author = {Luhmann, Niklas},',
        '  journal = {Journal of Knowledge Systems},',
        '  year = {1992},',
        '  volume = {19},',
        '  number = {2},',
        '  pages = {53--61},',
        '  doi = {10.1000/jks.1992.53}',
        '}',
        '',
        'TY  - BOOK',
        'ID  - ahrens2022smart',
        'TI  - How to Take Smart Notes',
        'AU  - Ahrens, Sönke',
        'PY  - 2022',
        'PB  - CreateSpace Independent Publishing',
        'SP  - 1',
        'EP  - 178',
        'DO  - 10.1000/smartnotes.2022',
        'ER  - ',
      ].join('\n');
      bibStatus.textContent = '已填入 1 条 BibTeX 与 1 条 RIS 示例，点击「解析并生成资料笔记」即可入库';
    };
    const manuscriptForm = element('form', 'research-form'); manuscriptForm.id = 'manuscript-form'; manuscriptForm.hidden = true;
    const msTitleLabel = element('label', '', '长稿标题'); const msTitle = element('input'); msTitle.type = 'text'; msTitle.id = 'manuscript-title'; msTitle.setAttribute('aria-label', '长稿标题'); msTitle.required = true; msTitle.maxLength = 160; msTitleLabel.append(msTitle);
    const msTargetLabel = element('label', '', '目标字数'); const msTarget = element('input'); msTarget.type = 'number'; msTarget.id = 'manuscript-target-words'; msTarget.setAttribute('aria-label', '目标字数'); msTarget.min = '100'; msTarget.max = '2000000'; msTarget.step = '1'; msTarget.value = '3000'; msTargetLabel.append(msTarget);
    const msSynopsisLabel = element('label', 'research-wide', '写作提纲'); const msSynopsis = element('textarea'); msSynopsis.id = 'manuscript-synopsis'; msSynopsis.setAttribute('aria-label', '写作提纲'); msSynopsis.maxLength = 100000; msSynopsisLabel.append(msSynopsis);
    const msFooter = element('div', 'research-form-footer research-wide'); const msHint = element('small', '', '保存后自动建立长稿结构，支持追加章节并内联预览'); const msSave = element('button', 'phase-command', '保存长稿'); msSave.type = 'submit'; msSave.id = 'manuscript-save'; msFooter.append(msHint, msSave);
    manuscriptForm.append(msTitleLabel, msTargetLabel, msSynopsisLabel, msFooter);

    const folderBinderForm = element('form', 'research-form'); folderBinderForm.id = 'folder-binder-form'; folderBinderForm.hidden = true;
    const fbFolderLabel = element('label', '', '选择或输入多级目录路径');
    const fbFolderInput = element('input'); fbFolderInput.type = 'text'; fbFolderInput.id = 'folder-binder-folder-input'; fbFolderInput.setAttribute('aria-label', '长稿绑定多级目录路径');
    fbFolderInput.placeholder = '例如：Inkloom使用方法（留空表示汇编全库）';
    fbFolderInput.value = 'Inkloom使用方法';
    fbFolderLabel.append(fbFolderInput);
    const fbTitleLabel = element('label', '', '汇编长稿标题（可选）');
    const fbTitleInput = element('input'); fbTitleInput.type = 'text'; fbTitleInput.id = 'folder-binder-title-input'; fbTitleInput.setAttribute('aria-label', '汇编长稿标题');
    fbTitleInput.placeholder = '留空将按所选目录名称自动生成';
    fbTitleLabel.append(fbTitleInput);
    const fbFooter = element('div', 'research-form-footer research-wide');
    const fbStatus = element('small', '', '自动递归扫描所选多级目录及其全部子目录，生成分卷/分章字数进度表与内嵌章节长稿'); fbStatus.id = 'folder-binder-status';
    const fbSaveBtn = element('button', 'phase-command', '生成多级目录长稿总览'); fbSaveBtn.type = 'submit'; fbSaveBtn.id = 'folder-binder-save-btn';
    fbFooter.append(fbStatus, fbSaveBtn);
    folderBinderForm.append(fbFolderLabel, fbTitleLabel, fbFooter);
    let citationStyle = 'wikilink';
    let lastCitedNote = null;
    let lastPublishedMsContext = null;
    const citationBar = element('div', 'research-citation-bar'); citationBar.id = 'research-citation-bar'; citationBar.hidden = true;
    const citationStyleBar = element('div', 'segmented-control ux-pill-bar'); citationStyleBar.id = 'research-citation-style-bar';
    citationStyleBar.setAttribute('role', 'tablist'); citationStyleBar.setAttribute('aria-label', '引文格式切换');
    const citationInput = element('input'); citationInput.type = 'text'; citationInput.id = 'research-citation-preview'; citationInput.readOnly = true; citationInput.setAttribute('aria-label', '已生成的引文');
    const citationCopyBtn = element('button', 'small-command', '复制引文'); citationCopyBtn.type = 'button'; citationCopyBtn.id = 'research-citation-copy-btn';
    const syncCitationBarView = () => {
      for (const btn of citationStyleBar.children) {
        btn.setAttribute('aria-selected', String(btn.dataset.citationStyle === citationStyle));
      }
      if (lastCitedNote) {
        try {
          const formatted = formatResearchCitation(lastCitedNote, citationStyle);
          citationInput.value = formatted;
          navigator.clipboard?.writeText(formatted).catch(() => {});
        } catch (err) {
          fail(err);
        }
      }
    };
    for (const [sKey, sLabel] of [['wikilink', '双链引文'], ['gbt7714', 'GB/T 7714-2015'], ['apa', 'APA 7th'], ['bibtex', 'BibTeX']]) {
      const sBtn = element('button', 'ux-pill-option', sLabel);
      sBtn.type = 'button';
      sBtn.dataset.citationStyle = sKey;
      sBtn.setAttribute('role', 'tab');
      sBtn.setAttribute('aria-selected', String(sKey === citationStyle));
      sBtn.onclick = () => {
        citationStyle = sKey;
        pubCiteSelect.value = sKey;
        syncCitationBarView();
      };
      citationStyleBar.append(sBtn);
    }
    citationCopyBtn.onclick = () => {
      if (citationInput.value) navigator.clipboard?.writeText(citationInput.value).catch(() => {});
    };
    citationBar.append(element('small', '', '引文：'), citationStyleBar, citationInput, citationCopyBtn);
    const pubCard = element('div', 'ai-citation-card'); pubCard.id = 'manuscript-publication-card'; pubCard.hidden = true;
    const pubHeader = element('div', 'research-form-footer');
    const pubMeta = element('small', '', ''); pubMeta.id = 'manuscript-publication-meta';
    const pubCiteSelect = element('select'); pubCiteSelect.id = 'manuscript-citation-style-select'; pubCiteSelect.setAttribute('aria-label', '长稿参考文献格式');
    for (const [sKey, sLabel] of [['wikilink', '参考文献：双链引文'], ['gbt7714', '参考文献：GB/T 7714-2015'], ['apa', '参考文献：APA 7th'], ['bibtex', '参考文献：BibTeX']]) {
      pubCiteSelect.append(new Option(sLabel, sKey));
    }
    const renderCurrentPublication = () => {
      if (!lastPublishedMsContext) return;
      currentPublication = compilePublicationManuscript(
        lastPublishedMsContext.note,
        lastPublishedMsContext.loadedChapters,
        {
          citationStyle: pubCiteSelect.value || citationStyle,
          referenceNotes: lastPublishedMsContext.referenceNotes,
        },
      );
      pubMeta.textContent = `《${currentPublication.title}》 · 共 ${currentPublication.chapterCount} 章 · 总计 ${currentPublication.totalWords} 字（达成率 ${currentPublication.completionRate}% · ${pubCiteSelect.options[pubCiteSelect.selectedIndex]?.text || ''}）`;
      renderRichMarkdownDocument(pubPreview, currentPublication.markdown, {
        headerBadge: `📖 出版联排定稿预览 · 《${currentPublication.title}》`,
        rawSource: currentPublication.markdown,
      });
      pubCard.hidden = false;
    };
    pubCiteSelect.onchange = () => {
      citationStyle = pubCiteSelect.value;
      syncCitationBarView();
      renderCurrentPublication();
    };
    const pubSaveBtn = element('button', 'phase-command', '保存出版定稿笔记'); pubSaveBtn.type = 'button'; pubSaveBtn.id = 'manuscript-publication-save';
    pubSaveBtn.prepend(createElement(Check, { width: 14, height: 14, 'aria-hidden': 'true' }));
    const pubEpubBtn = element('button', 'phase-command', '导出 EPUB 3.0 电子书'); pubEpubBtn.type = 'button'; pubEpubBtn.id = 'manuscript-export-epub-btn';
    pubEpubBtn.prepend(createElement(Download, { width: 14, height: 14, 'aria-hidden': 'true' }));
    pubHeader.append(pubMeta, pubCiteSelect, pubSaveBtn, pubEpubBtn);
    const pubPreview = element('article', 'ai-answer-box ai-formatted-answer'); pubPreview.id = 'manuscript-publication-preview';
    pubCard.append(pubHeader, pubPreview);
    const error = element('p', 'database-error'); error.id = 'research-error'; error.hidden = true; error.setAttribute('role', 'alert'); const list = element('div', 'research-list'); list.id = 'research-list';
    const pagination = element('div', 'home-task-footer'); const previous = button(ChevronLeft, '研究资料上一页'); const next = button(ChevronRight, '研究资料下一页'); const count = element('span'); count.id = 'research-count'; pagination.append(previous, count, next); root.append(toolbar, form, bibForm, manuscriptForm, folderBinderForm, citationBar, pubCard, error, list, pagination); container.append(root);
    const fail = reason => { if (!scope.signal.aborted) { error.hidden = false; error.textContent = reason.message; } };
    async function persist(strict = false) { clearTimeout(draftTimer); if (!vaultKey) return; try { drafts = { ...drafts, [vaultKey]: { ...draft } }; await api.setSetting('drafts', drafts); draftState.textContent = '草稿已保存'; } catch (reason) { fail(reason); if (strict) throw reason; } }
    function fill() { for (const [key, input] of Object.entries(fields)) input.value = draft[key] || ''; }
    function lock(value) { if (value) request++; busy = value; for (const control of root.querySelectorAll('button, input, select, textarea')) control.disabled = value; root.setAttribute('aria-busy', String(value)); }
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; lock(true); error.hidden = true;
      try { const source = researchSource(draft); draft.receipt ||= crypto.randomUUID(); await persist(true); const name = draft.title.slice(0, 48).replace(/[\[\]#|]/g, '-') + ' ' + draft.receipt; await api.createNote(name, { folder: 'sources', source, background: true }); draft = { title: '', kind: 'web', locator: '', author: '', year: '', text: '' }; await persist(); if (!scope.signal.aborted) { fill(); form.hidden = true; } }
      catch (reason) { fail(reason); } finally { lock(false); if (!scope.signal.aborted) await refresh(); }
    };
    bibForm.onsubmit = async event => {
      event.preventDefault(); if (busy) return; lock(true); error.hidden = true;
      try {
        const entries = parseAcademicReferences(bibInput.value);
        for (const entry of entries) {
          const source = researchSource(entry);
          const suffix = (entry.citeKey || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 18) || crypto.randomUUID().slice(0, 8);
          const name = entry.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + suffix;
          await api.createNote(name, { folder: 'sources', source, background: true });
        }
        if (!scope.signal.aborted) {
          bibInput.value = '';
          bibStatus.textContent = `已成功导入 ${entries.length} 条文献至 sources/ 目录`;
          bibForm.hidden = true;
          mode = 'source';
          page = 0;
        }
      } catch (reason) { fail(reason); } finally { lock(false); if (!scope.signal.aborted) await refresh(); }
    };
    manuscriptForm.onsubmit = async event => {
      event.preventDefault(); if (busy) return; lock(true); error.hidden = true;
      try {
        const source = manuscriptNote({ title: msTitle.value, targetWords: Number(msTarget.value), synopsis: msSynopsis.value });
        const name = msTitle.value.trim().slice(0, 48).replace(/[\[\]#|]/g, '-') + ' ' + crypto.randomUUID();
        await api.createNote(name, { folder: 'manuscripts', source, background: true });
        if (!scope.signal.aborted) { msTitle.value = ''; msTarget.value = '3000'; msSynopsis.value = ''; manuscriptForm.hidden = true; mode = 'manuscript'; page = 0; }
      } catch (reason) { fail(reason); } finally { lock(false); if (!scope.signal.aborted) await refresh(); }
    };
    folderBinderForm.onsubmit = async event => {
      event.preventDefault(); if (busy) return; lock(true); error.hidden = true;
      try {
        const allNotes = await api.listNotes({ signal: scope.signal });
        const loaded = [];
        for (const item of allNotes) {
          const rec = await api.read(item.id, { signal: scope.signal }).catch(() => null);
          loaded.push({ ...item, source: rec?.source || '' });
        }
        const binder = compileFolderManuscriptBinder(loaded, {
          folderPath: fbFolderInput.value,
          title: fbTitleInput.value,
        });
        const cleanName = binder.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
        await api.createNote(cleanName, { folder: 'manuscripts', source: binder.markdown, background: true });
        if (!scope.signal.aborted) {
          fbStatus.textContent = `已汇编 ${binder.sectionGroupCount} 个子目录组、${binder.chapterCount} 篇章节（共 ${binder.totalWords} 字）至 manuscripts/${cleanName}.md`;
          pubMeta.textContent = `📚 《${binder.title}》 · 绑定目录 ${binder.folderPath || '/'} · 共 ${binder.sectionGroupCount} 个子目录组、${binder.chapterCount} 篇章节 · 累计 ${binder.totalWords} 字`;
          renderRichMarkdownDocument(pubPreview, binder.markdown, {
            headerBadge: `📚 多级目录长稿编排总控台 · 《${binder.title}》`,
            rawSource: binder.markdown,
          });
          pubCard.hidden = false;
          folderBinderForm.hidden = true;
          mode = 'manuscript';
          page = 0;
        }
      } catch (reason) { fail(reason); } finally { lock(false); if (!scope.signal.aborted) await refresh(); }
    };
    add.onclick = () => { actionsMenu.open = false; manuscriptForm.hidden = true; bibForm.hidden = true; folderBinderForm.hidden = true; form.hidden = !form.hidden; if (!form.hidden) fields.title.focus(); };
    importBibToggle.onclick = () => { actionsMenu.open = false; form.hidden = true; manuscriptForm.hidden = true; folderBinderForm.hidden = true; bibForm.hidden = !bibForm.hidden; if (!bibForm.hidden) bibInput.focus(); };
    addManuscript.onclick = () => { actionsMenu.open = false; form.hidden = true; bibForm.hidden = true; folderBinderForm.hidden = true; manuscriptForm.hidden = !manuscriptForm.hidden; if (!manuscriptForm.hidden) msTitle.focus(); };
    folderBinderToggle.onclick = () => { actionsMenu.open = false; form.hidden = true; bibForm.hidden = true; manuscriptForm.hidden = true; folderBinderForm.hidden = !folderBinderForm.hidden; if (!folderBinderForm.hidden) fbFolderInput.focus(); };
    pubSaveBtn.onclick = async () => {
      if (!currentPublication || busy) return; lock(true); error.hidden = true;
      try {
        const cleanName = currentPublication.title.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
        await api.createNote(cleanName, { folder: 'manuscripts', source: currentPublication.markdown, background: true });
        pubMeta.textContent = `已保存出版联排定稿至 manuscripts/${cleanName}.md`;
        currentPublication = null;
      } catch (reason) { fail(reason); }
      finally { lock(false); if (!scope.signal.aborted) await refresh(); }
    };
    pubEpubBtn.onclick = async () => {
      if (!currentPublication || busy) return; lock(true); error.hidden = true;
      try {
        const chaptersForEpub = lastPublishedMsContext?.loadedChapters?.length
          ? lastPublishedMsContext.loadedChapters
          : [{ title: currentPublication.title, source: currentPublication.markdown }];
        const pkg = compileEpub3PackageBytes(chaptersForEpub, {
          bookTitle: currentPublication.title,
        });
        const safeFileName = `${pkg.bookTitle.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48)}.epub`;
        await api.aiConfig('import-raw', { fileName: safeFileName, base64Data: pkg.base64Data }).catch(() => {});
        const blob = new Blob([pkg.bytes], { type: 'application/epub+zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = safeFileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
        pubMeta.textContent = `📚 已打包导出 EPUB 3.0 电子书《${safeFileName}》（共 ${pkg.chapterCount} 章 · ${pkg.totalWords} 字 · 已同步存入 raw/）`;
      } catch (reason) { fail(reason); }
      finally { lock(false); }
    };
    async function refresh() {
      if (busy || scope.signal.aborted) return; if (pointer) { deferred = true; return; }
      deferred = false;
      const token = ++request;
      try {
        const data = await api.queryWorkspace({ researchMode: mode, highlightColor, researchText: search.value, researchPage: page }, { signal: scope.signal, key: 'research-desk' }); if (busy || scope.signal.aborted || token !== request) return; if (pointer) { deferred = true; return; }
        if (vaultKey !== data.vaultKey) { vaultKey = data.vaultKey; drafts = api.getSetting('drafts') || {}; draft = { title: '', kind: 'web', locator: '', author: '', year: '', text: '', ...(drafts[vaultKey] || {}) }; fill(); if (draft.title || draft.text) form.hidden = false; }
        for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.researchMode === mode));
        controls.hidden = mode === 'reader' || mode === 'highlights';
        if (mode !== 'manuscript') pubCard.hidden = true;
        if (mode === 'reader') {
          const docResp = await api.aiConfig('list-reading-docs').catch(() => ({ rawFiles: [] }));
          if (scope.signal.aborted || token !== request) return;
          const readingDocs = Array.isArray(docResp?.rawFiles) ? docResp.rawFiles : [];
          const targetSnapshot = pendingReaderTarget ? { ...pendingReaderTarget } : null;
          if (targetSnapshot?.relativePath) {
            currentReaderPath = targetSnapshot.relativePath;
          } else if (!currentReaderPath || !readingDocs.some(item => item.relativePath.toLowerCase() === currentReaderPath.toLowerCase())) {
            currentReaderPath = readingDocs[0]?.relativePath || '';
            readerSectionIndex = 0;
          }

          const stage = element('div', 'research-reader-stage'); stage.id = 'research-reader-stage';
          const topBar = element('div', 'research-reader-bar');
          const sourceControls = element('div', 'research-reader-source-controls');
          const docSelect = element('select'); docSelect.id = 'reader-doc-select'; docSelect.setAttribute('aria-label', '选择原件文档');
          if (!readingDocs.length) {
            docSelect.append(new Option('暂无 PDF / EPUB 原件（请先导入或载入示例）', ''));
            docSelect.disabled = true;
          } else {
            for (const docItem of readingDocs) {
              const sizeKb = Math.max(1, Math.round((docItem.sizeBytes || 0) / 1024));
              docSelect.append(new Option(`${docItem.name} (${sizeKb} KB)`, docItem.relativePath));
            }
            docSelect.value = currentReaderPath;
          }
          docSelect.onchange = () => {
            currentReaderPath = docSelect.value;
            readerSectionIndex = 0;
            pendingReaderTarget = null;
            activeReaderBbox = null;
            focusedJumpBboxString = '';
            readerExcerptStatusText = '';
            void refresh();
          };

          const layoutModeBar = element('div', 'segmented-control ux-pill-bar reader-layout-mode-bar');
          layoutModeBar.id = 'reader-layout-mode-bar';
          layoutModeBar.setAttribute('role', 'tablist');
          layoutModeBar.setAttribute('aria-label', '阅读版面视图切换');
          for (const [mKey, mLabel] of [['canvas', '原生版面'], ['flow', '书卷流式']]) {
            const mBtn = element('button', 'ux-pill-option', mLabel);
            mBtn.type = 'button';
            mBtn.id = `reader-mode-${mKey}-btn`;
            mBtn.dataset.readerLayoutMode = mKey;
            mBtn.setAttribute('role', 'tab');
            mBtn.setAttribute('aria-selected', String(readerLayoutMode === mKey));
            mBtn.onclick = () => {
              readerLayoutMode = mKey;
              void refresh();
            };
            layoutModeBar.append(mBtn);
          }

          const boxAnnotateBtn = element('button', 'research-reader-quote-btn' + (readerBoxAnnotateMode ? ' is-active' : ''), '✏️ 框选批注');
          boxAnnotateBtn.type = 'button';
          boxAnnotateBtn.id = 'reader-box-annotate-toggle';
          boxAnnotateBtn.setAttribute('aria-pressed', String(readerBoxAnnotateMode));
          boxAnnotateBtn.title = '在 PDF 原生版面画布上拖拽框选区域高亮并生成区域缩略图摘录';
          boxAnnotateBtn.onclick = () => {
            readerBoxAnnotateMode = !readerBoxAnnotateMode;
            if (readerBoxAnnotateMode && readerLayoutMode !== 'canvas') readerLayoutMode = 'canvas';
            void refresh();
          };

          const fileInput = element('input'); fileInput.type = 'file'; fileInput.id = 'reader-file-input'; fileInput.accept = '.pdf,.epub'; fileInput.hidden = true;
          fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file || busy) return;
            lock(true); error.hidden = true;
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const imported = await api.aiConfig('import-raw', { fileName: file.name, base64Data: uint8ArrayToBase64(bytes) });
              currentReaderPath = imported?.importedPath || `raw/${file.name}`;
              readerSectionIndex = 0;
              pendingReaderTarget = null;
              activeReaderBbox = null;
              readerExcerptStatusText = `已导入原件 ${currentReaderPath}`;
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };

          const readerToolsMenu = element('details', 'ux-popover-menu');
          readerToolsMenu.id = 'reader-tools-menu';
          readerToolsMenu.open = readerToolsMenuOpenState;
          readerToolsMenu.addEventListener('toggle', () => {
            if (readerToolsMenu.isConnected) readerToolsMenuOpenState = readerToolsMenu.open;
          });
          const readerToolsTrigger = element('summary', 'ux-popover-trigger', '阅读与原件 ▾');
          readerToolsTrigger.id = 'reader-tools-menu-trigger';
          readerToolsTrigger.setAttribute('aria-label', '阅读版面与原件管理菜单');
          const readerToolsPanel = element('div', 'ux-popover-panel reader-tools-popover');
          readerToolsPanel.setAttribute('role', 'menu');

          const importBtn = element('button', 'phase-command', '导入 PDF / EPUB'); importBtn.type = 'button'; importBtn.id = 'reader-import-btn';
          importBtn.prepend(createElement(Upload, { width: 13, height: 13, 'aria-hidden': 'true' }));
          importBtn.onclick = () => { readerToolsMenuOpenState = false; readerToolsMenu.open = false; fileInput.click(); };

          const samplePdfBtn = element('button', 'research-reader-quote-btn', '示例 PDF'); samplePdfBtn.type = 'button'; samplePdfBtn.id = 'reader-sample-pdf-btn';
          samplePdfBtn.onclick = async () => {
            readerToolsMenuOpenState = false;
            readerToolsMenu.open = false;
            if (busy) return; lock(true); error.hidden = true;
            try {
              const bytes = buildSampleOfficeFileBytes('pdf', '智能制造与双链溯源规范');
              await api.aiConfig('import-raw', { fileName: '智能制造与双链溯源规范.pdf', base64Data: uint8ArrayToBase64(bytes) }).catch(() => {});
              currentReaderPath = 'raw/智能制造与双链溯源规范.pdf';
              readerSectionIndex = 0;
              pendingReaderTarget = null;
              activeReaderBbox = null;
              readerExcerptStatusText = '已载入 2 页示例 PDF 原件';
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };

          const sampleEpubBtn = element('button', 'research-reader-quote-btn', '示例 EPUB'); sampleEpubBtn.type = 'button'; sampleEpubBtn.id = 'reader-sample-epub-btn';
          sampleEpubBtn.onclick = async () => {
            readerToolsMenuOpenState = false;
            readerToolsMenu.open = false;
            if (busy) return; lock(true); error.hidden = true;
            try {
              const bytes = buildSampleOfficeFileBytes('epub', '卡片盒与知识图谱精读');
              await api.aiConfig('import-raw', { fileName: '卡片盒与知识图谱精读.epub', base64Data: uint8ArrayToBase64(bytes) }).catch(() => {});
              currentReaderPath = 'raw/卡片盒与知识图谱精读.epub';
              readerSectionIndex = 0;
              pendingReaderTarget = null;
              activeReaderBbox = null;
              readerExcerptStatusText = '已载入 2 章示例 EPUB 电子书';
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };

          sourceControls.append(docSelect, layoutModeBar, boxAnnotateBtn, fileInput);
          topBar.append(sourceControls);
          stage.append(topBar);

          if (!currentReaderPath) {
            readerToolsPanel.append(importBtn, samplePdfBtn, sampleEpubBtn);
            readerToolsMenu.append(readerToolsTrigger, readerToolsPanel);
            sourceControls.append(readerToolsMenu);
            const emptyBox = element('div', 'research-reader-empty'); emptyBox.id = 'reader-empty-state';
            emptyBox.append(
              element('h3', '', '尚未打开 PDF 或 EPUB 原件'),
              element('p', '', '在 raw/ 目录中放入或点击右上角「阅读与原件 ▾ → 导入 PDF / EPUB」即可按原生版面画布或章节精读原件，并生成带 64 位 SHA-256 哈希与精确区域坐标的可溯源摘录卡。'),
            );
            stage.append(emptyBox);
            list.replaceChildren(stage);
            count.textContent = '0 份原件'; previous.disabled = true; next.disabled = true; root.dataset.ready = 'true';
            return;
          }

          let rawRecord;
          try {
            rawRecord = await api.aiConfig('read-raw', { relativePath: currentReaderPath });
          } catch (readErr) {
            pendingReaderTarget = null;
            fail(readErr);
            list.replaceChildren(stage);
            count.textContent = readingDocs.length + ' 份原件'; previous.disabled = true; next.disabled = true; root.dataset.ready = 'true';
            return;
          }
          if (scope.signal.aborted || token !== request) return;
          const parsedDoc = await parseRawDocumentFile(rawRecord);
          if (scope.signal.aborted || token !== request) return;
          const isPdf = /\.pdf$/i.test(rawRecord.relativePath);
          const sections = Array.isArray(parsedDoc.sections) && parsedDoc.sections.length
            ? parsedDoc.sections
            : [{ heading: parsedDoc.title || rawRecord.name, location: isPdf ? 'Page 1' : 'epubcfi(/6/2!/4/2/1:0)', page: 1, cfi: 'epubcfi(/6/2!/4/2/1:0)', text: '（未提取到正文段落）' }];

          let hashMismatch = false;
          if (targetSnapshot && targetSnapshot.relativePath.toLowerCase() === rawRecord.relativePath.toLowerCase()) {
            if (targetSnapshot.sourceHash && targetSnapshot.sourceHash !== rawRecord.sha256) {
              hashMismatch = true;
              error.hidden = false;
              error.textContent = `原件 SHA-256 校验不一致：摘录记录为 ${targetSnapshot.sourceHash.slice(0, 8)}，当前原件为 ${rawRecord.sha256.slice(0, 8)}`;
            }
            if (isPdf && Number.isInteger(targetSnapshot.page)) {
              readerSectionIndex = Math.max(0, Math.min(sections.length - 1, targetSnapshot.page - 1));
            } else if (!isPdf && targetSnapshot.cfi) {
              const cfiIdx = sections.findIndex(sec => sec.cfi === targetSnapshot.cfi || sec.location === targetSnapshot.cfi);
              if (cfiIdx >= 0) readerSectionIndex = cfiIdx;
            }
            if (targetSnapshot.bboxString) {
              focusedJumpBboxString = targetSnapshot.bboxString;
              readerLayoutMode = 'canvas';
            }
            pendingReaderTarget = null;
          }
          readerSectionIndex = Math.max(0, Math.min(sections.length - 1, readerSectionIndex));
          const currentSection = sections[readerSectionIndex];
          const currentPageNum = readerSectionIndex + 1;
          const currentCfi = currentSection.cfi || `epubcfi(/6/${currentPageNum * 2}!/4/2/1:0)`;
          window.__inkloomRecordReaderMru?.({
            relativePath: rawRecord.relativePath,
            title: parsedDoc.title || rawRecord.name,
            page: isPdf ? currentPageNum : undefined,
            cfi: !isPdf ? currentCfi : undefined,
          });
          const searchStats = searchDocumentSections(sections, readerSearchQuery);
          const allExcerptsResp = await api.queryWorkspace({ researchMode: 'excerpt', researchPage: 0 }, { signal: scope.signal, key: 'research-desk-reader-excerpts' }).catch(() => ({ research: [] }));
          const docExcerpts = (allExcerptsResp?.research || []).filter(item => item.sourceFile === rawRecord.relativePath || (typeof item.sourceReference === 'string' && item.sourceReference.includes(encodeURIComponent(rawRecord.relativePath))));

          const navControls = element('div', 'research-reader-nav-controls');
          const readerSearch = element('input', 'research-reader-search-input');
          readerSearch.type = 'search'; readerSearch.id = 'reader-search-input';
          readerSearch.placeholder = '页内检索关键词...'; readerSearch.setAttribute('aria-label', '原件页内检索');
          readerSearch.value = readerSearchQuery;
          readerSearch.oninput = () => {
            readerSearchQuery = readerSearch.value;
            const nextStats = searchDocumentSections(sections, readerSearchQuery);
            if (nextStats.matchedIndices.length && !nextStats.matchedIndices.includes(readerSectionIndex)) {
              readerSectionIndex = nextStats.matchedIndices[0];
            }
            void refresh().then(() => {
              const el = root.querySelector('#reader-search-input');
              if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
            });
          };
          const searchHitBtn = element('button', 'research-reader-quote-btn');
          searchHitBtn.type = 'button'; searchHitBtn.id = 'reader-search-next-btn';
          if (readerSearchQuery.trim()) {
            searchHitBtn.textContent = searchStats.totalMatches > 0
              ? `命中 ${searchStats.totalMatches} 处 (${searchStats.matchedIndices.length}${isPdf ? '页' : '章'}) · 下一处`
              : '无匹配';
            searchHitBtn.disabled = searchStats.matchedIndices.length === 0;
            searchHitBtn.onclick = () => {
              if (!searchStats.matchedIndices.length) return;
              const curHitPos = searchStats.matchedIndices.indexOf(readerSectionIndex);
              const nextIdx = searchStats.matchedIndices[(curHitPos + 1) % searchStats.matchedIndices.length];
              readerSectionIndex = nextIdx;
              void refresh();
            };
          } else {
            searchHitBtn.hidden = true;
          }

          const hashBadge = element('span', 'research-reader-hash-badge' + (hashMismatch ? ' is-mismatch' : ''), `${isPdf ? 'PDF' : 'EPUB'} · SHA-256 ${rawRecord.sha256.slice(0, 8)} ${hashMismatch ? '⚠ 校验不符' : '✓'}`);
          hashBadge.id = 'reader-hash-badge';
          const prevSecBtn = button(ChevronLeft, isPdf ? '原件上一页' : '原件上一章'); prevSecBtn.id = 'reader-prev-btn';
          prevSecBtn.disabled = readerSectionIndex <= 0;
          prevSecBtn.onclick = () => { if (readerSectionIndex > 0) { readerSectionIndex--; activeQuotedParagraphIdx = -1; activeReaderBbox = null; void refresh(); } };
          const tocSelect = element('select'); tocSelect.id = 'reader-toc-select'; tocSelect.setAttribute('aria-label', '跳转页码或章节');
          sections.forEach((sec, idx) => {
            const label = isPdf ? `第 ${idx + 1} 页 · ${sec.heading.replace(/^\[Page \d+\]\s*/, '')}` : `第 ${idx + 1} 章 · ${sec.heading}`;
            tocSelect.append(new Option(label, String(idx)));
          });
          tocSelect.value = String(readerSectionIndex);
          tocSelect.onchange = () => { readerSectionIndex = Number(tocSelect.value) || 0; activeQuotedParagraphIdx = -1; activeReaderBbox = null; void refresh(); };
          const nextSecBtn = button(ChevronRight, isPdf ? '原件下一页' : '原件下一章'); nextSecBtn.id = 'reader-next-btn';
          nextSecBtn.disabled = readerSectionIndex >= sections.length - 1;
          nextSecBtn.onclick = () => { if (readerSectionIndex < sections.length - 1) { readerSectionIndex++; activeQuotedParagraphIdx = -1; activeReaderBbox = null; void refresh(); } };
          const posLabel = element('small', '', `第 ${currentPageNum} / ${sections.length} ${isPdf ? '页' : '章'}`); posLabel.id = 'reader-position-label';

          const spreadToggleBtn = element('button', 'research-reader-quote-btn' + (readerSpreadMode ? ' is-active' : ''), readerSpreadMode ? '📖 双页并排：开启' : '📖 双页并排视图');
          spreadToggleBtn.type = 'button';
          spreadToggleBtn.id = 'reader-spread-toggle';
          spreadToggleBtn.setAttribute('aria-pressed', String(readerSpreadMode));
          spreadToggleBtn.onclick = () => {
            readerToolsMenuOpenState = false;
            readerToolsMenu.open = false;
            readerSpreadMode = !readerSpreadMode;
            if (readerSpreadMode) readerLayoutMode = 'canvas';
            void refresh();
          };
          const zoomOutBtn = element('button', 'research-reader-quote-btn', '缩放 -');
          zoomOutBtn.type = 'button'; zoomOutBtn.id = 'reader-zoom-out-btn';
          zoomOutBtn.onclick = () => { readerZoomPercent = Math.max(75, readerZoomPercent - 15); void refresh(); };
          const zoomResetBtn = element('button', 'research-reader-quote-btn', `${readerZoomPercent}%`);
          zoomResetBtn.type = 'button'; zoomResetBtn.id = 'reader-zoom-reset-btn';
          zoomResetBtn.onclick = () => { readerZoomPercent = 100; void refresh(); };
          const zoomInBtn = element('button', 'research-reader-quote-btn', '缩放 +');
          zoomInBtn.type = 'button'; zoomInBtn.id = 'reader-zoom-in-btn';
          zoomInBtn.onclick = () => { readerZoomPercent = Math.min(145, readerZoomPercent + 15); void refresh(); };
          const fontDecBtn = element('button', 'research-reader-quote-btn', 'A-'); fontDecBtn.type = 'button'; fontDecBtn.id = 'reader-font-dec-btn'; fontDecBtn.title = '缩小阅读字号';
          fontDecBtn.onclick = () => { readerFontScale = Math.max(12.5, readerFontScale - 1); paper.style.setProperty('--reader-font-size', readerFontScale + 'px'); };
          const fontIncBtn = element('button', 'research-reader-quote-btn', 'A+'); fontIncBtn.type = 'button'; fontIncBtn.id = 'reader-font-inc-btn'; fontIncBtn.title = '放大阅读字号';
          fontIncBtn.onclick = () => { readerFontScale = Math.min(18.5, readerFontScale + 1); paper.style.setProperty('--reader-font-size', readerFontScale + 'px'); };

          const openSplitBtn = element('button', 'research-reader-quote-btn', '分屏对照写笔记'); openSplitBtn.type = 'button'; openSplitBtn.id = 'reader-open-split-pane-btn';
          openSplitBtn.onclick = () => {
            readerToolsMenuOpenState = false;
            readerToolsMenu.open = false;
            window.__inkloomOpenRawInSplitPane?.(rawRecord.relativePath, {
              page: isPdf ? currentPageNum : undefined,
              cfi: !isPdf ? currentCfi : undefined,
            });
          };
          const quoteAllBtn = element('button', 'research-reader-quote-btn', isPdf ? '摘录本页全文' : '摘录本章全文'); quoteAllBtn.type = 'button'; quoteAllBtn.id = 'reader-quote-section-btn';
          const openReaderWinBtn = element('button', 'research-reader-quote-btn', '↗ 新窗口打开阅读器'); openReaderWinBtn.type = 'button'; openReaderWinBtn.id = 'reader-open-window-btn';
          openReaderWinBtn.onclick = () => {
            readerToolsMenuOpenState = false;
            readerToolsMenu.open = false;
            window.__inkloomOpenSecondaryWindow?.({
              targetType: 'reader',
              targetId: rawRecord.relativePath,
              title: parsedDoc.title || rawRecord.name,
              relativePath: rawRecord.relativePath,
              readerPage: isPdf ? currentPageNum : undefined,
              readerCfi: !isPdf ? currentCfi : undefined,
            });
          };

          const toolsGroupView = element('div', 'ux-popover-group');
          toolsGroupView.append(spreadToggleBtn, zoomOutBtn, zoomResetBtn, zoomInBtn, fontDecBtn, fontIncBtn);
          const toolsGroupActions = element('div', 'ux-popover-group');
          toolsGroupActions.append(openSplitBtn, quoteAllBtn, openReaderWinBtn);
          const toolsGroupFiles = element('div', 'ux-popover-group');
          toolsGroupFiles.append(importBtn, samplePdfBtn, sampleEpubBtn, hashBadge);
          readerToolsPanel.append(toolsGroupView, toolsGroupActions, toolsGroupFiles);
          readerToolsMenu.append(readerToolsTrigger, readerToolsPanel);

          navControls.append(prevSecBtn, tocSelect, nextSecBtn, posLabel, readerSearch, searchHitBtn, readerToolsMenu);
          topBar.append(navControls);

          const workspace = element('div', 'research-reader-workspace');
          const paper = element('article', 'research-reader-paper' + (!isPdf ? ' reader-epub-sandbox' : '')); paper.id = 'reader-paper';
          paper.style.setProperty('--reader-font-size', readerFontScale + 'px');
          paper.style.setProperty('--reader-canvas-zoom', String(readerZoomPercent / 100));
          paper.dataset.readerPath = rawRecord.relativePath;
          paper.dataset.readerPage = String(currentPageNum);
          paper.dataset.readerCfi = isPdf ? '' : currentCfi;
          paper.dataset.readerLayout = readerLayoutMode;
          paper.dataset.readerSpread = String(readerSpreadMode);
          const paperHead = element('div', 'research-reader-paper-head');
          const titleBox = element('div', 'research-reader-paper-titles');
          const docHeading = element('h3', '', parsedDoc.title || rawRecord.name); docHeading.id = 'reader-doc-title';
          const secHeading = element('small', '', currentSection.heading); secHeading.id = 'reader-section-title';
          titleBox.append(docHeading, secHeading);
          const locatorGroup = element('div', 'research-reader-locator-group');
          const locatorCode = element('code', 'research-reader-locator-code', isPdf ? `Page ${currentPageNum}` : currentCfi); locatorCode.id = 'reader-current-locator';
          locatorGroup.append(locatorCode);
          paperHead.append(titleBox, locatorGroup);

          const bodyContainer = element('div', 'research-reader-body'); bodyContainer.id = 'reader-page-content';
          const paragraphs = String(currentSection.text || '').split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
          if (!paragraphs.length) paragraphs.push('（本页无文本段落）');

          const aside = element('aside', 'research-reader-aside');
          const exForm = element('form', 'research-reader-excerpt-form'); exForm.id = 'reader-excerpt-form';
          const exFormTitle = element('h4', '', '创建可溯源摘录卡');
          const exProv = element('small', '', `出处锚点：${rawRecord.relativePath} · ${isPdf ? '第 ' + currentPageNum + ' 页' : currentCfi}`); exProv.id = 'reader-excerpt-provenance';
          const bboxPreviewBox = element('div', 'reader-bbox-preview-box');
          bboxPreviewBox.id = 'reader-bbox-preview-badge';
          bboxPreviewBox.hidden = !activeReaderBbox;
          const bboxPreviewText = element('small', '', '');
          bboxPreviewText.id = 'reader-bbox-preview-text';
          const bboxPreviewImg = element('img', 'reader-bbox-preview-img');
          bboxPreviewImg.id = 'reader-bbox-preview-img';
          bboxPreviewImg.alt = '区域版面快照预览';
          const bboxClearBtn = element('button', 'research-reader-quote-btn', '清除区域');
          bboxClearBtn.type = 'button';
          bboxClearBtn.id = 'reader-bbox-clear-btn';
          bboxPreviewBox.append(bboxPreviewText, bboxPreviewImg, bboxClearBtn);
          const exTitleLabel = element('label', '', '摘录标题');
          const exTitleInput = element('input'); exTitleInput.type = 'text'; exTitleInput.id = 'reader-excerpt-title'; exTitleInput.setAttribute('aria-label', '摘录标题'); exTitleInput.maxLength = 160;
          exTitleInput.placeholder = `${parsedDoc.title || rawRecord.name} · ${isPdf ? '第 ' + currentPageNum + ' 页摘录' : currentSection.heading}`;
          exTitleInput.value = readerExcerptTitleDraft;
          exTitleInput.oninput = () => { readerExcerptTitleDraft = exTitleInput.value; };
          exTitleLabel.append(exTitleInput);

          const exQuoteLabel = element('label', '', '原文摘录快照');
          const exQuoteInput = element('textarea'); exQuoteInput.id = 'reader-excerpt-quote'; exQuoteInput.setAttribute('aria-label', '原文摘录快照'); exQuoteInput.maxLength = 20000; exQuoteInput.required = true;
          exQuoteInput.placeholder = '在左侧版面画布框选区域、点击段落「摘录此段」或划词选中...';
          exQuoteInput.value = readerExcerptQuoteDraft;
          exQuoteInput.oninput = () => { readerExcerptQuoteDraft = exQuoteInput.value; };
          exQuoteLabel.append(exQuoteInput);

          const exNoteLabel = element('label', '', '我的批注');
          const exNoteInput = element('textarea'); exNoteInput.id = 'reader-excerpt-annotation'; exNoteInput.setAttribute('aria-label', '我的批注'); exNoteInput.maxLength = 20000;
          exNoteInput.placeholder = '记录您的思考、疑问或关联双链 [[...]]';
          exNoteInput.value = readerExcerptAnnotationDraft;
          exNoteInput.oninput = () => { readerExcerptAnnotationDraft = exNoteInput.value; };
          exNoteLabel.append(exNoteInput);

          const exFooter = element('div', 'research-form-footer');
          const exStatus = element('small', '', readerExcerptStatusText); exStatus.id = 'reader-excerpt-status';
          const exSaveBtn = element('button', 'phase-command', '保存可溯源摘录卡'); exSaveBtn.type = 'submit'; exSaveBtn.id = 'reader-save-excerpt';
          exFooter.append(exStatus, exSaveBtn);
          exForm.append(exFormTitle, exProv, bboxPreviewBox, exTitleLabel, exQuoteLabel, exNoteLabel, exFooter);

          const syncBboxPreviewUi = () => {
            if (!activeReaderBbox) {
              bboxPreviewBox.hidden = true;
              exProv.textContent = `出处锚点：${rawRecord.relativePath} · ${isPdf ? '第 ' + currentPageNum + ' 页' : currentCfi}`;
              return;
            }
            const norm = normalizeReaderBbox(activeReaderBbox);
            if (!norm) {
              bboxPreviewBox.hidden = true;
              return;
            }
            bboxPreviewBox.hidden = false;
            bboxPreviewText.textContent = `📐 已框选页面区域 ${norm.label}`;
            bboxPreviewImg.src = renderPageRegionSvgThumbnail({
              title: parsedDoc.title || rawRecord.name,
              page: currentPageNum,
              bbox: norm,
              snippet: exQuoteInput.value || '',
            });
            exProv.textContent = `出处锚点：${rawRecord.relativePath} · 第 ${currentPageNum} 页 · 区域 ${norm.label}`;
          };
          bboxClearBtn.onclick = () => {
            activeReaderBbox = null;
            syncBboxPreviewUi();
            void refresh();
          };

          const applyQuoteToForm = (textValue, paraIdx = -1, bboxVal = null) => {
            const cleanQuote = String(textValue || '').trim();
            if (!cleanQuote) return;
            activeQuotedParagraphIdx = paraIdx;
            activeReaderBbox = bboxVal ? normalizeReaderBbox(bboxVal) : null;
            readerExcerptQuoteDraft = cleanQuote;
            exQuoteInput.value = cleanQuote;
            if (!exTitleInput.value.trim()) {
              const suggested = `${parsedDoc.title || rawRecord.name} · ${isPdf ? '第 ' + currentPageNum + ' 页' + (activeReaderBbox ? '区域摘录' : '摘录') : currentSection.heading}`;
              readerExcerptTitleDraft = suggested.slice(0, 80);
              exTitleInput.value = readerExcerptTitleDraft;
            }
            syncBboxPreviewUi();
            for (const rowEl of bodyContainer.querySelectorAll('.research-reader-paragraph')) {
              rowEl.classList.toggle('is-quoted', Number(rowEl.dataset.paraIndex) === paraIdx);
            }
          };
          syncBboxPreviewUi();

          // Render MAJOR-180 Native Page Layout Canvas & Interactive Box-Selection Stage
          const canvasStage = element('div', 'reader-canvas-stage' + (readerSpreadMode ? ' is-spread' : ''));
          canvasStage.id = 'reader-canvas-stage';
          canvasStage.hidden = readerLayoutMode !== 'canvas';
          const spreadPages = [{ sec: currentSection, pageNo: currentPageNum, primary: true }];
          if (readerSpreadMode && readerSectionIndex + 1 < sections.length) {
            spreadPages.push({ sec: sections[readerSectionIndex + 1], pageNo: currentPageNum + 1, primary: false });
          }

          for (const pageSpec of spreadPages) {
            const sheet = element('div', 'reader-page-sheet' + (readerBoxAnnotateMode ? ' is-box-mode' : ''));
            sheet.dataset.sheetPage = String(pageSpec.pageNo);
            const pageCanvas = element('canvas', 'reader-pdf-page-canvas');
            pageCanvas.width = 560;
            pageCanvas.height = 760;
            if (pageSpec.primary) pageCanvas.id = 'reader-pdf-canvas-primary';
            const layoutBlocks = computePageLayoutBlocks(pageSpec.sec, pageSpec.pageNo);

            const ctx = pageCanvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
              ctx.strokeStyle = '#d6dce5';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(18, 18, pageCanvas.width - 36, pageCanvas.height - 36);
              ctx.fillStyle = '#64748b';
              ctx.font = '600 11px Manrope, sans-serif';
              ctx.fillText(`${(parsedDoc.title || rawRecord.name).slice(0, 32)} · PAGE ${pageSpec.pageNo}`, 36, 40);
              ctx.strokeStyle = '#e2e8f0';
              ctx.beginPath();
              ctx.moveTo(36, 48);
              ctx.lineTo(pageCanvas.width - 36, 48);
              ctx.stroke();
              for (const blk of layoutBlocks) {
                const bx = Math.round(blk.x * pageCanvas.width);
                const by = Math.round(blk.y * pageCanvas.height);
                const bw = Math.round(blk.w * pageCanvas.width);
                const bh = Math.round(blk.h * pageCanvas.height);
                ctx.fillStyle = blk.kind === 'heading' ? '#f8fafc' : '#fcfcfd';
                ctx.fillRect(bx, by, bw, bh);
                ctx.strokeStyle = blk.kind === 'heading' ? '#cbd5e1' : '#eef2f6';
                ctx.strokeRect(bx, by, bw, bh);
                ctx.fillStyle = blk.kind === 'heading' ? '#0f172a' : '#334155';
                ctx.font = blk.kind === 'heading' ? '700 13px Manrope, sans-serif' : '400 11.5px Literata, serif';
                const snippetLine = String(blk.text || '').slice(0, 42);
                ctx.fillText(snippetLine, bx + 8, by + 22);
                if (blk.text && blk.text.length > 42) {
                  ctx.fillText(String(blk.text).slice(42, 84), bx + 8, by + 40);
                }
              }
              ctx.fillStyle = '#94a3b8';
              ctx.font = '500 10.5px Manrope, sans-serif';
              ctx.fillText(`— ${pageSpec.pageNo} / ${sections.length} —`, pageCanvas.width / 2 - 22, pageCanvas.height - 26);
            }

            const overlay = element('div', 'reader-page-overlay');
            if (pageSpec.primary) overlay.id = 'reader-page-overlay-primary';
            overlay.dataset.overlayPage = String(pageSpec.pageNo);

            for (const blk of layoutBlocks) {
              const blkNode = element('div', 'reader-layout-block is-' + blk.kind);
              blkNode.dataset.layoutBlockIndex = String(blk.index);
              blkNode.style.left = `${blk.x * 100}%`;
              blkNode.style.top = `${blk.y * 100}%`;
              blkNode.style.width = `${blk.w * 100}%`;
              blkNode.style.height = `${blk.h * 100}%`;
              blkNode.title = `点击摘录此版面区域（或按住左键拖拽自由框选）：${blk.text.slice(0, 60)}`;
              blkNode.textContent = blk.text;
              blkNode.onclick = evt => {
                if (readerBoxAnnotateMode) return;
                evt.stopPropagation();
                applyQuoteToForm(blk.text, blk.index, { x: blk.x, y: blk.y, w: blk.w, h: blk.h });
              };
              overlay.append(blkNode);
            }

            const pageExcerpts = docExcerpts.filter(ex => {
              const loc = parseDocumentSourceLink(ex.sourceReference || '');
              return (Number(ex.sourcePage) || loc?.page || 1) === pageSpec.pageNo && (ex.sourceBbox || loc?.bboxString);
            });
            for (const exItem of pageExcerpts) {
              try {
                const loc = parseDocumentSourceLink(exItem.sourceReference || '');
                const normBbox = normalizeReaderBbox(exItem.sourceBbox || loc?.bboxString);
                if (!normBbox) continue;
                const hlBox = element('button', 'reader-bbox-highlight' + (focusedJumpBboxString === normBbox.bboxString ? ' is-focused' : ''));
                hlBox.type = 'button';
                hlBox.dataset.bboxExcerptId = exItem.id;
                hlBox.dataset.bboxCoords = normBbox.bboxString;
                hlBox.style.left = `${normBbox.x * 100}%`;
                hlBox.style.top = `${normBbox.y * 100}%`;
                hlBox.style.width = `${normBbox.w * 100}%`;
                hlBox.style.height = `${normBbox.h * 100}%`;
                hlBox.title = `已存框选批注：《${exItem.title}》 ${normBbox.label}（点击打开摘录卡）`;
                hlBox.append(element('span', 'reader-bbox-tag', `${exItem.title.slice(0, 14)} ${normBbox.label}`));
                hlBox.onclick = evt => {
                  evt.stopPropagation();
                  api.open(exItem.id).catch(fail);
                };
                overlay.append(hlBox);
              } catch {}
            }

            if (pageSpec.primary) {
              const activeSelBox = element('div', 'reader-active-selection-box');
              activeSelBox.id = 'reader-active-selection-box';
              if (activeReaderBbox) {
                activeSelBox.style.left = `${activeReaderBbox.x * 100}%`;
                activeSelBox.style.top = `${activeReaderBbox.y * 100}%`;
                activeSelBox.style.width = `${activeReaderBbox.w * 100}%`;
                activeSelBox.style.height = `${activeReaderBbox.h * 100}%`;
              } else {
                activeSelBox.hidden = true;
              }
              overlay.append(activeSelBox);

              let dragStart = null;
              overlay.addEventListener('pointerdown', evt => {
                if (evt.button !== 0 || evt.target.closest('.reader-bbox-highlight')) return;
                if (!readerBoxAnnotateMode && evt.target.closest('.reader-layout-block')) return;
                const rect = overlay.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const sx = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
                const sy = Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height));
                dragStart = { x: sx, y: sy, rect };
                activeSelBox.hidden = false;
                activeSelBox.style.left = `${sx * 100}%`;
                activeSelBox.style.top = `${sy * 100}%`;
                activeSelBox.style.width = '1%';
                activeSelBox.style.height = '1%';
                evt.preventDefault();
              });
              overlay.addEventListener('pointermove', evt => {
                if (!dragStart) return;
                const { rect } = dragStart;
                const cx = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
                const cy = Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height));
                const x = Math.min(dragStart.x, cx);
                const y = Math.min(dragStart.y, cy);
                const w = Math.max(0.02, Math.abs(cx - dragStart.x));
                const h = Math.max(0.02, Math.abs(cy - dragStart.y));
                activeSelBox.style.left = `${x * 100}%`;
                activeSelBox.style.top = `${y * 100}%`;
                activeSelBox.style.width = `${w * 100}%`;
                activeSelBox.style.height = `${h * 100}%`;
              });
              const finishDrag = evt => {
                if (!dragStart) return;
                const { rect } = dragStart;
                const cx = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
                const cy = Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height));
                let x = Math.min(dragStart.x, cx);
                let y = Math.min(dragStart.y, cy);
                let w = Math.abs(cx - dragStart.x);
                let h = Math.abs(cy - dragStart.y);
                dragStart = null;
                if (w < 0.03 && h < 0.03) {
                  x = Math.max(0.06, Math.min(0.7, x));
                  y = Math.max(0.16, Math.min(0.7, y));
                  w = 0.84;
                  h = 0.24;
                }
                const extracted = extractTextFromPageRegion(layoutBlocks, { x, y, w, h });
                if (extracted.bbox) {
                  activeSelBox.hidden = false;
                  activeSelBox.style.left = `${extracted.bbox.x * 100}%`;
                  activeSelBox.style.top = `${extracted.bbox.y * 100}%`;
                  activeSelBox.style.width = `${extracted.bbox.w * 100}%`;
                  activeSelBox.style.height = `${extracted.bbox.h * 100}%`;
                  applyQuoteToForm(extracted.text, -1, extracted.bbox);
                }
              };
              overlay.addEventListener('pointerup', finishDrag);
            }

            sheet.append(pageCanvas, overlay);
            canvasStage.append(sheet);
          }

          const buildHighlightedParagraph = (pNode, rawText, queryStr) => {
            const qClean = String(queryStr || '').trim();
            if (!qClean) {
              pNode.textContent = rawText;
              return;
            }
            const lowerText = rawText.toLocaleLowerCase();
            const lowerQ = qClean.toLocaleLowerCase();
            let cursor = 0;
            let matchPos = lowerText.indexOf(lowerQ, cursor);
            if (matchPos === -1) {
              pNode.textContent = rawText;
              return;
            }
            while (matchPos !== -1) {
              if (matchPos > cursor) pNode.append(document.createTextNode(rawText.slice(cursor, matchPos)));
              const mark = element('mark', 'reader-search-hit', rawText.slice(matchPos, matchPos + qClean.length));
              pNode.append(mark);
              cursor = matchPos + qClean.length;
              matchPos = lowerText.indexOf(lowerQ, cursor);
            }
            if (cursor < rawText.length) pNode.append(document.createTextNode(rawText.slice(cursor)));
          };

          quoteAllBtn.onclick = () => { readerToolsMenuOpenState = false; readerToolsMenu.open = false; applyQuoteToForm(paragraphs.join('\n'), -1, null); };
          paragraphs.forEach((paraText, pIdx) => {
            const pRow = element('div', 'research-reader-paragraph' + (pIdx === activeQuotedParagraphIdx ? ' is-quoted' : ''));
            pRow.dataset.paraIndex = String(pIdx);
            const pIdxBadge = element('span', 'research-reader-para-index', `¶${pIdx + 1}`);
            const pText = element('p', '');
            buildHighlightedParagraph(pText, paraText, readerSearchQuery);
            const qBtn = element('button', 'research-reader-quote-btn', '摘录此段'); qBtn.type = 'button';
            qBtn.dataset.readerParagraphQuote = String(pIdx);
            qBtn.onclick = () => applyQuoteToForm(paraText, pIdx, null);
            pRow.append(pIdxBadge, pText, qBtn);
            bodyContainer.append(pRow);
          });
          bodyContainer.addEventListener('mouseup', () => {
            const sel = window.getSelection?.()?.toString()?.trim() || '';
            if (sel.length >= 2) applyQuoteToForm(sel, -1, null);
          });
          paper.append(paperHead, canvasStage, bodyContainer);

          exForm.onsubmit = async event => {
            event.preventDefault();
            if (busy) return;
            const finalTitle = (exTitleInput.value.trim() || `${parsedDoc.title || rawRecord.name} · ${isPdf ? '第 ' + currentPageNum + ' 页摘录' : currentSection.heading}`).slice(0, 120);
            const finalQuote = exQuoteInput.value.trim();
            const finalAnnotation = exNoteInput.value.trim();
            const savedBbox = isPdf && activeReaderBbox ? activeReaderBbox : undefined;
            lock(true); error.hidden = true;
            try {
              const excerptMd = documentExcerptNote({
                title: finalTitle,
                sourceTitle: parsedDoc.title || rawRecord.name,
                relativePath: rawRecord.relativePath,
                sourceHash: rawRecord.sha256,
                page: isPdf ? currentPageNum : undefined,
                cfi: !isPdf ? currentCfi : undefined,
                bbox: savedBbox,
                chapter: !isPdf ? currentSection.heading : '',
                text: finalQuote,
                annotation: finalAnnotation,
              });
              const noteName = finalTitle.slice(0, 44).replace(/[\[\]#|:：/\\]/g, '-') + ' ' + crypto.randomUUID().slice(0, 6);
              await api.createNote(noteName, { folder: 'excerpts', source: excerptMd, background: true });
              readerExcerptTitleDraft = ''; readerExcerptQuoteDraft = ''; readerExcerptAnnotationDraft = '';
              activeReaderBbox = null;
              readerBoxAnnotateMode = false;
              readerExcerptStatusText = `已保存摘录至 excerpts/${noteName}.md`;
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };

          const excerptSec = element('div', 'research-reader-excerpts-section'); excerptSec.id = 'reader-doc-excerpts';
          const excerptHeadRow = element('div', 'research-reader-excerpt-card-head');
          excerptHeadRow.append(element('h4', '', `本文档已存摘录 (${docExcerpts.length})`));
          const compileReadingBtn = element('button', 'research-reader-quote-btn', '生成精读札记');
          compileReadingBtn.type = 'button'; compileReadingBtn.id = 'reader-compile-reading-note-btn';
          compileReadingBtn.onclick = async () => {
            if (busy) return;
            lock(true); error.hidden = true;
            try {
              const readingMd = compileDocumentReadingNote({
                title: parsedDoc.title || rawRecord.name,
                relativePath: rawRecord.relativePath,
                sourceHash: rawRecord.sha256,
                sections,
                excerpts: docExcerpts,
              });
              const noteName = `${(parsedDoc.title || rawRecord.name).slice(0, 38).replace(/[\[\]#|:：/\\]/g, '-')} 精读札记 ${crypto.randomUUID().slice(0, 6)}`;
              await api.createNote(noteName, { folder: 'reading', source: readingMd, background: true });
              readerExcerptStatusText = `已生成精读札记至 reading/${noteName}.md`;
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };
          excerptHeadRow.append(compileReadingBtn);
          excerptSec.append(excerptHeadRow);
          if (!docExcerpts.length) {
            excerptSec.append(element('small', '', '尚无绑定此原件的摘录卡'));
          } else {
            const currentDocHashMap = new Map([[rawRecord.relativePath.toLowerCase(), rawRecord.sha256]]);
            for (const exItem of docExcerpts) {
              const exCard = element('div', 'research-reader-excerpt-card');
              const headRow = element('div', 'research-reader-excerpt-card-head');
              const openNoteBtn = element('button', 'home-task-title', exItem.title); openNoteBtn.type = 'button';
              openNoteBtn.onclick = () => api.open(exItem.id).catch(fail);
              const jumpLoc = parseDocumentSourceLink(exItem.sourceReference || '');
              const jumpLabel = jumpLoc?.page ? `跳至第 ${jumpLoc.page} 页` : (exItem.sourceChapter ? `跳至 ${exItem.sourceChapter}` : '定位原件');
              const jumpBtn = element('button', 'research-reader-quote-btn', jumpLabel); jumpBtn.type = 'button';
              jumpBtn.dataset.readerJumpLink = exItem.sourceReference || '';
              jumpBtn.onclick = () => {
                if (jumpLoc) {
                  pendingReaderTarget = jumpLoc;
                  void refresh();
                }
              };
              headRow.append(openNoteBtn, jumpBtn);
              exCard.append(headRow);
              const drift = detectDocumentHashDrift(exItem, currentDocHashMap);
              if (drift.drifted) {
                const driftBar = element('div', 'raw-hash-drift-banner');
                driftBar.dataset.hashDriftNoteId = exItem.id;
                const driftText = element('span', '', `⚠ ${drift.label}`);
                const syncBtn = element('button', 'research-reader-quote-btn', '原件版本已更新 · 一键核对同步');
                syncBtn.type = 'button';
                syncBtn.dataset.syncExcerptHash = exItem.id;
                syncBtn.onclick = async () => {
                  if (busy) return; lock(true); error.hidden = true;
                  try {
                    const rec = await api.read(exItem.id, { signal: scope.signal });
                    const syncedMd = syncDocumentSourceHashInMarkdown(rec.source, {
                      relativePath: rawRecord.relativePath,
                      newHash: rawRecord.sha256,
                    });
                    if (syncedMd !== rec.source) await api.write(exItem.id, rec.version, syncedMd);
                    readerExcerptStatusText = `已核对同步《${exItem.title}》的原件 SHA-256 指纹`;
                  } catch (reason) { fail(reason); }
                  finally { lock(false); if (!scope.signal.aborted) await refresh(); }
                };
                driftBar.append(driftText, syncBtn);
                exCard.append(driftBar);
              }
              excerptSec.append(exCard);
            }
          }
          aside.append(exForm, excerptSec);
          workspace.append(paper, aside);
          stage.append(workspace);
          if (root.querySelector('#reader-tools-menu')?.open) readerToolsMenu.open = true;
          list.replaceChildren(stage);
          count.textContent = `${readingDocs.length} 份原件 · 第 ${currentPageNum}/${sections.length} ${isPdf ? '页' : '章'}`;
          previous.disabled = readerSectionIndex <= 0;
          next.disabled = readerSectionIndex >= sections.length - 1;
          previous.onclick = () => { if (readerSectionIndex > 0) { readerSectionIndex--; void refresh(); } };
          next.onclick = () => { if (readerSectionIndex < sections.length - 1) { readerSectionIndex++; void refresh(); } };
          root.dataset.ready = 'true';
          return;
        }
        previous.onclick = () => { page--; void refresh(); }; next.onclick = () => { page++; void refresh(); };
        if (mode === 'highlights') {
          const hlData = data.highlights || { counts: { all: 0, yellow: 0, green: 0, blue: 0, pink: 0, orange: 0, quote: 0 }, total: 0, items: [] };
          const filterRow = element('div', 'research-form-footer');
          const filterBar = element('div', 'segmented-control ux-pill-bar'); filterBar.id = 'research-highlight-filters';
          const colorDefs = [
            ['all', '全部批注', 'teal'],
            ['yellow', '淡黄高亮', 'amber'],
            ['green', '浅绿高亮', 'emerald'],
            ['blue', '天蓝高亮', 'blue'],
            ['pink', '浅粉高亮', 'rose'],
            ['orange', '淡橙高亮', 'purple'],
            ['quote', '引文与提示块', 'indigo'],
          ];
          for (const [cKey, cLabel, cTone] of colorDefs) {
            const cBtn = element('button', 'ux-pill-option'); cBtn.type = 'button';
            cBtn.dataset.hlColor = cKey; cBtn.dataset.pillTone = cTone;
            cBtn.setAttribute('aria-selected', String(highlightColor === cKey));
            cBtn.append(createElement(Highlighter, { width: 13, height: 13, 'aria-hidden': 'true' }), element('span', '', `${cLabel} (${hlData.counts[cKey] ?? 0})`));
            cBtn.onclick = () => { highlightColor = cKey; void refresh(); };
            filterBar.append(cBtn);
          }
          const exportHlBtn = element('button', 'phase-command', '汇编为精读批注笔记'); exportHlBtn.type = 'button'; exportHlBtn.id = 'research-export-highlights';
          exportHlBtn.prepend(createElement(BookMarked, { width: 14, height: 14, 'aria-hidden': 'true' }));
          exportHlBtn.disabled = !hlData.items.length;
          exportHlBtn.onclick = async () => {
            if (busy || !hlData.items.length) return; lock(true); error.hidden = true;
            try {
              const md = compileHighlightsDigestMarkdown(hlData.items, { title: '全库高亮批注与引文精粹' });
              const name = '全库高亮批注精粹 ' + crypto.randomUUID().slice(0, 6);
              await api.createNote(name, { folder: 'excerpts', source: md, background: true });
              mode = 'excerpt'; page = 0;
            } catch (reason) { fail(reason); }
            finally { lock(false); if (!scope.signal.aborted) await refresh(); }
          };
          filterRow.append(filterBar, exportHlBtn);
          const hlList = element('div', 'ai-citation-list'); hlList.id = 'research-highlights-list';
          if (!hlData.items.length) {
            hlList.append(element('p', 'empty-state', '当前筛选条件下暂无高亮或批注条目'));
          } else {
            for (const item of hlData.items) {
              const card = element('div', 'ai-citation-card'); card.dataset.highlightColor = item.color;
              const openBtn = element('button', 'home-task-title', `《${item.noteTitle}》（第 ${item.lineNum} 行）`); openBtn.type = 'button';
              openBtn.onclick = () => api.open(item.noteId).catch(fail);
              const badge = element('span', 'ux-pill-option ai-sr-stat-pill', item.colorLabel); badge.dataset.pillTone = item.tone;
              const bodyText = element('p', '', item.text);
              card.append(openBtn, badge, bodyText);
              hlList.append(card);
            }
          }
          list.replaceChildren(filterRow, hlList);
          count.textContent = hlData.total + ' 条批注'; previous.disabled = true; next.disabled = true; root.dataset.ready = 'true';
          return;
        }
        const rawHashMap = new Map();
        const referencedRawPaths = new Set();
        for (const note of data.research) {
          if (note.sourceFile && /^raw\/.+\.(pdf|epub)$/i.test(note.sourceFile)) referencedRawPaths.add(note.sourceFile);
          else if (typeof note.sourceReference === 'string' && note.sourceReference.startsWith('#inkloom-reader?')) {
            try {
              const loc = parseDocumentSourceLink(note.sourceReference);
              if (loc?.relativePath) referencedRawPaths.add(loc.relativePath);
            } catch {}
          }
        }
        for (const relPath of referencedRawPaths) {
          const rec = await api.aiConfig('read-raw', { relativePath: relPath }).catch(() => null);
          if (rec?.sha256) rawHashMap.set(relPath.toLowerCase(), rec.sha256);
        }
        if (busy || scope.signal.aborted || token !== request) return;
        if (pointer) { deferred = true; return; }
        list.replaceChildren();

        const table = element('table', 'vault-database-table'); const head = element('thead'); const heading = element('tr'); for (const text of ['标题', '来源', '作者 / 年份', '阅读状态', '操作']) { const cell = element('th', '', text); cell.scope = 'col'; heading.append(cell); } head.append(heading); table.append(head); const body = element('tbody'); table.append(body);
        for (const note of data.research) {
          const row = element('tr'); row.dataset.researchNoteId = note.id; const name = element('td'); const open = element('button', 'home-task-title', note.title); open.type = 'button'; open.onclick = () => api.open(note.id).catch(fail); name.append(open);
          const drift = detectDocumentHashDrift(note, rawHashMap);
          if (drift.drifted) {
            const driftBar = element('div', 'raw-hash-drift-banner');
            driftBar.dataset.hashDriftNoteId = note.id;
            const driftText = element('span', '', `⚠ ${drift.label}`);
            const syncBtn = element('button', 'research-reader-quote-btn', '原件版本已更新 · 一键核对同步');
            syncBtn.type = 'button';
            syncBtn.dataset.syncExcerptHash = note.id;
            syncBtn.onclick = async () => {
              if (busy) return; lock(true); error.hidden = true;
              try {
                const rec = await api.read(note.id, { signal: scope.signal });
                const syncedMd = syncDocumentSourceHashInMarkdown(rec.source, {
                  relativePath: drift.relativePath,
                  newHash: drift.currentHash,
                });
                if (syncedMd !== rec.source) await api.write(note.id, rec.version, syncedMd);
              } catch (reason) { fail(reason); }
              finally { lock(false); if (!scope.signal.aborted) await refresh(); }
            };
            driftBar.append(driftText, syncBtn);
            name.append(driftBar);
          }
          const status = element('select'); status.setAttribute('aria-label', note.title + '阅读状态'); status.append(...statuses.map(value => new Option(value, value))); status.value = statuses.includes(note.status) ? note.status : '待读';
          status.onchange = async () => { if (busy) return; const value = status.value; lock(true); try { const source = await api.read(note.id, { signal: scope.signal }); if (!scope.signal.aborted) await api.updateProperties(note.id, source.version, { status: value }); } catch (reason) { fail(reason); } finally { lock(false); if (!scope.signal.aborted) await refresh(); } };
          const state = element('td'); state.append(status); const actions = element('td');
          if (note.category === 'source') {
            const write = button(BookOpen, '为 ' + note.title + ' 创建札记'); write.dataset.shortLabel = '写札记';
            write.onclick = async () => { if (busy) return; lock(true); try { const source = readingNote(note); const created = await api.createNote(note.title.slice(0, 40).replace(/[\[\]#|]/g, '-') + ' 札记 ' + crypto.randomUUID(), { folder: 'reading', source, background: true }); if (!scope.signal.aborted) await api.open(created.id); } catch (reason) { fail(reason); } finally { lock(false); } };
            actions.append(write);
          }
          if (note.category === 'source' || note.category === 'excerpt' || note.category === 'reading') {
            if ((note.category === 'excerpt' || note.category === 'reading') && typeof note.sourceReference === 'string' && note.sourceReference.startsWith('#inkloom-reader?')) {
              const openReaderBtn = button(BookOpen, '定位原件 ' + note.title); openReaderBtn.dataset.openReaderSource = note.id; openReaderBtn.dataset.shortLabel = '定位原件';
              openReaderBtn.onclick = () => {
                error.hidden = true;
                try {
                  const loc = parseDocumentSourceLink(note.sourceReference);
                  if (!loc) throw new Error('原件定位链接无效');
                  pendingReaderTarget = loc;
                  mode = 'reader';
                  void refresh();
                } catch (reason) { fail(reason); }
              };
              actions.append(openReaderBtn);
            }
            if (note.category === 'source' || note.category === 'excerpt') {
              const cite = button(Copy, '复制 ' + note.title + ' 引文'); cite.dataset.copyCitation = note.id; cite.dataset.shortLabel = '复制引文';
              cite.onclick = async () => {
                error.hidden = true;
                try {
                  lastCitedNote = note;
                  const citation = formatResearchCitation(note, citationStyle);
                  citationInput.value = citation; citationBar.hidden = false;
                  syncCitationBarView();
                  await navigator.clipboard?.writeText(citation).catch(() => {});
                } catch (reason) { fail(reason); }
              };
              actions.append(cite);
            }
          }
          if (note.category === 'manuscript') {
            const addChapter = button(FilePlus2, '为 ' + note.title + ' 新增章节'); addChapter.dataset.addChapter = note.id; addChapter.dataset.shortLabel = '加章节';
            addChapter.onclick = async () => {
              if (busy) return; lock(true); error.hidden = true;
              try {
                const msRecord = await api.read(note.id, { signal: scope.signal });
                const order = (note.chapterCount || 0) + 1;
                const chapterTitle = note.title + ' · 第' + order + '章';
                const chapterSource = manuscriptChapterNote({ manuscriptId: note.id, manuscriptTitle: note.title, chapterTitle, order, targetWords: Math.max(200, Math.round((note.targetWords || 3000) / 3)) });
                const created = await api.createNote(chapterTitle.slice(0, 44).replace(/[\[\]#|]/g, '-') + ' ' + crypto.randomUUID(), { folder: 'chapters', source: chapterSource, background: true });
                const updatedManuscript = appendManuscriptChapter(msRecord.source, created.relativePath, chapterTitle);
                await api.write(note.id, msRecord.version, updatedManuscript);
              } catch (reason) { fail(reason); }
              finally { lock(false); if (!scope.signal.aborted) await refresh(); }
            };
            const compileMs = button(Layers, '汇编同步 ' + note.title + ' 章节'); compileMs.dataset.compileManuscript = note.id; compileMs.dataset.shortLabel = '汇编同步';
            compileMs.onclick = async () => {
              if (busy) return; lock(true); error.hidden = true;
              try {
                const msRecord = await api.read(note.id, { signal: scope.signal });
                const chapters = data.research.filter(item => item.category === 'chapter' && item.manuscriptId === note.id);
                const synced = synchronizeManuscriptStructure(msRecord.source, chapters);
                if (synced !== msRecord.source) await api.write(note.id, msRecord.version, synced);
                if (!scope.signal.aborted) await api.open(note.id);
              } catch (reason) { fail(reason); }
              finally { lock(false); }
            };
            const publishMs = button(BookMarked, '生成 ' + note.title + ' 出版联排成稿'); publishMs.dataset.publishManuscript = note.id; publishMs.dataset.shortLabel = '出版定稿';
            publishMs.onclick = async () => {
              if (busy) return; lock(true); error.hidden = true;
              try {
                const chapterItems = data.research.filter(item => item.category === 'chapter' && item.manuscriptId === note.id);
                const loadedChapters = [];
                for (const ch of chapterItems) {
                  const raw = await api.read(ch.id, { signal: scope.signal });
                  loadedChapters.push({ ...ch, source: raw.source });
                }
                const allResResp = await api.queryWorkspace({ researchMode: 'all', researchPage: 0 }, { signal: scope.signal, key: 'research-desk-pub-refs' }).catch(() => ({ research: data.research }));
                lastPublishedMsContext = {
                  note,
                  loadedChapters,
                  referenceNotes: Array.isArray(allResResp?.research) && allResResp.research.length ? allResResp.research : data.research,
                };
                renderCurrentPublication();
              } catch (reason) { fail(reason); }
              finally { lock(false); }
            };
            actions.append(addChapter, compileMs, publishMs);
          }
          if (note.category === 'chapter') {
            const orderInput = element('input', 'database-property-input'); orderInput.type = 'number'; orderInput.min = '1'; orderInput.max = '1000'; orderInput.step = '1';
            orderInput.value = String(note.chapterOrder || 1); orderInput.style.width = '54px';
            orderInput.dataset.chapterOrderInput = note.id; orderInput.setAttribute('aria-label', note.title + '章节序号');
            orderInput.onchange = async () => {
              if (busy) return; const nextOrder = Math.max(1, Math.min(1000, Math.round(Number(orderInput.value) || 1)));
              lock(true); error.hidden = true;
              try {
                const current = await api.read(note.id, { signal: scope.signal });
                if (!scope.signal.aborted) await api.updateProperties(note.id, current.version, { chapter_order: nextOrder });
              } catch (reason) { fail(reason); }
              finally { lock(false); if (!scope.signal.aborted) await refresh(); }
            };
            actions.append(orderInput);
          }
          const categoryLabel = note.category === 'source' ? kinds[note.sourceType] || '其他' : note.category === 'excerpt' ? '摘录' : note.category === 'manuscript' ? '长稿' : note.category === 'chapter' ? `第${note.chapterOrder || 1}章` : '札记';
          const metaLabel = note.category === 'manuscript'
            ? `${note.chapterCount || 0} 章 · ${note.wordCount || 0} / ${note.targetWords || 3000} 字`
            : note.category === 'chapter'
              ? `${note.wordCount || 0} / ${note.targetWords || 1000} 字`
              : (note.category === 'excerpt' || note.category === 'reading') && note.sourceFile
                ? `${note.sourceTitle || note.sourceFile} · ${note.sourcePage ? '第 ' + note.sourcePage + ' 页' : (note.sourceChapter || note.sourceFormat?.toUpperCase() || '')}`
                : [note.author, note.year].filter(Boolean).join(' · ');
          row.append(name, element('td', '', categoryLabel), element('td', '', metaLabel), state, actions); body.append(row);
        }
        if (data.research.length) list.append(table);
        else {
          const empty = element('div', 'research-empty');
          const filtered = Boolean(search.value.trim());
          const emptyTitle = element('h3', '', filtered ? '没有匹配的资料' : ({ source: '暂无研究资料', reading: '暂无阅读札记', excerpt: '暂无摘录', manuscript: '暂无长稿' }[mode] || '暂无研究条目'));
          const action = element('button', 'phase-command'); action.type = 'button'; action.id = 'research-empty-action';
          action.append(createElement(filtered ? RotateCcw : mode === 'manuscript' ? FilePlus2 : Plus, { width: 15, height: 15, 'aria-hidden': 'true' }), element('span', '', filtered ? '清除筛选' : mode === 'manuscript' ? '新建长稿' : mode === 'source' || mode === 'all' ? '登记资料' : '打开资料库'));
          action.onclick = () => {
            if (filtered) { search.value = ''; page = 0; void refresh(); }
            else if (mode === 'manuscript') { manuscriptForm.hidden = false; form.hidden = true; msTitle.focus(); }
            else if (mode === 'source' || mode === 'all') { form.hidden = false; manuscriptForm.hidden = true; fields.title.focus(); }
            else { mode = 'source'; page = 0; void refresh(); }
          };
          empty.append(createElement(BookOpen, { width: 22, height: 22, 'aria-hidden': 'true' }), emptyTitle, action);
          list.append(empty);
        }
        if (!search.value.trim() && data.research.length <= 4) {
          const companion = element('div', 'research-companion-grid');
          const readerCard = element('div', 'research-companion-card');
          const readerHead = element('div', 'research-companion-head');
          readerHead.append(
            element('strong', '', '原件精读与文献转换'),
            element('small', '', '将 PDF / EPUB 原件转化为带页码锚点的可溯源摘录卡'),
          );
          const readerActions = element('div', 'research-companion-actions');
          const goReaderBtn = element('button', 'phase-command'); goReaderBtn.type = 'button';
          goReaderBtn.append(createElement(BookMarked, { width: 14, height: 14, 'aria-hidden': 'true' }), element('span', '', '进入 PDF / EPUB 原件精读'));
          goReaderBtn.onclick = () => { mode = 'reader'; page = 0; void refresh(); };
          const goAddBtn = element('button', 'small-command', '登记外部文献'); goAddBtn.type = 'button';
          goAddBtn.onclick = () => { form.hidden = false; manuscriptForm.hidden = true; fields.title.focus(); };
          const goMsBtn = element('button', 'small-command', '新建多章长稿'); goMsBtn.type = 'button';
          goMsBtn.onclick = () => { manuscriptForm.hidden = false; form.hidden = true; msTitle.focus(); };
          readerActions.append(goReaderBtn, goAddBtn, goMsBtn);
          readerCard.append(readerHead, readerActions);

          const hlCard = element('div', 'research-companion-card');
          const hlItems = data.highlights?.items || [];
          const hlHead = element('div', 'research-companion-head');
          hlHead.append(
            element('strong', '', `笔记高亮与引文速览 (${data.highlights?.total || hlItems.length})`),
            element('small', '', '来自知识库笔记中的高亮与引文段落，点击直达原笔记'),
          );
          const hlMiniList = element('div', 'research-companion-hl-list');
          for (const item of hlItems.slice(0, 3)) {
            const row = element('div', 'research-companion-hl-row');
            const jump = element('button', 'home-task-title', `《${item.noteTitle}》 · 第 ${item.lineNum} 行`); jump.type = 'button';
            jump.onclick = () => api.open(item.noteId).catch(fail);
            const txt = element('small', '', item.text.slice(0, 72));
            row.append(jump, txt);
            hlMiniList.append(row);
          }
          hlCard.append(hlHead, hlMiniList);
          companion.append(readerCard, hlCard);
          list.append(companion);
        }
        page = data.researchPage; count.textContent = data.researchTotal + ' 条 · ' + (page + 1); previous.disabled = page === 0; next.disabled = (page + 1) * 25 >= data.researchTotal; root.dataset.ready = 'true';
      } catch (reason) { if (reason.name !== 'AbortError') fail(reason); }
    }
    search.oninput = () => { page = 0; void refresh(); }; previous.onclick = () => { page--; void refresh(); }; next.onclick = () => { page++; void refresh(); };
    window.addEventListener('inkloom:research-switch-mode', evt => { if (evt.detail) { mode = evt.detail; page = 0; void refresh(); } }, { signal: scope.signal });
    window.addEventListener('inkloom:research-open-reader', evt => { if (evt.detail) { pendingReaderTarget = evt.detail; mode = 'reader'; page = 0; void refresh(); } }, { signal: scope.signal });
    root.addEventListener('pointerdown', () => { pointer = true; }, { signal: scope.signal }); for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => { pointer = false; if (deferred) { deferred = false; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => void refresh()); } }, { signal: scope.signal });
    scope.own(api.on('vault.changed', refresh)); void refresh(); return () => { clearTimeout(draftTimer); cancelAnimationFrame(frame); if (!busy) void persist(); root.remove(); };
  } });
  api.registerCommand({ id: 'open-research', name: '打开研究资料', run: () => api.showView(view) });
}