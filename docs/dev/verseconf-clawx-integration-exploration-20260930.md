# ClawX 接入 VerseConf：完整闭环与分阶段探索方案

日期：2026-09-30

性质：**ClawX 侧源码核对与设计建议；不是实施完成、测试通过、解冻或发布决定。**

`driven_by: agent` · `actor: claude/clawx-integration-research`

## 0. 结论与推荐决策

**推荐将 VerseConf 接成 ClawX 的“结构化产物编辑计算内核”，而不是新配置中心、通用 MCP 文件写入器或第二套 Agent Runtime。**

采用关系：

1. VerseConf 只接收内存中的文档、变更和可信 schema，返回候选与诊断。
2. ClawX runtime 业务插件负责研究表／幻灯片大纲的业务操作。
3. 现有 runtime 文件写入 owner 补出当前执行上下文绑定的受管候选提交能力；它负责权限、版本冲突、写入、恢复和实际效果。
4. 现有 SQLite 增加窄的产物身份／版本／输出关系领域；不新建任务、审批或记忆权威。
5. Renderer 通过现有 host-api → Main → Gateway 查询；修改优先进入现有 agent run。
6. 先完成研究比较表，再用幻灯片大纲验证复用；最终只选择一个生产编辑引擎。

**最先验证的不是“能不能加载 wasm”，而是“插件能否不扩大权限地提交一个候选，并在冲突、取消和重启后说清实际结果”。**

建议分成两道采用决策：

- **机制可行**：受管提交、版本、恢复、渲染、展示能串起来。
- **引擎值得采用**：在相同 ClawX 宿主契约下，VerseConf 相比 TS 薄实现有可解释收益，足以承担绑定／构建维护。

第一道通过不自动证明第二道。若 VerseConf 净收益不成立，保留必要的宿主闭环能力，停止 VerseConf 特定扩张；不在产品中维护双引擎自动切换。

---

## 1. 本轮依据与证据边界

### 1.1 基线

- ClawX：`D:/ClawX`，分支 `feat/runtime-lifecycle-governance`，HEAD `6104cd9a147737e8d6ec037f1a81fafc814598d2`。
- 工作树已有 Context／COMPASS、README、Task Forest、handoff 等未提交修改。本方案按当前源码核读，不把工作树称为干净候选；不修改这些既有工作。
- VerseConf：用户提供目录中的 `repo/`，HEAD `81e480ae1ea36f66c53c40d70feae3b1f77f4e09`，本轮检查工作树干净。
- 输入报告：`C:/Users/27933/Desktop/verse-conf/research/VerseConf-ClawX-双向适配深度调研-2026-09-30.md`，全文核读。
- 补充核读：VerseConf `docs/CLOSEOUT.md`、`js-api/src/index.ts`、Rust JSON 编辑函数和值类型，以及既有 `binding-probe-corrected.json`。

原报告部分 ClawX 链接指向旧的 `C:/Users/27933/Desktop/clawx/ClawX`。本文 ClawX 证据均重新对照当前 `D:/ClawX`，并使用仓库相对链接。

### 1.2 本轮做了／没有做什么

**已做**：源码、调用方、相邻测试、配置同步、打包入口、既有探针结果的静态核对；提出工程拆分和验收矩阵。

**未做**：注册插件／MCP、运行 wasm 探针、修改产品源码、安装依赖、启动 Electron、执行单测／E2E／打包、调用外部模型、修改真实用户配置、发布、改变冻结状态或 Task Forest 状态。

既有探针的“7 项通过”证明了包括 wrapper 缺口在内的七项观察，不是七项产品兼容能力。本轮没有将它当作新的测试通过结果。

### 1.3 与原报告相比，本方案增加的落地内容

- 以现有 `apply_patch` 预检／journal／effect receipt 为复用起点，而非从零设计事务层。
- 把发现、安装、启用、实际 run 可用、包内可运行五个层级拆开。
- 明确创建／导入／修订／导出／恢复／外部变更／跨会话／升级卸载的完整生命周期。
- 给出当前 run 权限继承的具体检查点，以及缓存工具工厂不能持有过期权限的问题。
- 为不可变历史源、晚到渲染、幂等键、文件与 DB 崩溃窗口定义语义。
- 区分研究工具、业务生产工具、将来配置编辑三条消费路径。
- 拆成可顺序推进的工作包、失败退出条件和验收证据，不生成未经授权的 TF 节点。

---

## 2. “完整接入”到底包含什么

完整不是让 VerseConf 接管 ClawX 的全部文件、配置和 Office 能力，而是在声明的消费范围内，不留下只能靠人工补洞的生命周期断点。

| 层级 | 能证明什么 | 不能据此宣称什么 |
|---|---|---|
| L0 库可调用 | 当前环境能加载、计算候选、返回诊断 | Agent 能使用、权限继承、产品可分发 |
| L1 最小纵向闭环 | 一个研究表可创建／导入、修订字段、受管提交、导出、重启读回 | 记录增删排序、通用 Office 编辑、跨平台可用 |
| L2 有界完整接入 | 两个领域的声明操作、失败恢复、历史版本、UI、干净安装与目标平台包内验证 | 全格式、任意第三方应用往返、全局安全门禁或 GA |
| L3 后续独立扩展 | JSONC／TOML、选定配置 owner、更多输出场景 | 本次默认授权范围 |

**本方案的完整目标是 L2；实施顺序先到 L1。**

### 第一消费者：研究比较表

- 业务源：严格 JSON，稳定记录 ID，比较维度、结论、来源引用和局限。
- 输出：Markdown、XLSX；先显式导出，不增加后台自动重渲染系统。
- L1：创建或导入合法源，按 ID 修改已有记录的多个非重叠字段。
- L2：补记录插入、删除、排序，以及历史恢复与导入冲突语义。

### 第二消费者：幻灯片大纲

