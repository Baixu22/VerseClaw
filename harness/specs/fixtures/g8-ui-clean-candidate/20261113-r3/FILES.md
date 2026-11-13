# 写集与路径归属

| 路径 | 实际归属 |
|---|---|
| `README.ja-JP.md` | sidebar-session-row-polish |
| `README.md` | sidebar-session-row-polish |
| `README.ru-RU.md` | sidebar-session-row-polish |
| `README.zh-CN.md` | sidebar-session-row-polish |
| `docs/dev/rareui-interactions.md` | sidebar-session-row-polish |
| `harness/specs/rules/sidebar-session-row-controls.md` | sidebar-session-row-polish |
| `harness/specs/scenarios/sidebar-session-row-management.md` | sidebar-session-row-polish |
| `harness/specs/scenarios/windows-ui-v2.md` | chat-output-visual-hierarchy |
| `harness/specs/tasks/chat-composer-popovers.md` | chat-composer-popovers |
| `harness/specs/tasks/chat-output-visual-hierarchy.md` | chat-output-visual-hierarchy |
| `harness/specs/tasks/g8-ui-clean-candidate.md` | g8-ui-clean-candidate |
| `harness/specs/tasks/sidebar-session-row-polish.md` | sidebar-session-row-polish |
| `src/components/brand/BrandLogo.tsx` | sidebar-session-row-polish |
| `src/components/chat/MemoryInjectionPanel.tsx` | sidebar-session-row-polish |
| `src/components/layout/Sidebar.tsx` | sidebar-session-row-polish |
| `src/components/layout/TitleBar.tsx` | sidebar-session-row-polish |
| `src/components/rareui/CompletionActivityMenu.tsx` | sidebar-session-row-polish |
| `src/components/rareui/NotificationBell.tsx` | sidebar-session-row-polish |
| `src/pages/Chat/ChatToolbar.tsx` | sidebar-session-row-polish |
| `src/pages/Chat/SessionActivityPanel.tsx` | sidebar-session-row-polish |
| `src/pages/Chat/index.tsx` | sidebar-session-row-polish |
| `src/stores/chat.ts` | chat-composer-popovers |
| `src/styles/codex-composer-material.css` | sidebar-session-row-polish |
| `src/styles/codex-session-activity.css` | sidebar-session-row-polish |
| `src/styles/codex-sidebar.css` | sidebar-session-row-polish |
| `src/styles/globals.css` | sidebar-session-row-polish |
| `src/styles/rareui-interactions.css` | sidebar-session-row-polish |
| `tests/e2e/chat-agent-effort.spec.ts` | chat-composer-popovers |
| `tests/e2e/chat-composer-git-strip.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/chat-composer-popovers.spec.ts` | chat-composer-popovers |
| `tests/e2e/chat-task-visualizer.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/chat-welcome-hero-fakecoding.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/chat-welcome-hero-verse-shot.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/main-navigation.spec.ts` | sidebar-session-row-polish |
| `tests/e2e/rareui-interactions.spec.ts` | rareui-interaction-adaptation |
| `tests/e2e/runtime-approval-bridge.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/session-activity-background-read.spec.ts` | chat-output-visual-hierarchy |
| `tests/e2e/sidebar-session-row-polish.spec.ts` | sidebar-session-row-polish |
| `tests/e2e/windows-ui-v2.spec.ts` | ui-motion-material-system |
| `tests/unit/chat-page-execution-graph.test.tsx` | chat-output-visual-hierarchy |
| `tests/unit/chat-startup-hydration.test.ts` | g8-ui-clean-candidate |
| `tests/unit/rareui-interactions.test.tsx` | sidebar-session-row-polish |
| `artifacts/agent-dev-deep-test/history.json` | agent-dev-ecosystem-regularization |
| `artifacts/agent-dev-deep-test/report.json` | agent-dev-ecosystem-regularization |
| `artifacts/agent-dev-deep-test/report.md` | agent-dev-ecosystem-regularization |
| `artifacts/agent-dev-quality/report.json` | agent-dev-ecosystem-regularization |
| `artifacts/agent-dev-workbench/evidence.json` | agent-dev-ecosystem-regularization |
| `harness/specs/rules/agent-dev-conformance-evidence.md` | agent-dev-ecosystem-regularization |
| `harness/specs/rules/contract-first-boundary.md` | architecture-review-and-integration |
| `harness/specs/tasks/audit-wiring-quick-fixes.md` | audit-wiring-quick-fixes |
| `harness/specs/tasks/audit-wiring-remainder.md` | audit-wiring-remainder |
| `harness/specs/tasks/committed-branch-integration-20261109.md` | committed-branch-integration-20261109 |
| `harness/specs/tasks/repository-ci-g8-prerequisites.md` | repository-ci-g8-prerequisites |
| `package.json` | agent-dev-ecosystem-regularization |
| `scripts/agent-dev-deep-test.mjs` | agent-dev-ecosystem-regularization |
| `scripts/contract-check.mjs` | architecture-review-and-integration |
| `scripts/typecheck-agent-dev.mjs` | agent-dev-ecosystem-regularization |
| `tests/unit/contract-check.test.ts` | architecture-review-and-integration |
| `tests/unit/typecheck-gate.test.ts` | agent-dev-ecosystem-regularization |

