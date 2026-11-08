**会话任务链最终验收覆盖盘点**

观察日期：2026-11-09，Asia/Shanghai。独立回读窗口为 04:47–04:55；最后实际读取源码为 `edb620317`，主要测试证据绑定 `7fa0e6d14` 及其前序候选。结束前主代理确认最新候选 `29fed7aec`、final8 协调器通过、final7 terminal fault 通过、final9-locales passed。本报告按该最新通知更新完成状态，不等待或检索新结果。

**先补三条聚合 spec 漏同步。** CLI 导出的原节点共有 64 条 AC；已读取的聚合 spec 只逐项包含其中 61 条。以下原句在已读取版本缺失，且 `a737502db`、`edb620317` 的已读增量没有补入：

路径：[session-task-chain-acceptance.md](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/tasks/session-task-chain-acceptance.md)，`acceptance` 列表。

| 原节点 / AC | CLI 导出的原句 |
|---|---|
| TF-0658 / AC9 | 任务/会话/运行/归档状态分别读取；等待显示依赖或容量原因，用户不需记忆task/session/worktree ID才能继续工作。 |
| TF-0661 / AC10 | 迁移/恢复/归档恢复通过现有工作入口可达；常规已授权动作不重复确认；真实决策提示含推荐动作、影响和可回读状态。 |
| TF-0662 / AC11 | 2026-11-08统一方案增补：现状与候选配对记录身份手选、跨页、重复确认、目标重述及重复提醒，agent驱动指标不写成人类认知试验。 |

依据：[原节点 CLI 导出](D:/tmp/unified-management-20261109/session-task-validation/node-acceptance-current.json)、[64 条原 AC 与 spec 对照](D:/tmp/unified-management-20261109/session-acceptance-audit/acceptance-contract.json)。原导出读取的状态为 0673 in_progress/80、0657 in_progress/0、0658–0662 proposed；本轮不据此修改图，也不直接读取 canonical。

**当前完成状态与证据层**

主代理已确认核心 15、四语、27 项旧回归均通过，Handoff 四语说明与真实 dialog 断言已修复，final9-locales passed。此前两个 final6 失败已由后续通过结果接替，不再作为当前未通过项。仍需补齐的是下面列出的 AC 分项证据和合同文本同步；无需因测试 fixture 或文案变更重跑全部产品逻辑。

本报告使用三层来源：**直接回读**为磁盘 JSON、测试断言和源码；**可继承**为相关源码/断言相同或有明确差异说明的旧结果；**主代理最新确认**为本轮提供的 final7/final8/final9 与 `29fed7aec`，具体新 JSON 路径、SHA256 和完整候选差异留给最终聚合 manifest 绑定。本报告不把第三层改写成独立读取过的结果。