- 业务源：稳定 `pageId`，首版仅 `title/body` 及明确顺序。
- 输出：PPTX；需要内容读回和 agent 驱动的视觉检查。
- 不承诺复杂模板、图表、动画、图片、备注或既有任意 PPTX 的无损往返。

### 不混入本轮

- 改写 DCS／COMPASS／Context／Memory 的权威和默认开关。
- 将 `openclaw.json`、凭据、任务图或所有用户 JSON 直接交给通用编辑工具。
- 接管现有 OfficeCLI／文档技能、恢复退役的 Work Mode。
- 恢复 VerseConf 独立语言、LSP、VSCode、多绑定、Docker、公共发行线。
- 自动外发、自动发布、多人实时协作、任意 shell 写入下的全局事务保证。

---

## 3. 当前 ClawX 能复用什么，真正缺在哪里

| 领域 | 已核对事实 | 接入动作 |
|---|---|---|
| 插件工具 | 工厂有 workspace/session/fsPolicy 等；回调保留 plugin scope | 增加当前执行期、不可由模型伪造的受管文件能力；不能只补普通参数 |
| coding 写入 | `applyWriteKit` 给 edit/write/patch 装配部分治理；不是任意插件 IO 的通用拦截器 | 在现有 owner 内补候选提交，禁止插件自行 `fs.writeFile` 冒充受管 |
| patch 预检 | 已有预计算、batch lock、prepared/committed/rolled_back/recovery_required | 复用职责与已有测试；不能把 patch 解析器包装成另一套业务引擎 |
| 写入协调 | edit/write 使用一个路径队列；patch 使用另一个锁 Map | 同进程相关路径合并协调语义；避免再加第三套锁 |
| journal／收据 | 既有 journal 和 patch receipt fail-open；收据只解释效果，不授权重放 | 新能力的恢复承诺须有必需证据；不要把旧默认整体改为 fail-closed |
| Office 生成 | Main 真正调用 docx/xlsx/pptxgenjs，但 writer 直接写盘 | 抽取无落盘渲染函数；受管业务路径只由 runtime owner 发布输出 |
| 产物类型 | WorkArtifact 主要是展示模型，无持久源版本关系 | 新增明确的业务身份、revision/output 引用；保留普通附件路线 |
| Chat 投影 | 文件先经 diff 条件筛选；再派生 index ID、当前时间与 ready | 业务产物独立 typed 投影，不伪造 diff 以挤进旧流水线 |
| 校验 UI | validate 返回结果未写入状态；revise 仅选择 | 接入真实版本目标、校验结果、过期结果和错误状态 |
| 状态库 | 共享 SQLite／Kysely 已存在；plugin KV 会淘汰旧项 | 产物长期索引不能直接放默认有淘汰的 KV |
| 配置隔离 | source runtime 读取独立 config/state/home；同步选定配置键 | 验证实际生效副本、插件全局开关、加载路径、allow/deny 和重启 |
| 打包 | root 与 runtime 非同一个 pnpm workspace；资源复制／依赖收集有多条路径 | 按真实消费包声明依赖，做干净安装和 packaged smoke |

关键证据：

- [插件工厂上下文](../../openclaw_runtime/src/plugins/tool-types.ts:14)、[插件回调包装](../../openclaw_runtime/src/plugins/tools.ts:128)、[工厂调用方](../../openclaw_runtime/src/agents/openclaw-plugin-tools.ts:133)。
- [write-kit](../../openclaw_runtime/src/agents/agent-tools.ts:846)、[patch 预检与提交](../../openclaw_runtime/src/agents/apply-patch-preflight.ts:278)、[edit/write 队列](../../openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts:24)、[patch 锁](../../openclaw_runtime/src/agents/apply-patch-batch-lock.ts:11)。
- [journal](../../openclaw_runtime/src/agents/tools/write-journal.ts:1)、[patch receipt](../../openclaw_runtime/src/agents/apply-patch-effect-receipt.ts:1)、[RC-04 receipt 权威边界](../../openclaw_runtime/src/agents/effect-receipt.ts:1)。
- [Office writer](../../electron/services/work-providers-api.ts:396)、[实际校验范围](../../electron/services/work-providers-api.ts:592)、[相邻测试](../../tests/unit/work-providers-api.test.ts:153)。
- [WorkArtifact](../../shared/types/work-artifact.ts:16)、[Chat 派生](../../src/pages/Chat/index.tsx:2896)、[validate 调用方](../../src/pages/Chat/index.tsx:3761)、[ArtifactView](../../src/components/file-preview/ArtifactView.tsx:20)。
- [共享 DB owner](../../openclaw_runtime/src/state/openclaw-state-db.ts:21)、[KV 淘汰](../../openclaw_runtime/src/plugin-state/plugin-state-store.sqlite.ts:380)。

注意：核读测试只说明当前测试覆盖点，本文没有声称重新执行过这些测试。

---

## 4. 推荐架构与单一权威

### 4.1 调用关系

- **读界面**：Artifact Panel → `hostApi.structuredArtifacts`（拟新增）→ Main 薄代理 → Gateway 受权限检查的查询 → runtime 产物领域。
- **写界面**：Artifact Panel 选择产物和 revision → 现有聊天／agent run → runtime 业务工具 → 当前调用绑定的 mutation capability。
- **计算**：业务工具 → 懒加载的 Node worker → VerseConf wasm → 完整候选／诊断。
- **提交**：mutation owner 验证调用上下文、路径、基线、候选摘要和恢复准备 → 写入 → 记录实际结果。
- **导出**：提交版本的不可变源快照 → 领域 mapper → 纯渲染函数 → 输出检查 → 同一受管 owner 发布新输出。
- **展示更新**：持久结果 → typed 引用／事件 → host-api → Store／Artifact Panel。

上述新 API 名都是设计占位，不是已经存在的仓库接口。

### 4.2 五个职责，不能互相越权

