import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVaultSnapshot,
  verifyVaultSnapshot,
  diffVaultSnapshot,
} from './vault-snapshot.mjs';

test('createVaultSnapshot and diffVaultSnapshot detect unchanged, modified, missing, and newly added notes while verifying 64-char hashes', () => {
  const initialNotes = [
    { id: 'n1', relativePath: '00-导览.md', title: '导览', source: '# 导览\n\n第一版正文\n' },
    { id: 'n2', relativePath: '01-双链.md', title: '双链', source: '# 双链\n\n保持不变\n' },
    { id: 'n3', relativePath: '02-图谱.md', title: '图谱', source: '# 图谱\n\n稍后删除测试\n' },
  ];

  const snapshot = createVaultSnapshot(initialNotes, {
    label: '1.0.0 里程碑快照',
    vaultName: '测试知识库',
    createdAt: '2026-10-25T05:00:00.000Z',
  });

  assert.equal(snapshot.format, 'inkloom.vault-snapshot');
  assert.equal(snapshot.noteCount, 3);
  assert.equal(snapshot.manifestSha256.length, 64);

  const currentNotes = [
    { id: 'n1', relativePath: '00-导览.md', title: '导览', source: '# 导览\n\n第一版正文\n新增第二段内容\n' },
    { id: 'n2', relativePath: '01-双链.md', title: '双链', source: '# 双链\n\n保持不变\n' },
    { id: 'n4', relativePath: '03-新卡片.md', title: '新卡片', source: '# 新卡片\n' },
  ];

  const diff = diffVaultSnapshot(currentNotes, snapshot);
  assert.equal(diff.valid, true);
  assert.equal(diff.summary.unchangedCount, 1);
  assert.equal(diff.summary.modifiedCount, 1);
  assert.equal(diff.summary.missingCount, 1);
  assert.equal(diff.summary.addedSinceCount, 1);
  assert.equal(diff.summary.restorableCount, 2);

  // Tampering with note source or path traversal is rejected
  const tampered = structuredClone(snapshot);
  tampered.notes[0].source += 'tampered';
  assert.throws(() => verifyVaultSnapshot(tampered), /哈希校验不匹配/);

  const traversal = structuredClone(snapshot);
  traversal.notes[0].relativePath = '../escape.md';
  assert.throws(() => verifyVaultSnapshot(traversal), /越界/);
});
