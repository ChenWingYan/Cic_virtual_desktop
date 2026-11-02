import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const profile = await mkdtemp(path.resolve('artifacts/browser-profile-'));
const videoFixture = await readFile(new URL('../tests/fixtures/sample.webm', import.meta.url));
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>浏览验证页</title><style>body{margin:0;font:20px sans-serif;background:#f5fafc;color:#123}header{padding:24px;background:#d1e9ee}button,a,input{font:inherit;padding:12px;margin:8px}.corner{position:fixed;width:80px;height:50px;margin:0;background:#20b89b;border:0;color:#012}#tl{top:150px;left:12px}#tr{top:150px;right:12px}#bl{bottom:12px;left:12px}#br{bottom:12px;right:12px}#scroll{height:1800px;padding:24px}#edit{width:300px}.drag{position:fixed;left:150px;bottom:30px;padding:15px;background:#afd}#drop{left:360px;background:#fea}</style><header><h1>真实网页 · 输入验证</h1><a id="next" href="/second">下一页</a><a id="popup" href="/second?popup" target="_blank">新窗口链接</a><a id="download" href="/download">下载文件</a><input type="file" id="upload"><input id="edit" placeholder="输入文字"></header><button id="tl" class="corner">左上</button><button id="tr" class="corner">右上</button><button id="bl" class="corner">左下</button><button id="br" class="corner">右下</button><div draggable="true" id="drag" class="drag">拖动</div><div id="drop" class="drag">放置区</div><div id="scroll">滚动区域<p id="result"></p></div><script>window.hits=[];for(const id of ['tl','tr','bl','br'])document.getElementById(id).onclick=/* 记录真实命中并改变颜色。 */()=>{window.hits.push(id);document.getElementById(id).style.background='#f90'};document.getElementById('drag').ondragstart=/* 写入网页内部拖动数据。 */e=>e.dataTransfer.setData('text/plain','ok');document.getElementById('drop').ondragover=/* 允许网页接收内部拖放。 */e=>e.preventDefault();document.getElementById('drop').ondrop=/* 记录实际到达的拖放数据。 */e=>{e.preventDefault();window.dropped=e.dataTransfer.getData('text/plain')};</script></html>`;
const server = createServer(/* 提供不依赖外网的真实网页及下载响应。 */ (request, response) => {
  if (request.url === '/video') { response.writeHead(200, { 'Content-Type': 'video/webm' }); response.end(videoFixture); return; }
  if (request.url === '/download') {
    response.writeHead(200, { 'Content-Disposition': 'attachment; filename="blocked.txt"' }); response.end('blocked'); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/fixture') response.setHeader('Set-Cookie', 'cic_browser=retained; Max-Age=3600; Path=/; SameSite=Lax');
  response.end(request.url?.startsWith('/second') ? '<!doctype html><meta charset="utf-8"><title>第二页</title><h1>第二页</h1>' : fixture);
});
await new Promise(/* 等待本次测试独占的随机本机端口。 */ resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, CIC_DESKTOP_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];

/** 启动本次测试拥有的 Electron，不触及现场进程或数据。 */
async function launch() {
  app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow();
  app.process().stderr.on('data', /* 收集主进程错误，便于定位内容初始化失败。 */ data => process.stderr.write(data));
  page.on('pageerror', /* 收集可信桌面的运行时异常。 */ error => errors.push(error.message));
  await page.getByRole('heading', { name: '虚拟桌面', exact: true }).waitFor();
}
/** 通过测试端读取网页状态，不在产品中暴露脚本执行接口。 */
async function guest(source) {
  return app.evaluate(/* 仅测试使用网页进程对象。 */ ({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(/* 选择唯一离屏网页。 */ value => value.isOffscreen());
    if (!contents) throw new Error('网页尚未创建');
    return contents.executeJavaScript(code);
  }, source);
}
/** 有限轮询可观察的页面结果，超时即失败。 */
async function until(read, expected = true) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await read() === expected) return;
    await new Promise(/* 等待异步网页事件，不阻塞 UI。 */ resolve => setTimeout(resolve, 50));
  }
  throw new Error(`等待网页结果超时：${expected}`);
}
/** 将网页内部坐标通过真实画布矩阵变换为输出层坐标。 */
async function outputPoint(selector) {
  const point = await guest(`(/* 读取目标的网页逻辑坐标。 */()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  return page.evaluate(/* 使用当前显示计划定位实际鼠标输入。 */ ({ x, y }) => {
    const canvas = document.querySelector('#canvas');
    let element = document.querySelector('#browser-web');
    while (element && element !== canvas) { x += element.offsetLeft; y += element.offsetTop; element = element.offsetParent; }
    const mapped = new DOMPoint(x, y).matrixTransform(new DOMMatrix(getComputedStyle(canvas).transform));
    const output = document.querySelector('#output').getBoundingClientRect();
    return { x: mapped.x + output.x, y: mapped.y + output.y };
  }, point);
}
/** 用真实鼠标事件命中网页，不用脚本调用 click 冒充输入映射。 */
async function clickGuest(selector) { const point = await outputPoint(selector); await page.mouse.click(point.x, point.y); }
/** 通过可见地址栏发起导航。 */
async function navigate(url) {
  await page.locator('#browser-address').fill(url);
  await page.getByRole('button', { name: '访问', exact: true }).click();
}

try {
  await launch();
  await page.locator('#open-browser').click();
  await page.locator('#browser-address:not([disabled])').waitFor();
  await page.screenshot({ path: 'artifacts/browser-start.png' });
  await navigate(`${base}/fixture`);
  await until(/* 等待真实 HTTP 网页载入。 */ () => guest('document.title'), '浏览验证页');
  assert.deepEqual(await guest('({node:typeof require,desktop:typeof window.desktop})'), { node: 'undefined', desktop: 'undefined' });
  const inputTimings = [];
  for (const orientation of [0, 90, 180, 270]) {
    await page.locator('#browser-home').click();
    await page.locator('#orientation').selectOption(String(orientation));
    await page.locator('#cx').fill('0.8'); await page.locator('#cy').fill('1.2');
    await page.getByRole('button', { name: '应用显示', exact: true }).click();
    await page.locator('#open-browser').click();
    await guest('window.hits=[];window.scrollTo(0,0)');
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const started = Date.now(); await clickGuest(`#${corner}`);
      await until(/* 核对真实点击已进入网页。 */ () => guest(`window.hits.includes('${corner}')`));
      inputTimings.push(Date.now() - started);
    }
    await clickGuest('#edit');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('test'); await page.keyboard.insertText('中文验证');
    await until(/* 程序插入中文仅验证文本传递，不冒充原生输入法测试。 */ () => guest('document.querySelector("#edit").value'), 'test中文验证');
    const scrollPoint = await outputPoint('#tl');
    await page.mouse.move(scrollPoint.x, scrollPoint.y); await page.mouse.wheel(0, 180);
    await until(/* 每个方向均应能滚动网页。 */ () => guest('window.scrollY>0'));
    await page.screenshot({ path: `artifacts/browser-${orientation}.png` });
  }
  await page.keyboard.press('Control+Alt+r');
  await page.locator('#browser-home').click(); await page.locator('#open-browser').click();
  assert.match(await guest('document.querySelector("#edit").value'), /中文验证/);
  await guest('window.scrollTo(0,0)');
  await guest(`(()=>{ /* 准备真实网页中的多行编辑与提交目标。 */
    const editor=document.createElement('textarea');editor.id='multiline';editor.style.cssText='position:fixed;left:300px;top:350px;width:240px;height:80px';document.body.append(editor);
    const form=document.createElement('form');form.style.cssText='position:fixed;left:550px;top:350px';form.innerHTML='<input id="submit-input"><button>提交</button>';
    form.onsubmit=/* 记录实际表单提交次数。 */event=>{event.preventDefault();window.submitted=(window.submitted||0)+1};document.body.append(form);
  })()`);
  await clickGuest('#multiline');
  await page.keyboard.type('ab'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('x');
  await page.keyboard.press('Enter'); await page.keyboard.type('c');
  await until(/* 方向键与 Enter 必须改变网页中的真实选区及文本。 */ () => guest('document.querySelector("#multiline").value'), 'ax\ncb');
  await page.keyboard.press('Home'); await page.keyboard.press('Delete'); await page.keyboard.press('End'); await page.keyboard.press('Backspace');
  await until(/* 核对光标移动及删除键的默认行为。 */ () => guest('document.querySelector("#multiline").value'), 'ax\n');
  await page.keyboard.press('Control+a');
  await page.locator('#browser-input').dispatchEvent('compositionstart', { data: '' });
  await page.locator('#browser-input').dispatchEvent('compositionupdate', { data: '拼' });
  await page.keyboard.insertText('拼音');
  await page.locator('#browser-input').dispatchEvent('compositionend', { data: '拼音' });
  await until(/* 仅验证组合协议与提交排序，不冒充原生输入法验收。 */ () => guest('document.querySelector("#multiline").value'), '拼音');
  await clickGuest('#submit-input'); await page.keyboard.type('query'); await page.keyboard.press('Enter');
  await until(/* Enter 仍应触发表单默认提交。 */ () => guest('window.submitted'), 1);
  const dragStart = await outputPoint('#drag'); const dragEnd = await outputPoint('#drop');
  await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 15 }); await page.mouse.up();
  await until(/* 核对网页收到原生拖放。 */ () => guest('window.dropped'), 'ok');
  await clickGuest('#popup');
  await until(/* 新窗口链接应复用同一页面。 */ () => guest('location.pathname'), '/second');
  assert.equal(await app.evaluate(/* 检查没有额外可见窗口。 */ ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(/* 离屏合成窗口不可见。 */ value => value.isVisible()).length), 1);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await until(/* 后退恢复原网页。 */ () => guest('location.pathname'), '/fixture');
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await until(/* 前进恢复第二页。 */ () => guest('location.pathname'), '/second');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await until(/* 刷新后网页仍可读取。 */ () => guest('document.title'), '第二页');
  await navigate(`${base}/fixture`); await until(/* 等待验证页。 */ () => guest('document.title'), '浏览验证页');
  await guest(`new Promise(/* 限时验证真实视频播放。 */(resolve,reject)=>{
    const deadline=setTimeout(/* 视频加载超时即失败。 */()=>reject(new Error('video fixture timeout')),8000);
    const video=document.createElement('video');video.id='test-video';video.muted=true;video.loop=true;
    video.style.cssText='position:fixed;left:600px;top:350px;width:120px;height:80px';document.body.append(video);
    video.src='/video';video.play().then(/* 视频播放开始后完成准备。 */()=>{clearTimeout(deadline);resolve(true)},reject);
  })`);
  await until(/* 验证视频播放时间确实前进。 */ () => guest('document.querySelector("#test-video").currentTime>0.1'));
  const videoPixel = await page.locator('#browser-web').evaluate(/* 读取离屏合成后的视频像素。 */ canvas => canvas.getContext('2d').getImageData(650, 390, 1, 1).data[0]);
  await until(/* 视频解码产生的新画面必须到达桌面画布。 */ async () => (await page.locator('#browser-web').evaluate(/* 比较视频区域的连续帧。 */ canvas => canvas.getContext('2d').getImageData(650, 390, 1, 1).data[0])) !== videoPixel);
  await page.screenshot({ path: 'artifacts/browser-video.png' });
  await clickGuest('#upload');
  await until(/* 上传在原生选择器出现前被阻止。 */ () => page.locator('#browser-status').textContent(), '首版暂不支持文件上传。');
  await clickGuest('#download');
  await until(/* 下载在保存对话框出现前被阻止。 */ () => page.locator('#browser-status').textContent(), '首版暂不支持文件下载。');
  await navigate('file:///C:/Windows/win.ini');
  assert.match(await page.locator('#browser-status').textContent(), /HTTP/);
  assert.equal(await guest('location.pathname'), '/fixture');
  await guest('location.href="file:///C:/Windows/win.ini"');
  await until(/* 网页本身也不能导航本地文件。 */ () => guest('location.pathname'), '/fixture');
  await navigate('http://127.0.0.1:1/unreachable');
  await until(/* 加载错误应保留可见反馈。 */ async () => (await page.locator('#browser-status').textContent()).includes('失败'));
  await app.close();
  await launch(); await page.locator('#open-browser').click();
  await page.locator('#browser-address:not([disabled])').waitFor();
  assert.equal(await page.locator('#browser-address').inputValue(), '');
  assert.equal(await guest('location.href'), 'about:blank');
  // 先访问不设置 Cookie 的路径，避免把重启后的新 Cookie 当成持久化结果。
  await navigate(`${base}/cookie-check`); await until(/* 检查重启前的 Cookie。 */ () => guest('document.cookie.includes("cic_browser=retained")'));
  const frames = await guest('new Promise(/* 采样当前网页帧间隔。 */resolve=>{const frames=[];let previous;/* 记录逐帧间隔并完成采样。 */function tick(now){if(previous!==undefined)frames.push(now-previous);previous=now;if(frames.length<30)requestAnimationFrame(tick);else resolve(frames)}requestAnimationFrame(tick)})');
  const metrics = await app.evaluate(/* 记录本机原型进程资源，不冒充目标设备测量。 */ ({ app }) => app.getAppMetrics());
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-smoke.json', JSON.stringify({ result: 'passed', orientations: [0, 90, 180, 270], compensation: [0.8, 1.2], clicks: 16, unicodeText: true, keyboardEditing: 'arrow, Home/End, Delete/Backspace, textarea newline and form Enter', compositionProtocol: true, nativeIME: 'not tested', dragDrop: true, wheel: true, video: 'WebM playback and changing composited pixels', popup: 'same page', uploadDownload: 'blocked', cookiesAcrossRestart: true, frameIntervalsMs: frames, automationClickRoundtripMs: inputTimings, metrics, deviceValidation: 'not performed', rendererErrors: errors }, null, 2));
  console.log('Browser smoke passed: 4 orientations, 16 webpage hits, navigation, text, wheel, drag, popup, file guards, cookie restart.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: 'artifacts/browser-failure.png' });
    console.error('网页诊断', await outputPoint('#tl').catch(/* 网页不可用时不掩盖原始失败。 */ () => null), await guest('({width:innerWidth,height:innerHeight,hits:window.hits,active:document.activeElement?.id})').catch(/* 保留原始异常。 */ () => null));
  }
  throw error;
} finally {
  if (app) await app.close();
  await new Promise(/* 仅关闭本次测试创建的 HTTP 服务。 */ resolve => server.close(resolve));
}
