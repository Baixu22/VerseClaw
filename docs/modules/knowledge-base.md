# 项目知识库

> 面向问题：知识库现在只是 Wiki 搜索，还是完整治理面？Agent 能不能直接改知识？Source Set、Runtime Lessons、SEKB、OKF、Watched Directories 和 Knowledge Bot 分别做什么？

## 1. 产品定位

Verse Claw 的 Knowledge 是本地 Markdown/wiki-first 的受治理项目知识控制面，不是 Obsidian/NotebookLM clone，也不是无条件自动写回的 RAG 平台。

核心原则：

- 知识可检索、可引用、可起草、可评审；
- Agent 可以读取和提出候选，但不能静默写持久知识；
- 读取 scope 与写入 authority 分开；
- 每次持久化变更有 provenance、review 和 receipt；
- SEKB 是知识候选/经验来源，不是第二套知识库；
- Memory 不是 Knowledge，Task Ledger Working Context 也不是 Knowledge。

用户入口：`/knowledge`。

长期检索目标按 [Project RAG ADR v2](../dev/adr/2026-11-09-project-rag-retrieval-plane.md) 和[完整工作包](../dev/project-rag/WORK-PACKAGES.md)实施，覆盖持久混合检索、重排、多来源、Research、交互、索引运维与独立验收。当前处于规划与分阶段开发，以下章节仍描述已有 page/snippet 行为。

Chat Preflight 已使用统一的 owner 检索计划：FTS / dense 按 lane rank 做 RRF，显式 SourceRef 精确复读，候选记录原始分数、贡献和退化原因。SourceSet 保留检索次序，Preflight 展示来源和匹配原因，停止用检索分数生成百分比 confidence。接口与期限见[检索计划合同](../dev/project-rag/RETRIEVAL-PLAN-CONTRACT.md)。

## 2. 页面分区

`src/pages/Knowledge/index.tsx` 当前有两个主入口：**Library** 和 **Review Queue**。
Inbox、Drafts、Review、Runtime Lessons 和 Governance 是按需打开的内部工作视图，
不是七个平级主入口；以 `PRIMARY_WORKBENCH_TABS` 和实际导航为准。

此外有：

- OKF import/validation utility；
- status / sources utility；
- Source Set Studio；
- Knowledge Bot 浮动对话；
- search/preview/editor。

页面相关的源：

- `src/pages/Knowledge/index.tsx`
- `KnowledgeLibrary.tsx`
- `KnowledgeReviewQueue.tsx`
- `KnowledgeRuntimeLessons.tsx`
- `KnowledgeGovernance.tsx`
- `KnowledgeSourceSetStudio.tsx`
- `KnowledgeUtilityPanel.tsx`
- `KnowledgeAssistant.tsx`
- `src/components/knowledge-bot/`

## 3. 持久写入链

标准治理链：

```text
Chat / user / agent output / file / task
  -> Knowledge Inbox
  -> Draft
  -> Steward / review
  -> Change Proposal
  -> explicit apply
  -> memory-wiki durable page
  -> provenance + audit + receipt
```

### Inbox

Inbox 用于承接：

- 用户保存的材料；
- agent 生成的经验候选；
- watched directory 的新文件；
- 任务后知识候选；
- 需要 triage 的 source。

Inbox item 可以有了分类、质量评分、来源、重复/冲突、review 要求等 metadata。进入 Inbox 不等于成为 durable knowledge。

### Draft

Draft 是可编辑中间态：

- 类型；
- 标题/正文；
- source refs；
- reviewer/steward；
- 状态和 revision；
- 来源与 confidence。

Draft 可以进入 `draft / steward_reviewed / approved` 等状态，但 approved draft 不是最终 Wiki page。

### Proposal 与 apply

Proposal 描述受治理 mutation：

- create / update / delete 等 operation；
- target page；
- expected revision/digest；
- owner；
- reviewed change；
- operation journal；
- compensation/rollback boundary。

`wiki_apply` 对普通 agent 默认不注册；需要显式配置 `tools.allowAgentApply` 才会暴露。即便如此，持久写入仍必须走既有 review 和 apply 边界。

### Provenance 与 audit

