from __future__ import annotations

import sys
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from businesses.models import BusinessMember
from orders.throttles import LoginRateThrottle

"""
Login throttle:
- Prod’da brute-force’a karşı açık kalsın
- Test koşarken (python manage.py test) 429 yemesin diye kapansın
"""

def _is_running_tests() -> bool:
    return "test" in sys.argv


class LoginView(TokenObtainPairView):
    throttle_scope = "login"

    # Testte kapalı, normalde açık
    throttle_classes = [] if _is_running_tests() else [LoginRateThrottle]


class AuthMeBusinessSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    member_role = serializers.CharField()


class AuthMeResponseSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    data = serializers.DictField()


class AuthMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        memberships = list(
            BusinessMember.objects.filter(user=request.user, is_active=True)
            .select_related("business")
            .values("business_id", "business__business_name", "role")
            .order_by("business__business_name", "business_id")
        )

        return Response(
            {
                "ok": True,
                "data": {
                    "user": {
                        "id": request.user.pk,
                        "username": request.user.username,
                        "google_email": request.user.google_email,
                        "role": request.user.role,
                    },
                    "has_business_membership": bool(memberships),
                    "business_membership_count": len(memberships),
                    "businesses": [
                        {
                            "id": row["business_id"],
                            "name": row["business__business_name"],
                            "member_role": row["role"],
                        }
                        for row in memberships
                    ],
                },
            },
            status=status.HTTP_200_OK,
        )
