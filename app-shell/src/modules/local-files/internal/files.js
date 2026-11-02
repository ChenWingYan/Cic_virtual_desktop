import * as fs from 'node:fs/promises';
import { watch, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 用实际路径关系判断包含，避免前缀相似目录误判。 */
function inside(parent, child) {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
/** 限制 Windows 文件名，拒绝路径、设备名、数据流及尾随空格。 */
function validName(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) throw new Error('文件名无效。');
  return name;
}
/** 只把确实不存在视为空，权限错误必须向调用者报告。 */
async function exists(target) {
  try { return await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** 创建本机文件服务；系统路径、回收站和提问由平台提供。 */
export function createLocalFiles({ roots, protectedPaths, trash, ask }) {
  let active = '', watcher, timer, pollBusy = false, last = '', busy = false;
  let generation = 0;
  const listeners = new Set();
  /** 发布纯数据快照。 */
  function emit(value) { for (const listener of listeners) listener(value); }
  /** 解析实际目标，包括尚未创建项的已存在父目录。 */
  async function canonical(target) {
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0') || (process.platform === 'win32' && (target.startsWith('\\\\') || /:/.test(target.slice(2))))) throw new Error('只允许本地绝对路径。');
    try { return await fs.realpath(target); } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(target) === target) throw error;
      return path.join(await canonical(path.dirname(target)), path.basename(target));
    }
  }
  /** 验证目标位于当前已发现的本地磁盘内。 */
  async function allowed(target) {
    const actual = await canonical(target);
    const locations = await roots();
    for (const root of locations) {
      const base = await canonical(root.path).catch(/* 已拔出的盘符不再授权。 */ () => null);
      if (base && inside(base, actual)) return actual;
    }
    throw new Error('目标不在可访问的本地磁盘中。');
  }
  /** 验证写入边界；整树操作也拒绝包含自身文件的上级目录。 */
  async function writable(target, subtree = false) {
    const actual = await allowed(target);
    for (const protectedPath of protectedPaths) {
      const protectedActual = await canonical(protectedPath);
      if (inside(protectedActual, actual) || (subtree && inside(actual, protectedActual))) throw new Error('自身文件保护：不能修改 virtualdesktop 或其上级目录。');
    }
    // 拒绝通过目录联接或符号链接写入，且不覆盖多硬链接文件。
    let cursor = path.resolve(target);
    while (true) {
      const info = await exists(cursor);
      if (info?.isSymbolicLink()) throw new Error('不支持通过链接修改文件。');
      if (cursor === path.dirname(cursor)) break;
      cursor = path.dirname(cursor);
    }
    const info = await exists(actual);
    if (info?.isFile() && info.nlink > 1) throw new Error('不支持修改具有多个硬链接的文件。');
    if (actual === path.parse(actual).root) throw new Error('不能修改磁盘根目录。');
    return actual;
  }
  /** 扫描传输或删除子树，提前拒绝链接及受保护项。 */
  async function inspect(target, modifying) {
    const actual = modifying ? await writable(target, true) : await allowed(target);
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) throw new Error('文件操作暂不支持链接，请操作实际文件。');
    if (info.isDirectory()) for (const name of await fs.readdir(actual)) await inspect(path.join(actual, name), modifying);
    return actual;
  }
  /** 列举当前目录的真实名称、种类和元数据，不推断下载完成。 */
  async function list(target) {
    const actual = await allowed(target);
    const entries = [];
    for (const name of await fs.readdir(actual)) {
      try {
        const full = path.join(actual, name), info = await fs.lstat(full);
        entries.push({ name, path:full, kind:info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'link' : 'file', size:info.size, modified:info.mtimeMs });
      } catch (error) { if (error.code !== 'ENOENT') entries.push({ name,path:path.join(actual,name),kind:'unavailable',size:0,modified:0 }); }
    }
    entries.sort(/* 文件夹优先，名称自然排序。 */ (a,b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name,'zh-CN',{ numeric:true }));
    return { path:actual, entries };
  }
  /** 每次核对同时获取磁盘和当前目录，轮询补偿系统通知丢失。 */
  async function refresh() {
    if (pollBusy) return;
    pollBusy = true;
    const version = generation, target = active;
    try {
      const locations = await roots();
      let directory = null, error = '';
      if (target) {
        try { directory = await list(target); }
        catch (failure) { error = `目录不可访问，已返回此电脑：${failure.message}`; if (version === generation) { active = ''; watcher?.close(); watcher = undefined; } }
      }
      const value = { roots:locations, directory, error };
      const signature = JSON.stringify(value);
      if (version === generation && signature !== last) { last = signature; emit(value); }
    } catch (failure) { if (version === generation) emit({ error:`刷新失败：${failure.message}` }); }
    finally { pollBusy = false; }
  }
  /** 串行执行文件变更，保留每个已完成项并向界面请求冲突决策。 */
  async function operate(request) {
    if (busy) throw new Error('已有文件操作正在进行。');
    if (!request || !['mkdir','rename','copy','move','delete'].includes(request.kind)) throw new Error('文件操作无效。');
    busy = true;
    const result = { completed:[], skipped:[], error:'' };
    try {
      if (request.kind === 'mkdir') {
        const destination = await writable(path.join(await allowed(request.directory),validName(request.name)));
        await fs.mkdir(destination); result.completed.push(destination);
      } else {
        const sources = request.sources;
        if (!Array.isArray(sources) || sources.length < 1 || sources.length > 500 || new Set(sources).size !== sources.length) throw new Error('请选择 1 至 500 个不同文件。');
        for (const source of sources) await inspect(source, request.kind !== 'copy');
        if (request.kind === 'rename') {
          if (sources.length !== 1) throw new Error('一次只能重命名一个项目。');
          const source = sources[0], target = path.join(path.dirname(source), validName(request.name));
          await writable(target, true);
          if (await exists(target)) throw new Error('同名项目已存在，请使用其他名称。');
          await writable(source,true);
          const sourceInfo = await fs.lstat(source);
          if (sourceInfo.isDirectory()) await fs.rename(source,target);
          else {
            // 同目录文件优先用独占硬链接发布新名称，避免覆盖检查后新出现的文件。
            try { await fs.link(source,target); }
            catch (failure) { if (!['ENOTSUP','EPERM','EXDEV','EINVAL'].includes(failure.code)) throw failure; await fs.copyFile(source,target,constants.COPYFILE_EXCL); }
            const currentSource = await fs.lstat(source);
            if (currentSource.ino !== sourceInfo.ino || currentSource.mtimeMs !== sourceInfo.mtimeMs || currentSource.size !== sourceInfo.size) throw new Error('源文件重命名期间发生变化，已保留源文件。');
            await fs.unlink(source);
          }
          result.completed.push(target);
        } else if (request.kind === 'delete') {
          const answer = await ask({ kind:'delete', message:`将 ${sources.length} 个项目移入回收站？` });
          if (answer !== 'trash') return result;
          for (const source of sources) {
            await inspect(source,true);
            try { await trash(source); result.completed.push(source); }
            catch (failure) {
              const decision = await ask({ kind:'permanent',message:`无法移入回收站：${source}\n${failure.message}\n是否永久删除？此操作不能撤销。` });
              if (decision !== 'permanent') { result.skipped.push(source); continue; }
              await inspect(source,true); await fs.rm(source,{ recursive:true }); result.completed.push(source);
            }
          }
        } else {
          const destination = await allowed(request.directory);
          if (!(await fs.stat(destination)).isDirectory()) throw new Error('目标不是文件夹。');
          for (const source of sources) {
            const actual = await allowed(source), target = path.join(destination,path.basename(source));
            if (inside(actual,target)) throw new Error('不能复制或移动到自身或其子目录。');
            await transfer(source,target,request.kind === 'move',result);
          }
        }
      }
    } catch (failure) { result.error = failure.message; }
    finally { busy = false; last = ''; await refresh(); }
    return result;
  }
  /** 逐项合并目录，冲突逐项提问；跨盘移动只删除已成功复制的源文件。 */
  async function transfer(source, target, moving, result) {
    const sourceInfo = await fs.lstat(source);
    if (sourceInfo.isSymbolicLink()) throw new Error('文件操作暂不支持链接。');
    if (moving) await writable(source,true); else await allowed(source);
    await writable(target);
    let existing = await exists(target);
    if (existing && !(sourceInfo.isDirectory() && existing.isDirectory())) {
      const choice = await ask({ kind:'conflict', message:`目标已存在：${target}`, source, target });
      if (choice === 'skip') { result.skipped.push(source); return; }
      if (choice === 'keep') {
        const parsed = path.parse(target); let index = 2;
        do { target = path.join(parsed.dir,`${parsed.name} (${index++})${parsed.ext}`); } while (await exists(target));
        existing = null;
      } else if (choice !== 'overwrite') throw new Error('文件操作已取消。');
      if (existing && (sourceInfo.isDirectory() || !existing.isFile())) throw new Error('文件与文件夹类型不同，请保留两份或跳过。');
    }
    await writable(target, !!existing);
    if (sourceInfo.isDirectory()) {
      if (!existing) await fs.mkdir(target);
      for (const name of await fs.readdir(source)) await transfer(path.join(source,name),path.join(target,name),moving,result);
      if (moving && (await fs.readdir(source)).length === 0) { await writable(source,true); await fs.rmdir(source); }
      result.completed.push(target);
      return;
    }
    const temp = path.join(path.dirname(target),`.cic-transfer-${randomUUID()}.tmp`);
    try {
      await fs.copyFile(source,temp,constants.COPYFILE_EXCL);
      await writable(target,!!existing);
      const current = await exists(target);
      if ((!existing && current) || (existing && (!current || current.ino !== existing.ino || current.mtimeMs !== existing.mtimeMs || current.size !== existing.size))) throw new Error('目标在操作期间发生变化，请重试。');
      if (existing) await fs.rename(temp,target);
      else {
        // 不存在的目标必须独占创建，防止覆盖并发出现的同名文件。
        try { await fs.link(temp,target); }
        catch (failure) { if (!['ENOTSUP','EPERM','EXDEV','EINVAL'].includes(failure.code)) throw failure; await fs.copyFile(temp,target,constants.COPYFILE_EXCL); }
      }
      result.completed.push(target);
      if (moving) { await writable(source,true); const currentSource = await fs.lstat(source); if (currentSource.ino !== sourceInfo.ino || currentSource.mtimeMs !== sourceInfo.mtimeMs || currentSource.size !== sourceInfo.size) throw new Error('源文件复制期间发生变化，已保留源文件。'); await fs.unlink(source); }
    } finally { await fs.rm(temp,{ force:true }).catch(/* 清理失败不得掩盖原始错误。 */ () => {}); }
  }
  return {
    list, operate,
    /** 订阅快照，并返回释放入口。 */
    subscribe(listener) { listeners.add(listener); return /* 释放当前订阅。 */ () => listeners.delete(listener); },
    /** 切换目录时替换监听；返回文件管理器时强制重新核对。 */
    async open(target = '') {
      generation++; watcher?.close(); watcher = undefined; active = target ? await allowed(target) : ''; last = '';
      if (active) {
        try { const subscription = watch(active, /* 系统事件触发快速核对。 */ () => { void refresh(); }); watcher = subscription; subscription.on('error', /* 只关闭发生错误的旧监听，轮询继续有效。 */ () => { subscription.close(); if (watcher === subscription) watcher = undefined; }); } catch { /* 轮询负责不可监听的目录。 */ }
      }
      if (!timer) timer = setInterval(/* 750ms 核对目录及盘符，避免依赖单一系统事件。 */ () => { void refresh(); },750);
      await refresh();
    },
    /** 关闭可见文件管理器时释放监听和轮询，不取消已经授权的操作。 */
    close() { generation++; active = ''; watcher?.close(); watcher = undefined; clearInterval(timer); timer = undefined; last = ''; },
  };
}
