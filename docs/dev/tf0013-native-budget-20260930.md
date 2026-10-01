# TF-0013 原生 harness 共享预算开发增量

2026-09-30；actor: codex/root；driven_by: agent。

## 改动与契约

原生分发此前通过 `projectStandaloneCompassContext` 独立结算并释放 COMPASS 预算；Codex 插件随后调用 SDK 的 `assembleHarnessContextEngine`，将新增消息与 system addition 直接投影到 prompt/developer instructions。插件自己的 context-window 字符上限不是增强注入的共享预算。

本轮在既有 harness lifecycle 中保留一个 attempt 的 turn ledger，用 AsyncLocalStorage 传递既有 owner 的 turnId，不新增账本或 public SDK 参数。知识优先级高于 CVK，先投影的 COMPASS 收费保留到整个 attempt 结束；随后 SDK 组装将新增消息和 system addition 交给既有 ContextCandidate 仲裁。原生 engine 对象身份、注册 owner、生命周期方法不变。embedded 子运行显式退出原生 scope，避免继承父预算。

- 原样历史按既有精确多重集匹配免计费；新消息与改写按 JSON 字符数整组准入，超额保留原历史，system addition 使用同一剩余额度。
- 相同输入与相同组装结果的启动重试复用已准入投影；变化后的输出重新准入。缓存只保留一个上一结果，随 attempt 释放。
- 组装只收到历史副本；抛错修改不泄漏。kill switch 阻止调用 engine。正常结束和 harness 失败均释放集合与 ledger。
- 被预算缩减的结果移除原始 thread-bootstrap projection metadata，避免将未实际投影的完整 assembly fingerprint 绑定到持久线程。
- 6000 字符、0.1 阈值及所有产品锁不变。新增代码承担 SDK 调用之间的预算生命周期与失败隔离；复用原有仲裁和 ledger，没有第二套收费策略。

## 直接核读的依赖证据

已按 runtime scoped AGENTS 检查 sibling `../codex` 源码，固定在插件依赖对应的 `rust-v0.137.0`（`git rev-parse HEAD` 结果见 evidence.json），并非用当前主线代替锁定版本。

- `../codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs:135`：thread/start 的 `developer_instructions` 字段。
- `../codex/codex-rs/app-server-protocol/src/protocol/v2/turn.rs:66`：turn/start 的输入及 thread identity；该结构没有同层的任意 `developer_instructions` 字段，collaboration mode 是另一契约。
- `../codex/codex-rs/app-server/src/request_processors/thread_processor.rs:839`：接收 developer instructions，并在 866 行转入 thread config overrides。
- 本仓 `openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts:748` 调 SDK assemble，764 行处理 bootstrap metadata，767 行开始渲染组装消息与 system addition；819 行附近已有失败回退。该调用在最终插件投影前发生。
- `context-engine-projection.ts` 对历史做渲染、引用数据提示、工具载荷处理和 context-window 裁剪；这些行为未改。此次不改变 provider 协议或插件依赖。

## 验证与局限

最终开发门禁 13/13 exit 0，测试 178 项通过、0 失败：native SDK 9、embedded/扩展 48、候选与预算 115、entry scan 6；两侧类型检查、定向 lint/格式与 comms replay/compare 通过。一次 embedded 组合测试因连续 120 秒无输出被包装器终止（exit 1），保留在 `embedded-regression-idle-timeout.log` 和 `verification-before-idle-retry.json`；仅切换 verbose reporter 后同组 48/48 通过，耗时 138.125 秒，未放宽超时门槛或断言。刷新 origin 后 check-landing 仍为 183 项仓库历史问题、exit 1。

复现入口：`py -3 -X utf8 artifacts/tf0013-native-budget-20260930/verify.py`。逐门命令、退出码、耗时在 `verification.json`，原始日志同目录。native fixture 通过真实 `runAgentHarnessAttempt` 分发和公开 SDK 导出执行，不 mock 预算或仲裁函数；覆盖正常、超额、COMPASS 耗尽、纯历史、kill switch、重复/变化重试、并发隔离、embedded 子 scope 和失败释放。它使用 agent 驱动 fixture engine，不是外部 app-server/provider 运行。

Harness 全工作树 validate 首次 exit 1，唯一越界项是原有 `%SystemDrive%/` 下三个 Windows 缓存文件。复验只通过子进程 Git excludesFile 暂时排除该目录，继续检查实际 tracked/其他 untracked diff；没有改忽略规则、spec 断言或使用 `--no-diff`。磁盘报告明确记录该排除。

本轮核验 TF-0013 四项 acceptance：

| 条件 | 当前证据 | 仍需补齐 |
| --- | --- | --- |
| 一个最终 assembly authority | 既有 entry scan、候选仲裁测试；新增原生 SDK 同样调用 finalizer | 静态扫描是有限规则，不能证明任意未来插件不会绕过 SDK |
| 任意 source 不绕过总预算 | embedded、CLI/COMPASS、原生 dispatch/SDK 的开发反例与源码链 | 原生外部 app-server 最终请求/持久线程回放尚未本轮驱动，不能把 fixture 当成该证据 |
| working-memory、role-memory、CVK、VToken 组合 | 现有组合测试与 embedded 收据回归在本轮复跑 | 当前 dirty 工作树尚非干净候选收口证据 |
| flag-off/kill 零查询零注入 | 既有组合 flag 矩阵及新增原生 kill 零 engine 调用 | 不外推为未测试第三方插件的任意私有调用 |

因此本轮交付开发增量，TF-0013 保持 in_progress；不重签 RC-02/03/09/10，不声称 formal acceptance、发布或 GA。下一最小项是 agent 驱动原生 app-server 的最终请求与 bootstrap/retry 场景，随后冻结候选核验四项条件。无需真人 verdict 或真人数据。

README 三语、UAS-02 spec 和交接同步。已有 embedded 预算代码、共享图与 VerseConf 规划尚未提交，保留其改动，不创建混合提交或推送。正式收口仍要求当前干净候选和完整证据链。

提案 `TFP-tf0013-native-budget-development-20260930` 已应用，Task Forest validate/export 通过；`node-after.json` 核读为 in_progress/60%。导出仍为 `.agent-workbench/task-forest/exports/task-forest.html`。本轮为 implementer self-review，没有声称独立 agent 复审。
