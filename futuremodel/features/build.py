"""Feature panel builder.

Output: one row per (date, ticker) with every feature known at 10:30 New York time on `date`,
plus the label y = log(close / price at 10:30) and its volatility-normalised version y_z.

Timing rules (tested in tests/test_leakage.py):
  * daily data enters only through the *previous* session's end-of-day state;
  * intraday data enters only through bars ending at or before 10:30 on `date`;
  * slow series (FRED, sentiment) enter with a publication lag, strictly before `date`.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .. import calendar as cal
from .. import config
from ..data.store import Store
from . import intraday as itd

log = logging.getLogger(__name__)

INTRADAY_SOURCES = [("intraday_60m", 60, "yahoo"), ("intraday_30m_av", 30, "av")]
UNADJUSTED_SOURCES = {"yahoo", "live"}   # split-adjusted but not dividend-adjusted
SIGMA_FLOOR = 0.002


class MarketData:
    """Read-through cache over the store, with optional live 1-minute bars for `asof_date`."""

    def __init__(self, store: Store, live_minutes: dict | None = None, asof_date=None):
        self.store = store
        self.live = live_minutes or {}
        self.asof_date = pd.Timestamp(asof_date).normalize() if asof_date is not None else None
        self._daily, self._dt, self._ends = {}, {}, {}

    def daily(self, t: str) -> pd.DataFrame | None:
        if t not in self._daily:
            d = self.store.read("daily", t)
            if d is not None and not d.empty:
                d = d[~d.index.duplicated(keep="last")].sort_index()
                if "adj_close" not in d:
                    d["adj_close"] = d["close"]
                if self.asof_date is not None:
                    d = d[d.index < self.asof_date]   # never let a partial "today" row in
            self._daily[t] = d if d is not None and not d.empty else None
        return self._daily[t]

    def _sources(self, t: str):
        out = []
        if t in self.live and self.live[t] is not None and len(self.live[t]):
            out.append((self.live[t], 1, "live"))
        for kind, interval, src in INTRADAY_SOURCES:
            b = self.store.read(kind, t)
            if b is not None and not b.empty:
                if self.asof_date is not None:
                    day = pd.DatetimeIndex(b.index).tz_convert(config.TZ).tz_localize(None).normalize()
                    keep = day < self.asof_date if t in self.live else day <= self.asof_date
                    b = b[keep]
                out.append((b, interval, src))
        return out

    def day_table(self, t: str) -> pd.DataFrame:
        if t not in self._dt:
            srcs = self._sources(t)
            self._dt[t] = itd.combine_day_tables([itd.day_table(b, iv) for b, iv, _ in srcs], [s for _, _, s in srcs])
        return self._dt[t]

    def end_series(self, t: str) -> pd.Series:
        if t not in self._ends:
            parts = [itd.bar_end_series(b, iv) for b, iv, _ in self._sources(t)]
            parts = [p for p in parts if not p.empty]
            if parts:
                s = pd.concat(parts)
                s = s[~s.index.duplicated(keep="first")].sort_index()
            else:
                s = pd.Series(dtype=float)
            self._ends[t] = s
        return self._ends[t]


# ---------------------------------------------------------------------------------------------
# end-of-day state (known after the close of day d)
# ---------------------------------------------------------------------------------------------
def eod_state(d: pd.DataFrame) -> pd.DataFrame:
    ac = d["adj_close"].astype(float)
    lr = np.log(ac).diff()
    s = pd.DataFrame(index=d.index)
    s["close_raw"] = d["close"].astype(float)
    s["f"] = (ac / d["close"]).replace([np.inf, -np.inf], np.nan).fillna(1.0)
    s["lr"] = lr
    s["sigma"] = lr.rolling(20, min_periods=10).std()
    s["rv5"] = lr.rolling(5, min_periods=4).std()
    for n in (5, 20, 60, 120, 250):
        s[f"r{n}"] = np.log(ac / ac.shift(n))
    s["sma50"] = np.log(ac / ac.rolling(50, min_periods=40).mean())
    s["sma200"] = np.log(ac / ac.rolling(200, min_periods=150).mean())
    s["dd252"] = np.log(ac / ac.rolling(252, min_periods=60).max())
    s["rv20_pct"] = s["sigma"].rolling(252, min_periods=60).rank(pct=True)
    s["sigma_5ago"] = s["sigma"].shift(5)
    s["ac_19ago"] = ac.shift(19)   # used to roll the 20-day window forward intraday
    s["ac"] = ac
    hl = (d["high"] - d["low"]).replace(0, np.nan) if {"high", "low"} <= set(d) else np.nan
    s["close_loc"] = ((d["close"] - d["low"]) / hl - 0.5) if {"high", "low"} <= set(d) else np.nan
    vol = d["volume"].astype(float) if "volume" in d else pd.Series(np.nan, index=d.index)
    s["dv20"] = (d["close"] * vol).rolling(20, min_periods=5).mean()
    return s


def _prev_state(state: pd.DataFrame, dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Row of `state` for the last date strictly before each of `dates`."""
    pos = state.index.searchsorted(dates, side="left") - 1
    out = state.iloc[np.clip(pos, 0, len(state) - 1)].copy()
    out.index = dates
    out[pos < 0] = np.nan
    return out


