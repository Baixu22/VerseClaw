# Veto Gates

Any hard veto sets the decision to `needs_revision` or `blocked_by_unrelated_dirty_worktree`; total score cannot override a veto.

| Veto | Required result | Evidence |
|---|---|---|
| default-on behavior appears | 0 occurrences | Specs, flags, and boundary scans |
| provider ordering drift > 0 | 0 drift | Context provider/registry tests and scans |
| leakage_count > 0 | 0 leakage | Sample matrix, sentinel tests, and boundary scans |
| fail-closed rate < 100 percent | 100 percent fail-closed | Sample matrix and focused tests |
| renderer bypass > 0 | 0 direct IPC/Gateway matches | Renderer bypass scan |
| AST mutation/apply/write surface appears | 0 implementation matches | AST mutation/apply/write scan |
| TaskLoop/Gateway/provider transport authority drift | 0 implementation matches | Authority and transport scans |
| rollback drill fails | 0 failures | Flag omission and explicit-input rollback paths |
| required validation missing without blocked reason | 0 missing unexplained validations | Final synthesis command table |
| registry diagnostic persistence appears | 0 implementation matches outside in-memory/test-owned sinks | Registry persistence scan |
| services/listeners/daemons/servers/databases appear | 0 implementation matches | Service/listener/database scan |
| MCP response shape or approval/retry/error semantics change | 0 behavioral drift | MCP/tool-provider focused tests |
| preview diff, match count, candidate text, or diagnostics used as task completion proof | 0 occurrences | AST spec, sample matrix, and tests |