| 组件 | 拥有 | 不拥有 |
|---|---|---|
| VerseConf 内存内核 | 语法、定位、候选编辑、声明的结构检查 | 磁盘、凭据、审批、工作区、发布、任务状态 |
| ClawX 业务插件 | 领域 schema 选择、字段／记录操作、导出映射 | 新权限系统、任意工具执行器、私自选高权限 workspace |
| runtime mutation owner | 当前权限、写入协调、版本检查、恢复、真实操作结果 | 调研结论真实性、幻灯片设计优劣 |
| 产物 metadata 领域 | artifact/revision/output/validation 的持久关联 | 再建任务完成状态或独立提交日志 |
| Main／Renderer | 传输、状态呈现、选择与操作意图 | 直接改源、替 runtime 判成功、动态切换后端协议 |

### 4.3 为什么不是直接挂五个 MCP 工具

五个旧工具不是完整业务 API，当前 wasm 消费面也没有通用 JSON inspect/edit。即使注册成功，仍缺业务 ID、schema owner、当前 run 权限、受管提交、历史和输出血缘。

MCP 可以保留为研发探针或其他宿主的协议接口，但产品不应走“模型拿候选，再自由调用 write 落盘”的路线：中间检查可被绕过，版本与上下文也会断开。

也不推荐 runtime 反向调用 Main 的 Work Provider 私有业务服务。现有 `clawx-git/storage` Main 本地 MCP 明确不镜像到 runtime，不能将它当通用反向总线，见 [Main MCP 边界](../../electron/services/mcp-api.ts:933)。

---

## 5. 最关键工作：当前 run 的受管提交能力

### 5.1 公开的是窄能力，不是 `executeAnyTool`

建议对可信业务插件提供三个内部宿主能力：

- 读取受控源快照及其版本。
- 提交经过领域验证的完整候选，带预期基线。
- 发布指定源版本的新输出，返回真实操作结果。

插件只通过公开 SDK seam 调用，不 deep-import `src/agents/**`。若新增 SDK 子路径，同步 package exports、entrypoint 清单、类型、文档与导出测试；不要只加一个 TS re-export。

**工厂上下文与调用上下文分离**：工厂负责声明工具，执行时绑定 `runId/sessionId/toolCallId/workspace/signal/provenance`。工具描述缓存不能缓存一个已结束 run 的可写句柄；跨 run、重启、workspace 切换后旧句柄必须失效。

插件的 JS 在宿主中运行，本身是可信安装代码，不是被该 capability 沙箱化的不可信程序。这里约束的是正确调用和权限继承；不能宣传为能阻止任意恶意插件直接使用 Node fs。

### 5.2 权限判据

写入允许条件是交集，而不是“插件安装成功”：

1. 插件在当前 runtime 中启用，且此业务工具通过 allow/deny 与当前工具面选择。
2. 当前会话／agent／workspace 的文件写权限允许此类效果；新工具不能绕过同类写能力的拒绝规则。
3. 目标落在受控范围内，通过当前真实 fsPolicy、sandbox fs bridge、路径及 provenance 检查。
4. 当前调用仍有效，未取消、未撤销；需要审批时得到对应 owner 的有效决策。
5. 基线及候选摘要、schema/profile 与批准时绑定内容一致。

不能靠“工具名称改成 artifact_edit”绕过原来对 edit/write 的限制，也不能简单规定 write 工具缺席就一律等于无文件权限：需要在现有策略 owner 中明确新工具所属的文件效果权限映射，并测试 readonly、显式 deny、不同工具 profile 的结果。

当前 `tools.invoke` 虽有策略／hook，但执行调用只传 `toolCallId/params`，见 [实际调用](../../openclaw_runtime/src/gateway/tools-invoke-shared.ts:448)。因此首版 UI 变更走已有 agent run；未经补全上下文的直接 invoke／自定义 RPC 必须拒绝 mutation。

### 5.3 写入协调：复用 owner，但不盲套 wrapper

- 从 `apply-patch-preflight` 的预检、快照、preview binding、状态和效果关联中抽取真正共享部分。
- 当前 edit/write 与 patch 的锁实现不同；新候选提交、普通 edit/write、patch 对同一路径应参加同一进程内协调。
- 路径规范化统一处理 Windows 大小写、符号链接／junction、尚不存在文件的父目录、沙箱路径映射。
- 获取多个目标时稳定排序；等待可取消；异常释放；避免外层拿锁又调用内部再次拿同锁造成死锁。
- 不在文件锁内等待模型、审批或长时间渲染。先准备候选／审批，再短时间持锁重查并提交。
- 旧 Main writer 不应被用来直接覆盖新的受管业务源／输出；新产物路径经 runtime owner，旧普通 Office 输出仍走原路径。

首版保证同一运行 owner 内参与协调的写入。外部编辑器、shell、其他进程不自动参加该锁；只承诺已测试的漂移检测，不声称严格跨进程 CAS。

### 5.4 新恢复承诺与旧 fail-open 如何共存

现有 journal 与 patch receipt 明确 fail-open，且受已有开关影响。**不得为了新场景偷偷开启全局 writeJournal，或把全部历史工具默认改为 fail-closed。**

新能力由相同写入 owner 实现独立、明确的有界承诺：

- 无法持久保存本次恢复所需的 pre/post 身份和操作状态，则提交前拒绝。
- 若当前配置不允许所需恢复能力，报告 capability unavailable；不能启用后假装继承了完整保障。
- 新增运行状态使用既有 SQLite，归 mutation owner；不在业务插件中新增 JSON sidecar operation log。
- 既有 `.pre` 可作为命名备份的复用资产；既有 `.meta.json` 历史属于迁移债务，不借本任务全量重做，也不让新记录双写成第二真源。
- 操作 journal 是效果／幂等权威；RC-04 receipt 只是关联。receipt 写失败不改变已发生效果，更不能导致自动重放。

新严语义到底能直接复用哪一部分，由提交 spike 验证；如果必须先重构整个执行系统才能实现，停止扩张，重新评估场景价值。

### 5.5 文件与 DB 的提交顺序

