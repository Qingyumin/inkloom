import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findShortestGraphPath,
  computeGraphAnalytics,
  createWhiteboardNoteCardElements,
  extractWhiteboardNoteCards,
} from './spatial-canvas-graph.mjs';
import { validateWhiteboard } from './whiteboard-document.mjs';

const sampleNodes = [
  { id: 'n0', title: '00-墨图导览', cleanTitle: '墨图导览', folder: '根目录', tags: ['核心'] },
  { id: 'n1', title: '01-双链笔记', cleanTitle: '双链笔记', folder: '核心方法', tags: ['核心', '双链'] },
  { id: 'n2', title: '02-知识图谱', cleanTitle: '知识图谱', folder: '核心方法', tags: ['图谱'] },
  { id: 'n3', title: '03-长文导出', cleanTitle: '长文导出', folder: '输出发布', tags: ['导出'] },
  { id: 'n4', title: '99-孤岛速记', cleanTitle: '孤岛速记', folder: 'notes', tags: [], orphan: true },
];

const sampleEdges = [
  { id: 'e01', source: 'n0', target: 'n1' },
  { id: 'e12', source: 'n1', target: 'n2' },
  { id: 'e23', source: 'n2', target: 'n3' },
  { id: 'e10', source: 'n1', target: 'n0' },
];

test('CANVAS-001 findShortestGraphPath finds multi-hop bridge path and detects disconnected nodes', () => {
  const path = findShortestGraphPath(sampleNodes, sampleEdges, 'n0', 'n3');
  assert.equal(path.found, true);
  assert.equal(path.hops, 3);
  assert.equal(path.bridgeCount, 2);
  assert.deepEqual(path.nodeIds, ['n0', 'n1', 'n2', 'n3']);
  assert.equal(path.steps[0].role, 'start');
  assert.equal(path.steps[1].role, 'bridge');
  assert.equal(path.steps[3].role, 'end');
  assert.equal(path.hopTransitions.length, 3);
  assert.equal(path.hopTransitions[0].fromId, 'n0');
  assert.equal(path.hopTransitions[0].toId, 'n1');
  assert.equal(path.hopTransitions[0].confidence, 'EXTRACTED');
  assert.match(path.summary, /《墨图导览》 → 《双链笔记》 → 《知识图谱》 → 《长文导出》/);

  const disconnected = findShortestGraphPath(sampleNodes, sampleEdges, 'n0', 'n4');
  assert.equal(disconnected.found, false);
  assert.match(disconnected.summary, /不同连通分量/);

  const inferredFallback = findShortestGraphPath(sampleNodes, sampleEdges, 'n0', 'n4', {
    includeInferred: true,
    inferredEdges: [{ id: 'inf-34', source: 'n3', target: 'n4', confidence: 'INFERRED', relation: 'concept-entity', reason: '概念实体关联：「孤岛速记」' }],
  });
  assert.equal(inferredFallback.found, true);
  assert.equal(inferredFallback.hops, 4);
  assert.equal(inferredFallback.hopTransitions[3].confidence, 'INFERRED');
  assert.match(inferredFallback.hopTransitions[3].relationLabel, /概念实体关联/);
});

test('CANVAS-002 computeGraphAnalytics computes PageRank hubs, communities and cross-cluster bridges', () => {
  const analytics = computeGraphAnalytics(sampleNodes, sampleEdges);
  assert.equal(analytics.pageRankById.size, 5);
  assert.ok(analytics.pageRankById.get('n1') > analytics.pageRankById.get('n4'));
  assert.ok(analytics.communities.length >= 2);
  assert.ok(analytics.topHubs.length >= 3);
  assert.equal(analytics.topHubs[0].id === 'n1' || analytics.topHubs[0].id === 'n0', true);
});

test('CANVAS-003 createWhiteboardNoteCardElements generates valid Excalidraw note cards and links', () => {
  const firstCard = createWhiteboardNoteCardElements({
    id: 'vault-01',
    title: '01-双链笔记与卡片盒方法',
    cleanTitle: '双链笔记与卡片盒方法',
    tags: ['双链笔记', '卡片盒'],
    source: '---\ntitle: 双链笔记与卡片盒方法\n---\n\n# 双链笔记\n\n卢曼卡片盒的核心是让原子概念卡片之间发生对话。',
  }, []);

  const secondCard = createWhiteboardNoteCardElements({
    id: 'vault-02',
    title: '02-知识图谱与局部星图',
    cleanTitle: '知识图谱与局部星图',
    tags: ['知识图谱'],
    source: '---\ntitle: 知识图谱与局部星图\n---\n\n# 知识图谱\n\n通过双层星图架构避免毛线球效应。',
  }, firstCard.elements, { connectFromRect: firstCard.rectElement });

  const combined = [...firstCard.elements, ...secondCard.elements];
  const validated = validateWhiteboard({
    type: 'excalidraw',
    version: 2,
    elements: combined,
    appState: {},
    files: {},
  });
  assert.equal(validated.elements.length, 5); // 2 rects + 2 texts + 1 connecting arrow

  const extracted = extractWhiteboardNoteCards(validated.elements);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].target, '双链笔记与卡片盒方法');
  assert.equal(extracted[1].target, '知识图谱与局部星图');
});
