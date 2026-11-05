---
id: autonomy-task-completion
title: 自动任务以原owner证据提交完成并可回读及失效
type: scenario
---

agent提交任务和验证记录引用，Main从现有owner读取来源与候选，按任务日志revision接纳。
请求不携自报passed。成功可从盘上重算；候选改变后旧证据不可用于新候选。
complete+repair、blocked/unavailable、旧generation、伪造reviewer或缺artifact不产生自动验收done。
手工done和turn check保持真实原语义，待接纳的自动任务有review/unknown，不能显示假成功。

并发负例包括：最后RPC回读后runtime配置或checkpoint变化导致CAS拒绝；
省略owner仍不能由assistant直接写业务done；指定既有手工rootId不得覆盖原任务；
失败尝试不撤销手工/已接纳done；历史成功重放和当前失效状态分别呈现。
Git helper负例验证readback不执行项目配置程序。Sandbox适配测试明确标注agent模拟，
不能把adapter与实际子进程的通过升级为Docker隔离实测。

普通自动事件不能覆盖已done/dropped的业务事实；新动作或完成声明不能擅自重开手工终态。
显式手工重开后仍可继续自动派发。会话活动面板须回读相同Gateway验收owner，
在有效接纳、选择切换、候选失效与手工取消后分别保留相应事实和历史回执。
