# VerseShell 基座化编排计划

## 当前执行位置（2026-08-14）

`TF-0065` / VS-P2-02 argv-only command profiles 已完成工程实现和 focused/regression 验证。
普通单段 coding 命令在审批前收敛为 host-owned 不可变 execution plan，并以 direct argv 进入
governed process；pipeline/chain/redirect/heredoc/inline evaluation/显式解释器保持独立的
terminal-shell 边界。profile（`test`/`build`/`lint`/`git`/`generic`）由 host 从审批前
analysis 推导（含 `pnpm`/`npm`/`corepack` `exec`/`dlx` runner 透传），模型不能选择
profile、interpreter、PATH/PATHEXT、policy 或 approval token。Windows `.exe`/`.com` 保持
direct argv；`.cmd`/`.bat` 保留 resolved script identity 和经审计的 ComSpec/SystemRoot
`cmd.exe` interpreter（`interpreterProfile: "windows-cmd"`），审批后不再从 display command
重解析，身份漂移在 process 边界 fail-closed。cwd/env/argv/timeout/output 均为有界 metadata，
超界或 NUL 一律 fail-closed，失败不切换 native/MCP/legacy fallback。

验证：`pnpm verseshell:test` PASS（bundle 13/13、runtime-bundle 11/11、OpenClaw VerseShell
15 files / 141 tests、MCP 11/11）；root contract 6/6；node typecheck、comms replay/compare、
scoped ESLint、`git diff --check` PASS；Harness `--no-diff` validate PASS，普通 diff-aware
validate 仍被共享工作树无关 ownership 与 harness 子包依赖缺失阻断，已如实记录。证据见
`P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md`。

本包仍是 engineering-only evidence，不解锁 P2-03 diagnostics、P3 写入、provider canary、
default-on、GA 或 product approval。`TF-0065` closeout proposal
`TFP-verseshell-p2-02-closeout-20260814` 已保存并应用（validate/export PASS），唯一下一节点
`TF-0066` / P2-03 已解锁为 `ready`。

版本：v1.2（P2-02 closeout 已应用）  
日期：2026-08-14  
计划状态：`TFP-verseshell-foundation-orchestration-20260814` 已应用；program 为 `in_progress`。VS-G0-01 / `TF-0057`、VS-P0-01..P0-03 / `TF-0058`..`TF-0060`、VS-P1-01..P1-03 / `TF-0061`..`TF-0063`、VS-P2-01 / `TF-0064`、VS-P2-02 / `TF-0065` 均已 closeout；唯一下一节点 `TF-0066` / VS-P2-03 为 `ready`。所有 rollout/product locks 继续关闭。

## 1. 目的与权威边界

本计划把 [FOUNDATION-DEVELOPMENT-ROADMAP.zh-CN.md](./FOUNDATION-DEVELOPMENT-ROADMAP.zh-CN.md) 转化为严格串行、每包可独立验收的工程 DAG。目标是把 VerseShell 建成 ClawX 的受监督本地 coding 执行与结果平面，而不是新增一套模型工具目录或替换产品层语义。

权威顺序如下：

