import { createElement, ZoomIn, ZoomOut, Scan, RotateCcw } from 'lucide';
import { LoomGraphView } from '../../app/src/loom-graph.js';
import { loadGraphState, saveGraphState } from '../../app/src/graph-state-cache.js';
import { findShortestGraphPath, buildWhiteboardSceneFromGraphSubgraph } from '../../core/spatial-canvas-graph.mjs';
import { newWhiteboardMarkdown, updateWhiteboardMarkdown } from '../../core/whiteboard-document.mjs';

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function tool(icon, label, command) {
  const button = element('button', 'icon-button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.dataset.graphCommand = command;
  button.append(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' })); return button;
}

export function activate(api) {
  const filters = { mode: 'all', tag: '', query: '' };
  const remembered = { global: null, local: null };
  api.registerSetting({ id: 'local-depth', name: '局部跳数', type: 'choice', default: 1, options: [{ label: '1跳', value: 1 }, { label: '2跳', value: 2 }] });
  api.registerSetting({ id: 'local-tags', name: '局部同标签关系', type: 'boolean', default: false });
  api.registerSetting({ id: 'show-local', name: '右栏显示局部图谱', type: 'boolean', default: true });
  api.registerSetting({ id: 'layout', name: '布局方式', type: 'choice', default: 'force', options: [{ label: '力导向', value: 'force' }, { label: '环形', value: 'radial' }, { label: '目录分组', value: 'folders' }, { label: '能级分层', value: 'trophic' }] });
  api.registerSetting({ id: 'visual-style', name: '节点样式', type: 'choice', default: 'atlas', options: [{ label: '图集', value: 'atlas' }, { label: '线稿', value: 'minimal' }, { label: '星图', value: 'constellation' }] });
  api.registerSetting({ id: 'node-scale', name: '节点大小', type: 'number', min: .6, max: 1.8, default: 1 });
  api.registerSetting({ id: 'spacing', name: '布局间距', type: 'number', min: 50, max: 220, default: 115 });
  api.registerSetting({ id: 'link-opacity', name: '连线不透明度', type: 'number', min: .1, max: 1, default: .5 });
  api.registerSetting({ id: 'persist-layout', name: '记住布局与视口', type: 'boolean', default: true });
  api.registerSetting({ id: 'dismissed-edges', name: '已忽略的推断关系', type: 'data', default: [] });
  const globalId = api.registerView({ id: 'global-view', target: 'graph', name: '知识图谱', icon: 'network', location: 'activity', order: 40, mount: (container, scope) => mount(container, scope, false) });
  api.registerView({ id: 'local-view', name: '局部图谱', location: 'context', order: 10, visibleSetting: 'show-local', mount: (container, scope) => mount(container, scope, true) });
  api.registerCommand({ id: 'open-graph', name: '打开知识图谱', run: () => api.showView(globalId) });

  function mount(container, scope, local) {
    const mode = local ? 'local' : 'global';
    const stage = element('section', local ? 'local-graph-box' : 'global-graph-stage'); stage.id = local ? 'local-graph-panel' : 'global-graph-stage'; stage.setAttribute('aria-label', local ? '局部图谱' : '知识图谱');
    const toolbar = element('div', local ? 'local-graph-header' : 'global-graph-toolbar');
    const controls = element('div', local ? 'local-graph-controls' : 'graph-search-controls');
    let depth; let tags; let tagFilter; let search; let layoutSelect; let styleSelect;
    let analyticsBar; let communityPills; let pathStartSelect; let pathEndSelect; let pathFindBtn; let pathClearBtn; let pathResultBar;
    let activeCommunityId = ''; let activePathResult = null; let lastProjectedBoardInfo = '';
    if (local) {
      toolbar.append(element('span', '', '局部图谱'));
      depth = element('select', 'mini-toggle'); depth.id = 'local-depth-toggle'; depth.setAttribute('aria-label', '局部图谱跳数'); depth.append(new Option('1跳', '1'), new Option('2跳', '2'));
      const label = element('label', 'local-graph-tag-setting'); tags = element('input'); tags.type = 'checkbox'; tags.id = 'local-tag-toggle'; label.append(tags, document.createTextNode('同标签'));
      controls.append(depth, label, tool(Scan, '居中局部图谱', 'fit'));
    } else {
      const modes = element('div', 'graph-filter-pills'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '图谱节点筛选');
      for (const [value, label, tone] of [['all', '全部节点', 'teal'], ['folder', '当前目录', 'blue'], ['orphans', '孤岛笔记', 'rose'], ['ghosts', '待建节点', 'amber']]) {
        const button = element('button', 'graph-filter-pill', label); button.type = 'button'; button.dataset.graphMode = value; button.dataset.pillTone = tone; modes.append(button);
      }
      tagFilter = element('select', 'graph-tag-select'); tagFilter.id = 'graph-tag-select'; tagFilter.setAttribute('aria-label', '按标签筛选图谱');
      search = element('input', 'graph-search-input'); search.type = 'search'; search.id = 'graph-search-input'; search.placeholder = '搜索节点'; search.setAttribute('aria-label', '搜索图谱节点'); search.value = filters.query;
      layoutSelect = element('select', 'graph-tag-select'); layoutSelect.id = 'graph-layout-select'; layoutSelect.setAttribute('aria-label', '图谱布局'); layoutSelect.append(new Option('力导向', 'force'), new Option('环形', 'radial'), new Option('目录分组', 'folders'), new Option('能级分层', 'trophic'));
      styleSelect = element('select', 'graph-tag-select'); styleSelect.id = 'graph-style-select'; styleSelect.setAttribute('aria-label', '图谱样式'); styleSelect.append(new Option('图集', 'atlas'), new Option('线稿', 'minimal'), new Option('星图', 'constellation'));
      toolbar.append(modes); controls.append(layoutSelect, styleSelect, tagFilter, search, tool(ZoomOut, '缩小图谱', 'out'), tool(Scan, '适应画布', 'fit'), tool(ZoomIn, '放大图谱', 'in'), tool(RotateCcw, '重新布局', 'layout'));

      analyticsBar = element('div', 'graph-analytics-bar'); analyticsBar.id = 'graph-analytics-bar';
      communityPills = element('div', 'graph-filter-pills graph-community-pills'); communityPills.id = 'graph-community-pills'; communityPills.setAttribute('role', 'group'); communityPills.setAttribute('aria-label', '知识社区聚类筛选');
      const pathfinderMenu = element('details', 'ux-popover-menu'); pathfinderMenu.id = 'graph-pathfinder-menu';
      const pathfinderTrigger = element('summary', 'ux-popover-trigger', '🧭 图谱寻路 ▾'); pathfinderTrigger.id = 'graph-pathfinder-menu-trigger';
      pathfinderTrigger.setAttribute('aria-label', '展开图谱最短路径寻路菜单');
      const pathControls = element('div', 'ux-popover-panel graph-pathfinder-controls'); pathControls.id = 'graph-pathfinder-controls';
      pathStartSelect = element('select', 'graph-tag-select'); pathStartSelect.id = 'graph-path-start'; pathStartSelect.setAttribute('aria-label', '寻路起点笔记');
      pathEndSelect = element('select', 'graph-tag-select'); pathEndSelect.id = 'graph-path-end'; pathEndSelect.setAttribute('aria-label', '寻路终点笔记');
      pathFindBtn = element('button', 'graph-filter-pill', '寻路'); pathFindBtn.type = 'button'; pathFindBtn.id = 'graph-path-find'; pathFindBtn.dataset.pillTone = 'amber';
      pathClearBtn = element('button', 'graph-filter-pill', '重置'); pathClearBtn.type = 'button'; pathClearBtn.id = 'graph-path-clear'; pathClearBtn.dataset.pillTone = 'slate'; pathClearBtn.hidden = true;
      const graphOpenWindowBtn = element('button', 'graph-filter-pill', '↗ 新窗口打开星图'); graphOpenWindowBtn.type = 'button'; graphOpenWindowBtn.id = 'graph-open-window-btn';
      graphOpenWindowBtn.onclick = () => {
        pathfinderMenu.open = false;
        window.__inkloomOpenSecondaryWindow?.({ targetType: 'graph', title: '万象知识星图' });
      };
      const graphProjectWhiteboardBtn = element('button', 'graph-filter-pill', '🎨 投射为空间白板');
      graphProjectWhiteboardBtn.type = 'button';
      graphProjectWhiteboardBtn.id = 'graph-project-whiteboard-btn';
      graphProjectWhiteboardBtn.dataset.pillTone = 'emerald';
      graphProjectWhiteboardBtn.onclick = async () => {
        pathfinderMenu.open = false;
        graphProjectWhiteboardBtn.disabled = true;
        try {
          const built = buildWhiteboardSceneFromGraphSubgraph(result?.nodes || [], result?.edges || [], {
            pathResult: activePathResult,
          });
          const boardTitle = activePathResult?.found
            ? `星图寻路推演 · ${activePathResult.hops}跳桥梁画布`
            : '星图核心群落推演画布';
          const mdSource = updateWhiteboardMarkdown(newWhiteboardMarkdown(boardTitle), built);
          await api.createNote(boardTitle + ' ' + crypto.randomUUID().slice(0, 8), {
            folder: 'whiteboards',
            source: mdSource,
            background: true,
          });
          lastProjectedBoardInfo = `🎨 已将当前星图路径/子图（${built.cardCount} 张笔记卡片）投射保存为空间白板《${boardTitle}》`;
          status.textContent = lastProjectedBoardInfo;
        } catch (err) {
          status.textContent = err.message || String(err);
        } finally {
          graphProjectWhiteboardBtn.disabled = false;
        }
      };
      pathControls.append(pathStartSelect, element('span', 'graph-path-arrow', '→'), pathEndSelect, pathFindBtn, pathClearBtn, graphProjectWhiteboardBtn, graphOpenWindowBtn);
      pathfinderMenu.append(pathfinderTrigger, pathControls);
      pathResultBar = element('div', 'graph-path-result-bar'); pathResultBar.id = 'graph-path-result-bar';
      analyticsBar.append(communityPills, pathfinderMenu);
    }
    toolbar.append(controls);
    const status = element('div', 'graph-view-status'); status.id = local ? 'local-graph-status' : 'global-graph-stats'; status.setAttribute('role', 'status');
    const wrap = element('div', local ? 'local-graph-stage' : 'global-graph-canvas-wrap'); const canvas = element('canvas'); canvas.id = local ? 'local-graph-canvas' : 'global-graph-canvas'; canvas.setAttribute('aria-label', local ? '当前笔记局部图谱' : '全局知识图谱'); wrap.append(canvas);
    const inspector = element('div', 'global-graph-inspector'); inspector.id = local ? 'local-graph-inspector' : 'global-graph-inspector'; inspector.hidden = true;
    const title = element('h3'); const detail = element('p'); const open = element('button', 'primary-command', '打开笔记'); open.type = 'button';
    const evidenceDetails = element('details', 'graph-evidence-details'); evidenceDetails.id = local ? 'local-graph-evidence' : 'global-graph-evidence';
    const evidenceSummary = element('summary', '', '关系依据'); const evidenceList = element('div', 'graph-evidence-list'); evidenceDetails.append(evidenceSummary, evidenceList);
    inspector.append(title, detail, evidenceDetails, open);
    if (!local) {
      wrap.append(status, pathResultBar, inspector);
      stage.append(toolbar, analyticsBar, wrap);
    } else {
      stage.append(toolbar, status, wrap);
    }
    container.append(stage);
    let selected = null; let result; let request = 0; let timer; let opening = false; let cacheKey = ''; let loadedKey = ''; let persistTimer; let persistEnabled = Boolean(api.getSetting('persist-layout'));
    const graph = new LoomGraphView(canvas, { mode, state: remembered[mode], onSelectNode: node => follow(node), onHoverNode: node => inspect(node) });
    const persist = async () => { if (!cacheKey || !persistEnabled) return; const state = graph.captureState(); if (state) { const saved = await saveGraphState(cacheKey, state); if (!scope.signal.aborted) canvas.dataset.persistedLayout = saved ? 'true' : 'failed'; } };
    const schedulePersist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => persist().catch(() => {}), 150); };
    const updateStatus = (persistChanges = true) => {
      if (scope.signal.aborted || !result) return;
      const state = ({ running: '计算中', 'budget-limited': '预算内近似', failed: '布局失败', manual: '手动布局' })[canvas.dataset.layoutState];
      status.textContent = `${result.nodes.length} 节点 · ${result.edges.length} 连线${state ? ' · ' + state : ''}${canvas.dataset.persistedLayout === 'failed' ? ' · 布局缓存不可用' : ''}${lastProjectedBoardInfo ? ' · ' + lastProjectedBoardInfo : ''}`;
      if (persistChanges && ['ready', 'budget-limited', 'manual'].includes(canvas.dataset.layoutState)) schedulePersist();
    };
    const layoutObserver = new MutationObserver(records => updateStatus(records.some(record => record.attributeName === 'data-layout-state'))); layoutObserver.observe(canvas, { attributes: true, attributeFilter: ['data-layout-state', 'data-persisted-layout'] });
    scope.own(() => layoutObserver.disconnect());
    function inspect(node) {
      if (local) return;
      if (node) selected = node;
      inspector.hidden = !selected;
      if (selected) {
        title.textContent = selected.title;
        const prInfo = selected.pageRank ? ` · PageRank ${selected.pageRank}` : '';
        const trophicInfo = selected.trophicLayer ? ` · ${selected.trophicLayer} (h=${selected.trophicHeight})` : '';
        const commInfo = selected.communityLabel ? ` · ${selected.communityLabel}` : '';
        detail.textContent = selected.ghost ? `被引用 ${selected.inDegree} 次 · 尚未创建` : `${selected.folder} · 入链 ${selected.inDegree} · 出链 ${selected.outDegree}${prInfo}${trophicInfo}${commInfo}`;
        open.textContent = selected.ghost ? '创建笔记' : '打开笔记';
        evidenceList.replaceChildren();
        const connectedExplicit = (result?.edges || []).filter(edge => edge.source === selected.id || edge.target === selected.id);
        const connectedInferred = (result?.inferredEdges || []).filter(edge => edge.source === selected.id || edge.target === selected.id);
        const connected = [...connectedExplicit, ...connectedInferred];
        evidenceSummary.textContent = `关系依据与审阅 · ${connected.length}（显式 ${connectedExplicit.length} / 推断 ${connectedInferred.length}）`;
        for (const edge of connected.slice(0, 14)) {
          const otherId = edge.source === selected.id ? edge.target : edge.source;
          const other = result.nodes.find(n => n.id === otherId);
          const row = element('div', 'graph-evidence-row'); row.dataset.graphConfidence = edge.confidence;
          const relTypeLabel = edge.confidence === 'EXTRACTED'
            ? '显式引用'
            : edge.relation === 'concept-entity'
              ? '概念实体关联'
              : edge.confidence === 'INFERRED'
                ? '标签推断'
                : '待核查';
          row.append(element('strong', '', relTypeLabel + ' · ' + (other?.title || '待建节点')));
          if (edge.confidence === 'EXTRACTED' && edge.evidence?.length) {
            const source = edge.evidence[0]; const origin = element('button', 'compiler-link-action', `${source.sourcePath} · 第 ${source.line} 行`); origin.type = 'button'; origin.dataset.graphEvidenceSource = source.sourceId;
            origin.onclick = () => api.open(source.sourceId).catch(error => { status.textContent = error.message; }); row.append(origin);
          } else {
            row.append(element('small', '', edge.reason || ('共同标签：' + (edge.sharedTags || []).join('、'))));
            if (edge.evidence?.length) {
              const source = edge.evidence[0];
              const origin = element('button', 'compiler-link-action', `${source.sourcePath} · 第 ${source.line} 行`);
              origin.type = 'button';
              origin.dataset.graphEvidenceSource = source.sourceId;
              origin.onclick = () => api.open(source.sourceId).catch(error => { status.textContent = error.message; });
              row.append(origin);
            }
            if (edge.confidence === 'INFERRED' && other && !other.ghost) {
              const actionsBar = element('div', 'graph-evidence-actions');
              const promoteBtn = element('button', 'compiler-link-action', '✨ 采纳双链');
              promoteBtn.type = 'button';
              promoteBtn.dataset.graphPromoteEdge = `${selected.id}->${other.id}`;
              promoteBtn.onclick = async () => {
                promoteBtn.disabled = true;
                try {
                  await api.promoteEdge(selected.id, other.id, edge.reason || '图谱关系审阅采纳');
                  await refresh();
                } catch (err) {
                  promoteBtn.disabled = false;
                  status.textContent = err.message || String(err);
                }
              };
              const dismissBtn = element('button', 'compiler-link-action', '忽略');
              dismissBtn.type = 'button';
              dismissBtn.dataset.graphDismissEdge = edge.pairKey || `${selected.id}::${other.id}`;
              dismissBtn.onclick = async () => {
                const pairKey = edge.pairKey || (selected.id < other.id ? `${selected.id}::${other.id}` : `${other.id}::${selected.id}`);
                const curDismissed = Array.isArray(api.getSetting('dismissed-edges')) ? api.getSetting('dismissed-edges') : [];
                if (!curDismissed.includes(pairKey)) {
                  await api.setSetting('dismissed-edges', [...curDismissed, pairKey]);
                }
                await refresh();
              };
              actionsBar.append(promoteBtn, dismissBtn);
              row.append(actionsBar);
            }
          }
          evidenceList.append(row);
        }
        if (!connected.length) evidenceList.append(element('small', '', '暂无已记录关系'));
      }
    }
    function renderAnalyticsControls(data) {
      if (local || !communityPills) return;
      communityPills.replaceChildren();
      const allCommunities = data.communities || [];
      const multiNodeCommunities = allCommunities.filter(c => c.count >= 2);
      const visibleCommunities = (multiNodeCommunities.length >= 2 ? multiNodeCommunities : allCommunities).slice(0, 3);
      const allBtn = element('button', 'graph-filter-pill' + (!activeCommunityId ? ' active' : ''), `全部社区 (${allCommunities.length})`);
      allBtn.type = 'button'; allBtn.dataset.communityFilter = ''; allBtn.dataset.pillTone = 'teal'; allBtn.setAttribute('aria-pressed', String(!activeCommunityId));
      communityPills.append(allBtn);
      for (const comm of visibleCommunities) {
        const btn = element('button', 'graph-filter-pill' + (activeCommunityId === comm.id ? ' active' : ''), `${comm.label} (${comm.count})`);
        btn.type = 'button'; btn.dataset.communityFilter = comm.id; btn.dataset.pillTone = comm.tone || 'blue'; btn.setAttribute('aria-pressed', String(activeCommunityId === comm.id));
        communityPills.append(btn);
      }
      if ((data.bridgeNodeIds || []).length) {
        const bridgeBtn = element('button', 'graph-filter-pill' + (activeCommunityId === '__bridges__' ? ' active' : ''), `跨簇桥梁 (${data.bridgeNodeIds.length})`);
        bridgeBtn.type = 'button'; bridgeBtn.dataset.communityFilter = '__bridges__'; bridgeBtn.dataset.pillTone = 'purple'; bridgeBtn.setAttribute('aria-pressed', String(activeCommunityId === '__bridges__'));
        communityPills.append(bridgeBtn);
      }
      const rgBtn = element('button', 'graph-filter-pill' + (graph.rgClusterMode ? ' active' : ''), '🫧 星团水泡');
      rgBtn.type = 'button';
      rgBtn.id = 'graph-rg-toggle';
      rgBtn.dataset.pillTone = 'emerald';
      rgBtn.setAttribute('aria-pressed', String(Boolean(graph.rgClusterMode)));
      rgBtn.title = '切换重整化群 (Block-Spin RG · ALGO-007) 多尺度领域星团水泡视图';
      rgBtn.onclick = () => {
        graph.setRgClusterMode(!graph.rgClusterMode);
        rgBtn.classList.toggle('active', Boolean(graph.rgClusterMode));
        rgBtn.setAttribute('aria-pressed', String(Boolean(graph.rgClusterMode)));
      };
      communityPills.append(rgBtn);

      const prevStart = pathStartSelect.value;
      const prevEnd = pathEndSelect.value;
      const realNodes = (data.nodes || []).filter(n => !n.ghost);
      pathStartSelect.replaceChildren(new Option('起点笔记...', ''));
      pathEndSelect.replaceChildren(new Option('终点笔记...', ''));
      for (const n of realNodes) {
        pathStartSelect.append(new Option(n.cleanTitle || n.title || n.label, n.id));
        pathEndSelect.append(new Option(n.cleanTitle || n.title || n.label, n.id));
      }
      if (prevStart && realNodes.some(n => n.id === prevStart)) pathStartSelect.value = prevStart;
      else if (realNodes[0]) pathStartSelect.value = realNodes[0].id;
      if (prevEnd && realNodes.some(n => n.id === prevEnd)) pathEndSelect.value = prevEnd;
      else if (realNodes.length > 2) pathEndSelect.value = realNodes[Math.min(3, realNodes.length - 1)].id;

      renderPathOrHubsResult(data);
    }
    function renderPathOrHubsResult(data) {
      if (local || !pathResultBar) return;
      pathResultBar.replaceChildren();
      if (activePathResult) {
        pathClearBtn.hidden = false;
        const badgeText = activePathResult.found
          ? `🧭 最短 ${activePathResult.hops} 跳（桥梁 ${activePathResult.bridgeCount || 0}）：`
          : activePathResult.summary;
        const badge = element('span', 'graph-path-summary-badge', badgeText);
        pathResultBar.append(badge);
        for (const [idx, step] of (activePathResult.steps || []).entries()) {
          if (idx > 0) pathResultBar.append(element('span', 'graph-path-arrow', '→'));
          const chip = element('button', 'graph-filter-pill active graph-path-step-chip', step.cleanTitle);
          chip.type = 'button';
          chip.dataset.pathStepId = step.id;
          chip.dataset.pillTone = step.role === 'start' ? 'teal' : step.role === 'end' ? 'emerald' : 'amber';
          chip.onclick = () => {
            const targetNode = result?.nodes.find(n => n.id === step.id);
            if (targetNode) follow(targetNode);
          };
          pathResultBar.append(chip);
        }
        if ((activePathResult.hopTransitions || []).length > 0) {
          const pathEvDetails = element('details', 'graph-evidence-details graph-path-evidence-details');
          pathEvDetails.id = 'graph-path-evidence-details';
          const pathEvSummary = element('summary', '', `路径依据 (${activePathResult.hopTransitions.length} 跳)`);
          const pathEvList = element('div', 'graph-evidence-list');
          for (const hop of activePathResult.hopTransitions) {
            const hopRow = element('div', 'graph-evidence-row');
            hopRow.dataset.hopConfidence = hop.confidence;
            hopRow.append(
              element('strong', '', `第 ${hop.stepIndex} 跳：《${hop.fromTitle}》 → 《${hop.toTitle}》`),
              element('small', '', `${hop.relationLabel} · 能级 ${hop.trophicTransition}`),
            );
            if (hop.sourceId) {
              const locLabel = hop.sourcePath
                ? `${hop.sourcePath}${hop.line ? ` · 第 ${hop.line} 行` : ''}`
                : `打开出处笔记`;
              const hopBtn = element('button', 'compiler-link-action', locLabel);
              hopBtn.type = 'button';
              hopBtn.dataset.pathEvidenceSource = hop.sourceId;
              hopBtn.onclick = () => api.open(hop.sourceId).catch(error => { status.textContent = error.message; });
              hopRow.append(hopBtn);
            }
            pathEvList.append(hopRow);
          }
          pathEvDetails.append(pathEvSummary, pathEvList);
          pathResultBar.append(pathEvDetails);
        }
        return;
      }
      pathClearBtn.hidden = true;
      const hubs = (data?.topHubs || []).slice(0, 3);
      if (hubs.length) {
        pathResultBar.append(element('span', 'graph-path-summary-badge', '核心枢纽：'));
        for (const hub of hubs) {
          const shortHubTitle = String(hub.title || '').length > 10 ? String(hub.title).slice(0, 10) + '…' : hub.title;
          const chip = element('button', 'graph-filter-pill graph-hub-chip', `${shortHubTitle} (${hub.pageRank})`);
          chip.type = 'button';
          chip.dataset.hubNoteId = hub.id;
          chip.dataset.pillTone = hub.isBridge ? 'purple' : 'blue';
          chip.title = `${hub.title} · ${hub.communityLabel}${hub.isBridge ? ' · 跨社区桥梁节点' : ''}`;
          chip.onclick = () => {
            const targetNode = result?.nodes.find(n => n.id === hub.id);
            if (targetNode) inspect(targetNode);
          };
          pathResultBar.append(chip);
        }
      }
    }
    async function follow(node) {
      if (!node || opening || scope.signal.aborted) return;
      opening = true;
      try {
        if (node.ghost) { await api.createNote(node.cleanTitle || node.label); api.navigate('write'); }
        else await api.open(node.id);
      } catch (error) { if (!scope.signal.aborted) status.textContent = error.message; }
      finally { opening = false; }
    }
    async function refresh() {
      if (scope.signal.aborted) return;
      persistEnabled = Boolean(api.getSetting('persist-layout'));
      const current = ++request;
      try {
        const dismissedEdges = Array.isArray(api.getSetting('dismissed-edges')) ? api.getSetting('dismissed-edges') : [];
        const query = local
          ? { scope: 'local', depth: api.getSetting('local-depth') || 1, includeTagLinks: Boolean(api.getSetting('local-tags')) }
          : { ...filters, scope: 'global', ...(dismissedEdges.length ? { dismissedEdges } : {}) };
        const data = await api.queryGraph(query, { signal: scope.signal, key: 'graph-' + (local ? 'local' : 'global') }); if (scope.signal.aborted || current !== request) return;
        graph.setAppearance({ layout: api.getSetting('layout'), visualStyle: api.getSetting('visual-style'), nodeScale: api.getSetting('node-scale'), spacing: api.getSetting('spacing'), linkOpacity: api.getSetting('link-opacity') });
        cacheKey = JSON.stringify([data.vaultKey || '', mode, local ? data.centerId : 'global', query]);
        if (loadedKey !== cacheKey && persistEnabled) { loadedKey = cacheKey; const saved = await loadGraphState(cacheKey); if (scope.signal.aborted || current !== request) return; if (saved) graph.savedState = saved; }
        result = data;
        stage.dataset.nodeCount = String(data.nodes.length); stage.dataset.edgeCount = String(data.edges.length);
        if (local) { depth.value = String(query.depth); tags.checked = query.includeTagLinks; }
        else {
          layoutSelect.value = api.getSetting('layout'); styleSelect.value = api.getSetting('visual-style');
          tagFilter.replaceChildren(new Option('全部标签', ''), ...data.tags.map(item => new Option('#' + item.tag + ' (' + item.count + ')', item.tag))); tagFilter.value = filters.tag;
          for (const button of toolbar.querySelectorAll('[data-graph-mode]')) { const active = button.dataset.graphMode === filters.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
          if (selected) { selected = data.nodes.find(node => node.id === selected.id) || null; inspect(selected); }
          renderAnalyticsControls(data);
        }
        updateStatus(false);
        graph.setData(data);
        stage.dataset.appliedQuery = local ? '' : filters.query;
        updateStatus();
      } catch (error) { if (!scope.signal.aborted && current === request && error.name !== 'AbortError') status.textContent = error.message; }
    }
    stage.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button === open) follow(selected);
      else if (button.dataset.graphMode) { filters.mode = button.dataset.graphMode; activeCommunityId = ''; activePathResult = null; graph.setCommunityFilter(''); graph.setHighlightedPath(null); refresh(); }
      else if (button.dataset.communityFilter !== undefined) {
        activeCommunityId = activeCommunityId === button.dataset.communityFilter ? '' : button.dataset.communityFilter;
        graph.setCommunityFilter(activeCommunityId);
        if (result) renderAnalyticsControls(result);
      } else if (button === pathFindBtn && result) {
        const directPath = findShortestGraphPath(result.nodes, result.edges, pathStartSelect.value, pathEndSelect.value);
        activePathResult = directPath.found
          ? directPath
          : findShortestGraphPath(result.nodes, result.edges, pathStartSelect.value, pathEndSelect.value, {
              includeInferred: true,
              inferredEdges: result.inferredEdges || [],
            });
        graph.setHighlightedPath(activePathResult);
        renderPathOrHubsResult(result);
      } else if (button === pathClearBtn && result) {
        activePathResult = null;
        graph.setHighlightedPath(null);
        renderPathOrHubsResult(result);
      } else if (button.dataset.graphCommand === 'in') { graph.zoomBy(1.25); schedulePersist(); }
      else if (button.dataset.graphCommand === 'out') { graph.zoomBy(0.8); schedulePersist(); }
      else if (button.dataset.graphCommand === 'fit') { graph.fit(true); schedulePersist(); }
      else if (button.dataset.graphCommand === 'layout' && result) { remembered[mode] = null; graph.layoutKey = ''; graph.setData(result); }
    }, { signal: scope.signal });
    stage.addEventListener('change', event => {
      if (event.target === depth) api.setSetting('local-depth', Number(depth.value)).catch(error => { status.textContent = error.message; });
      else if (event.target === tags) api.setSetting('local-tags', tags.checked).catch(error => { status.textContent = error.message; });
      else if (event.target === tagFilter) { filters.tag = tagFilter.value; refresh(); }
      else if (event.target === layoutSelect) api.setSetting('layout', layoutSelect.value).catch(error => { status.textContent = error.message; });
      else if (event.target === styleSelect) api.setSetting('visual-style', styleSelect.value).catch(error => { status.textContent = error.message; });
    }, { signal: scope.signal });
    search?.addEventListener('input', () => { filters.query = search.value; clearTimeout(timer); timer = setTimeout(refresh, 100); }, { signal: scope.signal });
    for (const event of ['pointerup', 'wheel']) canvas.addEventListener(event, schedulePersist, { signal: scope.signal });
    scope.own(api.on('vault.changed', refresh)); scope.own(api.on('workspace.active', refresh));
    scope.own(api.on('settings.changed', event => { if (event.pluginId === api.pluginId) return refresh(); }));
    scope.own(api.on('workspace.appearance', () => graph.render()));
    refresh();
    return () => { request++; clearTimeout(timer); clearTimeout(persistTimer); remembered[mode] = graph.captureState(); if (cacheKey && persistEnabled && remembered[mode]) saveGraphState(cacheKey, remembered[mode]).catch(() => {}); graph.dispose(); stage.remove(); };
  }
}