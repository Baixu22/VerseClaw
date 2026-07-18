# System Maturity AI Execution Prompts

本文档把 `plans/system-maturity` 中的阶段、依赖、状态、验收、证据和交付规则整理为可直接交给 AI Coding Agent 的提示词。默认使用第一节的总提示词即可；除非需要限定任务或只做审计，不必再逐项补问。

## 当前基线摘要

以下是 2026-07-17 的入口快照；执行时仍须以重新读取的 Git、worktree 和 STATUS 实际状态为准。

- 计划共 8 个阶段、34 个任务。
- 当前所有 phase 均为 `planned`，所有 task 均为 `todo`。
- 当前唯一合法的首任务是 `P0-001`。
- 当前 `main` HEAD 为 `b1ff416dd162554f74e325fe77be5b5fba29387b`，并已有干净的 `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0` worktree / `codex/maturity-p0` branch 指向同一 commit；开始 P0 时应先检查并复用或明确处置，不要重复创建冲突 worktree。
- Phase 0 必须串行完成；`phase0-foundation/STATUS.json.phaseStatus=done` 前不得开始 Phase 1 产品开发。
- 产品改动必须在独立 worktree 中进行；规划文件所在工作树只保存规划与治理变更。
- `EXECUTION-ORDER.md` 记录的产品开发基线是 `60061e33554311ac3c9871195210df59fe1b5bf2`；`BRANCH-RECONCILIATION.md` 又记录了以 `836a8e2dd4a7fa5f4e10a0948316f1a8a1d251b8` 为比较基线的分支处置。`P0-001` 必须把当前 HEAD、这两个历史记录和 dirty patch 对齐成一个可复核的 canonical baseline，后续任务不得自行猜测或静默替换基线。
- `README.md` 的 Status values 未列出 `planned`，但全部 phase `STATUS.json` 与 `INDEX.md` 正在使用 `planned`。`P0-002` 必须明确 phase/task 的合法状态枚举并让 validator、文档和现有状态一致；此前不得擅自批量改写状态。
- `BRANCH-RECONCILIATION.md` 中列出的旧分支均不得直接合并或随意 cherry-pick；仍需的能力必须从当前认可基线重新立项、实现、测试和留证。

## 一、持续执行总提示词（默认使用）

复制以下整段即可启动或继续整个成熟度计划：

