# First Product · Controlled Preview — STATUS（仅元数据 + 开发日志）

> **只放进度元数据与日志。** 实现细节、切片、验收命令写在 `tasks/FP-*.md`。
> 丢上下文后：先读本文件 → 再打开 `status=in_progress` 或下一个 `ready` 的任务文档。
> `done` 的唯一定义见 [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md)（G1 dev / G2 test / G3 runtime / G4 human / G5 accept 全绿）。

| 字段 | 值 |
|------|-----|
| **programId** | `first-product-controlled-preview` |
| **productName** | Verse Claw Windows x64 · DCS Coding + GitHub Forge Controlled Preview |
| **goal** | 真人能完成编码、GitHub review 和 sandbox merge 受控闭环；DCS/runtime ack、写入/验证/undo/重启/kill/rollback、远端完整性/审批/head SHA/readiness 全可解释 |
| **predecessor** | `docs/dev/dcs-visible-production/STATUS.md`（M0/M1 已闭环，P2-01 human-blocked） |
| **sourceAudit** | Codex 只读审计 2026-07-26（证据水位 L0–L5、组件缺口表、Phase 0–4 建议） |
| **forgeAudit** | `MERGEBEACON-GIT-CAPABILITY-ADOPTION.md`（2026-07-27；核心链 `FP-P2-07`–`10`，联合验收 `FP-P2-01/02/03`，扩围 `FP-P4-08`） |
| **downstreamRoadmap** | `docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md`（`TF-0010`/`TF-0011`–`TF-0019`，当前均 proposed） |
| **codeBaseline** | `refs/heads/main`（FP-P3-01 最终 clean SHA 由 fresh `release-gate-evidence.json.commit` 固定并必须等于该 ref；任务前基线 `32839d1e3`；未 push） |
| **createdAt** | 2026-07-26 |
| **updatedAt** | 2026-07-29 |
| **phase** | `FP-P1` 出口 GO（11/12 done，1 deferred）；`FP-P2 engineering-validation-only` 已收口；`FP-P3` 工程可自动化部分已收口（01/02/05 done，03/04 保持 engineering-validation-only），phase 出口仍未满足 |
| **activeTaskId** | —（FP-P3 fixture-grade 可自动化任务已完成；不得进入 P4/UAS） |
| **nextTaskId** | —（FP-P3 工程可推进部分完成后，P3 phase 出口受 P3-03/04 真人证据阻塞） |
| **owner** | —（独立开发者；safetyReviewer/productApprover 角色无法独立于实现，已标记 engineering-validation-only） |
| **liveReady** | `false` |
| **productApproved** | `false` |
| **defaultOn** | `false`（硬锁） |

## Hard locks（不可违反）

1. `defaultOn=false` 直至 `FP-P2` 出 continue 决策 **且** TF-0006 四件套齐备 **且** productApproved。
2. 禁止 SEKB 自动写回；禁止 Browser 无监督/私网；Runtime Memory 保持 diagnostics-only。
3. 禁止用翻默认值「证明可用」。
4. 禁止用单测 / E2E / Agent Dev green 跨级冒充 live 或 product 证据。
5. 保守默认不变：`writeJournal=true`、`worktree=inprocess`、`isolation=shared`、`patchFlow.default=false`。
6. 首发平台固定 **Windows x64**；不得再宣传 Windows ARM64。
7. 未签名产物仅限内部 Alpha，不进入 public latest。
8. 真实远端副作用只允许 `FP-P2-01` charter 指定的 GitHub sandbox/disposable repository；生产 repository 默认禁止。
9. `unknown/incomplete` readiness、stale head/approval 一律 fail closed；默认 Agent merge 保持 OFF，除非 P2 分面裁决和产品审批均明确允许。

## Engineering-only sequencing deviation（2026-07-28）

用户明确把 FP-P1-07 独立 G5、P1 phase 出口和 P2 真人阶段集中后置处理。P1-07/08 在 G5 未完成时继续保持 `in_progress`；非真人链已按 `FP-P2-07 -> FP-P2-08 -> FP-P2-09 -> FP-P2-10 -> FP-P2-05 -> FP-P2-06` 严格串行完成。

该偏差不表示 controlled canary 已开始，不授权真实凭据、真实 GitHub 评论、metadata 修改或 merge，不改变 `liveReady=false`、`productApproved=false`、`defaultOn=false`，也不解除任何 hard lock。

---

## 证据水位（每次收口后更新）

| 层 | 含义 | 当前 | 目标（Controlled Preview） |
|----|------|------|------|
| L0 | 工程门禁 | ✅ `contract:check` 通过；root unit 6108 passed / DCS 304 passed（FP-P0 后重测） | 保持 |
| L1 | 合成 canary | ⚠️ C1 32 synthetic，`live=false`，`keep-off` | 保持（不冒充 live） |
| L2 | Electron 路径 | ✅ 关键组合 6/6；FP-P0 3 条真 gateway child E2E；FP-P2-06 真 turn 三通道 provider 独立计量与账目平衡；FP-P1-07/08 独立 G5 已通过 | 保持并由真人任务消费 |
| L3 | 真人任务 | ❌ 0（6 run 全 `notHumanProductChat=true`）**FP-P0 未改变此水位** | ≥10 真人 DCS coding |
| L4 | Kill/Rollback | ✅ FP-P1-05 真 Electron 七场景全绿：真实 undo、Gateway/Electron restart、kill `6980ms`、N->N-1 fail-closed、restart failure/recovery；长时真人 soak 仍归 FP-P2-02 | live 长时增强会话 rollback |
| L5 | Soak / Approval | ❌ corpus / human A/B / soak / approval 全缺 | 仍可为空，但需显式登记为 deferred |

---

## 阶段与出口

