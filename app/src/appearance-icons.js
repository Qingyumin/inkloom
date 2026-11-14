import DOMPurify from 'dompurify';
import { createElement, FileText, File, BookOpen, Notebook, NotebookPen, Folder, FolderOpen, FolderTree, Library, Hash, Tag, Tags, Star, Heart, Bookmark, Calendar, CalendarDays, Sunrise, Network, Waypoints, Orbit, Table2, LayoutGrid, Columns3, Search, ScanSearch, Leaf, Flower2, Sparkles, Briefcase, Code2, Coffee, Flag, Check, Circle, CircleDot, Gem, Compass, Lightbulb, PenTool, Palette, Music, Camera, Globe, Rocket, Archive, ListTodo, GraduationCap, ScrollText } from 'lucide';

export const appearanceIconCatalog = {
  'file-text': [FileText, '笔记 文档'], file: [File, '文件'], 'book-open': [BookOpen, '书 阅读'], notebook: [Notebook, '本子'], 'notebook-pen': [NotebookPen, '手记'],
  folder: [Folder, '目录'], 'folder-open': [FolderOpen, '打开目录'], 'folder-tree': [FolderTree, '目录树'], library: [Library, '资料库'],
  hash: [Hash, '标签'], tag: [Tag, '标签'], tags: [Tags, '多标签'], star: [Star, '星标'], heart: [Heart, '喜爱'], bookmark: [Bookmark, '书签'],
  calendar: [Calendar, '日历'], 'calendar-days': [CalendarDays, '日程'], sunrise: [Sunrise, '日记'], network: [Network, '图谱'], waypoints: [Waypoints, '路径'], orbit: [Orbit, '轨道'],
  'table-2': [Table2, '表格'], 'layout-grid': [LayoutGrid, '网格'], 'columns-3': [Columns3, '看板'], search: [Search, '搜索'], 'scan-search': [ScanSearch, '查找'],
  leaf: [Leaf, '叶片'], 'flower-2': [Flower2, '花'], sparkles: [Sparkles, '灵感'], briefcase: [Briefcase, '项目 工作'], 'code-2': [Code2, '代码'], coffee: [Coffee, '咖啡'],
  flag: [Flag, '目标'], check: [Check, '完成'], circle: [Circle, '圆'], 'circle-dot': [CircleDot, '节点'], gem: [Gem, '收藏'], compass: [Compass, '方向'], lightbulb: [Lightbulb, '想法'],
  'pen-tool': [PenTool, '创作'], palette: [Palette, '设计'], music: [Music, '音乐'], camera: [Camera, '摄影'], globe: [Globe, '世界'], rocket: [Rocket, '启动'], archive: [Archive, '归档'], 'list-todo': [ListTodo, '待办'], 'graduation-cap': [GraduationCap, '学习'], 'scroll-text': [ScrollText, '长文'],
};

export function sanitizeIconSvg(source, colorMode = 'inherit') {
  if (typeof source !== 'string' || source.length > 24000 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG内容或大小无效');
  const clean = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'],
    ALLOWED_ATTR: ['xmlns', 'viewBox', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'transform'],
    ALLOW_DATA_ATTR: false, KEEP_CONTENT: false,
  });
  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml'); const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror') || !svg.querySelector('path,circle,ellipse,rect,line,polyline,polygon')) throw new Error('SVG缺少有效绘图内容');
  const box = (svg.getAttribute('viewBox') || '0 0 24 24').trim().split(/[ ,]+/).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value) || Math.abs(value) > 4096) || box[2] <= 0 || box[3] <= 0) throw new Error('SVG视口无效');
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (['fill', 'stroke'].includes(attribute.name)) {
        if (!/^(none|currentColor|#[a-f0-9]{3,8})$/i.test(attribute.value)) node.setAttribute(attribute.name, 'currentColor');
        else if (colorMode === 'inherit' && attribute.value !== 'none') node.setAttribute(attribute.name, 'currentColor');
      }
    }
  }
  svg.setAttribute('viewBox', box.join(' ')); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  if (colorMode === 'inherit' && !svg.hasAttribute('fill')) svg.setAttribute('fill', 'currentColor');
  svg.removeAttribute('x'); svg.removeAttribute('y'); return new XMLSerializer().serializeToString(svg);
}

export function makeAppearanceIcon(name, pack, fallback = 'file-text') {
  if (name?.startsWith('custom:') && pack?.assets?.[name.slice(7)]) {
    const template = document.createElement('template'); template.innerHTML = sanitizeIconSvg(pack.assets[name.slice(7)], pack.colorMode); return template.content.firstElementChild;
  }
  const definition = appearanceIconCatalog[name]?.[0] || appearanceIconCatalog[fallback]?.[0] || FileText;
  return createElement(definition, { width: 16, height: 16, 'stroke-width': 1.65, 'aria-hidden': 'true' });
}