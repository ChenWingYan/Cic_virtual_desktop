const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  /** 仅允许可信界面请求退出，不暴露任意 IPC。 */
  quit: () => ipcRenderer.invoke('desktop:quit'),
  /** 接收主进程捕获的恢复快捷键，不泄漏事件对象。 */
  onReset: (listener) => ipcRenderer.on('desktop:reset', /* 仅转发恢复通知。 */ () => listener()),
  inspection: {
    /** 查询配置目录与运行状态。 */
    status: () => ipcRenderer.invoke('inspection:status'),
    /** 通过原生选择器选择独立业务产物目录。 */
    chooseDirectory: () => ipcRenderer.invoke('inspection:choose-directory'),
    /** 进入或恢复查验内容。 */
    open: () => ipcRenderer.invoke('inspection:open'),
    /** 确认并退出查验，保留桌面。 */
    close: () => ipcRenderer.invoke('inspection:close'),
    /** 重连当前页面，不重启业务进程。 */
    reconnect: () => ipcRenderer.invoke('inspection:reconnect'),
    /** 经确认后重新创建业务资源。 */
    restart: () => ipcRenderer.invoke('inspection:restart'),
    /** 同步画面及输入版本。 */
    present: (payload) => ipcRenderer.send('inspection:present',payload),
    /** 转发固定格式的业务输入。 */
    input: (payload) => ipcRenderer.send('inspection:input',payload),
    /** 订阅业务画面，不向页面泄漏 IPC 事件。 */
    onFrame: (listener) => { const handler=(_event,payload) => listener(payload); ipcRenderer.on('inspection:frame',handler); return () => ipcRenderer.removeListener('inspection:frame',handler); },
    /** 订阅业务故障和退出状态。 */
    onState: (listener) => { const handler=(_event,payload) => listener(payload); ipcRenderer.on('inspection:state',handler); return () => ipcRenderer.removeListener('inspection:state',handler); },
  },
});
