import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZeroKnowledgeE2eeSyncEnvelope,
  decryptAndVerifyE2eeSyncEnvelope,
  evaluateCrossPlatformPortability,
} from './local-agent-sync.mjs';

test('MAJOR-220: Zero-knowledge E2EE sync envelope encrypts manifest & blobs, reuses unchanged blobs incrementally, and preserves BOM/CRLF on decrypt', async () => {
  const sampleNotes = [
    {
      relativePath: 'notes/架构设计.md',
      title: '架构设计',
      source: '\uFEFF---\r\ntitle: 架构设计\r\n---\r\n\r\n# 架构设计\r\n\r\n第一版正文内容。\r\n',
    },
    {
      relativePath: 'wiki/概念百科.md',
      title: '概念百科',
      source: '---\ntitle: 概念百科\n---\n\n# 概念百科\n\n关联 [[架构设计]]。\n',
    },
  ];

  const env1 = await buildZeroKnowledgeE2eeSyncEnvelope(sampleNotes, 'correct-horse-battery', {
    now: '2026-11-07T06:00:00Z',
  });
  assert.equal(env1.format, 'inkloom.e2ee-sync-repo');
  assert.equal(env1.stats.totalNotes, 2);
  assert.equal(env1.stats.newlyEncryptedCount, 2);
  assert.equal(env1.stats.reusedBlobCount, 0);

  // Verify zero-knowledge property: serialized JSON of envelope does not leak plaintext titles or body
  const serialized = JSON.stringify(env1);
  assert.ok(!serialized.includes('架构设计'));
  assert.ok(!serialized.includes('第一版正文内容'));

  // Incremental push: modify 1 note, keep 1 note unchanged -> 1 reused blob, 1 newly encrypted blob
  const updatedNotes = [
    sampleNotes[0],
    {
      ...sampleNotes[1],
      source: sampleNotes[1].source + '\n新增第二段内容。\n',
    },
  ];
  const env2 = await buildZeroKnowledgeE2eeSyncEnvelope(updatedNotes, 'correct-horse-battery', {
    previousEnvelope: env1,
    now: '2026-11-07T06:05:00Z',
  });
  assert.equal(env2.stats.totalNotes, 2);
  assert.equal(env2.stats.reusedBlobCount, 1);
  assert.equal(env2.stats.newlyEncryptedCount, 1);

  // Decrypt and verify exact round-trip including BOM and CRLF
  const decrypted = await decryptAndVerifyE2eeSyncEnvelope(env2, 'correct-horse-battery');
  assert.equal(decrypted.verified, true);
  assert.equal(decrypted.noteCount, 2);
  assert.equal(decrypted.notes[0].source, updatedNotes[0].source);
  assert.ok(decrypted.notes[0].source.startsWith('\uFEFF'));
  assert.ok(decrypted.notes[0].source.includes('\r\n'));
  assert.equal(decrypted.notes[1].source, updatedNotes[1].source);

  // Wrong passphrase fails closed
  await assert.rejects(
    () => decryptAndVerifyE2eeSyncEnvelope(env2, 'wrong-passphrase'),
    /口令校验失败/,
  );

  // Tampered ciphertext blob fails closed
  const tampered = JSON.parse(JSON.stringify(env2));
  const firstBlobId = Object.keys(tampered.blobs)[0];
  tampered.blobs[firstBlobId].ct = tampered.blobs[firstBlobId].ct.slice(0, -4) + 'AAAA';
  await assert.rejects(
    () => decryptAndVerifyE2eeSyncEnvelope(tampered, 'correct-horse-battery'),
    /完整性校验失败|解密失败/,
  );
});

test('MAJOR-220: Cross-platform portability audit detects case collisions, reserved names, and drive paths', () => {
  const cleanReport = evaluateCrossPlatformPortability([
    { relativePath: 'notes/双链笔记.md', source: '# 双链笔记\n\n关联 [[wiki/概念]]' },
    { relativePath: 'wiki/概念.md', source: '# 概念' },
  ]);
  assert.equal(cleanReport.passed, true);
  assert.equal(cleanReport.portabilityScore, 100);
  assert.equal(cleanReport.platformMatrix.length, 3);

  const issueReport = evaluateCrossPlatformPortability([
    { relativePath: 'Notes/Topic.md', source: '# Topic' },
    { relativePath: 'notes/topic.md', source: 'See [local](C:\\Users\\demo\\file.pdf)' },
    { relativePath: 'notes/CON.md', source: '# Reserved' },
  ]);
  assert.equal(issueReport.passed, false);
  assert.ok(issueReport.issues.some(i => i.kind === 'case-collision'));
  assert.ok(issueReport.issues.some(i => i.kind === 'invalid-segment'));
  assert.ok(issueReport.issues.some(i => i.kind === 'hardcoded-drive-path'));
});
