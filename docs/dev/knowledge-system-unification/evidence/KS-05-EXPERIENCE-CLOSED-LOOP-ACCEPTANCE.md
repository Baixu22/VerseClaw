# KS-05 经验闭环 验收证据（2026-08-17）

## 1. 执行裁决

- 工作树：`D:\verse_claw_worktree_knowledge`，分支 `codex/knowledge-system-unification-plan`。
- 基线 HEAD：`734ec877e75682861103660fbdea2bd55253ece0`。
- 产品锁未改：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。
- 本包只做 KS-05：SEKB 经验闭环；未启动 KS-06，未改 product locks，未 commit/push。
- Task Forest：KS-04 proposal `TFP-88df65a6ed` 已 apply；TF-0075 done(100%)，TF-0076 ready(0%)，KS-05 完成后将保存 proposal 等待用户确认。

## 2. 硬验收逐项

| ID | 验收 | 结果 | 证据 |
|---|---|---|---|
| KS-05-1 | 未确认 suggestion durable write = 0 | PASS | `experience-closed-loop.test.ts` 断言 suggest 后 `query_principles({})` 长度 0；`golden-path.test.ts` 既有 ANTI-8 断言继续通过 |
| KS-05-2 | 自动 Principle writeback = 0 | PASS | `runSekbGoldenPath` 仍返回 `autoWriteback:false`、`noAutoWriteback:true`；`golden-path.test.ts` 2/2 |
| KS-05-3 | `record_adoption` 只接受 cited/adopted/outcome 证据 | PASS | `knowledge-store.ts` `record_adoption(principle_id, evidence)` 证据门禁：非法 trigger 或非 boolean `taskSucceeded` 抛错且不改计数；`experience-closed-loop.test.ts` 反例断言 |
| KS-05-4 | 真实 SQLite E2E：失败任务 -> candidate -> human confirm -> fresh session recall -> citation -> outcome -> effectiveness 变化 | PASS | `experience-closed-loop.test.ts` 2 条真实 SQLite 失败 trajectory -> suggest -> confirm（human）-> `RetrievalEngine.retrieve_for_task` 命中 -> cited+outcome 证据 -> `adoption_count/post_adoption_success` 变化 |
| KS-05-5 | archive/delete 后 fresh session 不召回旧 experience | PASS | `experience-closed-loop.test.ts` archive 后 recall 0 命中；delete 后 `get_principle` 抛错 |
| KS-05-6 | retrieval_count 不得驱动 adoption | PASS | `experience-closed-loop.test.ts` 召回后 `retrieval_count>=1` 但 `adoption_count/post_adoption_success` 仍为 0 |

## 3. 门禁记录

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm harness context --spec ...ks05...` | 0 | 读取顺序正常 |
| `pnpm harness validate --spec ...ks05...` | 0 | `Spec is valid`（未用 `--no-diff`） |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/experience-closed-loop.test.ts` | 0 | 2 tests passed |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts src/knowledge/sekb/golden-path.test.ts src/knowledge/sekb/batch-distillation-assistant.test.ts src/knowledge/sekb/experience-block-bridge.test.ts` | 0 | 4 files / 37 tests passed |
| `pnpm run test:dcs` | 0 | 20+5+10 files，344 tests passed |
| `pnpm run typecheck` | 0 | node+web `success:true`，exitCode 0；`testTypes` observation-only 1053 errors 不阻断 |
| `pnpm contract:check` | 0 | `Contract check passed.` |
| `pnpm --dir openclaw_runtime db:kysely:check` | 0 | `--verify` 完成 |
| `pnpm run build:vite` | 0 | vite client+electron build 完成 |
| `pnpm --dir openclaw_runtime build` | 0 | 首跑 tsdown 3221226505（174.5s）后资源释放复跑成功；tsdown 266.9s，总 281.5s |
| `pnpm run comms:replay` | 0 | 所有场景 0 丢失/重复/乱序 |
| `pnpm run comms:compare` | 0 | delta 0.00% |
| `pnpm exec eslint <KS-05 changed TS files>` | 0 | 0 errors / 0 warnings |
| `pnpm run lint:check` | 1 | 3 errors / 126 warnings（baseline residual，见下） |
| `git diff --check` | 0 | 无 whitespace 错误 |

## 4. Honest residual

- 全仓 `pnpm run lint:check` exit 1：3 errors / 126 warnings；3 个 error 均位于非 KS-05 变更文件（provider-stream-shared、happy-path-prompt-snapshots、verseshell-runtime-bundle）。本包 changed-file ESLint 0 errors / 0 warnings。
- 全量 `pnpm test` 本包未在 KS-05 改动后重跑；本会话 KS-05 前已实测 21 failed files / 31 failed tests / 782 passed / 3 skipped，均为 VerseShell/UAS/RC/first-product-claims/git-api/host-services/fakecoding/config-schema/memory-gateway/role-orchestration 等 baseline surface，与本包无关。本包 focused tests、`test:dcs`、comms 全部单独全绿。
- `pnpm --dir openclaw_runtime build` 首跑 tsdown 以 3221226505 失败，已如实记录；资源释放后复跑 exit 0，未伪装成一次通过。
- KS-05 不构成 default-on/GA/productApproved/真人采用证据；产品锁仍为 false。

## 5. Task Forest

- 已通过 CLI 保存 proposal：`TFP-503710a9d8`（未 apply，等待用户确认）。
- 提案内容：TF-0076 done(100%)；TF-0077 ready(0%)；TF-0070 in_progress(60%)。
- 未直接编辑 `nodes.json` / `edges.json`；`task_forest.py validate` PASS。
- 用户确认前：不 apply KS-05 proposal、不 commit、不 push、不启动 KS-06。

## 6. 产品锁

`liveReady / productApproved / defaultOn / auto-capture / auto-writeback / Runtime Memory persist+inject` 全部未改。
