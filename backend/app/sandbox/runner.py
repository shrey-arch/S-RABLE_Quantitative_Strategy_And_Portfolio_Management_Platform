"""Layer 3 of the strategy sandbox (Feature 6): the parent side.

Starts one sandbox child (a separate process, or a Docker container when Docker
is available and chosen), sends the code, the price data and the pre-computed
indicators once, then exchanges one JSON message per bar. It enforces, from
outside the child:
  * a per-call wall-clock deadline (a bar that takes too long is a timeout);
  * a whole-run wall-clock deadline;
  * a memory cap (RLIMIT_AS in-process on Linux; `docker run --memory` for Docker);
  * child crashes, non-JSON output and oversized output.

Every reply is turned into a StrategySignal for the engine, or raises
StrategyCodeError with the line, exception type, cleaned traceback and bar date.

The sandbox never reaches the database, the network or the app's files: the
child imports nothing from the app, runs with a scrubbed empty environment in an
empty working directory, and (process backend) under kernel limits.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.sandbox import guard
from app.sandbox.limits import SandboxLimits
from app.strategies.signal import SignalAction, StrategySignal

logger = logging.getLogger(__name__)

CHILD_PATH = Path(__file__).with_name("child.py")
DOCKER_IMAGE = os.environ.get("SRABLE_SANDBOX_IMAGE", "srable-strategy-runner:1")
DOCKER_CHILD = "/sandbox/child.py"


class StrategyCodeError(Exception):
    """A custom Python strategy was refused or failed while running. `detail` is
    the structured STRATEGY_CODE_ERROR payload (line, type, traceback, bar date)."""

    def __init__(self, detail: dict):
        self.detail = detail
        super().__init__(detail.get("message") or detail.get("exception") or "strategy error")


class SandboxUnavailable(Exception):
    """The chosen sandbox backend could not be started on this machine."""


@dataclass
class SandboxInfo:
    backend: str
    python: str = ""
    numpy: str = ""
    pandas: str = ""
    image: str | None = None
    limits: dict = field(default_factory=dict)


def docker_available() -> bool:
    """True when the Docker CLI is installed and its daemon answers."""
    docker = shutil.which("docker")
    if not docker:
        return False
    try:
        result = subprocess.run(
            [docker, "image", "inspect", DOCKER_IMAGE],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def choose_backend(preferred: str = "auto") -> str:
    """"docker" when asked for and available, else "process"."""
    if preferred == "process":
        return "process"
    if preferred in ("docker", "auto") and docker_available():
        return "docker"
    if preferred == "docker":
        raise SandboxUnavailable(
            "Docker was requested but is not available (is Docker running and the "
            f"image {DOCKER_IMAGE} built?)."
        )
    return "process"


def _scrubbed_env() -> dict:
    """A tiny environment with nothing of the app's (no secrets)."""
    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "LC_ALL": "C.UTF-8",
        "LANG": "C.UTF-8",
        "TZ": "UTC",
    }
    if os.environ.get("SRABLE_SANDBOX_TEST_UNGUARDED") == "1":
        env["SRABLE_SANDBOX_TEST_UNGUARDED"] = "1"
    return env


def _set_rlimits(limits: SandboxLimits):
    """Run in the child just before exec (process backend, Linux only)."""
    try:
        import resource
    except ImportError:
        return

    def cap(name, soft, hard):
        kind = getattr(resource, name, None)
        if kind is not None:
            try:
                resource.setrlimit(kind, (soft, hard))
            except (ValueError, OSError):
                pass

    cap("RLIMIT_FSIZE", 0, 0)
    cap("RLIMIT_CORE", 0, 0)
    cap("RLIMIT_NOFILE", 64, 64)
    try:
        if os.getuid() != 0:
            cap("RLIMIT_NPROC", 0, 0)
    except AttributeError:
        pass
    cpu = int(limits.cpu_seconds) + 2
    cap("RLIMIT_CPU", cpu, cpu + 2)
    mb = int(limits.memory_mb) + 128  # headroom over the child's own RLIMIT_AS
    cap("RLIMIT_AS", mb * 1024 * 1024, mb * 1024 * 1024)
    try:
        os.setsid()
    except OSError:
        pass


