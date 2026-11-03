"""Turn intraday bars (any bar size <= 60 min, labelled by bar START time in New York) into
per-day first-hour summaries, and look up "last price as of a timestamp" without peeking ahead.

Leakage rule enforced here: a bar may be used for the decision on day t only if it ENDS at or
before t 10:30 New York time.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import config

OPEN_MIN = 9 * 60 + 30
DECISION_MIN = config.DECISION_HOUR * 60 + config.DECISION_MINUTE
CLOSE_MIN = 16 * 60


def _prep(bars: pd.DataFrame, interval: int) -> pd.DataFrame:
    b = bars.dropna(subset=["close"]).copy()
    idx = pd.DatetimeIndex(b.index)
    if idx.tz is None:
        idx = idx.tz_localize(config.TZ)
    else:
        idx = idx.tz_convert(config.TZ)
    b.index = idx
    b["date"] = idx.tz_localize(None).normalize()
    b["start_min"] = idx.hour * 60 + idx.minute
    b["end_min"] = b["start_min"] + interval
    return b.sort_index()


def day_table(bars: pd.DataFrame | None, interval: int, min_coverage: float = 0.6) -> pd.DataFrame:
    """Per-date: fh_open/high/low/close/volume (09:30-10:30) and day_close (last regular bar)."""
    cols = ["fh_open", "fh_high", "fh_low", "fh_close", "fh_volume", "day_close", "n_session_bars"]
    if bars is None or len(bars) == 0:
        return pd.DataFrame(columns=cols)
    b = _prep(bars, interval)
    fh = b[(b["start_min"] >= OPEN_MIN) & (b["end_min"] <= DECISION_MIN)]
    expected = max(1, (DECISION_MIN - OPEN_MIN) // interval)
    g = fh.groupby("date")
    t = pd.DataFrame({
        "fh_open": g["open"].first(), "fh_high": g["high"].max(), "fh_low": g["low"].min(),
        "fh_close": g["close"].last(), "fh_volume": g["volume"].sum(), "n_fh": g["close"].size(),
        "first_start": g["start_min"].min(),
    })
    t = t[(t["n_fh"] >= np.ceil(min_coverage * expected)) & (t["first_start"] <= OPEN_MIN + max(interval, 5))]
    sess = b[(b["start_min"] >= OPEN_MIN) & (b["start_min"] < CLOSE_MIN)]
    gs = sess.groupby("date")
    t["day_close"] = gs["close"].last()
    t["n_session_bars"] = gs["close"].size()
    t["last_end"] = gs["end_min"].max()
    # a day counts as complete only if bars run to the close (13:00 on half days)
    t.loc[t["last_end"] < 13 * 60, "day_close"] = np.nan
    return t[cols]


def combine_day_tables(tables: list[pd.DataFrame], sources: list[str]) -> pd.DataFrame:
    """Merge per-source day tables; earlier entries win. Keeps a `source` column."""
    out = None
    for t, src in zip(tables, sources):
        if t is None or t.empty:
            continue
        t = t.assign(source=src)
        out = t if out is None else pd.concat([out, t[~t.index.isin(out.index)]])
    if out is None:
        return pd.DataFrame(columns=["fh_open", "fh_high", "fh_low", "fh_close", "fh_volume", "day_close",
                                     "n_session_bars", "source"])
    return out.sort_index()


def bar_end_series(bars: pd.DataFrame | None, interval: int) -> pd.Series:
    """close price indexed by bar END timestamp (NY, tz-aware), sorted."""
    if bars is None or len(bars) == 0:
        return pd.Series(dtype=float)
    b = bars.dropna(subset=["close"])
    idx = pd.DatetimeIndex(b.index)
    idx = idx.tz_localize(config.TZ) if idx.tz is None else idx.tz_convert(config.TZ)
    s = pd.Series(b["close"].to_numpy(), index=idx + pd.Timedelta(minutes=interval))
    return s[~s.index.duplicated(keep="first")].sort_index()


def asof(series: pd.Series, when: pd.DatetimeIndex, max_stale: pd.Timedelta) -> np.ndarray:
    """Last value with timestamp <= when, if no older than max_stale; NaN otherwise."""
    out = np.full(len(when), np.nan)
    if series is None or series.empty:
        return out
    ts = series.index.asi8
    w = pd.DatetimeIndex(when).tz_convert(config.TZ).asi8
    pos = np.searchsorted(ts, w, side="right") - 1
    ok = pos >= 0
    vals = series.to_numpy()
    out[ok] = vals[pos[ok]]
    stale = np.zeros(len(w), dtype=bool)
    stale[ok] = (w[ok] - ts[pos[ok]]) > max_stale.value
    out[stale] = np.nan
    return out


def at_time(dates: pd.DatetimeIndex, hour: int, minute: int) -> pd.DatetimeIndex:
    d = pd.DatetimeIndex(dates).normalize()
    return (d + pd.Timedelta(hours=hour, minutes=minute)).tz_localize(config.TZ)
