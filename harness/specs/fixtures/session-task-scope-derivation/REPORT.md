# 派生会话任务引用验收

driven_by: agent；actor: codex-audit-relay-20261107。

Main 已在 fork/handoff 中持久化源会话当前显式业务任务链接。重复链接去重；缺失任务、turn check、其他会话和旧 generation 链接被排除。Fork 返回后再次校验源 generation，以处理克隆期间的重置。Renderer 的第二个 fork 血缘写入点已删除。

源码候选：`8881bb51af2e1291776799aab6d1f58aea87764b`。

- 冻结候选的 93 项单测通过，0 失败、0 跳过；修复前 3 个新增反例全部失败。
- node/web/test 三套无缓存类型、lint、契约、通讯、差异感知 Harness 与保留规则检查均退出 0。
- build:vite、build:runtime 及运行时启动 smoke 通过；2292 个桌面编译产物哈希已回读。
- 真实 Electron 场景 1/1 通过，运行退出 0。代理注入转录后调用真实 Main/Gateway，验证派生 task 引用、独立 generation、fork 准入拒绝、handoff 旧协调器暂停和新协调器 ready；原任务保持 done。

第一次桌面运行未进入场景，第二次断言通过但 worker 退出超时，均保留原结果。最终用例先通过 Gateway owner 停止子进程，再关闭 Electron。原始材料位置、命令和每次退出结果见 raw-inputs.json 与 report.json。

TF-0673 继续验收讨论转执行自动建任务、十轮普通讨论和单任务 writer claim 的完整准入/换代。
