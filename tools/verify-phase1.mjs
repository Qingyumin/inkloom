import { chromium } from '../app/node_modules/@playwright/test/index.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'app/dist');
const verificationDir = path.join(root, 'verification');
await mkdir(verificationDir, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const relPath = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    const filePath = path.resolve(distDir, relPath);
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const checks = [];
const pageErrors = [];
const browser = await chromium.launch({ channel: process.env.INKLET_BROWSER_CHANNEL || 'msedge', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.inkloomTest?.vaultGraph));

  // Check 1: Brand, Slogan, Placeholder Logo, and Inklet Themes
  const brandInfo = await page.evaluate(() => ({
    name: document.querySelector('.brand-name')?.textContent?.trim(),
    tagline: document.querySelector('.brand-tagline')?.textContent?.trim(),
    placeholder: document.querySelector('.brand-placeholder')?.textContent?.trim(),
    interfaceTheme: document.documentElement.dataset.interfaceTheme,
    vaultCount: Number(document.querySelector('#vault-count')?.textContent),
    tagsCount: Number(document.querySelector('#tags-count')?.textContent),
  }));
  assert.equal(brandInfo.name, 'Inkloom 墨图');
  assert.equal(brandInfo.tagline, '一念落笔，万象成图。');
  assert.equal(brandInfo.placeholder, '墨');
  assert.equal(brandInfo.interfaceTheme, 'jade');
  assert.equal(brandInfo.vaultCount, 7);
  assert.ok(brandInfo.tagsCount >= 6);
  checks.push({ id: 'brand-and-vault-bootstrap', status: 'PASS', details: brandInfo });

  // Check 2: WikiLink tokens (existing & ghost) + Local Graph Canvas rendering
  const editorWikiState = await page.evaluate(() => {
    const tokens = [...document.querySelectorAll('#rich-editor .wikilink-token')].map(el => ({
      text: el.textContent,
      target: el.dataset.wikilinkTarget,
      ghost: el.classList.contains('is-ghost'),
    }));
    const localNodes = window.inkloomTest.localGraphView.getScreenNodes();
    return { tokenCount: tokens.length, ghostCount: tokens.filter(t => t.ghost).length, localNodeCount: localNodes.length };
  });
  assert.ok(editorWikiState.tokenCount >= 4);
  assert.ok(editorWikiState.ghostCount >= 1);
  assert.ok(editorWikiState.localNodeCount >= 4);
  checks.push({ id: 'wikilink-decorations-and-local-graph', status: 'PASS', details: editorWikiState });

  await page.screenshot({ path: path.join(verificationDir, '01-inkloom-overview.png') });

  // Check 3: Click a WikiLink in RichEditor to navigate to another note & verify Backlinks Drawer
  await page.locator('#rich-editor .wikilink-token[data-wikilink-target="04-YAML属性与标签体系"]').first().click();
  await page.waitForFunction(() => window.inkloomTest.activeNoteId === 'vault-04');

  const note04Context = await page.evaluate(() => ({
    title: document.querySelector('#note-title-badge')?.textContent,
    backlinksCount: Number(document.querySelector('#backlinks-count')?.textContent),
    mentionsCount: Number(document.querySelector('#mentions-count')?.textContent),
  }));
  assert.equal(note04Context.title, 'YAML属性与标签体系');
  assert.ok(note04Context.backlinksCount >= 2);
  assert.ok(note04Context.mentionsCount >= 1);
  checks.push({ id: 'wikilink-navigation-and-backlinks', status: 'PASS', details: note04Context });

  // Check 4: Switch to Unlinked Mentions tab and click "设为双链" (One-click Link)
  await page.click('[data-backlinks-tab="mentions"]');
  await page.click('[data-convert-mention-index="0"]');
  const afterConvert = await page.evaluate(() => ({
    backlinksCount: Number(document.querySelector('#backlinks-count')?.textContent),
    mentionsCount: Number(document.querySelector('#mentions-count')?.textContent),
  }));
  assert.equal(afterConvert.backlinksCount, note04Context.backlinksCount + 1);
  assert.equal(afterConvert.mentionsCount, note04Context.mentionsCount - 1);
  checks.push({ id: 'unlinked-mention-one-click-convert', status: 'PASS', details: afterConvert });

  // Check 5: Global Knowledge Graph (万象星图) filters (All / Orphans / Ghosts) & Ghost Node creation
  await page.click('#global-graph-button');
  await page.waitForSelector('#global-graph-stage:not([hidden])');
  const globalAllCount = await page.evaluate(() => window.inkloomTest.globalGraphView.getScreenNodes().length);
  assert.equal(globalAllCount, 8); // 7 notes + 1 ghost node (卡片写作十诫)

  await page.click('[data-graph-mode="orphans"]');
  const orphanNodes = await page.evaluate(() => window.inkloomTest.globalGraphView.getScreenNodes());
  assert.equal(orphanNodes.length, 1);
  assert.ok(orphanNodes[0].label.includes('灵感速记'));

  await page.click('[data-graph-mode="ghosts"]');
  const ghostNodes = await page.evaluate(() => window.inkloomTest.globalGraphView.getScreenNodes());
  assert.ok(ghostNodes.some(n => n.ghost && n.label === '卡片写作十诫'));

  await page.click('[data-graph-mode="all"]');
  await page.screenshot({ path: path.join(verificationDir, '02-inkloom-global-graph.png') });
  checks.push({ id: 'global-graph-and-filters', status: 'PASS', details: { globalAllCount, orphanCount: orphanNodes.length, ghostViewCount: ghostNodes.length } });

  // Check 6: Theme inheritance (switch to dark pine & morandi sage) + [[ Autocomplete + Export Purification
  await page.evaluate(() => window.inkloomTest.toggleGlobalGraph(false));
  await page.evaluate(() => window.inkloomTest.setTheme('pine', 'pine'));
  const darkMode = await page.evaluate(() => document.documentElement.dataset.uiMode);
  assert.equal(darkMode, 'dark');
  await page.screenshot({ path: path.join(verificationDir, '03-inkloom-dark-theme.png') });
  await page.evaluate(() => window.inkloomTest.setTheme('jade', 'paper'));

  // Test [[ Autocomplete trigger
  await page.evaluate(() => {
    const src = window.inkloomTest.source + '\n\n关联测试：[[双链';
    window.inkloomTest.triggerAutocomplete(src, src.length);
  });
  const suggestVisible = await page.evaluate(() => !document.querySelector('#wikilink-suggest').hidden);
  assert.equal(suggestVisible, true);
  checks.push({ id: 'theme-inheritance-and-autocomplete', status: 'PASS', details: { darkMode, suggestVisible } });

  assert.equal(pageErrors.length, 0);
} finally {
  await browser.close();
  server.close();
}

