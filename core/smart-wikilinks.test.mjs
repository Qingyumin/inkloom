import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSmartWikiLinkSettings, discoverSmartWikiLinks, applySmartWikiLinks } from './smart-wikilinks.mjs';

const sampleVault = [
  {
    id: 'n-graph',
    title: '02-知识图谱与局部星图',
    cleanTitle: '知识图谱与局部星图',
    stem: '02-知识图谱与局部星图',
    aliases: ['万象星图'],
    source: '---\ntitle: 知识图谱与局部星图\n---\n# 知识图谱\n\n通过有向图中心性公式与力导向引擎展示局部星图与全库节点关系。\n',
  },
  {
    id: 'n-yaml',
    title: '04-YAML属性与标签体系',
    cleanTitle: 'YAML属性与标签体系',
    stem: '04-YAML属性与标签体系',
    aliases: ['属性视图'],
    source: '---\ntitle: YAML属性与标签体系\n---\n# YAML属性\n\n使用多维表格和状态看板管理笔记元数据。\n',
  },
];

test('smart wikilink discovery finds exact titles, aliases and cosine-similarity concept terms without touching code or YAML', () => {
  const active = {
    id: 'n-active',
    title: '测试草稿',
    source: '\uFEFF---\r\ntitle: 知识图谱与局部星图\r\n---\r\n# 标题中的知识图谱与局部星图不加链\r\n\r\n在正文中讨论万象星图的力导向布局，以及 `YAML属性与标签体系` 代码字面量，还有多维表格与标签体系的设计。\r\n',
  };
  const suggestions = discoverSmartWikiLinks(sampleVault, active, { engine: 'offline-cosine', minScore: 0.35 });
  assert.ok(suggestions.length >= 2);
  assert.equal(suggestions[0].matchedTerm, '万象星图');
  assert.equal(suggestions[0].replacement, '[[知识图谱与局部星图|万象星图]]');
  assert.ok(suggestions.some(s => s.targetId === 'n-yaml' && s.matchedTerm === '标签体系'));

  const applied = applySmartWikiLinks(active.source, suggestions, { minScore: 0.35 });
  assert.equal(applied.appliedCount, 2);
  assert.ok(applied.source.startsWith('\uFEFF---\r\ntitle: 知识图谱与局部星图\r\n---'));
  assert.ok(applied.source.includes('# 标题中的知识图谱与局部星图不加链'));
  assert.ok(applied.source.includes('`YAML属性与标签体系`'));
  assert.ok(applied.source.includes('[[知识图谱与局部星图|万象星图]]'));
  assert.ok(applied.source.includes('[[YAML属性与标签体系|标签体系]]'));
});

test('smart wikilink settings validate modes, engines and LLM confirmation boosts', () => {
  const cfg = validateSmartWikiLinkSettings({ mode: 'auto', engine: 'local-llm', minScore: 0.5, autoOnSave: true });
  assert.equal(cfg.mode, 'auto');
  assert.equal(cfg.engine, 'local-llm');
  assert.equal(cfg.autoOnSave, true);

  const active = {
    id: 'n-active-2',
    title: '草稿2',
    source: '# 草稿\n\n这里提到了万象星图。\n',
  };
  const confirmed = discoverSmartWikiLinks(sampleVault, active, {
    engine: 'local-llm',
    llmConfirmedTargets: new Set(['n-graph']),
  });
  assert.equal(confirmed[0].engine, '本地小模型确认');
});
