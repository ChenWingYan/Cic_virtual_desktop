import './style.css';
import { createDisplayPlan, mapOutputInput, type DisplayPlan } from './features/display-geometry/public/api';
import { createDesktopSession } from './features/desktop-session/public/api';
import { calibrationMarkup } from './features/calibration/public/api';
import type { Orientation } from './shared/contracts/display';
import { LOGICAL_SIZE } from './shared/contracts/layout';
import { INSPECTION_LAYOUT,mountInspection,type InspectionBridge,type InspectionState,type InspectionFrame } from './features/inspection/public/api';
declare global { interface Window { desktop: {
  /** 请求主进程退出。 */
  quit(): Promise<void>;
  /** 订阅主进程恢复通知。 */
  onReset(listener: () => void): void;
  inspection:InspectionBridge;
} } }
const session = createDesktopSession();
const output = document.querySelector<HTMLDivElement>('#output')!;
const canvas = document.querySelector<HTMLElement>('#canvas')!;
let plan: DisplayPlan;
const hits = new Set<string>();
let inspectionState:InspectionState={ directory:'',contentId:'',running:false,error:'',backendPid:null };
let inspectionView:ReturnType<typeof mountInspection>|undefined;
let lastFrame:InspectionFrame|undefined;
let inspectionOpening=false;
let geometryKey='';
let presentationVersion=0;

/** 保留可见错误，不用业务失败覆盖桌面和校准内容。 */
function inspectionError(message:string):void {
  inspectionState={ ...inspectionState,error:message };
  inspectionView?.setError(message);
  const notice=document.querySelector('#inspection-notice');
  if (notice) notice.textContent=message;
}
/** 启动与再次进入使用同一个业务会话，失败时留在可操作的桌面。 */
async function openInspection():Promise<void> {
  if (inspectionOpening) return;
  inspectionOpening=true;
  const notice=document.querySelector('#inspection-notice');
  if (notice) notice.textContent='正在启动查验，请稍候…';
  try {
    inspectionState=await window.desktop.inspection.open();
    session.activateEntry('inspection'); render();
  } catch (error) { inspectionError((error as Error).message); }
  finally { inspectionOpening=false; }
}
/** 目录经原生选择器配置并由主进程验证，网页不能注入模块路径。 */
async function chooseInspectionDirectory():Promise<void> {
  try { inspectionState=await window.desktop.inspection.chooseDirectory(); render(); }
  catch (error) { inspectionError((error as Error).message); }
}

/** 同步更新画面与输入计划；窗口单位采用 CSS 像素，浏览器负责 DPI。 */
function present(): void {
  const state = session.getState();
  if (!output.clientWidth || !output.clientHeight) return;
  const logical=state.page==='inspection' ? INSPECTION_LAYOUT : LOGICAL_SIZE;
  const nextKey=JSON.stringify([logical.width,logical.height,output.clientWidth,output.clientHeight,state.version]);
  if (nextKey!==geometryKey) { geometryKey=nextKey; presentationVersion++; }
  plan = createDisplayPlan({ logical,output:{ width:output.clientWidth,height:output.clientHeight },profile:state.profile,version:presentationVersion });
  canvas.style.width = `${logical.width}px`;
  canvas.style.height = `${logical.height}px`;
  canvas.style.transform = `matrix(${plan.forward.join(',')})`;
  canvas.style.fontSize = `${16*state.profile.fontScale}px`;
  window.desktop?.inspection?.present({ visible:state.page==='inspection',version:plan.version });
}
/** 渲染当前受管理页面与设置；未实现的应用入口明确标记。 */
function render(): void {
  hits.clear();
  const state = session.getState();
  inspectionView?.dispose(); inspectionView=undefined;
  canvas.classList.toggle('inspection-content',state.page==='inspection');
  if (state.page==='inspection') {
    inspectionView=mountInspection(canvas,window.desktop.inspection,() => plan,() => inspectionState,home,inspectionError);
    present();
    if (lastFrame) inspectionView.setFrame(lastFrame);
    if (inspectionState.error) inspectionView.setError(inspectionState.error);
    return;
  }
  canvas.innerHTML = state.page === 'home' ? `<header><p class="eyebrow">CIC / VIRTUAL DESKTOP</p><h1>虚拟桌面</h1><p>一个工作区，统一方向与显示比例。</p></header><section class="entries"><button id="calibrate"><strong>显示校准 →</strong><span>方向、形状与四角命中</span></button><button disabled>文件管理器 · 待接入</button><button disabled>浏览器 · 待接入</button><button id="inspection-open"><strong>查验程序 →</strong><span>加载独立业务组件</span></button></section><section class="inspection-config"><button id="inspection-directory">选择业务目录</button><span id="inspection-directory-value"></span><p id="inspection-notice" role="status"></p></section>` : `${calibrationMarkup()}<button id="home">← 返回主页</button>`;
  const directoryValue=document.querySelector('#inspection-directory-value');
  if (directoryValue) directoryValue.textContent=inspectionState.directory || '尚未配置业务产物目录';
  const inspectionNotice=document.querySelector('#inspection-notice');
  if (inspectionNotice) inspectionNotice.textContent=inspectionState.error || (inspectionState.running ? '查验仍在运行，再次进入可继续操作。' : '请选择包含 inspection-component.json 的业务产物目录。');
  document.querySelector('#inspection-open')?.addEventListener('click',() => { void openInspection(); });
  document.querySelector('#inspection-directory')?.addEventListener('click',() => { void chooseInspectionDirectory(); });
  canvas.insertAdjacentHTML('beforeend', `<form id="settings"><label>方向 <select id="orientation">${[0,90,180,270].map(/* 生成支持方向的选项。 */ v => `<option ${v === state.profile.orientation ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>横向补偿 <input id="cx" type="number" step="any" value="${state.profile.compensationX}" required></label><label>纵向补偿 <input id="cy" type="number" step="any" value="${state.profile.compensationY}" required></label><button>应用显示</button><p id="error" role="alert"></p></form>`);
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
window.desktop?.inspection?.onFrame(frame => { lastFrame=frame; inspectionView?.setFrame(frame); });
window.desktop?.inspection?.onState(state => {
  inspectionState=state;
  if (!state.running && session.getState().page==='inspection') home();
  else if (state.error) inspectionError(state.error);
});
void window.desktop?.inspection?.status().then(state => { inspectionState=state; if (session.getState().page==='home') render(); });
window.addEventListener('resize',present);
render();
