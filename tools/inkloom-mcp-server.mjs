#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { handleMcpJsonRpcRequest } from '../core/mcp-stdio-protocol.mjs';
import { parseFrontMatter } from '../core/vault-graph.mjs';

/**
 * Inkloom External Model Context Protocol (MCP) Stdio Server
 * Connects VS Code GitHub Copilot, Claude Desktop, Cursor, or any MCP client
 * directly to a local Inkloom Markdown vault directory.
 *
 * Usage:
 *   node tools/inkloom-mcp-server.mjs --vault "C:/path/to/vault"
 */

const vaultIdx = process.argv.indexOf('--vault');
const vaultRoot = path.resolve(vaultIdx >= 0 && process.argv[vaultIdx + 1] ? process.argv[vaultIdx + 1] : process.cwd());
const readOnlyMode = process.argv.includes('--read-only') || process.env.INKLOOM_MCP_READONLY === '1';

function safeResolveInsideVault(...segments) {
  const resolved = path.resolve(vaultRoot, ...segments);
  const rootWithSep = vaultRoot.endsWith(path.sep) ? vaultRoot : vaultRoot + path.sep;
  if (resolved !== vaultRoot && !resolved.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    throw new Error('MCP 路径边界拦截：目标路径越出当前知识库根目录');
  }
  return resolved;
}

async function scanVaultNotes(dir, relPrefix = '') {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absPath = path.join(dir, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await scanVaultNotes(absPath, relPath));
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      const source = await readFile(absPath, 'utf8').catch(() => '');
      const fm = parseFrontMatter(source);
      const stem = entry.name.replace(/\.(md|markdown)$/i, '');
      const title = fm.properties?.title || stem;
      const tags = Array.isArray(fm.properties?.tags) ? fm.properties.tags : [];
      results.push({
        id: relPath,
        name: entry.name,
        title,
        cleanTitle: title,
        stem,
        relativePath: relPath,
        folder: relPrefix || '根目录',
        tags,
        metadata: fm.properties || {},
        source,
      });
    }
  }
  return results;
}

const fileSystemAdapter = {
  readOnly: readOnlyMode,
  async listNotes() {
    return scanVaultNotes(vaultRoot);
  },
  async createNote({ title, folder, source }) {
    const safeName = String(title || '新建笔记').replace(/[<>:"/\\|?*]/g, '-') + '.md';
    const targetDir = folder ? safeResolveInsideVault(folder) : vaultRoot;
    await mkdir(targetDir, { recursive: true });
    const fullPath = safeResolveInsideVault(targetDir, safeName);
    await writeFile(fullPath, source, 'utf8');
    return { relativePath: folder ? `${folder}/${safeName}` : safeName };
  },
  async updateNote(target, nextSource) {
    const fullPath = safeResolveInsideVault(target.relativePath || target.name);
    await writeFile(fullPath, nextSource, 'utf8');
    return { updated: true };
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed);
    const response = await handleMcpJsonRpcRequest(request, fileSystemAdapter);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err?.message || String(err)}` },
    }) + '\n');
  }
});
