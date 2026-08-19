# DCS 优化计划全量验收测试基准提示词（GA Readiness）

> 触发：owner 需要整体性验收本轮 Context Control Plane / DCS 优化计划（Stage 0–6 + Stage 5 L7 deferred soak），判断工程与证据是否满足预期、是否具备真正 GA 条件。
> 执行要求：新会话 / 新 actor；独立 verifier；验收范围只读。发现缺陷只记录并停止，不自行修生产代码，除非 owner 另行授权修复切片。
> 关键红线：本提示词只能给出**工程验收判决**（`ga-ready` / `ga-ready-with-findings` / `blocked`）。**真正 GA（ga-live）必须由 owner 在工程判决之后显式做出产品锁/发布决策**；verifier 不得自行宣布 GA、不得翻任何产品锁或默认值。

## 0. 前置事实与 owner 前置输入

### 0.1 前置事实

| 项 | 值 |
|---|---|
| 分支 | `codex/context-control-plane-stage0` |
| 基线 HEAD | `f55201b22630d5c904f3105b2a9c8876ea5e889b`（全程不得变化） |
| 工作树 | `D:\verse_claw_worktree` |
| 阶段状态 | Stage 0 / 1 / 2 / 3 / 4 已 `accept`；Stage 5 开发端 L1–L8 PASS（L7 按 owner D6/D7 为 agent-operated real-provider evidence + deferred soak）；Stage 6 已 `accept` 且 2 项备注修复后复验 `accept` |
| 产品锁 | `defaultOn=false`、`liveReady=false`、`productApproved=false`，全程不得变更 |
| 卫生约束 | 不 commit、不 push、不建 PR；`git log` 不得出现新提交 |

### 0.2 owner 必须在执行前书面提供（缺项按 §2.3 处理）

| 编号 | 输入 | 用途 | 缺失时的后果 |
|---|---|---|---|
| A1 | 是否授权全量 GA-wide regression（`pnpm test` / `pnpm run test:integration` / `pnpm run test:e2e` / `pnpm harness:ci`） | 决定本次是 `fast` profile 还是 `full` profile | 未授权时不得执行全量 E2E/全仓测试；GA 判决最多为 `ga-ready-with-findings` |
| A2 | Stage 5 L7 soak 的 S1–S6（critical/constraint/evidence 保留率、P95 编译延迟、P95/单轮成本、最小真实样本数与配对协议） | GA-R3 / G10 的数值门槛 | 任一缺失 => GA 判决必须为 `blocked`，只允许先跑工程门禁并记录 |
| A3 | 真实 provider 一次性临时 key（仅当需要重跑/新增 E4 证据时） | Stage 1/2/3/5 golden-run 与 soak | 无 key 时：已有 evidence 只做只读复验；真实用例必须 `skipped`，不得伪造；凡需要新增/重跑真实样本（尤其 soak）而缺 key，G10 不能 PASS |
| A4 | GA 发布策略：哪些能力 GA 后保持默认关闭/opt-in、哪些产品锁由 owner 何时翻转 | 区分 `ga-ready` 与真正 GA | 缺失时 verifier 只输出 `ga-ready/blocked`，不输出 GA 上线结论 |
| A5 | 期望 dirty patch 范围（默认 = Stage 0–6 累积 patch + soak 切片，当前 83 行基线） | 范围外改动判定 | 缺失时按 Stage 0–6 所有 spec `touchedAreas` 并集判定 |

