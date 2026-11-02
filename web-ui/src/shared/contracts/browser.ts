/** 可信界面与离屏内容承载之间的状态快照。 */
export interface BrowserState { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; cursor: string }
/** 逻辑网页视口与统一显示计划版本。 */
export interface BrowserPresentation { width: number; height: number; visible: boolean; version: number }
/** 按事件区分必需字段；主进程仍须运行时验证。 */
export type BrowserInputPayload =
  | { type: 'cancel' }
  | { type: 'text' | 'composition'; text: string }
  | { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers?: string[] }
  | { type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseLeave'; x: number; y: number; button?: string; buttons?: number; clickCount?: number }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number };
/** 输入与当前画面使用同一版本。 */
export type BrowserInput = BrowserInputPayload & { version: number };