def _asof_lagged(df: pd.DataFrame, dates: pd.DatetimeIndex, lag_days: int) -> pd.DataFrame:
    """Value of a slow series that was public before `date` (obs_date + lag < date)."""
    avail = df.index + pd.Timedelta(days=lag_days)
    pos = avail.searchsorted(dates, side="left") - 1
    out = df.iloc[np.clip(pos, 0, len(df) - 1)].copy()
    out.index = dates
    out[pos < 0] = np.nan
    return out


# ---------------------------------------------------------------------------------------------
# per-ticker features
# ---------------------------------------------------------------------------------------------
def ticker_frame(md: MarketData, t: str) -> pd.DataFrame | None:
    daily = md.daily(t)
    dt = md.day_table(t)
    if daily is None or len(daily) < 30 or dt is None or dt.empty:
        return None
    dt = dt[dt.index.isin(cal.trading_days()) | (dt.index == md.asof_date)]
    if dt.empty:
        return None
    dates = pd.DatetimeIndex(dt.index)
    S = _prev_state(eod_state(daily), dates)
    f_t = daily["adj_close"].div(daily["close"]).reindex(dates)
    f_t = f_t.fillna(S["f"])
    unadj = dt["source"].isin(UNADJUSTED_SOURCES)
    divadj = np.where(unadj, (S["f"] / f_t).clip(0.9, 1.0), 1.0)

    td = cal.trading_days()
    prev_td = td[np.clip(td.searchsorted(dates) - 1, 0, len(td) - 1)]
    prev_close_itd = dt["day_close"].shift(1)
    contiguous = pd.Series(dates, index=dates).shift(1).to_numpy() == prev_td
    prev_ref = pd.Series(np.where(contiguous, prev_close_itd, np.nan), index=dates)
    fallback = unadj & prev_ref.isna()
    prev_ref[fallback] = S.loc[fallback, "close_raw"]
    prev_ref_adj = prev_ref * divadj

    sigma = S["sigma"].clip(lower=SIGMA_FLOOR)
    o = pd.DataFrame(index=dates)
    gap = np.log(dt["fh_open"] / prev_ref_adj)
    fh_ret = np.log(dt["fh_close"] / dt["fh_open"])
    since = gap + fh_ret

    # label: prefer the official close from the daily file when it is on the same price basis
    close = dt["day_close"].copy()
    off = daily["close"].reindex(dates)
    same_basis = unadj & ((off / close - 1).abs() < 0.005)
    close[same_basis] = off[same_basis]
    y = np.log(close / dt["fh_close"])

    o["y"] = y
    o["sigma"] = sigma
    o["y_z"] = y / sigma
    o["source"] = dt["source"]
    o["gap_z"] = gap / sigma
    o["fh_ret_z"] = fh_ret / sigma
    o["since_close_z"] = since / sigma
    o["since_close"] = since
    o["fh_range_z"] = np.log(dt["fh_high"] / dt["fh_low"]) / sigma
    rng = (dt["fh_high"] - dt["fh_low"]).replace(0, np.nan)
    o["fh_clv"] = (dt["fh_close"] - dt["fh_low"]) / rng - 0.5
    typical = (dt["fh_high"] + dt["fh_low"] + dt["fh_close"]) / 3
    o["fh_vwap_dev_z"] = np.log(dt["fh_close"] / typical) / sigma
    vol = dt["fh_volume"].astype(float).replace(0, np.nan)
    o["fh_rvol"] = np.log(vol / vol.rolling(20, min_periods=5).mean().shift(1))
    filled = np.where(gap > 0, dt["fh_low"] <= prev_ref_adj, dt["fh_high"] >= prev_ref_adj)
    o["gap_filled"] = np.where(gap.notna(), filled.astype(float), np.nan)
    o["fh_ret"] = fh_ret
    o["fh_close"] = dt["fh_close"]

    o["prev_label_z"] = y.shift(1) / sigma
    o["prev_fh_z"] = fh_ret.shift(1) / sigma
    o["label_mean5_z"] = y.shift(1).rolling(5, min_periods=3).mean() / sigma
    o["gap_mean5_z"] = gap.shift(1).rolling(5, min_periods=3).mean() / sigma

    o["r1_z"] = S["lr"] / sigma
    for n in (5, 20, 60, 120, 250):
        o[f"r{n}_z"] = S[f"r{n}"] / (sigma * np.sqrt(n))
    o["sma50_dist_z"] = S["sma50"] / sigma
    o["sma200_dist_z"] = S["sma200"] / sigma
    o["dd252"] = S["dd252"]
    o["rv5_rv20"] = np.log(S["rv5"].clip(lower=1e-4) / sigma)
    o["rv20_pct"] = S["rv20_pct"]
    o["prev_close_loc"] = S["close_loc"]
    o["rv20_ann"] = S["sigma"] * np.sqrt(252)
    o["sigma_5ago"] = S["sigma_5ago"]
    o["dv20"] = S["dv20"]
    # intraday-updated 20d trend: does this morning's move flip the 20-day trend sign?
    r20_prev = np.log(S["ac"] / S["ac_19ago"].where(S["ac_19ago"] > 0))
    r20_now = r20_prev + since
    o["cta_flip"] = np.where(np.sign(r20_now) != np.sign(r20_prev), np.sign(r20_now), 0.0)
    o.loc[r20_prev.isna(), "cta_flip"] = np.nan
    o["cta_score"] = sum(np.clip(o[f"r{n}_z"], -2, 2) for n in (20, 60, 120, 250)) / 8
    return o


