---
id: verseshell-readonly-facade-boundary
title: VerseShell 只读 Facade Adapter 边界
type: ai-coding-rule
appliesTo:
  - verseshell-p2-readonly-facade
severity: error
---

# VerseShell 只读 Facade Adapter 边界

- 只读 adapter 必须复用 `shared/verseshell/facade.ts` 的稳定名称和 schema；不得把内部
  operation catalog 直接变成模型工具目录。
- adapter 不得调用 `child_process`、MCP、Gateway HTTP 或 native shell。所有 runtime 请求必须
  通过 host-owned `VerseShellAciClient` 或已有 governed result query。
- 路径只能是 canonical workspace 下的相对路径；拒绝绝对路径、`..` escape、NUL、非文本的
  未知输入和超过 contract 上限的 query/window。
- read/search cache key 必须包含 workspace identity、revision、canonical args 和 policy
  profile/digest；cache hit 不能跳过 owner、revision 或 artifact validation。
- 只读操作可以在 host 明确标记为 idempotent 时使用一次 bounded retry；不得对写入或未知
  effect 重试，不得在失败时自动切换执行 owner。
- 任何 flag、runtime handshake、policy profile、catalog 或 observation contract 不确定时，
  工具必须保持不可见或 fail-closed；不得改变 rollout/product locks。
