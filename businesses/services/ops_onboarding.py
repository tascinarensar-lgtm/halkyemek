from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction

from businesses.models import BusinessProfile
from payments.providers.iyzico_marketplace import onboard_submerchant


@dataclass(frozen=True)
class SubmerchantOnboardingOutcome:
    ok: bool
    business: BusinessProfile
    error_message: str = ""


@transaction.atomic
def run_submerchant_onboarding(*, business: BusinessProfile) -> SubmerchantOnboardingOutcome:
    """
    Admin/ops tarafından tetiklenen tek resmi onboarding akışı.

    İşletme iyzico tarafında create/update denemesi görür; nihai backend kararı,
    provider'dan dönen gerçek lifecycle state'i baz alır.
    """
    business = BusinessProfile.objects.select_for_update().get(pk=business.pk)
    previous_payout_status = business.payout_onboarding_status
    previous_iyzico_status = business.iyzico_submerchant_status
    previous_submerchant_key = business.iyzico_submerchant_key
    business.payout_onboarding_note = ""
    business.save(update_fields=["payout_onboarding_note"])

    business = onboard_submerchant(business=business)

    approved = (
        bool(business.iyzico_submerchant_key)
        and business.iyzico_submerchant_status == BusinessProfile.IyziSubmerchantStatus.ACTIVE
    )
    needs_review = business.iyzico_submerchant_status == BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW
    pending = business.iyzico_submerchant_status == BusinessProfile.IyziSubmerchantStatus.PENDING

    if approved:
        business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.APPROVED
        business.payout_onboarding_note = ""
        business.save(update_fields=["payout_onboarding_status", "payout_onboarding_note"])
        return SubmerchantOnboardingOutcome(ok=True, business=business)

    if needs_review:
        if previous_payout_status in {
            BusinessProfile.PayoutOnboardingStatus.APPROVED,
            BusinessProfile.PayoutOnboardingStatus.REJECTED,
        }:
            business.payout_onboarding_status = previous_payout_status
            if (
                previous_payout_status == BusinessProfile.PayoutOnboardingStatus.APPROVED
                and previous_iyzico_status == BusinessProfile.IyziSubmerchantStatus.ACTIVE
                and previous_submerchant_key
            ):
                business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
                business.iyzico_submerchant_key = previous_submerchant_key
        else:
            business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.NEEDS_REVIEW
            if previous_payout_status == BusinessProfile.PayoutOnboardingStatus.PENDING:
                business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.PENDING
                business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.PENDING
    elif pending:
        business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.PENDING
    else:
        business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.REJECTED

    business.payout_onboarding_note = (business.iyzico_last_error or "submerchant_failed")[:255]
    business.save(
        update_fields=[
            "payout_onboarding_status",
            "payout_onboarding_note",
            "iyzico_submerchant_status",
            "iyzico_submerchant_key",
        ]
    )

    return SubmerchantOnboardingOutcome(
        ok=False,
        business=business,
        error_message=business.iyzico_last_error or "Submerchant onboarding incomplete.",
    )
