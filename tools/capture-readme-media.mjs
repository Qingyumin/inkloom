import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'app', 'dist');
const imagesDir = path.join(root, 'docs', 'images');
const tempFramesDir = path.join(root, 'verification', 'readme-gif-frames');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

await mkdir(imagesDir, { recursive: true });
await rm(tempFramesDir, { recursive: true, force: true });
await mkdir(tempFramesDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    const target = path.resolve(distRoot, rel);
    if (!target.startsWith(distRoot)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/`;

const { chromium } = await import('../app/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ channel: process.env.INKLOOM_BROWSER_CHANNEL || 'msedge', headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#database-button', { timeout: 30000 });
  await page.waitForSelector('#activity-rail', { timeout: 15000 });

  // Expand starter guide folder slightly and enable dual source + rich view for hero
  const guideFolder = page.locator('#vault-tree-list [data-vault-folder="Inkloom使用方法"]');
  if (await guideFolder.count() > 0) {
    await guideFolder.first().click();
  }
  if (!await page.locator('#source-editor').isVisible()) {
    await page.locator('.view-tools [data-action="source"]').click();
  }
  await page.waitForTimeout(450);

  // Hero static PNG (crisp 1280x800)
  await page.screenshot({ path: path.join(imagesDir, 'inkloom-3.1-hero.png') });

  // =========================================================================
  // GIF 1: demo-writing-and-menus.gif
  // =========================================================================
  const g1 = path.join(tempFramesDir, 'gif1');
  await mkdir(g1, { recursive: true });
  await page.screenshot({ path: path.join(g1, '01.png') });

  // Open minimalist note tools menu
  await page.locator('#note-tools-menu-trigger').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(g1, '02.png') });

  // Open Interactive SVG Mindmap
  await page.locator('#mindmap-present-button').click();
  await page.locator('#mindmap-stage-viewport svg').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(g1, '03.png') });
  await page.locator('#mindmap-close-btn').click();
  await page.waitForTimeout(150);

  // Open Knowledge Quote Share Card Studio (Scroll Light -> Obsidian Gold)
  await page.locator('#note-tools-menu-trigger').click();
  await page.locator('#note-share-card-button').click();
  await page.locator('#share-card-preview-stage svg').waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(g1, '04.png') });

  await page.locator('#share-card-theme-select').selectOption('obsidian-gold');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(g1, '05.png') });
  await page.locator('#share-card-close-btn').click();
  await page.waitForTimeout(150);

  // Switch to Dark Theme to showcase theme adaptability, then restore neutral
  await page.locator('#settings-button').click();
  await page.locator('#interface-family-input').selectOption('dark');
  await page.locator('#settings-dialog .dialog-footer button').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(g1, '06.png') });

  await page.locator('#settings-button').click();
  await page.locator('#interface-family-input').selectOption('clear');
  await page.locator('button.interface-theme[data-interface-theme="neutral"]').click();
  await page.locator('#settings-dialog .dialog-footer button').click();
  await page.waitForTimeout(250);

  // =========================================================================
  // GIF 2: demo-graph-views-canvas.gif
  // =========================================================================
  const g2 = path.join(tempFramesDir, 'gif2');
  await mkdir(g2, { recursive: true });

  // 1. Global Graph
  await page.locator('#global-graph-button').click();
  await page.locator('#global-graph-stage').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(g2, '01.png') });

  // 2. Graph Pathfinder Popover & Shortest Path
  await page.locator('#graph-pathfinder-menu-trigger').click();
  const startOpt = await page.locator('#graph-path-start option').nth(1).getAttribute('value');
  const endOpt = await page.locator('#graph-path-end option').nth(3).getAttribute('value');
  if (startOpt) await page.locator('#graph-path-start').selectOption(startOpt);
  if (endOpt) await page.locator('#graph-path-end').selectOption(endOpt);
  await page.locator('#graph-path-find').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(g2, '02.png') });
  await page.locator('#global-graph-button').click();
  await page.waitForTimeout(200);

  // 3. Multi-dimensional Database Table View
  await page.locator('#database-button').click();
  await page.locator('#database-content table').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(g2, '03.png') });

  // 4. Kanban Board View + View Management Menu
  await page.locator('#database-board-mode').click();
  await page.waitForTimeout(250);
  await page.locator('#database-view-manage-menu > summary').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(g2, '04.png') });
  await page.locator('#database-view-manage-menu > summary').click();

  // 5. Spatial Whiteboard Canvas
  await page.locator('[data-activity-id="whiteboard:whiteboard-view"]').click();
  await page.waitForTimeout(450);
  if (await page.locator('#whiteboard-create').isVisible()) {
    await page.locator('#whiteboard-new-title').fill('知识架构空间白板');
    await page.locator('#whiteboard-create').click();
    await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
  }
  const wbNoteOpt = await page.locator('#whiteboard-note-select option').nth(1).getAttribute('value').catch(() => '');
  if (wbNoteOpt) {
    await page.locator('#whiteboard-note-select').selectOption(wbNoteOpt);
    await page.locator('#whiteboard-insert-note-card').click();
  }
  await page.waitForTimeout(550);
  await page.screenshot({ path: path.join(g2, '05.png') });

  // =========================================================================
  // GIF 3: demo-research-ai-periodic.gif
  // =========================================================================
  const g3 = path.join(tempFramesDir, 'gif3');
  await mkdir(g3, { recursive: true });

  // 1. Research Desk -> PDF Native Layout Reader
  await page.locator('[data-activity-id="research-desk:research-view"]').click();
  await page.mouse.move(640, 120);
  await page.waitForSelector('#research-desk[data-ready="true"]');
  await page.locator('[data-research-mode="reader"]').click();
  await page.waitForTimeout(350);
  const readerMenu = page.locator('#reader-tools-menu > summary');
  if (await readerMenu.isVisible()) {
    await readerMenu.click();
    const samplePdfBtn = page.locator('#reader-sample-pdf-btn');
    if (await samplePdfBtn.isVisible()) {
      await samplePdfBtn.click();
      await page.waitForTimeout(500);
    }
  }
  await page.screenshot({ path: path.join(g3, '01.png') });

  // 2. AI Assistant -> Karpathy raw/ -> wiki/ Compiler
  await page.locator('[data-activity-id="ai-assistant:ai-view"]').click();
  await page.mouse.move(640, 120);
  await page.waitForTimeout(450);
  await page.locator('[data-ai-tab="compiler"]').click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(g3, '02.png') });

  // 3. SM-2 Spaced Repetition Flashcards + Anki Deck Menu
  await page.locator('[data-ai-tab="flashcards"]').click();
  await page.waitForTimeout(350);
  if (await page.locator('#ai-sr-flip-btn').isEnabled()) {
    await page.locator('#ai-sr-flip-btn').click();
  }
  await page.locator('#ai-sr-deck-menu-trigger').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(g3, '03.png') });
  await page.locator('#ai-sr-deck-menu-trigger').click();

  // 4. Vault Health & Live Obsidian Dataview DQL Query
  await page.locator('[data-ai-tab="doctor"]').click();
  await page.waitForTimeout(300);
  await page.locator('#ai-doctor-tools-menu-trigger').click();
  await page.locator('#ai-dataview-run-btn').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(g3, '04.png') });

  // 5. Workspace Home Overview + Periodic Notes & Writing Sprint / .ics Menu
  await page.locator('[data-activity-id="workspace-home:home-view"]').click();
  await page.waitForSelector('#workspace-home[data-ready="true"]');
  await page.locator('#home-overview-tab').click();
  await page.waitForTimeout(250);
  await page.locator('#home-periodic-menu-trigger').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(g3, '05.png') });

  await context.close();
} finally {
  await browser.close();
  server.close();
}

// Assemble crisp optimized GIFs using Python Pillow if available
const pythonCandidates = [
  process.env.PYTHON_EXE,
  path.resolve(root, '../../.venv/Scripts/python.exe'),
  'python',
].filter(Boolean);

const pyScript = `
import sys, os, glob
from PIL import Image

frames_root = sys.argv[1]
out_dir = sys.argv[2]

specs = [
    ('gif1', 'demo-writing-and-menus.gif', [1300, 1150, 1350, 1300, 1300, 1300]),
    ('gif2', 'demo-graph-views-canvas.gif', [1350, 1400, 1300, 1350, 1400]),
    ('gif3', 'demo-research-ai-periodic.gif', [1350, 1350, 1400, 1350, 1450]),
]

for folder, out_name, durations in specs:
    pngs = sorted(glob.glob(os.path.join(frames_root, folder, '*.png')))
    if not pngs:
        raise RuntimeError('No frames found in ' + folder)
    resized = []
    for p in pngs:
        im = Image.open(p).convert('RGB')
        im = im.resize((960, 600), Image.Resampling.LANCZOS)
        q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        resized.append(q)
    out_path = os.path.join(out_dir, out_name)
    resized[0].save(
        out_path,
        save_all=True,
        append_images=resized[1:],
        duration=durations[:len(resized)],
        loop=0,
        optimize=True,
    )
    print(out_name, os.path.getsize(out_path))
`;

let assembled = false;
for (const py of pythonCandidates) {
  const res = spawnSync(py, ['-c', pyScript, tempFramesDir, imagesDir], { encoding: 'utf8', windowsHide: true });
  if (res.status === 0) {
    console.log(res.stdout.trim());
    assembled = true;
    break;
  }
}
await rm(tempFramesDir, { recursive: true, force: true });
if (!assembled) {
  throw new Error('Failed to assemble animated GIFs via Python Pillow.');
}
console.log('INKLOOM_README_MEDIA_OK');
