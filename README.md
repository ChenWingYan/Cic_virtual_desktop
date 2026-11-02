# Cic virtual desktop

面向 Windows 的独立全屏虚拟桌面，提供浏览器、文件管理器和查验业务软件三个入口。

项目重点是解决实体屏幕与系统输出的方向、宽高比不匹配问题。通过软件内旋转和比例补偿，使桌面、网页及业务界面在实体屏上正常显示，并保持点击位置准确。

- [项目目标与实施边界](dsh/feature/docs/project-goals.md)
- 当前阶段：校准切片已合并；磁贴桌面、内置浏览器及实时本机文件管理已实现，目标设备验证待完成。
- 架构方向：参考 `CustomInspectCounter_NewTypeDemo`，采用 Electron JavaScript 外壳和 Vite TypeScript 界面；按需接入 C++20 能力及现有业务后端。

运行要求：Node.js >=22.12、Windows。首次安装 Electron 需要下载运行时。

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`npm run smoke` 启动真实 Electron 全屏窗口，检查四方向下的四角命中、恢复和返回，并保存截图到 `artifacts/`。退出按钮关闭应用；Ctrl+Alt+R 恢复软件默认显示，Esc 返回主页。`npm run dev` 仅用于前端调试，Electron 始终加载构建后的本地内容。

## 首期设计与任务

- [模块、公开契约与推荐项](dsh/feature/docs/initial-design.md)
- [领域词汇](GLOSSARY.md)
- [架构取舍](docs/adr/0001-managed-content-and-public-contracts.md)
- [实施规格与六项后续任务](https://github.com/ChenWingYan/Cic_virtual_desktop/issues/1)

当前实现范围见[校准切片说明](docs/calibration-slice.md)、[浏览器切片说明](docs/browser-slice.md)、[文件管理器说明](docs/file-manager.md)及[独立查验接入说明](docs/inspection-integration.md)。首页提供三个可进入的磁贴：浏览器支持单页面导航和保留网页；文件管理器提供本地磁盘、U 盘、实时刷新及受自身文件保护约束的文件操作；查验入口从指定独立产物目录加载主屏并管理自有后端。网页和查验采用离屏合成原型，生产渲染路线及实体屏效果仍待验证。

`npm run smoke:browser` 验证真实网页在四方向及补偿下的点击、文字、滚动、拖拽、视频、单页面导航、文件操作拦截与重启 Cookie。测试使用独立数据目录和本机随机端口，生成 `artifacts/browser-smoke.json` 及截图。原生中文输入法、候选框和目标设备性能仍须现场验证。

浏览器切片的执行证据与两轴独立审查见[验证记录](docs/browser-verification.md)。

`npm run smoke:files` 验证真实文件变化、复制和改名、冲突选择、回收站、自身保护及四方向文件界面，生成 `artifacts/files-smoke.json` 和截图。U 盘插拔及目标设备延迟仍需现场验证。

文件管理器的执行证据与两轴独立审查见[验证记录](docs/file-manager-verification.md)。