# --- Windows: the memory and process caps the kernel gives through a Job Object ---
# Linux uses RLIMIT_AS and RLIMIT_NPROC (see _set_rlimits). Windows has no such
# limits per process, so the parent puts the child in a job object with a memory
# cap. An allocation past the cap fails, the child raises MemoryError, and the
# run is reported as the memory limit. The job also forbids extra processes and
# dies with its handle, so nothing outlives the sandbox.
_JOB_EXTENDED_LIMIT_INFORMATION = 9
_JOB_LIMIT_ACTIVE_PROCESS = 0x00000008
_JOB_LIMIT_PROCESS_MEMORY = 0x00000100
_JOB_LIMIT_JOB_MEMORY = 0x00000200
_JOB_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000


_JOB_STRUCTS = {}


def _job_structs():
    """The job-object structures, defined once so everything that reads a job back
    uses the same definitions the sandbox set it with."""
    if _JOB_STRUCTS:
        return _JOB_STRUCTS
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    _JOB_STRUCTS["extended"] = JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    return _JOB_STRUCTS


def job_state(job) -> dict | None:
    """What the kernel says this job's limits actually are. For the diagnostic:
    a cap that was set but is not held is the difference between a cap and a
    hope. Returns None when it cannot be read."""
    if os.name != "nt" or not job:
        return None
    try:
        import ctypes
        from ctypes import wintypes

        extended = _job_structs()["extended"]
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.QueryInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, wintypes.LPDWORD]
        kernel32.QueryInformationJobObject.restype = wintypes.BOOL
        info = extended()
        written = wintypes.DWORD(0)
        ok = kernel32.QueryInformationJobObject(job, _JOB_EXTENDED_LIMIT_INFORMATION,
                                                ctypes.byref(info), ctypes.sizeof(info),
                                                ctypes.byref(written))
        if not ok:
            return {"error": ctypes.get_last_error()}
        return {
            "limit_flags": int(info.BasicLimitInformation.LimitFlags),
            "process_memory_limit": int(info.ProcessMemoryLimit),
            "job_memory_limit": int(info.JobMemoryLimit),
            "peak_process_memory": int(info.PeakProcessMemoryUsed),
            "peak_job_memory": int(info.PeakJobMemoryUsed),
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": repr(exc)}


def process_in_job(pid: int, job) -> bool | None:
    """Whether `pid` really is inside `job`. Returns None when it cannot be told."""
    if os.name != "nt" or not job:
        return None
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE,
                                            ctypes.POINTER(wintypes.BOOL)]
        kernel32.IsProcessInJob.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel32.OpenProcess(0x1000, False, int(pid))  # QUERY_LIMITED_INFORMATION
        if not handle:
            return None
        try:
            inside = wintypes.BOOL(0)
            if not kernel32.IsProcessInJob(handle, job, ctypes.byref(inside)):
                return None
            return bool(inside.value)
        finally:
            kernel32.CloseHandle(handle)
    except Exception:  # noqa: BLE001
        return None


