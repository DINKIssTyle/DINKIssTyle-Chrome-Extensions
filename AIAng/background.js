const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  provider: 'openai',
  endpoint: 'http://localhost:1234/v1',
  apiKey: '',
  model: 'local-model',
  temperature: 0.2,
  temperatureAuto: false,
  personalization: ''
});

let promptCatalog = globalThis.__AIANG_PROMPT_CATALOG__ || null;
let promptCatalogPromise = null;
let featureFlags = globalThis.__AIANG_FEATURE_FLAGS__ || null;
let featureFlagsPromise = null;

async function ensurePromptCatalog() {
  if (promptCatalog) return promptCatalog;
  promptCatalogPromise ||= fetch(chrome.runtime.getURL('shared/prompts.json'))
    .then(response => {
      if (!response.ok) throw new Error(`프롬프트 파일을 불러오지 못했습니다. (HTTP ${response.status})`);
      return response.json();
    })
    .then(catalog => {
      promptCatalog = catalog;
      return catalog;
    });
  return await promptCatalogPromise;
}

function requirePromptCatalog() {
  if (!promptCatalog) throw new Error('프롬프트 파일이 아직 준비되지 않았습니다.');
  return promptCatalog;
}

async function ensureFeatureFlags() {
  if (featureFlags) return featureFlags;
  featureFlagsPromise ||= fetch(chrome.runtime.getURL('shared/features.json'))
    .then(response => {
      if (!response.ok) throw new Error(`기능 설정 파일을 불러오지 못했습니다. (HTTP ${response.status})`);
      return response.json();
    })
    .then(flags => {
      if (typeof flags?.commentGeneration !== 'boolean') {
        throw new Error('기능 설정 파일의 commentGeneration 값이 올바르지 않습니다.');
      }
      featureFlags = Object.freeze({ commentGeneration: flags.commentGeneration });
      return featureFlags;
    });
  return await featureFlagsPromise;
}

const activeRequests = new Map();
const GEMINI_CHUNK_ACTIONS = new Set(['spellcheck', 'honorific', 'improve']);
const GEMINI_CHUNK_CHAR_LIMITS = Object.freeze({
  spellcheck: 900,
  honorific: 1200,
  improve: 1200
});
const GEMINI_MIN_CHUNK_CHARS = 240;
const GEMINI_INPUT_BUDGET_RATIO = 0.3;
const GEMINI_NEIGHBOR_CONTEXT_CHARS = 180;
const COMMENT_GENERATION_TONES = new Set(['positive', 'negative', 'angry', 'joke']);

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(current);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'GET_SETTINGS': {
      const [settings, features, prompts] = await Promise.all([getSettings(), ensureFeatureFlags(), ensurePromptCatalog()]);
      return {
        settings: {
          enabled: settings.enabled,
          provider: settings.provider,
          configured: settings.provider === 'gemini' || Boolean(settings.endpoint && settings.model),
          features,
          prompts
        }
      };
    }
    case 'GET_SETTINGS_FULL':
      assertExtensionPage(sender);
      return { settings: await getSettings() };
    case 'SAVE_SETTINGS':
      assertExtensionPage(sender);
      await chrome.storage.local.set(sanitizeSettings(message.settings));
      return { settings: await getSettings() };
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return {};
    case 'CANCEL_REQUEST':
      activeRequests.get(String(message.requestId || ''))?.abort();
      return {};
    case 'PROCESS_TEXT':
      assertDamoangPage(sender);
      return await processTextRequest(message, progress => {
        reportRequestProgress(sender, message.requestId, progress);
      });
    case 'SUGGEST_TITLES':
      assertDamoangPage(sender);
      return await processTitleSuggestionsRequest(message);
    case 'SUMMARIZE_POST':
      assertDamoangPage(sender);
      return await processPostSummaryRequest(message);
    case 'SUMMARIZE_REACTIONS':
      assertDamoangPage(sender);
      return await processCommentReactionSummaryRequest(message);
    case 'BUILD_GLOSSARY':
      assertDamoangPage(sender);
      return await processTermGlossaryRequest(message);
    case 'GENERATE_COMMENT':
      assertDamoangPage(sender);
      if (!(await ensureFeatureFlags()).commentGeneration) {
        throw new Error('댓글 생성 기능이 비활성화되어 있습니다.');
      }
      return await processCommentGenerationRequest(message);
    case 'CHAT':
      assertDamoangPage(sender);
      return await processChatRequest(message, content => {
        reportChatStream(sender, message.requestId, content);
      });
    case 'TEST_CONNECTION':
      assertExtensionPage(sender);
      return await testConnection(sanitizeSettings(message.settings));
    case 'LIST_MODELS':
      assertExtensionPage(sender);
      return { models: await listModels(sanitizeSettings(message.settings)) };
    default:
      throw new Error('지원하지 않는 요청입니다.');
  }
}

function assertExtensionPage(sender) {
  if (!sender?.url?.startsWith(chrome.runtime.getURL(''))) {
    throw new Error('확장 프로그램 설정 화면에서만 사용할 수 있습니다.');
  }
}

