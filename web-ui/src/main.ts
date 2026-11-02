import './style.css';
import { createDisplayPlan, mapOutputInput, type DisplayPlan } from './features/display-geometry/public/api';
import { createDesktopSession } from './features/desktop-session/public/api';
import { calibrationMarkup } from './features/calibration/public/api';
import type { Orientation } from './shared/contracts/display';
import { LOGICAL_SIZE } from './shared/contracts/layout';
import { createBrowserPanel } from './features/browser/public/api';
import type { BrowserState, BrowserInput, BrowserPresentation } from './shared/contracts/browser';
import { createFilePanel } from './features/file-browser/public/api';
import type { FileOperation, FileResult, FileQuestion, FilesSnapshot } from './shared/contracts/files';
import { INSPECTION_LAYOUT,mountInspection,type InspectionBridge,type InspectionState,type InspectionFrame } from './features/inspection/public/api';
declare global { interface Window { desktop: {
  inspection:InspectionBridge;
  /** 浏览本机目录或此电脑。 */
  openFiles(target?:string):Promise<void>;
  /** 获取系统桌面、下载和文档路径。 */
  filePlaces():Promise<{name:string;path:string}[]>;
  /** 提交文件操作，接收部分完成结果。 */
  fileOperation(request:FileOperation):Promise<FileResult>;
  /** 提交当前问题的明确回答。 */
  answerFileQuestion(id:string,answer:string):void;
  /** 关闭目录监听。 */
  closeFiles():void;
  /** 订阅目录及磁盘快照。 */
  onFilesSnapshot(listener:(snapshot:FilesSnapshot) => void):void;
  /** 订阅逐项冲突与删除确认。 */
  onFileQuestion(listener:(question:FileQuestion) => void):void;
  /** 请求主进程退出。 */
  quit(): Promise<void>;
  /** 订阅主进程恢复通知。 */
  onReset(listener: () => void): void;
  /** 订阅外壳捕获的返回桌面快捷键。
   * @param listener 不接收 IPC 事件对象的通知回调。
   */
  onHome(listener: () => void): void;
  /** 创建唯一离屏网页。 */
  openBrowser(): Promise<BrowserState>;
  /** 发送枚举的导航操作。
   * @param command 支持的单页面操作。
   * @param value 仅 navigate 使用的 HTTP(S) 地址。
   */
  browserCommand(command: 'navigate' | 'back' | 'forward' | 'reload', value?: string): Promise<void>;
  /** 同步网页逻辑视口与显示版本。
   * @param request 网页逻辑像素尺寸、可见性及显示版本。
   */
  presentBrowser(request: BrowserPresentation): void;
  /** 发送受校验的网页输入。
   * @param input 与当前显示版本一致的事件联合。
   */
  browserInput(input: BrowserInput): void;
  /** 接收版本化的网页画面。
   * @param listener 接收显示版本及 PNG 字节的回调。
   */
  onBrowserFrame(listener: (frame: { version: number; bytes: Uint8Array }) => void): void;
  /** 接收导航状态。
   * @param listener 接收纯数据状态快照的回调。
   */
  onBrowserState(listener: (state: BrowserState) => void): void;
  /** 订阅网页功能反馈。
   * @param listener 接收纯文本反馈的回调。
   */
  onBrowserNotice(listener: (message: string) => void): void;
} } }
const session = createDesktopSession();
const output = document.querySelector<HTMLDivElement>('#output')!;
const canvas = document.querySelector<HTMLElement>('#canvas')!;
let plan: DisplayPlan;
const hits = new Set<string>();
// 桌面和校准允许重绘；网页节点始终留在 DOM 中以保留历史和表单。
const desktopContent = document.createElement('div');
canvas.append(desktopContent);
let browser: ReturnType<typeof createBrowserPanel> | undefined;
let files: ReturnType<typeof createFilePanel> | undefined;
const inspectionContent=document.createElement('section');
inspectionContent.className='inspection-content'; inspectionContent.hidden=true; canvas.append(inspectionContent);
let inspectionState:InspectionState={ directory:'',contentId:'',running:false,error:'',backendPid:null };
let inspectionView:ReturnType<typeof mountInspection>|undefined;
let lastFrame:InspectionFrame|undefined;
let inspectionOpening=false;
let geometryKey='';
let presentationVersion=0;

