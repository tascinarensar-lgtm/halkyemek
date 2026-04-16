from __future__ import annotations

from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated

from businesses.models import BusinessMember, BusinessProfile
from businesses.services.membership import user_has_business_role
from menus.models import MediaAsset
from menus.serializers import BusinessMediaAssetWriteSerializer, MediaAssetSerializer


MANAGEMENT_ROLES = [
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
]


def get_business_for_media_management_or_403(user, business_id: int) -> BusinessProfile:
    business = BusinessProfile.objects.filter(id=business_id).first()
    if not business:
        raise PermissionDenied("Business access denied.")

    if user.is_admin():
        return business

    if not user_has_business_role(user, business, MANAGEMENT_ROLES):
        raise PermissionDenied("Business media management access required.")

    return business


class BusinessMediaAssetListCreateAPIView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    serializer_class = MediaAssetSerializer
    queryset = MediaAsset.objects.none()

    def get_business(self):
        return get_business_for_media_management_or_403(
            self.request.user,
            self.kwargs["business_id"],
        )

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MediaAsset.objects.none()
        business = self.get_business()
        return MediaAsset.objects.filter(business=business).select_related(
            "menu_item",
            "marketplace_category",
            "offer",
            "uploaded_by",
        ).order_by("sort_order", "id")

    def get_serializer_class(self):
        if self.request.method == "POST":
            return BusinessMediaAssetWriteSerializer
        return MediaAssetSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["business"] = self.get_business()
        return context

    def perform_create(self, serializer):
        business = self.get_business()
        payload = serializer.validated_data
        has_target = any(
            payload.get(field) is not None
            for field in ["menu_item", "marketplace_category", "offer"]
        )
        if has_target:
            serializer.save(uploaded_by=self.request.user)
            return
        serializer.save(
            business=business,
            uploaded_by=self.request.user,
        )


class BusinessMediaAssetDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    serializer_class = MediaAssetSerializer
    lookup_url_kwarg = "media_asset_id"
    queryset = MediaAsset.objects.none()

    def get_business(self):
        return get_business_for_media_management_or_403(
            self.request.user,
            self.kwargs["business_id"],
        )

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MediaAsset.objects.none()
        business = self.get_business()
        return MediaAsset.objects.filter(business=business).select_related(
            "menu_item",
            "marketplace_category",
            "offer",
            "uploaded_by",
        ).order_by("sort_order", "id")

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return BusinessMediaAssetWriteSerializer
        return MediaAssetSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["business"] = self.get_business()
        return context
