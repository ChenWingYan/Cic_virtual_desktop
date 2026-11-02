import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { createLocalFiles } from '../modules/local-files/public/api.js';
import { discoverLocalDrives } from '../modules/local-files/public/windows.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { configureBrowserSession, attachBrowserHost } from '../modules/content-host/public/api.js';
import * as electron from 'electron';
import { createInspectionHost } from '../modules/inspection/public/api.js';
if (process.env.CIC_USER_DATA) app.setPath('userData',path.resolve(process.env.CIC_USER_DATA));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const trustedURL = pathToFileURL(path.join(root,'dist/index.html')).href;
let window;
let browserHost;
let files, drives;
const fileQuestions = new Map();
let browserInputQueue = Promise.resolve();
let quitting=false;
let inspection;
// 冒烟测试使用独立数据目录，避免占用现场校准程序的 Cookie 和进程锁。
if (process.env.CIC_DESKTOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.CIC_DESKTOP_DATA_DIR));
inspection=createInspectionHost({ electron,desktopWindow:() => window,requestQuit:() => inspection.close() });
/** 退出桌面前确认业务状态并等待自有资源清理。 */
async function quitDesktop() {
  try { if (!await inspection.close()) return false; quitting=true; app.quit(); return true; }
  catch(error) { if (window && !window.isDestroyed()) window.webContents.send('inspection:state',{ ...inspection.status(),error:error.message }); return false; }
}
/** 仅向可信桌面发送浏览器操作反馈。 */
function notify(message) { if (window && !window.isDestroyed()) window.webContents.send('browser:notice', message); }
/** 外壳和网页均提供不可被网站吞掉的恢复及返回快捷键。 */
function shortcut(event, input) {
  if (input.type !== 'keyDown') return;
  if (input.control && input.alt && input.key.toLowerCase() === 'r') {
    event.preventDefault(); window.webContents.send('desktop:reset');
  } else if (input.key === 'Escape' && !inspection.isVisible()) {
    event.preventDefault(); window.webContents.send('desktop:home');
  }
}
/** 创建单屏全屏窗口，仅加载本地可信内容并拒绝外部导航和权限。 */
async function createWindow() {
  drives = discoverLocalDrives();
  // 打包后 root 位于 resources/app；同时保护外层可执行文件和 Electron 运行时。
  const installation = app.isPackaged ? path.dirname(process.execPath) : root;
  files = createLocalFiles({ roots:drives.roots, protectedPaths:[installation,root,app.getPath('userData'),app.getPath('logs'),app.getPath('sessionData')], trash: shell.trashItem, ask:askFileQuestion });
  files.subscribe(/* 只向可信桌面发布文件快照。 */ snapshot => { if (window && !window.isDestroyed()) window.webContents.send('files:snapshot',snapshot); });
  session.defaultSession.setPermissionRequestHandler(/* 拒绝页面权限申请。 */ (_contents,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(/* 拒绝页面权限检查。 */ () => false);
  const browserSession = configureBrowserSession(session, notify);
  window = new BrowserWindow({ width:1280,height:800,fullscreen:true,autoHideMenuBar:true,backgroundColor:'#081522',webPreferences:{ preload:path.join(root,'app-shell/src/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false } });
  window.webContents.setWindowOpenHandler(/* 拒绝新窗口。 */ () => ({ action:'deny' }));
  window.webContents.on('will-navigate', /* 阻止离开可信页面。 */ event => event.preventDefault());
  window.webContents.on('will-attach-webview', /* 禁止额外网页容器。 */ event => event.preventDefault());
  window.on('close', /* 业务资源释放之前保留可信桌面。 */ event => { if (!quitting) { event.preventDefault(); void quitDesktop(); } });
  browserHost = attachBrowserHost(window, notify, browserSession);
  window.on('closed', /* 清理本桌面的离屏网页。 */ () => browserHost.close());
  window.on('closed', /* 释放目录监听、磁盘发现与等待中的问题。 */ () => { files.close(); drives.close(); for (const resolve of fileQuestions.values()) resolve('cancel'); fileQuestions.clear(); });
  window.webContents.on('before-input-event', shortcut);
  await window.loadURL(trustedURL);
}
/** 校验所有本机请求的主框架归属，外部网页及子框架不可调用。 */
function assertTrusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedURL) throw new Error('拒绝不可信来源');
}
/** 在受管理界面提问，超时或窗口关闭时取消，不默认授权覆盖或删除。 */
function askFileQuestion(question) {
  return new Promise(/* 问题使用不可猜测编号，回答入口校验可信来源。 */ resolve => {
    const id = randomUUID();
    const timeout = setTimeout(/* 无回答则安全取消。 */ () => finish('cancel'),300000);
    /** 释放问题与超时，再继续当前操作。 */
    function finish(answer) { clearTimeout(timeout); fileQuestions.delete(id); resolve(answer); }
    fileQuestions.set(id,finish);
    if (!window || window.isDestroyed()) finish('cancel');
    else window.webContents.send('files:question',{ ...question,id });
  });
}
ipcMain.handle('files:open', /* 只允许可信桌面浏览本地目录。 */ async (event,target) => { assertTrusted(event); if (target !== undefined && typeof target !== 'string') throw new Error('路径无效。'); return files.open(target); });
ipcMain.handle('files:places', /* 常用目录使用 Windows 实际配置，不猜用户名或磁盘。 */ event => { assertTrusted(event); return [{ name:'桌面',path:app.getPath('desktop') },{ name:'下载',path:app.getPath('downloads') },{ name:'文档',path:app.getPath('documents') }]; });
ipcMain.handle('files:operate', /* 文件变更在主进程再次校验。 */ async (event,request) => { assertTrusted(event); return files.operate(request); });
ipcMain.on('files:answer', /* 只有可信界面可回答已存在的问题。 */ (event,id,answer) => { try { assertTrusted(event); if (['cancel','skip','keep','overwrite','trash','permanent'].includes(answer)) fileQuestions.get(id)?.(answer); } catch { /* 拒绝不可信回答。 */ } });
ipcMain.on('files:close', /* 离开界面时释放监听并取消尚未授权的步骤。 */ event => { try { assertTrusted(event); files.close(); for (const resolve of fileQuestions.values()) resolve('cancel'); } catch { /* 不接受外部关闭。 */ } });
ipcMain.handle('browser:open', /* 创建唯一离屏网页。 */ async event => { assertTrusted(event); return browserHost.open(); });
ipcMain.handle('browser:command', /* 验证来源后交给内容承载。 */ async (event, command, value) => { assertTrusted(event); return browserHost.command(command, value); });
ipcMain.on('browser:present', /* 同步当前显示计划。 */ (event, request) => { try { assertTrusted(event); browserHost.present(request); } catch { notify('网页显示计划无效。'); } });
ipcMain.on('browser:input', /* 输入仅来自可信桌面，内容承载再次校验。 */ (event, input) => {
  try {
    assertTrusted(event);
    // 组合输入通过 CDP，提交文本通过 Electron；串行执行，避免两条通道乱序。
    browserInputQueue = browserInputQueue.then(/* 按接收顺序完成当前输入。 */ () => browserHost.input(input)).catch(/* 输入失败后仍接受后续操作。 */ () => notify('网页输入未完成，请重试。'));
  } catch { notify('拒绝无效网页输入。'); }
});
ipcMain.handle('desktop:quit', /* 校验可信主框架后退出。 */ event => {
  assertTrusted(event);
  return quitDesktop();
});
for (const [channel,method] of [['status','status'],['choose-directory','chooseDirectory'],['open','open'],['close','close'],['restart','restart'],['reconnect','reconnect']]) {
  ipcMain.handle(`inspection:${channel}`, /* 仅开放固定组件操作，不接受页面指定的模块路径。 */ async event => { assertTrusted(event); return inspection[method](); });
}
ipcMain.on('inspection:present', /* 同步查验显示计划。 */ (event,payload) => { try { assertTrusted(event); inspection.present(payload); } catch { /* 拒绝非法显示计划。 */ } });
ipcMain.on('inspection:input', /* 只转发可信桌面的有限输入字段。 */ (event,payload) => { try { assertTrusted(event); inspection.input(payload); } catch { /* 非法输入不影响其他桌面入口。 */ } });
app.whenReady().then(createWindow);
app.on('before-quit', /* 所有退出途径都先完成查验清理。 */ event => { if (!quitting) { event.preventDefault(); void quitDesktop(); } });
app.on('window-all-closed', /* 所有窗口清理后退出。 */ () => { if (quitting) app.quit(); });
