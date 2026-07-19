"""Task C — ingest/md_adapter.py 测试（v0.4 Context Assembly Engine）.

验证：
- H1/H2/H3 层级映射
- bold bullet → RULE facet 推断
- 普通 bullet → EX facet（受 max_facets 截断）
- [text](anchor) → REF untyped 边
- slot 从文件名推断
- priority 从节点类型推断
"""
import os
import tempfile

import pytest

from vtoken.ingest.md_adapter import (
    ingest_markdown,
    ingest_markdown_file,
    slugify,
    _infer_slot,
    _infer_priority,
)


# ---------------------------------------------------------------------------
# slugify / _infer_slot / _infer_priority
# ---------------------------------------------------------------------------

def test_slugify_basic():
    assert slugify("JWT Authentication") == "jwt_authentication"


def test_slugify_chinese():
    assert slugify("认证 模块") == "认证_模块"


def test_slugify_punctuation():
    assert slugify("API: v1.0 (deprecated)") == "api_v1_0_deprecated"


def test_slugify_empty_returns_untitled():
    assert slugify("") == "untitled"
    assert slugify("   ") == "untitled"


def test_infer_slot_system():
    assert _infer_slot("rules.md") == "system"
    assert _infer_slot("constraint_spec.md") == "system"
    assert _infer_slot("project-spec.md") == "system"


def test_infer_slot_tools():
    assert _infer_slot("mcp_tool.md") == "tools"
    assert _infer_slot("skill_def.md") == "tools"


def test_infer_slot_knowledge_default():
    assert _infer_slot("arch.md") == "knowledge"
    assert _infer_slot("notes.md") == "knowledge"
    assert _infer_slot(None) == "knowledge"


def test_infer_priority_by_type():
    # v0.4.3 (D35): 普通 RULE 降到 3，含强安全词的 RULE 才是 2
    assert _infer_priority("DEF") == 4
    assert _infer_priority("RULE") == 3
    assert _infer_priority("RULE", content="必须使用 RS256") == 2
    assert _infer_priority(None) == 5


# ---------------------------------------------------------------------------
# H1/H2/H3 层级映射
# ---------------------------------------------------------------------------

def test_h1_creates_def_node():
    md = "# JWT Auth\n"
    g = ingest_markdown(md, source_path="auth.md")
    assert "jwt_auth" in g.nodes
    n = g.nodes["jwt_auth"]
    assert n.parts[0] == ("DEF", "JWT Auth")
    assert n.slot == "knowledge"
    assert n.priority == 4


def test_h2_creates_child_def_with_parent_prefix():
    md = """# Auth Module

## Login Flow

"""
    g = ingest_markdown(md)
    assert "auth_module" in g.nodes
    assert "auth_module.login_flow" in g.nodes


def test_h2_without_h1_creates_top_level_node():
    md = "## Standalone Section\n"
    g = ingest_markdown(md)
    assert "standalone_section" in g.nodes


def test_h3_becomes_desc_facet_of_parent():
    md = """# Auth

## Login

### Step 1: validate
### Step 2: sign
"""
    g = ingest_markdown(md)
    n = g.nodes["auth.login"]
    desc_facets = [p for p in n.parts if p[0] == "DESC"]
    assert len(desc_facets) == 2
    assert desc_facets[0] == ("DESC", "Step 1: validate")
    assert desc_facets[1] == ("DESC", "Step 2: sign")


def test_h3_attaches_to_h1_when_no_h2():
    md = """# Top Level

### Sub Facet
"""
    g = ingest_markdown(md)
    n = g.nodes["top_level"]
    assert ("DESC", "Sub Facet") in n.parts


# ---------------------------------------------------------------------------
# Bullet 处理
# ---------------------------------------------------------------------------

def test_bold_bullet_becomes_rule_facet():
    md = """# Module

- **must not exceed 24 hours** for token lifetime
"""
    g = ingest_markdown(md)
    n = g.nodes["module"]
    rule_facets = [p for p in n.parts if p[0] == "RULE"]
    assert len(rule_facets) == 1
    assert "must not exceed 24 hours" in rule_facets[0][1]


def test_bold_bullet_with_trailing_text():
    md = """# Mod

- **rate limit** 100 req/s
"""
    g = ingest_markdown(md)
    n = g.nodes["mod"]
    rule_facets = [p for p in n.parts if p[0] == "RULE"]
    assert len(rule_facets) == 1
    assert "rate limit 100 req/s" == rule_facets[0][1]


def test_normal_bullet_becomes_ex_facet():
    md = """# Mod

- first example
- second example
"""
    g = ingest_markdown(md)
    n = g.nodes["mod"]
    ex_facets = [p for p in n.parts if p[0] == "EX"]
    assert len(ex_facets) == 2


