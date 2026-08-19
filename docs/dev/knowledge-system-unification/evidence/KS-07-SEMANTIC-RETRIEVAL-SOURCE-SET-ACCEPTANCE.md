# KS-07 Semantic Retrieval 与 Source Set 验收报告

- 执行者：Codex（KS-07 串行开发执行者）
- 时间 / HEAD / 分支：2026-08-18 / `734ec877e75682861103660fbdea2bd55253ece0` / `codex/knowledge-system-unification-plan`
- 本包 spec 与 evidence 路径：`harness/specs/tasks/knowledge-system-ks07-semantic-retrieval-source-set.md` / 本文件
- committed corpus 与质量报告：
  - fixture：`openclaw_runtime/src/context-engine/fixtures/source-set-ks07-corpus.json`（SHA-256 `69a85796ad88ca2b92aa771ccbb13bfac25ea80d3df8439c66f5a56d5043d7cc`）
  - 报告：`docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json`
- 变更文件归属：本包新增 `source-set.ts` / `source-set-quality.ts` 及 tests / fixture / quality runner、KS-07 spec、本 evidence、三份 README Knowledge Hub 段、WORKTREE/LATEST/NEXT-GOAL/总规划/STATUS 同步段；工作树中其他 KS-00..KS-06 既有脏改动保持归属不变。

## 执行裁决

- HEAD 未移动：`734ec877e75682861103660fbdea2bd55253ece0`，分支 `codex/knowledge-system-unification-plan`。
- 未 commit、未 push、未启动 KS-08 / KS-09。
- 产品锁未改：`liveReady=false`、`productApproved=false`、`defaultOn=false`；普通 Chat auto-capture、SEKB auto-writeback、Runtime Memory persist/inject 均未开启。
- SourceSet 是 DCS 派生产物/报告；本包未新增 DB/sidecar/向量库、第二 context authority 或第二 active memory writer。
- 本包无 UI 变更，因此按 KS-07 硬验收不增加 Electron E2E；SourceSet 用户可见性为 KS-08 carry-over。
- Task Forest 只经 CLI `proposal-save`（未 apply），未直接编辑 `nodes.json` / `edges.json`。
- RED 先行：`source-set.test.ts` 与 `source-set-quality.test.ts` 先于生产代码建立，首次运行 2 个 suite 均以 `Cannot find module` 失败，随后才实现 `source-set.ts` / `source-set-quality.ts` 并转绿；测试均为行为断言（真实 fixture、固定 clock、DCS candidate projection），无恒真/空输出伪证。

## 硬验收矩阵

| ID | 期望 | 实际 | 源码或测试路径 |
|---|---|---|---|
| source-set-deterministic | 同 query 同 fixture 同 clock 结果确定 | PASS | `source-set.test.ts` determinism 断言两次 deep-equal；引擎排序只使用确定性 score/freshness/refId |
| conflict-disclosure-100 | corpus 标注冲突全部显式披露且双侧 citation | PASS | `source-set.test.ts` claim+source 冲突；quality 报告 `conflictDisclosure=1` |
| bad-status-zero-grounded | archived/revoked/deleted/denied/stale/sensitivity/ACL 拒绝进入 grounded claim 条数=0 | PASS | `source-set.test.ts` 七类拒绝反例；quality 报告 `staleInclusion.retrieved=0` / `groundedClaims=0` |
| missing-sources-no-pseudo-citation | missing_sources 零 claim/零 citation，unknowns+next actions 显式 | PASS | `source-set.test.ts` q-missing 行为；quality `q-missing` evidenceStatus=`missing_sources` |
| citation-resolvable | 每个 grounded claim citation 解析到 owner+subjectId+revision+digest | PASS | `source-set.test.ts` 逐 citation 经 `resolveSourceSetCitation` 命中 materialized source |
| hybrid-lanes | exact 直接解析；lexical 确定性；semantic 无 provider 显式 unavailable 并降级 | PASS | `source-set.test.ts` exact/lexical/semantic/error 四条 lane 测试；provider 经 `RuntimeEmbeddingProvider` 边界注入 |
| evidence-status-rule | grounded/partial/missing_sources 由证据规则计算，无固定 confidence | PASS | `retrieveSourceSet` 只按 retrieved/conflict/unresolvedPinned 计算；测试断言输出无 `confidence` 字段 |
| runtime-memory-shadow-only | Runtime Memory 只 shadow 比较，不进入 active answer | PASS | `source-set.test.ts` shadow 前后 active 结果 deep-equal；shadow report `runtimeMemoryEnteredActiveAnswer=false`；未改注入路径 |
| ks04-regression | 既有 pinned ref 解析与拒绝 reason 不回退 | PASS | chat-knowledge-intent 7/7、context-orchestrator 10/10、context-candidate 4/4、chat-knowledge-scope 8/8 |
| quality-report | 8 项指标真实计算，human usefulness 必须 not-evaluated | PASS | `scripts/source-set-ks07-quality.mts` 实际运行写入报告：Recall@5=1、Precision@5=1、citation validity=1、stale inclusion=0、conflict disclosure=1、latency 10ms total (avg 1.67ms, max 8ms)、tokenCost 1842 est.、human usefulness=`not-evaluated (E4 missing)` |
| dcs-tests | `pnpm run test:dcs` 旧测试无回退 | PASS | 20+5+10 files，344/344（253+10+81） |
| no-new-store | 不新增 DB/sidecar/向量库/第二 authority/writer | PASS | 本包只新增纯函数引擎、JSON fixture 与报告文件，无持久化路径 |
| no-product-lock-change | 产品锁不变 | PASS | 本包未触碰任何 product lock 文件 |

