const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const promptCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'shared', 'prompts.json'), 'utf8')
);
const featureCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'shared', 'features.json'), 'utf8')
);

function loadCore(fetchImplementation = fetch, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const configuredFeatures = {
    ...featureCatalog,
    ...(typeof options.commentGenerationEnabled === 'boolean'
      ? { commentGeneration: options.commentGenerationEnabled }
      : {})
  };
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
    TextDecoder,
    TextEncoder,
    ReadableStream,
    Uint8Array,
    Blob,
    setTimeout,
    clearTimeout,
    ...(options.chromeOverrides ? { chrome: { ...chrome, ...options.chromeOverrides } } : {}),
    ...(options.navigator ? { navigator: options.navigator } : {}),
    ...(options.recognizeCapturedImages ? { recognizeCapturedImages: options.recognizeCapturedImages } : {}),
    fetch: (url, fetchOptions) => {
      if (url === 'chrome-extension://test/shared/prompts.json') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => promptCatalog
        });
      }
      if (url === 'chrome-extension://test/shared/features.json') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => configuredFeatures
        });
      }
      return fetchImplementation(url, fetchOptions);
    },
    URL,
    ...(options.injectPromptCatalog === false ? {} : { __AIANG_PROMPT_CATALOG__: promptCatalog }),
    ...(options.injectFeatureCatalog === false ? {} : { __AIANG_FEATURE_FLAGS__: configuredFeatures }),
    ...(options.LanguageModel ? { LanguageModel: options.LanguageModel } : {})
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__core = {
    normalizeEndpoint,
    parseEditingResponse,
    sanitizeEditingText,
    buildPrompts,
    buildTitleSuggestionPrompts,
    buildPostSummaryPrompts,
    buildCommentReactionSummaryPrompts,
    buildTermGlossaryPrompts,
    buildCommentGenerationPrompts,
    buildChatSystemPrompt,
    normalizeChatMessages,
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
    callOpenAICompatibleMessagesStreaming,
    listModels,
    processTextRequest,
    processChatRequest,
    handleMessage,
    ensurePromptCatalog,
    ensureFeatureFlags,
    getSettings,
    sanitizeSettings,
    attachImagesToMessages,
    sanitizeImageUrls,
    callGeminiNano,
    captureSenderTab
  };`, context);
  return context.__core;
}

const core = loadCore();

test('loads the shared prompt catalog from the packaged JSON file', async () => {
  const unloadedCore = loadCore(fetch, { injectPromptCatalog: false });
  await unloadedCore.ensurePromptCatalog();
  assert.match(unloadedCore.buildPostSummaryPrompts('본문').system, /게시물 요약 전문가/);
});

test('provides board list chat prompt configuration in the shared prompt catalog', () => {
  const readBoard = promptCatalog?.chat?.readBoard;
  assert.ok(readBoard, 'chat.readBoard should exist in prompts.json');
  assert.equal(readBoard.buttonLabel, '이 게시판 목록을 읽으세요');
  assert.equal(readBoard.buttonReading, '게시판 목록을 읽는 중');
  assert.equal(readBoard.buttonCompleted, '이 게시판 목록을 읽었어요');
  assert.match(readBoard.promptTemplate, /\{\{boardContent\}\}/);
  assert.match(readBoard.historyUserMessage, /\{\{boardContent\}\}/);
  assert.equal(readBoard.historyDisplayText, '이 게시판 목록을 읽으세요');
  assert.match(readBoard.fallbackTemplate, /\{\{topic\}\}/);
  assert.match(readBoard.fallbackTopicTemplate, /\{\{boardName\}\}/);

  const formatFallbackTopic = (boardName) => {
    return (readBoard.fallbackTopicTemplate || "'{{boardName}}' 게시판의 최신 글 목록이네요.")
      .replace('{{boardName}}', boardName)
      .replace(/(['"])(.+?)게시판\1\s*게시판/g, '$1$2게시판$1');
  };
  assert.equal(formatFallbackTopic('자유게시판'), "'자유게시판'의 최신 글 목록이네요.");
  assert.equal(formatFallbackTopic('알뜰구매'), "'알뜰구매' 게시판의 최신 글 목록이네요.");
});

test('provides chat followup action prompts for posts and boards', () => {
  const followup = promptCatalog?.chat?.followup;
  assert.ok(followup, 'chat.followup should exist in prompts.json');
  assert.equal(followup.postSummary?.label, '게시물 요약');
  assert.equal(followup.commentSummary?.label, '댓글 요약');
  assert.equal(followup.glossary?.label, '용어 사전');
  assert.equal(followup.boardIssues?.label, '주요 이슈');
  assert.equal(followup.boardViews?.label, '조횟수가 높은 글');
  assert.equal(followup.boardLikes?.label, '추천수가 높은 글');
  assert.match(followup.commentSummary?.promptWithComments, /\{\{commentsContent\}\}/);
});

test('loads feature flags from the packaged shared JSON file', async () => {
  const unloadedCore = loadCore(fetch, { injectFeatureCatalog: false });
  const features = await unloadedCore.ensureFeatureFlags();
  assert.equal(typeof features.commentGeneration, 'boolean');
});

test('exposes the comment-generation feature flag to content scripts', async () => {
  const result = await core.handleMessage({ type: 'GET_SETTINGS' }, {});
  assert.equal(result.settings.features.commentGeneration, featureCatalog.commentGeneration);
});

test('blocks comment generation when the shared feature flag is disabled', async () => {
  const disabledCore = loadCore(fetch, { commentGenerationEnabled: false });
  const result = await disabledCore.handleMessage({ type: 'GET_SETTINGS' }, {});
  assert.equal(result.settings.features.commentGeneration, false);
  await assert.rejects(
    disabledCore.handleMessage({
      type: 'GENERATE_COMMENT',
      tone: 'positive',
      postText: '게시물 본문'
    }, { url: 'https://damoang.net/free/1' }),
    /댓글 생성 기능이 비활성화/
  );
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
  }), { settings: { provider: 'openai' } });
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

test('removes leaked editing delimiters and hallucinated media tokens from model output', () => {
  const raw = [
    '아쉽지만 어쩔 수 없이 다음 팀에게 넘깁니다. 😔⚾',
    '<content> [[AIANG_MEDIA_...]] </content>'
  ].join('\n');
  const result = core.parseEditingResponse(raw, '원문', 'decorate');

  assert.equal(result.correctedText, '아쉽지만 어쩔 수 없이 다음 팀에게 넘깁니다. 😔⚾');
  assert.doesNotMatch(result.correctedText, /<\/?content>|AIANG_MEDIA/);
});

test('keeps only original protected media tokens while removing internal editing tags', () => {
  const token = '[[AIANG_MEDIA_test_1]]';
  const original = `본문\n${token}`;
  const raw = JSON.stringify({
    corrected_text: `<before_context>무시할 문맥</before_context>\n<content>\n다듬은 본문\n${token}\n[[AIANG_MEDIA_fake_2]]\n</content>`
  });
  const result = core.parseEditingResponse(raw, original, 'improve');

  assert.equal(result.correctedText, `다듬은 본문\n${token}`);
  assert.equal(result.correctedText.match(/\[\[AIANG_MEDIA_[^\]]+\]\]/g).length, 1);
});

test('adds personalization to the system prompt without changing the output contract', () => {
  const prompts = core.buildPrompts('improve', '본문', '다정하고 교양 있게');
  assert.match(prompts.system, /다정하고 교양 있게/);
  assert.match(prompts.user, /corrected_text/);
  assert.match(prompts.user, /<content>\n본문\n<\/content>/);
  assert.doesNotMatch(prompts.user, /AIANG_MEDIA/);
  assert.match(prompts.user, /입력 영역을 구분하는 XML 태그는 결과에 포함하지 마세요/);
});

test('mentions protected media tokens only when the editing input contains one', () => {
  const token = '[[AIANG_MEDIA_test_1]]';
  const withoutMedia = core.buildPrompts('improve', '본문', '');
  const withMedia = core.buildPrompts('improve', `본문\n${token}`, '');

  assert.doesNotMatch(withoutMedia.user, /AIANG_MEDIA/);
  assert.match(withMedia.user, /\[\[AIANG_MEDIA_\.\.\.\]\]/);
  assert.match(withMedia.user, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
    settings: { provider: 'openai', personalization: '차분하고 짧게 답합니다.' },
    commentGenerationEnabled: true
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

test('sends full chat history and keeps chat personalization in the system message', async () => {
  let requestBody;
  const chatCore = loadCore(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '스티브 잡스와 스티브 워즈니악 등이 공동 창립했습니다.' } }] }) };
  }, { settings: { provider: 'openai', personalization: '간결하게 답합니다.' } });
  const result = await chatCore.handleMessage({
    type: 'CHAT',
    requestId: 'chat-test',
    messages: [
      { role: 'user', content: '애플의 창립자는 누구지?' },
      { role: 'assistant', content: '여러 명의 공동 창립자가 있습니다.' },
      { role: 'user', content: '이름을 알려줘.' }
    ]
  }, { url: 'https://damoang.net/free/1' });
  assert.match(result.message, /스티브 잡스/);
  assert.equal(requestBody.messages.length, 4);
  assert.equal(requestBody.stream, true);
  assert.match(requestBody.messages[0].content, /개인화 지침:\n간결하게 답합니다/);
  assert.equal(requestBody.messages[3].content, '이름을 알려줘.');
});

test('streams OpenAI-compatible chat chunks as cumulative text', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"하세요"}}]}\n\n',
    'data: [DONE]\n\n'
  ];
  const streamingCore = loadCore(async () => ({
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: new ReadableStream({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      }
    })
  }));
  const updates = [];
  const result = await streamingCore.callOpenAICompatibleMessagesStreaming({
    endpoint: 'http://localhost:1234/v1',
    model: 'test-model',
    temperature: 0.2,
    temperatureAuto: false,
    apiKey: ''
  }, [{ role: 'user', content: '인사해줘' }], new AbortController().signal, value => updates.push(value));
  assert.equal(result, '안녕하세요');
  assert.deepEqual(updates, ['안녕', '안녕하세요']);
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

test('provides font size options with damoang default and sanitizes custom sizes', async () => {
  const testCore = loadCore(fetch);
  const defaultSettings = await testCore.getSettings();
  assert.equal(defaultSettings.fontSizeMode, 'damoang');
  assert.equal(defaultSettings.fontSizeCustom, 'medium');

  const sanitizedCustom = testCore.sanitizeSettings({
    fontSizeMode: 'custom',
    fontSizeCustom: 'large'
  });
  assert.equal(sanitizedCustom.fontSizeMode, 'custom');
  assert.equal(sanitizedCustom.fontSizeCustom, 'large');

  const sanitizedInvalid = testCore.sanitizeSettings({
    fontSizeMode: 'invalid',
    fontSizeCustom: 'huge'
  });
  assert.equal(sanitizedInvalid.fontSizeMode, 'damoang');
  assert.equal(sanitizedInvalid.fontSizeCustom, 'medium');

  const fullSettings = await testCore.handleMessage({ type: 'GET_SETTINGS' });
  assert.equal(fullSettings.settings.fontSizeMode, 'damoang');
  assert.equal(fullSettings.settings.fontSizeCustom, 'medium');
});

test('provides usePostImageCapture option with default false and sanitizes value', async () => {
  const testCore = loadCore(fetch);
  const defaultSettings = await testCore.getSettings();
  assert.equal(defaultSettings.usePostImageCapture, false);

  const sanitizedTrue = testCore.sanitizeSettings({ usePostImageCapture: true });
  assert.equal(sanitizedTrue.usePostImageCapture, true);

  const sanitizedFalse = testCore.sanitizeSettings({ usePostImageCapture: 'not-boolean' });
  assert.equal(sanitizedFalse.usePostImageCapture, false);

  const fullSettings = await testCore.handleMessage({ type: 'GET_SETTINGS' });
  assert.equal(fullSettings.settings.usePostImageCapture, false);
});

test('adds media analysis guideline to post summary prompts when images are provided', () => {
  const noImagePrompts = core.buildPostSummaryPrompts('본문 텍스트', []);
  for (const rule of promptCatalog.postSummary.mediaRules) assert.ok(!noImagePrompts.user.includes(rule));

  const withImagePrompts = core.buildPostSummaryPrompts('본문 텍스트', ['data:image/jpeg;base64,1234']);
  for (const rule of promptCatalog.postSummary.mediaRules) assert.ok(withImagePrompts.user.includes(rule));
});

test('uses standard image_url content for every OpenAI-compatible endpoint', () => {
  const dataUrl = 'data:image/jpeg;base64,aGVsbG8=';
  const messages = [{ role: 'system', content: 'instructions' }, { role: 'user', content: 'question' }];
  const result = core.attachImagesToMessages(messages, [dataUrl]);
  assert.equal(result[1].content[1].image_url.url, dataUrl);
  assert.equal(result[1].images, undefined);
  assert.equal(messages[1].content, 'question');
});

test('media payload rejects URLs, malformed data, excess count and size', () => {
  const image = 'data:image/jpeg;base64,aGVsbG8=';
  assert.equal(core.sanitizeImageUrls([image])[0], image);
  for (const input of [['https://example.com/private.png'], ['data:text/html;base64,aA=='], ['data:image/png;base64,<bad>'], Array(9).fill(image), ['data:image/png;base64,' + 'A'.repeat(3_000_000)]]) {
    assert.throws(() => core.sanitizeImageUrls(input));
  }
});

test('Gemini receives image Blobs with an image-enabled session, including streaming', async () => {
  let options, prompt, destroyed = false;
  const chunks = [];
  const model = {
    availability: async () => 'available',
    create: async input => {
      options = input;
      return {
        prompt: async () => '',
        promptStreaming: async function* (input) { prompt = input; yield '분석'; yield '분석 완료'; },
        destroy: () => { destroyed = true; }
      };
    }
  };
  const testCore = loadCore(fetch, { LanguageModel: model, settings: { provider: 'gemini', geminiKeepAlive: true } });
  const answer = await testCore.callGeminiNano({ system: 'instructions', user: 'read media' }, new AbortController().signal, {}, value => chunks.push(value), null, ['data:image/png;base64,aGVsbG8=']);
  assert.equal(options.expectedInputs[1].type, 'image');
  assert.ok(prompt[0].content[0].value.startsWith('read media'));
  assert.match(prompt[0].content[0].value, /영상 재생 내용과 음성은 포함되지 않습니다/);
  assert.ok(prompt[0].content[1].value instanceof Blob);
  assert.equal(await prompt[0].content[1].value.text(), 'hello');
  assert.equal(answer, '분석 완료');
  assert.equal(destroyed, true);
});

test('image session failures never retry as text-only and pretend to see images', async () => {
  let count = 0;
  const testCore = loadCore(fetch, { LanguageModel: {
    availability: async () => 'available',
    create: async () => { count++; throw new DOMException('unsupported', 'NotSupportedError'); }
  } });
  await assert.rejects(testCore.callGeminiNano({ system: 's', user: 'u' }, new AbortController().signal, {}, null, null, ['data:image/png;base64,aA==']), /이미지 입력/);
  assert.equal(count, 1);
});

test('Edge passes actual OCR evidence to its text model', async () => {
  let received;
  const testCore = loadCore(fetch, {
    navigator: { userAgent: 'Mozilla/5.0 Edg/150.0' },
    recognizeCapturedImages: async images => { assert.equal(images.length, 1); return '[OCR] 서울 행사 9월 8일'; },
    LanguageModel: {
      availability: async () => 'available',
      create: async () => ({ prompt: async input => { received = input; return '행사 안내'; }, destroy() {} })
    }
  });
  await testCore.callGeminiNano({ system: 's', user: '요약' }, new AbortController().signal, {}, null, null, ['data:image/png;base64,aA==']);
  assert.match(received, /서울 행사 9월 8일/);
  assert.doesNotMatch(received, /첨부된 본문 미디어 캡쳐/);
});

test('capture refuses a different active tab and never calls screenshot API', async () => {
  let captures = 0;
  const testCore = loadCore(fetch, { chromeOverrides: { tabs: {
    query: async () => [{ id: 2 }], captureVisibleTab: async () => { captures++; return 'screenshot'; }
  } } });
  await assert.rejects(testCore.captureSenderTab({ tab: { id: 1, windowId: 10 } }), /게시물 탭/);
  assert.equal(captures, 0);
});


test('all post-context actions transmit captures only when the setting is enabled', async () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  for (const enabled of [false, true]) {
    const requests = [];
    const testCore = loadCore(async (_url, options) => {
      const request = JSON.parse(options.body); requests.push(request);
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ choices: [{ message: { content: '확인한 내용입니다.' } }] }) };
    }, { commentGenerationEnabled: true, settings: { provider: 'openai', model: 'vision-model', usePostImageCapture: enabled } });
    await testCore.handleMessage({ type: 'SUMMARIZE_POST', text: '이미지 게시물', images: [image] }, { url: 'https://damoang.net/free/1' });
    await testCore.processChatRequest({ messages: [{ role: 'user', content: '이 게시물을 읽으세요' }], images: [image] });
    for (const type of ['SUMMARIZE_REACTIONS', 'BUILD_GLOSSARY', 'GENERATE_COMMENT']) {
      await testCore.handleMessage({ type, text: '본문', postText: '본문', commentsText: '댓글', commentCount: 1, sampledCommentCount: 1, tone: 'positive', images: [image] }, { url: 'https://damoang.net/free/1' });
    }
    assert.equal(requests.length, 5);
    const summaryUserContent = enabled ? requests[0].messages.at(-1).content[0].text : requests[0].messages.at(-1).content;
    for (const rule of promptCatalog.postSummary.mediaRules) {
      assert.equal(summaryUserContent.includes(rule), enabled, 'the direct summary request includes visual analysis rules only with media');
    }
    for (const request of requests) {
      const user = request.messages.at(-1);
      assert.equal(Array.isArray(user.content), enabled);
      if (enabled) assert.equal(user.content[1].image_url.url, image);
      assert.equal(user.images, undefined);
    }
  }
});

test('service-worker model requests use an offscreen document and relay stream events', async () => {
  const listeners = new Set(); let created = 0; let routed;
  const extensionURL = value => `chrome-extension://test/${value}`;
  const runtime = {
    getURL: extensionURL,
    onInstalled: { addListener() {} },
    onMessage: { addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); } },
    async sendMessage(message) {
      routed = message;
      for (const listener of listeners) listener({ type: 'AIANG_BUILTIN_EVENT', id: message.id, kind: 'chunk', value: '중간 답변' }, { url: extensionURL('offscreen.html') });
      return { ok: true, result: '최종 답변' };
    }
  };
  const testCore = loadCore(fetch, { chromeOverrides: { runtime, offscreen: {
    hasDocument: async () => false, createDocument: async options => { assert.equal(options.url, 'offscreen.html'); created++; }
  } } });
  const chunks = [];
  const response = await testCore.callGeminiNano({ system: 's', user: 'u' }, new AbortController().signal, {}, value => chunks.push(value), null, ['data:image/png;base64,aA==']);
  assert.equal(response, '최종 답변');
  assert.equal(created, 1);
  assert.equal(routed.target, 'aiang-offscreen');
  assert.equal(routed.images.length, 1);
  assert.deepEqual(chunks, ['중간 답변']);
  assert.equal(listeners.size, 1, 'temporary response listener is removed');
});

