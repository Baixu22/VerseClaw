# Memobase Schema-based Profile 与 Buffer+Flush 机制研究

## 0. 元信息

- 研究对象：`C:\Users\27933\Desktop\mem\memobase-main`
- 重点技术：Schema-based profile 抽取 + buffer+flush 批量抽取 + profile merge
- 结论等级：可直接作为我们 facts/turn 提升路线的主参考，但不能简单照搬为 ADD-only。
- LoCoMo 结果：Memobase v0.0.37 Overall LLM Judge Score = 75.78%，见 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\locomo-benchmark\README.md:20` 和 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\locomo-benchmark\README.md:28`。

## 1. 一句话结论

Memobase 的高性价比记忆写入不是靠强检索，而是靠“用户级 buffer 聚合 -> 一次 flush 批量摘要 -> schema 槽位抽多条 profile facts -> LLM 批量 merge/validate -> event timeline 追加记录”的写路径，把单轮热路径写记忆改成批处理写记忆。

它的长期 profile 不是细粒度 fact log，而是按 `topic/sub_topic/content` 维护的用户画像槽位；新增事实会被 APPEND/UPDATE/ABORT 合并到对应槽位，event timeline 负责保留每次 flush 的 profile delta 和事件摘要。

## 2. 关键源码索引

- API 入口：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\api.py:170` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\api.py:271`
- Blob 插入与自动 flush 检测：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\blob.py:14`
- Buffer 控制器：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\buffer.py:33`
- Chat flush 主流程：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:38`
- Profile extract：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\extract.py:26`
- Profile merge/validate：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:14`
- Profile DB 写入：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:226`
- Context 检索/打包：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\context.py:115`
- MCP 调用路径：`C:\Users\27933\Desktop\mem\memobase-main\src\mcp\src\main.py:60`

## 3. 总体架构

### 3.1 数据流

```text
ChatBlob/SummaryBlob
  -> /blobs/insert/{user_id}
  -> general_blobs
  -> buffer_zones(idle)
  -> 自动检测 buffer token > 1024 或手工 flush
  -> buffer status: processing
  -> BLOBS_PROCESS[chat|summary]
  -> entry summary
  -> profile extract + event tag 并行
  -> profile merge/validate/organize/resummary
  -> user_profiles add/update/delete
  -> user_events + user_event_gists append
  -> buffer status: done
  -> 默认删除已处理 chat blob
```

关键证据：

- `/blobs/insert/{user_id}` 写入 blob 后调用 `insert_blob_to_buffer`，再调用 `detect_buffer_full_or_not` 判断是否要 flush：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\blob.py:42` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\blob.py:68`。
- buffer flush 按 `BLOBS_PROCESS[blob_type]` 分派，仅支持 chat 和 summary：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\__init__.py:11`。
- chat flush 先 `entry_chat_summary`，再并行 `process_profile_res` 和 `process_event_res`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:58` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:82`。
- profile 写 DB 与 event 写 DB 分离：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:96` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:118`。

### 3.2 为什么它能提高写入密度

Memobase 明确避开 hot-path 每轮写记忆：README 说明它“不在 hot path memoize users”，而是把近期 blobs 放进 buffer，buffer 过大或空闲过久再 flush：`C:\Users\27933\Desktop\mem\memobase-main\readme.md:276` 到 `C:\Users\27933\Desktop\mem\memobase-main\readme.md:280`。

这让一次 LLM extract 面对的是批量聊天摘要，而不是单轮消息；prompt 也要求“list all possible user info, schedule and events”：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\summary_entry_chats.py:9` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\summary_entry_chats.py:12`。

## 4. Profile Schema

### 4.1 存储 schema

数据库中的 `user_profiles` 表字段很薄：

- `id`
- `created_at`
- `updated_at`
- `user_id`
- `project_id`
- `content`
- `attributes` JSONB

证据：`UserProfile` ORM 只定义 `content`、`user_id`、`attributes`、`project_id`，并继承 Base 的 `id/created_at/updated_at`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:102` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:120`，以及 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:418` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:455`。

API 返回 schema：

