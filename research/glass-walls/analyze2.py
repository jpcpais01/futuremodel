import numpy as np, json, sys, pickle
from glass2 import FEATS, fit_logit
from backtest2 import KAPPAS, SYMS
DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
EV = np.load(f"{DATA}/events2.npy")
P = pickle.load(open(f"{DATA}/results2.pkl", "rb")); R, A = P["R"], P["A"]
col = {n: k for k, n in enumerate(["year", "real", "back", "approach", "volratio"] + FEATS)}
out = {}

# 1. Do walls behave like glass? real minus fake bounce rate, by group, both years
def excess(mask):
    r = {}
    for y in (1, 2):
        m = mask & (EV[:, 0] == y)
        re, fk = EV[m & (EV[:, 1] == 1), 2], EV[m & (EV[:, 1] == 0), 2]
        r[f"year{y}"] = dict(real=round(re.mean() * 100, 1), fake=round(fk.mean() * 100, 1),
                             extra_bounce=round((re.mean() - fk.mean()) * 100, 2), hits=int(len(re)))
    return r
c = lambda n: EV[:, col[n]]
groups = {
    "all walls": np.ones(len(EV), bool),
    "swing levels (3+ rejections)": c("swing") >= 3,
    "round numbers (major)": c("round") == 2,
    "VWAP": c("vwap") >= 1,
    "prior day/week high-low": c("prev") >= 1,
    "high volume node (top 20%)": c("volnode") >= np.quantile(c("volnode"), .8),
    "crowded (3+ walls close)": c("density") >= 3,
    "alone (no wall close)": c("density") == 0,
    "slow approach (bottom third)": c("approach") <= np.quantile(c("approach"), 1 / 3),
    "fast approach (top third)": c("approach") >= np.quantile(c("approach"), 2 / 3),
    "quiet market (low vol)": c("volratio") <= np.quantile(c("volratio"), 1 / 3),
    "busy market (high vol)": c("volratio") >= np.quantile(c("volratio"), 2 / 3),
    "strong + slow + quiet": (c("swing") >= 3) & (c("approach") <= np.quantile(c("approach"), 1 / 3)) & (c("volratio") <= np.quantile(c("volratio"), 1 / 3)),
}
out["glass_check"] = {g: excess(m) for g, m in groups.items()}

def evaluate(pu_ins, up_ins, rows_oos, pu_oos):
    thr = np.quantile(np.abs(pu_ins - 0.5), 0.8)
    rep = {}
    for s in SYMS + ["ALL"]:
        m = np.ones(len(rows_oos), bool) if s == "ALL" else rows_oos[:, -1] == SYMS.index(s)
        fut, pu = rows_oos[m, 1], pu_oos[m]; upo = (fut > 0).astype(float)
        bs = 1 - np.mean((pu - upo) ** 2) / np.mean((0.5 - upo) ** 2)
        tilt = pu - 0.5; nz = tilt != 0
        tm = np.abs(tilt) >= thr; pnl = np.sign(tilt[tm]) * fut[tm]
        rep[s] = dict(hours=int(m.sum()), skill_vs_coinflip_pct=round(bs * 100, 3),
                      hit=round(float(np.mean(np.sign(tilt[nz]) == np.sign(fut[nz]))), 4),
                      big_calls=int(tm.sum()),
                      big_hit=round(float(np.mean(pnl > 0)), 4) if tm.sum() else None,
                      big_gross_bps=round(float(pnl.mean() * 1e4), 2) if tm.sum() else None,
                      big_t=round(float(pnl.mean() / pnl.std() * np.sqrt(len(pnl))), 2) if tm.sum() > 2 else None,
                      net_bps_4=round(float(pnl.mean() * 1e4 - 4), 2) if tm.sum() else None,
                      net_bps_10=round(float(pnl.mean() * 1e4 - 10), 2) if tm.sum() else None)
    return rep

rows = {p: [] for p in ("ins", "oos")}; asy = {p: [] for p in ("ins", "oos")}
for k, s in enumerate(SYMS):
    n = len(np.load(f"{DATA}/{s}.npy")); mid = n // 2
    for r, a in zip(R[s], A[s]):
        p = "ins" if r[0] < mid else "oos"
        rows[p].append(list(r) + [k]); asy[p].append(a + [r[2], r[3]])
I, O = np.array(rows["ins"]), np.array(rows["oos"])
nk = len(KAPPAS)
sk = [1 - np.mean((I[:, 4 + j] - (I[:, 1] > 0)) ** 2) / np.mean((0.5 - (I[:, 1] > 0)) ** 2) for j in range(nk)]
best = int(np.argmax(sk))
out["sim"] = dict(kappa_skill_year1={str(k): round(v * 100, 3) for k, v in zip(KAPPAS, sk)},
                  chosen_kappa=KAPPAS[best],
                  year2=evaluate(I[:, 4 + best], I[:, 1] > 0, O, O[:, 4 + best]))
# 3. direct: learn up/down from the wall layout (plus momentum) on year 1
def X(a, rr):
    a = np.array(a, float)
    return np.column_stack([np.ones(len(a)), a[:, 0], a[:, 1], a[:, 2], a[:, 3] / 5,
                            a[:, 4] / (rr[:, 3] * 0 + np.std(a[:, 4])), a[:, 5]])
XI, XO = X(asy["ins"], I), X(asy["oos"], O)
mu, sd = XI[:, 1:].mean(0), XI[:, 1:].std(0) + 1e-12
XI[:, 1:] = (XI[:, 1:] - mu) / sd; XO[:, 1:] = (XO[:, 1:] - mu) / sd
w = fit_logit(XI, (I[:, 1] > 0).astype(float), l2=50)
pi_, po_ = 1 / (1 + np.exp(-XI @ w)), 1 / (1 + np.exp(-XO @ w))
out["direct"] = dict(weights=dict(zip(["const", "glass_above_minus_below", "nearest_above", "nearest_below",
                                       "walls_above_minus_below", "last_hour_move", "vol_ratio"],
                                      [round(float(v), 4) for v in w])),
                     year2=evaluate(pi_, I[:, 1] > 0, O, po_))
# walls only (no momentum, no vol): does the layout alone say anything?
w2 = fit_logit(XI[:, :5], (I[:, 1] > 0).astype(float), l2=50)
out["direct_walls_only"] = dict(year2=evaluate(1 / (1 + np.exp(-XI[:, :5] @ w2)), None, O,
                                               1 / (1 + np.exp(-XO[:, :5] @ w2))))
json.dump(out, open(f"{DATA}/summary2.json", "w"), indent=1)
print(json.dumps(out, indent=1))