```text
你现在负责推进 ClawX System Maturity Program。不要只给建议、计划或代码片段；在授权范围内直接检查、实施、测试、留证、更新状态，并在当前任务完成后自动选择下一个依赖已满足的合法任务继续推进。除非出现需要用户新增权限、外部凭据、不可逆外部操作、产品方向二选一，或无法从仓库证据判断的实质冲突，否则不要停下来逐项提问。

仓库：C:\Users\27933\Desktop\clawx\ClawX
计划目录：C:\Users\27933\Desktop\clawx\ClawX\plans\system-maturity

一、开始前必须完整读取并遵守
1. 仓库根目录及所触及路径范围内的 AGENTS.md。
2. plans/system-maturity/README.md、INDEX.md、EXECUTION-ORDER.md、DELIVERY-FORMAT.md、BRANCH-RECONCILIATION.md。
3. 当前 phase 的 PLAN.md、STATUS.json 和目标 task 文件。
4. 触及路径对应的 harness/specs/rules、scenarios、tasks、guides、layers。若任务涉及 Renderer/Main/host-api/api-client/Gateway/OpenClaw runtime 通信，必须从引用 gateway-backend-communication 的 task spec 开始，先运行 pnpm harness context --spec <task-spec>，并按 spec 验证。

二、任务选择规则
1. 先读取全部 STATUS.json 和 task Depends on，不凭印象选择任务。
2. 若存在 in_progress 任务，优先恢复它；否则选择依赖全部完成、且符合 EXECUTION-ORDER.md wave/串并行限制的第一个 todo 任务。
3. 当前初始状态必须从 P0-001 开始。Phase 0 未全部 done 前禁止开始 Phase 1 产品工作。
4. 创建 branch/worktree 前先检查现有同任务 branch、worktree、未提交改动和证据，优先安全恢复，禁止创建重复或冲突的执行现场。
5. 一个 worktree 只允许一个活跃任务链。不得让不同 worktree 同时编辑 shared/host-api/contract.ts、src/lib/host-api.ts、electron/main/ipc/*、permission stores、共享 schema 或 release manifests。
6. 未经用户明确授权，不要启动并行子 Agent；即使允许并行，也必须满足 EXECUTION-ORDER.md 的 worktree 和文件所有权条件。

三、Git 与工作树安全
1. 执行 git status、git branch --show-current、git rev-parse HEAD、git worktree list，记录实际基线和 dirty 状态。
2. 用户现有 dirty changes 一律保留；禁止 reset、clean、checkout 覆盖、批量搬运或擅自 stash。
3. 规划工作树只修改计划、状态、证据和治理文件。产品代码从 EXECUTION-ORDER.md 指定并经 P0-001 固化的 commit 建独立 worktree。
4. EXECUTION-ORDER.md 与 BRANCH-RECONCILIATION.md 出现的基线差异必须在 P0-001 中显式核对并固化；未完成前不得自行选一个继续产品开发。
5. BRANCH-RECONCILIATION.md 中的旧分支不得直接 merge/cherry-pick。不得删除 remote refs；任何本地 ref 删除也只能按已批准的分支处置执行。

四、每个任务的执行闭环
1. 将 task status 从 todo 改为 in_progress；phaseStatus 只能反映真实阶段状态。
2. 建立 task 的 Finding、Goal、Scope、Tests、Acceptance 映射，逐项编号，不扩大到无关重构。
3. 先检查现有实现和测试，再做最小、完整、可验证的修改。不要覆盖用户无关改动。
4. 新功能、用户可见场景或可复用约束必须同步新增/更新相应 harness scenario/rule/task spec，避免只留在说明文字中。
5. Renderer 后端调用只能经过 src/lib/host-api.ts 和 src/lib/api-client.ts；不得新增组件内直接 ipcRenderer.invoke，也不得从 Renderer 直连 Gateway HTTP。通信策略保持 Main-owned 的 WS -> HTTP -> IPC fallback。
6. 所有新增用户可见文本必须通过 react-i18next，并覆盖 en/zh/ja/ru；样式使用 src/styles/globals.css 约定的设计 token。任何用户可见 UI 改动必须在同一变更中新增或更新 Electron Playwright E2E。
7. 通信路径变更必须运行 pnpm run comms:replay 和 pnpm run comms:compare。功能或架构变更必须检查 README.md、README.zh-CN.md、README.ja-JP.md 是否需要同步。
8. 先运行 task 文件列出的 targeted tests，再运行适用的 contract、typecheck、lint、unit、E2E、red-team、fault-injection 或 release gate。快速、cached、reuse、smoke 结果不得冒充 PR/发布全门禁。
9. 保存命令、退出码、精简结果、证据路径/artifact/hash，并逐项对应 Acceptance。没有实际执行的测试不得写成通过。
10. 任一 Acceptance 失败时，task 只能保持 in_progress；只有确切外部阻断才可标 blocked。blocked 必须写明无法继续的精确条件，不能代替未完成。
11. 仅当所有 Acceptance 均通过且证据可复核时，才把 task 标为 done。只有 phase 内所有 task 都 done，才允许 phaseStatus=done 且 allTasksDone=true。
12. 每个 wave 合并后执行 EXECUTION-ORDER.md 的 integration gate；门禁通过后才能更新最终状态并进入下一 wave。

五、状态与交付一致性
1. STATUS.json 只保存 phaseStatus、task status、allTasksDone，不写解释。
2. 最终交付严格使用 DELIVERY-FORMAT.md 的字段：TASK_ID、STATUS、OWNER、CHANGED、TESTS、RESULTS、EVIDENCE、ACCEPTANCE、BLOCKERS、NEXT。
3. STATUS=done 时 TESTS、RESULTS、EVIDENCE、ACCEPTANCE 均不得为空。
4. 在 Phase 0 建立 canonical evidence manifest、hash 与 delivery 路径之前，不要为后续 phase 私自创造第二套证据系统；应先完成 P0-001 至 P0-004 的单一控制面。
5. 最终回复先给结果和当前状态，再给严格交付字段；不要用长篇解释替代证据。

六、持续推进与停止条件
1. 完成当前任务后，重新读取 STATUS 和依赖图，自动选择 NEXT 并继续，不要求用户再次说“继续”。
2. 遇到测试失败时先诊断并修复，遇到环境问题先尝试安全替代路径；不要把一次失败直接报告为 blocker。
3. 只有以下情况停止并请求用户：需要新权限/凭据；需要执行未授权的远端发布、合并、删除等外部变更；存在会显著改变产品行为的不可判定选择；或同一外部阻断已被充分验证且无法绕过。
4. 如果本轮无法完成整个计划，必须把当前 task 保持为真实状态，留下可复现证据、精确 NEXT 和续跑入口，禁止虚报 done。

现在从仓库实际状态开始执行。初始计划若未发生变化，从 P0-001 开始；不要跳过前置检查，也不要只复述计划。
```