| phase | 出口条件 | 状态 |
|-------|----------|------|
| `FP-P0` runtime-contract | 启动层默认值与 runtime/docs/tests 一致；kill 可证明切断；runtime ack 状态机上线 | **GO**（2026-07-26，self-accept；结论见 [FP-P0-EXIT-ACCEPTANCE.md](./FP-P0-EXIT-ACCEPTANCE.md)） |
| `FP-P1` vertical-slice | 安装→首次成功编码任务→undo/restart/kill/support bundle 全通（E2E + 手工） | **GO**（2026-07-28，独立 G5 由 GLM-5.2 完成；11/12 done，1 deferred） |
| `FP-P2` controlled-canary | GitHub Forge 核心开发完成；≥10 真人 DCS + Forge 联合任务；DCS/read/review/merge 分面裁决 | `blocked`（pre-canary engineering 已完成；FP-P1-07/08 独立 G5 已通过；controlled canary 等待 charter 与真人 operator） |
| `FP-P3` release-candidate | clean SHA/manifest + Windows x64 安装升级回滚 + `git/gh` 缺失/认证/凭据安全证据 | `in_progress`（02/05 done；03/04 engineering-validation-only；01 fixture-grade 待推进；phase 出口受 03/04 真人证据阻塞） |
| `FP-P4` component-graduation | SEKB / Browser / VToken / RM 独立门禁；GitLab/Gitee/PR DAG 仅做扩围裁决 | `backlog` |

---

## 任务注册表

`H` 列 = 是否需要 G4 真人证据。

