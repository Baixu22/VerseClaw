# 仓库卫生收口证据（TF-0355）

- 日期：2026-10-17
- driven_by：agent
- actor：codex
- 范围：TF-0355 / TF-0356 / TF-0357 / TF-0358 / TF-0359 / TF-0360
- 边界：未发布、未改变仓库公开性、未修改产品锁或默认值、未清理其他 worktree 或用户数据。

## 关键处置

| 项目 | 处置 | 证据 |
|---|---|---|
| `packages/versebrowser` 267 个未跟踪源码/测试/补丁/清单 | 加入版本控制；`dist/` 与 `node_modules/` 继续 ignore | `git ls-files -- packages/versebrowser` = 267 |
| qqbot 四个未暂存删除 | 从 `HEAD` 精确恢复；未提交无关删除 | `git status --porcelain -- openclaw_runtime/extensions/qqbot` 为空 |
| 新文档 `docs/dev/versegit-validation-layer/README.md` | 登记为 reviewed input，消除 tracked-but-ignored | `scripts/repository-artifacts.json` |
| `artifacts/versebrowser-acceptance/2026-10-16T000000Z` | 4 个精选摘要 + `SHA256SUMS` 入库；162 个原始 gate 文件保持本地 | `verdict.json`、`evidence-index.json`、`gaps.md`、`SHA256SUMS` |
| `%SystemDrive%`、`-c`、`.exe`、`net use` 事故目录 | 复核均在仓库根且为空/缓存后删除 | 报告生成前 `Resolve-Path` 边界检查；Node 删除时再次校验 realpath |
| 5 个 0 字节 `_tmp_*` | 删除 | 根目录扫描剩余 0 |
| `WORKTREE.md` | 保留为本地连续性文件，登记 local-only；内容属于旧 Knowledge System worktree，不是产品输入 | `scripts/repository-artifacts.json`、`.gitignore` |

## 门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| 隔离检出 `pnpm install --frozen-lockfile` | exit 0；postinstall 执行 `versebrowser:build` | `artifacts/repo-hygiene-20261017/isolated-install.log` |
| `pnpm run versebrowser:build` | exit 0 | `artifacts/repo-hygiene-20261017/isolated-build.log` |
| 外部 VerseBrowser 单测 | 3 files / 12 tests passed | `artifacts/repo-hygiene-20261017/isolated-vitest.log` |
| `repo:duplicates:check` | exit 0；12 reviewed groups；LF 与 CRLF 检出均一致 | `artifacts/repo-hygiene-20261017/duplicates-*-checkout.log` |
| `repo:artifacts:check` | exit 0；17966 tracked paths | `artifacts/repo-hygiene-20261017/repo-artifacts-check.log` |
| Harness ownership | `versebrowser-upstream-reintegration` spec valid | `artifacts/repo-hygiene-20261017/harness-validate.log` |
| TF-0009 agent surrogate | exit 0；DCS/SEKB/browser 各 10 次；kill/rollback pass | `artifacts/repo-hygiene-20261017/tf0009-agent-surrogate.log` |
| `pnpm run typecheck` | exit 0；node/web/test 三路通过 | `artifacts/repo-hygiene-20261017/typecheck.log` |

`git diff --cached --check` 在 Windows CRLF 语境下仍会报告两类已审阅例外：二进制/补丁上下文中的尾随空格，以及 Markdown 行尾双空格换行。`git diff --check` 为 exit 0；未发现新增的普通源码尾随空格。

## 本地产物分类

`artifacts/` 下不参与源码索引的顶层目录先按发布/审计、Agent Dev 运行输出和其余运行产物分类；全部由 `docs/dev/repository-artifact-retention.md` 的“默认本地、显式保留”规则约束。

### Agent Dev / recording 运行输出（14）

处置：本地运行产物；除已登记的精简证据外不进入源码索引。

- `artifacts/agent-dev-audit`
- `artifacts/agent-dev-benefit-eval`
- `artifacts/agent-dev-recording-test-1783053411792`
- `artifacts/agent-dev-recording-test-1783054282007`
- `artifacts/agent-dev-recording-test-1783074162762`
- `artifacts/agent-dev-recording-test-1783269524888`
- `artifacts/agent-dev-recording-test-1783848292950`
- `artifacts/agent-dev-recording-test-1783848943409`
- `artifacts/agent-dev-recording-test-1783849635819`
- `artifacts/agent-dev-recording-test-1783850042758`
- `artifacts/agent-dev-recording-test-1788500724245`
- `artifacts/agent-dev-recording-test-1788520328046`
- `artifacts/agent-dev-recording-test-1788520843147`
- `artifacts/agent-dev-scenarios`

