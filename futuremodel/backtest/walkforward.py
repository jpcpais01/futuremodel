"""Strict walk-forward evaluation.

Timeline (expanding window, refit every `refit_every` trading days):

  |--- train (pooled universe) ---|emb|--- predict next block ---| ... |=== HOLDOUT ===|

  * Experts at fold f are trained only on dates before the fold (minus an embargo day).
  * The gate and calibrator at fold f are fit only on *out-of-fold* expert forecasts from
    earlier folds, so every number in the report is genuinely out of sample.
  * The last `holdout_frac` of dates is the holdout. Variant selection (gate vs equal weights vs
    generalist, specialisation on/off) uses the development period only; the holdout is then
    reported once.
"""
from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd

from .. import config
from ..config import BacktestConfig, DecisionConfig, ModelConfig
from ..model.ensemble import Calibrator, Experts, Gate, ResidualSpecialist, RidgeModel, decide, sample_weights

log = logging.getLogger(__name__)

VARIANTS = ["gated", "equal", "generalist_only", "gated_spec", "ridge"]


def _set(df: pd.DataFrame, idx, cols, values) -> None:
    """Positional assignment (fast, and safe with MultiIndex row keys)."""
    rows = df.index.get_indexer(idx)
    cols = [cols] if isinstance(cols, str) else list(cols)
    df.iloc[rows, [df.columns.get_loc(c) for c in cols]] = np.asarray(values, float).reshape(len(rows), len(cols))


def _ridge_fit_predict(train: pd.DataFrame, test: pd.DataFrame, cfg: ModelConfig) -> np.ndarray:
    return RidgeModel(cfg).fit(train).predict(test)


