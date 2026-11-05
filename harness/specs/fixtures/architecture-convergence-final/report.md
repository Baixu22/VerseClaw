# 架构收敛最终验收

限定结论：**pass-for-scoped-architecture-convergence-with-recorded-residuals**。driven_by: agent；actor: codex-architecture-convergence；realHumanEvidence: false。

干净候选 `ec2053701bfc5f0126760507c8ff5045f60cdb47`，tree `b5bca90ffa3d81ffc5af1e92d75db3c936777d51`。本报告接受TF-0791及前四叶构成的架构收敛范围。

| 项 | 实测 |
|---|---|
| 专项全集 | 29文件，584 passed / 0 failed / 0 skipped（399架构 + 136 owner + 19能力 + 30 runtime） |
| node/web/test类型 | 同候选完整uncached检查全部exit0 |
| 接入与语义门禁 | contract、authority、evidence默认/report/verify全部exit0；关系6条，规则12+8 |
| 已知概念组合 | 245组合只接受6条合法关系，239组合拒绝；实际报告入口错误目标负例通过 |
| 依赖图 | 应用826文件/2375静态值边，环0、禁止跨层边0；runtime9159文件，环0 |
| 权威声明 | 8条旧裁定→0；结构词汇例外55；35gap保留且逐项分类 |
| 证据读回 | 9985个图源码输入匹配Git原字节，前四叶85个哈希匹配 |
| 其余限定门禁 | comms回放/比较、scoped lint、retention、Harness context/validate/dry-run、diff均通过 |

**保留失败，未改门槛：**runtime source六子门禁均执行，前五项通过；LOC与完整source链仍exit1。
LOC输出与TF-0789及其干净基线逐字一致：23个未登记超500行文件、110个超过原基线文件；本轮新增或加重为0。
额外Harness CI执行了五文件59测试并通过policy/catalog等步骤，随后因4份Agent Dev证据超过24小时而exit1；
并未刷新或伪造其时间。CI后续evidence及test-coverage已分别执行并通过。详见residuals.json。

**范围：**本体论式改造是可执行的产品语义/权威/证据约束，实际Task Ledger、Workboard与权限owner保持。
六关系的owner测试覆盖根绑定失败拒绝、只读projection、显式upgrade、单向引用和scorecard条件；
fixture与mock结果不等于live provider或全产品保证。35gap中18项为描述映射缺项、16项是矩阵领域外owner、
1项是未实现的系统级model echo无明文保证；分类不等于补齐这些能力。

原测评的依赖环、IPC扫描漏检、陈旧声明与关系端点缺口已在本范围收敛。
全仓健康、全构建、Electron、完整runtime类型、维护成本和任务成功率效果均未由本报告接受；不宣称GA。
源码审查和执行均为同一agent，历史封存证据保持原候选，最终状态以本地Task Forest收口提案和交接为准。

逐项合同映射见report.json；所有命令/输出见gates.json；owner关联见owner-coverage.json；复现脚本与原图摘要见reproduction.json。
