import type { DisplayProfile } from '../../../shared/contracts/display';
import { createDisplayPlan } from '../../display-geometry/public/api';
export interface DesktopState { page: 'home' | 'calibration'; profile: DisplayProfile; version: number }
export interface DesktopSession {
  getState(): DesktopState;
  activateEntry(entry: 'calibration'): void;
  returnHome(): void;
  applyDisplayProfile(profile: DisplayProfile): void;
  resetDisplayProfile(): void;
}
/** 创建仅拥有主页与校准内容的会话；配置变更先校验再增加版本。 */
export function createDesktopSession(): DesktopSession {
  let state: DesktopState = { page:'home',profile:defaults(),version:0 };
  return {
    /** 返回独立快照，禁止调用者修改会话。 */
    getState() { return { ...state,profile:{ ...state.profile } }; },
    /** 激活首期支持的校准入口。 */
    activateEntry(entry) { if (entry !== 'calibration') throw new RangeError('入口尚未接入'); state.page = entry; },
    /** 返回主页，保留当前显示配置。 */
    returnHome() { state.page = 'home'; },
    /** 原子更新有效配置；失败保留当前画面版本。 */
    applyDisplayProfile(profile) {
      createDisplayPlan({ logical:{ width:960,height:720 },output:{ width:960,height:720 },profile,version:state.version+1 });
      state = { ...state,profile:{ ...profile },version:state.version+1 };
    },
    /** 无条件恢复软件默认显示，不代表设备校准值。 */
    resetDisplayProfile() { state = { ...state,profile:defaults(),version:state.version+1 }; },
  };
}
/** 软件安全初值，不根据标称硬件比例猜测补偿。 */
function defaults(): DisplayProfile { return { orientation:0,compensationX:1,compensationY:1,fontScale:1 }; }
