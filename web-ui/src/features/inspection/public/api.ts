import { mapOutputInput, type DisplayPlan } from '../../display-geometry/public/api';
export interface InspectionState { directory:string;contentId:string;running:boolean;error:string;backendPid:number|null }
export interface InspectionFrame { contentId:string;image:string;width:number;height:number }
export interface InspectionBridge {
  /** 查询独立业务组件状态。 */
  status():Promise<InspectionState>;
  /** 选择产物目录，不允许网页提供任意模块路径。 */
  chooseDirectory():Promise<InspectionState>;
  /** 打开或恢复业务内容。 */
  open():Promise<InspectionState>;
  /** 结束查验，进行中需确认。 */
  close():Promise<boolean>;
  /** 刷新当前页面。 */
  reconnect():Promise<InspectionState>;
  /** 确认并重启查验。 */
  restart():Promise<InspectionState>;
  /** 同步可见性和显示版本。 */
  present(payload:{visible:boolean;version:number}):void;
  /** 发送有限的业务输入字段。 */
  input(payload:Record<string,unknown>):void;
  /** 订阅离屏画面。 */
  onFrame(listener:(frame:InspectionFrame)=>void):()=>void;
  /** 订阅故障和生命周期。 */
  onState(listener:(state:InspectionState)=>void):()=>void;
}
export const INSPECTION_LAYOUT=Object.freeze({ width:1920,height:1200,toolbarHeight:120 });

