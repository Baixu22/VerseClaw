---
lifecycleStatus: archived
id: stress-test-windows-concurrency-v1
title: Windows 高并发稳定性压测 v1
intent: Archived stress-test proposal, not an implemented or passed test; current workspaceExec coverage lives in resource-leases.test.ts.
touchedAreas:
  - tests/unit/resource-leases.test.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/stores/chat.ts
---

## 状态澄清（2026-10-12，#162）

以下均为历史压测方案，不是已执行的测试或已实现的能力。
`openclaw_runtime/src/agents/resource-leases.ts` 和文中的五种租约管理器已不在当前源码中，
下面的代码仅为历史草案，不可作为可执行入口。
当前实现仅为 `electron/services/resource-leases.ts` 的 Main `terminal.run` workspaceExec
准入限制；可执行测试为 `tests/unit/resource-leases.test.ts` 和 `tests/unit/terminal-api.test.ts`。
search/writer/subtree/file 租约归 #167，本文不声称它们已存在，也不声称 UI 压测已完成。

## 压测维度

### 1. Runtime 租约压测（ResourceLeaseManager）
- 30 个并发 acquire，5 个不同 workspace key，混合 workspaceExec(2)/workspaceSearch(2)/workspaceWriter(1)，验证：
  - 总完成时间在预期倍数内（非瓶颈）
  - 无租约泄漏（release 后 capacity 正确恢复）
  - 超时错误返回稳定类型（ResourceLeaseTimeoutError）
  - wait duration 递增趋势合理
- 子树 mutation 场景：同目录下多个 delete/write 串行；不相关目录并行

### 2. Chat 状态机压测（纯虚拟）
- 构建 500 条消息的会话状态（混合 user/assistant, tool calls, attachments, images）
- 快速切换 5 个不同 session key
- 模拟 50 帧 streaming text 更新（每帧 50-200 chars）
- 每条帧测量：useMemo 再计算次数（mock proxy）、React 渲染时间
-

## 实施方式

`	s
// tests/stress/resource-leases-stress.test.ts
import { describe, it, expect } from 'vitest';
import { ResourceLeaseManager } from '../../openclaw_runtime/src/agents/resource-leases';

const ALL_RESOURCE_KINDS = [
  { kind: '\''workspaceWriter'\'', capacity: 1 },
  { kind: '\''workspaceSearch'\'', capacity: 2 },
  { kind: '\''workspaceExec'\'', capacity: 2 },
  { kind: '\''subtreeMutation'\'', capacity: 1 },
  { kind: '\''fileMutation'\'', capacity: 1 },
] as const;
`

### 3. UI 渲染压测
- 使用 Vitest + jsdom（模拟）或 Playwright（真实浏览器）
- 构建 Chat 组件树 + 注入 300 条消息
- 测量初次挂载 + 滚动 + 滤镜的操作时间

## 不纳入范围（v1 不覆盖）
- 真实模型 API 调用（只 mock 返回）
- Gateway 端到端通信延迟
- Electron 主进程 IPC 带宽
- 跨窗口/跨进程资源竞争
