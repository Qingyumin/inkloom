import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertJsonCanvasToWhiteboardScene,
  exportWhiteboardSceneToJsonCanvas,
  buildWhiteboardSceneFromGraphSubgraph,
  extractWhiteboardNoteCards,
} from './spatial-canvas-graph.mjs';
import { validateWhiteboard } from './whiteboard-document.mjs';

test('MAJOR-240: Obsidian JSON Canvas 1.0 (.canvas) imports into valid Excalidraw scene and exports back to JSON Canvas', () => {
  const sampleCanvas = {
    nodes: [
      { id: 'n-file-1', type: 'file', file: 'notes/01-双链笔记与卡片盒方法.md', x: 40, y: 60, width: 260, height: 148, color: '5' },
      { id: 'n-text-2', type: 'text', text: '卡片盒核心洞察：原子化与双链网络', x: 380, y: 60, width: 260, height: 148, color: '4' },
      { id: 'n-group-1', type: 'group', label: '第一阶段研究簇', x: 20, y: 20, width: 660, height: 220 },
    ],
    edges: [
      { id: 'e-1', fromNode: 'n-file-1', fromSide: 'right', toNode: 'n-text-2', toSide: 'left' },
    ],
  };

  const scene = convertJsonCanvasToWhiteboardScene(sampleCanvas, [
    {
      id: 'note-1',
      title: '01-双链笔记与卡片盒方法',
      cleanTitle: '双链笔记与卡片盒方法',
      relativePath: 'notes/01-双链笔记与卡片盒方法.md',
      tags: ['双链笔记', '卡片盒'],
      source: '---\ntitle: 双链笔记与卡片盒方法\n---\n\n# 双链笔记\n\n通过双向链接织就知识网络。',
    },
  ]);

  const validated = validateWhiteboard(scene);
  assert.equal(validated.type, 'excalidraw');
  const cards = extractWhiteboardNoteCards(validated.elements);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].target, '双链笔记与卡片盒方法');

  const exportedCanvas = exportWhiteboardSceneToJsonCanvas(validated);
  assert.ok(Array.isArray(exportedCanvas.nodes));
  assert.ok(Array.isArray(exportedCanvas.edges));
  assert.ok(exportedCanvas.nodes.some(n => n.type === 'file' && n.file === '双链笔记与卡片盒方法.md'));
  assert.ok(exportedCanvas.nodes.some(n => n.type === 'text' && n.text.includes('卡片盒核心洞察')));
  assert.ok(exportedCanvas.nodes.some(n => n.type === 'group' && n.label === '第一阶段研究簇'));
  assert.equal(exportedCanvas.edges.length, 1);
});

test('MAJOR-240: Knowledge Graph shortest path and community subgraph synthesize valid spatial whiteboard scenes', () => {
  const sampleNodes = [
    { id: 'a', title: '起点卡片', cleanTitle: '起点卡片', tags: ['起点'], source: '起点摘要' },
    { id: 'b', title: '桥梁卡片', cleanTitle: '桥梁卡片', tags: ['桥梁'], source: '桥梁摘要' },
    { id: 'c', title: '终点卡片', cleanTitle: '终点卡片', tags: ['终点'], source: '终点摘要' },
  ];
  const pathResult = {
    found: true,
    hops: 2,
    steps: [
      { id: 'a', cleanTitle: '起点卡片', role: 'start' },
      { id: 'b', cleanTitle: '桥梁卡片', role: 'bridge' },
      { id: 'c', cleanTitle: '终点卡片', role: 'end' },
    ],
  };

  const pathScene = buildWhiteboardSceneFromGraphSubgraph(sampleNodes, [], { pathResult });
  const validatedPathScene = validateWhiteboard(pathScene);
  assert.equal(pathScene.cardCount, 3);
  assert.equal(extractWhiteboardNoteCards(validatedPathScene.elements).length, 3);
  assert.equal(validatedPathScene.elements.filter(el => el.type === 'arrow').length, 2);
});
