import urllib.request, json, time, sys
import pandas as pd
sym=sys.argv[1]
end=int(time.time()*1000); start=end-2*365*86400*1000
rows=[]; t=start
while t<end:
    u=f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=5m&limit=1000&startTime={t}"
    for k in range(5):
        try: d=json.load(urllib.request.urlopen(u,timeout=30)); break
        except Exception as e: time.sleep(2**k)
    if not d: break
    rows+=d; t=d[-1][0]+300000
df=pd.DataFrame(rows,columns="t o h l c v ct qv n tb tq x".split())[["t","o","h","l","c","v"]].astype(float)
import numpy as np; np.save(f"{sys.argv[2] if len(sys.argv)>2 else 'data'}/{sym}.npy", df.values); print(sym,len(df))
