"""The strategy sandbox's child process (Feature 6). Run as a separate program:

    python -s -B app/sandbox/child.py       (process sandbox)
    python -s -B /sandbox/child.py          (inside the Docker image)

It imports nothing from the app: only the standard library, numpy, pandas and
guard.py next to it. The parent talks to it with one JSON line per message on
stdin/stdout:

    child  -> {"type": "ready", ...}                 after numpy/pandas loaded
    parent -> {"type": "init", code, params, bars, indicators, limits}
    child  -> {"type": "loaded"}  or  {"type": "error", ...}
    parent -> {"type": "bar", "i": 41, "position": 10, "cash": 95000.0}
    child  -> {"type": "signal", "action": "BUY", "quantity": null, "logs": [...], "cpu_ms": 0.4}
              or {"type": "error", ...}

When stdin closes, it exits.

Layer 2 of the sandbox. It assumes the static check (layer 1) can be bypassed:
  * the code runs with a small set of built-ins; `import` only gives math,
    statistics, numpy and pandas;
  * an audit hook (PEP 578, cannot be removed from Python) blocks opening files
    (except reading Python's own library files), the network, processes,
    native code (ctypes), threads, unpickling and new imports of dangerous
    modules, from the moment the strategy's code first runs;
  * on Linux, kernel limits: no file writes (RLIMIT_FSIZE=0), no new processes
    or threads (RLIMIT_NPROC=0, when not root), memory (RLIMIT_AS) and CPU time
    (RLIMIT_CPU);
  * the parent starts it with an empty environment (no secrets) in an empty
    folder, and enforces the time and memory limits from outside.
"""

import json
import math
import os
import statistics
import sys
import time
import warnings

PROTOCOL = 1
STRATEGY_FILE = "<strategy>"
MAX_INIT_BYTES = 64 * 1024 * 1024
MAX_MESSAGE_BYTES = 1024 * 1024
ACTIONS = ("BUY", "SELL", "EXIT", "HOLD")
FIELDS = ("open", "high", "low", "close", "volume")

# Audit events refused once the strategy's code runs (prefix match).
BLOCKED_EVENTS = (
    "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty",
    "os.kill", "os.killpg", "os.startfile", "os.remove", "os.unlink", "os.rmdir",
    "os.rename", "os.replace", "os.mkdir", "os.chmod", "os.chown", "os.chdir",
    "os.chflags", "os.chroot", "os.link", "os.symlink", "os.truncate", "os.utime",
    "os.listdir", "os.scandir", "os.listxattr", "os.getxattr", "os.setxattr",
    "os.removexattr", "os.putenv", "os.unsetenv", "os.add_dll_directory", "os.lockf",
    "subprocess.", "ctypes.", "socket.", "urllib.", "http.", "ftplib.", "smtplib.",
    "imaplib.", "poplib.", "nntplib.", "telnetlib.", "webbrowser.", "glob.", "shutil.",
    "sys.settrace", "sys.setprofile", "sys._getframe", "sys._current_frames",
    "sys._current_exceptions", "sys.addaudithook", "sys.monitoring",
    "_thread.start_new_thread", "pickle.find_class", "marshal.load", "code.__new__",
    "builtins.input", "cpython.run_", "sqlite3.", "winreg.", "msvcrt.", "_winapi.",
    "mmap.", "fcntl.", "resource.setrlimit", "resource.prlimit", "signal.",
    "tempfile.", "os.fwalk", "pty.", "syslog.", "ctypes.dlopen", "ctypes.dlsym",
    "ctypes.cdata", "ctypes.call_function", "ctypes.set_errno", "ctypes.get_errno",
    "ctypes.string_at", "ctypes.wstring_at", "ctypes.create_string_buffer",
)
# Modules that may not be imported (for the first time) once the code runs.
BLOCKED_IMPORTS = frozenset({
    "socket", "_socket", "ssl", "_ssl", "http", "urllib", "ftplib", "smtplib", "imaplib",
    "poplib", "nntplib", "telnetlib", "xmlrpc", "socketserver", "asyncio", "selectors",
    "select", "subprocess", "_posixsubprocess", "multiprocessing", "_multiprocessing",
    "concurrent", "threading", "_thread", "ctypes", "_ctypes", "cffi", "pty", "tty",
    "shutil", "tempfile", "glob", "pathlib", "zipfile", "tarfile", "webbrowser",
    "signal", "mmap", "fcntl", "resource", "winreg", "_winapi", "msvcrt", "pickle",
    "_pickle", "marshal", "shelve", "dbm", "sqlite3", "_sqlite3", "code", "codeop",
    "pdb", "bdb", "runpy", "importlib", "inspect", "gc", "sys", "os", "posix", "nt",
    "builtins", "io", "_io", "faulthandler", "tracemalloc", "atexit", "platform",
    "sysconfig", "site", "zipimport", "pkgutil", "urllib3", "requests",
})