## 门禁记录

按跨包门禁顺序执行；原始日志保留在 `/tmp/ks07-*.log`（本会话）。

| 命令 | 退出码 | 关键输出 |
|---|---:|---|
| `git status --short --branch` | 0 | 工作树为 KS 系列既有脏改动 + 本包新文件；未 commit |
| `git log --oneline -1` | 0 | `734ec877e chore(boot): deprecate BOOT.md writes and close out docs/i18n` |
| `git diff --check` | 0 | 无 whitespace 错误；仅既有 LF→CRLF 提示 |
| `pnpm harness context --spec ...ks07...` | 0 | 读取清单返回，scenario/rules/layers 命中 |
| `pnpm harness validate --spec ...ks07...` | 0 | `Spec is valid`（未用 `--no-diff`） |
| runtime `source-set.test.ts` + `source-set-quality.test.ts` | 0 | 2 files / 19 tests passed（17+2） |
| runtime KS-04 regression：chat-knowledge-intent / context-orchestrator / context-candidate | 0 | 3 files / 21 tests passed（7+10+4） |
| root KS-04 regression：`tests/unit/chat-knowledge-scope.test.ts` | 0 | 1 file / 8 tests passed |
| 既有 Runtime Memory focused（`memory-context-provider.test.ts` + `memory-runtime-config.test.ts`） | 0 | 2 files / 3 tests passed；`extensions.knowledge.test.ts` 在 test:dcs 内 8/8 |
| `pnpm --dir openclaw_runtime exec node --import tsx scripts/source-set-ks07-quality.mts` | 0 | 写入质量报告；Recall@5=1、Precision@5=1、citation validity=1、stale inclusion=0、conflict disclosure=1 |
| `pnpm run test:dcs` | 0 | 20 files/253 + 5 files/10 + 10 files/81 = 344 tests passed |
| `pnpm run typecheck` | 0 | node+web `success:true`、exitCode 0；testTypes observation-only 1053 errors（不阻断） |
| `pnpm contract:check` | 0 | `Contract check passed.` |
| `pnpm --dir openclaw_runtime db:kysely:check` | 0 | Kysely 生成类型 `--verify` 完成 |
| `pnpm run build:vite` | 0 | renderer + Electron main/preload 构建完成 |
| `pnpm --dir openclaw_runtime build` | 0 | **首跑即成功，未出现 3221226505**；tsdown 303.0s，总耗时 318.1s |
| `pnpm run comms:replay` | 0 | 写入 `artifacts/comms/current-metrics.json` |
| `pnpm run comms:compare` | 0 | `Result: PASS`；duplicate/loss/order violation 0，delta 0.00% |
| changed-file ESLint（`source-set.ts`、`source-set.test.ts`、`source-set-quality.ts`、`source-set-quality.test.ts`） | 0 | 0 errors / 0 warnings |
| changed-file oxlint（`openclaw_runtime/scripts/source-set-ks07-quality.mts`） | 0 | `Found 0 warnings and 0 errors` |
| `git diff --check`（final） | 0 | 无 whitespace 错误；仅既有 LF→CRLF 提示 |

