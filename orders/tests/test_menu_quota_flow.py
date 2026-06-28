from django.utils import timezone
from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from menus.models import MenuItemQuota
from orders.models import CheckoutQuotaReservation, CheckoutSession, OrderItem
from orders.services_cart import CartService
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class MenuQuotaFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username=f"quota-customer-{self._testMethodName}")
        self.cashier = create_user(username=f"quota-cashier-{self._testMethodName}")
        self.business = create_business(name="Quota Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Quota Menu",
            slug=f"quota-menu-{self._testMethodName}",
            price_amount=12000,
        )
        seed_wallet(user=self.customer, amount=200000)
        enable_push_device(user=self.customer)

    def _create_checkout(self, *, idempotency_key: str = "quota-checkout"):
        self.client.force_authenticate(self.customer)
        return self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=f"{idempotency_key}-{self._testMethodName}",
        )

    def _cancel_checkout(self, *, token: str):
        self.client.force_authenticate(self.customer)
        return self.client.post(
            f"/api/v1/checkout-sessions/{token}/cancel/",
            {},
            format="json",
        )

    def test_sold_out_menu_item_cannot_be_added_to_cart(self):
        MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=0,
            quota_remaining=0,
        )

        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.menu_item.id, "quantity": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "menu_item_sold_out")

    def test_menu_item_without_quota_is_unlimited_for_checkout(self):
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=3)

        response = self._create_checkout(idempotency_key="quota-unlimited-missing")

        self.assertEqual(response.status_code, 201)
        self.assertFalse(
            CheckoutQuotaReservation.objects.filter(checkout_session_id=response.data["id"]).exists()
        )

    def test_disabled_quota_is_unlimited_for_checkout(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=False,
            quota_total=1,
            quota_remaining=0,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=3)

        response = self._create_checkout(idempotency_key="quota-unlimited-disabled")

        self.assertEqual(response.status_code, 201)
        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertFalse(
            CheckoutQuotaReservation.objects.filter(checkout_session_id=response.data["id"]).exists()
        )

    def test_quantity_above_remaining_quota_cannot_be_added_to_cart(self):
        MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )

        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.menu_item.id, "quantity": 2},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "menu_item_quota_exceeded")

    def test_replaying_checkout_does_not_reserve_quota_twice(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=2,
            quota_remaining=2,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

        first_response = self._create_checkout(idempotency_key="quota-reusable-first")
        self.assertEqual(first_response.status_code, 201)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 1)

        second_response = self._create_checkout(idempotency_key="quota-reusable-second")
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(second_response.data["id"], first_response.data["id"])

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 1)
        self.assertEqual(
            CheckoutQuotaReservation.objects.filter(checkout_session_id=first_response.data["id"]).count(),
            1,
        )

    def test_checkout_reserves_quota_and_cancel_releases_it(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=2,
            quota_remaining=2,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

        self.client.force_authenticate(self.customer)
        create_response = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="quota-reserve-cancel",
        )
        self.assertEqual(create_response.status_code, 201)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 1)
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RESERVED)

        cancel_response = self.client.post(
            f"/api/v1/checkout-sessions/{create_response.data['token']}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancel_response.status_code, 200)

        quota.refresh_from_db()
        reservation.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 2)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_double_cancel_does_not_release_quota_twice(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        create_response = self._create_checkout(idempotency_key="quota-double-cancel")
        self.assertEqual(create_response.status_code, 201)

        first_cancel = self._cancel_checkout(token=create_response.data["token"])
        second_cancel = self._cancel_checkout(token=create_response.data["token"])

        self.assertEqual(first_cancel.status_code, 200)
        self.assertEqual(second_cancel.status_code, 200)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_expired_checkout_releases_reserved_quota_once(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        create_response = self._create_checkout(idempotency_key="quota-expire")
        self.assertEqual(create_response.status_code, 201)

        CheckoutSession.objects.filter(id=create_response.data["id"]).update(expires_at=timezone.now())
        self.client.force_authenticate(self.customer)

        first_get = self.client.get(f"/api/v1/checkout-sessions/{create_response.data['token']}/")
        second_get = self.client.get(f"/api/v1/checkout-sessions/{create_response.data['token']}/")

        self.assertEqual(first_get.status_code, 200)
        self.assertEqual(second_get.status_code, 200)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_expired_checked_out_cart_restore_releases_reserved_quota(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        create_response = self._create_checkout(idempotency_key="quota-restore-expired")
        self.assertEqual(create_response.status_code, 201)

        CheckoutSession.objects.filter(id=create_response.data["id"]).update(expires_at=timezone.now())
        result = CartService.get_active_cart_with_recalculation(user=self.customer)

        self.assertEqual(result.cart.status, result.cart.Status.ACTIVE)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_release_still_clears_reserved_quota_after_quota_is_disabled(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        create_response = self._create_checkout(idempotency_key="quota-disable-release")
        self.assertEqual(create_response.status_code, 201)

        quota.is_enabled = False
        quota.save(update_fields=["is_enabled", "updated_at"])
        cancel_response = self._cancel_checkout(token=create_response.data["token"])

        self.assertEqual(cancel_response.status_code, 200)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_consume_commits_reserved_quota_without_releasing_it(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

        self.client.force_authenticate(self.customer)
        create_response = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="quota-reserve-commit",
        )
        self.assertEqual(create_response.status_code, 201)

        self.client.force_authenticate(self.cashier)
        consume_response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{create_response.data['token']}/consume/",
            {},
            format="json",
        )
        self.assertEqual(consume_response.status_code, 200)

        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.COMMITTED)

        second_consume = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{create_response.data['token']}/consume/",
            {},
            format="json",
        )
        self.assertEqual(second_consume.status_code, 409)

        quota.refresh_from_db()
        reservation.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.COMMITTED)

    def test_consume_commits_order_quantity_against_quota(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=5,
            quota_remaining=5,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=2)

        create_response = self._create_checkout(idempotency_key="quota-quantity-commit")

        self.assertEqual(create_response.status_code, 201)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(reservation.quantity, 2)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RESERVED)
        self.assertEqual(quota.quota_remaining, 3)
        self.assertEqual(quota.quota_reserved, 2)

        self.client.force_authenticate(self.cashier)
        consume_response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{create_response.data['token']}/consume/",
            {},
            format="json",
        )

        self.assertEqual(consume_response.status_code, 200)
        quota.refresh_from_db()
        reservation.refresh_from_db()
        order_item = OrderItem.objects.get(order__checkout_session_id=create_response.data["id"])
        self.assertEqual(order_item.quantity, 2)
        self.assertEqual(reservation.quantity, 2)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.COMMITTED)
        self.assertEqual(quota.quota_remaining, 3)
        self.assertEqual(quota.quota_reserved, 0)

    def test_commit_still_clears_reserved_quota_after_quota_is_disabled(self):
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        create_response = self._create_checkout(idempotency_key="quota-disable-commit")
        self.assertEqual(create_response.status_code, 201)

        quota.is_enabled = False
        quota.save(update_fields=["is_enabled", "updated_at"])
        self.client.force_authenticate(self.cashier)
        consume_response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{create_response.data['token']}/consume/",
            {},
            format="json",
        )

        self.assertEqual(consume_response.status_code, 200)
        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=create_response.data["id"])
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.COMMITTED)

    def test_multiple_menu_items_create_one_reservation_per_item(self):
        second_menu_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Quota Menu Two",
            slug=f"quota-menu-two-{self._testMethodName}",
            price_amount=8000,
        )
        quota_one = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=3,
            quota_remaining=3,
        )
        quota_two = MenuItemQuota.objects.create(
            menu_item=second_menu_item,
            is_enabled=True,
            quota_total=5,
            quota_remaining=5,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=2)
        CartService.add_item(user=self.customer, menu_item=second_menu_item, quantity=1)

        create_response = self._create_checkout(idempotency_key="quota-multiple-items")

        self.assertEqual(create_response.status_code, 201)
        quota_one.refresh_from_db()
        quota_two.refresh_from_db()
        reservations = CheckoutQuotaReservation.objects.filter(
            checkout_session_id=create_response.data["id"]
        ).order_by("menu_item_id")
        self.assertEqual(reservations.count(), 2)
        self.assertEqual(quota_one.quota_remaining, 1)
        self.assertEqual(quota_one.quota_reserved, 2)
        self.assertEqual(quota_two.quota_remaining, 4)
        self.assertEqual(quota_two.quota_reserved, 1)

    def test_second_checkout_for_last_quota_is_rejected_without_negative_remaining(self):
        second_customer = create_user(username=f"quota-second-customer-{self._testMethodName}")
        seed_wallet(user=second_customer, amount=200000)
        enable_push_device(user=second_customer)
        quota = MenuItemQuota.objects.create(
            menu_item=self.menu_item,
            is_enabled=True,
            quota_total=1,
            quota_remaining=1,
        )
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        CartService.add_item(user=second_customer, menu_item=self.menu_item, quantity=1)

        first_response = self._create_checkout(idempotency_key="quota-last-first")
        self.assertEqual(first_response.status_code, 201)

        self.client.force_authenticate(second_customer)
        second_response = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=f"quota-last-second-{self._testMethodName}",
        )

        self.assertEqual(second_response.status_code, 409)
        self.assertEqual(second_response.data["error"]["code"], "menu_item_sold_out")
        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 1)
