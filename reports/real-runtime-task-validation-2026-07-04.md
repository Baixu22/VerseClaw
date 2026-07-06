# 真实环境任务稳定性验收报告

日期：2026-07-04  
Run ID：`run-20260704-133326`  
最新验证时间：`2026-07-04T09:33:46.176Z`  
机器可读准入矩阵：`shared/capability-claims.ts`  
最终结论：**核心真实任务链路已经跑通，并且修复任务按“文件修改 + agent 工具执行 + 独立 oracle”达到 3/3；但严格产品化验收仍未通过，失败点集中在 Plan 元数据写入、chat history 即时可读性、Observability trace 查询和 Execution Graph 完整性。**

这次验收不是 mock IPC，也不是静态源码推断。验证脚本启动真实 Electron App、真实 Gateway source runtime、真实 DeepSeek provider，并在隔离 workspace 中让 agent 修复 `src/math.js` 的真实 bug。DeepSeek 已按用户要求配置为 `deepseek/deepseek-v4-flash`，最新 smoke、transcript、trajectory 都确认实际请求使用的是 flash，而不是旧的 pro。验收后曾观察到 `agents.defaults.model.primary` 被 App 同步层回写为旧的 `deepseek/deepseek-v4-pro`，但 `main` agent 和真实请求仍是 flash；已重新运行配置脚本把 defaults 与 main 都落回 flash。这个漂移不推翻本次任务模型证据，但说明“默认模型持久化一致性”仍需单独修。

## 证据索引

- 主结果：`artifacts/real-runtime-validation/run-20260704-133326/real-runtime-validation-result.json`
- 单轮 smoke：`artifacts/real-runtime-validation/run-20260704-133326/single-turn-smoke-after-fix-result.json`
- 验证脚本：`artifacts/real-runtime-validation/run-20260704-133326/real-runtime-validation.mjs`
- App/Gateway 日志：`C:\Users\27933\AppData\Roaming\Electron\logs\verse-claw-2026-07-04.log`
- Runtime transcript：`C:\Users\27933\AppData\Roaming\Electron\openclaw-source-state\agents\main\sessions\9e016988-f6a6-4f83-aea2-43f7e748503f.jsonl`
- Runtime trajectory：`C:\Users\27933\AppData\Roaming\Electron\openclaw-source-state\agents\main\sessions\9e016988-f6a6-4f83-aea2-43f7e748503f.trajectory.jsonl`
- DeepSeek 配置脚本：`scripts/configure-deepseek-runtime.mjs`

## 环境与命令

| 项 | 真实值 |
|---|---|
| Repo | `C:\Users\27933\Desktop\clawx\ClawX` |
| Electron entry | `dist-electron/main/index.js` |
| Runtime entry | `openclaw_runtime/dist/entry.js` |
| Provider | `deepseek`, `hasKey=true`, default account `deepseek` |
| Requested model | `deepseek/deepseek-v4-flash` |
| App 可见模型 | `selectedAccount.model=deepseek/deepseek-v4-flash` |
| Agent 可见模型 | 验收结果为 `main.modelRef=deepseek/deepseek-v4-flash` |
| Defaults 持久化 | 当前已被脚本重写为 flash；验收后曾短暂回写为旧 pro |
| Worktree | 大量既有未提交改动；本次没有回滚用户改动 |

执行过的关键命令：

```powershell
node scripts/configure-deepseek-runtime.mjs deepseek-v4-flash
pnpm --dir openclaw_runtime exec vitest run src/gateway/server-startup-post-attach.defer.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.plugins.config.ts src/plugins/loader.built-artifacts.test.ts --reporter=verbose
pnpm run build:runtime
pnpm run build:vite
node artifacts\real-runtime-validation\run-20260704-133326\single-turn-smoke-after-fix.mjs
node artifacts\real-runtime-validation\run-20260704-133326\real-runtime-validation.mjs
```

## 本轮修复