def run_walkforward(panel: pd.DataFrame, mcfg: ModelConfig | None = None, bcfg: BacktestConfig | None = None,
                    dcfg: DecisionConfig | None = None, variants: list[str] | None = None,
                    progress: bool = True) -> dict:
    mcfg, bcfg, dcfg = mcfg or ModelConfig(), bcfg or BacktestConfig(), dcfg or DecisionConfig()
    variants = variants or VARIANTS
    lab = panel[panel["y_z"].notna()]
    dates = pd.DatetimeIndex(sorted(lab.index.get_level_values("date").unique()))
    if len(dates) < bcfg.min_train_days + 2 * bcfg.refit_every:
        raise ValueError(f"only {len(dates)} labelled dates; need > {bcfg.min_train_days + 2 * bcfg.refit_every}")
    holdout_start = dates[int(len(dates) * (1 - bcfg.holdout_frac))]
    fold_starts = list(dates[bcfg.min_train_days::bcfg.refit_every])
    d_all = lab.index.get_level_values("date")

    expert_names = list(config.FAMILIES) + (["generalist"] if mcfg.use_generalist else [])
    oof = pd.DataFrame(index=lab.index[d_all >= fold_starts[0]], columns=expert_names + variants, dtype=float)
    oof_dates = oof.index.get_level_values("date")
    tq_index = oof.index[oof.index.get_level_values("ticker") == config.TARGET]
    dec = pd.DataFrame(index=tq_index, columns=[f"{k}_{v}" for v in variants for k in ("pos", "er", "z", "pup")], dtype=float)
    gate_log, fold_log = [], []
    t0 = time.time()
    for i, fs in enumerate(fold_starts):
        fe = fold_starts[i + 1] if i + 1 < len(fold_starts) else dates[-1] + pd.Timedelta(days=1)
        emb_cut = dates[max(0, dates.searchsorted(fs) - bcfg.embargo_days)]
        train = lab[d_all < emb_cut]
        test_mask = (oof_dates >= fs) & (oof_dates < fe)
        test = lab.loc[oof.index[test_mask]]
        if test.empty:
            continue
        ex = Experts(mcfg).fit(train)
        P = ex.predict(test)
        _set(oof, test.index, expert_names, P.to_numpy())

        past = oof[(oof_dates < emb_cut) & oof[expert_names].notna().all(axis=1)]
        n_past_dates = past.index.get_level_values("date").nunique()
        y_past = lab.loc[past.index, "y_z"].clip(-mcfg.target_clip, mcfg.target_clip).to_numpy()
        w_past = sample_weights(past.index, mcfg)
        Z_past, Z_test = lab.loc[past.index], test
        ready = n_past_dates >= mcfg.gate_min_dates
        g = Gate(expert_names, l2=mcfg.gate_l2)
        ge = Gate(expert_names, l2=mcfg.gate_l2)
        if ready:
            g.fit(past[expert_names], Z_past, y_past, w_past)
            ge.fit(past[expert_names], Z_past, y_past, w_past, equal_only=True)
        # (warm-up folds keep equal weights / unit scale and are excluded from evaluation)
        qpast = past[past.index.get_level_values("ticker") == config.TARGET]
        qtest = test.index.get_level_values("ticker") == config.TARGET
        fc_test, fc_past = {}, {}
        if "gated" in variants:
            fc_test["gated"] = g.predict(P, Z_test)
            fc_past["gated"] = g.predict(qpast[expert_names], lab.loc[qpast.index]) if len(qpast) else np.array([])
        if "equal" in variants:
            fc_test["equal"] = ge.predict(P, Z_test)
            fc_past["equal"] = ge.predict(qpast[expert_names], lab.loc[qpast.index]) if len(qpast) else np.array([])
        if "generalist_only" in variants and "generalist" in P:
            fc_test["generalist_only"] = P["generalist"].to_numpy()
            fc_past["generalist_only"] = qpast["generalist"].to_numpy()
        if "ridge" in variants:
            fc_test["ridge"] = _ridge_fit_predict(train, test, mcfg)
            fc_past["ridge"] = oof.loc[qpast.index, "ridge"].to_numpy()
        if "gated_spec" in variants:
            spec = g.predict(P, Z_test).copy()
            spec_past = g.predict(qpast[expert_names], lab.loc[qpast.index]) if len(qpast) else np.array([])
            if ready and len(qpast) >= 60:
                yq = lab.loc[qpast.index, "y_z"].clip(-mcfg.target_clip, mcfg.target_clip).to_numpy()
                rs = ResidualSpecialist(mcfg).fit(lab.loc[qpast.index], yq, spec_past)
                spec[qtest] = spec[qtest] + rs.predict(test[qtest])
                spec_past = spec_past + rs.predict(lab.loc[qpast.index])
            fc_test["gated_spec"], fc_past["gated_spec"] = spec, spec_past
        for v, fc in fc_test.items():
            _set(oof, test.index, v, fc)
        # causal decision layer for the target: calibrated only on forecasts of past dates
        if ready and len(qpast) >= 40:
            yq_past = lab.loc[qpast.index, "y_z"].to_numpy()
            tq = test[qtest]
            for v in fc_test:
                fp = np.asarray(fc_past[v], float)
                ok = np.isfinite(fp)
                if ok.sum() < 40:
                    continue
                cal_v = Calibrator().fit(fp[ok], yq_past[ok])
                pos, er, z = decide(fc_test[v][qtest], tq["sigma"].to_numpy(), cal_v, dcfg)
                _set(dec, tq.index, [f"pos_{v}", f"er_{v}", f"z_{v}", f"pup_{v}"],
                     np.column_stack([pos, er * 1e4, z, cal_v.p_up(fc_test[v][qtest])]))
            W = g.weights(Z_test[g.regime].to_numpy(float))
            for d, wrow in zip(test.index.get_level_values("date")[qtest], W[qtest]):
                gate_log.append({"date": d, **dict(zip(expert_names, wrow))})
        fold_log.append({"fold": i, "start": fs, "train_rows": len(train), "train_dates": train.index.get_level_values("date").nunique(),
                         "test_dates": test.index.get_level_values("date").nunique(),
                         "gate_ready": bool(ready and len(qpast) >= 40)})
        if progress:
            log.info("fold %2d/%d  %s  train=%d rows  gate=%s  (%.0fs)", i + 1, len(fold_starts), fs.date(), len(train),
                     "fit" if ready else "warm-up", time.time() - t0)

    # first date where the gate/calibrator had enough OOF history
    ready_folds = [f for f in fold_log if f["gate_ready"]]
    eval_start = ready_folds[0]["start"] if ready_folds else holdout_start
    return {"oof": oof, "dec": dec, "panel": lab, "expert_names": expert_names, "variants": variants,
            "eval_start": eval_start, "holdout_start": holdout_start, "folds": pd.DataFrame(fold_log),
            "gate_log": pd.DataFrame(gate_log).set_index("date") if gate_log else pd.DataFrame(),
            "mcfg": mcfg, "bcfg": bcfg, "dcfg": dcfg}


def causal_decisions(wf: dict, variant: str) -> pd.DataFrame:
    """Daily target-ticker record for one variant: forecast, position, realised return, net P&L."""
    lab, dcfg = wf["panel"], wf["dcfg"]
    dec = wf["dec"]
    idx = dec.index
    out = pd.DataFrame({
        "forecast": wf["oof"].loc[idx, variant].to_numpy(),
        "position": dec[f"pos_{variant}"].fillna(0).to_numpy(),
        "exp_ret_bps": dec[f"er_{variant}"].to_numpy(),
        "z": dec[f"z_{variant}"].to_numpy(),
        "p_up": dec[f"pup_{variant}"].to_numpy(),
        "y": lab.loc[idx, "y"].to_numpy(), "y_z": lab.loc[idx, "y_z"].to_numpy(),
        "sigma": lab.loc[idx, "sigma"].to_numpy(),
    }, index=idx.get_level_values("date"))
    out["ret"] = np.expm1(out["y"])
    out["gross"] = out["position"] * out["ret"]
    out["net"] = out["gross"] - out["position"].abs() * dcfg.cost_bps / 1e4
    out["sign_net"] = np.sign(out["forecast"]) * out["ret"] - dcfg.cost_bps / 1e4   # always-in-the-market variant
    return out[out.index >= wf["eval_start"]]
