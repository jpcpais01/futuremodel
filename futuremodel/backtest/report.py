"""Backtest report: markdown + charts + JSON, written to reports/."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from .baselines import baseline_positions
from .metrics import information_coefficient, pnl, summarize
from .walkforward import causal_decisions

log = logging.getLogger(__name__)

# simplest first: a more complex variant must beat a simpler one by this much dev Sharpe to be chosen
COMPLEXITY_ORDER = ["ridge", "generalist_only", "equal", "gated", "gated_spec"]
SELECTION_MARGIN = 0.25


def select_variant(dev_stats: dict[str, dict]) -> str:
    best = None
    for v in COMPLEXITY_ORDER:
        if v not in dev_stats or not dev_stats[v]:
            continue
        if best is None or dev_stats[v]["sharpe"] > dev_stats[best]["sharpe"] + SELECTION_MARGIN:
            best = v
    return best or "gated"


def _fmt(s: dict) -> dict:
    if not s:
        return {}
    lo, hi = s.get("sharpe_ci90", (np.nan, np.nan))
    return {"days": s["days"], "trades": s["trades"], "hit %": 100 * s["hit_rate"] if s["hit_rate"] == s["hit_rate"] else np.nan,
            "bps/day": s["avg_bps_per_day"], "ann. ret %": 100 * s["ann_return"], "ann. vol %": 100 * s["ann_vol"],
            "Sharpe": s["sharpe"], "Sharpe 90% CI": f"[{lo:.2f}, {hi:.2f}]", "t-stat": s["t_stat"],
            "max DD %": 100 * s["max_drawdown"]}


def _table(rows: dict[str, dict]) -> str:
    rows = {k: _fmt(v) for k, v in rows.items() if v}
    if not rows:
        return "_no data_\n"
    df = pd.DataFrame(rows).T
    return df.to_markdown(floatfmt=".2f") + "\n"


def evaluate(wf: dict, n_boot: int = 2000) -> dict:
    dcfg = wf["dcfg"]
    lab = wf["panel"]
    hs = wf["holdout_start"]
    res = {"variants": {}, "baselines": {}, "periods": {}}
    recs = {v: causal_decisions(wf, v) for v in wf["variants"]}
    any_rec = next(iter(recs.values()))
    days = any_rec.index
    dev, hold = days[days < hs], days[days >= hs]
    res["periods"] = {"eval_start": str(wf["eval_start"].date()), "holdout_start": str(hs.date()),
                      "end": str(days.max().date()), "dev_days": len(dev), "holdout_days": len(hold)}
    for v, r in recs.items():
        res["variants"][v] = {p: summarize(r.loc[idx, "net"], r.loc[idx, "position"], r.loc[idx, "gross"], n_boot)
                              for p, idx in (("dev", dev), ("holdout", hold), ("all", days))}
    q = lab.xs(config.TARGET, level="ticker").reindex(days)
    ret = np.expm1(q["y"])
    for name, pos in baseline_positions(q).items():
        net = pnl(pos, ret, dcfg.cost_bps)
        res["baselines"][name] = {p: summarize(net.loc[idx], pos.loc[idx], None, n_boot)
                                  for p, idx in (("dev", dev), ("holdout", hold), ("all", days))}
    chosen = select_variant({v: s["dev"] for v, s in res["variants"].items()})
    res["chosen"] = chosen
    res["records"] = recs

    # cost sensitivity for the chosen variant
    r = recs[chosen]
    res["cost_sensitivity"] = {}
    for c in (0.0, 1.0, 2.0, 5.0, 10.0):
        net = r["gross"] - r["position"].abs() * c / 1e4
        res["cost_sensitivity"][c] = {p: summarize(net.loc[idx], r.loc[idx, "position"], None, 200)
                                      for p, idx in (("dev", dev), ("holdout", hold))}

    # information coefficients: target, pooled universe, per expert
    oof = wf["oof"]
    o = oof[oof.index.get_level_values("date") >= wf["eval_start"]]
    yz = lab.loc[o.index, "y_z"]
    tq = o.index.get_level_values("ticker") == config.TARGET
    ic = {}
    for col in wf["expert_names"] + wf["variants"]:
        ic[col] = {"target": information_coefficient(o.loc[tq, col], yz[tq]),
                   "pooled": information_coefficient(o[col], yz)}
    res["ic"] = ic
    per_ticker = {}
    for t, g in o.groupby(level="ticker"):
        per_ticker[t] = information_coefficient(g[chosen], lab.loc[g.index, "y_z"])
    res["ic_per_ticker"] = per_ticker

    # regimes (target rows, chosen variant, all evaluated days)
    qq = q.join(r[["net", "position", "p_up"]])
    regimes = {}

    def by(labels):
        lab_s = pd.Series(np.asarray(labels, dtype=object), index=qq.index)
        return {str(k): summarize(qq.loc[lab_s == k, "net"], None, None, 0)
                for k in pd.unique(lab_s.dropna()) if (lab_s == k).sum() > 5}

    if qq["v_vix_pct"].notna().sum() > 30:
        regimes["VIX tercile"] = by(pd.qcut(qq["v_vix_pct"].rank(method="first"), 3, labels=["low VIX", "mid VIX", "high VIX"]))
    regimes["trend"] = by(np.where(qq["f_cta_score_qqq"] > 0, "uptrend", "downtrend"))
    regimes["morning move"] = by(pd.cut(qq["m_qqq_since_close_z"].abs(), [0, 0.5, 1.0, 99],
                                        labels=["|move| < 0.5 sd", "0.5-1 sd", "> 1 sd"], include_lowest=True))
    res["regimes"] = regimes

    # calibration of P(up)
    cal = qq.dropna(subset=["p_up"])
    if len(cal) > 30:
        bins = pd.qcut(cal["p_up"].rank(method="first"), 5, labels=False)
        res["calibration"] = cal.groupby(bins).apply(lambda g: pd.Series({"p_up_mean": g["p_up"].mean(),
                                                                          "realised_up": (g["y"] > 0).mean(),
                                                                          "n": len(g)}))
    return res


def _plots(res: dict, wf: dict, out: Path) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    files = []
    r = res["records"][res["chosen"]]
    lab = wf["panel"]
    q = lab.xs(config.TARGET, level="ticker").reindex(r.index)
    ret = np.expm1(q["y"])
    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(r.index, r["net"].cumsum() * 100, label=f"model ({res['chosen']}), net", lw=2, color="#1f5fbf")
    ax.plot(r.index, pnl(pd.Series(1.0, index=r.index), ret, wf["dcfg"].cost_bps).cumsum() * 100,
            label="always long 10:30->close", color="#999999")
    best_b = max(res["baselines"], key=lambda k: res["baselines"][k]["dev"].get("sharpe", -9))
    bp = baseline_positions(q)[best_b]
    ax.plot(r.index, pnl(bp, ret, wf["dcfg"].cost_bps).cumsum() * 100, label=f"best dev baseline: {best_b}",
            color="#d98c1f", ls="--")
    ax.axvline(wf["holdout_start"], color="k", ls=":", lw=1)
    ax.text(wf["holdout_start"], ax.get_ylim()[1], " holdout", va="top", fontsize=9)
    ax.set_ylabel("cumulative return, % (sum of daily)")
    ax.set_title(f"{config.TARGET} 10:30 -> close, walk-forward out-of-sample, net of {wf['dcfg'].cost_bps:g} bps")
    ax.legend(loc="best", frameon=False)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out / "equity.png", dpi=120)
    plt.close(fig)
    files.append("equity.png")

    gl = wf["gate_log"]
    if not gl.empty:
        fig, ax = plt.subplots(figsize=(10, 3.8))
        g = gl.rolling(10, min_periods=1).mean()
        ax.stackplot(g.index, g.T.to_numpy(), labels=g.columns, alpha=0.85)
        ax.set_ylim(0, 1)
        ax.set_title("Regime gate: weight on each specialist for QQQ (10-day average)")
        ax.legend(loc="upper left", ncol=4, fontsize=8, frameon=False)
        fig.tight_layout()
        fig.savefig(out / "gate_weights.png", dpi=120)
        plt.close(fig)
        files.append("gate_weights.png")
    return files


def write_report(wf: dict, res: dict, out_dir: Path | None = None, meta: dict | None = None,
                 synthetic: bool = False) -> Path:
    out = Path(out_dir or config.REPORT_DIR)
    out.mkdir(parents=True, exist_ok=True)
    files = _plots(res, wf, out)
    P = res["periods"]
    ch = res["chosen"]
    V = res["variants"]
    hold = V[ch]["holdout"]
    lines = []
    if synthetic:
        lines += ["> **SYNTHETIC DATA.** This report was produced from randomly generated prices to test the code. "
                  "The numbers below mean nothing about real markets.\n"]
    lines += [f"# {config.TARGET} 10:30 -> close model: walk-forward backtest\n"]
    if meta:
        lines += ["## Data\n", "| item | value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in meta.items()] + [""]
    lines += [
        "## Protocol\n",
        f"* Expanding-window walk-forward, refit every {wf['bcfg'].refit_every} trading days, "
        f"first {wf['bcfg'].min_train_days} labelled days used only for training, {wf['bcfg'].embargo_days}-day embargo.",
        "* Specialists are pretrained on the pooled universe; the gate and the calibration are fit only on out-of-fold "
        "forecasts from earlier folds. Every return below is out of sample.",
        f"* Development period {P['eval_start']} -> {P['holdout_start']} ({P['dev_days']} days) is used to choose "
        f"between model variants (rule fixed in advance: highest dev Sharpe, a more complex variant must win by "
        f"> {SELECTION_MARGIN}). The holdout {P['holdout_start']} -> {P['end']} ({P['holdout_days']} days) was not used for any choice.",
        f"* Costs: {wf['dcfg'].cost_bps:g} bps round trip on |position| every traded day (10:30 entry + market-on-close exit). "
        f"Sensitivity to higher costs is shown below.",
        f"* Decision rule: trade only when |expected move| > cost; size grows linearly from {wf['dcfg'].dead_zone_z} to "
        f"{wf['dcfg'].full_size_z} standard deviations of the signal, capped at {wf['dcfg'].max_size:g}x.\n",
        f"## Headline (chosen variant: `{ch}`)\n",
    ]
    if hold:
        lo, hi = hold["sharpe_ci90"]
        verdict = ("The holdout Sharpe interval excludes zero." if lo > 0 else
                   "The holdout Sharpe interval includes zero: the edge is **not statistically established**. "
                   "Paper-trade before risking money.")
        lines += [f"Holdout: Sharpe **{hold['sharpe']:.2f}** (90% CI {lo:.2f} to {hi:.2f}), "
                  f"{hold['avg_bps_per_day']:.1f} bps/day net, hit rate {100 * hold['hit_rate']:.1f}% on {hold['trades']} trades "
                  f"over {hold['days']} days, max drawdown {100 * hold['max_drawdown']:.1f}%. {verdict}\n"]
    lines += ["### Model variants: development period (used for selection)\n", _table({v: s["dev"] for v, s in V.items()}),
              "### Model variants: holdout (reported once, not used for selection)\n", _table({v: s["holdout"] for v, s in V.items()}),
              "### Baselines: holdout\n", _table({b: s["holdout"] for b, s in res["baselines"].items()}),
              "### Baselines: development period\n", _table({b: s["dev"] for b, s in res["baselines"].items()}),
              f"### Chosen variant over the whole evaluated period\n", _table({ch: V[ch]["all"]})]
    lines += ["## Charts\n"] + [f"![{f}]({f})\n" for f in files]
    lines += ["## Cost sensitivity (chosen variant)\n", "| cost bps | dev Sharpe | dev bps/day | holdout Sharpe | holdout bps/day |", "|---|---|---|---|---|"]
    for c, s in res["cost_sensitivity"].items():
        d, h = s["dev"], s["holdout"]
        lines.append(f"| {c:g} | {d.get('sharpe', np.nan):.2f} | {d.get('avg_bps_per_day', np.nan):.2f} | "
                     f"{h.get('sharpe', np.nan):.2f} | {h.get('avg_bps_per_day', np.nan):.2f} |")
    lines += ["", "## Forecast quality (rank IC, out of sample)\n",
              f"IC = Spearman correlation between forecast and realised vol-normalised 10:30->close move. "
              f"'pooled' covers every ticker in the universe: a signal that only works on QQQ and nowhere else is a red flag.\n",
              "| forecast | IC on QQQ | IC pooled |", "|---|---|---|"]
    for k, v in res["ic"].items():
        lines.append(f"| {k} | {v['target']:.3f} | {v['pooled']:.3f} |")
    pt = pd.Series(res["ic_per_ticker"]).dropna()
    if len(pt):
        lines += ["", f"Per-ticker IC of the chosen variant: positive on {int((pt > 0).sum())} of {len(pt)} tickers, "
                      f"median {pt.median():.3f}.\n"]
    lines += ["## By regime (chosen variant, all evaluated days, net)\n"]
    for name, ser in res["regimes"].items():
        lines += [f"**{name}**\n", "| bucket | days | bps/day | Sharpe | hit % |", "|---|---|---|---|---|"]
        for k, s in ser.items():
            if s:
                lines.append(f"| {k} | {s['days']} | {s['avg_bps_per_day']:.2f} | {s['sharpe']:.2f} | {100 * s['hit_rate']:.1f} |")
        lines.append("")
    if "calibration" in res:
        lines += ["## Calibration of P(up)\n", res["calibration"].to_markdown(floatfmt=".3f"), ""]
    gl = wf["gate_log"]
    if not gl.empty:
        lines += ["## Average gate weights (QQQ)\n", gl.mean().to_frame("weight").to_markdown(floatfmt=".3f"), ""]
    if res.get("permutation"):
        pm = res["permutation"]
        lines += ["## Label-permutation test\n",
                  f"Re-ran the whole walk-forward {pm['n']} times with the 10:30->close labels shuffled across dates. "
                  f"Share of shuffled runs with a dev+holdout Sharpe at least as high as the real one: **p = {pm['p_value']:.3f}**.\n"]
    lines += ["## Honest caveats\n",
              "* One decision per day: a few hundred days give a Sharpe standard error of roughly 0.7-1.0. Treat every number as noisy.",
              "* Yahoo's free 60-minute history is ~730 days. `fm backfill-av` (free Alpha Vantage key) can extend QQQ back years; "
              "the store also keeps every day you download, so the sample grows if you run `fm update` daily.",
              "* Options positioning (GEX) and live news/LLM sentiment have no free history, so they are shown live as context "
              "and archived daily, but are not part of the traded model until they can be validated.",
              "* Fills assume the 10:30 last trade and the official close. Real slippage at 10:30 and MOC imbalance risk are "
              "covered only by the cost assumption.", ""]
    md = out / "backtest.md"
    md.write_text("\n".join(lines))
    js = {"periods": P, "chosen": ch, "variants": V, "baselines": res["baselines"],
          "ic": res["ic"], "cost_sensitivity": {str(k): v for k, v in res["cost_sensitivity"].items()},
          "permutation": res.get("permutation")}
    (out / "backtest_results.json").write_text(json.dumps(js, indent=1, default=lambda x: None if x != x else str(x)))
    res["records"][ch].to_csv(out / "daily_record.csv")
    return md