1. DeepSeek 配置
   - 新增并修正 `scripts/configure-deepseek-runtime.mjs`。
   - 写入 App provider store 和 runtime `openclaw.json`。
   - 脚本会写入 provider default account、`agents.defaults.model.primary`、所有 `agents.list[].model.primary` 为 `deepseek/deepseek-v4-flash`。
   - 真实任务前后的 transcript/trajectory 证明实际请求使用 flash。
   - 仍发现 App 同步层可能把 `agents.defaults.model.primary` 回写成旧 pro；当前已通过脚本重新落回 flash，但需要后续硬化单一模型配置源。
   - 只记录 `hasKey=true`，不输出 API key。

2. Gateway 启动 schema
   - 清理 source runtime 不兼容字段 `agents.list[].reasoningEffort`。
   - Gateway 不再因 legacy config schema 直接启动失败。

3. CodeGraph/plugin entrypoint
   - 修复 plugin loader 误把 CodeGraph package-local `dist/index.js` 当插件 wrapper 的问题。
   - 相关回归测试通过。

4. Chat dispatch 源码错误
   - 修复 `get-reply-run.ts` 末尾悬空的 `params` 解构。
   - 修复 `get-reply.ts` 漏解构 `resolvedPromptMode`。

5. Gateway ready 后阻塞
   - 延后 sidecars、post-ready services、update check、post-connect health refresh。
   - 关键效果：`chat.send` 从分钟级延迟变为秒级 ACK。

6. Agent 工具装配阻塞
   - 新增 `OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS=1`，source runtime 默认跳过“默认全量插件工具解析”。
   - 显式 plugin tool allowlist 仍可触发插件工具加载。
   - 关键效果：`openclaw-tools:plugin-tools` 从 107s 阻塞降级为不阻塞核心任务。

## 真实结果总览

| 能力面 | 最新真实结果 | 判定 |
|---|---|---:|
| Electron App 启动 | `app.started=true` | PASS |
| Gateway ready | `gatewayReady=true`, port `18789` | PASS |
| Provider 可用性 | DeepSeek account/key 可见，未输出密钥 | PASS |
| 指定模型生效 | App、agent、transcript、trajectory 均显示 `deepseek-v4-flash` | PASS |
| 默认模型持久化 | 真实请求使用 flash；`agents.defaults` 曾被同步回旧 pro，脚本重跑后恢复 | PARTIAL |
| Chat/Gateway 主链路 | 最新 smoke `chat.send` RPC ACK 约 961ms | PASS |
| Assistant 最终响应 | smoke 54.5s 后 assistant 数量 `0 -> 1` | PASS |
| Agent 文件修改 | 3/3 repair 均把 `subtract` 从 `a + b` 改为 `a - b` | PASS |
| Agent 工具执行 | transcript 显示 3/3 有 `edit` 与 `exec node test/run-tests.mjs` | PASS |
| 独立测试 oracle | 3/3 `node test/run-tests.mjs` 通过 | PASS |
| Plan 模式目标文件保护 | 3/3 `src/math.js` hash 不变 | PASS |
| Plan 模式严格 no-diff | 3/3 创建 `.verse-claw/` 元数据 | FAIL |
| Execution Graph | repair 后有计数 `1/3/8`，但不是完整可追踪链路 | PARTIAL |
| Observability trace query | 3/3 `traceItems=0` | FAIL |
| Transcript 即时读取 | Round 2/3 可读；Round 1 脚本即时读取失败，但后验 transcript 存在 | PARTIAL |
| Task Loop/checkpoint | 普通 Chat repair 未自动进入 Task Loop/checkpoint | NOT OBSERVED |
| 严格稳定性验收 | 严格 `final.pass` 为 `false/false/false` | FAIL |

## 关键时间线

修复前：

- Gateway ready 后 `chat.send` 已由 Main 写入 socket。
- Runtime 约 150-170 秒后才读取 WS frame。
- Main 先触发 120 秒 RPC timeout。

修复后 smoke：

- `09:22:05.326` Main 发送 `chat.send`。
- `09:22:05.862` Gateway 收到 `chat.send`。
- `09:22:06.287` Main 收到 RPC `started`，耗时 961ms。
- `single-turn-smoke-after-fix-result.json` 记录 assistant 数量从 0 到 1，总耗时 54528ms。
- transcript 与 trajectory 记录实际模型为 `deepseek-v4-flash`。