| id | title | phase | pri | status | H | blockedBy | owner | updatedAt | note |
|----|-------|-------|-----|--------|---|-----------|-------|-----------|------|
| FP-P0-01 | VToken 启动层默认 OFF 归位 | FP-P0 | P0 | done | — | — | Claude | 2026-07-26 | 决策 A 落地；真 child ack 证 `launchEnv` 无该键；matrix 文档零改动。残留 FP-P4-06 |
| FP-P0-02 | kill-switch 传 cfg 到 Assembler/working-memory | FP-P0 | P0 | done | — | — | Claude | 2026-07-26 | request 级 cfg 解析（非构造期快照）；另修 zod-schema 缺 contextEnhancement 叶子致 gateway 起不来。残留 FP-P0-06 |
| FP-P0-03 | 启动层默认/kill 回归测试 | FP-P0 | P0 | done | — | — | Claude | 2026-07-26 | md 10 行全覆盖+三层同步守卫（反向删行实测会 fail）；43 单测+2 E2E。残留 FP-P0-07 |
| FP-P0-04 | child-runtime acknowledgement 状态机 | FP-P0 | P0 | done | — | — | Claude | 2026-07-26 | 五态+七字段+世代丢弃；真 child ack 达 applied。另修 kebab/snake 命名致健康 flag 误判 rejected。残留 FP-P4-07/FP-P1-09/FP-P1-10 |
| FP-P0-05 | 注入预算与 precedence 统一 | FP-P0 | P1 | done | — | — | Claude | 2026-07-26 | 四项裁定入档；turn 级共享账本接入 4 类注入源；口径债双向标注。G3 边界（真实 turn 非零账目）转 FP-P1-11 |
| FP-P0-06 | config 类型/zod schema 一致性守卫 | FP-P0 | P1 | done | — | — | Claude | 2026-07-26 | 普查出 coding/vtoken/orchestration/resilience/memory.injectPilot 5 组「文档有/写入致死」叶子全补 schema；双侧守卫（vitest 83 用例+lint:dcs 编译穷举）双向反向注入真失败；真 child E2E 起动成功。残留 FP-P3-05（dist 新鲜度） |
| FP-P0-07 | matrix 默认值单元格逐行文本比对 | FP-P0 | P2 | done | — | — | Claude | 2026-07-26 | 10 行格文本逐字锁+三方一致（md↔fixture↔实现探针）；反向改格 `**true**` 真失败；无新残留 |
| FP-P0-08 | FP-P0 独立复核（消除 self-accept） | FP-P0 | P1 | ready | — | — | — | 2026-07-26 | 出口 GO 为 self-accept；需非实现人背书，复核人不得为 Claude |
| FP-P1-01 | Setup 接入 Provider/Model 验证 | FP-P1 | P0 | done | — | FP-P0-04 | Claude | 2026-07-26 | Provider/Model 双步真校验（复用 Settings 栈）；skip=显式受限+chat 首发拦截；E2E 真 Electron+真本地 HTTP 端点 2 passed；脱敏验证状态入 settings/metadata |
| FP-P1-02 | workspace preflight 与权限选择 | FP-P1 | P0 | done | — | FP-P1-01 | Claude | 2026-07-26 | 六检查 preflight+双档权限入 Setup；agents.defaults.workspace 随 active profile 同步消第二权威；denial 带边界；单测 20+E2E 1 passed（越界/穿越真拒） |
| FP-P1-03 | 显式 DCS opt-in + runtime ack 串联 | FP-P1 | P0 | done | — | FP-P0-04, FP-P1-02 | Claude | 2026-07-27 | 一开关组合 4 flag（排除项有单测守卫）；真 Settings DOM+真 child E2E 四阶段 1 passed 10.4m：缺前置拒→applied 五态→关闭 parity wouldChangeTurn:false→config kill 显示 killed 而非 applied |
| FP-P1-04 | 编码任务闭环：read→write→diff→test→undo | FP-P1 | P0 | done | — | FP-P1-03 | Claude | 2026-07-27 | 补三处真缺口：verify 段 test-runner 探测（全仓此前零实现）、diff 证据改走 content（投影层删 details 致用户看不到 diff）、read 观测+lineage requestId/flags；真 agent turn E2E 4 轮 1 passed 32.1s（undo ok:true/部分还原 ok:false 硬锁双证） |
| FP-P1-05 | restart/recovery + live kill/rollback | FP-P1 | P0 | done | — | FP-P1-04 | Codex | 2026-07-27 | 真 Electron 七场景 1 passed (1.9m)：Gateway/Electron restart、真实 journal+undo、kill 6980ms、baseline parity、N->N-1 强制关 7 flags、restart-failed 可解释并恢复；另修 clean runtime build 缺扩展产物并加 boot smoke |
| FP-P1-06 | 脱敏 support bundle 导出 | FP-P1 | P0 | done | — | FP-P1-03 | Claude | 2026-07-27 | 真 UI 按钮导出 E2E 1 passed 30.4s；种两类泄漏向量（存储 key 结构性排除 + label 内 key 靠脱敏）真断言搜不到；补齐源码正文不外泄与体积上限具名截断；反向注入改坏正则→3 failed 证守卫非空转 |
| FP-P1-07 | 首次任务 Electron E2E（含失败路径） | FP-P1 | P0 | done | — | FP-P1-04, FP-P1-05, FP-P1-06 | Codex | 2026-07-28 | 独立 G5 由 GLM-5.2 完成：4 passed (3.9m)，修复 verify_tests 断言漂移；G1-G5 全绿 |
| FP-P1-08 | 产品叙事与文档同步 | FP-P1 | P1 | done | — | FP-P1-07 G5 | Codex | 2026-07-28 | 独立 G5 由 GLM-5.2 完成：60+40 tests、contract/i18n/claim scan 全绿；G1-G5 全绿 |
| FP-P1-09 | ack 超时参数化与调参 | FP-P1 | P2 | done | — | FP-P0-04 | Claude | 2026-07-26 | 实测 5 真 child 冷启动 11.6-12.7s→默认 60s(4.7×max)；退避 RPC 120→19；requeryAck 全链新增（E2E 证不重启可重查）；AppSettings 双键覆盖 |
| FP-P1-10 | 逐 flag configSource 归因 | FP-P1 | P2 | done | — | FP-P0-04 | Claude | 2026-07-27 | 旁路新增 WithSources（旧函数薄封装，既有 17 单测零改全绿）；flagAttribution 刻意不进 REQUIRED_FIELDS 免旧 child 被判 incomplete；真 child 实证 compass=default vs working_memory=config 同值不同源。UI 徽章+四语 i18n 已落地但 E2E 未稳定断言→FP-P1-08 |
| FP-P1-11 | 真实 turn 内共享预算非零账目核对 | FP-P1 | P1 | deferred | — | FP-P1-04 | Claude | 2026-07-27 | 已保留真 turn 非零账目与 lastTurn 证据；AC3/4/5 未达成且剩余实现完整转交 FP-P2-06，故不标 done、不再占用 P1 active |
| FP-P1-12 | 预览开关 E2E Phase C 抖动治理（重启冷却竞态） | FP-P1 | P1 | done | — | — | Claude | 2026-07-27 | 根因证实=冷却抑制分支 return 与成功同形→配置静默丢弃→child 跑旧配置→ack 判 failed（真人快速开关同路径）。改为等冷却后真重启（上界 5s，未动冷却时长）。反向注入证用例非空转；E2E 5 跑 3 败→3 跑 3 绿，耗时 65s→47s |
| FP-P2-01 | DCS + Forge Canary 治理包 | FP-P2 | P0 | blocked | — | FP-P2-10 | — | 2026-07-28 | FP-P1-07/08 独立 G5 已通过；模板已备；缺具名角色、fixed clean SHA、Provider/Model、workspace/repository、credential/action/merge/budget/privacy/stop/rollback 真人裁定 |
| FP-P2-02 | 10 次真人 DCS coding + GitHub Forge 联合执行 | FP-P2 | P0 | backlog | ✅ | FP-P2-01 | — | 2026-07-27 | ≥3 read、≥2 review、1 sandbox merge + 阻断矩阵；`notHumanProductChat=false` |
| FP-P2-03 | DCS + GitHub Forge 联合裁决与账目刷新 | FP-P2 | P0 | backlog | — | FP-P2-02, FP-P2-04, FP-P2-05, FP-P2-06 | — | 2026-07-27 | DCS/read/review/merge 分面 continue/shrink/stop；统一刷新 TF-0009/日志/handoff/evidence |
| FP-P2-04 | 预算总额与 drop 告警线复核+配置化 | FP-P2 | P1 | backlog | — | FP-P2-02 | — | 2026-07-26 | 源自 FP-P0-05：0.1/6000 为起始线非经验值；禁止靠放大总额消除告警 |
| FP-P2-05 | verify 段自动执行与结果回填 | FP-P2 | P2 | done | — | FP-P1-04 | Codex | 2026-07-28 | default-off；最终 effective exec 复用、nearest project/custom runner、八类结果与真 child 可见回填全绿；失败不回滚 write journal |
| FP-P2-06 | 注入预算逐通道归因补全 | FP-P2 | P1 | done | — | FP-P1-04 | Codex | 2026-07-28 | 三通道真实 charge、同 ledger DCS 2000 容量 reservation、provider 独立比对与显式 CVK 截断全绿；总额仍 6000 |
| FP-P2-07 | MergeBeacon 来源冻结与结构化 Patch/Error 契约 | FP-P2 | P1 | done | — | FP-P1-08 G5（验收依赖） | Codex | 2026-07-28 | 六切片收口：source/license、唯一 contract/adapter、Git/Code Review/DCS rich diff、canonical error envelope、脱敏与反向测试；真实 Electron E2E 全绿 |
| FP-P2-08 | GitHub Remote Forge 只读控制面 | FP-P2 | P1 | done | — | FP-P2-07 | Codex | 2026-07-28 | Main-owned GitHub read、typed completeness/capability/readiness、bounded content、host-api/MCP/四语 UI 与 fake-provider Main-path E2E 全绿 |
| FP-P2-09 | PR 评审写操作与乐观并发保护 | FP-P2 | P1 | done | — | FP-P2-08 | Codex | 2026-07-28 | action-bound approval、head SHA/version guard、partial/unknown reconciliation、四语 UI 与 fake-provider E2E 全绿；G4 转 P2-02 |
| FP-P2-10 | Merge readiness 硬门禁与受控合并实现 | FP-P2 | P1 | done | — | FP-P2-09 | Codex | 2026-07-28 | Main 即时复查、hard veto、五分钟单次 approval、expected-head sandbox merge、partial reconciliation 与 fake-provider E2E 全绿；G4 转 P2-02 |
| FP-P3-01 | 发布树卫生与 fresh manifest | FP-P3 | P0 | done | — | FP-P2-03（真人路径；fixture-grade 工程卫生例外已授权） | Codex | 2026-07-29 | clean ref-bound source/gate evidence + fresh Windows x64 package；42 个 Forge 关键源码覆盖；MergeBeacon exact parent/Apache-2.0/NOTICE；artifact/feed/release-info/secret/gh-auth 校验；versionSha 仍为 fixture residual |
| FP-P3-02 | 平台声明纠正（去 Windows ARM64） | FP-P3 | P0 | done | — | — | — | 2026-07-29 | release.yml/release-info/package-win-manual.yml/validate 脚本全绿；README 三语无 ARM64 声明 |
| FP-P3-03 | Clean Windows VM 安装/升级/回滚 | FP-P3 | P0 | engineering-validation-only | `engineering-validation-only` | FP-P3-01, FP-P3-02 | — | 2026-07-29 | G4/G5 降级；13 场景 checklist/VM 模板/证据目录结构保留；Hard lock 不解除；clean VM 不允许 fixture 代跑 |
| FP-P3-04 | DCS + GitHub Forge Controlled Preview 产物出闸 | FP-P3 | P0 | engineering-validation-only | `engineering-validation-only` | FP-P3-03 | — | 2026-07-29 | G5 降级；出闸前置清单 9 项/随包文档骨架/hash 核对脚本保留；Hard lock 不解除；出闸门禁不允许 fixture 代跑 |
| FP-P3-05 | openclaw_runtime dist 新鲜度守卫 | FP-P3 | P2 | done | — | — | — | 2026-07-29 | `assertRuntimeDistFresh` 在 electronApp fixture 启动前调用；touch src 反向验证 fail-fast 报错；恢复后 app-smoke 1 passed 5.4s |
| FP-P4-01 | SEKB assisted UI 独立毕业 | FP-P4 | P2 | deferred | ✅ | FP-P3-04 | — | 2026-07-26 | suggest→review→confirm/reject→retrieve 页面缺失 |
| FP-P4-02 | Browser supervised 独立毕业 | FP-P4 | P2 | deferred | ✅ | FP-P3-04 | — | 2026-07-26 | approval UI + objective executor + success verify |
| FP-P4-03 | VToken opt-in 毕业 | FP-P4 | P2 | deferred | — | FP-P0-01, TF-0014 | — | 2026-07-27 | `TF-0014/UAS-03` 先完成无状态装箱化；本任务只做产品 opt-in 毕业 |
| FP-P4-04 | Runtime Memory 保持 diagnostics-only | FP-P4 | P2 | deferred | — | TF-0006 | — | 2026-07-26 | 四件套齐备前不进生产注入 |
| FP-P4-05 | 统一 C1 门禁语料 | FP-P4 | P2 | backlog | — | — | — | 2026-07-26 | 源自 FP-P0-05：4 条手写 vs 32 条合成并存，C1 无单一 reduction 数字 |
| FP-P4-06 | 前序 program 文档勘误（去 VToken default-ON） | FP-P4 | P2 | backlog | — | — | — | 2026-07-26 | 源自 FP-P0-01：`TASK-P1-04.md:36,70` 仍记「default 1」 |
| FP-P4-07 | ja/ru 本地化补齐 | FP-P4 | P2 | backlog | — | — | — | 2026-07-26 | 源自 FP-P0-04：ack 五态与 hint 在 ja/ru 为英文占位（键位齐） |
| FP-P4-08 | 多平台与 PR 依赖图扩围裁决 | FP-P4 | P3 | deferred | ✅ | FP-P3-04 | — | 2026-07-27 | 基于 P2/P3 证据对 GitLab/Gitee/DAG/Queue 分别 continue/shrink/stop；不实现 adapter |

