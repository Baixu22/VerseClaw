# DCS 生态 · 下周深度测试启动包（TF-0009）

> **状态**：就绪待开跑（P0 closed / P1 canary not executed）  
> **窗口**：下一工作周（建议 5 个工作日）  
> **唯一点位**：TF-0009（P1 组件小范围受控内测运行包）  
> **全局任务**：TF-0007（in_progress，非 GA）  
> **硬阻塞**：TF-0006 继续 blocked —— 深度测试 **不** 解锁 default-on / liveReady / productApproved / jointSystemGa  
> **生成日期**：2026-07-21

---

## 0. 一句话目标

在 **不改默认值、不扩权限、不宣称 GA** 的前提下，用 **真实任务 + 可回滚** 的方式，跑通三类 opt-in profile 的深度测试，并留下可审计证据包。

**成功标准（周结束时）**

1. 三个 profile（DCS coding / SEKB assisted / Browser supervised）各至少 **1 次最小真实任务**有完整 lineage。
2. 至少 **1 次 kill/rollback 演练** 成功（100%）。
3. 未授权写入 = 0；SEKB 未确认写入 = 0；Browser 私网绕过 = 0。
4. 所有 canary 仍保持 `defaultsUnchanged=true`、`liveReady=false`、`productApproved=false`。
5. 机器可读证据写入 `artifacts/dcs-deep-test-week1/`，人工结论写入本目录 `decision.md`。

**明确不成功也没关系的**

- 未达到 C1 5x 门禁 → **继续 keep-off**（正常）
- 未跑满 soak / 未获产品签字 → **不解除 TF-0006**（正确）

---

## 1. 硬边界（开测前全员确认）

| 规则 | 要求 |
|------|------|
| 默认值 | 全部 off / fail-closed；禁止为“证明可用”改默认 |
| SEKB | 必须 human confirm；禁止 auto writeback |
| Browser | 私网默认 deny；mode upgrade 必须审批 |
| Runtime Memory | diagnostics-only；禁止默认注入 |
| Assembler / C6 | 禁止 auto flip |
| C7 cutover | `cutoverAllowed` 保持 false |
| 叙事 | 禁止 default-on / liveReady / productApproved / 联合系统 GA |
| 变更 | 无用户新授权不 commit/push/PR/发布 |

### 硬性 NO-GO（任一发生 → 立即停测）

- 未授权 host/workspace/write
- SEKB 未确认写入
- Browser 私网默认开放或审批可绕过
- Runtime Memory 危险字符串 / 原始记录泄漏
- 关键 E2E、maturity evidence 或 staged source 不可复现
- 通过修改默认值来“证明可用”
- 把 controlled canary 宣称为 GA

---

## 2. 测试分层（“深度”指什么）

不要把所有东西塞进同一天。分层如下：

| 层 | 名称 | 目的 | 是否改默认 | 主要命令 / 动作 |
|----|------|------|------------|-----------------|
| L0 | 预飞门禁 | 确认基线仍绿 | 否 | `dcs:prod-p0:smoke`、`test:dcs`、`p0:accept` 子集、关键 E2E |
| L1 | 合成/记录 canary | 脚本化 A/B 与 corpus | 否 | `dcs:canary:c1`、`dcs:corpus:validate` |
| L2 | 宿主真实路径 | Electron 关键 6 路径 | 否 | W5 / SEKB / Browser E2E |
| L3 | **真实任务 canary** | 最小真实任务 + 指标 | **仅 opt-in 环境变量/配置** | 三 profile 手工/半自动任务 |
| L4 | Kill/rollback 演练 | 故障关闭顺序 | 临时开再关 | 按 runbook 关闭顺序 |
| L5 | （本周不做） | soak / product approval | — | 留给 TF-0006 |

**本周深度测试 = L0 → L4。L5 明确排除。**

---

## 3. 三日～五日日程（建议）

### Day 0（开测前 0.5 天，可放在周一上午）

- [ ] 指定 **Owner**（一人决策 continue/shrink/stop）
- [ ] 指定 **Operator**（执行任务与记录）
- [ ] 指定 **Safety**（盯 NO-GO / 隐私）
- [ ] 确认 cohort：建议 **1 台机器 / 1～2 人 / ≤10 次任务**
- [ ] 复制并填写 `artifacts/dcs-deep-test-week1/profiles.json` 中的 owner 字段
- [ ] 跑 L0 预飞（见 §5）

### Day 1 — L0 + L1 + L2（基线与自动化深度）

- [ ] L0 全绿归档到 `artifacts/dcs-deep-test-week1/day1-gates.json`
- [ ] `pnpm run dcs:canary:c1`（合成 corpus；期望 recommendation ≠ default-on）
- [ ] `pnpm run dcs:corpus:validate`（若有 fixture）
- [ ] 关键 Electron：
  - `tests/e2e/dcs-production-wiring-w5.spec.ts`
  - `tests/e2e/dcs-prod-p0-settings.spec.ts`
  - `tests/e2e/sekb-golden-path.spec.ts`
  - `tests/e2e/browser-security-recovery.spec.ts`
  - `tests/e2e/agent-browser-workbench.spec.ts`（可选）
