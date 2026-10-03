# 进行中 Task Forest 节点工程记录（2026-09-13）

用户目标：处理原 12 个进行中节点，暂时跳过 TF-0140。工作目录为 `D:/ClawX`，
原 `C:/Users/27933/Desktop/clawx/ClawX` 为其目录别名。
主分支仍为 `feat/runtime-lifecycle-governance`，HEAD 为
`5dabc7ca5e86d2c08e5236e175323ebe4b4db804`；原有 21 个改动文件已先做逐字节备份。

## 已满足的节点条件

| 节点 | 本批结论与证据 |
|---|---|
| TF-0025 | Workspace 的 Browser/Review/Terminal/Files 入口及交互验证完成。修复恢复视图时写入旧话题标记的问题；显式新建、交接、fresh-agent 仍重置，分叉保留话题。7 文件/44 单测、9 个 Electron spec/16 用例通过，含 1280×800 / 960×800、Light / Dark 和文件树点选。 |
| TF-0026 | Knowledge 收敛为 Library / Review Queue；Chat 知识问答保留引用、候选和 v1 检查点。14 个相关单测、28 项 Electron 覆盖、应用类型、i18n、构建、通信和 scoped Harness 通过。修复草稿/提案串线、迟到审核结果和窄屏容器溢出。 |
| TF-0027 / TF-0021 | 次级页面及 UI 迁移收口。12 个设置分区、Setup、Observability、Knowledge、Workspace 等 20 个 Electron 文件 78/78 串行通过；移除视觉 Legacy 分支，旧链接进入当前工作区。另修复 Setup 安装和验证的迟到回包越步问题，31 个 Setup 单测及独立反例通过，最终受影响的 4 项 Electron 复验通过。 |
| TF-0074 | 重建固定 30 条真实语料的 deterministic/live 证据，完整评估 PASS。加入 Responses 协议和 L0 引文匹配修复、Windows junction CLI 回归。最终相关单测 6 文件/97 通过。详见 `reports/context-compression/TF0074-ACCEPTANCE-2026-09-13.md`。 |
| TF-0134 | 按用户明确确认的 M4 范围完成独立核查：新增零调用运行时模块为 0，39 项功能测试通过；不声称全仓死代码已清零。详见 `context-moat/reviews/TF-0134-M4-closeout-20260913.md`。 |
| TF-0135 | 完成 2026Q3 官方竞品资料复核。机制可复制风险继续存在，未证明 12–18 个月优势；下季度仍需复核。详见 `context-moat/reviews/TF-0135-2026Q3-competitive-review.md`。 |

## 继续开发或外部依赖

| 节点 | 当前剩余条件 |
|---|---|
| TF-0029 | 基线、资源、堆测量与完整测试链已恢复，冻结候选 7773 passed / 54 skipped / exit 0。测试类型观察项另发现压缩协议测试的 4 处声明缺失，待补齐；原 RC 120-warning 条款及正式独立 Executor/Verifier 验收尚未关闭。 |
| TF-0007 | TF-0009 的真人 DCS/SEKB/Browser canary、rollback 和 owner verdict 尚缺。模型评估不能替代真人 canary。 |
| TF-0010 | 最终独立工程验收与用户最终真人 accepted verdict 尚缺；历史 STATUS 的旧 SHA 记录没有被本批重新签发。 |
| TF-0028 | 与 Runtime 收敛总任务相同，RC-10 真人场景及 accepted verdict 尚缺。 |
| TF-0056 | 最终 TF-0069 paired provider canary、operator rollback、soak、平台握手与 reviewer 裁决尚缺。 |
| TF-0102 | TF-0140 的 default-on 签核和 14 天真人记录属于父任务条件；用户本批明确跳过，父任务不能完整关闭。 |
| TF-0140 | 跳过；不改变该节点、默认旗标或真人记录。 |

## Harness 与性能修复

- 场景规格按其注册文件身份识别；任务即使伪造场景元数据也不能绕过路径归属。
- Git 路径按 NUL 分隔读取，保留中文和文件名前导空格；Git 比较失败不变成空 diff。
- 未传 `--since` 的任务也检查实际 diff；只有显式 `--no-diff` 做结构检查。
- Agent Dev 的共享诊断使用场景基线，实际任务仍在隔离候选中验证自己的 diff。
- 全量类型检查使用与 runtime 一致的固定原生编译器版本，Node/Web/Test 覆盖保留；
  原 TypeScript 5.9 三项目对照均为 0 错误，故意的类型错误也被原生编译器以 TS2322 拒绝。
