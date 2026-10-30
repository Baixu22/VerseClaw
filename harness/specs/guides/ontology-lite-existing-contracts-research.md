---
id: ontology-lite-existing-contracts-research
title: 本体论实践深化：让现有语义合同可校验、可追溯且兼容原生态
type: guide
appliesTo:
  - ontology-lite-existing-contracts-hardening
---

# 本体论实践深化：已有合同的治理

研究日期：2026-10-30，Asia/Shanghai。检索使用 VerseSearch → AnySearch：
一般检索寻找标准和官方文档，`code.doc` 查询已有校验库的做法，再抽取选定原文。
本指南是实施方案，不是新一轮运行时验收，也不证明任务成功率、成本或采用率改善。

## 推荐结论

继续把既有概念、关系、来源和权威边界变成可验证的合同。优先完成来源核对、
确定性负例、版本与摘要绑定、现有门禁接入。保留当前的类型、owner 和调用链，
不增加产品模块、运行时依赖、数据库或权限系统。

这里的“本体深化”只指语义约束更明确、变更更容易发现、证据更容易复现。
它不要求将所有业务类型搬进同一个顶层本体，也不要求每个概念都新增关系。

## 仓库证据与真实缺口

此次实际阅读了产品语义源文件及测试、身份和范围类型、Task Ledger 单向引用及
继承表、Permission Effect 合同、Context Family 边界、证据路径检查器、规范化
哈希工具、Agent-first 框架注册表、可持续开发手册与本地交接，并检索了三份
README 的产品边界入口。当前基础如下：

| 已有载体 | 已经负责什么 | 本轮发现的窄缺口 |
|---|---|---|
| `shared/product-semantics.ts` | 7 个产品概念、6 条有向关系、关系种类与权威边界 | 联合类型允许分别合法的字段组成错误组合；没有关系合同版本及来源失效绑定 |
| `tests/unit/product-semantics.test.ts` | 检查当前常量的端点、重复、自环、非空证据及单向引用 | 当前关系测试读的是正确常量；没有把独立错误输入交给校验器并验证拒绝原因 |
| `scripts/check-evidence-refs.mjs` | 已扫描语义源文件中的路径并检查文件存在 | 存在不证明路径归属、被跟踪、对应当前候选或真实支持这条关系 |
| `shared/types/identity-scope.ts` | Workspace / Project / Session / Run / Task 的既有语义 | 不需要新身份注册表；检查必须保留 Workspace→Project 的现有兼容投影 |
| `shared/types/task-ledger-reference.ts` | 单向引用、字段继承与任务事实所有权 | 不需要新同步系统；不能把“允许投影字段”升级为写权威 |
| `shared/permission-effect-contract.ts` | 执行前的现有授权快照、请求绑定及 final owner | 语义描述只能引用这些 owner，不能替代授权检查 |
| Context Family 文档与规则 | ContextItem、Projection、Provenance 与既有真源边界 | 只引用原合同；不增加第二份 Context / Memory / Knowledge 存储 |
| `scripts/lib/canonical-evidence-hash.mjs` | 既有证据文本规范化及摘要 | 复用并说明规范化策略，不新写通用 canonicalizer 或版本仓库 |

源码检索中，关系常量的值消费者仅见产品语义单测；没有发现 Renderer、Main 或
Runtime 使用该常量做路由、prompt 或授权。本观察不等于整个项目没有语义错误。

开始研究时，原始语义工作仍有 3 个修改文件和 2 个未跟踪文件。之前的本地
完成记录与“当前源码已经进入干净候选”是两个事实。保留历史记录，不给旧
verdict 换候选、换日期或补签；后续第一步应建立新的来源清单和干净候选回读。

## 官方解法中可以借用什么

