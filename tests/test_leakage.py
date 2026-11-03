"""The most important tests in the repo: nothing after 10:30 on day D may move D's features."""
import numpy as np
import pandas as pd
import pytest

from futuremodel import config
from futuremodel.data.store import Store
from futuremodel.features.build import build_panel

FEATS = config.ALL_FEATURES + config.GATE_FEATURES


def _copy_store(src: Store, dst) -> Store:
    import shutil
    shutil.copytree(src.root, dst)
    return Store(dst)


def _assert_same(a: pd.DataFrame, b: pd.DataFrame):
    a, b = a[FEATS].astype(float), b[FEATS].astype(float)
    diff = (a - b).abs()
    bad = diff.where(~(a.isna() & b.isna())).gt(1e-9) | (a.isna() != b.isna())
    cols = bad.any()
    assert not cols.any(), f"features changed: {list(cols[cols].index)}"


@pytest.mark.parametrize("which", ["after_1030_same_day", "all_future_days"])
def test_future_data_cannot_change_features(signal_store, tmp_path, which):
    base = build_panel(signal_store)
    dates = base.index.get_level_values("date").unique()
    D = dates[len(dates) // 2]
    st = _copy_store(signal_store, tmp_path / "s")
    for kind in ("intraday_60m", "daily"):
        for name in st.names(kind):
            df = st.read(kind, name)
            if kind == "daily":
                m = (df.index == D) if which == "after_1030_same_day" else (df.index >= D)
                if which == "all_future_days":
                    m = df.index > D
                    df.loc[m, ["open", "high", "low", "close", "adj_close"]] *= 1.37
                else:
                    df.loc[m, ["close", "adj_close", "high"]] *= 1.05
                    df.loc[m, "volume"] *= 3
            else:
                idx = pd.DatetimeIndex(df.index).tz_convert(config.TZ)
                day = idx.tz_localize(None).normalize()
                end = idx + pd.Timedelta(minutes=60)
                cutoff = (pd.Timestamp(D) + pd.Timedelta(hours=10, minutes=30)).tz_localize(config.TZ)
                if which == "after_1030_same_day":
                    m = (day == D) & (end > cutoff)
                else:
                    m = day > D
                df.loc[m, ["open", "high", "low", "close"]] *= 1.21
                df.loc[m, "volume"] *= 5
            st.write(kind, name, df)
    pert = build_panel(st)
    a = base.xs(D, level="date")
    b = pert.xs(D, level="date")
    _assert_same(a, b)
    if which == "after_1030_same_day":
        # the label for D must change, otherwise the perturbation did nothing
        assert not np.allclose(a["y"], b["y"])


def test_null_data_has_no_edge(null_store):
    """With pure-noise afternoons the out-of-sample forecasts must be uninformative."""
    from futuremodel.backtest.walkforward import run_walkforward
    from futuremodel.backtest.metrics import information_coefficient
    panel = build_panel(null_store)
    wf = run_walkforward(panel, config.ModelConfig(num_boost_round=60),
                         config.BacktestConfig(min_train_days=120, refit_every=42), variants=["gated", "ridge"],
                         progress=False)
    oof = wf["oof"]
    yz = wf["panel"].loc[oof.index, "y_z"]
    for v in ("gated", "ridge", "generalist"):
        ic = information_coefficient(oof[v], yz)
        assert abs(ic) < 0.04, (v, ic)
