# Coding Runtime P6 / P7 全量验收提示词（2026-08-19）

> 用途：在**全新会话**里对 Coding Runtime P6（并发锁硬化 + Git Checkpoint v2）与 P7（工作流级扩展）做独立全量验收。
> 本文件自包含：不依赖开发会话的任何上下文。
> P1–P5 的对应入口是 `reports/CODING-RUNTIME-FULL-ACCEPTANCE-PROMPT-2026-08-17.md`（已验收，verdict=ACCEPT_WITH_RESIDUAL）。
> 若要做 P1–P7 连续全量验收：先走那份，再走本份；两份的 residual 规则一致。

---

## 0. 起始信息（执行前先填空，不要留空）

| 项 | 填写 |
|---|---|
| 验收日期 | |
| 平台 / OS | |
| `git rev-parse --short HEAD` | |
| `git status --porcelain \| wc -l` | |
| Node / pnpm 版本 | |

**基线提醒**：本工作树长期存在其它 workstream 的大量未提交改动。P6/P7 的全部改动都是 `openclaw_runtime/src/**`、`shared/coding-runtime/**`、`docs/`、`reports/`、`harness/`，**没有一个文件在仓库根 `src/`（Electron renderer）下**。这一点在 §6 有可直接执行的核验方法，不要凭本文件的话相信它。

---

## 1. 只读必读（先读，再写任何结论）

按此顺序读，不要跳：

1. `docs/dev/coding-runtime-p6-p7-development-spec.md` — 设计权威。重点：§4.1/§4.2 协议不变量、§4.3 承接 A–D、§6.1/§6.2/§6.3 验收矩阵、§7 门禁与 residual 规则、§9 DoD、§10 硬性禁止。
2. `harness/specs/tasks/coding-runtime-p6-p7-extension.md` — 可执行契约（`requiredTests` / `acceptance` / `touchedAreas`）。
3. `shared/coding-runtime/README.md` — 17 条契约不变量 + 模块清单。
4. `shared/coding-runtime/MIGRATION.md`。
5. 四份阶段报告，**按时间顺序**：
   - `reports/CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md`
   - `reports/CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md`（+ `...P6B-EVIDENCE...`）
   - `reports/CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md`（P6 整体：A↔B 接缝 + 合并回归 + residual 台账）
   - `reports/CODING-RUNTIME-P7-ACCEPTANCE-2026-08-18.md`（+ `...P7-EVIDENCE...`）
6. `docs/dev/handoffs/LATEST.md` — §1b/§1c/§1d 记录了收尾期的三轮修复。

**读法要求**：这些报告是**被验收对象**，不是证据。凡报告里写「PASS」的，都要能被你自己独立重现或反驳。规范 §6 里的勾选框是开发方回填的，同样不作为证据。

---

## 2. 预检（先做，不猜）

```bash
# 2.1 全部 UFTK flag 必须默认 false，且类型层面不允许 true
grep -A 20 "DEFAULT_CODING_RUNTIME_FLAGS" shared/coding-runtime/types.ts
# 期望：12 项全 false，且类型为 Readonly<Record<CodingRuntimeFlagKey, false>>

# 2.2 P6/P7 能力不得有生产调用方（这是"实现完成但未接线"的核心声明）
grep -rn "exec-side-effect-undo\|checkpoint-worktree-bridge\|auto-checkpoint\|git-checkpoint-recovery-advice" \
  --include=*.ts openclaw_runtime/src | grep -v "\.test\.ts" | grep -v "coding-runtime/"
# 期望：无输出

# 2.3 禁用原语必须不存在于实现与测试中
grep -rn '"reset"\|"clean"\|--hard\|clean -f' \
  openclaw_runtime/src/agents/coding-runtime/*.ts
# 期望：只在注释/文档字样中出现（守卫测试会剥离注释后再扫描，见 git-checkpoint.scoped.test.ts）

# 2.4 产品锁未变
grep -rn "liveReady\|productApproved\|defaultOn" --include=*.ts openclaw_runtime/src | head
# 期望：无布尔赋值面；产品锁只以治理记录形式存在
```

---

## 3. 全量必跑命令（逐条记录 exit code 与数字）

**两处命令形式是实测得出的，不是风格偏好，照抄**：

