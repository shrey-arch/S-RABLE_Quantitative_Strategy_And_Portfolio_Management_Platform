"""Feature 6: the strategy sandbox's safety, layer by layer.

Layer 1 (guard.py)  - the static check refuses hostile code, naming the line.
Layer 2 (child.py)  - with the static check switched OFF, the running code still
                      cannot read or write files, reach the network, start
                      processes or threads, load native code, read frames, or
                      see the app's secrets. These tests deliberately use the
                      classic escapes (subclass gadget chains) to prove the
                      second layer stands on its own.
Layer 3 (runner.py) - time, memory, recursion and output limits are enforced
                      from outside, and a dead child is reported, not hung on.

Every test also checks the user gets an honest, specific error.

The same tests run against the Docker backend when Docker is available and the
image is built (SRABLE_SANDBOX_IMAGE, default srable-strategy-runner:1);
otherwise that half is skipped.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest

from app.backtesting.broker import SimulatedBroker
from app.backtesting.engine import BacktestEngine
from app.sandbox import guard
from app.sandbox.limits import SandboxLimits
from app.sandbox import runner as runner_module
from app.sandbox.runner import StrategyCodeError, docker_available
from app.sandbox.strategy import SandboxStrategy
from app.strategies.momentum import MomentumStrategy

BACKENDS = ["process"]
if docker_available():  # pragma: no cover - only on a machine with Docker running
    BACKENDS.append("docker")

needs_docker = pytest.mark.skipif(
    "docker" not in BACKENDS,
    reason="Docker is not running or the sandbox image is not built.",
)

# A file of the app's that really exists, so "cannot read the app's files" is tested
# against something present rather than something missing.
SECRET_FILE = str(Path(__file__).resolve().parents[1] / "app" / "config" / "settings.py")


def bars(n: int = 40, seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    close = np.maximum(close, 5.0)
    return pd.DataFrame(
        {
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC"),
    )


def wrap(body: str) -> str:
    """A strategy whose generate_signal runs `body` (indented) and holds."""
    body = body.replace("LIBRARY", LIBRARY)
    indented = "\n".join("    " + line for line in body.strip().splitlines())
    return f"def generate_signal(context):\n{indented}\n    return 'HOLD'\n"


def run_code(code: str, *, backend: str = "process", n: int = 6, limits=None, unguarded=False, data=None):
    """Run `code` over `n` bars and return (signals, strategy)."""
    frame = bars(n) if data is None else data
    if unguarded:
        os.environ["SRABLE_SANDBOX_TEST_UNGUARDED"] = "1"
    try:
        strategy = SandboxStrategy(
            code,
            backend=backend,
            limits=limits or SandboxLimits(call_ms=2000, run_seconds=30),
            collect_logs=True,
        )
        with strategy:
            result = BacktestEngine().run(
                strategy=strategy,
                data=frame,
                execution_id=uuid4(),
                instrument_id=uuid4(),
                initial_capital=100_000.0,
                broker=SimulatedBroker(),
                quantity=1,
            )
            return result, strategy
    finally:
        os.environ.pop("SRABLE_SANDBOX_TEST_UNGUARDED", None)


# A library the platform really has, so loading it is refused by the sandbox and
# not by ctypes itself (CDLL(None) is a TypeError on Windows).
LIBRARY = '"kernel32"' if os.name == "nt" else "None"


def probe(code_body: str, backend: str) -> str:
    """Run a body that logs 'label=OK/BLOCKED' lines with the guard OFF, and
    return every logged line joined. Used to prove layer 2 on its own."""
    _result, strategy = run_code(wrap(code_body), backend=backend, n=2, unguarded=True)
    return " | ".join(line["text"] for line in strategy.logs)


# --- layer 1: the static check ------------------------------------------------------

HOSTILE = [
    ("import os\ndef generate_signal(context):\n    return 'HOLD'\n", "importing os"),
    ("import subprocess\ndef generate_signal(context):\n    return 'HOLD'\n", "importing subprocess"),
    ("from os import system\ndef generate_signal(context):\n    return 'HOLD'\n", "importing os"),
    ("import numpy, os\ndef generate_signal(context):\n    return 'HOLD'\n", "importing os"),
    ("from . import x\ndef generate_signal(context):\n    return 'HOLD'\n", "importing ."),
    ("from numpy import *\ndef generate_signal(context):\n    return 'HOLD'\n", "import *"),
    (wrap("open('/etc/passwd')"), "strategies cannot read or write files"),
    (wrap("eval('1+1')"), "eval runs text as code"),
    (wrap("exec('x=1')"), "exec runs text as code"),
    (wrap("compile('1', 'x', 'eval')"), "compile builds code at run time"),
    (wrap("__import__('os')"), "double-underscore names"),
    (wrap("x = ().__class__.__base__.__subclasses__()"), "private and double-underscore"),
    (wrap("x = context.__class__"), "private and double-underscore"),
    (wrap("x = getattr(context, 'bar')"), "getattr reaches attributes"),
    (wrap("x = globals()"), "globals() reaches outside"),
    (wrap("x = vars(context)"), "vars() reaches object internals"),
    (wrap("x = '{0.__class__}'.format(context)"), "str.format can read attributes"),
    (wrap("import pandas as pd\npd.eval('1+1')"), "pandas.eval runs text as code"),
    (wrap("import pandas as pd\npd.read_csv('/etc/passwd')"), "reading files is not allowed"),
    (wrap("import numpy as np\nnp.load('/tmp/x.npy')"), "loading files is not allowed"),
    (wrap("import numpy as np\nnp.save('/tmp/x', [1])"), "saving files is not allowed"),
    (wrap("import numpy as np\nx = np.random.rand()"), "randomness is not allowed"),
    (wrap("import pandas as pd\nx = pd.Timestamp.now()"), "the clock is not available"),
    (wrap("context.history('close', 5).tofile('/tmp/x')"), "writing files is not allowed"),
    (wrap("context.history('close', 5).to_csv('/tmp/x')"), "writing data out is not allowed"),
    (wrap("x = context.log.__globals__"), "private and double-underscore"),
    ("async def generate_signal(context):\n    return 'HOLD'\n", "async functions are not supported"),
    ("def generate_signal(a, b):\n    return 'HOLD'\n", "exactly one argument"),
    ("x = 1\n", "must define generate_signal(context)"),
    ("def generate_signal(:\n", "syntax error"),
]


@pytest.mark.parametrize("code,expected", HOSTILE, ids=[c.splitlines()[0][:40] for c, _ in HOSTILE])
def test_the_static_check_refuses_hostile_code_with_the_line(code, expected):
    with pytest.raises(guard.CodeRefused) as caught:
        guard.check(code)
    problems = caught.value.problems
    assert expected in str(caught.value), str(caught.value)
    assert all(p.line >= 1 for p in problems)
    assert problems[0].text().startswith(f"Line {problems[0].line}: ")


def test_ordinary_strategies_are_accepted_and_their_indicators_found():
    code = (
        "import numpy as np\n"
        "import pandas as pd\n"
        "from math import sqrt\n"
        "def helper(values):\n"
        "    return float(np.mean(values)) + sqrt(1.0)\n"
        "class Keeper:\n"
        "    def __init__(self):\n"
        "        self._seen = 0\n"
        "    def bump(self):\n"
        "        self._seen += 1\n"
        "        return self._seen\n"
        "def generate_signal(context):\n"
        "    fast = context.indicator('SMA', period=5)\n"
        "    slow = context.indicator('SMA', period=20)\n"
        "    rsi = context.indicator('RSI', period=14, ago=1)\n"
        "    band = context.indicator('BOLLINGER', window=20, num_std=2.0)\n"
        "    context.log(f'fast={fast} slow={slow} rsi={rsi}')\n"
        "    if fast is None or slow is None:\n"
        "        return 'HOLD'\n"
        "    return ('BUY', 3) if fast > slow else 'EXIT'\n"
    )
    uses = guard.check(code)
    assert [u.id for u in uses] == [
        "BOLLINGER|num_std=2,window=20",
        "RSI|period=14",
        "SMA|period=20",
        "SMA|period=5",
    ]


def test_indicator_calls_must_use_fixed_values_and_known_names():
    with pytest.raises(guard.CodeRefused, match="fixed numbers"):
        guard.check(wrap("x = context.indicator('SMA', period=context.params['n'])"))
    with pytest.raises(guard.CodeRefused, match="unknown indicator"):
        guard.check(wrap("x = context.indicator('MAGIC', period=5)"))
    with pytest.raises(guard.CodeRefused, match="needs the indicator"):
        guard.check(wrap("x = context.indicator(5)"))


def test_the_code_size_and_shape_are_capped():
    with pytest.raises(guard.CodeRefused, match="longer than"):
        guard.check(wrap("pass") + "#" * 100_001)
    with pytest.raises(guard.CodeRefused, match="is empty"):
        guard.check("   ")
    with pytest.raises(guard.CodeRefused, match="too large"):
        guard.check(wrap("x = 1\n" * 8000))


# --- layer 2: the running code, with the static check switched OFF ---------------------

GADGET = """
sysmod = None
for c in ().__class__.__base__.__subclasses__():
    try:
        gl = c.__init__.__globals__
    except Exception:
        continue
    if "sys" in gl:
        try:
            gl["sys"].modules
            sysmod = gl["sys"]
            break
        except Exception:
            pass
