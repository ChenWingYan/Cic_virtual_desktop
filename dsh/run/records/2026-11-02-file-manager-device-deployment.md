# 文件管理器设备部署

日期：2026-11-02。用户授权部署到 192.168.54.67，并允许需要时使用 Administrator 远程桌面。本记录不包含口令。

## 已交付

- 应用源码：`600b5dc12c751026cc8ba22bb9e754a969f4b6a0`，分支 `codex/file-manager`，PR #12。
- 目标目录：`C:\ProgramData\CicVirtualDesktop\releases\600b5dc`。复用目标机既有 Electron 45.1.0 运行时，保留 87c2c56 和 5915847 旧目录及用户配置。
- 公共桌面快捷方式：`C:\Users\Public\Desktop\CIC File Manager 600b5dc.lnk`。已回读目标 EXE 和工作目录，均指向新版本。
- 12 个应用文件逐项 SHA256 与本地打包目录相同。运行时 EXE SHA256 为 `C579ACAAB64B1C456BDA1693CDF1A2EC7E4DE7738B0E2D1B6349D60E8087143C`，与本地 Electron 45.1.0 相同。目标 `deployment-manifest.json` 保存源码版本与应用文件哈希。
- 附带 `Run-Files-Validation.cmd` 和独立 validation 目录，供交互桌面重跑。
- SSH 使用既有 known_hosts 校验主机身份。未修改账户、系统安全策略、显示设置、服务或计划任务。

## 部署前修复与本机验证

打包态同时保护外层 EXE/运行时安装目录和 resources/app，避免只保护应用代码目录。文件操作结束等待旧核对完成后强制发布最终快照，避免重命名后残留旧选择；操作期间仍继续刷新磁盘和外部文件。

本机 34 项测试、类型检查和构建通过。真实打包版文件冒烟通过，报告 `packaged:true`、`installationProtection:passed`，覆盖文件操作、刷新、回收站及四方向。该结果不能替代目标机 GUI 验证。

## 设备验证边界

目标 SSH 命令可启动附带的验证入口，但设备运行在截图步骤超时；设备日志未报告通过，未生成 files-smoke.json。调用端 SSH 的等待也超时，已取回设备日志到本地 artifacts/files-device.log。

远程计划任务查询返回 Access is denied。Administrator RDP 请求停留在 Windows 凭据交互，未完成登录，未确认新版本图形界面在交互桌面运行。没有为绕过限制修改权限或系统策略，也没有关闭旧业务进程。

文件部署、哈希校验和快捷方式已完成；设备端实际窗口启动、U 盘实物插拔、跨盘中断及刷新时延仍须交互桌面核对。目标机可双击公共桌面 `CIC File Manager 600b5dc` 打开新版本；可从新版本目录运行 `Run-Files-Validation.cmd` 获取设备测试报告。
