# Production Deploy Rehberi

Bu rehber, `halkyemek.com.tr` production yayini icin dusuk riskli kurulum sirasini verir.

## Canonical Domain Yapisi

- Frontend: `https://halkyemek.com.tr`
- Frontend alternatif: `https://www.halkyemek.com.tr`
- Backend public API: `https://api.halkyemek.com.tr`

## Gerekli Dosyalar

- `docker-compose.prod.yml`
- `docker-compose.prod.ssl.yml`
- `deploy/nginx/default.conf`
- `deploy/nginx/default.ssl.conf.template`
- `.env.prod`

## 1. Environment Hazirlama

Ornek dosyayi kopyalayin:

```bash
cp .env.prod.example .env.prod
```

PowerShell:

```powershell
Copy-Item .env.prod.example .env.prod
```

`.env.prod` icinde en az su alanlari gercek degerlerle doldurun:

- `DJANGO_SECRET_KEY`
- `DATABASE_URL`
- `REDIS_CACHE_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `CORS_ALLOWED_ORIGINS`
- `CANONICAL_API_BASE_URL`
- `FRONTEND_APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `PAYMENT_WEBHOOK_SECRET`
- `SENTRY_DSN`
- Google OAuth, Brevo SMTP ve FCM/VAPID alanlari

Not:

- `DEPLOY_ENV_FILE` varsayilan olarak `.env.prod` kabul edilir.
- Production stack'i yanlislikla `.env` ile ayaga kaldirmayin.

## 2. Compose Konfigurasyonunu Dogrulama

Gercek production env ile:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml config
```

Sadece repo ornegini dogrulamak isterseniz:

```bash
docker compose --env-file .env.prod.example -f docker-compose.prod.yml config
```

## 3. Image Build ve Release Adimi

Tum production imajlarini build edin:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build
```

Migration + collectstatic + preflight iceren release adimini calistirin:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm release
```

Bu adim sunlari yapar:

- migration
- collectstatic
- runtime validation
- final preflight

## 4. Servisleri Ayaga Kaldirma

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db redis web worker-notifications worker-ops worker-finance worker-ops-heavy beat frontend nginx
```

Tek komutta build ederek kaldirmak icin:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## 5. Superuser Olusturma

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

## 6. HTTP Smoke Test

SSL oncesi temel kontrol:

```bash
curl http://api.halkyemek.com.tr/health/healthz/
curl http://api.halkyemek.com.tr/health/readiness/
```

Beklenen:

- `healthz` -> `200`
- `readiness` -> `200` veya problem varsa `503`

## 7. SSL Hazirligi

DNS kayitlari:

- `A halkyemek.com.tr -> SUNUCU_IP`
- `CNAME www -> halkyemek.com.tr`
- `A api.halkyemek.com.tr -> SUNUCU_IP`

ACME challenge klasoru:

```powershell
New-Item -ItemType Directory -Force -Path .\deploy\certbot\www | Out-Null
```

Certbot ornek komut:

```bash
sudo certbot certonly --webroot -w /ABS/PATH/TO/deploy/certbot/www -d halkyemek.com.tr -d www.halkyemek.com.tr -d api.halkyemek.com.tr
```

## 8. SSL Nginx Overlay ile Gecis

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.prod.ssl.yml config
```

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.prod.ssl.yml up -d nginx
```

Bu overlay su domain modelini aktif eder:

- `halkyemek.com.tr` ve `www.halkyemek.com.tr` -> frontend
- `api.halkyemek.com.tr` -> backend

## 9. Frontend Rebuild Gereksinimi

`NEXT_PUBLIC_*` degiskenleri client bundle icine gomulur. Domain degisirse frontend image yeniden build edilmelidir:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build frontend
```

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d frontend nginx
```

## 10. Production Smoke Test Listesi

```bash
curl -I https://halkyemek.com.tr
curl -I https://www.halkyemek.com.tr
curl -I https://api.halkyemek.com.tr/health/healthz/
curl -I https://api.halkyemek.com.tr/health/readiness/
```

Elle kontrol edin:

1. Ana sayfa aciliyor mu?
2. HalkTasarruf sayfasi aciliyor mu?
3. Google login callback calisiyor mu?
4. `/api/schema/`, `/api/docs/`, `/api/redoc/` production'da kapali mi?
5. Static dosyalar geliyor mu?
6. Media dosyalari geliyor mu?
7. Ops paneli aciliyor mu?
8. Business paneli aciliyor mu?
9. Cuzdan / checkout / QR akisi bozulmadi mi?

## 11. Static ve Media Kaliciligi

Production compose icinde:

- `staticfiles_data` -> Django collectstatic ciktisi
- `media_data` -> kullanici ve isletme upload dosyalari

Restart sonrasi media kontrolu:

1. Bir medya dosyasi yukleyin
2. `web` ve `nginx` servislerini restart edin
3. Dosya URL'i hala aciliyorsa persistence dogru calisiyor demektir

## 12. Backup Notu

Manuel PostgreSQL backup:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile backup run --rm backup
```

Restore komutu ve retention ayrintilari icin:

- `scripts/backup_postgres.sh`
- `scripts/restore_postgres.sh`

## 13. Guvenlik Notlari

- Production'da `/api/schema/`, `/api/docs/`, `/api/redoc/` kapali tutulur
- Public `readiness` cevabi sadece sade `ok/fail` bilgisini dondurur
- `healthz` operasyonel varlik kontrolu icindir
- Metrics endpoint'i token veya IP allowlist ile korunmalidir

## 14. Onerilen Yayina Alma Sirasi

1. `.env.prod` hazirla
2. `docker compose ... config`
3. `docker compose ... build`
4. `docker compose ... run --rm release`
5. `docker compose ... up -d`
6. `createsuperuser`
7. HTTP smoke test
8. DNS + certbot
9. SSL overlay aktivasyonu
10. Final smoke test
