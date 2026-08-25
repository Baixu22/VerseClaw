# P1 开发提示词：Semantic Atom 与 CompressionArtifact v1 兼容契约

> 状态：准备进入 P1，尚未修改 P1 runtime 文件
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P0-EVIDENCE-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 执行 agent。
当前阶段是 P1：在现有 `CompressionArtifact v1` 上增加**可选的 semantic atom ledger**，
不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。

P1 验收只证明：
- 旧 v1 payload 仍可读；
- critical atom 必须有 evidence ref；
- unverified / stale / superseded 状态可见；
- 连续 compaction 不丢 lineage；
- Markdown summary 始终只是 projection，不是事实源；
- 大段代码、工具 schema 或 durable facts 不得复制进 artifact。

**不得宣布** token savings、结构化 judge 分数或单模型自评成功。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 1、3、4(P1)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（当前 active spec）
5. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
6. 以下实际代码，不要根据文件名猜接口：
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`
   - `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts`（`CompressionArtifactSchema` 区域）
   - `shared/host-api/contract.ts`（`CompressionArtifact` 区域）
   - `electron/services/sessions-api.ts`（`mapCompressionArtifact`）
   - `src/lib/host-api.ts`（re-export 区域）
   - `src/pages/Chat/CompactionArtifactViewer.tsx`
   - `openclaw_runtime/src/gateway/server-methods/sessions.shared.ts`（`compressionArtifactFromCheckpoint`）
   - `openclaw_runtime/src/context-engine/cvk/recovery.ts` 和 `recovery-default.ts`

---

## 3. 阶段开始仪式（必须执行）

按顺序执行并记录结果：

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

然后跑 P1 基线（本提示词准备时已跑，仍要自己复核）：

```powershell
pnpm exec vitest run tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=dot
pnpm --dir openclaw_runtime exec vitest run packages/gateway-protocol/src/schema/sessions.recall.test.ts packages/agent-core/src/harness/compaction/compression-artifact.test.ts --reporter=dot
pnpm contract:check
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git status --short --branch
```

---

## 4. 硬边界（任何情况下不得违反）

1. 不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。
2. Agent Core compaction、Compaction Safeguard、CompressionArtifact、Context Runtime Kit
   的 authority 保持不变。
3. 自然语言摘要只能是 projection，不能成为事实源。
4. 每个 critical fact 必须能回溯到 transcript、archive handle、file hunk 或 CVK selector。
5. Provider 与内置 LLM 共用 normalize / validate / damage audit / repair / fallback 管线。
6. 禁止 provider trusted bypass。
7. `CompressionArtifact` 的 `schemaVersion` 必须保持 `1`；旧 v1 payload 必须继续可读。
8. 不得用 token savings、结构化 judge 分数或单模型自评宣布成功。
9. DeepSeek API key 只从环境变量读取，绝不写入 artifact、cache、report 或日志。
10. 不修改 `D:\ClawX` 根工作树的未提交改动；本 worktree 的 P0 未提交改动必须保留。

---

## 5. 当前接口事实（P1 准备时已核对）

### 5.1 `compression-artifact.ts`（authority）

- `CompressionArtifact.schemaVersion` 是 `1` 字面量。
- 已有 `CompressionFact { text, evidenceRefs }`、CVK refs、retrievalTrace、
  `telemetry?: Partial<CompressionTelemetry>` 和 `quality`。
- `buildDeterministicCompressionArtifact(input)` 当前从 Markdown summary 与 messages
  抽取旧字段；没有 atom 输入。
- `normalizeCompressionArtifact(value)` 拒绝 `schemaVersion !== 1`，必须保留该行为。
- `renderRecoveryContextProjection()` 已有 bounded projection 与 secret redaction。

### 5.2 `compaction.ts`（authority）

- `CompactionPreparation` 目前只有 `previousSummary?: string`，**没有** previous artifact。
- `prepareCompaction()` 在找到前一个 `CompactionEntry` 时只取 `prevCompaction.summary`；
  `prevCompaction.details.artifact` 可用于 lineage，当前未消费。
- `compact()` 末尾调用 `buildDeterministicCompressionArtifact(...)`，传入
  planned messages、previousSummary、summary、file lists、telemetry；未传 contextRuntimeKit
  或 atom ledger。

### 5.3 契约重复点（P1 必须同步，且不得互相矛盾）

- `shared/host-api/contract.ts` 有独立的 `CompressionArtifact` 类型；它缺少 agent-core
  已存在的 CRK optional 字段，并使用 flat 的 tier/strategy/compressionRatio 等 legacy 字段。
- `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts` 有
  `CompressionArtifactSchema`，`additionalProperties: false`；它同样缺少 agent-core 的
  `telemetry` 对象和 CRK optional 字段。
- `electron/services/sessions-api.ts` 的 `mapCompressionArtifact` 用 spread 透传 unknown
  字段，所以新增字段默认会到达 renderer，但类型和 validator 必须显式声明。
- P1 新增 `semanticAtoms` 时必须在这三个类型/validator 中同步声明为 optional；
  禁止先只改 agent-core 而让 Gateway validator 或 renderer 类型失配。
- `pnpm contract:check` 只查方法表面，不查类型字段；类型/validator 一致性靠测试保证。

### 5.4 现有消费方

- Gateway：`sessions.compressionArtifact` / `sessions.recoveryContext` 通过
  `compressionArtifactFromCheckpoint` 返回 artifact；recovery 用
  `renderRecoveryContextProjection`。
- Electron：`sessions-api.ts` 映射后交给 renderer。
- Renderer：`CompactionArtifactViewer.tsx` 展示旧字段和 warnings。
- CRK：`recovery.ts` / `recovery-default.ts` 消费 `requiredSelectors`、
  `staleReferences`、`blocked`、`failedAttempts`、`nextAction`。
- P1 新增字段不能让这些消费方回归。

---

## 6. P1 目标接口草案（实现时以测试锁行为，不要照抄猜测）

建议在 `compression-artifact.ts` 增加（可在同目录新建 `semantic-atoms.ts`，但不要新造 authority）：

```ts
type SemanticAtomStatus = "verified" | "unverified" | "stale" | "superseded";
type SemanticAtomPolarity = "positive" | "negative" | "neutral";
type SemanticAtomType =
  | "goal"
  | "latest_user_ask"
  | "decision"
  | "constraint"
  | "failed_attempt"
  | "entity"
  | "next_action"
  | "outcome"
  | "safety_boundary";

