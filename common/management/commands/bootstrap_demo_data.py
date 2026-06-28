from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from businesses.bootstrap import seed_marketplace_categories
from businesses.models import BusinessCategoryAssignment, BusinessMember, BusinessProfile, MarketplaceCategory
from health.services import JobHeartbeatService
from menus.models import BusinessOffer, Category, MediaAsset, MenuItem
from notifications.models import DeliveryAttempt, Device, Notification
from orders.models import Cart, CartItem, CheckoutSession, Order, OrderItem
from payments.models import PaymentIntent, SettlementImport, SettlementLine, SettlementRecord
from payouts.models import BusinessEarning
from payouts.services import PayoutService, create_business_earning_for_order
from wallets.services import WalletService


User = get_user_model()


DEMO_PASSWORD = "Demo12345!"

DEMO_IMAGE_URLS = {
    "business_cover": "https://static.halkyemek.com/home/edirne-de-yemek-kulturune.jpg",
    "business_logo": "https://static.halkyemek.com/logo-halkyemek.png",
    "volunteer_cover": "https://static.halkyemek.com/home/nohutlu-pilav-223.webp",
    "lentil_soup": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
    "kuru_fasulye": "https://static.halkyemek.com/home/edirne-de-yemek-kulturune.jpg",
    "tavuklu_pilav": "https://static.halkyemek.com/home/nohutlu-pilav-223.webp",
    "yogurt_drink": "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=900&q=80",
    "nohutlu_pilav": "https://static.halkyemek.com/home/nohutlu-pilav-223.webp",
    "burger": "https://static.halkyemek.com/cuisines/lysj-listing.webp",
    "pizza": "https://static.halkyemek.com/cuisines/lu8a-hero.webp",
    "doner": "https://static.halkyemek.com/cuisines/i.webp",
    "kebap": "https://static.halkyemek.com/cuisines/1738662779653_1000x750.webp",
    "volunteer": "https://static.halkyemek.com/cuisines/8dc943a74b6bb40c68ebe46123465da2.jpeg",
}