/** 以离屏画面呈现业务内容，桌面的同一显示矩阵负责输出与逆向输入。 */
export function mountInspection(canvas:HTMLElement,output:HTMLElement,bridge:InspectionBridge,getPlan:()=>DisplayPlan,getState:()=>InspectionState,onHome:()=>void,onError:(message:string)=>void) {
  canvas.innerHTML='<nav class="inspection-toolbar"><strong>查验程序</strong><button id="inspection-home">返回桌面</button><button id="inspection-reconnect">重新连接</button><button id="inspection-restart">重启查验</button><button id="inspection-close">退出查验</button><span id="inspection-status">正在连接业务画面…</span></nav><img id="inspection-frame" draggable="false" alt="查验业务画面"><textarea id="inspection-input" aria-label="查验文字输入" autocomplete="off"></textarea>';
  const frame=canvas.querySelector<HTMLImageElement>('#inspection-frame')!;
  const text=canvas.querySelector<HTMLTextAreaElement>('#inspection-input')!;
  const status=canvas.querySelector<HTMLElement>('#inspection-status')!;
  let disposed=false;
  let pressedButton='left';
  let activePointer:number|null=null;
  /** 转发异步操作失败，避免未处理的 Promise。 */
  async function perform(action:()=>Promise<unknown>) { try { await action(); } catch(error) { onError(String((error as Error).message)); } }
  /** 使用当前会话及显示计划标识输入。 */
  function send(payload:Record<string,unknown>) { bridge.input({ ...payload,contentId:getState().contentId,version:getPlan().version }); }
  /** 页面隐藏或几何变化时同步清理宿主与业务侧的活动指针。 */
  function cancelPointer() {
    if (activePointer===null) return;
    const pointerId=activePointer; activePointer=null;
    send({ type:'cancel' });
    if (frame.hasPointerCapture(pointerId)) frame.releasePointerCapture(pointerId);
  }
  /** 把输出坐标映射至业务画布，拒绝工具栏和留边区域。 */
  function point(event:MouseEvent) {
    const rect=output.getBoundingClientRect();
    const mapped=mapOutputInput(getPlan(),{ x:event.clientX-rect.left,y:event.clientY-rect.top });
    if (mapped.kind!=='hit') return null;
    const value={ x:mapped.point.x,y:mapped.point.y-INSPECTION_LAYOUT.toolbarHeight };
    return value.y>=0 && value.y<1080 ? value : null;
  }
  /** 焦点保留在宿主输入框，文本通过明确接口交给业务内容。 */
  function focusText(position:{x:number;y:number}) { text.style.left=`${position.x}px`; text.style.top=`${position.y+INSPECTION_LAYOUT.toolbarHeight}px`; text.focus({ preventScroll:true }); }
  /** 映射鼠标、笔和单指触摸的按下与抬起。 */
  function pointer(event:PointerEvent) {
    const releasing=event.type==='pointerup' || event.type==='pointercancel';
    const position=point(event);
    if (event.type==='pointercancel' || (!position && releasing)) {
      if (activePointer===event.pointerId) { send({ type:'cancel' }); activePointer=null; }
      if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
      return;
    }
    if (!position || (activePointer!==null && activePointer!==event.pointerId)) return;
    event.preventDefault();
    const button=['left','middle','right'][event.button] || pressedButton;
    if (event.type==='pointerdown') { activePointer=event.pointerId; pressedButton=button; frame.setPointerCapture(event.pointerId); focusText(position); }
    send({ ...position,type:event.type==='pointerdown' ? 'mouseDown' : event.type==='pointerup' || event.type==='pointercancel' ? 'mouseUp' : 'mouseMove',button,clickCount:event.detail });
    if (releasing) { activePointer=null; if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId); }
  }
  /** 旋转后的滚动方向同样经当前逆矩阵转换。 */
  function wheel(event:WheelEvent) {
    const position=point(event);
    if (!position) return;
    event.preventDefault();
    const [a,b,c,d]=getPlan().inverse;
    const unit=event.deltaMode===1 ? 16 : event.deltaMode===2 ? 1080 : 1;
    send({ ...position,type:'mouseWheel',deltaX:-(a*event.deltaX+c*event.deltaY)*unit,deltaY:-(b*event.deltaX+d*event.deltaY)*unit });
  }
  /** 只在组合输入完成后提交文本；真实输入法候选框仍需现场验证。 */
  function commit(event:InputEvent) {
    if (event.isComposing) return;
    if (text.value) { send({ type:'text',text:text.value }); text.value=''; }
  }
  /** 转发导航与编辑键，普通文字由 input/组合输入处理。 */
  function key(event:KeyboardEvent) {
    if (event.isComposing || event.key==='Process') return;
    const keys=['Backspace','Delete','Enter','Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'];
    if (keys.includes(event.key)) { event.preventDefault(); event.stopPropagation(); send({ type:event.type==='keydown' ? 'keyDown' : 'keyUp',key:event.key,shift:event.shiftKey }); }
  }
  canvas.querySelector('#inspection-home')!.addEventListener('click',onHome);
  canvas.querySelector('#inspection-reconnect')!.addEventListener('click',() => { void perform(() => bridge.reconnect()); });
  canvas.querySelector('#inspection-restart')!.addEventListener('click',() => { void perform(() => bridge.restart()); });
  canvas.querySelector('#inspection-close')!.addEventListener('click',() => { void perform(async () => { if (await bridge.close()) onHome(); }); });
  for (const type of ['pointerdown','pointerup','pointermove','pointercancel']) frame.addEventListener(type,pointer as EventListener);
  frame.addEventListener('lostpointercapture',cancelPointer);
  frame.addEventListener('contextmenu',event => event.preventDefault());
  frame.addEventListener('wheel',wheel,{ passive:false });
  text.addEventListener('input',commit as EventListener);
  text.addEventListener('compositionend',() => { queueMicrotask(() => commit({ isComposing:false } as InputEvent)); });
  text.addEventListener('keydown',key);
  text.addEventListener('keyup',key);
  return {
    /** 只呈现当前业务会话的帧，防止重启后的旧画面覆盖新会话。 */
    setFrame(value:InspectionFrame) { if (!disposed && value.contentId===getState().contentId) { frame.src=value.image; if (!getState().error) status.textContent=''; } },
    /** 显示可读故障，保留重连、重启及返回入口。 */
    setError(message:string) { status.textContent=message; },
    /** 隐藏后保留 DOM，但不能保留拖拽中的指针。 */
    cancel:cancelPointer,
    /** 页面切换后丢弃旧 DOM 引用。 */
    dispose() { cancelPointer(); disposed=true; },
  };
}
