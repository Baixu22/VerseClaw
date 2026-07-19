"""T1 — P2.1 写入效率基准 (HANDOFF §3 T1).

口径钉死（D19）：
    结构开销 = (格式总 token − 纯内容 token) / 纯内容 token
    纯内容 = 各场景所有节点 content 按行拼接（不带 ID、不带类型符、不带 REF 行）
    tokenizer = cl100k_base
    语义 ID 计入 .vt 开销

四档格式：
    1) .vt     —— 完整语义 ID（规格式）
    2) .vt+ns  —— %ns 短 ID（D19 opt-in）
    3) jsonl   —— 每行一个 JSON 对象（节点 + 边）
    4) md      —— 朴素 Markdown（无加粗无装饰，D19 明令不许用加粗对照组）

红线 (HANDOFF §0.5)：
    .vt 任一档结构开销 > JSONL → 触发红线，停止后续 T 任务。

运行：
    set TIKTOKEN_CACHE_DIR=...\\.tiktoken_cache
    set PYTHONUTF8=1
    python benchmarks\\p21_write_efficiency.py
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field

# --- tiktoken bootstrap -----------------------------------------------------
_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          ".tiktoken_cache")
os.environ.setdefault("TIKTOKEN_CACHE_DIR", _CACHE_DIR)
try:
    import tiktoken
    _ENC = tiktoken.get_encoding("cl100k_base")
except Exception as e:  # pragma: no cover - explicit failure mode for the agent
    sys.stderr.write(
        f"[p21] tiktoken unavailable (set TIKTOKEN_CACHE_DIR + HTTPS_PROXY to bootstrap).\n"
        f"      under: {e}\n")
    sys.exit(2)


def count_tokens(text: str) -> int:
    """Token count of ``text`` under cl100k_base."""
    return len(_ENC.encode(text))


# ---------------------------------------------------------------------------
# Scenario model
# ---------------------------------------------------------------------------

@dataclass
class Scenario:
    name: str            # short identifier
    title: str           # human-readable title (Chinese)
    doc_id: str          # %id value
    ns: str              # %ns value
    nodes: list = field(default_factory=list)   # list[(id, type, content)]
    edges: list = field(default_factory=list)   # list[(src, rel|None, dst)]

    def content_text(self) -> str:
        """Pure content: node contents only, joined by newlines."""
        return "\n".join(c for _, _, c in self.nodes)


# ---------------------------------------------------------------------------
# 10 scenarios — semantic-equivalent across formats
# ---------------------------------------------------------------------------

def _scenarios() -> list[Scenario]:
    S = []

    # 1. API 约束
    S.append(Scenario(
        name="api_auth", title="API 约束 — JWT 认证",
        doc_id="system/auth", ns="auth",
        nodes=[
            ("auth.overview", "DEF", "JWT 认证模块，负责 token 签发与验证"),
            ("auth.overview", "DESC", "支持 RS256 和 HS256 两种算法"),
            ("auth.overview", "DESC", "设计优先考虑安全性而非便利性"),
            ("auth.token_ttl", "RULE", "access token 有效期不得超过 15 分钟"),
            ("auth.refresh_ttl", "RULE", "refresh token 有效期不得超过 7 天"),
            ("auth.storage", "RULE", "refresh token 必须存于 httpOnly cookie"),
            ("auth.jwt_secret", "VAR", "env:JWT_SECRET_KEY type:string minlen:32"),
            ("auth.algo", "VAR", "enum:RS256,HS256 default:RS256"),
            ("auth.ex_1", "EX", "浏览器登录：access token 存内存，refresh token 存 cookie"),
            ("auth.todo_1", "OPEN", "是否需要支持 JWKS endpoint 动态轮换密钥"),
        ],
        edges=[
            ("auth.overview", "DEPENDS", "auth.token_ttl"),
            ("auth.token_ttl", "ENFORCED-BY", "auth.refresh_ttl"),
            ("auth.overview", None, "auth.ex_1"),
        ],
    ))

    # 2. 架构决策
    S.append(Scenario(
        name="arch_split", title="架构决策 — 服务拆分",
        doc_id="arch/service-split", ns="svc",
        nodes=[
            ("svc.context", "DEF", "订单域从单体应用拆分为 4 个微服务"),
            ("svc.context", "DESC", "拆分动机：研发团队扩到 12 人，trunk-based 频繁冲突"),
            ("svc.order", "DEF", "订单服务：负责订单创建与状态流转"),
            ("svc.payment", "DEF", "支付服务：对接第三方渠道，幂等保证"),
            ("svc.inventory", "DEF", "库存服务：扣减、预占、回滚"),
            ("svc.notify", "DEF", "通知服务：短信、邮件、push 三通道"),
            ("svc.boundary", "RULE", "每个服务拥有独立数据库，禁止跨库 JOIN"),
            ("svc.sync", "RULE", "服务间同步调用超时统一 3s，重试 2 次后转异步补偿"),
            ("svc.saga", "EX", "下单流程：order.create → inventory.hold → payment.charge → notify.send"),
        ],
        edges=[
            ("svc.context", "DEPENDS", "svc.order"),
            ("svc.order", "DEPENDS", "svc.payment"),
            ("svc.order", "DEPENDS", "svc.inventory"),
            ("svc.order", None, "svc.notify"),
        ],
    ))

    # 3. DB schema 说明
    S.append(Scenario(
        name="db_users", title="DB schema — 用户表",
        doc_id="db/user", ns="db",
        nodes=[
            ("db.users", "DEF", "用户主表，存储账号与基础资料"),
            ("db.users", "DESC", "引擎 InnoDB，字符集 utf8mb4，行格式 DYNAMIC"),
            ("db.users.id", "VAR", "BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY"),
            ("db.users.email", "VAR", "VARCHAR(255) NOT NULL UNIQUE"),
            ("db.users.password_hash", "VAR", "CHAR(60) NOT NULL COMMENT bcrypt cost=12"),
            ("db.users.created_at", "VAR", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
            ("db.idx_email", "RULE", "索引必须覆盖 email 列以支持登录查询"),
            ("db.no_pii", "RULE", "不在主表存储手机号、身份证号等 PII"),
            ("db.seed", "EX", "insert into users(email, password_hash) values('admin@x.com', '$2b$12$...')"),
        ],
        edges=[
            ("db.users", "DEPENDS", "db.idx_email"),
            ("db.users", None, "db.no_pii"),
        ],
    ))

    # 4. 部署 runbook
    S.append(Scenario(
        name="dep_runbook", title="部署 runbook — v3.0 发布",
        doc_id="runbook/deploy-v3", ns="dep",
        nodes=[
            ("dep.goal", "DEF", "将 v3.0 发布到生产环境"),
            ("dep.goal", "DESC", "影响范围：网关、订单服务、库存服务"),
            ("dep.step1", "DEF", "拉取最新 main 分支并构建镜像：docker build -t order:v3.0 ."),
            ("dep.step2", "DEF", "推送镜像：docker push registry.cn-beijing.aliyuncs.com/prod/order:v3.0"),
            ("dep.step3", "DEF", "kubectl set image deployment/order order=registry.../order:v3.0"),
            ("dep.step4", "DEF", "等待 rollout：kubectl rollout status deployment/order --timeout=300s"),
            ("dep.canary", "RULE", "先切 10% 流量观察 5 分钟再全量"),
            ("dep.rollback", "RULE", "若 5xx 错误率 >1% 持续 1 分钟，立即 kubectl rollout undo"),
            ("dep.metrics", "OPEN", "监控指标是否需要新增业务维度的看板"),
        ],
        edges=[
            ("dep.goal", "DEPENDS", "dep.step1"),
            ("dep.step1", "DEPENDS", "dep.step2"),
            ("dep.step2", "DEPENDS", "dep.step3"),
            ("dep.step3", "DEPENDS", "dep.step4"),
            ("dep.step4", None, "dep.canary"),
        ],
    ))

    # 5. 安全规则
    S.append(Scenario(
        name="sec_rules", title="安全规则 — 公网服务",
        doc_id="sec/rules", ns="sec",
        nodes=[
            ("sec.scope", "DEF", "适用于所有面向公网的 API 与 Web 服务"),
            ("sec.password", "RULE", "密码至少 12 位，含大小写字母、数字、特殊字符"),
            ("sec.bcrypt", "RULE", "密码必须经 bcrypt cost=12 哈希后存储"),
            ("sec.token", "RULE", "token 必须使用 RS256 签名，私钥仅 auth 服务持有"),
            ("sec.cors", "RULE", "跨域允许列表仅 *.example.com"),
            ("sec.csp", "RULE", "Content-Security-Policy 必须禁用 unsafe-inline"),
            ("sec.audit", "RULE", "所有写操作必须记录审计日志，保留 180 天"),
            ("sec.violation", "EX", "反例：将 token 存于 localStorage 可被 XSS 窃取"),
        ],
        edges=[
            ("sec.scope", "DEPENDS", "sec.password"),
            ("sec.password", None, "sec.bcrypt"),
            ("sec.scope", None, "sec.cors"),
        ],
    ))

    # 6. 任务清单
    S.append(Scenario(
        name="task_sprint", title="任务清单 — Sprint 23",
        doc_id="task/sprint-23", ns="task",
        nodes=[
            ("task.goal", "DEF", "Sprint 23 目标：完成支付幂等性重构"),
            ("task.t1", "DEF", "重构 PaymentService.charge 加幂等键"),
            ("task.t2", "DEF", "编写幂等键冲突的单测，覆盖并发场景"),
            ("task.t3", "DEF", "压测：1000 QPS 下幂等键缓存命中率 >99%"),
            ("task.t4", "DEF", "文档：更新 API 规范加入 Idempotency-Key 头"),
            ("task.dod", "RULE", "DoD = 代码合并 + 单测覆盖 >85% + 文档更新"),
            ("task.t3_deps", "OPEN", "t3 依赖压测环境是否就绪"),
        ],
        edges=[
            ("task.goal", "DEPENDS", "task.t1"),
            ("task.t1", "DEPENDS", "task.t2"),
            ("task.t2", "DEPENDS", "task.t3"),
            ("task.t3", None, "task.t3_deps"),
            ("task.t1", None, "task.t4"),
        ],
    ))

    # 7. 研究笔记
    S.append(Scenario(
        name="res_queue", title="研究笔记 — 队列选型",
        doc_id="research/queue", ns="res",
        nodes=[
            ("res.topic", "DEF", "异步任务队列选型：Kafka vs RabbitMQ vs Redis Streams"),
            ("res.topic", "DESC", "评估维度：吞吐、延迟、可靠性、运维成本、客户端成熟度"),
            ("res.kafka", "DEF", "Kafka：单分区 100k/s，延迟 5–50ms，依赖 KRaft"),
            ("res.rabbit", "DEF", "RabbitMQ：经典 AMQP，吞吐 20k/s，延迟 <5ms，路由灵活"),
            ("res.redis", "DEF", "Redis Streams：单实例 50k/s，延迟 <5ms，依赖持久化策略"),
            ("res.choice", "RULE", "吞吐 >50k/s 选 Kafka，否则选 RabbitMQ"),
            ("res.ops", "OPEN", "团队对 Kafka 运维经验缺位是否可接受"),
            ("res.demo", "EX", "POC：用 RabbitMQ 跑了 3 天，死信队列处理符合预期"),
        ],
        edges=[
            ("res.topic", None, "res.kafka"),
            ("res.topic", None, "res.rabbit"),
            ("res.topic", None, "res.redis"),
            ("res.topic", "DEPENDS", "res.choice"),
        ],
    ))

    # 8. 用户偏好
    S.append(Scenario(
        name="pref_dev", title="用户偏好 — 开发风格",
        doc_id="pref/dev-style", ns="pref",
        nodes=[
            ("pref.context", "DEF", "用户开发偏好，用于 agent 自我约束"),
            ("pref.lang", "RULE", "代码注释一律使用中文"),
            ("pref.commit", "RULE", "提交信息使用 Conventional Commits 风格"),
            ("pref.test", "RULE", "新增功能必须同时新增对应单测"),
            ("pref.style", "RULE", "优先函数式风格，避免 class 继承"),
            ("pref.reply", "EX", "回复风格：简洁直给，先答案后解释"),
            ("pref.env", "OPEN", "是否在断网环境下优先使用本地依赖"),
        ],
        edges=[
            ("pref.context", None, "pref.lang"),
            ("pref.context", None, "pref.commit"),
            ("pref.context", None, "pref.test"),
        ],
    ))

    # 9. 错误码表
    S.append(Scenario(
        name="err_codes", title="错误码表 — 业务 API",
        doc_id="err/api", ns="err",
        nodes=[
            ("err.range", "DEF", "业务错误码区间 40000–49999"),
            ("err.e40001", "DEF", "40001 用户不存在"),
            ("err.e40002", "DEF", "40002 密码错误"),
            ("err.e40003", "DEF", "40003 token 过期"),
            ("err.e40004", "DEF", "40004 余额不足"),
            ("err.e40005", "DEF", "40005 库存不足"),
            ("err.format", "RULE", "错误响应统一格式 {code, message, request_id}"),
            ("err.i18n", "RULE", "message 字段必须支持 zh/en 两种语言"),
            ("err.sample", "EX", '{"code":40001,"message":"user not found","request_id":"abc123"}'),
        ],
        edges=[
            ("err.range", None, "err.e40001"),
            ("err.range", None, "err.e40002"),
            ("err.range", None, "err.e40003"),
            ("err.range", None, "err.e40004"),
            ("err.range", None, "err.e40005"),
        ],
    ))

    # 10. 变更日志
    S.append(Scenario(
        name="log_v031", title="变更日志 — v0.3.1",
        doc_id="changelog/v031", ns="log",
        nodes=[
            ("log.v031", "DEF", "v0.3.1 发布于 2024-07-18"),
            ("log.feat1", "DEF", "新增 .vt HIR 层与 .vtg SIR 层"),
            ("log.feat2", "DEF", "新增 vt.resolve 双向 BFS 检索"),
            ("log.feat3", "DEF", "新增 %mode mem 运行时与崩溃恢复"),
            ("log.fix1", "DEF", "修复 doc 编译器在多 facet 节点上的 SHA 不稳定"),
            ("log.break", "DEF", "删除 vt lint --fix（规格 §8.3 永久删除）"),
            ("log.compat", "RULE", "兼容 Python 3.10+，未引入第三方运行时依赖"),
            ("log.next", "EX", "下个迭代：MCP 封装与 vt.render 工具"),
        ],
        edges=[
            ("log.v031", None, "log.feat1"),
            ("log.v031", None, "log.feat2"),
            ("log.v031", None, "log.feat3"),
            ("log.v031", None, "log.fix1"),
            ("log.v031", None, "log.break"),
        ],
    ))

    return S


# ---------------------------------------------------------------------------
# Four format serialisers — each returns the full file text
# ---------------------------------------------------------------------------

def _short_id(node_id: str, ns: str) -> str:
    """D19 %ns rule: strip the ``ns.`` prefix when emitting under %ns."""
    prefix = ns + "."
    return node_id[len(prefix):] if node_id.startswith(prefix) else node_id


def to_vt_full(sc: Scenario) -> str:
    lines = ["%vt 0.3.1", "%mode doc", f"%id {sc.doc_id}", "%lang zh", ""]
    for nid, t, c in sc.nodes:
        lines.append(f"{t} {nid} {c}")
    for src, rel, dst in sc.edges:
        if rel is None:
            lines.append(f"REF {src} ~~ {dst}")
        else:
            lines.append(f"REF {src} --{rel}--> {dst}")
    return "\n".join(lines) + "\n"


def to_vt_ns(sc: Scenario) -> str:
    lines = ["%vt 0.3.1", "%mode doc", f"%id {sc.doc_id}", f"%ns {sc.ns}", "%lang zh", ""]
    for nid, t, c in sc.nodes:
        lines.append(f"{t} {_short_id(nid, sc.ns)} {c}")
    for src, rel, dst in sc.edges:
        s = _short_id(src, sc.ns)
        d = _short_id(dst, sc.ns)
        if rel is None:
            lines.append(f"REF {s} ~~ {d}")
        else:
            lines.append(f"REF {s} --{rel}--> {d}")
    return "\n".join(lines) + "\n"


def to_jsonl(sc: Scenario) -> str:
    """Plain JSONL: one record per line; nodes first, then edges."""
    lines = []
    for nid, t, c in sc.nodes:
        lines.append(json.dumps(
            {"id": nid, "type": t, "content": c},
            ensure_ascii=False, separators=(",", ":")))
    for src, rel, dst in sc.edges:
        lines.append(json.dumps(
            {"edge": [src, rel, dst]},
            ensure_ascii=False, separators=(",", ":")))
    return "\n".join(lines) + "\n"


def to_markdown(sc: Scenario) -> str:
    """朴素 Markdown (D19): no bold, no decoration — just headings + lists.

    A human writing notes would naturally use this shape, so it is the fairest
    baseline against .vt. The ID/type are kept because Markdown otherwise cannot
    express the identity of each item, which would understate the format's real
    cost when an agent needs to reference items later.
    """
    lines = [f"# {sc.doc_id}", "", f"## {sc.title}", ""]
    for nid, t, c in sc.nodes:
        lines.append(f"- {nid} ({t}): {c}")
    if sc.edges:
        lines.append("")
        for src, rel, dst in sc.edges:
            rel_text = rel if rel else "~~"
            lines.append(f"- {src} {rel_text} {dst}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

FORMATS = [
    ("vt",   "vt_full", to_vt_full,   "完整 ID 的 .vt"),
    ("vt+ns", "vt_ns",  to_vt_ns,    "%ns 短 ID 的 .vt"),
    ("jsonl", "jsonl",  to_jsonl,    "JSONL（节点 + 边）"),
    ("md",    "md",     to_markdown, "朴素 Markdown（无装饰）"),
]


def run() -> dict:
    scenarios = _scenarios()
    rows = []
    for sc in scenarios:
        content_tokens = count_tokens(sc.content_text())
        row = {
            "scenario": sc.name, "title": sc.title,
            "nodes": len(sc.nodes), "edges": len(sc.edges),
            "content_tokens": content_tokens,
            "formats": {},
        }
        for label, key, fn, desc in FORMATS:
            text = fn(sc)
            total = count_tokens(text)
            overhead = (total - content_tokens) / content_tokens
            row["formats"][key] = {
                "label": label, "desc": desc,
                "total_tokens": total,
                "overhead": overhead,
            }
        rows.append(row)
    return {"rows": rows}


def _fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def render_report(data: dict) -> str:
    out = []
    out.append("# T1 — P2.1 写入效率基准报告")
    out.append("")
    out.append("> 口径（D19）：`结构开销 = (格式总 token − 纯内容 token) / 纯内容 token`")
    out.append("> tokenizer = `cl100k_base`；语义 ID 计入 .vt 开销；纯内容 = 各节点正文按行拼接。")
    out.append("> 红线（HANDOFF §0.5）：.vt 任一档结构开销 > JSONL → 放弃 .vt HIR 层。")
    out.append("")
    out.append("## 1. 逐场景数据")
    out.append("")
    header = "| 场景 | 节点 | 边 | 内容token | .vt 总/开销 | .vt+ns 总/开销 | JSONL 总/开销 | MD 总/开销 |"
    sep    = "|---|---:|---:|---:|---|---|---|---|"
    out.append(header)
    out.append(sep)
    for r in data["rows"]:
        f = r["formats"]
        def cell(k):
            v = f[k]
            return f"{v['total_tokens']} / {_fmt_pct(v['overhead'])}"
        out.append(
            f"| {r['title']} | {r['nodes']} | {r['edges']} | "
            f"{r['content_tokens']} | "
            f"{cell('vt_full')} | {cell('vt_ns')} | {cell('jsonl')} | {cell('md')} |"
        )

    # aggregates
    out.append("")
    out.append("## 2. 汇总均值（10 场景算术平均）")
    out.append("")

    def avg(key, field):
        vals = [r["formats"][key][field] for r in data["rows"]]
        return sum(vals) / len(vals)

    def avg_content():
        return sum(r["content_tokens"] for r in data["rows"]) / len(data["rows"])

    avg_c = avg_content()
    out.append(f"- 平均内容 token: **{avg_c:.1f}**")
    out.append("")
    out.append("| 格式 | 平均总 token | 平均结构开销 |")
    out.append("|---|---:|---:|")
    for label, key, _, _ in FORMATS:
        avg_total = avg(key, "total_tokens")
        avg_overhead = avg(key, "overhead")
        out.append(f"| {label} | {avg_total:.1f} | **{_fmt_pct(avg_overhead)}** |")

    # red line verdict
    out.append("")
    out.append("## 3. 红线判定（HANDOFF §0.5）")
    out.append("")
    avg_vt = avg("vt_full", "overhead")
    avg_vt_ns = avg("vt_ns", "overhead")
    avg_jsonl = avg("jsonl", "overhead")
    avg_md = avg("md", "overhead")
    out.append(f"- .vt 平均结构开销: **{_fmt_pct(avg_vt)}**")
    out.append(f"- .vt+ns 平均结构开销: **{_fmt_pct(avg_vt_ns)}**")
    out.append(f"- JSONL 平均结构开销: **{_fmt_pct(avg_jsonl)}**")
    out.append(f"- MD 平均结构开销: **{_fmt_pct(avg_md)}**")
    out.append("")

    vt_triggers = avg_vt > avg_jsonl
    vt_ns_triggers = avg_vt_ns > avg_jsonl
    if vt_triggers or vt_ns_triggers:
        out.append("**红线触发**：")
        if vt_triggers:
            out.append(f"- `.vt`（完整 ID）平均结构开销 {avg_vt*100:.1f}% > JSONL {avg_jsonl*100:.1f}%")
        if vt_ns_triggers:
            out.append(f"- `.vt+ns` 平均结构开销 {avg_vt_ns*100:.1f}% > JSONL {avg_jsonl*100:.1f}%")
        out.append("")
        out.append("> 依据 §0.5：**停止后续 T 任务，先向用户汇报**。建议改用 JSONL 替换 .vt HIR 层，保留 SIR+TIR 层。")
    else:
        out.append("**红线未触发**：.vt 两档平均结构开销均 ≤ JSONL。T2 可继续。")

    out.append("")
    out.append("## 4. 方法学声明")
    out.append("")
    out.append("- 10 个场景覆盖：API 约束 / 架构决策 / DB schema / 部署 runbook / 安全规则 / "
              "任务清单 / 研究笔记 / 用户偏好 / 错误码表 / 变更日志。")
    out.append("- 每场景以**语义等价**内容产出 4 种格式；纯内容口径在所有格式间一致。")
    out.append("- 朴素 Markdown 不使用加粗/装饰（D19 明令不许用 §3.4 加粗对照组虚胖）。")
    out.append("- 词表来源：`cl100k_base`（OpenAI），通过 7890 代理一次性下载到 `.tiktoken_cache/`，离线运行。")
    out.append("- 本机环境：Windows 11 / Python 3.10.3 / tiktoken 0.5.x。")
    return "\n".join(out) + "\n"


def main() -> int:
    data = run()
    here = os.path.dirname(os.path.abspath(__file__))
    report_path = os.path.join(here, "p21_report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(render_report(data))

    # Also emit raw numbers for downstream tooling
    json_path = os.path.join(here, "p21_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Console summary
    avg = lambda key, field: sum(r["formats"][key][field] for r in data["rows"]) / len(data["rows"])
    print(f"[p21] wrote {report_path}")
    print(f"[p21] wrote {json_path}")
    print(f"[p21] scenarios: {len(data['rows'])}, "
          f"avg content tokens: {sum(r['content_tokens'] for r in data['rows']) / len(data['rows']):.1f}")
    for label, key, _, _ in FORMATS:
        print(f"       {label:<7} avg overhead = {avg(key, 'overhead')*100:5.1f}%  "
              f"(avg total = {avg(key, 'total_tokens'):.1f} tokens)")
    # Red-line verdict to console
    avg_vt, avg_jsonl = avg("vt_full", "overhead"), avg("jsonl", "overhead")
    avg_vt_ns = avg("vt_ns", "overhead")
    if avg_vt > avg_jsonl or avg_vt_ns > avg_jsonl:
        print(f"[p21] RED LINE TRIGGERED — .vt overhead > jsonl; halt T2+ and report.")
        return 3
    print("[p21] red line NOT triggered — T2 may proceed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