- `recordKnowledgeReference` 记录搜索/引用；
- `getProvenance` 读取来源；
- `listGovernanceReceipts` 读取 receipt；
- `governanceAudit` 汇总治理状态；
- 知识目录内 audit log 记录操作；
- `openclaw-state` SQLite 持久化 governance proposal/event 与 operation journal。

历史计划中曾有 JSON-only metadata；当前 ADR 与实现已经转向同一 `openclaw-state` SQLite 的 governance 表，并明确拒绝 legacy JSON dual-write。Draft/Inbox 的记录仍可由文件型 compatibility layer 读取，但 durable governance authority 是 GovernanceStore。

## 4. 存储与依赖

### Wiki

`memory-wiki` OpenClaw plugin 拥有 Wiki page。默认配置形态是：

- `vaultMode: isolated`
- shared search backend
- corpus `wiki`

Knowledge 页面本身可在 plugin 未加载时打开，但 status/search/apply 会返回 `unknown method: wiki.status` 一类错误。Gateway 就绪不等于 `memory-wiki` loaded。

### Knowledge metadata

当前本地 knowledge 目录包含：

- `drafts/`
- `inbox/`
- `proposals/`
- `provenance/`
- `source-sets/`
- `okf/bundles/`
- `audit.jsonl`

目录根在 OpenClaw config dir 下。

### Governance SQLite

`openclaw_runtime/src/knowledge/governance-store.ts` 在 `openclaw-state` 数据库中使用：

- `knowledge_governance_proposals`
- `knowledge_governance_events`

并通过 operation journal 支持 unknown outcome 的恢复/重试和重复请求识别。

没有新增独立知识数据库服务。

## 5. Library 与检索

Host API：

- `knowledge.status`
- `knowledge.init`
- `knowledge.configure`
- `knowledge.ingestFiles`
- `knowledge.search`
- `knowledge.get`
- `knowledge.compile`
- `knowledge.lint`
- `knowledge.openVault`
- `knowledge.validateOkfBundle`
- `knowledge.importOkfBundle`

Library 支持：

- 搜索；
- 打开 page；
- Markdown edit/preview/split；
- 按类型筛选；
- source/result preview；
- 从搜索结果创建 draft；
- compile/lint；
- OKF bundle 验证和导入；
- 打开 vault。

检索结果不一定自动进入模型 prompt。Chat 的 knowledge scope、invocation mode 和 explicit refs 决定“候选是否参与本轮”。

## 6. Chat 与 Knowledge 的交互

`chat.sendWithMedia` 支持：

### knowledgeScope

- `none`
- `memory`
- `wiki`
- `all`

Memory、Wiki、All 是读取范围，不是写入权限。

### knowledgeMode

- `manual`
- `suggest`
- `auto-read`

### explicit references

Renderer 传入的 refs 被视作不受信任的 retrieval intent；Main 只转发 typed refs，由 runtime owner adapters 真正物化内容与权限。

### routeContext

`knowledge.routeContext` 可以 best-effort 给出：

- 相关 docs；
- pitfalls/rules；
- source snippets；
- role/user/project relevance；
- runtime lessons（显式开启时）。

失败不阻断 Chat。Suggest 候选不会自动变成隐藏系统指令。

### Knowledge Chat

`/?knowledge=ask` 打开专用 Knowledge Chat。

## 7. Source Set Studio

Source Set 是一组可复用的来源集合，不只是临时搜索结果。

Host API：

- `listSourceSets`
- `saveSourceSet`
- `deleteSourceSet`
- `answerFromSourceSet`
- `createArtifactDraft`

回答流程：

1. 读取选中来源及 owner 提供的状态、revision、摘要、权限、敏感性、scope 和新鲜度；
2. 词法与可选语义分支共用现有 SourceSet 准入，选择来源不覆盖 owner 政策；
3. 校验可选 revision/digest 钉选，保留来源排序与 semantic lane 诊断；
4. 返回带 owner、canonical subject、revision、读取内容摘要和读取范围的引用，披露拒绝原因、已提供的结构化冲突和截断；
5. Librarian 请求 `synthesis=true` 后通过 Gateway model-only 路径综合证据；每项回答必须绑定来源 ID 和原文子串，无效引用拒绝并降级为摘录；
6. 只有存在已准入来源时才创建 Studio draft；草稿只绑定已准入引用，保留读取证据，持久应用仍走已有审阅与 apply。

