# TF-0775 VG 编码观测与候选反馈验收

候选、判据和计数见 acceptance.json；commands.json 记录同候选的测试、类型与通讯门禁。provider/ 验证固定二进制及宿主模式，native/ 保留新建临时仓中的原生行为记录。effects/ 和 electron/ 保存实际绑定、反馈、transcript、配对行为与退出记录；candidate-artifacts/ 保存真实VS执行与候选证据。

63 项单测、四个 Electron 场景和16个模式/身份案例通过；三个正向配对均由 full 失败转为通过，两个负向对照没有误报。候选组合失败、五个写入前漂移反例与journal恢复有独立读回。历史失败和来源变化的F5重放结果留在 historical/。本次模拟、实际效果及原生机制夹具各自标注。
