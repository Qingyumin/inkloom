import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSecondaryWindowSpec,
  buildSecondaryWindowUrl,
  parseSecondaryWindowUrl,
  detectTabTearOffGesture,
  createSyncEnvelope,
  reconcileCrossWindowNoteUpdate,
} from './multi-window-docking.mjs';

test('MAJOR-190 validateSecondaryWindowSpec, buildSecondaryWindowUrl and parseSecondaryWindowUrl round-trip secondary window specs and reject traversal', () => {
  const spec = validateSecondaryWindowSpec({
    windowId: 'subwin-01',
    targetType: 'reader',
    targetId: 'raw/智能制造与双链溯源规范.pdf',
    title: '智能制造与双链溯源规范',
    relativePath: 'raw/智能制造与双链溯源规范.pdf',
    readerPage: 2,
  });
  assert.equal(spec.isSecondary, true);
  assert.equal(spec.targetType, 'reader');
  assert.equal(spec.readerPage, 2);

  const url = buildSecondaryWindowUrl('https://inkloom.local/index.html', spec);
  assert.ok(url.includes('secondary=1'));
  assert.ok(url.includes('targetType=reader'));
  assert.ok(url.includes('page=2'));

  const parsed = parseSecondaryWindowUrl(url);
  assert.equal(parsed.isSecondary, true);
  assert.equal(parsed.windowId, 'subwin-01');
  assert.equal(parsed.targetType, 'reader');
  assert.equal(parsed.relativePath, 'raw/智能制造与双链溯源规范.pdf');
  assert.equal(parsed.readerPage, 2);

  assert.throws(() => validateSecondaryWindowSpec({ targetType: 'unknown-type' }), /不支持的副窗口目标类型/);
  assert.throws(() => validateSecondaryWindowSpec({ targetType: 'note', relativePath: '../outside.md' }), /非法相对路径段/);
});

test('MAJOR-190 detectTabTearOffGesture distinguishes in-bar tab reorder from vertical tear-off and reconcileCrossWindowNoteUpdate protects dirty drafts', () => {
  const reorder = detectTabTearOffGesture({ x: 180, y: 16 }, { x: 260, y: 18 }, { top: 0, bottom: 36 });
  assert.equal(reorder.tearOff, false);
  assert.equal(reorder.reason, 'in-bar-reorder');

  const tearOff = detectTabTearOffGesture({ x: 180, y: 16 }, { x: 210, y: 92 }, { top: 0, bottom: 36 });
  assert.equal(tearOff.tearOff, true);
  assert.equal(tearOff.reason, 'vertical-tear-off');

  const envelope = createSyncEnvelope({
    eventType: 'note-saved',
    sourceWindowId: 'win-sub',
    payload: {
      noteId: 'note-01',
      relativePath: 'notes/01-双链笔记.md',
      source: '# 新内容\n\n跨窗口实时同步正文',
      hash: 'a'.repeat(64),
    },
  });

  const cleanUpdate = reconcileCrossWindowNoteUpdate({
    localWindowId: 'win-main',
    activeNoteId: 'note-01',
    isLocalDirty: false,
    localSource: '# 旧内容',
    envelope,
  });
  assert.equal(cleanUpdate.action, 'apply-live-update');
  assert.equal(cleanUpdate.nextSource, '# 新内容\n\n跨窗口实时同步正文');

  const dirtyConflict = reconcileCrossWindowNoteUpdate({
    localWindowId: 'win-main',
    activeNoteId: 'note-01',
    isLocalDirty: true,
    localSource: '# 本地未保存草稿',
    envelope,
  });
  assert.equal(dirtyConflict.action, 'conflict-preserve-draft');
  assert.equal(dirtyConflict.reason, 'local-draft-dirty');
});