- `ProfileData.id`
- `ProfileData.content`
- `ProfileData.created_at`
- `ProfileData.updated_at`
- `ProfileData.attributes`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:71` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:83`。

`attributes` 至少要求：

- `topic`
- `sub_topic`

证据：`ProfileAttributes` 只声明这两个字段：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:66` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:69`。

### 4.2 抽取输出 schema

LLM 抽取不是 JSON，而是 Markdown list：

```text
- TOPIC::SUB_TOPIC::MEMO
- ...
```

证据：

- prompt 要求每行 `- TOPIC{tab}SUB_TOPIC{tab}MEMO`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:60` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:81`。
- parser 只接受以 `- ` 开头并且按 `CONFIG.llm_tab_separator` 切成 3 段的行：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\utils.py:217` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\utils.py:231`。
- 默认分隔符是 `::`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:90`。

### 4.3 是否有 entities[] / valid_from / valid_to / superseded_by

没有。

Memobase 当前 profile schema 没有 `entities[]`、`valid_from`、`valid_to`、`superseded_by`。时间信息被 LLM 写进 `content` 文本，例如 `[mention 2025/01/01]`，而不是结构化字段。

证据：

- `ProfileData` 没有上述字段：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:71` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\response.py:83`。
- `UserProfile` 表没有上述列：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:418` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:455`。
- extract prompt 只要求尽量使用具体日期，并区分 mention time 与 event happened time：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:96` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:104`。

## 5. Topic 枚举与 Schema 配置

### 5.1 默认 topic

Memobase 默认 profile topic 不是数据库 enum，而是 prompt/schema 候选槽位。

默认 topic 列表：

- `basic_info`
- `contact_info`
- `education`
- `demographics`
- `work`
- `interest`
- `psychological`
- `life_event`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\user_profile_topics.py:9` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\user_profile_topics.py:78`。

默认 sub_topics 例子：

- `basic_info`: `name`, `age`, `gender`, `birth_date`, `nationality`, `ethnicity`, `language_spoken`
- `work`: `company`, `title`, `working_industry`, `previous_projects`, `work_skills`
- `interest`: `books`, `movies`, `music`, `foods`, `sports`
- `psychological`: `personality`, `values`, `beliefs`, `motivations`, `goals`

### 5.2 自定义 schema

项目可以通过：

- `additional_user_profiles` 扩展默认 schema
- `overwrite_user_profiles` 完全替换默认 schema

证据：

- 配置字段：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:112` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:119`。
- 默认 schema 修改逻辑：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\profile_init_utils.py:18` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\profile_init_utils.py:38`。
- 项目级 profile config 读取逻辑：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\profile_init_utils.py:41` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\profile_init_utils.py:62`。
- 官方文档说明可追加或覆盖 profile slots：`C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile.mdx:38` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile.mdx:54`。

示例：companion schema 用 `basic_info`、`companion_preferences`、`interaction_history`、`personalization` 替换默认 schema：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\example_config\profile_for_companion\config.yaml:5` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\example_config\profile_for_companion\config.yaml:52`。

### 5.3 strict mode

默认 flexible：LLM 可创建新 topic/sub_topic。开启 `profile_strict_mode=true` 后，未在 schema 中定义的 topic/sub_topic 会被过滤。

证据：

- strict mode 配置默认 `False`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:117`。
- extract prompt strict header：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:110` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\extract_profile.py:119`。
- extract 后按 allowed topic/subtopic 过滤：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\extract.py:93` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\extract.py:105`。
- 文档说明 strict mode：`C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile_config.mdx:20` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile_config.mdx:49`。

## 6. Buffer + Flush 机制

### 6.1 Buffer schema

`buffer_zones` 记录：

- `id`
- `created_at`
- `updated_at`
- `blob_type`
- `token_size`
- `user_id`
- `blob_id`
- `status`
- `project_id`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:345` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:408`。

状态枚举：

- `idle`
- `processing`
- `done`
- `failed`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:59` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:63`。

### 6.2 触发阈值

默认配置：

