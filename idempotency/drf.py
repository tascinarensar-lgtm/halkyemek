from rest_framework.exceptions import ValidationError #DRF doğrulama hatası fırlatmak için

from .headers import IDEMPOTENCY_META_KEY #hazır tanımlanmışı import ediyoruz


def require_idempotency_key(request) -> str: #str dönecek method (idempotency key i döndürecek) key gönderilirken çağırılacak olan methoddur.
    """Para/checkout gibi kritik endpointlerde Idempotency-Key zorunlu."""
    key = str(request.META.get(IDEMPOTENCY_META_KEY) or "").strip() #clenetin gönderdiği uuid key i alıyoruz
    if not key:
        raise ValidationError({'idempotency_key': 'Idempotency-Key header zorunludur.'})
    if len(key) > 128:
        raise ValidationError({'idempotency_key': 'Idempotency-Key çok uzun.'})
    return key
