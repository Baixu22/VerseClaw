# ClawX / Verse Claw 攻击链（重新审计版）

绑定 HEAD 60061e33554311ac3c9871195210df59fe1b5bf2 与 dirty patch sha256:bf430bf565518462e04a84392e547ffe02656569a1a3be1c227073cc13d68e42。

| ID | 链路 | 状态 | Finding |
|---|---|---|---|
| AC-01 | Renderer compromise → getApiKey | 前提未完成 L4；边界缺口已证 | F-SEC-002/005/010 |
| AC-02 | Files arbitrary read → local secret exfil | 静态可达 | F-SEC-004 |
| AC-03 | openExternal custom scheme | 旁路已证，利用未跑 | F-SEC-003/REL-004 |
| AC-04 | Prompt Injection → heuristic controls | 静态缺口已证 | F-AUTH-003/004/005 |
| AC-05 | SEKB raw persistence → retrieval | 条件可达，canary 未跑 | F-DATA-001/004/005 |
| AC-06 | Cron fallback/repair → authority corruption | 逻辑已证，故障注入未跑 | F-REL-001/002 |
| AC-07 | Browser first-response → cross-session race | multi-window harness 未跑 | F-REL-003 |
| AC-08 | unsigned prerelease/unproven feed → update tamper | 静态发布缺口已证 | F-SUPPLY-001/002 |
| AC-09 | acceptEdits/policy-light → workspace mutation | 默认策略已证 | F-AUTH-001/ISO-001 |
| AC-10 | approved request → concurrent double consume | L4 已证 | F-AUTH-006 |
| AC-11 | lexical-inside → junction-realpath-outside → write | L4 已证 | F-SEC-006 |
| AC-12 | Feishu/WeCom open/* → untrusted inbound prompt | L3 已证 | F-AUTH-008 |
| AC-13 | MCP UI policy omitted at runtime | L3 已证 | F-AUTH-009 |
| AC-14 | session delete → derivative residue | L3 已证 | F-DATA-005 |
| AC-15 | unbounded logger → disk exhaustion | L3 已证 | F-REL-005 |
| AC-16 | unpinned binary/installer → build compromise | L3 已证 | F-SUPPLY-002 |

“已证”只表示指定控制或缺口有源码/L4 证据，不表示生产环境已被成功利用。