"""


@pytest.mark.parametrize("backend", BACKENDS)
def test_running_code_cannot_touch_files_processes_or_the_network(backend):
    body = GADGET + """
mods = sysmod.modules
builtins = mods["builtins"]
SECRET_FILE = r"__SECRET__"
checks = [
    ("read_etc_passwd", lambda: builtins.open("/etc/passwd").read()),
    ("read_secret", lambda: builtins.open(SECRET_FILE).read()),
    ("write_file", lambda: builtins.open("/tmp/sandbox-escape", "w")),
    ("io_write", lambda: mods["io"].open("/tmp/sandbox-escape2", "w")),
    ("os_system", lambda: mods["os"].system("true")),
    ("os_popen", lambda: mods["os"].popen("true")),
    ("subprocess", lambda: mods["subprocess"].Popen(["true"])),
    ("fork", lambda: mods["os"].fork()),
    ("listdir", lambda: mods["os"].listdir("/")),
    ("remove", lambda: mods["os"].remove("/tmp/anything")),
    ("socket_create", lambda: mods["socket"].socket()),
    ("socket_lookup", lambda: mods["socket"].getaddrinfo("example.com", 80)),
    ("thread", lambda: mods["_thread"].start_new_thread(int, ())),
    ("getframe", lambda: sysmod._getframe()),
    ("settrace", lambda: sysmod.settrace(None)),
    ("ctypes_dlopen", lambda: mods["ctypes"].CDLL(LIBRARY)),
    ("ctypes_pythonapi", lambda: mods["ctypes"].pythonapi.PyList_New(0)),
]
for label, fn in checks:
    try:
        fn()
        context.log(label + "=OK")
    except Exception as exc:
        context.log(label + "=BLOCKED:" + type(exc).__name__)
