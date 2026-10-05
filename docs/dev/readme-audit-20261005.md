# README 覆盖与真实性验收 — 2026-10-05

本次由 `codex-readme` 执行，`driven_by: agent`。验收对象是四语 README、架构导读及其图片。基线为 `cafe03a5939beac5c3e4e47ef78e8d5f88f86386` 加已有未提交改动；此前 README 已有大量扩充，本轮在其上继续修订，没有把这些已有改动归为本轮新实现。

结论：README 的**入门与导航覆盖已齐全**，覆盖当前主要用户入口、配置、开发、诊断和能力边界。它不是全部 API/插件的手册，也不能据此认定全产品验收通过。本文的自动化结果与图片摘要见[视觉清单](../../resources/readme/2026-10-05/manifest.json)。

## 逐项覆盖

| 读者问题 | 当前入口 | 本轮核对依据 |
| --- | --- | --- |
| 项目是什么、现在能使用到什么程度 | 定位、alpha 状态与功能表 | `package.json`、`shared/capability-claims.ts`、产品语义 |
| 界面长什么样 | 4 类界面，中英各一套真实截图 | 本轮 Electron 驱动、PNG 和捕获收据 |
| 怎样开始对话与代码工作 | 首次使用、代码工作流与权限说明 | `src/App.tsx`、`src/pages/Chat/index.tsx`、chat stores |
| 文件、终端、浏览器和审查在哪里 | 项目工作区说明 | `WorkspaceCompatibilityRoute` 与对话工作区面板入口 |
| 怎样积累和复核知识 | 知识工作流、插件前置条件 | Knowledge 页面、`memory-wiki/openclaw.plugin.json`、Wiki Gateway 注册 |
| Chat、任务账本、Task Loop、ClawGraph 有何区别 | 任务工作流与架构导读 | TaskLedger 路由、产品语义、编排文档 |
| 如何配置模型、Agent、Skills、频道、定时任务 | 功能表、配置表、首次使用 | `src/App.tsx`、Settings `route-config.ts`、对应页面 |
| VerseConf 是否开箱即用 | 结构化产物段落 | 当前集成说明、插件配置及三页模板限制 |
| 怎样安装、启动、打包 | 快速开始与命令表 | 根与 runtime 的 `package.json`、Electron 安装策略、构建输出 |
| 数据保存在哪里、是否完全离线 | 配置与本地数据 | `electron/utils/paths.ts`、本地 usage/存储实现 |
| UI 与 runtime 如何通信 | 架构图、时序图、源码映射 | `host-api-client.ts` → preload → host dispatcher → `chat-api.ts` → `GatewayManager` |
| 怎样开发与验证 | 开发命令、按改动选择门禁、Agent Dev | 当前 package scripts、测试类型门禁、Agent Dev 文档 |
| 常见失败如何排查 | 常见问题 | 缺 Electron、未就绪 Gateway、Wiki 未加载等实际入口 |
| 平台、实验能力和许可证有什么限制 | 平台表、实验范围、贡献与许可 | 打包配置、能力语义、默认矩阵、资源声明 |

## 已修正的过时或不足内容

1. **旧 API 路径。** 四语 README 的架构段落仍引用不存在的 `src/lib/api-client.ts`。实际请求入口是 `host-api.ts` → `host-api-client.ts` → preload `hostInvoke`。
2. **传输描述混淆。** 旧文将普通调用概括为 WS → HTTP → IPC 回退。当前 typed facade 先走 IPC，Gateway 服务再走 Main 所持有的 WebSocket RPC。新图分别说明两条边界，并说明本地 Host 服务无需全都经过 Gateway。
3. **知识插件前提缺失。** 实际启动干净 Gateway 后，未启用 Wiki 插件的页面报告 `unknown method: wiki.status`。README 现明确插件和 vault 前置条件，并增加故障排查。隔离配置显式加载插件后的截图不再出现该错误。
4. **截图来源过于笼统。** 原来只链接旧 `resources/screenshot/` 并提示可能过时。现在直接展示本轮图片，记录版本、平台、配置和空数据状态；旧资源保留，不充当当前验收证据。
5. **logo 传输体积不必要。** README 原引用的 SVG 内嵌大体积位图；改用仓库已有约 73 KB 的 `logo.png`，保留同一品牌形象，未改应用资产。

