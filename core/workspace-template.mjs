import { workspaceLayout } from './workspace-model.mjs';

const validWidgetIds = new Set(['capture', 'tasks', 'memos', 'calendar', 'projects', 'starred']);
const validTemplates = new Set(['balanced', 'focus', 'writing']);
const validTaskModes = new Set(['list', 'board']);
const validViewModes = new Set(['table', 'board']);
const validPageSizes = new Set([10, 25, 50, 100]);
const propertyKeyPattern = /^(?:(?:formula|rollup):[a-z_]{1,32}|[A-Za-z0-9_\u4e00-\u9fa5-]{1,48})$/;

export function validateWorkspaceTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工作台模板格式无效');
  if (JSON.stringify(input).length > 256 * 1024) throw new Error('工作台模板超过 256 KiB 上限');
  if (input.format !== 'inkloom.workspace-template' || input.version !== 1) throw new Error('不支持的工作台模板版本');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || /[\r\n\0]/.test(name)) throw new Error('工作台模板名称无效');
  const template = validTemplates.has(input.template) ? input.template : null;
  if (!template) throw new Error('工作台基底模板无效');
  if (!Array.isArray(input.layout) || !input.layout.length || input.layout.length > validWidgetIds.size) throw new Error('工作台模块布局无效');
  const seen = new Set();
  const layout = [];
  for (const item of input.layout) {
    if (!item || typeof item !== 'object' || !validWidgetIds.has(item.id) || seen.has(item.id)) throw new Error('工作台模块标识重复或无效');
    const x = item.x ?? 0; const y = item.y ?? 0; const w = item.w; const h = item.h;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || x > 11 || y < 0 || y > 100 || w < 3 || x + w > 12 || h < 3 || h > 16) throw new Error('工作台模块尺寸或坐标超出范围');
    seen.add(item.id);
    layout.push({ id: item.id, x, y, w, h });
  }
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i]; const b = layout[j];
      if (!(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)) throw new Error('工作台模板模块存在重叠：' + a.id + ' 与 ' + b.id);
    }
  }
  const taskMode = validTaskModes.has(input.taskMode) ? input.taskMode : 'list';
  if (input.taskMode !== undefined && !validTaskModes.has(input.taskMode)) throw new Error('工作台任务视图模式无效');
  const rawDb = input.databaseView ?? {};
  if (typeof rawDb !== 'object' || Array.isArray(rawDb)) throw new Error('多维视图配置无效');
  const viewMode = rawDb.viewMode === undefined ? 'table' : rawDb.viewMode;
  if (!validViewModes.has(viewMode)) throw new Error('多维视图模式无效');
  const compactMode = Boolean(rawDb.compactMode);
  const pageSize = rawDb.pageSize === undefined ? 50 : Number(rawDb.pageSize);
  if (!validPageSizes.has(pageSize)) throw new Error('多维视图分页大小无效');
  const groupBy = rawDb.groupBy === undefined ? '' : String(rawDb.groupBy);
  if (groupBy && !['status', 'folder', 'category', 'project'].includes(groupBy) && !propertyKeyPattern.test(groupBy)) throw new Error('多维视图分组字段无效');
  const propertyKey = rawDb.propertyKey === undefined ? '' : String(rawDb.propertyKey);
  if (propertyKey && !propertyKeyPattern.test(propertyKey)) throw new Error('多维视图属性列名称无效');
  return {
    format: 'inkloom.workspace-template',
    version: 1,
    name,
    template,
    layout: workspaceLayout(layout, template),
    taskMode,
    databaseView: { viewMode, compactMode, pageSize, groupBy, propertyKey },
  };
}

export function createWorkspaceTemplate({ name = '自定义工作台', template = 'balanced', layout, taskMode = 'list', databaseView = {} } = {}) {
  const normalizedLayout = Array.isArray(layout) && layout.length ? layout : workspaceLayout(null, validTemplates.has(template) ? template : 'balanced');
  return validateWorkspaceTemplate({
    format: 'inkloom.workspace-template',
    version: 1,
    name,
    template: validTemplates.has(template) ? template : 'balanced',
    layout: normalizedLayout,
    taskMode,
    databaseView,
  });
}
