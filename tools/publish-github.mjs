import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'build/public-release');
const repositoryName = 'Qingyumin/inkloom';
const ownerLogin = 'Qingyumin';
const ownerId = 343513974;
const repositoryUrl = `https://github.com/${repositoryName}`;
const description = 'Inkloom (墨图) — Local-first Markdown PKM, PDF/EPUB reader, Karpathy LLM Wiki compiler, knowledge graph, Excalidraw whiteboard & long-form authoring workbench for Windows. MIT licensed.';

const ghCandidates = [
  process.env.GH_PATH,
  path.resolve(root, '../inklet-mac/.tools/gh/bin/gh.exe'),
  'gh',
].filter(Boolean);
const gh = ghCandidates.find(candidate => candidate === 'gh' || existsSync(candidate));
const gitCandidates = [
  process.env.GIT_PATH,
  'C:/Program Files/Git/cmd/git.exe',
  'git',
].filter(Boolean);
const git = gitCandidates.find(candidate => candidate === 'git' || existsSync(candidate));

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const environment = {
  ...process.env,
  GH_HOST: 'github.com',
  GH_CONFIG_DIR: process.env.GH_CONFIG_DIR || path.join(process.env.LOCALAPPDATA || '', 'InkletBuild/GitHubCLI'),
  GH_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
};