function assertDamoangPage(sender) {
  let url;
  try {
    url = new URL(sender?.url || '');
  } catch {
    throw new Error('요청한 페이지를 확인할 수 없습니다.');
  }
  if (!['damoang.net', 'www.damoang.net'].includes(url.hostname)) {
    throw new Error('다모앙 페이지에서만 사용할 수 있습니다.');
  }
}

function reportRequestProgress(sender, requestId, progress) {
  if (!sender?.tab?.id || !chrome.tabs?.sendMessage || !requestId) return;
  try {
    const delivery = chrome.tabs.sendMessage(sender.tab.id, {
      type: 'REQUEST_PROGRESS',
      requestId: String(requestId),
      current: progress.current,
      total: progress.total
    });
    delivery?.catch?.(() => { });
  } catch {
    // The page may have navigated or closed while the local model was running.
  }
}

function reportChatStream(sender, requestId, content) {
  if (!sender?.tab?.id || !chrome.tabs?.sendMessage || !requestId) return;
  try {
    const delivery = chrome.tabs.sendMessage(sender.tab.id, {
      type: 'CHAT_STREAM',
      requestId: String(requestId),
      content
    });
    delivery?.catch?.(() => { });
  } catch {
    // The page may have navigated or closed while the model was responding.
  }
}

async function getSettings() {
  return sanitizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

function sanitizeSettings(input = {}) {
  const provider = input.provider === 'gemini' ? 'gemini' : 'openai';
  return {
    enabled: input.enabled !== false,
    provider,
    endpoint: normalizeEndpoint(input.endpoint),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || '').trim() || 'local-model',
    temperature: clampNumber(input.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    temperatureAuto: input.temperatureAuto === true,
    personalization: String(input.personalization || '').trim().slice(0, 4000)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeEndpoint(value) {
  const raw = String(value || DEFAULT_SETTINGS.endpoint).trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_SETTINGS.endpoint;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/i, '');
    } else if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_SETTINGS.endpoint;
  }
}

