# Gateway Source Runtime Sandbox Fallback Plan

## Background

当前问题不是“Gateway 连不上”这么简单，而是下面三件事叠在一起：

1. ClawX 现在默认优先启动可编辑的 `openclaw_runtime`
2. `openclaw_runtime` 里的 sandbox 默认后端仍然偏向 `docker`
3. 某次修复把“Docker 不可用时自动降级”的选择弱化了，导致 Gateway 启动链路里仍可能落到强制 Docker

结果就是：

- Gateway 进程被正常拉起前后会卡在 source runtime 的 sandbox 前置条件上
- UI 看到的是“连不上 Gateway”
- 但实际根因是“runtime 已选 source，sandbox 却没有走可运行的 fallback”

## Goal

保证下面这条链路始终成立：

`runtime 选择`、`sandbox 选择`、`Gateway 启动`、`Doctor 诊断`、`CLI/helper 命令`、`UI 状态` 使用同一份有效决策。

换句话说：

- source runtime 仍然是默认
- Docker 可用时继续用 Docker sandbox
- Docker 不可用时明确降级，而不是隐式失败
- UI 和日志都能说清楚“现在是正常运行但降级了”，不是笼统显示 Gateway 挂了

## Root Cause Summary

我在仓库里确认到两件关键事实：

1. `electron/gateway/config-sync.ts` 已经有一段 source runtime 专用逻辑：
   - 会检查 `docker image inspect openclaw-sandbox:bookworm-slim`
   - 不存在时把隔离配置写成 `agents.defaults.sandbox.mode = "off"`
2. 这段逻辑目前只覆盖“isolated source runtime config 写入”这一小块，不足以保证整个启动链路都遵守同一套 fallback 决策

这会带来几个风险点：

- 其他入口仍可能按默认 Docker 认知执行
- `Doctor` / CLI helper 与 Gateway 的有效 sandbox 不一致
- 日志里只有 runtime=`source`，缺少 sandbox 是否降级的统一摘要
- 后续 agent 修改 `openclaw_runtime` 默认 sandbox 时，很容易再次绕过这段局部 fallback

## Implementation Plan

### Phase 1: 把 fallback 决策提升成统一启动策略

目标：在 Gateway spawn 之前，只计算一次“有效 sandbox 方案”。

建议新增一个主入口，例如：

- `resolveGatewaySandboxStartupPolicy(...)`

它至少输出：

- `requestedRuntimeMode`
- `effectiveRuntimeMode`
- `requestedSandboxBackend`
- `effectiveSandboxMode`
- `effectiveSandboxBackend`
- `degraded: boolean`
- `degradeReason`
- `strictFailure: boolean`

然后让下面这些路径都只消费这份结果：

- `prepareGatewayLaunchContext()`
- source runtime isolated config 写入
- `openclaw doctor`
- CLI/helper runtime entry 选择与状态展示
- Gateway API 诊断输出

### Phase 2: 明确 source runtime 的降级矩阵

不要只保留“有没有 Docker 镜像”一个判断，建议拆成清晰矩阵：

1. Docker CLI 不存在
2. Docker daemon 不可达
3. sandbox image 不存在
4. source runtime dist 不完整
5. 用户显式要求 strict source mode

对应动作建议：

- 默认开发/普通用户模式：降级到 `sandbox.mode=off`
- 明确 strict 模式：直接 fail fast，并把失败原因抛给 UI/Doctor

推荐新增两个显式开关中的一个：

- `VERSE_CLAW_OPENCLAW_SANDBOX_FALLBACK=auto|strict|off`

或者

- `VERSE_CLAW_OPENCLAW_RUNTIME_STRICT=1`

这样可以把“正常可用优先”和“开发者强约束优先”分开。

### Phase 3: 把降级状态暴露给 UI 和诊断

目前用户只知道“Gateway 连不上”，这对排障很不友好。

建议把以下信息放进 Main 侧状态或诊断接口：

- runtime: `source` / `npm`
- sandbox: `docker` / `off` / other backend
- degraded: `true/false`
- reason: 简短可展示字符串

UI 期望行为：

- Gateway 真挂了：显示 unavailable / stopped
- Gateway 已启动但 sandbox 降级：显示 running with degraded sandbox

