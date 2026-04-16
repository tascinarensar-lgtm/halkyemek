from __future__ import annotations

import uuid
from django.conf import settings
from django.db import models


class IdempotencyRecord(models.Model):
    """Genel amaçlı idempotency kaydı.

    Amaç: Para/QR gibi kritik aksiyonlarda, aynı isteğin tekrar gelmesi durumunda
    işlemi ikinci kez çalıştırmamak ve ilk üretilen sonucu aynen döndürmek.

    İstemci her istekte `Idempotency-Key` header'ı ile benzersiz bir anahtar
    gönderir (genelde UUID). Backend bu anahtarı kullanıcı + scope ile birlikte
    unique tutar.
    """

    class Status(models.TextChoices):
        IN_PROGRESS = 'IN_PROGRESS', 'In progress'
        COMPLETED = 'COMPLETED', 'Completed'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Client tarafından gelen anahtar (Idempotency-Key)
    key = models.CharField(max_length=128)

    # Aynı key'in farklı payload ile kötüye kullanımını engellemek için
    # normalize edilmiş istek fingerprint'i.
    request_fingerprint = models.CharField(max_length=64, blank=True, default='')

    # Aynı key'in farklı endpointlerde çakışmaması için scope
    # Örn: "orders.create" (checkout), "wallets.topup"
    scope = models.CharField(max_length=64)

    # Multi-tenant güvenlik: kayıt mutlaka bir kullanıcıya ait olmalı
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='idempotency_records',
    )

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.IN_PROGRESS,
    )

    # İşlem tamamlanınca döndüğümüz HTTP sonuçlarının snapshot'ı
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)

    # Hata olursa (ör: beklenmeyen exception) kayıt altına al
    error_code = models.CharField(max_length=64, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta: #bu model hangi kuralla çalışacak işini yapar meta classı. veritabanı kuralları koyacağız burada alan belirleme yok
        constraints = [ #kurallar kısmı, yazmak zorunlu. güvenlik sağlamak içindir.
            models.UniqueConstraint( #unique.constraint şudur; altta belirtilen 3 alan benzersiz alan olarak tanımlanacak. başka bir kaydın 3 paraçası bu kaydın 3 parçasına eşit olamaz. Güvence için.
                fields=['user', 'scope', 'key'],
                name='uniq_idempotency_user_scope_key',
            ),
        ]
        indexes = [ #bu idexes kısmı ise model çalışırken bizim belirlediğimiz alanları direkt görsün hızlı çalışsın erişsin diyr kullanıldı
            models.Index(fields=['user', 'scope', 'key']), #direkt bu 3 alanı okur
            models.Index(fields=['status', 'created_at']), #direkt bu 2 alanı okur
        ]

    def __str__(self) -> str:
        return f"{self.id}:{self.scope}:{self.key} [{self.status}]"
