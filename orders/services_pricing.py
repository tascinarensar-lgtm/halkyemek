from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ValidationError


def get_customer_fixed_fee_kurus() -> int:
    value = int(getattr(settings, "CUSTOMER_FIXED_FEE_KURUS", 1000))
    if value < 0:
        raise ValidationError("CUSTOMER_FIXED_FEE_KURUS cannot be negative")
    return value


def get_business_fixed_fee_kurus() -> int:
    value = int(getattr(settings, "BUSINESS_FIXED_FEE_KURUS", 1000))
    if value < 0:
        raise ValidationError("BUSINESS_FIXED_FEE_KURUS cannot be negative")
    return value


@dataclass(frozen=True)
class PricingBreakdown:
    subtotal_amount: int
    customer_fee_amount: int
    business_fee_amount: int
    total_payable_amount: int
    business_net_amount: int
    platform_total_fee_amount: int
    currency: str = "TRY"

    def as_dict(self) -> dict:
        return {
            "subtotal_amount": int(self.subtotal_amount),
            "customer_fee_amount": int(self.customer_fee_amount),
            "business_fee_amount": int(self.business_fee_amount),
            "total_payable_amount": int(self.total_payable_amount),
            "business_net_amount": int(self.business_net_amount),
            "platform_total_fee_amount": int(self.platform_total_fee_amount),
            "currency": self.currency,
        }


def build_checkout_pricing_breakdown(*, subtotal_amount: int, currency: str = "TRY") -> PricingBreakdown:
    subtotal_amount = int(subtotal_amount)
    if subtotal_amount <= 0:
        raise ValidationError("subtotal_amount must be positive")

    customer_fee_amount = get_customer_fixed_fee_kurus()
    business_fee_amount = get_business_fixed_fee_kurus()
    total_payable_amount = subtotal_amount + customer_fee_amount
    business_net_amount = subtotal_amount - business_fee_amount
    platform_total_fee_amount = customer_fee_amount + business_fee_amount

    if business_net_amount < 0:
        raise ValidationError("business_net_amount cannot be negative for this subtotal")

    if total_payable_amount <= 0:
        raise ValidationError("total_payable_amount must be positive")

    return PricingBreakdown(
        subtotal_amount=subtotal_amount,
        customer_fee_amount=customer_fee_amount,
        business_fee_amount=business_fee_amount,
        total_payable_amount=total_payable_amount,
        business_net_amount=business_net_amount,
        platform_total_fee_amount=platform_total_fee_amount,
        currency=currency,
    )
