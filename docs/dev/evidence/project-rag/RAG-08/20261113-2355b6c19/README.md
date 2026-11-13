# 重排服务验收

源码候选 2355b6c19c022c432d5df1a3ab4b6203f8305d67。模型清单、结果校验、profile 分支、取消与重试、两条 Electron 设置旅程和真实四语言固定池消融已验证。重排原始分数保持 calibrated=false；离线指标与实际 provider 耗时见 ablation.json。供应商未返回 token 与货币成本时，报告记录 null。

执行命令、退出码与耗时见 gates.json 和 provider-retry/retry.json。首次运行与 RAM 失败记录保留在 prior-run.json、electron-initial.json；最终必需旅程结果见 requiredTestCoverage。产物由 agent 驱动，realHumanEvidence=false。
