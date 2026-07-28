# dcs-visible-production

Program to make every **visible** DCS-related feature **production-usable** (not shelfware).

## Layout

| path | role |
|------|------|
| [STATUS.md](./STATUS.md) | **Metadata only**: progress, locks, next task |
| [tasks/](./tasks/) | **One task one doc** with slices, acceptance, log |
| [tasks/README.md](./tasks/README.md) | Task index |
| `../DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md` | Full gap inventory (reference, not work log) |

## Recover after context loss

1. Open `STATUS.md`
2. Open `activeTaskId` or `nextTaskId` under `tasks/`
3. Do **one slice** only
4. Update task Progress log + STATUS row

## Do not

- Put long designs into STATUS
- Put multiple tasks into one markdown file
- Flip production defaults to prove usability
