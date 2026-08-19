# KS-01～KS-03 验收证据（2026-08-17）

## 1. 执行裁决

- 工作树：`D:\verse_claw_worktree_knowledge`，分支 `codex/knowledge-system-unification-plan`。
- 产品锁：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false` 均未改变。
- 不新增 DB/sidecar/provider/第二 memory writer；Runtime Memory persist/inject 仍关闭。
- KS-00 已冻结 authority/schema/状态源；KS-01→KS-02→KS-03 串行实现。

## 2. 硬验收逐项

| ID | 验收 | 结果 | 证据 |
|---|---|---|---|
| KS-01-1 | 10 Draft/Proposal 交叉排列不错配 | PASS | `knowledge-api.test.ts` cross-pairing test |
| KS-01-2 | stale approval 100% conflict-fail | PASS | update-after-approve returns `stale_revision`/`stale_digest`, zero `wiki.apply` |
| KS-01-3 | 并发相同 captureKey 只产生一个 candidate | PASS | 12 并发 `createInboxItem` -> 1 id |
| KS-01-4 | crash 后无 applied proposal + unapproved draft | PASS（journal 恢复路径） | `wiki_committed` journal 跳过重复 RPC 并补 JSON transition |
| KS-01-5 | Semantic Steward 10/10 | PASS | `knowledge-steward-semantic-pass.test.ts` 10/10，createKnowledgeApi 不再覆盖显式注入 invoker |
| KS-02-1 | confirm 并发/重试只一个 Principle revision + 一个 projection | PASS | lineage tests: 3 并发 -> 1 principle row + 1 experience block |
| KS-02-2 | BlockStore 不可用 persisted 计数 0 | PASS | journal sink -> `journaled_degraded`；`persisted` 仅 blockstore + read-back |
| KS-02-3 | 删除后 Principle/trajectory/MemoryCard/context_blocks/journal/archive residual 0 | PASS | `session-cascade-delete.test.ts` 真实 SQLite block 删除后 enumerate=0；archive/transcript 由同一 finalizer 路径 |
| KS-02-4 | 同一 session key 新建不召回旧 experience | PASS | block row hard-deleted，`query` 无结果 |
| KS-02-5 | 未确认 suggestion durable write 0 | PASS | `suggest_principles_from_trajectories` 仍无 sink 调用 |
| KS-03-1 | JSON 导入 count/digest parity 100% | PASS | migration report jsonCount=importedCount |
| KS-03-2 | JSON writer 0 + compat read 有移除窗口 | PASS | new inbox/draft/proposal 在 SQLite；legacy JSON 只读，report `one release window` |
| KS-03-3 | adapter contract tests 全绿 | PASS | `governance-adapters.test.ts` 5/5 |
| KS-03-4 | Runtime Memory persist/inject 关闭 | PASS | 未改 runtime memory wiring；registry 只注册 Role Memory active slot |

## 3. 门禁复跑

- `pnpm harness context` + `pnpm harness validate`：KS-01 / KS-02 / KS-03 PASS；KS-00 `--no-diff` PASS。
- `pnpm run typecheck`：PASS（node+web）。
- `pnpm contract:check`：PASS。
- `pnpm --dir openclaw_runtime db:kysely:check`：PASS。
- `pnpm run test:dcs`：PASS（20+5+10 files, 344 tests）。
- Knowledge/SEKB 聚焦 162/162、Runtime 聚焦 51/51。
- `pnpm run comms:replay` / `compare`：PASS（0 丢失/重复/乱序，延迟 delta 0.00%）。
- `pnpm run build:vite`：PASS。
- `pnpm run test:e2e:run tests/e2e/knowledge-hub.spec.ts`：4/4 PASS（执行前 `unset ELECTRON_RUN_AS_NODE`）。
- changed-file ESLint：0 error。

## 4. Honest residual

- 全仓 `pnpm run lint:check` 仍报 4 个非本轮基线 error（provider-stream-shared、happy-path-prompt-snapshots 等）；本轮 changed files 0 error。
- 全量 root Vitest 仍红在基线 surface：VerseShell manifest/bundle、first-product-claims、RC-01/RC-09 evidence baseline、runtime-convergence evidence manifest 缺失、git-api/host-services/fakecoding/config parity 等环境/基线用例；本轮相关 Knowledge/SEKB/cascade 文件全绿，不宣称全仓绿灯。
- E2E 属 Electron 路径验证（E3），不构成 E4/E5 真人采用或 soak 证据。


## 5. 独立验收修复补丁与复验（2026-08-17 晚）

独立验收发现两个问题，已修复并复验：

1. **Semantic Steward DI**：`createKnowledgeApi` 原先在传入 `gatewayManager` 时无条件覆盖显式注入的 invoker。现以 `semanticStewardInvokerExplicitlyInjected` 标记区分显式注入与生产 wiring；生产 wiring 仅在无显式注入时安装。回归断言补入既有语义测试（仍 10/10），证据：`electron/services/knowledge-api.ts`、`tests/unit/knowledge-steward-semantic-pass.test.ts`。
2. **runtime build 首跑失败**：首跑 `pnpm --dir openclaw_runtime build` 在 tsdown 阶段以 3221226505 退出；在系统资源释放后复跑 exit 0（tsdown 356.3s）。首跑失败未伪装成通过，终版门禁以复跑为准。
3. 顺带修正：文档中 TF-0075 “全 Task Forest 唯一 ready”改为“统一知识系统 KS 链中唯一 ready”；独立验收报告路径登记进 KS-01/02/03 `touchedAreas`；移除 semantic test 中一个未使用 import，changed-file ESLint 恢复 0 errors。

复验关键门禁：

- KS 聚焦 94/94、级联 13/13、Runtime 聚焦 42/42、DCS 344/344、Governance 9/9。
- typecheck node/web PASS；contract/db/build:vite/runtime build PASS；comms replay/compare PASS。
- knowledge-hub E2E 4/4 PASS；changed-file ESLint 0 errors / 34 warnings。
- 全仓 `lint:check`：3 个非 KS 基线 error（provider-stream-shared、happy-path-prompt-snapshots、verseshell-runtime-bundle）。
- 全量 `pnpm test`：20 files / 31 tests 失败，均为非 KS 基线 surface（VerseShell/UAS/RC/first-product-claims/git-api/host-services/fakecoding/config-schema 等），不宣称全仓绿灯。