建议协议，而非声称 OS 提供跨文件／DB 事务：

1. 在调用上下文内完成输入、schema、领域和权限预检；候选绑定基线摘要。
2. 需要审批时绑定 artifact、基线、候选 digest、操作范围与有效期；批准后仍重新检查版本。
3. 获取路径协调，重读实际 bytes，核对 revision 与 digest。
4. mutation owner 持久记录 `prepared`，确认恢复快照可用，再写目标。
5. 读回目标 digest，记录已发生结果与 revision；更新产物关联。可在同 DB 的部分合并事务，但不将 DB 锁跨越慢文件 IO。
6. 记录实际效果收据，发版本化事件；事件丢失可查询恢复，不影响源事实。
7. 如写后记账失败，返回明确的 `recovery_required`／已发生但未完成对账状态，不回报“没有修改”。

重启对账只据持久操作记录和实际内容判定：等于 pre、等于 post、或两者都不等。未知状态冻结该产物变更并提供可检查诊断；**不自动重放未知副作用，也不覆盖第三种内容**。

撤销不是 `undoLastWrites` 的无条件调用：正常产品“恢复到历史版本”是将旧快照作为新候选，针对当前版本再受管提交，保留历史顺序；崩溃补偿是另一种 owner 内部动作。

---

## 6. 产物、版本与领域契约

### 6.1 身份模型

| 标识 | 建议语义 |
|---|---|
| `artifactId` | 宿主分配的稳定业务身份，不是文件名／列表索引 |
| `revisionId` | 一次已提交源状态的身份，绑定 parent、bytes digest、schema/profile |
| `revisionSequence` | 同产物内单调顺序；相同内容后来恢复也不倒退历史 |
| `recordId/pageId` | 文档内部稳定业务 ID，与数组位置分离 |
| `operationId` | mutation owner 的一次操作身份；映射可信调用／重试键 |
| `renderAttemptId` | 针对固定源版本和 renderer 版本的一次渲染 |
| `outputId` | 一个实际输出及其内容摘要 |
| `validationId` | 针对特定对象 digest 的某类检查记录 |

只比较内容 hash 不能分清“旧内容 → 新内容 → 恢复旧内容”的业务历史。版本检查同时绑定 revision 身份和实际 bytes；显式恢复产生新 revision。真正无变化的候选返回 `unchanged`，不伪造一次修订。

### 6.2 存储边界

建议在既有 runtime SQLite 中新增窄领域，逻辑上包含：

- `artifacts`：workspace 范围、kind、源位置、当前 revision。
- `artifact_revisions`：parent、顺序、源摘要、schema/profile、不可变 snapshotRef、mutationRef、创建上下文。
- `artifact_outputs`：源 revision、renderer/mapping 版本、路径、摘要、大小、渲染／验证结果。
- `artifact_validations`：对象摘要、检查器版本、类别、结果、有限诊断、actor/time。

这是逻辑设计，不要求不经评估就建立四张物理表。读写经窄公共 seam 和既有 Kysely；不能让插件持有任意 SQL 句柄。

**历史不只是一串 hash**：首版必须能取回每个承诺可恢复 revision 的源快照，包括初始版和最新一版。快照持久化、保留与清理归 mutation/history owner；metadata 只引用，不另建插件快照库。可在该 owner 内实现有界的 SQLite 文本／BLOB 快照，或复用被明确保留的命名备份；具体物理方案在提交 spike 中验证后固定，只留一条新写路径。

工作区中的结构化源是可导出的业务文件，不把 Task Ledger 状态藏进去。DB 是身份／关系／操作状态权威，不允许文件与 DB 两边分别编辑“当前 revision”来互相覆盖。

容量耗尽时显式拒绝继续创建版本或要求明确归档策略；不能像当前默认 plugin KV 一样悄悄淘汰唯一历史。业务快照和日志均不默认外传。

### 6.3 Agent 看到的工具

建议先提供四个领域工具，名称仅示意：

| 工具 | L1 能力 | 关键限制 |
|---|---|---|
| `structured_artifact_create` | 创建研究源，或从受控 workspace 文件导入 | kind 选可信 schema；宿主分配身份／目标目录；导入不覆盖原文件 |
| `structured_artifact_inspect` | 元信息、指定字段／记录的有界读取 | 返回 revision；分页不跨快照混合；不默认把整份源塞进上下文 |
| `structured_artifact_revise` | 已有记录的非重叠字段批次 | 必须 baseRevision、expect；L2 才增加记录增删排序 |
| `structured_artifact_render` | 指定 revision 导出 Markdown/XLSX | 只允许登记的目标格式和 renderer；无任意命令／输出路径 |

history／validation／restore 可先作为产物 UI 与现有 run 的受管动作；真实模型需要后再暴露窄工具，避免一次铺开十几个同义工具。

示例修订请求：

```json
{
  "artifactId": "artifact-example",
  "baseRevision": "revision-from-inspect",
  "changes": [
    {
      "op": "setField",
      "recordId": "comparison-3",
      "fieldPath": ["finding"],
      "expected": { "kind": "value", "value": "旧结论" },
      "value": "新结论"
    },
    {
      "op": "setField",
      "recordId": "comparison-3",
      "fieldPath": ["limitations"],
      "expected": { "kind": "value", "value": null },
      "value": "尚未覆盖跨平台验证"
    }
  ]
}
```

模型不能提供 session/run/actor、源绝对路径、schema 文本、权限配置、`force`、`disableSafety` 或任意 renderer 命令。字段路径须经过领域白名单／schema 验证，不能编辑系统身份字段。

同一重试键＋相同 payload 返回已记录结果；同键不同 payload 冲突。不同真实调用中的相同内容不自动视为同一次已授权效果。幂等作用域与有效期由 owner 规定，不能拿模型生成的 ID 充当执行证明。

### 6.4 结果不压成一个 success

至少分三层：

