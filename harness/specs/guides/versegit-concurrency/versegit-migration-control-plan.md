---
id: versegit-migration-control-plan
title: VerseGit migration control plan
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# VerseGit 防重写与防污染迁移控制计划

> 状态：实施收口（非 GA、默认关闭、release-ineligible）。

## 0. 契约修正与收口结果

2026-10-21，`ccs-agentrouter/gpt-6.1-sol` 对初版规划给出 **FAIL**：WP/MC DAG 可绕过防重写门禁，宿主清理、回执绑定、状态、输入冻结和机器化验收尚未闭合。TF-0481 随后补齐统一 DAG、逐节点 fixture/artifact/verifier、清理屏障、receipt、状态、provenance 和证据保留契约。

2026-10-22，WP6 回读并复算 MC0-MC5、WP0-WP5 的 12 个必需门禁；MC6 以证据裁定为 `sidecar-only`、源码提取未触发；MC7 的退役与 curated evidence 职责已并入 WP6。结论仍是：

- VerseGit source/history/build output 不进入 ClawX；
- provider-derived migration 保持 MC5 单 seam / 6 文件 / 400 行 / 单文件 200 行预算；
- host-owned anti-corruption bootstrap 使用单独的有界预算，不授权源码提取；
- 当前只有 debug sidecar，provider source dirty，因此 `releaseEligible=false`；
- 没有 live VerseShell receipt，`conflicts-plan` seam unavailable，M4 未授权。

当前收口矩阵：[`versegit-planning-correction-matrix.md`](versegit-planning-correction-matrix.md)。

## 1. 结论

**不要把 VerseGit 作为一个大块源码直接搬进 ClawX。**
推荐姿态是：

```text
ClawX host adapter
  -> versioned sidecar binary
  -> VG public contract
  -> VG unchanged core
```

也就是说，先把 **VG 作为一个可替换模块接入**，而不是先把它的源码拆散再重组。
如果后续确有 in-process 需求，再按“最小公开 API + 独立 crate/package + 消费者契约测试”的顺序做**选择性提取**。

## 2. 两个必须被节点显式吸收的风险

### 2.1 源码污染

风险来自三件事：

1. 独立项目里有大量与 ClawX 无关的历史、文档、评测、构建产物和任务图。
2. 直接复制源码会带来跨仓库所有权混乱，尤其是 `.agent-workbench`、`target/`、`evidence/`、`docs/`。
3. 一旦迁入后再清理，很容易误删证据或把私有历史混进产品仓库。

### 2.2 LLM 重写

风险来自模型的默认倾向：

1. 把“理解代码”误当成“重新实现代码”。
2. 在重命名、异常处理、边界条件上做“顺手优化”。
3. 在没有 characterization test 的情况下，把隐性行为当成噪声改掉。
4. 在上下文窗口有限时，丢失非文本约束：锁、路径、进程清理、证据格式、安全边界。

因此，迁移不是“让模型读懂后重写”，而是：

> **先冻结行为，再迁移接缝，再让机器证明差异为零。**

## 3. 公开最佳实践

### 3.1 Strangler Fig

Martin Fowler 和 Azure 架构指南都强调：

- 先找到可替换的 seam；
- 用 facade/router 保持新旧路径可共存；
- 按能力切片逐步替换；
- 保留临时 transitional architecture，但要写清退场条件。

应用到 VG：

- 第一个 seam 是 `vg` 的 JSON/CLI 公开面；
- 先接 `capabilities / doctor / conflicts / integration_status / verdict facts`；
- 不要一开始迁移 `land / admit / gerrit / workspace` 等高风险面。

来源：

- https://www.martinfowler.com/bliki/StranglerFigApplication.html
- https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig

### 3.2 Characterization tests / Golden master

Feathers 的 characterization test 思想是：

> 先记录当前系统的实际输出，再把这些输出变成断言，用���保护后续重构。

适用到 VG：

- 对固定输入记录 CLI JSON、exit code、错误分类和 cleanup 状态；
- 对多 worktree/producer-consumer 场景记录 conflict/report 输出；
- 对 schema/version/capabilities 输出做 golden master；
- 迁移 adapter 时用 differential test 比较“原始 VG 输出”和“ClawX adapter 输出”。

来源：

- https://en.wikipedia.org/wiki/Characterization_test
- https://docs.synapsestudios.com/concepts/legacy/characterization-testing

### 3.3 Branch by abstraction

