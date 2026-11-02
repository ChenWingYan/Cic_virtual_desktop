import { normalizeAddress } from './url';
import { mapOutputInput, type DisplayPlan } from '../../display-geometry/public/api';
import type { BrowserInputPayload, BrowserState } from '../../../shared/contracts/browser';

/** 创建持久浏览器面板；网页通过离屏帧与受限输入契约接入。
 * @param returnHome 请求桌面会话返回主页，不销毁网页。
 */
export function createBrowserPanel(returnHome: () => void) {
  const element = document.createElement('section'); element.id = 'browser-panel';
  element.innerHTML = `<header class="browser-toolbar"><button id="browser-home">← 返回桌面</button><button id="browser-back" aria-label="后退" disabled>←</button><button id="browser-forward" aria-label="前进" disabled>→</button><button id="browser-reload" aria-label="刷新" disabled>↻</button><form id="browser-address-form"><input id="browser-address" aria-label="网页地址" placeholder="输入网址，例如 https://example.com" autocomplete="off" spellcheck="false" inputmode="url" disabled><button id="browser-go" disabled>访问</button></form></header><div id="browser-status" role="status" aria-live="polite">正在准备浏览器…</div><div class="browser-viewport"><canvas id="browser-web" aria-label="网页内容"></canvas><textarea id="browser-input" aria-label="网页输入" autocomplete="off" spellcheck="false"></textarea><div id="browser-welcome"><div class="welcome-symbol">◎</div><h1>开始浏览</h1><p>在上方输入网页地址，打开你需要的网站。</p><p class="welcome-note">返回桌面后，可随时继续当前网页。</p></div></div>`;
  const web = element.querySelector<HTMLCanvasElement>('#browser-web')!;
  const viewport = element.querySelector<HTMLElement>('.browser-viewport')!;
  const proxy = element.querySelector<HTMLTextAreaElement>('#browser-input')!;
  const address = element.querySelector<HTMLInputElement>('#browser-address')!;
  const back = element.querySelector<HTMLButtonElement>('#browser-back')!;
  const forward = element.querySelector<HTMLButtonElement>('#browser-forward')!;
  const reload = element.querySelector<HTMLButtonElement>('#browser-reload')!;
  const status = element.querySelector<HTMLElement>('#browser-status')!;
  const welcome = element.querySelector<HTMLElement>('#browser-welcome')!;
  let plan: DisplayPlan | undefined;
  let ready = false, visible = true, hasPage = false, decoding = false;
  let composing = false;
  let lastNavigation = '';
  let lastPoint = { x: 0, y: 0 };
  let heldButton: string | undefined;
  const heldKeys = new Set<string>();
  /** 安全显示来自网页或主进程的文字。 */
  function notice(message: string): void { status.textContent = message; }
  /** 仅发送当前计划版本的输入。 */
  function send(input: BrowserInputPayload): void { if (ready && visible && plan) window.desktop.browserInput({ ...input, version: plan.version }); }
  /** 同步网页逻辑视口；画布像素由离屏内容自行绘制。 */
  function present(): void {
    if (!ready || !plan) return;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    if (web.width !== width || web.height !== height) { web.width = width; web.height = height; }
    window.desktop.presentBrowser({ width, height, visible, version: plan.version });
  }
  /** 使用统一逆矩阵，将输出坐标换算为网页内的逻辑坐标。 */
  function point(event: MouseEvent): { x: number; y: number } | undefined {
    if (!plan) return;
    const output = document.querySelector('#output')!.getBoundingClientRect();
    const mapped = mapOutputInput(plan, { x: event.clientX - output.left, y: event.clientY - output.top });
    if (mapped.kind !== 'hit') return;
    let x = mapped.point.x, y = mapped.point.y;
    let node: HTMLElement | null = viewport;
    while (node && node.id !== 'canvas') { x -= node.offsetLeft; y -= node.offsetTop; node = node.offsetParent as HTMLElement | null; }
    return { x: Math.max(0, Math.min(viewport.clientWidth - 1, x)), y: Math.max(0, Math.min(viewport.clientHeight - 1, y)) };
  }
  /** 转发鼠标及触摸指针，保留按下到释放的归属。 */
  function pointer(event: PointerEvent): void {
    const position = point(event); if (!position || !hasPage) return;
    event.preventDefault(); lastPoint = position;
    const button = ['left', 'middle', 'right'][event.button] ?? heldButton ?? 'left';
    if (event.type === 'pointerdown') {
      heldButton = button; web.setPointerCapture(event.pointerId);
      proxy.style.left = `${position.x}px`; proxy.style.top = `${position.y}px`;
      proxy.focus({ preventScroll: true });
    }
    send({ ...position, type: event.type === 'pointerdown' ? 'mouseDown' : event.type === 'pointermove' ? 'mouseMove' : 'mouseUp', button, buttons: event.buttons, clickCount: event.detail });
    if (event.type === 'pointerup' || event.type === 'pointercancel') { heldButton = undefined; if (web.hasPointerCapture(event.pointerId)) web.releasePointerCapture(event.pointerId); }
  }
  /** 离开网页前释放按键和指针，避免网页保留卡住的输入。 */
  function release(): void {
    send({ type: 'cancel' });
    if (composing) { send({ type: 'composition', text: '' }); composing = false; proxy.value = ''; }
    if (heldButton) send({ ...lastPoint, type: 'mouseUp', button: heldButton });
    for (const keyCode of heldKeys) send({ type: 'keyUp', keyCode });
    heldButton = undefined; heldKeys.clear();
  }
  /** 网页状态只改变工具栏文字和能力，不重建网页会话。 */
  function update(state: BrowserState): void {
    back.disabled = !state.canGoBack; forward.disabled = !state.canGoForward; reload.disabled = !hasPage;
    if (state.url && document.activeElement !== address) address.value = state.url;
    web.style.cursor = ({ hand: 'pointer', ibeam: 'text', pointer: 'default' } as Record<string, string>)[state.cursor] ?? state.cursor;
    const navigation = JSON.stringify([state.url, state.title, state.loading]);
    if (navigation !== lastNavigation) {
      lastNavigation = navigation;
      notice(state.loading ? '正在加载网页…' : hasPage ? state.title || '网页已加载' : '输入 HTTP 或 HTTPS 网址开始浏览。');
    }
  }
  /** 从地址栏导航，错误以可见文本反馈。 */
  async function navigate(event: Event): Promise<void> {
    event.preventDefault(); if (!ready) return;
    try {
      const url = normalizeAddress(address.value); address.value = url;
      hasPage = true; welcome.hidden = true; reload.disabled = false;
      await window.desktop.browserCommand('navigate', url);
    } catch (error) { notice(error instanceof Error ? error.message : '网页加载失败，请重试。'); }
  }
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) web.addEventListener(name, pointer as EventListener);
  web.addEventListener('contextmenu', /* 不弹出未经方向校正的原生菜单。 */ event => event.preventDefault());
  web.addEventListener('wheel', /* 滚轮始终改变网页逻辑滚动位置。 */ event => {
    event.preventDefault(); const position = point(event);
    if (position) send({ ...position, type: 'mouseWheel', deltaX: -event.deltaX, deltaY: -event.deltaY });
  }, { passive: false });
  proxy.addEventListener('keydown', /* 保持焦点在输入代理，网页负责键盘导航。 */ event => {
    if (event.isComposing || event.key === 'Process') return;
    // 粘贴先交给本地输入代理读取纯文本，避免远端快捷键与本地 input 重复插入。
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    const keyCode = event.key === ' ' ? 'Space' : event.key;
    const modifiers = [event.shiftKey && 'shift', event.ctrlKey && 'control', event.altKey && 'alt', event.metaKey && 'meta'].filter(Boolean) as string[];
    heldKeys.add(keyCode); send({ type: 'keyDown', keyCode, modifiers });
    if (event.key.length > 1 || event.ctrlKey || event.altKey || event.metaKey) event.preventDefault();
  });
  proxy.addEventListener('keyup', /* 同步真实按键释放，忽略输入法内部处理键。 */ event => { if (event.isComposing || event.key === 'Process') return; const keyCode = event.key === ' ' ? 'Space' : event.key; heldKeys.delete(keyCode); send({ type: 'keyUp', keyCode }); });
  proxy.addEventListener('compositionstart', /* 记录组合态，离开网页时明确取消。 */ () => { composing = true; });
  proxy.addEventListener('compositionupdate', /* 合成文本留在网页当前选区。 */ event => send({ type: 'composition', text: event.data }));
  proxy.addEventListener('paste', /* 只向网页传递纯文本，不传递本机文件。 */ event => {
    event.preventDefault(); const text = event.clipboardData?.getData('text/plain');
    if (text) send({ type: 'text', text });
  });
  proxy.addEventListener('compositionend', /* 取消输入法时清除组合态。 */ event => { composing = false; if (!event.data) send({ type: 'composition', text: '' }); });
  proxy.addEventListener('input', /* 只提交已完成文本，不重复提交输入法中间结果。 */ event => {
    if ((event as InputEvent).isComposing) return;
    if (proxy.value) send({ type: 'text', text: proxy.value }); proxy.value = '';
  });
  proxy.addEventListener('blur', release);
  element.querySelector('#browser-home')!.addEventListener('click', returnHome);
  element.querySelector('#browser-address-form')!.addEventListener('submit', navigate);
  for (const [button, command] of [[back, 'back'], [forward, 'forward'], [reload, 'reload']] as const) button.addEventListener('click', /* 仅执行枚举导航命令。 */ () => {
    window.desktop.browserCommand(command).catch(/* 保留导航失败反馈。 */ () => notice('网页操作失败，请重试。'));
  });
  window.desktop.onBrowserNotice(notice);
  window.desktop.onBrowserState(update);
  window.desktop.onBrowserFrame(/* 解码后再核对版本，丢弃过期或积压帧。 */ async frame => {
    if (!visible || !plan || frame.version !== plan.version || decoding) return;
    decoding = true;
    try {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.bytes)]));
      if (visible && frame.version === plan?.version) web.getContext('2d')!.drawImage(bitmap, 0, 0, web.width, web.height);
      bitmap.close();
    } catch { notice('网页画面暂不可用，请刷新。'); } finally { decoding = false; }
  });
  window.desktop.openBrowser().then(/* 保护策略就绪后开放地址栏。 */ state => {
    ready = true; address.disabled = false; element.querySelector<HTMLButtonElement>('#browser-go')!.disabled = false;
    update(state); present();
  }).catch(/* 初始化失败不继续无保护浏览。 */ () => notice('浏览器初始化失败，请退出软件后重试。'));
  return {
    element,
    /** 隐藏时停绘并释放输入，保留网页 DOM 与历史。
     * @param value 当前面板是否在桌面呈现。
     */
    setVisible(value: boolean): void { if (!value) release(); visible = value; element.hidden = !value; if (!value && ready && plan) window.desktop.presentBrowser({ width: web.width, height: web.height, visible: false, version: plan.version }); },
    /** 与桌面使用同一显示计划版本。
     * @param value 已应用于桌面画布的有效显示计划。
     */
    setPresentation(value: DisplayPlan): void { plan = value; present(); },
  };
}