- 源：未改变／已提交／冲突／恢复待对账。
- 输出：未生成／生成中／生成失败／输出存在，以及它对应哪个 revision。
- 验证：未检查／通过／内容无效／检查器故障；视觉与事实检查分别记录。

稳定错误码覆盖 `invalid_input`、`target_missing`、`target_ambiguous`、`expectation_mismatch`、`schema_invalid`、`domain_invalid`、`permission_denied`、`approval_pending`、`version_conflict`、`recovery_required`、`render_failed`、`cancelled`、`capability_unavailable`。

错误码用于代码分支；诊断语言用于解释。schema 合法不是事实正确，文件存在不是内容合格，完成源修改不是导出完成。

---

## 7. VerseConf 需要交付的最小适配包

### 7.1 契约需求

| 需求 | 当前限制／风险 | 必须交付 |
|---|---|---|
| JSON 值 | 旧 EditValue 无 null；wrapper 类型和转发不完整 | 新 JSON 消费类型，递归支持 null／数组／对象，缺参与 null 分开 |
| 多字段批次 | JSON 当前单 EditIntent，每次 finalize | 同一基线定位，最终候选一次检查；拒绝重复／父子重叠目标 |
| inspect | 五个 wasm 工具不等于业务读取 API | 有界读取、存在性、类型、稳定诊断 |
| schema | wrapper 未转发 format/draft；旧默认是 VCF | 宿主固定 schemaId/version/digest/draft，绑定原样转发 |
| 歧义 | 重复键、重复 ID 可能让不同消费者解释不同 | 全文重复 JSON 键拒绝＋领域 ID 唯一性检查 |
| 数字 | Rust 与 JS 范围不天然相同 | 有限 binary64；安全整数约束；精确金额用领域十进制字符串 |
| 字节 | Rust UTF-8 span 不等于 JS UTF-16 索引 | 明确 UTF-8 半开区间；独立测试中文／emoji／CRLF／BOM |
| 记录操作 | 现有对象字段编辑不等于数组记录 CRUD | L2 明确 insert/remove/move，按 ID 与 beforeId/afterId 定位 |
| 资源 | 同步 wasm 加载／执行可能阻塞调用进程 | worker 懒加载、有界输入、取消／超时、迟到结果废弃 |
| 分发 | 冻结构建不是持续交付包 | 锁源码／锁文件／工具链／wasm-bindgen，交付 manifest 与哈希 |

推荐内存消费面为 `inspectDocument / applyDocumentChanges / validateDocumentCandidate`，可复用内部实现，但不反向依赖启动 MCP server。

首版严格 JSON；JSONC／TOML 不要靠扩展名猜测或声称兼容全部 JSON5。BOM 要么明确支持并计入源 bytes，要么明确拒绝，不能静默剥离后声称字节保真。

Schema 不接受任意本地路径／URL，不开放 `schema_from_config` 或动态外取 `$ref`。不将配置安全启发式照搬到研究结论／幻灯片文本，也不给模型“关闭全部安全检查”的旋钮。

### 7.2 不用旧 checkWrite 成功冒充完整编辑

旧 raw wasm 的 `check_write` 可用于只读机制探针，验证基线／候选／标准 schema 的加载和错误传递；它不能证明已解决 inspect、JSON null 编辑、批次或记录操作。

现有 wrapper 缺口必须同时修 Rust 导出、TS 类型、实参、错误信封、能力描述和测试。只改 `.d.ts` 或只放宽 schema 都不够。

### 7.3 worker 不等于安全沙箱

worker 只拿源 bytes、可信 schema 和有限操作，业务协议不传任意磁盘路径或网络取数请求；最终写盘仍在 owner。

Node worker 的资源限制不自动证明 wasm 线性内存受同样硬限制；需要分别检查 wasm memory 配置、进程 RSS、输入上限和超时终止行为。首轮测小／中／上界输入档位，确定容量再写 spec，不给未经测量的毫秒或内存保证。

取消后销毁或废弃该请求计算结果，不能 worker 完成后继续提交。worker 崩溃隔离不能变成永久重试循环。

---

## 8. 两个业务消费者的落地细节

### 8.1 研究比较表

建议最小源包含：schemaVersion、title、records；每条记录有稳定 ID、比较项、finding、evidenceRefs、limitations；引用集合与推断文本分开。

- ID 由宿主创建／校验；不由数组下标充当身份。
- 修改 finding 与 evidenceRefs 等关联字段时，只检查最终候选，允许中间态不满足领域规则。
- 独立领域校验检查引用存在、ID 唯一、受支持字段和必要约束；不因为有 URL 就显示事实已核验。
- Markdown mapper 对竖线、换行、链接进行对应转义。
- XLSX mapper 固定列与类型，明确 missing/null/empty string 的导出表示；外部文本显式作为文本，不能自动当公式或可执行链接。
- 独立读回 XLSX 行数、记录 ID、关键值与来源；不能只用 writer 同库 round-trip 或“文件可以打开”作终局判据。
- CSV 若加入，必须使用正确 CSV 解析与转义；当前 `split(',')` 回退不能作为验收 oracle。

### 8.2 幻灯片大纲

- 共用相同 artifact/revision/mutation/output 合同，只新增 slide schema、mapper、renderer 和 validators。
- `pageId` 与位置分离；修改／删除／移动按 ID 定位。
- 复用现有固定 title/body renderer 的生成逻辑，但改为返回 bytes／受控临时结果，不让它自行决定最终路径。
- 独立检查 PPTX XML 中实际页数、顺序和文本；再将页面渲染成图，检查中文、溢出与重叠，记录 `driven_by: agent`。
- 若环境暂不具备 PPTX 页面渲染，只能记录 content-verified／visual-unverified；这是可自动补齐的工程项，不转为等待真人。
- 复杂演示仍走现有技能／OfficeCLI。其结果可以作为普通附件，不能无源身份地冒充可结构化修订产物。

### 8.3 第一轮就要包含的负向流程