1. [STATUS.md](./STATUS.md) 决定当前 rollout 状态；在任何证据不足时保持 `default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。
2. [REAL-CAPABILITY-AUDIT.zh-CN.md](./REAL-CAPABILITY-AUDIT.zh-CN.md) 决定当前 P0 缺口；新鲜实际失败优先于历史工程报告。
3. 本计划决定任务依赖、工作包边界和验收编排；它不覆盖状态文件或 Harness spec。
4. 每个实施切片的 Harness task spec 和 rule 决定实际可修改范围与命令门禁。

当前已知事实不是“可放行的 governed execution 已完成”，而是：历史 UAS-05/UAS-06 工程证据只能作为实现输入；P0-02 已用固定提交、四个 ordered patch、8 项 recovered input、完整 Rust/Python qualification、两次独立可重复构建和 manifest/package/runtime 校验建立 fresh source/build identity；P0-03 又用当前 verified binary 通过真实 approval denial、approved retry、token isolation、artifact recovery 和 no-native-fallback probe。详细记录见 [P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md](./P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md) 与 [P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md](./P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md)。Harness diff-aware 验证仍受共享工作树无关 changed paths 和 harness 子包依赖缺失阻断，该残余不被扩大 touchedAreas 或跳过规则掩盖。P0-03 工程通过不等于 canary、provider、GA 或产品放行证据。

## 2. 不可变约束

- 模型可见 facade 固定为 `read_file`、`search_content`、`run_command`、`result_query`；不暴露 31 个内部 operation，也不允许模型选择 host、capability、policy 或 approval token。
- OpenClaw 继续拥有命令解释、风险分级、allowlist、审批、受清洗环境和模型工具 schema；VerseShell 只拥有受批准计划的执行、进程生命周期、有界输出、artifact 和运行时内部校验。
- ClawX/Electron 继续拥有 binary/protocol/catalog 供应链验证、workspace、write journal、undo、诊断和 Renderer 的 host-api 边界。
- governed 失败一律 fail-closed；禁止 native fallback、隐式重放 effectful 请求、以 workspace jail 声称 OS sandbox，或把外部 shell 写入误报为事务可回滚。
- 一次只推进一个 ready 工作包和其唯一 Harness spec。DAG 保留精确依赖，但执行顺序强制串行。
- 每个功能或架构改动都复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`；涉及 Renderer/Main/Gateway/OpenClaw 通信时采用 `gateway-backend-communication` 并运行 comms 门禁。

## 3. 目标执行链

```text
组件请求
  -> 稳定 facade
  -> OpenClaw policy + approval
  -> ClawX execution adapter
  -> VerseShell typed ACI
  -> 受监督 OS process / filesystem
  -> bounded observation + artifact
  -> 组件自己的语义结果
```

责任边界不可逆转：

| 层 | 唯一责任 | 不得承担 |
|---|---|---|
| OpenClaw runtime | policy、approval、profile provenance、fail-closed、模型工具表面 | shell 字符串二次解释、进程树实现、模型提供的授权环境 |
| ClawX Main / Electron | bundle identity、workspace/journal、host-api、诊断和 kill switch | Renderer 直调 `ae.exe`、绕过审批的环境透传、伪事务化外部写入 |
| VerseShell runtime | typed JSONL、参数校验、argv/process/PTY、输出界限、artifact | 产品授权、OS sandbox 声明、自动扩大 capability 或 native 降级 |
| MCP | 外部兼容 adapter | 内部主通道、policy/workspace/governed owner 绕过 |

## 4. 工作包 DAG

下表是正式 Task Forest proposal 将创建的候选节点。VerseShell foundation 是独立的长期全局目标：它覆盖本地执行、facade、事务协作和 canary，范围明显超过 `TF-0007` 的 DCS 受控内测收口。它与 `TF-0007` 保持 `related_to`，向 `TF-0010` 建立 `contributes_to`，并仅让真实 canary 的候选证据贡献给 `TF-0006`；这些跨边不改变既有目标的 owner、状态或放行语义。

此前 capability audit 的 G0 曾建议把相关工作放在 `TF-0007` 下。当前任务图中 `TF-0007` 的完成目标是 DCS 与关联组件的受控内测，而本路线图还包括 execution plane、facade、journal 协作、跨平台产物和长期 canary。因此本次以独立 global task 表达主责任，并保留上述跨边，避免把两个不同的 acceptance surface 混成一个状态。

