# KS-04～KS-06 串行开发任务提示词（可直接粘贴给下一个 Agent）

> 适用工作树：`D:\verse_claw_worktree_knowledge`
> 分支：`codex/knowledge-system-unification-plan`
> 基线 HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
> 当前唯一可启动节点：`TF-0075` / KS-04 Chat/DCS 单一消费路径
> 执行模式：**严格串行，一次只允许一个 KS 包 in_progress**；KS-05 必须在 KS-04 验收并获用户确认后启动，KS-06 同理。

## 0. 角色与总则

你是 Verse Claw 统一知识系统 KS-04～KS-06 的串行开发执行者。你的职责是按本地文档与 Harness task spec 实现并自验，**不伪造验收、不补测冒充通过、不把全仓基线红改成“全绿”**。

硬性规则：

1. 不修改 product locks（`liveReady=false`、`productApproved=false`、`defaultOn=false`）。
2. 不打开普通 Chat auto-capture、SEKB auto-writeback、Runtime Memory persist/inject。
3. 不直接编辑 `.agent-workbench/task-forest/graph/nodes.json` 或 `edges.json`；Task Forest 变更必须走 `proposal-save -> 用户确认 -> proposal-apply -> validate -> export`。
4. 每个 KS 包必须先创建独立 Harness task spec，并让 spec 的 `requiredTests`、`touchedAreas`、`acceptance` 与该包真实 diff 对齐。
5. 每包完成并生成 evidence 后**停止**，等待用户确认再启动下一包；不得提前写 KS-05/06 生产代码为 KS-04 补洞。
6. 未获用户明确确认前不 commit、不 push、不启动下一节点、不修改 product locks。
7. 只修复本包 ownedPaths/touchedAreas 内的问题；发现无关 coding-runtime / goal-loop / SLCP / VerseShell 等其他 workstream 红项时记录 residual，不得顺手扩大范围。

## 1. 本地参考文档（逐项阅读，不跳读）

### 1.1 全局必读

1. `D:\verse_claw_worktree_knowledge\AGENTS.md`
2. `D:\verse_claw_worktree_knowledge\docs\dev\Sustained-Development-Playbook.md`
3. `D:\verse_claw_worktree_knowledge\WORKTREE.md`
4. `D:\verse_claw_worktree_knowledge\docs\dev\knowledge-system-unification-development-plan.zh-CN.md`
   - 重点：§0.2 最终架构决策、§2 目标架构、§3 统一契约、§4 生命周期、§8 严格串行路线、§9 的 KS-04/05/06、§11 质量门禁、§12 测试命令、§15 执行协议、§16 DoD
5. `D:\verse_claw_worktree_knowledge\docs\dev\adr\2026-08-17-knowledge-system-unification-authority.md`
6. `D:\verse_claw_worktree_knowledge\docs\dev\unified-agent-system\runtime-convergence\STATUS.md`
7. `D:\verse_claw_worktree_knowledge\docs\dev\handoffs\LATEST.md`（只以顶部 KS 段为当前状态；其下历史段仅作背景，不作为当前授权）
8. `D:\verse_claw_worktree_knowledge\docs\dev\NEXT-GOAL.md`
9. 已验收 spec（作为 spec 模板与兼容边界）：
   - `D:\verse_claw_worktree_knowledge\harness\specs\tasks\knowledge-system-ks01-review-bundle-integrity.md`
   - `D:\verse_claw_worktree_knowledge\harness\specs\tasks\knowledge-system-ks02-experience-session-truth.md`
   - `D:\verse_claw_worktree_knowledge\harness\specs\tasks\knowledge-system-ks03-governance-store-adapters.md`
10. 已验收证据：
    - `D:\verse_claw_worktree_knowledge\docs\dev\knowledge-system-unification\evidence\KS-01-03-ACCEPTANCE.md`
    - `D:\verse_claw_worktree_knowledge\docs\dev\knowledge-system-unification\evidence\KS-00-03-INDEPENDENT-ACCEPTANCE.md`

### 1.2 权威性区分（重要）

