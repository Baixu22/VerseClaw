# E3 autoreview-r3 意见核对

actor: codex/session-collaboration-e3; driven_by: agent; review model: ccs-ai/gpt-6.1-sol.

1. “消费者处理失败仍确认游标”不成立。src/stores/session-collaboration.ts 的 onUpdate 在 try 内、acknowledgeWatch 之前同步调用；抛错直接进入 catch，跳过 ack。tests/unit/session-collaboration-recovery-view.test.ts 的 does not persist a watch cursor before its consumer accepts the update 实际抛错并重载模块，验证原游标未确认。补充了说明同步异常控制流的注释，未改成提前确认。
2. “重载未知发送不自动查询回执”采纳。打开消息详情或重连后，以恢复草稿的原 ID 自动查询一次，只有 owner 返回 empty 才允许手动重试原意图。新增重载后自动查询原 ID、不派发、保留原文回归；Electron 场景同步核对自动恢复结果及重启前后模型调用计数。
3. “导航后旧目标仍可展示”作为越权问题不成立。UI 先清除旧正文并递增sequence，再重新读取 collaborationSender。electron/services/sessions-api.ts 的 collaborationMaterials 在 Gateway 调用前后核验当前 requester；openclaw_runtime/src/gateway/server-methods/session-collaboration-material.ts:137-139 明确拒绝跨 workspace/project，179-184 在读取前后复核当前可见性。原查询和新 requester 一起发送到原 owner，没有复用旧权限。新回归验证同工作区更换读取者后只能展示重新授权返回的新内容；既有测试验证导航拒绝迟到响应、读取者缺失清空正文。

独立验收另提成功 acknowledgeWatch 应清除旧 persistenceFailed，已修复并在保存失败→重连成功回归中断言标志复原。

请独立复核上述判断及最新源码，报告有实际触发路径的新增或剩余问题。

autoreview-r4 的两个有效 finding 已修：材料 watch 收到 revoked/expired/stale/unknown 事件清除 detail/page，并覆盖四种状态；终态 rejected/expired 回执分配新草稿 ID，保留正文，用户明确点击发送才派发新意图，覆盖两种状态。原 ID 只在 owner empty 时重试。

独立审查提出 source reset 后旧 unknown 缺原回执入口，已新增 Recovery 列表只读核验：读取当前 collaborationSender、原 target 和原消息 ID；导航/重连/unmount 失效在途查询，结果同时绑定 draftKey+ID，丢弃后同scope新草稿不显示旧回执。新增source-reset回读、target stale与迟到结果回归，Electron脚本补原ID回读并核模型调用数未增加。