| 包 | 主要 owner | 串行前置 | 退出定义 | 预期 Harness spec |
|---|---|---|---|---|
| VS-G0-01 | 架构/测试 | 用户确认 proposal | 建立证据登记、P0 spec、owner map、基线命令；不改 runtime 行为 | `verseshell-foundation-governance.md` |
| VS-P0-01 | VerseShell Rust | VS-G0-01 | 短 uptime、重启、agent/non-agent、JSON/compact smoke 均不 panic；`cargo test --no-run` 成为真实门禁 | `verseshell-p0-runtime-startup.md` |
| VS-P0-02 | Runtime release + Electron | VS-P0-01 | clean checkout 从固定 source/patch/lockfile 重建；binary、crate、handshake、catalog digest 一致 | `verseshell-p0-reproducible-bundle.md` |
| VS-P0-03 | OpenClaw + runtime | VS-P0-02 | 真实 binary approval deny 返回 `E_NEEDS_APPROVAL`；批准重试一次且 token 隔离；无 native fallback | `verseshell-p0-governed-probe.md` |
| VS-P1-01 | OpenClaw + VerseShell | VS-P0-03 | process manager 与 ACI client 的状态、deadline、correlation、crash/timeout/cancel/restart 语义可审计 | `verseshell-p1-supervised-aci.md` |
| VS-P1-02 | Runtime + shared | VS-P1-01 | stdout/stderr/JSON/observation 独立上限；截断、artifact、`result.query`、恢复和稳定错误码闭合 | `verseshell-p1-observation-artifact.md` |
| VS-P1-03 | Compatibility | VS-P1-02 | MCP 默认 deny；eval 仅开发 profile；依赖、安装、启动与版本单源均验证 | `verseshell-p1-mcp-compatibility.md` |
| VS-P2-01 | Coding integration | VS-P1-03 | `read_file`、`search_content`、`result_query` 在真实仓库走 facade/adapter；无越界读取或敏感输出泄漏 | `verseshell-p2-readonly-facade.md` |
| VS-P2-02 | Coding integration + policy | VS-P2-01 | test/build/lint/git 使用 argv-only command profile；cwd/env/timeout/write-dir 和 output/artifact 行为可验证 | `verseshell-p2-command-profiles.md` |
| VS-P2-03 | Observability | VS-P2-02 | request/trace/parent trace、结果、错误分类和诊断在 agent/UI/support bundle 中可关联且不泄漏原始敏感内容 | `verseshell-p2-trace-diagnostics.md` |
| VS-P3-01 | ClawX Main + journal | VS-P2-03 | `file.patch` 仅产生 preview/precondition/diff artifact；ClawX journal 为唯一 commit authority | `verseshell-p3-patch-preview-journal.md` |
| VS-P3-02 | Security + product | VS-P3-01 | external write 显式标注、需要独立审批/提示，且从不声称不可回滚写入可原子恢复 | `verseshell-p3-external-write-policy.md` |
| VS-P5-01 | Operator + release | VS-P3-02 | reviewed paired provider-backed canary、rollback、kill-switch、artifact recovery、soak 和平台握手证据齐全；仅产生 continue/reduce/stop 建议 | `verseshell-p5-real-canary.md` |

工作包标签沿用路线图的“P3 写入”建议编号；它实际覆盖原路线图的 Phase 4 写入与事务协作。因此 `VS-P5-01` 的前置条件是路线图 Phase 0 到 Phase 4 的所有工程工作包完成，而不是仅到原 Phase 3。

`VS-P5-01` 不是 default-on 任务。即便其工程和真实 evidence 均通过，也只能由独立负责人按 `STATUS.md` 明确更新 rollout 锁；没有该状态变更，基础仍保持 `default-off`。

## 5. 阶段门槛与停止规则

### G0：治理与证据冻结

完成条件：正式 Task Forest proposal 被用户确认并应用；创建第一个 scoped spec；运行 `pnpm harness context --spec ...`；明确 P0 source/binary、失败复现、非目标、owner 和 acceptance 清单。

停止规则：不得借 G0 改动 runtime、flag、model tool schema、release lock 或 UI。若现有 spec 与当前 audit 冲突，先修订 spec/rule，再开始代码。

### P0：可启动、可重建、可验证

P0 完成条件同时满足：

- short-uptime panic 消失，并有 restart/format/agent matrix 回归。
- `cargo test --manifest-path verseshell-runtime/Cargo.toml` 与 `--no-run` 均通过，且测试真正编译 runtime 测试目标。
- clean checkout 能从已跟踪 source snapshot、patch、lockfile 和工具链重建可验证 binary；manifest 不再掩盖 dirty input 或协议漂移。VS-P0-02 已满足 source/build identity、双构建和 bundle fail-closed 证据。
- `pnpm verseshell:test`、仓库级 typecheck/comms 门禁和 `verseshell-p0-governed-probe.md` scoped Harness 结构校验通过；真实 governed probe、approval deny/approved retry、token isolation、artifact recovery 和 no-native-fallback 已形成独立工程证据。