async function processTextRequest(message, onProgress = () => { }) {
  await ensurePromptCatalog();
  const text = String(message.text || '');
  const action = String(message.action || '');
  if (!text.trim()) throw new Error('교정할 내용을 먼저 입력해 주세요.');
  if (text.length > 30000) throw new Error('한 번에 교정할 수 있는 글은 30,000자까지입니다.');
  if (!['spellcheck', 'honorific', 'improve', 'decorate'].includes(action)) {
    throw new Error('알 수 없는 교정 방식입니다.');
  }

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    if (settings.provider === 'gemini' && GEMINI_CHUNK_ACTIONS.has(action)) {
      return await processGeminiEditingRequest(
        action,
        text,
        settings.personalization,
        controller.signal,
        onProgress
      );
    }
    const prompts = buildPrompts(action, text, settings.personalization);
    const raw = await callConfiguredModel(settings, prompts, controller.signal);
    return parseEditingResponse(raw, text, action);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processTitleSuggestionsRequest(message) {
  await ensurePromptCatalog();
  const text = String(message.text || '').trim();
  if (!text) throw new Error('제목을 추천할 내용을 먼저 입력해 주세요.');
  if (text.length > 30000) throw new Error('제목 추천에 사용할 수 있는 글은 30,000자까지입니다.');

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const prompts = buildTitleSuggestionPrompts(text, settings.personalization);
    const raw = await callConfiguredModel(settings, prompts, controller.signal);
    return { titles: parseTitleSuggestions(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processCommentGenerationRequest(message) {
  await ensurePromptCatalog();
  const postText = String(message.postText || '').trim();
  const tone = String(message.tone || '');
  if (!postText) throw new Error('댓글을 작성할 게시물 본문을 찾지 못했습니다.');
  if (postText.length > 12000) throw new Error('댓글 생성에 사용할 수 있는 본문은 12,000자까지입니다.');
  if (!COMMENT_GENERATION_TONES.has(tone)) throw new Error('알 수 없는 댓글 생성 방식입니다.');

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const prompts = buildCommentGenerationPrompts(postText, tone, settings.personalization);
    const raw = await callConfiguredModel(settings, prompts, controller.signal, {
      responseConstraint: buildCommentGenerationResponseConstraint(),
      omitResponseConstraintInput: true
    });
    return { comment: parseGeneratedComment(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processChatRequest(message, onChunk = () => { }) {
  await ensurePromptCatalog();
  const messages = normalizeChatMessages(message.messages);
  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');
  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const system = buildChatSystemPrompt(settings.personalization);
    const raw = settings.provider === 'gemini'
      ? await callGeminiNano({ system, user: formatChatTranscript(messages) }, controller.signal, {}, onChunk)
      : await callOpenAICompatibleMessagesStreaming(
          settings,
          [{ role: 'system', content: system }, ...messages],
          controller.signal,
          onChunk
        );
    return { message: parseChatResponse(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

function normalizeChatMessages(input) {
  if (!Array.isArray(input)) throw new Error('대화 내용을 확인할 수 없습니다.');
  const messages = input.slice(-20).map(item => ({
    role: item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : '',
    content: String(item?.content || '').trim().slice(0, 4000)
  })).filter(item => item.role && item.content);
  if (!messages.length || messages.at(-1).role !== 'user') throw new Error('질문을 먼저 입력해 주세요.');
  if (messages.reduce((sum, item) => sum + item.content.length, 0) > 16000) {
    throw new Error('대화가 너무 길어졌습니다. 창을 닫은 뒤 새로 질문해 주세요.');
  }
  return messages;
}

async function processPostSummaryRequest(message) {
  await ensurePromptCatalog();
  const text = String(message.text || '').trim();
  if (!text) throw new Error('요약할 게시물 본문을 찾지 못했습니다.');
  if (text.length > 15000) throw new Error('요약에 사용할 수 있는 게시물 내용은 15,000자까지입니다.');

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const raw = await callConfiguredModel(settings, buildPostSummaryPrompts(text), controller.signal);
    return { summary: parsePostSummary(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processCommentReactionSummaryRequest(message) {
  await ensurePromptCatalog();
  const postText = String(message.postText || '').trim();
  const commentsText = String(message.commentsText || '').trim();
  const commentCount = Math.max(0, Number.parseInt(message.commentCount, 10) || 0);
  const sampledCommentCount = Math.max(0, Number.parseInt(message.sampledCommentCount, 10) || 0);
  if (!postText) throw new Error('댓글 반응을 분석할 게시물 본문을 찾지 못했습니다.');
  if (!commentsText) throw new Error('요약할 댓글이 없습니다.');
  if (postText.length > 6000 || commentsText.length > 9000) {
    throw new Error('댓글 반응 요약에 사용할 수 있는 입력 길이를 초과했습니다.');
  }

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const prompts = buildCommentReactionSummaryPrompts(
      postText,
      commentsText,
      commentCount,
      sampledCommentCount
    );
    const raw = await callConfiguredModel(settings, prompts, controller.signal);
    return { summary: parsePostSummary(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processTermGlossaryRequest(message) {
  await ensurePromptCatalog();
  const text = String(message.text || '').trim();
  if (!text) throw new Error('용어를 찾을 게시물 본문을 찾지 못했습니다.');
  if (text.length > 15000) throw new Error('용어 사전에 사용할 수 있는 게시물 내용은 15,000자까지입니다.');

  const settings = await getSettings();
  if (!settings.enabled) throw new Error('AIAng가 설정에서 꺼져 있습니다.');

  const requestId = String(message.requestId || crypto.randomUUID());
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  try {
    const raw = await callConfiguredModel(settings, buildTermGlossaryPrompts(text), controller.signal);
    return { glossary: parseTermGlossary(raw) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('요청을 취소했습니다.');
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

async function processGeminiEditingRequest(action, text, personalization, signal, onProgress) {
  const chunkLimit = await measureGeminiEditingChunkLimit(action, text, personalization, signal);
  const chunks = splitTextAtNaturalBoundaries(text, chunkLimit);
  const completed = [];
  let index = 0;

  while (index < chunks.length) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunk = chunks[index];
    const parts = isolateChunkWhitespace(chunk.text);
    if (!parts.content) {
      completed.push({ chunk, correctedText: chunk.text, suggestions: [] });
      index += 1;
      continue;
    }

    if (chunks.length > 1) onProgress({ current: index + 1, total: chunks.length });
    const contentStart = chunk.start + parts.leading.length;
    const contentEnd = contentStart + parts.content.length;
    const prompts = buildPrompts(action, parts.content, personalization, {
      before: getNeighborContext(text, contentStart, 'before'),
      after: getNeighborContext(text, contentEnd, 'after')
    });

    try {
      const raw = await callGeminiNano(prompts, signal, {
        responseConstraint: buildEditingResponseConstraint(action),
        omitResponseConstraintInput: true
      });
      const parsed = parseEditingResponse(raw, parts.content, action);
      completed.push({
        chunk,
        correctedText: `${parts.leading}${parsed.correctedText}${parts.trailing}`,
        suggestions: parsed.suggestions.map(suggestion => ({
          ...suggestion,
          start: suggestion.start + contentStart,
          end: suggestion.end + contentStart
        }))
      });
      index += 1;
    } catch (error) {
      if (!isGeminiQuotaError(error) || parts.content.length <= GEMINI_MIN_CHUNK_CHARS) throw error;
      const smallerLimit = Math.max(GEMINI_MIN_CHUNK_CHARS, Math.floor(chunk.text.length / 2));
      const smallerChunks = splitTextAtNaturalBoundaries(chunk.text, smallerLimit, chunk.start);
      if (smallerChunks.length < 2) throw error;
      chunks.splice(index, 1, ...smallerChunks);
    }
  }

  completed.sort((left, right) => left.chunk.start - right.chunk.start);
  return {
    correctedText: completed.map(result => result.correctedText).join(''),
    suggestions: completed.flatMap(result => result.suggestions)
  };
}

async function measureGeminiEditingChunkLimit(action, text, personalization, signal) {
  const hardLimit = GEMINI_CHUNK_CHAR_LIMITS[action] || 1200;
  if (text.length <= hardLimit) return text.length;
  const prompts = buildPrompts(action, text, personalization);
  const model = getLanguageModelAPI();
  if (!model) throw new Error('이 Chrome에서는 Gemini Nano Prompt API를 사용할 수 없습니다.');
  const availability = await getGeminiAvailability(model);
  if (['no', 'unavailable'].includes(availability)) {
    throw new Error('이 기기에서는 Gemini Nano를 사용할 수 없습니다.');
  }

  let session;
  try {
    const created = await createGeminiSession(model, prompts.system, signal);
    session = created.session;
    const measureUsage = session.measureContextUsage || session.measureInputUsage;
    if (typeof measureUsage !== 'function') {
      return Math.min(text.length, hardLimit);
    }
    const prompt = formatGeminiPrompt(prompts, created.systemPromptEmbedded);
    let measured;
    try {
      measured = normalizeMeasuredContextUsage(await measureUsage.call(session, prompt));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return Math.min(text.length, hardLimit);
    }
    const contextWindow = Number(session.contextWindow ?? session.inputQuota);
    const contextUsage = Number(session.contextUsage ?? session.inputUsage) || 0;
    const available = contextWindow - contextUsage;
    if (!Number.isFinite(measured) || measured <= 0 || !Number.isFinite(available) || available <= 0) {
      return Math.min(text.length, hardLimit);
    }
    const targetUsage = Math.max(1, Math.floor(available * GEMINI_INPUT_BUDGET_RATIO));
    if (measured <= targetUsage) return Math.min(text.length, hardLimit);

    const emptyPrompts = buildPrompts(action, '', personalization);
    const emptyPrompt = formatGeminiPrompt(emptyPrompts, created.systemPromptEmbedded);
    let fixedUsage = 0;
    try {
      fixedUsage = normalizeMeasuredContextUsage(await measureUsage.call(session, emptyPrompt));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
    const variableUsage = Math.max(1, measured - (Number.isFinite(fixedUsage) ? fixedUsage : 0));
    const variableBudget = Math.max(1, targetUsage - (Number.isFinite(fixedUsage) ? fixedUsage : 0));
    const estimated = Math.floor(text.length * variableBudget / variableUsage);
    return Math.max(
      GEMINI_MIN_CHUNK_CHARS,
      Math.min(text.length, hardLimit, estimated)
    );
  } finally {
    session?.destroy?.();
  }
}

function normalizeMeasuredContextUsage(value) {
  if (typeof value === 'number') return value;
  return Number(value?.usage ?? value?.contextUsage ?? value?.tokens ?? NaN);
}

function splitTextAtNaturalBoundaries(text, maxLength, baseOffset = 0) {
  const source = String(text || '');
  if (!source) return [];
  const limit = Math.max(GEMINI_MIN_CHUNK_CHARS, Number(maxLength) || 1200);
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + limit);
    if (end < source.length) end = findNaturalChunkBoundary(source, start, end);
    end = moveBoundaryPastProtectedToken(source, start, end);
    if (end <= start) end = Math.min(source.length, start + limit);
    chunks.push({ text: source.slice(start, end), start: baseOffset + start, end: baseOffset + end });
    start = end;
  }
  return chunks;
}

function findNaturalChunkBoundary(text, start, idealEnd) {
  const minimum = start + Math.floor((idealEnd - start) * 0.55);
  const windowText = text.slice(minimum, idealEnd);
  const patterns = [/\n{2,}/g, /\n/g, /[.!?…][”’"')\]]?\s+/g, /[ \t]+/g];
  for (const pattern of patterns) {
    let match;
    let lastEnd = -1;
    while ((match = pattern.exec(windowText))) lastEnd = minimum + match.index + match[0].length;
    if (lastEnd > start) return lastEnd;
  }
  return idealEnd;
}

function moveBoundaryPastProtectedToken(text, start, boundary) {
  const opening = text.lastIndexOf('[[AIANG_MEDIA_', boundary);
  const closing = text.lastIndexOf(']]', boundary);
  if (opening < start || opening <= closing) return boundary;
  const tokenEnd = text.indexOf(']]', boundary);
  return tokenEnd >= 0 ? tokenEnd + 2 : boundary;
}

function isolateChunkWhitespace(text) {
  const source = String(text || '');
  const leading = source.match(/^\s*/)?.[0] || '';
  const remaining = source.slice(leading.length);
  const trailing = remaining.match(/\s*$/)?.[0] || '';
  return {
    leading,
    content: remaining.slice(0, remaining.length - trailing.length),
    trailing
  };
}

function getNeighborContext(text, offset, direction) {
  const source = String(text || '');
  const context = direction === 'before'
    ? source.slice(Math.max(0, offset - GEMINI_NEIGHBOR_CONTEXT_CHARS), offset)
    : source.slice(offset, Math.min(source.length, offset + GEMINI_NEIGHBOR_CONTEXT_CHARS));
  return context.replace(/\[\[AIANG_MEDIA_[^\]]+\]\]/g, '[미디어]').trim();
}

function isGeminiQuotaError(error) {
  return error?.name === 'QuotaExceededError' || /QuotaExceeded|context window|context.*exceed/i.test(error?.message || '');
}

function buildEditingResponseConstraint(action = 'improve') {
  if (action === 'spellcheck') {
    return {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              replacement: { type: 'string' },
              start: { type: 'integer', minimum: 0 },
              end: { type: 'integer', minimum: 0 },
              reason: { type: 'string' }
            },
            required: ['original', 'replacement', 'start', 'end'],
            additionalProperties: false
          }
        }
      },
      required: ['suggestions'],
      additionalProperties: false
    };
  }
  return {
    type: 'object',
    properties: {
      corrected_text: { type: 'string' }
    },
    required: ['corrected_text'],
    additionalProperties: false
  };
}

function buildPrompts(action, text, personalization, editingContext = null) {
  const catalog = requirePromptCatalog();
  const section = catalog.editing;
  const personalizationBlock = buildPersonalizationBlock(personalization, 'editing');
  const outputShape = action === 'spellcheck'
    ? '{"suggestions":[{"original":"원문 일부","replacement":"교정문 일부","start":0,"end":0,"reason":"짧은 설명"}]}'
    : '{"corrected_text":"전체 교정문"}';

  return {
    system: [
      ...section.system,
      '설명, 인사말, 코드 펜스 없이 유효한 JSON 하나만 반환하세요.',
      personalizationBlock
    ].filter(Boolean).join('\n'),
    user: [
      '작업 규칙:',
      ...section.rules[action].map(rule => `- ${rule}`),
      ...section.commonRules.map(rule => `- ${rule}`),
      ...(text.includes('[[AIANG_MEDIA_') ? [`- ${section.mediaRule}`] : []),
      ...(editingContext ? [`- ${section.contextRule}`] : []),
      ...(action !== 'spellcheck' ? [`- ${section.fullResultRule}`] : []),
      `- JSON 형태: ${outputShape}`,
      '',
      ...(editingContext ? [
        '<before_context>',
        editingContext.before,
        '</before_context>',
        ''
      ] : []),
      '<content>',
      text,
      '</content>',
      ...(editingContext ? [
        '',
        '<after_context>',
        editingContext.after,
        '</after_context>'
      ] : [])
    ].join('\n')
  };
}

function trimTextForTitleSuggestion(text, maxChars = 2500, headChars = 1500, tailChars = 1000) {
  const content = String(text || '')
    .replace(/\[\[AIANG_MEDIA_[^\]]+\]\]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (content.length <= maxChars) return content;
  const head = content.slice(0, headChars).trimEnd();
  const tail = content.slice(-tailChars).trimStart();
  return `${head}\n\n${requirePromptCatalog().titles.omissionMarker}\n\n${tail}`;
}

function buildTitleSuggestionPrompts(text, personalization) {
  const catalog = requirePromptCatalog();
  const section = catalog.titles;
  const content = trimTextForTitleSuggestion(text);
  const personalizationBlock = buildPersonalizationBlock(personalization, 'titles');
  return {
    system: [
      ...section.system,
      '설명, 인사말, 코드 펜스 없이 유효한 JSON 하나만 반환하세요.',
      personalizationBlock
    ].filter(Boolean).join('\n'),
    user: [
      section.intro,
      ...section.rules.map(rule => `- ${rule}`),
      '- JSON 형태: {"titles":["제목 1","제목 2","제목 3","제목 4","제목 5"]}',
      '',
      '<content>',
      content,
      '</content>'
    ].join('\n')
  };
}

function buildPersonalizationBlock(personalization, boundaryKey) {
  const instructions = String(personalization || '').trim();
  if (!instructions) return '';
  const personalizationConfig = requirePromptCatalog().personalization;
  return `\n${personalizationConfig.heading}\n${instructions}\n${personalizationConfig.boundaries[boundaryKey]}`;
}

function buildCommentGenerationPrompts(postText, tone, personalization) {
  const catalog = requirePromptCatalog();
  const section = catalog.comment;
  const personalizationBlock = buildPersonalizationBlock(personalization, 'comment');
  return {
    system: [
      ...section.system,
      '설명, 인사말, 코드 펜스 없이 유효한 JSON 하나만 반환하세요.',
      personalizationBlock
    ].filter(Boolean).join('\n'),
    user: [
      section.intro,
      `- ${section.toneRules[tone]}`,
      ...section.rules.map(rule => `- ${rule}`),
      '- JSON 형태: {"comment":"댓글 내용"}',
      '',
      '<post>',
      String(postText || '').trim(),
      '</post>'
    ].join('\n')
  };
}

function buildCommentGenerationResponseConstraint() {
  return {
    type: 'object',
    properties: {
      comment: { type: 'string' }
    },
    required: ['comment'],
    additionalProperties: false
  };
}

function buildChatSystemPrompt(personalization) {
  const catalog = requirePromptCatalog();
  return [
    ...catalog.chat.system,
    buildPersonalizationBlock(personalization, 'chat')
  ].filter(Boolean).join('\n');
}

function formatChatTranscript(messages) {
  return messages.map(item => `${item.role === 'assistant' ? 'AI' : '사용자'}: ${item.content}`).join('\n\n')
    + '\n\nAI:';
}

function buildPostSummaryPrompts(text) {
  const section = requirePromptCatalog().postSummary;
  const content = String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    system: section.system,
    user: [
      section.intro,
      ...section.rules.map(rule => `- ${rule}`),
      '',
      '<content>',
      content,
      '</content>'
    ].join('\n')
  };
}

function buildCommentReactionSummaryPrompts(postText, commentsText, commentCount, sampledCommentCount) {
  const section = requirePromptCatalog().reactionSummary;
  const total = Math.max(0, Number(commentCount) || 0);
  const sampled = Math.max(0, Number(sampledCommentCount) || 0);
  const samplingNote = total > sampled
    ? renderPromptTemplate(section.sampledNote, { total, sampled })
    : renderPromptTemplate(section.allNote, { count: total || sampled });
  return {
    system: section.system,
    user: [
      section.intro,
      `- ${samplingNote}`,
      ...section.rules.map(rule => `- ${rule}`),
      '',
      '<post>',
      String(postText || '').trim(),
      '</post>',
      '',
      `<comments total="${total}" sampled="${sampled}">`,
      String(commentsText || '').trim(),
      '</comments>'
    ].join('\n')
  };
}

function buildTermGlossaryPrompts(text) {
  const section = requirePromptCatalog().glossary;
  const content = String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    system: section.system,
    user: [
      section.intro,
      '',
      '[게시물]',
      content,
      '',
      '[질문]',
      section.question
    ].join('\n')
  };
}

function renderPromptTemplate(template, values) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

async function callConfiguredModel(settings, prompts, signal, promptOptions = {}) {
  return settings.provider === 'gemini'
    ? await callGeminiNano(prompts, signal, promptOptions)
    : await callOpenAICompatible(settings, prompts, signal);
}

async function callOpenAICompatible(settings, prompts, signal) {
  return await callOpenAICompatibleMessages(settings, [
    { role: 'system', content: prompts.system },
    { role: 'user', content: prompts.user }
  ], signal);
}

async function callOpenAICompatibleMessages(settings, messages, signal) {
  if (!settings.endpoint || !settings.model) {
    throw new Error('설정에서 API 주소와 모델을 입력해 주세요.');
  }
  const response = await fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      ...(!settings.temperatureAuto ? { temperature: settings.temperature } : {}),
      stream: false
    }),
    signal
  });
  if (!response.ok) throw await createHTTPError(response);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => part?.text || part?.content || '').join('');
  }
  throw new Error('AI 응답에서 교정문을 찾지 못했습니다.');
}

async function callOpenAICompatibleMessagesStreaming(settings, messages, signal, onChunk) {
  if (!settings.endpoint || !settings.model) {
    throw new Error('설정에서 API 주소와 모델을 입력해 주세요.');
  }
  const response = await fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      ...(!settings.temperatureAuto ? { temperature: settings.temperature } : {}),
      stream: true
    }),
    signal
  });
  if (!response.ok) throw await createHTTPError(response);
  if (!response.body?.getReader || !String(response.headers?.get?.('content-type') || '').includes('text/event-stream')) {
    const data = await response.json();
    const content = readCompletionContent(data);
    onChunk(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  const consumeLine = line => {
    const value = line.trim();
    if (!value.startsWith('data:')) return;
    const payload = value.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const chunk = readCompletionContent(JSON.parse(payload), true);
      if (!chunk) return;
      result = chunk.startsWith(result) ? chunk : result + chunk;
      onChunk(sanitizeStreamingChatText(result));
    } catch {
      // Ignore keep-alive or provider-specific SSE events without text.
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : lines.pop() || '';
    lines.forEach(consumeLine);
    if (done) {
      if (buffer) consumeLine(buffer);
      break;
    }
  }
  return result;
}

function readCompletionContent(data, streaming = false) {
  const choice = data?.choices?.[0];
  const content = streaming
    ? choice?.delta?.content ?? choice?.message?.content ?? choice?.text
    : choice?.message?.content ?? choice?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || '').join('');
  return '';
}

function sanitizeStreamingChatText(value) {
  return String(value || '')
    .replace(/<\/?(?:content|before_context|after_context)\b[^>]*>/gi, '')
    .replace(/\[\[AIANG_MEDIA_[^\]\r\n]+\]\]/g, '')
    .trimStart();
}

function parseChatResponse(raw) {
  const answer = sanitizeEditingText(stripCodeFence(String(raw || '').trim()), '');
  if (!answer) throw new Error('AI가 빈 답변을 반환했습니다. 다시 시도해 주세요.');
  if (answer.length > 12000) throw new Error('AI 답변이 지나치게 깁니다. 질문을 나누어 다시 시도해 주세요.');
  return answer;
}

async function createHTTPError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || '';
  } catch {
    detail = (await response.text().catch(() => '')).slice(0, 300);
  }
  return new Error(`AI 서버 오류 (${response.status})${detail ? `: ${detail}` : ''}`);
}

