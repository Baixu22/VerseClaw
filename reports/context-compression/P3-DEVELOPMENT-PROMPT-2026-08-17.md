# P3 开发提示词：Addressable Recall 与重复压缩防损

> 状态：准备进入 P3，尚未修改 P3 runtime 文件
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P2-EVIDENCE-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 执行 agent。
当前阶段是 P3：让 **每个 critical atom 都可被 addressable recovery 恢复**，
并防止重复压缩造成递归损失。

P3 验收只证明：

- 每个 critical atom 至少有一个可解析的 evidence ref，能够回到
  **archive handle、file hunk 或 CVK selector**；
- missing / stale selector 在 recovery 中**显式失败**，不静默信任；
- 后续 compaction 使用 **atom ledger + 新消息** 重建，而不是只递归摘要
  上一次自然语言摘要；
- stale branch、superseded decision、失败动作重复执行都有 fixture 覆盖；
- legacy transcript replay 继续作为 rollback path。

**不得宣布** token savings、结构化 judge 分数或单模型自评成功。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 1、3、4(P3)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（当前 active spec）
5. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
6. `reports/context-compression/P1-EVIDENCE-2026-08-17.md`
7. `reports/context-compression/P2-EVIDENCE-2026-08-17.md`
8. `docs/context-runtime-kit/phase-constraints/phase-08-recovery-context.md`
9. 以下实际代码，不要根据文件名猜接口：
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`
   - `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
   - `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`
   - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`
   - `openclaw_runtime/src/context-engine/cvk/recovery.ts`
   - `openclaw_runtime/src/context-engine/cvk/recovery-default.ts`
   - `openclaw_runtime/src/context-engine/cvk/resolver.ts`
   - `openclaw_runtime/src/context-engine/cvk/compiler.ts`
   - `openclaw_runtime/src/context-engine/cvk/runtime-adapter.ts`
   - `shared/host-api/contract.ts`
   - `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts`
   - `electron/services/sessions-api.ts`
   - `tests/unit/compression-artifact.test.ts`
   - `tests/unit/context-runtime-kit-compression-artifact.test.ts`
   - `tests/unit/context-runtime-kit-recovery-context.test.ts`
   - `tests/unit/context-runtime-kit-recovery-default.test.ts`

---

## 3. 阶段开始仪式（必须执行）

按顺序执行并记录结果：

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

然后跑 P3 基线（确认 P2 未回归）：

```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=dot
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm contract:check
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
git status --short --branch
```

---

## 4. 硬边界（任何情况下不得违反）

1. 不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。
2. Agent Core compaction、Compaction Safeguard、CompressionArtifact、Context Runtime Kit
   的 authority 保持不变；P3 只是补 evidence/addressability 和 recovery 投影。
3. 自然语言摘要只能是 projection，不能成为事实源；`details.artifact` 是结构化 carrier。
4. 每个 critical atom 必须能回到 transcript、archive handle、file hunk 或 CVK selector；
   不能伪造 evidence ref，不能把无法解析的 ref 标成 verified。
5. missing / stale selector 必须显式失败并产生 diagnostics；禁止静默降级为可信。
6. P3 默认仍 shadow / diagnostics-only：
   - 不新增模型调用、不新增 DeepSeek/judge；
   - 不改变返回 summary；
   - 不 enforce `wouldRetry` / `wouldFallback` / `wouldPreserveTurns`；
   - 不修改 UI/E2E。
7. `CompressionArtifact.schemaVersion` 必须保持 `1`；旧 v1 payload 继续可读。
8. 如果 P3 需要把 CRK optional 字段（`requiredSelectors`、`retrievedContext`、
   `retrievalTrace`、`staleReferences` 等）从 runtime 写入 artifact，必须同步
   agent-core / Gateway `CompressionArtifactSchema` / `shared/host-api/contract.ts` /
   Electron `mapCompressionArtifact` 四处契约；不得只改一边。
9. 不得用 token savings、结构化 judge 分数或单模型自评宣布成功。
10. 不修改 `D:\ClawX` 根工作树的未提交改动；本 worktree 的 P0/P1/P2 未提交改动必须保留。
11. P3 新增 artifact 字段必须 JSON-serializable；不得携带 secrets / API key。
12. legacy transcript replay rollback 必须保留。

---

## 5. 当前接口事实（P3 准备时已核对）

### 5.1 P2 已打通

- `compaction-safeguard.ts` 的 provider / LLM / boundary 三个出口都写
  `details.artifact` 和 `details.validatedPipeline`。
- `buildValidatedCompactionOutput` 已生成 `semanticAtoms`，并为每个 atom 填
  `evidenceRefs`；但当前 runtime evidence 主要是 `session` message id 和
  `file` path，尚未接入 checkpoint archive handle / CVK selector。
- `prepareCompaction` 已提供 `previousArtifact`，P2 的 artifact lineage 已可用。

### 5.2 checkpoint archive 已存在但未进入 artifact

- `captureCompactionCheckpointSnapshotAsync` 会为 pre-compaction transcript 创建
  `ArchiveHandle`，`persistSessionCompactionCheckpoint` 会把 `archiveHandle` 存入
  checkpoint，但该 handle 没有回填到 `details.artifact.semanticAtoms` 的 evidenceRefs。
- `compact.ts` 在调用 extension 拿到 `compactionDetails` 后、持久化 checkpoint 前，
  是回填 archive evidence 的合适位置。

### 5.3 CVK recovery 已具备显式失败能力

- `buildCvkRecoveryContext` 对 missing / stale / checksum mismatch selector 返回
  `missingReferenceDiagnostics` / `staleReferenceDiagnostics`，`ok=false`。
- `buildDefaultCvkRecoveryProjection` 在 CRK Level 2 gate 未通过或 selector 失败时
  fallback 到 legacy，并带 diagnostics。
- 但 runtime compaction artifact 目前很少写入 `requiredSelectors` / `retrievedContext` /
  `retrievalTrace`，所以 CRK recovery 路径尚未从真实 compaction 获得输入。

### 5.4 后续 compaction 仍偏重摘要字符串

- `compaction-safeguard.ts` 的 `prependPreviousSummaryForRedistill` 只把
  `previousSummary` 作为 `<previous-compaction-summary>` 文本注入。
- `previousArtifact.semanticAtoms` 尚未作为结构化 ledger 注入下一轮 summarization；
  这会导致“只递归摘要上一次自然语言摘要”的递归损失风险。

### 5.5 契约现状

- `CompressionEvidenceRef.type` 当前是
  `"session" | "trace" | "file" | "tool" | "task_ledger" | "clawgraph" | "manual" | "other"`，
  没有 `"archive"` / `"cvk"`。
- `CompressionSemanticAtom.source.kind` 已支持 `"cvk"` / `"archive"`。
- Gateway `CompressionArtifactSchema` 和 host contract 已支持 `semanticAtoms`，
  但尚未声明 CRK optional 字段（`requiredSelectors` 等）；P3 如需写入必须同步。

---

## 6. P3 目标接口草案（实现时以测试锁行为，不要照抄猜测）

建议在 `openclaw_runtime/src/agents/agent-hooks/` 或
`openclaw_runtime/src/context-engine/cvk/` 下新增/调整：

```ts
// 地址性 audit：判断 critical atom 是否都有可恢复 evidence
export type CompactionAddressabilityDiagnostic = {
  atomId: string;
  status: "missing_evidence" | "missing_archive" | "missing_selector" | "stale_selector" | "ok";
  evidenceRefs: string[];
  message: string;
};