### 计数

| metric | value |
|--------|------:|
| tasks total | 43 |
| ready | 1 |
| backlog | 6 |
| in_progress | 0 |
| blocked | 1 |
| engineering-validation-only | 2 |
| deferred | 6 |
| done | 27 |

---

## 推荐执行序

```text
Wave 0 (本轮): 建 program 文档骨架 ← DONE
Wave 1 (FP-P0): FP-P0-01 ∥ FP-P0-02 → FP-P0-03 → FP-P0-04 → FP-P0-05
Wave 2 (FP-P1): FP-P1-01 → FP-P1-02 → FP-P1-03 → FP-P1-04 → FP-P1-05
                 可并行: FP-P1-06；收口 FP-P1-07 → FP-P1-08
Wave 3A (FP-P2 build): FP-P2-07 → FP-P2-08 → FP-P2-09 → FP-P2-10
Wave 3B (FP-P2 canary): FP-P2-01 → FP-P2-02 → FP-P2-04；同时收口 FP-P2-05/06 → FP-P2-03 联合裁决
Wave 4 (FP-P3): FP-P3-02 可提前；FP-P3-01 → FP-P3-03 → FP-P3-04
Wave 5 (FP-P4): 各组件独立门禁；FP-P4-08 只裁决 GitLab/Gitee/PR DAG 扩围
```

---

## 任务森林同步

本 program 与 task forest 的对应（执行 FP-P2-03 时刷新）：

