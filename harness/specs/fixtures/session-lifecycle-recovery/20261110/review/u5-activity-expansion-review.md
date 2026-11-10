# U5 activity/expansion narrow review

driven_by: agent

## 结论

未发现 `8e201dcbf` 新增 `mergeSessionActivity` 或显式 family expand 存在确定的正确性错误、状态作用域问题或 P1。

## 已读代码范围

- `src/lib/session-read-model.ts:5-14`：新增 merge 仅接受 finite 且严格更大的 activity；未改输入，返回同引用表示无变化。
- `src/stores/chat.ts:317-367, 3070-3087, 3751`：summary、`sessions.list`、history 活动值统一走单调 merge。
- `src/stores/chat/history-actions.ts:251-257`：当前 session 的 history 活动值走单调 merge，且应用前有 `isCurrentSession()` 守卫。
- `src/stores/chat/session-actions.ts:195-205, 256-257`：list/background history 均按各自 `sessionKey` merge。
- `src/stores/gateway.ts:188-195`：runtime traffic 与 history/list/summary 使用同一 monotonic contract。
- `src/stores/chat.ts:2041-2110, 3262/3283, 3388, 3417, 3493`；`src/stores/chat/session-actions.ts:305, 340, 360, 456, 492, 521`：switch/reset patch、delete/archive/cleanup、restore 路径没有通过 merge 掩盖合法清空；delete/archive/cleanup 直接去掉对应 key，restore 后的值由当次 `sessions.list` 重建。
- `src/components/layout/SessionFolderTree.tsx:293-307, 318, 510-550`：显式 expand 使用最新 `liveRowGroups`；`88d412c5c` 补齐 callback dependency；`setInteractionOrder` 使用 functional updater，children 被移到当前父项之后，其他 root 相对顺序不变。
- `src/components/layout/session-buckets.ts:361-422`：`originKey` 是组内直接展示 child，`threadSessionsByLineage` 本身保持 top-level 顺序并让 children 跟随 origin。
- `tests/unit/session-family-navigation.test.tsx:32-49`；`tests/unit/chat-store-history-retry.test.ts:83-96`；`tests/unit/chat-store-session-label-fetch.test.ts:326-344`：红例覆盖缺 Child、旧 history 与旧 list/summary 降低活动时间。
- `tests/e2e/session-derivation-ui.spec.ts:271-277`：修补只增加 expanded 断言，未放宽现有 work 阈值。

## 仓库定位

`D:/ClawX` 与 `D:/ClawX-work/session-task-unified-relay-20261109` 的 checkout 顶层不同，但 `git-common-dir` 均为 `D:/ClawX/.git`，属于同一仓库。目标 HEAD 为 `8e201dcbf0e6697de78240d993437b1e930d00a5`，工作树干净。

## 验证边界

本次只做静态窄复核；按要求未运行 build、Electron、测试，未修改源码或 Task Forest。主线已记录原红到 31/47 green，family 已通过 2/20 并继续 100；本报告不把它们表述为真实后端或 human evidence。
