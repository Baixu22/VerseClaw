"""Shared fixtures: spec-verbatim samples + a controlled resolve fixture."""
import sys
from pathlib import Path

import pytest

SRC = str(Path(__file__).resolve().parent.parent / "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

# spec §3.2 — flagship doc example, verbatim
SPEC_AUTH = """\
%vt 0.3.1
%mode doc
%id system/auth
%lang zh

DEF auth.overview    JWT 认证模块，负责 token 签发与验证
DESC auth.overview   支持 RS256 和 HS256 两种算法
DESC auth.overview   设计优先考虑安全性而非便利性

RULE auth.sec_1      token 有效期不得超过 24h
RULE auth.sec_2      refresh token 必须存于 httpOnly cookie
RULE auth.sec_3      密码必须经过 bcrypt 哈希后存储

VAR auth.jwt_secret  env:JWT_SECRET_KEY  type:string  minlen:32
VAR auth.algo        enum:[RS256,HS256]  default:RS256

EX auth.ex_1         RS256 场景：微服务间通信，公钥分发给下游服务
OPEN auth.todo_1     是否需要支持 JWKS endpoint 动态轮换密钥

REF auth.sec_1 --ENFORCED-BY--> middleware.jwt_verify
REF auth.overview --DEPENDS--> db.user_table
REF auth.overview ~~ api.endpoint.login

// 以下为审查注释，不进入 SIR 图
// 2024-07-18 架构评审通过，待实现
"""

# spec §3.3 — mem example, verbatim
SPEC_MEM = """\
%vt 0.3.1
%mode mem
%session task_20240718_auth_impl

- 用户确认使用 RS256，原因是微服务间需要公钥分发
- 已完成 JWT 签发逻辑
- 待完成：refresh token 轮换机制
#blocker 需确认 JWT_SECRET_KEY 的最小长度要求，用户暂未回复
#pref 用户偏好简洁回复，不需要示例代码
- 当前对话轮次：第 7 轮
"""

# controlled fixture for resolve semantics (all edges internal except a.ghost)
NET = """\
%vt 0.3.1
%mode doc
%id test/net

DEF a.one  node one
DESC a.one extra facet
RULE a.two rule two
DEF a.three node three
DEF a.four node four
DEF a.five node five
REF a.one --DEPENDS--> a.two
REF a.two --ENFORCED-BY--> a.three
REF a.one ~~ a.four
REF a.five --SEE--> a.one
REF a.one --BLOCKS--> a.ghost
// comment must never reach SIR/TIR
"""


@pytest.fixture
def write_vt(tmp_path):
    def _write(name: str, text: str) -> str:
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        return str(p)
    return _write
