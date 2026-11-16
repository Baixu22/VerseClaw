# G3 时延组件修复（2026-11-16）

旧冻结候选的恢复 P50/P95 为 17.439/83.204 秒，连续重启窗口达到 90.613–109.779 秒；`e2e-build` 记录 1,621.766 秒，而 Vite 三次构建自身仅 36.29、3.31 和 0.013 秒。

本轮把 taskflow 首轮恢复扫描从 1 秒改为 0 秒、失败重试固定为 250 ms；Gateway 重启冷却从 5 秒改为 1 秒，重连退避上限从 30 秒改为 1 秒；deep-test 的 Windows pnpm 子进程启用 `windowsHide`，消除隐藏控制台句柄对步骤计时的影响。

聚焦门禁通过：全量类型检查、专项 ESLint、91 项恢复/Agent Dev 单测、25 项 runtime 调度/恢复 flow 单测、22 项 Gateway 单测、contract/i18n/comms、runtime source/LOC、目标 Harness。当前 checkout 的 `pnpm run build:vite` 实测 78.538 秒；deep-test 内新建构建步骤 62.370 秒。冻结实时验收仍为 `NOT_RUN`，GA 保持 NO_GO。
