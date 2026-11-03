"""Synthetic market generator used ONLY to test the code paths (no performance claims).

It writes Yahoo-shaped daily + 60-minute files into a temporary store. A tunable "planted" signal
lets tests check two things: the pipeline finds a real effect when one exists, and finds nothing
(no leakage) when the 10:30 -> close move is pure noise.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from futuremodel import calendar as cal
from futuremodel import config
from futuremodel.data.store import Store


def make_store(root, n_days: int = 520, daily_years: int = 4, signal: float = 0.0, seed: int = 0,
               tickers: list[str] | None = None, end: str = "2026-10-30") -> Store:
    rng = np.random.default_rng(seed)
    store = Store(root)
    td = cal.trading_days()
    td = td[td <= pd.Timestamp(end)]
    days = td[-(daily_years * 252):]
    intraday_days = days[-n_days:]
    tickers = tickers or sorted(set(config.DAILY_TICKERS) | set(config.INTRADAY_TICKERS))
    n = len(days)

    mkt = rng.standard_normal(n)                     # market factor, overnight + intraday
    mkt_fh = rng.standard_normal(n)
    base_vol = 0.012 * np.exp(0.3 * np.cumsum(rng.standard_normal(n)) / np.sqrt(np.arange(1, n + 1)))
    for t in tickers:
        is_vol = t.startswith("^V") or t == "^SKEW"
        level0 = {"^VIX": 16, "^VIX9D": 15, "^VIX3M": 18, "^VVIX": 90, "^SKEW": 135, "^TNX": 4.2}.get(t, 100.0)
        vol = base_vol * (1.0 + 0.6 * rng.random())
        beta = 0.5 + rng.random()
        gap = (0.4 * beta * mkt + 0.3 * rng.standard_normal(n)) * vol * 0.6
        fh = (0.5 * beta * mkt_fh + 0.6 * rng.standard_normal(n)) * vol * 0.6
        fh_z = np.clip(fh / (vol * 0.6), -3, 3)
        rest = (signal * fh_z + rng.standard_normal(n)) * vol * 0.75
        if is_vol or t == "^TNX":
            # mean-reverting levels
            lvl = np.empty(n)
            lvl[0] = level0
            for i in range(1, n):
                lvl[i] = lvl[i - 1] + 0.05 * (level0 - lvl[i - 1]) + 0.04 * lvl[i - 1] * rng.standard_normal()
            close = np.abs(lvl)
            prev = np.r_[close[0], close[:-1]]
            open_ = prev * np.exp(gap * 0.5)
            p1030 = open_ * np.exp(fh * 0.5)
        else:
            logc = np.log(level0) + np.cumsum(gap + fh + rest)
            close = np.exp(logc)
            prev = np.r_[close[0] / np.exp(gap[0] + fh[0] + rest[0]), close[:-1]]
            open_ = prev * np.exp(gap)
            p1030 = open_ * np.exp(fh)
        hi = np.maximum.reduce([open_, close, p1030]) * (1 + 0.002 * rng.random(n))
        lo = np.minimum.reduce([open_, close, p1030]) * (1 - 0.002 * rng.random(n))
        volu = rng.integers(1_000_000, 5_000_000, n).astype(float)
        daily = pd.DataFrame({"open": open_, "high": hi, "low": lo, "close": close, "adj_close": close,
                              "volume": volu}, index=days)
        store.write("daily", t, daily)
        if t not in config.INTRADAY_TICKERS:
            continue
        sel = np.isin(days, intraday_days)
        rows = []
        for i in np.where(sel)[0]:
            d = days[i]
            path_rest = np.linspace(p1030[i], close[i], 7)[1:] * (1 + 0.0005 * rng.standard_normal(6))
            path_rest[-1] = close[i]
            if t == "BTC-USD":
                starts = [d + pd.Timedelta(hours=h) for h in range(0, 24)]
                lvls = np.interp(np.arange(24), [0, 9, 10, 16, 23], [prev[i], open_[i], p1030[i], close[i], close[i]])
                for s, c in zip(starts, lvls):
                    rows.append((s, c, c * 1.001, c * 0.999, c, 1000.0))
                continue
            starts = [d + pd.Timedelta(hours=9, minutes=30) + pd.Timedelta(hours=k) for k in range(7)]
            o_ = [open_[i], p1030[i]] + list(path_rest[:-1])
            c_ = [p1030[i]] + list(path_rest)
            for k, s in enumerate(starts):
                h = max(o_[k], c_[k]) * 1.0008
                l = min(o_[k], c_[k]) * 0.9992
                rows.append((s, o_[k], h, l, c_[k], volu[i] / 7 * (2.5 if k == 0 else 0.75)))
        bars = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"]).set_index("ts")
        bars.index = pd.DatetimeIndex(bars.index).tz_localize(config.TZ)
        store.write("intraday_60m", t, bars)

    for sid in config.FRED_SERIES:
        idx = pd.bdate_range(days[0], days[-1])
        store.write("fred", sid, pd.DataFrame({"value": 3 + np.cumsum(0.01 * rng.standard_normal(len(idx)))}, index=idx))
    idx = pd.bdate_range(days[-300], days[-1])
    store.write("sentiment", "cnn_fg", pd.DataFrame({"fg": np.clip(50 + np.cumsum(rng.standard_normal(len(idx))), 0, 100)}, index=idx))
    return store
