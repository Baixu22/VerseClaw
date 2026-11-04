# VerseGit / VerseShell / VerseBrowser

> 面向问题：VG、VS、VB 各自到底负责什么？它们是产品功能、运行时基础设施，还是证据组件？“81 个方法”“32 个 operation”“M1/M2/M3”与真实可用能力是什么关系？

## 1. 一句话定位

| 组件 | 定位 | 不负责 |
|---|---|---|
| VerseGit（VG） | 宿主管理的并发仓库语义、候选与证据控制面 | 不替代 Git/worktree、不拥有 executor/task/approval/harness |
| VerseShell（VS） | typed ACI、受控命令执行与结构化结果的执行基座 | 不成为第二个 Task Ledger、审批人或产品 orchestrator |
| VerseBrowser（VB） | 嵌入桌面和 Gateway 的浏览器驱动/自动化引擎 | 不把契约方法数外推为当前驱动能力 |
| VToken | 旧 prompt token packing sidecar | 已退役，不是当前上下文优化产品 |

三者关系可以概括为：

```text
Orchestrator / Host
  -> VerseGit: 仓库语义、候选、依赖/风险/证据事实
  -> VerseShell: 执行 frozen argv、返回结构化 effect/receipt
  -> VerseBrowser: 打开、观察、操作、再观察、验证浏览器会话
```

VG、VS、VB 都受既有 Workspace、Permission、Session、Task 和 Observability owner 约束。它们不能自行扩大产品默认值。

## 2. VerseGit（VG）

### 2.1 重新定位

VG 不再只是“可选的 symbol verification plugin”，而是：

> 面向并发工作区的仓库事实与候选控制面。

它回答：

- 哪个 Agent/session 在哪个 worktree；
- 基于哪个 revision；
- 读集/写集/符号依赖是什么；
- 多个候选合并后是否发生语义破坏；
- verification 依据、风险和证据是否 fresh；
- 未来获准后，精确候选能否 CAS landing。

它不回答：

- 任务是否应被创建/完成；
- 哪个 Agent 该被批准；
- shell 命令如何被解释；
- harness 最终 pass/fail；
- 是否允许公开仓库或发布。

### 2.2 六类工作流

| 工作流 | 能力 | 当前宿主角色 |
|---|---|---|
| workspace | 身份、物化、恢复、stale working copy | 附着到宿主 worktree |
| change edit | tree、parent、diff、materialize | read-only 分析或显式调用 |
| history recover | operation、backup、restore | evidence replay/recovery source |
| validation admission | verify、basis、verdict | 提供事实/建议，不夺走 harness |
| candidate landing | candidate、CAS、report | default-off，未来另行决策 |
| external publish | Git/Gerrit/remote | 不在本模块范围 |

### 2.3 当前产品状态

截至本文核对：

- WP0–WP6 工程证据与 WP7 bounded live slice 已生成；
- WP8 独立 agent 审查、WP9 聚合有过工程收口；
- status 为 `PASS_WITH_GAPS`；
- 历史 WP9 为 `landed-unwired`；后续 bounded host slice 已有接线，当前可用性仍由显式开关、回执和当前候选验收决定；
- default off；
- `releaseEligible=false`；
- `liveReady=false`、`productApproved=false`、`defaultOn=false`；
- M4 landing/admission authority 未授权。

`docs/dev/versegit-product-integration/TF-0517/verified-glm-20261025/` 是后续产品接入的 agent-driven closeout 证据；它不改变上述产品锁。

当前复核使用 `harness/specs/fixtures/versegit-product-integration/f5-current-20261104/`。
旧目录只证明其记录的候选；source/candidate hash 改变后必须重跑对应检查，不能复制旧 pass。

### 2.4 Go / No-Go 边界

**允许的 M1：**

- 二进制、schema 可验证；
- 只读查询有上限、可超时；
- 失败不修改 harness 结果；
- `unavailable / partial / observed` 可区分；
- 不修改用户工作树。

**bounded M2/M3 host slice：**

- 真实并发 session 能绑定 session/worktree/trace；
- VG 输出只进 residual/advisory；
- candidate verification/test/build 经 VerseShell；
- VG 仓库事实由 typed fixed-argv adapter 产生；
- 不允许任意 argv/shell 字符串；
- selected 结果不能升级为 full；
- 执行 receipt、exit、timeout、cleanup、input hash 可复查。

**不授权：**

- default-on；
- 默认 `vg land` / `vg admit`；
- 用 VG admitted 替换 harness verdict；
- 把 `declare_intent` 暴露给未授权模型；
- 用 M1/M2 实现宣称 M3/M4 完成；
- 在产品代码中建立第二 executor/task/approval/write journal。