## 二、指定任务执行提示词

需要限制 AI 只处理一个任务时使用，把 `<TASK_ID>` 替换为具体编号：

```text
在 C:\Users\27933\Desktop\clawx\ClawX 中完整执行 System Maturity 任务 <TASK_ID>。

先读取根 AGENTS.md、plans/system-maturity 下的 README.md、INDEX.md、EXECUTION-ORDER.md、DELIVERY-FORMAT.md、BRANCH-RECONCILIATION.md，以及该任务所属 phase 的 PLAN.md、STATUS.json 和 tasks/<TASK_ID>.md。检查真实 Git/worktree/dirty 状态和所有 Depends on；依赖未满足时不得绕过，改为完成可在当前任务范围内处理的前置验证并给出精确 blocker。

若依赖满足：把状态改为 in_progress，检查代码与已有测试，完成 Scope 内的最小完整实现，按 AGENTS.md 与相关 harness spec 补齐规则/场景/测试/文档，运行 task Tests 和适用的全门禁，保存退出码、证据路径和 hash，逐项验证 Acceptance。只有全部验收有证据时才标 done，并保持 STATUS.json、phase 状态和 allTasksDone 一致。

禁止破坏用户 dirty changes，禁止 reset/clean/覆盖，禁止直接合并或 cherry-pick BRANCH-RECONCILIATION.md 中的旧分支。未经明确授权不执行远端发布、合并、删分支或并行子 Agent。

最终严格按 DELIVERY-FORMAT.md 输出，不要只给方案，不要虚报未运行的测试。
```

## 三、中断后续跑提示词

当上一次执行中断、窗口关闭或上下文丢失时使用：

```text
恢复 C:\Users\27933\Desktop\clawx\ClawX 的 System Maturity 执行现场。

不要假设上次回复准确。重新读取 AGENTS.md、plans/system-maturity 的总控文档、全部 STATUS.json，并检查 git status、当前 HEAD、branch、worktree、最近变更和现有 evidence。优先恢复唯一的 in_progress 任务；若没有，则按真实依赖和 EXECUTION-ORDER.md 选择下一个合法 todo。对照 task Acceptance 验证哪些工作已经有可复核证据，缺证据的项目视为未完成，不重复破坏性操作，也不覆盖用户 dirty changes。

继续实施、测试、留证和更新状态。当前任务 done 后自动继续 NEXT；只有需要新权限、外部凭据、不可逆外部操作或无法判定的产品选择时才停下来询问。最终按 DELIVERY-FORMAT.md 输出真实状态。
```

## 四、只审计不修改提示词

需要检查成熟度计划和实现是否一致，但不希望修改文件时使用：

```text
对 C:\Users\27933\Desktop\clawx\ClawX 执行只读的 System Maturity 审计，不修改文件、不更新 STATUS、不创建提交。

完整读取根 AGENTS.md、plans/system-maturity 的全部文档和 STATUS，并抽查每个 done/in_progress task 对应的代码、测试、evidence、hash 与 Acceptance。检查依赖顺序、phaseStatus/allTasksDone 一致性、Finding 双向追踪、证据新鲜度、快速门禁冒充全门禁、dirty baseline、worktree 冲突、旧分支误用、Renderer/Main 边界、i18n/UI E2E、通信 harness、发布签名/SBOM/provenance 等硬规则。

输出按严重程度排序的明确发现，每项包含：Finding/Task、证据文件与行号、违反的规则、实际风险、建议修复、应运行的验证命令。若无问题，明确列出已检查范围和仍未覆盖的风险；不要把未检查项描述为通过。
```

