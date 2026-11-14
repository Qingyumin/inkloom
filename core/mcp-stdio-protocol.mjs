import {
  canAiAccessNote,
  analyzePercolationAndTension,
  compileClusterToWikiPage,
  compileRawDocumentToWikiBundle,
} from './karpathy-wiki-chronicle.mjs';
import { extractWikiLinks, parseFrontMatter, updateFrontMatterProperties, localDate, stripNumericPrefix } from './vault-graph.mjs';

export function validateMcpVaultRelativePath(inputPath = '') {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  if (raw.includes('\0') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//')) {
    throw new Error(`🔒 MCP 路径边界拦截：禁止访问绝对路径或外部盘符 (${raw})`);
  }
  const normalized = raw.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/');
  if (parts.some(p => p === '..' || p === '.')) {
    throw new Error(`🔒 MCP 路径边界拦截：禁止包含 .. 或 . 路径穿越段 (${raw})`);
  }
  return normalized;
}

/**
 * Standard Model Context Protocol (MCP 2024-11-05) JSON-RPC 2.0 Engine for Inkloom
 * Enables external AI clients (VS Code GitHub Copilot, Claude Desktop, Cursor, Windsurf)
 * to directly search, read, create, update, and traverse notes in an Inkloom vault,
 * just like mcp-obsidian or @notionhq/notion-mcp-server.
 */

export const INKLOOM_MCP_PROTOCOL_VERSION = '2024-11-05';

export const EXTERNAL_MCP_TOOLS_SPEC = [
  {
    name: 'inkloom_list_vault',
    description: '列出 Inkloom 知识库中的文件夹、标签统计及笔记清单（自动过滤 privacy: locked 的加密私密笔记）。',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: '可选：按文件夹前缀过滤（如 wiki、journals）' },
        tag: { type: 'string', description: '可选：按标签名过滤' },
        limit: { type: 'number', description: '返回最大条数（默认 50）' },
      },
    },
  },
  {
    name: 'inkloom_search_notes',
    description: '在 Inkloom 知识库中执行全文、标题与标签检索，返回匹配笔记路径、行号与上下文片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或短语' },
        folder: { type: 'string', description: '可选：限定检索目录' },
        limit: { type: 'number', description: '返回最大结果数（默认 10）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'inkloom_read_note',
    description: '读取指定 Inkloom 笔记的完整 Markdown 原文、YAML Frontmatter 属性及出链/反链脉络。',
    inputSchema: {
      type: 'object',
      properties: {
        titleOrPath: { type: 'string', description: '笔记标题、文件名或相对路径（如 01-双链笔记与卡片盒方法.md）' },
      },
      required: ['titleOrPath'],
    },
  },
  {
    name: 'inkloom_create_note',
    description: '在 Inkloom 知识库中创建一篇新 Markdown 笔记，自动补全标准 YAML Frontmatter 与双链索引。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '新笔记标题' },
        folder: { type: 'string', description: '存放目录（默认根目录或 notes）' },
        tags: { type: 'array', items: { type: 'string' }, description: 'YAML 标签数组' },
        content: { type: 'string', description: 'Markdown 正文内容' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'inkloom_update_note',
    description: '修改或向指定 Inkloom 笔记追加内容（支持 append 末尾追加、replace 全文更新或 properties 属性更新，受隐私护栏保护）。',
    inputSchema: {
      type: 'object',
      properties: {
        titleOrPath: { type: 'string', description: '目标笔记标题或相对路径' },
        mode: { type: 'string', enum: ['append', 'replace', 'heading-append'], description: '更新方式：append(追加) | replace(替换) | heading-append(指定章节后追加)' },
        content: { type: 'string', description: '要写入或追加的 Markdown 文本' },
        heading: { type: 'string', description: '当 mode=heading-append 时的目标章节标题' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选：同步更新的标签列表' },
      },
      required: ['titleOrPath', 'content'],
    },
  },
  {
    name: 'inkloom_graph_neighbors',
    description: '查询指定笔记的一跳出链、反向链接（Backlinks）及关联知识簇，辅助 AI 理解上下文脉络。',
    inputSchema: {
      type: 'object',
      properties: {
        titleOrPath: { type: 'string', description: '目标笔记标题或相对路径' },
      },
      required: ['titleOrPath'],
    },
  },
  {
    name: 'inkloom_compile_wiki',
    description: '调用 Inkloom 的 Karpathy 知识编译器，支持摄取指定 raw/ 原始资料生成 wiki/sources/ 文献页，或将指定主题的多篇资料与笔记编译合成为 wiki/topics/ 跨源专题综合页。',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '要编译的专题名称或关键词（留空则编译最高就绪度专题）' },
        rawFile: { type: 'string', description: '可选：指定要直接摄取编译的 raw/ 原始资料文件名或路径' },
        saveToVault: { type: 'boolean', description: '是否直接写入 wiki/ 目录（默认 true）' },
      },
    },
  },
];

