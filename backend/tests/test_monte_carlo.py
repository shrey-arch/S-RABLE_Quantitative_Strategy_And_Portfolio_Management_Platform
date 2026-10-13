import pytest

from app.backtesting.monte_carlo import MonteCarloSimulator


def make_equity_curve(values):
    return [
        {
            "timestamp": f"2026-01-{index + 1:02d}T00:00:00",
            "portfolio_value": value,
        }
        for index, value in enumerate(values)
    ]


def test_known_returns_have_expected_single_period_outcomes():
    result = MonteCarloSimulator().run(
        equity_curve=make_equity_curve([100.0, 110.0]),
        initial_capital=100.0,
        simulations=20,
        seed=7,
    )

    assert result["method"] == "daily_return_bootstrap_with_replacement"
    assert result["periods"] == 1
    assert result["cumulative_return"]["mean"] == pytest.approx(0.10)
    assert result["cumulative_return"]["median"] == pytest.approx(0.10)
    assert result["cumulative_return"]["probability_of_loss"] == 0.0
    assert result["maximum_drawdown"]["mean"] == 0.0


def test_fixed_seed_produces_reproducible_results():
    kwargs = {
        "equity_curve": make_equity_curve([100.0, 110.0, 99.0, 108.9]),
        "initial_capital": 100.0,
        "simulations": 250,
        "seed": 123,
        "periods": 5,
    }

    first = MonteCarloSimulator().run(**kwargs)
    second = MonteCarloSimulator().run(**kwargs)

    assert first == second


def test_reports_requested_simulation_count_and_distributions():
    result = MonteCarloSimulator().run(
        equity_curve=make_equity_curve([100.0, 105.0, 102.0, 108.0]),
        initial_capital=100.0,
        simulations=75,
        seed=42,
        periods=4,
    )

    assert result["simulations"] == 75
    assert result["periods"] == 4
    assert set(result["cumulative_return"]["percentiles"]) == {
        "p05", "p25", "p50", "p75", "p95"
    }
    assert set(result["maximum_drawdown"]["percentiles"]) == {
        "p05", "p25", "p50", "p75", "p95"
    }
    assert 0.0 <= result["cumulative_return"]["probability_of_loss"] <= 1.0


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"initial_capital": 0}, "initial_capital"),
        ({"simulations": 0}, "simulations"),
        ({"simulations": 2.5}, "simulations"),
        ({"seed": 1.5}, "seed"),
        ({"periods": 0}, "periods"),
    ],
)
def test_rejects_invalid_configuration(overrides, message):
    kwargs = {
        "equity_curve": make_equity_curve([100.0, 101.0]),
        "initial_capital": 100.0,
        "simulations": 10,
        "seed": 1,
    }
    kwargs.update(overrides)

    with pytest.raises(ValueError, match=message):
        MonteCarloSimulator().run(**kwargs)


def test_requires_at_least_two_equity_observations():
    with pytest.raises(ValueError, match="at least two"):
        MonteCarloSimulator().run(
            equity_curve=make_equity_curve([100.0]),
            initial_capital=100.0,
        )


def test_rejects_non_positive_equity_values():
    with pytest.raises(ValueError, match="finite and positive"):
        MonteCarloSimulator().run(
            equity_curve=make_equity_curve([100.0, 0.0]),
            initial_capital=100.0,
        )


def test_significance_test_is_reproducible_and_reports_assumptions():
    simulator = MonteCarloSimulator()
    kwargs = {
        "daily_returns": [0.02, 0.01, -0.005, 0.03, 0.015],
        "permutations": 2000,
        "seed": 17,
    }

    first = simulator.test_mean_return_significance(**kwargs)
    second = simulator.test_mean_return_significance(**kwargs)

    assert first == second
    assert first["test"] == "one_sided_sign_flip_permutation_test"
    assert 0.0 < first["p_value"] <= 1.0
    assert len(first["assumptions"]) == 2


def test_significance_test_rejects_invalid_returns():
    simulator = MonteCarloSimulator()

    with pytest.raises(ValueError, match="finite and numeric"):
        simulator.test_mean_return_significance(
            daily_returns=[0.01, float("nan")]
        )

    with pytest.raises(ValueError, match="permutations"):
        simulator.test_mean_return_significance(
            daily_returns=[0.01, 0.02],
            permutations=0,
        )


def test_significance_test_detects_strong_positive_signal():
    result = MonteCarloSimulator().test_mean_return_significance(
        daily_returns=[0.01, 0.02, 0.03, 0.04, 0.05],
        permutations=5000,
        seed=11,
    )

    assert result["observed_mean_return"] == pytest.approx(0.03)
    assert result["p_value"] < 0.05
    assert result["significant_at_0_05"] is True


def test_significance_test_zero_returns_is_not_significant():
    result = MonteCarloSimulator().test_mean_return_significance(
        daily_returns=[0.0, 0.0, 0.0, 0.0],
        permutations=2000,
        seed=5,
    )

    assert result["observed_mean_return"] == 0.0
    assert result["p_value"] == 1.0
    assert result["significant_at_0_05"] is False
