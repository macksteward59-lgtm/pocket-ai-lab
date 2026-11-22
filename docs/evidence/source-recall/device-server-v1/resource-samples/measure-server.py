#!/usr/bin/env python3
"""Run the passage suite's Linux llama-server child and record its own lifetime resource usage."""
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time

if platform.system() != "Linux":
    raise SystemExit("This recorder interprets ru_maxrss in Linux KiB.")
binary = Path(os.environ["POCKET_LLAMA_SERVER"]).resolve(strict=True)
args = sys.argv[1:]
if args == ["--version"]:
    os.execv(binary, [str(binary), *args])
if "--host" not in args or args[args.index("--host")+1:args.index("--host")+2] != ["127.0.0.1"]:
    raise SystemExit("Expected a loopback-only passage-suite server.")
output = Path(os.environ["POCKET_SERVER_USAGE"])
with output.open("x", encoding="utf-8") as report:
    started = time.monotonic()
    child = subprocess.Popen([binary, *args])
    def shutdown(signum, _frame):
        try:
            os.kill(child.pid, signum)
        except ProcessLookupError:
            pass
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    _, status, usage = os.wait4(child.pid, 0)
    child.returncode = os.waitstatus_to_exitcode(status)
    json.dump(dict(environment=platform.system()+"/"+platform.machine(), scope="llama-server process lifetime",
                   maxResidentKiB=usage.ru_maxrss, maxResidentBytes=usage.ru_maxrss*1024,
                   userCPUSeconds=usage.ru_utime, systemCPUSeconds=usage.ru_stime,
                   elapsedSeconds=round(time.monotonic()-started,3), childExitStatus=child.returncode),report,indent=2)
    report.write("\n")
raise SystemExit(128-child.returncode if child.returncode<0 else child.returncode)