class Command(BaseCommand):
    help = "Bootstrap idempotent development/demo data for local smoke tests."

    def add_arguments(self, parser):
        parser.add_argument("--district", default=BusinessProfile.District.BEYLIKDUZU)
        parser.add_argument("--customer-email", default="demo.customer@example.com")
        parser.add_argument("--business-email", default="demo.business@example.com")
        parser.add_argument("--ops-email", default="demo.ops@example.com")
        parser.add_argument("--bind-google-emails", action="store_true", help="Also copy the supplied emails into google_email so first Google login can claim the existing local user by email.")

    @transaction.atomic
    def handle(self, *args, **options):
        district = options["district"]
        bind_google_emails = bool(options["bind_google_emails"])
        now = timezone.now()

        seed_marketplace_categories(district=district, overwrite_descriptions=False)

        customer = self._get_or_create_user(
            username="demo_customer",
            email=options["customer_email"],
            role=User.Role.CUSTOMER,
            is_staff=False,
            bind_google_email=bind_google_emails,
        )
        business_user = self._get_or_create_user(
            username="demo_business",
            email=options["business_email"],
            role=User.Role.CUSTOMER,
            is_staff=False,
            bind_google_email=bind_google_emails,
        )
        ops_user = self._get_or_create_user(
            username="demo_ops",
            email=options["ops_email"],
            role=User.Role.ADMIN,
            is_staff=True,
            bind_google_email=bind_google_emails,
        )

        customer_device = self._ensure_device(customer, suffix="customer")
        business_device = self._ensure_device(business_user, suffix="business")
        ops_device = self._ensure_device(ops_user, suffix="ops")

        featured_business = self._ensure_business(
            slug="beylikduzu-lokantasi",
            name="Beylikdüzü Lokantası",
            category="Döner",
            district=district,
            short_description="Günlük ev yemeği ve ekonomik öğle menüsü.",
            intro_text="Yerel smoke test akışı için doldurulmuş örnek işletme.",
            badge_text="Demo partner",
            listing_type=BusinessProfile.ListingType.CONTRACTED,
            is_featured=True,
            display_priority=100,
            payout_onboarding_status=BusinessProfile.PayoutOnboardingStatus.APPROVED,
            iyzico_submerchant_status=BusinessProfile.IyziSubmerchantStatus.ACTIVE,
            iyzico_submerchant_key="SUBM-DEMO-001",
            contact_user=business_user,
            email=options["business_email"],
        )
        volunteer_business = self._ensure_business(
            slug="komsu-mutfagi",
            name="Komşu Mutfağı",
            category="Burger",
            district=district,
            short_description="Gönüllü/uygun fiyatlı demo işletme kaydı.",
            intro_text="Other businesses ve kategori listeleri boş kalmasın diye eklenmiş ikinci görünür işletme.",
            badge_text="Gönüllü",
            listing_type=BusinessProfile.ListingType.VOLUNTEER,
            is_featured=False,
            display_priority=40,
            payout_onboarding_status=BusinessProfile.PayoutOnboardingStatus.PENDING,
            iyzico_submerchant_status=BusinessProfile.IyziSubmerchantStatus.PENDING,
            iyzico_submerchant_key="SUBM-DEMO-002",
            contact_user=business_user,
            email="komsu@example.com",
            address_line="Beylikdüzü, İstanbul",
            latitude=Decimal("41.0019"),
            longitude=Decimal("28.6416"),
        )
        review_business = self._ensure_business(
            slug="inceleme-bekleyen-isletme",
            name="İnceleme Bekleyen İşletme",
            category="Kebap",
            district=district,
            short_description="Ops listelerinde bekleyen statü örneği.",
            intro_text="Ops onboarding ve status ekranlarının tamamen boş görünmemesi için bekleyen kayıt.",
            badge_text="Review",
            listing_type=BusinessProfile.ListingType.CONTRACTED,
            is_featured=False,
            display_priority=10,
            payout_onboarding_status=BusinessProfile.PayoutOnboardingStatus.NEEDS_REVIEW,
            iyzico_submerchant_status=BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW,
            iyzico_submerchant_key="SUBM-DEMO-003",
            contact_user=business_user,
            email="review@example.com",
            is_approved=False,
            marketplace_is_visible=False,
        )

        self._ensure_membership(featured_business, business_user, BusinessMember.Role.OWNER, ops_user)
        self._ensure_membership(featured_business, ops_user, BusinessMember.Role.MANAGER, ops_user)
        self._ensure_membership(volunteer_business, business_user, BusinessMember.Role.CASHIER, ops_user)
        self._ensure_membership(review_business, business_user, BusinessMember.Role.MANAGER, ops_user)

        self._assign_marketplace_category(featured_business, "doner", is_primary=True)
        self._assign_marketplace_category(volunteer_business, "burger", is_primary=True)
        self._assign_marketplace_category(review_business, "kebap", is_primary=True)

        featured_cat_main = self._ensure_category(featured_business, "Günün Menüsü", 10)
        featured_cat_drink = self._ensure_category(featured_business, "İçecekler", 20)
        volunteer_cat = self._ensure_category(volunteer_business, "Pilavlar", 10)

        mercimek = self._ensure_menu_item(featured_business, featured_cat_main, "Mercimek Çorbası", 6500, 10, DEMO_IMAGE_URLS["lentil_soup"])
        kuru = self._ensure_menu_item(featured_business, featured_cat_main, "Kuru Fasulye Menü", 15000, 20, DEMO_IMAGE_URLS["kuru_fasulye"])
        pilav = self._ensure_menu_item(featured_business, featured_cat_main, "Tavuklu Pilav", 14500, 30, DEMO_IMAGE_URLS["tavuklu_pilav"])
        ayran = self._ensure_menu_item(featured_business, featured_cat_drink, "Ayran", 3000, 10, DEMO_IMAGE_URLS["yogurt_drink"])
        gonullu = self._ensure_menu_item(volunteer_business, volunteer_cat, "Nohutlu Pilav", 12000, 10, DEMO_IMAGE_URLS["nohutlu_pilav"])

        self._ensure_business_media(featured_business, MediaAsset.AssetRole.COVER, "beylikduzu-cover", DEMO_IMAGE_URLS["business_cover"])
        self._ensure_business_media(featured_business, MediaAsset.AssetRole.LOGO, "beylikduzu-logo", DEMO_IMAGE_URLS["business_logo"])
        self._ensure_business_media(volunteer_business, MediaAsset.AssetRole.COVER, "komsu-cover", DEMO_IMAGE_URLS["volunteer_cover"])
        self._ensure_menu_media(mercimek, "lentil-soup", DEMO_IMAGE_URLS["lentil_soup"])
        self._ensure_menu_media(kuru, "kuru-fasulye", DEMO_IMAGE_URLS["kuru_fasulye"])
        self._ensure_menu_media(pilav, "tavuklu-pilav", DEMO_IMAGE_URLS["tavuklu_pilav"])
        self._ensure_menu_media(ayran, "yogurt-drink", DEMO_IMAGE_URLS["yogurt_drink"])
        self._ensure_menu_media(gonullu, "nohutlu-pilav", DEMO_IMAGE_URLS["nohutlu_pilav"])
        self._ensure_category_media("doner", "kategori-doner")
        self._ensure_category_media("burger", "kategori-burger")

        live_offer = self._ensure_offer(
            featured_business,
            kuru,
            "Öğle Menüsü",
            12900,
            starts_at=now - timedelta(days=1),
            ends_at=now + timedelta(days=14),
            short_description="Çorba + ana yemek demo kampanyası",
            label="Fırsat",
            tag="Demo",
            is_featured=True,
            sort_order=10,
        )
        self._ensure_offer_media(live_offer, "ogle-menusu")

        self._ensure_wallet_balance(customer, 250000)

        active_cart = self._ensure_cart(customer, featured_business)
        self._ensure_cart_item(active_cart, kuru, quantity=1, sort_order=10)
        self._ensure_cart_item(active_cart, ayran, quantity=1, sort_order=20)
        active_cart.refresh_totals()
        active_cart.snapshot = {
            "item_count": active_cart.cart_items.count(),
            "subtotal_amount": int(active_cart.subtotal_amount),
            "customer_fee_amount": int(active_cart.customer_fee_amount),
            "total_amount": int(active_cart.total_amount),
        }
        active_cart.save(update_fields=["snapshot", "subtotal_amount", "total_amount", "updated_at"])

        pending_session = self._ensure_checkout_session(
            token="demo-pending-checkout",
            user=customer,
            business=featured_business,
            cart=active_cart,
            amount=18000,
            subtotal_amount=18000,
            customer_fee_amount=0,
            business_fee_amount=900,
            business_net_amount=17100,
            item_count=2,
            status=CheckoutSession.Status.CONFIRMED,
            expires_at=now + timedelta(hours=2),
            confirmed_at=now - timedelta(minutes=10),
            consumed_at=None,
            consumed_by=None,
        )

        used_order = self._ensure_paid_order(
            key="demo-used-order",
            user=customer,
            business=featured_business,
            representative_menu=kuru,
            amount=18000,
            subtotal_amount=18000,
            customer_fee_amount=0,
            business_fee_amount=900,
            business_net_amount=17100,
            item_count=2,
            status=Order.Status.USED,
            paid_at=now - timedelta(days=4),
            used_at=now - timedelta(days=4, minutes=-20),
            expires_at=now + timedelta(days=2),
        )
        self._ensure_order_item(used_order, kuru, quantity=1, sort_order=10)
        self._ensure_order_item(used_order, ayran, quantity=1, sort_order=20)

        paid_order = self._ensure_paid_order(
            key="demo-paid-order",
            user=customer,
            business=featured_business,
            representative_menu=pilav,
            amount=14500,
            subtotal_amount=14500,
            customer_fee_amount=0,
            business_fee_amount=700,
            business_net_amount=13800,
            item_count=1,
            status=Order.Status.PAID,
            paid_at=now - timedelta(days=1),
            used_at=None,
            expires_at=now + timedelta(days=1),
        )
        self._ensure_order_item(paid_order, pilav, quantity=1, sort_order=10)

        history_session = self._ensure_checkout_session(
            token="demo-consumed-checkout",
            user=customer,
            business=featured_business,
            cart=active_cart,
            amount=14500,
            subtotal_amount=14500,
            customer_fee_amount=0,
            business_fee_amount=700,
            business_net_amount=13800,
            item_count=1,
            status=CheckoutSession.Status.CONSUMED,
            expires_at=now + timedelta(days=1),
            confirmed_at=now - timedelta(days=1, minutes=5),
            consumed_at=now - timedelta(days=1),
            consumed_by=business_user,
        )
        if paid_order.checkout_session_id != history_session.id:
            paid_order.checkout_session = history_session
            paid_order.save(update_fields=["checkout_session"])

        topup_intent = self._ensure_payment_intent(
            key="demo-topup-intent",
            user=customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=50000,
            status=PaymentIntent.Status.PAID,
            provider_payment_id="PAY-DEMO-TOPUP-1",
            provider_session_token="SESSION-DEMO-TOPUP-1",
            provider_page_url="https://example.com/demo-topup",
            is_processed=True,
            is_settled=True,
            settled_at=now - timedelta(days=2),
            settlement_reference_code="SETTLE-TOPUP-1",
        )
        WalletService.topup_pending(
            user=customer,
            amount=int(topup_intent.amount),
            description="Demo topup pending",
            payment_intent=topup_intent,
        )
        WalletService.settle_pending_to_available(
            user=customer,
            amount=int(topup_intent.amount),
            description="Demo topup settlement",
            payment_intent=topup_intent,
        )

        for order in [used_order, paid_order]:
            stable_eligible_at = (order.paid_at or now) + timedelta(hours=1)
            existing_earning = getattr(order, "business_earning", None)
            if existing_earning is None:
                create_business_earning_for_order(order=order, eligible_at=stable_eligible_at)
        PayoutService.run_eligibility_sweep(now=now)
        batches = PayoutService.create_batches_for_eligible(provider="manual")
        for batch in batches:
            for payout in batch.payouts.all():
                if payout.status == "CREATED":
                    PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id=f"MANUAL-{payout.id}")
                    PayoutService.confirm_payout(payout_id=payout.id, actor=ops_user, source="demo_seed", note="demo confirm")

        confirmed_payout = featured_business.payouts.order_by("-id").first()
        if confirmed_payout is not None:
            self._ensure_settlement_line(
                provider="IYZICO",
                line_hash=f"demo-line-{confirmed_payout.id}",
                provider_reference=confirmed_payout.provider_reference,
                submerchant_key=featured_business.iyzico_submerchant_key,
                amount=int(confirmed_payout.amount),
            )

        settlement_import = self._ensure_settlement_import(now=now, imported_by=ops_user)
        self._ensure_settlement_record_for_intent(settlement_import, topup_intent, featured_business, used_order, now)
        self._ensure_settlement_record_unmatched(settlement_import, review_business, now)

        self._ensure_notification(customer, Notification.Type.ORDER_USED, "Sipariş kullanıldı", "Demo siparişiniz kasada kullanıldı.", {"order_id": used_order.id}, customer_device)
        self._ensure_notification(business_user, Notification.Type.PAYOUT_CONFIRMED, "Payout doğrulandı", "Örnek payout kaydı settlement ile doğrulandı.", {"business_id": featured_business.id}, business_device)
        self._ensure_notification(ops_user, Notification.Type.SYSTEM_BROADCAST, "Demo broadcast hazır", "Broadcast ekranı için örnek kuyruk girdisi oluşturuldu.", {"audience": "ALL"}, ops_device)

        JobHeartbeatService.success("dispatch_due_payouts", worker="demo-seed", processed=1)
        JobHeartbeatService.success("sync_sent_payout_statuses", worker="demo-seed", processed=1)
        JobHeartbeatService.success("import_iyzico_settlement", worker="demo-seed", processed=1)
        JobHeartbeatService.success("reprocess_unmatched_settlement_records", worker="demo-seed", processed=0)

        summary = {
            "users": User.objects.filter(username__in=["demo_customer", "demo_business", "demo_ops"]).count(),
            "businesses": BusinessProfile.objects.filter(business_name__in=["Beylikdüzü Lokantası", "Komşu Mutfağı", "İnceleme Bekleyen İşletme"]).count(),
            "menu_items": MenuItem.objects.filter(business__in=[featured_business, volunteer_business]).count(),
            "orders": Order.objects.filter(user=customer, business=featured_business).count(),
            "payouts": featured_business.payouts.count(),
            "settlement_imports": SettlementImport.objects.filter(source_label="demo-bootstrap").count(),
        }
        self.stdout.write(self.style.SUCCESS(f"bootstrap_demo_data completed: {summary}"))
        self.stdout.write(
            "Demo users => "
            f"customer={customer.email}, business={business_user.email}, ops={ops_user.email}, password={DEMO_PASSWORD}"
        )

    def _get_or_create_user(self, *, username: str, email: str, role: str, is_staff: bool, bind_google_email: bool):
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "role": role,
                "is_staff": is_staff,
            },
        )
        update_fields: list[str] = []
        if user.email != email:
            user.email = email
            update_fields.append("email")
        if user.role != role:
            user.role = role
            update_fields.append("role")
        if user.is_staff != is_staff:
            user.is_staff = is_staff
            update_fields.append("is_staff")
        if bind_google_email and user.google_email != email:
            user.google_email = email
            user.google_email_verified = True
            update_fields.extend(["google_email", "google_email_verified"])
        if created or not user.has_usable_password():
            user.set_password(DEMO_PASSWORD)
            update_fields.append("password")
        if update_fields:
            user.save(update_fields=list(dict.fromkeys(update_fields)))
        return user

    def _ensure_device(self, user, *, suffix: str):
        device, _ = Device.objects.update_or_create(
            user=user,
            device_id=f"demo-{suffix}-device",
            defaults={
                "platform": Device.Platform.WEB,
                "fcm_token": f"demo-{suffix}-token",
                "permission_granted": True,
                "is_active": True,
                "app_version": "demo",
            },
        )
        return device

    def _ensure_business(self, *, slug: str, name: str, category: str, district: str, short_description: str, intro_text: str, badge_text: str,
                         listing_type: str, is_featured: bool, display_priority: int, payout_onboarding_status: str,
                         iyzico_submerchant_status: str, iyzico_submerchant_key: str, contact_user, email: str,
                         is_approved: bool = True, marketplace_is_visible: bool = True, address_line: str = None, latitude: Decimal = None, longitude: Decimal = None, google_maps_url: str = None):
        business, _ = BusinessProfile.objects.update_or_create(
            business_name=name,
            defaults={
                "contact_user": contact_user,
                "category": category,
                "adress": f"{name} Demo Adres / Beylikdüzü",
                "address_line": address_line,
                "latitude": latitude,
                "longitude": longitude,
                "google_maps_url": google_maps_url,
                "district": district,
                "is_approved": is_approved,
                "is_active": True,
                "is_listed": True,
                "listing_type": listing_type,
                "is_featured": is_featured,
                "display_priority": display_priority,
                "marketplace_is_visible": marketplace_is_visible,
                "short_description": short_description,
                "intro_text": intro_text,
                "badge_text": badge_text,
                "payout_onboarding_status": payout_onboarding_status,
                "payout_onboarding_note": "Demo seed",
                "iyzico_submerchant_key": iyzico_submerchant_key,
                "iyzico_submerchant_status": iyzico_submerchant_status,
                "iyzico_submerchant_type": "PERSONAL",
                "kyc_contact_name": "Demo",
                "kyc_contact_surname": slug.replace("-", " ").title()[:50],
                "kyc_email": email,
                "kyc_gsm_number": "+905551112233",
                "kyc_iban": "TR000000000000000000000001",
                "kyc_address": f"{name} Demo Adres",
                "kyc_city": "Istanbul",
                "kyc_zip_code": "34520",
            },
        )
        return business

    def _ensure_membership(self, business, user, role: str, granted_by):
        membership, created = BusinessMember.objects.get_or_create(
            business=business,
            user=user,
            defaults={"role": role, "is_active": True, "granted_by": granted_by},
        )
        if not created:
            changed = []
            if membership.role != role:
                membership.role = role
                changed.append("role")
            if not membership.is_active:
                membership.is_active = True
                changed.append("is_active")
            if membership.granted_by_id != getattr(granted_by, "id", None):
                membership.granted_by = granted_by
                changed.append("granted_by")
            if changed:
                membership.save(update_fields=changed + ["updated_at"])
        return membership

    def _assign_marketplace_category(self, business, slug: str, *, is_primary: bool):
        category = MarketplaceCategory.objects.get(district=business.district, slug=slug)
        assignment, _ = BusinessCategoryAssignment.objects.update_or_create(
            business=business,
            marketplace_category=category,
            defaults={"is_primary": is_primary, "is_active": True, "sort_order": 10 if is_primary else 20},
        )
        if is_primary:
            BusinessCategoryAssignment.objects.filter(business=business).exclude(id=assignment.id).update(is_primary=False)
        return assignment

    def _ensure_category(self, business, name: str, sort_order: int):
        category, _ = Category.objects.update_or_create(
            business=business,
            name=name,
            defaults={"description": f"{name} demo kategorisi", "sort_order": sort_order, "is_active": True, "is_visible": True},
        )
        return category

    def _ensure_menu_item(self, business, category, name: str, price_amount: int, sort_order: int, image_url: str = None):
        slug = slugify(name)
        if image_url is None:
            image_url = f"https://picsum.photos/seed/{slug}/640/480"
        item, _ = MenuItem.objects.update_or_create(
            business=business,
            slug=slug,
            defaults={
                "category": category,
                "name": name,
                "description": f"{name} için demo menü kaydı.",
                "price_amount": price_amount,
                "sort_order": sort_order,
                "is_active": True,
                "is_visible": True,
                "is_available": True,
                "image_url": image_url,
            },
        )
        return item

    def _ensure_business_media(self, business, asset_role: str, seed: str, file_url: str = None):
        MediaAsset.objects.update_or_create(
            business=business,
            menu_item=None,
            marketplace_category=None,
            offer=None,
            asset_role=asset_role,
            defaults={
                "media_type": MediaAsset.MediaType.IMAGE,
                "file_url": file_url or f"https://picsum.photos/seed/{seed}/800/600",
                "alt_text": f"{business.business_name} {asset_role.lower()}",
                "sort_order": 10,
                "is_active": True,
            },
        )

    def _ensure_menu_media(self, menu_item, seed: str, file_url: str = None):
        MediaAsset.objects.update_or_create(
            menu_item=menu_item,
            asset_role=MediaAsset.AssetRole.THUMBNAIL,
            defaults={
                "media_type": MediaAsset.MediaType.IMAGE,
                "file_url": file_url or DEMO_IMAGE_URLS.get(seed.replace("-", "_"), f"https://picsum.photos/seed/{seed}/800/600"),
                "alt_text": menu_item.name,
                "sort_order": 10,
                "is_active": True,
            },
        )

    def _ensure_category_media(self, slug: str, seed: str):
        category = MarketplaceCategory.objects.filter(slug=slug).first()
        if category is None:
            return
        MediaAsset.objects.update_or_create(
            marketplace_category=category,
            asset_role=MediaAsset.AssetRole.COVER,
            defaults={
                "media_type": MediaAsset.MediaType.IMAGE,
                "file_url": f"https://picsum.photos/seed/{seed}/800/600",
                "alt_text": category.name,
                "sort_order": 10,
                "is_active": True,
            },
        )

    def _ensure_offer(self, business, menu_item, title: str, offer_price_amount: int, *, starts_at, ends_at, short_description: str, label: str, tag: str, is_featured: bool, sort_order: int):
        offer, _ = BusinessOffer.objects.update_or_create(
            business=business,
            title=title,
            defaults={
                "menu_item": menu_item,
                "short_description": short_description,
                "description": short_description,
                "label": label,
                "tag": tag,
                "offer_price_amount": offer_price_amount,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "is_active": True,
                "is_featured": is_featured,
                "daily_limit": 50,
                "sort_order": sort_order,
            },
        )
        return offer

    def _ensure_offer_media(self, offer, seed: str):
        MediaAsset.objects.update_or_create(
            offer=offer,
            asset_role=MediaAsset.AssetRole.COVER,
            defaults={
                "media_type": MediaAsset.MediaType.IMAGE,
                "file_url": f"https://picsum.photos/seed/{seed}/800/600",
                "alt_text": offer.title,
                "sort_order": 10,
                "is_active": True,
            },
        )

    def _ensure_wallet_balance(self, user, minimum_balance: int):
        wallet = WalletService.get_or_create_wallet(user=user)
        current_balance = int(wallet.balance or 0)
        if current_balance < minimum_balance:
            WalletService.topup(user=user, amount=minimum_balance - current_balance, description="demo bootstrap topup")
        return WalletService.get_or_create_wallet(user=user)

    def _ensure_cart(self, user, business):
        active = Cart.objects.filter(user=user, status=Cart.Status.ACTIVE).exclude(business=business)
        active.update(status=Cart.Status.ABANDONED, abandoned_at=timezone.now())
        cart, _ = Cart.objects.get_or_create(
            user=user,
            status=Cart.Status.ACTIVE,
            defaults={
                "business": business,
                "subtotal_amount": 0,
                "customer_fee_amount": 0,
                "total_amount": 0,
                "currency": "TRY",
            },
        )
        if cart.business_id != business.id:
            cart.business = business
            cart.customer_fee_amount = 0
            cart.save(update_fields=["business", "customer_fee_amount", "updated_at"])
        return cart

    def _ensure_cart_item(self, cart, menu_item, *, quantity: int, sort_order: int):
        item, _ = CartItem.objects.update_or_create(
            cart=cart,
            menu_item=menu_item,
            defaults={
                "quantity": quantity,
                "unit_price_amount": int(menu_item.price_amount),
                "line_total_amount": int(menu_item.price_amount) * quantity,
                "menu_item_name": menu_item.name,
                "menu_item_snapshot": {
                    "menu_item_id": menu_item.id,
                    "business_id": menu_item.business_id,
                    "category_id": menu_item.category_id,
                    "name": menu_item.name,
                    "price_amount": int(menu_item.price_amount),
                    "image_url": menu_item.image_url or "",
                },
                "sort_order": sort_order,
            },
        )
        return item

    def _ensure_checkout_session(self, *, token: str, user, business, cart, amount: int, subtotal_amount: int, customer_fee_amount: int, business_fee_amount: int, business_net_amount: int, item_count: int, status: str, expires_at, confirmed_at, consumed_at, consumed_by):
        session, _ = CheckoutSession.objects.update_or_create(
            token=token,
            defaults={
                "user": user,
                "business": business,
                "cart": cart,
                "status": status,
                "amount": amount,
                "subtotal_amount": subtotal_amount,
                "customer_fee_amount": customer_fee_amount,
                "business_fee_amount": business_fee_amount,
                "business_net_amount": business_net_amount,
                "platform_total_fee_amount": customer_fee_amount + business_fee_amount,
                "item_count": item_count,
                "currency": "TRY",
                "business_name": business.business_name,
                "pricing_snapshot": {
                    "subtotal_amount": subtotal_amount,
                    "customer_fee_amount": customer_fee_amount,
                    "business_fee_amount": business_fee_amount,
                    "business_net_amount": business_net_amount,
                },
                "cart_snapshot": {
                    "item_count": item_count,
                    "items": list(cart.cart_items.values("menu_item_id", "menu_item_name", "quantity", "line_total_amount")),
                },
                "expires_at": expires_at,
                "confirmed_at": confirmed_at,
                "consumed_at": consumed_at,
                "consumed_by": consumed_by,
            },
        )
        return session

    def _ensure_paid_order(self, *, key: str, user, business, representative_menu, amount: int, subtotal_amount: int, customer_fee_amount: int, business_fee_amount: int, business_net_amount: int, item_count: int, status: str, paid_at, used_at, expires_at):
        order_snapshot = {
            "seed_key": key,
            "items": [],
        }
        order, _ = Order.objects.update_or_create(
            user=user,
            business=business,
            qr_token=f"{key}-qr-token",
            defaults={
                "menu": representative_menu,
                "amount": amount,
                "subtotal_amount": subtotal_amount,
                "customer_fee_amount": customer_fee_amount,
                "business_fee_amount": business_fee_amount,
                "total_charged_amount": amount,
                "business_net_amount": business_net_amount,
                "item_count": item_count,
                "pricing_snapshot": {
                    "subtotal_amount": subtotal_amount,
                    "customer_fee_amount": customer_fee_amount,
                    "business_fee_amount": business_fee_amount,
                    "business_net_amount": business_net_amount,
                    "total_charged_amount": amount,
                },
                "order_snapshot": order_snapshot,
                "status": status,
                "paid_at": paid_at,
                "used_at": used_at,
                "expires_at": expires_at,
            },
        )
        return order

    def _ensure_order_item(self, order, menu_item, *, quantity: int, sort_order: int):
        item, _ = OrderItem.objects.update_or_create(
            order=order,
            menu_item=menu_item,
            defaults={
                "quantity": quantity,
                "unit_price_amount": int(menu_item.price_amount),
                "line_total_amount": int(menu_item.price_amount) * quantity,
                "menu_item_name": menu_item.name,
                "menu_item_snapshot": {
                    "menu_item_id": menu_item.id,
                    "business_id": menu_item.business_id,
                    "category_id": menu_item.category_id,
                    "name": menu_item.name,
                    "price_amount": int(menu_item.price_amount),
                    "image_url": menu_item.image_url or "",
                },
                "sort_order": sort_order,
            },
        )
        order.order_snapshot = {
            "seed_order_id": order.id,
            "items": list(order.order_items.values("menu_item_id", "menu_item_name", "quantity", "line_total_amount")),
        }
        order.save(update_fields=["order_snapshot"])
        return item

    def _ensure_payment_intent(self, *, key: str, user, purpose: str, amount: int, status: str, provider_payment_id: str, provider_session_token: str, provider_page_url: str,
                               is_processed: bool, is_settled: bool, settled_at, settlement_reference_code: str):
        is_topup = purpose == PaymentIntent.Purpose.TOPUP
        intent, _ = PaymentIntent.objects.update_or_create(
            provider_payment_id=provider_payment_id,
            defaults={
                "user": user,
                "purpose": purpose,
                "provider": PaymentIntent.Provider.MOCK,
                "amount": amount,
                "status": status,
                "provider_session_token": provider_session_token,
                "provider_page_url": provider_page_url,
                "provider_raw_init": {"seed_key": key},
                "provider_raw_result": {"status": status},
                "is_processed": is_processed,
                "processed_at": timezone.now() if is_processed else None,
                "normalized_status": status,
                "is_settled": is_settled,
                "settled_at": settled_at,
                "settlement_reference_code": settlement_reference_code,
                "marketplace_conversation_id": f"HY-PI-DEMO-{slugify(key).upper()}",
                "submerchant_key": "",
                "submerchant_price": 0,
                "gross_price": 0 if is_topup else amount,
                "platform_fee": 0,
            },
        )
        return intent

    def _ensure_settlement_line(self, *, provider: str, line_hash: str, provider_reference: str, submerchant_key: str, amount: int):
        SettlementLine.objects.update_or_create(
            provider=provider,
            line_hash=line_hash,
            defaults={
                "provider_reference": provider_reference,
                "submerchant_key": submerchant_key,
                "amount": amount,
                "settlement_date": timezone.now().date(),
            },
        )

    def _ensure_settlement_import(self, *, now, imported_by):
        checksum = "demo-settlement-import-checksum"
        settlement_import, _ = SettlementImport.objects.update_or_create(
            provider=SettlementImport.Provider.IYZICO,
            checksum_sha256=checksum,
            defaults={
                "source_type": SettlementImport.SourceType.COMMAND,
                "source_label": "demo-bootstrap",
                "source_metadata": {"seed": True},
                "original_filename": "demo_settlement.csv",
                "storage_path": "demo/demo_settlement.csv",
                "file_size_bytes": 128,
                "imported_by": imported_by,
                "imported_by_label": imported_by.username,
                "started_at": now - timedelta(minutes=3),
                "completed_at": now - timedelta(minutes=2),
                "parse_status": SettlementImport.ParseStatus.PARSED,
                "applied_status": SettlementImport.AppliedStatus.APPLIED,
                "total_rows": 2,
                "created_records": 2,
                "duplicate_records": 0,
                "processed_records": 2,
                "failed_records": 0,
                "skipped_rows": 0,
                "unmatched_records": 1,
                "retry_count": 0,
                "checksum_verified_at": now - timedelta(minutes=2),
                "lifecycle_events": [{"status": "APPLIED"}],
                "error_message": "",
            },
        )
        return settlement_import

    def _ensure_settlement_record_for_intent(self, settlement_import, intent, business, order, now):
        SettlementRecord.objects.update_or_create(
            provider=SettlementRecord.Provider.IYZICO,
            external_settlement_id="demo-settlement-record-1",
            defaults={
                "settlement_import": settlement_import,
                "row_number": 1,
                "row_fingerprint": "demo-row-1",
                "external_transaction_id": "tx-demo-1",
                "amount": int(intent.amount),
                "currency": "TRY",
                "settlement_reference_code": intent.settlement_reference_code,
                "provider_reference": intent.provider_payment_id,
                "conversation_id": intent.marketplace_conversation_id,
                "submerchant_key": business.iyzico_submerchant_key,
                "business": business,
                "order": order,
                "payment_intent": intent,
                "match_type": SettlementRecord.MatchType.PAYMENT_INTENT,
                "raw_payload": {"seed": True},
                "is_processed": True,
                "processed_at": now - timedelta(minutes=2),
                "processing_error": "",
                "retry_count": 0,
                "unmatched_reason_code": "",
                "review_status": SettlementRecord.ReviewStatus.RESOLVED,
                "operator_note": "Demo matched import",
                "lifecycle_events": [{"status": "matched"}],
                "unmatched_opened_at": None,
                "unmatched_resolved_at": now - timedelta(minutes=2),
                "last_reviewed_at": now - timedelta(minutes=2),
                "settled_at": now - timedelta(days=2),
            },
        )

    def _ensure_settlement_record_unmatched(self, settlement_import, business, now):
        record, _ = SettlementRecord.objects.update_or_create(
            provider=SettlementRecord.Provider.IYZICO,
            external_settlement_id="demo-settlement-record-open",
            defaults={
                "settlement_import": settlement_import,
                "row_number": 2,
                "row_fingerprint": "demo-row-2",
                "external_transaction_id": "tx-demo-open",
                "amount": 9900,
                "currency": "TRY",
                "settlement_reference_code": "UNKNOWN-SETTLEMENT",
                "provider_reference": "UNKNOWN-PAYOUT",
                "conversation_id": "HY-PI-DEMO-MISSING",
                "submerchant_key": business.iyzico_submerchant_key,
                "business": business,
                "match_type": SettlementRecord.MatchType.UNMATCHED,
                "raw_payload": {"seed": True, "reason": "missing reference"},
                "is_processed": False,
                "processed_at": None,
                "processing_error": "Payment intent or payout not found.",
                "retry_count": 1,
                "next_retry_at": now + timedelta(hours=1),
                "last_retry_at": now - timedelta(minutes=30),
                "unmatched_reason_code": "reference_not_found",
                "review_status": SettlementRecord.ReviewStatus.OPEN,
                "operator_note": "Demo open unmatched record",
                "lifecycle_events": [{"status": "open"}],
                "unmatched_opened_at": now - timedelta(minutes=20),
                "unmatched_resolved_at": None,
                "last_reviewed_at": now - timedelta(minutes=20),
                "settled_at": None,
            },
        )
        # Keep demo unmatched record inside the retry window so it does not trip stale-manual-review integrity alarms.
        SettlementRecord.objects.filter(pk=record.pk).update(created_at=now - timedelta(minutes=20))

    def _ensure_notification(self, user, notif_type: str, title: str, body: str, payload: dict, device):
        notification, _ = Notification.objects.update_or_create(
            user=user,
            dedupe_key=f"demo:{notif_type}:{user.id}",
            defaults={
                "type": notif_type,
                "title": title,
                "body": body,
                "payload": payload,
                "status": Notification.Status.SENT,
                "sent_at": timezone.now(),
            },
        )
        DeliveryAttempt.objects.update_or_create(
            notification=notification,
            device=device,
            defaults={
                "provider": "FCM",
                "provider_message_id": f"demo-msg-{notification.id}",
                "status": DeliveryAttempt.Status.SENT,
                "response_payload": {"ok": True},
                "error": "",
                "retry_count": 0,
                "retry_at": None,
                "sent_at": timezone.now(),
            },
        )
        return notification
