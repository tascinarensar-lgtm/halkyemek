from __future__ import annotations

"""Bu parça kodun amacı payment provider’ın (iyzico/stripe/…) 
sana attığı webhook isteğinin gerçekten provider’dan geldiğini 
kriptografik olarak doğrulamak.
"""
#Kripto modülleri
import hmac #kriptografi hmac: HMAC hesaplamak ve güvenli karşılaştırma yapmak için
import hashlib #kriptografi hashlib: SHA256 gibi hash algoritmaları için
from django.conf import settings

def compute_hmac_sha256_hex(*, secret: str, body: bytes) -> str: # BİLGİYİ ALIP ÜRETİM. secret: str → gizli anahtar metin, body: bytes → ham request gövdesi (bytes)
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256) # secret.encode("utf-8"): secret string → bytes, body: mesaj (imzalanacak veri), hashlib.sha256: kullanılan hash fonksiyonu
    return mac.hexdigest() #HMAC sonucu bytes’tır. hexdigest() bunu str ye çevirir

def verify_webhook_signature(*, raw_body: bytes, signature: str | None) -> bool: #doğrulama sistemi. raw_body: bytes -> request.body, signature: str | None -> request.headers eğer yoksa none olaarak kabul edilecek.
    secret = getattr(settings, "PAYMENT_WEBHOOK_SECRET", "") or "" #ayarlar.py'da tanımladıgımız PAYMENT_WEBHOOK_SECRET degerini almak yoksa boş str al
    if not secret:
        return False #sistem: Secret yoksa webhook’a güvenmem diyor.
    if not signature: #signature yoksa (İmza doğrulaması yapılamaz)
        return False #O halde request güvenli değildir
    
    expected = compute_hmac_sha256_hex(secret=secret, body=raw_body) #imza oluşturmak üretim yaptık
    return hmac.compare_digest(expected, signature.strip()) #imza dogrulama
    """
    true ise Bu webhook gerçekten provider’dan geldi.
    false ise Sahte olabilir, işleme alma.
    python == şekilyel karşılaştırma yapmak güvenli değil hmac.compare_digest ile daha güvenlidir.
    expected ve signature aynı olmalı
    signature nedir? Provider’dan gelen header’daki imza.
    """