- `buffer_flush_interval = 3600` 秒，即 1 小时
- `max_chat_blob_buffer_token_size = 1024`
- `max_chat_blob_buffer_process_token_size = 16384`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:85` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:87`。

文档也写了典型阈值：`1024 tokens` 或 `1 hour`：`C:\Users\27933\Desktop\mem\memobase-main\readme.md:278` 到 `C:\Users\27933\Desktop\mem\memobase-main\readme.md:280`。

实现中明确检查 token 阈值：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\buffer.py:66` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\buffer.py:94`。

注意：本次源码中没有找到周期任务按 `buffer_flush_interval` 主动扫描 idle buffer 的实现；它存在于 config 和文档中，但当前可见代码路径主要是插入时 token 超阈值触发、手工 `/users/buffer/...` flush、SDK `u.flush()`。

### 6.3 手工 flush 与异步 flush

`/users/buffer/{user_id}/{buffer_type}` 默认后台处理；传 `wait_process=true` 才同步等待。

证据：

- API 参数 `wait_process` 默认 `False`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\buffer.py:10` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\buffer.py:18`。
- `wait_process=true` 直接调用 `flush_buffer_by_ids`，否则添加后台任务：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\buffer.py:32` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\buffer.py:48`。
- Python SDK `flush(sync=False)` 默认异步：`C:\Users\27933\Desktop\mem\memobase-main\src\client\memobase\core\entry.py:165` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\client\memobase\core\entry.py:171`。
- README 说明 `sync=True` 等待 buffer processed：`C:\Users\27933\Desktop\mem\memobase-main\readme.md:249` 到 `C:\Users\27933\Desktop\mem\memobase-main\readme.md:254`。

### 6.4 Flush 后 blob 是否保留

默认 `persistent_chat_blobs=False`，chat blob 被处理后会删除；summary blob 默认不会被这段 chat 删除逻辑删掉。

证据：

- 默认配置：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:76` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:78`。
- flush 完成后如果是 chat 且不持久化，则删除 `GeneralBlob`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\buffer.py:202` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\buffer.py:216`。
- README 说明默认处理后删除 blobs：`C:\Users\27933\Desktop\mem\memobase-main\readme.md:247`。

## 7. 一次 Flush 的 LLM 调用次数

### 7.1 ChatBlob 常规路径

一次 chat flush 的常规 LLM 调用：

1. `entry_chat_summary`: 1 次，把多条 chat blobs 总结成 user memo。
2. `extract_topics`: 1 次，从 memo 中抽多条 `topic/sub_topic/memo`。
3. `merge_yolo`: 1 次，对所有 new memos 批量判断 APPEND/UPDATE/ABORT。
4. `tag_event`: 0 或 1 次。只有配置了 `event_tags` 才调用；无 event tags 时直接返回 `None`。
5. `organize_profiles`: 0 到 N 次。只有某 topic 下 subtopic 数超过阈值才触发。
6. `re_summary`: 0 到 N 次。只有 add/update 的 profile 内容超过 `max_pre_profile_token_size=128` 才触发。

最低常规成本：3 次 LLM；如果配置 event tags，则 4 次；极端情况下 organize/resummary 会追加调用。

证据：

- `entry_chat_summary` 调用 LLM：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\entry_summary.py:43` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\entry_summary.py:54`。
- `extract_topics` 调用 LLM 并一次解析多条 facts：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\extract.py:43` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\extract.py:69`。
- `merge_yolo` 对 `new_memos_input` 一次调用 LLM：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:87` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:103`。
- `event_tags` 为空则不调用 LLM：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\event_summary.py:17` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\event_summary.py:23`。
- organize 仅 topic group 数超过 `max_profile_subtopics` 才调用：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\organize.py:29` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\organize.py:39`。
- resummary 仅 profile token 超过阈值才调用：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\summary.py:29` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\summary.py:42`。

### 7.2 单测样例密度

`test_chat_buffer_modal` 中，2 个 chat blobs 一次 flush，mock extract 返回 4 条 profile facts，最终断言 profile 数为 4、event 数为 1。

证据：

- mock facts 为 4 行：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:12` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:17`。
- 2 个 chat blobs 进入 buffer：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:151` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:198`。
- flush 后 profile=4，event=1：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:205` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\tests\test_chat_modal.py:218`。

注意：这是 mocked LLM 单测，不是生产 benchmark facts/turn。

### 7.3 900 chats 示例密度

公开 900-chat 示例不是 raw fact log，而是合并后的 profile slot 输出。统计 `full_memobase.txt` 中 `* ` profile 行约 28 条；源文件包含 916 messages，脚本每 2 条消息组一个 blob，即 458 个 user+assistant exchange。

证据：

- 脚本每两条 message 组一个 `ChatBlob`：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:24` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:29`。
- 实验说明“combine each user+assistant exchange as a single turn”：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:13`。
- 示例输出是强合并后的 profile，而不是抽取原始 facts：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:39` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:66`。

