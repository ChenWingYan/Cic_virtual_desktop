import type { DisplayProfile } from '../../../shared/contracts/display';
import { LOGICAL_SIZE } from '../../../shared/contracts/layout';
import { createDisplayPlan } from '../../display-geometry/public/api';
/** 桌面会话的可观察快照。 */
export interface DesktopState {
  /** 当前受管理页面。 */
  page: 'home' | 'calibration';
  /** 当前有效显示配置。 */
  profile: DisplayProfile;
  /** 每次成功配置更新递增。 */
  version: number;
}
/** 首个切片的桌面会话公开契约。 */
export interface DesktopSession {
  /** 返回独立状态快照。 */
  getState(): DesktopState;
  /** 进入支持的受管理内容。
   * @param entry 当前仅支持校准入口。
   */
  activateEntry(entry: 'calibration'): void;
  /** 返回主页并保留显示配置。 */
  returnHome(): void;
  /** 先校验再更新配置，失败保留当前版本。
   * @param profile 完整的有效显示配置。
   */
  applyDisplayProfile(profile: DisplayProfile): void;
  /** 恢复软件安全初值。 */
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
      createDisplayPlan({ logical:LOGICAL_SIZE,output:LOGICAL_SIZE,profile,version:state.version+1 });
      state = { ...state,profile:{ ...profile },version:state.version+1 };
    },
    /** 无条件恢复软件默认显示，不代表设备校准值。 */
    resetDisplayProfile() { state = { ...state,profile:defaults(),version:state.version+1 }; },
  };
}
/** 软件安全初值，不根据标称硬件比例猜测补偿。 */
function defaults(): DisplayProfile { return { orientation:0,compensationX:1,compensationY:1,fontScale:1 }; }
