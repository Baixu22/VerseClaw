# GATE-BASELINE —— 既有红门基线与 L1/L2 收紧定义

> **2026-09-10 收口说明**：按用户“通过就 done，不通过就处理问题”的指令，复核通过的
> 工作应更新 Task Forest 终态；旧 `review_needed + landed-unwired` 记录保留为历史裁决。
> 本更新只纠正状态停滞，不改下方冻结白名单、预算或任何实际能力声明；未通过的门仍须修复。

来源节点：**TF-0142**（D4 决策）。产出者：车道 2。车道 1 不写入本文件。
基线观测于 HEAD **`fe469cbff`**，UTC **2026-08-24T15:53:26Z**。

本文件是 §R2 分层门（TF-0106）的**数据依据**：§R2 定义门的结构，本文件定义门在当前工作树上的**可达判据**。
TF-0106 依赖 TF-0142（blocking），方向即为此。

---

## 0. 本文件要解决的问题

§R2 若把 L1/L2 定义为「固定 exit-code 组全绿」，则在当前工作树上**永远不可达**：三个门为红。
不先裁定「哪些属本轮修复范围 / 哪些属噪声 / 哪些属既有债务」，G-MOAT 验收判据第 2 条「L1 门整体 exit 0」就被既有红门污染，整个验收体系失效。

**本决策不修任何测试、不重算任何哈希、不放宽任何守卫**（TF-0142 `non_goals`）。只做分类与门定义收紧。

---

## 1. 分类方法（先定判据，再分类）

三分类沿用 §R5 范围-2 的三分法，落到门上：

| 类别 | 定义 | 对 L1/L2 的效力 |
|---|---|---|
| **must-fix**（本轮必修） | 失败根因在本轮范围-1 内，且本轮有节点认领 | **必须 exit 0**；任何失败即阻塞 |
| **exempt-noise**（噪声-记录后豁免） | 失败根因为环境（平台 / 加载器）或仓库既有未提交改动，非本轮引入 | 列入白名单；**不阻塞**，但计数被钉住 |
| **backlog-debt**（既有债务-移入 backlog） | 失败根因为其他 global_task 的未完成交付物（缺验收产物 / 证据漂移） | 列入白名单；**不阻塞**；记归属 owner |

### 1.1 「是否由本轮引起」的机械判据

这是分类的**唯一硬判据**，不靠判断力：

```
git diff --name-only 590588791..HEAD          # 本轮全部改动文件
∩ {失败项的主体文件集}  ==  ∅   ⟹  非本轮引起
```

`590588791` 是本轮开工前的 HEAD（S0 提交 `f005991b7` 的父）。

**实测结果**：本轮至 `fe469cbff` 共改动 **15 个文件** —— 13 个 `docs/dev/context-moat/**`、
`openclaw_runtime/scripts/check-production-reachable.mjs`、
`openclaw_runtime/src/config/{types.openclaw.ts, runtime-feature-leaves.ts}`。

- 与 `pnpm test` 的 **17 个失败文件**取交集 = **∅**
- 与 `maturity:validate` 的 **25 个失配文件**取交集 = **∅**

⟹ **本轮至今未引入任何一项门失败。** 两条交集均可用上述命令复算。

### 1.2 一处诚实的方法局限（不可用 stash 消解）

要把 `exempt-noise` 内部再细分为「确由未提交改动引起」vs「committed 既有债务」，标准手段是 stash 掉脏改动后重跑。
**本轮禁止**：§R4 防脏树条款规定仓库既有未提交改动（204 个 tracked-modified / 284 porcelain 条目）**不属任何车道**，不得提交、不得 stash。两条车道共用一个工作树，stash 是跨车道写。

故对下表中标注 `basis: subject-files-dirty` 的条目，我给出的是**相关性证据**（断言主体文件正处于未提交修改态）而非因果证明。
**这不影响门的行为**：`exempt-noise` 与 `backlog-debt` 对 L1/L2 的效力完全相同（均入白名单、均不阻塞），差别只在 backlog 归属。故该局限不构成判据缺口。

---

## 2. 门 1：`config-schema-parity` —— must-fix，已修复

| 项 | 值 |
|---|---|
| 命令 | `npx vitest run tests/unit/config-schema-parity.test.ts` |
| 开工前（`590588791`） | **exit 1** —— `1 failed / 114 passed (115)`；`AssertionError: zod-schema.ts accepts runtime leaves that RuntimeFeatureConfig does not declare: ["runtime.memory.candidateGeneration"]` |
| 当前（`fe469cbff`） | **exit 0** —— **116 passed / 0 failed** |
| 分类 | **must-fix** |
| 认领节点 | **TF-0109（T-P0-3）**，状态 `done`，已过车道 1 的 §R1 审核 |
| 豁免条目 | **0 条。本门不接受任何豁免。** |

计数 115 → 116 的成因：方向 1 是 `it.each(fixtureLeaves)`（`config-schema-parity.test.ts:98`），每个夹具叶子生成一个独立 case，新增 1 叶子即 +1 case。**实质判据是「0 failed」**，非固定总数。

> **本门是 L1 的使能前置**：它是唯一「根因明确、范围内、本轮认领」的红门。它转绿后 L1 才可能作为判据存在。

---

## 3. 门 2：`pnpm test` —— 全部非本轮引起

| 项 | 值 |
|---|---|
| 命令 | `pnpm test` |
| 当前 | **exit 1** —— `17 failed / 797 passed / 3 skipped (817 files)`；`22 failed / 6991 passed / 53 skipped (7066 tests)` |
| 其中套件加载失败 | **4 个**（在任何断言执行前失败） |
| must-fix | **0 项** |
| 本轮引起 | **0 项**（§1.1 交集为空） |

### 3.1 与本轮的关系：`test:dcs` 与失败集完全不相交

`pnpm test` 的尾段是 `pnpm run test:dcs`。实测 `test:dcs` 的文件清单与上述 17 个失败文件**零重叠**（脚本比对 `package.json` 的 `test:dcs` 字符串）。
即：本轮车道相关的测试子集全绿（`test:dcs` = exit 0），22 项失败全部落在车道外的子系统。

### 3.2 失败清单与分类（17 文件 / 22 项 + 4 套件加载）

| # | 文件 | 失败数 | 观测到的根因 | 分类 | 归属 |
|---|---|---:|---|---|---|
| 1 | `tests/integration/p1-orchestration-boundary.integration.test.ts` | 加载 | `TypeError: The URL must be of scheme file` | exempt-noise (env-loader) | 平台/加载器 |
| 2 | `tests/integration/p1-sensitive-content-boundary.integration.test.ts` | 加载 | 同上 | exempt-noise (env-loader) | 平台/加载器 |
| 3 | `tests/unit/memory-gateway-handlers.test.ts` | 加载 | 同上 | exempt-noise (env-loader) | 平台/加载器 |
| 4 | `tests/unit/role-orchestration-methods.test.ts` | 加载 | 同上 | exempt-noise (env-loader) | 平台/加载器 |
| 5 | `tests/unit/runtime-lifecycle-governance.test.ts` | 1 | `Command failed: wmic process get ProcessId,ParentProcessId,CreationDate /format:csv` | exempt-noise (env-platform) | Windows 11 无 WMIC |
| 6 | `tests/unit/rc09-ownership-matrix.test.ts` | 4 | `ENOENT: artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json` | **backlog-debt** | TF-0028 / RC-09 |
| 7 | `tests/unit/rc01-authority-inventory-baseline.test.ts` | 3 | `Error: git ls-files failed:` + `acceptedBaseSha` 不等于 merge-base | **backlog-debt** | TF-0029 / RC-01R |
| 8 | `tests/unit/runtime-authority-convergence-control-pack.test.ts` | 1 | 工程证据 + 显式用户验收缺失时不允许 done | **backlog-debt** | TF-0028 |
| 9 | `tests/unit/chat-render-reachability.test.tsx` | 2 | plan 面渲染断言不符 | exempt-noise (subject-files-dirty) | TF-0021 / TF-0025 |
| 10 | `tests/unit/chat-question-directory.test.tsx` | 1 | 重复问题目录项断言不符 | exempt-noise (subject-files-dirty) | TF-0021 / TF-0025 |
| 11 | `tests/unit/chat-save-to-knowledge.test.tsx` | 1 | toolbar 仍含 more-actions 菜单 | exempt-noise (subject-files-dirty) | TF-0021 / TF-0025 |
| 12 | `tests/unit/fakecoding-design-system.test.ts` | 1 | page shell 未默认 28px sans / 零字距 | exempt-noise (subject-files-dirty) | TF-0021 |
| 13 | `tests/unit/first-product-claims.test.ts` | 1 | 产品面仍含禁用的 graduation 措辞 | exempt-noise (subject-files-dirty) | TF-0021 |
| 14 | `tests/unit/knowledge-steward-semantic-pass.test.ts` | 4 | semantic pass 集成断言不符 | exempt-noise (subject-files-dirty) | TF-0007 / knowledge |
| 15 | `tests/unit/tf0018-sekb-no-auto-writeback.test.ts` | 1 | confirm-only writeback 断言不符 | exempt-noise (subject-files-dirty) | TF-0018 / SEKB |
| 16 | `tests/unit/local-control-plane.test.ts` | 1 | 只读 Gateway descriptor 注册断言不符 | **backlog-debt** | TF-0010 / 控制面 |
| 17 | `tests/unit/security-verification-shadow.test.ts` | 1 | MVP 方法未全部作为 `operator.read` core descriptor 广告 | **backlog-debt** | TF-0010 / 控制面 |

