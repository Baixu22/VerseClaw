# 工作区别名与原生父路径复用验证

源码提交 67f29efa6fd86e86a75edb7017f85ccc4bcd464b。工作区别名优先读取选定包清单，只有null/undefined才解析备用根。原生CJS/ESM别名每次调用仅规范化一次父路径，再按原登记顺序匹配目录；后续调用仍读取新的符号链接目标。

新增六项原生回归，覆盖共用入口、多个根的单次realpath、同名前缀兄弟目录拒绝、缺失路径词法回退、符号链接重定向、登记顺序及早退。修复前9通过/4失败，修复后13/13。已提交Git blob的三文件独立目录回放为13/13，只使用Node内置模块；没有安装或载入SDK依赖图。

三文件Oxfmt与定向Oxlint、两份Harness validate通过，唯一residual是并发AGENTS.md。源码十文件逐hash回读一致，并发用户文件与staging保留。

小检查串行，Node堆64MiB、Job私有128MiB、CPU10%；测试RSS峰值68.96MiB、私有38.89MiB，格式私有77.34MiB、语法67.52MiB、两份Harness99.14/99.61MiB。隔离回放私有39.41MiB，用时156ms。

WorkBuddy ccs-workbuddy/deepseek-v4.1-flash复核0发现；结果由原始autoreview helper校验。为减少启动开销，本次调用关闭MCP、插件同步、Apps及shell snapshot，使用聚焦源码并显式固定exec模型；全局配置未编辑。Windows Job配置私有上限96MiB，记录的峰值为125.46MiB；若干只读工具启动因配额失败，审查依据附件中的完整原生模块、SDK改动函数与调用边界及已保存测试。原客户端栈/内存失败、资源准入拒绝和红测全部保留。

G3 GA为NO_GO。本候选完整类型、构建和真实恢复指标等待受限验收窗口，没有新增恢复测量。前候选41.935秒记录不作为本候选性能结果。全部产物为agent驱动。

report.json保存候选、命令、峰值与复核，verification.json保存读回结果，raw-evidence.json.gz保留72份原始输入/输出；SHA256SUMS校验这四份交付文件。本地完整记录仍位于D:/tmp/g3-slim-development-20261122-01a1fe77/。
