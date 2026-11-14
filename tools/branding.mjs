import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '../app/node_modules/@playwright/test/index.mjs';
import pngToIco from '../app/node_modules/png-to-ico/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const publicDir = path.join(root, 'app/public');
await mkdir(assets, { recursive: true });
await mkdir(publicDir, { recursive: true });
const chatArgument = process.argv.indexOf('--chat');
let sourceFile = (await readdir(assets)).find(name => /^logo-source\.(png|jpg)$/.test(name));
if (chatArgument >= 0) {
  let attachment;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'image' && typeof value.value?.$base64 === 'string') attachment = Buffer.from(value.value.$base64, 'base64');
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  }
  const records = createInterface({ input: createReadStream(process.argv[chatArgument + 1]), crlfDelay: Infinity });
  for await (const record of records) {
    try { visit(JSON.parse(record)); } catch {}
  }
  if (!attachment) throw new Error('No image attachment found in the specified current session');
  const png = attachment.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!png && !(attachment[0] === 255 && attachment[1] === 216)) throw new Error('Unsupported attachment format');
  sourceFile = 'logo-source.' + (png ? 'png' : 'jpg');
  await writeFile(path.join(assets, sourceFile), attachment);
}
if (!sourceFile) throw new Error('Provide the original logo attachment with --chat once');
const source = await readFile(path.join(assets, sourceFile));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async data => {
    const image = new Image();
    image.src = data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width; let top = canvas.height; let right = 0; let bottom = 0;
    let visible = 0; let transparent = 0;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const shade = Math.min(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]);
      const alpha = Math.round(pixels.data[offset + 3] * Math.max(0, 240 - shade) / 240);
      pixels.data[offset] = 0; pixels.data[offset + 1] = 0; pixels.data[offset + 2] = 0; pixels.data[offset + 3] = alpha;
      if (!alpha) transparent++;
      if (alpha > 30) {
        visible++;
        const column = (offset / 4) % canvas.width; const row = Math.floor(offset / 4 / canvas.width);
        left = Math.min(left, column); right = Math.max(right, column); top = Math.min(top, row); bottom = Math.max(bottom, row);
      }
    }
    if (visible < 1000 || transparent < canvas.width * canvas.height * 0.45) throw new Error('Logo transparency or artwork verification failed');
    context.putImageData(pixels, 0, 0);
    const original = canvas.toDataURL('image/png').split(',')[1];
    const outputs = [];
    for (const size of [16, 32, 48, 64, 256, 512]) {
      const output = document.createElement('canvas'); output.width = size; output.height = size;
      const target = output.getContext('2d', { willReadFrequently: true });
      const scale = size * 0.9 / Math.max(right - left + 1, bottom - top + 1);
      const width = (right - left + 1) * scale; const height = (bottom - top + 1) * scale;
      target.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, (size - width) / 2, (size - height) / 2, width, height);
      const black = output.toDataURL('image/png').split(',')[1];
      const raster = target.getImageData(0, 0, size, size);
      let inkPixels = 0;
      for (let offset = 0; offset < raster.data.length; offset += 4) {
        if (raster.data[offset + 3] > 64) inkPixels++;
        raster.data[offset] = 255; raster.data[offset + 1] = 255; raster.data[offset + 2] = 255;
      }
      if (inkPixels < size * size * 0.05 || raster.data[3] !== 0) throw new Error('Small icon blank or opaque corner: ' + size);
      target.putImageData(raster, 0, 0);
      outputs.push({ size, black, white: output.toDataURL('image/png').split(',')[1], inkPixels });
    }
    return { width: canvas.width, height: canvas.height, visible, transparent, crop: { left, top, right, bottom }, original, outputs };
  }, `data:image/${sourceFile.endsWith('.png') ? 'png' : 'jpeg'};base64,${source.toString('base64')}`);
  await writeFile(path.join(assets, 'inkloom-transparent.png'), Buffer.from(result.original, 'base64'));
  for (const variant of ['black', 'white']) {
    const full = Buffer.from(result.outputs.find(output => output.size === 512)[variant], 'base64');
    await writeFile(path.join(publicDir, variant === 'black' ? 'inkloom.png' : 'inkloom-dark.png'), full);
    const icon = await pngToIco(result.outputs.filter(output => output.size <= 256).map(output => Buffer.from(output[variant], 'base64')));
    await writeFile(path.join(assets, variant === 'black' ? 'Inkloom.ico' : 'Inkloom-dark.ico'), icon);
  }
  const report = { source: sourceFile, sourceSha256: createHash('sha256').update(source).digest('hex'), sourceSize: [result.width, result.height], crop: result.crop, transparentPixels: result.transparent, visiblePixels: result.visible, sizes: result.outputs.map(({ size, inkPixels }) => ({ size, inkPixels })), processing: 'white-to-alpha; original geometry; theme variants', verifiedAt: new Date().toISOString() };
  await writeFile(path.join(assets, 'logo-build.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('INKLOOM_LOGO_VERIFIED', JSON.stringify(report));
} finally { await browser.close(); }