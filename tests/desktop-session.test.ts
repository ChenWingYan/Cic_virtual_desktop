import { expect, test } from 'vitest';
import { createDesktopSession } from '../web-ui/src/features/desktop-session/public/api';
// 通过会话公开入口验证页面切换、同步版本和异常恢复。
test('从主页进入校准，应用显示配置，返回并恢复默认', () => {
  const session = createDesktopSession();
  expect(session.getState().page).toBe('home');
  session.activateEntry('calibration');
  session.applyDisplayProfile({ orientation:90,compensationX:0.8,compensationY:1.2,fontScale:1 });
  expect(session.getState()).toMatchObject({ page:'calibration',version:1,profile:{ orientation:90 } });
  expect(() => session.applyDisplayProfile({ orientation:0,compensationX:NaN,compensationY:1,fontScale:1 })).toThrow();
  expect(session.getState().version).toBe(1);
  session.returnHome();
  expect(session.getState().page).toBe('home');
  session.resetDisplayProfile();
  expect(session.getState()).toMatchObject({ profile:{ orientation:0,compensationX:1,compensationY:1,fontScale:1 },version:2 });
});
