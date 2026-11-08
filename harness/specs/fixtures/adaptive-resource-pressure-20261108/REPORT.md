# 按执行类别与压力调节并发验收

driven_by: agent；actor: codex。

候选 `635670257a8c5ed8a51f64cf22df6a5da4cb70d6`；tree `a82c1a6ded751e23e7e759b21f783ee5fdcbcd49`。
完整测试候选 `1a400245e58d8207dca4e719ff965e5cf5932b55`；交付仅移动.gitignore精确日志例外，产品、测试、配置与脚本逐路径diff为0。
基点 `df229c0c3b001b984d4896c10c1e8408ecf678a0`。从仅跟踪源码的独立投影运行，复用已安装依赖。

105/105 测试通过，失败 0、跳过 0。
旧源码3个负例复现：latency+backlog扩容、积压直接跳至上限、长执行污染短读基线。
覆盖类别传播、Windows真实子进程/commit计数、压力滞回、过期/重复/缺失观测、活动任务保留、空账户回收与重建、200请求公平等待和取消释放。

Node/Web类型、lint、contract、i18n、comms、Harness和retention命令结果见 report.json。
Runtime完整类型检查 exit 2：基点 38 项、候选 38 项，新增 0。

## 实际工作配对

16轮ABBA，1/2/4/8槽位；每轮12次512KiB文件读取校验、6次Node子进程gzip、6次本地HTTP延迟响应。
总计384任务，96个已观察close退出的子进程；运行样本、阶段耗时、队列、RSS/private和系统commit见 runs.json / comparison.json。

| 上限 | 吞吐变化 | P95变化 |
|---|---:|---:|
| 1 | +8.66% | -7.97% |
| 2 | -10.99% | +7.82% |
| 4 | +4.44% | +18.59% |
| 8 | -14.37% | +30.24% |

吞吐与尾延迟共同决定取舍。保留默认上限4；不采用8槽位配置。此次实现接受项为消除过载正反馈、隔离类别及压力回收，混合窗口系统吞吐结论由后续TF-0838给出。

压力回放使用固定的物理可用内存、commit和event-loop输入；未耗尽共享机器内存。本地HTTP代表受控远端等待，不使用provider服务。Windows真实commit原始读数单独保留。
首版单次抖动导致串行化的失败配对、测试首败、测量器初始化失败均保留在 raw-evidence-index.json 指向的本地原始记录。

## 行为与配置

积压只表示需求；同类连续两次变慢才收缩，连续健康需求逐槽恢复。远端等待单独记录；active lease保持至真实结算。
低内存/高commit/event-loop使用原观察节拍，至少10秒新鲜低压采样恢复。CPU单独、整机I/O wait未启用，诊断明确列出。
min/initial/max=1/2/4、queue=64、deadline、QoS与DRF64保持原值。空闲五分钟且active/queued=0才回收账户。
