# OpenHands Runtime Events

## Event Service

证据源：`C:\Users\27933\Desktop\verseshell\OpenHands-main\openhands\app_server\event\event_service.py`、`event_service_base.py`、`filesystem_event_service.py`。

`EventService` 抽象方法包括：

- `get_event(conversation_id, event_id)`
- `search_events(conversation_id, kind__eq, timestamp__gte, timestamp__lt, sort_order, page_id, limit)`
- `count_events(...)`
- `iter_events_for_export(conversation_id)`
- `save_event(conversation_id, event)`
- `batch_get_events(conversation_id, event_ids)`

`EventServiceBase` 会按 conversation path 搜索 event JSON，并对读取做并发限制。timestamp filters 被转成 ISO string 与 event.timestamp 比较，分页应用在过滤后的 items 上。

## Event Callback

证据源：`event_callback\event_callback_models.py`、`event_callback\webhook_router.py`。

`EventCallbackStatus`: ACTIVE、DISABLED、COMPLETED、ERROR。`EventCallbackProcessor` 以 event_kind 过滤事件，调用后返回 `EventCallbackResult`。

`on_event` webhook 做四件事：

1. 保存所有 event。
2. 对 stats event 更新 conversation statistics。
3. 对 SwitchLLMObservation 更新 conversation llm_model。
4. 对 terminal execution_status 做 analytics，再后台顺序执行 callbacks。

## ClawX Runtime Event Log

ClawX 应吸收：

- event append 与 search/count/export 分离。
- event kind + timestamp filters。
- pagination 必须作用于过滤后的结果。
- callbacks 顺序执行，避免外部副作用并发竞态。
- stats/metrics 作为 event 派生状态，而不是散落在 UI。
