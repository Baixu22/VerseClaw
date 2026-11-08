# 会话任务准入修复验收

driven_by: agent；actor: codex-audit-relay-20261107。

Main 的任务范围解析器已复用委派服务的参数合同，并按 session、taskRef、generation 查找有效链接。同会话中的其他链接不会再遮蔽目标任务；缺失任务、缺失链接、跨会话链接和旧 generation 链接在 Gateway 委派前被拒绝。

源码候选：`5cad19cce572dc4266b9925c8caee2193954edf3`；前置准入提交：`9627d3c093739adf53a6fda710efe63785581189`。接力时读回干净候选，七份源码与共享检出的 SHA256 一致。

- 修复前定向反例：2 失败、5 通过；修复后：7 通过，25 项未选择。
- 冻结候选：4 个文件、51 项单测通过，0 失败、0 跳过。
- Main 与测试项目无缓存类型、定向 ESLint、Host API 契约、通讯重放及比较均退出 0。
- Harness 差异校验和执行预览通过，未覆盖变更路径 0。

命令、退出码、耗时与日志摘要见 report.json；源输入见 source-manifest.json；原始失败与成功材料的恢复路径及哈希见 raw-inputs.json。最初依赖缺失、错误 store 路径和错误脚本入口的失败记录均保留。

TF-0673 的讨论转执行自动建任务、十轮讨论、fork/handoff 写入权换代仍由父节点验收。此次通过对应委派准入修复。
