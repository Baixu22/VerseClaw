# 给 operator 的计划消息（2026-10-31 收口决策轮）

> 一条消息、一次确认；本轮不边问边改。产出者 agent（`driven_by: agent`，`actor: claude-fable-5`）。

**将做什么**：对 TF-0628 骨架子树做收口决策——TF-0632（唯一 ready 叶子）的执行合同写成可直接实现的规则集 / 登记表 / 五类负例 / 门禁入口；TF-0633 拆为 TF-0634…TF-0637 四个串行叶子并给出最小形状；dsh-superagent 只借八条语义、不借代码。本轮**不实现**任何运行时或校验器。

**动哪些写集**：`docs/dev/dsh-superagent-absorption-20261031.md`、`docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md`、本文件、`harness/specs/tasks/architecture-skeleton-authority-validator.md`（修订）、`harness/specs/tasks/ontology-lite-contract-implementation.md`（新增）、`CHARTER.md` 状态注、`AUTHORITY-RECONCILIATION.md` 一处勘误、retention（`scripts/repository-artifacts.json`、`.gitignore`）；本地 Task Forest 两份 proposal。零注册表、零运行时、零 `package.json` 改动。

**验收口径**：每个 ready 叶子的验收条都对应磁盘证据文件与 Read 回读方式（spec 内表格）；收口按仓库 auto-close override，`base_graph_hash` 匹配、候选干净、`not-run` 如实。

**默认与风险**：已定的默认——C-02…C-06 登记为 `registered-pending-fix`（自到期、不放宽规则）；门禁入口只用 `pnpm test` 路径的 vitest + 真实 CLI 入口；六表加载用 Node 24 类型剥离 + `.js→.ts` 解析钩子（CI 已是 Node 24）。风险——若将来 CI 换回 Node 22，校验器会以 exit 2 失败（fail-closed，不会假通过）；TF-0633 四叶会带来四次收口成本，换来每叶可单独回滚。

**需要你决定的事项**：none。
