import { IncrementalVaultIndex, hydrateGraph } from './vault-index.mjs';
import { TaskQueue, taskCancelled } from './task-queue.mjs';
import { queryWorkspace } from './workspace-model.mjs';
import { queryDatabasePage } from './database-query.mjs';
import { queryGraphSnapshot } from './graph-query.mjs';
import { cacheChecksum } from './index-cache.mjs';
import { searchVaultContext } from './ai-retrieval.mjs';
import { checkManuscriptConsistency, buildCrossChapterEntityTimelineMatrix } from './ai-assistant.mjs';
import { evaluateSkillNote } from './ai-skills.mjs';
import { discoverSmartWikiLinks } from './smart-wikilinks.mjs';
import { analyzeOrphanWeaving, generateKnowledgeDigest } from './knowledge-synthesis.mjs';
import { extractFlashcardsFromNotes } from './spaced-repetition.mjs';
import { diagnoseVaultHealth } from './vault-doctor.mjs';
import { createVaultSnapshot, diffVaultSnapshot } from './vault-snapshot.mjs';
import { runLocalMcpAgentSession, computeFolderSyncPlan, buildMirrorSimulationFixture } from './local-agent-sync.mjs';
import { runKarpathyWikiCompiler, buildCognitiveEvolutionChronicle, computeThermodynamicAwakening } from './karpathy-wiki-chronicle.mjs';

