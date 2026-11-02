# 独立查验产物接入主屏原型验证

日期：2026-11-02T12:25:48+08:00。用户授权先写 Issue #6 再开发；规格：https://github.com/ChenWingYan/Cic_virtual_desktop/issues/6。

## 交付

- 桌面分支 codex/inspection-artifact-host，本地提交 b40f0e7；独立业务工程分支 codex/hosted-artifact-entry，本地提交 6937c8e。未推送代码或部署目标设备。
- 初始目录基于旧校准分支。后续已整合本机 codex/file-manager，其 tree c89de11e17ae289871f39ccfc117d480f41a8882 与 GitHub main 提交 17f1f7e6eb70a7d8fe4388d02d6746121d74ce23 相同。保留浏览器和文件管理器。
- 独立业务入口：E:\Maxvision\Project\CustomInspectCounter_NewTypeDemo\app-shell\src\hosted\entry.cjs；导出脚本：同工程 scripts/export-hosted.cjs。未修改原业务主入口或原 Full 发布目录。
- 交付产物：E:\Maxvision\Project\CustomInspectCounter_NewTypeDemo\release\CustomInspect_Hosted_20261102。完整独立目录，桌面只按目录加载。
- 导出命令：node scripts/export-hosted.cjs <Full resources/app 绝对路径> <新输出目录绝对路径>。本轮复用已有发布包，不重建 C++ 或业务前端。
- 原发布页面 SHA256：30636ebec6a5cc189d0a267c4809aebc484ce213d7d4de945180370d6b9d7c11。
- 新产物 hosted/entry.cjs SHA256：64A6F9D6B13E708018A1E48D0BD61945B2252AB26A1C40FED485C167F9A50ABB，与独立源码一致。
- 原默认元数据端口18082被无关程序占用，保留 PID44548运行。交付产物 hosted/runtime-config.json 显式配置 apiPort=18080、previewPort=18081、metaPort=28082，后端与页面参数一致。

## 验证结果

- npm run typecheck、npm test（35/35）、npm run build 通过。
- npm run smoke、npm run smoke:browser、npm run smoke:files 全部通过；浏览器的不可达地址错误为预期失败分支测试。
- 最终 node scripts/inspection-smoke.mjs 在真实 Electron 中通过，CIC_INSPECTION_DIRECTORY 指向上述交付产物，未设置替代元数据环境变量，验证使用产物自身28082配置。
- 业务主屏四方向、横0.85纵1.1补偿、真实菜单点击、文字/编辑键、Enter/Escape、滚轮和无设备视频探针帧传输通过。
- 查验运行期间切换浏览器和文件管理器再返回，后端 PID不变；不销毁其他应用内容节点。
- 画布外松开、几何改变时取消按下、故障跨帧保持、空闲取消重启、故障后确认重启、业务退出仅结束查验并清理自有后端均通过。原生重启确认分支在测试中模拟选择，真实业务会话未启动。
- 两轴审查发现并修复取消输入、故障提示清除、空闲重启未确认及整合后的Escape拦截；后续规格及标准复核已进行。详见代码和 artifacts/inspection-smoke.json。
- artifacts/inspection-conflict.json：独立业务预览实例占用时拒绝第二后端、原后端继续响应。随后确认本任务启动的预览 PID37348没有活动会话，正常关闭，子后端PID44824退出。
- 测试完成后未遗留本任务的custominspect_core_app.exe；无关端口占用进程未被停止。

## 限制与后续

- 真实中文输入法、候选框、系统快捷键和复制粘贴仍需专项验证。文本注入成功不等同于原生输入法验收。
- 视频探针无设备，不代表真实相机、视频性能或目标实体屏已验收；双屏设备未验收。
- 业务内置浏览器、扫码串口、旧更新器及部分本机工具未接入。独立产物加载已实现，自动更新安装/失败回滚未实现；停止查验后选择新产物目录。
- Issue保持开放，后续验收项不以原型通过替代。
