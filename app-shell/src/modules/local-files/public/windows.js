import { spawn } from 'node:child_process';

/** 只发现本地固定磁盘和移动盘；独立辅助进程避免阻塞目录刷新。 */
export function discoverLocalDrives() {
  let drives = [], failure = '', ready;
  const initial = new Promise(/* 首次读取完成前不发布空磁盘列表。 */ resolve => { ready = resolve; });
  const script = `$ErrorActionPreference='Stop'; while($true) { try { $items=@([System.IO.DriveInfo]::GetDrives() | Where-Object { ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable') -and $_.IsReady } | ForEach-Object { @{name=$_.Name;path=$_.Name} }); ConvertTo-Json -InputObject $items -Compress } catch { Write-Output 'null' }; Start-Sleep -Milliseconds 900 }`;
  const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{ windowsHide:true,stdio:['ignore','pipe','pipe'] });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', /* 按完整行解析快照，不发布未完成的 JSON。 */ chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0,boundary).trim(); buffer = buffer.slice(boundary+1);
      try { const value = JSON.parse(line); if (!Array.isArray(value)) throw new Error(); drives = value; failure = ''; ready(); }
      catch { failure = '本地磁盘发现失败，请重新进入或重启软件。'; ready(); }
    }
  });
  child.on('error', /* 启动失败必须反馈，不能静默显示空目录。 */ error => { failure = error.message; ready(); });
  child.on('exit', /* 意外退出不保留过期盘符。 */ () => { failure = '本地磁盘发现服务已停止。'; ready(); });
  return {
    /** 返回最近系统发现结果；失败时保留明确错误。 */
    async roots() { await initial; if (failure) throw new Error(failure); return drives; },
    /** 只停止本模块拥有的辅助进程。 */
    close() { child.kill(); },
  };
}