# ---------------------------------------------------------------------------------------------
# date-level blocks
# ---------------------------------------------------------------------------------------------
def _lev_ratio(md: MarketData, base: str, dates: pd.DatetimeIndex) -> pd.Series:
    """sum_L L(L-1) * dollar-volume(levETF) / dollar-volume(base): rebalancing-flow intensity proxy.
    A leveraged ETF must buy L(L-1) * AUM * r of exposure at the close after an index move r."""
    bd = md.daily(base)
    if bd is None:
        return pd.Series(np.nan, index=dates)
    base_dv = _prev_state(eod_state(bd), dates)["dv20"]
    tot = pd.Series(0.0, index=dates)
    any_ok = False
    for etf, L in config.LEVERAGED.get(base, {}).items():
        d = md.daily(etf)
        if d is None:
            continue
        dv = _prev_state(eod_state(d), dates)["dv20"].fillna(0)
        tot += L * (L - 1) * dv
        any_ok = True
    return (tot / base_dv) if any_ok else pd.Series(np.nan, index=dates)


def market_block(md: MarketData, frames: dict, dates: pd.DatetimeIndex) -> pd.DataFrame:
    m = pd.DataFrame(index=dates)

    def col(t, c):
        f = frames.get(t)
        return f[c].reindex(dates) if f is not None and c in f else pd.Series(np.nan, index=dates)

    m["m_qqq_since_close_z"] = col("QQQ", "since_close_z")
    m["m_qqq_fh_ret_z"] = col("QQQ", "fh_ret_z")
    m["m_qqq_fh_clv"] = col("QQQ", "fh_clv")
    m["m_qqq_fh_rvol"] = col("QQQ", "fh_rvol")
    m["m_spy_since_close_z"] = col("SPY", "since_close_z")
    m["m_iwm_minus_qqq_z"] = col("IWM", "since_close_z") - m["m_qqq_since_close_z"]
    m["m_smh_minus_qqq_z"] = col("SMH", "since_close_z") - m["m_qqq_since_close_z"]
    m["m_qqq_r20_z"] = col("QQQ", "r20_z")
    m["m_qqq_rv20_pct"] = col("QQQ", "rv20_pct")

    mega = [t for t in config.MEGACAPS if t in frames]
    if mega:
        sc = pd.concat({t: col(t, "since_close_z") for t in mega}, axis=1)
        fr = pd.concat({t: col(t, "fh_ret_z") for t in mega}, axis=1)
        m["m_breadth_fh"] = (fr > 0).where(fr.notna()).mean(axis=1) - 0.5
        m["m_breadth_since_close"] = (sc > 0).where(sc.notna()).mean(axis=1) - 0.5
        m["m_mega_dispersion"] = sc.std(axis=1)
        top = [t for t in config.TOP_HOLDINGS if t in sc]
        if top:
            w = pd.Series({t: config.TOP_HOLDINGS[t] for t in top})
            num = (sc[top] * w).sum(axis=1, min_count=1)
            den = sc[top].notna().mul(w).sum(axis=1).replace(0, np.nan)
            m["m_mega_wavg_z"] = num / den
            m["m_mega_div_z"] = m["m_mega_wavg_z"] - m["m_qqq_since_close_z"]

    # mechanical flows
    lev_q = _lev_ratio(md, "QQQ", dates)
    m["f_lev_flow_qqq"] = col("QQQ", "since_close") * lev_q * 100
    qs = col("QQQ", "sigma")
    m["f_voltarget_qqq"] = np.log(qs / col("QQQ", "sigma_5ago"))
    m["f_cta_score_qqq"] = col("QQQ", "cta_score")
    m["f_cta_flip_qqq"] = col("QQQ", "cta_flip")
    m = m.join(cal.calendar_features(dates))
    return m


