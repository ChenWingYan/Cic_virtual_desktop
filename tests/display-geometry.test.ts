import { expect, test } from 'vitest';
import { createDisplayPlan, mapOutputInput } from '../web-ui/src/features/display-geometry/public/api';

// 验证公开契约的留边和坐标单位，不依赖内部矩阵计算。
test('逻辑画布等比适配输出区域并拒绝留边输入', () => {
  const plan = createDisplayPlan({ logical: { width: 200, height: 100 }, output: { width: 600, height: 400 }, profile: { orientation: 0, compensationX: 1, compensationY: 1, fontScale: 1 }, version: 1 });
  expect(plan.forward).toEqual([3, 0, 0, 3, 0, 50]);
  expect(mapOutputInput(plan, { x: 300, y: 200 })).toMatchObject({ kind: 'hit', point: { x: 100, y: expect.closeTo(50) } });
  expect(mapOutputInput(plan, { x: 300, y: 49 })).toEqual({ kind: 'outside' });
});

// 用已知角点验证顺时针方向、非等比补偿和往返。
test.each([
  [0, [2,0,0,3,0,0], { x: 0,y: 0 }],
  [90, [0,3,-2,0,400,0], { x: 400,y: 0 }],
  [180, [-2,0,0,-3,800,600], { x: 800,y: 600 }],
  [270, [0,-3,2,0,0,1200], { x: 0,y: 1200 }],
] as const)('方向 %s 使用输出轴补偿并映射四角', (orientation, expected, origin) => {
  const plan = createDisplayPlan({ logical: { width: 400,height: 200 }, output: { width: orientation % 180 ? 400 : 800,height: orientation % 180 ? 1200 : 600 }, profile: { orientation,compensationX: 2,compensationY: 3,fontScale: 1 }, version: 7 });
  expect(plan.forward.map(v => v === 0 ? 0 : v)).toEqual(expected);
  expect(mapOutputInput(plan,origin)).toMatchObject({ kind:'hit',point:{ x:expect.closeTo(0),y:expect.closeTo(0) } });
  for (const [x,y] of [[0,0],[400,0],[0,200],[400,200],[123,87]]) {
    const [a,b,c,d,e,f] = plan.forward;
    expect(mapOutputInput(plan,{ x:a*x+c*y+e,y:b*x+d*y+f })).toMatchObject({ kind:'hit',point:{ x:expect.closeTo(x),y:expect.closeTo(y) } });
  }
  expect(mapOutputInput(plan,{ x:NaN,y:0 })).toEqual({ kind:'outside' });
  expect(mapOutputInput(plan,{ x:-1,y:0 })).toEqual({ kind:'outside' });
});

// 拒绝无效和数值退化的请求，不能制造可点击计划。
test.each([0,-1,NaN,Infinity,Number.MIN_VALUE])('拒绝退化尺寸 %s', width => {
  expect(() => createDisplayPlan({ logical:{ width,height:100 },output:{ width:800,height:600 },profile:{ orientation:0,compensationX:1,compensationY:1,fontScale:1 },version:0 })).toThrow(RangeError);
});

// 每项非法配置均从公开入口被拒绝，不能污染后续输入。
test.each([
  { orientation:45 },{ compensationX:0 },{ compensationY:-1 },{ compensationX:Infinity },
  { compensationY:NaN },{ fontScale:0 },{ compensationX:Number.MAX_VALUE,compensationY:Number.MIN_VALUE },
])('拒绝非法配置 %j', invalid => {
  expect(() => createDisplayPlan({ logical:{ width:400,height:200 },output:{ width:800,height:600 },profile:{ orientation:0,compensationX:1,compensationY:1,fontScale:1,...invalid } as never,version:0 })).toThrow(RangeError);
});

// 视口边界和逻辑边界都纳入判断，非有限输入不能成为点击。
test('接受内容边界，拒绝输出越界及非有限输入', () => {
  const plan = createDisplayPlan({ logical:{ width:200,height:100 },output:{ width:600,height:400 },profile:{ orientation:0,compensationX:1,compensationY:1,fontScale:1 },version:0 });
  expect(mapOutputInput(plan,{ x:600,y:350 })).toMatchObject({ kind:'hit',point:{ x:200,y:expect.closeTo(100) } });
  for (const point of [{ x:601,y:200 },{ x:300,y:401 },{ x:Infinity,y:0 },{ x:0,y:NaN },{ x:300,y:351 }]) expect(mapOutputInput(plan,point)).toEqual({ kind:'outside' });
});

// 回归普通小数补偿造成的边界舍入误差，保持有效角点可逆。
test('小数补偿下正向生成的角点仍可逆映射', () => {
  const plan = createDisplayPlan({ logical:{ width:960,height:720 },output:{ width:800,height:600 },profile:{ orientation:0,compensationX:0.8,compensationY:0.8,fontScale:1 },version:0 });
  for (const [x,y] of [[0,0],[960,0],[0,720],[960,720]]) {
    const [a,b,c,d,e,f] = plan.forward;
    expect(mapOutputInput(plan,{ x:a*x+c*y+e,y:b*x+d*y+f })).toMatchObject({ kind:'hit',point:{ x:expect.closeTo(x),y:expect.closeTo(y) } });
  }
  expect(mapOutputInput(plan,{ x:800.001,y:0 })).toEqual({ kind:'outside' });
});
