const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCore(fetchImplementation = fetch, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const listeners = {};
  const chrome = {
    runtime: {
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } },
      getURL: value => `chrome-extension://test/${value}`
    },
    action: { onClicked: { addListener: listener => { listeners.action = listener; } } },
    storage: { local: { get: async defaults => ({ ...defaults, ...options.settings }), set: async () => {} } }
  };
  const context = {
    chrome,
    console,
    crypto: webcrypto,
    AbortController,
    DOMException,
    fetch: fetchImplementation,
    URL,
    ...(options.LanguageModel ? { LanguageModel: options.LanguageModel } : {})
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__core = {
    normalizeEndpoint,
    parseEditingResponse,
    buildPrompts,
    buildTitleSuggestionPrompts,
    buildPostSummaryPrompts,
    buildCommentReactionSummaryPrompts,
    buildTermGlossaryPrompts,
    buildCommentGenerationPrompts,
    parseGeneratedComment,
    normalizeSuggestions,
    applySuggestions,
    parseTitleSuggestions,
    parsePostSummary,
    parseTermGlossary,
    splitTextAtNaturalBoundaries,
    isolateChunkWhitespace,
    processGeminiEditingRequest,
    callOpenAICompatible,
    listModels,
    processTextRequest,
    handleMessage
  };`, context);
  return context.__core;
}

const core = loadCore();

test('exposes the comment-generation feature flag to content scripts', async () => {
  const result = await core.handleMessage({ type: 'GET_SETTINGS' }, {});
  assert.equal(result.settings.features.commentGeneration, true);
});

test('aborts an active AI request when its request ID is cancelled', async () => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let aborted = false;
  const cancelCore = loadCore((url, options) => new Promise((resolve, reject) => {
    markStarted();
    options.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  }));
  const processing = cancelCore.processTextRequest({
    requestId: 'cancel-test-request',
    action: 'improve',
    text: '취소할 요청입니다.'
  });
  await started;
  await cancelCore.handleMessage({ type: 'CANCEL_REQUEST', requestId: 'cancel-test-request' }, {});
  await assert.rejects(processing, /요청을 취소했습니다/);
  assert.equal(aborted, true);
});

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
  assert.match(prompts.user, /글자, 순서, 개수를 바꾸지 말고/);
});

test('fully omits personalization from prompts when it is empty or whitespace-only', () => {
  for (const personalization of ['', '   \n  ']) {
    const editing = core.buildPrompts('improve', '본문', personalization);
    const titles = core.buildTitleSuggestionPrompts('본문', personalization);
    const comment = core.buildCommentGenerationPrompts('게시물 본문', 'positive', personalization);
    for (const prompts of [editing, titles, comment]) {
      assert.doesNotMatch(prompts.system, /개인화 지침/);
      assert.doesNotMatch(prompts.user, /개인화 지침/);
    }
  }
});

test('builds grounded comment-generation prompts with the selected tone and personalization', () => {
  const prompts = core.buildCommentGenerationPrompts(
    '# 게시물 제목\n\n본문의 핵심 내용',
    'negative',
    '짧고 정중하게'
  );
  assert.match(prompts.system, /개인화 지침:\n짧고 정중하게/);
  assert.match(prompts.user, /제목과 본문을 읽고/);
  assert.match(prompts.user, /부정적이거나 동의하지 않는 의견/);
  assert.match(prompts.user, /<post>\n# 게시물 제목\n\n본문의 핵심 내용\n<\/post>/);
  assert.match(prompts.user, /원문에 없는 사실을 만들거나/);
});

test('asks the model to choose the best positive, agreement, or support response for the post', () => {
  const prompts = core.buildCommentGenerationPrompts('게시물 본문', 'positive', '');
  assert.match(prompts.user, /내용과 작성자의 상황을 먼저 분석/);
  assert.match(prompts.user, /긍정, 동의, 응원 중 가장 자연스럽고 적절한 반응 하나를 골라/);
  assert.match(prompts.user, /세 반응을 억지로 모두 섞지 마세요/);
});

test('parses JSON and plain-text generated comments', () => {
  assert.equal(core.parseGeneratedComment('{"comment":"본문 취지에 공감합니다."}'), '본문 취지에 공감합니다.');
  assert.equal(core.parseGeneratedComment('댓글: 좋은 글 감사합니다.'), '좋은 글 감사합니다.');
});

test('generates a comment from the post body using saved personalization', async () => {
  let requestBody;
  const generationCore = loadCore(async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"comment":"저도 이 부분에 동의합니다."}' } }] })
    };
  }, {
    settings: { personalization: '차분하고 짧게 답합니다.' }
  });
  const result = await generationCore.handleMessage({
    type: 'GENERATE_COMMENT',
    requestId: 'comment-generation-test',
    tone: 'positive',
    postText: '# 제목\n\n본문 내용입니다.'
  }, { url: 'https://damoang.net/free/1' });

  assert.equal(result.comment, '저도 이 부분에 동의합니다.');
  assert.match(requestBody.messages[0].content, /개인화 지침:\n차분하고 짧게 답합니다/);
  assert.match(requestBody.messages[1].content, /<post>\n# 제목\n\n본문 내용입니다\.\n<\/post>/);
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
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문"}' } }] })
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
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문"}' } }] })
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
      json: async () => ({ choices: [{ message: { content: '{"corrected_text":"본문"}' } }] })
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
  assert.match(prompts.user, /5개를 추천/);
  assert.doesNotMatch(prompts.user, /AIANG_MEDIA/);
  assert.match(prompts.user, /본문 앞[\s\S]*본문 뒤/);
});

test('smartly trims long post content for title suggestions to save input tokens', () => {
  const longHead = '머리말 '.repeat(400);
  const longTail = '꼬리말 '.repeat(300);
  const fullText = `${longHead}\n\n중간본문\n\n${longTail}`;
  assert.ok(fullText.length > 2500);
  const prompts = core.buildTitleSuggestionPrompts(fullText);
  assert.match(prompts.user, /\[\.\.\.본문 일부 생략\.\.\.\]/);
  assert.match(prompts.user, /머리말/);
  assert.match(prompts.user, /꼬리말/);
  assert.ok(prompts.user.length < fullText.length);
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

test('builds a detailed Markdown post summary prompt from structured content', () => {
  const prompts = core.buildPostSummaryPrompts('첫 문단  \n\n\n둘째 문단');
  assert.equal(
    prompts.system,
    '당신은 웹 기사 및 커뮤니티 게시물 요약 전문가입니다.'
  );
  assert.match(prompts.user, /<content>\n첫 문단\n\n둘째 문단\n<\/content>/);
  assert.match(prompts.user, /Markdown 문단과 목록/);
  assert.match(prompts.user, /지나치게 짧거나 추상적인 요약은 피하고/);
  assert.match(prompts.user, /요약문만 반환하세요/);
});

test('accepts plain text and JSON post summaries', () => {
  assert.equal(core.parsePostSummary('핵심 요약입니다.'), '핵심 요약입니다.');
  assert.equal(core.parsePostSummary('{"summary":"JSON 요약입니다."}'), 'JSON 요약입니다.');
  assert.throws(() => core.parsePostSummary(''), /빈 요약/);
});

test('builds a grounded Markdown comment reaction prompt', () => {
  const prompts = core.buildCommentReactionSummaryPrompts(
    '# 게시물\n본문 내용',
    '[댓글 1]\n동의합니다.\n\n[댓글 4]\n다른 의견입니다.',
    4,
    2
  );
  assert.match(prompts.system, /댓글 반응을 분석하는 전문가/);
  assert.match(prompts.user, /전체 댓글 4개.*2개를 분석/);
  assert.match(prompts.user, /소수 의견을 전체 반응으로 왜곡하지 마세요/);
  assert.match(prompts.user, /<post>\n# 게시물\n본문 내용\n<\/post>/);
  assert.match(prompts.user, /<comments total="4" sampled="2">/);
  assert.match(prompts.user, /Markdown 문단과 목록/);
});

test('builds a grounded dictionary-style glossary prompt from post content', () => {
  const prompts = core.buildTermGlossaryPrompts('# AI 가속기\nLLM은 GPU에서 실행됩니다.');
  assert.equal(prompts.system, '당신은 웹 기사 및 게시물 용어 정리 전문가입니다.');
  assert.match(prompts.user, /\[게시물\]\n# AI 가속기\nLLM은 GPU에서 실행됩니다\./);
  assert.match(prompts.user, /\[질문\]\n게시물을 이해하는 데 도움이 되는 전문용어/);
  assert.match(prompts.user, /용어를 굵게 표시한 읽기 쉬운 Markdown(?: 형식의)? 사전 목록/);
});

test('accepts Markdown and JSON glossary responses', () => {
  assert.equal(core.parseTermGlossary('- **LLM** — 대규모 언어 모델'), '- **LLM** — 대규모 언어 모델');
  assert.equal(core.parseTermGlossary('{"glossary":"- **GPU** — 그래픽 처리 장치"}'), '- **GPU** — 그래픽 처리 장치');
  assert.throws(() => core.parseTermGlossary(''), /빈 용어 사전/);
});

test('splits editing text at natural boundaries without splitting protected media tokens', () => {
  const token = '[[AIANG_MEDIA_test_1]]';
  const text = `첫 번째 문단입니다.\n\n${'긴문장 '.repeat(90)}${token}\n\n마지막 문단입니다.`;
  const chunks = core.splitTextAtNaturalBoundaries(text, 400);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map(chunk => chunk.text).join(''), text);
  assert.equal(chunks.filter(chunk => chunk.text.includes(token)).length, 1);
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.start, index ? chunks[index - 1].end : 0);
  });
});

test('preserves outer chunk whitespace separately from editable content', () => {
  const parts = core.isolateChunkWhitespace('\n\n  교정할 문장입니다.  \n');
  assert.equal(parts.leading, '\n\n  ');
  assert.equal(parts.content, '교정할 문장입니다.');
  assert.equal(parts.trailing, '  \n');
});

test('chunks Gemini Nano editing, reports progress, and rebases spelling offsets', async () => {
  const sessions = [];
  const promptedContentLengths = [];
  const promptOptionsSeen = [];
  const LanguageModel = {
    availability: async () => 'available',
    create: async () => {
      const session = {
        contextWindow: 5200,
        contextUsage: 100,
        measureContextUsage: async prompt => prompt.length,
        prompt: async (prompt, options) => {
          promptOptionsSeen.push(options);
          const content = prompt.match(/<content>\n([\s\S]*?)\n<\/content>/)?.[1] || '';
          promptedContentLengths.push(content.length);
          const start = content.indexOf('기슬');
          return JSON.stringify({
            suggestions: start >= 0 ? [{
              original: '기슬',
              replacement: '기술',
              start,
              end: start + 2,
              reason: '맞춤법'
            }] : []
          });
        },
        destroy() {}
      };
      sessions.push(session);
      return session;
    }
  };
  const geminiCore = loadCore(fetch, { LanguageModel });
  const paragraphs = Array.from({ length: 35 }, (_, index) => (
    `${index + 1}번째 문단은 청크 경계를 검증하기 위한 충분히 긴 문장입니다. ${index === 15 ? '기슬을 확인합니다.' : '문맥을 유지합니다.'}`
  ));
  const text = paragraphs.join('\n\n');
  const progress = [];
  const result = await geminiCore.processGeminiEditingRequest(
    'spellcheck',
    text,
    '',
    new AbortController().signal,
    event => progress.push({ ...event })
  );

  assert.ok(progress.length > 1);
  assert.ok(progress.every(event => event.total > 1));
  assert.equal(result.correctedText, text.replace('기슬', '기술'));
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].start, text.indexOf('기슬'));
  assert.ok(Math.max(...promptedContentLengths) <= 900);
  assert.ok(promptOptionsSeen.every(options => options.responseConstraint?.required.includes('suggestions')));
  assert.ok(promptOptionsSeen.every(options => options.omitResponseConstraintInput === true));
  assert.ok(sessions.length > progress.length);
});