export function auditCompactionAddressability(params: {
  artifact: CompressionArtifact;
  archiveHandles?: ArchiveHandle[];
  cvkArtifact?: CvkFixtureArtifact;
}): {
  criticalAtomCount: number;
  addressableCount: number;
  diagnostics: CompactionAddressabilityDiagnostic[];
};

// archive evidence 回填：把 checkpoint 的 archive handle 写入 critical atom evidence
export function bindCompactionArchiveEvidence(params: {
  artifact: CompressionArtifact;
  archiveHandle: ArchiveHandle;
  archiveLabel?: string;
}): CompressionArtifact;

// 下一轮 compaction 的 ledger 投影：有 previousArtifact 时用 atom ledger 注入
export function buildPreviousCompactionLedgerMessage(params: {
  previousArtifact?: CompressionArtifact;
  previousSummary?: string;
  maxChars?: number;
}): AgentMessage | undefined;
```

约束：

- `auditCompactionAddressability` 只做 deterministic 检查，不调用模型。
- `bindCompactionArchiveEvidence` 不得删除已有 evidence；对没有 `file`/`archive`/`cvk`
  evidence 的 critical atom 追加 archive ref；已有可恢复 ref 的 atom 不重复追加。
- `buildPreviousCompactionLedgerMessage` 输出 bounded 文本；大段 atom body 不进入 prompt，
  只输出 type / canonicalIdentity / status / text 截断 / evidence ref 摘要。
- 若 P3 需要新增 `CompressionEvidenceRef` 类型（例如 `"archive"` / `"cvk"`）或可选
  `checksum`，必须同步 agent-core、Gateway schema、host contract、Electron mapping。

---

## 7. 先补测试，再实现行为（TDD 顺序）

### 第 1 批：addressability audit（新建或扩展 `compaction-addressability.test.ts`）

1. 无 previousArtifact 的 artifact，critical atom 只有 session ref 时：
   - `auditCompactionAddressability` 能识别 `missing_archive` / `missing_file` /
     `missing_cvk`，不会把 session-only 当成 addressable。
2. 给同一 artifact 绑定 `ArchiveHandle` 后：
   - critical atom 出现 `archive` evidence；
   - `auditCompactionAddressability` 报告 `addressableCount === criticalAtomCount`；
   - JSON round-trip 后仍可读。
3. critical atom 已有 file ref / CVK selector 时：
   - 不重复追加 archive ref；
   - `bindCompactionArchiveEvidence` 保持幂等。
4. missing / stale selector：
   - `auditCompactionAddressability` 对不可解析的 CVK selector 返回
     `missing_selector` / `stale_selector`；
   - recovery 路径继续显式 `ok=false`。

### 第 2 批：checkpoint archive 接线

5. 新增/扩展 `compact.ts` 相关测试或 helper 测试：
   - `checkpointSnapshot.archiveHandle` 存在时，`compactionDetails.artifact` 的
     critical atom evidenceRefs 被回填 archive ref；
   - `archiveHandle` 缺失时保持原 artifact 不变；
   - `details.artifact.schemaVersion === 1` 且 `details.validatedPipeline.schema`
     仍为 `compaction-validated-pipeline/v1`。

### 第 3 批：ledger-first 重建

6. `buildPreviousCompactionLedgerMessage`：
   - 有 `previousArtifact.semanticAtoms` 时返回 ledger 投影消息；
   - 无 artifact 时返回原 `previousSummary` 行为；
   - 输出 bounded，不包含大段 code/tool schema。
7. `compaction-safeguard.ts` 的 `prependPreviousSummaryForRedistill`：
   - 有 previousArtifact 时优先使用 ledger 投影；
   - 无 artifact 时保留 legacy previousSummary 路径；
   - 现有 LLM qualityGuard 行为不变。

### 第 4 批：stale / superseded / repeat fixtures

8. `context-runtime-kit-recovery-context.test.ts` 或新 fixture：
   - stale branch atom 不进入 nextAction；
   - superseded decision atom 保留在 ledger 但标记 `superseded`，不作为 active；
   - 失败动作重复执行 fixture：recovery projection 的 `failedAttemptsToAvoid`
     包含上一轮失败动作，且 nextAction 不重复同一命令。
9. 三次以上连续 compaction：
   - 第二次 compaction 从 previousArtifact ledger 继承 critical atoms；
   - 第三次 compaction 不丢失第一次的 critical atom（递归损失测试）。

### 第 5 批：回归与契约

10. P1/P2 回归全绿。
11. 若修改 `CompressionEvidenceRef` / CRK 字段，运行
    `pnpm contract:check`、Gateway schema 测试、Electron mapping 测试。
12. UI/E2E 不修改；如误改 UI，必须补 i18n 四语和 viewer E2E。

---

## 8. 建议实现顺序（全部完成前不进入 P4）

1. 更新 Harness spec：touchedAreas/acceptance/requiredTests 增补 P3 验收与新增文件。
2. 写第 1 批测试，运行确认失败。
3. 实现 addressability audit / archive bind / evidence type 扩展。
4. 写第 2 批测试，在 `compact.ts` 接入 checkpoint archive 回填。
5. 写第 3 批测试，实现 ledger-first 重建。
6. 写第 4 批 fixtures，修复 stale/superseded/repeat 行为。
7. 跑第 5 批回归和契约。
8. 全部命令通过后写 `reports/context-compression/P3-EVIDENCE-2026-08-17.md`。

---

## 9. 必须运行的命令（按顺序）

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=verbose
pnpm contract:check
pnpm exec eslint <changed files>
pnpm run typecheck
cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
```

