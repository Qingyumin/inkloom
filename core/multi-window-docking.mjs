const VALID_TARGET_TYPES = new Set(['note', 'graph', 'whiteboard', 'reader']);

export function validateSecondaryWindowSpec(spec = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('副窗口配置不能为空');
  }
  const targetType = String(spec.targetType || 'note').trim().toLowerCase();
  if (!VALID_TARGET_TYPES.has(targetType)) {
    throw new Error(`不支持的副窗口目标类型：${targetType}`);
  }
  const targetId = String(spec.targetId || spec.noteId || '').trim();
  const title = String(spec.title || '').replace(/[\r\n\x00]/g, '').trim() || (
    targetType === 'graph'
      ? '万象知识星图'
      : targetType === 'whiteboard'
        ? 'Excalidraw 手绘白板'
        : targetType === 'reader'
          ? 'PDF / EPUB 原件精读'
          : '独立笔记副窗口'
  );
  if (title.length > 200) {
    throw new Error('副窗口标题长度超出上限');
  }
  const relativePath = String(spec.relativePath || '').replaceAll('\\', '/').trim();
  if (relativePath) {
    if (relativePath.length > 2048 || /[:\x00-\x1f]/.test(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('副窗口目标路径包含非法相对路径段');
    }
  }
  const readerPage = spec.readerPage !== undefined && spec.readerPage !== null && spec.readerPage !== ''
    ? Math.max(1, Math.min(1000000, Math.round(Number(spec.readerPage) || 1)))
    : null;
  const readerCfi = typeof spec.readerCfi === 'string' && spec.readerCfi.trim()
    ? spec.readerCfi.trim().slice(0, 2048)
    : '';
  const windowId = String(spec.windowId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const crossLinkFollow = spec.crossLinkFollow !== false;

  return {
    windowId,
    isSecondary: true,
    targetType,
    targetId,
    title,
    relativePath,
    readerPage,
    readerCfi,
    crossLinkFollow,
    createdAt: spec.createdAt || new Date().toISOString(),
  };
}

export function buildSecondaryWindowUrl(baseUrl = 'https://inkloom.local/index.html', spec = {}) {
  const validated = validateSecondaryWindowSpec(spec);
  const url = new URL(baseUrl, 'https://inkloom.local');
  url.searchParams.set('window', validated.windowId);
  url.searchParams.set('secondary', '1');
  url.searchParams.set('targetType', validated.targetType);
  if (validated.targetId) url.searchParams.set('targetId', validated.targetId);
  if (validated.title) url.searchParams.set('title', validated.title);
  if (validated.relativePath) url.searchParams.set('relativePath', validated.relativePath);
  if (validated.readerPage) url.searchParams.set('page', String(validated.readerPage));
  if (validated.readerCfi) url.searchParams.set('cfi', validated.readerCfi);
  return url.toString();
}

export function parseSecondaryWindowUrl(urlInput = '') {
  if (!urlInput || typeof urlInput !== 'string') {
    return { isSecondary: false, windowId: '', targetType: 'note', targetId: '', title: '', relativePath: '', readerPage: null, readerCfi: '' };
  }
  try {
    const url = new URL(urlInput, 'https://inkloom.local');
    const isSecondary = url.searchParams.get('secondary') === '1';
    const windowId = url.searchParams.get('window') || '';
    if (!isSecondary) {
      return { isSecondary: false, windowId, targetType: 'note', targetId: '', title: '', relativePath: '', readerPage: null, readerCfi: '' };
    }
    const validated = validateSecondaryWindowSpec({
      windowId,
      targetType: url.searchParams.get('targetType') || 'note',
      targetId: url.searchParams.get('targetId') || '',
      title: url.searchParams.get('title') || '',
      relativePath: url.searchParams.get('relativePath') || '',
      readerPage: url.searchParams.get('page') || null,
      readerCfi: url.searchParams.get('cfi') || '',
    });
    return validated;
  } catch {
    return { isSecondary: false, windowId: '', targetType: 'note', targetId: '', title: '', relativePath: '', readerPage: null, readerCfi: '' };
  }
}

export function detectTabTearOffGesture(startPoint = {}, endPoint = {}, headerBounds = {}) {
  const sx = Number(startPoint.x ?? startPoint.clientX ?? 0);
  const sy = Number(startPoint.y ?? startPoint.clientY ?? 0);
  const ex = Number(endPoint.x ?? endPoint.clientX ?? 0);
  const ey = Number(endPoint.y ?? endPoint.clientY ?? 0);
  if (![sx, sy, ex, ey].every(Number.isFinite)) {
    return { tearOff: false, reason: 'invalid-coordinates', deltaX: 0, deltaY: 0 };
  }
  const deltaX = ex - sx;
  const deltaY = ey - sy;
  const headerBottom = Number.isFinite(Number(headerBounds.bottom)) ? Number(headerBounds.bottom) : sy + 18;
  const verticalTearDistance = ey - headerBottom;
  if (verticalTearDistance >= 36 || Math.abs(deltaY) >= 48) {
    return {
      tearOff: true,
      reason: 'vertical-tear-off',
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY),
    };
  }
  return {
    tearOff: false,
    reason: 'in-bar-reorder',
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY),
  };
}

export function createSyncEnvelope({ eventType, sourceWindowId, targetWindowId = '*', payload = {}, timestamp } = {}) {
  const allowedEvents = new Set(['note-saved', 'wikilink-navigate', 'reader-page-sync', 'window-opened', 'window-closed']);
  const cleanType = String(eventType || '').trim();
  if (!allowedEvents.has(cleanType)) {
    throw new Error(`未知的跨窗口同步事件类型：${cleanType}`);
  }
  const cleanSource = String(sourceWindowId || 'primary').trim();
  if (!cleanSource) throw new Error('缺少源窗口标识');
  return {
    eventId: `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    eventType: cleanType,
    sourceWindowId: cleanSource,
    targetWindowId: String(targetWindowId || '*').trim(),
    payload: payload && typeof payload === 'object' ? { ...payload } : {},
    timestamp: timestamp || new Date().toISOString(),
  };
}

export function reconcileCrossWindowNoteUpdate({
  localWindowId,
  activeNoteId,
  isLocalDirty = false,
  localSource = '',
  envelope,
} = {}) {
  if (!envelope || typeof envelope !== 'object' || envelope.eventType !== 'note-saved') {
    return { action: 'ignore', reason: 'not-note-saved' };
  }
  if (envelope.sourceWindowId && localWindowId && envelope.sourceWindowId === localWindowId) {
    return { action: 'ignore', reason: 'same-window' };
  }
  const { noteId, source, relativePath, hash } = envelope.payload || {};
  if (!noteId || typeof source !== 'string') {
    return { action: 'ignore', reason: 'missing-payload' };
  }
  if (activeNoteId && noteId === activeNoteId) {
    if (source === localSource) {
      return { action: 'noop', reason: 'identical-source', noteId };
    }
    if (isLocalDirty) {
      return {
        action: 'conflict-preserve-draft',
        reason: 'local-draft-dirty',
        noteId,
        relativePath: relativePath || '',
        incomingHash: hash || '',
      };
    }
    return {
      action: 'apply-live-update',
      reason: 'clean-active-note',
      noteId,
      nextSource: source,
      relativePath: relativePath || '',
      incomingHash: hash || '',
    };
  }
  return {
    action: 'update-background-index',
    reason: 'inactive-note',
    noteId,
    nextSource: source,
    relativePath: relativePath || '',
  };
}
