# TF-0744 facade 采用决策

候选 34eead4c54c13e809f0a77e03df423da6ead6ba6；decision=retire。22 个聚焦测试通过，生产消费者 0，golden-run 保留为历史观察。静态引用和导入负例由同一 oracle 验证；头注释、当前指南、归档 spec 对齐。lint/Harness/comms 全通过。产物 driven_by: agent，不恢复 persist 或默认值。
