from __future__ import annotations

from typing import Any, Iterable

from django.contrib.auth import get_user_model

from businesses.models import BusinessMember

User = get_user_model()


FINANCE_NOTIFICATION_ROLES = [
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
]

OPERATIONAL_NOTIFICATION_ROLES = [
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
    BusinessMember.Role.CASHIER,
]


def get_active_business_memberships(*, business, roles: Iterable[str] | None = None):
    qs = BusinessMember.objects.filter(
        business=business,
        is_active=True,
    ).select_related("user")
    if roles:
        qs = qs.filter(role__in=list(roles))
    return qs


def user_has_business_membership(user, business) -> bool:
    if not user or not user.is_authenticated:
        return False

    return get_active_business_memberships(business=business).filter(user=user).exists()


def user_has_business_role(user, business, roles: Iterable[str]) -> bool:
    if not user or not user.is_authenticated:
        return False

    return get_active_business_memberships(business=business, roles=roles).filter(user=user).exists()


def get_user_business_membership(user, business) -> BusinessMember | None:
    if not user or not user.is_authenticated:
        return None

    return (
        get_active_business_memberships(business=business)
        .filter(user=user)
        .first()
    )


def get_user_business_role(user, business) -> str | None:
    membership = get_user_business_membership(user, business)
    if membership is None:
        return None
    return str(membership.role)


def get_business_contact_email(business) -> str:
    """
    Final rule: contact email is sourced from business KYC metadata only.

    The BusinessProfile.contact_user relation is metadata-only and must not create
    runtime fallback behaviour for finance/ops flows.
    """
    return business.contact_email


def get_business_contact_gsm_number(business) -> str:
    """
    Final rule: GSM data comes from business KYC metadata only.

    Falling back to user.phone was a legacy assumption and leaked an implicit schema
    dependency because the custom User model does not define a phone field.
    """
    return business.contact_gsm_number


def get_business_contact_metadata(business) -> dict[str, Any]:
    """
    Canonical ops/admin representation for business contact data.

    The linked user is retained strictly as metadata/KYC provenance. Deliverable
    contact channels come from explicit business-owned KYC fields so response
    payloads never drift back into user-field fallback behaviour.
    """
    return {
        "contact_user_id": business.contact_user_id,
        "email": get_business_contact_email(business),
        "gsm_number": get_business_contact_gsm_number(business),
    }


def get_business_membership_users(*, business, roles: Iterable[str] | None = None):
    users: list[Any] = []
    seen_user_ids: set[int] = set()

    for membership in get_active_business_memberships(business=business, roles=roles):
        user = membership.user
        if user.pk in seen_user_ids:
            continue
        seen_user_ids.add(user.pk)
        users.append(user)

    return users


def get_business_finance_notification_users(business):
    return get_business_membership_users(
        business=business,
        roles=FINANCE_NOTIFICATION_ROLES,
    )


def get_business_operational_notification_users(business):
    return get_business_membership_users(
        business=business,
        roles=OPERATIONAL_NOTIFICATION_ROLES,
    )
