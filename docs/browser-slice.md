# 浏览器切片实现

当前规格见 [Issue #3](https://github.com/ChenWingYan/Cic_virtual_desktop/issues/3)。本切片基于已合并的 PR #9（main `be500ee`），功能分支 `codex/browser-slice`。文件管理器和业务软件仍为待接入入口。

## 内容承载

`app-shell/src/modules/content-host/public/api.js` 创建唯一的离屏 BrowserWindow。外部网页不使用桌面 preload；保持 sandbox、contextIsolation、webSecurity，关闭 Node 和 webview。网页使用 `persist:cic-browser` 独立会话分区。退出时由桌面清理自己创建的离屏窗口。

当前候选路线为 Electron 离屏位图 → PNG IPC → 桌面 canvas，帧率上限 30。网页画布和工具栏共用桌面的显示几何矩阵。帧带显示版本，界面解码后再次检查版本，过期帧和积压帧被丢弃。该路线便于验证统一显示，PNG 编码与传输的开销仍需目标设备评估，尚未确认为生产渲染方案。

曾试验原生内嵌 webview：0°、0.8/1.2 补偿下，网页绘制出来但实际鼠标点击未命中目标，因此没有保留该实现。当前四方向的真实点击验证使用离屏路线完成。

## 公开契约与输入

- `openBrowser` 延迟创建网页，等待空白文档及保护策略初始化，返回导航状态。
- `browserCommand` 只接受 navigate/back/forward/reload；主进程验证地址与命令。
- `presentBrowser` 同步逻辑视口、可见性和显示版本。隐藏仅停绘，保留 DOM、表单及历史。
- `browserInput` 接受坐标、按键、文本、组合输入和取消事件；主进程校验版本、坐标、长度与修饰键。
- `onBrowserFrame`、`onBrowserState`、`onBrowserNotice` 分别发布版本化画面、导航状态和操作反馈，不暴露 IPC 事件对象或网页进程对象。

上述桥仅存在于可信桌面。所有主进程请求均验证 sender、主框架及可信 URL。外部网页没有本机能力桥，也没有任意脚本执行接口。

界面通过同一显示计划的逆矩阵，把实际指针坐标变成网页逻辑坐标，再由内容承载发送 Chromium 输入。指针捕获保留拖动归属；离开网页释放输入。网页内部 HTML 拖放通过 Chromium drag 协议转发，不提供系统文件拖放。

文本代理保留在可信画布上，键盘事件进入网页，已提交文本通过 insertText 传递，组合文本通过 imeSetComposition 更新；原生中文输入法和候选框的位置仍需人工实测。程序插入中文的通过结果不代表输入法已验收。

平台适配将 DOM 方向键名转换为 Electron 键名，并补齐 Enter 字符路径以保留多行换行和表单提交。组合更新与文本提交通过串行队列执行，失焦时释放按键并取消未完成组合，避免跨通道乱序。

## 导航、会话和未支持项

地址栏只接受 HTTP(S)，缺省补 HTTPS，拒绝带账户密码的地址。页面跳转、重定向和资源协议另在主进程约束。新窗口 HTTP(S) 链接在当前页打开；不启动系统浏览器或额外可见窗口。

返回桌面后网页和会话保留。重启从本地起始页开始，不恢复旧网址；站点持久 Cookie 使用独立分区，站点是否继续认可登录由网站决定。本软件不提供密码保存能力。

下载在 will-download 中取消；文件选择在 Chromium 层拦截并反馈，不弹系统文件窗口。权限请求默认拒绝并反馈。原生 JavaScript alert/confirm/prompt 对话框当前关闭，依赖这些对话框的站点需单独评估。系统文件拖放、原生选择控件、业务站点兼容性、DRM/专有编码视频和目标设备触摸输入不在已通过的自动验证结论内。

## 验证入口

先执行 `npm run build`，然后执行 `npm run smoke` 和 `npm run smoke:browser`。浏览器测试使用随机本机 HTTP 端口、独立数据目录，结束后关闭其 Electron 和 HTTP 服务，不操作其他桌面进程。

浏览器测试覆盖真实 HTTP 页面、四方向点击、键盘和中文文本传递、滚轮、HTML 拖放、前后退/刷新、新窗口链接、文件操作拦截、失败反馈、Cookie 重启和本地 WebM 视频的连续合成像素。`tests/fixtures/sample.webm` 是自生成的 1 秒红/蓝切换测试片，不依赖外网或 ffmpeg 运行时。

`artifacts/browser-smoke.json` 保存本机 RAF 间隔、自动点击往返耗时和 Electron 进程资源快照；自动点击往返包含自动化开销，不能作为设备输入延迟。截图及运行 JSON 为可重建本地输出。

官方能力依据：[Electron 离屏渲染](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)、[webContents](https://www.electronjs.org/docs/latest/api/web-contents)、[IPC 安全边界](https://www.electronjs.org/docs/latest/tutorial/security)、[Chromium 文件选择拦截](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setInterceptFileChooserDialog)。能力文档不替代本项目行为测试或现场验收。