"""
    text = probe(body.replace("__SECRET__", SECRET_FILE), backend)
    assert text, "the probe logged nothing"
    for label in (
        "read_etc_passwd", "read_secret", "write_file", "io_write", "os_system", "os_popen",
        "subprocess", "fork", "listdir", "remove", "socket_create", "socket_lookup",
        "thread", "getframe", "settrace", "ctypes_dlopen", "ctypes_pythonapi",
    ):
        assert f"{label}=BLOCKED" in text, f"{label} was NOT blocked: {text}"
    assert not os.path.exists("/tmp/sandbox-escape")
    assert not os.path.exists("/tmp/sandbox-escape2")


@pytest.mark.parametrize("backend", BACKENDS)
def test_the_sandbox_has_none_of_the_apps_secrets_in_its_environment(backend):
    body = GADGET + """
env = dict(sysmod.modules["os"].environ)
context.log("keys=" + ",".join(sorted(env)))
context.log("values=" + "|".join(env.values()))
"""
    text = probe(body, backend)
    assert "keys=" in text
    for forbidden in ("DATABASE_URL", "SECRET_KEY", "SUPABASE", "PASSWORD", "TOKEN", "API_KEY"):
        assert forbidden not in text.upper(), f"{forbidden} reached the sandbox: {text}"
    assert "postgres" not in text.lower()


@pytest.mark.parametrize("backend", BACKENDS)
def test_the_strategy_cannot_see_the_apps_own_code(backend):
    body = GADGET + """
