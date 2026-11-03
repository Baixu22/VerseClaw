from dataclasses import dataclass, field


@dataclass
class Task:
    task_id: str
    title: str
    status: str = "todo"
    revision: int = 0


class TaskBoard:
    """A deliberately small task-board fixture with a real transition bug."""

    def __init__(self) -> None:
        self.tasks: dict[str, Task] = {}
        self.events: list[dict[str, object]] = []

    def add_task(self, task_id: str, title: str) -> Task:
        if task_id in self.tasks:
            raise ValueError(f"task already exists: {task_id}")
        task = Task(task_id=task_id, title=title)
        self.tasks[task_id] = task
        return task

    def complete_task(self, task_id: str) -> Task:
        task = self.tasks[task_id]
        task.status = "done"
        task.revision += 1
        self.events.append({
            "type": "completed",
            "task_id": task_id,
            "revision": task.revision,
        })
        return task

    def snapshot(self) -> dict[str, object]:
        return {
            "tasks": {
                task_id: {
                    "title": task.title,
                    "status": task.status,
                    "revision": task.revision,
                }
                for task_id, task in sorted(self.tasks.items())
            },
            "events": [dict(event) for event in self.events],
        }
