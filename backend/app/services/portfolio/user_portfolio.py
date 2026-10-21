"""Portfolio orchestration on the user's own strategies (Phase 14).

The candidates are the user's saved strategies, each scored as on the scoring
page (Phase 13: latest completed backtest, stored daily closes, default
weights). A strategy's asset is the instrument it was scored on, named by its
unique trading symbol. Strategies that cannot be allocated are returned with a
reason: not scored, a pair strategy (two instruments and no single asset to
hold), or not compatible with the chosen regime of the active regime model
(Phase 12 rule table). By default only validated strategies are eligible
(Feature 5: VALIDATED or VALIDATED_PAPER_PENDING of the current version); the
others are listed with their validation reason unless require_validated is off. Capital is split by score (PortfolioAllocationService)
and then limited (PortfolioRiskService). Everything here is a calculation:
nothing is stored and no order is placed.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import Timeframe
from app.ml.factor_definitions import REGIME_RULES, regime_compatibility
from app.models import Instrument, MarketData
from app.services.portfolio.allocation_service import PortfolioAllocationService
from app.services.portfolio.orchestrator import (
    PortfolioRebalancePlan,
    TargetPortfolio,
    TargetPortfolioPosition,
)
from app.services.portfolio.risk_service import PortfolioRiskLimits, PortfolioRiskService
from app.services.regime import service as regime_service
from app.services.scoring.service import score_strategies

CENT = Decimal("0.01")
WEIGHT = Decimal("0.000001")
PAIR_REASON = (
    "Pair strategies trade two instruments against each other, so there is no "
    "single asset to hold; they are not allocated."
)
NO_INSTRUMENT = "The instrument it was scored on no longer exists."
NOT_FOUND = "One or more strategies were not found."


def regime_label(db: Session, code: str | None) -> dict | None:
    """The active regime model's regime with this code (R1, R2, ...)."""
    if code is None:
        return None
    record = regime_service.active_model(db)
    if record is None:
        raise ValueError("No regime model has been trained, so a regime cannot be chosen.")
    for row in record.model_metadata["labels"]["regimes"]:
        if row["code"] == code:
            return {
                "code": row["code"],
                "name": row["name"],
                "volatility_state": row["volatility_state"],
                "trend_state": row["trend_state"],
                "model_number": record.number,
            }
    raise ValueError(f"{code} is not one of the active regime model's regimes.")


def select_candidates(
    db: Session,
    user_id: UUID,
    strategy_ids: Sequence[UUID],
    regime: dict | None,
    require_validated: bool = True,
) -> tuple[list[dict], list[dict]]:
    """The chosen strategies that can be allocated, and those that cannot (with why).
    With require_validated, a strategy without an eligible validation is not
    allocated and its validation reason is given first."""
    ids = list(dict.fromkeys(strategy_ids))
    rows = {row["strategy_id"]: row for row in score_strategies(db, user_id)["rows"]}
    if any(i not in rows for i in ids):
        raise ValueError(NOT_FOUND)

    included: list[dict] = []
    excluded: list[dict] = []
    for strategy_id in ids:
        row = rows[strategy_id]
        key = row["strategy_key"]
        asset = None
        reason = None
        validation = row["validation"]
        if require_validated and not validation["eligible"]:
            reason = validation["reason"]
        elif row["status"] != "SCORED":
            reason = row["reason"]
        elif key == "statistical_arbitrage":
            reason = PAIR_REASON
        else:
            instrument = db.get(Instrument, row["instruments"][0]["id"])
            if instrument is None:
                reason = NO_INSTRUMENT
            else:
                asset = instrument.trading_symbol
            if reason is None and asset is not None and regime is not None:
                if regime_compatibility(key, regime)["status"] == "NOT_COMPATIBLE":
                    reason = f"{REGIME_RULES[key]['rule']} Chosen regime: {regime['name']}."
        entry = {
            "strategy_id": strategy_id,
            "name": row["name"],
            "strategy_key": key,
            "asset": asset,
            "score": row["composite_score"],
            "validation": validation,
        }
        if reason is None:
            included.append(entry)
        else:
            excluded.append({**entry, "reason": reason})
    return included, excluded


def build_user_target(
    db: Session,
    user_id: UUID,
    capital: Decimal,
    strategy_ids: Sequence[UUID],
    *,
    regime_code: str | None = None,
    limits: PortfolioRiskLimits | None = None,
    require_validated: bool = True,
) -> tuple[TargetPortfolio, dict]:
    """A target portfolio of the user's strategies, and what describes it."""
    regime = regime_label(db, regime_code)
    included, excluded = select_candidates(db, user_id, strategy_ids, regime, require_validated)
    if not included:
        raise ValueError(
            "None of the chosen strategies can be allocated. "
            + " ".join(f"{e['name']}: {e['reason']}" for e in excluded)
        )

    by_key = {str(c["strategy_id"]): c for c in included}
    proposed = PortfolioAllocationService.allocate(
        capital, {key: c["score"] for key, c in by_key.items()}
    )
    risk = PortfolioRiskService.constrain(
        capital,
        {item.strategy: item.amount for item in proposed},
        limits,
        strategy_assets={key: c["asset"] for key, c in by_key.items()},
    )
    amounts = {item.strategy: item.amount for item in risk.allocations}
    order = sorted(by_key, key=lambda k: (-by_key[k]["score"], by_key[k]["name"], k))
    target = TargetPortfolio(
        capital=Decimal(str(capital)).quantize(CENT),
        regime=regime_code,
        positions=tuple(
            TargetPortfolioPosition(
                strategy=key,
                asset=by_key[key]["asset"],
                score=by_key[key]["score"],
                amount=amounts[key],
            )
            for key in order
        ),
        risk_result=risk,
    )
    return target, {
        "strategies": by_key,
        "excluded": excluded,
        "regime": regime,
        "require_validated": require_validated,
    }


