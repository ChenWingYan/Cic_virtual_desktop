import { _electron as electron } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const snapshot = process.argv[2];
if (!snapshot) throw new Error('需要声明快照目录');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args:['.'],env });
try {
  const file = path.resolve(snapshot,'site/index.html');
  // 独立沙箱窗口只用于检查离线声明站点，不改变业务窗口安全边界。
  await app.evaluate(async ({ BrowserWindow },url) => {
    const reference = new BrowserWindow({ show:false,webPreferences:{ sandbox:true,contextIsolation:true,nodeIntegration:false } });
    await reference.loadURL(url);
  },pathToFileURL(file).href);
  const page = app.windows().find(/* 选择声明站点窗口。 */ candidate => candidate.url().startsWith(pathToFileURL(file).href));
  assert.ok(page);
  await page.locator('#search').fill('createDisplayPlan');
  await page.locator('#results a').first().waitFor({ state:'visible' });
  await page.locator('#results a').first().click();
  await page.getByRole('heading',{ name:'createDisplayPlan',exact:true }).waitFor();
  await page.locator('main a').filter({ hasText:'DisplayRequest' }).first().click();
  assert.match(await page.locator('main').textContent(),/逻辑画布/);
  const member = page.locator('main [id^="m-"]').first();
  assert.ok(await member.getAttribute('id'));
  await page.screenshot({ path:'artifacts/reference.png' });
  console.log('Offline reference passed: search, type link, member anchor.');
} finally { await app.close(); }