> key 注入规则不变：仅 owner 单次命令临时环境变量注入；不得写入文件、DEVLOG、`.env`、注册表或持久环境；命令文本与日志不得含 key。真实 run 结束后立即复核三作用域 key absent。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md`
4. `docs/dev/context-control-plane/STAGE5-L7-SOAK-DEV-PROMPT.zh-CN.md`
5. `docs/dev/context-control-plane/STAGE6-ACCEPTANCE-PROMPT.zh-CN.md`
6. `docs/dev/context-control-plane/STAGE6-REACCEPTANCE-PROMPT.zh-CN.md`
7. 本提示词 `docs/dev/context-control-plane/DCS-GA-FULL-ACCEPTANCE-PROMPT.zh-CN.md`
8. `harness/specs/tasks/context-control-plane-stage0.md` 至 `...stage6.md`（全部）
9. 若存在：`harness/specs/tasks/context-control-plane-stage5-l7-soak.md`
10. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`（全部 Stage 验收与修复切片）
11. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
12. Stage 0 契约：`stage0/authority-matrix.md` / `artifacts-schema.md` / `authority-adapters.md` / `golden-path-contract.md` / `stage1-task-draft.md`
13. 全部 Stage 生产代码与测试路径（见 §3.2 命令矩阵）
14. 受控证据：`artifacts/context-control-plane/stage1-real-run-evidence.json` / `stage2-real-run-evidence.json` / `stage3-real-run-evidence.json` / `stage5-real-run-evidence.json`，以及（若存在）`stage5-l7-soak-evidence.json`

## 2. GA 判定模型（必须先读，避免误判）

### 2.1 三个层次

| 层次 | 含义 | 判定者 |
|---|---|---|
| 工程全量验收 | Stage 0–6 + soak 的全部功能/负向/回归/卫生门禁是否全绿 | 本提示词的独立 verifier |
| GA readiness | 在工程全绿 + E4 真实证据达标 + owner A4 发布策略齐备的前提下，证据是否支持进入 GA | verifier 输出 `ga-ready`；owner 复核 |
| GA live | 实际允许对外宣称 GA / 翻 `liveReady` / `productApproved` / 调整默认开关 | **仅 owner** |

### 2.2 verifier 判决词（只允许）

| 判决 | 条件 |
|---|---|
| `ga-ready` | A1–A5 已提供；G0–G12 全 PASS；Stage 5 L7 soak 完成且 S1–S6 达标；真实 E4 证据链完整；全量回归无 DCS 相关失败；剩余问题为空 |
| `ga-ready-with-findings` | 全部硬门禁 PASS，仅存在不改变 DCS 语义的既有观察项（须列明并得到 owner 接受） |
| `blocked` | 任一 G0–G12 硬门禁失败；A2/A3/A4 关键输入缺失；发现范围外生产改动；产品锁/默认值被翻；真实证据造假；或出现本提示词禁止事项 |

### 2.3 缺失 A1–A5 的处理

- A1 缺失：只跑 DCS 聚焦矩阵（§3.1/§3.2），GA-wide 回归标记为未授权；最高 `ga-ready-with-findings`。
- A2/A4 缺失：不能给 `ga-ready`；输出 `blocked`，并明确缺失项和已通过的工程门禁。A3 缺失时，若本次验收只需复验既有 E4 证据且无需新增/重跑真实样本，可按证据状态继续；否则 G10 不 PASS。
- A5 缺失：按所有 Stage spec `touchedAreas` 并集做范围判定。

## 3. 全量测试命令基准（原样执行并记录 exit code）

### 3.1 Phase A：Git 前置

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git log -1 --oneline
```

判定：HEAD 必须等于基线 SHA；分支正确；`git status --short` 的行集合与 owner 确认的 dirty patch 一致；无探针残留。

### 3.2 Phase B：DCS 聚焦验收矩阵（Stage 0–6 requiredTests 并集）

以下命令**全部必须 exit 0**。任何一条失败，GA 判决为 `blocked`。

```bash
# --- B0 harness：全部正式 spec ---
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage0.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage0.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage1.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage1.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage2.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage2.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage6.md

# 若 stage5-l7-soak.md 已存在，追加：
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md

# --- B1 Stage 0：契约冻结 ---
pnpm exec vitest run tests/unit/context-control-plane-stage0-contracts.test.ts --reporter=verbose

