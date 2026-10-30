import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const trustedURL = pathToFileURL(path.join(root,'dist/index.html')).href;
let window;
/** 创建单屏全屏窗口，仅加载本地可信内容并拒绝外部导航和权限。 */
async function createWindow() {
  session.defaultSession.setPermissionRequestHandler(/* 拒绝页面权限申请。 */ (_contents,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(/* 拒绝页面权限检查。 */ () => false);
  window = new BrowserWindow({ width:1280,height:800,fullscreen:true,autoHideMenuBar:true,backgroundColor:'#081522',webPreferences:{ preload:path.join(root,'app-shell/src/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false } });
  window.webContents.setWindowOpenHandler(/* 拒绝新窗口。 */ () => ({ action:'deny' }));
  window.webContents.on('will-navigate', /* 阻止离开可信页面。 */ event => event.preventDefault());
  window.webContents.on('will-attach-webview', /* 阻止嵌入外部内容。 */ event => event.preventDefault());
  window.webContents.on('before-input-event', /* 在表单处理前捕获恢复键。 */ (event,input) => {
    if (input.type === 'keyDown' && input.control && input.alt && input.key.toLowerCase() === 'r') { event.preventDefault(); window.webContents.send('desktop:reset'); }
  });
  await window.loadURL(trustedURL);
}
ipcMain.handle('desktop:quit', /* 校验可信主框架后退出。 */ event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedURL) throw new Error('拒绝不可信来源');
  app.quit();
});
app.whenReady().then(createWindow);
app.on('window-all-closed', /* 最后窗口关闭后结束进程。 */ () => app.quit());
