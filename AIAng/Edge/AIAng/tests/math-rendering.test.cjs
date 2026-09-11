const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'shared/math-rendering.js'), 'utf8'), context);

test('math delimiters preserve TeX before Markdown and leave code/currency alone', () => {
  for (const input of [String.raw`$2,305 \div 24 \approx 96.04$`, '$x$', String.raw`\(x_i^2\)`, '$$a_1\n+b_2$$', String.raw`\[\begin{matrix}1&2\\3&4\end{matrix}\]`]) {
    assert.equal(context.AIAngMath.protect(input).entries.length, 1, input);
  }
  for (const input of ['`$x$`', '```tex\n$x$\n```', '```tex\n$x$', String.raw`\$5 and \$10`, '$5 and $10', '$unfinished', '$$unfinished']) {
    assert.equal(context.AIAngMath.protect(input).entries.length, 0, input);
  }
});

test('bundled KaTeX handles screenshot formula and blocks active HTML commands', () => {
  const katex = require('../vendor/katex/katex.min.js');
  const options = {throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20};
  const html = katex.renderToString(String.raw`2,305 \div 24 \approx 96.04`, options);
  assert.match(html, /class="katex"/);
  assert.match(html, /÷/);
  assert.match(html, /≈/);
  for (const tex of [String.raw`\href{javascript:alert(1)}{click}`, String.raw`\includegraphics{https://example.com/pixel}`]) {
    assert.doesNotMatch(katex.renderToString(tex, options), /<(?:a|img|script)\b/);
  }
  assert.throws(() => katex.renderToString(String.raw`\frac{`, options));
});

test('answers render math with Markdown, safe fallback, and mobile overflow containment', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE, timeout: 60000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 800}});
    await page.setContent('<div id="answer" style="width:340px"></div>');
    await page.addStyleTag({path: path.join(root, 'vendor/katex/katex.min.css')});
    await page.addStyleTag({path: path.join(root, 'content.css')});
    await page.addScriptTag({path: path.join(root, 'vendor/katex/katex.min.js')});
    await page.addScriptTag({path: path.join(root, 'shared/math-rendering.js')});
    const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    await page.addScriptTag({content: content.slice(content.indexOf('  function renderSummaryMarkdown('), content.indexOf('  function getChatPostContext('))});
    const source = String.raw`**평균**: $2,305 \div 24 \approx 96.04$

$$
\sum_{i=1}^{24} x_i
$$

| 수식 | 값 |
| --- | --- |
| $|x_i|$ | $x^2$ |

> **값 $a_b+c_d$**

코드: ` + '`$x$`\n\n```tex\n$x$\n```\n\n' + String.raw`잘못된 수식 $\frac{$ 이후 텍스트

$\href{javascript:alert(1)}{click}$

$` + '1+'.repeat(100) + '2$';
    await page.evaluate(source => renderSummaryMarkdown(document.querySelector('#answer'), source), source);
    assert.equal(await page.locator('#answer .katex').count(), 7);
    assert.equal(await page.locator('#answer .aiang-math-display .katex').count(), 1);
    assert.equal(await page.locator('#answer table td').count(), 2);
    assert.equal(await page.locator('#answer strong .katex').count(), 1);
    assert.equal(await page.locator('#answer code .katex').count(), 0);
    assert.match(await page.locator('#answer').innerText(), /잘못된 수식.*이후 텍스트/);
    assert.equal(await page.locator('#answer a, #answer script, #answer img').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
    assert.equal(await page.evaluate(() => document.querySelector('#answer').textContent.includes('\uE000')), false);
  } finally { await browser.close(); }
});
