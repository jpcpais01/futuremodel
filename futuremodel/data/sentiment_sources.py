"""Free sentiment history: CNN Fear & Greed, AAII investor survey, GDELT news tone.

Each source is optional. If one is down or blocked, its features become NaN and the sentiment
specialist simply learns less; nothing else breaks.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

from .store import Store

log = logging.getLogger(__name__)
HTTP_UA = {"User-Agent": "futuremodel/0.1 (research script)"}


def fetch_cnn_fear_greed(start: str = "2020-01-01") -> pd.DataFrame | None:
    url = f"https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{start}"
    try:
        r = requests.get(url, headers=HTTP_UA, timeout=30)
        r.raise_for_status()
        data = r.json()["fear_and_greed_historical"]["data"]
        df = pd.DataFrame(data)
        df["date"] = pd.to_datetime(df["x"], unit="ms").dt.normalize()
        df = df.groupby("date")["y"].last().to_frame("fg")
        return df
    except Exception as e:
        log.warning("CNN fear & greed failed: %s", e)
        return None


def fetch_aaii() -> pd.DataFrame | None:
    url = "https://www.aaii.com/files/surveys/sentiment.xls"
    try:
        r = requests.get(url, headers=HTTP_UA, timeout=60)
        r.raise_for_status()
        raw = pd.read_excel(io.BytesIO(r.content), header=None)
    except Exception as e:
        log.warning("AAII survey failed: %s", e)
        return None
    rows = []
    for _, row in raw.iterrows():
        d = pd.to_datetime(row.iloc[0], errors="coerce")
        vals = pd.to_numeric(row.iloc[1:4], errors="coerce")
        if pd.isna(d) or not vals.notna().all():
            continue
        scale = 100.0 if vals.max() > 1.5 else 1.0
        if 0.9 <= vals.sum() / scale <= 1.1:   # bull + neutral + bear ~= 100%
            rows.append((d.normalize(), vals.iloc[0] / scale, vals.iloc[1] / scale, vals.iloc[2] / scale))
    if not rows:
        return None
    df = pd.DataFrame(rows, columns=["date", "bull", "neutral", "bear"]).drop_duplicates("date").set_index("date")
    return df.sort_index()


GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_QUERY = '("stock market" OR nasdaq OR "wall street" OR "federal reserve") sourcelang:english'


def _gdelt(mode: str, start: datetime, end: datetime) -> pd.Series | None:
    params = dict(query=GDELT_QUERY, mode=mode, format="json",
                  startdatetime=start.strftime("%Y%m%d%H%M%S"), enddatetime=end.strftime("%Y%m%d%H%M%S"))
    try:
        r = requests.get(GDELT_URL, params=params, headers=HTTP_UA, timeout=60)
        r.raise_for_status()
        tl = r.json().get("timeline", [])
        if not tl:
            return None
        data = tl[0]["data"]
        s = pd.Series({pd.to_datetime(d["date"]): float(d["value"]) for d in data})
        s.index = s.index.tz_localize(None) if s.index.tz is not None else s.index
        return s.sort_index()
    except Exception as e:
        log.warning("GDELT %s failed: %s", mode, e)
        return None


def fetch_gdelt(days: int = 85) -> pd.DataFrame | None:
    """Daily average tone and article volume. The free DOC API only reaches back ~3 months, so this
    is archived on every `fm update` and the history grows over time."""
    end = datetime.now(timezone.utc).replace(tzinfo=None)
    start = end - timedelta(days=days)
    tone = _gdelt("timelinetone", start, end)
    vol = _gdelt("timelinevolraw", start, end)
    if tone is None:
        return None
    df = pd.DataFrame({"tone": tone.resample("D").mean()})
    if vol is not None:
        df["volume"] = vol.resample("D").sum()
    else:
        df["volume"] = np.nan
    # drop the still-incomplete current UTC day
    return df[df.index < pd.Timestamp(end.date())]


def update_sentiment(store: Store) -> list[str]:
    got = []
    for name, fn in (("cnn_fg", fetch_cnn_fear_greed), ("aaii", fetch_aaii), ("gdelt", fetch_gdelt)):
        df = fn()
        if df is not None and not df.empty:
            store.merge("sentiment", name, df)
            got.append(name)
    return got
