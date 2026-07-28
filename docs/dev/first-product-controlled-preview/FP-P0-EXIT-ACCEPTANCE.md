# FP-P0 runtime-contract — 阶段出口验收

| field | value |
|-------|-------|
| **phase** | `FP-P0` runtime-contract |
| **scope** | FP-P0-01 … FP-P0-05 |
| **验收日期** | 2026-07-26 |
| **验收人** | Claude（**self-accept**，与实现人同一；代偿见下） |
| **结论** | **GO** |

## 验收方式声明（诚实前提）

本 program 为单人执行，验收人 = 实现人。DoD G5 要求「验收人 ≠ 实现人」，此处不满足。
按 DoD 允许的「明确写 self-accept + 理由 + 残留」处理，代偿措施：

1. **全部证据命令由验收人重跑**，不复用实现期输出（下方计数为本次重跑结果）。
2. **反向验证守卫非空转**：对 FP-P0-03 的 md 覆盖守卫做删行注入，确认会真失败。
3. **不接受"实现说绿"**：逐条核对 Acceptance criteria 是否有可点开的证据指针。
4. 发现的问题**不在验收里顺手改**，全部转任务 ID。
5. 建议后续由 Codex 或人工做一次独立复核（→ 新任务 **FP-P0-08**）。

## 必跑命令（验收人本次重跑）

| 命令 | 结果 |
|---|---|
| `pnpm contract:check` | **Contract check passed.** |
| `git diff --check` | **仓库级失败（非本阶段引入）** — 见下「diff --check 处置」 |
| `pnpm exec vitest run tests/unit/default-config-matrix.test.ts --maxWorkers=2` | **1 file / 14 passed / 0 failed** |

### diff --check 处置

全仓 `git diff --check` 退出码 2，命中文件全部为**前序**改动：
`docs/dcs-production-p0-runbook.md:36,49`、`docs/dcs-production-p0-runbook.zh-CN.md:36,49`、
`openclaw_runtime/extensions/codegraph/README.md:3-7,42-43`。

对本阶段改动的全部文件逐个 `git diff --check -- <file>`：**空输出（干净）**。
故判定：本阶段不引入新的空白问题；仓库既有问题转 `FP-P3-01`（发布树卫生，注册表已有）。
**不因此 NO-GO** —— 该门禁失败与本阶段交付无因果关系，且已有归属任务。

## 补充重跑（验收人）

| 命令 | 结果 |
|---|---|
| `vitest run tests/unit/{vtoken-launch-default,launch-contract-matrix,default-config-matrix,vtoken-bridge,gateway-process-launcher-env}` | **5 files / 50 passed** |
| `vitest run tests/unit/dcs-flag-ack.test.ts` | **1 file / 18 passed** |
| runtime: `assembler` + `assembler.kill-switch` + `turn-injection-budget` + `runtime-flag-ack` + `context-orchestrator` + `dcs-observability` + `injection-budget` | **7 files / 90 passed** |
| `pnpm run test:dcs`（默认 CI 路径） | **35 files / 304 passed / 0 failed**（218 + 10 + 76） |
| `pnpm exec vitest run --maxWorkers=2 --exclude <3 串行文件>` | **674 passed / 3 skipped（677 files）/ 6108 passed / 52 skipped** |
| 3 个串行文件 | **3 files / 25 passed** |
| `pnpm run test:e2e:run tests/e2e/runtime-launch-contract-fp-p0.spec.ts --workers=1` | **3 passed (10.7m)** |
| `pnpm i18n:lint` | **i18n lint passed.** |
| `pnpm lint:dcs`（type-aware，含 assembler.ts / attempt.ts） | **exit 0** |
| `tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json` | **均 exit 0** |

52 个 skipped 全部为**前序既有** skip；本阶段未新增 skip、未放宽断言、未删 AC 条目。

### 验收人本次 E2E 原始输出（真 gateway child）

```
[fp-p0-ack]          {"childPid":24384,"gatewayGeneration":"1",
                      "configSource":{...,"exists":true,"origin":"env-override"},
                      "degradedReason":null,
                      "turnEffectProbe":{"wouldChangeTurn":false,"killSwitchEngaged":false,"activeSurfaces":[]},
                      "vtokenAssembly":false}
[fp-p0-02-config-kill]{"childPid":39624,"envKillPresent":false,"killSwitch":true,
                      "workingMemory":false,"toolRegistry":false,
                      "turnEffectProbe":{"wouldChangeTurn":false,"killSwitchEngaged":true,"activeSurfaces":[]}}
[fp-p0-04-setflag]   {"status":"applied",
                      "ackTrail":["saved","pending-restart","restarting","runtime-acknowledged","applied"],
                      "restartedGateway":true,"gatewayGeneration":"2",
                      "ackChildPid":39156,"ackGeneration":"2"}
[fp-p0-05-budget]    {"totalChars":6000,
                      "precedence":["knowledge","working_memory","tool_registry","cvk_addition","vtoken","memory_pilot","other"],
                      "dropAlertRatio":0.1,
                      "counters":{"turns":0,...全 0}}
3 passed (10.7m)
```

