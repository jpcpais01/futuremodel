"""Live headlines from free RSS feeds and Reddit (no key). Only items published before the decision
time are kept. Every pull is archived so the news/LLM signal can be validated once history exists."""
from __future__ import annotations

import json
import logging
from datetime import datetime

import pandas as pd
import requests

from .. import config
from .store import Store

log = logging.getLogger(__name__)

RSS_FEEDS = {
    "yahoo_qqq": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ,^IXIC,NVDA,AAPL,MSFT&region=US&lang=en-US",
    "cnbc_markets": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    "cnbc_top": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    "marketwatch": "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "google_news": "https://news.google.com/rss/search?q=stock+market+OR+nasdaq+when:1d&hl=en-US&gl=US&ceid=US:en",
    "nasdaq": "https://www.nasdaq.com/feed/rssoutbound?category=Markets",
}
REDDIT = ["wallstreetbets", "stocks", "investing"]


def fetch_rss(cutoff: pd.Timestamp, lookback_hours: int = 20) -> list[dict]:
    try:
        import feedparser
    except ImportError:
        log.warning("feedparser not installed; `pip install futuremodel[news]`")
        return []
    items = []
    for src, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url, agent="Mozilla/5.0")
            for e in feed.entries:
                ts = e.get("published_parsed") or e.get("updated_parsed")
                if not ts:
                    continue
                t = pd.Timestamp(datetime(*ts[:6]), tz="UTC").tz_convert(config.TZ)
                if cutoff - pd.Timedelta(hours=lookback_hours) <= t <= cutoff:
                    items.append({"source": src, "time": t.isoformat(), "title": e.get("title", "").strip()})
        except Exception as ex:
            log.warning("rss %s failed: %s", src, ex)
    return items


def fetch_reddit(cutoff: pd.Timestamp, lookback_hours: int = 20) -> list[dict]:
    items = []
    for sub in REDDIT:
        try:
            r = requests.get(f"https://www.reddit.com/r/{sub}/new.json?limit=100",
                             headers={"User-Agent": "futuremodel/0.1 (research)"}, timeout=20)
            r.raise_for_status()
            for c in r.json()["data"]["children"]:
                d = c["data"]
                t = pd.Timestamp(d["created_utc"], unit="s", tz="UTC").tz_convert(config.TZ)
                if cutoff - pd.Timedelta(hours=lookback_hours) <= t <= cutoff:
                    items.append({"source": f"reddit_{sub}", "time": t.isoformat(), "title": d.get("title", ""),
                                  "score": d.get("score", 0)})
        except Exception as ex:
            log.warning("reddit %s failed: %s", sub, ex)
    return items


def collect(store: Store, cutoff: pd.Timestamp) -> list[dict]:
    items = fetch_rss(cutoff) + fetch_reddit(cutoff)
    seen, uniq = set(), []
    for it in items:
        k = it["title"].lower()
        if k and k not in seen:
            seen.add(k)
            uniq.append(it)
    path = store.root / "news" / f"{cutoff:%Y%m%d}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(uniq, indent=1))
    return uniq
