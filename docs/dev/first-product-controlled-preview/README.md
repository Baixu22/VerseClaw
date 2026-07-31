# first-product-controlled-preview

把「Engineering P0 complete」推进到**第一个真正可交付的产品**：

> **Verse Claw Windows x64 · DCS Coding + GitHub Forge Controlled Preview**
> 内部、单 workspace、显式 opt-in、可回滚。

本 program 是 `dcs-visible-production`（M0/M1 已闭环）的后继。前者证明「wiring + 门禁」，本者证明「真人能从安装走到第一次成功编码任务，并且开关、写入、回滚、支持包都可解释」。

## 布局

| path | 角色 |
|------|------|
| [STATUS.md](./STATUS.md) | **仅元数据**：阶段、任务注册表、门禁状态、锁 |
| [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md) | 五门禁 DoD（开发→测试→验收全流程） |
| [tasks/](./tasks/) | 一任务一文档：切片 / 验收 / 证据 / 日志 |
| [tasks/README.md](./tasks/README.md) | 任务索引 |
| [MERGEBEACON-GIT-CAPABILITY-ADOPTION.md](./MERGEBEACON-GIT-CAPABILITY-ADOPTION.md) | Remote Forge / structured patch 能力引入调研基线与 P2/P3 联合开发验收链 |
| [`../unified-agent-system/DEVELOPMENT-LOG.zh-CN.md`](../unified-agent-system/DEVELOPMENT-LOG.zh-CN.md) | Preview 收口后的统一 Agent 后继任务与长期开发日志 |
| `../dcs-visible-production/STATUS.md` | 前序 program（只读参考） |

## 毕业顺序（每个箭头都要独立证据，禁止跨级）

```text
P0 engineering green   ← 已达成（前序 program）
→ Controlled Preview   ← 本 program 目标
→ P1 limited canary
→ liveReady
→ productApproved
→ per-surface default graduation
→ joint GA
```

## 阶段

| phase | 名称 | 出口条件 |
|-------|------|----------|
| `FP-P0` | 运行契约 | 启动层默认值与 runtime/docs/tests 一致；kill 路径可证明切断 |
| `FP-P1` | 首产品纵向链路 | 安装 → 第一次成功编码任务 → undo/restart/kill/support bundle 全通 |
| `FP-P2` | 真实受控 canary | GitHub Forge 核心能力完成开发；≥10 次真人 DCS coding + Forge 联合记录；分面 continue/shrink/stop |
| `FP-P3` | 发布候选 | clean SHA + fresh manifest + Windows x64 安装/升级/回滚 + Forge 缺失/认证/凭据证据 |
| `FP-P4` | 关联组件独立毕业 | SEKB / Browser / VToken / RM 独立门禁；GitLab/Gitee/PR DAG 仅做扩围裁决 |

## 首发范围（硬边界）

**纳入**：DCS context read/search/view、指定 workspace 受控写入、write journal + undo、workspace/permission authority、token/latency/outcome 最小观测、runtime acknowledgement、restart/recovery、kill/rollback、脱敏 support bundle；FP-P2 起纳入 structured patch、GitHub Forge read/review 和 sandbox approval-bound merge canary。

**排除**：Runtime Memory 注入、SEKB 自动写回、Browser 无监督/私网、VToken 默认能力、C6 自动 context ladder、C7 knowledge/routing cutover、WAL、默认 worktree、默认 patch-flow、生产 repository 自动 merge、GitLab/Gitee/PR DAG 实现、联合系统 GA。

## 丢上下文后恢复

1. 读 `STATUS.md`
2. 打开 `activeTaskId` 或 `nextTaskId` 对应 `tasks/FP-*.md`
3. 只做**一个切片**
4. 追加任务 Progress log + 更新 STATUS 一行

## 后继闭环

本 program 与统一 Agent 主线按以下顺序衔接，二者不得并行扩面或复制任务：

```text
FP-P1 首产品纵向链路
  -> FP-P2 真实受控 canary
  -> FP-P2-03 continue/shrink/stop 裁决并刷新 TF-0009
  -> FP-P3 Controlled Preview 出闸，或由用户正式暂停并记录原因
  -> TF-0011 / UAS-00 证据冻结
  -> TF-0012 ... TF-0019 严格串行
```

- `FP-P2-03` 是 Preview 证据进入统一 Agent 开发日志和 Task Forest 的正式交接点；
- `FP-P3-04` 是产品交付基线进入 `TF-0011/UAS-00` 的正式出闸点；
- `FP-P2-06`、`FP-P4-03`、`FP-P4-04` 只交付 Preview 范围证据，不另建与 `TF-0013`、`TF-0014`、`TF-0018` 重复的基础设施主线；
- `FP-P2-07`–`FP-P2-10` 是 MergeBeacon 调研派生的 GitHub Forge 开发链；`FP-P2-07` 同时收口 DCS 编辑 diff 富渲染与全文件 `write` diff 残留，它们先于 canary charter，随后由 `FP-P2-02/03` 与 DCS 一起验收、裁决和刷新 `TF-0009`；
- `FP-P4-08` 只消费 P2/P3 证据裁决 GitLab/Gitee/PR DAG 扩围，不在本 program 内直接实现 adapter；
- `TF-0009` 当前为 `degraded-agent-complete` / `review_needed`，不等于真人完成。其 agent 工程基线以非阻塞 `derived_from` 关系交给已完成的 `TF-0011`；当前后继唯一 ready 叶节点为 `TF-0012`。该解耦和串行推进不改变任何真人/live/product 门。

## 禁止

- 把长设计/代码贴进 STATUS
- 一个 markdown 塞多个任务
- 翻默认值来「证明可用」
- 用单测 / E2E / Agent Dev green 冒充 live 或 product 证据
- 在 DoD 五门禁未全绿时标 `done`
- 在 `FP-P2-03`/`FP-P3-04` 未完成交接前启动 UAS 实现