所有来源被拒绝或 embedding 失败时，不把原始来源回填成证据。未提供 owner
新鲜度的来源标为未知；旧 Wiki 响应未显式给出状态时保留 active-vault 兼容行为，
缺省 trust 为 advisory，缺少 revision 时绑定读取内容摘要。

追问最多保留 8 轮、总计 8000 字符，每轮最多 2000 字符；历史只能解释指代，不能
充当事实证据。模型会话使用独立随机 ID，不提供工具、投递或 apply 权限。结构化
冲突阻止综合；模型失败显示原因并保留 partial 摘录。原文存在和版本绑定核验不等于
通用语义蕴含证明；无结构矛盾仍依赖模型判断。未提供 synthesis 的调用和 Studio
继续使用摘录模式，不显示未经测量的数值置信度。

中文词法复用 CJK bigram；续读每次 80 行，最多 800 行/96000 字符，选择问题最相关
的窗口，保留实际行号和截断信息。每次续读必须绑定相同 owner 版本/新鲜度、状态和
权限；缺少版本信息或显式摘要钉选时不继续。版本/权限变化拒绝整次读取，不拼接
不一致快照。SourceSet 报告仍最多 20 个来源。embedding 缓存每个会话最多 256 个向量，按
workspace、credential generation、模型空间、输入类型与来源 pin 隔离。缓存前后均复核 owner 准入。

语义检索：

- 设置 > 模型与服务选择本地 EmbeddingGemma 768 维，或 registry 配置的远端 Qwen VL 4096 维服务；
- 选择保存在 SQLite，提供安装、校验、warmup、取消、重试和禁用；远端默认 SiliconFlow `Qwen/Qwen3-VL-Embedding-8B`；
- 只有显式请求且 provider 可用时才走 semantic lane；
- 没有 provider 或调用失败时保留 lexical fallback；
- semantic lane 状态必须显式返回，不能把 fallback 说成向量检索成功。

输入格式、tokenizer、凭据及恢复约定见[embedding 生命周期](../dev/project-rag/EMBEDDING-LIFECYCLE-CONTRACT.md)。

设置中的“项目向量索引”可显式构建 SQLite 精确检索或库级 LanceDB ANN。索引跟随当前合格片段增量更新，来源撤销立即取消查询资格，引用仍经 owner 按 pin 复读。generation 发布、后端切换、重启和容量约定见[向量后端合同](../dev/project-rag/VECTOR-BACKEND-CONTRACT.md)。

## 8. OKF

OKF 是知识 bundle 的导入/兼容格式。

支持：

- validate bundle；
- import bundle；
- concept/page metadata；
- content digest 与 provenance；
- 导入后仍进入现有 Knowledge authority，而不是新建第二 Wiki。

OKF import 成功表示格式与导入链通过，不表示所有页面都已被模型使用或已被 agent 认可。

## 9. Runtime Lessons 与 SEKB

Runtime Lessons 的定位是“从真实任务错误/经验中形成可复用原则候选”。

内部 SEKB 数据域：

- trajectories；
- principles；
- bounded active L1 index；
- retrieval engine；
- capture/confirm/reject/effectiveness；
- shadow evaluation。

Host API 包括：

- `runtimeLessonsReport`
- `sekbSuggestPrinciples`
- `sekbBatchDistillSuggest`
- `sekbConfirmPrinciple`
- `sekbRejectSuggestion`
- `sekbCaptureTrajectory`
- `sekbRetrieveForTask`
- shadow evaluation export/protocol/report；
- error-experience match/effectiveness。

边界：

- SEKB automatic writeback **off**；
- SEKB master、shadow evaluation默认 false；
- runtime lessons 只有在显式 source policy/routeContext 请求时才参与候选；
- candidate 不是 accepted principle；
- confirm 是受治理 effect，不是 agent 自行写入静默生效；
- SEKB 不拥有 Memory store。

## 10. Watched Directories

Watched directory 支持：

- 递归监听；
- pattern 匹配；
- 150ms debounce、60 秒周期补扫；
- `ingestNewFiles`；
- `requiresReview`；
- 事件日志；
- 启动时恢复 enabled watchers。