任何一项失败：禁止 P1、禁止 canary、禁止将历史 UAS-05/UAS-06 绿色报告作为替代证据。

### P1：受监督执行内核

P1 完成条件：`starting -> handshaking -> ready -> backoff/stopped/failed` 生命周期有明确实现；每个请求绑定 requestId、traceId、deadline 和 process key；response id mismatch 为协议错误；只读且明确幂等请求可受控重试，写入或未知副作用绝不自动重放；kill switch 停止新执行并保持 fail-closed。

VS-P1-01 当前实现以 `harness/specs/tasks/verseshell-p1-supervised-aci.md` 为唯一 scoped spec：
process manager 负责状态和 transport metadata，governed process 负责 owner-bound lifecycle 映射。
24/24 process-manager tests、6/6 governed lifecycle tests、完整 VerseShell suite 和 61/61 的
OpenClaw VerseShell 目录测试通过；P1 证据见
[`P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md`](./P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md)。
当前 node typecheck 的两条 provider model typing 既有错误、共享工作树 diff ownership residual
和非致命 test-project observation errors 均保持显式记录。P1 仍不改变 default-off、canary、
provider、GA 或产品批准边界。

VS-P1-02 当前实现以 `harness/specs/tasks/verseshell-p1-observation-artifact.md` 为唯一 scoped
spec。shared contract、normalizer、governed result query 与 focused tests 已完成；`pnpm
verseshell:test`、scoped shared/runtime tests、node/web typecheck、scoped ESLint/oxlint、comms
replay/compare 均通过。普通 diff-aware Harness validate 仍被共享工作树的无关改动和 harness
子包缺失依赖阻断，`--no-diff` structural validation 通过；该残差会写入 P1-02 evidence，不会被
扩大 touchedAreas 或被解释为 release/canary evidence。P1-02 closeout 已应用，当前仅保留
P1-03 closeout proposal 待应用；在 closeout 前不解锁 P2。

### P1-03：MCP 兼容层收紧

`TF-0063` / VS-P1-03 已完成工程实现并形成独立 evidence。MCP 仅作为外部兼容 adapter：
package 已加入 workspace 和 frozen lockfile，SDK 安装与 JSON-RPC startup smoke 可复现；
product profile 默认 deny，拒绝 `cap all`、`*` 和未知 capability，工具 catalog 按 profile/grant
过滤。capability 名称与 pinned runtime grant vocabulary 对齐，MCP-only capability 不传入 runtime；
effectful compatibility tools 在 governed write boundary 前保持隐藏。`verseshell_eval` 与 shell
字符串兼容只在显式 development profile 注册，shell 兼容只接受显式 argv，并通过 strict agent
policy 的同一 `shell.exec` capability boundary；任何失败不切换 native shell、legacy eval 或其他
owner。package/runtime/protocol/catalog identity 从 tracked metadata 读取。
该包只提供 engineering evidence，不开启 default-on、canary、写入或产品批准。详见
[`P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md`](./P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md)。

### P2：低风险 coding 工作流

P2 先交付只读再交付受控 process。只读 facade 必须复用 `shared/verseshell/facade.ts`、`VerseShellAciClient` 和统一 observation；command profile 必须在批准后提交不可变 argv 计划，禁止把常规命令再次包装进 `cmd /C`、PowerShell 或 Git Bash。长日志只通过 artifact 和 `result.query` 定向读取。

### P3（路线图 Phase 4）：写入协作

P3 不让 VerseShell 成为第二个 journal。`file.patch` 先预览并携带 base hash/precondition；只有 ClawX write journal 可提交、undo、做 stale-write guard 和恢复。编译器、脚本、Git hook 等外部写入只能记录 `external_write`，不能宣称事务覆盖或自动回滚。

### P5：真实 canary

P5 只能在路线图 Phase 0 到 Phase 4 的全部工程包完成并由独立审阅者确认后启动。每个 observation 需要 paired task id、无丢失的低敏诊断窗口、外部 provider receipt digest、实际 usage 字段、人工 recovery 时间和安全/rollback 结论。原始 command、prompt、transcript、输出、环境、approval token、credential 和 provider receipt 内容不得进入仓库。

