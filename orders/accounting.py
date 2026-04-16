from __future__ import annotations

from typing import Any


def _coerce_int(value: Any, *, default: int = 0) -> int:
    if value in (None, ""):
        return int(default)
    return int(value)


def _normalized_currency(*values: Any) -> str:
    for value in values:
        normalized = str(value or "").strip().upper()
        if normalized:
            return normalized
    return "TRY"


def build_order_accounting_snapshot(*, order) -> dict[str, Any]:
    pricing_snapshot = dict(order.pricing_snapshot or {})
    subtotal_amount = _coerce_int(pricing_snapshot.get("subtotal_amount"), default=order.subtotal_amount or 0)
    customer_fee_amount = _coerce_int(pricing_snapshot.get("customer_fee_amount"), default=order.customer_fee_amount or 0)
    business_fee_amount = _coerce_int(pricing_snapshot.get("business_fee_amount"), default=order.business_fee_amount or 0)
    total_payable_amount = _coerce_int(
        pricing_snapshot.get("total_payable_amount"),
        default=pricing_snapshot.get("total_charged_amount", order.total_charged_amount or order.amount or 0),
    )
    business_net_amount = _coerce_int(pricing_snapshot.get("business_net_amount"), default=order.business_net_amount or 0)
    platform_total_fee_amount = _coerce_int(
        pricing_snapshot.get("platform_total_fee_amount"),
        default=customer_fee_amount + business_fee_amount,
    )
    item_count = _coerce_int(
        pricing_snapshot.get("item_count"),
        default=((order.order_snapshot or {}).get("cart_snapshot") or {}).get("item_count") or order.item_count or 0,
    )
    return {
        "subtotal_amount": subtotal_amount,
        "customer_fee_amount": customer_fee_amount,
        "business_fee_amount": business_fee_amount,
        "total_payable_amount": total_payable_amount,
        "business_net_amount": business_net_amount,
        "platform_total_fee_amount": platform_total_fee_amount,
        "item_count": item_count,
        "currency": _normalized_currency(pricing_snapshot.get("currency"), getattr(order, "currency", "TRY"), "TRY"),
    }


def collect_order_accounting_mismatches(*, order) -> list[dict[str, Any]]:
    expected = build_order_accounting_snapshot(order=order)
    mismatches: list[dict[str, Any]] = []

    field_map = {
        "subtotal_amount": int(order.subtotal_amount or 0),
        "customer_fee_amount": int(order.customer_fee_amount or 0),
        "business_fee_amount": int(order.business_fee_amount or 0),
        "total_payable_amount": int(order.total_charged_amount or order.amount or 0),
        "business_net_amount": int(order.business_net_amount or 0),
        "item_count": int(order.item_count or 0),
    }
    for field, actual in field_map.items():
        if actual != int(expected[field]):
            mismatches.append({
                "type": "ORDER_PRICING_SNAPSHOT_MISMATCH",
                "order_id": order.pk,
                "field": field,
                "actual": actual,
                "expected": int(expected[field]),
            })

    if int(order.amount or 0) != int(expected["total_payable_amount"]):
        mismatches.append({
            "type": "ORDER_AMOUNT_MISMATCH",
            "order_id": order.pk,
            "field": "amount",
            "actual": int(order.amount or 0),
            "expected": int(expected["total_payable_amount"]),
        })

    if int(expected["platform_total_fee_amount"]) != int(expected["customer_fee_amount"]) + int(expected["business_fee_amount"]):
        mismatches.append({
            "type": "ORDER_PLATFORM_FEE_MISMATCH",
            "order_id": order.pk,
            "platform_total_fee_amount": int(expected["platform_total_fee_amount"]),
            "customer_fee_amount": int(expected["customer_fee_amount"]),
            "business_fee_amount": int(expected["business_fee_amount"]),
        })

    if int(expected["business_net_amount"]) != int(expected["subtotal_amount"]) - int(expected["business_fee_amount"]):
        mismatches.append({
            "type": "ORDER_BUSINESS_NET_MISMATCH",
            "order_id": order.pk,
            "business_net_amount": int(expected["business_net_amount"]),
            "subtotal_amount": int(expected["subtotal_amount"]),
            "business_fee_amount": int(expected["business_fee_amount"]),
        })

    if int(expected["total_payable_amount"]) != int(expected["subtotal_amount"]) + int(expected["customer_fee_amount"]):
        mismatches.append({
            "type": "ORDER_TOTAL_PAYABLE_MISMATCH",
            "order_id": order.pk,
            "total_payable_amount": int(expected["total_payable_amount"]),
            "subtotal_amount": int(expected["subtotal_amount"]),
            "customer_fee_amount": int(expected["customer_fee_amount"]),
        })

    return mismatches


def collect_business_earning_mismatches(*, earning) -> list[dict[str, Any]]:
    order = getattr(earning, "order", None)
    if order is None:
        return []

    expected = build_order_accounting_snapshot(order=order)
    expected_currency = _normalized_currency(expected.get("currency"), earning.currency, "TRY")
    mismatches: list[dict[str, Any]] = []
    checks = {
        "gross_amount": (int(earning.gross_amount or 0), int(expected["subtotal_amount"])),
        "platform_fee_amount": (int(earning.platform_fee_amount or 0), int(expected["business_fee_amount"])),
        "net_amount": (int(earning.net_amount or 0), int(expected["business_net_amount"])),
    }
    for field, (actual, exp) in checks.items():
        if actual != exp:
            mismatches.append({
                "type": "EARNING_ORDER_ACCOUNTING_MISMATCH",
                "earning_id": earning.pk,
                "order_id": order.pk,
                "field": field,
                "actual": actual,
                "expected": exp,
            })

    actual_currency = _normalized_currency(earning.currency, "TRY")
    if actual_currency != expected_currency:
        mismatches.append({
            "type": "EARNING_ORDER_CURRENCY_MISMATCH",
            "earning_id": earning.pk,
            "order_id": order.pk,
            "field": "currency",
            "actual": actual_currency,
            "expected": expected_currency,
        })
    return mismatches
