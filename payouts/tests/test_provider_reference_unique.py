from django.db import IntegrityError
from django.test import TestCase

from payouts.models import Payout, PayoutBatch
from test_support import create_business


class ProviderReferenceUniqueTests(TestCase):
    def test_provider_reference_must_be_unique_when_nonempty(self):
        business = create_business(name="Biz")
        batch = PayoutBatch.objects.create(business=business, total_amount=0, earning_count=0, provider="manual")
        Payout.objects.create(batch=batch, business=business, amount=10, idempotency_key="k1", provider_reference="ref-1")
        with self.assertRaises(IntegrityError):
            Payout.objects.create(batch=batch, business=business, amount=10, idempotency_key="k2", provider_reference="ref-1")