小计（已用 §6 白名单 JSON 机械复算，见下表）：

| 类别 | 文件数 | 套件加载失败 | 具名失败测试数 |
|---|---:|---:|---:|
| must-fix | 0 | 0 | 0 |
| exempt-noise | 12 | 4 | 12 |
| backlog-debt | 5 | 0 | 10 |
| **合计** | **17** | **4** | **22** |

对账：文件 12+5 = **17** ✓（等于 `pnpm test` 报告的 17 failed files）；具名测试 12+10 = **22** ✓（等于报告的 22 failed tests）。
4 个套件在**加载期**失败（任何断言执行前），vitest 不将其计入 22 项 failed tests，故单列一列。

> 上表由 §6 的机器可读白名单直接复算得出，不是手工计数 —— 复算脚本见 §6。本文件的所有计数都必须与该 JSON 一致；不一致即以 JSON 为准并修正正文。

---

## 4. 门 3：`maturity:validate` —— 既有漂移，本轮只保证不新增

| 项 | 值 |
|---|---|
| 命令 | `pnpm maturity:validate` |
| 当前 | **exit 1** |
| 失败位置 | 6 脚本 `&&` 链的**第 4 个** —— `validate-system-maturity-evidence.mjs`，报 `FAILED (25)` |
| 失配项 | **25 项 A2 证据哈希失配** |
| 本轮引起 | **0 项**（§1.1 交集为空） |
| 分类 | **backlog-debt**（全部 25 项） |

### 4.1 一处必须说明的盲区：`&&` 链短路

`maturity:validate` = 6 个脚本以 `&&` 串联：

```
audit-baseline-check → validate-system-maturity-plan → validate-test-gates
  → validate-system-maturity-evidence   ← 在此 exit 1，链中断
  → run-system-maturity-residual-audit  ← 未执行，状态未知
  → validate-system-maturity-traceability ← 未执行，状态未知
```

⟹ **第 5、6 个脚本从未运行，其绿/红状态是未知量，不是已知绿。**
任何声称「maturity 只有 25 项问题」的表述都是不完整的。本文件把它记为**已知盲区**，并在 §5.2 的 L2 判据中要求单独跑第 5、6 个脚本以消除盲区（属 backlog，不属本轮）。

> **补记（本节初版漏声明，属我的缺陷）：这两条补跑命令有副作用。** 实测 `maturity:traceability` 会改写 `artifacts/system-maturity/P7-001/traceability-report.json`（+246/-108），而该文件**正是 §4.3 那 25 项基线中的一项**（见基线清单 `P7-001|artifacts/system-maturity/P7-001/traceability-report.json`）—— **这道门会改写它所校验的对象**。
>
> 两层后果：①不复原即为 §R5 技术-7「不追溯修改历史 artifacts」的违反；②两车道共用工作树，该改动不属任何车道（§R4.9）。故 §R2.3 已补一条强制收尾：逐段跑（不用 `&&`），跑完验 `git status --porcelain -- artifacts/system-maturity` 为空，非空则 `git checkout --` 复原。
>
> **自修改的门不得以「跑过了」为凭据**：不复原则下一轮比对的是被上一次运行改写过的基线，「只保证 25 项不增长」随即失去意义。本项由车道 1 在 M0 L2 收口尝试中实测发现并记为 backlog-P1，路由给我；此处按判据缺口处理而非 backlog，因为它使本门的承重条款失效。

### 4.2 漂移性质：不是脏树噪声，是 committed 漂移

实测：25 项失配所涉文件中，**多数在工作树是 clean 的**（`shared/host-api/contract.ts`、`src/lib/host-api.ts`、`electron/main/ipc-handlers.ts`、`electron/services/workspace-permissions.ts`、`electron/utils/{store,channel-config}.ts`、`openclaw_runtime/src/agents/role-spawn.ts`、`scripts/collect-p7-003-evidence.mjs` 等均 `[clean]`）。

⟹ 失配不是未提交改动造成的，而是**证据 manifest 相对已提交代码陈旧**。这是长期既有技术债，归 `backlog-debt` 而非 `exempt-noise`。
（仅 `package.json` 与 `shared/types/workspace.ts` 在工作树为 `M`。）

### 4.3 基线哈希（钉住的 25 项，`<maturity-id>|<path>`）

本轮**只保证该集合不增长**，不重算任何哈希（`non_goals`）。

```
P0-003|package.json
P0-003|src/lib/host-api.ts
P0-003|tests/unit/host-api-facade.test.ts
P0-003|vitest.config.ts
P0-004|package.json
P1-001|shared/host-api/contract.ts
P1-001|src/lib/host-api.ts
P1-002|electron/main/ipc-handlers.ts
P1-002|electron/main/ipc/host-invoke.ts
P1-003|electron/services/workspace-permissions.ts
P2-001|electron/services/workspace-permissions.ts
P2-001|electron/services/workspaces-api.ts
P2-001|shared/types/workspace.ts
P2-003|openclaw_runtime/src/agents/role-spawn.ts
P7-001|artifacts/system-maturity/P7-001/traceability-report.json
P7-003|electron/utils/store.ts
P7-003|package.json
P7-003|scripts/collect-p7-003-evidence.mjs
P7-003|shared/host-api/contract.ts
P7-004|package.json
P8-001|electron/utils/channel-config.ts
P8-001|package.json
P8-002|electron/utils/channel-config.ts
P8-003|package.json
P8-004|package.json
```

复算命令：

```bash
pnpm maturity:validate 2>&1 | grep -E "FAIL  A2 .* evidence hash mismatch" | sed -E 's/^FAIL  A2 ([A-Z0-9-]+) evidence hash mismatch for ([^:]+):.*/\1|\2/' | sort -u
```

---

## 5. 收紧后的 L1 / L2 定义

### 5.1 L1（每个 task 收口，分钟级）—— 必修全绿，**不含** `pnpm test` / `maturity:validate`

> **命令清单以 DEV-PROTOCOL.md §R2.2 为准**（TF-0106 落地后 §R2 是门命令的单一真相源）。本文件只保留裁定依据与基线输出，不再复制命令清单。§R2.2 的 L1 为**六条**：`lint:bom` / `contract:check` / `typecheck:node` / `lint:dcs` / `test:dcs` / `config-schema-parity + default-config-matrix`（后者本文件初稿遗漏，已并入 §R2.2）。

L1 的判据是**必修项全绿**，而非「所有测试全绿」。

**为什么 `pnpm test` 不在 L1**：其 22 项失败零本轮引起、且与 `test:dcs` 零重叠（§3.1）。把它放进 L1 等于让每个 task 的收口都卡在别的 global_task 的未完成交付物上 —— 这正是「永远不可能变绿的理想门」。`pnpm test` 移入 L2，按白名单判定。

**L1 基线输出**（AC-3，观测于 TF-0109 收口后）。注：本文件初稿基线记于 `fe469cbff`（5 条）；§R2.2 落地后的权威六条基线记于 `ef66a1c28`，见 DEV-PROTOCOL.md §R2.2。两者一致（均全 exit 0），差别仅第 6 条 `default-config-matrix` 的并入：

```
L1 BASELINE @ fe469cbff 2026-08-24T15:53:26Z  （5 条，本文件初稿）
  pnpm run lint:bom = exit 0
  pnpm run contract:check = exit 0
  pnpm run typecheck:node = exit 0
  pnpm run lint:dcs = exit 0
  pnpm run test:dcs = exit 0
  npx vitest run tests/unit/config-schema-parity.test.ts = exit 0
     Test Files  1 passed (1)
          Tests  116 passed (116)
```

### 5.2 L2（里程碑收口，重）—— 白名单差分判定

> **命令清单以 DEV-PROTOCOL.md §R2.3 为准。** 本表保留判据语义。

L2 不要求 exit 0，要求**失败集 ⊆ 白名单**：

| 门 | 判据 |
|---|---|
| `pnpm lint:check` | exit 0（无豁免） |
| `pnpm typecheck` | exit 0（无豁免） |
| `pnpm contract:check` | exit 0（无豁免） |
| `pnpm test` | 失败集 ⊆ §6 白名单 `pnpm_test`，且 `config-schema-parity` 不在失败集内 |
| `pnpm maturity:validate` | A2 失配集 ⊆ §4.3 的 25 项；**且**须单独跑 `maturity:residual` 与 `maturity:traceability` 以消除 §4.1 盲区 |

### 5.3 回归定义（本文件的承重条款）

> **白名单之外的任何失败 = 回归，一律阻塞。**
> 白名单是**显式清单**（文件名 + 测试名），不是「已知失败」这类模糊表述。
> 白名单条目数**只允许减少，不允许增加**。新增条目须走 `record_deviation`（§R4 偏差四类之 (c)「问题被判为本轮不修」）。

推论：本文件把「22 项失败」从一个模糊的坏状态，变成一个**钉死的数字**。任何人让它变成 23，都必须留下偏差记录。

---

## 6. 机器可读白名单（AC-2）

下方 JSON 由 `<!-- GATE-BASELINE-WHITELIST:BEGIN/END -->` 包裹，可被脚本确定性切片。

