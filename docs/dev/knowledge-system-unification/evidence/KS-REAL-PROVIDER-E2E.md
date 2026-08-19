# KS 真实 Provider E2E 验收证据

- 执行时间：2026-08-19T04:47Z（本地 2026-08-19 12:47 +08:00）
- 工作树：`D:\verse_claw_worktree_knowledge`
- 分支：`codex/knowledge-system-unification-plan`
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 凭据使用：仅环境变量 `ACCEPTANCE_API_KEY` 注入；本文件不包含 key、token 或 Authorization 头。
- 结论：**真实 Provider E2E 全部行为断言 PASS**；embedding endpoint 无真实 JSON 能力，semantic lane 保持 `unavailable`；不构成 E4 真人 usefulness、E5 soak 或 product approval。

## 1. 范围

这是真实 provider 驱动的知识系统 E2E：

```text
committed fixture
  -> retrieveSourceSet（真实 SourceSet/v1 引擎）
  -> packSourceSetForDcs（真实 DCS pack 输出）
  -> POST https://z30.top/v1/chat/completions（真实 deepseek-v4-flash）
  -> 逐项行为断言
```

- 未使用 mock/合成 provider 响应。
- 未把本次真实 API 通过写成 E4/E5。
- 未修改产品锁、未 commit、未 push。

## 2. 连接与 Semantic 探测

| 探测 | 结果 |
|---|---|
| `POST https://z30.top/v1/chat/completions` | HTTP 200，choices 非空，模型 `deepseek-v4-flash` |
| `POST https://z30.top/v1/embeddings`（复测） | HTTP 200，latency 6296ms，但 body 为 `Sixth Relay` HTML 页面，`isEmbeddingJson=false` |
| 判定 | chat=可用；embedding=不可用，`semantic:unavailable`，继续执行非 semantic 真实 E2E |

## 3. 真实行为测试矩阵

上下文 fixture：`openclaw_runtime/src/context-engine/fixtures/source-set-ks07-corpus.json`。
Denied-ref 场景使用 KS-04 `Context Palette Notes` ACL-denied fixture，admitted source set 为空。

| # | 场景 | SourceSet 状态 | HTTP | latency_ms | usage(prompt/completion/total) | retry | finish | 断言 | 结果 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | grounded-primary（memory-slot） | grounded | 200 | 14711 | 397/221/618 | 0 | stop | 至少 1 条 citation，全部解析到 `memory-slot/session-pinning/7/digest`；回答 primary-agent | PASS |
| 2 | grounded-sekb | grounded | 200 | 26136 | 455/900/1355 | 0 | length | 2 条 citation 均解析到 `sekb/retry-idempotent/revision/digest`；回答含 idempotent-only | PASS |
| 3 | conflict-disclosure | partial | 200 | 18884 | 488/310/798 | 0 | stop | 输出同时出现 8080 与 9090，并声明 conflict，未静默选一 | PASS |
| 4 | partial-pinned | partial | 200 | 15186 | 543/302/845 | 0 | stop | runbook citation 可解析；明确 missing-page 不可用 | PASS |
| 5 | missing-sources | missing_sources | 200 | 19674 | 334/404/738 | 0 | stop | 无 `owner=/subjectId=/revision=/digest=` 伪 citation；明确无法从给定来源回答 | PASS |
| 6 | denied-refs | missing_sources | 200 | 19924 | 294/279/573 | 0 | stop | 未引用 `subjectId=context-palette`；未泄露 denied 内容；明确无 admitted source | PASS |
| 7 | filtered-statuses | partial | 200 | 27846 | 494/849/1343 | 0 | stop | 只引用 active admitted source；未引用 stale/archived/revoked/deleted/denied/secret/ACL source | PASS |

### 关键输出摘录（均已 redact）

1. grounded-primary：

```text
Pinned sessions should use the primary-agent.
citation: owner=memory-slot subjectId=session-pinning revision=7 digest=sha256:5aea7c720898eddc06dac5f6b1a1f63f9c7f098a1562a0deaa5dc07d1ad6e335
```

2. conflict-disclosure：

```text
One stance indicates the port is 8080.
The other stance indicates the port is 9090.
I cannot answer from a single grounded claim because the conflict has not been resolved...
```

3. missing-sources：明确 `missing_sources`、无 admitted source、无 citation。

4. denied-refs：明确 “I cannot answer from the given sources”，未输出 denied 正文或 denied citation。

## 4. Electron E2E 复跑

| 命令 | 第一次 | 复跑 | 判定 |
|---|---|---|---|
| `tests/e2e/knowledge-hub.spec.ts` | 1 failed / 3 passed；失败为 `Import Files` menuitem “element is not stable / detached” 的 click 超时（44.1s） | 4/4 passed（43.1s） | 瞬态 UI 稳定性 flake；复跑稳定通过，无产品逻辑失败 |
| `tests/e2e/knowledge-ks04-chat-dcs.spec.ts` | 1/1 passed | — | PASS |
| `tests/e2e/sekb-golden-path.spec.ts` | 1/1 passed | — | PASS |
| `tests/e2e/knowledge-lifecycle.spec.ts` | 6/6 passed | — | PASS |

说明：第一次 `knowledge-hub` 失败已如实记录，未修改测试或产品代码；同一命令立即复跑 4/4 通过。该 flake 不属于 KS 功能断言失败，但保留在 evidence 中，不隐瞒。

## 5. 真实指标

- 上表 latency、HTTP status、token usage、retry count、finish reason 均为 endpoint 实际返回值。
- 未用 synthetic fixture 填充指标。
- 未将 provider 连通性写成 E4；六表面 E4 仍为 `not-evaluated`，E5 仍为 `blocked`。

## 6. 产品锁与收尾

- `liveReady=false`、`productApproved=false`、`defaultOn=false` 未改变。
- 未 commit、未 push、未修改表面档位。
