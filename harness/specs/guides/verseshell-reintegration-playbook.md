---
id: verseshell-reintegration-playbook
title: VerseShell 回收执行手册：保留实现、逐项接线、证据裁决
type: ai-coding-guide
appliesTo:
  - verseshell-upstream-reintegration
---

本手册是本次回收的执行规划。硬规则见 ../rules/verseshell-upstream-preservation.md，活动任务见 ../tasks/verseshell-upstream-reintegration.md。源码、需求和研究依据分别冻结在 ../fixtures/verseshell-reintegration/source-lock.json、acceptance-contract.json、research-sources.json。探索性 docs 方案继续保留作定位记录，不构成第二套验收权威。

**一、交付目标与优先级**

交付一个可以证明来源、能力完整且经过宿主调用验证的 VerseShell 模块升级。上游核心保持原实现，ClawX 在已有边界适配它。主链保持：固定上游源码与残余补丁 → 可重建 ae → Typed ACI → 宿主执行/读取/写入/诊断工具。

优先保护现有执行、安全、进程回收、写入恢复和完整观察，再接批读和诊断改善，最后测小规模效率变化。不得为了 file.read_many、较少 token 或较小 diff 牺牲取消、owner、artifact、journal 或审批。63 个核心/Cargo 输入、90 个回归输入和 .gitattributes 共 154 个文件已冻结；当前只有 src/cache.rs 的已知启动补丁允许改变有效源码。

完整性分三层：所有 32 项真实 operation 保留原实现；18 类跨切面行为保持或正确升级；需要由模型使用的能力有真实宿主入口。内部生命周期、事务与元数据不需要全部公开成模型工具，但必须说明 owner、调用路径及验收。147 个 removed-module stub 不计为交付能力，本轮不顺手删除。

**二、把 LLM 风险转成可检查的失效模式**

这里不假定所有模型都有同一种行为；按本次任务最需要防范的失误设计约束。

| 失效模式 | 必须留下的检查 | 不能用来替代的材料 |
|---|---|---|
| 看过源码后重写一份类似实现 | 154 文件来源比对；未声明的新 core/build 文件拒绝 | 相似度、接口同名、模型承诺 |
| 只搬一个亮眼功能，丢掉旧能力 | 固定 32 操作 + 18 行为清单；缺一项不能整体完成 | 总完成率、测试总条数 |
| 包里有上游代码，宿主实际走自写执行器 | 真实 host → verified ae 的 request/op 证据与 binary knockout | 仅检查 exe 存在或 mock client |
| 解码过不了便放宽 schema/丢字段 | 明确 wire/host/model 三份字段映射与负例 | 任意 JSON、catch 后返回空成功 |
| 改 tests/golden/skip 来让结果变绿 | 上游测试冻结；控制检出提供断言和期望值；前后 hash | 实现者同步修改的 passes 字段 |
| 用局部 unit、curl 或 dry-run 宣称端到端 | 实际工具调用、Electron 场景和磁盘效果；独立分层结论 | Harness 配置存在、打印 SUCCESS |
| 大改后引用旧产物 | code/test/fixture/control/source/binary 版本绑定，变动后失效 | 旧报告、相同 crate 1.0.0 字符串 |
| 省 token 时丢正文、诊断或恢复线索 | B/C 信息保真对照、截断 artifact 回查、对抗日志 | 仅成功率和 payload 大小 |
| 为比较版本双跑写入或 process.start | A/B/C 用独立 disposable fixture；副作用只各执行一次 | 生产 shadow 双跑 |
| 上下文丢失后另起一套方案 | 每次读取同一 spec/lock/差异与本地 checkpoint 记录 | 只依赖聊天总结 |

源码保真检查已经可执行；真实宿主接线、差分和最终裁决仍是后续实施工作。不要把此表的要求写成已经全部实现。

**三、网上经验如何用于本项目**

研究均来自原作者或官方项目，检索/读取日期为 2026-10-14。完整来源标题、URL、内容指纹及采用理由见 research-sources.json。以下是针对本仓结构作出的工程应用，不把外部案例的收益数字移植为本项目结论。

