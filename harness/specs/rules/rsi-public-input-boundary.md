---
id: rsi-public-input-boundary
title: Public RSI task contracts and frozen input provenance
type: ai-coding-rule
severity: error
---

RSI 公开任务输入必须在新协议中冻结。

1. 每个任务绑定 task id、source record digest、历史 base/reference、targetScope 和 oracle digest。公开输入内容、来源 revision/blob 和生成方式纳入输入摘要。
2. 公共 API 可投影为声明，公开名称、参数、返回结构和调用约定。声明不得包含可执行初始化、函数或方法实现体；历史目标实现和隐藏 oracle 不进入 subject 输入。
3. 基线源文件与调用方上下文只能来自声明的历史 revision。隐藏测试、fixture、原接受记录正文、SHA256SUMS 和 evaluator 私有输入不能经上下文发现或工具读取泄漏。
4. 所需公开契约缺失、来源不符或被截断时，新协议准入失败。缺失模块显式记录；有界上下文的省略项单独列出，不伪造完整源码。
5. 新的输入或工具策略使用新的 collector 版本和 runId。旧 v1/v2 请求和历史批次保持原版本解释，禁止通过重新封印追认旧测量。
6. 输入完整性验证属于工程证据。收益由冻结任务上的独立配对实验判定，生成报告时实际写出 observed/not-run、已知和未知状态。
7. 自动生成和核查产物标注 driven_by: agent 与具体 actor。候选只能修改 task scope 内源码，不能修改 evaluator、隐藏 split、grader、权限、产品锁或默认值。
