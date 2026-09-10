---
id: verseshell-p2-trace-diagnostics
title: VerseShell P2-03 Trace Diagnostics Contract Foundation
taskType: runtime-contract
intent: 为 TF-0066 / VS-P2-03 建立 host-issued trace envelope、低基数失败分类和安全摘要契约；本切片只冻结基础 schema，不接入现有 runtime、receipt store、UI 或 support bundle。
touchedAreas:
  - harness/specs/tasks/verseshell-p2-trace-diagnostics.md
  - openclaw_runtime/src/observability/host-trace-diagnostics.ts
  - openclaw_runtime/src/observability/host-trace-diagnostics.test.ts
expectedUserBehavior:
  - 只有持有 host-only secret 的 authority 能签发可验证的 trace envelope；缺失 lineage、篡改字段、错误密钥、过期或超界 envelope 均 fail-closed。
  - envelope 只承载 bounded request/trace/span/parent/run/correlation lineage；command、prompt、output、stderr、credential、approval token 和 secret 不能进入 envelope 或 summary。
  - compile、test、tool_missing、permission、environment、runtime、timeout、cancelled、unknown 是固定低基数 failure taxonomy；原始错误只用于 host 侧瞬时分类，不会被摘要保留。
  - 安全摘要只输出 schema、已验证 host lineage、failureKind 和 bounded exit/duration/signal metadata；它不改变执行、重试、审批、fallback、receipt 或 rollout 状态。
requiredProfiles:
  - fast
requiredRules:
  - contract-first-boundary
  - runtime-lineage-boundary
  - runtime-authority-convergence-boundary
  - verseshell-foundation-p0-boundary
forbiddenPatterns:
  - 从 model、prompt、command、tool payload 或 renderer 输入接受 traceId、parentTraceId、requestId、spanId、signature 或 approval token
  - 在 envelope、summary、测试 fixture 或日志中保留 raw command、prompt、stdout、stderr、tool output、credential、API key、cookie、authorization、password 或 secret
  - 使用可由调用者直接覆盖的 trace fields、caller-supplied timestamp、明文 secret、可伪造的 TypeScript-only brand 或未签名 envelope 作为 host authority
  - 将 failure message、provider request id、exit detail 或任意错误 code 原样写入低基数 summary
  - 接线现有 diagnostic-events、diagnostic-error-metadata、diagnostic-support-redaction、receipt-store、UI、support bundle、OTLP exporter 或任何 runtime adapter
  - 修改 feature flag、default-on、liveReady、productApproved、canary、approval、native fallback、Task Forest 或并行 lane 文件
featureFlags:
  - 本契约不新增、不修改任何配置或 feature flag，VerseShell foundation 继续 default-off、liveReady=false、productApproved=false、defaultOn=false。
rollback:
  - 本切片无 runtime wiring 或数据迁移；回滚只移除新增契约 spec、模块和 focused tests，不触碰既有诊断、receipt 或 observability 数据。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p2-trace-diagnostics.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p2-trace-diagnostics.md --no-diff
  - pnpm --dir openclaw_runtime exec vitest run src/observability/host-trace-diagnostics.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec tsc --noEmit --strict --target es2023 --module NodeNext --moduleResolution NodeNext --types node src/observability/host-trace-diagnostics.ts
  - git diff --check
acceptance:
  - `createHostTraceDiagnosticsAuthority` requires a host-only secret of at least 32 bytes, signs canonical bounded lineage with HMAC-SHA256, creates timestamps internally, and verifies signature, schema, bounds, clock and expiry before summary creation.
  - requestId、traceId、spanId 是 required lineage；parentTraceId、runId、correlationDigest 只能作为 validated host fields；extra keys 和 invalid W3C/digest values fail-closed。
  - focused tests cover missing lineage, tampering/wrong key/expiry, compile/test/tool missing/permission/environment/runtime/timeout/cancelled/unknown classification, and sensitive-field non-disclosure。
  - summary 的可序列化结果不含 raw command、prompt、output、secret、message、provider request id、arbitrary error code 或 approval data；failureKind 保持在固定 taxonomy 内。
  - 后续 adapter 必须由 host 在审批绑定且 runtime owner 已确定后签发 envelope；start/poll/result/error/receipt/UI/support consumer 只能消费已验证 envelope 和安全摘要，不能自行重建 lineage 或二次解析命令。
  - 后续 adapter 必须明确 receipt-store 只保存 correlation/receipt facts，诊断摘要不能授权 replay；result/artifact 只通过 bounded digest/handle metadata 关联，raw 内容继续留在既有 owner。
  - 本切片不声称 TF-0066 完成，不修改现有 runtime 文件、默认值、Task Forest、flags、UI、support bundle、OTLP、receipt store 或任何执行路径。