- [ ] 输出：自动化深度通过/失败表

### Day 2 — L3 Profile A：DCS coding（opt-in）

- [ ] 按 runbook **显式启用** 本 profile 所需项（仅环境/配置，不改默认常量）
- [ ] 跑 **1～3 个** 最小真实编码任务（见 §4.A）
- [ ] 记录：启用 flags、耗时、token、命中/拒绝、错误、是否回滚
- [ ] 任务结束 **立即按 kill 顺序关闭增强**
- [ ] 产出：`artifacts/dcs-deep-test-week1/runs/dcs-coding-*.json`

### Day 3 — L3 Profile B：SEKB assisted + L4 kill drill

- [ ] SEKB **human-confirm only** 黄金路径真实任务 1～2 次
- [ ] 故意触发一次“应拒绝的未确认写入”观察 fail-closed（安全演练）
- [ ] **Kill/rollback 全序演练**（§6）并计时
- [ ] 产出：`runs/sekb-*.json` + `rollback-drill.json`

### Day 4 — L3 Profile C：Browser supervised + 收口

- [ ] Browser supervised 最小真实任务（公开页 / 无私网）
- [ ] 验证 mode upgrade 审批门 + vault health
- [ ] 汇总 `summary.json` + `decision.md`（continue / shrink / stop）
- [ ] 更新 task-forest proposal（仅状态/证据指针，不碰 TF-0006）
- [ ] 刷新 `docs/dev/handoffs/LATEST.md`

### Day 5（缓冲 / 可选）

- 失败重跑、补证据、修 **不改默认** 的小 bug
- **禁止** 用这一天做 default-on 游说或扩 cohort

---

## 4. 三个 Canary Profile（运行表）

### A. DCS coding（opt-in）

| 字段 | 值 |
|------|-----|
| id | `dcs-coding` |
| 目的 | 验证 context view tools / coding 增强在 opt-in 下的真实任务收益与故障面 |
| owner | _TBD_ |
| cohort | 1 operator，本机 workspace |
| budget | ≤3 任务 / 日；单任务 ≤30 min；token 预算由 owner 定 |
| enable | 见 `docs/dcs-production-p0-runbook.md`：仅 `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1` 等显式开关；**不要** 开 patchFlow.default / isolation worktree 默认 |
| 建议任务 | (1) 在已知小仓库做只读上下文检索；(2) 一次受控小改动 + writeJournal 可 undo；(3) 可选 staleWriteGuard=true 的冲突写入观察 |
| metrics | latency p50/p95、token in/out、tool 命中、false-block、错误数、人工满意度 1–5 |
| privacy | 不使用生产密钥库外泄任务；日志脱敏 |
| kill | runbook 关闭顺序 1→6（增强先关） |
| rollback | unset env + 配置回退 + 重启 gateway/runtime |
| stop 条件 | 未授权写、默认值被改、错误率不可接受、owner 判定 stop |

### B. SEKB assisted（human-confirm）

| 字段 | 值 |
|------|-----|
| id | `sekb-assisted` |
| 目的 | 验证经验检索/辅助在 **人工确认** 下可用，且无自动写回 |
| owner | _TBD_ |
| cohort | 1 operator |
| budget | ≤2 任务；禁止批量写回 |
| enable | SEKB 路径按 `docs/dev/sekb-golden-path.md`；shadow 仅采样，**cutover 禁止** |
| 建议任务 | (1) 检索既有经验并人工采纳；(2) 一次候选写回 → 必须确认后才落盘；(3) 取消确认应零写入 |
| metrics | 确认率、取消率、未确认写入次数（必须 0）、检索命中、时延 |
| privacy | 经验内容不含密钥；删除边界明确 |
| kill | `experienceShadow=false`；停止写回入口 |
| rollback | 关闭 SEKB 增强；保留审计日志 |
| stop 条件 | 任何未确认写入、auto writeback 迹象 |

### C. Browser supervised（approval-gated）

| 字段 | 值 |
|------|-----|
| id | `browser-supervised` |
| 目的 | 验证监督浏览在私网 deny + 审批升级下可运营 |
| owner | _TBD_ |
| cohort | 1 operator |
| budget | ≤2 任务；仅公开站点 |
| enable | Browser 工作台；mode upgrade 走 UI 审批；**不** 开私网 |
| 建议任务 | (1) 公开文档页只读抓取；(2) 尝试升级模式 → 必须出现审批；(3) vault 未配置/损坏态可解释 |
| metrics | 审批通过/拒绝、私网拦截次数、任务 interrupted 可恢复、错误 |
| privacy | 无内网目标；凭证进 vault 不进明文日志 |
| kill | 终止 browser task；降级 mode；关闭私网相关任何实验开关 |
| rollback | 任务 interrupted 恢复路径；vault health 检查 |
| stop 条件 | 私网可达、审批绕过、凭证泄漏 |

