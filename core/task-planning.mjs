import recurrence from '../app/node_modules/rrule/dist/es5/rrule.js';

const { RRule } = recurrence;
const rules = { daily: RRule.DAILY, weekdays: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY, yearly: RRule.YEARLY };
const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const taskStates = { todo: ' ', doing: '/', done: 'x' };
export const repeatKinds = ['', ...Object.keys(rules)];
const date = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式应为 YYYY-MM-DD');
  const result = new Date(value + 'T00:00:00Z'); if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error('日期无效'); return result;
};
function maskedCode(raw) {
  const runs = [...raw.matchAll(/`+/g)]; const characters = raw.split('');
  for (let index = 0; index < runs.length; index++) {
    const opening = runs[index]; const prefix = raw.slice(0, opening.index).match(/\\+$/)?.[0].length || 0; if (prefix % 2) continue;
    const closing = runs.findIndex((run, position) => position > index && run[0].length === opening[0].length); if (closing < 0) continue;
    for (let offset = opening.index; offset < runs[closing].index + runs[closing][0].length; offset++) characters[offset] = ' ';
    index = closing;
  }
  return characters.join('');
}
export function taskFields(raw) {
  const values = {}; const positions = {};
  for (const match of maskedCode(raw).matchAll(/(?:^|\s)@(due|time|priority|repeat|every|days|start|until|task|next|after)\(([^)\r\n]*)\)/g)) {
    const from = match.index + (match[0].startsWith('@') ? 0 : 1); const end = match.index + match[0].length;
    if (positions[match[1]]) throw new Error('任务字段重复：' + match[1]); values[match[1]] = match[2]; positions[match[1]] = { from, end };
  }
  return { values, positions };
}
export function setTaskField(raw, key, value) {
  const { positions } = taskFields(raw); const position = positions[key]; const marker = value === '' || value == null ? '' : '@' + key + '(' + value + ')';
  if (position) return raw.slice(0, position.from) + marker + raw.slice(position.end);
  return marker ? raw.replace(/\s+$/, '') + ' ' + marker : raw;
}
export function validateTaskPlan(plan) {
  if (!Object.hasOwn(taskStates, plan.state) || !['high', 'normal', 'low'].includes(plan.priority)) throw new Error('任务状态或优先级无效');
  if (plan.due) date(plan.due);
  if (plan.time && (!plan.due || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time))) throw new Error('提醒时间需要有效日期与 HH:mm');
  if (!repeatKinds.includes(plan.repeat)) throw new Error('重复规则不受支持');
  if (plan.repeat) {
    if (!plan.due) throw new Error('重复任务需要日期');
    if (!Number.isInteger(plan.every) || plan.every < 1 || plan.every > 365) throw new Error('重复间隔应为 1 至 365');
    if (plan.days && plan.days.split(',').some(value => !days.includes(value))) throw new Error('重复星期无效');
    if (plan.until && date(plan.until) < date(plan.due)) throw new Error('重复截止日不能早于任务日期');
  }
}
export function nextTaskDue(task) {
  const plan = { state: task.state || 'todo', priority: task.priority || 'normal', every: 1, ...task }; validateTaskPlan(plan); if (!plan.repeat) return '';
  const start = date(plan.start || plan.due); const after = date(plan.due);
  if (after < start || after.getTime() - start.getTime() > 36600 * 86400000) throw new Error('重复起点与当前日期超出支持范围');
  const options = { freq: rules[plan.repeat], dtstart: start, interval: plan.every };
  if (plan.repeat === 'weekdays') options.byweekday = days.slice(0, 5).map(day => RRule[day]);
  if (plan.repeat === 'weekly' && plan.days) options.byweekday = plan.days.split(',').map(day => RRule[day]);
  if (plan.until) options.until = date(plan.until);
  const next = new RRule(options).after(after, false); return next ? next.toISOString().slice(0, 10) : '';
}
export function readTaskPlan(raw, marker) {
  try {
    const { values } = taskFields(raw);
    return { state: marker === '/' ? 'doing' : /[xX]/.test(marker) ? 'done' : 'todo', repeat: values.repeat || '', every: values.every ? Number(values.every) : 1, days: values.days || '', start: values.start || '', until: values.until || '', taskId: values.task || '', nextId: values.next || '', afterId: values.after || '', planningError: '' };
  } catch (error) { return { state: marker === '/' ? 'doing' : /[xX]/.test(marker) ? 'done' : 'todo', repeat: '', every: 1, days: '', start: '', until: '', taskId: '', nextId: '', afterId: '', planningError: error.message }; }
}
function stateLine(raw, state) { return raw.replace(/^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)[ xX/](\])/, (_, before, after) => before + taskStates[state] + after); }
function nextLine(completed, task, nextId, due) {
  let line = stateLine(completed, 'todo');
  for (const [key, value] of Object.entries({ task: nextId, next: '', after: task.taskId, due })) line = setTaskField(line, key, value);
  return line.trimEnd();
}
export function planTaskChange(source, current, tasks, patch, newId = () => crypto.randomUUID()) {
  if (!current || current.planningError || source.slice(current.from, current.from + current.raw.length) !== current.raw) throw new Error(current?.planningError || '任务已变化，请刷新后重试');
  if (!patch || Object.keys(patch).some(key => !['state', 'title', 'due', 'time', 'priority', 'repeat', 'every', 'days', 'until'].includes(key))) throw new Error('任务修改字段无效');
  const plan = { state: current.done ? 'done' : 'todo', repeat: '', every: 1, days: '', until: '', ...current, ...patch }; validateTaskPlan(plan);
  if (!current.repeat && !current.nextId && Object.keys(patch).every(key => key === 'state')) return source.slice(0, current.from) + stateLine(current.raw, plan.state) + source.slice(current.from + current.raw.length);
  if (current.nextId && Object.keys(patch).some(key => key !== 'state' && patch[key] !== current[key])) throw new Error('请先撤销重复任务的完成，再编辑原任务');
  let line = current.raw; const edits = [];
  if (patch.title !== undefined && patch.title !== current.title) {
    if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 400 || /[\r\n]/.test(patch.title)) throw new Error('任务标题无效');
    const { positions } = taskFields(line); const metadata = Object.values(positions).sort((first, second) => first.from - second.from).map(position => line.slice(position.from, position.end)).join(' ');
    const prefix = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[[ xX/]\]\s+)/.exec(line)[1];
    line = prefix + patch.title.trim().replace(/([\\`*_\[\]<>])/g, '\\$1') + (metadata ? ' ' + metadata : '');
  }
  for (const key of ['due', 'time', 'priority', 'repeat', 'every', 'days', 'until']) if (Object.hasOwn(patch, key)) line = setTaskField(line, key, key === 'every' && plan.every === 1 ? '' : patch[key]);
  if (patch.repeat === '') for (const key of ['every', 'days', 'start', 'until']) line = setTaskField(line, key, '');
  if (plan.repeat && ((patch.due && patch.due !== current.due) || (patch.repeat && patch.repeat !== current.repeat))) { plan.start = plan.due; line = setTaskField(line, 'start', plan.start); }
  if (plan.repeat && !plan.start) { plan.start = plan.due; line = setTaskField(line, 'start', plan.start); }
  if (!current.done && plan.state === 'done' && plan.repeat) {
    const due = nextTaskDue(plan);
    if (due) {
      plan.taskId ||= newId(); const nextId = newId();
      if (tasks.some(task => task.taskId === nextId || (task.from !== current.from && task.taskId === plan.taskId))) throw new Error('任务身份重复');
      line = setTaskField(setTaskField(line, 'task', plan.taskId), 'next', nextId);
      const newline = source.includes('\r\n') ? '\r\n' : '\n'; const generated = nextLine(line, plan, nextId, due);
      const position = current.blockTo ?? current.from + current.raw.length;
      edits.push({ from: position, to: position, value: (position > 0 && source[position - 1] !== '\n' ? newline : '') + generated + newline });
    }
  } else if (current.done && plan.state !== 'done' && current.nextId) {
    const descendants = tasks.filter(task => task.taskId === current.nextId); const child = descendants[0];
    const expected = nextLine(current.raw, current, current.nextId, nextTaskDue(current));
    if (descendants.length !== 1 || child.done || child.raw.trimEnd() !== expected || source.slice(child.from + child.raw.length, child.blockTo).trim()) throw new Error('下一次任务已修改、完成或缺失，未撤销；请先处理后续任务');
    let end = child.from + child.raw.length; if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end++;
    edits.push({ from: child.from, to: end, value: '' }); line = setTaskField(line, 'next', '');
  }
  line = stateLine(line, plan.state); edits.push({ from: current.from, to: current.from + current.raw.length, value: line.trimEnd() });
  let result = source; for (const edit of edits.sort((first, second) => second.from - first.from)) result = result.slice(0, edit.from) + edit.value + result.slice(edit.to);
  return result;
}