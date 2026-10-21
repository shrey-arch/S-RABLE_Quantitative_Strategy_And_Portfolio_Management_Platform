"""Paper trading (Feature 1, P1): the logged-in user's virtual NSE account.

Virtual money and simulated fills on delayed Yahoo Finance quotes. Nothing is
ever sent to a broker. Every route works on the current user's own account;
another user's order id answers 404."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import (
    Execution,
    Instrument,
    PaperDeployment,
    PaperDeploymentDay,
    PaperEquitySnapshot,
    PaperFill,
    PaperOrder,
    Strategy,
    User,
)
from app.schemas.paper import (
    AccountOut,
    AccountPerformance,
    DeploymentDetail,
    DeploymentOut,
    DeployRequest,
    FromValidationRequest,
    JournalRequest,
    RunDueOut,
    ChargesTable,
    FillOut,
    HoldingOut,
    ModifyOrderRequest,
    OrderOut,
    OrderRequest,
    PreviewOut,
    QuoteRow,
    ResetRequest,
    SettingsRequest,
    WatchlistRequest,
)
from app.services.paper import clock
from app.services.paper import deployments as deploy
from app.services.paper import service as paper
from app.services.paper.charges import rate_table
from app.services.paper.quotes import DELAY_NOTE, SOURCE, quote_payload, try_quote

router = APIRouter(prefix="/paper", tags=["Paper trading"])


def _refuse(exc: paper.PaperError):
    raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


def _iso(value):
    return value.isoformat() if value is not None else None


def _num(value):
    return float(value) if value is not None else None


def _symbols(db: Session, ids) -> dict:
    ids = list({i for i in ids})
    if not ids:
        return {}
    return {i.id: i.symbol for i in db.scalars(select(Instrument).where(Instrument.id.in_(ids)))}


def _account_out(db: Session, account) -> AccountOut:
    view = paper.account_view(db, account)
    return AccountOut(
        id=str(account.id),
        initial_cash=float(account.initial_cash),
        cash=float(account.cash),
        blocked_cash=view["blocked_cash"],
        available_cash=view["available_cash"],
        invested=view["invested"],
        holdings_value=view["holdings_value"],
        live_positions_value=view["live_positions_value"],
        unrealised_pnl=view["unrealised_pnl"],
        realised_pnl=float(account.realised_pnl),
        total_charges=float(account.total_charges),
        equity=view["equity"],
        total_pnl=view["total_pnl"],
        holdings_count=view["holdings_count"],
        all_priced=view["all_priced"],
        slippage_bps=float(account.slippage_bps),
        brokerage_per_order=float(account.brokerage_per_order),
        watchlist=list(account.watchlist or []),
        reset_count=account.reset_count,
        last_reset_at=_iso(account.last_reset_at),
        created_at=account.created_at.isoformat(),
        market=clock.market_status(clock.now_utc()),
        price_source={"name": SOURCE, "delayed": True, "note": DELAY_NOTE},
    )


def _order_out(row: PaperOrder, symbol: str) -> OrderOut:
    return OrderOut(
        id=str(row.id),
        instrument_id=str(row.instrument_id),
        symbol=symbol,
        side=row.side,
        order_type=row.order_type,
        product=row.product,
        quantity=row.quantity,
        price=_num(row.price),
        trigger_price=_num(row.trigger_price),
        status=row.status,
        status_message=row.status_message,
        session_date=row.session_date,
        after_market=row.after_market,
        placed_at=row.created_at.isoformat(),
        triggered_at=_iso(row.triggered_at),
        filled_at=_iso(row.filled_at),
        average_price=_num(row.average_price),
        reserved_amount=_num(row.reserved_amount),
        source=row.source,
        deployment_id=str(row.deployment_id) if row.deployment_id else None,
        note=row.note,
        tags=list(row.tags or []),
    )


@router.get("/account", response_model=AccountOut)
def get_account(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The account (created with Rs 10,00,000 on first use). Open orders are
    matched against the latest quotes first."""
    return _account_out(db, paper.refresh_account(db, current_user))


