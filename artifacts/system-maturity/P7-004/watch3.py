import time,subprocess
from pathlib import Path
root=Path(r"C:/Users/27933/Desktop/clawx/ClawX-maturity-p7")
pid=int((root/"artifacts/system-maturity/P7-004/collect3.pid").read_text().strip())
out=root/"artifacts/system-maturity/P7-004/collect3.poll.txt"
log=root/"artifacts/system-maturity/P7-004/collect3.stdout.log"
exf=root/"artifacts/system-maturity/P7-004/collect3.exit.txt"
lines=[]
for i in range(1,120):
    r=subprocess.run([t"tasklist","/FI",f"PID eq {pid}"],capture_output=True,text=True)
    running=str(pid) in r.stdout
    last="none"
    if log.exists():
        ls=log.read_text(errors="replace").splitlines()
        if ls: last=ls[-1]
    lines.append(f"loop={i} status={'RUNNING' if running else 'EXITED'} last={last}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not running:
        extra=[]
        if exf.exists(): extra.append(exf.read_text(errors="replace"))
        if log.exists(): extra.append(log.read_text(errors="replace"))
        out.write_text(out.read_text(encoding="utf-8") + "\n".join(extra), encoding="utf-8")
        break
    time.sleep(15)

/* reseal-marker:cd87e3735 */
