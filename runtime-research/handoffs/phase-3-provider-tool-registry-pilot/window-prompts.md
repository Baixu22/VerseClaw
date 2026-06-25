# Phase 3 Multi-Window Prompts

Use one prompt per implementation window. Replace nothing unless you intentionally narrow the lane.

## Shared Prefix For Every Window

```text
你现在负责 ClawX Agent Runtime 迁移 Phase 3：Provider and Tool Registry Pilot 的一个并行实现 lane。

工作区：
C:\Users\27933\Desktop\clawx\ClawX

Phase 3 handoff 目录：
runtime-research/handoffs/phase-3-provider-tool-registry-pilot

必须先阅读：
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/README.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/parallel-lanes.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submission-template.md
- harness/specs/tasks/phase-3-provider-tool-registry-pilot.md

先运行或尝试运行：
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md

硬性约束：
1. 不新开第二 runtime service。verseshell-runtime 是用户配置的 stdio terminal tool 例外，不是 Provider/Tool Registry 服务。
2. 不新增 renderer direct IPC。
3. 不新增 renderer direct Gateway HTTP/WS。
4. 不做默认开启 cutover；所有新 registry 行为必须 flag/shadow/pilot 可回滚。
5. flag off 必须保持旧行为不变。
6. 每个关键结论必须有路径、函数、测试、命令证据。
7. 只写你的 lane 输出文件和必要实现/测试文件；跨 lane 冲突写入 Handoff Notes。
8. 输出文件必须严格使用 submission-template.md 的 headings。
```

## Window A Prompt

```text
<PASTE SHARED PREFIX>

你的 lane：
LANE_ID: lane-a-registry-contracts-and-flags
LANE_TITLE: Runtime provider/tool registry contracts, manifests, feature flags
OUTPUT_FILE: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-a-registry-contracts-and-flags.md

目标：
- 增加最小 RuntimeContextProviderRegistry / ToolProviderRegistry 合同或注册骨架。
- 使用 openclaw_runtime/src/runtime-core 的 canonical contracts。
- 定义 provider/tool manifest、id、capability、priority/order、fallback reason、error isolation shape。
- 增加安全默认 feature flags，默认不改变行为。
- 添加/更新 unit tests 证明 contracts、flags、manifest validation、duplicate provider handling。

禁止：
- 不注册默认 active provider/tool cutover。
- 不改 renderer。
- 不创建服务/端口/daemon。

最后运行：
- rtk node node_modules/vitest/vitest.mjs run <你的新增或修改测试>
- rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff
```

## Window B Prompt

```text
<PASTE SHARED PREFIX>

你的 lane：
LANE_ID: lane-b-context-provider-registry-pilot
LANE_TITLE: Context provider registry over LoopContextPack and LegacyContextEngine
OUTPUT_FILE: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md

目标：
- 把 LoopContextPack 和 LegacyContextEngine 包装为兼容 context providers。
- flag off/on shadow mode 都不能改变 prompt text / messages identity / order。
- 输出 provider diagnostics、ContextItem evidence、fallback metadata。
- 不实现 AgentMap ranking，不做 provider ordering 默认切流。

建议测试：
- flag off registry 不影响 LegacyContextEngine.assemble()。
- flag on shadow diagnostics 不影响 formatLoopContextPackForPrompt()。
- provider exception 被隔离并记录 fallback reason。

最后运行：
- rtk node node_modules/vitest/vitest.mjs run tests/unit/context-shadow-adapter.test.ts <你的新增测试>
```

## Window C Prompt

```text
<PASTE SHARED PREFIX>

你的 lane：
LANE_ID: lane-c-tool-provider-registry-pilot
LANE_TITLE: Tool provider registry over MCP callTool compatibility provider
OUTPUT_FILE: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-c-tool-provider-registry-pilot.md

目标：
- 把现有 MCP callTool shadow adapter 包装为第一个 compatibility tool provider。
- 旧 McpCallToolResult 返回 shape 必须不变。
- 增加 provider manifest、policy/fallback metadata、normalized ToolCallResult evidence。
- approval waiting / blocked / error 仍保持 adapter metadata，不做权限系统切流。
- 不新增 visible MCP tool/catalog。

建议测试：
- full tests/unit/mcp-api.test.ts 必须通过。
- 新 registry pilot flag off 不 emit registry diagnostics。
- flag on emit provider diagnostics + ToolCallResult shadow，但 legacy return object identity/JSON/keys 不变。

最后运行：
- rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts <你的新增测试>
```

## Window D Prompt

```text
<PASTE SHARED PREFIX>

你的 lane：
LANE_ID: lane-d-taskloop-registry-shadow-integration
LANE_TITLE: TaskLoop consumes registry diagnostics as shadow evidence only
OUTPUT_FILE: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-d-taskloop-registry-shadow-integration.md

目标：
- 在 flags 启用时，把 registry diagnostics/evidence refs 附加到 TaskLoop shadow events。
- 不改变 TaskLoop final status、legacy lifecycle payload、self-check decision、checkpoint authority。
- registry fallback reason 作为 shadow evidence，不作为 final task failure。
- 保持 runtimeTaskEventLogShadow/runtimeCoreShadow/evidenceVerifierShadow 独立可回滚。

建议测试：
- complete loop + registry diagnostics shadow event。
- blocked loop legacy status 不变。
- registry shadow sink throws 不影响 TaskLoop。
- flags off 无新增字段。

最后运行：
- rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts <你的新增测试>
```

## Window E Prompt

```text
<PASTE SHARED PREFIX>

你的 lane：
LANE_ID: lane-e-harness-tests-boundary-docs
LANE_TITLE: Phase 3 validation, boundary scan, docs/index updates, synthesis readiness
OUTPUT_FILE: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-e-harness-tests-boundary-docs.md

目标：
- 验证 harness spec。
- 收集所有 lane 的测试命令和结果。
- 跑 renderer direct IPC/Gateway HTTP boundary scan。
- 如果 Main/Gateway comms path 被改，跑 comms replay/compare。
- 如果 UI 被改，跑 targeted E2E。
- 最后准备 synthesis 输入；只有所有 lane accepted 后才建议更新 agent-runtime-index.md。

建议命令：
- rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff
- rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
- rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'

最后：
- 写 lane-e submission。
- 不要把 under-evidenced lane 综合为 accepted。
```

## Synthesis Window Prompt

```text
你现在负责综合 Phase 3：Provider and Tool Registry Pilot。

工作区：
C:\Users\27933\Desktop\clawx\ClawX

必须先阅读：
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/README.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submission-template.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis-template.md
- all runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-*.md

审计重点：
1. 是否违反“不新开第二 runtime 服务”。
2. 是否保持 runtime registry/core 在 openclaw_runtime 或允许的 Main adapter 边界内。
3. 是否只做 registry pilot/shadow adapter，没有默认改变旧行为。
4. 每个 lane 是否有 feature flag / shadow / rollback。
5. 每个关键结论是否有路径、函数、测试、命令证据。
6. 是否新增 renderer direct IPC / Gateway HTTP 绕路。
7. 是否修改 UI；如果改了，是否有 E2E。
8. 测试是否覆盖 flag off 行为不变。
9. provider/tool/context/status/evidence 命名是否冲突。
10. 格式或证据不足的 lane 标为 needs_revision，不要综合为事实。

输出：
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md

synthesis.md 必须包含 synthesis-template.md 的所有章节。
```
