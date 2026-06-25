# OpenHands -> ClawX Mapping

Source Concept: conversation start task status  
ClawX Target: Mission/task startup state machine  
Reuse Level: copy idea  
Dependencies: sandbox/workspace setup service、plugin/skill loader、event log  
Risks: 启动状态和运行状态混在一起会让 UI/agent 判断混乱。  
First Implementation Slice: 为 ClawX task startup 建模 `preparing_workspace/setup_skills/starting_runtime/ready/error`。  
Tests Needed: 状态顺序、错误 detail、ready 后 conversation id/sandbox id 填充。

Source Concept: event service search/filter/export  
ClawX Target: Runtime event log and Evidence Verifier  
Reuse Level: adapt code  
Dependencies: event store、event kind taxonomy、timestamp index  
Risks: 事件分页或过滤错误会导致 verifier 漏证据。  
First Implementation Slice: JSONL/SQLite 事件表，支持 kind/timestamp/page 查询和 export。  
Tests Needed: kind filter、timestamp filter、pagination no duplicates、export order。

Source Concept: event callbacks and terminal status tracking  
ClawX Target: verifier hooks and automation callbacks  
Reuse Level: rewrite  
Dependencies: callback registry、terminal state detector、metrics updater  
Risks: callback 副作用并发执行会竞态；错误分类不能只靠字符串。  
First Implementation Slice: terminal task event 触发 verifier summary callback，失败不阻断事件保存。  
Tests Needed: callback success/error、terminal state detection、metrics event update。
