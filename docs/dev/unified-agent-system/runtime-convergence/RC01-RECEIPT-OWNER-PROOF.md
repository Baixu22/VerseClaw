# TF-0029：回执 owner 的真实持久化证明

2026-09-10。活动 spec：`harness/specs/tasks/rc01r-receipt-owner-proof.md`。
本记录证明现有 `ReceiptStore` 的一个有界修复及其存储行为；TF-0029 仍为
`in_progress`，完整全局门禁与独立 Executor/Verifier 验收另行收口。

## 问题与修复

`ReceiptStore.put` 原来只比较 `content_digest`，但该 digest 不包含 `kind` 和
`version`。在基线 `6c87dfb865529447c4e4d046c3d172a19fb45f1b` 的真实 SQLite
探针中，先写 `context/v1`，再用同键、同身份和相同内容写 `wire/v1`，旧代码返回
`ok=true / identical-content`，实际持久化行仍是 `context`。

现有事务内的重复判断同时比较持久化的 `kind`、`version` 和 `content_digest`。
同一探针现在返回 `ok=false / content-conflict`，原行逐字段保持不变。
存量 digest、schema、owner、键格式和首次创建时间均未迁移。

此前未完成的测试改动已接续验证，并补齐三处证据：重启后的跨类型冲突、并发跨类型
写入、生命周期删除只影响选中类型。集成测试原来的失败样例缺少 `adapterId`，会先
失败于身份校验；现已使用合法身份，让不可用数据库路径触发真实存储失败，并断言
两阶段失败诊断及 payload 字节不变。

## 已执行的证明

| 约束 | 实际执行与观察 |
| --- | --- |
| 内容敏感幂等 | 同键同类型同内容重复成功；shadow→正式、context→wire、wire→effect 冲突；原行和行数不变。 |
| 进程重启 | 写进程退出并关闭 SQLite 后，新 Node 进程读到同一行；`created_at=1` 保留；第三个进程跨类型重试仍冲突。 |
| 并发写入 | 两个不同 PID 并行写同一 SQLite 文件；同内容、异内容、异类型三种情形均仅插入一行，其余返回合法重复或冲突。 |
| 原子性与身份 | 现有 owner 使用 `BEGIN IMMEDIATE` 事务和唯一幂等索引；显式 attempt/model-call/wire-attempt 坐标和 SQLite 约束回归通过。 |
| 保留策略 | 打开数据库及重试不按年龄隐式删行；显式 policy 仅删除指定类型的旧行，保留新行及其他类型的旧行。 |
| 隐私 | 既有校验拒绝 raw payload 字段、伪造 digest、非法引用/预算/身份/索引；数据库仅保存允许的摘要和引用。 |
| 真实失败 | 用普通文件阻断数据库父目录；store 抛错，shadow 调用方记录 context/wire 写失败、`acceptanceReady=false`，payload 不变。 |
| 生产调用组合 | 完整 embedded runner、生产 transport registry 和入口矩阵的本地 fixture 通过，覆盖相关回执与字节一致性。 |

进程退出后的持久性不代表断电耐久性；并发测试验证并行启动的两个进程，不声称覆盖
所有可能的调度顺序。测试使用临时状态目录、本地 fixture 和 loopback server，没有
请求真实模型 provider，也没有读取生产状态库。

## 复验命令与结果

先执行 `node scripts/build-openclaw-runtime.mjs`：缺失的 OpenAI public artifact
已通过现有构建流程恢复，CLI bootstrap guard 和 Gateway ready 烟测通过。

在 `openclaw_runtime/` 下执行：

```text
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts receipt-store.test.ts shadow-census.test.ts rc02-shadow-census.acceptance.test.ts --passWithNoTests=false --maxWorkers=1
```

结果：**3 files / 36 tests PASS，0 skipped**。从 C: 目录联接启动，Vitest 正确
解析到 D: 源目录。`vitest.agents.config.ts` 的文件筛选应使用 `src/agents` 内的
相对路径；保留 `--passWithNoTests=false`，不把无测试执行记为通过。

