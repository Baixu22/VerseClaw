# 接入层兼容回归与收敛报告（TF-0652 / A6）

> 节点：TF-0652（批次 A / A6，父 TF-0628）
> 合同：harness/specs/tasks/architecture-skeleton-admission-regression.md
> 候选：6b7f8eb496a43418ffaf880dc3590ed1042c6fc9（tree 55ee24451391bf67e23214915deaceb55d6704d9）
> 基线：97cda35de（A3 的直接父提交）
> 产出者：agent（driven_by: agent，actor: codex）；没有真人操作或真人 verdict

## 1. 结论

批次 A 的运行时收敛已经完成并可静态复核：A3 迁移 4 个活体消费者，A4 将 E2E mock 缝迁到 typed host:invoke，A5 将 43 条扁平 request/response handler 与 preload 第二入口全部退役。仓库现在只有 host:invoke 一个请求/响应入口。

A6 的兼容回归**尚未通过**。正式干净候选上：

- typecheck、contract:check、harness run --dry-run 通过。
- 构建通过，默认矩阵与权限路径相对基线零 diff。
- 全量单测为 9697 passed / 187 failed / 92 skipped，exit 1。
- 全量 E2E 没有被完整跑到终点：正式串行 run 只留下 24 条观察结果（24 passed），随后被桌面会话关闭截断；另一次补齐 run 观察到 234 条（195 passed / 37 failed / 2 skipped），同样在 long-session-* 用例处中断；剩余 184 条为 not-run。
- lint:check 在候选上 exit 1：5 个 error / 133 个 warning。

因此本节点**不满足收口条件**，不应把 652 标成 done，也不能勾掉“现有产品行为变化 = 0”。这些失败是真实未收敛的验收缺口，不是“跑过即通过”。

## 2. 已通过的证据

| 项 | 结果 | 证据 |
|---|---|---|
| 候选身份 | 6b7f8eb496a43418ffaf880dc3590ed1042c6fc9 / tree 55ee2445... | candidate.json |
| 构建 | pnpm run build:vite exit 0 | gates/build-vite.json、logs/build-vite.*.log |
| 类型检查 | node / web / test 三段 exit 0，测试类型 errorCount 0 | logs/formal-typecheck.log |
| 合同门禁 | Contract check passed. exit 0 | logs/formal-contract.log |
| Harness dry-run | Harness result: pass | logs/formal-harness.log |
| 默认矩阵与权限路径 | 7 个受保护文件 blob 全等、changedFiles 为空 | boundary-diff.json |
| 扁平入口静态读数 | ipcMain.handle 仅剩 host:invoke；preload 仅一条 typed host:invoke invoke | A5 证据与 ADMISSION-GATE.md |

默认矩阵与权限路径的比较对象是：docs/dev/default-config-matrix.md、shared/dcs/、electron/main/ipc/host-invoke.ts、electron/services/permissions-api.ts。本项是静态边界证据，不能替代运行时回归。

## 3. 未通过或未完成的门禁

### 3.1 全量单测

unit/final-summary.json：exit 1，9697 passed / 187 failed / 92 skipped。失败呈现为可定位的具体测试，不是“没有运行”。unit.stdout.log 和 unit.stderr.log 保留原始输出。

失败中可直接识别的环境类缺口包括：

- resources/bin/win32-x64/ae.exe 缺失，导致 verseshell-manifest.test.ts 的 7 条用例在 fixture 复制阶段失败；
- 其余失败覆盖 runtime-memory、grounding、error governance、claims、VersaryHost 等多组产品断言。它们尚未被证明为“与 A3–A5 无关”，所以不能整批归为环境问题，也不能据此宣称兼容回归通过。

### 3.2 全量 E2E

- e2e/final-summary.json：418 条声明中观察到 234 条，195 passed / 37 failed / 2 skipped，剩余 184 条 not-run；没有最终 Playwright 汇总。
- gates/e2e-attempt1..5 保留各次 setup、缓存、并发争用的中间尝试；它们不计入最终 verdict。
- 已观察到的失败覆盖 Agent First、DCS/FakeCoding、coding-loop、long-session、channels binding、context-pressure、layout CDP 等产品路径。既有失败与 not-run 都必须在回归结论中保留。

### 3.3 Lint

gates/pnpm-run-lint-check.json：exit 1，5 errors / 133 warnings。错误位于既有的测试与 E2E 文件，不在 A6 的文档/证据写集内，但仓库级 lint:check 仍不是绿色，因此不能作为候选通过证据。

### 3.4 仓库证据门禁

repo:artifacts:check 在最终文档落盘前曾因缺少 docs/dev/architecture-skeleton/ADMISSION-CONVERGENCE.md 失败；本次提交补齐该文件和 scripts/repository-artifacts.json 登记后，需重新运行并以最终 exit code 为准。

## 4. 收敛判据

| CHARTER §8 判据 | 读数 |
|---|---|
| 未分类接入通道 | 0（A5：仓库仅剩 host:invoke；产物登记完整） |
| 同一组件冲突 owner | 本轮 A6 未改，沿用既有唯一 owner 校验结果 |
| 语义合同坏例拒绝率 | contract:check 通过；负例 fixture 仍走真实入口 |
| 陈旧来源被当作当前通过 | 0；候选 commit/tree 与证据绑定，中间尝试明确标注不计入 |
| 新增运行时组件 / 第二真源 | 0；A6 未改运行时源码 |
| 现有产品行为变化 | **未证 0**：unit / E2E / lint 均有失败或大量 not-run |

## 5. 未完成项与建议

1. 先修复或登记全量单测的 187 个失败，逐项区分候选回归、测试生成物、缺失资源与既有失败；重新在干净候选跑全量单测。
2. 继续跑完 418 条 E2E，直到产生最终 Playwright 汇总；中间尝试不能替代最终 run。
3. 仓库级 lint:check 的 5 个 error 需要单独收口。
4. 重新运行 repo:artifacts:check 与 harness dry-run，生成覆盖全部证据文件的 SHA256SUMS 与零命中凭据扫描。
5. 只有以上门禁全部通过、证据链完备，才可更新 TF-0628 summary 并把 TF-0652 置 done。

## 6. 证据目录

- candidate.json：候选与基线身份
- boundary-diff.json：默认矩阵/权限路径 blob 比较
- gates.json：门禁矩阵和 verdict
- gates/：逐门禁原始元数据
- logs/：原始 stdout/stderr
- unit/、e2e/：失败汇总与观察账本

所有运行均由 agent 触发；未声称 real-human 证据。
