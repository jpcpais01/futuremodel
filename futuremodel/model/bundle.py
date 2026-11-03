"""Final model: trained on all labelled data, with gate and calibration fit on walk-forward OOF
forecasts. Saved as one joblib file the live signal loads."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .. import config
from ..config import DecisionConfig, ModelConfig
from .ensemble import Calibrator, Experts, Gate, ResidualSpecialist, RidgeModel, decide

FEATURE_FAMILY = {}
for fam, feats in config.FAMILIES.items():
    for f in feats:
        FEATURE_FAMILY.setdefault(f, fam)


class FinalModel:
    def __init__(self, variant: str, mcfg: ModelConfig, dcfg: DecisionConfig):
        self.variant, self.mcfg, self.dcfg = variant, mcfg, dcfg
        self.meta: dict = {}

    # ------------------------------------------------------------------ training
    def fit(self, panel: pd.DataFrame, wf: dict, track_record: dict | None = None) -> "FinalModel":
        lab = panel[panel["y_z"].notna()]
        oof = wf["oof"]
        names = wf["expert_names"]
        ok = oof[names].notna().all(axis=1)
        past = oof[ok]
        y_past = lab.loc[past.index, "y_z"].clip(-self.mcfg.target_clip, self.mcfg.target_clip).to_numpy()
        from .ensemble import sample_weights
        w_past = sample_weights(past.index, self.mcfg)
        Z_past = lab.loc[past.index]
        tq = past.index.get_level_values("ticker") == config.TARGET

        self.experts = Experts(self.mcfg).fit(lab) if self.variant != "ridge" else None
        self.gate = None
        self.residual = None
        self.ridge = None
        if self.variant in ("gated", "gated_spec"):
            self.gate = Gate(names, l2=self.mcfg.gate_l2).fit(past[names], Z_past, y_past, w_past)
        elif self.variant == "equal":
            self.gate = Gate(names, l2=self.mcfg.gate_l2).fit(past[names], Z_past, y_past, w_past, equal_only=True)
        elif self.variant == "ridge":
            self.ridge = RidgeModel(self.mcfg).fit(lab)

        # forecasts of the target on OOF history -> calibrator
        if self.variant in ("gated", "gated_spec", "equal"):
            hist = self.gate.predict(past[names][tq], Z_past[tq])
            if self.variant == "gated_spec":
                Xq = lab.loc[past.index[tq]]
                self.residual = ResidualSpecialist(self.mcfg).fit(Xq, y_past[tq], hist)
                hist = hist + self.residual.predict(Xq)
        elif self.variant == "generalist_only":
            hist = past.loc[tq, "generalist"].to_numpy()
        else:
            hist = oof.loc[past.index[tq], "ridge"].to_numpy()
        self.calibrator = Calibrator().fit(hist, lab.loc[past.index[tq], "y_z"].to_numpy())
        self.meta = {"variant": self.variant, "trained_at": datetime.now().isoformat(timespec="seconds"),
                     "train_rows": int(len(lab)), "train_dates": int(lab.index.get_level_values("date").nunique()),
                     "first_date": str(lab.index.get_level_values("date").min().date()),
                     "last_date": str(lab.index.get_level_values("date").max().date()),
                     "tickers": sorted(lab.index.get_level_values("ticker").unique()),
                     "signal_std": self.calibrator.std, "track_record": track_record or {}}
        return self

    # ------------------------------------------------------------------ inference
    def forecast(self, X: pd.DataFrame) -> np.ndarray:
        if self.variant == "ridge":
            return self.ridge.predict(X)
        P = self.experts.predict(X)
        if self.variant == "generalist_only":
            return P["generalist"].to_numpy()
        f = self.gate.predict(P, X)
        if self.residual is not None:
            q = X.index.get_level_values("ticker") == config.TARGET
            f = f.copy()
            f[q] = f[q] + self.residual.predict(X[q])
        return f

    def gate_weights(self, X: pd.DataFrame) -> pd.DataFrame | None:
        if self.gate is None:
            return None
        return pd.DataFrame(self.gate.weights(X[self.gate.regime].to_numpy(float)), index=X.index, columns=self.gate.names)

    def explain(self, X: pd.DataFrame) -> pd.DataFrame:
        """Additive per-feature contributions to the final forecast (vol units); sums to forecast."""
        if self.variant == "ridge":
            return self.ridge.contrib(X)
        parts = {n: e.contrib(X) for n, e in self.experts.experts.items()}
        if self.variant == "generalist_only":
            return parts["generalist"]
        W = self.gate_weights(X)
        total = pd.DataFrame(0.0, index=X.index, columns=config.ALL_FEATURES + ["_base"])
        for n, c in parts.items():
            scaled = c.mul(W[n].to_numpy() * self.gate.s, axis=0)
            total = total.add(scaled.reindex(columns=total.columns, fill_value=0.0), fill_value=0.0)
        total["_base"] += self.gate.b
        if self.residual is not None:
            q = X.index.get_level_values("ticker") == config.TARGET
            rc = self.residual.expert.contrib(X)
            rc.loc[~q] = 0.0
            rc = rc.drop(columns="_base")
            total = total.add(rc.reindex(columns=total.columns, fill_value=0.0), fill_value=0.0)
        return total

    def decide(self, X: pd.DataFrame) -> pd.DataFrame:
        f = self.forecast(X)
        pos, er, z = decide(f, X["sigma"].to_numpy(), self.calibrator, self.dcfg)
        return pd.DataFrame({"forecast": f, "position": pos, "exp_ret_bps": er * 1e4, "z": z,
                             "p_up": self.calibrator.p_up(f)}, index=X.index)

    # ------------------------------------------------------------------ io
    def save(self, path: Path | None = None) -> Path:
        path = Path(path or config.MODEL_DIR / "latest.joblib")
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)
        (path.with_suffix(".json")).write_text(json.dumps(self.meta, indent=1, default=str))
        return path

    @staticmethod
    def load(path: Path | None = None) -> "FinalModel":
        path = Path(path or config.MODEL_DIR / "latest.joblib")
        if not path.exists():
            raise FileNotFoundError(f"{path} not found. Run `fm train` first.")
        return joblib.load(path)


def family_contributions(contrib_row: pd.Series) -> pd.Series:
    fam = {}
    for f, v in contrib_row.items():
        if f == "_base":
            continue
        k = FEATURE_FAMILY.get(f, "other")
        fam[k] = fam.get(k, 0.0) + float(v)
    return pd.Series(fam).sort_values(key=np.abs, ascending=False)
