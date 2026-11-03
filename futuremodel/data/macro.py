"""Free macro and volatility sources: FRED (no key needed for the CSV endpoint) and CBOE index CSVs."""
from __future__ import annotations

import io
import logging

import pandas as pd
import requests

from .. import config
from .store import Store

log = logging.getLogger(__name__)
UA = {"User-Agent": "futuremodel/0.1 (research script)"}

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
CBOE_CSV = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{name}_History.csv"


def fetch_fred(series_id: str) -> pd.DataFrame | None:
    try:
        # FRED's firewall stalls requests carrying custom User-Agent strings; the library default works.
        r = requests.get(FRED_CSV.format(sid=series_id), timeout=60)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = ["date", "value"]
        df["date"] = pd.to_datetime(df["date"])
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        return df.dropna().set_index("date")
    except Exception as e:
        log.warning("FRED %s failed: %s", series_id, e)
        return None


def update_fred(store: Store) -> list[str]:
    got = []
    for sid in config.FRED_SERIES:
        df = fetch_fred(sid)
        if df is not None and not df.empty:
            store.merge("fred", sid, df)
            got.append(sid)
    return got


def fetch_cboe(name: str) -> pd.DataFrame | None:
    """CBOE publishes full daily history for VIX, VIX9D, VIX3M, VVIX, SKEW... as CSV."""
    try:
        r = requests.get(CBOE_CSV.format(name=name), headers=UA, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = [c.strip().lower() for c in df.columns]
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        if "close" not in df and name.lower() in df:
            df["close"] = df[name.lower()]
        return df
    except Exception as e:
        log.warning("CBOE %s failed: %s", name, e)
        return None


def backfill_vol_from_cboe(store: Store) -> list[str]:
    """Fill gaps in Yahoo's ^VIX family with CBOE's own history (Yahoo rows win on overlap)."""
    got = []
    for ytk in config.VOL_INDICES:
        name = ytk.lstrip("^")
        df = fetch_cboe(name)
        if df is None or "close" not in df:
            continue
        cols = [c for c in ["open", "high", "low", "close"] if c in df]
        df = df[cols].copy()
        df["adj_close"] = df["close"]
        old = store.read("daily", ytk)
        if old is not None and not old.empty:
            df = df[~df.index.isin(old.index)]
        store.merge("daily", ytk, df)
        got.append(ytk)
    return got
