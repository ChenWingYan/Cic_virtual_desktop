const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  /** 浏览本地目录，不暴露 Node 文件对象。 */
  openFiles: (target) => ipcRenderer.invoke('files:open',target),
  /** 获取系统常用目录。 */
  filePlaces: () => ipcRenderer.invoke('files:places'),
  /** 提交有界的文件操作。 */
  fileOperation: (request) => ipcRenderer.invoke('files:operate',request),
  /** 回答主进程产生的冲突或删除问题。 */
  answerFileQuestion: (id,answer) => ipcRenderer.send('files:answer',id,answer),
  /** 离开文件管理器时释放订阅资源。 */
  closeFiles: () => ipcRenderer.send('files:close'),
  /** 接收纯数据目录快照。 */
  onFilesSnapshot: (listener) => ipcRenderer.on('files:snapshot', /* 不转发 IPC 事件对象。 */ (_event,value) => listener(value)),
  /** 接收需要用户明确选择的问题。 */
  onFileQuestion: (listener) => ipcRenderer.on('files:question', /* 不转发 IPC 事件对象。 */ (_event,value) => listener(value)),
  /** 仅允许可信界面请求退出，不暴露任意 IPC。 */
  quit: () => ipcRenderer.invoke('desktop:quit'),
  /** 接收主进程捕获的恢复快捷键，不泄漏事件对象。 */
  onReset: (listener) => ipcRenderer.on('desktop:reset', /* 仅转发恢复通知。 */ () => listener()),
  /** 接收全局返回桌面快捷键，不暴露事件对象。 */
  onHome: (listener) => ipcRenderer.on('desktop:home', /* 只转发返回通知。 */ () => listener()),
  /** 创建离屏网页，不暴露页面对象。 */
  openBrowser: () => ipcRenderer.invoke('browser:open'),
  /** 只允许枚举的网页导航操作。 */
  browserCommand: (command, value) => ipcRenderer.invoke('browser:command', command, value),
  /** 同步逻辑视口与版本。 */
  presentBrowser: (request) => ipcRenderer.send('browser:present', request),
  /** 输入数据由主进程再次验证。 */
  browserInput: (input) => ipcRenderer.send('browser:input', input),
  /** 接收版本化画面，不泄漏 IPC 事件对象。 */
  onBrowserFrame: (listener) => ipcRenderer.on('browser:frame', /* 仅转发帧。 */ (_event, frame) => listener(frame)),
  /** 接收导航状态，不泄漏 IPC 事件对象。 */
  onBrowserState: (listener) => ipcRenderer.on('browser:state', /* 仅转发状态。 */ (_event, state) => listener(state)),
  /** 仅转发主进程产生的操作反馈。 */
  onBrowserNotice: (listener) => ipcRenderer.on('browser:notice', /* 仅暴露文字。 */ (_event, message) => listener(message)),
});