def vol_block(md: MarketData, dates: pd.DatetimeIndex, qqq_rv20: pd.Series) -> pd.DataFrame:
    v = pd.DataFrame(index=dates)

    def prev_close(t):
        d = md.daily(t)
        return _prev_state(d[["close"]], dates)["close"] if d is not None else pd.Series(np.nan, index=dates)

    vix = prev_close("^VIX")
    v["v_vix"] = vix
    vd = md.daily("^VIX")
    if vd is not None:
        st = pd.DataFrame({"pct": vd["close"].rolling(252, min_periods=60).rank(pct=True),
                           "chg": np.log(vd["close"] / vd["close"].shift(1))})
        p = _prev_state(st, dates)
        v["v_vix_pct"], v["v_vix_chg_1d"] = p["pct"], p["chg"]
    vix_1030 = itd.asof(md.end_series("^VIX"), itd.at_time(dates, 10, 30), pd.Timedelta(minutes=90))
    v["v_vix_chg_1030"] = np.log(vix_1030 / vix)
    v["v_vix9d_ratio"] = np.log(prev_close("^VIX9D") / vix)
    v["v_vix3m_ratio"] = np.log(vix / prev_close("^VIX3M"))
    v["v_vvix"] = prev_close("^VVIX")
    v["v_skew"] = prev_close("^SKEW")
    v["v_vrp"] = vix / 100 - qqq_rv20
    return v