export class IndexSynchronizationService {
  constructor({ cache, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), now = () => performance.now(), budgetMs = 20000, chunkSize = 32 }) {
    this.cache = cache; this.yieldTask = yieldTask; this.now = now; this.budgetMs = budgetMs; this.chunkSize = chunkSize;
    this.generation = 0; this.running = Promise.resolve(); this.scope = null;
    this.index = new IncrementalVaultIndex(); this.cached = new Map(); this.dirty = new Set(); this.pendingWrites = new Set(); this.pendingDeletes = new Set(); this.cacheError = '';
    this.queries = new TaskQueue({ budgetMs: 4500 }); this.queryControllers = new Map(); this.published = null;
  }

  update(request) {
    if (!request || typeof request.scope !== 'string' || !request.scope || !Array.isArray(request.ids) || !Array.isArray(request.upserts) || !Array.isArray(request.removed)) return Promise.reject(new Error('索引请求格式无效'));
    const ids = new Set(request.ids);
    if (ids.size !== request.ids.length || request.ids.some(id => typeof id !== 'string' || !id) || request.removed.some(id => typeof id !== 'string') || request.upserts.some(note => !note || !ids.has(note.id) || typeof note.source !== 'string')) return Promise.reject(new Error('索引笔记身份或原文无效'));
    const generation = ++this.generation;
    this.queries.cancelAll('Index changed');
    const next = this.running.catch(() => {}).then(() => this.synchronize(request, generation));
    this.running = next; return next;
  }

  cancel() { this.generation++; this.queries.cancelAll(); }

  query(request) {
    if (!request || typeof request.id !== 'string' || !request.id || this.queryControllers.has(request.id) || !['database', 'graph', 'notes', 'read', 'workspace', 'ai'].includes(request.kind)) return Promise.reject(new Error('Invalid index query'));
    const controller = new AbortController(); this.queryControllers.set(request.id, controller);
    return this.queries.submit(async ({ signal }) => {
      await this.running;
      const generation = this.generation;
      const check = () => {
        if (signal.aborted || generation !== this.generation || request.scope !== this.scope || !this.published || request.version !== this.published.version) throw taskCancelled('Index query is stale or cancelled');
      };
      check();
      const graph = hydrateGraph(structuredClone(this.published), id => this.index.notes.get(id)?.source || '');
      const options = request.options || {}; let result;
      if (request.kind === 'database') {
        result = queryDatabasePage(graph, options);
        await Promise.all(result.rows.map(async row => { row.version = await cacheChecksum(this.index.notes.get(row.id).source); }));
      } else if (request.kind === 'workspace') result = { ...queryWorkspace(graph, options), vaultKey: this.scope };
      else if (request.kind === 'graph') result = { ...queryGraphSnapshot(graph, options.activeId || '', options), vaultKey: this.scope };
      else if (request.kind === 'ai') {
        const versions = new Map();
        await Promise.all(graph.notes.map(async note => {
          versions.set(note.id, await cacheChecksum(this.index.notes.get(note.id)?.source || ''));
        }));
        const subkind = options.subkind || 'search';
        if (subkind === 'search') {
          result = { ...searchVaultContext(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'consistency') {
          result = { ...checkManuscriptConsistency(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'entity-timeline-matrix') {
          result = { ...buildCrossChapterEntityTimelineMatrix(graph.notes, options), vaultKey: this.scope };
        } else if (subkind === 'smart-wikilinks') {
          const activeId = options.activeNoteId || options.scope?.activeNoteId || '';
          const baseNote = graph.nodeMap.get(activeId);
          const activeNote = baseNote
            ? { ...baseNote, source: typeof options.draftSource === 'string' ? options.draftSource : baseNote.source }
            : (typeof options.draftSource === 'string' ? { id: activeId || 'draft', title: options.draftTitle || '草稿', source: options.draftSource } : null);
          const suggestions = discoverSmartWikiLinks(graph.notes, activeNote, options);
          result = { suggestions, vaultKey: this.scope };
        } else if (subkind === 'weaver') {
          result = { ...analyzeOrphanWeaving(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'digest') {
          result = { ...generateKnowledgeDigest(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'flashcards') {
          result = { ...extractFlashcardsFromNotes(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'doctor') {
          result = { ...diagnoseVaultHealth(graph.notes, { ...options, versions }), vaultKey: this.scope };
        } else if (subkind === 'snapshot') {
          result = { snapshot: createVaultSnapshot(graph.notes, { label: options.label, vaultName: this.scope }), vaultKey: this.scope };
        } else if (subkind === 'snapshot-diff') {
          result = { ...diffVaultSnapshot(graph.notes, options.snapshot), vaultKey: this.scope };
        } else if (subkind === 'mcp-agent') {
          result = { ...runLocalMcpAgentSession(graph.notes, options), vaultKey: this.scope };
        } else if (subkind === 'karpathy-compiler') {
          result = { ...runKarpathyWikiCompiler(graph.notes, options), vaultKey: this.scope };
        } else if (subkind === 'cognitive-chronicle') {
          result = { ...buildCognitiveEvolutionChronicle(graph.notes, options), vaultKey: this.scope };
        } else if (subkind === 'thermodynamic-awakening') {
          result = { ...computeThermodynamicAwakening(graph.notes, options), vaultKey: this.scope };
        } else if (subkind === 'folder-sync') {
          const fixture = Array.isArray(options.mirrorNotes)
            ? { mirrorLabel: options.mirrorLabel || '外部镜像目录', mirrorNotes: options.mirrorNotes, baselineHashes: options.baselineHashes || {} }
            : buildMirrorSimulationFixture(graph.notes);
          const plan = computeFolderSyncPlan(graph.notes, fixture.mirrorNotes, fixture.baselineHashes);
          result = { ...plan, mirrorLabel: fixture.mirrorLabel, mirrorNotes: fixture.mirrorNotes, baselineHashes: fixture.baselineHashes, vaultKey: this.scope };
        } else if (subkind === 'skills') {
          const skills = [];
          const sources = [];
          for (const note of graph.notes) {
            const version = versions.get(note.id) || '';
            if (note.metadata?.category === 'skill') {
              skills.push({ id: note.id, title: note.title, relativePath: note.relativePath, version, evaluation: evaluateSkillNote(note, versions) });
            } else {
              sources.push({ id: note.id, title: note.title, relativePath: note.relativePath, folder: note.folder, category: note.metadata?.category || '', version });
            }
          }
          result = { skills, sources: sources.slice(0, 100), vaultKey: this.scope };
        } else {
          const folders = graph.foldersIndex.map(f => f.folder);
          const projects = graph.notes.filter(n => n.metadata?.category === 'project').map(n => ({ id: n.id, title: n.title }));
          const manuscripts = graph.notes.filter(n => n.metadata?.category === 'manuscript').map(n => ({ id: n.id, title: n.title }));
          result = { folders, projects, manuscripts, totalNotes: graph.notes.length, vaultKey: this.scope };
        }
      } else if (request.kind === 'read') {
        const note = this.index.notes.get(options.id); if (!note) throw new Error('笔记不存在');
        result = { id: note.id, source: note.source, version: await cacheChecksum(note.source) };
      } else {
        const text = String(options.text || '').toLocaleLowerCase();
        const limit = Math.min(250, Math.max(1, Number(options.limit) || 100));
        result = graph.notes.filter(note => (!options.orphan || note.orphan) && (!text || [note.title, note.name, note.folder, ...note.tags].join(' ').toLocaleLowerCase().includes(text))).slice(0, limit)
          .map(note => ({ id: note.id, title: note.title, folder: note.folder, tags: note.tags, degree: note.degree }));
        await Promise.all(result.map(async row => { row.version = await cacheChecksum(this.index.notes.get(row.id).source); }));
      }
      check(); return { scope: this.scope, version: this.published.version, result };
    }, { signal: controller.signal }).finally(() => this.queryControllers.delete(request.id));
  }

  cancelQuery(id) { this.queryControllers.get(id)?.abort(); }

  async synchronize(request, generation) {
    if (generation !== this.generation) return null;
    const started = this.now();
    const active = () => {
      if (generation !== this.generation) return false;
      if (this.now() - started > this.budgetMs) throw new Error('索引计算超过时间预算，请重试');
      return true;
    };
    if (request.reset || request.scope !== this.scope) {
      this.scope = request.scope; this.index = new IncrementalVaultIndex(); this.cached = new Map();
      this.dirty = new Set(); this.pendingWrites = new Set(); this.pendingDeletes = new Set(); this.cacheError = '';
      try {
        const loaded = await this.cache.load(request.scope, { reset: request.reset === true });
        this.cached = loaded.records || loaded;
        this.cacheError = loaded.warning || '';
      } catch (error) { this.cacheError = '缓存读取不可用：' + error.message; }
    }
    if (!active()) return null;
    const liveIds = new Set(request.ids);
    const removed = new Set([...request.removed, ...[...this.index.notes.keys(), ...this.cached.keys()].filter(id => !liveIds.has(id))]);
    for (const id of removed) {
      for (const sourceId of this.index.remove(id)) this.dirty.add(sourceId);
      this.cached.delete(id); this.pendingDeletes.add(id); this.pendingWrites.delete(id);
    }
    let processed = 0;
    for (const note of request.upserts) {
      if (!active()) return null;
      const result = this.index.upsert(note, this.cached.get(note.id));
      this.cached.delete(note.id);
      if (result.changed) {
        if (!result.hydrated) this.pendingWrites.add(note.id);
        this.pendingDeletes.delete(note.id);
        for (const id of result.affected) this.dirty.add(id);
      }
      if (++processed % this.chunkSize === 0) await this.yieldTask();
    }
    for (const id of this.dirty) {
      if (!active()) return null;
      this.index.relink(id); this.dirty.delete(id);
      if (++processed % this.chunkSize === 0) await this.yieldTask();
    }
    if (!active()) return null;
    try {
      if (this.pendingWrites.size || this.pendingDeletes.size) {
        const notes = new Map([...this.pendingWrites].filter(id => this.index.notes.has(id)).map(id => [id, this.index.notes.get(id)]));
        await this.cache.save(request.scope, notes, [...this.pendingDeletes]);
        this.pendingWrites.clear(); this.pendingDeletes.clear();
      }
    } catch (error) { this.cacheError = '缓存写入不可用：' + error.message; }
    if (!active()) return null;
    const snapshot = this.index.snapshot(request.activeId);
    if (!active()) return null;
    this.published = snapshot;
    const rejected = this.index.counters.rejectedCache;
    return { ...snapshot, scope: request.scope, requestGeneration: generation, cacheError: [this.cacheError, rejected ? `${rejected} 条缓存与原文不一致，已重新解析` : ''].filter(Boolean).join('；') };
  }
}