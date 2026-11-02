# 192.168.54.67 查验集成部署与设备验证

日期：2026-11-02T14:15:11.4712500+08:00。用户授权把 NewTypeDemo 和更新放到67；SSH凭据仅用于当前进程环境，未写入记录。

## 部署目录与快捷方式

- 新桌面：C:\ProgramData\CicVirtualDesktop\releases\4f0ea34。基础代码4f0ea34，设备适配修复ea54c05；沿用Electron45.1.0，浏览器及文件管理器保留。
- 独立业务版：C:\ProgramData\CustomInspect\releases\newtypedemo-20261102，来自用户最初指定的Full发布包，包含CommonUpdater.exe。原构建标记为2026-10-12，不将该目录称为重新构建的最新业务前端/C++。
- 托管产物：C:\ProgramData\CustomInspect\releases\hosted-6937c8e，基础接入6937c8e、用户目录修复7661b1d；元数据28082，HTTP18080、预览18081。
- 公共桌面：CIC Inspection 4f0ea34（集成版）、NewTypeDemo Standalone（独立版）、NewTypeDemo CommonUpdater（原更新器）。已回读快捷方式目标和工作目录。
- 旧版本87c2c56、5915847、600b5dc及旧快捷方式保留。未覆盖旧用户配置，未执行实际更新安装。

## 校验与修复

- runtime73、desktop-shell9、desktop-ui13、hosted64、standalone1335，加package.json，共1495个原产物文件逐一SHA256一致。排除原Full包中的机器运行runtime目录；测试工具与新增启动脚本另行交付。
- 两处设备修复后重新核对对应文件SHA256，并更新目标deployment-manifest.json及本地deployment-verification.json。
- 标准用户后端最初因向只读安装目录写runtime/backend/backend.log而退出。独立业务托管入口改用用户数据工作目录，并显式设置日志、会话归档及只读模拟资产绝对路径；未放宽安装目录权限。
- SSH非交互会话中默认GPU离屏画面为空；软件渲染可用，目标Start-Inspection.cmd显式加入--disable-gpu。未修改驱动、系统图形策略或显示方向。
- Windows把隐藏窗口限制为1024×768；桌面内容承载通过CDP固定业务逻辑视口1920×1080，已回读尺寸并通过目标机真实菜单点击映射。
- 修复后本机完整inspection-smoke再次通过，未把设备验证失败当作成功。

## 设备端结果与边界

- device-result.json：passed，packaged=true，业务画面和后端加载、1920×1080视口、mappedMenuClick、截图、返回桌面保留后端、退出清理后端均通过。
- standalone-result.json：passed，主/副屏页面均创建，自检页可见，后端code=0、active=false；已取得独立版截图。
- 以上测试通过SSH max账号的非交互会话和隔离测试实例执行，interactiveConfirmed=false。不能据此声称已在Administrator控制台留有正在运行的窗口，或实体屏形状/触摸已验收。
- 测试结束后18080、18081、28082无监听，未遗留测试业务后端；没有结束原有旧桌面或其他业务进程。未创建服务、计划任务或修改账户权限。
- 原CommonUpdater仅部署和哈希核对，未运行更新作业；集成组件的自动更新/回滚仍不在本轮完成范围。
- 现场可打开公共桌面的CIC Inspection 4f0ea34，进入查验；独立版与集成版不要同时启动后端。

## 证据

本地 artifacts/remote-192.168.54.67/inspection-4f0ea34/ 保存deployment-verification.json、device-result.json、standalone-result.json、inspection-device.png、standalone-device.png及复制日志。目标manifest位于新桌面目录，验证脚本位于validation目录，结果写在max用户Temp/CicInspectionCheck-4f0ea34。
