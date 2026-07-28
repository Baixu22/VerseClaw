# DCS Visible → Production — STATUS（仅元数据）

> **只放进度元数据。** 实现细节、切片、验收命令写在 `tasks/TASK-*.md`。  
> 丢上下文后：先读本文件 → 再打开 `status=in_progress` 或下一个 `ready` 的任务文档。

| 字段 | 值 |
|------|-----|
| **programId** | `dcs-visible-production` |
| **goal** | 所有用户/开发者**看得见**的 DCS 相关功能达到**生产可用**（可开、打开真干活、Settings 可达、可回滚、有 live 证据），消灭 shelfware |
| **sourceGapDoc** | `team/claude/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md` |
| **codeBaseline** | `ClawX-maturity-p0` @ `main` / `60931957b`（启动时复核 HEAD） |
| **createdAt** | 2026-07-22 |
| **updatedAt** | 2026-07-22 |
| **phase** | `M1/P2 engineering closeout` (all auto tasks done; P2-01 human-blocked) |
| **activeTaskId** | — |
| **nextTaskId** | `TASK-P2-01` (blocked: humans) |
| **owner** | Claude |
| **hardLocks** | `defaultOn=false` 直至 TF-0006 + productApproved；禁止 SEKB auto writeback；禁止用翻默认“证明可用”；packaging 不 auto-flip |

---

## 进度规则

1. 开始任务：`status` → `in_progress`，填 `activeTaskId`，任务文档写 `Started` 日志一行。  
2. 结束切片：任务文档 `## Progress log` 追加；本表只改 `status` / `updatedAt` / `note`。  
3. 完成任务：`status` → `done`，`activeTaskId` 清空，`nextTaskId` 取依赖已满足的下一个 `ready`。  
4. 阻塞：`status` → `blocked`，`blockedBy` 填任务 ID 或外部原因。  
5. **禁止**把长设计/代码贴进本文件。

### status 枚举

`backlog` | `ready` | `in_progress` | `blocked` | `done` | `cancelled` | `deferred`

### milestone 枚举

`M0-honesty` | `M1-productive` | `M2-default-candidate` | `M3-zero-shelfware` | `OPS`

---

## 任务注册表

