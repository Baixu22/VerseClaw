---
lifecycleStatus: active
id: versegit-product-integration-node-contracts
title: VG 受控并发编码产品接入节点合同
scenario: versegit-validation-layer-extension
taskType: planning
intent: 将现有 VG 工程组件按串行节点接入真实 ClawX 并发编码流程，并为事实、反馈、候选验证、写回和持久生命周期定义独立验收出口。
program: versegit-product-integration
residualPaths:
  - docs/architecture-overview.md
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-utils.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/auto-reply/templating.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - harness/specs/tasks/model-capability-effective-runtime-state.md
  - openclaw_runtime/src/agents/runtime-effective-capability.ts
  - tests/unit/runtime-effective-capability.test.ts
touchedAreas:
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
  - harness/specs/tasks/versegit-product-e1-candidate-freeze.md
  - harness/specs/tasks/versegit-product-e2-receipt-verification.md
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 接力 agent 可以从一个合同索引解析六阶段、十六个独立任务、前置依赖与盘上验收入口。
  - 旧 VG 工程验收保留其候选身份；新产品接线不能继承历史 PASS 或以计划创建冒充已完成。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:

requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-integration-node-contracts.md
  - git diff --check
executionSpecs:
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
  - harness/specs/tasks/versegit-product-e1-candidate-freeze.md
  - harness/specs/tasks/versegit-product-e2-receipt-verification.md
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
acceptance:
  - 本地当前 Task Forest 中存在 1 个后续目标、6 个阶段、16 个执行任务，父子与串行依赖合法，只有 A1 是本 lane 的初始 ready leaf。
  - 每个 execution spec 定义目的、代码入口、requiredTests、negative acceptance、产物和收口条件；创建后 validate/export 可回读。
  - 旧 TF-0465 与其他工作流节点状态和进度不变，新目标以 derived_from/contributes_to 关联旧目标而非重开历史验收。
  - 所有新验收可由脚本或 agent 执行，不要求真人数据/操作，产品锁和 M4 权威不扩张。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**VG 受控并发编码产品接入**

目标是让 VG 的仓库依据风险进入实际 agent 工作流，并让 ClawX 在组合候选验证完成后才写回。出口为声明范围内、明确 opt-in、Windows 实跑、证据可复验的受控编码闭环。

旧 TF-0465 交付的是工程组件与 bounded host-shaped slice，其保留的 landed-unwired/non-GA 身份不被本计划改写。新任务图是后续产品接入 lane，主父子树由 Task Forest 维护；本文件只有验收合同，不复制节点状态。非 VG 组件毕业线 TF-0482 明确排除 VG，本计划不挂入该线，不改变其任务状态。

**六阶段串行依赖**

所有 leaf 按下表从上到下执行，一次一个。阶段边界是验收里程碑，不能被局部绿灯或模型置信度替代。

| 任务 | 阶段 | 交付 | 前置 | 规格 |
| --- | --- | --- | --- | --- |
| A1 | 阶段一：重建当前证据与运行基线 | 重建当前 VG 验证基线并保留历史候选证据 | 现有报告与当前仓库 | [任务合同](./versegit-product-a1-evidence-baseline.md) |
| A2 | 阶段一：重建当前证据与运行基线 | 刷新运行时构建并通过真实 Electron 启动基线 | A1 | [任务合同](./versegit-product-a2-runtime-baseline.md) |
| B1 | 阶段二：接通宿主诊断与受限事实调用 | 实现有界异步 VG 事实适配器与模式校验 | A2 | [任务合同](./versegit-product-b1-fact-adapter.md) |
| B2 | 阶段二：接通宿主诊断与受限事实调用 | 注册 VG 宿主服务并打通真实诊断读取 | B1 | [任务合同](./versegit-product-b2-host-diagnostics.md) |
| C1 | 阶段三：绑定运行时会话并记录实际读写依据 | 接通 Gateway 与 Main 的 worktree/session 绑定生命周期 | B2 | [任务合同](./versegit-product-c1-runtime-bindings.md) |
| C2 | 阶段三：绑定运行时会话并记录实际读写依据 | 在实际工具边界记录读写范围与读取时的版本依据 | C1 | [任务合同](./versegit-product-c2-observation-basis.md) |
| D1 | 阶段四：让风险进入 agent 上下文并验证作用 | 把 VG 风险经现有工具结果送入 agent 下一次上下文 | C2 | [任务合同](./versegit-product-d1-feedback-delivery.md) |
| D2 | 阶段四：让风险进入 agent 上下文并验证作用 | 用配对自动化任务验证风险反馈与重读返工行为 | D1 | [任务合同](./versegit-product-d2-paired-agent-evaluation.md) |
| E1 | 阶段五：验证组合候选后再由宿主写回 | 用宿主 Git 组合并冻结待验证候选 | D2 | [任务合同](./versegit-product-e1-candidate-freeze.md) |
| E2 | 阶段五：验证组合候选后再由宿主写回 | 在冻结候选上运行 VerseShell 验证并重建权威收据 | E1 | [任务合同](./versegit-product-e2-receipt-verification.md) |
| E3 | 阶段五：验证组合候选后再由宿主写回 | 把验证前置到写回入口并拒绝目标或授权漂移 | E2 | [任务合同](./versegit-product-e3-host-apply.md) |
| F1 | 阶段六：完成持久生命周期、交付与最终验收 | 持久化宿主完成事实并校正 VG 会话终态语义 | E3 | [任务合同](./versegit-product-f1-completion-contract.md) |
| F2 | 阶段六：完成持久生命周期、交付与最终验收 | 把证据封存和解除 VG 引用接入所有清理路径 | F1 | [任务合同](./versegit-product-f2-cleanup-barrier.md) |
| F3 | 阶段六：完成持久生命周期、交付与最终验收 | 固定可复建的 VG sidecar 交付与消费身份 | F2 | [任务合同](./versegit-product-f3-sidecar-delivery.md) |
| F4 | 阶段六：完成持久生命周期、交付与最终验收 | 验证安装布局中的并发闭环与有界稳定性 | F3 | [任务合同](./versegit-product-f4-controlled-stability.md) |
| F5 | 阶段六：完成持久生命周期、交付与最终验收 | 逐项聚合 VG 产品接入验收并同步能力声明 | F4 | [任务合同](./versegit-product-f5-global-acceptance.md) |

