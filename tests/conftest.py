import pytest

from tests.synthetic import make_store


@pytest.fixture(scope="session")
def signal_store(tmp_path_factory):
    return make_store(tmp_path_factory.mktemp("sig"), n_days=380, daily_years=3, signal=0.35, seed=11)


@pytest.fixture(scope="session")
def null_store(tmp_path_factory):
    return make_store(tmp_path_factory.mktemp("null"), n_days=380, daily_years=3, signal=0.0, seed=12)