因此不能从该文件得到 Memobase 的真实 raw facts/turn；只能得到“长期 profile 压缩后约 28 个槽位”的粗粒度结果。

## 8. 是否 ADD-only

结论：Profile 不是 ADD-only；Event timeline 近似 append-only。

### 8.1 Profile 会 update/delete

`merge_yolo` 输出动作：

- `APPEND`
- `UPDATE`
- `ABORT`

证据：

- prompt 明确三类动作：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:30` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:63`。
- `UPDATE` 会重写当前 profile content：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:118` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:143`。
- `APPEND` 如果已有同槽位 profile，会拼接到原 content：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:144` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\merge_yolo.py:169`。
- DB 写入函数同时执行 add、update、delete：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:226` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:316`。

### 8.2 过时 fact 如何处理

Memobase 不用 `valid_to` 或 `superseded_by` 标记过时事实。它依赖 merge prompt 让 LLM 在 `UPDATE` 时重写完整 memo，并保留时间注释。

证据：

- merge prompt 说冲突或需要修改时 update current memo：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:30` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:33`。
- merge prompt 要求保留新旧时间注释：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:114` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\merge_profile_yolo.py:120`。

### 8.3 Event timeline 是追加记录

每次 flush 会 append 一个 `UserEvent`，其中保存：

- `event_tip`
- `event_tags`
- `profile_delta`

证据：

- chat flush 构造 event_data：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:204` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:221`。
- `append_user_event` 新建 `UserEvent`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\event.py:68` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\event.py:164`。

## 9. 时间戳处理

### 9.1 系统时间戳

所有 Base ORM 对象有：

- `created_at`
- `updated_at`

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:102` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:120`。

### 9.2 对话时间

`OpenAICompatibleMessage` 支持可选 `created_at`，用于 prompt 中转换相对日期：

- schema：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\blob.py:7` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\blob.py:12`
- 文档说明 `created_at` optional：`C:\Users\27933\Desktop\mem\memobase-main\docs\site\DOC.md:84` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\site\DOC.md:96`
- summary prompt 要求按 `[TIME]` 转换 today/yesterday/last week 等相对日期：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\summary_entry_chats.py:12` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\prompts\summary_entry_chats.py:23`

### 9.3 valid_from / valid_to

不支持结构化 `valid_from` / `valid_to`。时间被写入 profile `content` 或 event `event_tip` 的文本中。

## 10. Topic 过滤检索

### 10.1 `user.context(prefer_topics=[...])` 如何实现

SDK 把 `prefer_topics` 作为 query 参数传给 `/users/context/{user_id}`：

- Python SDK context 参数组装：`C:\Users\27933\Desktop\mem\memobase-main\src\client\memobase\core\entry.py:355` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\client\memobase\core\entry.py:410`
- API 层接收 `prefer_topics`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\context.py:12` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\api_layer\context.py:23`
- controller 把 `prefer_topics` 传给 `truncate_profiles`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\context.py:148` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\context.py:160`

### 10.2 topic 过滤是先过滤还是后过滤

Profile 侧流程：

1. 从 DB/Redis 拿全部 profile。
2. 如果传了 `chats` 且 `full_profile_and_only_search_event=False`，先用 LLM 做相关 profile 筛选。
3. 再 `truncate_profiles` 做 topic 排序、only_topics 过滤、max_subtopic_size、topic_limits、token 截断。