def cross_asset_block(md: MarketData, dates: pd.DatetimeIndex) -> pd.DataFrame:
    x = pd.DataFrame(index=dates)
    td = cal.trading_days()
    prev_td = td[np.clip(td.searchsorted(dates) - 1, 0, len(td) - 1)]
    at1030 = itd.at_time(dates, 10, 30)
    at_prev_close = itd.at_time(prev_td, 16, 0)
    names = {"TLT": "x_tlt", "IEF": "x_ief", "UUP": "x_uup", "HYG": "x_hyg", "LQD": "x_lqd",
             "GLD": "x_gld", "USO": "x_uso", "BTC-USD": "x_btc"}
    for tk, name in {**names, "^TNX": "x_tnx_bps"}.items():
        s = md.end_series(tk)
        p_now = itd.asof(s, at1030, pd.Timedelta(minutes=90))
        p_ref = itd.asof(s, at_prev_close, pd.Timedelta(minutes=90))
        d = md.daily(tk)
        st = _prev_state(eod_state(d), dates) if d is not None and len(d) > 30 else None
        if st is not None:
            p_ref = np.where(np.isnan(p_ref), st["close_raw"].to_numpy(), p_ref)
        if tk == "^TNX":
            scale = 0.1 if np.nanmedian(p_ref) > 20 else 1.0  # old quotes were yield x 10
            x[name] = (p_now - p_ref) * scale * 100
            continue
        sig = st["sigma"].clip(lower=SIGMA_FLOOR) if st is not None else np.nan
        x[name] = np.log(p_now / p_ref) / sig
        if tk in ("TLT", "HYG") and st is not None:
            x[f"{name}_1d"] = st["lr"] / sig
    x["x_hyg_lqd"] = x.get("x_hyg") - x.get("x_lqd")
    return x


def macro_block(md: MarketData, dates: pd.DatetimeIndex) -> pd.DataFrame:
    out = pd.DataFrame(index=dates)

    def series(sid):
        df = md.store.read("fred", sid)
        if df is None or df.empty:
            return None
        return df["value"].astype(float).sort_index()

    def put(name, sid, transform):
        s = series(sid)
        if s is None:
            out[name] = np.nan
            return
        val = transform(s).to_frame("v").dropna()
        out[name] = _asof_lagged(val, dates, config.FRED_SERIES[sid])["v"] if len(val) else np.nan

    put("macro_hy_oas", "BAMLH0A0HYM2", lambda s: s)
    put("macro_hy_oas_chg5", "BAMLH0A0HYM2", lambda s: s.diff(5))
    put("macro_ig_oas_chg5", "BAMLC0A0CM", lambda s: s.diff(5))
    put("macro_t10y2y", "T10Y2Y", lambda s: s)
    put("macro_t10y3m", "T10Y3M", lambda s: s)
    put("macro_dgs10_chg5", "DGS10", lambda s: s.diff(5) * 100)
    put("macro_usd_chg5", "DTWEXBGS", lambda s: np.log(s).diff(5))
    put("macro_nfci", "NFCI", lambda s: s)
    return out


def sentiment_block(md: MarketData, dates: pd.DatetimeIndex) -> pd.DataFrame:
    out = pd.DataFrame(index=dates, columns=config.FAMILIES["sentiment"], dtype=float)
    fg = md.store.read("sentiment", "cnn_fg")
    if fg is not None and not fg.empty:
        s = fg["fg"].astype(float)
        f = pd.DataFrame({"fg": s, "chg5": s.diff(5)})
        a = _asof_lagged(f, dates, 0)
        out["s_fg"], out["s_fg_chg5"] = a["fg"], a["chg5"]
    aaii = md.store.read("sentiment", "aaii")
    if aaii is not None and not aaii.empty:
        sp = (aaii["bull"] - aaii["bear"]).astype(float)
        f = pd.DataFrame({"sp": sp, "z": (sp - sp.rolling(52, min_periods=20).mean()) / sp.rolling(52, min_periods=20).std()})
        a = _asof_lagged(f, dates, 0)
        out["s_aaii_spread"], out["s_aaii_spread_z"] = a["sp"], a["z"]
    gd = md.store.read("sentiment", "gdelt")
    if gd is not None and not gd.empty:
        tone = gd["tone"].astype(float)
        lv = np.log(gd["volume"].astype(float).replace(0, np.nan))
        f = pd.DataFrame({"tone": tone,
                          "tz": (tone - tone.rolling(60, min_periods=20).mean()) / tone.rolling(60, min_periods=20).std(),
                          "vz": (lv - lv.rolling(60, min_periods=20).mean()) / lv.rolling(60, min_periods=20).std()})
        a = _asof_lagged(f, dates, 0)
        out["s_gdelt_tone"], out["s_gdelt_tone_z"], out["s_gdelt_vol_z"] = a["tone"], a["tz"], a["vz"]
    return out


