# Harness and Codex Authority Baseline

> Status: planning contract for TF-0565. This document does not prove runtime availability, packaged delivery, model quality, or product approval.

## 1. Problem

Verse Claw already contains several different integration layers that all mention Codex or agent harnesses:

- OpenClaw's native embedded agent loop;
- the bundled `codex` app-server harness and `/codex` command surface;
- the `acpx` ACP runtime and its Codex/Claude adapters;
- the `codex-supervisor` remote app-server control surface;
- other provider or CLI harnesses.

Treating them as interchangeable creates duplicate ownership, misleading capabilities and dead controls. This baseline freezes the layers and the scenarios before any implementation node changes product behavior.

## 2. Authority matrix

| Layer | Current owner / source | What it owns | What it must not own | Current evidence boundary |
|---|---|---|---|---|
| OpenClaw native loop | `openclaw_runtime/src/agents/embedded-agent-runner/` and `openclaw_runtime/src/agents/harness/builtin-openclaw.ts` | Turn execution, tool loop, runtime policy, context assembly hooks, transcript/event production | UI agent selection, Task Ledger state, or a second approval authority | Source plus prior runtime evidence; per-scenario behavior must be re-run |
| Codex app-server harness | `openclaw_runtime/extensions/codex/harness.ts`, `src/app-server/run-attempt.ts` | A Codex thread-backed execution attempt, native Codex tools when allowed, compaction ownership and Codex events | ClawX task state, approval decisions, workspace permissions, app-server binary packaging guarantee | TF-0566 proves source + packaged Windows --dir availability for @openai/codex 0.137.0; authenticated model turns remain not-run |
| `/codex` command surface | `openclaw_runtime/extensions/codex/src/commands.ts`, `command-handlers.ts` | Explicit user/agent control of bind, resume, steer, stop, model, permissions, threads, CLI session lookup and plugin access | General settings UI or a second session lifecycle | Command source exists; UI-independent behavior needs real invocation evidence |
| ACPX runtime | `openclaw_runtime/extensions/acpx/` | Embedded ACP backend, ACP session transport, adapter-based external agents such as Codex and Claude | ClawX Task Ledger, approvals, tool policy or a second task graph | Generic ACP SDK is packaged; concrete adapter availability must be checked separately |
| Codex Supervisor | `openclaw_runtime/extensions/codex-supervisor/` | Read/list/send/interrupt to already-running Codex app-servers | Launching a local Codex harness or replacing `/codex` bind/resume | Separate remote-control tool surface; not the local harness path |
| Copilot / provider runtimes | `openclaw_runtime/extensions/copilot/`, provider plugins and CLI backends | Provider-specific agent loop and tools | Universal capability parity or ClawX task completion | Each runtime has its own guarantees; no aggregate claim |
| ClawX product owners | Workspace, Session, Task Ledger, Permission, Trace, Resource and Host API services | User-visible state, authorization, completion, evidence and effective-state projection | Replacing an agent runtime's internal loop | Existing owner contracts and tests |

The product owner is always ClawX/OpenClaw. An external harness may execute work, but it cannot make a task complete, grant a tool, or approve a side effect by itself.

## 3. Selection and fallback rules

1. A runtime/model policy may select a plugin harness when it is explicitly configured for that provider/model, or when the existing OpenAI official-endpoint route selects Codex by policy.
2. A missing configured plugin harness must fail closed, not silently fall back to a different executor after execution starts.
3. `auto` may choose a registered harness only through the existing selection policy; it must not turn a disabled plugin into an enabled one.
4. `/codex` is an explicit command surface for the native Codex app-server, not a second global runtime selector. ACP use must be an explicit alternative, not an implicit fallback.
5. The same turn must not be replayed on a second harness after tool or assistant side effects. Replay feasibility is constrained by the existing recovery rules.
6. Product effective-state must distinguish configured selection from actually-observed runtime selection and unknown/stale observations.

## 4. Capability vocabulary

Use these words separately:

- **source exists**: a file, method, type or command exists.
- **runtime reachable**: the real product call path can reach it after configuration and permission.
- **effect verified**: a real execution produced a read-back receipt or observable artifact.
- **packaged available**: the packaged application contains the required binary, module and resource.
- **default product path**: the ordinary user path activates it without an experimental/opt-in switch.
- **release approved**: public distribution, GA or product approval has been granted separately.

The current source must not be described as more than its highest proven level.

## 5. Real scenarios

