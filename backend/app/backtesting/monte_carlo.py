from __future__ import annotations

import math
from numbers import Integral, Real

import numpy as np

from app.backtesting.analytics import calculate_periodic_returns


class MonteCarloSimulator:
    """Bootstrap daily portfolio returns with replacement.

    Assumptions:
    - Input equity observations represent consecutive daily portfolio values.
    - Daily returns are resampled independently with replacement.
    - Each simulated path starts at the supplied initial capital.
    - The bootstrap does not model serial dependence or changing market regimes.
    """

    def run(
        self,
        *,
        equity_curve: list[dict],
        initial_capital: float,
        simulations: int = 1000,
        seed: int = 42,
        periods: int | None = None,
    ) -> dict:
        if (
            isinstance(initial_capital, bool)
            or not isinstance(initial_capital, Real)
            or not math.isfinite(initial_capital)
            or initial_capital <= 0
        ):
            raise ValueError("initial_capital must be finite and greater than 0.")

        if isinstance(simulations, bool) or not isinstance(simulations, Integral) or simulations <= 0:
            raise ValueError("simulations must be a positive integer.")

        if isinstance(seed, bool) or not isinstance(seed, Integral):
            raise ValueError("seed must be an integer.")

        returns = calculate_periodic_returns(equity_curve)
        if not returns:
            raise ValueError("equity_curve must contain at least two observations.")

        if periods is None:
            periods = len(returns)
        if isinstance(periods, bool) or not isinstance(periods, Integral) or periods <= 0:
            raise ValueError("periods must be a positive integer.")

        daily_returns = np.asarray(returns, dtype=float)
        if not np.isfinite(daily_returns).all() or np.any(daily_returns <= -1):
            raise ValueError("daily returns must be finite and greater than -1.")

        rng = np.random.default_rng(int(seed))
        sampled_indices = rng.integers(
            0,
            len(daily_returns),
            size=(int(simulations), int(periods)),
        )
        sampled_returns = daily_returns[sampled_indices]
        growth_factors = 1.0 + sampled_returns
        paths = float(initial_capital) * np.cumprod(growth_factors, axis=1)

        final_values = paths[:, -1]
        cumulative_returns = final_values / float(initial_capital) - 1.0

        path_peaks = np.maximum.accumulate(
            np.concatenate(
                [
                    np.full((int(simulations), 1), float(initial_capital)),
                    paths,
                ],
                axis=1,
            ),
            axis=1,
        )
        path_values = np.concatenate(
            [
                np.full((int(simulations), 1), float(initial_capital)),
                paths,
            ],
            axis=1,
        )
        drawdowns = 1.0 - path_values / path_peaks
        max_drawdowns = np.max(drawdowns, axis=1)

        percentiles = np.percentile(
            cumulative_returns,
            [5, 25, 50, 75, 95],
        )
        final_value_percentiles = np.percentile(
            final_values,
            [5, 25, 50, 75, 95],
        )
        drawdown_percentiles = np.percentile(
            max_drawdowns,
            [5, 25, 50, 75, 95],
        )

        return {
            "method": "daily_return_bootstrap_with_replacement",
            "input_series": "simple returns between consecutive equity observations",
            "assumptions": [
                "Returns are resampled independently with replacement.",
                "Serial dependence and regime clustering are not modeled.",
                "Each simulated path starts at initial_capital.",
            ],
            "seed": int(seed),
            "simulations": int(simulations),
            "periods": int(periods),
            "initial_capital": float(initial_capital),
            "cumulative_return": {
                "mean": float(np.mean(cumulative_returns)),
                "median": float(np.median(cumulative_returns)),
                "percentiles": {
                    "p05": float(percentiles[0]),
                    "p25": float(percentiles[1]),
                    "p50": float(percentiles[2]),
                    "p75": float(percentiles[3]),
                    "p95": float(percentiles[4]),
                },
                "simulated_outcome_interval_90": [
                    float(percentiles[0]),
                    float(percentiles[4]),
                ],
                "probability_of_loss": float(np.mean(cumulative_returns < 0)),
            },
            "final_value": {
                "mean": float(np.mean(final_values)),
                "median": float(np.median(final_values)),
                "percentiles": {
                    "p05": float(final_value_percentiles[0]),
                    "p25": float(final_value_percentiles[1]),
                    "p50": float(final_value_percentiles[2]),
                    "p75": float(final_value_percentiles[3]),
                    "p95": float(final_value_percentiles[4]),
                },
            },
            "maximum_drawdown": {
                "mean": float(np.mean(max_drawdowns)),
                "median": float(np.median(max_drawdowns)),
                "percentiles": {
                    "p05": float(drawdown_percentiles[0]),
                    "p25": float(drawdown_percentiles[1]),
                    "p50": float(drawdown_percentiles[2]),
                    "p75": float(drawdown_percentiles[3]),
                    "p95": float(drawdown_percentiles[4]),
                },
            },
        }

    def test_mean_return_significance(
        self,
        *,
        daily_returns: list[float],
        permutations: int = 10000,
        seed: int = 42,
    ) -> dict:
        """One-sided sign-flip test of positive mean return.

        H0: returns have zero mean and are symmetric about zero.
        H1: mean return is positive.

        This test assumes independent observations and a symmetric null
        distribution. It does not establish out-of-sample profitability.
        """
        if not isinstance(daily_returns, (list, tuple)) or not daily_returns:
            raise ValueError("daily_returns must be a non-empty list or tuple.")

        if (
            isinstance(permutations, bool)
            or not isinstance(permutations, Integral)
            or permutations <= 0
        ):
            raise ValueError("permutations must be a positive integer.")

        if isinstance(seed, bool) or not isinstance(seed, Integral):
            raise ValueError("seed must be an integer.")

        values = []
        for index, value in enumerate(daily_returns):
            if (
                isinstance(value, bool)
                or not isinstance(value, Real)
                or not math.isfinite(value)
            ):
                raise ValueError(f"daily_returns[{index}] must be finite and numeric.")
            values.append(float(value))

        observed_mean = float(np.mean(values))
        rng = np.random.default_rng(int(seed))
        signs = rng.choice(
            np.array([-1.0, 1.0]),
            size=(int(permutations), len(values)),
        )
        null_means = np.mean(signs * np.asarray(values), axis=1)
        exceedances = int(np.count_nonzero(null_means >= observed_mean))
        p_value = (exceedances + 1) / (int(permutations) + 1)

        return {
            "test": "one_sided_sign_flip_permutation_test",
            "null_hypothesis": "mean daily return is zero under a symmetric null",
            "alternative_hypothesis": "mean daily return is positive",
            "assumptions": [
                "Daily returns are independent observations.",
                "The null distribution is symmetric around zero.",
            ],
            "observed_mean_return": observed_mean,
            "permutations": int(permutations),
            "seed": int(seed),
            "p_value": float(p_value),
            "significant_at_0_05": bool(p_value < 0.05),
        }
