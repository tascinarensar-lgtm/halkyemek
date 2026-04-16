# Final Release Standard

Bu belge staging/prod rollout için tek resmi acceptance standardını tanımlar.

## Tek akış
1. Gerçek ortam env dosyasını `.env.staging.example` veya `.env.prod.example` sözleşmesine göre doldur.
2. Release phase olarak `scripts/release.sh true` çalıştır.
3. Runtime süreçlerini başlat: web, beat, `worker-notifications`, `worker-ops`, `worker-finance`, `worker-ops-heavy`.
4. Acceptance kanıtını tek komutla topla:

```bash
BASE_URL=https://<host> EXPECTED_APP_ENV=staging EXPECTED_RELEASE=<release> ./scripts/release_acceptance.sh
```

## Acceptance içinde kapsanan kontroller
- `final_preflight_check --fail-on-lock-skip`
- `verify_financial_integrity`
- `report_financial_anomalies`
- Celery worker ping + beat heartbeat
- `/health/`
- `/health/readiness/`
- `/health/readiness/?strict=1`
- metrics auth yüzeyi
- resmi smoke endpoint kontrolü

## Bootstrap garantisi
- Resmi komut: `python manage.py bootstrap_marketplace --district BEYLIKDUZU`
- Doğrulama komutu: `python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU`
- Kabul kriteri: kategori sayısı resmi seed adedi kadar olmalı ve aktif `Diğer` kategorisi tam 1 adet olmalı.

## Rollback tetikleyicileri
- Release phase başarısız
- Acceptance başarısız
- Strict readiness 503
- Celery worker/beat kanıtı alınamıyor
- Finans komutları blocker üretiyor
- Bootstrap verification `home_visible` sayısını sağlayamıyor
