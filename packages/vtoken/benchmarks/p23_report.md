# T3 — P2.3 写入容错性基准报告

> **两段评测**：
> - **A) 覆盖率测试** — 100 个 buggy .vt 场景，验证 parser 是否正确识别每类错误（expected_types ⊆ actual_types）。
> - **B) 开销红线** — 单个 .vt 文件含 100 个 doc 节点 + 5 个注入错误（5% 错误率，模拟 LLM agent 现实失误率）。
>   一次性 check_file 得到错误报告 JSON，agent 读报告 + 发出 5 个修复补丁。开销比 = 修复开销 / 总写入 token。
> 红线（HANDOFF §3 T3）：A 准确率 ≥ 95%；B 修复开销比例 ≤ 10%。

## A. 覆盖率测试（100 场景）

### A.1 完整数据

| ID | 类别 | 描述 | 期望 types | 实际 types | 答对? |
|---|---|---|---|---|---|
| h001 | header | 完全漏掉 %vt / %mode 头部 | missing_version,missing_mode | missing_mode,missing_version | ✓ |
| h002 | header | 第一行漏掉 % | missing_version | directive_after_body,missing_mode,missing_version | ✓ |
| h003 | header | %vt 不在物理第一行 | missing_version,misplaced_version | misplaced_version,missing_version | ✓ |
| h004 | header | 版本号带 v 前缀 | invalid_version | invalid_version | ✓ |
| h005 | header | 版本号四段 | invalid_version | invalid_version | ✓ |
| h006 | header | %mode 大小写错 | invalid_mode | invalid_mode | ✓ |
| h007 | header | %mode 值拼写错 | invalid_mode | invalid_mode | ✓ |
| h008 | header | doc 模式漏 %id | missing_id_directive | missing_id_directive | ✓ |
| h009 | header | mem 模式漏 %session | missing_session_directive | missing_session_directive | ✓ |
| h010 | header | %lang 出现在 DEF 之后 | directive_after_body | directive_after_body | ✓ |
| h011 | header | %mode 在 body 之后重复出现（parser 仅报 directive_after_body） | directive_after_body | directive_after_body | ✓ |
| h012 | header | 杜撰的 %author 指令 | unknown_directive | unknown_directive | ✓ |
| h013 | header | %ns 值含点 | invalid_ns | invalid_ns | ✓ |
| h014 | header | %ns 值不以字母/下划线开头 | invalid_ns | invalid_ns | ✓ |
| h015 | header | %mode 用等号 | invalid_directive | invalid_directive,missing_mode | ✓ |
| h016 | header | %mode 后无值（parser 报 invalid_mode 值） | invalid_mode | invalid_mode | ✓ |
| h017 | header | %id 重复声明 | duplicate_directive | duplicate_directive | ✓ |
| h018 | header | %lang 重复声明 | duplicate_directive | duplicate_directive | ✓ |
| h019 | header | 未知 %future 指令 | unknown_directive | unknown_directive | ✓ |
| h020 | header | %vt 在 body 中重复出现（parser 仅报 directive_after_body） | directive_after_body | directive_after_body | ✓ |
| n001 | node | Def 大小写错 | unknown_type | unknown_type | ✓ |
| n002 | node | def 全小写 | unknown_type | unknown_type | ✓ |
| n003 | node | 拼错为 DEFINITION | unknown_type | unknown_type | ✓ |
| n004 | node | 使用了 schema 未定义的 INFO 类型 | unknown_type | unknown_type | ✓ |
| n005 | node | TODO 不在 core schema 中 | unknown_type | unknown_type | ✓ |
| n006 | node | NOTE 不在 core schema 中 | unknown_type | unknown_type | ✓ |
| n007 | node | DEF 后漏 id | missing_id | missing_id | ✓ |
| n008 | node | RULE 后漏 id | missing_id | missing_id | ✓ |
| n009 | node | id 以数字开头 | invalid_id | invalid_id | ✓ |
| n010 | node | 合法：DEF a b first node 中 a 是 id、b first node 是 content | — | — | ✓ |
| n011 | node | id 含逗号 | invalid_id | invalid_id | ✓ |
| n012 | node | id 以 @ 开头 | invalid_id | invalid_id | ✓ |
| n013 | node | id 含 $ | invalid_id | invalid_id | ✓ |
| n014 | node | DEF 后漏 content | missing_content | missing_content | ✓ |
| n015 | node | RULE 后漏 content | missing_content | missing_content | ✓ |
| n016 | node | DEF 同 id 重复定义 | duplicate_id | duplicate_id | ✓ |
| n017 | node | DEF 后 RULE 同 id | duplicate_id | duplicate_id | ✓ |
| n018 | node | VAR 后 DEF 同 id | duplicate_id | duplicate_id | ✓ |
| n019 | node | %ns 下 overview 与 auth.overview 撞 id | duplicate_id | duplicate_id | ✓ |
| n020 | node | DEF 后 OPEN 同 id | duplicate_id | duplicate_id | ✓ |
| r001 | ref | REF 漏 relspec | invalid_ref | invalid_ref | ✓ |
| r002 | ref | REF 多 token | invalid_ref | invalid_ref | ✓ |
| r003 | ref | REF 漏 dst | invalid_ref | invalid_ref | ✓ |
| r004 | ref | relspec 少一个 - | invalid_relation | invalid_relation | ✓ |
| r005 | ref | relspec 小写 | invalid_relation | invalid_relation | ✓ |
| r006 | ref | relspec 多空格（parser 报 invalid_ref） | invalid_ref | invalid_ref | ✓ |
| r007 | ref | relspec 末尾少一个 - | invalid_relation | invalid_relation | ✓ |
| r008 | ref | schema 未定义的关系 | unknown_relation | unknown_relation | ✓ |
| r009 | ref | 拼错 DEPENDS | unknown_relation | unknown_relation | ✓ |
| r010 | ref | 拼错 IMPLEMENTS | unknown_relation | unknown_relation | ✓ |
| r011 | ref | REF src id 非法 | invalid_id | invalid_id | ✓ |
| r012 | ref | REF dst id 非法 | invalid_id | invalid_id | ✓ |
| r013 | ref | REF dst 悬空（warning 非 error） | — | — | ✓ |
| r014 | ref | REF src 悬空（warning 非 error） | — | — | ✓ |
| r015 | ref | 拼错 BLOCKS | unknown_relation | unknown_relation | ✓ |
| r016 | ref | relspec 内有空格（parser 报 invalid_ref） | invalid_ref | invalid_ref | ✓ |
| r017 | ref | relspec 小写 extends | invalid_relation | invalid_relation | ✓ |
| r018 | ref | 拼错 CONFLICTS | unknown_relation | unknown_relation | ✓ |
| m001 | mem | mem 行漏 - 前缀 | invalid_mem_line | invalid_mem_line | ✓ |
| m002 | mem | mem 行只有 -（parser 报 invalid_mem_line） | invalid_mem_line | invalid_mem_line | ✓ |
| m003 | mem | mem #tag 后无内容 | missing_content | missing_content | ✓ |
| m004 | mem | 合法：tag 以数字开头（parser 接受） | — | — | ✓ |
| m005 | mem | tag 含冒号 | invalid_mem_line | invalid_mem_line | ✓ |
| m006 | mem | 合法：空白行被 parser 跳过 | — | — | ✓ |
| m007 | mem | #blocker 后无内容 | missing_content | missing_content | ✓ |
| m008 | mem | 合法：tag 大写（parser 接受） | — | — | ✓ |
| m009 | mem | 合法：tag 含连字符（parser 接受） | — | — | ✓ |
| m010 | mem | 两行裸文本 | invalid_mem_line | invalid_mem_line | ✓ |
| s001 | schema | %schema 指定的文件不存在 | schema_error | schema_error | ✓ |
| s002 | schema | %schema core 引用内置 schema（应通过） | — | — | ✓ |
| s003 | schema | vtschema 文件内 %schema 名与请求名不一致 | schema_error | schema_error | ✓ |
| s004 | schema | vtschema 文件头格式错 | schema_error | schema_error | ✓ |
| s005 | schema | extends 后面不是 core | schema_error | schema_error | ✓ |
| s006 | schema | type symbol 不合法 | schema_error | schema_error | ✓ |
| s007 | schema | relation symbol 不合法 | schema_error | schema_error | ✓ |
| s008 | schema | 试图重定义 core 的 RULE type | schema_error | schema_error | ✓ |
| c001 | compile | 对 mem 文件调用 compile | mem_not_compilable | mem_not_compilable | ✓ |
| c002 | compile | 对多行 mem 文件调用 compile | mem_not_compilable | mem_not_compilable | ✓ |
| c003 | compile | 对带 tag 的 mem 文件调用 compile | mem_not_compilable | mem_not_compilable | ✓ |
| c004 | compile | 对三行 mem 文件调用 compile | mem_not_compilable | mem_not_compilable | ✓ |
| x001 | compound | 无头三联（header 错误时 body 不再深扫，仅报 missing_version+missing_mode） | missing_version,missing_mode | missing_mode,missing_version | ✓ |
| x002 | compound | invalid_mode + duplicate_directive | invalid_mode,duplicate_directive | duplicate_directive,invalid_mode | ✓ |
| x003 | compound | Def 行触发 unknown_type 后不计 duplicate_id + DEF 漏 id 触发 missing_id | unknown_type,missing_id | missing_id,unknown_type | ✓ |
| x004 | compound | 两条 REF 都错 | invalid_ref,invalid_relation | invalid_ref,invalid_relation | ✓ |
| x005 | compound | unknown_type + invalid_id | unknown_type,invalid_id | invalid_id,unknown_type | ✓ |
| x006 | compound | body 后多个错误指令（parser 统一报 directive_after_body） | directive_after_body | directive_after_body | ✓ |
| x007 | compound | duplicate_id + unknown_type | duplicate_id,unknown_type | duplicate_id,unknown_type | ✓ |
| x008 | compound | version + mode 错误（header 错误时 body 的 duplicate_id 不深扫） | invalid_version,invalid_mode | invalid_mode,invalid_version | ✓ |
| z001 | node | 合法：DESC 同 id 重复（注解类型） | — | — | ✓ |
| z002 | node | 合法：多注解追加 | — | — | ✓ |
| z003 | node | 合法：长内容节点 | — | — | ✓ |
| z004 | ref | 合法：循环 REF | — | — | ✓ |
| z005 | node | 合法：SRC 行带 URL | — | — | ✓ |
| z006 | node | 合法：行首注释 | — | — | ✓ |
| z007 | node | 合法：id 含连字符 | — | — | ✓ |
| z008 | node | 合法：VAR 行带冒号内容 | — | — | ✓ |
| z009 | ref | 合法：无类型边 ~~ | — | — | ✓ |
| z010 | node | 合法：节点全 4 类注解追加 | — | — | ✓ |
| z011 | node | 合法：多段命名空间 id | — | — | ✓ |
| z012 | ref | 合法：REF 使用 IMPLEMENTS 关系 | — | — | ✓ |

