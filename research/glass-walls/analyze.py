import numpy as np, json, sys
from backtest import GRID, SYMS
DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
R = json.load(open(f"{DATA}/results.json"))
COSTS = (0.0004, 0.0010)   # round trip: low-cost futures / normal taker
def arr(rows): return np.array(rows, float)
def tstat(x): return x.mean() / (x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 2 else 0

# 1. pick the setting on year 1 only (pooled over coins): best Brier score
ins = np.vstack([arr(R[s]["ins"]) for s in SYMS])
up = (ins[:, 1] > 0).astype(float)
brier0 = np.mean((0.5 - up) ** 2)
skills = []
for k, cfg in enumerate(GRID):
    pu = ins[:, 5 + k]
    skills.append(1 - np.mean((pu - up) ** 2) / brier0)
best = int(np.argmax(skills))
out = {"grid": [dict(beta=b, gamma=g, brier_skill_year1=round(s * 100, 3)) for (b, g), s in zip(GRID, skills)],
       "chosen": dict(beta=GRID[best][0], gamma=GRID[best][1])}
thr = np.quantile(np.abs(ins[:, 5 + best] - 0.5), 0.8)   # top 20% tilts, set on year 1
out["trade_threshold_tilt"] = round(float(thr) * 2, 4)

rep = {}
for s in SYMS + ["ALL"]:
    o = np.vstack([arr(R[x]["oos"]) for x in SYMS]) if s == "ALL" else arr(R[s]["oos"])
    fut, mom, pu = o[:, 1], o[:, 2], o[:, 5 + best]
    upo = (fut > 0).astype(float); tilt = pu - 0.5
    b0 = np.mean((0.5 - upo) ** 2); b1 = np.mean((pu - upo) ** 2)
    nz = tilt != 0
    hit = np.mean(np.sign(tilt[nz]) == np.sign(fut[nz]))
    # hit rate by tilt size (quintiles of |tilt|)
    q = np.quantile(np.abs(tilt), [0, .2, .4, .6, .8, 1])
    byq = []
    for a, b in zip(q[:-1], q[1:]):
        m = (np.abs(tilt) >= a) & (np.abs(tilt) <= b) & nz
        byq.append(dict(avg_pred_up_side=round(float(0.5 + np.abs(tilt[m]).mean()), 3),
                        real_hit=round(float(np.mean(np.sign(tilt[m]) == np.sign(fut[m]))), 3), n=int(m.sum())))
    # calibration: predicted P(up) bins vs real share up
    cal = []
    for a, b in [(0, .45), (.45, .48), (.48, .5), (.5, .52), (.52, .55), (.55, 1)]:
        m = (pu >= a) & (pu < b)
        if m.sum() > 30: cal.append(dict(pred=f"{a:.2f}-{b:.2f}", mean_pred=round(float(pu[m].mean()), 3),
                                         real_up=round(float(upo[m].mean()), 3), n=int(m.sum())))
    # does it add anything beyond plain momentum? regress
    X = np.column_stack([np.ones_like(tilt), tilt / tilt.std(), mom / mom.std()])
    beta_, *_ = np.linalg.lstsq(X, fut / fut.std(), rcond=None)
    res = fut / fut.std() - X @ beta_
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ X)) * res.var())
    # trading: only big tilts, hold 60 min, one trade per hour max
    m = np.abs(tilt) >= thr / 1
    pnl = np.sign(tilt[m]) * fut[m]
    tr = dict(trades=int(m.sum()), gross_bps=round(float(pnl.mean() * 1e4), 2),
              gross_t=round(float(tstat(pnl)), 2),
              win=round(float(np.mean(pnl > 0)), 3))
    for c in COSTS:
        tr[f"net_bps_cost{int(c*1e4)}"] = round(float((pnl - c).mean() * 1e4), 2)
    rep[s] = dict(n=len(o), brier_skill_pct=round(float((1 - b1 / b0) * 100), 3),
                  hit_all=round(float(hit), 4),
                  mom_hit=round(float(np.mean(np.sign(mom) == np.sign(fut))), 4),
                  tilt_coef=round(float(beta_[1]), 4), tilt_t=round(float(beta_[1] / se[1]), 2),
                  mom_coef=round(float(beta_[2]), 4), mom_t=round(float(beta_[2] / se[2]), 2),
                  corr_tilt_mom=round(float(np.corrcoef(tilt, mom)[0, 1]), 3),
                  by_tilt_size=byq, calibration=cal, trading=tr)
out["year2"] = rep
json.dump(out, open(f"{DATA}/summary.json", "w"), indent=1)
print(json.dumps(out, indent=1))
