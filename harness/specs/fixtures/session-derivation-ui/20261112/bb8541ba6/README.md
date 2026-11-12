# TF-0662 会话派生与生命周期验收证据

- 任务：项目入口、任务清单和会话生命周期完整体验（TF-0662）
- 最终 HEAD：`bb8541ba6bba40fa18c5578f7818279cf0bead81`
- 产品提交：`a9d87862f5321fba6dc561ba1a491c9665aaa406`
- 驱动：`driven_by: agent`，`actor: codex-tf0662-relay`
- 请求路由：`ccs-workbuddy/deepseek-v4.1-flash`

## 结果

| 范围 | 结果 |
|---|---:|
| 最终 HEAD 15 条真实 Electron/Gateway 分片回归 | 15/15 passed，0 非预期 skip |
| U6 候选六旅程 | 6/6 passed |
| U6 基线同 driver 可执行旅程 | 5/5 passed；旧版 Handoff 对话框不可用 |
| 聚焦单测 | 174/174 passed（10 files） |
| Observer worker 单测 | 2/2 passed |
| 构建、typecheck、contract、i18n、comms、harness | 全部 exit 0 |

最终 HEAD 上的 15 条回归按五个 spec 分片独立启动并清理，所有分片 cleanup 均为 `remaining=0`、`survivors=0`、`pendingLaunches=0`。`gateway/HEAD-BINDING.json` 用 HEAD reflog 时间窗、clean worktree 与 source guard 绑定每个分片到同一 `bb8541ba6`。`build:vite` 前后 main、renderer、runtime entry 三个哈希不变；候选 build manifest 登记 4354 个产物。

## 目录

- `gateway/shard-*/`：最终 HEAD 的五片聚合回执、测试 JSON、截图、source guard 与进程清理收据。
- `u6/candidate/`：new-task、continue、cross-tree-migration、crash-recovery、archive-restore、handoff 六旅程。
- `u6/baseline/`：同 driver 的基线五旅程与旧版 Handoff 不可用记录。
- `unit-tests.json`、`role-worker-unit.log`：聚焦单测与 observer 参数回归。
- `typecheck.log`、`contract-check.log`、`i18n-lint.log`、`comms-*.log`、`harness-*.log`：门禁回执。
- `candidate-build-manifest.json`、`baseline-build-manifest.json`：候选和基线构建身份。
- `report.json`：11 条验收标准与证据索引。
- `RETRY-HISTORY.md`：首次失败、隔离复验和成功重试。
- `INDEPENDENT-REVIEW.json`：独立 agent 回读结论。
- `SHA256SUMS.txt`：除自身外的全包 SHA256。

## 边界

所有证据由 agent 自动执行。真实 Electron/Main/source Gateway 使用本地 scripted provider，不构成远程 provider 质量试验。2/20/100 后代是受控 UI 压力 fixture，不是生产规模统计。自治规划 V2、跨项目自治执行、发布或公开、产品默认值变更不在本证据范围。


Independent review: passed; 11/11 acceptance criteria; findings=[]. INDEPENDENT-REVIEW.json SHA256: f30f35c6a59b73d4fe998f4ccd4760542992fd3d66684c404afe0dada39f6f2a.

