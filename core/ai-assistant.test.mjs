import test from 'node:test';
import assert from 'node:assert/strict';
import { searchVaultContext } from './ai-retrieval.mjs';
import { defaultModelProfiles, validateAiProviderConfig, maskCredentialKey, answerWithGroundedContext, crystallizeAnswerToNote, buildRevisionProposal, verifyAndApplyRevision, checkManuscriptConsistency } from './ai-assistant.mjs';
import { generateSkillCandidate, evaluateSkillNote, exportSanitizedSkill } from './ai-skills.mjs';

const sampleNotes = [
  {
    id: 'note-lin',
    title: '第一章：雾港初见',
    name: 'Ch1.md',
    relativePath: 'chapters/Ch1.md',
    folder: 'chapters',
    version: 'a'.repeat(64),
    metadata: { category: 'chapter', manuscript: 'ms-novel', chapter_order: 1 },
    properties: [{ key: 'manuscript', value: 'ms-novel' }, { key: 'chapter_order', value: '1' }],
    source: '---\ntitle: 第一章：雾港初见\ncategory: chapter\nmanuscript: ms-novel\nchapter_order: 1\n---\n# 第一章\n\n2026-05-10 清晨，巡检官林深抵达雾港码头。 ^arrival\n\n【林深·年龄】：28岁\n\n他决定先调查 [[旧灯塔密档]] 与 [[第二章：暗流]]。\n',
  },
  {
    id: 'note-ch2',
    title: '第二章：暗流',
    name: 'Ch2.md',
    relativePath: 'chapters/Ch2.md',
    folder: 'chapters',
    version: 'b'.repeat(64),
    metadata: { category: 'chapter', manuscript: 'ms-novel', chapter_order: 2 },
    properties: [{ key: 'manuscript', value: 'ms-novel' }, { key: 'chapter_order', value: '2' }],
    source: '---\ntitle: 第二章：暗流\ncategory: chapter\nmanuscript: ms-novel\nchapter_order: 2\n---\n# 第二章\n\n2026-05-02 夜晚，林深在档案室翻阅记录。\n\n【林深·年龄】：34岁\n',
  },
  {
    id: 'note-private',
    title: '其它项目私密记录',
    name: 'Private.md',
    relativePath: 'private/Private.md',
    folder: 'private',
    version: 'c'.repeat(64),
    metadata: { category: 'memo', project: 'proj-secret' },
    properties: [{ key: 'project', value: 'proj-secret' }],
    source: '# 私密\n\n包含未授权项目的敏感预算 980000 元。\n',
  },
];

test('scope filter and hybrid retrieval locate exact Chinese terms, block anchors and reject out-of-scope notes', () => {
  const scoped = searchVaultContext(sampleNotes, {
    query: '林深 雾港码头',
    scope: { kind: 'manuscript', manuscriptId: 'ms-novel' },
    mode: 'hybrid',
  });
  assert.ok(scoped.chunks.length >= 1);
  assert.equal(scoped.chunks[0].noteId, 'note-lin');
  assert.equal(scoped.chunks[0].citation, '[[chapters/Ch1#^arrival]]');
  assert.ok(scoped.chunks.every(chunk => chunk.noteId !== 'note-private'));

  const unauthorizedSearch = searchVaultContext(sampleNotes, {
    query: '980000',
    scope: { kind: 'manuscript', manuscriptId: 'ms-novel' },
    mode: 'hybrid',
  });
  assert.equal(unauthorizedSearch.chunks.length, 0);
  const groundedRefusal = answerWithGroundedContext({ question: '敏感预算多少？', retrieval: unauthorizedSearch });
  assert.equal(groundedRefusal.status, 'insufficient-evidence');
  assert.equal(groundedRefusal.citations.length, 0);

  const groundedAnswer = answerWithGroundedContext({ question: '林深何时抵达雾港码头？', retrieval: scoped });
  assert.equal(groundedAnswer.status, 'grounded');
  assert.ok(groundedAnswer.answer.includes('[[chapters/Ch1#^arrival]]'));
  assert.equal(groundedAnswer.modelSynthesisBlocks.length, 3);
  const crystallized = crystallizeAnswerToNote({
    question: '林深何时抵达雾港码头？',
    customTitle: '智识沉淀：雾港时间线考证',
    response: groundedAnswer,
    today: '2026-10-21',
  });
  assert.equal(crystallized.title, '智识沉淀：雾港时间线考证');
  assert.ok(crystallized.markdown.includes('## 模型深度综合解答'));
  assert.ok(crystallized.markdown.includes('## 关联源笔记 (双链锚点)'));
  assert.ok(crystallized.sourcePaths.includes('chapters/Ch1.md'));
});

