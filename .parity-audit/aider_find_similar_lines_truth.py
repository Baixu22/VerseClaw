# -*- coding: utf-8 -*-
"""Aider find_similar_lines 参照真值(直接从归档源文件提取函数原文执行,零转录误差)。
能力1 did_you_mean 对抗验证 —— 参照侧运行器。"""
import json
import re
import pathlib
from difflib import SequenceMatcher

SRC = pathlib.Path(
    r"C:\Users\27933\Desktop\coding\source_archive\aider\coders\editblock_coder.py"
).read_text(encoding="utf-8")

m = re.search(r"def find_similar_lines\(.*?(?=\n\ndef |\nclass |\Z)", SRC, re.S)
assert m, "find_similar_lines not found"
ns: dict = {"SequenceMatcher": SequenceMatcher}
exec(m.group(0), ns)
find_similar_lines = ns["find_similar_lines"]  # 签名: (search_lines, content_lines, threshold=0.6)

# 与本地 parity 测试完全相同的用例集 (content, oldText)
CASES = [
    # C1 单字符错行, 单行 pattern
    ("c1_typo_single_line", "  retrun x;\n", "  return x;\n"),
    # C2 单字符错行, 3 行 pattern (2 对 1 错)
    ("c2_typo_3lines",
     "function alpha() {\n  const x = 1;\n  retrun x;\n}\n",
     "function alpha() {\n  const x = 1;\n  retrun x;\n}\n"),
    # C3 乱序 2 行
    ("c3_reordered_2lines", "b\na\n", "a\nb\n"),
    # C4 乱序 3 行
    ("c4_reordered_3lines", "c\nb\na\n", "a\nb\nc\n"),
    # C5 重复行 pattern ["a","b","a"] vs window ["a","a","b"]
    ("c5_dup_lines", "a\na\nb\n", "a\nb\na\n"),
    # C6 首末行精确匹配(不扩行 vs 扩行) — content 10 行, pattern 3 行首末行精确
    ("c6_first_last_exact",
     "l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n",
     "l2\nDIFFERENT\nl4\n"),
    # C7 空 search_lines (Aider 崩溃点)
    ("c7_empty_search", "x\ny\nz\n", ""),
    # C8 智能引号归一化
    ("c8_smart_quotes", 'const msg = \u201chello\u201d;\n', 'const msg = "hello";\n'),
    # C9 阈值恰好 0.6 (3 对 2 错, 5 行)
    ("c9_exact_threshold", "a\nb\nx\ny\ne\n", "a\nb\nc\nd\ne\n"),
    # C10 pattern 长于 content
    ("c10_pattern_longer", "a\nb\n", "a\nb\nc\nd\ne\n"),
    # C11 正常路径: content 内含精确块(无错行)
    ("c11_exact_block",
     "function alpha() {\n  const x = 1;\n  return x;\n}\n\nfunction beta() {\n  const y = 2;\n  return y;\n}\n",
     "function alpha() {\n  const x = 1;\n  return x;\n}\n"),
]

results = []
for case_id, content, old_text in CASES:
    try:
        out = find_similar_lines(old_text, content)
        results.append({"case": case_id, "ok": True, "hit": out != "", "len": len(out),
                        "preview": out[:60].replace("\n", "\\n")})
    except Exception as e:  # noqa: BLE001
        results.append({"case": case_id, "ok": False, "error": f"{type(e).__name__}: {e}"})

print(json.dumps(results, ensure_ascii=False, indent=1))
