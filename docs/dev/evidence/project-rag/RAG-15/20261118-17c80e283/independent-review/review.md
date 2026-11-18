# G2/RAG-15 Independent Verifier v7

最终 verdict：**PASS / patch is correct**，confidence 0.99。

actor：`codex-g2-rag15-verifier-v7-20261118`  
model：`ccs-workbuddy/deepseek-v4.1-flash`  
provider-reported model：`deepseek-v4.1-flash`  
driven_by：`agent`  
realHumanEvidence：`false`

冻结候选：HEAD `17c80e283e4e7184791a7be0f168bd35309494bf`，tree `38d5640dc2553f45283b73f908f7b9fe5a8651aa`，diffBase `f2438fed1f3e041d1a669696e7af6657ceaac87f`。verification root：`D:/tmp/project-rag-rag15-20261117/independent-review-v7/verifier-worktree`。

## Input binding

manifest `inputs.json` 的 52 项在 source 与独立 shared clone 中逐文件 SHA-256 一致；source 与 clone tracked worktree 均为 clean，source HEAD/tree 保持冻结候选。起点和终点 hash 相同，end status 为 `pass`。

## Acceptance criteria

### 1. pass

FactStore 有可选 SQL LIMIT，默认 -1 返回全量；关系边绑定 project、sourceFile、当前 AST/type-checker 解析出的实际符号路径与 SourceRef/v2 revision。

源码锚点：`openclaw_runtime/src/context-engine/factstore/statements.ts:207-212`、`openclaw_runtime/src/context-engine/factstore/store.ts:265-283`、`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:274-441`

磁盘证据：`openclaw_runtime/src/context-engine/factstore/factstore.test.ts:122-141`、`tests/unit/project-rag-graph-task-context.test.ts:62-71`

### 2. pass

relationship/research 才进入图扩展；默认深度 1、硬上限 2、节点上限 32、边上限 128；每个落点读取与末尾复验均执行 owner/hash/revision 准入。

源码锚点：`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:22-24`、`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:53-140`、`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:143-525`、`openclaw_runtime/src/agents/tools/context-agent-tools.ts:515-535`

磁盘证据：`tests/unit/project-rag-graph-task-context.test.ts:73-103`、`tests/unit/project-rag-graph-task-context.test.ts:110-235`、`tests/e2e/project-rag-research.spec.ts:120-155`

### 3. pass

TaskContextHint 仅调用 binding、evidence、checkpoint revision 读取；返回 revision/constraints/evidenceRefs 并 fencing 末次变化，不写入任务表，也不把任务目标送入 code chunks。

源码锚点：`openclaw_runtime/src/knowledge/retrieval/task-context-hint.ts:27-126`、`openclaw_runtime/src/knowledge/retrieval/task-context-hint.ts:129-149`、`openclaw_runtime/src/context-engine/views/pack/context-pack-view.ts:55-70`

磁盘证据：`tests/unit/project-rag-graph-task-context.test.ts:301-349`、`tests/e2e/project-rag-research.spec.ts:97-101`、`tests/e2e/project-rag-research.spec.ts:142-149`

### 4. pass

负例覆盖 cross-workspace、stale edge、同名文件/符号、缺 Ledger、lookup 无图读取、歧义符号、显式未知路径拒绝回退，以及拒绝 disabled/旧 pin 降级。

源码锚点：`openclaw_runtime/src/agents/tools/context-agent-tools.ts:466-507`、`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:178-180`、`openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion.ts:212-272`、`tests/unit/project-rag-graph-task-context.test.ts:104-160`、`tests/unit/project-rag-graph-task-context.test.ts:253-296`、`tests/unit/project-rag-graph-task-context.test.ts:311-349`

磁盘证据：`tests/e2e/project-rag-research.spec.ts:80-103`、`tests/e2e/project-rag-research.spec.ts:150-165`

### 5. pass

plannedTests 与 plannedE2E 已在 task spec、manifest requiredTests 和磁盘实现中绑定同一候选；requiredTests 七项分别由 unit/runtime-unit/electron receipts 覆盖。

源码锚点：`harness/specs/tasks/project-rag-code-graph-task-context.md:59-83`

磁盘证据：`D:/tmp/project-rag-rag15-20261117/independent-review-v7/verifier-gates/formal-unit-v7/unit.json`、`D:/tmp/project-rag-rag15-20261117/independent-review-v7/verifier-gates/formal-runtime-unit-v7/runtime-unit.json`、`D:/tmp/project-rag-rag15-20261117/independent-review-v7/verifier-gates/formal-electron-v7/receipt.json`

