"""NYSE trading calendar and event dates (OPEX, quad witching, FOMC, holidays), rule based.

No paid calendar feed is needed: holidays follow NYSE rules, monthly options expire on the third
Friday (Thursday when that Friday is a holiday), and FOMC decision days are listed by hand.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

# FOMC statement days (second day of each meeting), incl. 2020 emergency moves.
# Extend this list when the Fed publishes the next year's schedule.
FOMC_DATES = pd.to_datetime([
    "2015-01-28", "2015-03-18", "2015-04-29", "2015-06-17", "2015-07-29", "2015-09-17", "2015-10-28", "2015-12-16",
    "2016-01-27", "2016-03-16", "2016-04-27", "2016-06-15", "2016-07-27", "2016-09-21", "2016-11-02", "2016-12-14",
    "2017-02-01", "2017-03-15", "2017-05-03", "2017-06-14", "2017-07-26", "2017-09-20", "2017-11-01", "2017-12-13",
    "2018-01-31", "2018-03-21", "2018-05-02", "2018-06-13", "2018-08-01", "2018-09-26", "2018-11-08", "2018-12-19",
    "2019-01-30", "2019-03-20", "2019-05-01", "2019-06-19", "2019-07-31", "2019-09-18", "2019-10-30", "2019-12-11",
    "2020-01-29", "2020-03-03", "2020-03-16", "2020-04-29", "2020-06-10", "2020-07-29", "2020-09-16", "2020-11-05", "2020-12-16",
    "2021-01-27", "2021-03-17", "2021-04-28", "2021-06-16", "2021-07-28", "2021-09-22", "2021-11-03", "2021-12-15",
    "2022-01-26", "2022-03-16", "2022-05-04", "2022-06-15", "2022-07-27", "2022-09-21", "2022-11-02", "2022-12-14",
    "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14", "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
])
FOMC_LAST_KNOWN = FOMC_DATES.max()

SPECIAL_CLOSURES = pd.to_datetime(["2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", "2004-06-11",
                                   "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05", "2025-01-09"])


def _easter(year: int) -> date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date) -> date | None:
    if d.weekday() == 5:   # Saturday -> Friday (except New Year's, handled by caller)
        return d - timedelta(days=1)
    if d.weekday() == 6:   # Sunday -> Monday
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=None)
def nyse_holidays(year: int) -> frozenset:
    hol = set()
    ny = date(year, 1, 1)
    if ny.weekday() != 5:          # NYSE does not observe New Year's on the prior Friday
        hol.add(_observed(ny))
    hol.add(_nth_weekday(year, 1, 0, 3))      # MLK
    hol.add(_nth_weekday(year, 2, 0, 3))      # Presidents
    hol.add(_easter(year) - timedelta(days=2))  # Good Friday
    hol.add(_last_weekday(year, 5, 0))        # Memorial
    if year >= 2022:
        hol.add(_observed(date(year, 6, 19)))  # Juneteenth
    hol.add(_observed(date(year, 7, 4)))
    hol.add(_nth_weekday(year, 9, 0, 1))      # Labor
    hol.add(_nth_weekday(year, 11, 3, 4))     # Thanksgiving
    hol.add(_observed(date(year, 12, 25)))
    hol |= {d.date() for d in SPECIAL_CLOSURES if d.year == year}
    return frozenset(hol)


@lru_cache(maxsize=None)
def trading_days(start: str = "1998-01-01", end: str = "2031-12-31") -> pd.DatetimeIndex:
    days = pd.bdate_range(start, end)
    hol = set()
    for y in range(days[0].year, days[-1].year + 1):
        hol |= nyse_holidays(y)
    return pd.DatetimeIndex([d for d in days if d.date() not in hol])


def is_half_day(d: pd.Timestamp) -> bool:
    d = pd.Timestamp(d)
    if d.month == 11 and d.weekday() == 4 and (d - pd.Timedelta(days=1)).date() == _nth_weekday(d.year, 11, 3, 4):
        return True
    if d.month == 12 and d.day == 24 and d.weekday() < 5:
        return True
    if d.month == 7 and d.day == 3 and d.weekday() < 5 and d.weekday() != 4:
        return True
    return False


def monthly_opex(year: int, month: int) -> pd.Timestamp:
    fri = _nth_weekday(year, month, 4, 3)
    if fri in nyse_holidays(year):
        fri -= timedelta(days=1)
    return pd.Timestamp(fri)


def calendar_features(dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Date-level calendar features, all knowable in advance."""
    dates = pd.DatetimeIndex(pd.to_datetime(dates)).normalize()
    td = trading_days()
    pos = td.searchsorted(dates)
    out = pd.DataFrame(index=dates)
    out["c_dow"] = dates.dayofweek.astype(float)

    month_key = td.year * 12 + td.month
    tds = pd.Series(np.arange(len(td)), index=td)
    first_idx = tds.groupby(month_key).transform("min").to_numpy()
    last_idx = tds.groupby(month_key).transform("max").to_numpy()
    p = np.clip(pos, 0, len(td) - 1)
    out["c_tdays_to_month_end"] = (last_idx[p] - p).astype(float)
    out["c_tdays_from_month_start"] = (p - first_idx[p]).astype(float)

    opex = sorted({monthly_opex(y, m) for y in range(dates.min().year - 1, dates.max().year + 2) for m in range(1, 13)})
    opex = pd.DatetimeIndex(opex)
    nxt = opex[np.clip(opex.searchsorted(dates), 0, len(opex) - 1)]
    out["c_is_opex"] = (nxt == dates).astype(float)
    out["c_tdays_to_opex"] = (td.searchsorted(nxt) - p).astype(float)
    out["c_is_quad"] = ((out["c_is_opex"] == 1) & dates.month.isin([3, 6, 9, 12])).astype(float)

    fomc = set(FOMC_DATES)
    prev_td = td[np.clip(p - 1, 0, len(td) - 1)]
    out["c_is_fomc"] = [1.0 if d in fomc else 0.0 for d in dates]
    out["c_is_post_fomc"] = [1.0 if d in fomc else 0.0 for d in prev_td]
    # Unknown future FOMC schedule -> NaN instead of a silent 0.
    unknown = dates > FOMC_LAST_KNOWN + pd.Timedelta(days=45)
    out.loc[unknown, ["c_is_fomc", "c_is_post_fomc"]] = np.nan

    next_td = td[np.clip(p + 1, 0, len(td) - 1)]
    out["c_is_pre_holiday"] = (((next_td - dates).days > 1) & ~((dates.dayofweek == 4) & ((next_td - dates).days == 3))).astype(float)
    out["c_is_half_day"] = [1.0 if is_half_day(d) else 0.0 for d in dates]
    return out
