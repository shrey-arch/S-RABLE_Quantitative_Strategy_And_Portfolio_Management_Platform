"""The live session runner loop (Feature 7). It runs inside the FastAPI process
(setting live_runner_enabled) or on its own: `python -m app.services.live.worker`.
Run only one of the two at a time."""

import asyncio
import logging
import time

from starlette.concurrency import run_in_threadpool

from app.services.live.runner import runner

logger = logging.getLogger(__name__)
TICK_SECONDS = 1.0


async def runner_loop() -> None:
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            await run_in_threadpool(runner().tick)
        except Exception:
            logger.exception("Live runner tick failed.")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("Live paper session runner started (Ctrl+C to stop).")
    while True:
        try:
            runner().tick()
        except Exception:
            logger.exception("Live runner tick failed.")
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
