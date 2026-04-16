from __future__ import annotations


def payment_conversation_id(payment_intent_id: int) -> str:
    return f"HY-PI-{payment_intent_id}"


def payment_basket_item_id(order_id: int) -> str:
    return f"HY-ORDER-{order_id}"