test('provider validation, key masking and diff revision enforce version and revision gates', () => {
  const presets = defaultModelProfiles();
  assert.ok(presets.some(p => p.id === 'copilot-gemini-4' && p.model === 'gemini-4'));
  assert.ok(presets.some(p => p.id === 'local-ollama-smollm2' && p.provider === 'local-gguf'));
  const config = validateAiProviderConfig({ provider: 'openai-compatible', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'gemini-4' });
  assert.equal(config.provider, 'openai-compatible');
  assert.equal(config.model, 'gemini-4');
  assert.throws(() => validateAiProviderConfig({ provider: 'openai-compatible', endpoint: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => validateAiProviderConfig({ provider: 'openai-compatible', endpoint: 'https://user:pass@example.com/v1' }), /凭据/);
  assert.equal(maskCredentialKey('sk-1234567890abcdef').maskedKey, 'sk-••••def');

  const proposal = buildRevisionProposal({
    noteId: 'note-lin',
    title: '第一章：雾港初见',
    source: sampleNotes[0].source,
    version: sampleNotes[0].version,
    revision: 4,
    mode: 'summary-callout',
  });
  assert.equal(proposal.changed, true);
  assert.ok(proposal.proposedSource.includes('> [!NOTE] 要点提炼'));
  assert.ok(proposal.diff.some(item => item.type === 'add'));
  assert.equal(verifyAndApplyRevision(proposal, { id: 'note-lin', revision: 4, version: sampleNotes[0].version }), proposal.proposedSource);
  assert.throws(() => verifyAndApplyRevision(proposal, { id: 'note-lin', revision: 5, version: sampleNotes[0].version }), /发生变化/);
});

test('manuscript consistency check detects character setting conflicts, timeline regressions and unresolved links', () => {
  const report = checkManuscriptConsistency(sampleNotes, {
    scope: { kind: 'manuscript', manuscriptId: 'ms-novel' },
  });
  assert.equal(report.totalChecked, 2);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some(f => f.kind === 'character-setting-conflict' && f.title.includes('林深')));
  assert.ok(report.findings.some(f => f.kind === 'timeline-regression'));
  assert.ok(report.findings.some(f => f.kind === 'unresolved-thread' && f.title.includes('旧灯塔密档')));
});

test('skills candidate generation, evaluation, staleness check and sanitized export preserve provenance without secrets', () => {
  const candidate = generateSkillCandidate({
    name: '长稿设定核查法',
    sourceNotes: [sampleNotes[0]],
    steps: ['提取角色设定卡片', '按章节顺序核对时间线', '汇总未建节点线索'],
  });
  assert.ok(candidate.markdown.includes('category: skill'));
  assert.ok(candidate.markdown.includes('[[chapters/Ch1]]'));

  const freshEval = evaluateSkillNote({ title: candidate.title, source: candidate.markdown }, new Map([['note-lin', 'a'.repeat(64)]]));
  assert.equal(freshEval.passed, true);
  assert.equal(freshEval.needsReview, false);

  const staleEval = evaluateSkillNote({ title: candidate.title, source: candidate.markdown }, new Map([['note-lin', 'f'.repeat(64)]]));
  assert.equal(staleEval.needsReview, true);

  const dirtySkill = candidate.markdown + '\n本地路径：D:\\Secret\\Vault\\note.md 与密钥 sk-abcdef1234567890\n';
  const exported = exportSanitizedSkill(dirtySkill);
  assert.ok(!exported.includes('source_notes:'));
  assert.ok(!exported.includes('D:\\Secret'));
  assert.ok(!exported.includes('sk-abcdef1234567890'));
  assert.ok(exported.includes('[[chapters/Ch1]]'));
});
