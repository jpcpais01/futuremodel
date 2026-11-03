"""The daily 10:30 command: refresh data, build today's feature row from live 1-minute bars, and
print the decision with confidence, size, drivers, regime and data checks."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .. import calendar as cal
from .. import config
from ..data.store import Store
from ..features.build import build_panel
from ..model.bundle import FEATURE_FAMILY, FinalModel, family_contributions

log = logging.getLogger(__name__)

LIVE_INTRADAY = sorted(set(["QQQ", "SPY", "IWM", "SMH", "^VIX"] + config.MEGACAPS + config.CROSS_ASSET))
LIVE_DAILY = sorted(set(LIVE_INTRADAY + config.VOL_INDICES + list(config.LEVERAGED["QQQ"])))

FEATURE_LABELS = {
    "since_close_z": "QQQ move prev close -> 10:30", "fh_ret_z": "QQQ first-hour return", "gap_z": "QQQ opening gap",
    "fh_clv": "where QQQ sits in its first-hour range", "fh_rvol": "QQQ first-hour relative volume",
    "fh_vwap_dev_z": "QQQ vs first-hour typical price", "gap_filled": "gap filled in first hour",
    "m_breadth_fh": "megacap breadth (first hour)", "m_breadth_since_close": "megacap breadth (since close)",
    "m_mega_div_z": "megacaps vs QQQ divergence", "m_mega_dispersion": "megacap dispersion",
    "m_iwm_minus_qqq_z": "small caps vs QQQ", "m_smh_minus_qqq_z": "semis vs QQQ",
    "v_vix": "VIX level", "v_vix_chg_1030": "VIX change since close", "v_vix9d_ratio": "VIX9D/VIX (short-term stress)",
    "v_vix3m_ratio": "VIX/VIX3M term structure", "v_vrp": "implied minus realised vol", "v_skew": "CBOE SKEW",
    "f_lev_flow_qqq": "leveraged-ETF close rebalancing estimate", "f_cta_flip_qqq": "20-day trend flip today",
    "f_voltarget_qqq": "vol-targeting pressure", "c_is_opex": "monthly OPEX", "c_tdays_to_month_end": "days to month end",
    "c_is_fomc": "FOMC day", "x_tlt": "bonds (TLT) this morning", "x_tnx_bps": "10y yield change", "x_uup": "dollar this morning",
    "x_hyg": "high-yield credit this morning", "x_btc": "bitcoin overnight", "r20_z": "20-day trend", "r5_z": "5-day move",
    "prev_label_z": "yesterday's 10:30->close move", "s_fg": "CNN fear & greed",
    "r60_z": "60-day trend", "r120_z": "120-day trend", "r250_z": "1-year trend", "r1_z": "yesterday's return",
    "sma50_dist_z": "distance to 50-day average", "sma200_dist_z": "distance to 200-day average",
    "dd252": "drawdown from 1-year high", "rv5_rv20": "5d vs 20d realised vol", "rv20_pct": "realised vol percentile",
    "prev_close_loc": "where yesterday closed in its range", "prev_fh_z": "yesterday's first hour",
    "label_mean5_z": "last 5 afternoons (10:30->close)", "gap_mean5_z": "last 5 overnight gaps",
    "fh_range_z": "QQQ first-hour range", "fh_rel_mkt_z": "QQQ vs S&P this morning", "m_qqq_fh_clv": "QQQ first-hour close location",
    "m_mega_wavg_z": "top-10 holdings this morning", "m_spy_since_close_z": "S&P 500 since close",
    "v_vix_pct": "VIX 1-year percentile", "v_vix_chg_1d": "VIX change yesterday", "v_vvix": "VVIX", "own_rv_ratio": "QQQ realised vol / VIX",
    "f_cta_score_qqq": "multi-horizon trend score (CTA proxy)", "c_dow": "day of week", "c_tdays_to_opex": "days to monthly OPEX",
    "c_tdays_from_month_start": "days into the month", "c_is_pre_holiday": "day before a holiday", "c_is_quad": "quad witching",
    "x_ief": "7-10y Treasuries this morning", "x_lqd": "IG credit this morning", "x_gld": "gold this morning", "x_uso": "oil this morning",
    "x_hyg_lqd": "high-yield vs IG credit", "x_tlt_1d": "bonds yesterday", "x_hyg_1d": "high yield yesterday",
    "macro_hy_oas": "high-yield spread level", "macro_hy_oas_chg5": "high-yield spread 5d change", "macro_ig_oas_chg5": "IG spread 5d change",
    "macro_t10y2y": "2s10s curve", "macro_t10y3m": "3m10y curve", "macro_dgs10_chg5": "10y yield 5d change",
    "macro_usd_chg5": "broad dollar 5d change", "macro_nfci": "Chicago Fed financial conditions",
    "s_fg_chg5": "fear & greed 5d change", "s_aaii_spread": "AAII bull-bear spread", "s_aaii_spread_z": "AAII spread vs 1y",
    "s_gdelt_tone": "news tone (GDELT)", "s_gdelt_tone_z": "news tone vs 60d", "s_gdelt_vol_z": "news volume vs 60d",
}


def _fmt_pct(x, nd=2):
    return "n/a" if x is None or not np.isfinite(x) else f"{x:+.{nd}f}%"


def _hourly_ready(store: Store, ticker: str, cutoff: pd.Timestamp) -> bool:
    """True if the stored 60-minute bars already contain today's last full bar ending at or before `cutoff`."""
    b = store.read("intraday_60m", ticker)
    if b is None or b.empty:
        return False
    idx = pd.DatetimeIndex(b.index).tz_convert(config.TZ)
    past = idx[idx < cutoff.normalize()]
    if len(past) == 0:
        return False
    offset = int(pd.Series(past[-200:].minute).mode().iloc[0])          # the ticker's hourly grid (:30, :00, ...)
    last_end = cutoff.floor("h") + pd.Timedelta(minutes=offset)
    if last_end > cutoff:
        last_end -= pd.Timedelta(hours=1)
    return bool(((idx + pd.Timedelta(minutes=60)) == last_end).any())


