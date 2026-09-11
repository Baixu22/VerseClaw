# P4 验收提示词：ACON 式失败驱动优化与模型级联对比

> 状态：P4 实现已完成，进入验收；验收 agent 不得修改代码
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 被验收证据：`reports/context-compression/P4-EVIDENCE-2026-08-17.md`
> 被验收提示词：`reports/context-compression/P4-DEVELOPMENT-PROMPT-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 验收 agent。
当前任务是**只验收 P4**：对照 P4 开发提示词、P4 证据、active spec 和实际
diff，确认 P4 已满足完成标准，且未违反硬边界。

验收只证明：

- P4 新增的 paired trajectory runner / critic / guideline / model independence
  代码真实存在，且有测试锁定；
- 所有 P4 必答有测试名和命令结果支撑；
- 没有修改 runtime 压缩路径、没有修改 UI/E2E、没有新增 runtime 模型调用；
- 没有新增 token savings 或单模型自评成功宣称；
- 100 条 paired trajectories 和真实 DeepSeek critic 数据积累被如实标记为
  未完成 residual，不冒充已完成。

**不得宣布** P4 数据积累完成、DeepSeek critic live 已跑、或进入蒸馏/上线。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 4(P4)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（当前 active spec）
5. `reports/context-compression/P4-DEVELOPMENT-PROMPT-2026-08-17.md`
6. `reports/context-compression/P4-EVIDENCE-2026-08-17.md`
7. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
8. `reports/context-compression/P1-EVIDENCE-2026-08-17.md`
9. `reports/context-compression/P2-EVIDENCE-2026-08-17.md`
10. `reports/context-compression/P3-EVIDENCE-2026-08-17.md`
11. 以下实际代码，不要根据文件名猜接口：
    - `scripts/context-compression-eval-runner.mjs`
    - `tests/unit/context-compression-eval.test.ts`
    - `tests/unit/helpers/context-compression-eval.ts`
    - `harness/specs/tasks/token-dense-recovery-compression-v1.md`
    - 以及 `git diff -- scripts/context-compression-eval-runner.mjs tests/unit/context-compression-eval.test.ts tests/unit/helpers/context-compression-eval.ts harness/specs/tasks/token-dense-recovery-compression-v1.md`

---

## 3. 验收开始仪式（必须执行）

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
git status --short --branch
git diff --check
```

