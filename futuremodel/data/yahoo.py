"""Yahoo Finance via yfinance (free): daily history, 60-minute bars (~730 days), 1-minute bars (live)."""
from __future__ import annotations

import logging
import time

import pandas as pd

from .. import config
from .store import Store

log = logging.getLogger(__name__)

_COLS = {"Open": "open", "High": "high", "Low": "low", "Close": "close", "Adj Close": "adj_close",
         "Volume": "volume"}


def _yf():
    import yfinance as yf  # imported lazily so tests and offline use never need network
    return yf


def _split_frame(raw: pd.DataFrame, tickers: list[str]) -> dict[str, pd.DataFrame]:
    """yfinance returns (ticker, field) MultiIndex columns; split into one frame per ticker."""
    out = {}
    if raw is None or raw.empty:
        return out
    if isinstance(raw.columns, pd.MultiIndex):
        lvl0 = set(raw.columns.get_level_values(0))
        for t in tickers:
            if t in lvl0:
                df = raw[t].copy()
            elif t in set(raw.columns.get_level_values(1)):
                df = raw.xs(t, axis=1, level=1).copy()
            else:
                continue
            df = df.rename(columns=_COLS)
            df = df[[c for c in _COLS.values() if c in df.columns]].dropna(subset=["close"])
            if not df.empty:
                out[t] = df
    else:
        df = raw.rename(columns=_COLS).dropna(subset=["close"])
        if len(tickers) == 1 and not df.empty:
            out[tickers[0]] = df[[c for c in _COLS.values() if c in df.columns]]
    return out


def _download(tickers: list[str], retries: int = 3, **kw) -> dict[str, pd.DataFrame]:
    yf = _yf()
    for attempt in range(retries):
        try:
            raw = yf.download(tickers=tickers, group_by="ticker", auto_adjust=False, threads=True,
                              progress=False, **kw)
            return _split_frame(raw, tickers)
        except Exception as e:  # network hiccups / rate limits
            log.warning("yfinance download failed (%s), retry %d", e, attempt + 1)
            time.sleep(2 ** (attempt + 1))
    return {}


def _chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def _drop_forming_day(df: pd.DataFrame) -> pd.DataFrame:
    """Before ~17:00 NY today's daily bar is still forming: never store it."""
    now = pd.Timestamp.now(tz=config.TZ)
    if now.hour < 17:
        df = df[df.index < now.normalize().tz_localize(None)]
    return df


def update_daily(store: Store, tickers: list[str] | None = None, start: str = "1999-01-01") -> list[str]:
    tickers = tickers or config.DAILY_TICKERS
    got = []
    for chunk in _chunks(tickers, 25):
        # incremental: only fetch recent history for tickers we already have
        have = {t: store.read("daily", t) for t in chunk}
        fresh = [t for t in chunk if have[t] is None or have[t].empty]
        stale = [t for t in chunk if t not in fresh]
        for group, kw in ((fresh, dict(start=start)), (stale, dict(period="1mo"))):
            if not group:
                continue
            frames = _download(group, interval="1d", **kw)
            for t, df in frames.items():
                df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
                df = _drop_forming_day(df)
                if t in stale:
                    # yfinance re-bases adj_close after dividends: if the overlap disagrees, refetch all
                    old = have[t]
                    ov = old.index.intersection(df.index)
                    if len(ov) and "adj_close" in df and (abs(old.loc[ov, "adj_close"] / df.loc[ov, "adj_close"] - 1) > 1e-4).any():
                        full = _download([t], interval="1d", start=start).get(t)
                        if full is not None:
                            full.index = pd.to_datetime(full.index).tz_localize(None).normalize()
                            store.write("daily", t, _drop_forming_day(full))
                            got.append(t)
                            continue
                store.merge("daily", t, df)
                got.append(t)
    return got


def _to_ny(df: pd.DataFrame) -> pd.DataFrame:
    idx = pd.to_datetime(df.index)
    idx = idx.tz_localize("UTC") if idx.tz is None else idx
    df.index = idx.tz_convert(config.TZ)
    return df


def update_intraday(store: Store, tickers: list[str] | None = None, interval: str = "60m",
                    period: str = "730d") -> list[str]:
    tickers = tickers or config.INTRADAY_TICKERS
    kind = f"intraday_{interval}"
    got = []
    crypto = [t for t in tickers if t.endswith("-USD")]
    equities = [t for t in tickers if t not in crypto]
    for group in list(_chunks(equities, 20)) + ([crypto] if crypto else []):
        frames = _download(group, interval=interval, period=period, prepost=False)
        minutes = int(interval.rstrip("mh")) * (60 if interval.endswith("h") else 1)
        now = pd.Timestamp.now(tz=config.TZ)
        for t, df in frames.items():
            df = _to_ny(df)[["open", "high", "low", "close", "volume"]]
            df = df[df.index + pd.Timedelta(minutes=minutes) <= now]   # never store a bar still forming
            store.merge(kind, t, df)
            got.append(t)
    return got


def fetch_today_minutes(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """1-minute bars for today's session (used live at 10:30)."""
    out = {}
    crypto = [t for t in tickers if t.endswith("-USD")]
    equities = [t for t in tickers if t not in crypto]
    for group, kw in ((equities, dict(period="1d")), (crypto, dict(period="2d"))):
        if not group:
            continue
        for t, df in _download(group, interval="1m", prepost=False, **kw).items():
            out[t] = _to_ny(df)[["open", "high", "low", "close", "volume"]]
    return out
