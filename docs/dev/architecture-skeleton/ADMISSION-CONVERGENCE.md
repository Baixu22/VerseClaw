# 接入层兼容回归与收敛报告（TF-0652 / A6）

> 节点：TF-0652（批次 A / A6，父 TF-0628）
> 合同：harness/specs/tasks/architecture-skeleton-admission-regression.md
> 候选行为提交：`590ba5258cd5ddd65e133657762e77811376d0a9`（tree `01b8f8964ba487137e679383d15a111c174326ee`）
> 回归基线：`97cda35de`（A3 的直接父提交）
> 证据执行头：`de1821e424b1dbe93dc1c862b5b78abcce80934c`（仅证据/文档增量；干净 E2E 由此开始）
> 产出者：agent（`driven_by: agent`，actor: codex）；没有真人操作或真人 verdict

## 1. 结论

A3-A5 的运行时接入收敛已完成并可静态复核：A3 迁移活体消费者，A4 将 E2E mock 缝迁移到 typed `host:invoke`，A5 退役 43 条扁平 request/response handler 与 preload 的直接 invoke 入口。仓库现在的请求/响应接入口只剩 `host:invoke`。

A6 的 **A3-A5 兼容性判定为 pass**：相对基线，没有出现候选引入的单元测试失败；A3-A5 改动的 22 个 E2E 规格和 15 个单元测试文件全部通过。与此同时，**仓库级测试并未全绿**：

- 全量单测：9723 passed / 168 failed / 91 skipped，exit 1。168 个失败测试名与 97cda35de 在相同本地资源下的基线复现集**逐项完全一致**（`onlyFinal=[]`，`onlyBase=[]`）。
- 全量 E2E：418 条已全部执行，391 passed / 22 failed / 5 skipped，另有 1 条 suite-level error，exit 1；没有 not-run。
- 22 个 E2E 失败在 41 条隔离复跑中变为 6 条 intermittent（单独复跑通过）和 16 条 persistent；逐项分类见 `e2e/failure-classification.json`。
- lint:check、typecheck、build、contract、repo:artifacts、harness 均 exit 0；lint 为 0 errors / 116 warnings。

因此本节点关闭的含义是 **A6 兼容性审计完成且未发现 A3-A5 回归**，不是“仓库所有测试都通过”。上述既有失败作为明确的后续产品/测试债保留，不把它们计入 A3-A5 兼容性通过。

## 2. 门禁读数

| 门禁 | exit code | 判读 | 证据 |
|---|---:|---|---|
| `pnpm run build:vite` | 0 | pass | `logs/build-vite.log` |
| `pnpm run typecheck` | 0 | pass；node/web/test 三段均 0 error | `logs/formal-typecheck.log` |
| `pnpm run lint:check` | 0 | pass；0 errors / 116 warnings | `logs/lint.log` |
| `pnpm contract:check` | 0 | pass | `logs/formal-contract.log` |
| `pnpm repo:artifacts:check` | 0（最终文档落盘后需复跑） | pass-preliminary | `logs/formal-repo-artifacts.log` |
| `pnpm harness validate --spec ...` | 0 | pass | `logs/formal-harness.log` |
| `pnpm harness run --spec ... --dry-run` | 0 | pass | `logs/formal-harness.log` |
| `pnpm run build:runtime` | 0 | pass；Gateway smoke ready | `logs/openclaw-build.log` |
| `pnpm test` | 1 | baseline-equivalent failures；无 candidate-only failure | `unit/final-summary.json`、`unit/baseline-summary.json` |
| `pnpm run test:e2e:run` | 1 | full 418 observed；failures 已逐项分类，不声称 pass | `e2e/final-summary.json`、`e2e/failure-classification.json` |

## 3. 全量单测与基线对账

`pnpm test` 最终读数为：

- Test Files：58 failed / 1065 passed / 5 skipped / 1128 total
- Tests：168 failed / 9723 passed / 91 skipped / 9982 total

基线复现使用与候选相同的本地 ignored 资源（`vg.exe`、`ae.exe` 以及 Electron 40.8.4 dist），只复跑候选失败文件对应的 66 个文件：

- 168 failed / 356 passed / 57 skipped
- 候选 168 个失败测试名与基线同类集合完全相同
- `onlyFinal=[]`，`onlyBase=[]`

因此这 168 个失败是**既有测试/产品债**，没有证据表明 A3-A5 增加了单测失败。失败主要覆盖 runtime-memory flag/persistence、grounding、部分 VerseGit/产品断言；逐项键值保存在 `unit/baseline-summary.json`。

## 4. 全量 E2E 与失败分类

正式运行：`418 tests using 1 worker`；完整观察 418 条，无 not-run。

- 391 passed
- 22 failed
- 5 skipped
- 1 suite-level error（Playwright 在测试之外报告，未计入 pass）
- exit 1

隔离复跑 41 条相关测试（同一候选，单 worker）：

- 25 passed / 16 failed
- 6 条只在全量上下文失败、单独复跑通过：`brand-logo`、`chat-model-scope-runtime`、`rc10-operator-live`、`restart-recovery`（in-flight 用例）、`versegit-candidate-apply`、`versegit-packaged-flow`
- 16 条在隔离环境仍失败：主要涉及 channels binding selector、DCS preview、worker cleanup、error i18n、FakeCoding、knowledge review、main navigation、openclaw dreams、restart recovery、system maturity、windows UI v2、workspace preview visual snapshot

这些失败均不在 A3-A5 改动的 E2E 规格中；A3-A5 改动的 22 个 E2E 规格在正式全量运行中全部通过，证据见 `e2e/changed-path-status.json`。逐项失败、隔离结果和分类见 `e2e/failure-classification.json`。

## 5. 静态边界与运行时约束

- 受保护文件共 7 个 blob；`docs/dev/default-config-matrix.md`、`shared/dcs/`、`electron/main/ipc/host-invoke.ts` senderAuth、`electron/services/permissions-api.ts` 相对 `97cda35de` 全部相等，见 `boundary-diff.json`。
- A6 没有修改运行时代码；A6 相关写入为测试、文档与证据。
- 为运行本机验证，使用了 ignored 的 `vg.exe`、`ae.exe` 和 Electron 40.8.4 dist；三者分别与 tracked manifest/package 版本及 SHA-256 匹配，未记为 tracked source。
- 全部运行均由 agent 触发，未声称 real-human 证据。

## 6. 证据目录

- `candidate.json`：候选/基线身份、执行头与本地资源摘要
- `boundary-diff.json`：默认矩阵/权限路径 blob 对账
- `gates.json`：门禁矩阵和判读
- `gates/`：逐门禁原始元数据
- `logs/`：完整命令日志
- `unit/final-summary.json`、`unit/baseline-summary.json`：单测与基线对账
- `unit/changed-path-status.json`：A3-A5 改动单元测试文件的通过矩阵
- `e2e/final-summary.json`、`e2e/final-speed-ledger.json`：完整 418 条 E2E 汇总
- `e2e/triage-summary.json`、`e2e/failure-classification.json`：隔离复跑和逐项失败分类
- `e2e/changed-path-status.json`：A3-A5 改动 E2E 规格的通过矩阵

最终门禁完成后，`SHA256SUMS` 覆盖目录内全部保留文件；`credential-scan.json` 记录零命中。

## 7. 收口边界

TF-0652 可以作为 **A6 兼容性审计完成**关闭；不得把本报告解释为仓库全量测试全绿、产品 GA、release-ready 或 default-on。后续产品/测试债应继续由各自 owner 处理。