- Agent Dev 单测合并为一次 Vitest 启动，六个 Node 文件与一个 jsdom facade 文件保持环境隔离，87 项完整覆盖未缩减。

最新完整 Agent Dev 诊断：所有命令退出码 0、无 hard limit、无遗漏 full gate。
typecheck 17.855 秒、unit 17.057 秒、build 42.400 秒、Electron Agent Dev 17.769 秒。
保留过往超过预算的测量，不提高 45 秒 build / typecheck 和 21 秒 unit 上限。

最终 `harness:ci`：退出码 0；44 个 Harness 单测通过，catalog 校验通过；
Agent Dev audit 为 A / 94，disqualifiers 为空。它只代表 Agent Dev 门禁，不能代表联合系统 GA。

全库 lint 的已执行读数：退出码 0、0 errors、372 warnings；随后去除了一条已修改回调的
无用依赖警告，未把其余警告宣称为已清零。原 RC 文本的 120-warning 上限仍需处理。

## 隔离候选与证据存放

所有任务规格均在干净候选按 `--since <实际父提交>` 校验，未使用 `--no-diff`：
TF-0029、TF-0025、TF-0074 及后续补丁已完成 8 次归属校验，含 Agent Dev 与基线修复规格。

当前隔离候选：`D:/ClawX-candidates/active-20260913-audit`，最终代码提交
见证据目录中的 `scoped-candidates.json` 最后一项。
候选使用独立的 root/runtime 锁定依赖；最初的依赖 junction 仅用于只读归属检查，
pnpm 提示其属于其他工作树后，已只删除 junction 并独立安装，没有清除主工作树依赖。

原始日志、原文件备份、24 张 Workspace 截图、30 条 live 报告、输入身份与哈希、
候选列表和校验结果统一保存于主仓库外：

`C:/Users/27933/AppData/Local/ClawX-scratch/task-forest-active-closeout-20260913/`

重要索引：`initial-state.json`、`scoped-candidates.json`、`scoped-validation.json`、
`compression-input-inventory.json`、`live-final-source-hashes.json`、`eol-normalization.json`。
这批日志不依赖已丢失的旧 worktree。原始 transcript 和凭据未写入仓库；live 产物的凭据模式扫描为 0 命中。

本记录只反映实际执行结果；独立正式验收、真人验收、default-on 和产品批准分别判断。

## 2026-09-14 补充

- Task Ledger / ClawGraph 深链已补 Electron 覆盖；Task Ledger 记录测试保留全部工具/文件/审批证据断言，改为识别目标回合，避免把后续历史补记误当作目标记录。完整 16/16 E2E 通过。
- VerseShell 从锁定提交与补丁栈在两个独立 source/target root 重建，字节相同，SHA-256 `ac6a7a15dac0a9dc7d15ec975fc65276f25c871bbc0174197731947df6460786`；package 验证通过，跟踪的 manifest 未改。
- 基线原引用 `56cc8550...` 不是本分支祖先；使用既有 `rc01r-green-baseline.md` 指定且经 Git 验证为祖先的 `73bdddbb...` 重建。修改仅为 acceptedBaseSha 与由该提交派生的 generatedAt。

## 冻结候选完整绿线与下一节点（2026-09-14）

候选 `8e7c3c0e1e1d06c894e23ee710532ffdac25e076` 的完整 `pnpm test` 链退出码 0：主段 7309 passed / 53 skipped，隔离段 25 passed，DCS 链 439 passed / 1 skipped，合计 **7773 passed / 54 skipped**。50-cycle 使用显式 GC 的保留堆测量，增量 **0.607 MiB**，活动记录 0；缺 GC 的阴性对照明确失败。原 2 MiB 上限和 50 次循环均保留。

这条完整测试链不包含随后开发的 UI 收尾，其验证单列如下。用户已明确授权独立只读子 Agent；正式验收仍须修完后述阻断并按最终输入复跑。

## TF-0026 完成与 TF-0027 接力（2026-09-14）