def build_today(store: Store, now: pd.Timestamp, refresh: bool = True, minutes: dict | None = None) -> pd.DataFrame:
    from ..data import macro, sentiment_sources, yahoo
    today = now.normalize().tz_localize(None)
    if refresh:
        yahoo.update_daily(store, tickers=LIVE_DAILY)
        yahoo.update_intraday(store, tickers=LIVE_INTRADAY, interval="60m", period="5d")
        macro.update_fred(store)
        sentiment_sources.update_sentiment(store)
    if minutes is None:
        minutes = yahoo.fetch_today_minutes(LIVE_INTRADAY)
    # strict cutoff: drop any 1-minute bar that ends after the decision time
    cutoff = today.tz_localize(config.TZ) + pd.Timedelta(hours=config.DECISION_HOUR, minutes=config.DECISION_MINUTE)
    # Train/serve consistency: the model was trained on Yahoo 60-minute bars. 1-minute bars differ from them
    # (volume totals are not comparable, and instruments on an hourly grid such as ^VIX were only ever seen at
    # their last full hour). So whenever today's 60-minute bars up to 10:30 are already available, use them
    # and keep the 1-minute bars only as a fallback.
    minutes = {t: b for t, b in minutes.items() if not _hourly_ready(store, t, cutoff)}
    clean = {}
    for t, b in minutes.items():
        idx = pd.DatetimeIndex(b.index).tz_convert(config.TZ)
        b = b[(idx + pd.Timedelta(minutes=1)) <= cutoff]
        if len(b):
            clean[t] = b
    panel = build_panel(store, tickers=[config.TARGET], live_minutes=clean, asof_date=today)
    return panel, clean


