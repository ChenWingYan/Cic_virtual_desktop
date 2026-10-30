# Cic virtual desktop

面向 Windows 的独立全屏虚拟桌面，提供浏览器、文件管理器和查验业务软件三个入口。

项目重点是解决实体屏幕与系统输出的方向、宽高比不匹配问题。通过软件内旋转和比例补偿，使桌面、网页及业务界面在实体屏上正常显示，并保持点击位置准确。

- [项目目标与实施边界](dsh/feature/docs/project-goals.md)
- 当前阶段：首个全屏校准切片已实现，设备验证待完成。
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

当前实现范围见[校准切片说明](docs/calibration-slice.md)。文件、浏览器和查验能力尚未接入；实体屏显示校正仍待现场验证。