### 2.5 核心对象

```text
Workspace -> Session -> Snapshot -> Candidate -> Verdict/Land
   |            |          |           |              |
 repo_id     agent_id    tree_id     candidate_id    evidence_id
             worktree    base_oid    parents          run_id
```

三类“版本”必须区分：

- worktree：文件系统隔离位置；
- session checkpoint：某会话恢复点；
- semantic snapshot：读集、写集、符号、依据与证据。

checkpoint 不是完整系统快照，worktree 也不是语义快照。

### 2.6 主要入口

- `electron/services/versegit-api.ts`
- `electron/services/versegit-module.ts`
- `electron/services/versegit-observation.ts`
- `electron/services/versegit-receipt-bridge.ts`
- `electron/services/versegit-lifecycle.ts`
- `shared/types/versegit.ts`
- `shared/versegit-runtime-contract.ts`
- `resources/bin/win32-x64/`
- `docs/dev/versegit-validation-layer/README.md`
- `harness/specs/guides/versegit-concurrency/`
- `artifacts/versegit/`

## 3. VerseShell（VS）

### 3.1 定位

VerseShell 是 ClawX 的受控 typed ACI / governed execution foundation：

- typed operation catalog；
- frozen argv/profile；
- permission/approval 由现有 owner 裁决；
- 执行结果结构化；
- artifact、timeout、cancel、cleanup；
- source/binary/host receipt；
- 不直接成为 UI task authority。

状态：default-off controlled canary；strict typed ACI route 已接线，但不是 GA，也不是可见执行器。

### 3.2 当前冻结身份

以 `resources/verseshell/manifest.json` 与 `SOURCE.md` 为准：

- upstream commit：`c06f406e83566bb968448222d9c8caf429e580a0`
- 两个 residual patches：
  - `p0-runtime-startup.patch`
  - `python-current-interpreter.patch`
- source identity：
  `sha256:b3f8a52e9e8d758e0aa324e26ad50bf2db7662d5d69cd57bfc9fa8e877a3f0a0`
- manifest 声明 binary `resources/bin/win32-x64/ae.exe`（由资源准备/重建流程生成，干净检出可能暂不存在）：
  `3ed2174fee9b9d38ac34334211d9fd3187bc3b9a1e146a7db05eee64e9fd93f2`
- operation catalog：32 个 operation。

### 3.3 验证覆盖

agent-driven reintegration evidence 记录过：

- source checker：154 protected files / 32 operations / no issues；
- Rust module：16 targets，302 passed / 0 failed / 1 ignored；
- 15/15 real-frame contract replay；
- 32/32 operations 对 pinned binary 执行；
- real host tools 中 `read_files` 批量读取接入；
- negative intervention matrix；
- 两次 release build byte-identical；
- typecheck / comms replay+compare / Electron E2E / package verify。

这些结果绑定当时 source/binary/host commits。不能把它们泛化为当前所有平台、所有调用者的效果保证。

### 3.4 内部执行与外部 MCP adapter

有两条容易混淆的路径：

1. **Internal typed ACI / governed execution**
   - `openclaw_runtime/src/agents/verseshell/`
   - `openclaw_runtime/src/agents/verseshell-runtime.ts`
   - `shared/verseshell/`
   - `resources/verseshell/`

2. **External MCP compatibility adapter**
   - `resources/verseshell-mcp/`
   - 是独立 pnpm workspace；
   - 不应被描述成内部执行权威，也不应另开第二条执行路径。

Host contract 可携带 VS receipt，但 `tool result exists` 不等于 effect 已被业务验收。

### 3.5 当前限制

- default-off；
- liveReady/productApproved/defaultOn 仍 false；
- 不是完整跨平台 canary；
- 外部 MCP adapter 与内部 ACI 不可混用；
- 不能让 VS 自己决定 approval 或 task completion；
- 任何 execution success 都只能证明对应 argv/operation/host snapshot，不证明整个任务完成。

## 4. VerseBrowser（VB）

### 4.1 定位

`@verse-claw/versebrowser` 是嵌入 ClawX 的浏览器自动化引擎，能力覆盖：

- 页面打开/关闭/导航；
- snapshot、文本提取、可访问树/selector；
- click/type/press/drag/forms/dialogs；
- console/network 记录；
- HAR/replay；
- JS/source-map 探索；
- screenshot、download/upload；
- 业务 flow verification；
- standalone CLI/MCP driver；
- managed Electron browser-window driver；
- external/CDP attachment。