# --- B2 Stage 1：Provider Guard / Grant / Tool Guard / EffectReceipt ---
pnpm exec vitest run tests/unit/context-control-plane-stage1-contracts.test.ts tests/unit/context-control-plane-stage1-provider-guard.test.ts tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts tests/unit/context-control-plane-stage1-effect-receipt.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-request-envelope.test.ts src/agents/stage1-minimal-grant.test.ts src/agents/stage1-tool-guard.test.ts src/agents/stage1-effect-receipt.test.ts src/agents/stage1-break-glass.test.ts src/agents/stage1-golden-run.test.ts --reporter=verbose
pnpm run comms:replay
pnpm run comms:compare

# --- B3 Stage 2：ContextRef -> Snapshot -> DCS -> PromptPlan -> Envelope ---
pnpm exec vitest run tests/unit/context-control-plane-stage2-contracts.test.ts tests/unit/context-control-plane-stage2-provider-guard.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage2-golden-run.test.ts --reporter=verbose

# --- B4 Stage 3：Task Ledger Working Context ---
pnpm exec vitest run tests/unit/context-control-plane-stage3-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-working-context.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/task-ledger-service.test.ts tests/unit/task-ledger-reference.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-golden-run.test.ts --reporter=verbose

# --- B5 Stage 4：完整 CapabilityGrant + Tool Guard + 祖先链 ---
pnpm exec vitest run tests/unit/context-control-plane-stage4-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-capability-grant.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-tool-guard.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts tests/unit/context-control-plane-stage3-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-minimal-grant.test.ts src/agents/stage1-tool-guard.test.ts --reporter=verbose

# --- B6 Stage 5：Memory Facade + unit-aware packer + golden run ---
pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage5-memory-facade.test.ts src/context-engine/stage5-unit-aware-packer.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts --reporter=verbose

# --- B7 Stage 5 L7 soak（仅当 spec 已存在且 A2 已提供）---
pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage5-memory-facade.test.ts src/context-engine/stage5-unit-aware-packer.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts src/agents/stage5-l7-soak.test.ts --reporter=verbose

# --- B8 Stage 6：只读解释投影 + UI + 四语 + E2E ---
pnpm exec vitest run tests/unit/context-control-plane-stage6-contracts.test.ts --reporter=verbose
pnpm i18n:lint
pnpm run test:e2e tests/e2e/context-control-plane-stage6.spec.ts

# --- B9 全局工程门禁 ---
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

关键输出预期：

- 所有 harness validate：`Spec is valid`；所有 harness context 输出完整 read order。
- 全部聚焦 Vitest：测试文件与用例全 PASS；Stage 1/2/3/5 golden-run 中真实 provider 用例无 key 时应显式 `skipped`，不得改成恒真或伪造。
- `comms:replay` 成功写 current metrics；`comms:compare` 全部阈值 PASS（任何阈值失败 => `blocked`，不得以“近似”放行）。
- `pnpm i18n:lint`：`i18n lint passed.`。
- `pnpm run test:e2e tests/e2e/context-control-plane-stage6.spec.ts`：1 passed，且断言含本地化文案（`Protected section` / `Allow` / `Protected rule`）。
- `pnpm contract:check`：`Contract check passed.`。
- `pnpm run typecheck`：node/web exit 0；`testTypes` 仅 observationMode（当前已知 1285 个既有错误不 gate）；任何 node/web 新错误 => `blocked`。
- `pnpm run lint:check`：0 errors；当前既有 126 warnings 可接受；oxlint 0/0；任何新 error => `blocked`。
- `git diff --check`：exit 0；仅允许既有 LF/CRLF 提示。

### 3.3 Phase C：真实 provider E4（条件执行）

仅当 A3 已提供且 A2 已满足时执行；每次 key 只注入单条命令，命令文本不得含 key：

```bash
# 按需重跑真实 golden-run（-dot 输出，超时 120s；无 key 时保持 skipped，不得改 runIf）
DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-golden-run.test.ts --reporter=dot --test-timeout=120000
DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage2-golden-run.test.ts --reporter=dot --test-timeout=120000
DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-golden-run.test.ts --reporter=dot --test-timeout=120000
DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts --reporter=dot --test-timeout=120000
# soak runner 若存在：
DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-l7-soak.test.ts --reporter=dot --test-timeout=120000
```

证据检查：