child pid 与实现期不同（24384/39624/39156 vs 19768/20528/10748），确认为**独立新跑**而非复用。

## 逐任务核对

### FP-P0-01 VToken 启动层默认 OFF 归位 — 通过

- Gate：G1/G2/G3/G5 绿，G4 `n/a`。**n/a 理由站得住**：child env 无真人可观测面，真人影响已挂 FP-P1-07。
- AC 6/6 勾选，每条带证据指针（含 `path:line` 与 E2E 输出行）。条目数与创建时一致，无删减。
- 关键验证：`docs/dev/default-config-matrix.md` **零改动**（`git diff --stat` 为空），符合「不改文档也能通过」。
- Decision 记录了选 A 及否 B 的技术理由（注 `'0'` 会让 resolver 早退、打死 config opt-in 通道）。

### FP-P0-02 kill-switch 传 cfg — 通过

- Gate：G1/G2/G3/G5 绿，G4 `n/a`（live 演练归 FP-P1-05，成立）。AC 6/6。
- 调用点穷举**已贴 grep 结果**并对 5 个生产命中逐个说明（1 个真 `Assembler`，4 个同名异物）。
- 关键裁定经复核**正确**：调用点不传 cfg、改 request 级解析。若按任务书字面「补传 cfg」，
  传的恰是 factory 构造期快照 = 任务书自己禁止的过期快照。实现选择了任务书**意图**而非字面，
  且在代码注释与任务书里都写明「故意不传」防止后人改回。
- **加分项**：发现并修复 `zod-schema.ts` 缺 `runtime.contextEnhancement` 叶子 —— 配置型 kill
  此前不是「无效」而是**写入即让 gateway `code=1` 退出**。该缺陷只有真 child 才能暴露。

### FP-P0-03 启动层默认/kill 回归测试 — 通过

- Gate：G1/G2/G3/G5 绿，G4 `n/a`（纯回归门禁，成立）。AC 5/5。
- 「matrix 每行都有断言」经**反向注入验证**：删 `MD_MATRIX_ROWS` 一行 →
  `md rows with no assertion registered ...: VToken bridge` / 1 failed。守卫非空转。
- 双侧断言由表驱动生成（9 行 × 2），非手写枚举。矩阵 9 类 ≥ 要求的 7 类。
- 新测试确认已挂默认 CI 路径（root `vitest run` 通配 + `test:dcs` 显式登记）。

### FP-P0-04 child-runtime acknowledgement 状态机 — 通过

- Gate：G1/G2/G3/G5 绿，G4 `n/a`（真人观感归 FP-P1-03，成立）。AC 8/8。
- **未降级为两态**：trail 实测五态齐全。**未由 restart() 推导 applied**：代码路径上
  restart 后仅到 `restarting`；E2E 断言 `applied` 必带 `runtimeAck`。
- 七字段「缺一不算」由 `it.each(DCS_FLAG_ACK_REQUIRED_FIELDS)` 逐字段删除验证。
- 已知 E2E 障碍（`VERSE_CLAW_E2E=1` 跳过 auto-start）**按「新增真 gateway profile」解决**，
  未偷懒转残留。
- **加分项**：首跑 E2E 抓出 kebab/snake 命名不一致致健康 flag 被误判 `flag-rejected`，已加显式映射 + 3 回归。
- 已诚实标注：E2E 断言落在控制面返回值，未驱动 Settings DOM → 转 FP-P1-03。

### FP-P0-05 注入预算与 precedence 统一 — 通过

- Gate：G1/G2/G3/G5 绿，G4 `n/a`（内部记账，成立）。AC 7/7。
- 四项裁定全部写入 `## Decision`，含否决理由（否「按 request 动态 precedence」因降级不可复现）。
- **未靠放大总预算消除降级**（Hard lock）：DCS 三通道额度仍为 2000 不变；新增额度只给
  CVK/VToken/RM —— 这三源此前是 **0 约束**，纳入有限池是净收紧。经复核该论证成立。
- 账目债处置**合规**：实算复核确认同公式异语料（4.5x = 4 条手写、5.125x = 32 条合成），
  两处 artifact 各加 `reductionDefinition` 双向标注 + 独立对账文档。
  **未删数字、未改门禁结论**（两者仍 `meetsGate:false` / `keep-off`）。
- **主动降级不充绿**：E2E 的 budget counters 全 0（无 provider、未跑 agent turn），
  实现人已在任务书 G3 处显式声明「契约已验证、真实 turn 非零账目未验证」并转 FP-P1-11。
  验收人认可此处理 —— 这正是 DoD 假 done 第 5 条要防的事。

## DoD「禁止的假 done 模式」六条逐条判断

