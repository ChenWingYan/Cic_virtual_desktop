# 校准切片验证记录

日期：2026-10-30。关联 Issue #2；设计基线 ed84ca936bd4960876fdebb38f523751bcb7a7a1。功能分支 codex/calibration-slice。

## 执行证据

- TDD：显示几何入口缺失时首测失败；随后已知矩阵与留边通过。新增退化尺寸测试发现有效范围消失，修复后通过。桌面会话入口先失败，再实现切换、配置和恢复。审查提出的小数补偿边界回归先复现失败，再修复通过。
- 最终 `npm run typecheck` 成功；`npm test` 共 20 项通过；`npm run build` 成功。Vite 提示输出在前端根目录之外，目标是项目根 dist，未清空其他目录。`npm audit --omit=dev` 为零漏洞。
- `npm run smoke` 启动本机真实 Electron 45.1.0 全屏窗口。四方向分别使用 0.8/1.2 补偿，每方向四角均命中；Node 未暴露；preload 只含 onReset/quit；无页面运行错误。无效补偿保留原配置，Ctrl+Alt+R、固定按钮、返回主页和 Esc 均通过。极端 0.000001/1000000 补偿后固定按钮仍恢复默认。
- 截图人工检查：主页及 90° 校准页可见，四角在内容范围内，恢复条保持在输出层。非等比补偿下截图中圆形呈椭圆是指定补偿结果，不能据此判断设备链路已校准。
- 本地证据在 `artifacts/home.png`、`artifacts/calibration-{0,90,180,270}.png`、`artifacts/smoke.json`；可用 smoke 脚本重建。Electron 官方下载等待后切换 npm 镜像下载完成；未修改 lockfile 的包来源。

## Standards

初审发现中文回调用途注释遗漏，以及逻辑尺寸分散在样式、会话和几何请求。已补关键副作用回调和桥方法注释，单一 LOGICAL_SIZE 同时驱动 DOM 尺寸与几何计划。独立审查代理复核 442b80b：两项均修复，剩余阻塞 0 项。跨模块访问经 public；几何未依赖本机能力。

## Spec

初审发现 P2：小数补偿 0.8/0.8、960×720 到 800×600 时，合法角点因舍入误差成为区域外。已添加回归并复现 red；改为量级相关浮点容差，结果收敛至合法逻辑范围，800.001 仍拒绝。独立审查代理复核通过，并独立运行 19 项几何测试。剩余阻塞 0 项；未发现范围扩张。

两个审查轴均已完成修复与复核，Standards 0 项未解决，Spec 0 项未解决。

## 声明参考

采用本机 RepoContext language-adapters-v1 工具及其 init/update 流程，profile 只列三个真实 public 入口。固定源码提交：442b80b5fe6cc9258aa82015b548874109fe57a5。初始快照，无既有业务 API baseline。

- 输出：`.repocontext/output/442b80b/`，状态 supported，零诊断。
- build ID：906ae89267a46840a5385ca0fcf257701c54df2ba7a2e7d3916aff5b05b1fd6b。
- generate 与独立 verify 均通过：16 页、437 个内部链接。
- `node scripts/check-reference.mjs .repocontext/output/442b80b` 在真实 Electron 沙箱窗口验证离线搜索、类型链接、成员锚点。截图 `artifacts/reference.png`。
- 快照与截图属于可重建本地输出，未提交；profile、验证脚本与源码已提交。此提取结果不替代业务行为测试。

## 尚未完成

未操作目标设备。实体屏像素、DPI、安装方向和链路拉伸均未测量。未声称现场验收通过。外部网页离屏合成、中文输入法、滚轮、拖拽、触摸、弹窗、视频、性能、文件、查验接入和持久化保留给后续任务。

原有未跟踪 DSH、AGENTS 和配置文件保留，未覆盖或纳入功能提交。