function getLanguageModelAPI() {
  if (globalThis.LanguageModel) return globalThis.LanguageModel;
  if (globalThis.chrome?.aiOriginTrial?.languageModel) return globalThis.chrome.aiOriginTrial.languageModel;
  return globalThis.ai?.languageModel || globalThis.ai?.assistant || null;
}

async function getGeminiAvailability(model) {
  const method = model?.availability || model?.capabilities || model?.canCreateTextSession;
  if (!method) return 'available';
  const result = await method.call(model);
  return typeof result === 'string' ? result : result?.available || result?.availability || 'available';
}

async function callGeminiNano(prompts, signal, promptOptions = {}, onChunk = null) {
  const model = getLanguageModelAPI();
  if (!model) throw new Error('이 Chrome에서는 Gemini Nano Prompt API를 사용할 수 없습니다.');
  const availability = await getGeminiAvailability(model);
  if (['no', 'unavailable'].includes(availability)) {
    throw new Error('이 기기에서는 Gemini Nano를 사용할 수 없습니다.');
  }

  let session;
  try {
    const created = await createGeminiSession(model, prompts.system, signal);
    session = created.session;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = formatGeminiPrompt(prompts, created.systemPromptEmbedded);
    let result;
    try {
      if (onChunk && typeof session.promptStreaming === 'function') {
        result = '';
        const stream = session.promptStreaming(prompt, { signal, ...promptOptions });
        for await (const value of stream) {
          const chunk = String(value || '');
          result = chunk.startsWith(result) ? chunk : result + chunk;
          onChunk(sanitizeStreamingChatText(result));
        }
      } else {
        result = await session.prompt(prompt, { signal, ...promptOptions });
        if (onChunk) onChunk(sanitizeStreamingChatText(String(result || '')));
      }
    } catch (error) {
      if (promptOptions.responseConstraint
        && ['NotSupportedError', 'TypeError'].includes(error?.name)) {
        result = await session.prompt(prompt, { signal });
      } else if (error?.name === 'NotAllowedError') {
        throw new Error('Gemini Nano 모델 다운로드를 시작하려면 버튼을 다시 눌러 주세요.');
      } else {
        throw error;
      }
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return String(result || '');
  } finally {
    session?.destroy?.();
  }
}

async function createGeminiSession(model, systemPrompt, signal) {
  let session;
  let systemPromptEmbedded = false;
  if (typeof model.create === 'function') {
    try {
      session = await model.create({
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        signal
      });
      systemPromptEmbedded = true;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      session = await model.create({ systemPrompt, signal });
      systemPromptEmbedded = true;
    }
  } else if (typeof model.createTextSession === 'function') {
    session = await model.createTextSession();
  }
  if (!session?.prompt) throw new Error('Gemini Nano 세션을 만들 수 없습니다.');
  return { session, systemPromptEmbedded };
}

function formatGeminiPrompt(prompts, systemPromptEmbedded) {
  return systemPromptEmbedded
    ? prompts.user
    : `System:\n${prompts.system}\n\nUser:\n${prompts.user}`;
}

function parseEditingResponse(raw, originalText, action) {
  const cleaned = stripCodeFence(String(raw || '').trim());
  let parsed;
  try {
    parsed = JSON.parse(extractJSONObject(cleaned));
  } catch {
    if (!cleaned) throw new Error('AI가 빈 응답을 반환했습니다.');
    parsed = { corrected_text: cleaned, suggestions: [] };
  }

  const suggestions = normalizeSuggestions(parsed?.suggestions, originalText);
  let correctedText = String(
    parsed?.corrected_text ?? parsed?.correctedText ?? parsed?.enhanced_text ?? ''
  );

  if (action === 'spellcheck' && suggestions.length) {
    correctedText = applySuggestions(originalText, suggestions);
  } else {
    correctedText = sanitizeEditingText(correctedText, originalText);
  }
  if (!correctedText.trim()) correctedText = originalText;
  return { correctedText, suggestions };
}

function sanitizeEditingText(value, originalText) {
  const allowedMediaTokens = new Set(
    String(originalText || '').match(/\[\[AIANG_MEDIA_[^\]\r\n]+\]\]/g) || []
  );
  return String(value || '')
    .replace(/<before_context\b[^>]*>[\s\S]*?<\/before_context\s*>/gi, '')
    .replace(/<after_context\b[^>]*>[\s\S]*?<\/after_context\s*>/gi, '')
    .replace(/<\/?(?:content|before_context|after_context)\b[^>]*>/gi, '')
    .replace(/\[\[AIANG_MEDIA_[^\]\r\n]+\]\]/g, token => (
      allowedMediaTokens.has(token) ? token : ''
    ))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTitleSuggestions(raw) {
  const cleaned = stripCodeFence(String(raw || '').trim());
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(extractJSONObject(cleaned));
    } catch {
      parsed = null;
    }
  }

  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.titles)
      ? parsed.titles
      : Array.isArray(parsed?.suggestions)
        ? parsed.suggestions
        : cleaned.split(/\r?\n/);
  const seen = new Set();
  const titles = [];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string'
      ? candidate
      : candidate?.title || candidate?.text || candidate?.name || '';
    const title = String(value)
      .replace(/^\s*(?:(?:[-*•])|(?:\d+[.)])|(?:제목\s*\d+\s*[:.)-]))\s*/i, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const key = title.toLocaleLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === 5) break;
  }
  if (titles.length < 5) {
    throw new Error('AI가 제목 5개를 생성하지 못했습니다. 다시 시도해 주세요.');
  }
  return titles;
}