- 全目录回归**必须**带 `--reporter=verbose`。`scripts/run-vitest.mjs` 会在「120s 无输出」时杀掉整个进程组；该套件已长到约 150s，默认 reporter 运行期几乎不输出 → 会被误杀（表现为 stall 而非失败）。
- `harness validate` 用 `--no-diff`。diff 模式按 `origin/main...HEAD` + 暂存/未暂存/未跟踪计算变更集，本工作树含约 250 个其它 workstream 文件；把它们写进本 spec 的 `touchedAreas` 等于伪造归属。结构性校验通过即为本项达标；diff 模式 exit 1 记为 residual R1。

### 3.1 契约与 harness

```bash
pnpm harness context --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md
pnpm harness validate --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md --no-diff
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
```

### 3.2 P6A 定向

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/file-lock-manager.test.ts \
  src/agents/coding-runtime/file-lock-manager.xproc-read.test.ts \
  src/agents/coding-runtime/lock-core.test.ts \
  src/agents/coding-runtime/lock-core.fairness.test.ts \
  src/agents/coding-runtime/lock-inspection.test.ts \
  src/agents/coding-runtime/file-transaction-service.concurrency.test.ts \
  src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts \
  src/agents/sessions/tools/file-mutation-queue.test.ts \
  --maxWorkers=1
```

### 3.3 P6B 定向

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/git-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint.restore.test.ts \
  src/agents/coding-runtime/git-checkpoint.scoped.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety.test.ts \
  src/agents/coding-runtime/git-checkpoint-lifecycle.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety-retention.test.ts \
  --maxWorkers=1
```

### 3.4 P6 A↔B 接缝 + A∪B 合并回归

```bash
# 接缝：真实两阶段 restore ↔ 真实文件级 UFTK 锁，双向对撞
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/git-checkpoint-transaction.p6-seam.test.ts \
  --maxWorkers=1 --reporter=verbose

# 合并：A 套 + B 套在同一进程内跑（跨套件状态泄漏只在这里暴露）
# 把 §3.2 与 §3.3 的文件列表合并为一条命令，加 --reporter=verbose
```

### 3.5 P7 定向

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/exec-side-effect-undo.test.ts \
  src/agents/coding-runtime/exec-side-effect-undo.ignored-probe.test.ts \
  src/agents/coding-runtime/checkpoint-worktree-bridge.test.ts \
  src/agents/coding-runtime/checkpoint-worktree-bridge.leak-probe.test.ts \
  src/agents/coding-runtime/auto-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint-recovery-advice.test.ts \
  --maxWorkers=1
```

### 3.6 承接 D 与两条 P1–P5 锁路径

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.shared-core.config.ts \
  src/shared/process-start-time.test.ts --maxWorkers=1

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts --maxWorkers=1
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-embedded-agent.config.ts --maxWorkers=1
```