- `artifacts/context-control-plane/stage{1,2,3,5}-real-run-evidence.json` 必须存在、可 JSON 解析、schema/model/runId/digest/ref/结果可查询。
- `stage5-l7-soak-evidence.json`（若 A2 已完成）必须满足 S1–S6 且只含 digest/ref/id/指标。
- 任何 evidence 含 key、prompt 原文、工具参数、工具输出 => `blocked`。
- 无真实 evidence 的 synthetic/cached run 不得计入 E4。

### 3.4 Phase D：GA-wide 回归（仅当 A1 授权；否则记录未授权）

```bash
pnpm test
pnpm run test:integration
pnpm run test:e2e
pnpm harness:ci
```

失败分类规则：

- 失败路径/依赖与任一 Stage 0–6 spec `touchedAreas` 相交：直接 `blocked`。
- 失败为基线既有且与 DCS diff 无关：最多 `ga-ready-with-findings`，必须在 DEVLOG 列出路径、错误摘要和 owner 接受记录；owner 未接受前不得给 `ga-ready`。
- 任何测试命令 exit 非 0 且无法证明与 DCS 无关：`blocked`。

### 3.5 Phase E：环境前置

- Electron 报未正确安装时：`node node_modules/electron/install.js`，再重跑同一验收命令；该步骤不修改源码。
- 使用项目 pinned pnpm（必要时 `corepack enable && corepack prepare`）；不改 `packageManager`。
- Windows 下 E2E 必须使用 Windows 环境执行（Git Bash / PowerShell 均可，按 `AGENTS.md` Shell Strategy）。

## 4. 全量 GA 判定表（G0–G12）

| 门 | 内容 | 判定标准 | 通过证据 |
|---|---|---|---|
| G0 | 范围与所有权 | 所有 dirty/untracked 生产路径均落在 Stage 0–6（+soak）spec `touchedAreas` 内；无未经授权的范围外生产改动 | git status + spec touchedAreas 对照 |
| G1 | Stage 0 契约冻结 | 五平面/六 artifact/authority 适配/黄金路径契约文档存在；六 schema 校验有效 fixture、拒绝 payload/raw 违规；生产默认与产品锁未变 | stage0 contracts + 文档核对 |
| G2 | Stage 1 黄金路径与 egress | Provider Guard 观测模式 flag-off 字节不变；sealed envelope 可恢复；Grant/Tool Guard deny/expired/governance mismatch 零副作用；EffectReceipt 真实 journal ref；五类 egress 证明齐全 | stage1 root/runtime tests + comms replay/compare |
| G3 | Stage 2 DCS 链 | ContextRef（user intent/task ledger/tool result）无 payload；snapshot 冻结全字段；plan selected/omitted/order/why 可解释并 seal；evidence 经现有 ReceiptStore 可查询；Provider Guard 不做直接 mutation | stage2 root/runtime tests + 静态扫描 |
| G4 | Stage 3 Working Context | 只 append 现有 events.jsonl；proposal/accept/reject actor 与 policy digest 完整；重复/过期/版本冲突 fail-closed；fork/handoff 只拷贝 copyFields；无 Mem 写入；flag off 零读写且字节不变 | stage3 root/runtime tests + task-ledger 回归 |
| G5 | Stage 4 Grant 权威 | 仅 `execution_started` + `approved` 派生；deny 先于 executor；完整祖先链 root-first；重启不可恢复；审计 issue/deny/revoke 可查询；Stage 1/3 回归保持绿色 | stage4 root/runtime tests + 回归命令 |
| G6 | Stage 5 Memory/Packer | 唯一 durable memory 写入边界；五个兼容工具名统一 facade；Memory 无 DCS 决策权；unit-aware packer 不前缀截断 critical/constraint/evidence；flag off 字节/工具集不变 | stage5 root/runtime tests + 静态扫描 |
| G7 | Stage 6 解释面板 | 只读投影；diff/why/simulation/replay 语义正确；simulation dry-run 零 host 调用；replay 无 effect；reason/decision 四语；无 ipcRenderer/direct Gateway | stage6 contracts + E2E + i18n |
| G8 | 跨阶段不变量 | 同一域只有一个权威：不新增第二 context/权限/审批/effect/memory 权威；子 agent 权限 ≤ 父；纯函数同输入 deep-equal；无 wall-clock/random；默认 off 能力 flag off 零行为变化 | 全阶段源码扫描 + contracts |
| G9 | 脱敏与安全 | 任何 projection/evidence/receipt 不含 raw prompt/tool output/凭据/环境值；Receipt 只存 digest/ref | 全阶段 fixtures + evidence 扫描 |
| G10 | 真实 E4 与 soak | Stage 1/2/3/5 真实 provider 证据存在且 digest/ref-only；Stage 5 L7 soak 按 S1–S6 完成并达标；synthetic/cached 不得晋升 | evidence JSON + 真实 run 记录 + soak 指标 |
| G11 | 全量工程门禁 | §3.2 全部 exit 0；§3.4（如授权）全部 exit 0 或失败被正确归类 | 命令 exit code 表 |
| G12 | 产品锁与卫生 | `defaultOn=false` / `liveReady=false` / `productApproved=false`；DEEPSEEK_API_KEY 三作用域 absent；`sk-[a-f0-9]{32}` 工作树扫描 0；无 commit/push/PR；HEAD 不变 | §6 命令输出 |

