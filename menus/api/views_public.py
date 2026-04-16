from __future__ import annotations

from collections import OrderedDict

from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework import generics, serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from businesses.models import BusinessCategoryAssignment, BusinessProfile, MarketplaceCategory
from businesses.serializers import PublicBusinessSerializer
from common.pagination import DefaultPagination
from menus.models import BusinessOffer, MediaAsset, MenuItem, MenuItemMarketplaceCategoryAssignment
from menus.serializers import (
    DiscoveryBusinessCardSerializer,
    DiscoveryCategoryListResponseSerializer,
    DiscoveryHomeResponseSerializer,
    DiscoveryMarketplaceCategorySerializer,
    PublicBusinessDetailResponseSerializer,
    PublicBusinessListResponseSerializer,
    PublicBusinessMenuResponseSerializer,
    PublicCategorySerializer,
    PublicMediaAssetSerializer,
    PublicOfferSerializer,
)
from common.openapi import ApiErrorEnvelopeSerializer
from common.responses import error
from notifications.models import Device
from orders.models import Cart
from wallets.models import Wallet


def _public_business_queryset(*, district: str | None = None):
    qs = BusinessProfile.objects.filter(
        is_active=True,
        is_approved=True,
        is_listed=True,
        marketplace_is_visible=True,
    ).prefetch_related(
        Prefetch(
            "marketplace_categories",
            queryset=BusinessCategoryAssignment.objects.filter(
                is_active=True,
                marketplace_category__is_active=True,
            ).select_related("marketplace_category").order_by("-is_primary", "sort_order", "id"),
            to_attr="prefetched_active_category_assignments",
        ),
        Prefetch(
            "media_assets",
            queryset=MediaAsset.objects.filter(
                is_active=True,
                media_type=MediaAsset.MediaType.IMAGE,
            ).order_by("sort_order", "id"),
            to_attr="prefetched_public_media_assets",
        ),
    )

    if district:
        qs = qs.filter(district=district)
    return qs


def _live_offer_queryset(*, district: str | None = None):
    now = timezone.now()
    qs = BusinessOffer.objects.filter(
        is_active=True,
        starts_at__lte=now,
        ends_at__gt=now,
        business__is_active=True,
        business__is_approved=True,
        business__is_listed=True,
        business__marketplace_is_visible=True,
    ).select_related("business", "menu_item").prefetch_related(
        Prefetch(
            "media_assets",
            queryset=MediaAsset.objects.filter(
                is_active=True,
                media_type=MediaAsset.MediaType.IMAGE,
            ).order_by("sort_order", "id"),
            to_attr="prefetched_public_media_assets",
        )
    ).order_by("-is_featured", "sort_order", "id")

    if district:
        qs = qs.filter(business__district=district)
    return qs


def _group_business_menu_by_marketplace_category(*, business: BusinessProfile):
    menu_item_media = MediaAsset.objects.filter(
        is_active=True,
        media_type=MediaAsset.MediaType.IMAGE,
    ).order_by("sort_order", "id")
    menu_category_assignments = MenuItemMarketplaceCategoryAssignment.objects.select_related(
        "marketplace_category"
    ).order_by("-is_primary", "sort_order", "id")
    menu_items = list(
        MenuItem.objects.filter(
            business=business,
            is_active=True,
            is_visible=True,
            is_available=True,
        )
        .prefetch_related(
            Prefetch(
                "media_assets",
                queryset=menu_item_media,
                to_attr="prefetched_public_media_assets",
            ),
            Prefetch(
                "marketplace_category_assignments",
                queryset=menu_category_assignments,
                to_attr="prefetched_marketplace_category_assignments",
            ),
        )
        .order_by("sort_order", "id")
    )

    grouped: OrderedDict[int, dict] = OrderedDict()
    fallback_category = MarketplaceCategory.objects.filter(
        district=business.district,
        is_active=True,
        is_other=True,
    ).first()

    for item in menu_items:
        assignments = list(getattr(item, "prefetched_marketplace_category_assignments", []))
        categories = [assignment.marketplace_category for assignment in assignments]
        if not categories and fallback_category is not None:
            categories = [fallback_category]

        for index, category in enumerate(categories):
            bucket = grouped.get(category.id)
            if bucket is None:
                bucket = {
                    "id": category.id,
                    "slug": category.slug,
                    "name": category.name,
                    "description": category.description,
                    "menu_items": [],
                    "_sort_order": category.sort_order,
                }
                grouped[category.id] = bucket

            bucket["menu_items"].append(item)

    ordered_rows = sorted(grouped.values(), key=lambda row: (row["_sort_order"], row["name"], row["id"]))
    for row in ordered_rows:
        row.pop("_sort_order", None)
    return ordered_rows


