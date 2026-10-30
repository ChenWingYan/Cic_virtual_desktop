export type Orientation = 0 | 90 | 180 | 270;
export interface DisplayProfile { orientation: Orientation; compensationX: number; compensationY: number; fontScale: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
/** CSS 像素仿射矩阵，顺序为 a,b,c,d,e,f。 */
export type Matrix = readonly [number, number, number, number, number, number];
export interface DisplayRequest { logical: Size; output: Size; profile: DisplayProfile; version: number }
export interface DisplayPlan {
  unit: 'css-px'; logical: Size; output: Size; version: number;
  contentBounds: { x: number; y: number; width: number; height: number };
  forward: Matrix; inverse: Matrix;
}
export type MappedInput = { kind: 'hit'; point: Point } | { kind: 'outside' };
