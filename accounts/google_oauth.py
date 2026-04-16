from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Any

import requests # HTTP istekleri yapmak için kullanılan popüler bir Python kütüphanesi
from django.conf import settings
from django.core.cache import cache #geçici hafızamızı dahil ettik settings.py içindeki CACHES ayarını kullanır

"""
Frontend’in Google’dan aldığı “ID Token”ı backend tarafında
doğrulamak ve doğrulama başarılıysa token içinden güvenilir 
kullanıcı bilgilerini (sub/email/name/picture) çıkarıp sana 
“claims” olarak döndürmek.
Google’ın ID Token’ı gerçek mi?
Token bu uygulama için mi üretildi?
Token Google’dan mı geldi?
Token tekrar kullanılıyor mu? (Replay Attack)
Performans
"""
# sabitler
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


@dataclass(frozen=True)
class GoogleClaims: # doğrulama sonrası döndürmek istediğin “güvenilir” alanlar.
    sub: str
    email: str | None
    email_verified: bool
    name: str | None
    picture: str | None


def _jwks() -> dict[str, Any]: # Google public keylerini çekme ve cache’leme Amaç: Her login denemesinde Google’a request atmamak.
    cache_key = "google:jwks:v1"
    jwks = cache.get(cache_key)
    if jwks:
        return jwks # cache de varsa onu döndür

    resp = requests.get(GOOGLE_JWKS_URL, timeout=5)
    resp.raise_for_status() # 200 değilse exception fırlatır ve hatayı loglar
    jwks = resp.json()

    cache.set(cache_key, jwks, timeout=60 * 60)  # 1h
    return jwks


def _token_hash(id_token: str) -> str: # Token’ı cache key olarak direkt saklamak istemezsin (uzun, hassas).
    return hashlib.sha256(id_token.encode("utf-8")).hexdigest()


def verify_google_id_token(id_token: str, *, replay_ttl_seconds: int = 90) -> GoogleClaims: #asıl doğrulama fonksiyonu
    import jwt # JWT (JSON Web Token) oluşturmak ve dogrulamak için kullanılan popüler bir Python kütüphanesi

    if not id_token or len(id_token) < 20: # Boş token veya çok kısa “çöp string” gelirse hemen kes.
        raise ValueError("Missing/invalid id_token")

    # Token hash’iyle bir cache anahtarı üretir Eğer bu anahtar cache’te varsa: aynı token kısa sürede tekrar geldi → reddet
    h = _token_hash(id_token)
    replay_key = f"google:id_token:seen:{h}"
    if cache.get(replay_key): # zaten varsa hata
        raise ValueError("Replay detected")
    cache.set(replay_key, int(time.time()), timeout=replay_ttl_seconds) # cache’e kaydet (tekrar gelirse yakalayabilmek için) TTL: 90 saniye, bu süre içinde aynı token gelirse replay attack olarak kabul edilir

    jwks = _jwks() # Google public keylerini çek

    header = jwt.get_unverified_header(id_token) # JWT’nin (token )sadece header kısmını okur.
    kid = header.get("kid") # kid : key id oluyor. Google’ın JWKS endpoint’inde birden fazla public key olabilir ve JWT’nin header’ında hangi key’in kullanıldığı “kid” alanında belirtilir. Doğrulama için doğru public key’i bulmamız gerekiyor.
    if not kid:
        raise ValueError("Missing kid")

    key = None #Burada Google’ın public keyini bulacağız.
    for k in jwks.get("keys", []): # Google’dan gelen JWKS listesi içinde dolaşıyoruz.
        if k.get("kid") == kid: # Token içinde gelen kid ile JWKS içindeki kid eşleşirse, o key’i kullanarak token’ı doğrulayacağız.
            key = jwt.algorithms.RSAAlgorithm.from_jwk(k) # type: ignore
            break
    if key is None:
        raise ValueError("Unknown kid")

    aud = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") # google uygulama kimliğini settingsten çekiyoruz
    if not aud:
        raise ValueError("GOOGLE_OAUTH_CLIENT_ID not configured")

    claims = jwt.decode( # Bu satır token doğrulamanın kalbidir. token imzası doğru mu, RS256 algoritması mı, token bizim uygulama için mi, 
        id_token,
        key=key,
        algorithms=["RS256"],
        audience=aud,
        options={"require": ["exp", "iat", "iss", "sub"]},
    )

    iss = claims.get("iss") # token ı kim ürettti ?
    if iss not in GOOGLE_ISSUERS: # google dışındansa reddet
        raise ValueError("Invalid issuer")

    return GoogleClaims( # Doğrulama başarılıysa şu bilgiler döndürülür:
        sub=str(claims["sub"]),
        email=claims.get("email"),
        email_verified=bool(claims.get("email_verified", False)),
        name=claims.get("name"),
        picture=claims.get("picture"),
    )