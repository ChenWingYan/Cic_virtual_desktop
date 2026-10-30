import type { DisplayPlan, DisplayRequest, MappedInput, Matrix, Point } from '../../../shared/contracts/display';

/** 生成 CSS 像素正逆变换；补偿在输出轴执行，最终完整适配并居中。
 * @param request 逻辑尺寸、输出尺寸、显示配置及同步版本。
 * @throws RangeError 非有限、非正尺寸或数值不稳定的请求。
 */
export function createDisplayPlan(request: DisplayRequest): DisplayPlan {
  const { logical, output, profile, version } = request;
  const values = [logical.width, logical.height, output.width, output.height, profile.compensationX, profile.compensationY, profile.fontScale];
  if (!values.every(v => Number.isFinite(v) && v > 0) || ![0, 90, 180, 270].includes(profile.orientation) || !Number.isSafeInteger(version) || version < 0) throw new RangeError('显示参数必须有效且为正数');
  const w = logical.width, h = logical.height;
  const rotations: Record<number, Matrix> = { 0: [1,0,0,1,0,0], 90: [0,1,-1,0,h,0], 180: [-1,0,0,-1,w,h], 270: [0,-1,1,0,0,w] };
  const [a,b,c,d,e,f] = rotations[profile.orientation];
  const swapped = profile.orientation === 90 || profile.orientation === 270;
  const cw = (swapped ? h : w) * profile.compensationX;
  const ch = (swapped ? w : h) * profile.compensationY;
  const fit = Math.min(output.width / cw, output.height / ch);
  const sx = fit * profile.compensationX, sy = fit * profile.compensationY;
  const width = cw * fit, height = ch * fit;
  const x = (output.width - width) / 2, y = (output.height - height) / 2;
  const forward: Matrix = [a*sx,b*sy,c*sx,d*sy,e*sx+x,f*sy+y];
  const [aa,bb,cc,dd,ee,ff] = forward;
  const det = aa*dd-bb*cc;
  const inverse: Matrix = [dd/det,-bb/det,-cc/det,aa/det,(cc*ff-dd*ee)/det,(bb*ee-aa*ff)/det];
  if (det === 0 || x + width === x || y + height === y || ![cw,ch,fit,width,height,...forward,...inverse].every(Number.isFinite)) throw new RangeError('显示变换退化');
  return { unit: 'css-px', logical: { ...logical }, output: { ...output }, version, contentBounds: { x,y,width,height }, forward, inverse };
}

/** 将输出位置反算至逻辑画布；留边、越界与非有限输入返回区域外。
 * @param plan 与当前画面同步的变换计划。
 * @param point 相对输出区域左上角的 CSS 像素位置。
 */
export function mapOutputInput(plan: DisplayPlan, point: Point): MappedInput {
  if (![point.x,point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x > plan.output.width || point.y > plan.output.height) return { kind: 'outside' };
  const bounds = plan.contentBounds;
  if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.x+bounds.width || point.y > bounds.y+bounds.height) return { kind: 'outside' };
  const [a,b,c,d,e,f] = plan.inverse;
  const x = a*point.x+c*point.y+e, y = b*point.x+d*point.y+f;
  if (![x,y].every(Number.isFinite) || x < -1e-8 || y < -1e-8 || x > plan.logical.width+1e-8 || y > plan.logical.height+1e-8) return { kind: 'outside' };
  return { kind: 'hit', point: { x: Math.max(0, Math.min(plan.logical.width,x)), y: Math.max(0, Math.min(plan.logical.height,y)) } };
}
