from __future__ import annotations

import hashlib
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from common.throttles import PaymentCreateThrottle
from idempotency.models import IdempotencyRecord
from notifications.models import Device
from payments.models import PaymentIntent


class TopupIntentCreateHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username="topup-user", password="pass")
        Device.objects.create(
            user=self.user,
            platform=Device.Platform.ANDROID,
            fcm_token="topup-device-token",
            permission_granted=True,
            is_active=True,
        )
        self.client.force_authenticate(self.user)
        self.url = "/api/v1/payments/topup/intents/"

    @staticmethod
    def _create_intent_mock(*, user, amount, callback_url):
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=int(amount),
            gross_price=int(amount),
            provider=PaymentIntent.Provider.IYZICO,
            status=PaymentIntent.Status.INITIATED,
            provider_page_url=str(callback_url),
        )
        intent.marketplace_conversation_id = f"HY-PI-{intent.pk}"
        intent.save(update_fields=["marketplace_conversation_id", "updated_at"])
        return intent

    def test_requires_idempotency_key_header(self):
        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            response = self.client.post(self.url, {"amount": 1000}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(create_mock.call_count, 0)

    def test_same_key_replays_without_duplicate_intent(self):
        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            first = self.client.post(self.url, {"amount": 1200}, format="json", HTTP_IDEMPOTENCY_KEY="k-replay-1")
            second = self.client.post(self.url, {"amount": 1200}, format="json", HTTP_IDEMPOTENCY_KEY="k-replay-1")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(PaymentIntent.objects.count(), 1)
        self.assertEqual(create_mock.call_count, 1)
        self.assertEqual(first["Idempotency-Replayed"], "false")
        self.assertEqual(second["Idempotency-Replayed"], "true")

    def test_same_key_with_different_payload_returns_conflict(self):
        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            first = self.client.post(self.url, {"amount": 1200}, format="json", HTTP_IDEMPOTENCY_KEY="k-conflict-1")
            second = self.client.post(self.url, {"amount": 1500}, format="json", HTTP_IDEMPOTENCY_KEY="k-conflict-1")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "idempotency_conflict")
        self.assertEqual(second.json()["error"]["reason"], "payload_mismatch")
        self.assertEqual(PaymentIntent.objects.count(), 1)
        self.assertEqual(create_mock.call_count, 1)

    def test_replay_is_not_blocked_even_when_fresh_keys_are_throttled(self):
        with patch.object(PaymentCreateThrottle, "rate", "2/min", create=True):
            with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock):
                first = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-replay-thr-1")
                second_fresh = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-replay-thr-2")
                replay_after_limit = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-replay-thr-1")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_fresh.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay_after_limit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay_after_limit["Idempotency-Replayed"], "true")

    def test_conflict_is_not_masked_by_throttle_after_limit(self):
        with patch.object(PaymentCreateThrottle, "rate", "2/min", create=True):
            with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock):
                first = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-conf-thr-1")
                second_fresh = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-conf-thr-2")
                conflict_after_limit = self.client.post(self.url, {"amount": 1500}, format="json", HTTP_IDEMPOTENCY_KEY="k-conf-thr-1")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_fresh.status_code, status.HTTP_201_CREATED)
        self.assertEqual(conflict_after_limit.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(conflict_after_limit.json()["error"]["reason"], "payload_mismatch")

    def test_in_progress_conflict_returns_retry_after(self):
        fingerprint = hashlib.sha256(
            f"topup_intent_create|user:{int(self.user.pk)}|amount:{1000}".encode("utf-8")
        ).hexdigest()
        IdempotencyRecord.objects.create(
            user=self.user,
            scope="payments.topup_intent_create",
            key="k-in-progress",
            status=IdempotencyRecord.Status.IN_PROGRESS,
            request_fingerprint=fingerprint,
        )

        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            response = self.client.post(self.url, {"amount": 1000}, format="json", HTTP_IDEMPOTENCY_KEY="k-in-progress")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["reason"], "in_progress")
        self.assertEqual(response["Retry-After"], "2")
        self.assertEqual(create_mock.call_count, 0)

    def test_payment_create_throttle_is_enforced(self):
        with patch.object(PaymentCreateThrottle, "rate", "2/min", create=True):
            with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock):
                for i in range(2):
                    response = self.client.post(
                        self.url,
                        {"amount": 1000},
                        format="json",
                        HTTP_IDEMPOTENCY_KEY=f"k-throttle-{i}",
                    )
                    self.assertEqual(response.status_code, status.HTTP_201_CREATED)

                blocked = self.client.post(
                    self.url,
                    {"amount": 1000},
                    format="json",
                    HTTP_IDEMPOTENCY_KEY="k-throttle-over-limit",
                )

        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    @override_settings(CANONICAL_API_BASE_URL="https://api.example.com")
    def test_callback_url_uses_canonical_api_base_url_when_configured(self):
        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            response = self.client.post(
                self.url,
                {"amount": 1000},
                format="json",
                HTTP_IDEMPOTENCY_KEY="k-canonical-callback-1",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(create_mock.call_count, 1)
        self.assertEqual(
            create_mock.call_args.kwargs["callback_url"],
            "https://api.example.com/api/v1/payments/topup/callback/iyzico/",
        )

    def test_provider_config_error_is_presented_with_clear_turkish_message(self):
        with patch(
            "payments.api.views.create_topup_payment_intent",
            side_effect=ValidationError("1001:api bilgileri bulunamadı"),
        ):
            response = self.client.post(
                self.url,
                {"amount": 1000},
                format="json",
                HTTP_IDEMPOTENCY_KEY="k-provider-config-1",
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.json()["error"]["message"],
            "Bakiye yükleme şu anda başlatılamıyor. Ödeme altyapısının iyzico API bilgileri henüz tanımlı değil.",
        )

    def tearDown(self):
        if hasattr(PaymentCreateThrottle, "rate"):
            PaymentCreateThrottle.rate = None
        cache.clear()
