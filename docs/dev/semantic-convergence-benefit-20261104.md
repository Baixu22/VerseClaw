# 三层语义收敛收益与恢复决策

本报告由 agent 自动生成，测量候选 300631d8588062209a06236d552ddf1f8b08eb52。10 组发现均有明确边界的 resolved verdict，详见机器报告及 TF-0746 的逐项矩阵。

- retry-amplification: 1 charges per physical request；method=real-local-HTTP，证据 tf-0746/http-observations.json。
- retry-recovered: 1 local fault sequence；method=real-local-HTTP，证据 tf-0746/http-observations.json。
- root-runtime-pass-count: 511 assertions；method=same-candidate-test-results，证据 tf-0746/report.json。
- electron-pass-count: 4 distinct journeys；method=real-Electron-Main-local-HTTP，证据 tf-0746/electron-verdicts.json。
- negative-pass-rate: 1 declared negative/boundary cases；method=retained-case-results，证据 tf-0746/negative-cases.json。

M0 保留原始 dirty=true 的源码基线。其 MEM-1 是 5 个标签匹配，规划文本的 3 个位置属于不同计数范围；不将两者偷换或计算百分比。静态上限、结构计数与本地行为分别报告，未形成同 fixture 的 live-user 前后配对，因此用户收益、生产成本和美元节省均为 not-measured。

冻结权重为 0.35 correctness + 0.25 user impact + 0.20 coverage + 0.10 cost efficiency + 0.10 evidence quality。可验证的修复/覆盖/证据维度均为 1，impact/cost 不可用；记分卡区间 0.65..1 只表示缺失维度的上下界，不是收益百分比或置信区间。

最终门禁累计 778108 ms，观察窗口 592829 ms；前者包含并行执行的时长之和，不是开发墙钟耗时，也不含全部失败重跑/复核成本。

decision.status=keep-retired，runtime.memory.persist=false。默认值变更提案为空，应用为空，产品锁与发布状态未改变。Memory 是恢复前门禁，prompt 是显式 enforce/seal 验证，不外推为生产默认开启、live-provider 或 GA。

复算：node scripts/semantic-convergence-benefit.mjs --verify。此报告不包含人工操作或真人数据证据。
