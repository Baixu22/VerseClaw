"""Exercise landing checks against real Git refs, including linked worktrees."""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from task_forest import cmd_check_landing


class LandingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="task-forest-landing-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "--quiet", "--initial-branch=main")
        self.git("config", "user.name", "Landing Test")
        self.git("config", "user.email", "test@example.invalid")
        self.base = self.commit("baseline")

    def git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(self.root), *args], encoding="utf-8", stderr=subprocess.PIPE
        ).strip()

    def commit(self, text: str) -> str:
        (self.root / "source.txt").write_text(text, encoding="utf-8")
        self.git("add", "source.txt")
        self.git("commit", "--quiet", "-m", text)
        return self.git("rev-parse", "HEAD")

    def check(self, *evidence: str) -> tuple[int, dict]:
        nodes = {"TF-0001": {"id": "TF-0001", "status": "done", "evidence": list(evidence)}}
        args = argparse.Namespace(workspace=str(self.root), root=None, lock_timeout=1, json=True)
        output = io.StringIO()
        with patch("task_forest.Store") as store, contextlib.redirect_stdout(output):
            store.return_value.load.return_value = ({}, nodes, {})
            result = cmd_check_landing(args)
        return result, json.loads(output.getvalue())

    def test_remote_default_is_used_when_local_main_is_stale(self) -> None:
        self.git("checkout", "--quiet", "-b", "delivery")
        current = self.commit("landed remotely")
        self.git("update-ref", "refs/remotes/origin/main", current)
        result, report = self.check(current)
        self.assertEqual(result, 0)
        self.assertEqual(report["default_ref"], "refs/remotes/origin/main")
        self.assertEqual(report["suspect_count"], 0)

    def test_remote_default_keeps_slashes_in_its_name(self) -> None:
        self.git("update-ref", "refs/remotes/origin/release/stable", self.base)
        self.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release/stable")
        result, report = self.check(self.base)
        self.assertEqual(result, 0)
        self.assertEqual(report["default_branch"], "release/stable")
        self.assertEqual(report["default_ref"], "refs/remotes/origin/release/stable")

    def test_linked_worktree_branch_is_checked_without_display_markers(self) -> None:
        self.git("checkout", "--quiet", "-b", "pending")
        pending = self.commit("not landed")
        self.git("checkout", "--quiet", "main")
        self.git("worktree", "add", "--quiet", str(self.root / "linked"), "pending")
        result, report = self.check(pending)
        self.assertEqual(result, 1)
        self.assertTrue(any("分支 refs/heads/pending 有 1 个代码文件" in p for p in report["problems"]))
        self.assertEqual(report["suspects"][0]["branches"], ["refs/heads/pending"])
        self.assertFalse(any("跳过" in note for note in report["notes"]))

    def test_short_and_full_hashes_count_as_one_commit(self) -> None:
        self.git("checkout", "--quiet", "-b", "pending")
        pending = self.commit("pending evidence")
        result, report = self.check(pending[:9], pending, pending[:12])
        self.assertEqual(result, 1)
        self.assertEqual(report["suspect_count"], 1)
        self.assertEqual(report["suspects"][0]["commit"], pending)

    def test_missing_default_ref_fails_closed(self) -> None:
        self.git("branch", "-m", "topic")
        result, report = self.check(self.base)
        self.assertEqual(result, 1)
        self.assertTrue(any("默认分支 refs/heads/main 不存在" in p for p in report["problems"]))

    def test_unrelated_branch_fails_instead_of_silently_skipping(self) -> None:
        orphan = self.git("commit-tree", f"{self.base}^{{tree}}", "-m", "independent history")
        self.git("update-ref", "refs/heads/independent", orphan)
        result, report = self.check(self.base)
        self.assertEqual(result, 1)
        self.assertTrue(any("无法比对分支 refs/heads/independent" in p for p in report["problems"]))

    def test_orphan_evidence_remains_an_explicit_limitation(self) -> None:
        orphan = self.git("commit-tree", f"{self.base}^{{tree}}", "-m", "isolated evidence")
        result, report = self.check(orphan)
        self.assertEqual(result, 0)
        self.assertEqual(report["orphan_count"], 1)
        self.assertTrue(any("需 agent 核对" in n for n in report["notes"]))

    def test_failed_git_query_cannot_report_clean(self) -> None:
        original = subprocess.run

        def fail_branch_query(args, **kwargs):
            if "for-each-ref" in args:
                return subprocess.CompletedProcess(args, 128, "", "query failed")
            return original(args, **kwargs)

        with patch("task_forest.subprocess.run", side_effect=fail_branch_query):
            result, report = self.check(self.base)
        self.assertEqual(result, 1)
        self.assertTrue(any("无法列出未合并分支" in p for p in report["problems"]))


if __name__ == "__main__":
    unittest.main()
