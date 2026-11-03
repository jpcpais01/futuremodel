"""Strategy statistics, with uncertainty: one decision per day means small samples, so every Sharpe
ratio comes with a block-bootstrap confidence interval and a t-statistic."""
from __future__ import annotations

import numpy as np
import pandas as pd


def pnl(position: pd.Series, simple_ret: pd.Series, cost_bps: float) -> pd.Series:
    """Daily net return: enter at 10:30, exit at the close, pay round-trip cost on |position|."""
    p = position.fillna(0)
    return p * simple_ret - p.abs() * cost_bps / 1e4


def _sharpe(x: np.ndarray) -> float:
    s = x.std(ddof=1)
    return float(np.sqrt(252) * x.mean() / s) if s > 0 else 0.0


def block_bootstrap_sharpe(x: np.ndarray, n: int = 2000, block: int = 10, seed: int = 0) -> tuple[float, float]:
    x = np.asarray(x, float)
    if len(x) < 30 or n <= 0:
        return (np.nan, np.nan)
    rng = np.random.default_rng(seed)
    T = len(x)
    nb = int(np.ceil(T / block))
    out = np.empty(n)
    for i in range(n):
        starts = rng.integers(0, T - block + 1, nb)
        idx = (starts[:, None] + np.arange(block)[None, :]).ravel()[:T]
        out[i] = _sharpe(x[idx])
    return float(np.percentile(out, 5)), float(np.percentile(out, 95))


def summarize(net: pd.Series, position: pd.Series | None = None, gross: pd.Series | None = None,
              n_boot: int = 2000) -> dict:
    x = net.dropna().to_numpy()
    if len(x) == 0:
        return {}
    eq = np.cumsum(x)
    dd = eq - np.maximum.accumulate(eq)
    traded = (position.abs() > 0) if position is not None else pd.Series(x != 0, index=net.dropna().index)
    tr = net[traded.reindex(net.index).fillna(False)]
    lo, hi = block_bootstrap_sharpe(x, n_boot)
    down = x[x < 0]
    out = {
        "days": int(len(x)),
        "trades": int(traded.sum()),
        "exposure": float(traded.mean()),
        "avg_abs_size": float(position.abs().mean()) if position is not None else np.nan,
        "hit_rate": float((tr > 0).mean()) if len(tr) else np.nan,
        "avg_bps_per_day": float(1e4 * x.mean()),
        "avg_bps_per_trade": float(1e4 * tr.mean()) if len(tr) else np.nan,
        "ann_return": float(252 * x.mean()),
        "ann_vol": float(np.sqrt(252) * x.std(ddof=1)),
        "sharpe": _sharpe(x),
        "sharpe_ci90": (lo, hi),
        "sortino": float(np.sqrt(252) * x.mean() / down.std(ddof=1)) if len(down) > 2 else np.nan,
        "t_stat": float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if x.std() > 0 else 0.0,
        "max_drawdown": float(dd.min()),
        "total_return": float(eq[-1]),
    }
    if gross is not None:
        out["gross_bps_per_day"] = float(1e4 * gross.reindex(net.dropna().index).mean())
    return out


def information_coefficient(forecast: pd.Series, y: pd.Series) -> float:
    ok = forecast.notna() & y.notna()
    if ok.sum() < 20:
        return np.nan
    return float(pd.Series(forecast[ok]).rank().corr(pd.Series(y[ok]).rank()))
