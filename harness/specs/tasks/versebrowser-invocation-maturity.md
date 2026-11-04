---
id: versebrowser-invocation-maturity
title: VerseBrowser 调用成熟度整改与分层验收
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Make the existing embedded browser callable through truthful per-session capabilities, an observable model loop and fresh end-to-end evidence without changing frozen defaults or duplicating owners.
expectedUserBehavior:
  - Models only see capabilities actually supported by their owned session and policy.
  - Browser operations form an observation, action, verification and cleanup loop without implicit backend retries.
  - Unsupported, denied, unknown, stale and successful outcomes stay distinct across every boundary.
touchedAreas:
  - harness/specs/tasks/versebrowser-invocation-maturity.md
  - harness/specs/fixtures/versebrowser-invocation-maturity/**
  - harness/specs/rules/versebrowser-upstream-preservation.md
  - packages/versebrowser/**
  - packages/README.md
  - docs/clawx-product-semantics.md
  - electron/services/agent-browser*.ts
  - electron/gateway/agent-browser-bridge.ts
  - electron/main/ipc-handlers.ts
  - electron/main/index.ts
  - .gitignore
  - scripts/repository-artifacts.json
  - electron/utils/sandbox-high-risk-gate.ts
  - shared/agent-browser/**
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - openclaw_runtime/src/agents/tools/agent-browser-*.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/gateway/server-methods/agent-browser.ts
  - scripts/versebrowser-*.mjs
  - scripts/versebrowser-evidence-verify.mjs
  - scripts/windows-test-node.mjs
  - scripts/copy-runtime-package.mjs
  - scripts/bundle-main-runtime.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tests/unit/versebrowser-*.test.ts
  - tests/unit/agent-browser-*.test.ts
  - tests/unit/gateway-p4-001-auth-binding.test.ts
  - tests/unit/copy-runtime-package.test.ts
  - tests/e2e/versebrowser-*.spec.ts
  - tests/e2e/agent-browser-workbench.spec.ts
  - tests/e2e/browser-security-recovery.spec.ts
  - tests/e2e/fixtures/electron.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredRules:
  - versebrowser-upstream-preservation
  - backend-communication-boundary
  - renderer-main-boundary
  - contract-first-boundary
  - capability-owner-resolution
  - error-governance-boundary
  - supply-chain-integrity-pinning
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node --test scripts/versebrowser-build-wiring.test.mjs
  - pnpm exec vitest run tests/unit/versebrowser-host-adapter.test.ts tests/unit/versebrowser-driver-capabilities.test.ts tests/unit/versebrowser-task-session-conservation.test.ts tests/unit/agent-browser-gateway-bridge.test.ts tests/unit/agent-browser-tool.test.ts
  - pnpm --dir packages/versebrowser exec vitest run tests/agent-browser-service.test.ts
  - node scripts/versebrowser-evidence-verify.mjs
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/versebrowser-host-invocation.spec.ts tests/e2e/agent-browser-workbench.spec.ts tests/e2e/browser-security-recovery.spec.ts
acceptance:
  - Required browser scenarios are callable through the actual model and Main path, and unsupported driver operations are neither advertised nor executed.
  - Observation, action, verification, ownership, permission revocation and cancellation retain their defined semantics without implicit backend switching.
  - All 13 source-only methods have explicit driver-specific dispositions and current behavioral evidence for every supported claim; required capabilities cannot be retired merely to pass this gate.
  - Clean-consumer and real packaged Windows evidence matches the frozen source, dependencies, build and runtime identities without reliance on a development checkout.
  - Agent-driven live-model, protocol, lifecycle and repeated-run evidence is complete and independently checked; historical evidence does not close current gaps.
docs:
  required: true
  paths:
    - harness/specs/tasks/versebrowser-invocation-maturity.md
    - packages/README.md
    - docs/clawx-product-semantics.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# 定位与结论（2026-10-16）

本文件是**解决方案和待执行验收规格，不是完成声明**。仅新增规划，不在本轮改动生产逻辑、默认驱动、权限策略、工具链安装或发布状态。

原 `versebrowser-upstream-reintegration` / TF-0329 回答“源码、任务与宿主接线如何保留”；本主线回答“当前用户和模型是否可靠地调用”。历史 M00-M12 保留原状态和原证据，不重新签发历史收据，也不把原 TF-0343/0344 后置范围变为本轮强制开发。

事实基线：`harness/specs/fixtures/versebrowser-reintegration/hygiene-20261016/summary.json`。本轮复核该审计绑定的 **28 个源文件哈希未变**；55 项单测、2 项脚本测试和独立驱动流程是该次审计已落盘的证据，本轮不冒充重新运行。

| 维度 | 当前证据 | 成熟度判断 |
| --- | --- | --- |
| 源码、固定依赖和基础构建 | 导入/补丁检查、构建、类型与通信门禁通过；工作区仍有混合脏改动 | 基础具备，不是干净交付验收 |
| 独立 upstream 驱动 | 本地网页打开、填写、点击、复观测、业务断言及关闭通过；采集完整 | 单一实际流程可用，不是全功能/MCP/桌面通过 |
| Electron 与模型能力声明 | Host 80 个契约入口；底层 Electron API 67 个方法；模型列出 24 动作，其中 13 对应未实现能力 | 不成熟：暴露面大于支持面；方法存在也不证明当前会话可执行 |
| 模型观察与复核 | 无 takeSnapshot 模型动作；command snapshot 依赖本机缺失的可选 CLI | 基本调用闭环未完成 |
| 工具链与桌面入口 | 系统 Node 24.15/libuv 1.51 被 guard 拒绝；24.16/1.52.1 可跑独立流程；Electron 曾 0x80000003，诊断模式 firstWindow 超时 | 环境约束确定；桌面根因未定位，不可断言是 VerseBrowser 缺陷 |
| 真实模型与最终安装包 | 本候选未重跑完整实测；dry-run 白名单不是已安装应用 | 验收缺口，不是已证实逻辑错误 |
| 整仓规格门禁 | 55 个既有无关路径超出任务归属 | 候选隔离问题；不能扩大 touchedAreas 或 --no-diff 伪造通过 |

另外有待测试的设计风险：当前 facade 包装按调用创建，且存在可变工作区上下文；不能直接假定它已具备跨调用的 snapshot/ref/baseline 状态、或多工作区并发隔离。`typeof method === function` 也不能识别拒绝 stub、CLI/BrowserWindow 差异和权限状态。这些是必须验证的风险，不是在没有复现时声称已发现安全漏洞。

# 推荐方案：保留宿主所有权，统一能力与调用闭环

## 不变的边界

```text
桌面：renderer host-api -> Main 适配层 -> 已有宿主 service -> 会话绑定 driver
模型：agent_browser -> Gateway -> 同一个 Main 适配层 -> 同一个会话
独立：MCP/CLI -> 同包 facade -> 自己的已授权 driver/session（单独验收）
```

1. 保留现有权限、workspace、Vault/profile、审计、任务状态和 resource-envelope owner。不得新建第二个浏览器任务管理器、权限中心或证据判定系统。
2. 不把 ClawX 全量切到 standalone upstream，不给模型额外挂一套无关联 MCP session；不因调用失败偷偷换 driver。backend 在新会话创建时确定，现有 session/ref/cursor 不跨后端迁移。
3. 冻结默认值、GPU/沙箱策略和原产品范围保持不变。只有确认必须改变这些约束时才提交明确决策，不把它们夹带进常规修复。
4. 原可选 agent-browser CLI 仍是兼容能力，不是 Electron 基础观察链的唯一实现。缺少它时禁用依赖动作并给出原因，不能强装另一个 browser 或绕过沙箱。

## 能力真相：声明、发现、执行使用同一份事实

复用模块已有 `DriverProfile` / `driverSupports`、`TOOL_AVAILABILITY` 和 capability policy，不新增第二套手写能力注册表。由 Main 从**实际会话 driver 和底层实现**生成有界能力快照，沿现有 open/status 契约向 Gateway/模型和桌面传递；不能从包了 13 个 facade 函数的 Proxy 推断支持。

概念交集：**已接线的工具 ∩ 当前 driver 能力 ∩ 实际运行环境 ∩ policy/grant ∩ 会话归属**。先做只读能力发现，不能为了发现能力执行点击、上传、命令或下载。

- 字段只保留调用所需的 backend/版本、支持动作、不可用原因、能力版本/会话绑定；没有另建平台的理由。
- 工具目录和 schema 顺序确定；在 run/新 session 或明确能力版本边界刷新，避免每次调用乱序改 schema 破坏缓存。执行端仍每次重验，以处理撤权、过期、driver 丢失与旧模型快照。
- tools/list 或模型 schema 不广告不可执行动作；直接伪造调用同样必须 fail-closed，隐藏按钮不能代替授权。
- `E_NOT_IMPLEMENTED`、缺 runtime、无权限、会话不存在、stale ref、timeout/效果未知必须区分。沿已有错误体系传递，不压成“成功”或无上下文字符串。

## 基础调用闭环

顺序是：能力/所有权发现 -> open -> observe -> action -> re-observe -> verify -> close。会话关闭和异常退出纳入 finally，不以“页面没报错”代替验证。

- 模型优先接通宿主已有 `takeSnapshot`、`extractPageText` 和必要的 console/network 观察；键盘场景复用已有 `pressKey`，不能只靠 type 冒充 Enter 提交。
- 通过受控入口使用现有 `Facade.verifyFlow` 的业务断言和 collection verdict。它目前不是已接通的 Host API/模型动作；接线时新增最小类型契约，不伪称它已在 80 方法内，也不重写另一份验证器。
- facade 的 ref、重观察要求、网络/控制台基线必须跟随同一 owner/session 生命周期。复用已有状态持有者，避免每次调用重建，也避免所有工作区共享一个无隔离全局 facade。
- snapshot 只能在该会话授权允许时工作。自动审批由现有受控审批入口产生 agent 标记的记录；模型提交 `userApproval: true` 不能成为自授权后门。
- 动作成功只意味着动作应答。只有 business expectation 成立、采集完整、owner/correlation 对齐才可报告业务 PASS；采集未知则 UNKNOWN，禁止升级为成功。

## 新增 13 项逐项处置

| 分组 | 方法 | 推荐做法 |
| --- | --- | --- |
| 常见交互（6） | pointer / drag / selectOption / selectValues / appendText / setChecked | 优先核对现有 upstream 实现和 Electron 原语的语义。仅在当前 driver 接通真实实现、政策和负例后开放；禁用期间不可广告为可用 |
| 精确定位与表单读取（2） | findElement / readForms | 复用已有 snapshot/driver 能力；保证唯一性、页/帧归属、字段预算，不能从截图或猜测 ref 冒充命中 |
| 对话框（2） | readDialogs / respondDialog | dialogId/page/session 绑定；过期、跨会话、重复答复拒绝；accept 不从缺省值推断 |
| 文件传输（2） | uploadFiles / downloadFile | workspace 路径约束、来源授权、敏感路径拒绝、下载原子性和不确定副作用；不能用通用 exec/curl 绕过浏览器和文件权限 |
| 语义读取（1） | semanticRead | 维持可选能力；须有已配置且授权的 provider/schema/超时/费用边界。未具备条件时不暴露；不新增“必须真人数据”前提 |

最终矩阵每行须包含：宿主/模块 owner、driver、模型可见性、实际消费者、授权条件、正例、负例、明确结果和证据。**13/13 有处置不等于 13/13 已实现。** 若某项属于既有产品承诺或迁移强制场景，标 unavailable 只是临时止损，任务仍未完成；不能修改矩阵来缩减既有完成定义。尚未获要求的后置能力仍保持后置，避免为凑数字过度开发。

# 执行顺序与节点验收

以下次数是**拟执行的验收工作量，不是已测成绩**。一次只推进一个 ready 节点；先定位根因再改最小写集。

| 节点 | 交付 | 前置 | 最小验收 |
| --- | --- | --- | --- |
| N1 隔离候选与冻结基线 | 当前源/锁/工具链/历史证据索引、原工作区保护清单、可重复环境矩阵 | 无 | 从原脏树保留字节建立隔离候选；明确依赖复用是否发生；基础门禁不读取原过程目录；候选改动归属可核对 |
| N2 打通受支持的执行环境与桌面启动 | 开发、独立工具、Electron、发行 Node/libuv 兼容矩阵；启动根因报告及最小修复 | N1 | 缺失/不兼容 runtime 启动前明确拒绝；支持环境可创建主窗口且实际 host invoke 成功；默认与诊断模式区分，不永久加 --no-sandbox；无 D:/versebrowser/.local 交付依赖 |
| N3 统一能力发现与调用门禁 | session-bound capability snapshot，模型/schema 与 Main 直接调用双重校验 | N2 | 24 动作与 13 缺失项逐项比较；CLI 有/无、两类 session、撤权/旧快照/伪造调用矩阵；不可用不广告、直接调用不执行副作用 |
| N4 跑通模型基础浏览器闭环 | snapshot/text/action/keyboard/verify 的 typed 接线和长寿命状态归属 | N3 | 模型可达宿主不借可选 CLI 完成打开、观察、填写、点击、复观测、业务校验、关闭；stale ref/导航/跨页/collection unknown 不伪 PASS |
| N5 完成 13 项能力准入与缺口处置 | 13 行真实矩阵及必要的最小实现/上游 patch 记录 | N4 | 启用项各有真实宿主正负例；未启用项各有不可见/显式拒绝证据；强制承诺未实现不能闭合；semantic 可选开关与 schema/授权可验证 |
| N6 审核授权、生命周期与副作用安全 | 同 owner 的 grant/撤权/过期、取消、终态、重启恢复、Vault/profile 与资源守恒矩阵 | N5 | 跨 session/workspace/ref/dialog/path 拒绝；撤权后无重放；晚到完成不改终态；已取消/未知效果不自动重试；仅关闭本次拥有资源且保留恢复证据 |
| N7 验证真实模型链和独立 MCP 协议 | 实际模型 -> Gateway -> Main -> driver -> tool result 证据；另行 MCP initialize/list/call/cancel 测试 | N6 | 真实模型发出实际 tool call，requestId/toolCallId/session/owner/event 串联；unsupported/denied/unknown 回传正确；MCP list/call 一致且不拿 SDK 成功代替协议成功 |
| N8 验证干净消费与实际安装包 | 从本候选构建的 Electron 包、依赖/补丁白名单和安装态回放 | N7 | 包内 runtime/模块哈希匹配；无开发 checkout/缓存/临时凭据依赖；真正安装态执行基础闭环、拒绝与回收；pack dry-run 不能替代此步 |
| N9 重复运行并按证据收口 | 稳定性、泄漏、性能记录、使用说明和限定范围的最终报告 | N8 | 10 次冷启动、30 次基础闭环、3 次受控中断/恢复；每轮 owner 与 collection 可追溯；测试进程/会话残留为 0；时间/内存按既有预算比较；所有强制验收通过后按规则关闭，发布另由所有者决定 |

N1 必须先检查当前 E2E 启动故障能否在相同工具链的未改候选复现。对照复现用于归因，不能把旧候选成功或独立驱动成功算成当前桌面成功。N2 的修复若触及此处未列出的文件，先按确定根因更新最小 touchedAreas，而不是把整仓列入。

N7 优先使用已有合规本地模型/端点，不复制整份用户配置与凭据入仓库。资源缺失时最多索取一次端点/凭据配置；不能以“等真人点 UI/提供 verdict”阻塞。agent 自动模拟审批必须如实标记；确定性脚本 stub 只能算协议测试，不能冒充真实模型实测。付费、新凭据暴露和发布仍按所有者权限处理。

# 两个明确出口

- **受控基础可用（中间里程碑）**：在支持的环境中，能力不虚报、基础闭环跑通、授权/副作用负例和真实模型证据成立。准确公布 driver/平台/未启用能力；不关闭未完成的高级承诺或称全量成熟。
- **声明范围内成熟（最终出口）**：所有既有强制场景和启用能力均有当前源与安装包绑定的业务证据，安全/生命周期/重复运行过门禁；无未解释的 UNKNOWN、无本机偶然依赖，文档与 schema 一致。Windows 通过不外推其它平台，更不等于自动 GA/公开发布。

# 证据、卫生与规划边界

沿用已有脚本/测试和原 oracle；每个实现节点必须增加其缺口所需的断言。`requiredTests` 是现有最小入口，并不自动覆盖未来新增的全部负例或真实模型/安装包/重复运行。执行节点应把新增命令纳入同一规格，不能用现有绿灯代替新场景。

每份结果保留 `driven_by: agent`、actor、代码/锁/构建/runtime/fixture hash、命令/退出码/计数、业务与采集结论、资源清理、限制。临时 home、auth、日志、trace 留 D: 或已忽略路径；精选最终证据进入任务 fixture 白名单，先过凭据扫描。原收据不改哈希来“续期”。

Task Forest 只保存本地进度与依赖；本规格拥有稳定设计和验收条件。保持旧已完成节点的历史事实，用新主线和 deviation 记录当前缺口。本轮没有完成任何实现/验收节点，不提交或发布代码。重大架构、冻结默认值、产品范围变化和不可逆操作才需要升级；常规开发、自动证据、节点状态和收口由 agent 负责。

## N1 可重复启动基线入口

`node scripts/versebrowser-baseline-probe.mjs --root <isolated-checkout> --electron <frozen-electron.exe> --output <D:/run-output>` 使用隔离 home/userData、空凭据环境和既有 Electron 进程回收器，仅测试启动及只读 `agentBrowser.status`。同一冻结控制器对照两个检出；先正常模式，再用 `--diagnostic-no-sandbox` 做单独诊断，不改变产品默认值。失败启动返回非零，收据区分失败阶段、代码/工具链身份和清理，不把“写出报告”当作启动通过。

N1 允许并必须披露依赖复用：根 workspace 按冻结 pnpm lock 安装，运行时第三方依赖可只读复用，但 runtime workspace 的源码链接必须重绑到对应隔离检出，不能指回原混合工作区。执行用 Node/Electron 可作为固定二进制输入复制；这不等于干净下载或发行安装态验收。

N1 启动探针必须等待实际 file 页面、DOMContentLoaded 和隔离配置对应的 setup-page 可见，再调用只读 status；仅出现 preload bridge 不算 renderer ready。早期仅检查 bridge 的探针结果只能作诊断，不能作为最终启动验收。

## 2026-10-22 当前证据重绑定与引擎策略

历史 N8/N9 收据保留原候选身份，不能替代后续源码变更后的当前候选证明。合并与授权修复的当前证据目录为 `harness/specs/fixtures/versebrowser-invocation-maturity/current-merge-20261025/`，必须同时满足：

- N8 原始失败摘要保留为 `HISTORICAL-FAILURE-20261016.md`，最终通过与历史失败分开表述；
- N8/N9 的 `SHA256SUMS` 覆盖目录内全部保留文件，重算零 mismatch；
- 当前候选记录干净 commit/tree、构建产物 digest、N8 packaged-flow 与 N9 46 轮结果；
- `node scripts/versebrowser-evidence-verify.mjs` 同时校验 manifest、attribution、当前源码未漂移和凭据扫描；
- managed-session engine 在构造时锁定为 `browser-window` 或 `agent-browser-cli`，不得在 `open()` 时按 CLI 二进制是否出现再次选择；选中的 CLI 不可用时返回 `E_CLI_UNAVAILABLE`，不得静默回退到另一个引擎。

该重绑定只维持既有“受控基础可用”声明，不增加 ego-lite 交互能力、不改变默认值、不发布、不声称全量成熟。

## 合并时的批准边界

私网批准由 Main 的 `approveBrowserPrivateNetwork` 接受可信监督步骤调用。
renderer 和模型传入的 `privateNetworkApprovedBy` 或 `privateNetworkOrigin` 不授予权限。
agent 驱动的等价路径从 Main inspector 调用已有批准函数，记录 grantedBy=agent，
绑定明确的 sessionKey 与 exact origin；成功打开后转绑到实际 Browser session，
同一批准不能再次打开其他会话，close 后撤销。无 session 的批准、跨会话、跨 origin、
过期批准和伪造请求字段均应被拒绝。批准步骤不替代 sandbox、权限 owner 或审计门禁。
N8/N9 必须先验证伪造批准仍被拒绝，再由 Main 自动批准并执行既有完整闭环。

## 2026-11-04 边界修复的当前验收

本次带构建来源校验的新候选使用 `current-20261105/`；`current-20261104/` 与 `current-merge-20261025/` 保留为历史。
N8/N9 在运行前后计算同一安装包的 EXE、app.asar、main-runtime.asar 身份，
必须与当前 candidate 一致。Windows 可用 `--temp-root` 指定 D: 上现有可写的
测试目录；无需更改应用默认值或目录权限。N9 仅回收本次分配的批次与轮次，
不得扫描或删除其他测试的共享临时目录。进程枚举失败不能算零残留。
验收等待完整 load 事件与 hostInvoke 就绪，正常退出超时后仅终止所属进程树。

构建前后记录 source commit/tree 与清洁状态，并将编译文件摘要放入 app.asar。
N8/N9 从实际包内读取来源记录并核对编译产物；当前 verifier 检查构建提交与运行
候选之间没有产品源码差异。文字声明、仅更新候选 hash 或零轮运行均不能替代此证据。
