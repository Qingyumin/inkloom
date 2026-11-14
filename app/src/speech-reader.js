import { isMap, parseDocument as parseYamlDocument } from 'yaml';

export const speechVoiceGroups = [
  { label: '中文播讲', voices: [
    ['zh-CN-YunxiNeural', '云希 · 清朗男声'],
    ['zh-CN-YunyangNeural', '云扬 · 沉稳男声'],
    ['zh-CN-XiaoxiaoNeural', '晓晓 · 温润女声'],
    ['zh-CN-YunjianNeural', '云健 · 浑厚男声'],
    ['zh-CN-XiaoyiNeural', '晓伊 · 清脆女声'],
    ['zh-CN-YunxiaNeural', '云夏 · 少年清亮'],
  ] },
  { label: '中英混读', voices: [
    ['en-US-AvaMultilingualNeural', 'Ava · 柔美多语女声'],
    ['en-US-AndrewMultilingualNeural', 'Andrew · 磁性多语男声'],
    ['en-US-EmmaMultilingualNeural', 'Emma · 知性多语女声'],
    ['en-US-BrianMultilingualNeural', 'Brian · 沉稳多语男声'],
  ] },
  { label: '港台与方言', voices: [
    ['zh-TW-HsiaoChenNeural', '晓臻 · 台湾国语女声'],
    ['zh-TW-YunJheNeural', '云哲 · 台湾国语男声'],
    ['zh-TW-HsiaoYuNeural', '晓雨 · 台湾国语女声'],
    ['zh-CN-liaoning-XiaobeiNeural', '晓北 · 东北女声'],
    ['zh-CN-shaanxi-XiaoniNeural', '晓妮 · 陕西女声'],
    ['zh-HK-HiuMaanNeural', '晓曼 · 粤语女声'],
  ] },
];
export const speechVoices = speechVoiceGroups.flatMap(group => group.voices);
export const speechPitches = [['+0Hz', '标准原声'], ['-3Hz', '温和舒缓'], ['-6Hz', '沉稳低醇'], ['+4Hz', '清亮明快']];
export const speechStopModes = [['continuous', '全文连读'], ['chapter', '读完本章停'], ['15', '15 分钟后停'], ['30', '30 分钟后停'], ['60', '60 分钟后停']];
export const defaultSpeechVoice = 'zh-CN-YunxiNeural';
export const defaultSpeechRate = 1;
export const defaultSpeechPitch = '+0Hz';

export function renderSpeechVoiceOptions() {
  return speechVoiceGroups.map(group => `<optgroup label="${group.label}">${group.voices.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</optgroup>`).join('');
}
export function normalizeSpeechVoice(voice) {
  return speechVoices.some(([value]) => value === voice) ? voice : defaultSpeechVoice;
}
export function normalizeSpeechRate(rate) {
  const numeric = Number(rate);
  return Number.isFinite(numeric) ? Math.round(Math.max(0.75, Math.min(2, numeric)) * 20) / 20 : defaultSpeechRate;
}
export function normalizeSpeechPitch(pitch) {
  return speechPitches.some(([value]) => value === pitch) ? pitch : defaultSpeechPitch;
}