### S1: Ordinary Chat on the native loop

The user sends a normal message. ClawX owns the session and visible task facts; the native runtime owns turn execution. No Task Ledger root is created just because tools are available.

### S2: Normal Codex harness turn

An eligible provider/model is configured for Codex. The Codex app-server executes the attempt after sandbox/approval/permission resolution. ClawX receives events and projects run status; it does not claim that the management UI is the runtime itself.

### S3: Explicit `/codex` conversation control

A user or authorized agent binds/resumes a Codex thread, steers or stops it, and inspects status. ACP is not used unless explicitly requested. Unknown or missing binding state remains visible; no fallback thread is invented.

### S4: Packaged desktop launch

The packaged app starts a managed Codex app-server from a path inside the application payload, authenticates through the expected profile, and reports the observed version. A dev-only pnpm link is not enough.

### S5: CI / headless client

A client invokes an approved structured execution surface with a bounded output contract. It does not assume that an Electron window exists. The current `coding-run/v1` projection is not a Codex CLI compatibility layer.

### S6: ACP alternative

An explicitly configured ACPX adapter starts and completes a bounded session. If the adapter is absent or fails health, the run fails closed; it does not silently switch to the native Codex harness.

### S7: Alternate agent / harness evaluation

A candidate such as OpenCode or Goose is evaluated behind an adapter boundary only if it improves a real scenario. The evaluation records protocol, permissions, session identity, failure behavior, dependency and cost; it is not a blanket adoption claim.

### S8: VB browser task with a harness

An agent opens, observes, acts, re-observes and verifies an owned browser session. The runtime harness may propose/execute the action, but Browser's approval, private-network denial, session ownership and business verdict stay with Browser owners.

### S9: VS governed execution with a harness

A candidate command runs through the existing ACP/typed execution contract with an immutable argv, bounded output, owner receipt and explicit external-write limitations. A harness's presence does not bypass VS approval or journal rules.

### S10: VG concurrent candidate with a harness

An agent working in an isolated workspace gets repository facts and a bounded risk/advisory projection. VG may provide facts and candidate evidence, but the harness verdict, Task Ledger completion and Git apply authority remain separate.

### S11: Failure / fallback

Missing binary, stale binding, auth failure, unsupported tool, sandbox refusal, adapter unavailable and runtime timeout must produce explicit failures. No silent fallback and no successful-looking completion.

## 6. Codex 正式使用：采用什么，不采用什么

结论不是“把 Codex CLI 整体放进 ClawX”，而是把 Codex 作为一个**受管执行适配器**；只有它能显著改善真实编码回合，且 ClawX 仍持有任务、审批、权限、证据和完成判定时才采用。

| 决策 | 采用 | 不采用 / 暂不采用 | 原因 | 归属节点 |
|---|---|---|---|---|
| Codex app-server execution | 作为可选的、受管的编码执行子层 | 不把它变成第二套 scheduler、Task Ledger 或审批人 | 它能提供 Codex 线程、工具活动与压缩；ClawX 需要统一 turn/trace/effective-state | TF-0566、TF-0567 |
| Codex SDK / CLI subprocess | 可做 CI/headless 或开发诊断适配 | 不从 renderer 直接 spawn、不把 CLI 文本当稳定协议 | 稳定产品边界是 app-server/Host API；CLI 存在认证、版本和打包漂移 | TF-0566 |
| `/codex` control surface | 保留为显式高级控制 | 不新增第二个全局 Work Mode 或权限层 | 绑定/恢复/steer/stop 是线程控制，不等于产品任务生命周期 | TF-0567 |
| Codex Plan / Review prompts | 后续受控映射为请求意图或工具流程 | 不靠伪造 `collaborationMode` 绕过当前 app-server 合同 | 当前 lifecycle 固定为 `mode: "default"`；Plan/Review 尚未原生产品化 | TF-0567（需先证明协议支持） |
| ACPX | 作为显式选择的替代运行时 | 不作为缺包时的隐式 fallback，不以 ACP v2 Draft 为硬依赖 | adapter 缺失必须 fail closed；v1/registry 与草案必须分开 | TF-0568 |
| OpenCode | 可作为 headless server / SDK 适配候选 | 不假设 ACP 与 TUI 完全同能力，不直接共享 ClawX 状态 | 官方提供 OpenAPI/SDK，但会话、权限、成本仍需单独验证 | TF-0568 |
| Goose | 可作为 ACP provider 参考或对照 | 不假设可 fork/resume，不把其 provider session 当 ClawX session | 官方明确 ACP 下尚无 fork/resume，session ID 也不对齐 | TF-0568 |
| OpenHands SDK / Agent Server | 可作为沙箱化远端执行候选 | 不引入其整个应用层或第二 workspace authority | SDK 的四包边界清晰，但 Python/部署/认证成本更高 | TF-0568 |
| Copilot SDK | 可作为 BYOK/企业环境候选 | 不因 GA/多语言 SDK 就宣称与 Codex 等价 | 认证、远程会话、hook 与数据政策需要独立评估 | TF-0568 |
| Playwright MCP | 作为浏览器能力对照与外部适配参考 | 不替代 VB 的 session/owner/private-network 规则 | VB 已有自己的安全与产品边界；工具数量不等于产品可用性 | TF-0569 |

