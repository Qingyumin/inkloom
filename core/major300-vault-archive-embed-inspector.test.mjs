import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSha256HexSync,
  compileVaultPortableArchiveBytes,
  inspectAndVerifyVaultPortableArchive,
} from './vault-snapshot.mjs';
import {
  extractNoteHeadings,
  inspectVaultEmbedReferences,
  repairBrokenNoteEmbedInSource,
  batchRepairNoteEmbedsInSource,
} from './note-embeds.mjs';
import { buildStoredZipBytes, unpackZipEntriesSync } from './raw-document-ingestor.mjs';

test('MAJOR-300: computeSha256HexSync matches NIST FIPS 180-4 vectors and compileVaultPortableArchiveBytes + inspectAndVerifyVaultPortableArchive verify & detect tampering', async () => {
  assert.equal(
    computeSha256HexSync(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    computeSha256HexSync('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );

  const originalNotes = [
    {
      id: 'n1',
      name: '01-核心原理.md',
      relativePath: '理论底座/01-核心原理.md',
      source: '\uFEFF---\r\ntitle: 核心原理\r\n---\r\n\r\n# 核心原理\r\n\r\n保留 BOM 与 CRLF 行尾。\r\n',
    },
    {
      id: 'n2',
      name: '02-方法实践.md',
      relativePath: '实践手册/子卷/02-方法实践.md',
      source: '---\ntitle: 方法实践\n---\n\n# 方法实践\n\n多级目录无损打包与验签。\n',
    },
  ];

  const archive = compileVaultPortableArchiveBytes(originalNotes, {
    vaultName: '墨图三点零知识库',
    folders: ['理论底座', '实践手册/子卷', '空目录保留'],
    rawDocuments: [
      {
        name: 'sample.txt',
        relativePath: 'raw/sample.txt',
        bytes: new TextEncoder().encode('Read-only raw attachment payload'),
      },
    ],
    createdAt: '2026-11-14T08:00:00.000Z',
    appVersion: '3.0.0',
  });

  assert.equal(archive.noteCount, 2);
  assert.equal(archive.rawCount, 1);
  assert.equal(archive.folderCount, 3);
  assert.equal(archive.manifestSha256.length, 64);
  assert.ok(archive.fileName.endsWith('.inkloom-vault.zip'));

  // Compare against a mutated vault (n1 modified, n2 deleted, n3 newly added)
  const mutatedVault = [
    {
      id: 'n1',
      name: '01-核心原理.md',
      relativePath: '理论底座/01-核心原理.md',
      source: '\uFEFF---\r\ntitle: 核心原理\r\n---\r\n\r\n# 核心原理\r\n\r\n本地已修改内容。\r\n',
    },
    {
      id: 'n3',
      name: '03-新增手记.md',
      relativePath: 'journals/03-新增手记.md',
      source: '---\ntitle: 新增手记\n---\n\n# 新增手记\n',
    },
  ];

  const verified = await inspectAndVerifyVaultPortableArchive(archive.bytes, mutatedVault);
  assert.equal(verified.valid, true);
  assert.equal(verified.verifiedNoteCount, 2);
  assert.equal(verified.verifiedRawCount, 1);
  assert.equal(verified.unchangedCount, 0);
  assert.equal(verified.modifiedCount, 1);
  assert.equal(verified.missingInVaultCount, 1);
  assert.equal(verified.addedInVaultCount, 1);
  assert.equal(verified.restorableCount, 2);
  const restoredN1 = verified.restorableNotes.find(n => n.relativePath === '理论底座/01-核心原理.md');
  assert.ok(restoredN1.source.startsWith('\uFEFF'));
  assert.ok(restoredN1.source.includes('\r\n'));

  // Tamper one byte in notes/实践手册/子卷/02-方法实践.md and ensure verification rejects it
  const unpacked = unpackZipEntriesSync(archive.bytes);
  const tamperedMap = {};
  for (const [entryName, slice] of unpacked.entries()) {
    tamperedMap[entryName] = new Uint8Array(slice);
  }
  tamperedMap['notes/实践手册/子卷/02-方法实践.md'][0] ^= 0xff;
  const tamperedZip = buildStoredZipBytes(tamperedMap);
  const tamperedCheck = await inspectAndVerifyVaultPortableArchive(tamperedZip, mutatedVault);
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.restorableNotes.length, 0);
  assert.ok(tamperedCheck.tamperedEntries.length >= 1);
});

test('MAJOR-300: inspectVaultEmbedReferences, repairBrokenNoteEmbedInSource & batchRepairNoteEmbedsInSource detect renamed headings/blocks and repair losslessly', () => {
  const sourceNote = {
    id: 'src-note',
    name: '01-知识图谱底座.md',
    relativePath: 'notes/01-知识图谱底座.md',
    source: [
      '---',
      'title: 知识图谱底座',
      '---',
      '',
      '# 知识图谱底座',
      '',
      '## 一、 双向链接与增量索引架构',
      '',
      '增量索引仅重算发生变动的节点及其一跳邻居。 ^core-index-v2',
      '',
      '## 二、 局部星图渲染细节',
      '',
      '局部星图默认聚焦一跳至两跳关系。',
    ].join('\n'),
  };

  const hostNote = {
    id: 'host-note',
    name: '02-系统综述.md',
    relativePath: 'notes/02-系统综述.md',
    source: [
      '\uFEFF---',
      'title: 系统综述',
      '---',
      '',
      '# 系统综述',
      '',
      '健康引用预览：',
      '![[知识图谱底座#二、 局部星图渲染细节]]',
      '',
      '章节已改名的旧引用：',
      '![[知识图谱底座#双向链接架构|核心架构摘录]]',
      '',
      '块锚点已升级的旧引用：',
      '![[知识图谱底座#^core-index]]',
      '',
      'Obsidian 无井号块引用简写：',
      '![[知识图谱底座^core-index-v2]]',
      '',
    ].join('\r\n'),
  };

  const headings = extractNoteHeadings(sourceNote.source);
  assert.equal(headings.length, 3);
  assert.equal(headings[1].text, '一、 双向链接与增量索引架构');

  const inspection = inspectVaultEmbedReferences([sourceNote, hostNote], { focusNoteId: 'host-note' });
  assert.equal(inspection.totalEmbeds, 4);
  assert.equal(inspection.healthyCount, 1);
  assert.equal(inspection.brokenCount, 3);
  assert.equal(inspection.repairableCount, 3);
  assert.ok(inspection.items[0].previewExcerpt.includes('局部星图默认聚焦'));
  assert.equal(inspection.items[1].suggestedFragment, '一、 双向链接与增量索引架构');
  assert.equal(inspection.items[2].suggestedFragment, '^core-index-v2');
  assert.equal(inspection.items[3].suggestedTarget, '知识图谱底座');
  assert.equal(inspection.items[3].suggestedFragment, '^core-index-v2');

  // Single repair preserves alias, BOM, and CRLF
  const singleRepaired = repairBrokenNoteEmbedInSource(hostNote.source, inspection.items[1]);
  assert.equal(singleRepaired.changed, true);
  assert.equal(singleRepaired.replacement, '![[知识图谱底座#一、 双向链接与增量索引架构|核心架构摘录]]');

  // Batch repair repairs all 3 broken embeds in one pass and turns healthyCount -> 4
  const batchRepaired = batchRepairNoteEmbedsInSource(hostNote.source, inspection.items);
  assert.equal(batchRepaired.changed, true);
  assert.equal(batchRepaired.repairedCount, 3);
  assert.ok(batchRepaired.source.startsWith('\uFEFF'));
  assert.ok(batchRepaired.source.includes('\r\n'));

  const recheck = inspectVaultEmbedReferences(
    [sourceNote, { ...hostNote, source: batchRepaired.source }],
    { focusNoteId: 'host-note' },
  );
  assert.equal(recheck.totalEmbeds, 4);
  assert.equal(recheck.healthyCount, 4);
  assert.equal(recheck.brokenCount, 0);
});
