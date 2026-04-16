from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """
    Projedeki tek admin API standardı.

    Admin yetkisi yalnızca request.user.is_admin() üzerinden değerlendirilir;
    endpoint bazında DRF'nin IsAdminUser / is_staff semantiğine dağılınmaz.
    """

    message = "Admin access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin())