这个模式要求：

- 在同一接口后面保留旧实现；
- 新实现先以小切片接入；
- 用 feature flag 路由；
- 每个切片都能回滚。

应用到 VG：

- ClawX adapter 保持在 `M0 disabled -> M1 diagnostic -> M2 advisory -> M3 candidate`；
- 每一档都可回滚；
- 不做一次性“替换全部 VG”。

### 3.4 Consumer-driven contracts

VG 对 ClawX 暴露的不是“它有什么”，而是 **ClawX 实际消费什么**。
所以应把 consumer contract 写成 executable tests：

- input JSON shape；
- output JSON shape；
- error/status semantics；
- version/digest identity；
- cleanup and failure contract。

来源：

- https://quality.arc42.org/approaches/consumer-driven-contracts

### 3.5 Monorepo boundaries / plugin architecture

公开实践强调：

- 不允许跨包直接 import 内部模块；
- public API 必须窄于实现；
- host 拥有策略，plugin 不能越权；
- capability 和 lifecycle 必须显式声明。

应用到 VG：

- ClawX 侧不 import VG 内部 crate；
- VG 不 import ClawX 私有类型；
- 两边只交换版本化 JSON contract；
- 所有跨边界调用都带 `request_id / trace_id / owner / effect / timeout`。

### 3.6 LLM migration at Google

Google 的大规模迁移经验给出一条硬规则：

- 先定位变更点；
- LLM 只做局部转换；
- 用 AST、build、test 和 golden 验证；
- 无效变更直接丢弃；
- 每次变更仍需 owner review。

应用到 VG：

- LLM 不允许生成“完整模块重写”；
- 每个节点必须附最小 diff；
- 机器验证不过则丢弃；
- 人工/owner 只做最终接收，不做事实重建。

来源：

- https://arxiv.org/html/2504.09691
- https://research.google/blog/accelerating-code-migrations-with-ai/

## 4. 迁移模式决策矩阵

| 模式 | 说明 | 适合阶段 | 主要风险 |
| --- | --- | --- | --- |
| **Sidecar binary** | ClawX 只消费 `vg.exe` 的公开 CLI/JSON 输出 | 默认推荐 | 进程生命周期和版本管理 |
| **Pinned package** | 把 VG 打成 crate/package，ClawX 通过包管理器消费 | 若需要 in-process API | 发布与版本协议 |
| **Selective source extraction** | 只抽一个模块到独立 crate，再作为依赖引入 | 仅当 sidecar 证明该模块需要 in-process | 行为漂移和源码污染 |
| **Submodule/subtree** | 把整个独立仓固定到 ClawX 内 | 不推荐 | 目录污染、历史污染、所有权混乱 |
| **Whole-tree copy** | 复制整个 VerseGit 仓库 | 禁止 | 引入大量脏文件和第二真源 |

结论：

1. **M1-M3 全部用 sidecar binary。**
2. **M4 / in-process 需求另立节点，并先证明 sidecar 无法满足。**
3. **绝不整仓 copy。**

## 5. 防污染规则

1. **不复制 `.agent-workbench/`。**
   Task Forest、handoff、proposal、snapshot 和 events 不进入 ClawX。
2. **不复制 `target/`、`evidence/`、`docs/`、`.vg/`、`.git/`。**
   这些是 VG 的私有历史、构建输出和证据库。
3. **不复制测试夹具以外的生成物。**
   `target/`、release binary、trace、reports 只通过 manifest 消费。
4. **不把 VG 的 README 变成 ClawX 文档。**
   ClawX 只保留自己的 `README + guide + scenario + rule`。
5. **不迁移 VG 的 Git 历史。**
   用 source commit、binary digest、contract version 和 artifact digest 记录来源。
6. **不迁移 VG 的测试代码。**
   测试留在 VG 仓；ClawX 侧只建立自己的 consumer contract tests。
7. **不迁移 VG 的实现文件。**
   除非某一模块通过了 sidecar contract，并且已证明 in-process 是必要条件。

## 6. 防重写规则

1. **先写 characterization tests，再让 LLM 改代码。**
   没有 golden 的路径，不允许模型产出 patch。
2. **一次只迁移一个 seam。**
   例如一次只迁移 `capabilities` 或 `doctor`，不做“VG 全量适配”。
