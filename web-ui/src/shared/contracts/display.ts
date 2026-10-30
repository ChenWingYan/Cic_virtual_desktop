/** 顺时针方向，不改变 Windows 显示配置。 */
export type Orientation = 0 | 90 | 180 | 270;
/** 应用于所有受管理内容的显示配置。 */
export interface DisplayProfile {
  /** 顺时针旋转角。 */
  orientation: Orientation;
  /** 输出横轴的有限正补偿。 */
  compensationX: number;
  /** 输出纵轴的有限正补偿。 */
  compensationY: number;
  /** 独立字号比例，有限且为正。 */
  fontScale: number;
}
/** CSS 像素尺寸，宽高必须有限且为正。 */
export interface Size {
  /** 横向长度。 */
  width: number;
  /** 纵向长度。 */
  height: number;
}
/** 相对所属区域左上角的 CSS 像素位置。 */
export interface Point {
  /** 横向位置。 */
  x: number;
  /** 纵向位置。 */
  y: number;
}
/** CSS 像素仿射矩阵，顺序为 a,b,c,d,e,f。 */
export type Matrix = readonly [number, number, number, number, number, number];
/** 生成正逆变换的完整输入。 */
export interface DisplayRequest {
  /** 布局使用的逻辑画布。 */
  logical: Size;
  /** 平台报告的输出区域。 */
  output: Size;
  /** 当前显示配置。 */
  profile: DisplayProfile;
  /** 非负安全整数，由会话维护。 */
  version: number;
}
/** 同一画面与输入共同使用的不可拆分变换计划。 */
export interface DisplayPlan {
  /** 所有坐标统一使用 CSS 像素。 */
  unit: 'css-px';
  /** 原始逻辑画布尺寸。 */
  logical: Size;
  /** 输出区域尺寸。 */
  output: Size;
  /** 对应显示配置版本。 */
  version: number;
  /** 输出中实际内容范围，剩余部分为留边。 */
  contentBounds: { x: number; y: number; width: number; height: number };
  /** 逻辑画布到输出区域的变换。 */
  forward: Matrix;
  /** 输出区域到逻辑画布的变换。 */
  inverse: Matrix;
}
/** 仅命中结果携带逻辑位置，区域外不生成点击。 */
export type MappedInput = { kind: 'hit'; point: Point } | { kind: 'outside' };
