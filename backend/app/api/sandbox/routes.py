"""Feature 6: the editor's test run and the context API reference.

POST /strategies/{id}/test-run runs a saved Python strategy over the last N
stored daily bars of a chosen instrument in the isolated sandbox. Nothing is
stored: it returns the signals, the logs, and - if the code fails - the
structured STRATEGY_CODE_ERROR with the line, the type and the bar.

GET /sandbox/reference returns the context API, the allowed imports and the
limits, so the editor's docs panel and the backend always agree.
"""

from __future__ import annotations

from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.data.loaders import MarketDatasetLoader
from app.enums import StrategyType, Timeframe
from app.db import get_db
from app.models import User
from app.quant.indicators.catalogue import INDICATORS
from app.sandbox import guard
from app.sandbox.limits import TEST_RUN_LIMITS
from app.sandbox.runner import SandboxUnavailable, StrategyCodeError, choose_backend, docker_available
from app.sandbox.strategy import SandboxStrategy
from app.schemas.sandbox import (
    SandboxReference,
    TestRunBar,
    TestRunRequest,
    TestRunResponse,
    TestRunSignal,
)
from app.services.instruments.instrument_service import InstrumentService
from app.services.strategies.strategy_service import StrategyService
from app.strategies.signal import SignalAction

router = APIRouter(tags=["Custom Python strategies"])

CONTEXT_API = [
    {
        "name": "context.bar",
        "signature": "context.bar.close",
        "returns": "number",
        "description": "This bar's open, high, low, close, volume, date (text) and index "
        "(0 for the first bar of the run).",
    },
    {
        "name": "context.history",
        "signature": "context.history(field, n)",
        "returns": "array of numbers",
        "description": "The last n values of 'open', 'high', 'low', 'close' or 'volume', "
        "ending with this bar. Shorter than n early in the run; never the future.",
    },
    {
        "name": "context.indicator",
        "signature": "context.indicator(name, ago=0, **params)",
        "returns": "number, None, or a dict for multi-output indicators",
        "description": "An indicator from the catalogue, computed ahead on the whole series "
        "with the same code the charts use. None during its warm-up. The parameters must be "
        "fixed numbers (period=20), not variables. ago=1 is the previous bar.",
    },
    {
        "name": "context.position",
        "signature": "context.position",
        "returns": "whole number",
        "description": "Shares held before this bar's signal: positive long, negative short, "
        "0 flat.",
    },
    {
        "name": "context.cash",
        "signature": "context.cash",
        "returns": "number",
        "description": "Cash available before this bar's signal.",
    },
    {
        "name": "context.params",
        "signature": "context.params",
        "returns": "dict",
        "description": "The parameters of this run (the backtest's execution_config).",
    },
    {
        "name": "context.log",
        "signature": "context.log(*parts)",
        "returns": "nothing",
        "description": "Shows a message in the run's log. print() does the same. Capped.",
    },
]

RETURN_VALUES = [
    {"value": "'BUY'", "meaning": "hold a long position of the run's quantity"},
    {"value": "'SELL'", "meaning": "hold a short position of the run's quantity"},
    {"value": "'EXIT'", "meaning": "hold nothing (close the position)"},
    {"value": "'HOLD'  (or None)", "meaning": "leave the position as it is"},
    {"value": "('BUY', 25)", "meaning": "hold 25 shares long: a size of your own"},
]

EXAMPLE = """import numpy as np


def generate_signal(context):
    \"\"\"Buy above the 20-bar average, sell below it.\"\"\"
    lookback = context.params.get("lookback", 20)
    closes = context.history("close", lookback)
    if len(closes) < lookback:
        return "HOLD"

    average = float(np.mean(closes))
    context.log(f"close={context.bar.close:.2f} average={average:.2f}")
    if context.bar.close > average:
        return "BUY"
    if context.bar.close < average:
        return "SELL"
    return "HOLD"
"""


@router.get("/sandbox/reference", response_model=SandboxReference)
def sandbox_reference(current_user: User = Depends(get_current_user)):
    """The context API, the rules and the limits, as the backend enforces them."""
    return SandboxReference(
        entry_point=f"{guard.ENTRY_POINT}(context)",
        allowed_imports=list(guard.ALLOWED_MODULES),
        context_api=CONTEXT_API,
        return_values=RETURN_VALUES,
        indicators=[
            {
                "key": spec.key,
                "name": spec.name,
                "outputs": list(spec.outputs),
                "parameters": [p.name for p in spec.parameters],
                "example": f'context.indicator("{spec.key}", '
                + ", ".join(f"{p.name}={int(p.default) if p.default is not None else 20}" for p in spec.parameters)
                + ")",
            }
            for spec in INDICATORS.values()
        ],
        limits=TEST_RUN_LIMITS.described(),
        rules=[
            "Only math, statistics, numpy and pandas can be imported.",
            "Files, the network, other processes and the clock are not available.",
            "Randomness is not allowed, so a run can be repeated exactly.",
            "Names with double underscores and private attributes are refused.",
            "The code runs in an isolated sandbox, one call per bar, under the limits below.",
        ],
        example=EXAMPLE,
        sandbox=choose_backend("auto"),
        docker_available=docker_available(),
        max_code_chars=guard.MAX_CODE_CHARS,
    )


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)


