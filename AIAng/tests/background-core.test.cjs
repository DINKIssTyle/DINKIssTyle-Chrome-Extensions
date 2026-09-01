const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCore(fetchImplementation = fetch) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const listeners = {};
  const chrome = {
    runtime: {
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } },
      getURL: value => `chrome-extension://test/${value}`
    },
    action: { onClicked: { addListener: listener => { listeners.action = listener; } } },
    storage: { local: { get: async defaults => defaults, set: async () => {} } }
  };
  const context = {
    chrome,
    console,
    crypto: webcrypto,
    DOMException,
    fetch: fetchImplementation,
    URL
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__core = {
    normalizeEndpoint,
    parseEditingResponse,
    buildPrompts,
    buildTitleSuggestionPrompts,
    normalizeSuggestions,
    applySuggestions,
    parseTitleSuggestions,
    callOpenAICompatible,
    listModels
  };`, context);
  return context.__core;
}

const core = loadCore();

test('normalizes LM Studio and explicit chat completion endpoints', () => {
  assert.equal(core.normalizeEndpoint('localhost:1234'), 'http://localhost:1234/v1');
  assert.equal(
    core.normalizeEndpoint('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1'
  );
});

test('constructs corrected spelling text from validated UTF-16 suggestions', () => {
  const original = '안녕하세요 처음뵙겠습니다.';
  const start = original.indexOf('처음뵙겠습니다');
  const raw = JSON.stringify({
    corrected_text: '이 값은 suggestions가 있으면 사용하지 않습니다.',
    suggestions: [{
      original: '처음뵙겠습니다',
      replacement: '처음 뵙겠습니다',
      start,
      end: start + '처음뵙겠습니다'.length,
      reason: '띄어쓰기'
    }]
  });
  const result = core.parseEditingResponse(raw, original, 'spellcheck');
  assert.equal(result.correctedText, '안녕하세요 처음 뵙겠습니다.');
  assert.equal(result.suggestions.length, 1);
});

test('recovers an incorrect model offset when the original text is unique', () => {
  const original = '안녕하세요 처음뵙겠습니다.';
  const raw = JSON.stringify({
    suggestions: [{
      original: '안녕하세요',
      replacement: '안녕하십니까',
      start: 99,
      end: 100
    }]
  });
  assert.equal(
    core.parseEditingResponse(raw, original, 'spellcheck').correctedText,
    '안녕하십니까 처음뵙겠습니다.'
  );
});

test('adds personalization to the system prompt without changing the output contract', () => {
  const prompts = core.buildPrompts('improve', '본문', '다정하고 교양 있게');
  assert.match(prompts.system, /다정하고 교양 있게/);
  assert.match(prompts.user, /corrected_text/);
  assert.match(prompts.user, /<content>\n본문\n<\/content>/);
  assert.match(prompts.user, /각 토큰의 글자, 순서, 개수를 바꾸지 말고/);
});

test('keeps a protected media token while applying spelling suggestions', () => {
  const token = '[[AIANG_MEDIA_test_1]]';
  const original = `안녕하세요 처음뵙겠습니다.\n${token}\n반갑읍니다.`;
  const firstStart = original.indexOf('처음뵙겠습니다');
  const secondStart = original.indexOf('반갑읍니다');
  const raw = JSON.stringify({
    suggestions: [
      {
        original: '처음뵙겠습니다',
        replacement: '처음 뵙겠습니다',
        start: firstStart,
        end: firstStart + '처음뵙겠습니다'.length
      },
      {
        original: '반갑읍니다',
        replacement: '반갑습니다',
        start: secondStart,
        end: secondStart + '반갑읍니다'.length
      }
    ]
  });
  const result = core.parseEditingResponse(raw, original, 'spellcheck');
  assert.equal(result.correctedText, `안녕하세요 처음 뵙겠습니다.\n${token}\n반갑습니다.`);
  assert.equal(result.correctedText.match(/\[\[AIANG_MEDIA_test_1\]\]/g).length, 1);
});

test('does not send a maximum output token limit to the LLM server', async () => {
  let requestBody;
  const requestCore = loadCore(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문","suggestions":[]}' } }] })
    };
  });
  await requestCore.callOpenAICompatible({
    endpoint: 'http://localhost:1234/v1',
    model: 'test-model',
    temperature: 0.2,
    maxTokens: 128
  }, { system: 'system', user: '본문' });
  assert.equal(Object.hasOwn(requestBody, 'max_tokens'), false);
  assert.equal(Object.hasOwn(requestBody, 'max_completion_tokens'), false);
});

test('omits temperature from the request when automatic temperature is enabled', async () => {
  let requestBody;
  const requestCore = loadCore(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문","suggestions":[]}' } }] })
    };
  });
  await requestCore.callOpenAICompatible({
    endpoint: 'http://localhost:1234/v1',
    model: 'test-model',
    temperature: 0.2,
    temperatureAuto: true
  }, { system: 'system', user: '본문' });
  assert.equal(Object.hasOwn(requestBody, 'temperature'), false);
});

test('sends temperature when automatic temperature is disabled', async () => {
  let requestBody;
  const requestCore = loadCore(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문","suggestions":[]}' } }] })
    };
  });
  await requestCore.callOpenAICompatible({
    endpoint: 'http://localhost:1234/v1',
    model: 'test-model',
    temperature: 0.7,
    temperatureAuto: false
  }, { system: 'system', user: '본문' });
  assert.equal(requestBody.temperature, 0.7);
});

test('reads and deduplicates model names from compatible model-list responses', async () => {
  const requestCore = loadCore(async () => ({
    ok: true,
    json: async () => ({ models: [{ model: 'z-model' }, { id: 'a-model' }, 'a-model'] })
  }));
  const models = await requestCore.listModels({
    provider: 'openai',
    endpoint: 'http://localhost:1234/v1',
    apiKey: ''
  });
  assert.deepEqual(Array.from(models), ['a-model', 'z-model']);
});

test('builds title prompts from content without protected media tokens', () => {
  const prompts = core.buildTitleSuggestionPrompts(
    '본문 앞\n[[AIANG_MEDIA_test_1]]\n본문 뒤',
    '다정하고 교양 있게'
  );
  assert.match(prompts.system, /다정하고 교양 있게/);
  assert.match(prompts.user, /정확히 5개/);
  assert.doesNotMatch(prompts.user, /AIANG_MEDIA/);
  assert.match(prompts.user, /본문 앞[\s\S]*본문 뒤/);
});

test('parses exactly five unique title suggestions and limits each to 200 characters', () => {
  const longTitle = '가'.repeat(240);
  const titles = core.parseTitleSuggestions(JSON.stringify({
    titles: [longTitle, '두 번째 제목', '세 번째 제목', '네 번째 제목', '다섯 번째 제목', '여섯 번째 제목']
  }));
  assert.equal(titles.length, 5);
  assert.equal(titles[0].length, 200);
  assert.deepEqual(Array.from(titles.slice(1)), ['두 번째 제목', '세 번째 제목', '네 번째 제목', '다섯 번째 제목']);
});
