"""Indian equity delivery (CNC) charges for paper fills.

One table of rates, shown in the UI and stored with every fill. Rates as
published by NSE / SEBI / the Indian Stamp Act for equity delivery; the
platform's own brokerage is a flat amount per executed order set on the
account (default 0, as many discount brokers charge for delivery).
DP (depository) charges on sells are broker-specific and not modelled."""

from decimal import ROUND_HALF_UP, Decimal

RATES_AS_OF = "2024-10-01"

RATES = {
    "stt": {
        "label": "STT (securities transaction tax)",
        "rate": Decimal("0.001"),
        "applies_to": "BUY and SELL",
        "basis": "0.1% of the trade value",
    },
    "exchange": {
        "label": "Exchange transaction charge (NSE)",
        "rate": Decimal("0.0000297"),
        "applies_to": "BUY and SELL",
        "basis": "0.00297% of the trade value",
    },
    "sebi": {
        "label": "SEBI turnover fee",
        "rate": Decimal("0.000001"),
        "applies_to": "BUY and SELL",
        "basis": "Rs 10 per crore of the trade value",
    },
    "stamp_duty": {
        "label": "Stamp duty",
        "rate": Decimal("0.00015"),
        "applies_to": "BUY only",
        "basis": "0.015% of the trade value",
    },
    "gst": {
        "label": "GST",
        "rate": Decimal("0.18"),
        "applies_to": "BUY and SELL",
        "basis": "18% of brokerage + exchange charge + SEBI fee",
    },
}

CENT = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def calculate_charges(*, side: str, trade_value, brokerage) -> dict:
    """Charges of one fill. Every component is rounded to the paisa."""
    value = Decimal(str(trade_value))
    brokerage = _money(Decimal(str(brokerage)))
    stt = _money(value * RATES["stt"]["rate"])
    exchange = _money(value * RATES["exchange"]["rate"])
    sebi = _money(value * RATES["sebi"]["rate"])
    stamp = _money(value * RATES["stamp_duty"]["rate"]) if side == "BUY" else Decimal("0.00")
    gst = _money((brokerage + exchange + sebi) * RATES["gst"]["rate"])
    total = brokerage + stt + exchange + sebi + stamp + gst
    return {
        "brokerage": float(brokerage),
        "stt": float(stt),
        "exchange": float(exchange),
        "sebi": float(sebi),
        "stamp_duty": float(stamp),
        "gst": float(gst),
        "total": float(total),
    }


def rate_table() -> dict:
    return {
        "as_of": RATES_AS_OF,
        "product": "CNC (equity delivery)",
        "rates": [
            {
                "key": key,
                "label": item["label"],
                "rate": float(item["rate"]),
                "applies_to": item["applies_to"],
                "basis": item["basis"],
            }
            for key, item in RATES.items()
        ],
        "brokerage": "Flat amount per executed order, set on the paper account (default Rs 0).",
        "not_included": "DP charges on sells (depository fee, broker-specific).",
    }


# --- Feature 7: intraday (MIS) equity, as on the same date -----------------------------

MIS_RATES = {
    "stt": {
        "label": "STT (securities transaction tax)",
        "rate": Decimal("0.00025"),
        "applies_to": "SELL only",
        "basis": "0.025% of the trade value",
    },
    "exchange": RATES["exchange"],
    "sebi": RATES["sebi"],
    "stamp_duty": {
        "label": "Stamp duty",
        "rate": Decimal("0.00003"),
        "applies_to": "BUY only",
        "basis": "0.003% of the trade value",
    },
    "gst": RATES["gst"],
}


def calculate_mis_charges(*, side: str, trade_value, brokerage) -> dict:
    """Charges of one intraday (MIS) fill. Every component is rounded to the paisa."""
    value = Decimal(str(trade_value))
    brokerage = _money(Decimal(str(brokerage)))
    stt = _money(value * MIS_RATES["stt"]["rate"]) if side == "SELL" else Decimal("0.00")
    exchange = _money(value * MIS_RATES["exchange"]["rate"])
    sebi = _money(value * MIS_RATES["sebi"]["rate"])
    stamp = _money(value * MIS_RATES["stamp_duty"]["rate"]) if side == "BUY" else Decimal("0.00")
    gst = _money((brokerage + exchange + sebi) * MIS_RATES["gst"]["rate"])
    total = brokerage + stt + exchange + sebi + stamp + gst
    return {
        "brokerage": float(brokerage),
        "stt": float(stt),
        "exchange": float(exchange),
        "sebi": float(sebi),
        "stamp_duty": float(stamp),
        "gst": float(gst),
        "total": float(total),
    }


def mis_rate_table() -> dict:
    return {
        "as_of": RATES_AS_OF,
        "product": "MIS (equity intraday)",
        "rates": [
            {
                "key": key,
                "label": item["label"],
                "rate": float(item["rate"]),
                "applies_to": item["applies_to"],
                "basis": item["basis"],
            }
            for key, item in MIS_RATES.items()
        ],
        "brokerage": "Flat amount per executed order, set on the paper account (default Rs 0).",
        "not_included": "Leverage and margin (live sessions trade without leverage).",
    }