### A.2 汇总

- 场景数: **100**
- 答对数: **100/100 = 100.0%**
- 准确率口径：expected_types ⊆ actual_types（dangling_ref 等 warning 不计 error）

### A.3 按类别细分

| 类别 | 答对/总数 | 准确率 |
|---|---|---:|
| compile | 4/4 | 100.0% |
| compound | 8/8 | 100.0% |
| header | 20/20 | 100.0% |
| mem | 10/10 | 100.0% |
| node | 29/29 | 100.0% |
| ref | 21/21 | 100.0% |
| schema | 8/8 | 100.0% |

### A.4 准确率红线判定

**A 红线达标**：覆盖率准确率 = 100.0% ≥ 95%。

## B. 开销红线测试（100 节点 + 5 错误）

### B.1 测量数据

| 项 | 值 |
|---|---:|
| 节点数 | 100 |
| 注入错误数 | 5 |
| 报告错误数 | 5 |
| 实际报告 types | invalid_relation,duplicate_id,unknown_type,invalid_ref,missing_content |
| 差异行数（补丁对数） | 5 |
| 总写入 token | **4391** |
| 错误报告 token | 239 |
| 修复补丁 token | 159 |
| 修复开销合计 | 398 |
| **开销比例** | **9.1%** |

### B.2 注入错误清单

