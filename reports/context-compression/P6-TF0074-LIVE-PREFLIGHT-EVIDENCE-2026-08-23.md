# P6 TF-0074 live preflight evidence（2026-08-23）

## 结论

TF-0074 剩余的 independent live judge / schema-free / real continuation 已完成
执行前预检（preflight）：在无凭据环境下以与正式 live run 完全一致的参数运行
eval runner，确认当前源码绑定的固定验收链路全部就绪，唯一缺失输入是
provider 凭据。runner 在无凭据时于任何 provider 请求之前 fail-closed
（`executed=false` + 明确 reason），未发起任何外部请求，无伪造输出。

生产继续 `promotionStage: "shadow"`。本 preflight 不构成 live quality
acceptance，`layer3Gate` 仍为 `NOT EXECUTED`。

## 关键发现：旧冻结摘要与当前源码标准不兼容

以 2026-08-18 冻结的 `production-summaries-30-generated.jsonl`（旧
compact() 代码生成）作为 paired 输入时，当前源码的 deterministic 层大面积
FAIL：

- L1 gate：`0.2361`（要求 >=0.90）
- verified claims retention：`25/189 = 0.1323`
- critical dropped verified claims：`105`（30/30 样本均有 critical drop）
- deterministic L2：`4.8`（要求 10）

这意味着旧冻结摘要不能再作为当前源码的 live 验收输入；正式 live run 必须
使用当前源码绑定的 Recovery Ledger 摘要（与 2026-08-21 deterministic
batch 相同来源）。该结论与 TF-0074 deterministic 证据中「不使用旧
v14/auto live 结果冒充当前源码证据」的边界一致。

Preflight 产物：
`artifacts/p6-tf0074-live-preflight/2026-08-23T04-47-27-831Z/`（旧冻结摘要，
negative 证据）。

## 当前源码 preflight 结果（PASS-_ready）

以 `artifacts/p6-tf0074-deterministic-recovery-30/would-retry-summaries.jsonl`
（当前源码 model-free Recovery Ledger batch 产物，manifest sha256
`6677b500…fc82c` 绑定）作为 paired 输入：

- 产物：`artifacts/p6-tf0074-live-preflight-current/2026-08-23T04-49-40-717Z/`
- manifest resolve：`30/30`，`valid=true`，`missing=[]`
- L0 recall / stale exclusion：`1.0 / 1.0`
- L1 critical recall mean/min：`1.0 / 1.0`
- verified claims retention：`189/189 = 1.0`
- critical dropped claims：`0`；samples with critical drop：`0`
- `layer2Gate.pass=true`
- acceptance checks：`22/31` PASS；9 项 FAIL 全部为 live 证据门
  （judge/schema-free/continuation 的 executed/coverage/gate），失败原因
  均为 `COMPACTION_API_KEY is not set in the environment …`，属预期
  fail-closed。
- 固定输入 sha256 复验：
  - `production-manifest-30.json` =
    `6677b500a08c1ec3e4c1c474096d005f940726d7ec088158c6df8456d21fc82c`
  - `production-summaries-30-generated.jsonl` =
    `9a7021be463d41d13dde93fbb5a65f7a3d6794cb696fcc877d18ec9ce6d09957`
    （字节未变；不合格是语义标准提高所致，非文件损坏）

## 本地门禁复验（2026-08-23）

- root focused：`compression-artifact` 17 + `context-compression-eval` 37 +
  `context-runtime-kit-compression-artifact` 2 +
  `context-runtime-kit-recovery-context` 7 +
  `context-runtime-kit-recovery-default` 3 = 66/66 PASS
- runtime focused：agent-hooks compaction 6 文件 54 +
  agent-core compaction 2 文件 9 + `sessions.recall` 19（双 project 38）+
  `context-orchestrator` 15 + `deprecation-counters`（含于上述运行）PASS
- would-retry canary self-test：`would-retry recovery injection self-test
  passed`

## 正式 live run 命令（runbook）

凭据只经环境变量注入，禁止写入任何文件（用后可轮换）：

```bash
DEEPSEEK_API_KEY=<用户提供> node scripts/context-compression-eval-runner.mjs \
  --target D:/verse_claw_worktree_compact \
  --samples 30 --sample-source real --real-samples 30 --suite full \
  --transcript-root C:/Users/27933/.openclaw \
  --sample-manifest reports/context-compression/production-manifest-30.json \
  --paired-summary artifacts/p6-tf0074-deterministic-recovery-30/would-retry-summaries.jsonl \
  --full-real-min 30 \
  --compression-model deepseek-chat \
  --judge-model deepseek-reasoner \
  --continuation-model deepseek-reasoner \
  --critic-model deepseek-reasoner \
  --schema-free-samples 30 \
  --llm-judge --llm-schema-free --llm-continuation --llm-critic \
  --no-cache \
  --out artifacts/p6-tf0074-live-acceptance
```

- 亦可用任意 OpenAI-compatible 端点：`COMPACTION_API_KEY` +
  `COMPACTION_BASE_URL`（默认 DeepSeek 官方端点时无需设置）。
- 模型级联：compressor=`deepseek-chat`，judge/schema-free/continuation/
  critic=`deepseek-reasoner`（modelIndependence 门要求）。
- 参考：上一次全量 live run（v14，旧源码）耗时约 33 分钟，live 请求
  judge/schema-free/continuation 各 30 条。
- 放行门槛不变：critical dropped samples=0、schema-free major omission
  <=0.10、real continuation critical action >=0.95、stale leakage=0、
  completion delta <=0.08、no fabrication >=0.98、modelIndependence.ok=true。
  任何一门不达标保持 `shadow`，不伪造。

## 边界

本 preflight 不解锁 TF-0075，不提升 `liveReady`、`productApproved`、
default-on，不改变 promotion stage。live 执行本身仍等待用户明确授权并提供
可轮换凭据。