启动按来源隔离扫描失败：一个目录或 connector 失败后继续启动后续来源。已建立的目录 watcher 和周期补扫保留，修正来源内容后可再次捕获；扫描错误记录在该来源事件中。

重要实现限制：

- 新文件只会创建一个 **review-gated Inbox item**；
- 不直接写正式 Wiki；
- `autoCompile=true` 也只记录 skipped 事件，必须等 review/apply；
- 新增、修改与删除均有稳定来源 ID 和内容版本；删除生成待审撤销候选；
- 启动全量快照补偿停机事件，成功捕获才推进持久游标；部分扫描不推断删除；
- 持久 transition sequence 区分重复编辑和删除后恢复，同内容再次出现仍生成新一轮候选；
- 跳过 symlink/binary，最多 1000 entries、每文件 2 MiB、每轮 16 MiB；
- watcher 失败不会 crash app，但应通过事件/诊断暴露。

## 11. Steward 与 Review Queue

Steward 是质量/治理角色，不是最终自动 apply authority。

默认 heuristic 不变；显式 semantic 角色按有效 `reviewFocus` 搜索并读取准入原文，
输入包含草稿 revision/digest 和来源版本/摘要。结构化 findings 提供 kind、severity、
原文引用及未核实原因。duplicate/conflict 必须同时引用草稿与来源，才可标记引用
核验通过；这仍不是语义蕴含保证。仅有模型自由警告或引用不符的发现明确 unverified。
审阅结果保存在原草稿 metadata；模型运行期间草稿被编辑、删除或应用时，旧结果
拒绝覆盖。模型失败保留规则结果并记录原因，不升级 apply 权限。

可检查：

- classification；
- duplicates；
- freshness；
- conflicts；
- source coverage；
- merge/archive 建议；
- triage priority；
- missing evidence。

Review Queue 把 Inbox、Draft、Proposal 中需要动作的项目投影到统一队列。

Agent-driven review 可以作为自动等价路径，但产物必须明确：

- `driven_by: agent`
- `actor: <agent-name>`

不得声称 real-human evidence。

### 公共 GitHub 持续来源

Main Host API 提供 `listSourceConnectors`、`upsertSourceConnector`、
`syncSourceConnector`、`removeSourceConnector`；renderer facade 为
`hostApi.knowledge` 的同名方法。配置仅持久在本机 `source-connectors.json`：

```json
{"id":"project-docs","kind":"github-public-directory","owner":"openai","repo":"openai-python","ref":"main","path":"README.md","enabled":true,"intervalSeconds":300}
```

入口是单文件或非递归公共目录，支持 `.md`/`.markdown`/`.txt`。固定访问
`https://api.github.com`，不接受任意 URL、凭据或重定向。最多 100 entries、每文件
256 KiB、总计 4 MiB；超预算扫描失败，不推断删除。稳定 ID 绑定 owner/repo/ref/path，
Git blob SHA 校验正文完整性。每版本变化进入既有待审 Inbox；删除或 public→private/
404 生成撤销/访问权丢失候选（不包含旧正文），ACL 元数据变为空。HTTP 403/429/5xx
保留上个游标，不当作删除；指数退避和服务器 retry 信息保存在 receipt。每次成功
捕获才写游标，重启重扫；lastSuccessAt/observedAt/retryAt 可回读。停用/移除只停止
连接，不直接删除已审定知识。需要撤销已采纳知识时仍由审阅/提案/apply 处理。

这不是私有 GitHub ACL 或任意企业 SaaS 同步。没有实现 Notion/Drive/Confluence
连接器、递归全仓抓取或 webhooks；当前公共目录轮询是交付的唯一外部持续入口。

### 可复算效果评测

配置已授权的 `CLAWX_SPACE_BUNNY_API_KEY` 后执行
`node scripts/run-knowledge-quality-eval.mjs D:/tmp/knowledge-quality-eval`。
固定 14 样例覆盖中英、长文、结构化冲突、陈旧/撤销/权限/secret 拒绝、来源指令诱导
和追问；每样例保留输入、读取范围、拒绝、模型原文输出与 token usage。指标采用
固定答案命中和严格拒答形状，不能外推总体正确率。旧首 80 行/240 字符摘录是配对
基线，直接 provider 实测与 Gateway 接线证据分开报告；模型真实底层身份和金额未测。

