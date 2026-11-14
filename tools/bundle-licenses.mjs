import { readFile, readdir, mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function bundledLicensePlugin(root) {
  const dependencies = path.join(root, 'app/node_modules'); const packages = new Map();
  async function packageAt(directory) {
    if (packages.has(directory)) return;
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); packages.set(directory, metadata);
    if (metadata.name === '@excalidraw/excalidraw' || directory.includes('@excalidraw')) await dependencyTree(directory, metadata);
  }
  async function findDependency(parent, name) {
    for (let folder = parent; folder.startsWith(path.join(root, 'app')); folder = path.dirname(folder)) {
      const candidate = path.join(folder, 'node_modules', name); try { await access(path.join(candidate, 'package.json')); return candidate; } catch { }
    }
    throw new Error('Cannot resolve dependency license: ' + name);
  }
  async function dependencyTree(directory, metadata) {
    for (const name of Object.keys(metadata.dependencies || {})) {
      const resolved = await findDependency(directory, name); if (packages.has(resolved)) continue;
      const child = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8')); packages.set(resolved, child); await dependencyTree(resolved, child);
    }
  }
  return {
    name: 'inkloom-bundled-licenses',
    async generateBundle() {
      for (const id of this.getModuleIds()) {
        const normalized = id.split('?')[0].replaceAll('\\', '/'); const marker = normalized.lastIndexOf('/node_modules/'); if (marker < 0) continue;
        const parts = normalized.slice(marker + 14).split('/'); const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        const directory = normalized.slice(0, marker + 14) + name; if (directory.startsWith(dependencies.replaceAll('\\', '/'))) await packageAt(path.normalize(directory));
      }
      const output = path.join(root, 'licenses/bundled'); await mkdir(output, { recursive: true }); const manifest = []; const missing = [];
      for (const [directory, metadata] of packages) {
        const key = metadata.name.replaceAll('/', '__').replace(/^@/, '') + '-' + metadata.version;
        let files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(entry.name)).map(entry => ({ name: entry.name, path: path.join(directory, entry.name) }));
        if (metadata.name === '@excalidraw/excalidraw') files = [{ name: 'LICENSE', path: path.join(root, 'licenses/whiteboard-fonts/excalidraw-LICENSE.txt') }];
        if (!files.length) { const override = path.join(root, 'licenses/upstream-overrides', key + '-LICENSE.txt'); try { await access(override); files = [{ name: 'LICENSE.txt', path: override }]; } catch { } }
        if (!files.length) { missing.push(metadata.name + '@' + metadata.version); continue; }
        for (const file of files) await copyFile(file.path, path.join(output, key + '-' + file.name));
        const inputs = await Promise.all(files.map(async file => ({ path: path.relative(root, file.path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(file.path)).digest('hex'), supplementary: file.path.includes('upstream-overrides'), packageRepository: metadata.repository || null, declaredPackageCommit: metadata.gitHead || null })));
        manifest.push({ name: metadata.name, version: metadata.version, license: metadata.license || null, files: files.map(file => key + '-' + file.name), inputs });
      }
      await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ packages: manifest, missing }, null, 2) + '\n');
      if (missing.length) throw new Error('Missing bundled license text: ' + missing.join(', '));
    },
  };
}