test('default AI provider is set to on-device gemini for new users', async () => {
  const testCore = loadCore();
  const settings = await testCore.getSettings();
  assert.equal(settings.provider, 'gemini');
});

test('floating assistant is opt-in and public settings expose a validated position', async () => {
  const core = loadCore();
  const defaults = await core.getSettings();
  assert.equal(defaults.floatingAssistantEnabled, false);
  assert.equal(defaults.floatingAssistantPosition, 'center');
  assert.equal(defaults.floatingAssistantHeight, 'default');
  assert.equal(defaults.floatingAssistantSize, 'small');
  assert.equal(core.sanitizeSettings({floatingAssistantHeight:'unknown'}).floatingAssistantHeight,'default');
  assert.equal(core.sanitizeSettings({floatingAssistantSize:'unknown'}).floatingAssistantSize,'small');
  for(const height of ['default','slight','high']) {
    const configured = loadCore(fetch, {settings:{floatingAssistantHeight:height}});
    assert.equal((await configured.handleMessage({type:'GET_SETTINGS'})).settings.floatingAssistantHeight,height);
  }
  for(const size of ['small','medium','large']) {
    const configured = loadCore(fetch, {settings:{floatingAssistantSize:size}});
    assert.equal((await configured.handleMessage({type:'GET_SETTINGS'})).settings.floatingAssistantSize,size);
  }
  assert.equal(core.sanitizeSettings({floatingAssistantEnabled:'true',floatingAssistantPosition:'top'}).floatingAssistantEnabled,false);
  assert.equal(core.sanitizeSettings({floatingAssistantPosition:'top'}).floatingAssistantPosition,'center');
  const enabledCore = loadCore(fetch, {settings:{floatingAssistantEnabled:true,floatingAssistantPosition:'left'}});
  const response = await enabledCore.handleMessage({type:'GET_SETTINGS'});
  assert.equal(response.settings.floatingAssistantEnabled,true);
  assert.equal(response.settings.floatingAssistantPosition,'left');
  const centerCore = loadCore(fetch, {settings:{floatingAssistantPosition:'center'}});
  assert.equal((await centerCore.handleMessage({type:'GET_SETTINGS'})).settings.floatingAssistantPosition,'center');
});

