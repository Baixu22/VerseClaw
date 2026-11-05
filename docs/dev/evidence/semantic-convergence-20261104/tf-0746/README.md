# TF-0746 最终矩阵

候选 300631d8588062209a06236d552ddf1f8b08eb52，全部门禁 sourceStable/dirty=false。511 项 unit/integration/runtime 通过，4 个 Electron 场景逐项通过，13 行矩阵覆盖10组发现。首次 Electron batch 的 Settings 启动超时保留为失败，同候选精确重跑 exit0；另三例已通过，未用 skip 掩盖。Setup 使用真实 Gateway/Main/本地 HTTP。

结构化复核修复进程树先后顺序和重复重试判定；最后1条 chat-probe finding 被真实HTTP请求和源码反证，详见 adjudication。实际main+child已退出、第二app仍存活，最终清理survivors0。

类型、构建、lint、contract/i18n、Harness、comms通过。构建依赖恢复配置与15项精确依赖复用链接有来源；runtime构建源码在候选间未变。persist=false，所有证据agent驱动。
