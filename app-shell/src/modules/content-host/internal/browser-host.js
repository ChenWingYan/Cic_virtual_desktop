import { BrowserWindow } from 'electron';
const partition = 'persist:cic-browser';

/** 仅允许 HTTP(S)，不读取本地文件或启动外部协议。 */
function isWebURL(value) { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }

/** 配置独立持久会话，禁止下载和未经授权的权限。 */
export function configureBrowserSession(session, notify) {
  const browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler(/* 拒绝并反馈权限申请。 */ (_contents, permission, callback) => { callback(false); notify(`首版暂不支持网站权限：${permission}`); });
  browserSession.setPermissionCheckHandler(/* 不隐式授予权限。 */ () => false);
  browserSession.on('will-download', /* 在保存窗口出现前拒绝下载。 */ event => { event.preventDefault(); notify('首版暂不支持文件下载。'); });
  browserSession.webRequest.onBeforeRequest(/* 拦截本地文件及非网页主框架。 */ (details, callback) => {
    const allowed = ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:'].includes(new URL(details.url).protocol);
    callback({ cancel: !allowed || (details.resourceType === 'mainFrame' && !isWebURL(details.url) && details.url !== 'about:blank') });
  });
  return browserSession;
}

/** 以版本化画面和受控输入管理唯一离屏网页，不显示原生网页窗口。 */
export function attachBrowserHost(window, notify, browserSession) {
  let contentWindow, contents, initialization;
  let version = -1, visible = false, failed = false;
  let dragData;
  let pointer = { x: 0, y: 0 };
  /** 网页内部拖拽由 Chromium 协议完成，不调用系统文件拖放。 */
  async function dispatchDrag(type) { if (dragData && contents && !contents.isDestroyed()) await contents.debugger.sendCommand('Input.dispatchDragEvent', { type, ...pointer, data: dragData }); }
  let state = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, cursor: 'default' };
  /** 只向可信桌面发送导航状态。 */
  function publish() {
    if (!contents || contents.isDestroyed() || window.isDestroyed()) return;
    state = { ...state, url: contents.getURL() === 'about:blank' ? '' : contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(), canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() };
    window.webContents.send('browser:state', state);
  }
  /** 页面跳转和重定向使用相同的协议边界。 */
  function guardNavigation(event, url) { if (!isWebURL(url) && url !== 'about:blank') { event.preventDefault(); notify('仅支持 HTTP 或 HTTPS 网页地址。'); } }
  /** 延迟创建网页，先安装文件选择拦截器再开放导航。 */
  async function create() {
    contentWindow = new BrowserWindow({ show: false, width: 960, height: 608, webPreferences: { session: browserSession, offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, disableDialogs: true, backgroundThrottling: false } });
    contents = contentWindow.webContents;
    contents.setFrameRate(30);
    contents.on('paint', /* 使用整帧，拒绝混用脏矩形和显示版本。 */ (_event, _dirty, image) => { if (visible && version >= 0 && !window.isDestroyed()) window.webContents.send('browser:frame', { version, bytes: image.toPNG() }); });
    contents.on('will-navigate', guardNavigation); contents.on('will-redirect', guardNavigation);
    contents.setWindowOpenHandler(/* 新窗口链接在当前网页导航。 */ ({ url }) => {
      if (isWebURL(url)) setImmediate(/* 离开窗口创建回调再导航。 */ () => { if (!contents.isDestroyed()) contents.loadURL(url).catch(/* 保留失败反馈。 */ () => notify('新窗口链接加载失败，请重试。')); });
      else notify('首版仅支持 HTTP(S) 新窗口链接。');
      return { action: 'deny' };
    });
    contents.on('did-start-loading', /* 开始新的加载周期。 */ () => { failed = false; publish(); });
    contents.on('did-stop-loading', /* 不覆盖主框架失败信息。 */ () => { publish(); if (failed) notify('网页加载失败。请检查网址或网络，然后刷新重试。'); });
    for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) contents.on(event, publish);
    contents.on('did-fail-load', /* 忽略取消导航与子框架失败。 */ (_event, code, _description, _url, main) => { if (code !== -3 && main) { failed = true; publish(); notify('网页加载失败。请检查网址或网络，然后刷新重试。'); } });
    contents.on('cursor-changed', /* 光标与网页状态一起更新。 */ (_event, type) => { state.cursor = type; publish(); });
    contents.on('render-process-gone', /* 提供崩溃恢复入口。 */ () => notify('网页进程已停止，请刷新网页。'));
    // 先建立空白文档的渲染目标；未加载文档时 Page 命令可能一直等待目标创建。
    await contents.loadURL('about:blank');
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Page.enable');
    await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true });
    await contents.debugger.sendCommand('Input.setInterceptDrags', { enabled: true });
    contents.debugger.on('message', /* 原生文件选择被拒绝，网页内部拖放转为受控事件。 */ (_event, method, params) => {
      if (method === 'Page.fileChooserOpened') notify('首版暂不支持文件上传。');
      if (method === 'Input.dragIntercepted') {
        dragData = { items: params.data.items, dragOperationsMask: params.data.dragOperationsMask };
        dispatchDrag('dragEnter').then(/* 建立拖入状态后更新当前落点。 */ () => dispatchDrag('dragOver')).catch(/* 失败时不留挂起的拖放。 */ () => { dragData = undefined; notify('网页拖拽未完成，请重试。'); });
      }
    });
    contents.debugger.on('detach', /* 拦截器失效时停止网页。 */ () => { if (!contents.isDestroyed() && !window.isDestroyed()) { notify('网页保护已停止，请退出软件后重新打开。'); contentWindow.destroy(); } });
  }
  return {
    /** 仅创建一次网页，失败清理本模块资源。 */
    async open() {
      if (!initialization) initialization = create().catch(/* 初始化失败不继续浏览。 */ error => { if (contentWindow && !contentWindow.isDestroyed()) contentWindow.destroy(); initialization = undefined; throw error; });
      await initialization;
      if (!contents || contents.isDestroyed()) throw new Error('浏览器已停止，请重启软件。');
      publish(); return state;
    },
    /** 同步逻辑视口和显示版本；隐藏时停绘但保留会话。 */
    present(request) {
      if (!contents || contents.isDestroyed()) return;
      const { width, height, visible: nextVisible, version: nextVersion } = request;
      if (![width, height].every(/* 限定网页画布尺寸。 */ v => Number.isInteger(v) && v >= 1 && v <= 4096) || !Number.isInteger(nextVersion) || nextVersion < version || typeof nextVisible !== 'boolean') throw new Error('无效显示计划');
      version = nextVersion; visible = nextVisible;
      const size = contentWindow.getContentSize();
      if (size[0] !== width || size[1] !== height) contentWindow.setContentSize(width, height);
      if (visible) { contents.startPainting(); contents.invalidate(); } else contents.stopPainting();
    },
    /** 校验命令与网址，不提供任意脚本接口。 */
    async command(command, value) {
      if (!contents || contents.isDestroyed()) throw new Error('浏览器尚未就绪');
      if (command === 'navigate') {
        if (typeof value !== 'string' || value.length > 8192 || !isWebURL(value)) throw new Error('仅支持 HTTP 或 HTTPS 网页地址。');
        await contents.loadURL(value);
      } else if (command === 'back') { if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); }
      else if (command === 'forward') { if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); }
      else if (command === 'reload') contents.reload();
      else throw new Error('不支持的浏览器命令');
    },
    /** 只接受当前版本的受限坐标、按键、文本及输入法组合。 */
    async input(input) {
      if (!contents || contents.isDestroyed() || !visible || input.version !== version) return;
      const { type } = input;
      if (type === 'cancel') { dragData = undefined; await contents.debugger.sendCommand('Input.cancelDragging'); return; }
      if (type === 'text' || type === 'composition') {
        if (typeof input.text !== 'string' || input.text.length > 16384) return;
        if (type === 'text') await contents.insertText(input.text);
        else await contents.debugger.sendCommand('Input.imeSetComposition', { text: input.text, selectionStart: input.text.length, selectionEnd: input.text.length });
        return;
      }
      if (['keyDown', 'keyUp'].includes(type)) {
        if (typeof input.keyCode !== 'string' || input.keyCode.length > 40) return;
        const modifiers = Array.isArray(input.modifiers) ? input.modifiers.filter(/* 过滤修饰键。 */ key => ['shift', 'control', 'alt', 'meta'].includes(key)) : [];
        contents.sendInputEvent({ type, keyCode: input.keyCode, modifiers }); return;
      }
      if (!['mouseDown', 'mouseUp', 'mouseMove', 'mouseWheel', 'mouseLeave'].includes(type)) return;
      const [width, height] = contentWindow.getContentSize();
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0 || input.x >= width || input.y >= height) return;
      pointer = { x: Math.floor(input.x), y: Math.floor(input.y) };
      if (dragData && (type === 'mouseMove' || type === 'mouseUp')) {
        await dispatchDrag(type === 'mouseUp' ? 'drop' : 'dragOver');
        if (type === 'mouseUp') dragData = undefined;
        return;
      }
      const modifiers = [];
      if (Number.isInteger(input.buttons)) {
        if (input.buttons & 1) modifiers.push('leftButtonDown');
        if (input.buttons & 2) modifiers.push('rightButtonDown');
        if (input.buttons & 4) modifiers.push('middleButtonDown');
      }
      const event = { type, x: Math.floor(input.x), y: Math.floor(input.y), button: ['left', 'right', 'middle'].includes(input.button) ? input.button : 'left', modifiers, clickCount: input.clickCount === 2 ? 2 : 1 };
      if (type === 'mouseWheel') {
        if (!Number.isFinite(input.deltaX) || !Number.isFinite(input.deltaY)) return;
        Object.assign(event, { deltaX: Math.max(-2000, Math.min(2000, input.deltaX)), deltaY: Math.max(-2000, Math.min(2000, input.deltaY)), canScroll: true });
      }
      contents.sendInputEvent(event);
    },
    /** 仅销毁本模块创建的网页窗口。 */
    close() { if (contentWindow && !contentWindow.isDestroyed()) contentWindow.destroy(); },
  };
}
