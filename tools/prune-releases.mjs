import { readdir, readFile, lstat, rm, writeFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const versionPattern = /^\d+\.\d+\.\d+$/;
const releasePattern = /^Inkloom-(\d+\.\d+\.\d+)(?:-Windows-x64\.zip)?$/;
const legacyArtifacts = new Set(['01-inkloom-overview.png', '02-inkloom-global-graph.png', '03-inkloom-dark-theme.png', 'phase3-2026-10-23T01-22-49.921Z', 'phase3-2026-10-23T01-36-05.055Z', 'temp-profile-1792589793160']);
const compareVersions = (first, second) => {
  const left = first.split('.').map(Number); const right = second.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};
async function json(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } }
async function children(folder) { try { return await readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }

export async function planRetention(root, current) {
  if (!versionPattern.test(current)) throw new Error('Invalid verified release version');
  const releaseEntries = await children(path.join(root, 'release'));
  const versions = [...new Set(releaseEntries.map(entry => releasePattern.exec(entry.name)?.[1]).filter(Boolean))].sort((first, second) => compareVersions(second, first));
  const keep = versions.filter(version => compareVersions(version, current) <= 0).slice(0, 2);
  if (!keep.includes(current)) throw new Error('Verified release is missing');
  const remove = []; const retained = []; const unclassified = [];
  const record = (relative, version) => {
    if (!version || !versionPattern.test(version)) { unclassified.push(relative); return; }
    (keep.includes(version) ? retained : remove).push({ path: relative.replaceAll('\\', '/'), version });
  };
  for (const entry of releaseEntries) {
    if (entry.isSymbolicLink()) { unclassified.push('release/' + entry.name); continue; }
    record('release/' + entry.name, releasePattern.exec(entry.name)?.[1]);
  }
  for (const entry of await children(path.join(root, 'verification'))) {
    const relative = 'verification/' + entry.name; const absolute = path.join(root, relative);
    if (entry.name === 'retention-results.json') continue;
    if (entry.isSymbolicLink()) { unclassified.push(relative); continue; }
    if (entry.isDirectory() && entry.name === 'releases') {
      for (const archive of await children(absolute)) record(relative + '/' + archive.name, archive.isSymbolicLink() ? null : archive.name);
      continue;
    }
    let version = /^core-(\d+\.\d+\.\d+)\.tap$/.exec(entry.name)?.[1];
    if (!version) {
      const report = entry.isFile() && entry.name.endsWith('.json') ? await json(absolute) : entry.isDirectory() ? await json(path.join(absolute, 'results.json')) : null;
      version = report?.version;
    }
    if (entry.name === 'VaultStoreTests.exe') {
      const native = await json(path.join(root, 'verification/native-results.json'));
      if (native?.testExecutableSha256 === createHash('sha256').update(await readFile(absolute)).digest('hex')) version = native.version;
    }
    if (!version && legacyArtifacts.has(entry.name)) { remove.push({ path: relative, version: null, reason: 'Inventoried legacy test artifact predating 0.4.0' }); continue; }
    record(relative, version);
  }
  return { current, keep, remove, retained, unclassified };
}

export async function applyRetention(root, current) {
  const proof = await json(path.join(root, 'verification/release-results.json'));
  if (proof?.version !== current || proof.passed !== true) throw new Error('A passing release report is required before pruning');
  for (const [file, expected] of [[`release/Inkloom-${current}/Inkloom.exe`, proof.exeSha256], [`release/Inkloom-${current}-Windows-x64.zip`, proof.zipSha256]]) {
    if (createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') !== expected) throw new Error('Verified release hash mismatch');
  }
  const plan = await planRetention(root, current);
  if (process.platform === 'win32') for (const item of plan.remove.filter(item => /^release\/Inkloom-\d+\.\d+\.\d+$/.test(item.path))) {
    try { const handle = await open(path.join(root, item.path, 'Inkloom.exe'), 'r+'); await handle.close(); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('旧版本可能正在使用或不可删除，请手动关闭后重试：' + item.path); }
  }
  const archive = path.join(root, 'verification/releases', current); await mkdir(archive, { recursive: true });
  await writeFile(path.join(archive, 'release-results.json'), JSON.stringify(proof, null, 2) + '\n');
  const removed = [];
  for (const item of plan.remove) {
    const target = path.resolve(root, item.path);
    if (!target.startsWith(path.resolve(root) + path.sep) || !/^(release|verification)\//.test(item.path)) throw new Error('Retention path is outside artifact roots');
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Artifact changed to a symbolic link');
    await rm(target, { recursive: true, force: false }); removed.push(item);
  }
  const result = { version: current, checkedAt: new Date().toISOString(), passed: plan.unclassified.length === 0, keep: plan.keep, removed, unclassified: plan.unclassified };
  await writeFile(path.join(root, 'verification/retention-results.json'), JSON.stringify(result, null, 2) + '\n'); return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const metadata = await json(path.join(root, 'app/package.json'));
  const current = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : metadata.version;
  const result = process.argv.includes('--apply') ? await applyRetention(root, current) : await planRetention(root, current);
  if (process.argv.includes('--apply') && !result.passed) process.exitCode = 2;
  console.log(JSON.stringify(process.argv.includes('--summary') ? { current, keep: result.keep, removed: result.removed?.length, pending: result.remove?.length, unclassified: result.unclassified } : result, null, 2));
}