版本：`packages/versebrowser/package.json` 当前 `0.3.1`，私有 workspace package。

### 4.2 数字必须成组读

当前 README 与 `packages/README.md` 记录：

| 数字 | 含义 |
|---:|---|
| 81 | Host contract 中的方法形状 |
| 67 | 当前 Electron driver 实际实现的方法 |
| 28 | 模型可见的 agent_browser action vocabulary |
| 14 | 当前 Windows desktop snapshot 实际 advertise 的 action |
| 13 | source-only facade additions，但当前 desktop driver 不支持 |

81 不是“81 个 Electron 可用能力”。`agentBrowser.status` 会返回 live capability snapshot；模型 schema 只广告 `available=true` 的动作。

当前 Windows desktop 中不可用的典型项包括：

- 13 个 source-only additions；
- `command` CLI passthrough；
- 部分 external/CDP/CLI 专属动作。

如果调用未 advertise 的动作，Main 应在产生 browser effect 前拒绝：

- `E_CAPABILITY_UNAVAILABLE`
- `E_NOT_IMPLEMENTED`
- `UNSUPPORTED`

### 4.3 驱动选择不可热切换

- `browser-window`：desktop host 使用的 embedded Electron browser window；
- `agent-browser-cli`：standalone / external 附着时的 CLI engine。

Engine 是 construction-time immutable policy，不是每次调用 runtime probe。选择 CLI engine 但不可用时，应 fail closed，不应静默切换到另一个后端。

### 4.4 安全控制

Browser 的默认安全边界：

- runtime mode 初始 `normal_restricted`；
- 更高模式需要 bounded `userApproval: true`；
- private network 默认 deny；
- 未确认的 legacy private-network allow 会在 sync 时迁移为 deny；
- 某些 bounded session/origin 仍需要单独审批；
- credential vault 区分 `not_configured / ready / corrupted / encryption_unavailable`；
- full-access script/fetch/storage 有单独授权和 revoke；
- deny/unsupported 后不得换 driver 重试同一 mutation。

Gateway 只分发当前模型动作集合中的可用动作；`requestModeUpgrade`、`setEnabled` 等宿主管理方法
不属于该入口。运行时调用不能传 `userApproval`、`runtimeMode` 或私网批准声明；除状态发现外必须
携带所属运行时会话，payload 不得替换 owner。未绑定的状态发现仅返回能力信息，不返回浏览器会话。
权威能力集合为空或只有未知动作时，只保留 `status` 发现能力。

所有 desktop managed 会话及其附加 tab 都安装同一请求拦截，按真实 session/origin/有效期检查
重定向、子资源和 DNS 解析结果。首次打开的私网批准由 Host 单次消费，并在导航前绑定实际浏览器
session ID；关闭会话会撤销对应批准。只检查 `open` 参数不足以证明页面后续请求受控。
受控关闭会销毁所属窗口，网页的 `beforeunload` 不能否决资源清理；新 tab 初始导航被拒绝时立即销毁。
代理初始化或窗口创建失败时，同一 Host 会撤销已登记的 owner、批准和网络出口；关闭活动附加 tab 后，
会话切回仍存活的页面。IPv4-translatable IPv6 地址按其嵌入 IPv4 的私网类别检查。
当前安装包验收读取包内构建来源及编译文件摘要，并检查构建与运行候选的产品源码一致。
初始化失败仍须回收并留存失败结果；零轮稳定性运行不能报告通过。
无法归属窗口的请求不使用任何会话的私网批准或预览豁免；全部窗口关闭后，该 profile 不再发起后台请求。
普通页面的可选资源失败会阻断该资源，但不销毁已成功加载的主页面；supervised 任务仍保留严格的网络完成判据。
Main 的本地网络出口解析并校验目的地址后，直接连接该数值地址，Chromium 不会再次解析目标主机名。
持久化 profile 共享连接，因此私网出口采用该 profile 内所有活跃会话的许可交集；加入或关闭会话会撤销
已建立的连接。页面请求层继续逐次执行所属会话和授权时效检查；TLS 仍由 Chromium 校验原站点证书。
同一活跃 profile 的 DNS 结果固定并由请求层与出口共享，最多 1024 个主机；需要刷新地址时关闭该
profile 的全部会话后重新打开。该上限防止页面制造无界 DNS 状态，不扩大私网授权范围。
出口仅接受 Main 为该 profile 提供的代理认证，私网连接按授权到期时间断开；临时 DNS 失败可重试，
连接失败仅在已校验的地址列表中切换且不重放请求。WebRTC 不允许绕过出口发送 UDP。
系统代理/PAC 路由仍由 Electron 解析；HTTP 上游代理使用校验过的数值目的地址建立 CONNECT。
不支持的上游协议或独立 profile 代理配置会明确拒绝，不静默改成直连。