| 范围 | 已回读结果与路径 | 对原 AC 的支撑 |
|---|---|---|
| A4 / TF-0673 | `final-session-unit.tests.json` 中 `session-task-scope-completion` 33 项、bridge 17 项、scope 14 项；`final-durable-task.tests.json` 75 项 | 空讨论、显式合同、第二 writer 拒绝、缺失/跨 scope/stale 拒绝、Fork 只读、Handoff epoch 换代、externalRef 不取得完成权威、revision 竞态。 |
| A4 实际效果与恢复 | `final4-scope.tests.json`；其 `session-task-runtime.json`、`scheduled-task-scope.json`、`canonical-task-selection.json` | 10 轮讨论 businessTasks=0；真实首写与后续写；已有任务选择保持状态；隔离 schedule 不替换负责人；丢创建响应、首发 unknown、两次重启仍复用 child/send key，最终 transcript 对账。 |
| U1 / TF-0657 | `snapshot-cache-fix1.tests.json` 中 family read model 18 项；`final4-worker` 的实际 Gateway row | 2/20/100、多代、跨工作组、未加载父项/缺失/cycle/bound、stage classifier 同步、scope/stale 投影。实际 worker 同时带 parentSessionKey 与 spawnedBy；任务引用来自 owner。 |
| U2 / TF-0658 | `final4-family.tests.json` 2/2；`final4-scope.tests.json` 中 project entry 与 scope faults；`sidebar-navigation-fix2.tests.json` 32/32 | 家族导航、项目负责人、任务→会话→产物往返、草稿隔离、960 窗任务抽屉、键盘焦点返回、80 初始预算和 100 可达。 |
| U3 / TF-0659 | `final4-family` question/Handoff；`final-session-unit` 中 handoff recovery 20 项；`final6-lifecycle-e2e` 中 Fork/Handoff 用例通过 | 指定消息边界、Fork chatSend=0、源草稿保留、Handoff 一次显式首发、重复请求复用、unknown 禁止盲重发、generation 与旧响应隔离。 |
| U4 / TF-0660 | `final4-worker.tests.json` 2/2；`worker-task-journey.json`、`active-parent-transfer.json`；delegation status、panels 单测 | admission/运行/报告/验收分开、真实 child 写文件、父 run 活跃时规范移交、只读 observer 不夺 claim、不同 agent coordinator 隔离、跨 scope send 拒绝、lost-ack 后按 intervention key 核实 queue/steer。 |
| U5 / TF-0661 | `final4-scope` family lifecycle；`final6-lifecycle-e2e.tests.json` 21/22、`final6-lifecycle-faults-e2e.tests.json` 4/5；后续两失败主代理确认已过 | parent archive/restore/delete 保留 child、任务和产物；Fork/Handoff、range compact、checkpoint、归档/删除、实际 completion continuation 等旧回归。当前 27/27 由旧组 25 个通过加后续两项通过形成，须保留逐用例替代关系。 |
| 四语 | `final5-locales.tests.json` 1/1；`session-task-locales.json` 内 en/zh/ja/ru 四条 passed；最新 final9 主代理确认通过 | 项目负责人、任务抽屉、Task Ledger 入口、父/子导航的真实四语 UI；后续补上 Handoff dialog 说明。 |
| 功能单测总账 | `final-session-unit` 218、`final-durable-task` 75、`final-orchestration` 18、`final-process` 30、`final-runtime-guards` 15 | 合计 356。另有 `final2-resource-contract` 8、cache 27、resource 33、导航 32；批次存在重叠，不把相加值称为去重测试总数。 |

上表 result/tests 文件均位于 [session-task-validation](D:/tmp/unified-management-20261109/session-task-validation)。完整命令、退出码、计数、actor、driven_by、运行前后 manifest 及日志 SHA256 汇总见 [evidence-inventory.json](D:/tmp/unified-management-20261109/session-acceptance-audit/evidence-inventory.json)。实际效果 JSON 的完整路径、哈希及内容见 [artifact-inventory.json](D:/tmp/unified-management-20261109/session-acceptance-audit/artifact-inventory.json)。

**原 AC 中明确尚未形成完整证明的分项**

“未找到”限定于上述实际读取的候选、结果与断言。它是验收证据缺口；已有相同合同的有效证据可以按源码 manifest 继承，无需重新实现。