| id | title | milestone | priority | status | blockedBy | owner | updatedAt | note |
|----|-------|-----------|----------|--------|-----------|-------|-----------|------|
| TASK-P0-01 | DCS Flag 面板可写控制面 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | E2E 2/2 + unit 47; Settings-first runbook |
| TASK-P0-02 | 消灭 factViews 死配置 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | ADR-B; env+UI SoT; helper fail-closed |
| TASK-P0-03 | 隐身 view 工具可发现 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | banner+CTA; E2E 3/3 |
| TASK-P0-04 | BlockStore 失败可感知 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | degradationNotice in prompt; tests 6/6 |
| TASK-P0-05 | 产品文案：壳 vs 芯 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | ContextLayersExplainer; E2E 3/3 |
| TASK-P0-06 | 废弃面下架与文档扫尾 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | RETIRED-SURFACES + memory STALE |
| M0-INTEGRATION | M0 全量集成验收 | M0-honesty | P0 | done | — | Claude | 2026-07-22 | PASS; see artifacts M0-INTEGRATION-REPORT |
| TASK-P1-01 | Fact 视图四工具生产化 | M1-productive | P1 | done | — | Claude | 2026-07-22 | accept-with-residuals; opt-in usable; live A/B residual |
| TASK-P1-02 | working-memory 注入真生效 | M1-productive | P1 | done | — | Claude | 2026-07-22 | Settings+config path; injection tests; default off |
| TASK-P1-03 | tool_registry 注入一致 | M1-productive | P1 | done | — | Claude | 2026-07-22 | Settings+factory; tests 8+8; default off |
| TASK-P1-04 | VToken vs DCS 主路径决策 | M1-productive | P1 | done | — | Claude | 2026-07-22 | ADR layered C; no default flips |
| TASK-P1-05 | SEKB 人审生产闭环 | M1-productive | P1 | done | — | Claude | 2026-07-22 | golden-path e2e+unit; no auto writeback; human-10 residual |
| TASK-P1-06 | Browser 监督生产 soak | M1-productive | P1 | done | — | Claude | 2026-07-22 | security e2e+unit; private-net deny; human-10 residual |
| TASK-P1-07 | staleWriteGuard 生产候选 | M1-productive | P1 | done | — | Claude | 2026-07-22 | override UX+tests; keep-off; live corpus residual |
| TASK-P1-08 | TaskLoop 验收场景覆盖 | M1-productive | P1 | done | — | Claude | 2026-07-22 | checklist+phase tests 8; taskLoopNote |
| TASK-P2-01 | TF-0006 四件套证据 | M2-default-candidate | P2 | blocked | human-corpus+live-ab+soak+product-approval | — | 2026-07-22 | operator-pack forms ready; still blocked; no forge |
| TASK-P2-02 | 分表面 default-on 毕业 | M2-default-candidate | P2 | backlog | TASK-P2-01 | — | 2026-07-22 | 禁止联合一次翻 |
| TASK-P2-03 | 双注入预算动态协调 | M2-default-candidate | P2 | done | — | Claude | 2026-07-22 | injection-budget coordinator + metrics; 44 tests |
| TASK-P2-04 | 观测产品化面板 | M2-default-candidate | P2 | done | — | Claude | 2026-07-22 | Settings observability panel; kill+metric keys; e2e |
| TASK-P2-05 | C4/C5 默认强化（按需） | M2-default-candidate | P2 | deferred | product-pain | — | 2026-07-22 | 无并发痛点可延后 |
| TASK-OPS-01 | L3 真人 canary 执行包 | OPS | P0 | done | — | 2302_78999445@local-dev | 2026-07-22 | accept-with-residuals; 6 supervised runs; continue |
| TASK-OPS-02 | 真 kill/rollback 演练 | OPS | P0 | done | — | 2302_78999445@local-dev | 2026-07-22 | live-supervised-electron; not dry-run |
| TASK-OPS-03 | M1 出口评审（re-scoped M0-exit/M1-entry） | OPS | P1 | done | — | Claude | 2026-07-22 | GO M1 / NO-GO M2; UI-01/T-04 clear; M-01 open |

---

## 推荐执行序（依赖已展开）

```text
Wave 0 (prep done): STATUS + tasks/*  ← 本轮
Wave 1 (M0):  P0-01 → P0-02 → P0-03 → P0-04 → P0-05 → P0-06
              可并行: P0-04 || P0-05 || P0-06；P1-04 决策可并行
Wave 2 (OPS): OPS-01 + OPS-02（可与 Wave 1 尾并行）
Wave 3 (M1):  P1-02 + P1-01 → P1-03 → P1-05 → P1-07 → P1-08 → OPS-03
Wave 4 (M2):  P2-01 → P2-02；P2-03/P2-04 并行
Wave 5 (M3):  全表 status=done 或 cancelled(隐藏/Retired)
```

---

## 计数

| metric | value |
|--------|------:|
| tasks total | 21 |
| ready | 0 |
| backlog | 1 |
| deferred | 1 |
| in_progress | 0 |
| done | 20 |
| blocked | 1 |

---

## 会话恢复检查清单

```text
[ ] 读 STATUS.md（本文件）
[ ] 确认 codeBaseline / hardLocks 仍成立
[ ] 打开 activeTaskId 或 nextTaskId 对应 tasks/TASK-*.md
[ ] 只做一个切片（见任务文档 Implementation slices）
[ ] 更新任务 Progress log + 本表一行元数据
[ ] 勿把实现细节写入 STATUS
```

## 路径

| 角色 | 路径 |
|------|------|
| 权威 STATUS | `team/claude/dcs-visible-production/STATUS.md` |
| 任务目录 | `team/claude/dcs-visible-production/tasks/` |
| 缺口总览（只读参考） | `team/claude/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md` |
| 工作区镜像 | `ClawX-maturity-p0/docs/dev/dcs-visible-production/` |