补充说明：Task Forest `proposal-save` 后新增 CLI 产物 `TFP-knowledge-system-ks07-closeout-20260818.json`，已将该文件补入 spec `touchedAreas` 并复跑 `pnpm harness validate`，最终 `Spec is valid`（exit 0）。未 apply，故没有新增 snapshot；若用户确认 apply 后出现新 snapshot，将按协议只把 CLI 生成文件补入 spec 并复跑 validate。

## Honest residual

1. committed 质量跑分为 exact/lexical 实跑：离线工作树没有配置真实 embedding provider，semantic lane 显式 `semantic:unavailable` 并降级 lexical。semantic 分支由 deterministic in-process provider 行为测试覆盖，不能写成真实 provider 证据。
2. `humanUsefulness` 保持 `not-evaluated (E4 missing)`；committed fixture 是 synthetic-agent corpus，不冒充 E4/E5，不推导 default-on/GA。
3. SourceSet 尚无用户可见 Knowledge UI 面；grounded/partial/missing_sources、conflict set、unknowns、suggested next actions 的可见性是 KS-08 carry-over。
4. memory-wiki `wiki.*` 生命周期 Main RPC 与 Knowledge lifecycle UI/per-operation Electron E2E 仍未实现，继续为 KS-08 强制 carry-over，本包未提前实现。
5. 全仓 `pnpm run lint:check` exit 1：`129 problems (3 errors, 126 warnings)`；3 个 error 均在非 KS 文件：`electron/utils/verseshell-runtime-bundle.ts`、`openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts`、`openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts`。本包 changed-file ESLint/oxlint 0 errors / 0 warnings。
6. 全量 `pnpm test` exit 1：21 failed files / 31 failed tests / 783 passed / 3 skipped（807 files），失败文件全部在非 KS 文件（VerseShell、UAS、RC、role-orchestration、memory-gateway、FakeCoding、git-api、host-services、first-product-claims、config-schema、chat-ui 等基线 surface，具体文件见下）。本包 changed files 零失败，不宣称全仓绿灯。

全量 test 失败文件（全部非本包 changed files）：

```text
tests/integration/p1-orchestration-boundary.integration.test.ts
tests/integration/p1-sensitive-content-boundary.integration.test.ts
tests/unit/agency-role-importer.test.ts
tests/unit/chat-leading-orphan-tools.test.tsx
tests/unit/chat-send-input-mode.test.ts
tests/unit/chat-tool-card-suppression.test.tsx
tests/unit/config-schema-parity.test.ts
tests/unit/fakecoding-design-system.test.ts
tests/unit/first-product-claims.test.ts
tests/unit/git-api.test.ts
tests/unit/host-services.test.ts
tests/unit/memory-gateway-handlers.test.ts
tests/unit/rc01-authority-inventory-baseline.test.ts
tests/unit/rc09-ownership-matrix.test.ts
tests/unit/role-orchestration-methods.test.ts
tests/unit/runtime-authority-convergence-control-pack.test.ts
tests/unit/uas-00-evidence-freeze.test.ts
tests/unit/uas-05-verseshell-process-lifecycle.test.ts
tests/unit/uas-06-single-local-exec-canary.test.ts
tests/unit/verseshell-manifest.test.ts
tests/unit/verseshell-runtime-bundle.test.ts
```

## 下一包 carry-over（KS-08）

1. 接入 memory-wiki `wiki.*` 生命周期 Main RPC：update/merge/archive/revoke/delete/restore，并补齐真实 owner mutation/read-back 证据。
2. 实现 Knowledge 页面 lifecycle UI，并为每种已支持 operation 至少增加 1 条 Electron E2E。
3. 让 SourceSet 的 evidenceStatus / conflict set / unknowns / suggested next actions / citation 对用户可见（KS-07 新增可见性需求）。

## 产品锁

`liveReady=false`、`productApproved=false`、`defaultOn=false` 保持不变；未开启普通 Chat auto-capture、SEKB auto-writeback 或 Runtime Memory persist/inject。

## Task Forest

- `proposal-save`：`TFP-knowledge-system-ks07-closeout-20260818` 已保存并通过预校验。
- 提案内容：TF-0078 `done` 100%；TF-0079 `ready` 0%（summary 写明两项 KS-06 carry-over + SourceSet 可见性）；TF-0070 `in_progress` 80%（summary 更新为 KS-00..KS-07 已实现）；TF-0080 不改。
- **已 apply**：用户确认后执行 `proposal-apply -> validate -> export`（snapshot `0103.json` 生成），并复跑 harness validate PASS；随后只启动 KS-08。
- 全程未直接编辑 `nodes.json` / `edges.json`。

## 结论

**KS-07 ACCEPT**
