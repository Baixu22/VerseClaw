# Project RAG 配置与索引运维

设置 → 模型与服务的“知识运维”面板管理当前工作区的索引、默认检索方案和回答策略。来源与来源集在知识库中选择；embedding、向量后端和重排继续使用同页的模型运维入口。

配置由 memory-wiki 的严格 schema 解析，保存在 `plugins.entries.memory-wiki.config.retrieval`。Main 先校验输入，再以当前 `config.get` 的 base hash 调用 `config.patch`。面板等待 Gateway 重启后的真实配置回读。

| 配置 | 默认值 | 有效范围 |
|---|---|---|
| profile | local | local / quality / research |
| answerMode | strict | strict / open |
| maxStorageBytes | 536870912 | 1048576 至 68719476736 的整数字节数 |

`ProjectRagConfig/v2` 是解析后的数据契约。mode、scope、session 和来源集属于每次请求，不在配置中双存；未知配置键直接拒绝。缺省 profile 从 owner 配置读取，Main 的配置读取阶段有 900 ms 上限，最终查询按所选方案的总期限执行；显式 profile 保留原有期限。知识助手初始化时读取默认回答策略，用户的当前选择优先。

```json
{
  "plugins": {
    "entries": {
      "memory-wiki": {
        "config": {
          "retrieval": {
            "profile": "local",
            "answerMode": "strict",
            "maxStorageBytes": 536870912
          }
        }
      }
    }
  }
}
```

读取身份由 Main 根据已登记的工作区、会话及实际会话代际生成。返回状态前再次检查身份；切换工作区或会话代际后，旧响应不会成为当前结果。其他工作区未启用的索引状态显示 disabled，来源与作业清单为空；启用、暂停、恢复、重建和读取继续检查对应 owner。

`RetrievalCapabilitySnapshot/v1` 同时回读配置、来源 owner、`IndexStatus/v1`、embedding、向量和重排状态：

| 状态 | 条件 |
|---|---|
| disabled | 当前 owner 未启用索引 |
| enabled | 索引已启用，等待有效来源代际 |
| ready | 当前方案需要的索引与模型能力就绪 |
| degraded | 索引暂停、滞后、失败、超出空间预算，或所选方案缺少模型能力 |

暂停意图写入既有 SQLite plugin state。暂停会停止新 worker 并取消当前 worker；文件变更继续使旧代际失效，查询仍检查当前 owner 权限与原文 pin。重启先恢复暂停意图；恢复后重新同步并发布新代际。历史失败作业保留，当前能力状态只统计当前来源 intent 的失败。

空间预算核对实际 SQLite 数据库、WAL 和 SHM 字节。预算限制代际发布；staging 的磁盘占用仍计入状态。已删除或撤权的来源先失去检索资格，后台 worker 再清理旧代际记录。清理保留当前有效代际，SQLite 已分配的文件空间可能由后续写入复用；面板分别显示逻辑删除、待清理代际与实际磁盘占用。索引关闭后，未加载的磁盘占用显示不可用。

共享 WAL 的检查点由长期运行的数据库 owner 维护。索引和向量 worker 退出时关闭自己的数据库句柄，避免每个作业都执行 TRUNCATE 检查点并等待其他读取者，阻塞后续索引与 Gateway 请求。

Host 操作与 Gateway 对应关系：

| Host | Gateway |
|---|---|
| operationsStatus | wiki.operations.status |
| operationsConfigure | config.get → config.patch |
| indexEnable / indexDisable | wiki.index.start / stop |
| indexPause / indexResume | wiki.index.pause / resume |
| indexRebuild / indexReconcile | wiki.index.rebuild / reconcile |
| indexCleanup | wiki.index.idle |

`openclaw wiki doctor` 输出同一份解析后配置，`openclaw doctor --fix` 继续执行既有 bridge 配置迁移。回滚时恢复 local、strict 和上一已验证空间预算，再同步或重建；关闭索引保留 owner 原文和已存代际。功能验证使用 `project-rag-config-parity.test.ts`、`project-rag-settings-operations.spec.ts` 及同候选的模型生命周期回归。
