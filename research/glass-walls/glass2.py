"""Glass walls v2.

Changes from v1 (glass.py):
- Walls come from 3 days of history plus last week's levels, not just 1 day.
- A wall's "touches" are real rejections (separate swing turns at that level),
  not every bar that happened to sit near it.
- Each wall keeps its own description (what kind of level, how many
  rejections, how much volume traded there, how long since price visited,
  how crowded the neighbourhood is, how far away it is).
- The refraction factor is LEARNED from year 1: when real price hit walls
  like this, coming in at this speed, in this volatility, how much more (or
  less) often did it bounce than at a fake level at the same distance? Walls
  can therefore reflect, or do the opposite (pull price through).
"""
import numpy as np

LOOK = 864          # 3 days of 5 min bars
H = 12              # 60 min horizon
K = 6               # swing = highest/lowest point within +-30 min
DAY = 86400000

FEATS = ["swing", "round", "vwap", "prev", "volnode", "fresh", "density", "dist"]

def prep(a):
    t, o, h, l, c, v = a.T
    lc = np.log(c); lh = np.log(h); ll = np.log(l)
    r = np.diff(lc, prepend=lc[0])
    lam = 0.5 ** (1 / 24); s2 = np.empty_like(r); acc = r[1:300].var()
    for i in range(len(r)):
        acc = lam * acc + (1 - lam) * r[i] ** 2; s2[i] = acc
    sig = np.sqrt(s2)
    r2 = np.convolve(r ** 2, np.ones(2016) / 2016, "full")[:len(r)]
    sigL = np.sqrt(np.maximum(r2, 1e-12)); sigL[:2016] = sig[:2016]
    day = (t // DAY).astype(np.int64); week = (day + 3) // 7       # weeks start Monday
    # swing points, known only K bars after they happen
    from numpy.lib.stride_tricks import sliding_window_view as sw
    ph = np.zeros(len(c), bool); pl = np.zeros(len(c), bool)
    ph[K:-K] = lh[K:-K] == sw(lh, 2 * K + 1).max(1)
    pl[K:-K] = ll[K:-K] == sw(ll, 2 * K + 1).min(1)
    tp = (lh + ll + lc) / 3
    return dict(t=t, h=lh, l=ll, c=lc, v=v, r=r, sig=sig, sigL=sigL, day=day, week=week,
                price=c, piv_hi=np.nonzero(ph)[0], piv_lo=np.nonzero(pl)[0],
                ctv=np.cumsum(tp * v), cv=np.cumsum(v))

def _vwap(d, a, b):           # bars a..b inclusive
    vv = d["cv"][b] - (d["cv"][a - 1] if a > 0 else 0)
    pv = d["ctv"][b] - (d["ctv"][a - 1] if a > 0 else 0)
    return pv / vv if vv > 0 else None

def walls_at(d, i):
    """Walls at bar i, using only data up to bar i.
    Returns levels (log price) and a feature matrix (len(levels) x FEATS)."""
    x0, sg = d["c"][i], d["sig"][i]
    tol = 0.5 * sg; sH = sg * np.sqrt(H); reach = 3 * sH
    lo = i - LOOK + 1
    cand = []        # (level, kind)
    for arr, piv in ((d["h"], d["piv_hi"]), (d["l"], d["piv_lo"])):
        a, b = np.searchsorted(piv, [lo, i - K + 1])
        for j in piv[a:b]: cand.append((arr[j], "swing"))
    p = d["price"][i]; step = 10 ** np.floor(np.log10(p)) / 10
    base = np.floor(p / step) * step
    for m in range(-3, 5):
        q = base + m * step
        if q > 0: cand.append((np.log(q), "round2"))
        if q + step / 2 > 0: cand.append((np.log(q + step / 2), "round1"))
    day, week = d["day"], d["week"]
    ds = np.searchsorted(day, day[i]); ws = np.searchsorted(week, week[i])
    for a in (ds, ws):
        if i - a >= 3:
            w = _vwap(d, a, i)
            if w is not None: cand.append((w, "vwap"))
    pds = np.searchsorted(day, day[i] - 1)
    if pds < ds:
        cand += [(d["h"][pds:ds].max(), "prev"), (d["l"][pds:ds].min(), "prev")]
    pws = np.searchsorted(week, week[i] - 1)
    if pws < ws:
        cand += [(d["h"][pws:ws].max(), "prev"), (d["l"][pws:ws].min(), "prev")]
    cand.append((d["c"][max(ds - 1, 0)], "prev"))
    H_, L_, V_ = d["h"][lo:i + 1], d["l"][lo:i + 1], d["v"][lo:i + 1]
    mid = (H_ + L_) / 2
    edges = np.arange(L_.min(), H_.max() + tol, tol)
    nodes = []
    if len(edges) > 3:
        hist, _ = np.histogram(mid, edges, weights=V_)
        pk = [j for j in range(1, len(hist) - 1) if hist[j] >= hist[j - 1] and hist[j] >= hist[j + 1]]
        for j in sorted(pk, key=lambda j: -hist[j])[:4]:
            cand.append(((edges[j] + edges[j + 1]) / 2, "volnode"))
    cand = [c for c in cand if abs(c[0] - x0) <= reach]
    if not cand: return np.zeros(0), np.zeros((0, len(FEATS)))
    cand.sort()
    # cluster levels closer than tol into one (thicker) wall
    groups = [[cand[0]]]
    for c in cand[1:]:
        if c[0] - groups[-1][-1][0] < tol: groups[-1].append(c)
        else: groups.append([c])
    lev = np.array([np.mean([c[0] for c in g]) for g in groups])
    totv = V_.sum() + 1e-9; span = max(H_.max() - L_.min(), tol)
    F = np.zeros((len(lev), len(FEATS)))
    for n, (g, L) in enumerate(zip(groups, lev)):
        kinds = [c[1] for c in g]
        F[n, 0] = min(kinds.count("swing"), 5)                       # rejections
        F[n, 1] = 2 if "round2" in kinds else (1 if "round1" in kinds else 0)
        F[n, 2] = min(kinds.count("vwap"), 2)
        F[n, 3] = min(kinds.count("prev"), 3)
        near = np.abs(mid - L) < tol
        F[n, 4] = (V_[near].sum() / totv) / (2 * tol / span)          # volume concentration (1 = average)
        visited = np.nonzero((L_ <= L) & (H_ >= L))[0]
        age = (len(H_) - 1 - visited[-1]) if len(visited) else LOOK
        F[n, 5] = 1 - age / LOOK                                        # 1 = just visited
        F[n, 7] = abs(L - x0) / sH
    for n, L in enumerate(lev):
        F[n, 6] = np.sum(np.abs(lev - L) < 0.5 * sH) - 1                # crowding
    F[:, 4] = np.log1p(np.minimum(F[:, 4], 20))
    return lev, F

# ---------- learned refraction ----------
def design(F, approach, volratio):
    """Rows = wall hits. Approach: speed into the wall in sigma units (+ = toward)."""
    Z = np.column_stack([np.ones(len(F)), F, approach, volratio,
                         approach * F[:, :5].sum(1) / 5, F[:, 6] * approach])
    return Z

def fit_logit(X, y, l2=1.0, it=30):
    w = np.zeros(X.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-X @ w))
        g = X.T @ (p - y) + l2 * w
        Hm = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w))
        step = np.linalg.solve(Hm, g); w -= step
        if np.abs(step).max() < 1e-8: break
    return w