- 读 v1 后有另一修改到 v2：旧请求拒绝，不强制覆盖。
- 源 v2 提交成功，但 XLSX 渲染失败：v2 保留，旧有效输出仍可打开并标为旧版。
- v2 渲染慢，v3 先完成：v2 可以成为历史输出，不能把当前指针回退。
- 同请求网络重试：不产生第二次源修订和多份“最新”输出。
- 用户／agent 外部改源：读取或提交时检测 drift；先导入／协调新版本，不替对方覆盖。

---

## 9. UI、历史和输出血缘

### 9.1 最小 UI，不重做整页

保留现有 Artifact Panel，只对受管业务产物增加：

- 当前源版本与 schema 类型。
- 最新可用输出及“来自旧版本”的提示。
- 指定记录修订、显式重新生成、版本历史、恢复为新版本。
- validation 的检查类别、结果与摘要；区分 invalid 和 checker error。
- capability unavailable／只读／审批中／恢复中状态及原因。

修订按钮把 artifactId/baseRevision 作为结构化意图送入现有 run；UI 提供的引用仍需后端授权，不能把前端 metadata 当可信 run 身份。第一阶段不实现无 run 的直接写 RPC。

### 9.2 真实业务投影与普通文件投影分开

[generated-files.ts](../../src/lib/generated-files.ts:382) 对代码 mutation 的严格 patch/journal 关联继续保留。

- 文本源：有真实 before/after 与 journal 才显示 diff。
- XLSX/PPTX：显示真实 artifact/outputRef，不制造文本 patch。
- 普通文件／附件：继续原有预览路线，不要求全部先导入业务源。
- 老历史只有文件路径时，继续当普通文件；用户显式导入才获得新 artifactId，不凭文件名反推不存在的历史。

新引用需要贯通工具返回、transcript 持久化、Gateway history、事件转发、Store 与重启查询。只改 Chat 当前内存映射不足以闭环。

### 9.3 状态更新必须抵抗乱序

事件携带 artifactId、revisionSequence／状态版本、outputId；UI 忽略低版本状态覆盖。断线后从当前 workspace 的受权查询重建；事件不是唯一真源。

“最新已验证输出”与“当前源对应输出”是不同查询。旧版输出可以可用，但不能显示为新源已完成；每个 validation 绑定 digest，外部改了文件后原 verdict 仅保留历史意义。

### 9.4 审批与现有 Inbox

[当前 runtimeApprovals](../../electron/services/runtime-approvals-api.ts:59) 代理的是 `exec.approval.*`，不能把它当作所有插件审批的现成 UI。

优先复用 runtime 已有审批 owner 和决策语义。如果确需 plugin approval，补 typed projection 与对应事件／resolve 路由，验证挂起、拒绝、超时、取消、重启；不另建审批数据库，不拿 exec 的 allow-always 自动套给文件候选。

验收由脚本／agent 点击现有审批交互并如实标注；这不等于在产品代码中硬编码全部允许。

---

## 10. 安装、能力发现、打包与升级

### 10.1 不要用一个 installed 布尔值

建议内部按顺序诊断：包可发现 → 插件可加载 → 契约兼容 → 当前 runtime 支持 mutation → 当前 run 有权 → renderer 可用。

至少能区分 `disabled / incompatible / dependency-missing / read-only / available`，并返回有限 reason code。设置页的全局 available 不承诺每个会话都可写。

Node wasm 是优先单路线；缺包／版本不符时明确 unavailable，不临时改走 shell/native/MCP 绕过，也不全局打断普通 Chat。

### 10.2 source runtime 隔离要实测

[config-sync.ts](../../electron/gateway/config-sync.ts:803) 当前同步 agents/models/plugins/runtime/tools/channels，并设置独立 config/state/home。

因此安装测试必须验证：

1. Main 记录的插件路径能被真正运行的 Gateway 解析。
2. 生效 config 的插件 entries、allow/deny、全局 enabled 与用户授权一致。
3. 没有 channel 的新安装中也能正确表达显式启用；不要依赖 channel 启动顺便打开插件总开关。
4. 禁用／移除后实际 runtime 不再给出写能力；配置省略键会保留旧隔离值，撤销不能只依赖“删掉配置字段”。
5. 明确重启或 owner reload 后生效，不每次工具调用重新扫磁盘／重建插件注册表。
6. 不写入用户主目录后就假设 isolated runtime 已经采用该状态。

不能为本插件修改 sandbox.mode 或放宽文件边界；现有 source-runtime fallback 行为不是新插件扩权的依据。

### 10.3 单一分发路径

建议形成固定版本内部包／本地 tarball，包含源码 revision、构建锁、Node glue、wasm、类型、许可证和 manifest；通过选定的 runtime 插件实际依赖图消费。

根 [pnpm-workspace.yaml](../../pnpm-workspace.yaml:1) 不包含 openclaw_runtime，不能跨两边直接写 `workspace:*` 就算完成。业务插件可落在现有 `resources/openclaw-plugins/` 体系，但必须补对应打包与加载链，不假定放进目录就自动启用。

如抽取共享 Office 渲染函数，做一个真正被 Main 和业务插件共同消费的纯包，依赖在该包声明；不让 runtime 从 Electron 服务或用户 root node_modules 偷借依赖。

必核入口：[plugin bundler](../../scripts/bundle-openclaw-plugins.mjs:41)、[runtime bundler](../../scripts/bundle-openclaw-runtime.mjs:184)、[plugin install](../../electron/utils/plugin-install.ts:480)、[electron-builder](../../electron-builder.yml:16)、`scripts/after-pack.cjs`。

### 10.4 兼容与退出