class PublicBusinessListQuerySerializer(serializers.Serializer):
    district = serializers.ChoiceField(
        choices=BusinessProfile.District.choices,
        required=False,
    )


class DiscoveryHomeQuerySerializer(serializers.Serializer):
    district = serializers.ChoiceField(
        choices=BusinessProfile.District.choices,
        required=False,
        default=BusinessProfile.District.BEYLIKDUZU,
    )


class DiscoveryCategoryBusinessQuerySerializer(serializers.Serializer):
    district = serializers.ChoiceField(
        choices=BusinessProfile.District.choices,
        required=False,
        default=BusinessProfile.District.BEYLIKDUZU,
    )
    listing_type = serializers.ChoiceField(
        choices=BusinessProfile.ListingType.choices,
        required=False,
    )
    featured_first = serializers.BooleanField(required=False, default=True)


class PublicBusinessListAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(operation_id="catalog_business_list", parameters=[PublicBusinessListQuerySerializer], responses={200: PublicBusinessListResponseSerializer}, tags=["discovery"])
    def get(self, request):
        query_serializer = PublicBusinessListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        district = query_serializer.validated_data.get("district")

        qs = _public_business_queryset(district=district).order_by("business_name", "id")
        data = {
            "count": qs.count(),
            "results": PublicBusinessSerializer(qs, many=True).data,
        }
        return Response(data)


class DiscoveryHomeAPIView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(operation_id="discovery_home", parameters=[DiscoveryHomeQuerySerializer], responses={200: DiscoveryHomeResponseSerializer}, tags=["discovery"])
    def get(self, request):
        query_serializer = DiscoveryHomeQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        district = query_serializer.validated_data["district"]

        categories = MarketplaceCategory.objects.filter(
            district=district,
            is_active=True,
        ).prefetch_related(
            Prefetch(
                "media_assets",
                queryset=MediaAsset.objects.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id"),
                to_attr="prefetched_public_media_assets",
            )
        ).order_by("sort_order", "id")

        featured_businesses = _public_business_queryset(district=district).filter(
            listing_type=BusinessProfile.ListingType.CONTRACTED,
            is_featured=True,
        ).order_by("-display_priority", "business_name", "id")[:12]

        other_businesses = _public_business_queryset(district=district).filter(
            Q(listing_type=BusinessProfile.ListingType.VOLUNTEER)
            | Q(marketplace_categories__marketplace_category__is_other=True, marketplace_categories__is_active=True)
        ).distinct().order_by("-is_featured", "-display_priority", "business_name", "id")[:12]

        offers = _live_offer_queryset(district=district)[:12]

        wallet_summary = None
        cart_summary = None
        notification_summary = {
            "notification_ready": False,
            "active_device_count": 0,
        }

        if request.user and request.user.is_authenticated:
            wallet = Wallet.objects.filter(user=request.user).first()
            wallet_summary = {
                "balance": int(getattr(wallet, "balance", 0) or 0),
                "pending_balance": int(getattr(wallet, "pending_balance", 0) or 0),
            }

            cart = Cart.objects.filter(user=request.user, status=Cart.Status.ACTIVE).select_related("business").first()
            if cart is not None:
                snapshot = cart.snapshot or {}
                cart_summary = {
                    "cart_id": cart.id,
                    "business_id": cart.business_id,
                    "business_name": cart.business.business_name,
                    "item_count": int(snapshot.get("item_count") or 0),
                    "subtotal_amount": int(cart.subtotal_amount or 0),
                    "customer_fee_amount": int(cart.customer_fee_amount or 0),
                    "total_amount": int(cart.total_amount or 0),
                }

            active_device_count = Device.objects.filter(
                user=request.user,
                is_active=True,
                permission_granted=True,
            ).count()
            notification_summary = {
                "notification_ready": active_device_count > 0,
                "active_device_count": active_device_count,
            }

        return Response(
            {
                "district": {
                    "code": district,
                    "label": BusinessProfile.District(district).label,
                },
                "categories": DiscoveryMarketplaceCategorySerializer(categories, many=True).data,
                "featured_businesses": DiscoveryBusinessCardSerializer(featured_businesses, many=True).data,
                "other_businesses": DiscoveryBusinessCardSerializer(other_businesses, many=True).data,
                "active_offers": PublicOfferSerializer(offers, many=True).data,
                "wallet_summary": wallet_summary,
                "active_cart_summary": cart_summary,
                "notification_readiness": notification_summary,
            }
        )