- Library / Review Queue 只保留两个主入口；Inbox、Draft、Proposal 使用现有 DTO 的统一投影。Maintenance 与 Source tools 保留原有高级路径。
- 预览、编辑、新建明确区分，960px 不同时显示两块编辑面板。截图发现并补红门复现 4px 容器溢出，修复为跟随主布局的 v2/legacy 留白及可用高度；没有放宽溢出门槛。
- Chat 知识问答沿用引用、草稿、错误经验候选、steward review 与 v1 本地检查点。路由往返保留未完成正文、搜索结果和来源；保存失败不清空草稿。没有新增知识后端或自动 apply。
- 提案与草稿必须对应，切换条目清除前一条提案；迟到的 steward 结果只展示给其原草稿。无提案的草稿先显式准备提案，再批准并应用。
- 三个知识库单测文件 **14 passed**；启动 UI 单测 **6 passed**。i18n、ESLint（0 errors，15 个既有 warnings）、完整 node/web 类型、最终 web 类型、Vite/Electron 构建、通信 replay/compare 通过。
- 知识库首轮 Electron **28 passed**。加入容器和旧版几何检查后的扩展 40 项运行得到 37 passed / 3 failed：两项是新测试把 bootstrap query 写进 hash，已修正并 **3/3** 复跑通过；一项是全局展示页仍用缩放前的 badge 圆角上限，由 TF-0027 承接。最终知识库 **28 项均有通过证据**（25 项扩展运行 + 3 项几何复跑）；不把扩展运行记作全绿。
- 隔离候选依次为 `5b4549d894262ec0ccff4db0e4daf9b0594737aa`、`c2b207e076dc1d34602eaf45fa304b02b4170211`，实际 diff 的 Harness validate/dry-run 均通过。主分支与 index 未提交。
- 全量类型脚本的测试观察项有上轮 `context-compression-provider.test.ts` 的 4 条 TS7016；属于 TF-0029 待修事项，不误报为测试类型全绿。

## UI 最终收尾与独立复核（2026-09-14）

最终 UI 候选为 `981c9026f4648ce9caec15c5d7e651c0b6e67563`；其前序为 `830b18c6615acbc6374eee38d9eb8a9ebb45253f`。差分来源和完整文件清单见 scratch 中的 `scoped-candidates.json`。

- 保留旧 KE 的确认、拒绝、空态与开关门控四项断言，将它们接入新队列导航；与新增三项共 7/7。知识库相关 Electron 总计 32 项。独立发现 Prepare 回包跨草稿显示的问题后，改为原子选择与按发起草稿处理回包，独立同一反例红→绿，完整 Knowledge 15/15 独立通过。
- 次级页面用准确的 1.25x 圆角验收值，收紧过大标题，去掉 Provider 蓝色按钮与重复主操作，修复 Observability 指标容器 49px 裁切。12 个设置分区与诊断页在 1280/960、Light/Dark 下留存截图和几何证据。
- UI-only Legacy 条件与上下文已删除；旧 query 继续兼容到当前 UI，Browser/Review 旧入口进入工作区。未移除数据格式兼容或任何后端能力。
- 初次扩展 Electron 为 72 passed / 6 failed：两项进程/内存错误，三项旧控件/弹层焦点/瞬态URL断言，另一项揭示安装完成回调会在 Skip 后把未验证 Provider 推到 Model。修复来源绑定、计时器清理、组件卸载检查，保留真实 401/断连/成功网络断言并补当前 Workspace 明确确认流程。随后 **20 文件 / 78 passed / 0 skipped / exit 0**，没有提高阈值或去掉场景。
- 独立复核再发现既有 Provider/Model 请求乱序可恢复错误就绪状态；现在更改选择或退出组件会使旧操作失效，在继续创建账号、设置默认账号或持久化验证前检查。已发出的 Host 请求沿用服务本身的契约，不声称能撤回。新增 9 项组件测试加 22 项纯逻辑测试 **31/31**，独立原三个反例与扩展九项均通过；最终 Setup 真实HTTP与双主题几何 **4/4** 复验通过。
- Web 类型、scoped ESLint、i18n/BOM、构建、comms、完整任务差分 Harness、harness:ci 均通过；harness:ci 为 44 tests，Agent Dev audit A/94，无 disqualifier。它不代表联合系统 GA。

