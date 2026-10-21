"""Synthetic regime-switching index and India VIX for the supervised regime tests (Feature 2)."""
import numpy as np, pandas as pd
def synthetic_market(days=1500, seed=7, start="2019-01-01"):
    """Regime-switching index with VIX following volatility (for tests only)."""
    rng = np.random.default_rng(seed)
    index = pd.bdate_range(start, periods=days, tz="Asia/Kolkata")
    vol = np.empty(days); drift = np.empty(days)
    state_v, state_t = 0, 1
    for i in range(days):
        if rng.random() < 1/60: state_v = 1 - state_v
        if rng.random() < 1/40: state_t = rng.integers(0, 3)
        vol[i] = (0.008, 0.02)[state_v]; drift[i] = (-0.0015, 0.0, 0.0015)[state_t]
    r = drift + vol * rng.standard_normal(days)
    close = 10000 * np.exp(np.cumsum(r))
    volume = rng.integers(200_000, 400_000, days) * (1 + 0.5 * (vol > 0.01))
    data = pd.DataFrame({"open": close, "high": close*1.005, "low": close*0.995, "close": close, "volume": volume}, index=index)
    vix = pd.Series(12 + 900 * pd.Series(vol, index=index).rolling(5, min_periods=1).mean() + rng.normal(0, 0.5, days), index=index)
    return data, vix