- **实施授权来源**：总规划 KS-00..KS-09 + ADR-2026-08-17 + 已验收 KS-00..03 证据。
- **仅作参考/历史，不自我授权**：
  - `D:\verse_claw_worktree_knowledge\docs\dev\adr\2026-08-16-context-authority-boundaries.md`（状态 `proposed`）
  - `D:\verse_claw_worktree_knowledge\docs\dev\context-capability-blueprint.md`（状态 `draft-rev2`，明确“仍未授权实施”）
  - `D:\verse_claw_worktree_knowledge\docs\dev\adr\2026-08-16-session-lifecycle-authority.md`（状态 `proposed`）
  - `D:\verse_claw_worktree_knowledge\docs\dev\session-lifecycle-control-plane\DESIGN.zh-CN.md`（draft）
  - `D:\verse_claw_worktree_knowledge\docs\dev\unified-agent-system\runtime-convergence\` 下历史程序文档（STATUS.md 为已接受状态记录，可引用；TARGET-ARCHITECTURE 等不覆盖总规划）
  - 以上文件用于理解边界和既有机制，若与总规划/ADR-2026-08-17 冲突，以总规划/ADR-2026-08-17 为准。

### 1.3 KS-04 本地参考文档

- `D:\verse_claw_worktree_knowledge\docs\dev\context-orchestrator.md`
- `D:\verse_claw_worktree_knowledge\docs\dev\default-config-matrix.md`
- `D:\verse_claw_worktree_knowledge\docs\dev\dcs-visible-production\README.md`
- `D:\verse_claw_worktree_knowledge\docs\dev\dcs-visible-production\STATUS.md`
- 源码现状（先读后改）：
  - `D:\verse_claw_worktree_knowledge\shared\chat\types.ts`
  - `D:\verse_claw_worktree_knowledge\electron\services\chat-api.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\context-engine\context-orchestrator.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\context-engine\context-candidate.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\context-engine\seal-registry.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\context-engine\rc03-seal-hook.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\context-engine\dcs-receipts.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\agents\prompt-governance\prompt-assembly-ledger.ts`
- 既有测试：`tests\unit\chat-knowledge-scope.test.ts`、`tests\unit\chat-save-to-knowledge.test.tsx`、`openclaw_runtime\src\context-engine\context-orchestrator.test.ts`、`context-candidate.test.ts`、`rc03-seal*.test.ts`

### 1.4 KS-05 本地参考文档

- `D:\verse_claw_worktree_knowledge\docs\dev\sekb-golden-path.md`
- `D:\verse_claw_worktree_knowledge\docs\dev\dcs-visible-production\P1-05-SEKB-HUMAN-CONFIRM.md`
- `D:\verse_claw_worktree_knowledge\docs\dev\session-workstreams-design.md`
- 源码现状：
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\distillation-tool.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\batch-distillation-assistant.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\knowledge-store.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\retrieval-engine.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\experience-block-bridge.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\sekb\golden-path.ts`
- 既有测试：`openclaw_runtime\src\knowledge\sekb\golden-path.test.ts`、`experience-block-bridge.test.ts`、`sekb.test.ts`、`batch-distillation-assistant.test.ts`、`phase-c-would-trigger.test.ts`；根侧 `tests\unit\sekb-confirm-provenance-p3-002.test.ts`

### 1.5 KS-06 本地参考文档

- `D:\verse_claw_worktree_knowledge\docs\dev\knowledge-system-unification-development-plan.zh-CN.md` §4.1/§4.2 生命周期与修正/合并/回滚
- `D:\verse_claw_worktree_knowledge\docs\dev\adr\2026-08-16-session-lifecycle-authority.md`（仅参考，proposed）
- `D:\verse_claw_worktree_knowledge\docs\dev\session-lifecycle-control-plane\DESIGN.zh-CN.md`（仅参考，draft）
- 源码现状：
  - `D:\verse_claw_worktree_knowledge\shared\knowledge\governance-contract.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\governance-store.ts`
  - `D:\verse_claw_worktree_knowledge\openclaw_runtime\src\knowledge\governance-adapters.ts`
  - `D:\verse_claw_worktree_knowledge\electron\services\knowledge-api.ts`
  - `D:\verse_claw_worktree_knowledge\src\pages\Knowledge\index.tsx`
  - `D:\verse_claw_worktree_knowledge\shared\host-api\contract.ts`、`src\lib\host-api.ts`