| # | 模式 | 判定 |
|---|---|---|
| 1 | 用 synthetic canary 冒充 live A/B | **未犯**。5.125x 合成语料在两处 artifact 与对账文档中均标 `live:false`；FP-P0-05 明写「不得引为产品可用证据」 |
| 2 | 用 `restart() resolved` 冒充 runtime effective | **未犯**。FP-P0-04 的核心即消除此模式；restart 后仅到 `restarting`，`applied` 必须过完整 child ack + 世代匹配 |
| 3 | 用 dry-run 脚本冒充 live kill/rollback | **未犯**。FP-P0-02 的 kill 证据是真 child 内 effective flags 归零（pid 39624），非脚本 dry-run。live 长时演练明确留给 FP-P1-05 |
| 4 | 用 agent 自跑会话冒充真人产品任务 | **未犯**。五个任务 G4 全为 `n/a` 且各写理由，无一处声称真人证据。L3 真人水位仍为 0 未被粉饰 |
| 5 | 用「测试全绿」推断「产品可用」 | **未犯**。全阶段无 liveReady/productApproved 声明；FP-P0-05 主动把「真实 turn 非零账目」从 G3 摘出转 FP-P1-11，正是拒绝此推断 |
| 6 | 把未完成项从 AC 里删掉而非转残留 | **未犯**。AC 条目数与创建时一致（6/6/5/8/7），无删减；11 条残留全部转出新任务 ID 并已建任务文件 |

## 禁用词与硬锁核查

- `liveReady` / `productApproved` / `GA` / `default-on`：**未用于声明本阶段成果**。
  仅 2 处历史/否定语境出现（FP-P0-04 引用 Codex 原话「不能称 liveReady」、Non-goals「不做 default-on 毕业」），
  FP-P0-01 残留表提及「去除 default-ON 表述」为待勘误对象。均非成果声明。
- `defaultOn = false`：STATUS 第 23 行仍为 `false`（硬锁）。本阶段**未翻任何生产默认值**。
- 保守默认核查（Hard lock 5）：真 child ack 实测 `writeJournal=true`、`worktree=inprocess`、
  `symbolLease.mode=memory`、`patchFlow.default=false` —— 与硬锁一致，未被改动。

## 三处状态一致性

| id | STATUS 注册表 | tasks/README.md | 任务书 header | 一致 |
|---|---|---|---|---|
| FP-P0-01 | done | done | done | ✅ |
| FP-P0-02 | done | done | done | ✅ |
| FP-P0-03 | done | done | done | ✅ |
| FP-P0-04 | done | done | done | ✅ |
| FP-P0-05 | done | done | done | ✅ |

新增 8 个残留任务在 STATUS 与 tasks/README 均已登记，且任务文件均已创建（无悬空链接）。

## 残留全量清单（11 条 → 8 个新任务 ID）

| 来源 | 残留 | 新任务 ID | 已建文件 |
|---|---|---|---|
| FP-P0-01 | 前序文档仍记 VToken default-ON | `FP-P4-06` | ✅ |
| FP-P0-01 | VToken 无 Settings UI opt-in | `FP-P4-03`（既有） | ✅ |
| FP-P0-01/03 | 仓库既有 trailing whitespace | `FP-P3-01`（既有） | ✅ |
| FP-P0-02 | 类型/zod schema 一致性无守卫 | `FP-P0-06` | ✅ |
| FP-P0-02 | contextEngine.assemble kill 覆盖分散 | `FP-P0-05`（本阶段内已处理 precedence） | — |
| FP-P0-03 | md 默认值单元格未逐字比对 | `FP-P0-07` | ✅ |
| FP-P0-04 | E2E 未驱动 Settings DOM | `FP-P1-03`（既有） | ✅ |
| FP-P0-04 | ja/ru 为英文占位 | `FP-P4-07` | ✅ |
| FP-P0-04 | ack 超时固定 20s/500ms | `FP-P1-09` | ✅ |
| FP-P0-04 | configSource 非逐 flag 归因 | `FP-P1-10` | ✅ |
| FP-P0-05 | 真实 turn 非零账目未验证 | `FP-P1-11` | ✅ |
| FP-P0-05 | 预算总额/告警线为起始线且未配置化 | `FP-P2-04` | ✅ |
| FP-P0-05 | C1 双语料并存 | `FP-P4-05` | ✅ |
| FP-P0-05 | 计数器无 turn/session 维度导出 | `FP-P1-06`（既有） | ✅ |
| 验收 | self-accept 需独立复核 | `FP-P0-08` | ✅ |

## 结论：GO

五个任务的 G1/G2/G3/G5 全绿、G4 均为有理由的 `n/a`；AC 无删减且每条有可点开证据；
DoD 六条假 done 模式逐条未犯；三处状态一致；残留全部转出并建档。

**GO 的含义边界（防误读）**：
- 仅表示 **FP-P0 runtime-contract 的出口条件达成**：启动层默认值与 runtime/docs/tests 一致、
  kill 可证明切断、runtime ack 状态机上线。
- **不表示**产品可用、不表示 liveReady、不表示任何组件可毕业。
- 证据水位未变：L3 真人任务仍为 **0**，L5 soak/approval 仍全缺。
- `defaultOn` 仍为 `false`，全部生产默认值未翻。
