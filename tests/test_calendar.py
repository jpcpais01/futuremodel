import pandas as pd

from futuremodel import calendar as cal


def test_holidays_2025():
    hol = {str(d) for d in cal.nyse_holidays(2025)}
    for d in ["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
              "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"]:
        assert d in hol, d
    assert len(hol) == 11


def test_trading_days_and_opex():
    td = cal.trading_days()
    assert pd.Timestamp("2025-04-18") not in td            # Good Friday
    assert pd.Timestamp("2026-11-03") in td
    assert cal.monthly_opex(2025, 4) == pd.Timestamp("2025-04-17")   # 3rd Friday is Good Friday
    assert cal.monthly_opex(2026, 11) == pd.Timestamp("2026-11-20")
    f = cal.calendar_features(pd.DatetimeIndex(["2026-03-20", "2026-03-18", "2026-11-25", "2026-10-30"]))
    assert f.loc["2026-03-20", "c_is_quad"] == 1
    assert f.loc["2026-03-18", "c_is_fomc"] == 1
    assert f.loc["2026-11-25", "c_is_pre_holiday"] == 1    # day before Thanksgiving
    assert f.loc["2026-10-30", "c_tdays_to_month_end"] == 0