@router.post(
    "/strategies/{strategy_id}/test-run",
    response_model=TestRunResponse,
    responses={
        404: {"description": "The strategy or instrument was not found."},
        422: {"description": "The code was refused, or it failed while running."},
    },
)
def test_run(
    strategy_id: UUID,
    request: TestRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run the saved Python code over the last `bars` stored daily bars. Nothing
    is stored: the signals, the logs and any error come straight back."""
    strategy = StrategyService(db).get_strategy(strategy_id=strategy_id, user_id=current_user.id)
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found.")
    if strategy.strategy_type != StrategyType.PYTHON or not (strategy.python_code or "").strip():
        raise _unprocessable("This strategy has no Python code to run.")

    instrument = InstrumentService(db).get_instrument(instrument_id=request.instrument_id)
    if instrument is None:
        raise HTTPException(status_code=404, detail="Instrument not found.")

    dataset = MarketDatasetLoader(db).load(
        instrument_id=request.instrument_id, frequency=Timeframe.ONE_DAY
    )
    data = dataset.ohlcv
    if data is None or data.empty:
        raise _unprocessable(
            f"{instrument.symbol} has no stored daily bars. Import its history first."
        )
    data = data.tail(request.bars)

    code = strategy.python_code
    try:
        sandbox = SandboxStrategy(
            code,
            params=dict(request.parameters or {}),
            limits=TEST_RUN_LIMITS,
            collect_logs=True,
        )
    except StrategyCodeError as exc:
        raise HTTPException(status_code=422, detail=exc.detail) from None
    except SandboxUnavailable as exc:
        raise _unprocessable(str(exc)) from None

    signals: list[TestRunSignal] = []
    position = 0
    quantity = request.quantity
    error = None
    with sandbox:
        try:
            sandbox.prepare(data)
            for index, timestamp in enumerate(data.index):
                before = len(sandbox.logs)
                context = _Context(data, index, timestamp, position, float(request.cash))
                signal = sandbox.generate_signal(context)
                size = signal.quantity if signal.quantity is not None else quantity
                if signal.action == SignalAction.BUY:
                    target = size
                elif signal.action == SignalAction.SELL:
                    target = -size
                elif signal.action == SignalAction.EXIT:
                    target = 0
                else:
                    target = position
                signals.append(
                    TestRunSignal(
                        index=index,
                        date=pd.Timestamp(timestamp).isoformat(),
                        close=float(data["close"].iloc[index]),
                        action=signal.action.value,
                        quantity=signal.quantity,
                        position=target,
                        changed=target != position,
                        logs=[line["text"] for line in sandbox.logs[before:]],
                    )
                )
                position = target
        except StrategyCodeError as exc:
            error = exc.detail

    return TestRunResponse(
        strategy_id=str(strategy_id),
        instrument_id=str(request.instrument_id),
        symbol=instrument.symbol,
        bars=[
            TestRunBar(
                date=pd.Timestamp(ts).isoformat(),
                open=float(data["open"].iloc[i]),
                high=float(data["high"].iloc[i]),
                low=float(data["low"].iloc[i]),
                close=float(data["close"].iloc[i]),
                volume=float(data["volume"].iloc[i]),
            )
            for i, ts in enumerate(data.index)
        ],
        signals=signals,
        logs=[line["text"] for line in sandbox.logs],
        error=error,
        sandbox=(sandbox.info.backend if sandbox.info else choose_backend("auto")),
        limits=TEST_RUN_LIMITS.described(),
        simulation_only=True,
    )


class _Context:
    """What the sandbox session needs of a bar, outside the backtest engine."""

    def __init__(self, data: pd.DataFrame, index: int, timestamp, position: int, cash: float):
        self.instrument = None
        self.timestamp = pd.Timestamp(timestamp).to_pydatetime()
        self.market_data = {
            "data": data.iloc[: index + 1],
            "bar_index": index,
            "position_quantity": position,
            "cash": cash,
        }
