import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listLocalMcpTools,
  runLocalMcpAgentSession,
  computeFolderSyncPlan,
  mergeConflictedNote,
  buildMirrorSimulationFixture,
} from './local-agent-sync.mjs';

const sampleVault = [
  {
    id: 'n0',
    name: '00-墨图导览与万象星图.md',
    relativePath: '00-墨图导览与万象星图.md',
    title: '00-墨图导览与万象星图',
    tags: ['墨图核心'],
    source: '---\ntitle: 00-墨图导览与万象星图\ntags: [墨图核心]\n---\n\n# 墨图导览\n\n前往 [[01-双链笔记与卡片盒方法]] 或待建的 [[卡片写作十诫]]。\n',
  },
  {
    id: 'n1',
    name: '01-双链笔记与卡片盒方法.md',
    relativePath: '01-双链笔记与卡片盒方法.md',
    title: '01-双链笔记与卡片盒方法',
    tags: ['双链笔记'],
    source: '---\ntitle: 01-双链笔记与卡片盒方法\ntags: [双链笔记]\n---\n\n# 双链笔记\n\n卢曼卡片盒强调原子化概念网络。\n',
  },
  {
    id: 'n2',
    name: '99-灵感速记.md',
    relativePath: 'notes/99-灵感速记.md',
    title: '99-灵感速记',
    tags: [],
    orphan: true,
    source: '# 灵感速记\n\n尚未建立双链的孤岛卡片。\n',
  },
];

test('AIA-005 listLocalMcpTools and runLocalMcpAgentSession generate multi-step trace and gated write proposals', () => {
  const tools = listLocalMcpTools();
  assert.equal(tools.length, 6);
  assert.deepEqual(
    tools.map(t => t.id),
    ['search_notes', 'read_section', 'find_knowledge_gaps', 'summarize_project', 'propose_note', 'batch_tag_update'],
  );

  const session = runLocalMcpAgentSession(sampleVault, {
    goal: '双链笔记与卡片写作十诫盲区补全',
    toolId: 'propose_note',
    today: '2026-10-26',
  });
  assert.ok(session.traceSteps.length >= 4);
  assert.equal(session.traceSteps[0].phase, 'plan');
  assert.ok(session.traceSteps.some(s => s.toolId === 'search_notes'));
  assert.ok(session.traceSteps.some(s => s.toolId === 'find_knowledge_gaps'));
  assert.equal(session.pendingWriteProposal.requiresHumanApproval, true);
  assert.equal(session.pendingWriteProposal.kind, 'create-note');
  assert.match(session.pendingWriteProposal.diffPreview, /\+ title:/);

  const tagSession = runLocalMcpAgentSession(sampleVault, {
    goal: '为笔记统一补充核心标签',
    toolId: 'batch_tag_update',
    targetTag: '第二大脑',
  });
  assert.equal(tagSession.pendingWriteProposal.kind, 'batch-tag-update');
  assert.ok(tagSession.pendingWriteProposal.mutations.length >= 1);
  assert.match(tagSession.pendingWriteProposal.diffPreview, /\+ tags:.*第二大脑/);
});

test('SYNC-001 computeFolderSyncPlan classifies identical, local-only, remote-only, and conflicted notes by SHA-256', () => {
  const fixture = buildMirrorSimulationFixture(sampleVault);
  const plan = computeFolderSyncPlan(sampleVault, fixture.mirrorNotes, fixture.baselineHashes);

  assert.equal(plan.summary.totalPaths, 4);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.summary.pullCount, 1);
  assert.equal(plan.summary.identicalCount, 2);

  const conflictItem = plan.items.find(i => i.status === 'conflict');
  assert.ok(conflictItem);
  assert.equal(conflictItem.relativePath, '00-墨图导览与万象星图.md');
  assert.notEqual(conflictItem.localSha256, conflictItem.remoteSha256);

  const pullItem = plan.items.find(i => i.status === 'remote-only');
  assert.ok(pullItem);
  assert.equal(pullItem.relativePath, 'notes/镜像端跨设备同步笔记.md');
});

test('SYNC-001 mergeConflictedNote supports keep-local, use-remote, and combine while preserving UTF-8 BOM and CRLF', () => {
  const localSrc = '\uFEFF---\r\ntitle: 同步测试\r\n---\r\n\r\n# 同步测试\r\n\r\n主库原有第一段内容。\r\n';
  const remoteSrc = '---\ntitle: 同步测试\n---\n\n# 同步测试\n\n主库原有第一段内容。\n\n镜像库新增的跨端研究记录。\n';

  const combined = mergeConflictedNote(localSrc, remoteSrc, 'combine');
  assert.ok(combined.mergedSource.startsWith('\uFEFF'));
  assert.ok(combined.mergedSource.includes('\r\n'));
  assert.ok(combined.mergedSource.includes('主库原有第一段内容。'));
  assert.ok(combined.mergedSource.includes('镜像库新增的跨端研究记录。'));
  assert.equal(combined.uniqueAddedLines, 1);

  const keptLocal = mergeConflictedNote(localSrc, remoteSrc, 'keep-local');
  assert.equal(keptLocal.mergedSource, localSrc);

  const usedRemote = mergeConflictedNote(localSrc, remoteSrc, 'use-remote');
  assert.ok(usedRemote.mergedSource.startsWith('\uFEFF'));
  assert.ok(usedRemote.mergedSource.includes('\r\n'));
  assert.ok(usedRemote.mergedSource.includes('镜像库新增的跨端研究记录。'));
});