证据：

- context 中 profile 获取流程：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\context.py:31` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\context.py:83`。
- `prefer_topics` 是排序置顶，不是过滤：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:21` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:35`。
- `only_topics` 才过滤：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:36` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:43`。
- token 截断在后面：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:60` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\profile.py:71`。

### 10.3 对 Recall 的影响

- `prefer_topics`：提高指定 topic 在有限 token 窗口内留下来的概率，Recall 风险低。
- `only_topics`：硬过滤，会牺牲被排除 topic 的 Recall。
- `max_subtopic_size/topic_limits`：限制每类 topic 的 subtopic 数，也会牺牲 Recall。

文档也这么定义：`prefer_topics` 是 rank higher，`only_topics` 是 includes only：`C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile_filter.mdx:9` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\site\features\profile\profile_filter.mdx:17`。

### 10.4 是否完全不用向量检索

Profile memory 默认不用向量检索。900-chat 实验说明 Memobase 不对 user memory 使用 embeddings，而是 dynamic profiling 生成 primary/secondary indices，用 SQL 查询取 memory：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:33` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:38`。

但 event/event_gist 支持 pgvector embedding 检索：

- `UserEvent.embedding` 与 `UserEventGist.embedding`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:484` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:486`，以及 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:553` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:555`。
- event gist search 使用 cosine similarity：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\event_gist.py:83` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\event_gist.py:115`。

语义相关性来源：

- profile：schema 槽位、更新时间排序、topic 过滤/优先级、可选 LLM profile filter。
- event：embedding 相似度 + time_range 限制。
- context：profile 与 event/gist 按 token budget 混合打包。

## 11. 多轮与长对话处理

### 11.1 900+ 轮长对话

900-chat 实验做法：

- 从 ShareGPT 取长对话。
- 每个 user+assistant exchange 作为一个 `ChatBlob`。
- 逐个 insert，最后 `u.flush(sync=True)`。
- Memobase 估算 900 turns 成本约 $0.042，耗时 270-300 秒；Mem0 约 $0.24 + embedding，耗时 1683 秒。

证据：

- 实验设置和成本：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:13` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\readme.md:37`。
- 代码每两条消息一组：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:24` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:29`。
- 插入与最后 flush：`C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:49` 到 `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\900-chats\run.py:53`。

### 11.2 Buffer 满后旧记忆是否压缩

两种压缩：

1. 单次 flush 只处理最新 blobs，超过 `max_chat_blob_buffer_process_token_size=16384` 会截断旧 blobs：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:23` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:43`。
2. profile 槽位过长会重摘要到 `max_pre_profile_token_size=128` 附近：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\summary.py:29` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\summary.py:52`。

另有 topic 下 subtopic 过多的 organize 压缩：

- 超过 `max_profile_subtopics=15` 触发 organize：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:88`，`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\organize.py:29` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\organize.py:58`。

### 11.3 Episodic memory 独立通道

有。Memobase 的 episodic memory 对应 `UserEvent` / `UserEventGist`。

示例 `assets/episodic_memory.py` 插入并 flush 后读取 `u.event()`，打印 `event_tip`、`event_tags`、`profile_delta`：`C:\Users\27933\Desktop\mem\memobase-main\assets\episodic_memory.py:31` 到 `C:\Users\27933\Desktop\mem\memobase-main\assets\episodic_memory.py:53`。

profile memory 与 episodic memory 的关系：

- 同一次 flush 产生 profile delta。
- profile delta 合并进 `user_profiles`。
- 同时作为 `UserEvent.event_data.profile_delta` 追加到 event timeline。

证据：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:150` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:182`，以及 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:204` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\controllers\modal\chat\__init__.py:221`。

## 12. 技术1：实体链接 + 第三路检索 + Cross-Encoder 重排

N/A — Memobase 不涉及此技术。

补充说明：

- ROADMAP 计划未来 “Add Social Graph to record user's entities”，说明当前不是已实现能力：`C:\Users\27933\Desktop\mem\memobase-main\ROADMAP.md:1` 到 `C:\Users\27933\Desktop\mem\memobase-main\ROADMAP.md:7`。
- 当前没有 entity linking schema，也没有 cross-encoder rerank 逻辑。
- profile 侧主要是 SQL + topic/subtopic 规则；event 侧是 embedding cosine search。

## 13. 技术2：Schema-based Buffer+Flush + ADD-only 对照

### 13.1 Memobase 已实现的部分

- Schema-based profile slots：已实现。
- Buffer+flush 批处理：已实现。
- 一次输出多条 structured facts：已实现。
- Topic/sub_topic 分类：已实现。
- Event timeline：已实现。
- Profile 检索 topic 过滤/优先级：已实现。

### 13.2 Memobase 未实现或不等价的部分

- ADD-only profile：未实现。Memobase 会 update/delete profile。
- `valid_from/valid_to/superseded_by`：未实现。
- `entities[]`：未实现。
- 原始 fact lineage：弱。chat blob 默认删除，event 保留 profile_delta，但没有 per-fact source span。

### 13.3 对我们当前系统的差异

我们当前系统：

- 抽取：LLM 单轮单条，每轮触发一次，0.3 facts/turn。
- Schema：`{subject, predicate, objectSummary, validAt}`，无 topic 分类。
- 检索：BM25 + Vector RRF，无 topic 过滤。
- 时间：只有 `validAt`，无 `valid_to/superseded_by`。

Memobase 参考：

- 抽取：批量聊天 -> summary -> 一次抽多条 `topic/sub_topic/memo`。
- Schema：slot schema 先行，topic/subtopic 作为主组织维度。
- 检索：profile 默认不依赖向量，靠 SQL/规则/topic/token；event/gist 才向量检索。
- 时间：文本时间注释 + event created_at；缺少结构化有效期。

## 14. 技术3：轻量图遍历 + 周期性 Reflect

N/A — Memobase 不涉及此技术。

补充说明：

- Memobase 有 event timeline 与 event gist embedding search，但没有图节点/边、图遍历、周期性 reflect 任务。
- ROADMAP 中 “Add Social Graph” 是未来计划，不是当前实现：`C:\Users\27933\Desktop\mem\memobase-main\ROADMAP.md:5`。

## 15. 不可直接借鉴点

1. 不能照搬为 ADD-only。Memobase 的质量依赖 LLM merge 对 profile 槽位做 UPDATE/APPEND/ABORT；如果我们需要 ADD-only，需要额外设计 supersession 层。
2. 不要照搬“时间写文本”。Memobase 时间在 content 中，方便 prompt，但不利于结构化 temporal query；我们应保留 `valid_from/valid_to/superseded_by`。
3. 不要照搬“profile 默认不用向量”。Memobase profile schema 很强、槽位短；我们如果已有 BM25+Vector RRF，可以把 topic 过滤作为 pre/post filter，而不是移除向量。
4. 不要依赖 `gpt-4o-mini/gpt-4o` prompt 效果。Memobase 默认模型是 `gpt-4o-mini`，示例 config 常用 `gpt-4o`：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:100` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\env.py:102`，以及 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\example_config\profile_for_companion\config.yaml:1` 到 `C:\Users\27933\Desktop\mem\memobase-main\src\server\api\example_config\profile_for_companion\config.yaml:4`。
5. 不要照搬 pgvector 依赖。event search 依赖 PostgreSQL pgvector：`C:\Users\27933\Desktop\mem\memobase-main\src\server\api\memobase_server\models\database.py:40`。
6. 不要认为 1h idle flush 已在当前源码中完整落地。配置与文档存在，但本次可见实现主要是 token 阈值触发和手工 flush。

