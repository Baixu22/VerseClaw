U4 源码复核：`1ce245ee69ef6d30a38365f12ee58848624ea91d`，基线 `390e39259429255b6712c84440be4f567e2ec25d`。

driven_by: agent
actor: codex-u4-relay-01a1c454

本次复核读取 U4 增量和实际调用方；最终验收结果另由同候选 Electron 原件决定。

- `sessions-api.ts` 的 worker history 在读前、读后和干预回执查询后核对同一 session generation。代次查询使用既有 Gateway 预算，GatewayManager 仍将每个 RPC 限制在调用方剩余截止时间内。
- `task-system-service.ts` 的 task owner 读取在两次 generation 核验之间取得原 TaskSystemStore 的 task、revision 与验证记录。Task owner 不可用时面板保留 transcript，将业务验收显示为不可用。
- `SessionDelegationStatus.tsx` 把业务验收绑定到 canonical task 状态；验证回执只统计当前 task/revision 的同一 epoch/candidate，不将 recorded 数量作为验收决定。worker 准入不借用另一 child 的回执。
- 两个 worker 面板从结构化 transcript 读取实际模型与费用；缺失/null 费用显示未知，明确的零保持零。显示作用域绑定 workspace、parent、child 和当前 generation，晚到请求通过版本核验丢弃。
- `task-ledger-service.ts` 的读取先重建 owner 数据，再尝试无需等待的缓存刷新。缓存锁忙时保留 owner 结果和锁；明确缓存写入继续串行。事件或合同读取失败仍返回失败。
- `chat.ts` 的后台队列只在 `chat.send` owner 接收后完成原队列项；拒绝或缺回执时恢复原消息。原重复 drain 实现已移除，注册统一回调。
- 反向 task-scope 准入沿用 main 已有的独立 20 秒 deadline，U4 不再保留第二个脱离截止时间的 helper。对应回归同时核对请求独立性与原 caller context 保持。
- Electron 诊断取数限制为 5 秒。进程清理首次尝试之后仅重新读取原 PID/creationTime，不重复执行未知终止；持续未知或存活仍使清理失败。

Main 三方预案中的功能叠加为 checkpoint `taskLedgerRootId` 映射与对应断言；README 和四语文本叠加按各自工作字节保留。最终整合前重新核对主线 HEAD、索引和每个拟写文件。
