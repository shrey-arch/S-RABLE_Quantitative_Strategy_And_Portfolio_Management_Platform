from __future__ import annotations

from dataclasses import dataclass
from inspect import signature
from numbers import Real
from typing import Any

from app.strategies.base import Strategy
from app.strategies.mean_reversion import MeanReversionStrategy
from app.strategies.momentum import MomentumStrategy
from app.strategies.statistical_arbitrage import StatisticalArbitrageStrategy
from app.strategies.tactical_asset_allocation import TacticalAssetAllocationStrategy
from app.strategies.volatility_arbitrage import VolatilityArbitrageStrategy


@dataclass(frozen=True)
class StrategyDefinition:
    strategy_key: str
    strategy_class: type[Strategy]
    default_parameters: dict[str, Any]
    parameter_schema: dict[str, dict[str, Any]]
    required_indicators: tuple[str, ...] = ()


def _definition(
    key: str,
    strategy_class: type[Strategy],
    required_indicators: tuple[str, ...] = ("close",),
) -> StrategyDefinition:
    parameters: dict[str, Any] = {}
    schema: dict[str, dict[str, Any]] = {}

    for name, parameter in signature(strategy_class.__init__).parameters.items():
        if name == "self" or parameter.kind in (
            parameter.VAR_POSITIONAL,
            parameter.VAR_KEYWORD,
        ):
            continue

        annotation = parameter.annotation
        expected_type = (
            annotation if annotation is not parameter.empty
            else type(parameter.default)
            if parameter.default is not parameter.empty
            else None
        )
        if parameter.default is parameter.empty:
            schema[name] = {
                "required": True,
                "type": getattr(expected_type, "__name__", None),
            }
        else:
            parameters[name] = parameter.default
            schema[name] = {
                "required": False,
                "default": parameter.default,
                "type": getattr(expected_type, "__name__", type(parameter.default).__name__),
            }

    return StrategyDefinition(
        strategy_key=key,
        strategy_class=strategy_class,
        default_parameters=parameters,
        parameter_schema=schema,
        required_indicators=required_indicators,
    )


class StrategyRegistry:
    _definitions: dict[str, StrategyDefinition] = {
        "momentum": _definition("momentum", MomentumStrategy),
        "mean_reversion": _definition("mean_reversion", MeanReversionStrategy),
        "volatility_arbitrage": _definition(
            "volatility_arbitrage", VolatilityArbitrageStrategy
        ),
        "statistical_arbitrage": _definition(
            "statistical_arbitrage",
            StatisticalArbitrageStrategy,
            required_indicators=("instrument_a", "instrument_b"),
        ),
        "tactical_asset_allocation": _definition(
            "tactical_asset_allocation",
            TacticalAssetAllocationStrategy,
            required_indicators=(),
        ),
    }

    # Compatibility alias for existing callers that inspect the old mapping.
    _strategies: dict[str, type[Strategy]] = {
        key: definition.strategy_class
        for key, definition in _definitions.items()
    }

    @classmethod
    def validate_registry(cls) -> None:
        keys = [definition.strategy_key for definition in cls._definitions.values()]
        if len(keys) != len(set(keys)):
            raise ValueError("Strategy registry contains duplicate strategy keys.")

        for key, definition in cls._definitions.items():
            if key != definition.strategy_key:
                raise ValueError(
                    f"Strategy registry key mismatch: {key!r}."
                )
            if not issubclass(definition.strategy_class, Strategy):
                raise TypeError(
                    f"Strategy {key!r} must inherit from Strategy."
                )

    @classmethod
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.validate_registry()

    @classmethod
    def definition(cls, name: str) -> StrategyDefinition:
        try:
            return cls._definitions[name]
        except KeyError:
            raise ValueError(f"Unknown strategy: {name}") from None

    @classmethod
    def get(cls, name: str, **kwargs: Any) -> Strategy:
        definition = cls.definition(name)
        allowed = definition.parameter_schema
        unknown = sorted(set(kwargs) - set(allowed))

        if unknown:
            raise ValueError(
                f"Unknown parameters for strategy {name!r}: "
                + ", ".join(unknown)
            )

        parameters = dict(definition.default_parameters)
        parameters.update(kwargs)

        for parameter_name, value in parameters.items():
            expected = allowed[parameter_name].get("type")
            if expected == "int" and (
                isinstance(value, bool) or not isinstance(value, int)
            ):
                raise ValueError(
                    f"Parameter {parameter_name!r} for strategy {name!r} "
                    "must be an integer."
                )
            if expected == "float" and (
                isinstance(value, bool) or not isinstance(value, Real)
            ):
                raise ValueError(
                    f"Parameter {parameter_name!r} for strategy {name!r} "
                    "must be numeric."
                )
            if expected == "str" and not isinstance(value, str):
                raise ValueError(
                    f"Parameter {parameter_name!r} for strategy {name!r} "
                    "must be a string."
                )

        # Constructors remain responsible for semantic/range validation.
        return definition.strategy_class(**parameters)

    @classmethod
    def effective_parameters(
        cls,
        name: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Return validated effective parameters, including strategy defaults."""
        # Reuse get() so unknown names, unknown parameters, and parameter
        # types follow the same validation rules as actual strategy creation.
        cls.get(name, **kwargs)
        definition = cls.definition(name)
        parameters = dict(definition.default_parameters)
        parameters.update(kwargs)
        return parameters

    @classmethod
    def available(cls) -> list[str]:
        return list(cls._definitions)


# Fail fast if the canonical registry is misconfigured.
StrategyRegistry.validate_registry()