def run_signal(store: Store | None = None, model_path: Path | None = None, now: pd.Timestamp | None = None,
               refresh: bool = True, context: bool = True, force: bool = False, minutes: dict | None = None,
               save: bool = True) -> dict:
    store = store or Store()
    now = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz=config.TZ)
    now = now.tz_localize(config.TZ) if now.tzinfo is None else now.tz_convert(config.TZ)
    today = now.normalize().tz_localize(None)
    decision_ts = now.normalize() + pd.Timedelta(hours=config.DECISION_HOUR, minutes=config.DECISION_MINUTE)
    warnings = []
    if today not in cal.trading_days():
        raise SystemExit(f"{today.date()} is not an NYSE trading day.")
    if now < decision_ts and not force:
        raise SystemExit(f"It is {now:%H:%M} ET: the first hour is not complete. Run at or after 10:30 ET (or use --force).")
    if now > decision_ts + pd.Timedelta(minutes=20):
        warnings.append(f"Running at {now:%H:%M} ET; the backtest assumes entry at 10:30. Features still only use bars up to 10:30.")

    model = FinalModel.load(model_path)
    panel, mins = build_today(store, now, refresh=refresh, minutes=minutes)
    key = (today, config.TARGET)
    if key not in panel.index:
        raise SystemExit("No first-hour data for QQQ today (feed down, or the market has not opened?).")
    X = panel.loc[[key]]
    dec = model.decide(X).iloc[0]
    contrib = model.explain(X).iloc[0]
    sigma = float(X["sigma"].iloc[0])
    to_bps = sigma * 1e4
    fam = family_contributions(contrib) * to_bps
    feats = contrib.drop("_base")
    top = feats.reindex(feats.abs().sort_values(ascending=False).index)[:8] * to_bps
    gw = model.gate_weights(X)
    row = X.iloc[0]

    # data completeness per family
    coverage = {f: float(X[c].notna().mean(axis=1).iloc[0]) for f, c in config.FAMILIES.items()}
    for f, cov in coverage.items():
        if cov < 0.5:
            warnings.append(f"{f}: only {100 * cov:.0f}% of inputs available today.")
    last_bar = mins.get(config.TARGET).index.max() if config.TARGET in mins else None
    if row.get("source") == "live":
        warnings.append("Yahoo's 60-minute bar for 09:30-10:30 was not available yet, so 1-minute bars were used. "
                        "First-hour volume features are not directly comparable with training; re-run in a few minutes.")
    if row.get("c_is_fomc") == 1:
        warnings.append("FOMC statement at 14:00 ET today: afternoon variance is much larger than usual.")
    if cal.is_half_day(today):
        warnings.append("Half day: the market closes at 13:00 ET.")

    pos = float(dec["position"])
    action = "LONG" if pos > 0 else "SHORT" if pos < 0 else "FLAT"
    tr = model.meta.get("track_record", {})
    status = tr.get("status", "unknown")
    out = {
        "date": str(today.date()), "generated_at": now.isoformat(timespec="seconds"),
        "action": action, "position": round(pos, 3),
        "p_up": round(float(dec["p_up"]), 3), "expected_bps": round(float(dec["exp_ret_bps"]), 1),
        "signal_z": round(float(dec["z"]), 2), "cost_bps": model.dcfg.cost_bps,
        "price_1030": float(row["fh_close"]), "sigma_daily": sigma,
        "morning": {"since_close": float(row["since_close_z"] * sigma * 100), "first_hour": float(row["fh_ret_z"] * sigma * 100),
                    "gap": float(row["gap_z"] * sigma * 100), "vix": float(row["v_vix"]) if np.isfinite(row["v_vix"]) else None},
        "families_bps": {k: round(float(v), 2) for k, v in fam.items()},
        "top_drivers_bps": {k: round(float(v), 2) for k, v in top.items()},
        "gate_weights": {k: round(float(v), 3) for k, v in gw.iloc[0].items()} if gw is not None else None,
        "regime": {"vix_pct": row.get("v_vix_pct"), "trend_score": row.get("f_cta_score_qqq"),
                   "rv_pct": row.get("m_qqq_rv20_pct")},
        "coverage": coverage, "last_minute_bar": str(last_bar) if last_bar is not None else None,
        "model": {"variant": model.variant, "trained_through": model.meta.get("last_date"), "status": status,
                  "holdout_sharpe": tr.get("holdout_sharpe"), "holdout_sharpe_ci90": tr.get("holdout_sharpe_ci90")},
        "warnings": warnings,
    }
    if context:
        out["context"] = live_context(store, decision_ts)
    if save:
        save_signal(out)
    return out


def live_context(store: Store, cutoff: pd.Timestamp) -> dict:
    ctx = {}
    try:
        from ..data import options
        ctx["gex"] = options.snapshot(store)
    except Exception as e:
        ctx["gex"] = None
        log.warning("GEX snapshot failed: %s", e)
    try:
        from ..data import news
        from ..sentiment.llm import aggregate, score_headlines
        items = news.collect(store, cutoff)
        scores, backend = score_headlines([i["title"] for i in items])
        ctx["news"] = {**aggregate(items, scores), "backend": backend}
    except Exception as e:
        ctx["news"] = None
        log.warning("news overlay failed: %s", e)
    return ctx


def save_signal(out: dict) -> None:
    d = config.SIGNAL_DIR
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{out['date']}.json").write_text(json.dumps(out, indent=1, default=lambda x: None if x != x else str(x)))
    log_path = d / "log.csv"
    row = pd.DataFrame([{"date": out["date"], "action": out["action"], "position": out["position"],
                         "p_up": out["p_up"], "expected_bps": out["expected_bps"], "price_1030": out["price_1030"],
                         "generated_at": out["generated_at"]}])
    if log_path.exists():
        old = pd.read_csv(log_path)
        row = pd.concat([old[old["date"] != out["date"]], row])
    row.sort_values("date").to_csv(log_path, index=False)


