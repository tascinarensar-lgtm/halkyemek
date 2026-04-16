from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Tuple
"""any : tip her şey olabilir demek yani (str,int, dict vs)
callable : 
"""

from django.db import IntegrityError, transaction

from .models import IdempotencyRecord


class IdempotencyConflict(Exception): #valıe error gibi kendi hata türümüzü yarattık. aynı işlemi iki yapmaya çalışırsa kullanaıca bu hatayı fıraltacağız.
    """Aynı key ile işlem çakıştığında fırlatılır."""

    def __init__(self, message: str, *, reason: str):
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True) #calssımız data işlmeleri yapacak bunu biliiyuruz. frozen = true demek ise hiç bir kaydın değiştirelmez olduğunu söyler. (gelen http post isteklerinin verileri.)
class IdempotencyResult: #api de sonuç dönerken kullanacağız.
    is_replay: bool #zorunlu alan vermek zorundayız. dataclassın bir özelliği
    status_code: int #zorunlu alan
    body: Dict[str, Any] #zorunlu alan


def _normalize_body(body: Any) -> Dict[str, Any]: #kontrok için kullanacağız. gelen body yani json verisi dict mi değil mi onu halleedecğiz burada sonuç her zaman dict olacak diyoruz
    if body is None: #body boş gelmişse eğer body i dict e dönüştürüyourz
        return {}
    if isinstance(body, dict): #burada isinstance ile kontrol yapğıyoruz body dict mi diye kontrol ediyrouz
        return body #eğer öyleyese body i döndürüyoruz
    return {'data': body} #eğer body dict değilse body i data anahtarı ile dict e dönüştürüp döndürüyoruz


@transaction.atomic
def get_or_create_record(*, user, scope: str, key: str, request_fingerprint: str = "") -> Tuple[IdempotencyRecord, bool]:
    """
    - created=True: bu key ilk kez geldi, işlem çalışabilir.
    - created=False: daha önce var.
    """
    try:
        # İç atomic = SAVEPOINT.
        # IntegrityError olursa sadece burası rollback olur,
        # dış transaction 'broken' kalmaz.
        with transaction.atomic():
            rec = IdempotencyRecord.objects.create(
                user=user,
                scope=scope,
                key=key,
                request_fingerprint=request_fingerprint or "",
            )
            return rec, True

    except IntegrityError:
        # Artık sorgu çalıştırabiliriz (savepoint rollback oldu).
        rec = (
            IdempotencyRecord.objects
            .select_for_update()
            .get(user=user, scope=scope, key=key)
        )
        current_fingerprint = str(request_fingerprint or "")
        if current_fingerprint:
            if rec.request_fingerprint and rec.request_fingerprint != current_fingerprint:
                raise IdempotencyConflict(
                    "Aynı Idempotency-Key farklı payload ile kullanılamaz.",
                    reason="payload_mismatch",
                )
            if not rec.request_fingerprint:
                rec.request_fingerprint = current_fingerprint
                rec.save(update_fields=["request_fingerprint", "updated_at"])
        return rec, False


def run_idempotent( #aynı isteği ikinci kez çalıştırmayı engellemek.
    *,
    user,
    scope: str,
    key: str,
    request_fingerprint: str = "",
    action: Callable[[], Tuple[int, Any]], #action paametresine fonksiyon gelecek bu fonksiyon paramtere almayacakmış ve sounucunda int ve any döndürecekmiş "def action() -> tuple[int, Any]:"
) -> IdempotencyResult: #yukarıyla bağlantılı method sounucu IdempotencyResult döndürecek
     
    rec, created = get_or_create_record(
        user=user,
        scope=scope,
        key=key,
        request_fingerprint=request_fingerprint,
    ) #yukarıda yazdığımız methodun kontorlunu yapıp atama yapıyruoz

    if not created:
        if rec.status == IdempotencyRecord.Status.COMPLETED:
            return IdempotencyResult(
                is_replay=True,
                status_code=rec.response_status or 200,
                body=rec.response_body or {},
            )
        if rec.status == IdempotencyRecord.Status.IN_PROGRESS:
            raise IdempotencyConflict(
                "Bu istek halen isleniyor (in_progress).",
                reason="in_progress",
            )
        raise IdempotencyConflict(
            "Bu istek daha once basarisiz oldu. Yeni bir Idempotency-Key kullanin.",
            reason="previous_failure",
        )

    # created=True => ilk kez
    try:
        status_code, body = action() #ind döndürür status_codeye ve any yani ne olduğüu belli olmayan body döndürür. action paramtere olarak belirtilen callable fonksiyonudur. action() yukaruda parametreye gelen fonksiyonu temsil ediyor
        rec.status = IdempotencyRecord.Status.COMPLETED
        rec.response_status = int(status_code)
        rec.response_body = _normalize_body(body)
        rec.save(update_fields=['status', 'response_status', 'response_body', 'updated_at'])
        return IdempotencyResult(is_replay=False, status_code=int(status_code), body=_normalize_body(body))
    except Exception as e:
        rec.status = IdempotencyRecord.Status.FAILED
        rec.error_code = e.__class__.__name__ #hata türünün ismini alıyoruz çok önemli bir ieşy değil 
        rec.error_message = str(e)[:2000] #hata mesajını alıyoruz 2000 karaktere kadar çok önemli bir şey değil 
        rec.save(update_fields=['status', 'error_code', 'error_message', 'updated_at']) #alanları güncelliyoruz
        raise #yazmasaydık Kod sanki hata olmamış gibi devam eder hatayı fırlatıyoruz hata var diyoruz.
