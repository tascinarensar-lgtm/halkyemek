from __future__ import annotations

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from rest_framework_simplejwt.tokens import RefreshToken

from accounts.google_oauth import verify_google_id_token
from accounts.models import User
from rest_framework import serializers

from accounts.serializers_google import GoogleLoginSerializer
from businesses.models import BusinessMember
from common.drf import enforce_json_content_type
from common.openapi import AUTH_LOGIN_SUCCESS_EXAMPLE, ApiErrorEnvelopeSerializer
from common.responses import error
from common.throttles import GoogleLoginThrottle


def _first_nonempty(*values: str | None) -> str:
    for value in values:
        if value:
            return value
    return ""


class GoogleLoginResponseSerializer(GoogleLoginSerializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    is_new = serializers.BooleanField()
    user = serializers.JSONField()
    has_business_membership = serializers.BooleanField()
    business_membership_count = serializers.IntegerField()
    businesses = serializers.JSONField()


class GoogleLoginAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [GoogleLoginThrottle]

    @extend_schema(
        operation_id="auth_google_login",
        request=GoogleLoginSerializer,
        responses={200: GoogleLoginResponseSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer, 500: ApiErrorEnvelopeSerializer},
        tags=["auth"],
        description="Google ID token ile giriş yapar, JWT access/refresh token döndürür. role alanı artık kabul edilmez.",
        examples=[AUTH_LOGIN_SUCCESS_EXAMPLE],
    )
    def post(self, request):
        enforce_json_content_type(request)

        if "role" in request.data:
            return error("role_not_allowed", "role field is not allowed.", status=status.HTTP_400_BAD_REQUEST, request=request)

        if not getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
            return error("google_oauth_not_configured", "Google OAuth is not configured.", status=status.HTTP_500_INTERNAL_SERVER_ERROR, request=request)

        ser = GoogleLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            claims = verify_google_id_token(ser.validated_data["id_token"])
        except Exception as exc:
            return error("google_token_invalid", str(exc), status=status.HTTP_400_BAD_REQUEST, request=request)

        if claims.email and not claims.email_verified:
            return error("email_not_verified", "Email not verified.", status=status.HTTP_400_BAD_REQUEST, request=request)

        with transaction.atomic():
            user = User.objects.select_for_update().filter(google_sub=claims.sub).first()

            if user is None and claims.email and claims.email_verified:
                user = (
                    User.objects.select_for_update()
                    .filter(google_sub="")
                    .filter(google_email=claims.email)
                    .first()
                )
                if user is None:
                    user = (
                        User.objects.select_for_update()
                        .filter(google_sub="")
                        .filter(email__iexact=claims.email)
                        .first()
                    )

            is_new = user is None

            if is_new:
                username_candidate = f"g_{claims.sub}"
                user = User.objects.create_user(
                    username=username_candidate[:150],
                    password=None,
                    role=User.Role.CUSTOMER,
                )

            assert user is not None

            if not user.is_active:
                return error("user_inactive", "User account is inactive.", status=status.HTTP_403_FORBIDDEN, request=request)

            update_fields: set[str] = set()

            if user.google_sub != claims.sub:
                user.google_sub = claims.sub
                update_fields.add("google_sub")

            if claims.email and user.google_email != claims.email:
                user.google_email = claims.email
                update_fields.add("google_email")

            if claims.email and user.email != claims.email:
                user.email = claims.email
                update_fields.add("email")

            if user.google_email_verified != claims.email_verified:
                user.google_email_verified = claims.email_verified
                update_fields.add("google_email_verified")

            if claims.picture and user.google_picture != claims.picture:
                user.google_picture = claims.picture
                update_fields.add("google_picture")

            first_name = _first_nonempty(user.first_name, claims.name)
            if first_name and user.first_name != first_name:
                user.first_name = first_name
                update_fields.add("first_name")

            if user.role != User.Role.ADMIN and user.role != User.Role.CUSTOMER:
                user.role = User.Role.CUSTOMER
                update_fields.add("role")

            if is_new or update_fields:
                user.save(update_fields=list(update_fields) or None)

        memberships = list(
            BusinessMember.objects.filter(user=user, is_active=True)
            .select_related("business")
            .values(
                "business_id",
                "business__business_name",
                "role",
            )
        )

        refresh = RefreshToken.for_user(user)

        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "is_new": is_new,
                "user": {
                    "id": user.pk,
                    "username": user.username,
                    "google_email": user.google_email,
                    "role": user.role,
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
            status=status.HTTP_200_OK,
        )