3. **每个节点必须有 diff budget。**
   超过预算就拆节点，不靠 review 硬扛。Host-owned、provider-free anti-corruption bootstrap 依据边界规则使用独立有界预算（最多 2 个生产文件 / 800 行 / 单文件 800 行）；测试、脚本和证据必须 digest-bound，但不能把 provider-derived migration 伪装成 bootstrap。
4. **不允许顺手优化。**
   若模型认为某个行为需要变更，必须停在 exception report 里，不能直接改。
5. **不允许格式化 diff。**
   whitespace-only diff 自动作废。
6. **不允许 AST 不变却宣称迁移完成。**
   语法或行为必须至少有一个可验证变化，且能被测试解释。
7. **不允许新增隐式依赖。**
   新 import 必须来自 public contract，不允许深路径 import。
8. **不允许吞掉错误。**
   旧错误码、退出码和失败路径必须被 characterization test 锁住。
9. **不允许迁移过程中改默认值。**
   `default-on`、`land/admit`、`single green light` 保持原状。
10. **不允许用 summary 替代 golden。**
   报告必须引用 artifact hash 和 diff，而不是复述模型理解。

## 7. Module slicing

推荐迁移顺序按 **公开能力** 切，不按源码文件切：

1. **identity**
   `version / schema / capabilities / binary digest`
2. **health**
   `doctor / report schema`
3. **diagnostic facts**
   `conflicts / integration_status / who_touches / explain_conflict`
4. **candidate facts**
   `candidate identity / report / verdict facts`
5. **execution bridge**
   `verification plan -> VerseShell receipt -> verdict`
6. **observability**
   `behavior event / coverage vector / feedback delivery`
7. **cleanup / recovery**
   `sidecar crash / stale epoch / worktree cleanup`
8. **M4 broker**
   另立节点，不做默认迁移

每一片都必须有：

- input fixture；
- expected golden JSON；
- error contract；
- cleanup contract；
- provenance digest；
- differential test against original VG binary。

## 8. Review gates

每个节点完成前必须通过：

1. **Contract test**
   ClawX consumer contract 对 VG provider 输出逐字段验证。
2. **Golden diff**
   固定输入下，新 adapter 输出与原始 VG 输出一致，除了已声明的兼容差异。
3. **Failure test**
   missing binary、schema mismatch、timeout、crash、cleanup fail 均有独立 case。
4. **No-op check**
   LLM 产出的 diff 如果只有 whitespace 或无 AST 变化，直接拒绝。
5. **Diff budget check**
   每个 PR 只允许一个 seam；超过预算自动拆分。
6. **Provenance check**
   source commit、binary SHA-256、schema version、capabilities digest 必须可见。
7. **Behavior-change report**
   如果行为变化，必须列出“旧行为 / 新行为 / 原因 / 验证”。
8. **Rollback proof**
   flag off 后零行为变化，或可回到旧路径。

## 9. Node plan

把迁移控制拆成 MC0-MC7，不与 WP0-WP6 混为一谈。

### MC0：冻结来源与行为基线

目标：在迁移开始前知道“我们到底在保什么”。

- 固定 VG source commit；
- 固定 binary SHA-256；
- 固定 schema version；
- 固定 capabilities digest；
- 建 `migration-inventory.json`，列出不迁入目录和保留边界；
- 对 2-3 个代表性命令记录 golden JSON。

验收：

- 可从 manifest 回读 source/binary/schema；
- golden diff 可重算；
- `.agent-workbench`、`target`、`docs`、`evidence` 明确列为禁止迁入。
- 没有源码文件进入 ClawX。

### MC1：定义 anti-corruption sidecar contract

目标：把“VG 的内部实现”和“ClawX 的消费需求”隔开。

- 定义 `clawx.versegit.module-report/v1`；
- 定义 `clawx.versegit.command-plan/v1`；
- 定义 `clawx.verseshell.execution-receipt/v1`；
- 定义 `M0-M3` 权限矩阵；
- 定义 `not_applicable / unavailable / partial / observed / degraded / rejected_by_policy`。

验收：

- consumer contract tests 全绿；
- schema 漂移、digest 漂移、version 漂移分别 fail-closed；
- 不需要 import VG 内部模块。

### MC2：建立 behavior fingerprint

目标：把“实际行为”变成机器可验证事实。

- 固定 representative fixtures；
- 记录 CLI JSON、exit code、stderr 分类、cleanup 状态；
- 对 multi-worktree 场景记录 report 形状；
- 对 error path 记录 expected failure shape；
- 把 golden 归档到 VG 仓，而不是 ClawX 仓。

