# RAG-01 来源读取验收

TF-0878 的身份、权限、版本与引用回源验收通过。源码候选为 `2868a11ae39aa1b4a920800995b64f98d69ce6b9`，执行工作树与分支见 [report.json](report.json)。

- 来源相关根单测 141/141、runtime 单测 37/37；沿用同一来源源码版本 `493704561` 的结果。
- 当前候选 Agent Dev 单测 184/184、Harness 单测 62/62，均零跳过。
- 来源 Electron 旅程 1/1；当前候选 Agent Dev 完整 Electron 4/4；十二项 Harness CI 全部退出 0。
- 完整 Node/Web/Test 类型检查、合同、通信 replay/compare、RAG spec 校验通过。
- 5 个 pin 漂移负例拒绝，禁读正文进入 provider 的次数为 0；模型等待期间的旧 workspace 响应拒绝。模型端点为 agent 驱动的本地 HTTP/SSE 脚本服务。

[历史失败](failure-history.json) 保留原计数与原始报告。[来源输入](source-inputs.json) 绑定 Git blob 与 SHA256；`SHA256SUMS` 校验本目录产物。所有产物标为 agent 驱动。

TF-0870 的后续查询、任务、平台、成本与 72 小时验收按长期工作包执行；下一节点为 TF-0879。
