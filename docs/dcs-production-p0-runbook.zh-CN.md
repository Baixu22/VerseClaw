# DCS 生产 P0 Runbook（opt-in 保守生产）

**模式**：保守生产包装（`productionMode: opt-in`）  
**默认 flag 毕业**：`false`（禁止为演示翻默认）  
**权威基线**：Round ACCEPT `accept-with-residuals`（含 C4 `writeFileSync` 修复 tip）

## 安全默认值（必须保持）

| 表面 | 默认 | 说明 |
|------|------|------|
| `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS` | off | C1 影子；A/B < 5x |
| `runtime.coding.staleWriteGuard.enabled` | false | C2 显式开启 |
| `runtime.coding.writeJournal.enabled` | true | 基线 undo 日记 |
| `runtime.coding.worktree.backend` | `inprocess` | git 为 opt-in（非 C4-H） |
| request/plan `isolation` | `shared` | worktree 仅请求级 |
| `runtime.coding.symbolLease.enabled` | false | mode 默认 `memory` |
| `runtime.coding.patchFlow.default` | false | 仅调用 API |
| C6 `applyContextLadder` | 不自动 | assembler 路径不变 |
| `runtime.coding.routingMemo.shadow` | false | 开启后仅双写 |
| `runtime.coding.sekb.experienceShadow` | false | 无默认知识注入 |

## 显式启用方式

1. **View tools（C1）**：环境变量 `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1`，重启 gateway/runtime。
2. **Stale write guard（C2）**：配置 `runtime.coding.staleWriteGuard.enabled=true`。
3. **Git worktree backend（C4）**：`runtime.coding.worktree.backend=git` **且** 请求 `isolation: "worktree"`。
4. **Symbol lease（C5）**：`runtime.coding.symbolLease.enabled=true`（C5-H 前保持 `mode=memory`）。
5. **Patch-flow（C5）**：调用 `applyPatchProposalsSerial()` / `recommendIsolationMode()`；**不要**把 `patchFlow.default` 设为 true。
6. **Context ladder（C6）**：代码中显式调用 `applyContextLadder({ blocks, tokenBudget })`；不翻 assembler 默认。
7. **Shadows（C7）**：`routingMemo.shadow` / `sekb.experienceShadow=true` 仅用于双写采样。

配置面导出：`artifacts/coding-prod-p0/config-surface.json`  
应用内：设置 → 开发者 → DCS 生产 Flag（只读目录）

## 故障关闭顺序（Kill-switch）

先关增强、保留基线：

1. 取消 `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS`
2. `staleWriteGuard.enabled=false`
3. `symbolLease.enabled=false`（或 `mode=memory`）
4. 停止 patch-flow / ladder 调用方；确保 `patchFlow.default=false`
5. `worktree.backend=inprocess`；隔离改为 `shared` 或省略
6. `routingMemo.shadow=false` 与 `sekb.experienceShadow=false`
7. 仅当日记 I/O 故障时临时 `writeJournal.enabled=false`（会丢失 undo）
8. 环境/配置变更后重启 gateway/runtime

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