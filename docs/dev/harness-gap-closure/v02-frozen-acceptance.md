# V02：冻结候选与独立全链回归验收

日期：2026-10-14（Asia/Shanghai）。包码：V02（TF-0299）。actor: codex-v02-executor；
driven_by: agent。真实 provider/付费调用：无。

## 冻结候选

- candidate branch: `codex/harness-gap-v02-frozen-acceptance-20261014`，base `origin/main`（PR #216 合并后）。
- 候选不含新增产品行为；本包只新增 V02/V03 验收 spec、证据与守卫测试。
- 产品锁：`live_ready=false`、`product_approved=false`、`default_on=false`，**未改变**。

## 正式全门结果（design.md §3）

| 门 | 命令 | exit | 计数/结果 | 判定 |
|---|---|---|---|---|
| 全量单元 | `pnpm test` | 1 | 948 files: 937 passed / 7 failed / 4 skipped；8379 tests: 8316 passed / 11 failed / 52 skipped | **NO-GO** |
| 未缓存类型 | `pnpm run typecheck` | 0 | node+web+test 三项目 0 error | PASS |
| Lint | `pnpm run lint` | 1 | 4 errors / 115 warnings | **NO-GO** |
| Comms 回放 | `pnpm run comms:replay` + `comms:compare` | 0 | Result PASS，0.00% delta | PASS |
| Host contract | `pnpm run contract:check` | 0 | Contract check passed | PASS |
| i18n | `pnpm run i18n:lint` | 0 | i18n lint passed | PASS |
| Build | `pnpm run build:vite` | 0 | 前端 + Electron main/preload 构建成功 | PASS |
| Electron E2E（全量） | `pnpm run test:e2e` | — | **未执行**（约 150 条串行 Electron spec，超出本会话包络） | NOT-RUN |
| Electron E2E（代表） | `pnpm exec playwright test tests/e2e/telemetry-consent.spec.ts` | 0 | 1 passed / 44.8s（Node 24.19.0 + Electron 40.8.4） | PASS |
| Harness CI | `pnpm run harness:ci` | 1 | spec-lifecycle 等 58 tests pass；`agent-dev:audit` 因 Agent Dev 证据 124h 过期而 fail | **NO-GO** |

## 独立核验（Verifier 角色，agent 驱动）

从磁盘原始产物独立重算，不引用实现者结论：

1. 全量单元的 11 处失败在 **clean `origin/main` worktree**（`D:/ClawX-candidates/issue-213-writeset-scheduler-20261013`，5cc931fb4）上逐一复现，证明是 main 既有基线红，与本 change set 无关：
   - `tests/unit/verseshell-manifest.test.ts`（7）与 `tests/unit/uas-05-verseshell-process-lifecycle.test.ts`（1）：缺少未随仓库分发的 `resources/bin/win32-x64/ae.exe` 二进制制品。
   - `tests/unit/p0-production-acceptance.test.ts`（1）：`prebuild:vite` 断言过期（实际已含 `sync-lobe-icons.mjs`）。
   - `tests/unit/rc01-authority-inventory-baseline.test.ts` / `rc01r-prerequisite-provenance.test.ts`（各 1）：`acceptedBaseSha` 不是当前候选祖先。
   - `tests/unit/dcs-prod-flags-memory-semantics.test.tsx` / `vtoken-bridge-panel.test.tsx`（各 1）：`react-i18next` mock 缺 `initReactI18next` 导出。
2. `harness:ci` 的 `agent-dev:audit` 失败来源于 `artifacts/agent-dev-*` 证据 124h 过期，属证据新鲜度，与 harness-gap 变更集无关。

## 结论

V02 正式全门 **NO-GO**：`pnpm test` 与 `pnpm run lint` 未全绿，且全量 Electron E2E 未执行。
所有失败均为 `origin/main` 既有基线红（已在独立 clean worktree 复现），不属于 harness-gap-closure 30 包引入的回归；
但按 design.md §3「缺跑不 PASS」，V02 不能裁为 PASS，产品锁与发布保持未变更。

## 未执行 / 缺测

- 全量 Electron E2E 未执行（仅执行代表 spec）。
- 外部 GitHub Actions CI 未执行。
- 真实 provider / 付费调用未执行（不在本包范围）。
- 独立第二 agent verifier 角色未启用；Verifier 由同一 agent 的独立重算步骤实现。