### 4.5 任务持久化与恢复

存储：`<dataDir>/agent-browser/tasks.json`。

重启时：

- `running` → `interrupted`；
- `statusExplain` 明确原因；
- 清除 dangling sessionId/runId；
- retry 支持 failed/cancelled/interrupted；
- waiting approval → approve → queued；
- waiting 状态下直接 run 会失败。

### 4.6 可观察闭环

推荐 agent 流程：

```text
open -> observe -> authorize if required -> act -> re-observe
     -> verify business flow -> close owned session
```

`verifyFlow` 只有在：

- business assertions 成立；
- console 收集完整；
- network 收集完整

时才返回 PASS；否则 UNKNOWN。Host transport 的 `ok:true` 只代表 dispatch 成功，必须继续读嵌套 `success / ok / error / completeness / verdict`。

### 4.7 主要入口

- `packages/versebrowser/src/`
- `electron/services/agent-browser-api.ts`
- `electron/services/agent-browser-capabilities.ts`
- `electron/gateway/agent-browser-bridge.ts`
- `shared/agent-browser/`
- `src/components/file-preview/WorkspaceLiveBrowserPanel.tsx`
- `src/pages/Browser/`（兼容入口）
- `docs/dev/browser-security-recovery.md`
- `packages/README.md`

### 4.8 当前限制

- contract coverage 不是 runtime coverage；
- standalone MCP/CLI smoke 不证明 desktop/Gateway path；
- Windows desktop action snapshot 不是所有平台的同一集合；
- private network 默认关闭，不是 GA 浏览能力；
- browser task recovery 不等于任务业务完成；
- 跨 tab/长期无人监督 workflow 仍未获产品批准。

## 5. VToken 为什么出现在这里

VToken 曾经是可选 token packing/context sidecar，但 TF-0496 用真实 provider usage 做 30 对 A/B：

- control mean input tokens：611.6；
- treatment mean input tokens：585.0；
- relative reduction：4.35%；
- 预声明 materiality bar：至少 10%；
- p95 latency：7171 ms → 8012 ms（1.117x）；
- quality 非劣，但 token win 未达门槛。

因此决定 retire，而不是继续 hold：

- production assembly inert；
- bridge inert；
- env/config 不能重新启用；
- code 和 history 保留用于 rollback inspection；
- renderer 没有 VToken product switch；
- rollback 需要新的 frozen protocol 和新的 materiality pass。

## 6. 当前集成边界

- VG、VS、VB 都是组件，不是新的总调度器。
- Host UI 与 Gateway 必须保留现有权限、session、workspace、task 和 observability owner。
- 任何组件 capability 数、binary hash 或一次 E2E pass 都不能替代产品默认和发布决定。
- 运行中的 actual backend、availability、authorization 必须以当前 live snapshot/effective policy 为准。
- Agent-driven evidence 不标 real-human。
- 产品锁仍由 `docs/dev/first-product-controlled-preview/STATUS.md` 与默认矩阵锁定。

## 7. 当前缺口汇总

| 组件 | 主要缺口 |
|---|---|
| VerseGit | default-off、bounded host slice 按当前候选验收、完整 M3 未验收、M4 未授权、跨平台/真实大样本仍在 P2 |
| VerseShell | default-off、controlled canary、外部平台和真实用户 canary 未完成 |
| VerseBrowser | 81/67/28/14 差距；13 source-only 未实现于 desktop；private network 默认 deny；没有无人监督 GA |
| VToken | retired；低于 materiality bar，不能宣称 token-saving 产品 |

## 8. 源码与证据索引

- `docs/dev/versegit-validation-layer/README.md`
- `docs/dev/versegit-product-integration/TF-0517/`
- `harness/specs/guides/versegit-concurrency/`
- `docs/dev/verseshell-foundation/STATUS.md`
- `resources/verseshell/SOURCE.md`
- `resources/verseshell/manifest.json`
- `resources/verseshell-mcp/`
- `packages/README.md`
- `packages/versebrowser/`
- `docs/dev/browser-security-recovery.md`
- `docs/dev/vtoken-retirement-decision.md`
- `shared/component-authority-manifest.ts`
- `shared/dcs/component-disposition-catalog.ts`
- `docs/dev/component-disposition-matrix-20261021.md`
