"""Approximate dealer gamma exposure (GEX) from Yahoo's free QQQ option chain.

Honest limits: Yahoo gives only the *current* chain (open interest is as of the prior close, implied
vols are delayed), and nobody publishes free GEX history. So GEX cannot be backtested here. It is
computed live as context, and every snapshot is archived under data/options/ so that after enough
months it can be validated and promoted into the model.

Convention (the common "naive GEX"): dealers are short the puts and long the calls that customers
hold, so call open interest contributes positive gamma and put open interest negative gamma.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime

import numpy as np
import pandas as pd

from .. import config
from .store import Store

log = logging.getLogger(__name__)


def bs_gamma(S, K, T, sigma, r=0.04):
    S, K, T, sigma = (np.asarray(x, dtype=float) for x in (S, K, T, sigma))
    T = np.maximum(T, 1e-6)
    sigma = np.clip(sigma, 0.01, 5.0)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    return np.exp(-0.5 * d1 ** 2) / (math.sqrt(2 * math.pi) * S * sigma * np.sqrt(T))


def fetch_chain(ticker: str = config.TARGET, max_expiries: int = 8) -> tuple[pd.DataFrame, float] | None:
    try:
        import yfinance as yf
        tk = yf.Ticker(ticker)
        spot = float(tk.fast_info["last_price"])
        rows = []
        for exp in list(tk.options)[:max_expiries]:
            ch = tk.option_chain(exp)
            for side, df in (("C", ch.calls), ("P", ch.puts)):
                d = df[["strike", "openInterest", "impliedVolatility", "volume"]].copy()
                d["type"], d["expiry"] = side, pd.Timestamp(exp)
                rows.append(d)
        return pd.concat(rows, ignore_index=True), spot
    except Exception as e:
        log.warning("option chain failed: %s", e)
        return None


def gex_summary(chain: pd.DataFrame, spot: float, now: datetime | None = None) -> dict:
    now = pd.Timestamp(now or pd.Timestamp.now(tz=config.TZ))
    if now.tzinfo is None:
        now = now.tz_localize(config.TZ)
    c = chain.dropna(subset=["strike", "openInterest", "impliedVolatility"]).copy()
    c = c[(c["openInterest"] > 0) & (c["impliedVolatility"] > 0.01)]
    expiry_close = c["expiry"].dt.tz_localize(config.TZ) + pd.Timedelta(hours=16)
    c["T"] = ((expiry_close - now).dt.total_seconds() / (365 * 24 * 3600)).clip(lower=1 / (365 * 24 * 4))
    sign = np.where(c["type"] == "C", 1.0, -1.0)

    def total_gex(S, gross=False):
        g = bs_gamma(S, c["strike"], c["T"], c["impliedVolatility"]) * c["openInterest"] * 100 * S ** 2 * 0.01
        return float(np.sum(np.abs(g) if gross else sign * g))

    gex = total_gex(spot)
    grid = np.linspace(spot * 0.94, spot * 1.06, 121)
    vals = np.array([total_gex(s) for s in grid])
    flips = np.where(np.diff(np.sign(vals)) != 0)[0]
    flip = float(grid[flips[np.argmin(np.abs(grid[flips] - spot))]]) if len(flips) else None
    today = now.normalize().tz_localize(None)
    zdte = c[c["expiry"] == today]
    g0 = bs_gamma(spot, zdte["strike"], zdte["T"], zdte["impliedVolatility"]) if len(zdte) else np.array([])
    gex0 = float(np.sum(np.where(zdte["type"] == "C", 1, -1) * g0 * zdte["openInterest"] * 100 * spot ** 2 * 0.01)) if len(zdte) else 0.0
    oi = c.groupby(["type", "strike"])["openInterest"].sum()
    near = lambda s: s[(s.index > spot * 0.9) & (s.index < spot * 1.1)]
    call_wall = float(near(oi.get("C", pd.Series(dtype=float))).idxmax()) if "C" in oi.index.get_level_values(0) else None
    put_wall = float(near(oi.get("P", pd.Series(dtype=float))).idxmax()) if "P" in oi.index.get_level_values(0) else None
    pc_oi = float(c.loc[c["type"] == "P", "openInterest"].sum() / max(c.loc[c["type"] == "C", "openInterest"].sum(), 1))
    return {"spot": spot, "gex_usd_per_1pct": gex, "gamma_flip": flip, "zero_dte_gex": gex0,
            "zero_dte_share_of_gross": abs(gex0) / max(total_gex(spot, gross=True), 1e-9),
            "call_wall": call_wall, "put_wall": put_wall, "put_call_oi": pc_oi,
            "regime": "positive gamma (dampening, mean-reverting)" if gex > 0 else "negative gamma (amplifying, trending)"}


def snapshot(store: Store, ticker: str = config.TARGET) -> dict | None:
    got = fetch_chain(ticker)
    if got is None:
        return None
    chain, spot = got
    now = pd.Timestamp.now(tz=config.TZ)
    summ = gex_summary(chain, spot, now)
    chain = chain.assign(snapshot_time=now.isoformat(), spot=spot)
    chain.index = pd.RangeIndex(len(chain))
    store.write("options", f"{ticker}_{now:%Y%m%d_%H%M}", chain)
    return summ