def sim(d, i, lev, F, model, kappa, z):
    """Fire walks through the walls. At each crossing, the wall's learned
    excess bounce (delta) decides: delta>0 reflect with prob kappa*delta,
    delta<0 pull the walk through with prob kappa*|delta|."""
    x0, sg, sL = d["c"][i], d["sig"][i], d["sigL"][i]
    N = z.shape[0]; x = np.full(N, x0)
    if len(lev) == 0 or kappa == 0:
        return np.mean(z.sum(1) > 0)
    a, b = model
    hist = np.tile(d["r"][i - 2:i + 1], (N, 1))          # last 3 real returns
    vr = sg / sL; tol = 0.5 * sg
    for k in range(H):
        st = sg * z[:, k]
        x1 = x + st
        hist = np.column_stack([hist[:, 1:], st])
        mv = hist.sum(1) / (sg * np.sqrt(3))
        lo = np.minimum(x, x1)[:, None]; hi = np.maximum(x, x1)[:, None]
        crossed = (lev[None, :] > lo) & (lev[None, :] < hi)
        if crossed.any():
            pi, wi = np.nonzero(crossed)
            up = x1[pi] > x[pi]
            appr = np.where(up, mv[pi], -mv[pi])
            Fh = F[wi].copy(); Fh[:, 7] = 0
            Z = design(Fh, appr, np.full(len(pi), vr))
            base = 1 / (1 + np.exp(-Z @ a)); real = 1 / (1 + np.exp(-Z @ (a + b)))
            delta = real - base
            u = np.random.random(len(pi))
            act = u < kappa * np.abs(delta)
            # first acting wall per path, in its direction of travel
            ai = np.nonzero(act)[0]
            if len(ai):
                dist = np.abs(lev[wi[ai]] - x[pi[ai]])
                o = np.lexsort((dist, pi[ai])); ai = ai[o]
                _, first = np.unique(pi[ai], return_index=True); ai = ai[first]
                P = pi[ai]; L = lev[wi[ai]]; s = np.where(up[ai], 1.0, -1.0)
                refl = delta[ai] > 0
                x1[P] = np.where(refl, L - (x1[P] - L) * 0.5,
                                 np.where(s > 0, np.maximum(x1[P], L + tol), np.minimum(x1[P], L - tol)))
                hist[P[refl]] *= -0.5
        x = x1
    return np.mean(x > x0)
