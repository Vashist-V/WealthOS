"""The keep-awake quiet hours: reading the window, the time left in it, and the visits made around it."""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app import keepawake
from app.config import Settings

IST = timezone(timedelta(hours=5, minutes=30))


def at(h: int, m: int, day: int = 21) -> float:
    return datetime(2026, 11, day, h, m, tzinfo=IST).timestamp()


@pytest.mark.parametrize(
    ("raw", "window", "text"),
    [
        ("02:00-10:00 +05:30", (120, 600, 330), "02:00-10:00 UTC+05:30"),
        ("23:30-05:00 UTC+0530", (1410, 300, 330), "23:30-05:00 UTC+05:30"),
        ("1:00-6:00", (60, 360, 0), "01:00-06:00 UTC+00:00"),
        ("20:00-24:00 -04:00", (1200, 0, -240), "20:00-00:00 UTC-04:00"),
        ("off", None, "none"),
        ("", None, "none"),
        ("nonsense", None, "none"),
        ("05:00-05:00", None, "none"),
    ],
)
def test_reads_the_window(raw, window, text):
    assert keepawake.parse_quiet(raw) == window
    assert keepawake.describe(window) == text


def test_the_default_is_two_to_ten_india_time():
    settings = Settings(_env_file=None)
    assert settings.keep_awake_minutes == 10
    assert keepawake.describe(keepawake.parse_quiet(settings.keep_awake_quiet_hours)) == "02:00-10:00 UTC+05:30"


@pytest.mark.parametrize(
    ("clock", "left"),
    [((1, 59), 0), ((2, 0), 480), ((5, 30), 270), ((9, 50), 10), ((9, 59), 1), ((10, 0), 0), ((15, 0), 0), ((23, 59), 0)],
)
def test_minutes_left(clock, left):
    assert keepawake.minutes_left((120, 600, 330), at(*clock)) == pytest.approx(left)


def test_a_window_across_midnight():
    quiet = (1410, 300, 330)  # 23:30 to 05:00
    assert keepawake.minutes_left(quiet, at(23, 45)) == pytest.approx(315)
    assert keepawake.minutes_left(quiet, at(0, 30)) == pytest.approx(270)
    assert keepawake.minutes_left(quiet, at(5, 0)) == 0
    assert keepawake.minutes_left(quiet, at(23, 29)) == 0


def simulate(start: float, until: float, minutes: float = 10.0):
    """When a server started at `start` is switched off (15 minutes after its last visit), and the visits it made."""
    quiet = keepawake.parse_quiet("02:00-10:00 +05:30")
    last = t = start
    visits = []
    while True:
        t += minutes * 60
        if t - last > 15 * 60:
            return last + 15 * 60, visits
        if t > until:
            return None, visits
        if keepawake.minutes_left(quiet, t) > minutes:
            continue
        visits.append(t)
        last = t


def test_it_falls_asleep_soon_after_two():
    for offset in range(10):
        slept, _ = simulate(at(21, offset, 20), at(12, 0))
        assert at(2, 5) <= slept <= at(2, 16)


@pytest.mark.parametrize("woken", [(9, 40), (9, 50), (9, 59), (10, 0), (10, 30)])
def test_woken_shortly_before_ten_it_stays_up(woken):
    slept, visits = simulate(at(*woken), at(23, 0))
    assert slept is None and visits


def test_a_visitor_at_night_does_not_keep_it_up():
    assert simulate(at(4, 0), at(12, 0)) == (at(4, 15), [])


def test_the_loop_visits_outside_the_window_only(monkeypatch):
    visits: list[str] = []

    async def get(self, url, *args, **kwargs):
        visits.append(url)

    monkeypatch.setattr(httpx.AsyncClient, "get", get)

    async def run(quiet) -> int:
        visits.clear()
        task = asyncio.create_task(keepawake.keep_awake("http://wealthos.test", 0.002, quiet))
        await asyncio.sleep(1.5)
        task.cancel()
        return len(visits)

    now = datetime.now(timezone.utc)
    minute = now.hour * 60 + now.minute
    around_now = ((minute - 60) % 1440, (minute + 60) % 1440, 0)
    long_over = ((minute - 180) % 1440, (minute - 120) % 1440, 0)
    assert asyncio.run(run(None)) > 0
    assert asyncio.run(run(around_now)) == 0
    assert asyncio.run(run(long_over)) > 0
