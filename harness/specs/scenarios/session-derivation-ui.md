---
id: session-derivation-ui
title: Navigate and continue related sessions
type: scenario
requiredRules:
  - session-derivation-ui-contract
  - sidebar-session-row-controls
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
pathPatterns:
  - src/components/layout/**
  - src/pages/Chat/**
  - src/stores/chat/**
  - shared/chat/**
  - shared/types/session-derivation.ts
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
---

1. Open a project with a parent conversation and several derived sessions. Expand the parent and verify children remain in their actual workstreams, with a relation marker and independent status. Switch to time sorting: the list remains flat. Cross-workstream sources are links, not duplicate rows or automatic filing.
2. Open a Fork, Handoff, or Spawn child from the list. Verify the header names its source, the source/derived-session controls navigate in both directions, and switching back preserves each session draft.
3. Inspect a waiting, failed, running, and completed child. The parent may summarize child counts but keeps its own independent status; failure remains attached to the child and can be opened.
4. From a user message, choose “Ask in a new session,” review the indication that context stops at the preceding assistant ancestor, edit the question, and create the child. The child opens with the question in its composer; it is not sent until the user sends it. A missing valid ancestor is rejected.
5. Inspect a missing parent or malformed chain. The UI labels the source as unavailable or truncated and never invents a root session.
6. Prepare Handoff, edit the draft, and confirm the explicit “Create and send” action. Verify one new-session send and authoritative parent linkage; a send failure preserves that child and recoverable draft. Unknown outcome never causes an automatic duplicate send.
7. Observe Spawn admission, execution, result delivery, and parent continuation as separate events; only expose owner-supported controls. Read an unavailable child transcript without showing fabricated content or completion.
8. Stop, archive/undo, restore, delete, compact and restore a checkpoint through the existing UI. Verify target session/generation binding, no implicit child cascade, truthful availability, and stale-response isolation. Model suggestions to open a new session do not create it without an explicit creation action.
9. Run the journey with agent-driven Electron automation in Light/Dark, narrow/collapsed sidebar, keyboard navigation, and reduced-motion modes. Capture persistent states and transient creation/delivery/error feedback.
10. Project a worker row containing both parentSessionKey and spawnedBy. It is classified by the shared classifier as Spawn, and contradictory facts remain diagnostic. Create a Handoff and reload its runtime-derived lineage; the source must survive without a Task Ledger-derived sidebar tree.
11. Lose the Handoff creation response, then interrupt the first send and restart the application. Reconcile the persisted operation, child key and send idempotency key with owner receipts/transcript before retry. No second child is created for that operation; an unprovable delivery stays unknown. Historical Ledger-only lineage is marked incomplete rather than silently fabricated or migrated.
12. 点击项目名称进入显式scope的负责人页面，使用独立disclosure展开会话家族；在两个项目之间切换，验证任务、worker、草稿和晚到结果不串scope。
13. 查看discussion空任务容器、执行会话的当前任务与验收条件、任务owner不可用和stale状态；沿任务→会话→证据→负责人往返，不建立第二任务完成状态。
14. Fork/Handoff展示任务继承范围；Fork不继承写claim/lease，执行须重新准入。turn结束、worker报告和任务验收分别显示，归档不隐含任务完成。
