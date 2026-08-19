# KS-07～KS-09 串行开发任务提示词（可直接粘贴给下一个 Agent）

> 适用工作树：`D:\verse_claw_worktree_knowledge`
> 分支：`codex/knowledge-system-unification-plan`
> 基线 HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
> 当前唯一 ready 节点：`TF-0078` / KS-07 Semantic Retrieval & Source Set
> 执行模式：**严格串行，一次只允许一个 KS 包 in_progress**；KS-08 必须在 KS-07 验收并获用户确认后启动，KS-09 同理。
> 本提示词是 KS-07、KS-08、KS-09 三个独立开发包的三段式入口；下一 Agent 只能先执行 KS-07，不得预写 KS-08/KS-09 生产代码。

## 0. 角色与总则

你是 Verse Claw 统一知识系统 KS-07～KS-09 的串行开发执行者。当前 KS-00～KS-06 已验收（KS-06 已按方案 B 运行时权威收口，Task Forest `TFP-c250f2cbab` 已 apply）。你的职责是按本地总规划与每包独立 Harness task spec 实现并自验，**不伪造验收、不把全仓 baseline 红改口成“全绿”、不把 E1-E3 证据外推成 E4/E5 或 GA**。

硬性规则：

1. 不修改 product locks：`liveReady=false`、`productApproved=false`、`defaultOn=false`；不打开普通 Chat auto-capture、SEKB auto-writeback、Runtime Memory persist/inject。
2. 严格串行：当前只允许启动 `TF-0078` / KS-07。KS-08 只能在 KS-07 验收报告获用户确认、Task Forest proposal 已 apply 后启动；KS-09 同理。
3. 不直接编辑 `.agent-workbench/task-forest/graph/nodes.json` 或 `edges.json`；Task Forest 变更只走 CLI：`proposal-save -> 用户确认 -> proposal-apply -> validate -> export`。
4. 每个 KS 包必须创建独立 Harness task spec，并让 `requiredTests`、`touchedAreas`、`acceptance`、`residual` 与该包真实 diff 对齐；`harness validate` 不得使用 `--no-diff`。
5. 先写 RED 测试再实现；测试必须是行为断言，不得用恒真/空输出/mock-only 结论冒充通过。
6. 每包完成并生成 evidence 后**停止等待用户确认**；未确认前不 apply proposal、不启动下一节点、不 commit、不 push。
7. 只修复本包 touchedAreas 内问题；VerseShell/UAS/RC/FP/FakeCoding/git-api/host-services 等非 KS 红项只记录 residual，不顺手扩大范围。
8. 不新增第二 context authority、第二 active memory writer、JSON governance 双写、新 DB/sidecar/向量库；不把 Runtime Memory 变成 active writer。
9. 任何 renderer/Main 交互只走 host-api/api-client；任何用户可见 UI 改动必须 en/zh/ja/ru i18n + Electron E2E。

## 1. 当前状态与串行边界

- Task Forest canonical：TF-0077 / KS-06 `done` 100%；TF-0078 / KS-07 `ready` 0%；TF-0079 / KS-08 `proposed`；TF-0080 / KS-09 `proposed`；TF-0070 milestone `in_progress` 70%。
- **唯一可启动节点是 TF-0078 / KS-07**。不得同时启动 KS-08、KS-09。
- KS-06 honest residual 的两项强制 carry-over 属于 KS-08，KS-07 不得借“顺手”提前实现：
  1. memory-wiki `wiki.*` 生命周期 Main RPC（update/merge/archive/revoke/delete/restore）；
  2. Knowledge 页面 lifecycle UI + 每种已支持 operation 至少 1 条 Electron E2E。
- 已知全仓 baseline residual（每包只照实复核，不修复、不宣称全绿）：全仓 `pnpm run lint:check` 当前 exit 1（3 errors / 126 warnings，均在非 KS 文件）；全仓 `pnpm test` 当前 exit 1（21 failed files / 31 failed tests，均在非 KS 文件）。

## 2. 本地必读文档

按顺序阅读：

1. `D:\verse_claw_worktree_knowledge\AGENTS.md`
2. `D:\verse_claw_worktree_knowledge\WORKTREE.md`
3. `D:\verse_claw_worktree_knowledge\docs\dev\handoffs\LATEST.md`（只以顶部 KS-06 收尾段为当前状态；历史段仅作背景）
4. `D:\verse_claw_worktree_knowledge\docs\dev\NEXT-GOAL.md`
5. `D:\verse_claw_worktree_knowledge\docs\dev\knowledge-system-unification-development-plan.zh-CN.md`
   - 重点：§0 执行裁决、§2 目标架构、§3 统一契约、§9 KS-07/08/09、§11 质量门禁、§15 执行协议、§16 DoD
