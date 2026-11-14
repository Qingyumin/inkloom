import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseVaultHealth,
  normalizeNoteHealthAndObsidianSyntax,
} from './vault-doctor.mjs';

test('diagnoseVaultHealth detects missing YAML, unresolved ghost links, duplicate titles and Obsidian syntax, and normalizeNoteHealthAndObsidianSyntax repairs safely', () => {
  const notes = [
    {
      id: 'n1',
      name: 'RawObsidian.md',
      title: 'RawObsidian',
      cleanTitle: 'RawObsidian',
      source: '\uFEFF# RawObsidian\r\n\r\n这是 ==重点高亮== 内容 %%Obsidian私有注释%%，并引用了 [[尚未创建的未来卡片]]。\r\n',
    },
    {
      id: 'n2',
      name: '01-Dup.md',
      title: '重复主题',
      cleanTitle: '重复主题',
      source: '---\ntitle: 重复主题\n---\n# 重复主题\n',
    },
    {
      id: 'n3',
      name: '02-Dup.md',
      title: '重复主题',
      cleanTitle: '重复主题',
      source: '---\ntitle: 重复主题\n---\n# 重复主题 2\n',
    },
  ];

  const report = diagnoseVaultHealth(notes);
  assert.equal(report.totalNotes, 3);
  assert.ok(report.healthScore < 100);
  assert.ok(report.findings.some(f => f.kind === 'missing-frontmatter' && f.noteId === 'n1'));
  assert.ok(report.findings.some(f => f.kind === 'obsidian-syntax' && f.noteId === 'n1'));
  assert.ok(report.findings.some(f => f.kind === 'unresolved-ghost' && f.ghostTarget === '尚未创建的未来卡片'));
  assert.ok(report.findings.some(f => f.kind === 'duplicate-title'));

  const repaired = normalizeNoteHealthAndObsidianSyntax(notes[0], { today: '2026-10-24' });
  assert.equal(repaired.changed, true);
  assert.ok(repaired.source.startsWith('\uFEFF---\r\ntitle: RawObsidian\r\n'));
  assert.ok(repaired.source.includes('**重点高亮**'));
  assert.ok(repaired.source.includes('<!-- Obsidian私有注释 -->'));
});