这一步不一定先做复杂 UI，哪怕先把状态接入 Developer / Diagnostics 页面也很值。

### Phase 4: 保证 Doctor / helper / packaged wrapper 一致

现在要重点避免这类错位：

- Gateway 用 source runtime + fallback
- `openclaw doctor` 却按 npm runtime 或默认 Docker 去检查

需要统一的对象：

- `electron/utils/openclaw-cli.ts`
- `electron/utils/openclaw-doctor.ts`
- `electron/utils/control-ui-device-pairing.ts`
- 任何显示“当前 OpenClaw 命令”的地方

原则：

- 这些入口都必须复用 Gateway 的 runtime/sandbox 决策摘要
- 不允许各自重新猜一次

### Phase 5: 在 openclaw_runtime 侧补保护，避免再次强制 Docker

ClawX 的 Main 侧 fallback 还不够，runtime 侧也需要守门，至少做到：

- 如果上游已经明确传入 `sandbox.mode=off`，runtime 不得再回推默认 Docker
- dynamic tool / native tool surface 的判断基于“effective sandbox context”，不是静态默认值
- 错误日志里能区分：
  - “docker backend requested but unavailable”
  - “sandbox intentionally downgraded by host”

建议关注这些位置：

- `openclaw_runtime/src/agents/sandbox/**`
- `openclaw_runtime/extensions/codex/src/app-server/dynamic-tool-build.ts`

### Phase 6: 测试与回归防护

必须把“Docker 不可用但 Gateway 仍可用”当成一等测试场景。

建议最少覆盖：

1. unit: source runtime + Docker image 可用
2. unit: source runtime + Docker image 不可用 -> 写入 `sandbox.mode=off`
3. unit: strict mode + Docker image 不可用 -> 启动失败并给出明确错误
4. unit: doctor/CLI 命令显示与 Gateway 一致
5. e2e: Gateway 生命周期在降级状态下仍能到 ready
6. comms regression: 启动后握手与事件链不受影响

## Recommended Execution Order

建议按这个顺序落地，风险最低：

1. 抽出统一 sandbox startup policy
2. 接到 `prepareGatewayLaunchContext()`
3. 让 Doctor / CLI helper 共用这份 policy
4. 暴露 diagnostics / host-api 状态
5. runtime 侧补守门
6. 补 unit + e2e + comms 回归
7. 更新 README 中关于 source runtime 和 fallback 的说明

## Acceptance Criteria

修完以后，至少要满足下面这些外部表现：

- 本机没有 Docker 或没有 sandbox image 时，ClawX 启动后 Gateway 仍可连接
- 日志明确显示：
  - runtime=`source`
  - sandbox=`off` 或其他 fallback
  - degraded reason
- `Doctor` 显示与实际 Gateway 一致的 runtime/sandbox 状态
- 用户显式要求 strict source mode 时，会收到清晰错误而不是静默卡住
- 重新引入强制 Docker 默认时，单元测试会失败

## Immediate Low-Risk Fix

如果你想先快速恢复可用性，再做完整治理，最低风险补法是：

1. 把 `applySourceRuntimeSandboxAutoFallback()` 提升为正式的启动策略函数
2. 把结果写入 launch summary / diagnostics
3. 让 `openclaw-doctor` 和 helper 命令读同一份结果
4. 先补两组单测：
   - Docker image 缺失时自动降级
   - strict 模式下明确失败

这样可以先把“无法连接 Gateway”止血，再继续做 UI 和 runtime 深层收口。

## Risks

- 只改 ClawX Main 侧，不改 runtime 侧，后续仍可能被默认 Docker 逻辑反覆盖
- 只改 isolated config，不改 diagnostics，用户仍然会误判成 Gateway 挂掉
- 只做 dev 修复，不管 packaged，后面打包版会出现行为分叉

## Final Recommendation

这次不要把它当成“再补一个 if 判断”的问题来修。

更稳妥的做法是把它定义成：

**Gateway runtime selection + sandbox fallback policy**

并让这个 policy 成为唯一真相源。这样我们才能同时保证：

- source runtime 默认可用
- Docker 可用时保留隔离
- Docker 不可用时自动降级
- 所有诊断、工具、UI 都说同一种真话