这说明 Gateway 主链路已经从“ready 但不可服务”修复为“ready 后可处理核心 RPC”。剩余等待主要发生在模型/agent 运行和 UI/history 观测阶段，不是 Gateway ACK 阶段。

## 三轮任务结果

| Round | Plan | Repair | Oracle | 真实链路结论 | 严格验收 |
|---:|---|---|---|---|---:|
| 1 | `src/math.js` 未变；有 `.verse-claw/`；脚本等待 plan assistant 超时 | 文件实际修改成功；transcript 后验显示 `edit`、`exec`、final summary | PASS | PASS | FAIL |
| 2 | `src/math.js` 未变；有 `.verse-claw/`；162.0s 观测到 assistant | 5.23s 完成；transcript 可读 | PASS | PASS | FAIL |
| 3 | `src/math.js` 未变；有 `.verse-claw/`；5.55s 完成 | 5.33s 完成；transcript 可读 | PASS | PASS | FAIL |

三轮实际 diff 一致：

```diff
 export function subtract(a, b) {
-  return a + b;
+  return a - b;
 }
```

三轮独立 oracle 均输出：

```text
math tests passed
```

Round 1 的边界要明确：`real-runtime-validation-result.json` 中 `repair.send.success=false` 是验证脚本在 UI/history 层等待 assistant 超时；但 runtime transcript 后验显示 Round 1 实际使用 flash 完成了 `edit`、`exec node test/run-tests.mjs`，并产生了 final summary。因此 `AGENT_NO_TOOL_USE` 这个失败标签不反映真实 agent 行为，它反映的是脚本/host history 在 Gateway startup 周期内观测失败。

## 真实 vs 理想对比矩阵

| 项 | 理想情况 | 真实情况 | 判定 |
|---|---|---|---:|
| Chat/Gateway 主链路 | ready 后立即可处理 `chat.send` | 最新 smoke 秒级 ACK，三轮 repair 可进入 agent | PASS |
| Provider/model | 使用用户指定 DeepSeek flash | 最新结果确认 App、agent、transcript、trajectory 均为 flash | PASS |
| Model config persistence | 默认账号、默认模型、agent 模型都应稳定一致 | 真实请求稳定为 flash；`agents.defaults` 曾漂回 pro | PARTIAL |
| Workspace permission | Plan 完全无 diff | 目标文件无变化，但创建 `.verse-claw/` | PARTIAL |
| Tool/file write | acceptEdits 只改目标文件 | agent 修改 `src/math.js`；workspace 另有 `.verse-claw/` 元数据 | PARTIAL |
| Terminal/test execution | agent 运行测试并最终报告 | transcript 显示 agent 执行 `node test/run-tests.mjs`，独立 oracle 也通过 | PASS |
| Execution Graph | 每轮可定位完整执行链 | 有 graph count，但不能替代 trace/transcript 级完整链路 | PARTIAL |
| Observability trace | 可按 workspace/run 定位 trace | host `queryTraces` 对三轮 workspace 均返回 0 | FAIL |
| Transcript persistence | 每轮 user/assistant/tool 可即时读取 | 后验文件存在；Round 1 即时 host `chat.history` 失败 | PARTIAL |
| Task Loop/checkpoint | 复杂任务可见 checkpoint | 本次普通 Chat repair 未自动进入 Task Loop | NOT OBSERVED |
| Sensitive-content 边界 | 不输出 key/token | 满足，日志只显示 `hasKey=true` / `<redacted>` | PASS |

## 与既有审计结论对照

