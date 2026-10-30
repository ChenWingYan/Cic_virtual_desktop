# Cic virtual desktop

面向 Windows 的独立全屏虚拟桌面，提供浏览器、文件管理器和查验业务软件三个入口。

项目重点是解决实体屏幕与系统输出的方向、宽高比不匹配问题。通过软件内旋转和比例补偿，使桌面、网页及业务界面在实体屏上正常显示，并保持点击位置准确。

- [项目目标与实施边界](dsh/feature/docs/project-goals.md)
- 当前阶段：需求与架构分析，尚未实现业务代码。
- 架构方向：参考 `CustomInspectCounter_NewTypeDemo`，采用 Electron JavaScript 外壳和 Vite TypeScript 界面；按需接入 C++20 能力及现有业务后端。

本仓库暂未提供可运行程序，实体屏显示校正待原型及现场验证。
