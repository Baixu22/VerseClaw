# 会话与持久任务机制：七项修复

源码候选：`86d3f05288d395402e4f9d8aceb6a6551935a01a`，树：`0f0ebb391fc1056f0119841d6793804e955886e2`。整合基线：`c68893a89350b8053bb5ab8a8618b42c1a46b8bc`。日期：2026-11-25，Asia/Shanghai。

| 问题 | 修复后的行为 |
|---|---|
| 取消提前释放领取 | 活动运行和在途效果共同参与结算；匹配代次的停止回执后释放 writer。 |
| 恢复后任务身份陈旧 | writer 和只读 reference 分别迁移到新会话代次；部分迁移重试幂等，未归还的委派拒绝恢复。 |
| 历史等待后的消息串入 | 发送只更新原会话缓存；workspace、会话代次、发送代次及消息身份隔离迟到结果。 |
| 旧工作区操作覆盖新列表 | 任务操作与读取令牌绑定原工作区/会话；旧回调不再启动旧视图刷新。 |
| 只读工具前后判定冲突 | Runtime 与工具前置边界使用同一工具及参数策略；未知工具、写入及 Git 全局配置覆盖继续受控。 |
| agent 恢复后凭证失效 | 新恢复运行保留其已读取的暂停 epoch；暂停前的旧运行继续拒绝。 |
| 准入扫描全量任务历史 | 资格按指定 Task 点查；UI 全量投影使用 Map/Set 合并。 |

## 同源验证

- r16：12 份单测文件，219/219 通过；完整 Main/Web/Test 类型、定向 lint、桌面构建、契约、通信回放/比较及差异感知 Harness validate/dry-run 通过。
- r14 Electron：6/6 通过。使用实际本地 Runtime 和本地 scripted provider，均为 `driven_by: agent`；覆盖活动模型取消、归档恢复、新旧身份拒绝、fork 只读历史、agent resume 实际写文件、迟到任务/历史回复、草稿页面往返、接力后台清理、同文本新编辑保留及持久草稿恢复。
- Electron source guard 与进程清理通过。取消验证在释放本地模型挂起响应前，等待原 sessionId 的展示活动标记结清；`sessions.stop` 本身等待 embedded run 结束及 `drainScope`。
- Runtime 完整构建及 gateway smoke 复用 r6：6 份 Runtime/共享任务源的字节与最终候选一致；桌面和 Main 构建在 r16 重新完成。
- 指定 `ccs-workbuddy/deepseek-v4.1-flash` 返回有效核心及最终草稿审查。最终审查提到的六条待完成验证已由 r16 / r14 的磁盘回执补齐。

单测复用同一配置入口；实际 JSON 输出路径保留在 `unit-final-r16.stdout.log`。`unit-results.json` 按该记录复制原始输出字节，计数和执行时段对应 r16。

## 任务规模样本

| 合成任务数 | 实际准入中位数 | 全量 UI 快照中位数 | 准入期间全量快照调用数 |
|---:|---:|---:|---:|
| 1,000 | 35.738 ms | 142.102 ms | 0 |
| 10,000 | 28.985 ms | 2,263.145 ms | 0 |

同机 D 盘样本分别保存于 `scale-1000.json`、`scale-10000.json`；准入与快照分开测量。任务准入从全量投影路径移出。

原始审查及首次复现：`D:/tmp/clawx-session-task-review-20261125`。修复过程、WorkBuddy 增量意见、首次失败、trace 与截图：`D:/tmp/session-task-fixes-20261125-01a21019`。接力草稿的后台残留及跨挂载可见残留均先保存真实失败，再补充回归。

`report.json` 保存逐项命令、退出码、源码及证据绑定；`sources.json` 保存 29 份源码的工作区 SHA256 和 Git blob；`integrity.json` 校核精选证据的原始字节。
