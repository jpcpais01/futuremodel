"""v2 test: learn refraction on year 1, test everything on year 2."""
import numpy as np, sys, json, pickle
from multiprocessing import Pool
from glass2 import prep, walls_at, design, fit_logit, sim, H, FEATS

DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
KAPPAS = [0.5, 1, 2, 4, 8]
N = 1000

def load(sym):
    return prep(np.load(f"{DATA}/{sym}.npy"))

def stage1(sym):
    """Walls at every 30 min + every wall hit (real and fake mirror)."""
    d = load(sym); n = len(d["c"]); mid = n // 2
    walls = {}; ev = []
    for i in range(2100, n - 2 * H, 6):
        lev, F = walls_at(d, i); walls[i] = (lev, F)
        x0, sg = d["c"][i], d["sig"][i]
        for real, levels in ((1, lev), (0, 2 * x0 - lev)):
            for L, f in zip(levels, F):
                above = L > x0
                hh, ll = d["h"][i + 1:i + H + 1], d["l"][i + 1:i + H + 1]
                hit = np.nonzero(hh >= L if above else ll <= L)[0]
                if not len(hit): continue
                j = i + 1 + hit[0]; s = 1 if above else -1
                appr = s * (d["c"][j - 1] - d["c"][j - 4]) / (sg * np.sqrt(3))
                back = (d["c"][j + 6] < L) if above else (d["c"][j + 6] > L)
                year = 1 if j + 6 < mid else 2
                ev.append([year, real, back, appr, sg / d["sigL"][i]] + list(f))
    return sym, walls, np.array(ev)

def stage2(args):
    sym, idx, walls, model, seed = args
    d = load(sym); rng = np.random.default_rng(seed); np.random.seed(seed)
    out = []
    for i in idx:
        lev, F = walls[i]; z = rng.standard_normal((N, H))
        pu = [sim(d, i, lev, F, model, kp, z) for kp in KAPPAS]
        out.append([float(i), d["c"][i + H] - d["c"][i], d["c"][i] - d["c"][i - 12],
                    d["sig"][i] / d["sigL"][i]] + pu)
    return sym, out

def asym_features(d, i, lev, F, model):
    """Direct version: how much bouncing glass sits above vs below."""
    a, b = model; x0 = d["c"][i]
    if len(lev) == 0: return [0, 3, 3, 0]
    Fh = F.copy(); Fh[:, 7] = 0
    Z = design(Fh, np.ones(len(lev)), np.full(len(lev), d["sig"][i] / d["sigL"][i]))
    delta = 1 / (1 + np.exp(-Z @ (a + b))) - 1 / (1 + np.exp(-Z @ a))
    w = np.exp(-F[:, 7]); up = lev > x0
    da, db = F[up, 7], F[~up, 7]
    return [np.sum((delta * w)[up]) - np.sum((delta * w)[~up]),
            da.min() if len(da) else 3, db.min() if len(db) else 3,
            up.sum() - (~up).sum()]

if __name__ == "__main__":
    with Pool(3) as pool:
        st = pool.map(stage1, SYMS)
    W = {s: w for s, w, _ in st}
    EV = np.vstack([e for _, _, e in st])
    names = ["year", "real", "back", "approach", "volratio"] + FEATS
    np.save(f"{DATA}/events2.npy", EV)
    # ---- learn refraction on year 1 events only
    E1 = EV[EV[:, 0] == 1]
    Fe = E1[:, 5:]; Z = design(Fe, E1[:, 3], E1[:, 4]); real = E1[:, 1:2]
    X = np.hstack([Z, Z * real])
    w = fit_logit(X, E1[:, 2], l2=10.0)
    k = Z.shape[1]; model = (w[:k], w[k:])
    json.dump(dict(base=list(model[0]), excess=list(model[1])), open(f"{DATA}/refraction2.json", "w"))
    print("fitted on", len(E1), "wall hits", flush=True)
    # ---- simulate year 1 (choose kappa) and year 2 (test)
    jobs = []
    for s in SYMS:
        n = len(load(s)["c"]); mid = n // 2
        ins = [i for i in W[s] if i + H < mid and (i // 6) % 4 == 0]
        oos = [i for i in W[s] if i >= mid and i + H < n and (i // 6) % 2 == 0]
        for part, idx in (("ins", ins), ("oos", oos)):
            for c in np.array_split(np.array(idx), 12):
                jobs.append((s, c, {i: W[s][i] for i in c}, model, int(c[0]) % 2**31))
    with Pool(4) as pool:
        res = pool.map(stage2, jobs)
    R = {s: [] for s in SYMS}
    for s, o in res: R[s] += o
    # ---- direct asymmetry features for every sim row
    A = {}
    for s in SYMS:
        d = load(s)
        A[s] = [asym_features(d, int(r[0]), *W[s][int(r[0])], model) for r in R[s]]
    pickle.dump(dict(R=R, A=A), open(f"{DATA}/results2.pkl", "wb"))
    print("done", flush=True)