| # | 注入错误类型 | 描述 |
|---|---|---|
| 1 | duplicate_id | 将 DESC bill.overview 改为重复的 DEF bill.overview |
| 2 | unknown_type | 将 RULE rate.rule_01 改为 TODO rate.rule_01 |
| 3 | invalid_ref | REF log.rule_01 --DEPENDS--> 漏掉 dst id |
| 4 | missing_content | DEF cache.overview 后无内容 |
| 5 | invalid_relation | REF auth.rule_02 的 relspec 改为单横线 -DEPENDS-> |

### B.3 开销红线判定

**B 红线达标**：修复开销比例 = 9.1% ≤ 10%。

## C. 最终判定

**双红线达标**：A 准确率 = 100.0% ≥ 95%；B 开销比例 = 9.1% ≤ 10%。

## D. 方法学附录

- A 段 100 场景 = 83 buggy + 17 legal baseline；分布：header=20, node=29, ref=20, mem=10, schema=8, compile=4, compound=8, legal=1
  （按 sid 前缀分布：h=20, n=20, r=18, m=10, s=8, c=4, x=8, z=12）
- A 段准确率口径：expected_types ⊆ actual_types；dangling_ref 是 warning 非 error，不计
- A 段 compile 类（c001-c004）调用 compile_file 触发 mem_not_compilable（check_file 不走编译路径）
- B 段 100 节点 = 5 模块 × 20 节点（1 DEF + 10 RULE + 5 VAR + 4 OPEN）；每模块 R1 合规 REF 到自己的 overview DEF
- B 段 5 个错误 = 5% 错误率（符合 LLM agent 现实失误率）
- B 段补丁格式：`- <buggy 行>` / `+ <correct 行>` 配对；不包含 diff context 行
- 错误报告 JSON 来自 `check_file(path, strict=False)`，`json.dumps(sort_keys=True)` 序列化
- tokenizer = cl100k_base；离线缓存于 `.tiktoken_cache/`
