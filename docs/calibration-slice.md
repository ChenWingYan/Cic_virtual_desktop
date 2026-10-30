# 首个全屏校准切片

本轮实现 Issue #2，基线为设计提交 ed84ca936bd4960876fdebb38f523751bcb7a7a1。主页、校准页和设置属于同一受管理 DOM 画布。跨模块使用 public 入口；不为后续文件、网页、查验能力建立空实现。

## 软件选择

- 逻辑画布先采用 960×720 CSS 像素；实际窗口尺寸动态适配，不把它当作硬件原生尺寸。0/90/180/270 为顺时针方向。
- 旋转、移至非负包围盒后，在输出轴应用横纵补偿，再以统一比例完整适配并居中。补偿决定横纵相对比例，共同倍数被适配抵消。内容不裁切。
- DisplayPlan 明确 CSS 像素、尺寸、有效范围、正逆矩阵及版本。平台 DOM 事件已是 CSS 像素，无须再乘 devicePixelRatio。更新在同一个同步调用内更换画面与命中计划；resize 重建计划。
- 初值为方向 0、补偿 1/1、字号 1。补偿接受可表示的有限正值；拒绝无效、溢出和有效范围消失的数值退化。失败保留此前显示。字号契约保留，首片不增加字号编辑功能。
- 恢复按钮位于输出区域之外的固定恢复条，不接受用户变换；主进程另捕获 Ctrl+Alt+R，避免表单焦点影响恢复。Esc 返回主页。退出保留明确按钮。
- 配置仅在本次会话有效；持久化及保存失败行为属于后续 Issue #4。切换页面或应用配置时清空四角记录，避免跨计划沿用命中。
- Electron 45.1.0、Vite 6.4.5、TypeScript 5.9.3、Vitest 3.2.7 与 Playwright 1.56.1 固定在 lockfile。主进程仅加载 dist/index.html；preload 仅暴露退出与恢复通知。不暴露 Node、任意 IPC、文件或进程能力。拒绝导航、新窗口、webview 与权限请求；退出 IPC 校验主 frame 和精确 URL。参考 [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) 的 sandbox/contextIsolation 配置。

## 验证与边界

公开几何接口测试包含已知矩阵、四角及内部位置往返、非等比补偿、留边、输出越界、非有限输入、无效配置与退化尺寸。桌面会话测试进入校准、配置版本、失败保留、返回和默认恢复。真实窗口自动检查另见 scripts/smoke.mjs。

未接入外部网页，因此不把本轮 DOM 校准效果当作离屏浏览器路线验证。中文输入法、滚轮、拖拽、弹窗、视频、触摸和性能留待后续切片。实际分辨率、DPI、屏幕像素、安装方向与连接链路未测量；软件截图不能证明实体屏比例或现场验收通过。

## RepoContext

`.repocontext/profile.json` 仅登记实际存在的三个 TypeScript public/api.ts 入口，并允许跟随其真实引用类型。主进程和 preload 没有可导出的业务 public API，不伪造 JavaScript 入口。声明参考从固定提交生成至 `.repocontext/output/`，不提交生成目录；生成与校验不替代业务测试。
