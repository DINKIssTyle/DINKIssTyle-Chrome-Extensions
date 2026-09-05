const $ = selector => document.querySelector(selector);

const form = $('#settings-form');
const enabled = $('#enabled');
const provider = $('#provider');
const endpoint = $('#endpoint');
const apiKey = $('#api-key');
const model = $('#model');
const modelList = $('#model-list');
const modelMenu = $('#model-menu');
const temperature = $('#temperature');
const temperatureAuto = $('#temperature-auto');
const personalization = $('#personalization');
const personalizationCount = $('#personalization-count');
const openAIFields = $('#openai-fields');
const geminiNote = $('#gemini-note');
const geminiFields = $('#gemini-fields');
const geminiKeepAlive = $('#gemini-keep-alive');
const status = $('#status');
const testButton = $('#test');
const loadModelsButton = $('#load-models');
const toggleKeyButton = $('#toggle-key');
const fontSizeModeDamoang = $('#font-size-mode-damoang');
const fontSizeModeCustom = $('#font-size-mode-custom');
const customFontSizeWrap = $('#custom-font-size-wrap');
const usePostImageCapture = $('#use-post-image-capture');
const getFontSizeCustomInputs = () => document.querySelectorAll('input[name="font-size-custom"]');
const builtinModelTitle = $('#builtin-model-title');
const builtinModelBadge = $('#builtin-model-badge');
const builtinModelDesc = $('#builtin-model-desc');
const builtinDownloadProgressWrap = $('#builtin-download-progress-wrap');
const builtinDownloadBar = $('#builtin-download-bar');
const builtinDownloadPercent = $('#builtin-download-percent');
const builtinDownloadBytes = $('#builtin-download-bytes');
const startBuiltinDownloadButton = $('#start-builtin-download');
let loadedModels = [];

document.addEventListener('DOMContentLoaded', loadSettings);
provider.addEventListener('change', updateProviderUI);
temperatureAuto.addEventListener('change', updateTemperatureUI);
personalization.addEventListener('input', updatePersonalizationCount);
fontSizeModeDamoang.addEventListener('change', updateFontSizeUI);
fontSizeModeCustom.addEventListener('change', updateFontSizeUI);
model.addEventListener('focus', () => renderModelMenu(model.value));
model.addEventListener('input', () => renderModelMenu(model.value));
model.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModelMenu();
});

if (startBuiltinDownloadButton) {
  startBuiltinDownloadButton.addEventListener('click', async () => {
    startBuiltinDownloadButton.disabled = true;
    startBuiltinDownloadButton.textContent = '다운로드 시작 중...';
    if (builtinDownloadProgressWrap) builtinDownloadProgressWrap.hidden = false;
    if (builtinDownloadBar) builtinDownloadBar.style.width = '0%';
    if (builtinDownloadPercent) builtinDownloadPercent.textContent = '0%';
    if (builtinDownloadBytes) builtinDownloadBytes.textContent = '연결 준비 중...';
    showStatus('모델 다운로드를 요청하고 있습니다...', 'info');

    try {
      // Start downloads in this visible document while the button's user activation is live.
      const api = globalThis.LanguageModel || globalThis.chrome?.aiOriginTrial?.languageModel || globalThis.ai?.languageModel || globalThis.ai?.assistant;
      let response;
      if (typeof api?.create === 'function') {
        const session = await api.create({
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', event => {
              const loaded = Number(event.loaded) || 0;
              const total = Number(event.total) || 1;
              renderBuiltInDownloadProgress({ loaded, total, percent: Math.min(100, Math.round(loaded / total * 100)) });
            });
          }
        });
        session.destroy?.();
        response = { ok: true, message: '모델 다운로드가 완료되었습니다.' };
      } else {
        response = await sendMessage({ type: 'START_BUILTIN_AI_DOWNLOAD' });
      }
      if (!response?.ok) throw new Error(response?.error || '다운로드를 시작하지 못했습니다.');
      showStatus(response.message || '다운로드가 완료되었습니다!', 'success');
      await refreshBuiltInModelStatus();
    } catch (error) {
      showStatus(error?.message || '다운로드 실패', 'error');
      await refreshBuiltInModelStatus();
    } finally {
      startBuiltinDownloadButton.disabled = false;
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BUILTIN_AI_DOWNLOAD_PROGRESS' && message.progress) {
      if (builtinModelBadge) {
        builtinModelBadge.className = 'status-badge downloading';
        builtinModelBadge.textContent = '다운로드 중...';
      }
      if (startBuiltinDownloadButton) {
        startBuiltinDownloadButton.disabled = true;
        startBuiltinDownloadButton.textContent = '다운로드 중...';
      }
      renderBuiltInDownloadProgress(message.progress);
      if (message.progress.percent >= 100) {
        setTimeout(refreshBuiltInModelStatus, 1200);
      }
    }
  });
}
modelMenu.addEventListener('click', event => {
  const option = event.target.closest('.model-option');
  if (!option) return;
  model.value = option.dataset.model || '';
  model.focus();
  closeModelMenu();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.model-control')) closeModelMenu();
});

