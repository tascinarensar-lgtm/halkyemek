from django.db.models import Count, Prefetch, Q
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from businesses.models import BusinessCategoryAssignment, BusinessMember, BusinessProfile, MarketplaceCategory
from businesses.services.membership import user_has_business_role
from menus.models import BusinessOffer, MediaAsset, MenuItem, MenuItemMarketplaceCategoryAssignment
from menus.serializers import (
    BusinessCategorySerializer,
    BusinessCategoryWriteSerializer,
    BusinessMenuItemSerializer,
    BusinessOfferSerializer,
)


MANAGEMENT_ROLES = [
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
]


def get_business_for_management_or_403(user, business_id: int) -> BusinessProfile:
    business = BusinessProfile.objects.filter(id=business_id).first()
    if not business:
        raise PermissionDenied("Business access denied.")

    if not user_has_business_role(user, business, MANAGEMENT_ROLES):
        raise PermissionDenied("Business management access required.")

    return business


class _BusinessManagementBase:
    permission_classes = [IsAuthenticated]

    def get_business(self):
        return get_business_for_management_or_403(self.request.user, self.kwargs["business_id"])

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["business"] = self.get_business()
        return context


def _get_business_category_rows(*, business: BusinessProfile):
    assignments = {
        assignment.marketplace_category_id: assignment
        for assignment in BusinessCategoryAssignment.objects.filter(
            business=business,
        ).select_related("marketplace_category")
    }
    menu_item_counts = {
        row["marketplace_category_id"]: row["count"]
        for row in MenuItemMarketplaceCategoryAssignment.objects.filter(
            menu_item__business=business,
            menu_item__is_active=True,
            menu_item__is_visible=True,
            menu_item__is_available=True,
        )
        .values("marketplace_category_id")
        .annotate(count=Count("menu_item_id", distinct=True))
    }

    rows = []
    for category in MarketplaceCategory.objects.filter(
        district=business.district,
        is_active=True,
    ).order_by("sort_order", "id"):
        assignment = assignments.get(category.id)
        rows.append(
            {
                "id": category.id,
                "assignment_id": getattr(assignment, "id", None),
                "slug": category.slug,
                "name": category.name,
                "description": category.description,
                "sort_order": getattr(assignment, "sort_order", category.sort_order),
                "is_active": bool(getattr(assignment, "is_active", False)),
                "is_primary": bool(getattr(assignment, "is_primary", False)),
                "is_selected": assignment is not None,
                "public_menu_item_count": int(menu_item_counts.get(category.id, 0)),
            }
        )
    return rows


def _assert_category_assignment_can_change(*, business: BusinessProfile, marketplace_category: MarketplaceCategory):
    linked_item_count = MenuItemMarketplaceCategoryAssignment.objects.filter(
        menu_item__business=business,
        marketplace_category=marketplace_category,
    ).count()
    if linked_item_count > 0:
        raise ValidationError(
            {
                "detail": (
                    "This category is still used by menu items. Remove it from linked menu items before deactivating or deleting it."
                )
            }
        )


