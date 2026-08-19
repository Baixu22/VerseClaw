# KS-08 UI 与 Observability 收敛 验收报告

- 执行者：Codex（KS-08 串行开发执行者）
- 时间 / HEAD / 分支：2026-08-18 / `734ec877e75682861103660fbdea2bd55253ece0` / `codex/knowledge-system-unification-plan`
- 本包 spec 与 evidence 路径：`harness/specs/tasks/knowledge-system-ks08-ui-observability.md` / 本文件
- 变更文件归属：memory-wiki extension lifecycle mutation + gateway RPC、electron knowledge-api lifecycle wiring 与 receipt history、shared/host-api contract、src/lib/host-api、Knowledge 页面 lifecycle UI 与 runtime degraded-write 显示、四语 i18n、unit/E2E tests、本 evidence；工作树其他 KS-00..KS-07 既有脏改动保持归属不变。

## 执行裁决

- HEAD 未移动：`734ec877e75682861103660fbdea2bd55253ece0`，分支 `codex/knowledge-system-unification-plan`。
- 未 commit、未 push、未启动 KS-09。
- 产品锁未改：`liveReady=false`、`productApproved=false`、`defaultOn=false`；普通 Chat auto-capture、SEKB auto-writeback、Runtime Memory persist/inject 均未开启。
- memory-wiki plugin 仍是 wiki page canonical mutation owner；renderer 只经 host-api，Main 只经 `gatewayManager.rpc('wiki.*')`；未新增第二 active memory writer、JSON governance 双写、DB/sidecar。

## 硬验收矩阵

| ID | 期望 | 实际 | 证据 |
|---|---|---|---|
| wiki-lifecycle-rpc | 六个 `wiki.*` 生命周期 RPC 注册并执行真实 vault mutation | PASS | `extensions/memory-wiki/src/gateway.ts` 注册 `wiki.update/merge/archive/revoke/delete/restore`；`apply.ts` lifecycle mutations |
| owner-mutation-readback | 每种 operation 真实 temp vault mutation + `wiki.get` read-back | PASS | `extensions/memory-wiki/src/apply-lifecycle.test.ts` 6/6：update 正文/revision、merge 正文与 sourceIds、archive/revoke 状态、delete get=null、restore 回 active |
| stale-zero | stale expectedRevision 接受=0 | PASS | extension update/revoke 反例断言 `/stale_revision/`；Main `knowledge-lifecycle.test.ts` stale archive 拒绝且不调 `wiki.archive` |
| idempotency | 同 key 同 digest duplicate success；异 digest conflict | PASS | `knowledge-lifecycle.test.ts` duplicate `changed:false` 且 mutation RPC 只调一次；显式同 key 异 draft digest 返回 idempotency conflict |
| main-rpc-wiring | applyReviewedChange 路由到匹配 `wiki.*`，带 CAS + idempotencyKey | PASS | `knowledge-lifecycle.test.ts` 六 op 各断言 `gatewayManager.rpc` 参数 |
| receipt-visible | apply 返回 EffectReceipt，host-api 可读 receipt history，UI 渲染 | PASS | contract `KnowledgeGovernanceReceipt`、`listGovernanceReceipts`；`knowledge-lifecycle.test.ts` receipts=1；E2E 断言 receipt JSON + history |
| degraded-write-honest | `journaled_degraded` 不显示成 persisted | PASS | Knowledge runtime confirm 结果新增 `runtime.dcsWriteLabel` badge，非 `persisted` 用 amber 样式；i18n 四语 |
| source-set-visible | KS-07 grounded/partial/missing_sources、conflict/unknown/next actions 用户可见 | PASS | Knowledge Librarian grounded answer 面板持续显示 `groundingStatus`、sources、unknowns、nextActions（`knowledge-librarian-grounded-answer`），经 host-api 获取 |
| e2e-per-operation | 六 op 各 1 条 Electron E2E：UI→Main→wiki RPC→EffectReceipt→read-back | PASS | `tests/e2e/knowledge-lifecycle.spec.ts` 6/6；E2E 在 Main 进程 monkey-patch real `gatewayManager.rpc` 并记录 `wiki.<op>` 调用 |
| no-regression | knowledge-hub E2E、knowledge-api、knowledge-page 不回退 | PASS | knowledge-hub 4/4；knowledge-api 33/33；knowledge-page 8/8；chat-knowledge-scope 8/8 |
| renderer-zero-direct | 无 direct IPC/Gateway fetch | PASS | 静态 grep 无命中；renderer 只经 `hostApi.knowledge` |
| no-second-writer | 不新增第二 writer/JSON dual-write | PASS | 仅改 memory-wiki plugin owner 与 Main host path；未动 active memory slot registry |
| no-product-lock-change | 产品锁不变 | PASS | 未触碰任何 product lock 文件 |

## 门禁记录

