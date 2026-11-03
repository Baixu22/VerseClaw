import unittest

from src.taskboard import TaskBoard


class TaskBoardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.board = TaskBoard()
        self.board.add_task("T-1", "Prepare release notes")

    def test_complete_moves_task_to_done_and_records_one_event(self) -> None:
        task = self.board.complete_task("T-1")

        self.assertEqual(task.status, "done")
        self.assertEqual(task.revision, 1)
        self.assertEqual(self.board.events, [
            {"type": "completed", "task_id": "T-1", "revision": 1},
        ])

    def test_repeated_completion_is_idempotent(self) -> None:
        self.board.complete_task("T-1")
        task = self.board.complete_task("T-1")

        self.assertEqual(task.status, "done")
        self.assertEqual(task.revision, 1)
        self.assertEqual(self.board.events, [
            {"type": "completed", "task_id": "T-1", "revision": 1},
        ])

    def test_unknown_task_is_rejected(self) -> None:
        with self.assertRaises(KeyError):
            self.board.complete_task("missing")

    def test_duplicate_task_id_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.board.add_task("T-1", "Duplicate")


if __name__ == "__main__":
    unittest.main()