GA 最终组合判定：

- `ga-ready` = G0–G12 全 PASS + A1–A5 齐全 + 全量回归无 DCS 相关失败 + 剩余问题为空。
- `ga-ready-with-findings` = 硬门禁全 PASS，仅存在已记录且 owner 接受的既有观察项。
- `blocked` = 任一 G 失败或任一 A2/A3/A4 关键输入缺失。

> G0–G12 全 PASS 只说明“具备进入 GA 的工程条件”。真正 GA 仍需 owner 执行 §2.1 的发布决策并显式处理产品锁；verifier 不得把 `ga-ready` 写成“GA 已上线”。

## 5. 独立对抗探针（运行后必须删除）

除开发测试外，verifier 必须创建并运行以下临时 Vitest/脚本探针，全部通过后删除，最终 `git status --short` 与验收开始时逐行一致：

| 探针 | 反例覆盖 | 必须断言 |
|---|---|---|
| P0 六 artifact schema | 每个 schema 注入 payload/prompt/tool output/credential 字段 | `normalize*` 拒绝未知/禁止字段，或 strict schema fail；合法 fixture 通过 |
| P1 Provider Guard/Guard 边界 | flag off 与 flag on 发送字节一致；denied/expired/跨资源 grant | 字节 deep-equal；拒绝零副作用；effect outcome 为 not_applied |
| P2 DCS 确定性/直接 mutation | 同一输入两次 compile；缺失 user intent；Provider Guard 路径调用 DCS 编译/直接改 system prompt | snapshotId/planId/digest/decisions deep-equal；缺失 ref fail-closed；静态 grep 直接 mutation=0 |
| P3 Working Context 反例 | 重复 accept、过期 accept、跨 actor 同字段冲突、fork 未授权字段 | 全部 fail-closed/冲突集可查询；flag off 字节不变 |
| P4 Grant 祖先链/审计 | root->mid->leaf，root revoked 后 leaf deny；issue/revoke actorChain | leaf deny；actorChain root-first `[root, mid, leaf]`；listDenials/listRevocations 可查询 |
| P5 Packer 反例 | critical/constraint/evidence 超窗；非法/重复 unit；分数/负数 token；flag off | 显式 fail/降级 reason，不前缀截断；非法输入 pre-decision reject；flag off 字节不变 |
| P6 Stage 6 全反例（复用复验 A–F） | diff overlap/order、simulation 非法输入、replay 含 SECRET_PROMPT、renderer transport、i18n 键集合 | `selected-omitted-overlap`/`order-mismatch`/`invalid-candidate`；无 `snapshotDigest`；`effectsReplayed=false`、`rawPayloadIncluded=false`；grep 0 命中；四语键一致 |
| P7 产品锁/密钥/范围 | 对全 dirty diff 新增行 grep 产品锁；真实 key 样例 | 新增行 0 命中；`sk-[a-f0-9]{32}` 0；三作用域 key absent |
| P8 GA 证据解析 | 对 `artifacts/context-control-plane/*.json` 递归扫描 key/prompt/tool params | 0 命中敏感字段；JSON 可解析；runId/digest/ref 可查询 |

