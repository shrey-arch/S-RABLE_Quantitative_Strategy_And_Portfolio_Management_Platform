"""The sandbox's resource limits (Feature 6), in one place so the API, the
engine, the child and the docs all state the same numbers."""

from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class SandboxLimits:
    # Per bar: generous for numpy/pandas on a few thousand bars, tight enough to
    # catch an accidental heavy loop. Wall-clock, enforced by the parent.
    call_ms: int = 750
    # The whole run: all bars together. Also the CPU-seconds cap in the child.
    run_seconds: int = 120
    memory_mb: int = 256
    recursion: int = 250
    logs_per_bar: int = 20
    logs_total: int = 500
    log_chars: int = 300
    docker_cpus: str = "1.0"

    @property
    def cpu_seconds(self) -> int:
        """The kernel's CPU-time backstop. It sits well above the whole-run
        wall-clock budget so the parent reports an honest "Timeout" first, and
        the kernel only steps in if the parent somehow cannot."""
        return self.run_seconds + 10

    def child_payload(self) -> dict:
        return {
            "cpu_seconds": self.cpu_seconds,
            "memory_mb": self.memory_mb,
            "recursion": self.recursion,
            "logs_per_bar": self.logs_per_bar,
            "logs_total": self.logs_total,
            "log_chars": self.log_chars,
        }

    def as_dict(self) -> dict:
        data = asdict(self)
        data["call_ms"] = self.call_ms
        return data

    def described(self) -> list[dict]:
        """For the editor's "limits" panel."""
        return [
            {"name": "Time per bar", "value": f"{self.call_ms} ms", "detail": "a bar that takes longer is a timeout"},
            {"name": "Time per run", "value": f"{self.run_seconds} s", "detail": "all bars together"},
            {"name": "Memory", "value": f"{self.memory_mb} MB"},
            {"name": "Recursion depth", "value": str(self.recursion), "detail": "nested calls"},
            {"name": "Log lines", "value": f"{self.logs_per_bar} per bar, {self.logs_total} per run"},
            {"name": "Imports", "value": "math, statistics, numpy, pandas"},
        ]


DEFAULT_LIMITS = SandboxLimits()
# The editor's "Test run": fewer bars, so a tighter whole-run budget is fine.
TEST_RUN_LIMITS = SandboxLimits(run_seconds=30)