/** 显示业务故障而不影响浏览器和文件管理器。 */
function inspectionError(message:string):void {
  inspectionState={ ...inspectionState,error:message }; inspectionView?.setError(message);
  const notice=document.querySelector('#inspection-notice'); if (notice) notice.textContent=message;
}
/** 首次启动或恢复同一业务会话，启动失败保留可操作的桌面。 */
async function openInspection():Promise<void> {
  if (inspectionOpening) return;
  inspectionOpening=true;
  const notice=document.querySelector('#inspection-notice'); if (notice) notice.textContent='正在启动查验，请稍候…';
  try { inspectionState=await window.desktop.inspection.open(); session.activateEntry('inspection'); render(); }
  catch(error) { inspectionError((error as Error).message); }
  finally { inspectionOpening=false; }
}
/** 通过原生选择器设置独立产物目录并保存。 */
async function chooseInspectionDirectory():Promise<void> {
  try { inspectionState=await window.desktop.inspection.chooseDirectory(); render(); }
  catch(error) { inspectionError((error as Error).message); }
}

/** 同步更新画面与输入计划；窗口单位采用 CSS 像素，浏览器负责 DPI。 */
function present(): void {
  const state = session.getState();
  if (!output.clientWidth || !output.clientHeight) return;
  const logical=state.page==='inspection' ? INSPECTION_LAYOUT : LOGICAL_SIZE;
  const nextKey=JSON.stringify([logical.width,logical.height,output.clientWidth,output.clientHeight,state.version]);
  if (nextKey!==geometryKey) { inspectionView?.cancel(); geometryKey=nextKey; presentationVersion++; }
  plan = createDisplayPlan({ logical,output:{ width:output.clientWidth,height:output.clientHeight },profile:state.profile,version:presentationVersion });
  canvas.style.width = `${logical.width}px`;
  canvas.style.height = `${logical.height}px`;
  canvas.style.transform = `matrix(${plan.forward.join(',')})`;
  canvas.style.fontSize = `${16*state.profile.fontScale}px`;
  if (state.page === 'browser') browser?.setPresentation(plan);
  window.desktop?.inspection?.present({ visible:state.page==='inspection',version:plan.version });
}
/** 渲染当前受管理页面与设置；未实现的应用入口明确标记。 */
function render(): void {
  hits.clear();
  const state = session.getState();
  canvas.classList.toggle('browsing', state.page === 'browser' || state.page === 'files' || state.page==='inspection');
  desktopContent.hidden = state.page === 'browser' || state.page === 'files' || state.page==='inspection';
  inspectionContent.hidden=state.page!=='inspection';
  if (state.page!=='inspection') inspectionView?.cancel();
  files?.setVisible(state.page === 'files');
  if (state.page==='inspection') {
    browser?.setVisible(false);
    if (!inspectionView) inspectionView=mountInspection(inspectionContent,output,window.desktop.inspection,() => plan,() => inspectionState,home,inspectionError);
    present();
    if (lastFrame) inspectionView.setFrame(lastFrame);
    if (inspectionState.error) inspectionView.setError(inspectionState.error);
    return;
  }
  if (state.page === 'files') {
    browser?.setVisible(false);
    if (!files) { files = createFilePanel(home); canvas.append(files.element); }
    files.setVisible(true); present(); return;
  }
  if (state.page === 'browser') {
    if (!browser) { browser = createBrowserPanel(home); canvas.append(browser.element); }
    browser.setVisible(true); present(); return;
  }
  browser?.setVisible(false);
  desktopContent.innerHTML = state.page === 'home' ? `<header><p class="eyebrow">CIC / VIRTUAL DESKTOP</p><h1>虚拟桌面</h1><p>选择应用，开始工作。</p></header><section class="entries"><button id="open-browser"><strong><span class="tile-icon">◎</span>网页浏览器</strong><span>访问网站，继续当前网页 →</span></button><button id="open-files"><strong><span class="tile-icon">▤</span>文件管理器</strong><span>本地磁盘、U 盘与实时文件 →</span></button><button id="inspection-open"><strong><span class="tile-icon">▦</span>查验程序</strong><span>独立业务组件 →</span></button></section><button id="calibrate"><strong>显示校准 →</strong></button><section class="inspection-config"><button id="inspection-directory">选择业务目录</button><span id="inspection-directory-value"></span><p id="inspection-notice" role="status"></p></section>` : `${calibrationMarkup()}<button id="home">← 返回主页</button>`;
  const directoryValue=document.querySelector('#inspection-directory-value');
  if (directoryValue) directoryValue.textContent=inspectionState.directory || '尚未配置业务产物目录';
  const inspectionNotice=document.querySelector('#inspection-notice');
  if (inspectionNotice) inspectionNotice.textContent=inspectionState.error || (inspectionState.running ? '查验仍在运行，再次进入可继续操作。' : '请选择包含 inspection-component.json 的业务产物目录。');
  document.querySelector('#inspection-open')?.addEventListener('click',() => { void openInspection(); });
  document.querySelector('#inspection-directory')?.addEventListener('click',() => { void chooseInspectionDirectory(); });
  desktopContent.insertAdjacentHTML('beforeend', `<form id="settings"><label>方向 <select id="orientation">${[0,90,180,270].map(/* 生成支持方向的选项。 */ v => `<option ${v === state.profile.orientation ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>横向补偿 <input id="cx" type="number" step="any" value="${state.profile.compensationX}" required></label><label>纵向补偿 <input id="cy" type="number" step="any" value="${state.profile.compensationY}" required></label><button>应用显示</button><p id="error" role="alert"></p></form>`);
  document.querySelector('#open-browser')?.addEventListener('click', /* 进入浏览器但不重建已存在网页。 */ () => { session.activateEntry('browser'); render(); });
  document.querySelector('#open-files')?.addEventListener('click', /* 进入文件管理器并重新核对目录。 */ () => { session.activateEntry('files'); render(); });
  document.querySelector('#calibrate')?.addEventListener('click', /* 进入校准并更新画面。 */ () => { session.activateEntry('calibration'); render(); });
  document.querySelector('#home')?.addEventListener('click', home);
  document.querySelector('#settings')!.addEventListener('submit', apply);
  present();
}
/** 校验用户输入并保留失败前的配置；尺寸先按实际输出验证。 */
function apply(event: Event): void {
  event.preventDefault();
  const profile = { ...session.getState().profile,orientation:Number((document.querySelector('#orientation') as HTMLSelectElement).value) as Orientation,compensationX:Number((document.querySelector('#cx') as HTMLInputElement).value),compensationY:Number((document.querySelector('#cy') as HTMLInputElement).value) };
  try {
    createDisplayPlan({ logical:LOGICAL_SIZE,output:{ width:output.clientWidth,height:output.clientHeight },profile,version:session.getState().version+1 });
    session.applyDisplayProfile(profile); render();
  } catch { document.querySelector('#error')!.textContent = '请输入有限的正补偿值；当前显示已保留。'; }
}
/** 清除校准记录并回到主页。 */
function home(): void { session.returnHome(); render(); }
/** 恢复入口固定在输出层，避免被显示变换缩小或移走。 */
function reset(): void { session.resetDisplayProfile(); render(); }
/** 按当前计划逆映射点击，仅记录四角逻辑目标内的命中。 */
output.addEventListener('click', event => {
  if (session.getState().page !== 'calibration') return;
  const rect = output.getBoundingClientRect();
  const mapped = mapOutputInput(plan,{ x:event.clientX-rect.left,y:event.clientY-rect.top });
  if (mapped.kind !== 'hit') return;
  for (const target of canvas.querySelectorAll<HTMLButtonElement>('.target')) {
    if (mapped.point.x >= target.offsetLeft && mapped.point.x <= target.offsetLeft+target.offsetWidth && mapped.point.y >= target.offsetTop && mapped.point.y <= target.offsetTop+target.offsetHeight) {
      hits.add(target.dataset.corner!); target.classList.add('hit');
    }
  }
  document.querySelector('#hit-status')!.textContent = `四角命中：${hits.size} / 4`;
});
document.querySelector('#reset')!.addEventListener('click',reset);
document.querySelector('#quit')!.addEventListener('click', /* 请求可信外壳退出。 */ () => window.desktop.quit());
document.addEventListener('keydown', /* 处理返回与恢复快捷键。 */ event => { if (event.key === 'Escape') home(); if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r') reset(); });
window.desktop?.onReset(reset);
window.desktop?.onHome(home);
window.desktop?.inspection?.onFrame(frame => { lastFrame=frame; inspectionView?.setFrame(frame); });
window.desktop?.inspection?.onState(state => {
  inspectionState=state;
  if (!state.running && session.getState().page==='inspection') home();
  else if (state.error) inspectionError(state.error);
});
void window.desktop?.inspection?.status().then(state => { inspectionState=state; if (session.getState().page==='home') render(); });
window.addEventListener('resize',present);
render();
