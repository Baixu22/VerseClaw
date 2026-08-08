# 可持续开发手册（COMPASS + Harness）

> **候选 Runtime 收敛主线（2026-08-02）**：涉及 Run/Workflow/Context/Memory/Tool/Effect/Telemetry 的后续开发，先读 `docs/dev/unified-agent-system/runtime-convergence/README.md`。Task Forest proposal 应用前，本控制包和旧 runtime-family 路线都不授权新实现；应用后挂在 `TF-0010` 下，一次只推进一个 ready 节点。`TF-0021` UI 迁移是独立主线，不得并行混入 Runtime 收敛。

> 状态：Active
> 生效日期：2026-07-19
> 适用范围：ClawX / Verse Claw 成熟度推进、DCS/MEM/Context/SEKB/Browser 相关开发
> 权威任务图：.agent-workbench/task-forest/ (HTML: .agent-workbench/task-forest/exports/task-forest.html)
> 配套 skills: task-forest / session-handoff-prompt / task-clarifier / user-profile-keeper

---

## 1. 为什么需要这份文档

过去多轮补缺口仍被审计否决，根因不是组件空壳，而是：

1. **横向加宽组件**，审计却量 **纵向系统联通 + 生产证据层级**
2. 进度只活在对话里，**换会话就丢上下文**
3. 没有单一当前该做什么的权威任务图，容易平行开面

本手册规定：**以后所有相关开发任务都必须以本文 + task-forest 为入口**，不允许再开无父节点的平行大工程。

---

## 2. 当前战略定位（冻结）

**可以：**

- Coding 基础工具：受控生产
- BlockStore / working-memory：指定 workspace canary
- VToken：灰度 / opt-in + kill switch
- SEKB：shadow capture + 人工确认
- Browser：内部可信用户、域名 allowlist、私网默认关闭
- Runtime Memory：受控 corpus / diagnostics-only

**不可以（当前 NO-GO）：**

- DCS/MEM 全量 default-on
- SEKB 自动经验写回
- Runtime Memory prompt injection 全量启用
- Browser 无人监督 / 私网默认开放
- 多 agent 高并发 workspace 自动修改
- 把 Agent Dev / maturity 绿灯外推为联合系统 GA

官方 residual: accept-with-residuals; readyForDefaultFlagGraduation=false; liveReady=false.
再写 honesty residual pack 不会把 NO-GO 变成 GA。

---

## 3. 历史 P0 主线（2026-07-19 快照）

本节只解释既有 `TF-0001..TF-0006` 的来源，不再授权 Runtime 收敛实施。Runtime 工作以 `runtime-convergence/STATUS.md` 和已应用的 Task Forest proposal 为准；提案未应用时不得启动任何 RC。

| ID | 节点 | 优先级 | 目标 |
|---|---|---:|---|
| TF-0001 | 全局目标：受控可运营（非全量 GA） | P1 | 可运营闭环 |
| TF-0002 | P0-1 统一 Context Orchestrator | P1 | 拆除最大组件孤岛 |
| TF-0003 | P0-2 默认策略对齐与熔断 | P1 | 默认策略不再自相矛盾 |
| TF-0004 | P0-3 SEKB 半自动黄金闭环 E2E | P2 | 一条可验收闭环 |
| TF-0005 | P0-4 Browser 安全与任务恢复 | P2 | 内部灰度门槛 |
| TF-0006 | M2/M3 证据升级 | P3 blocked | 真实 corpus / live A/B |

### 推荐执行顺序

```text
Sprint 1: TF-0003 + TF-0002
Sprint 2: TF-0004 + TF-0005
Sprint 3+: TF-0006
```

任何新想法必须先回答：1) 服务哪个 TF？ 2) 不挂父节点就不做； 3) 是否误当系统 GA？

---

## 4. 会话工作流

### 4.1 新会话开始（必做）

```text
1. docs/dev/Sustained-Development-Playbook.md
2. task-forest todo / HTML
3. docs/dev/handoffs/LATEST.md
4. read the active program STATUS; advance only its one ready node
```

### 4.2 高歧义时：task-clarifier
### 4.3 执行中：harness context / E2E / i18n / AGENTS.md
### 4.4 会话结束（必做）

1. task-forest proposal -> confirm -> apply -> validate -> export
2. session-handoff-prompt -> docs/dev/handoffs/LATEST.md
3. optional run-history-skill-builder
4. code + harness + docs same PR

---

## 5. 权威文件地图