def format_signal(o: dict) -> str:
    L = []
    bar = "=" * 72
    L += [bar, f" QQQ 10:30 SIGNAL  {o['date']}   (model: {o['model']['variant']}, trained through {o['model']['trained_through']})", bar]
    size = abs(o["position"])
    L.append(f" DECISION   {o['action']:<5}  size {size:.2f}x   ->  enter now, exit market-on-close")
    L.append(f" confidence P(QQQ closes above 10:30 price) = {100 * o['p_up']:.1f}%")
    L.append(f" expected   {o['expected_bps']:+.1f} bps to the close (cost {o['cost_bps']:g} bps), signal {o['signal_z']:+.2f} sd")
    m = o["morning"]
    vix = f"{m['vix']:.1f}" if m.get("vix") else "n/a"
    L.append(f" morning    QQQ {o['price_1030']:.2f}: {_fmt_pct(m['since_close'])} since close "
             f"(gap {_fmt_pct(m['gap'])}, first hour {_fmt_pct(m['first_hour'])}), VIX {vix}")
    L.append("")
    L.append(" WHY (contribution to expected move, bps)")
    for k, v in o["families_bps"].items():
        if abs(v) >= 0.05:
            L.append(f"   {k:<16} {v:+7.2f}  " + ("+" * min(30, int(abs(v) * 2)) if v > 0 else "-" * min(30, int(abs(v) * 2))))
    L.append(" top inputs")
    for k, v in o["top_drivers_bps"].items():
        L.append(f"   {FEATURE_LABELS.get(k, k):<44} {v:+6.2f}   [{FEATURE_FAMILY.get(k, '')}]")
    if o.get("gate_weights"):
        gw = sorted(o["gate_weights"].items(), key=lambda kv: -kv[1])
        L.append(" regime gate  " + "  ".join(f"{k} {100 * v:.0f}%" for k, v in gw))
    ctx = o.get("context") or {}
    if ctx:
        L.append("")
        L.append(" LIVE CONTEXT (not in the model yet: no free history to validate it)")
        g = ctx.get("gex")
        if g:
            flip = f"{g['gamma_flip']:.1f}" if g.get("gamma_flip") else "none in +/-6%"
            L.append(f"   dealer gamma ~ ${g['gex_usd_per_1pct'] / 1e9:+.2f}bn per 1% ({g['regime']}); flip {flip}; "
                     f"call wall {g.get('call_wall')}, put wall {g.get('put_wall')}")
        n = ctx.get("news")
        if n and n.get("n"):
            L.append(f"   news ({n['n']} headlines before 10:30, {n['backend']}): tone {n['tone']:+.2f}, "
                     f"{100 * n['share_negative']:.0f}% negative")
            for t in n.get("top", [])[:3]:
                L.append(f"     {t['score']:+.2f}  {t['title'][:90]}")
    mm = o["model"]
    L.append("")
    if mm.get("holdout_sharpe") is not None:
        ci = mm.get("holdout_sharpe_ci90") or [None, None]
        L.append(f" track record: holdout Sharpe {mm['holdout_sharpe']:.2f} (90% CI {ci[0]:.2f} to {ci[1]:.2f}); status: {mm['status']}")
    for w in o["warnings"]:
        L.append(f" ! {w}")
    L.append(bar)
    return "\n".join(L)


def reconcile(store: Store | None = None) -> pd.DataFrame:
    """Fill in realised 10:30->close outcomes for logged live signals (run after the close)."""
    store = store or Store()
    p = config.SIGNAL_DIR / "log.csv"
    if not p.exists():
        raise SystemExit("no signals logged yet")
    log_df = pd.read_csv(p)
    daily = store.read("daily", config.TARGET)
    cost = FinalModel.load().dcfg.cost_bps if (config.MODEL_DIR / "latest.joblib").exists() else 2.0
    closes = daily["close"] if daily is not None else pd.Series(dtype=float)
    log_df["close"] = [closes.get(pd.Timestamp(d), np.nan) for d in log_df["date"]]
    log_df["ret_1030_close"] = log_df["close"] / log_df["price_1030"] - 1
    log_df["net"] = log_df["position"] * log_df["ret_1030_close"] - log_df["position"].abs() * cost / 1e4
    log_df.to_csv(p, index=False)
    return log_df
