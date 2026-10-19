# TF-0423 会话加载与标签补全回归证据

本 fixture 用同一套合成负载，在改善前（9cae5341）与改善后两个真实 Electron 构建上采集观测：

- 333 个会话、约 60 MB（实测 57.16 MiB）合成 transcript，运行时生成，仓库内不保存私有会话原文。
- 侧栏摘要由真实 Main 服务 `sessions.summaries` 完成；Gateway RPC 由 agent 脚本模拟。
- 全部产物 `driven_by: agent`，不声称真人证据。

## 运行

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'
node harness/specs/fixtures/tf0423-session-loading/probe.mjs <仓库根> <输出 json> <临时运行目录>
```

环境变量：

- `TF0423_IDLE_MS`（默认 300000）：空闲 RSS 采样时长。
- `TF0423_IDLE_SAMPLE_MS`（默认 5000）：采样间隔。
- `TF0423_CANDIDATE`：写入报告的候选标识。

快速冒烟用 `TF0423_IDLE_MS=5000 TF0423_IDLE_SAMPLE_MS=1000`；正式证据使用默认五分钟。

## 结论（见 acceptance.json）

最终同探针结果（333 个合成会话，Windows Electron，agent 驱动）：

- 侧栏一次扫描请求的会话键数量：**332 → 40**；`sessions.summaries` 调用次数：**7 → 1**。
- 打开大 transcript 会话：**427.2 ms / 11 个 long task → 178.8 ms / 0 个**；空闲对照 long task：**6 → 0**。
- 会话切换 long task：**37 → 1**；切换 P50/P95：**230.5/240.8 ms → 137.3/155.8 ms**。
- 五分钟空闲 RSS：`persistentGrowth=false`（60 个样本；前后均无持续单调增长）。

侧栏修复把会话行按每批 80 行挂载，并在滚动接近底部时继续加载；因此 333 会话不再一次挂满 DOM。
`attribution.json` 保留早期归因实验：长任务随会话行数增长，而非 transcript 大小；负向诊断也保留在文件中，供后续避免重复试错。

边界：这些是本机 Windows Electron 样本，不是跨平台基准；Gateway RPC 由 agent 模拟，`sessions.summaries` 读取的是真实 Main 服务与合成本地 transcript。
