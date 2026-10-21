"""Why is (or is not) the sandbox's memory cap working on this machine?

    python -m app.sandbox.diagnose

Everything the cap depends on, checked one piece at a time and printed. Nothing
here touches the database or the app's data; it starts short-lived child
processes of its own and stops them.

The sandbox caps a strategy's memory two ways:
  1. the kernel's cap - RLIMIT_AS on Linux, a job object on Windows, which makes
     an allocation past the cap fail as it is made;
  2. the parent's watchdog - it reads the child's memory while waiting and stops
     it, for a machine where the kernel cap could not be set up.
If a memory bomb is not being stopped, one of these lines says why.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time

from app.sandbox import runner
from app.sandbox.limits import SandboxLimits
from app.sandbox.strategy import SandboxStrategy
from app.sandbox.runner import StrategyCodeError

# A child that allocates a gigabyte in 8 MB steps once told to, and says how far
# it got. Under a working cap it stops early with MemoryError.
PROBE = (
    "import os, sys\n"
    "print('PID', os.getpid(), flush=True)\n"
    "sys.stdin.readline()\n"
    "blocks = []\n"
    "try:\n"
    "    for _ in range(128):\n"
    "        blocks.append(bytearray(8 * 1024 * 1024))\n"
    "except MemoryError:\n"
    "    print('STOPPED at', len(blocks) * 8, 'MB', flush=True)\n"
    "else:\n"
    "    print('ALLOCATED', len(blocks) * 8, 'MB with nothing stopping it', flush=True)\n"
)


def line(label: str, value: object) -> None:
    print(f"  {label:<34} {value}")


def mb(value: object) -> str:
    return f"{int(value) // (1024 * 1024)} MB" if isinstance(value, int) else str(value)


def main() -> int:
    logging.basicConfig(level=logging.WARNING, format="  WARNING: %(message)s")
    print("\nSandbox memory cap - what this machine provides")
    line("platform", f"{sys.platform} ({os.name}), python {sys.version.split()[0]}")
    line("64-bit", sys.maxsize > 2**32)
    line("sandbox backend in use", runner.choose_backend("auto"))
    line("docker available", runner.docker_available())

    print("\n1. Reading a process's memory (the watchdog's eyes)")
    own = runner.process_memory_bytes(os.getpid())
    line("this process", mb(own) if own is not None else "COULD NOT READ")
    if own is None:
        print("     The watchdog cannot see memory on this machine, so the kernel")
        print("     cap below is the only cap. Please send this output.")

    print("\n2. The kernel's cap, on a child of its own")
    child = subprocess.Popen([sys.executable, "-c", PROBE], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    # The process we started, and the one it says it is. On Windows these can
    # differ: a virtual environment's python.exe may be a launcher that runs the
    # real interpreter as a separate process, and then capping the one we started
    # caps an idle stub.
    inner = 0
    try:
        first = (child.stdout.readline() or "").split()
        if len(first) == 2 and first[0] == "PID":
            inner = int(first[1])
    except (OSError, ValueError):
        inner = 0
    line("process we started", child.pid)
    line("process it says it is", inner or "did not say")
    if inner and inner != child.pid:
        line("", "THESE DIFFER - the one we started is a launcher")
    pid = inner or child.pid
    job = None
    if os.name == "nt":
        job = runner._windows_job(pid, 256)
        line("job object", "created and assigned" if job else "COULD NOT BE APPLIED")
        if job:
            # A cap that was set but is not held is the difference between a cap
            # and a hope, so read it back from the kernel rather than trusting it.
            line("child really inside that job", runner.process_in_job(pid, job))
            state = runner.job_state(job)
            if state and "error" not in state:
                line("limit flags held", hex(state["limit_flags"]))
                line("process memory limit held", mb(state["process_memory_limit"]))
                line("job memory limit held", mb(state["job_memory_limit"]))
            else:
                line("reading the job back", state)
    else:
        line("job object", "not applicable (POSIX uses RLIMIT_AS, in the child)")
    watch = _Watcher(pid)
    watch.start()
    try:
        out, err = child.communicate(input="go\n", timeout=120)
    except subprocess.TimeoutExpired:
        child.kill()
        out, err = "", "the probe did not answer in 120 s"
    watch.stop()
    line("what happened", (out or err or "the child died silently").strip()[:200])
    line("memory seen while it ran", watch.describe())
    if job:
        state = runner.job_state(job)
        if state and "error" not in state:
            line("peak the job charged it", mb(state["peak_process_memory"]))
        try:
            import ctypes
            ctypes.WinDLL("kernel32").CloseHandle(job)
        except Exception:  # noqa: BLE001
            pass

    print("\n3. The sandbox itself, against a memory bomb (128 MB cap)")
    code = ("def generate_signal(context):\n"
            "    blocks = []\n"
            "    for _ in range(200):\n"
            "        blocks.append(bytearray(8 * 1024 * 1024))\n"
            "    return 'HOLD'\n")
    import numpy as np
    import pandas as pd
    close = 100 + np.arange(4, dtype=float)
    frame = pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                          "close": close, "volume": np.full(4, 1000.0)},
                         index=pd.date_range("2024-01-01", periods=4, freq="D", tz="UTC"))
    os.environ["SRABLE_SANDBOX_TEST_UNGUARDED"] = "1"
    started = time.monotonic()
    watch = None
    try:
        strategy = SandboxStrategy(code, limits=SandboxLimits(call_ms=20000, run_seconds=30,
                                                              memory_mb=128))
        try:
            strategy.prepare(frame)
            line("process we started", strategy._pipe.process.pid)
            line("process it says it is", strategy._pipe.reported_pid or "did not say")
            pid = strategy._pipe.child_pid
            line("capped and watched", pid)
            line("its memory before the bar", mb(runner.process_memory_bytes(pid)))
            line("watchdog baseline", mb(strategy._pipe.memory_baseline))
            line("watchdog would stop it over", mb(strategy._pipe.memory_baseline
                                                   + 128 * 1024 * 1024))
            watch = _Watcher(pid)
            watch.start()
            strategy.generate_signal(_Context(frame))
            line("RESULT", "NOT STOPPED - the bomb ran to the end")
        finally:
            if watch is not None:
                watch.stop()
            strategy.close()
    except StrategyCodeError as exc:
        line("RESULT", f"stopped as {exc.detail.get('exception')}")
        line("message", exc.detail.get("message"))
    except Exception as exc:  # noqa: BLE001
        line("RESULT", f"{type(exc).__name__}: {exc}")
    finally:
        os.environ.pop("SRABLE_SANDBOX_TEST_UNGUARDED", None)
    if watch is not None:
        line("memory seen while it ran", watch.describe())
    line("took", f"{time.monotonic() - started:.1f} s")
    print("")
    return 0


class _Watcher:
    """Samples one process's memory in the background, so the run can be told
    apart from the reading: if these numbers grow and nothing acted, the fault is
    in the deciding, not in the seeing."""

    def __init__(self, pid: int, every: float = 0.05):
        self.pid = pid
        self.every = every
        self.samples: list[int] = []
        self.unreadable = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def _loop(self) -> None:
        while not self._stop.wait(self.every):
            value = runner.process_memory_bytes(self.pid)
            if value is None:
                self.unreadable += 1
            else:
                self.samples.append(value)

    def describe(self) -> str:
        if not self.samples:
            return f"nothing readable ({self.unreadable} failed readings)"
        highest = max(self.samples)
        trail = ", ".join(mb(v) for v in self.samples[-4:])
        return (f"{len(self.samples)} readings, highest {mb(highest)}, "
                f"last: {trail}" + (f" ({self.unreadable} unreadable)" if self.unreadable else ""))


class _Context:
    """The least a strategy needs for one bar."""

    def __init__(self, frame):
        self.timestamp = frame.index[2]
        self.market_data = {"bar_index": 2, "position_quantity": 0, "cash": 100000.0,
                            "data": frame}


if __name__ == "__main__":
    raise SystemExit(main())
