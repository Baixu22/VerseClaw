---
id: autonomy-worktree-integration
title: 工作树成果只由原整合owner应用并验证
severity: error
type: ai-coding-rule
---

- 整合使用WorktreeService持久registry和checkout writer；同目标操作串行，代次、实例及写入资格在效果前复验。
- 可执行权限变更明确返回worktree_merge_mode_unsupported；不得将未应用的权限变更报告为merged。
- 删除、重命名和二进制内容通过现有Coding journal应用；目标漂移或回滚无法确认时保留recovery-required与原日志引用。
- 重复完成读取原整合回执，重启不能丢失已使用的基线或把未知效果当作未执行。
- 合并后的检查绑定新candidate及实际验证目录；旧worker检查和模型自述不能使任务验收完成。
- registry决定实际后端；Git检查绑定冻结候选，进程内工作树检查绑定整合目标。未知后端不得绕过候选检查，脏Git基线返回冲突并保留双方成果。
- 混合后端按registry记录分别冻结和整合；候选目录沿原native identity校验根实例、Git反向引用和所属仓库，派发前拒绝替换及重定向。
- 回收沿用现有Task、资源与工作树owner，保留未推送成果、活动引用和唯一证据。
- 当前整合只应用受控文件后像；Git 多父/octopus merge、自动 `git gc` 和 `worktree prune` 未实现，必须明确不可用，不得用普通文件合并结果冒充支持。
- 争抢拒绝同时回读持久副作用；claim无claimed事件及claim，checkpoint无checkpoint事件，登记保持独立。正式回执保存实际错误码、阶段、输入与清理耗时。
- Electron Main内联的media-core根入口及子路径沿现有源码alias解析，不以被忽略的包dist作为构建前提。
