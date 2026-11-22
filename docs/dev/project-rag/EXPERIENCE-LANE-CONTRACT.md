# 已确认经验检索与采用归因

Runtime Lessons 通过现有 SEKB owner 检索已确认且启用的原则。候选携带 `SourceRef/v2`，固定 SEKB 存储 namespace、canonical principle ID、公开内容版本、原文 digest、权限 epoch 与 UTF-8 范围。`sekb:<id>` 直接解析 ID；标题和引用行 ID 不替代目标。

检索需要确认来源中的 session、source system、integrity、确认时间和 revoke key。仅有 active 状态、标题、标签或 pinned/criticality 不能产生相关内容命中。Project RAG 的受控检索复用 RetrievalEngine 的独立 confirmed-content 模式；历史 RSI 检索策略保留原定义。

来源读服务复验 SEKB 开关、确认状态、scope、ACL、sensitivity、retention 和当前 session generation。正文及行为字段改变会产生新内容版本；检索和采用计数不改变内容版本。SourceSet、Studio 和知识页通过受限的 Host/Gateway owner 路径回源，拒绝无 pin 经验和冲突的 corpus。Runtime Lessons 仍为显式选择，自动读取不会从单次排名推导授权。

归因复用 `sekb_attribution_events` SQLite 表与同 run 事务：

| 记录 | 依据 |
|---|---|
| UI exposure | 通过 owner 准入并由当前界面确认收到的候选；超时、取消、过期或身份切换的结果不写曝光 |
| Context exposure | 当前 attempt 的已封存 DCS 收据中实际保留的经验 pin，使用独立 context-exposure 事件 |
| Citation | 模型对已曝光经验 ID 和版本的显式引用 |
| Adoption | 同一 task/run/session 下已观察到的成功工具操作，以及模型的显式采用归因 |
| Operational outcome | agent 终止或取消事件，未知结果保留 unknown |
| Independent task grade | 独立 grader 的任务结果记录 |

界面展示不会授权采用；运行完成不会增加独立任务成功数。重复归因幂等处理，冲突重放保留拒绝记录。Project RAG 的 DCS 路径不再通过 SEKB hook 追加另一份经验正文；采用工具通过与其他工具相同的 run、角色和 sandbox 权限过滤进入会话。

采用前重新核对当前内容版本和权限 epoch。原则硬删除清除其归因记录；会话删除清除该会话的展示和运行收据，包括其他会话确认的原则在当前会话中的使用记录。该操作保留其他会话的原则。

知识页分别展示界面曝光、上下文曝光、引用、采用、运行结果、独立任务评分和未知运行结果。关闭 SEKB 后，检索和固定引用回读停止，原有原则及历史收据保留。