| 节点 / AC | 已有支撑 | 还缺什么具体证明 |
|---|---|---|
| TF-0658 AC3、AC6 | 来源/后代往返和两边草稿有实际 E2E；抽屉 Escape 焦点返回通过 | 没找到先记录 transcript 阅读位置、切到另一会话、返回后断言恢复该位置的 E2E。现有 family 中 scrollTop 用于列表测量，不能替代正文阅读位置恢复。 |
| TF-0658 AC4 | stream containment 测量、状态变更单测、worker owner 状态投影存在 | 没找到后台 child 新增/失败/完成时，父自身状态保持独立、当前选中会话不变且正在 hover 的行不持续重排的组合断言。现有静态数量/性能记录不能完整覆盖该句。 |
| TF-0658 AC8 | ready/empty、Ledger warning unavailable、scope/generation mismatch、窄窗与键盘已有证明 | 本批没有分别对应“未绑定负责人、loading、permission 不可用”的 Electron 结果；不能以一个 unavailable 状态替代三种原因。可先关联既有入口用例。 |
| TF-0658 AC9 | worker queue、canonical task 与 run/归档分离分别有结果 | 原句漏入聚合 spec；尚无一条明确连接等待原因（依赖/容量）和可继续动作的 UI 验收映射。 |
| TF-0659 AC1 | 真实 user 问题使用此前 assistant 边界；忙态 Fork 拒绝已有旧回归 | 本批结果未对应到“无 assistant 祖先”和“无 entryId”的拒绝用例。需保留不退化 tip fork 的负例证据。 |
| TF-0659 AC5 | 所有已测创建来自显式 UI/typed owner 操作 | 未见模型新会话建议进入同一预览确认，以及普通回复文字不得隐式创建的专门用例。源码存在同一入口不等于该负例已运行。 |
| TF-0659 AC11 | 相同 operationId 重试、同 key 不同 payload 拒绝已有 owner 单测 | 没找到“相同 payload、不同合法新 operationId”确实创建两个独立操作的结果。不要只用幂等重试证明新的合法意图可执行。 |
| TF-0660 AC2、AC7 | admission/queue/steer/report/parent return 均有实际回执；模型字段可见 | worker 实证中 business task 仍 doing、验收 UI 为 unavailable，这正确证明没有假完成；业务 Task owner 成功验收后对应 UI 阶段的正向链未在该实证中发生。未知费用保持 unknown 的 UI 分支也没有对应断言，fixture 的 cost=0 是已提供值。 |
| TF-0661 AC1、AC6 | [操作矩阵](D:/ClawX-work/session-task-unified-relay-20261109/docs/dev/session-lifecycle-control-matrix.md) 与 27 项回归已有基础 | 文档目前是操作/owner/条件/结果恢复四列，未逐动作映射确认/取消、pending/failure/unknown 的证据。现有 compact/range/checkpoint 用例主要是正向调用；不能声称每项动作的拒绝/取消/恢复分支都已覆盖。 |
| TF-0661 AC8 | family lifecycle 直接证明 archive/delete 不改任务或删除 child/产物 | dirty/未推送工作树拒绝回收尚未绑定到本节点证据。应引用现有资源 owner 的验收及版本，而非重做该能力。 |
| TF-0661 AC9 | context 操作和进程资源分别有接口/结果，矩阵分开表述 | 缺少把上下文 token、进程 RAM、accepted memory 三者同时定位到各自 owner/显示值的可回读映射；不应据单个资源列表通过宣称整句覆盖。 |
| TF-0661 AC10 | 归档恢复与现有导航部分有证据 | 原句漏同步；迁移/恢复工作入口、已授权动作不重复确认、决策提示含推荐/影响/回读状态，尚无完整用例映射。 |
| TF-0662 AC2 | 四种主题/尺寸、collapsed/reduced-motion、30px、2/20/100、键盘均有实际记录 | “瞬时创建/传递/失败状态截图”未形成逐状态清单。现有 family、worker、scope 截图可复用，但应明确哪张证明哪个瞬态。 |
| TF-0662 AC5、AC6 | README 四语已同步；actor/命令/计数/source manifest 存在；本报告提供独立回读 | 仍需把多候选继承、最终新结果路径/hash、旧失败→后续替代、上述原 AC 补项纳入最终精选证据包。已读的 `harness/specs/fixtures/session-task-chain/` 当时尚不存在；目前 tmp 产物可作为整理来源。 |
| TF-0662 AC11 | family 有性能配对 | 完全未见身份手选、跨页、重复确认、目标重述、重复提醒五类交互指标的“现状→候选”配对记录。flat-vs-family 性能比较不等于这五类指标；该条也漏入 spec。 |