## 五、Wave 集成复核提示词

某个 wave 的任务完成并准备合并或进入下一 wave 时使用：

```text
对 ClawX System Maturity 的 Wave <WAVE_NUMBER> 做集成复核。先读取 AGENTS.md、EXECUTION-ORDER.md、该 wave 涉及的 phase PLAN/STATUS/task、所有 delivery/evidence 和实际 Git diff。

严格执行集成门禁：git diff --check；contract:check；变更 Finding 对应 targeted unit tests；受影响项目 typecheck；相关 E2E/red-team/fault-injection；manifest evidence 与 task delivery 一致性。若涉及通信，再运行 comms:replay/comms:compare；若涉及 UI，验证 en/zh/ja/ru 与 Electron E2E；若属于 PR/发布审查，不接受 cached/smoke/reuse 替代 required full gates。

只有全部 task Acceptance 和集成门禁均有证据时，才允许更新 task/phase STATUS 并给出下一 wave。否则保持真实状态，列出失败项、复现命令、证据路径和修复顺序。不要执行未授权的 merge、push 或 release。
```

## 六、发布资格审查提示词

Phase 6/7 或正式发布前使用：

```text
审查 C:\Users\27933\Desktop\clawx\ClawX 是否具备 System Maturity 发布资格，并在授权范围内修复本地可修复问题；不要实际发布。

必须验证 phase0、phase1、phase2、phase6、phase7 的真实状态和证据，确认 clean tree/tag、canonical baseline、requiredFullGates、Windows stable/prerelease 签名策略、latest.yml SHA512、AutoUpdater feed/channel/source、外部二进制 checksum/signature、GitHub Action commit pin、SBOM、provenance、ASAR integrity、Electron fuses、release manifest 可重建。运行任务与 EXECUTION-ORDER.md 要求的 full gates；cached/smoke/reuse 只能作为日常证据，不能替代发布门禁。

输出明确结论：READY 或 NOT READY。READY 必须附全部门禁、退出码、artifact/hash 和 task Acceptance；NOT READY 必须列出硬阻断、责任 task、修复顺序和精确 NEXT。未经用户明确授权不得 tag、push、创建 release、上传产物或删除分支。
```

## 七、立即开始 P0-001 的精简提示词

当前计划尚未启动时，下面这段是最短的可靠入口：

```text
请在 C:\Users\27933\Desktop\clawx\ClawX 直接执行 plans/system-maturity/phase0-foundation/tasks/P0-001.md，不要只做规划。

完整读取 AGENTS.md 和 plans/system-maturity 全部总控文档，保留所有用户 dirty changes，先检查并安全复用或明确处置现有 C:\Users\27933\Desktop\clawx\ClawX-maturity-p0 / codex/maturity-p0 执行现场，再核对当前 HEAD、EXECUTION-ORDER.md 的 60061e33554311ac3c9871195210df59fe1b5bf2、BRANCH-RECONCILIATION.md 的 836a8e2dd4a7fa5f4e10a0948316f1a8a1d251b8 及现有分支处置，建立唯一 canonical audit baseline、Finding registry、evidence hash/manifest 校验，并运行 P0-001 列出的测试和适用 harness 验证。

只有 A1-A3 均有可复核证据时才把 P0-001 标为 done；否则保持 in_progress 或在确有外部阻断时标 blocked。最终严格按 DELIVERY-FORMAT.md 输出，并给出 NEXT=P0-002。不要开始 Phase 1 产品开发，不要 merge/cherry-pick 旧分支，不要执行 reset/clean/覆盖或未授权远端操作。
```

## 使用建议

- 日常持续推进：使用“持续执行总提示词”。
- 只让一个 Agent 处理一个边界清晰的任务：使用“指定任务执行提示词”。
- 上下文丢失或换 Agent：使用“中断后续跑提示词”。
- PR/合并前：使用“Wave 集成复核提示词”。
- 发布前：使用“发布资格审查提示词”。
- 当前第一次启动：直接使用“立即开始 P0-001 的精简提示词”。
