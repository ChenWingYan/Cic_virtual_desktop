# 独立查验产物接入

对应 [Issue #6](https://github.com/ChenWingYan/Cic_virtual_desktop/issues/6) 和 [ADR 0002](adr/0002-host-inspection-with-independent-components.md)。本轮是主屏最小接入原型，不代表完整业务及实体屏已验收。开发从旧校准 checkout 开始，随后整合本机 `codex/file-manager` 的现有桌面代码；其文件树 `c89de11e17ae289871f39ccfc117d480f41a8882` 与远端 main 提交 `17f1f7e6eb70a7d8fe4388d02d6746121d74ce23` 完全相同。保留浏览器和文件管理器，不覆盖其已有能力。

## 准备业务产物

业务工程 `E:/Maxvision/Project/CustomInspectCounter_NewTypeDemo` 独立维护。新增的 `app-shell/src/hosted/entry.cjs` 是业务专属适配入口，原 `app-shell/src/main/index.js` 和独立 EXE 无需变更。

在业务工程执行：

```powershell
node scripts/export-hosted.cjs
```

默认从已有 `release/CustomInspect_Full-win32-x64/resources/app` 导出到新的 `release/CustomInspect_Hosted`；不会构建业务或修改原发布目录，输出已存在时拒绝覆盖。可传入两个绝对路径分别指定发布包 app 根目录和新的导出目录。

产物包括 `inspection-component.json`、`hosted/entry.cjs`、默认配置、端口配置、业务页面及 preload、原配置及 HTTP 服务模块、后端及 DLL、cpp-core/assets 和业务依赖 ws。可整体拷贝到另一指定目录；桌面构建不依赖这些文件。

## 从桌面使用

在桌面工程构建并运行 `npm run build`、`npm start`，点击“选择业务目录”，选择包含 `inspection-component.json` 的导出目录，再点击“查验程序”。目录选择会保存到桌面用户数据目录。调试时可用 `CIC_INSPECTION_DIRECTORY` 环境变量指定绝对目录，`CIC_USER_DATA` 可隔离测试配置。

业务端口由产物中的 `hosted/runtime-config.json` 显式配置；默认 HTTP 18080、预览 18081、元数据 18082。也支持原后端的 `CUSTOMINSPECT_HTTP_PORT`、`CUSTOMINSPECT_PREVIEW_WS_PORT`、`CUSTOMINSPECT_META_WS_PORT` 环境变量覆盖。本机验证发现 18082 被无关程序占用，因此验证产物显式使用元数据 28082，保留其他程序运行。端口配置同时用于业务 preload、状态检查和后端环境，不能只改页面端口。

首次进入启动自有后端和本机页面服务。返回桌面只暂停画面传输，保留业务页面和会话；再次进入继续操作。退出查验清理自有窗口、服务和后端；状态繁忙或未知时先确认。重启始终要求确认，取消保留原会话。故障不会退出桌面。已有端口占用或不兼容产物会明确报错，不接管外部进程，也不自动退回启动外部 EXE。

托管模式首次使用时将原 `CustomInspect-full` 配置复制到桌面自己的 `inspection/system-config.json`，后续配置写入隔离副本，不覆盖原业务配置。主屏画布以 1920×1080 运行，通过离屏画面传给桌面；桌面工具栏与业务画面使用同一显示矩阵和逆向输入。副屏仅在另一显示器上创建，不接受统一旋转与补偿。

## 接口与验证

通用加载器只识别 `inspection-component.json` 的 `id=custominspect`、`apiVersion=1`、相对入口和 1920×1080 视口；入口必须在产物目录内。业务入口导出 `apiVersion=1` 与 `createHostedInspection`。返回的适配器负责 `start`、`stop`、可信页面授权 `attach`、`isBusy`、`getConfig`、`readStatus` 和自有 PID 查询 `getPid`。接口返回页面 URL、preload、主副屏参数，不能注册全局应用退出事件。运行契约见实际导出及调用方，入口不兼容时拒绝启动。

```powershell
$env:CIC_INSPECTION_DIRECTORY = 'E:\Maxvision\Project\CustomInspectCounter_NewTypeDemo\release\CustomInspect_Hosted_20261102'
npm run smoke:inspection
```

`scripts/inspection-smoke.mjs` 在真实 Electron 中测试四方向与非等比补偿下的实际按钮、文字/编辑键、滚轮、无设备视频探针、返回后 PID 保持、拖出释放、故障提示保持、确认/取消重启和退出清理。截图和 JSON 保存在 `artifacts/inspection-*`。启动独立业务实例后加 `--occupied` 可验证保留外部进程。

## 当前限制

- 帧管线为 PNG 数据传输，上限 15 FPS；这不是生产性能保证。视频探针验证的是画面能传输，不证明真实相机预览或设备性能已达标。
- 已验证文本转发和编辑键；真实中文输入法组合、候选框、系统快捷键、复制粘贴、多点触摸和无障碍仍需专项验证。
- 主屏业务内置浏览器、扫码串口、旧局域网更新器和部分本机工具暂未接入，调用时明确报错。业务保存图片和系统配置桥已连接，但完整业务流程仍需验证。
- 组件独立导出及加载已实现；自动安装更新、兼容升级与失败回滚尚未实现，运行期间不要覆盖产物目录。需先退出查验，导出至新目录后再选择。
- 当前进程锁位于应用数据目录 `CustomInspect-hosted.lock`；异常强制终止宿主可能遗留锁。只有确认对应进程和后端均已退出后才可清理，不能按端口批量结束进程。
- 实体屏、双屏设备和真实查验会话未在本轮验收。