export function cleanSpeechText(raw, options = {}) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/https?:\/\/[^\s)]+/gi, ' ')
    .replace(/[（(]\s*[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s'-]+\s*[）)]/gu, '')
    .replace(/([（(])\s*[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s'-]+[，,、;；]\s*/gu, '$1')
    .replace(/[（(][^）)\n]{1,14}[）)](?=[”"』」]?[族氏字国军部河山原城殿器的])/gu, '')
    .replace(/(?<=[\p{Script=Han}\d])[（(]([^）)\n]{1,120})[）)]/gu, '，$1，')
    .replace(/[「」『』]/gu, '')
    .replace(/【([^】\n]{1,40})】/gu, '$1，')
    .replace(/(?<![：:])“([^”\n。！？；：]{1,18})”(?=[\p{Script=Han}])/gu, '$1')
    .replace(/(?<=[\p{Script=Han}])(?<![：:])“([^”\n。！？；：]{1,18})”/gu, '$1')
    .replace(/(?<![：:])‘([^’\n。！？；：]{1,18})’/gu, '$1')
    .replace(/第0+([1-9]\d*)\s*([卷编章节回篇部集季条项款代])/gu, '第$1$2')
    .replace(/(?<=[\p{Script=Han}\d])\s*·\s*(?=[\p{Script=Han}\d])/gu, '，')
    .replace(/§\s*(\d+(?:\.\d+)*)/gu, '第 $1 节')
    .replace(/——+|--+/gu, '，')
    .replace(/…+|\.{3,}/gu, '，')
    .replace(/([\p{Script=Han}])\s*\/\s*([\p{Script=Han}])/gu, '$1或$2')
    .replace(/([\p{Script=Han}])\s*\+\s*([\p{Script=Han}])/gu, '$1加$2')
    .replace(/->|-->|=>|==>|[→⇒⟶]/gu, '至')
    .replace(/(?<=\d),(?=\d{3}\b)/gu, '');
  if (options.skipCode) text = text.replace(/\b[a-zA-Z]+(?:_[a-zA-Z0-9]+)+\b/g, ' ');
  else text = text.replace(/\b([a-zA-Z0-9]+)_([tTvV])\b/g, '$1').replace(/(?<=[a-zA-Z0-9])_(?=[a-zA-Z0-9])/g, ' ');
  return text.replace(/[`*~]+/g, '').replace(/[#|>]+/g, ' ').replace(/[-=]{3,}/g, ' ').replace(/\s+/g, ' ')
    .replace(/\s*([，。！？；：、])\s*/gu, '$1')
    .replace(/([\p{Script=Han}]) +([\p{Script=Han}])/gu, (match, left, right, offset, full) => {
      const before = full.slice(Math.max(0, offset - 8), offset + 1);
      return /第[一二三四五六七八九十百千万零\d]+[卷编章节回篇部]$/u.test(before) ? `${left} ${right}` : `${left}${right}`;
    })
    .replace(/\s*，\s*([，。！？；：、])/gu, '$1').replace(/([：；。！？])\s*，\s*/gu, '$1')
    .replace(/，{2,}/gu, '，').replace(/^，+|，+$/gu, '').trim();
}

export function splitSpeechSentences(text, maxChars = 220, options = {}) {
  const cleaned = cleanSpeechText(text, options);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];
  const chunks = [];
  let current = '';
  const parts = cleaned.split(/(?<=[。！？；!?]|(?<!\d)\.(?!\d))\s*/u).filter(Boolean);
  for (const sentence of parts) {
    const clauses = sentence.length > maxChars ? sentence.split(/(?<=[，：,:、])\s*/u).filter(Boolean) : [sentence];
    for (const clause of clauses) {
      if (current && current.length + clause.length + 1 > maxChars) { chunks.push(current.trim()); current = ''; }
      if (clause.length > maxChars) {
        const words = clause.match(/\S+\s*/gu) || [];
        for (const word of words) {
          if (current && current.length + word.length > maxChars) { chunks.push(current.trim()); current = ''; }
          let rest = word;
          while (rest.length > maxChars) {
            let boundary = maxChars;
            if (/[\uD800-\uDBFF]/.test(rest[boundary - 1])) boundary--;
            chunks.push(rest.slice(0, boundary).trim()); rest = rest.slice(boundary);
          }
          current += rest;
        }
      } else current += (current && !/[。！？；，：、]$/.test(current) ? ' ' : '') + clause;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function extractTextblockSpeech(node, options) {
  let raw = '';
  node.descendants(child => {
    if (child.type.name === 'hard_break') {
      if (raw && !/[，。！？；：、\s]$/.test(raw)) raw += '，';
      return false;
    }
    if (child.isText) {
      if (options.skipCode && child.marks?.some(mark => mark.type.name === 'code') && /^[a-zA-Z_][a-zA-Z0-9_./:\\-]*$/.test(child.text.trim())) return false;
      raw += child.text;
    }
    return true;
  });
  return cleanSpeechText(raw, options);
}

export function extractSpeechSegments(parsed, options = {}) {
  if (!parsed?.doc || !Array.isArray(parsed.ranges)) return [];
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 40 ? options.maxChars : 220;
  const skipTypes = new Set(['front_matter', 'html_comment', 'html_anchor', 'toc', 'page_break', 'mermaid', 'code_block', 'horizontal_rule']);
  const segments = [];
  for (const range of parsed.ranges) {
    const node = range.node;
    if (!node || skipTypes.has(node.type.name)) continue;
    const blocks = [];
    if (node.type.name === 'table') {
      node.forEach(row => {
        const cells = [];
        row.forEach(cell => { const text = extractTextblockSpeech(cell, options); if (text) cells.push(text); });
        if (cells.length) blocks.push(cells.join('，'));
      });
    } else if (node.isTextblock) {
      const text = extractTextblockSpeech(node, options);
      if (text) blocks.push(text);
    } else {
      node.descendants(child => {
        if (skipTypes.has(child.type.name)) return false;
        if (child.isTextblock) { const text = extractTextblockSpeech(child, options); if (text) blocks.push(text); return false; }
        return true;
      });
    }
    for (const block of blocks) {
      for (const text of splitSpeechSentences(block, maxChars, options)) {
        segments.push({ index: segments.length, text, preview: text.length > 42 ? text.slice(0, 42) + '...' : text,
          blockPosition: range.position, sourceFrom: range.from, sourceTo: range.to,
          isHeading: node.type.name === 'heading', headingLevel: node.type.name === 'heading' ? node.attrs.level : null });
      }
    }
  }
  return segments;
}

export function assertSpeechAllowed(source, provider = 'system', consent = false) {
  const clean = String(source || '').replace(/^\uFEFF/, '');
  let properties = {};
  if (/^---\r?\n/.test(clean)) {
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(clean);
    if (!header) throw new Error('笔记属性未闭合，无法确认朗读隐私范围。');
    const parsed = parseYamlDocument(header[1], { prettyErrors: false, uniqueKeys: true });
    if (parsed.errors.length || (parsed.contents && !isMap(parsed.contents))) throw new Error('笔记属性无效，无法确认朗读隐私范围。');
    properties = parsed.toJS({ maxAliasCount: 20 }) || {};
  }
  const privacy = String(properties.privacy || 'public').trim().toLowerCase();
  const encrypted = properties.encrypted === true || properties.encrypted === 'true' || properties.cipher_alg || /```inkloom-aes256gcm\s*\r?\n/.test(clean);
  const legacyLocked = /(?:^|\n)\s*@privacy\s*:\s*locked\b/im.test(clean);
  if (encrypted || legacyLocked || privacy === 'locked') throw new Error('笔记已加密或锁定，请先解锁再朗读。');
  if (provider !== 'system' && privacy !== 'public') throw new Error('内控或机密笔记只能使用本机系统语音，未发送正文。');
  if (provider !== 'system' && !consent) throw new Error('尚未确认向语音服务发送本次朗读文本。');
  return true;
}

function trimAudioBufferSilence(context, buffer) {
  if (!buffer?.numberOfChannels || buffer.length < 2400) return buffer;
  const samples = buffer.getChannelData(0);
  let first = 0;
  let last = samples.length - 1;
  while (first < samples.length && Math.abs(samples[first]) < 0.0025) first++;
  if (first === samples.length) throw new Error('语音服务返回静音音频。');
  while (last > first && Math.abs(samples[last]) < 0.0025) last--;
  const start = Math.max(0, first - Math.round(buffer.sampleRate * 0.02));
  const end = Math.min(buffer.length, last + Math.round(buffer.sampleRate * 0.045) + 1);
  if (start <= 200 && end >= buffer.length - 200) return buffer;
  const trimmed = context.createBuffer(buffer.numberOfChannels, end - start, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
  return trimmed;
}

export class SpeechController {
  constructor(options, environment = globalThis) {
    this.options = options;
    this.environment = environment;
    this.segments = [];
    this.currentIndex = -1;
    this.startIndex = 0;
    this.playing = false;
    this.paused = false;
    this.loading = false;
    this.sessionToken = 0;
    this.audioContext = null;
    this.sourceNode = null;
    this.currentBuffer = null;
    this.offset = 0;
    this.startedAt = 0;
    this.sleepTimer = null;
    this.watchdog = null;
    this.utterance = null;
    this.cache = new Map();
    this.abortController = new AbortController();
    this.error = '';
  }

  get active() { return this.playing || this.paused || this.loading; }
  get provider() { return this.options.getProvider?.() || 'system'; }

  async ensureContext() {
    if (!this.audioContext) {
      const Constructor = this.environment.AudioContext || this.environment.webkitAudioContext;
      if (!Constructor) throw new Error('当前环境不支持音频播放。');
      this.audioContext = new Constructor();
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    return this.audioContext;
  }

  clearPlayback() {
    clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try { this.sourceNode.stop(); this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.environment.speechSynthesis?.cancel();
      this.utterance = null;
    }
  }

  configureStopTimer() {
    clearTimeout(this.sleepTimer);
    const minutes = Number(this.options.getStopMode?.());
    if (![15, 30, 60].includes(minutes)) return;
    this.sleepTimer = setTimeout(() => { this.stop(); this.options.onTimerStop?.(minutes); }, minutes * 60000);
  }

  start(parsed, sourceOffset = 0) {
    const segments = extractSpeechSegments(parsed, { maxChars: 420, skipCode: this.options.getSkipCode?.() !== false });
    let index = segments.findIndex(segment => segment.sourceTo > sourceOffset);
    if (index < 0) index = 0;
    return this.startSegments(segments, index);
  }

  startSegments(segments, index = 0) {
    this.stop(false);
    this.error = '';
    this.segments = segments;
    if (!segments.length) { this.notifyState(); this.options.onEmpty?.(); return false; }
    this.playing = true;
    this.startIndex = index;
    this.currentIndex = index;
    this.configureStopTimer();
    void this.playSegment(index, this.sessionToken);
    return true;
  }

  speakSelection(text, blockPosition = null) {
    return this.startSegments(splitSpeechSentences(text, 420, { skipCode: this.options.getSkipCode?.() !== false }).map((part, index) => ({
      index, text: part, preview: part.slice(0, 42), blockPosition, sourceFrom: 0, sourceTo: 0, isHeading: false,
    })));
  }

  stop(notify = true) {
    this.sessionToken++;
    this.abortController.abort();
    this.abortController = new AbortController();
    this.clearPlayback();
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.playing = this.paused = this.loading = false;
    this.currentIndex = -1;
    this.offset = 0;
    this.currentBuffer = null;
    this.cache.clear();
    this.options.highlightBlock?.(null);
    this.options.onStop?.();
    if (notify) this.notifyState();
  }

  fail(error) {
    this.error = error?.message || String(error);
    this.stop();
    this.options.onError?.(new Error(this.error));
  }

  toggle() {
    if (!this.active) return;
    if (this.paused) {
      this.paused = false;
      this.playing = true;
      if (this.currentBuffer) {
        void this.playBuffer(this.currentBuffer, this.offset, ++this.sessionToken).catch(error => this.fail(error));
      } else void this.playSegment(this.currentIndex, ++this.sessionToken);
    } else {
      if (this.sourceNode && this.audioContext) this.offset = Math.min(this.currentBuffer.duration, this.offset + this.audioContext.currentTime - this.startedAt);
      this.paused = true;
      this.playing = this.loading = false;
      this.sessionToken++;
      this.clearPlayback();
    }
    this.notifyState();
  }

  step(delta, manual = true) {
    if (!this.segments.length) return;
    const next = this.currentIndex + delta;
    if (next < 0) return;
    if (next >= this.segments.length) { this.stop(); return; }
    if (!manual && this.options.getStopMode?.() === 'chapter' && this.segments[next].isHeading) {
      let level = this.segments.slice(0, this.startIndex + 1).findLast(segment => segment.isHeading)?.headingLevel;
      if (!level || this.segments[next].headingLevel <= level) { this.stop(); this.options.onChapterStop?.(); return; }
    }
    this.clearPlayback();
    this.currentBuffer = null;
    this.offset = 0;
    this.currentIndex = next;
    this.playing = true;
    this.paused = false;
    void this.playSegment(next, ++this.sessionToken);
  }

  updateVoiceOrRate() {
    this.cache.clear();
    this.currentBuffer = null;
    this.offset = 0;
    this.clearPlayback();
    this.abortController.abort();
    this.abortController = new AbortController();
    const token = ++this.sessionToken;
    if (this.playing) void this.playSegment(this.currentIndex, token);
    else this.notifyState();
  }

  synthesisParams(segment) {
    return { ...this.options.getCustomConfig?.(), text: segment.text, provider: this.provider,
      voice: normalizeSpeechVoice(this.options.getVoice?.()), rate: String(normalizeSpeechRate(this.options.getRate?.())),
      pitch: normalizeSpeechPitch(this.options.getPitch?.()) };
  }

  async fetchBuffer(segment, signal) {
    const params = this.synthesisParams(segment);
    const key = JSON.stringify([params.provider, params.endpoint, params.model, params.customVoice, params.voice, params.rate, params.pitch, segment.text]);
    if (this.cache.has(key)) return this.cache.get(key);
    const pending = (async () => {
      const response = await this.options.synthesize(params, signal);
      signal.throwIfAborted();
      if (!response?.data) throw new Error('语音服务没有返回音频。');
      const binary = atob(response.data);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const context = await this.ensureContext();
      const buffer = trimAudioBufferSilence(context, await context.decodeAudioData(bytes.buffer));
      signal.throwIfAborted();
      if (!(buffer.duration > 0)) throw new Error('语音音频长度无效。');
      return buffer;
    })();
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, pending);
    try { return await pending; }
    catch (error) { if (this.cache.get(key) === pending) this.cache.delete(key); throw error; }
  }

  async playBuffer(buffer, offset, token) {
    const context = await this.ensureContext();
    if (token !== this.sessionToken || !this.playing) return;
    this.clearPlayback();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => { if (token === this.sessionToken && this.playing) this.step(1, false); };
    const safeOffset = Math.min(Math.max(0, offset), Math.max(0, buffer.duration - 0.01));
    this.currentBuffer = buffer;
    this.offset = safeOffset;
    this.startedAt = context.currentTime;
    this.sourceNode = source;
    source.start(0, safeOffset);
    this.loading = false;
    this.watchdog = setTimeout(() => { if (token === this.sessionToken) this.fail(new Error('音频播放超时，已停止。')); }, (buffer.duration - safeOffset) * 1000 + 10000);
    this.notifyState();
  }

  async playSegment(index, token) {
    const segment = this.segments[index];
    if (!segment || token !== this.sessionToken) return;
    this.loading = true;
    this.options.highlightBlock?.(segment.blockPosition);
    this.notifyState();
    try {
      if (this.options.canSynthesize?.()) {
        const signal = this.abortController.signal;
        const buffer = await this.fetchBuffer(segment, signal);
        if (token !== this.sessionToken || !this.playing) return;
        await this.playBuffer(buffer, 0, token);
        if (this.segments[index + 1] && token === this.sessionToken && this.options.getStopMode?.() !== 'chapter') void this.fetchBuffer(this.segments[index + 1], signal).catch(() => {});
      } else {
        if (this.provider !== 'system') throw new Error('在线自然音色需要 Windows 桌面版。');
        this.playSystemVoice(segment, token);
      }
    } catch (error) { if (token === this.sessionToken && error.name !== 'AbortError') this.fail(error); }
  }

  playSystemVoice(segment, token) {
    const synth = this.environment.speechSynthesis;
    const Constructor = this.environment.SpeechSynthesisUtterance;
    if (!synth || !Constructor) throw new Error('当前环境没有可用的系统语音。');
    const voices = (synth.getVoices?.() || []).filter(voice => voice.localService);
    const voice = voices.find(item => /zh[-_]/i.test(item.lang)) || voices[0];
    if (!voice) throw new Error('未找到本机离线音色，请安装系统语音或使用 Windows 桌面版。');
    const utterance = new Constructor(segment.text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = normalizeSpeechRate(this.options.getRate?.());
    utterance.pitch = { '+0Hz': 1, '-3Hz': 0.9, '-6Hz': 0.8, '+4Hz': 1.1 }[normalizeSpeechPitch(this.options.getPitch?.())];
    utterance.onstart = () => { if (token === this.sessionToken) { this.loading = false; this.notifyState(); } };
    utterance.onend = () => { if (token === this.sessionToken && this.playing) this.step(1, false); };
    utterance.onerror = event => { if (token === this.sessionToken) this.fail(new Error('系统朗读失败：' + event.error)); };
    this.utterance = utterance;
    synth.speak(utterance);
    this.watchdog = setTimeout(() => { if (token === this.sessionToken) this.fail(new Error('系统语音没有完成播放，已停止。')); }, 180000);
  }

  notifyState() {
    this.options.onState?.({ active: this.active, playing: this.playing, paused: this.paused, loading: this.loading,
      provider: this.provider, index: this.currentIndex, total: this.segments.length, error: this.error, segment: this.segments[this.currentIndex] || null });
  }

  dispose() {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
  }
}