## 16. 迁移设计建议

### 16.1 建议新增 profile schema

在现有 `{subject, predicate, objectSummary, validAt}` 外，增加：

```ts
type MemoryProfileFact = {
  id: string
  userId: string
  topic: string
  subTopic: string
  content: string
  entities: string[]
  validFrom?: string
  validTo?: string
  observedAt: string
  sourceTurnIds: string[]
  supersededBy?: string
  confidence?: number
}
```

与 Memobase 的差异：

- 保留 `topic/subTopic/content` 作为槽位组织。
- 增加 `entities[]`，给技术1实体链接做第三路检索。
- 增加 `validFrom/validTo/supersededBy`，补足 Memobase temporal 弱点。
- 保留 `sourceTurnIds`，避免 Memobase 默认删 blob 后 lineage 不足。

### 16.2 建议新增 buffer+flush

核心规则：

- 每轮 chat 只写 buffer，不立即抽取。
- 触发条件：
  - buffer token >= 1024
  - session close/manual flush
  - idle >= 1h
- 单次处理窗口上限：可参考 16k tokens。
- flush LLM pipeline：
  1. 批量 summary，列出所有 user info / schedules / events。
  2. schema-based extract，一次输出多条 facts。
  3. merge/supersession 判定，但不物理覆盖旧 fact。
  4. 写 ADD-only fact log，同时维护 materialized profile view。