def _make_audit(roots):
    """The audit hook. It is installed only when the strategy's code is about to
    run, holds no switch to turn it off, and Python offers no way to remove it."""
    roots = tuple(roots)
    blocked_events = BLOCKED_EVENTS
    blocked_imports = BLOCKED_IMPORTS

    def audit(event, args):
        if event == "open":
            _check_open(args, roots)
            return
        if event == "import":
            top = str(args[0]).split(".")[0]
            if top in blocked_imports:
                raise PermissionError(f"Blocked by the sandbox: importing {args[0]}")
            return
        for prefix in blocked_events:
            if event.startswith(prefix):
                raise PermissionError(f"Blocked by the sandbox: {event}")

    return audit


def _check_open(args, roots):
    path, mode = args[0], args[1] if len(args) > 1 else "r"
    flags = args[2] if len(args) > 2 else 0
    if not isinstance(path, (str, bytes)):
        raise PermissionError("Blocked by the sandbox: opening a file descriptor")
    mode = mode or "r"
    if isinstance(mode, str) and any(c in mode for c in "wax+"):
        raise PermissionError("Blocked by the sandbox: writing files")
    if isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
        raise PermissionError("Blocked by the sandbox: writing files")
    real = os.path.realpath(os.fsdecode(path))
    for root in roots:
        if real == root or real.startswith(root + os.sep):
            return
    raise PermissionError("Blocked by the sandbox: reading files")


def _read_roots(np, pd):
    """Where Python, numpy and pandas keep their own files (read-only)."""
    roots = set()
    for base in (sys.base_prefix, sys.prefix, getattr(sys, "base_exec_prefix", sys.prefix)):
        roots.add(os.path.realpath(base))
    for module in (np, pd, json, statistics):
        roots.add(os.path.realpath(os.path.dirname(os.path.dirname(module.__file__))))
    for zone in ("/usr/share/zoneinfo", "/usr/lib/python3/dist-packages/tzdata"):
        if os.path.isdir(zone):
            roots.add(os.path.realpath(zone))
    home = os.path.realpath(os.path.expanduser("~"))
    # Never a whole home folder or a filesystem root.
    return tuple(sorted(r for r in roots if r not in (home, os.path.realpath(os.sep)) and len(r) > 3))


def _send(out, message):
    out.write((json.dumps(message, allow_nan=True, separators=(",", ":")) + "\n").encode("utf-8"))
    out.flush()


def _read(inp, limit):
    line = inp.readline(limit + 1)
    if not line:
        return None
    if len(line) > limit:
        raise ValueError("message too large")
    return json.loads(line)


