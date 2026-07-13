# REBUILD 闭环协议（每次 loop 迭代的固定动作序列）

> 你是 context-engine rebuild 自主闭环的执行者，在 `ClawX-context-engine-rebuild` worktree、分支 `context-engine-rebuild` 施工。
> 本协议是**机械步骤**，不是建议。每次醒来严格按 STEP 0→6 执行。禁止跳步，禁止自由发挥。

## 三份文档的权威顺序（冲突时）
1. 本协议（怎么跑闭环）
2. [PROGRESS](./CONTEXT_ENGINE_REBUILD_PROGRESS.md)（我到哪了 / 硬验收门禁 / 唯一可变状态）
3. [ALIGNMENT](./CONTEXT_ENGINE_REBUILD_ALIGNMENT.md)（现实校正，覆盖 SPEC）
4. [SPEC](./CONTEXT_ENGINE_REBUILD_SPEC.md)（架构理念 + cp 出处，被上面三者覆盖时以上面为准）

---

## STEP 0 — 定位（每次必做，不许凭记忆）
- 读 PROGRESS.md，取 `CURRENT_TASK` 和 `LOOP_STATUS`。
- 若 `LOOP_STATUS != running` → 直接跳 STEP 6 停机分支。
- `git -C <worktree> status --short` 看上轮残留，`git log --oneline -5` 看已落地的提交。心里对齐"账本说的"和"代码真实的"，不一致时**以代码为准并修正账本**。

## STEP 1 — 读该任务的硬验收门禁
- 从 PROGRESS.md「各任务硬验收门禁」找当前任务的验收项。**这是本轮的终点线，先看终点再动手。**
- 读 ALIGNMENT + SPEC 里该任务对应段落（Task 字母对照 ALIGNMENT 校正5）。

## STEP 2 — 干活（受约束）
- 严格按 SPEC 附录 A 的 cp 清单：`[CP]` 直接抄 ragcode 文件（顶部加 MIT attribution 注释）、`[语义]` 按本地类型重写、`[禁止]` 绝不碰。ragcode 源在 `C:/Users/27933/Desktop/verseshell/ragcode-main/`。
- **三层铁律**（SPEC §2）：Producer 只写 FactStore；View 只读 FactStore；两者不互调。违反即技术债，重做。
- **灰度铁律**（ALIGNMENT 校正6）：新 View provider 一律先 `shadowOnly:true` 注册。转权威只在 Task I、且有 shadow 比对证据后。
- 只改当前任务范围内的文件。手痒想顺手改别处 → 记进 PROGRESS「SPEC-GAP 待决清单」，不要动。

## STEP 3 — 硬验收（防自我感动，最重要一步）
- 逐条跑当前任务的验收命令（测试/typecheck/脚本），**把真实命令和真实输出贴进 PROGRESS 运行日志**。
- 通过标准：命令退出码 0 且输出符合门禁描述。**"我觉得实现对了"不算通过；测试没跑不算通过；跑了失败不算通过。**
- typecheck 基线：`pnpm --filter openclaw_runtime typecheck`（或仓库实际等价命令，A 轮摸底时确认真实命令并记进 SEAM_MAP）。
- 任何一条不过 → STEP 4 失败分支。全过 → STEP 4 成功分支。

## STEP 4 — 回写账本（诚实）
**成功**（全部验收通过）：
- 当前任务状态置 `done`，连续失败次数归 0。
- 该任务连续失败次数字段清 0。
- `git add -A && git commit -m "rebuild(<task>): <一句话> "`（提交信息末尾附 Co-Authored-By: Claude <noreply@anthropic.com>）。提交 = 每个任务的还原点。
- 选下一个**依赖已全 done** 的 pending 任务作新 `CURRENT_TASK`（按 A→I 序）。全部 done → `LOOP_STATUS: done`。
- 运行日志 append：`迭代N | Task X done | <验收命令摘要> | commit <hash>`。

**失败**（有验收不过）：
- 当前任务保持 `in_progress`，该任务「连续失败次数」+1。
- 运行日志 append：`迭代N | Task X 失败 | <哪条验收不过 + 关键报错> | 下轮打算怎么修`。
- **不提交**失败代码（除非是能 typecheck 的中间态且明确标注 WIP）。

## STEP 5 — 停机条件判断（三选一，命中即停）
1. **全绿收尾**：所有任务 done → 执行 STEP 6 收尾分支。
2. **需人拍板**：出现 `SPEC-GAP` 且它阻塞当前任务无法绕过 → `LOOP_STATUS: blocked`，`BLOCKED_REASON` 写清，停机等人。
   - 什么算需人拍板：架构决策 SPEC/ALIGNMENT 都没覆盖、要动 `[禁止]` 清单、要改冻结契约、Windows 原生模块装不上、parity 差异需人判定取舍。
   - 什么**不**算（自己扛，别停）：普通编译错、测试写法、cp 后的类型适配、找文件、常规调试。
3. **反复失败**：任一任务「连续失败次数」≥ 5 → `LOOP_STATUS: blocked`，BLOCKED_REASON 写明卡点，停机等人。
- 都没命中 → 继续下一迭代（STEP 0）。

## STEP 6 — 停机分支
- **done 收尾**：核对 PROGRESS 的 DoD §10 五条逐条贴证据；跑一次全量 typecheck + 全量测试贴输出；写一段《rebuild 完成报告》进 PROGRESS 末尾（做了什么、验收证据、codegraph 退役确认、遗留 SPEC-GAP 若有）。然后结束，不再迭代。
- **blocked 停机**：确保 BLOCKED_REASON 和相关 SPEC-GAP 写清，代码处于能 typecheck 的状态（或明确标 WIP），把"人需要做什么决定"一句话讲明。然后结束等人。

---

## 不变量（每轮都要守住，违反=技术债=重做）
- 一份 `.sqlite`、一个新鲜度时钟。绝不引入第二份代码事实索引。
- 热路径（query→fact→pack）零跨进程/MCP 往返。
- 每个新 View 先 shadow 后权威，provenance 是转权威的前置证据。
- 账本诚实：done 必有验收输出；失败必如实记。宁可慢，不可假绿。
- 每个 done 任务必有一个 git commit 还原点。
- 不碰 `[禁止]` 清单（MCP server/CLI/web/agents/memory/config/整个 embedding 层）。
