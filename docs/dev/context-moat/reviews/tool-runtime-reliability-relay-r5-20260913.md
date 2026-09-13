# 工具运行时可靠性第五批接力（TF-0209～TF-0213）

日期：2026-09-13。工作区：`D:/ClawX`（桌面 ClawX 入口为 junction）。
起点：`feat/runtime-lifecycle-governance` / `4f58694411c717b0d93a2f0d418ef7d3faa9b414`，工作区干净。
授权：用户要求接力最新 Task Forest 开发，至少完成五个节点。上一批 TF-0199～TF-0208 已完成，
本批从新的可执行反例建立五个后继子节点，均挂 TF-0102，依赖已完成的 TF-0208。

本记录按 `DEV-PROTOCOL.md` §D1、§R1、§R2、§R3 留存工程验收。
结论：**TF-0209～TF-0213 五个开发节点全部 done/100**。实现、L0/L1、Electron、独立审查、
回滚演练、五节点提交归属门和任务图校验均完成。用户明确采用已完成的独立审查作为本批最终代码审查。

## 五个独立行为缺口

| 节点 | 修复前反例 | 最终行为与范围 |
|---|---|---|
| TF-0209 挂起的工具策略等待可立即取消 | trusted policy / before-tool hook 的 Promise 未结束时，取消仍等待晚到结果 | 复用 `awaitWithAbort` 结束本地等待，保留原始取消原因；晚到拒绝不进入审批或执行，移除等待监听器 |
| TF-0210 挂起的工具准备阶段可立即取消 | wrapper / adapter 等待 `prepareBeforeToolCallParams`，取消不能及时结束 | 两个入口均中断准备等待；晚到参数不进入后续策略或执行 |
| TF-0211 进程输入应答保留所有者终态 | write / send-keys / submit / paste / EOF 回调期间进程退出，原应答仍显示 running | 共用 `buildProcessInputResult`，读所有者终态并保留退出信息和输出；code=0 的超时仍 failed；写入后已退出不再发送 EOF |
| TF-0212 会话别名合并去重同一调用证据 | sessionId / sessionKey 分别记录同一次请求，合并后重复计数并过早触发检测 | 按 run、tool、toolCallId 去重，保留原请求参数与时间，补齐已有结果；不同 run/tool 及匿名记录独立保留 |
| TF-0213 轮询等待变化不能绕过无进展检测 | 对同一进程重复 poll，只改变 timeout 即形成不同 hash | poll 调用身份排除 timeout；不同进程仍隔离，中文输出真实变化可以重置无进展判定 |

九个 TypeScript 文件中生产改动为六个，测试为三个；另更新现有 Electron E2E、三语 README 和
Harness 任务/规则/场景。只登记任务、更新文档和格式化不计入五个开发节点。

## 红绿证据与共同回归

原始日志目录：`C:/Users/27933/AppData/Local/ClawX-scratch/tool-runtime-relay-20260913-r5/`。
这些日志为本机工程证据，不把上一批的计数或结论复用于本批。

| 检查 | 实际结果 | 文件 |
|---|---|---|
| 修复前共同反例 | 84 tests：71 passed / 13 failed；覆盖全部五节点 | `red.json`、`red.log` |
| TF-0209 聚焦 | 6 passed；24 项未选择；exit 0 | `TF-0209.json`、`.log` |
| TF-0210 聚焦 | 7 passed；23 项未选择；exit 0 | `TF-0210.json`、`.log` |
| TF-0211 聚焦 | 26 passed；exit 0；后补 write→EOF 之间退出的控制用例已纳入共同回归 | `TF-0211.json`、`.log` |
| TF-0212 聚焦 | 8 passed；20 项未选择；exit 0；后补身份控制用例已纳入共同回归 | `TF-0212.json`、`.log` |
| TF-0213 聚焦 | 28 passed；exit 0；后补进程隔离及中文进展断言已纳入共同回归 | `TF-0213.json`、`.log` |
| 最终 agents 共同回归 | 12 files / 128 passed；exit 0 | `agents-final.json`、`.log` |
| native unit-fast | 1 file / 2 passed；exit 0 | `native-final.json`、`.log` |
| 非实现者独立复跑三个变更测试文件 | 3 files / 88 passed；exit 0 | `independent-focused.json`、`.log` |
| `pnpm --dir openclaw_runtime tsgo:core` | exit 0 | `typecheck.log` |
| 九个 TS 文件 scoped typed oxlint wrapper | exit 0；已用 oxfmt 格式化 | `lint.log` |
| E2E 文件 ESLint | exit 0 | `e2e-eslint.log` |
| `pnpm run build:runtime` | 初次及回滚恢复后均 exit 0；Gateway smoke ready | `build-runtime.log`、`build-runtime-restored.log` |
| `pnpm run build:vite` | exit 0；含 Main/preload 构建 | `build-vite.log` |
| `pnpm run comms:replay` / `pnpm run comms:compare` | 均 exit 0 | `comms-replay.log`、`comms-compare.log` |
| `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground --workers=1 --reporter=list` | 串行复跑 2 passed，14.8s；exit 0 | `e2e-foreground-serial.log` |