> 注意：`openclaw_runtime` core tsc 当前有与 P3 无关的 `shared/verseshell/**` 既有错误；
> 只要求 grep 确认 P3 changed files 没有新增错误，不要把既有错误修进 P3。

UI/E2E 路径不应修改；若误修改，额外运行：

```powershell
pnpm exec playwright test tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts
```

---

## 10. 修改文件候选与回滚

| 文件 | owner/性质 | 回滚 |
|---|---|---|
| `openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts`（新建，如采用） | 本阶段新增 | 删除文件 |
| `openclaw_runtime/src/agents/agent-hooks/compaction-addressability.test.ts`（新建） | 本阶段新增 | 删除文件 |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts` | P3 runtime/契约 | `git checkout -- <path>` |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts` | P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.ts` | P2/P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` | P2/P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts` | P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts` | P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/context-engine/cvk/recovery.ts` / `recovery-default.ts` | P3 runtime | `git checkout -- <path>` |
| `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts` | P3 契约（如需） | `git checkout -- <path>` |
| `shared/host-api/contract.ts` | P3 契约（如需） | `git checkout -- <path>` |
| `electron/services/sessions-api.ts` | P3 契约（如需） | `git checkout -- <path>` |
| `harness/specs/tasks/token-dense-recovery-compression-v1.md` | P0/P1/P2 已改 | `git checkout` 会连前面阶段一起丢 |
| `reports/context-compression/P3-EVIDENCE-2026-08-17.md`（新建） | 本阶段新增 | 删除文件 |

> 注意：当前 P0/P1/P2 改动均未提交。回滚单个 P3 文件用 `git checkout -- <path>`；
> 整体 reset 到基线会连 P0/P1/P2 一起丢弃，只能在用户明确批准后执行。

---

## 11. 阶段结束必须输出（照抄上一阶段格式）

- 修改文件列表；
- 数据流和 authority 是否变化；
- 新增/更新测试；
- 运行过的命令及结果；
- 指标变化；
- 未解决问题；
- 回滚开关或旧路径；
- 是否满足进入 P4 的条件。

P3 额外必须回答：

- 每个 critical atom 是否都有可解析 evidence ref（给出测试名）；
- archive handle / file hunk / CVK selector 分别在哪里接入；
- missing / stale selector 是否显式失败（给出测试名）；
- 后续 compaction 是否从 atom ledger + 新消息重建（给出测试名）；
- 三次以上 compaction 是否无递归损失（给出测试名）；
- 是否新增了任何模型调用；
- 是否修改了 UI/E2E（如未修改，说明为什么不需要）；
- 若新增 CRK 字段/EvidenceRef 类型，agent-core / Gateway / host contract / Electron
  四处契约是否同步。

---

## 12. P3 完成标准（未全部满足不得进入 P4）

- 所有新增/回归测试绿。
- `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md` PASS。
- `pnpm contract:check` PASS。
- `pnpm run typecheck` node+web PASS；test project 不新增错误。
- openclaw_runtime core tsc 的 P3 changed files 不新增错误（全量既有
  `shared/verseshell/**` 错误不计入 P3）。
- comms replay/compare PASS（如未触及 comms 也如实记录并说明）。
- critical atom addressable recovery 达到 100%（以 deterministic audit/fixture 为准）。
- missing/stale selector 显式失败，没有静默信任路径。
- 后续 compaction 优先使用 previousArtifact ledger，而不是只递归 previousSummary。
- stale branch、superseded decision、失败动作重复执行 fixtures 通过。
- legacy transcript replay rollback 仍可用。
- 除现有 LLM qualityGuard 外，没有新增模型调用。
- 未创建第二套 context/memory/task truth。
