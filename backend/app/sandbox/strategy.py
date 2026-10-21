"""A custom Python strategy the backtest engine can run (Feature 6).

SandboxStrategy looks like any other Strategy to the engine: the engine calls
prepare(data) once, then generate_signal(context) per bar. Underneath, prepare
starts a sandbox child and sends the code, the whole price series and the
pre-computed indicators once; each generate_signal exchanges one JSON message
with the child and turns its reply into a StrategySignal. A refusal or a runtime
error is raised as StrategyCodeError with the structured detail.

The session owns the child process: use it as a context manager, or call close().
The engine does not close it, so callers (the job, the test-run endpoint) wrap
the run in `with SandboxStrategy(...) as strategy:`.
"""

from __future__ import annotations

import os
import time
from datetime import datetime

import pandas as pd

from app.sandbox import guard, indicators
from app.sandbox.limits import DEFAULT_LIMITS, SandboxLimits
from app.sandbox import runner as runner_module
from app.sandbox.runner import (
    SandboxInfo,
    StrategyCodeError,
    _Pipe,
    choose_backend,
)
from app.strategies.base import Strategy
from app.strategies.signal import SignalAction, StrategySignal

FIELDS = ("open", "high", "low", "close", "volume")
MAX_BARS = 500_000


def _seconds(value: float) -> str:
    """"1 second" / "30 seconds", so a message never reads "1 seconds"."""
    whole = int(value)
    if whole == value and whole == 1:
        return "1 second"
    text = str(whole) if whole == value else f"{value:g}"
    return f"{text} seconds"


def _iso(value) -> str:
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.isoformat()
    return str(value)


def _refused(problems) -> StrategyCodeError:
    first = problems[0]
    return StrategyCodeError({
        "code": "STRATEGY_CODE_ERROR",
        "phase": "check",
        "exception": "CodeRefused",
        "message": "; ".join(p.text() for p in problems),
        "line": first.line,
        "bar_date": None,
        "traceback": "\n".join(p.text() for p in problems),
    })


def _error(detail: dict) -> StrategyCodeError:
    detail = {"code": "STRATEGY_CODE_ERROR", **detail}
    return StrategyCodeError(detail)


