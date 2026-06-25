# OpenHands Extraction

证据源：`C:\Users\27933\Desktop\verseshell\OpenHands-main\openhands\app_server\app_conversation\app_conversation_models.py`、`app_conversation_service*.py`、`event\event_service.py`、`event\event_service_base.py`、`event\filesystem_event_service.py`、`event_callback\event_callback_models.py`、`event_callback\webhook_router.py`。本地快照未发现完整 `openhands.sdk` 源码目录；这里不声称提取完整 Planner/Executor runtime。

## 1. Runtime Contract

本快照可见 app-server 侧 contract：

- `AppConversationStartRequest`: conversation_id、initial_message、system_message_suffix、processors、llm_model、git 参数、parent_conversation_id、agent_type、plugins、secrets。
- `AppConversation`: conversation metadata + sandbox_status + execution_status + conversation_url + session_api_key。
- `AppSendMessageRequest/Response`: 后续消息输入，响应包含 success、sandbox_status、message。

## 2. Context Assembly

未在本地证据中发现成熟 context assembly 算法。可提取的是 conversation metadata：selected_repository、selected_branch、git_provider、tags、parent/sub conversations、metrics，这些可作为 runtime context envelope。

## 3. Tool Invocation

本地证据中没有完整 agent tool invocation。可见的是 plugin spec：conversation start 可携带 plugins，插件加载后 skills/MCP config 合并进 agent。还可见 hooks endpoint，用于加载 workspace hooks。

## 4. State Machine

`AppConversationStartTaskStatus` 明确建模启动流程：

`WORKING -> WAITING_FOR_SANDBOX -> PREPARING_REPOSITORY -> RUNNING_SETUP_SCRIPT -> SETTING_UP_GIT_HOOKS -> SETTING_UP_SKILLS -> STARTING_CONVERSATION -> READY | ERROR`

运行态通过 `ConversationExecutionStatus` 从 SDK 导入，app-server 在 webhook 中处理 start/pause/resume/delete 和 execution_status terminal detection。

## 5. Checkpoint / Resume

事件服务以 conversation_id 存储 event JSON，filesystem implementation 路径为 persistence/user/v1_conversations/conversation_id/event_id.json。`EventServiceBase` 支持 search、count、batch get、export iterator。resume 证据来自 event log 和 conversation info，而不是内存对象。

## 6. Verifier / Evidence

`webhook_router.py` 保存 event stream events，处理 stats event 更新 metrics，检测 `execution_status` 终态并上报 analytics。`_classify_error_type` 将错误粗分为 budget_exceeded、model_error、runtime_error、timeout、user_cancelled、unknown。

## 7. Tests / Fixtures

`tests\unit\app_server\test_filesystem_event_service.py` 覆盖 event search/filter/sort/pagination/export/timestamp。`test_live_status_app_conversation_service.py` 覆盖 conversation URL、secret injection、hooks loading、sandbox 状态。`test_event_router.py`、`test_app_conversation_service_base.py` 等覆盖路由和服务边界。