class BusinessCategoryListCreateAPIView(_BusinessManagementBase, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        business = self.get_business()
        rows = _get_business_category_rows(business=business)
        return Response(BusinessCategorySerializer(rows, many=True).data)

    def post(self, request, *args, **kwargs):
        business = self.get_business()
        serializer = BusinessCategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        category_id = payload.get("marketplace_category")
        if category_id is None:
            raise ValidationError({"marketplace_category": "This field is required."})

        marketplace_category = MarketplaceCategory.objects.filter(
            id=category_id,
            district=business.district,
            is_active=True,
        ).first()
        if marketplace_category is None:
            raise ValidationError({"marketplace_category": "Selected system category is invalid for this business."})

        next_is_active = payload.get("is_active", True)
        next_is_primary = payload.get("is_primary", False)
        if next_is_primary and not next_is_active:
            raise ValidationError({"is_primary": "Primary category must stay active."})

        assignment, created = BusinessCategoryAssignment.objects.update_or_create(
            business=business,
            marketplace_category=marketplace_category,
            defaults={
                "is_active": next_is_active,
                "is_primary": next_is_primary,
                "sort_order": payload.get("sort_order", marketplace_category.sort_order),
            },
        )
        if assignment.is_primary:
            BusinessCategoryAssignment.objects.filter(
                business=business,
                is_active=True,
            ).exclude(id=assignment.id).update(is_primary=False)

        row = next(
            row for row in _get_business_category_rows(business=business) if row["id"] == marketplace_category.id
        )
        return Response(
            BusinessCategorySerializer(row).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BusinessCategoryDetailAPIView(_BusinessManagementBase, APIView):
    permission_classes = [IsAuthenticated]

    def _get_marketplace_category(self):
        business = self.get_business()
        marketplace_category = MarketplaceCategory.objects.filter(
            id=self.kwargs["category_id"],
            district=business.district,
            is_active=True,
        ).first()
        if marketplace_category is None:
            raise ValidationError({"detail": "System category could not be found for this business."})
        return marketplace_category

    def get(self, request, *args, **kwargs):
        business = self.get_business()
        marketplace_category = self._get_marketplace_category()
        row = next(
            row for row in _get_business_category_rows(business=business) if row["id"] == marketplace_category.id
        )
        return Response(BusinessCategorySerializer(row).data)

    def patch(self, request, *args, **kwargs):
        business = self.get_business()
        marketplace_category = self._get_marketplace_category()
        serializer = BusinessCategoryWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        assignment = BusinessCategoryAssignment.objects.filter(
            business=business,
            marketplace_category=marketplace_category,
        ).first()

        next_is_active = payload.get("is_active", getattr(assignment, "is_active", True))
        next_is_primary = payload.get("is_primary", getattr(assignment, "is_primary", False))
        if next_is_primary and not next_is_active:
            raise ValidationError({"is_primary": "Primary category must stay active."})
        if assignment is not None and not next_is_active:
            _assert_category_assignment_can_change(
                business=business,
                marketplace_category=marketplace_category,
            )

        assignment, _ = BusinessCategoryAssignment.objects.update_or_create(
            business=business,
            marketplace_category=marketplace_category,
            defaults={
                "is_active": next_is_active,
                "is_primary": next_is_primary,
                "sort_order": payload.get("sort_order", getattr(assignment, "sort_order", marketplace_category.sort_order)),
            },
        )
        if assignment.is_primary:
            BusinessCategoryAssignment.objects.filter(
                business=business,
                is_active=True,
            ).exclude(id=assignment.id).update(is_primary=False)

        row = next(
            row for row in _get_business_category_rows(business=business) if row["id"] == marketplace_category.id
        )
        return Response(BusinessCategorySerializer(row).data)

    def delete(self, request, *args, **kwargs):
        business = self.get_business()
        marketplace_category = self._get_marketplace_category()
        assignment = BusinessCategoryAssignment.objects.filter(
            business=business,
            marketplace_category=marketplace_category,
        ).first()
        if assignment is None:
            return Response(status=status.HTTP_204_NO_CONTENT)

        _assert_category_assignment_can_change(
            business=business,
            marketplace_category=marketplace_category,
        )
        assignment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BusinessMenuItemListCreateAPIView(_BusinessManagementBase, generics.ListCreateAPIView):
    serializer_class = BusinessMenuItemSerializer
    queryset = MenuItem.objects.none()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MenuItem.objects.none()
        business = self.get_business()
        return (
            MenuItem.objects.filter(business=business)
            .select_related("category")
            .prefetch_related(
                Prefetch(
                    "marketplace_category_assignments",
                    queryset=MenuItemMarketplaceCategoryAssignment.objects.select_related(
                        "marketplace_category"
                    ).order_by("-is_primary", "sort_order", "id"),
                    to_attr="prefetched_marketplace_category_assignments",
                ),
                Prefetch(
                    "media_assets",
                    queryset=MediaAsset.objects.filter(
                        is_active=True,
                        media_type=MediaAsset.MediaType.IMAGE,
                    ).order_by("sort_order", "id"),
                    to_attr="prefetched_management_media_assets",
                ),
            )
            .order_by("sort_order", "id")
        )

    def perform_create(self, serializer):
        serializer.save(business=self.get_business())


class BusinessMenuItemDetailAPIView(_BusinessManagementBase, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BusinessMenuItemSerializer
    lookup_url_kwarg = "menu_item_id"
    queryset = MenuItem.objects.none()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MenuItem.objects.none()
        business = self.get_business()
        return (
            MenuItem.objects.filter(business=business)
            .select_related("category")
            .prefetch_related(
                Prefetch(
                    "marketplace_category_assignments",
                    queryset=MenuItemMarketplaceCategoryAssignment.objects.select_related(
                        "marketplace_category"
                    ).order_by("-is_primary", "sort_order", "id"),
                    to_attr="prefetched_marketplace_category_assignments",
                ),
                Prefetch(
                    "media_assets",
                    queryset=MediaAsset.objects.filter(
                        is_active=True,
                        media_type=MediaAsset.MediaType.IMAGE,
                    ).order_by("sort_order", "id"),
                    to_attr="prefetched_management_media_assets",
                ),
            )
            .order_by("sort_order", "id")
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.is_visible = False
        instance.is_available = False
        instance.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BusinessOfferListCreateAPIView(_BusinessManagementBase, generics.ListCreateAPIView):
    serializer_class = BusinessOfferSerializer
    queryset = BusinessOffer.objects.none()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return BusinessOffer.objects.none()
        business = self.get_business()
        return (
            BusinessOffer.objects.filter(business=business)
            .select_related("menu_item")
            .prefetch_related(
                Prefetch(
                    "media_assets",
                    queryset=MediaAsset.objects.filter(
                        is_active=True,
                        media_type=MediaAsset.MediaType.IMAGE,
                    ).order_by("sort_order", "id"),
                    to_attr="prefetched_management_media_assets",
                )
            )
            .order_by("sort_order", "id")
        )

    def perform_create(self, serializer):
        serializer.save(business=self.get_business())


class BusinessOfferDetailAPIView(_BusinessManagementBase, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BusinessOfferSerializer
    queryset = BusinessOffer.objects.none()
    lookup_url_kwarg = "offer_id"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return BusinessOffer.objects.none()
        business = self.get_business()
        return (
            BusinessOffer.objects.filter(business=business)
            .select_related("menu_item")
            .prefetch_related(
                Prefetch(
                    "media_assets",
                    queryset=MediaAsset.objects.filter(
                        is_active=True,
                        media_type=MediaAsset.MediaType.IMAGE,
                    ).order_by("sort_order", "id"),
                    to_attr="prefetched_management_media_assets",
                )
            )
            .order_by("sort_order", "id")
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
