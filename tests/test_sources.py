"""Offline checks of the parsing code for free sources (network is never touched)."""
import numpy as np
import pandas as pd

from futuremodel.data import yahoo
from futuremodel.data.options import gex_summary
from futuremodel.features.intraday import asof, bar_end_series, day_table
from futuremodel.sentiment.llm import aggregate, score_headlines


def _raw(tickers, fields=("Open", "High", "Low", "Close", "Adj Close", "Volume"), ticker_first=True):
    idx = pd.date_range("2026-01-02", periods=3, freq="B")
    cols = pd.MultiIndex.from_product([tickers, fields] if ticker_first else [fields, tickers])
    return pd.DataFrame(np.arange(len(idx) * len(cols), dtype=float).reshape(len(idx), -1) + 1, index=idx, columns=cols)


def test_split_frame_both_layouts():
    for tf in (True, False):
        out = yahoo._split_frame(_raw(["QQQ", "SPY"], ticker_first=tf), ["QQQ", "SPY"])
        assert set(out) == {"QQQ", "SPY"}
        assert list(out["QQQ"].columns) == ["open", "high", "low", "close", "adj_close", "volume"]


def test_day_table_and_asof():
    t = pd.date_range("2026-01-05 09:30", periods=7, freq="60min", tz="America/New_York")
    bars = pd.DataFrame({"open": np.arange(7) + 100.0, "high": np.arange(7) + 101.0, "low": np.arange(7) + 99.0,
                         "close": np.arange(7) + 100.5, "volume": 10.0}, index=t)
    dt = day_table(bars, 60)
    row = dt.iloc[0]
    assert row["fh_open"] == 100 and row["fh_close"] == 100.5 and row["day_close"] == 106.5
    s = bar_end_series(bars, 60)
    when = pd.DatetimeIndex([pd.Timestamp("2026-01-05 10:30", tz="America/New_York"),
                             pd.Timestamp("2026-01-05 10:29", tz="America/New_York")])
    v = asof(s, when, pd.Timedelta(minutes=90))
    assert v[0] == 100.5 and np.isnan(v[1])   # the 09:30 bar is not usable before it ends


def test_gex_and_news_offline():
    rows = [dict(strike=k, openInterest=1000.0, impliedVolatility=0.2, volume=1.0, type=t, expiry=pd.Timestamp("2026-11-20"))
            for k in range(480, 521, 5) for t in "CP"]
    g = gex_summary(pd.DataFrame(rows), 500.0, pd.Timestamp("2026-11-03 10:31", tz="America/New_York"))
    assert g["call_wall"] is not None and np.isfinite(g["gex_usd_per_1pct"])
    sc, backend = score_headlines(["Nasdaq surges to record", "Chipmakers plunge on export ban"], backend="lexicon")
    assert sc[0]["score"] > 0 > sc[1]["score"]
    assert aggregate([{"title": "a", "source": "x"}, {"title": "b", "source": "y"}], sc)["n"] == 2


def test_hourly_ready_detects_grid(tmp_path):
    from futuremodel.data.store import Store
    from futuremodel.live.signal import _hourly_ready
    st = Store(tmp_path)
    tz = "America/New_York"
    for name, first in (("QQQ", "09:30"), ("^VIX", "09:00")):
        idx = pd.DatetimeIndex([pd.Timestamp(f"2026-10-{d} {first}", tz=tz) + pd.Timedelta(hours=h)
                                for d in (28, 29, 30) for h in range(6)])
        st.write("intraday_60m", name, pd.DataFrame({"close": 1.0}, index=idx))
    cutoff_old = pd.Timestamp("2026-10-30 10:30", tz=tz)
    cutoff_new = pd.Timestamp("2026-11-02 10:30", tz=tz)
    assert _hourly_ready(st, "QQQ", cutoff_old) and _hourly_ready(st, "^VIX", cutoff_old)
    assert not _hourly_ready(st, "QQQ", cutoff_new) and not _hourly_ready(st, "SPY", cutoff_new)