TF-0029 的独立结论仍为 NO-GO：需满足 ≤120 warnings，修复验收器多段计数、必需测试的固定计数/skip声明、原spec与commandLine绑定、隔离执行目录，以及 ignored输入的SHA/字节锁定。原 RC prerequisite 已找回 `c860c12f4ab88bca9bd46742facbc97e98bb9d60`（基底 `3b08a466...`，38条路径含spec）；本批必须以 `5dabc7ca...` 为集成比较基线，不能混作新的产品 acceptedBase，后者仍为 `73bdddbb...`。独立记录在 `independent-verifier-20260914/`。

## TF-0029 工程收尾（2026-09-14）

独立审核会话未派出。本段只记录本机工程收尾，不是正式双角色验收。

- lint：`eslint .` 0 errors / 119 warnings（上限 120）。测试 `no-explicit-any` 为 0。
- 验收器 V-03～V-07 已落地，`tests/unit/agent-engineering-acceptance.test.ts` 32/32。
- 历史 prerequisite 核验脚本 `scripts/rc01r-prerequisite-provenance.mjs`：`c860c12f` / `3b08a466` / 38 路径 / spec blob `4bfc17d7` 通过；比较基线 `5dabc7ca` 与 acceptedBase `73bdddbb` 保持分离。skip 预算仍为 53。
- `rc01-baseline-validate` PASS；`tsgo:core` exit 0；`tsgo -p tsconfig.test.json` exit 0；集成 spec `--since 5dabc7ca` validate exit 0。
- 未跑：干净候选完整 `pnpm test`、独立 Executor/Verifier 终报、冷树 embedded-runner（V-08 环境 pass）。节点保持 in_progress，不得标 done。

## TF-0029 验收器补强与环境暂跳过（2026-09-14 接力）

按用户“优先接近 Done，常规选择直接执行，环境或真实数据暂时跳过”的要求，读取最新任务图后仅继续 TF-0029。当前没有 `review_needed`，TF-0021 / TF-0027 已完成；没有重复开发这些 UI 节点。

本轮修复了验收器仍可漏检的部分：

- 删除 `fast-unit-tests` 后重算两个 digest，原校验器仍返回通过；现在从候选规格和真实 comparison diff 重建完整有序 gate 清单，核对命令、timeout、skip 预算、coverage、profiles、安全声明和输入身份。`harness/src/profiles.mjs` 加入绑定输入；仅传显式 changed paths 的计划只用于诊断。另以先失败的反例锁定规格中的 `diffBase`，禁止改选空差分来缩减 gate。
- 保留所有基线 gates 的测试夹具替代了手写单 gate 的“完整验收”夹具。选定 Node gate 在两个临时 worktree 中真实执行，其他环境步骤有明确模拟；这只是协议单测。旧 RC-00 bootstrap 改为拒绝删减清单的阴性回归，不再生成虚假的工程通过。
- 原计数器漏掉没有 passed 的失败/跳过段，也不能读取 Playwright / Node spec / TAP 摘要；现完整累计结果，todo / 未运行计入 skip，取消 / 中断计入失败，矛盾总数拒绝。带引号、`=value` 或紧邻 shell 操作符的禁止参数也会被拒绝。
- `lint:check` 显式加入既有 `--max-warnings 120` 上限。三语 README、验收文档、Harness 规则与规格同步；同批已有的 `rc01r-prerequisite-provenance.d.mts` 补入精确路径归属。

已执行证据：

