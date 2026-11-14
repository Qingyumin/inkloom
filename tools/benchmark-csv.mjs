// Convert an Inkloom benchmark results.json into a flat results.csv next to it.
// Usage: node tools/benchmark-csv.mjs [path-to-results.json]
// Default: newest verification/benchmark-*/results.json
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function latestResultsPath() {
  const verification = path.join(root, 'verification');
  const dirs = (await readdir(verification, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('benchmark-'))
    .map(entry => entry.name)
    .sort();
  if (!dirs.length) throw new Error('No benchmark-* directory under verification/');
  return path.join(verification, dirs[dirs.length - 1], 'results.json');
}

const csvCell = value => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

const resultsPath = path.resolve(process.argv[2] || await latestResultsPath());
const report = JSON.parse(await readFile(resultsPath, 'utf8'));

const columns = [
  ['version', () => report.version],
  ['browser_channel', () => report.browserChannel],
  ['created_at', () => report.createdAt],
  ['count', row => row.count],
  ['dataset_sha256', row => row.datasetSha256],
  ['legacy_status', row => row.legacy?.status],
  ['legacy_ms', row => row.legacy?.ms],
  ['legacy_links', row => row.legacy?.links],
  ['incremental_status', row => row.incremental?.status],
  ['incremental_cold_ms', row => row.incremental?.coldMs],
  ['edit_median_ms', row => row.incremental?.editMedianMs],
  ['edit_max_ms', row => row.incremental?.editMaxMs],
  ['query_ms', row => row.incremental?.queryMs],
  ['parsed_per_edit', row => row.incremental?.parsedPerEdit],
  ['edges', row => row.incremental?.edges],
  ['nodes', row => row.incremental?.nodes],
  ['worker_heap_mib', row => row.incremental?.workerHeapMiB],
  ['browser_ready_ms', row => row.browser?.readyMs],
  ['input_to_index_ms', row => row.browser?.inputToIndexMs],
  ['search_ms', row => row.browser?.searchMs],
  ['graph_ms', row => row.browser?.graphMs],
  ['graph_state', row => row.browser?.graph?.state],
  ['graph_layout_ms', row => row.browser?.graph?.layoutMs],
  ['graph_pixels', row => row.browser?.graph?.pixels],
  ['graph_disable_ms', row => row.browser?.graphDisableMs],
  ['table_pagination_ms', row => row.browser?.tablePaginationMs],
  ['plugin_disable_ms', row => row.browser?.pluginDisableMs],
  ['renderer_heap_mib', row => row.browser?.rendererHeapMiB],
  ['max_long_task_ms', row => row.browser?.maximumLongTaskMs],
  ['rendered_note_buttons', row => row.browser?.renderedNoteButtons],
  ['warm_ready_ms', row => row.browser?.warmCache?.readyMs],
  ['warm_parsed', row => row.browser?.warmCache?.parsed],
  ['warm_hydrated', row => row.browser?.warmCache?.hydrated],
  ['passed', () => report.passed],
];

const lines = [columns.map(([name]) => name).join(',')];
for (const row of report.results) {
  lines.push(columns.map(([, read]) => csvCell(read(row))).join(','));
}

const csvPath = path.join(path.dirname(resultsPath), 'results.csv');
await writeFile(csvPath, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
console.log('INKLOOM_BENCHMARK_CSV', csvPath, 'rows=' + report.results.length, 'passed=' + report.passed);
