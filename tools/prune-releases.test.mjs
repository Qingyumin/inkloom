import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planRetention, applyRetention } from './prune-releases.mjs';

test('retention keeps two verified semantic versions, prunes old evidence and leaves unknown data untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inkloom-retention-'));
  try {
    for (const version of ['0.3.8', '0.4.0', '0.5.0']) {
      await mkdir(path.join(root, 'release', 'Inkloom-' + version), { recursive: true });
      await writeFile(path.join(root, 'release', 'Inkloom-' + version, 'Inkloom.exe'), 'executable');
      await writeFile(path.join(root, 'release', 'Inkloom-' + version + '-Windows-x64.zip'), 'package');
      await mkdir(path.join(root, 'verification', 'run-' + version), { recursive: true });
      await writeFile(path.join(root, 'verification', 'run-' + version, 'results.json'), JSON.stringify({ version }));
    }
    await writeFile(path.join(root, 'verification', 'unknown.txt'), 'preserve');
    const plan = await planRetention(root, '0.5.0'); assert.deepEqual(plan.keep, ['0.5.0', '0.4.0']); assert.equal(plan.remove.length, 3); assert.equal(plan.unclassified.length, 1);
    await assert.rejects(() => applyRetention(root, '0.5.0'), /passing release/);
    const hash = text => createHash('sha256').update(text).digest('hex');
    await writeFile(path.join(root, 'verification/release-results.json'), JSON.stringify({ version: '0.5.0', passed: true, exeSha256: hash('executable'), zipSha256: hash('package') }));
    await applyRetention(root, '0.5.0'); assert.equal((await planRetention(root, '0.5.0')).remove.length, 0); assert.equal(await readFile(path.join(root, 'verification/unknown.txt'), 'utf8'), 'preserve');
    await assert.rejects(() => planRetention(root, '../outside'), /Invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});