A4 / TF-0673 的主要业务负例和 U1 的关系/任务只读投影，在已读组合中有直接支撑；未发现应另行重做对应实现的理由。U6 AC1/AC10 的旧回归失败已由主代理确认后续通过，剩余工作是同候选或可证明继承的聚合，以及本表原 AC 分项补齐。

**缓存信任边界已核实**

[task-ledger-service.ts](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-ledger-service.ts:310) 先读取事件投影，再调用真实 TaskSystemStore/listManagedTasks 合并合同；try/catch 仅包住最终 `writeTaskLedgerSnapshot`。它不在 owner 读取失败后回退到旧 `snapshot.json`。

`snapshot-cache-fix1.tests.json` 的 27/27 中，4 个专门 cache 用例分别证明：EPERM 后仍返回真实 event/owner 数据并释放锁；事件历史损坏时拒绝；TaskSystemStore 损坏时拒绝；同路径并发 cache 写由既有文件锁串行化。另 5 个 Ledger service、18 个 read-model 用例一起通过。相关源码与专门测试的运行后 SHA256 同候选一致：service `55f81ded472843e205fdfa0dfc5817d2354a0ef7d15a707c4aaea01546b598d0`；cache test `69c30cb156f244cb67b109035e57a1e54889a29b2cdd580e6c37e014890c27ad`。

此结论针对派生 JSON 写缓存故障。更底层 SQLite event projection 有自己的 sequence 缓存合同，本批四测没有证明所有持久介质篡改场景；不将其虚构为本次新增产品缺陷或收口条件。

**100 后代、四语和视觉证据**

`final4-family-results/session-derivation-ui-fami-880f5-responsive-keyboard-layouts/family-layout.json` 已回读，`status=passed`、`fixtureScale=true`、`provider=local-scripted`，保留实际 Runtime 创建的 3/21/101 行。预算来自既有 TF-0423 与 containment 测试，不新增阈值。至最后独立回读，16 个性能 source/fixture 哈希全部匹配。

| 后代数 | flat / family 初始行 | flat / family 完整可达耗时 ms | 最终目标行数 | 5 / 40 个流事件的 committed row work |
|---:|---:|---:|---:|---|
| 2 | 3 / 3 | 419 / 445 | 3 | 两种视图均 0 / 0 |
| 20 | 21 / 21 | 520 / 600 | 21 | 两种视图均 0 / 0 |
| 100 | 80 / 80 | 1038 / 1156 | 101 | 两种视图均 0 / 0 |

100 后代测量中两视图新增 RPC 都是 0；family 首行 582ms、flat 555ms，family 完整可达比 flat 多 118ms，记录差值而未自造性能通过线。切换测得 p50 7.7ms、p95 9.2ms；旧 333 会话基线明确标为 reference-only。

Light/Dark × 1280×800/960×800 四组合各记录 100 个 child 的 DOM 几何，实际断言 30px 行高、无重叠和无横向溢出；另有 collapsed/reduced-motion 截图、键盘 disclosure。证明层是 agent fixture 的实际 Electron/Gateway 测量，不能写成真实用户生产规模收益。

`final5-locales` 是一条测试内部遍历四语，断言翻译后的负责人、任务按钮、Ledger 入口、父子导航并产生四张截图，不是四个独立测试。此前确证 Handoff 四语 `composer.handoff.dialogDescription` 均仍称“不自动发送”，与 `create` 按钮和实际一次首发矛盾；实际调用位于 Chat/index.tsx 的说明和按钮。主代理已在 `29fed7aec` 修正并补真实 dialog 断言，final9-locales passed，因此该矛盾按最新通知已闭合，旧发现保留为修复轨迹。

**候选差异与最小继承条件**