if (process.platform === 'win32') {
  let detected = '';
  if (existsSync('C:/Windows/System32/reg.exe')) {
    const regEnable = spawnSync(
      'C:/Windows/System32/reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'],
      { encoding: 'utf8', windowsHide: true }
    );
    const regServer = spawnSync(
      'C:/Windows/System32/reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (/0x1\b/i.test(regEnable.stdout || '')) {
      detected = /ProxyServer\s+REG_SZ\s+(?:https?=)?([a-z0-9.-]+:\d+)/i.exec(regServer.stdout || '')?.[1] || '';
    }
  }
  if (!detected && existsSync('C:/Windows/System32/netsh.exe')) {
    const proxyResult = spawnSync('C:/Windows/System32/netsh.exe', ['winhttp', 'show', 'proxy'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    detected = /(?:https?=)?([a-z0-9.-]+:\d+)/i.exec(proxyResult.stdout || '')?.[1] || '';
  }
  if (!detected && git) {
    const gitProxy = spawnSync(git, ['config', '--global', '--get', 'http.proxy'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    detected = (gitProxy.stdout || '').trim();
  }
  if (!detected && existsSync('C:/Windows/System32/reg.exe')) {
    const pacResult = spawnSync(
      'C:/Windows/System32/reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'AutoConfigURL'],
      { encoding: 'utf8', windowsHide: true }
    );
    const pacHost = /https?:\/\/([a-z0-9.-]+)(?::\d+)?\//i.exec(pacResult.stdout || '')?.[1] || '';
    if (pacHost) detected = `${pacHost}:8080`;
  }
  const rawProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || detected;
  if (rawProxy && !/direct access/i.test(rawProxy)) {
    environment.HTTPS_PROXY = /^https?:\/\//.test(rawProxy) ? rawProxy : `http://${rawProxy}`;
    environment.HTTP_PROXY = environment.HTTPS_PROXY;
  }
}
delete environment.GH_TOKEN;
delete environment.GITHUB_TOKEN;
delete environment.GH_ENTERPRISE_TOKEN;
delete environment.GITHUB_ENTERPRISE_TOKEN;

function command(program, args, timeout = 180000) {
  const result = spawnSync(program, args, {
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(program)} ${args.slice(0, 3).join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

const pkg = JSON.parse(await fs.readFile(path.join(root, 'app/package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || pkg.license !== 'MIT') {
  throw new Error(`Expected MIT-licensed semantic version in app/package.json, got version=${version} license=${pkg.license}`);
}

const tag = `v${version}`;
const archiveName = `Inkloom-${version}-Windows-x64.zip`;
const archivePath = path.join(root, 'release', archiveName);
const releaseReportPath = path.join(root, 'verification/release-results.json');
const sharedLock = JSON.parse(await fs.readFile(path.join(root, 'shared-source-lock.json'), 'utf8'));
const allowedDlls = new Set(
  sharedLock.files
    .filter(entry => entry.path.endsWith('.dll'))
    .map(entry => `vendor/inklet/${entry.path}`)
);

const releaseReport = JSON.parse((await fs.readFile(releaseReportPath, 'utf8')).replace(/^\ufeff/, ''));
if (
  releaseReport.version !== version ||
  releaseReport.coreTests < 164 ||
  releaseReport.nativeChecks < 19 ||
  !releaseReport.documentation?.passed
) {
  throw new Error('Verified release-results.json gate is incomplete or does not match app/package.json version.');
}

const archiveBytes = await fs.readFile(archivePath);
const archiveHash = sha256(archiveBytes);
if (archiveHash !== releaseReport.zipSha256) {
  throw new Error(`Archive SHA-256 mismatch: expected ${releaseReport.zipSha256}, actual ${archiveHash}`);
}

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(archivePath, path.join(outputDir, archiveName));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(outputDir, 'LICENSE'));
await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), path.join(outputDir, 'THIRD-PARTY-NOTICES.txt'));
await fs.writeFile(path.join(outputDir, 'SHA256SUMS.txt'), `${archiveHash}  ${archiveName}\n`, 'utf8');

const releaseNotes = `# Inkloom 墨图 ${tag}（Windows x64 便携发行版）

> **一念落笔，万象成图。**
> 面向深度思考者、科研工作者与长篇创作者的 **本地优先（Local-First）双链知识图谱、学术研读与长稿出版工作台**。主体源码基于 **MIT License** 开源。

---

## ✨ 核心特性概览

- **双栏书卷写作与双向链接**：左栏源码 + 右栏实时书卷预览同步滚动，原生支持 \`[[双链]]\`、\`![[跨篇块/章节内嵌]]\`、LaTeX 数学公式、Mermaid 图表、五色高亮批注、知识大纲思维导图与 **4 款主题知识金句分享卡（SVG / 2x PNG）**。
- **表层极简 · 菜单收纳 UI**：坚守安静克制的书写视觉场，高阶工具统一收纳于 \`.ux-popover-menu\` 按需呼出弹出菜单，零工具栏平铺堆砌。
- **万象知识星图与空间白板**：力导向星图 + **双向 BFS 最短路径寻路** + **PageRank 枢纽与社区聚类**；内置 **Excalidraw 手绘白板**，原生兼容 **Obsidian JSON Canvas 1.0（\`.canvas\`）**。
- **多维属性数据库与周期规划**：同一批笔记切换「表格 / 看板 / 画廊 / 清单」，支持计算公式列、CSV 批处理、**Dataview DQL（\`TABLE / LIST / TASK\`）**、**日/周/月/季周期手记**、写作字数冲刺里程碑与 **RFC 5545 \`.ics\` 日历双向同步**。
- **学术研读与长稿出版闭环**：内置 **PDF 原版面与 EPUB 电子书阅读器**（页码穿透溯源）、**SM-2 间隔重复闪卡与 Anki \`.apkg / TSV\` 双向互通**、多级目录长稿汇编、跨章人物/时间线矩阵，一键导出 **\`.docx\` / \`.epub\`（EPUB 3.0）/ 单文件离线微站 \`.html\` / 全屏幻灯片**。
- **本机受控 AI 与安全底座**：**Karpathy 风格 \`raw/ → wiki/\` 知识编译器**（\`Ingest / Query / Lint\`）、三态隐私护栏（\`🟢 公开\` / \`🟡 仅限本机AI\` / \`🔴 机密隔绝AI\` + AES-256-GCM 加密）、全库受控正则查找替换（一键无损回滚）、零知识 E2EE 同步仓与 **FIPS 180-4 SHA-256 全库便携归档验签（\`.inkloom-vault.zip\`）**。

---

## 🧪 本版本实测门禁数据

- **核心纯函数测试**：\`164 / 164\` 全部通过（Node TAP）
- **Windows 原生原子存储与崩溃恢复校验**：\`19 / 19\` 全部通过
- **浏览器 + Windows WebView2 真机桌面 EXE 端到端回归**：\`14\` 份报告全部 \`PASS\`（覆盖清透/暗色主题与 \`1440 / 1280 / 960 / 390\` 视口矩阵）
- **100 / 1,000 / 10,000 篇笔记增量索引与渲染基准**：3 档性能门禁全部达标

---

## 📦 下载、运行与 SHA-256 校验

1. 下载下方 **\`${archiveName}\`** 并完整解压到任意目录（切勿在压缩包内直接双击运行）。
2. 运行环境：**Windows 10 / 11 x64**（自带 \`.NET Framework 4.7.2+\` 与 \`Microsoft Edge WebView2 Runtime\`）。
3. 双击 **\`Inkloom.exe\`** 即可离线启动；首次打开将在 \`%LOCALAPPDATA%\\Inkloom\\StarterVault\` 生成示例导览库。
4. 可选完整性校验（PowerShell）：

\`\`\`powershell
Get-FileHash .\\${archiveName} -Algorithm SHA256
# 预期 SHA-256: ${archiveHash}
\`\`\`
`;
await fs.writeFile(path.join(outputDir, `release-notes-${tag}.md`), releaseNotes, 'utf8');

console.log('1. Verifying authorized GitHub account...');
const user = JSON.parse(command(gh, ['api', 'user']));
if (user.login !== ownerLogin || user.id !== ownerId) {
  throw new Error(`Unexpected GitHub account: ${user.login} (${user.id})`);
}

console.log('2. Preparing and auditing local Git worktree...');
if (!existsSync(path.join(root, '.git'))) {
  command(git, ['-C', root, 'init', '--initial-branch=main']);
}
command(git, ['-C', root, 'config', 'user.name', ownerLogin]);
command(git, ['-C', root, 'config', 'user.email', `${ownerId}+${ownerLogin}@users.noreply.github.com`]);
command(git, ['-C', root, 'config', 'core.autocrlf', 'false']);

command(git, ['-C', root, 'add', '--all']);
const trackedFiles = command(git, ['-C', root, 'ls-files'])
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

const requiredFiles = [
  'README.md',
  'LICENSE',
  'THIRD-PARTY-NOTICES.txt',
  'QUICKSTART.md',
  'docs/USER-MANUAL.md',
  'docs/images/inkloom-3.1-hero.png',
  'docs/images/demo-writing-and-menus.gif',
  'docs/images/demo-graph-views-canvas.gif',
  'docs/images/demo-research-ai-periodic.gif',
];
for (const req of requiredFiles) {
  if (!trackedFiles.includes(req)) {
    throw new Error(`Required public file missing from Git index: ${req}`);
  }
}

const forbiddenPathPattern = /(?:^|\/)(?:node_modules|build|release|verification|\.hallmark)(?:\/|$)|\.(?:exe|zip|pfx|p12|pem|key)$/i;
const currentUsername = (os.userInfo().username || '').trim();
const escapedUser = currentUsername.length >= 4 ? currentUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
const secretTokenPattern = new RegExp(
  [
    'ghp_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    '[A-Za-z]:[\\\\/]+Users[\\\\/]+(?!(?:demo|local|user|example|public|alice|bob|<)(?:[\\\\/]|$))[A-Za-z0-9_-]+',
    ...(escapedUser ? [escapedUser] : []),
  ].join('|'),
  'i'
);
let totalTrackedBytes = 0;

for (const relPath of trackedFiles) {
  if (forbiddenPathPattern.test(relPath)) {
    throw new Error(`Forbidden artifact staged in Git index: ${relPath}`);
  }
  if (relPath.toLowerCase().endsWith('.dll') && !allowedDlls.has(relPath)) {
    throw new Error(`Unexpected DLL staged in Git index: ${relPath}`);
  }
  const absPath = path.join(root, relPath);
  const stat = await fs.lstat(absPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to publish symbolic link: ${relPath}`);
  }
  totalTrackedBytes += stat.size;
  if (/\.(?:mjs|js|cjs|ts|css|html|json|md|ps1|cs|txt|yml|yaml)$/i.test(relPath)) {
    const text = await fs.readFile(absPath, 'utf8');
    if (secretTokenPattern.test(text)) {
      throw new Error(`Private user path or credential token detected in ${relPath}`);
    }
  }
}

if (totalTrackedBytes > 50 * 1024 * 1024) {
  throw new Error(`Tracked source tree exceeds 50 MB safety budget (${totalTrackedBytes} bytes).`);
}

const stagedDiff = command(git, ['-C', root, 'diff', '--cached', '--name-only']);
if (stagedDiff) {
  command(git, [
    '-C',
    root,
    '-c',
    `user.name=${ownerLogin}`,
    '-c',
    `user.email=${ownerId}+${ownerLogin}@users.noreply.github.com`,
    'commit',
    '-m',
    `Publish Inkloom (墨图) ${tag} under MIT License`,
  ]);
}
const headCommit = command(git, ['-C', root, 'rev-parse', 'HEAD']);

console.log(`3. Ensuring public GitHub repository ${repositoryName}...`);
const repoCheck = spawnSync(gh, ['api', `repos/${repositoryName}`], {
  env: environment,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000,
});
if (repoCheck.status !== 0) {
  if (!(repoCheck.stderr || '').includes('404')) {
    throw new Error(`Unable to inspect ${repositoryName}: ${(repoCheck.stderr || repoCheck.stdout || '').trim()}`);
  }
  command(gh, [
    'repo',
    'create',
    repositoryName,
    '--public',
    '--description',
    description,
    '--homepage',
    repositoryUrl,
  ]);
}

const remotes = command(git, ['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
if (!remotes.includes('origin')) {
  command(git, ['-C', root, 'remote', 'add', 'origin', `${repositoryUrl}.git`]);
} else {
  command(git, ['-C', root, 'remote', 'set-url', 'origin', `${repositoryUrl}.git`]);
}

const gitAuthArgs = [
  '-c',
  'credential.helper=',
  '-c',
  `credential.helper=!"${gh.replaceAll('\\', '/')}" auth git-credential`,
  '-c',
  'http.sslBackend=schannel',
];
if (environment.HTTPS_PROXY) {
  gitAuthArgs.push('-c', `http.proxy=${environment.HTTPS_PROXY}`);
}

console.log(`4. Pushing main (${headCommit.slice(0, 8)}, ${trackedFiles.length} files, ${(totalTrackedBytes / (1024 * 1024)).toFixed(2)} MB)...`);
command(git, ['-C', root, ...gitAuthArgs, 'push', '-u', 'origin', 'main'], 300000);

command(gh, [
  'repo',
  'edit',
  repositoryName,
  '--description',
  description,
  '--homepage',
  repositoryUrl,
  '--add-topic',
  'markdown',
  '--add-topic',
  'pkm',
  '--add-topic',
  'knowledge-graph',
  '--add-topic',
  'zettelkasten',
  '--add-topic',
  'excalidraw',
  '--add-topic',
  'obsidian',
  '--add-topic',
  'desktop-app',
  '--add-topic',
  'webview2',
]);

const remoteTree = JSON.parse(command(gh, ['api', `repos/${repositoryName}/git/trees/${headCommit}?recursive=1`]));
const remoteBlobs = remoteTree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path).sort();
if (remoteTree.truncated || remoteBlobs.length !== trackedFiles.length) {
  throw new Error(`Remote tree mismatch: remote=${remoteBlobs.length}, local=${trackedFiles.length}`);
}

console.log(`5. Publishing GitHub Release ${tag} with verified ZIP & SHA256SUMS...`);
const existingRelease = spawnSync(gh, ['api', `repos/${repositoryName}/releases/tags/${tag}`], {
  env: environment,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000,
});
const notesFile = path.join(outputDir, `release-notes-${tag}.md`);
const assetArgs = [
  path.join(outputDir, archiveName),
  path.join(outputDir, 'SHA256SUMS.txt'),
  path.join(outputDir, 'LICENSE'),
  path.join(outputDir, 'THIRD-PARTY-NOTICES.txt'),
];
if (existingRelease.status !== 0) {
  command(
    gh,
    [
      'release',
      'create',
      tag,
      '--repo',
      repositoryName,
      '--target',
      headCommit,
      '--title',
      `Inkloom 墨图 ${tag} — 本地优先双链知识图谱与长稿创作工作台`,
      '--notes-file',
      notesFile,
      ...assetArgs,
    ],
    300000
  );
} else {
  command(
    gh,
    [
      'release',
      'edit',
      tag,
      '--repo',
      repositoryName,
      '--title',
      `Inkloom 墨图 ${tag} — 本地优先双链知识图谱与长稿创作工作台`,
      '--notes-file',
      notesFile,
    ],
    120000
  );
  command(gh, ['release', 'upload', tag, '--repo', repositoryName, '--clobber', ...assetArgs], 300000);
}

const repoMeta = JSON.parse(command(gh, ['api', `repos/${repositoryName}`]));
const releaseMeta = JSON.parse(command(gh, ['api', `repos/${repositoryName}/releases/tags/${tag}`]));
const zipAsset = releaseMeta.assets.find(item => item.name === archiveName);
if (
  repoMeta.private ||
  releaseMeta.draft ||
  !zipAsset ||
  zipAsset.size !== archiveBytes.length ||
  (zipAsset.digest && zipAsset.digest !== `sha256:${archiveHash}`)
) {
  throw new Error('Published GitHub repository or release asset verification failed.');
}

const summary = {
  result: 'INKLOOM_GITHUB_PUBLISHED',
  version,
  repository: repoMeta.html_url,
  commit: headCommit,
  license: repoMeta.license?.spdx_id || 'MIT',
  trackedFiles: trackedFiles.length,
  trackedMegabytes: Number((totalTrackedBytes / (1024 * 1024)).toFixed(2)),
  releaseUrl: releaseMeta.html_url,
  downloadUrl: zipAsset.browser_download_url,
  archiveBytes: zipAsset.size,
  archiveSha256: archiveHash,
  assets: releaseMeta.assets.map(a => ({ name: a.name, bytes: a.size })),
};
await fs.writeFile(path.join(outputDir, `publication-${version}.json`), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log('INKLOOM_GITHUB_PUBLISHED', JSON.stringify(summary, null, 2));
