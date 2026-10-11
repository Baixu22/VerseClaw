# 显式 strong 沙箱请求失败关闭（issue #156，2026-10-11）

driven_by: agent；actor: codex-p1-sandbox-strength。基线私有 `main`：`d4d5e3f82`。
本记录只描述本次改动与实测；未做真实容器、真实 provider、桌面 E2E 或跨平台验收。

## 1. 问题现状（核查结论）

- `electron/utils/sandbox-policy-resolver.ts` 的 `resolveSandboxEffectivePolicy()` 会把不可用的
  strong provider（`docker-strong` / `ssh-strong`）解析成 `policy-light`，并置 `degraded: true` +
  `degradeReason`。
- 这个降级对**自动选择**是正确的（无 Docker 也不能阻断默认使用），但**没有区分**"用户/任务显式要求
  strong"。执行边界的 `decideSandboxHighRiskAction()` 只看 `degraded`：degraded 时高风险的
  exec/browser/cron 走"逐次审批"（有审批入口时）或直接拒绝（无审批入口时）。
- 结果：显式选了 strong 的 profile 在 strong 不可用时，审批通过后仍会落到宿主/policy-light 执行；
  UI 上 requested provider 仍是 strong。这正是 issue 第 2 条要求消除的"静默降级执行"。

## 2. 本次改动（最小接线，不新增平面）

1. **resolver seam**：`ResolveSandboxPolicyInput` 增加可选 `requireStrong`；当
   `requireStrong && requested ∈ {docker-strong, ssh-strong} && effectiveRuntimeLevel !== 'strong'`
   时抛 `SandboxStrengthUnavailableError`（携带 requested/effective/runtimeLevel/reason）。
   不传 `requireStrong` 时行为与之前完全一致（继续降级）。
2. **gate 判定**：`SandboxHighRiskPolicySnapshot` 增加 `strengthRequired`。当
   `strengthRequired === true && runtimeLevel !== 'strong'` 时，`decideSandboxHighRiskAction()`
   直接 `allowed=false, requiresApproval=false`（即使 `allowApproval=true`），理由明确写
   "strong isolation was requested but is not active"。`policy-light` 显式选择
   （`strengthRequired=false`）不受影响。
3. **执行边界快照**：`getActiveSandboxHighRiskPolicy()` 从"显式请求的 provider"派生
   `strengthRequired`，并在 strong 请求时**强制刷新 provider 检测**（绕过 15s 缓存），
   使"选择后 Docker 掉线"不再被报告为仍在 strong。失败时如实返回
   requested/effective/runtimeLevel，而不是假装 strong。
4. **可见性**：`buildForcedDegradedVisibility()` 对"strong 未满足"用 `label: 'unavailable'`
   和不同文案，区别于"已承认的降级"。Settings 已有 `sandboxStatus.warnings` 渲染，无需改 UI/i18n。

## 3. 验收标准对照（issue #156）

| 验收点 | 状态 | 证据 |
|---|---|---|
| 显式 strong 请求在 strong 不可用时不落到 host/gateway 执行器 | 满足（gate 层） | `decideSandboxHighRiskAction` 对 `strengthRequired && !strong` 直接拒绝；`tests/unit/sandbox-explicit-strong-156.test.ts` |
| resolver/调用链区分显式与自动 | 满足 | `requireStrong` 只在 `getActiveSandboxHighRiskPolicy()` 对 strong 请求设置；单测覆盖显式抛错、自动降级、strong 可用三态 |
| 检测后失效不被当作 strong | 满足（provider 检测层） | strong 请求时 `forceRefresh: true` 重检；`clearSandboxProviderDetectionCache` 单测路径 |
| requested/effective 如实展示 | 满足 | 失败快照保留 requested/effective/runtimeLevel；`buildForcedDegradedVisibility` 区分 label |
| UI 状态/错误一致 | 不改 UI | 现有 warnings 渲染已覆盖；无 i18n 变更 |
| 正向隔离验证（容器可用时） | **未执行** | 本机无真实 Docker 容器执行；未声称 strong 生效通过 |

## 4. 可重复验证

```sh
node node_modules/vitest/vitest.mjs run tests/unit/sandbox-explicit-strong-156.test.ts tests/unit/sandbox-high-risk-gate-p2-004.test.ts tests/unit/sandbox-api.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run tests/unit/terminal-api.test.ts tests/unit/gateway-permissions-api.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js electron/utils/sandbox-policy-resolver.ts electron/utils/sandbox-high-risk-gate.ts electron/utils/active-sandbox-high-risk-policy.ts tests/unit/sandbox-explicit-strong-156.test.ts
node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-sandbox-strength-fail-closed-20261011.md
```

## 5. 未做与边界

1. 未修改任何产品默认值、冻结锁或权限默认；自动降级与 `policy-light` 默认保持原样。
2. 未新增 sandbox provider、第二套审批面或调度器。
3. 未执行真实 Docker/SSH 容器隔离验证、Electron E2E、打包、跨平台或全量 `harness:ci`。
4. #154（出站模型并发额度）与 #155（Job Object 硬限额）是独立议题，本变更不声称覆盖。
5. 本变更为 agent 驱动；无真人操作、无付费 provider 调用。

## 6. 合并期决定（2026-10-11，把 `codex/p1-issues-20261010` 集成进 main 时）

`electron/utils/workspace-runtime-permissions.ts` 的 `resolveSandboxProviderIdForRuntime()` 被 git
**逐块自动合并**成了"main 的 #156 语义 + 分支更早的 fail-closed 变体"的混合体：分支那侧对
`docker-strong` / `ssh-strong` 直接 `throw new SandboxStrengthUnavailableError('docker-strong', '…')`
（**位置参数**），而 #156 之后的构造函数签名是单个对象
`{requestedProviderId, effectiveProviderId, runtimeLevel, reason}`。于是合并树 `tsgo` 报
`Expected 1 arguments, but got 2`，同时该混合体还会把**自动/启动解析**也变成失败关闭。

**决定：保留 main 的 #156 语义。** 自动与启动解析继续可降级（`docker-strong` 不可用时回落
`policy-light`），只有显式 strong 请求经 `resolveSandboxPolicy({ requireStrong: true })` 才失败关闭。
依据：本文 §1 已写明"这个降级对自动选择是正确的"，#156 的验收测试
（`tests/unit/sandbox-explicit-strong-156.test.ts`）与规则
（`harness/specs/rules/sandbox-strength-fail-closed.md`）都以"仅显式请求失败关闭"为契约；
把自动路径也改成失败关闭会让"未安装 Docker 的机器在启动解析阶段直接失败"，属于行为扩大而非修复。
分支的那两个位置参数调用点随该混合体一并移除，本文件不再引用 `SandboxStrengthUnavailableError`
（导入同步删除，避免未使用导入）。
