import { parseVaultNote, normalizeNoteKey, stripNumericPrefix, nonCodeLineRanges, maskInlineCode } from './vault-graph.mjs';

function normalizedPath(value) {
  const segments = [];
  for (const segment of normalizeNoteKey(value).split('/')) {
    if (segment === '..') { if (!segments.length) return null; segments.pop(); }
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

function addOwner(map, key, owner) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(owner);
}

function removeOwner(map, key, owner) {
  const owners = map.get(key);
  owners?.delete(owner);
  if (owners?.size === 0) map.delete(key);
}

export function buildNoteResolver(notes) {
  const byId = new Map(notes.map(note => [note.id, note]));
  const paths = new Map(); const names = new Map();
  for (const note of notes) {
    addOwner(paths, normalizeNoteKey(note.relativePath), note.id);
    for (const key of noteKeys(note)) addOwner(names, key, note.id);
  }
  return (target, sourceId) => resolveNote(target, sourceId, byId, paths, names);
}

function noteKeys(note) {
  return [...new Set([note.relativePath, note.stem, note.cleanTitle, note.title, ...note.aliases].map(normalizeNoteKey).filter(Boolean))];
}

function linkKeys(target, source) {
  const folder = source.relativePath.split('/').slice(0, -1).join('/');
  const key = normalizeNoteKey(target);
  return [...new Set([key, normalizeNoteKey(stripNumericPrefix(target)), normalizedPath((folder ? folder + '/' : '') + key)].filter(Boolean))];
}

function resolveNote(target, sourceId, notes, paths, names) {
  if (!target) return notes.has(sourceId) ? sourceId : null;
  const source = notes.get(sourceId);
  const folder = source?.relativePath.split('/').slice(0, -1).join('/') || '';
  const key = normalizeNoteKey(target);
  const local = paths.get(normalizedPath((folder ? folder + '/' : '') + key));
  if (local?.size === 1 && (!key.includes('/') || /^[.]{1,2}\//.test(target))) return [...local][0];
  const exact = paths.get(key);
  if (exact?.size === 1) return [...exact][0];
  const direct = names.get(key);
  if (direct) return direct.size === 1 ? [...direct][0] : null;
  const clean = names.get(normalizeNoteKey(stripNumericPrefix(target)));
  return clean?.size === 1 ? [...clean][0] : null;
}

export function isValidCachedNote(raw, cached) {
  if (!cached || cached.id !== raw.id || cached.source !== raw.source || cached.relativePath !== raw.relativePath) return false;
  if (raw.name && cached.name !== raw.name) return false;
  if (raw.path && cached.path !== raw.path) return false;
  if (!['name', 'stem', 'cleanTitle', 'title', 'label', 'path', 'folder', 'excerpt', 'status', 'date'].every(key => typeof cached[key] === 'string')) return false;
  const expectedClean = stripNumericPrefix(cached.stem) || cached.stem;
  if (cached.cleanTitle !== expectedClean) return false;
  if (!Number.isInteger(cached.bodyFrom) || cached.bodyFrom < 0 || cached.bodyFrom > raw.source.length) return false;
  if (!cached.metadata || typeof cached.metadata !== 'object' || Array.isArray(cached.metadata) || !Array.isArray(cached.properties)) return false;
  if (![cached.aliases, cached.tags].every(values => Array.isArray(values) && values.every(value => typeof value === 'string'))) return false;
  if (!Array.isArray(cached.tasks) || !cached.tasks.every(task => task && Number.isInteger(task.offset) && task.offset >= cached.bodyFrom && task.offset < raw.source.length && [' ', '/', 'x', 'X'].includes(raw.source[task.offset]) && ['todo', 'doing', 'done'].includes(task.state) && typeof task.repeat === 'string' && Number.isInteger(task.blockTo) && task.blockTo <= raw.source.length && typeof task.title === 'string' && typeof task.raw === 'string' && typeof task.due === 'string' && typeof task.time === 'string' && typeof task.done === 'boolean' && ['high', 'normal', 'low'].includes(task.priority) && Number.isInteger(task.from) && task.from >= cached.bodyFrom && raw.source.slice(task.from, task.from + task.raw.length) === task.raw)) return false;
  if (!Array.isArray(cached.headings) || !cached.headings.every(heading => heading && typeof heading.text === 'string' && Number.isInteger(heading.level) && heading.level >= 1 && heading.level <= 6)) return false;
  return Array.isArray(cached.wikiLinks) && cached.wikiLinks.every(link => link && ['target', 'heading', 'alias', 'display', 'raw'].every(key => typeof link[key] === 'string') && Number.isInteger(link.from) && Number.isInteger(link.to) && link.from >= cached.bodyFrom && link.to > link.from && link.to <= raw.source.length && raw.source.slice(link.from, link.to) === link.raw);
}

export class IncrementalVaultIndex {
  constructor() {
    this.notes = new Map(); this.paths = new Map(); this.names = new Map(); this.users = new Map();
    this.outgoing = new Map(); this.incoming = new Map(); this.edges = new Map(); this.ghosts = new Map();
    this.version = 0; this.counters = { parsed: 0, relinked: 0, unchanged: 0, hydrated: 0, rejectedCache: 0 };
  }

  resolve(target, sourceId) { return resolveNote(target, sourceId, this.notes, this.paths, this.names); }

  upsert(raw, cached = null) {
    if (!raw?.id || typeof raw.source !== 'string') throw new Error('A note requires an id and source');
    const previous = this.notes.get(raw.id);
    if (previous && previous.source === raw.source && previous.name === raw.name && previous.relativePath === raw.relativePath && previous.path === (raw.path || raw.relativePath) && previous.starred === Boolean(raw.starred)) {
      this.counters.unchanged++; return { changed: false, affected: [] };
    }
    const validCache = isValidCachedNote(raw, cached);
    const next = validCache ? { ...cached, ...raw, starred: Boolean(raw.starred) } : parseVaultNote(raw);
    if (validCache) this.counters.hydrated++;
    else { this.counters.parsed++; if (cached && cached.source === raw.source) this.counters.rejectedCache++; }
    const keys = new Set([...(previous ? noteKeys(previous) : []), ...noteKeys(next)]);
    const affected = new Set([raw.id]);
    for (const key of keys) for (const sourceId of this.users.get(key) || []) affected.add(sourceId);
    if (previous) {
      for (const key of noteKeys(previous)) removeOwner(this.names, key, raw.id);
      removeOwner(this.paths, normalizeNoteKey(previous.relativePath), raw.id);
      for (const link of previous.wikiLinks) for (const key of linkKeys(link.target, previous)) removeOwner(this.users, key, raw.id);
    }
    this.notes.set(raw.id, next);
    for (const key of noteKeys(next)) addOwner(this.names, key, raw.id);
    addOwner(this.paths, normalizeNoteKey(next.relativePath), raw.id);
    for (const link of next.wikiLinks) for (const key of linkKeys(link.target, next)) addOwner(this.users, key, raw.id);
    this.version++;
    return { changed: true, hydrated: validCache, affected: [...affected] };
  }

  remove(id) {
    const note = this.notes.get(id);
    if (!note) return [];
    const affected = new Set();
    for (const key of noteKeys(note)) {
      for (const sourceId of this.users.get(key) || []) if (sourceId !== id) affected.add(sourceId);
      removeOwner(this.names, key, id);
    }
    removeOwner(this.paths, normalizeNoteKey(note.relativePath), id);
    for (const link of note.wikiLinks) for (const key of linkKeys(link.target, note)) removeOwner(this.users, key, id);
    this.detach(id); this.notes.delete(id); this.version++;
    return [...affected];
  }

  detach(sourceId) {
    for (const record of this.outgoing.get(sourceId) || []) {
      const sources = this.incoming.get(record.targetId);
      sources?.delete(sourceId);
      if (!sources?.size) { this.incoming.delete(record.targetId); this.ghosts.delete(record.targetId); }
      this.edges.delete(JSON.stringify([sourceId, record.targetId]));
    }
    this.outgoing.delete(sourceId);
  }

  relink(sourceId) {
    this.detach(sourceId);
    const note = this.notes.get(sourceId);
    if (!note) return;
    this.counters.relinked++;
    const records = [];
    for (const link of note.wikiLinks) {
      const resolved = this.resolve(link.target, sourceId);
      const targetId = resolved || 'ghost:' + normalizeNoteKey(link.target);
      if (!resolved && !this.ghosts.has(targetId)) {
        const title = stripNumericPrefix(link.target) || link.target;
        this.ghosts.set(targetId, { id: targetId, title, label: title, cleanTitle: title, stem: link.target, name: link.target + '.md', relativePath: link.target + '.md', folder: '待建节点', path: null, tags: [], aliases: [], headings: [], wikiLinks: [], properties: [], metadata: {}, exists: false, ghost: true, starred: false, source: '', excerpt: '尚未创建的笔记', status: '待创建' });
      }
      const target = this.notes.get(targetId) || this.ghosts.get(targetId);
      const record = { ...link, sourceId, targetId, targetTitle: target.title, targetName: target.name, ghost: !resolved };
      records.push(record);
      if (sourceId === targetId) continue;
      if (!this.incoming.has(targetId)) this.incoming.set(targetId, new Map());
      const sources = this.incoming.get(targetId);
      if (!sources.has(sourceId)) sources.set(sourceId, []);
      sources.get(sourceId).push({ sourceId, sourceTitle: note.title, sourceName: note.name, sourcePath: note.relativePath, targetId, heading: link.heading, alias: link.alias, snippet: link.snippet, from: link.from, to: link.to, line: link.line });
      this.edges.set(JSON.stringify([sourceId, targetId]), { id: sourceId + '->' + targetId, source: sourceId, target: targetId, heading: link.heading, alias: link.alias, snippet: link.snippet, ghost: !resolved, kind: 'wikilink' });
    }
    this.outgoing.set(sourceId, records);
  }

  apply(upserts = [], removed = [], cache = new Map()) {
    const affected = new Set(); const updated = [];
    for (const id of removed) for (const sourceId of this.remove(id)) affected.add(sourceId);
    for (const raw of upserts) {
      const result = this.upsert(raw, cache.get(raw.id));
      if (result.changed) { updated.push(raw.id); for (const sourceId of result.affected) affected.add(sourceId); }
    }
    for (const sourceId of affected) this.relink(sourceId);
    return { version: this.version, updated, removed, relinked: affected.size, counters: { ...this.counters } };
  }

  mentions(targetId, limit = 200) {
    const target = this.notes.get(targetId);
    if (!target) return [];
    const terms = [...new Set([target.cleanTitle, target.title, ...target.aliases].filter(term => term.length >= 2))].sort((first, second) => second.length - first.length);
    const result = [];
    for (const source of this.notes.values()) {
      if (source.id === targetId) continue;
      for (const line of nonCodeLineRanges(source.source, source.bodyFrom)) {
        if (/^\s*#{1,6}\s/.test(line.text)) continue;
        const masked = maskInlineCode(line.text).replace(/!?\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s)]+/g, match => ' '.repeat(match.length));
        let matched = false;
        for (const term of terms) {
          let offset = masked.indexOf(term);
          while (offset >= 0) {
            const from = line.from + offset; const to = from + term.length;
            if (!source.wikiLinks.some(link => from < link.to && to > link.from)) {
              result.push({ sourceId: source.id, sourceTitle: source.title, sourceName: source.name, sourcePath: source.relativePath, targetId, targetStem: target.stem, targetCleanTitle: target.cleanTitle, matchedTerm: term, from, to, line: line.lineNum, snippet: line.text.trim().slice(0, 140) });
              matched = true; break;
            }
            offset = masked.indexOf(term, offset + term.length);
          }
          if (matched) break;
        }
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  snapshot(activeId = '') {
    const notes = [...this.notes.values()].map(note => {
      const { source, ...metadata } = note;
      const inDegree = this.incoming.get(note.id)?.size || 0;
      const outDegree = new Set((this.outgoing.get(note.id) || []).filter(link => link.targetId !== note.id).map(link => link.targetId)).size;
      return { ...metadata, inDegree, outDegree, degree: inDegree + outDegree, orphan: inDegree + outDegree === 0 };
    });
    const ghosts = [...this.ghosts.values()].map(note => ({ ...note, inDegree: this.incoming.get(note.id)?.size || 0, outDegree: 0, degree: this.incoming.get(note.id)?.size || 0, orphan: false }));
    const tags = new Map(); const folders = new Map();
    for (const note of notes) { for (const tag of note.tags) addOwner(tags, tag, note.id); addOwner(folders, note.folder, note.id); }
    const tagsIndex = [...tags].map(([tag, owners]) => ({ tag, count: owners.size, noteIds: [...owners] })).sort((first, second) => second.count - first.count || first.tag.localeCompare(second.tag, 'zh-CN'));
    const foldersIndex = [...folders].map(([folder, owners]) => ({ folder, count: owners.size, noteIds: [...owners] })).sort((first, second) => first.folder.localeCompare(second.folder, 'zh-CN'));
    return {
      version: this.version, notes, nodes: [...notes, ...ghosts], edges: [...this.edges.values()],
      backlinksByNote: [...this.incoming].map(([id, sources]) => [id, [...sources.values()].flat()]),
      outgoingByNote: [...this.outgoing], unlinkedMentionsByNote: [[activeId, this.mentions(activeId)]], tagsIndex, foldersIndex,
      stats: { totalNotes: notes.length, totalNodes: notes.length + ghosts.length, totalLinks: this.edges.size, totalTags: tags.size, orphanCount: notes.filter(note => note.orphan).length, ghostCount: ghosts.length, starredCount: notes.filter(note => note.starred).length },
      counters: { ...this.counters },
    };
  }
}

export function hydrateGraph(snapshot, sourceFor = () => '') {
  for (const note of snapshot.notes) Object.defineProperty(note, 'source', { configurable: true, get: () => sourceFor(note.id) });
  const notes = new Map(snapshot.notes.map(note => [note.id, note]));
  const nodes = snapshot.nodes.map(node => notes.get(node.id) || node);
  return { ...snapshot, nodes, nodeMap: new Map(nodes.map(node => [node.id, node])), resolveTargetId: buildNoteResolver(snapshot.notes), backlinksByNote: new Map(snapshot.backlinksByNote), outgoingByNote: new Map(snapshot.outgoingByNote), unlinkedMentionsByNote: new Map(snapshot.unlinkedMentionsByNote) };
}