- 删除 gate 的首个反例先失败；计数与参数的 10 项反例修复前全部失败。最终验收器及 provenance 单测 **2 文件 / 44 passed / 0 skipped / exit 0**。最后一轮是完整执行，早期失败和定向复跑日志均保留。
- 完整 `lint:check` **exit 0，0 errors / 119 warnings**；最终 scoped ESLint 0 errors / 0 warnings。未缓存 Node/Web 类型检查、独立测试类型检查与 Runtime `tsgo:core` 均 exit 0；测试类型观察项也是 0 errors。
- 历史 prerequisite CLI 与 RC-01 baseline CLI 通过：38 条历史路径、41 writers、16 modules；prerequisite、comparison base 和 acceptedBase 三种身份保持分离，skip 预算仍为 **53**。
- Agent Dev fast 通过，包含 **87** 项 Agent Dev 单测。完整 deep-test 的类型、contract、i18n、Workbench、Harness、87 项单测、comms replay/compare 和 Vite/Electron 构建通过。构建 **41.696 秒 < 45 秒**，单测 **17.952 秒 < 21 秒**，未提高预算。
- 本任务以 `5dabc7ca...` 为基线的 diff-aware Harness validate / dry-run 通过。`harness:ci` 已运行，Harness **44** 项单测和 catalogs 通过；最初的证据过期项已通过真实执行清除，最终严格 audit 仍为 **B / 86、NO-GO**，唯一 veto 为 deep-test 的 Electron 环境门阻断。

按用户要求暂跳过的环境与外部条件：

- 多出的第 54 个 skip 已定位为 `openclaw_runtime/src/memory/root-memory-files.test.ts` 的文件符号链接拒绝用例；本机复跑 **14 passed / 1 skipped**。保留符号链接能力探针和原 53 预算，未把 skip 记作通过。
- Electron 的 4 项 Agent Dev 用例均在交互前被 Runtime 构建新鲜度检查挡住：`server-startup-post-attach.defer.test.ts` 比 `openclaw_runtime/dist/entry.js` 新。deep-test 保留 **blocked**，未修改检查器、伪造构建时间戳或将环境问题写成绿色证据。
- 冷树 embedded-runner 的 V-08 八项、干净候选完整根测试链、正式独立 Executor/Verifier 与真实 Provider / 真人记录不计通过。本轮没有独立 Verifier，不重签历史报告。

TF-0029 保留 `in_progress`；TF-0140 和其他节点的状态、默认值及产品锁保持原状。后续先准备具备文件符号链接能力及新鲜 Runtime 构建的验证环境，再冻结候选并重跑完整声明清单。

本轮原文件备份、阴性/阳性日志、类型与 lint 输出、Agent Dev 报告、任务图前后快照和源码摘要存于 `C:/Users/27933/AppData/Local/ClawX-scratch/tf0029-validator-relay-20260914/`。所有结论仅对应本轮工作树增量，不是主分支全部未提交修改的最终验收。

## TF-0029 接力：报告计数必须重放持久化日志（2026-09-14）

用户继续要求优先收尾、按推荐方案直接推进，环境和真实数据暂跳过。Task Forest 当前没有 `review_needed`；本轮仅处理 TF-0029 的可本地复现缺陷。

- **复现**：把日志改为 `Tests 1 passed | 1 skipped (2)`，报告仍声称 1 passed / 0 skipped，并重新计算日志、gate contract 和 report 的全部摘要后，原 `validateExecutorEvidence` 返回空错误列表。反例先红；不是靠遗留旧哈希触发拒绝。
- **修复**：公共 `verifyLogs` 在验证字节摘要后，重新解析保存的 stdout/stderr，并与报告计数比较。跳过、仅 stderr 中失败、完全缺失摘要三种反例均被拒绝；Verifier 在执行任何 gate 前退出。最终 convergence 报告也复用同一校验入口。
- **验证**：验收器和 provenance 两文件 **45 passed / 0 skipped**；未缓存 Node/Web 类型检查与独立 `typecheck:test` 通过。修复前/后的单反例运行因 `-t` 过滤产生的 42 skipped 仅用于定位，不作为完整门禁结果。
- **Lint**：完整 `pnpm run lint:check` exit 0；ESLint **0 errors / 119 warnings**，保持 120 上限，DCS 和 artifact completionClass 检查通过。
- **Harness**：固定 comparison base `5dabc7ca...` 的真实差分 validate / dry-run 通过。`harness:ci` 的 44 项回归与 catalogs 通过；最终 audit 仍为 **B / 86、NO-GO**，唯一 veto 是已有 deep-test 的 Electron Runtime 构建过期记录。本轮没有重跑或改写这项环境证据。
- **基线**：prerequisite `c860c12f...` / `3b08a466...`、comparison base `5dabc7ca...`、acceptedBase `73bdddbb...` 的 CLI 核验通过；skip 预算仍为 **53**。
- **文档**：两份任务规格、公共规则与 `docs/dev/agent-engineering-acceptance.md` 已加入日志与报告的语义核对要求。已复查三份 README；本轮没有改变命令用法或产品流程，因此无需追加 README 修改。
- **差分范围**：原有未提交内容及 HEAD 保留，补丁相对于会话开始备份单独保存为 `authored.diff`。普通全树 `git diff --check` 受既有 CRLF 行尾影响；本轮相关文件按 `cr-at-eol` 识别 Windows 行尾的检查通过，未批量改写文件行尾。