mods = sysmod.modules
context.log("app_loaded=" + str("app" in mods or "app.config" in mods))
try:
    mods["builtins"].__import__("app.config.settings")
    context.log("import_app=OK")
except Exception as exc:
    context.log("import_app=BLOCKED:" + type(exc).__name__)
"""
    text = probe(body, backend)
    assert "app_loaded=False" in text, text
    assert "import_app=BLOCKED" in text, text


# --- layer 3: time, memory, recursion, output ---------------------------------------

@pytest.mark.parametrize("backend", BACKENDS)
def test_an_endless_loop_is_stopped_by_the_per_bar_time_limit(backend):
    code = wrap("while True:\n    pass")
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=3, limits=SandboxLimits(call_ms=400, run_seconds=20), unguarded=True)
    detail = caught.value.detail
    assert detail["exception"] == "Timeout"
    assert "400 ms" in detail["message"]
    assert detail["bar_date"] is not None
    assert detail["code"] == "STRATEGY_CODE_ERROR"


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_slow_strategy_is_stopped_by_the_whole_run_time_limit(backend):
    # Each bar is fine on its own; together they pass the run budget.
    code = wrap(
        "import numpy as np\n"
        "total = 0.0\n"
        "for _ in range(300):\n"
        "    total += float(np.sum(np.arange(500000, dtype=float)))"
    )
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=200, limits=SandboxLimits(call_ms=9000, run_seconds=1))
    assert caught.value.detail["exception"] == "Timeout"
    assert "in total" in caught.value.detail["message"] or "1 second" in caught.value.detail["message"]


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_bar_cut_short_by_the_run_budget_says_so_and_not_the_per_bar_limit(backend):
    """The two deadlines are reported apart. One endless bar with a long per-bar
    allowance and a one-second run budget can only have been stopped by the
    budget, so that is what the message must name - on a fast machine and a slow
    one alike.
    """
    code = wrap("while True:\n    pass")
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=3,
                 limits=SandboxLimits(call_ms=60000, run_seconds=1), unguarded=True)
    detail = caught.value.detail
    assert detail["exception"] == "Timeout"
    assert "in total" in detail["message"], detail["message"]
    assert "60000" not in detail["message"], detail["message"]
    assert "1 second" in detail["message"] and "1 seconds" not in detail["message"]


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_memory_bomb_is_stopped_with_a_clear_message(backend):
    code = wrap("blocks = []\nfor _ in range(200):\n    blocks.append(bytearray(8 * 1024 * 1024))")
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=2, limits=SandboxLimits(call_ms=20000, run_seconds=30, memory_mb=128), unguarded=True)
    detail = caught.value.detail
    assert detail["exception"] in ("MemoryLimit", "SandboxError"), detail
    assert detail["code"] == "STRATEGY_CODE_ERROR"
    assert detail["message"]


def test_the_cap_follows_the_pid_the_child_reports_not_the_one_we_started():
    """On Windows a virtual environment's python.exe can be a launcher that runs
    the real interpreter as a separate process. Capping or watching the process we
    started then caps an idle stub, so the child reports its own pid in its first
    message and that is the one used.
    """
    pipe = runner_module._Pipe("process", SandboxLimits(call_ms=2000, run_seconds=30))
    try:
        ready = pipe.receive(time.monotonic() + 30)
        assert ready["type"] == "ready"
        assert ready["pid"], "the child must say which process it is"
        assert pipe.reported_pid == ready["pid"]
        assert pipe.child_pid == ready["pid"]
        # Whatever it reports is what gets capped and watched, launcher or not.
        pipe.reported_pid = 999999
        assert pipe.child_pid == 999999
        pipe.reported_pid = 0
        assert pipe.child_pid == pipe.process.pid
    finally:
        pipe.kill()
        pipe.close()


def test_the_memory_cap_is_applied_once_and_never_replaced():
    """A job object dies with its handle and takes every process in it. Replacing
    one would kill the process whose pipes the parent reads, which is how an
    earlier version of this broke every run, so the cap is applied once.
    """
    pipe = runner_module._Pipe("process", SandboxLimits(call_ms=2000, run_seconds=30))
    try:
        assert pipe.receive(time.monotonic() + 30)["type"] == "ready"
        assert pipe._greeted, "the first message is where the cap is set"
        held = object()
        pipe.job = held
        pipe._cap_memory()
        assert pipe.job is held, "an existing cap must not be replaced"
        # And the child is still alive, not killed by the capping.
        assert pipe.process.poll() is None, "capping must not kill the child"
        assert pipe.child_pid
    finally:
        pipe.job = None
        pipe.kill()
        pipe.close()


def test_the_parent_watches_the_memory_of_a_child_the_kernel_did_not_cap():
    """The kernel cap (RLIMIT_AS on Linux, a job object on Windows) stops an
    allocation as it is made, and is what the test above exercises. This checks
    the parent's own backstop for a machine where that cap could not be set up:
    it samples the child's memory while waiting and stops it. Driven by reporting
    a size over the cap, so it runs on every platform.
    """
    limits = SandboxLimits(call_ms=2000, run_seconds=30, memory_mb=128)
    pipe = runner_module._Pipe("process", limits)
    try:
        assert pipe.receive(time.monotonic() + 30).get("type") == "ready"
        assert pipe.memory_baseline >= 0
        real = runner_module.process_memory_bytes
        # Over the cap both ways: over baseline + 128 MB when the baseline could be
        # read, and over the standing-in figure used when it could not.
        over = pipe.memory_baseline + (128 + 600) * 1024 * 1024
        runner_module.process_memory_bytes = lambda pid: over
        try:
            # Nothing was sent, so the only reason to stop waiting is the memory.
            with pytest.raises(MemoryError):
                pipe.receive(time.monotonic() + 5)
        finally:
            runner_module.process_memory_bytes = real
        assert pipe.memory_exceeded > 128 * 1024 * 1024
    finally:
        pipe.kill()
        pipe.close()


def test_a_memory_stop_is_reported_as_the_memory_limit_not_a_crash():
    """Whichever layer stopped it, the user is told the same honest thing."""
    strategy = SandboxStrategy("def generate_signal(context):\n    return 'HOLD'\n",
                               limits=SandboxLimits(memory_mb=128))
    detail = strategy._memory_detail("bar", "2024-01-03T00:00:00+00:00",
                                     MemoryError(300 * 1024 * 1024))
    assert detail["exception"] == "MemoryLimit"
    assert "128 MB" in detail["message"]
    assert "300 MB" in detail["message"]
    assert detail["bar_date"] == "2024-01-03T00:00:00+00:00"


@pytest.mark.parametrize("backend", BACKENDS)
def test_deep_recursion_is_reported_as_a_recursion_error_not_a_crash(backend):
    code = (
        "def deep(n):\n"
        "    return deep(n + 1)\n"
        "def generate_signal(context):\n"
        "    return deep(0)\n"
    )
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=2)
    detail = caught.value.detail
    assert detail["exception"] == "RecursionError"
    assert "recursed too deeply" in detail["message"]
    assert detail["line"] in (1, 2)


@pytest.mark.parametrize("backend", BACKENDS)
def test_floods_of_logs_are_capped_and_the_run_survives(backend):
    code = wrap("for i in range(500):\n    context.log('x' * 5000, i)")
    _result, strategy = run_code(
        code, backend=backend, n=5, limits=SandboxLimits(call_ms=4000, run_seconds=30, logs_per_bar=10, logs_total=25, log_chars=100)
    )
    assert len(strategy.logs) <= 25
    assert all(len(line["text"]) <= 100 for line in strategy.logs)


# --- the error the user sees ---------------------------------------------------------

@pytest.mark.parametrize("backend", BACKENDS)
def test_a_mistake_in_the_code_names_the_line_the_type_and_the_bar(backend):
    code = (
        "def generate_signal(context):\n"
        "    closes = context.history('close', 5)\n"
        "    return 'BUY' if float(closes[0]) / 0 > 1 else 'HOLD'\n"
    )
    with pytest.raises(StrategyCodeError) as caught:
        run_code(code, backend=backend, n=4)
    detail = caught.value.detail
    assert detail["exception"] == "ZeroDivisionError"
    assert detail["line"] == 3
    assert detail["bar_date"].startswith("2024-01")
    assert "generate_signal" in detail["traceback"]
    # The traceback shows the user's code only, never the sandbox's own frames.
    assert "child.py" not in detail["traceback"] and "app/" not in detail["traceback"]


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_wrong_return_value_explains_what_to_return(backend):
    with pytest.raises(StrategyCodeError) as caught:
        run_code("def generate_signal(context):\n    return 42\n", backend=backend, n=2)
    assert "return 'BUY', 'SELL', 'EXIT' or 'HOLD'" in caught.value.detail["message"]
    with pytest.raises(StrategyCodeError) as caught:
        run_code("def generate_signal(context):\n    return ('BUY', -5)\n", backend=backend, n=2)
    assert "whole number of shares" in caught.value.detail["message"]


@pytest.mark.parametrize("backend", BACKENDS)
def test_the_context_refuses_bad_arguments_with_a_helpful_message(backend):
    with pytest.raises(StrategyCodeError) as caught:
        run_code(wrap("context.history('closes', 5)"), backend=backend, n=2)
    assert "field must be one of" in caught.value.detail["message"]
    with pytest.raises(StrategyCodeError) as caught:
        run_code(wrap("context.history('close', 0)"), backend=backend, n=2)
    assert "n must be a whole number" in caught.value.detail["message"]


# --- what a strategy may legitimately do ---------------------------------------------

@pytest.mark.parametrize("backend", BACKENDS)
def test_a_strategy_sees_only_past_bars_and_its_own_parameters(backend):
    code = (
        "def generate_signal(context):\n"
        "    closes = context.history('close', 1000)\n"
        "    context.log(f'bars={len(closes)} index={context.bar.index} "
        "close={context.bar.close} pos={context.position} cash={context.cash} p={context.params}')\n"
        "    return 'HOLD'\n"
    )
    frame = bars(8)
    _result, strategy = run_code(code, backend=backend, data=frame)
    lines = [line["text"] for line in strategy.logs]
    assert len(lines) == 8
    for i, text in enumerate(lines):
        # On bar i the strategy can see exactly i + 1 bars: never the future.
        assert f"bars={i + 1} " in text
        assert f"index={i} " in text
        assert f"close={float(frame['close'].iloc[i])} " in text
    assert "cash=100000.0" in lines[0]


@pytest.mark.parametrize("backend", BACKENDS)
def test_indicators_come_from_the_catalogue_and_warm_up_as_none(backend):
    code = (
        "def generate_signal(context):\n"
        "    sma = context.indicator('SMA', period=5)\n"
        "    context.log(f'sma={sma}')\n"
        "    return 'HOLD'\n"
    )
    frame = bars(8)
    _result, strategy = run_code(code, backend=backend, data=frame)
    values = [line["text"].split("=", 1)[1] for line in strategy.logs]
    assert values[:4] == ["None"] * 4  # the first four bars cannot have a 5-bar average
    expected = frame["close"].rolling(5).mean()
    for i in range(4, 8):
        assert abs(float(values[i]) - float(expected.iloc[i])) < 1e-9


def test_the_same_code_and_data_give_the_same_result_every_time():
    code = (
        "import numpy as np\n"
        "def generate_signal(context):\n"
        "    closes = context.history('close', 10)\n"
        "    if len(closes) < 10:\n"
        "        return 'HOLD'\n"
        "    return 'BUY' if context.bar.close > float(np.mean(closes)) else 'SELL'\n"
    )
    frame = bars(60, seed=11)
    runs = []
    for _ in range(2):
        result, _strategy = run_code(code, data=frame)
        runs.append(
            (
                round(result.final_capital, 10),
                [(str(t["timestamp"]), t["side"], t["quantity"], round(t["price"], 10)) for t in result.trades],
            )
        )
    assert runs[0] == runs[1]


def test_a_python_copy_of_the_momentum_template_gives_the_templates_own_result():
    """Parity: the same trades, prices and equity curve as the built-in template."""
    frame = bars(300, seed=7)
    instrument_id = uuid4()

    def run(strategy):
        return BacktestEngine().run(
            strategy=strategy,
            data=frame,
            execution_id=uuid4(),
            instrument_id=instrument_id,
            initial_capital=100_000.0,
            broker=SimulatedBroker(slippage_bps=5, brokerage_rate=0.0003),
            quantity=7,
        )

    builtin = run(MomentumStrategy(lookback=20))
    code = (
        "import numpy as np\n"
        "def generate_signal(context):\n"
        "    lookback = context.params['lookback']\n"
        "    closes = context.history('close', lookback)\n"
        "    if len(closes) < lookback:\n"
        "        return 'HOLD'\n"
        "    average = float(np.mean(closes))\n"
        "    if context.bar.close > average:\n"
        "        return 'BUY'\n"
        "    if context.bar.close < average:\n"
        "        return 'SELL'\n"
        "    return 'HOLD'\n"
    )
    with SandboxStrategy(code, params={"lookback": 20}, backend="process") as strategy:
        custom = run(strategy)

    assert len(builtin.trades) >= 10
    assert [(str(t["timestamp"]), t["side"], t["quantity"], t["price"]) for t in builtin.trades] == [
        (str(t["timestamp"]), t["side"], t["quantity"], t["price"]) for t in custom.trades
    ]
    assert custom.final_capital == builtin.final_capital
    assert [p["portfolio_value"] for p in custom.equity_curve] == [
        p["portfolio_value"] for p in builtin.equity_curve
    ]


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_strategy_may_size_its_own_position(backend):
    code = (
        "def generate_signal(context):\n"
        "    if context.bar.index == 2:\n"
        "        return ('BUY', 4)\n"
        "    if context.bar.index == 4:\n"
        "        return 'EXIT'\n"
        "    return 'HOLD'\n"
    )
    result, _strategy = run_code(code, backend=backend, n=6)
    assert [(t["side"], t["quantity"]) for t in result.trades] == [("BUY", 4), ("SELL", 4)]


@needs_docker
def test_the_docker_sandbox_reports_itself_and_has_no_network():
    """Only on a machine with Docker running: the container is the boundary."""
    code = wrap("pass")
    _result, strategy = run_code(code, backend="docker", n=2)
    assert strategy.info.backend == "docker"
    assert strategy.info.image
    body = GADGET + """
mods = sysmod.modules
try:
    s = mods["builtins"].__import__("socket").socket()
    s.connect(("1.1.1.1", 80))
    context.log("network=OK")
except Exception as exc:
    context.log("network=BLOCKED:" + type(exc).__name__)
"""
    assert "network=BLOCKED" in probe(body, "docker")
