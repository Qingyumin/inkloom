import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertOneNotePageXmlToMarkdown,
  renderOneNoteInkDrawingToSvg,
  auditOneNoteMigrationFidelity,
} from './onenote-importer.mjs';
import {
  defaultMcpSecurityPolicy,
  evaluateMcpSecurityPolicy,
  recordMcpAuditEntry,
  formatMcpAuditLedgerMarkdown,
  handleMcpJsonRpcRequest,
} from './mcp-stdio-protocol.mjs';

test('MAJOR-210 convertOneNotePageXmlToMarkdown vectorizes <one:InkDrawing> strokes to SVG and auditOneNoteMigrationFidelity verifies asset bytes', () => {
  const xmlWithInk = [
    '<?xml version="1.0"?>',
    '<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{P-INK}" name="手写墨迹与图文混排认证">',
    '  <one:Title><one:OE><one:T><![CDATA[手写墨迹与图文混排认证]]></one:T></one:OE></one:Title>',
    '  <one:Outline>',
    '    <one:Position x="40.0" y="60.0" z="0"/>',
    '    <one:OEChildren>',
    '      <one:OE><one:T><![CDATA[核心排产架构手写批注：]]></one:T></one:OE>',
    '      <one:OE>',
    '        <one:InkDrawing recognizedText="有限产能优先" color="#0f172a" width="2.5">',
    '          <one:Stroke points="12,48 48,22 86,54 132,20 184,46"/>',
    '        </one:InkDrawing>',
    '      </one:OE>',
    '    </one:OEChildren>',
    '  </one:Outline>',
    '</one:Page>',
  ].join('\n');

  const converted = convertOneNotePageXmlToMarkdown(xmlWithInk, {
    notebookName: '研发架构笔记本',
    sectionName: '手写批注分区',
    targetRootFolder: 'OneNote迁入',
  });

  assert.equal(converted.stats.inkDrawingCount, 1);
  assert.equal(converted.extractedInkDrawings.length, 1);
  assert.equal(converted.extractedInkDrawings[0].recognizedText, '有限产能优先');
  assert.ok(converted.extractedInkDrawings[0].svgXml.includes('<polyline'));
  assert.ok(converted.markdown.includes('![手写墨迹：有限产能优先](assets/onenote/'));
  assert.equal(converted.fidelityAudit.passed, true);
  assert.equal(converted.fidelityAudit.score, 100);

  // Missing attachment bytes must fail fidelity audit
  const brokenAudit = auditOneNoteMigrationFidelity({
    stats: { canvasBlocksLinearized: 1 },
    extractedImages: [],
    extractedInkDrawings: [],
    extractedAttachments: [{ fileName: 'missing.pdf', base64Data: '' }],
  });
  assert.equal(brokenAudit.passed, false);
  assert.equal(brokenAudit.missingAssetCount, 1);
});

test('MAJOR-210 handleMcpJsonRpcRequest enforces per-tool switches, directory whitelist, and records JSON-RPC audit ledger', async () => {
  const sampleNotes = [
    { id: 'n-1', title: '01-双链笔记', cleanTitle: '双链笔记', relativePath: 'notes/01-双链笔记.md', folder: 'notes', source: '# 双链笔记\n\n公开内容' },
    { id: 'n-2', title: '02-财务预测', cleanTitle: '财务预测', relativePath: 'finance/02-财务预测.md', folder: 'finance', source: '# 财务预测\n\n受限目录内容' },
  ];

  const policy = defaultMcpSecurityPolicy();
  policy.enabledTools.inkloom_create_note = false;
  policy.allowedFolders = ['notes', 'wiki'];

  let ledger = [];
  const onAuditLog = entry => {
    ledger = recordMcpAuditEntry(ledger, entry);
  };

  // 1. Disabled tool must be denied and logged
  const deniedToolResp = await handleMcpJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'inkloom_create_note', arguments: { title: 'Test', folder: 'notes', content: 'Body' } },
    },
    { listNotes: async () => sampleNotes, securityPolicy: policy, onAuditLog },
  );
  assert.equal(deniedToolResp.result.isError, true);
  assert.ok(deniedToolResp.result.content[0].text.includes('已被管理员停用'));
  assert.equal(ledger[0].decision, 'DENIED');

  // 2. Reading a note outside allowedFolders ('finance/02-财务预测.md') must be denied
  const deniedFolderResp = await handleMcpJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'inkloom_read_note', arguments: { titleOrPath: 'finance/02-财务预测.md' } },
    },
    { listNotes: async () => sampleNotes, securityPolicy: policy, onAuditLog },
  );
  assert.equal(deniedFolderResp.result.isError, true);
  assert.ok(deniedFolderResp.result.content[0].text.includes('目录白名单拦截'));
  assert.equal(ledger[0].decision, 'DENIED');

  // 3. Reading a note inside allowedFolders ('notes/01-双链笔记.md') succeeds and is logged as ALLOWED
  const allowedResp = await handleMcpJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'inkloom_read_note', arguments: { titleOrPath: 'notes/01-双链笔记.md' } },
    },
    { listNotes: async () => sampleNotes, securityPolicy: policy, onAuditLog },
  );
  assert.equal(allowedResp.result.isError, false);
  assert.equal(ledger[0].decision, 'ALLOWED');
  assert.equal(ledger.length, 3);

  const mdReport = formatMcpAuditLedgerMarkdown(policy, ledger);
  assert.ok(mdReport.includes('JSON-RPC 2.0 实时调用审计账本'));
  assert.ok(mdReport.includes('DENIED'));
  assert.ok(mdReport.includes('ALLOWED'));
});
