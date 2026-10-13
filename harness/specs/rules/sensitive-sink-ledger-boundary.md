---
id: sensitive-sink-ledger-boundary
title: 敏感 sink 台账边界（enforced 不等于全网强制 / 残余必须登记）
---

# 敏感 sink 台账边界

- **enforced ≠ 全网强制**：`narrow` 只表示某一条生产路径会拒绝；不得据此声称该 sink 已被全面强制。
- **区分 enforced / partial / residual**：每个敏感 sink 必须记录实际拦截到哪一步，并单独列出仍未接入 provenance 闸门的出口。
- **残余必须可执行钉住**：未接入的残余出口必须有测试钉住；一旦被接入，测试失败并要求同步更新台账（防止静默扩大覆盖或台账过期）。
- **登记点必须真实**：policyFile / 导出符号 / 生产调用点必须能被工作树解析验证（由 drift guard 保证）。
- **不新建第二套 provenance 引擎**；不改产品默认值/锁/approval。
