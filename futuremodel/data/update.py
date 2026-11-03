"""One call to refresh every free source. Each step is independent and failure tolerant."""
from __future__ import annotations

import logging

from . import macro, sentiment_sources, yahoo
from .store import Store

log = logging.getLogger(__name__)


def update_all(store: Store | None = None, intraday: bool = True, extras: bool = True) -> dict:
    store = store or Store()
    report = {}
    report["daily"] = yahoo.update_daily(store)
    report["vol_cboe"] = macro.backfill_vol_from_cboe(store) if extras else []
    if intraday:
        report["intraday_60m"] = yahoo.update_intraday(store, interval="60m", period="730d")
        # 5-minute bars only exist for 60 days on Yahoo: archive them for future, finer features
        report["intraday_5m"] = yahoo.update_intraday(store, tickers=["QQQ", "SPY", "^VIX"], interval="5m", period="60d")
    if extras:
        report["fred"] = macro.update_fred(store)
        report["sentiment"] = sentiment_sources.update_sentiment(store)
    for k, v in report.items():
        log.info("%-14s %d series", k, len(v))
    return report