function parsePostSummary(raw) {
  const cleaned = stripCodeFence(String(raw || '').trim());
  let summary = cleaned;
  try {
    const parsed = JSON.parse(extractJSONObject(cleaned));
    summary = String(parsed?.summary ?? parsed?.summary_text ?? parsed?.text ?? cleaned);
  } catch {
    // Plain-text responses are the expected summary format.
  }
  summary = summary.trim();
  if (!summary) throw new Error('AI가 빈 요약을 반환했습니다. 다시 시도해 주세요.');
  return summary;
}

function parseGeneratedComment(raw) {
  const cleaned = stripCodeFence(String(raw || '').trim());
  let comment = cleaned;
  try {
    const parsed = JSON.parse(extractJSONObject(cleaned));
    comment = String(parsed?.comment ?? parsed?.text ?? cleaned);
  } catch {
    // Plain text remains usable for models that do not follow the JSON request.
  }
  comment = comment
    .replace(/^\s*(?:댓글\s*[:：]\s*)/i, '')
    .replace(/^(["'“”‘’])([\s\S]*)\1$/, '$2')
    .trim();
  if (!comment) throw new Error('AI가 빈 댓글을 반환했습니다. 다시 시도해 주세요.');
  if (comment.length > 2000) throw new Error('AI가 지나치게 긴 댓글을 반환했습니다. 다시 시도해 주세요.');
  return comment;
}

function parseTermGlossary(raw) {
  const cleaned = stripCodeFence(String(raw || '').trim());
  let glossary = cleaned;
  try {
    const parsed = JSON.parse(extractJSONObject(cleaned));
    glossary = String(parsed?.glossary ?? parsed?.content ?? parsed?.text ?? cleaned);
  } catch {
    // Markdown plain text is the expected glossary format.
  }
  glossary = glossary.trim();
  if (!glossary) throw new Error('AI가 빈 용어 사전을 반환했습니다. 다시 시도해 주세요.');
  return glossary;
}

function stripCodeFence(value) {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
}

function extractJSONObject(value) {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

function normalizeSuggestions(input, content) {
  if (!Array.isArray(input)) return [];
  const normalized = [];
  const seen = new Set();
  for (const item of input) {
    const original = String(item?.original || '');
    const replacement = String(item?.replacement || '');
    let start = Number(item?.start);
    let end = Number(item?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || content.slice(start, end) !== original) {
      start = recoverSuggestionStart(content, original, Number(item?.start));
      end = start >= 0 ? start + original.length : -1;
    }
    if (!original || !replacement || original === replacement) continue;
    if (start < 0 || end <= start || content.slice(start, end) !== original) continue;
    const key = `${start}:${end}:${replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      original,
      replacement,
      start,
      end,
      reason: String(item?.reason || '').trim()
    });
  }
  return normalized.sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((item, index, list) => index === 0 || item.start >= list[index - 1].end);
}

function recoverSuggestionStart(content, original, hint) {
  if (!original) return -1;
  const matches = [];
  let index = content.indexOf(original);
  while (index >= 0) {
    matches.push(index);
    index = content.indexOf(original, index + Math.max(1, original.length));
  }
  if (!matches.length) return -1;
  if (matches.length === 1 || !Number.isFinite(hint)) return matches[0];
  return matches.reduce((best, next) => Math.abs(next - hint) < Math.abs(best - hint) ? next : best);
}

function applySuggestions(content, suggestions) {
  let result = content;
  for (const suggestion of [...suggestions].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, suggestion.start) + suggestion.replacement + result.slice(suggestion.end);
  }
  return result;
}

async function testConnection(settings) {
  if (settings.provider === 'gemini') {
    const model = getLanguageModelAPI();
    if (!model) throw new Error('Gemini Nano Prompt API를 찾지 못했습니다.');
    const availability = await getGeminiAvailability(model);
    if (['no', 'unavailable'].includes(availability)) throw new Error('이 기기에서는 Gemini Nano를 사용할 수 없습니다.');
    return {
      message: ['after-download', 'downloadable', 'downloading'].includes(availability)
        ? 'Gemini Nano를 사용할 수 있으며, 첫 실행 때 모델을 내려받습니다.'
        : 'Gemini Nano를 사용할 수 있습니다.'
    };
  }
  const models = await listModels(settings);
  return { message: `연결되었습니다${models.length ? ` · 모델 ${models.length}개` : ''}.`, models };
}

async function listModels(settings) {
  if (settings.provider === 'gemini') return [];
  const response = await fetch(`${settings.endpoint}/models`, {
    headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
  });
  if (!response.ok) throw await createHTTPError(response);
  const data = await response.json();
  const items = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
          ? data
          : [];
  return [...new Set(items
    .map(item => typeof item === 'string' ? item : item?.id || item?.name || item?.model || item?.model_id)
    .map(name => String(name || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}