type CompressionSemanticAtom = {
  id: string;                      // ledger-stable lineage id
  type: SemanticAtomType;
  canonicalIdentity: string;       // 规范化语义 key，用于 supersede/merge
  severity: "critical" | "important" | "nice_to_have";
  confidence: number;              // 0..1
  scope: string;                   // session/task/workspace/... 必须 bounded
  polarity: SemanticAtomPolarity;
  status: SemanticAtomStatus;
  text: string;                    // projection text，受长度/脱敏约束
  evidenceRefs: CompressionEvidenceRef[];
  supersedes?: string[];           // atom ids 或 canonicalIdentity
  conflicts?: string[];
  updatedAt?: number;
  source?: {
    kind: "summary" | "message" | "ledger" | "cvk" | "archive";
    ref: string;
  };
};
```

`CompressionArtifact` 增加 **optional**：

```ts
semanticAtoms?: CompressionSemanticAtom[];
```

`CompressionArtifactInput` 增加 optional：

```ts
semanticAtoms?: CompressionSemanticAtom[];
previousArtifact?: CompressionArtifact;
```

约束：
- `critical` atom 的 `evidenceRefs` 为空时，builder/normalizer 必须降级为
  `status: "unverified"` 或丢弃，并写 `quality.warnings`；不得静默呈现为 verified。
- atom `text` 必须经过现有 `normalizeText` 等价长度上限和 `redactSecretLikeText`。
- 不允许把大段代码、完整 tool schema、durable fact body 放进 atom.text；
  只允许 bounded projection + evidence ref。
- `supersedes` / `conflicts` 只表达 ledger 关系，不删除旧 atom。

---

## 7. 先补测试，再实现行为（TDD 顺序）

### 第 1 批：artifact 兼容与 atom 契约（`tests/unit/compression-artifact.test.ts` + 同目录 agent-core 测试）

1. `normalizeCompressionArtifact` 读取**无** `semanticAtoms` 的旧 v1 payload，输出
   `schemaVersion: 1`，旧字段不变，`semanticAtoms` 为 `undefined`。
2. `buildDeterministicCompressionArtifact({ ..., semanticAtoms: [...] })`：
   - atom 字段全部保留并 normalize；
   - critical atom 缺 evidence 时不是 verified（unverified 或 absent）+ warning；
   - atom text 被长度裁剪并脱敏；
   - legacy `objective / decisions / failedAttempts / nextAction` 等字段仍由 adapter
     从 ledger 生成，Markdown 渲染仍兼容。
3. `renderRecoveryContextProjection`：
   - 输出 `semanticAtoms` 状态计数或列表（verified/unverified/stale/superseded）；
   - 不在 projection 中复制大段 body。
4. `renderCompressionArtifactSummary` 仍以旧 heading 输出（旧消费方兼容），
   需要时可增加 projection 专属段落，但不得破坏旧断言。

### 第 2 批：lineage 与连续 compaction（`compaction.ts` 路径）

5. `prepareCompaction` 找到前一个 compaction 时，从
   `prevCompaction.details.artifact` 提取并传递 previous artifact（normalize 后）。
6. 构造两次 compaction：
   - 第一次 atom A verified；
   - 第二次 atom B `supersedes: [A.id]`；
   - 结果 ledger 同时含 A(status=superseded) 和 B(status=verified)，A 不丢。
7. 冲突 atom：`conflicts` 两侧都可见，且 projection 标记 conflict。
8. 无 previous artifact 时行为与旧路径一致。

### 第 3 批：wire contract / validator / renderer 映射

9. `shared/host-api/contract.ts` 的 `CompressionArtifact` 增加 optional
   `semanticAtoms`；同步补齐（如为对齐而需要）`telemetry` 或 CRK optional 字段，
   但不得删除任何现有字段。
10. Gateway `CompressionArtifactSchema`：
    - 旧 v1 minimal payload 仍通过；
    - 带合法 `semanticAtoms` 的 v1 payload 通过；
    - 带未声明字段的 payload 仍拒绝；
    - 非法 atom（critical 缺 evidence 且 status=verified，或字段类型错误）被拒绝
      或 normalize 后不再呈现为 verified。
11. `electron/services/sessions-api.ts`：`mapCompressionArtifact` 对 `semanticAtoms`
    显式 normalize，不能只依赖 unknown spread。
12. 若 UI 显示 atom 状态：`CompactionArtifactViewer` 展示
    verified/unverified/stale/superseded 计数与 critical evidence 缺失 warning；
    i18n 四语补齐；更新 `tests/unit/compaction-artifact-viewer.test.tsx` 和
    `tests/e2e/compaction-artifact-viewer.spec.ts`。
    **若 UI 不展示，则投影字符串必须可见，且验收说明中写明 UI 未变。**

### 第 4 批：CRK 回归

13. `context-runtime-kit-compression-artifact.test.ts` 与
    `context-runtime-kit-recovery-context.test.ts` / `recovery-default.test.ts` 全绿；
    确认 atom 增加不改变 `requiredSelectors` 的 resolution 和 legacy rollback。

---

## 8. 建议实现顺序（全部完成前不进入 P2）

1. 先更新 Harness spec：touchedAreas/acceptance/requiredTests 增补 P1 验收与新增文件。
2. 写上述第 1 批测试，运行确认失败。
3. 实现 `semantic-atoms` 类型/提取/合并与 `compression-artifact.ts` adapter。
4. 写/跑第 2 批测试，实现 `compaction.ts` previousArtifact lineage。
5. 写/跑第 3 批测试，同步 `shared/host-api/contract.ts`、gateway protocol schema、
   electron mapping，必要时 UI。
6. 跑第 4 批 CRK 回归。
7. 全部命令通过后写 `reports/context-compression/P1-EVIDENCE-2026-08-17.md`。

---

## 9. 必须运行的命令（按顺序）

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=verbose
pnpm contract:check
pnpm exec eslint <changed files>
pnpm run typecheck
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

如果 UI/E2E 路径被修改，额外运行：

```powershell
pnpm exec playwright test tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts
```

---

## 10. 修改文件候选与回滚

| 文件 | owner/最近提交 | 回滚 |
|---|---|---|
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts` | `52ceed961` | `git checkout -- <path>` |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts` | `bdcbf85b1` | `git checkout -- <path>` |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/semantic-atoms.ts`（如新建） | 本阶段新增 | 删除文件 |
| `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts` | `f77d92dd2` | `git checkout -- <path>` |
| `shared/host-api/contract.ts` | `734ec877e` | `git checkout -- <path>` |
| `electron/services/sessions-api.ts` | `3e0ea62ec` | `git checkout -- <path>` |
| `src/lib/host-api.ts`（如需 re-export） | `ce23e4431` | `git checkout -- <path>` |
| `src/pages/Chat/CompactionArtifactViewer.tsx`（如需 UI） | `51e6633f3` | `git checkout -- <path>` |
| `tests/unit/compression-artifact.test.ts` | `4ba392a57` | `git checkout -- <path>` |
| `tests/unit/context-runtime-kit-compression-artifact.test.ts` | `91b57f419` | `git checkout -- <path>` |
| `tests/unit/compaction-artifact-viewer.test.tsx`（如需 UI） | `51e6633f3` | `git checkout -- <path>` |
| `harness/specs/tasks/token-dense-recovery-compression-v1.md` | P0 已改 | P0 未提交基线 + `git checkout` 会丢 P0，需整体回滚 |
| `reports/context-compression/P1-EVIDENCE-2026-08-17.md` | 本阶段新增 | 删除 |

