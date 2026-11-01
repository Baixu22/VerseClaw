---
id: ontology-lite-report-observability
lifecycleStatus: active
title: 语义合同硬化 C5：报告观测化与候选绑定收紧
type: task
intent: 把 TF-0636/TF-0637 落地的 ProductSemanticEvidenceReport/v1 检查器里四处"只靠 vitest 计数钉住"的弱点做成 fail-closed：rulesEvaluated 由校验器实际回报的规则集合产生而不是常量拼接；candidate.dirty=true 的报告不能是 valid；digest / rawDigest 对候选 blob（git cat-file blob HEAD:<path>）哈希而不是工作树字节；测试的有界 fixture 不再写进已跟踪 fixture 树。不改 shared/product-semantics.ts，不重签封存的 final/ 证据。
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
  - disk-temp-policy
ownedPaths:
  - scripts/check-evidence-refs.mjs
  - scripts/check-evidence-refs.d.mts
  - scripts/lib/canonical-evidence-hash.mjs
  - tests/unit/evidence-refs-exist.test.ts
  - harness/specs/fixtures/ontology-lite-existing-contracts/report/**
  - docs/dev/architecture-skeleton/CONTRACT-HARDENING.md
  - harness/specs/tasks/ontology-lite-report-observability.md
  - .gitignore
  - scripts/repository-artifacts.json
humanEvidence: not-required
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/ontology-lite-report-observability.md --no-diff
  - pnpm exec vitest run tests/unit/evidence-refs-exist.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1
  - node scripts/check-evidence-refs.mjs
  - pnpm repo:evidence:check
  - pnpm contract:check
  - node scripts/check-semantic-authority.mjs
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-local-paths.mjs
  - pnpm harness:specs:lifecycle
  - pnpm run typecheck
  - node scripts/check-no-bom.mjs
  - git diff --check
acceptance:
  - rulesEvaluated 是观测值：报告的关系规则部分是注册表校验器 validateProductSemanticRelations 在封闭探针集 RELATION_RULE_PROBES（每条声明规则恰一个探针）下实际回报的规则集合；观测集合与注册表声明的 PRODUCT_SEMANTIC_RELATION_RULES 不相等（缺失或未知）时报告 invalid、exit 1，诊断定位到字段 rulesEvaluated（规则 report-field-missing）。负例 report/fixtures/validator-noop.json 把 C2 校验器改写为空操作，经真实入口 --report 得 exit 1、恰 1 条诊断、rulesEvaluated 只剩 8 条来源规则。
  - 脏候选 fail-closed：candidate.dirty !== false 的 --report 写出 status invalid、exitCode 1，诊断定位到 candidate.dirty（规则 candidate-mismatch）；--verify 对 candidate.dirty === true 的报告以同一诊断拒绝（exit 1）。负例经真实入口：在干净候选沙箱根放一个未跟踪、未被 ignore 的临时文件，--report exit 1 且 candidate.dirty 为 true，对该报告 --verify exit 1；篡改表新增 candidate.dirty=true 一行。
  - 候选 blob 摘要：digest / rawDigest 对 git cat-file blob HEAD:<path> 的字节计算；tracked 的含义改为"在候选树 HEAD 中有 blob"；normalization.policy / rawDigestPolicy 文本写明候选 blob。正例：把沙箱里一个已跟踪 LF 来源改写成 CRLF 字节后，该来源的 digest / rawDigest 仍等于其 HEAD blob 的摘要（工作树字节与 core.autocrlf 不影响报告）；负例：同一未提交修改使 --report exit 1，且唯一的失效原因是 candidate.dirty，没有 source-digest-mismatch。
  - 封存证据兼容策略：harness/specs/fixtures/ontology-lite-existing-contracts/final/** 零字节改动、不重签，sha256sum -c final/SHA256SUMS 仍为 0；final/evidence-report.json 在本叶 HEAD 上 --verify 为 exit 1，诊断含 normalization.policy 与 normalization.rawDigestPolicy 两条 version-unsupported（旧策略报告不可比较，不静默接受），由单测钉住。
  - 测试出根：tests/unit/evidence-refs-exist.test.ts 在 os.tmpdir() 下自建一个干净候选沙箱（把真实检出里 scripts/、shared/、ontology-lite fixture 目录与两份被引用文档的工作树副本复制进一个新 git init 仓库并提交一次），所有 --report / --verify 与 buildEvidenceReport 用例以沙箱为根；有界 runtime 文件（未跟踪探针、越界 junction）写在沙箱的 report/runtime/ 下，该目录由 .gitignore 忽略；不再对真实检出做前后 git status --porcelain 快照；真实检出与其 .git 零写入，被中断的运行至多在系统临时目录留下沙箱目录。
  - 行为保持：既有 52 个 evidence-refs 用例与 21 个 C2 负例（tests/unit/product-semantics.test.ts 40/40）继续通过，因策略变更而调整的断言逐条写入 CONTRACT-HARDENING.md §13；新增负例全部经真实 spawn 入口断言退出码与诊断码；默认无参数调用 node scripts/check-evidence-refs.mjs 的 stdout / stderr / exit 逐字不变（report/default-stdout.expected.txt）。
  - CONTRACT-HARDENING.md 新增 §13 记录四项收紧的规则、复现命令、门禁 exit code 与封存证据在新策略下的 --verify 读数，并把 §12.2 第 1–4 条标注"已落地（TF-0639）"。
nonGoals:
  - 不修改 shared/product-semantics.ts：rulesEvaluated 的观测在 scripts/ 侧以探针完成，不要求校验器暴露新导出。
  - 不新增 package script、Host API、运行时组件或第二真源；不改产品锁、默认矩阵、发布状态。
  - 不重签、不改写 final/**；不升级报告 schema（仍为 ProductSemanticEvidenceReport/v1），不新增规则名（来源规则仍为 8 条封闭集，关系规则仍为注册表的 11 条）。
  - 不扩展 reverse-task-authority 的覆盖范围；不处理级联诊断的唯一性断言；不合并两份 relationKey 实现（§12.2 第 5–7 条，另议）。
  - 不引入任何以真人操作或真人数据为前置的验收条件。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CONTRACT-HARDENING.md
---

# 语义合同硬化 C5：报告观测化与候选绑定收紧

## 背景与输入

批次 C 的第五个叶子（C5，Task Forest `TF-0639`，父 `TF-0628`；`depends_on TF-0638`）。输入是收尾审查
`docs/dev/architecture-skeleton/REVIEW-20261101.md` §1 批次 C 行、§5 "C-后续：报告观测化"，以及
`docs/dev/architecture-skeleton/CONTRACT-HARDENING.md` §12.2 第 1–4 条：

1. `rulesEvaluated` 是声明而非观测：`[...PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES]` 常量拼接，C2 校验器被替换成空操作时列表不变。
2. 脏候选只是提示：`dirty: true` 的 `--report` 仍写 `status: valid` / `exitCode: 0`，`--verify` 也通过，只有 stderr NOTE。
3. `rawDigest` 绑定工作树字节而非候选 blob：`core.autocrlf` 不同的检出会得到不同摘要；已跟踪源文件的未提交修改被当成候选内容。
4. 测试向已跟踪 fixture 树 `report/runtime/` 写入未跟踪文件与 junction；前后 `git status --porcelain` 断言在并行写者下有竞态；被中断的运行留下 junction。

C3 / C4 的实现合同 `harness/specs/tasks/ontology-lite-contract-implementation.md`（报告 15 个顶层键、
`--report` / `--verify` / `--fixture` / `--actor`、exit 0/1/2 语义、来源规则 8 条封闭集）与审查提交
`2bc47aafd` 加入的注册表对照**继续有效**；本合同只在其上收紧，不复述、不覆盖。两份合同冲突时以本合同为准。

## 收紧 1：`rulesEvaluated` 由观测产生

`scripts/check-evidence-refs.mjs` 新增封闭探针集 `RELATION_RULE_PROBES`：对注册表声明的每条关系规则恰有一个
`{ rule, candidates, context? }`，`candidates` 是一组构造的关系元数据，送入注册表导出的
`validateProductSemanticRelations(candidates, context)` 时，一个正常工作的校验器必然回报该 `rule`
（`duplicate-relation` 用两条同键关系；`cross-session-quality` 与 `unsupported-contract-version` 经 `context`）。

`observeRelationRules(registry)` 逐探针执行并收集实际出现在诊断里的 `rule` 值，返回
`{ observed, missing, unknown }`：`observed` 按注册表声明顺序列出被观测到的声明规则，再附上未声明却被回报的规则；
`missing` 是声明了却从未被回报的规则；`unknown` 是回报了却未声明的规则。

`buildEvidenceReport` 用它产生报告：

- `rulesEvaluated = [...observation.observed, ...SOURCE_DIAGNOSTIC_RULES]`（来源规则是本检查器自己的封闭集，
  由本检查器的代码路径产出，保持声明）；
- `missing.length > 0 || unknown.length > 0` 时追加诊断
  `{ relationKey: null, field: 'rulesEvaluated', rule: 'report-field-missing', message }`，报告 `invalid`、`exitCode 1`。
  沿用 §12.1 的口径以既有规则报告，不新增规则名。

`--verify` 侧不变：§12.1 已要求存储报告的 `rulesEvaluated` 等于声明规则 ∪ 来源规则，一份在空操作校验器下
写出的报告（只剩 8 条）也被它拒绝。

负例 `report/fixtures/validator-noop.json`（`ContractCheckFixture/v1`）：把 `shared/product-semantics.ts` 第 322 行
`for (const candidate of candidates) {` 改写为 `for (const candidate of candidates.slice(0, 0)) {`（该行在文件中唯一），
使 `validateProductSemanticRelations` 对任何输入都返回 `{ ok: true, diagnostics: [] }`。期望：真实入口 `--report`
exit **1**，`relations.length 6`，恰 **1** 条诊断 `[report-field-missing] - rulesEvaluated`，`rulesEvaluated.length 8`，
消息列出 11 条缺失规则。

正例：对活注册表 `observed` 等于声明的 11 条（顺序相同），`missing` / `unknown` 为空；测试另断言
`RELATION_RULE_PROBES.map((probe) => probe.rule)` 与 `PRODUCT_SEMANTIC_RELATION_RULES` 逐项相等（每条规则恰一个探针）。

## 收紧 2：脏候选 fail-closed

- `buildEvidenceReport`：`candidate.dirty !== false` 时追加诊断
  `{ relationKey: null, field: 'candidate.dirty', rule: 'candidate-mismatch', message }`（`dirty === null` 时消息说明
  候选不可观测），报告 `invalid`、`exitCode 1`。原 stderr 的 `NOTE candidate is dirty …` 一行删除：现在由 FAIL 行与
  格式化诊断承载同一信息。
- `verifyEvidenceReport`：在既有的 `candidate.dirty must be a boolean` 之外，`stored.dirty === true` 时追加
  `[candidate-mismatch] - candidate.dirty`；一份自述脏候选的报告不可能是干净候选证据。
- `candidate.dirty` / `dirtyPaths` 的含义不变（`git status --porcelain` 全部行）。

负例形状（均经真实入口，在收紧 4 的干净候选沙箱里运行）：

| 负例 | 最小动作 | 期望 |
|---|---|---|
| 未跟踪文件 | 在沙箱根写 `tf0639-dirty-probe.txt`（未跟踪、未被 ignore），`--report` | exit 1；`candidate.dirty true`、`dirtyPaths` 含该文件；恰 1 条诊断 `[candidate-mismatch] - candidate.dirty`；`status invalid` |
| 脏报告 `--verify` | 对上一报告 `--verify`（文件已删除、沙箱恢复干净） | exit 1；含 `[candidate-mismatch] - candidate.dirty` 与 `[report-field-missing] - status` |
| 篡改表 | 干净报告上 `candidate.dirty = true; dirtyPaths = ['x']` | `invalid`，`candidate-mismatch` 定位 `candidate.dirty` |

## 收紧 3：对候选 blob 哈希

- 新增 `collectCandidateBlobs(root, refs)`：一次 `git cat-file --batch`（stdin 每行 `HEAD:<normalizedRef>`）读回每个引用在
  候选树里的 blob 字节，返回 `Map<normalizedRef, Buffer>`；git 失败时返回 `null`（永不假定）。不在 HEAD 树里的路径不出现在
  Map 中。
- `describeSourceRef(root, ref, { candidateBlobs, rewrites, readPaths })` 取代原 `trackedPaths` 选项：
  `tracked = candidateBlobs === null ? null : candidateBlobs.has(normalized)`；被哈希的字节 = `rewrites[normalized]`
  （内存 fixture 仍然代表"候选内容变了"）否则 `candidateBlobs.get(normalized)`；没有候选 blob（未跟踪 / 缺失 / 越界 /
  symlink escape / git 不可用）时 `digest` / `rawDigest` 为 `null`。`exists`、`insideRoot`、`symlinkEscape` 仍是工作树事实。
- `tracked` 的含义从"在 git 索引中"收紧为"在候选树 HEAD 中有 blob"；`source-untracked` 消息相应改为
  "exists but is not part of the candidate commit (HEAD)"。原 `collectTrackedPaths`（`git ls-files`）删除。
- `EVIDENCE_NORMALIZATION.policy` / `rawDigestPolicy` 文本改写为对候选 blob 的描述；`scripts/lib/canonical-evidence-hash.mjs`
  的 `canonicalEvidenceBytes` 不变（仍对 blob 字节做 CRLF/CR→LF 规范化）。
- `core.autocrlf`：`git cat-file blob` 返回的是对象库里的字节，不经过任何检出时的行尾转换，因此不同 `core.autocrlf`
  的检出对同一候选得到逐字相同的 `relations[*].sourceRefs[*]`；测试以"把沙箱里一个 LF 来源的工作树副本改写成 CRLF"
  证明工作树字节不进入摘要（同一机制覆盖 autocrlf 转换与手工编辑两种来源）。

正例 / 负例（真实入口，沙箱）：

| 用例 | 动作 | 期望 |
|---|---|---|
| 工作树字节不进入摘要 | 把沙箱 `docs/modules/multi-agent-and-tasks.md`（HEAD 为 LF）改写为 CRLF 字节，`--report` | 该路径每个 `sourceRefs` 项的 `digest` / `rawDigest` 等于 `digestEvidenceBytes(git cat-file blob HEAD:<path>)`，与改写前的报告逐项相同 |
| 未提交修改使报告失效 | 同一次运行 | exit 1；诊断恰 1 条 `[candidate-mismatch] - candidate.dirty`，**无** `source-digest-mismatch`；`git checkout -- <path>` 后沙箱恢复干净 |
| 纯函数 | `describeSourceRef(sandbox, path, { candidateBlobs: new Map([[path, lfBytes]]) })` 而工作树是 CRLF | `digest === rawDigest === sha256(lfBytes)` |

因策略变更而调整的既有断言（逐条，见 CONTRACT-HARDENING.md §13.5）：

1. `source-untracked` 负例：未跟踪文件没有候选 blob，报告记 `digest: null` / `rawDigest: null`，并把该引用列入
   `unverified`（reason `source-untracked`）。C3 原断言"仍记录两种摘要"正是 §12.2 第 3 条要去掉的工作树哈希。
2. 正例里期望摘要的来源从 `readFileSync(<worktree>)` 改为 `git cat-file blob HEAD:<path>`（`source-line-endings` 与
   `--report on the live registry`）。在 `core.autocrlf=false` 且干净的检出上两者字节相同。
3. `describeSourceRef` 的两处直接调用把 `{ trackedPaths: null }` / `{ trackedPaths: new Set() }` 换成
   `{ candidateBlobs: null }` / `{ candidateBlobs: new Map() }`，断言不变。

### 封存 `final/` 证据的兼容策略

`final/evidence-report.json`（候选 `6944b059c`）是按旧策略（工作树字节）生成的，且其 `normalization.policy` /
`rawDigestPolicy` 文本记录的就是旧策略。本叶选择**策略文本变更 → 旧报告 `version-unsupported`** 这一条路，不保留
对旧策略的只读校验分支：一份摘要取自工作树的报告无法在不重新推导摘要的情况下对照候选 blob 复核，而重新推导就是重签。
因此：

- `final/**` 零字节改动、不重签，`sha256sum -c final/SHA256SUMS` 仍为 0；
- 在本叶 HEAD 上 `node scripts/check-evidence-refs.mjs --verify final/evidence-report.json` 为 exit **1**，诊断为
  `[version-unsupported] - normalization.policy`、`[version-unsupported] - normalization.rawDigestPolicy`、
  `[candidate-mismatch] - candidate.commit`、`[candidate-mismatch] - candidate.tree`，以及 TF-0638 修改
  `docs/clawx-product-semantics.md` 后已存在的该文件 `source-digest-mismatch`（digest + rawDigest，每条引用它的关系各两条）；
- 单测钉住其中两条 `version-unsupported`（其余随后续 HEAD 变化，不钉）；
- 报告 schema 仍为 `ProductSemanticEvidenceReport/v1`：字段集合未变，只有摘要的取字节方式与策略文本变化，
  由 `normalization` 字段承担版本语义（C3 把它设计成"不可比较即 `version-unsupported`"正是为此）。

## 收紧 4：测试出根与干净候选沙箱

`tests/unit/evidence-refs-exist.test.ts`：

- 模块顶层（`describe` 收集前）构建沙箱：`mkdtemp(os.tmpdir()/tf0639-c5-)/candidate`；用
  `git ls-files -z -co --exclude-standard -- scripts shared harness/specs/fixtures/ontology-lite-existing-contracts
  docs/clawx-product-semantics.md docs/modules/multi-agent-and-tasks.md README.md` 枚举真实检出里这些路径下
  已跟踪与未跟踪但未被 ignore 的文件（工作树就是被测候选，本变更集新增的 fixture 也在内），逐个复制进沙箱；
  写一份只含 `/harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/` 的 `.gitignore`
  （真实 `.gitignore` 整体忽略 `docs/**`，照搬会把两份被引用文档挡在沙箱提交之外）；`git init -b main`、
  `core.autocrlf=false`、`commit.gpgsign=false`、固定 user.name / user.email，`git add -A`、提交一次。
  本机实测约 800 个文件、8 MB、1–2 s；`git status --porcelain` 为空。
- `afterAll` 删除整个临时目录。真实检出与其 `.git` 零写入：没有 worktree 登记、没有悬空对象、没有 prune。
- 所有 `--report` / `--verify` spawn 以 `node <sandbox>/scripts/check-evidence-refs.mjs` + `cwd: sandbox` 运行
  （被测的是工作树里**正在编辑**的检查器副本，而不是 HEAD 的旧副本）；所有 `buildEvidenceReport` / `verifyEvidenceReport`
  直接调用以 `root: sandbox`、`candidate: describeCandidate(sandbox)`；默认无参调用与 `checkEvidenceRefs` 仍以
  真实检出为根（它们需要全部 188 个引用路径且与脏否无关）。
- 有界 runtime 文件写在 `<sandbox>/harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/`；
  真实 `.gitignore` 新增同一行（在生成块之外），于是该目录既不被 `git cat-file HEAD:` 命中（`tracked false`）也不进入
  `git status --porcelain`（不污染 `candidate.dirty`）。真实检出里的同名目录不再被创建。
- 原 `porcelainBefore` 快照与 `left the working tree as it found it` 改为：文件末尾断言沙箱 `dirtyPaths` 为空、
  沙箱无 `report/runtime/`、真实检出无 `report/runtime/`；没有对真实检出的前后比较，因此没有并行写者竞态。
- 被中断的运行：真实检出零写入；最坏情况在系统临时目录留下 `tf0639-c5-*/`。

为什么不用 `git worktree add --detach`：worktree 只能检出 HEAD，提交前的测试会去跑**旧**检查器；它还要在共享的
`.git/worktrees/` 里登记并依赖 `prune`。独立 `git init` 沙箱两者皆无。真实候选上的 `--report` 读数（§13 的
"候选提交后复核"）仍用 `git worktree add --no-checkout --detach` + `sparse-checkout set --no-cone` + `checkout --detach HEAD`
在 1–2 s 内得到一个干净的候选检出（`_s07cfg/` 这类他人留下的未跟踪目录不会进入 worktree）。

`scripts/repository-artifacts.json` 只在 `check-repository-artifacts` 对新增 ignore 行提出要求时才改动（预期不需要：
该目录下没有任何跟踪文件）。

## 写集与硬边界

只允许改动 frontmatter `ownedPaths`。**禁止**改动 `shared/product-semantics.ts` 与 `shared/` 其余注册表、
`harness/specs/fixtures/ontology-lite-existing-contracts/final/**`、`provenance/**`、`negatives/**`、`package.json`、
`scripts/contract-check*`、`scripts/check-semantic-authority*`、`scripts/lib/ts-import-hooks.mjs`、
`scripts/lib/registry-fixture.mjs`、`electron/**`、`src/**`、`openclaw_runtime/**`。`report/` 下既有 8 个 fixture、2 个
来源文件、`default-stdout.expected.txt`、`credential-scan.json` 零字节改动；`report/SHA256SUMS` 只追加新文件的行；
新增文件为 `report/fixtures/validator-noop.json` 与 `report/credential-scan-c5.json`。

## 证据回读与收口

| 验收条 | 证据 | 回读方式 |
|---|---|---|
| 1 观测化 | `validator-noop` 报告 JSON（exit 1、`rulesEvaluated` 8 条、1 条诊断）；正例报告 `rulesEvaluated` 19 条 | Read 报告 JSON / vitest JSON |
| 2 脏候选 | 未跟踪探针报告 JSON（`dirty true`、`status invalid`、`exitCode 1`）；`--verify` stderr | Read 报告 JSON / vitest JSON |
| 3 候选 blob | CRLF 改写前后两份报告的 `sourceRefs` 摘要相同；`git cat-file blob` 摘要相等 | Read 报告 JSON |
| 4 封存兼容 | `final/evidence-report.json` `--verify` stderr 含两条 `version-unsupported`；`sha256sum -c` 0 | 终端读数 + vitest JSON |
| 5 出根 | 沙箱 `git status --porcelain` 空；真实检出无 `report/runtime/`；`.gitignore` 行 | Read vitest JSON / `git check-ignore -v` |
| 6 行为保持 | vitest JSON `numFailedTests === 0`；`cmp default-stdout.expected.txt` | Read vitest JSON |
| 7 文档 | CONTRACT-HARDENING.md §13 与 §12.2 标注 | Read 文档 |

收口按 `AGENTS.md` §Task Forest closure policy 与 `harness/specs/rules/task-forest-autoclose-and-roles.md`：
全部验收条由磁盘产物核实、`base_graph_hash` 仍匹配、`todo --json` 中 stored-status `ready` 恰为 TF-0639，
则 `proposal-save` → `proposal-apply --yes` → `validate` → `export`；同一提案给 TF-0628 的 summary 追加
"审查后续 TF-0638/TF-0639 已落地"，不改 TF-0628 状态，不置任何节点 ready（本叶是批次 C 最后一个叶子）。
未运行的全量门禁（全量 `pnpm test`、E2E、lint 全仓、agent-dev、live provider）如实记 `not-run`。
所有产物 `driven_by: agent`。

## 验收

见 frontmatter `acceptance`。
