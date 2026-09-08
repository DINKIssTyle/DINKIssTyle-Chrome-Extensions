const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

test('post animations mix in keyword folders matched from the title and body', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE, timeout: 30000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const root = path.resolve(__dirname, '..');
  const fallbackAsset = fs.readdirSync(path.join(root, 'icons', 'Ani', '3D Ang', 'post'))
    .filter(name => name.endsWith('.webp')).map(name => path.join(root, 'icons', 'Ani', '3D Ang', 'post', name))[0];
  const testAssets = new Set([
    '/icons/Ani/3D Ang/loading/loading-test.webp',
    '/icons/Ani/3D Ang/happy/keyword-test.webp',
    '/icons/Ani/3D Ang/sad/keyword-test.webp',
    '/icons/Ani/3D Ang/scary/keyword-test.webp'
  ]);
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = testAssets.has(pathname) ? fallbackAsset : path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
    fs.readFile(file, (error, contents) => {
      if (error) { response.writeHead(404).end(); return; }
      if (pathname === '/icons/Ani/catalog.json') {
        const catalog = JSON.parse(contents);
        const theme = catalog.themes.find(item => item.id === '3D Ang');
        theme.states.loading = [{ path: '3D Ang/loading/loading-test.webp', durationMs: 250, maxPlays: 2 }];
        theme.states.happy = [{ path: '3D Ang/happy/keyword-test.webp', durationMs: 2400, maxPlays: 1 }];
        theme.states.sad = [{ path: '3D Ang/sad/keyword-test.webp', durationMs: 2400, maxPlays: 1 }];
        theme.states.scary = [{ path: '3D Ang/scary/keyword-test.webp', durationMs: 2400, maxPlays: 1 }];
        contents = Buffer.from(JSON.stringify(catalog));
      }
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/html');
      response.end(contents);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.AIANG_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0.999; });
    const url = `http://127.0.0.1:${server.address().port}/tests/floating-assistant-fixture.html?theme=3D%20Ang`;
    await page.goto(`${url}&title=${encodeURIComponent('행복한 우주 망원경 관측')}`);
    const image = page.locator('.aiang-floating-launcher img');
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.aiang-floating-launcher img')?.src.includes('/happy/keyword-test.webp'), null, { timeout: 5000 });

    await page.goto(`${url}&body=${encodeURIComponent('우주 망원경의 무서운 관측 결과입니다.')}`);
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.aiang-floating-launcher img')?.src.includes('/scary/keyword-test.webp'), null, { timeout: 5000 });
    assert.equal(await image.evaluate(element => element.complete && element.naturalWidth > 0), true);

    await page.goto(`${url}&random=0&body=${encodeURIComponent('고인의 명복을 빕니다.')}`);
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.aiang-floating-launcher img')?.src.includes('/sad/keyword-test.webp'), null, { timeout: 5000 });

    await page.goto(`${url}&body=${encodeURIComponent('JavaScript 언어의 문법과 실행 환경을 자세히 소개합니다.')}`);
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.aiang-floating-launcher img')?.src.includes('/post/'), null, { timeout: 5000 });

    for (const mode of ['post', 'write']) {
      await page.goto(`${url}&mode=${mode}`);
      const editor = page.locator(mode === 'write' ? '.tiptap' : 'textarea');
      await editor.fill('문장 기슬을 확인해 주세요.');
      await page.evaluate(() => { testHold = true; });
      await page.locator('.aiang-floating-launcher').click();
      await page.locator('.aiang-floating-menu [data-action="improve"]').click();
      await page.waitForFunction(() => document.querySelector('.aiang-floating-launcher img')?.src.includes('/loading/'));
      const first = await image.getAttribute('src');
      await page.waitForFunction(first => {
        const src = document.querySelector('.aiang-floating-launcher img')?.src;
        return src?.includes('/loading/') && src !== first;
      }, first);
      await page.evaluate(() => releaseTestRequests());
      await page.waitForFunction(state => document.querySelector('.aiang-floating-launcher img')?.src.includes(`/${state}/`), mode === 'write' ? 'newpost' : 'comment');
    }

    await page.evaluate(() => {
      chrome.runtime.getURL = () => { throw new Error('Extension context invalidated.'); };
      setSettings({ floatingAssistantType: 'AIAng' });
    });
    await page.waitForFunction(() => !document.querySelector('.aiang-floating'));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
