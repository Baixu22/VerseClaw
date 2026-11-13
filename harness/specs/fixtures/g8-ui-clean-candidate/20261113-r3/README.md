# G8 UI 干净候选验收

候选 `d07e97d96d1f829130106c7efe0b8e7841c8074c` 的门禁、截图、清理和源码守卫已回读通过。

| 检查 | 结果 |
|---|---|
| G8 单测 | 38 个文件，451 项通过 |
| CI 前置回归 | 8 个文件，189 项通过 |
| Electron | 69 项通过，全部进程清理与源码守卫通过 |
| 类型、四语、lint | 无缓存 Node/Web/Test 类型、四语资源和定向 lint 均 exit 0 |
| 构建、通讯 | runtime、Vite/Electron、comms replay/compare 均 exit 0 |
| 仓库 Harness CI | 完整执行 exit 0 |
| 路径归属 | G8 42 条 + CI 前置 17 条，共 59 条，零遗漏 |
| 视觉 | 120 张去重 PNG，34 张联系表，浅深色开合帧均已回读 |

已确认的空会话在 Gateway 断开后保留项目与工作树入口。generation/links 与 taskRef/sessionGeneration 继续使用 main 中已有的映射修复。
Claude Code 的 25 文件快照保留于 d1905d1eb；共享目录的 26 个原始文件与暂存内容在验收结束时保持一致。
契约 fixture 批量执行保留逐例结果和独立命令对照；类型检查仍检查三个项目，测试类型错误和缓存失效均有回归。
Agent Dev 深测全部阶段低于原有硬阈值；审计为 warn / 88 分，硬否决项为零。
完整命令和退出码见 COMMANDS.md；逐文件归属及历史 14 路径处置见 FILES.md；原始测试报告见 reports/。
Task Forest 提案、图和合并回执保留在本地收口记录中。

driven_by: agent · actor: codex-g8-ui-01a1d351 · realHumanEvidence: false
