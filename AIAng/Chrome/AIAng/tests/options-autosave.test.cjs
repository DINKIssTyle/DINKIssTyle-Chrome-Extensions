const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

test('option selections persist immediately, move the live launcher, and leave typed drafts unsaved', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE, timeout: 60000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.AIANG_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const options = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const errors = [];
    options.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/tests/floating-assistant-fixture.html');
    const launcher = page.locator('.aiang-floating-launcher');
    await launcher.waitFor();
    const baseline = await launcher.boundingBox();
    let stored = { enabled: true, provider: 'openai', endpoint: 'http://localhost:1234/v1', apiKey: 'saved-key', model: 'saved-model', temperature: 0.7, temperatureAuto: false, personalization: 'saved note', fontSizeMode: 'damoang', fontSizeCustom: 'medium', floatingAssistantEnabled: true, floatingAssistantPosition: 'right', floatingAssistantHeight: 'default', floatingAssistantSize: 'large', usePostImageCapture: false, geminiKeepAlive: false };
    const messages = [];
    let failNext = false;
    await options.exposeFunction('settingsMessage', async message => {
      messages.push(message);
      if (message.type === 'PATCH_SETTINGS' || message.type === 'SAVE_SETTINGS') {
        // Delayed writes exercise ordering during rapid selection changes.
        await new Promise(resolve => setTimeout(resolve, 30));
        if (failNext) { failNext = false; return { ok: false, error: '저장 실패 테스트' }; }
        stored = { ...stored, ...message.settings };
        await page.evaluate(values => setSettings(values), message.settings);
      }
      if (message.type === 'LIST_MODELS') return { ok: true, models: ['selected-model'] };
      return { ok: true, settings: { ...stored } };
    });
    await options.addInitScript(() => {
      window.allowCapture = true;
      window.chrome = {
        runtime: { onMessage: { addListener() {} }, sendMessage(message, callback) { window.settingsMessage(message).then(callback); } },
        permissions: { contains: async () => true, request: async () => window.allowCapture }
      };
    });
    await options.goto(origin + '/options.html');
    await options.waitForFunction(() => document.querySelector('#api-key').value === 'saved-key');
    await options.locator('#api-key').fill('unsaved-key');
    await options.locator('#endpoint').fill('http://draft.invalid/v1');
    await options.locator('#personalization').fill('unsaved note');
    const choose = async (name, value) => options.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
    const settled = async () => options.evaluate(() => saveQueue);
    const floating = options.locator('.card').filter({ has: options.getByRole('heading', { name: '플로팅 AI 지원', exact: true }) });
    for (const [height, rise] of [['slight', 48], ['high', 96], ['default', 0]]) {
      await choose('floating-assistant-height', height); await settled();
      await page.waitForFunction(height => document.querySelector('.aiang-floating').dataset.height === height, height);
      assert.equal((await launcher.boundingBox()).y, baseline.y - rise);
      assert.equal(stored.floatingAssistantHeight, height);
    }
    await choose('floating-assistant-position', 'center');
    await choose('floating-assistant-height', 'high');
    await settled();
    assert.equal(stored.floatingAssistantPosition, 'center');
    await choose('floating-assistant-size', 'small'); await settled();
    assert.equal(stored.floatingAssistantSize, 'small');
    await options.locator('#provider').selectOption('gemini'); await settled();
    assert.equal(stored.provider, 'gemini');
    assert.equal(await options.locator('#openai-fields').isHidden(), true);
    await options.locator('#gemini-keep-alive').check(); await settled();
    assert.equal(stored.geminiKeepAlive, true);
    await options.locator('#provider').selectOption('openai'); await settled();
    await options.locator('#temperature-auto').check(); await settled();
    assert.equal(stored.temperatureAuto, true);
    assert.equal(stored.temperature, 0.7);
    await options.locator('#font-size-mode-custom').check();
    await choose('font-size-custom', 'large'); await settled();
    assert.equal(stored.fontSizeCustom, 'large');
    assert.equal(stored.fontSizeMode, 'custom');
    await options.locator('#enabled').uncheck(); await settled();
    await launcher.waitFor({ state: 'detached' });
    await options.locator('#enabled').check(); await settled(); await launcher.waitFor();
    assert.equal(stored.apiKey, 'saved-key');
    assert.equal(stored.endpoint, 'http://localhost:1234/v1');
    assert.equal(stored.personalization, 'saved note');
    assert.equal(await options.locator('#api-key').inputValue(), 'unsaved-key');
    assert.equal(messages.filter(m => m.type === 'SAVE_SETTINGS').length, 0);
    assert.ok(messages.filter(m => m.type === 'PATCH_SETTINGS').every(m => Object.keys(m.settings).length === 1));
    await options.evaluate(() => { window.allowCapture = false; });
    await options.locator('#use-post-image-capture').check(); await settled();
    assert.equal(stored.usePostImageCapture, false);
    assert.equal(await options.locator('#use-post-image-capture').isChecked(), false);
    await options.evaluate(() => { window.allowCapture = true; });
    await options.locator('#use-post-image-capture').check(); await settled();
    assert.equal(stored.usePostImageCapture, true);
    failNext = true;
    await choose('floating-assistant-height', 'slight'); await settled();
    assert.equal(stored.floatingAssistantHeight, 'high');
    assert.equal(await options.locator('input[name="floating-assistant-height"][value="high"]').isChecked(), true);
    assert.match(await floating.locator('.selection-status').textContent(), /저장 실패/);
    // A later choice still saves after an error; rapid changes finish in click order.
    await choose('floating-assistant-height', 'default');
    await choose('floating-assistant-height', 'slight');
    await choose('floating-assistant-height', 'high'); await settled();
    assert.equal(stored.floatingAssistantHeight, 'high');
    await options.locator('#load-models').click();
    await options.locator('.model-option').click(); await settled();
    assert.equal(stored.model, 'selected-model');
    assert.equal(stored.apiKey, 'saved-key');
    await options.locator('#save-provider').click();
    await options.waitForFunction(() => document.querySelector('#status').textContent === 'AI 제공자 설정을 저장했습니다.');
    assert.equal(stored.apiKey, 'unsaved-key');
    await options.locator('#save-personalization').click();
    await options.waitForFunction(() => document.querySelector('#status').textContent === '개인화 설정을 저장했습니다.');
    assert.equal(stored.personalization, 'unsaved note');
    assert.equal(stored.floatingAssistantHeight, 'high');
    for (const width of [900, 390]) {
      await options.setViewportSize({ width, height: 1000 });
      const fields = floating.locator('.floating-settings-fields > *');
      const rects = await fields.evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
      assert.ok(rects[1].top - rects[0].bottom >= 24);
      assert.ok(rects[2].top - rects[1].bottom >= 24);
      assert.equal(await floating.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await floating.screenshot({ path: `/private/tmp/aiang-settings-spacing-${width}.png` });
    }
    await options.reload();
    await options.waitForFunction(() => document.querySelector('#api-key').value === 'unsaved-key');
    assert.equal(await options.locator('input[name="floating-assistant-height"][value="high"]').isChecked(), true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
