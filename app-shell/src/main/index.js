import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { configureBrowserSession, attachBrowserHost } from '../modules/content-host/public/api.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const trustedURL = pathToFileURL(path.join(root,'dist/index.html')).href;
let window;
let browserHost;
let browserInputQueue = Promise.resolve();
// 冒烟测试使用独立数据目录，避免占用现场校准程序的 Cookie 和进程锁。
if (process.env.CIC_DESKTOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.CIC_DESKTOP_DATA_DIR));
/** 仅向可信桌面发送浏览器操作反馈。 */
function notify(message) { if (window && !window.isDestroyed()) window.webContents.send('browser:notice', message); }
/** 外壳和网页均提供不可被网站吞掉的恢复及返回快捷键。 */
function shortcut(event, input) {
  if (input.type !== 'keyDown') return;
  if (input.control && input.alt && input.key.toLowerCase() === 'r') {
    event.preventDefault(); window.webContents.send('desktop:reset');
  } else if (input.key === 'Escape') {
    event.preventDefault(); window.webContents.send('desktop:home');
  }
}
/** 创建单屏全屏窗口，仅加载本地可信内容并拒绝外部导航和权限。 */
async function createWindow() {
  session.defaultSession.setPermissionRequestHandler(/* 拒绝页面权限申请。 */ (_contents,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(/* 拒绝页面权限检查。 */ () => false);
  const browserSession = configureBrowserSession(session, notify);
  window = new BrowserWindow({ width:1280,height:800,fullscreen:true,autoHideMenuBar:true,backgroundColor:'#081522',webPreferences:{ preload:path.join(root,'app-shell/src/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false } });
  window.webContents.setWindowOpenHandler(/* 拒绝新窗口。 */ () => ({ action:'deny' }));
  window.webContents.on('will-navigate', /* 阻止离开可信页面。 */ event => event.preventDefault());
  window.webContents.on('will-attach-webview', /* 禁止额外网页容器。 */ event => event.preventDefault());
  browserHost = attachBrowserHost(window, notify, browserSession);
  window.on('closed', /* 清理本桌面的离屏网页。 */ () => browserHost.close());
  window.webContents.on('before-input-event', shortcut);
  await window.loadURL(trustedURL);
}
/** 校验所有本机请求的主框架归属，外部网页及子框架不可调用。 */
function assertTrusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedURL) throw new Error('拒绝不可信来源');
}
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
  app.quit();
});
app.whenReady().then(createWindow);
app.on('window-all-closed', /* 最后窗口关闭后结束进程。 */ () => app.quit());