验收：

- 每个被迁移能力都有 input/output golden；
- 波动字段已归一化；
- MC2 冻结原版基线；具体迁移片的等价性在每个实施节点的关闭门禁中验证，由语义投影、允许差异和行为变化报告解释。

### MC3：固化 sidecar 交付

目标：让 VG 以可验证制品进入 ClawX，而不是以源码树进入。

- 建立 release binary manifest；
- 校验 binary、schema、capabilities；
- 定义 sidecar 启动、超时、kill switch；
- 定义 crash/recovery 状态；
- 定义无 C: 临时产物的安装位置。

验收：

- sidecar 启动 smoke 通过；
- digest 不符即拒绝；
- 启动失败不影响 ClawX 主流程；
- 无 `target/`、`.git/`、`.agent-workbench/` 进入 ClawX。

### MC4：实现 ClawX module adapter

目标：在 ClawX 内只做适配，不做重写。

- 新增 host-owned `VerseGitModule`；
- 只调用版本化 JSON contract；
- 不 import VG 内部 crate；
- 不暴露 `declare_intent`；
- 保持 renderer/Main boundary。

验收：

- adapter 输出经声明的语义投影与 VG 原始输出差分一致；错误、scope、unknown 和信息丢失断言不得被投影吞掉；
- `default-off` 回归通过；
- 无第二个执行器；
- 无额外依赖或第二任务图。

### MC5：建立 differential migration gate

目标：让“是否重写”变成机器可判定。

- 用原始 VG binary 和 adapter 输出做 diff；
- 对每个 seam 做 one-PR-one-slice 检查；
- 对 whitespace-only diff、相关代码变换的 AST-no-op、超过数值 diff budget 的变更自动拒绝；文档/schema/config 不使用 AST 规则；
- 对故意行为变化生成 explicit behavior-change record。

验收：

- 三个代表输入上 golden diff = 0；
- 三个 negative control 全部触发；
- 每个 PR 只有一个 seam；
- 所有 LLM 产出可追溯到节点、contract、golden 和 source commit。

### MC6：裁定 sidecar-only 或 selective extraction

目标：决定是否进入更深层的源码迁移。

必须先满足：

- sidecar 模式已稳定；
- differential gate 通过；
- 性能或安全需求明确证明 sidecar 不够；
- public contract 已能承载所有需要的行为。

然后才允许：

- 抽出最小 crate；
- 作为 package 引入；
- 不复制整个 VG 仓。

验收：

- 若继续 sidecar-only，记录决策和退役条件；
- 若 selective extraction，列出被迁移文件、保留文件、依赖边界和回滚路径；
- 无无关源码进入 ClawX。

### MC7：迁移收口与临时层退役

目标：确保临时 adapter 不变成永久债务。

- 标记所有 transitional contract 的退场条件；
- 删除不再需要的兼容层；
- 更新 guide/scenario/rule；
- 把最终 evidence 固化为 curated artifacts；
- 在 Task Forest 中记录未测边界。

验收：

- 每个临时层都有 removed / kept + reason；
- 无遗留 TODO 或无退场条件的兼容层；
- 证据、报告和版本矩阵完整；
- 下一阶段任务或明确退役结论已登记。

## 10. Definition of Done

Migration is done only when:

- source and binary provenance are fixed;
- all consumed seams have golden contracts;
- LLM diff discipline is enforced;
- no VG source tree is copied;
- sidecar delivery is verified;
- differential tests prove behavior preservation;
- ClawX authority remains intact;
- temporary adapters have retirement conditions;
- evidence and Task Forest records are complete.

## 11. External references

- Strangler Fig — https://www.martinfowler.com/bliki/StranglerFigApplication.html
- Strangler Fig (Azure) — https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Characterization test — https://en.wikipedia.org/wiki/Characterization_test
- Characterization Testing — https://docs.synapsestudios.com/concepts/legacy/characterization-testing
- Consumer-Driven Contracts — https://quality.arc42.org/approaches/consumer-driven-contracts
- Plugin Architecture — https://quality.arc42.org/approaches/plugin-architecture
- Monorepo boundaries — https://www.devobs.io/articles/monorepo-boundaries-that-hold/
- Branch by abstraction — https://nalar.dev/branch-by-abstraction-for-incremental-change/
- LLM migration at Google — https://arxiv.org/html/2504.09691
- Google research blog — https://research.google/blog/accelerating-code-migrations-with-ai/