### 3.7 全目录回归

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime --maxWorkers=1 --reporter=verbose
```

### 3.8 工程门禁

```bash
pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1
pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
pnpm run lint:dcs
pnpm exec eslint <P6/P7 变更文件列表>
git diff --check
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
```

---

## 4. 验收矩阵（自行取证，不接受"测试已存在且通过"）

对 §6.1（P6A 10 项）、§6.2（P6B 10 项）、§6.3（P7）逐项处理：

1. 先读实现，推导该不变量在**代码上**是否成立；
2. 对已有测试覆盖的项，核对断言是否真的锁住该不变量，还是只跑通路径；
3. 对未覆盖或覆盖可疑的项，**新写探针，先让它证伪或证实**；
4. 性能项采集真实数据，不接受「设计上成立」。

### 4.1 建议优先攻击的点（开发方自评证据最弱或最容易自欺的地方）

这一节是刻意提供的攻击面清单，请优先在这里花时间：

| 方向 | 为什么值得打 |
|---|---|
| **restore barrier 的排除面** | 两阶段 restore **刻意不取任何 per-path 锁**，全部依赖「workspace-scope 写锁已排除 root 下所有 UFTK 读写锁」。若该前提有洞，一次 UFTK 写就能落在 apply 中途。开发方补了 `p6-seam.test.ts` 5 例，但只覆盖 in-scope 文件、scope 外文件、reader、in-flight writer 四种形状——请尝试目录级 scope、符号链接、大小写差异路径、跨 workspace root 的路径 |
| **scoped restore 的删除语义** | scoped restore 会删除「in-scope 但不在 checkpoint tree 中」的路径。请构造：scope 覆盖范围与 checkpoint 记录 scope 不一致、嵌套 git 仓库、gitignored 文件、符号链接、只读文件、正被占用的文件 |
| **safety snapshot 的 at-risk 判定** | 判定按 blob hash 精确。请构造 hash 相同但 mode/权限不同、CRLF 差异、大文件、二进制、文件名含换行或 Unicode 的形状 |
| **retention 的「最新永远受保护」** | 排序键是 commit subject 里的毫秒 ISO 戳。请构造 subject 被篡改、戳缺失、同毫秒创建、时钟回拨的形状 |
| **exec undo 的诚实性** | 它必须永不声称撤销了实际未撤销的路径。请构造 sideEffects 含工作区外路径、非文件效应、gitignored、checkpoint 未覆盖、`beforeHash`/`afterHash` 为 null 的组合 |
| **`starttime` token 的跨平台一致性** | 该 token 在 Linux 是 clock ticks、win32 是截断 FILETIME、darwin 是 epoch ms。请确认它**从不**被跨平台比较、从不被相减、从不被当作时间戳持久化，且 `null` 一律读作「无法证明被复用」而非「未被复用」 |
| **`recovery_required` 之后的可恢复性** | 请真的按报告与 `git-checkpoint-recovery-advice.ts` 的步骤走一遍恢复，确认 `safetyRef` / `recoveryRef` 真能取回 restore 前字节 |

### 4.2 开发方在自评中主动更正过的地方（请复核这些更正本身）

| 更正 | 位置 |
|---|---|
| P6A 报告曾把 `lock-core.test.ts` 对 `inspectLocalLockState` 的覆盖当成 `inspectCodingLocks()` 的覆盖 | P6A 报告 §3 该行的 2026-08-19 更正 + 新增 `lock-inspection.test.ts` |
| P6 收卡时曾写「harness validate 通过」，实际只能支撑结构性校验通过 | 规范 §7、P6 报告 |
| 规范里曾填未实测的测试数字 | P7 报告 §4b |
| P6 曾在缺少「P6 整体验收报告」这一规范点名交付物的情况下收卡 | P6 报告 §5.4 |

---

## 5. 性能预算复核（规范 §8）

| 项目 | 预算 | 开发方实测 |
|---|---|---|
| 无争用单文件锁 p50 增量 | < 5ms | read +0.691ms / write −0.025ms（Windows, n=200） |
| 20 路径 / 1 路径 | 近线性 | 20.19× |
| 跨进程锁超时 | 有上界 | 313.1ms（预算 300ms） |
| scoped restore（10k 文件仓库，10 文件） | 明显低于整树，p50 < 1s | 353.9ms vs 整树 3869.5ms = 10.9× |
| safety snapshot | 只复制受影响文件 | at-risk 判定 59.4ms / snapshot 167.1ms |

请自行采样复核，尤其是**你所在平台**上的锁开销：win32 的 starttime 探测是 PowerShell 子进程（冷探测实测 900–1300ms），开发方为自身 pid 加了无 TTL memo，请确认该 memo 没有把「其它 pid 也不再重探」一起带进去。

---

## 6. 预存的外部噪声（**先核验归属，再决定是否接受**）

以下门禁项在验收时可能是红的，且开发方声称与 P6/P7 无关。**不要直接采信，用下面的方法自行判定**：

```bash
# tsgo:core:test —— 允许集合仅限"非 P6/P7 文件"
pnpm --dir openclaw_runtime tsgo:core:test 2>&1 | grep -E "error TS" | sed 's/(.*//' | sort -u
# 逐个文件核验归属：untracked 且非 coding-runtime/shared 范围 → 外部
git status --porcelain -- <每个报错文件>

# typecheck:web —— 核验范围而非核验人品
python -c "import json,io,re;s=re.sub(r'//.*','',io.open('tsconfig.web.json',encoding='utf-8').read());print(json.load
s(s)['include'])" 2>/dev/null || grep -A3 '"include"' tsconfig.web.json
# include 是 [src, shared]（仓库根 renderer）。若报错文件都在 src/components/** 或 src/pages/**，
# 而 P6/P7 的 TS 改动全在 openclaw_runtime/src/**，则该红灯与本次验收无关。