---

## 5. L0 预飞命令清单（周一必须）

在仓库根目录：

```bash
# 1) DCS packaging 红线
pnpm run dcs:prod-p0:smoke
pnpm run dcs:prod-p0

# 2) DCS 单测 / lint（长跑，可并行窗口）
pnpm run lint:dcs
pnpm run test:dcs

# 3) P0 子集
pnpm run p0:accept

# 4) 合成 canary（不得产出 default-on）
pnpm run dcs:canary:c1

# 5) 关键 E2E（需 Windows Electron；先 build）
pnpm run build:vite
pnpm exec playwright test tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts

# 6) 可选：maturity 与 agent-dev 旁路（非 DCS 核心，但建议日更）
pnpm run maturity:validate
pnpm run agent-dev:deep-test:reuse
```

将 stdout/exit 摘要写入：

`artifacts/dcs-deep-test-week1/day1-gates.json`

模板字段：`{ "generatedAt", "sha", "steps":[{name,ok,exitCode,ms,notes}], "defaultsUnchanged": true }`

---

## 6. Kill / Rollback 演练（Day 3 必做）

严格按 `docs/dcs-production-p0-runbook.md`：

1. Unset `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS`
2. `staleWriteGuard.enabled=false`
3. `symbolLease.enabled=false`
4. 停止 patch-flow / ladder 调用方；确保 `patchFlow.default=false`
5. `worktree.backend=inprocess`；isolation `shared`
6. `routingMemo.shadow=false` 且 `sekb.experienceShadow=false`
7. 仅当 journal I/O 是事故时才关 `writeJournal`（会丢 undo）
8. 重启 gateway/runtime

**演练记录字段**（`rollback-drill.json`）：

- `startedAt` / `endedAt` / `durationSec`
- `steps[]`：每步是否成功
- `postCheck`：defaults 恢复、增强路径不可达
- `operator` / `witness`
- `result`: `pass` | `fail`

成功标准：增强关闭后基线聊天仍可用；无残留 default flip。

---

## 7. 单次真实任务记录模板

每条 run 一个 JSON：`artifacts/dcs-deep-test-week1/runs/<profile>-<yyyymmdd-HHMM>.json`

```json
{
  "schema": "dcs-deep-test-run/v1",
  "profile": "dcs-coding",
  "operator": "",
  "owner": "",
  "startedAt": "",
  "endedAt": "",
  "taskSummary": "",
  "enableFlags": [],
  "defaultsUnchanged": true,
  "metrics": {
    "latencyMs": null,
    "tokensIn": null,
    "tokensOut": null,
    "hits": null,
    "rejects": null,
    "errors": null,
    "humanScore1to5": null
  },
  "incidents": [],
  "killExecuted": false,
  "rollbackExecuted": false,
  "ownerDecision": "continue|shrink|stop",
  "notes": "",
  "evidencePaths": []
}
```

---

## 8. 周末决策框（必须写）

文件：`artifacts/dcs-deep-test-week1/decision.md`

| 问题 | 选项 |
|------|------|
| 是否继续内部 canary？ | continue / shrink / stop |
| cohort 是否扩大？ | 否（默认）/ 是（需新授权与预算） |
| 是否触及 TF-0006？ | **否**（除非四件证据齐全） |
| 是否需要修 bug 再开下一轮？ | 列表 |

允许的最大正向结论：

> “受控内测可继续，小范围 opt-in 有效；**仍非 GA**。”

禁止的结论句式：

> “已生产就绪 / 可默认开启 / liveReady / productApproved / 联合系统 GA。”

---

## 9. 与既有文档的关系

| 文档 | 角色 |
|------|------|
| `docs/dev/handoffs/NEXT-GOAL.md` | 会话入口：只推 TF-0009 |
| `docs/dev/component-operational-readiness-checklist.md` §F | P1 启动前检查表 |
| `docs/dcs-production-p0-runbook.md` | enable/kill 权威 |
| `docs/dev/component-controlled-rollout-plan.md` | 总计划 |
| `artifacts/tf0006-evidence-upgrade/status.json` | GA 否决开关 |
| 本文件 | **下周深度测试执行手册** |

---

## 10. Owner 签字（开测日填写）

| 角色 | 姓名 | 日期 | 确认硬边界 |
|------|------|------|------------|
| Owner | | | [ ] |
| Operator | | | [ ] |
| Safety | | | [ ] |

---

## 11. 快速口令（贴在终端）

```text
本周 = TF-0009 深度测试（L0–L4）
不做 = default-on / TF-0006 解阻 / 扩 cohort / 无授权 commit
停测 = 任一 NO-GO
收口 = summary.json + decision.md + task-forest 证据指针
```
