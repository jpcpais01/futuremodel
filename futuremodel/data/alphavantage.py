"""Optional deep intraday backfill from Alpha Vantage's free tier (needs a free API key).

Yahoo stops at ~730 days of 60-minute bars, which caps QQQ at ~500 labelled days. Alpha Vantage's
TIME_SERIES_INTRADAY endpoint can return one calendar month of 30-minute bars per call, going back
to 2000. The free tier allows ~25 calls/day, so this job is resumable: run it daily (e.g. from cron)
and it keeps adding months, newest first, until the requested range is complete.

Free-tier terms change from time to time; if the endpoint starts answering with a premium notice,
the job stops cleanly and tells you.
"""
from __future__ import annotations

import io
import json
import logging
import time

import pandas as pd
import requests

from .. import config
from .store import Store

log = logging.getLogger(__name__)
URL = "https://www.alphavantage.co/query"
KIND = "intraday_30m_av"


def _months(start: str, end: str) -> list[str]:
    return [p.strftime("%Y-%m") for p in pd.period_range(start, end, freq="M")][::-1]


def _bar_starts(df: pd.DataFrame) -> pd.DataFrame:
    """Alpha Vantage labels bars by their END time (last regular bar is 16:00). Re-label by start
    so every intraday source in the store shares one convention."""
    t = df.index
    if ((t.hour == 16) & (t.minute == 0)).any():
        df.index = t - pd.Timedelta(minutes=30)
    return df


def backfill(store: Store, api_key: str, tickers: list[str] | None = None, start: str = "2005-01",
             end: str | None = None, max_calls: int = 25, pause: float = 13.0) -> dict:
    tickers = tickers or [config.TARGET]
    end = end or pd.Timestamp.now().strftime("%Y-%m")
    state_path = store.root / KIND / "_done.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    done = set(json.loads(state_path.read_text())) if state_path.exists() else set()
    calls, added = 0, 0
    for month in _months(start, end):
        for tk in tickers:
            key = f"{tk}:{month}"
            if key in done:
                continue
            if calls >= max_calls:
                state_path.write_text(json.dumps(sorted(done)))
                return {"calls": calls, "bars_added": added, "status": "daily call budget used, run again tomorrow"}
            params = dict(function="TIME_SERIES_INTRADAY", symbol=tk, interval="30min", month=month,
                          outputsize="full", extended_hours="false", adjusted="true", datatype="csv",
                          apikey=api_key)
            r = requests.get(URL, params=params, timeout=60)
            calls += 1
            text = r.text
            if text.lstrip().startswith("{"):
                msg = json.loads(text)
                note = " ".join(str(v) for v in msg.values())
                state_path.write_text(json.dumps(sorted(done)))
                return {"calls": calls, "bars_added": added, "status": f"stopped: {note[:200]}"}
            df = pd.read_csv(io.StringIO(text))
            if df.empty:
                done.add(key)
                continue
            df["timestamp"] = pd.to_datetime(df["timestamp"]).dt.tz_localize(config.TZ)
            df = df.set_index("timestamp").sort_index()[["open", "high", "low", "close", "volume"]]
            df = _bar_starts(df)
            store.merge(KIND, tk, df)
            added += len(df)
            done.add(key)
            time.sleep(pause)   # free tier: 5 calls/minute
    state_path.write_text(json.dumps(sorted(done)))
    return {"calls": calls, "bars_added": added, "status": "complete"}
