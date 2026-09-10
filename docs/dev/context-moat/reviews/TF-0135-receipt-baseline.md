# TF-0135 真实 receipt 基线：本地可行性审计

- 审计日期：2026-08-28
- 范围：只读检查 + 真实脱敏语料复核 + rc03/ReceiptStore 针对性测试
- 写入范围：仅本文件；不修改 runtime、Task Forest、`AUDIT-BOARD.html` 或其他 review

## 裁决

**截至 2026-08-28：BLOCKED / NOT EXECUTED。** 当时 checkout 没有可安全执行的真实端到端 receipt probe。没有生成 synthetic receipt，也没有把单元测试或真实语料离线复核写成 receipt 运行成果。

阻塞是可复核的：真实写入路径只有在实际模型调用的 Context Orchestrator 收敛点才会执行；现成 CLI 的 `agent --local` 要求 provider API key，调用会把消息和上下文送往外部模型；当前没有运行中的 Gateway，且默认 ReceiptStore 指向本机共享 state。原审时仓库没有 `rc03`/`receipt` 专用 package script；内部 `database.path` 覆盖可用于测试/调用方，但没有暴露为安全的 CLI probe 入口。

## 脱敏本机事实

| 检查项 | 结果 | 证据等级 |
|---|---:|---|
| `runtime` 配置键数 | 1（`coding`） | 本机配置元数据 |
| `runtime.rc03` | absent | 本机配置元数据 |
| `OPENCLAW_RC03_SEAL` | unset | 本机开关元数据 |
| context-enhancement kill switch（配置/env） | absent / unset | 本机开关元数据 |
| state 表：`context_blocks` | 16 行 | 只读 SQLite 计数 |
| state 表：`runtime_receipts` | 0 行 | 只读 SQLite 计数 |
| receipt kind 行数 | 0 | 只读 SQLite 计数 |
| Gateway `18789` listener | 0 | 本机进程/端口元数据 |
| 真实脱敏语料 entries / messages / user turns / compactions | 255 / 248 / 42 / 2 | 真实输入的脱敏计数 |
| 可定位 units / carrying a reason / persisted receipt rows | 480 / 0 / 0 | 真实输入的脱敏计数 |
| 脱敏自检 findings | 0 | 真实输入的脱敏计数 |

## 开关与安全边界

- `rc03.seal` 默认关闭；只有显式 `OPENCLAW_RC03_SEAL=1|true|yes|on` 或 `runtime.rc03.seal=true` 才会进入 seal hook；增强 kill switch 优先。
- ContextReceipt/v1 在 pre-seal 收敛点写入；WireReceipt/v1 在最终 guarded provider body 边界写入。ReceiptStore 只持久化 bounded identity、索引、refs、budget 和 digest，不持久化 prompt、tool output 或 credential 原文。
- 默认路径是共享本机 state SQLite。对该库做真实写入会留下持久副作用；当前没有现成命令能为真实 app 运行同时指定隔离 receipt 数据库、provider、model 和一条明确授权的非敏感消息。
- `pnpm dev` 的 `predev` 会执行 runtime/build 相关步骤；在当前 dirty checkout 中执行不符合“只写本文件”的范围，因此未启动。

## 已执行命令与退出码

```text
node --check scripts/context-loss-trace-spike.mjs
EXIT=0

$session = Join-Path $env:USERPROFILE '.openclaw/corpus/tf-0143-57c00668.jsonl'
$stateDb = Join-Path $env:USERPROFILE '.openclaw/state/openclaw.sqlite'
node scripts/context-loss-trace-spike.mjs --session $session --state-db $stateDb
EXIT=0
output counts: entries=255 messages=248 userTurns=42 compactions=2
output counts: units located=480 units carrying a reason=0 persisted receipt rows=0
output counts: patterns=4 findings=0

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
EXIT=0; tests=28/28

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/receipt-store.test.ts
EXIT=0; tests=15/15

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.runtime-config.config.ts config/runtime-rc03.test.ts
EXIT=0; tests=6/6

pnpm exec openclaw agent --help
EXIT=0; confirms --local requires provider API keys

pnpm exec openclaw gateway --help
EXIT=0; confirms gateway run is a foreground runtime entry
```

以上测试是 engineering evidence，不是 receipt baseline；测试输入和测试 state 不计入真实 receipt 行数。

## 精确阻塞命令

以下命令是后续安全运行所需的入口，但本次**未执行**。执行前必须由授权者提供隔离 state/config、provider/model 和非敏感 probe message；否则会使用真实凭据或共享 state，不能判为安全：

```powershell
$env:OPENCLAW_STATE_DIR = Join-Path $env:TEMP 'openclaw-rc03-receipt-baseline'
$env:OPENCLAW_CONFIG_PATH = Join-Path $env:OPENCLAW_STATE_DIR 'openclaw.json'
$env:OPENCLAW_RC03_SEAL = '1'
pnpm dev
```

随后只能在该隔离配置和明确授权的非敏感消息上做一条真实模型调用；结束进程并关闭该 shell 后，`OPENCLAW_RC03_SEAL` 回到 unset，默认值不变。当前没有可证明“真实运行 + 隔离 receipt DB + 不外发敏感内容 + 可回滚”的已配置入口，所以未执行这一步。

## 证据等级

- **E0：本机配置/端口/SQLite 只读元数据。** 证明当前开关关闭、receipt 行数为 0、没有运行中的 Gateway。
- **E1：engineering evidence。** rc03、ReceiptStore、配置 schema 的针对性测试通过；证明实现契约和默认关闭行为，不证明真实产品运行。
- **E2：limited real-input feasibility。** 真实脱敏语料可被只读脚本消费，计数为 42 user turns / 2 compactions / 480 units，敏感自检为 0；不证明 receipt 已写入，也不证明真人产品价值。
- **本次没有 E3 真实 receipt baseline，也没有 L3 真人证据。** 因安全入口、授权 provider/model/message 和隔离可回滚运行条件未同时成立，receipt baseline 保持 `NOT EXECUTED`。

## 2026-08-29 fail-closed probe 补充

本轮新增了 `scripts/rc03-receipt-probe.mjs`、`scripts/rc03-receipt-probe.test.mjs`，并在根 `package.json` 注册 `dcs:receipt:probe`。入口默认拒绝共享 state，只有在显式提供隔离临时目录、provider/model、凭据环境变量、网络确认和非敏感消息确认后才允许进入真实调用；测试 `3/3` 通过，`node --check scripts/rc03-receipt-probe.mjs` 通过。

该 probe 只是把安全前置条件变成可执行的 fail-closed guard，不是 E3 receipt 证据。本轮没有提供凭据或网络确认，实际结果仍为 `BLOCKED / NOT EXECUTED`，没有生成真实 receipt，也没有改变 `rc03.seal` 默认关闭、共享 state、approval 或敏感数据边界。
