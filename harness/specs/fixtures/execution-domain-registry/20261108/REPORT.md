**TF-0864 已完成本叶受管工作树持久归属与实例保护。** 源码候选 `c066885f8bbf75fda2e9c24f19333f4307d35e61`，验证时工作树干净，全部产物由 agent 驱动。

WorktreeService 在共享 Runtime SQLite 保存 owner、generation、创建阶段与合并意图；进程重启回读原记录。创建未完成、目录替换、未知合并和清理中状态拒绝继续执行。旧 worker 的 merge/freeze/cleanup 请求绑定原 generation，不能消费同名重建后的检出。

显式本机 clone authority 登记提供经版本与文件实例核对的路由元数据。已有任务执行仍使用当前 owner；跨 clone 实际写入由后续联合准入接入。coordinator 的现有唯一写路径保持，接入安排见 `harness/specs/guides/execution-domain-registry.md`。

| 验证 | 结果 |
|---|---|
| 注册、重启、真实进程、故障窗口和路径/authority 反例 | 29/29 |
| 资源清单、回收、编排合并与迟到代次反例 | 25/25 |
| Node / Web / Test 类型、schema、接口契约、通信 replay/compare、Harness validate/dry-run、定向 lint | 全部退出 0 |
| 独立 DeepSeek 修复复核 | 原 P1/P2 关闭，无新增同范围 finding |

依赖与 VerseBrowser dist 通过 junction 复用；扩展 bridge 本地生成。本叶测试使用真实临时 Git、SQLite 和子进程，未运行完整 Electron 产品旅程或全 Runtime 构建。首轮 Windows 夹具 EPERM 与修复成功记录分别保留在 failure-index.json 与本报告。

复核命令：`python harness/specs/fixtures/execution-domain-registry/20261108/verify.py`。该命令核对精选产物、工作目录源码和候选提交对象摘要。