6. `D:\verse_claw_worktree_knowledge\docs\dev\adr\2026-08-17-knowledge-system-unification-authority.md`
7. 已验收 KS spec 与 evidence（作为 spec 模板和兼容边界）：
   - `harness\specs\tasks\knowledge-system-ks04-chat-dcs-single-path.md`
   - `harness\specs\tasks\knowledge-system-ks05-experience-closed-loop.md`
   - `harness\specs\tasks\knowledge-system-ks06-governance-lifecycle.md`
   - `docs\dev\knowledge-system-unification\evidence\KS-04-CHAT-DCS-ACCEPTANCE.md`
   - `docs\dev\knowledge-system-unification\evidence\KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md`
   - `docs\dev\knowledge-system-unification\evidence\KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md`
8. 本文件后续三节中，当前包只读自己那节；下一包的节不得提前执行。

## 3. 每包统一执行协议

1. 确认 Task Forest 只有一个 ready 节点是本包；运行 `pnpm harness context --spec <active-spec>`。
2. 创建/编辑本包 task spec（文件与 `id` 同名），补齐 `intent`、`dependsOn`、`touchedAreas`、`expectedUserBehavior`、`requiredProfiles`、`requiredRules`、`requiredTests`、`acceptance`、`residual`。
3. `pnpm harness validate --spec <active-spec>`（不带 `--no-diff`）必须 PASS。
4. 先建 RED 测试（行为断言、真实 SQLite 或真实 owner fixture），再实现生产代码。
5. 实现严格限制在本包 touchedAreas；新 UI 文案走 en/zh/ja/ru；renderer 只经 host-api；通信路径变更跑 comms。
6. 按 §7 门禁顺序执行；任一硬门禁失败即停止并写 REJECT 证据，不得修完当没失败过。
7. 写本包 evidence 到 `docs\dev\knowledge-system-unification\evidence\`，并同步 `WORKTREE.md`、`docs\dev\handoffs\LATEST.md` 顶部、`docs\dev\NEXT-GOAL.md`、总规划实施状态段。
8. Task Forest 只允许 `proposal-save` 后停止，等待用户确认；用户确认后 `proposal-apply --yes -> validate -> export`。apply 后再次跑本包 harness validate；若 CLI 新生成的 proposal/snapshot 文件被 harness 提示未覆盖，只把这两个 CLI 生成文件补进 spec `touchedAreas` 后复跑，不得用 `touchedAreas` 吞并无关 dirty 文件。
9. 输出包级验收报告并停止。

## 4. KS-07：Semantic Retrieval 与 Source Set（TF-0078）

- Spec：`harness\specs\tasks\knowledge-system-ks07-semantic-retrieval-source-set.md`
- Evidence：`docs\dev\knowledge-system-unification\evidence\KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md`
- 建议 `taskType: runtime-bridge`、`scenario: gateway-backend-communication`、`requiredProfiles: fast + comms`。
- 必备 rules：`contract-first-boundary`、`docs-sync`、`capability-owner-resolution`、`backend-communication-boundary`、`active-config-guards`。

### 4.1 目标（总规划 §9 KS-07）

实现并测试一条 DCS 单一路径上的 Source Set：

- exact / lexical / semantic hybrid retrieval；
- query 按 task context、role/scope shaping，并执行 sensitivity/ACL/status 过滤；
- conflict set 显式披露与 freshness rerank；
- citation-resolvable synthesis（每个 claim 能解析到 owner + subjectId + revision/digest）；
- unknowns 与 suggested next actions 显式输出；
- `grounded / partial / missing_sources` 由证据规则计算，禁止固定 confidence 冒充 grounded；
- Runtime Memory 只做 shadow 比较，不参与 active answer。

### 4.2 边界与实现提示

- SourceSet 是 DCS 派生产物/报告，不是新 canonical store、不是第二 context authority；DCS 仍是唯一 admission/resolve/pack/compile authority。
- 先读现状再改：`openclaw_runtime\src\context-engine\block.ts`、`block-store.ts`、`context-candidate.ts`、`dcs-receipts.ts`、`tools\context-search-tool.ts`、`chat-knowledge-source-adapters.ts`、`runtime-embedding-adapter.ts`、`sekb\retrieval-engine.ts`、`l4-semantic-eval.ts`、`dcs-corpus-schema.ts`、`dcs-corpus-synthetic.ts`。
- 三条检索 lane：
  1. exact：pinned `ContextRef` 的 owner/subjectId/revision 直接解析；
  2. lexical：确定性 token score（沿用现有可测逻辑，不引入新依赖）；
  3. semantic：只走现有 embedding adapter 边界；无 provider 时显式返回 `semantic:unavailable` 并降级 lexical，禁止伪造相似度。
- 每个候选必须带 owner/revision/status；archived/revoked/deleted/denied/stale 一律不得进入 grounded claim，必须进入拒绝原因或 conflict/unknown。
- 质量报告至少包含：Recall@5、Precision@5、citation validity、stale inclusion、conflict disclosure、latency、token cost、human usefulness。前七项用 committed corpus fixture 实测；human usefulness 若无真实用户任务证据，必须写 `not-evaluated (E4 missing)`，不得用 synthetic fixture 填数。

### 4.3 KS-07 硬验收

- 新增 SourceSet 行为测试：同 query 同 fixture 结果确定性；conflict 披露 100%；stale/revoked/denied 进入 grounded 的条数 = 0；`missing_sources` 时不得输出伪 citation。
- committed corpus 质量报告（fixture 路径与 hash 写入 spec touchedAreas/evidence）；Recall@5、Precision@5 等指标有真实计算输出。
- KS-04 回归：explicit pinned ref 解析率 100%；拒绝 ref 有用户可见 reason；既有 `chat-knowledge-scope.test.ts`、`context-orchestrator.test.ts`、`context-candidate.test.ts` 不回退。
- `pnpm run test:dcs` 必须 344/344 或“旧测试无回退 + 本包新增测试全绿”的等价实况；不得删改旧断言来买绿。
- Runtime Memory 仍 shadow-only：不修改注入路径，现有 shadow 相关测试继续通过。
- 不新增 DB/sidecar/向量库；若 semantic lane 依赖现有 adapter，只允许配置/接线，不新增持久化。
- 若本包不产生 UI 变更，则不强制 E2E；若产生任何 UI 变更，必须 i18n + Electron E2E。

### 4.4 KS-07 Task Forest 收尾 proposal 内容

- `TF-0078`：`set_status done 100`，`update_node` 写 spec/evidence/quality-report 路径、next_action、summary。
- `TF-0079`：`set_status ready 0`，summary 写明 KS-08 必须消费两项 KS-06 carry-over + 本包 SourceSet 可见性需求。
- `TF-0070`：`set_status in_progress 80`，summary 更新为 KS-00..KS-07 已实现。
- 不改 TF-0080；保存 proposal 后停止，等待用户确认。

## 5. KS-08：UI 与 Observability 收敛 + KS-06 carry-over（TF-0079）

- Spec：`harness\specs\tasks\knowledge-system-ks08-ui-observability.md`
- Evidence：`docs\dev\knowledge-system-unification\evidence\KS-08-UI-OBSERVABILITY-ACCEPTANCE.md`
- 建议 `taskType: runtime-bridge`、`scenario: gateway-backend-communication`、`requiredProfiles: fast + comms`。
- 必备 rules：`contract-first-boundary`、`docs-sync`、`capability-owner-resolution`、`backend-communication-boundary`、`renderer-main-boundary`、`active-config-guards`。

### 5.1 目标（总规划 §9 KS-08 + KS-06 carry-over）

1. 接入 memory-wiki `wiki.*` 生命周期 Main RPC：update / merge / archive / revoke / delete / restore，并补真实 owner mutation + read-back 证据。
2. Knowledge 页面实现 lifecycle UI：preview/diff、policy decision、用户确认、expectedRevision CAS、幂等、EffectReceipt、补偿/不可恢复说明、receipt history。
3. 统一 Knowledge 三视图、ReviewBundle 操作、Chat why-included、runtime status、degraded write、delete residual、receipt history 全部对用户诚实可见。
4. 所有用户文本走 en/zh/ja/ru i18n；所有 UI 变更必须有 Electron E2E。

### 5.2 边界与实现提示

- 先读现状再改：
  - `electron\services\knowledge-api.ts`（当前 `applyReviewedChange` 对 wiki 只放行 create，且 journal 有 degraded 状态）
  - `shared\host-api\contract.ts` + `src\lib\host-api.ts`（contract-first，两端同步）
  - `src\pages\Knowledge\index.tsx`（UI 入口与当前 hostApi.knowledge 调用）
  - `openclaw_runtime\src\knowledge\governance-adapters.ts`（memory-wiki 是 host-owned stub）
  - `openclaw_runtime\extensions\memory-wiki\src\apply.ts`、`gateway.ts`、`tool.ts`、`query.ts`、`markdown.ts`（真实 wiki mutation owner）
- memory-wiki 的 canonical mutation owner 是 memory-wiki plugin；renderer 不得直接调 RPC/IPC/Gateway。Main 用真实 `wiki.*` RPC 结果注入/替换 KS-06 host-owned adapter，或经同一 governed coordinator 调用；读回必须证明 owner 状态真实变化。
- 每种 operation 必须有：preview/diff、policy decision、用户确认、expectedRevision CAS、idempotencyKey、EffectReceipt、projection invalidation/rebuild、compensation 或显式不可恢复说明。
- 未支持的 operation 继续无可用 UI 入口；实现完六种后若仍有其他未支持面，同样隐藏并写清楚。

### 5.3 KS-08 硬验收

- memory-wiki 六种 lifecycle operation 每种至少一条真实 owner mutation + read-back 测试；stale revision/digest 接受 = 0；同 key 同 digest duplicate success，异 digest conflict。
- 每种已支持 operation 至少 1 条 Electron E2E，覆盖 UI 操作 -> Main -> wiki RPC -> EffectReceipt 可见 -> 页面状态/read-back 变化。
- `tests\e2e\knowledge-hub.spec.ts` 不回退；新增或扩展现有 E2E，不伪造跳过。
- Chat why-included：admitted/denied ref 的 reason 对用户可见；denied ref 不得进入 prompt。
- degraded write 状态与 delete residual、receipt history 在 UI 中可见；不得把 journaled_degraded 显示成 persisted。
- 静态检查：renderer direct IPC/Gateway fetch = 0；不新增第二 active memory writer、不新增 JSON governance 双写。
- `pnpm contract:check`、typecheck node/web、`db:kysely:check`、build:vite、runtime build、comms replay/compare、changed-file ESLint 全部门禁 PASS。
- 所有新增 UI 文案四语 i18n 齐全，ESLint 无本包新增 error。

### 5.4 KS-08 Task Forest 收尾 proposal 内容

- `TF-0079`：`set_status done 100`，`update_node` 写 spec/evidence/E2E 路径、next_action、summary，并明确两项 KS-06 carry-over 已关闭。
- `TF-0080`：`set_status ready 0`，summary 指向 KS-09 Canary/优化/毕业。
- `TF-0070`：`set_status in_progress 90`，summary 更新为 KS-00..KS-08 已实现。
- 保存 proposal 后停止，等待用户确认。

## 6. KS-09：Canary、优化与毕业（TF-0080）

- Spec：`harness\specs\tasks\knowledge-system-ks09-canary-optimization-graduation.md`
- Evidence：`docs\dev\knowledge-system-unification\evidence\KS-09-CANARY-GRADUATION-ACCEPTANCE.md`
- 建议 `taskType: runtime-shadow`、`scenario: system-maturity-traceability`；若实际 diff 必须动 gateway/通信路径，才改用 `runtime-bridge + gateway-backend-communication`，且只能选一组并让 harness validate 通过。
- 必备 rules：`active-config-guards`、`docs-sync`、`system-maturity-traceability`、`capability-owner-resolution`。

### 6.1 目标（总规划 §9 KS-09）

按表面分别评估，任何一个表面通过都不能推出联合系统 GA：

1. explicit/pinned Knowledge refs
2. automatic Knowledge retrieval
3. Role Memory retrieval
4. SEKB experience retrieval
5. semantic Source Set synthesis
6. post-task candidate capture

每个表面独立走：`shadow -> opt-in -> canary -> soak -> product approval -> consider-default-on`。当前 product locks 为 false，本包**不得**自行翻到 opt-in/default-on 以上未经用户授权的档位；`productApproved=true` 只属于后续用户明确产品裁决，不属于本包工程结论。

### 6.2 证据与报告要求

- 每个表面一份报告，至少包含：当前档位、证据等级（E1-E5）、实测指标、residual、下一步门槛、是否允许晋升。
- E1-E3 可用本仓库 committed corpus/unit/integration/E2E；E4 必须是真实 provider/user task 证据；E5 必须是 soak + 产品批准门槛证据。没有 E4/E5 就把该表面写成 `not-evaluated` 或 `blocked`，禁止用 synthetic 数据填补。
- 每个表面的评测集、指标脚本、报告路径写入 spec touchedAreas 与 evidence；报告必须可复跑。
- Runtime Memory 仍 shadow/benchmark；DCS 仍唯一 authority；不新增第二 writer、不新增 DB/sidecar。
- 若修改 canary/graduation decision 代码，必须覆盖 `dcs-canary-c1`、`dcs-graduation-decision` 及既有决策测试，且不得让 `productApproved=false` 时出现 `default-on` 推荐。

### 6.3 KS-09 硬验收

- 六个表面报告齐全，无一缺失；每个表面都有明确档位和证据等级。
- 0 个报告宣称未获批准的 default-on/GA/productApproved；0 个 E3 报告被写成 E4/E5。
- 所有可复跑评测脚本/测试 PASS；typecheck node/web、contract、build、comms、changed-file ESLint PASS。
- 全仓 lint/test baseline 红照实复核；非 KS 红不修复。
- 产品锁仍为 `liveReady=false`、`productApproved=false`、`defaultOn=false`。

### 6.4 KS-09 Task Forest 收尾 proposal 内容

- `TF-0080`：`set_status done 100`，`update_node` 写六份表面报告、evidence、next_action、summary。
- `TF-0070`：`set_status done 100`，summary 写明 KS-00..KS-09 工程闭环完成；default-on/GA 仍是独立产品批准门槛，product locks 保持 false。
- 保存 proposal 后停止，等待用户确认。

## 7. 每包跨包门禁（按顺序，不省略）

```bash
cd /d/verse_claw_worktree_knowledge