| forest node | 关系 |
|-------------|------|
| `TF-0007` (in_progress, 50%) | 本 program 是其落地编排 |
| `TF-0009` (ready, 0%) | 对应 FP-P1/FP-P2 DCS + GitHub Forge 受控内测；在 `FP-P2-03` 用 proposal 统一刷新分面裁决和证据 |
| `TF-0006` (blocked) | 保持 blocked；不由本 program 解阻 |
| `TF-0010` (proposed) | 统一 Agent 后继全局任务；不由本 program 改为 in_progress |
| `TF-0011` (proposed) | 已 `depends_on TF-0009`；仅在 `FP-P3-04` 完成或用户正式暂停 P3 后另提 proposal 转 ready |
| `TF-0013` / `TF-0014` / `TF-0018` | 分别消费 `FP-P2-06` / `FP-P4-03` / `FP-P4-04` 的证据；禁止重复建立第二主线 |
| `TF-0011` / `TF-0012` | 在 P3 出闸后消费 `FP-P2-07` 来源/contract 证据；不得复制第二 patch/error 真源 |
| `FP-P4-08` | 任何 GitLab/Gitee/DAG continue 项只生成待确认 Task Forest proposal，不直接写正式图 |

### 统一 Agent 后继交接规则

1. `FP-P2-03` 必须把 DCS/Forge-read/review/merge 分面裁决、实际指标、stop condition、残留和 evidence URI 追加到统一 Agent 开发日志；
2. `continue` 或 `shrink` 只允许进入 FP-P3，不自动启动 UAS；`stop` 必须让 UAS 保持 proposed 并记录阻断原因；
3. `FP-P3-04` 出闸时记录 clean SHA、manifest、安装包 hash、回滚证据和已知限制，作为 `TF-0011/UAS-00` 的输入；
4. 后续 UAS 状态只通过 Task Forest proposal 修改，一次只推进一个 `status=ready` 节点。

---

## 开发日志（append-only）

规则：每个切片收口追加一行。`gates` 列写当轮已绿门禁（如 `G1,G2`）。禁止贴长设计或代码。

