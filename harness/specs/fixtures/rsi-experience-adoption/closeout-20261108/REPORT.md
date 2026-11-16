TF-0855：经验采用与任务结果归因完成

源码候选：2518aba4a71675a714450fb4d1d9a2fb094507d4。driven_by: agent；actor: codex/rsi-remediation。

SEKB 生产扩展已注册 record_sekb_adoption，按经验 id/内容摘要和 task/run/session/experiment/arm/repeat 保存检索、引用、采用、操作与结果。引用不增加采用计数；采用须有同一运行的检索和成功工具操作。结果按执行观察与独立任务判分分开。未知、缺失身份、拒绝及重复/冲突保留在现有 SQLite 账本。

冻结候选 52/52 回归通过，包含真实 ExtensionLoader/ExtensionRunner 和生产 edit 工具的文件修改。文件摘要发生变化；7 条事件含 1 条当前拒绝、2 次历史拒绝、1 次重复和 1 条未知终态，独立脚本判分后成功计数为 1。Schema、定向类型/lint、通讯、Harness 校验及 dry-run 通过。类型报告保留 129 条范围外诊断的计数。

原环境依赖失败、下载中断和类型/lint 首次失败已记录；原始数据库在 raw-archive.v1.json 所指的本地目录。测试使用 D:/tmp/rsi-private-runtime-20261108 的依赖安装，未执行全项目安装验证。未调用第三方模型。新收益测量尚未运行，旧批次 NO_GO 保持。

源审查由当前 agent 执行，并结合自动化门禁；独立收益裁决按既有路线在 TF-0858 执行。下一节点 TF-0856：候选版本与受控多代演进。
