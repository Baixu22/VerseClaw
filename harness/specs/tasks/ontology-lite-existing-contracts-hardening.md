---
id: ontology-lite-existing-contracts-hardening
lifecycleStatus: active
title: 现有语义合同的来源、约束、版本与门禁收敛
type: task
intent: 在现有产品语义、身份、Task Ledger、Context Family 和权限合同上补齐可执行约束与可追溯证据，提升规整程度和可控性，不新增产品功能、模块、运行时或第二真源。本轮只完成调研和任务拆解，后续按四个串行节点实施。
touchedAreas:
  - shared/product-semantics.ts
  - tests/unit/product-semantics.test.ts
  - scripts/check-evidence-refs.mjs
  - scripts/check-evidence-refs.d.mts
  - tests/unit/evidence-refs-exist.test.ts
  - docs/clawx-product-semantics.md
  - harness/specs/tasks/ontology-informed-product-semantics.md
  - harness/specs/guides/ontology-agent-systems-research.md
  - harness/specs/tasks/ontology-lite-existing-contracts-hardening.md
  - harness/specs/guides/ontology-lite-existing-contracts-research.md
  - harness/specs/fixtures/ontology-lite-existing-contracts/**
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - identity-scope-boundary
  - context-family-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md
  - pnpm harness validate --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md
  - pnpm harness run --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md --dry-run
  - pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts tests/unit/identity-scope.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/task-ledger-reference-inheritance.test.ts tests/unit/permission-effect-contract.test.ts --maxWorkers=1
  - pnpm repo:evidence:check
  - pnpm repo:artifacts:check
  - pnpm harness:specs:lifecycle
  - pnpm docs:policy:validate
  - pnpm run typecheck
  - git diff --check
acceptance:
  - 六条既有关系有逐条来源、实际 owner、已有消费者与回归入口映射；无法从执行路径证实的项目如实标成 documented-only 或 gap。
  - 独立正负 fixture 经过同一个确定性检查入口；错误组合、反向任务权威和语义元数据冒充授权均被定位并拒绝，而非只检查正确常量。
  - 合同版本、关系派生键、来源摘要、candidate commit/tree、实际 actor、命令与退出码可回读；陈旧来源、不支持的版本、越界或未跟踪引用不能被冒充为当前候选的有效证据。
  - 检查接入已有 Harness/Vitest/evidence 路径，且门禁集成负例证明遗漏调用、空报告或坏例不能产生有效 pass。
  - 现有六条关系、身份兼容映射、单向字段继承及最终权限 owner 保持原行为；不存在新的关系值消费路径、prompt、routing、tool、approval、storage 或 UI 行为。
  - 产品语义与三份 README 完成声明复核；没有新增企业本体、SHACL/PROV 合规实现、任务收益、采用率或 GA 声明。
  - 每个实施节点以新干净候选、磁盘回读、哈希清单、凭据扫描和明确限制完成收口；不改历史候选或 verdict，不以 --no-diff 结构通过代替实现验收。
nonGoals:
  - RDF/OWL/SHACL/Cedar 运行时、图数据库、知识图谱存储、推理、遍历、查询服务或本体 prompt 注入。
  - 新产品概念、功能页、Host API、工具、subject adapter、suite runner、评分模块、状态机、ID 服务或版本数据库。
  - 替代 Task Ledger、Workboard、Runtime、Context Family、Memory、Knowledge、现有审批或 write journal 的权威。
  - 改产品锁、默认开关、发布状态、liveReady、productApproved 或自动授权。
  - 人工操作、真人数据、真人 verdict 的前置要求，或任何 real-human 声称。
docs:
  required: true
  files:
    - harness/specs/guides/ontology-lite-existing-contracts-research.md
---

# 现有语义合同治理实施合同

## 当前阶段与入口

研究与 Task Forest 拆解可以先交付。本合同的新增校验、来源绑定和门禁集成尚未
实现，不能因方案落盘或旧 focused tests 通过而标成新增能力已通过。
四步串行执行，每次只推进一个 ready leaf；Task Forest 为本地进度源，源码合同
和精选证据不依赖本地任务图或会话日志。研究方法与来源见同目录配套 guide。

## 不可改写的既有语义

1. `PRODUCT_SEMANTIC_CONCEPTS` / `PRODUCT_SEMANTIC_RELATIONS` 仍为原载体。
   关系键从现有 `from / kind / to` 派生。禁止复制成第二份可写 registry。
2. Task Ledger 拥有用户任务事实；Task Loop 拥有其执行状态。运行成功、turn
   完成和任务完成不互相推导。Workboard 只作单向引用，继承表继续由原文件拥有。
3. Workspace 与 Project 不能混作身份，但现有 owner 解析的兼容投影合法；不能
   因字节相等拒绝该既有映射，也不能据相等字节推断权限或创建 Project store。
4. Context Family 和 Prompt 都不能替代原事实源。这里只做来源交叉引用，不把
   ContextItem、ArchiveHandle、Memory 或 Knowledge 强行加入产品概念表。
5. `PermissionEffectContract`、workspace policy、approval ledger 及执行 owner
   继续完成最终授权。通过语义检查或拥有某条关系不会建立 grant 或执行副作用。
6. `unknown / unavailable / invalid / not-run` 必须保持区别；没有观测到的成功
   不得填成 pass。研究报告只证明静态观察与来源阅读。

## 步骤一：来源、owner 与消费者核对

交付在现有 fixture/evidence 路径下的一份小型来源清单。每条关系记录派生键、
文档依据、实际 owner 引用、既有消费者、验证入口和证据等级。
文档路径不能自动充当 enforcing owner，存在的文件也不能自动证明当前能力。

先保全原始五个未提交文件的 working/staged 字节及 diff（如有 staged 字节），
核对它们仍对应既有工作，再在实施候选中收录应保留的源码。没有权限删除或
重置别的工作树、未跟踪文件、产品锁或历史证据。
对旧完成记录补充一次新的回读；不更改其原 candidate/verdict。

验收要点：

- 6/6 关系完成逐条映射；缺执行证据时有明确等级或 gap。
- 对 `src/`、`electron/`、Runtime、shared、scripts、tests 的值引用检索可复现。
- 身份兼容、Task Ledger 单向引用、权限 owner 与 Context Family 的来源可回读。
- 原始文件保全有逐字节哈希；新的来源清单绑定干净实施候选，不借旧日志替代。

## 步骤二：最小确定性约束与独立负例

优先在现有语义源文件中补充小型纯函数检查，在现有语义单测中校准。
输入是待验证的元数据；它不接入实际运行时准入、执行、prompt 或授权。
复用已有惯例，不新建通用本体框架或 schema compiler。

有效 fixture 保持现有六条关系、无 Plan Mode 关系、合法同 session 来源以及
既有身份兼容映射。负例独立于正确常量，至少覆盖下列规则：

| 负例 | 必须观察到的结果 |
|---|---|
| 未声明端点 / kind / authorityBoundary | 定位未知词汇，返回 invalid |
| 重复关系或自环 | 定位关系键与重复/自环规则 |
| 空或缺失证据依据 | 定位证据字段，不能填入默认“已验证” |
| 分别合法但相互不匹配的 kind、端点、权威边界 | 拒绝具体组合，不能仅检查 enum 成员 |
| Task Ledger→Workboard 的反向任务权威 | 拒绝镜像/调度权威升级 |
| 声明逆边、传递授权或伪造 grant 字段 | 不产生任何 grant；元数据检查拒绝越权含义 |
| 把跨 session / caller 自报 quality 当成同 session scorecard | 不能升级为 active authority |
| 将 Session 当 Workspace、Run 当 Task、run 成功当 task 完成 | 复用原身份与完成权威判据，不能建立推断 |

不重复实现上述 owner 的真实授权逻辑；检查的是合同一致性与 owner 证据引用。
没有实际 session receipt 的静态说明仍是 documented-only，不凭字段名字证实
真实运行是否同 session。若必须改变原 owner 的行为，先记录 gap 并另开适用
的受控任务；本合同不授权该变更。

验收要点：有效 fixture 无误拒绝；每类负例由相应规则拒绝，并有可定位诊断。
仅断言常量相等、仅断言 TypeScript 通过或一个泛化 error 不算这些规则的覆盖。

## 步骤三：合同版本、摘要与来源失效

采用现有 `…/v1` 合同与 Git 证据惯例。在现有证据检查器中产生派生报告，至少
包含 schema/contract version、关系派生键、source refs 和摘要、候选 commit/
tree、检查时间、实际 actor、命令、退出码、规则诊断和未验证项。
报告只引用原事实，不存储完整 prompt、token、密钥、任务状态镜像或审批副本。

复用 `check-evidence-refs.mjs` 的路径发现和原存在检查；增加的治理只针对本次
声明的语义证据。引用须在 repo-root 内解析，拒绝越界、符号链接逃逸，以及把
本地未跟踪文件伪装成干净候选源码。开发输入可有 dirty 标记，但不能借此满足
节点的 clean-candidate 收口条件。

复用 canonical evidence hash 工具并写明 CRLF/LF 规范化策略；需要恢复原字节
时另记原字节摘要。摘要算法、规范化政策和候选不匹配均使报告失效。
合同版本不支持时返回 invalid；不自动解释为最新版本，不自动迁移数据。

方向、端点、kind、权威含义变更必须单独标注语义不兼容性，并重验原消费者。
本次实施保持这些语义；只补来源、检查与派生证据。历史哈希、候选与 verdict
不被回写；新输入产生新报告。回滚撤回新检查和新证据接入，保留旧合同与调用链。

验收负例：来源删除/移动、越界、未跟踪或 symlink escape；source digest/
candidate/version 不匹配；报告缺字段、缺 actor 或缺实际检查结果。正例包含
跨平台文本规范化和原字节恢复摘要被正确区分。

## 步骤四：原门禁接入、兼容回归与证据收口

将校验接入已有 Vitest/Harness/`repo:evidence:check` 路径。
如果现有入口足以触发，不增加 package script。检查命令可输出到现有 fixture/
evidence 路径；不加服务、UI、动态工具或新的评测执行器。
Agent-first 只引用静态证据，不改框架核心、已密封矩阵或当前 not-run profile。

集成负例要通过真实门禁入口确认：错误关系、陈旧来源、空报告、遗漏执行检查
都会失败；不能只单测 checker 自己。既有证据路径检查继续通过且保留原覆盖。
每个测试构造自己的有界 fixture，不依赖开发者 Task Forest 历史或旧本机路径。

按本合同 requiredTests 运行最终候选检查，并定向 lint 变更的 TypeScript /
JavaScript。三份 README 与产品语义文档只更新实际改变的治理口径。
此次无用户交互变化，无新增 Electron 交互用例；若出现该变化即超出本合同。
同样，新增后端通信或真实 prompt/执行变更属于额外范围，不能以本合同绿灯
替代其 gateway spec、comms replay/compare 与相应验收。

用源引用、既有兼容 fixture 和 git diff 检查确认：关系常量没有新增产品值
消费者；身份映射、任务事实、字段继承、执行授权、prompt、storage、UI 与
默认值不变。全量 Harness CI / Electron / live provider 未运行时如实记
not-run；本次静态治理不能被提升为产品 GA 或发布批准。

精选最终证据包含新干净 candidate、source/contract 绑定、可复现门禁日志索引、
负例诊断、SHA256SUMS、实际凭据扫描和限制。由独立 artifact 校验进程重新读
文件及计算摘要；不得把同一份 checker 输出重命名为独立 agent verdict。
自动化步骤都标 `driven_by: agent` 和实际 actor，满足证据条件后自动 TF 收口。

## 本轮规划验证与后续实施验证

本轮只运行合同 context/正常 diff validate/dry-run、研究来源与保全回读、适用
文档/证据门禁及既有 focused baseline。完整 typecheck、新增负例与最终集成
属于实施节点要求；未运行即记 not-run。Harness dry-run 只检查所选流程，
不代表流程已执行；不把历史 `fast` profile 的名字当作低成本承诺。
