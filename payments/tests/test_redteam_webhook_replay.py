from django.test import TestCase

from payments.models import ProviderEvent
"""
Testin amacı şunu doğrulamaktır:

Aynı provider event (webhook) sistemi ikinci kez işlenemesin.

Yani:

Ödeme sağlayıcısı (ör: Iyzico) bir webhook gönderir

Sistem bunu kaydeder

Aynı webhook tekrar gelirse reddedilmelidir
"""

class WebhookReplayRedTeamTests(TestCase):
    def test_same_provider_event_cannot_be_processed_twice(self):
        ProviderEvent.objects.create(
            provider="iyzico",
            event_id="evt-1",
            event_type="payment.success",
            payload={"x": 1},
        )
        with self.assertRaises(Exception):
            ProviderEvent.objects.create(
                provider="iyzico",
                event_id="evt-1",
                event_type="payment.success",
                payload={"x": 1},
            )