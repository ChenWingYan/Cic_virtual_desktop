import './style.css';
import { createDisplayPlan, mapOutputInput, type DisplayPlan } from './features/display-geometry/public/api';
import { createDesktopSession } from './features/desktop-session/public/api';
import { calibrationMarkup } from './features/calibration/public/api';
import type { Orientation } from './shared/contracts/display';
declare global { interface Window { desktop: { quit(): Promise<void>; onReset(listener: () => void): void } } }
const session = createDesktopSession();
const output = document.querySelector<HTMLDivElement>('#output')!;
const canvas = document.querySelector<HTMLElement>('#canvas')!;
let plan: DisplayPlan;
const hits = new Set<string>();

/** 同步更新画面与输入计划；窗口单位采用 CSS 像素，浏览器负责 DPI。 */
function present(): void {
  const state = session.getState();
  if (!output.clientWidth || !output.clientHeight) return;
  plan = createDisplayPlan({ logical:{ width:960,height:720 },output:{ width:output.clientWidth,height:output.clientHeight },profile:state.profile,version:state.version });
  canvas.style.transform = `matrix(${plan.forward.join(',')})`;
  canvas.style.fontSize = `${16*state.profile.fontScale}px`;
}
/** 渲染当前受管理页面与设置；未实现的应用入口明确标记。 */
function render(): void {
  hits.clear();
  const state = session.getState();
  canvas.innerHTML = state.page === 'home' ? `<header><p class="eyebrow">CIC / VIRTUAL DESKTOP</p><h1>虚拟桌面</h1><p>一个工作区，统一方向与显示比例。</p></header><section class="entries"><button id="calibrate"><strong>显示校准 →</strong><span>方向、形状与四角命中</span></button><button disabled>文件管理器 · 待接入</button><button disabled>浏览器 · 待接入</button><button disabled>查验程序 · 待接入</button></section><p class="notice">硬件参数待验证。默认 1/1 仅为软件初值。</p>` : `${calibrationMarkup()}<button id="home">← 返回主页</button>`;
  canvas.insertAdjacentHTML('beforeend', `<form id="settings"><label>方向 <select id="orientation">${[0,90,180,270].map(v => `<option ${v === state.profile.orientation ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>横向补偿 <input id="cx" type="number" step="any" value="${state.profile.compensationX}" required></label><label>纵向补偿 <input id="cy" type="number" step="any" value="${state.profile.compensationY}" required></label><button>应用显示</button><p id="error" role="alert"></p></form>`);
  document.querySelector('#calibrate')?.addEventListener('click', () => { session.activateEntry('calibration'); render(); });
  document.querySelector('#home')?.addEventListener('click', home);
  document.querySelector('#settings')!.addEventListener('submit', apply);
  present();
}
/** 校验用户输入并保留失败前的配置；尺寸先按实际输出验证。 */
function apply(event: Event): void {
  event.preventDefault();
  const profile = { ...session.getState().profile,orientation:Number((document.querySelector('#orientation') as HTMLSelectElement).value) as Orientation,compensationX:Number((document.querySelector('#cx') as HTMLInputElement).value),compensationY:Number((document.querySelector('#cy') as HTMLInputElement).value) };
  try {
    createDisplayPlan({ logical:{ width:960,height:720 },output:{ width:output.clientWidth,height:output.clientHeight },profile,version:session.getState().version+1 });
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
document.querySelector('#quit')!.addEventListener('click', () => window.desktop.quit());
document.addEventListener('keydown', event => { if (event.key === 'Escape') home(); if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r') reset(); });
window.desktop?.onReset(reset);
window.addEventListener('resize',present);
render();
