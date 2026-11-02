import { test,expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInspectionManifest } from '../app-shell/src/modules/inspection/public/manifest.js';

test('独立产物必须包含兼容入口，拒绝旧版本及目录外模块',() => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cic-manifest-'));
  try {
    const directory=path.join(root,'component'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'entry.cjs'),'exports.apiVersion=1;');
    const manifest={ id:'custominspect',apiVersion:1,entry:'entry.cjs',viewport:{ width:1920,height:1080 } };
    /** 写入不同组件元数据，验证加载器的公开拒绝行为。 */
    const save=value => fs.writeFileSync(path.join(directory,'inspection-component.json'),JSON.stringify(value));
    expect(() => readInspectionManifest(directory)).toThrow();
    save(manifest);
    expect(readInspectionManifest(directory).entry).toBe(path.join(directory,'entry.cjs'));
    save({ ...manifest,apiVersion:2 });
    expect(() => readInspectionManifest(directory)).toThrow(/不兼容/);
    fs.writeFileSync(path.join(root,'outside.cjs'),'throw new Error("must not execute")');
    save({ ...manifest,entry:'../outside.cjs' });
    expect(() => readInspectionManifest(directory)).toThrow(/目录内/);
    expect(() => readInspectionManifest('relative/component')).toThrow(/绝对目录/);
  } finally { fs.rmSync(root,{ recursive:true,force:true }); }
});
