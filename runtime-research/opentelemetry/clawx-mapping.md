# OpenTelemetry -> ClawX Mapping

Source Concept: trace/span parent hierarchy  
ClawX Target: `RuntimeTraceContextProvider`  
Reuse Level: copy idea  
Dependencies: trace store、span schema、query/filter API  
Risks: trace 太多会污染 prompt；必须先按任务和时间窗口过滤。  
First Implementation Slice: 将 ClawX task/tool/test 事件记录为 span-like JSON，并提供按 `task.id` 查询。  
Tests Needed: parent-child span、error status、event attributes、trace query budget。

Source Concept: span links  
ClawX Target: resume/evidence linkage  
Reuse Level: copy idea  
Dependencies: run id、checkpoint id、evidence id  
Risks: link 只表达关联，不代表因果；UI/Verifier 不能误读。  
First Implementation Slice: resume 新 run 时链接旧 checkpoint span；verification span 链接 test/tool evidence。  
Tests Needed: resume link、verifier evidence link、跨 trace link 查询。

Source Concept: W3C traceparent propagation  
ClawX Target: renderer/main/gateway/runtime correlation  
Reuse Level: adapt code  
Dependencies: host-api、Gateway proxy、runtime executor  
Risks: renderer 直接调用 Gateway 会绕过 trace 注入。  
First Implementation Slice: Main 进程为 runtime request 注入 trace context，tool result 带回 trace id。  
Tests Needed: host-api request trace id 保留、gateway proxy trace id 保留、tool result trace id 回传。