- 插件／SDK contract 单独版本化；不要只根据 OpenClaw 大版本猜接口可用。
- 首轮仅声明 source runtime 路线；其他 runtime 未提供受管 seam 时不暴露 mutation。
- 升级前备份受管状态，schema 迁移由单一 owner 执行；未知新版本只读／拒绝编辑，不静默降级解析。
- 禁用插件后停止新修改，保留源文件、已有导出与必要只读历史；卸载不自动删除用户产物。
- 删除会话不自动删除业务产物；跨会话访问仍按 workspace 权限，而不是凭 artifactId 全局读取。
- 移动／复制源、导出备份再恢复时明确身份语义：复制默认新身份；迁移保身份需由 owner 验证，不能只靠文件同名。
- 首版不自动清理历史／旧输出。加入 GC 前必须定义引用保护、容量和用户数据保留策略。

---

## 11. 顺序工作包与出口条件

以下 W 编号只是本文工作包，**不是已创建 TF 节点**。进入实施后挂到 Task Forest 合适父节点，一次推进一个 ready 工作包，不与 TF-0013／COMPASS 收敛混改。

| 包 | 工作 | 依赖 | 必须看到的出口 |
|---|---|---|---|
| W0 有限采用约定 | 固定两个消费者、格式／操作集、权限边界、预算、引擎对照、退出条件；记录有限维护决定 | 设计接受；涉及冻结调整单独授权 | 可执行契约夹具／反例清单，明确不恢复独立产品线 |
| W1 提交能力 spike | 选现有 owner、绑定当前 run、权限负例、单文件候选、journal/DB 故障注入；TS 候选足够 | W0 | 真 runtime tool 调用成功；readonly/deny/cancel/conflict 拒绝正确；写后崩溃可对账 |
| W2 统一协调与持久版本 | 合并相关路径协调语义、不可变快照、非淘汰 metadata、操作幂等、恢复为新版本 | W1 | 普通 edit/patch 与新提交不互相丢更新；重启后版本／源／操作状态一致 |
| W3 VerseConf 消费包 | 新 JSON 内存 API、null、批次、重复键、标准 schema、worker、锁定构建 | W1 接口固定 | 同一契约测试通过；不靠旧 wrapper 的 schema 缺省绕过 |
| W4 研究表最小闭环 | create/import → inspect → revise → commit → Markdown/XLSX → 内容读回；最小 UI/history | W2+W3 | 真 run 与 Electron 路径贯通；冲突／渲染失败／重启都有落盘证据，即 L1 |
| W5 业务操作补齐 | insert/remove/move、历史恢复、外部变更协调、复制身份、输入安全 | W4 | 记录身份不随排序改变，拒绝不误写，不偷换保真承诺 |
| W6 第二消费者 | slide schema/mapper/PPTX、内容＋视觉检查 | W5 | 不重写权限／提交／metadata 即可复用；两个场景完整行为通过 |
| W7 分发与采用裁决 | 干净安装、packaged smoke、目标平台、升级／禁用、性能与维护对照 | W6；构建 smoke 前置穿插各包 | 声明平台上 L2 成立；给出采用 VerseConf 或停止特定投入的证据 |

W3 可先做只读探针，但正式改冻结源码须在有限维护决定之后。W7 的小型包完整性检查应前移，不能到所有 UI 写完才发现 wasm 无法分发。

### 每个工作包的原则

- 先固化可观察失败，再实现，不以文档列表替代可运行验收。
- 宿主公共 seam 不包含研究表／VerseConf 专用业务条件。
- 第二消费者若要求重写整套通用层，暂停扩场景，说明共享抽象失败点。
- 安全、恢复、打包三个否决项任一无法成立，不靠放宽权限／删反例继续。
- 不给当前未知范围硬报总工期。先 W1 度量实际改动和依赖，再估后续成本；每包有独立出口，避免无限补平台。

---

## 12. 验收设计：证明完整任务，不只证明库函数

### 12.1 验收矩阵

| 类别 | 最少用例 | 核验方式 |
|---|---|---|
| 值与 schema | null/absent、空值、嵌套、边界整数、未知字段／draft／外部 ref | Rust/TS/wasm 同契约；独立预期值 |
| 选择与批次 | 重复键/ID、中文/转义键、重复目标、父子重叠、中间非法最终合法 | 独立比较目标和非目标 bytes，不用引擎返回 span 自证 |
| 权限 | readonly、插件 deny、文件效果 deny、外部来源、路径逃逸、junction、workspace 切换 | 真 run 经过策略；拒绝后源／输出 digest 不变 |
| 生命周期 | create/import、无变化、修订、重试、恢复、历史分页、跨会话 | 从磁盘／DB读事实，非只读 UI 状态 |
| 并发 | 两次修订同基线、普通 edit/patch 竞争、取消排队、渲染乱序 | 冲突或有序提交，无丢失更新、无死锁 |
| 崩溃 | prepared 后、写后记账前、输出写后引用前、DB busy/full、快照失败 | 重启自动对账；未知效果不重放；旧有效输出保留 |
| 输出 | Markdown 转义、公式样式文本、null 映射、XLSX 实值、PPTX 页序/文本/布局 | 独立内容 oracle；视觉 agent 证据分开 |
| UI/history | 源变了输出旧、invalid/checker error、缺依赖、事件乱序、断线重载 | Electron E2E 操作真实 host-api 路径 |
| 分发 | 无开发目录、无用户 node_modules、wasm 缺失／错版、isolated config、禁用撤销 | 干净安装＋包内真实调用 |
| 升级与保留 | schema 升级、未知版本、禁用、删除会话、复制导入、容量到顶 | 不丢唯一历史、不冒认旧身份、不自动删用户源 |

### 12.2 模型验证分三层

1. **确定性契约层**：不调用模型，直接测试候选、版本、权限和恢复。
2. **真实执行链层**：脚本化模型响应驱动真实 runtime 工具、Gateway、Electron；如实标为 scripted-provider，不声称真实模型泛化。
3. **有限真实模型层**：在单独明确端点和调用预算后，测自然语言修订、选记录、冲突后的重新读取、渲染失败解释；证据标记 actual-provider 与 agent actor。