class SandboxStrategy(Strategy):
    def __init__(
        self,
        code: str,
        *,
        params: dict | None = None,
        limits: SandboxLimits = DEFAULT_LIMITS,
        backend: str = "auto",
        collect_logs: bool = False,
    ):
        self.code = code
        self.params = params or {}
        self.limits = limits
        self._backend_choice = backend
        self.collect_logs = collect_logs
        self.logs: list[dict] = []
        self.info: SandboxInfo | None = None
        self._pipe: _Pipe | None = None
        self._index: dict[object, int] = {}
        self._run_deadline = 0.0
        self._started = False
        # Fail fast on obviously bad code, with the line, before starting a child.
        # The safety tests switch the static check off (both sides) to prove the
        # running sandbox stands on its own; it is never off in normal use.
        if os.environ.get("SRABLE_SANDBOX_TEST_UNGUARDED") == "1":
            self._indicator_uses = []
        else:
            try:
                self._indicator_uses = guard.check(code)
            except guard.CodeRefused as exc:
                raise _refused(exc.problems) from None

    # --- lifecycle --------------------------------------------------------------
    def prepare(self, data: pd.DataFrame) -> None:
        if self._started:
            return
        self._started = True
        if not isinstance(data, pd.DataFrame) or data.empty:
            raise _error({"phase": "load", "exception": "ValueError",
                          "message": "The strategy has no price data to run on.", "line": None,
                          "bar_date": None, "traceback": "No price data."})
        if len(data) > MAX_BARS:
            raise _error({"phase": "load", "exception": "ValueError",
                          "message": f"Too many bars ({len(data)}); at most {MAX_BARS}.", "line": None,
                          "bar_date": None, "traceback": "Too many bars."})
        for field in FIELDS:
            if field not in data.columns:
                raise _error({"phase": "load", "exception": "ValueError",
                              "message": f"The price data has no '{field}' column.", "line": None,
                              "bar_date": None, "traceback": f"Missing column {field}."})

        self._index = {ts: i for i, ts in enumerate(data.index)}
        try:
            series = indicators.precompute(self._indicator_uses, data)
        except indicators.IndicatorError as exc:
            line = int(str(exc).split(":", 1)[0].replace("Line", "").strip() or 0) or None
            raise _error({"phase": "check", "exception": "IndicatorError", "message": str(exc),
                          "line": line, "bar_date": None, "traceback": str(exc)}) from None

        bars = {field: [float(v) for v in data[field].to_numpy()] for field in FIELDS}
        bars["date"] = [_iso(ts) for ts in data.index]

        backend = choose_backend(self._backend_choice)
        self._pipe = _Pipe(backend, self.limits)
        ready = self._pipe.receive(time.monotonic() + 30)
        if ready.get("type") != "ready":
            self._fail_start(ready)
        self.info = SandboxInfo(
            backend=backend,
            python=ready.get("python", ""),
            numpy=ready.get("numpy", ""),
            pandas=ready.get("pandas", ""),
            image=runner_module.DOCKER_IMAGE if backend == "docker" else None,
            limits=self.limits.as_dict(),
        )
        self._pipe.send({
            "type": "init",
            "protocol": 1,
            "code": self.code,
            "params": self.params,
            "bars": bars,
            "indicators": series,
            "limits": self.limits.child_payload(),
        })
        try:
            loaded = self._pipe.receive(time.monotonic() + self.limits.call_ms / 1000 + 10)
        except MemoryError as exc:
            raise _error(self._memory_detail("load", None, exc)) from None
        if loaded.get("type") == "error":
            raise _error(loaded)
        if loaded.get("type") != "loaded":
            self._fail_start(loaded)
        self._run_deadline = time.monotonic() + self.limits.run_seconds

    def _fail_start(self, message: dict) -> None:
        raise _error({"phase": "load", "exception": "SandboxError",
                      "message": f"The sandbox did not start as expected: {str(message)[:200]}",
                      "line": None, "bar_date": None, "traceback": str(message)[:500]})

    # --- per bar ----------------------------------------------------------------
    def _memory_detail(self, phase: str, bar_date: str | None, exc: BaseException) -> dict:
        """The sandbox stopped the code for using too much memory. The watchdog
        passes the size it saw, so the message can name it."""
        used = 0
        try:
            used = int(str(exc) or 0)
        except ValueError:
            used = 0
        seen = f" It had reached about {used // (1024 * 1024)} MB." if used else ""
        return {"phase": phase, "exception": "MemoryLimit",
                "message": f"The strategy used more than the {self.limits.memory_mb} MB of memory "
                           f"it is allowed.{seen}",
                "line": None, "bar_date": bar_date,
                "traceback": "Memory limit reached."}

    def generate_signal(self, context) -> StrategySignal:
        if self._pipe is None:
            raise _error({"phase": "load", "exception": "SandboxError",
                          "message": "The sandbox was not started.", "line": None,
                          "bar_date": None, "traceback": "prepare() was not called."})
        market = context.market_data or {}
        i = market.get("bar_index")
        if i is None:
            i = self._index.get(context.timestamp)
        if i is None:
            data = market.get("data")
            i = (len(data) - 1) if isinstance(data, pd.DataFrame) else None
        if i is None:
            raise _error({"phase": "bar", "exception": "SandboxError",
                          "message": "Could not place the bar in the series.", "line": None,
                          "bar_date": _iso(context.timestamp), "traceback": ""})

        now = time.monotonic()
        if now > self._run_deadline:
            self._pipe.kill()
            raise _error({"phase": "bar", "exception": "Timeout",
                          "message": f"The strategy ran longer than "
                                     f"{_seconds(self.limits.run_seconds)} in total.",
                          "line": None, "bar_date": _iso(context.timestamp),
                          "traceback": "Whole-run time limit reached."})
        self._pipe.send({
            "type": "bar",
            "i": int(i),
            "position": int(market.get("position_quantity", 0)),
            "cash": float(market.get("cash", 0.0)),
        })
        # Two deadlines, whichever comes first: this bar's, and what is left of the
        # whole run. Which one it was decides what the user is told, so a slow bar
        # on a slow machine is never reported as the per-bar limit when the run
        # budget is what actually ran out.
        per_bar = now + self.limits.call_ms / 1000
        whole_run = self._run_deadline + 1
        deadline = min(per_bar, whole_run)
        try:
            reply = self._pipe.receive(deadline)
        except TimeoutError:
            if whole_run <= per_bar:
                raise _error({"phase": "bar", "exception": "Timeout",
                              "message": f"The strategy ran longer than "
                                         f"{_seconds(self.limits.run_seconds)} in total.",
                              "line": None, "bar_date": _iso(context.timestamp),
                              "traceback": "Whole-run time limit reached."}) from None
            raise _error({"phase": "bar", "exception": "Timeout",
                          "message": f"The strategy took longer than {self.limits.call_ms} ms on the "
                                     f"bar of {_iso(context.timestamp)}.",
                          "line": None, "bar_date": _iso(context.timestamp),
                          "traceback": "Per-bar time limit reached."}) from None
        except MemoryError as exc:
            raise _error(self._memory_detail("bar", _iso(context.timestamp), exc)) from None
        except (RuntimeError, ValueError) as exc:
            raise _error({"phase": "bar", "exception": "SandboxError", "message": str(exc),
                          "line": None, "bar_date": _iso(context.timestamp),
                          "traceback": str(exc)}) from None

        if self.collect_logs:
            self.logs.extend(reply.get("logs", []))
        if reply.get("type") == "error":
            if self.collect_logs:
                self.logs.extend(reply.get("logs", []))
            raise _error(reply)
        if reply.get("type") != "signal":
            raise _error({"phase": "bar", "exception": "SandboxError",
                          "message": "The sandbox sent an unexpected reply.", "line": None,
                          "bar_date": _iso(context.timestamp), "traceback": str(reply)[:300]})

        action = SignalAction(reply["action"])
        return StrategySignal(action=action, timestamp=context.timestamp, quantity=reply.get("quantity"))

    # --- cleanup ----------------------------------------------------------------
    def close(self) -> None:
        if self._pipe is not None:
            self._pipe.close()
            self._pipe = None

    def __enter__(self) -> "SandboxStrategy":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def __del__(self):
        try:
            self.close()
        except Exception:  # noqa: BLE001
            pass