Electron 检查在真实桌面进程内注入模拟运行时事件，验证正常/失败输入终态保留输出与退出文本，
并验证 run 结束后输入框恢复。它不构成真实 provider、远程机器执行或具名真人验收。

首次 Electron 执行是 **1 passed / 1 failed，exit 1**，失败发生在启动进程：
`RAW: Check new_pages != nullptr failed: VirtualAlloc failed`，未进入用例断言。
当时并行的 typed lint 同样因分配失败退出。保留 `e2e-foreground.log` 与原始 trace；
停止并行重型门后完整重跑两个用例通过，没有增加重试参数或改变断言。

Vite 保留已有大 chunk、混合静态/动态 import 及 Shiki 未使用外部 import 的警告；本批没有修改
这些构建依赖或打包边界。构建 exit 0 不表示这些警告被修复。

## §R2 L1 六项

| 命令 | 实际结果 | 日志 |
|---|---|---|
| `pnpm lint:bom` | exit 0 | `l1-bom.log` |
| `pnpm contract:check` | exit 0 | `l1-contract.log` |
| `pnpm typecheck:node` | exit 0；当前脚本存在，使用现有 root tsc 命令 | `l1-typecheck-node.log` |
| `pnpm lint:dcs` | 串行复跑 exit 0 | `l1-lint-dcs-serial.log` |
| `pnpm test:dcs` | exit 0；23 files：327 passed / 1 skipped；5 files：10 passed；11 files：95 passed；findings registry OK；root 1 file：7 passed | `l1-test-dcs.log` |
| `pnpm exec vitest run tests/unit/config-schema-parity.test.ts tests/unit/default-config-matrix.test.ts --maxWorkers=1` | 2 files / 157 passed；exit 0 | `l1-parity-matrix.log` |

`lint:dcs` 首次 exit 1，原文：`fatal error: runtime: cannot allocate memory`，
`Error running tsgolint: "exit status: exit code: 2"`，留存 `l1-lint-dcs.log`。
复跑使用同一规则、文件清单和 type-aware/type-check 参数，仅对该命令设置
`GOMAXPROCS=2`、`GOMEMLIMIT=2GiB` 控制资源；未取消类型检查或降级错误。

## §R1 独立审查

审核者 `/root/r5_independent_review`，独立于实现者 `/root`。完整审查、实际命令及原始输出链接在
本机 `independent-review.md`；审查指纹 `independent-reviewed-files.json`。
结论为 **implementation approve，无 P0/P1/P2/P3 阻断性代码发现**。三个文件 88 项测试由审核者复跑，
八个导出符号的 production-reachable 命令 exit 0，且人工追溯实际调用，未以静态可达计数替代执行器证明。

| 节点 | A1 生产入口与执行链 | A3～A6 |
|---|---|---|
| TF-0209 | attempt → createOpenClawCodingTools → wrapper → runBeforeToolCallHook → trusted policy / hook 等待 | 本地取消边界与文档一致；未改配置，CJK/数值预算不适用 |
| TF-0210 | attempt → splitSdkTools → toToolDefinitions；以及 wrapper → 实际 exec/lazy exec prepare | 两入口均验证晚到结果不得执行；未改配置，CJK/数值预算不适用 |
| TF-0211 | 工具工厂 → process.execute → write/submit/paste/send-keys → buildProcessInputResult；exec-runtime 为 markExited 所有者 | 独立 6 动作×4 退出组合共 24 组，验证 code 0/7/null、信号、中文输出、后续 poll 的同一终态对象 |
| TF-0212 | wrapper 的请求/结果路径 → getDiagnosticSessionState → 双别名 mergeSessionState | 独立读取基线源码在内存比较：旧 2 条、新 1 条，保留原 argsHash/timestamp/resultHash；身份不分词，CJK 不适用 |
| TF-0213 | 请求、检测、结果关联共同消费 hashToolCall | 0/-1/NaN/30000/[] 等 timeout 不改身份；不同进程/其他工具/其他参数保持区分；中文真实进展解除 streak |

