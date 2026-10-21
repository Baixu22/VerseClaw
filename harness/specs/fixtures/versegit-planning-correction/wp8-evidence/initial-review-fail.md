# WP8 initial independent review failure

- reviewer_model: ccs-agentrouter/gpt-6.1-sol
- driven_by: agent
- candidate_commit: c6a750c7fa6db46b795dabca513376781f97d045
- verdict: FAIL
- source: Codex agent thread 01a15fe9-514e-7740-9360-0f759944fb1d

**FAIL — P0：0；P1：5。不能据此关闭 TF-0465 的 host integration P1。**

审查候选为 `c6a750c7fa6db46b795dabca513376781f97d045`，tree 为 `b566c7be962f6cadbcedfa4a1a1bf6bad9c834d3`。指定八项输入均与候选提交逐字节一致。

实测结果：

| 检查 | 结果 |
|---|---|
| 指定 WP7 live verifier | exit **0**，normalized=`0122d8a06021` |
| VerseGit 相关单测 | **15 文件、82/82 通过**，含 WP7 3 项 |
| 当前 planning validator | exit **0** |
| 已有同 HEAD 干净 checkout 的 full-diff harness | exit **0**，`--since c0ff3d4cc`，覆盖 26 文件，未用 `--no-diff` |
| 主工作区 full-diff harness | exit **1**，范围外现存改动导致 |
| WP7 两份 SHA256SUMS | 各 **7/7 匹配** |
| WP6 / MC6 verifier | 均 exit **0** |

真实执行部分成立：两个活动 VG session、producer-consumer `ssi/stale-read`、own-write 阴性对照、Git 组合 candidate、两次真实 VerseShell verification、错误 receipt 拒绝及 continuation。Agent 模拟事件本身符合所有者政策；问题在于以下连接和验收断言。

1. **P1：fixed-argv provider 路径违反当前执行权威契约。**
   [invokeVg](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:298) 原生 `execFileSync` 执行 VG，Git 同样原生执行；[现行规则](/D:/ClawX/harness/specs/rules/versegit-validation-layer-extension-boundary.md:53)要求 host-mode 外部执行经 VerseShell。报告诚实披露了分路，但 [task 流程图](/D:/ClawX/harness/specs/tasks/versegit-wp7-host-vertical-slice.md:64)仍称 VG sessions/checks 经 VerseShell，TF-0513 requirements 也未同步。
   **修复：**按当前契约将相关外部执行接入 VerseShell；若保留分路，须先形成正式权限边界决策并同步规则、scenario、节点和 spec。仅写 limitation 不足以满足现行门禁。

2. **P1：宿主事件到 VG facts 的连接仍是两套手工驱动。**
   [事件注入](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:487)与后续 `vg observe` 参数分别硬编码，VG 调用没有消费 observation bridge 的输出；[VerseGitModule](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:677)直到清理后才创建并包装报告。`hostVerdictAfterFailure/After`也直接复制原值。
   **修复：**让同一宿主调度路径消费归一化事件、生成 provider 调用并处理 receipt/verdict；用故障注入验证实际宿主决策保持不变。无需外部模型或真人数据，但必须证明连接而非并列执行。

3. **P1：candidate 身份及验证输入绑定错误。**
   candidateId 使用 disposable 仓库 base，而[报告 baseOid](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:723)读取 ClawX 主仓。从保留字段重算 candidateId 得到 `8c45e4d9…`，与记录的 `9134c0e1…`不符。`verify.cjs`在 candidate 建立后写入，未纳入输入冻结；receipt 的 executionInputDigest 仅覆盖 argv/cwd/env。
   **修复：**统一使用 disposable base，保留可重算 candidate manifest；绑定验证脚本和实际输入内容，在验证前后检查漂移，并让 verifier 拒绝身份不一致。

4. **P1：回执与报告 verifier 可把自报数据升级为 verified。**
   [receipt validator](/D:/ClawX/electron/services/versegit-receipt-bridge.ts:126)检查 authority 字符串和摘要格式，没有回读实际 artifact。内存探针中，无 VerseShell 进程、无 artifact 的构造 receipt 被接受并输出 `observed/verified`。
   [WP7 validator](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:876)对“全部执行改成失败”及“两个身份合并”的重封报告均返回 `ok=true`。盘上也未保留完整 plan、receipt、observation/output，仅保留摘要；live replay 只比较简化 outcome。
   **修复：**从宿主可信 observation/artifact 来源重建回执，保留可回读且摘要绑定的执行证据；逐项检查调用成功、身份唯一性、plan/receipt/output 关系，并加入上述负向用例。探针全部只在内存运行。

5. **P1：零进程残留与失败清理证据不足。**
   [processSurvivors](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:638)来自 `shutdownAll()`后的 manager 表，而[shutdownAll](/D:/ClawX/openclaw_runtime/src/agents/verseshell/process-manager.ts:1263)先清空该表，因此 0 不是 OS 存活检查。证据在删除后才生成；[异常 finally](/D:/ClawX/scripts/versegit-wp7-host-vertical.mts:854)仍删除临时根并吞掉清理错误，无法保留失败现场或保证 barrier 失败时资源保全。
   **修复：**记录实际 PID/子进程并等待退出核验；清理前封存证据，清理后追加附件；失败写出 `recovery_required`及错误事实，屏障失败时保留资源。

**P2 可保留：**

- 非 Windows、未观测读面、`conflicts-plan unavailable`、debug sidecar、release-ineligible、非 GA/default-off、M4 unauthorized。
- Builder/verifier 共享逻辑；planning validator 对 MC6 done 只检查文件存在，执行验收仍须由 MC6 verifier承担。
- TF-0465 摘要仍保留 WP7 前的“缺 live receipt”等历史描述，应在后续聚合中标明时点。

TF-0481 历史审查：初版及中间 **FAIL**、最终上游容量阻塞均仍保留；未发现被改写成通过或 real-human。当前本地 planning SHA256SUMS 为 **12/12 匹配**，但 `manifest.inputs`仍有 **1 项 drift**；validator 摘要已刷新。偏差账本明确记录派生 manifest 更新，因此不能再称这份本地 manifest 是未改动的原始历史证据。实际 live PASS 可复跑，但它不证明上述缺失断言。

**本结论可以登记为 TF-0513 后、TF-0465 聚合前的独立 WP8 `FAIL` verdict；不能作为放行聚合或满足历史“至少 PASS_WITH_GAPS”的凭据。**

未编辑受审源码或证据、未提交、未人工清理或启动用户 VG 仓库。指定 verifier 仅在 disposable 仓库执行；该 pnpm 命令意外触发自动安装/hooks，已披露，后续检查改用现有 Node 入口。