export function buildExternalMcpClientConfigs({
  serverScriptPath = 'C:/path/to/inkloom/tools/inkloom-mcp-server.mjs',
  vaultPath = 'C:/Users/<用户名>/Documents/InkloomVault',
  nodePath = 'node',
} = {}) {
  const normScript = String(serverScriptPath).replace(/\\/g, '/');
  const normVault = String(vaultPath).replace(/\\/g, '/');
  const vscodeMcpJson = JSON.stringify({
    servers: {
      'inkloom-vault': {
        type: 'stdio',
        command: nodePath,
        args: [normScript, '--vault', normVault],
        env: {
          INKLOOM_PRIVACY_GUARD: 'strict',
        },
      },
    },
  }, null, 2);

  const claudeConfigJson = JSON.stringify({
    mcpServers: {
      'inkloom-vault': {
        command: nodePath,
        args: [normScript, '--vault', normVault],
      },
    },
  }, null, 2);

  return {
    vscodeMcpJson,
    claudeConfigJson,
    cliCommand: `${nodePath} "${normScript}" --vault "${normVault}"`,
  };
}

export function defaultMcpSecurityPolicy() {
  const enabledTools = {};
  for (const spec of EXTERNAL_MCP_TOOLS_SPEC) {
    enabledTools[spec.name] = true;
  }
  return {
    enabledTools,
    allowedFolders: [],
    readOnlyMode: false,
  };
}