document.addEventListener('click', async event => {
  const flagLink = event.target.closest('#edge-flags-link, .flags-link');
  if (flagLink) {
    event.preventDefault();
    const url = flagLink.getAttribute('href') || 'edge://flags/#edge-llm-prompt-api-for-phi-mini';
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create({ url });
        showStatus('플래그 주소를 열었습니다. (주소 클립보드 복사 완료)', 'success');
      } else {
        window.open(url, '_blank');
        showStatus('플래그 주소가 클립보드에 복사되었습니다. 새 탭 주소창에 붙여넣어 이동하세요.', 'success');
      }
    } catch (_) {
      showStatus('플래그 주소가 클립보드에 복사되었습니다. 새 탭 주소창에 붙여넣어 이동하세요.', 'success');
    }
  }
});

toggleKeyButton.addEventListener('click', () => {
  const reveal = apiKey.type === 'password';
  apiKey.type = reveal ? 'text' : 'password';
  toggleKeyButton.textContent = reveal ? '숨기기' : '보기';
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  setBusy(true, '저장하는 중…');
  try {
    const settings = collectSettings();
    if (settings.usePostImageCapture) {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (!granted) throw new Error('본문 미디어 캡쳐를 사용하려면 브라우저의 화면 캡쳐 접근 권한이 필요합니다.');
    }
    await ensureEndpointPermission(settings);
    const response = await sendMessage({ type: 'SAVE_SETTINGS', settings });
    if (!response?.ok) throw new Error(response?.error || '설정을 저장하지 못했습니다.');
    showStatus('설정을 저장했습니다.', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

testButton.addEventListener('click', async () => {
  setBusy(true, '연결을 확인하는 중…');
  try {
    const settings = collectSettings();
    await ensureEndpointPermission(settings);
    const response = await sendMessage({ type: 'TEST_CONNECTION', settings });
    if (!response?.ok) throw new Error(response?.error || '연결하지 못했습니다.');
    updateModelList(response.models || []);
    showStatus(response.message || '연결되었습니다.', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

loadModelsButton.addEventListener('click', async () => {
  setBusy(true, '모델을 불러오는 중…');
  try {
    const settings = collectSettings();
    await ensureEndpointPermission(settings);
    const response = await sendMessage({ type: 'LIST_MODELS', settings });
    if (!response?.ok) throw new Error(response?.error || '모델 목록을 불러오지 못했습니다.');
    const count = updateModelList(response.models || [], { open: true });
    if (!count) throw new Error('서버가 모델 목록을 반환하지 않았습니다. API 주소와 /v1/models 지원 여부를 확인해 주세요.');
    showStatus(`모델 ${count}개를 불러왔습니다. 목록에서 사용할 모델을 선택하세요.`, 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

function isEdgeBrowser() {
  return (navigator.userAgent || '').includes('Edg/');
}

function applyBrowserBranding() {
  if (!isEdgeBrowser()) return;
  const eyebrow = document.querySelector('.hero .eyebrow');
  if (eyebrow) eyebrow.textContent = 'Damoang writing assistant for Edge';

  const aiDesc = document.getElementById('ai-connect-description');
  if (aiDesc) aiDesc.textContent = 'LM Studio 같은 OpenAI 호환 서버 또는 Edge 내장 AI(Aion-1.0 / Phi-4)를 선택하세요.';

  const geminiOption = document.getElementById('provider-gemini-option');
  if (geminiOption) geminiOption.textContent = 'Microsoft Edge 내장 AI · Aion / Phi-4';

  const keepAliveTitle = document.getElementById('gemini-keep-alive-title');
  if (keepAliveTitle) keepAliveTitle.textContent = 'Edge 온디바이스 AI 메모리 상주 (빠른 응답)';

  const modelTitle = document.getElementById('builtin-model-title');
  if (modelTitle) modelTitle.textContent = 'Edge 온디바이스 AI 모델 상태';

  const note = document.getElementById('gemini-note');
  if (note) {
    note.innerHTML = '<strong>Edge 온디바이스 AI(Aion-1.0-Instruct / Phi-4-mini) 안내</strong><br>' +
      'Edge Canary 및 Dev 채널에서 내장 AI 모델을 실행할 수 있습니다.<br><br>' +
      '<b>1. 필수 플래그 활성화:</b><br>' +
      '• <a href="edge://flags/#edge-llm-prompt-api-for-phi-mini" class="flags-link" id="edge-flags-link" title="클릭하여 열기 및 주소 복사"><code>edge://flags/#edge-llm-prompt-api-for-phi-mini</code></a> → <code>Enabled</code><br><br>' +
      '<b>2. 다운로드 완료 후 브라우저 재시작:</b><br>' +
      '• 모델 다운로드가 끝난 후 반드시 Edge를 재시작해야 모델이 마운트됩니다: <a href="edge://restart" class="flags-link" title="클릭하여 브라우저 재시작"><code>edge://restart</code></a><br><br>' +
      '<b>3. 다운로드 후 "기기에서 이용할 수 없음" 오류 시 해결 방법:</b><br>' +
      '• <em>기본 Phi-4-mini 모델은 외장 GPU VRAM 5.5GB 이상을 요구합니다.</em> 내장 그래픽 또는 VRAM 부족 시 아래 둘 중 하나를 설정하세요:<br>' +
      '  - <b>사양 제한 우회:</b> <a href="edge://flags/#optimization-guide-on-device-model" class="flags-link" title="클릭하여 열기 및 주소 복사"><code>edge://flags/#optimization-guide-on-device-model</code></a> → <code>Enabled BypassPerfRequirement</code> 선택 후 재시작<br>' +
      '  - <b>경량 CPU 지원 모델(Aion-1.0):</b> <a href="edge://flags/#edge-prerelease-on-device-language-model" class="flags-link" title="클릭하여 열기 및 주소 복사"><code>edge://flags/#edge-prerelease-on-device-language-model</code></a> → <code>Enabled</code> 선택 후 재시작<br><br>' +
      '<b>4. 기기 성능 등급 및 모델 로드 상태 확인:</b><br>' +
      '• <a href="edge://on-device-internals" class="flags-link" title="클릭하여 열기 및 주소 복사"><code>edge://on-device-internals</code></a> 에서 Performance Class와 Model Status 확인 가능';
  }
}

async function loadSettings() {
  applyBrowserBranding();
  try {
    const response = await sendMessage({ type: 'GET_SETTINGS_FULL' });
    if (!response?.ok) throw new Error(response?.error || '설정을 불러오지 못했습니다.');
    const settings = response.settings;
    enabled.checked = settings.enabled;
    provider.value = settings.provider;
    endpoint.value = settings.endpoint;
    apiKey.value = settings.apiKey;
    model.value = settings.model;
    temperature.value = settings.temperature;
    temperatureAuto.checked = settings.temperatureAuto;
    personalization.value = settings.personalization;
    if (settings.fontSizeMode === 'custom') {
      fontSizeModeCustom.checked = true;
    } else {
      fontSizeModeDamoang.checked = true;
    }
    const customSize = settings.fontSizeCustom || 'medium';
    const targetCustomInput = document.querySelector(`input[name="font-size-custom"][value="${customSize}"]`);
    if (targetCustomInput) targetCustomInput.checked = true;
    if (geminiKeepAlive) geminiKeepAlive.checked = settings.geminiKeepAlive === true;
    if (usePostImageCapture) usePostImageCapture.checked = settings.usePostImageCapture === true;
    updateProviderUI();
    updateTemperatureUI();
    updatePersonalizationCount();
    updateFontSizeUI();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function collectSettings() {
  return {
    enabled: enabled.checked,
    provider: provider.value,
    endpoint: endpoint.value,
    apiKey: apiKey.value,
    model: model.value,
    temperature: temperature.value,
    temperatureAuto: temperatureAuto.checked,
    personalization: personalization.value,
    fontSizeMode: fontSizeModeCustom.checked ? 'custom' : 'damoang',
    fontSizeCustom: document.querySelector('input[name="font-size-custom"]:checked')?.value || 'medium',
    geminiKeepAlive: Boolean(geminiKeepAlive?.checked),
    usePostImageCapture: Boolean(usePostImageCapture?.checked)
  };
}

function updateProviderUI() {
  const isGemini = provider.value === 'gemini';
  openAIFields.hidden = isGemini;
  if (geminiFields) {
    geminiFields.hidden = !isGemini;
  } else if (geminiNote) {
    geminiNote.hidden = !isGemini;
  }
  if (isGemini) {
    refreshBuiltInModelStatus().catch(() => {});
  }
}

async function refreshBuiltInModelStatus() {
  if (provider.value !== 'gemini') return;
  try {
    const response = await sendMessage({ type: 'GET_BUILTIN_AI_STATUS' });
    if (!response?.ok) return;
    updateBuiltInModelStatusUI(response);
  } catch (_) {}
}

function updateBuiltInModelStatusUI(data) {
  if (!builtinModelBadge || !builtinModelDesc) return;
  const isEdge = data.isEdge || isEdgeBrowser();
  const modelName = data.modelName || (isEdge ? 'Edge 온디바이스 AI' : 'Gemini Nano');

  if (builtinModelTitle) {
    builtinModelTitle.textContent = `${modelName} 상태`;
  }

  builtinModelBadge.className = 'status-badge';

  if (data.status === 'ready') {
    builtinModelBadge.classList.add('ready');
    builtinModelBadge.textContent = '준비 완료 (사용 가능)';
    builtinModelDesc.textContent = `${modelName}가 정상적으로 설치되어 즉시 동작 가능합니다.`;
    if (startBuiltinDownloadButton) {
      startBuiltinDownloadButton.textContent = '재확인';
      startBuiltinDownloadButton.disabled = false;
    }
    if (builtinDownloadProgressWrap) builtinDownloadProgressWrap.hidden = true;
  } else if (data.status === 'downloading') {
    builtinModelBadge.classList.add('downloading');
    builtinModelBadge.textContent = '다운로드 중...';
    builtinModelDesc.textContent = `${modelName} 모델 파일을 브라우저로 내려받고 있습니다.`;
    if (startBuiltinDownloadButton) {
      startBuiltinDownloadButton.textContent = '다운로드 중...';
      startBuiltinDownloadButton.disabled = true;
    }
    if (builtinDownloadProgressWrap) {
      builtinDownloadProgressWrap.hidden = false;
      if (data.lastProgress) renderBuiltInDownloadProgress(data.lastProgress);
    }
  } else if (data.status === 'downloadable') {
    builtinModelBadge.classList.add('needed');
    builtinModelBadge.textContent = '다운로드 필요';
    builtinModelDesc.textContent = `${modelName} 모델을 아직 내려받지 않았습니다. [모델 다운로드]를 눌러 미리 설치할 수 있습니다.`;
    if (startBuiltinDownloadButton) {
      startBuiltinDownloadButton.textContent = '모델 다운로드';
      startBuiltinDownloadButton.disabled = false;
    }
    if (builtinDownloadProgressWrap) builtinDownloadProgressWrap.hidden = true;
  } else {
    builtinModelBadge.classList.add('unavailable');
    builtinModelBadge.textContent = '설정 또는 사양 확인 필요';
    builtinModelDesc.textContent = data.message || '현재 브라우저 상태에서는 모델을 사용할 수 없습니다.';
    if (startBuiltinDownloadButton) {
      startBuiltinDownloadButton.textContent = '다운로드 시도';
      startBuiltinDownloadButton.disabled = false;
    }
    if (builtinDownloadProgressWrap) builtinDownloadProgressWrap.hidden = true;
  }
}

function renderBuiltInDownloadProgress(progress) {
  if (!builtinDownloadProgressWrap) return;
  builtinDownloadProgressWrap.hidden = false;
  const percent = Math.min(100, Math.max(0, Number(progress?.percent) || 0));
  if (builtinDownloadBar) {
    builtinDownloadBar.style.width = `${percent}%`;
  }
  if (builtinDownloadPercent) {
    builtinDownloadPercent.textContent = `${percent}%`;
  }
  if (builtinDownloadBytes) {
    const loaded = Number(progress?.loaded) || 0;
    const total = Number(progress?.total) || 0;
    if (total > 0) {
      const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
      const totalMB = (total / (1024 * 1024)).toFixed(1);
      builtinDownloadBytes.textContent = `${loadedMB} MB / ${totalMB} MB`;
    } else if (loaded > 0) {
      const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
      builtinDownloadBytes.textContent = `${loadedMB} MB`;
    } else {
      builtinDownloadBytes.textContent = '진행률 계산 중...';
    }
  }
}

function updateTemperatureUI() {
  temperature.disabled = temperatureAuto.checked;
}

function updateFontSizeUI() {
  const isCustom = fontSizeModeCustom.checked;
  const control = customFontSizeWrap?.querySelector('.segmented-control');
  if (control) control.classList.toggle('is-disabled', !isCustom);
  getFontSizeCustomInputs().forEach(input => {
    input.disabled = !isCustom;
  });
}

function updatePersonalizationCount() {
  personalizationCount.textContent = String(personalization.value.length);
}

function updateModelList(models, { open = false } = {}) {
  loadedModels = [...new Set(models.map(name => String(name || '').trim()).filter(Boolean))];
  modelList.replaceChildren(...loadedModels.map(name => {
    const option = document.createElement('option');
    option.value = name;
    return option;
  }));
  if (open) renderModelMenu('');
  else closeModelMenu();
  return loadedModels.length;
}

function renderModelMenu(query = '') {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const matches = loadedModels.filter(name => !normalizedQuery || name.toLocaleLowerCase().includes(normalizedQuery));
  modelMenu.replaceChildren(...matches.map(name => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'model-option';
    option.dataset.model = name;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(name === model.value));
    option.textContent = name;
    return option;
  }));
  modelMenu.hidden = matches.length === 0;
  model.setAttribute('aria-expanded', String(matches.length > 0));
}

function closeModelMenu() {
  modelMenu.hidden = true;
  model.setAttribute('aria-expanded', 'false');
}

async function ensureEndpointPermission(settings) {
  if (settings.provider !== 'openai') return;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(settings.endpoint) ? settings.endpoint : `http://${settings.endpoint}`);
  } catch {
    throw new Error('올바른 API 주소를 입력해 주세요.');
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
  // Chrome match patterns do not include a port. A hostname pattern covers all ports.
  const pattern = `${url.protocol}//${url.hostname}/*`;
  const granted = await chrome.permissions.contains({ origins: [pattern] })
    || await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error('선택한 AI 서버에 연결하려면 사이트 접근 권한이 필요합니다.');
}

function setBusy(busy, message = '') {
  [testButton, loadModelsButton, form.querySelector('[type="submit"]')].forEach(button => button.disabled = busy);
  if (busy) showStatus(message);
}

function showStatus(message, kind = '') {
  status.textContent = message;
  status.className = kind;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}