没有删除有效的安装步骤、验证门禁、许可证或功能限制。历史任务编号、长验收记录和运行细节通过文档导航承接；README 不堆砌测试分数、历史通过次数或“全部默认可用”宣传。

## 图像验收

- 两张手绘流程插画：按指定 skill 的构图方法生成，使用项目火焰角色，保留确切提示词。它们是概念解释图，不是实机截图。
- 八张应用截图：四个页面 × 两种语言，直接来自真实 Electron 和隔离 Gateway。知识插件显式加载，无模型账户、虚构消息或 backend mocks。
- 两张 Mermaid 技术图：保留 `.mmd` 源文件和 SVG；架构导读同时提供原生 Mermaid 时序块。
- 中文、英文 README 使用相应语言截图；日文、俄文 README 明确使用英文 UI 图片，四语正文范围一致。

首轮驱动只检查路由可见，捕获了加载中设置与未启动 Gateway；随后增加真实 Gateway 就绪与内容加载检查。后一轮中文截图曾超时，保留该失败记录，分别重跑最终中英用例。只提升最终检查过的 PNG，不将早期路由测试通过等同于合格截图。

## 本轮验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm run build:vite` | exit 0，Renderer 与 Electron Main/preload 构建完成 |
| 最终截图用例 | 英文 1/1，中文 1/1，分别运行均 exit 0、无跳过；早期同轮 1 通过 / 1 超时保留 |
| `first-product-claims.test.ts` | exit 0，5 passed / 0 failed / 0 skipped |
| 截图驱动 ESLint | exit 0，`--max-warnings 0` |
| 本地文档引用 | 检查 306 个引用，缺失 0；四语显式导航锚点一致 |
| README 命令 | 27 个脚本名与当前 package scripts 一致；命令存在不代表本轮逐个执行 |
| Mermaid | 2 份 SVG 可解析并完成视觉检查；原生时序块与 `.mmd` 源文一致 |
| Markdown 预览 | 本地 Marked + Edge 渲染中文 README，8 个嵌入图、坏图 0、横向溢出 0；不是 GitHub 在线验收 |
| 资源保留与差异空白 | `repo:artifacts:check`、README `git diff --check` 均 exit 0 |

图片与来源文件共约 1.44 MB（不含清单自身）；插画使用 WebP，技术图使用 SVG，截图保留 PNG。确切字节、SHA-256 与捕获时间保存在清单中。

## 保留的真实限制

- 图片中的知识库尚未初始化、模型尚未配置、账本没有节点。它们证明当前界面与相应状态，不证明 Wiki 应用、付费模型对话、任务执行、频道投递或插件导出的完整闭环。
- 截图侧栏保留截图机器真实的磁盘空间告警。未修图隐藏，也没有改阈值。
- 开发启动器的通用设置“关于”曾显示 Electron 的版本号；最终选用模型设置截图，项目版本始终从 `package.json` 记录。此显示问题未在文档任务中改产品实现。
- `harness/specs/scenarios/gateway-backend-communication.md` 及部分旧政策仍含 `api-client.ts` 旧命名；本轮架构导读明确当前实现，未擅自扩大为通信策略/运行时重构。
- 历史能力表和设计文档有各自日期，不能当作当前全部能力的实时证明。README 保留 alpha、平台差异、opt-in、插件默认关闭、PPTX 三页限制等真实边界。
- 本轮没有重做所有功能测试、全平台安装或发布验收，也没有修改产品默认值、发布或推送。