@router.post("/account/reset", response_model=AccountOut)
def reset_account(
    request: ResetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete every order, fill and holding and start again with the given cash."""
    try:
        account = paper.reset_account(db, current_user, request.initial_cash)
    except paper.PaperError as exc:
        _refuse(exc)
    return _account_out(db, account)


@router.patch("/account/settings", response_model=AccountOut)
def update_settings(
    request: SettingsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    account = paper.update_settings(
        db,
        current_user,
        slippage_bps=request.slippage_bps,
        brokerage_per_order=request.brokerage_per_order,
    )
    return _account_out(db, account)


@router.put("/watchlist", response_model=AccountOut)
def set_watchlist(
    request: WatchlistRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        account = paper.set_watchlist(db, current_user, request.instrument_ids)
    except paper.PaperError as exc:
        _refuse(exc)
    return _account_out(db, account)


@router.get("/quotes", response_model=list[QuoteRow])
def get_quotes(
    instrument_id: list[UUID] = Query(default=[], max_length=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Latest quotes (cached 60 s; may be delayed up to about 15 minutes)."""
    rows = []
    for instrument_id_ in dict.fromkeys(instrument_id):
        instrument = db.get(Instrument, instrument_id_)
        if instrument is None:
            continue
        quote, problem = try_quote(instrument)
        rows.append(
            QuoteRow(
                instrument_id=str(instrument.id),
                symbol=instrument.symbol,
                name=instrument.name,
                quote=quote_payload(quote) if quote else None,
                problem=problem,
            )
        )
    return rows


@router.get("/charges", response_model=ChargesTable)
def get_charges(current_user: User = Depends(get_current_user)):
    """The charge rates applied to every paper fill."""
    return rate_table()


def _input(request) -> paper.OrderInput:
    return paper.OrderInput(
        side=request.side,
        order_type=request.order_type,
        quantity=request.quantity,
        price=request.price,
        trigger_price=request.trigger_price,
    )


@router.post("/orders/preview", response_model=PreviewOut)
def preview_order(
    request: OrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Estimated price, value, charges and funds check. Nothing is placed."""
    try:
        result = paper.preview_order(db, current_user, request.instrument_id, _input(request))
    except paper.PaperError as exc:
        _refuse(exc)
    result["quote"] = quote_payload(result["quote"]) if result["quote"] else None
    return PreviewOut(**result)


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def place_order(
    request: OrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        row = paper.place_order(db, current_user, request.instrument_id, _input(request))
    except paper.PaperError as exc:
        _refuse(exc)
    return _order_out(row, _symbols(db, [row.instrument_id])[row.instrument_id])


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    status_filter: Literal["OPEN", "TRIGGER_PENDING", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"] | None = Query(
        default=None, alias="status"
    ),
    open_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Newest first. `open_only` = OPEN and TRIGGER_PENDING."""
    account = paper.refresh_account(db, current_user)
    statement = select(PaperOrder).where(PaperOrder.account_id == account.id)
    if open_only:
        statement = statement.where(PaperOrder.status.in_(paper.LIVE))
    elif status_filter:
        statement = statement.where(PaperOrder.status == status_filter)
    rows = db.scalars(statement.order_by(PaperOrder.created_at.desc(), PaperOrder.id)).all()
    names = _symbols(db, [r.instrument_id for r in rows])
    return [_order_out(r, names[r.instrument_id]) for r in rows]


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = paper.refresh_account(db, current_user)
    try:
        row = paper._owned_order(db, account, order_id)
    except paper.PaperError as exc:
        _refuse(exc)
    return _order_out(row, _symbols(db, [row.instrument_id])[row.instrument_id])


@router.patch("/orders/{order_id}", response_model=OrderOut)
def modify_order(
    order_id: UUID,
    request: ModifyOrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        row = paper.modify_order(
            db,
            current_user,
            order_id,
            quantity=request.quantity,
            price=request.price,
            trigger_price=request.trigger_price,
        )
    except paper.PaperError as exc:
        _refuse(exc)
    return _order_out(row, _symbols(db, [row.instrument_id])[row.instrument_id])


@router.delete("/orders/{order_id}", response_model=OrderOut)
def cancel_order(order_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cancel an open order (it stays in the order book as CANCELLED)."""
    try:
        row = paper.cancel_order(db, current_user, order_id)
    except paper.PaperError as exc:
        _refuse(exc)
    return _order_out(row, _symbols(db, [row.instrument_id])[row.instrument_id])


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = paper.refresh_account(db, current_user)
    rows = paper.holdings_view(db, account)
    for r in rows:
        r["quote"] = quote_payload(r["quote"]) if r["quote"] else None
    return rows


@router.get("/fills", response_model=list[FillOut])
def list_fills(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every fill, newest first, with its charge breakdown."""
    account = paper.refresh_account(db, current_user)
    rows = db.scalars(
        select(PaperFill)
        .where(PaperFill.account_id == account.id)
        .order_by(PaperFill.filled_at.desc(), PaperFill.created_at.desc(), PaperFill.id)
    ).all()
    names = _symbols(db, [r.instrument_id for r in rows])
    return [
        FillOut(
            id=str(r.id),
            order_id=str(r.order_id),
            instrument_id=str(r.instrument_id),
            symbol=names[r.instrument_id],
            side=r.side,
            quantity=r.quantity,
            price=float(r.price),
            quote_price=float(r.quote_price),
            quote_time=r.quote_time.isoformat(),
            trade_value=float(r.trade_value),
            charges=r.charges,
            total_charges=float(r.total_charges),
            net_amount=float(r.net_amount),
            realised_pnl=_num(r.realised_pnl),
            filled_at=r.filled_at.isoformat(),
        )
        for r in rows
    ]


@router.patch("/orders/{order_id}/journal", response_model=OrderOut)
def update_journal(
    order_id: UUID,
    request: JournalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Your note and tags on an order (any status)."""
    account = paper.get_account(db, current_user)
    try:
        row = paper._owned_order(db, account, order_id, lock=True)
    except paper.PaperError as exc:
        _refuse(exc)
    tags = list(dict.fromkeys(t.strip()[:30] for t in request.tags if t.strip()))
    row.note = (request.note or "").strip() or None
    row.tags = tags
    db.commit()
    db.refresh(row)
    return _order_out(row, _symbols(db, [row.instrument_id])[row.instrument_id])


# --- P2: strategy deployments ---------------------------------------------------


def _deploy_refuse(exc: deploy.DeploymentError):
    raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


def _deployment_out(db: Session, dep: PaperDeployment, *, detail: bool = False):
    cash, held = deploy.sleeve(db, dep)
    names = _symbols(db, [UUID(i) for i in dep.instrument_ids])
    data = dict(
        id=str(dep.id),
        name=dep.name,
        strategy_id=str(dep.strategy_id) if dep.strategy_id else None,
        strategy_key=dep.strategy_key,
        strategy_version=dep.strategy_version,
        validation_id=str(dep.validation_id) if dep.validation_id else None,
        parameters=dep.parameters or {},
        rules=dep.rules,
        layout=dep.layout,
        instruments=[{"id": i, "symbol": names.get(UUID(i), "?")} for i in dep.instrument_ids],
        quantity=dep.quantity,
        capital=float(dep.capital),
        loss_limit=dep.loss_limit,
        start_date=dep.start_date,
        end_date=dep.end_date,
        status=dep.status,
        status_reason=dep.status_reason,
        last_processed_date=dep.last_processed_date,
        cash=float(cash),
        holdings=held,
        breaches=dep.breaches,
        created_at=dep.created_at.isoformat(),
        completed_at=_iso(dep.completed_at),
        performance=deploy.deployment_performance(db, dep),
    )
    if not detail:
        return DeploymentOut(**data)
    days = db.scalars(
        select(PaperDeploymentDay).where(PaperDeploymentDay.deployment_id == dep.id).order_by(PaperDeploymentDay.day.desc())
    ).all()
    data["days"] = [
        {
            "day": d.day,
            "closes": d.closes or {},
            "signal": d.signal,
            "allocations": d.allocations,
            "targets": d.targets or {},
            "orders": d.orders or [],
            "cash": _num(d.cash),
            "positions_value": _num(d.positions_value),
            "equity": _num(d.equity),
            "drawdown": d.drawdown,
            "note": d.note,
        }
        for d in days
    ]
    return DeploymentDetail(**data)


@router.post("/deployments", response_model=DeploymentOut, status_code=status.HTTP_201_CREATED)
def create_deployment(
    request: DeployRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The strategy trades the paper account at each close from the next session."""
    from types import SimpleNamespace

    from app.api.backtesting.routes import resolve_strategy_run
    from app.strategies.factory import instrument_layout

    resolved = resolve_strategy_run(
        db,
        SimpleNamespace(
            strategy_id=request.strategy_id,
            strategy_key=None,
            execution_config=request.execution_config,
            instrument_id=request.instrument_id,
            other_instrument_ids=request.other_instrument_ids,
        ),
        current_user,
    )
    if resolved.python_code is not None:
        # Feature 6: custom Python runs in the isolated sandbox, which starts a
        # fresh process per decision. That suits a backtest, a validation or a
        # test run, not a deployment that trades every close for weeks.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Custom Python code can be backtested, validated and test-run, but it "
                "cannot be deployed to the paper account yet. Deploy a strategy made from "
                "a core template or built without code."
            ),
        )
    try:
        dep = deploy.create_deployment(
            db,
            current_user,
            strategy=resolved.strategy,
            strategy_key=resolved.strategy_key,
            parameters=resolved.effective if resolved.rules is None else {},
            rules=resolved.rules,
            layout=instrument_layout(resolved.strategy_key),
            instrument_ids=[request.instrument_id, *request.other_instrument_ids],
            quantity=request.quantity,
            capital=request.capital,
            loss_limit=request.loss_limit,
            duration_days=request.duration_days,
        )
    except deploy.DeploymentError as exc:
        _deploy_refuse(exc)
    return _deployment_out(db, dep)


@router.post(
    "/deployments/from-validation/{validation_id}",
    response_model=DeploymentOut,
    status_code=status.HTTP_201_CREATED,
)
def start_paper_stage(
    validation_id: UUID,
    request: FromValidationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Validation stage 5: the validated strategy, instruments and parameters run
    on the paper account for 30 days; the result is written into the report."""
    from app.enums import ExecutionType
    from app.strategies.factory import instrument_layout
    from app.validation.pipeline import STAGES, normalize_paper_stage

    execution = db.get(Execution, validation_id)
    strategy = db.get(Strategy, execution.strategy_id) if execution else None
    if (
        execution is None
        or execution.execution_type != ExecutionType.VALIDATION
        or strategy is None
        or strategy.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Validation not found.")
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    report = normalize_paper_stage(dict(metrics.get("validation") or {}))
    stages = report.get("stages") or {}
    if not stages or any(stages[k]["status"] != "PASS" for k in STAGES[:4]):
        raise HTTPException(status_code=422, detail="Paper trading starts only after stages 1 to 4 pass.")
    if stages["paper_trading"]["status"] != "NOT_RUN":
        raise HTTPException(status_code=409, detail="Paper trading has already been started for this validation.")
    rs = execution.run_settings if isinstance(execution.run_settings, dict) else {}
    if rs.get("strategy_version") is not None and rs["strategy_version"] != strategy.version:
        raise HTTPException(
            status_code=422,
            detail="The strategy has changed since this validation. Validate it again before paper trading.",
        )
    strategy_key = rs.get("strategy_key")
    if strategy_key == "python":
        # Feature 6: stages 1 to 4 run a Python strategy in the sandbox, but stage 5
        # trades the paper account every close, which the sandbox is not shaped for.
        raise HTTPException(
            status_code=422,
            detail=(
                "This validation ran custom Python code, which cannot be deployed to the "
                "paper account yet. Stages 1 to 4 still give a verdict."
            ),
        )
    try:
        dep = deploy.create_deployment(
            db,
            current_user,
            strategy=strategy,
            strategy_key=strategy_key,
            parameters=execution.execution_config or {},
            rules=rs.get("rules"),
            layout=instrument_layout(strategy_key),
            instrument_ids=[execution.instrument_id, *[UUID(i) for i in rs.get("other_instrument_ids") or []]],
            quantity=int(rs.get("quantity") or 1),
            capital=request.capital,
            loss_limit=request.loss_limit,
            duration_days=deploy.STAGE5_DAYS,
            validation_id=execution.id,
        )
    except deploy.DeploymentError as exc:
        _deploy_refuse(exc)
    return _deployment_out(db, dep)


@router.get("/deployments", response_model=list[DeploymentOut])
def list_deployments(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = paper.get_account(db, current_user)
    rows = db.scalars(
        select(PaperDeployment)
        .where(PaperDeployment.account_id == account.id)
        .order_by(PaperDeployment.created_at.desc())
    ).all()
    return [_deployment_out(db, d) for d in rows]


@router.post("/deployments/run-due", response_model=RunDueOut)
def run_due_now(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Process your deployments up to the latest settled close now (the daily job
    also does this on its own). Safe to repeat."""
    return deploy.run_due(db, user=current_user)


@router.get("/deployments/{deployment_id}", response_model=DeploymentDetail)
def get_deployment(deployment_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        dep = deploy.owned(db, current_user, deployment_id)
    except deploy.DeploymentError as exc:
        _deploy_refuse(exc)
    return _deployment_out(db, dep, detail=True)


def _control(action: str):
    def handler(deployment_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        try:
            dep = deploy.set_status(db, current_user, deployment_id, action)
        except deploy.DeploymentError as exc:
            _deploy_refuse(exc)
        return _deployment_out(db, dep)

    handler.__name__ = f"{action}_deployment"
    return handler


for _action in ("pause", "resume", "stop"):
    router.add_api_route(
        f"/deployments/{{deployment_id}}/{_action}",
        _control(_action),
        methods=["POST"],
        response_model=DeploymentOut,
        name=f"{_action}_deployment",
    )


# --- P3: account performance ----------------------------------------------------


@router.get("/performance", response_model=AccountPerformance)
def account_performance(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The account's value at each close the daily job recorded, and its metrics."""
    account = paper.get_account(db, current_user)
    snaps = db.scalars(
        select(PaperEquitySnapshot).where(PaperEquitySnapshot.account_id == account.id).order_by(PaperEquitySnapshot.day)
    ).all()
    perf = deploy.metrics([float(s.equity) for s in snaps], float(account.initial_cash))
    perf.update(deploy.trade_stats(db, PaperOrder.account_id == account.id))
    return AccountPerformance(
        initial_cash=float(account.initial_cash),
        snapshots=[
            {"day": s.day, "cash": float(s.cash), "holdings_value": float(s.holdings_value), "equity": float(s.equity), "note": s.note}
            for s in snaps
        ],
        performance=perf,
        basis=[
            "The account's value is recorded at each close by the daily job (about 16:00 IST).",
            "Returns are day to day; annualised with 252 trading days; the Sharpe ratio uses a 6.5% a year risk-free rate.",
            "Win rate counts sells with a positive realised P&L (before charges).",
        ],
    )