- 既有测试：`tests\unit\knowledge-api.test.ts`、`tests\unit\knowledge-page.test.tsx`、`openclaw_runtime\src\knowledge\governance-store.test.ts`、`governance-adapters.test.ts`、`tests\e2e\knowledge-hub.spec.ts`

## 2. 当前状态与串行边界

- Task Forest canonical：TF-0010/TF-0038 done(100%)，TF-0070 in_progress(40%)，TF-0071..TF-0074 done(100%)，TF-0075 / KS-04 ready(0%)，TF-0076/0077 blocked。
- 唯一可启动节点是 TF-0075 / KS-04。任何情况下不得同时启动 KS-05、KS-06 或其他 ready 程序线。
- 已知全仓 baseline residual（允许失败，但不许说成全绿）：全仓 lint 有非 KS error；全量 `pnpm test` 有 VerseShell/UAS/RC/first-product-claims/git-api/host-services/fakecoding/config-schema 等 baseline 红。每包验收只要求“本包 changed files 与 focused tests 全绿”。

## 3. 每包统一执行协议

按顺序执行，任一硬门禁失败即停止并记录，不修复后继续冒充通过：

1. 创建本包 task spec：`D:\verse_claw_worktree_knowledge\harness\specs\tasks\knowledge-system-ks0X-*.md`（id 与文件名一致）。
2. 运行 `pnpm harness context --spec <spec>` 与 `pnpm harness validate --spec <spec>`；KS-04/05/06 的 validate 不得使用 `--no-diff`。
3. 先写/更新失败测试（RED），再实现生产代码；测试必须是行为断言，不用恒真/空输出冒充。
4. 实现严格限制在 spec `ownedPaths`/`touchedAreas`；任何新 UI 文案必须走 en/zh/ja/ru i18n；任何 renderer/Main 交互只能走 host-api。
5. 运行本包 requiredTests + 跨包门禁（见 §7）。
6. 写本包 evidence 到 `docs\dev\knowledge-system-unification\evidence\`，并同步 `WORKTREE.md`、`docs\dev\handoffs\LATEST.md` 顶部、`docs\dev\NEXT-GOAL.md`。
7. 通过 Task Forest CLI 保存本包 proposal（不要直接改 graph），**等用户确认后再 apply**；apply 后 validate/export。
8. 输出包级验收报告并停止，等待用户明确确认下一包。

禁止：

- 为下一包预先改生产代码或测试。
- 修改 KS-00..03 已验收 spec/evidence 以外围无关内容。
- 通过扩大 `touchedAreas` 吞并无关 dirty files 来让 harness validate 通过。
- 引入第二个 active memory writer、JSON governance 双写、新 DB/sidecar/向量库/第二 context authority。
- 把 E2E/单测/构建通过外推为 GA、default-on、productApproved 或真人采用证据。

## 4. KS-04：Chat/DCS 单一消费路径（TF-0075）

- Spec 建议文件名：`harness\specs\tasks\knowledge-system-ks04-chat-dcs-single-path.md`
- Evidence 建议文件名：`docs\dev\knowledge-system-unification\evidence\KS-04-CHAT-DCS-ACCEPTANCE.md`
- `taskType: runtime-bridge`，`scenario: gateway-backend-communication`，`requiredProfiles: fast + comms`。
- 必备 rules：`backend-communication-boundary`、`contract-first-boundary`、`renderer-main-boundary`、`docs-sync`、`comms-regression`、`capability-owner-resolution`。

### 4.1 目标（总规划 §9 KS-04）

1. Chat reference payload 只携带 typed ref（`ChatKnowledgeReference` 等），不携带可信正文。
2. Host 将 renderer 传入 refs 转成 **untrusted read-only retrieval intent**，不得在 Main 直接拼接正文进 prompt。
3. Owner adapters（KS-03 注册的 memory-wiki / Role Memory / SEKB）解析 refs；DCS 统一 admission/resolve/pack；Provider Guard 之后无未登记 prompt mutation。
4. role-spawn、memory pilot、COMPASS direct prompt addition 等旧旁路迁移为 `PromptContribution` / declared transform，或明确关闭并记录。
5. pinned ref 被权限/敏感级/失效拒绝时必须产生用户可见 reason；不得静默丢弃。
6. `ContextReceipt` 与 `WireReceipt` 必须能证明 selected/delivered；保留 KS-02 的 `persisted/journaled_degraded/rejected/not_attempted` 真值口径。

### 4.2 KS-04 硬验收

- 黄金 Chat turn 未登记 semantic mutation = **0**（以 `rc03-seal-hook` / `seal-registry` / `prompt-assembly-ledger` 可执行断言为准，不用正则伪证）。
- pinned active ref 解析/selected/delivered = **100%**（测试用真实 owner adapter fixture 与 DCS 生产路径，不用 mock-only 结论）。
- revoked / ACL denied / stale ref delivered = **0**，且返回可见 reason。
- renderer direct IPC/Gateway fetch = **0**（静态 grep 检查 + 既有 facade 测试继续全绿）。
- `pnpm run comms:replay` 与 `comms:compare` PASS。
- 既有相关测试不得回退：`tests\unit\chat-knowledge-scope.test.ts`、`tests\unit\chat-save-to-knowledge.test.tsx`、`tests\unit\host-api-facade.test.ts`、`openclaw_runtime\src\context-engine\context-orchestrator.test.ts`、`context-candidate.test.ts`、`rc03-seal*.test.ts`；本包新测试必须覆盖 ref 拒绝 reason 与 receipt 断言。
- 如 UI 行为变化，必须有 Electron E2E（优先扩展现有 `tests\e2e\knowledge-hub.spec.ts` 或新建 `knowledge-ks04-chat-dcs.spec.ts`）；执行前 `unset ELECTRON_RUN_AS_NODE`。

## 5. KS-05：经验闭环（TF-0076，KS-04 验收并获用户确认后）

- Spec 建议文件名：`harness\specs\tasks\knowledge-system-ks05-experience-closed-loop.md`
- Evidence 建议文件名：`docs\dev\knowledge-system-unification\evidence\KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md`
- `taskType: runtime-bridge`，`scenario: gateway-backend-communication`，`requiredProfiles: fast + comms`。

### 5.1 目标（总规划 §9 KS-05）

闭环必须是可执行 E2E：

```text
失败任务
  -> redacted trajectory
  -> deterministic gate（reusability/uniqueness/confidence/temporality）
  -> experience candidate（进入 Inbox，不直接写 Principle）
  -> duplicate/conflict 检测
  -> human confirm/reject（人工显式操作）
  -> next fresh session 经 KS-04 单一路径召回 Principle
  -> answer cites Principle
  -> task outcome / cited / adopted 记录
  -> effectiveness update
  -> session delete/revoke 后不再召回
