from django.contrib import admin
from django.db.models import Count, Sum
from django.utils.timezone import now

from .models import Cart, CartItem, CheckoutSession, Order, OrderItem


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'user',
        'business',
        'menu',
        'amount',
        'subtotal_amount',
        'customer_fee_amount',
        'business_fee_amount',
        'total_charged_amount',
        'business_net_amount',
        'item_count',
        'status',
        'created_at'
    )
    list_filter = ('status', 'business', 'created_at')
    search_fields = ('user__username', 'business__business_name')

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return (
                'user',
                'business',
                'menu',
                'amount',
                'subtotal_amount',
                'customer_fee_amount',
                'business_fee_amount',
                'total_charged_amount',
                'business_net_amount',
                'item_count',
                'pricing_snapshot',
                'order_snapshot',
                'qr_token',
                'status',
                'created_at',
            )
        return ()

    def get_actions(self, request):
        actions = super().get_actions(request)
        if 'delete_selected' in actions:
            del actions['delete_selected']
        return actions

    def changelist_view(self, request, extra_context=None):
        stats = Order.objects.filter(status=Order.Status.PAID).aggregate(
            total_orders=Count('id'),
            total_amount=Sum('amount'),
        )

        today = now().date()
        today_stats = Order.objects.filter(
            status=Order.Status.PAID,
            created_at__date=today,
        ).aggregate(
            today_orders=Count('id'),
            today_amount=Sum('amount'),
        )

        if extra_context is None:
            extra_context = {}

        extra_context['total_orders'] = stats.get('total_orders') or 0
        extra_context['total_amount'] = stats.get('total_amount') or 0
        extra_context['today_orders'] = today_stats.get('today_orders') or 0
        extra_context['today_amount'] = today_stats.get('today_amount') or 0

        extra_context['business_stats'] = (
            Order.objects.filter(status=Order.Status.PAID)
            .values('business__business_name')
            .annotate(
                total_orders=Count('id'),
                total_amount=Sum('amount'),
            )
        )

        return super().changelist_view(request, extra_context=extra_context)


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "menu_item_name",
        "quantity",
        "unit_price_amount",
        "line_total_amount",
        "sort_order",
        "created_at",
    )
    list_filter = ("order__business",)
    search_fields = (
        "order__id",
        "menu_item_name",
    )


@admin.register(CheckoutSession)
class CheckoutSessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "business",
        "amount",
        "status",
        "expires_at",
        "consumed_at",
        "consumed_by",
        "created_at",
    )
    list_filter = ("status", "business", "created_at", "expires_at")
    search_fields = (
        "token",
        "user__username",
        "user__google_email",
        "business__business_name",
    )
    readonly_fields = (
        "token",
        "created_at",
        "updated_at",
        "confirmed_at",
        "consumed_at",
        "cancelled_at",
    )


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "business",
        "status",
        "subtotal_amount",
        "customer_fee_amount",
        "total_amount",
        "updated_at",
    )
    list_filter = ("status", "business")
    search_fields = ("user__username", "business__business_name")
    readonly_fields = ("created_at", "updated_at", "checked_out_at", "abandoned_at")


@admin.register(CartItem)
class CartItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "cart",
        "menu_item_name",
        "quantity",
        "unit_price_amount",
        "line_total_amount",
        "sort_order",
        "updated_at",
    )
    list_filter = ("cart__status", "cart__business")
    search_fields = ("menu_item_name", "cart__user__username", "cart__business__business_name")