def _warm_up(np, pd):
    """Use the common numpy/pandas paths once, so modules they load lazily are
    loaded before the audit hook starts refusing new imports."""
    s = pd.Series(np.arange(60, dtype=float) + 1.0)
    frame = pd.DataFrame({"a": s, "b": s * 2})
    s.rolling(5).mean(); s.rolling(5).std(); s.rolling(5).max(); s.rolling(5).min()
    s.ewm(span=5, adjust=False).mean(); s.pct_change(); s.diff(); s.shift(1); s.cumsum()
    s.rank(); s.quantile(0.5); s.describe(); s.clip(0, 10); s.where(s > 3); s.abs()
    frame.corr(); frame.cov(); frame.mean(); frame.std(); frame.tail(3); frame.iloc[-1]
    frame.loc[0, "a"]; frame.sum(axis=1); frame.apply(lambda c: c.max())
    s.expanding().mean(); s.isna(); s.fillna(0); s.round(2); s.astype(int)
    np.mean(s); np.std(s); np.percentile(s, 50); np.log(s); np.sqrt(s); np.diff(s)
    np.polyfit(np.arange(10), np.arange(10.0), 1); np.corrcoef(s, s); np.cumsum(s)
    np.convolve(s, np.ones(3) / 3, mode="valid"); np.argmax(s); np.where(s > 2, 1, 0)
    statistics.mean([1.0, 2.0]); statistics.stdev([1.0, 2.0, 4.0]); statistics.median([1, 2, 3])
    math.sqrt(4.0); math.log(2.0)
    pd.to_datetime(["2024-01-01"]); pd.Timestamp("2024-01-01"); pd.Timedelta(days=1)
    "x".upper(); repr(frame); str(s.iloc[0])


def _limits(limits):
    """Kernel limits on Linux (the parent adds its own on every platform)."""
    try:
        import resource
    except ImportError:  # Windows: the parent's job object sets the limits
        return {}
    applied = {}

    def cap(name, soft, hard=None):
        kind = getattr(resource, name, None)
        if kind is None:
            return
        try:
            current = resource.getrlimit(kind)
            hard = soft if hard is None else hard
            if current[1] != resource.RLIM_INFINITY:
                hard = min(hard, current[1])
                soft = min(soft, hard)
            resource.setrlimit(kind, (soft, hard))
            applied[name] = soft
        except (ValueError, OSError):
            pass

    cpu = int(limits.get("cpu_seconds") or 0)
    if cpu > 0:
        cap("RLIMIT_CPU", cpu, cpu + 2)
    cap("RLIMIT_FSIZE", 0)
    cap("RLIMIT_CORE", 0)
    cap("RLIMIT_NOFILE", 64)
    if os.getuid() != 0:  # root is not limited by RLIMIT_NPROC
        cap("RLIMIT_NPROC", 0)
    memory = int(limits.get("memory_mb") or 0)
    if memory > 0:
        try:
            with open("/proc/self/statm") as fh:
                pages = int(fh.read().split()[0])
            size = pages * os.sysconf("SC_PAGE_SIZE")
            cap("RLIMIT_AS", size + memory * 1024 * 1024)
        except (OSError, ValueError, IndexError):
            pass
    return applied


def _clean_error(exc, source_lines, bar_date=None, phase="bar"):
    """The error as the user should see it: only frames in their code."""
    frames = []
    tb = exc.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        if code.co_filename == STRATEGY_FILE:
            line = tb.tb_lineno
            text = source_lines[line - 1].strip() if 0 < line <= len(source_lines) else ""
            frames.append({"line": line, "function": code.co_name, "text": text[:200]})
        tb = tb.tb_next
    kind = type(exc).__name__
    message = str(exc)[:500]
    if isinstance(exc, RecursionError):
        message = "The code recursed too deeply (the limit is about 200 nested calls)."
    elif isinstance(exc, MemoryError):
        kind, message = "MemoryLimit", "The strategy used more memory than allowed."
    elif isinstance(exc, PermissionError) and message.startswith("Blocked by the sandbox"):
        kind = "SandboxViolation"
    line = frames[-1]["line"] if frames else None
    trace = [f'  line {f["line"]}, in {f["function"]}: {f["text"]}' for f in frames[-8:]]
    return {
        "type": "error",
        "phase": phase,
        "exception": kind,
        "message": message,
        "line": line,
        "bar_date": bar_date,
        "traceback": "\n".join(["Traceback (your code):", *trace, f"{kind}: {message}"]),
    }


