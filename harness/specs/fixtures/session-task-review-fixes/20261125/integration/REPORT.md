# 最新主线整合回读

候选：`d09e7c0e8fe06a9ac3c1c30dbac714806efd47d1`。树：`eeb659d619290a8e20132014686b2970d01f83d8`。主线基线：`bfc323f4c941d5556327906ded1606a8cee68fc1`。

新主线资源调度提交整合后重新完成：219/219 定向回归、完整 Main/Web/Test 类型、lint、完整 Runtime 构建与 gateway smoke、桌面构建、契约、通信回放/比较及差异感知 Harness 验证。六条实际 Electron + 本地 Runtime / scripted provider 场景全部通过，包含取消、恢复身份、只读历史、实际 resume 写入、迟到响应及跨页面草稿的可见/持久版本回读。

`report.json`、`sources.json`、原始命令日志和 JSON 结果绑定该整合候选。源码与既有七项修复的历史证据分别保留，首次失败继续位于 D:/tmp/session-task-fixes-20261125-01a21019。
