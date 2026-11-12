---
id: autonomy-worktree-integration
title: 独立工作树成果整合与恢复
scenario: gateway-backend-communication
type: scenario
requiredProfiles:
  - fast
  - comms
requiredRules:
  - autonomy-worktree-integration
---

agent在两个受管工作树完成独立任务；原owner整合成果，完整保留删除、重命名和二进制字节。第二个writer、陈旧代次、目标漂移或无法确认的应用被拒绝，原文件与回执仍可回读。验证针对整合后的新candidate；回收消费原任务/候选引用与资源退出回执。

应用从已跟踪源码构建后重复以上流程，Electron Main的media-core根入口和子路径沿既有源码alias解析。
