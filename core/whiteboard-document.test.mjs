import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWhiteboard, whiteboardFromMarkdown, updateWhiteboardMarkdown, newWhiteboardMarkdown, renderWhiteboardSvgMarkup } from './whiteboard-document.mjs';

const element = { id: 'rectangle', type: 'rectangle', x: 10, y: 20, width: 100, height: 60, angle: 0, version: 1, isDeleted: false };
test('whiteboard JSON lives in Markdown while unrelated YAML, notes and line endings survive', () => {
  const original = '\uFEFF' + newWhiteboardMarkdown('Board: one').replaceAll('\n', '\r\n') + '\r\nKeep this linked note [[Source]].\r\n';
  const scene = whiteboardFromMarkdown(original).scene; scene.elements.push(element);
  const changed = updateWhiteboardMarkdown(original, scene); assert.ok(changed.startsWith('\uFEFF---\r\n')); assert.ok(changed.endsWith('Keep this linked note [[Source]].\r\n'));
  assert.deepEqual(whiteboardFromMarkdown(changed).scene.elements, [element]); assert.ok(!/(?<!\r)\n/.test(changed));
});
test('whiteboard limits reject executable links, external images, duplicate IDs and invalid coordinates', () => {
  const scene = { type: 'excalidraw', version: 2, elements: [element], files: {} };
  for (const changed of [{ ...element, x: Infinity }, { ...element, link: 'javascript:alert(1)' }, { ...element, type: 'script' }]) assert.throws(() => validateWhiteboard({ ...scene, elements: [changed] }));
  assert.throws(() => validateWhiteboard({ ...scene, elements: [element, element] }), /身份/);
  assert.throws(() => validateWhiteboard({ ...scene, files: { remote: { id: 'remote', mimeType: 'image/png', dataURL: 'https://example.com/image.png' } } }), /内嵌/);
  assert.throws(() => whiteboardFromMarkdown('```excalidraw\n{}\n```'), /格式/);
});
test('visual journal whiteboards record calendar dates and render safe SVG previews', () => {
  const journal = newWhiteboardMarkdown('Daily Sketch', { date: '2026-10-24' });
  assert.ok(journal.includes('date: 2026-10-24'));
  assert.ok(journal.includes('- journal'));
  assert.throws(() => newWhiteboardMarkdown('Bad Date', { date: '2026/10/24' }), /YYYY-MM-DD/);
  const svg = renderWhiteboardSvgMarkup({
    type: 'excalidraw',
    version: 2,
    elements: [
      element,
      { id: 'txt', type: 'text', x: 20, y: 40, width: 80, height: 24, angle: 0, text: 'Sketch <safe>' },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  });
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('<rect '));
  assert.ok(svg.includes('Sketch &lt;safe&gt;'));
});