import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { IncrementalVaultIndex } from '../core/vault-index.mjs';
import { buildVaultGraph } from '../core/vault-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = 'inkloom-20261022-chain-v1';
const browserChannel = process.env.INKLOOM_BROWSER_CHANNEL || 'msedge';
function samples(count) {
  return Array.from({ length: count }, (_, index) => {
    const stem = 'Note-' + String(index).padStart(5, '0');
    return { id: 'benchmark-' + index, name: stem + '.md', path: 'vault://' + stem + '.md', relativePath: stem + '.md', source: `---\ntitle: ${stem}\ntags: [group-${index % 10}]\nstatus: Draft\n---\n# ${stem}\n\nDeterministic ${seed}.\n` + (index ? `[[Note-${String(index - 1).padStart(5, '0')}]]\n` : '') };
  });
}
const rounded = value => Math.round(value * 100) / 100;
if (!isMainThread) {
  const notes = samples(workerData.count); const started = performance.now();
  if (workerData.kind === 'legacy') {
    const graph = buildVaultGraph(notes); parentPort.postMessage({ status: 'measured', ms: rounded(performance.now() - started), links: graph.edges.length });
  } else {
    const index = new IncrementalVaultIndex(); index.apply(notes); const coldMs = performance.now() - started;
    const durations = [];
    for (let trial = 0; trial < 9; trial++) {
      const note = notes[Math.floor(notes.length / 2)]; const before = index.counters.parsed; const changed = performance.now();
      index.apply([{ ...note, source: note.source + 'Trial ' + trial }]); durations.push(performance.now() - changed); assert.equal(index.counters.parsed - before, 1);
    }
    const queryStart = performance.now(); const snapshot = index.snapshot('benchmark-0'); const queryMs = performance.now() - queryStart;
    durations.sort((first, second) => first - second);
    parentPort.postMessage({ status: 'measured', coldMs: rounded(coldMs), editMedianMs: rounded(durations[4]), editMaxMs: rounded(durations[8]), queryMs: rounded(queryMs), parsedPerEdit: 1, edges: index.edges.size, nodes: snapshot.nodes.length, workerHeapMiB: rounded(process.memoryUsage().heapUsed / 1024 / 1024) });
  }
} else {
  const output = path.join(root, 'verification', 'benchmark-' + new Date().toISOString().replaceAll(':', '-')); await mkdir(output, { recursive: true });
  const report = {
    version: JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8')).version,
    seed, browserChannel, createdAt: new Date().toISOString(), hardware: { platform: process.platform, arch: process.arch, os: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramGiB: rounded(os.totalmem() / 1024 ** 3), node: process.version },
    method: { core: 'Isolated Node worker per sample; legacy synchronous algorithm vs incremental index; nine distinct single-note edits', browser: 'Fresh isolated browser context with deterministic localStorage vault; browserChannel records the actual browser; first navigation to ready, real CodeMirror insertion, quick search, graph layout/canvas, plugin disable, then same-context reload with validated persistent cache', memory: 'JS heap only, not total EXE or WebView2 working set', limits: { legacyMs: 20000, readyMs: 20000, inputMs: 1500, graphMs: 12000 } },
    sourceHashes: {}, results: [], passed: false,
  };
  for (const name of ['core/vault-graph.mjs', 'core/vault-index.mjs', 'core/index-service.mjs', 'core/index-cache.mjs', 'core/task-queue.mjs', 'core/plugin-host.mjs', 'core/graph-layout.mjs', 'core/graph-query.mjs', 'core/appearance-pack.mjs', 'core/appearance-presets.mjs', 'core/graph-state.mjs', 'app/src/appearance-workspace.js', 'app/src/appearance-panel.js', 'app/src/appearance-icons.js', 'app/src/graph-state-cache.js', 'app/src/loom-graph.js', 'plugins/knowledge-graph/main.js', 'plugins/note-views/main.js', 'app/src/vault-index-client.js', 'app/src/vault-index-worker.js', 'app/src/inkloom.js', 'app/src/vault-manager.js', 'app/src/phase-two.js', 'native/VaultStore.cs', 'native/InkloomApp.cs']) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  for (const name of ['core/vault-tree.mjs', 'core/workspace-model.mjs', 'plugins/workspace-home/main.js', 'plugins/workspace-home/workspace-view.js', 'app/src/inkloom.css']) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  for (const name of ['core/task-planning.mjs', 'plugins/workspace-home/task-editor.js']) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  for (const name of ['core/note-embeds.mjs', 'core/whiteboard-document.mjs', 'core/research-notes.mjs', 'core/workspace-template.mjs', 'core/database-query.mjs', 'core/ai-retrieval.mjs', 'core/ai-assistant.mjs', 'core/ai-skills.mjs', 'core/smart-wikilinks.mjs', 'core/knowledge-synthesis.mjs', 'core/plugin-package.mjs', 'core/spaced-repetition.mjs', 'core/vault-doctor.mjs', 'core/vault-snapshot.mjs', 'core/in-place-copilot.mjs', 'core/publication-presenter.mjs', 'core/spatial-canvas-graph.mjs', 'core/local-agent-sync.mjs', 'app/src/note-embed-view.js', 'app/src/wikilink-plugin.js', 'app/src/workbench.js', 'app/src/user-guide.js', 'plugins/whiteboard/main.js', 'plugins/whiteboard/canvas-view.js', 'plugins/research-desk/main.js', 'plugins/ai-assistant/main.js']) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  report.method.limits.homeMs = 5000;
  async function coreMeasurement(kind, count) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { kind, count } });
      const timeout = setTimeout(async () => { await worker.terminate(); resolve({ status: 'budget-exceeded', budgetMs: 20000 }); }, 20000);
      worker.once('message', async result => { clearTimeout(timeout); await worker.terminate(); resolve(result); });
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  let browser; let server;
  try {
    const { chromium, expect } = await import('../app/node_modules/@playwright/test/index.mjs');
    const dist = path.join(root, 'app/dist');
    server = createServer(async (request, response) => {
      try {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); const file = path.resolve(dist, name === '/' ? 'index.html' : name.slice(1));
        if (!file.startsWith(dist + path.sep)) throw new Error('Invalid resource');
        const body = await readFile(file); response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' }); response.end(body);
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: browserChannel, headless: true });
    for (const count of [100, 1000, 10000]) {
      const notes = samples(count); const result = { count, datasetSha256: createHash('sha256').update(JSON.stringify(notes)).digest('hex'), legacy: await coreMeasurement('legacy', count), incremental: await coreMeasurement('incremental', count) };
      report.results.push(result); assert.equal(result.incremental.status, 'measured');
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }); const page = await context.newPage();
      page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(20000); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(notes => {
        if (!localStorage.getItem('inkloom.vault.notes.v1')) localStorage.setItem('inkloom.vault.notes.v1', JSON.stringify({ vaultId: 'benchmark-' + notes.length, vaultName: 'Benchmark ' + notes.length, vaultPath: 'vault://benchmark-' + notes.length, notes }));
        localStorage.setItem('inkloom.settings', JSON.stringify({ sidebar: true, source: true, rich: true, contextSidebar: true, disabledPlugins: ['sandbox-inspector'] }));
        window.benchmarkLongTasks = [];
        new PerformanceObserver(list => window.benchmarkLongTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, ms: entry.duration })))).observe({ type: 'longtask', buffered: true });
      }, notes);
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#activity-rail');
      await page.waitForFunction(() => performance.getEntriesByName('inkloom-ready').length > 0);
      const readyMs = await page.evaluate(() => performance.getEntriesByName('inkloom-ready')[0].startTime);
      const parsedBefore = Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'));
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End');
      const inputStart = performance.now(); await page.keyboard.insertText('\nBenchmark input final\n');
      await expect.poll(async () => Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'))).toBe(parsedBefore + 1);
      const inputMs = performance.now() - inputStart;
      await page.locator('[data-action="save"]').click();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('inkloom.vault.notes.v1')).notes[0].source.includes('Benchmark input final'))).toBe(true);
      const queryStart = performance.now(); await page.locator('#quick-switcher-trigger').click(); await page.locator('#quick-switcher-input').fill('Note-' + String(count - 1).padStart(5, '0'));
      await expect(page.locator('#quick-switcher-list')).toContainText('Note-' + String(count - 1).padStart(5, '0')); const searchMs = performance.now() - queryStart; await page.keyboard.press('Escape');
      const graphStart = performance.now(); await page.locator('#global-graph-button').click();
      await expect(page.locator('#global-graph-canvas')).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      const graphMs = performance.now() - graphStart;
      const graph = await page.locator('#global-graph-canvas').evaluate(canvas => {
        const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let pixels = 0;
        for (let offset = 0; offset < bytes.length; offset += 4) if (bytes[offset + 3] > 128) pixels++;
        return { state: canvas.dataset.layoutState, layoutMs: Number(canvas.dataset.layoutMs), pixels };
      });
      await page.screenshot({ path: path.join(output, 'graph-' + count + '.png') });
      const tableStart = performance.now(); await page.locator('#database-button').click();
      await expect(page.locator('#global-graph-canvas')).toHaveCount(0);
      await expect.poll(() => page.workers().filter(worker => worker.url().includes('graph-layout-worker')).length).toBe(1);
      await expect(page.locator('#database-count')).toHaveText(count + ' 篇笔记');
      await expect(page.locator('#database-content tbody tr')).toHaveCount(Math.min(50, count));
      const firstRow = await page.locator('#database-content tbody tr').first().getAttribute('data-note-id');
      await page.locator('#database-next').click(); await expect(page.locator('#database-page')).toHaveText('2 / ' + Math.ceil(count / 50));
      assert.notEqual(await page.locator('#database-content tbody tr').first().getAttribute('data-note-id'), firstRow);
      await page.locator('#database-page-size').selectOption('25'); await expect(page.locator('#database-content tbody tr')).toHaveCount(25);
      const tableMs = performance.now() - tableStart;
      await page.locator('#database-query').fill('Note-' + String(count - 1).padStart(5, '0')); await expect(page.locator('#database-count')).toHaveText('1 篇笔记');
      await expect(page.locator('#database-page')).toHaveText('1 / 1');
      await page.screenshot({ path: path.join(output, 'table-' + count + '.png') });
      await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toHaveCount(0);
      const homeStarted = performance.now(); await page.locator('[data-activity-id="workspace-home:home-view"]').click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
      result.homeMs = rounded(performance.now() - homeStarted); assert.ok(result.homeMs < 5000, 'Workspace opening exceeded 5000 ms');
      await page.screenshot({ path: path.join(output, 'home-' + count + '.png') }); await page.locator('[data-activity-id="workspace-home:home-view"]').click(); await expect(page.locator('#workspace-home')).toHaveCount(0);
      await page.locator('#settings-button').click(); await page.locator('[data-settings-group="extensions"] summary').click();
      const graphDisableStart = performance.now(); await page.locator('[data-plugin-id="knowledge-graph"]').uncheck();
      await expect.poll(() => page.workers().filter(worker => worker.url().includes('graph-layout-worker')).length).toBe(0);
      const graphDisableMs = performance.now() - graphDisableStart;
      const disableStart = performance.now(); await page.locator('[data-plugin-id="unlinked-notes"]').uncheck();
      const diagnostics = await page.locator('#activity-rail').evaluate(node => JSON.parse(node.dataset.pluginDiagnostics));
      const disabled = diagnostics.plugins.find(plugin => plugin.id === 'unlinked-notes'); assert.equal(disabled.resources, 0);
      const performanceData = await page.evaluate(() => ({ rendererHeapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : null, maximumLongTaskMs: Math.max(0, ...window.benchmarkLongTasks.map(entry => entry.ms)), renderedNoteButtons: document.querySelectorAll('#vault-tree-list [data-vault-note-id]').length }));
      result.browser = { readyMs: rounded(readyMs), inputToIndexMs: rounded(inputMs), searchMs: rounded(searchMs), graphMs: rounded(graphMs), graph, graphDisableMs: rounded(graphDisableMs), stoppedGraphWorkers: 0, tablePaginationMs: rounded(tableMs), tablePageRows: 25, tableUnmounted: true, pluginDisableMs: rounded(performance.now() - disableStart), disabledResources: disabled.resources, ...performanceData, errors };
      assert.ok(readyMs < 20000); assert.ok(inputMs < 1500, 'Input exceeded 1500 ms'); assert.ok(graphMs < 12000); assert.ok(graph.pixels > 100); assert.deepEqual(errors, []); assert.ok(performanceData.renderedNoteButtons <= 200);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => performance.getEntriesByName('inkloom-ready').length > 0);
      const warm = await page.evaluate(() => {
        const status = document.querySelector('#vault-graph-status');
        return { readyMs: performance.getEntriesByName('inkloom-ready')[0].startTime, parsed: Number(status.dataset.parsedNotes), hydrated: Number(status.dataset.hydratedNotes), warning: !document.querySelector('#vault-change-notice').hidden };
      });
      result.browser.warmCache = { ...warm, readyMs: rounded(warm.readyMs) };
      assert.equal(warm.parsed, 0); assert.equal(warm.hydrated, count); assert.equal(warm.warning, false); assert.ok(warm.readyMs < 20000); assert.deepEqual(errors, []);
      await context.close(); console.log('INKLOOM_BENCHMARK_SAMPLE', count, JSON.stringify(result.browser));
    }
    report.passed = true;
  } catch (error) { report.failure = error.stack; process.exitCode = 1; console.error(error); }
  finally {
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(path.join(root, 'verification', 'benchmark-results.json'), JSON.stringify({ report: path.relative(root, path.join(output, 'results.json')).replaceAll('\\', '/'), ...report }, null, 2) + '\n');
    console.log('INKLOOM_BENCHMARK', report.passed ? 'PASS' : 'FAIL', output);
  }
}