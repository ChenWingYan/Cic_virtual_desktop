# 虚拟桌面首期模块与公开契约设计

日期：2026-10-30。状态：设计完成，业务代码、构建、运行和现场验证尚未开始。实施规格与任务以 [GitHub Issue #1](https://github.com/ChenWingYan/Cic_virtual_desktop/issues/1) 为入口；目标正文沿用[项目目标](project-goals.md)。术语见[领域词汇](../../../GLOSSARY.md)，长期取舍见 [ADR 0001](../../../docs/adr/0001-managed-content-and-public-contracts.md)。

## 技能执行顺序与已采用的推荐项

本轮按 RepoContext 新项目设计流程执行：核对现有 Matt setup 配置 → grilling 识别决策及未知事实 → domain-modeling 定义术语 → codebase-design 设计模块契约 → 适配 to-spec 整理 Issue #1 → 适配 to-tickets 拆分实现任务。未调用 implement、implement-spec 或 tdd 实现业务代码；未执行 repocontext-update 生成不存在的接口快照。

| 决策 | 采用的推荐项 | 理由或验证条件 |
| --- | --- | --- |
| 任务与领域资料 | GitHub Issues、默认五种标签、single-context | 沿用现有配置与 DSH 单一目标正文 |
| 技术分层 | Electron JavaScript 外壳 + Vite TypeScript 界面 | 沿用项目目标；版本在原型建立时核对并锁定 |
| 模块组织 | 业务职责划分，public 契约与 internal 实现分离 | 调用者不依赖内部渲染和进程细节 |
| 首个验证切片 | 单屏校准页、四方向、输入命中和默认恢复 | 尽早暴露输出与输入链路问题 |
| 网页显示路线 | 首先验证离屏内容合成及反向输入 | 技术候选；性能、中文输入、弹窗和视频通过后再确定生产方案 |
| 文件功能 | 首期只读目录浏览 | 不扩展到写入、删除、外部文件打开校正 |
| 查验接入 | 先验证前端兼容，再接入既有后端 | 不复制业务逻辑；避免重复缩放及 preload 不兼容 |
| 原生扩展 | 首期不新增 C++ | 只有实际能力或性能证据支持时引入 |
| 多屏 | 首期单屏，双屏留作后续范围 | 不假定主副屏拥有同一输出参数 |
| 默认配置 | 0°、补偿 1/1、字号比例 1，支持恢复 | 仅为软件安全初值，不代表样机已校准 |

用户已授权采用推荐项。未测量的分辨率、DPI、设备性能、连接链路及输入方式仍是未知事实，由现场验证任务收集。

## 一条核心流程

操作员在显示设置中选择配置 → 桌面会话请求显示几何生成变换 → 内容承载按计划呈现校准页或网页 → 平台输入先换算到输出区域坐标 → 显示几何执行逆变换 → 内容承载把交互交给对应内容。保存设置时调用显示配置，下一次启动读取并校验后恢复。

显示几何给出的正逆变换必须使用同一版本。配置更新期间不允许旧输入映射配上新画面；拖拽、焦点、取消及视口尺寸变化均需有明确处理。

## 模块职责与隐藏复杂度

以下操作与类型均为拟议契约，尚不是可导入的代码。所有公开操作在实现时使用中文用途注释和可提取的参数文档。

| 模块 | 调用者与公开能力 | 隐藏的复杂度 | 验证入口 |
| --- | --- | --- | --- |
| 显示几何 | 可信界面及内容承载；`createDisplayPlan(request)`、`mapOutputInput(plan, point)` | 四方向、旋转包围盒、留边、补偿、正逆矩阵及无效输入 | 纯计算契约测试、往返与边界测试 |
| 内容承载 | 桌面会话；`openContent(spec)`、`setPresentation(session, plan)`、`dispatchInput(session, event)`、`closeContent(session)` | Electron webContents、帧合成、导航、焦点和资源释放 | 真实网页及测试内容的交互验证 |
| 桌面会话 | 桌面界面；`activateEntry(entry)`、`returnHome()`、`applyDisplayProfile(profile)` | 主页和三个入口切换、活动内容及配置版本协调 | 从主页进入并返回，关闭和异常恢复 |
| 本机文件 | 可信文件界面；`listDirectory(request)` | 允许根目录、路径规范化、符号链接及 Windows 权限错误 | 临时目录及拒绝越界的可观察结果 |
| 显示配置 | 桌面会话；`loadDisplayProfile()`、`saveDisplayProfile(profile)`、`resetDisplayProfile()` | 存储位置、格式版本、校验、失败保留和默认恢复 | 重启恢复及保存失败场景 |
| 查验接入 | 桌面会话；`connectInspection(target)`、`disconnectInspection(connection)` | 既有 preload/运行配置、后端连接及进程归属 | 实际前端兼容与后端生命周期验证 |

本机文件和显示配置已有真实外部资源，适合通过可替换依赖执行测试。纯显示计算不建立虚构适配器。内容承载的 Electron 适配内部可以演化，调用者不接受 Electron 原生对象作为跨进程契约。

## 关键契约

`DisplayProfile` 包含方向、横纵补偿和字号比例。方向限 0/90/180/270；数值必须有限，补偿及字号比例必须为正；上限由原型可操作性验证确定。逻辑尺寸和视口来自当前布局与输出区域，不把标称 3:4 和 4:3 写成固定补偿算法。

`DisplayPlan` 包含明确坐标单位、逻辑尺寸、输出区域、有效内容范围、正向矩阵、逆向矩阵及配置版本。先定义逻辑布局，再旋转并把包围盒移至非负坐标，之后执行等比适配、比例补偿和输出定位。具体矩阵由单一模块生成；输入按反序执行逆变换。DPI、设备像素与窗口坐标的换算由平台适配明确承担，不能假定天然相同。

`MappedInput` 表示命中后的逻辑位置或区域外结果。留边、越界、退化矩阵和非有限数值不得静默转成合法点击。纯几何模块处理位置变换；按键、文本、焦点及输入法由内容承载的输入契约处理，不能把鼠标坐标正确当作所有输入已支持。

`ContentSpec` 区分校准、浏览器和查验内容。浏览器导航能力由当前内容会话提供，内部导航句柄不泄漏到界面。受管理内容关闭后，未完成操作返回已关闭错误。弹窗、下载、上传与权限请求按原型验证结果逐项收敛；未支持项明确反馈。

`DirectoryRequest` 以已授权根目录和相对位置表达浏览请求。实现时必须验证规范化后的最终路径及链接目标，不能仅用字符串前缀判断授权。首期返回名称、种类及浏览需要的元数据，文件系统异常映射为可显示的错误结果。

`InspectionConnection` 明确是否由本软件启动了后端。断开连接只能停止本软件拥有的进程；已存在的外部业务进程不因桌面退出而被误停。尚未验证的 preload 能力保持未接入状态。

跨进程数据使用可序列化 DTO 和明确错误结果。可信 preload 逐项暴露必要能力，主进程验证参数及调用来源。外部网页不获得文件、进程或任意 IPC 权限。

## 目录与依赖约定

这是计划布局，本次不创建占位源码：

```text
app-shell/src/
  main/                         # 生命周期与模块装配
  preload/                      # 可信界面的窄能力桥
  modules/
    content-host/{public,internal}/
    local-files/{public,internal}/
    display-settings/{public,internal}/
    inspection-bridge/{public,internal}/
web-ui/src/
  features/
    desktop-session/{public,internal}/
    display-geometry/{public,internal}/
    browser/{public,internal}/
    file-browser/{public,internal}/
    calibration/{public,internal}/
  shared/contracts/             # 跨进程 DTO，不放业务实现
```

跨模块只从 public 入口访问。public/api 与 public/contracts 按需要建立，不为凑目录创建空接口。Electron 主进程不得直接依赖 UI DOM；界面不得直接访问 Node 文件系统和进程。纯显示几何不依赖 Electron、磁盘或业务后端。禁止从其他模块的 internal 导入；未来由固定检查器验证，目前只是规范。

RepoContext 计划覆盖主进程 JavaScript 的显式导出及前端 TypeScript 的 public 声明，跟随实际引用的契约类型。PR #4 已提供 JavaScript 适配器，但动态导出仍受限制。当前无源码入口和 tsconfig，因此不写可执行 profile、不运行提取、不创建 API 基线。实际骨架建立后生成匹配真实文件的配置。

## 验证与推进顺序

1. 先建立最小校准切片：全屏窗口、校准内容、正逆变换、四角命中及默认恢复。
2. 使用实际网页验证离屏候选，记录焦点、输入法、滚轮、拖拽、弹窗、视频与目标设备性能。失败则停在渲染决策，不继续堆业务。
3. 形成可保存并重启恢复的显示设置；验证无效配置及保存失败。
4. 接入允许根目录内的只读文件浏览。
5. 对既有查验前端及后端进行兼容验证，再进入具体业务集成。
6. 样机采集实际输出链路并完成实体屏验收；软件截图与设备影像同时留存。

每项从公开契约验证。实现时运行对应测试、类型检查与 code-review；源码形成明确提交后再执行 repocontext-update。文件浏览可在最小校准切片后并行推进，完整查验接入应等待渲染验证及后端归属明确。

## 原型必须回答的问题

| 问题 | 推荐行动 | 完成证据 |
| --- | --- | --- |
| 链路究竟怎样拉伸和旋转 | 采集系统及屏幕原生尺寸、DPI、连接与显示器模式 | 设备信息及实体屏校准影像 |
| 网页和工具栏能否统一显示 | 验证离屏内容合成候选 | 同一变换下的真实页面与输入记录 |
| 输入法和原生窗口是否可用 | 单独验证中文组合输入、候选框、弹窗 | 实际可操作记录；不以合成鼠标事件替代 |
| 性能是否满足使用 | 在目标设备测量帧间隔、输入延迟、资源及视频效果 | 实测结果与可接受条件；不编造数值阈值 |
| 查验旧缩放及 preload 如何处理 | 核对参考工程，制作接入验证 | 依赖清单、缩放归属与可运行的验证结果 |

## 外部依据

- [Electron 离屏渲染](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)：提供候选能力，不证明本项目的输入法和性能已经满足要求。
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)：可信 preload 的隔离与显式能力暴露。
- [Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)：外部内容的进程能力限制。

参考工程的符号定位与已有行为继续由目标正文维护。本轮核对了对应符号的存在；没有运行参考工程或操作实体设备。
