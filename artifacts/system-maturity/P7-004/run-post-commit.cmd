@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
set LOG=artifacts\system-maturity\P7-004\post-commit.stdout.log
set ERR=artifacts\system-maturity\P7-004\post-commit.stderr.log
> %LOG% echo post-commit-start HEAD=
git rev-parse HEAD >> %LOG%
call pnpm harness validate --spec harness/specs/tasks/system-maturity-quarterly-audit.md >> %LOG% 2>> %ERR%
echo HARNESS=%ERRORLEVEL% >> %LOG%
call pnpm maturity:evidence >> %LOG% 2>> %ERR%
echo EVIDENCE=%ERRORLEVEL% >> %LOG%
call pnpm maturity:quarterly -- --dry-run >> %LOG% 2>> %ERR%
echo QDRY=%ERRORLEVEL% >> %LOG%
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\post-commit.exit.txt

/* reseal-marker:cd87e3735 */