**统一边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

M0 不调用 VG；M1 只执行被证实的纯诊断且不写 provider state；M2 的 init/session/observe 需固定 typed operations 与明确 provider-domain 授权；M3 的用户测试/构建/候选验证只由 VerseShell governed ACI 执行。固定 argv 不等于只读。不存在的 conflicts-plan 继续 explicit unavailable。

ClawX 保留 task/orchestration/approval/write journal/Git apply/harness verdict。VG 只提供 repository facts、basis/candidate 证据与 receipt interpretation，不能调用 land/admit 或自行授予 M4。每次 effect 前复用当前 owner decision/CapabilityGrant/最终权限 checkpoint，拒绝撤销或身份漂移。

候选组合复用宿主 Git；流程是 completion→freeze candidate→VerseShell verify→host receipt authority→host apply。ref expected-old OID 只保护 ref 更新，工作区未提交内容、目标文件和写回日志仍要重新检查。失败或 stale candidate 不写回主工作区。

工具观察必须保留读取当时的相对路径/range/basis identity；单独的 inputDigest 无法还原这些内容，provider 后读已改变的文件也不能伪造读依据。反馈通过既有 tool-result middleware/prompt seam送达并记录真实 transcript/model-request 时序；generated/delivered/transcript-confirmed/behavior-shift 不混用。

provider session end 的 abandoned 语义与 host success 分开。持久 completion fact 只记录宿主已发生结果，不转移 landing authority。全部清理路径共用 stop→drain→seal→detach→owner/epoch/reference check→delete barrier；任何失败保留资源与 recovery_required。
F2 的 `clawx.versegit.cleanup-barrier/v1` 以 owner、epoch、authorization、base OID 与 refs digest 绑定每次删除；record 同时保存 agent-owned resource identity、阶段时间、evidence digests、late events 与 before/after inventory。只有 status=`detached` 的 exact resource 才能删除，只有实际观测到 process/manager/worktree/temp 均为零且无 survivor 才能进入 `deleted`；否则保持 `recovery_required`，未观测值不得写成零。

**执行预算、代码与验收**

复用现有 adapter、receipt bridge、资源治理、tool-result middleware 和 Gateway request/result 范式；每个节点一个 seam。符合 host-owned bootstrap scope 的实现遵守其 2 application files / 800 changed lines 预算，其余以对应 task spec 的实际边界为准。若超出，不以扩大原节点范围规避门禁，通过合法提案拆分。

所有 runtime/Main/renderer 通信实现 spec 引用 gateway-backend-communication，required fast/comms 是验收配置而不是自动启用 VG 的运行模式；本次规划节点创建不会执行 broad build/unit/E2E。新增 unit/E2E 源文件在实现节点交付，要求正式 harness validate 与 dry-run 无 --no-diff。

新增规格的验证采用完整 changed-path 检查。共享 dirty tree 中的其他工作流文件只可列 exact residualPaths 并记录来源，不将它们列为 ownedPaths。最终实现验收使用该节点的干净 scoped candidate与真实 artifact，planned spec 的结构校验不能冒充功能通过。

**盘上验收与自动收口**

每个节点的 report/manifest 绑定当前 candidate source/tree、binary/schema/capability/contract、输入和 receipt/output artifact，记录命令、exit、counts、cleanup 与未测。curated evidence 加入精确 retained inventory；旧 hash/verdict 不重签，Task Forest/handoff 为本地进度。

节点接受条件必须逐条读盘验证，source/candidate 及 base_graph_hash 一致后才能自动 proposal-apply --yes，再 validate/export。独立审查可由 agent执行，产物标实际 actor；不要求所有者人工运行或提供真人证据。发布/公开、产品锁/default、M4/重大范围决定保留独立决策权限，本 lane 不执行。

**计划依据与首节点**

2026-10-22 agent-driven 分析发现：现有 runtime 先合并 worktree 再启动 verifier；真实两个 Git worker 各自验证通过而组合验证失败；产品 versegit.status 返回 UNSUPPORTED。VG 新隔离 WP7 仍可执行，故接入沿用已有组件。原始审计运行不替代当前候选验证，首节点 A1 必须重新采集 current HEAD 和证据。

当前任务图的权威位置是 repo-local graph/nodes.json 与 graph/edges.json，通过 task_forest.py CLI 读取；根目录不存在 forest.json/status.md 不能证明任务图缺失。本计划通过正式 proposal 挂接，旧状态不由文档推断。