def test_max_facets_truncates_ex_facets():
    md = """# Mod

- ex1
- ex2
- ex3
- ex4
"""
    g = ingest_markdown(md, max_facets=2)
    n = g.nodes["mod"]
    ex_facets = [p for p in n.parts if p[0] == "EX"]
    assert len(ex_facets) == 2


# ---------------------------------------------------------------------------
# Link → REF 边
# ---------------------------------------------------------------------------

def test_link_creates_untyped_ref_edge():
    md = """# Auth

- see [Login Flow](login-flow.md) for details
"""
    g = ingest_markdown(md)
    assert "auth" in g.nodes
    edges = [e for edges in g.out.values() for e in edges]
    assert len(edges) == 1
    assert edges[0].src == "auth"
    assert edges[0].dst == "login_flow"
    assert edges[0].rel is None  # untyped


def test_link_no_self_loop():
    md = """# Auth

- see [Auth](auth.md)
"""
    g = ingest_markdown(md)
    edges = [e for edges in g.out.values() for e in edges]
    assert len(edges) == 0  # self-link 抑制


# ---------------------------------------------------------------------------
# Slot 推断
# ---------------------------------------------------------------------------

def test_slot_inferred_from_filename_rules():
    md = "# Rules\n"
    g = ingest_markdown(md, source_path="security-rules.md")
    n = g.nodes["rules"]
    assert n.slot == "system"


def test_slot_inferred_from_filename_tool():
    md = "# Tool\n"
    g = ingest_markdown(md, source_path="mcp-tool.md")
    n = g.nodes["tool"]
    assert n.slot == "tools"


# ---------------------------------------------------------------------------
# 段落正文 → META facet
# ---------------------------------------------------------------------------

def test_paragraph_becomes_meta_facet():
    md = """# Mod

This is a paragraph.

- bullet
"""
    g = ingest_markdown(md)
    n = g.nodes["mod"]
    meta_facets = [p for p in n.parts if p[0] == "META"]
    assert len(meta_facets) == 1
    assert "This is a paragraph." in meta_facets[0][1]


# ---------------------------------------------------------------------------
# 引用块 / 空行
# ---------------------------------------------------------------------------

def test_blockquote_skipped():
    md = """# Mod

> This is a quote, should be ignored.

- but this bullet is processed
"""
    g = ingest_markdown(md)
    n = g.nodes["mod"]
    # 只应该有 DEF + EX facet，没有 META（quote 被跳过）
    meta_facets = [p for p in n.parts if p[0] == "META"]
    assert len(meta_facets) == 0
    ex_facets = [p for p in n.parts if p[0] == "EX"]
    assert len(ex_facets) == 1


# ---------------------------------------------------------------------------
# ingest_markdown_file
# ---------------------------------------------------------------------------

def test_ingest_markdown_file_reads_file(tmp_path):
    md_file = tmp_path / "rules.md"
    md_file.write_text("# Rule Doc\n\n- **rule 1** desc\n", encoding="utf-8")
    g = ingest_markdown_file(str(md_file))
    assert "rule_doc" in g.nodes
    n = g.nodes["rule_doc"]
    assert n.slot == "system"
    assert n.source_file == str(md_file)
    assert n.source_files == [str(md_file)]
    assert any(p[0] == "RULE" for p in n.parts)


# ---------------------------------------------------------------------------
# 复杂场景
# ---------------------------------------------------------------------------

def test_complex_document():
    md = """# Auth Module

This module handles JWT auth.

## Login Flow

### Validate Credentials

- **must verify password hash** before issuing token
- first verify password
- second verify TOTP
- third verify CAPTCHA

## Token Signing

- see [JWT Spec](jwt-spec.md)

### Sign Token
"""
    g = ingest_markdown(md, source_path="auth_rules.md")
    # 检查节点结构
    assert "auth_module" in g.nodes
    assert "auth_module.login_flow" in g.nodes
    assert "auth_module.token_signing" in g.nodes

    # 检查 slot 推断（含 "rules" → system）
    assert g.nodes["auth_module"].slot == "system"

    # 检查 Login Flow 节点的 facet 结构
    login = g.nodes["auth_module.login_flow"]
    desc_facets = [p for p in login.parts if p[0] == "DESC"]
    assert len(desc_facets) == 1
    assert "Validate Credentials" in desc_facets[0][1]

    rule_facets = [p for p in login.parts if p[0] == "RULE"]
    assert len(rule_facets) == 1
    assert "must verify password hash" in rule_facets[0][1]

    # max_facets=2 默认，所以 EX facets 应该被截断
    ex_facets = [p for p in login.parts if p[0] == "EX"]
    assert len(ex_facets) == 2  # 第一条 + 第二条，第三条被截断

    # 检查 REF 边
    edges = [e for edges in g.out.values() for e in edges]
    assert len(edges) == 1
    assert edges[0].src == "auth_module.token_signing"
    assert edges[0].dst == "jwt_spec"
    assert edges[0].rel is None
