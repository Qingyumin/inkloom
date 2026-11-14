import { createElement, Volume2, Play, Pause, SkipBack, SkipForward, Square, Settings2, X } from 'lucide';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseDocument } from '../../vendor/inklet/app/src/markdown.js';
import { SpeechController, assertSpeechAllowed, extractSpeechSegments, renderSpeechVoiceOptions, speechPitches, speechStopModes, normalizeSpeechVoice, normalizeSpeechPitch, normalizeSpeechRate } from './speech-reader.js';

const defaults = { provider: 'system', voice: 'zh-CN-YunxiNeural', rate: 1, pitch: '+0Hz', stopMode: 'continuous', skipCode: true, endpoint: '', model: 'tts-1', customVoice: 'alloy' };

export function mountSpeechReader(api) {
  const find = selector => document.querySelector(selector);
  const config = () => ({ ...defaults, ...api.getConfig() });
  const button = (glyph, label, id, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'icon-button'; node.id = id;
    node.title = label; node.setAttribute('aria-label', label); node.append(createElement(glyph, { width: 14, height: 14, 'aria-hidden': 'true' }));
    node.onclick = action; return node;
  };
  let highlighted = null;
  let intent = 0;
  let approved = '';
  let activeDocument = null;
  let busySettings = false;
  const fingerprint = () => { const current = api.getDocument(); const options = config(); return JSON.stringify([current.id, current.revision, options.provider, options.endpoint]); };
  const highlightPlugin = new Plugin({ key: new PluginKey('inkloom-speech'), props: { decorations(state) {
    if (highlighted === null || highlighted >= state.doc.content.size) return DecorationSet.empty;
    const node = state.doc.nodeAt(highlighted);
    return node ? DecorationSet.create(state.doc, [Decoration.node(highlighted, highlighted + node.nodeSize, { class: 'speech-speaking-block' })]) : DecorationSet.empty;
  } } });
  api.editor.plugins.push(highlightPlugin);
  api.editor.view.updateState(api.editor.view.state.reconfigure({ plugins: api.editor.plugins }));

  const panel = document.createElement('section'); panel.id = 'speech-panel'; panel.className = 'speech-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '书籍朗读');
  panel.innerHTML = '<div class="speech-status-group"><span id="speech-status" role="status">未开始</span><span id="speech-preview"></span></div><div class="speech-controls"></div>';
  find('#editor-stage').before(panel);
  const status = panel.querySelector('#speech-status');
  const preview = panel.querySelector('#speech-preview');
  const controls = panel.querySelector('.speech-controls');
  const previous = button(SkipBack, '上一段', 'speech-prev', () => controller.step(-1));
  const toggle = button(Play, '开始朗读', 'speech-toggle', () => controller.active ? controller.toggle() : void start('document'));
  const next = button(SkipForward, '下一段', 'speech-next', () => controller.step(1));
  const stopButton = button(Square, '停止朗读', 'speech-stop', () => stop());
  const menu = document.createElement('details'); menu.id = 'speech-options-menu'; menu.className = 'ux-popover-menu';
  menu.innerHTML = '<summary class="icon-button" aria-label="朗读选项" title="朗读选项"></summary><div class="ux-popover-panel"><button type="button" class="ux-popover-item" id="speech-from-start">从头朗读</button><button type="button" class="ux-popover-item" id="speech-from-cursor">从光标所在段朗读</button><button type="button" class="ux-popover-item" id="speech-open-settings">音色与朗读设置</button></div>';
  menu.querySelector('summary').append(createElement(Settings2, { width: 14, height: 14, 'aria-hidden': 'true' }));
  controls.append(previous, toggle, next, stopButton, menu);

  const preferences = document.createElement('details'); preferences.id = 'speech-preferences'; preferences.className = 'speech-preferences';
  preferences.innerHTML = `<summary>书籍朗读</summary><div class="speech-preferences-body">
    <label class="select-setting" for="speech-provider">语音来源<select id="speech-provider" data-speech-setting="provider"><option value="system">本机系统语音（离线）</option><option value="edge">在线自然音色（Edge）</option><option value="openai">外接语音服务（OpenAI 兼容）</option></select></label>
    <label class="select-setting" for="speech-voice-input" id="speech-voice-field">自然音色<select id="speech-voice-input" data-speech-setting="voice">${renderSpeechVoiceOptions()}</select></label>
    <label class="select-setting" for="speech-pitch-input" id="speech-pitch-field">语调<select id="speech-pitch-input" data-speech-setting="pitch">${speechPitches.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
    <label class="range-setting" for="speech-rate-input">语速 <output id="speech-rate-output">1.00 倍</output><input id="speech-rate-input" type="range" min="0.75" max="2" step="0.05" data-speech-setting="rate"></label>
    <label class="select-setting" for="speech-stop-mode-input">停止方式<select id="speech-stop-mode-input" data-speech-setting="stopMode">${speechStopModes.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
    <label class="checkbox-setting"><input id="speech-skip-code-input" type="checkbox" data-speech-setting="skipCode">略过行内代码与字段名</label>
    <div id="speech-custom-fields" class="speech-custom-fields" hidden>
      <label for="speech-endpoint">接口地址<input id="speech-endpoint" type="url" placeholder="http://127.0.0.1:8000/v1/audio/speech" data-speech-setting="endpoint"></label>
      <label for="speech-model">模型<input id="speech-model" type="text" data-speech-setting="model" maxlength="160"></label>
      <label for="speech-custom-voice">音色 ID<input id="speech-custom-voice" type="text" data-speech-setting="customVoice" maxlength="160"></label>
      <label for="speech-key">API 密钥<input id="speech-key" type="password" autocomplete="off" maxlength="4096"></label>
      <div class="speech-key-actions"><button type="button" class="small-command" id="speech-key-save">保存密钥</button><button type="button" class="small-command" id="speech-key-clear">清除密钥</button><span id="speech-key-status" role="status">未查询凭据</span></div>
    </div>
    <div class="speech-preference-actions"><button type="button" class="small-command" id="speech-preview-voice">试听</button><button type="button" class="small-command" id="speech-settings-stop">停止</button></div>
    <p id="speech-settings-status" class="speech-settings-status" role="status"></p>
  </div>`;
  find('[data-settings-group="reading"] .settings-group-content').append(preferences);
  const settingsStatus = preferences.querySelector('#speech-settings-status');
  const consent = document.createElement('dialog'); consent.id = 'speech-consent-dialog'; consent.className = 'speech-consent-dialog'; consent.setAttribute('aria-labelledby', 'speech-consent-title');
  consent.innerHTML = '<form method="dialog"><div class="dialog-heading"><h2 id="speech-consent-title">允许本次在线朗读？</h2></div><div class="speech-consent-body"><p>本次朗读文本将发送至下列语音服务。笔记不会被修改；内控或机密笔记不会外发。</p><p id="speech-destination"></p></div><div class="dialog-footer"><button class="small-command" value="cancel" id="speech-consent-cancel">取消</button><button class="primary-command" value="allow" id="speech-consent-allow">允许本次朗读</button></div></form>';
  find('#app').append(consent);

  function showPreferences() {
    menu.open = false;
    const dialog = find('#settings-dialog');
    if (!dialog.open) dialog.showModal();
    find('[data-settings-group="reading"]').open = true;
    preferences.open = true; syncPreferences();
    preferences.querySelector('#speech-provider').focus();
  }
  function syncPreferences() {
    const options = config();
    for (const field of preferences.querySelectorAll('[data-speech-setting]')) {
      const value = options[field.dataset.speechSetting];
      if (field.type === 'checkbox') field.checked = value !== false;
      else field.value = value;
    }
    preferences.querySelector('#speech-rate-output').textContent = normalizeSpeechRate(options.rate).toFixed(2) + ' 倍';
    preferences.querySelector('#speech-voice-field').hidden = options.provider !== 'edge';
    preferences.querySelector('#speech-pitch-field').hidden = options.provider !== 'edge';
    preferences.querySelector('#speech-custom-fields').hidden = options.provider !== 'openai';
    for (const option of preferences.querySelectorAll('#speech-provider option')) option.disabled = !api.desktop && option.value !== 'system';
  }
  function renderState(state) {
    panel.hidden = !state.active && !state.error;
    panel.dataset.state = state.error ? 'error' : state.loading ? 'loading' : state.paused ? 'paused' : state.playing ? 'playing' : 'idle';
    status.textContent = state.error || (!state.active ? '已停止' : `${state.loading ? '正在合成' : state.paused ? '已暂停' : state.provider === 'system' ? '系统朗读' : '书籍朗读'} ${state.index + 1} / ${state.total}`);
    preview.textContent = state.segment?.preview || '';
    const label = state.playing ? '暂停朗读' : state.paused ? '继续朗读' : '开始朗读';
    toggle.title = label; toggle.setAttribute('aria-label', label);
    toggle.replaceChildren(createElement(state.playing ? Pause : Play, { width: 14, height: 14, 'aria-hidden': 'true' }));
    previous.disabled = !state.active || state.index <= 0;
    next.disabled = !state.active || state.index >= state.total - 1;
    find('#note-read-aloud-button')?.setAttribute('aria-pressed', String(state.active));
  }
  const controller = new SpeechController({
    getProvider: () => config().provider,
    getVoice: () => normalizeSpeechVoice(config().voice), getRate: () => normalizeSpeechRate(config().rate), getPitch: () => normalizeSpeechPitch(config().pitch),
    getStopMode: () => config().stopMode, getSkipCode: () => config().skipCode,
    getCustomConfig: () => ({ endpoint: config().endpoint, model: config().model, customVoice: config().customVoice }),
    canSynthesize: () => api.desktop,
    synthesize: async (params, signal) => {
      const current = api.getDocument();
      if (!activeDocument || activeDocument.id !== current.id || activeDocument.source !== current.source) throw new Error('笔记已变化，请重新开始朗读。');
      assertSpeechAllowed(current.source, params.provider, approved === fingerprint());
      const requestId = crypto.randomUUID();
      const cancel = () => { void api.call('cancelSpeech', { requestId }).catch(() => {}); };
      signal.throwIfAborted(); signal.addEventListener('abort', cancel, { once: true });
      try { return await api.call('synthesizeSpeech', { ...params, requestId, documentId: current.id, source: current.source, consent: approved === fingerprint() }); }
      finally { signal.removeEventListener('abort', cancel); }
    },
    highlightBlock: position => {
      highlighted = position;
      api.editor.view.dispatch(api.editor.view.state.tr.setMeta('inkloom-speech', position));
      const node = position === null ? null : api.editor.view.nodeDOM(position);
      if (node instanceof HTMLElement && api.editor.container.offsetWidth) {
        const bounds = node.getBoundingClientRect(); const pane = api.editor.container.getBoundingClientRect();
        if (bounds.top < pane.top || bounds.bottom > pane.bottom) api.editor.container.scrollTop += bounds.top - pane.top - pane.height * 0.25;
      }
    },
    onEmpty: () => api.toast('当前内容没有可朗读的正文。'),
    onError: error => { settingsStatus.textContent = error.message; },
    onChapterStop: () => api.toast('本章已朗读完毕'), onTimerStop: minutes => api.toast(`已达到 ${minutes} 分钟，朗读已停止`),
    onState: renderState,
  });

  async function start(mode = 'document') {
    const request = ++intent;
    controller.stop(); menu.open = false;
    api.editor.flush();
    const current = api.getDocument(); const options = config(); const selection = api.getSelection();
    try {
      assertSpeechAllowed(current.source, options.provider, true);
      if (options.provider !== 'system') {
        if (!api.desktop) throw new Error('在线语音需要 Windows 桌面版。');
        if (options.provider === 'openai') {
          const endpoint = new URL(options.endpoint);
          if (endpoint.username || endpoint.password || !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('语音接口须为 HTTPS 或本机 HTTP 地址。');
        }
        consent.querySelector('#speech-destination').textContent = options.provider === 'edge' ? 'Microsoft Edge 在线语音 · speech.platform.bing.com' : options.endpoint;
        consent.returnValue = 'cancel'; consent.showModal();
        const allowed = await new Promise(resolve => consent.addEventListener('close', () => resolve(consent.returnValue === 'allow'), { once: true }));
        if (!allowed || request !== intent) return;
        if (api.getDocument().id !== current.id || api.getDocument().source !== current.source) throw new Error('笔记已变化，请重新开始朗读。');
        approved = fingerprint();
      }
      if (request !== intent) return;
      activeDocument = current;
      settingsStatus.textContent = '';
      if (mode === 'preview') controller.speakSelection('一念落笔，万象成图。这是一段用于试听音色和语速的文字。');
      else if (mode === 'selection') {
        if (selection.to <= selection.from) throw new Error('请先选中要朗读的文字。');
        const fragment = parseDocument(current.source.slice(selection.from, selection.to));
        const range = api.editor.parsed.ranges.find(item => selection.from >= item.from && selection.from < item.to);
        const segments = extractSpeechSegments(fragment, { maxChars: 420, skipCode: options.skipCode }).map(segment => ({ ...segment, blockPosition: range?.position ?? null }));
        controller.startSegments(segments);
      } else controller.start(api.editor.parsed, mode === 'cursor' ? selection.from : 0);
    } catch (error) { controller.fail(error); }
  }
  function stop() {
    intent++; approved = ''; activeDocument = null;
    if (consent.open) consent.close('cancel');
    controller.error = ''; controller.stop(); panel.hidden = true;
  }
  preferences.addEventListener('change', async event => {
    const field = event.target; const key = field.dataset.speechSetting;
    if (!key || busySettings) return;
    const value = field.type === 'checkbox' ? field.checked : key === 'rate' ? normalizeSpeechRate(field.value) : field.value.trim();
    const nextOptions = { ...config(), [key]: value };
    busySettings = true;
    for (const input of preferences.querySelectorAll('[data-speech-setting]')) input.disabled = true;
    try {
      await api.saveConfig(nextOptions);
      if (['provider', 'endpoint', 'model', 'customVoice', 'skipCode'].includes(key)) stop();
      else if (key === 'stopMode') { if (controller.active) controller.configureStopTimer(); }
      else controller.updateVoiceOrRate();
      settingsStatus.textContent = '朗读偏好已保存';
    } catch (error) { settingsStatus.textContent = error.message; }
    finally { busySettings = false; for (const input of preferences.querySelectorAll('[data-speech-setting]')) input.disabled = false; syncPreferences(); }
  });
  preferences.querySelector('#speech-rate-input').addEventListener('input', event => { preferences.querySelector('#speech-rate-output').textContent = normalizeSpeechRate(event.target.value).toFixed(2) + ' 倍'; });
  preferences.querySelector('#speech-preview-voice').onclick = () => void start('preview');
  preferences.querySelector('#speech-settings-stop').onclick = stop;
  preferences.querySelector('#speech-key-save').onclick = async () => {
    const input = preferences.querySelector('#speech-key');
    try {
      if (!api.desktop) throw new Error('凭据只能保存在 Windows 桌面版。');
      await api.call('saveSpeechSecret', { endpoint: config().endpoint, key: input.value }); input.value = '';
      preferences.querySelector('#speech-key-status').textContent = '已加密保存';
    } catch (error) { settingsStatus.textContent = error.message; }
  };
  preferences.querySelector('#speech-key-clear').onclick = async () => {
    try { await api.call('clearSpeechSecret'); preferences.querySelector('#speech-key').value = ''; preferences.querySelector('#speech-key-status').textContent = '已清除'; }
    catch (error) { settingsStatus.textContent = error.message; }
  };
  preferences.addEventListener('toggle', () => {
    if (preferences.open && api.desktop) void api.call('speechSecretStatus', { endpoint: config().endpoint }).then(result => { preferences.querySelector('#speech-key-status').textContent = result.configured ? '已保存加密凭据' : '未保存凭据'; }).catch(error => { settingsStatus.textContent = error.message; });
  });
  menu.querySelector('#speech-from-start').onclick = () => void start('document');
  menu.querySelector('#speech-from-cursor').onclick = () => void start('cursor');
  menu.querySelector('#speech-open-settings').onclick = showPreferences;
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); } });
  syncPreferences();
  return { start, stop, showPreferences, dispose: () => { stop(); controller.dispose(); } };
}