# TF-0742 原子更新验收

干净候选 d9b94d6336a6454c2cfef77bae8a9507d74ca571。self-edit 与 curation 在既有存储 owner 内统一同步事务，SQLite同连接/savepoint；内存失败恢复数据、计数及淘汰状态，淘汰回调延迟到外层成功。DELETE返回applied/already_applied；缺失目标拒绝，禁用保持skipped。

24项原子性测试与79项相关回归全部通过；6/6真实SQLite故障注入回滚，独立读连接在提交前看不到中间状态。类型/lint/Harness/comms均通过。旧实现的具体部分写入见baseline-observations.json；当前测试的冻结源码复跑见baseline-final-tests.json。

所有产物agent驱动。persist仍退役，测试进程模拟标志与决策；不作live-provider、缓存跨进程一致性或GA声明。历史M3/TF-0741证据不修改。