def latest_prices(db: Session, assets: Sequence[str]) -> list[dict]:
    """Each asset's latest stored daily close, found by trading symbol."""
    out = []
    for asset in dict.fromkeys(assets):
        instrument = db.scalar(select(Instrument).where(Instrument.trading_symbol == asset))
        item = {"asset": asset, "instrument_id": None, "price": None, "as_of": None, "reason": None}
        out.append(item)
        if instrument is None:
            item["reason"] = "No instrument has this trading symbol."
            continue
        item["instrument_id"] = instrument.id
        bar = db.scalar(
            select(MarketData)
            .where(
                MarketData.instrument_id == instrument.id,
                MarketData.timeframe == Timeframe.ONE_DAY,
            )
            .order_by(MarketData.timestamp.desc())
            .limit(1)
        )
        if bar is None:
            item["reason"] = "No stored daily bars for this instrument."
            continue
        item["price"] = Decimal(str(bar.close)).quantize(CENT, rounding=ROUND_HALF_UP)
        item["as_of"] = pd.Timestamp(bar.timestamp).isoformat()
    return out


def _weight(value: Decimal, total: Decimal) -> Decimal:
    return (value / total).quantize(WEIGHT, rounding=ROUND_HALF_UP) if total > 0 else Decimal("0")


def rebalance_assets(plan: PortfolioRebalancePlan, prices: dict) -> list[dict]:
    """Per asset: current position, target, the proposed trade and the result."""
    equity = plan.current_state.total_equity
    holdings = {h.asset: h for h in plan.current_state.holdings}
    targets = plan.rebalancing.target_values
    trades = {t.asset: t for t in plan.rebalancing.trades}
    rows = []
    for asset in sorted(set(holdings) | set(targets)):
        holding = holdings.get(asset)
        quantity = holding.quantity if holding else 0
        price = Decimal(str(prices[asset])) if asset in prices else holding.price
        current_value = (price * quantity).quantize(CENT)
        target_value = Decimal(str(targets.get(asset, Decimal("0.00"))))
        trade = trades.get(asset)
        change = 0 if trade is None else trade.quantity if trade.side == "BUY" else -trade.quantity
        ending_quantity = quantity + change
        rows.append(
            {
                "asset": asset,
                "price": price,
                "current_quantity": quantity,
                "current_value": current_value,
                "current_weight": _weight(current_value, equity),
                "target_value": target_value,
                "target_weight": _weight(target_value, equity),
                "action": trade.side if trade else "HOLD",
                "trade_quantity": trade.quantity if trade else 0,
                "trade_value": trade.value if trade else Decimal("0.00"),
                "ending_quantity": ending_quantity,
                "ending_value": (price * ending_quantity).quantize(CENT),
            }
        )
    return rows


def ending_state(plan: PortfolioRebalancePlan, assets: list[dict]) -> dict:
    """Cash and holdings if every proposed trade were filled at its price."""
    holdings = [
        {"asset": a["asset"], "quantity": a["ending_quantity"], "price": a["price"]}
        for a in assets
        if a["ending_quantity"] > 0
    ]
    invested = sum((a["ending_value"] for a in assets), Decimal("0.00"))
    cash = plan.rebalancing.ending_cash
    return {
        "cash": cash,
        "invested_value": invested,
        "total_equity": cash + invested,
        "holdings": holdings,
    }


def fill_prices(
    db: Session,
    target: TargetPortfolio,
    given: dict,
    holdings: dict,
) -> tuple[dict, list[dict]]:
    """Prices for the rebalance: the ones given, the held assets' own, and for
    target assets with neither, the latest stored daily close."""
    prices = {asset: Decimal(str(price)) for asset, price in given.items()}
    used = {
        asset: {"asset": asset, "price": price, "source": "given", "as_of": None}
        for asset, price in prices.items()
    }
    for asset, (quantity, price) in holdings.items():
        if asset not in prices and quantity > 0:
            used[asset] = {"asset": asset, "price": Decimal(str(price)), "source": "holding", "as_of": None}
    missing = [a for a in target.target_values() if a not in used]
    for item in latest_prices(db, missing):
        if item["price"] is None:
            raise ValueError(f"No price for {item['asset']}: {item['reason']}")
        prices[item["asset"]] = item["price"]
        used[item["asset"]] = {
            "asset": item["asset"],
            "price": item["price"],
            "source": "latest_close",
            "as_of": item["as_of"],
        }
    return prices, [used[a] for a in sorted(used)]
