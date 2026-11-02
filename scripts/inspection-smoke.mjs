import { _electron as electron } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const occupied=process.argv.includes('--occupied');
const directory=process.env.CIC_INSPECTION_DIRECTORY;
if (!directory) throw new Error('请设置 CIC_INSPECTION_DIRECTORY 指向已导出的真实业务组件');
await mkdir('artifacts',{ recursive:true });
const env={ ...process.env,CIC_USER_DATA:path.resolve(`artifacts/inspection-profile-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({ args:['.'],env });
const evidence={ result:'running',directory,occupied,orientations:[],inputMethod:'真实中文输入法尚未验证',device:'未启动真实查验会话，目标实体屏待验证' };
try {
  const desktop=await app.firstWindow();
  await desktop.getByRole('heading',{ name:'虚拟桌面',exact:true }).waitFor();
  if (occupied) {
    const before=await fetch('http://127.0.0.1:18080/api/v1/system/status').then(value => value.json());
    await desktop.locator('#inspection-open').click();
    await desktop.locator('#inspection-notice').filter({ hasText:'已被占用' }).waitFor();
    const after=await fetch('http://127.0.0.1:18080/api/v1/system/status').then(value => value.json());
    assert.equal(before.code,0); assert.equal(after.code,0);
    assert.equal((await desktop.evaluate(() => window.desktop.inspection.status())).backendPid,null);
    evidence.externalBackendPreserved=true;
  } else {
    const startup=await desktop.evaluate(async () => { try { return await window.desktop.inspection.open(); } catch(error) { return { error:error.message }; } });
    assert.equal(startup.error,'',`业务启动失败：${startup.error}`);
    await desktop.locator('#inspection-open').click();
    await desktop.locator('#inspection-frame').waitFor({ timeout:30000 });
    await desktop.waitForFunction(() => document.querySelector('#inspection-frame')?.naturalWidth>0);
    let business=await app.waitForEvent('window',{ predicate:page => page.url().startsWith('http://127.0.0.1:'),timeout:1000 }).catch(() => app.windows().find(page => page.url().startsWith('http://127.0.0.1:')));
    assert.ok(business,'业务页面必须在真实 Electron 中运行');
    await business.locator('#btn-self-check-complete').waitFor({ timeout:20000 });
    assert.equal(await business.evaluate(() => typeof window.require),'undefined');
    const first=await desktop.evaluate(() => window.desktop.inspection.status());
    assert.ok(first.backendPid);
    evidence.backendPid=first.backendPid;
    // 业务页面只取得自己的 preload，不取得桌面加载器能力。
    assert.equal(await business.evaluate(() => typeof window.desktop),'undefined');
    evidence.isolation=true;
    /** 将真实业务按钮位置经桌面的当前正向矩阵转换后点击。 */
    async function clickBusiness(selector) {
      await business.locator(selector).waitFor({ state:'visible' });
      const target=await business.locator(selector).evaluate(element => { const r=element.getBoundingClientRect(); return { x:r.x+r.width/2,y:r.y+r.height/2 }; });
      const destination=await desktop.evaluate(point => {
        const canvas=document.querySelector('#canvas');
        const output=document.querySelector('#output').getBoundingClientRect();
        const mapped=new DOMPoint(point.x,point.y+120).matrixTransform(new DOMMatrix(getComputedStyle(canvas).transform));
        return { x:output.left+mapped.x,y:output.top+mapped.y };
      },target);
      await desktop.mouse.click(destination.x,destination.y);
    }
    for (const orientation of [0,90,180,270]) {
      await desktop.locator('#inspection-home').click();
      await desktop.locator('#orientation').selectOption(String(orientation));
      await desktop.locator('#cx').fill('0.85'); await desktop.locator('#cy').fill('1.1');
      await desktop.getByRole('button',{ name:'应用显示',exact:true }).click();
      await desktop.locator('#inspection-open').click();
      await desktop.locator('#inspection-frame').waitFor();
      assert.equal((await desktop.evaluate(() => window.desktop.inspection.status())).backendPid,first.backendPid);
      await clickBusiness('#btn-self-check-actions-toggle');
      await business.waitForFunction(() => !document.querySelector('#self-check-actions-dropdown').classList.contains('hidden'));
      await clickBusiness('#btn-self-check-actions-toggle');
      await business.waitForFunction(() => document.querySelector('#self-check-actions-dropdown').classList.contains('hidden'));
      await desktop.screenshot({ path:`artifacts/inspection-${orientation}.png` });
      evidence.orientations.push(orientation);
    }
    // 查验保持运行时切换已有浏览器和文件管理器，不能重建或销毁彼此的内容节点。
    await desktop.locator('#inspection-home').click();
    await desktop.locator('#open-browser').click();
    await desktop.locator('#browser-welcome').waitFor();
    await desktop.locator('#browser-home').click();
    await desktop.locator('#open-files').click();
    await desktop.locator('#files-panel').waitFor();
    await desktop.locator('#files-panel [data-home]').click();
    await desktop.locator('#inspection-open').click();
    await desktop.locator('#inspection-frame').waitFor();
    assert.equal((await desktop.evaluate(() => window.desktop.inspection.status())).backendPid,first.backendPid);
    evidence.coexistsWithBrowserAndFiles=true;
    // 使用真实业务设置弹窗中的文字框验证转发；不触发保存、查验或外部设备命令。
    await clickBusiness('#btn-self-check-actions-toggle');
    await clickBusiness('#btn-self-check-system-config');
    await business.locator('input[type="text"]:visible, input:not([type]):visible').first().waitFor();
    const fields=await business.locator('input[type="text"]:visible, input:not([type]):visible').all();
    if (!fields.length) throw new Error('系统配置弹窗没有可验证的文字框');
    const field=fields[0];
    const fieldId=await field.getAttribute('id');
    assert.ok(fieldId);
    const original=await field.inputValue();
    await field.scrollIntoViewIfNeeded();
    await clickBusiness(`#${fieldId}`);
    await desktop.waitForFunction(() => document.activeElement.id==='inspection-input');
    await business.waitForFunction(id => document.activeElement.id===id,fieldId);
    await desktop.keyboard.insertText('接入验证');
    await business.waitForFunction(id => document.getElementById(id).value.includes('接入验证'),fieldId);
    evidence.textForwarding=true;
    await desktop.keyboard.press('Backspace');
    await business.waitForFunction(id => document.getElementById(id).value.includes('接入验') && !document.getElementById(id).value.includes('接入验证'),fieldId);
    evidence.editingKeyForwarding=true;
    await field.fill(original); // 恢复未保存的表单内容。
    await desktop.screenshot({ path:'artifacts/inspection-text.png' });
    const scroll=await field.evaluate(element => {
      let parent=element.parentElement;
      while (parent && !(parent.scrollHeight>parent.clientHeight+10 && ['auto','scroll'].includes(getComputedStyle(parent).overflowY))) parent=parent.parentElement;
      if (!parent) return null;
      parent.setAttribute('data-scroll-probe','true');
      const rect=parent.getBoundingClientRect();
      return { x:rect.x+rect.width/2,y:rect.y+rect.height/2,top:parent.scrollTop,delta:parent.scrollTop>100 ? -200 : 200 };
    });
    assert.ok(scroll,'配置弹窗应提供实际可滚动区域');
    const wheel=await desktop.evaluate(point => {
      const matrix=new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform);
      const mapped=new DOMPoint(point.x,point.y+120).matrixTransform(matrix);
      return { x:mapped.x,y:mapped.y,dx:matrix.c*point.delta,dy:matrix.d*point.delta };
    },scroll);
    await desktop.mouse.move(wheel.x,wheel.y);
    await desktop.mouse.wheel(wheel.dx,wheel.dy);
    await business.waitForFunction(top => document.querySelector('[data-scroll-probe]').scrollTop!==top,scroll.top);
    evidence.scrollForwarding=true;
    // 在真实业务页临时加入无设备视频探针，验证视频播放产生的帧能到达桌面。
    await business.evaluate(async () => {
      const probe=document.createElement('div'); probe.id='video-probe'; probe.style.cssText='position:fixed;left:20px;top:20px;z-index:999999';
      const source=document.createElement('canvas'); source.width=160; source.height=90;
      const context=source.getContext('2d');
      const video=document.createElement('video'); video.muted=true; video.autoplay=true; video.width=160; video.height=90;
      const stream=source.captureStream(10); video.srcObject=stream; probe.append(video); document.body.append(probe);
      let count=0;
      const timer=setInterval(() => { context.fillStyle=count++%2 ? '#00aa77' : '#ffaa00'; context.fillRect(0,0,160,90); },100);
      window.__removeVideoProbe=() => { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); probe.remove(); };
      await video.play();
    });
    const beforeFrame=await desktop.locator('#inspection-frame').getAttribute('src');
    await business.waitForFunction(() => document.querySelector('#video-probe video').currentTime>0.5);
    await desktop.waitForFunction(previous => document.querySelector('#inspection-frame').src!==previous,beforeFrame);
    await desktop.screenshot({ path:'artifacts/inspection-video-probe.png' });
    await business.evaluate(() => window.__removeVideoProbe());
    evidence.syntheticVideoFrames=true;
    await business.evaluate(() => {
      const probe=document.createElement('textarea'); probe.id='keyboard-probe'; probe.style.cssText='position:fixed;left:50px;top:150px;width:300px;height:100px;z-index:2147483647'; document.body.append(probe);
      window.__probeEscape=false; document.addEventListener('keydown',event => { if (event.key==='Escape') window.__probeEscape=true; });
    });
    await clickBusiness('#keyboard-probe');
    await desktop.keyboard.insertText('first'); await desktop.keyboard.press('Enter'); await desktop.keyboard.insertText('second');
    await business.waitForFunction(() => document.querySelector('#keyboard-probe').value==='first\nsecond');
    await desktop.keyboard.press('Escape');
    await business.waitForFunction(() => window.__probeEscape);
    assert.equal(await desktop.locator('#inspection-frame').isVisible(),true);
    evidence.businessEnterAndEscape=true;
    await business.evaluate(() => document.querySelector('#keyboard-probe').remove());
    // 用业务页中的临时按钮验证拖出内容后释放，不触发原按钮点击。
    await business.evaluate(() => {
      const probe=document.createElement('button'); probe.id='pointer-probe'; probe.style.cssText='position:fixed;left:50px;top:50px;width:100px;height:60px;z-index:999999'; probe.textContent='拖拽验证';
      window.__probeClicks=0; window.__probeReleases=0;
      probe.addEventListener('click',() => window.__probeClicks++);
      document.addEventListener('mouseup',() => window.__probeReleases++);
      document.body.append(probe);
    });
    const drag=await desktop.evaluate(() => {
      const m=new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform);
      const start=new DOMPoint(100,200).matrixTransform(m);
      const outside=new DOMPoint(100,50).matrixTransform(m);
      return { start:{x:start.x,y:start.y},outside:{x:outside.x,y:outside.y} };
    });
    await desktop.mouse.move(drag.start.x,drag.start.y); await desktop.mouse.down();
    await desktop.mouse.move(drag.outside.x,drag.outside.y); await desktop.mouse.up();
    await business.waitForFunction(() => window.__probeReleases>0);
    assert.equal(await business.evaluate(() => window.__probeClicks),0);
    await clickBusiness('#pointer-probe');
    await business.waitForFunction(() => window.__probeClicks===1);
    evidence.outsideRelease=true;
    const releases=await business.evaluate(() => window.__probeReleases);
    await desktop.mouse.move(drag.start.x,drag.start.y); await desktop.mouse.down();
    await desktop.evaluate(() => { document.querySelector('#output').style.right='80px'; window.dispatchEvent(new Event('resize')); });
    await business.waitForFunction(previous => window.__probeReleases>previous,releases);
    await desktop.mouse.up();
    await desktop.evaluate(() => { document.querySelector('#output').style.right=''; window.dispatchEvent(new Event('resize')); });
    assert.equal(await business.evaluate(() => window.__probeClicks),1);
    evidence.geometryChangeReleases=true;
    await business.evaluate(() => document.querySelector('#pointer-probe').remove());
    // 健康空闲状态也必须先确认重启，取消时保持当前业务会话。
    await app.evaluate(({ dialog }) => { globalThis.__originalDialog=dialog.showMessageBox; globalThis.__idleRestartPrompts=0; dialog.showMessageBox=async () => { globalThis.__idleRestartPrompts++; return { response:0 }; }; });
    const idleCancelled=await desktop.evaluate(() => window.desktop.inspection.restart());
    assert.equal(idleCancelled.contentId,first.contentId); assert.equal(idleCancelled.backendPid,first.backendPid);
    assert.equal(await app.evaluate(() => globalThis.__idleRestartPrompts),1);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox=globalThis.__originalDialog; });
    evidence.idleRestartCancellation=true;
    // 仅结束测试自身创建的后端，确认真实故障仍显示且桌面可恢复。
    await app.evaluate((_electron,pid) => process.kill(pid),first.backendPid);
    await desktop.locator('#inspection-status').filter({ hasText:'后端已退出' }).waitFor();
    const faultFrame=await desktop.locator('#inspection-frame').getAttribute('src');
    await business.evaluate(() => { const probe=document.createElement('div'); probe.style.cssText='position:fixed;left:0;top:0;width:100px;height:100px;background:red;z-index:2147483647'; document.body.append(probe); });
    await desktop.waitForFunction(previous => document.querySelector('#inspection-frame').src!==previous,faultFrame);
    assert.match(await desktop.locator('#inspection-status').textContent(),/后端已退出/);
    evidence.faultPersistsAcrossFrames=true;
    // 模拟操作员分别取消、确认原生重启对话框，断言两条生命周期路径。
    await app.evaluate(({ dialog }) => { globalThis.__originalDialog=dialog.showMessageBox; globalThis.__restartPrompts=0; dialog.showMessageBox=async () => { globalThis.__restartPrompts++; return { response:0 }; }; });
    const cancelled=await desktop.evaluate(() => window.desktop.inspection.restart());
    assert.equal(cancelled.contentId,first.contentId);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox=async () => { globalThis.__restartPrompts++; return { response:1 }; }; });
    const restarted=await desktop.evaluate(() => window.desktop.inspection.restart());
    assert.notEqual(restarted.backendPid,first.backendPid);
    assert.notEqual(restarted.contentId,first.contentId);
    assert.equal(await app.evaluate(() => globalThis.__restartPrompts),2);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox=globalThis.__originalDialog; });
    business=app.windows().find(page => page.url().startsWith('http://127.0.0.1:'));
    await business.locator('#btn-self-check-complete').waitFor({ timeout:20000 });
    await desktop.waitForFunction(() => document.querySelector('#inspection-frame').naturalWidth>0);
    evidence.restartConfirmation=true;
    evidence.recovery=true;
    // 业务页面本身的退出接口只能退出查验，桌面仍可用。
    const status=await fetch('http://127.0.0.1:18080/api/v1/system/status').then(value => value.json());
    assert.equal(status.data.active,false);
    await business.evaluate(() => window.customInspectShell.quitApp()).catch(error => { if (!business.isClosed()) throw error; });
    await desktop.getByRole('heading',{ name:'虚拟桌面',exact:true }).waitFor();
    assert.equal((await desktop.evaluate(() => window.desktop.inspection.status())).backendPid,null);
    evidence.businessQuitPreservesDesktop=true;
    await assert.rejects(fetch('http://127.0.0.1:18080/api/v1/system/status',{ signal:AbortSignal.timeout(1000) }));
    evidence.ownedBackendStopped=true;
  }
  evidence.result='passed';
} catch(error) { evidence.result='failed'; evidence.error=error.stack; const desktop=app.windows().find(page => page.url().startsWith('file:')); if (desktop) await desktop.screenshot({ path:'artifacts/inspection-failure.png' }).catch(()=>{}); throw error; }
finally {
  await writeFile(`artifacts/inspection-${occupied ? 'conflict' : 'smoke'}.json`,JSON.stringify(evidence,null,2));
  await app.close();
}
console.log(JSON.stringify(evidence,null,2));