TF-0029 保持 `in_progress`，没有正式独立 Verifier；完整干净候选验收、文件符号链接环境、冷树 V-08、Electron 与所有真实 Provider / 真人条件继续暂跳过，不记为通过。TF-0140 与其他节点不变。本轮日志、备份和源码指纹：`C:/Users/27933/AppData/Local/ClawX-scratch/tf0029-report-evidence-20260914/`。

## TF-0029 完整收尾尝试与本地提交（2026-09-14）

用户要求尝试完整收尾并提交。候选沿用已拆分保存 UI、Knowledge、Workspace 成果的 `981c9026f4648ce9caec15c5d7e651c0b6e67563`，提交分支为 `codex/tf0029-closeout-20260914`，工作树为 `D:/ClawX-candidates/active-20260913-audit`。原主工作树和既有分支没有 reset、stash、clean 或切换；本次修复也同步回原工作树。

**结论：保存工程修复，TF-0029 转为 `blocked`，不标 Done。** 本机文件符号链接真实探针返回 `EPERM`；完整根测试的实际 skips 为 54，超过固定预算 53。没有改预算、替换真实用例、设置虚假的工程通过或执行产品毕业。

本次补齐的代码与验证：

- 修复类型清理中误删图片插件 `default` 访问的问题，并为实际默认导出补齐声明；UAS-05 的旧断言对齐用户已确定的 TF-0028 `blocked` 状态，其余发布顺序与产品锁断言保留。两处先红，修复后 6/6 通过。
- 测试类型沿用 Runtime 的源码映射方式补齐五个内部包，避免依赖本地 `dist` 声明；没有新增 `any` 兜底或扩大生产源码排除。Node/Web、独立 Test、Runtime `tsgo:core` 均有通过记录。
- 测试命令识别区分 lint/diff 的文件参数与真正执行，支持包管理器的目录/filter/workspace 选项及 Node 直接启动 `vitest.mjs`。新反例先失败，固定 skip 预算保持。
- 普通测试报告重放持久化日志；TF-0009 根据候选声明的 adapter kind 验证唯一受控 JSON、摘要关联、30 条有效 runs 和计数。有效适配器通过，缺失 artifact、重签失败报告和普通报告伪造 adapter 来源均拒绝。
- CI 根测试 job 改为完整 Git 历史 checkout；已核实历史 prerequisite 是当前祖先，保留真实 provenance 单测与 CLI，没有用 mock 替代或重签基线。
- Runtime 重建与 Gateway ready 通过。补齐相同版本、SHA-256 相同的 Electron 40.8.4 安装产物后，完整 Agent Dev 和 4 项 Electron 用例通过。原 V-08 的 8 项在候选工作树重新执行全部通过，约 40 秒；这不是正式独立冷树验收的替代品。

证据分层，不能跨版本改签：

| 范围 | 实际结果 |
| --- | --- |
| 首次完整根链 | 第一阶段 2 failed / 7339 passed / 53 skipped；保留原失败日志 |
| 修复图片插件与旧状态断言后 | 六段合计 7805 passed / 54 skipped / exit 0 |
| R3 代码的完整根链 | 六段合计 **7819 passed / 0 failed / 54 skipped / exit 0** |
| 最后补 Node 直接 Vitest 入口后的增量 | 验收器与 provenance 两文件 **61/61**；没有把新增两用例虚加到上一行整仓结果 |
| 质量门 | 完整 lint 0 errors / 114 warnings，保留 120 上限；最终改动另做零警告 scoped lint 与 Test 类型检查 |
| 最终 Agent Dev / Harness | full build/unit/typecheck/E2E 模式通过，87 项单测、4 项 Electron 用例；Harness CI 44 项、catalogs、严格审计 **A / 94、无 veto** |
| 代码复核 | R2 四项、R3 一项发现均复现并修复；最终 R4 helper exit 0，`findings=[]`、`patch is correct` |

