"""The tests always run against a LOCAL test database, never the one in .env.

The tests create and delete users, strategies, instruments and runs, so they must not
touch the app's real database (Supabase). Their database address is TEST_DATABASE_URL:
an environment variable, or a line in the file .env.test next to .env. It must be on
this computer (localhost or 127.0.0.1), or the tests do not start.

Before the first test, the test database's tables are brought up to date with the
migrations (alembic upgrade head), so a new migration needs no extra step.
"""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ENV_TEST_FILES = [BACKEND.parent / ".env.test", BACKEND / ".env.test"]
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _test_database_url() -> str | None:
    url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if url:
        return url
    for path in ENV_TEST_FILES:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == "TEST_DATABASE_URL":
                return value.strip().strip("'\"")
    return None


def _point_settings_at_the_test_database() -> None:
    url = _test_database_url()
    if not url:
        raise pytest.UsageError(
            "No test database: set TEST_DATABASE_URL, or add the line "
            "TEST_DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/srable_test "
            f"to {ENV_TEST_FILES[0]}. The tests never use DATABASE_URL from .env."
        )
    host = urlsplit(url).hostname
    if host not in LOCAL_HOSTS:
        raise pytest.UsageError(
            f"TEST_DATABASE_URL points at {host}, not this computer. The tests create and "
            "delete data, so they only run against a local database."
        )
    # Environment variables take priority over .env in app.config.settings. This runs
    # before any test module imports the app, so every engine and worker uses it.
    os.environ["DATABASE_URL"] = url
    os.environ["DEBUG"] = "False"  # no printing of every SQL statement


_point_settings_at_the_test_database()


def pytest_sessionstart(session):
    # In a separate process: alembic's logging setup would otherwise change the
    # logging of the tests.
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise pytest.UsageError(
            "Could not bring the test database up to date (alembic upgrade head):\n"
            + result.stderr[-3000:]
        )
