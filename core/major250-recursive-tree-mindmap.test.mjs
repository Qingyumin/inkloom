import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVaultTree,
  flattenVaultTree,
  collectDescendantFolderPaths,
  isFolderRecursivelyExpanded,
  applyRecursiveFolderExpansion,
  buildNoteHeadingMindmapTree,
  buildFolderHierarchyMindmapTree,
  renderMindmapTreeSvg,
  collectBlockReferenceBacklinks,
} from './vault-tree.mjs';

const sampleMultiLevelNotes = [
  {
    id: 'n-root',
    name: '00-总览.md',
    relativePath: '00-总览.md',
    title: '00-总览',
    cleanTitle: '总览',
    source: '# 总览\n\n引用段落 [[01.1-五区布局#^blk-layout]] 与 ![[01.2-多页签#^blk-tabs]]。\n',
  },
  {
    id: 'n-1-1',
    name: '01.1-五区布局.md',
    relativePath: 'Inkloom使用方法/01-界面全景/01-A-子模块/01.1-五区布局.md',
    title: '01.1-五区布局',
    cleanTitle: '01.1-五区布局',
    source: '# 01.1 五区布局\n\n## 顶部水泡栏\n\n外置轻薄水泡栏说明 ^blk-layout\n\n## 左侧目录树\n\n关联 [[01.2-多页签]]。\n',
  },
  {
    id: 'n-1-2',
    name: '01.2-多页签.md',
    relativePath: 'Inkloom使用方法/01-界面全景/01-B-子模块/01.2-多页签.md',
    title: '01.2-多页签',
    cleanTitle: '01.2-多页签',
    source: '# 01.2 多页签\n\n边角折叠水泡说明 ^blk-tabs\n',
  },
  {
    id: 'n-2-1',
    name: '02.1-双链语法.md',
    relativePath: 'Inkloom使用方法/02-高效笔记/02.1-双链语法.md',
    title: '02.1-双链语法',
    cleanTitle: '02.1-双链语法',
    source: '# 02.1 双链语法\n',
  },
  {
    id: 'n-other',
    name: '日记.md',
    relativePath: 'journals/2026-11/日记.md',
    title: '日记',
    cleanTitle: '日记',
    source: '# 日记\n',
  },
];

test('MAJOR-250: collectDescendantFolderPaths & applyRecursiveFolderExpansion expand to deepest level and collapse all', () => {
  const tree = buildVaultTree(sampleMultiLevelNotes);
  const desc = collectDescendantFolderPaths(tree, 'Inkloom使用方法');
  assert.equal(desc.targetFolderPath, 'Inkloom使用方法');
  assert.equal(desc.hasSubfolders, true);
  assert.equal(desc.maxRelativeDepth, 2);
  assert.deepEqual(desc.selfAndDescendants, [
    'Inkloom使用方法',
    'Inkloom使用方法/01-界面全景',
    'Inkloom使用方法/02-高效笔记',
    'Inkloom使用方法/01-界面全景/01-A-子模块',
    'Inkloom使用方法/01-界面全景/01-B-子模块',
  ]);

  // Initially collapse deep subfolders while parent is open (partially collapsed)
  const partialCollapsed = [
    'Inkloom使用方法/01-界面全景/01-A-子模块',
    'Inkloom使用方法/02-高效笔记',
    'journals/2026-11',
  ];
  assert.equal(isFolderRecursivelyExpanded(tree, 'Inkloom使用方法', partialCollapsed), false);

  // Toggling partially collapsed folder expands it and ALL its descendants to the deepest bottom level
  const expandedRes = applyRecursiveFolderExpansion(partialCollapsed, tree, 'Inkloom使用方法', 'toggle');
  assert.equal(expandedRes.expanded, true);
  assert.equal(expandedRes.mode, 'expand-all');
  assert.deepEqual(expandedRes.collapsed, ['journals/2026-11']);
  assert.equal(isFolderRecursivelyExpanded(tree, 'Inkloom使用方法', expandedRes.collapsed), true);

  // Verify flattenVaultTree marks allDescendantsExpanded=true and subfolderCount=4
  const flatExpanded = flattenVaultTree(tree, { collapsed: expandedRes.collapsed });
  const guideFolderRow = flatExpanded.rows.find(r => r.type === 'folder' && r.path === 'Inkloom使用方法');
  assert.ok(guideFolderRow);
  assert.equal(guideFolderRow.subfolderCount, 4);
  assert.equal(guideFolderRow.allDescendantsExpanded, true);

  // Toggling again when fully expanded collapses the selected folder and all its descendants
  const collapsedRes = applyRecursiveFolderExpansion(expandedRes.collapsed, tree, 'Inkloom使用方法', 'toggle');
  assert.equal(collapsedRes.expanded, false);
  assert.equal(collapsedRes.mode, 'collapse-all');
  assert.equal(collapsedRes.collapsed.includes('Inkloom使用方法'), true);
  assert.equal(collapsedRes.collapsed.includes('Inkloom使用方法/01-界面全景/01-A-子模块'), true);
  assert.equal(collapsedRes.collapsed.includes('journals/2026-11'), true);
});

test('MAJOR-250: buildNoteHeadingMindmapTree, buildFolderHierarchyMindmapTree, renderMindmapTreeSvg & collectBlockReferenceBacklinks', () => {
  const tree = buildVaultTree(sampleMultiLevelNotes);
  const folderMindmap = buildFolderHierarchyMindmapTree(tree, 'Inkloom使用方法');
  assert.equal(folderMindmap.kind, 'folder');
  assert.ok(folderMindmap.label.includes('Inkloom使用方法'));
  assert.equal(folderMindmap.children.length, 2);

  const noteMindmap = buildNoteHeadingMindmapTree(sampleMultiLevelNotes[1]);
  assert.equal(noteMindmap.kind, 'note-root');
  assert.equal(noteMindmap.children.length, 2);

  const svgRes = renderMindmapTreeSvg(folderMindmap);
  assert.ok(svgRes.svg.includes('<svg'));
  assert.ok(svgRes.svg.includes('data-mindmap-folder="Inkloom使用方法/01-界面全景"'));
  assert.ok(svgRes.nodeCount >= 5);

  const blocks = collectBlockReferenceBacklinks(sampleMultiLevelNotes);
  assert.equal(blocks.definitions.length, 2);
  assert.equal(blocks.references.length, 2);
  assert.equal(blocks.references[0].blockId, 'blk-layout');
  assert.equal(blocks.references[1].isEmbed, true);
});
