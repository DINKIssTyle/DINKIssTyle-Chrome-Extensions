const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

test('floating assistant switches modes, selects contextual actions, and preserves existing workflows', {
  skip: !process.env.AIANG_PLAYWRIGHT_MODULE, timeout: 120000
}, async () => {
  const { chromium } = require(process.env.AIANG_PLAYWRIGHT_MODULE);
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req,res) => {
    const file = path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)) {res.writeHead(404).end();return;}
    fs.readFile(file,(error,data) => {
      if(error) {res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.gif')?'image/gif':'text/html');res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.AIANG_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    const page = await browser.newPage({viewport:{width:1000,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const url=`http://127.0.0.1:${server.address().port}/tests/floating-assistant-fixture.html`;
    const launcher=page.locator('.aiang-floating-launcher');
    const menu=page.locator('.aiang-floating-menu');
    const action=id=>menu.locator(`[data-action="${id}"]`);
    const ids=()=>menu.locator('[data-action]').evaluateAll(items=>items.map(item=>item.dataset.action));
    const open=async()=>{if(await menu.isHidden()) await launcher.click();};
    const close=async()=>{const close=page.locator('.aiang-review .aiang-close');if(await close.count())await close.first().click();};
    const go=async query=>{await page.goto(url+query);await launcher.waitFor();await open();};
    const settings=async values=>page.evaluate(values=>setSettings(values),values);
    const requested=async type=>page.waitForFunction(type=>testRequests.some(r=>r.type===type),type);
    await page.goto(url+'?floating=off');
    await page.locator('.aiang-summary-slot').waitFor();assert.equal(await launcher.count(),0);
    assert.equal(await page.locator('.aiang-toolbar').count(),1);
    await settings({floatingAssistantEnabled:true});await launcher.waitFor();
    assert.equal(await page.locator('.aiang-summary-slot,.aiang-toolbar,[data-aiang-board-chat]').count(),0);
    assert.equal(await launcher.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await open();assert.deepEqual(await ids(),['summarize_post','summarize_reactions','build_glossary','chat']);
    await settings({floatingAssistantPosition:'left'});await page.waitForFunction(()=>document.querySelector('.aiang-floating').dataset.position==='left');
    assert.equal((await launcher.boundingBox()).x, (await page.locator('article').boundingBox()).x);
    await page.keyboard.press('Escape');assert.equal(await menu.isHidden(),true);assert.equal(await launcher.evaluate(el=>el===document.activeElement),true);
    await open();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'AI 지원 설정');
    await page.keyboard.press('ArrowDown');assert.equal(await action('summarize_post').evaluate(el=>el===document.activeElement),true);
    await page.locator('h1').click();assert.equal(await menu.isHidden(),true);
    await settings({floatingAssistantEnabled:false});await page.locator('.aiang-summary-slot').waitFor();assert.equal(await launcher.count(),0);
    assert.equal(await page.locator('.aiang-toolbar').count(),1);
    await settings({floatingAssistantEnabled:true});await launcher.waitFor();await settings({enabled:false});await launcher.waitFor({state:'detached'});
    assert.equal(await page.locator('.aiang-toolbar,.aiang-summary-slot').count(),0);
    await settings({enabled:true});await launcher.waitFor();

    await go('?mode=empty');assert.deepEqual(await ids(),['summarize_post','build_glossary','chat']);
    await page.locator('textarea').fill('   ');await open();assert.equal(await action('spellcheck').count(),0);
    await page.locator('textarea').fill('댓글 기슬입니다.');await open();await action('spellcheck').waitFor();
    assert.deepEqual(await ids(),['spellcheck','honorific','improve','decorate','summarize_post','build_glossary','chat']);
    await page.locator('textarea').fill('');await open();await action('spellcheck').waitFor({state:'detached'});assert.equal(await action('spellcheck').count(),0);
    for(const [id,type] of [['summarize_post','SUMMARIZE_POST'],['summarize_reactions','SUMMARIZE_REACTIONS'],['build_glossary','BUILD_GLOSSARY'],['chat',null]]) {
      await go('');await action(id).click();await page.locator('.aiang-chat-modal').waitFor();
      assert.equal(await page.locator('.aiang-chat-actions').isVisible(),true);
      assert.equal(await page.locator('.aiang-chat-actions').evaluate(el=>el.inert),false);
      if(type){await requested(type);await page.waitForFunction(()=>!document.querySelector('.aiang-chat-send').disabled);}
      await page.locator('.aiang-chat-input').fill('더 알려 주세요');await page.locator('.aiang-chat-send').click();await requested('CHAT');await close();
    }
    for(const id of ['spellcheck','honorific','improve','decorate']) {
      await go('');await page.locator('textarea').fill('댓글 기슬입니다.');await open();await action('spellcheck').waitFor();await action(id).click();await requested('PROCESS_TEXT');
      assert.equal(await page.evaluate(()=>testRequests.find(r=>r.type==='PROCESS_TEXT').action),id);
      assert.equal(await page.locator('textarea').inputValue(),'댓글 기슬입니다.','review does not apply changes automatically');
    }
    await go('');await page.locator('textarea').fill('댓글 기슬입니다.');await open();await action('spellcheck').waitFor();await page.evaluate(()=>testHold=true);await action('improve').click();await requested('PROCESS_TEXT');
    assert.equal(await menu.isHidden(),true,'a selected menu closes immediately');
    assert.equal(await launcher.getAttribute('aria-busy'),'true');
    assert.match(await launcher.locator('img').getAttribute('src'),/AIAng\.gif$/);
    await page.waitForFunction(()=>document.querySelector('.aiang-floating-launcher img').complete);
    await page.screenshot({path:'/private/tmp/aiang-busy-gif.png'});
    await launcher.click();await requested('CANCEL_REQUEST');
    await page.waitForFunction(()=>!document.querySelector('.aiang-floating .is-loading'));
    assert.match(await launcher.locator('img').getAttribute('src'),/AIAng\.png$/);
    await open();await action('improve').click();await page.waitForFunction(()=>testRequests.filter(r=>r.type==='PROCESS_TEXT').length===2);
    await settings({floatingAssistantEnabled:false});await page.waitForFunction(()=>testRequests.filter(r=>r.type==='CANCEL_REQUEST').length===2);

    // Completion, failure and empty input must leave a static icon.
    await go('');await page.locator('textarea').fill('댓글 기슬입니다.');await open();await action('improve').waitFor();
    await page.evaluate(()=>testHold=true);await action('improve').click();await requested('PROCESS_TEXT');
    await page.evaluate(()=>releaseTestRequests());
    await page.waitForFunction(()=>document.querySelector('.aiang-floating-launcher').getAttribute('aria-busy')==='false');
    assert.match(await launcher.locator('img').getAttribute('src'),/AIAng\.png$/);await close();
    await go('');await page.locator('textarea').fill('댓글 기슬입니다.');await open();await action('improve').waitFor();
    await page.evaluate(()=>testFail=true);await action('improve').click();await requested('PROCESS_TEXT');
    await page.waitForFunction(()=>document.querySelector('.aiang-floating-launcher').getAttribute('aria-busy')==='false');
    assert.equal(await menu.isHidden(),true);
    await go('?mode=write');await page.locator('.tiptap').fill('');await page.locator('#title').fill('');
    await action('spellcheck').click();assert.equal(await menu.isHidden(),true);
    assert.equal(await launcher.getAttribute('aria-busy'),'false');

    // A summary creates a chat asynchronously; its activity outlives the menu callback.
    for(const id of ['summarize_post','build_glossary']) {
      await go('');await page.evaluate(()=>testHold=true);await action(id).click();
      await page.waitForFunction(()=>testRequests.length>0);
      assert.equal(await menu.isHidden(),true);
      assert.equal(await launcher.getAttribute('aria-busy'),'true');
      assert.match(await page.locator('.aiang-chat-modal .aiang-review-badge').getAttribute('src'),/AIAng\.gif$/);
      await close();assert.equal(await launcher.getAttribute('aria-busy'),'false');
      assert.match(await launcher.locator('img').getAttribute('src'),/AIAng\.png$/);
    }
    // Both modes must use the existing board/post/draft chat chip rules.
    for(const mode of ['board','post','write']) {
      const states=[];
      for(const floating of ['off','on']) {
        await page.goto(url+`?mode=${mode}&floating=${floating}`);
        if(floating==='on'){await launcher.waitFor();await open();await action('chat').click();}
        else if(mode==='board'){await page.locator('[data-aiang-board-chat]').click();}
        else {await page.locator('.aiang-toolbar').getByRole('button',{name:'뭐였더라?',exact:true}).click();}
        const chips=page.locator('.aiang-chat-action-chip');
        await chips.first().waitFor();
        const before=await chips.allTextContents();
        await chips.first().click();await requested('CHAT');
        await page.waitForFunction(mode=>document.querySelector('.aiang-chat-actions').textContent.includes(mode==='board'?'주요 이슈':'용어 사전'),mode);
        states.push({before,after:await chips.allTextContents()});await close();
      }
      assert.deepEqual(states[1],states[0],`${mode} chips match with floating enabled and disabled`);
    }

    await go('?mode=board');assert.deepEqual(await ids(),['read_board','chat']);await action('read_board').click();await requested('CHAT');
    assert.ok(await page.evaluate(()=>testRequests.find(r=>r.type==='CHAT').messages.some(m=>m.content.includes('우주 망원경 관측'))));await close();
    for(const [id,type] of [['spellcheck','PROCESS_TEXT'],['honorific','PROCESS_TEXT'],['improve','PROCESS_TEXT'],['decorate','PROCESS_TEXT'],['suggest_tags','SUGGEST_TAGS'],['suggest_title','SUGGEST_TITLES']]) {
      await go('?mode=write');assert.deepEqual(await ids(),['spellcheck','honorific','improve','decorate','suggest_tags','suggest_title','chat']);
      await action(id).click();await requested(type);
      assert.match(await page.locator('.tiptap').innerText(),/기슬/);
    }
    await go('?media=1');await action('summarize_post').click();await requested('CAPTURE_TAB_VIEWPORT');await requested('SUMMARIZE_POST');
    assert.equal(await page.evaluate(()=>testFloatingHiddenDuringCapture),true);
    assert.equal(await launcher.evaluate(el=>getComputedStyle(el).visibility),'visible');await close();
    await go('?mode=write');await page.evaluate(()=>{history.pushState(null,'','/free');document.querySelector('main').innerHTML='<h1>목록</h1>';});
    await page.waitForFunction(()=>document.querySelector('.aiang-floating-menu').hidden);await open();assert.deepEqual(await ids(),['read_board','chat']);
    // Desktop follows the content column even with a wide sidebar and layout changes.
    for(const mode of ['post','write','board']) {
      await page.setViewportSize({width:1600,height:900});await go(`?mode=${mode}`);
      await page.addStyleTag({content:'main {max-width:none;width:1200px;margin-left:160px} article,.tiptap-editor,[data-aiang-board-list] {width:640px}'});
      if(mode==='board') await page.evaluate(()=>{
        const list=document.createElement('div');list.dataset.aiangBoardList='true';list.textContent='글 목록';document.querySelector('main').append(list);
      });
      const selector=mode==='post'?'article':mode==='write'?'.tiptap-editor':'[data-aiang-board-list]';
      for(const position of ['left','right']) {
        await settings({floatingAssistantPosition:position});
        await page.waitForFunction(({selector,position})=>{
          const content=document.querySelector(selector).getBoundingClientRect(),button=document.querySelector('.aiang-floating-launcher').getBoundingClientRect();
          return Math.abs(position==='left'?button.left-content.left:button.right-content.right)<1;
        },{selector,position});
        const r=await menu.boundingBox(),c=await page.locator(selector).boundingBox();
        assert.ok(r.x>=c.x-1&&r.x+r.width<=c.x+c.width+1);
      }
      await page.locator(selector).evaluate(el=>el.style.width='520px');
      await page.waitForFunction(selector=>Math.abs(document.querySelector('.aiang-floating-launcher').getBoundingClientRect().right-document.querySelector(selector).getBoundingClientRect().right)<1,selector);
      const y=(await launcher.boundingBox()).y;
      await page.evaluate(()=>{document.body.style.minHeight='2000px';window.scrollTo(0,300)});
      assert.equal((await launcher.boundingBox()).y,y,'scrolling keeps the viewport bottom anchor');
      await page.setViewportSize({width:600,height:844});
      await page.waitForFunction(()=>document.querySelector('.aiang-floating').style.left==='');
      assert.equal((await launcher.boundingBox()).x+64,582,'mobile returns to the viewport edge');
    }
    await page.setViewportSize({width:390,height:844});await go('');await page.locator('textarea').fill('좋은 기슬입니다.');await open();
    // Reproduce host-page horizontal clipping on the floating container. Bounding
    // boxes still look correct when the menu is clipped: verify hit testing too.
    await page.addStyleTag({content:'body > div { overflow-x: clip; }'});
    for(const position of ['left','right']) {
      await settings({floatingAssistantPosition:position});await page.waitForFunction(position=>document.querySelector('.aiang-floating').dataset.position===position,position);
      const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390&&rect.y>=0&&rect.y+rect.height<=844);
      assert.equal(await menu.evaluate(el => {
        const r=el.querySelector('[role="menuitem"]').getBoundingClientRect();
        return [r.left+16,r.right-16].every(x=>el.contains(document.elementFromPoint(x,r.top+r.height/2)));
      }),true,`both edges of the ${position} menu must remain visible and clickable outside the launcher`);
    }
    await page.screenshot({path:'/private/tmp/aiang-floating-mobile.png'});
    await page.setViewportSize({width:390,height:380});const small=await menu.boundingBox();assert.ok(small.y>=0&&small.y+small.height<=380);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
