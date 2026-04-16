from rest_framework.permissions import BasePermission

from businesses.services.membership import user_has_business_membership
from businesses.models import BusinessProfile


class IsOrderOwner(BasePermission):
    """
    Customer sadece kendi order'ına erişebilir.
    """
    message = "Bu sipariş size ait değil."

    def has_object_permission(self, request, view, obj):
        return obj.user_id == request.user.pk


class IsOrderBusiness(BasePermission):
    """
    Business member sadece üyeliği olduğu işletmenin order'ına erişebilir.
    """
    message = "Bu sipariş bu işletmeye ait değil."

    def has_object_permission(self, request, view, obj):
        business = getattr(obj, "business", None)
        if business is None:
            business = BusinessProfile.objects.filter(id=obj.business_id).first()
        if business is None:
            return False
        return user_has_business_membership(request.user, business)


__all__ = ["IsOrderOwner", "IsOrderBusiness"]
