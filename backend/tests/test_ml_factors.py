import numpy as np
import pandas as pd
import pytest

from app.ml.factors import calculate_strategy_factors
from app.ml.scoring import STRATEGY_FACTORS, calculate_composite_score


@pytest.fixture
def market_data():
    index = pd.date_range("2025-01-01", periods=100, freq="D")
    t = np.arange(100, dtype=float)
    close = 100 * np.exp(
        np.cumsum(0.001 + 0.01 * np.sin(t / 4))
    )
    return pd.DataFrame({"close": close}, index=index)


@pytest.fixture
def pair_data(market_data):
    t = np.arange(len(market_data), dtype=float)
    return pd.DataFrame(
        {
            "instrument_a": market_data["close"].to_numpy(),
            "instrument_b": (
                market_data["close"].to_numpy()
                * (1 + 0.01 * np.sin(t / 5))
            ),
        },
        index=market_data.index,
    )


@pytest.mark.parametrize(
    "strategy",
    [
        "momentum",
        "mean_reversion",
        "tactical_asset_allocation",
        "volatility_arbitrage",
    ],
)
def test_single_asset_factors_match_scoring_contract(strategy, market_data):
    factors = calculate_strategy_factors(strategy, market_data)
    assert set(factors) == set(STRATEGY_FACTORS[strategy])
    assert all(np.isfinite(value) for value in factors.values())
    calculate_composite_score(strategy, factors)


def test_statistical_arbitrage_factors_match_scoring_contract(pair_data):
    factors = calculate_strategy_factors("statistical_arbitrage", pair_data)
    assert set(factors) == set(STRATEGY_FACTORS["statistical_arbitrage"])
    assert all(np.isfinite(value) for value in factors.values())
    calculate_composite_score("statistical_arbitrage", factors)


def test_factor_calculation_is_deterministic(market_data):
    first = calculate_strategy_factors("momentum", market_data)
    second = calculate_strategy_factors("momentum", market_data.copy())
    assert first == second


def test_as_of_excludes_future_observations(market_data):
    cutoff = market_data.index[79]
    original = calculate_strategy_factors(
        "momentum", market_data, as_of=cutoff
    )
    changed = market_data.copy()
    changed.loc[changed.index > cutoff, "close"] *= 1000
    after_future_change = calculate_strategy_factors(
        "momentum", changed, as_of=cutoff
    )
    assert original == after_future_change


def test_rejects_unknown_strategy(market_data):
    with pytest.raises(ValueError, match="Unknown strategy"):
        calculate_strategy_factors("unknown", market_data)


def test_rejects_missing_close_column(market_data):
    with pytest.raises(ValueError, match="Missing required"):
        calculate_strategy_factors("momentum", market_data[["close"]].rename(
            columns={"close": "price"}
        ))


def test_rejects_nonpositive_prices(market_data):
    invalid = market_data.copy()
    invalid.iloc[-1, 0] = 0
    with pytest.raises(ValueError, match="greater than zero"):
        calculate_strategy_factors("momentum", invalid)


def test_rejects_nonfinite_prices(market_data):
    invalid = market_data.copy()
    invalid.iloc[-1, 0] = np.inf
    with pytest.raises(ValueError, match="finite"):
        calculate_strategy_factors("momentum", invalid)


def test_rejects_insufficient_history(market_data):
    with pytest.raises(ValueError, match="Insufficient history"):
        calculate_strategy_factors("momentum", market_data.head(10))


def test_rejects_invalid_window_configuration(market_data):
    with pytest.raises(ValueError, match="volatility_short"):
        calculate_strategy_factors(
            "momentum",
            market_data,
            windows={"volatility_short": 20, "volatility_long": 10},
        )


def test_rejects_unknown_window_configuration(market_data):
    with pytest.raises(ValueError, match="Unknown factor windows"):
        calculate_strategy_factors(
            "momentum", market_data, windows={"future_window": 10}
        )


def test_statistical_arbitrage_rejects_missing_pair_column(pair_data):
    with pytest.raises(ValueError, match="Missing required"):
        calculate_strategy_factors(
            "statistical_arbitrage", pair_data[["instrument_a"]]
        )


def test_as_of_rejects_cutoff_before_available_data(market_data):
    with pytest.raises(ValueError, match="No market data"):
        calculate_strategy_factors(
            "momentum",
            market_data,
            as_of=pd.Timestamp("2020-01-01"),
        )

def test_custom_normalization_bounds_change_factor_value(market_data):
    default = calculate_strategy_factors("momentum", market_data)
    custom = calculate_strategy_factors(
        "momentum",
        market_data,
        normalization_bounds={"relative_momentum": (-0.5, 0.5)},
    )
    assert default["relative_momentum"] != custom["relative_momentum"]


@pytest.mark.parametrize(
    "bounds",
    [
        {"relative_momentum": (1.0, 1.0)},
        {"relative_momentum": (2.0, 1.0)},
        {"relative_momentum": (float("nan"), 1.0)},
        {"relative_momentum": (0.0,)},
        {"unknown_factor": (-1.0, 1.0)},
    ],
)
def test_rejects_invalid_custom_normalization_bounds(market_data, bounds):
    with pytest.raises(ValueError):
        calculate_strategy_factors(
            "momentum", market_data, normalization_bounds=bounds
        )