```

### 5.2 KS-05 硬验收

- 未确认 suggestion durable write = **0**（继续证明 `suggest_principles_from_trajectories` 不调用 sink/store 写 Principle/Block）。
- 自动 Principle writeback = **0**；confirm/reject 必须人工显式操作。
- 无证据 adoption = **0**：`record_adoption` 只能由真实 cited/adopted/outcome 证据触发，不得用 `retrieval_count` 代替。
- 一条真实 SQLite 级 E2E：失败任务 -> candidate -> human confirm -> fresh session recall -> citation -> outcome -> effectiveness 变化。
- 删除/revoke 后 fresh session 不得召回旧 experience；复用 KS-02 cascade 与 BlockStore residual=0。
- Runtime Memory 仍 shadow/benchmark，不参与 active answer；SEKB Principle 是 canonical，DCS experience Block 只是可重建投影。
- 如触及通信/context 路径，`comms:replay/compare` 必须 PASS。

## 6. KS-06：完整治理生命周期（TF-0077，KS-05 验收并获用户确认后）

- Spec 建议文件名：`harness\specs\tasks\knowledge-system-ks06-governance-lifecycle.md`
- Evidence 建议文件名：`docs\dev\knowledge-system-unification\evidence\KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md`
- `taskType: runtime-bridge`，`scenario: gateway-backend-communication`，`requiredProfiles: fast + comms`。

### 6.1 目标（总规划 §9 KS-06）

实现 create/update/merge/archive/revoke/delete/restore 的 owner-specific mutation plan。每种 operation 必须具备：

1. preview/diff
2. policy decision
3. user confirmation
4. expectedRevision CAS
5. idempotency
6. EffectReceipt
7. projection invalidation/rebuild
8. compensation 或“不可恢复”说明
9. E2E

实现前 UI 不得显示未支持 operation；已支持 operation 必须与 Host contract 一致。继续遵守 KS-03：GovernanceStore 单写，legacy JSON 只读，禁止 dual-write。

### 6.2 KS-06 硬验收

- update/merge/archive/revoke/delete/restore 每种 operation 至少一条真实 SQLite + UI 路径 E2E。
- stale revision / digest 被接受 = **0**；同 idempotencyKey 同 digest duplicate success，异 digest conflict。
- UI 不得出现未实现 operation 的可用入口（静态 grep + E2E 双重证明）。
- delete/revoke 后 DCS projection residual = **0**；复用 KS-02 finalizer 与 BlockStore enumerate/delete。
- 每种 operation 有 EffectReceipt 或明确不可恢复说明；补偿路径必须有反例测试。
- 不新增 JSON governance writer；不注册第二 active memory writer。
- 如 schema 变更，`pnpm --dir openclaw_runtime db:kysely:check` 必须 exit 0。

## 7. 每包跨包门禁（按顺序）

```bash
cd /d/verse_claw_worktree_knowledge
git status --short --branch
git log --oneline -1
git diff --check