抽取命令（已实测：提取后 `node -e "JSON.parse(...)"` 通过，8120 字节）—— 锚定行首标记并只取其中的 ```json 围栏，避免匹配到本说明段里的标记字样：

```bash
sed -n '/^<!-- GATE-BASELINE-WHITELIST:BEGIN -->$/,/^<!-- GATE-BASELINE-WHITELIST:END -->$/p' \
  docs/dev/context-moat/GATE-BASELINE.md \
  | sed -n '/^```json$/,/^```$/p' | sed '1d;$d'
```

<!-- GATE-BASELINE-WHITELIST:BEGIN -->
```json
{
  "schemaVersion": 1,
  "sourceNode": "TF-0142",
  "observedAtHead": "fe469cbff",
  "observedAtUtc": "2026-08-24T15:53:26Z",
  "roundStartRef": "590588791",
  "roundCausedFailures": 0,
  "l1MustFixCommands": [
    "pnpm lint:bom",
    "pnpm contract:check",
    "pnpm typecheck:node",
    "pnpm lint:dcs",
    "pnpm test:dcs",
    "npx vitest run tests/unit/config-schema-parity.test.ts tests/unit/default-config-matrix.test.ts"
  ],
  "l1CommandsAuthority": "DEV-PROTOCOL.md §R2.2 (TF-0106) is the single source of truth for gate command lists; this array must mirror it.",
  "gates": {
    "config_schema_parity": {
      "classification": "must-fix",
      "requiredExitCode": 0,
      "exemptions": [],
      "claimedBy": "TF-0109",
      "status": "fixed"
    },
    "pnpm_test": {
      "requiredExitCode": null,
      "baselineFailedFiles": 17,
      "baselineFailedTests": 22,
      "baselineSuiteLoadFailures": 4,
      "measuredAt2026_09_05": {
        "result": "1 failed / 820 passed / 3 skipped (824 files); 1 failed / 7240 passed / 53 skipped (7294 tests); duration 553s; exit 1",
        "verdict": "R2.3 criterion PASS - the single failure is inside the whitelist and config-schema-parity is not in the failure set",
        "theOneFailure": "tests/unit/runtime-lifecycle-governance.test.ts > 'drains 50 create/stop process-tree cycles without registry, timer, or heap leaks' - AssertionError: expected 18.448104858398438 to be less than or equal to 2 (heapDeltaMb)",
        "exactPairMatch": "the (file, test) pair is whitelisted verbatim, so the criterion is met on its own terms",
        "staleReasonString": "that entry's recorded reason reads 'wmic absent on Windows 11'; the observed failure mode is now a heap-delta assertion instead. The criterion is the (file, test) pair, not the reason, so the gate still passes - but the reason is stale and is recorded as such rather than quietly rewritten.",
        "sixteenEntriesNowPassing": "16 of the 17 whitelisted files pass. Under only-shrink they MAY be removed without a deviation, and doing so would tighten the gate. NOT removed on a single observation: 12 were classed exempt-noise/subject-files-dirty against a neighbour tree that is still dirty, so they pass despite the stated cause persisting - which means the recorded cause was wrong for them and a second reading is needed before deciding what the real cause was. Recorded as removal candidates, decision deferred.",
        "instrumentNote": "measured on the shared tree, not a detached worktree. Unlike maturity, pnpm test has no self-modifying segment; the shared-tree dirt is the subject of 12 exemptions, so a clean-HEAD run would answer a different question than the gate asks."
      },
      "shrunkAt2026_09_05": {
        "from": 17,
        "to": 1,
        "removedEntries": 16,
        "basis": "two independent readings on 2026-09-05 - the full suite (824 files, 553s) and an isolated re-run of exactly these 17 files (48.75s) - both show 16 of 17 passing. Only-shrink permits removal without a deviation, and removal tightens the gate.",
        "whyRemovalIsSafeNowAndWasNotBefore": "12 of the 16 were classed subject-files-dirty, i.e. blamed on the neighbour tree - which is STILL dirty while they now pass, so the recorded cause was wrong for them. That whole class now belongs in an outOfRound ledger, not in exemptions: D4.2 supplies the attribution criterion and outOfRoundRule supplies the three-part evidence bar. If any of the 16 regresses, it surfaces as a blocking failure and has to earn a ledger entry with an introducing SHA - which is the behaviour the gate should have had all along.",
        "tradeoffAccepted": "a tighter gate can block a future milestone on neighbour churn. Accepted: the ledger route costs minutes per item and makes real regressions visible, whereas 16 stale entries silently exempt 16 files from regression detection.",
        "removed": [
          "tests/integration/p1-orchestration-boundary.integration.test.ts",
          "tests/integration/p1-sensitive-content-boundary.integration.test.ts",
          "tests/unit/memory-gateway-handlers.test.ts",
          "tests/unit/role-orchestration-methods.test.ts",
          "tests/unit/rc09-ownership-matrix.test.ts",
          "tests/unit/rc01-authority-inventory-baseline.test.ts",
          "tests/unit/runtime-authority-convergence-control-pack.test.ts",
          "tests/unit/local-control-plane.test.ts",
          "tests/unit/security-verification-shadow.test.ts",
          "tests/unit/chat-render-reachability.test.tsx",
          "tests/unit/chat-question-directory.test.tsx",
          "tests/unit/chat-save-to-knowledge.test.tsx",
          "tests/unit/fakecoding-design-system.test.ts",
          "tests/unit/first-product-claims.test.ts",
          "tests/unit/knowledge-steward-semantic-pass.test.ts",
          "tests/unit/tf0018-sekb-no-auto-writeback.test.ts"
        ]
      },
      "exemptions": [
        { "file": "tests/unit/runtime-lifecycle-governance.test.ts", "tests": ["drains 50 create/stop process-tree cycles without registry, timer, or heap leaks"], "class": "exempt-noise", "basis": "env-threshold", "reason": "heapDeltaMb assertion overshoots its <=2 threshold by a varying margin: 18.45 in the full-suite run, 10.43 in an isolated 17-file re-run. The originally recorded cause (wmic absent on Windows 11) is NOT the current failure mode and was corrected rather than left to rot.", "owner": "platform", "measuredTwice": "2026-09-05 full suite and isolated re-run, both fail, both over threshold" }
      ]
    },
    "maturity_validate": {
      "requiredExitCode": null,
      "failsAtScript": "validate-system-maturity-evidence.mjs",
      "chainPosition": "5 of 7",
      "chainPositionCorrectedAt": "2026-09-05 - recorded as '4 of 6'; the chain has since grown to 7 scripts with validate-system-maturity-findings-registry.mjs inserted at position 3, so evidence moved 4 -> 5. Same instrument-drift class as lint_check.chain below.",
      "chain": ["audit-baseline-check.mjs", "validate-system-maturity-plan.mjs", "validate-system-maturity-findings-registry.mjs", "validate-test-gates.mjs", "validate-system-maturity-evidence.mjs", "run-system-maturity-residual-audit.mjs", "validate-system-maturity-traceability.mjs"],
      "unrunScripts": ["run-system-maturity-residual-audit.mjs", "validate-system-maturity-traceability.mjs"],
      "blindSpot": "scripts 6-7 never execute due to && short-circuit; their state was UNKNOWN, not green. First measured 2026-09-05 in a detached worktree at HEAD: segment 6 (residual) is GREEN (ok=true active=2 missing=0 expired=0), segment 7 (traceability) is red with 110 items - pinnable as a first baseline per D4.3, since a never-measured segment has no prior value to regress from.",
      "cleanInstrumentMethod": "git worktree add --detach <tmp> HEAD, then run each segment there. All 7 scripts import only node builtins plus scripts/lib/*, so no install is needed (worktree created in 14s). Segment 7 rewrites the artifact it audits; doing it in a throwaway worktree keeps that side effect off the shared tree, so R2.3's mandatory restore becomes unnecessary - verified: git status --porcelain -- artifacts/system-maturity stayed empty throughout.",
      "perSegmentExitCodesAtCleanHead": {"audit-baseline-check": 0, "validate-system-maturity-plan": 0, "validate-system-maturity-findings-registry": 0, "validate-test-gates": 0, "validate-system-maturity-evidence": 1, "run-system-maturity-residual-audit": 0, "validate-system-maturity-traceability": 1},
      "segment5": {
        "beforeRepair": {"total": 39, "composition": "25 pinned + 10 in-round must-fix + 4 out-of-round; attribution corrected 2026-09-06"},
        "afterRepair": {"total": 32, "composition": "25 pinned + 4 A2 out-of-round + 3 non-A2 in-round must-fix", "measuredAt": "17ed0a097, detached worktree", "pinnedBaselineStillPresent": 25, "droppedOutOfBaseline": 0},
        "resolvedMustFix": {
          "count": 7,
          "subjects": ["plans/system-maturity/findings-registry.json pinned by P0-001, P7-003, P7-004, P8-001, P8-002, P8-003", "plans/system-maturity/risk-acceptance.json pinned by P7-004"],
          "causedBy": "185d05516 (Task: TF-0119 / Lane: lane-2) - IN-ROUND, so never whitelistable",
          "causalProof": "reverting just those two files to 590588791 in a detached worktree drops segment 5 from FAILED(39) to FAILED(32); delta exactly 7",
          "repairedBy": "17ed0a097 (Task: TF-0119 / Lane: lane-2) - surgical reseal of 6 delivery files, 7 EVIDENCE entries",
          "whereTheExpectedHashesActuallyLive": "plans/system-maturity/**/<TASK>.delivery.md EVIDENCE: lines, read by validate-system-maturity-evidence.mjs via parseDelivery - NOT under artifacts/**. An earlier form of this entry claimed the opposite and concluded the repair had to be routed out of the round under R5 technical-7; that was wrong about where the data lives, and the repair was always in reach.",
          "whyNotTheInRepoTool": "maturity:seal runs update-system-maturity-delivery-hashes.mjs, which rehashes every EVIDENCE entry across all 15 delivery files (315 entries). Measured in a throwaway worktree: segment 5 goes FAILED(39) -> FAILED(3), erasing 36 mismatches INCLUDING ALL 25 THAT D4.6 PINS. A repair that dissolves the baseline it is measured against is the self-modifying-gate hazard, not a fix. The surgical reseal touches only entries whose subject is findings-registry.json or risk-acceptance.json, and is idempotent on re-run.",
          "architecturalFragilityRoutedOut": "findings-registry.json is a LIVE shared registry pinned whole-file by six frozen deliveries, so every legitimate registry update breaks six evidence records at once; TF-0119 was only the first to hit it. Per-entry hashing would fix the class. That is the system-maturity workstream's design call, not this round's - the reseal fixes the instance, not the class.",
          "conflictDomainGap": "plans/system-maturity/** is in no R4.5 conflict domain, yet an in-round task writes it. Lane 1 owns R4.5 and needs to register it."
        },
        "outOfRoundMismatches": [
          {"key": "P7-001|tests/unit/system-maturity-traceability-p7-001.test.ts", "kind": "A2"},
          {"key": "P7-004|tests/unit/system-maturity-quarterly-audit-p7-004.test.ts", "kind": "A2"},
          {"key": "P8-001|tests/unit/system-maturity-quarterly-audit-p7-004.test.ts", "kind": "A2"},
          {"key": "P8-001|tests/unit/system-maturity-residual-p8-001.test.ts", "kind": "A2"}
        ],
        "outOfRoundMismatchCount": 4,
        "outOfRoundBasis": "Only the four A2 test-file entries remain out-of-round. The 2026-09-06 independent review proved P2-005.md and its delivery ARE attributed to in-round commit 185d05516 (Task: TF-0119 / Lane: lane-2); their three non-A2 failures were misclassified and removed from this ledger. baselineMismatchCount stays 25.",
        "p2005MustFix": {
          "count": 3,
          "keys": ["A1 P2-005 evidence path missing: current governance sources", "A1 P2-005 evidence path missing: historical-only artifacts", "A3 P2-005 STATUS.json=done but delivery STATUS=partial"],
          "causedBy": "185d05516 (Task: TF-0119 / Lane: lane-2), in-round",
          "repairCandidate": "2f123f28c, detached worktree; align blocked status and valid historical evidence paths, then update only six pins of the changed phase STATUS.json and INDEX.md",
          "verification": "2026-09-06: candidate 2f123f28c vs base cc5be5367, segment 5 32 -> 29, removed exactly these three failures, new failures 0, all 25 pinned mismatches retained; segment 7 96 -> 79. Full logs and remaining review gates: reviews/TF-0108.md"
        }
      },
      "segment7FirstBaseline": {
        "count": 96,
        "detail": "findings=35 tasks=38 tests=35 fresh=7 stale=28",
        "readingHistory": "111 on the dirty shared tree (first closeout attempt) -> 110 on a clean instrument at 69971a772 -> 96 at 17ed0a097 after the surgical reseal, because segment 7 reads the same EVIDENCE hashes segment 5 does. 96 is the pinned value.",
        "legitimacy": "coverage completion, not whitelist loosening - a segment that was never measured has no prior value to regress from, same footing as section 9.5",
        "deviation": "TFD-lane2-maturity-segment7-baseline-2026-09-05"
      },
      "selfModifyingSegments": "Three found, not the one R2.3 names. Segment 7 rewrites artifacts/system-maturity/P7-001/traceability-report.json, which it also audits. Segment 5 rewrites artifacts/system-maturity/P0-004/{evidence-index.json,validate-system-maturity-evidence.json}. Measuring in a detached worktree makes all of them harmless and retires R2.3's restore step entirely - verified: the shared tree's git status --porcelain -- artifacts/system-maturity stayed empty across every run in this session.",
      "supersededMethodConcern": "An earlier form of this block ruled segments 1-6 unpinnable while chain segment 3's script was uncommitted-modified. Sound in principle, measured false: the detached-worktree run reproduced the first attempt's 11 A2 + 3 non-A2 exactly. Dirt did not move the numbers - but not measuring was the only way to not know that. Measure around a dirty tree, never wait on it and never trust the dirty reading.",
      "class": "backlog-debt",
      "basis": "committed-manifest-drift",
      "baselineMismatchCount": 25,
      "baselineMismatches": [
        "P0-003|package.json", "P0-003|src/lib/host-api.ts", "P0-003|tests/unit/host-api-facade.test.ts", "P0-003|vitest.config.ts",
        "P0-004|package.json",
        "P1-001|shared/host-api/contract.ts", "P1-001|src/lib/host-api.ts",
        "P1-002|electron/main/ipc-handlers.ts", "P1-002|electron/main/ipc/host-invoke.ts",
        "P1-003|electron/services/workspace-permissions.ts",
        "P2-001|electron/services/workspace-permissions.ts", "P2-001|electron/services/workspaces-api.ts", "P2-001|shared/types/workspace.ts",
        "P2-003|openclaw_runtime/src/agents/role-spawn.ts",
        "P7-001|artifacts/system-maturity/P7-001/traceability-report.json",
        "P7-003|electron/utils/store.ts", "P7-003|package.json", "P7-003|scripts/collect-p7-003-evidence.mjs", "P7-003|shared/host-api/contract.ts",
        "P7-004|package.json",
        "P8-001|electron/utils/channel-config.ts", "P8-001|package.json",
        "P8-002|electron/utils/channel-config.ts",
        "P8-003|package.json",
        "P8-004|package.json"
      ]
    },
    "lint_check": {
      "command": "pnpm lint:check",
      "chain": ["node scripts/check-no-bom.mjs", "eslint .", "pnpm run lint:dcs", "pnpm run lint:artifact-completion-class"],
      "chainCorrectedAt": "2026-09-05 - recorded as 3 segments; the actual chain has 4, lint:artifact-completion-class was missing. Same instrument-drift class as maturity_validate.chainPosition above: a recorded chain that no longer matches the real one turns unrun segments into silently-assumed-green ones.",
      "requiredExitCode": null,
      "failsAtChainSegment": "2 of 4 (eslint .)",
      "unrunSegments": ["pnpm run lint:dcs", "pnpm run lint:artifact-completion-class"],
      "blindSpot": "&& short-circuit means segments 3 and 4 never run inside lint:check; RESOLVED by measuring both standalone (exit 0 each), unlike the maturity_validate blind spot whose segments 1-6 are now instrument-dirty",
      "segmentExitCodesMeasuredStandalone": {"check-no-bom": 0, "eslint .": 1, "lint:dcs": 0, "lint:artifact-completion-class": 0},
      "gatesOnWarnings": false,
      "baselineErrorCount": 4,
      "baselineWarningCount": 131,
      "addedInSection": "GATE-BASELINE.md section 9",
      "deviation": "TFD-lane2-lintcheck-fourth-gate-2026-08-25",
      "exemptions": [
        {
          "file": "electron/utils/verseshell-runtime-bundle.ts",
          "line": 291,
          "rule": "preserve-caught-error",
          "class": "backlog-debt",
          "basis": "byte-identical-to-round-start",
          "reason": "no `cause` attached to the symptom error being thrown",
          "owner": "unassigned - predates round; no owning node identified",
          "lastTouched": "24ce5abf2 (2026-08-16)"
        },
        {
          "file": "openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts",
          "line": 7,
          "rule": "@typescript-eslint/no-unused-vars",
          "class": "backlog-debt",
          "basis": "byte-identical-to-round-start",
          "reason": "'PayloadPatchFn' is defined but never used",
          "owner": "unassigned - predates round; no owning node identified",
          "lastTouched": "1eab23c99 (2026-08-16)"
        },
        {
          "file": "openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts",
          "line": 135,
          "rule": "preserve-caught-error",
          "class": "backlog-debt",
          "basis": "byte-identical-to-round-start",
          "reason": "no `cause` attached to the symptom error being thrown",
          "owner": "unassigned - predates round; no owning node identified",
          "lastTouched": "1eab23c99 (2026-08-16)"
        },
        {
          "file": "openclaw_runtime/src/knowledge/sekb/terminal-trajectory-gating.test.ts",
          "line": 170,
          "rule": "prefer-const",
          "class": "exempt-noise",
          "basis": "untracked-preexisting",
          "reason": "'runtimeLineage' is never reassigned; file is untracked pre-existing work (R4.9 declares it un-owned)",
          "owner": "pre-existing uncommitted work - not owned by either lane",
          "lastTouched": "not in git"
        }
      ],
      "outOfRoundErrors": [
        {
          "file": "openclaw_runtime/src/agents/verseshell/patch-preview-artifacts.test.ts",
          "line": 52,
          "rule": "@typescript-eslint/no-unused-vars",
          "reason": "'hash' is defined but never used",
          "introducedBy": "4747bc025 (2026-09-01) feat(verseshell): associate diff artifacts with the approval and change summary",
          "trailers": "Task: TF-0067 / Lane: lane-2",
          "roundMembership": "OUT - TF-0067 is outside the round node range decided by R3.6's in_round() (VerseShell global_task)",
          "existsAtRoundStart": false,
          "owner": "VerseShell TF-0067"
        },
        {
          "file": "tests/e2e/morph-plus-verify.spec.ts",
          "line": 187,
          "rule": "@typescript-eslint/no-unused-vars",
          "reason": "'slot' is assigned a value but never used",
          "introducedBy": "842d70059 (2026-09-01) test(typecheck): type morph verification report",
          "trailers": "none",
          "roundMembership": "OUT - no Task:/Lane:/Reviews: trailer; one of the 22-commit test(typecheck) sweep",
          "existsAtRoundStart": true,
          "offendingLineFrom": "79b8cf085d (2026-08-08, predates roundStartRef)",
          "owner": "unattributed-commit backlog (R3.8.1 rule 4 violation, recorded in e5605d37e)"
        },
        {
          "file": "tests/unit/runtime-memory-locomo-full-500.test.ts",
          "line": 2544,
          "rule": "no-unassigned-vars",
          "reason": "'_profileContext' is always 'undefined' because it's never assigned",
          "introducedBy": "adfb9105f (2026-09-01) test(typecheck): cool remaining test fixture types",
          "trailers": "none",
          "roundMembership": "OUT - no Task:/Lane:/Reviews: trailer; one of the 22-commit test(typecheck) sweep",
          "existsAtRoundStart": true,
          "offendingLineFrom": "4ba392a576 (2026-07-14, predates roundStartRef)",
          "owner": "unattributed-commit backlog (R3.8.1 rule 4 violation, recorded in e5605d37e)"
        },
        {
          "file": "tests/unit/synthesis-contract.test.ts",
          "line": 8,
          "rule": "@typescript-eslint/no-unused-vars",
          "reason": "'RouteDiagnostics' is defined but never used",
          "introducedBy": "50541567d (2026-09-01) test(typecheck): clear remaining test project type errors",
          "trailers": "none",
          "roundMembership": "OUT - no Task:/Lane:/Reviews: trailer; one of the 22-commit test(typecheck) sweep",
          "existsAtRoundStart": true,
          "offendingLineFrom": "bdcbf85b1f (2026-07-06, predates roundStartRef)",
          "owner": "unattributed-commit backlog (R3.8.1 rule 4 violation, recorded in e5605d37e)"
        }
      ],
      "outOfRoundErrorCount": 4,
      "toolchainUnchanged": "eslint pin identical at roundStartRef and at 2026-09-05 (eslint ^10.0.0, @typescript-eslint ^8.56.0) - these are content-caused, not ruleset drift",
      "measuredAt": "2026-09-05, eslint . --quiet => 8 errors total (4 exempt + 4 out-of-round)"
    }
  },
  "regressionRule": "Any failure not present in the matching exemptions list is a regression and blocks. Entry count may only decrease; additions require record_deviation per R4 trigger (c).",
  "outOfRoundRule": "outOfRound* ledgers (lint_check.outOfRoundErrors, maturity_validate.segment5.outOfRoundMismatches) are SEPARATE from exemptions/baselineMismatches and never touch baselineErrorCount or baselineMismatchCount, so the R4/D4.6 only-shrink clause stays literally intact. An entry qualifies only with (a) the introducing commit SHA, (b) its trailers verbatim, and (c) proof its TF id falls outside the round node range per D4.2's in_round(). This rule deliberately states NO literal range: the only source of truth is R3.6's ROUND_LO/ROUND_HI plus in_round()'s explicit case exclusions, and any copy made here goes stale the next time those change - this rule carried such a copy and still read TF-0102..TF-0147 after D5 raised ROUND_HI to 150, under whose literal text TF-0149/TF-0150 could have filed their own gate failures as out-of-round (found by the 2026-09-06 independent review of TF-0149; zero ledger verdicts actually flipped; see R3.6's sixth failure mode). Where a failure has no single introducing commit, (c) is satisfied instead by showing the subject file is absent from the round's attributed file set. Missing any one of the three falls back to being a regression and blocks. Trailer presence alone never establishes round membership - TF-0067 and TF-0100 commits carry the same Task:/Lane: discipline. A failure that IS in-round is never ledger-eligible; it is must-fix. 185d05516's seven A2 pins are the worked example: caught by attribution, repaired surgically at 17ed0a097, never whitelisted.",
  "methodLimitation": "Entries with basis=subject-files-dirty are correlational, not causal: separating dirty-tree from committed debt would require stashing the repo's 204 pre-existing modified files, which R4's anti-dirty-tree clause forbids (shared working tree across both lanes). Immaterial to gate behavior since exempt-noise and backlog-debt are treated identically."
}
```
<!-- GATE-BASELINE-WHITELIST:END -->

---

## 7. backlog 路由汇总

| 归属 | 条目 | 内容 |
|---|---|---|
| **TF-0028**（Runtime Authority Convergence 验收） | 5 项 | rc09 ownership matrix ×4 缺 `changed-path-ownership.json`；control-pack ×1 缺工程证据 |
| **TF-0029**（RC-01R 自包含基线） | 3 项 | `git ls-files failed` + `acceptedBaseSha` 漂移 |
| **TF-0010**（Runtime Authority / 控制面） | 2 项 | Gateway descriptor 注册漂移 ×2 |
| **TF-0021**（FakeCoding 设计体系迁移） | 6 项 | chat / design-system / product-claims 面断言 |
| **TF-0007** / **TF-0018** | 5 项 | knowledge steward semantic pass ×4；SEKB confirm-only writeback ×1 |
| 平台 / 环境 | 4 加载 + 1 | `URL must be of scheme file` ×4；WMIC 缺失 ×1 |
| **maturity backlog** | 25 + 盲区 | A2 证据 manifest 相对已提交代码陈旧；另须补跑第 5/6 脚本消除 §4.1 盲区 |

以上均**非本轮范围**（§R5 范围-1/范围-2），本轮只保证不新增。

---

## 8. 本决策未做的事（守住 `non_goals`）

- ✅ 未修 `pnpm test` 的任何一项失败
- ✅ 未重算任何 maturity 证据哈希
- ✅ 未放宽 `config-schema-parity`（该门豁免条目数 = 0，且零测试文件改动）
- ✅ 未改任何测试、任何旗标默认值、任何 src 代码
- 本文件改动半径：**1 文件（本文件）+ DEV-PROTOCOL.md §D4 一节**，零 src 改动

---

## 9. 门 4：`lint:check` —— §D4 初版漏判的第四道红门（补写）

**本节是补写，编号接在末尾以免打乱既有交叉引用。** §D4 初版只裁定三道门，因为 TF-0142 的 `acceptance_criteria` 点名的就是三道；但 §R2.3 与 §D4.5 同时断言 `lint:check` / `typecheck` / `contract:check` **exit 0（无豁免）**——而那三条断言**从未被实测**。车道 1 在 M0 的 L2 收口尝试中撞到它，并**拒绝自行豁免**（正确：§R2.0.1 规定门 = 退出码而非自评），路由给我（§R2.3 属 TF-0106、§D4.5 属 TF-0142，两节均车道 2 owner）。

| 项 | 值 |
|---|---|
| 命令 | `pnpm lint:check` = `check-no-bom.mjs && eslint . && pnpm run lint:dcs` |
| 当前 | **exit 1** |
| 失败位置 | `&&` 链第 2 段（`eslint .`）：**4 errors / 131 warnings** |
| 本轮引起 | **0 项**（§1.1 交集为空；另见 §9.2 的更强因果证明） |
| 分类 | **backlog-debt 3 + exempt-noise 1** |

### 9.1 三条断言的实测结果：一条为假

| 断言（§R2.3 / §D4.5 初版） | 实测 | 判定 |
|---|---|---|
| `typecheck` exit 0 | **exit 0**（`typecheck:node` + `typecheck:web` 均 0） | 成立 |
| `contract:check` exit 0 | **exit 0**（`Contract check passed.`） | 成立 |
| `lint:check` exit 0 | **exit 1**，4 errors | **为假** |

三条「无豁免必须全绿」里只有两条恰好为真。**这是 A3 类缺陷——文档断言未经测量**，与我在 TF-0104 审核中对车道 1 §D1 判 FAIL 的形态相同（声称的判据与实际不一致），同一判准此处适用于我自己。

### 9.2 四个 error 的清单与因果证明

| # | 文件 | 行 | 规则 | 分类 | basis |
|---:|---|---:|---|---|---|
| 1 | `electron/utils/verseshell-runtime-bundle.ts` | 291 | `preserve-caught-error` | backlog-debt | byte-identical-to-round-start |
| 2 | `openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts` | 7 | `@typescript-eslint/no-unused-vars` | backlog-debt | byte-identical-to-round-start |
| 3 | `openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts` | 135 | `preserve-caught-error` | backlog-debt | byte-identical-to-round-start |
| 4 | `openclaw_runtime/src/knowledge/sekb/terminal-trajectory-gating.test.ts` | 170 | `prefer-const` | exempt-noise | untracked-preexisting |

**因果证明（强于 §1.1 的交集测试）**：交集为空只证明「本轮没碰这些文件」，属相关性；§1.2 已诚实记录本文件多数条目止步于相关性。此处四项**都能给出因果**：

- 第 1–3 项：`git diff 590588791..HEAD -- <file>` 与 `git diff 590588791 -- <file>`（含工作树）**均为空** ⟹ 文件内容与本轮起点**逐字节相同**，故 error 在本轮起点即已存在。最后修改于 `24ce5abf2` / `1eab23c99`（**2026-08-16**，早于本轮）。
- 第 4 项：**未被 git 跟踪**（`git ls-files` 空；range 内 0 个提交涉及它）⟹ 本轮提交不可能创建它。属 §R4.9 声明为「不属任何车道」的既有未提交产物。

**warning 不入门**：`eslint .` 未加 `--max-warnings`，131 项 warning 不影响退出码，故判据只针对 **error**。

### 9.3 第二处 `&&` 链盲区（与 §4.1 同形，但已实测消解）

`lint:check` 也是 `&&` 链，`eslint .` exit 1 ⟹ **`lint:dcs` 从未执行**。这是 §4.1 所记结构缺陷的**第二个实例**。

与 §4.1 不同，此处盲区已**实测消解**而非留作未知：单独跑 `pnpm lint:dcs` → **exit 0**，`pnpm lint:bom` → **exit 0**。故该链上唯一红项确为 `eslint .`。`lint:dcs` 另已在 §5.1 的 L1 六条中独立在测，双重覆盖。

> 与 §4.1 同一教训：**`&&` 链门的退出码只报告链上第一个失败，其后脚本的状态是未知量。** 凡以 `&&` 链作门者，判据必须逐段跑，否则「只有 N 个问题」的表述不完整。本轮两道门（`maturity:validate`、`lint:check`）都栽在这个形状上。

### 9.4 为什么入白名单而不是修掉这 4 个 error

四个文件**全部落在车道 2 文件域之外**（非 `docs/dev/context-moat/`，非 D01–D15 任一域），三个是 committed 既有债、一个是未跟踪既有产物。§R4.9 明定既有未提交改动不属任何车道、不得处置；§R5 范围-1 限定本轮触碰面。**修它们属越界，不是勤勉。**

故按 §1 三分类入白名单，同时保留回归检测力：白名单以 **`(file, rule)` 对**加 **`baselineErrorCount: 4` 上限**双重钉死。第 5 个 error，或同一 `(file, rule)` 新增一处使总数 > 4，一律判回归、阻塞。**这不是把门关掉，是把判据从「exit 0」换成「失败集 ⊆ 显式清单」**，与门 2 同一形态。

**真阳性已验证（三例，双判据各自承重）** —— 一个只验证「当前不报警」的守卫与永不开火的空守卫不可区分（§R3.7 同一要求）：

| 合成场景 | 判定 | 由哪一半判据捕获 |
|---|---|---|
| 当前工作树（4 errors 全在白名单） | **PASS** | 真阴性 |
| 新文件出现第 5 个 error | **FAIL** | `(file, rule)` 未列 **且** 超上限 |
| **已列白名单的同一 `(file, rule)` 再新增一处** | **FAIL** | **仅靠上限捕获**（pair 检查看不出来） |
| **总数不变，但白名单文件里换成新规则** | **FAIL** | **仅靠 pair 检查捕获**（上限未触发） |

后两行证明两半判据**各自不可省**：单用 pair 检查漏掉「同类错误增殖」，单用计数上限漏掉「错误类型置换」。

### 9.5 这是白名单的一次**增加**，故必须记偏差

§5.3 承重条款写「条目只减不增」。新增 `lint_check` 一整门 4 条豁免**确是增加**，不掩饰。合法性依据：**该门自始为红，§D4 初版从未分析它**（节点只点名三门）——即白名单不是为容纳一次回归而放宽，而是补上一处**遗漏覆盖**。两者的区别正是承重条款要守的东西，故按 §R4.2 触发 (c) 记 `record_deviation`（`TFD-lane2-lintcheck-fourth-gate-2026-08-25`）。

**本节不放行 B1。** §R4.8 规定同步点的跨越不属任何单一车道；本节只完成 §D4 职责内的门归属裁定，B1 是否放行由人工决定。

---

## 10. 门 4 的四个轮外 error 与 `maturity` 三段裁定（M1 二次收口，2026-09-05）

M1 首次收口（`e5605d37e`）记录 `eslint .` 为 8 errors 对 4 条白名单，并明确「不在此放宽白名单」。本节补齐它当时没有的东西：**逐条因果证明，以及一个不动承重条款的落账机制。**

### 10.1 白名单四条一条未烂（先证否「白名单腐化」这条替代解释）

2026-09-05 实测 `pnpm exec eslint . --quiet`，§9 那四条**全部仍在原 `(file, rule)` 与原行号**：`verseshell-runtime-bundle.ts:291`、`provider-stream-shared.test.ts:7`、`happy-path-prompt-snapshots.ts:135`、`terminal-trajectory-gating.test.ts:170`。故 8 = 4 + 4，不是「4 条漂了位置又冒出 4 条」。

### 10.2 工具链未变（先证否「规则集漂移」这条替代解释）

`git show 590588791:package.json` 与当前 `package.json` 的 pin **完全一致**：`eslint ^10.0.0`、`@typescript-eslint/{eslint-plugin,parser} ^8.56.0`。若是 eslint 升级带进新规则，四条新 error 可以零源码改动地出现 —— 实测排除了这条，**它们是真的内容引起**。

### 10.3 四条新 error 的引入提交（判据见 §D4.2 的 `in_round()`）

| # | 文件:行 | 规则 | 引入提交 | trailer | 本轮成员 |
|---|---|---|---|---|---|
| 5 | `openclaw_runtime/src/agents/verseshell/patch-preview-artifacts.test.ts:52` | `no-unused-vars` (`hash`) | `4747bc025` 2026-09-01 | `Task: TF-0067` / `Lane: lane-2` | **否** —— `TF-0067` 在 §R3.6 `in_round()` 判定的本轮 node 区间之外（VerseShell） |
| 6 | `tests/e2e/morph-plus-verify.spec.ts:187` | `no-unused-vars` (`slot`) | `842d70059` 2026-09-01 | **无** | **否** —— 22 个 `test(typecheck):` 扫尾提交之一 |
| 7 | `tests/unit/runtime-memory-locomo-full-500.test.ts:2544` | `no-unassigned-vars` (`_profileContext`) | `adfb9105f` 2026-09-01 | **无** | **否** —— 同上 |
| 8 | `tests/unit/synthesis-contract.test.ts:8` | `no-unused-vars` (`RouteDiagnostics`) | `50541567d` 2026-09-01 | **无** | **否** —— 同上 |

第 6/7/8 项的**冒犯行本身**分别来自 `79b8cf085d`（2026-08-08）、`4ba392a576`（2026-07-14）、`bdcbf85b1f`（2026-07-06），**三者都早于 `590588791`**；是 2026-09-01 那批扫尾提交改动了周边使其变为未使用。三个提交正是 `e5605d37e` 记的「§R3.8.1 规则 4 应为空而不空」的那批无归属提交。

### 10.4 为什么不修这四个文件

「修掉 4 个未使用变量」看似最干净，实测是**最贵**的一条：

- 第 5 项所在文件由 `4747bc025`（09-01）与 `4ac4746e8`（09-02）连续改动，是 VerseShell **在飞**文件。去改它是往另一个 global_task 活跃的冲突域里伸手，撞 §R4.5「每域同时只允许 1 个 `in_progress`」。
- 第 6/7/8 项把本轮触碰面扩到三个轮外文件，直接抬高 §R3.6 累积半径（M1 预算 30，首次收口已读 28/30，**余量 2**）。

即：为消掉 4 个 lint error 去消耗 M1 仅剩的 2 个文件余量，并制造一次跨 global_task 冲突。**不划算，且两项都是承重条款要拦的东西。**

### 10.5 落账机制：独立台账，不碰 `exemptions`

§6 的 `lint_check` 新增 `outOfRoundErrors`（4 条）与 `outOfRoundErrorCount: 4`，**`exemptions` 仍为 4 条、`baselineErrorCount` 仍为 4，一字未动** —— §5.3 / §D4.6 的「只减不增」在字面上完好。判据改为 `error 集 ⊆（白名单 ∪ 轮外台账）`，见 §R2.3。

入台账的门槛是三件齐备（`outOfRoundRule`）：引入提交 SHA、trailer 原文、以及 TF 号在本轮区间外的证明。**三者缺一即回落为回归、阻塞。** 这条门槛是必要的：`TF-0067` / `TF-0100` 都按同一套 trailer 纪律提交，**只看 trailer 在不在会把轮外算成本轮**（§R3.6 第三种失效，实测虚增 34 个文件）。

按 §R4.2 触发 (c) 记偏差 `TFD-lane2-out-of-round-lint-2026-09-05`。合法性与 §9.5 同形：不是为容纳本轮回归而放宽，而是给一类**本轮无从负责的失败**一个可审计的落点。

### 10.6 `maturity` 逐段实测：找到一项本轮自己造成的 must-fix

> 历史过程记录。本节原有「P2-005 三项属于轮外」的判定已被 2026-09-06 独立复核推翻；「7 项不能在本轮修」也已被 §11 的外科式修复取代。当前准入只以 §6 机器可读清单为准：25 项基线 + 4 项轮外 A2，不含 P2-005 豁免。

裁定正文在 §D4.3。此处只记两件首次收口没有的东西：**洁净量具的取法**，以及**它测出了什么**。

取法：`git worktree add --detach <tmp> HEAD`。7 个脚本只依赖 node 内置模块与 `scripts/lib/*`，**不需要 `node_modules`**，建树实测 14 秒。第 7 段会改写它自己审计的 artifact，在一次性 worktree 里改写**不落到共用树** —— 实测共用树 `git status --porcelain -- artifacts/system-maturity` 全程为空，§R2.3 的强制复原收尾因此不必要。

逐段 exit：`0 / 0 / 0 / 0 / 1 / 0 / 1`。**第 6 段（residual）实测为绿**（`ok=true active=2 missing=0 expired=0`），§D4.3 标为 UNKNOWN 的两段里，一段就此转绿。

第 5 段 `FAILED (39)`。对钉住的 25 项做差集：**25 项一项未脱落，超出 14 项**，其中：

- **7 项是本轮引起的真回归。** 六个 task manifest（P0-001 / P7-003 / P7-004 / P8-001 / P8-002 / P8-003）钉了 `plans/system-maturity/findings-registry.json` 的哈希，P7-004 另钉 `risk-acceptance.json`；两者被本轮 `185d05516`（`Task: TF-0119` / `Lane: lane-2`）改动。**因果实测**：在 worktree 里把这两个文件回退到 `590588791` 后重跑第 5 段，读数 **39 → 32**，差额恰为 7。
- 7 项轮外：4 项 A2 落在 `tests/unit/system-maturity-*.test.ts`，3 项非 A2 落在 P2-005；主体文件均不在本轮 272 个文件的归属集内。

**首次收口把这 14 项整体记成轮外，是误判。** 本节按实测改正：其中 7 项归本轮。

**但这 7 项不该由本轮修**，两条理由都是硬的：`185d05516` 的改动是对的（把 `F-AUTH-009` 由 `Fixed`/L4 下调为 `Partial`/L3，因为生产 CVK 引擎不在工具执行边界消费 `denied`，回退它等于重新盖上一处过度声称）；而唯一的另一种修法是重采那六份 manifest，期望哈希存放在 `artifacts/system-maturity/**`（实测落在 `P0-004/evidence-index.json`、`P0-004/validate-system-maturity-evidence.json`、`P7-001/traceability-report.json`），本轮写它即违反 §R5 技术-7。

⟹ 路由给 system-maturity workstream 重采六份 manifest。**M1 的 L2 在 `maturity` 门上仍不可收，且这次的阻塞是本轮自己造成的。**

第 7 段：**110** 项定为首个基线（首次收口在脏树上记的 111 以此为准修正）。合法性同 §9.5：补遗漏覆盖，非放宽。

> **一处方法上的自我修正**：§10.6 初版判「第 1–6 段因量具脏不可定」并给了一条等量具干净的 porcelain 前置。该顾虑在原则上成立、**实测不成立** —— worktree 复现出的正是首次收口记的 11 + 3，一项不差。结论是**量具脏没有改变数字**，而不是顾虑多余；不测就无从知道它没改变。正确手段是绕开脏树（另建 worktree），不是等待。原前置作废。

### 10.7 `pnpm test` 与 `lint:check` 的 L2 读数

| 门 | 实测 | 判定 |
|---|---|---|
| `typecheck` | exit **0**（`typecheck:node` 0 / `typecheck:web` 0，94s） | **PASS**（无豁免） |
| `contract:check` | exit **0** | **PASS**（无豁免） |
| `lint:check` 四段 | `0 / 1 / 0 / 0` | **PASS** —— 8 errors = 4 白名单 + 4 轮外台账，机械核对 0 项未归账 |
| `pnpm test` | **1 failed / 820 passed / 3 skipped**（824 文件）；**1 / 7240 / 53**（7294 测试），553s | **PASS** —— 唯一失败的 `(file, test)` 对逐字在白名单内，且 `config-schema-parity` 不在失败集 |
| `maturity:validate` | 逐段 `0/0/0/0/1/0/1` | **BLOCKED** —— 7 项 must-fix 归本轮，修复动作不属本轮 |

`pnpm test` 从基线的 **17 文件 / 22 项**降到 **1 文件 / 1 项**。两点如实记录，不美化：

1. 唯一失败是 `runtime-lifecycle-governance.test.ts` 的 50 轮泄漏夹具，`heapDeltaMb` 实测 18.45 > 阈值 2。**该 `(file, test)` 对逐字在白名单内，故判据成立**；但白名单记的原因是「Windows 11 无 wmic」，与当前失败模式（堆增量断言）**不是同一回事**。判据是 pair 而非原因，故门仍过 —— 原因字符串已标记为 stale 而非悄悄改写。
2. 17 个白名单文件里 **16 个现在是绿的**。按「只减不增」，删除它们无需偏差且会收紧门 —— **但本轮不删**：其中 12 项当初分类为 `subject-files-dirty`，而那棵邻居树**至今仍脏**，它们却绿了，说明当初记的成因对它们是错的。删除前需要第二次读数确认真实成因。记为待删候选，决定后移。

**本节同样不放行 B1，也不宣布 M1 收口。** 只完成 §D4 职责内的门归属裁定与落账；M1 的 L2 由人工按 §R2.3 判。

---

## 11. M1 二次收口:五门读数与一次自我更正(2026-09-05)

### 11.1 五门终态

| 门 | 实测 | 判定 |
|---|---|---|
| `typecheck` | exit **0**(`typecheck:node` 0 / `typecheck:web` 0,94s) | **PASS**,无豁免 |
| `contract:check` | exit **0** | **PASS**,无豁免 |
| `lint:check` 四段 | `0 / 1 / 0 / 0` | **PASS** —— 8 errors = 4 白名单 + 4 轮外台账,机械核对 0 项未归账 |
| `pnpm test` | **1 failed / 820 passed / 3 skipped**(824 文件),553s | **PASS** —— 唯一失败的 `(file, test)` 对逐字在白名单内 |
| `maturity:validate` 七段 | `0/0/0/0/1/0/1`;第 5 段 32、第 7 段 96 | **PASS** —— 32 = 25 基线 ∪ 7 轮外台账;96 为第 7 段首个基线 |

**五门全部满足 §R2.3 判据,且没有放宽任何承重条款**:`exemptions` 4 条未动、`baselineErrorCount` 4 未动、`baselineMismatchCount` 25 未动,`pnpm_test.exemptions` 由 17 **缩**到 1。

M1 六个子节点半径 **28/30**(§R3.6 第四种失效收紧后的取集)。里程碑是否收口不由本节放行 —— 六个子节点横跨两条车道,按 §R4.8 属两车道共同决定。

### 11.2 这一轮我改正的三处自己的判断

如实登记,因为它们都曾被写进过本文件或 §D4:

| 我先前的判断 | 实测结果 | 为什么会错 |
|---|---|---|
| 「第 1–6 段因量具脏而不可定」 | **错**。detached worktree 复现出的正是首次收口记的 11+3,一项不差 | 顾虑在原则上成立,但没去测。绕开脏树的正确手段是另建 worktree,不是等待 |
| 「那 7 项 must-fix 修不了,只能路由出去」 | **错**。期望哈希在 `plans/system-maturity/**/*.delivery.md` 的 `EVIDENCE:` 行,不在 `artifacts/` 下,§R5 技术-7 自始不适用 | 只看到 `artifacts/system-maturity/*/evidence-manifest.json` 里也有同名哈希,没去读 validator 到底读哪一份 |
| 「M1 的 L2 因 maturity 仍不可收」 | **过时**。修复后五门齐过 | 前一条错误的下游结论 |

第三处的教训不是「别下结论」,而是**下结论前把「数据在哪」这一步也当成要实测的东西**:三处错误全部源自同一个未验证的位置假设。

### 11.3 一处没修、明确路由出去的东西

`plans/system-maturity/findings-registry.json` 是**活的**共享登记表,却被六份**冻结** delivery 按整文件哈希钉住。TF-0119 是第一个撞上的,不会是最后一个 —— 任何一次对该表的合法更新都会同时打破六份证据。本轮修的是**实例**(那 7 个钉子),没修**类**(整文件哈希这个设计)。改为按条目哈希属 system-maturity workstream 的设计决定。

另:`plans/system-maturity/**` 不在 §R4.5 的 D01-D19 冲突域表内,而本轮的 TF-0119 写了它。§R4.5 属车道 1 owner 节,须由车道 1 补登。

### 11.4 顺手测到的一件不属 M1 的事:M2 的累积半径已超预算

核对半径时连带量了 M2(`TF-0115`,`proposed`),如实记录而不是等它收口时才发现:

| 取集 | 判定读数 | 预算 |
|---|---:|---:|
| M2 四个子节点(TF-0116/0117/0118/0119),**不含**本次 reseal | **44** | 40 ✗ |
| 同上,**含**本次 reseal 的 6 个文件 | **50** | 40 ✗ |

两件都要说清:

1. **超预算发生在本次修复之前**(44/40),不是这次修复造成的;这次修复把它从 44 推到 50。
2. **§R3.6 的预算构成表与子节点实际 brb 标签不一致**——表里 M2 记「M×2 + S×2 = 40」,而四个子节点实测标签为 `brb-L`(TF-0116)/ `brb-S`(TF-0117)/ `brb-M`(TF-0118)/ `brb-S`(TF-0119),按 §R3.2 阈值折算是 40+5+15+5 = **65**。TF-0116 曾被记为 `brb-M`=15、实测 21 而「仍超」,后被上调为 `brb-L`。**预算按 §R3.6 冻结于 B1,故 40 仍是有效判据**——但表里的「构成」栏已不描述现状,这是本轮第五处「定义与测量不一致」。

**本节不处置 M2。** §R3.5 对超半径只给两条出路(拆分 / 降级),都不是本席能单方定的:M2 横跨两条车道且尚未开始收口。作为 XL-* 项挂出,close 判据为「M2 的判定读数 ≤ 其冻结预算,或已按 §R3.5.1 处置为 `landed-unwired`」。

**2026-09-07 已按 §R3.5.1 处置**:`X1`/`XL-017` 用户批准后,TF-0115 (M2) 按 §D1.3 表达方式降为 `review_needed/100 + landed-unwired`(context_tags + summary 前缀),不标 `done`;冻结预算 40 不动,全轮去重半径 230 不动;`TFD-tf0115-ac4-difference-note-deferred-2026-09-07` 随本降级一并结案。读数仍如实为 `50/40`,记录面不修;本处置记于 DEV-PROTOCOL §R3.5.1 与 Task Forest `TFP-tf0115-landed-unwired-x1-20260907`。

## 12. D5：agent-core 发现面与新增节点归属复算（TF-0149，2026-09-05）

基准提交固定为 `ac827cda31daa530720b3ef6f3b562f63ba1720c`，范围为 `590588791..ac827cda3`。本节追加当前读数，不改写 §11 的历史结果、不修改失败白名单，也不宣布任何里程碑完成。

### 12.1 先区分实施范围、发现面与计数面

- §R5 范围-1 的目录文字不含 `openclaw_runtime/packages/agent-core/`。该包虽 `private: true`，仍通过 26 个 `exports` 入口与声明文件向消费者提供包契约；不能因其服务压缩而自动视为 `openclaw_runtime/src/` 的子目录。
- §R3.6 的 `RS` 是无归属提交的发现面。归属明确的提交经 `ATTRIBUTED` 选中后按完整文件并集计数，原式没有排除 `packages/`。TF-0124 的五个包内文件已计入，原任务描述中「M1 在该目录上是盲的」不是实测结论。
- `RS` 增加 `openclaw_runtime/packages/agent-core`，只补归属发现能力；它不授权今后的包修改，不修改 §R5，也不改变预算。TF-0124 的历史范围记录缺口另以追加式 deviation 处理，见 `reviews/TF-0149.md`。

### 12.2 提交集复算

| 取集 | 提交数 | 判定文件数 | 全量文件数 | 冻结预算 | 包内文件数 |
|---|---:|---:|---:|---:|---:|
| TF-0124 实施归属（不含 `Reviews:`） | 6 | 16 | 16 | 当前 `brb-L` 40 | 5 |
| M1 六个子节点 | 21 | 28 | 42 | 30 | 0 |
| M2 四个子节点 | 16 | 50 | 50 | 40 | 0 |
| M3 四个活跃子节点 | 23 | 40 | 60 | 50 | 5 |
| 全轮归属完整集：原 RS、原 102..147 | 135 | 163 | 284 | 230 | 5 |
| 全轮归属完整集：补 RS、102..150 且排除 148 | 135 | 163 | 284 | 230 | 5 |

M1、M2、M3 的取集仍分别是 `{110,111,112,113,114,137}`、`{116,117,118,119}`、`{121,122,124,126}`。TF-0124 的父节点是 M3/TF-0120。**M2 的 50/40 仍超限**；本次没有新增豁免，也没有因单个 task 上调 brb 而增大里程碑预算。**2026-09-07 已按 §R3.5.1 处置为 `landed-unwired`，读数仍如实为 50/40，本表值不修**。

此时 TF-0149/0150 尚无提交，因此成员补正不改变上述历史读数；本任务后续提交须以新口径再次计入，不能把 `163/284` 当作提交后的最终值。

### 12.3 新增发现项与节点判定

扩展 RS 只新增以下两个无 `Task:`/`Reviews:`/`Lane:` 的候选；均逐条读取了完整 diff，未因命中包路径而自动认作本轮：

| 提交 | 真实改动 | 归属裁定 |
|---|---|---|
| `a3fa5c2d9` | `agent-loop.ts` 的 EventStream 构造类型断言，1 文件 | 轮外 typecheck 修复；不计入本轮 |
| `e1ed74b40` | 同一 agent-loop 类型断言及 28 个根目录测试类型/夹具整理，29 文件 | 轮外 typecheck 修复；不计入本轮 |

`ROUND_HI` 改为 150 并显式跳过 TF-0148：TF-0149/0150 直属 TF-0102，计入本轮；TF-0148 是独立 RC-04/VerseShell follow-up；TF-0151 属 M6，继续排除。TF-0102..0147 已发生的治理提交取集不变，既有移轮成本不追溯抹去。预算仍为 B1 冻结值；新增节点不产生新预算。

本次不改变两车道已收口的逐任务半径，也不为 M1 或 M2 会签。修改后的判据及本裁定仍须按 §R1 接受非实现者复核，完整记录见 `reviews/TF-0149.md`。

## 13. TF-0108 本次收口范围已裁定，最终 L2 待执行（2026-09-06）

用户委托独立技术复核会话完成范围/预算裁定，现行规则见 **DEV-PROTOCOL.md §R3.6.1** 的 JSON 及生效条件。该节是唯一准入来源，本节只记录裁定时读数：

| 对象 | 读数 | 结论 |
|---|---:|---|
| 原六子节点 | 28 authored | 历史基线 |
| `551759e32`（含三个 TF-0108 修复提交） | 42 authored / 56 全量 | 对原 30 预算的 FAIL 保留 |
| 上述集合加必需的 LATEST 交接 | 43 authored / 57 全量 | 已获逐路径许可，最终提交仍须重算 |
| M1 本次有效上限 | 43 | 仅适用于批准的 15 个新增路径及限定语义 |
| 全轮去重半径硬上限 | 230 | 保持原值，局部上限变更不增加全轮预算 |

这次裁定明确增加 M1 的局部上限，增量为 13；并未把 14 个修复路径免计、移给 TF-0119，或取消总量门。M2 的 50/40 继续挂账。**2026-09-07 该挂账已按 §R3.5.1 处置为 `landed-unwired`，预算 40 不动、题面不变**。

第 5 段失败集合仍须为 25 项基线与四项轮外 A2 的子集，原三项 P2-005 错误不准再次入账。第 7 段 96→79 的既有复测仍按 `reviews/TF-0108.md §11.2` 的 freshness 限制解读。本节没有改动 §6 白名单 JSON。

**范围/预算裁定已完成，完整 L2 尚未因此通过。** 下一步把修复、裁定与交接固定为最终候选，重新计量，按 §R2.3 完整执行五道 L2 并完成正式独立会签；TF-0108 保持 `review_needed/98`。

## 14. M4（TF-0127）已按 §R3.5.1 处置为 landed-unwired，F-GOV-003 走 XL-018 Q3 路径①（2026-09-08）

M4 = `{TF-0128, TF-0138, TF-0143}`，B1 冻结预算 25。第三棒（Claude Sonnet 5，2026-09-08）归属闭合后实测：

| 集合 | 读数 | 结论 |
|---|---:|---|
| 机械 authored（按 Task:/Reviews: trailer） | 18 | 漏计 TF-0143 的 7 条已认领交付 |
| 机械 + TF-0143 漏计 7 + e2a3db8d9（T-C1） | 25 | 触顶不超，与 B1 25 相等 |
| 加上本次治理成本（LATEST 交接、Harness spec、TF-0127审核记录、task-forest 落账） | ≈29 | 触顶超限 +4 |

§R3.5 拆分不可用（实现提交已联账落仓，TF-0149 §R5 过程-8 同构先例）；§R3.5.1 四条适用条件全部满足（至少一项已提交实现、子节点全 done、拆分评估不可用、有 M1 §R3.6.1 与 M2 §R3.5.1-XL-017 同形态先例）。用户于 2026-09-08 批 <code>AUDIT-BOARD.html XL-018 Q1</code>，TF-0127 降级为 <code>review_needed/100 + context_tags=landed-unwired + summary 前缀 [landed-unwired]</code>，与 TF-0137/TF-0115 同表达。<strong>预算 25 与全轮去重 230 不动，半径超限按 §14 挂账不修读数。</strong>

F-GOV-003 新鲜度 Publish-blocker High 同时处置：用户于 2026-09-08 批 <code>XL-018 Q3 路径①</code>——P6-005 owner（lane-2）在干净 detached worktree 重跑 <code>node scripts/collect-p6-005-evidence.mjs --ref refs/heads/feat/runtime-lifecycle-governance --out &lt;external&gt;</code>：13 个 release 门 + <code>pnpm build:runtime</code> preflight + double-byte manifest。落地后 <code>latestEvidenceAt ≥ 2026-09-07</code>，<code>latestSourceAt - latestEvidenceAt</code> 回负，F-GOV-003 stale 解除；M4 的 L2 第 7 段复跑应回到判 PASS 集合。

绑定的 hard anchor：<code>hnalliasos-1ac8dffe-20260906</code>（M1）/ <code>hnalliasos-0bb5dbb48-20260908</code>（M4）双 SHA 形态记日志。<strong>本节声明：未来若有人引 §R3.5.1 处置后续里程碑，必须同 M4 一样不动冻结预算/不动全轮 230/不动 §6 白名单，且范围处置继续交独立第三会话最终 L2 + 双车道会签。</strong>
