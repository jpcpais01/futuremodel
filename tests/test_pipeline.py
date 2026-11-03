"""End-to-end on synthetic data: train, then the live 10:30 path must reproduce the historical
feature row exactly from 1-minute bars."""
import numpy as np
import pandas as pd

from futuremodel import config
from futuremodel.data.store import Store
from futuremodel.features.build import build_panel


def _minutes_from_first_hour(bars60: pd.DataFrame, day: pd.Timestamp) -> pd.DataFrame:
    idx = pd.DatetimeIndex(bars60.index).tz_convert(config.TZ)
    first = bars60[(idx.tz_localize(None).normalize() == day) & (idx.hour == 9) & (idx.minute == 30)].iloc[0]
    t = pd.date_range(day + pd.Timedelta(hours=9, minutes=30), periods=60, freq="1min").tz_localize(config.TZ)
    path = np.linspace(first["open"], first["close"], 61)
    o, c = path[:-1], path[1:]
    h, l = np.maximum(o, c), np.minimum(o, c)
    h[20], l[40] = first["high"], first["low"]
    return pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": first["volume"] / 60}, index=t)


def test_train_and_live_signal(signal_store, tmp_path, monkeypatch):
    from futuremodel.live import signal as live
    from futuremodel.pipeline import train
    monkeypatch.setattr(config, "SIGNAL_DIR", tmp_path / "signals")
    out = train(signal_store, config.ModelConfig(num_boost_round=80),
                config.BacktestConfig(min_train_days=120, refit_every=42, n_bootstrap=100), config.DecisionConfig(),
                out_dir=tmp_path / "rep", model_path=tmp_path / "m.joblib", synthetic=True)
    res = out["res"]
    assert (tmp_path / "rep" / "backtest.md").exists()
    assert res["ic"][res["chosen"]]["pooled"] > 0.05          # planted effect is found

    hist = out["panel"]
    day = hist.index.get_level_values("date").max()
    minutes = {}
    for t in live.LIVE_INTRADAY:
        b = signal_store.read("intraday_60m", t)
        if b is not None and t != "BTC-USD":
            minutes[t] = _minutes_from_first_hour(b, day)
    now = (day + pd.Timedelta(hours=10, minutes=31)).tz_localize(config.TZ)
    sig = live.run_signal(signal_store, model_path=tmp_path / "m.joblib", now=now, refresh=False, context=False,
                          minutes=minutes, save=True)
    assert sig["action"] in ("LONG", "SHORT", "FLAT")
    assert -1 <= sig["position"] <= 1 and 0 < sig["p_up"] < 1
    assert (tmp_path / "signals" / "log.csv").exists()
    text = live.format_signal(sig)
    assert "DECISION" in text

    # live features (1-minute bars, today's daily row hidden) == historical features (60-minute bars)
    lp, _ = live.build_today(signal_store, now, refresh=False, minutes=minutes)
    a = lp.loc[(day, config.TARGET), config.ALL_FEATURES].astype(float)
    b = hist.loc[(day, config.TARGET), config.ALL_FEATURES].astype(float)
    both = a.notna() & b.notna()
    assert (a.isna() == b.isna()).all(), list(a.index[a.isna() != b.isna()])
    assert both.sum() > 0.8 * len(config.ALL_FEATURES) - 10, both.sum()
    np.testing.assert_allclose(a[both], b[both], rtol=1e-6, atol=1e-6)
