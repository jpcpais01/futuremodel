"""Regime-gated mixture of specialists.

  * One LightGBM *specialist* per feature family (first hour, vol/options, flows/calendar, price
    context, cross-asset/macro, sentiment) plus an optional *generalist* on every feature.
  * All experts are pretrained on the pooled universe (~38 liquid ETFs and megacaps, same
    10:30 -> close setup, targets in units of each ticker's own volatility), QQQ rows up-weighted.
  * A *gate* turns each expert's out-of-fold forecast into a combined forecast, with weights that
    move with the regime (VIX percentile, realised-vol percentile, trend, size of the morning move):
        w(regime) = softmax(a + B @ regime),  forecast = s * sum_k w_k * expert_k + b
    The gate is fit only on out-of-fold expert forecasts, heavily shrunk towards equal weights.
  * Optional QQQ *specialisation*: a tiny residual booster on QQQ rows only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from .. import config
from ..config import ModelConfig


def _lgb():
    import lightgbm as lgb
    return lgb


def sample_weights(index: pd.MultiIndex, cfg: ModelConfig) -> np.ndarray:
    tick = index.get_level_values("ticker")
    w = np.where(tick == config.TARGET, cfg.target_weight, 1.0)
    if cfg.half_life_days and cfg.half_life_days > 0:
        d = index.get_level_values("date")
        age = (d.max() - d).days.to_numpy()
        w = w * 0.5 ** (age / cfg.half_life_days)
    return w


class Expert:
    def __init__(self, name: str, features: list[str], cfg: ModelConfig, rounds: int | None = None,
                 params: dict | None = None):
        self.name, self.features, self.cfg = name, list(features), cfg
        self.rounds = rounds or cfg.num_boost_round
        self.params = params or cfg.lgb_params
        self.booster = None
        self.const = 0.0

    def fit(self, X: pd.DataFrame, y: np.ndarray, w: np.ndarray, init: np.ndarray | None = None) -> "Expert":
        Xf = X[self.features]
        usable = Xf.notna().mean() > 0.05
        self.used = list(Xf.columns[usable])
        if len(self.used) == 0:
            self.booster, self.const = None, float(np.average(y, weights=w))
            return self
        lgb = _lgb()
        ds = lgb.Dataset(Xf[self.used].to_numpy(np.float32), label=y, weight=w, init_score=init,
                         feature_name=self.used, free_raw_data=True)
        self.booster = lgb.train(self.params, ds, num_boost_round=self.rounds)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.booster is None:
            return np.full(len(X), self.const)
        return self.booster.predict(X[self.used].to_numpy(np.float32))

    def contrib(self, X: pd.DataFrame) -> pd.DataFrame:
        """Per-feature additive contributions (TreeSHAP); last column is the base value."""
        if self.booster is None:
            return pd.DataFrame({"_base": np.full(len(X), self.const)}, index=X.index)
        c = self.booster.predict(X[self.used].to_numpy(np.float32), pred_contrib=True)
        return pd.DataFrame(c, index=X.index, columns=self.used + ["_base"])


class Experts:
    def __init__(self, cfg: ModelConfig, families: dict[str, list[str]] | None = None):
        self.cfg = cfg
        self.families = families or config.FAMILIES
        self.experts: dict[str, Expert] = {n: Expert(n, f, cfg) for n, f in self.families.items()}
        if cfg.use_generalist:
            self.experts["generalist"] = Expert("generalist", config.ALL_FEATURES, cfg)

    @property
    def names(self) -> list[str]:
        return list(self.experts)

    def fit(self, panel: pd.DataFrame) -> "Experts":
        tr = panel[panel["y_z"].notna()]
        y = tr["y_z"].clip(-self.cfg.target_clip, self.cfg.target_clip).to_numpy()
        w = sample_weights(tr.index, self.cfg)
        for e in self.experts.values():
            e.fit(tr, y, w)
        return self

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame({n: e.predict(X) for n, e in self.experts.items()}, index=X.index)


class Gate:
    """Softmax mixture-of-experts gate driven by regime variables, fit by penalised least squares."""

    def __init__(self, names: list[str], regime: list[str] | None = None, l2: float = 3.0):
        self.names = list(names)
        self.regime = list(regime or config.GATE_FEATURES)
        self.l2 = l2
        K, R = len(self.names), len(self.regime)
        self.a = np.zeros(K)
        self.B = np.zeros((R, K))
        self.s, self.b = 1.0, 0.0
        self.fitted = False

    def weights(self, Z: np.ndarray) -> np.ndarray:
        logits = self.a[None, :] + Z @ self.B
        logits -= logits.max(axis=1, keepdims=True)
        e = np.exp(logits)
        return e / e.sum(axis=1, keepdims=True)

    def predict(self, P: pd.DataFrame, Zdf: pd.DataFrame) -> np.ndarray:
        W = self.weights(Zdf[self.regime].to_numpy(float))
        return self.s * (W * P[self.names].to_numpy(float)).sum(axis=1) + self.b

    def fit(self, P: pd.DataFrame, Zdf: pd.DataFrame, y: np.ndarray, w: np.ndarray, equal_only: bool = False) -> "Gate":
        X = P[self.names].to_numpy(float)
        Z = Zdf[self.regime].to_numpy(float)
        K, R = len(self.names), len(self.regime)
        w = w / w.sum()
        # scale X so the l2 penalty means the same thing whatever the experts' spread is
        m = X.mean(axis=1)
        mc, yc = m - np.average(m, weights=w), y - np.average(y, weights=w)
        vm = np.average(mc ** 2, weights=w)
        s0 = max(np.average(mc * yc, weights=w) / vm, 0.0) if vm > 0 else 0.0

        def unpack(th):
            a = th[:K]
            B = th[K:K + R * K].reshape(R, K) if not equal_only else np.zeros((R, K))
            s = np.log1p(np.exp(th[-2]))
            return a, B, s, th[-1]

        def loss(th):
            a, B, s, b = unpack(th)
            lg = a[None, :] + Z @ B
            lg -= lg.max(axis=1, keepdims=True)
            e = np.exp(lg)
            W = e / e.sum(axis=1, keepdims=True)
            pred = s * (W * X).sum(axis=1) + b
            return np.sum(w * (y - pred) ** 2) + self.l2 * 1e-3 * (np.sum(a ** 2) + np.sum(B ** 2))

        n_par = K + (0 if equal_only else R * K) + 2
        th0 = np.zeros(n_par)
        th0[-2] = np.log(np.expm1(max(s0, 1e-3)))
        if equal_only:
            # only the scale and bias are free
            def loss_eq(th2):
                full = np.zeros(n_par)
                full[-2:] = th2
                return loss(full)
            res = minimize(loss_eq, th0[-2:], method="L-BFGS-B")
            th = np.zeros(n_par)
            th[-2:] = res.x
        else:
            res = minimize(loss, th0, method="L-BFGS-B", options={"maxiter": 300})
            th = res.x
        self.a, self.B, self.s, self.b = unpack(th)
        self.fitted = True
        return self


class Calibrator:
    """Maps the combined forecast (vol units) to signal z-score, P(up) and expected return."""

    def __init__(self):
        self.std = None
        self.logit = (0.0, 1.0)   # P(up) = sigmoid(c0 + c1 * forecast)
        self.slope = 1.0          # E[y_z | forecast] = slope * forecast (fit on past out-of-fold forecasts)

    def fit(self, forecast: np.ndarray, y: np.ndarray) -> "Calibrator":
        f = np.asarray(forecast, float)
        ok = np.isfinite(f) & np.isfinite(y)
        f, y = f[ok], y[ok]
        self.std = float(np.std(f)) if len(f) > 20 and np.std(f) > 0 else None
        if len(f) > 20 and np.dot(f, f) > 0:
            # raw tree outputs are not in return units: regress realised y on the forecast (no intercept,
            # winsorised y). A negative slope means no demonstrated skill, so the expected move is set to 0.
            yc = np.clip(y, -4, 4)
            self.slope = float(max(0.0, np.dot(f, yc) / np.dot(f, f)))
        if len(f) > 50:
            from sklearn.linear_model import LogisticRegression
            lr = LogisticRegression(C=0.5).fit(f.reshape(-1, 1), (y > 0).astype(int))
            self.logit = (float(lr.intercept_[0]), float(lr.coef_[0, 0]))
        return self

    def p_up(self, forecast):
        c0, c1 = self.logit
        return 1 / (1 + np.exp(-(c0 + c1 * np.asarray(forecast, float))))

    def z(self, forecast):
        return np.asarray(forecast, float) / self.std if self.std else np.zeros_like(np.asarray(forecast, float))


def decide(forecast, sigma, cal: Calibrator, dcfg: config.DecisionConfig):
    """Position in [-max_size, max_size]. Trades only when the expected 10:30->close move beats the
    round-trip cost, and sizes linearly between the dead zone and full-size thresholds."""
    f = np.asarray(forecast, float)
    slope = getattr(cal, "slope", 1.0)
    exp_ret = slope * f * np.asarray(sigma, float)               # calibrated expected log return
    z = cal.z(f)
    size = np.clip((np.abs(z) - dcfg.dead_zone_z) / (dcfg.full_size_z - dcfg.dead_zone_z), 0, 1) * dcfg.max_size
    beats_cost = np.abs(exp_ret) * 1e4 > dcfg.cost_bps
    pos = np.where(beats_cost, np.sign(f) * size, 0.0)
    return pos, exp_ret, z


class ResidualSpecialist:
    """QQQ-only booster on top of the pooled ensemble (few, shallow trees)."""

    def __init__(self, cfg: ModelConfig):
        p = dict(cfg.lgb_params, num_leaves=4, min_data_in_leaf=40, learning_rate=0.02, lambda_l2=30.0)
        self.expert = Expert("qqq_residual", config.ALL_FEATURES, cfg, rounds=60, params=p)

    def fit(self, X: pd.DataFrame, y: np.ndarray, base: np.ndarray) -> "ResidualSpecialist":
        self.expert.fit(X, y, np.ones(len(y)), init=base)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.expert.predict(X)


class RidgeModel:
    """Linear baseline on every feature (median-imputed, standardised): the 'is the boosting worth it' check."""

    def __init__(self, cfg: ModelConfig):
        self.cfg = cfg

    def fit(self, train: pd.DataFrame) -> "RidgeModel":
        from sklearn.linear_model import Ridge
        tr = train[train["y_z"].notna()]
        self.feats = [c for c in config.ALL_FEATURES if tr[c].notna().mean() > 0.5]
        self.med = tr[self.feats].median()
        X = tr[self.feats].fillna(self.med)
        self.mu, self.sd = X.mean(), X.std().replace(0, 1)
        y = tr["y_z"].clip(-self.cfg.target_clip, self.cfg.target_clip)
        self.m = Ridge(alpha=len(tr) * 0.05).fit(self._x(tr), y, sample_weight=sample_weights(tr.index, self.cfg))
        return self

    def _x(self, X: pd.DataFrame) -> pd.DataFrame:
        return ((X[self.feats].fillna(self.med) - self.mu) / self.sd).clip(-5, 5)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.m.predict(self._x(X))

    def contrib(self, X: pd.DataFrame) -> pd.DataFrame:
        c = self._x(X) * self.m.coef_
        c["_base"] = self.m.intercept_
        return c