| 来源 | 采用的经验 | 本项目的具体落点 |
|---|---|---|
| S1 Google Small CLs | 每批一个可理解闭环；重构单独审查，API 与使用方一起提供 | 用 R0–R6 检查点；批读 API 与宿主调用及测试同批 |
| S2 Software Engineering at Google / Large-Scale Changes | 范围明确、可重复执行、可回滚的迁移 | 固定有效源码，复用 Git/bundle/Harness；不建通用迁移平台 |
| S3 Martin Fowler Branch By Abstraction | 沿稳定边界渐进改变供给实现 | 当前已有 Typed ACI/facade，直接复用，不新增一套执行抽象 |
| S4 Anthropic long-running harness | 需求清单、逐项推进和端到端检查应对提前完成 | 清单预注册；回执计算状态；每会话一个检查点 |
| S5 SLSA provenance | 产物可追溯到来源和生产过程 | commit + patches + build recipe + binary + host candidate 绑定 |
| S6 Reproducible Builds | 同一组确定输入应得到字节一致的指定输出 | 继续两套独立 release 构建；不是拷贝 exe |
| S7 Git merge-tree | 在不改工作树/index 的情况下预检三方合并 | 继续隔离预检；无文本冲突仍检查语义 |
| S8 GitHub Scientist | 比较 control/candidate 的结果和异常，谨慎处理写数据路径 | 借鉴对照方法；不引入 Ruby 库；所有副作用用隔离 fixture |

没有采用大规模统计研究、全项目重写、新增通用代理框架、第二配置中心或第二写入日志。

**四、冻结输入与允许修改的边界**

目标上游：c06f406e83566bb968448222d9c8caf429e580a0。旧有效基线：c3983694407a9ddb23505e05fad4a9eae653b283 + 原四个 source-inputs 补丁。当前产品 manifest 仍指向旧基线，规划锁不会激活新版本。

保留目标上游 src、Cargo 和测试的原始内容。源码检查只统一 CRLF/LF，不忽略缩进、注释或任何其他字节；不得把“看起来等价”的重写作为允许例外。新增 build.rs、.cargo 配置或另一份 core 源文件也被检查，避免冻结文件旁边出现第二套实现。