| 类型 | 路径 |
|---|---|
| playbook | docs/dev/Sustained-Development-Playbook.md |
| handoff | docs/dev/handoffs/LATEST.md |
| task forest | .agent-workbench/task-forest/ |
| HTML | .agent-workbench/task-forest/exports/task-forest.html |
| harness | harness/specs/** |
| agent entry | AGENTS.md |
| audit evidence | artifacts/**/report.json |

禁止平行第二任务真源。可复用约束 promote 到 harness/specs/**。

---

## 6. COMPASS Skills

Source: https://github.com/dongshuyan/compass-skills
Install: %USERPROFILE%\.codex\skills\

| Skill | Use |
|---|---|
| task-forest | task DAG / progress / HTML |
| session-handoff-prompt | session handoff |
| task-clarifier | requirement alignment |
| user-profile-keeper | local profile (no secrets) |
| run-history-skill-builder | pack workflows into skills |
| run-history-skill-upgrader | upgrade skills with approval |
| academic-humanizer | academic tone (not mainline) |

```powershell
$tf = "$env:USERPROFILE\.codex\skills\task-forest\scripts\task_forest.py"
$ws = "C:\Users\27933\Desktop\clawx\ClawX-maturity-p0"
$env:PYTHONUTF8 = "1"
python $tf todo --workspace $ws
python $tf list --workspace $ws
python $tf export --workspace $ws
python $tf validate --workspace $ws
```

Windows: prefer --fields-file UTF-8 JSON for Chinese fields.

---

## 7. 历史 P0 anchors（参考证据）

### TF-0002 Context Orchestrator
- openclaw_runtime/src/context-engine/context-orchestrator.ts
- docs/dev/context-orchestrator.md
- openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts
- openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
- openclaw_runtime/src/gateway/server-methods/agent.ts
- Accept: single entry + flag matrix + lineage diagnostics

### TF-0003 defaults
- electron/utils/openclaw-auth.ts (dangerouslyAllowPrivateNetwork)
- harness/specs/rules/vtoken-foundation-boundary.md
- docs/dev/default-config-matrix.md
- Accept: default matrix tests + kill switch

### TF-0004 SEKB
- one golden path E2E; no auto writeback worker
- evidence: write -> recall -> behavior delta

### TF-0005 Browser
- private network default false; approval gate; task persistence; vault corruption distinguishable
- one real workflow E2E

---

## 8. Definition of Done

1. code/tests pass node acceptance
2. task-forest node updated
3. handoff LATEST.md usable by next session
4. docs/rules updated if behavior changed
5. no unauthorized scope expansion to TF-0006 / full GA

---

## 9. Hard bans

1. broad gap-filling mega-tasks without TF parent
2. default-on while liveReady=false
3. synthetic canary claimed as productApproved
4. end session without task-forest/handoff update
5. treat Agent Dev existence proof as production effect proof

---

## 10. Next-session bootstrap prompt

```text
Follow docs/dev/Sustained-Development-Playbook.md strictly.
1. Read docs/dev/handoffs/LATEST.md if present
2. For Runtime work, read runtime-convergence/STATUS.md and README.md
3. Run task-forest todo; advance only the active program's one ready node
4. No parallel mega-surfaces; no full-system GA discussion
5. Before end: update task-forest after confirmation; write handoff LATEST.md;
   summarize done / evidence / next first step
```

---

## 11. Changelog

| Date | Change |
|---|---|
| 2026-07-19 | Initial: audit NO-GO + COMPASS install + task-forest seed TF-0001..0006 |
| 2026-08-02 | Mark the July P0 sequence historical; route candidate Runtime work through the non-authorizing convergence control pack until its proposal is applied. |

---

## 7. TF-0001 P0 close-out (2026-07-19)

P0 controlled-operable baseline is **accept-with-residuals**:

- TF-0002..TF-0005: done (orchestrator, defaults, SEKB golden path, Browser recovery)
- TF-0001 close-out doc: docs/dev/tf0001-controlled-operable-closeout.md
- Evidence: rtifacts/tf0001-closeout/evidence.json
- **Still NO-GO**: joint-system GA, default-on graduation, SEKB auto writeback
- TF-0006 remains blocked until real corpus / live A/B

---

## 8. TF-0006 unblock criteria (2026-07-19)

TF-0006 remains **blocked**. Clarified decision: **keep-blocked**.

- Doc: docs/dev/tf0006-evidence-upgrade-unblock.md
- Lock: artifacts/tf0006-evidence-upgrade/status.json
- Required before any unblock discussion: real corpus manifest, human live A/B report, soak report, product approval
- Synthetic / P0 green must not set liveReady=true or flip default-on
