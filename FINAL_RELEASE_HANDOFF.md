# Final Release Handoff

> Not: `.env.example` local/development bootstrap içindir; rollout için `.env.staging.example` veya `.env.prod.example` baz alınmalıdır.

Bu doküman staging/prod rollout sırasında operatörün izleyeceği tek akışı özetler. Amaç, backend'i frontend teslimine uygun güvenli durumda ayağa kaldırmak, bootstrap verisini resmi şekilde seed etmek ve rollout sonrası smoke/readiness kanıtını toplamaktır.

## 1. Zorunlu runtime bağımlılıkları
- Postgres
- Redis (cache + lock + Celery broker/result backend)
- Web API
- Celery beat (tek instance)
- Celery workers
  - `notifications,default`
  - `ops,default`
  - `finance,default`
  - `ops_heavy,default`
- iyzico credential + webhook secret
- Google OAuth client id
- FCM service account credential
- Sentry DSN

## 2. Release öncesi config kontrolü
Aşağıdakiler staging/prod settings import anında fail-fast edilir:
- `DEBUG=0`
- Postgres zorunlu
- shared cache/backend zorunlu
- Celery eager kapalı
- canonical API URL https olmalı
- canonical host/origin, `ALLOWED_HOSTS` ve `CSRF_TRUSTED_ORIGINS` ile eşleşmeli
- metrics koruması açık olmalı
- trusted proxy yapılandırması eksiksiz olmalı
- Google OAuth / FCM / iyzico / webhook secret eksiksiz olmalı
- settlement inbox/archive/failed dizinleri birlikte tanımlanmalı

## 3. Resmi bootstrap
Discovery yüzeyinin boş gelmemesi için release sırasında resmi kategori bootstrap komutu çalıştırılır:

```bash
python manage.py bootstrap_marketplace --district BEYLIKDUZU
```

Kaynak veri:
- command: `businesses/management/commands/bootstrap_marketplace.py`
- fixture referansı: `businesses/fixtures/marketplace_categories_beylikduzu.json`

Bu komut idempotenttir. Mevcut seed kayıtlarını çoğaltmaz; eksikleri ekler, pasif seed kayıtlarını yeniden aktif eder.

## 4. Release sırası
1. `.env.staging.example` veya `.env.prod.example` baz alınarak gerçek env hazırlanır.
2. Release phase tek sefer çalıştırılır: `scripts/release.sh true`
3. `scripts/prestart.sh` release phase içinde sırasıyla:
   - `check --deploy`
   - `migrate` / `migrate --check`
   - `collectstatic` (istenirse)
   - `bootstrap_marketplace` / `verify_bootstrap_marketplace` (istenirse ama release phase için önerilen)
   - `validate_env_examples`
   - `final_preflight_check`
4. `web`, worker ve beat süreçleri ayağa kaldırılır.
5. Tek acceptance komutu çalıştırılır:
   - `BASE_URL=... EXPECTED_APP_ENV=staging EXPECTED_RELEASE=... ./scripts/release_acceptance.sh`
6. Acceptance geçtiğinde operator strict readiness, celery health ve smoke kanıtını aynı çıktı setinde saklar.

## 5. Readiness yorumu
- `/health/` => proses canlı
- `/health/readiness/` => core readiness
- `/health/readiness/?strict=1` => core + scheduler/job heartbeat readiness
- strict readiness geçmeden frontend/staging acceptance tamamlandı sayılmaz

## 6. Minimum acceptance kanıtı
- final preflight geçti
- strict readiness 200 dönüyor
- Celery worker health başarılı
- beat heartbeat güncel
- bootstrap seed sonrası discovery categories boş değil ve `home_visible` sayısı resmi seed adedi kadar
- integrity/anomaly komutları kritik hata vermiyor
- webhook/config secrets doğru

## 7. Rollback tetikleyicileri
Şunlardan biri varsa release kabul edilmez:
- final preflight fail
- strict readiness fail
- worker/beat health fail
- settlement/payout integrity komutları blocker üretir
- bootstrap sonrası discovery ana blokları boş veya hatalı
- config/runtime validation hatası

Rollback detayları için `ROLLBACK_PLAN.md` kullanılmalı.
