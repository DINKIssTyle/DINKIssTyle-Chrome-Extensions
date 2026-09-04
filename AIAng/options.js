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
const status = $('#status');
const testButton = $('#test');
const loadModelsButton = $('#load-models');
const toggleKeyButton = $('#toggle-key');
const fontSizeModeDamoang = $('#font-size-mode-damoang');
const fontSizeModeCustom = $('#font-size-mode-custom');
const customFontSizeWrap = $('#custom-font-size-wrap');
const getFontSizeCustomInputs = () => document.querySelectorAll('input[name="font-size-custom"]');
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

async function loadSettings() {
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
    fontSizeCustom: document.querySelector('input[name="font-size-custom"]:checked')?.value || 'medium'
  };
}

function updateProviderUI() {
  const isGemini = provider.value === 'gemini';
  openAIFields.hidden = isGemini;
  geminiNote.hidden = !isGemini;
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
