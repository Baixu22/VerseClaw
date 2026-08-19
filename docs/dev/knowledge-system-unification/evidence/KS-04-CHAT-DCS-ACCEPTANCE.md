# KS-04 Chat/DCS 单一消费路径 验收证据（2026-08-17）

## 1. 执行裁决

- 工作树：`D:\verse_claw_worktree_knowledge`，分支 `codex/knowledge-system-unification-plan`。
- 基线 HEAD：`734ec877e75682861103660fbdea2bd55253ece0`。
- 产品锁未改：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。
- 本包只做 KS-04：Chat/DCS 单一消费路径；未启动 KS-05/KS-06，未改 product locks，未 commit/push。
- Harness spec：`harness/specs/tasks/knowledge-system-ks04-chat-dcs-single-path.md`（validate 通过，未用 `--no-diff`）。

## 2. 硬验收逐项

| ID | 验收 | 结果 | 证据 |
|---|---|---|---|
| KS-04-1 | Main 不再为 sendWithMedia 调用 wiki.get，也不把 snippet/正文拼进 prompt | PASS | `electron/services/chat-api.ts` 无 `wiki.get`/`snippet`/`clawxKnowledge*`；`tests/unit/chat-knowledge-scope.test.ts` 8/8 |
| KS-04-2 | Chat reference payload 只携带 typed ref | PASS | Main 侧 `normalizeKnowledgeReferences` 丢弃 snippet；Gateway `ChatKnowledgeReferenceSchema` `additionalProperties:false` 且无 body 字段 |
| KS-04-3 | Gateway 将 refs 转成 untrusted read-only retrieval intent | PASS | `openclaw_runtime/src/gateway/server-methods/chat.ts` 在 dispatch 前调用 `resolveChatKnowledgeIntent`，ack 返回 `knowledgeDenials` |
| KS-04-4 | owner source adapters 解析 refs | PASS | `chat-knowledge-source-adapters.ts` 注册 memory-wiki / memory-slot(Role Memory) / SEKB 三个真实 adapter |
| KS-04-5 | DCS 统一 admission/resolve/pack，Provider Guard 后无未登记 prompt mutation | PASS | 已解析 refs 经 `dcs-knowledge` ContextCandidate 生产路径注入（`extensions.ts` 收集候选；`chat-knowledge-intent.test.ts` 用真实 finalizer 断言 selected/applied） |
| KS-04-6 | pinned ref 被拒绝时产生可见 reason | PASS | ack 返回 `knowledgeDenials`；Main `ChatSendWithMediaResult.knowledgeDenials`；`src/stores/chat.ts` toast 展示（en/zh/ja/ru i18n）；`tests/e2e/knowledge-ks04-chat-dcs.spec.ts` 1/1 PASS 断言 toast 与 `visibleReason` |
| KS-04-7 | revoked/ACL denied/stale/not found delivered = 0 | PASS | `chat-knowledge-intent.test.ts` 5 类 denial 全 0 admitted 且 visibleReason 非空 |
| KS-04-8 | renderer direct IPC/Gateway fetch = 0 | PASS | 静态 grep 无命中；既有 `host-api-facade.test.ts` 43/43 |
| KS-04-9 | comms replay/compare PASS | PASS | 见门禁记录 |
| KS-04-10 | 既有相关测试不回退 | PASS | chat-knowledge-scope 8/8、chat-save-to-knowledge 1/1、host-api-facade 43/43、context-orchestrator 10/10、context-candidate 4/4、rc03-seal 14/14、rc03-seal-wiring 14/14 |

## 3. 门禁记录

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm harness context --spec ...ks04...` | 0 | 读取顺序正常 |
| `pnpm harness validate --spec ...ks04...` | 0 | `Spec is valid` |
| `pnpm exec vitest run tests/unit/chat-knowledge-scope.test.ts tests/unit/chat-save-to-knowledge.test.tsx tests/unit/host-api-facade.test.ts` | 0 | 3 files / 52 tests passed |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/chat-knowledge-intent.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/context-candidate.test.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts` | 0 | 5 files / 49 tests passed |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts packages/gateway-protocol/src/schema/logs-chat.test.ts` | 0 | 5 tests passed |
| `pnpm run test:dcs` | 0 | 20 files / 253 tests + 5 files / 10 tests + 10 files / 81 tests |
| `pnpm run typecheck` | 0 | node+web success:true；testTypes observation-only 1053 errors 不阻断 |
| `pnpm contract:check` | 0 | `Contract check passed.` |
| `pnpm --dir openclaw_runtime db:kysely:check` | 0 | `--verify` 完成 |
| `pnpm run build:vite` | 0 | vite client+electron build 完成 |
| `pnpm run test:e2e:run tests/e2e/knowledge-ks04-chat-dcs.spec.ts` | 0 | 1 passed（`unset ELECTRON_RUN_AS_NODE` 后执行）；断言 denial toast 显示 `ACL denied for "Context Palette Notes".` |
| `pnpm --dir openclaw_runtime build` | 0 | tsdown 448.9s，后续阶段全过 |
| `pnpm run comms:replay` | 0 | 所有场景 0 丢失/重复/乱序 |
| `pnpm run comms:compare` | 0 | delta 0.00% |
| `pnpm exec eslint <本包 changed TS/TSX>` | 0 | 0 errors / 0 warnings |
| `git diff --check` | 0 | 无 whitespace 错误 |

## 4. Honest residual

- 全仓 `pnpm run lint:check` 复跑 exit 1：3 errors / 126 warnings；3 个 error 均位于非 KS 变更文件（provider-stream-shared、happy-path-prompt-snapshots、verseshell-runtime-bundle）。本包 changed-file ESLint 0 errors / 0 warnings。
- 全量 `pnpm test` 复跑 exit 1：21 failed files / 31 failed tests / 782 passed / 3 skipped；失败均在基线 surface（VerseShell/UAS/RC/first-product-claims/git-api/host-services/fakecoding/config-schema/memory-gateway/role-orchestration 等），与本包无关，不冒充全仓绿灯。
- 本包已新增 KS-04 专用 Electron E2E：`tests/e2e/knowledge-ks04-chat-dcs.spec.ts`（1/1 PASS），覆盖知识引用拒绝 toast 的可见 reason；既有 `knowledge-hub.spec.ts` E2E 4/4 作为回归补充。
- `MemoryWikiChatKnowledgeSourceAdapter` 生产读取依赖 memory-wiki 扩展模块；当扩展 vault 不可用或 wiki 未初始化时返回 `not_found` 并给用户 reason，不阻断 chat send。
- KS-04 不构成 default-on/GA/productApproved/真人采用证据；产品锁仍为 false。

## 5. Task Forest

- 已通过 CLI 保存 proposal：`TFP-88df65a6ed`（未 apply，等待用户确认）。
- 提案内容：TF-0075 done(100%)；TF-0076 ready(0%)；TF-0070 in_progress(50%)。
- 未直接编辑 `nodes.json` / `edges.json`。
- 用户确认前：不 apply、不 commit、不 push、不启动 KS-05。

## 6. 产品锁

`liveReady / productApproved / defaultOn / auto-capture / auto-writeback / Runtime Memory persist+inject` 全部未改。