A2 四类反证（实际查找位置和逐项输出详见独立报告，以下结论同时回填 node.evidence）：

| 节点 | 默认旗标 | kill switch | 上游守卫 | 旁路分支 |
|---|---|---|---|---|
| TF-0209 | 未新增默认关叶子；现有注册决定有无策略可等 | 无新增隐藏开关；取消 signal 本身为受验行为 | 无策略可直接允许，有策略进入可取消等待 | approval/report 位于等待后，未发现绕开新等待的路径 |
| TF-0210 | exec/lazy exec 的真实 prepare 无新开关 | 上游已取消时立即退出 | 无 prepare 使用同步原参数，有 prepare 两入口均等待 | beforeHookWrapped 委托给 wrapper 的同一准备守卫 |
| TF-0211 | 无新开关或默认值 | 既有 scope/backgrounded/stdin 可写限制保留 | 无权/不存在/不可写时先失败 | 全部输入分支共用终态 helper；退出后不继续 EOF |
| TF-0212 | 既有 loopDetection.enabled=true 未变 | 既有显式 disabled 仍被尊重 | 无会话身份不跟踪；有身份执行记录 | 请求/结果均重新获取别名状态，匿名和不同身份不误合并 |
| TF-0213 | 默认检测器及阈值不变 | 既有 enabled/detectors 设置保留 | 仅 process + plain object + poll 排除 timeout | 请求/检测/结果使用同一 hash，不只修单一入口 |

生产净新增 **52 行**，主要是可取消等待的适配和重复证据合并；复用已有 await helper，
并用一个输入结果函数替代多处固定 running 应答，没有新增依赖、存储或配置面。

结构化 CLI 使用 16 个变更文件的字节一致快照，完整生产调用链可从 `D:/ClawX` 只读核查；
未把省略的 Task Forest 生成物算作已审代码。起点及 SHA-256 在 `review-snapshot-manifest.json`。
命令为 `py -3 -X utf8 D:/ClawX/openclaw_runtime/.agents/skills/autoreview/scripts/autoreview --mode local --codex-bin C:/Users/27933/.codex/plugins/.plugin-appserver/codex.exe --prompt-file <scratch>/review-context.md --json-output <scratch>/autoreview.json --output <scratch>/autoreview.md --stream-engine-output`，
运行目录为 `<scratch>/autoreview-snapshot`，`<scratch>` 为上列日志目录。
保持同一默认 Codex 引擎和模型连续三次执行，均因 `We're currently experiencing high demand, which may cause temporary errors.`
以 exit 1 结束，未产出有效审查 JSON；保留 `autoreview.log`、`autoreview-retry2.log`、`autoreview-retry3.log`。
**2026-09-13 用户明确答复“采用独立审查并继续收口（推荐）”**，批准用上述已完成的独立审查替代本批 CLI 门。
不将 CLI 服务失败写作 `autoreview clean`。

## §R3 归属与 Harness

| 节点 | 实际提交 | authored 文件数 |
|---|---|---:|
| TF-0209 | `75ab6707aac56a7714d78edc751b305c7d4b7e66` | 2 |
| TF-0210 | `a7ba8022e5c4a31c4eb632a79816362017f5efc3` | 3 |
| TF-0211 | `0752b59aa07f02f7c652cb40eee0329dcc314c40` | 4，包含 Electron E2E |
| TF-0212 | `0c17f3dbc842891fc5929f4081f44ba7f19a36d0` | 2 |
| TF-0213 | `28ce72d3299c5fc2d4f4c8571a297b20a847ec64` | 2 |

每个提交只有一个 `Task:` 和一个 `Lane: lane-1`。共享文件按各节点的实际 hunk 分开提交，
每个触碰该文件的节点都计该文件。跨五节点的 README、规格、证据报告、交接、提案和回滚记录
属于 TF-0102 的本批集成材料，另列实际半径，不伪标 `Reviews:` 或从累计成本删除。
父节点不在本次完成集合内，其既有半径/里程碑/全轮预算不借本批子节点 PASS 放行。
本批集成材料为 **12 个 authored 路径 / 20 个总路径**，独立于上表的五个子节点半径；
集成提交使用 `Task: TF-0102`，不把这些公共文档成本塞进已通过的五个 S 档节点。

