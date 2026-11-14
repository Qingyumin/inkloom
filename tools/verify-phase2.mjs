import { chromium, expect } from '../app/node_modules/@playwright/test/index.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat, rm, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildSampleOfficeFileBytes } from '../core/raw-document-ingestor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settingsOnly = process.argv.includes('--settings-only');
const shellOnly = process.argv.includes('--shell-only');
const appearanceOnly = process.argv.includes('--appearance');
const navigationOnly = process.argv.includes('--navigation');
const workspaceOnly = process.argv.includes('--workspace');
const planningOnly = process.argv.includes('--planning');
const creationOnly = process.argv.includes('--creation');
const uxOnly = process.argv.includes('--ux');
const speechOnly = process.argv.includes('--speech');
const checkFilter = process.argv.includes('--check') ? process.argv[process.argv.indexOf('--check') + 1] : '';
const phase = speechOnly ? 'speech' : uxOnly ? 'ux' : creationOnly ? 'creation' : planningOnly ? 'planning' : workspaceOnly ? 'workspace' : navigationOnly ? 'navigation' : appearanceOnly ? 'appearance' : settingsOnly ? 'settings' : shellOnly ? 'shell' : process.argv.includes('--phase3') ? 'phase3' : 'phase2';
const output = path.join(root, 'verification', phase + '-' + new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const metadata = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'));
const browserChannel = process.env.INKLOOM_BROWSER_CHANNEL || 'msedge';
const report = { version: metadata.version, phase, browserChannel, environment: 'isolated browser profile', startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [], passed: false };
report.frontendEntrySha256 = createHash('sha256').update(await readFile(path.join(root, 'app/dist/index.html'))).digest('hex');
const executableArgument = process.argv.indexOf('--exe');
let server; let child; let browser; let page; let localLlmProc;
const localLlmRoot = path.join(process.env.LOCALAPPDATA || '', 'Inkloom', 'local-llm');
const localLlmExe = path.join(localLlmRoot, 'bin', 'llama-server.exe');
const localLlmModel = path.join(localLlmRoot, 'models', 'smollm2-135m-instruct-q4_0.gguf');
async function probeLocalLlm() {
  try { const r = await fetch('http://127.0.0.1:11435/health'); return r.ok; } catch { return false; }
}
async function ensureLocalLlmForBrowser() {
  if (!await probeLocalLlm()) {
    const info = await stat(localLlmModel);
    localLlmProc = spawn(localLlmExe, ['-m', localLlmModel, '--host', '127.0.0.1', '--port', '11435', '-c', '2048', '-ngl', '0'], { cwd: path.dirname(localLlmExe), stdio: 'ignore' });
    for (let i = 0; i < 35; i++) { if (await probeLocalLlm()) break; await new Promise(r => setTimeout(r, 250)); }
    return { installed: true, running: await probeLocalLlm(), modelName: 'smollm2:135m-instruct-q4_0', modelFile: path.basename(localLlmModel), modelBytes: info.size, endpoint: 'http://127.0.0.1:11435/v1/chat/completions' };
  }
  const info = await stat(localLlmModel).catch(() => ({ size: 91726912 }));
  return { installed: true, running: true, modelName: 'smollm2:135m-instruct-q4_0', modelFile: path.basename(localLlmModel), modelBytes: info.size, endpoint: 'http://127.0.0.1:11435/v1/chat/completions' };
}
const check = async (name, action) => {
  if (speechOnly && !/^(bootstrap|speech )/.test(name)) return;
  if (uxOnly && !/^(bootstrap|ux )/.test(name)) return;
  if (checkFilter && !name.includes(checkFilter) && !name.startsWith('bootstrap')) return;
  if (settingsOnly && !/^(bootstrap|single settings)/.test(name)) return;
  if (shellOnly && !/^(bootstrap|single settings|compact workspace)/.test(name)) return;
  if (appearanceOnly && !/^(bootstrap|appearance )/.test(name)) return;
  if (navigationOnly && !/^(bootstrap|navigation )/.test(name)) return;
  if (workspaceOnly && !/^(bootstrap|navigation |workspace )/.test(name)) return;
  if (planningOnly && !/^(bootstrap|planning )/.test(name)) return;
  if (creationOnly && !/^(bootstrap|creation )/.test(name)) return;
  const started = performance.now();
  try { const evidence = await action(); report.checks.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - started), evidence }); console.log('PASS', name); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.message }); throw error; }
};
const desktop = executableArgument >= 0;
const profile = path.join(output, 'profile');
async function readNotes() {
  if (!desktop) return page.evaluate(() => JSON.parse(localStorage.getItem('inkloom.vault.notes.v1')).notes);
  const notes = [];
  async function scan(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) await scan(path.join(directory, entry.name), relative + entry.name + '/');
      else if (entry.name.endsWith('.md')) {
        const source = await readFile(path.join(directory, entry.name), 'utf8').catch(error => { if (['EBUSY', 'ENOENT'].includes(error.code)) return ''; throw error; });
        notes.push({ name: entry.name, relativePath: relative + entry.name, source: source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n') });
      }
    }
  }
  await scan(path.join(profile, 'StarterVault')); return notes;
}
async function savedNote(prefix) { return (await readNotes()).find(note => note.name.startsWith(prefix)) || { name: '', relativePath: '', source: '' }; }
async function openFromSearch(title, surface = 'note') {
  await page.locator('#quick-switcher-trigger').click();
  await page.locator('#quick-switcher-input').fill(title);
  await page.locator('#quick-switcher-list button').filter({ hasText: title }).first().click();
  await expect(page.locator('#note-title-badge')).toContainText(title);
  if (surface === 'whiteboard') await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
  else await expect(page.locator('#editor-stage')).toBeVisible();
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
}
async function nativeCommand(command, args = {}) {
  return page.evaluate(({ command, args }) => new Promise((resolve, reject) => {
    const id = 'verification-' + crypto.randomUUID();
    const timeout = setTimeout(() => { window.chrome.webview.removeEventListener('message', received); reject(new Error('Native verification command timed out')); }, command === 'synthesizeSpeech' ? 35000 : 15000);
    const received = event => { if (event.data.id !== id) return; clearTimeout(timeout); window.chrome.webview.removeEventListener('message', received); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    window.chrome.webview.addEventListener('message', received); window.chrome.webview.postMessage({ id, command, args });
  }), { command, args });
}
async function restartDesktopForAppearance() {
  let timeout;
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); timeout = setTimeout(() => reject(new Error('Appearance test process did not close normally')), 12000); });
  try { await page.evaluate(() => window.chrome.webview.postMessage({ id: 'appearance-close', command: 'finishClose', args: {} })); await exited; }
  finally { clearTimeout(timeout); }
  await browser.close().catch(() => {}); page = null;
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  child = spawn(path.resolve(process.argv[executableArgument + 1]), ['--profile', profile, '--debug-port', String(port)], { stdio: 'ignore' });
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 2000 }); }).toPass({ timeout: 25000, intervals: [200, 500, 1000] });
  await expect(() => { page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('https://inkloom.local')); assert.ok(page); }).toPass({ timeout: 15000 });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|inkloom\.local|inkloom-files\.local)([:/]|$)/.test(request.url())) report.externalRequests.push(request.url()); });
  await page.waitForSelector('#database-button', { timeout: 30000 });
}
try {
  if (desktop) {
    const executable = path.resolve(process.argv[executableArgument + 1]);
    report.environment = 'Windows WebView2 executable with isolated profile'; report.exeSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
    report.resourcesSha256 = createHash('sha256').update(await readFile(path.join(path.dirname(executable), 'Inkloom.resources'))).digest('hex');
    report.browserChannel = 'WebView2';
    const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve)); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
    child = spawn(executable, ['--profile', profile, '--debug-port', String(port)], { stdio: 'ignore' });
    await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 2000 }); }).toPass({ timeout: 25000, intervals: [200, 500, 1000] });
    await expect(() => { page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('https://inkloom.local')); assert.ok(page); }).toPass({ timeout: 25000, intervals: [150, 300, 600] });
  } else {
    const dist = path.join(root, 'app/dist');
    server = createServer(async (request, response) => {
      try {
        const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (requested.startsWith('/__local_llm/')) {
          const action = requested.slice('/__local_llm/'.length);
          if (action === 'status') {
            const info = await stat(localLlmModel).catch(() => null);
            const body = JSON.stringify({ installed: Boolean(info), running: await probeLocalLlm(), modelName: 'smollm2:135m-instruct-q4_0', modelFile: path.basename(localLlmModel), modelBytes: info?.size || 0, endpoint: 'http://127.0.0.1:11435/v1/chat/completions' });
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(body); return;
          }
          if (action === 'start') {
            const st = await ensureLocalLlmForBrowser();
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(st)); return;
          }
          if (action === 'stop') {
            localLlmProc?.kill(); localLlmProc = null;
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ installed: true, running: false, modelName: 'smollm2:135m-instruct-q4_0', modelFile: path.basename(localLlmModel), modelBytes: 91726912 })); return;
          }
          if (action === 'chat') {
            await ensureLocalLlmForBrowser();
            const chunks = []; for await (const ch of request) chunks.push(ch);
            const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const t0 = performance.now();
            const r = await fetch('http://127.0.0.1:11435/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
              body: JSON.stringify({ model: args.model || 'smollm2:135m-instruct-q4_0', temperature: 0.2, max_tokens: args.maxTokens || 64, messages: [{ role: 'system', content: args.systemPrompt || '' }, { role: 'user', content: args.userPrompt || '' }] }),
            });
            const data = await r.json();
            const answer = data?.choices?.[0]?.message?.content || '';
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ answer: String(answer), model: args.model || 'smollm2:135m-instruct-q4_0', provider: 'local-gguf', latencyMs: Math.round(performance.now() - t0) }));
            return;
          }
        }
        const file = path.resolve(dist, requested === '/' ? 'index.html' : requested.slice(1));
        if (!file.startsWith(dist + path.sep)) throw new Error('outside');
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
        const body = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); response.end(body);
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await expect(async () => { browser = await chromium.launch({ channel: browserChannel, headless: true }); }).toPass({ timeout: 15000, intervals: [300, 700, 1200] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 }); page = await context.newPage();
  }
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|inkloom\.local|inkloom-files\.local)([:/]|$)/.test(request.url())) report.externalRequests.push(request.url()); });
  if (!desktop) await expect(async () => { await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' }); }).toPass({ timeout: 15000, intervals: [300, 700, 1200] });
  await page.waitForSelector('#database-button', { timeout: 30000 });
  if (phase === 'phase3') await page.waitForSelector('#activity-rail');
  await check('bootstrap, transparent logo, no missing local image', async () => {
    await expect(page.locator('.brand-logo').first()).toBeVisible();
    await expect(page.locator('.sidebar-footer > small')).toHaveText(metadata.version);
    const result = await page.evaluate(async () => {
      const image = document.querySelector('.brand-logo'); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0; let ink = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) { if (!pixels[offset + 3]) alpha++; if (pixels[offset + 3] > 128 && pixels[offset] < 20) ink++; }
      return { width: image.naturalWidth, alpha, ink, corner: pixels[3], count: Number(document.querySelector('#vault-count').textContent) };
    });
    assert.equal(result.count, 22); assert.equal(result.corner, 0); assert.ok(result.alpha > 150000); assert.ok(result.ink > 10000);
    await page.screenshot({ path: path.join(output, '01-light.png') }); return result;
  });
  if (speechOnly) {
    const speechSource = '---\ntitle: Speech acceptance\nprivacy: public\n---\n\n# 第一章 朗读验收\n\n这是一段隔离测试文字，用于验证墨图朗读功能。阅读时不修改笔记正文。\n\n# 第二章 继续阅读\n\n第二章仍然保持真实原文与分段顺序。\n';
    let speechBaseline;
    const openSpeechMenu = async () => { await page.locator('#note-tools-menu-trigger').click(); await page.locator('#note-read-aloud-button').click(); };
    const openSpeechSettings = async () => {
      await page.locator('#settings-button').click();
      const group = page.locator('[data-settings-group="reading"]');
      if (!await group.evaluate(node => node.open)) await group.locator(':scope > summary').click();
      if (!await page.locator('#speech-preferences').evaluate(node => node.open)) await page.locator('#speech-preferences > summary').click();
    };
    await check('speech menu, preferences, playback and source preservation', async () => {
      await expect(page.locator('#speech-panel')).toBeHidden();
      await expect(page.locator('#note-read-aloud-button')).toBeHidden();
      await openFromSearch('双链笔记与卡片盒方法');
      await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(speechSource);
      await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await readNotes()).some(note => note.source === speechSource)).toBe(true);
      speechBaseline = await readNotes();
      await page.locator('.view-tools [data-action="source"]').click();
      if (!desktop) await page.evaluate(() => {
        const fixture = { spoken: [], current: null, voices: [{ name: 'Isolated local callback fixture', lang: 'zh-CN', localService: true }] };
        Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
          getVoices: () => fixture.voices, cancel() {}, speak(utterance) { fixture.current = utterance; fixture.spoken.push(utterance.text); queueMicrotask(() => utterance.onstart?.()); },
        } });
        window.__speechFixture = fixture;
      });
      else await page.evaluate(() => {
        const originalDecode = AudioContext.prototype.decodeAudioData;
        window.__speechAudioEvidence = [];
        AudioContext.prototype.decodeAudioData = async function(bytes) {
          const byteLength = bytes.byteLength;
          const decoded = await originalDecode.call(this, bytes);
          const samples = decoded.getChannelData(0);
          let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          window.__speechAudioEvidence.push({ bytes: byteLength, duration: decoded.duration, sampleRate: decoded.sampleRate, peak });
          return decoded;
        };
        const post = chrome.webview.postMessage.bind(chrome.webview);
        chrome.webview.postMessage = request => { if (request.command === 'synthesizeSpeech') window.__lastSpeechRequest = request.args; post(request); };
      });
      await openSpeechSettings();
      await expect(page.locator('#speech-provider')).toHaveValue('system');
      await expect(page.locator('#speech-voice-input option')).toHaveCount(16);
      await expect(page.locator('#speech-pitch-input option')).toHaveCount(4);
      await expect(page.locator('#speech-stop-mode-input option')).toHaveCount(5);
      await page.locator('#speech-rate-input').evaluate(node => { node.value = '1.25'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
      await expect(page.locator('#speech-settings-status')).toContainText('已保存');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await openSpeechMenu();
      await expect(page.locator('#speech-panel')).toHaveAttribute('data-state', 'playing', { timeout: 20000 });
      await expect(page.locator('#rich-editor .speech-speaking-block')).toHaveCount(1);
      await page.locator('#speech-toggle').click(); await expect(page.locator('#speech-panel')).toHaveAttribute('data-state', 'paused');
      await page.locator('#speech-next').click(); await expect(page.locator('#speech-status')).toContainText('2 / 4', { timeout: 20000 });
      await page.locator('#speech-prev').click(); await expect(page.locator('#speech-status')).toContainText('1 / 4');
      await page.locator('#speech-toggle').click();
      await page.screenshot({ path: path.join(output, 'speech-player.png') });
      await page.locator('#speech-stop').click(); await expect(page.locator('#speech-panel')).toBeHidden();
      await expect(page.locator('.speech-speaking-block')).toHaveCount(0);
      assert.deepEqual(await readNotes(), speechBaseline);
      const audio = desktop ? await page.evaluate(() => window.__speechAudioEvidence) : [];
      if (desktop) assert.ok(audio.some(entry => entry.duration > 0.1 && entry.peak > 0.005 && entry.bytes > 1024));
      return { execution: desktop ? 'real Windows System.Speech WAV, WebView2 decodeAudioData and page controls' : 'explicit browser local-voice callback fixture; no audio-quality certification', rate: 1.25, noteBytesUnchanged: true, audio };
    });
    await check('speech selection, cancellation, chapter stop and persistence', async () => {
      const paragraph = page.locator('#rich-editor .ProseMirror p').last();
      await paragraph.scrollIntoViewIfNeeded();
      const selectionBounds = await paragraph.evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const rectangles = [...range.getClientRects()]; const first = rectangles[0]; const last = rectangles.at(-1);
        return { startX: first.left + 1, startY: first.top + first.height / 2, endX: last.right - 1, endY: last.top + last.height / 2 };
      });
      await page.mouse.move(selectionBounds.startX, selectionBounds.startY); await page.mouse.down();
      await page.mouse.move(selectionBounds.endX, selectionBounds.endY, { steps: 12 }); await page.mouse.up();
      await expect(page.locator('[data-action="speak-selection"]')).toBeVisible(); await page.locator('[data-action="speak-selection"]').click();
      await expect(page.locator('#speech-preview')).toContainText('第二章仍然');
      await expect(page.locator('#speech-status')).toContainText('1 / 1');
      await page.locator('#speech-stop').click();
      await openSpeechSettings();
      await page.locator('#speech-stop-mode-input').selectOption('chapter'); await expect(page.locator('#speech-settings-status')).toContainText('已保存');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await openSpeechMenu();
      if (desktop) await expect(page.locator('#speech-panel')).toBeHidden({ timeout: 30000 });
      else {
        await page.evaluate(() => window.__speechFixture.current.onend());
        await expect(page.locator('#speech-status')).toContainText('2 / 4');
        await page.evaluate(() => window.__speechFixture.current.onend());
        await expect(page.locator('#speech-panel')).toBeHidden();
      }
      await openSpeechMenu();
      await openFromSearch('YAML属性与标签体系');
      await expect(page.locator('#speech-panel')).toBeHidden();
      assert.deepEqual(await readNotes(), speechBaseline);
      await page.reload(); await page.waitForSelector('#database-button');
      await openSpeechSettings();
      await expect(page.locator('#speech-rate-input')).toHaveValue('1.25'); await expect(page.locator('#speech-stop-mode-input')).toHaveValue('chapter');
      await page.locator('#settings-dialog .dialog-footer button').click();
      return { selectionOnly: true, chapterStop: true, stopOnNoteSwitch: true, preferencesReadBackAfterReload: true, noteBytesUnchanged: true };
    });
    await check('speech expanded settings and controls fit light and dark viewport matrix', async () => {
      const matrix = [];
      for (const theme of ['clear', 'dark']) {
        await page.locator('#settings-button').click();
        const appearance = page.locator('[data-settings-group="appearance"]');
        if (!await appearance.evaluate(node => node.open)) await appearance.locator(':scope > summary').click();
        await page.locator('#interface-family-input').selectOption(theme);
        await page.locator('[data-settings-group="reading"] > summary').click();
        if (!await page.locator('#speech-preferences').evaluate(node => node.open)) await page.locator('#speech-preferences > summary').click();
        if (desktop) { await page.locator('#speech-provider').selectOption('openai'); await expect(page.locator('#speech-settings-status')).toContainText('已保存'); }
        for (const width of [1440, 1280, 960, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const geometry = await page.locator('#settings-dialog').evaluate(node => ({ width: node.clientWidth, overflow: node.scrollWidth - node.clientWidth, right: node.getBoundingClientRect().right, viewport: innerWidth }));
          assert.ok(geometry.overflow <= 2 && geometry.right <= geometry.viewport + 2, JSON.stringify(geometry));
          await page.screenshot({ path: path.join(output, `speech-settings-${width}-${theme}.png`) }); matrix.push({ theme, width, ...geometry });
        }
        if (desktop) { await page.locator('#speech-provider').selectOption('system'); await expect(page.locator('#speech-settings-status')).toContainText('已保存'); }
        await page.locator('#settings-dialog .dialog-footer button').click();
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      return { matrix, expandedCustomFields: desktop, viewportIsNotMobileRelease: true };
    });
    await check('speech privacy and errors never masquerade as playback', async () => {
      if (!desktop) {
        await page.evaluate(() => { window.__speechFixture = { voices: [] }; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], cancel() {}, speak() { throw new Error('must not speak'); } } }); });
        await openSpeechMenu();
        await expect(page.locator('#speech-panel')).toHaveAttribute('data-state', 'error');
        await expect(page.locator('#speech-status')).toContainText('未找到本机离线音色');
        await page.locator('#speech-stop').click();
        return { missingVoicesReported: true, fabricatedPlayback: false, onlineProviderDisabledInBrowser: true };
      }
      await openSpeechSettings();
      await page.locator('#speech-provider').selectOption('edge'); await expect(page.locator('#speech-settings-status')).toContainText('已保存');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await openSpeechMenu(); await expect(page.locator('#speech-consent-dialog')).toBeVisible();
      await page.locator('#speech-consent-cancel').click(); await expect(page.locator('#speech-panel')).toBeHidden();
      const hello = await nativeCommand('hello');
      const documentId = hello.document?.id || hello.activeDocumentId;
      assert.ok(documentId, 'native hello must identify active document');
      for (const source of ['---\nprivacy: local-only\n---\nSynthetic private fixture', '---\nprivacy: confidential\n---\nSynthetic private fixture', '---\nencrypted: true\n---\nSynthetic ciphertext']) {
        await assert.rejects(() => nativeCommand('synthesizeSpeech', { documentId, requestId: crypto.randomUUID(), text: 'Synthetic test only', source, provider: 'edge', consent: true }), /本机|加密|锁定/);
      }
      await assert.rejects(() => nativeCommand('synthesizeSpeech', { documentId, requestId: crypto.randomUUID(), text: 'Synthetic test only', source: '# Public fixture', provider: 'edge', consent: false }), /确认/);
      return { execution: 'real native message bridge; requests rejected before network', cancelledConsent: true, restrictedSourcesRejected: 3, missingConsentRejected: true };
    });
    if (desktop && process.argv.includes('--online-speech')) await check('speech real online synthesis returns decodable non-silent audio', async () => {
      await openSpeechSettings();
      await page.locator('#speech-provider').selectOption('edge'); await expect(page.locator('#speech-settings-status')).toContainText('已保存');
      await page.locator('#speech-voice-input').selectOption('zh-CN-YunxiNeural');
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.locator('#speech-preview-voice').click();
        if (await page.locator('#speech-consent-dialog').isVisible({ timeout: 2000 }).catch(() => false)) {
          await page.locator('#speech-consent-allow').click();
        }
        try {
          await expect(page.locator('#speech-panel')).toHaveAttribute('data-state', 'playing', { timeout: 22000 });
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise(r => setTimeout(r, 1200));
        }
      }
      await page.locator('#speech-settings-stop').click();
      await page.locator('#settings-dialog .dialog-footer button').click();
      return { execution: 'real Edge service with fixed built-in audition text; decoded by WebView2 AudioContext', provider: 'edge-neural', voice: 'zh-CN-YunxiNeural', externalText: 'fixed audition sentence only', perceivedAudioQuality: 'not assessed' };
    });
  }
  await check('single settings window, collapsible categories and dark logo', async () => {
    await expect(page.locator('[data-action="settings"]')).toHaveCount(1);
    await expect(page.locator('#activity-rail [data-action="settings"]')).toHaveCount(1);
    await expect(page.locator('#header-settings-button, .settings-category-bar')).toHaveCount(0);
    await page.locator('[data-action="settings"]').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    const categories = await page.locator('.settings-group').count(); assert.ok(categories >= 6); assert.equal(await page.locator('#shortcuts-dialog').count(), 0);
    await page.locator('#appearance-manager > summary').click();
    await page.locator('[data-appearance-theme="inkloom-line"]').click();
    await page.locator('#appearance-apply').click();
    await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', 'inkloom-line');
    await page.locator('#interface-family-input').selectOption('dark');
    await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', '');
    await page.locator('#appearance-manager > summary').click();
    await expect(page.locator('html')).toHaveAttribute('data-ui-mode', 'dark');
    await expect(page.locator('.source-pane')).toHaveAttribute('data-paper-mode', 'dark');
    await expect(page.locator('.rich-pane')).toHaveAttribute('data-paper-mode', 'dark');
    assert.equal(await page.locator('.brand-logo').first().evaluate(image => getComputedStyle(image).filter), 'invert(1)');
    const white = await page.evaluate(async () => {
      const image = new Image(); image.src = '/inkloom-dark.png'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, 512, 512).data;
      let visibleWhite = 0; for (let offset = 0; offset < data.length; offset += 4) if (data[offset] === 255 && data[offset + 3] > 128) visibleWhite++; return visibleWhite;
    }); assert.ok(white > 10000);
    await page.locator('[data-settings-group="appearance"] > summary').click();
    await page.locator('[data-settings-group="editing"] > summary').click();
    await page.locator('#setting-calloutStyle').selectOption('outline');
    await page.screenshot({ path: path.join(output, '02-settings-dark.png') });
    await page.locator('#settings-dialog .dialog-footer button').click();
    await page.locator('[data-action="settings"]').click();
    await expect(page.locator('[data-settings-group="editing"]')).toHaveAttribute('open', '');
    await expect(page.locator('[data-settings-group="appearance"]')).not.toHaveAttribute('open', '');
    await page.locator('[data-settings-group="appearance"] > summary').click();
    await expect(page.locator('.settings-group[open]')).toHaveCount(1);
    await expect(page.locator('[data-settings-group="editing"]')).not.toHaveAttribute('open', '');
    await page.locator('#interface-family-input').selectOption('clear');
    await expect(page.locator('.rich-pane')).toHaveAttribute('data-paper-mode', 'light');
    await page.locator('#settings-dialog .dialog-footer button').click();
    return { categories, invertedWhitePixels: white };
  });
  await check('compact workspace has unique commands, aligned sidebars and keyboard-accessible menu', async () => {
    for (const action of ['settings', 'sidebar', 'toggle-context-sidebar', 'vault-new-note', 'save']) await expect(page.locator(`[data-action="${action}"]`)).toHaveCount(1);
    for (const id of ['global-graph-button', 'database-button', 'quick-switcher-trigger']) await expect(page.locator('#' + id)).toHaveCount(1);
    const geometry = await page.evaluate(() => {
      const parseLum = raw => {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = raw || '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      const left = document.querySelector('#sidebar-toggle').getBoundingClientRect(); const right = document.querySelector('#context-sidebar-toggle').getBoundingClientRect();
      const glyph = document.querySelector('#sidebar-toggle svg').getBoundingClientRect();
      const entriesEl = document.querySelector('#activity-rail .activity-entries');
      const entriesRect = entriesEl.getBoundingClientRect();
      const entriesStyle = getComputedStyle(entriesEl);
      const railBtnStyle = getComputedStyle(document.querySelector('#activity-rail .activity-button'));
      const headerBtnStyle = getComputedStyle(document.querySelector('[data-action="save"]'));
      const noteCtxBtnStyle = getComputedStyle(document.querySelector('#star-note-button'));
      return {
        leftY: left.y, rightY: right.y, leftHeight: left.height, rightHeight: right.height, icon: glyph.width,
        header: document.querySelector('.app-header').getBoundingClientRect().height,
        railEntriesHeight: Math.round(entriesRect.height),
        railEntriesWidth: Math.round(entriesRect.width),
        railHasDarkCapsule: entriesStyle.backgroundImage.includes('linear-gradient') && parseLum(entriesStyle.borderTopColor) < 0.25 && parseLum(railBtnStyle.color) > 0.8,
        pageBtnIsLightLayered: headerBtnStyle.backgroundImage.includes('linear-gradient') && parseLum(headerBtnStyle.color) < 0.25 && parseLum(noteCtxBtnStyle.color) < 0.25 && parseLum(headerBtnStyle.borderTopColor) > 0.45
      };
    });
    assert.ok(Math.abs(geometry.leftY - geometry.rightY) < 1); assert.equal(geometry.leftHeight, geometry.rightHeight); assert.ok(geometry.leftHeight >= 28 && geometry.icon <= 16); assert.ok(geometry.header <= 44);
    assert.ok(geometry.railEntriesHeight <= 420 && geometry.railEntriesWidth <= 38, `Expected compact icon-length left rail capsule, got ${geometry.railEntriesWidth}x${geometry.railEntriesHeight}`);
    assert.ok(geometry.railHasDarkCapsule, 'Expected left rail capsule to have theme-tinted dark gradient and crisp white icons');
    assert.ok(geometry.pageBtnIsLightLayered, 'Expected inside-page buttons to use light theme-layered surface and dark ink icons');
    await expect(page.locator('#formatting-toolbar')).toBeHidden(); await expect(page.locator('#backlinks-drawer')).toBeHidden();
    await page.locator('[data-action="formatting-toolbar"]').click(); await expect(page.locator('#formatting-toolbar')).toBeVisible();
    await page.locator('[data-action="formatting-toolbar"]').click(); await expect(page.locator('#formatting-toolbar')).toBeHidden();
    for (const [button, panel] of [['#sidebar-toggle', '#document-sidebar'], ['#context-sidebar-toggle', '#context-sidebar']]) {
      await page.locator(button).click(); await expect(page.locator(panel)).toBeHidden(); await expect(page.locator(button)).toHaveAttribute('aria-expanded', 'false');
      await page.locator(button).click(); await expect(page.locator(panel)).toBeVisible(); await expect(page.locator(button)).toHaveAttribute('aria-expanded', 'true');
    }
    await page.locator('#file-menu-button').focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('#file-menu [data-action="vault-open"]')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(page.locator('#file-menu [data-action="open"]')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#file-menu')).not.toHaveAttribute('open', ''); await expect(page.locator('#file-menu-button')).toBeFocused();
    await page.locator('#file-menu-button').click(); await page.locator('#file-menu [data-action="about"]').click();
    await expect(page.locator('#about-dialog')).toBeVisible(); await expect(page.locator('#file-menu')).not.toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await page.locator('[data-context-tab="mentions"]').click(); await expect(page.locator('[data-context-tab="mentions"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-context-tab="backlinks"]').click();
    await page.locator('[data-activity-id="workspace-home:home-view"]').click();
    await expect(page.locator('#plugin-stage')).toBeVisible();
    await page.locator('[data-activity-id="core-navigation:vault-view"]').click();
    await expect(page.locator('#plugin-stage')).toBeHidden();
    await expect(page.locator('#editor-stage')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'compact-workspace.png') });
    return geometry;
  });
  if (uxOnly) {
    await check('ux viewport shell and compact palettes remain usable across views', async () => {
      await page.locator('[data-activity-id="research-desk:research-view"]').click();
      await page.waitForSelector('#research-desk[data-ready="true"]');
      await expect(page.locator('.research-empty h3')).toHaveText('暂无研究资料');
      await page.screenshot({ path: path.join(output, 'ux-research-empty.png') });
      await page.locator('#research-empty-action').click();
      await expect(page.locator('#research-title')).toBeFocused();
      const fixtureTitle = 'UX layout fixture - long research title for responsive source navigation and citations';
      await page.locator('#research-title').fill(fixtureTitle);
      await page.locator('#research-author').fill('Isolated layout verification author');
      await page.locator('#research-year').fill('2026');
      await page.locator('#research-save').click();
      await expect(page.locator('#research-list')).toContainText(fixtureTitle);
      const originalNotes = await readNotes();
      const reviewed = [];
      const views = [
        ['workspace-home:home-view', 'home'], ['research-desk:research-view', 'research'],
        ['ai-assistant:ai-view', 'ai'], ['note-views:database-view', 'database'],
        ['knowledge-graph:global-view', 'graph'], ['whiteboard:whiteboard-view', 'whiteboard'],
        ['unlinked-notes:note-list', ''],
      ];
      for (const family of ['clear', 'dark']) {
        for (const width of [1440, 1280, 960, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.locator('#settings-button').click();
          const appearance = page.locator('[data-settings-group="appearance"]');
          if (!await appearance.evaluate(node => node.open)) await appearance.locator(':scope > summary').click();
          await page.locator('#interface-family-input').selectOption(family);
          if (family === 'dark') {
            await expect(page.locator('#settings-dialog')).toHaveAttribute('data-ui-mode', 'dark');
            await expect(page.locator('.rich-pane')).toHaveAttribute('data-paper-mode', 'dark');
          }
          const themeEvidence = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d');
            const color = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
            const luminance = channels => channels.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
            const contrast = (foreground, background) => { const first = luminance(color(foreground)); const second = luminance(color(background)); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
            const dialog = getComputedStyle(document.querySelector('#settings-dialog'));
            const input = getComputedStyle(document.querySelector('#interface-family-input'));
            const reader = getComputedStyle(document.querySelector('.rich-pane'));
            const foreground = getComputedStyle(document.querySelector('.ProseMirror'));
            const app = getComputedStyle(document.querySelector('#app'));
            return { dialogContrast: contrast(dialog.color, dialog.backgroundColor), inputContrast: contrast(input.color, input.backgroundColor), readerContrast: contrast(foreground.color, reader.backgroundColor), dialogLight: luminance(color(dialog.backgroundColor)), readerLight: luminance(color(reader.backgroundColor)), alpha: color(app.getPropertyValue('--glass-surface'))[3], validGlassColor: CSS.supports('color', app.getPropertyValue('--glass-control')), colorScheme: dialog.colorScheme };
          });
          assert.ok(themeEvidence.dialogContrast >= 4.5 && themeEvidence.inputContrast >= 4.5 && themeEvidence.readerContrast >= 4.5, JSON.stringify({ width, family, themeEvidence }));
          assert.ok(themeEvidence.validGlassColor && themeEvidence.alpha > 0 && themeEvidence.alpha < 250, JSON.stringify({ family, themeEvidence }));
          assert.equal(themeEvidence.colorScheme, family === 'dark' ? 'dark' : 'light');
          assert.ok(family === 'dark' ? themeEvidence.dialogLight < .15 && themeEvidence.readerLight < .15 : themeEvidence.dialogLight > .65 && themeEvidence.readerLight > .65, JSON.stringify({ family, themeEvidence }));
          const swatches = await page.locator('#settings-dialog .theme-option:visible, #settings-dialog .interface-theme:visible').evaluateAll(nodes => nodes.map(node => {
            const bounds = node.getBoundingClientRect();
            const swatch = node.querySelector('span').getBoundingClientRect();
            return { name: node.textContent.trim(), height: bounds.height, width: bounds.width, scroll: node.scrollWidth, client: node.clientWidth, swatchWidth: swatch.width, swatchHeight: swatch.height };
          }));
          assert.ok(swatches.length > 5);
          assert.ok(swatches.every(item => item.height <= 48 && item.swatchWidth === 16 && item.swatchHeight === 16 && item.scroll <= item.client + 1), JSON.stringify({ width, swatches }));
          const settingsBounds = await page.locator('#settings-dialog .settings-content').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
          assert.ok(settingsBounds.scroll <= settingsBounds.width + 1, JSON.stringify({ width, settingsBounds }));
          const categoryBounds = await page.locator('#settings-dialog .settings-group').evaluateAll(groups => groups.map(group => ({ key: group.dataset.settingsGroup, height: group.getBoundingClientRect().height, summaryHeight: group.querySelector('summary').getBoundingClientRect().height })));
          assert.ok(categoryBounds.every(group => group.summaryHeight >= 32 && group.height >= group.summaryHeight), JSON.stringify({ width, categoryBounds }));
          await page.locator('#source-family-input').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `ux-compact-settings-${width}-${family}.png`) });
          await page.locator('#settings-dialog .dialog-footer button').click();
          for (const [viewId, target] of views) {
            await page.locator(`[data-activity-id="${viewId}"]`).click();
            await expect(page.locator('#plugin-stage')).toBeVisible();
            await expect(page.locator('#app')).toHaveAttribute('data-workspace-view', target);
            if (target === 'research') await page.waitForSelector('#research-desk[data-ready="true"]');
            if (target === 'home') await page.waitForSelector('#workspace-home[data-ready="true"]');
            if (target === 'ai') await page.waitForSelector('#ai-assistant[data-ready="true"]');
            const geometry = await page.evaluate(() => {
              const bounds = selector => document.querySelector(selector).getBoundingClientRect();
              const app = bounds('#app'); const body = bounds('.app-body'); const rail = bounds('#activity-rail'); const settings = bounds('#settings-button'); const main = bounds('.main-area'); const stage = bounds('#plugin-stage');
              const surface = document.querySelector('#research-desk, #home-overview, .ai-stage-main > .ai-panel:not([hidden])');
              return { rootHeight: app.height, viewportHeight: innerHeight, rootOverflow: document.documentElement.scrollWidth - innerWidth, bodyBottom: body.bottom, railBottom: rail.bottom, settingsBottom: settings.bottom, settingsRight: settings.right, mainWidth: main.width, stageWidth: stage.width, stageHeight: stage.height, surfaceMaxWidth: surface ? getComputedStyle(surface).maxWidth : null };
            });
            assert.equal(geometry.rootHeight, geometry.viewportHeight);
            assert.ok(geometry.rootOverflow <= 1 && geometry.settingsBottom <= 900 && geometry.settingsRight <= width, JSON.stringify({ viewId, width, geometry }));
            assert.ok(Math.abs(geometry.bodyBottom - geometry.railBottom) < 2 && Math.abs(geometry.mainWidth - geometry.stageWidth) < 2 && geometry.stageHeight > 600, JSON.stringify({ viewId, width, geometry }));
            if (geometry.surfaceMaxWidth) assert.equal(geometry.surfaceMaxWidth, 'none');
            if (target === 'research') {
              const listSize = await page.locator('#research-list').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
              assert.ok(listSize.scroll <= listSize.width + 1, JSON.stringify({ width, listSize }));
              await expect(page.locator('#research-list')).toContainText(fixtureTitle);
              if (listSize.width <= 620) {
                const cells = await page.locator('#research-list tbody tr').first().evaluate(row => ({ row: row.getBoundingClientRect().width, title: row.children[0].getBoundingClientRect().width, author: row.children[2].getBoundingClientRect().width }));
                assert.ok(cells.title >= cells.row * .95 && cells.author >= cells.row * .45, JSON.stringify({ width, cells }));
              }
              await page.locator('#research-search').fill('no-such-layout-source');
              await expect(page.locator('.research-empty h3')).toHaveText('没有匹配的资料');
              await page.locator('#research-empty-action').click();
              await expect(page.locator('#research-search')).toHaveValue('');
              await expect(page.locator('#research-list')).toContainText(fixtureTitle);
            }
            await page.locator('#settings-button').click();
            await expect(page.locator('#settings-dialog')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('#settings-dialog')).toBeHidden();
            await expect(page.locator('#settings-button')).toBeFocused();
            await page.screenshot({ path: path.join(output, `ux-shell-${target || 'unlinked'}-${width}-${family}.png`) });
            reviewed.push({ viewId, width, family, geometry, themeEvidence });
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('#settings-button').click();
      await page.locator('#interface-family-input').selectOption('clear');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await page.locator('#plugin-stage .plugin-back-btn').click();
      await expect(page.locator('#editor-stage')).toBeVisible();
      assert.deepEqual(await readNotes(), originalNotes);
      return { execution: 'isolated profile; actual source creation, activity navigation, filtering, settings clicks and Escape focus return', fixtureTitle, swatchSize: 16, reviewed, baselineAfterFixture: true, noteBytesUnchanged: true };
    });
    await check('ux sidebars resize by pointer and keyboard, persist and reset', async () => {
      const evidence = [];
      for (const [handleId, panelId, delta, setting] of [
        ['sidebar-resizer', 'document-sidebar', 70, 'navigationWidth'],
        ['context-sidebar-resizer', 'context-sidebar', -60, 'contextWidth'],
      ]) {
        const handle = page.locator('#' + handleId);
        const panel = page.locator('#' + panelId);
        const before = await panel.boundingBox();
        const bounds = await handle.boundingBox();
        assert.ok(bounds && bounds.width >= 5);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 90);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + 90, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => Math.round((await panel.boundingBox()).width)).toBe(Math.round(before.width + Math.abs(delta)));
        await handle.focus(); await page.keyboard.press(handleId === 'sidebar-resizer' ? 'ArrowRight' : 'ArrowLeft');
        const after = Math.round((await panel.boundingBox()).width);
        await expect.poll(() => desktop
          ? readFile(path.join(profile, 'settings.json'), 'utf8').then(source => JSON.parse(source)[setting])
          : page.evaluate(key => JSON.parse(localStorage.getItem('inkloom.settings'))?.[key], setting)).toBe(after);
        evidence.push({ panel: panelId, before: before.width, after });
      }
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#database-button');
      for (const item of evidence) assert.equal(Math.round((await page.locator('#' + item.panel).boundingBox()).width), item.after);
      await page.screenshot({ path: path.join(output, 'ux-resizable-columns.png') });
      for (const id of ['sidebar-resizer', 'context-sidebar-resizer']) { await page.locator('#' + id).focus(); await page.keyboard.press('Home'); }
      return { execution: 'real pointer drag, keyboard and reload in isolated profile', widths: evidence };
    });
    await check('ux eight-level folders wrap names and AI navigation aligns', async () => {
      const relativePath = 'Research/Systems/Design/Architecture/Notes/Reviewed/2026/October/Deep hierarchy long document title.md';
      const fixture = { id: 'ux-deep-note', name: 'Deep hierarchy long document title.md', relativePath, path: relativePath, source: '# Deep hierarchy long document title\n\nNested folder acceptance.\n', starred: false };
      if (desktop) {
        const target = path.join(profile, 'StarterVault', relativePath);
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, fixture.source);
        await page.getByRole('button', { name: '刷新知识库', exact: true }).click();
      } else {
        await page.evaluate(fixture => { const key = 'inkloom.vault.notes.v1'; const vault = JSON.parse(localStorage.getItem(key)); vault.notes.push(fixture); localStorage.setItem(key, JSON.stringify(vault)); }, fixture);
        await page.reload(); await page.waitForSelector('#database-button');
      }
      await page.locator('#vault-filter-input').fill('Deep hierarchy');
      const row = page.locator('#vault-tree-list [title="' + relativePath + '"]');
      await expect(row).toHaveAttribute('aria-level', '9');
      const titleBounds = await row.locator('.vault-note-title').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, height: node.getBoundingClientRect().height, wrap: getComputedStyle(node).whiteSpace }));
      assert.equal(titleBounds.wrap, 'normal'); assert.ok(titleBounds.scroll <= titleBounds.width + 1); assert.ok(titleBounds.height > 25);
      await page.screenshot({ path: path.join(output, 'ux-deep-folders.png') });
      await page.locator('#vault-filter-input').fill('');
      await page.locator('[data-activity-id="ai-assistant:ai-view"]').click();
      await page.waitForSelector('#ai-assistant[data-ready="true"]');
      const positions = await page.locator('.ai-subnav-item > span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
      assert.ok(positions.length >= 15); assert.ok(Math.max(...positions) - Math.min(...positions) <= 1);
      await page.locator('[data-ai-tab="compiler"]').click();
      await page.locator('[data-compiler-view="rules"]').click();
      const boxes = await page.locator('#ai-compiler-rules-bar input').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      assert.ok(boxes.every(box => box.width >= 14 && box.width <= 18 && box.height <= 18));
      await page.screenshot({ path: path.join(output, 'ux-compiler-rules.png') });
      return { nestedFolders: 8, noteLevel: 9, titleBounds, alignedNavigation: positions.length, checkboxes: boxes };
    });
    await check('ux home overview keeps full panels accessible and fits small viewports', async () => {
      await page.locator('[data-activity-id="workspace-home:home-view"]').click();
      await page.waitForSelector('#workspace-home[data-ready="true"]');
      await expect(page.locator('#home-overview')).toBeVisible();
      await expect(page.locator('.home-grid')).toBeHidden();
      await expect(page.locator('#home-activity-grid button')).toHaveCount(90);
      await page.locator('[data-activity-days="30"]').click();
      await expect(page.locator('#home-activity-grid button')).toHaveCount(30);
      await expect(page.locator('#home-recent-list .home-overview-note').first()).toBeVisible();
      await page.screenshot({ path: path.join(output, 'ux-home-desktop.png') });
      await page.locator('#home-panels-tab').click();
      await expect(page.locator('.home-grid')).toBeVisible();
      await expect(page.locator('.home-grid .grid-stack-item')).toHaveCount(6);
      await page.locator('.home-widget-menu summary').click(); await page.locator('[data-home-widget="capture"]').uncheck(); await page.locator('.home-widget-menu summary').click();
      await page.locator('#home-overview-tab').click(); await page.locator('#home-overview-capture').click();
      await expect(page.locator('#capture-title')).toBeVisible(); await expect(page.locator('#capture-title')).toBeFocused();
      await page.locator('#home-overview-tab').click();
      const sizes = [];
      if (!desktop) for (const width of [1280, 960, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.locator('#home-overview').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(geometry.scroll <= geometry.width + 1); assert.ok(geometry.pageWidth <= geometry.viewport + 1); sizes.push(geometry);
        await page.screenshot({ path: path.join(output, 'ux-home-' + width + '.png') });
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      return { defaultOverview: true, calendarCells: 30, retainedWidgets: 6, sizes };
    });
    await check('ux migration is a secondary tool with explicit source and staged confirmation', async () => {
      await expect(page.locator('#vault-onenote-import-btn')).toHaveCount(0);
      await page.locator('#special-tools-menu > summary').click();
      await page.locator('#special-tools-menu [data-action="onenote-import"]').click();
      await expect(page.locator('#onenote-source-step')).toBeVisible();
      await expect(page.locator('#onenote-pages-step')).toBeHidden();
      await expect(page.locator('#onenote-com-provider-badge')).toHaveText('未连接');
      await expect(page.locator('#onenote-hierarchy-tree .onenote-tree-page-row')).toHaveCount(0);
      await page.screenshot({ path: path.join(output, 'ux-migration-source.png') });
      if (!desktop) {
        await page.locator('#onenote-com-scan-btn').click();
        await expect(page.locator('#onenote-com-provider-badge')).toHaveText('未连接');
        await expect(page.locator('#onenote-com-status')).toContainText('浏览器无法连接');
      }
      const fixture = '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" name="UX import fixture"><one:Outline><one:Position x="36" y="80" z="0"/><one:OEChildren><one:OE><one:T><![CDATA[Isolated migration acceptance content.]]></one:T></one:OE></one:OEChildren></one:Outline><one:InkDrawing><one:Position x="40" y="180" z="0"/><one:Size width="160" height="60"/><one:Stroke points="10,15 45,35 90,20 140,45" color="#0d6b58" width="2.4"/></one:InkDrawing></one:Page>';
      await page.locator('#onenote-com-file-input').setInputFiles({ name: 'ux-import-fixture.xml', mimeType: 'application/xml', buffer: Buffer.from(fixture) });
      await expect(page.locator('#onenote-pages-step')).toBeVisible();
      await expect(page.locator('#onenote-review-step')).toBeHidden();
      await page.locator('#onenote-step-next').click();
      await expect(page.locator('#onenote-review-step')).toBeVisible();
      await expect(page.locator('#onenote-com-stats-grid')).toContainText('已选 1 页');
      await expect(page.locator('#onenote-com-stats-grid')).toContainText('含手写墨迹 1 处 SVG');
      await expect(page.locator('#onenote-com-stats-grid')).toContainText('全保真校验通过');
      await expect(page.locator('#onenote-preview-details')).not.toHaveAttribute('open', '');
      await page.screenshot({ path: path.join(output, 'ux-migration-review.png') });
      await page.locator('#onenote-preview-details > summary').click();
      await expect(page.locator('#onenote-com-preview')).toContainText('Isolated migration acceptance');
      if (desktop) {
        await page.locator('#onenote-com-commit-btn').click();
        await expect(page.locator('#onenote-com-status')).toContainText('已成功迁入 1 篇');
        assert.ok((await readNotes()).some(note => note.source.includes('Isolated migration acceptance content.')));
      } else await expect(page.locator('#onenote-com-commit-btn')).toBeDisabled();
      if (!desktop) {
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await page.locator('#onenote-com-dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
        assert.ok(bounds.scroll <= bounds.width + 1);
        await page.screenshot({ path: path.join(output, 'ux-migration-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 960 });
      }
      await page.locator('#onenote-com-close').click();
      return { execution: 'explicit XML fixture in isolated profile; no live OneNote scan', defaultDisconnected: true, stagedReview: true, nativeTextWriteReadBack: desktop, liveComVerified: false };
    });
    await check('ux Obsidian palette import previews, applies and leaves note bytes unchanged', async () => {
      const before = await readNotes();
      await page.locator('#settings-button').click();
      const group = page.locator('[data-settings-group="appearance"]');
      if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
      await page.locator('#appearance-manager > summary').click();
      await page.locator('#appearance-obsidian-section > summary').click();
      await page.locator('#appearance-obsidian-files').setInputFiles([
        { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'UX Obsidian Palette', author: 'Test fixture' })) },
        { name: 'theme.css', mimeType: 'text/css', buffer: Buffer.from('.theme-light { --interactive-accent: #356a58; } .theme-dark { --interactive-accent: #b6daca; } .workspace-leaf { display:none; }') },
      ]);
      await expect(page.locator('#appearance-obsidian-report')).toContainText('仅适配配色');
      await expect(page.locator('#appearance-status')).toContainText('尚未应用');
      await page.locator('#appearance-apply').click();
      await expect(page.locator('#appearance-status')).toHaveText('已应用');
      assert.equal(await page.locator('#app').evaluate(node => getComputedStyle(node).getPropertyValue('--ui-accent').trim()), '#356a58');
      await page.locator('#appearance-variant').selectOption('dark'); await page.locator('#appearance-apply').click();
      await expect(page.locator('#app')).toHaveAttribute('data-workspace-mode', 'dark');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await page.screenshot({ path: path.join(output, 'ux-home-dark.png') });
      assert.deepEqual(await readNotes(), before);
      await page.locator('#settings-button').click(); await page.locator('#appearance-reset').click();
      await page.locator('#settings-dialog .dialog-footer button').click();
      return { compatibility: 'color-variables-only', previewAndApply: true, darkMode: true, originalNotesUnchanged: true };
    });
    await check('ux opened tabs reorder and reference pane changes side without losing the editor', async () => {
      await page.locator('#active-file-dewdrop').click();
      await expect(page.locator('#editor-stage')).toBeVisible();
      assert.ok((await page.locator('#workspace').boundingBox()).height > 300);
      await openFromSearch('双链笔记与卡片盒方法');
      await openFromSearch('YAML属性与标签体系');
      const tabs = page.locator('#dewdrop-sibling-tabs [data-tab-note-id]');
      await expect(tabs).toHaveCount(2);
      const firstId = await tabs.first().getAttribute('data-tab-note-id');
      const secondId = await tabs.nth(1).getAttribute('data-tab-note-id');
      await tabs.nth(1).dragTo(tabs.first());
      await expect.poll(async () => page.locator('#dewdrop-sibling-tabs [data-tab-note-id]').first().getAttribute('data-tab-note-id')).toBe(secondId);
      await page.locator('#pin-reference-button').click();
      const reference = page.locator('#reference-pane'); await expect(reference).toBeVisible();
      await page.locator('#reference-side-btn').click(); await expect(reference).toHaveAttribute('data-side', 'left');
      assert.ok((await reference.boundingBox()).x < (await page.locator('#workspace').boundingBox()).x);
      await page.screenshot({ path: path.join(output, 'ux-reference-left.png') });
      await page.locator('#reference-side-btn').click(); await expect(reference).toHaveAttribute('data-side', 'right');
      await page.locator('#reference-close-btn').click();
      await expect(page.locator('#rich-editor')).toBeVisible();
      const closedId = await page.locator('#active-file-dewdrop').getAttribute('data-tab-note-id');
      await page.locator('#active-dewdrop-close').click();
      await expect(page.locator('[data-tab-note-id="' + closedId + '"]')).toHaveCount(0);
      return { execution: 'real HTML drag-and-drop', reordered: [secondId, firstId], referenceSides: ['left', 'right'], editorRetained: true, tabActuallyClosed: true, nativeWindowDocking: false };
    });
    await check('ux all intelligence panels remain reachable without horizontal overflow', async () => {
      await page.locator('[data-activity-id="ai-assistant:ai-view"]').click();
      const names = await page.locator('[data-ai-tab]').evaluateAll(buttons => buttons.map(button => button.dataset.aiTab));
      assert.equal(names.length, 15);
      const reviewed = [];
      const layoutIssues = [];
      for (const variant of ['light', 'dark']) {
        await page.locator('#settings-button').click();
        const appearanceGroup = page.locator('[data-settings-group="appearance"]');
        if (await appearanceGroup.getAttribute('open') === null) await appearanceGroup.locator(':scope > summary').click();
        if (!await page.locator('#appearance-manager').evaluate(node => node.open)) await page.locator('#appearance-manager > summary').click();
        await page.locator('#appearance-theme').selectOption({ index: 1 });
        await page.locator('#appearance-variant').selectOption(variant); await page.locator('#appearance-apply').click();
        await expect(page.locator('#app')).toHaveAttribute('data-workspace-mode', variant);
        await page.locator('#settings-dialog .dialog-footer button').click();
      for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 900 }, { width: 960, height: 800 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const name of names) {
          if (viewport.width <= 760) await page.locator('#ai-mobile-navigation').selectOption(name);
          else await page.locator(`[data-ai-tab="${name}"]`).click();
          const panel = page.locator(`#ai-panel-${name}`); await expect(panel).toBeVisible();
          const contrastIssues = await page.locator(`#ai-panel-${name} :is(.primary-command, .obs-primary-btn):not(:disabled), #activity-rail .activity-button[aria-pressed="true"]`).evaluateAll(buttons => {
            const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const context = canvas.getContext('2d');
            const color = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
            const luminance = channels => channels.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
            return buttons.filter(button => button.getBoundingClientRect().width > 0).flatMap(button => {
              const background = color(getComputedStyle(button).backgroundColor); if (background[3] < 250) return [];
              const foreground = color(getComputedStyle(button.querySelector('span') || button).color);
              const light = luminance(background); const dark = luminance(foreground); const ratio = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
              return ratio < 4.5 ? [{ id: button.id, contrast: Math.round(ratio * 100) / 100 }] : [];
            });
          });
          const size = await panel.evaluate(node => {
            const bounds = node.getBoundingClientRect();
            const offenders = [...node.querySelectorAll('*')].filter(child => { const rect = child.getBoundingClientRect(); const style = getComputedStyle(child); return rect.width && style.visibility !== 'hidden' && rect.right > bounds.right + 2; }).slice(0, 8).map(child => ({ element: child.tagName, id: child.id, className: child.className, width: Math.round(child.getBoundingClientRect().width) }));
            return { width: node.clientWidth, overflow: node.scrollWidth - node.clientWidth, rootOverflow: document.documentElement.scrollWidth - innerWidth, offenders };
          });
          if (name === 'flashcards') {
            const labels = await panel.locator('.ai-sr-forecast-label').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, width: node.clientWidth, scroll: node.scrollWidth })));
            assert.ok(labels.every(label => label.scroll <= label.width + 1), JSON.stringify({ viewport, variant, labels }));
          }
          if (size.width < 280 || size.overflow > 2 || size.rootOverflow > 2 || contrastIssues.length) layoutIssues.push({ panel: name, viewport: viewport.width, variant, ...size, contrastIssues });
          reviewed.push({ panel: name, viewport: viewport.width, variant, ...size });
          await page.screenshot({ path: path.join(output, `ux-panel-${name}-${viewport.width}-${variant}.png`) });
        }
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      }
      await page.locator('#settings-button').click(); await page.locator('#appearance-reset').click(); await page.locator('#settings-dialog .dialog-footer button').click();
      assert.deepEqual(layoutIssues, [], JSON.stringify(layoutIssues));
      return { reviewed, providerRequestsAttempted: false, scope: 'layout and navigation; model quality is not certified by this check' };
    });
    await check('ux graph exposes source evidence and nested note creation uses the chosen directory', async () => {
      await page.locator('#global-graph-button').click();
      await expect(page.locator('.graph-hub-chip').first()).toBeVisible(); await page.locator('.graph-hub-chip').first().click();
      await page.locator('#global-graph-evidence summary').click();
      await expect(page.locator('[data-graph-confidence="EXTRACTED"]').first()).toBeVisible();
      await expect(page.locator('[data-graph-evidence-source]').first()).toContainText('行');
      await page.locator('#graph-pathfinder-menu-trigger').click();
      await page.locator('#graph-path-find').click();
      await expect(page.locator('#graph-path-evidence-details')).toBeVisible();
      await page.locator('#graph-path-evidence-details > summary').click();
      await expect(page.locator('#graph-path-evidence-details [data-path-evidence-source]').first()).toBeVisible();
      await page.locator('#graph-pathfinder-menu-trigger').click();
      await page.locator('#graph-project-whiteboard-btn').click();
      await expect(page.locator('#global-graph-stats')).toContainText('投射保存为空间白板');
      await page.screenshot({ path: path.join(output, 'ux-graph-evidence.png') });
      await page.locator('[data-graph-evidence-source]').first().click(); await expect(page.locator('#rich-editor')).toBeVisible();
      await page.locator('[data-action="vault-new-note"]').click();
      assert.equal(await page.locator('#block-input').evaluate(el => el.tagName), 'INPUT');
      await expect(page.locator('#new-note-folder-picker')).toBeVisible();
      await page.screenshot({ path: path.join(output, 'ux-new-note-dialog.png') });
      await page.locator('#block-input').fill('UX nested creation'); await page.locator('#new-note-folder').fill('Research/Systems/Design/Architecture/Notes/Reviewed/2026/October');
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).not.toBeVisible();
      const relativePath = 'Research/Systems/Design/Architecture/Notes/Reviewed/2026/October/UX nested creation.md';
      await page.locator('#vault-filter-input').fill('UX nested creation');
      await expect(page.locator('#vault-tree-list [title="' + relativePath + '"]')).toHaveAttribute('aria-level', '9');
      if (desktop) assert.ok((await readFile(path.join(profile, 'StarterVault', relativePath), 'utf8')).includes('UX nested creation'));
      else assert.ok(await page.evaluate(relativePath => JSON.parse(localStorage.getItem('inkloom.vault.notes.v1')).notes.some(note => note.relativePath === relativePath), relativePath));
      await page.locator('#vault-filter-input').fill('');

      // Verify tree right-click: create folder, create note in folder, reveal in explorer, and delete note with reference cleanup
      const journalsFolderRow = page.locator('#vault-tree-list [data-vault-folder="journals"]');
      await journalsFolderRow.click({ button: 'right' });
      await expect(page.locator('#vault-tree-context-menu')).toBeVisible();
      await page.screenshot({ path: path.join(output, 'ux-tree-context-menu.png') });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="new-folder"]').click();
      await expect(page.locator('#edit-dialog')).toBeVisible();
      await page.locator('#block-input').fill('journals/2026-Q4');
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).toBeHidden();
      const subFolderRow = page.locator('#vault-tree-list [data-vault-folder="journals/2026-Q4"]');
      await expect(subFolderRow).toBeVisible();

      await subFolderRow.click({ button: 'right' });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="new-note"]').click();
      await expect(page.locator('#new-note-folder')).toHaveValue('journals/2026-Q4');
      await page.locator('#block-input').fill('UX Context Linked Note');
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).toBeHidden();

      // Create another note that links to UX Context Linked Note, then delete UX Context Linked Note and verify reference cleanup
      await subFolderRow.click({ button: 'right' });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="new-note"]').click();
      await page.locator('#block-input').fill('UX Referencing Caller');
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).toBeHidden();
      if (!await page.locator('#source-editor .cm-content').isVisible()) await page.locator('[data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\n关联引用：[[UX Context Linked Note]]\n');
      await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await readNotes()).find(n => n.relativePath === 'journals/2026-Q4/UX Referencing Caller.md')?.source || '').toContain('[[UX Context Linked Note]]');

      const targetNoteRow = page.locator('#vault-tree-list [title="journals/2026-Q4/UX Context Linked Note.md"]');
      await targetNoteRow.click({ button: 'right' });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="reveal"]').click();
      await expect(page.locator('#toast')).toContainText('定位');

      // Verify right-click Move Note to another multi-level folder
      const callerNoteRow = page.locator('#vault-tree-list [title="journals/2026-Q4/UX Referencing Caller.md"]');
      await callerNoteRow.click({ button: 'right' });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="move-note"]').click();
      await expect(page.locator('#edit-dialog')).toBeVisible();
      await expect(page.locator('#move-note-folder-picker')).toBeVisible();
      await page.locator('#move-note-folder-input').fill('journals/2026-Q4/Archive');
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).toBeHidden();
      await expect(page.locator('#vault-tree-list [title="journals/2026-Q4/Archive/UX Referencing Caller.md"]')).toBeVisible();

      await targetNoteRow.click({ button: 'right' });
      await page.locator('#vault-tree-context-menu [data-tree-cmd="delete-note"]').click();
      await expect(page.locator('#edit-dialog')).toBeVisible();
      await expect(page.locator('#delete-reference-summary')).toContainText('UX Referencing Caller');
      await page.screenshot({ path: path.join(output, 'ux-delete-note-dialog.png') });
      await page.locator('#edit-dialog [type="submit"]').click();
      await expect(page.locator('#edit-dialog')).toBeHidden();
      await expect(targetNoteRow).toHaveCount(0);
      await expect.poll(async () => {
        const caller = (await readNotes()).find(n => n.relativePath === 'journals/2026-Q4/Archive/UX Referencing Caller.md');
        return caller && !caller.source.includes('[[UX Context Linked Note]]');
      }).toBe(true);

      // Verify Karpathy raw/ -> wiki/ multi-format DOCX ingestion, Lint interactive repair, and Query -> Wiki filing
      await page.locator('[data-activity-id="ai-assistant:ai-view"]').click();
      await page.locator('[data-ai-tab="compiler"]').click();
      await expect(page.locator('#ai-compiler-raw-list .compiler-raw-card').first()).toBeVisible();
      const docxBytes = buildSampleOfficeFileBytes('docx', '供应链有限产能排产规范');
      await page.locator('#ai-compiler-raw-file-input').setInputFiles({
        name: '供应链有限产能排产规范.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(docxBytes),
      });
      await expect(page.locator('#ai-compiler-raw-list [data-raw-path="raw/供应链有限产能排产规范.docx"]')).toBeVisible();
      await page.locator('[data-compiler-preview-mode="raw-extracted"]').click();
      await expect(page.locator('#ai-compiler-preview')).toContainText('有限产能排产');
      await page.locator('[data-compiler-preview-mode="raw-source"]').click();
      await expect(page.locator('#ai-compiler-preview')).toContainText('raw/供应链有限产能排产规范.docx');
      await page.screenshot({ path: path.join(output, 'ux-karpathy-raw-docx.png') });
      await page.locator('#ai-compiler-ingest-raw-btn').click();
      await expect(page.locator('#ai-compiler-status')).toContainText('wiki/sources/供应链有限产能排产规范.md');
      await expect.poll(async () => (await readNotes()).some(n => n.relativePath === 'wiki/sources/供应链有限产能排产规范.md')).toBe(true);

      // MAJOR-200 (2.0.0): Menu-hidden Multimodal Offline OCR Ingest & Table Reconstruction
      await page.locator('#ai-compiler-raw-menu-trigger').click();
      await page.locator('#ai-compiler-ocr-sample-btn').click();
      await expect(page.locator('#ai-compiler-status')).toContainText('离线 OCR 引擎解析');
      await expect(page.locator('#ai-compiler-preview')).toContainText('视觉检测工站');
      await expect(page.locator('#ai-compiler-preview')).toContainText('99.4%');

      // Verify Lint interactive tension resolution into wiki/
      await page.locator('[data-compiler-view="lint"]').click();
      await expect(page.locator('#ai-compiler-lint-pane')).toBeVisible();
      const resolveTensionBtn = page.locator('[data-resolve-tension]').first();
      await expect(resolveTensionBtn).toBeVisible();
      await resolveTensionBtn.click();
      await expect(page.locator('#ai-compiler-status')).toContainText('正反边界辨析节写入 wiki/');

      // Verify Query -> Wiki filing (Wiki-First retrieval + crystallize to wiki/ with index.md/log.md update)
      await page.locator('[data-ai-tab="chat"]').click();
      await page.locator('#ai-search-mode').selectOption('wiki-first');
      await page.locator('#ai-question-input').fill('有限产能排产与双链笔记');
      await page.locator('#ai-ask-submit').click();
      await expect(page.locator('#ai-crystallize-bar')).toBeVisible({ timeout: 15000 });
      await page.locator('#ai-crystallize-target').selectOption('wiki');
      await page.locator('#ai-crystallize-title').fill('Wiki · 有限产能排产与双链协同');
      await page.locator('#ai-crystallize-save-btn').click();
      await expect(page.locator('#ai-crystallize-status')).toContainText('存入 wiki/ 目录');
      await expect.poll(async () => (await readNotes()).some(n => n.relativePath === 'wiki/有限产能排产与双链协同.md')).toBe(true);

      // Verify 1.7.1 & 1.8.0 (MAJOR-180) Research Desk PDF/EPUB Native Layout Canvas, Spread View, Box-Selection Annotation & Minimalist Menu
      await page.locator('[data-activity-id="research-desk:research-view"]').click();
      await page.waitForSelector('#research-desk[data-ready="true"]');
      await page.locator('[data-research-mode="reader"]').click();
      await expect(page.locator('#research-reader-stage')).toBeVisible();
      await page.locator('#reader-tools-menu-trigger').click();
      await page.locator('#reader-sample-pdf-btn').click();
      await expect(page.locator('#reader-paper')).toHaveAttribute('data-reader-path', 'raw/智能制造与双链溯源规范.pdf');
      await expect(page.locator('#reader-current-locator')).toHaveText('Page 1');
      await expect(page.locator('#reader-canvas-stage')).toBeVisible();
      await expect(page.locator('#reader-pdf-canvas-primary')).toBeVisible();
      await page.locator('#reader-tools-menu-trigger').click();
      await page.locator('#reader-spread-toggle').click();
      await expect(page.locator('#reader-paper')).toHaveAttribute('data-reader-spread', 'true');
      await expect(page.locator('#reader-canvas-stage .reader-page-sheet')).toHaveCount(2);
      await page.locator('#reader-tools-menu-trigger').click();
      await page.locator('#reader-spread-toggle').click();
      await expect(page.locator('#reader-paper')).toHaveAttribute('data-reader-spread', 'false');
      await page.locator('#reader-next-btn').click();
      await expect(page.locator('#reader-current-locator')).toHaveText('Page 2');
      await page.locator('#reader-page-overlay-primary .reader-layout-block.is-paragraph').first().click();
      await expect(page.locator('#reader-bbox-preview-badge')).toBeVisible();
      await expect(page.locator('#reader-bbox-preview-img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
      await page.locator('#reader-excerpt-annotation').fill('第二页画布框选区域实机溯源批注');
      await page.screenshot({ path: path.join(output, 'ux-research-reader-pdf.png') });
      await page.locator('#reader-save-excerpt').click();
      await expect(page.locator('#reader-excerpt-status')).toContainText('excerpts/');
      await expect(page.locator('#reader-page-overlay-primary .reader-bbox-highlight').first()).toBeVisible();
      await page.locator('#reader-tools-menu-trigger').click();
      await page.locator('#reader-sample-epub-btn').click();
      await expect(page.locator('#reader-paper')).toHaveAttribute('data-reader-path', 'raw/卡片盒与知识图谱精读.epub');
      await expect(page.locator('#reader-current-locator')).toHaveText('epubcfi(/6/2!/4/2/1:0)');
      await page.locator('#reader-next-btn').click();
      await expect(page.locator('#reader-current-locator')).toHaveText('epubcfi(/6/4!/4/2/1:0)');
      await page.screenshot({ path: path.join(output, 'ux-research-reader-epub.png') });
      await page.locator('[data-research-mode="excerpt"]').click();
      await expect(page.locator('[data-open-reader-source]').first()).toBeVisible();
      await page.locator('[data-open-reader-source]').first().click();
      await expect(page.locator('#reader-paper')).toHaveAttribute('data-reader-path', 'raw/智能制造与双链溯源规范.pdf');
      await expect(page.locator('#reader-current-locator')).toHaveText('Page 2');
      await expect(page.locator('#reader-page-overlay-primary .reader-bbox-highlight.is-focused').first()).toBeVisible();

      // ITER-174 (1.7.4): Split-pane PDF/EPUB reader in #reference-pane & verifiable #inkloom-reader?... citation insertion
      await page.locator('#reader-tools-menu-trigger').click();
      await page.locator('#reader-open-split-pane-btn').click();
      await expect(page.locator('#reference-pane')).toBeVisible();
      await expect(page.locator('#reference-reader-locator')).toHaveText('Page 2');
      await page.locator('#reference-cite-btn').click();
      await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await readNotes()).some(n => n.source.includes('[《智能制造与双链溯源规范 · 第 2 页》](<#inkloom-reader?'))).toBe(true);
      await page.screenshot({ path: path.join(output, 'ux-split-reader-citation.png') });
      await page.locator('#reference-close-btn').click();
      await expect(page.locator('#reference-pane')).toBeHidden();

      // ITER-177 (1.7.7): Ctrl+K MRU stack defaults to recently visited PDF page & note headings when query is empty
      await page.locator('#quick-switcher-trigger').click();
      await expect(page.locator('#quick-switcher-list [data-qs-mru="true"]').first()).toContainText('智能制造与双链溯源规范 · 第 2 页');
      await page.locator('#quick-switcher-list [data-qs-mru="true"][data-qs-mru-kind="raw"]').first().click();
      await expect(page.locator('#reference-pane')).toBeVisible();
      await expect(page.locator('#reference-reader-locator')).toHaveText('Page 2');
      await page.locator('#reference-close-btn').click();
      await expect(page.locator('#reference-pane')).toBeHidden();

      return {
        explicitEvidence: true,
        sourceOpened: true,
        nestedDirectoryLevels: 8,
        treeContextMenuVerified: true,
        moveNoteAcrossFoldersVerified: true,
        deleteCleanedIncomingLinks: true,
        karpathyRawDocxIngested: true,
        karpathyLintAndQueryToWikiVerified: true,
        pdfAndEpubReaderAndJumpBackVerified: true,
        splitPaneReaderCitationVerified: true,
      };
    });
  }
  if (navigationOnly || workspaceOnly) await check('navigation hierarchical folders, persistence, keyboard and ancestor-preserving search', async () => {
    const fixtures = [
      { id: 'tree-alpha', name: 'Plan.md', relativePath: 'Work/Alpha/Plan.md', path: 'Work/Alpha/Plan.md', source: '# Alpha plan\n\n#tree-test', starred: false },
      { id: 'tree-beta', name: 'Plan.md', relativePath: 'Work/Beta/Plan.md', path: 'Work/Beta/Plan.md', source: '# Beta plan', starred: false },
    ];
    if (desktop) {
      for (const fixture of fixtures) { const target = path.join(profile, 'StarterVault', fixture.relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, fixture.source); }
      await mkdir(path.join(profile, 'StarterVault', 'Work/Empty'), { recursive: true });
      await page.getByRole('button', { name: '刷新知识库', exact: true }).click();
    } else {
      await page.evaluate(fixtures => { const key = 'inkloom.vault.notes.v1'; const vault = JSON.parse(localStorage.getItem(key)); vault.notes.push(...fixtures); localStorage.setItem(key, JSON.stringify(vault)); }, fixtures);
      await page.reload(); await page.waitForSelector('#database-button');
    }
    const folder = value => page.locator('[data-vault-folder="' + value + '"]');
    await expect(folder('Work/Alpha')).toBeVisible(); await expect(folder('Work/Alpha')).toHaveAttribute('aria-level', '2');
    const alpha = page.locator('#vault-tree-list [title="Work/Alpha/Plan.md"]'); await expect(alpha).toHaveAttribute('aria-level', '3');
    if (desktop) await expect(folder('Work/Empty')).toBeVisible();
    await folder('Work').click(); await expect(folder('Work/Alpha')).toHaveCount(0);
    await page.reload(); await page.waitForSelector('#database-button'); await expect(folder('Work')).toHaveAttribute('aria-expanded', 'false');
    await folder('Work').focus(); await page.keyboard.press('ArrowRight'); await expect(folder('Work/Alpha')).toBeVisible();
    await page.keyboard.press('ArrowRight'); await expect(folder('Work/Alpha')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(folder('Work/Alpha')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowLeft'); await expect(folder('Work')).toBeFocused();
    await page.locator('#vault-filter-input').fill('Alpha'); await expect(folder('Work/Alpha')).toBeVisible(); await expect(alpha).toBeVisible(); await expect(folder('Work/Beta')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'navigation-filter.png') }); await page.locator('#vault-filter-input').fill('');
    await folder('Work/Alpha').click(); await alpha.click(); await expect(alpha).toHaveAttribute('aria-selected', 'true');
    const geometry = await alpha.evaluate(node => ({ depth: getComputedStyle(node).getPropertyValue('--tree-depth'), guide: getComputedStyle(node, '::before').backgroundImage, height: node.getBoundingClientRect().height }));
    assert.ok(geometry.guide.includes('repeating-linear-gradient')); assert.equal(geometry.depth.trim(), '2'); assert.ok(geometry.height >= 27);
    await page.screenshot({ path: path.join(output, 'navigation-tree.png') });
    return { sameNamePaths: true, persistedCollapse: true, ancestorSearch: true, emptyFolder: desktop, geometry };
  });
  if (workspaceOnly) await check('workspace collects Markdown, restores drafts and toggles tasks with exact source preservation', async () => {
    const home = page.locator('[data-activity-id="workspace-home:home-view"]'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]'); await page.locator('#home-panels-tab').click();
    await expect(page.locator('.home-calendar .fc-daygrid')).toBeVisible(); await expect(page.locator('.home-grid .grid-stack-item')).toHaveCount(6);
    await page.locator('#capture-title').fill('Workspace memo acceptance'); await page.locator('#capture-text').fill('Durable memo body\n\n[[Plan]]');
    await expect(page.locator('#capture-draft-state')).toHaveText('草稿已保存');
    await page.reload(); await page.waitForSelector('#database-button'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    await expect(page.locator('#capture-title')).toHaveValue('Workspace memo acceptance'); await expect(page.locator('#capture-text')).toHaveValue('Durable memo body\n\n[[Plan]]');
    await page.locator('#capture-save').click(); await expect.poll(async () => (await readNotes()).filter(note => note.source.includes('title: Workspace memo acceptance')).length).toBe(1);
    await expect(page.locator('#capture-title')).toHaveValue('');
    await page.locator('#home-memo-search').fill('Durable memo body'); await expect(page.locator('#home-memo-list article')).toHaveCount(1); await page.locator('#home-memo-search').fill('');
    await expect(async () => {
      if (await page.locator('#home-memo-list article').count() > 0) {
        await page.locator('[aria-label="归档 Memo"]').click();
      }
      await expect(page.locator('#home-memo-list article')).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 8000 });
    await page.locator('#home-memo-archive').selectOption('archived'); await expect(page.locator('#home-memo-list article')).toHaveCount(1);
    await page.locator('[aria-label="恢复 Memo"]').click(); await page.locator('#home-memo-archive').selectOption('inbox'); await expect(page.locator('#home-memo-list article')).toHaveCount(1);
    const today = await page.evaluate(() => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
    await page.locator('[data-capture-kind="task"]').click(); await page.locator('#capture-title').fill('Workspace task acceptance'); await page.locator('#capture-text').fill('Keep task details unchanged'); await page.locator('#capture-due').fill(today); await page.locator('#capture-priority').selectOption('high');
    await page.locator('#capture-save').click(); await expect.poll(async () => (await readNotes()).filter(note => note.source.includes('title: Workspace task acceptance')).length).toBe(1);
    const before = (await readNotes()).find(note => note.source.includes('title: Workspace task acceptance'));
    await expect(page.locator('.home-calendar')).toContainText('Workspace task acceptance');
    const checkbox = page.getByRole('checkbox', { name: '完成 Workspace task acceptance', exact: true }); await checkbox.check();
    await expect.poll(async () => (await readNotes()).find(note => note.relativePath === before.relativePath)?.source).toContain('- [x] Workspace task acceptance');
    const after = (await readNotes()).find(note => note.relativePath === before.relativePath); assert.equal(after.source.replace('- [x] Workspace task acceptance', '- [ ] Workspace task acceptance'), before.source);
    await page.locator('#home-task-filter').selectOption('done'); await expect(checkbox).toBeChecked(); await checkbox.uncheck();
    await page.locator('#home-task-filter').selectOption('open'); await expect(checkbox).not.toBeChecked();
    await page.locator('#home-template').selectOption('focus'); await expect(page.locator('#home-status')).toHaveText('布局已保存');
    await page.locator('#home-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'workspace-desktop.png') });
    return { memo: (await readNotes()).find(note => note.source.includes('title: Workspace memo acceptance')).relativePath, taskSourcePreserved: true, memoSearchAndArchive: true, calendar: true, draftReload: true, dependencies: { gridstack: '12.3.3', fullcalendar: '6.1.19' } };
  });
  if (workspaceOnly) await check('workspace project association, templates, layout persistence and responsive controls', async () => {
    const home = page.locator('[data-activity-id="workspace-home:home-view"]');
    await page.locator('[data-capture-kind="project"]').click(); await page.locator('#capture-title').fill('Workspace project acceptance'); await page.locator('#capture-text').fill('Project objective'); await page.locator('#capture-save').click();
    await expect(page.locator('[data-widget="projects"]')).toContainText('Workspace project acceptance');
    await page.locator('[data-capture-kind="task"]').click(); await page.locator('#capture-title').fill('Linked project task'); await page.locator('#capture-project').selectOption({ label: 'Workspace project acceptance' }); await page.locator('#capture-save').click();
    await expect(page.locator('[data-widget="projects"] progress')).toHaveAttribute('max', '2');
    await page.locator('#home-project-filter').selectOption({ label: 'Workspace project acceptance' }); await expect(page.locator('#home-task-list .home-task-row')).toHaveCount(2);
    await page.locator('#home-project-filter').selectOption('');
    await page.locator('[data-capture-kind="reading"]').click(); await page.locator('#capture-title').fill('Workspace reading acceptance'); await page.locator('#capture-text').fill('Source details'); await page.locator('#capture-save').click();
    await expect.poll(async () => (await readNotes()).some(note => note.source.includes('title: Workspace reading acceptance') && note.source.includes('## 关键观点'))).toBe(true);
    await page.locator('#home-template').selectOption('writing'); await expect(page.locator('#home-status')).toHaveText('布局已保存');
    await page.locator('.home-widget-menu summary').click(); await page.locator('[data-home-widget="starred"]').uncheck(); await page.locator('.home-widget-menu summary').click();
    await expect(page.locator('[data-widget="starred"]')).toBeHidden();
    await page.reload(); await page.waitForSelector('#database-button'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    await expect(page.locator('#home-template')).toHaveValue('writing'); await expect(page.locator('[data-widget="starred"]')).toBeHidden();
    await page.locator('#home-reset').click(); await expect(page.locator('[data-widget="starred"]')).toBeVisible();
    const geometry = await page.locator('.home-grid').evaluate(grid => {
      const boxes = [...grid.querySelectorAll('.grid-stack-item:not([hidden])')].map(node => ({ id: node.dataset.widget, ...Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, node.getBoundingClientRect()[key]])) }));
      return { column: grid.gridstack.getColumn(), boxes };
    });
    for (const first of geometry.boxes) for (const second of geometry.boxes) if (first !== second) assert.ok(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1 || first.y + first.height <= second.y + 1 || second.y + second.height <= first.y + 1, first.id + ' overlaps ' + second.id);
    if (!desktop) {
      await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => page.locator('.home-grid').evaluate(grid => grid.gridstack.getColumn())).toBe(1);
      await page.locator('#home-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'workspace-mobile.png') });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      for (const selector of ['#capture-title', '#capture-text', '#capture-save']) { const box = await page.locator(selector).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391); }
      await page.setViewportSize({ width: 1440, height: 960 });
      await expect.poll(() => page.locator('.home-grid').evaluate(grid => grid.gridstack.getColumn())).toBe(12);
    }
    await page.locator('#home-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'workspace-complete.png') });
    return { projectLinkedTasks: 2, readingTemplate: true, templateReload: true, hiddenWidgetReload: true, geometry };
  });
  if (workspaceOnly) await check('workspace dirty write refusal, reminder opt-in and plugin resource cleanup', async () => {
    const home = page.locator('[data-activity-id="workspace-home:home-view"]');
    const task = (await readNotes()).find(note => note.source.includes('title: Workspace task acceptance'));
    await page.locator('#home-task-list .home-task-title').filter({ hasText: 'Workspace task acceptance' }).click();
    await expect(page.locator('#note-title-badge')).toHaveText('Workspace task acceptance'); await expect(page.locator('#editor-stage')).toBeVisible(); await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
    if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
    await expect(page.locator('#source-editor')).toBeVisible();
    await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUNSAVED_WORKSPACE_GUARD\n');
    await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    await page.getByRole('checkbox', { name: '完成 Workspace task acceptance', exact: true }).click();
    await expect(page.locator('#home-error')).toContainText('未保存'); assert.equal((await readNotes()).find(note => note.relativePath === task.relativePath).source, task.source);
    await expect(page.getByRole('checkbox', { name: '完成 Workspace task acceptance', exact: true })).not.toBeChecked();
    await home.click(); await expect(page.locator('#source-editor')).toContainText('UNSAVED_WORKSPACE_GUARD'); await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+z'); await page.locator('[data-action="save"]').click();
    await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    await page.locator('[data-capture-kind="task"]').click(); await page.locator('#capture-title').fill('Reminder acceptance');
    const today = await page.evaluate(() => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
    await page.locator('#capture-due').fill(today); await page.locator('#capture-time').fill('00:00'); await page.locator('#capture-save').click();
    await expect.poll(async () => (await readNotes()).some(note => note.source.includes('title: Reminder acceptance'))).toBe(true);
    await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.home-reminder')).toHaveCount(0);
    async function openSettings() {
      await page.locator('[data-action="settings"]').click();
      if (!await page.locator('#settings-dialog').isVisible()) await page.locator('[data-action="settings"]').click();
      await expect(page.locator('#settings-dialog')).toBeVisible();
      const group = page.locator('[data-settings-group="extensions"]');
      if (!await group.evaluate(node => node.open)) await group.locator('summary').click();
    }
    await openSettings(); await page.locator('[data-plugin-setting="workspace-home:reminders"]').check(); await page.locator('#settings-dialog .dialog-footer button').click();
    await expect(page.locator('.home-reminder')).toContainText('Reminder acceptance'); await page.locator('.home-reminder [aria-label="关闭任务提醒"]').click();
    for (let iteration = 0; iteration < 8; iteration++) { await home.click(); await expect(page.locator('#workspace-home')).toHaveCount(0); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]'); }
    await openSettings(); await page.locator('[data-plugin-id="workspace-home"]').uncheck(); await expect(home).toHaveCount(0); await expect(page.locator('#workspace-home')).toHaveCount(0);
    const stopped = await page.locator('#activity-rail').evaluate(node => JSON.parse(node.dataset.pluginDiagnostics).plugins.find(plugin => plugin.id === 'workspace-home')); assert.equal(stopped.resources, 0);
    await page.locator('[data-plugin-id="workspace-home"]').check(); await expect(home).toHaveCount(1); await page.locator('[data-plugin-setting="workspace-home:reminders"]').uncheck(); await page.locator('#settings-dialog .dialog-footer button').click();
    await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    return { dirtyWriteRejected: true, originalMarkdownUnchanged: true, reminderDefaultOff: true, reminderOptIn: true, viewCycles: 8, stoppedResources: stopped.resources };
  });
  if (workspaceOnly) await check('workspace drag resize persistence, theme rendering and failed-settings rollback', async () => {
    const home = page.locator('[data-activity-id="workspace-home:home-view"]'); await page.locator('#home-reset').click(); await page.locator('#home-summary').scrollIntoViewIfNeeded();
    await page.locator('#home-customize').click();
    const before = await page.locator('.home-grid').evaluate(grid => grid.gridstack.save(false, false, undefined, 12));
    const handle = page.locator('[data-widget="capture"] .home-drag-handle'); const handleBox = await handle.boundingBox(); const gridBox = await page.locator('.home-grid').boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down(); await page.mouse.move(gridBox.x + gridBox.width * .7, handleBox.y + 90, { steps: 12 }); await page.mouse.up();
    await expect.poll(() => page.locator('.home-grid').evaluate(grid => JSON.stringify(grid.gridstack.save(false, false, undefined, 12)))).not.toBe(JSON.stringify(before));
    await expect(page.locator('#home-status')).toHaveText('布局已保存');
    const capture = page.locator('[data-widget="capture"]'); await capture.scrollIntoViewIfNeeded(); const resize = capture.locator('.ui-resizable-se'); const resizeBox = await resize.boundingBox();
    const previousHeight = await capture.getAttribute('gs-h'); await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2); await page.mouse.down(); await page.mouse.move(resizeBox.x + 10, resizeBox.y + 90, { steps: 10 }); await page.mouse.up();
    await expect.poll(() => capture.getAttribute('gs-h')).not.toBe(previousHeight); await expect(page.locator('#home-status')).toHaveText('布局已保存');
    const saved = await page.locator('.home-grid').evaluate(grid => grid.gridstack.save(false, false, undefined, 12).map(({ id, x = 0, y = 0, w, h }) => ({ id, x, y, w, h })).sort((first, second) => first.id.localeCompare(second.id)));
    await page.reload(); await page.waitForSelector('#database-button'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    const restored = await page.locator('.home-grid').evaluate(grid => grid.gridstack.save(false, false, undefined, 12).map(({ id, x = 0, y = 0, w, h }) => ({ id, x, y, w, h })).sort((first, second) => first.id.localeCompare(second.id))); assert.deepEqual(restored, saved);
    await page.locator('#home-reset').click();
    if (!desktop) {
      await page.evaluate(() => { const original = Storage.prototype.setItem; window.__restoreWorkspaceSettings = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function(key, value) { if (String(value).includes('"pluginSettings"')) throw new DOMException('Workspace settings quota probe', 'QuotaExceededError'); return original.call(this, key, value); }; });
      await page.locator('#home-template').selectOption('focus'); await expect(page.locator('#home-error')).toContainText('quota');
      await page.evaluate(() => { window.__restoreWorkspaceSettings(); delete window.__restoreWorkspaceSettings; });
      await page.reload(); await page.waitForSelector('#database-button'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]'); await expect(page.locator('#home-template')).toHaveValue('balanced');
    }
    await page.locator('[data-action="settings"]').click();
    const appearanceGroup = page.locator('[data-settings-group="appearance"]');
    if (!await appearanceGroup.evaluate(node => node.open)) await appearanceGroup.locator(':scope > summary').click();
    await page.locator('#interface-family-input').selectOption('dark'); await page.locator('#settings-dialog .dialog-footer button').click();
    await page.locator('#home-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'workspace-dark.png') });
    await page.locator('[data-action="settings"]').click(); await page.locator('#interface-family-input').selectOption('clear'); await page.locator('#settings-dialog .dialog-footer button').click();
    await page.locator('#home-template').selectOption('writing'); await expect(page.locator('#home-status')).toHaveText('布局已保存');
    const writingLayout = await page.locator('.home-grid').evaluate(grid => grid.gridstack.save(false, false, undefined, 12).map(({ id, x = 0, y = 0, w, h }) => ({ id, x, y, w, h })).sort((first, second) => first.id.localeCompare(second.id)));
    const { createWorkspaceTemplate } = await import('../core/workspace-template.mjs');
    let templateBuffer = Buffer.from(JSON.stringify(createWorkspaceTemplate({ name: '写作研究模板', template: 'writing', layout: writingLayout, taskMode: 'board', databaseView: { viewMode: 'table', pageSize: 25, groupBy: 'project', propertyKey: 'target_words' } })));
    if (!desktop) {
      await page.evaluate(() => { window.__workspacePicker = window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
      try {
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#home-export-template').click();
        const downloaded = await downloadPromise;
        templateBuffer = await readFile(await downloaded.path());
      } finally {
        await page.evaluate(() => { window.showSaveFilePicker = window.__workspacePicker; delete window.__workspacePicker; });
      }
    }
    await page.locator('#home-reset').click(); await expect(page.locator('#home-template')).toHaveValue('balanced');
    await page.locator('#home-import-template-file').setInputFiles({ name: 'overlap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'inkloom.workspace-template', version: 1, name: 'Bad', template: 'balanced', layout: [{ id: 'capture', x: 0, y: 0, w: 6, h: 6 }, { id: 'tasks', x: 2, y: 1, w: 6, h: 6 }] })) });
    await expect(page.locator('#home-error')).toContainText('重叠');
    await page.locator('#home-import-template-file').setInputFiles({ name: 'writing.inkloom-workspace.json', mimeType: 'application/json', buffer: templateBuffer });
    await expect(page.locator('#home-status')).toContainText('已导入工作台模板');
    await expect(page.locator('#home-template')).toHaveValue('writing');
    const importedLayout = await page.locator('.home-grid').evaluate(grid => grid.gridstack.save(false, false, undefined, 12).map(({ id, x = 0, y = 0, w, h }) => ({ id, x, y, w, h })).sort((first, second) => first.id.localeCompare(second.id)));
    assert.deepEqual(importedLayout, writingLayout);
    await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toBeVisible();
    await page.locator('#database-groupBy').selectOption('project'); await page.locator('#database-propertyKey').selectOption('target_words');
    await expect(page.locator('#database-groups')).toContainText('Workspace project acceptance');
    const projectRowInput = page.locator('tr').filter({ hasText: 'Workspace project acceptance' }).locator('.database-property-input');
    await projectRowInput.fill('4500'); await projectRowInput.dispatchEvent('change');
    await expect(page.locator('#database-summary')).toContainText('target_words 合计 4500');
    await page.locator('#database-propertyKey').selectOption('rollup:project_notes');
    await expect(page.locator('tr').filter({ hasText: 'Workspace project acceptance' }).locator('.database-derived-cell')).toHaveText('3');
    await page.locator('#database-propertyKey').selectOption('formula:task_progress');
    await expect(page.locator('.database-derived-cell').first()).toContainText('%');
    await expect(page.locator('#database-saved-views-bar .database-view-tab')).toHaveCount(3);
    await page.locator('#database-view-manage-trigger').click();
    await page.locator('#database-preset-name').fill('项目任务视图');
    await page.locator('#database-save-view-btn').click();
    await expect(page.locator('#database-saved-views-bar .database-view-tab')).toHaveCount(4);
    await page.locator('#database-preset-name').fill('核心项目进度');
    await page.locator('#database-rename-view-btn').click();
    await expect(page.locator('#database-saved-views-bar')).toContainText('核心项目进度');
    await page.locator('#database-saved-views-bar [data-saved-view-id="all-notes"]').click();
    await expect(page.locator('#database-groupBy')).toHaveValue('');
    await page.locator('#database-saved-views-bar .database-view-tab').filter({ hasText: '核心项目进度' }).click();
    await expect(page.locator('#database-groupBy')).toHaveValue('project');
    await expect(page.locator('#database-propertyKey')).toHaveValue('formula:task_progress');
    await page.locator('#database-view-manage-trigger').click();
    await page.locator('#database-delete-view-btn').click();
    await expect(page.locator('#database-saved-views-bar .database-view-tab')).toHaveCount(3);
    // MAJOR-270 (2.7.0): Export Database View CSV & Batch CSV Property Sync
    await page.locator('#database-export-csv-btn').click();
    await expect(page.locator('#database-csv-status')).toContainText('已导出');
    await page.locator('#database-csv-sample-btn').click();
    await page.locator('#database-csv-apply-btn').click();
    await expect(page.locator('#database-csv-status')).toContainText('已批量同步');
    await page.locator('#database-view-manage-trigger').click();
    // ITER-177 (1.7.7): Multi-select rows in database table & batch add/remove #tag
    await page.locator('.database-row-select').nth(0).click();
    await page.locator('.database-row-select').nth(1).click();
    await expect(page.locator('#database-batch-bar')).toBeVisible();
    await expect(page.locator('#database-batch-count')).toHaveText('已选 2 篇');
    await page.locator('#database-batch-tag-input').fill('#batch-tag-ok');
    await page.locator('#database-batch-add-tag-btn').click();
    await expect(page.locator('#database-content')).toContainText('#batch-tag-ok');
    await page.locator('#database-batch-clear-btn').click();
    await expect(page.locator('#database-batch-bar')).toBeHidden();
    await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
    await page.screenshot({ path: path.join(output, 'workspace-final.png') });
    return { pointerDrag: true, pointerResize: true, persistedGeometry: saved, lightDark: true, templateRebuilt: true, multidimensionalSummary: true, formulaAndRollupColumns: true, settingsFailureRollback: !desktop };
  });
  if (planningOnly) {
    const home = page.locator('[data-activity-id="workspace-home:home-view"]');
    const today = await page.evaluate(() => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
    await check('planning task editing, board transitions, persistence and cancelled edits', async () => {
      await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
      await page.locator('#home-panels-tab').click();
      await page.locator('[data-capture-kind="task"]').click(); await page.locator('#capture-title').fill('Planning board sample'); await page.locator('#capture-text').fill('Preserved task detail'); await page.locator('#capture-due').fill(today); await page.locator('#capture-save').click();
      await expect(page.getByRole('button', { name: '编辑 Planning board sample', exact: true })).toBeVisible();
      const before = (await readNotes()).find(note => note.source.includes('title: Planning board sample'));
      await page.getByRole('button', { name: '编辑 Planning board sample', exact: true }).click(); await page.locator('#task-edit-title').fill('Cancelled title'); await page.getByRole('button', { name: '关闭任务编辑', exact: true }).click(); assert.equal((await readNotes()).find(note => note.relativePath === before.relativePath).source, before.source);
      await page.getByRole('combobox', { name: 'Planning board sample状态', exact: true }).selectOption('doing'); await expect.poll(async () => (await readNotes()).find(note => note.relativePath === before.relativePath).source).toContain('- [/] Planning board sample');
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await page.locator('[data-task-mode="board"]').click(); await expect(page.locator('[data-task-column="doing"]')).toContainText('Planning board sample');
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await page.locator('#home-task-list').evaluate(node => { window.__inkloomBoardDrop = null; node.addEventListener('drop', event => { window.__inkloomBoardDrop = event.target.closest('[data-task-column]')?.dataset.taskColumn; }, { once: true, capture: true }); });
      await page.locator('[data-task-column="doing"] .home-task-row').dragTo(page.locator('[data-task-column="done"]'), { sourcePosition: { x: 5, y: 5 }, targetPosition: { x: 20, y: 60 } });
      await expect.poll(() => page.evaluate(() => window.__inkloomBoardDrop)).toBe('done');
      await expect.poll(async () => (await readNotes()).find(note => note.relativePath === before.relativePath).source).toContain('- [x] Planning board sample');
      await page.getByRole('combobox', { name: 'Planning board sample状态', exact: true }).selectOption('todo'); await expect.poll(async () => (await readNotes()).find(note => note.relativePath === before.relativePath).source).toBe(before.source);
      await page.reload(); await page.waitForSelector('#database-button'); await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]'); await expect(page.locator('[data-task-mode="board"]')).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: path.join(output, 'task-board.png') }); return { actualDrag: true, threeStates: true, cancelledEditUnchanged: true, modeRestored: true, sourceDetailPreserved: true };
    });
    await check('planning recurrence creation, completion undo and modified-successor protection', async () => {
      await page.locator('[data-capture-kind="task"]').click(); await page.locator('#capture-title').fill('Planning repeated task'); await page.locator('#capture-due').fill(today); await page.locator('#capture-repeat').selectOption('daily'); await page.locator('#capture-save').click();
      const recurring = () => page.locator('.home-task-row').filter({ has: page.locator('.home-task-title', { hasText: 'Planning repeated task' }) });
      await expect(recurring()).toHaveCount(1); await recurring().getByRole('checkbox').check(); await expect(recurring()).toHaveCount(2);
      const completed = () => recurring().filter({ has: page.locator('input:checked') }); await completed().getByRole('checkbox').click(); await expect(recurring()).toHaveCount(1);
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await recurring().getByRole('checkbox').check(); await expect(recurring()).toHaveCount(2);
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await recurring().filter({ has: page.locator('input:not(:checked)') }).getByRole('button', { name: '编辑 Planning repeated task', exact: true }).click(); await expect(page.locator('#task-edit-dialog')).toBeVisible(); await page.locator('#task-edit-priority').selectOption('high'); await page.locator('#task-edit-save').click(); await expect(page.locator('#task-edit-dialog')).toBeHidden();
      await expect(recurring().filter({ has: page.locator('input:not(:checked)') })).toContainText('重要');
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      const beforeUndo = (await readNotes()).find(note => note.source.includes('title: Planning repeated task'));
      await completed().getByRole('checkbox').click(); await expect(page.locator('#home-error')).toContainText('下一次任务已修改'); assert.equal((await readNotes()).find(note => note.relativePath === beforeUndo.relativePath).source, beforeUndo.source);
      return { nextOccurrenceOnce: true, simpleUndo: true, modifiedSuccessorPreserved: true, source: beforeUndo.relativePath };
    });
    await check('planning calendar editing, date movement and responsive task dialog', async () => {
      await page.locator('[data-widget="calendar"]').scrollIntoViewIfNeeded(); const event = page.locator('#home-calendar .fc-event').filter({ hasText: 'Planning board sample' }); await event.click(); await expect(page.locator('#task-edit-dialog')).toBeVisible();
      await page.locator('#task-edit-time').fill('10:30'); await page.locator('#task-edit-save').click(); await expect(page.locator('#task-edit-dialog')).toBeHidden();
      await expect.poll(async () => (await readNotes()).find(note => note.source.includes('title: Planning board sample'))?.source || '').toContain('@time(10:30)');
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await expect(event).toContainText('10:30');
      const targetDay = await page.evaluate(today => { const date = new Date(today + 'T12:00:00'); date.setDate(date.getDate() === 1 || date.getDay() === 1 ? date.getDate() + 1 : date.getDate() - 1); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }, today);
      const target = page.locator('#home-calendar [data-date="' + targetDay + '"] .fc-daygrid-day-frame'); await target.scrollIntoViewIfNeeded();
      await expect(async () => {
        await event.dragTo(target);
        await expect.poll(async () => (await readNotes()).find(note => note.source.includes('title: Planning board sample'))?.source || '', { timeout: 2500 }).toContain('@due(' + targetDay + ')');
      }).toPass({ timeout: 10000 });
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await expect(async () => {
        if (!await page.locator('#task-edit-dialog').isVisible()) {
          await page.getByRole('button', { name: '编辑 Planning board sample', exact: true }).click();
        }
        await expect(page.locator('#task-edit-dialog')).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 6000 });
      if (!desktop) await page.setViewportSize({ width: 390, height: 844 });
      const box = await page.locator('#task-edit-dialog').boundingBox(); assert.ok(box.width <= (desktop ? 480 : 390)); await page.screenshot({ path: path.join(output, 'task-edit-responsive.png') }); await page.getByRole('button', { name: '关闭任务编辑', exact: true }).click();
      if (!desktop) await page.setViewportSize({ width: 1440, height: 960 });
      const beforeConflict = (await readNotes()).find(note => note.source.includes('title: Planning board sample'));
      if (desktop) await page.evaluate(() => {
        const pending = new Map(); const send = window.chrome.webview.postMessage.bind(window.chrome.webview); window.__planningNativeFailures = [];
        window.chrome.webview.postMessage = request => { pending.set(request.id, { command: request.command, documentId: request.args?.documentId }); if (pending.size > 200) pending.delete(pending.keys().next().value); send(request); };
        window.chrome.webview.addEventListener('message', event => { if (event.data.error) window.__planningNativeFailures.push({ ...pending.get(event.data.id), error: event.data.error }); pending.delete(event.data.id); });
      });
      await page.getByRole('button', { name: '编辑 Planning board sample', exact: true }).click(); await page.getByRole('button', { name: '打开任务原文', exact: true }).click();
      await expect(page.locator('#note-title-badge')).toHaveText('Planning board sample'); await expect(page.locator('#editor-stage')).toBeVisible().catch(async error => { if (desktop) error.message += '\nNative commands: ' + JSON.stringify(await page.evaluate(() => window.__planningNativeFailures)); throw error; }); await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await expect(page.locator('#source-editor')).toBeVisible();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUNSAVED_PLANNING_GUARD\n');
      await home.click(); await page.waitForSelector('#workspace-home[data-ready="true"]');
      await expect(page.locator('#home-task-list')).toHaveAttribute('aria-busy', 'false');
      await expect(async () => {
        if (!await page.locator('#task-edit-dialog').isVisible()) {
          await page.getByRole('button', { name: '编辑 Planning board sample', exact: true }).click();
        }
        await expect(page.locator('#task-edit-dialog')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
      await page.locator('#task-edit-priority').selectOption('high'); await page.locator('#task-edit-save').click(); await expect(page.locator('#task-edit-error')).toContainText('未保存');
      assert.equal((await readNotes()).find(note => note.relativePath === beforeConflict.relativePath).source, beforeConflict.source);
      await page.getByRole('button', { name: '关闭任务编辑', exact: true }).click(); await home.click(); await expect(page.locator('#source-editor')).toContainText('UNSAVED_PLANNING_GUARD');
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+z'); await page.locator('[data-action="save"]').click();
      return { calendarOpensEditor: true, timeSaved: true, pointerDateMove: true, targetDay, dialogWidth: box.width, dirtyEditorWriteRejected: true };
    });
  }
  if (creationOnly) await check('creation read-only note section and block embeds preserve source and expose missing targets', async () => {
    const fixtures = [
      { id: 'embed-root', name: 'EmbedRoot.md', relativePath: 'EmbedRoot.md', path: 'vault://EmbedRoot.md', source: '# EmbedRoot\n\n![[Research/EmbedSource#Findings]]\n\n![[Research/EmbedSource#^proof]]\n\nInline context: ![[Research/EmbedSource#^proof]] in a paragraph.\n\n![[MissingSource]]\n', starred: false },
      { id: 'embed-source', name: 'EmbedSource.md', relativePath: 'Research/EmbedSource.md', path: 'vault://Research/EmbedSource.md', source: '---\ntitle: EmbedSource\n---\n# Source\n\n## Findings\n\nVerified embedded paragraph. ^proof\n\n### Detail\n\nSupporting detail.\n\n## Later\n\nMust not appear in the selected section.\n', starred: false },
    ];
    if (desktop) { for (const fixture of fixtures) { const target = path.join(profile, 'StarterVault', fixture.relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, fixture.source); } await page.getByRole('button', { name: '刷新知识库', exact: true }).click(); }
    else { await page.evaluate(fixtures => { const key = 'inkloom.vault.notes.v1'; const vault = JSON.parse(localStorage.getItem(key)); vault.notes.push(...fixtures); localStorage.setItem(key, JSON.stringify(vault)); }, fixtures); await page.reload(); await page.waitForSelector('#database-button'); }
    await expect(page.locator('#vault-count')).toHaveText('24'); await expect(page.locator('#vault-graph-status')).toContainText('24 笔记');
    await openFromSearch('EmbedRoot');
    if (!await page.locator('#rich-editor').isVisible()) await page.locator('.view-tools [data-action="rich"]').click();
    const embeds = page.locator('#rich-editor .note-embed'); await expect(embeds).toHaveCount(4); await expect(embeds.first()).toContainText('Supporting detail.'); await expect(embeds.first()).not.toContainText('Must not appear');
    await expect(embeds.nth(1)).toContainText('Verified embedded paragraph.');
    await expect(page.locator('#rich-editor .note-embed.is-inline-embed')).toHaveCount(1);
    await expect(embeds.nth(3)).toHaveAttribute('data-embed-status', 'missing-note');
    const before = (await readNotes()).find(note => note.name === 'EmbedRoot.md').source;
    await page.locator('[data-action="save"]').click(); await expect.poll(async () => (await readNotes()).find(note => note.name === 'EmbedRoot.md')?.source).toBe(before);
    await page.screenshot({ path: path.join(output, 'embedded-sections.png') });
    await embeds.nth(1).locator('.note-embed-source').click(); await expect(page.locator('#note-title-badge')).toHaveText('EmbedSource');
    return { previews: 4, inlinePreview: true, sectionBoundary: true, blockReference: true, missingTarget: true, savedSourceUnchanged: true, openedSource: true };
  });
  if (creationOnly) await check('creation whiteboard uses a real canvas and saves editable Markdown scene data', async () => {
    await page.locator('[data-activity-id="whiteboard:whiteboard-view"]').click(); await expect(page.locator('#whiteboard-library')).toBeVisible();
    await page.locator('#whiteboard-new-title').fill('Canvas acceptance'); await page.locator('#whiteboard-create').click(); await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
    await expect(page.locator('#whiteboard-canvas-host canvas').first()).toBeVisible();
    await page.locator('label').filter({ has: page.locator('[data-testid="toolbar-rectangle"]') }).click(); const canvas = page.locator('#whiteboard-canvas-host canvas').last(); const box = await canvas.boundingBox(); assert.ok(box.width > 300 && box.height > 200);
    await page.mouse.move(box.x + box.width * .32, box.y + box.height * .35); await page.mouse.down(); await page.mouse.move(box.x + box.width * .55, box.y + box.height * .6, { steps: 10 }); await page.mouse.up();
    await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '1'); await expect(page.locator('#whiteboard-save-state')).toHaveText('未保存');
    await page.locator('#whiteboard-save').click(); await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    const file = (await readNotes()).find(note => note.source.includes('title: Canvas acceptance')); assert.ok(file); const { whiteboardFromMarkdown } = await import('../core/whiteboard-document.mjs'); const saved = whiteboardFromMarkdown(file.source).scene; assert.equal(saved.elements.filter(element => !element.isDeleted).length, 1);
    const pixels = await page.locator('#whiteboard-canvas-host canvas').first().evaluate(canvas => { const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0; for (let offset = 0; offset < bytes.length; offset += 4) if (bytes[offset + 3] > 128 && Math.min(bytes[offset], bytes[offset + 1], bytes[offset + 2]) < 180) ink++; return ink; }); assert.ok(pixels > 50);
    await page.screenshot({ path: path.join(output, 'whiteboard-drawing.png') });
    await page.getByRole('button', { name: '所有白板', exact: true }).click(); await expect(page.locator('#whiteboard-library')).toBeVisible();
    await page.locator('#whiteboard-today-journal').click(); await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
    const journalNote = (await readNotes()).find(note => note.source.includes('手绘手帐 · ')); assert.ok(journalNote && journalNote.source.includes('date: '));
    await page.getByRole('button', { name: '所有白板', exact: true }).click(); await expect(page.locator('#whiteboard-library')).toBeVisible();
    await page.locator('[data-whiteboard-note-id]').filter({ hasText: 'Canvas acceptance' }).click(); await page.waitForSelector('#whiteboard-stage[data-ready="true"]'); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '1');
    await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    return { engine: 'Excalidraw 0.18.0', actualPointerDrawing: true, savedElements: 1, reopened: true, visualJournalCreated: true, pixels, file: file.relativePath };
  });
  if (creationOnly) await check('creation research sources, reading status, linked notes and excerpts share Markdown', async () => {
    const research = page.locator('[data-activity-id="research-desk:research-view"]'); await research.click(); await page.waitForSelector('#research-desk[data-ready="true"]');
    await page.locator('#research-actions-menu-trigger').click();
    await page.locator('#research-add').click(); await page.locator('#research-title').fill('Research evidence'); await page.locator('#research-kind').selectOption('paper'); await page.locator('#research-locator').fill('User-provided identifier'); await page.locator('#research-author').fill('Test author'); await page.locator('#research-year').fill('2026'); await page.locator('#research-text').fill('Verbatim research detail.');
    await page.locator('#research-save').click(); await expect(page.locator('#research-list')).toContainText('Research evidence');
    await page.getByRole('combobox', { name: 'Research evidence阅读状态', exact: true }).selectOption('阅读中'); await expect.poll(async () => (await readNotes()).find(note => note.source.includes('title: Research evidence'))?.source || '').toContain('status: 阅读中');
    await page.getByRole('button', { name: '为 Research evidence 创建札记', exact: true }).click(); await expect(page.locator('#note-title-badge')).toContainText('Research evidence');
    const note = (await readNotes()).find(note => note.source.includes('source_note:')); assert.ok(note.source.includes('[[sources/Research evidence'));
    await openFromSearch('EmbedSource'); if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
    await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+f');
    await page.keyboard.press('Escape'); await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\nResearch selection to preserve.\n');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.locator('#file-menu-button').click(); await page.locator('[data-action="collect-research-excerpt"]').click(); await expect.poll(async () => (await readNotes()).some(note => note.source.includes('category: excerpt'))).toBe(true);
    const excerpt = (await readNotes()).find(note => note.source.includes('category: excerpt')); assert.ok(excerpt.source.includes('Research selection to preserve.')); assert.ok(excerpt.source.includes('#^block-'));
    await research.click(); await page.waitForSelector('#research-desk[data-ready="true"]'); await page.locator('[data-research-mode="excerpt"]').click(); await expect(page.locator('#research-count')).toContainText('1 条');
    await page.locator('[data-copy-citation]').first().click();
    await expect(page.locator('#research-citation-bar')).toBeVisible();
    await expect(page.locator('#research-citation-preview')).toHaveValue(/\[\[Research\/EmbedSource#\^block-/);
    await page.locator('[data-research-mode="source"]').click();
    await page.locator('#research-actions-menu-trigger').click();
    await page.locator('#research-import-bib-toggle').click();
    await expect(page.locator('#research-bib-form')).toBeVisible();
    await page.locator('#research-bib-sample-btn').click();
    await page.locator('#research-bib-submit').click();
    await expect(page.locator('#research-list')).toContainText('Communicating with Slip Boxes');
    await expect(page.locator('#research-list')).toContainText('How to Take Smart Notes');
    const slipRow = page.locator('#research-list tr').filter({ hasText: 'Communicating with Slip Boxes' });
    await slipRow.locator('[data-copy-citation]').click();
    await page.locator('#research-citation-style-bar [data-citation-style="gbt7714"]').click();
    await expect(page.locator('#research-citation-preview')).toHaveValue(/\[J\]\. Journal of Knowledge Systems, 1992, 19\(2\): 53-61\. DOI:10\.1000\/jks\.1992\.53\./);
    await page.locator('#research-citation-style-bar [data-citation-style="apa"]').click();
    await expect(page.locator('#research-citation-preview')).toHaveValue(/\(1992\)\. Communicating with Slip Boxes/);
    await page.locator('#research-citation-style-bar [data-citation-style="bibtex"]').click();
    await expect(page.locator('#research-citation-preview')).toHaveValue(/^@article\{luhmann1992slipbox,/);
    await page.locator('#research-citation-style-bar [data-citation-style="wikilink"]').click();
    await expect(page.locator('#research-citation-preview')).toHaveValue(/^\[\[sources\/Communicating with Slip Boxes/);
    await page.locator('#research-actions-menu-trigger').click();
    await page.locator('#research-add-manuscript').click();
    await page.locator('#manuscript-title').fill('Manuscript acceptance');
    await page.locator('#manuscript-target-words').fill('2400');
    await page.locator('#manuscript-synopsis').fill('Structured long-form manuscript thesis.');
    await page.locator('#manuscript-save').click();
    await expect(page.locator('#research-list')).toContainText('Manuscript acceptance');
    await page.getByRole('button', { name: '为 Manuscript acceptance 新增章节', exact: true }).click();
    await expect(page.locator('#research-list')).toContainText('1 章');
    await expect(page.locator('#research-list')).toContainText('Manuscript acceptance · 第1章');
    const savedManuscript = (await readNotes()).find(item => item.source.includes('category: manuscript'));
    assert.ok(savedManuscript.source.includes('![[chapters/Manuscript acceptance · 第1章'));
    await page.locator('[data-publish-manuscript]').first().click();
    await expect(page.locator('#manuscript-publication-card')).toBeVisible();
    await expect(page.locator('#manuscript-publication-preview')).toContainText('## 全稿目录 (TOC)');
    await expect(page.locator('#manuscript-publication-preview')).toContainText('第 1 章');
    await page.locator('#manuscript-export-epub-btn').click();
    await expect(page.locator('#manuscript-publication-meta')).toContainText('已打包导出 EPUB 3.0 电子书');
    await page.locator('[data-research-mode="highlights"]').click();
    await expect(page.locator('#research-highlight-filters .ux-pill-option')).toHaveCount(7);
    await expect(page.locator('#research-highlights-list .ai-citation-card').first()).toBeVisible();
    await page.screenshot({ path: path.join(output, 'research-highlights-hub.png') });
    await page.locator('[data-research-mode="manuscript"]').click();
    await page.screenshot({ path: path.join(output, 'research-excerpts.png') });
    await page.locator('[data-compile-manuscript]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('Manuscript acceptance');
    await expect(page.locator('#rich-editor .note-embed').first()).toContainText('在此撰写本章正文');
    return { sourceMetadataWritten: true, readingStateSaved: true, readingNoteLinked: true, excerptPreserved: true, blockProvenance: true, citationCopied: true, manuscriptChapterEmbedded: true, manuscriptCompiledPreview: true };
  });
  if (creationOnly && !desktop) await check('creation exports expanded references and portable whiteboard files', async () => {
    await page.evaluate(() => { window.__creationPicker = window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
    try {
      await openFromSearch('EmbedRoot'); if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('# Exported study\n\n![[Research/EmbedSource#^proof]]\n'); await page.locator('[data-action="save"]').click();
      await page.locator('[data-action="print"]').click(); await page.locator('#export-format').selectOption('html'); const exported = page.waitForEvent('download'); await page.locator('#export-submit').click(); const html = await exported; const htmlText = await readFile(await html.path(), 'utf8'); assert.ok(htmlText.includes('Verified embedded paragraph.')); assert.ok(!htmlText.includes('![[Research/EmbedSource'));
      await expect(page.locator('#export-dialog')).toBeHidden(); await openFromSearch('Canvas acceptance', 'whiteboard');
      const downloads = {};
      for (const format of ['excalidraw', 'canvas', 'png', 'svg']) { await page.locator('#whiteboard-export-format').selectOption(format); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出白板', exact: true }).click(); const result = await pending; downloads[format] = await readFile(await result.path()); }
      const scene = JSON.parse(downloads.excalidraw.toString('utf8')); assert.equal(scene.type, 'excalidraw'); assert.equal(scene.elements.filter(element => !element.isDeleted).length, 1);
      const canvasJson = JSON.parse(downloads.canvas.toString('utf8')); assert.ok(Array.isArray(canvasJson.nodes) && canvasJson.nodes.length >= 1);
      assert.equal(downloads.png.subarray(1, 4).toString(), 'PNG'); assert.ok(downloads.svg.toString('utf8').includes('<svg'));
      await page.getByRole('button', { name: '所有白板', exact: true }).click(); await page.locator('#whiteboard-import-file').setInputFiles({ name: 'Imported obsidian.canvas', mimeType: 'application/json', buffer: downloads.canvas }); await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
      await page.getByRole('button', { name: '所有白板', exact: true }).click(); await page.locator('#whiteboard-import-file').setInputFiles({ name: 'Imported canvas.excalidraw', mimeType: 'application/json', buffer: downloads.excalidraw }); await page.waitForSelector('#whiteboard-stage[data-ready="true"]'); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '1');
      return { htmlExpanded: true, jsonRoundTrip: true, jsonCanvasRoundTrip: true, pngBytes: downloads.png.length, svgBytes: downloads.svg.length };
    } finally { await page.evaluate(() => { window.showSaveFilePicker = window.__creationPicker; delete window.__creationPicker; }); }
  });
  if (creationOnly) await check('creation whiteboard text images undo and small viewport retain editable data', async () => {
    if (!await page.locator('#whiteboard-stage').isVisible()) await openFromSearch('Canvas acceptance', 'whiteboard');
    const canvas = page.locator('#whiteboard-canvas-host canvas').last(); const box = await canvas.boundingBox();
    await page.locator('label').filter({ has: page.locator('[data-testid="toolbar-text"]') }).click(); await page.mouse.click(box.x + box.width * .4, box.y + box.height * .3); await page.keyboard.insertText('Whiteboard text 中文'); await page.keyboard.press('Escape');
    await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '2'); await page.locator('#whiteboard-save').click(); await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    const { whiteboardFromMarkdown } = await import('../core/whiteboard-document.mjs'); const activeName = await page.locator('#file-name').textContent();
    await expect.poll(async () => (await readNotes()).some(note => note.name === activeName && note.source.includes('中文'))).toBe(true);
    const saved = (await readNotes()).find(note => note.name === activeName); const scene = whiteboardFromMarkdown(saved.source).scene; assert.ok(scene.elements.some(element => element.type === 'text' && element.text.includes('中文')));
    await page.locator('label').filter({ has: page.locator('[data-testid="toolbar-ellipse"]') }).click(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .55); await page.mouse.down(); await page.mouse.move(box.x + box.width * .84, box.y + box.height * .72, { steps: 8 }); await page.mouse.up(); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '3');
    await page.keyboard.press('Control+z'); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '2'); await page.locator('#whiteboard-save').click(); await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    const image = await readFile(path.join(root, 'assets/logo-source.png')); const imageId = 'embedded-fixture'; scene.files[imageId] = { id: imageId, mimeType: 'image/png', dataURL: 'data:image/png;base64,' + image.toString('base64'), created: Date.now() };
    const rectangle = scene.elements.find(element => element.type === 'rectangle'); scene.elements.push({ ...rectangle, id: 'image-fixture', type: 'image', fileId: imageId, status: 'saved', scale: [1, 1], crop: null, x: rectangle.x + 240, y: rectangle.y, width: 130, height: 130, version: 1, boundElements: null });
    await page.getByRole('button', { name: '所有白板', exact: true }).click(); await page.locator('#whiteboard-import-file').setInputFiles({ name: 'Image board.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) }); await page.waitForSelector('#whiteboard-stage[data-ready="true"], #whiteboard-library .database-error:not([hidden])'); if (await page.locator('#whiteboard-library .database-error').isVisible()) throw new Error(await page.locator('#whiteboard-library .database-error').textContent()); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '3');
    await page.locator('#whiteboard-save').click(); await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    await expect.poll(async () => (await readNotes()).some(note => note.source.includes('title: Image board'))).toBe(true);
    const imported = (await readNotes()).find(note => note.source.includes('title: Image board')); assert.equal(whiteboardFromMarkdown(imported.source).scene.files[imageId].dataURL, scene.files[imageId].dataURL);
    if (!desktop) await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('#whiteboard-canvas-host canvas').last()).toBeVisible(); const viewport = await page.locator('#whiteboard-canvas-host').boundingBox(); assert.ok(viewport.width > 250 && viewport.height > 250);
    await expect.poll(() => page.locator('#whiteboard-canvas-host canvas').evaluateAll(canvases => canvases.reduce((total, canvas) => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let offset = 0; offset < pixels.length; offset += 16) if (pixels[offset + 3] > 100 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 650) total++; return total; }, 0))).toBeGreaterThan(30); await page.screenshot({ path: path.join(output, 'whiteboard-images-mobile.png') });
    if (!desktop) await page.setViewportSize({ width: 1440, height: 960 }); return { chineseText: true, undo: true, imageBytesPreserved: true, viewport };
  });
  if (creationOnly) await check('creation 500-element whiteboard remains editable and survives restart and plugin disable', async () => {
    const { whiteboardFromMarkdown } = await import('../core/whiteboard-document.mjs'); const notes = await readNotes(); const template = whiteboardFromMarkdown(notes.find(note => note.source.includes('title: Image board')).source).scene.elements.find(element => element.type === 'rectangle');
    const scene = { type: 'excalidraw', version: 2, appState: {}, files: {}, elements: Array.from({ length: 500 }, (_, index) => ({ ...template, id: 'load-' + index, x: index % 25 * 150, y: Math.floor(index / 25) * 100, width: 120, height: 70, index: null, version: 1, seed: index + 1, versionNonce: index + 1, boundElements: null, groupIds: [], isDeleted: false })) };
    await page.getByRole('button', { name: '所有白板', exact: true }).click(); const opening = performance.now(); await page.locator('#whiteboard-import-file').setInputFiles({ name: 'Load board.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) }); await page.waitForSelector('#whiteboard-stage[data-ready="true"]'); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '500'); const openMs = Math.round(performance.now() - opening);
    const box = await page.locator('#whiteboard-canvas-host canvas').last().boundingBox(); const drawing = performance.now(); await page.locator('label').filter({ has: page.locator('[data-testid="toolbar-rectangle"]') }).click(); await page.mouse.move(box.x + box.width * .62, box.y + box.height * .55); await page.mouse.down(); await page.mouse.move(box.x + box.width * .79, box.y + box.height * .73, { steps: 5 }); await page.mouse.up(); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '501'); const drawMs = Math.round(performance.now() - drawing); assert.ok(openMs < 20000 && drawMs < 8000);
    await page.locator('#whiteboard-save').click(); await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存'); const saved = (await readNotes()).find(note => note.source.includes('title: Load board'));
    if (desktop) await restartDesktopForAppearance(); else await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail'); await openFromSearch('Load board', 'whiteboard'); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '501'); assert.equal((await readNotes()).find(note => note.name === saved.name).source, saved.source);
    await page.locator('[data-action="settings"]').click(); const group = page.locator('#settings-dialog details').filter({ has: page.locator('[data-plugin-id="whiteboard"]') }); if (!await group.getAttribute('open') && !await page.locator('[data-plugin-id="whiteboard"]').isVisible()) await group.locator('summary').click();
    await page.locator('[data-plugin-id="whiteboard"]').uncheck(); await expect(page.locator('#whiteboard-canvas-host')).toHaveCount(0); await expect(page.locator('[data-activity-id="whiteboard:whiteboard-view"]')).toHaveCount(0); await page.locator('[data-plugin-id="whiteboard"]').check(); await page.locator('#settings-dialog .dialog-footer button').click(); await page.locator('[data-activity-id="whiteboard:whiteboard-view"]').click(); await expect(page.locator('#whiteboard-stage')).toHaveAttribute('data-elements', '501');
    return { openMs, drawMs, elementsAfterEdit: 501, savedBytesUnchanged: true, actualProcessRestart: desktop, pluginUnmounted: true, pluginReenabled: true };
  });
  if (creationOnly) await check('creation AI grounded Q&A, diff revision, manuscript consistency, skills and interactive user guide', async () => {
    await openFromSearch('双链笔记与卡片盒方法');
    await page.locator('#file-menu-button').click();
    await page.locator('[data-action="open-guide"]').click();
    await expect(page.locator('#guide-dialog')).toBeVisible();
    await page.locator('[data-guide-chapter="topbar"]').click();
    await expect(page.locator('.guide-section[data-chapter="topbar"]')).toBeVisible();
    await page.locator('[data-guide-chapter="all"]').click();
    await page.screenshot({ path: path.join(output, 'manual-f1-dialog.png') });
    await page.locator('[data-guide-view="ai-assistant:ai-view"]').click();
    await expect(page.locator('#guide-dialog')).toBeHidden();
    await page.waitForSelector('#ai-assistant[data-ready="true"]');

    await page.locator('#ai-question-input').fill('Verified embedded paragraph');
    await page.locator('#ai-ask-submit').click();
    await expect(page.locator('#ai-answer-output')).toHaveAttribute('data-answer-status', 'grounded', { timeout: 25000 });
    await expect(page.locator('#ai-answer-output .ai-model-block-card').first()).toBeVisible();
    await expect(page.locator('#ai-answer-output .ai-answer-point-row').first()).toBeVisible();
    await expect(page.locator('#ai-crystallize-save-btn')).toBeVisible();
    await expect(page.locator('#ai-citation-list .ai-citation-card').first()).toContainText('EmbedSource');
    await page.locator('#ai-crystallize-save-btn').click();
    await expect(page.locator('#ai-crystallize-status')).toContainText('建立双向双链');
    await expect.poll(async () => (await savedNote('EmbedSource'))?.source || '').toContain('[[智识洞察 · Verified embedded para]]');
    await page.screenshot({ path: path.join(output, 'ai-chat-formatted.png') });

    await page.locator('#ai-question-input').fill('UnrecordedQuantumBudget999');
    await page.locator('#ai-ask-submit').click();
    await expect(page.locator('#ai-answer-output')).toHaveAttribute('data-answer-status', 'insufficient-evidence');

    await page.locator('[data-ai-tab="mcp"]').click();
    await expect(page.locator('#ai-mcp-tool-pills [data-mcp-tool-id]')).toHaveCount(6);
    await page.locator('#ai-mcp-run-btn').click();
    await expect(page.locator('#ai-mcp-trace-list .ai-citation-card').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#ai-mcp-diff-preview')).toBeVisible();
    await expect(page.locator('#ai-mcp-approve-btn')).toBeEnabled();
    await page.screenshot({ path: path.join(output, 'local-mcp-agent-trace.png') });
    await page.locator('#ai-mcp-approve-btn').click();
    await expect(page.locator('#ai-mcp-status')).toContainText('已人工批准并执行提案');
    await page.locator('[data-mcp-submode="external"]').click();
    await expect(page.locator('#ai-mcp-external-pane')).toBeVisible();
    await page.locator('#ai-mcp-security-menu-trigger').click();
    await page.locator('#ai-mcp-readonly-preset-btn').click();
    await page.locator('#ai-mcp-security-menu-trigger').click();
    await page.locator('#ai-mcp-ext-test-tool').selectOption('inkloom_create_note');
    await page.locator('#ai-mcp-ext-test-btn').click();
    await expect(page.locator('#ai-mcp-ext-status')).toContainText('权限审计已拦截 (inkloom_create_note)');
    await expect(page.locator('#ai-mcp-ext-preview')).toContainText('JSON-RPC 2.0 实时调用审计账本');
    await page.locator('#ai-mcp-security-menu-trigger').click();
    await page.locator('#ai-mcp-alltools-preset-btn').click();
    await page.locator('#ai-mcp-security-menu-trigger').click();
    await page.locator('#ai-mcp-ext-test-tool').selectOption('inkloom_list_vault');
    await page.locator('#ai-mcp-ext-test-btn').click();
    await expect(page.locator('#ai-mcp-ext-status')).toContainText('JSON-RPC 2.0 调用成功');
    await page.locator('[data-mcp-submode="internal"]').click();

    await page.locator('[data-ai-tab="config"]').click();
    await page.locator('#ai-profile-preset').selectOption('copilot-gemini-4');
    await expect(page.locator('#ai-model')).toHaveValue('gemini-4');
    await page.locator('#ai-api-key').fill('sk-test-credential-987654');
    await page.locator('#ai-config-save').click();
    await expect(page.locator('#ai-key-status')).toContainText('sk-••••654');
    assert.ok((await readNotes()).every(note => !note.source.includes('sk-test-credential-987654')));
    await page.locator('#ai-profile-preset').selectOption('local-ollama-smollm2');
    await page.locator('#ai-config-save').click();
    await page.locator('#ai-test-local-llm').click();
    await expect(page.locator('#ai-local-llm-output')).toContainText('smollm2-135m-instruct-q4_0.gguf', { timeout: 25000 });
    await expect(page.locator('#ai-local-llm-output')).toContainText('实测生成：', { timeout: 25000 });
    await page.locator('#ai-config-clear-key').click();
    await expect(page.locator('#ai-key-status')).toContainText('未保存 API 密钥');
    await page.locator('#ai-embedding-index-menu-trigger').click();
    await page.locator('#ai-embedding-model-select').selectOption('local-gguf-embed-v1');
    await page.locator('#ai-embedding-rebuild-btn').click();
    await expect(page.locator('#ai-embedding-index-status')).toContainText('local-gguf-embed-v1 (256维)');
    await page.locator('#ai-embedding-index-menu-trigger').click();

    await page.locator('[data-ai-tab="revise"]').click();
    await page.locator('#ai-revise-preview').click();
    await expect(page.locator('#ai-revise-diff')).toContainText('[!NOTE] 要点提炼');
    await page.locator('#ai-revise-apply').click();
    await expect(page.locator('#ai-revise-status')).toContainText('修订已写入当前草稿');
    await page.locator('[data-action="save"]').click();
    await expect.poll(async () => (await savedNote('01-')).source).toContain('> [!NOTE] 要点提炼');

    await page.locator('[data-ai-tab="consistency"]').click();
    await page.locator('#ai-consistency-run').click();
    await expect(page.locator('#ai-consistency-coverage')).toContainText('已核对');
    await expect(page.locator('#ai-consistency-findings')).toContainText('卡片写作十诫');
    await page.locator('#ai-consistency-matrix-trigger').click();
    await page.locator('#ai-matrix-folder-input').fill('Inkloom使用方法');
    await page.locator('#ai-matrix-build-btn').click();
    await expect(page.locator('#ai-entity-timeline-matrix-preview')).toBeVisible();
    await expect(page.locator('#ai-entity-timeline-matrix-preview')).toContainText('章节时间线与目录叙事序列');

    await page.locator('[data-ai-tab="synthesis"]').click();
    await expect(page.locator('#ai-weaver-list')).toContainText('灵感速记（孤岛示例）');
    await page.locator('#ai-weaver-apply-all').click();
    await expect.poll(async () => (await savedNote('99-'))?.source || '').toContain('## 关联脉络');

    await page.locator('[data-ai-tab="digest"]').click();
    await page.locator('#ai-digest-generate').click();
    await expect(page.locator('#ai-digest-preview')).toContainText('综述统计概览');
    await expect(page.locator('#ai-digest-preview .ai-rich-doc-body')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'ai-digest-rendered.png') });
    await page.locator('#ai-digest-save').click();
    await expect(page.locator('#ai-digest-status')).toContainText('digests/');
    await page.locator('[data-digest-submode="split"]').click();
    await page.locator('#ai-split-preview-btn').click();
    await expect(page.locator('#ai-split-output')).toContainText('原子卡片索引 (MOC)');

    await expect(page.locator('#ai-subnav-sidebar .ai-subnav-item[data-ai-tab]')).toHaveCount(15);

    await page.locator('[data-ai-tab="compiler"]').click();
    await expect(page.locator('#ai-compiler-stats-pills .ai-sr-stat-pill')).toHaveCount(6);
    await expect(page.locator('#ai-compiler-clusters-list.compiler-topic-strip .compiler-cluster-card.is-topic-step').first()).toBeVisible();
    await expect(page.locator('#ai-compiler-preview .ai-rich-doc-body')).toBeVisible();
    await page.locator('[data-compiler-view="lint"]').click();
    await expect(page.locator('#ai-compiler-lint-pane')).toBeVisible();
    await expect(page.locator('#ai-compiler-ingest-pane')).toBeHidden();
    await page.locator('[data-compiler-view="ingest"]').click();
    await expect(page.locator('#ai-compiler-ingest-pane')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'karpathy-wiki-compiler.png') });
    await page.locator('#ai-compiler-ingest-all-btn').click();
    await expect(page.locator('#ai-compiler-status')).toContainText('wiki/index.md');

    await page.locator('[data-ai-tab="chronicle"]').click();
    await expect(page.locator('#ai-chronicle-timeline-axis svg.chronicle-timeline-svg')).toBeVisible();
    await expect(page.locator('#ai-chronicle-timeline-axis .chronicle-step-cell').first()).toBeVisible();
    await expect(page.locator('#ai-chronicle-cards-list .chronicle-milestone-card .chronicle-kv-grid').first()).toBeVisible();
    await expect(page.locator('#ai-chronicle-cards-list .chronicle-milestone-card:visible')).toHaveCount(1);
    await expect(page.locator('#ai-chronicle-critique-box .chronicle-critique-item')).toHaveCount(3);
    await page.screenshot({ path: path.join(output, 'cognitive-evolution-chronicle.png') });
    await page.locator('[data-chronicle-mode="all"]').click();
    await expect.poll(async () => await page.locator('#ai-chronicle-cards-list .chronicle-milestone-card:visible').count()).toBeGreaterThan(1);
    await page.locator('[data-chronicle-mode="focus"]').click();
    await page.locator('#ai-chronicle-save-btn').click();
    await expect(page.locator('#ai-chronicle-status')).toContainText('chronicles/认知演进史.md');

    await page.locator('[data-ai-tab="flashcards"]').click();
    await expect(page.locator('#ai-sr-stats-pills .ai-sr-stat-pill')).toHaveCount(5);
    await expect(page.locator('#ai-sr-forecast-bar .ai-sr-forecast-col')).toHaveCount(14);
    await expect(page.locator('#ai-sr-hard-only-btn')).toBeVisible();
    await page.locator('#ai-sr-hard-only-btn').click();
    await expect(page.locator('#ai-sr-hard-only-btn')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#ai-sr-hard-only-btn').click();
    await expect(page.locator('#ai-sr-hard-only-btn')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#ai-sr-deck-menu-trigger').click();
    await expect(page.locator('#ai-sr-deck-filter-bar')).toBeVisible();
    await expect(page.locator('#ai-sr-folder-filter')).toBeVisible();
    await expect(page.locator('#ai-sr-tag-filter')).toBeVisible();
    await page.locator('#ai-sr-preview-candidates').click();
    await expect(page.locator('#ai-sr-candidate-panel')).toBeVisible();
    await page.locator('#ai-sr-commit-candidates').click();
    await expect(page.locator('#ai-sr-candidate-panel')).toBeHidden();
    await page.locator('#ai-sr-deck-menu-trigger').click();
    await page.locator('#ai-sr-generate-note').click();
    await expect(page.locator('#selection-tools')).toBeHidden();
    await expect(page.locator('#ai-sr-front')).toContainText('问：');
    await page.locator('#ai-sr-flip-btn').click();
    await expect(page.locator('#ai-sr-back')).toBeVisible();
    await expect(page.locator('#ai-sr-back')).toHaveClass(/ai-sr-answer-card/);
    assert.ok(!(await page.locator('#ai-sr-back').textContent()).includes('\\['));
    await page.screenshot({ path: path.join(output, 'flashcards-rendered.png') });
    await page.locator('#ai-sr-grade-easy').click();
    await expect(page.locator('#selection-tools')).toBeHidden();
    await expect.poll(async () => (await savedNote('01-'))?.source || '').toContain('@sr(due=');
    // MAJOR-280: SM-2 Flashcards Anki .tsv / .apkg Bidirectional Sync
    await page.locator('#ai-sr-deck-menu-trigger').click();
    await page.locator('#ai-sr-export-anki-tsv').click();
    await expect(page.locator('#ai-sr-anki-status')).toContainText('已导出');
    assert.ok((await page.locator('#ai-sr-anki-import-input').inputValue()).includes('#separator:tab'));
    await page.locator('#ai-sr-export-anki-apkg').click();
    await expect(page.locator('#ai-sr-anki-status')).toContainText('.apkg');
    await page.locator('#ai-sr-anki-sample-btn').click();
    await page.locator('#ai-sr-anki-import-btn').click();
    await expect(page.locator('#ai-sr-anki-status')).toContainText('成功导入');
    await page.locator('#ai-sr-deck-menu-trigger').click();

    await page.locator('[data-ai-tab="doctor"]').click();
    await expect(page.locator('#ai-doctor-summary')).toContainText('全库健康度评分：');
    await expect(page.locator('#ai-doctor-findings')).toContainText('卡片写作十诫');
    await page.locator('#ai-doctor-tools-menu-trigger').click();
    await page.locator('#ai-dataview-run-btn').click();
    await expect(page.locator('#ai-doctor-summary')).toContainText('Dataview TABLE 查询已执行');
    await expect(page.locator('#ai-doctor-dataview-output')).toContainText('Dataview TABLE 查询结果');
    await page.locator('#ai-doctor-tools-menu-trigger').click();
    await page.locator('#ai-migration-preview-btn').click();
    await expect(page.locator('#ai-doctor-summary')).toContainText('Notion (32位UUID剥离+顶部属性转YAML)');
    await page.locator('#ai-doctor-tools-menu-trigger').click();
    await page.locator('#ai-embed-audit-btn').click();
    await expect(page.locator('#ai-doctor-summary')).toContainText('全库跨笔记 ![[块/章节]] 内嵌巡检完成');
    await expect(page.locator('#ai-doctor-dataview-output')).toContainText('跨笔记块引用与章节内嵌健康报告');
    await page.screenshot({ path: path.join(output, 'ai-doctor-clean.png') });

    await page.locator('[data-ai-tab="snapshot"]').click();
    await page.locator('#ai-snapshot-create').click();
    await expect(page.locator('#ai-snapshot-status')).toContainText('已生成里程碑快照');
    await expect(page.locator('#ai-snapshot-stats-pills .ai-sr-stat-pill')).toHaveCount(5);
    await page.screenshot({ path: path.join(output, 'vault-snapshot-timemachine.png') });

    await page.locator('[data-ai-tab="sync"]').click();
    await page.locator('#ai-sync-scan-btn').click();
    await expect(page.locator('#ai-sync-stats-pills .ai-sr-stat-pill')).toHaveCount(5);
    await expect(page.locator('#ai-sync-conflict-list .ai-citation-card').first()).toBeVisible();
    await page.screenshot({ path: path.join(output, 'folder-sync-merge.png') });
    await page.locator('#ai-sync-apply-btn').click();
    await expect(page.locator('#ai-sync-status')).toContainText('双向增量同步完成');
    await page.locator('#ai-sync-e2ee-menu-trigger').click();
    await page.locator('#ai-sync-e2ee-push-btn').click();
    await expect(page.locator('#ai-sync-status')).toContainText('已增量推送至 E2EE 零知识密文仓');
    await expect(page.locator('#ai-sync-e2ee-report-box')).toContainText('manifestSha256');
    await page.locator('#ai-sync-e2ee-menu-trigger').click();
    await page.locator('#ai-sync-e2ee-verify-btn').click();
    await expect(page.locator('#ai-sync-status')).toContainText('口令解密与完整性校验通过');
    await page.locator('#ai-sync-e2ee-menu-trigger').click();
    await page.locator('#ai-sync-xplat-audit-btn').click();
    await expect(page.locator('#ai-sync-status')).toContainText('跨平台可移植性自检完成');

    await page.locator('[data-ai-tab="skills"]').click();
    await page.locator('#ai-skill-name').fill('研究证据核查法');
    await page.locator('#ai-skill-desc').fill('提炼自研究资料的核查步骤与边界');
    await page.locator('#ai-skill-preview-btn').click();
    await expect(page.locator('#ai-skill-candidate-preview')).toContainText('category: skill');
    await page.locator('#ai-skill-save-btn').click();
    await expect(page.locator('#ai-skill-list')).toContainText('研究证据核查法');
    await expect(page.locator('#ai-skill-list')).toContainText('7/7 项通过');
    await page.locator('[data-export-skill]').first().click();
    await expect(page.locator('#ai-skill-export-output')).toBeVisible();
    const exportedSkill = await page.locator('#ai-skill-export-output').inputValue();
    assert.ok(exportedSkill.includes('category: skill') && !exportedSkill.includes('source_notes:'));
    await page.screenshot({ path: path.join(output, 'ai-skills-guide.png') });

    await page.locator('[data-action="settings"]').click();
    const extGroup = page.locator('[data-settings-group="extensions"]');
    if (!await extGroup.evaluate(node => node.open)) await extGroup.locator('summary').click();
    await page.locator('#plugin-export-template').click();
    await expect(page.locator('#plugin-package-status')).toContainText('v1.0.0');
    await page.locator('#plugin-install-json-btn').click();
    await expect(page.locator('[data-plugin-sandbox="reading-stats-helper"]')).toHaveCount(1);
    await expect(page.locator('#plugin-installed-packages')).toContainText('v1.0.0');
    await page.locator('#plugin-export-template').click();
    await expect(page.locator('#plugin-package-status')).toContainText('v1.1.0');
    await page.locator('#plugin-install-json-btn').click();
    await expect(page.locator('[data-rollback-plugin="reading-stats-helper"]')).toBeVisible();
    await page.locator('[data-rollback-plugin="reading-stats-helper"]').click();
    await expect(page.locator('#plugin-installed-packages')).toContainText('v1.0.0');
    await page.locator('[data-remove-plugin="reading-stats-helper"]').click();
    await expect(page.locator('[data-plugin-sandbox="reading-stats-helper"]')).toHaveCount(0);
    await page.locator('#settings-dialog .dialog-footer button').click();

    await openFromSearch('长文写作与工业级导出');
    await page.locator('#quick-switcher-trigger').click();
    await expect(page.locator('#quick-switcher-filters .ux-pill-option')).toHaveCount(5);
    await page.locator('#quick-switcher-filters [data-qs-category="headings"]').click();
    await expect(page.locator('#quick-switcher-list [data-qs-result-category="headings"]').first()).toBeVisible();
    await page.screenshot({ path: path.join(output, 'quick-switcher-pills.png') });
    await page.locator('#quick-switcher-dialog .dialog-heading button').click();

    await page.locator('#inline-status-pill').click();
    await expect(page.locator('#inline-property-popover')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'inline-property-popover.png') });
    await page.locator('#inline-status-options [data-inline-status="进行中"]').click();
    await expect(page.locator('#inline-property-popover')).toBeHidden();
    await expect(page.locator('#inline-status-pill')).toContainText('进行中');

    await page.locator('#pin-reference-button').click();
    await expect(page.locator('#reference-pane')).toBeVisible();
    await page.locator('#reference-cite-btn').click();
    await page.locator('#reference-close-btn').click();
    await expect(page.locator('#reference-pane')).toBeHidden();
    if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
    await page.locator('#source-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n\n本段进一步探讨 YAML属性与标签体系 在知识整理中的作用。\n');
    await page.locator('[data-context-tab="mentions"]').click();
    await expect(page.locator('#smart-wikilink-panel')).toBeVisible();
    await page.locator('#smart-wikilink-engine').selectOption('local-llm');
    await page.locator('#smart-wikilink-scan').click();
    await expect(page.locator('#smart-wikilink-scan')).toHaveText('智能扫描', { timeout: 15000 });
    await expect(page.locator('#smart-wikilink-suggestions')).toContainText('YAML属性与标签体系');
    await page.locator('#smart-wikilink-apply-all').click();
    await page.locator('[data-action="save"]').click();
    await expect.poll(async () => (await savedNote('03-')).source).toContain('[[YAML属性与标签体系]]');

    await expect(page.locator('#active-file-dewdrop')).toBeVisible();
    await expect(page.locator('#corner-fold-dewdrop')).toBeVisible();
    await page.locator('#corner-fold-dewdrop').click();
    await expect(page.locator('#corner-overflow-menu')).toBeVisible();
    await page.locator('#corner-fold-dewdrop').click();
    await expect(page.locator('#corner-overflow-menu')).toBeHidden();
    await page.locator('#context-sidebar-toggle').click();
    await expect(page.locator('#context-sidebar')).toBeHidden();
    await expect(page.locator('#right-dewdrop-strip')).toBeVisible();
    await page.locator('[data-right-dewdrop="inspiration"]').click();
    await expect(page.locator('#context-sidebar')).toBeVisible();
    await expect(page.locator('#live-smart-connections-panel')).toBeVisible();
    await expect(page.locator('#live-cosine-list')).toBeVisible();
    await expect(page.locator('#thermodynamic-awakening-list')).toBeHidden();
    await page.locator('[data-inspire-mode="awakening"]').click();
    await expect(page.locator('#thermodynamic-awakening-list')).toBeVisible();
    await expect(page.locator('#live-cosine-list')).toBeHidden();
    await page.locator('[data-inspire-mode="cosine"]').click();
    await expect(page.locator('#live-cosine-list')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'right-sidebar-inspiration.png') });

    await expect(page.locator('#inline-ai-autofill-pill')).toBeVisible();
    await page.locator('#inline-ai-autofill-pill').click();
    await expect(page.locator('#inline-summary-pill')).toBeVisible();
    await expect.poll(async () => (await savedNote('03-')).source).toContain('summary:');

    await page.locator('#pomodoro-pill').click();
    await expect(page.locator('#pomodoro-pill')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#pomodoro-pill').click();
    await expect(page.locator('#pomodoro-pill')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#file-menu-button').click();
    await page.locator('#file-menu [data-action="quick-append"]').click();
    await expect(page.locator('#quick-append-dialog')).toBeVisible();
    await page.locator('#quick-append-input').fill('1.1.0 全局闪念静默快记实机验收');
    await page.locator('#quick-append-submit').click();
    await expect(page.locator('#quick-append-dialog')).toBeHidden();
    await expect.poll(async () => (await readNotes()).some(n => n.source.includes('1.1.0 全局闪念静默快记实机验收'))).toBe(true);

    await page.locator('[data-context-tab="backlinks"]').click();

    await expect(page.locator('[data-vault-folder="Inkloom使用方法"]')).toBeVisible();
    await openFromSearch('00-Inkloom使用方法总目录');
    await expect(page.locator('#rich-editor .wikilink-token[data-wikilink-target="02.3-Excel粘贴自动成表与表格列一键排序"]').first()).toBeVisible();
    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="02.3-Excel粘贴自动成表与表格列一键排序"]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('02.3-Excel粘贴自动成表与表格列一键排序');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '项目\t得分\n墨图表格\t99');
      dt.setData('text/html', '<table><tr><td>项目</td><td>得分</td></tr><tr><td>墨图表格</td><td>99</td></tr></table>');
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'excel-cells.png', { type: 'image/png' }));
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('#source-editor .cm-content').dispatchEvent(evt);
    });
    await expect(page.locator('#source-editor')).toContainText('| 项目 | 得分 |');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#dirty-dot')).toBeHidden();
    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="00-Inkloom使用方法总目录"]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('00-Inkloom使用方法总目录');

    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚"]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚');
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#slide-present-button').click();
    await expect(page.locator('#slide-presenter-dialog')).toBeVisible();
    await expect(page.locator('#slide-counter-pill')).toContainText('第 1 / 4 页');
    await page.locator('#slide-next-btn').click();
    await expect(page.locator('#slide-counter-pill')).toContainText('第 2 / 4 页');
    await page.locator('#slide-close-btn').click();
    await expect(page.locator('#slide-presenter-dialog')).toBeHidden();

    // 2.5.0 MAJOR-250: Recursive folder expand-to-bottom / collapse-all & Mindmap presenter
    const guideRootFolder = page.locator('#vault-tree-list [data-vault-folder="Inkloom使用方法"]');
    await expect(guideRootFolder).toBeVisible();
    await guideRootFolder.click();
    await expect(guideRootFolder).toHaveClass(/is-selected-folder/);
    await expect(guideRootFolder).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#vault-tree-list [data-vault-folder="Inkloom使用方法/01-界面全景与水泡周界"]')).toHaveCount(0);
    await page.locator('#vault-expand-deep-btn').click();
    await expect(guideRootFolder).toHaveAttribute('aria-expanded', 'true');
    await expect(guideRootFolder).toHaveAttribute('data-all-descendants-expanded', 'true');
    await expect(page.locator('#vault-tree-list [data-vault-folder="Inkloom使用方法/01-界面全景与水泡周界"]')).toBeVisible();
    await expect(page.locator('#vault-tree-list [title="Inkloom使用方法/01-界面全景与水泡周界/01.1-外置水泡周界UI与五区布局详解.md"]')).toBeVisible();

    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#mindmap-present-button').click();
    await expect(page.locator('#mindmap-presenter-dialog')).toBeVisible();
    await expect(page.locator('#mindmap-stage-viewport svg.inkloom-mindmap-svg')).toBeVisible();
    await page.locator('#mindmap-mode-select').selectOption('folder');
    await expect(page.locator('#mindmap-stage-viewport svg.inkloom-mindmap-svg [data-mindmap-folder]')).not.toHaveCount(0);
    await page.locator('#mindmap-close-btn').click();
    await expect(page.locator('#mindmap-presenter-dialog')).toBeHidden();

    // MAJOR-290: Offline SVG / PNG Knowledge Quote & Share Card Renderer
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#note-share-card-button').click();
    await expect(page.locator('#share-card-dialog')).toBeVisible();
    await expect(page.locator('#share-card-preview-stage svg')).toBeVisible();
    await page.locator('#share-card-theme-select').selectOption('obsidian-gold');
    await expect(page.locator('#share-card-stats-bar')).toContainText('暗夜黑金');
    await page.locator('#share-card-copy-svg-btn').click();
    await page.locator('#share-card-download-png-btn').click();
    await expect.poll(async () => await page.evaluate(() => Boolean(window.__inkloomLastExportedShareCardPng?.startsWith('data:image/png')))).toBe(true);
    await page.locator('#share-card-close-btn').click();
    await expect(page.locator('#share-card-dialog')).toBeHidden();

    // MAJOR-300: Cross-Note Section & Block Transclusion Inspector
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#note-embed-inspector-button').click();
    await expect(page.locator('#embed-inspector-dialog')).toBeVisible();
    await page.locator('#embed-inspector-scope-select').selectOption('vault');
    await expect(page.locator('#embed-inspector-stats-bar')).toContainText('总内嵌引用');
    await page.locator('#embed-inspector-close-btn').click();
    await expect(page.locator('#embed-inspector-dialog')).toBeHidden();

    // MAJOR-310: Vault-Wide Controlled Regex Search & Replace with Instant Undo Rollback
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#note-vault-replace-button').click();
    await expect(page.locator('#vault-replace-dialog')).toBeVisible();
    await page.locator('#vault-replace-query').fill('万象成图');
    await page.locator('#vault-replace-replacement').fill('万象成图·已验证');
    await page.locator('#vault-replace-preview-btn').click();
    await expect(page.locator('#vault-replace-stats-bar')).toContainText('待替换');
    await expect(page.locator('#vault-replace-apply-btn')).toBeEnabled();
    await page.locator('#vault-replace-apply-btn').click();
    await expect(page.locator('#vault-replace-summary')).toContainText('已完成受控批量替换');
    await expect.poll(async () => (await readNotes()).some(n => n.source.includes('万象成图·已验证'))).toBe(true);
    await page.locator('#vault-replace-undo-btn').click();
    await expect(page.locator('#vault-replace-summary')).toContainText('已无损撤销上次批量替换');
    await expect.poll(async () => (await readNotes()).some(n => n.source.includes('万象成图·已验证'))).toBe(false);
    await page.locator('#vault-replace-close-btn').click();
    await expect(page.locator('#vault-replace-dialog')).toBeHidden();

    await page.locator('#source-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nTEMP_DIFF_HUNK_LINE_TO_REVERT\n');
    await expect(page.locator('#source-editor')).toContainText('TEMP_DIFF_HUNK_LINE_TO_REVERT');
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#note-diff-button').click();
    await expect(page.locator('#note-diff-dialog')).toBeVisible();
    await expect(page.locator('[data-revert-hunk="hunk-1"]')).toBeVisible();
    await page.locator('[data-revert-hunk="hunk-1"]').click();
    await expect(page.locator('#source-editor')).not.toContainText('TEMP_DIFF_HUNK_LINE_TO_REVERT');
    await page.locator('#note-diff-close').click();
    await expect(page.locator('#note-diff-dialog')).toBeHidden();

    const statusBarBoxes = await page.evaluate(() => {
      const pomo = document.querySelector('#pomodoro-pill').getBoundingClientRect();
      const graph = document.querySelector('#vault-graph-status').getBoundingClientRect();
      return { pomoRight: pomo.right, graphLeft: graph.left, pomoWidth: pomo.width };
    });
    assert.ok(statusBarBoxes.pomoWidth > 90 && statusBarBoxes.pomoRight <= statusBarBoxes.graphLeft + 1);

    await page.locator('#source-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nUNSAVED_DRAFT_TO_DISCARD_VIA_TAB\n');
    await expect(page.locator('#discard-draft-btn')).toBeVisible();
    await page.locator('#active-dewdrop-close').click();
    await expect(page.locator('#edit-dialog')).toBeVisible();
    await expect(page.locator('#edit-discard-btn')).toBeVisible();
    await page.locator('#edit-dialog .dialog-footer [data-action="edit-close"]').click();
    await expect(page.locator('#edit-dialog')).toBeHidden();
    await page.locator('#discard-draft-btn').click();
    await expect(page.locator('#discard-draft-btn')).toBeHidden();
    await expect(page.locator('#source-editor')).not.toContainText('UNSAVED_DRAFT_TO_DISCARD_VIA_TAB');

    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡"]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡');
    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="08.1-受控MCP智能体六大工具与双目录SHA256增量同步"]').first().click();
    await expect(page.locator('#note-title-badge')).toContainText('08.1-受控MCP智能体六大工具与双目录SHA256增量同步');

    await page.locator('#global-graph-button').click();
    await expect(page.locator('#global-graph-stage')).toBeVisible();
    await expect(page.locator('#graph-analytics-bar')).toBeVisible();
    await expect.poll(async () => await page.locator('#graph-community-pills [data-community-filter]').count()).toBeGreaterThanOrEqual(2);
    await page.locator('#graph-pathfinder-menu-trigger').click();
    const startVal = await page.locator('#graph-path-start option').filter({ hasText: '双链笔记与卡片盒方法' }).first().getAttribute('value');
    const endVal = await page.locator('#graph-path-end option').filter({ hasText: 'YAML属性与标签体系' }).first().getAttribute('value');
    if (startVal) await page.locator('#graph-path-start').selectOption(startVal);
    if (endVal) await page.locator('#graph-path-end').selectOption(endVal);
    await page.locator('#graph-path-find').click();
    await expect(page.locator('#graph-path-result-bar')).toContainText('最短');
    await expect(page.locator('#graph-path-result-bar')).toContainText('跳');
    await page.screenshot({ path: path.join(output, 'graph-pathfinder-analytics.png') });
    await page.locator('#graph-path-clear').click();
    await page.locator('#global-graph-button').click();
    await expect(page.locator('#editor-stage')).toBeVisible();

    await openFromSearch('Canvas acceptance', 'whiteboard');
    await page.waitForSelector('#whiteboard-stage[data-ready="true"]');
    const wbNoteVal = await page.locator('#whiteboard-note-select option').filter({ hasText: '双链笔记与卡片盒方法' }).first().getAttribute('value');
    if (wbNoteVal) await page.locator('#whiteboard-note-select').selectOption(wbNoteVal);
    await page.locator('#whiteboard-insert-note-card').click();
    await expect(page.locator('#whiteboard-note-cards-bar')).toBeVisible();
    await expect(page.locator('#whiteboard-note-cards-bar [data-wb-card-target]').first()).toBeVisible();
    await page.locator('#whiteboard-save').click();
    await expect(page.locator('#whiteboard-save-state')).toHaveText('已保存');
    await page.screenshot({ path: path.join(output, 'whiteboard-note-cards.png') });
    await page.locator('#whiteboard-note-cards-bar [data-wb-card-target]').first().click();
    await expect(page.locator('#editor-stage')).toBeVisible();

    await openFromSearch('墨图导览');
    await expect(page.locator('#context-micro-flashcards')).toBeVisible();
    await page.locator('#context-micro-flashcards > summary').click();
    await expect(page.locator('#context-micro-sr-body')).toBeVisible();
    if (await page.locator('#context-micro-sr-body .context-micro-sr-card').count() > 0) {
      await page.locator('#context-micro-sr-body .context-micro-sr-card .context-micro-sr-flip').first().click();
      await expect(page.locator('#context-micro-sr-body .context-micro-sr-card .context-micro-sr-back').first()).toBeVisible();
    }
    await expect(page.locator('#inline-privacy-pill')).toBeVisible();
    await page.locator('#inline-privacy-pill').click();
    await expect(page.locator('#inline-privacy-popover')).toBeVisible();
    await page.locator('#inline-privacy-pill').click();
    await expect(page.locator('#inline-privacy-popover')).toBeHidden();

    // MAJOR-190 (1.9.0): Menu-hidden Multi-Window & Tear-Off Docking with Cross-Window Sync Bus
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#note-open-window-btn').click();
    await page.locator('#note-tools-menu-trigger').click();
    await expect(page.locator('#multi-window-hub-label')).toContainText('(2)');
    await page.locator('#multi-window-hub-btn').click();
    await expect(page.locator('#multi-window-dialog')).toBeVisible();
    await expect(page.locator('#multi-window-list .multi-window-item-card')).toHaveCount(2);
    await page.locator('#mw-spawn-graph-btn').click();
    await expect(page.locator('#multi-window-list .multi-window-item-card')).toHaveCount(3);
    await page.locator('#multi-window-sync-test-btn').click();
    await expect(page.locator('#multi-window-sync-log')).toContainText('广播跨窗双链同步事件');
    await page.screenshot({ path: path.join(output, 'multi-window-docking.png') });
    await page.locator('#multi-window-close-all-btn').click();
    await expect(page.locator('#multi-window-list .multi-window-item-card')).toHaveCount(1);
    await page.locator('#multi-window-close').click();
    await expect(page.locator('#multi-window-dialog')).toBeHidden();

    await page.locator('#special-tools-menu > summary').click();
    await page.locator('#special-tools-menu [data-action="onenote-import"]').click();
    await expect(page.locator('#onenote-com-dialog')).toBeVisible();
    await expect(page.locator('#onenote-com-provider-badge')).toHaveText('未连接');
    const exportFixture = '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" name="Creation migration fixture"><one:Outline><one:OE><one:T><![CDATA[Explicit exported document acceptance.]]></one:T></one:OE></one:Outline></one:Page>';
    await page.locator('#onenote-com-file-input').setInputFiles({ name: 'migration-fixture.xml', mimeType: 'application/xml', buffer: Buffer.from(exportFixture) });
    await expect(page.locator('#onenote-hierarchy-tree .onenote-tree-page-row').first()).toBeVisible();
    await page.locator('#onenote-com-target-folder').fill('Imported/OneNote'); await page.locator('#onenote-step-next').click();
    await page.locator('#onenote-preview-details > summary').click();
    await expect(page.locator('#onenote-com-preview')).toContainText('Explicit exported document acceptance.');
    await page.screenshot({ path: path.join(output, 'onenote-com-importer.png') });
    if (desktop) {
      await page.locator('#onenote-com-commit-btn').click();
      await expect(page.locator('#onenote-com-status')).toContainText('已成功迁入 1 篇');
      assert.ok((await readNotes()).some(note => note.relativePath.startsWith('Imported/OneNote/') && note.source.includes('Explicit exported document acceptance.')));
    } else await expect(page.locator('#onenote-com-commit-btn')).toBeDisabled();
    await page.locator('#onenote-com-close').click();
    await expect(page.locator('#onenote-com-dialog')).toBeHidden();

    // MAJOR-300: Portable Vault Archive (.inkloom-vault.zip) with SHA-256 Manifest Verification
    await page.locator('#special-tools-menu > summary').click();
    await page.locator('#special-tools-menu [data-action="vault-archive"]').click();
    await expect(page.locator('#vault-archive-dialog')).toBeVisible();
    await page.locator('#vault-archive-export-btn').click();
    await expect.poll(async () => await page.evaluate(() => window.__inkloomLastVaultArchiveMeta?.manifestSha256?.length || 0)).toBe(64);
    await page.locator('#vault-archive-verify-latest-btn').click();
    await expect(page.locator('#vault-archive-stats-bar')).toContainText('验签通过');
    await page.locator('#vault-archive-close-btn').click();
    await expect(page.locator('#vault-archive-dialog')).toBeHidden();

    // MAJOR-280, MAJOR-290 & MAJOR-310: Periodic Notes Hub, Writing Sprint & RFC 5545 .ics Sync
    await page.locator('[data-activity-id="workspace-home:home-view"]').click();
    await page.waitForSelector('#workspace-home[data-ready="true"]');
    await page.locator('#home-overview-tab').click();
    await page.locator('#home-periodic-menu-trigger').click();
    await expect(page.locator('#home-periodic-menu-panel')).toBeVisible();
    await expect(page.locator('#home-sprint-summary')).toContainText('今日');
    await expect(page.locator('#home-sprint-milestones [data-milestone-id]')).toHaveCount(4);
    await page.locator('#home-ics-sample-btn').click();
    await page.locator('#home-ics-import-btn').click();
    await expect(page.locator('#home-ics-status')).toContainText('成功同步');
    await expect.poll(async () => (await readNotes()).some(note => note.relativePath.replaceAll('\\', '/').startsWith('tasks/') && note.source.includes('深度学习与知识星图专题研讨'))).toBe(true);
    await page.waitForTimeout(250);
    if (!(await page.locator('#home-periodic-menu-panel').isVisible())) {
      await page.locator('#home-periodic-menu-trigger').click();
      await expect(page.locator('#home-periodic-menu-panel')).toBeVisible();
    }
    await page.locator('#home-ics-export-btn').click();
    await expect(page.locator('#home-ics-status')).toContainText('已导出');
    assert.ok((await page.locator('#home-ics-import-input').inputValue()).includes('BEGIN:VCALENDAR'));
    if (!(await page.locator('#home-periodic-menu-panel').isVisible())) {
      await page.locator('#home-periodic-menu-trigger').click();
      await expect(page.locator('#home-periodic-menu-panel')).toBeVisible();
    }
    await page.locator('#home-sprint-export-btn').click();
    await expect.poll(async () => (await readNotes()).some(note => note.relativePath.replaceAll('\\', '/').startsWith('journals/sprints/') && note.source.includes('写作目标冲刺与里程碑报告'))).toBe(true);
    await page.locator('#home-periodic-menu-trigger').click();
    await page.locator('#home-periodic-weekly').click();
    await expect(page.locator('#editor-stage')).toBeVisible();
    await expect.poll(async () => (await readNotes()).some(note => note.relativePath.replaceAll('\\', '/').startsWith('journals/weekly/') && note.source.includes('period_kind: weekly'))).toBe(true);
    await openFromSearch('墨图导览');

    return {
      userGuideNavigation: true,
      groundedAnswerAndRefusal: true,
      gemini4AndLocalSmolLm2Verified: true,
      credentialMaskedAndCleared: true,
      diffRevisionApplied: true,
      consistencyChecked: true,
      orphanWeavingAndDigestVerified: true,
      spacedRepetitionFlashcardsVerified: true,
      periodicNotesAndAnkiSyncVerified: true,
      shareCardAndWritingSprintVerified: true,
      portableVaultArchiveAndEmbedInspectorVerified: true,
      vaultSearchReplaceAndIcsSyncVerified: true,
      vaultDoctorAndObsidianSyntaxVerified: true,
      splitReferencePaneVerified: true,
      pluginPackageInstallUpgradeRollbackVerified: true,
      skillSavedAndSanitized: true,
      smartWikiLinkApplied: true,
      outerDewdropPerimeterUiVerified: true,
      inPlaceCopilotAndZeroFrictionEfficiencyVerified: true,
      inkloomUsageGuideFolderAndExcelTablePasteVerified: true,
      slidePresenterWikiExportAndNoteDiffVerified: true,
      spatialCanvasAndGraphAnalyticsVerified: true,
      localMcpAgentAndFolderSyncVerified: true,
      karpathyWikiCompilerAndChronicleVerified: true,
      oneNoteExportFixtureVerified: true,
      oneNoteLiveComVerified: false,
    };
  });
  await check('property panel saves YAML and preserves the body', async () => {
    const before = await savedNote('00-');
    await page.locator('#properties-button').click();
    await page.locator('#property-status').fill('进行中');
    await page.locator('#property-tags').fill('墨图核心, 验收标签');
    await page.locator('#apply-properties').click();
    await expect(page.locator('#note-properties-editor')).toBeHidden();
    await expect.poll(async () => (await savedNote('00-')).source).toContain('进行中');
    const after = await savedNote('00-');
    const body = source => source.slice(source.indexOf('\n---', 4) + 4);
    assert.equal(body(after.source), body(before.source)); assert.ok(after.source.includes('验收标签'));
    return { file: after.relativePath, status: '进行中', bodyPreserved: true };
  });
  await check('table and board filtering, persisted status and reopening', async () => {
    await page.locator('#database-button').click();
    await page.locator('#database-query').fill('YAML');
    await expect(page.locator('#database-count')).toHaveText('1 篇笔记');
    await page.locator('#database-content .note-status-select').selectOption('已完成');
    await expect.poll(async () => (await savedNote('04-')).source).toContain('已完成');
    await page.locator('#database-query').fill('');
    await page.locator('#database-board-mode').click();
    await expect(page.locator('.kanban-column[data-status="已完成"] .kanban-note')).toHaveCount(1);
    await page.screenshot({ path: path.join(output, '03-board.png') });
    await page.locator('.kanban-column[data-status="已完成"] .kanban-note .phase-command').click();
    await expect(page.locator('#note-title-badge')).toHaveText('YAML属性与标签体系');
    await expect(page.locator('#note-properties-pills')).toContainText('已完成');
    return { statusWritten: true, reopened: true };
  });
  await check('slash insertion, callout rendering, undo and code isolation', async () => {
    await page.locator('.view-tools [data-action="source"]').click();
    await page.locator('#source-editor .cm-content').click();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n/note');
    await expect(page.locator('#slash-menu')).toBeVisible();
    await page.locator('[data-slash-command="callout-note"]').click();
    await page.keyboard.insertText('Second phase acceptance');
    await expect(page.locator('#rich-editor [data-callout="NOTE"]')).toContainText('Second phase acceptance');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#rich-editor')).not.toContainText('Second phase acceptance');
    await page.keyboard.press('Control+y');
    await expect(page.locator('#rich-editor [data-callout="NOTE"]')).toContainText('Second phase acceptance');
    await page.locator('[data-action="save"]').click();
    await expect.poll(async () => (await savedNote('04-')).source).toContain('Second phase acceptance');
    await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n```text\n/note');
    await expect(page.locator('#slash-menu')).toBeHidden();
    await page.keyboard.insertText('\n```\n');
    await page.locator('[data-action="save"]').click();
    await expect.poll(async () => (await savedNote('04-')).source).toContain('```text\n/note\n```');
    await page.locator('[data-action="formatting-toolbar"]').click();
    await expect(page.locator('#toolbar-copy-code-btn')).toBeVisible();
    await page.locator('#toolbar-copy-code-btn').click();
    await expect.poll(() => page.evaluate(() => window.__inkloomLastCopiedText)).toBe('/note');
    await page.locator('[data-action="formatting-toolbar"]').click();
    await page.locator('#note-tools-menu-trigger').click();
    await page.locator('#zen-focus-button').click();
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await expect(page.locator('#activity-rail')).toBeHidden();
    await page.keyboard.press('Control+Shift+F');
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
    await expect(page.locator('#activity-rail')).toBeVisible();
    await page.locator('.view-tools [data-action="source"]').click();
    await page.locator('[data-context-tab="headings"]').click();
    await page.screenshot({ path: path.join(output, '04-callout.png') });
  });
  await check('rename preview and real saved backlinks', async () => {
    await page.locator('#rename-note-button').click();
    const original = (await savedNote('00-')).name;
    await page.locator('#rename-title').fill(original);
    await page.locator('#edit-form button[type="submit"]').click();
    await expect(page.locator('#edit-dialog')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('已存在');
    await page.locator('#rename-title').fill('04-Properties-Renamed');
    await expect(page.locator('#rename-preview')).toContainText('双链');
    await page.locator('#edit-form button[type="submit"]').click();
    await expect(page.locator('#edit-dialog')).toBeHidden();
    await expect(page.locator('#note-title-badge')).toHaveText('YAML属性与标签体系');
    await expect.poll(async () => (await readNotes()).some(note => note.name === '04-Properties-Renamed.md')).toBe(true);
    const notes = await readNotes(); assert.equal(notes.filter(note => note.name.startsWith('04-')).length, 1);
    const references = notes.filter(note => note.source.includes('[[04-Properties-Renamed')); assert.ok(references.length >= 2);
    await openFromSearch('墨图导览');
    await expect(page.locator('#rich-editor .wikilink-token[data-wikilink-target="04-Properties-Renamed"]')).toHaveCount(1);
    await page.locator('#rich-editor .wikilink-token[data-wikilink-target="04-Properties-Renamed"]').click();
    await expect(page.locator('#note-title-badge')).toHaveText('YAML属性与标签体系');
    return { files: notes.length, rewrittenFiles: references.map(note => note.relativePath) };
  });
  await check('special-character title is text, not executable HTML', async () => {
    const title = '<img src=x onerror="window.inkloomInjection=1">';
    await page.locator('#properties-button').click();
    await page.locator('#property-title').fill(title); await page.locator('#apply-properties').click();
    await expect(page.locator('#note-properties-editor')).toBeHidden();
    await expect(page.locator('#note-title-badge')).toHaveText(title);
    assert.equal(await page.locator('img[src="x"]').count(), 0); assert.equal(await page.evaluate(() => window.inkloomInjection), undefined);
    await page.locator('#properties-button').click(); await page.locator('#property-title').fill('YAML属性与标签体系'); await page.locator('#apply-properties').click();
    await expect(page.locator('#note-properties-editor')).toBeHidden();
  });
  if (desktop) await check('image import and embedding setting save actual image bytes', async () => {
    await page.locator('[data-action="settings"]').click();
    const editing = page.locator('[data-settings-group="editing"]');
    if (!await editing.evaluate(node => node.open)) await editing.locator('summary').click();
    await page.locator('#compress-input').check();
    await page.locator('#embed-images-input').click();
    await expect(page.locator('#embed-warning-dialog')).toBeVisible();
    await page.locator('#embed-warning-dialog button[value="enable"]').click();
    await expect(page.locator('#embed-images-input')).toBeChecked();
    await page.locator('#settings-dialog .dialog-footer button').click();
    await page.locator('.view-tools [data-action="source"]').click();
    await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n');
    await page.locator('#image-input').setInputFiles(path.join(root, 'app/public/inkloom.png'));
    await expect(page.locator('#rich-editor img.document-image')).toHaveCount(1);
    await page.locator('[data-action="save"]').click();
    await expect.poll(async () => (await savedNote('04-')).source).toContain('data:image/png;base64,');
    await page.locator('.view-tools [data-action="source"]').click();
    return { embeddedImage: true, persisted: true };
  });
  await check('graph canvas contains visible nodes and edges', async () => {
    await page.locator('#global-graph-button').click();
    await expect(page.locator('#global-graph-stage')).toBeVisible();
    if (phase === 'phase3') await expect(page.locator('#global-graph-canvas')).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
    const result = await page.locator('#global-graph-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset + 3] > 128 && pixels[offset] < 180) ink++;
      return { width: canvas.width, height: canvas.height, ink };
    }); assert.ok(result.ink > 100); assert.ok(result.width > 100);
    await page.screenshot({ path: path.join(output, '05-graph.png') });
    await page.locator('#global-graph-button').click(); return result;
  });
  if (!desktop) await check('390px and 820px layout, settings and logo remain reachable', async () => {
    const layouts = [];
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-action="settings"]').click();
      await expect(page.locator('#settings-dialog')).toBeVisible();
      const result = await page.evaluate(() => {
        const dialog = document.querySelector('#settings-dialog'); const bounds = dialog.getBoundingClientRect();
        return { width: innerWidth, left: bounds.left, right: bounds.right, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth };
      });
      assert.ok(result.left >= 0 && result.right <= width + 1); assert.ok(result.scrollWidth <= result.clientWidth + 1);
      await page.screenshot({ path: path.join(output, '06-settings-' + width + '.png') }); layouts.push(result);
      await page.locator('#settings-dialog .dialog-footer button').click();
    }
    return layouts;
  });
  if (phase === 'phase3') {
    if (!desktop) await page.setViewportSize({ width: 1440, height: 960 });
    const diagnostics = () => page.locator('#activity-rail').evaluate(node => JSON.parse(node.dataset.pluginDiagnostics));
    const activity = id => page.locator(`[data-activity-id="${id}"]`);
    async function openPluginSettings() {
      await page.locator('#settings-button').click();
      const group = page.locator('[data-settings-group="extensions"]'); if (!await group.evaluate(node => node.open)) await group.locator('summary').click();
    }
    await check('graph plugin releases layout workers, preserves viewport and supports filters and node navigation', async () => {
      const workers = () => page.workers().filter(worker => worker.url().includes('graph-layout-worker')).length;
      await expect(page.locator('#global-graph-stage')).toHaveCount(0);
      await expect.poll(workers).toBe(1);
      await page.locator('#context-sidebar-toggle').click(); await expect(page.locator('#local-graph-canvas')).toHaveCount(0); await expect.poll(workers).toBe(0);
      await page.locator('#context-sidebar-toggle').click(); await expect(page.locator('#local-graph-canvas')).toHaveCount(1); await expect.poll(workers).toBe(1);
      await page.locator('#local-depth-toggle').selectOption('2'); await expect(page.locator('#local-depth-toggle')).toHaveValue('2');
      await page.locator('#local-tag-toggle').check();
      await page.locator('#global-graph-button').click(); await expect(page.locator('#global-graph-stage')).toBeVisible(); await expect.poll(workers).toBe(2);
      const canvas = page.locator('#global-graph-canvas');
      await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      const all = Number(await page.locator('#global-graph-stage').getAttribute('data-node-count')); assert.ok(all >= 7);
      await page.locator('[data-graph-mode="orphans"]').click(); await expect.poll(async () => Number(await page.locator('#global-graph-stage').getAttribute('data-node-count'))).toBeLessThan(all);
      await page.locator('[data-graph-mode="ghosts"]').click(); await expect(page.locator('[data-graph-mode="ghosts"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-graph-mode="all"]').click(); await expect(page.locator('#global-graph-stage')).toHaveAttribute('data-node-count', String(all));
      await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      await page.locator('#graph-search-input').fill('YAML'); await expect(page.locator('#global-graph-stage')).toHaveAttribute('data-applied-query', 'YAML');
      await page.locator('#global-graph-stage [data-graph-command="in"]').click();
      const before = createHash('sha256').update(await canvas.evaluate(node => node.toDataURL())).digest('hex');
      await page.locator('#global-graph-button').click(); await expect(canvas).toHaveCount(0); await expect.poll(workers).toBe(1);
      await page.locator('#global-graph-button').click(); await expect(page.locator('#graph-search-input')).toHaveValue('YAML');
      await expect(page.locator('#global-graph-stage')).toHaveAttribute('data-applied-query', 'YAML');
      await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited|manual)$/);
      assert.equal(createHash('sha256').update(await canvas.evaluate(node => node.toDataURL())).digest('hex'), before);
      await page.locator('#graph-search-input').fill('');
      await expect(page.locator('#global-graph-stage')).toHaveAttribute('data-applied-query', '');
      await page.locator('#global-graph-stage [data-graph-command="layout"]').click(); await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      await openPluginSettings(); await page.locator('[data-plugin-id="knowledge-graph"]').uncheck();
      await expect(page.locator('#global-graph-button')).toHaveCount(0); await expect(page.locator('#global-graph-canvas')).toHaveCount(0); await expect(page.locator('#local-graph-canvas')).toHaveCount(0); await expect.poll(workers).toBe(0);
      assert.equal((await diagnostics()).plugins.find(plugin => plugin.id === 'knowledge-graph').resources, 0);
      await page.locator('[data-plugin-id="knowledge-graph"]').check(); await expect(page.locator('#global-graph-button')).toHaveCount(1); await expect.poll(workers).toBe(1);
      await page.locator('#settings-dialog .dialog-footer button').click();
      await page.locator('#global-graph-button').click(); await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      const box = await canvas.boundingBox(); await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 30, { steps: 4 }); await page.mouse.up();
      await expect(canvas).toHaveAttribute('data-layout-state', 'manual');
      await page.screenshot({ path: path.join(output, '11-graph-plugin.png') });
      await page.locator('[data-graph-mode="orphans"]').click(); await expect(page.locator('#global-graph-stage')).toHaveAttribute('data-node-count', '1');
      await expect(canvas).toHaveAttribute('data-layout-state', /^(ready|budget-limited)$/);
      const nodeBox = await canvas.boundingBox();
      await canvas.hover({ position: { x: nodeBox.width / 2, y: nodeBox.height / 2 } });
      await expect(page.locator('#global-graph-inspector')).toBeVisible();
      const targetTitle = await page.locator('#global-graph-inspector h3').textContent();
      await canvas.click({ position: { x: nodeBox.width / 2, y: nodeBox.height / 2 } });
      await expect(page.locator('#global-graph-stage')).toHaveCount(0); await expect(page.locator('#note-title-badge')).toHaveText(targetTitle);
      await expect.poll(workers).toBe(1);
      await page.locator('#global-graph-button').click(); await page.locator('[data-graph-mode="all"]').click(); await expect(page.locator('[data-graph-mode="all"]')).toHaveAttribute('aria-pressed', 'true'); await page.locator('#global-graph-button').click();
      await page.locator('#local-depth-toggle').selectOption('1'); await page.locator('#local-tag-toggle').uncheck();
      return { activeWorkers: 1, stoppedWorkers: 0, stoppedResources: 0, filters: true, viewportRestored: true, pointerDrag: true, openedNoteTitle: targetTitle };
    });
    await check('phase3 activity navigation, keyboard, settings and plugin lifecycle', async () => {
      const width = await page.locator('#activity-rail').evaluate(node => node.getBoundingClientRect().width); assert.ok(width >= 40 && width <= 46);
      await activity('core-navigation:tags-view').click(); await expect(page.locator('#tags-panel')).toBeVisible();
      await activity('core-navigation:tags-view').focus(); await page.keyboard.press('ArrowDown'); await expect(activity('core-navigation:starred-view')).toBeFocused();
      await activity('unlinked-notes:note-list').click(); await expect(page.locator('#plugin-stage')).toBeVisible();
      await expect(page.locator('#plugin-stage h2')).toHaveText('未关联笔记');
      await page.screenshot({ path: path.join(output, '07-plugin-view.png') });
      await openPluginSettings();
      const plugin = page.locator('[data-plugin-id="unlinked-notes"]'); await plugin.uncheck();
      await expect(activity('unlinked-notes:note-list')).toHaveCount(0);
      const disabled = (await diagnostics()).plugins.find(item => item.id === 'unlinked-notes'); assert.equal(disabled.state, 'disabled'); assert.equal(disabled.resources, 0);
      await plugin.check(); await expect(activity('unlinked-notes:note-list')).toHaveCount(1);
      const enabled = (await diagnostics()).plugins.find(item => item.id === 'unlinked-notes'); assert.ok(enabled.resources > 0);
      await page.locator('#setting-activityLabels').check(); await expect(page.locator('#activity-rail')).toHaveAttribute('data-labels', 'true');
      await page.locator('#setting-activityLabels').uncheck();
      await page.getByRole('button', { name: '隐藏标签', exact: true }).click(); await expect(activity('core-navigation:tags-view')).toHaveCount(0);
      await page.getByRole('button', { name: '显示标签', exact: true }).click(); await expect(activity('core-navigation:tags-view')).toHaveCount(1);
      await page.getByRole('button', { name: '固定知识库', exact: true }).click(); await expect(activity('core-navigation:vault-view')).toHaveClass(/pinned/);
      const beforeMove = await page.locator('.activity-entries button').evaluateAll(buttons => buttons.map(button => button.dataset.activityId));
      await page.getByRole('button', { name: '上移标签', exact: true }).click(); const afterMove = await page.locator('.activity-entries button').evaluateAll(buttons => buttons.map(button => button.dataset.activityId));
      assert.equal(afterMove.indexOf('core-navigation:tags-view'), beforeMove.indexOf('core-navigation:tags-view') - 1);
      await page.locator('#setting-pluginSafeMode').check(); await expect(activity('unlinked-notes:note-list')).toHaveCount(0);
      assert.equal((await diagnostics()).plugins.find(item => item.id === 'core-navigation').state, 'enabled');
      await page.locator('#setting-pluginSafeMode').uncheck(); await expect(activity('unlinked-notes:note-list')).toHaveCount(1);
      await page.screenshot({ path: path.join(output, '08-plugin-settings.png') });
      await page.locator('#settings-dialog .dialog-footer button').click();
      return { railWidth: width, disabled, enabled };
    });
    await check('phase3 opaque iframe denies parent DOM, storage, source read, writes, network and execution', async () => {
      await openPluginSettings(); await page.locator('[data-plugin-id="sandbox-inspector"]').check();
      const frame = page.locator('[data-plugin-sandbox="sandbox-inspector"]'); await expect(frame).toHaveCount(1);
      await expect(frame).toHaveAttribute('data-isolation-evidence', /parentDom/);
      const result = JSON.parse(await frame.getAttribute('data-isolation-evidence')); assert.ok(Object.values(result).every(Boolean));
      await expect(activity('sandbox-inspector:sandbox-list')).toHaveCount(1);
      const limit = page.locator('[data-plugin-setting="sandbox-inspector:row-limit"]');
      await limit.fill('2'); await limit.press('Tab');
      await page.locator('#settings-dialog .dialog-footer button').click();
      await page.keyboard.press('Control+Shift+I'); await expect(page.locator('#plugin-stage')).toBeVisible();
      await expect(page.locator('#plugin-stage .plugin-note-row')).toHaveCount(2);
      await openPluginSettings(); await limit.fill('50'); await limit.press('Tab'); await page.locator('#settings-dialog .dialog-footer button').click();
      await expect(page.locator('#plugin-stage .plugin-note-row')).toHaveCount(22);
      await page.locator('#properties-button').click(); const originalTitle = await page.locator('#property-title').inputValue();
      await page.locator('#property-title').fill('Bridge event refresh'); await page.locator('#apply-properties').click();
      await expect(page.locator('#note-properties-editor')).toBeHidden(); await expect(page.locator('#plugin-stage')).toContainText('Bridge event refresh');
      await page.locator('#properties-button').click(); await page.locator('#property-title').fill(originalTitle); await page.locator('#apply-properties').click();
      await expect(page.locator('#note-properties-editor')).toBeHidden(); await expect(page.locator('#plugin-stage')).not.toContainText('Bridge event refresh');
      await openPluginSettings();
      await page.locator('[data-plugin-id="sandbox-inspector"]').uncheck(); await expect(frame).toHaveCount(0); await expect(activity('sandbox-inspector:sandbox-list')).toHaveCount(0);
      const state = (await diagnostics()).plugins.find(item => item.id === 'sandbox-inspector'); assert.equal(state.resources, 0);
      await page.locator('#settings-dialog .dialog-footer button').click(); return { ...result, declarativeSettings: true, commandBridge: true, settingsEvent: true, vaultEvent: true };
    });
    await check('phase3 editing reparses one note and latest content is saved', async () => {
      await activity('knowledge-graph:global-view').click(); await page.locator('#global-graph-button').click();
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      const before = Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'));
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nPhase3 incremental final content\n');
      await expect.poll(async () => Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'))).toBe(before + 1);
      await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await readNotes()).some(note => note.source.includes('Phase3 incremental final content'))).toBe(true);
      return { parsedDelta: 1 };
    });
    await check('note views plugin mounts lazily, preserves filters, releases resources and rejects dirty writes', async () => {
      await expect(page.locator('#database-stage')).toHaveCount(0);
      const baseline = await diagnostics();
      await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toBeVisible();
      await page.locator('#database-query').fill('YAML'); await expect(page.locator('#database-count')).toHaveText('1 篇笔记');
      await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toHaveCount(0);
      assert.equal((await diagnostics()).mountedViews, baseline.mountedViews); assert.equal((await diagnostics()).listeners, baseline.listeners);
      await page.locator('#database-button').click(); await expect(page.locator('#database-query')).toHaveValue('YAML');
      await expect(page.locator('#database-count')).toHaveText('1 篇笔记');
      await page.locator('#database-board-mode').click();
      const before = await savedNote('04-');
      await expect(page.locator('#database-stage')).not.toHaveAttribute('aria-busy', 'true');
      await page.locator('.kanban-note').first().dragTo(page.locator('.kanban-column[data-status="进行中"]'));
      await expect.poll(async () => (await savedNote('04-')).source).toContain('status: 进行中');
      await expect(page.locator('#database-content .note-status-select')).toHaveValue('进行中');
      await page.locator('#database-content .note-status-select').selectOption('已完成');
      await expect.poll(async () => (await savedNote('04-')).source).toBe(before.source);
      await openPluginSettings(); await page.locator('[data-plugin-id="note-views"]').uncheck();
      await expect(page.locator('#database-button')).toHaveCount(0); await expect(page.locator('#database-stage')).toHaveCount(0);
      const stopped = (await diagnostics()).plugins.find(plugin => plugin.id === 'note-views'); assert.equal(stopped.resources, 0);
      await page.locator('[data-plugin-id="note-views"]').check(); await expect(page.locator('#database-button')).toHaveCount(1);
      await page.locator('#settings-dialog .dialog-footer button').click();
      await openFromSearch('YAML属性与标签体系');
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUNSAVED_NOTE_VIEW_CHECK\n');
      await page.locator('#database-button').click(); await page.locator('#database-query').fill('YAML'); await expect(page.locator('#database-count')).toHaveText('1 篇笔记');
      await page.locator('#database-table-mode').click(); await page.locator('#database-content .note-status-select').selectOption('进行中');
      await expect(page.locator('.database-error')).toContainText('未保存'); assert.equal((await savedNote('04-')).source, before.source);
      await page.screenshot({ path: path.join(output, '10-note-views-conflict.png') });
      await page.locator('#database-button').click(); await expect(page.locator('#source-editor')).toContainText('UNSAVED_NOTE_VIEW_CHECK');
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+z'); await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await savedNote('04-')).source).toBe(before.source);
      return { databaseMounted: false, remainingMountedViews: baseline.mountedViews, stoppedResources: stopped.resources, filtersPreserved: true, dragPersistedAndRestored: true, dirtyWriteRejected: true };
    });
    if (desktop) await check('vault management switches safely, diagnoses scans and restores an uncommitted rename from the UI', async () => {
      const originalVault = path.join(profile, 'StarterVault'); const managed = path.join(profile, 'ManagedVault'); const empty = path.join(profile, 'EmptyVault');
      await mkdir(managed); await mkdir(empty);
      const first = path.join(managed, 'First.md'); const referring = path.join(managed, 'Ref.md');
      await writeFile(first, '\uFEFF# First\r\n'); await writeFile(referring, '[[First]]\r\n'); const firstBytes = await readFile(first); const refBytes = await readFile(referring);
      const openManager = async () => {
        await page.locator('[data-action="settings"]').click();
        const group = page.locator('[data-settings-group="knowledge"]'); if (!await group.getAttribute('open').then(value => value !== null)) await group.locator('summary').click();
        await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false');
      };
      const choosePath = async (folder, enter = false) => { await page.locator('#vault-path-input').fill(folder); if (enter) await page.locator('#vault-path-input').press('Enter'); else await page.locator('#vault-open-path').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false'); };
      const closeManager = () => page.locator('#settings-dialog .dialog-footer button').click();
      await openManager(); await choosePath(managed, true); await expect(page.locator('#vault-count')).toHaveText('2'); await closeManager();
      await expect(page.locator('#file-name')).toHaveText('First.md'); await expect(page.locator('#rich-editor')).toContainText('First');
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUNSAVED_SWITCH_CHECK\n');
      await openManager(); await choosePath(empty); await expect(page.locator('#vault-manager-status')).toContainText('未保存'); await expect(page.locator('#vault-count')).toHaveText('2'); await closeManager();
      await expect(page.locator('#source-editor')).toContainText('UNSAVED_SWITCH_CHECK'); await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+z'); await page.locator('[data-action="save"]').click();
      await openManager(); await choosePath(path.join(profile, 'missing-vault')); await expect(page.locator('#vault-manager-status')).toContainText('不存在'); await expect(page.locator('#vault-count')).toHaveText('2');
      await choosePath(empty); await expect(page.locator('#vault-count')).toHaveText('0'); await closeManager(); await expect(page.locator('#source-editor .cm-content')).toHaveText('');
      await openManager(); await choosePath(managed); await closeManager(); await expect(page.locator('#file-name')).toHaveText('First.md');
      await writeFile(path.join(managed, 'Bad.md'), Buffer.from([255, 254, 40, 0]));
      await openManager(); await page.locator('#vault-manager-rescan').click(); await expect(page.locator('#vault-scan-warnings')).toContainText('Bad.md');
      await page.screenshot({ path: path.join(output, '14-vault-diagnostics.png') });
      await unlink(path.join(managed, 'Bad.md')); await page.locator('#vault-manager-rescan').click(); await expect(page.locator('#vault-scan-warnings')).toBeHidden(); await closeManager();
      await expect(page.locator('#workspace')).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#settings-button')).toBeEnabled();
      await page.locator('#rename-note-button').click(); await page.locator('#rename-title').fill('Moved'); await page.locator('#edit-form button[type="submit"]').click(); await expect(page.locator('#edit-dialog')).toBeHidden();
      await expect(page.locator('#file-name')).toHaveText('Moved.md');
      const journalRoot = path.join(profile, 'rename-journals'); let journal;
      for (const name of await readdir(journalRoot)) { const directory = path.join(journalRoot, name); const manifest = JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8')); if (manifest.vaultPath === managed) journal = directory; }
      assert.ok(journal); await unlink(path.join(journal, 'COMMITTED'));
      await openManager(); await page.locator('#vault-recovery-refresh').click();
      const row = page.locator(`[data-recovery-id="${path.basename(journal)}"]`); await expect(row).toHaveCount(1); await row.click();
      await expect(page.locator('#vault-recovery-message')).toContainText('可恢复'); await expect(page.locator('#vault-recovery-restore')).toBeDisabled();
      const movedRef = await readFile(referring); await writeFile(referring, 'EXTERNAL_BEFORE_CONFIRM\n');
      await page.locator('#vault-recovery-confirm').check(); await page.locator('#vault-recovery-restore').click(); await expect(page.locator('#vault-manager-status')).toContainText('重新预览');
      assert.equal(await readFile(referring, 'utf8'), 'EXTERNAL_BEFORE_CONFIRM\n');
      await writeFile(referring, movedRef); await row.click(); await expect(page.locator('#vault-recovery-message')).toContainText('可恢复');
      await page.screenshot({ path: path.join(output, '15-recovery-preview.png') });
      await page.locator('#vault-recovery-confirm').check(); await page.locator('#vault-recovery-restore').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false');
      await expect(row).toHaveCount(0); await closeManager(); await expect(page.locator('#file-name')).toHaveText('First.md');
      assert.deepEqual(await readFile(first), firstBytes); assert.deepEqual(await readFile(referring), refBytes); await stat(path.join(journal, 'ROLLED_BACK'));
      const copies = [];
      for (let index = 0; index < 26; index++) {
        const directory = path.join(journalRoot, 'eeeeeeeeeeeeeeeeeeee' + index.toString(16).padStart(12, '0')); await mkdir(directory); copies.push(directory);
        await writeFile(path.join(directory, 'plan.json'), JSON.stringify({ format: 0, oldPath: first, newPath: path.join(managed, 'Moved.md'), files: [] }));
      }
      await openManager(); await page.locator('#vault-recovery-refresh').click(); await expect(page.locator('#vault-recovery-list button')).toHaveCount(25);
      await page.locator('#vault-recovery-next').click(); await expect(page.locator('#vault-recovery-list button')).toHaveCount(1);
      await page.locator('#vault-recovery-list button').click(); await expect(page.locator('#vault-recovery-message')).toContainText('旧版'); await expect(page.locator('#vault-recovery-restore')).toBeDisabled();
      for (const directory of copies) await rm(directory, { recursive: true }); await closeManager();
      await openManager(); await choosePath(originalVault); await closeManager(); await expect(page.locator('#vault-count')).toHaveText('22');
      return { realUiPathSwitch: true, dirtySwitchBlocked: true, missingPathPreservesVault: true, emptyVaultClearsEditor: true, scanWarningVisible: true, stalePreviewRejected: true, restoredBytes: true, recoveryPagination: true, legacyReadOnly: true, simulatedInterruptedCommit: 'removed COMMITTED from an isolated completed test transaction; no process crash simulated' };
    });
    if (desktop) await check('startup preferences and recent vaults survive real executable restarts', async () => {
      const managed = path.join(profile, 'ManagedVault'); const originalVault = path.join(profile, 'StarterVault');
      const openManager = async () => { await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="knowledge"]'); if (await group.getAttribute('open') === null) await group.locator('summary').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false'); };
      const closeManager = () => page.locator('#settings-dialog .dialog-footer button').click();
      const setMode = async (mode, name) => {
        await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false');
        await page.locator('#vault-startup-mode').selectOption(mode);
        if (name) { const value = await page.locator('#vault-startup-note option').filter({ hasText: name }).getAttribute('value'); await page.locator('#vault-startup-note').selectOption(value); }
        await page.locator('#vault-startup-save').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('#vault-startup-mode')).toHaveValue(mode);
      };
      const restart = async () => {
        let timeout;
        const exited = new Promise((resolve, reject) => { child.once('exit', resolve); timeout = setTimeout(() => reject(new Error('Test executable did not close normally')), 12000); });
        try { await page.evaluate(() => window.chrome.webview.postMessage({ id: 'verification-close', command: 'finishClose', args: {} })); await exited; }
        finally { clearTimeout(timeout); }
        await browser.close().catch(() => {}); page = null;
        const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
        child = spawn(path.resolve(process.argv[executableArgument + 1]), ['--profile', profile, '--debug-port', String(port)], { stdio: 'ignore' });
        await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 2000 }); }).toPass({ timeout: 25000, intervals: [200, 500, 1000] });
        await expect(() => { page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('https://inkloom.local')); assert.ok(page); }).toPass({ timeout: 15000 });
        page.on('pageerror', error => report.errors.push(error.message));
        page.on('request', request => { if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|inkloom\.local|inkloom-files\.local)([:/]|$)/.test(request.url())) report.externalRequests.push(request.url()); });
        await page.waitForSelector('#database-button', { timeout: 30000 });
      };
      await openManager(); const recentManaged = page.locator('[data-recent-path]').filter({ hasText: 'ManagedVault' }); await expect(recentManaged).toHaveCount(1); await recentManaged.click();
      await expect(page.locator('#vault-count')).toHaveText('2'); await setMode('note', 'Ref.md'); await closeManager();
      await restart(); await expect(page.locator('#file-name')).toHaveText('Ref.md');
      await openManager(); await expect(page.locator('#vault-startup-mode')).toHaveValue('note'); await setMode('last'); await closeManager();
      await openFromSearch('First'); await expect(page.locator('#file-name')).toHaveText('First.md');
      await restart(); await expect(page.locator('#file-name')).toHaveText('First.md');
      await openManager(); await setMode('blank'); await closeManager(); await restart();
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await expect(page.locator('#source-editor .cm-content')).toHaveText(''); await expect(page.locator('#vault-count')).toHaveText('2');
      await openManager(); await setMode('first');
      await page.locator('[data-recent-path]').filter({ hasText: 'StarterVault' }).click(); await expect(page.locator('#vault-count')).toHaveText('22');
      const managedForget = page.locator('.vault-recent-row').filter({ hasText: 'ManagedVault' }).locator('[data-forget-path]'); await expect(managedForget).toHaveCount(1); await managedForget.click();
      await expect(page.locator('.vault-recent-row').filter({ hasText: 'ManagedVault' })).toHaveCount(0); await stat(managed);
      await page.screenshot({ path: path.join(output, '16-startup-and-recent-vaults.png') }); await closeManager();
      return { restarts: 3, normalClose: 'existing finishClose native command on the isolated test process', fixedNote: true, lastNote: true, blankMode: true, recentEntryOpensVault: true, removalKeepsDirectory: true, originalVault };
    });
    if (desktop) await check('identity manifests round-trip through the management UI without modifying notes', async () => {
      const originalVault = path.join(profile, 'StarterVault'); const copied = path.join(profile, 'CopiedVault'); await mkdir(copied);
      const notes = await readNotes(); for (const note of notes) { const file = path.join(copied, note.relativePath); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, await readFile(path.join(originalVault, note.relativePath))); }
      const openManager = async () => { await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="knowledge"]'); if (await group.getAttribute('open') === null) await group.locator('summary').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false'); };
      const manifest = path.join(profile, 'portable.inkloom-identity.json');
      await openManager(); await page.locator('#vault-identity-path').fill(manifest); await page.locator('#vault-identity-export').click(); await expect(page.locator('#vault-identity-message')).toContainText('已导出');
      const exported = JSON.parse(await readFile(manifest, 'utf8')); assert.equal(exported.notes.length, 22);
      await page.locator('#vault-path-input').fill(copied); await page.locator('#vault-open-path').click(); await expect(page.locator('#vault-manager')).toHaveAttribute('aria-busy', 'false');
      await page.locator('#vault-identity-path').fill(manifest); await page.locator('#vault-identity-select').click(); await expect(page.locator('#vault-identity-message')).toContainText('文件与清单一致');
      await expect(page.locator('#vault-identity-import')).toBeDisabled(); await page.locator('#vault-identity-confirm').check(); await page.locator('#vault-identity-import').click(); await expect(page.locator('#vault-identity-message')).toContainText('正文未改动');
      await page.screenshot({ path: path.join(output, '17-identity-migration.png') });
      await page.locator('#settings-dialog .dialog-footer button').click();
      for (const note of exported.notes) { await expect(page.locator(`#vault-tree-list [data-vault-note-id="${note.id}"]`)).toHaveCount(1); assert.equal(createHash('sha256').update(await readFile(path.join(copied, note.relativePath))).digest('hex'), note.sha256); }
      await openManager(); await page.locator('#vault-path-input').fill(originalVault); await page.locator('#vault-open-path').click(); await page.locator('#settings-dialog .dialog-footer button').click();
      return { uiExport: true, uiPreview: true, explicitConfirmation: true, identitiesRestored: true, allFileHashesPreserved: true };
    });
    await check('repeated view and plugin lifecycle leaves no owned resources or workers', async () => {
      const client = await page.context().newCDPSession(page); await client.send('HeapProfiler.collectGarbage'); const before = await client.send('Runtime.getHeapUsage');
      const metricsBefore = desktop ? await nativeCommand('runtimeMetrics') : null;
      for (let round = 0; round < 50; round++) {
        await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toBeVisible(); await page.locator('#database-button').click(); await expect(page.locator('#database-stage')).toHaveCount(0);
        await page.locator('#global-graph-button').click(); await expect(page.locator('#global-graph-canvas')).toHaveCount(1); await page.locator('#global-graph-button').click(); await expect(page.locator('#global-graph-canvas')).toHaveCount(0);
      }
      await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="extensions"]'); if (await group.getAttribute('open') === null) await group.locator('summary').click();
      for (let round = 0; round < 25; round++) {
        await page.locator('[data-plugin-id="knowledge-graph"]').uncheck(); await expect.poll(() => page.workers().filter(worker => worker.url().includes('graph-layout-worker')).length).toBe(0);
        await page.locator('[data-plugin-id="knowledge-graph"]').check(); await expect(page.locator('#global-graph-button')).toHaveCount(1);
        await page.locator('[data-plugin-id="note-views"]').uncheck(); await page.locator('[data-plugin-id="note-views"]').check(); await expect(page.locator('#database-button')).toHaveCount(1);
      }
      const details = await page.locator('#activity-rail').evaluate(node => JSON.parse(node.dataset.pluginDiagnostics));
      await page.locator('[data-plugin-id="knowledge-graph"]').uncheck(); await page.locator('[data-plugin-id="note-views"]').uncheck();
      const stopped = await page.locator('#activity-rail').evaluate(node => JSON.parse(node.dataset.pluginDiagnostics));
      assert.ok(stopped.plugins.filter(plugin => ['knowledge-graph', 'note-views'].includes(plugin.id)).every(plugin => plugin.resources === 0));
      await client.send('HeapProfiler.collectGarbage'); const after = await client.send('Runtime.getHeapUsage'); const metricsAfter = desktop ? await nativeCommand('runtimeMetrics') : null;
      assert.ok(after.usedSize - before.usedSize < 48 * 1024 * 1024, 'Retained JS heap grew by over 48 MiB during lifecycle test');
      if (metricsAfter) { assert.ok(metricsAfter.processes.length >= 2); assert.ok(metricsAfter.privateBytes - metricsBefore.privateBytes < 384 * 1024 * 1024, 'Native private memory growth exceeded lifecycle budget'); }
      await page.locator('[data-plugin-id="knowledge-graph"]').check(); await page.locator('[data-plugin-id="note-views"]').check(); await page.locator('#settings-dialog .dialog-footer button').click(); await client.detach();
      return { viewCycles: 50, pluginCycles: 25, liveMountsBeforeDisable: details.mountedViews, stoppedResources: 0, heapBefore: before.usedSize, heapAfter: after.usedSize, nativeBefore: metricsBefore, nativeAfter: metricsAfter, method: 'controlled finite soak, not an overnight leak proof' };
    });
    if (desktop) await check('long Chinese Markdown and local image remain editable and retain bytes', async () => {
      const directory = path.join(profile, 'StarterVault'); const file = path.join(directory, 'LongChinese.md'); const image = path.join(directory, 'local-proof.png');
      await writeFile(image, await readFile(path.join(root, 'assets/logo-source.png')));
      const source = '# LongChinese\n\n' + Array.from({ length: 3000 }, (_, index) => `第${index}段：这是中文长稿的连续阅读与编辑校验，包含标点、数字${index}和本地知识记录。\n\n`).join('') + '![本地图片](local-proof.png)\n';
      await writeFile(file, source); await expect(page.locator('[data-vault-note-id]').filter({ hasText: 'LongChinese' })).toHaveCount(1, { timeout: 20000 });
      const started = performance.now(); await openFromSearch('LongChinese');
      const localImage = page.locator('#rich-editor img[alt="本地图片"]'); await localImage.scrollIntoViewIfNeeded(); await expect(localImage).toBeVisible({ timeout: 20000 });
      await expect.poll(() => localImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n中文编辑回读确认。\n'); await page.locator('[data-action="save"]').click();
      await expect.poll(async () => (await readFile(file, 'utf8').catch(() => '')).includes('中文编辑回读确认。')).toBe(true);
      const metrics = await nativeCommand('runtimeMetrics'); await page.screenshot({ path: path.join(output, '18-chinese-long-document.png') });
      await openFromSearch('墨图导览'); await unlink(file); await unlink(image); await expect(page.locator('[data-vault-note-id]').filter({ hasText: 'LongChinese' })).toHaveCount(0, { timeout: 20000 });
      return { paragraphs: 3000, bytes: Buffer.byteLength(source), openEditSaveMs: Math.round(performance.now() - started), localImageRendered: true, nativeMetrics: metrics, input: 'Playwright Unicode insertion, not a physical Chinese IME test' };
    });
    if (desktop) await check('phase3 external create, reload, move, delete and dirty conflict preserve data', async () => {
      const vaultDirectory = path.join(profile, 'StarterVault');
      const probe = path.join(vaultDirectory, 'ExternalProbe.md'); await writeFile(probe, '# ExternalProbe\nInitial external text\n');
      const originalRow = page.locator('[data-vault-note-id]').filter({ hasText: 'ExternalProbe' }); await expect(originalRow).toHaveCount(1, { timeout: 12000 });
      const stableId = await originalRow.getAttribute('data-vault-note-id');
      await openFromSearch('ExternalProbe'); await expect(page.locator('#rich-editor')).toContainText('Initial external text');
      await writeFile(probe, '# ExternalProbe\nExternal updated text\n'); await expect(page.locator('#rich-editor')).toContainText('External updated text', { timeout: 12000 });
      const moved = path.join(vaultDirectory, 'ExternalMoved.md'); await rename(probe, moved);
      await expect(page.locator('#file-name')).toHaveText('ExternalMoved.md', { timeout: 12000 });
      await expect(page.locator(`[data-vault-note-id="${stableId}"]`)).toHaveCount(1);
      const removed = path.join(vaultDirectory, 'DeleteProbe.md'); await writeFile(removed, '# DeleteProbe\n');
      await expect(page.locator('[data-vault-note-id]').filter({ hasText: 'DeleteProbe' })).toHaveCount(1, { timeout: 12000 });
      await unlink(removed); await expect(page.locator('[data-vault-note-id]').filter({ hasText: 'DeleteProbe' })).toHaveCount(0, { timeout: 12000 });
      if (!await page.locator('#source-editor').isVisible()) await page.locator('.view-tools [data-action="source"]').click();
      await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('UNSAVED_LOCAL_EDIT\n');
      const diskText = '# ExternalMoved\nEXTERNAL_DISK_VERSION\n'; await writeFile(moved, diskText);
      await expect(page.locator('#vault-change-notice')).toContainText('编辑内容已保留', { timeout: 12000 });
      await expect(page.locator('#source-editor')).toContainText('UNSAVED_LOCAL_EDIT');
      await page.locator('[data-action="save"]').click(); assert.equal(await readFile(moved, 'utf8'), diskText);
      await page.screenshot({ path: path.join(output, '09-external-conflict.png') });
      return { stableId, externalReload: true, renameRetainsId: true, deletedRemoved: true, dirtyKept: true, diskUnchanged: true, cleanup: 'isolated test profile removed after process exit' };
    });
    else await check('phase3 persistent index hydrates on reload and mobile rail leaves editor reachable', async () => {
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail');
      assert.equal(Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes')), 0);
      assert.ok(Number(await page.locator('#vault-graph-status').getAttribute('data-hydrated-notes')) >= 22);
      await page.locator('#activity-rail button[aria-label="刷新知识库"]').click();
      await expect.poll(async () => Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'))).toBe(22);
      assert.equal(Number(await page.locator('#vault-graph-status').getAttribute('data-hydrated-notes')), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#document-sidebar')).toBeHidden(); await expect(page.locator('#context-sidebar')).toBeHidden();
      await page.locator('#sidebar-toggle').click(); await expect(page.locator('#document-sidebar')).toBeVisible();
      await page.locator('#context-sidebar-toggle').click(); await expect(page.locator('#context-sidebar')).toBeVisible(); await expect(page.locator('#document-sidebar')).toBeHidden();
      await page.locator('#context-sidebar-toggle').click(); await expect(page.locator('#context-sidebar')).toBeHidden();
      const sizes = await page.evaluate(() => ({ rail: document.querySelector('#activity-rail').getBoundingClientRect().width, editor: document.querySelector('.main-area').getBoundingClientRect().width, width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(sizes.rail <= 44 && sizes.editor > 250 && sizes.scroll <= sizes.width + 1);
      await page.screenshot({ path: path.join(output, '09-mobile-rail.png') }); return sizes;
    });
    if (!desktop) await check('damaged and legacy index records are rebuilt without changing note sources', async () => {
      await page.setViewportSize({ width: 1440, height: 960 });
      const original = await readNotes();
      for (const mode of ['checksum', 'structure', 'legacy']) {
        await page.evaluate(async mode => {
          const database = await new Promise((resolve, reject) => { const request = indexedDB.open('inkloom.index.v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          try {
            const item = await new Promise((resolve, reject) => {
              const transaction = database.transaction('notes', 'readonly'); const cursor = transaction.objectStore('notes').openCursor(); let value;
              cursor.onsuccess = () => { if (!cursor.result) { reject(new Error('Expected a cached note')); return; } value = { key: cursor.result.key, envelope: cursor.result.value }; };
              transaction.oncomplete = () => resolve(value); transaction.onerror = () => reject(transaction.error);
            });
            let value = item.envelope;
            if (mode === 'checksum') value = { ...value, data: value.data + 'damaged' };
            else if (mode === 'legacy') value = JSON.parse(value.data);
            else {
              const note = JSON.parse(value.data); note.wikiLinks = [null]; const data = JSON.stringify(note);
              const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
              value = { format: 2, data, checksum: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
            }
            await new Promise((resolve, reject) => { const transaction = database.transaction('notes', 'readwrite'); transaction.objectStore('notes').put(value, item.key); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
          } finally { database.close(); }
        }, mode);
        await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail');
        await expect(page.locator('#vault-count')).toHaveText('22');
        assert.equal(Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes')), 1);
        assert.equal(Number(await page.locator('#vault-graph-status').getAttribute('data-hydrated-notes')), 21);
        await expect(page.locator('#vault-change-notice')).toContainText('缓存');
        assert.deepEqual(await readNotes(), original);
        await page.locator('#vault-change-notice [data-action="vault-refresh"]').click();
        await expect.poll(async () => Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes'))).toBe(22);
        await expect(page.locator('#vault-change-notice')).toBeHidden();
      }
      await page.screenshot({ path: path.join(output, '12-index-rebuilt.png') });
      return { checksumFailure: 'rebuilt', malformedRecord: 'rebuilt', legacyRecord: 'rebuilt', noteSourcesUnchanged: true, manualReset: true };
    });
    if (!desktop) await check('index cache access failure degrades to original notes and recovers after reload', async () => {
      const original = await readNotes(); const routePattern = '**/vault-index-worker-*.js';
      const denyCache = async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: 'Object.defineProperty(self,"indexedDB",{value:{open(){throw new Error("TEST_CACHE_DENIED")}}});\n' + await response.text() });
      };
      await page.route(routePattern, denyCache);
      try {
        await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail');
        await expect(page.locator('#vault-count')).toHaveText('22'); await expect(page.locator('#vault-change-notice')).toContainText('TEST_CACHE_DENIED');
        assert.deepEqual(await readNotes(), original); assert.equal(Number(await page.locator('#vault-graph-status').getAttribute('data-parsed-notes')), 22);
        await page.screenshot({ path: path.join(output, '13-index-cache-unavailable.png') });
      } finally { await page.unroute(routePattern, denyCache); }
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail');
      await expect(page.locator('#vault-count')).toHaveText('22'); await expect(page.locator('#vault-change-notice')).toBeHidden();
      assert.deepEqual(await readNotes(), original);
      return { execution: 'test-only Worker response fault injection', degradedIndexUsable: true, originalNotesUnchanged: true, healthyReload: true };
    });
    if (!desktop) await check('production index Worker handles rapid cancellation, temporary notes and repeated vault switches', async () => {
      const workerUrl = page.workers().find(worker => worker.url().includes('vault-index-worker-'))?.url(); assert.ok(workerUrl);
      const rpcSource = await readFile(path.join(root, 'app/node_modules/comlink/dist/esm/comlink.mjs'), 'utf8');
      const routePattern = '**/__verification/comlink.mjs'; const serveRpc = route => route.fulfill({ contentType: 'text/javascript', body: rpcSource });
      await page.route(routePattern, serveRpc);
      try {
        const result = await page.evaluate(async workerUrl => {
          const { wrap, releaseProxy } = await import('/__verification/comlink.mjs');
          const worker = new Worker(workerUrl, { type: 'module', name: 'inkloom-verification' }); const remote = wrap(worker);
          const prefix = 'verification-' + crypto.randomUUID(); const scopeA = prefix + '-a'; const scopeB = prefix + '-b';
          const notes = label => Array.from({ length: 96 }, (_, number) => ({ id: 'shared-' + number, name: label + number + '.md', relativePath: label + number + '.md', source: '# ' + label + number + '\n' + (number ? '[[' + label + (number - 1) + ']]\n' : '') }));
          const alpha = notes('Alpha'); const beta = notes('Beta');
          const request = (scope, raw, reset = false) => ({ scope, ids: raw.map(note => note.id), upserts: raw, removed: [], activeId: raw[0]?.id || '', reset });
          try {
            await remote.update(request(scopeA, alpha));
            const temporary = [...alpha.slice(0, 48), { id: 'temporary', name: 'Temporary.md', relativePath: 'Temporary.md', source: '# Temporary\n[[Missing]]\n' }];
            const burst = await Promise.all([remote.update(request(scopeA, temporary)), remote.update(request(scopeA, alpha.slice(1))), remote.update(request(scopeA, alpha))]);
            const final = burst[2];
            const switches = await Promise.all([remote.update(request(scopeB, beta)), remote.update(request(scopeA, alpha)), remote.update(request(scopeB, beta))]);
            const returned = await remote.update(request(scopeA, alpha));
            return { finalCount: final.notes.length, finalNodes: final.nodes.length, finalEdges: final.edges.length, temporaryRemains: final.nodes.some(note => ['temporary', 'ghost:missing'].includes(note.id)), switchedScope: switches[2].scope === scopeB, betaOnly: switches[2].notes.every(note => note.name.startsWith('Beta')), returnedCount: returned.notes.length, alphaOnly: returned.notes.every(note => note.name.startsWith('Alpha')), cancelledResults: [...burst, ...switches].filter(result => result === null).length, returnedHydrated: returned.counters.hydrated };
          } finally {
            try { await remote.update(request(scopeA, [], true)); await remote.update(request(scopeB, [], true)); await remote[releaseProxy](); }
            finally { worker.terminate(); }
          }
        }, workerUrl);
        assert.equal(result.finalCount, 96); assert.equal(result.finalNodes, 96); assert.equal(result.finalEdges, 95); assert.equal(result.temporaryRemains, false);
        assert.ok(result.switchedScope && result.betaOnly && result.alphaOnly); assert.equal(result.returnedCount, 96); assert.equal(result.returnedHydrated, 96);
        return { execution: 'production module Worker and Comlink, isolated test cache scopes', ...result };
      } finally { await page.unroute(routePattern, serveRpc); }
    });
    if (!desktop) await check('invalid IndexedDB schema rebuilds without losing original notes', async () => {
      const original = await readNotes(); await page.goto('about:blank');
      await page.goto('http://127.0.0.1:' + server.address().port + '/inkloom.png');
      await page.evaluate(async () => {
        const opened = await new Promise((resolve, reject) => { const request = indexedDB.open('inkloom.index.v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const version = opened.version + 1; opened.close();
        await new Promise((resolve, reject) => { const request = indexedDB.open('inkloom.index.v1', version); request.onupgradeneeded = () => { request.result.deleteObjectStore('notes'); request.result.createObjectStore('notes', { keyPath: 'broken' }); }; request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      });
      const blocker = await page.context().newPage();
      try {
        await blocker.goto('http://127.0.0.1:' + server.address().port + '/inkloom.png');
        await blocker.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('inkloom.index.v1'); request.onsuccess = () => { request.result.onversionchange = () => setTimeout(() => request.result.close(), 100); resolve(); }; request.onerror = () => reject(request.error); }));
        await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' }); await page.waitForSelector('#activity-rail');
        await expect(page.locator('#vault-count')).toHaveText('22'); await expect(page.locator('#vault-change-notice')).toContainText('结构已修复'); assert.deepEqual(await readNotes(), original);
      } finally { await blocker.close(); }
      await page.reload({ waitUntil: 'networkidle' }); await expect(page.locator('#vault-graph-status')).toHaveAttribute('data-hydrated-notes', '22'); return { schemaRepaired: true, sourcePreserved: true, warmCacheRecovered: true };
    });
    if (!desktop) await check('vault management remains in one settings window and fits narrow layouts', async () => {
      const before = await readNotes(); const name = await page.locator('#file-name').textContent();
      await page.evaluate(() => { const original = window.showDirectoryPicker; window.__restoreDirectoryPicker = () => { window.showDirectoryPicker = original; delete window.__restoreDirectoryPicker; }; window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
      try {
        await page.locator('#file-menu-button').click(); await page.locator('[data-action="vault-open"]').click();
        await expect(page.locator('#workspace')).not.toHaveAttribute('inert', ''); assert.deepEqual(await readNotes(), before); await expect(page.locator('#file-name')).toHaveText(name);
      } finally { await page.evaluate(() => window.__restoreDirectoryPicker()); }
      await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="knowledge"]');
      if (await group.getAttribute('open') === null) await group.locator('summary').click();
      await expect(page.locator('#vault-open-path')).toBeDisabled(); await expect(page.locator('#vault-scan-summary')).toContainText('22 篇笔记');
      await expect(page.locator('#vault-startup-note option')).toHaveCount(1);
      await expect(page.locator('#vault-recovery-list')).toContainText('桌面版恢复记录不可用');
      await page.locator('#vault-task-refresh').click(); await expect(page.locator('#vault-task-status')).toContainText('运行'); await page.locator('#vault-task-cancel').click();
      await page.setViewportSize({ width: 390, height: 844 });
      const sizes = await page.locator('#vault-manager').evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth })); assert.ok(sizes.scrollWidth <= sizes.width + 1);
      await page.screenshot({ path: path.join(output, '14-vault-manager-mobile.png') }); await page.locator('#settings-dialog .dialog-footer button').click(); return { ...sizes, browserPickerCancellationPreservesVault: true };
    });
  }
  if (appearanceOnly) {
    const original = await readNotes();
    const originalByteHashes = desktop ? Object.fromEntries(await Promise.all(original.map(async note => [note.relativePath, createHash('sha256').update(await readFile(path.join(profile, 'StarterVault', note.relativePath))).digest('hex')]))) : null;
    const openAppearance = async () => {
      if (!await page.locator('#settings-dialog').isVisible()) await page.locator('[data-action="settings"]').click();
      const group = page.locator('[data-settings-group="appearance"]'); if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
      await expect(page.locator('#appearance-manager')).toBeVisible();
      if (!await page.locator('#appearance-manager').evaluate(node => node.open)) await page.locator('#appearance-manager > summary').click();
    };
    const subsection = async label => { const details = page.locator('.appearance-subsection').filter({ has: page.locator('summary', { hasText: label }) }); if (await details.getAttribute('open') === null) await details.locator('summary').click(); };
    await check('appearance themes preview, cancel and persist without modifying notes or protected dialogs', async () => {
      await openAppearance(); const protectedBefore = await page.locator('#settings-dialog').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, button: getComputedStyle(node.querySelector('.dialog-footer button')).backgroundColor, accent: getComputedStyle(node).getPropertyValue('--ui-accent') }));
      for (const [id, accent] of [['inkloom-line', '#176b67'], ['inkloom-editorial', '#ae304f'], ['inkloom-canopy', '#237455']]) {
        await page.locator(`[data-appearance-theme="${id}"]`).click(); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', id);
        assert.equal(await page.locator('#app').evaluate(node => getComputedStyle(node).getPropertyValue('--ui-accent').trim()), accent);
        await page.locator('#appearance-variant').selectOption('dark'); await expect(page.locator('#app')).toHaveAttribute('data-workspace-mode', 'dark');
        assert.deepEqual(await page.locator('#settings-dialog').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, button: getComputedStyle(node.querySelector('.dialog-footer button')).backgroundColor, accent: getComputedStyle(node).getPropertyValue('--ui-accent') })), protectedBefore);
        await page.locator('#appearance-variant').selectOption('light');
        await page.screenshot({ path: path.join(output, id + '.png') });
      }
      await page.locator('#appearance-cancel').click(); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', '');
      await page.locator('[data-appearance-theme="inkloom-editorial"]').click(); await page.locator('#appearance-apply').click(); await expect(page.locator('#appearance-status')).toHaveText('已应用');
      await page.locator('#settings-dialog .dialog-footer button').click(); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', 'inkloom-editorial');
      assert.deepEqual(await readNotes(), original); return { themes: 3, darkVariants: 3, protectedDialogsUnchanged: true, previewRollback: true, sourceUnchanged: true };
    });
    if (!desktop) await check('appearance package export import and persistence failure preserve the previous configuration', async () => {
      await openAppearance(); const downloaded = page.waitForEvent('download'); await page.locator('#appearance-export').click(); const download = await downloaded;
      const exported = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(exported.format, 'inkloom.appearance');
      const imported = { ...exported, id: 'verified-custom-theme', name: 'Verified Custom', author: 'Acceptance fixture' };
      await page.locator('#appearance-import-file').setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
      await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', imported.id); await page.locator('#appearance-apply').click(); await expect(page.locator('#appearance-status')).toHaveText('已应用');
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#settings-button'); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', imported.id);
      await openAppearance(); const saved = await page.evaluate(() => localStorage.getItem('inkloom.settings'));
      await page.evaluate(() => { const original = Storage.prototype.setItem; window.__restoreAppearanceStorage = () => { Storage.prototype.setItem = original; delete window.__restoreAppearanceStorage; }; Storage.prototype.setItem = function(key, value) { if (key === 'inkloom.settings') throw new DOMException('TEST_APPEARANCE_QUOTA', 'QuotaExceededError'); return original.call(this, key, value); }; });
      try {
        await page.locator('[data-appearance-theme="inkloom-canopy"]').click(); await page.locator('#appearance-apply').click(); await expect(page.locator('#appearance-status')).toHaveClass(/has-error/);
        await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', imported.id); assert.equal(await page.evaluate(() => localStorage.getItem('inkloom.settings')), saved);
      } finally { await page.evaluate(() => window.__restoreAppearanceStorage()); }
      await page.locator('#appearance-delete').click(); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', '');
      const bad = { ...imported, css: '#settings-dialog { color: #ffffff; }' }; await page.locator('#appearance-import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await expect(page.locator('#appearance-status')).toHaveClass(/has-error/); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', '');
      await page.locator('[data-appearance-theme="inkloom-editorial"]').click(); await page.locator('#appearance-apply').click(); assert.deepEqual(await readNotes(), original);
      return { actualJsonDownload: true, importedAcrossReload: true, quotaFailureRolledBack: true, protectedSelectorRejected: true, deletionFallsBack: true };
    });
    await check('appearance CSS and SVG packages are bounded and cannot execute or fetch external content', async () => {
      await openAppearance(); await subsection('正文 CSS');
      await page.locator('#appearance-css').fill('h2 { font-style: italic; border-style: solid; border-width: 1px; }'); await page.locator('#appearance-css-enabled').check(); await page.locator('#appearance-css-save').click();
      await expect(page.locator('#appearance-status')).toHaveText('已应用');
      const applied = await page.locator('#inkloom-reader-customizations').textContent();
      await page.locator('#appearance-css').fill('@import "https://example.com/unsafe.css";'); await page.locator('#appearance-css-save').click(); await expect(page.locator('#appearance-status')).toHaveClass(/has-error/);
      assert.equal(await page.locator('#inkloom-reader-customizations').textContent(), applied);
      const icons = { format: 'inkloom.icons', version: 1, id: 'verified-icons', name: 'Verified', author: 'Acceptance fixture', license: 'Original test asset', assets: { symbol: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>window.appearanceInjection=1</script><image href="https://example.com/pixel"/><path d="M4 4h16v16H4z" fill="#227766" onload="window.appearanceInjection=1"/></svg>' }, mapping: { file: 'custom:symbol' } };
      await subsection('图标包'); await page.locator('#appearance-icon-file').setInputFiles({ name: 'icons.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(icons)) });
      await expect(page.locator('#appearance-icon-pack')).toHaveValue('verified-icons');
      const svg = await page.locator('#vault-tree-list .appearance-note-icon svg').first().evaluate(node => node.outerHTML);
      assert.ok(!/script|onload|https:|<image/i.test(svg)); assert.equal(await page.evaluate(() => window.appearanceInjection), undefined);
      await page.locator('#appearance-icon-search').fill('heart'); await page.locator('#appearance-icon-picker button[aria-label="heart"]').click(); await page.locator('#appearance-rule-target').selectOption('note'); await page.locator('#appearance-icon-save').click();
      await expect(page.locator('#vault-tree-list .vault-note-item.active .appearance-note-icon')).toHaveAttribute('data-icon-key', /^heart:/);
      await page.locator('#appearance-icon-clear').click(); await page.locator('#appearance-rule-target').selectOption('folder'); await page.locator('#appearance-icon-save').click();
      await expect(page.locator('#vault-tree-list .vault-note-item.active .appearance-note-icon')).toHaveAttribute('data-icon-key', /^heart:/);
      await page.locator('#appearance-icon-clear').click(); await page.locator('#appearance-rule-target').selectOption('property'); await page.locator('#appearance-rule-key').fill('status'); await page.locator('#appearance-rule-value').fill('持续演进'); await page.locator('#appearance-icon-save').click();
      await expect(page.locator('#vault-tree-list .vault-note-item.active .appearance-note-icon')).toHaveAttribute('data-icon-key', /^heart:/);
      assert.deepEqual(await readNotes(), original); return { cssRejected: true, svgSanitized: true, noExternalExecution: true, noteRuleApplied: true, folderRuleApplied: true, propertyRuleApplied: true };
    });
    await check('appearance local banners preserve sources, support zero focus and scoped hiding', async () => {
      await openAppearance(); await subsection('本地 Banner');
      await page.locator('#appearance-banner-file').setInputFiles(path.join(root, 'assets/logo-source.png')); await expect(page.locator('#appearance-banner-preview')).toBeVisible();
      await page.locator('#appearance-banner-x').fill('0'); await page.locator('#appearance-banner-y').fill('0'); await page.locator('#appearance-banner-height').fill('180');
      await page.locator('#appearance-banner-export').check(); await page.locator('#appearance-banner-apply').click();
      await expect(page.locator('#note-banner')).toBeVisible(); assert.equal(await page.locator('#note-banner img').evaluate(image => getComputedStyle(image).objectPosition), '0% 0%');
      assert.equal(await page.locator('#note-banner img').evaluate(image => image.complete && image.naturalWidth > 0), true);
      if (!desktop) {
        await page.evaluate(() => { const original = window.showSaveFilePicker; window.__restoreAppearancePicker = () => { window.showSaveFilePicker = original; delete window.__restoreAppearancePicker; }; window.showSaveFilePicker = undefined; });
        const exportHtml = async suffix => {
          await page.locator('#settings-dialog .dialog-footer button').click(); await page.locator('[data-action="print"]').click(); await page.locator('#export-format').selectOption('html');
          const pendingDownload = page.waitForEvent('download'); await page.locator('#export-submit').click(); const downloaded = await pendingDownload;
          const file = path.join(output, 'banner-' + suffix + '.html'); await downloaded.saveAs(file); await expect(page.locator('#export-dialog')).toBeHidden(); await openAppearance(); await subsection('本地 Banner'); return readFile(file, 'utf8');
        };
        try {
          assert.match(await exportHtml('included'), /alt="Banner"/);
          await page.locator('#appearance-banner-export').uncheck(); await page.locator('#appearance-banner-apply').click(); assert.doesNotMatch(await exportHtml('excluded'), /alt="Banner"/);
        } finally { await page.evaluate(() => window.__restoreAppearancePicker()); }
      }
      await page.locator('#appearance-banner-hide').click(); await expect(page.locator('#note-banner')).toBeHidden();
      await page.locator('#appearance-banner-clear').click(); assert.deepEqual(await readNotes(), original);
      await page.locator('#appearance-banner-file').setInputFiles(path.join(root, 'assets/logo-source.png')); await expect(page.locator('#appearance-banner-preview')).toBeVisible();
      await page.locator('#appearance-banner-target').selectOption('folder'); await page.locator('#appearance-banner-apply').click(); await expect(page.locator('#note-banner')).toBeVisible();
      await page.locator('#settings-dialog .dialog-footer button').click(); await openFromSearch('双链笔记与卡片盒方法'); await expect(page.locator('#note-banner')).toBeVisible();
      await openAppearance(); await subsection('本地 Banner'); await page.locator('#appearance-banner-target').selectOption('note'); await page.locator('#appearance-banner-hide').click(); await expect(page.locator('#note-banner')).toBeHidden();
      await page.locator('#appearance-banner-clear').click(); await expect(page.locator('#note-banner')).toBeVisible();
      await page.locator('#appearance-banner-enabled').uncheck(); await expect(page.locator('#note-banner')).toBeHidden();
      await page.locator('#appearance-banner-enabled').check(); await expect(page.locator('#note-banner')).toBeVisible();
      await page.locator('#appearance-banner-target').selectOption('folder'); await page.locator('#appearance-banner-clear').click(); await expect(page.locator('#note-banner')).toBeHidden();
      await page.locator('#settings-dialog .dialog-footer button').click(); await openFromSearch('墨图导览'); await openAppearance(); await subsection('本地 Banner');
      await page.setViewportSize({ width: 390, height: 844 });
      const size = await page.locator('#appearance-manager').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth })); assert.ok(size.scroll <= size.width + 1);
      await page.screenshot({ path: path.join(output, 'appearance-mobile.png') }); return { sourceUnchanged: true, zeroFocus: true, hiddenOverride: true, mobile: size };
    });
    await check('appearance graph layouts, visual styles and persisted viewport work without leaking workers', async () => {
      await page.setViewportSize({ width: 1440, height: 960 }); await page.locator('#settings-dialog .dialog-footer button').click();
      const configure = async (layout, style) => {
        await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="extensions"]'); if (await group.getAttribute('open') === null) await group.locator('summary').click();
        await page.locator('[data-plugin-setting="knowledge-graph:layout"]').selectOption(layout);
        await page.locator('[data-plugin-setting="knowledge-graph:visual-style"]').selectOption(style);
        await page.locator('[data-plugin-setting="knowledge-graph:persist-layout"]').check(); await page.locator('#settings-dialog .dialog-footer button').click();
      };
      for (const [layout, style] of [['force', 'atlas'], ['radial', 'constellation'], ['folders', 'minimal']]) {
        await configure(layout, style); await page.locator('#global-graph-button').click();
        const canvas = page.locator('#global-graph-canvas'); await expect(canvas).toHaveAttribute('data-graph-layout', layout); await expect(canvas).toHaveAttribute('data-graph-style', style);
        await expect(canvas).toHaveAttribute('data-layout-state', /ready|budget-limited|manual/);
        const pixels = await canvas.evaluate(canvas => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let visible = 0; for (let offset = 3; offset < data.length; offset += 4) if (data[offset]) visible++; return visible; }); assert.ok(pixels > 100);
        await expect(canvas).toHaveAttribute('data-persisted-layout', 'true'); await page.screenshot({ path: path.join(output, 'graph-' + layout + '.png') }); await page.locator('#global-graph-button').click();
      }
      if (desktop) await restartDesktopForAppearance(); else await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#global-graph-button'); await page.locator('#global-graph-button').click();
      await expect(page.locator('#global-graph-canvas')).toHaveAttribute('data-layout-restored', 'true');
      await page.evaluate(() => { const original = IDBObjectStore.prototype.put; window.__restoreGraphStorage = () => { IDBObjectStore.prototype.put = original; delete window.__restoreGraphStorage; }; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'layouts') throw new DOMException('TEST_LAYOUT_QUOTA', 'QuotaExceededError'); return original.apply(this, args); }; });
      try {
        await page.locator('#global-graph-stage [data-graph-command="layout"]').click(); await expect(page.locator('#global-graph-stats')).toContainText('布局缓存不可用');
        await expect(page.locator('#global-graph-canvas')).toHaveAttribute('data-layout-state', /ready|budget-limited/);
      } finally { await page.evaluate(() => window.__restoreGraphStorage()); }
      await page.locator('#global-graph-stage [data-graph-command="layout"]').click(); await expect(page.locator('#global-graph-canvas')).toHaveAttribute('data-persisted-layout', 'true');
      await page.locator('[data-action="settings"]').click(); const group = page.locator('[data-settings-group="extensions"]'); if (await group.getAttribute('open') === null) await group.locator('summary').click();
      await page.locator('[data-plugin-id="knowledge-graph"]').uncheck(); await expect.poll(() => page.workers().filter(worker => worker.url().includes('graph-layout-worker')).length).toBe(0);
      await page.locator('[data-plugin-id="knowledge-graph"]').check(); await page.locator('#settings-dialog .dialog-footer button').click(); assert.deepEqual(await readNotes(), original);
      return { layouts: 3, visualStyles: 3, reloadRestored: true, actualProcessRestart: desktop, stoppedWorkers: 0, sourceUnchanged: true };
    });
    await check('appearance changes preserve original note bytes and classic fallback', async () => {
      await openAppearance(); await page.locator('#appearance-reset').click(); await expect(page.locator('#app')).toHaveAttribute('data-appearance-pack', '');
      await page.locator('#settings-dialog .dialog-footer button').click(); assert.deepEqual(await readNotes(), original);
      if (desktop) for (const [relativePath, hash] of Object.entries(originalByteHashes)) assert.equal(createHash('sha256').update(await readFile(path.join(profile, 'StarterVault', relativePath))).digest('hex'), hash);
      return { nativeByteHashesMatched: desktop, sourceUnchanged: true, classicFallback: true };
    });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  const docsImgDir = path.join(root, 'docs/images');
  await mkdir(docsImgDir, { recursive: true });
  for (const imgName of ['manual-f1-dialog.png', 'ai-chat-formatted.png', 'ai-digest-rendered.png', 'karpathy-wiki-compiler.png', 'cognitive-evolution-chronicle.png', 'ai-skills-guide.png', 'flashcards-rendered.png', 'whiteboard-drawing.png', 'research-excerpts.png', 'workspace-final.png', 'task-board.png', '03-board.png', '04-callout.png', '08-plugin-settings.png', 'graph-force.png']) {
    try {
      const bytes = await readFile(path.join(output, imgName));
      await writeFile(path.join(docsImgDir, imgName), bytes);
    } catch {}
  }
} catch (error) {
  report.failure = error.stack; if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  if (page) report.uiState = await page.evaluate(() => ({ toast: document.querySelector('#toast')?.textContent, save: document.querySelector('#save-state')?.textContent, workspaceBusy: document.querySelector('#workspace')?.getAttribute('aria-busy'), index: document.querySelector('#vault-graph-status')?.textContent })).catch(() => null);
  console.error(error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(root, 'verification', phase + (desktop ? '-desktop-results.json' : '-browser-results.json')), JSON.stringify({ report: path.relative(root, path.join(output, 'results.json')).replaceAll('\\', '/'), ...report }, null, 2) + '\n');
  if (desktop && child) {
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
    if (report.passed) await rm(profile, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
  }
  else if (browser) await browser.close();
  if (localLlmProc) { localLlmProc.kill(); localLlmProc = null; }
  if (server) await new Promise(resolve => server.close(resolve));
  console.log('INKLOOM_' + phase.toUpperCase(), report.passed ? 'PASS' : 'FAIL', output);
}