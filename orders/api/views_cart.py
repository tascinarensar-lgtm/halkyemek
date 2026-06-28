from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from common.throttles import CartActionThrottle, CheckoutPreviewThrottle
from common.responses import error
from menus.models import MenuItem
from orders.serializers_cart import CartDetailSerializer, CartItemQuantityUpdateSerializer, CartItemWriteSerializer
from orders.services_cart import ActiveCartNotFound, CartError, CartItemUnavailable, CartService
from orders.services_quota import MenuItemQuotaError


def _cart_error_response(exc: Exception, *, request):
    if isinstance(exc, MenuItemQuotaError):
        return error(exc.code, str(exc), status=status.HTTP_409_CONFLICT, request=request)
    if isinstance(exc, DjangoValidationError):
        raise ValidationError({"detail": str(exc)})
    if isinstance(exc, ActiveCartNotFound):
        raise NotFound(str(exc))
    if isinstance(exc, (CartError, CartItemUnavailable)):
        raise ValidationError({"detail": str(exc)})
    raise exc


class CartDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="cart_detail", responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["cart"])
    def get(self, request):
        try:
            result = CartService.get_active_cart_with_recalculation(user=request.user)
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise
        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)


class CartItemAddAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CartActionThrottle]

    @extend_schema(operation_id="cart_item_add", request=CartItemWriteSerializer, responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["cart"])
    def post(self, request):
        serializer = CartItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        menu_item = MenuItem.objects.select_related("business", "category").filter(id=serializer.validated_data["menu_item_id"]).first()
        if menu_item is None:
            raise NotFound("Menu item not found.")

        try:
            result = CartService.add_item(
                user=request.user,
                menu_item=menu_item,
                quantity=int(serializer.validated_data["quantity"]),
            )
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)


class CartItemQuantityUpdateAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CartActionThrottle]

    @extend_schema(operation_id="cart_item_update_quantity", request=CartItemQuantityUpdateSerializer, responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["cart"])
    def patch(self, request, item_id: int):
        serializer = CartItemQuantityUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = CartService.update_item_quantity(
                user=request.user,
                cart_item_id=int(item_id),
                quantity=int(serializer.validated_data["quantity"]),
            )
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)

    @extend_schema(operation_id="cart_item_remove", responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["cart"])
    def delete(self, request, item_id: int):
        try:
            result = CartService.remove_item(user=request.user, cart_item_id=int(item_id))
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)


class CartClearAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CartActionThrottle]

    @extend_schema(operation_id="cart_clear", responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT}, tags=["cart"])
    def delete(self, request):
        try:
            result = CartService.clear_active_cart(user=request.user)
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)


class CartCheckoutPreviewAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CheckoutPreviewThrottle]

    @extend_schema(operation_id="cart_checkout_preview", responses={200: CartDetailSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["cart"])
    def get(self, request):
        try:
            result = CartService.get_active_cart_with_recalculation(user=request.user)
        except Exception as exc:
            maybe_response = _cart_error_response(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise
        return Response(CartDetailSerializer(result.cart).data, status=status.HTTP_200_OK)
