import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import live_uncertainty as lu


class DegenerateMcNemarTests(unittest.TestCase):
    def test_no_discordant_pairs_publishes_p_value_one(self):
        rows = []
        for condition, tools, toks in (("raw_shell", 2, 10), ("verseshell_aci", 3, 12)):
            rows.append({
                "task_id": "a", "condition": condition, "seed": 42, "run_index": 0,
                "success": True, "turns": 2, "completion_truncated_turns": 0,
                "tool_calls": tools, "observation_tokens": toks,
                "llm_prompt_tokens": 100, "llm_completion_tokens": 20,
                "usage_complete": True, "model": "fixture",
            })
        payload = {
            "mode": "live", "generated_at": "fixture", "git_rev": "fixture",
            "task_set_version": "3.0.0", "evidence": {"fingerprint": "fixture"},
            "live_config": {"model": "fixture", "max_turns": 8, "seeds": [42], "repeat": 1},
            "aggregate": {"aggregates": []}, "rows": rows,
        }
        report = lu.analyse(payload, "fixture")
        self.assertEqual(report["paired_success_mcnemar"]["p_value_exact"], 1.0)


if __name__ == "__main__":
    unittest.main()
