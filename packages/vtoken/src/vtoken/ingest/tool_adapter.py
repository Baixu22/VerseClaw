"""Task E — MCP tool schema → SIR adapter (v0.4 Context Assembly Engine).

接受 MCP tool schema（JSON Schema 格式），输出 SIRGraph。

节点命名规则：
- tool.<server_name>.<tool_name>  → DEF 节点（描述该 tool）
- tool.<server>.<tool>.input       → VAR 节点（参数 schema）

边规则：
- DEF → VAR（DEPENDS 边）
- 同 server 的 tools 之间不加边（保持纯净）

slot / priority：
- 所有节点 slot="tools"
- priority=3（Task I 规则：tools slot 的默认 priority）
"""
from __future__ import annotations

import json
from typing import Any

from ..graph import SIRGraph
from ..model import VTEdge, VTNode


def ingest_tool_schema(tool_schema: dict, server_name: str = "default") -> SIRGraph:
    """把单个 MCP tool schema 转为 SIRGraph。

    参数：
        tool_schema : 形如
            {
              "name": "search",
              "description": "Search documents",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "query": {"type": "string", "description": "..."},
                  ...
                },
                "required": ["query"]
              }
            }
        server_name : MCP server 名（用于命名空间）

    返回：
        SIRGraph（mode="doc"）
    """
    graph = SIRGraph("doc")
    tool_name = tool_schema.get("name", "unnamed")
    description = tool_schema.get("description", "")
    input_schema = tool_schema.get("inputSchema", {})

    # 1. tool DEF 节点
    def_id = f"tool.{server_name}.{tool_name}"
    graph.add_node(VTNode(
        id=def_id,
        parts=[("DEF", description or f"Tool: {tool_name}")],
        slot="tools",
        priority=3,
        source_files=[f"mcp:{server_name}"],
    ))

    # 2. inputSchema VAR 节点
    if input_schema:
        var_id = f"{def_id}.input"
        properties = input_schema.get("properties", {})
        required = set(input_schema.get("required", []))

        # 把 schema 摘要成可读 VAR content
        parts_lines = []
        for prop_name, prop_schema in properties.items():
            prop_type = prop_schema.get("type", "any")
            prop_desc = prop_schema.get("description", "")
            req_marker = "*" if prop_name in required else ""
            parts_lines.append(f"{prop_name}{req_marker}: {prop_type}"
                              + (f" — {prop_desc}" if prop_desc else ""))

        var_content = "\n".join(parts_lines) if parts_lines else "(no parameters)"
        graph.add_node(VTNode(
            id=var_id,
            parts=[("VAR", var_content)],
            slot="tools",
            priority=4,
            source_files=[f"mcp:{server_name}"],
        ))
        # DEF → VAR DEPENDS 边
        graph.add_edge(VTEdge(src=def_id, dst=var_id, rel="DEPENDS"))

    return graph


def ingest_tool_schemas(tools: list[dict], server_name: str = "default") -> SIRGraph:
    """批量 ingest 多个 tool schema，合并为一个 SIRGraph。"""
    if not tools:
        return SIRGraph("doc")
    merged = ingest_tool_schema(tools[0], server_name)
    for tool in tools[1:]:
        merged.merge(ingest_tool_schema(tool, server_name))
    return merged


def ingest_tool_schemas_from_json(json_path: str, server_name: str = "default") -> SIRGraph:
    """从 JSON 文件读取 tool schema 列表。文件格式应为 [{"name":..., ...}, ...]。"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "tools" in data:
        data = data["tools"]
    if not isinstance(data, list):
        raise ValueError(f"expected list of tool schemas, got {type(data).__name__}")
    return ingest_tool_schemas(data, server_name)