> 注意：当前 P0 改动未提交。回滚单个 P1 文件用 `git checkout -- <path>`；整体回滚到基线
> `734ec877e` 会连 P0 一起丢弃，只能在用户明确同意后执行。

---

## 11. 阶段结束必须输出（照抄上一阶段格式）

- 修改文件列表；
- 数据流和 authority 是否变化；
- 新增/更新测试；
- 运行过的命令及结果；
- 指标变化；
- 未解决问题；
- 回滚开关或旧路径；
- 是否满足进入 P2 的条件。

P1 额外必须回答：
- 旧 v1 payload 是否继续 normalize/render（给出测试名）；
- 每个 critical atom 是否有 evidence ref（给出测试名）；
- unverified/stale/superseded 是否在 projection/UI 可见；
- 连续 compaction lineage 是否保留（给出测试名）；
- 是否修改了 UI/E2E（如未修改，说明为什么仍满足“可见”验收）。

---

## 12. P1 完成标准（未全部满足不得进入 P2）

- 所有新增/回归测试绿。
- `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md` PASS。
- `pnpm contract:check` PASS。
- `pnpm run typecheck` node+web PASS；test project 不新增错误。
- comms replay/compare PASS（如未触及 comms 也如实记录并说明）。
- CompressionArtifact schemaVersion 仍为 1。
- 不存在 provider trusted bypass；DeepSeek key 未落盘。
- 未创建第二套 context/memory/task truth。
