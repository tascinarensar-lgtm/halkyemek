from __future__ import annotations
"""
Bu kod parçası ödeme ve payout işlemleri için standart referans (reference) üretme ve doğrulama (validation) mekanizmasıdır.
"""
import re # Referans formatını kontrol etmek için kullanılıyor.

PAYOUT_REF_PREFIX = "HY-PAYOUT" #Payout referanslarının prefix’i.
PAYMENT_REF_PREFIX = "HY-PAY" #Kart ödeme referansları

_REF_RE = re.compile(r"^[A-Z0-9\-]{6,64}$") #Bu regex pattern referansın geçerli olup olmadığını kontrol eder.


def payout_ref(payout_id: int) -> str: #Bu fonksiyon payout referansı üretir.
    # Deterministic: aynı payout aynı ref
    return f"{PAYOUT_REF_PREFIX}-{payout_id}"


def payment_ref(intent_id: int) -> str: # Bu fonksiyon payment referansı üretir.
    return f"{PAYMENT_REF_PREFIX}-{intent_id}"


def validate_ref(ref: str) -> bool: # Bu fonksiyon bir referansın geçerli olup olmadığını kontrol eder.
    if not ref:
        return False
    if len(ref) > 64:
        return False
    return bool(_REF_RE.match(ref)) # Regex ile format kontrolü yapılır.