# 宿主预算与公平准入整合验收

TF-0830 已在干净候选 `d607437e684d11ed259996de21ff1861d4cbbfb3`
（tree `7390181d165b4d9d0be9550318fd7df200a90154`）完成验收。
全部执行由 agent 驱动；原生预算场景使用脚本 HTTP provider、真实 Electron、Gateway 和 SQLite owner。

整合来源为 `D:/ClawX-work/autonomy-host-readiness` 的 `807cbb833..54e1457b0`。
当前实现保留跨进程原子 reserve、unknown 负债、失败补偿和 owner 退出确认；
各 workspace 共用宿主容量，同 QoS 按占用比例选择等待租户，老化请求优先。
存储释放与浏览器取消等待异步 owner 清理，逻辑 workspace 标识贯穿 embedded attempt。

- 单元回归：根目录 519、runtime 107、VerseBrowser 45，共 671 项通过。
- Electron：12 项场景在同一候选上通过，覆盖编排、预算、owner 重建、多窗和存储释放。
- 200 请求压力使用可控时钟：168 成功、16 取消、16 超时；活动峰值 64，最终活动、等待、timer、listener 均为 0。
- 旧源码覆盖负例：公平选择、终端退出等待、浏览器取消清理，共 3 项按预期失败；源码恢复后哈希一致。
- 15 份 owner 数据库 `integrity_check` 均为 `ok`，查询行与原始文件哈希保存在 `owner-store-readback.json`。
- Node/Web 类型、lint、契约、四语检查、通信回放及比较、Harness、产物保留检查通过；lint 有 1 条 warning。

`prior-failures.json` 保留首次候选的 workspace 作用域失败，以及并行运行时的进程探测和
Gateway 退出回执超时。修复 workspace 传递后，串行根目录回归和 7 项原生场景通过，
与同候选此前通过的 5 项原生场景合成上述 12 项覆盖；断言、超时和重试次数保持原值。

`report.json` 给出逐项结果、命令、退出码和 174 个源文件哈希；
`raw-evidence-index.json` 指向 D: 上的原始日志与产物。
`SHA256SUMS` 覆盖本目录全部精选文件，`credential-scan.json` 记录零命中扫描。
