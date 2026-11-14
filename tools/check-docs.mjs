import { createRequire } from 'node:module';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MarkdownIt = createRequire(path.join(root, 'app/package.json'))('markdown-it');
const parser = new MarkdownIt(); let links = 0;
const documents = ['README.md', 'ROADMAP.md', 'CREATION-NOTES.md', 'docs/SDK.md', 'docs/0.3-VERIFICATION.md', 'docs/0.4-APPEARANCE.md', 'docs/0.5-WORKSPACE.md', 'docs/0.5.1-TASK-PLANNING.md', 'docs/0.5.2-CREATION-RESEARCH.md', 'docs/0.5.3-WORKSPACE-CLOSURE.md', 'docs/0.6-AI-SKILLS.md', 'docs/USER-MANUAL.md', 'docs/UX-UI-SPECIFICATION.md', 'docs/ORIGINAL-ALGORITHMS.md'];
for (const document of [...documents, ...(existsSync(path.join(root, 'QUICKSTART.md')) ? ['QUICKSTART.md'] : [])]) {
  const tokens = parser.parse(await readFile(path.join(root, document), 'utf8'), {});
  async function inspect(tokens) {
    for (const token of tokens) {
      if (token.type === 'link_open' || token.type === 'image') {
        const href = token.attrGet(token.type === 'image' ? 'src' : 'href');
        if (href && !/^(https?:|mailto:|#)/.test(href)) { await access(path.resolve(root, path.dirname(document), decodeURIComponent(href.split('#')[0]))); links++; }
      }
      if (token.children) await inspect(token.children);
    }
  }
  await inspect(tokens);
}
const roadmap = await readFile(path.join(root, 'ROADMAP.md'), 'utf8');
const rows = [...roadmap.matchAll(/^\| ((?:BASE|CORE|SDK|UX|THEME|GRAPH|WORK|AI|SKILL|ECO|QA|RELEASE)-\d{3}) \|/gm)].map(match => match[1]);
assert.equal(rows.length, 59); assert.equal(new Set(rows).size, 59);
const metadata = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'));
const externalSkillPath = path.resolve(root, '../../.github/skills/inkloom-ux-ui-design/SKILL.md');
const uxSources = [await readFile(path.join(root, 'docs/UX-UI-SPECIFICATION.md'), 'utf8')];
if (existsSync(externalSkillPath)) {
  const skill = await readFile(externalSkillPath, 'utf8');
  const header = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(header, 'UX skill requires YAML frontmatter');
  const definition = createRequire(path.join(root, 'app/package.json'))('yaml').parse(header[1]);
  assert.equal(definition.name, 'inkloom-ux-ui-design'); assert.ok(definition.description);
  uxSources.unshift(skill);
}
for (const source of uxSources) assert.equal([...source.matchAll(/^# /gm)].length, 1, 'UX rules must contain one authoritative document, not appended legacy rules');
const lock = JSON.parse(await readFile(path.join(root, 'app/package-lock.json'), 'utf8'));
assert.equal(metadata.version, lock.version); assert.equal(metadata.version, lock.packages[''].version);
const uiReviewPath = path.join(root, 'verification/ui-review-results.json');
if (existsSync(uiReviewPath)) {
  const visual = JSON.parse(await readFile(uiReviewPath, 'utf8'));
  assert.equal(visual.version, metadata.version); assert.equal(new Set(visual.reviewedPanels.map(panel => panel.panel)).size, 15);
  for (const panel of visual.reviewedPanels) await access(path.resolve(root, path.dirname(visual.uxDesktopReport), panel.image));
}
await mkdir(path.join(root, 'verification'), { recursive: true });
const result = { passed: true, version: metadata.version, documents: documents.length, localLinks: links, uniqueRoadmapIds: rows.length };
await writeFile(path.join(root, 'verification/docs-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log('INKLOOM_DOCS_PASS', JSON.stringify(result));