| 来源 | 原文支持的做法 | 在当前仓库的最小落点 | 不由该来源证明的结论 |
|---|---|---|---|
| [W3C SHACL Recommendation（2017）](https://www.w3.org/TR/2017/REC-shacl-20170720/) | 以 shapes 声明约束；验证报告定位 focus node、路径和约束；闭合形状可排除未声明属性 | 对现有关系提供确定性组合检查，输出关系键、字段、规则及错误；用独立正负 fixture 校准 | 没有必要安装 RDF/SHACL；形状通过不等于事实正确、权限获准或业务成功 |
| [W3C PROV-DM Recommendation（2013）](https://www.w3.org/TR/prov-dm/) | 分清 entity、activity、agent、generation、usage、derivation；软件可以是责任主体 | 在已有证据报告中引用 source、candidate、检查命令、输出摘要和实际 actor；关系键由现有三元组派生 | 来源链不证明内容真实，也不自动授予责任主体权限；不声称 real-human |
| [Cedar policy validation](https://docs.cedarpolicy.com/policies/validation.html) | 根据 schema 检查实体、动作、属性及类型；验证 API 与授权 API 分离；改 schema 后应重验既有策略 | 检查关系 kind / 端点 / authorityBoundary 的组合；权限继续由现有 owner 判断；变更后重验既有消费者 | 合同有效不意味着具体请求获准；本项目不引入 Cedar 或第二套 policy engine |
| [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) | 先明确合同；区分兼容与不兼容变更；已经发布的版本内容不能被回写 | 参考现有 `…/v1` 合同惯例和 Git 候选绑定；声明消费者兼容性、退役与回滚方式 | 不强制增加完整 SemVer 服务、自动迁移或独立版本存储；不改发布版本或产品默认值 |

另外通过 `code.doc` 查询了 [Zod 的 schema/refinement 文档](https://zod.dev/api)。
现有代码已经有纯函数校验和 Vitest；本任务优先复用这些路径，不因研究到一个库
就安装依赖或重写所有类型。

Cedar 原文特别指出：授权 API 不在每次请求时自动执行 schema 验证；一个已经
验证通过的策略，面对不符合 schema 的请求仍可能报错。因此不能以类型通过、
关系存在或报告绿色替代最终执行 owner 的请求与授权检查。

SHACL 是针对 RDF 的标准。本项目只借用“约束和结构化诊断”这一方法，不能
把自行编写的 TypeScript 检查称为 SHACL 合规实现。PROV 同理：来源映射参考
其概念，不声称已经完成 PROV-O 序列化或标准互操作。

## 四步实施顺序

### 1. 固定来源、消费者和权威

逐条回读现有六条关系，把文档依据、实际 enforcing owner 和已有回归入口分清。
沿调用链验证 owner；找不到真实执行证据时明确写 `documented-only` 或 gap。
使用现有关系 `(from, kind, to)` 的派生键，不另建关系 ID 服务。

核对 Task Ledger 的任务事实与 Task Loop 的运行状态，保持两种 owner 分离。
核对 Context Family 的投影、现有权限快照和身份兼容映射；不要求这些体系成为
七个产品概念中的新节点。对原始五个文件做保全与新候选回读，不改旧验收记录。

### 2. 增加能真正拒绝错误输入的确定性校验

在现有语义模块及单测中实现最小校验，先覆盖已声明关系。
校验结果至少能定位 `relationKey / field / rule / message`。
不能仅把正确表复制一份再断言相等，也不能把 `as const satisfies` 当运行时校验。

独立负例覆盖未知端点或 kind、重复、自环、缺证据、错误组合、反向任务权威、
伪造授权字段、把跨 session 质量当同 session 权威等具体错误。
六条既有关系保持有效，Plan Mode 没有新增关系也必须有效。
已有身份及继承表的兼容行为不因闭合形状校验而被改写。

### 3. 加入版本、摘要和来源失效检查

给源级关系合同一个明确版本，在既有证据检查器的派生报告中记录 source refs、
source digest、candidate commit/tree、实际 actor、命令和退出码。
只增加审计元数据；不复制任务状态、运行状态或权限数据。

现有路径存在检查继续复用。补查 repo-root 归属、越界/符号链接解析、跟踪状态
及候选对应性；干净源码与 dirty/untracked 输入使用明确不同的来源标记。
可恢复的原字节哈希与跨平台规范化摘要要区分，不把两种哈希混用。

端点、方向、关系 kind 或权威含义改变属于语义变更；必须重新审查消费者并产生
新报告。旧候选或不支持的合同版本不能被默认为当前通过。历史 manifest 原封
保留，按新候选产生新报告。不新建 migration engine、版本数据库或图推理器。

### 4. 接入已有门禁并完成兼容性收口

通过现有 Harness、Vitest、`repo:evidence:check` 和证据清单使用上述校验；
检查器的结构化输出只是审计投影。现有 Agent-first 可以引用该静态证据，
不新建 subject adapter、suite runner、评分平台或 UI。

验证：既有关系仍通过；每个坏例都在预期规则上被拒绝；来源变化能使旧报告失效；
原生门禁确实调用了校验；坏例不能出现在 pass 证据里。原有证据路径检查不退化。
回读产品语义、README 和消费者清单，证明没有新增关系值消费者、prompt/路由/
tool/approval/storage/UI 路径或默认值变化。用已有 fixture 做必要兼容回归，
不为这次纯源级治理新增 Electron 产品交互。

## 方案取舍与可测量范围

选择“现有合同 + 确定性约束 + 来源绑定 + 原生门禁”。
只补说明文档不能发现错误组合或陈旧来源；完整 RDF/OWL/知识图谱平台超过本次
目标，且会增加需要维护的运行时和真源。无需新增第三条技术路线。

验收指标只覆盖：六条基线关系有效、独立负例拒绝率、证据绑定完整性、旧报告
失效能力、门禁调用覆盖及原行为兼容性。当前尚未实现这些新增检查，相关指标
一律 `not-run`；之前单测的通过数不能充当新增能力的结果。

若未来确有关系遍历、推理、ontology grounding 或 RAG 的需求，另起经授权的
窄任务，并预注册 baseline、held-out、负向控制、成本/延迟、回滚与 flag-off
parity。此实施方案不预留这些功能，也不新增等待人工操作或真人数据的条件。

实施合同：[ontology-lite-existing-contracts-hardening.md](../tasks/ontology-lite-existing-contracts-hardening.md)。

来源核对索引：[sources.json](../fixtures/ontology-lite-existing-contracts/sources.json)。
该索引记录六条派生关系的文档、实际 owner 调用路径和回归入口；未观测的运行时
链路保留限制，Workboard 调度卡片到 Ledger 的完整链路标为 documented-only。
研究快照及其旧候选、摘要和 verdict 保留原值，实施验证另写新证据。

确定性检查入口为 `shared/product-semantics.ts` 的 `validateProductSemanticRelations`。
[正例](../fixtures/ontology-lite-existing-contracts/relations.valid.json) 和
[独立负例](../fixtures/ontology-lite-existing-contracts/relations.invalid.json) 提供显式
输入及预期拒绝规则；`tests/unit/product-semantics.test.ts` 验证结构化诊断与兼容性。
同 session 字段只校验静态说明，始终不替代运行时 owner receipt。
研究来源、文件摘要及限制：[research.json](../fixtures/ontology-lite-existing-contracts/research/research.json)。
