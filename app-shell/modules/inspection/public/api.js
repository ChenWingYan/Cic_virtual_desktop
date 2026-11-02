import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readInspectionManifest } from './manifest.js';
const require = createRequire(import.meta.url);

/** 创建独立产物加载器；所有业务代码从用户配置目录加载，桌面不依赖业务源码。 */
export function createInspectionHost({ electron,desktopWindow,requestQuit }) {
  const { app,BrowserWindow,dialog,screen } = electron;
  const configFile = path.join(app.getPath('userData'),'inspection-directory.json');
  let configured = process.env.CIC_INSPECTION_DIRECTORY || '';
  if (!configured) { try { configured=JSON.parse(fs.readFileSync(configFile,'utf8')).directory || ''; } catch { /* 首次运行尚未配置目录。 */ } }
  let adapter;
  let content;
  let secondary;
  let operation;
  let contentId = '';
  let version = -1;
  let visible = false;
  let fault = '';
  const pressedButtons=new Set();

  /** 取消拖拽时在业务内容外释放所有按键，避免漏发 mouseUp 或触发原按钮点击。 */
  function cancelInput() {
    if (content && !content.isDestroyed()) for (const button of pressedButtons) content.webContents.sendInputEvent({ type:'mouseUp',x:-1,y:-1,button,clickCount:1 });
    pressedButtons.clear();
  }

  /** 只向可信桌面发送业务状态，离开业务页面后不发送画面。 */
  function emit(channel,payload) { if (!desktopWindow().isDestroyed()) desktopWindow().webContents.send(channel,payload); }
  /** 通知桌面业务故障，保留主页与退出能力。 */
  function reportError(message) { cancelInput(); fault=message; emit('inspection:state',status()); }
  /** 返回可序列化的诊断快照，不暴露 Electron 对象。 */
  function status() { return { directory:configured,contentId,running:Boolean(content && !content.isDestroyed()),error:fault,backendPid:adapter?.getPid() || null }; }
  /** 单次执行启动、关闭操作，避免两个并发请求创建重复后端。 */
  async function exclusive(action) {
    if (operation) throw new Error('查验程序正在启动或退出，请稍候');
    operation=Promise.resolve().then(action);
    try { return await operation; } finally { operation=null; }
  }
  /** 确认后清理业务窗口与自有后端，状态未知也需要确认。 */
  async function dispose(confirm=true,notify=true) {
    if (adapter && confirm && await adapter.isBusy()) {
      const answer=await dialog.showMessageBox(desktopWindow(),{ type:'warning',buttons:['取消','退出查验'],defaultId:0,cancelId:0,message:'存在进行中的查验任务，或无法确认会话状态。是否退出查验？' });
      if (answer.response!==1) return false;
    }
    cancelInput(); visible=false;
    for (const win of [content,secondary]) if (win && !win.isDestroyed()) win.destroy();
    content=null; secondary=null;
    if (adapter) await adapter.stop();
    adapter=null; contentId=''; fault=''; version=-1;
    if (notify) emit('inspection:state',status());
    return true;
  }
  /** 初始化独立接入入口，加载真实业务页面；失败只清理本次创建的资源。 */
  async function openInternal() {
    if (content && !content.isDestroyed()) return status();
    if (adapter) await dispose(false,false);
    const { root,entry }=readInspectionManifest(configured);
    const module=require(entry);
    if (module.apiVersion!==1 || typeof module.createHostedInspection!=='function') throw new Error('业务接入入口不支持当前接口版本');
    fault='';
    adapter=module.createHostedInspection({ electron,root,dataDirectory:path.join(app.getPath('userData'),'inspection'),
      /** 将原业务退出请求转换为受控退出查验。 */
      onQuit:requestQuit,onError:reportError });
    try {
      const spec=await adapter.start();
      if (!spec || spec.width!==1920 || spec.height!==1080 || typeof spec.preload!=='string' || !new URL(spec.url).hostname.match(/^127\.0\.0\.1$/)) throw new Error('业务入口返回无效的页面规格');
      contentId=randomUUID();
      content=new BrowserWindow({ width:spec.width,height:spec.height,show:false,frame:false,useContentSize:true,webPreferences:{ offscreen:true,preload:spec.preload,additionalArguments:spec.additionalArguments,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,partition:'persist:inspection' } });
      adapter.attach(content.webContents);
      content.webContents.setFrameRate(15);
      content.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
      const origin=new URL(spec.url).origin;
      content.webContents.on('will-navigate',(event,url) => { if (new URL(url).origin!==origin) event.preventDefault(); });
      content.webContents.on('render-process-gone',(_event,details) => reportError(`查验页面已退出：${details.reason}`));
      content.webContents.on('paint',(_event,_dirty,image) => { if (visible) emit('inspection:frame',{ contentId,image:image.toDataURL(),width:spec.width,height:spec.height }); });
      content.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
      content.webContents.session.setPermissionCheckHandler(() => false);
      await content.loadURL(spec.url);
      // 保留副屏内容；单显示器时不弹出覆盖桌面的副窗口。
      const primaryId=screen.getPrimaryDisplay().id;
      const display=screen.getAllDisplays().find(item => item.id!==primaryId && String(item.id)===adapter.getConfig().secondaryDisplayId) || screen.getAllDisplays().find(item => item.id!==primaryId);
      if (display) {
        secondary=new BrowserWindow({ ...display.bounds,show:false,autoHideMenuBar:true,title:'查验副屏',webPreferences:{ preload:spec.preload,additionalArguments:spec.additionalArguments.map(value => value==='--shell-screen-role=main' ? '--shell-screen-role=secondary' : value),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'persist:inspection' } });
        adapter.attach(secondary.webContents);
        secondary.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
        secondary.webContents.on('will-navigate',(event,url) => { if (new URL(url).origin!==origin) event.preventDefault(); });
        secondary.on('close',event => { event.preventDefault(); void requestQuit(); });
        await secondary.loadURL(spec.secondaryUrl);
        secondary.setFullScreen(true); secondary.showInactive();
      }
      emit('inspection:state',status());
      return status();
    } catch (error) {
      const message=error.message;
      try { await dispose(false); } catch (cleanup) { throw new Error(`${message}；资源回收失败：${cleanup.message}`); }
      reportError(message); throw error;
    }
  }
  /** 从系统目录选择器配置业务产物；运行期间禁止替换目录。 */
  async function chooseDirectory() {
    return exclusive(async () => {
      if (adapter) throw new Error('请先退出查验，再更换业务目录');
      const result=await dialog.showOpenDialog(desktopWindow(),{ title:'选择包含 inspection-component.json 的业务产物目录',properties:['openDirectory'] });
      if (!result.canceled) {
        readInspectionManifest(result.filePaths[0]);
        configured=result.filePaths[0];
        fs.mkdirSync(path.dirname(configFile),{ recursive:true });
        fs.writeFileSync(configFile,JSON.stringify({ directory:configured }));
      }
      return status();
    });
  }
  /** 同步当前显示计划版本；隐藏时仅暂停画面传输，不停止业务会话。 */
  function present(presentation) {
    if (!Number.isSafeInteger(presentation?.version) || typeof presentation.visible!=='boolean') throw new Error('无效的显示计划');
    if (presentation.version!==version || !presentation.visible) cancelInput();
    version=presentation.version; visible=presentation.visible;
    if (content && !content.isDestroyed()) {
      if (visible) { content.webContents.startPainting(); content.webContents.invalidate(); }
      else content.webContents.stopPainting();
    }
  }
  /** 只接收当前会话和显示版本下的输入，拒绝任意 Electron 参数。 */
  function input(payload) {
    if (!visible || !content || content.isDestroyed() || fault || payload?.contentId!==contentId || payload.version!==version) return;
    const wc=content.webContents;
    if (payload.type==='cancel') { cancelInput(); return; }
    if (payload.type==='text') {
      if (typeof payload.text==='string' && payload.text.length<=4096) void wc.insertText(payload.text);
      return;
    }
    if (payload.type==='keyDown' || payload.type==='keyUp') {
      const allowed=new Set(['Backspace','Delete','Enter','Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
      if (!allowed.has(payload.key)) return;
      wc.sendInputEvent({ type:payload.type,keyCode:payload.key.replace('Arrow',''),modifiers:payload.shift ? ['shift'] : [] }); return;
    }
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y) || payload.x<0 || payload.y<0 || payload.x>=1920 || payload.y>=1080) return;
    const event={ type:payload.type,x:Math.round(payload.x),y:Math.round(payload.y),modifiers:[] };
    if (['mouseDown','mouseUp','mouseMove'].includes(payload.type)) {
      if (!['left','middle','right'].includes(payload.button)) return;
      if (payload.type==='mouseDown') pressedButtons.add(payload.button);
      if (payload.type==='mouseUp') pressedButtons.delete(payload.button);
      wc.sendInputEvent({ ...event,button:payload.button,clickCount:payload.clickCount===2 ? 2 : 1 });
    } else if (payload.type==='mouseWheel' && Number.isFinite(payload.deltaX) && Number.isFinite(payload.deltaY)) {
      wc.sendInputEvent({ ...event,deltaX:Math.max(-2000,Math.min(2000,payload.deltaX)),deltaY:Math.max(-2000,Math.min(2000,payload.deltaY)),canScroll:true });
    }
  }
  return { status,chooseDirectory,present,input,
    /** 打开或恢复业务页面，启动操作保持单次执行。 */
    open:() => exclusive(openInternal),
    /** 重连只刷新页面，避免未经确认重启后端。 */
    reconnect:() => exclusive(async () => { if (!content || content.isDestroyed()) throw new Error('查验尚未运行'); await adapter.readStatus(); fault=''; content.webContents.reload(); emit('inspection:state',status()); return status(); }),
    /** 重启先确认并完整回收旧资源。 */
    restart:() => exclusive(async () => {
      const answer=await dialog.showMessageBox(desktopWindow(),{ type:'warning',buttons:['取消','重启查验'],defaultId:0,cancelId:0,message:'重启查验将关闭当前页面并重新启动后端，当前任务可能中断。是否继续？' });
      if (answer.response!==1) return status();
      const previous={ visible,version };
      await dispose(false,false);
      const result=await openInternal(); present(previous); return result;
    }),
    /** 退出请求同样序列化，防止与启动交叉。 */
    close:() => exclusive(() => dispose(true)) };
}
