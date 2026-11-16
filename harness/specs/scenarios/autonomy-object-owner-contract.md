---
id: autonomy-object-owner-contract
title: 自动化核对自治引用的范围、来源和权限边界
type: scenario
requiredRules:
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - task-forest-autoclose-and-roles
---

Agent 使用既有 workspace/session owner 的 scope 和 generation 创建引用。
合法的 Ledger、Forest、runtime、Main、Browser 和资源引用保持 owner 与 ID 字节。
替换 workspace/project/session/generation 或增加 grant/完成字段的输入被拒绝。
将静态关系或 manifest 改成授权 owner 不影响真实 workspace 的只读权限判定；
真实 owner 缺失时 fail closed。所有证据标 driven_by: agent，不声称真实用户操作。