# config-schema-parity —— 只允许一个预存项
pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
# 唯一允许的失败项：runtime.memory.candidateGeneration
```

**判定标准只有一条，且不可放宽**：上述任何门禁的错误集合中**不得出现任何 P6/P7 文件**（`openclaw_runtime/src/agents/coding-runtime/**`、`openclaw_runtime/src/shared/process-start-time*`、`openclaw_runtime/src/infra/stale-lock-file*`、`openclaw_runtime/src/agents/session-write-lock.ts`、`shared/coding-runtime/**`、`tests/unit/coding-runtime-contract.test.ts`）。出现任何一个即为回归，阻塞验收。

**已知会反复出现又消失的外部项**（并发 workstream 在写）：`src/agents/goal-wake-runtime.test.ts`、`src/gateway/server-methods/session-activity-projection.test.ts`、`src/gateway/session-drain-service.test.ts`、`src/gateway/session-reset-service.stop.test.ts`、`src/gateway/session-reset-service.subagent-stop.test.ts`、`src/components/layout/Sidebar.tsx`、`src/pages/Chat/SessionActivityPanel.tsx`。这些**不是常设允许项**——每次验收都要重新核验归属，不得默认继承。

---

## 7. Residual 台账（当前状态，请复核而非采信）

| # | 项 | 开发方声称状态 |
|---|---|---|
| R1 | `harness validate` diff 模式 exit 1 | 开放；非 P6/P7 引入（脏工作树），拒绝把外部路径写进 `touchedAreas` |
| R2 | 跨平台 starttime 接入 `session-write-lock` / `infra/stale-lock-file` | **已闭环**（2026-08-19 实修，连带修 2 个缺陷） |
| R3 | win32 starttime 探测为 PowerShell 子进程 | 开放（性能取舍）；自身 pid 已降为每进程 ≤1 次 |
| R4 | `withWorkspaceQuiesce` 为可选 | 开放；由生产接线方决定 |
| R5 | 外部 workstream 的类型错误 | 开放；归属见 §6，P6 报告 §5.3 有逐项分析 |
| R6 | P6/P7 全部模块无生产调用方 | 开放；接线需独立授权（§2.2 可核验） |
| R7 | `resolveRecoveryDir` 重复且漂移的路径定义 | **已闭环**（2026-08-19 单源化 + 等价性回归） |

---

## 8. Task Forest 与收尾

```bash
python "%USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py" show TF-0075
python "%USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py" show TF-0076
python "%USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py" validate
```

`TF-0075`（P6）与 `TF-0076`（P7）当前均为 `done` / 100%。若本次验收推翻任一阶段结论，**必须**经 proposal 回退节点状态并记录偏离，不得只改报告。

---

## 9. verdict 格式

```
verdict = ACCEPT | ACCEPT_WITH_RESIDUAL | REJECT

理由：<针对 §6.1/§6.2/§6.3 的逐项判定，指名哪几项由你独立取证成立、哪几项被证伪>
新发现缺陷：<每条给出：位置 / 成因 / 影响 / 复现方式 / 是否已修 / 回归用例>
residual：<沿用或修改 §7 台账，每条给出处置建议与归属>
边界声明：<必须显式声明本次结论不构成 UFTK GA / canary / 整体成熟度>
```

---

## 10. 硬性禁止（违反即验收无效）

1. 不 `git reset --hard`、不 `git clean -f`、不 checkout、不 commit 无关 WIP。
2. 不 flip 任何 UFTK flag 或产品锁。
3. 不擅自修复无关 workstream 的文件（含 §6 列出的那些）。
4. 不新增第二套锁 / 队列 / journal / 审计真源。
5. 不改变 write / edit / apply_patch / exec 的模型对外 TypeBox schema。
6. 不把本地绿灯表述为 UFTK GA、canary 或整体成熟度结论。
7. 不把「测试已存在且通过」当作验收证据。
8. 不为了让门禁变绿而把外部 workstream 的路径写进 `touchedAreas` / `residualPaths`。
