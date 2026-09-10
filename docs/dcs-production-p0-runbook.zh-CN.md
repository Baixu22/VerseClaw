# DCS Coding Controlled Preview Runbook（显式 opt-in）

**平台**：Windows x64 Controlled Preview
**模式**：内部、单 workspace、显式 opt-in
**默认 flag 毕业**：`false`（禁止为演示翻默认）
**证据边界**：FP-P1 工程与真实进程门禁；真人 canary 与发布审批仍未完成

## 安全默认值（必须保持）

| 表面 | 默认 | 说明 |
|------|------|------|
| `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS` | off | C1 影子；A/B < 5x |
| `runtime.coding.staleWriteGuard.enabled` | false | C2 显式开启 |
| `runtime.coding.writeJournal.enabled` | true | 基线 undo 日记 |
| request/plan `isolation` | `shared` | worktree 仅请求级 |
| `runtime.coding.symbolLease.enabled` | false | mode 默认 `memory` |
| `runtime.coding.patchFlow.default` | false | 仅调用 API |
| C6 `applyContextLadder` | 不自动 | assembler 路径不变 |
| `runtime.coding.routingMemo.shadow` | false | 开启后仅双写 |

API-only 面（不是生产旗标）：

- `createWorktreeService(baseRoot, { backend })` 是 worktree backend 的真实启用路径。
- `DistillationTool.confirm_and_save(suggestion, edits, { sessionId, experienceShadow })` 是 SEKB experience shadow 的真实启用路径。
- 对应 `runtime.coding.*` 配置叶仅用于观测，不会改变运行时行为。

## 显式启用方式

### 最简：一个开关的 DCS Coding Preview（FP-P1-03）

**设置 → Developer → DCS Coding Preview** 是产品路径。一个开关组合首发能力集 ——
`context-view-tools` + `working-memory` + `tool-registry` + `stale-write-guard` ——
一次 gateway 重启、一次覆盖全部组合项的 child 确认。前置强制校验（已验证 Provider、
已选定带显式权限档位的 workspace）；缺项时开关禁用并列出缺什么。`applied` 只可能来自
child 的 runtime 确认；kill switch 生效时显示为 **killed**，绝不显示 applied。
排除项（VToken、RM 注入、SEKB 写回、Browser、shadow 类、symbol-lease）不属于此开关、
不会被它连带打开。默认关闭；升级不会自动打开。

### 按 flag：高级 Settings 控制面（TASK-P0-01）

**设置 → 开发者 → DCS Controlled Preview Flag** 对 allowlist 项提供高级开关（默认 off）。上方的一个开关仍是正常产品路径：

| UI id | 效果 |
|-------|------|
| context-view-tools | 写入 AppSettings + 注入 gateway env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` |
| stale-write-guard | AppSettings + `runtime.coding.staleWriteGuard.enabled`（openclaw.json） |
| symbol-lease | AppSettings + `runtime.coding.symbolLease.enabled` |
| routing-memo-shadow | AppSettings + `runtime.coding.routingMemo.shadow` |

开关保存后，产品路径会在 Gateway 运行时尝试重启以应用；状态徽章：`applied` / `pending-restart` / `error` / `read-only`。

api-only / request-only / baseline 行仍为说明，无开关。

### 高级：env / 手改配置（专家路径）

1. **View tools（C1）**：`OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1`（或 Settings 开关），重启 gateway/runtime。显式 env=`0/false/off` 仍覆盖 Settings 开启（kill）。
2. **Stale write guard（C2）**：`runtime.coding.staleWriteGuard.enabled=true` 或 Settings。
3. **Git worktree backend（C4）**：调用 `createWorktreeService(baseRoot, { backend: "git" })` **且** 请求 `isolation: "worktree"`（仍无 Settings 默认翻）。
4. **Symbol lease（C5）**：`runtime.coding.symbolLease.enabled=true` 或 Settings（mode 默认 `memory`）。
5. **Patch-flow（C5）**：调用 `applyPatchProposalsSerial()` / `recommendIsolationMode()`；**不要**把 `patchFlow.default` 设为 true。
6. **Context ladder（C6）**：代码中显式调用 `applyContextLadder({ blocks, tokenBudget })`；不翻 assembler 默认。
7. **Shadows（C7）**：Settings 或 `routingMemo.shadow` 仅双写采样；API-only experience shadow 需调用 `DistillationTool.confirm_and_save(suggestion, edits, { sessionId, experienceShadow: { enabled: true, workspaceRoot } })`。

配置面导出：`artifacts/coding-prod-p0/config-surface.json`

应用内：**设置 → 开发者 → DCS Controlled Preview Flag（高级可写控制面 + 只读说明行）**

## 故障关闭顺序（Kill-switch）

先关增强、保留基线：

1. Settings 关闭对应开关；或取消 `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS`
2. `staleWriteGuard.enabled=false`（Settings 或配置）
3. `symbolLease.enabled=false`（或 `mode=memory`）
4. 停止 patch-flow / ladder 调用方；确保 `patchFlow.default=false`
5. 停止向 `createWorktreeService` 传入 `backend: "git"`，改用 `backend: "inprocess"`；隔离参数省略或设为 `shared`
6. `routingMemo.shadow=false`；调用 `confirm_and_save` 时省略 `experienceShadow` 或设置 `experienceShadow.enabled=false`
7. 仅当日记 I/O 故障时临时 `writeJournal.enabled=false`（会丢失 undo）
8. 环境/配置变更后重启 gateway/runtime（Settings 开关在产品路径会尝试自动重启）

## Windows 注意点

- C4-H 证据齐全前优先 `inprocess` backend（路径分隔符、文件锁、长路径、并发清理）。
- 禁止把 isolation 默认改为 `worktree`。
- 实验性 `backend=git`：确保 Git for Windows 在 PATH；进程退出后再清理 `.openclaw/worktrees/*`。
- 并发 eslint 与 Playwright 报告生成可能 race（`playwright-report` ENOENT）；E2E 后重跑 lint。

## 观测导出

进程内计数器：

- `codingObservability` — 写侧 / wave / 读侧记分板
- `dcsObservability` — 双注入与 ladder action

打包导出：

```bash
pnpm run dcs:prod-p0
# → artifacts/coding-prod-p0/observability-export.json
# → artifacts/coding-prod-p0/report.json
```

关注族：

- **写侧**：`coding.write.*`
- **Wave**：`coding.concurrent.*`
- **Shadow**：注入抑制、compaction 层、fact tool 调用

## 证据路径

| 产物 | 路径 |
|------|------|
| Round ACCEPT | `artifacts/coding-round-accept/report.json` |
| P0 report | `artifacts/coding-prod-p0/report.json` |
| P0 COMPLETE | `artifacts/coding-prod-p0/COMPLETE.md` |
| 波次 COMPLETE | `openclaw_runtime/CODING-C*-COMPLETE.md` |

## Smoke

```bash
pnpm run dcs:prod-p0:smoke
pnpm run dcs:prod-p0
```

Smoke 只校验默认不变并重写包装产物，**不会**开启任何增强 flag。

## P0 禁止项

- 为演示/伪绿翻 DCS 默认
- C7 记忆/知识生产 cutover
- Assembler 自动 ladder 默认
- Isolation 默认 worktree
- 平行锁/记忆系统；生产主路径依赖外部 MCP
