import fs from 'node:fs';
import path from 'node:path';
/** 校验用户指定的业务产物目录及接口版本，不搜索业务源码或自动退回 EXE。 */
export function readInspectionManifest(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择业务产物的绝对目录');
  const root = fs.realpathSync(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'inspection-component.json'),'utf8'));
  if (manifest.id !== 'custominspect' || manifest.apiVersion !== 1) throw new Error('业务组件接口版本不兼容，需要 apiVersion=1');
  if (typeof manifest.entry !== 'string' || path.isAbsolute(manifest.entry)) throw new Error('业务接入入口无效');
  const entry = fs.realpathSync(path.resolve(root,manifest.entry));
  const relative = path.relative(root,entry);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('业务接入入口必须位于产物目录内');
  if (manifest.viewport?.width !== 1920 || manifest.viewport?.height !== 1080) throw new Error('当前接入版本需要 1920×1080 业务画布');
  return { root,entry,manifest };
}
