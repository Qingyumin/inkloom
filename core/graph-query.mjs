import { filterGlobalGraph, queryLocalSubgraph } from './vault-graph.mjs';
import { computeGraphAnalytics } from './spatial-canvas-graph.mjs';

export function computeFastTrophicLevels(nodes = [], edges = []) {
  const N = nodes.length;
  const byNoteId = new Map();
  if (!N) return { byNoteId, layerCounts: { l1: 0, l2: 0, l3: 0 } };
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const inWeights = new Float64Array(N);
  const incomingLists = Array.from({ length: N }, () => []);
  for (const edge of edges || []) {
    const i = idToIdx.get(edge.source);
    const j = idToIdx.get(edge.target);
    if (i !== undefined && j !== undefined && i !== j) {
      incomingLists[i].push(j);
      inWeights[i] += 1;
    }
  }
  const h0 = new Float64Array(N);
  const h = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const folder = String(nodes[i].folder || '').toLowerCase();
    const titleStr = String(nodes[i].title || nodes[i].name || '');
    if (folder.startsWith('digests') || folder.startsWith('chronicles') || folder.startsWith('wiki/topics') || /出版|微站|Agent|智能体|编译器/.test(titleStr)) {
      h0[i] = 2.24;
    } else if (folder.startsWith('wiki') || folder.startsWith('skills') || /Wiki|概念百科|文献解析/.test(titleStr)) {
      h0[i] = 1.88;
    } else if (folder.startsWith('raw') || folder.startsWith('journals') || folder.startsWith('notes') || inWeights[i] === 0) {
      h0[i] = 1.14;
    } else {
      h0[i] = 1.52;
    }
    h[i] = h0[i];
  }
  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < N; i++) {
      if (inWeights[i] <= 0) continue;
      let sum = 0;
      for (const j of incomingLists[i]) sum += Math.max(0, h[j] - 1.0);
      const avgUpstream = sum / (inWeights[i] + 1.2);
      const degBonus = 0.14 * Math.log(1 + inWeights[i]);
      h[i] = Math.min(2.88, Math.max(1.05, h0[i] + 0.28 * avgUpstream + degBonus));
    }
  }
  let l1 = 0, l2 = 0, l3 = 0;
  for (let i = 0; i < N; i++) {
    const height = Math.round(h[i] * 100) / 100;
    let layer = 'L1';
    let layerLabel = 'L1 基石证据层';
    if (height >= 2.2) { layer = 'L3'; layerLabel = 'L3 顶层综合层'; l3++; }
    else if (height >= 1.45) { layer = 'L2'; layerLabel = 'L2 概念晶体层'; l2++; }
    else { l1++; }
    byNoteId.set(nodes[i].id, { trophicHeight: height, layer, layerLabel });
  }
  return { byNoteId, layerCounts: { l1, l2, l3 } };
}

export function computeInferredGraphEdges(nodes = [], explicitEdges = [], dismissedPairs = []) {
  const realNodes = (nodes || []).filter(n => n && !n.ghost && n.exists !== false);
  if (realNodes.length > 240) return [];
  const explicitPairs = new Set();
  for (const e of explicitEdges || []) {
    const a = String(e.source || '');
    const b = String(e.target || '');
    if (a && b) {
      explicitPairs.add(a < b ? `${a}::${b}` : `${b}::${a}`);
    }
  }
  const dismissedSet = new Set((dismissedPairs || []).map(String));
  const genericTags = new Set(['墨图笔记', '使用指南', '使用教程', 'Wiki概念', 'Wiki文献', 'Wiki晶体', 'Karpathy编译']);
  const inferred = [];

  const cleanConceptName = raw => String(raw || '')
    .replace(/^(?:概念百科|文献解析|Wiki)\s*·\s*/, '')
    .replace(/^\d+(?:\.\d+)*[-_.\s]+/, '')
    .trim();

  for (let i = 0; i < realNodes.length; i++) {
    for (let j = i + 1; j < realNodes.length; j++) {
      const nA = realNodes[i];
      const nB = realNodes[j];
      const pairKey = nA.id < nB.id ? `${nA.id}::${nB.id}` : `${nB.id}::${nA.id}`;
      if (explicitPairs.has(pairKey) || dismissedSet.has(pairKey)) continue;

      // 1. Concept / Entity match across titles, aliases, and headings
      const conceptsA = [...new Set([cleanConceptName(nA.cleanTitle || nA.title), ...(nA.aliases || []).map(cleanConceptName)].filter(c => c && c.length >= 2))];
      const conceptsB = [...new Set([cleanConceptName(nB.cleanTitle || nB.title), ...(nB.aliases || []).map(cleanConceptName)].filter(c => c && c.length >= 2))];
      let matchedConcept = '';
      let evidence = [];

      for (const cB of conceptsB) {
        const hMatch = (nA.headings || []).find(h => String(h.text || '').includes(cB));
        if (hMatch) {
          matchedConcept = cB;
          evidence = [{ sourceId: nA.id, sourcePath: nA.relativePath || nA.name || '', line: hMatch.line || 1 }];
          break;
        }
        if (conceptsA.some(cA => cA !== cB && (cA.includes(cB) || cB.includes(cA)))) {
          matchedConcept = cB;
          break;
        }
      }
      if (!matchedConcept) {
        for (const cA of conceptsA) {
          const hMatch = (nB.headings || []).find(h => String(h.text || '').includes(cA));
          if (hMatch) {
            matchedConcept = cA;
            evidence = [{ sourceId: nB.id, sourcePath: nB.relativePath || nB.name || '', line: hMatch.line || 1 }];
            break;
          }
        }
      }

      const sharedTags = (nA.tags || []).filter(t => (nB.tags || []).includes(t));
      const domainShared = sharedTags.filter(t => !genericTags.has(t));
      const sameSubfolder = nA.folder && nA.folder !== '根目录' && nA.folder === nB.folder;

      if (matchedConcept) {
        inferred.push({
          id: `inferred:${pairKey}`,
          pairKey,
          source: nA.id,
          target: nB.id,
          kind: 'entity',
          ghost: false,
          relation: 'concept-entity',
          confidence: 'INFERRED',
          sharedEntities: [matchedConcept],
          sharedTags: domainShared,
          evidence,
          reason: evidence.length
            ? `概念实体「${matchedConcept}」(${evidence[0].sourcePath} 第 ${evidence[0].line} 行)`
            : `概念实体关联：「${matchedConcept}」`,
        });
        if (inferred.length >= 60) return inferred;
        continue;
      }

      if (domainShared.length > 0 || (sharedTags.length > 0 && sameSubfolder)) {
        inferred.push({
          id: `inferred:${pairKey}`,
          pairKey,
          source: nA.id,
          target: nB.id,
          kind: 'tag',
          ghost: false,
          relation: 'shared-tag',
          confidence: 'INFERRED',
          sharedEntities: [],
          sharedTags: domainShared.length ? domainShared : sharedTags,
          evidence: [],
          reason: domainShared.length
            ? `共同标签：#${domainShared.join(' #')}`
            : `同目录 (${nA.folder}) 共同标签：#${sharedTags.join(' #')}`,
        });
        if (inferred.length >= 60) return inferred;
      }
    }
  }
  return inferred;
}