# ---------------------------------------------------------------------------------------------
def build_panel(store: Store | None = None, tickers: list[str] | None = None, live_minutes: dict | None = None,
                asof_date=None, start=None) -> pd.DataFrame:
    """Build the (date, ticker) feature panel.

    tickers: rows to emit (default: the full training universe). Market-wide blocks always use
    QQQ/SPY/IWM/SMH and the megacaps regardless.
    """
    store = store or Store()
    md = MarketData(store, live_minutes=live_minutes, asof_date=asof_date)
    tickers = tickers or config.TRAIN_UNIVERSE
    need = sorted(set(tickers) | {"QQQ", "SPY", "IWM", "SMH"} | set(config.MEGACAPS))
    frames = {}
    for t in need:
        f = ticker_frame(md, t)
        if f is not None and not f.empty:
            frames[t] = f
    if "QQQ" not in frames:
        raise RuntimeError("No usable QQQ data in the store. Run `fm update` first.")
    dates = pd.DatetimeIndex(sorted(set().union(*[set(frames[t].index) for t in tickers if t in frames])))
    if start is not None:
        dates = dates[dates >= pd.Timestamp(start)]
    if asof_date is not None:
        dates = dates[dates <= pd.Timestamp(asof_date)]

    mkt = market_block(md, frames, dates)
    qqq_rv20 = frames["QQQ"]["rv20_ann"].reindex(dates)
    date_level = pd.concat([mkt, vol_block(md, dates, qqq_rv20), cross_asset_block(md, dates),
                            macro_block(md, dates), sentiment_block(md, dates)], axis=1)
    date_level = date_level.loc[:, ~date_level.columns.duplicated()]

    lev_cache = {b: _lev_ratio(md, b, dates) for b in config.LEVERAGED}
    rows = []
    for t in tickers:
        f = frames.get(t)
        if f is None:
            continue
        f = f.reindex(f.index.intersection(dates))
        if f.empty:
            continue
        f = f.copy()
        f["fh_rel_mkt_z"] = f["since_close_z"] - date_level["m_spy_since_close_z"].reindex(f.index)
        f["own_rv_ratio"] = f["rv20_ann"] / (date_level["v_vix"].reindex(f.index) / 100)
        lev = lev_cache.get(t)
        f["f_lev_flow_own"] = (f["since_close"] * lev.reindex(f.index) * 100) if lev is not None else np.nan
        f["ticker"] = t
        rows.append(f)
    panel = pd.concat(rows)
    panel = panel.join(date_level, how="left")
    panel.index.name = "date"
    panel = panel.reset_index().set_index(["date", "ticker"]).sort_index()

    # regime variables for the gate (centred, NaN -> neutral)
    panel["g_vix_pct"] = (panel["v_vix_pct"] - 0.5).fillna(0)
    panel["g_rv_pct"] = (panel["m_qqq_rv20_pct"] - 0.5).fillna(0)
    panel["g_trend"] = panel["f_cta_score_qqq"].clip(-1, 1).fillna(0)
    panel["g_move_size"] = (panel["m_qqq_since_close_z"].abs().clip(0, 4) / 2 - 0.5).fillna(0)

    for c in config.ALL_FEATURES:
        if c not in panel:
            panel[c] = np.nan
    panel[config.ALL_FEATURES] = panel[config.ALL_FEATURES].astype(float).replace([np.inf, -np.inf], np.nan)
    keep = config.ALL_FEATURES + config.GATE_FEATURES + ["y", "y_z", "sigma", "source", "fh_close"]
    return panel[keep]
