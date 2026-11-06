# Gateway 启动优化验收

日期：2026-11-05。执行与判定均由 agent 完成。

源码候选：5c91a6f25ffd908d579116cd188e5fd8d949b835；父基线：5accfbddbf46839bf7999c70eed31b1b045b640b。

结果：Windows 源码环境下验收通过。改动保留挂载源码和外部插件的契约归属，减少 JavaScript 契约的 SDK 加载器准备，并让本地连接直接使用回环地址。

| 观察项 | 结果 |
|---|---|
| 空编译缓存、每组 3 次、认证 RPC 中位数 | 8.86 → 7.44 秒（约 16.0%） |
| 完整桌面启动至认证健康 RPC | 13.34 秒 |
| 桌面启动、RPC、停止与进程退出 | 1/1，通过；0 跳过 |
| 定向回归 | 63 项通过，最终空值检查后重跑相关 1 项通过 |
| 类型、构建、静态检查、通讯、Harness | 通过；类型按各项目记录，Harness 执行计划为 dry-run |
| 审查 | 已修正已知发现，最终复核无待处理项 |

前后测量使用同一运行时构建、交替顺序与独立编译缓存。启动必须完成认证 RPC，并读到被测加载器确实执行的证明。即使继承了 LAN 绑定、禁用插件和跳过迁移变量，正常驱动仍执行预期工作；缺少证明的反例即使 RPC 成功也被拒绝。

这些是小样本观察。没有确认稳定的热启动收益，也没有测量打包版本、其他平台或真实用户的频道/模型配置。首次较慢的基线样本、此前超时、环境修复和被废弃的诊断均保留；不得用它们宣称额外收益。探针关闭 mDNS，且没有已配置频道；应用的产品锁与默认值不变。

复跑前先构建运行时与桌面，Windows 的 TEMP/TMP/TMPDIR 指向 D:/tmp。测量入口：

~~~powershell
node scripts/measure-gateway-startup.mjs D:/tmp/gateway-startup-measurement.json 3
node node_modules/@playwright/test/cli.js test tests/e2e/gateway-startup-performance.spec.ts
~~~

完整判据和范围见 report.json；原始材料恢复位置见 provenance.json；文件完整性见 SHA256SUMS。
