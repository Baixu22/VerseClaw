---
id: ontology-lite-contract-implementation
lifecycleStatus: active
title: 语义合同硬化四步的实现合同（C1–C4，挂接骨架 L2+L5）
type: task
intent: 把 ontology-lite-existing-contracts-hardening 的四步写成可直接执行的实现合同：固定 CONTRACT_VERSION / relationKey / 可拒绝校验器 / 来源摘要与 candidate 绑定 / 原生门禁的最小形状、每步的写集与验收产物，并把四步登记为 TF-0633 下的四个串行叶子；不覆盖既有结论，只补实现合同。
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - identity-scope-boundary
  - context-family-boundary
  - task-forest-autoclose-and-roles
  - contract-first-boundary
ownedPaths:
  - shared/product-semantics.ts
  - tests/unit/product-semantics.test.ts
  - scripts/check-evidence-refs.mjs
  - scripts/check-evidence-refs.d.mts
  - tests/unit/evidence-refs-exist.test.ts
  - harness/specs/fixtures/ontology-lite-existing-contracts/**
  - docs/clawx-product-semantics.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/dev/architecture-skeleton/CONTRACT-HARDENING.md
  - docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md
  - scripts/repository-artifacts.json
  - .gitignore
  - harness/specs/tasks/ontology-lite-contract-implementation.md
humanEvidence: not-required
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/ontology-lite-contract-implementation.md
  - pnpm harness validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md
  - pnpm harness context --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md
  - pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/task-ledger-reference-inheritance.test.ts tests/unit/permission-effect-contract.test.ts --maxWorkers=1
  - node scripts/check-evidence-refs.mjs
  - pnpm repo:evidence:check
  - pnpm repo:artifacts:check
  - pnpm harness:specs:lifecycle
  - pnpm docs:policy:validate
  - pnpm run typecheck
  - git diff --check
acceptance:
  - C1：六条关系各有 relationKey、文档依据（file:line）、实际 enforcing owner（file:line 或 documented-only）、既有消费者清单、回归入口与证据等级；清单为磁盘 JSON 并附 SHA256SUMS，计数命令写在清单内可离线复现。
  - C2：shared/product-semantics.ts 导出 PRODUCT_SEMANTIC_CONTRACT_VERSION、relationKey、validateProductSemanticRelation(s) 与封闭规则集；现有六条关系通过；每类负例由预期规则拒绝并给出 relationKey / field / rule / message；模块无导入时执行；新符号在 electron、src、openclaw_runtime 中零消费者。
  - C3：scripts/check-evidence-refs.mjs 在默认行为不变的前提下新增 --report 与 --verify，报告记录合同版本、关系键、来源引用及其跟踪状态与规范化摘要、candidate commit/tree/dirty、actor、命令、退出码与诊断；来源删除/移动/越界/未跟踪/symlink escape、摘要/候选/版本不匹配、缺字段均使 --verify 判 invalid 且 exit 非 0。
  - C4：坏关系、陈旧来源、空报告、遗漏调用经真实入口（node scripts/check-evidence-refs.mjs 与 pnpm exec vitest）各自失败；产品语义文档补关系五列表与合同版本；三份 README 按 docs-sync 复核并记录结论；精选最终证据含新干净 candidate、SHA256SUMS、凭据扫描与限制。
  - 四步合计：六条关系、身份兼容映射、单向字段继承与最终权限 owner 行为不变；无新增运行时路径、prompt、routing、tool、approval、storage、UI、默认值或产品锁变化。
nonGoals:
  - RDF/OWL/SHACL/Cedar 运行时、图数据库、知识图谱存储、推理、遍历、查询服务或本体 prompt 注入。
  - 新产品概念、功能页、Host API、工具、subject adapter、suite runner、评分模块、状态机、ID 服务或版本数据库。
  - 替代 Task Ledger、Workboard、Runtime、Context Family、Memory、Knowledge、现有审批或 write journal 的权威。
  - 改产品锁、默认开关、发布状态、liveReady、productApproved 或自动授权。
  - 合并分支 codex/ontology-contracts；该分支只作命名与形状的参考，不作已落地事实或验收证据。
  - 人工操作、真人数据、真人 verdict 的前置要求，或任何 real-human 声称。
docs:
  required: true
  files:
    - harness/specs/guides/ontology-lite-existing-contracts-research.md
    - docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md
---

# 语义合同硬化四步的实现合同

## 与既有合同的关系

- 伞合同：`harness/specs/tasks/ontology-lite-existing-contracts-hardening.md`（"不可改写的既有语义" 1–6 条与四步的目标、验收要点、负例表**原文继续有效**，本文件不复述、不覆盖）。
- 研究依据：`harness/specs/guides/ontology-lite-existing-contracts-research.md` §"四步实施顺序"。
- 骨架位置：`docs/dev/architecture-skeleton/CHARTER.md` §3 L2（身份与边界）+ L5（证据与失效）、§5 批次 C；执行决策与收口口径：`docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md` §3。
- 与批次 B 的接口：复用 TF-0632 落地的 `scripts/lib/ts-import-hooks.mjs`（plain Node 加载带 `./x.js` 导入的 TS 注册表）与 `scripts/lib/registry-fixture.mjs`（内存改写 fixture），**不**另起一套加载 / fixture 机制（Task Forest 边 TFE-1253："避免两套并行语义规则"）。
- 本文件只补实现合同：最小形状、每步写集、验收产物与回读方式。

## 基线与前置的复核结论

| 伞合同前置 | 当前检出（HEAD `2b87c1c44`，工作区 0 行）的事实 | 处置 |
|---|---|---|
| 步骤一"先保全原始五个未提交文件的 working/staged 字节" | 工作区干净，不存在未提交的语义文件；历史的 3 个修改 + 2 个未跟踪文件已不在树上 | 该前置**不适用**；C1 清单中记 `preservation: not-applicable`（附 `git status --porcelain` 为空的读数），不得伪造保全哈希 |
| `CONTRACT_VERSION` / `validateProductSemanticRelation` / `relationKey` | `grep -nE "CONTRACT_VERSION\|validateProductSemanticRelation\|relationKey" shared/product-semantics.ts tests/unit/product-semantics.test.ts` 退出码 1（三项均不存在） | 由 C2 实现 |
| 关系常量的值消费者 | 仅 `tests/unit/product-semantics.test.ts`；`scripts/check-evidence-refs.mjs` 只按文本扫描路径（`EVIDENCE_FILES` :13–:19） | C1 以 grep 复核并写入清单 |
| 分支 `codex/ontology-contracts`（头 `22c275811`，merge-base `b6b50ceaf`，相对 main +491 行） | 未合入；导出名 `PRODUCT_SEMANTIC_CONTRACT_VERSION` / `productSemanticRelationKey` / `validateProductSemanticRelations` | 只作命名参考；不 cherry-pick（基线已分叉，main 后加的 `PRODUCT_SEMANTIC_RELATIONS` 块与之冲突） |

## 最小形状（C2 / C3 的合同；名称固定，实现者不得改名）

```ts
// shared/product-semantics.ts —— 只增加导出；不执行任何导入时副作用；不改既有导出
export const PRODUCT_SEMANTIC_CONTRACT_VERSION = 'ProductSemanticRelations/v1' as const;

export const PRODUCT_SEMANTIC_RELATION_RULES = [
  'unknown-endpoint', 'unknown-kind', 'unknown-authority-boundary', 'self-loop', 'duplicate-relation',
  'missing-evidence', 'kind-boundary-mismatch', 'reverse-task-authority', 'forged-grant-field',
  'cross-session-quality', 'unsupported-contract-version',
] as const;                                   // 封闭集；测试断言校验器产出的 rule 都在集内

export type ProductSemanticRelationDiagnostic = {
  relationKey: string;                        // `${from}--${kind}--${to}`；无法解析的部分记 '?'
  field: string;                              // from | kind | to | authorityBoundary | evidenceRefs | relation | contractVersion
  rule: (typeof PRODUCT_SEMANTIC_RELATION_RULES)[number];
  message: string;
};

export function relationKey(relation: { from: string; kind: string; to: string }): string;
export function validateProductSemanticRelation(
  candidate: unknown,
  context?: { concepts?: readonly string[]; contractVersion?: string; sessionScope?: 'same-session' | 'cross-session' },
): ProductSemanticRelationDiagnostic[];
export function validateProductSemanticRelations(
  candidates: readonly unknown[],
  context?: Parameters<typeof validateProductSemanticRelation>[1],
): { ok: boolean; diagnostics: ProductSemanticRelationDiagnostic[] };
```

判定规则（全部为元数据检查，不接入运行时准入、执行、prompt 或授权）：

| rule | 触发 |
|---|---|
| `unknown-endpoint` / `unknown-kind` / `unknown-authority-boundary` | 不在 `PRODUCT_SEMANTIC_CONCEPTS` id / `ProductSemanticRelationKind` / `ProductSemanticAuthorityBoundary` 枚举内（枚举由现有类型字面量派生为运行时常量，不复制第二份表） |
| `self-loop` | `from === to` |
| `duplicate-relation` | 同一 `relationKey` 出现 ≥ 2 次（在 `validateProductSemanticRelations` 中判定） |
| `missing-evidence` | `evidenceRefs` 缺失、空数组或含空字符串；不得填入默认"已验证" |
| `kind-boundary-mismatch` | 组合不在封闭映射内：`suggests-upgrade-to→advisory-only`、`projects→read-only-projection`、`roots-in→task-ledger-authority`、`references-one-way→one-way-reference`、`quality-gated-by→same-session-scorecard`（分别合法但相互不匹配即拒绝，不止检查枚举成员） |
| `reverse-task-authority` | `from === 'task-ledger'`（Task Ledger 不投影 / 不引用 / 不根植于别的概念），或 `authorityBoundary === 'task-ledger-authority'` 而 `to !== 'task-ledger'`（镜像 / 调度权威升级） |
| `forged-grant-field` | 候选对象含 `from / kind / to / authorityBoundary / evidenceRefs` 以外的键（如 `grants`、`permission`、`inverse`、`transitive`、`bidirectional`）；闭合形状，不产生任何 grant |
| `cross-session-quality` | `kind === 'quality-gated-by'` 且 `context.sessionScope === 'cross-session'`（跨 session / caller 自报 quality 不能升级为 active authority；无 receipt 的说明仍是 documented-only） |
| `unsupported-contract-version` | `context.contractVersion` 给出且 ≠ `PRODUCT_SEMANTIC_CONTRACT_VERSION`；不自动解释为最新、不自动迁移 |

```text
scripts/check-evidence-refs.mjs —— 默认行为（无参数）与输出逐字不变；只增加：
  --report <path>   写 ProductSemanticEvidenceReport/v1（见下表）；exit 0/1 按诊断结果
  --verify <path>   重读报告：重算每个 sourceRef 的摘要、候选 commit/tree、合同版本；任一不匹配 → status 'invalid'，exit 1
  --fixture <json>  经 scripts/lib/registry-fixture.mjs 做内存改写（不触盘），供 C4 的集成负例
  --actor <name>    写入 actor；缺省取环境变量 CLAWX_EVIDENCE_ACTOR，再缺省 'unknown'（不得填 real-human）
```

| `ProductSemanticEvidenceReport/v1` 字段 | 来源 |
|---|---|
| `schema`, `contractVersion`, `generatedAt`, `node` | 常量 / 运行时 |
| `actor: { driven_by: 'agent', actor }`、`command`、`exitCode` | 本次调用 |
| `candidate: { commit, tree, dirty, dirtyPaths }` | `git rev-parse HEAD`、`HEAD^{tree}`、`git status --porcelain`；dirty 为真的报告**不能**满足节点 clean-candidate 收口条件 |
| `normalization: { policy, rawDigestPolicy }` | 复用 `scripts/lib/canonical-evidence-hash.mjs` 的 `canonicalEvidenceBytes` / `sha256CanonicalEvidenceFile`（跨平台文本规范化摘要）+ 原字节 SHA-256（可恢复原字节），两种摘要分字段、不混用 |
| `relations[]: { relationKey, sourceRefs[]: { path, exists, insideRoot, tracked, symlinkEscape, digest, rawDigest } }` | 经 `ts-import-hooks.mjs` 加载 `shared/product-semantics.ts` 取 `PRODUCT_SEMANTIC_RELATIONS` 与 `relationKey`；路径须在 repo-root 内解析（`path.resolve` 后以 root 为前缀且 `realpath` 不逃逸）；`tracked` 由 `git ls-files --error-unmatch` 得到 |
| `diagnostics[]`（关系校验 + 来源校验）、`unverified[]`、`status: 'valid' \| 'invalid'` | 关系诊断复用 C2 的校验器；来源诊断规则 id 以 `source-` 前缀：`source-missing`、`source-outside-root`、`source-untracked`、`source-symlink-escape`、`source-digest-mismatch`、`candidate-mismatch`、`version-unsupported`、`report-field-missing` |

报告只引用原事实，不存储 prompt、token、密钥、任务状态镜像或审批副本；历史报告原封保留，新输入产生新报告。

## 四个串行叶子（Task Forest：TF-0633 为父，四子按 C1→C2→C3→C4 `depends_on`；C1 依赖 TF-0632）

| 叶 | 写集（只允许这些路径） | 验收产物（磁盘） | 回读方式 |
|---|---|---|---|
| **C1 来源 / owner / 消费者清单** | `harness/specs/fixtures/ontology-lite-existing-contracts/provenance/{relations.json,SHA256SUMS,credential-scan.json}` | `relations.json`（schema `ProductSemanticRelationProvenance/v1`）：6 条，每条 `relationKey`、`docBasis[] {path,line}`、`enforcingOwner {path,line} \| 'documented-only'`、`consumers[]`（`grep -rnE "PRODUCT_SEMANTIC_RELATIONS" --include=*.ts --include=*.tsx --include=*.mjs electron/ src/ shared/ openclaw_runtime/src/ scripts/ tests/` 的逐文件结果）、`regressionEntry`、`evidenceGrade ∈ {executed, documented-only, gap}`、`commands[]`；`preservation: not-applicable` + 干净工作区读数；`candidate {commit,tree,dirty:false}`；`driven_by: agent`、`actor` | Read JSON；重跑 `commands[]` 对比 |
| **C2 校验器与负例** | `shared/product-semantics.ts`、`tests/unit/product-semantics.test.ts`、`harness/specs/fixtures/ontology-lite-existing-contracts/negatives/*.json` | 导出如"最小形状"；正例 = 活的 `PRODUCT_SEMANTIC_RELATIONS`（不复制第二份）；负例 fixture（schema `ProductSemanticRelationFixture/v1`：`id`、`candidate`、`context?`、`expect {rule, field}`）至少覆盖伞合同步骤二负例表的 8 行，每行 ≥ 1 个；`pnpm exec vitest run tests/unit/product-semantics.test.ts --reporter=json --outputFile=D:/tmp/tf0633-c2/vitest.json`；静态证明 `grep -rnE "PRODUCT_SEMANTIC_CONTRACT_VERSION\|validateProductSemanticRelation\|relationKey\(" electron/ src/ openclaw_runtime/src/ --include=*.ts --include=*.tsx` 为 0 行，且 `shared/product-semantics.ts` 顶层无校验调用 | Read vitest JSON（`numFailedTests === 0`，每个负例用例名含 rule id）；Read grep 输出文件 |
| **C3 版本、摘要与来源失效** | `scripts/check-evidence-refs.mjs`、`scripts/check-evidence-refs.d.mts`、`tests/unit/evidence-refs-exist.test.ts`、`harness/specs/fixtures/ontology-lite-existing-contracts/report/**`（测试用的有界 fixture） | `--report` / `--verify` / `--fixture` / `--actor` 如上；测试在 `os.tmpdir()`（本机 `TMPDIR=/d/tmp`）内构造有界 fixture：删除 / 移动来源、越界、未跟踪、symlink escape、摘要 / 候选 / 版本不匹配、缺字段 / 缺 actor / 缺退出码 → `invalid`；正例区分规范化摘要与原字节摘要；`node scripts/check-evidence-refs.mjs` 无参输出与改动前逐字相同（测试断言） | Read 报告 JSON；Read vitest JSON |
| **C4 原生门禁接入、兼容回归与收口** | `tests/unit/evidence-refs-exist.test.ts`（real gate entry 组）、`docs/clawx-product-semantics.md`、`README.md`、`README.zh-CN.md`、`README.ja-JP.md`（仅实际变化）、`docs/dev/architecture-skeleton/CONTRACT-HARDENING.md`、`harness/specs/fixtures/ontology-lite-existing-contracts/final/**`、`scripts/repository-artifacts.json`、`.gitignore` | real gate entry：`execFile(process.execPath, ['scripts/check-evidence-refs.mjs', '--fixture', …, '--report', …])` 对坏关系（exit 1）、陈旧来源（`--verify` exit 1）、空报告（`--verify` 对缺字段报告 exit 1）、遗漏调用（测试本身断言报告 `relations.length === 6` 与 `rulesEvaluated`）；文档：§Typed product relations 增加合同版本与 关系 / 定义 / 守的规则 / 为什么存在 / 拒绝项 五列表；README 三语复核结论（预期 `no-change`，写明理由）；`final/` 含最终报告、`SHA256SUMS`、`credential-scan.json`、限制清单；CONTRACT-HARDENING.md 记证据链与验收逐条对照 | Read 各文件；Read vitest JSON |

每叶收口前执行本合同 `requiredTests` 中与该叶相关的命令，并跑 `node scripts/check-local-paths.mjs`、`node scripts/check-repository-artifacts.mjs`；未运行项记 `not-run`。四叶均 done 后父节点 TF-0633 以四叶的候选 commit 与 `CONTRACT-HARDENING.md` 收口。

## 不改运行时路径的证明口径（每叶重复）

1. `git diff --stat <base>..<candidate> -- electron/ src/ openclaw_runtime/ package.json` 为 0 行。
2. 新导出符号在 `electron/`、`src/`、`openclaw_runtime/src/` 中零引用（C2 的 grep）；`shared/product-semantics.ts` 的既有导出与常量字节不变（`git diff` 只含新增块）。
3. `tests/unit/identity-scope.test.ts`、`task-ledger-reference*.test.ts`、`permission-effect-contract.test.ts` 仍绿（身份兼容映射、单向继承、最终权限 owner 不变）。
4. `scripts/check-evidence-refs.mjs` 无参调用的 stdout 逐字不变（C3 测试断言）。

## 写集边界（全部叶子共同）

- **禁止**改动 `electron/**`、`src/**`、`openclaw_runtime/**`、`package.json`、`shared/` 下除 `product-semantics.ts` 外的任何注册表、`scripts/contract-check*.{mjs,json}`、`scripts/check-semantic-authority*`（TF-0632 产物，只消费其 `scripts/lib/*` 工具）。
- 不新增 package script；不新增 Host API / UI / 运行时组件 / 第二真源；不改产品锁、默认矩阵、发布状态、GA 口径。
- 本合同的 `ownedPaths` 是四叶的并集；单叶 diff 不得越出上表该叶的写集。

## 验收

见 frontmatter `acceptance`。