全部探针删除确认后，再执行一次 `git status --short` 并 diff 验收开始快照。探针残留 => `blocked`。

## 6. 产品锁 / 密钥 / 卫生复核命令

```bash
# 1) Stage 0–6（+soak）新增/修改生产文件与 git diff 新增行，产品锁字段 0 命中
git diff --unified=0 | grep '^+' | grep -v '^+++' | grep -nE 'defaultOn|liveReady|productApproved' || echo '0 hits'

# 2) 工作树精确扫描（tracked + untracked）
git ls-files -co --exclude-standard -z | xargs -0 grep -HIE 'sk-[a-f0-9]{32}' 2>/dev/null || echo '0 hits'

# 3) DEEPSEEK_API_KEY 三作用域
node -e 'console.log(process.env.DEEPSEEK_API_KEY === undefined ? "absent" : "PRESENT")'
reg query 'HKCU\Environment' /v DEEPSEEK_API_KEY 2>/dev/null || echo 'absent'
reg query 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' /v DEEPSEEK_API_KEY 2>/dev/null || echo 'absent'

# 4) 提交卫生
git log -1 --oneline
git status --short
```

任何产品锁字段变化、key 命中、sk 命中、新 commit => `blocked`。

## 7. 停止条件

- 任一硬门禁失败：记录失败证据，停止，输出 `blocked`，不修代码。
- 发现范围外生产改动：停止并记录。
- 发现真实 provider 证据是 synthetic/cached：停止并记录 `blocked`。
- A2/A3/A4 缺失且 owner 未授权豁免：停止在 `blocked`（可保留已通过的工程门禁记录）。
- 发现 key 被写入文件/env/DEVLOG：立即停止，判 `blocked`。
- 不得自行创建 Stage 7 spec/代码、不得扩展 DCS 范围。

## 8. 输出要求（必须追加 DEVLOG）

追加到 `docs/dev/context-control-plane/DEVLOG.zh-CN.md`，内容至少包括：

1. HEAD SHA、分支、dirty patch 摘要（行数 + 阶段面 + 与开始时快照一致性）。
2. owner A1–A5 提供情况（缺项逐条列出）。
3. Phase A–E 每类命令 exit code 与关键输出摘要。
4. G0–G12 逐项 PASS/FAIL + 证据（测试文件/命令/探针名）。
5. Stage 5 L7 soak 状态：spec 是否存在、S1–S6 阈值、样本数、指标 vs 阈值、evidence 路径。
6. 真实 provider E4 状态：哪些 run PASS/skipped、证据文件核对、无 synthetic 晋升。
7. 独立探针 P0–P8 记录，含删除确认与最终 `git status --short` 快照一致证明。
8. 产品锁、密钥三作用域、`sk-[a-f0-9]{32}` 扫描、commit/push/PR 复核。
9. 全量回归失败分类（如有）：DCS 相关 / 基线既有 / owner 接受状态。
10. 最终 verdict：只允许 `ga-ready` / `ga-ready-with-findings` / `blocked`，并附“是否可进入真正 GA 仍需 owner 发布决策”的明确结论。

## 9. 本提示词边界

- 本提示词是验收测试基准，不替代任何 Stage 0–6 单阶段验收提示词；单阶段已有 verdict 在本轮仍作为输入事实，但全量验收必须重新执行该阶段全部门禁作为回归。
- 本提示词不承诺“仅凭工程全绿即可 GA”；E4 真实证据、soak 数值、产品锁决策与 owner 发布授权缺一不可。
- 本提示词不授权任何生产代码修改、产品锁翻转、commit/push/PR 或真实 provider 越权调用。
