# 查验接入运行与方案证据
## 2026-11-02 查验接入调查与指定发布包启动

- 范围：用户要求运行指定 EXE 并评估虚拟桌面整合方式；未实施业务集成，方案待用户确认。
- 启动：2026-11-02 11:20:15 +08:00，E:\Maxvision\Project\CustomInspectCounter_NewTypeDemo\release\CustomInspect_Full-win32-x64\CustomInspect_Full.exe，主进程 PID 37348，子后端 custominspect_core_app.exe PID 44824。
- 实测：窗口标题 CustomInspect 主屏 Main；截图显示设备自检页。GET http://127.0.0.1:18080/api/v1/system/status 返回 code=0、message=ok、running=false、active=false。未开始查验会话；完整设备业务链路待现场验证。
- 发布包：resources/app/build-info.json 标记构建时间 2026-10-12、0.1.0-dev.20261012.4b92322b91d6-dirty；根 version 文件为 Electron 41.2.0。不能仅凭源码包版本判断发布产物新旧。
- 静态证据：业务 app-shell/src/main/index.js 主入口有应用级启动与退出副作用，不能直接导入桌面主进程；cppCoreProcess.js 可作为后端管理适配起点。业务页面依赖 preload/IPC，不等同于普通独立网页。
- 桌面现状：E:\Maxvision\Project\Cic_virtual_desktop\app-shell\src\main\index.js 当前仅单屏可信本地窗口；web-ui/src/main.ts 的浏览器和查验入口禁用。已有显示几何/输入矩阵契约，尚无离屏业务承载管线。
- 候选方向（未决策）：复用桌面 Electron，适配业务 preload/IPC 与后端管理，业务内容接入统一校正。保留独立 EXE 启动可作为对照，但外部窗口不会自动接受桌面变换。仍需明确更新边界、主副屏和生命周期。
- 运行状态：保留本次启动的程序供用户查看，未执行停止脚本。未修改业务代码、配置或构建发布包。
- 知识服务 127.0.0.1:8000 连接被拒绝，使用本地 DSH 规则和脚本目录。
- 补充核对：业务源码与发布目录的主入口/preload 文件相同，但 web-ui/dist/index.html 哈希不同。构建标记不证明整个发布目录未被后续替换；集成基线需明确。业务外壳另提供动态本机 UI HTTP 服务和 QR/价格代理，接入时须保留所需能力。
