# GATE-BASELINE —— 既有红门基线与 L1/L2 收紧定义

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
      "exemptions": [
        { "file": "tests/integration/p1-orchestration-boundary.integration.test.ts", "tests": ["*SUITE_LOAD_FAILURE*"], "class": "exempt-noise", "basis": "env-loader", "reason": "TypeError: The URL must be of scheme file", "owner": "platform" },
        { "file": "tests/integration/p1-sensitive-content-boundary.integration.test.ts", "tests": ["*SUITE_LOAD_FAILURE*"], "class": "exempt-noise", "basis": "env-loader", "reason": "TypeError: The URL must be of scheme file", "owner": "platform" },
        { "file": "tests/unit/memory-gateway-handlers.test.ts", "tests": ["*SUITE_LOAD_FAILURE*"], "class": "exempt-noise", "basis": "env-loader", "reason": "TypeError: The URL must be of scheme file", "owner": "platform" },
        { "file": "tests/unit/role-orchestration-methods.test.ts", "tests": ["*SUITE_LOAD_FAILURE*"], "class": "exempt-noise", "basis": "env-loader", "reason": "TypeError: The URL must be of scheme file", "owner": "platform" },
        { "file": "tests/unit/runtime-lifecycle-governance.test.ts", "tests": ["drains 50 create/stop process-tree cycles without registry, timer, or heap leaks"], "class": "exempt-noise", "basis": "env-platform", "reason": "wmic absent on Windows 11", "owner": "platform" },
        { "file": "tests/unit/rc09-ownership-matrix.test.ts", "tests": ["covers the exact cumulative diff with exactly one RC owner per path", "every pre-chain entry is attributed to an RC via spec ownership", "exists, uses the correct schema, and matches the accepted base SHA", "the generator reproduces the committed matrix byte-for-byte"], "class": "backlog-debt", "basis": "missing-acceptance-artifact", "reason": "ENOENT changed-path-ownership.json", "owner": "TF-0028" },
        { "file": "tests/unit/rc01-authority-inventory-baseline.test.ts", "tests": ["fails closed when a classified owner path is absent from the candidate", "pins acceptedBaseSha to the accepted base, not to the moving candidate", "regenerates byte-identically at the same commit"], "class": "backlog-debt", "basis": "missing-acceptance-artifact", "reason": "git ls-files failed / acceptedBaseSha drift", "owner": "TF-0029" },
        { "file": "tests/unit/runtime-authority-convergence-control-pack.test.ts", "tests": ["allows done only after engineering evidence and explicit user acceptance"], "class": "backlog-debt", "basis": "missing-acceptance-artifact", "reason": "engineering evidence absent", "owner": "TF-0028" },
        { "file": "tests/unit/local-control-plane.test.ts", "tests": ["registers read-only Gateway descriptors and exposes status/reports/correlations RPCs"], "class": "backlog-debt", "basis": "control-plane-descriptor-drift", "reason": "descriptor registration assertion", "owner": "TF-0010" },
        { "file": "tests/unit/security-verification-shadow.test.ts", "tests": ["registers every MVP method as advertised operator.read core descriptors"], "class": "backlog-debt", "basis": "control-plane-descriptor-drift", "reason": "operator.read descriptor assertion", "owner": "TF-0010" },
        { "file": "tests/unit/chat-render-reachability.test.tsx", "tests": ["does not also render the plan as a message card", "replays an update_plan tool call from history into the turn summary"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted src/pages/Chat churn", "owner": "TF-0021" },
        { "file": "tests/unit/chat-question-directory.test.tsx", "tests": ["keeps real repeated questions as separate directory entries"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted src/pages/Chat churn", "owner": "TF-0021" },
        { "file": "tests/unit/chat-save-to-knowledge.test.tsx", "tests": ["keeps the toolbar free of the obsolete more-actions menu"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted ChatToolbar churn", "owner": "TF-0021" },
        { "file": "tests/unit/fakecoding-design-system.test.ts", "tests": ["defaults the shared page shell to a 28px sans heading with zero letter spacing"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted src/styles churn", "owner": "TF-0021" },
        { "file": "tests/unit/first-product-claims.test.ts", "tests": ["keeps forbidden graduation terms out of every current product surface"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted product-surface churn", "owner": "TF-0021" },
        { "file": "tests/unit/knowledge-steward-semantic-pass.test.ts", "tests": ["appends \"semantic pass unavailable\" when classification is semantic but no invoker is set", "appends \"semantic pass unavailable\" with error message when invoker throws", "keeps heuristic type when semantic confidence is below threshold", "merges semantic result when invoker returns a valid review"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted knowledge/sekb churn", "owner": "TF-0007" },
        { "file": "tests/unit/tf0018-sekb-no-auto-writeback.test.ts", "tests": ["persists no principle until confirm_and_save is called explicitly"], "class": "exempt-noise", "basis": "subject-files-dirty", "reason": "uncommitted knowledge/sekb churn", "owner": "TF-0018" }
      ]
    },
    "maturity_validate": {
      "requiredExitCode": null,
      "failsAtScript": "validate-system-maturity-evidence.mjs",
      "chainPosition": "4 of 6",
      "unrunScripts": ["run-system-maturity-residual-audit.mjs", "validate-system-maturity-traceability.mjs"],
      "blindSpot": "scripts 5-6 never execute due to && short-circuit; their state is UNKNOWN, not green",
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
      "chain": ["node scripts/check-no-bom.mjs", "eslint .", "pnpm run lint:dcs"],
      "requiredExitCode": null,
      "failsAtChainSegment": "2 of 3 (eslint .)",
      "unrunSegments": ["pnpm run lint:dcs"],
      "blindSpot": "&& short-circuit means lint:dcs never runs inside lint:check; RESOLVED by measuring it standalone (exit 0), unlike the maturity_validate blind spot which remains UNKNOWN",
      "segmentExitCodesMeasuredStandalone": {"check-no-bom": 0, "eslint .": 1, "lint:dcs": 0},
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
      ]
    }
  },
  "regressionRule": "Any failure not present in the matching exemptions list is a regression and blocks. Entry count may only decrease; additions require record_deviation per R4 trigger (c).",
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
