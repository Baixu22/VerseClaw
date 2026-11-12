# 工作树成果整合与安全回收验收

候选 `61cde6ebbeef0290f5b0a1fdf9d6174eb2167511` 的原七条验收已逐项读回。两个真实 Git 工作树顺序整合后在冻结候选复验；删除、重命名、二进制、冲突保留、重启和跨入口回收均有原 owner 回执。

Windows 源码检出执行 13 项门禁全部退出 0，核心回归 245/245、跨 owner 回归 49/49、移除入口 44/44，均零跳过。完整 Electron 两项旅程 2/2、零跳过和重试，源码状态前后相同，自有进程零残留。整链完成迁移中断、重启续接、任务验收、Git 保留与源目录移除后的历史读取。

media-core 的根入口和子路径改为源码 alias；最初没有该包 dist 的检出完成 Vite 构建。实际编译探针解析 12 个源码模块，根入口 36 个导出与子路径导出一致。claim 争抢回读无 claimed 事件和 claim；四种争抢保留实际错误、阶段、耗时与持久副作用。指定模型复审三项 finding 全部关闭。

完整 Harness CI 在 Agent Dev 审计处退出 1：既有 deep-test 记录的 unit 180444ms/21000ms、typecheck 81259ms/45000ms、contract 3977ms/3000ms 超过硬预算。该失败保持原状；余下 evidence 与 coverage 两项另跑通过。

首轮原生 1/2 的 Gateway 退出超时、独立复测 1/1 和最终整组 2/2 分开保存。早期额外检查 48 通过、1 跳过；1s Windows 审计探测连续三次超时，该 50 循环用例保持跳过。JSON 输出路径恢复按原归档逐字节校验，旧 243 项记录与新 245 项记录各自保留。

原生窗口、Gateway、Git 和文件效果实际执行；模型工具响应由 local-scripted provider 驱动。检出复用已有隔离依赖。当前多父/octopus merge、自动 git gc 和 worktree prune 显式不可用。

运行 `python verify.py` 读回文件哈希、338 个不同用例、原生状态、claim 副作用和原件归档；原件恢复位置及 source bundle 见 `raw-archive.json`。
