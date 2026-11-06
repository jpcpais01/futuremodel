"""Model-free check: do real walls reflect price more than fake walls
placed at the same distance on the other side of price?"""
import numpy as np, sys, json
from glass import prep, walls_at, H
DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
out = {}
for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
    d = prep(np.load(f"{DATA}/{sym}.npy")); n = len(d["c"])
    stats = {"real": [0, 0], "fake": [0, 0]}
    strong = {"real": [0, 0], "fake": [0, 0]}
    for i in range(n // 2, n - 2 * H, 12):
        lev, sc = walls_at(d, i); x0 = d["c"][i]
        for kind, levels in (("real", lev), ("fake", 2 * x0 - lev)):
            for L, s in zip(levels, sc):
                above = L > x0
                hh = d["h"][i + 1:i + H + 1]; ll = d["l"][i + 1:i + H + 1]
                touch = np.nonzero(hh >= L if above else ll <= L)[0]
                if not len(touch): continue
                j = i + 1 + touch[0]
                back = (d["c"][j + 6] < L) if above else (d["c"][j + 6] > L)
                stats[kind][0] += back; stats[kind][1] += 1
                if s >= 1.0: strong[kind][0] += back; strong[kind][1] += 1
    out[sym] = {k: dict(reflect=round(v[0] / v[1], 4), n=v[1]) for k, v in stats.items()}
    out[sym]["strong_only"] = {k: dict(reflect=round(v[0] / max(v[1], 1), 4), n=v[1]) for k, v in strong.items()}
    print(sym, out[sym], flush=True)
json.dump(out, open(f"{DATA}/wallcheck.json", "w"), indent=1)