非实现者从 `590588791..HEAD` 重新查询全部归属提交，确认各节点恰好命中上表唯一提交；
R3 **五项全部 PASS，exit 0**，authored/full 分别为 **2/2、3/3、4/4、2/2、2/2**。
schema 路径为空，runtime/defaults 与含文档的 raw defaults 均 **0 命中**；grep 的无命中 exit 1
如实留在 `independent-r3.log`，没有写成命令本身 exit 0。提交后九个审查文件 **9/9 指纹一致**。
完整查询、脚本和逐节点结构化结果为 `independent-r3.sh`、`independent-r3.json`、
`independent-postcommit-fingerprints.json`。

采用 §R2.5.2 的显式路径 `git commit -F <message-file> -- <paths>`。当前 `scripts/committer`
会 `git restore --staged :/` 并进行无路径 commit，与该共享 index 约束冲突，因此未调用它。
提交前确认 index 无已有暂存，拆分过程只临时调整本轮自有文件，最终字节完全恢复到审查版本。

专用 `pnpm harness validate --spec harness/specs/tasks/live-tool-runtime-reliability.md` 与
`pnpm harness run --spec harness/specs/tasks/live-tool-runtime-reliability.md --dry-run` 均 exit 0。
提交后的最终检查将显式使用 `--since 4f58694411c717b0d93a2f0d418ef7d3faa9b414`，避免仅检查剩余文档 diff。

`pnpm run harness:ci` 实际 **exit 1**，失败原文和完整文件集保留于 `harness-ci.log`、
`harness-ci-report.json`。Gateway 场景默认以 origin/main 为基线：本批起点已有 **2097** 个分支差异文件，
本次报告收集 **2100** 个；失败为场景未覆盖的历史分支路径，而非本批任务规格的 ownedPaths 门。
未扩大场景所有权、改写历史基线或把 blocked 的后续 CI 步骤计作执行通过。
独立 R3 不将该全局失败升级为通过，也不对 TF-0102 整体作 R3/预算 PASS 声明。

## Task Forest 最终状态

起始、回滚演练、最终收口提案分别为：
`TFP-tool-runtime-relay-r5-start-20260913`、`TFP-tool-runtime-relay-r5-rollback-drill-20260913`、
`TFP-tool-runtime-relay-r5-close-20260913`，均由官方 CLI 保存并应用，生成快照 0580～0582。
五节点均 **done/100**；其余 **208 个节点的 status/progress 与本批开工后快照一致**。
回滚偏差 resolved，TF-0102 仍 in_progress。

`task_forest.py validate --workspace D:/ClawX` 与 `export` 均 exit 0。
`verify-closeout.py` 检查 HTML 内嵌 `CURRENT_GRAPH` 与 JSON 导出完全相同，并核对三个提案已应用、
五节点状态、旧节点状态及 16 个已验收源码/测试/规格文件指纹，全部通过。
证据为 `forest-validate.log`、`forest-export.log`、`forest-final-check.json`、`final-evidence.json`。
离线图：`.agent-workbench/task-forest/exports/task-forest.html`。HTML 包含完整历史快照，
本批验证数据一致性，没有修改模板或宣称额外浏览器交互验收。

## 交付边界与回滚

取消只结束本地策略/准备等待，不能宣称终止已经运行的插件工作或远程进程。
进程终态由现有所有者写入，本批输入应答读取它，不重新推断成功或改写登记簿。
循环检测沿用当前启用条件；没有新增或翻转产品默认开关。

回滚方案为对应节点提交的源码与回归测试反向补丁，不涉及持久化格式迁移。
实际演练由实现者在 `D:/ClawX` 的工作树执行：保存本轮六个生产文件及 diff，`git apply --reverse`
回到基线，保留最终测试重放，再 `git apply` 恢复并核对原字节；未向 index 写入回滚内容。
`rollback-drill.py`、`rollback-production.patch`、备份、两个完整测试 JSON 和 `rollback-result.json` 均留在 scratch。
基线为 **74 passed / 14 failed，exit 1**，五节点失败数 **2/2/6/3/1**；恢复后 **88/88，exit 0**。
实现者检查源字节和 index 无变化；独立审核者另核读原始 JSON 并确认审查九文件 **9/9** 指纹相同，
没有把这项核读说成审核者重新执行回滚。恢复后 runtime 构建和 Gateway smoke 再次 exit 0。
按 §R4.2(d)/§R4.3 登记 `TFD-tool-runtime-relay-r5-rollback-drill-20260913`，记录回滚阶段 proposed，
随后以已恢复的实现及独立验收重新收口；该记录明确是立即复原的演练，不是留下功能回退。

父节点 TF-0102 与既有里程碑不因这五个子节点完成而自动完成；TF-0009、TF-0133、
真实语料/真人条件、历史失败基线、`liveReady`、`productApproved`、default-on 等产品边界保持原状。