宿主可改范围是已有 shared/verseshell 契约、process manager/normalizer、readonly facade、governed exec/process、patch preview、result-query、工具注册以及 bundle/verifier/兼容 MCP 接线。各批次先列出具体文件与函数；不能把整个 openclaw_runtime/** 当成无限许可。

冻结默认值、产品开关、审批、journal 和资源 owner 不在常规回收可改范围。新增 status/schema/stream 适配保留严格边界：仅接纳已定义形状；计数只有语义已确定才能推导，未知不能补零；短 hash 不能取代完整写入身份；失败指导不会自动执行，也不会获得额外权限。

当确实需要额外源码/测试补丁，先生成独立 exception：原文件/hash、可复现缺陷、原实现为何不能直接用、最小补丁、前后测试、行为影响、owner 及恢复方式。另行审查并重新冻结控制契约，再评估候选。 routine 例外由 agent 完成，不因需要审查就等待所有者；范围/架构/冻结默认值改变才升级决策。不得在候选被判失败后直接重写期望值。

**五、差分验收要比较什么**

A 是旧有效基线；B 是新上游加明确残余补丁、直接调用 ae；C 是同一 B 二进制经 ClawX 实际工具调用。

A/B 用来识别保留行为和预期升级；B/C 用来证明宿主没有重实现或丢失能力。新增 file.read_many 在 A 中不存在，直接要求 B/C 对照通过，不伪造 A 的实现。A 已有缺陷单独登记；目标 B/C 仍须满足规范，不能照抄旧错误，也不能把所有差异都标成历史问题。

比较维度：成功与错误分类、实际磁盘/进程效果、正文和关键诊断、分页及预算、artifact 原文与身份、owner、审批次数、资源收尾。显示文本可按明确规则去掉行包装；错误和内容不因 JSON 外观变化就忽略。

只允许单独列明的非确定字段映射，例如 fixture 根路径、对应 request ID、运行时间。owner/runtime/process 身份需要验证对应关系，不能整组删除；token 和 elapsed 的测量可以另行报告，但不能通过忽略它们支持性能结论。禁止通配的 ignored_paths、整段 stderr 忽略、空白无差别压缩及候选生成 golden。

只读并且确定性的场景可以对照。写入、删除/恢复、process.start、外部命令和网络 effects 使用 A/B/C 独立副本，不能对用户工作区或同一外部目标双跑。计划的 fixture 应包含真实错误、截断、缺失文件、stale hash、错误 owner、跨重启和 Windows shim，而不仅是 hello world。

**六、串行实施检查点**

| 检查点 | 具体工作 | 产物与退出条件 |
|---|---|---|
| R0 准备与封存 | 复核两边 HEAD/diff；固定控制 checkout、来源锁、32/18 清单；运行来源检查正/反例 | 输入指纹、唯一控制版本、只读预检回执；规划已经准备，正式控制 commit 在实施起点固定 |
| R1 源码与模块 | 最新上游 + 启动补丁；按实际路径退休重复补丁；更新重建清单，不激活宿主新版本 | Rust no-run/完整测试；32 目录；短 uptime、Windows lifecycle 等原回归；来源检查仍通过 |
| R2 主机契约 | 精确接 status/blocked/substitutions、maxItems/maximum、精简流与 32/digest；更新 verifier | 真实新 ae 握手；新旧明确契约样本；错误身份/格式拒绝；不丢 frame 伪装超时 |
| R3 能力接线 | 批读 → 稳定只读工具；诊断/recourse → model payload；artifact/状态/env 对齐 | 所有需要宿主消费的能力有调用证据；内部能力有 core 验收；32/18 无遗漏 |
| R4 行为对照 | A/B/C 隔离 fixture 差分；信息完整性和副作用结果验证 | 差异逐条解释，不能仅比较 ok；精简观察不能损失正文/恢复信息 |
| R5 干预反例 | 隔离环境撤掉/替换二进制、错误 digest/owner/policy、stale hash、取消/EOF/限制/TTL | 该失败确实失败，effects 不发生；没有 native fallback 或重放；资源能回收 |
| R6 产品与收口 | 两次独立 release、真实包内容、typecheck/comms/Electron、README/source claims、回滚演练 | 最终版本全部回执读盘且可重放，三语言文档一致；同一变更集审查；Task Forest 依证据收口 |

R1–R3 可放在一个隔离集成分支的连续提交中，最终用一份集成 PR 审查。不可合入一种“只换 binary/只换 manifest，宿主契约稍后修”的不可运行中间态。每批拆分以能理解和验证的行为为准，不能为追求少行数把 API 与调用方拆开。

每次会话只推进一个检查点或其中一个可验收闭环。上下文不足时记录本地 checkpoint 的输入 hash、已改路径、已执行命令/退出码、产物、未决项和下一动作。新会话从冻结 spec 与当前 diff 恢复，不重新设计核心。Task Forest/交接留本地；新的运行时 source/spec 和轻量最终证据进入对应变更集。

**七、真正证明宿主调用的干预**

在 disposable fixture 中运行正常 host call，保存 requestId、operation、binary hash、source identity、host revision 和输入/输出指纹。随后只在 fixture 的运行配置中令 ae 不可用，原调用必须明确失败；若仍返回正常业务结果，说明存在替代执行、缓存污染或伪证据，停止该检查点并修复。

对 fake binary、错误目录 digest 和错误 owner/policy/workspace 做同类干预。stale hash 必须检查磁盘未变化；拒绝的 exec 必须没有对应进程/effect；取消后检查该 fixture 的进程树与 host resource 登记，不以全机进程数量代替归属检查。不能移动或删除用户现有二进制、任务或进程。

对输出完整性使用已知正文、长日志、expected/found 诊断和受控截断。验证模型实际得到的 tool payload，并使用返回 artifact 恢复原文。fixture 中丢失 artifact 应得到 missing/expired/corrupt 分类，不能得到空成功。

**八、验收状态与证据权威**

acceptance-contract.json 是固定需求，不是进度编辑表。实施产物另存运行报告；通过状态由受信执行过程读取真实回执计算。缺失、不可读取、跳过、环境不可用或身份不一致的项为 NOT_RUN/UNKNOWN/FAIL，不得当 PASS；不以 31/32 或整体分数覆盖关键失败。

每份回执至少绑定：control commit/hash、host candidate、上游 commit、残余补丁/source identity、binary hash、测试定义 hash、fixture hash、toolchain/相关环境、命令、退出码、时间和产物路径/摘要。来源检查的 effective source 必须就是受信构建实际使用的目录，不能检查一棵干净替身、再从另一棵目录构建。构建 runner 自己选定输入根并绑定最终包内 binary。执行前后核对被测输入；任何源码、测试、fixture 或适配器改变，都使对应证据失效。原始日志可以本地保留，入库只保留脱敏的小型 curated receipts 和可复现 driver。

最终完成 = G0..G6 全部满足 + 32 项操作完整 + 18 类行为完整 + 所有宿主需求真实接线 + 最终源码/包/回执一致。sourcePreserved=true 只证明源码层检查通过。当前 checker 总是输出 migrationComplete=false，不具备最终裁决能力。

还有一个必须讲清的信任边界：若同一执行者能改锁、改验收器、改期望值并自行宣告成功，仅靠本地 hash 不能阻止它。正式验收从候选之外的冻结控制检出或已有受保护 CI 配置运行，不能导入候选目录里的验收脚本。控制契约变更另行审查并重建基线。独立复核可由 agent 和独立执行过程完成，不要求所有者点 UI 或提供真人数据，也不假称 real-human。

**九、实际命令与本轮落地边界**

本轮已经落地的是活动 spec、硬规则、完整计划、来源锁/需求契约/研究依据和只读源码保真 checker；尚未升级产品 manifest/binary/运行时代码，尚未实现 G1–G6 的专用证据汇总器。

来源检查由执行 agent 自行定位两个干净检出；upstreamCheckout 固定在目标 commit，effectiveSourceCheckout 为目标加登记补丁。它不要求原开发仓库一直停留在旧 HEAD。运行大输出命令前设置 TEMP/TMP 到 D 盘；构建 target、长日志和 fixture 也留 D 盘。

~~~powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
node --test scripts/verseshell-reintegration-check.test.mjs
node scripts/verseshell-reintegration-check.mjs --upstream "$upstreamCheckout" --candidate "$effectiveSourceCheckout"
node harness/src/cli.mjs context --spec harness/specs/tasks/verseshell-upstream-reintegration.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/verseshell-upstream-reintegration.md --since HEAD
~~~
在这棵树（带 Low 完整性标号）上 `D:\tmp` 不是可写目标：把它用作 `TEMP`/`CLAWX_E2E_RUN_ROOT` 会让 `ae.exe` / Electron 子进程报 `EPERM`（`mkdir <userData>\logs` → "Application initialization failed" → 永远等不到窗口）。把临时根与 E2E 运行根指到检出内已忽略目录即可：

~~~powershell
$env:TEMP = 'D:\ClawX\.agent-workbench\iltmp'
$env:TMP = $env:TEMP
$env:ELECTRON_DISABLE_SANDBOX = '1'                    # 不加会在非交互会话以 0xC0000005 崩溃
$env:CLAWX_E2E_RUN_ROOT = 'D:\ClawX\.agent-workbench\e2e-run'
pnpm run verseshell:test
pnpm exec playwright test tests/e2e/agent-dev-quality.spec.ts
~~~

2026-10-15 实测：该组合下 `verseshell:test` exit 0、`agent-dev-quality.spec.ts` 4 passed / exit 0；把 `TEMP`/`CLAWX_E2E_RUN_ROOT` 换回 `D:\tmp` 则分别为 1 failed（artifact 缺失）与 Electron 初始化失败（无窗口，spec 只报 90s `firstWindow()` 超时）。Electron E2E 需 Node >= 24.16.0（Windows；本机默认 24.15.0，用便携版）。

当前 Harness run 从 requiredProfiles 选步骤，并不执行 requiredTests 声明的所有命令。因此必须显式执行 source checker、Rust、bundle/package、real-limit、差分/干预和 Electron 场景。harness run --dry-run 只验证计划选择；不构成运行证据。validate 的空 diff 也只说明没有读取到待审差异；未跟踪文件还需被显式审查和纳入变更集。

实施前按 packageManager 恢复锁定依赖；当前检出没有 node_modules，不能用缺依赖的跳过结果代替门禁。已有 ignored benchmark 保留并如实记载，不计为功能证明；禁止新增 skip/ignore 来消除失败。lint 使用不自动修改的检查模式，避免顺手格式化全仓。

实施阶段的真实门禁包括 cargo test --locked --no-run -j 1、cargo test --locked -j 1、verseshell:rebuild/manifest:validate:package/test/package:verify、现有 real-limit suite、typecheck、comms:replay/compare、相关 Electron E2E 及真实 diff 的 Harness 校验。禁止用 --no-diff 验收真实任务。用户可见变更更新 Electron E2E；审查 README.md、README.zh-CN.md、README.ja-JP.md。

先离线确定性检查，再小规模真实宿主行为；本次无需新模型凭据或付费采集。不为统计上显著而启动长跑，也不把上游 C14/C16 仍未达标转写成 ClawX 性能收益。规划遵循单次验证约两小时上限；需要长操作时按证据充分的检查点拆分，不用重复研究填补工程缺口。

**十、回滚与关闭边界**

保留完整匹配的 source+patches+manifest+binary+host contract/adapter 版本对；回滚不能只换 exe。首批保持现有状态目录默认值，状态迁移另作范围明确的变更。使用 kill switch 限制调用，不自动改走 native shell。

缺口写到对应检查点，不通过删除需求清单、改历史结论或增加“等真人”前置来关闭。所有验收由 agent 自动执行并标注来源；符合证据和本仓 closure policy 时自动收口。冻结产品默认值、重大范围/架构、公开/发布、凭据首次暴露与不可逆操作仍属独立决策。

**给执行 agent 的固定开场**

~~~text
这是保留实现的回收任务。先读 active task、preservation rule、playbook、source-lock 和 acceptance-contract，复核当前 diff。上游 runtime 是唯一核心实现；不得按描述另写一份。只推进当前检查点，先运行来源检查和已有基线，再列出本批确切 adapter 文件/函数与输入输出映射。需求、上游测试和验收器来自候选之外的冻结控制版本。每次声称完成都附当前可读回执；source checker、mock、unit 和 dry-run 各自只证明本层。遇到真缺陷做最小 exception 并复验，不删需求、不放宽门禁、不等待真人操作。
~~~