关键取舍：

- “事实日志”应 ADD-only。
- “profile view”可以像 Memobase 一样 update，用于低延迟 prompt。

### 16.3 建议 prompt 输出格式

Memobase 用文本 list，解析简单但脆弱。我们建议 JSON schema：

```json
{
  "facts": [
    {
      "topic": "interest",
      "subTopic": "music",
      "content": "User likes Queen and uses rock music to learn English.",
      "entities": ["Queen", "English"],
      "validFrom": null,
      "validTo": null,
      "evidence": ["turn-123", "turn-124"],
      "action": "ADD"
    }
  ]
}
```

但保留 Memobase 的关键 prompt 原则：

- 明确 topic/subtopic 指南。
- 允许 flexible schema，但 strict mode 可开。
- 要求一次输出多条。
- 要求时间从相对表达转为具体日期。
- 要求同一 topic/subtopic 内容合并到一个元素，避免重复。

## 17. 最高 ROI 可借鉴点

1. **把写记忆从 per-turn hot path 改成 buffer+flush batch path**  
   这是最直接修复 0.3 facts/turn 的杠杆。先聚合 1024+ tokens，再让 LLM 一次抽多条 facts，比单轮单条天然更密。

2. **引入 topic/subTopic schema，并让 prompt 在 schema 内批量抽取**  
   Memobase 的 topic/subtopic 既是抽取约束，也是检索过滤/裁剪维度。我们当前 schema 缺 topic，导致抽取和检索都少一个高精度控制面。

3. **分离 ADD-only fact log 与 materialized profile view**  
   Memobase profile view 会 UPDATE/APPEND，低延迟好用；但我们应把 raw facts 设计成 ADD-only，并通过 `supersededBy/validTo` 维护历史。这能同时保留 Memobase 的实用性和我们需要的时序可追溯性。

## 18. 风险清单

- LLM merge 误删/误覆盖：Memobase profile update 是强压缩，可能丢历史。
- topic schema 太窄会漏召回；太宽会产生噪音。需要 strict/flexible 双模式。
- idle 1h 自动 flush 在当前源码未看到完整 scheduler，需要我们自己实现可靠后台任务。
- event embedding 检索依赖 embedding provider 和 pgvector，迁移到当前系统时应复用已有 vector infra。
- raw facts/turn 需要我们自己埋点；Memobase 没有公开 raw extraction density 指标。

## 19. 验收口径建议

- 写入指标：
  - `facts_extracted_per_flush`
  - `facts_extracted_per_turn`
  - `facts_added_per_turn`
  - `facts_superseded_per_turn`
  - `flush_llm_calls`
  - `flush_latency_p50/p95`
- 质量指标：
  - LoCoMo overall J
  - temporal category J
  - profile-topic recall
  - stale fact false positive rate
- 对照实验：
  1. 当前 per-turn 单条抽取 baseline。
  2. buffer+flush + JSON schema extract。
  3. buffer+flush + topic filtering retrieval。
  4. buffer+flush + ADD-only supersession。

