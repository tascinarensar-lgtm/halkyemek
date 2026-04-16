from rest_framework.permissions import BasePermission
from businesses.services.membership import user_has_business_membership
from businesses.services.membership import user_has_business_role
from businesses.models import BusinessMember


class IsBusinessMember(BasePermission):
    message = "Business membership required."

    def has_object_permission(self, request, view, obj):
        return user_has_business_membership(request.user, obj)


class IsBusinessManagerOrOwner(BasePermission):
    message = "Manager or owner role required."

    def has_object_permission(self, request, view, obj):
        return user_has_business_role(
            request.user,
            obj,
            [
                BusinessMember.Role.MANAGER,
                BusinessMember.Role.OWNER,
            ],
        )


class IsBusinessCashierOrAbove(BasePermission):
    message = "Cashier role required."

    def has_object_permission(self, request, view, obj):
        return user_has_business_role(
            request.user,
            obj,
            [
                BusinessMember.Role.CASHIER,
                BusinessMember.Role.MANAGER,
                BusinessMember.Role.OWNER,
            ],
        )