### 6.1 真实使用场景：哪些功能“用得上”

| 场景 | 应有路径 | 不应出现的冗余 |
|---|---|---|
| 普通问答、低风险解释 | native loop | 不因安装了 Codex、ACP 或浏览器工具就强制切换 |
| 真实仓库编码任务 | 显式/策略选择 Codex app-server，ClawX 统一呈现 turn、工具、审批和恢复 | 不在 Settings、`/codex` 和 ACP 各维护一套运行状态 |
| 已有 Codex 线程的继续/steer/stop | `/codex` 或现有绑定控制 | 不伪装成新任务、不悄悄新建线程 |
| 显式使用其他 agent | ACP/OpenCode/Goose/OpenHands 等经 adapter 选择和健康检查 | 不把第三方 CLI 安装成功当成 ClawX 已可用 |
| 需要远端/受控执行 | 现有 Codex Supervisor 或 VS 的受管执行边界 | 不让 supervisor 变成第二套本地 runtime |
| 浏览器验证 | VB 的打开→观察→操作→再观察 | 不能用一个 Playwright MCP 快照替代产品验收 |
| 命令副作用 | VS 的 immutable argv、bounded output、receipt、审批 | 不让 harness 自己批准或自行认定成功 |
| 并发候选和仓库事实 | VG 的 workspace/session/candidate/advisory | 不让 VG 直接执行、批准、完成或 `land` |
| 证据冲突/缺失 | ClawX 显式 `unknown / stale / failed / partial` | 不显示绿色但无法回读的“成功” |

### 6.2 失败与降级合同

- Codex binary、adapter、认证或 app-server 启动失败：保留可诊断错误，不静默切换。
- 已有副作用后的 harness 失败：不做自动跨 harness 重放；交给现有恢复/审批 owner。
- 未安装或未获批的替代 harness：只允许“不可用/未配置”，不显示为可选成功路径。
- 权限/sandbox 拒绝：由产品 owner 呈现原因和可采取动作；harness 不得自行提权。
- 证据过期或无法回读：状态必须保持 `stale` / `unknown`，不能用搜索摘要或日志尾部当验收。

## 7. Deliberate non-goals

- Copying Codex Cloud or OpenAI-hosted execution.
- Copying the complete Codex TUI or plugin marketplace.
- Replacing ClawX Task Ledger, approval or Git apply authority with a harness.
- Introducing a second generic scheduler, task graph, memory store or context engine.
- Making ACP v2 a required contract while it is a draft.
- Claiming that OpenCode, Goose, OpenHands, Copilot or ACP automatically give equivalent quality, permissions or cost.
- Turning every optional component on by default or treating source presence as GA.

## 8. Source and research references

Use this list as research input, not acceptance evidence:

- `docs/modules/llm-and-models.md`
- `docs/modules/sessions.md`
- `docs/modules/context-and-memory.md`
- `docs/modules/workspace-and-coding.md`
- `docs/modules/multi-agent-and-tasks.md`
- `docs/modules/verse-tools.md`
- `docs/modules/resources-and-observability.md`
- `docs/modules/component-inventory.md`
- `openclaw_runtime/src/agents/harness/selection.ts`
- `openclaw_runtime/src/agents/harness/policy.ts`
- `openclaw_runtime/extensions/codex/harness.ts`
- `openclaw_runtime/extensions/codex/src/app-server/config.ts`
- `openclaw_runtime/extensions/codex/src/app-server/managed-binary.ts`
- `openclaw_runtime/extensions/codex/src/command-handlers.ts`
- `openclaw_runtime/extensions/acpx/index.ts`
- `openclaw_runtime/extensions/codex-supervisor/index.ts`
- `openclaw_runtime/extensions/copilot/harness.ts`
- `shared/types/execution-environment.ts`
- `shared/types/session-effective-policy.ts`
- `packages/README.md`
- `docs/dev/versegit-validation-layer/README.md`
- `docs/dev/versegit-product-integration/TF-0517/verified-glm-20261025/`
- `docs/dev/verseshell-foundation/STATUS.md`
- `harness/specs/fixtures/versebrowser-invocation-maturity/current-20261022/`

