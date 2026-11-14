import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePluginPackage,
  createPluginTemplatePackage,
  installPluginPackage,
  rollbackPluginPackage,
  removePluginPackage,
  defaultExtensionCatalog,
} from './plugin-package.mjs';

test('createPluginTemplatePackage builds a valid SHA-256 signed offline package and rejects tampered or high-risk packages', async () => {
  const pkg = await createPluginTemplatePackage({
    id: 'reading-stats-helper',
    name: '阅读卡片统计助手',
    version: '1.0.0',
  });
  assert.equal(pkg.format, 'inkloom.plugin-package');
  assert.equal(pkg.manifest.id, 'reading-stats-helper');
  assert.match(pkg.sha256, /^[a-f0-9]{64}$/);

  await assert.rejects(
    () => validatePluginPackage({ ...pkg, source: pkg.source + '\n// tampered' }),
    /SHA-256 校验和不匹配/,
  );

  await assert.rejects(
    () => validatePluginPackage({
      ...pkg,
      manifest: { ...pkg.manifest, id: 'workspace-home' },
    }),
    /禁止覆盖核心内置扩展/,
  );

  await assert.rejects(
    () => validatePluginPackage({
      ...pkg,
      manifest: { ...pkg.manifest, capabilities: ['metadata.read', 'network'] },
    }),
    /高危权限/,
  );
});

test('installPluginPackage supports version upgrades, backup preservation, rollback and removal', async () => {
  const v1 = await createPluginTemplatePackage({ id: 'custom-counter', name: '计数扩展', version: '1.0.0' });
  const v2 = await createPluginTemplatePackage({ id: 'custom-counter', name: '计数扩展 Pro', version: '1.1.0' });

  const step1 = await installPluginPackage({}, v1);
  assert.equal(step1.upgraded, false);
  assert.equal(step1.canRollback, false);
  assert.equal(step1.nextState.installed['custom-counter'].manifest.version, '1.0.0');

  const step2 = await installPluginPackage(step1.nextState, v2);
  assert.equal(step2.upgraded, true);
  assert.equal(step2.previousVersion, '1.0.0');
  assert.equal(step2.canRollback, true);
  assert.equal(step2.nextState.installed['custom-counter'].manifest.version, '1.1.0');

  const rolled = rollbackPluginPackage(step2.nextState, 'custom-counter');
  assert.equal(rolled.restored.manifest.version, '1.0.0');
  assert.equal(rolled.nextState.installed['custom-counter'].manifest.version, '1.0.0');
  assert.equal(rolled.nextState.backups['custom-counter'], undefined);

  const removed = removePluginPackage(rolled.nextState, 'custom-counter');
  assert.equal(removed.nextState.installed['custom-counter'], undefined);

  const catalog = defaultExtensionCatalog();
  assert.ok(catalog.length >= 7);
  assert.ok(catalog.some(item => item.id === 'reading-stats-helper' && item.isolation === 'sandboxed-iframe'));
});