初次运行的 34 PASS / 1 FAIL 仍保留：唯一失败是缺失构建产物；在真实重建后完整
复跑通过，没有跳过 embedded runner，也没有通过替换生产加载路径来放行。

本轮原始日志、JSON 测试结果、基线源码副本和前后探针位于本机
`C:/Users/27933/AppData/Local/ClawX-scratch/rc01r-receipt-proof-review-20260910/`。
这些是本地工程证据，不是正式验收 manifest。

## 补充门禁与遗留项

| 门禁 | 本轮结果 |
| --- | --- |
| `pnpm run typecheck` | exit 0；未用缓存，Node/Web 项目均通过。 |
| Runtime `node scripts/run-tsgo.mjs -p tsconfig.core.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/core.tsbuildinfo` | exit 0，沿用仓库 core 类型检查入口和资源保护。 |
| 三个改动 TypeScript 文件的 oxfmt | PASS。 |
| `node scripts/run-oxlint.mjs --tsconfig tsconfig.json`（三个改动 TS 文件） | exit 0；保留 4 条既有 warning：3 处测试数组构造、1 处既有排序断言。 |
| `pnpm run comms:replay` / `pnpm run comms:compare` | 均 exit 0，通信回归 PASS。 |
| Harness specs/git 单元测试 | 2 files / 41 tests PASS，0 skipped。与回执测试合计 77 项通过。 |
| 独立 Codex autoreview | exit 0，`findings=[]`，`patch is correct`，confidence 0.96；审核者未自行执行测试，核对了本轮 36/36 原始证据。 |
| 本 spec 的 diff-aware Harness validate / dry-run | 隔离 sparse checkout PASS，基于 `6c87dfb865529447c4e4d046c3d172a19fb45f1b`，未使用 `--no-diff`。dry-run 只证明选定范围和计划，未执行完整 fast 门。 |
| 共享工作树的本 spec validate | FAIL：其他基线工具、Workbench evidence 和 TF-0153 的 11 个既有改动路径不属于本切片。 |
| `pnpm run harness:ci` | FAIL：Gateway scenario 的全分支 changed-path 覆盖门仍包含其他工作面的历史路径；未放宽白名单。 |

根级 `typecheck` 的测试类型分支仍是观察模式，单独结果为 exit 2 / 8 errors：
`tests/unit/agent-dev-regularization.test.ts` 的两个 export 类型声明不一致，以及
`tests/unit/runtime-memory-locomo-full-500.test.ts` 的六处 `_profileContext` 未定义。
这两份测试与本轮 HEAD 无差异，本切片未修改它们。Node/Web 的 exit 0 不得被写成
全仓测试类型零错误；这些错误须在 TF-0029 后续全局绿线工作中消除。

独立 review 通过仓库自带 helper 执行，命令为：

```text
python -X utf8 openclaw_runtime/.agents/skills/autoreview/scripts/autoreview --mode local --prompt-file C:/Users/27933/AppData/Local/ClawX-scratch/rc01r-receipt-proof-review-20260910/review-prompt.md --dataset C:/Users/27933/AppData/Local/ClawX-scratch/rc01r-receipt-proof-review-20260910/focused-final.json --json-output C:/Users/27933/AppData/Local/ClawX-scratch/rc01r-receipt-proof-review-20260910/autoreview.json --output C:/Users/27933/AppData/Local/ClawX-scratch/rc01r-receipt-proof-review-20260910/autoreview.md
```

两个探针数据库的同一行 `content_digest` 和 `created_at` 也已直接比对一致，
见 `verification-summary.json`。代码审核只覆盖本切片，不是工程验收 Verifier。

## 文档与接力边界

已核对 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`：该修复不改变公开
界面、操作流程或配置，三语 README 无需修改。持久化契约同步在 Harness rule/spec。

四个 `review_needed` 已按当前任务图复核：TF-0115、TF-0137、TF-0127 保持既有
`landed-unwired` 裁决；TF-0009 的三个 profile 真人计数仍各为 0/10。不得把本轮
回执证明提升为这些节点的完成证明。产品锁、RC-02 后续工作及父节点验收状态不变。