历史快照中的 14 条越界路径逐条剥离，保留各自实际任务的 main 输入：

| 路径 | 归属 | main 与候选 blob |
|---|---|---|
| `electron/gateway/ws-client.ts` | gateway-startup-performance；剥离写集 | `feae4c69dc05187977d711696a7ca9b17130dba1` |
| `electron/services/session-delegation-admission.ts` | long-session-delegation-admission；剥离写集 | `8506b006fe9b9b6cb82e8238fb17cd2fd4c94ec9` |
| `electron/services/sessions-api.ts` | long-session-delegation-admission；剥离写集 | `86f748161be0621756b7ae828766226f74503e25` |
| `harness/specs/scenarios/gateway-startup-diagnostics.md` | gateway-startup-performance；剥离写集 | `f66c06d896d8cb4f03274c31cac262b3a9b8a709` |
| `harness/specs/tasks/coding-vg-sts-jj-convergence-plan.md` | coding-vg-sts-jj-convergence-plan；剥离写集 | `de8285643d29219c1531a871226745f635650537` |
| `harness/specs/tasks/gateway-startup-performance.md` | gateway-startup-performance；剥离写集 | `793afdf842c119d2498cbc851b3b4d0622ce4b16` |
| `openclaw_runtime/scripts/profile-extension-memory.mjs` | gateway-startup-performance；剥离写集 | `64490c761431aa08ea68a6d8d804cbb599bfd28c` |
| `openclaw_runtime/src/plugins/doctor-contract-registry.ts` | gateway-startup-performance；剥离写集 | `8fa5f1f742768679143bab1374c8d3124e4a78dd` |
| `scripts/measure-gateway-startup.mjs` | gateway-startup-performance；剥离写集 | `a676083bbbe32f1cfbb53eb736743fcef5fd8da4` |
| `tests/e2e/gateway-startup-performance.spec.ts` | gateway-startup-performance；剥离写集 | `e4926bfd7177709a99f9254c621f24027fdbf10b` |
| `tests/unit/gateway-doctor-contract-loading.test.ts` | gateway-startup-performance；剥离写集 | `16b0092da2a0ab8e34465199e3748c7bdf132ead` |
| `tests/unit/gateway-loopback-connect.test.ts` | gateway-startup-performance；剥离写集 | `6fa7644b1717bbef9c09625b06a39842c32cb221` |
| `tests/unit/gateway-ready-fallback.test.ts` | gateway-startup-performance；剥离写集 | `7e7c003dc4511a564bbc28633457551380ba7e43` |
| `tests/unit/long-session-delegation-admission.test.ts` | long-session-delegation-admission；剥离写集 | `02025c970fd695cf61cc0438dd2472d68255f666` |