| 证据候选 → 后续候选 | 已核对的差异 / 继承方式 |
|---|---|
| `81b84911a` 的 356 → `d85725560` | 后续 resource 声明类型修补；功能单测按相关文件哈希继承。最后一次类型失败不能覆盖在 final2 的全绿下面，应保留原失败。 |
| `d85725560` → `35cbf9c5d` | Sidebar 改为 await scoped 激活后 navigate；导航 32 项与后续实际 worker/family 回归补强。不能直接用更早 Sidebar suite 冒充该修复验证。 |
| `35cbf9c5d` → `69dedf6e0` | Ledger cache 写错误处理与对应负例；cache 27 项、final4 核心 15、后续 Node/Web/test/build/contract/i18n 已覆盖。 |
| `69dedf6e0` → `fb00956ed` | 新增四语 E2E；产品 UI/关系逻辑未改，final4 可继承；四语结果单独绑定。 |
| `fb00956ed` → `14cd32645` → `7fa0e6d14` | 资源 inventory 在 worktree owner 不可读时保留其他 owner；resource 33 项、runtime build/Node 类型和 lifecycle 重跑补强；7fa 仅把导航 fixture 类型声明补齐。 |
| `7fa0e6d14` → `a737502db` | runtime 只将失败说明改为 `workspace root ownership read failed: ...`；coordination fixture 显式 init 独立 repo，并断言真实 git backend。旧 family/UI/Task owner 逻辑可继承；资源 detail 分支与 fixture 由定点故障/coordination 复验接替。 |
| `a737502db` → `edb620317` | 仅给 coordination 测试增加等待 owner hydration，再测 quiet row；未改产品代码，不要求核心或 356 全跑。 |
| 后续 → `29fed7aec` | 本轮主代理确认四语说明修复及真实 dialog 测试，final9 passed。最终 manifest 只需列明实际 diff、四语 source hash 和该新结果；不能仍声称旧 family 的所有 16 个文件哈希逐字相同，因为其中包含 en/chat.json，应说明修改仅 Handoff 文案、family 行为相关字段未变。 |

final2 的 12 个 gate 均有 exit=0；后续 final4 UI/Node/test/build/contract/i18n、final6 Node/runtime/test-fixed、comms replay/compare、artifacts、harness validate/preview 也已读到相应成功 JSON。测试文件变化只影响对应测试编译和该用例证据，不要求重复全部旧 gate。README、规范或翻译变化以对应 lint/contract/harness/定点 UI 结果和 diff 绑定处理。

主代理另报 main overlay 的只读 WebType=0、54 unit 通过；它属于 overlay 整合层，本报告未读取其原始结果，不把它混作候选节点验收，也不要求重复运行。

**失败保留与替代关系**

- `final4-scope` 原 10/11，warning 用例因 Electron launch 90 秒超时；`final4-warnings-rerun` 1/1。核心 15 是去重用例均有通过证据，原 suite exit=1 仍保留。
- `final5-lifecycle-e2e` 18/22、faults 4/5；资源 read red 保留，resource-read-green 33/33 补上 owner inventory 修复。
- `final6-lifecycle-e2e` 21/22：coordination fixture 的 backend/environment 身份漂移在进入后续 UI 断言前失败；主代理已确认 final8 通过。
- `final6-lifecycle-faults-e2e` 4/5：期望 `/workspace root/i`，实际 detail 为 `worktree owner read failed: ENOENT`；a737 保留所需关键词，主代理已确认 final7 通过。旧失败停在该断言，不能将其后续 terminal/stop/archive 断言倒算为旧轮已跑过。
- `final6-test-types` exit=2 保留；`final6-test-types-fixed` exit=0。更早 observer/revision red、final2 worker 与 final3 scope 失败文件也仍在原目录。

最终整理以原文件路径和 SHA256 连接替代结果，保持失败、修复与后续通过各自的 candidate 身份。相关快照见 [closeout-readback.json](D:/tmp/unified-management-20261109/session-acceptance-audit/closeout-readback.json)。本轮仅写审计产物，没有运行测试、改源码、写 Task Forest 或发送会话消息。
