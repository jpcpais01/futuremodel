"""End-to-end jobs shared by the CLI: backtest (walk-forward + report) and train (final model)."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .backtest.report import evaluate, write_report
from .backtest.walkforward import run_walkforward, causal_decisions
from .backtest.metrics import summarize
from .config import BacktestConfig, DecisionConfig, ModelConfig
from .data.store import Store
from .features.build import build_panel
from .model.bundle import FinalModel

log = logging.getLogger(__name__)


def data_summary(panel: pd.DataFrame) -> dict:
    lab = panel[panel["y_z"].notna()]
    d = lab.index.get_level_values("date")
    q = lab.xs(config.TARGET, level="ticker")
    cov = {f: f"{100 * lab[c].notna().mean().mean():.0f}%" for f, c in config.FAMILIES.items()}
    return {"labelled dates": f"{d.nunique()} ({d.min().date()} -> {d.max().date()})",
            "QQQ labelled days": len(q), "tickers pooled": lab.index.get_level_values("ticker").nunique(),
            "rows (date x ticker)": len(lab),
            "intraday sources": ", ".join(f"{k}: {v}" for k, v in lab["source"].value_counts().items()),
            "feature coverage by family": ", ".join(f"{k} {v}" for k, v in cov.items())}


def permutation_test(panel: pd.DataFrame, variant: str, real_sharpe: float, n: int, mcfg, bcfg, dcfg,
                     seed: int = 0) -> dict:
    """Shuffle the label *by date* (all tickers keep their cross-section), rerun everything."""
    rng = np.random.default_rng(seed)
    lab = panel[panel["y_z"].notna()]
    dates = lab.index.get_level_values("date").unique()
    sharpes = []
    for i in range(n):
        perm = dict(zip(dates, rng.permutation(dates)))
        shuffled = lab.copy()
        src = lab[["y", "y_z"]]
        new_idx = pd.MultiIndex.from_arrays([[perm[d] for d in lab.index.get_level_values("date")],
                                             lab.index.get_level_values("ticker")])
        vals = src.reindex(new_idx)
        shuffled["y"], shuffled["y_z"] = vals["y"].to_numpy(), vals["y_z"].to_numpy()
        wf = run_walkforward(shuffled, mcfg, bcfg, dcfg, variants=[variant], progress=False)
        r = causal_decisions(wf, variant)
        sharpes.append(summarize(r["net"], r["position"], None, 0).get("sharpe", 0.0))
        log.info("permutation %d/%d: Sharpe %.2f", i + 1, n, sharpes[-1])
    sh = np.array(sharpes)
    return {"n": n, "sharpes": sh.tolist(), "p_value": float((1 + (sh >= real_sharpe).sum()) / (n + 1))}


def backtest(store: Store | None = None, mcfg: ModelConfig | None = None, bcfg: BacktestConfig | None = None,
             dcfg: DecisionConfig | None = None, out_dir: Path | None = None, synthetic: bool = False,
             panel: pd.DataFrame | None = None) -> dict:
    mcfg, bcfg, dcfg = mcfg or ModelConfig(), bcfg or BacktestConfig(), dcfg or DecisionConfig()
    panel = panel if panel is not None else build_panel(store or Store())
    log.info("panel: %s rows, %s features", len(panel), len(config.ALL_FEATURES))
    wf = run_walkforward(panel, mcfg, bcfg, dcfg)
    res = evaluate(wf, n_boot=bcfg.n_bootstrap)
    if bcfg.n_permutations > 0:
        real = res["variants"][res["chosen"]]["all"]["sharpe"]
        res["permutation"] = permutation_test(panel, res["chosen"], real, bcfg.n_permutations, mcfg, bcfg, dcfg)
    md = write_report(wf, res, out_dir, meta=data_summary(panel), synthetic=synthetic)
    log.info("report written to %s", md)
    return {"wf": wf, "res": res, "panel": panel, "report": md}


def track_record(res: dict) -> dict:
    ch = res["chosen"]
    h = res["variants"][ch]["holdout"]
    d = res["variants"][ch]["dev"]
    lo, hi = h.get("sharpe_ci90", (np.nan, np.nan))
    if not h:
        status = "no holdout"
    elif lo > 0:
        status = "edge supported on holdout (still small sample)"
    elif h["sharpe"] > 0:
        status = "PAPER TRADE: positive but not significant on holdout"
    else:
        status = "DO NOT TRADE: no out-of-sample edge on holdout"
    return {"variant": ch, "dev_sharpe": d.get("sharpe"), "holdout_sharpe": h.get("sharpe"),
            "holdout_sharpe_ci90": [lo, hi], "holdout_days": h.get("days"), "status": status,
            "periods": res["periods"]}


def train(store: Store | None = None, mcfg: ModelConfig | None = None, bcfg: BacktestConfig | None = None,
          dcfg: DecisionConfig | None = None, out_dir: Path | None = None, model_path: Path | None = None,
          synthetic: bool = False) -> dict:
    """Backtest (needed for OOF forecasts, variant choice and the track record), then fit the final model."""
    bt = backtest(store, mcfg, bcfg, dcfg, out_dir, synthetic)
    res, wf, panel = bt["res"], bt["wf"], bt["panel"]
    model = FinalModel(res["chosen"], wf["mcfg"], wf["dcfg"]).fit(panel, wf, track_record(res))
    path = model.save(model_path)
    log.info("final model (%s) saved to %s", res["chosen"], path)
    return {**bt, "model": model, "model_path": path}
