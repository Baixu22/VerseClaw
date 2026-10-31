# Change Context 的受控启用与回滚

当前范围是 Windows 源码宿主 Electron 的本地审查闭环，所有验收操作由 agent
驱动。最终候选与可回读结果见 [验收证据](tf0619-acceptance.json)，原验收计划
见 [Electron 计划](e2e-plan.md)。此前 TF-0616–0618 的报告继续标识各自的历史候选。

## 启用入口

在 Review Center 或工作区的审查面板展开「变更上下文（高级）」，选择会话和
比较模式，再点击加载。入口初始折叠；展开本身不加载上下文。没有后台轮询、
自动启用或持久化的启用开关。切换工作区也会重建默认关闭的视图。

评论存储是 Main 的 `change-context-review-comments`，最多 2,000 条、每条最多
20,000 字符，达到容量后拒绝新增。评论及删除 tombstone 保留，禁止静默淘汰。
投影缓存最多 100 条、TTL 为 15 分钟；缓存没有任务、执行、审批或 Git 权威。
approve/comment-only 不完成任务；request changes 只引用或创建一个 review 待办。

VG 证据沿用 `CLAWX_VERSGIT_BINDING_ENABLED=1`。未设置或不为 `1` 时事实读取器
调用为零；启用后只读既有事实，缺少候选绑定回执仍是 partial/unmeasured，
提示保持 advisory，host verdict 不变，不执行 verifier、land/admit 或 M4。

## 回滚入口

再次点击高级入口将其关闭，清除本窗口的上下文、评论视图和 review 结论。
重新加载窗口后入口恢复关闭。关闭后操作原审查表单、再重新加载，不增加
Change Context API 调用。这一回滚保留评论、Task Ledger 引用、目标文件和 journal。
关闭 VG 证据时移除或取消上述既有环境变量，并重新启动源码宿主。

入口回滚不撤销已批准的文件写入。需要恢复文件时，使用既有 Coding journal
恢复路径与审批；遇到 `recovery_required` 保留原证据，不自动重试或声明零写入。

`tests/e2e/change-context-review-loop.spec.ts` 以一个 worker、零重试、三次重复
检查默认入口零调用、四种比较、锚点失效及显式重新锚定、review 待办、三种
零写入拒绝、批准后 journal 原像，以及关闭和重新加载后的调用计数与数据保留。
VG gate 的 off/on 两种模式各有三次真实 Main 流程。运行临时目录和截图均在 D:。

## 已知范围

- Windows 源码宿主通过不代表打包安装、升级或代码版本回退已验证。
- runtime history/checkpoint 由脚本供给；Git、文件、评论、审批、journal 和
  Task Ledger 是真实 fixture 效果，不声明真人或 live-provider 证据。
- 非 Windows、协作同步、并发压力和已验证 VG 外部执行回执不在本次测量范围。
  相关 owner 分别为平台发布路径、Session/runtime、Review Store 与 VG receipt owner。
- 复用本机依赖和 Electron 40.8.4，不证明全新依赖安装；产品锁、默认值与公开发布
  仍由既有规则约束。