def _windows_job(pid: int, memory_mb: int):
    """Put `pid` in a job object capped at `memory_mb`. Returns the job handle to
    keep open for the child's lifetime, or None when it could not be set up."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION = _job_structs()["extended"]
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    # Declared, not left to ctypes' defaults: a HANDLE is 64-bit on x64 and an
    # undeclared argument is passed as a 32-bit int, which silently corrupts it.
    kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                 wintypes.LPVOID, wintypes.DWORD]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        logger.warning("sandbox: could not create the memory cap (CreateJobObject failed, "
                       "error %s); the parent's own memory watchdog is the cap on this run",
                       ctypes.get_last_error())
        return None
    try:
        limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        cap = int(memory_mb) * 1024 * 1024
        limits.ProcessMemoryLimit = cap
        limits.JobMemoryLimit = cap
        limits.BasicLimitInformation.ActiveProcessLimit = 1
        limits.BasicLimitInformation.LimitFlags = (
            _JOB_LIMIT_PROCESS_MEMORY
            | _JOB_LIMIT_JOB_MEMORY
            | _JOB_LIMIT_ACTIVE_PROCESS
            | _JOB_LIMIT_KILL_ON_JOB_CLOSE
        )
        ok = kernel32.SetInformationJobObject(
            job, _JOB_EXTENDED_LIMIT_INFORMATION, ctypes.byref(limits), ctypes.sizeof(limits)
        )
        if not ok:
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
        # PROCESS_SET_QUOTA | PROCESS_TERMINATE
        handle = kernel32.OpenProcess(0x0100 | 0x0001, False, int(pid))
        if not handle:
            raise OSError(ctypes.get_last_error(), "OpenProcess failed")
        try:
            if not kernel32.AssignProcessToJobObject(job, handle):
                raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
        finally:
            kernel32.CloseHandle(handle)
        return job
    except Exception as exc:  # noqa: BLE001 - never let this break a run
        logger.warning("sandbox: could not apply the memory cap (%s); the parent's own "
                       "memory watchdog is the cap on this run", exc)
        # Without the job the sandbox keeps every other layer, and a runaway
        # allocation is still stopped by the per-bar time limit; it just is not
        # reported as the memory limit. Nothing here may raise into a run.
        try:
            ctypes.WinDLL("kernel32").CloseHandle(job)
        except Exception:  # noqa: BLE001
            pass
        return None


_WINDOWS_MEMORY_API: dict = {}


def _windows_memory_api():
    """The Win32 calls for reading a process's memory, looked up once.

    The watchdog asks twenty times a second for the whole of a run, and a
    validation can run this for minutes, so loading the libraries and setting the
    argument types on every call - as this first did - is indefensible: tens of
    thousands of LoadLibrary calls to answer a question the process already knew.
    Looked up once and kept.
    """
    if _WINDOWS_MEMORY_API:
        return _WINDOWS_MEMORY_API
    import ctypes
    from ctypes import wintypes

    class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
            ("PrivateUsage", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    # Declared, so the 64-bit handle is passed whole (see _windows_job).
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    # The same function under both of its names: kernel32 forwards it on every
    # supported Windows, and psapi.dll is the older home. Either will do.
    read = None
    for library, name in ((kernel32, "K32GetProcessMemoryInfo"), (None, "GetProcessMemoryInfo")):
        try:
            owner = library if library is not None else ctypes.WinDLL("psapi", use_last_error=True)
            read = getattr(owner, name)
        except (AttributeError, OSError):
            continue
        read.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD]
        read.restype = wintypes.BOOL
        break

    _WINDOWS_MEMORY_API.update({"kernel32": kernel32, "read": read,
                                "counters": PROCESS_MEMORY_COUNTERS_EX})
    return _WINDOWS_MEMORY_API


def process_memory_bytes(pid: int) -> int | None:
    """How much memory the process is using, on Linux and on Windows.

    Linux reads VmRSS from /proc. Windows asks for PrivateUsage - the private
    commit, which is what a runaway allocation grows, and which (unlike the
    working set) does not fall when the pages are paged out. Returns None when it
    cannot be read, and never raises.
    """
    try:
        if os.name == "posix":
            with open(f"/proc/{pid}/status", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1]) * 1024
            return None
        import ctypes

        api = _windows_memory_api()
        kernel32, read = api["kernel32"], api["read"]
        if read is None:
            return None
        # PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, then the older
        # PROCESS_QUERY_INFORMATION, which some builds still want.
        handle = (kernel32.OpenProcess(0x1000 | 0x0010, False, int(pid))
                  or kernel32.OpenProcess(0x0400 | 0x0010, False, int(pid)))
        if not handle:
            return None
        try:
            counters = api["counters"]()
            counters.cb = ctypes.sizeof(counters)
            if not read(handle, ctypes.byref(counters), counters.cb):
                return None
            return int(max(counters.PrivateUsage, counters.PagefileUsage,
                           counters.WorkingSetSize))
        finally:
            kernel32.CloseHandle(handle)
    except Exception:  # noqa: BLE001 - a reading that fails must not stop a run
        return None


class _Pipe:
    """One running child and the one-JSON-line-each-way protocol over its pipes."""

    def __init__(self, backend: str, limits: SandboxLimits):
        self.backend = backend
        self.limits = limits
        self.workdir = tempfile.mkdtemp(prefix="srable-sandbox-")
        self.process: subprocess.Popen | None = None
        self.container: str | None = None
        self.job = None  # Windows: the job object holding the memory cap
        self.memory_exceeded = 0  # bytes over the baseline, when the watchdog stopped the child
        self.memory_baseline = 0  # bytes the child uses before any of the code runs
        self.reported_pid = 0  # the pid the child says it has (see child_pid)
        self._greeted = False  # whether the child's first message has been read
        self._stderr_tail = b""
        self._start()

    @property
    def child_pid(self) -> int | None:
        """The process that actually runs the code.

        Not always the one we started: on Windows a virtual environment's
        python.exe can be a launcher that runs the real interpreter as a separate
        process. The child reports its own pid in its first message, and that is
        the one worth capping and watching - capping a launcher caps nothing.
        Docker is the exception: a container's pid is its own and is not used.
        """
        if self.reported_pid:
            return self.reported_pid
        return self.process.pid if self.process else None

    def _cap_memory(self) -> None:
        """Windows: hold the child in a job object with the memory cap.

        Called once, when the child has said which process it really is and
        before it has been given any of the strategy's code. Only once: a job
        dies with its handle and takes every process in it, so replacing one
        would kill the process whose pipes the parent is reading.
        """
        if os.name != "nt" or self.job is not None:
            return
        pid = self.child_pid
        if pid is None:
            return
        # Counted from what the interpreter itself uses, like the watchdog, so the
        # cap means the strategy's own memory and a strategy spending its whole
        # allowance is not stopped for numpy and pandas being loaded. A floor, for
        # when the baseline could not be read.
        allowed = int(self.limits.memory_mb) + 64
        cap_mb = max((self.memory_baseline // (1024 * 1024)) + allowed, allowed + 256)
        try:
            self.job = _windows_job(pid, cap_mb)
        except Exception:  # noqa: BLE001 - a missing cap must not stop the run
            self.job = None

    def _start(self) -> None:
        if self.backend == "docker":
            self._start_docker()
        else:
            self._start_process()

    def _start_process(self) -> None:
        kwargs: dict[str, Any] = {}
        if os.name == "posix":
            kwargs["preexec_fn"] = lambda: _set_rlimits(self.limits)
        else:
            # No console window for the child, and its own group so it can be killed.
            kwargs["creationflags"] = 0x08000000 | subprocess.CREATE_NEW_PROCESS_GROUP
        self.process = subprocess.Popen(
            [sys.executable, "-s", "-B", "-E", str(CHILD_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.workdir,
            env=_scrubbed_env(),
            close_fds=True,
            **kwargs,
        )
        # Nothing is capped here. On Windows the pid we have may belong to a
        # launcher rather than to the interpreter that will run the code, so the
        # cap waits for the child's first message, which says which process it
        # really is - and which arrives before the code is sent.

    def _start_docker(self) -> None:
        name = f"srable-sandbox-{os.getpid()}-{int(time.time()*1000)}"
        self.container = name
        env_args = []
        for key, value in _scrubbed_env().items():
            if key in ("PYTHONHASHSEED", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS",
                       "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "TZ", "SRABLE_SANDBOX_TEST_UNGUARDED"):
                env_args += ["-e", f"{key}={value}"]
        command = [
            "docker", "run", "--rm", "-i", "--name", name,
            "--network", "none",
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--pids-limit", "64",
            "--memory", f"{int(self.limits.memory_mb) + 64}m",
            "--memory-swap", f"{int(self.limits.memory_mb) + 64}m",
            "--cpus", str(self.limits.docker_cpus),
            "--tmpfs", "/tmp:size=16m,noexec",
            "--user", "65534:65534",
            "--workdir", "/sandbox",
            *env_args,
            DOCKER_IMAGE,
            "python", "-s", "-B", "-E", DOCKER_CHILD,
        ]
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            close_fds=True,
        )

    # --- protocol -----------------------------------------------------------------
    def send(self, message: dict) -> None:
        assert self.process and self.process.stdin
        data = (json.dumps(message, allow_nan=True, separators=(",", ":")) + "\n").encode("utf-8")
        try:
            self.process.stdin.write(data)
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise self._died("while sending to the sandbox") from exc

    def receive(self, deadline: float) -> dict:
        """Read one JSON line, or raise on timeout / crash / bad output."""
        assert self.process and self.process.stdout
        result: dict[str, Any] = {}
        done = threading.Event()

        def read():
            try:
                result["line"] = self.process.stdout.readline()
            except Exception as exc:  # noqa: BLE001
                result["error"] = exc
            finally:
                done.set()

        thread = threading.Thread(target=read, daemon=True)
        thread.start()
        if not self._wait(done, deadline):
            self.kill()
            if self.memory_exceeded:
                raise MemoryError(self.memory_exceeded)
            raise TimeoutError
        if "error" in result:
            raise self._died("while reading from the sandbox")
        line = result.get("line") or b""
        if not line:
            raise self._died("without answering")
        if len(line) > 4 * 1024 * 1024:
            self.kill()
            raise ValueError("the sandbox sent more than 4 MB for one bar")
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            self.kill()
            raise ValueError("the sandbox sent something that was not a valid message") from exc
        if not self._greeted and message.get("type") == "ready":
            # The child has imported numpy and pandas and is waiting for the code.
            # It also says which process it really is, which can differ from the
            # one we started, so this is where the cap and the baseline are set -
            # once, and still before any of the strategy's code has run.
            self._greeted = True
            if self.backend != "docker":
                # Inside a container the pid is the container's own and means
                # nothing here; Docker caps memory itself with --memory.
                try:
                    self.reported_pid = int(message.get("pid") or 0)
                except (TypeError, ValueError):
                    self.reported_pid = 0
                if self.reported_pid and self.process and self.reported_pid != self.process.pid:
                    logger.info("sandbox: the child reports pid %s, not the %s we started "
                                "(a launcher); capping and watching the one that runs the code",
                                self.reported_pid, self.process.pid)
                pid = self.child_pid
                self.memory_baseline = (process_memory_bytes(pid) or 0) if pid else 0
                self._cap_memory()  # worked out from that baseline
        return message

    def _wait(self, done: threading.Event, deadline: float) -> bool:
        """Wait for the child's answer, watching its memory. False on the deadline
        or when the child passed its memory cap (memory_exceeded is then set)."""
        allowed = int(self.limits.memory_mb) * 1024 * 1024
        # Counted from what the interpreter itself uses, so the cap means the
        # strategy's own memory. Until that baseline is known (it is read when the
        # child reports ready) a generous absolute figure stands in, so a run is
        # never stopped for the interpreter's own footprint.
        cap = self.memory_baseline + allowed if self.memory_baseline else allowed + 512 * 1024 * 1024
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return False
            if done.wait(min(left, 0.05)):
                return True
            pid = self.child_pid
            if pid is None:
                return done.wait(0)
            used = process_memory_bytes(pid)
            if used is not None and used > cap:
                self.memory_exceeded = max(used - self.memory_baseline, 1)
                return False

    def _died(self, context: str) -> Exception:
        code = self.process.poll() if self.process else None
        tail = self._read_stderr()
        hint = ""
        if code is not None and code < 0:
            hint = f" (stopped by signal {-code}; often the memory limit)"
        elif code not in (0, None):
            hint = f" (exit code {code})"
        message = f"The sandbox stopped {context}{hint}."
        if tail:
            message += f" Last output: {tail[-300:]}"
        return RuntimeError(message)

    def _read_stderr(self) -> str:
        if self.process and self.process.stderr:
            try:
                self._stderr_tail += self.process.stderr.read() or b""
            except Exception:  # noqa: BLE001
                pass
        return self._stderr_tail.decode("utf-8", "replace").strip()

    def kill(self) -> None:
        if self.backend == "docker" and self.container:
            try:
                subprocess.run(["docker", "kill", self.container], capture_output=True, timeout=10)
            except (subprocess.SubprocessError, OSError):
                pass
        if self.process and self.process.poll() is None:
            try:
                if os.name == "posix":
                    import signal
                    try:
                        os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
                    except (ProcessLookupError, PermissionError, OSError):
                        self.process.kill()
                else:
                    self.process.kill()
            except (ProcessLookupError, OSError):
                pass
        if os.name == "nt" and self.job is not None:
            # The job dies with its handle and takes every process in it, which is
            # how the real child is stopped when the one we started is only a
            # launcher.
            try:
                import ctypes

                ctypes.WinDLL("kernel32").CloseHandle(self.job)
            except Exception:  # noqa: BLE001
                pass
            self.job = None

    def close(self) -> None:
        try:
            if self.process and self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()
        except OSError:
            pass
        if self.process and self.process.poll() is None:
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.kill()
        for stream in ((self.process.stdout, self.process.stderr) if self.process else ()):
            try:
                stream and stream.close()
            except OSError:
                pass
        if self.job is not None:
            try:
                import ctypes

                ctypes.WinDLL("kernel32").CloseHandle(self.job)
            except Exception:  # noqa: BLE001
                pass
            self.job = None
        shutil.rmtree(self.workdir, ignore_errors=True)
