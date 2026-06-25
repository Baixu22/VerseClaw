# OpenHands Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\OpenHands-main\tests\unit\app_server`。

## 值得移植的测试形态

- event search 返回全部事件。
- 空 conversation 返回空 page。
- 按 kind 过滤。
- timestamp ascending/descending 排序。
- export iterator 按 timestamp 返回且不重复。
- pagination limit、next_page_id、跨页无重复。
- pagination 与 filters 同时生效。
- timestamp__gte / timestamp__lt 过滤。
- batch_get 对缺失 event 返回 None。
- conversation URL 对不同 agent_kind 使用统一路径。
- secrets/request.secrets 与 agent_context.secrets 的边界。
- hooks loading 成功、空、404、HTTP error。

## ClawX 应新增 fixture

- task event log search/filter/export。
- resume 从 event log 重建状态。
- terminal state evidence 包含 last_error 和 metrics。
- callback 失败不会阻断 event 保存。
- pagination 在 filtered items 上应用，避免重复页。