第一次 autoreview 因绝对路径格式被 helper 拒收，不算通过；R2/R3/R4 使用同一 Codex 引擎，R4 只复核最后两文件增量。审核代码快照链为 `c973ea19195e3d6c46e9e17ed699439cb206bff6` → `481ced48f1bf72b56f2344f8e35be99e80632eb0` → `f7371a451a9492a32e550005f0621e24b66a10ba`，176 个代码输入的摘要保存于 `review-code-r4.json`。源码、全部失败与成功日志、复核 JSON、提交前后检查与计划存于 `C:/Users/27933/AppData/Local/ClawX-scratch/tf0029-full-closeout-20260914/`。

剩余工作是在具备文件符号链接能力的 Windows 环境冻结已提交候选，满足 53 的预算，并让正式独立 Executor/Verifier 在两个 detached worktree 运行完整 manifest。当前检查没有覆盖这套完整正式流程；Agent Dev 通过、代码审查通过和本地测试 exit 0 均不替代它。三个基线身份、TF-0140、其他节点和所有产品锁保持原状。本轮提交只在本地保存，没有推送。

## TF-0029 有界工程收口成立（2026-09-21）

按 `docs/dev/engineering-product-node-plan-20260921.md` §4 的有界合同，在 `D:/ClawX-acceptance/tf0029-20260920/` 于同一天完成 run15～run19 共五轮正式跑，最终 run19 由 Executor 与独立 Verifier 双 pass：

| 项 | 实际值 |
| --- | --- |
| 候选 | `tf0029-candidate-fixed@156e878d3efc6d05850ee66ea63d67534672b7ad`，tree `45c49139ac5b7157a45f631f8a5170d6d42833cc`，diffBase `5dabc7ca5`，cleanAtPlan=true |
| 门禁 | 25 门（e2e/release 两个 profile 经 `deferredProfiles` 移交 TF-0041） |
| Executor | `tf0029-executor-20260921`，25/25 pass，9398 passed / 0 failed / 50 skipped，reportDigest `9f57e5355a8f826f85f6022c4cb81d9bd428732a2b202571912058fbb44c6684` |
| Verifier | `tf0029-independent-verifier-20260921`，第二 detached worktree 完整重跑 25/25 pass，reportDigest `801576fdc68519f06431fe06cc880de65e4f4b6cdd755f2daa7c550d8173432a`，`consistency.errors=[]`，`identicalGateContracts=true` |
| 结论 | `engineeringAcceptedByAgent=true`，`allowedPromotion=false`，gateContractDigest `296d0ddaa7f8b562c0d62493ed8ff2592ab714087c3c38a7a46a00375693a791` |

上一节"满足 53 的预算"的剩余工作以**身份解释**而非补数字收口：用 vitest JSON reporter 在候选（`23f4a0c3b`）与 diffBase（`5dabc7ca5`）各枚举出相同的 50 条 skip；53 是 2026-09-11 在缺少文件符号链接权限的进程上读到的，多出的 3 条即 `tests/unit/skills-symlink-cleanup.test.ts` 的 `fileSymlinkIt` 用例，本机它们实际执行并通过。预算改为 `ROOT_UNIT_SKIP_INVENTORY` 求和（49 个 `DEEPSEEK_API_KEY` 门控 + 1 个 `AGENCY_AGENTS_REPO` 门控），历史 53 保留为 provenance 记录并由测试钉住 `53 = 50 + 3`。

五轮之间清掉的真缺陷：`typecheck:test` 的 `.d.mts` 漏声明（`deferredProfiles`、新导出）；Agent Dev 四类证据 24h 新鲜度过期（候选上重生成，audit A/94）。两次不可复现的环境抖动（shrinkwrap 守卫经代理访问 registry 失败、`smoke-openclaw-runtime` 退出码 0xC0000409）直接复现均通过，未改门、未改超时。

未纳入本结论：TF-0041 拥有的全量 UI e2e 与发行封存、60 个既有测试类型债与 8 个 codex 扩展类型错误；产品锁、TF-0140、真人验收全部保持原状。
