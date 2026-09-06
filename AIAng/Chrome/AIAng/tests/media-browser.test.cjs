const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

// Optional integration suite: AIANG_PLAYWRIGHT_MODULE points to an installed playwright package.
test('rendered media detection, cropped captures, cancellation, and local Korean/English OCR', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE,
  timeout: 120000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      if (file.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
      if (file.endsWith('offscreen.html')) {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Security-Policy', "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
      }
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.AIANG_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    const externalRequests = [];
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin) || route.request().url().startsWith('data:')) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + '/tests/modal-font-size-fixture.html');
    await page.setContent('<style>body{margin:0}img,iframe,blockquote{display:block;width:400px;height:200px;margin:0} .aiang-overlay{position:fixed;inset:0;background:lime}</style><article id="article"><p>본문만 있는 게시물입니다.</p></article>');
    const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const exclusion = source.slice(source.indexOf('  const ARTICLE_CONTENT_EXCLUDE_SELECTOR'), source.indexOf('  const COMMENT_ROOT_SELECTORS'));
    const functions = source.slice(source.indexOf('  function findArticleMediaElements'), source.indexOf('  async function runPostSummary'));
    let captures = 0;
    await page.exposeFunction('sendMessage', async message => {
      assert.equal(message.type, 'CAPTURE_TAB_VIEWPORT'); captures++;
      return { ok: true, dataUrl: 'data:image/png;base64,' + (await page.screenshot()).toString('base64') };
    });
    await page.addScriptTag({ content: exclusion + functions + '\nfunction showToast() {}' });
    assert.deepEqual(await page.evaluate(() => findArticleMediaElements(document.querySelector('#article')).map(el => el.id)), []);
    assert.deepEqual(await page.evaluate(() => captureArticleMediaSnippets(document.querySelector('#article'))), []);
    assert.equal(captures, 0);
    await page.evaluate(() => {
      const article = document.querySelector('#article');
      article.innerHTML = '<img id="photo"><iframe id="youtube" src="https://www.youtube-nocookie.com/embed/test"></iframe><blockquote id="tweet" class="twitter-tweet"><iframe src="https://platform.twitter.com/embed/test"></iframe></blockquote><blockquote id="instagram" class="instagram-media"></blockquote><iframe id="external" src="https://example.org/embed"></iframe><iframe id="same" src="/local"></iframe><img id="hidden" hidden><div class="comments"><img></div><img id="icon" style="width:16px;height:16px">';
    });
    assert.deepEqual(await page.evaluate(() => findArticleMediaElements(document.querySelector('#article')).map(el => el.id)), ['photo', 'youtube', 'tweet', 'instagram', 'external']);
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 1200;
      const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 400, 600); context.fillStyle = 'blue'; context.fillRect(0, 600, 400, 600);
      document.querySelector('#article').innerHTML = '<div style="height:800px"></div><img id="tall" style="height:1200px"><div style="height:800px"></div>';
      document.querySelector('#tall').src = canvas.toDataURL();
      document.body.insertAdjacentHTML('beforeend', '<div class="aiang-overlay"></div>');
      window.scrollTo(0, 200);
    });
    const screenshots = await page.evaluate(() => captureArticleMediaSnippets(document.querySelector('#article')));
    assert.equal(screenshots.length, 1, 'three scroll captures of one media element become one attachment');
    assert.equal(await page.evaluate(() => window.scrollY), 200);
    assert.equal(await page.locator('.aiang-overlay').evaluate(el => el.style.visibility), '');
    const pixels = await page.evaluate(async urls => {
      return await Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, first: Array.from(context.getImageData(20, 20, 1, 1).data), bottom: Array.from(context.getImageData(20, image.height - 20, 1, 1).data), seam: Array.from(context.getImageData(20, 540, 1, 1).data) };
      }));
    }, screenshots);
    assert.deepEqual(pixels.map(p => [p.width, p.height]), [[400, 1200]]);
    assert.ok(pixels[0].first[0] > 240 && pixels[0].first[1] < 10, 'overlay excluded; first tile is red');
    assert.ok(pixels[0].bottom[2] > 240, 'single attachment includes the blue bottom');
    assert.ok(pixels[0].seam[0] > 240 && pixels[0].seam[1] < 10, 'no white gap at the scroll stitch');
    await assert.rejects(page.evaluate(() => captureArticleMediaSnippets(document.querySelector('#article'), () => true)), /취소/);
    assert.equal(captures, 3);
    // The real chat modal fixes the body in place. Capture must temporarily unlock it.
    const modalFunction = source.slice(source.indexOf('  function showModalPanel'), source.indexOf('  function createTextCard'));
    await page.addScriptTag({ content: 'const IS_IPHONE = false; function applyCustomFontSize() {} function handleReviewKeydown() {}\n' + modalFunction });
    await page.evaluate(() => {
      document.querySelector('.aiang-overlay').remove();
      const panel = document.createElement('div'); panel.className = 'aiang-review aiang-chat-modal';
      showModalPanel(panel);
    });
    const modalCaptures = await page.evaluate(() => captureArticleMediaSnippets(document.querySelector('#article')));
    assert.equal(modalCaptures.length, 1);
    assert.equal(await page.evaluate(() => document.body.style.position), 'fixed');
    assert.equal(await page.evaluate(() => document.body.style.top), '-200px');
    await page.evaluate(() => { document.querySelector('.aiang-review')._aiangCleanupOverflow(); document.querySelector('.aiang-overlay').remove(); });
    assert.equal(await page.evaluate(() => window.scrollY), 200);
    // Distinct media stay distinct; only scroll tiles belonging to the same element are joined.
    await page.evaluate(() => {
      const image = document.querySelector('#tall'); image.after(image.cloneNode());
    });
    const distinct = await page.evaluate(() => captureArticleMediaSnippets(document.querySelector('#article')));
    assert.equal(distinct.length, 2);
    // A single long image must not be truncated by the eight-media attachment limit.
    const veryLong = await page.evaluate(async () => {
      const article = document.querySelector('#article');
      article.querySelectorAll('img')[1].remove();
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 5000;
      const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 400, 4900);
      context.fillStyle = 'blue'; context.fillRect(0, 4900, 400, 100);
      const element = article.querySelector('img'); element.style.height = '5000px'; element.src = canvas.toDataURL(); await element.decode();
      const captures = await captureArticleMediaSnippets(article);
      const image = new Image(); image.src = captures[0]; await image.decode();
      canvas.width = image.width; canvas.height = image.height; context.drawImage(image, 0, 0);
      return { count: captures.length, height: image.height, bottom: Array.from(context.getImageData(20, image.height - 20, 1, 1).data) };
    });
    assert.equal(veryLong.count, 1);
    assert.equal(veryLong.height, 5000);
    assert.ok(veryLong.bottom[2] > 240, 'the end of a media element beyond eight scroll tiles is preserved');
    // Refuse clipped tiles instead of stretching incomplete pixels into a full attachment.
    await assert.rejects(page.evaluate(async url => {
      const canvas = createMediaCaptureCanvas(200, 200);
      await drawMediaCaptureTile(url, { left: -100, top: -100, width: 200, height: 200 },
        { left: 0, top: 0, width: 900, height: 700 }, canvas, 200, 200, 0, 0);
    }, 'data:image/png;base64,' + (await page.screenshot()).toString('base64')), /미디어 전체/);
    externalRequests.length = 0;
    await page.addInitScript(base => {
      window.chrome = { runtime: { id: 'test-extension', getURL: value => base + '/' + value,
        onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true, settings: { provider: 'gemini' } }) } };
    }, origin);
    await page.goto(origin + '/offscreen.html');
    const ocr = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 220;
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1000, 220);
      context.fillStyle = 'black'; context.font = '48px Arial'; context.fillText('SEOUL EVENT 2026', 30, 70);
      context.font = '48px Apple SD Gothic Neo'; context.fillText('서울 행사 안내', 30, 150);
      return await recognizeCapturedImages([canvas.toDataURL()], new AbortController().signal);
    });
    assert.match(ocr, /SEOUL EVENT 2026/);
    assert.match(ocr, /서울 행사 안내/);
    assert.deepEqual(externalRequests, [], 'OCR never downloads remote code or sends captures outside localhost');
    const cancelled = await page.evaluate(async () => {
      const controller = new AbortController();
      const pending = withOCRCancellation(new Promise(() => {}), controller.signal);
      controller.abort();
      try { await pending; return false; } catch (error) { return error.name === 'AbortError'; }
    });
    assert.equal(cancelled, true, 'OCR cancellation settles even if the terminated worker never replies');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
