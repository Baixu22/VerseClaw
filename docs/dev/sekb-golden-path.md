# SEKB 半自动黄金路径（TF-0004）

> 状态：Active
> 关联节点：TF-0004
> 政策：人工确认写回；禁止无人值守自动写回；不翻转 default-on / 联合系统 GA

## 闭环链

```text
execute → compress → candidate → filter → confirm → persist → recall → behavior delta → evaluate
```

| 阶段 | 实现 |
|---|---|
| execute | `TrajectoryCapture.start/log/finish` 写入 L3 trajectory |
| compress | `finish_trajectory` 内 `compressSteps` |
| candidate | `DistillationTool.suggest_principles_from_trajectories`（仅建议，不写 principle） |
| filter | confidence / 人工挑选 |
| confirm | **人类** `confirm_and_save` / host `sekbConfirmPrinciple` |
| persist | `KnowledgeStore.save_principle` + trajectory `distilled=true` |
| recall | `RetrievalEngine.retrieve_for_task` |
| behavior delta | `format_for_injection` 确认后相对确认前变化 |
| evaluate | chainComplete + noAutoWriteback |

## 入口

| 层级 | 路径 |
|---|---|
| 运行时 API | `openclaw_runtime/src/knowledge/sekb/golden-path.ts` → `runSekbGoldenPath` |
| 单测 | `openclaw_runtime/src/knowledge/sekb/golden-path.test.ts` |
| Host API | `sekbCaptureTrajectory` / `sekbSuggestPrinciples` / `sekbConfirmPrinciple` / `sekbRetrieveForTask` |
| Electron E2E | `tests/e2e/sekb-golden-path.spec.ts` |
| 证据 | `artifacts/sekb-golden-path/evidence.json` |

## 硬约束

1. `suggest_*` **不得**写 principle / experience Block（ANTI-8）
2. 仅 `confirm_*` 可持久化 principle；DCS experience 写回也必须经 confirm + sessionId
3. 不提供自动写回 worker；不 default-on SEKB 生产全量注入
4. lineage 需含 sessionId、sourceTrajectoryIds、principleId、provenance schema

`sekbCaptureTrajectory` accepts an explicit `runtimeLineage` object when the
caller has real execution correlation. The Main process validates the strict
`runtime-lineage.v1` shape and passes it through to the persisted trajectory;
it never derives lineage from a session key or other renderer state. A manual
capture without lineage remains readable for audit and deletion, but cannot
enter the distillation candidate pool under the terminal-trajectory gate.

The Electron golden-path test supplies complete `sessionId`, `loopRunId`, and
`traceId` values so the Host API path exercises the same candidate boundary as
the runtime producer path. This fixture is engineering evidence only, not
real-channel or product-approval evidence.

## 验证

```powershell
# unit (openclaw_runtime vitest)
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/golden-path.test.ts

# Electron E2E（需 dist + dist-electron）
pnpm run test:e2e:run tests/e2e/sekb-golden-path.spec.ts
```

## 非目标

- SEKB 自动写回 worker
- Runtime Memory / SEKB 全量 default-on
- 联合系统正式 GA
