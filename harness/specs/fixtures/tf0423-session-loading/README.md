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

- 侧栏一次扫描请求的会话键数量：**332 → 40**。
- `sessions.summaries` 调用次数：**7 → 1**。
- 打开大 transcript 会话的耗时与 renderer long task 数量：改善前后一致（8 vs 8）；同一台机器上空闲对照窗口本身就有 6 个 long task/2.5 s（探针被强制软件渲染）。
- 五分钟空闲 RSS：`persistentGrowth=false`。

关于 long task 的边界：软件渲染下环境本身持续产生 >50 ms 长任务，
因此**绝对阈值不可归因于“打开长会话”**，只记录相对增量，不宣称绝对通过。
