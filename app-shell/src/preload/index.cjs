const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  /** 仅允许可信界面请求退出，不暴露任意 IPC。 */
  quit: () => ipcRenderer.invoke('desktop:quit'),
  /** 接收主进程捕获的恢复快捷键，不泄漏事件对象。 */
  onReset: (listener) => ipcRenderer.on('desktop:reset', () => listener()),
});
