# G3 压缩就绪判断验证

压缩状态与写入守卫共用同一会话代次的忙碌判断，覆盖活跃 run、admission permit 和 fence。恢复采样在原 240 秒预算内等待同代次就绪，范围压缩固定 seeded expectedSessionId。global 会话的 fork、parent reset 和命令 hook 使用所选 agent 或配置默认 agent。

当前定向回归 16/16、十文件语法 lint 和原 LOC 基线通过。新增负对照在修正前复现三个默认 agent 错误，原失败与修正后绿报告均保留。修正前六项完整 runtime 源码门禁通过，其原源码指纹在报告中单独绑定；新候选完整原生验收按共享串行窗口执行，GA 为 NO_GO。

首轮 DeepSeek 结构化审查发现默认 global agent 推断和缺失证据链接两项问题，均已修正。同一固定输入由 ccs-workbuddy/deepseek-v4.1-flash 完成复查，helper 与原始结果均为 0 项发现。此前的中断、DeepSeek 502 与 GPT 503 原件全部保留；源码提交和审查绑定见下方文件。

验证命令：

```powershell
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'
node node_modules/vitest/vitest.mjs run tests/unit/gateway-compaction-readiness.test.ts --maxWorkers=1 --no-file-parallelism
```

[报告](report.json) 与 [原件归档](raw-evidence.jsonl.gz) 保留源码快照、运行报告、失败与审查输出；[SHA256SUMS](SHA256SUMS) 覆盖本目录文件。所有验收由 agent 驱动，realHumanEvidence=false。

[源码绑定](source-binding.json) · [最终审查](final-review.json)。完整类型、构建、冻结矩阵、live-provider 和包门禁仍在共享串行窗口队列；GA 为 NO_GO。