git status --short --branch
git log --oneline -1
git diff --check

pnpm harness context --spec harness/specs/tasks/<active-spec>.md
pnpm harness validate --spec harness/specs/tasks/<active-spec>.md

# 本包 runtime focused tests（替换为实际新增/既有文件，禁止用旧绿冒充本包新测试）
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run \
  --config test/vitest/vitest.unit.config.ts <runtime-focused-tests>

# 本包 root focused tests
pnpm exec vitest run <root-focused-tests>

pnpm run test:dcs
pnpm run typecheck
pnpm contract:check
pnpm --dir openclaw_runtime db:kysely:check

pnpm run build:vite
pnpm --dir openclaw_runtime build

pnpm run comms:replay
pnpm run comms:compare

# KS-08 若涉及 UI/E2E：
# unset ELECTRON_RUN_AS_NODE
# pnpm run test:e2e:run tests/e2e/<new-spec>.ts

pnpm exec eslint <all changed TS/TSX files>
git diff --check
```

- `harness validate` 每包都必须不带 `--no-diff`；proposal-apply 后再跑一次（见 §3.8）。
- typecheck 只认 node/web `exitCode=0` 与 `success:true`；`testTypes` 是 observation-only。
- runtime build 若首跑返回 `3221226505`，允许资源释放后复跑，但必须记录首跑失败，不得只写复跑成功。
- changed-file ESLint 必须 0 error；warnings 逐条列出并判断是否本包新增。
- UI 变更必须 E2E；通信路径变更必须 comms replay/compare。

## 8. Honest residual 复核

每包收尾前执行：

```bash
pnpm run lint:check
pnpm test
```

- `lint:check` 当前预期 exit 1：3 errors / 126 warnings，且 3 个 error 在非 KS 文件；以实际运行数为准并写明 error 文件。
- `pnpm test` 允许 baseline 红；记录实际 failed files / failed tests，并逐项确认失败文件均不在本包 changed files 内。不得修复非本包红，不得宣称全仓绿灯。

## 9. 停止条件（触发即 FAIL，不得修复后继续冒充通过）

1. 本包 `harness validate`（不带 `--no-diff`）失败。
2. 本包 RED 测试未先建立，或测试是恒真/空输出/mock-only 伪证。
3. 本包 focused tests、`test:dcs`、typecheck node/web、contract check、db check、build:vite、runtime build、必要 E2E、必要 comms 任一失败。
4. changed-file ESLint 有 error。
5. 发现第二 context authority、第二 active memory writer、JSON governance 双写、新 DB/sidecar/向量库，或 Runtime Memory 进入 active 注入。
6. 任何 report 把 E1-E3 写成 E4/E5，或把未获批准状态写成 default-on/GA/productApproved。
7. 产品锁被改动或 KS-07/08/09 之外范围被扩大。

## 10. 包级验收报告格式

```markdown
# KS-0X <标题> 验收报告

- 执行者：
- 时间 / HEAD / 分支：
- 本包 spec 与 evidence 路径：
- 变更文件归属：

## 硬验收矩阵
## 门禁记录
## Honest residual
## 下一包 carry-over（如有）
## 产品锁
## Task Forest
## 结论
仅允许：KS-0X ACCEPT / KS-0X REJECT + 原因 + 证据
```

## 11. 验收后动作

- 若 ACCEPT：输出报告后停止；不 commit、不 push、不启动下一包。
- 若 REJECT：列出缺口，不自行扩大修复范围，等待用户裁决。
- 产品锁始终不变：`liveReady=false`、`productApproved=false`、`defaultOn=false`。
