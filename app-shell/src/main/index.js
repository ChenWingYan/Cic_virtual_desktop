import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as electron from 'electron';
import { createInspectionHost } from '../../modules/inspection/public/api.js';
if (process.env.CIC_USER_DATA) app.setPath('userData',path.resolve(process.env.CIC_USER_DATA));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const trustedURL = pathToFileURL(path.join(root,'dist/index.html')).href;
let window;
let quitting = false;
const inspection = createInspectionHost({ electron,desktopWindow:() => window,requestQuit:quitInspection });
/** 只允许可信桌面主框架操作业务组件。 */
function assertDesktop(event) {
  if (!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || event.senderFrame.url!==trustedURL) throw new Error('拒绝不可信来源');
}
/** 原业务退出及工具栏退出都只结束查验，保留桌面。 */
async function quitInspection() { return inspection.close(); }
/** 桌面退出前确认当前任务并等待自有业务资源释放。 */
async function quitDesktop() {
  try { if (!await inspection.close()) return false; quitting=true; app.quit(); return true; }
  catch (error) { if (window && !window.isDestroyed()) window.webContents.send('inspection:state',{ ...inspection.status(),error:error.message }); return false; }
}
/** 创建单屏全屏窗口，仅加载本地可信内容并拒绝外部导航和权限。 */
async function createWindow() {
  session.defaultSession.setPermissionRequestHandler(/* 拒绝页面权限申请。 */ (_contents,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(/* 拒绝页面权限检查。 */ () => false);
  window = new BrowserWindow({ width:1280,height:800,fullscreen:true,autoHideMenuBar:true,backgroundColor:'#081522',webPreferences:{ preload:path.join(root,'app-shell/src/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false } });
  window.webContents.setWindowOpenHandler(/* 拒绝新窗口。 */ () => ({ action:'deny' }));
  window.webContents.on('will-navigate', /* 阻止离开可信页面。 */ event => event.preventDefault());
  window.webContents.on('will-attach-webview', /* 阻止嵌入外部内容。 */ event => event.preventDefault());
  window.on('close', /* 回收业务资源前保留桌面窗口。 */ event => { if (!quitting) { event.preventDefault(); void quitDesktop(); } });
  window.webContents.on('before-input-event', /* 在表单处理前捕获恢复键。 */ (event,input) => {
    if (input.type === 'keyDown' && input.control && input.alt && input.key.toLowerCase() === 'r') { event.preventDefault(); window.webContents.send('desktop:reset'); }
  });
  await window.loadURL(trustedURL);
}
ipcMain.handle('desktop:quit', /* 校验可信主框架后退出。 */ event => {
  assertDesktop(event);
  return quitDesktop();
});
for (const [channel,method] of [['status','status'],['choose-directory','chooseDirectory'],['open','open'],['close','close'],['restart','restart'],['reconnect','reconnect']]) {
  ipcMain.handle(`inspection:${channel}`, /* 仅开放固定业务操作，不接受任意文件或模块路径。 */ async event => { assertDesktop(event); return inspection[method](); });
}
ipcMain.on('inspection:present', /* 同步显示计划及可见状态。 */ (event,payload) => { assertDesktop(event); inspection.present(payload); });
ipcMain.on('inspection:input', /* 转发经过逆变换且校验过的业务输入。 */ (event,payload) => { assertDesktop(event); inspection.input(payload); });
app.whenReady().then(createWindow);
app.on('before-quit', /* 统一处理系统退出和 IPC 退出。 */ event => { if (!quitting) { event.preventDefault(); void quitDesktop(); } });
app.on('window-all-closed', /* 全部窗口清理后结束进程。 */ () => { if (quitting) app.quit(); });
