import { readFile, mkdir, copyFile, cp, symlink, realpath, access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { verifySharedSource } from './shared-source.mjs';
import { bundledLicensePlugin } from './bundle-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { shared: inklet } = await verifySharedSource();
const dependencyPath = path.join(root, 'app/node_modules');
const sharedDependencies = path.join(inklet, 'app/node_modules');
await access(dependencyPath);
try { if (await realpath(sharedDependencies) !== await realpath(dependencyPath)) throw new Error('Frozen source dependency link points outside this project'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(dependencyPath, sharedDependencies, 'junction'); }
const require = createRequire(path.join(root, 'app/package.json'));
const { build } = require('vite');
const metadata = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'));
const { modernFontSources } = await import('../vendor/inklet/app/vite.config.js');

const publicDir = path.join(root, 'app/public');
await mkdir(publicDir, { recursive: true });
await copyFile(path.join(inklet, 'app/public/paper-grain.png'), path.join(publicDir, 'paper-grain.png'));
await rm(path.join(publicDir, 'excalidraw/fonts/Liberation'), { recursive: true, force: true });
for (const family of await readdir(path.join(dependencyPath, '@excalidraw/excalidraw/dist/prod/fonts'))) if (family !== 'Liberation') await cp(path.join(dependencyPath, '@excalidraw/excalidraw/dist/prod/fonts', family), path.join(publicDir, 'excalidraw/fonts', family), { recursive: true });

const aliases = Object.keys(metadata.dependencies).map(name => ({
  find: name,
  replacement: path.join(dependencyPath, name),
}));

await build({
  root: path.join(root, 'app'),
  configFile: false,
  base: './',
  publicDir,
  logLevel: 'warn',
  resolve: { alias: aliases },
  plugins: [bundledLicensePlugin(root)],
  define: {
    PACKAGE_VERSION: JSON.stringify('3.2.1'),
    __INKLET_DONATION__: JSON.stringify(false),
    __INKLOOM_TEST__: JSON.stringify(process.argv.includes('--test')),
  },
  worker: {
    format: 'es',
     rollupOptions: {},
    plugins: () => [{
      name: 'inkloom-worker-alias',
      config: () => ({ resolve: { alias: aliases }, define: { PACKAGE_VERSION: JSON.stringify('3.2.1') } }),
    }],
  },
  css: { postcss: { plugins: [modernFontSources] } },
  build: {
    outDir: path.join(root, 'app/dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});

await mkdir(path.join(root, 'licenses'), { recursive: true });
await cp(path.join(inklet, 'licenses'), path.join(root, 'licenses'), { recursive: true });
for (const name of ['comlink', 'd3-force', 'd3-dispatch', 'd3-quadtree', 'd3-timer', 'postcss', 'postcss-value-parser', 'nanoid', 'picocolors', 'source-map-js', 'gridstack', 'preact']) {
  await copyFile(path.join(dependencyPath, name, 'LICENSE'), path.join(root, 'licenses', name + '-LICENSE.txt'));
}
await copyFile(path.join(dependencyPath, '@tanstack/table-core/LICENSE'), path.join(root, 'licenses', 'tanstack-table-core-LICENSE.txt'));
for (const name of ['core', 'daygrid', 'interaction']) await copyFile(path.join(dependencyPath, '@fullcalendar', name, 'LICENSE.md'), path.join(root, 'licenses', 'fullcalendar-' + name + '-LICENSE.txt'));
await copyFile(path.join(dependencyPath, 'rrule/LICENCE'), path.join(root, 'licenses', 'rrule-LICENSE.txt'));
await copyFile(path.join(dependencyPath, 'tslib/LICENSE.txt'), path.join(root, 'licenses', 'tslib-LICENSE.txt'));
await copyFile(path.join(dependencyPath, 'tslib/CopyrightNotice.txt'), path.join(root, 'licenses', 'tslib-CopyrightNotice.txt'));
console.log('INKLOOM_WEB_BUILD_OK');