## 9. Verification contract and node handoff

TF-0565 is complete only when all of the following can be read from disk:

1. The authority matrix separates native loop, Codex app-server, `/codex`, ACPX, Codex Supervisor, Copilot and external harnesses.
2. The scenario matrix covers S1-S11 with at least one negative/failure case per product-critical path.
3. The capability vocabulary separates source existence, runtime reachability, effect verification, package delivery, default path and release approval.
4. Every local source reference resolves; every external source records URL, title, type, retrieval method, observation time, content scope and status, and is not treated as acceptance evidence.
5. The document contains the Codex use/no-use decision, comparative harness decision table and failure/degradation contract.
6. VB/VS/VG collaboration seams and product locks are stated without turning them into a second executor, task, approval or verdict authority.
7. No runtime code, dependency, product default, release lock or publication state changes in this node.

### Node handoff

| Node | First executable outcome | Must not absorb |
|---|---|---|
| TF-0566 | Prove managed Codex app-server availability in source and packaged desktop; record binary/version/auth/startup/failure evidence | Product UI selection, task semantics, ACP substitution |
| TF-0567 | Connect the existing Settings/Session/effective-state surfaces to the proven Codex path; expose unknown/stale/unavailable honestly | A new scheduler, Work Mode authority, second task ledger |
| TF-0568 | Adapter contract and one real pilot are landed in `shared/harness-adapter-contract.ts` and `harness/specs/fixtures/harness-codex-adapter-pilot/`; ACPX Codex initialize passed, OpenCode failed before a turn, quality/latency/cost remain not-run | Batch-installing every harness or claiming capability parity |
| TF-0569 | Test one real VB, one VS and one VG collaboration seam under existing owners | Bypassing VB approval, VS journaling, or VG advisory boundary |
| TF-0570 | Define and freeze pass/fail evidence per scenario, including negatives and stale/failed observations | Treating docs, snippets, logs or green UI as runtime acceptance |

TF-0566 is complete for source and packaged Windows --dir availability. TF-0567 is complete: it projects the selected harness into the existing Session effective-state surface, including configured/effective/unverified and missing/stale/mismatch generation reasons. TF-0568 has an adapter contract and a real initialize/failure pilot, but quality/latency/cost comparisons remain not-run; it stays ready rather than done. TF-0569 and TF-0570 remain proposed; TF-0570 is blocked on TF-0567 through TF-0569.

## 10. VerseSearch source ledger

The source ledger is [`verseSearch-sources.json`](../../harness/specs/fixtures/harness-codex-authority-baseline/verseSearch-sources.json), schema `VerseSearchSourceLedger/v2`. It records primary pages returned by the retrieval tool during this pass, not search snippets.

| Source group | Pages used | Retrieval status |
|---|---|---|
| ACP | v1 overview, session modes, agent registry; v2 prompt lifecycle | retrieved; v1/v2 Draft kept separate |
| OpenCode | server, SDK, ACP | retrieved; adapter is not TUI/headless equivalence |
| OpenHands | SDK overview, Agent Server | retrieved; remote/sandbox deployment is a candidate only |
| Codex | SDK, app-server, sandboxing, public repository | retrieved; SDK/app-server are distinct surfaces |
| Copilot / Goose / Playwright | Copilot SDK GA, Goose ACP providers, Playwright MCP | retrieved; vendor capability is not ClawX integration |

`retrieved` means the page body was returned during this observation pass. It does not prove local availability, runtime reachability, packaged contents, permission behavior or product acceptance. A future source that cannot be fetched must remain `search-result-only` or `failed` and cannot support a capability claim.

The ACP registry is not proof that every listed adapter exists in the installed app. It confirms that Codex is listed through a separate adapter; the packaged tree still needs a concrete adapter-artifact check. That is why TF-0566 and TF-0568 are separate nodes.
