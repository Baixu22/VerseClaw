# VS-P0-03 Governed Real Probe Evidence

日期：2026-08-14  
Task Forest：`TF-0060` / VS-P0-03  
候选工作树 SHA：`cb2c9e39121b42accb88ba5c86d1dab66cd49f09`  
状态：工程 probe 通过；不构成 canary、default-on、GA 或产品批准。

## 范围与身份

本次 probe 只复用 VS-P0-02 已验证的 Windows x64 bundle，不改变模型工具面、facade、MCP、
写入、native fallback 或 rollout/product locks。

| 身份 | 当前值 |
|---|---|
| pinned source commit | `c3983694407a9ddb23505e05fad4a9eae653b283` |
| source-inputs SHA-256 | `158d0ca4d2ec51080b2aa0bdeb6274755c7009af9a904f86eacf624993dcd489` |
| combined source identity | `19008cf2844aac688cfc74276db3babf64d416d2c3ba9497cda632cfff75d650` |
| manifest SHA-256 | `3068686e6212ac95e7a17eae488a82ca25fef4b15756be6e7dae0fa99f93d58f` |
| binary | `resources/bin/win32-x64/ae.exe` |
| binary SHA-256 | `ac6a7a15dac0a9dc7d15ec975fc65276f25c871bbc0174197731947df6460786` |
| binary bytes | `14879232` |
| runtime/protocol | `1.0.0` / `verseshell.jsonl/v1` |
| catalog | `31` ops / `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7` |

## Governed probe 断言

- 未设置 host policy approval 的真实 `exec.run` 返回 `E_NEEDS_APPROVAL`；父进程设置
  `AETHER_APPROVE_ALL=1` 也不能绕过该拒绝。
- 明确批准后只创建一个 action-bound token transport 并重试一次；批准 transport 在动作
  完成后关闭，未批准 transport 不携带 token。
- 大输出返回 bounded observation 和 `result://sha256/...` artifact；随后 `result.query`
  能恢复匹配内容，不把完整日志直接交给模型。
- `governed-exec-runtime` 覆盖 default-off、缺少 contract 和 compatibility fallback 开启时
  的 fail-closed 行为；VerseShell 失败不会切换 native shell。
- 当前实现与测试不改变 `default-off`、`liveReady=false`、`productApproved=false`、
  `defaultOn=false`。

## 门禁结果

| 命令 | 结果 |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p0-governed-probe.md` | PASS |
| `pnpm harness validate --spec ... --no-diff` | PASS |
| `pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1` | 11 files / 57 tests PASS |
| `pnpm verseshell:test` | bundle 13/13；runtime 11/11；OpenClaw 57/57 PASS |
| `node scripts/validate-verseshell-manifest.mjs --package` | PASS |
| `pnpm run typecheck` | node/web PASS；测试 tsconfig 既有 1028 条 observation-only 错误 |
| `pnpm run comms:replay` | PASS |
| `pnpm run comms:compare` | PASS |
| `git diff --check` | PASS |

## 诚实残余

本次 diff-aware Harness validate 未宣称通过：共享工作树含大量其他任务的 changed paths，
且 harness dry-run 子包缺少本地 `node_modules`。该环境/所有权残余不能通过扩大本 spec 的
`touchedAreas` 或使用 `--no-diff` 冒充 clean candidate；它不影响上表针对当前 binary 和
OpenClaw governed route 的测试结果。

本证据不包含 provider receipt、human recovery、paired A/B、soak、真实 cohort 或产品 owner
裁决。VS-P1-01 只能在本节点 Task Forest closeout 后按串行依赖启动；所有 rollout 锁继续关闭。
