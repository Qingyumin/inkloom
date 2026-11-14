import { wrap, releaseProxy } from 'comlink';
import { validGraphState } from '../../core/graph-state.mjs';
import { computeRenormalizedGraphClusters } from '../../core/karpathy-wiki-chronicle.mjs';

function hashNumber(str = '') {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const folderPalettes = {
  light: ['#2c7458', '#347baa', '#9e5d36', '#7b5896', '#3d7a72', '#a1546c'],
  dark: ['#97d5c2', '#8ec7ee', '#ebb986', '#ccb3e8', '#98d6ce', '#e6acc0'],
};

export class LoomGraphView {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.mode = options.mode || 'local';
    this.layout = options.layout || 'force'; this.visualStyle = options.visualStyle || 'atlas'; this.nodeScale = Number(options.nodeScale) || 1; this.linkOpacity = Number(options.linkOpacity) || .5;
    this.nodes = [];
    this.edges = [];
    this.hoveredId = null;
    this.draggingNode = null;
    this.panning = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.pointerMoved = false;
    this.layoutRequest = 0;
    this.layoutKey = '';
    this.savedState = options.state || null;
    this.restoreViewport = null;
    this.disposed = false;
    this.events = new AbortController();
    this.layoutWorker = options.createWorker ? options.createWorker() : new Worker(new URL('./graph-layout-worker.js', import.meta.url), { type: 'module', name: 'inkloom-graph-' + this.mode });
    this.layoutRemote = wrap(this.layoutWorker);

    const Observer = options.ResizeObserver || ResizeObserver;
    this.resizeObserver = new Observer(() => this.resize());
    if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);

    this.canvas.addEventListener('pointerdown', event => this.onPointerDown(event), { signal: this.events.signal });
    this.canvas.addEventListener('pointermove', event => this.onPointerMove(event), { signal: this.events.signal });
    this.canvas.addEventListener('pointerup', event => this.onPointerUp(event), { signal: this.events.signal });
    this.canvas.addEventListener('pointercancel', () => this.onPointerCancel(), { signal: this.events.signal });
    this.canvas.addEventListener('mouseleave', () => {
      if (this.hoveredId) {
        this.hoveredId = null;
        this.options.onHoverNode?.(null);
        this.render();
      }
    }, { signal: this.events.signal });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const factor = Math.exp(-Math.max(-180, Math.min(180, event.deltaY)) * 0.0018);
      this.zoomBy(factor, event.offsetX, event.offsetY);
    }, { passive: false, signal: this.events.signal });
  }

  setData({ nodes = [], edges = [], centerId = '' } = {}) {
    if (this.disposed) return;
    const key = JSON.stringify([centerId, this.layout, this.options.spacing || 115, this.nodeScale, nodes.map(node => [node.id, node.degree, node.folder]), edges.map(edge => [edge.source, edge.target])]);
    const sameLayout = this.layoutKey === key;
    const previous = new Map(this.nodes.map(node => [node.id, node]));
    const incomingIds = new Set(nodes.map(node => node.id));
    const restored = validGraphState(this.savedState) && this.savedState.key === key && this.savedState.positions.length === nodes.length && this.savedState.positions.every(node => incomingIds.has(node.id)) ? this.savedState : null;
    const savedPositions = new Map((restored?.positions || []).map(node => [node.id, node]));
    this.savedState = null;
    this.layoutKey = key;
    this.centerId = centerId;
    const folderIndex = new Map();
    let folderCounter = 0;
    const nonCenterNodes = nodes.filter(n => !n.isCenter);
    const hop1Nodes = nonCenterNodes.filter(n => (n.hop || 1) === 1);
    const hop2Nodes = nonCenterNodes.filter(n => (n.hop || 1) >= 2);
    const ringIndexes = new Map(nonCenterNodes.map((node, index) => [node.id, index]));
    const hopIndexes = new Map([...hop1Nodes.map((node, index) => [node.id, index]), ...hop2Nodes.map((node, index) => [node.id, index])]);

    this.nodes = nodes.map((node, index) => {
      const folderKey = node.folder || '根目录';
      if (!folderIndex.has(folderKey)) folderIndex.set(folderKey, folderCounter++);
      const radius = node.isCenter
        ? (this.mode === 'local' ? 11 : 13.5)
        : node.ghost
          ? 8
          : Math.min(16, (this.mode === 'local' ? 7.5 : 9) + Math.log2(1 + (node.degree || 0)) * 2.4);

      let x = 0;
      let y = 0;
      if (!node.isCenter) {
        if (this.mode === 'local') {
          const isHop2 = (node.hop || 1) >= 2;
          const ring = isHop2 ? hop2Nodes : hop1Nodes;
          const ringIdx = hopIndexes.get(node.id) || 0;
          const count = Math.max(1, ring.length);
          const angle = -Math.PI / 2 + (ringIdx / count) * Math.PI * 2 + (isHop2 ? 0.35 : 0);
          const rx = isHop2 ? 152 : 96;
          const ry = isHop2 ? 105 : 68;
          x = Math.cos(angle) * rx;
          y = Math.sin(angle) * ry;
        } else {
          const ringIdx = ringIndexes.get(node.id) || 0;
          const count = Math.max(1, nonCenterNodes.length);
          const angle = -Math.PI / 2 + (ringIdx / count) * Math.PI * 2;
          const tier = ringIdx % 2 === 0 ? 1 : 1.34;
          x = Math.cos(angle) * 185 * tier;
          y = Math.sin(angle) * 125 * tier;
        }
      }

      return {
        ...node,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: radius * this.nodeScale,
        colorGroup: folderIndex.get(folderKey),
        ...(previous.has(node.id) ? { x: previous.get(node.id).x, y: previous.get(node.id).y } : {}),
        ...(savedPositions.has(node.id) ? { x: savedPositions.get(node.id).x, y: savedPositions.get(node.id).y } : {}),
      };
    });

    const byId = new Map(this.nodes.map(node => [node.id, node]));
    this.edges = edges
      .filter(edge => byId.has(edge.source) && byId.has(edge.target))
      .map(edge => ({
        ...edge,
        sourceNode: byId.get(edge.source),
        targetNode: byId.get(edge.target),
      }));

    if (restored && this.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))) {
      this.layoutRequest++; this.layoutRemote.cancel?.();
      this.restoreViewport = restored; this.canvas.dataset.layoutState = restored.state; this.canvas.dataset.layoutRestored = 'true';
    } else if (!sameLayout) this.computeLayout();
    this.resize(!sameLayout && !restored);
  }

  captureState() {
    if (this.disposed || !['ready', 'budget-limited', 'manual'].includes(this.canvas.dataset.layoutState)) return null;
    return { key: this.layoutKey, state: this.canvas.dataset.layoutState, zoom: this.zoom,
      centerX: ((this.width || 1) / 2 - this.panX) / this.zoom, centerY: ((this.height || 1) / 2 - this.panY) / this.zoom,
      positions: this.nodes.map(node => ({ id: node.id, x: node.x, y: node.y })) };
  }

  setAppearance({ layout = 'force', visualStyle = 'atlas', nodeScale = 1, spacing = 115, linkOpacity = .5 } = {}) {
    this.layout = ['force', 'radial', 'folders', 'trophic'].includes(layout) ? layout : 'force';
    this.visualStyle = ['atlas', 'minimal', 'constellation'].includes(visualStyle) ? visualStyle : 'atlas';
    this.nodeScale = Math.max(.6, Math.min(1.8, Number(nodeScale) || 1)); this.options.spacing = Math.max(50, Math.min(220, Number(spacing) || 115)); this.linkOpacity = Math.max(.1, Math.min(1, Number(linkOpacity) || .5));
    this.canvas.dataset.graphStyle = this.visualStyle; this.canvas.dataset.graphLayout = this.layout;
  }

  async computeLayout() {
    if (this.disposed) return;
    const request = ++this.layoutRequest;
    this.canvas.dataset.layoutState = 'running';
    this.canvas.dataset.persistedLayout = 'false';
    try {
      this.canvas.dataset.layoutRestored = 'false';
      const result = await this.layoutRemote.layout({ mode: this.mode, layout: this.layout, spacing: this.options.spacing, nodes: this.nodes.map(node => ({ id: node.id, radius: node.radius, isCenter: node.isCenter, folder: node.folder, trophicLayer: node.trophicLayer || 'L1' })), edges: this.edges.map(edge => ({ source: edge.source, target: edge.target })) });
      if (!result || request !== this.layoutRequest) return;
      const positions = new Map(result.nodes.map(node => [node.id, node]));
      for (const node of this.nodes) Object.assign(node, positions.get(node.id));
      this.canvas.dataset.layoutState = result.limited ? 'budget-limited' : 'ready';
      this.canvas.dataset.layoutMs = String(Math.round(result.durationMs));
      this.resize(true);
    } catch (error) { if (request === this.layoutRequest) { this.canvas.dataset.layoutState = 'failed'; this.canvas.title = error.message; } }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.layoutRequest++; this.events.abort(); this.resizeObserver.disconnect();
    this.layoutRemote[releaseProxy](); this.layoutWorker.terminate();
    this.nodes = []; this.edges = []; this.draggingNode = null; this.panning = null; this.hoveredId = null;
    this.canvas.width = 0; this.canvas.height = 0; this.canvas.dataset.layoutState = 'disposed';
  }

  resize(autoFit = false) {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(160, Math.floor(rect.width));
    const height = Math.max(120, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
    }
    const prevWidth = this.width || width;
    const prevHeight = this.height || height;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    if (this.restoreViewport) {
      const restored = this.restoreViewport; this.restoreViewport = null;
      this.zoom = Math.max(0.015, Math.min(3.2, Number(restored.zoom) || 1));
      this.panX = width / 2 - restored.centerX * this.zoom; this.panY = height / 2 - restored.centerY * this.zoom;
    } else if (autoFit || (this.panX === 0 && this.panY === 0)) this.fit(false);
    else if (prevWidth !== width || prevHeight !== height) {
      this.panX += (width - prevWidth) / 2;
      this.panY += (height - prevHeight) / 2;
    }
    this.render();
  }

  fit(renderNow = true) {
    const width = this.width || 300;
    const height = this.height || 220;
    if (!this.nodes.length) {
      this.zoom = 1;
      this.panX = width / 2;
      this.panY = height / 2;
      if (renderNow) this.render();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x - node.radius - 36);
      maxX = Math.max(maxX, node.x + node.radius + 36);
      minY = Math.min(minY, node.y - node.radius - 26);
      maxY = Math.max(maxY, node.y + node.radius + 28);
    }
    const spanX = Math.max(120, maxX - minX);
    const spanY = Math.max(100, maxY - minY);
    const pad = this.mode === 'local' ? 24 : 56;
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    this.zoom = Math.max(0.015, Math.min(this.mode === 'local' ? 1.35 : 1.55, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.panX = width / 2 - cx * this.zoom;
    this.panY = height / 2 - cy * this.zoom;
    if (renderNow) this.render();
  }

  zoomBy(factor, cx = (this.width || 300) / 2, cy = (this.height || 200) / 2) {
    const nextZoom = Math.max(0.015, Math.min(3.2, this.zoom * factor));
    const ratio = nextZoom / this.zoom;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.zoom = nextZoom;
    this.render();
  }

  toScreen(x, y) {
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
    };
  }

  toWorld(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.zoom,
      y: (screenY - this.panY) / this.zoom,
    };
  }

  hitTest(screenX, screenY) {
    const world = this.toWorld(screenX, screenY);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const hitRadius = node.radius + 6 / this.zoom;
      if (Math.hypot(world.x - node.x, world.y - node.y) <= hitRadius) {
        return node;
      }
    }
    return null;
  }

  getScreenNodes() {
    return this.nodes.map(node => {
      const pt = this.toScreen(node.x, node.y);
      return {
        id: node.id,
        label: node.label,
        ghost: node.ghost,
        orphan: node.orphan,
        isCenter: node.isCenter,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        radius: Math.round(node.radius * this.zoom),
      };
    });
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    this.layoutRequest++; this.layoutRemote.cancel();
    this.canvas.dataset.layoutState = 'manual';
    this.pointerMoved = false;
    this.downPos = { x: event.offsetX, y: event.offsetY };
    const hit = this.hitTest(event.offsetX, event.offsetY);
    this.canvas.setPointerCapture(event.pointerId);
    if (hit) {
      this.draggingNode = { node: hit, pointerId: event.pointerId };
    } else {
      this.panning = {
        pointerId: event.pointerId,
        startX: event.offsetX,
        startY: event.offsetY,
        panX: this.panX,
        panY: this.panY,
      };
    }
  }

  onPointerMove(event) {
    if (this.downPos && Math.hypot(event.offsetX - this.downPos.x, event.offsetY - this.downPos.y) > 4) {
      this.pointerMoved = true;
    }
    if (this.draggingNode && this.draggingNode.pointerId === event.pointerId) {
      const world = this.toWorld(event.offsetX, event.offsetY);
      this.draggingNode.node.x = world.x;
      this.draggingNode.node.y = world.y;
      this.render();
      return;
    }
    if (this.panning && this.panning.pointerId === event.pointerId) {
      this.panX = this.panning.panX + (event.offsetX - this.panning.startX);
      this.panY = this.panning.panY + (event.offsetY - this.panning.startY);
      this.render();
      return;
    }
    const hit = this.hitTest(event.offsetX, event.offsetY);
    const nextHover = hit?.id || null;
    this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    this.canvas.title = hit?.title || '';
    if (nextHover !== this.hoveredId) {
      this.hoveredId = nextHover;
      this.options.onHoverNode?.(hit || null);
      this.render();
    }
  }

  onPointerUp(event) {
    const clickedNode = !this.pointerMoved ? (this.draggingNode?.node || this.hitTest(event.offsetX, event.offsetY)) : null;
    this.draggingNode = null;
    this.panning = null;
    this.downPos = null;
    if (clickedNode) {
      this.options.onSelectNode?.(clickedNode);
    }
  }

  onPointerCancel() {
    this.draggingNode = null;
    this.panning = null;
    this.downPos = null;
  }

  setHighlightedPath(pathResult = null) {
    if (!pathResult || !pathResult.found || !Array.isArray(pathResult.nodeIds) || !pathResult.nodeIds.length) {
      this.pathNodeSet = null;
      this.pathEdgeSet = null;
      this.canvas.dataset.activePathHops = '';
    } else {
      this.pathNodeSet = new Set(pathResult.nodeIds);
      this.pathEdgeSet = new Set(pathResult.edgeIds || []);
      this.canvas.dataset.activePathHops = String(pathResult.hops ?? 0);
    }
    this.render();
  }

  setCommunityFilter(communityId = '') {
    this.activeCommunity = communityId || '';
    this.canvas.dataset.activeCommunity = this.activeCommunity;
    this.render();
  }

  setRgClusterMode(enabled = false) {
    this.rgClusterMode = Boolean(enabled);
    this.canvas.dataset.rgClusterMode = String(this.rgClusterMode);
    this.render();
  }

  render() {
    if (this.disposed) return;
    this.canvas.dataset.zoom = String(this.zoom);
    this.canvas.dataset.panX = String(this.panX); this.canvas.dataset.panY = String(this.panY);
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.width || !this.height) return;
    const dpr = this.dpr || 1;
    const isDark = (document.querySelector('#app')?.dataset.workspaceMode || document.documentElement.dataset.uiMode) === 'dark';
    const rootStyle = getComputedStyle(document.querySelector('#app') || document.documentElement);
    const accent = rootStyle.getPropertyValue('--ui-accent').trim() || (isDark ? '#97d5c2' : '#2c7458');
    const inkColor = rootStyle.getPropertyValue('--ui-ink').trim() || (isDark ? '#e8efec' : '#283833');
    const mutedColor = rootStyle.getPropertyValue('--ui-muted').trim() || (isDark ? '#98aba2' : '#6d8077');
    const palette = isDark ? folderPalettes.dark : folderPalettes.light;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Subtle radial grid aura
    const bgGrad = ctx.createRadialGradient(
      this.width * 0.5, this.height * 0.5, 10,
      this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.65
    );
    bgGrad.addColorStop(0, isDark ? 'rgba(155, 212, 194, 0.06)' : 'rgba(44, 116, 88, 0.045)');
    bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!this.nodes.length) {
      ctx.fillStyle = mutedColor;
      ctx.font = "12px 'Manrope', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('当前筛选条件下暂无节点', this.width / 2, this.height / 2);
      ctx.restore();
      return;
    }

    const activeNeighbors = new Set();
    if (this.hoveredId) {
      activeNeighbors.add(this.hoveredId);
      for (const edge of this.edges) {
        if (edge.source === this.hoveredId) activeNeighbors.add(edge.target);
        if (edge.target === this.hoveredId) activeNeighbors.add(edge.source);
      }
    }

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // ALGO-003: Draw Helmholtz-Hodge Trophic Hierarchy horizontal strata when layout === 'trophic'
    if (this.layout === 'trophic') {
      const sp = this.options.spacing || 115;
      const bands = [
        { y: -sp * 1.45, label: 'L3 顶层综合层 (h ≥ 2.2 · 长稿/综述/演进史)', color: isDark ? 'rgba(235, 185, 134, 0.12)' : 'rgba(217, 119, 6, 0.08)' },
        { y: 0, label: 'L2 概念晶体层 (1.45 ≤ h < 2.2 · Wiki/概念卡)', color: isDark ? 'rgba(151, 213, 194, 0.12)' : 'rgba(44, 116, 88, 0.07)' },
        { y: sp * 1.45, label: 'L1 基石证据层 (h < 1.45 · raw/手记/一手笔记)', color: isDark ? 'rgba(142, 199, 238, 0.12)' : 'rgba(52, 123, 170, 0.07)' },
      ];
      for (const b of bands) {
        ctx.save();
        ctx.fillStyle = b.color;
        ctx.fillRect(-420, b.y - 38, 840, 76);
        ctx.strokeStyle = isDark ? 'rgba(155, 212, 194, 0.22)' : 'rgba(44, 116, 88, 0.18)';
        ctx.setLineDash([6 / this.zoom, 5 / this.zoom]);
        ctx.lineWidth = 1 / this.zoom;
        ctx.beginPath();
        ctx.moveTo(-420, b.y);
        ctx.lineTo(420, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = mutedColor;
        ctx.font = `600 ${Math.max(10, 11 / Math.pow(this.zoom, 0.35))}px 'Manrope', 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(b.label, -410, b.y - 18);
        ctx.restore();
      }
    }

    // ALGO-007: Block-Spin Renormalization Group (RG) Super-Bubbles overlay
    if (this.rgClusterMode || (this.mode === 'global' && this.zoom < 0.45 && this.nodes.length <= 500)) {
      const rg = computeRenormalizedGraphClusters(this.nodes, this.edges, this.rgClusterMode ? 0.42 : this.zoom);
      this.canvas.dataset.rgSuperBubbles = String(rg.superBubbles.length);
      for (const [bIdx, bubble] of rg.superBubbles.entries()) {
        const bubbleColor = palette[bIdx % palette.length];
        const bubbleRadius = Math.max(46, Math.min(135, 36 + Math.sqrt(bubble.memberCount) * 24));
        ctx.save();
        ctx.beginPath();
        ctx.arc(bubble.centroidX, bubble.centroidY, bubbleRadius, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? 'rgba(151, 213, 194, 0.09)' : 'rgba(44, 116, 88, 0.065)';
        ctx.fill();
        ctx.setLineDash([5 / this.zoom, 4 / this.zoom]);
        ctx.lineWidth = 1.6 / this.zoom;
        ctx.strokeStyle = bubbleColor;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `700 ${Math.max(11, 12 / Math.pow(this.zoom, 0.4))}px 'Manrope', 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = bubbleColor;
        ctx.fillText(`🫧 ${bubble.label} (${bubble.memberCount}篇)`, bubble.centroidX, bubble.centroidY - bubbleRadius - 4 / this.zoom);
        ctx.restore();
      }
    } else {
      this.canvas.dataset.rgSuperBubbles = '0';
    }

    // Draw edges
    for (const edge of this.edges) {
      const s = edge.sourceNode;
      const t = edge.targetNode;
      if (!s || !t) continue;
      const inPath = Boolean(this.pathEdgeSet && (this.pathEdgeSet.has(edge.id) || (this.pathNodeSet?.has(edge.source) && this.pathNodeSet?.has(edge.target))));
      const inCommunity = !this.activeCommunity || (this.activeCommunity === '__bridges__' ? (s.isBridge || t.isBridge) : (s.communityId === this.activeCommunity && t.communityId === this.activeCommunity));
      const isSpotlight = inPath || (!this.hoveredId || (edge.source === this.hoveredId || edge.target === this.hoveredId));
      const isDimmed = (this.pathNodeSet && !inPath) || (!inCommunity) || (s.dimmed || t.dimmed) || (this.hoveredId && !isSpotlight);

      ctx.save();
      ctx.beginPath();
      ctx.globalAlpha = inPath ? 1 : this.linkOpacity;
      if (edge.ghost || edge.kind === 'tag') {
        ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      }
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.lineWidth = (inPath ? 3.2 : (isSpotlight && this.hoveredId ? 2.1 : 1.35)) / Math.pow(this.zoom, 0.35);
      ctx.strokeStyle = inPath
        ? (isDark ? '#fbbf24' : '#d97706')
        : isDimmed
          ? (isDark ? 'rgba(150, 168, 160, 0.14)' : 'rgba(100, 125, 114, 0.14)')
          : (this.hoveredId && isSpotlight)
            ? accent
            : (isDark ? 'rgba(165, 212, 196, 0.42)' : 'rgba(56, 110, 88, 0.34)');
      ctx.stroke();

      // Directional arrow head
      if (edge.kind !== 'tag') {
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > t.radius + s.radius + 8) {
          const angle = Math.atan2(dy, dx);
          const ax = t.x - Math.cos(angle) * (t.radius + 3);
          const ay = t.y - Math.sin(angle) * (t.radius + 3);
          const arrowLen = 5.5 / Math.pow(this.zoom, 0.25);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - arrowLen * Math.cos(angle - 0.42), ay - arrowLen * Math.sin(angle - 0.42));
          ctx.lineTo(ax - arrowLen * Math.cos(angle + 0.42), ay - arrowLen * Math.sin(angle + 0.42));
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
      ctx.restore();
    }

    const labelBounds = [];
    let labelAttempts = 0;
    const orderedNodes = [...this.nodes].sort((first, second) => Number(second.id === this.hoveredId) - Number(first.id === this.hoveredId) || Number(second.isCenter) - Number(first.isCenter) || (second.degree || 0) - (first.degree || 0));
    for (const node of orderedNodes) {
      const isHovered = node.id === this.hoveredId;
      const inPath = Boolean(this.pathNodeSet?.has(node.id));
      const inCommunity = !this.activeCommunity || (this.activeCommunity === '__bridges__' ? node.isBridge : node.communityId === this.activeCommunity);
      const inSpotlight = inPath || (!this.hoveredId || activeNeighbors.has(node.id));
      const isDimmed = (this.pathNodeSet && !inPath) || (!inCommunity) || node.dimmed || !inSpotlight;
      const baseColor = inPath
        ? (isDark ? '#fbbf24' : '#d97706')
        : this.visualStyle === 'minimal' ? accent : node.isCenter
          ? accent
          : node.ghost
            ? (isDark ? '#dfb573' : '#b87628')
            : palette[node.colorGroup % palette.length];

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.25 : 1;

      // Halo for center, hovered, or path node
      if (node.isCenter || isHovered || inPath) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + (isHovered || inPath ? 6.5 : 5), 0, Math.PI * 2);
        ctx.fillStyle = inPath
          ? (isDark ? 'rgba(251, 191, 36, 0.28)' : 'rgba(217, 119, 6, 0.22)')
          : (isDark ? 'rgba(165, 212, 196, 0.20)' : 'rgba(44, 116, 88, 0.16)');
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      if (node.ghost) {
        ctx.fillStyle = isDark ? '#2b3135' : '#fbfaf6';
        ctx.fill();
        ctx.setLineDash([3, 2.5]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = baseColor;
        ctx.stroke();
      } else {
        ctx.fillStyle = this.visualStyle === 'minimal' ? (isDark ? '#202326' : '#ffffff') : baseColor;
        if (this.visualStyle === 'constellation') { ctx.shadowColor = baseColor; ctx.shadowBlur = 10 / Math.max(.2, this.zoom); }
        ctx.fill();
        ctx.lineWidth = node.isCenter || isHovered ? 2.2 : 1.4;
        ctx.strokeStyle = this.visualStyle === 'minimal' ? baseColor : isDark ? '#1e2426' : '#ffffff';
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Label rendering
      if ((this.zoom >= 0.25 || node.isCenter || isHovered || inPath) && labelAttempts++ < 200) {
        const fontSize = Math.max(9.5, Math.min(13, (node.isCenter || isHovered || inPath ? 12 : 10.5) / Math.pow(this.zoom, 0.42)));
        ctx.font = `${node.isCenter || isHovered || inPath ? '600' : '500'} ${fontSize}px 'Manrope', 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        let label = String(node.label || '').replace(/\s+\d{4}-\d{2}-\d{2}\s+\d{6}-[0-9a-f-]+$/i, '');
        if (label.length > 11 && !isHovered && !inPath) {
          label = label.slice(0, 10).replace(/[、，,·\-_\s]+$/, '') + '…';
        }
        const maximum = Math.min(150 / this.zoom, this.width * .8 / this.zoom);
        while (label.length > 2 && ctx.measureText(label).width > maximum) label = label.slice(0, -2) + '…';
        const width = ctx.measureText(label).width + 4 / this.zoom;
        const choices = [node.y + node.radius + 4 / this.zoom, node.y - node.radius - fontSize - 5 / this.zoom];
        const priorityLabel = Boolean(node.isCenter || isHovered || inPath);
        const bounds = choices.map(labelY => ({ left: node.x - width / 2, right: node.x + width / 2, top: labelY, bottom: labelY + fontSize + 3 / this.zoom })).find(rectangle => {
          const corner = this.toScreen(rectangle.left, rectangle.top); const end = this.toScreen(rectangle.right, rectangle.bottom);
          if (corner.x < 4 || corner.y < 4 || end.x > this.width - 4 || end.y > this.height - 4) return false;
          if (labelBounds.some(existing => rectangle.left < existing.right && rectangle.right > existing.left && rectangle.top < existing.bottom && rectangle.bottom > existing.top)) return false;
          if (priorityLabel) return true;
          return !this.nodes.some(other => other.id !== node.id && other.x + other.radius * 0.6 > rectangle.left && other.x - other.radius * 0.6 < rectangle.right && other.y + other.radius * 0.6 > rectangle.top && other.y - other.radius * 0.6 < rectangle.bottom);
        });
        if (bounds) {
          labelBounds.push(bounds);
          ctx.lineWidth = 2.4 / this.zoom;
          ctx.strokeStyle = isDark ? 'rgba(28, 35, 38, 0.90)' : 'rgba(255, 255, 255, 0.92)';
          ctx.strokeText(label, node.x, bounds.top);
          ctx.fillStyle = inPath ? (isDark ? '#fde68a' : '#b45309') : (node.ghost ? baseColor : inkColor);
          ctx.fillText(label, node.x, bounds.top);
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
