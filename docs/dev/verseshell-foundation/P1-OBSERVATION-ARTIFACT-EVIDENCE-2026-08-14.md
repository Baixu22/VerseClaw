# VS-P1-02 Bounded Observation、Artifact 与 Result Query 证据

日期：2026-08-14  
Task Forest：`TF-0062` / VS-P1-02  
Scoped spec：[`verseshell-p1-observation-artifact.md`](../../../harness/specs/tasks/verseshell-p1-observation-artifact.md)  
Candidate HEAD：`2aed2b48ff4c4ef02be8ab2bb44eda76f191d6e8`  
Base HEAD parent：`ca86a65501d9125d53b0353f4c9c8484def474c1`  
工作树状态：dirty；候选包含大量共享工作树改动，因此本文件是当前工程验证记录，不是 clean-release 或 canary 证据。

## 范围

本包承接 P1-01 的 process/lifecycle owner，统一结果平面的 bounded observation、artifact
lineage、expiry 和 `result.query` contract。实现范围限定在 shared VerseShell contract、OpenClaw
normalizer/governed execution/result tool 以及 scoped tests；不新增 model-facing operation，不启用
MCP、legacy eval、write transaction、native fallback、provider canary 或任何 rollout/product lock。

## 实现结果

- `shared/verseshell/types.ts` 定义独立 JSON frame/observation/result bounds、stream capture、
  artifact descriptor、owner/process lineage、retention/expiry、digest 和六种 bounded query mode。
- `shared/verseshell/validation.ts` fail-closed 解码 artifact handle/digest、raw/retained/omitted
  bytes、created/expiry、owner、query capability 与 mode-specific bounds；`decodeStreamCapture`
  兼容当前 verified runtime 的 `encoding`、`raw_complete`、`returned_bytes` 字段，并在缺省
  `retained_bytes` 时由 `raw_bytes - omitted_bytes` 严格推导。
- `shared/verseshell/extraction.ts` 只从已验证 JSON 中提取唯一 artifact handle 或完整 descriptor；
  malformed `result://` 内容、digest drift、expiry 和 owner mismatch 不会降级为普通文本。
- `normalizer.ts` 对 JSON frame 设独立上限，排除 stats/gc control frame，并只投影 validated
  stream/artifact metadata；原始命令、approval token 和无界输出不进入 normalized result。
- `governed-exec.ts` 在 transport 前校验 `meta/head/tail/slice/grep/raw` 参数，限制 response bytes，
  检查 `result.query` operation，拒绝空成功结果、失效 artifact 和 owner drift，不重放 effectful
  action，也不切换到其他执行 owner。
- `result-tool.ts` 继续复用既有 `artifactResults`/kill-switch/default-off gate；没有扩大模型工具面。

## 命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p1-observation-artifact.md` | PASS；生成最小 read order |
| `pnpm harness validate --no-diff --spec harness/specs/tasks/verseshell-p1-observation-artifact.md` | PASS；spec valid |
| `pnpm harness validate --spec harness/specs/tasks/verseshell-p1-observation-artifact.md` | BLOCKED；共享工作树存在大量不属于 touchedAreas 的无关改动，且 harness 子包本地依赖缺失 |
| `pnpm exec vitest run --config vitest.agent-dev.node.config.ts tests/unit/verseshell-observation-artifact.test.ts tests/unit/verseshell-extraction.test.ts tests/unit/verseshell-contracts.test.ts` | PASS；15/15 |
| `pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1` | PASS；12 files / 64 tests |
| `pnpm verseshell:test` | PASS；bundle 13/13，runtime-bundle 11/11，OpenClaw 64/64 |
| `pnpm run typecheck:node` | PASS |
| `pnpm run typecheck:web` | PASS |
| scoped `pnpm exec eslint ...` | PASS |
| scoped `pnpm --dir openclaw_runtime exec oxlint ...` | PASS |
| `pnpm run comms:replay` | PASS；刷新 `artifacts/comms/current-metrics.json` |
| `pnpm run comms:compare` | PASS；message loss/duplicate/order violation 与 RPC timeout 均为 0 |
| `git diff --check` | BLOCKED by pre-existing unrelated trailing whitespace in `src/lib/mock-host-bridge.ts:239`; touched VerseShell paths clean |

## 场景矩阵

| 场景 | 结果 |
|---|---|
| oversized JSON frame | parser 在独立 frame bound 前拒绝 |
| oversized observation | `decodeObservation` 保持 observation byte bound，拒绝超限 payload |
| stdout/stderr truncation | 保留 `status`、`raw_bytes`、`returned/retained_bytes`、`omitted_bytes`、artifact handle；无静默丢失 |
| malformed handle/digest | `artifact_invalid` 或 `artifact_digest_mismatch`，不降级为文本 |
| artifact expiry | `artifact_expired`，不返回空成功结果 |
| artifact owner drift | `artifact_owner_mismatch`，不切换 execution owner |
| missing query data | `E_VERSESHELL_RESULT_MISSING`，不伪装成成功 |
| mode/range/pattern over-bound | transport 前拒绝或按既有 bounded clamp 规则构造有限请求 |
| runtime restart/recovery | 沿用 P1-01 process owner；result.query 不重放 `exec.run` |
| kill switch/default-off | 既有 `artifactResults` 与 kill-switch gate 保持关闭语义 |

## 残余与裁决

普通 diff-aware Harness validate、完整 aggregate typecheck/lint 和 repository-wide `git diff --check`
没有被解释为通过：共享工作树 ownership residual、harness 子包依赖缺失、既有 test-project observation
errors 与无关 whitespace 均显式保留。上述残余不扩大本包 touchedAreas，也不解除 P1-02 之前的
release/canary 门禁。

当前 rollout/product locks 必须保持：`default-off`、`liveReady=false`、`productApproved=false`、
`defaultOn=false`。P1-02 closeout proposal 尚未应用，故 `TF-0063` / VS-P1-03 仍保持 blocked。