所有点击、数据构造、视觉与 verdict 由脚本／agent 执行；不把“等真人”写成阻塞项。付费调用与预算另行明确，不从现有报告里复用凭据。

### 12.3 工程门的选择

实施前新增窄 harness task spec，关联 [gateway-backend-communication](../../harness/specs/scenarios/gateway-backend-communication.md:1)，先运行 harness context，再实施。

- 领域单测：值、选择、schema、mapper、版本状态机。
- runtime 定向集成：实际插件工具装配／策略、提交 owner、journal／DB、重启。
- Electron：研究表完整闭环、旧版输出、恢复、权限与 capability 状态。
- 契约／静态：`contract:check`、`i18n:lint`、未缓存 typecheck、定向 lint、相邻历史投影测试。
- 通信改动：`comms:replay` 与 `comms:compare`；不能刷新 baseline 掩盖回归。
- SDK／worker／依赖／打包改动：runtime build、Vite/Main build、包内 smoke，不能只跑前端。
- 四语 i18n，三语 README 和场景／规则同变更集更新。
- 开发按改动面验证；发布阶段使用当时批准的候选验收流程，不为每个小包自动触发全量 RC，也不拿 fast 通过替代发布验收。

[旧 chat-work-provider-v1](../../harness/specs/tasks/chat-work-provider-v1.md:30) 仍含 Work Mode／Main-owned Office 的历史口径。新增运行时产物消费路径时应明确新的 owner 范围并同步现行 spec，不能机械复制旧场景当作新验收。

### 12.4 每包证据至少记录

`source SHA + dirty 状态／受测文件 hash + 测试命令和 exit + 运行环境 + manifest + 实际源/输出摘要 + operation/revision/output 引用 + actor + driven_by`。

失败也保留。验收从磁盘读取产物并核对，不凭命令打印一句 pass。旧结果不得重新签成新候选通过；未运行平台、未完成视觉、脚本化模型都明确列为证据范围。

---

## 13. 工程取舍：怎样判断 VerseConf 是否值得保留

### 13.1 两种对照回答不同问题

- **现有 read/edit/write 工作流 vs 新业务工作流**：衡量整个宿主能力升级是否改善任务完成。
- **同一新业务契约下 TS 薄引擎 vs VerseConf**：衡量引入 Rust/wasm 内核的增量价值。

不能拿 VerseConf＋新权限／UI 的完整方案与裸 string replace 比，就把全部收益归给 VerseConf。两引擎必须使用相同 schema、操作集、权限、数据与独立 oracle。

### 13.2 指标

- 端到端任务正确完成率，所有拒绝／模型失败／超时留在分母。
- 非目标内容误改、选错记录、静默舍入、错误成功声明。
- 合法候选误拒、拒绝后恢复轮次与最终完成率。
- 冷加载、热调用、完整任务延迟、RSS、产物体积和打包增量。
- 新依赖、跨语言构建步骤、契约维护面、平台失败和工程改动成本。
- 保真收益单独统计；严格 JSON 重序列化就能满足的场景，不能预先假定 VerseConf 更有价值。

先固定 workload、容量、结果谓词和可接受成本再测。小样本是方向证据，不写未经支撑的显著性或省 token 百分比。

### 13.3 退出条件

出现下列任一情况即暂停该路线：

- 必须绕过当前权限或新建 runtime→Main 私有后门才能完成写入。
- 需要先做通用产物平台／全面 journal 迁移才能支持第一场景。
- 最小值／批次／schema 契约无法一致，或者包内运行依赖开发机环境。
- 失败恢复无法区分未发生／已发生／未知，却仍要求展示完成。
- 同等能力 TS 明显更简单，VerseConf 没有足够保真、复用或正确性收益。

停止引擎采用不等于删除用户源和已有输出；业务格式与宿主契约应独立于 VerseConf 品牌／私有 AST。

---

## 14. 后续若接管 ClawX 配置编辑，必须另设阶段

VerseConf 的配置编辑出身，不意味着应优先让它改 `openclaw.json`。

配置闭环是：读取实际生效配置 → 选择官方／owner schema → 生成候选 → 由现有配置 owner 提交 → 必要重载／重启 → 读取有效配置并验证真实行为 → 失败由同 owner 恢复。

与业务产物不同：

- 配置可能包含 SecretRef／凭据，不能把完整敏感文档送模型或写普通产物历史。
- source runtime 的隔离同步和启动变换可能覆盖局部写入；不能同时直接改两份配置。
- `agents/models/plugins/runtime/tools/channels` 不同 owner 的生效语义不等于文件语法通过。
- 变更插件总开关、sandbox、权限、provider、default-on 等可能触及产品锁或重大决策。
- YAML 不在当前 VerseConf 格式承诺内；不能把 JSON 能力外推到 task forest／harness 全部文件。

因此 L2 后最多先做选定非敏感配置的只读诊断／候选预览；真正提交另立 spec 和 owner 接口。它不是本次“完整产物接入”的隐藏前置，也不能偷渡成全局配置安全门禁。

---

## 15. 建议下一步

**下一步只推进 W0/W1 的有界设计与提交 spike，不先写完整 Artifact 平台，也不先注册五个 MCP 工具。**

最小演示目标：一份 3 条记录的研究源，真实 run 读取 revision，联合修改两字段，受管提交，导出 Markdown/XLSX，独立读回；随后依次跑 readonly、版本冲突、提交前取消、渲染失败、提交后重启五类反例。

这条链路通过后，再补 VerseConf 消费包和持久 UI 的完整实现；机制探针中使用 TS 候选不计为 VerseConf 集成完成。实施涉及 VerseConf 冻结源码前，记录消费者专用的有限维护授权；不把本次调研请求解释为解除独立产品线冻结。

**最终判断：可行，但它是“现有宿主能力补齐＋窄编辑内核接入”，不是安装一个库。正确顺序是先提交与权限，再源／版本／恢复，再业务导出与 UI，最后用第二消费者、干净分发和对照证明值得采用。**
