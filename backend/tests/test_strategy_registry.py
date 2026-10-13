import pytest

from app.strategies.mean_reversion import MeanReversionStrategy
from app.strategies.momentum import MomentumStrategy
from app.strategies.registry import StrategyRegistry
from app.strategies.statistical_arbitrage import StatisticalArbitrageStrategy
from app.strategies.tactical_asset_allocation import TacticalAssetAllocationStrategy
from app.strategies.volatility_arbitrage import VolatilityArbitrageStrategy


def test_registry_contains_all_strategies():
    assert StrategyRegistry.available() == [
        "momentum",
        "mean_reversion",
        "volatility_arbitrage",
        "statistical_arbitrage",
        "tactical_asset_allocation",
    ]


@pytest.mark.parametrize(
    "name, expected_class",
    [
        ("momentum", MomentumStrategy),
        ("mean_reversion", MeanReversionStrategy),
        ("volatility_arbitrage", VolatilityArbitrageStrategy),
        ("statistical_arbitrage", StatisticalArbitrageStrategy),
        ("tactical_asset_allocation", TacticalAssetAllocationStrategy),
    ],
)
def test_registry_resolves_strategy(name, expected_class):
    strategy = StrategyRegistry.get(name)

    assert isinstance(strategy, expected_class)


def test_registry_passes_constructor_parameters():
    strategy = StrategyRegistry.get(
        "tactical_asset_allocation",
        lookback=10,
        top_k=3,
    )

    assert isinstance(strategy, TacticalAssetAllocationStrategy)
    assert strategy.lookback == 10
    assert strategy.top_k == 3


def test_registry_rejects_unknown_strategy():
    with pytest.raises(ValueError, match="Unknown strategy"):
        StrategyRegistry.get("does_not_exist")

def test_registry_strategy_instances_are_configuration_isolated():
    first = StrategyRegistry.get(
        "tactical_asset_allocation",
        lookback=10,
        top_k=2,
    )

    second = StrategyRegistry.get(
        "tactical_asset_allocation",
        lookback=50,
        top_k=5,
    )

    assert first is not second

    assert first.lookback == 10
    assert first.top_k == 2

    assert second.lookback == 50
    assert second.top_k == 5

    assert first.lookback != second.lookback
    assert first.top_k != second.top_k



def test_registry_validates_parameter_types():
    with pytest.raises(ValueError, match="must be an integer"):
        StrategyRegistry.get("momentum", lookback=2.5)


def test_registry_reports_strategy_specific_indicators():
    assert StrategyRegistry.definition(
        "statistical_arbitrage"
    ).required_indicators == ("instrument_a", "instrument_b")

    assert StrategyRegistry.definition(
        "tactical_asset_allocation"
    ).required_indicators == ()


def test_registry_validation_accepts_current_registry():
    StrategyRegistry.validate_registry()
