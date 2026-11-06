"""Glass walls: price levels act like panes of glass that reflect or let
through random walks. The model fires many random walks scaled to current
volatility, bounces them off walls, and reads the up/down split at the end.
"""
import numpy as np

LOOK = 288          # 1 day of 5 min bars used to find walls
H = 12              # horizon: 12 bars = 60 min

def prep(a):
    t, o, h, l, c, v = a.T
    lc = np.log(c)
    r = np.diff(lc, prepend=lc[0])
    # short-term vol (EWMA, half-life 24 bars) and long-term vol (1 week)
    lam = 0.5 ** (1 / 24); s2 = np.empty_like(r); acc = r[1:300].var()
    for i in range(len(r)):
        acc = lam * acc + (1 - lam) * r[i] ** 2; s2[i] = acc
    sig = np.sqrt(s2)
    r2 = np.convolve(r ** 2, np.ones(2016) / 2016, "full")[:len(r)]
    sigL = np.sqrt(np.maximum(r2, 1e-12))
    day = (t // 86400000).astype(np.int64)
    return dict(t=t, h=np.log(h), l=np.log(l), c=lc, v=v, r=r, sig=sig, sigL=sigL,
                day=day, price=c)

def walls_at(d, i):
    """Return (levels in log price, raw strength score, type) for bar i."""
    lo, hi = i - LOOK + 1, i + 1
    H_, L_, C_, V_ = d["h"][lo:hi], d["l"][lo:hi], d["c"][lo:hi], d["v"][lo:hi]
    x0, sg = d["c"][i], d["sig"][i]
    tol = 0.5 * sg
    reach = 4 * sg * np.sqrt(H)
    lev, sc, ty = [], [], []
    def add(L, s, k):
        if abs(L - x0) <= reach: lev.append(L); sc.append(s); ty.append(k)
    # 1. swing highs / lows (k=3 fractals), strength from touches
    k = 3
    for arr, cmp in ((H_, np.max), (L_, np.min)):
        for j in range(k, len(arr) - k):
            if arr[j] == cmp(arr[j - k:j + k + 1]):
                L = arr[j]
                if abs(L - x0) > reach: continue
                touches = np.sum((np.abs(H_ - L) < tol) | (np.abs(L_ - L) < tol))
                add(L, 0.2 + 0.05 * min(touches, 10), 0)
    # 2. round numbers
    p = d["price"][i]; step = 10 ** np.floor(np.log10(p)) / 10
    base = np.floor(p / step) * step
    for m in range(-3, 5):
        q = base + m * step
        if q > 0: add(np.log(q), 0.5, 1)
        q2 = q + step / 2
        if q2 > 0: add(np.log(q2), 0.25, 1)
    # 3. VWAPs: current UTC day and rolling 24h
    day = d["day"]; ds = np.searchsorted(day, day[i])
    tp = (d["h"][ds:hi] + d["l"][ds:hi] + d["c"][ds:hi]) / 3
    if hi - ds >= 3:
        add(np.sum(tp * d["v"][ds:hi]) / max(np.sum(d["v"][ds:hi]), 1e-9), 0.4, 2)
    tp = (H_ + L_ + C_) / 3
    add(np.sum(tp * V_) / max(V_.sum(), 1e-9), 0.4, 2)
    # 4. prior UTC day high / low, today's open
    ps = np.searchsorted(day, day[i] - 1)
    if ps < ds:
        add(d["h"][ps:ds].max(), 0.6, 3); add(d["l"][ps:ds].min(), 0.6, 3)
    add(d["c"][max(ds - 1, 0)], 0.3, 3)
    # 5. high volume nodes from a volume-by-price histogram
    bw = max(tol, 1e-6)
    edges = np.arange(L_.min(), H_.max() + bw, bw)
    if len(edges) > 3:
        mid = (H_ + L_ + C_) / 3
        hist, _ = np.histogram(mid, edges, weights=V_)
        share = hist / max(hist.sum(), 1e-9)
        pk = [j for j in range(1, len(hist) - 1) if hist[j] >= hist[j - 1] and hist[j] >= hist[j + 1]]
        pk = sorted(pk, key=lambda j: -hist[j])[:4]
        for j in pk:
            add((edges[j] + edges[j + 1]) / 2, 0.2 + 4 * share[j], 4)
    if not lev: return np.zeros(0), np.zeros(0)
    lev = np.array(lev); sc = np.array(sc)
    # merge walls closer than tol (a thicker pane)
    o = np.argsort(lev); lev, sc = lev[o], sc[o]
    ml, ms = [lev[0]], [sc[0]]
    for L, s in zip(lev[1:], sc[1:]):
        if L - ml[-1] < tol:
            w = ms[-1] + s; ml[-1] = (ml[-1] * ms[-1] + L * s) / w; ms[-1] = w
        else: ml.append(L); ms.append(s)
    return np.array(ml), np.array(ms)

def simulate(d, i, lev, score, beta, gamma, z, damp=0.5):
    """Fire N random walks for H steps through the walls. Returns P(up)."""
    x0, sg, sL = d["c"][i], d["sig"][i], d["sigL"][i]
    N = z.shape[0]
    x = np.full(N, x0)
    v = np.full(N, d["r"][i - 5:i + 1].mean())       # incoming slope
    if len(lev) == 0 or beta == 0:
        xe = x0 + sg * z.sum(1)
        return np.mean(xe > x0)
    s = 1 - np.exp(-score)                               # strength 0..1
    if gamma:
        dens = np.array([np.sum(np.abs(lev - L) < sg * np.sqrt(H) * 0.5) - 1 for L in lev])
        s = s * (1 + gamma * dens)
    for k in range(H):
        rstep = sg * z[:, k]
        v = 0.7 * v + 0.3 * rstep
        x1 = x + rstep
        e = np.abs(v) / sL + 1e-6                        # energy of the hit
        lo = np.minimum(x, x1)[:, None]; hi = np.maximum(x, x1)[:, None]
        crossed = (lev[None, :] > lo) & (lev[None, :] < hi)
        if crossed.any():
            ppass = np.exp(-beta * s[None, :] / e[:, None])
            u = np.random.random(crossed.shape)
            fail = crossed & (u > ppass)
            up = x1 > x
            # first failing wall in the direction of motion
            Lup = np.where(fail, lev[None, :], np.inf).min(1)
            Ldn = np.where(fail, lev[None, :], -np.inf).max(1)
            Lhit = np.where(up, Lup, Ldn)
            hit = np.isfinite(Lhit)
            x1 = np.where(hit, Lhit - damp * (x1 - Lhit), x1)
            v = np.where(hit, -damp * v, v)
        x = x1
    return np.mean(x > x0)