| 命令 | 退出码 | 关键输出 |
|---|---:|---|
| `pnpm harness context --spec ...ks08...` | 0 | 读取清单返回，scenario/rules/layers 命中 |
| `pnpm harness validate --spec ...ks08...` | 0 | `Spec is valid`（未用 `--no-diff`） |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-memory.config.ts extensions/memory-wiki/src/apply-lifecycle.test.ts` | 0 | 1 file / 6 tests passed |
| `pnpm exec vitest run tests/unit/knowledge-lifecycle.test.ts tests/unit/knowledge-governance-ui-lifecycle.test.ts tests/unit/knowledge-api.test.ts tests/unit/chat-knowledge-scope.test.ts` | 0 | 4 files / 51 tests passed（8+2+33+8） |
| `pnpm exec vitest run tests/unit/knowledge-page.test.tsx` | 0 | 1 file / 8 tests passed |
| `pnpm run test:dcs` | 0 | 20+5+10 files，344/344 tests passed |
| `pnpm run typecheck` | 0 | node+web `success:true`、exitCode 0；testTypes observation-only 1055 errors（不阻断） |
| `pnpm contract:check` | 0 | `Contract check passed.` |
| `pnpm --dir openclaw_runtime db:kysely:check` | 0 | Kysely 生成类型 `--verify` 完成 |
| `pnpm run build:vite` | 0 | renderer + Electron main/preload 构建完成 |
| `pnpm run test:e2e:run tests/e2e/knowledge-lifecycle.spec.ts` | 0 | 6 passed（40.3s） |
| `pnpm run test:e2e:run tests/e2e/knowledge-hub.spec.ts` | 0 | 4 passed（42.8s） |
| `pnpm --dir openclaw_runtime build` | 0 | **首跑即成功，未出现 3221226505**；tsdown 338.8s，总 353.5s |
| `pnpm run comms:replay` | 0 | 写入 `artifacts/comms/current-metrics.json` |
| `pnpm run comms:compare` | 0 | `Result: PASS`；delta 0.00% |
| changed-file ESLint（13 个 TS/TSX） | 0 | 0 errors / 34 warnings（均位于既有 `governanceAudit` any 与 Knowledge 既有 hook/any 行，无本包新 warning） |
| `git diff --check` | 0 | 无 whitespace 错误；仅既有 LF→CRLF 提示 |

## Honest residual

1. 全仓 `pnpm run lint:check` exit 1：`129 problems (3 errors, 126 warnings)`；3 个 error 均在非 KS 文件：`electron/utils/verseshell-runtime-bundle.ts`、`openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts`、`openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts`。
2. 全量 `pnpm test` exit 1：21 failed files / 31 failed tests / 6841 passed / 49 skipped，另有 1 个 vitest worker unexpected-exit error；失败文件全部为 VerseShell/UAS/RC/FP/FakeCoding/git-api/host-services/role-orchestration/memory-gateway 等非 KS 文件，KS-08 changed files 零失败。不宣称全仓绿灯。
3. E2E 通过真实 Main `createKnowledgeApi` 路径，但把 `gatewayManager.rpc` 替换为 Electron 测试桩（记录并返回 wiki RPC 结果）；真实 Gateway 进程级端到端仍属于 canary/soak 产品证据，不在本包工程范围内。
4. lifecycle preview 复用 proposal diff/draft body；未实现三路 diff 渲染。delete compensation 是显式 unrecoverable 说明，不做自动恢复。两者作为本包设计边界记录。
5. `pnpm --dir openclaw_runtime build` 首跑即成功，未出现 `3221226505`，不存在只报复跑成功的情况。

## 下一包 carry-over（KS-09）

- 按六个表面分别评估 shadow -> opt-in -> canary -> soak -> product approval -> consider-default-on。
- 每个表面报告 E1-E5 证据等级；E4 必须真实 provider/user task，E5 必须 soak + product approval；缺证据写 not-evaluated/blocked。
- Runtime Memory 继续 shadow/benchmark；DCS 仍唯一 authority；不新增第二 writer、DB/sidecar。
- 产品锁保持 `liveReady=false`、`productApproved=false`、`defaultOn=false`。

## 产品锁

`liveReady=false`、`productApproved=false`、`defaultOn=false` 保持不变；未开启普通 Chat auto-capture、SEKB auto-writeback 或 Runtime Memory persist/inject。

## Task Forest

- KS-07 proposal `TFP-knowledge-system-ks07-closeout-20260818` 已 apply + validate + export；KS-08 在 TF-0079 ready 后按串行协议启动。
- `proposal-save`：`TFP-knowledge-system-ks08-closeout-20260818` 已保存并通过预校验。
- 提案内容：TF-0079 `done` 100%；TF-0080 `ready` 0%；TF-0070 `in_progress` 90%。
- **已 apply**：用户确认后执行 `proposal-apply -> validate -> export`（snapshot `0104.json` 生成），并复跑 harness validate PASS；随后只启动 KS-09。

## 结论

**KS-08 ACCEPT**
