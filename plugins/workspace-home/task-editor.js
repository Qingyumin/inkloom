import { createElement, X, Save, ArrowUpRight } from 'lucide';
import { nextTaskDue } from '../../core/task-planning.mjs';

export const repeatLabels = { '': '不重复', daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月', yearly: '每年' };
export const stateLabels = { todo: '未开始', doing: '进行中', done: '已完成' };
function element(tag, text) { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; }
function iconButton(icon, name) { const button = element('button'); button.type = 'button'; button.className = 'icon-button'; button.title = name; button.setAttribute('aria-label', name); button.append(createElement(icon, { width: 16, height: 16 })); return button; }
export function recurrenceInputs(prefix, onChange) {
  const root = element('div'); root.className = 'task-repeat-fields'; const repeat = element('select'); repeat.id = prefix + '-repeat'; repeat.setAttribute('aria-label', '重复规则'); repeat.append(...Object.entries(repeatLabels).map(([value, label]) => new Option(label, value)));
  const details = element('div'); details.className = 'task-repeat-details'; const everyLabel = element('label', '间隔'); const every = element('input'); every.type = 'number'; every.min = '1'; every.max = '365'; every.step = '1'; every.value = '1'; every.id = prefix + '-every'; every.setAttribute('aria-label', '重复间隔'); everyLabel.append(every);
  const untilLabel = element('label', '截止'); const until = element('input'); until.type = 'date'; until.id = prefix + '-until'; until.setAttribute('aria-label', '重复截止日'); untilLabel.append(until);
  const weekdays = element('div'); weekdays.className = 'task-repeat-days'; const inputs = [];
  for (const [day, name] of [['MO', '一'], ['TU', '二'], ['WE', '三'], ['TH', '四'], ['FR', '五'], ['SA', '六'], ['SU', '日']]) { const label = element('label', name); const input = element('input'); input.type = 'checkbox'; input.value = day; input.setAttribute('aria-label', '星期' + name); label.prepend(input); weekdays.append(label); inputs.push(input); }
  details.append(everyLabel, untilLabel, weekdays); root.append(repeat, details);
  const read = () => ({ repeat: repeat.value, every: Number(every.value), until: repeat.value ? until.value : '', days: repeat.value === 'weekly' ? inputs.filter(input => input.checked).map(input => input.value).join(',') : '' });
  let enabled = true;
  function visibility() { details.hidden = !repeat.value; weekdays.hidden = repeat.value !== 'weekly'; repeat.disabled = !enabled; every.disabled = !enabled || !repeat.value; until.disabled = !enabled || !repeat.value; for (const input of inputs) input.disabled = !enabled || repeat.value !== 'weekly'; }
  root.addEventListener('input', () => { visibility(); onChange?.(read()); }); visibility();
  return { root, read, enable(value) { enabled = value; visibility(); }, fill(value) { repeat.value = value.repeat || ''; every.value = String(value.every || 1); until.value = value.until || ''; for (const input of inputs) input.checked = (value.days || '').split(',').includes(input.value); visibility(); } };
}

export function mountTaskEditor(container, { save, open, closed }, scope) {
  let task; let busy = false; let blocked = false; const dialog = element('dialog'); dialog.id = 'task-edit-dialog'; dialog.className = 'task-edit-dialog';
  const form = element('form'); const header = element('header'); const heading = element('h2', '编辑任务'); heading.id = 'task-edit-heading'; dialog.setAttribute('aria-labelledby', heading.id); const close = iconButton(X, '关闭任务编辑'); close.onclick = () => { if (!busy) dialog.close(); }; header.append(heading, close);
  const fields = element('div'); fields.className = 'task-edit-fields'; const controls = {};
  for (const [key, label, type] of [['title', '任务标题', 'text'], ['state', '状态', 'select'], ['due', '日期', 'date'], ['time', '提醒时间', 'time'], ['priority', '优先级', 'select']]) {
    const row = element('label', label); const input = element(type === 'select' ? 'select' : 'input'); input.id = 'task-edit-' + key; input.setAttribute('aria-label', label); if (type !== 'select') input.type = type;
    if (key === 'state') input.append(...Object.entries(stateLabels).map(([value, text]) => new Option(text, value)));
    if (key === 'priority') input.append(new Option('普通', 'normal'), new Option('重要', 'high'), new Option('低优先级', 'low'));
    if (key === 'title') { input.required = true; input.maxLength = 400; row.className = 'task-edit-title'; }
    row.append(input); fields.append(row); controls[key] = input;
  }
  const repeat = recurrenceInputs('task-edit', preview); const next = element('p'); next.className = 'task-next-date'; next.id = 'task-edit-next'; const error = element('p'); error.className = 'database-error'; error.id = 'task-edit-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const footer = element('footer'); const source = iconButton(ArrowUpRight, '打开任务原文'); source.onclick = () => { if (!busy) { dialog.close(); open(task.noteId); } }; const submit = iconButton(Save, '保存任务'); submit.type = 'submit'; submit.id = 'task-edit-save'; submit.append(element('span', '保存')); footer.append(source, submit); form.append(header, fields, repeat.root, next, error, footer); dialog.append(form); container.append(dialog);
  const value = () => ({ ...Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value])), ...repeat.read() });
  function updateSubmit() { submit.disabled = busy || blocked; submit.setAttribute('aria-busy', String(busy || blocked)); }
  function preview() { if (!task) return; try { const plan = value(); const result = nextTaskDue({ ...plan, start: plan.due !== task.due || plan.repeat !== task.repeat ? plan.due : task.start || plan.due }); next.textContent = plan.repeat ? result ? '下一次：' + result : '已到重复截止日' : ''; } catch (reason) { next.textContent = reason.message; } }
  form.addEventListener('input', preview); dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!scope.signal.aborted) closed?.(); });
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || blocked) return; busy = true; error.hidden = true; const patch = value(); updateSubmit();
    for (const input of form.querySelectorAll('input, select, button')) input.disabled = true;
    try { await save(task, patch); if (!scope.signal.aborted) dialog.close(); }
    catch (reason) { if (!scope.signal.aborted) { error.textContent = reason.message; error.hidden = false; } }
    finally { busy = false; for (const input of form.querySelectorAll('input, select, button')) input.disabled = false; repeat.enable(true); updateSubmit(); }
  };
  scope.own(() => { if (dialog.open) dialog.close(); dialog.remove(); });
  return { get isOpen() { return dialog.open; }, setBlocked(value) { blocked = value; updateSubmit(); }, open(nextTask) { task = nextTask; for (const [key, input] of Object.entries(controls)) input.value = task[key] ?? (key === 'state' ? task.done ? 'done' : 'todo' : ''); repeat.fill(task); error.hidden = true; preview(); updateSubmit(); dialog.showModal(); controls.title.focus(); } };
}