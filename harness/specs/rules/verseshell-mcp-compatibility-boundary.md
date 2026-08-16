---
id: verseshell-mcp-compatibility-boundary
title: VerseShell MCP 兼容层边界
type: ai-coding-rule
appliesTo:
  - verseshell-p1-mcp-compatibility
severity: error
---

# VerseShell MCP 兼容层边界

- MCP 只能是外部兼容 adapter；ClawX 内部 facade、policy、workspace、approval、journal 和
  governed execution 不得依赖或绕过 MCP。
- capability 默认 deny；`all`、`*` 和未知 capability 必须在启动前拒绝。工具 catalog 只能
  返回当前 profile 和显式 grant 同时允许的工具。
- capability 名称必须与 pinned runtime handshake 的 grant vocabulary 对齐；`catalog.read`、
  `compat.transpile`、`health.read` 等 adapter-only capability 不得传给 runtime。无法证明
  builtin/runtime coverage 的 legacy tool 必须 fail-closed。
- `verseshell_eval` 与 shell 字符串兼容工具只能在显式 `development` profile 注册，产品 profile
  不打包或不注册它们。产品执行只接受明确 argv，并复用 `shell.exec` 的 VerseShell policy boundary。
- P1 不发布 filesystem mutation、archive mutation 或 clipboard write compatibility tool；这些
  effectful surface 只能在独立 governed write spec 中重新评审。
- runtime child 必须以 `--agent --policy strict` 启动；startup/readiness 不得依赖 runtime 先输出
  stdout 首帧而形成请求死锁。
- MCP package、runtime manifest、protocol、catalog digest 和启动 smoke 必须从仓库追踪的单一
  metadata 来源校验；缺少依赖、版本漂移、协议不匹配和 runtime 启动失败必须 fail-closed。
- MCP capability 使用量必须与 governed facade 分开；兼容层通过失败、超时或重启时不得自动转移到
  native shell、legacy eval 或另一执行 owner。
