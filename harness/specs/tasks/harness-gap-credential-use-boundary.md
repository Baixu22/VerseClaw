---
lifecycleStatus: completed
id: harness-gap-credential-use-boundary
title: 模型/provider 覆盖选择的凭据使用约束台账（S05）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S05 核验 image 生成的 provider override 凭据使用窄闸门：external/unknown 来源的显式 override 只能落在 host 绑定的 provider 范围；拒绝发生在读取凭据前；策略输入不含凭据值。逐项记录覆盖与残余，不新建第二套凭据策略。
touchedAreas:
  - docs/dev/harness-gap-closure/s05-credential-use-boundary.md
  - tests/unit/provider-credential-use-boundary-ledger.test.ts
  - harness/specs/tasks/harness-gap-credential-use-boundary.md
  - docs/dev/harness-gap-closure/s05-acceptance.json
  - docs/dev/harness-gap-closure/S05-SHA256SUMS
ownedPaths:
  - docs/dev/harness-gap-closure/s05-credential-use-boundary.md
  - tests/unit/provider-credential-use-boundary-ledger.test.ts
  - harness/specs/tasks/harness-gap-credential-use-boundary.md
  - docs/dev/harness-gap-closure/s05-acceptance.json
  - docs/dev/harness-gap-closure/S05-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.test.ts
  - openclaw_runtime/src/agents/tools/image-generate-tool.credential-use-provenance.test.ts
  - tests/unit/provider-credential-use-boundary-ledger.test.ts
acceptance:
  - trusted system / direct operator 的 provider override 保留既有语义；无显式 override 的默认/fallback 路径不经该闸门。
  - external/derived-untrusted/missing/invalid 来源 + 显式 override 时，请求 provider 必须落在 host 绑定的 image provider 范围，否则拒绝。
  - 拒绝发生在读取任何 provider 凭据之前，且策略输入/拒绝原因不含凭据值。
  - 逐项记录覆盖与残余：该闸门仅接在 image-generate 的显式 override 分支；其它凭据使用路径显式记为 residual，不冒充已覆盖。
  - 不新建第二套凭据策略；不改默认 provider、fallback 或凭据存储。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 外部/未知来源内容无法用显式 override 把 image 生成切到未绑定的 provider 凭据。
  - 直接 operator/trusted system 的 override 与默认路径不受影响。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s05-credential-use-boundary.md
---

# S05 冻结实施边界

S05 核验既有单条凭据使用策略（`resolveProviderCredentialUsePolicy`），不新增策略。调用点仅 `image-generate-tool.ts` 的显式 override 分支；策略输入只有 provenance + provider 范围（`hasExplicitModelOverride` / `requestedProvider` / `boundProviderIds`），**没有**凭据值。拒绝在读取凭据之前发生。其它凭据使用路径记为 residual。