## Independent gates

| phase | status | exit | counts | receipt |
|---|---:|---:|---|---|
| unit | pass | 0 | {"success":true,"numTotalTests":130,"numPassedTests":130,"numFailedTests":0,"numPendingTests":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-unit-v7\receipt.json` |
| runtime-unit | pass | 0 | {"success":true,"numTotalTests":66,"numPassedTests":66,"numFailedTests":0,"numPendingTests":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-runtime-unit-v7\receipt.json` |
| types | pass | 0 | {"cacheEnabled":false,"results":["node scripts/generate-ext-bridge.mjs","pnpm run typecheck:node","pnpm run typecheck:web","pnpm run typecheck:test"],"failed":0,"skipped":0,"cacheHits":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-types-v7-r2\receipt.json` |
| build | pass | 0 | {"commands":2,"failed":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-build-v7\receipt.json` |
| electron | pass | 0 | {"startTime":"2026-11-18T05:33:29.116Z","duration":123662.93500000001,"expected":1,"skipped":0,"unexpected":0,"flaky":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-electron-v7\receipt.json` |
| control-e2e | pass | 0 | {"startTime":"2026-11-18T05:36:05.068Z","duration":48480.924,"expected":4,"skipped":0,"unexpected":0,"flaky":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-control-e2e-v7\receipt.json` |
| checks | pass | 0 | {"commands":7,"failed":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-checks-v7\receipt.json` |
| lint | pass | 0 | {"commands":1,"failed":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-lint-v7\receipt.json` |
| runtime-lint | pass | 0 | {"commands":1,"failed":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-runtime-lint-v7\receipt.json` |
| format | pass | 0 | {"commands":1,"failed":0} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-format-v7\receipt.json` |
| ci | pass | 0 | {"results":12,"failed":0,"success":true} | `D:\tmp\project-rag-rag15-20261117\independent-review-v7\verifier-gates\formal-ci-v7\receipt.json` |

独立 unit 为 130/130，runtime-unit 为 66/66，合计 196；Electron required journey 的 10 个 step 全 true，产生 3 张 required RAG 截图；control E2E 4/4；CI 12/12。全部 11 个 phase 的 `sourceUnchanged=true`。

`types` 首次因 clone 缺少 VerseBrowser 的预构建 `dist` 而失败，失败 receipt 保留在 `verifier-gates/formal-types-v7`。随后仅在该 clone 内以 package junction 借用已冻结主 projection 的预构建 `dist`，在同一候选重跑 `formal-types-v7-r2`：node/web/test 均真实执行，cache disabled，0 skipped、0 cache hit。

## Focused probes

- 513-call incoming scan：`sourceCallEdges=513`，结果 `status=partial`、`truncated=true`、`targetCallEdges=0`。
- impact parity inputs：7 份输入合计 58,043 bytes，baseline LF SHA-256 为 `07d938ec153acdd3d3989776b119aa9781da2728135467797be2af6b492981e6`；freshness 按 6118 blob 恢复原 CRLF；缺失与篡改均 fail closed。
- 原 `impact-parity-v1.json` 与 diffBase 字节一致。FactStore LIMIT 默认回归已由 17/17 FactStore tests 覆盖。
- required RAG 三张截图正文和最终消息可见；capped 页面显示 partial/truncated 结果，stale 页面显示拒绝结果。

## Main chain crosscheck

主 `formal-chain-17c80e283/receipt.json` 的 11 个 `chain.phases[].receipt` 路径逐项存在并绑定同一候选；types 使用实际路径 `D:\tmp\project-rag-rag15-20261117\formal-types-17c80e283-host2\receipt.json`。主 receipt 为 `pass`，独立 receipt 为 `pass`。

## Findings

无 finding。

Agent-driven evidence shows input binding clean and matched, contract_5 all pass, verifier 11 formal gates all pass, and required unit/runtime/electron/control/required-tests/negative probes pass. The 513-cap probe reports partial/truncated=true with the overflowing target call not admitted (targetCallEdges=0), satisfying the critical cap rule. The initial types setup failure due to missing VerseBrowser prebuilt dist is retained as an environment-preparation failure and resolved by the allowed package junction, with final no-cache types pass. No substantive finding remains.