pnpm harness context --spec harness/specs/tasks/<active-spec>.md
pnpm harness validate --spec harness/specs/tasks/<active-spec>.md

pnpm exec vitest run <root focused tests>
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run \
  --config test/vitest/vitest.unit.config.ts <runtime focused tests>

pnpm run test:dcs
pnpm run typecheck
pnpm contract:check
pnpm --dir openclaw_runtime db:kysely:check

pnpm run build:vite
pnpm --dir openclaw_runtime build

pnpm run comms:replay
pnpm run comms:compare

pnpm exec eslint <all changed TS/TSX files>
git diff --check
```

- KS-04/05/06 `harness validate` 一律不带 `--no-diff`。
- UI 变更时必须补 E2E：`unset ELECTRON_RUN_AS_NODE; pnpm run test:e2e:run tests/e2e/<spec>.ts`。
- typecheck 只以 node/web `exitCode=0` 与 `success:true` 为准；`testTypes` 是 observation-only。
- changed-file ESLint 必须 0 errors；warnings 逐条列出并判断是否本包新增。
- 全仓 `pnpm run lint:check` 与全量 `pnpm test` 只作诚实 residual 复核；已知 baseline 红不得写成“全绿”，也不得顺手修非本包红。

## 8. 停止条件（触发即 FAIL，不得修复后继续）

1. 本包 `harness validate`（不带 `--no-diff`）失败。
2. 本包 RED 测试未先建立、或测试是恒真/空输出/mock-only 伪证。
3. 本包 focused tests、`test:dcs`、typecheck node/web、contract check、db check、build:vite、runtime build、必要 E2E、必要 comms 任一失败。
4. 黄金 Chat turn 出现未登记 semantic mutation。
5. renderer 出现 direct IPC / Gateway HTTP 旁路。
6. SEKB 出现自动 writeback、未确认 durable write、无证据 adoption。
7. Governance 出现 JSON dual-write、第二个 active memory writer、stale CAS 被接受。
8. UI 出现未支持 operation 入口或 ref 拒绝无 reason。
9. 出现 default-on / GA / productApproved / liveReady=true 或 E2E=生产采用的表述。
10. 把全仓 lint/test baseline 红改口为“全绿”。

## 9. 每包交付物与报告格式

每个 KS 包完成后必须输出：

```markdown
# KS-0X <标题> 验收报告

- 执行者：
- 时间 / HEAD / 分支：
- 本包 spec 与 evidence 路径：
- 变更文件归属：只列本包 ownedPaths/touchedAreas

## 硬验收矩阵
（期望 / 实际 / 测试或源码证据路径）

## 门禁记录
（命令、退出码、关键输出）

## Honest residual
（全仓 lint / 全量 test 红项；证明与本包无关）

## 产品锁
liveReady / productApproved / defaultOn / auto-capture /
auto-writeback / Runtime Memory persist+inject

## Task Forest
本节点 done 后，下一节点是否 ready；是否已 proposal-apply 并经用户确认

## 结论
仅允许：本包 ACCEPT / 本包 REJECT + 原因 + 证据
```

Task Forest proposal 必须 `proposal-save` 后等待用户确认；用户确认前不 apply、不启动下一包、不 commit、不改 product locks。
