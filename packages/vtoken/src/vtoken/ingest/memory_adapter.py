"""Task J — memory system output → SIR adapter (v0.4 Context Assembly Engine).

接收记忆系统（如 Mem0 / Letta）的标准输出，转为 SIR 图节点。

输入格式（记忆系统标准输出）::

    [
        {"id": "mem_001", "content": "用户偏好 RS256", "tags": ["pref"], "created_at": 1718000000},
        {"id": "mem_002", "content": "待确认 JWT_SECRET_KEY", "tags": ["blocker"], "created_at": 1718000100},
        {"id": "mem_003", "content": "第 7 轮对话", "tags": ["note", "session"], "created_at": 1718000200},
    ]

slot 推断（按 tag）：
- blocker / task / plan        → "working"
- pref / fact                  → "knowledge"
- 其他                         → "working"（默认进 working，因为是会话产物）

priority 推断（详见 assembler.infer_priority）：
- tag="blocker"               → 1
- tag="note"                  → 8
- DEF（若 content 以 "DEF:" 开头）→ 4
- 其他                        → 5
"""
from __future__ import annotations

from ..assembler import infer_priority
from ..graph import SIRGraph
from ..model import VTNode


# ---------------------------------------------------------------------------
# slot 推断
# ---------------------------------------------------------------------------

def _infer_slot(tags: list[str] | None) -> str:
    """按 tag 推断 slot。

    v0.4.2 (P5): blocker 升级到 system slot（最高优先级），确保在 prompt 最前。
    - blocker/security → system（强制前置，lost-in-middle 防护）
    - task/plan        → working（任务阻塞 / 计划项进入工作区）
    - pref/fact        → knowledge（用户偏好 / 事实型知识）
    - 其他             → working（默认进 working）
    """
    if not tags:
        return "working"
    tag_lower = {t.lower() for t in tags}
    if tag_lower & {"blocker", "security"}:
        return "system"
    if tag_lower & {"task", "plan"}:
        return "working"
    if tag_lower & {"pref", "fact"}:
        return "knowledge"
    return "working"


def _infer_node_type(content: str) -> str:
    """从内容推断节点类型。

    - 内容以 "RULE:" 开头 → RULE
    - 内容以 "DEF:" 开头  → DEF
    - 内容以 "DESC:" 开头 → DESC
    - 其他                → EX（事实陈述，记忆系统最常见）
    """
    s = content.lstrip()
    if s.startswith("RULE:"):
        return "RULE"
    if s.startswith("DEF:"):
        return "DEF"
    if s.startswith("DESC:"):
        return "DESC"
    return "EX"


# ---------------------------------------------------------------------------
# 主 ingest 函数
# ---------------------------------------------------------------------------

def ingest_memory(entries: list[dict]) -> SIRGraph:
    """把记忆系统输出列表转为 SIRGraph。

    参数：
        entries : list of dict，每项需有 ``id`` + ``content``，可选 ``tags`` + ``created_at``。
                  tags 缺省为 []；created_at 缺省为 None。

    返回：
        SIRGraph（mode="mem"，便于与 doc 图区分；所有节点带 slot+priority+source_files）
    """
    graph = SIRGraph("mem")
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        node_id = entry.get("id")
        content = entry.get("content")
        if not node_id or not content:
            continue
        tags = entry.get("tags") or []
        if not isinstance(tags, list):
            tags = [tags]
        created_at = entry.get("created_at")
        node_type = _infer_node_type(content)
        slot = _infer_slot(tags)
        priority = infer_priority(node_type=node_type, tags=tags, content=content)  # v0.4.3: 传 content 做语义细分
        node = VTNode(
            id=str(node_id),
            parts=[(node_type, str(content))],
            created_at=created_at,
            source_file="<memory>",
            slot=slot,
            priority=priority,
            source_files=["<memory>"],
        )
        graph.add_node(node, replace=True)
    return graph


def ingest_memory_from_json(json_path: str) -> SIRGraph:
    """从 JSON 文件读取记忆列表，转 SIRGraph。

    JSON 文件格式：
    - 顶层是 list[dict]；或 {"memories": [...]} / {"entries": [...]}
    """
    import json
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        # 兼容两种包装键
        entries = data.get("memories") or data.get("entries") or []
    elif isinstance(data, list):
        entries = data
    else:
        entries = []
    return ingest_memory(entries)