硬性 NO-GO：未验证 binary、catalog/protocol/policy drift、`cap all`、模型提供 approval、workspace 越界、敏感输出泄漏、effectful replay、隐式 native fallback、没有真实 provider/rollback 证据、或将 heuristic token 当作成本结论。

## 6. 每包验证编排

每个工作包都先运行：

```text
pnpm harness context --spec <scoped-spec>
pnpm harness validate --spec <scoped-spec>
git diff --check
```

触及 Rust runtime 时额外运行：

```text
cargo test --manifest-path verseshell-runtime/Cargo.toml
cargo test --manifest-path verseshell-runtime/Cargo.toml --no-run
```

触及 typed ACI、OpenClaw、Electron bundle 或 Gateway 通信时额外运行：

```text
pnpm verseshell:test
pnpm run typecheck
pnpm run comms:replay
pnpm run comms:compare
```

触及用户可见 UI、诊断面板或新的 Host API 形状时，在同一包增加/更新 Electron Playwright E2E。Renderer 只能通过 `src/lib/host-api.ts` / `src/lib/api-client.ts` 访问后端；不增加 direct IPC、Gateway HTTP 或 Gateway WebSocket。

每个包关闭前的证据包至少包含：candidate SHA、base SHA、spec/rules、命令及退出码、精确测试范围、binary/manifest/catalog digest（如适用）、已知 residual、README 三语审查结果和独立复跑结论。证据必须在 clean candidate 上生成，不能从 dirty 主工作树借用历史绿色报告。

## 7. 风险与处理

| 风险 | 当前处理 | 解锁条件 |
|---|---|---|
| 历史 UAS-05/UAS-06 与 fresh audit 冲突 | 保留历史，不作放行证据；Task Forest 记录高风险再资格化 | P0 新鲜 binary、Rust、probe、source/build/protocol 证据一致 |
| MCP 宽权限或包不可启动 | P1-03 默认 deny、单源版本和安装/启动 smoke | 兼容层通过独立边界测试且不绕过 governed route |
| 进程或输出语义回归 | P1 先完成 lifecycle/observation，再允许 adapters | timeout/cancel/restart/truncation/artifact matrix 可审计 |
| 写入误称为可回滚 | P3 强制 ClawX journal 唯一 authority，external write 显式化 | precondition/undo/conflict/recovery 和 UI 确认通过 |
| 工程测试被误判为产品成功 | P5 与 engineering report 分离 | reviewed live canary 和 `STATUS.md` 的独立决策 |

## 8. 方案选择

候选 A 是直接延续旧 UAS-05/UAS-06 canary。它成本低，但无法处理新鲜 P0 panic、真实 probe 失败和供应链漂移，不足以达成目标。

候选 B 是本计划的“证据优先、严格串行、P0 先行”路线。它先恢复可验证性，再扩大到 facade、受控 process、写入协作和真实 canary。该路线被推荐。

候选 C 是并行扩展 file/repo/test/transaction/MCP 面。它会在执行内核未可信时扩大攻击面和验收面，因此拒绝。

## 9. Task Forest 应用边界

已应用 proposal：`TFP-verseshell-foundation-orchestration-20260814`（base graph hash：`53e18d5e56e573cd89f68f3ba291497e2e8c83704e1408ebd4f1483aabfa08f1`）。

该提案只会：新增独立 VerseShell foundation program 与上述 work-package 节点和依赖；增加与 `TF-0007` 的 `related_to`、对 `TF-0010` 的 `contributes_to`，以及 P5 对 `TF-0006` 的候选证据贡献关系；记录“历史 VerseShell 工程证据必须经 P0 重新资格化”的高风险偏差；保存本次方案选择的 alignment 审计。

该提案不会：修改 `TF-0006`、`TF-0009`、`TF-0016`、任何产品锁、feature flag、`STATUS.md`、runtime 配置或 release 状态。应用后仅启动 `VS-G0-01`；该工作包关闭前不启动 VS-P0-01。
