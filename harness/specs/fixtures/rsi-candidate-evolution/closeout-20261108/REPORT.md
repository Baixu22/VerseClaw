TF-0856：候选版本与受控多代演进完成

源码候选 94825e3dff67e0b057a67e62b46ee7e9ba349dd4；driven_by: agent；actor: codex/rsi-remediation。

在现有 SEKB SQLite 轨迹表中保存冻结计划、生成预留、父子 prompt 版本和验证裁决。训练、验证与最终评估任务独立绑定，生成器读取训练摘要、隔离载荷证明及 v1 采用归因。重复调用保留首次结果，中断、未知用量和失败保留预算。

两代候选已执行并读回：第一代淘汰，第二代按生成前冻结的首个合格版本规则选作待测输入，产品采用保持 hold。最终 24 任务的内容与结果不反馈生成器或选择器。独立 Node 工程控制包含 2 项原始失败和 2 项修复；两代各有 72 baseline / 72 candidate 控制记录。冻结门保持 k=3、20 完整 case、5pp、95% 区间下界大于零、token/tool-call 成本增长不超过 10%、安全与锚点零回归。工程控制含 24 个变体，不作为独立模型质量样本。

26 项候选/存储回归与 44 项旧评估回归共 70/70 通过，0 skipped。7 条 SQLite 记录重开/只读导出一致，off/on/off 返回原 prompt 摘要。Schema、定向类型、8 文件 lint、通讯、Harness 规格及 dry-run 通过。类型检查保留 1 条范围外诊断。完整 Harness CI 前置 59 项测试与目录校验通过，随后在 Agent Dev 审计退出 1：四份旧报告过期，三项既有性能硬限失败。详细原输出及计数保留在 global-ci-residual.v1.json。

原始 SQLite、首次组合回归超时及开发红例保存在 raw-archive.v1.json 指向的 D: 目录。历史任务准备曾耗时 93.688 秒；测试改为预先准备一次冻结任务，候选生成预算保持原值。测试复用私有依赖覆盖层，未作全项目新安装。源审查由当前 agent 与自动化读回完成，independentReviewer=false。

第三方模型调用 0；历史 NO_GO/eliminate 保持。RsiBenefitPlan/v2 已绑定待测 prompt 并保留 v4 协议；plan-binding-control.v2.json 仅为接口控制。下一节点 TF-0857 的任务/版本和资源草案已准备，实际调用预留为 0，需先冻结新预算及价格依据。
