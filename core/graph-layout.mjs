import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide, forceRadial } from '../app/node_modules/d3-force/src/index.js';

export async function layoutGraph(input, cancelled = () => false) {
  const local = input.mode === 'local';
  const layout = ['force', 'radial', 'folders', 'trophic'].includes(input.layout) ? input.layout : 'force';
  const spacing = Math.max(50, Math.min(220, Number(input.spacing) || (local ? 90 : 115)));
  const nodes = input.nodes.map(node => ({
    id: node.id,
    radius: node.radius || 8,
    folder: node.folder || '',
    trophicLayer: node.trophicLayer || 'L1',
    isCenter: Boolean(node.isCenter),
    ...(node.isCenter && layout !== 'trophic' ? { fx: 0, fy: 0 } : {}),
  }));
  const ids = new Set(nodes.map(node => node.id));
  const links = input.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({ source: edge.source, target: edge.target }));
  const linkedIds = new Set();
  for (const l of links) { linkedIds.add(l.source); linkedIds.add(l.target); }
  const simulation = forceSimulation(nodes).stop()
    .force('links', forceLink(links).id(node => node.id).distance(spacing).strength(layout === 'force' ? 0.28 : 0.12))
    .force('charge', forceManyBody().strength(local ? -260 : -220).distanceMax(local ? 450 : 340))
    .force('collision', forceCollide(node => node.radius + (local ? 8 : 22)).iterations(local ? 1 : 2))
    .force('x', forceX().strength(node => local ? 0.05 : (linkedIds.has(node.id) ? 0.055 : 0.22)))
    .force('y', forceY().strength(node => local ? 0.07 : (linkedIds.has(node.id) ? 0.07 : 0.24)));
  if (layout === 'radial') simulation.force('radial', forceRadial(node => node.isCenter ? 0 : Math.max(spacing, Math.sqrt(nodes.length) * spacing * .6)).strength(.7));
  if (layout === 'folders') {
    const folders = [...new Set(nodes.map(node => node.folder))].sort();
    const distance = Math.max(spacing * 2, Math.sqrt(nodes.length) * spacing * .5);
    const centers = new Map(folders.map((folder, index) => [folder, { x: Math.cos(index / folders.length * Math.PI * 2) * distance, y: Math.sin(index / folders.length * Math.PI * 2) * distance }]));
    simulation.force('x', forceX(node => centers.get(node.folder).x).strength(.25)).force('y', forceY(node => centers.get(node.folder).y).strength(.25));
  }
  if (layout === 'trophic') {
    const bandY = { L3: -spacing * 1.45, L2: 0, L1: spacing * 1.45 };
    const layerGroups = { L3: [], L2: [], L1: [] };
    for (const node of nodes) {
      const layer = layerGroups[node.trophicLayer] ? node.trophicLayer : 'L1';
      layerGroups[layer].push(node);
    }
    const targetXMap = new Map();
    for (const group of Object.values(layerGroups)) {
      const count = group.length;
      group.forEach((node, idx) => {
        const span = Math.max(180, (count - 1) * (spacing * 0.72));
        const xPos = count <= 1 ? 0 : -span / 2 + (idx / (count - 1)) * span;
        targetXMap.set(node.id, xPos);
      });
    }
    simulation
      .force('x', forceX(node => targetXMap.get(node.id) || 0).strength(0.32))
      .force('y', forceY(node => bandY[node.trophicLayer] ?? bandY.L1).strength(0.68));
  }
  const started = performance.now(); const iterations = local ? 90 : 140;
  const budget = Math.min(5000, Math.max(20, input.budgetMs || 2500));
  let ticks = 0;
  try {
    while (ticks < iterations && performance.now() - started < budget) {
      if (cancelled()) return null;
      simulation.tick(); ticks++;
      if (ticks % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })), ticks, limited: ticks < iterations, durationMs: performance.now() - started };
  } finally { simulation.stop(); }
}