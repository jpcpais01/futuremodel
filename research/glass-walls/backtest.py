import numpy as np, sys, json
from multiprocessing import Pool
from glass import prep, walls_at, simulate, H, LOOK

N = 1000
DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
GRID = [(b, g) for b in (0.03, 0.1, 0.3, 1.0) for g in (0.0, 0.5)]

def run(args):
    sym, idx, configs, seed = args
    rng = np.random.default_rng(seed); np.random.seed(seed)
    d = prep(np.load(f"{DATA}/{sym}.npy"))
    out = []
    for i in idx:
        lev, sc = walls_at(d, i)
        z = rng.standard_normal((N, H))
        pu = [simulate(d, i, lev, sc, b, g, z) for b, g in configs]
        fut = d["c"][i + H] - d["c"][i]
        mom = d["c"][i] - d["c"][i - 12]
        out.append([float(x) for x in [i, fut, mom, d["sig"][i], len(lev)] + pu])
    return out

def chunks(sym, idx, configs, n=16):
    return [(sym, c, configs, hash((sym, int(c[0]))) % 2**31) for c in np.array_split(idx, n)]

if __name__ == "__main__":
    res = {}
    with Pool(4) as pool:
        for sym in SYMS:
            n = len(np.load(f"{DATA}/{sym}.npy"))
            start = 2100; mid = n // 2
            ins = np.arange(start, mid - H, 24)               # year 1, every 2h
            oos = np.arange(mid, n - H, 12)                   # year 2, every hour, no overlap
            a = sum(pool.map(run, chunks(sym, ins, GRID)), [])
            b = sum(pool.map(run, chunks(sym, oos, GRID)), [])
            res[sym] = dict(ins=a, oos=b)
            print(sym, len(a), len(b), flush=True)
    json.dump(res, open(f"{DATA}/results.json", "w"))