test('selection patches preserve unrelated settings and reject content-page writes', async () => {
  let stored = { endpoint: 'http://localhost:1234/v1', apiKey: 'saved-key', personalization: 'saved note', temperature: 0.7, floatingAssistantHeight: 'default' };
  const writes = [];
  const instance = loadCore(fetch, { chromeOverrides: { storage: { local: {
    get: async defaults => ({ ...defaults, ...stored }),
    set: async patch => { writes.push({ ...patch }); stored = { ...stored, ...patch }; }
  } } } });
  const sender = { url: 'chrome-extension://test/options.html' };
  await instance.handleMessage({ type: 'PATCH_SETTINGS', settings: { floatingAssistantHeight: 'high', endpoint: 'http://draft.invalid', apiKey: 'draft-key', personalization: 'draft note' } }, sender);
  assert.deepEqual(writes[0], { floatingAssistantHeight: 'high' });
  assert.equal(stored.apiKey, 'saved-key');
  assert.equal(stored.personalization, 'saved note');
  const result = await instance.handleMessage({ type: 'PATCH_SETTINGS', settings: { provider: 'gemini', enabled: false, fontSizeCustom: 'large' } }, sender);
  assert.equal(result.settings.provider, 'gemini');
  assert.equal(result.settings.floatingAssistantHeight, 'high');
  assert.equal(result.settings.temperature, 0.7);
  await instance.handleMessage({ type: 'PATCH_SETTINGS', settings: { floatingAssistantHeight: 'invalid' } }, sender);
  assert.equal(stored.floatingAssistantHeight, 'default');
  await assert.rejects(instance.handleMessage({ type: 'PATCH_SETTINGS', settings: { enabled: true } }, { url: 'https://damoang.net/free' }), /설정 화면/);
});

test('provides centralized ui labels and floating menu configuration in prompts.json', () => {
  const ui = promptCatalog?.ui;
  assert.ok(ui, 'ui section should exist in prompts.json');
  assert.ok(ui.actions?.spellcheck?.label, 'spellcheck action label should exist');
  assert.ok(ui.floatingMenu?.headings?.body, 'floatingMenu headings should exist');
  assert.ok(ui.floatingMenu?.items?.spellcheck, 'floatingMenu item templates should exist');
  assert.ok(ui.commentTones?.positive, 'commentTones should exist');
});