然后跑 P4 验收基线（全部必须 PASS）：

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm contract:check
pnpm exec eslint scripts/context-compression-eval-runner.mjs tests/unit/context-compression-eval.test.ts tests/unit/helpers/context-compression-eval.ts
pnpm run typecheck
cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
```

若环境没有 `DEEPSEEK_API_KEY`，不得运行 live critic；只验证无 key 路径的
`executed=false` 行为与测试。

---

## 4. 验收硬边界（任何一项违反即 FAIL）

1. P4 不得修改 runtime 压缩路径：
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/**`
   - `openclaw_runtime/src/agents/agent-hooks/**`
   - `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
   - `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`
   - `openclaw_runtime/src/context-engine/cvk/**`
   这些路径中只能有 P0-P3 既有改动；P4 diff 不得新增任何一行。
2. 不得修改 UI/E2E；不得修改 `CompressionArtifact.schemaVersion`；
   不得修改 Electron / Gateway / host contract 的 artifact 契约。
3. 不得新增 runtime 模型调用；DeepSeek 只允许出现在 eval runner 且由
   `--llm-critic` / `--llm-judge` / `--llm-schema-free` /
   `--llm-continuation` 显式触发。
4. DeepSeek API key 不得写入 artifact、cache、report、manifest、guideline
   或日志；验收必须 grep 确认无 `sk-` 类泄露。
5. guideline 不得进入 `CompressionArtifact`；不得创建第二套 context/memory/task truth。
6. P4 证据不得宣布 token savings、结构化 judge 分数或单模型自评成功。
7. 100 条 paired trajectories 与真实 DeepSeek critic 数据积累必须如实标记
   为未完成 residual；若证据声称已完成，判定 FAIL。
8. P0-P3 未提交改动必须保留；不得 reset、rebase、checkout 前序文件。

---

## 5. 必查代码点

1. `scripts/context-compression-eval-runner.mjs`：
   - `normalizePairedTrajectoryRow` / `loadPairedTrajectories` 存在；
   - `classifyPairedTrajectory` 只把 `fullContextSuccess=true &&
     compressedSuccess=false` 分类为 `compression_induced_failure`；
   - `--paired-trajectory` overlay 与 `--paired-summary` 共存逻辑正确；
   - `runDeepSeekCritic` 无 key / 非法 JSON / 无失败样本返回
     `executed:false`，绝不抛崩；
   - `buildFailureGuidelines` 只处理 compression-induced failure；
   - `assertModelIndependence` 同模型唯一评审时 `ok=false`；
   - `summarizePairedTrajectoryMetrics` 空 cohort 不产生 0/0。
2. `tests/unit/helpers/context-compression-eval.ts`：
   - 类型与纯函数与 runner 行为一致（分类、guideline、independence、metrics）。
3. `tests/unit/context-compression-eval.test.ts`：
   - P4 测试真实调用 runner `--paired-trajectory`；
   - 断言 invalid rows、metrics、modelIndependence、guidelines 文件。
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`：
   - acceptance 已增补 P4 验收条目；
   - touchedAreas 覆盖 P4 改动文件，`pnpm harness validate` PASS。

---

## 6. P4 验收必答

- 运行了哪些命令，结果分别是什么？
- `classifyPairedTrajectory` 的四类结果是否与 P4 提示词一致（给出测试名）？
- `--paired-trajectory` 与 `--paired-summary` 的 overlay 优先级是否与证据一致？
- DeepSeek critic 无 key / 非法 JSON / 无失败样本时是否显式失败（给出测试名）？
- guideline 生成是否只包含 compression-induced failure 样本（给出测试名）？
- model independence 是否在同模型唯一评审时 `ok=false`（给出测试名）？
- P4 是否修改了 runtime 压缩路径 / UI / E2E / artifact 契约？
- P4 是否新增了 runtime 模型调用？
- 是否发现 DeepSeek key 或 secrets 写入任何 artifact/cache/report/guideline？
- 100 条 paired trajectories 与真实 DeepSeek critic live 是否被如实标记为未完成？
- 是否有任何 token savings 或单模型自评成功宣称？
- `pnpm harness validate`、`pnpm contract:check`、`pnpm run typecheck`、
  core tsc、comms replay/compare 是否全部 PASS？
- `git diff --check` 是否通过？
- P0-P3 未提交改动是否保留？

---

## 7. 验收结论与输出

验收结论只允许以下三种：

- **PASS**：所有命令 PASS，所有硬边界满足，所有必答有测试/命令支撑，
  且未发现违规。
- **ACCEPT-WITH-RESIDUAL**：所有代码级命令 PASS、硬边界满足，但真实
  DeepSeek critic 数据与 100 条 paired trajectories 尚未积累；这是 P4 的
  正常最终状态，可进入 P5 开发提示词准备，但不得宣称数据积累完成。
- **FAIL**：任一命令失败、硬边界违反、测试缺失、证据造假、secrets 泄露、
  runtime/UI 被修改、或 evidence 与实际 diff 不符。

验收完成后必须写入：
`reports/context-compression/P4-ACCEPTANCE-EVIDENCE-2026-08-17.md`

内容至少包含：结论、运行命令与结果、硬边界检查清单、必答逐项回答、
未解决问题、是否满足进入 P5 的条件。

---

## 8. 验收完成后禁止事项

- 不得修改任何代码、测试、spec 或 evidence。
- 不得补充 P4 功能；发现缺陷只记录在 acceptance evidence 的“未解决问题”。
- 不得运行 live DeepSeek critic（除非已有 `DEEPSEEK_API_KEY` 且用户明确批准）。
- 不得宣称 P4 数据积累完成或进入蒸馏。
