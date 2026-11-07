**当前工作树已经实现可运行的持久任务执行切片，完整产品系统继续由 TF-0843 跟踪。** 源码位于 `D:/ClawX-work/durable-task-system-20261107`，分支为 `codex/durable-task-system-20261107`。

已实现：任务契约与来源持久化、revision 修订、业务键和精确契约去重、Git 工作树共享任务域、事务领取、会话与 run 互斥、epoch 拒绝旧写者、检查点、每次模型调用的目标恢复、暂停与交接、后台进程终态回读、文件/命令检查回执、验收状态、旧 Task Ledger 事件导入及四语界面。后续实现已将实际子代理派发前的 writer 转移和 registry 终态后的归还接入，父会话保留只读目标，未完成任务引用的工作树受到清理保护。

生产接线位于 Main Task Ledger/chat/delegation API、runtime before-tool-call、embedded model stream 和 `task_control` 工具。Task Forest skill 没有进入运行依赖。

完整系统还需要推进以下集成验收：

- 子代理 writer 协议已通过两棵真实工作树的持久状态测试，以及实际 spawn/registry 生命周期入口测试；继续补齐完整运行时构建和产品旅程验收。
- 既有通用 verifier/effect owner 的回执读取；当前 `owner-receipt` 验收返回明确拒绝，文件和命令类型已可执行。
- 非进程类外部效果的未知结果核对、取消与资源回收；无法回读的效果保留 pending。
- 相似意图推荐、层级目标拆分、项目组合调度、分页/历史压缩与持久 outbox；现有精确身份与依赖能力可作为基础。
- 完整 Runtime 构建及跨模型长会话配对评测。构建在 tsdown 阶段遇到 300 秒超时和 8 GiB V8 堆上限，退出 124；独立类型、相关回归和桌面 E2E 的结果单独保存。

完整 Runtime 构建提供 `OPENCLAW_TSDOWN_SERIAL=1`，逐个进程运行全部 17 个配置，最后仍为单一统一运行时图。Windows 的 Plugin SDK 声明使用已有 TypeScript 编译器输出，原生 tsgo 的目录创建失败原件保留；`OPENCLAW_PLUGIN_SDK_DTS_COMPILER=tsgo` 可显式选择原编译器。该构建模式保留插件、声明、导出与启动检查。

同机两棵真实 Git 工作树、16 个独立进程的领取实验得到 1 个成功、15 个拒绝。目标恢复测试覆盖连续十次历史压缩后的重建；测试工具通过真实子进程执行检查并消费 runtime 产生的终态。最终检查、命令退出码、性能数据和候选指纹保存在 `harness/specs/fixtures/durable-task-system/`，原始记录保存在 `D:/tmp/durable-task-system-20261107/`。

实现使用 SQLite WAL 与 FULL 同步。目标读取走索引点查；schema 只在初始化/迁移时创建；续租与工具操作登记合并为一个事务。性能结果按各次运行条件保留，不能将独立控制面微基准解释成完整模型执行收益。