| when | task | slice | gates | result | note |
|------|------|-------|-------|--------|------|
| 2026-07-26 | — | program bootstrap | — | done | 依 Codex 审计沉淀 Phase 0–4 → 24 任务；STATUS + DoD + tasks/ 建立 |
| 2026-07-26 | FP-P0-01 | 1 决策 A/B/C | — | done | 选 A；等人工确认后开切片 2-5 |
| 2026-07-26 | FP-P0-01 | 2-5 收口 | G1,G2,G3,G5 | done | 启动层两处强注删净；G3 改道用 child 自报 launchEnv（主进程 bundle 单文件、submodule 不可 require）；`runtime.flags.ack` 需登记 SAFE_GATEWAY_METHODS 否则 readOnly 拒绝 |
| 2026-07-26 | FP-P0-02 | 1-5 收口 | G1,G2,G3,G5 | done | 裁定调用点不传 cfg 改 request 级解析（factory 快照会过期=任务书禁止项）；卡点已解：zod-schema 缺 contextEnhancement 叶子导致写配置后 gateway code=1 退出，属比空开关更严重缺陷，已补 |
| 2026-07-26 | FP-P0-03/04/05 | 实现+单测+E2E | G1,G2,G3(部分) | in_progress | 三任务实现与测试已绿（22/31/12 用例 + 2 条真 child E2E）；账目债 5.125x vs 4.5x 已统一为同公式异语料并双向标注；待补三份任务书记账与 G5 |
| 2026-07-26 | FP-P0-03/04/05 | 收口记账 | G1,G2,G3,G5 | done | 三份任务书 AC/Gate/Decision/Residuals 补齐；FP-P0-04 首跑 E2E 抓出 kebab/snake 命名致健康 flag 误判 rejected 已修；FP-P0-05 主动把「真实 turn 非零账目」从 G3 摘出转 FP-P1-11 不充绿 |
| 2026-07-26 | FP-P0 | 阶段出口验收 | — | **GO** | 验收人视角重跑全部命令（unit 6108+304、E2E 3 passed 10.7m、contract:check/i18n/lint:dcs/双 tsc 全绿）；DoD 六条假 done 逐条未犯；三处状态一致；11 条残留转 8 个新任务 ID。`git diff --check` 仓库级失败经核为前序文件、本阶段文件干净→转 FP-P3-01，不因此 NO-GO。GO 为 self-accept，独立复核转 FP-P0-08。defaultOn 仍 false，L3 真人仍 0 |
| 2026-07-26 | FP-P0-06 | 1-4 全切片收口 | G1,G2,G3,G5 | done | 普查差集：coding(10)/vtoken(7)/orchestration(2)/resilience(1)/memory.injectPilot(4) 全是「labels/help 有文案、类型有、schema 拒收→写入即 gateway code=1」；全补 schema；守卫=vitest 三方向 83 用例+lint:dcs DeepRequired 编译穷举；双向反向注入真失败；真 child E2E 1 passed（childPid 31916）。首跑 E2E 因 dist/entry.js 旧 bundle 假失败（恰好活体复现历史缺陷）→ 残留 FP-P3-05 |
| 2026-07-26 | FP-P0-07 | 1-3 全切片收口 | G1,G2,G5 | done | md 第 3 列 10 行逐字锁进 fixture `mdDefaultCell`+归一化映射+实现探针三方一致；反向改 working-memory 格为 `**true**` → 1 failed（错误信息含双方原文）；md 复原 byte-identical；G3 n/a 复核成立 |
| 2026-07-26 | FP-P1-01 | 1-5 全切片收口 | G1,G2,G3,G5 | done | Setup 增 Provider/Model 验证步（四态失败分类+可操作文案）；skip 记 skipped+Complete 受限横幅+chat 首发拦截；E2E 不 mock 校验请求（真本地 HTTP 端点+真 401/真拒连）2 passed；发现前置既有 tsc-node TS6307（clean HEAD 复现）记入 FP-P3-01 |
| 2026-07-26 | FP-P1-09 | 1-4 全切片收口 | G1,G2,G3,G5 | done | ackWait 实测入档（真 Electron 内 5 个新 child pid；独立脚本测出 child 在 Electron 外不监听端口→弃用其数据）；60s=4.7× 实测 max；指数退避 -84% RPC；requery 130ms applied 同 pid 未重启；18 条旧超时单测零修改全绿 |
| 2026-07-26 | FP-P1-02 | 1-5 全切片收口 | G1,G2,G3,G5 | done | preflight 六检查（realpath 后判定）+Setup Workspace 步+显式双档权限；单一 workspace 权威（rootPath 钉进 agents.defaults.workspace）；越界 denial 现名示边界；E2E 真 host 写路径界内成功/越界+穿越拒绝且盘上无文件 |
| 2026-07-27 | FP-P1-03 | 1-6 全切片收口 | G1,G2,G3,G5 | done | 接手前实现已在树上（combo/prereq/ack/kill/i18n/runbook）；本轮补齐证据：E2E 四阶段 1 passed 10.4m、21 单测、contract/i18n 全绿。为过 G1 修掉 runbook 两处 markdown hard-break 尾空格。漂移：组合定义在 `prod-flags-control.ts:373` 非任务书写的 catalog |
| 2026-07-27 | FP-P1-04 | 1-7 实现（verify/diff/观测/lineage） | G1,G2(部分) | in_progress | 补齐三处真缺口：① verify 段 test-runner 探测全新模块（node/pytest/cargo/go，skip 必带理由，22 单测+反向注入真失败）② diff/verify 证据从 details 抬进会话可见文本（此前 extractToolResultText 只读 content，编辑只显示一句成功语）③ read 段 context_read/search 补 hit/miss 观测 + journal lineage 补 requestId/flags。E2E 首跑抓出**测试脚手架**缺陷：runtime 会把 tool_call_id 去连字符（call-read→callread），mock 按原 id 匹配→无限重发 2142 次，已改按 sanitize 后前缀匹配并加 40 次 loop guard
| 2026-07-27 | FP-P1-04 | 收口 | G1,G2,G3,G5 | done | E2E 从 3 次失败到 1 passed 32.1s；三次失败全为测试脚手架缺陷（id 去连字符无限重发、working-memory 注入夺走 marker、pretty-print JSON 断言），产品行为均正确。diff 可见性根因=投影层 `chat-display-projection.ts:472` 删 details，emit 层拼接无效已回退，改走 content 后 Work panel 实证渲染。单测 1133+76 全绿。**FP-P1-11 的真 turn 非零账目锚点同轮取得**（turns:1/applied 6000/truncated 2000/dropAlerts 1）
| 2026-07-27 | FP-P1-11 | 1-4 + 收口复核 | G1,G2 | in_progress | 真 turn 非零账目达成（求和 6000+0+2000=8000 在聚合与 lastTurn 双层成立），新增 `injectionBudget.lastTurn` 逐通道证据面。**收口复核改判不标 done**：穷举 charge 点后确认 knowledge/working_memory/tool_registry 三通道全仓无 charge 点 —— DCS 三块注入既不受共享预算约束也不被记账，比原以为的「配置没开」严重。拒绝为凑 AC4 打开 VToken/RM（Hard locks 排除项）。缺口转 FP-P2-06 |
| 2026-07-27 | FP-P1-06 | 1-6 收口 | G1,G2,G3,G5 | done | 接手时实现已在树上未验证；跑通并补齐两条缺失断言（源码正文不外泄、体积上限具名截断）。反向注入证脱敏守卫非空转。E2E 1 passed 30.4s |
| 2026-07-27 | FP-P1-10 | 1-4 收口 | G1,G2,G3,G5 | done | 逐 flag 四类归因（env/config/default/kill）落地，真 child 实证同值不同源。顺带查出预览开关 spec Phase C 独立 flaky（5 跑 3 败，与本改动无关）→ 新建 FP-P1-12，出口门禁前必须治 |
| 2026-07-27 | FP-P1-12 | 1-4 收口 | G1,G2,G3,G5 | done | 出口门禁前置抖动已治：冷却抑制不再静默丢弃合法配置变更，改为等待后真重启。E2E 由 5 跑 3 败变 3 跑 3 绿。这是产品缺陷非测试问题——真人快速开→关走同一路径 |
| 2026-07-27 | FP-P4-08–13 | MergeBeacon Git 能力调研任务化 | — | deferred | 新增来源冻结、structured patch/error、GitHub Forge 只读、review mutation、merge hard gate/canary、多平台/DAG 裁决六任务；不改 FP-P1 active/next，不 apply Task Forest |
| 2026-07-27 | FP-P2-07–10 / FP-P4-08 | 按用户澄清重新编排 | — | backlog/deferred | 核心 GitHub contract/read/review/merge 前移 P2，与 P2-01/02/03 同版本、同 charter、同真人 canary 和联合裁决；P3 合并发布/降级/凭据验收；P4 仅留多平台/DAG 扩围。上一行 P4-08–13 方案由本行 supersede；正式 Task Forest 未 apply |
| 2026-07-27 | FP-P1-04 / FP-P2-07 | diff 残留归并与编号冲突修正 | — | backlog | 原建议编号 FP-P4-08 已被多平台扩围正式占用；DCS `edit` 富 diff 与全文件 `write` diff 并入 P2 shared patch consumer 迁移，与 Forge structured diff 同开发、同 E2E 验收 |
| 2026-07-27 | FP-P1 接管审计 | 状态与现有证据对齐 | — | in_progress | 复核 12 个任务书、artifact 与新增测试：8 done；FP-P1-05 已开工但 E2E `1 failed` 且 spec parse error，改为 active in_progress；FP-P1-07/08 仍 backlog；FP-P1-11 剩余范围已完整转 FP-P2-06，改 deferred；P1 不满足出口条件 |
| 2026-07-27 | FP-P1-05 | 1-5 收口 | G1,G2,G3,G5 | done | 真 Electron 七场景 E2E 1 passed (1.9m)，kill 6980ms；补 N->N-1 fail-closed、真实 journal/undo、restart failure/recovery；修复 clean runtime build 缺 bundled provider 产物并新增 Gateway `/readyz` 冒烟。active 转 FP-P1-07 |
| 2026-07-28 | FP-P1-07 | 1-4 自动化收口 | G1,G2,G3,G4(n/a) | in_progress | 精确真 Electron/Gateway spec 4 passed (2.6m)；成功主链、restart 后 undo、support bundle 与六类失败均有证据。独立 G5 保留给非实现人 |
| 2026-07-28 | FP-P1-08 | 1-5 工程与证据收口 | G1,G2,G3,G4(n/a) | in_progress | 产品叙事与四语文案收敛；60+39 tests、contract、i18n、claim scan 全绿，0 current violations/0 skipped。登记 engineering-only 时序偏差；G5 未通过 |
| 2026-07-28 | FP-P2-07 | 1 来源/许可证 + Harness spec | G1(partial),G2(partial) | in_progress | 进入 pre-canary engineering；262-file snapshot manifest 与唯一共享 spec 落地，isolated Harness validate/contract/i18n 通过。exact parent SHA 未解析，禁止源码复制；controlled canary 未开始 |
| 2026-07-28 | FP-P1-08 | claim scan 收账复核 | G2 | in_progress | P2 spec/handoff/Task Forest proposal/治理字段加入后基线刷新为 16 current surfaces、686 paths、6386 historical/governance matches；0 current violations / 0 skipped，G5 状态不变 |
| 2026-07-28 | FP-P2-07 | slice 1 可交付性复核 | — | in_progress | `artifacts/*` 当前忽略 P2-07 manifest/evidence/log 且三者未跟踪；已登记风险，不改 ignore policy、不 stage；正式 change set 前必须显式纳入 |
| 2026-07-28 | FP-P2-07 | 2 Contract 与兼容策略 | G1(partial),G2(partial) | in_progress | 唯一 `GitPatchArtifact/v1` / `RemoteForgeError/v1`、strict decoder 与迁移矩阵落地；10 focused tests、standalone strict TS、contract、i18n、Harness structural validate 通过。无 consumer/UI/远端副作用；下一切片 parser/adapter |
| 2026-07-28 | FP-P2-07 | consolidation 可交付性复核 | — | in_progress | 42 个 First Product evidence 文件已显式纳入提交 `918ed8abd` 并推送至 `origin/main`；其中 P1-07/08 与 P2-07 的 10 个重点 artifact 均已跟踪。下一切片仍为 parser/adapter |
| 2026-07-28 | FP-P2-07 | 3 标准化 parser/adapter | G1(partial),G2(partial) | in_progress | 显式 source completeness、1 MiB/128 files/4096 hunks/120k lines 上限、唯一 v1 映射和边界 corpus 落地；12 focused / 22 contract+adapter tests、targeted ESLint、standalone strict TS 通过。无 consumer/UI/远端副作用；下一切片为 consumer migration |
| 2026-07-28 | FP-P2-07 | 4 consumer migration | G1(partial),G2(partial),G3(partial) | in_progress | Git/Code Review/DCS edit 接入唯一 adapter；超限、malformed、truncated、status/lineage mismatch fail closed；48 root + 54 runtime tests、build、Code Review E2E、contract/i18n/comms/Harness 全绿。无远端副作用；下一切片 rich diff/text fallback |
| 2026-07-28 | FP-P2-07 | 5 edit/write rich diff + text fallback | G1(partial),G2(partial),G3(partial) | in_progress | full-file write 以 journal before + verified after 生成真实 diff；Gateway/Renderer 对 missing、stale、truncated、unknown schema/lineage fail closed；26 root + 50 runtime tests、runtime/Vite build、真实 Gateway Electron E2E、contract/i18n/comms/Harness 全绿。无远端副作用；下一切片 error envelope/redaction/negative tests |
| 2026-07-28 | FP-P2-07 | 6 error envelope / redaction / negative tests | G1,G2,G3,G4(n/a),G5 | done | Git/Code Review/DCS/Renderer 统一 canonical `RemoteForgeError/v1`；敏感 payload、malformed/unknown/oversize/status/retryability/requestId 反向测试全绿；runtime/Vite/Electron/Harness/comms 全绿。active 转 FP-P2-08 |
| 2026-07-28 | FP-P2-08 | 1-5 GitHub read control plane | G1,G2,G3,G4(n/a),G5 | done | Main-owned bounded read、typed completeness/capability/readiness、host-api/MCP、四语 Code Review UI 与 fake-provider Main-path E2E 收口；unknown 不升级为 supported/ready。active 转 FP-P2-09 |
| 2026-07-28 | FP-P2-09 | 1-5 review/comment/metadata mutation | G1,G2,G3,G4(n/a),G5 | done | 一次性 action-bound approval、head/version OCC、最小 comment snapshot、partial/unknown reconciliation、四语 draft-first UI 与 fake-provider Main-path E2E 收口；99 focused tests 与全门禁通过。active 转 FP-P2-10 |
| 2026-07-28 | FP-P2-10 | 1-5 readiness hard-veto / controlled merge | G1,G2,G3,G4(n/a),G5 | done | Main 动作前即时重读、五分钟单次 approval、expected-head sandbox merge、Agent default-off、partial reconciliation 与四语 UI 收口；114 focused tests、fresh runtime/Vite build、fake-provider E2E 3/3、Code Review E2E 1/1 及全门禁通过。active 转 FP-P2-05 |
| 2026-07-28 | FP-P2-05 | 1-4 auto verify execution / visible projection | G1,G2,G3,G4(n/a),G5 | done | 最终 effective exec 复用既有 policy/approval/sandbox/timeout；nearest project/custom runner 与八类结果收口；101 runtime + 20 root focused tests、fresh builds、真 child E2E 可见 `AUTO_VERIFY_PASS` 全绿。active 转 FP-P2-06 |
| 2026-07-28 | FP-P2-06 | 1-6 三通道归因与显式降级 | G1,G2,G3,G4(n/a),G5 | done | knowledge/working_memory/tool_registry 进入同一真实 turn ledger；固定 6000 内为 DCS 保留既有 2000，CVK 显式截断到 4000；provider 实测 284/162/1554 与逐通道账目一致，fresh runtime/Electron E2E 与全门禁通过 |
| 2026-07-28 | FP-P2-01/02 | 真人阶段模板与阻塞收口 | — | blocked | charter、run record 与 Forge blocking matrix 模板已备；独立 G5、具名角色、fixed clean SHA、Provider/Model、sandbox/credential scope、预算/隐私/停止/回滚及 10 次真人执行不得代填 |
| 2026-07-28 | FP-P1-07/08 | 独立 G5 验收 | G1,G2,G3,G4(n/a),G5 | done | 独立 reviewer GLM-5.2（≠ 实现人 Codex/Claude）重跑全部门禁：FP-P1-07 E2E 4 passed (3.9m)、FP-P1-08 60+40 tests + contract + i18n + claim scan 全绿。修复 FP-P2-05 default-off 导致的 verify_tests 断言漂移。e2e-run.log 与 focused-gates.log 重新生成。P1 phase 出口 GO；不等于真人 canary/productApproved/default-on |
| 2026-07-29 | FP-P2-01/02/04/03 | FIXTURE 全链路模拟 | — | blocked (fixture) | 开发者授权 Agent 代跑，所有成果仅作参考不作为真实证据。生成 fixture charter 草案、10 个 fixture run records（notHumanProductChat=true）、fixture blocking matrix（9 类）、fixture 预算分析、fixture 裁决草案（4 分面 CONTINUE）、fixture Task Forest proposal（不 apply）。liveReady/productApproved/defaultOn 保持 false。真人接手时必须替换全部 fixture 数据并重新裁决 |
| 2026-07-29 | FP-P2-04 | 配置化工程完成 | G1,G2 | partial | zod-schema.ts 添加 `contextBlock.injectionBudget.{totalChars,dropAlertRatio}`；turn-injection-budget.ts 添加 `setTurnInjectionBudgetConfig`/getter；runtime-flag-ack.ts 使用 getter；17 tests passed（新增 4 配置覆盖测试）；contract:check + ClawX typecheck 全绿。默认值 6000/0.1 未变（Hard lock：待真人分布推导）。取值推导和真实分布仍待 FP-P2-02 真人数据 |
| 2026-07-29 | FP-P2-01/02/03 | engineering-validation-only 收口 | G2 (fixture structure) | engineering-validation-only | 独立开发者决策：safetyReviewer/productApprover 无法独立于实现，不追求真人双签/10 次任务/裁决签字。fixture charter/runs/blocking matrix/verdict/proposal 作为工程结构参考。clean SHA `bfa764b32` 已固定（含 FP-P2 全部工程改动）。`liveReady`/`productApproved`/`defaultOn` 保持 false。若未来引入外部 reviewer，可重新激活真人 canary 路径 |
| 2026-07-29 | FP-P3-02/05 | 工程任务收口 | G1,G2,G5 | done | FP-P3-02 上一轮已实施完成，本轮 status 对齐 done（release.yml/release-info/package-win-manual.yml/validate 脚本全绿）；FP-P3-05 本轮实施完成（`assertRuntimeDistFresh` 在 electronApp fixture 启动前调用，touch src 反向验证 fail-fast 报错，恢复后 app-smoke 1 passed 5.4s 守卫零开销） |
| 2026-07-29 | FP-P3-03/04 | 真人验收降级 | — | engineering-validation-only | 独立开发者决策：clean VM 13 场景（P3-03）与出闸门禁（P3-04）真人不可替代，G4/G5 从 required 降级为 engineering-validation-only；13 场景 checklist/VM 模板/证据目录结构/出闸前置清单 9 项/随包文档骨架/hash 核对脚本全部保留，不作 fixture 代跑（Hard lock 禁止）。P3 phase 出口仍受 03/04 真人证据阻塞 |
| 2026-07-29 | FP-P3-01 | fixture-grade release hygiene / fresh RC | G1,G2,G3,G4(n/a),G5 | done | baseline 改为 ref-bound clean SHA；42 个 FP-P2-07–10 Forge 关键源码进入 source manifest；MergeBeacon parent `14a17c7e...cd293`、snapshot SHA-256 `4e8255d3...152a4`、Apache-2.0/NOTICE/clean-room 声明已固化；完整 release gates 先于 fresh Windows x64 packaging；RC validator 核对 installer/latest.yml/release-info/app.asar/fuses、git/gh/gh-auth、credential/private-path/source-body。仅 fixture-grade，不改变 P3-03/04、P3 phase 或三个 false 开关 |

---

## 会话恢复检查清单

```text
[ ] 读 STATUS.md（本文件）
[ ] 复核 codeBaseline HEAD 与 hardLocks 仍成立
[ ] 打开 activeTaskId 或 nextTaskId 对应 tasks/FP-*.md
[ ] 只做一个切片
[ ] 逐条对齐 DEFINITION-OF-DONE 五门禁
[ ] 追加任务 Progress log + 本文件开发日志一行 + 注册表一行
[ ] 勿把实现细节写入 STATUS
```

## 路径

| 角色 | 路径 |
|------|------|
| 权威 STATUS | `docs/dev/first-product-controlled-preview/STATUS.md` |
| DoD | `docs/dev/first-product-controlled-preview/DEFINITION-OF-DONE.md` |
| 任务目录 | `docs/dev/first-product-controlled-preview/tasks/` |
| 前序 program | `docs/dev/dcs-visible-production/STATUS.md` |
| 真人证据落盘 | `artifacts/first-product-preview/<taskId>/` |