export function queryGraphSnapshot(graph, activeId, options = {}) {
  const local = options.scope === 'local';
  const active = graph?.nodeMap.get(activeId);
  const selected = local
    ? queryLocalSubgraph(graph, activeId, { depth: options.depth, includeTagLinks: options.includeTagLinks === true })
    : filterGlobalGraph(graph, { mode: options.mode, folder: active?.folder || '', tag: options.tag, query: options.query, activeNoteId: activeId });
  const analytics = local ? null : computeGraphAnalytics(selected.nodes, selected.edges);
  const trophic = computeFastTrophicLevels(selected.nodes, selected.edges);
  const bridgeSet = new Set(analytics?.bridgeNodeIds || []);
  const inferredEdges = computeInferredGraphEdges(selected.nodes, selected.edges, options.dismissedEdges || []);
  return {
    version: graph?.version || 0, centerId: activeId || '', scope: local ? 'local' : 'global',
    nodes: selected.nodes.map(node => {
      const comm = analytics?.communityById.get(node.id);
      const tInfo = trophic.byNoteId?.get(node.id);
      return {
        id: node.id, title: node.title, label: node.label, cleanTitle: node.cleanTitle, name: node.name, relativePath: node.relativePath || node.name || '',
        folder: node.folder, tags: [...(node.tags || [])], ghost: Boolean(node.ghost), exists: Boolean(node.exists), orphan: Boolean(node.orphan),
        isCenter: Boolean(node.isCenter), hop: node.hop || 0, degree: node.degree, inDegree: node.inDegree, outDegree: node.outDegree,
        highlighted: node.highlighted !== false, dimmed: Boolean(node.dimmed),
        pageRank: analytics?.pageRankById.get(node.id) || 0,
        trophicHeight: tInfo?.trophicHeight ?? 1.2,
        trophicLayer: tInfo?.layer || 'L1',
        trophicLabel: tInfo?.layerLabel || 'L1 基石证据层',
        communityId: comm?.communityId || '',
        communityIndex: comm?.communityIndex ?? 0,
        communityLabel: comm?.communityLabel || '',
        communityTone: comm?.communityTone || 'teal',
        isBridge: bridgeSet.has(node.id),
      };
    }),
    edges: selected.edges.map(edge => {
      const sourceNote = graph?.nodeMap.get(edge.source);
      const targetNote = graph?.nodeMap.get(edge.target);
      const explicit = edge.kind === 'wikilink';
      const evidence = explicit ? (graph?.outgoingByNote.get(edge.source) || []).filter(link => link.targetId === edge.target).slice(0, 6).map(link => ({ sourceId: edge.source, sourcePath: sourceNote?.relativePath || '', line: link.line, offset: link.from })) : [];
      return { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, ghost: Boolean(edge.ghost), relation: explicit ? 'references' : edge.kind === 'tag' ? 'shared-tag' : 'unknown', confidence: explicit ? 'EXTRACTED' : edge.kind === 'tag' ? 'INFERRED' : 'AMBIGUOUS', evidence, sharedTags: edge.kind === 'tag' ? (sourceNote?.tags || []).filter(tag => targetNote?.tags?.includes(tag)) : [] };
    }),
    inferredEdges,
    trophicStats: trophic.layerCounts || { l1: 0, l2: 0, l3: 0 },
    tags: (graph?.tagsIndex || []).map(item => ({ tag: item.tag, count: item.count })),
    communities: analytics?.communities || [],
    topHubs: analytics?.topHubs || [],
    bridgeNodeIds: analytics?.bridgeNodeIds || [],
    stats: { totalNotes: graph?.stats.totalNotes || 0, orphanCount: graph?.stats.orphanCount || 0, ghostCount: graph?.stats.ghostCount || 0 },
  };
}