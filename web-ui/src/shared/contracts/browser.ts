/** 可信界面与离屏内容承载之间的状态快照。 */
export interface BrowserState { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; cursor: string }
/** 逻辑网页视口与统一显示计划版本。 */
export interface BrowserPresentation { width: number; height: number; visible: boolean; version: number }
/** 版本化输入；主进程按 type 再次验证字段。 */
export interface BrowserInput { version: number; type: string; x?: number; y?: number; button?: string; buttons?: number; clickCount?: number; deltaX?: number; deltaY?: number; keyCode?: string; modifiers?: string[]; text?: string }