def _make_context(arrays, dates, indicators, logs, log_limits):
    """The `context` object the strategy gets. Its data is held in closures, not
    attributes, so the code only sees bars up to the current one."""
    state = {"i": -1}
    per_bar, per_line, total = log_limits

    class Bar:
        __slots__ = ("open", "high", "low", "close", "volume", "date", "index")

    class Context:
        __slots__ = ("bar", "position", "cash", "params")

        def history(self, field, n):
            """The last n values of open/high/low/close/volume, up to this bar."""
            if field not in FIELDS:
                raise ValueError(f"history: field must be one of {', '.join(FIELDS)}")
            if isinstance(n, bool) or not isinstance(n, int) or n < 1 or n > 100_000:
                raise ValueError("history: n must be a whole number from 1 to 100000")
            end = state["i"] + 1
            values = arrays[field][max(0, end - n):end].copy()
            values.setflags(write=False)
            return values

        def indicator(self, name, ago=0, **params):
            """A catalogue indicator's value on this bar (or `ago` bars back), computed
            ahead on the whole series with causal formulas. None during warm-up."""
            if isinstance(ago, bool) or not isinstance(ago, int) or ago < 0:
                raise ValueError("indicator: ago must be a whole number of bars, 0 or more")
            key = _indicator_id(str(name), params)
            series = indicators.get(key)
            if series is None:
                raise ValueError(
                    f"indicator {key} was not computed ahead; call context.indicator with fixed values"
                )
            at = state["i"] - ago
            out = {}
            for output, values in series.items():
                value = values[at] if at >= 0 else None
                out[output] = None if value is None or (isinstance(value, float) and math.isnan(value)) else float(value)
            return next(iter(out.values())) if len(out) == 1 else out

        def log(self, *parts):
            """Show a message in the run's log (capped)."""
            if logs["bar"] >= per_bar or logs["count"] >= total:
                logs["dropped"] += 1
                return
            text = " ".join(str(p) for p in parts)[:per_line]
            logs["lines"].append({"i": state["i"], "date": dates[state["i"]], "text": text})
            logs["bar"] += 1
            logs["count"] += 1

    context = Context()

    def move(i, position, cash, params):
        state["i"] = i
        bar = Bar()
        for field in FIELDS:
            setattr(bar, field, float(arrays[field][i]))
        bar.date = dates[i]
        bar.index = i
        context.bar = bar
        context.position = int(position)
        context.cash = float(cash)
        context.params = params
        return context

    return move, context.log


def _indicator_id(key, params):
    def num(value):
        value = float(value)
        return str(int(value)) if value.is_integer() else repr(value)

    return f"{key.upper()}|" + ",".join(f"{k}={num(v)}" for k, v in sorted(params.items()))


def _normalise(result):
    """BUY / SELL / EXIT / HOLD, optionally with a quantity."""
    quantity = None
    action = result
    if result is None:
        action = "HOLD"
    elif isinstance(result, tuple) and len(result) == 2:
        action, quantity = result
    elif isinstance(result, dict) and set(result) <= {"action", "quantity"} and "action" in result:
        action, quantity = result["action"], result.get("quantity")
    if not isinstance(action, str) or action.upper() not in ACTIONS:
        shown = repr(result)
        raise TypeError(
            f"generate_signal returned {shown[:80]}; return 'BUY', 'SELL', 'EXIT' or 'HOLD' "
            "(or None), optionally with a quantity, e.g. ('BUY', 10)"
        )
    if quantity is not None:
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 0 < quantity <= 1_000_000:
            raise TypeError("the quantity must be a whole number of shares from 1 to 1000000")
    return action.upper(), quantity


