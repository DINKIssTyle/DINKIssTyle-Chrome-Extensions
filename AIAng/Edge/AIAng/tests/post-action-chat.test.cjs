const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

test('article actions answer in a persistent chat, with follow-up context and accurate read state', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE, timeout: 120000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.AIANG_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true });
    const page = await browser.newPage({viewport:{width:1000,height:900}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/tests/post-action-chat-fixture.html`;
    const open = async label => { await page.locator('.aiang-summary-slot').getByRole('button',{name:label,exact:true}).click(); };
    const done = async () => { await page.getByRole('button',{name:'이 게시물을 읽었습니다',exact:true}).waitFor(); };
    const close = async () => { await page.locator('.aiang-chat-modal .aiang-close').click(); };
    const asks = async question => { await page.locator('.aiang-chat-input').fill(question); await page.locator('.aiang-chat-input').press('Enter'); await page.waitForFunction(() => !document.querySelector('.aiang-chat-send').disabled); };
    for(const [label,type,answer] of [['게시물 요약','SUMMARIZE_POST','별의 탄생'],['댓글 반응 요약','SUMMARIZE_REACTIONS','비용에 관한'],['용어 사전','BUILD_GLOSSARY','빛의 한 종류']]) {
      await page.goto(url); await open(label); await done();
      assert.match(await page.locator('.aiang-chat-modal').innerText(), /뭐였더라\?/);
      assert.match(await page.locator('.aiang-chat-message-assistant').innerText(), new RegExp(answer));
      const first = await page.evaluate(() => testRequests);
      assert.equal(first.length,1, 'no separate read-post inference'); assert.equal(first[0].type,type);
      await asks('구체적으로 어떻게 관측하나요?');
      const request = await page.evaluate(() => testRequests.at(-1));
      assert.equal(request.type,'CHAT');
      assert.ok(request.messages.some(message => message.content.includes('먼 은하')));
      assert.ok(request.messages.some(message => message.role==='assistant' && message.content.includes(answer)));
      if(type==='SUMMARIZE_REACTIONS') assert.ok(request.messages.some(message => message.content.includes('관측 비용')));
      const completedLabel = {SUMMARIZE_POST:'게시물을 요약했습니다', SUMMARIZE_REACTIONS:'댓글을 요약했습니다', BUILD_GLOSSARY:'용어 사전을 생성했습니다'}[type];
      assert.equal(await page.getByRole('button',{name:completedLabel,exact:true}).isDisabled(),true);
      const beforeReopen = await page.evaluate(() => testRequests.length);
      await close(); await open(label); await done();
      assert.equal(await page.evaluate(() => testRequests.length),beforeReopen, 'completed external action does not repeat inference');
      assert.equal(await page.getByRole('button',{name:completedLabel,exact:true}).isDisabled(),true);
      await close(); await open('용어 사전'); await done();
      await page.waitForFunction(() => !document.querySelector('.aiang-chat-send').disabled);
      assert.ok(await page.locator('.aiang-chat-message-assistant').count() >= (type==='BUILD_GLOSSARY' ? 2 : 3), 'reopened actions share the conversation');
      await close();
      await page.locator('.aiang-toolbar').getByRole('button',{name:'뭐였더라?',exact:true}).click(); await done();
      assert.ok(await page.locator('.aiang-chat-message-assistant').count() >= (type==='BUILD_GLOSSARY' ? 2 : 3), 'existing chat entry shares the same article history');
    }
    await page.goto(url); await page.evaluate(() => {testHold=true}); await open('게시물 요약');
    await page.waitForFunction(() => testRequests.some(request => request.type==='SUMMARIZE_POST'));
    assert.equal(await page.getByRole('button',{name:'이 게시물을 읽었습니다',exact:true}).count(),0);
    await page.getByRole('button',{name:'게시물 요약 중 (취소하려면 클릭)',exact:true}).click();
    assert.equal(await page.locator('.aiang-chat-message').count(),0);
    assert.equal(await page.locator('.aiang-chat-actions').getByRole('button',{name:'게시물 요약 (Shift+클릭 시 입력창에 작성)',exact:true}).isEnabled(),true);
    await close(); await page.evaluate(() => {testHold=false; testFail=true}); await open('게시물 요약');
    await page.waitForFunction(() => !document.querySelector('.aiang-chat-send').disabled);
    assert.equal(await page.getByRole('button',{name:'이 게시물을 읽었습니다',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'게시물을 요약했습니다',exact:true}).count(),0);
    assert.equal(await page.locator('.aiang-chat-actions').getByRole('button',{name:'게시물 요약 (Shift+클릭 시 입력창에 작성)',exact:true}).isEnabled(),true);
    await close(); await page.evaluate(() => {testFail=false; testHold=true}); await open('게시물 요약');
    await close(); await page.evaluate(() => {testHold=false}); await open('용어 사전'); await done();
    assert.equal(await page.locator('.aiang-chat-message-assistant').count(),1, 'closing cancels and discards pending turns');
    for(let i=0;i<12;i++) await asks(`추가 질문 ${i}`);
    const final = await page.evaluate(() => testRequests.at(-1));
    assert.ok(final.messages.some(message => message.content.includes('먼 은하')), 'post context survives chat trimming');
    assert.ok(final.messages.reduce((n,m) => n+m.content.length,0)<=16000);
    await close(); await open('용어 사전'); await done();
    assert.equal(await page.getByRole('button',{name:'용어 사전을 생성했습니다',exact:true}).isDisabled(),true, 'completion survives history trimming');
    for (const [label,completed] of [['게시물 요약','게시물을 요약했습니다'],['댓글 요약','댓글을 요약했습니다']]) {
      await page.locator('.aiang-chat-actions').getByRole('button',{name:label+' (Shift+클릭 시 입력창에 작성)',exact:true}).click();
      await page.getByRole('button',{name:completed,exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:completed,exact:true}).isDisabled(),true);
    }
    await page.goto(url); await page.evaluate(() => {document.querySelector('#comments ul').remove(); document.querySelector('#comments h2').textContent='댓글 (0)';});
    await open('댓글 반응 요약');
    assert.match(await page.locator('.aiang-chat-message-assistant').innerText(),/요약할 댓글이 아직 없습니다/);
    assert.equal(await page.evaluate(() => testRequests.length),0);
    assert.equal(await page.getByRole('button',{name:'이 게시물을 읽었습니다',exact:true}).count(),0);
    await page.goto(url+'?media'); await open('게시물 요약'); await done();
    const mediaRequests=await page.evaluate(() => testRequests);
    const summary=mediaRequests.find(request => request.type==='SUMMARIZE_POST');
    assert.equal(summary.images.length,1);
    const captureCount=mediaRequests.filter(request => request.type==='CAPTURE_TAB_VIEWPORT').length;
    await asks('이미지의 내용을 더 설명해 주세요');
    const mediaFollowup=await page.evaluate(() => testRequests.at(-1));
    assert.deepEqual(mediaFollowup.images,summary.images);
    assert.equal(await page.evaluate(() => testRequests.filter(request => request.type==='CAPTURE_TAB_VIEWPORT').length),captureCount);
    await page.setViewportSize({width:390,height:844}); await page.goto(url); await open('게시물 요약'); await done();
    await asks('이것을 쉽게 설명해 주세요');
    assert.equal(await page.locator('.aiang-chat-message-assistant').count(),2);
    await page.screenshot({path:'/private/tmp/aiang-action-chat-mobile.png'});
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