docs:
  required: false
  notes:
    - 本切片新增的 Harness spec 本身是契约文档；未改变用户可见 flow、公开接口或既有 runtime wiring，因此不扩展到 STATUS、README 或 handoff 文件。
---

# VerseShell P2-03 Trace Diagnostics Contract Foundation

本规范只负责 `TF-0066` / `VS-P2-03` 的“诊断契约基础层”切片，不代表整个 P2-03
或 VerseShell foundation 已完成。它冻结三个边界：host-issued lineage envelope、低基数
failure taxonomy 和只保留安全 metadata 的 diagnostic summary。

## Schema

`HostIssuedTraceEnvelope` 的顶层字段固定为 `kind`、`schemaVersion`、`issuedAt`、`expiresAt`、
`lineage`、`signature`。`lineage` 需要 bounded `requestId`、W3C `traceId`、W3C `spanId`；
`parentTraceId`、`runId` 和 receipt-compatible `correlationDigest` 是可选的 validated host
fields。签名覆盖 canonical schema、时间窗口和 lineage；调用者不能提供时间戳，也不能在
envelope 中夹带额外字段。

`TraceDiagnosticSummary` 只包含 schema、已验证 lineage、固定 `failureKind`、可选 bounded
`durationMs`/`exitCode`/signal class 和固定的 `raw-fields-omitted` 标记。它不接受或输出
原始命令、prompt、output、stderr、错误 message、provider request id、credential、approval
token 或 secret。

## Failure taxonomy

分类值固定为 `compile`、`test`、`tool_missing`、`permission`、`environment`、`runtime`、
`timeout`、`cancelled`、`unknown`。优先使用 host-side normalized code/phase，再以有限文本
模式补足；分类函数不会返回输入 code 或 message，因此 telemetry/exporter 的 cardinality 不
随进程、命令、provider 或错误文本增长。

## Redaction and trust

HMAC key 必须只存在于 host authority；模型、renderer、command parser、VerseShell child
process 和 support consumer 都不能持有该 key。`verify` 对 JSON-like untrusted input 做严格
字段和 bounds 校验，并在 schema、签名、时钟或 expiry 不一致时返回 `undefined`。摘要从
verified envelope 重建安全对象，不对输入对象做 spread，从结构上避免 raw fields 进入结果。

## Follow-up adapter obligations

后续实现必须在 host 已经拥有 request/trace/span/parent lineage、审批已绑定且 execution owner
已确定之后签发 envelope；不得从 model-visible payload 生成 lineage。start、poll、result、
error 和 UI/support adapter 必须验证同一 authority 的 envelope，并只传递 summary 与 bounded
result/artifact digest/handle metadata。receipt-store 继续是事实 receipt owner，只保存
correlation/receipt metadata，不能由诊断结果授权 replay；raw artifact 继续由既有 owner 管理。

接线时还必须补充跨层 focused tests、真实 adapter ownership/lineage checks、support bundle
redaction checks 和与当前 `diagnostic-events.ts`/`diagnostic-error-metadata.ts` 的兼容映射。
在这些义务完成前，不得把本模块宣传为完整 trace graph、agent/UI/support bundle 关联完成，
也不得改变 default-off、kill-switch、approval、native fallback 或 rollout/product locks。

## Non-goals

- 不修改任何现有 runtime 文件或默认值。
- 不接入 `diagnostic-events`、`diagnostic-error-metadata`、`diagnostic-support-redaction`、`receipt-store`、OTLP、UI、support bundle、数据库或持久化。
- 不新增 feature flag、模型工具、审批语义、重试/fallback 语义、执行 adapter、result/artifact owner 或 Task Forest 状态。
- 不声称 `TF-0066` / VS-P2-03、P2 rollout、canary、default-on、GA 或产品批准完成。
