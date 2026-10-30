import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('artifacts',{ recursive:true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args:['.'],env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading',{ name:'虚拟桌面',exact:true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),true);
  assert.equal(await page.evaluate(() => typeof window.require),'undefined');
  assert.deepEqual(await page.evaluate(() => Object.keys(window.desktop).sort()),['onReset','quit']);
  await page.screenshot({ path:'artifacts/home.png' });
  await page.getByRole('button',{ name:'显示校准' }).click();
  for (const orientation of [0,90,180,270]) {
    await page.locator('#orientation').selectOption(String(orientation));
    await page.locator('#cx').fill('0.8');
    await page.locator('#cy').fill('1.2');
    await page.getByRole('button',{ name:'应用显示',exact:true }).click();
    for (const corner of ['左上','右上','左下','右下']) await page.getByRole('button',{ name:corner,exact:true }).click();
    assert.equal(await page.locator('#hit-status').textContent(),'四角命中：4 / 4');
    await page.screenshot({ path:`artifacts/calibration-${orientation}.png` });
  }
  await page.locator('#cx').fill('0');
  await page.getByRole('button',{ name:'应用显示',exact:true }).click();
  assert.match(await page.locator('#error').textContent(),/正补偿/);
  await page.keyboard.press('Control+Alt+r');
  await page.waitForFunction(() => document.querySelector('#orientation').value === '0');
  assert.equal(await page.locator('#cx').inputValue(),'1');
  await page.getByRole('button',{ name:'返回主页' }).click();
  await page.getByRole('heading',{ name:'虚拟桌面',exact:true }).waitFor();
  await page.getByRole('button',{ name:'显示校准' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('heading',{ name:'虚拟桌面',exact:true }).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/smoke.json',JSON.stringify({ result:'passed',fullscreen:true,orientations:[0,90,180,270],compensation:[0.8,1.2],cornerHits:'4/4 each',recovery:'keyboard and home',rendererErrors:errors,deviceValidation:'not performed' },null,2));
  console.log('Electron smoke passed: fullscreen, isolated preload, four directions, 16 corner hits, reset, home.');
} finally { await app.close(); }