def main():
    inp = sys.stdin.buffer
    out = sys.stdout.buffer
    # Nothing but the protocol goes to the real stdout.
    sys.stdout = open(os.devnull, "w")
    warnings.simplefilter("ignore")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import guard  # noqa: E402  (stdlib-only, next to this file)

    import numpy as np
    import pandas as pd

    _warm_up(np, pd)
    _send(out, {
        "type": "ready",
        "protocol": PROTOCOL,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "pid": os.getpid(),
    })

    init = _read(inp, MAX_INIT_BYTES)
    if not init or init.get("type") != "init":
        return
    code = init["code"]
    source_lines = code.splitlines()
    limits = init.get("limits") or {}
    log_limits = (int(limits.get("logs_per_bar", 20)), int(limits.get("log_chars", 300)), int(limits.get("logs_total", 500)))

    if os.environ.get("SRABLE_SANDBOX_TEST_UNGUARDED") != "1":
        try:
            guard.check(code)
        except guard.CodeRefused as exc:
            first = exc.problems[0]
            _send(out, {"type": "error", "phase": "check", "exception": "CodeRefused",
                        "message": str(exc)[:1000], "line": first.line, "bar_date": None,
                        "traceback": "\n".join(p.text() for p in exc.problems)})
            return

    bars = init["bars"]
    arrays = {f: np.asarray(bars[f], dtype=float) for f in FIELDS}
    for values in arrays.values():
        values.setflags(write=False)
    dates = [str(d) for d in bars["date"]]
    indicators = {
        key: {name: [None if v is None else float(v) for v in values] for name, values in series.items()}
        for key, series in (init.get("indicators") or {}).items()
    }
    logs = {"lines": [], "count": 0, "bar": 0, "dropped": 0}
    move, log = _make_context(arrays, dates, indicators, logs, log_limits)
    params = dict(init.get("params") or {})

    def safe_print(*parts, **_ignored):
        log(*parts)

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level != 0 or name not in guard.ALLOWED_MODULES:
            raise ImportError(f"importing {name} is not allowed (allowed: {', '.join(guard.ALLOWED_MODULES)})")
        return {"math": math, "statistics": statistics, "numpy": np, "pandas": pd}[name]

    import builtins as real

    allowed = (
        "abs all any ascii bin bool bytearray bytes callable chr complex dict divmod "
        "enumerate filter float frozenset hash hex int isinstance issubclass iter len "
        "list map max min next object oct ord pow property range repr reversed round "
        "set slice sorted staticmethod classmethod str sum super tuple type zip "
        "ArithmeticError AssertionError AttributeError Exception IndexError KeyError "
        "LookupError NotImplementedError OverflowError RuntimeError StopIteration "
        "TypeError ValueError ZeroDivisionError FloatingPointError True False None "
        "NotImplemented Ellipsis __build_class__"
    ).split()
    safe = {name: getattr(real, name) for name in allowed}
    safe["print"] = safe_print
    safe["__import__"] = safe_import
    namespace = {
        "__builtins__": safe,
        "__name__": "strategy",
        "BUY": "BUY",
        "SELL": "SELL",
        "EXIT": "EXIT",
        "HOLD": "HOLD",
    }

    sys.setrecursionlimit(int(limits.get("recursion", 250)) + 60)
    applied = _limits(limits)
    sys.addaudithook(_make_audit(_read_roots(np, pd)))

    started = time.process_time()
    try:
        compiled = compile(code, STRATEGY_FILE, "exec")
        exec(compiled, namespace)
        entry = namespace.get(guard.ENTRY_POINT)
        if not callable(entry):
            raise TypeError(f"the code must define {guard.ENTRY_POINT}(context)")
    except BaseException as exc:  # noqa: BLE001 - reported to the user
        _send(out, _clean_error(exc, source_lines, phase="load"))
        return
    _send(out, {"type": "loaded", "limits": applied, "cpu_ms": round((time.process_time() - started) * 1000, 3)})

    while True:
        try:
            message = _read(inp, MAX_MESSAGE_BYTES)
        except ValueError:
            return
        if message is None or message.get("type") != "bar":
            return
        i = int(message["i"])
        logs["bar"] = 0
        before = len(logs["lines"])
        context = move(i, message.get("position", 0), message.get("cash", 0.0), params)
        started = time.process_time()
        try:
            action, quantity = _normalise(entry(context))
        except BaseException as exc:  # noqa: BLE001 - reported to the user
            error = _clean_error(exc, source_lines, bar_date=dates[i])
            error["logs"] = logs["lines"][before:]
            _send(out, error)
            return
        _send(out, {
            "type": "signal",
            "action": action,
            "quantity": quantity,
            "logs": logs["lines"][before:],
            "dropped_logs": logs["dropped"],
            "cpu_ms": round((time.process_time() - started) * 1000, 3),
        })


if __name__ == "__main__":
    main()
