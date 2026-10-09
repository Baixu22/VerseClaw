# CVK 真实运行时注入与消费证据 — 2026-10-09

`driven_by: agent` · `actor: codex-cvk-real-evidence`

此前有审查指出：Context Runtime Kit（CVK，`context-runtime-kit`）虽然被描述为默认上下文引擎，但缺少**真实运行时**证据——没有人证明它的 `systemPromptAddition` 真进入真实模型请求，并被真实模型消费。本证据补齐这一点，且不新增节点开发。

## 本轮证明的两个事实

1. **CVK 是默认引擎，且其 prompt addition 真的注入了真实模型请求。** 用隔离的真实 Gateway 打开 `runtime.contextRuntimeKit.enabled=true`、`contextFamily.contextStatus.enabled=true`，在 loopback relay 上逐字节捕获真实上游请求体。
2. **真实 `step-5-preview` 消费了该块。** 提示词要求模型原样回答上下文块里 `tool gate mode:` 后的值；模型返回 `report_only`，与注入内容一致。

## 捕获到的注入内容（真实上游请求体）

| 字段 | 值 |
| --- | --- |
| 请求体 | 23509 字节，sha256 见 report |
| system prompt | 21670 字符 |
| `[Context Runtime Kit]` 块 | 存在 |
| `[Context Status]` 投影 | 存在（`contextFamily.contextStatus.enabled=true`） |
| `artifact:` | `sha256:d17922edfe3193fc7f84992cee88f963acf816e4f3ac59db227af0e13960b606` |
| `metrics:` | `SC=1 RRR=1 AR=1` |
| `tool gate mode:` | `report_only` |
| registry 行 | 1 |
| compact selector 引用 | 10（带 sha256） |
| 提供方/模型 | HTTP 200，`step-5-preview`，usage total 6649（cache 512） |

因此「CVK 只是有源码、没有真实运行证据」的说法不成立：注入与消费均有真实可复核证据。

## 边界（不得外推）

- `tool gate mode` 观察到的是 `report_only`，与仓库既有口径一致：CVK 工具门当前只产生诊断，不在工具执行点硬阻断。本证据不改变该 Partial 边界。
- 这是单次有界真实请求（1 次提供方调用），不是模型质量、全量工具权限、桌面/安装包/跨平台或 GA 验收。
- 货币费用未测量；运行时默认零成本不当作免费。
- 脚本模拟的是人式操作（打开会话→发一条普通消息→读回复），但产物一律标 `driven_by: agent`，不是真人证据。

## 脚本与复现

驱动脚本按所有者要求不进入仓库，保存在 `D:/ClawX-work/cvk-real-evidence-20261009/`：`run-cvk-evidence.mjs` 起隔离 Gateway + loopback relay + 明文 RPC，role 只用 `read`（workspace 限定），凭据只在父进程内存/`.key`。
复现：设 `LIVE_MODEL_BASE_URL`/`LIVE_MODEL_ID`/`LIVE_MODEL_KEY_FILE` 后 `node run-cvk-evidence.mjs <new-dir>`。
选中证据：`artifacts/cvk-real-runtime-evidence-20261009/{report.json,credential-scan.json,SHA256SUMS}`。

## 失败的第一次尝试（保留）

attempt-1 真实注入同样成功（`hasCvkBlock=true`、`metrics SC=1 RRR=1 AR=1`、`tool gate mode: report_only`、模型已回 `report_only`），仅因我对 `artifact:` 行的正则过严（漏了 `sha256:` 前缀）而断言失败。该失败照原样保留。