class DiscoveryCategoryListAPIView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(operation_id="discovery_category_list", parameters=[DiscoveryHomeQuerySerializer], responses={200: DiscoveryCategoryListResponseSerializer}, tags=["discovery"])
    def get(self, request):
        query_serializer = DiscoveryHomeQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        district = query_serializer.validated_data["district"]

        categories = MarketplaceCategory.objects.filter(
            district=district,
            is_active=True,
        ).prefetch_related(
            Prefetch(
                "media_assets",
                queryset=MediaAsset.objects.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id"),
                to_attr="prefetched_public_media_assets",
            )
        ).order_by("sort_order", "id")
        return Response(
            {
                "district": district,
                "count": categories.count(),
                "results": DiscoveryMarketplaceCategorySerializer(categories, many=True).data,
            }
        )


class DiscoveryCategoryBusinessListAPIView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = DiscoveryBusinessCardSerializer
    pagination_class = DefaultPagination

    @extend_schema(operation_id="discovery_category_business_list", parameters=[DiscoveryCategoryBusinessQuerySerializer], responses={200: DiscoveryBusinessCardSerializer}, tags=["discovery"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return BusinessProfile.objects.none()
        query_serializer = DiscoveryCategoryBusinessQuerySerializer(data=self.request.query_params)
        query_serializer.is_valid(raise_exception=True)
        filters = query_serializer.validated_data

        district = filters["district"]
        category_slug = self.kwargs["category_slug"]
        category = MarketplaceCategory.objects.filter(
            district=district,
            is_active=True,
            slug=category_slug,
        ).first()
        if category is None:
            return BusinessProfile.objects.none()

        qs = _public_business_queryset(district=district).filter(
            marketplace_categories__is_active=True,
            marketplace_categories__marketplace_category=category,
        ).distinct()

        listing_type = filters.get("listing_type")
        if listing_type:
            qs = qs.filter(listing_type=listing_type)

        featured_first = bool(filters.get("featured_first", True))
        if featured_first:
            qs = qs.order_by("-is_featured", "-display_priority", "business_name", "id")
        else:
            qs = qs.order_by("business_name", "id")

        return qs


class PublicBusinessDetailAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(operation_id="catalog_business_detail", responses={200: PublicBusinessDetailResponseSerializer, 404: ApiErrorEnvelopeSerializer}, tags=["discovery"])
    def get(self, request, business_id: int):
        business = _public_business_queryset().filter(id=business_id).first()
        if business is None:
            return error("business_not_found", "Business not found.", status=404, request=request)

        business_media = MediaAsset.objects.filter(
            business=business,
            is_active=True,
            media_type=MediaAsset.MediaType.IMAGE,
        ).order_by("sort_order", "id")

        now = timezone.now()
        offers = _live_offer_queryset().filter(business=business)

        categories = _group_business_menu_by_marketplace_category(business=business)

        return Response(
            {
                "business": PublicBusinessSerializer(business).data,
                "media": PublicMediaAssetSerializer(business_media, many=True).data,
                "active_offers": PublicOfferSerializer(offers, many=True).data,
                "category_overview": [
                    {
                        "id": category["id"],
                        "name": category["name"],
                        "description": category["description"],
                    }
                    for category in categories
                ],
                "server_time": now,
            }
        )


class PublicBusinessMenuAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(operation_id="catalog_business_menu", responses={200: PublicBusinessMenuResponseSerializer, 404: ApiErrorEnvelopeSerializer}, tags=["discovery"])
    def get(self, request, business_id: int):
        business = _public_business_queryset().filter(id=business_id).first()
        if not business:
            return error("business_not_found", "Business not found.", status=404, request=request)

        categories = _group_business_menu_by_marketplace_category(business=business)

        offers = _live_offer_queryset().filter(business=business)

        data = {
            "business": PublicBusinessSerializer(business).data,
            "categories": PublicCategorySerializer(categories, many=True).data,
            "active_offers": PublicOfferSerializer(offers, many=True).data,
        }
        return Response(data)