export function evaluateMcpSecurityPolicy(policy = {}, { method = 'tools/call', toolName = '', targetPath = '' } = {}) {
  const enabledMap = policy?.enabledTools || {};
  if (method === 'tools/call' && toolName && enabledMap[toolName] === false) {
    return {
      allowed: false,
      code: 'TOOL_DISABLED',
      reason: `🔒 MCP 权限审计拦截：工具 ${toolName} 已被管理员停用`,
    };
  }
  const whitelist = Array.isArray(policy?.allowedFolders)
    ? policy.allowedFolders.map(f => String(f || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').trim()).filter(Boolean)
    : typeof policy?.allowedFolders === 'string' && policy.allowedFolders.trim()
      ? policy.allowedFolders.split(/[,，;；]/).map(f => f.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').trim()).filter(Boolean)
      : [];

  if (whitelist.length > 0 && targetPath) {
    const cleanRel = String(targetPath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').trim();
    if (cleanRel) {
      const matched = whitelist.some(prefix => {
        const pl = prefix.toLowerCase();
        const rl = cleanRel.toLowerCase();
        return rl === pl || rl.startsWith(pl + '/');
      });
      if (!matched) {
        return {
          allowed: false,
          code: 'FOLDER_NOT_WHITELISTED',
          reason: `🔒 MCP 目录白名单拦截：路径「${cleanRel}」不在允许目录白名单 [${whitelist.join(', ')}] 内`,
        };
      }
    }
  }
  return {
    allowed: true,
    code: 'OK',
    reason: '符合 MCP 工具权限与目录白名单策略',
  };
}

export function recordMcpAuditEntry(auditLog = [], entry = {}) {
  const prev = Array.isArray(auditLog) ? auditLog : [];
  const record = {
    auditId: entry.auditId || `mcp-audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    requestId: entry.requestId ?? null,
    method: String(entry.method || 'tools/call'),
    toolName: String(entry.toolName || '-'),
    targetPath: String(entry.targetPath || '*'),
    decision: entry.decision === 'DENIED' ? 'DENIED' : 'ALLOWED',
    reason: String(entry.reason || 'OK'),
  };
  return [record, ...prev].slice(0, 100);
}

export function formatMcpAuditLedgerMarkdown(policy = defaultMcpSecurityPolicy(), auditLog = []) {
  const enabledList = EXTERNAL_MCP_TOOLS_SPEC.filter(t => policy?.enabledTools?.[t.name] !== false).map(t => `\`${t.name}\``);
  const disabledList = EXTERNAL_MCP_TOOLS_SPEC.filter(t => policy?.enabledTools?.[t.name] === false).map(t => `\`${t.name}\``);
  const whitelist = Array.isArray(policy?.allowedFolders) && policy.allowedFolders.length
    ? policy.allowedFolders.map(f => `\`${f}\``).join('、')
    : '全部公开目录（自动物理拦截 `@privacy: locked / confidential`）';
  const rows = (auditLog || []).slice(0, 20).map(item =>
    `| ${String(item.timestamp || '').replace('T', ' ').slice(0, 19)} | \`${item.method}\` | \`${item.toolName}\` | \`${item.targetPath}\` | **${item.decision}** | ${item.reason} |`,
  );
  return [
    '# 🛡️ 外部 MCP 权限策略与 JSON-RPC 调用审计账本 (MAJOR-210)',
    '',
    '## 一、 当前生效安全策略',
    `- **已启用工具 (${enabledList.length}/${EXTERNAL_MCP_TOOLS_SPEC.length})**：${enabledList.join(' · ') || '无'}`,
    `- **已停用工具 (${disabledList.length})**：${disabledList.join(' · ') || '无'}`,
    `- **允许目录白名单**：${whitelist}`,
    '',
    '## 二、 JSON-RPC 2.0 实时调用审计账本',
    '',
    '| 时间戳 | JSON-RPC 方法 | 调用工具 | 目标路径/范围 | 审计判定 | 详细原因 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| - | `tools/call` | - | - | **READY** | 暂无外部调用记录，点击左侧「实测 JSON-RPC 2.0 握手与调用」即可生成实时审计流水 |']),
  ].join('\n');
}

function findNoteInList(notes = [], titleOrPath = '') {
  const q = String(titleOrPath || '').trim().toLowerCase().replace(/\.(md|markdown)$/i, '');
  if (!q) return null;
  return notes.find(n => {
    const rel = String(n.relativePath || n.name || '').toLowerCase().replace(/\.(md|markdown)$/i, '');
    const title = String(n.title || '').toLowerCase();
    const clean = stripNumericPrefix(n.cleanTitle || n.title || n.name || '').toLowerCase();
    return rel === q || title === q || clean === q || rel.endsWith('/' + q) || title.includes(q) || clean.includes(q);
  }) || null;
}

export async function handleMcpJsonRpcRequest(message, adapter = {}) {
  if (!message || typeof message !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
  }
  const { id, method, params = {} } = message;

  // Notifications have no id and expect no response object
  if (method === 'notifications/initialized' || method === 'initialized') {
    return null;
  }

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: INKLOOM_MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: 'inkloom-vault-mcp',
            version: '1.7.1',
          },
        },
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: EXTERNAL_MCP_TOOLS_SPEC,
        },
      };
    }

    const allNotes = (await adapter.listNotes?.()) || [];
    const accessibleNotes = allNotes.filter(n => n && !n.ghost && n.exists !== false && canAiAccessNote(n, { isCloudProvider: false }));

    if (method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: accessibleNotes.slice(0, 100).map(n => ({
            uri: `inkloom://vault/${encodeURIComponent(n.relativePath || n.name || n.id)}`,
            name: stripNumericPrefix(n.cleanTitle || n.title || n.name || ''),
            mimeType: 'text/markdown',
            description: `文件夹: ${n.folder || '根目录'} · 标签: ${(n.tags || []).join(', ') || '无'}`,
          })),
        },
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const decoded = decodeURIComponent(uri.replace(/^inkloom:\/\/vault\//, ''));
      const target = findNoteInList(accessibleNotes, decoded);
      if (!target) {
        return { jsonrpc: '2.0', id, error: { code: -32002, message: `Resource not found or locked by privacy shield: ${decoded}` } };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: target.source || '',
            },
          ],
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const args = params.arguments || {};
      const securityPolicy = adapter.securityPolicy || defaultMcpSecurityPolicy();
      const targetCandidate = String(args.folder || args.titleOrPath || args.rawFile || '');
      const matchedTargetNote = targetCandidate ? findNoteInList(accessibleNotes, targetCandidate) : null;
      const effectivePath = matchedTargetNote
        ? (matchedTargetNote.relativePath || matchedTargetNote.folder || targetCandidate)
        : targetCandidate;
      const secEval = evaluateMcpSecurityPolicy(securityPolicy, {
        method: 'tools/call',
        toolName,
        targetPath: effectivePath,
      });
      if (!secEval.allowed) {
        adapter.onAuditLog?.({
          requestId: id,
          method: 'tools/call',
          toolName,
          targetPath: effectivePath || '*',
          decision: 'DENIED',
          reason: secEval.reason,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: secEval.reason }],
            isError: true,
          },
        };
      }
      adapter.onAuditLog?.({
        requestId: id,
        method: 'tools/call',
        toolName,
        targetPath: effectivePath || '*',
        decision: 'ALLOWED',
        reason: secEval.reason,
      });

      if (toolName === 'inkloom_list_vault') {
        const folderFilter = String(args.folder || '').trim().toLowerCase();
        const tagFilter = String(args.tag || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
        const filtered = accessibleNotes.filter(n => {
          if (folderFilter && !String(n.folder || '').toLowerCase().includes(folderFilter)) return false;
          if (tagFilter && !(n.tags || []).some(t => String(t).toLowerCase().includes(tagFilter))) return false;
          return true;
        });
        const payload = {
          totalNotes: accessibleNotes.length,
          matchedCount: filtered.length,
          notes: filtered.slice(0, limit).map(n => ({
            title: stripNumericPrefix(n.cleanTitle || n.title || n.name || ''),
            relativePath: n.relativePath || n.name,
            folder: n.folder || '根目录',
            tags: n.tags || [],
          })),
        };
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false },
        };
      }

      if (toolName === 'inkloom_search_notes') {
        const q = String(args.query || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
        const hits = [];
        for (const note of accessibleNotes) {
          if (args.folder && !String(note.folder || '').toLowerCase().includes(String(args.folder).toLowerCase())) continue;
          const src = String(note.source || '');
          const lines = src.split(/\r?\n/);
          const matchedLines = [];
          for (let idx = 0; idx < lines.length; idx++) {
            if (!q || lines[idx].toLowerCase().includes(q) || String(note.title || '').toLowerCase().includes(q)) {
              if (lines[idx].trim()) matchedLines.push({ line: idx + 1, text: lines[idx].trim().slice(0, 160) });
              if (matchedLines.length >= 3) break;
            }
          }
          if (matchedLines.length) {
            hits.push({
              title: stripNumericPrefix(note.cleanTitle || note.title || note.name || ''),
              relativePath: note.relativePath || note.name,
              folder: note.folder || '根目录',
              tags: note.tags || [],
              matches: matchedLines,
            });
          }
          if (hits.length >= limit) break;
        }
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify({ query: args.query, count: hits.length, hits }, null, 2) }], isError: false },
        };
      }

      if (toolName === 'inkloom_read_note') {
        validateMcpVaultRelativePath(args.titleOrPath);
        const rawTarget = findNoteInList(allNotes, args.titleOrPath);
        if (rawTarget && !canAiAccessNote(rawTarget, { isCloudProvider: false })) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `🔒 隐私护栏拦截：笔记《${rawTarget.title}》处于 @privacy: locked 私密锁定状态，禁止外部 AI 工具读取。` }],
              isError: true,
            },
          };
        }
        const target = findNoteInList(accessibleNotes, args.titleOrPath);
        if (!target) {
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: `未找到笔记：${args.titleOrPath}` }], isError: true },
          };
        }
        const outLinks = extractWikiLinks(target.source || '').map(l => l.target);
        const backlinks = accessibleNotes
          .filter(n => n.id !== target.id && (n.source || '').includes(target.cleanTitle || target.title || ''))
          .map(n => stripNumericPrefix(n.cleanTitle || n.title || n.name || ''));
        const payload = {
          title: stripNumericPrefix(target.cleanTitle || target.title || target.name || ''),
          relativePath: target.relativePath || target.name,
          folder: target.folder || '根目录',
          tags: target.tags || [],
          outgoingLinks: outLinks,
          backlinks,
          source: target.source || '',
        };
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false },
        };
      }

      if (toolName === 'inkloom_create_note') {
        const title = String(args.title || '新建笔记').trim();
        const folder = validateMcpVaultRelativePath(args.folder || '');
        validateMcpVaultRelativePath(title);
        if (adapter.readOnly) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ created: false, dryRun: true, reason: 'MCP Server 当前处于只读保护模式 (readOnly=true)，已生成预览提案但未写盘', title, folder: folder || '根目录' }, null, 2) }],
              isError: false,
            },
          };
        }
        const tags = Array.isArray(args.tags) && args.tags.length ? args.tags : ['MCP创建'];
        const body = String(args.content || '').trim();
        const hasFm = parseFrontMatter(body).hasFrontMatter;
        const fullSource = hasFm
          ? body
          : [
              '---',
              `title: "${title.replace(/"/g, '\\"')}"`,
              `tags: [${tags.join(', ')}]`,
              `date: ${localDate()}`,
              '---',
              '',
              body.startsWith('# ') ? body : `# ${title}\n\n${body}`,
              '',
            ].join('\n');
        const created = await adapter.createNote?.({ title, folder, source: fullSource });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ created: true, title, folder: folder || '根目录', relativePath: created?.relativePath || `${folder ? folder + '/' : ''}${title}.md` }, null, 2) }],
            isError: false,
          },
        };
      }

      if (toolName === 'inkloom_update_note') {
        validateMcpVaultRelativePath(args.titleOrPath);
        const target = findNoteInList(accessibleNotes, args.titleOrPath);
        if (!target) {
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: `未找到可编辑的笔记（或受隐私护栏保护）：${args.titleOrPath}` }], isError: true },
          };
        }
        const mode = args.mode || 'append';
        let nextSource = String(target.source || '');
        if (mode === 'replace') {
          nextSource = String(args.content || '');
        } else if (mode === 'heading-append' && args.heading) {
          const hEsc = String(args.heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const reg = new RegExp(`(^#{1,4}\\s+[^\\n]*${hEsc}[^\\n]*\\n)`, 'm');
          if (reg.test(nextSource)) {
            nextSource = nextSource.replace(reg, `$1\n${String(args.content || '').trim()}\n`);
          } else {
            nextSource = `${nextSource.trimEnd()}\n\n## ${args.heading}\n\n${String(args.content || '').trim()}\n`;
          }
        } else {
          nextSource = `${nextSource.trimEnd()}\n\n${String(args.content || '').trim()}\n`;
        }
        if (Array.isArray(args.tags) && args.tags.length) {
          nextSource = updateFrontMatterProperties(nextSource, { tags: args.tags });
        }
        if (adapter.readOnly) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ updated: false, dryRun: true, relativePath: target.relativePath || target.name, mode }, null, 2) }],
              isError: false,
            },
          };
        }
        await adapter.updateNote?.(target, nextSource);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ updated: true, relativePath: target.relativePath || target.name, mode }, null, 2) }],
            isError: false,
          },
        };
      }

      if (toolName === 'inkloom_graph_neighbors') {
        const target = findNoteInList(accessibleNotes, args.titleOrPath) || accessibleNotes[0];
        if (!target) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '知识库为空' }], isError: true } };
        }
        const outLinks = extractWikiLinks(target.source || '').map(l => stripNumericPrefix(l.target));
        const backlinks = accessibleNotes
          .filter(n => n.id !== target.id && (n.source || '').includes(target.cleanTitle || target.title || ''))
          .map(n => stripNumericPrefix(n.cleanTitle || n.title || n.name || ''));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                centerNote: stripNumericPrefix(target.cleanTitle || target.title || target.name || ''),
                outgoingLinks: [...new Set(outLinks)],
                incomingBacklinks: [...new Set(backlinks)],
              }, null, 2),
            }],
            isError: false,
          },
        };
      }

      if (toolName === 'inkloom_compile_wiki') {
        if (args.rawFile) {
          const cleanRawRel = validateMcpVaultRelativePath(args.rawFile);
          const rawCandidate = findNoteInList(accessibleNotes, cleanRawRel) || {
            name: cleanRawRel.split('/').pop() || '未命名资料.txt',
            relativePath: cleanRawRel.startsWith('raw/') ? cleanRawRel : `raw/${cleanRawRel}`,
            source: `# ${cleanRawRel}\n\n原始资料内容。`,
          };
          const bundle = compileRawDocumentToWikiBundle(rawCandidate, accessibleNotes);
          if (args.saveToVault !== false && !adapter.readOnly) {
            await adapter.createNote?.({
              title: bundle.sourcePage.cleanName,
              folder: bundle.sourcePage.folder,
              source: bundle.sourcePage.markdown,
            });
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  compiledTitle: bundle.sourcePage.title,
                  relativePath: bundle.sourcePage.relativePath,
                  entityCount: bundle.entityPages.length,
                  markdownPreview: bundle.sourcePage.markdown.slice(0, 600),
                }, null, 2),
              }],
              isError: false,
            },
          };
        }
        const { clusters, tensions } = analyzePercolationAndTension(accessibleNotes);
        const topicQuery = String(args.topic || '').trim().toLowerCase();
        const chosen = (topicQuery
          ? clusters.find(c => c.name.toLowerCase().includes(topicQuery))
          : clusters[0]) || clusters[0];
        if (!chosen) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '未找到可编译的知识主题簇' }], isError: true } };
        }
        const compiled = compileClusterToWikiPage(chosen, tensions, { existingNotes: accessibleNotes });
        if (args.saveToVault !== false && !adapter.readOnly) {
          await adapter.createNote?.({ title: compiled.cleanName, folder: compiled.folder || 'wiki/topics', source: compiled.markdown });
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                compiledTitle: compiled.title,
                relativePath: compiled.relativePath,
                sourceCount: compiled.sourceCount,
                preservedAnnotations: compiled.preservedAnnotations,
                markdownPreview: compiled.markdown.slice(0, 600),
              }, null, 2),
            }],
            isError: false,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err?.message || String(err) },
    };
  }
}
