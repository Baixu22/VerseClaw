# Verse Token 建图规范（authoring guide）

> 适用范围：`%mode doc` 知识库文件。`%mode mem` 会话记忆不在此约束内。
> 配套：[DECISIONS.md](../DECISIONS.md) D1–D25、[HANDOFF.md](../HANDOFF.md) §2.3 S1。
>
> 本规范的存在理由（S1）：**局部检索的质量上限 = 建图纪律**。格式本身救不了稀疏图——
> 若 RULE 节点与所属模块 DEF 之间没有任何边，从 DEF 出发 `type_filter=["RULE"]` 一条都拉不到，
> P2.2 测出来的就是烂图而不是格式问题。本规范把建图纪律写成可机械检验的规则。

---

## 1. 强制规则（违反视为建图错误）

### R1 — 每 RULE 必须 REF 到所属模块的 DEF

每一条 `RULE <module>.<rule_id>` 必须存在至少一条同模块的 `REF <rule> --*--> <module>.<def_id>` 边，
把规则挂到模块定义上。否则该 RULE 在 `resolve(depth=2)` 时无法从模块入口被检索到。

关系选用：
- 规则约束模块的实现 → `--DEPENDS-->`（最通用）
- 规则被模块外的代码强制执行 → `--ENFORCED-BY--> <外部节点>`
- 规则只是参考 → `--SEE-->`

```vt
# 合规
DEF auth.overview   JWT 认证模块
RULE auth.token_ttl access token 有效期不得超过 15 分钟
REF auth.token_ttl --DEPENDS--> auth.overview

# 违规（R1）：RULE 没有任何到 auth.* DEF 的边
DEF auth.overview   JWT 认证模块
RULE auth.token_ttl access token 有效期不得超过 15 分钟
```

### R2 — 每文档至少 1 个 DEF

每个 .vt 文件必须包含至少一个 `DEF` 节点。DEF 是 `toc()` 的入口（D20），
没有 DEF 的文档无法被冷启动索引发现。

### R3 — 跨文件边必须显式

跨文件引用必须用 `REF` 行显式声明，不要靠"命名相似"暗示连接。
合并图（`merge_doc_graphs`）只认显式边（D16）。

### R4 — 节点 ID 命名空间与模块对齐

- `%id system/auth` 的文件，节点 ID 应使用 `auth.<name>` 形式（或用 `%ns auth` 后用裸 ID）。
- 跨文件引用时使用完整 ID（如 `middleware.jwt_verify`），不要省略前缀。
- 例外：`db.user_table` 这类全局共享资源可以不带 module 前缀，但要在文档头声明其归属。

---

## 2. 推荐规则（违反视为告警，不阻断）

### G1 — 孤立节点告警

每个节点最好至少有 1 条入边或出边。完全孤立的节点（无任何 REF 关联）在 `resolve` 时
无法被检索到，只在 `toc()` 全量扫描中出现。`vt check` 应输出 `isolated_node` warning
（Phase 3 实装；Phase 1 暂时只靠人工审查）。

### G2 — DEF 数与 RULE 数比例

建议每文档 `RULE 数 / DEF 数 ∈ [1, 5]`：
- < 1：规则稀疏，模块定义空泛
- > 5：规则过度膨胀，应拆分模块

### G3 — 注解类型（DESC/EX/META/SRC）紧跟定义

按 D1，注解类型追加为节点的 facet。建议注解行紧跟在 DEF/RULE 行之后，
避免分散在文件不同位置导致 facet 顺序混乱。

### G4 — 跨模块 DEPENDS 必须可解析

`REF a.x --DEPENDS--> b.y` 要求 `b.y` 在合图后存在。`vt check --strict` 会把
悬空引用升级为 error（D12）。

---

## 3. 示例：合规的 auth.vt 片段

```vt
%vt 0.3.1
%mode doc
%id system/auth
%lang zh

DEF auth.overview    JWT 认证模块，负责 token 签发与验证
DESC auth.overview   支持 RS256 和 HS256 两种算法

RULE auth.sec_1      token 有效期不得超过 24h
RULE auth.sec_2      refresh token 必须存于 httpOnly cookie
RULE auth.sec_3      密码必须经过 bcrypt 哈希后存储

VAR auth.jwt_secret  env:JWT_SECRET_KEY type:string minlen:32

# R1 合规：每条 RULE 都有到 auth.overview 的 DEPENDS 边
REF auth.sec_1 --DEPENDS--> auth.overview
REF auth.sec_2 --DEPENDS--> auth.overview
REF auth.sec_3 --DEPENDS--> auth.overview

# 跨文件边（R3 合规：显式声明）
REF auth.sec_1 --ENFORCED-BY--> middleware.jwt_verify
REF auth.overview --DEPENDS--> db.user_table
```

从 `auth.overview` 出发 `resolve(depth=2, type_filter=["RULE"])` 现在能拉出全部 3 条 RULE；
修改前一条都拉不到（S1）。

---

## 4. 已知限制（I8 / I11）

- `%ns auth` 只对"不含 `.` 的裸 ID"加前缀。若外部节点真的叫无点单段名（如 `db`），
  在 `%ns auth` 文件里引用会被误展开成 `auth.db`。规避：跨文件引用总是用完整 ID。
- `include_edges=True` 不含"末层兄弟边"（I11）。两个都在最外层的节点之间的边
  不会出现在边输出里。节点输出不受影响。

---

## 5. 检查清单（提交前自检）

- [ ] 每个 RULE 都有 `REF <rule> --DEPENDS--> <module>.<def>` 或等价关系？（R1）
- [ ] 文件至少 1 个 DEF？（R2）
- [ ] 跨文件引用全部用 `REF` 显式声明？（R3）
- [ ] 节点 ID 前缀与 `%id` 模块名对齐？（R4）
- [ ] 没有孤立节点？（G1）
- [ ] 注解行紧跟定义行？（G3）
- [ ] `vt check --strict` 通过？（G4）
