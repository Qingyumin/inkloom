import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../vendor/inklet/app/src/markdown.js';
import { SpeechController, assertSpeechAllowed, extractSpeechSegments, splitSpeechSentences, cleanSpeechText, speechVoices, normalizeSpeechVoice, normalizeSpeechRate, normalizeSpeechPitch } from '../app/src/speech-reader.js';

test('Inklet speech extraction works with the frozen Inkloom parser without changing source', () => {
  const paragraph = '\u8fd9\u662f\u4e00\u6bb5\u6d4b\u8bd5\u6b63\u6587\uff0c\u6309\u6807\u70b9\u81ea\u7136\u5206\u6bb5\u3002'.repeat(35);
  const source = '\uFEFF---\r\ntitle: Book\r\n---\r\n\r\n<!-- hidden -->\r\n# Chapter 1\r\n\r\n' + paragraph + '\r\n\r\n```mermaid\r\nflowchart LR\r\nA-->B\r\n```\r\n\r\n| Field | Meaning |\r\n| --- | --- |\r\n| WERKS | Plant |\r\n';
  const parsed = parseDocument(source);
  const before = parsed.doc.toJSON();
  const segments = extractSpeechSegments(parsed);
  assert.equal(segments[0].text, 'Chapter 1');
  assert.ok(segments.length > 4);
  assert.ok(segments.every(segment => segment.text.length <= 220 && !/hidden|flowchart|title:/.test(segment.text)));
  assert.ok(segments.some(segment => segment.text === 'WERKS\uff0cPlant'));
  assert.deepEqual(parsed.doc.toJSON(), before);
  assert.equal(speechVoices.length, 16);
  assert.equal(normalizeSpeechVoice('unknown'), 'zh-CN-YunxiNeural');
  assert.equal(normalizeSpeechVoice('en-US-AvaMultilingualNeural'), 'en-US-AvaMultilingualNeural');
  assert.equal(normalizeSpeechRate(9), 2);
  assert.equal(normalizeSpeechRate(0.1), 0.75);
  assert.equal(normalizeSpeechPitch('-6Hz'), '-6Hz');
  assert.equal(normalizeSpeechPitch('bad'), '+0Hz');
  assert.ok(splitSpeechSentences(paragraph, 120).every(chunk => chunk.length <= 120));
});

test('speech skips code-only content and preserves chapter numbers and decimal sections', () => {
  assert.deepEqual(extractSpeechSegments(parseDocument('```js\nprivate_key = 123\n```')), []);
  assert.deepEqual(extractSpeechSegments(parseDocument('`internal_field`'), { skipCode: true }), []);
  assert.equal(cleanSpeechText('\u7b2c01\u7ae0 \u5bfc\u8bfb'), '\u7b2c1\u7ae0 \u5bfc\u8bfb');
  assert.deepEqual(splitSpeechSentences('Section 3.1 contains 7.25 units.'), ['Section 3.1 contains 7.25 units.']);
});

test('speech privacy requires consent and denies online access to restricted or encrypted notes', () => {
  for (const privacy of ['local-only', 'internal', 'confidential', 'secret']) {
    const source = `---\nprivacy: ${privacy}\n---\nPrivate text`;
    assert.throws(() => assertSpeechAllowed(source, 'edge', true));
    assert.throws(() => assertSpeechAllowed(source, 'openai', true));
    assert.equal(assertSpeechAllowed(source, 'system'), true);
  }
  assert.throws(() => assertSpeechAllowed('---\nencrypted: true\n---\nciphertext', 'system'));
  assert.throws(() => assertSpeechAllowed('@privacy: locked\nsecret', 'system'));
  assert.throws(() => assertSpeechAllowed('# Public', 'edge'));
  assert.equal(assertSpeechAllowed('# Public', 'edge', true), true);
});

test('speech advances only on actual completion, pauses, stops at chapters and rejects unavailable voices', () => {
  const spoken = [];
  const errors = [];
  let chapterStops = 0;
  const environment = { speechSynthesis: {
    getVoices: () => [{ name: 'Local test voice', lang: 'zh-CN', localService: true }],
    speak: utterance => { spoken.push(utterance); utterance.onstart(); }, cancel() {},
  }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
  const controller = new SpeechController({ getStopMode: () => 'chapter', onChapterStop: () => chapterStops++, onError: error => errors.push(error.message) }, environment);
  controller.start(parseDocument('# Chapter 1\n\nFirst paragraph.\n\n# Chapter 2\n\nNext paragraph.'));
  assert.equal(controller.currentIndex, 0);
  spoken.at(-1).onend();
  assert.equal(controller.currentIndex, 1);
  controller.toggle();
  assert.equal(controller.paused, true);
  controller.toggle();
  assert.equal(controller.playing, true);
  spoken.at(-1).onend();
  assert.equal(controller.active, false);
  assert.equal(chapterStops, 1);
  environment.speechSynthesis.getVoices = () => [];
  controller.start(parseDocument('No local voice.'));
  assert.equal(controller.active, false);
  assert.equal(errors.length, 1);
  controller.dispose();
});

test('stopped speech ignores late synthesis and never starts audio', async () => {
  let resolveAudio;
  let contexts = 0;
  const controller = new SpeechController({ canSynthesize: () => true,
    synthesize: () => new Promise(resolve => { resolveAudio = resolve; }),
  }, { AudioContext: class { constructor() { contexts++; } } });
  controller.start(parseDocument('Pending synthesis.'));
  controller.stop();
  resolveAudio({ data: 'AA==' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts, 0);
  assert.equal(controller.active, false);
});