"""Builds the strategy a backtest runs: a core template from the registry, or a
no-code strategy's saved rules (RuleStrategy)."""

from __future__ import annotations

from typing import Any

from app.strategies.base import Strategy
from app.strategies.registry import StrategyRegistry
from app.strategies.rule_strategy import RULES_KEY, RuleStrategy

# Feature 6: a custom Python strategy. Its config is {"code": <source>, "params": {...}}.
PYTHON_KEY = "python"


def is_python_key(strategy_key: str | None) -> bool:
    return strategy_key == PYTHON_KEY


def build_strategy(strategy_key: str, config: dict[str, Any] | None = None) -> Strategy:
    if strategy_key == PYTHON_KEY:
        from app.sandbox.strategy import SandboxStrategy

        from app.config import settings

        config = config or {}
        return SandboxStrategy(
            config["code"],
            params=config.get("params") or {},
            backend=config.get("backend") or getattr(settings, "sandbox_backend", "auto"),
            collect_logs=bool(config.get("collect_logs")),
        )
    if strategy_key == RULES_KEY:
        return RuleStrategy(config or {})
    return StrategyRegistry.get(strategy_key, **(config or {}))


def effective_parameters(strategy_key: str, config: dict[str, Any] | None = None) -> dict:
    """The template's parameters with defaults filled in; for rules, the rules as
    saved; for Python, the user's parameters (there are no template defaults)."""
    if strategy_key == PYTHON_KEY:
        return dict((config or {}).get("params") or {})
    if strategy_key == RULES_KEY:
        return dict(config or {})
    return StrategyRegistry.effective_parameters(strategy_key, **(config or {}))


def instrument_layout(strategy_key: str) -> str:
    if strategy_key in (RULES_KEY, PYTHON_KEY):
        return "single"
    return StrategyRegistry.definition(strategy_key).instruments
