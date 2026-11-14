import { readdir, readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = path.join(root, 'vendor', 'inklet');
const manifestPath = path.join(root, 'shared-source-lock.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifySharedSource() {
  const lock = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (lock.format !== 1 || lock.source !== 'Inklet' || !Array.isArray(lock.files)) throw new Error('Invalid shared source lock');
  for (const item of lock.files) {
    const file = path.resolve(shared, item.path);
    if (!file.startsWith(shared + path.sep) || sha256(await readFile(file)) !== item.sha256) throw new Error('Shared source changed: ' + item.path);
  }
  return { shared, version: lock.version, files: lock.files.length };
}

async function freeze() {
  try { await access(manifestPath); throw new Error('Shared source is already frozen; upgrade requires an explicit reviewed lock change'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = path.resolve(root, '../inklet'); const paths = [];
  async function collect(relative) {
    for (const item of await readdir(path.join(source, relative), { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Unexpected shared-source symlink');
      const file = path.posix.join(relative.replaceAll('\\', '/'), item.name);
      if (item.isDirectory()) await collect(file); else paths.push(file);
    }
  }
  for (const directory of ['app/src', 'core', 'licenses']) await collect(directory);
  paths.push('app/package.json', 'app/package-lock.json', 'app/vite.config.js', 'app/public/paper-grain.png', 'assets/Markdown.ico');
  for (const name of ['FileStore', 'WorkspaceStore', 'OpenHistory', 'RuntimeDiagnostics', 'ShellIntegration', 'ExportService', 'ResourcePack']) paths.push('native/' + name + '.cs');
  for (const name of ['lib/net462/Microsoft.Web.WebView2.Core.dll', 'lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'runtimes/win-x64/native/WebView2Loader.dll', 'LICENSE.txt']) paths.push('.tools/webview2/' + name);
  for (const file of await readdir(source)) if (/^(LICENSE|NOTICE)(\.|$)/i.test(file)) paths.push(file);
  const files = [];
  for (const relative of [...new Set(paths)].sort()) {
    const bytes = await readFile(path.join(source, relative)); const destination = path.join(shared, relative);
    await mkdir(path.dirname(destination), { recursive: true }); await copyFile(path.join(source, relative), destination);
    files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const metadata = JSON.parse(await readFile(path.join(source, 'app/package.json'), 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ format: 1, source: 'Inklet', version: metadata.version, capturedAt: new Date().toISOString(), origin: 'Sibling project output/inklet; copied without source changes', files }, null, 2) + '\n');
  const hostPackage = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'));
  hostPackage.dependencies = { ...metadata.dependencies, ...hostPackage.dependencies };
  hostPackage.devDependencies = {};
  for (const [name, requested] of Object.entries(metadata.devDependencies)) {
    const installed = JSON.parse(await readFile(path.join(source, 'app/node_modules', name, 'package.json'), 'utf8'));
    hostPackage.devDependencies[name] = installed.version || requested;
  }
  hostPackage.overrides = metadata.overrides;
  await writeFile(path.join(root, 'app/package.json'), JSON.stringify(hostPackage, null, 2) + '\n');
  async function rewrite(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await rewrite(file);
      else if (/\.(mjs|js|css)$/.test(file)) {
        const original = await readFile(file, 'utf8');
        const next = original.replace(/(['"])(\.\.\/)+inklet\/(?!app\/node_modules)([^'"\r\n]+)\1/g, (match, quote, ignored, suffix) => {
          let relative = path.relative(path.dirname(file), path.join(shared, suffix)).replaceAll('\\', '/'); if (!relative.startsWith('.')) relative = './' + relative;
          return quote + relative + quote;
        }).replace(/(['"])(\.\.\/)+inklet\/app\/node_modules\/([^'"\r\n]+)\1/g, (match, quote, ignored, suffix) => {
          let relative = path.relative(path.dirname(file), path.join(root, 'app/node_modules', suffix)).replaceAll('\\', '/'); if (!relative.startsWith('.')) relative = './' + relative;
          return quote + relative + quote;
        });
        if (next !== original) await writeFile(file, next);
      }
    }
  }
  for (const directory of ['app/src', 'core', 'tools']) await rewrite(path.join(root, directory));
  console.log('INKLOOM_SHARED_SOURCE_FROZEN', JSON.stringify(await verifySharedSource()));
}

async function prepareDependencyLock() {
  await verifySharedSource();
  const original = JSON.parse(await readFile(path.join(shared, 'app/package-lock.json'), 'utf8'));
  const current = JSON.parse(await readFile(path.join(root, 'app/package-lock.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'));
  const packages = { ...original.packages, ...current.packages };
  packages[''] = { name: metadata.name, version: metadata.version, dependencies: metadata.dependencies, devDependencies: metadata.devDependencies };
  await writeFile(path.join(root, 'app/package-lock.json'), JSON.stringify({ name: metadata.name, version: metadata.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n');
  console.log('INKLOOM_DEPENDENCIES_LOCKED', Object.keys(packages).length - 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--freeze')) await freeze();
  else if (process.argv.includes('--lock-dependencies')) await prepareDependencyLock();
  else console.log('INKLOOM_SHARED_SOURCE_PASS', JSON.stringify(await verifySharedSource()));
}