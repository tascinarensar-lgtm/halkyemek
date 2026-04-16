from django.core.management import call_command
from django.test import TestCase

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile, MarketplaceCategory
from menus.models import BusinessOffer, Category, MediaAsset, MenuItem
from notifications.models import Device, Notification
from orders.models import Cart, CheckoutSession, Order
from payments.models import PaymentIntent, SettlementImport, SettlementRecord
from payouts.models import Payout


class BootstrapDemoDataCommandTests(TestCase):
    def test_command_creates_meaningful_demo_data(self):
        call_command("bootstrap_demo_data")

        self.assertTrue(MarketplaceCategory.objects.filter(slug="ev-yemegi", is_active=True).exists())
        self.assertTrue(User.objects.filter(username="demo_customer").exists())
        self.assertTrue(User.objects.filter(username="demo_business").exists())
        self.assertTrue(User.objects.filter(username="demo_ops", role=User.Role.ADMIN, is_staff=True).exists())

        featured_business = BusinessProfile.objects.get(business_name="Beylikdüzü Lokantası")
        self.assertTrue(BusinessMember.objects.filter(business=featured_business, user__username="demo_business", is_active=True).exists())
        self.assertTrue(Category.objects.filter(business=featured_business, name="Günün Menüsü").exists())
        self.assertTrue(MenuItem.objects.filter(business=featured_business, slug="kuru-fasulye-men").exists() or MenuItem.objects.filter(business=featured_business, name="Kuru Fasulye Menü").exists())
        self.assertTrue(BusinessOffer.objects.filter(business=featured_business, title="Öğle Menüsü", is_active=True).exists())
        self.assertTrue(MediaAsset.objects.filter(business=featured_business, is_active=True).exists())

        customer = User.objects.get(username="demo_customer")
        self.assertTrue(Device.objects.filter(user=customer, is_active=True, permission_granted=True).exists())
        self.assertTrue(Cart.objects.filter(user=customer, status=Cart.Status.ACTIVE).exists())
        self.assertTrue(CheckoutSession.objects.filter(user=customer).exists())
        self.assertTrue(Order.objects.filter(user=customer, business=featured_business).count() >= 2)
        self.assertTrue(PaymentIntent.objects.filter(user=customer, purpose=PaymentIntent.Purpose.TOPUP).exists())

        self.assertTrue(Payout.objects.filter(business=featured_business).exists())
        self.assertTrue(SettlementImport.objects.filter(source_label="demo-bootstrap").exists())
        self.assertTrue(SettlementRecord.objects.filter(settlement_import__source_label="demo-bootstrap").exists())
        self.assertTrue(Notification.objects.filter(user=customer).exists())

    def test_command_is_idempotent(self):
        call_command("bootstrap_demo_data")
        first = self._snapshot()

        call_command("bootstrap_demo_data")
        second = self._snapshot()

        self.assertEqual(first, second)

    def _snapshot(self):
        return {
            "users": User.objects.filter(username__in=["demo_customer", "demo_business", "demo_ops"]).count(),
            "businesses": BusinessProfile.objects.filter(business_name__in=["Beylikdüzü Lokantası", "Komşu Mutfağı", "İnceleme Bekleyen İşletme"]).count(),
            "memberships": BusinessMember.objects.filter(user__username__in=["demo_business", "demo_ops"]).count(),
            "categories": Category.objects.count(),
            "menu_items": MenuItem.objects.count(),
            "offers": BusinessOffer.objects.count(),
            "media": MediaAsset.objects.count(),
            "carts": Cart.objects.count(),
            "checkout_sessions": CheckoutSession.objects.count(),
            "orders": Order.objects.count(),
            "payment_intents": PaymentIntent.objects.count(),
            "payouts": Payout.objects.count(),
            "settlement_imports": SettlementImport.objects.count(),
            "settlement_records": SettlementRecord.objects.count(),
            "notifications": Notification.objects.count(),
        }