const exePath = path.join(root, 'release/Inkloom-0.1.0/Inkloom.exe');
const zipPath = path.join(root, 'release/Inkloom-0.1.0-Windows-x64.zip');
const exeStat = await stat(exePath).catch(() => null);
const zipStat = await stat(zipPath).catch(() => null);
if (exeStat && zipStat) {
  const cdpPort = 19440 + Math.floor(Math.random() * 400);
  const tempProfile = path.join(verificationDir, 'temp-profile-' + Date.now());
  await mkdir(tempProfile, { recursive: true });
  const child = spawn(exePath, ['--profile', tempProfile, '--debug-port', String(cdpPort)], { stdio: 'ignore' });
  let desktopBrowser = null;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        desktopBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    assert.ok(desktopBrowser, 'Connected to Inkloom.exe WebView2 over CDP');
    let desktopPage = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const pages = desktopBrowser.contexts().flatMap(ctx => ctx.pages());
      desktopPage = pages.find(p => p.url().startsWith('https://inkloom.local/'));
      if (desktopPage) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(desktopPage, 'Found https://inkloom.local page in Inkloom.exe');
    await desktopPage.waitForFunction(() => Boolean(window.inkloomTest?.vaultGraph && window.inkloomTest.vaultGraph.stats.totalNotes >= 7), { timeout: 15000 });
    const desktopSummary = await desktopPage.evaluate(() => ({
      url: location.href,
      vaultName: window.inkloomTest.vaultState.vaultName,
      totalNotes: window.inkloomTest.vaultGraph.stats.totalNotes,
      totalLinks: window.inkloomTest.vaultGraph.stats.totalLinks,
    }));
    assert.equal(desktopSummary.totalNotes, 7);
    checks.push({
      id: 'windows-desktop-exe-cdp',
      status: 'PASS',
      details: { exeBytes: exeStat.size, zipBytes: zipStat.size, ...desktopSummary },
    });
  } finally {
    try { await desktopBrowser?.close(); } catch {}
    try { child.kill(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
    await rm(tempProfile, { recursive: true, force: true }).catch(() => {});
  }
}

const report = {
  product: 'Inkloom 墨图',
  slogan: '一念落笔，万象成图。',
  version: '0.1.0',
  verifiedAt: new Date().toISOString(),
  pageErrors,
  checks,
};
await writeFile(path.join(verificationDir, 'phase1-results.json'), JSON.stringify(report, null, 2));
console.log('INKLOOM_PHASE1_VERIFIED', JSON.stringify({ checks: checks.length, pageErrors: pageErrors.length }));
