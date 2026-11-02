import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalFiles } from '../app-shell/src/modules/local-files/public/api.js';

let base, service, protectedDirectory, answers, questions, locations;
/** 每例只在独立临时目录中操作，回收站使用可观察的替身。 */
beforeEach(/* 在独立临时目录验证当前场景。 */ async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(),'cic-files-test-'));
  protectedDirectory = path.join(base,'virtualdesktop'); await fs.mkdir(protectedDirectory);
  await fs.writeFile(path.join(protectedDirectory,'app.bin'),'protected');
  answers = []; questions = []; locations = [{name:'测试盘',path:base}];
  service = createLocalFiles({ roots:/* 返回当前模拟磁盘快照。 */ async () => locations,protectedPaths:[protectedDirectory],trash:/* 在独立临时目录验证当前场景。 */ async () => { throw new Error('回收站不可用'); },ask:/* 记录问题并返回本例明确选择。 */ async question => { questions.push(question); return answers.shift() ?? 'cancel'; } });
});
/** 先关闭监听，再清理仅属于本例的临时目录。 */
afterEach(/* 在独立临时目录验证当前场景。 */ async () => { service.close(); await fs.rm(base,{ recursive:true,force:true }); });

describe('本机文件管理公开契约', /* 通过公开入口验证文件行为与保护边界。 */ () => {
  it('在一秒内展示外部新建、增大、改名和删除，并在关闭后停止发布', /* 在独立临时目录验证当前场景。 */ async () => {
    const values = []; service.subscribe(/* 收集目录与盘符快照。 */ value => values.push(value));
    await service.open(base);
    const file = path.join(base,'download.part');
    await fs.writeFile(file,'abc');
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.directory?.entries.find(/* 匹配指定文件。 */ entry => entry.name === 'download.part')?.size,{timeout:1000,interval:20}).toBe(3);
    await fs.appendFile(file,'def');
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.directory?.entries.find(/* 匹配指定文件。 */ entry => entry.name === 'download.part')?.size,{timeout:1000,interval:20}).toBe(6);
    await fs.rename(file,path.join(base,'下载完成.txt'));
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.directory?.entries.some(/* 检查文件是否出现在列表。 */ entry => entry.name === '下载完成.txt'),{timeout:1000,interval:20}).toBe(true);
    await fs.unlink(path.join(base,'下载完成.txt'));
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.directory?.entries.some(/* 检查文件是否出现在列表。 */ entry => entry.name === '下载完成.txt'),{timeout:1000,interval:20}).toBe(false);
    service.close(); const count = values.length; await fs.writeFile(file,'closed');
    await new Promise(/* 等待跨越轮询周期。 */ resolve => setTimeout(resolve,800)); expect(values.length).toBe(count);
  });
  it('磁盘消失后返回此电脑，显示错误而不重试文件操作', /* 在独立临时目录验证当前场景。 */ async () => {
    const values = []; service.subscribe(/* 收集目录与盘符快照。 */ value => values.push(value)); await service.open(base);
    locations = [];
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.directory,{timeout:1700}).toBe(null);
    expect(values.at(-1).error).toContain('返回此电脑');
  });
  it('隐藏期间拔盘后重新进入，清除旧目录并恢复磁盘轮询', /* 在独立临时目录验证当前场景。 */ async () => {
    const values = []; service.subscribe(/* 收集目录与盘符快照。 */ value => values.push(value));
    await service.open(base); service.close(); locations = [];
    await service.open(base);
    expect(values.at(-1).directory).toBe(null); expect(values.at(-1).roots).toEqual([]);
    expect(values.at(-1).error).toContain('返回此电脑');
    locations = [{name:'重新插入的磁盘',path:base}];
    await expect.poll(/* 等待产品发布可观察结果。 */ () => values.at(-1)?.roots?.length,{timeout:1700}).toBe(1);
    expect(values.at(-1).directory).toBe(null);
  });
  it('拒绝根外路径、无效文件名和未知操作', /* 在独立临时目录验证当前场景。 */ async () => {
    await expect(service.list(path.dirname(base))).rejects.toThrow('本地磁盘');
    for (const name of ['../outside','CON','stream:ads','tail.','x\\y']) expect((await service.operate({kind:'mkdir',directory:base,name})).error).toBeTruthy();
    await expect(service.operate({kind:'execute'})).rejects.toThrow('无效');
  });
  it('支持新建、重命名、复制与跨目录移动', /* 在独立临时目录验证当前场景。 */ async () => {
    expect((await service.operate({kind:'mkdir',directory:base,name:'目标'})).error).toBe('');
    const source = path.join(base,'a.txt'), target = path.join(base,'目标'); await fs.writeFile(source,'payload');
    expect((await service.operate({kind:'rename',sources:[source],name:'b.txt'})).error).toBe('');
    const renamed = path.join(base,'b.txt');
    expect((await service.operate({kind:'copy',sources:[renamed],directory:target})).error).toBe('');
    expect(await fs.readFile(path.join(target,'b.txt'),'utf8')).toBe('payload');
    await fs.unlink(path.join(target,'b.txt'));
    expect((await service.operate({kind:'move',sources:[renamed],directory:target})).error).toBe('');
    await expect(fs.stat(renamed)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('逐项处理目录合并冲突，支持跳过、保留两份、覆盖', /* 在独立临时目录验证当前场景。 */ async () => {
    const from = path.join(base,'from'), to = path.join(base,'to');
    await fs.mkdir(path.join(from,'folder'),{recursive:true}); await fs.mkdir(path.join(to,'folder'),{recursive:true});
    for (const name of ['a','b','c']) { await fs.writeFile(path.join(from,'folder',name),'new'); await fs.writeFile(path.join(to,'folder',name),'old'); }
    answers.push('skip','keep','overwrite');
    const result = await service.operate({kind:'copy',sources:[path.join(from,'folder')],directory:to});
    expect(result.error).toBe(''); expect(result.skipped.length).toBe(1); expect(questions.length).toBe(3);
    expect(await fs.readFile(path.join(to,'folder','a'),'utf8')).toBe('old');
    expect(await fs.readFile(path.join(to,'folder','b (2)'),'utf8')).toBe('new');
    expect(await fs.readFile(path.join(to,'folder','c'),'utf8')).toBe('new');
  });
  it('文件与文件夹类型冲突可保留两份，覆盖不会删除旧目录', /* 在独立临时目录验证当前场景。 */ async () => {
    const from = path.join(base,'source'), to = path.join(base,'target'); await fs.mkdir(from); await fs.mkdir(to);
    await fs.writeFile(path.join(from,'item'),'new'); await fs.mkdir(path.join(to,'item')); await fs.writeFile(path.join(to,'item','keep'),'old');
    answers.push('overwrite'); expect((await service.operate({kind:'copy',sources:[path.join(from,'item')],directory:to})).error).toContain('类型不同');
    expect(await fs.readFile(path.join(to,'item','keep'),'utf8')).toBe('old');
    answers.push('keep'); expect((await service.operate({kind:'copy',sources:[path.join(from,'item')],directory:to})).error).toBe('');
    expect(await fs.readFile(path.join(to,'item (2)'),'utf8')).toBe('new');
  });
  it('保护自身、上级目录与嵌套目标，允许复制自身文件出来', /* 在独立临时目录验证当前场景。 */ async () => {
    const protectedFile = path.join(protectedDirectory,'app.bin'); const output = path.join(base,'output'); await fs.mkdir(output);
    for (const request of [{kind:'delete',sources:[protectedFile]},{kind:'move',sources:[protectedDirectory],directory:output},{kind:'rename',sources:[base],name:'renamed'},{kind:'mkdir',directory:protectedDirectory,name:'unsafe'}]) expect((await service.operate(request)).error).toContain('自身文件保护');
    expect((await service.operate({kind:'copy',sources:[protectedFile],directory:output})).error).toBe('');
    expect((await service.operate({kind:'copy',sources:[path.join(output,'app.bin')],directory:protectedDirectory})).error).toContain('自身文件保护');
    expect(await fs.readFile(protectedFile,'utf8')).toBe('protected');
  });
  it('拒绝链接绕过和多硬链接变更', /* 在独立临时目录验证当前场景。 */ async () => {
    const link = path.join(base,'alias'); await fs.symlink(protectedDirectory,link,'junction');
    expect((await service.operate({kind:'mkdir',directory:link,name:'unsafe'})).error).toContain('自身文件保护');
    const hard = path.join(base,'hard.bin'); await fs.link(path.join(protectedDirectory,'app.bin'),hard);
    expect((await service.operate({kind:'delete',sources:[hard]})).error).toContain('硬链接');
    expect((await service.operate({kind:'copy',sources:[link],directory:base})).error).toContain('链接');
  });
  it('回收站失败必须二次确认永久删除；取消保留文件', /* 在独立临时目录验证当前场景。 */ async () => {
    const source = path.join(base,'remove.txt'); await fs.writeFile(source,'keep');
    answers.push('trash','cancel'); const canceled = await service.operate({kind:'delete',sources:[source]});
    expect(canceled.skipped).toEqual([source]); expect(await fs.readFile(source,'utf8')).toBe('keep');
    answers.push('trash','permanent'); expect((await service.operate({kind:'delete',sources:[source]})).completed).toEqual([source]);
    await expect(fs.stat(source)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('移动遇到跳过保留源文件，目标不能位于源目录内部', /* 在独立临时目录验证当前场景。 */ async () => {
    const from = path.join(base,'from'), to = path.join(base,'to'); await fs.mkdir(from); await fs.mkdir(to);
    await fs.writeFile(path.join(from,'file'),'source'); await fs.writeFile(path.join(to,'file'),'target');
    answers.push('skip'); const result = await service.operate({kind:'move',sources:[path.join(from,'file')],directory:to});
    expect(result.skipped.length).toBe(1); expect(await fs.readFile(path.join(from,'file'),'utf8')).toBe('source');
    expect((await service.operate({kind:'copy',sources:[from],directory:from})).error).toContain('自身或其子目录');
  });
  it('冲突期间源文件消失，不清空已有目标，并报告部分完成', /* 在独立临时目录验证当前场景。 */ async () => {
    const from = path.join(base,'from'), to = path.join(base,'to'); await fs.mkdir(from); await fs.mkdir(to);
    await fs.writeFile(path.join(from,'a'),'first'); await fs.writeFile(path.join(from,'b'),'second'); await fs.writeFile(path.join(to,'b'),'original');
    service.close();
    service = createLocalFiles({ roots:/* 返回当前模拟磁盘快照。 */ async () => locations,protectedPaths:[protectedDirectory],trash:/* 在独立临时目录验证当前场景。 */ async () => {},ask:/* 在独立临时目录验证当前场景。 */ async () => { await fs.unlink(path.join(from,'b')); return 'overwrite'; } });
    const result = await service.operate({kind:'copy',sources:[path.join(from,'a'),path.join(from,'b')],directory:to});
    expect(result.completed).toEqual([path.join(to,'a')]); expect(result.error).toBeTruthy();
    expect(await fs.readFile(path.join(to,'b'),'utf8')).toBe('original');
    expect((await fs.readdir(to)).some(/* 检查暂存文件是否遗留。 */ name => name.startsWith('.cic-transfer-'))).toBe(false);
  });
});
