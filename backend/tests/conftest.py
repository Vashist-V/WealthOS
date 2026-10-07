import pytest

from app.services import assistant


@pytest.fixture(autouse=True)
def nothing_resting():
    """The assistant remembers which keys and models have just refused, to pass over them for a while.
    No test should inherit that from the one before it."""
    assistant._resting.clear()
    yield
    assistant._resting.clear()