### 审计、验收与运行产物（48）

处置：本地过程证据；`artifacts/chain-audit` 与 `artifacts/real-runtime-validation` 已在 `scripts/repository-artifacts.json` 登记为 local-only，其余由 `/artifacts/**` 默认本地化。

- `artifacts/chain-audit`
- `artifacts/chat-layout-review`
- `artifacts/dot-matrix`
- `artifacts/e2e`
- `artifacts/e2e-experiment`
- `artifacts/e2e-monitor`
- `artifacts/fable5-closure-audit`
- `artifacts/layout-fix`
- `artifacts/local-quarantine-20260911`
- `artifacts/policy-doc-truthfulness`
- `artifacts/prompt-cache-live-e2e`
- `artifacts/provider-error-retry-boundaries`
- `artifacts/qa-code-audit-20260922-4QlwKJ`
- `artifacts/real-runtime-validation`
- `artifacts/remaining-node-audit-20261001`
- `artifacts/runtime-effectiveness`
- `artifacts/runtime-efficiency`
- `artifacts/runtime-lifecycle-governance`
- `artifacts/runtime-long-stability`
- `artifacts/runtime-memory-eval`
- `artifacts/runtime-utf8-recovery`
- `artifacts/security-reality-audit-20261009`
- `artifacts/session-ecosystem-cross-session-control`
- `artifacts/session-ecosystem-lifecycle-ledger-acceptance`
- `artifacts/session-ecosystem-production-reachability`
- `artifacts/session-ecosystem-resource-reclamation`
- `artifacts/session-ecosystem-safety-gate-consistency`
- `artifacts/showcase-20260922`
- `artifacts/system-health-audit`
- `artifacts/tb21-acceptance`
- `artifacts/tf0013-codex-contract-20261001`
- `artifacts/tf0013-compass-budget-20260930`
- `artifacts/tf0013-message-budget-20260930`
- `artifacts/tf0013-native-budget-20260930`
- `artifacts/tf0013-native-wire-20260930`
- `artifacts/tf0029-rc01r-formal`
- `artifacts/tf0078-chain-health-audit`
- `artifacts/tf0078-generation-injection-remediation`
- `artifacts/tf0086-milestone-closeout`
- `artifacts/tf0088-ownership-declarations`
- `artifacts/tf0089-census-guard-remediation`
- `artifacts/tf0090-dispatch-proofs`
- `artifacts/tf0091-dead-surface-decisions`
- `artifacts/tf0092-engineering-hygiene`
- `artifacts/tf0093-commit-readiness`
- `artifacts/unified-agent-system`
- `artifacts/validation-baseline`
- `artifacts/versebrowser-acceptance`

### 其他本地产物（18）

处置：不作为产品输入或克隆必需文件；保留本地供后续审计，不删除。

- `artifacts/ast-readonly-deep-eval`
- `artifacts/ast-readonly-investment-eval`
- `artifacts/browser-preview-visual`
- `artifacts/channel-conformance`
- `artifacts/chat-ui-screenshots`
- `artifacts/coding-round-accept`
- `artifacts/comms`
- `artifacts/context-compression-p5`
- `artifacts/context-moat`
- `artifacts/fable5-independent-deep-test`
- `artifacts/git-capability-ui`
- `artifacts/H-01`
- `artifacts/harness`
- `artifacts/issue-13`
- `artifacts/task-forest-landing-20260930`
- `artifacts/typecheck-cache`
- `artifacts/uas-08-soak`
- `artifacts/verseconf-tf-planning-20260930`

## 不纳入收口的本地缓存

`build/`、`release/`、`.local/`、`.codegraph/`、`.tmp/` 等是构建、运行或个人工具缓存，继续由现有 ignore 规则排除；本次只做归属说明，不删除。

## 当前证据入口

- 本报告：`docs/dev/repo-hygiene-20261017.md`
- 屏蔽/保留清单：`scripts/repository-artifacts.json`
- 本轮命令日志：`artifacts/repo-hygiene-20261017/`（本地）
- 上一轮 VerseBrowser 原始审计：`D:\tmp\clawx-versebrowser-hygiene-20261016`（本地）