| 审计结论 | 本次真实验证 | 结论 |
|---|---|---|
| Gateway 是真实主链路 | 修复后 App/Gateway/WS/chat.send 可跑通 | 支持 |
| 普通 Chat 与 Task Loop 有边界 | 普通 Chat repair 未自动出现 checkpoint | 支持 |
| Execution Graph 产品化不足 | 有 UI 计数但不完整，不能作为唯一审计证据 | 支持 |
| Trace 需要运行时验证 | `queryTraces` 三轮均查不到 workspace trace | 支持且风险更明确 |
| 底层存在不等于可用 | plugin tools 存在但冷加载会阻塞 107s，已降级跳过 | 强支持 |
| 模型配置需端到端验证 | 早期账号默认是 flash 但 agent 仍跑 pro；修脚本后真实请求才全链路 flash；defaults 持久化仍需硬化 | 新增重要边界 |

## 失败分类

| Failure code | 最新状态 | 精确解释 |
|---|---:|---|
| `APP_START_FAILED` | 未触发 | Electron App 可启动 |
| `GATEWAY_NOT_READY` | 未触发 | Gateway ready 稳定出现 |
| `MODEL_PROVIDER_UNAVAILABLE` | 未触发 | DeepSeek key 可见，flash 模型实际生效 |
| `AGENT_NO_TOOL_USE` | 失败标签不准确 | Round 1 脚本未等到 assistant，但 transcript 证明 agent 有 `edit`/`exec`/final summary |
| `FILE_WRITE_FAILED` | 严格触发 | Plan 阶段创建 `.verse-claw/`；目标文件未被改 |
| `TEST_NOT_RUN` | 未触发 | transcript 和独立 oracle 均证明测试运行并通过 |
| `TEST_FAILED` | 未触发 | 三轮 oracle 通过 |
| `TRACE_MISSING` | 触发 | 三轮 `queryTraces` 返回 0 |
| `EXECUTION_GRAPH_MISSING` | 未完全触发 | repair 有 graph count，但质量不足 |
| `TRANSCRIPT_NOT_FOUND` | 部分触发 | Round 1 即时 host history 失败；后验 transcript 文件存在 |

## 最终判定

1. **真实环境能不能跑通？**  
   能。真实 App、Gateway、DeepSeek flash、agent、edit tool、exec tool、文件系统、Node 测试命令可以协作完成任务。按“目标文件 diff 正确 + agent transcript 证明工具执行 + 独立 oracle 通过”计算，修复任务是 3/3。

2. **能不能称为稳定产品链路？**  
   不能。核心执行链路已经可用，但产品化观测链路不稳定：Round 1 即时 `chat.history` 不可用，严格脚本没有等到 assistant；Observability trace 查询 3/3 缺失；Plan 模式仍写 `.verse-claw/`，不满足严格 no-diff。

3. **这是环境限制还是软件本身问题？**  
   主要是软件集成问题，不是单纯环境限制。已修复的阻塞包括 schema 漂移、CodeGraph loader、post-connect health refresh、plugin tool 冷加载阻塞、DeepSeek 实际 agent 模型漂移。剩余问题集中在观测和产品边界：trace 查询链路、history 即时可读性、Plan 模式元数据写入策略、Execution Graph 完整性，以及 `agents.defaults` 默认模型持久化一致性。

4. **哪些能力只是代码存在但本次不可用？**  
   Observability trace 对本次真实任务不可用；Task Loop/checkpoint 没有在普通 Chat repair 中自动出现；Execution Graph 只能说明 UI 有投影信号，不能证明完整执行追踪。

5. **当前组件内部能否正确协作？**  
   核心执行组件可以协作：Electron -> Gateway -> provider -> agent -> edit/exec tool -> workspace 文件 -> Node oracle 这条链路成立。观测组件没有完全协作：Gateway/runtime 产生了 transcript/trajectory，但 App 侧 `queryTraces` 查不到，host `chat.history` 在启动窗口内不稳定，UI Execution Graph 不足以形成完整审计证据。

6. **下一步最小闭环**  
   固化 trace 写入与 `queryTraces` 索引；修正 Plan 模式 `.verse-claw/` 写入边界或把它从“用户文件 diff”中单独分类；让 `chat.history` 在 Gateway startup/重连阶段返回 last-known transcript 而不是 unavailable；把 DeepSeek/defaults/main agent 模型配置收敛到单一权威源；把 Execution Graph 绑定到 runtime runId/tool events 后再跑 3/3 严格验收。
