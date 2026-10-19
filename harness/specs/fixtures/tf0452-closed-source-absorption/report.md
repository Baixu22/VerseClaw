# TF-0452 验收：闭源吸收的证据链与四层分层审计

- 日期：2026-10-19
- driven_by: agent
- actor: codex
- 基线：`origin/main = 765a47cb1a24e56e42e139cb0b1314b3b64ba9e1`
- 分支：`codex/closed-source-absorption-20261019`
- 父节点：TF-0445
- 机器可读记录：`acceptance.json`

本报告是 TF-0445 树的唯一收口依据。它不宣称 GA、release-ready 或真人证据。

## 一、已吸收（4 项）

| 节点 | 结论 | 盘上证据 | 复现命令与结果 |
| --- | --- | --- | --- |
| TF-0447 | KV-cache 命中率成为具名头条指标，并在 `attempt.ts` 真实路径接线 | `prompt-cache-observability.ts`、`run/attempt.ts`、`tests/unit/prompt-cache-hit-rate.test.ts` | `vitest run prompt-cache-hit-rate + prompt-cache-observability` → 20 passed / 2 files |
| TF-0448 | subagent 返回契约有界可测；两处魔法 240 截断改为走契约 | `orchestration-runtime-blackboard.ts`、`tests/unit/subagent-report-contract.test.ts` | 单测 10 passed；既有黑板/合成/结果包 25 passed / 5 files |
| TF-0449 | `TaskLedgerReference` 有显式继承/不继承表 | `shared/types/task-ledger-reference.ts`、`tests/unit/task-ledger-reference-inheritance.test.ts` | 10 passed / 2 files |
| TF-0450 | Chat 有会话级上下文压力指示器；四语 i18n；E2E 覆盖完整态与部分态 | `ChatContextPressure.tsx`、`ChatInput.tsx`、四语 `chat.json`、单测与 E2E | 单测 11 passed；i18n lint passed；E2E 2 passed / 16.5s；与既有 compaction 合跑 3 passed / 30.7s |

### 过程中修正的两个真实缺陷（不是走过场）

1. **TF-0450 的 `maxTokens` 推导错误**：初版把窗口上限挂在 `liveUsage` 是否存在上，导致只有 `contextRange` 知道用量时上限丢失。单测暴露后改为「上限是 range 的属性」。
2. **TF-0450 的 E2E 竞态**：点击 `/compact` 前只断言可见，会与 composer 状态刷新竞态，两个用例交替偶发失败。改为等选项稳定显示计算后的 token 文本再点击，与既有成熟写法一致；修复后 2/2 稳定通过（16.5s，此前带重试 41–60s）。

## 二、已由既有收口覆盖（不重复做，3 项）

| 参照 | 由谁覆盖 | 说明 |
| --- | --- | --- |
| Claude Code 具名逃逸口 | `PermissionDecisionEvent` + `docs/clawx-product-semantics.md` §Unsafe Claims + TF-0379/TF-0380 | 既有边界的显式程度不低于该参照 |
| Codex/Manus 语义收敛（CodingRun、ExecutionEnvironment、diff-first attempt） | TF-0370 子树（TF-0371/0375/0379/0383/0387/0390） | 本轮不重复实现 |
| Task Ledger 阻塞关系 | `shared/types/task-ledger.ts` 的 `TaskLedgerEdgeType` 含 `blocks` | 计划原以为缺失，核对后确认已存在；裁定为已覆盖而非重造 |

## 三、刻意不做（8 项，具名清单）

见 `harness/specs/decisions/tf0451-closed-source-non-goals.md`。摘要：

1. Cursor Cloud Agents：远端 VM 执行与托管环境生命周期
2. Manus：云 VM 沙盒作为每次运行执行环境
3. 实时多人 Collab
4. Website Builder
5. Codex Cloud：托管 attempt
6. NotebookLM：claim 级溯源改造 Knowledge 审阅语义
7. Glean / Readwise：捕获摩擦与知识管线产品决策
8. Claude Code：权限模型整体替换

锚定边界：本地 Electron + 本地 gateway；Windows x64 受控预览。引入远端 VM 属产品范围变更，不在设计吸收范围。

保留的最小吸收形式：Cursor 的隔离立场 → `ExecutionEnvironment` 分层；Codex Cloud 的只读聚合 → `CodingRun` + diff-first attempt。

## 四、未验证边界（8 项，如实记录为 limitation）

1. 未运行完整仓库 `pnpm run typecheck`；只跑 web / test / openclaw_runtime core 三个 tsgo project
2. `openclaw_runtime` core 仍有 **4 个既有错误**：`cross-area-facades.ts` 的 `lastPlan` 未使用；`ui/vitest.config.ts` 3 处类型栈深度。与 `origin/main` 基线一致，**不在本次文件**
3. 未运行 `pnpm test` 全量单测；只运行与本树相关的 11 个文件
4. 未运行 `pnpm run test:e2e` 全量 E2E；只运行 2 个相关 spec
5. 未运行 openclaw_runtime 全量 build；仅构建 renderer/electron bundle 以支撑 E2E
6. 未在 macOS / Linux 验证
7. 未验证 KV-cache 命中率在真实 provider 账单上的准确性；本次只验证记账逻辑与接线
8. 未验证 subagent 报告契约在真实多角色长跑下的截断分布

## 五、汇总验证

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 单测 | `vitest run <11 files>` | 11 files / 76 tests / 76 passed / 0 failed / exit 0 |
| i18n | `node scripts/i18n-lint.mjs` | passed / exit 0 |
| web tsgo | `tsgo --noEmit -p tsconfig.web.json` | 0 errors / exit 0 |
| test tsgo | `tsgo --noEmit -p tsconfig.test.json` | 0 errors / exit 0 |
| core tsgo | `tsgo --noEmit -p tsconfig.core.json` | 4 errors（= 基线 4）/ exit 2 |
| E2E | `playwright test <2 specs> --workers=1` | 3 passed / 0 failed / exit 0 |
| build | `vite build` | exit 0 |

core 基线测量方法：在 TF-0447 提交前，用 `git stash` 暂存当次未提交的两个文件后重跑 `tsgo -p tsconfig.core.json`，得到同样 4 个错误，且都不在本次文件。

## 六、声明边界

- 不构成 GA 或 release-ready
- 不声称真人证据；全部产物 `driven_by: agent`
- 不修改产品锁或冻结默认值
- 不触碰 TF-0394 资源 Fabric 与 TF-0424 上下文生命周期两棵树
- Task Forest 状态与 session 历史按 `repository-artifact-retention` 留在本地，不入 Git

## 七、提交

| SHA | 节点 | 主题 |
| --- | --- | --- |
| `bef614bc9` | TF-0446 | docs(decision): 闭源参照三态归属裁定 |
| `de138d53a` | TF-0447 | feat(context): KV-cache 命中率具名指标 |
| `88694125a` | TF-0448 | feat(subagent): 有界 subagent 报告契约 |
| `4228c083d` | TF-0449 | feat(task-ledger): 显式 TaskLedgerReference 继承表 |
| `c83623843` | TF-0451 | docs(non-goals): 刻意不吸收项清单 |
| `af52cef8e` | TF-0450 | feat(chat): 会话级上下文压力指示器 |
| `3d97f3906` | TF-0450 | test(e2e): 稳定会话上下文压力用例 |
