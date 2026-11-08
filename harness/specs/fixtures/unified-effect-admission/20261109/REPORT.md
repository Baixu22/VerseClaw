**TF-0865 联合工具准入已验证，源码 `02a95193bc679bb1a4312c012e61fbfe8b981e98`。**

TaskSystemStore 保留任务合同与验收权，Main 核对 session/generation/绑定，WorktreeService 持久记录 checkout writer。raw 与 hook-wrapped 工具共用执行边界，操作前两端登记，工具间持续占用。规范父子委派原子换 epoch/token；回交保留防止第三任务插入，原 parent 显式释放后允许后续任务使用。后台、未知与取消结果消费原 Task/process owner 回执，不能按 TTL/PID 猜测释放。

显式注册 clone 路由到同一原任务库，并固定 registration、root/database incarnation，产物仍在实际 checkout 检查。Main 与 source Gateway 的 execution state 路径一致，会话/config 隔离保持。受管 Mission 固定任务版本和 epoch，每次 tick/恢复复核；reviewer 不产生业务完成权。

去重 **216 个单测、6 个真实 Electron 场景** 有通过记录；另保留后续两场景复验。Node/Web/Test、Runtime/desktop build、接口、通信、Harness、产物门禁通过。source manifest、实际文件/SQLite owner 回读、脚本模型和 Host fixture 边界均保留原标记。失败历史独立保存：环境初始化触发旧绑定拒绝、source isolation state 库分裂及测试类型修复均有后续结果。

同机外部编辑器与不经受管入口的命令属于协议外写入；本叶没有引入文件系统强制隔离。TF-0866 负责保留逻辑会话的环境迁移；UI 原剩余验收和 TF-0867 总体验收继续。