## 12. Knowledge Bot

Knowledge Bot 是 Knowledge 页的浮动对话入口：

- 点击头像打开 compact conversation；
- 最小化回 assistant；
- 拖拽受 dock 边界约束；
- session state 持久化；
- Markdown 复用主 Chat renderer；
- 头像状态跟随真实 retrieval/read/draft/review 请求。

它是 Knowledge 的辅助 UI，不是新的知识 store、审批人或自动 apply 机制。

## 13. Knowledge Governance

治理面应回答：

- 来源是什么；
- 证据是什么；
- 谁/哪个 agent 审阅；
- 何时最后验证；
- 是否被引用/使用；
- 是否过期、重复、冲突或被替代；
- apply 是否有 receipt；
- 失败/unknown outcome 是否能重试；
- 是否发生未授权写。

质量指标包括：

- stale cards；
- duplicate clusters；
- source gaps；
- unreferenced pages；
- low-confidence high-hit cards；
- high-dismissal cards。

这些指标是诊断，不是自动改写许可。

## 14. 默认值、证据与限制

当前默认：

- `memory-wiki` 需要显式启用并初始化；
- SEKB master off；
- SEKB auto writeback off；
- SEKB shadow evaluation off；
- ordinary agent `wiki_apply` 默认不注册；
- Source Set semantic lane 默认不保证可用；
- Runtime Memory 与 Knowledge 不互相代替；
- Image/Dreams 等与 Knowledge 不同边界。

证据边界：

- Knowledge 的 KS-00..KS-09 历史程序证据、Electron E2E、SourceSet 单测和 SEKB 测试只覆盖各自输入集；
- E4/E5 只有在对应真实任务/soak/live-provider 证据存在时才可声明；
- 2026-10 的 closeout 仍有明确的 provider、packaged install、跨平台和 full-exhaustive 限制；
- 不需要真人作为阻塞条件，但 agent 驱动结果不能标记成 real-human；
- 产品发布、GA 和默认写回仍未获批。

## 15. 当前缺口

- `memory-wiki` 未加载时页面可打开但核心操作不可用。
- 不是 Obsidian/NotebookLM 全功能替代品。
- 语义检索依赖可用 embedding provider；fallback 不等于 semantic 成功。
- 自动捕捉只到 Inbox，正式写入仍需 review/apply。
- SEKB 自动学习/写回不默认开启。
- Governance 重点在本地单机，不是多租户企业权限系统。
- 引用数量、结果质量和“模型回答正确”不是同一证据。
- E4/E5 或产品有用性不能从单测数量外推。
- 仍需真实的长期知识质量、冲突处理和跨平台 UI 验收。

## 16. 关键 API

`knowledge.*` 当前暴露约 56 个 Host 动作，按领域分为：

- Library / search / get / compile / lint；
- Inbox；
- Drafts；
- Proposals / reviewed change；
- Steward；
- Source Sets；
- Runtime Lessons / SEKB；
- Provenance / Governance；
- Watched Directories。

完整方法名以 `src/lib/host-api/knowledge/` 与 `shared/host-api/contract.ts` 为准。

## 17. 源码索引

- `src/pages/Knowledge/`
- `src/lib/host-api/knowledge/`
- `src/components/knowledge-bot/`
- `electron/services/knowledge-api.ts`
- `electron/services/knowledge-embedding-provider.ts`
- `openclaw_runtime/src/knowledge/`
- `openclaw_runtime/src/knowledge/sekb/`
- `openclaw_runtime/src/knowledge/governance-store.ts`
- `openclaw_runtime/src/knowledge/governance-adapters.ts`
- `shared/host-api/contract.ts`
- `docs/enhancements/knowledge-persistence/`
- `docs/dev/knowledge-system-unification/`
- `docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md`

延伸阅读：[产品语义](../clawx-product-semantics.md)、[运行时控制平面](../dev/runtime-control-planes.md)、[默认配置矩阵](../dev/default-config-matrix.md)。
