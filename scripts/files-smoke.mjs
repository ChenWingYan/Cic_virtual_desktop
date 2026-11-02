import { _electron as electron } from 'playwright';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = await fs.mkdtemp(path.join(os.tmpdir(),'cic-files-smoke-'));
const working = path.join(base,'files'); await fs.mkdir(working);
await fs.mkdir('artifacts',{recursive:true});
const env = { ...process.env,CIC_DESKTOP_DATA_DIR:path.join(base,'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({args:['.'],env});
const errors = [], timings = [];
let page;
/** 限时检查产品中的可观察状态。 */
async function until(check,timeout=5000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) { if (await check()) return; await new Promise(/* 等待异步系统事件。 */ resolve => setTimeout(resolve,20)); }
  throw new Error('文件管理器结果等待超时。');
}
/** 通过实际界面导航本机目录。 */
async function navigate(target) { await page.locator('#files-path').fill(target); await page.locator('.files-address button').click(); await until(/* 等待目录快照。 */ async () => await page.locator('#files-path').inputValue() === target && (await page.locator('.files-status').textContent()).includes('实时刷新')); }
/** 通过工具栏和受管理确认层新建目录。 */
async function mkdir(name) { await page.getByRole('button',{name:'新建文件夹',exact:true}).click(); await page.getByRole('textbox',{name:'名称',exact:true}).fill(name); await page.getByRole('button',{name:'确定',exact:true}).click(); await page.getByRole('button',{name:`▸ ${name}`,exact:true}).waitFor(); }
try {
  page = await app.firstWindow(); page.on('pageerror', /* 收集可信界面异常。 */ error => errors.push(error.message));
  await page.locator('#open-files').click();
  await until(/* 等待系统盘符发现。 */ async () => (await page.locator('.files-list>button').count()) > 0,10000);
  await navigate(working);
  let started = Date.now(); await fs.writeFile(path.join(working,'外部下载.part'),'downloading');
  await page.getByRole('button',{name:'· 外部下载.part',exact:true}).waitFor(); timings.push(Date.now()-started);
  await page.getByRole('checkbox',{name:'选择 外部下载.part',exact:true}).check();
  await fs.appendFile(path.join(working,'外部下载.part'),' more');
  await until(/* 文件大小变化自动到达界面。 */ async () => (await page.locator('.file-row').filter({hasText:'外部下载.part'}).textContent()).includes('16 B'));
  assert.equal(await page.getByRole('checkbox',{name:'选择 外部下载.part',exact:true}).isChecked(),true);
  await fs.rename(path.join(working,'外部下载.part'),path.join(working,'完成.txt'));
  await page.getByRole('button',{name:'· 完成.txt',exact:true}).waitFor();
  await mkdir('传输目标');
  await page.getByRole('checkbox',{name:'选择 完成.txt',exact:true}).check(); await page.getByRole('button',{name:'复制',exact:true}).click();
  await page.getByRole('button',{name:'▸ 传输目标',exact:true}).click(); await page.getByRole('button',{name:'粘贴',exact:true}).click();
  await page.getByRole('button',{name:'· 完成.txt',exact:true}).waitFor();
  await page.getByRole('button',{name:'粘贴',exact:true}).click(); await page.getByRole('button',{name:'保留两份',exact:true}).click();
  await page.getByRole('button',{name:'· 完成 (2).txt',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'选择 完成 (2).txt',exact:true}).check(); await page.getByRole('button',{name:'重命名',exact:true}).click();
  await page.getByRole('textbox',{name:'名称',exact:true}).fill('改名.txt'); await page.getByRole('button',{name:'确定',exact:true}).click();
  await page.getByRole('button',{name:'· 改名.txt',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'选择 改名.txt',exact:true}).check(); await page.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'取消',exact:true}).click(); assert.equal(await fs.readFile(path.join(working,'传输目标','改名.txt'),'utf8'),'downloading more');
  await page.getByRole('button',{name:'删除',exact:true}).click(); await page.getByRole('button',{name:'移入回收站',exact:true}).click();
  await until(/* 真实回收站完成后文件消失；若系统失败则显式取消永久删除。 */ async () => {
    if (await page.getByRole('button',{name:'永久删除',exact:true}).isVisible()) { await page.getByRole('button',{name:'取消',exact:true}).click(); throw new Error('本机回收站不可用，未执行永久删除'); }
    return !(await fs.stat(path.join(working,'传输目标','改名.txt')).catch(/* 不存在表示已移入回收站。 */ () => null));
  });
  // 同时验证目录变化、重返核对和四方向真实按钮命中。
  await page.locator('[data-home]').click();
  for (const orientation of [0,90,180,270]) {
    await page.locator('#orientation').selectOption(String(orientation)); await page.locator('#cx').fill('0.8'); await page.locator('#cy').fill('1.2');
    await page.getByRole('button',{name:'应用显示',exact:true}).click(); await page.locator('#open-files').click();
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    await page.screenshot({path:`artifacts/files-${orientation}.png`}); await page.locator('[data-home]').click();
  }
  await page.keyboard.press('Control+Alt+r'); await page.locator('#open-files').click();
  await navigate(working);
  for (let index=0;index<40;index++) await fs.writeFile(path.join(working,`row-${index}.txt`),'row');
  await page.getByRole('button',{name:'· row-39.txt',exact:true}).waitFor();
  await page.locator('.files-list').evaluate(/* 模拟用户已滚动到列表中部。 */ element => { element.scrollTop=400; });
  await fs.writeFile(path.join(working,'new-file.txt'),'new');
  await page.getByRole('button',{name:'· new-file.txt',exact:true}).waitFor({state:'attached'});
  assert.equal(await page.locator('.files-list').evaluate(/* 自动刷新应保留滚动位置。 */ element => element.scrollTop),400);
  await page.screenshot({path:'artifacts/files-list.png'});
  const protectedResult = await page.evaluate(/* 验证真实 IPC 不能绕过自身保护，不创建或删除应用文件。 */ () => window.desktop.fileOperation({kind:'mkdir',directory:location.pathname.replace(/^\//,'').replace(/\/dist\/index.html$/,''),name:'should-not-exist'}));
  assert.match(protectedResult.error,/自身文件保护/);
  const installation = await app.evaluate(/* 打包态还需保护外层 EXE 和运行时目录。 */ ({app}) => ({ packaged:app.isPackaged, executable:process.execPath }));
  if (installation.packaged) {
    const runtimeResult = await page.evaluate(/* 仅尝试创建不存在项，断言安装根目录阻止写入。 */ directory => window.desktop.fileOperation({kind:'mkdir',directory,name:'should-not-exist'}),path.dirname(installation.executable));
    assert.match(runtimeResult.error,/自身文件保护/);
  }
  const untrusted = await app.evaluate(/* 通过实际外部框架对象验证主进程拒绝非桌面来源。 */ async ({BrowserWindow,ipcMain}) => {
    const guest = new BrowserWindow({show:false,webPreferences:{sandbox:true}}); await guest.loadURL('about:blank');
    const handler = ipcMain._invokeHandlers.get('files:operate');
    try { await handler({sender:guest.webContents,senderFrame:guest.webContents.mainFrame},{kind:'delete',sources:['C:\\Windows']}); return false; }
    catch { return true; } finally { guest.destroy(); }
  });
  assert.equal(untrusted,true); assert.deepEqual(errors,[]);
  await fs.writeFile('artifacts/files-smoke.json',JSON.stringify({result:'passed',packaged:installation.packaged,installationProtection:installation.packaged ? 'passed' : 'requires packaged run',externalCreateLatencyMs:timings,metadata:true,rename:true,selectionPreserved:true,scrollPreserved:true,copy:true,conflictKeepBoth:true,renameOperation:true,recycleBin:true,selfProtection:true,untrustedSourceRejected:true,orientations:[0,90,180,270],usbHardware:'not tested',rendererErrors:errors},null,2));
  console.log('Files smoke passed: real filesystem refresh, operations, conflicts, recycle bin, protection, selection, scroll, four orientations.');
} catch (error) { if (page && !page.isClosed()) await page.screenshot({path:'artifacts/files-failure.png'}); throw error; }
finally { await app.close(); await fs.rm(base,{recursive:true,force:true}); }
